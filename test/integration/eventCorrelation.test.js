/**
 * @fileoverview Phase 2 Integration Tests: Conjunction Event Correlation Engine & Concurrency
 * Validates canonical pair matching, bounded drift, ambiguity handling, out-of-order data, and advisory locking.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { loadConfig } from '../../src/config/env.js';
import { getPool, query, closePool } from '../../src/db/pool.js';
import { applyMigrations } from '../../src/db/migrator.js';
import { ingestSnapshot } from '../../src/modules/ingestion/ingestionService.js';
import { reapPastTcaEvents } from '../../src/modules/lifecycle/lifecycleManager.js';

describe('Phase 2 Integration: Event Correlation Engine', () => {
  const config = loadConfig({ NODE_ENV: 'test' });

  beforeAll(async () => {
    getPool(config.databaseUrl);
    await applyMigrations({ connectionString: config.databaseUrl });
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async () => {
    await query('DELETE FROM event_assessments;');
    await query('DELETE FROM correlation_decisions;');
    await query('DELETE FROM event_observations;');
    await query('DELETE FROM conjunction_events;');
    await query('DELETE FROM batch_errors;');
    await query('DELETE FROM raw_observations;');
    await query('DELETE FROM space_objects;');
    await query('DELETE FROM ingestion_batches;');
  });

  it('1. First observation creates one new event', async () => {
    const csvContent =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS (ZARYA) [+],0.450,30580,FENGYUN 1C DEB [-],1.120,2026-10-21 14:30:15.000,4.820,14.820,1.100E-05,0.480\n';

    const res = await ingestSnapshot(
      csvContent,
      { sourceUri: 'test://run1' },
      { connectionString: config.databaseUrl },
    );
    expect(res.status).toBe('COMPLETED');
    expect(res.correlation.eventsCreated).toBe(1);

    const eventRes = await query('SELECT * FROM conjunction_events;');
    expect(eventRes.rows.length).toBe(1);
    const evt = eventRes.rows[0];
    expect(evt.canonical_pair_key).toBe('25544:30580');
    expect(evt.observation_count).toBe(1);
    expect(evt.lifecycle_state).toBe('MONITORING');
    expect(evt.tracking_state).toBe('CONFIRMED');

    const linkRes = await query('SELECT * FROM event_observations WHERE event_id = $1;', [evt.id]);
    expect(linkRes.rows.length).toBe(1);
    expect(linkRes.rows[0].chronological_sequence).toBe(1);
  });

  it('2. A later snapshot with a nearby TCA matches the same event', async () => {
    // Run 1: TCA 14:30:15
    const csv1 =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.450,30580,FENGYUN 1C [-],1.120,2026-10-21 14:30:15.000,4.820,14.820,1.100E-05,0.480\n';
    await ingestSnapshot(
      csv1,
      { sourceUri: 'test://run1', capturedAt: '2026-10-18T06:00:00Z' },
      { connectionString: config.databaseUrl },
    );

    // Run 2: TCA shifted by 4 seconds (14:30:11), miss distance dropped to 0.65 km
    const csv2 =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.850,30580,FENGYUN 1C [-],1.520,2026-10-21 14:30:11.000,0.650,14.825,2.410E-04,0.480\n';
    const res2 = await ingestSnapshot(
      csv2,
      { sourceUri: 'test://run2', capturedAt: '2026-10-18T18:00:00Z' },
      { connectionString: config.databaseUrl },
    );

    expect(res2.correlation.eventsMatched).toBe(1);
    expect(res2.correlation.eventsCreated).toBe(0);

    const eventRes = await query('SELECT * FROM conjunction_events;');
    expect(eventRes.rows.length).toBe(1);
    const evt = eventRes.rows[0];
    expect(evt.observation_count).toBe(2);
    expect(parseFloat(evt.latest_range_km)).toBe(0.65);
    expect(parseFloat(evt.min_predicted_range_km)).toBe(0.65);

    const links = await query(
      'SELECT * FROM event_observations WHERE event_id = $1 ORDER BY chronological_sequence ASC;',
      [evt.id],
    );
    expect(links.rows.length).toBe(2);
    expect(links.rows[0].chronological_sequence).toBe(1);
    expect(links.rows[1].chronological_sequence).toBe(2);
  });

  it('3. Reversed object ordering produces the same canonical object pair and matches event', async () => {
    // Run 1: listed as (25544, 30580)
    const csv1 =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.450,30580,FENGYUN 1C [-],1.120,2026-10-21 14:30:15.000,4.820,14.820,1.100E-05,0.480\n';
    await ingestSnapshot(
      csv1,
      { sourceUri: 'test://run1', capturedAt: '2026-10-18T06:00:00Z' },
      { connectionString: config.databaseUrl },
    );

    // Run 2: listed in reverse (30580, 25544)
    const csv2 =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '30580,FENGYUN 1C [-],1.520,25544,ISS [+],0.850,2026-10-21 14:30:12.000,3.100,14.820,1.500E-05,0.480\n';
    const res2 = await ingestSnapshot(
      csv2,
      { sourceUri: 'test://run2', capturedAt: '2026-10-18T18:00:00Z' },
      { connectionString: config.databaseUrl },
    );

    expect(res2.correlation.eventsMatched).toBe(1);
    expect(res2.correlation.eventsCreated).toBe(0);

    const eventRes = await query('SELECT * FROM conjunction_events;');
    expect(eventRes.rows.length).toBe(1);
    expect(eventRes.rows[0].canonical_pair_key).toBe('25544:30580');
    expect(eventRes.rows[0].observation_count).toBe(2);
  });

  it('4. Repeated identical snapshot ingestion produces no additional event or link', async () => {
    const csv =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.450,30580,FENGYUN 1C [-],1.120,2026-10-21 14:30:15.000,4.820,14.820,1.100E-05,0.480\n';

    const meta = { sourceUri: 'test://run1', capturedAt: '2026-10-18T06:00:00Z' };
    await ingestSnapshot(csv, meta, { connectionString: config.databaseUrl });

    // Repeated identical import
    const second = await ingestSnapshot(csv, meta, { connectionString: config.databaseUrl });
    expect(second.status).toBe('DUPLICATE_IGNORED');

    const eventRes = await query('SELECT COUNT(*) FROM conjunction_events;');
    const linkRes = await query('SELECT COUNT(*) FROM event_observations;');
    const decRes = await query('SELECT COUNT(*) FROM correlation_decisions;');

    expect(parseInt(eventRes.rows[0].count, 10)).toBe(1);
    expect(parseInt(linkRes.rows[0].count, 10)).toBe(1);
    expect(parseInt(decRes.rows[0].count, 10)).toBe(1);
  });

  it('5. Identical prediction in a distinct later capture preserves independent provenance as confirmation', async () => {
    const csv =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.450,30580,FENGYUN 1C [-],1.120,2026-10-21 14:30:15.000,4.820,14.820,1.100E-05,0.480\n';

    await ingestSnapshot(
      csv,
      {
        sourceUri: 'test://run1',
        capturedAt: '2026-10-18T06:00:00Z',
        httpLastModified: '2026-10-18T05:00:00Z',
      },
      { connectionString: config.databaseUrl },
    );

    // Capture 2: Distinct capture at 18:00 with updated Last-Modified, but CelesTrak prediction is unchanged
    const res2 = await ingestSnapshot(
      csv,
      {
        sourceUri: 'test://run2',
        capturedAt: '2026-10-18T18:00:00Z',
        httpLastModified: '2026-10-18T17:00:00Z',
      },
      { connectionString: config.databaseUrl },
    );

    expect(res2.correlation.confirmations).toBe(1);

    const eventRes = await query('SELECT * FROM conjunction_events;');
    expect(eventRes.rows[0].observation_count).toBe(2);

    const linkRes = await query(
      'SELECT * FROM event_observations ORDER BY chronological_sequence ASC;',
    );
    expect(linkRes.rows.length).toBe(2);
    expect(linkRes.rows[0].is_unchanged_confirmation).toBe(false);
    expect(linkRes.rows[1].is_unchanged_confirmation).toBe(true);

    const decisions = await query(
      'SELECT decision_type FROM correlation_decisions ORDER BY created_at ASC;',
    );
    expect(decisions.rows[0].decision_type).toBe('EVENT_CREATED');
    expect(decisions.rows[1].decision_type).toBe('UNCHANGED_CONFIRMATION');
  });

  it('6. Separate encounters for the same pair, sufficiently far apart (e.g. 24h), produce separate events', async () => {
    // Pass 1: Conjunction on Oct 21 at 14:30
    const csv1 =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.450,30580,FENGYUN 1C [-],1.120,2026-10-21 14:30:00.000,4.820,14.820,1.100E-05,0.480\n';
    await ingestSnapshot(
      csv1,
      { sourceUri: 'test://run1', capturedAt: '2026-10-18T06:00:00Z' },
      { connectionString: config.databaseUrl },
    );

    // Pass 2: Conjunction between same objects 24 hours later (Oct 22 at 14:30)
    const csv2 =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],1.450,30580,FENGYUN 1C [-],2.120,2026-10-22 14:30:00.000,2.150,14.810,3.500E-05,0.480\n';
    const res2 = await ingestSnapshot(
      csv2,
      { sourceUri: 'test://run2', capturedAt: '2026-10-18T18:00:00Z' },
      { connectionString: config.databaseUrl },
    );

    expect(res2.correlation.eventsCreated).toBe(1);
    expect(res2.correlation.eventsMatched).toBe(0);

    const eventRes = await query('SELECT * FROM conjunction_events ORDER BY initial_tca ASC;');
    expect(eventRes.rows.length).toBe(2);
    expect(eventRes.rows[0].id).not.toBe(eventRes.rows[1].id);
    expect(eventRes.rows[0].canonical_pair_key).toBe('25544:30580');
    expect(eventRes.rows[1].canonical_pair_key).toBe('25544:30580');
  });

  it('7. Predictions that drift gradually within both configured bounds remain correlated', async () => {
    // Step 1: Base TCA 14:00
    const csv1 =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-21 14:00:00.000,5.0,14.0,1.0E-05,0.5\n';
    await ingestSnapshot(
      csv1,
      { sourceUri: 'test://run1', capturedAt: '2026-10-18T00:00:00Z' },
      { connectionString: config.databaseUrl },
    );

    // Step 2: TCA drifts by +5m (14:05) -> step drift 5m, cum drift 5m
    const csv2 =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-21 14:05:00.000,3.0,14.0,1.0E-05,0.5\n';
    await ingestSnapshot(
      csv2,
      { sourceUri: 'test://run2', capturedAt: '2026-10-18T06:00:00Z' },
      { connectionString: config.databaseUrl },
    );

    // Step 3: TCA drifts by another +5m (14:10) -> step drift 5m, cum drift 10m
    const csv3 =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-21 14:10:00.000,1.2,14.0,1.0E-05,0.5\n';
    const res3 = await ingestSnapshot(
      csv3,
      { sourceUri: 'test://run3', capturedAt: '2026-10-18T12:00:00Z' },
      { connectionString: config.databaseUrl },
    );

    expect(res3.correlation.eventsMatched).toBe(1);

    const eventRes = await query('SELECT * FROM conjunction_events;');
    expect(eventRes.rows.length).toBe(1);
    expect(eventRes.rows[0].observation_count).toBe(3);
    expect(new Date(eventRes.rows[0].initial_tca).toISOString()).toBe('2026-10-21T14:00:00.000Z');
    expect(new Date(eventRes.rows[0].latest_tca).toISOString()).toBe('2026-10-21T14:10:00.000Z');
  });

  it('8. Observation that breaches step tolerance but remains within cumulative window is handled explicitly as AMBIGUOUS_MATCH', async () => {
    // Initial prediction at 14:00
    const csv1 =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-21 14:00:00.000,5.0,14.0,1.0E-05,0.5\n';
    await ingestSnapshot(
      csv1,
      { sourceUri: 'test://run1', capturedAt: '2026-10-18T00:00:00Z' },
      { connectionString: config.databaseUrl },
    );

    // Step drift jump of 25 minutes (14:25): > 20m step tolerance, but <= 45m cumulative ceiling
    const csv2 =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-21 14:25:00.000,2.0,14.0,1.0E-05,0.5\n';
    const res2 = await ingestSnapshot(
      csv2,
      { sourceUri: 'test://run2', capturedAt: '2026-10-18T06:00:00Z' },
      { connectionString: config.databaseUrl },
    );

    expect(res2.correlation.ambiguousMatches).toBe(1);
    expect(res2.correlation.eventsCreated).toBe(0);
    expect(res2.correlation.eventsMatched).toBe(0);

    // Event tracking state updated to AMBIGUOUS_MATCH
    const eventRes = await query(
      'SELECT tracking_state, observation_count FROM conjunction_events;',
    );
    expect(eventRes.rows[0].tracking_state).toBe('AMBIGUOUS_MATCH');
    expect(eventRes.rows[0].observation_count).toBe(1); // Not blindly merged!

    // Decision logged with reason
    const decRes = await query('SELECT * FROM correlation_decisions WHERE decision_type = $1;', [
      'AMBIGUOUS_MATCH',
    ]);
    expect(decRes.rows.length).toBe(1);
    expect(decRes.rows[0].decision_reason).toContain('exceeds step tolerance');
  });

  it('9. Observation exceeding cumulative ceiling is not automatically merged', async () => {
    // Initial at 14:00
    const csv1 =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-21 14:00:00.000,5.0,14.0,1.0E-05,0.5\n';
    await ingestSnapshot(
      csv1,
      { sourceUri: 'test://run1', capturedAt: '2026-10-18T00:00:00Z' },
      { connectionString: config.databaseUrl },
    );

    // Advance latest to 14:40
    await query("UPDATE conjunction_events SET latest_tca = '2026-10-21 14:40:00.000Z';");

    // New observation at 14:50 (+10m step from 14:40 <= 20m, BUT +50m cumulative from 14:00 > 45m ceiling)
    const csv2 =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-21 14:50:00.000,1.0,14.0,1.0E-05,0.5\n';
    const res2 = await ingestSnapshot(
      csv2,
      { sourceUri: 'test://run2', capturedAt: '2026-10-18T06:00:00Z' },
      { connectionString: config.databaseUrl },
    );

    expect(res2.correlation.ambiguousMatches).toBe(1);
    expect(res2.correlation.eventsMatched).toBe(0);

    const decRes = await query('SELECT * FROM correlation_decisions WHERE decision_type = $1;', [
      'AMBIGUOUS_MATCH',
    ]);
    expect(decRes.rows[0].decision_reason).toContain('Cumulative drift limit exceeded');
  });

  it('10. Multiple plausible event candidates produce an ambiguous decision', async () => {
    // Manually create two distinct events for pair (25544, 30580) spaced 10 minutes apart
    await query(`
      INSERT INTO space_objects (norad_cat_id, object_name) VALUES (25544, 'ISS'), (30580, 'DEB');
      INSERT INTO conjunction_events (primary_object_id, secondary_object_id, canonical_pair_key, initial_tca, initial_captured_at, latest_tca, latest_captured_at, latest_range_km, min_predicted_range_km)
      VALUES 
        (25544, 30580, '25544:30580', '2026-10-21 14:00:00Z', '2026-10-18 00:00:00Z', '2026-10-21 14:00:00Z', '2026-10-18 00:00:00Z', 5.0, 5.0),
        (25544, 30580, '25544:30580', '2026-10-21 14:10:00Z', '2026-10-18 00:00:00Z', '2026-10-21 14:10:00Z', '2026-10-18 00:00:00Z', 4.0, 4.0);
    `);

    // New observation at 14:05 falls within 5m of Event 1 and 5m of Event 2 (both <= 20m step and <= 45m cumulative)
    const csv =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-21 14:05:00.000,3.0,14.0,1.0E-05,0.5\n';
    const res = await ingestSnapshot(
      csv,
      { sourceUri: 'test://run_ambig' },
      { connectionString: config.databaseUrl },
    );

    expect(res.correlation.ambiguousMatches).toBe(1);
    expect(res.correlation.eventsMatched).toBe(0);

    const decRes = await query('SELECT * FROM correlation_decisions WHERE decision_type = $1;', [
      'AMBIGUOUS_MATCH',
    ]);
    expect(decRes.rows[0].candidate_event_ids.length).toBe(2);
    expect(decRes.rows[0].decision_reason).toContain('competing active events');
  });

  it('11. Multiple close-approach rows for one object pair in the same snapshot are not automatically merged', async () => {
    // Single snapshot containing two separate close approaches for pair (25544, 30580) spaced 12 hours apart
    const csvMultiPass =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-21 10:00:00.000,4.0,14.0,1.0E-05,0.5\n' +
      '25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-21 22:00:00.000,2.0,14.0,2.0E-05,0.5\n';

    const res = await ingestSnapshot(
      csvMultiPass,
      { sourceUri: 'test://multi_pass_snapshot' },
      { connectionString: config.databaseUrl },
    );

    // Must create 2 distinct events in the same batch
    expect(res.correlation.eventsCreated).toBe(2);

    const eventRes = await query('SELECT * FROM conjunction_events ORDER BY initial_tca ASC;');
    expect(eventRes.rows.length).toBe(2);
    expect(new Date(eventRes.rows[0].initial_tca).toISOString()).toBe('2026-10-21T10:00:00.000Z');
    expect(new Date(eventRes.rows[1].initial_tca).toISOString()).toBe('2026-10-21T22:00:00.000Z');
  });

  it('12. Older snapshot imported late does not silently replace newer event data (out-of-order backfill)', async () => {
    // Newer snapshot (Run 2: captured at 18:00 UTC) is ingested FIRST: TCA 14:30:10, Range 0.8 km
    const csvNewer =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n25544,ISS [+],1.0,30580,DEB [-],1.5,2026-10-21 14:30:10.000,0.800,14.8,2.0E-04,0.4\n';
    await ingestSnapshot(
      csvNewer,
      { sourceUri: 'test://run_newer', capturedAt: '2026-10-18T18:00:00Z' },
      { connectionString: config.databaseUrl },
    );

    // Older snapshot (Run 1: captured at 06:00 UTC) arrives LATE: TCA 14:30:15, Range 4.8 km
    const csvOlder =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-21 14:30:15.000,4.800,14.8,1.0E-05,0.4\n';
    const resOlder = await ingestSnapshot(
      csvOlder,
      { sourceUri: 'test://run_older_late', capturedAt: '2026-10-18T06:00:00Z' },
      { connectionString: config.databaseUrl },
    );

    expect(resOlder.correlation.backfills).toBe(1);

    const eventRes = await query('SELECT * FROM conjunction_events;');
    const evt = eventRes.rows[0];

    // Must NOT have regressed to older prediction!
    expect(new Date(evt.latest_tca).toISOString()).toBe('2026-10-21T14:30:10.000Z');
    expect(parseFloat(evt.latest_range_km)).toBe(0.8);
    expect(new Date(evt.latest_captured_at).toISOString()).toBe('2026-10-18T18:00:00.000Z');
    expect(evt.observation_count).toBe(2);

    const decRes = await query(
      'SELECT decision_type FROM correlation_decisions WHERE observation_id = (SELECT id FROM raw_observations WHERE captured_at = $1);',
      ['2026-10-18 06:00:00Z'],
    );
    expect(decRes.rows[0].decision_type).toBe('OUT_OF_ORDER_BACKFILL');
  });

  it('13. Concurrent transactions attempting to create the same encounter do not create duplicate events', async () => {
    const csv =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-21 14:30:00.000,2.5,14.8,1.0E-05,0.4\n';

    // Spawn 5 parallel ingestion requests with identical pair content simultaneously
    const promises = Array.from({ length: 5 }, (_, i) =>
      ingestSnapshot(
        csv,
        { sourceUri: `test://worker_${i}`, capturedAt: `2026-10-18T0${i}:00:00Z` },
        { connectionString: config.databaseUrl },
      ),
    );

    const results = await Promise.all(promises);
    expect(results.length).toBe(5);

    // Advisory lock guarantees exactly 1 event was created
    const eventRes = await query('SELECT * FROM conjunction_events;');
    expect(eventRes.rows.length).toBe(1);
    expect(eventRes.rows[0].observation_count).toBe(5);
  });

  it('14. Every processed observation has a traceable correlation outcome', async () => {
    const csv =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-21 14:30:00.000,2.5,14.8,1.0E-05,0.4\n' +
      '58006,STARLINK [+],0.5,68000,STARLINK [-],1.0,2026-10-21 16:30:00.000,1.5,12.0,2.0E-05,0.4\n';

    await ingestSnapshot(
      csv,
      { sourceUri: 'test://batch_traceable' },
      { connectionString: config.databaseUrl },
    );

    const obsCountRes = await query('SELECT COUNT(*) FROM raw_observations;');
    const decCountRes = await query('SELECT COUNT(*) FROM correlation_decisions;');

    expect(parseInt(decCountRes.rows[0].count, 10)).toBe(parseInt(obsCountRes.rows[0].count, 10));
    expect(parseInt(decCountRes.rows[0].count, 10)).toBe(2);
  });

  it('15. Foreign-key and uniqueness constraints prevent invalid links or destructive data loss', async () => {
    const csv =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-21 14:30:00.000,2.5,14.8,1.0E-05,0.4\n';
    await ingestSnapshot(csv, {}, { connectionString: config.databaseUrl });

    // Attempting to delete an active conjunction event must fail due to foreign key RESTRICT on event_observations
    const eventRes = await query('SELECT id FROM conjunction_events LIMIT 1;');
    await expect(
      query('DELETE FROM conjunction_events WHERE id = $1;', [eventRes.rows[0].id]),
    ).rejects.toThrow(/foreign key constraint/i);
  });

  it('16. Lifecycle transition tests use a controlled reference time and verify valid PAST_TCA state changes', async () => {
    // Event with predicted TCA at Oct 21, 2026 at 14:30:00 UTC
    const csv =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-21 14:30:00.000,2.5,14.8,1.0E-05,0.4\n';
    await ingestSnapshot(csv, {}, { connectionString: config.databaseUrl });

    // Reference time is BEFORE TCA: Oct 21 at 12:00 UTC -> should NOT reap
    const reapBefore = await reapPastTcaEvents({
      referenceTime: '2026-10-21T12:00:00.000Z',
      bufferMinutes: 15,
      connectionString: config.databaseUrl,
    });
    expect(reapBefore.transitionedCount).toBe(0);

    const eventBefore = await query('SELECT lifecycle_state FROM conjunction_events;');
    expect(eventBefore.rows[0].lifecycle_state).toBe('MONITORING');

    // Reference time is AFTER TCA + buffer: Oct 21 at 15:00 UTC (> 14:30 + 15m) -> should reap!
    const reapAfter = await reapPastTcaEvents({
      referenceTime: '2026-10-21T15:00:00.000Z',
      bufferMinutes: 15,
      connectionString: config.databaseUrl,
    });
    expect(reapAfter.transitionedCount).toBe(1);

    const eventAfter = await query('SELECT lifecycle_state FROM conjunction_events;');
    expect(eventAfter.rows[0].lifecycle_state).toBe('PAST_TCA');
  });
});
