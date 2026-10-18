/**
 * @fileoverview Phase 5 Integration Tests: REST API & Operational Queries
 *
 * Verifies all Phase 5 REST endpoints against the real PostgreSQL test database:
 * - Application health and database readiness
 * - Snapshot upload, deduplication, and file validation
 * - Paginated ingestion batch queries (without filesystem path leakage)
 * - Event queries with strict filter validation, sorting, and pagination
 * - Event details and snapshot-chronological observation history
 * - Historical and latest active assessments
 * - Operator review actions with mandatory justifications and authentication boundaries
 * - Read-only cryptographic audit verification
 * - Centralized error sanitization and prevention of destructive operations
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPool, closePool, query } from '../../src/db/pool.js';
import { applyMigrations } from '../../src/db/migrator.js';
import { config } from '../../src/config/env.js';

const VALID_API_KEY = config.operatorApiKey;

const SAMPLE_CSV_1 =
  'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
  '25544,ISS [+],0.5,30580,DEB [-],1.0,2026-10-22 14:30:00.000,0.850,14.8,1.2E-04,0.4\n' +
  '48274,STARLINK-2500,0.2,49000,STARLINK-3100,0.3,2026-10-23 08:15:00.000,4.200,10.2,5.0E-06,1.2\n';

const SAMPLE_CSV_2 =
  'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
  '25544,ISS [+],0.8,30580,DEB [-],1.3,2026-10-22 14:31:00.000,0.620,14.8,3.5E-04,0.35\n';

describe('Phase 5 Integration: REST API & Operational Queries', () => {
  let app;

  beforeAll(async () => {
    getPool(config.databaseUrl);
    await applyMigrations({ connectionString: config.databaseUrl });
    app = createApp();
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

  describe('1. Health & Readiness Endpoint', () => {
    it('GET /api/v1/health returns 200 with system readiness without leaking secrets', async () => {
      const res = await request(app).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('healthy');
      expect(res.body.data.database.status).toBe('ready');
      expect(typeof res.body.data.uptimeSeconds).toBe('number');
      expect(typeof res.body.data.timestamp).toBe('string');

      // Crucial: ensure no credentials or connection strings are leaked
      const bodyString = JSON.stringify(res.body);
      expect(bodyString).not.toContain('postgresql://');
      expect(bodyString).not.toContain('postgres:');
      expect(bodyString).not.toContain('voidline_test');
    });
  });

  describe('2. Snapshot Ingestion & Batch Queries', () => {
    it('rejects unauthenticated upload with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/v1/ingest/snapshots')
        .attach('file', Buffer.from(SAMPLE_CSV_1), 'snapshot.csv');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects invalid API key with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/ingest/snapshots')
        .set('X-API-Key', 'wrong-key')
        .attach('file', Buffer.from(SAMPLE_CSV_1), 'snapshot.csv');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects upload missing the file payload with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/ingest/snapshots')
        .set('X-API-Key', VALID_API_KEY);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('MISSING_FILE');
    });

    it('rejects non-CSV file extension with 415 Unsupported Media Type', async () => {
      const res = await request(app)
        .post('/api/v1/ingest/snapshots')
        .set('X-API-Key', VALID_API_KEY)
        .attach('file', Buffer.from('some text content'), 'snapshot.txt');

      expect(res.status).toBe(415);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('successfully uploads and ingests valid CSV snapshot (201 Created)', async () => {
      const res = await request(app)
        .post('/api/v1/ingest/snapshots')
        .set('X-API-Key', VALID_API_KEY)
        .field('sourceUri', 'https://celestrak.org/SOCRATES/socrates.csv')
        .field('screeningScope', 'FULL_CATALOG_MINRANGE')
        .attach('file', Buffer.from(SAMPLE_CSV_1), 'socrates_20261022.csv');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('COMPLETED');
      expect(res.body.data.isDuplicate).toBe(false);
      expect(res.body.data.rowCount).toBe(2);
      expect(res.body.data.validCount).toBe(2);
      expect(res.body.data.errorCount).toBe(0);
      expect(res.body.data.correlation).toBeDefined();
      expect(res.body.data.correlation.eventsCreated).toBe(2);
    });

    it('recognizes duplicate snapshot upload and returns 200 OK with duplicate flag', async () => {
      // 1. First upload
      const res1 = await request(app)
        .post('/api/v1/ingest/snapshots')
        .set('X-API-Key', VALID_API_KEY)
        .field('capturedAt', '2026-10-22T10:00:00.000Z')
        .attach('file', Buffer.from(SAMPLE_CSV_1), 'snapshot_dupe.csv');

      expect(res1.status).toBe(201);
      expect(res1.body.data.isDuplicate).toBe(false);

      // 2. Second upload with identical content and capture timestamp
      const res2 = await request(app)
        .post('/api/v1/ingest/snapshots')
        .set('X-API-Key', VALID_API_KEY)
        .field('capturedAt', '2026-10-22T10:00:00.000Z')
        .attach('file', Buffer.from(SAMPLE_CSV_1), 'snapshot_dupe.csv');

      expect(res2.status).toBe(200);
      expect(res2.body.success).toBe(true);
      expect(res2.body.data.isDuplicate).toBe(true);
      expect(res2.body.data.status).toBe('DUPLICATE_IGNORED');
    });

    it('GET /api/v1/ingest/batches returns paginated batches without exposing server filesystem paths', async () => {
      // Ingest a batch first
      await request(app)
        .post('/api/v1/ingest/snapshots')
        .set('X-API-Key', VALID_API_KEY)
        .attach('file', Buffer.from(SAMPLE_CSV_1), 'batches_test.csv');

      const res = await request(app).get('/api/v1/ingest/batches?page=1&limit=10');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });

      // Verify no absolute server paths are exposed
      const batch = res.body.data[0];
      expect(batch.archive_file_path).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('/Users/');
      expect(JSON.stringify(res.body)).not.toContain('/storage/');
    });

    it('GET /api/v1/ingest/batches rejects invalid pagination parameters', async () => {
      const res1 = await request(app).get('/api/v1/ingest/batches?page=0');
      expect(res1.status).toBe(400);
      expect(res1.body.error.code).toBe('INVALID_PAGINATION');

      const res2 = await request(app).get('/api/v1/ingest/batches?limit=250');
      expect(res2.status).toBe(400);
      expect(res2.body.error.code).toBe('INVALID_PAGINATION');
    });
  });

  describe('3. Conjunction Event Queries & Filtering', () => {
    beforeEach(async () => {
      // Ingest sample data to establish conjunction events
      await request(app)
        .post('/api/v1/ingest/snapshots')
        .set('X-API-Key', VALID_API_KEY)
        .field('capturedAt', '2026-10-22T08:00:00.000Z')
        .attach('file', Buffer.from(SAMPLE_CSV_1), 'events_init.csv');
    });

    it('GET /api/v1/events returns paginated event list with space object names', async () => {
      const res = await request(app).get('/api/v1/events?page=1&limit=10');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(2);
      expect(res.body.pagination.total).toBe(2);

      const event = res.body.data[0];
      expect(event.primary_object_name).toBeDefined();
      expect(event.secondary_object_name).toBeDefined();
      expect(event.urgency_level).toBeDefined();
      expect(event.lifecycle_state).toBe('MONITORING');
      expect(event.review_status).toBe('UNREVIEWED');
    });

    it('filters events by urgency level', async () => {
      // ISS has score 90 (CRITICAL: <1km & <12h to TCA), Starlink has score 45 (MEDIUM: 4.2km & ~24h to TCA)
      const resCritical = await request(app).get('/api/v1/events?urgency=CRITICAL');
      expect(resCritical.status).toBe(200);
      expect(resCritical.body.data.length).toBe(1);
      expect(resCritical.body.data[0].primary_object_id).toBe(25544);

      const resMedium = await request(app).get('/api/v1/events?urgency=MEDIUM');
      expect(resMedium.status).toBe(200);
      expect(resMedium.body.data.length).toBe(1);
      expect(resMedium.body.data[0].primary_object_id).toBe(48274);
    });

    it('filters events by NORAD object ID (primary or secondary)', async () => {
      const resPrimary = await request(app).get('/api/v1/events?objectId=25544');
      expect(resPrimary.status).toBe(200);
      expect(resPrimary.body.data.length).toBe(1);

      const resSecondary = await request(app).get('/api/v1/events?objectId=30580');
      expect(resSecondary.status).toBe(200);
      expect(resSecondary.body.data.length).toBe(1);

      const resNone = await request(app).get('/api/v1/events?objectId=99999');
      expect(resNone.status).toBe(200);
      expect(resNone.body.data.length).toBe(0);
    });

    it('filters events by missDistanceMax', async () => {
      const res = await request(app).get('/api/v1/events?missDistanceMax=1.0');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(parseFloat(res.body.data[0].latest_range_km)).toBeLessThanOrEqual(1.0);
    });

    it('filters events by TCA date range', async () => {
      const res = await request(app).get(
        '/api/v1/events?tcaFrom=2026-10-22T00:00:00Z&tcaTo=2026-10-22T23:59:59Z',
      );
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].primary_object_id).toBe(25544);
    });

    it('sorts events deterministically by specified column and direction', async () => {
      const resAsc = await request(app).get('/api/v1/events?sortBy=latest_range_km&sortOrder=ASC');
      expect(resAsc.status).toBe(200);
      expect(parseFloat(resAsc.body.data[0].latest_range_km)).toBeLessThan(
        parseFloat(resAsc.body.data[1].latest_range_km),
      );

      const resDesc = await request(app).get(
        '/api/v1/events?sortBy=latest_range_km&sortOrder=DESC',
      );
      expect(resDesc.status).toBe(200);
      expect(parseFloat(resDesc.body.data[0].latest_range_km)).toBeGreaterThan(
        parseFloat(resDesc.body.data[1].latest_range_km),
      );
    });

    it('rejects unrecognized query parameters with 400 Bad Request', async () => {
      const res = await request(app).get('/api/v1/events?maliciousFilter=drop');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_FILTER');
    });

    it('rejects invalid urgency value with 400 Bad Request', async () => {
      const res = await request(app).get('/api/v1/events?urgency=EXTREME');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_FILTER');
    });

    it('rejects invalid date format with 400 Bad Request', async () => {
      const res = await request(app).get('/api/v1/events?tcaFrom=not-a-valid-date');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_FILTER');
    });

    it('rejects inverted date range (tcaFrom > tcaTo) with 400 Bad Request', async () => {
      const res = await request(app).get(
        '/api/v1/events?tcaFrom=2026-10-25T00:00:00Z&tcaTo=2026-10-20T00:00:00Z',
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_FILTER');
    });
  });

  describe('4. Event Details & Chronological History', () => {
    let eventId;

    beforeEach(async () => {
      // Ingest snapshot 1
      await request(app)
        .post('/api/v1/ingest/snapshots')
        .set('X-API-Key', VALID_API_KEY)
        .field('capturedAt', '2026-10-22T08:00:00.000Z')
        .attach('file', Buffer.from(SAMPLE_CSV_1), 'snap1.csv');

      const eventsRes = await request(app).get('/api/v1/events');
      eventId = eventsRes.body.data.find(e => e.primary_object_id === 25544).id;

      // Ingest snapshot 2 updating the ISS event
      await request(app)
        .post('/api/v1/ingest/snapshots')
        .set('X-API-Key', VALID_API_KEY)
        .field('capturedAt', '2026-10-22T12:00:00.000Z')
        .attach('file', Buffer.from(SAMPLE_CSV_2), 'snap2.csv');
    });

    it('GET /api/v1/events/:id returns complete event details and latest relations', async () => {
      const res = await request(app).get(`/api/v1/events/${eventId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.event.id).toBe(eventId);
      expect(res.body.data.event.observation_count).toBe(2);
      expect(res.body.data.latestObservation).toBeDefined();
      expect(res.body.data.latestAssessment).toBeDefined();
      expect(res.body.data.latestReview).toBeNull(); // not yet reviewed
    });

    it('GET /api/v1/events/:id returns 404 for non-existent UUID', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app).get(`/api/v1/events/${nonExistentId}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('GET /api/v1/events/:id returns 400 for malformed UUID parameter', async () => {
      const res = await request(app).get('/api/v1/events/invalid-uuid-format');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_PARAMETER');
    });

    it('GET /api/v1/events/:id/history preserves chronological observation sequence', async () => {
      const res = await request(app).get(`/api/v1/events/${eventId}/history`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(2);

      // Verify sequence is ordered by snapshot capture time ascending
      const obs1 = res.body.data[0];
      const obs2 = res.body.data[1];

      expect(new Date(obs1.captured_at).getTime()).toBeLessThan(
        new Date(obs2.captured_at).getTime(),
      );
      expect(parseFloat(obs1.tca_range_km)).toBe(0.85);
      expect(parseFloat(obs2.tca_range_km)).toBe(0.62);
      expect(obs1.source_uri).toBeDefined();
    });
  });

  describe('5. Conjunction Assessments', () => {
    let eventId;

    beforeEach(async () => {
      await request(app)
        .post('/api/v1/ingest/snapshots')
        .set('X-API-Key', VALID_API_KEY)
        .field('capturedAt', '2026-10-22T08:00:00.000Z')
        .attach('file', Buffer.from(SAMPLE_CSV_1), 'snap1.csv');

      const eventsRes = await request(app).get('/api/v1/events');
      eventId = eventsRes.body.data.find(e => e.primary_object_id === 25544).id;

      // Ingest second observation to generate second historical assessment
      await request(app)
        .post('/api/v1/ingest/snapshots')
        .set('X-API-Key', VALID_API_KEY)
        .field('capturedAt', '2026-10-22T12:00:00.000Z')
        .attach('file', Buffer.from(SAMPLE_CSV_2), 'snap2.csv');
    });

    it('GET /api/v1/events/:id/assessments returns assessment history', async () => {
      const res = await request(app).get(`/api/v1/events/${eventId}/assessments`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(2);

      const latest = res.body.data[0];
      expect(latest.is_current).toBe(true);
      expect(latest.rule_set_version).toBe('v1.0.0-heuristic');
      expect(latest.assessment_score).toBeDefined();
      expect(latest.component_scores).toBeDefined();
      expect(latest.explanations).toBeDefined();
    });

    it('GET /api/v1/events/:id/assessments/latest returns current active assessment', async () => {
      const res = await request(app).get(`/api/v1/events/${eventId}/assessments/latest`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.is_current).toBe(true);
      expect(res.body.data.event_id).toBe(eventId);
    });
  });

  describe('6. Operator Reviews & Audit Verification', () => {
    let eventId;

    beforeEach(async () => {
      await request(app)
        .post('/api/v1/ingest/snapshots')
        .set('X-API-Key', VALID_API_KEY)
        .attach('file', Buffer.from(SAMPLE_CSV_1), 'snap1.csv');

      const eventsRes = await request(app).get('/api/v1/events');
      eventId = eventsRes.body.data[0].id;
    });

    it('rejects unauthenticated review submission with 401 Unauthorized', async () => {
      const res = await request(app).post(`/api/v1/events/${eventId}/reviews`).send({
        action: 'ACKNOWLEDGE',
        justification: 'Satellite flight dynamics team alerted; monitoring pass.',
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects review submission with invalid API key with 403 Forbidden', async () => {
      const res = await request(app)
        .post(`/api/v1/events/${eventId}/reviews`)
        .set('X-API-Key', 'invalid-key')
        .send({
          action: 'ACKNOWLEDGE',
          justification: 'Satellite flight dynamics team alerted; monitoring pass.',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects review with invalid action type with 400 Bad Request', async () => {
      const res = await request(app)
        .post(`/api/v1/events/${eventId}/reviews`)
        .set('X-API-Key', VALID_API_KEY)
        .send({
          action: 'DO_NOTHING_BAD_ACTION',
          justification: 'Justification text that is long enough.',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects review with insufficient justification (<10 chars) with 400 Bad Request', async () => {
      const res = await request(app)
        .post(`/api/v1/events/${eventId}/reviews`)
        .set('X-API-Key', VALID_API_KEY)
        .send({
          action: 'ACKNOWLEDGE',
          justification: 'Too short',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('records valid review and transitions event review_status (201 Created)', async () => {
      const res = await request(app)
        .post(`/api/v1/events/${eventId}/reviews`)
        .set('X-API-Key', VALID_API_KEY)
        .set('X-Actor-Id', 'analyst-42')
        .send({
          action: 'ACKNOWLEDGE',
          justification:
            'Screening confirms miss distance under threshold; operator scheduled monitoring pass.',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.review.action).toBe('ACKNOWLEDGE');
      expect(res.body.data.review.actor_id).toBe('analyst-42');
      expect(res.body.data.updatedEvent.review_status).toBe('UNDER_REVIEW');

      // Verify event details reflection
      const checkRes = await request(app).get(`/api/v1/events/${eventId}`);
      expect(checkRes.body.data.event.review_status).toBe('UNDER_REVIEW');
      expect(checkRes.body.data.latestReview.action).toBe('ACKNOWLEDGE');
    });

    it('GET /api/v1/events/:id/audit returns event audit ledger records', async () => {
      // Record a review to add to audit trail
      await request(app)
        .post(`/api/v1/events/${eventId}/reviews`)
        .set('X-API-Key', VALID_API_KEY)
        .send({
          action: 'ESCALATE',
          justification:
            'Critical miss distance detected; escalating to orbital operations team for manoeuvre screening.',
        });

      const res = await request(app).get(`/api/v1/events/${eventId}/audit?page=1&limit=10`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const reviewAudit = res.body.data.find(a => a.action_type === 'REVIEW_RECORDED');
      expect(reviewAudit).toBeDefined();
      expect(reviewAudit.payload.action).toBe('ESCALATE');
    });

    it('GET /api/v1/audit/verify performs read-only cryptographic verification of entire ledger', async () => {
      // Generate some audit activity
      await request(app)
        .post(`/api/v1/events/${eventId}/reviews`)
        .set('X-API-Key', VALID_API_KEY)
        .send({
          action: 'ACKNOWLEDGE',
          justification: 'Valid justified operational review for audit ledger verification.',
        });

      const res = await request(app).get('/api/v1/audit/verify');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.verified).toBe(true);
      expect(res.body.data.recordsChecked).toBeGreaterThan(0);
      expect(res.body.data.firstBrokenRecordSequence).toBeNull();
      expect(res.body.data.error).toBeNull();
    });
  });

  describe('7. Security, Error Handling & Sanitization', () => {
    it('returns 404 with standard envelope for undefined routes', async () => {
      const res = await request(app).get('/api/v1/non-existent-endpoint');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 for malformed JSON request bodies', async () => {
      const res = await request(app)
        .post('/api/v1/events/00000000-0000-0000-0000-000000000000/reviews')
        .set('X-API-Key', VALID_API_KEY)
        .set('Content-Type', 'application/json')
        .send('{ "action": "ACKNOWLEDGE", invalid_json }');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('MALFORMED_JSON');
    });

    it('prohibits destructive HTTP operations (e.g. DELETE /events/:id returns 404)', async () => {
      const res = await request(app).delete('/api/v1/events/00000000-0000-0000-0000-000000000000');

      expect(res.status).toBe(404);
    });
  });
});
