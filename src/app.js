/**
 * @fileoverview Express Application Factory
 *
 * Configures Express with request parsing, request logging, modular routing,
 * 404 fallback handling, and centralized error middleware.
 * Exports createApp() without starting a listening server to enable automated API testing.
 */

import express from 'express';
import { v1Router } from './api/router.js';
import { requestLogger } from './api/middlewares/requestLogger.js';
import { errorHandler } from './api/middlewares/errorHandler.js';

/**
 * Creates and configures the Voidline Express application.
 *
 * @returns {import('express').Express}
 */
export function createApp() {
  const app = express();

  // Disable 'x-powered-by' header to prevent leaking framework fingerprint
  app.disable('x-powered-by');

  // Request body parsing with strict size limits
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Sanitized request access logging
  app.use(requestLogger);

  // Mount API v1 router
  app.use('/api/v1', v1Router);

  // 404 handler for unmatched routes
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route not found: ${req.method} ${req.originalUrl || req.url}`,
      },
    });
  });

  // Centralized error handling middleware
  app.use(errorHandler);

  return app;
}

export default createApp;
