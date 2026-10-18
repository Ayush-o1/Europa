/**
 * @fileoverview Pure Unit Tests for Correlation Matching Policy
 */

import { describe, it, expect } from 'vitest';
import { evaluateObservationMatch } from '../../src/modules/correlation/matchingPolicy.js';

describe('Correlation Matching Policy Unit Tests', () => {
  const baseTca = '2026-10-21T14:30:00.000Z';

  it('creates new event when zero candidate events exist', () => {
    const obs = { tca: baseTca };
    const result = evaluateObservationMatch(obs, []);

    expect(result.decisionType).toBe('EVENT_CREATED');
    expect(result.targetEventId).toBeNull();
    expect(result.candidateEventIds.length).toBe(0);
  });

  it('matches single candidate event within step and cumulative tolerances', () => {
    // 5 minutes later than latest_tca (well within 20m step and 45m cumulative)
    const obs = { tca: '2026-10-21T14:35:00.000Z' };
    const candidate = {
      id: 'evt-001',
      initial_tca: baseTca,
      latest_tca: baseTca,
    };

    const result = evaluateObservationMatch(obs, [candidate]);

    expect(result.decisionType).toBe('EVENT_MATCHED');
    expect(result.targetEventId).toBe('evt-001');
    expect(result.stepDriftMinutes).toBe(5);
    expect(result.cumulativeDriftMinutes).toBe(5);
  });

  it('flags ambiguous match when observation breaches step tolerance but remains within cumulative window', () => {
    // Initial TCA at 14:00, latest at 14:00. New obs at 14:25 (+25 min step drift > 20m, but 25m <= 45m cumulative)
    const obs = { tca: '2026-10-21T14:25:00.000Z' };
    const candidate = {
      id: 'evt-001',
      initial_tca: '2026-10-21T14:00:00.000Z',
      latest_tca: '2026-10-21T14:00:00.000Z',
    };

    const result = evaluateObservationMatch(obs, [candidate]);

    expect(result.decisionType).toBe('AMBIGUOUS_MATCH');
    expect(result.targetEventId).toBeNull();
    expect(result.candidateEventIds).toContain('evt-001');
    expect(result.decisionReason).toContain('exceeds step tolerance');
  });

  it('flags ambiguous match when cumulative drift ceiling (45m) is breached', () => {
    // Latest TCA was at 14:40 (+10m step drift from 14:50), but initial TCA was at 14:00 (+50m cumulative drift > 45m)
    const obs = { tca: '2026-10-21T14:50:00.000Z' };
    const candidate = {
      id: 'evt-001',
      initial_tca: '2026-10-21T14:00:00.000Z',
      latest_tca: '2026-10-21T14:40:00.000Z',
    };

    const result = evaluateObservationMatch(obs, [candidate]);

    expect(result.decisionType).toBe('AMBIGUOUS_MATCH');
    expect(result.targetEventId).toBeNull();
    expect(result.candidateEventIds).toContain('evt-001');
    expect(result.decisionReason).toContain('Cumulative drift limit exceeded');
  });

  it('flags ambiguous match when multiple candidate events are equally plausible', () => {
    const obs = { tca: '2026-10-21T14:32:00.000Z' };
    const candidateA = {
      id: 'evt-A',
      initial_tca: '2026-10-21T14:30:00.000Z',
      latest_tca: '2026-10-21T14:30:00.000Z',
    };
    const candidateB = {
      id: 'evt-B',
      initial_tca: '2026-10-21T14:35:00.000Z',
      latest_tca: '2026-10-21T14:35:00.000Z',
    };

    const result = evaluateObservationMatch(obs, [candidateA, candidateB]);

    expect(result.decisionType).toBe('AMBIGUOUS_MATCH');
    expect(result.targetEventId).toBeNull();
    expect(result.candidateEventIds).toContain('evt-A');
    expect(result.candidateEventIds).toContain('evt-B');
  });

  it('creates new event when all existing candidate events are far outside correlation horizons (e.g. 24h later)', () => {
    // New obs is 24 hours later
    const obs = { tca: '2026-10-22T14:30:00.000Z' };
    const yesterdayCandidate = {
      id: 'evt-yesterday',
      initial_tca: '2026-10-21T14:30:00.000Z',
      latest_tca: '2026-10-21T14:30:00.000Z',
    };

    const result = evaluateObservationMatch(obs, [yesterdayCandidate]);

    expect(result.decisionType).toBe('EVENT_CREATED');
    expect(result.targetEventId).toBeNull();
  });
});
