/**
 * @fileoverview Health and Readiness Route
 *
 * Exposes system liveness and database readiness checks without disclosing
 * database credentials or connection parameters.
 */

import { Router } from 'express';
import { getPool } from '../../db/pool.js';

export const healthRouter = Router();

healthRouter.get('/health', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query('SELECT 1 as ready;');

    if (result.rows.length === 0 || result.rows[0].ready !== 1) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database check did not return expected response.',
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        database: {
          status: 'ready',
        },
      },
    });
  } catch {
    return res.status(503).json({
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database readiness check failed.',
      },
    });
  }
});
