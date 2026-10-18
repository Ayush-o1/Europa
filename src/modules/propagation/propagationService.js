/**
 * @fileoverview Orbital Propagation & Screening Database Service
 *
 * Coordinates SGP4 encounter estimation, database persistence into orbital_screenings,
 * and cryptographic audit logging of orbital screening computations.
 */

import { getPool, query } from '../../db/pool.js';
import { estimateEncounterCloseApproach } from './encounterEstimator.js';
import { appendAuditEntry } from '../audit/auditLedger.js';

/**
 * Computes an SGP4 orbital encounter screening, optionally persisting the result
 * and recording an immutable audit entry if linked to an existing conjunction event.
 *
 * @param {object} options
 * @param {{ line1: string, line2: string }} options.primaryTle
 * @param {{ line1: string, line2: string }} options.secondaryTle
 * @param {Date | string} options.nominalTca
 * @param {number} [options.searchWindowMinutes=10]
 * @param {number} [options.stepSeconds=5]
 * @param {string | null} [options.eventId=null]
 * @param {string} [options.actorId='operator']
 * @returns {Promise<object>}
 */
export async function runEncounterScreening(options) {
  const estimation = estimateEncounterCloseApproach(options);

  if (!options.eventId) {
    return {
      screeningId: null,
      persisted: false,
      ...estimation,
    };
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN;');

    // 1. Verify conjunction event exists
    const eventRes = await client.query(
      `SELECT id, primary_object_id, secondary_object_id, canonical_pair_key, latest_tca, latest_range_km
       FROM conjunction_events
       WHERE id = $1;`,
      [options.eventId],
    );

    if (eventRes.rows.length === 0) {
      throw new Error(`Conjunction event not found: ${options.eventId}`);
    }

    const event = eventRes.rows[0];

    // 2. Ensure both space objects exist in space_objects table (or insert if synthetic)
    await client.query(
      `INSERT INTO space_objects (norad_cat_id, object_name, operational_status)
       VALUES ($1, $2, 'ACTIVE')
       ON CONFLICT (norad_cat_id) DO NOTHING;`,
      [estimation.primaryObject.catalogNumber, `SAT-${estimation.primaryObject.catalogNumber}`],
    );
    await client.query(
      `INSERT INTO space_objects (norad_cat_id, object_name, operational_status)
       VALUES ($1, $2, 'ACTIVE')
       ON CONFLICT (norad_cat_id) DO NOTHING;`,
      [estimation.secondaryObject.catalogNumber, `SAT-${estimation.secondaryObject.catalogNumber}`],
    );

    // 3. Insert screening record
    const insertRes = await client.query(
      `INSERT INTO orbital_screenings (
         event_id,
         primary_object_id,
         secondary_object_id,
         nominal_tca,
         estimated_tca,
         estimated_miss_distance_km,
         estimated_relative_speed_kms,
         search_window_minutes,
         step_seconds,
         primary_tle_line1,
         primary_tle_line2,
         secondary_tle_line1,
         secondary_tle_line2,
         primary_tle_epoch,
         secondary_tle_epoch,
         primary_tle_age_hours,
         secondary_tle_age_hours,
         algorithm_version,
         screening_metadata
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
       ) RETURNING id, created_at;`,
      [
        options.eventId,
        estimation.primaryObject.catalogNumber,
        estimation.secondaryObject.catalogNumber,
        estimation.nominalTca,
        estimation.estimatedTca,
        estimation.estimatedMissDistanceKm,
        estimation.estimatedRelativeSpeedKmS,
        estimation.searchWindowMinutes,
        estimation.stepSeconds,
        options.primaryTle.line1.trim(),
        options.primaryTle.line2.trim(),
        options.secondaryTle.line1.trim(),
        options.secondaryTle.line2.trim(),
        estimation.primaryObject.epoch,
        estimation.secondaryObject.epoch,
        estimation.primaryObject.tleAgeHours,
        estimation.secondaryObject.tleAgeHours,
        estimation.algorithm.name,
        JSON.stringify({
          tcaDeltaSeconds: estimation.tcaDeltaSeconds,
          isStaleTle: estimation.isStaleTle,
          socratesReportedRangeKm: parseFloat(event.latest_range_km),
          socratesReportedTca: event.latest_tca,
        }),
      ],
    );

    const screeningId = insertRes.rows[0].id;
    const createdAt = insertRes.rows[0].created_at;

    // 4. Record cryptographic audit entry
    await appendAuditEntry(client, {
      eventId: options.eventId,
      actionType: 'ORBITAL_SCREENING_COMPUTED',
      actorType: options.actorId ? 'OPERATOR' : 'SYSTEM',
      actorId: options.actorId || 'operator',
      payload: {
        screeningId,
        primaryObject: estimation.primaryObject.catalogNumber,
        secondaryObject: estimation.secondaryObject.catalogNumber,
        estimatedTca: estimation.estimatedTca,
        estimatedMissDistanceKm: estimation.estimatedMissDistanceKm,
        estimatedRelativeSpeedKmS: estimation.estimatedRelativeSpeedKmS,
        algorithm: estimation.algorithm.name,
      },
    });

    await client.query('COMMIT;');

    return {
      screeningId,
      persisted: true,
      createdAt,
      ...estimation,
    };
  } catch (err) {
    await client.query('ROLLBACK;');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Retrieves historical orbital propagation screenings for an encounter event.
 *
 * @param {string} eventId
 * @returns {Promise<object[]>}
 */
export async function getEventScreenings(eventId) {
  const res = await query(
    `SELECT
       id,
       event_id,
       primary_object_id,
       secondary_object_id,
       nominal_tca,
       estimated_tca,
       estimated_miss_distance_km,
       estimated_relative_speed_kms,
       search_window_minutes,
       step_seconds,
       primary_tle_line1,
       primary_tle_line2,
       secondary_tle_line1,
       secondary_tle_line2,
       primary_tle_epoch,
       secondary_tle_epoch,
       primary_tle_age_hours,
       secondary_tle_age_hours,
       algorithm_version,
       screening_metadata,
       created_at
     FROM orbital_screenings
     WHERE event_id = $1
     ORDER BY created_at DESC;`,
    [eventId],
  );

  return res.rows.map(row => ({
    id: row.id,
    eventId: row.event_id,
    primaryObjectId: row.primary_object_id,
    secondaryObjectId: row.secondary_object_id,
    nominalTca: row.nominal_tca,
    estimatedTca: row.estimated_tca,
    estimatedMissDistanceKm: parseFloat(row.estimated_miss_distance_km),
    estimatedRelativeSpeedKmS: parseFloat(row.estimated_relative_speed_kms),
    searchWindowMinutes: row.search_window_minutes,
    stepSeconds: row.step_seconds,
    primaryTleLine1: row.primary_tle_line1,
    primaryTleLine2: row.primary_tle_line2,
    secondaryTleLine1: row.secondary_tle_line1,
    secondaryTleLine2: row.secondary_tle_line2,
    primaryTleEpoch: row.primary_tle_epoch,
    secondaryTleEpoch: row.secondary_tle_epoch,
    primaryTleAgeHours: parseFloat(row.primary_tle_age_hours),
    secondaryTleAgeHours: parseFloat(row.secondary_tle_age_hours),
    algorithmVersion: row.algorithm_version,
    metadata: row.screening_metadata,
    createdAt: row.created_at,
  }));
}
