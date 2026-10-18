/**
 * @fileoverview Express Application Factory
 *
 * Configures Express with request parsing, request logging, modular routing,
 * static asset serving for the analytical web workbench, 404 fallback handling,
 * and centralized error middleware.
 * Exports createApp() without starting a listening server to enable automated API testing.
 */

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v1Router } from './api/router.js';
import { requestLogger } from './api/middlewares/requestLogger.js';
import { errorHandler } from './api/middlewares/errorHandler.js';
import { securityHeaders } from './api/middlewares/securityHeaders.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');

/**
 * Creates and configures the Europa Express application.
 *
 * @returns {import('express').Express}
 */
export function createApp() {
  const app = express();

  // Disable 'x-powered-by' header to prevent leaking framework fingerprint
  app.disable('x-powered-by');

  // Enforce baseline HTTP security headers
  app.use(securityHeaders);

  // Request body parsing with strict size limits
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Sanitized request access logging
  app.use(requestLogger);

  // Mount API v1 router first so API calls are never intercepted by static handlers
  app.use('/api/v1', v1Router);

  // Serve static assets from public/ directory
  app.use(express.static(publicDir));

  // Client-side SPA routing fallback for non-API GET requests
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(publicDir, 'index.html'));
    }
    next();
  });

  // 404 handler for unmatched routes (e.g. invalid API paths or methods)
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
