/**
 * @fileoverview Minimal Conjunction Event Lifecycle Manager
 * Handles physical encounter lifecycle transitions based on reference time.
 */

import { getPool } from '../../db/pool.js';
import { appendAuditEntry } from '../audit/auditLedger.js';

/**
 * Transitions events that have passed their predicted TCA to PAST_TCA.
 * Accepts an injectable referenceTime to allow deterministic testing.
 *
 * @param {object} [options]
 * @param {Date | string} [options.referenceTime=new Date()] - Simulated or wall-clock reference time
 * @param {number} [options.bufferMinutes=15] - Time buffer after TCA before transitioning
 * @param {string} [options.connectionString]
 * @param {import('pg').PoolClient} [options.client]
 * @returns {Promise<{
 *   transitionedCount: number,
 *   transitionedEvents: Array<{ id: string, canonicalPairKey: string, latestTca: string }>
 * }>}
 */
export async function reapPastTcaEvents(options = {}) {
  const referenceTime = options.referenceTime
    ? new Date(options.referenceTime).toISOString()
    : new Date().toISOString();
  const bufferMinutes = options.bufferMinutes !== undefined ? options.bufferMinutes : 15;

  const pool = options.client ? null : getPool(options.connectionString);
  const client = options.client || (await pool.connect());

  try {
    const res = await client.query(
      `UPDATE conjunction_events
       SET lifecycle_state = 'PAST_TCA',
           updated_at = NOW()
       WHERE lifecycle_state = 'MONITORING'
         AND latest_tca < ($1::timestamptz - ($2 || ' minutes')::interval)
       RETURNING id, canonical_pair_key, latest_tca;`,
      [referenceTime, bufferMinutes],
    );

    for (const row of res.rows) {
      await appendAuditEntry(client, {
        eventId: row.id,
        actionType: 'LIFECYCLE_TRANSITION',
        actorType: 'SYSTEM',
        actorId: 'VOIDLINE_ENGINE',
        payload: {
          previousState: 'MONITORING',
          newState: 'PAST_TCA',
          latestTca: row.latest_tca,
          referenceTime,
        },
      });
    }

    return {
      transitionedCount: res.rowCount,
      transitionedEvents: res.rows.map(r => ({
        id: r.id,
        canonicalPairKey: r.canonical_pair_key,
        latestTca: r.latest_tca.toISOString(),
      })),
    };
  } finally {
    if (!options.client) {
      client.release();
    }
  }
}
