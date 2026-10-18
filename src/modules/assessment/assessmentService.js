/**
 * @fileoverview Assessment Service
 *
 * Manages database persistence, historical preservation, and event urgency updates
 * for review-priority assessments.
 */

import { getPool } from '../../db/pool.js';
import { assessConjunctionEvent } from './assessmentEngine.js';
import { appendAuditEntry } from '../audit/auditLedger.js';
import { checkAndFlagReReviewNeeded } from '../review/reviewService.js';

/**
 * Persists an assessment record and updates the event's urgency level.
 *
 * @param {object} client - PostgreSQL client (within transaction)
 * @param {string} eventId - UUID of conjunction event
 * @param {string | null} observationId - UUID of source observation (if available)
 * @param {object} assessmentResult - Output from assessConjunctionEvent
 * @param {boolean} [isCurrent=true] - Whether this assessment represents current state
 * @returns {Promise<object>} Inserted assessment record
 */
export async function recordAssessment(
  client,
  eventId,
  observationId,
  assessmentResult,
  isCurrent = true,
) {
  if (isCurrent) {
    // Demote prior current assessments to preserve full historical trace
    await client.query(
      `UPDATE event_assessments
       SET is_current = FALSE
       WHERE event_id = $1 AND is_current = TRUE;`,
      [eventId],
    );
  }

  const res = await client.query(
    `INSERT INTO event_assessments (
       event_id,
       observation_id,
       rule_set_version,
       assessment_score,
       urgency_level,
       component_scores,
       input_snapshot,
       explanations,
       is_current,
       evaluated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *;`,
    [
      eventId,
      observationId || null,
      assessmentResult.ruleSetVersion,
      assessmentResult.score,
      assessmentResult.urgencyLevel,
      JSON.stringify(assessmentResult.componentScores),
      JSON.stringify(assessmentResult.inputSnapshot),
      JSON.stringify(assessmentResult.explanations),
      isCurrent,
      assessmentResult.evaluatedAt,
    ],
  );

  if (isCurrent) {
    // Reflect latest assessment urgency level on conjunction event
    await client.query(
      `UPDATE conjunction_events
       SET urgency_level = $1, updated_at = NOW()
       WHERE id = $2;`,
      [assessmentResult.urgencyLevel, eventId],
    );
  }

  // Record assessment event in cryptographic audit ledger
  await appendAuditEntry(client, {
    eventId,
    actionType: 'ASSESSMENT_RECORDED',
    actorType: 'SYSTEM',
    actorId: 'EUROPA_ENGINE',
    payload: {
      assessmentId: res.rows[0].id,
      observationId: observationId || null,
      score: assessmentResult.score,
      urgencyLevel: assessmentResult.urgencyLevel,
      ruleSetVersion: assessmentResult.ruleSetVersion,
      missDistanceKm: assessmentResult.inputSnapshot.missDistanceKm,
      isCurrent,
    },
  });

  return res.rows[0];
}

/**
 * Evaluates and persists an assessment for a conjunction event.
 *
 * @param {object} client - PostgreSQL client
 * @param {object} event - Conjunction event record
 * @param {object} [observation] - Source raw observation
 * @param {object} [options={}] - Options (referenceTime, ruleConfig, isBackfill)
 * @returns {Promise<{ assessment: object, result: object }>}
 */
export async function assessAndSaveEvent(client, event, observation = null, options = {}) {
  const isCurrent = !options.isBackfill;
  const priorAssessment = isCurrent ? await getLatestAssessment(event.id, { client }) : null;

  const result = assessConjunctionEvent(event, observation, options);
  const assessment = await recordAssessment(
    client,
    event.id,
    observation?.id || null,
    result,
    isCurrent,
  );

  if (isCurrent && observation) {
    await checkAndFlagReReviewNeeded(client, event, priorAssessment, result, observation);
  }

  return { assessment, result };
}

/**
 * Retrieves full chronological assessment history for an event.
 *
 * @param {string} eventId
 * @param {object} [options={}]
 * @param {object} [options.client]
 * @returns {Promise<Array<object>>}
 */
export async function getEventAssessments(eventId, options = {}) {
  const db = options.client || getPool();
  const res = await db.query(
    `SELECT * FROM event_assessments
     WHERE event_id = $1
     ORDER BY created_at DESC;`,
    [eventId],
  );
  return res.rows;
}

/**
 * Retrieves the currently active assessment for an event.
 *
 * @param {string} eventId
 * @param {object} [options={}]
 * @param {object} [options.client]
 * @returns {Promise<object | null>}
 */
export async function getLatestAssessment(eventId, options = {}) {
  const db = options.client || getPool();
  const res = await db.query(
    `SELECT * FROM event_assessments
     WHERE event_id = $1 AND is_current = TRUE
     LIMIT 1;`,
    [eventId],
  );
  return res.rows[0] || null;
}
