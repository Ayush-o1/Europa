/**
 * @fileoverview Deterministic Demo Fixture Seeder for Europa
 *
 * Populates the local development or test database with realistic
 * multi-snapshot satellite encounters, assessment evaluations, operator review
 * decisions, and persisted SGP4 orbital encounter screening records.
 *
 * Safe for local development and browser verification. Strictly refuses
 * execution against production environments or databases.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config/env.js';
import { ingestSnapshot } from '../src/modules/ingestion/ingestionService.js';
import { recordReview } from '../src/modules/review/reviewService.js';
import { runEncounterScreening } from '../src/modules/propagation/propagationService.js';
import { query, closePool } from '../src/db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../test/fixtures');

// Deterministic snapshot capture timestamps
export const DEMO_TIMESTAMPS = {
  SNAPSHOT_1_BASELINE: '2026-10-18T08:00:00.000Z',
  SNAPSHOT_2_TIGHTENING: '2026-10-18T10:00:00.000Z',
  SNAPSHOT_3_REAL_SOCRATES: '2026-10-18T11:00:00.000Z',
};

/**
 * Validates that the runtime environment is safe for demo data operations.
 * Throws a fatal Error if production environment or credentials are detected.
 * Pure non-destructive fixture seeding may be explicitly enabled for hosted demo
 * instances via ALLOW_HOSTED_DEMO_SEED=true. Destructive table cleanup is always forbidden.
 *
 * @param {ReturnType<typeof loadConfig>} config
 * @param {boolean} [isCleanOperation=false]
 */
export function assertSafeDemoEnvironment(config, isCleanOperation = false) {
  const isProduction = process.env.NODE_ENV === 'production' || config?.isProduction;
  const dbUrl = (config?.databaseUrl || process.env.DATABASE_URL || '').toLowerCase();
  const isProdDb = dbUrl.includes('prod') || dbUrl.includes('production');

  if (isCleanOperation) {
    if (isProduction) {
      throw new Error(
        '[Security Guard] Demo cleanup aborted: Refusing to clean or reset database tables in a PRODUCTION environment (NODE_ENV=production).',
      );
    }
    if (isProdDb) {
      throw new Error(
        '[Security Guard] Demo cleanup aborted: Target database URL appears to reference a PRODUCTION database.',
      );
    }
    return;
  }

  // Pure non-destructive demo fixture seeding
  const allowHostedDemoSeed = process.env.ALLOW_HOSTED_DEMO_SEED === 'true';

  if (isProduction && !allowHostedDemoSeed) {
    throw new Error(
      '[Security Guard] Demo seeder aborted: Refusing to seed demo data in a PRODUCTION environment (NODE_ENV=production) without explicit ALLOW_HOSTED_DEMO_SEED=true.',
    );
  }

  if (isProdDb && !allowHostedDemoSeed) {
    throw new Error(
      '[Security Guard] Demo seeder aborted: Target database URL appears to reference a PRODUCTION database without explicit ALLOW_HOSTED_DEMO_SEED=true.',
    );
  }
}

/**
 * Safely resets demo database tables in dependency order.
 * Restricted to local development and test databases.
 *
 * @param {object} [options={}]
 * @returns {Promise<void>}
 */
export async function cleanDemoData(options = {}) {
  const config = loadConfig(options.env);
  assertSafeDemoEnvironment(config, true);

  const dbUrl = (options.connectionString || config.databaseUrl || '').toLowerCase();
  const isLocalOrTest =
    dbUrl.includes('dev') ||
    dbUrl.includes('test') ||
    dbUrl.includes('localhost') ||
    dbUrl.includes('127.0.0.1');

  if (!isLocalOrTest && process.env.ALLOW_DEV_RESET !== 'true') {
    throw new Error(
      `[Security Guard] Demo cleanup aborted: Target database is not a recognized local or test database. URL: ${dbUrl}`,
    );
  }

  await query('TRUNCATE audit_ledger CASCADE;');
  await query('DELETE FROM orbital_screenings;');
  await query('DELETE FROM event_reviews;');
  await query('DELETE FROM event_assessments;');
  await query('DELETE FROM correlation_decisions;');
  await query('DELETE FROM event_observations;');
  await query('DELETE FROM conjunction_events;');
  await query('DELETE FROM batch_errors;');
  await query('DELETE FROM raw_observations;');
  await query('DELETE FROM space_objects;');
  await query('DELETE FROM ingestion_batches;');

  console.log('[Europa Seeder] Demo database tables reset cleanly.');
}

