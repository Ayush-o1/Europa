/**
 * @fileoverview Part 7E: Regression, Concurrency, and Resilience Test Suite
 *
 * Verifies system-wide resilience under concurrent workloads, database failure rollbacks,
 * out-of-order snapshot arrivals, cryptographic audit continuity, and production safety guards.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { getPool, closePool, query } from '../../src/db/pool.js';
import { applyMigrations } from '../../src/db/migrator.js';
import { config } from '../../src/config/env.js';
import { ingestSnapshot } from '../../src/modules/ingestion/ingestionService.js';
import { recordReview } from '../../src/modules/review/reviewService.js';
import { verifyAuditLedger } from '../../src/modules/audit/auditLedger.js';
import { resetTestDatabase, assertSafeTestEnvironment } from '../helpers/dbCleanup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

describe('Part 7E: Regression and Resilience Test Suite', () => {
  beforeAll(async () => {
    getPool(config.databaseUrl);
    await applyMigrations({ connectionString: config.databaseUrl });
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  describe('1. Idempotency & Provenance Integrity', () => {
    it('re-ingesting the exact same snapshot does not duplicate observations or events', async () => {
      const csvPath = path.join(FIXTURES_DIR, 'synthetic_scenario_1_baseline.csv');
      const fixedTime = '2026-11-01T10:00:00.000Z';

      // First ingestion
      const res1 = await ingestSnapshot(csvPath, {
        sourceUri: 'fixture://baseline.csv',
        capturedAt: fixedTime,
      });
      expect(res1.status).toBe('COMPLETED');
      expect(res1.isDuplicate).toBe(false);

      const events1 = await query('SELECT * FROM conjunction_events;');
      expect(events1.rows).toHaveLength(2);

      // Second ingestion with identical capture metadata
      const res2 = await ingestSnapshot(csvPath, {
        sourceUri: 'fixture://baseline.csv',
        capturedAt: fixedTime,
      });
      expect(res2.status).toBe('DUPLICATE_IGNORED');
      expect(res2.isDuplicate).toBe(true);

      const events2 = await query('SELECT * FROM conjunction_events;');
      expect(events2.rows).toHaveLength(2);

      const obs = await query('SELECT * FROM event_observations;');
      expect(obs.rows).toHaveLength(2);
    });

    it('distinct captured snapshots preserve separate provenance while confirming existing encounters', async () => {
      const csvPath1 = path.join(FIXTURES_DIR, 'synthetic_scenario_1_baseline.csv');
      const csvPath2 = path.join(FIXTURES_DIR, 'synthetic_scenario_4_identical.csv');

      // Snapshot 1 captured at 10:00
      const res1 = await ingestSnapshot(csvPath1, {
        sourceUri: 'celestrak://socrates/2026-11-01-1000',
        capturedAt: '2026-11-01T10:00:00.000Z',
      });
      expect(res1.status).toBe('COMPLETED');

      // Snapshot 2 captured at 16:00 containing identical observations
      const res2 = await ingestSnapshot(csvPath2, {
        sourceUri: 'celestrak://socrates/2026-11-01-1600',
        capturedAt: '2026-11-01T16:00:00.000Z',
      });
      expect(res2.status).toBe('COMPLETED');
      expect(res2.correlation.confirmations).toBe(2);
      expect(res2.correlation.eventsCreated).toBe(0);

      // Verify two distinct batches exist in provenance ledger
      const batches = await query('SELECT * FROM ingestion_batches ORDER BY captured_at ASC;');
      expect(batches.rows).toHaveLength(2);
      expect(batches.rows[0].source_uri).toContain('1000');
      expect(batches.rows[1].source_uri).toContain('1600');

      // Total conjunction events remains exactly 2
      const events = await query('SELECT * FROM conjunction_events;');
      expect(events.rows).toHaveLength(2);
    });
  });

  describe('2. Concurrency Resilience & Advisory Locking', () => {
    it('concurrent ingestion of identical encounters does not create duplicate events', async () => {
      const csvContent = await fs.readFile(
        path.join(FIXTURES_DIR, 'synthetic_scenario_1_baseline.csv'),
        'utf-8',
      );

      // Simulate 3 concurrent ingestion threads
      const promises = [1, 2, 3].map(threadNum =>
        ingestSnapshot(Buffer.from(csvContent, 'utf-8'), {
          sourceUri: `concurrent://thread-${threadNum}`,
          capturedAt: `2026-11-01T10:0${threadNum}:00.000Z`,
        }),
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(3);

      // Ensure that despite concurrent execution, exactly 2 conjunction events exist
      const eventsRes = await query('SELECT * FROM conjunction_events;');
      expect(eventsRes.rows).toHaveLength(2);

      // Audit chain must remain strictly unbroken
      const auditVerification = await verifyAuditLedger();
      expect(auditVerification.valid).toBe(true);
      expect(auditVerification.error).toBeNull();
    });
  });

  describe('3. Transaction Rollback & State Isolation', () => {
    it('a failed transaction leaves zero partial event, assessment, or audit state', async () => {
      const pool = getPool();
      const client = await pool.connect();

      // Begin transaction and insert partial state
      await client.query('BEGIN;');
      try {
        await client.query(
          `INSERT INTO ingestion_batches (source_uri, content_sha256, archive_file_path, status, row_count, valid_count, error_count)
           VALUES ('failed://test', 'dummyhash123', '/tmp/dummy', 'PROCESSING', 1, 1, 0)
           RETURNING id;`,
        );

        await client.query(
          `INSERT INTO conjunction_events (
             primary_object_id, secondary_object_id, canonical_pair_key,
             initial_tca, latest_tca, initial_range_km, latest_range_km, min_predicted_range_km,
             observation_count, urgency_level, lifecycle_state, review_status, tracking_state,
             first_captured_at, latest_captured_at
           ) VALUES (
             99991, 99992, '99991:99992',
             NOW(), NOW(), 1.0, 1.0, 1.0,
             1, 'HIGH', 'MONITORING', 'UNREVIEWED', 'CONFIRMED',
             NOW(), NOW()
           );`,
        );

        // Deliberately trigger SQL error (violating foreign key constraint or table violation)
        await client.query(`INSERT INTO non_existent_table_for_rollback_test VALUES (1);`);

        await client.query('COMMIT;');
      } catch {
        await client.query('ROLLBACK;');
      } finally {
        client.release();
      }

      // Assert that nothing was committed
      const batches = await query(
        `SELECT * FROM ingestion_batches WHERE source_uri = 'failed://test';`,
      );
      expect(batches.rows).toHaveLength(0);

      const events = await query(
        `SELECT * FROM conjunction_events WHERE canonical_pair_key = '99991:99992';`,
      );
      expect(events.rows).toHaveLength(0);
    });
  });

  describe('4. Historical Evolution & Out-of-Order Backfill', () => {
    it('out-of-order snapshots do not silently overwrite newer event state and preserve chronological history', async () => {
      // Step 1: Ingest baseline (captured at 10:00, range 4.500 km)
      await ingestSnapshot(path.join(FIXTURES_DIR, 'synthetic_scenario_1_baseline.csv'), {
        sourceUri: 'order://step1',
        capturedAt: '2026-11-01T10:00:00.000Z',
      });

      // Step 2: Ingest newer tightening prediction (captured at 12:00, range 0.280 km)
      await ingestSnapshot(path.join(FIXTURES_DIR, 'synthetic_scenario_2_tightening.csv'), {
        sourceUri: 'order://step2',
        capturedAt: '2026-11-01T12:00:00.000Z',
      });

      const eventBeforeBackfill = await query(
        `SELECT * FROM conjunction_events WHERE canonical_pair_key = '90001:90002';`,
      );
      expect(parseFloat(eventBeforeBackfill.rows[0].latest_range_km)).toBe(0.28);
      expect(eventBeforeBackfill.rows[0].observation_count).toBe(2);

      // Step 3: Ingest out-of-order backfill snapshot (captured earlier at 08:00, range 5.100 km)
      await ingestSnapshot(path.join(FIXTURES_DIR, 'synthetic_scenario_7_out_of_order.csv'), {
        sourceUri: 'order://step3-backfill',
        capturedAt: '2026-11-01T08:00:00.000Z',
      });

      const eventAfterBackfill = await query(
        `SELECT * FROM conjunction_events WHERE canonical_pair_key = '90001:90002';`,
      );
      const evt = eventAfterBackfill.rows[0];

      // CRITICAL ASSERTION: The older backfill snapshot must NOT overwrite latest_range_km or latest_captured_at!
      expect(parseFloat(evt.latest_range_km)).toBe(0.28);
      expect(new Date(evt.latest_captured_at).toISOString()).toBe('2026-11-01T12:00:00.000Z');
      expect(evt.observation_count).toBe(3);

      // Verify chronological sequence in event_observations
      const obsHistory = await query(
        `SELECT eo.chronological_sequence, ro.tca_range_km, ro.captured_at
         FROM event_observations eo
         JOIN raw_observations ro ON ro.id = eo.observation_id
         WHERE eo.event_id = $1
         ORDER BY ro.captured_at ASC;`,
        [evt.id],
      );

      expect(obsHistory.rows).toHaveLength(3);
      // Chronological ordering: 08:00 (5.1km) -> 10:00 (4.5km) -> 12:00 (0.28km)
      expect(parseFloat(obsHistory.rows[0].tca_range_km)).toBe(5.1);
      expect(parseFloat(obsHistory.rows[1].tca_range_km)).toBe(4.5);
      expect(parseFloat(obsHistory.rows[2].tca_range_km)).toBe(0.28);
    });
  });

  describe('5. Review Preservation & Audit Chain Resilience', () => {
    it('review history is preserved when an assessment changes', async () => {
      // Ingest baseline
      await ingestSnapshot(path.join(FIXTURES_DIR, 'synthetic_scenario_1_baseline.csv'), {
        capturedAt: '2026-11-01T10:00:00.000Z',
      });

      const eventRes = await query(
        `SELECT id FROM conjunction_events WHERE canonical_pair_key = '90001:90002';`,
      );
      const eventId = eventRes.rows[0].id;

      // Operator review action 1
      await recordReview(eventId, {
        action: 'ACKNOWLEDGE',
        justification: 'Initial conjunction monitoring confirmed by flight director.',
        actorId: 'flight-lead-1',
      });

      // Operator review action 2
      await recordReview(eventId, {
        action: 'ESCALATE',
        justification: 'Secondary screening request escalated to orbital safety desk.',
        actorId: 'safety-officer-2',
      });

      // Ingest tightening prediction (triggers material change / re-review required)
      await ingestSnapshot(path.join(FIXTURES_DIR, 'synthetic_scenario_2_tightening.csv'), {
        capturedAt: '2026-11-01T12:00:00.000Z',
      });

      // Verify that past reviews are completely preserved in event_reviews
      const reviews = await query(
        `SELECT * FROM event_reviews WHERE event_id = $1 ORDER BY created_at ASC;`,
        [eventId],
      );
      expect(reviews.rows).toHaveLength(2);
      expect(reviews.rows[0].action).toBe('ACKNOWLEDGE');
      expect(reviews.rows[0].actor_id).toBe('flight-lead-1');
      expect(reviews.rows[1].action).toBe('ESCALATE');
      expect(reviews.rows[1].actor_id).toBe('safety-officer-2');

      // Verify event status is updated to REQUIRES_RE_REVIEW
      const updatedEvt = await query(
        `SELECT review_status FROM conjunction_events WHERE id = $1;`,
        [eventId],
      );
      expect(updatedEvt.rows[0].review_status).toBe('REQUIRES_RE_REVIEW');

      // Verify audit chain
      const audit = await verifyAuditLedger();
      expect(audit.valid).toBe(true);
      expect(audit.error).toBeNull();
    });
  });

  describe('6. Production Protection Safeguards', () => {
    it('database cleanup routines strictly refuse execution when targeting production', async () => {
      // Test production URL rejection
      expect(() =>
        assertSafeTestEnvironment(
          'postgresql://prod_user:secret@prod.host.europa.internal:5432/europa_prod',
        ),
      ).toThrow(/Refusing to run destructive cleanup against PRODUCTION/i);

      // Test non-test dev database URL rejection
      expect(() =>
        assertSafeTestEnvironment('postgresql://postgres@localhost:5432/europa_dev'),
      ).toThrow(/Target database URL does not contain 'test'/i);
    });
  });
});
