/**
 * @fileoverview Operator Authentication Middleware
 *
 * Enforces API key authentication on write operations (ingestion, reviews).
 * Read-only operations remain publicly accessible for analysis and inspection.
 */

import { config } from '../../config/env.js';

/**
 * Middleware ensuring write requests carry a valid operator API key.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireOperatorAuth(req, res, next) {
  const headerKey = req.headers['x-api-key'];
  const authHeader = req.headers['authorization'];

  let providedKey = null;
  if (headerKey && typeof headerKey === 'string') {
    providedKey = headerKey.trim();
  } else if (authHeader && typeof authHeader === 'string') {
    if (authHeader.startsWith('Bearer ')) {
      providedKey = authHeader.slice(7).trim();
    }
  }

  if (!providedKey) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message:
          'Operator authentication required for write operations. Provide a valid X-API-Key or Bearer token header.',
      },
    });
  }

  if (providedKey !== config.operatorApiKey) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Invalid operator API key provided.',
      },
    });
  }

  // Attach verified operator context
  req.actorId = (req.headers['x-actor-id'] || 'operator').toString().trim();
  return next();
}
