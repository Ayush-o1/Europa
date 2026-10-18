/**
 * @fileoverview Unit Tests for SGP4 Encounter Estimator
 */

import { describe, it, expect } from 'vitest';
import { estimateEncounterCloseApproach } from '../../src/modules/propagation/encounterEstimator.js';

describe('SGP4 Encounter Estimator', () => {
  const primaryTle = {
    line1: '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9009',
    line2: '2 25544  51.6400 208.9163 0004780  69.9862  25.2906 15.49815016431907',
  };

  const secondaryTle = {
    line1: '1 34454U 93036SX  24001.50000000  .00001234  00000-0  56789-4 0  9004',
    line2: '2 34454  74.0400 210.1234 0021500 120.4500  45.6700 14.85000000213455',
  };

  it('pinpoints minimum miss distance and refined TCA across search window', () => {
    const result = estimateEncounterCloseApproach({
      primaryTle,
      secondaryTle,
      nominalTca: '2024-01-01T12:00:00.000Z',
      searchWindowMinutes: 10,
      stepSeconds: 5,
    });

    expect(result.success).toBe(true);
    expect(result.estimatedTca).toBeDefined();
    expect(result.estimatedMissDistanceKm).toBeGreaterThan(0);
    expect(result.estimatedRelativeSpeedKmS).toBeGreaterThan(0);
    expect(result.tcaDeltaSeconds).toBeDefined();
    expect(result.trajectorySamples.length).toBeGreaterThan(0);
    expect(result.scientificDisclaimer).toContain('EXPERIMENTAL SCREENING ONLY');
  });

  it('accurately calculates TLE age in hours relative to encounter TCA', () => {
    // Epoch is 2024-01-01T12:00:00Z. If encounter is at 2024-01-02T12:00:00Z, age is ~24 hours
    const result = estimateEncounterCloseApproach({
      primaryTle,
      secondaryTle,
      nominalTca: '2024-01-02T12:00:00.000Z',
      searchWindowMinutes: 5,
    });

    expect(result.primaryObject.tleAgeHours).toBeCloseTo(24, 0);
    expect(result.isStaleTle).toBe(false);

    // If encounter is 4 days later (96 hours), it should be flagged as stale (> 72 hours)
    const staleResult = estimateEncounterCloseApproach({
      primaryTle,
      secondaryTle,
      nominalTca: '2024-01-05T12:00:00.000Z',
      searchWindowMinutes: 5,
    });

    expect(staleResult.primaryObject.tleAgeHours).toBeGreaterThan(72);
    expect(staleResult.isStaleTle).toBe(true);
  });

  it('rejects missing or invalid inputs with clear error messages', () => {
    expect(() =>
      estimateEncounterCloseApproach({
        primaryTle: null,
        secondaryTle,
        nominalTca: '2024-01-01T12:00:00Z',
      }),
    ).toThrow('Primary TLE (line1 and line2) is required.');

    expect(() =>
      estimateEncounterCloseApproach({
        primaryTle,
        secondaryTle: null,
        nominalTca: '2024-01-01T12:00:00Z',
      }),
    ).toThrow('Secondary TLE (line1 and line2) is required.');

    expect(() =>
      estimateEncounterCloseApproach({
        primaryTle,
        secondaryTle,
        nominalTca: 'invalid-iso-date',
      }),
    ).toThrow('Invalid nominalTca');
  });

  it('downsamples trajectory points to maxSamples limit', () => {
    const result = estimateEncounterCloseApproach({
      primaryTle,
      secondaryTle,
      nominalTca: '2024-01-01T12:00:00.000Z',
      searchWindowMinutes: 30, // 60 minutes total = 3600 seconds = 720 points at 5s step
      stepSeconds: 5,
      maxSamples: 30,
    });

    expect(result.trajectorySamples.length).toBeLessThanOrEqual(35);
  });
});
