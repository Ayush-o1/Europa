/**
 * @fileoverview Conjunction Events REST Routes
 *
 * Implements endpoints for event discovery, filtering, chronological history,
 * versioned assessments, human operator review recording, and audit trails.
 */

import { Router } from 'express';
import { getPool } from '../../db/pool.js';
import {
  getEventAssessments,
  getLatestAssessment,
} from '../../modules/assessment/assessmentService.js';
import { recordReview, getEventReviews } from '../../modules/review/reviewService.js';
import { requireOperatorAuth } from '../middlewares/auth.js';
import {
  validateUuidParam,
  validatePagination,
  validateEventQueryParams,
  validateReviewBody,
} from '../middlewares/validator.js';

export const eventRouter = Router();

/**
 * GET /events
 * Paginated, filtered, and sorted query of conjunction events.
 */
eventRouter.get('/events', validatePagination, validateEventQueryParams, async (req, res, next) => {
  try {
    const { page, limit, offset } = req.pagination;
    const filters = req.validatedFilters;
    const sorting = req.validatedSorting;
    const pool = getPool();

    const whereConditions = [];
    const queryValues = [];
    let paramIdx = 1;

    if (filters.urgency) {
      whereConditions.push(`e.urgency_level = $${paramIdx++}`);
      queryValues.push(filters.urgency);
    }

    if (filters.lifecycleState) {
      whereConditions.push(`e.lifecycle_state = $${paramIdx++}`);
      queryValues.push(filters.lifecycleState);
    }

    if (filters.reviewStatus) {
      whereConditions.push(`e.review_status = $${paramIdx++}`);
      queryValues.push(filters.reviewStatus);
    }

    if (filters.trackingState) {
      whereConditions.push(`e.tracking_state = $${paramIdx++}`);
      queryValues.push(filters.trackingState);
    }

    if (filters.objectId) {
      whereConditions.push(
        `(e.primary_object_id = $${paramIdx} OR e.secondary_object_id = $${paramIdx})`,
      );
      paramIdx++;
      queryValues.push(filters.objectId);
    }

    if (filters.tcaFrom) {
      whereConditions.push(`e.latest_tca >= $${paramIdx++}`);
      queryValues.push(filters.tcaFrom);
    }

    if (filters.tcaTo) {
      whereConditions.push(`e.latest_tca <= $${paramIdx++}`);
      queryValues.push(filters.tcaTo);
    }

    if (filters.missDistanceMax !== undefined) {
      whereConditions.push(`e.latest_range_km <= $${paramIdx++}`);
      queryValues.push(filters.missDistanceMax);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Count query for pagination
    const countSql = `SELECT COUNT(*) AS total FROM conjunction_events e ${whereClause};`;
    const countRes = await pool.query(countSql, queryValues);
    const total = parseInt(countRes.rows[0].total, 10);

    // Data query with space object identities
    const dataSql = `
        SELECT e.id,
               e.primary_object_id,
               p.object_name AS primary_object_name,
               p.operational_status AS primary_operational_status,
               e.secondary_object_id,
               s.object_name AS secondary_object_name,
               s.operational_status AS secondary_operational_status,
               e.canonical_pair_key,
               e.initial_tca,
               e.initial_captured_at,
               e.latest_tca,
               e.latest_captured_at,
               e.latest_range_km,
               e.min_predicted_range_km,
               e.observation_count,
               e.lifecycle_state,
               e.urgency_level,
               e.review_status,
               e.tracking_state,
               e.created_at,
               e.updated_at
        FROM conjunction_events e
        JOIN space_objects p ON p.norad_cat_id = e.primary_object_id
        JOIN space_objects s ON s.norad_cat_id = e.secondary_object_id
        ${whereClause}
        ORDER BY e.${sorting.column} ${sorting.order}, e.id ASC
        LIMIT $${paramIdx++} OFFSET $${paramIdx++};
      `;

    const dataRes = await pool.query(dataSql, [...queryValues, limit, offset]);

    return res.status(200).json({
      success: true,
      data: dataRes.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /events/:id
 * Retrieve details of a single event, joined with space objects, latest assessment, and latest review.
 */
eventRouter.get('/events/:id', validateUuidParam('id'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    const eventRes = await pool.query(
      `SELECT e.id,
              e.primary_object_id,
              p.object_name AS primary_object_name,
              p.operational_status AS primary_operational_status,
              e.secondary_object_id,
              s.object_name AS secondary_object_name,
              s.operational_status AS secondary_operational_status,
              e.canonical_pair_key,
              e.initial_tca,
              e.initial_captured_at,
              e.latest_tca,
              e.latest_captured_at,
              e.latest_range_km,
              e.min_predicted_range_km,
              e.observation_count,
              e.lifecycle_state,
              e.urgency_level,
              e.review_status,
              e.tracking_state,
              e.created_at,
              e.updated_at
       FROM conjunction_events e
       JOIN space_objects p ON p.norad_cat_id = e.primary_object_id
       JOIN space_objects s ON s.norad_cat_id = e.secondary_object_id
       WHERE e.id = $1;`,
      [id],
    );

    if (eventRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Conjunction event '${id}' not found.`,
        },
      });
    }

    const event = eventRes.rows[0];

    // Latest observation for this event
    const obsRes = await pool.query(
      `SELECT ro.*
       FROM event_observations eo
       JOIN raw_observations ro ON ro.id = eo.observation_id
       WHERE eo.event_id = $1
       ORDER BY ro.captured_at DESC, eo.chronological_sequence DESC
       LIMIT 1;`,
      [id],
    );

    const latestObservation = obsRes.rows[0] || null;
    const latestAssessment = await getLatestAssessment(id);
    const reviews = await getEventReviews(id);
    const latestReview = reviews.length > 0 ? reviews[0] : null;

    return res.status(200).json({
      success: true,
      data: {
        event,
        latestObservation,
        latestAssessment,
        latestReview,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /events/:id/history
 * Chronological observation history with source provenance, ordering by snapshot chronology.
 */
eventRouter.get('/events/:id/history', validateUuidParam('id'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    // Verify event existence
    const existsRes = await pool.query('SELECT id FROM conjunction_events WHERE id = $1;', [id]);
    if (existsRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Conjunction event '${id}' not found.`,
        },
      });
    }

    // Chronological history ordered by captured_at ASC, chronological_sequence ASC
    const historyRes = await pool.query(
      `SELECT eo.chronological_sequence,
              eo.is_unchanged_confirmation,
              eo.correlated_at,
              ro.id AS observation_id,
              ro.batch_id,
              ro.row_index,
              ro.captured_at,
              ro.tca,
              ro.tca_range_km,
              ro.relative_speed_kms,
              ro.max_prob,
              ro.dilution_km,
              ro.dse_primary,
              ro.dse_secondary,
              ib.source_uri,
              ib.screening_scope
       FROM event_observations eo
       JOIN raw_observations ro ON ro.id = eo.observation_id
       JOIN ingestion_batches ib ON ib.id = ro.batch_id
       WHERE eo.event_id = $1
       ORDER BY ro.captured_at ASC, eo.chronological_sequence ASC;`,
      [id],
    );

    return res.status(200).json({
      success: true,
      data: historyRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /events/:id/assessments
 * Assessment history for an event in reverse chronological order.
 */
eventRouter.get('/events/:id/assessments', validateUuidParam('id'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    const existsRes = await pool.query('SELECT id FROM conjunction_events WHERE id = $1;', [id]);
    if (existsRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Conjunction event '${id}' not found.`,
        },
      });
    }

    const assessments = await getEventAssessments(id);

    return res.status(200).json({
      success: true,
      data: assessments,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /events/:id/assessments/latest
 * Return the current active assessment for an event.
 */
eventRouter.get(
  '/events/:id/assessments/latest',
  validateUuidParam('id'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const pool = getPool();

      const existsRes = await pool.query('SELECT id FROM conjunction_events WHERE id = $1;', [id]);
      if (existsRes.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `Conjunction event '${id}' not found.`,
          },
        });
      }

      const latestAssessment = await getLatestAssessment(id);

      if (!latestAssessment) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `No active assessment found for conjunction event '${id}'.`,
          },
        });
      }

      return res.status(200).json({
        success: true,
        data: latestAssessment,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /events/:id/reviews
 * Record a justified operator review decision. Protected by operator authentication.
 */
eventRouter.post(
  '/events/:id/reviews',
  requireOperatorAuth,
  validateUuidParam('id'),
  validateReviewBody,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const result = await recordReview(id, req.validatedReview);

      return res.status(201).json({
        success: true,
        data: {
          review: result.review,
          updatedEvent: result.updatedEvent,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /events/:id/audit
 * Paginated audit trail entries associated with a specific conjunction event.
 */
eventRouter.get(
  '/events/:id/audit',
  validateUuidParam('id'),
  validatePagination,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { page, limit, offset } = req.pagination;
      const pool = getPool();

      const existsRes = await pool.query('SELECT id FROM conjunction_events WHERE id = $1;', [id]);
      if (existsRes.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `Conjunction event '${id}' not found.`,
          },
        });
      }

      const countRes = await pool.query(
        'SELECT COUNT(*) AS total FROM audit_ledger WHERE event_id = $1;',
        [id],
      );
      const total = parseInt(countRes.rows[0].total, 10);

      const auditRes = await pool.query(
        `SELECT sequence_number, id, event_id, action_type, actor_type, actor_id,
                payload, prev_hash, entry_hash, created_at
         FROM audit_ledger
         WHERE event_id = $1
         ORDER BY sequence_number ASC
         LIMIT $2 OFFSET $3;`,
        [id, limit, offset],
      );

      return res.status(200).json({
        success: true,
        data: auditRes.rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);
