/**
 * @fileoverview Conjunction Event Correlation Service
 * Coordinates advisory-locked correlation of raw observations into discrete events.
 */

import { getPool } from '../../db/pool.js';
import { evaluateObservationMatch, DEFAULT_MATCHING_POLICY } from './matchingPolicy.js';
import { assessAndSaveEvent } from '../assessment/assessmentService.js';
import { appendAuditEntry } from '../audit/auditLedger.js';

/**
 * Correlates all un-correlated observations in an ingestion batch.
 * Uses two-key PostgreSQL advisory locks (primary_norad_id, secondary_norad_id)
 * acquired in strictly ascending order to eliminate deadlock risks.
 *
 * @param {string} batchId - Ingestion batch UUID
 * @param {object} [options]
 * @param {import('pg').PoolClient} [options.client] - Existing transaction client
 * @param {string} [options.connectionString]
 * @param {object} [options.policyConfig] - Configurable heuristics override
 * @returns {Promise<{
 *   totalCorrelated: number,
 *   eventsCreated: number,
 *   eventsMatched: number,
 *   ambiguousMatches: number,
 *   confirmations: number,
 *   backfills: number
 * }>}
 */
export async function correlateBatch(batchId, options = {}) {
  const pool = options.client ? null : getPool(options.connectionString);
  const client = options.client || (await pool.connect());
  const policyConfig = { ...DEFAULT_MATCHING_POLICY, ...options.policyConfig };

  const shouldManageTransaction = !options.client;
  const stats = {
    totalCorrelated: 0,
    eventsCreated: 0,
    eventsMatched: 0,
    ambiguousMatches: 0,
    confirmations: 0,
    backfills: 0,
  };

  try {
    if (shouldManageTransaction) {
      await client.query('BEGIN;');
    }

    // 1. Fetch raw observations in this batch that have not yet been evaluated
    const obsRes = await client.query(
      `SELECT ro.*
       FROM raw_observations ro
       LEFT JOIN correlation_decisions cd ON cd.observation_id = ro.id
       WHERE ro.batch_id = $1 AND cd.id IS NULL
       ORDER BY ro.primary_norad_id ASC, ro.secondary_norad_id ASC, ro.captured_at ASC, ro.row_index ASC;`,
      [batchId],
    );

    if (obsRes.rows.length === 0) {
      if (shouldManageTransaction) {
        await client.query('COMMIT;');
      }
      return stats;
    }

    // 2. Group observations by canonical pair
    const pairGroups = new Map();
    for (const obs of obsRes.rows) {
      const pairKey = `${obs.primary_norad_id}:${obs.secondary_norad_id}`;
      if (!pairGroups.has(pairKey)) {
        pairGroups.set(pairKey, {
          primary: obs.primary_norad_id,
          secondary: obs.secondary_norad_id,
          observations: [],
        });
      }
      pairGroups.get(pairKey).observations.push(obs);
    }

    // 3. Sort pairs ascending by primary, then secondary (deadlock avoidance)
    const sortedPairs = Array.from(pairGroups.values()).sort(
      (a, b) => a.primary - b.primary || a.secondary - b.secondary,
    );

    // 4. Process each pair under transaction-scoped advisory lock
    for (const pair of sortedPairs) {
      // Two-key integer advisory lock on the canonical pair
      await client.query('SELECT pg_advisory_xact_lock($1, $2);', [pair.primary, pair.secondary]);

      // Query active events for this pair
      const eventsRes = await client.query(
        `SELECT * FROM conjunction_events
         WHERE canonical_pair_key = $1 AND lifecycle_state = 'MONITORING'
         ORDER BY latest_tca ASC;`,
        [`${pair.primary}:${pair.secondary}`],
      );

      const activeEvents = eventsRes.rows;
      const matchedEventsInBatch = new Set();

      for (const obs of pair.observations) {
        stats.totalCorrelated += 1;

        // Intra-snapshot anomaly check: if multiple rows in the same batch compete for the same event
        const evaluation = evaluateObservationMatch(obs, activeEvents, policyConfig);

        // If evaluation matches an event that was ALREADY matched by another observation in the SAME batch
        let isIntraBatchConflict = false;
        if (
          evaluation.decisionType === 'EVENT_MATCHED' &&
          matchedEventsInBatch.has(evaluation.targetEventId)
        ) {
          isIntraBatchConflict = true;
        }

        if (isIntraBatchConflict) {
          // Flag as ambiguous due to competing predictions in the same report
          await client.query(
            `INSERT INTO correlation_decisions (
               observation_id, event_id, decision_type, candidate_event_ids,
               matching_policy_version, step_drift_minutes, cumulative_drift_minutes, decision_reason
             ) VALUES ($1, NULL, 'AMBIGUOUS_MATCH', $2, $3, $4, $5, $6);`,
            [
              obs.id,
              [evaluation.targetEventId],
              policyConfig.policyVersion,
              evaluation.stepDriftMinutes,
              evaluation.cumulativeDriftMinutes,
              'Ambiguous match: multiple competing observations for same object pair within a single snapshot.',
            ],
          );

          await client.query(
            `UPDATE conjunction_events SET tracking_state = 'AMBIGUOUS_MATCH', updated_at = NOW()
             WHERE id = $1;`,
            [evaluation.targetEventId],
          );

          stats.ambiguousMatches += 1;
          continue;
        }

        if (evaluation.decisionType === 'EVENT_CREATED') {
          // Create new conjunction event
          const newEventRes = await client.query(
            `INSERT INTO conjunction_events (
               primary_object_id, secondary_object_id, canonical_pair_key,
               initial_tca, initial_captured_at, latest_tca, latest_captured_at,
               latest_range_km, min_predicted_range_km, observation_count,
               lifecycle_state, urgency_level, review_status, tracking_state
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, 'MONITORING', 'LOW', 'UNREVIEWED', 'CONFIRMED')
             RETURNING *;`,
            [
              obs.primary_norad_id,
              obs.secondary_norad_id,
              obs.canonical_pair_key,
              obs.tca,
              obs.captured_at,
              obs.tca,
              obs.captured_at,
              obs.tca_range_km,
              obs.tca_range_km,
            ],
          );

          const createdEvent = newEventRes.rows[0];

          // Link observation (sequence 1)
          await client.query(
            `INSERT INTO event_observations (event_id, observation_id, chronological_sequence, is_unchanged_confirmation)
             VALUES ($1, $2, 1, FALSE);`,
            [createdEvent.id, obs.id],
          );

          // Record decision
          await client.query(
            `INSERT INTO correlation_decisions (
               observation_id, event_id, decision_type, candidate_event_ids,
               matching_policy_version, step_drift_minutes, cumulative_drift_minutes, decision_reason
             ) VALUES ($1, $2, 'EVENT_CREATED', $3, $4, $5, $6, $7);`,
            [
              obs.id,
              createdEvent.id,
              evaluation.candidateEventIds,
              policyConfig.policyVersion,
              evaluation.stepDriftMinutes,
              evaluation.cumulativeDriftMinutes,
              evaluation.decisionReason,
            ],
          );

          await assessAndSaveEvent(client, createdEvent, obs, {
            referenceTime: obs.captured_at,
          });

          await appendAuditEntry(client, {
            eventId: createdEvent.id,
            actionType: 'EVENT_CREATED',
            actorType: 'SYSTEM',
            actorId: 'EUROPA_ENGINE',
            payload: {
              canonicalPairKey: createdEvent.canonical_pair_key,
              initialTca: createdEvent.initial_tca,
              latestRangeKm: createdEvent.latest_range_km,
              observationId: obs.id,
            },
          });

          activeEvents.push(createdEvent);
          matchedEventsInBatch.add(createdEvent.id);
          stats.eventsCreated += 1;
        } else if (evaluation.decisionType === 'EVENT_MATCHED') {
          const targetEvent = activeEvents.find(e => e.id === evaluation.targetEventId);

          // Check for unchanged confirmation
          const confirmRes = await client.query(
            `SELECT ro.id FROM event_observations eo
             JOIN raw_observations ro ON ro.id = eo.observation_id
             WHERE eo.event_id = $1 AND ro.tca = $2 AND ro.tca_range_km = $3
             LIMIT 1;`,
            [targetEvent.id, obs.tca, obs.tca_range_km],
          );

          const isUnchangedConfirmation = confirmRes.rows.length > 0;
          let decisionType = isUnchangedConfirmation ? 'UNCHANGED_CONFIRMATION' : 'EVENT_MATCHED';

          // Check chronological sequence vs out-of-order arrival
          const obsCapturedMs = new Date(obs.captured_at).getTime();
          const targetLatestCapturedMs = new Date(targetEvent.latest_captured_at).getTime();
          const isBackfill = obsCapturedMs < targetLatestCapturedMs;

          if (isBackfill) {
            decisionType = 'OUT_OF_ORDER_BACKFILL';
          }

          // Sequence assignment
          const seqRes = await client.query(
            `SELECT COALESCE(MAX(chronological_sequence), 0) as max_seq FROM event_observations WHERE event_id = $1;`,
            [targetEvent.id],
          );
          const nextSequence = parseInt(seqRes.rows[0].max_seq, 10) + 1;

          await client.query(
            `INSERT INTO event_observations (event_id, observation_id, chronological_sequence, is_unchanged_confirmation)
             VALUES ($1, $2, $3, $4);`,
            [targetEvent.id, obs.id, nextSequence, isUnchangedConfirmation],
          );

          let updatedEventRecord;

          // Update event fields based on chronological freshness
          if (!isBackfill) {
            // Normal chronological update: advance latest fields
            const updatedEvtRes = await client.query(
              `UPDATE conjunction_events SET
                 latest_tca = $1,
                 latest_captured_at = $2,
                 latest_range_km = $3,
                 min_predicted_range_km = LEAST(min_predicted_range_km, $4),
                 observation_count = observation_count + 1,
                 tracking_state = 'CONFIRMED',
                 updated_at = NOW()
               WHERE id = $5
               RETURNING *;`,
              [obs.tca, obs.captured_at, obs.tca_range_km, obs.tca_range_km, targetEvent.id],
            );
            updatedEventRecord = updatedEvtRes.rows[0];
            // Update in-memory reference
            const idx = activeEvents.findIndex(e => e.id === targetEvent.id);
            if (idx !== -1) {
              activeEvents[idx] = updatedEventRecord;
            }
          } else {
            // Out-of-order backfill: do NOT overwrite latest_tca or latest_range_km!
            const updatedEvtRes = await client.query(
              `UPDATE conjunction_events SET
                 min_predicted_range_km = LEAST(min_predicted_range_km, $1),
                 observation_count = observation_count + 1,
                 updated_at = NOW()
               WHERE id = $2
               RETURNING *;`,
              [obs.tca_range_km, targetEvent.id],
            );
            updatedEventRecord = updatedEvtRes.rows[0];
            const idx = activeEvents.findIndex(e => e.id === targetEvent.id);
            if (idx !== -1) {
              activeEvents[idx] = updatedEventRecord;
            }
          }

          // Assess updated event and persist historical assessment record
          await assessAndSaveEvent(client, updatedEventRecord, obs, {
            referenceTime: obs.captured_at,
            isBackfill,
          });

          await appendAuditEntry(client, {
            eventId: updatedEventRecord.id,
            actionType: 'EVENT_CORRELATED',
            actorType: 'SYSTEM',
            actorId: 'EUROPA_ENGINE',
            payload: {
              decisionType,
              observationId: obs.id,
              isBackfill,
              latestRangeKm: updatedEventRecord.latest_range_km,
              observationCount: updatedEventRecord.observation_count,
            },
          });

          // Record correlation decision
          await client.query(
            `INSERT INTO correlation_decisions (
               observation_id, event_id, decision_type, candidate_event_ids,
               matching_policy_version, step_drift_minutes, cumulative_drift_minutes, decision_reason
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
            [
              obs.id,
              targetEvent.id,
              decisionType,
              evaluation.candidateEventIds,
              policyConfig.policyVersion,
              evaluation.stepDriftMinutes,
              evaluation.cumulativeDriftMinutes,
              evaluation.decisionReason,
            ],
          );

          matchedEventsInBatch.add(targetEvent.id);

          if (isUnchangedConfirmation) {
            stats.confirmations += 1;
          } else if (isBackfill) {
            stats.backfills += 1;
          } else {
            stats.eventsMatched += 1;
          }
        } else if (evaluation.decisionType === 'AMBIGUOUS_MATCH') {
          // Ambiguous match: record decision without linking to a specific event
          await client.query(
            `INSERT INTO correlation_decisions (
               observation_id, event_id, decision_type, candidate_event_ids,
               matching_policy_version, step_drift_minutes, cumulative_drift_minutes, decision_reason
             ) VALUES ($1, NULL, 'AMBIGUOUS_MATCH', $2, $3, $4, $5, $6);`,
            [
              obs.id,
              evaluation.candidateEventIds,
              policyConfig.policyVersion,
              evaluation.stepDriftMinutes,
              evaluation.cumulativeDriftMinutes,
              evaluation.decisionReason,
            ],
          );

          // Mark candidate events as AMBIGUOUS_MATCH tracking state
          if (evaluation.candidateEventIds.length > 0) {
            await client.query(
              `UPDATE conjunction_events SET tracking_state = 'AMBIGUOUS_MATCH', updated_at = NOW()
               WHERE id = ANY($1::uuid[]);`,
              [evaluation.candidateEventIds],
            );
          }

          stats.ambiguousMatches += 1;
        }
      }
    }

    if (shouldManageTransaction) {
      await client.query('COMMIT;');
    }

    return stats;
  } catch (err) {
    if (shouldManageTransaction) {
      await client.query('ROLLBACK;');
    }
    throw new Error(`Correlation failed: ${err.message}`, { cause: err });
  } finally {
    if (shouldManageTransaction) {
      client.release();
    }
  }
}
