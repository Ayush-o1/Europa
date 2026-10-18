/**
 * @fileoverview Operator Review Service
 *
 * Manages human operator review actions, justified decision recording,
 * review history preservation, and re-review flagging on material prediction changes.
 */

import { getPool } from '../../db/pool.js';
import { appendAuditEntry } from '../audit/auditLedger.js';
import { getLatestAssessment } from '../assessment/assessmentService.js';

export const VALID_REVIEW_ACTIONS = ['ACKNOWLEDGE', 'ESCALATE', 'DISMISS', 'REQUEST_REASSESSMENT'];

const ACTION_STATUS_MAP = {
  ACKNOWLEDGE: 'UNDER_REVIEW',
  ESCALATE: 'ESCALATED',
  DISMISS: 'DISMISSED',
  REQUEST_REASSESSMENT: 'REQUIRES_RE_REVIEW',
};

/**
 * Validates review input parameters.
 * @param {object} params
 * @param {string} params.action
 * @param {string} params.justification
 * @param {string} params.actorId
 */
export function validateReviewInput({ action, justification, actorId }) {
  if (!action || !VALID_REVIEW_ACTIONS.includes(action)) {
    throw new Error(
      `Invalid review action '${action}'. Allowed actions: ${VALID_REVIEW_ACTIONS.join(', ')}`,
    );
  }

  if (!justification || typeof justification !== 'string' || justification.trim().length < 10) {
    throw new Error('A meaningful review justification of at least 10 characters is required.');
  }

  if (!actorId || typeof actorId !== 'string' || actorId.trim().length === 0) {
    throw new Error('A valid non-empty actorId is required.');
  }
}

/**
 * Records an operator review decision for a conjunction event.
 *
 * @param {string} eventId
 * @param {object} reviewData
 * @param {'ACKNOWLEDGE' | 'ESCALATE' | 'DISMISS' | 'REQUEST_REASSESSMENT'} reviewData.action
 * @param {string} reviewData.justification
 * @param {string} reviewData.actorId
 * @param {object} [options={}]
 * @param {object} [options.client]
 * @returns {Promise<{ review: object, updatedEvent: object }>}
 */
export async function recordReview(eventId, reviewData, options = {}) {
  validateReviewInput(reviewData);

  const shouldManageTransaction = !options.client;
  const pool = options.client ? null : getPool(options.connectionString);
  const client = options.client || (await pool.connect());

  try {
    if (shouldManageTransaction) {
      await client.query('BEGIN;');
    }

    // 1. Lock conjunction event for update
    const eventRes = await client.query(
      `SELECT * FROM conjunction_events WHERE id = $1 FOR UPDATE;`,
      [eventId],
    );

    if (eventRes.rows.length === 0) {
      throw new Error(`Conjunction event '${eventId}' not found.`);
    }

    const event = eventRes.rows[0];
    const previousReviewStatus = event.review_status;
    const newReviewStatus = ACTION_STATUS_MAP[reviewData.action];

    // 2. Fetch latest assessment to establish audit context
    const latestAssessment = await getLatestAssessment(eventId, { client });

    // 3. Insert review record
    const reviewRes = await client.query(
      `INSERT INTO event_reviews (
         event_id,
         observation_id,
         assessment_id,
         action,
         justification,
         actor_id,
         previous_review_status,
         new_review_status,
         created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING *;`,
      [
        eventId,
        latestAssessment?.observation_id || null,
        latestAssessment?.id || null,
        reviewData.action,
        reviewData.justification.trim(),
        reviewData.actorId.trim(),
        previousReviewStatus,
        newReviewStatus,
      ],
    );

    const review = reviewRes.rows[0];

    // 4. Update event review status
    const updateEventRes = await client.query(
      `UPDATE conjunction_events
       SET review_status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *;`,
      [newReviewStatus, eventId],
    );

    const updatedEvent = updateEventRes.rows[0];

    // 5. Append to cryptographic audit ledger
    await appendAuditEntry(client, {
      eventId,
      actionType: 'REVIEW_RECORDED',
      actorType: 'OPERATOR',
      actorId: reviewData.actorId.trim(),
      payload: {
        reviewId: review.id,
        action: reviewData.action,
        justification: review.justification,
        previousReviewStatus,
        newReviewStatus,
        assessmentId: latestAssessment?.id || null,
        assessmentScore: latestAssessment?.assessment_score || null,
        urgencyLevel: event.urgency_level,
      },
    });

    if (shouldManageTransaction) {
      await client.query('COMMIT;');
    }

    return { review, updatedEvent };
  } catch (err) {
    if (shouldManageTransaction) {
      await client.query('ROLLBACK;');
    }
    throw err;
  } finally {
    if (shouldManageTransaction) {
      client.release();
    }
  }
}

