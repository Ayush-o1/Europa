/**
 * @fileoverview Phase 4 Integration Tests: Operator Review & Cryptographic Audit Ledger
 *
 * Verifies operator review actions, meaningful justifications, review history preservation,
 * re-review triggers upon material observation changes, cryptographic hash chain verification,
 * concurrent audit appends, and database-level mutation prevention.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getPool, closePool, query } from '../../src/db/pool.js';
import { applyMigrations } from '../../src/db/migrator.js';
import { config } from '../../src/config/env.js';
import { ingestSnapshot } from '../../src/modules/ingestion/ingestionService.js';
import {
  recordReview,
  getEventReviews,
  validateReviewInput,
} from '../../src/modules/review/reviewService.js';
import {
  verifyAuditLedger,
  getEventAuditTrail,
  appendAuditEntry,
} from '../../src/modules/audit/auditLedger.js';

describe('Phase 4 Integration: Operator Review & Audit Ledger', () => {
  beforeAll(async () => {
    getPool(config.databaseUrl);
    await applyMigrations({ connectionString: config.databaseUrl });
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async () => {
    await query('TRUNCATE audit_ledger CASCADE;');
    await query('DELETE FROM event_reviews;');
    await query('DELETE FROM event_assessments;');
    await query('DELETE FROM correlation_decisions;');
    await query('DELETE FROM event_observations;');
    await query('DELETE FROM conjunction_events;');
    await query('DELETE FROM batch_errors;');
    await query('DELETE FROM raw_observations;');
    await query('DELETE FROM space_objects;');
    await query('DELETE FROM ingestion_batches;');
  });

  it('1. Operator records ACKNOWLEDGE, ESCALATE, and DISMISS reviews with justifications', async () => {
    const csv =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-22 14:30:00.000,0.850,14.8,1.2E-04,0.4\n';

    await ingestSnapshot(csv, {}, { connectionString: config.databaseUrl });
    const event = (await query('SELECT * FROM conjunction_events LIMIT 1;')).rows[0];

    // Initial review status is UNREVIEWED
    expect(event.review_status).toBe('UNREVIEWED');

    // 1. ACKNOWLEDGE review
    const { review: ackReview, updatedEvent: ackEvent } = await recordReview(event.id, {
      action: 'ACKNOWLEDGE',
      justification:
        'Reviewed preliminary prediction. Tracking geometry and screening for radar updates.',
      actorId: 'analyst_ayush',
    });

    expect(ackReview.action).toBe('ACKNOWLEDGE');
    expect(ackReview.previous_review_status).toBe('UNREVIEWED');
    expect(ackReview.new_review_status).toBe('UNDER_REVIEW');
    expect(ackEvent.review_status).toBe('UNDER_REVIEW');

    // Urgency level remains decoupled and intact
    expect(ackEvent.urgency_level).toBe(event.urgency_level);

    // 2. ESCALATE review
    const { review: escReview, updatedEvent: escEvent } = await recordReview(event.id, {
      action: 'ESCALATE',
      justification:
        'Miss distance remains under 1 km with elevated probability. Escalating to flight dynamics team.',
      actorId: 'analyst_ayush',
    });

    expect(escReview.action).toBe('ESCALATE');
    expect(escReview.previous_review_status).toBe('UNDER_REVIEW');
    expect(escReview.new_review_status).toBe('ESCALATED');
    expect(escEvent.review_status).toBe('ESCALATED');

    // 3. Verify history preserves all reviews in descending order
    const history = await getEventReviews(event.id);
    expect(history.length).toBe(2);
    expect(history[0].id).toBe(escReview.id);
    expect(history[1].id).toBe(ackReview.id);
  });

  it('2. Review input validation rejects invalid actions or insufficient justifications', () => {
    expect(() =>
      validateReviewInput({
        action: 'INVALID_ACTION',
        justification: 'This is a long enough justification but action is fake.',
        actorId: 'user1',
      }),
    ).toThrow(/Invalid review action/);

    expect(() =>
      validateReviewInput({
        action: 'ACKNOWLEDGE',
        justification: 'too short', // < 10 characters
        actorId: 'user1',
      }),
    ).toThrow(/meaningful review justification/);

    expect(() =>
      validateReviewInput({
        action: 'ACKNOWLEDGE',
        justification: 'Valid length justification for review',
        actorId: '', // Empty actorId
      }),
    ).toThrow(/valid non-empty actorId/);
  });

  it('3. Re-review is triggered (REQUIRES_RE_REVIEW) when a new observation materially elevates risk on a previously reviewed event', async () => {
    // Snapshot 1: Moderate risk (3.0 km, LOW/MEDIUM urgency)
    const csv1 =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-23 14:30:00.000,3.000,14.8,1.0E-07,0.4\n';

    await ingestSnapshot(
      csv1,
      { capturedAt: '2026-10-21T14:30:00.000Z' },
      { connectionString: config.databaseUrl },
    );

    const event = (await query('SELECT * FROM conjunction_events LIMIT 1;')).rows[0];

    // Analyst reviews and dismisses the encounter as acceptable
    await recordReview(event.id, {
      action: 'DISMISS',
      justification:
        '3.0 km miss distance with negligible collision probability. Dismissed as acceptable screening risk.',
      actorId: 'analyst_ayush',
    });

    const dismissedEvent = (
      await query('SELECT review_status FROM conjunction_events WHERE id = $1;', [event.id])
    ).rows[0];
    expect(dismissedEvent.review_status).toBe('DISMISSED');

    // Snapshot 2: Material change! Miss distance shrinks to 0.35 km (< 0.5km critical proximity, >20% contraction)
    const csv2 =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.3,30580,DEB [-],0.8,2026-10-23 14:30:00.000,0.350,14.8,1.5E-04,0.4\n';

    await ingestSnapshot(
      csv2,
      { capturedAt: '2026-10-22T02:30:00.000Z' },
      { connectionString: config.databaseUrl },
    );

    // Event must now require fresh re-review
    const updatedEvent = (
      await query('SELECT review_status, urgency_level FROM conjunction_events WHERE id = $1;', [
        event.id,
      ])
    ).rows[0];
    expect(updatedEvent.review_status).toBe('REQUIRES_RE_REVIEW');
    expect(updatedEvent.urgency_level).toBe('CRITICAL');

    // Prior dismissal justification must remain preserved in event_reviews
    const reviews = await getEventReviews(event.id);
    expect(reviews.length).toBe(1);
    expect(reviews[0].action).toBe('DISMISS');
    expect(reviews[0].justification).toContain('3.0 km miss distance');

    // Audit ledger must record RE_REVIEW_REQUIRED action
    const trail = await getEventAuditTrail(event.id);
    const reReviewEntry = trail.find(e => e.action_type === 'RE_REVIEW_REQUIRED');
    expect(reReviewEntry).toBeDefined();
    expect(reReviewEntry.payload.reasons.length).toBeGreaterThan(0);
  });

  it('4. Cryptographic audit ledger verifies unbroken hash chain from genesis to head', async () => {
    const csv =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-22 14:30:00.000,1.5,14.8,1.0E-05,0.4\n';

    await ingestSnapshot(csv, {}, { connectionString: config.databaseUrl });
    const event = (await query('SELECT id FROM conjunction_events LIMIT 1;')).rows[0];

    await recordReview(event.id, {
      action: 'ACKNOWLEDGE',
      justification: 'Valid review justification for testing hash chain continuity.',
      actorId: 'analyst_ayush',
    });

    const verification = await verifyAuditLedger();
    expect(verification.valid).toBe(true);
    expect(verification.error).toBeNull();
    expect(verification.totalEntries).toBeGreaterThanOrEqual(3); // EVENT_CREATED, ASSESSMENT_RECORDED, REVIEW_RECORDED
  });

  it('5. Concurrent audit appends serialize safely and produce an unbroken valid hash chain', async () => {
    const pool = getPool(config.databaseUrl);
    const concurrentWorkers = 10;

    // Concurrently append audit entries from multiple parallel database connections
    const tasks = Array.from({ length: concurrentWorkers }).map(async (_, idx) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        await appendAuditEntry(client, {
          actionType: 'CONCURRENT_TEST_ACTION',
          actorType: 'OPERATOR',
          actorId: `worker_${idx}`,
          payload: { workerIndex: idx, timestamp: Date.now() },
        });
        await client.query('COMMIT;');
      } catch (err) {
        await client.query('ROLLBACK;');
        throw err;
      } finally {
        client.release();
      }
    });

    await Promise.all(tasks);

    // Verify resulting chain integrity
    const verification = await verifyAuditLedger();
    expect(verification.valid).toBe(true);
    expect(verification.error).toBeNull();
    expect(verification.totalEntries).toBe(concurrentWorkers);

    // Check strict sequence ordering (1 to 10)
    const rows = (
      await query('SELECT sequence_number FROM audit_ledger ORDER BY sequence_number ASC;')
    ).rows;
    for (let i = 0; i < concurrentWorkers; i++) {
      expect(parseInt(rows[i].sequence_number, 10)).toBe(i + 1);
    }
  });

  it('6. Anti-tampering database trigger strictly prohibits UPDATE or DELETE on audit_ledger', async () => {
    const pool = getPool(config.databaseUrl);
    const client = await pool.connect();

    try {
      await client.query('BEGIN;');
      await appendAuditEntry(client, {
        actionType: 'TAMPER_TEST',
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        payload: { test: true },
      });
      await client.query('COMMIT;');
    } finally {
      client.release();
    }

    // Attempt direct SQL UPDATE on audit_ledger
    await expect(
      query("UPDATE audit_ledger SET actor_id = 'MALICIOUS_ACTOR' WHERE sequence_number = 1;"),
    ).rejects.toThrow(
      /Audit ledger is strictly append-only: UPDATE and DELETE operations are prohibited/i,
    );

    // Attempt direct SQL DELETE on audit_ledger
    await expect(query('DELETE FROM audit_ledger WHERE sequence_number = 1;')).rejects.toThrow(
      /Audit ledger is strictly append-only: UPDATE and DELETE operations are prohibited/i,
    );
  });

  it('7. Foreign key constraint prevents deleting an event while reviews exist (ON DELETE RESTRICT)', async () => {
    const csv =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-22 14:30:00.000,2.5,14.8,1.0E-05,0.4\n';

    await ingestSnapshot(csv, {}, { connectionString: config.databaseUrl });
    const event = (await query('SELECT id FROM conjunction_events LIMIT 1;')).rows[0];

    await recordReview(event.id, {
      action: 'DISMISS',
      justification: 'Dismissing event to test relational delete restriction.',
      actorId: 'analyst_ayush',
    });

    // Attempting to delete the conjunction event must be blocked by foreign key constraint
    await expect(
      query('DELETE FROM conjunction_events WHERE id = $1;', [event.id]),
    ).rejects.toThrow(/foreign key constraint/i);
  });
});
