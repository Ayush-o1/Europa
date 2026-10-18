/**
 * @fileoverview Unit Tests for SGP4 Propagator & Relative State Calculator
 */

import { describe, it, expect } from 'vitest';
import {
  initializeSatrec,
  propagateObject,
  calculateRelativeState,
  SGP4_ALGORITHM_METADATA,
} from '../../src/modules/propagation/sgp4Propagator.js';

describe('SGP4 Propagator & Relative State Engine', () => {
  // ISS (NORAD 25544)
  const issLine1 = '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9009';
  const issLine2 = '2 25544  51.6400 208.9163 0004780  69.9862  25.2906 15.49815016431907';

  // COSMOS 2251 Debris (NORAD 34454)
  const cosmosLine1 = '1 34454U 93036SX  24001.50000000  .00001234  00000-0  56789-4 0  9004';
  const cosmosLine2 = '2 34454  74.0400 210.1234 0021500 120.4500  45.6700 14.85000000213455';

  it('initializes satrec records with extracted metadata', () => {
    const { satrec, metadata } = initializeSatrec(issLine1, issLine2);

    expect(satrec).toBeDefined();
    expect(metadata.catalogNumber).toBe(25544);
    expect(metadata.epoch.toISOString()).toBe('2024-01-01T12:00:00.000Z');
  });

  it('propagates LEO object to target epoch within expected physical bounds', () => {
    const { satrec } = initializeSatrec(issLine1, issLine2);
    const targetDate = new Date('2024-01-01T12:00:00.000Z');

    const state = propagateObject(satrec, targetDate);

    expect(state.success).toBe(true);
    expect(state.positionKm).toBeDefined();
    expect(state.velocityKmS).toBeDefined();

    // ISS altitude is ~410-420 km, meaning radius from Earth center is ~6780-6800 km
    expect(state.radiusKm).toBeGreaterThan(6600);
    expect(state.radiusKm).toBeLessThan(7000);

    // LEO orbital speed is ~7.6-7.8 km/s
    expect(state.speedKmS).toBeGreaterThan(7.4);
    expect(state.speedKmS).toBeLessThan(8.0);
  });

  it('demonstrates orbital periodicity across one orbital period (~93 minutes)', () => {
    const { satrec } = initializeSatrec(issLine1, issLine2);
    const t0 = new Date('2024-01-01T12:00:00.000Z');
    // ISS completes ~15.5 orbits/day -> period is ~92.9 minutes
    const tOneOrbit = new Date(t0.getTime() + 92.915 * 60 * 1000);

    const state0 = propagateObject(satrec, t0);
    const state1 = propagateObject(satrec, tOneOrbit);

    expect(state0.success).toBe(true);
    expect(state1.success).toBe(true);

    // Geocentric orbital radius should return to approximately the same distance
    expect(Math.abs(state1.radiusKm - state0.radiusKm)).toBeLessThan(50);
  });

  it('calculates relative spatial and velocity state between two satellites', () => {
    const iss = initializeSatrec(issLine1, issLine2);
    const cosmos = initializeSatrec(cosmosLine1, cosmosLine2);
    const epoch = new Date('2024-01-01T12:00:00.000Z');

    const issState = propagateObject(iss.satrec, epoch);
    const cosmosState = propagateObject(cosmos.satrec, epoch);

    const relative = calculateRelativeState(issState, cosmosState);

    expect(relative.timestamp).toEqual(epoch);
    expect(relative.missDistanceKm).toBeGreaterThan(0);
    expect(relative.relativeSpeedKmS).toBeGreaterThan(0);
    expect(relative.relativePositionKm).toBeDefined();
    expect(relative.relativeVelocityKmS).toBeDefined();
  });

  it('returns clean error on invalid target date', () => {
    const { satrec } = initializeSatrec(issLine1, issLine2);
    const state = propagateObject(satrec, 'not-a-valid-date');

    expect(state.success).toBe(false);
    expect(state.error).toContain('Invalid targetDate');
  });

  it('preserves standardized scientific metadata and disclaimers', () => {
    expect(SGP4_ALGORITHM_METADATA.name).toBe('SGP4_SIMPLIFIED_PERTURBATIONS_VALLADO');
    expect(SGP4_ALGORITHM_METADATA.library).toContain('satellite.js');
    expect(SGP4_ALGORITHM_METADATA.scientificDisclaimer).toContain('EXPERIMENTAL SCREENING ONLY');
    expect(SGP4_ALGORITHM_METADATA.scientificDisclaimer).toContain(
      'MAX_PROB is an upper-bound screening metric',
    );
  });
});
