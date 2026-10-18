/**
 * @fileoverview Deterministic Demo Fixture Seeder for Europa
 *
 * Populates the local development database (europa_dev) with realistic
 * multi-snapshot satellite encounters, assessment evaluations, operator review
 * decisions, and persisted SGP4 orbital encounter screening records.
 *
 * Safe for development and browser verification. Does not touch production.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestSnapshot } from '../src/modules/ingestion/ingestionService.js';
import { recordReview } from '../src/modules/review/reviewService.js';
import { runEncounterScreening } from '../src/modules/propagation/propagationService.js';
import { query, closePool } from '../src/db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../test/fixtures');

export async function seedDemoData() {
  console.log('[Europa Seeder] Initializing demo data in local database...');

  const baselineFixture = path.join(FIXTURES_DIR, 'synthetic_scenario_1_baseline.csv');
  const tighteningFixture = path.join(FIXTURES_DIR, 'synthetic_scenario_2_tightening.csv');
  const realSampleFixture = path.join(FIXTURES_DIR, 'socrates_real_sample.csv');

  // Ingest Snapshot 1 (Baseline)
  const snap1 = await ingestSnapshot(baselineFixture, {
    sourceUri: 'file://' + baselineFixture,
    screeningScope: 'LOCAL_FIXTURE',
    capturedAt: new Date(Date.now() - 3600000 * 4),
  });
  console.log(
    `[Europa Seeder] Ingested Snapshot 1 (Baseline): batch ${snap1.batchId}, created ${snap1.correlation?.eventsCreated || 0} events`,
  );

  // Ingest Snapshot 2 (Tightening update)
  const snap2 = await ingestSnapshot(tighteningFixture, {
    sourceUri: 'file://' + tighteningFixture,
    screeningScope: 'LOCAL_FIXTURE',
    capturedAt: new Date(Date.now() - 3600000 * 2),
  });
  console.log(
    `[Europa Seeder] Ingested Snapshot 2 (Tightening): batch ${snap2.batchId}, matched ${snap2.correlation?.eventsMatched || 0} events`,
  );

  // Ingest Snapshot 3 (Real SOCRATES sample)
  const snap3 = await ingestSnapshot(realSampleFixture, {
    sourceUri: 'file://' + realSampleFixture,
    screeningScope: 'LOCAL_FIXTURE',
    capturedAt: new Date(Date.now() - 3600000),
  });
  console.log(
    `[Europa Seeder] Ingested Snapshot 3 (Real SOCRATES): batch ${snap3.batchId}, created ${snap3.correlation?.eventsCreated || 0} events`,
  );

  // Find the event with closest miss distance to review and screen
  const criticalEventRes = await query(
    `SELECT id, canonical_pair_key, latest_tca, latest_range_km, urgency_level
     FROM conjunction_events
     ORDER BY latest_range_km ASC
     LIMIT 1;`,
  );

  if (criticalEventRes.rows.length > 0) {
    const event = criticalEventRes.rows[0];
    console.log(
      `[Europa Seeder] Selected event ${event.id} (${event.canonical_pair_key}, Range: ${event.latest_range_km} km, Urgency: ${event.urgency_level}) for review and SGP4 propagation`,
    );

    // Record operator review decision
    await recordReview(event.id, {
      action: 'ESCALATE',
      justification:
        'Conjunction encounter range tightened under screening threshold. Escalated to flight dynamics team for orbital screening and manoeuvre evaluation.',
      actorId: 'flight-director-alpha',
    });
    console.log(`[Europa Seeder] Recorded 'ESCALATE' operator decision for event ${event.id}`);

    // Run and persist SGP4 encounter screening
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
  }

  // Also acknowledge another event so we have diverse review states (UNREVIEWED, ESCALATED, UNDER_REVIEW)
  const secondEventRes = await query(
    `SELECT id, canonical_pair_key, latest_range_km
     FROM conjunction_events
     WHERE urgency_level IN ('HIGH', 'MEDIUM')
     ORDER BY latest_range_km ASC
     LIMIT 1;`,
  );

  if (
    secondEventRes.rows.length > 0 &&
    secondEventRes.rows[0].id !== criticalEventRes.rows[0]?.id
  ) {
    const secondEvent = secondEventRes.rows[0];
    await recordReview(secondEvent.id, {
      action: 'ACKNOWLEDGE',
      justification:
        'Conjunction geometry acknowledged by orbital safety watch officer. Monitoring successive ephemeris updates.',
      actorId: 'operator-bravo',
    });
    console.log(
      `[Europa Seeder] Recorded 'ACKNOWLEDGE' operator decision for event ${secondEvent.id}`,
    );
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
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedDemoData()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async err => {
      console.error('[Europa Seeder] Failed to seed demo data:', err);
      await closePool();
      process.exit(1);
    });
}
