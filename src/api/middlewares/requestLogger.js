/**
 * @fileoverview Request Logging Middleware
 *
 * Emits clean, sanitized access logs without recording authorization credentials,
 * API keys, or uploaded payload content.
 */

import { config } from '../../config/env.js';

/**
 * Sanitized HTTP request logger.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requestLogger(req, res, next) {
  // In test mode, omit access logs unless explicitly set to debug
  if (config.isTest && config.logLevel !== 'debug') {
    return next();
  }

  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const elapsedNs = process.hrtime.bigint() - startTime;
    const elapsedMs = (Number(elapsedNs) / 1e6).toFixed(2);
    const timestamp = new Date().toISOString();

    console.log(
      `[${timestamp}] ${req.method} ${req.originalUrl || req.url} ${res.statusCode} ${elapsedMs}ms`,
    );
  });

  next();
}
