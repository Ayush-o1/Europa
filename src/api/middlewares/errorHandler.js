/**
 * @fileoverview Centralized Error Handling Middleware
 *
 * Catches application and framework errors, safely sanitizes database exceptions
 * to prevent leaking credentials or SQL queries, and maps errors to standard JSON envelopes.
 */

import multer from 'multer';
import { UnsupportedMediaTypeError } from './upload.js';
import { config } from '../../config/env.js';

/**
 * Express centralized error handler middleware.
 *
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
export function errorHandler(err, req, res, _next) {
  // 1. JSON parse errors from body-parser / express.json()
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MALFORMED_JSON',
        message: 'Invalid JSON payload received in request body.',
      },
    });
  }

  // 2. Multer upload errors
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Uploaded file exceeds the maximum allowed size limit of 10MB.',
        },
      });
    }
    return res.status(400).json({
      success: false,
      error: {
        code: 'UPLOAD_ERROR',
        message: err.message,
      },
    });
  }

  // 3. Unsupported file type (Multer filter)
  if (err instanceof UnsupportedMediaTypeError || err.statusCode === 415) {
    return res.status(415).json({
      success: false,
      error: {
        code: err.code || 'UNSUPPORTED_MEDIA_TYPE',
        message: err.message,
      },
    });
  }

  // 4. PostgreSQL error code translation
  // Prevents leaking SQL statements, column schemas, credentials, or connection details
  const pgCode = err.code || (err.cause && err.cause.code);
  if (typeof pgCode === 'string') {
    if (pgCode === '23505') {
      // unique_violation
      return res.status(409).json({
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'The requested resource already exists or conflicts with an existing record.',
        },
      });
    }

    if (pgCode === '23503') {
      // foreign_key_violation
      return res.status(400).json({
        success: false,
        error: {
          code: 'FOREIGN_KEY_VIOLATION',
          message: 'Referenced entity does not exist or cannot be associated.',
        },
      });
    }

    if (pgCode === '22P02') {
      // invalid_text_representation
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_DATA_FORMAT',
          message: 'Invalid data format provided for database query.',
        },
      });
    }

    if (pgCode.startsWith('08') || pgCode.startsWith('57P')) {
      // Connection or server failure
      return res.status(503).json({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Database service is currently unreachable. Please retry later.',
        },
      });
    }
  }

  // 5. Custom status codes on Error object
  const statusCode = err.statusCode || err.status || 500;

  if (statusCode === 404 || err.message?.toLowerCase().includes('not found')) {
    return res.status(404).json({
      success: false,
      error: {
        code: err.code || 'NOT_FOUND',
        message: err.message || 'Resource not found.',
      },
    });
  }

  if (statusCode < 500) {
    return res.status(statusCode).json({
      success: false,
      error: {
        code: err.code || 'CLIENT_ERROR',
        message: err.message,
      },
    });
  }

  // 6. Generic sanitized 500 Internal Server Error
  // Log internal error safely on the server
  if (!config.isTest) {
    console.error('[Internal Server Error]', {
      name: err.name,
      message: err.message,
      stack: err.stack,
    });
  }

  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal server error occurred.',
    },
  });
}