/**
 * Seeds deterministic demo fixtures into the configured local/test database.
 * Completely idempotent: successive runs detect existing records and skip mutations.
 *
 * @param {object} [options={}]
 * @param {string} [options.connectionString]
 * @param {Record<string, string>} [options.env]
 * @returns {Promise<{
 *   success: boolean,
 *   isIdempotentRun: boolean,
 *   totals: {
 *     total_events: string,
 *     total_observations: string,
 *     total_batches: string,
 *     total_audit_entries: string,
 *     total_screenings: string
 *   }
 * }>}
 */
export async function seedDemoData(options = {}) {
  const config = loadConfig(options.env);
  assertSafeDemoEnvironment(config);

  console.log('[Europa Seeder] Initializing demo data in local database...');

  const baselineFixture = path.join(FIXTURES_DIR, 'synthetic_scenario_1_baseline.csv');
  const tighteningFixture = path.join(FIXTURES_DIR, 'synthetic_scenario_2_tightening.csv');
  const realSampleFixture = path.join(FIXTURES_DIR, 'socrates_real_sample.csv');

  // Ingest Snapshot 1 (Baseline synthetic scenario)
  const snap1 = await ingestSnapshot(
    baselineFixture,
    {
      sourceUri: 'file://fixtures/synthetic_scenario_1_baseline.csv',
      screeningScope: 'LOCAL_FIXTURE',
      capturedAt: DEMO_TIMESTAMPS.SNAPSHOT_1_BASELINE,
    },
    options,
  );
  console.log(
    `[Europa Seeder] Snapshot 1 (Baseline): batch ${snap1.batchId} (${snap1.status}) - ${snap1.isDuplicate ? 'identical skipped' : 'ingested'}`,
  );

  // Ingest Snapshot 2 (Tightening update for synthetic pair)
  const snap2 = await ingestSnapshot(
    tighteningFixture,
    {
      sourceUri: 'file://fixtures/synthetic_scenario_2_tightening.csv',
      screeningScope: 'LOCAL_FIXTURE',
      capturedAt: DEMO_TIMESTAMPS.SNAPSHOT_2_TIGHTENING,
    },
    options,
  );
  console.log(
    `[Europa Seeder] Snapshot 2 (Tightening): batch ${snap2.batchId} (${snap2.status}) - ${snap2.isDuplicate ? 'identical skipped' : 'ingested'}`,
  );

  // Ingest Snapshot 3 (Real public SOCRATES sample)
  const snap3 = await ingestSnapshot(
    realSampleFixture,
    {
      sourceUri: 'file://fixtures/socrates_real_sample.csv',
      screeningScope: 'LOCAL_FIXTURE',
      capturedAt: DEMO_TIMESTAMPS.SNAPSHOT_3_REAL_SOCRATES,
    },
    options,
  );
  console.log(
    `[Europa Seeder] Snapshot 3 (Real SOCRATES): batch ${snap3.batchId} (${snap3.status}) - ${snap3.isDuplicate ? 'identical skipped' : 'ingested'}`,
  );

  const isIdempotentRun = Boolean(snap1.isDuplicate && snap2.isDuplicate && snap3.isDuplicate);

  // Find the event with closest miss distance to review and screen
  // Tie-breaker on canonical_pair_key ensures strictly deterministic event selection
  const criticalEventRes = await query(
    `SELECT id, canonical_pair_key, latest_tca, latest_range_km, urgency_level, review_status
     FROM conjunction_events
     ORDER BY latest_range_km ASC, canonical_pair_key ASC
     LIMIT 1;`,
  );

  if (criticalEventRes.rows.length > 0) {
    const event = criticalEventRes.rows[0];

    // Idempotent check: verify whether flight-director-alpha already reviewed this event
    const existingReview = await query(
      `SELECT id FROM event_reviews WHERE event_id = $1 AND actor_id = $2;`,
      [event.id, 'flight-director-alpha'],
    );

    if (existingReview.rows.length === 0) {
      await recordReview(
        event.id,
        {
          action: 'ESCALATE',
          justification:
            'Conjunction encounter range tightened under screening threshold. Escalated to flight dynamics team for orbital screening and manoeuvre evaluation.',
          actorId: 'flight-director-alpha',
        },
        options,
      );
      console.log(`[Europa Seeder] Recorded 'ESCALATE' operator decision for event ${event.id}`);
    } else {
      console.log(
        `[Europa Seeder] Review by flight-director-alpha already recorded for event ${event.id}; skipping.`,
      );
    }

    // Idempotent check: verify whether orbital screening is already persisted for this event
    const existingScreening = await query(
      `SELECT id FROM orbital_screenings WHERE event_id = $1;`,
      [event.id],
    );

    if (existingScreening.rows.length === 0) {
      const primaryTle = {
        line1: '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9009',
        line2: '2 25544  51.6400 208.9163 0004780  69.9862  25.2906 15.49815016431907',
      };
      const secondaryTle = {
        line1: '1 34454U 93036SX  24001.50000000  .00001234  00000-0  56789-4 0  9004',
        line2: '2 34454  74.0400 210.1234 0021500 120.4500  45.6700 14.85000000213455',
      };

      const screening = await runEncounterScreening({
        primaryTle,
        secondaryTle,
        nominalTca: event.latest_tca,
        searchWindowMinutes: 10,
        stepSeconds: 1,
        eventId: event.id,
        actorId: 'flight-director-alpha',
      });

      console.log(
        `[Europa Seeder] Persisted SGP4 screening: estimated miss distance ${screening.estimatedMissDistanceKm.toFixed(3)} km at ${screening.estimatedTca}`,
      );
    } else {
      console.log(
        `[Europa Seeder] SGP4 screening already persisted for event ${event.id}; skipping.`,
      );
    }
  }

  // Also acknowledge another event so we have diverse review states (UNREVIEWED, ESCALATED, UNDER_REVIEW)
  const secondEventRes = await query(
    `SELECT id, canonical_pair_key, latest_range_km
     FROM conjunction_events
     WHERE urgency_level IN ('HIGH', 'MEDIUM')
       AND id != $1
     ORDER BY latest_range_km ASC, canonical_pair_key ASC
     LIMIT 1;`,
    [criticalEventRes.rows[0]?.id || '00000000-0000-0000-0000-000000000000'],
  );

  if (secondEventRes.rows.length > 0) {
    const secondEvent = secondEventRes.rows[0];

    const existingSecondReview = await query(
      `SELECT id FROM event_reviews WHERE event_id = $1 AND actor_id = $2;`,
      [secondEvent.id, 'operator-bravo'],
    );

    if (existingSecondReview.rows.length === 0) {
      await recordReview(
        secondEvent.id,
        {
          action: 'ACKNOWLEDGE',
          justification:
            'Conjunction geometry acknowledged by orbital safety watch officer. Monitoring successive ephemeris updates.',
          actorId: 'operator-bravo',
        },
        options,
      );
      console.log(
        `[Europa Seeder] Recorded 'ACKNOWLEDGE' operator decision for event ${secondEvent.id}`,
      );
    } else {
      console.log(
        `[Europa Seeder] Review by operator-bravo already recorded for event ${secondEvent.id}; skipping.`,
      );
    }
  }

  const totals = await query(`
    SELECT
      (SELECT COUNT(*) FROM conjunction_events) AS total_events,
      (SELECT COUNT(*) FROM raw_observations) AS total_observations,
      (SELECT COUNT(*) FROM ingestion_batches) AS total_batches,
      (SELECT COUNT(*) FROM audit_ledger) AS total_audit_entries,
      (SELECT COUNT(*) FROM orbital_screenings) AS total_screenings;
  `);

  console.log('[Europa Seeder] Database seeded successfully:');
  console.table(totals.rows[0]);

  return {
    success: true,
    isIdempotentRun,
    totals: totals.rows[0],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isClean = process.argv.includes('--clean') || process.argv.includes('--reset');

  (async () => {
    try {
      if (isClean) {
        await cleanDemoData();
      }
      await seedDemoData();
      await closePool();
      process.exit(0);
    } catch (err) {
      console.error('[Europa Seeder] Error executing demo seeder:', err);
      await closePool();
      process.exit(1);
    }
  })();
}
