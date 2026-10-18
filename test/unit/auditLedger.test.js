/**
 * @fileoverview Pure Unit Tests for Cryptographic Audit Ledger
 */

import { describe, it, expect } from 'vitest';
import {
  canonicalStringify,
  computeEntryHash,
  GENESIS_PREV_HASH,
} from '../../src/modules/audit/auditLedger.js';

describe('Audit Ledger Pure Functions Unit Tests', () => {
  it('canonicalStringify sorts keys recursively regardless of property definition order', () => {
    const objA = { z: 1, a: 2, m: { y: 10, x: 20 } };
    const objB = { a: 2, m: { x: 20, y: 10 }, z: 1 };

    expect(canonicalStringify(objA)).toBe(canonicalStringify(objB));
    expect(canonicalStringify(objA)).toBe('{"a":2,"m":{"x":20,"y":10},"z":1}');
  });

  it('canonicalStringify handles arrays and primitive types deterministically', () => {
    expect(canonicalStringify([3, 2, 1])).toBe('[3,2,1]');
    expect(canonicalStringify(null)).toBe('null');
    expect(canonicalStringify('hello')).toBe('"hello"');
    expect(canonicalStringify(42)).toBe('42');
  });

  it('computeEntryHash produces a 64-character lowercase hex SHA-256 hash', () => {
    const hash = computeEntryHash({
      sequenceNumber: 1,
      actionType: 'EVENT_CREATED',
      actorType: 'SYSTEM',
      actorId: 'EUROPA_ENGINE',
      canonicalPayload: '{"test":123}',
      prevHash: GENESIS_PREV_HASH,
      createdAtIso: '2026-10-21T14:30:00.000Z',
    });

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computeEntryHash is sensitive to any payload or metadata modification', () => {
    const baseParams = {
      sequenceNumber: 1,
      actionType: 'EVENT_CREATED',
      actorType: 'SYSTEM',
      actorId: 'EUROPA_ENGINE',
      canonicalPayload: '{"score":50}',
      prevHash: GENESIS_PREV_HASH,
      createdAtIso: '2026-10-21T14:30:00.000Z',
    };

    const originalHash = computeEntryHash(baseParams);

    // Tampered payload
    const tamperedPayloadHash = computeEntryHash({
      ...baseParams,
      canonicalPayload: '{"score":51}',
    });
    expect(tamperedPayloadHash).not.toBe(originalHash);

    // Tampered sequence
    const tamperedSeqHash = computeEntryHash({
      ...baseParams,
      sequenceNumber: 2,
    });
    expect(tamperedSeqHash).not.toBe(originalHash);

    // Tampered predecessor hash
    const tamperedPrevHash = computeEntryHash({
      ...baseParams,
      prevHash: 'a'.repeat(64),
    });
    expect(tamperedPrevHash).not.toBe(originalHash);
  });

  it('GENESIS_PREV_HASH is a 64-character zero string', () => {
    expect(GENESIS_PREV_HASH).toBe('0'.repeat(64));
    expect(GENESIS_PREV_HASH.length).toBe(64);
  });
});