/**
 * Retrieves all review records for an event in reverse chronological order.
 *
 * @param {string} eventId
 * @param {object} [options={}]
 * @param {object} [options.client]
 * @returns {Promise<Array<object>>}
 */
export async function getEventReviews(eventId, options = {}) {
  const db = options.client || getPool();
  const res = await db.query(
    `SELECT * FROM event_reviews
     WHERE event_id = $1
     ORDER BY created_at DESC;`,
    [eventId],
  );
  return res.rows;
}

/**
 * Checks if a newly correlated observation materially changes an event that was previously reviewed.
 * If material change is detected, marks review_status = 'REQUIRES_RE_REVIEW' and logs to audit ledger.
 *
 * Material change criteria:
 * 1. Urgency elevated (e.g. LOW -> MEDIUM/HIGH/CRITICAL, or MEDIUM -> HIGH/CRITICAL).
 * 2. Predicted miss distance decreased by >= 20% compared to previous evaluation.
 * 3. Time remaining to TCA crossed under 24 hours.
 *
 * @param {object} client - PostgreSQL client
 * @param {object} event - Current event record
 * @param {object | null} priorAssessment - Prior active assessment
 * @param {object} newAssessmentResult - New assessment result from engine
 * @param {object} observation - New raw observation
 * @returns {Promise<boolean>} True if re-review was flagged
 */
export async function checkAndFlagReReviewNeeded(
  client,
  event,
  priorAssessment,
  newAssessmentResult,
  observation,
) {
  // Only evaluate events that have undergone operator review (not UNREVIEWED)
  const isReviewed =
    event.review_status &&
    ['UNDER_REVIEW', 'ESCALATED', 'DISMISSED', 'ACTION_TAKEN'].includes(event.review_status);

  if (!isReviewed || !priorAssessment) {
    return false;
  }

  const urgencyRank = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  const priorRank = urgencyRank[priorAssessment.urgency_level] || 1;
  const newRank = urgencyRank[newAssessmentResult.urgencyLevel] || 1;

  const isUrgencyElevated = newRank > priorRank;

  // Miss distance contraction >= 20%
  const priorRange = parseFloat(priorAssessment.input_snapshot.missDistanceKm);
  const newRange = parseFloat(newAssessmentResult.inputSnapshot.missDistanceKm);
  const isRangeContracted =
    !isNaN(priorRange) && !isNaN(newRange) && priorRange > 0 && newRange < priorRange * 0.8;

  // Imminence boundary crossed (< 24h)
  const priorHours = parseFloat(priorAssessment.input_snapshot.timeToTcaHours);
  const newHours = parseFloat(newAssessmentResult.inputSnapshot.timeToTcaHours);
  const isImminenceCrossed =
    !isNaN(priorHours) && !isNaN(newHours) && priorHours >= 24 && newHours < 24;

  const isMaterialChange = isUrgencyElevated || isRangeContracted || isImminenceCrossed;

  if (isMaterialChange) {
    const reasons = [];
    if (isUrgencyElevated) {
      reasons.push(
        `Urgency elevated from ${priorAssessment.urgency_level} to ${newAssessmentResult.urgencyLevel}`,
      );
    }
    if (isRangeContracted) {
      reasons.push(
        `Predicted miss distance decreased by >= 20% (${priorRange.toFixed(3)} km -> ${newRange.toFixed(3)} km)`,
      );
    }
    if (isImminenceCrossed) {
      reasons.push(
        `Time to TCA crossed under 24 hours (${priorHours.toFixed(1)} h -> ${newHours.toFixed(1)} h)`,
      );
    }

    const reasonSummary = `Fresh review required due to material prediction change: ${reasons.join('; ')}.`;

    await client.query(
      `UPDATE conjunction_events
       SET review_status = 'REQUIRES_RE_REVIEW', updated_at = NOW()
       WHERE id = $1;`,
      [event.id],
    );

    await appendAuditEntry(client, {
      eventId: event.id,
      actionType: 'RE_REVIEW_REQUIRED',
      actorType: 'SYSTEM',
      actorId: 'VOIDLINE_ENGINE',
      payload: {
        previousReviewStatus: event.review_status,
        priorUrgency: priorAssessment.urgency_level,
        newUrgency: newAssessmentResult.urgencyLevel,
        priorRangeKm: priorRange,
        newRangeKm: newRange,
        observationId: observation.id,
        reasons,
        reasonSummary,
      },
    });

    return true;
  }

  return false;
}
