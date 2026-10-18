/**
 * @fileoverview Ingestion REST Routes
 *
 * Exposes endpoints for uploading SOCRATES snapshots and inspecting ingestion batch history.
 * Protects snapshot uploads behind operator authentication.
 */

import { Router } from 'express';
import { getPool } from '../../db/pool.js';
import { ingestSnapshot } from '../../modules/ingestion/ingestionService.js';
import { requireOperatorAuth } from '../middlewares/auth.js';
import { uploadSnapshotCsv } from '../middlewares/upload.js';
import { validatePagination } from '../middlewares/validator.js';

export const ingestionRouter = Router();

/**
 * POST /ingest/snapshots
 * Upload and process a SOCRATES CSV snapshot file.
 */
ingestionRouter.post(
  '/ingest/snapshots',
  requireOperatorAuth,
  uploadSnapshotCsv.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_FILE',
            message: "A CSV snapshot file must be provided in the multipart 'file' field.",
          },
        });
      }

      const sourceUri = req.body?.sourceUri || req.file.originalname || 'upload://socrates.csv';
      const screeningScope = req.body?.screeningScope || 'LOCAL_FIXTURE';
      const capturedAt = req.body?.capturedAt || undefined;

      let queryParams = {};
      if (req.body?.queryParams) {
        if (typeof req.body.queryParams === 'string') {
          try {
            queryParams = JSON.parse(req.body.queryParams);
          } catch {
            return res.status(400).json({
              success: false,
              error: {
                code: 'INVALID_METADATA',
                message: "Metadata field 'queryParams' must be valid JSON.",
              },
            });
          }
        } else if (typeof req.body.queryParams === 'object') {
          queryParams = req.body.queryParams;
        }
      }

      const result = await ingestSnapshot(req.file.buffer, {
        sourceUri,
        screeningScope,
        capturedAt,
        queryParams,
      });

      const statusCode = result.isDuplicate ? 200 : 201;

      return res.status(statusCode).json({
        success: true,
        data: {
          batchId: result.batchId,
          status: result.status,
          isDuplicate: result.isDuplicate,
          rowCount: result.rowCount,
          validCount: result.validCount,
          errorCount: result.errorCount,
          correlation: result.correlation || null,
          message: result.message || undefined,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /ingest/batches
 * Retrieve paginated ingestion batch history without exposing server filesystem paths.
 */
ingestionRouter.get('/ingest/batches', validatePagination, async (req, res, next) => {
  try {
    const { page, limit, offset } = req.pagination;
    const pool = getPool();

    const countRes = await pool.query('SELECT COUNT(*) AS total FROM ingestion_batches;');
    const total = parseInt(countRes.rows[0].total, 10);

    const batchesRes = await pool.query(
      `SELECT id, source_uri, query_params, screening_scope, content_sha256,
              http_etag, http_last_modified, captured_at, ingested_at,
              row_count, valid_count, error_count, status, error_summary
       FROM ingestion_batches
       ORDER BY ingested_at DESC
       LIMIT $1 OFFSET $2;`,
      [limit, offset],
    );

    return res.status(200).json({
      success: true,
      data: batchesRes.rows,
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
