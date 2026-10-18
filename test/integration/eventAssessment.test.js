/**
 * @fileoverview Phase 3 Integration Tests: Review-Priority Assessment Engine
 *
 * Verifies versioned, explainable assessment persistence, historical preservation,
 * urgency level updates, and resilience under evolving observations.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getPool, closePool, query } from '../../src/db/pool.js';
import { applyMigrations } from '../../src/db/migrator.js';
import { config } from '../../src/config/env.js';
import { ingestSnapshot } from '../../src/modules/ingestion/ingestionService.js';
import {
  getEventAssessments,
  getLatestAssessment,
  assessAndSaveEvent,
} from '../../src/modules/assessment/assessmentService.js';

describe('Phase 3 Integration: Review-Priority Assessment Engine', () => {
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

  it('1. Ingestion of snapshot creates conjunction event and automatically persists initial assessment', async () => {
    const csv =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.450,30580,DEB [-],1.120,2026-10-22 14:30:00.000,0.350,14.820,1.200E-04,0.480\n';

    const ingestResult = await ingestSnapshot(
      csv,
      { capturedAt: '2026-10-21T14:30:00.000Z' },
      { connectionString: config.databaseUrl },
    );

    expect(ingestResult.status).toBe('COMPLETED');

    const eventRes = await query('SELECT * FROM conjunction_events LIMIT 1;');
    expect(eventRes.rows.length).toBe(1);
    const event = eventRes.rows[0];

    const assessments = await getEventAssessments(event.id);
    expect(assessments.length).toBe(1);

    const assessment = assessments[0];
    expect(assessment.event_id).toBe(event.id);
    expect(assessment.rule_set_version).toBe('v1.0.0-heuristic');
    expect(assessment.is_current).toBe(true);

    // Miss distance < 0.5km (50 pts), time = 24h (20 pts), prob >= 1e-4 (15 pts), fresh dse 1.12d (3 pts)
    expect(parseFloat(assessment.assessment_score)).toBeGreaterThanOrEqual(80);
    expect(assessment.urgency_level).toBe('CRITICAL');
    expect(event.urgency_level).toBe('CRITICAL');

    // Verify explainability breakdown
    expect(assessment.explanations.length).toBeGreaterThanOrEqual(4);
    expect(assessment.component_scores.missDistance.score).toBe(50);
    expect(assessment.input_snapshot.missDistanceKm).toBe(0.35);
  });

  it('2. Subsequent observation with closer miss distance re-assesses event and preserves full historical record', async () => {
    // Snapshot 1: Moderate encounter (4.5 km miss distance, 48 hours away)
    const csv1 =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-23 14:30:00.000,4.5,14.8,1.0E-06,0.5\n';

    await ingestSnapshot(
      csv1,
      { capturedAt: '2026-10-21T14:30:00.000Z' },
      { connectionString: config.databaseUrl },
    );

    const eventRes1 = await query('SELECT id, urgency_level FROM conjunction_events LIMIT 1;');
    const eventId = eventRes1.rows[0].id;

    const initialAssessments = await getEventAssessments(eventId);
    expect(initialAssessments.length).toBe(1);
    const firstAssessment = initialAssessments[0];
    expect(firstAssessment.is_current).toBe(true);
    expect(firstAssessment.urgency_level).toBe('MEDIUM');

    // Snapshot 2 (captured 12h later): Miss distance shrinks to 0.4 km (critical) and time is 36h away
    const csv2 =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.3,30580,DEB [-],0.8,2026-10-23 14:35:00.000,0.4,14.8,2.0E-04,0.5\n';

    await ingestSnapshot(
      csv2,
      { capturedAt: '2026-10-22T02:30:00.000Z' },
      { connectionString: config.databaseUrl },
    );

    // Event urgency level must be updated to CRITICAL
    const updatedEventRes = await query(
      'SELECT urgency_level FROM conjunction_events WHERE id = $1;',
      [eventId],
    );
    expect(updatedEventRes.rows[0].urgency_level).toBe('CRITICAL');

    // Both assessments must be preserved historically
    const allAssessments = await getEventAssessments(eventId);
    expect(allAssessments.length).toBe(2);

    const latest = await getLatestAssessment(eventId);
    expect(latest).not.toBeNull();
    expect(latest.id).toBe(allAssessments[0].id);
    expect(latest.is_current).toBe(true);
    expect(latest.urgency_level).toBe('CRITICAL');

    // Prior assessment must now be archived as is_current = false
    const previous = allAssessments.find(a => a.id === firstAssessment.id);
    expect(previous.is_current).toBe(false);
    expect(previous.urgency_level).toBe('MEDIUM');
  });

  it('3. Assessment explainability answers all six mandatory diagnostic questions', async () => {
    const csv =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-22 02:30:00.000,1.2,14.8,3.5E-05,0.4\n';

    await ingestSnapshot(
      csv,
      { capturedAt: '2026-10-21T14:30:00.000Z' },
      { connectionString: config.databaseUrl },
    );

    const event = (await query('SELECT * FROM conjunction_events LIMIT 1;')).rows[0];
    const assessment = await getLatestAssessment(event.id);

    // Q1: What score was assigned?
    expect(assessment.assessment_score).toBeDefined();
    expect(parseFloat(assessment.assessment_score)).toBeGreaterThan(0);

    // Q2: Which rules contributed to that score?
    expect(assessment.component_scores.missDistance).toBeDefined();
    expect(assessment.component_scores.timeToTca).toBeDefined();
    expect(assessment.component_scores.probability).toBeDefined();
    expect(assessment.component_scores.dataFreshness).toBeDefined();

    // Q3: What source values and timestamps were used?
    expect(assessment.input_snapshot.missDistanceKm).toBe(1.2);
    expect(assessment.input_snapshot.referenceTime).toBe('2026-10-21T14:30:00.000Z');
    expect(assessment.input_snapshot.tca).toBeDefined();

    // Q4: Which rule-set version was applied?
    expect(assessment.rule_set_version).toBe('v1.0.0-heuristic');

    // Q5: Why was this urgency classification assigned?
    expect(assessment.explanations.length).toBeGreaterThan(0);
    expect(assessment.explanations[0]).toContain(assessment.urgency_level);

    // Q6: Traceable observation provenance
    expect(assessment.observation_id).not.toBeNull();
  });

  it('4. Out-of-order snapshot backfill does not demote latest current assessment', async () => {
    // Snapshot A: newer capture (TCA + 12h, miss distance 0.3km -> CRITICAL)
    const csvNewer =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.2,30580,DEB [-],0.4,2026-10-22 14:30:00.000,0.3,14.8,1.5E-04,0.4\n';

    await ingestSnapshot(
      csvNewer,
      { capturedAt: '2026-10-22T00:00:00.000Z' },
      { connectionString: config.databaseUrl },
    );

    const event = (await query('SELECT * FROM conjunction_events LIMIT 1;')).rows[0];
    expect(event.urgency_level).toBe('CRITICAL');

    // Snapshot B: older capture imported late (captured 12h earlier with miss distance 8.0km -> LOW)
    const csvOlder =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.7,30580,DEB [-],1.2,2026-10-22 14:30:00.000,8.0,14.8,1.0E-07,0.4\n';

    await ingestSnapshot(
      csvOlder,
      { capturedAt: '2026-10-21T12:00:00.000Z' },
      { connectionString: config.databaseUrl },
    );

    // Event urgency level must NOT be demoted to LOW by the historical backfill
    const reloadedEvent = (
      await query('SELECT urgency_level FROM conjunction_events WHERE id = $1;', [event.id])
    ).rows[0];
    expect(reloadedEvent.urgency_level).toBe('CRITICAL');

    // Current assessment remains the one from the newer snapshot
    const latest = await getLatestAssessment(event.id);
    expect(latest.urgency_level).toBe('CRITICAL');
    expect(latest.is_current).toBe(true);

    // Total assessments recorded is 2 (one for newer, one for backfill)
    const all = await getEventAssessments(event.id);
    expect(all.length).toBe(2);
  });

  it('5. Foreign key constraint prevents deleting an event while assessments exist (ON DELETE RESTRICT)', async () => {
    const csv =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-22 14:30:00.000,2.5,14.8,1.0E-05,0.4\n';

    await ingestSnapshot(csv, {}, { connectionString: config.databaseUrl });

    const event = (await query('SELECT id FROM conjunction_events LIMIT 1;')).rows[0];

    // Deleting the event must throw foreign key error from event_assessments (or event_observations)
    await expect(
      query('DELETE FROM conjunction_events WHERE id = $1;', [event.id]),
    ).rejects.toThrow(/foreign key constraint/i);
  });

  it('6. Standalone assessAndSaveEvent correctly updates urgency and evaluates on demand', async () => {
    const csv =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-22 14:30:00.000,10.5,14.8,1.0E-07,0.4\n';

    await ingestSnapshot(
      csv,
      { capturedAt: '2026-10-21T00:00:00.000Z' },
      { connectionString: config.databaseUrl },
    );

    const event = (await query('SELECT * FROM conjunction_events LIMIT 1;')).rows[0];
    const pool = getPool(config.databaseUrl);
    const client = await pool.connect();

    try {
      // Re-evaluate event 50 hours later when TCA is within 12 hours
      const simulatedNow = '2026-10-22T04:00:00.000Z'; // 10.5 hours before TCA
      const { result } = await assessAndSaveEvent(client, event, null, {
        referenceTime: simulatedNow,
      });

      expect(result.componentScores.timeToTca.score).toBe(30);

      const latest = await getLatestAssessment(event.id, { client });
      expect(latest.component_scores.timeToTca.score).toBe(30);
    } finally {
      client.release();
    }
  });
});
