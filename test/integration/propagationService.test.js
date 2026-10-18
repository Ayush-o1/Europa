/**
 * @fileoverview Integration Tests for Orbital Propagation API & Database Persistence
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPool, closePool, query } from '../../src/db/pool.js';
import { applyMigrations } from '../../src/db/migrator.js';
import { config } from '../../src/config/env.js';
import { resetTestDatabase } from '../helpers/dbCleanup.js';

describe('Orbital Propagation REST Endpoints & Database Persistence', () => {
  let app;
  const operatorKey = config.operatorApiKey || 'test-operator-key';

  const validPrimaryTle = {
    line1: '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9009',
    line2: '2 25544  51.6400 208.9163 0004780  69.9862  25.2906 15.49815016431907',
  };

  const validSecondaryTle = {
    line1: '1 34454U 93036SX  24001.50000000  .00001234  00000-0  56789-4 0  9004',
    line2: '2 34454  74.0400 210.1234 0021500 120.4500  45.6700 14.85000000213455',
  };

  beforeAll(async () => {
    getPool(config.databaseUrl);
    await applyMigrations({ connectionString: config.databaseUrl });
    app = createApp();
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  async function createTestEvent() {
    // Insert prerequisite space objects
    await query(
      `INSERT INTO space_objects (norad_cat_id, object_name)
       VALUES (25544, 'ISS (ZARYA)'), (34454, 'COSMOS 2251 DEB')
       ON CONFLICT (norad_cat_id) DO NOTHING;`,
    );

    const eventRes = await query(
      `INSERT INTO conjunction_events (
         primary_object_id, secondary_object_id, canonical_pair_key,
         initial_tca, initial_captured_at, latest_tca, latest_captured_at,
         latest_range_km, min_predicted_range_km,
         observation_count, urgency_level, lifecycle_state, review_status, tracking_state
       ) VALUES (
         25544, 34454, '25544:34454',
         '2024-01-01T12:00:00.000Z', NOW(), '2024-01-01T12:00:00.000Z', NOW(),
         4.5000, 4.5000,
         1, 'MEDIUM', 'MONITORING', 'UNREVIEWED', 'CONFIRMED'
       ) RETURNING id;`,
    );

    return eventRes.rows[0].id;
  }

  describe('POST /api/v1/propagation/estimate', () => {
    it('computes on-demand encounter estimation without persisting when eventId is omitted', async () => {
      const res = await request(app).post('/api/v1/propagation/estimate').send({
        primaryTle: validPrimaryTle,
        secondaryTle: validSecondaryTle,
        nominalTca: '2024-01-01T12:00:00.000Z',
        searchWindowMinutes: 5,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.persisted).toBe(false);
      expect(res.body.data.estimatedTca).toBeDefined();
      expect(res.body.data.estimatedMissDistanceKm).toBeGreaterThan(0);
      expect(res.body.data.estimatedRelativeSpeedKmS).toBeGreaterThan(0);
      expect(res.body.data.scientificDisclaimer).toContain('EXPERIMENTAL SCREENING ONLY');

      // Verify no records in orbital_screenings
      const countRes = await query('SELECT COUNT(*) FROM orbital_screenings;');
      expect(parseInt(countRes.rows[0].count, 10)).toBe(0);
    });

    it('rejects persisting a screening without operator authentication', async () => {
      const eventId = await createTestEvent();

      const res = await request(app).post('/api/v1/propagation/estimate').send({
        primaryTle: validPrimaryTle,
        secondaryTle: validSecondaryTle,
        nominalTca: '2024-01-01T12:00:00.000Z',
        eventId,
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('persists screening to orbital_screenings and appends to audit ledger with valid operator auth', async () => {
      const eventId = await createTestEvent();

      const res = await request(app)
        .post('/api/v1/propagation/estimate')
        .set('X-API-Key', operatorKey)
        .set('X-Actor-Id', 'flight-dynamics-1')
        .send({
          primaryTle: validPrimaryTle,
          secondaryTle: validSecondaryTle,
          nominalTca: '2024-01-01T12:00:00.000Z',
          searchWindowMinutes: 10,
          stepSeconds: 5,
          eventId,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.persisted).toBe(true);
      expect(res.body.data.screeningId).toBeDefined();

      // Verify orbital_screenings row
      const screeningRes = await query(`SELECT * FROM orbital_screenings WHERE id = $1;`, [
        res.body.data.screeningId,
      ]);
      expect(screeningRes.rows).toHaveLength(1);
      const row = screeningRes.rows[0];
      expect(row.event_id).toBe(eventId);
      expect(row.primary_object_id).toBe(25544);
      expect(row.secondary_object_id).toBe(34454);
      expect(parseFloat(row.estimated_miss_distance_km)).toBeCloseTo(
        res.body.data.estimatedMissDistanceKm,
        4,
      );

      // Verify audit_ledger append
      const auditRes = await query(
        `SELECT * FROM audit_ledger WHERE event_id = $1 AND action_type = 'ORBITAL_SCREENING_COMPUTED';`,
        [eventId],
      );
      expect(auditRes.rows).toHaveLength(1);
      expect(auditRes.rows[0].actor_id).toBe('flight-dynamics-1');
      expect(auditRes.rows[0].payload.screeningId).toBe(res.body.data.screeningId);
    });

    it('validates request payload and rejects malformed TLE or search parameters', async () => {
      const badRes = await request(app)
        .post('/api/v1/propagation/estimate')
        .send({
          primaryTle: { line1: 'short', line2: 'short' },
          secondaryTle: validSecondaryTle,
          nominalTca: '2024-01-01T12:00:00.000Z',
        });

      expect(badRes.status).toBe(400);
      expect(badRes.body.success).toBe(false);
      expect(badRes.body.error.code).toBe('PROPAGATION_ERROR');
    });
  });

  describe('GET /api/v1/events/:id/propagation', () => {
    it('retrieves historical orbital screenings for a conjunction event', async () => {
      const eventId = await createTestEvent();

      // Submit one screening
      await request(app).post('/api/v1/propagation/estimate').set('X-API-Key', operatorKey).send({
        primaryTle: validPrimaryTle,
        secondaryTle: validSecondaryTle,
        nominalTca: '2024-01-01T12:00:00.000Z',
        eventId,
      });

      const res = await request(app).get(`/api/v1/events/${eventId}/propagation`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.count).toBe(1);
      expect(res.body.data.screenings[0].primaryObjectId).toBe(25544);
      expect(res.body.data.screenings[0].secondaryObjectId).toBe(34454);
    });
  });
});
