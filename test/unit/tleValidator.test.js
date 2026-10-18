/**
 * @fileoverview Unit Tests for Two-Line Element (TLE) Validator & Parser
 */

import { describe, it, expect } from 'vitest';
import {
  validateTle,
  computeTleChecksum,
  parseTleEpoch,
} from '../../src/modules/propagation/tleValidator.js';

describe('Two-Line Element (TLE) Validator', () => {
  // Real ISS (ZARYA) NORAD 25544 TLE
  const validIssLine1 = '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9009';
  const validIssLine2 = '2 25544  51.6400 208.9163 0004780  69.9862  25.2906 15.49815016431907';

  it('validates a correct NORAD TLE pair successfully', () => {
    const result = validateTle(validIssLine1, validIssLine2);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.data).toBeDefined();
    expect(result.data.catalogNumber).toBe(25544);
    expect(result.data.inclinationDeg).toBeCloseTo(51.64, 2);
    expect(result.data.eccentricity).toBeCloseTo(0.000478, 6);
    expect(result.data.meanMotionRevDay).toBeCloseTo(15.49815, 4);
    expect(result.data.epoch.toISOString()).toBe('2024-01-01T12:00:00.000Z');
  });

  it('correctly calculates modulo-10 checksum according to NORAD rules', () => {
    expect(computeTleChecksum(validIssLine1)).toBe(9);
    expect(computeTleChecksum(validIssLine2)).toBe(7);
  });

  it('rejects TLE with corrupted checksum', () => {
    // Modify one digit on line 1 without updating checksum
    const corruptedLine1 = validIssLine1.slice(0, 68) + '0';
    const result = validateTle(corruptedLine1, validIssLine2);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Line 1 checksum failure'))).toBe(true);
  });

  it('rejects lines with invalid length (not 69 characters)', () => {
    const shortLine1 = '1 25544U 98067A   24001.50000000  .00016717';
    const result = validateTle(shortLine1, validIssLine2);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('exactly 69 characters'))).toBe(true);
  });

  it('rejects invalid line prefixes', () => {
    const badPrefix1 = '3' + validIssLine1.slice(1);
    const result = validateTle(badPrefix1, validIssLine2);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('must start with "1 "'))).toBe(true);
  });

  it('rejects mismatched catalog numbers between Line 1 and Line 2', () => {
    // Change catalog number on line 2 to 99999
    const line2Mismatched = '2 99999  51.6400 208.9163 0004780  69.9862  25.2906 15.4981501643190';
    const check = computeTleChecksum(line2Mismatched + '0');
    const fullLine2 = line2Mismatched + check;

    const result = validateTle(validIssLine1, fullLine2);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('mismatch'))).toBe(true);
  });

  it('accurately parses 20th and 21st century TLE epochs', () => {
    // 24001.50000000 -> 2024, day 1.5 -> Jan 1 12:00:00 UTC
    const date2024 = parseTleEpoch(validIssLine1);
    expect(date2024.toISOString()).toBe('2024-01-01T12:00:00.000Z');

    // 98300.00000000 -> 1998, day 300.0
    const line1998 = '1 25544U 98067A   98300.00000000  .00016717  00000-0  10270-3 0  9009';
    const date1998 = parseTleEpoch(line1998);
    expect(date1998.getUTCFullYear()).toBe(1998);
  });

  it('rejects non-string inputs cleanly', () => {
    const result = validateTle(null, undefined);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('must be strings');
  });
});
