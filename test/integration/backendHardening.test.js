/**
 * @fileoverview Phase 3 Backend Engineering, Reliability & Security Hardening Tests
 *
 * Verifies:
 * 1. HTTP security headers on API responses.
 * 2. Timing-safe operator authentication and rejection of invalid/missing keys.
 * 3. Database transaction helper (withTransaction) commit and rollback guarantees.
 * 4. Input validation boundaries on parameters, query strings, and payloads.
 * 5. Applied migration 006 indexes verification in PostgreSQL catalog.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { query, closePool, withTransaction } from '../../src/db/pool.js';
import { safeCompare } from '../../src/api/middlewares/auth.js';
import { getTestConfig, resetTestDatabase } from '../helpers/dbCleanup.js';

describe('Phase 3: Backend Reliability & Security Hardening', () => {
  let app;
  const testConfig = getTestConfig();

  beforeAll(async () => {
    await resetTestDatabase();
    app = createApp();
  });

  afterAll(async () => {
    await closePool();
  });

  describe('1. HTTP Security Headers', () => {
    it('sets defense-in-depth security headers on all API endpoints', async () => {
      const res = await request(app).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-xss-protection']).toBe('0');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers['permissions-policy']).toContain('camera=()');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('2. Timing-Safe Authentication & Authorization Boundaries', () => {
    it('safeCompare evaluates string equality correctly in constant time', () => {
      expect(safeCompare('super-secret-key-123', 'super-secret-key-123')).toBe(true);
      expect(safeCompare('super-secret-key-123', 'wrong-key-456')).toBe(false);
      expect(safeCompare('', 'key')).toBe(false);
      expect(safeCompare(null, 'key')).toBe(false);
      expect(safeCompare('key', undefined)).toBe(false);
    });

    it('rejects unauthenticated write requests with 401 UNAUTHORIZED', async () => {
      const dummyId = '00000000-0000-0000-0000-000000000001';
      const res = await request(app).post(`/api/v1/events/${dummyId}/reviews`).send({
        action: 'ACKNOWLEDGE',
        justification: 'This is a test justification with sufficient length.',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects invalid operator API key with 403 FORBIDDEN', async () => {
      const dummyId = '00000000-0000-0000-0000-000000000001';
      const res = await request(app)
        .post(`/api/v1/events/${dummyId}/reviews`)
        .set('X-API-Key', 'invalid-attacker-key-1234')
        .send({
          action: 'ACKNOWLEDGE',
          justification: 'This is a test justification with sufficient length.',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('accepts valid operator key via Bearer token header', async () => {
      const dummyId = '00000000-0000-0000-0000-000000000001';
      // Passing a valid key should pass auth middleware (fails later at 404 because dummyId does not exist)
      const res = await request(app)
        .post(`/api/v1/events/${dummyId}/reviews`)
        .set('Authorization', `Bearer ${testConfig.operatorApiKey}`)
        .send({
          action: 'ACKNOWLEDGE',
          justification: 'This is a test justification with sufficient length.',
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('3. Database Transaction Manager (withTransaction)', () => {
    it('commits operations executed inside callback', async () => {
      await withTransaction(async client => {
        await client.query(`
          INSERT INTO space_objects (norad_cat_id, object_name, operational_status)
          VALUES (99991, 'TRANSACTION_TEST_SAT_1', 'OPERATIONAL')
          ON CONFLICT (norad_cat_id) DO UPDATE SET object_name = EXCLUDED.object_name;
        `);
      });

      const res = await query('SELECT * FROM space_objects WHERE norad_cat_id = 99991;');
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].object_name).toBe('TRANSACTION_TEST_SAT_1');
    });

    it('rolls back completely when callback throws error', async () => {
      const failedAction = withTransaction(async client => {
        await client.query(`
          INSERT INTO space_objects (norad_cat_id, object_name, operational_status)
          VALUES (99992, 'TRANSACTION_TEST_SAT_2', 'OPERATIONAL');
        `);
        throw new Error('Simulated transaction failure');
      });

      await expect(failedAction).rejects.toThrow('Simulated transaction failure');

      const res = await query('SELECT * FROM space_objects WHERE norad_cat_id = 99992;');
      expect(res.rows.length).toBe(0);
    });
  });

  describe('4. Input Validation Boundaries', () => {
    it('rejects invalid UUID route parameters with 400 INVALID_PARAMETER', async () => {
      const res = await request(app).get('/api/v1/events/not-a-valid-uuid');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_PARAMETER');
    });

    it('rejects invalid pagination limits (> 100) with 400 INVALID_PAGINATION', async () => {
      const res = await request(app).get('/api/v1/events?limit=500');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_PAGINATION');
    });

    it('rejects unrecognized query parameters with 400 INVALID_FILTER', async () => {
      const res = await request(app).get(
        '/api/v1/events?unknownDangerousParam=sqlInjectionAttempt',
      );

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_FILTER');
    });

    it('rejects review justifications shorter than 10 characters with 400 VALIDATION_ERROR', async () => {
      const dummyId = '00000000-0000-0000-0000-000000000001';
      const res = await request(app)
        .post(`/api/v1/events/${dummyId}/reviews`)
        .set('X-API-Key', testConfig.operatorApiKey)
        .send({
          action: 'ACKNOWLEDGE',
          justification: 'too short',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('5. Schema Migration 006 Index Verification', () => {
    it('verifies performance indexes exist in PostgreSQL schema catalog', async () => {
      const res = await query(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'idx_events_range',
            'idx_events_min_range',
            'idx_events_primary_obj',
            'idx_events_secondary_obj',
            'idx_batches_ingested_at'
          );
      `);

      const indexNames = res.rows.map(r => r.indexname);
      expect(indexNames).toContain('idx_events_range');
      expect(indexNames).toContain('idx_events_min_range');
      expect(indexNames).toContain('idx_events_primary_obj');
      expect(indexNames).toContain('idx_events_secondary_obj');
      expect(indexNames).toContain('idx_batches_ingested_at');
    });
  });
});
