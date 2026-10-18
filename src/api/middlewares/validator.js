/**
 * @fileoverview Centralized Request Validation Middleware and Utilities
 *
 * Enforces strict input validation on route parameters, query filters, pagination,
 * and request payloads with deterministic error responses.
 */

import { VALID_REVIEW_ACTIONS } from '../../modules/review/reviewService.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_URGENCIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const VALID_LIFECYCLE_STATES = new Set(['MONITORING', 'PAST_TCA', 'ARCHIVED']);
const VALID_TRACKING_STATES = new Set(['CONFIRMED', 'OMITTED_FROM_REPORT', 'AMBIGUOUS_MATCH']);
const VALID_REVIEW_STATUSES = new Set([
  'UNREVIEWED',
  'UNDER_REVIEW',
  'ESCALATED',
  'ACTION_TAKEN',
  'REQUIRES_RE_REVIEW',
  'DISMISSED',
  // Operational aliases from specification
  'MANOEUVRE_PLANNED',
  'MONITORING_ONLY',
]);

const ALLOWED_SORT_COLUMNS = new Map([
  ['tca', 'latest_tca'],
  ['latest_tca', 'latest_tca'],
  ['latest_captured_at', 'latest_captured_at'],
  ['miss_distance', 'latest_range_km'],
  ['latest_range_km', 'latest_range_km'],
  ['min_range', 'min_predicted_range_km'],
  ['min_predicted_range_km', 'min_predicted_range_km'],
  ['observations', 'observation_count'],
  ['observation_count', 'observation_count'],
  ['urgency', 'urgency_level'],
  ['urgency_level', 'urgency_level'],
  ['created_at', 'created_at'],
  ['updated_at', 'updated_at'],
]);

const ALLOWED_EVENT_QUERY_PARAMS = new Set([
  'page',
  'limit',
  'urgency',
  'lifecycleState',
  'lifecycle_state',
  'reviewStatus',
  'review_status',
  'trackingState',
  'tracking_state',
  'objectId',
  'noradId',
  'tcaFrom',
  'tcaTo',
  'missDistanceMax',
  'minRangeMax',
  'sortBy',
  'sortOrder',
]);

/**
 * Validates that a route parameter is a valid UUID.
 *
 * @param {string} paramName
 * @returns {import('express').RequestHandler}
 */
export function validateUuidParam(paramName = 'id') {
  return (req, res, next) => {
    const value = req.params[paramName];
    if (!value || !UUID_REGEX.test(value)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PARAMETER',
          message: `Parameter '${paramName}' must be a valid UUID. Received: '${value}'.`,
        },
      });
    }
    next();
  };
}

