/**
 * @fileoverview Operator Authentication Middleware
 *
 * Enforces API key authentication on write operations (ingestion, reviews).
 * Read-only operations remain publicly accessible for analysis and inspection.
 */

import crypto from 'node:crypto';
import { config } from '../../config/env.js';

/**
 * Performs a constant-time equality check on two secret strings by comparing
 * their fixed-length SHA-256 digests.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0) {
    return false;
  }
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

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

  const expectedKey = config.operatorApiKey;
  let isAuthorized = false;

  if (expectedKey && safeCompare(providedKey, expectedKey)) {
    isAuthorized = true;
  } else if (!config.isProduction) {
    // Development / non-production convenience fallbacks
    if (
      safeCompare(providedKey, 'europa-dev-key') ||
      safeCompare(providedKey, 'voidline-dev-key') ||
      (config.isTest && safeCompare(providedKey, 'test-operator-key'))
    ) {
      isAuthorized = true;
    }
  }

  if (!isAuthorized) {
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
