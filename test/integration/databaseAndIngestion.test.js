/**
 * @fileoverview Phase 1 Integration Tests: PostgreSQL Schema, Migrations, and Ingestion Pipeline
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getPool, query, closePool } from '../../src/db/pool.js';
import { applyMigrations, getMigrationStatus } from '../../src/db/migrator.js';
import { ingestSnapshot } from '../../src/modules/ingestion/ingestionService.js';
import { getTestConfig, resetTestDatabase } from '../helpers/dbCleanup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '../fixtures');

describe('Phase 1 Integration: Database and Ingestion Pipeline', () => {
  const config = getTestConfig();

  beforeAll(async () => {
    getPool(config.databaseUrl);
    // Ensure test database is migrated
    await applyMigrations({ connectionString: config.databaseUrl });
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async () => {
    await resetTestDatabase(config.databaseUrl);
  });

  describe('Migration System Verification', () => {
    it('records migrations in schema_migrations and executes idempotently on rerun', async () => {
      const status = await getMigrationStatus({ connectionString: config.databaseUrl });
      expect(status.length).toBeGreaterThan(0);
      expect(status[0].name).toBe('001_phase1_initial_schema.sql');
      expect(status[0].applied).toBe(true);

      // Re-running applyMigrations must be idempotent
      const rerun = await applyMigrations({ connectionString: config.databaseUrl });
      expect(rerun.applied.length).toBe(0);
      expect(rerun.alreadyApplied).toContain('001_phase1_initial_schema.sql');
    });
  });

  describe('Snapshot Ingestion and Data Integrity', () => {
    it('accurately parses and persists real SOCRATES snapshot with all 11 columns', async () => {
      const realSamplePath = path.join(FIXTURES_DIR, 'socrates_real_sample.csv');

      const result = await ingestSnapshot(
        realSamplePath,
        {
          sourceUri: 'https://celestrak.org/SOCRATES/sort-minRange.csv',
          screeningScope: 'FULL_CATALOG_MINRANGE',
          capturedAt: '2026-10-18T06:00:00.000Z',
          httpLastModified: '2026-10-18T05:50:00.000Z',
        },
        { connectionString: config.databaseUrl },
      );

      expect(result.status).toBe('COMPLETED');
      expect(result.isDuplicate).toBe(false);
      expect(result.rowCount).toBe(4);
      expect(result.validCount).toBe(4);
      expect(result.errorCount).toBe(0);

      // Verify Ingestion Batch Record
      const batchRes = await query('SELECT * FROM ingestion_batches WHERE id = $1;', [
        result.batchId,
      ]);
      expect(batchRes.rows.length).toBe(1);
      const batch = batchRes.rows[0];
      expect(batch.screening_scope).toBe('FULL_CATALOG_MINRANGE');
      expect(batch.valid_count).toBe(4);
      expect(batch.status).toBe('COMPLETED');

      // Verify Space Objects (including 6-digit catalog ID 100283)
      const objRes = await query(
        'SELECT norad_cat_id, object_name, operational_status FROM space_objects ORDER BY norad_cat_id ASC;',
      );
      const catIds = objRes.rows.map(o => o.norad_cat_id);
      expect(catIds).toContain(15292); // Cosmos 1598
      expect(catIds).toContain(58006); // Starlink
      expect(catIds).toContain(100283); // 6-digit Starlink

      const obj6Digit = objRes.rows.find(o => o.norad_cat_id === 100283);
      expect(obj6Digit.object_name).toBe('STARLINK-37980');
      expect(obj6Digit.operational_status).toBe('OPERATIONAL');

      // Verify Raw Observations & Canonical Ordering
      const obsRes = await query(
        'SELECT * FROM raw_observations WHERE batch_id = $1 ORDER BY row_index ASC;',
        [result.batchId],
      );
      expect(obsRes.rows.length).toBe(4);

      const r1 = obsRes.rows[0];
      expect(r1.primary_norad_id).toBe(58006);
      expect(r1.secondary_norad_id).toBe(68000);
      expect(r1.canonical_pair_key).toBe('58006:68000');
      expect(parseFloat(r1.tca_range_km)).toBe(0.012);
      expect(parseFloat(r1.relative_speed_kms)).toBe(1.239);
      expect(parseFloat(r1.max_prob)).toBe(1.0);
      expect(parseFloat(r1.dilution_km)).toBe(0.0);
      expect(parseFloat(r1.dse_primary)).toBe(1.888);
      expect(parseFloat(r1.dse_secondary)).toBe(2.206);
    });

    it('enforces snapshot-level idempotency on repeated ingestion of identical capture', async () => {
      const realSamplePath = path.join(FIXTURES_DIR, 'socrates_real_sample.csv');
      const metadata = {
        sourceUri: 'https://celestrak.org/SOCRATES/sort-minRange.csv',
        capturedAt: '2026-10-18T06:00:00.000Z',
        httpLastModified: '2026-10-18T05:50:00.000Z',
      };

      // Ingest first time
      const firstRun = await ingestSnapshot(realSamplePath, metadata, {
        connectionString: config.databaseUrl,
      });
      expect(firstRun.status).toBe('COMPLETED');
      expect(firstRun.isDuplicate).toBe(false);

      const countBefore = await query('SELECT COUNT(*) FROM raw_observations;');

      // Ingest exact second time
      const secondRun = await ingestSnapshot(realSamplePath, metadata, {
        connectionString: config.databaseUrl,
      });
      expect(secondRun.status).toBe('DUPLICATE_IGNORED');
      expect(secondRun.isDuplicate).toBe(true);
      expect(secondRun.batchId).toBe(firstRun.batchId);

      // Verify row count remained untouched
      const countAfter = await query('SELECT COUNT(*) FROM raw_observations;');
      expect(countAfter.rows[0].count).toBe(countBefore.rows[0].count);
    });

    it('preserves multi-snapshot provenance when distinct captures contain identical observations', async () => {
      const realSamplePath = path.join(FIXTURES_DIR, 'socrates_real_sample.csv');

      // Capture 1: Ingested at 06:00 UTC
      const batch1 = await ingestSnapshot(
        realSamplePath,
        {
          sourceUri: 'https://celestrak.org/SOCRATES/sort-minRange.csv',
          capturedAt: '2026-10-18T06:00:00.000Z',
          httpLastModified: '2026-10-18T05:50:00.000Z',
        },
        { connectionString: config.databaseUrl },
      );
      expect(batch1.status).toBe('COMPLETED');

      // Capture 2: Ingested at 18:00 UTC with updated server Last-Modified
      const batch2 = await ingestSnapshot(
        realSamplePath,
        {
          sourceUri: 'https://celestrak.org/SOCRATES/sort-minRange.csv',
          capturedAt: '2026-10-18T18:00:00.000Z',
          httpLastModified: '2026-10-18T17:50:00.000Z',
        },
        { connectionString: config.databaseUrl },
      );
      expect(batch2.status).toBe('COMPLETED');
      expect(batch2.batchId).not.toBe(batch1.batchId);

      // Verify observations exist for BOTH batches without global hash collision
      const obsBatch1 = await query('SELECT COUNT(*) FROM raw_observations WHERE batch_id = $1;', [
        batch1.batchId,
      ]);
      const obsBatch2 = await query('SELECT COUNT(*) FROM raw_observations WHERE batch_id = $1;', [
        batch2.batchId,
      ]);

      expect(parseInt(obsBatch1.rows[0].count, 10)).toBe(4);
      expect(parseInt(obsBatch2.rows[0].count, 10)).toBe(4);

      const totalObs = await query('SELECT COUNT(*) FROM raw_observations;');
      expect(parseInt(totalObs.rows[0].count, 10)).toBe(8);
    });

    it('handles unmodified periodic poll without duplicating observations (SUPERSEDED_UNMODIFIED_POLL)', async () => {
      const realSamplePath = path.join(FIXTURES_DIR, 'socrates_real_sample.csv');

      const initialBatch = await ingestSnapshot(
        realSamplePath,
        {
          sourceUri: 'https://celestrak.org/SOCRATES/sort-minRange.csv',
          capturedAt: '2026-10-18T06:00:00.000Z',
          httpLastModified: '2026-10-18T05:50:00.000Z',
        },
        { connectionString: config.databaseUrl },
      );
      expect(initialBatch.status).toBe('COMPLETED');

      // Subsequent scheduled poll that discovers server content is identical
      const pollBatch = await ingestSnapshot(
        realSamplePath,
        {
          sourceUri: 'https://celestrak.org/SOCRATES/sort-minRange.csv',
          capturedAt: '2026-10-18T07:00:00.000Z',
          httpLastModified: '2026-10-18T05:50:00.000Z',
          isSubsequentPoll: true,
        },
        { connectionString: config.databaseUrl },
      );

      expect(pollBatch.status).toBe('SUPERSEDED_UNMODIFIED_POLL');
      expect(pollBatch.validCount).toBe(0);

      // Verify batch record was archived
      const batchRes = await query('SELECT * FROM ingestion_batches WHERE id = $1;', [
        pollBatch.batchId,
      ]);
      expect(batchRes.rows[0].status).toBe('SUPERSEDED_UNMODIFIED_POLL');

      // Verify total observations did not duplicate
      const totalObs = await query('SELECT COUNT(*) FROM raw_observations;');
      expect(parseInt(totalObs.rows[0].count, 10)).toBe(4);
    });

    it('records rejected rows in batch_errors and marks batch partially successful', async () => {
      const malformedSamplePath = path.join(FIXTURES_DIR, 'socrates_malformed_sample.csv');

      const result = await ingestSnapshot(
        malformedSamplePath,
        {
          sourceUri: 'test/fixtures/socrates_malformed_sample.csv',
          capturedAt: '2026-10-18T08:00:00.000Z',
        },
        { connectionString: config.databaseUrl },
      );

      expect(result.status).toBe('COMPLETED');
      expect(result.rowCount).toBe(6);
      expect(result.validCount).toBe(1);
      expect(result.errorCount).toBe(5);

      // Verify batch errors table
      const errRes = await query(
        'SELECT error_code, error_message, row_index FROM batch_errors WHERE batch_id = $1 ORDER BY row_index ASC;',
        [result.batchId],
      );
      expect(errRes.rows.length).toBe(5);
      const codes = errRes.rows.map(e => e.error_code);
      expect(codes).toContain('INVALID_NORAD_CAT_ID_1');
      expect(codes).toContain('INVALID_TCA_RANGE');
      expect(codes).toContain('INVALID_TCA');
      expect(codes).toContain('INVALID_MAX_PROB');
    });

    it('prevents accidental deletion of batches with active observations (ON DELETE RESTRICT)', async () => {
      const realSamplePath = path.join(FIXTURES_DIR, 'socrates_real_sample.csv');

      const result = await ingestSnapshot(
        realSamplePath,
        {},
        { connectionString: config.databaseUrl },
      );
      expect(result.status).toBe('COMPLETED');

      // Attempting to delete batch while observations exist must fail due to foreign key RESTRICT
      await expect(
        query('DELETE FROM ingestion_batches WHERE id = $1;', [result.batchId]),
      ).rejects.toThrow(/foreign key constraint/i);
    });
  });
});
