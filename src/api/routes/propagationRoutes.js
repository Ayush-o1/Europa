/**
 * @fileoverview Orbital Propagation and SGP4 Encounter Estimation Routes
 *
 * Exposes endpoints for calculating relative encounter metrics, SGP4 trajectory propagation,
 * and querying persisted encounter screenings.
 */

import { Router } from 'express';
import {
  runEncounterScreening,
  getEventScreenings,
} from '../../modules/propagation/propagationService.js';
import { requireOperatorAuth } from '../middlewares/auth.js';
import { validateUuidParam, validatePropagationBody } from '../middlewares/validator.js';

export const propagationRouter = Router();

/**
 * Executes encounter estimation handling.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function handlePropagationEstimate(req, res, next) {
  try {
    const { primaryTle, secondaryTle, nominalTca, searchWindowMinutes, stepSeconds, eventId } =
      req.validatedPropagation;

    const actorId = req.actorId || req.headers['x-actor-id'] || 'operator';

    const result = await runEncounterScreening({
      primaryTle,
      secondaryTle,
      nominalTca,
      searchWindowMinutes,
      stepSeconds,
      eventId,
      actorId,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    if (
      err.message.includes('TLE validation failed') ||
      err.message.includes('Invalid') ||
      err.message.includes('propagation failed')
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PROPAGATION_ERROR',
          message: err.message,
        },
      });
    }
    if (err.message.includes('Conjunction event not found')) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: err.message,
        },
      });
    }
    return next(err);
  }
}

/**
 * POST /propagation/estimate
 * Calculates SGP4 encounter estimation between two TLEs around a nominal TCA.
 * If eventId is provided to persist the screening, requires operator authentication.
 */
propagationRouter.post('/propagation/estimate', validatePropagationBody, (req, res, next) => {
  if (req.validatedPropagation.eventId) {
    return requireOperatorAuth(req, res, () => handlePropagationEstimate(req, res, next));
  }
  return handlePropagationEstimate(req, res, next);
});

/**
 * GET /events/:id/propagation
 * Retrieves historical orbital propagation screenings for an encounter event.
 */
propagationRouter.get(
  '/events/:id/propagation',
  validateUuidParam('id'),
  async (req, res, next) => {
    try {
      const eventId = req.params.id;
      const screenings = await getEventScreenings(eventId);

      return res.status(200).json({
        success: true,
        data: {
          eventId,
          count: screenings.length,
          screenings,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);
