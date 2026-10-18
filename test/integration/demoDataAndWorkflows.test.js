/**
 * @fileoverview Integration Test Suite for Demo Data Seeding & Workflow State
 *
 * Verifies that the demo data seeder is:
 * 1. Safe: Fails-closed against production environments or databases.
 * 2. Deterministic & Idempotent: Can be run repeatedly without duplicating batches,
 *    events, reviews, or invalidating the cryptographic audit chain.
 * 3. Complete: Populates representative SSA workflows across triage, event evolution,
 *    operator reviews, and SGP4 orbital screening.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  seedDemoData,
  cleanDemoData,
  assertSafeDemoEnvironment,
} from '../../scripts/seedDemoData.js';
import { query, closePool } from '../../src/db/pool.js';
import { getTestConfig, resetTestDatabase } from '../helpers/dbCleanup.js';
import { verifyAuditLedger } from '../../src/modules/audit/auditLedger.js';

describe('Europa Demo Data Seeder & Workflow State', () => {
  let testConfig;

  beforeAll(async () => {
    testConfig = getTestConfig();
    await resetTestDatabase(testConfig.databaseUrl);
  });

  afterAll(async () => {
    await resetTestDatabase(testConfig.databaseUrl);
    await closePool();
  });

  describe('1. Production Safeguards', () => {
    it('refuses to seed when NODE_ENV is production', () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        expect(() =>
          assertSafeDemoEnvironment({
            isProduction: true,
            databaseUrl: 'postgresql://localhost:5432/europa_dev',
          }),
        ).toThrowError(/Refusing to seed demo data in a PRODUCTION environment/);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('refuses to seed when database URL targets a production database', () => {
      expect(() =>
        assertSafeDemoEnvironment({
          isProduction: false,
          databaseUrl: 'postgresql://analyst:secret@production-db.internal:5432/europa_prod',
        }),
      ).toThrowError(/appears to reference a PRODUCTION database/);
    });

    it('refuses to clean non-local database targets', async () => {
      await expect(
        cleanDemoData({
          connectionString: 'postgresql://remote.cloud.provider:5432/customer_db',
          env: {
            DATABASE_URL: 'postgresql://remote.cloud.provider:5432/customer_db',
            NODE_ENV: 'test',
          },
        }),
      ).rejects.toThrowError(/not a recognized local or test database/);
    });

    it('permits non-destructive seeding when ALLOW_HOSTED_DEMO_SEED is explicitly set', () => {
      const originalFlag = process.env.ALLOW_HOSTED_DEMO_SEED;
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        process.env.ALLOW_HOSTED_DEMO_SEED = 'true';
        expect(() =>
          assertSafeDemoEnvironment(
            {
              isProduction: true,
              databaseUrl: 'postgresql://hosted-db.cloud:5432/europa_prod',
            },
            false,
          ),
        ).not.toThrow();
      } finally {
        process.env.ALLOW_HOSTED_DEMO_SEED = originalFlag;
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('strictly forbids table cleanup even when ALLOW_HOSTED_DEMO_SEED is set', () => {
      const originalFlag = process.env.ALLOW_HOSTED_DEMO_SEED;
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        process.env.ALLOW_HOSTED_DEMO_SEED = 'true';
        expect(() =>
          assertSafeDemoEnvironment(
            {
              isProduction: true,
              databaseUrl: 'postgresql://hosted-db.cloud:5432/europa_prod',
            },
            true,
          ),
        ).toThrowError(/Refusing to clean or reset database tables in a PRODUCTION environment/);
      } finally {
        process.env.ALLOW_HOSTED_DEMO_SEED = originalFlag;
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('2. Deterministic Seeding & Idempotency', () => {
    it('seeds the initial dataset cleanly from an empty database', async () => {
      await cleanDemoData({ connectionString: testConfig.databaseUrl });

      const result = await seedDemoData({ connectionString: testConfig.databaseUrl });

      expect(result.success).toBe(true);
      expect(result.isIdempotentRun).toBe(false);
      expect(parseInt(result.totals.total_events, 10)).toBe(6);
      expect(parseInt(result.totals.total_observations, 10)).toBe(7);
      expect(parseInt(result.totals.total_batches, 10)).toBe(3);
      expect(parseInt(result.totals.total_audit_entries, 10)).toBe(17);
      expect(parseInt(result.totals.total_screenings, 10)).toBe(1);
    });

    it('maintains a cryptographically valid audit chain after initial seeding', async () => {
      const verification = await verifyAuditLedger();
      expect(verification.valid).toBe(true);
      expect(verification.totalEntries).toBe(17);
      expect(verification.error).toBeNull();
      expect(verification.failedAtSequence).toBeNull();
    });

    it('executing seedDemoData a second time is strictly idempotent', async () => {
      const secondRun = await seedDemoData({ connectionString: testConfig.databaseUrl });

      expect(secondRun.success).toBe(true);
      expect(secondRun.isIdempotentRun).toBe(true);

      // Verify counts remain unchanged
      expect(parseInt(secondRun.totals.total_events, 10)).toBe(6);
      expect(parseInt(secondRun.totals.total_observations, 10)).toBe(7);
      expect(parseInt(secondRun.totals.total_batches, 10)).toBe(3);
      expect(parseInt(secondRun.totals.total_audit_entries, 10)).toBe(17);
      expect(parseInt(secondRun.totals.total_screenings, 10)).toBe(1);
    });

    it('preserves audit chain continuity without gaps or duplicates on idempotent runs', async () => {
      const verification = await verifyAuditLedger();
      expect(verification.valid).toBe(true);
      expect(verification.totalEntries).toBe(17);
      expect(verification.error).toBeNull();
    });
  });

  describe('3. Multi-Observation History & Workflow Representation', () => {
    it('populates correlated observation history showing tightening miss distance', async () => {
      // Find event for synthetic pair 90001 & 90002
      const eventRes = await query(
        `SELECT id, canonical_pair_key, min_predicted_range_km, latest_range_km
         FROM conjunction_events
         WHERE canonical_pair_key = '90001:90002';`,
      );

      expect(eventRes.rows.length).toBe(1);
      const event = eventRes.rows[0];

      // Query correlated observations for this event
      const obsRes = await query(
        `SELECT ro.tca_range_km, ro.captured_at
         FROM event_observations eo
         JOIN raw_observations ro ON ro.id = eo.observation_id
         WHERE eo.event_id = $1
         ORDER BY ro.captured_at ASC;`,
        [event.id],
      );

      expect(obsRes.rows.length).toBe(2);

      // Verify the observations reflect tightening geometry over time (4.5 km -> 0.28 km)
      const ranges = obsRes.rows.map(o => parseFloat(o.tca_range_km));
      expect(ranges).toContain(4.5);
      expect(ranges).toContain(0.28);
      expect(parseFloat(event.min_predicted_range_km)).toBe(0.28);
    });

    it('populates diverse review states across seeded conjunction events', async () => {
      const statesRes = await query(`
        SELECT review_status, COUNT(*) as count
        FROM conjunction_events
        GROUP BY review_status;
      `);

      const statuses = statesRes.rows.map(r => r.review_status);
      expect(statuses).toContain('ESCALATED');
      expect(statuses).toContain('UNDER_REVIEW');
      expect(statuses).toContain('UNREVIEWED');
    });

    it('persists SGP4 orbital screening linked to the critical event', async () => {
      const screeningRes = await query(`
        SELECT os.*, ce.canonical_pair_key
        FROM orbital_screenings os
        JOIN conjunction_events ce ON os.event_id = ce.id
        LIMIT 1;
      `);

      expect(screeningRes.rows.length).toBe(1);
      const screening = screeningRes.rows[0];
      expect(screening.algorithm_version).toBe('SGP4_SIMPLIFIED_PERTURBATIONS_VALLADO');
      expect(parseFloat(screening.estimated_miss_distance_km)).toBeGreaterThan(0);
      expect(screening.primary_tle_line1).toMatch(/^1 \d{5}/);
      expect(screening.secondary_tle_line1).toMatch(/^1 \d{5}/);
    });

    it('clearly labels all seeded batches and observations with LOCAL_FIXTURE scope', async () => {
      const batchRes = await query(`
        SELECT DISTINCT screening_scope FROM ingestion_batches;
      `);
      expect(batchRes.rows.length).toBe(1);
      expect(batchRes.rows[0].screening_scope).toBe('LOCAL_FIXTURE');

      // Verify raw observations join to LOCAL_FIXTURE batches
      const obsScopeRes = await query(`
        SELECT DISTINCT ib.screening_scope
        FROM raw_observations ro
        JOIN ingestion_batches ib ON ro.batch_id = ib.id;
      `);
      expect(obsScopeRes.rows.length).toBe(1);
      expect(obsScopeRes.rows[0].screening_scope).toBe('LOCAL_FIXTURE');
    });
  });
});
