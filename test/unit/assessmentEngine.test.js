/**
 * @fileoverview Pure Unit Tests for Assessment Engine
 */

import { describe, it, expect } from 'vitest';
import { assessConjunctionEvent } from '../../src/modules/assessment/assessmentEngine.js';
import {
  evaluateMissDistance,
  evaluateTimeToTca,
  evaluateProbability,
  evaluateDataFreshness,
  determineUrgencyLevel,
} from '../../src/modules/assessment/assessmentRules.js';

describe('Assessment Rules Component Unit Tests', () => {
  it('correctly evaluates miss distance steps', () => {
    expect(evaluateMissDistance(0.3).score).toBe(50);
    expect(evaluateMissDistance(0.8).score).toBe(40);
    expect(evaluateMissDistance(1.5).score).toBe(30);
    expect(evaluateMissDistance(3.5).score).toBe(20);
    expect(evaluateMissDistance(8.0).score).toBe(10);
    expect(evaluateMissDistance(15.0).score).toBe(0);
    expect(evaluateMissDistance(null).score).toBe(0);
    expect(evaluateMissDistance(-1).score).toBe(0);
  });

  it('correctly evaluates time remaining to TCA', () => {
    const ref = '2026-10-21T12:00:00.000Z';
    // 6 hours away
    expect(evaluateTimeToTca('2026-10-21T18:00:00.000Z', ref).score).toBe(30);
    // 18 hours away
    expect(evaluateTimeToTca('2026-10-22T06:00:00.000Z', ref).score).toBe(25);
    // 36 hours away
    expect(evaluateTimeToTca('2026-10-23T00:00:00.000Z', ref).score).toBe(20);
    // 60 hours away
    expect(evaluateTimeToTca('2026-10-24T00:00:00.000Z', ref).score).toBe(10);
    // 96 hours away
    expect(evaluateTimeToTca('2026-10-25T12:00:00.000Z', ref).score).toBe(0);
    // Passed TCA (2 hours ago)
    const passed = evaluateTimeToTca('2026-10-21T10:00:00.000Z', ref);
    expect(passed.score).toBe(0);
    expect(passed.reason).toContain('has passed');
  });

  it('correctly evaluates max collision probability', () => {
    expect(evaluateProbability(2.5e-4).score).toBe(15);
    expect(evaluateProbability(4.0e-5).score).toBe(10);
    expect(evaluateProbability(3.0e-6).score).toBe(5);
    expect(evaluateProbability(1.0e-7).score).toBe(0);
    expect(evaluateProbability(null).score).toBe(0);
    expect(evaluateProbability(null).reason).toContain('unpopulated');
  });

  it('correctly evaluates orbital data freshness (days since epoch)', () => {
    expect(evaluateDataFreshness(0.5, 0.8).score).toBe(5);
    expect(evaluateDataFreshness(1.2, 2.5).score).toBe(3);
    expect(evaluateDataFreshness(3.5, 4.0).score).toBe(0);
    expect(evaluateDataFreshness(null, null).score).toBe(0);
  });

  it('correctly maps scores to urgency levels', () => {
    expect(determineUrgencyLevel(85, 2.0, 30)).toBe('CRITICAL');
    expect(determineUrgencyLevel(65, 2.0, 30)).toBe('HIGH');
    expect(determineUrgencyLevel(45, 2.0, 30)).toBe('MEDIUM');
    expect(determineUrgencyLevel(20, 2.0, 30)).toBe('LOW');

    // Severe proximity override: miss distance < 0.5km within 24h triggers CRITICAL regardless of score
    expect(determineUrgencyLevel(50, 0.3, 10)).toBe('CRITICAL');
  });
});

describe('Pure Assessment Engine End-to-End Unit Tests', () => {
  const refTime = '2026-10-21T12:00:00.000Z';

  it('calculates maximum score and CRITICAL priority for severe close approach', () => {
    const event = {
      id: 'evt-001',
      latest_range_km: 0.25,
      latest_tca: '2026-10-21T18:00:00.000Z', // 6 hours remaining
    };
    const obs = {
      tca: '2026-10-21T18:00:00.000Z',
      tca_range_km: 0.25,
      max_probability: 2.0e-4,
      dse_1: 0.4,
      dse_2: 0.8,
      captured_at: refTime,
    };

    const result = assessConjunctionEvent(event, obs, { referenceTime: refTime });

    expect(result.score).toBe(100);
    expect(result.urgencyLevel).toBe('CRITICAL');
    expect(result.componentScores.missDistance.score).toBe(50);
    expect(result.componentScores.timeToTca.score).toBe(30);
    expect(result.componentScores.probability.score).toBe(15);
    expect(result.componentScores.dataFreshness.score).toBe(5);
    expect(result.isStale).toBe(false);
    expect(result.isValid).toBe(true);
    expect(result.explanations.length).toBeGreaterThanOrEqual(4);
  });

  it('calculates moderate score and MEDIUM priority when miss distance and time are moderate', () => {
    const event = { id: 'evt-002' };
    const obs = {
      tca: '2026-10-22T18:00:00.000Z', // 30 hours remaining -> 20 pts
      tca_range_km: 3.5, // 2-5 km -> 20 pts
      max_probability: null, // unpopulated -> 0 pts
      dse_1: 0.5, // fresh -> 5 pts
      dse_2: 0.6,
      captured_at: refTime,
    };

    const result = assessConjunctionEvent(event, obs, { referenceTime: refTime });

    expect(result.score).toBe(45);
    expect(result.urgencyLevel).toBe('MEDIUM');
    expect(result.componentScores.probability.reason).toContain('unpopulated');
  });

  it('triggers CRITICAL urgency override for < 0.5km miss distance within 24 hours even with lower total score', () => {
    const event = { id: 'evt-003' };
    const obs = {
      tca: '2026-10-22T06:00:00.000Z', // 18 hours remaining -> 25 pts
      tca_range_km: 0.4, // < 0.5 km -> 50 pts
      max_probability: null, // 0 pts
      dse_1: 4.5, // aged -> 0 pts
      dse_2: 5.0,
      captured_at: refTime,
    };

    const result = assessConjunctionEvent(event, obs, { referenceTime: refTime });

    // Score is 75 (or with 18h = 25 pts + 50 pts = 75)
    expect(result.score).toBe(75);
    expect(result.urgencyLevel).toBe('CRITICAL');
    expect(result.explanations.some(e => e.includes('CRITICAL'))).toBe(true);
  });

  it('handles events where TCA has already passed by marking isStale=true', () => {
    const event = {
      id: 'evt-004',
      latest_range_km: 1.0,
      latest_tca: '2026-10-21T08:00:00.000Z', // passed 4 hours before refTime
    };

    const result = assessConjunctionEvent(event, null, { referenceTime: refTime });

    expect(result.isStale).toBe(true);
    expect(result.componentScores.timeToTca.score).toBe(0);
    expect(result.componentScores.timeToTca.reason).toContain('has passed');
  });

  it('handles missing input data gracefully with isValid=false', () => {
    const emptyResult = assessConjunctionEvent({}, null, { referenceTime: refTime });

    expect(emptyResult.score).toBe(0);
    expect(emptyResult.urgencyLevel).toBe('LOW');
    expect(emptyResult.isValid).toBe(false);
  });
});