/**
 * Validates pagination query parameters.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function validatePagination(req, res, next) {
  let page = 1;
  let limit = 20;

  if (req.query.page !== undefined) {
    const parsedPage = Number(req.query.page);
    if (!Number.isInteger(parsedPage) || parsedPage < 1) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PAGINATION',
          message: `Query parameter 'page' must be a positive integer >= 1. Received: '${req.query.page}'.`,
        },
      });
    }
    page = parsedPage;
  }

  if (req.query.limit !== undefined) {
    const parsedLimit = Number(req.query.limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PAGINATION',
          message: `Query parameter 'limit' must be an integer between 1 and 100. Received: '${req.query.limit}'.`,
        },
      });
    }
    limit = parsedLimit;
  }

  req.pagination = {
    page,
    limit,
    offset: (page - 1) * limit,
  };

  next();
}

/**
 * Validates conjunction event query filters, sorting, and pagination.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function validateEventQueryParams(req, res, next) {
  // Reject any unrecognized query parameter to avoid silent misconfiguration
  const unknownParams = Object.keys(req.query).filter(k => !ALLOWED_EVENT_QUERY_PARAMS.has(k));
  if (unknownParams.length > 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_FILTER',
        message: `Unrecognized query parameter(s): ${unknownParams.join(', ')}. Allowed parameters: ${Array.from(ALLOWED_EVENT_QUERY_PARAMS).join(', ')}.`,
      },
    });
  }

  const filters = {};

  // Urgency filter
  if (req.query.urgency) {
    const urgency = String(req.query.urgency).toUpperCase().trim();
    if (!VALID_URGENCIES.has(urgency)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILTER',
          message: `Invalid urgency '${req.query.urgency}'. Allowed values: ${Array.from(VALID_URGENCIES).join(', ')}.`,
        },
      });
    }
    filters.urgency = urgency;
  }

  // Lifecycle state filter
  const rawLifecycle = req.query.lifecycleState || req.query.lifecycle_state;
  if (rawLifecycle) {
    const state = String(rawLifecycle).toUpperCase().trim();
    if (!VALID_LIFECYCLE_STATES.has(state)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILTER',
          message: `Invalid lifecycleState '${rawLifecycle}'. Allowed values: ${Array.from(VALID_LIFECYCLE_STATES).join(', ')}.`,
        },
      });
    }
    filters.lifecycleState = state;
  }

  // Review status filter
  const rawReviewStatus = req.query.reviewStatus || req.query.review_status;
  if (rawReviewStatus) {
    const status = String(rawReviewStatus).toUpperCase().trim();
    if (!VALID_REVIEW_STATUSES.has(status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILTER',
          message: `Invalid reviewStatus '${rawReviewStatus}'. Allowed values: ${Array.from(VALID_REVIEW_STATUSES).join(', ')}.`,
        },
      });
    }
    // Map operational aliases if provided
    if (status === 'MANOEUVRE_PLANNED') {
      filters.reviewStatus = 'ACTION_TAKEN';
    } else if (status === 'MONITORING_ONLY') {
      filters.reviewStatus = 'UNDER_REVIEW';
    } else {
      filters.reviewStatus = status;
    }
  }

  // Tracking state filter
  const rawTracking = req.query.trackingState || req.query.tracking_state;
  if (rawTracking) {
    const state = String(rawTracking).toUpperCase().trim();
    if (!VALID_TRACKING_STATES.has(state)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILTER',
          message: `Invalid trackingState '${rawTracking}'. Allowed values: ${Array.from(VALID_TRACKING_STATES).join(', ')}.`,
        },
      });
    }
    filters.trackingState = state;
  }

  // Object / NORAD ID filter
  const rawObjectId = req.query.objectId || req.query.noradId;
  if (rawObjectId !== undefined) {
    const objectId = Number(rawObjectId);
    if (!Number.isInteger(objectId) || objectId <= 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILTER',
          message: `Query parameter 'objectId'/'noradId' must be a positive integer. Received: '${rawObjectId}'.`,
        },
      });
    }
    filters.objectId = objectId;
  }

  // TCA Time Range
  if (req.query.tcaFrom) {
    const tcaFromMs = Date.parse(req.query.tcaFrom);
    if (Number.isNaN(tcaFromMs)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILTER',
          message: `Query parameter 'tcaFrom' must be a valid ISO 8601 date string. Received: '${req.query.tcaFrom}'.`,
        },
      });
    }
    filters.tcaFrom = new Date(tcaFromMs).toISOString();
  }

  if (req.query.tcaTo) {
    const tcaToMs = Date.parse(req.query.tcaTo);
    if (Number.isNaN(tcaToMs)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILTER',
          message: `Query parameter 'tcaTo' must be a valid ISO 8601 date string. Received: '${req.query.tcaTo}'.`,
        },
      });
    }
    filters.tcaTo = new Date(tcaToMs).toISOString();
  }

  if (filters.tcaFrom && filters.tcaTo && new Date(filters.tcaFrom) > new Date(filters.tcaTo)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_FILTER',
        message: `'tcaFrom' (${filters.tcaFrom}) cannot be later than 'tcaTo' (${filters.tcaTo}).`,
      },
    });
  }

  // Miss distance threshold
  const rawMissDistance = req.query.missDistanceMax || req.query.minRangeMax;
  if (rawMissDistance !== undefined) {
    const missDistance = Number(rawMissDistance);
    if (Number.isNaN(missDistance) || missDistance < 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILTER',
          message: `Query parameter 'missDistanceMax' must be a non-negative number. Received: '${rawMissDistance}'.`,
        },
      });
    }
    filters.missDistanceMax = missDistance;
  }

  // Sorting
  let sortByColumn = 'created_at';
  if (req.query.sortBy) {
    const normalizedSortBy = String(req.query.sortBy).toLowerCase().trim();
    if (!ALLOWED_SORT_COLUMNS.has(normalizedSortBy)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILTER',
          message: `Invalid sortBy '${req.query.sortBy}'. Allowed values: ${Array.from(ALLOWED_SORT_COLUMNS.keys()).join(', ')}.`,
        },
      });
    }
    sortByColumn = ALLOWED_SORT_COLUMNS.get(normalizedSortBy);
  }

  let sortOrder = 'DESC';
  if (req.query.sortOrder) {
    const normalizedOrder = String(req.query.sortOrder).toUpperCase().trim();
    if (normalizedOrder !== 'ASC' && normalizedOrder !== 'DESC') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILTER',
          message: `Invalid sortOrder '${req.query.sortOrder}'. Allowed values: 'ASC', 'DESC'.`,
        },
      });
    }
    sortOrder = normalizedOrder;
  }

  req.validatedFilters = filters;
  req.validatedSorting = {
    column: sortByColumn,
    order: sortOrder,
  };

  next();
}

/**
 * Validates request payload for operator review submission.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function validateReviewBody(req, res, next) {
  const { action, justification, actorId } = req.body || {};

  if (!action || typeof action !== 'string') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `Field 'action' is required and must be one of: ${VALID_REVIEW_ACTIONS.join(', ')}.`,
      },
    });
  }

  const normalizedAction = action.toUpperCase().trim();

  // Support operational aliases
  let targetAction = normalizedAction;
  if (targetAction === 'MANOEUVRE_PLANNED') {
    targetAction = 'ESCALATE';
  } else if (targetAction === 'MONITORING_ONLY') {
    targetAction = 'ACKNOWLEDGE';
  }

  if (!VALID_REVIEW_ACTIONS.includes(targetAction)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `Invalid review action '${action}'. Allowed actions: ${VALID_REVIEW_ACTIONS.join(', ')}.`,
      },
    });
  }

  if (!justification || typeof justification !== 'string' || justification.trim().length < 10) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'A meaningful review justification of at least 10 characters is required.',
      },
    });
  }

  const resolvedActorId = (actorId || req.actorId || 'operator').toString().trim();

  req.validatedReview = {
    action: targetAction,
    justification: justification.trim(),
    actorId: resolvedActorId,
  };

  next();
}

/**
 * Validates request body for SGP4 orbital propagation screening.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function validatePropagationBody(req, res, next) {
  const { primaryTle, secondaryTle, nominalTca, searchWindowMinutes, stepSeconds, eventId } =
    req.body || {};

  if (!primaryTle || typeof primaryTle !== 'object') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: "Field 'primaryTle' is required and must contain 'line1' and 'line2'.",
      },
    });
  }

  if (
    !primaryTle.line1 ||
    !primaryTle.line2 ||
    typeof primaryTle.line1 !== 'string' ||
    typeof primaryTle.line2 !== 'string'
  ) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: "Primary TLE 'line1' and 'line2' must be non-empty strings.",
      },
    });
  }

  if (!secondaryTle || typeof secondaryTle !== 'object') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: "Field 'secondaryTle' is required and must contain 'line1' and 'line2'.",
      },
    });
  }

  if (
    !secondaryTle.line1 ||
    !secondaryTle.line2 ||
    typeof secondaryTle.line1 !== 'string' ||
    typeof secondaryTle.line2 !== 'string'
  ) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: "Secondary TLE 'line1' and 'line2' must be non-empty strings.",
      },
    });
  }

  if (!nominalTca || typeof nominalTca !== 'string') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: "Field 'nominalTca' is required and must be an ISO-8601 date string.",
      },
    });
  }

  const parsedDate = new Date(nominalTca);
  if (Number.isNaN(parsedDate.getTime())) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `Field 'nominalTca' contains an invalid date string: "${nominalTca}".`,
      },
    });
  }

  if (searchWindowMinutes !== undefined) {
    const sw = Number(searchWindowMinutes);
    if (Number.isNaN(sw) || sw < 1 || sw > 60) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: "'searchWindowMinutes' must be a number between 1 and 60.",
        },
      });
    }
  }

  if (stepSeconds !== undefined) {
    const ss = Number(stepSeconds);
    if (Number.isNaN(ss) || ss < 1 || ss > 30) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: "'stepSeconds' must be a number between 1 and 30.",
        },
      });
    }
  }

  if (eventId !== undefined && eventId !== null) {
    if (typeof eventId !== 'string' || !UUID_REGEX.test(eventId)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Field 'eventId' must be a valid UUID. Received: "${eventId}".`,
        },
      });
    }
  }

  req.validatedPropagation = {
    primaryTle: {
      line1: primaryTle.line1.trim(),
      line2: primaryTle.line2.trim(),
    },
    secondaryTle: {
      line1: secondaryTle.line1.trim(),
      line2: secondaryTle.line2.trim(),
    },
    nominalTca: parsedDate.toISOString(),
    searchWindowMinutes: searchWindowMinutes ? Number(searchWindowMinutes) : 10,
    stepSeconds: stepSeconds ? Number(stepSeconds) : 5,
    eventId: eventId || null,
  };

  next();
}
