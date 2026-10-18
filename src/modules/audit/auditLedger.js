/**
 * @fileoverview Cryptographic Audit Ledger
 *
 * Implements an append-only, SHA-256 hash-chained audit ledger tracking
 * conjunction events, correlation decisions, assessments, and operator reviews.
 *
 * Limitation Notice: Database-local hash chaining detects alterations or deletions
 * performed via standard SQL, but does not prevent root database administrative manipulation
 * without external distributed anchoring.
 */

import crypto from 'node:crypto';
import { getPool } from '../../db/pool.js';

export const GENESIS_PREV_HASH = '0'.repeat(64);
const AUDIT_LEDGER_ADVISORY_LOCK_ID = 737373;

/**
 * Deterministically serializes objects by recursively sorting keys.
 * @param {any} obj
 * @returns {string}
 */
export function canonicalStringify(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map(item => canonicalStringify(item)).join(',')}]`;
  }

  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map(key => `${JSON.stringify(key)}:${canonicalStringify(obj[key])}`);
  return `{${entries.join(',')}}`;
}

/**
 * Computes SHA-256 entry hash over canonical components.
 * @param {object} params
 * @param {number | string} params.sequenceNumber
 * @param {string} params.actionType
 * @param {string} params.actorType
 * @param {string} params.actorId
 * @param {string} params.canonicalPayload
 * @param {string} params.prevHash
 * @param {string} params.createdAtIso
 * @returns {string} Hex SHA-256 digest
 */
export function computeEntryHash({
  sequenceNumber,
  actionType,
  actorType,
  actorId,
  canonicalPayload,
  prevHash,
  createdAtIso,
}) {
  const message = `${sequenceNumber}|${actionType}|${actorType}|${actorId}|${canonicalPayload}|${prevHash}|${createdAtIso}`;
  return crypto.createHash('sha256').update(message).digest('hex');
}

/**
 * Appends a new verified entry to the cryptographic audit ledger.
 * Serializes writes using an advisory transaction lock to guarantee chain continuity.
 *
 * @param {object} client - PostgreSQL client (within transaction)
 * @param {object} entry
 * @param {string | null} [entry.eventId=null]
 * @param {string} entry.actionType
 * @param {'SYSTEM' | 'OPERATOR'} [entry.actorType='SYSTEM']
 * @param {string} entry.actorId
 * @param {object} entry.payload
 * @param {Date | string} [entry.createdAt]
 * @returns {Promise<object>} Created audit entry
 */
export async function appendAuditEntry(client, entry) {
  // 1. Acquire transaction advisory lock to serialize ledger head appends
  await client.query('SELECT pg_advisory_xact_lock($1);', [AUDIT_LEDGER_ADVISORY_LOCK_ID]);

  // 2. Fetch latest ledger entry to determine predecessor hash and sequence number
  const latestRes = await client.query(
    `SELECT sequence_number, entry_hash
     FROM audit_ledger
     ORDER BY sequence_number DESC
     LIMIT 1;`,
  );

  let prevHash = GENESIS_PREV_HASH;
  let nextSeq = 1;

  if (latestRes.rows.length > 0) {
    prevHash = latestRes.rows[0].entry_hash;
    nextSeq = parseInt(latestRes.rows[0].sequence_number, 10) + 1;
  }

  const actorType = entry.actorType || 'SYSTEM';
  const createdAtDate = entry.createdAt ? new Date(entry.createdAt) : new Date();
  const createdAtIso = createdAtDate.toISOString();
  const canonicalPayload = canonicalStringify(entry.payload || {});

  const entryHash = computeEntryHash({
    sequenceNumber: nextSeq,
    actionType: entry.actionType,
    actorType,
    actorId: entry.actorId,
    canonicalPayload,
    prevHash,
    createdAtIso,
  });

  const res = await client.query(
    `INSERT INTO audit_ledger (
       sequence_number,
       event_id,
       action_type,
       actor_type,
       actor_id,
       payload,
       prev_hash,
       entry_hash,
       created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *;`,
    [
      nextSeq,
      entry.eventId || null,
      entry.actionType,
      actorType,
      entry.actorId,
      canonicalPayload,
      prevHash,
      entryHash,
      createdAtDate,
    ],
  );

  return res.rows[0];
}

/**
 * Verifies the integrity of the audit ledger from genesis to head.
 * Detects broken links, modified payloads, invalid predecessor hashes, or missing sequences.
 *
 * @param {object} [options={}]
 * @param {object} [options.client]
 * @returns {Promise<{
 *   valid: boolean,
 *   totalEntries: number,
 *   error: string | null,
 *   failedAtSequence: number | null
 * }>}
 */
export async function verifyAuditLedger(options = {}) {
  const db = options.client || getPool();
  const res = await db.query(
    `SELECT * FROM audit_ledger
     ORDER BY sequence_number ASC;`,
  );

  const entries = res.rows;
  if (entries.length === 0) {
    return {
      valid: true,
      totalEntries: 0,
      error: null,
      failedAtSequence: null,
    };
  }

  let expectedPrevHash = GENESIS_PREV_HASH;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const seq = parseInt(entry.sequence_number, 10);
    const expectedSeq = i + 1;

    // Check sequence continuity
    if (seq !== expectedSeq) {
      return {
        valid: false,
        totalEntries: entries.length,
        error: `Sequence gap detected: expected ${expectedSeq}, got ${seq}`,
        failedAtSequence: seq,
      };
    }

    // Check predecessor hash link
    if (entry.prev_hash !== expectedPrevHash) {
      return {
        valid: false,
        totalEntries: entries.length,
        error: `Predecessor hash mismatch at sequence ${seq}: expected ${expectedPrevHash}, got ${entry.prev_hash}`,
        failedAtSequence: seq,
      };
    }

    // Recompute and verify entry hash
    const canonicalPayload = canonicalStringify(entry.payload);
    const createdAtIso = new Date(entry.created_at).toISOString();
    const computedHash = computeEntryHash({
      sequenceNumber: seq,
      actionType: entry.action_type,
      actorType: entry.actor_type,
      actorId: entry.actor_id,
      canonicalPayload,
      prevHash: entry.prev_hash,
      createdAtIso,
    });

    if (computedHash !== entry.entry_hash) {
      return {
        valid: false,
        totalEntries: entries.length,
        error: `Entry hash verification failed at sequence ${seq}: expected ${computedHash}, got ${entry.entry_hash}`,
        failedAtSequence: seq,
      };
    }

    expectedPrevHash = entry.entry_hash;
  }

  return {
    valid: true,
    totalEntries: entries.length,
    error: null,
    failedAtSequence: null,
  };
}

/**
 * Retrieves audit trail for a specific event.
 *
 * @param {string} eventId
 * @param {object} [options={}]
 * @param {object} [options.client]
 * @returns {Promise<Array<object>>}
 */
export async function getEventAuditTrail(eventId, options = {}) {
  const db = options.client || getPool();
  const res = await db.query(
    `SELECT * FROM audit_ledger
     WHERE event_id = $1
     ORDER BY sequence_number ASC;`,
    [eventId],
  );
  return res.rows;
}
