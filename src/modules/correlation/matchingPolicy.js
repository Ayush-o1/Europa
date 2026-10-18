/**
 * @fileoverview Pure Correlation Matching Policy Logic
 * Evaluates candidate conjunction events for an incoming observation using configurable drift heuristics.
 */

export const DEFAULT_MATCHING_POLICY = Object.freeze({
  stepToleranceMinutes: 20,
  maxCumulativeDriftMinutes: 45,
  policyVersion: 'v1.0.0',
});

/**
 * Evaluates candidate events against an incoming observation according to the matching policy.
 *
 * @param {object} observation - Incoming observation with { id, tca, capturedAt, tcaRangeKm }
 * @param {object[]} candidateEvents - Active candidate events for the same canonical object pair
 * @param {object} [customConfig] - Configurable heuristics override
 * @returns {{
 *   decisionType: 'EVENT_CREATED' | 'EVENT_MATCHED' | 'AMBIGUOUS_MATCH',
 *   targetEventId: string | null,
 *   candidateEventIds: string[],
 *   stepDriftMinutes: number | null,
 *   cumulativeDriftMinutes: number | null,
 *   matchingPolicyVersion: string,
 *   decisionReason: string
 * }}
 */
export function evaluateObservationMatch(observation, candidateEvents, customConfig = {}) {
  const config = {
    ...DEFAULT_MATCHING_POLICY,
    ...customConfig,
  };

  const obsTcaMs = new Date(observation.tca).getTime();

  // Case 1: No candidate events exist for this canonical pair
  if (!candidateEvents || candidateEvents.length === 0) {
    return {
      decisionType: 'EVENT_CREATED',
      targetEventId: null,
      candidateEventIds: [],
      stepDriftMinutes: null,
      cumulativeDriftMinutes: null,
      matchingPolicyVersion: config.policyVersion,
      decisionReason:
        'No active candidate events found for canonical object pair; created new encounter.',
    };
  }

  // Calculate drift metrics for each active candidate
  const evaluatedCandidates = candidateEvents.map(evt => {
    const latestTcaMs = new Date(evt.latest_tca || evt.latestTca).getTime();
    const initialTcaMs = new Date(evt.initial_tca || evt.initialTca).getTime();

    const stepDriftMinutes = Math.abs(obsTcaMs - latestTcaMs) / (1000 * 60);
    const cumulativeDriftMinutes = Math.abs(obsTcaMs - initialTcaMs) / (1000 * 60);

    const withinStep = stepDriftMinutes <= config.stepToleranceMinutes;
    const withinCumulative = cumulativeDriftMinutes <= config.maxCumulativeDriftMinutes;

    return {
      event: evt,
      eventId: evt.id,
      stepDriftMinutes: Number(stepDriftMinutes.toFixed(2)),
      cumulativeDriftMinutes: Number(cumulativeDriftMinutes.toFixed(2)),
      withinStep,
      withinCumulative,
      isFullySupported: withinStep && withinCumulative,
      isStepBreached: !withinStep && withinCumulative,
      isCumulativeBreached: withinStep && !withinCumulative,
      isOutsideBoth: !withinStep && !withinCumulative,
    };
  });

  const supported = evaluatedCandidates.filter(c => c.isFullySupported);
  const stepBreached = evaluatedCandidates.filter(c => c.isStepBreached);
  const cumulativeBreached = evaluatedCandidates.filter(c => c.isCumulativeBreached);
  const outsideBoth = evaluatedCandidates.filter(c => c.isOutsideBoth);

  // Case 2: Exactly one candidate satisfies BOTH step tolerance and cumulative ceiling, with zero competitors
  if (supported.length === 1 && stepBreached.length === 0 && cumulativeBreached.length === 0) {
    const match = supported[0];
    return {
      decisionType: 'EVENT_MATCHED',
      targetEventId: match.eventId,
      candidateEventIds: [match.eventId],
      stepDriftMinutes: match.stepDriftMinutes,
      cumulativeDriftMinutes: match.cumulativeDriftMinutes,
      matchingPolicyVersion: config.policyVersion,
      decisionReason: `Matched candidate event ${match.eventId}: step drift ${match.stepDriftMinutes}m <= ${config.stepToleranceMinutes}m, cumulative drift ${match.cumulativeDriftMinutes}m <= ${config.maxCumulativeDriftMinutes}m.`,
    };
  }

  // Case 3: Multiple candidates are fully supported (competing plausible events)
  if (supported.length > 1) {
    return {
      decisionType: 'AMBIGUOUS_MATCH',
      targetEventId: null,
      candidateEventIds: supported.map(c => c.eventId),
      stepDriftMinutes: supported[0].stepDriftMinutes,
      cumulativeDriftMinutes: supported[0].cumulativeDriftMinutes,
      matchingPolicyVersion: config.policyVersion,
      decisionReason: `Ambiguous match: observation falls within step tolerance (${config.stepToleranceMinutes}m) and cumulative limit (${config.maxCumulativeDriftMinutes}m) of ${supported.length} competing active events.`,
    };
  }

  // Case 4: Candidate falls within cumulative window but breaches step tolerance (possible continuity break or jump)
  if (stepBreached.length > 0) {
    const primary = stepBreached[0];
    return {
      decisionType: 'AMBIGUOUS_MATCH',
      targetEventId: null,
      candidateEventIds: stepBreached.map(c => c.eventId),
      stepDriftMinutes: primary.stepDriftMinutes,
      cumulativeDriftMinutes: primary.cumulativeDriftMinutes,
      matchingPolicyVersion: config.policyVersion,
      decisionReason: `Ambiguous continuity break: observation is within cumulative limit (${primary.cumulativeDriftMinutes}m <= ${config.maxCumulativeDriftMinutes}m) but exceeds step tolerance (${primary.stepDriftMinutes}m > ${config.stepToleranceMinutes}m). Requires operator review.`,
    };
  }

  // Case 5: Cumulative drift exceeds ceiling
  if (cumulativeBreached.length > 0) {
    const primary = cumulativeBreached[0];
    return {
      decisionType: 'AMBIGUOUS_MATCH',
      targetEventId: null,
      candidateEventIds: cumulativeBreached.map(c => c.eventId),
      stepDriftMinutes: primary.stepDriftMinutes,
      cumulativeDriftMinutes: primary.cumulativeDriftMinutes,
      matchingPolicyVersion: config.policyVersion,
      decisionReason: `Cumulative drift limit exceeded (${primary.cumulativeDriftMinutes}m > ${config.maxCumulativeDriftMinutes}m). Automated chaining stopped to prevent unbounded drift across revolutions.`,
    };
  }

  // Case 6: All existing candidates are far outside both horizons (e.g. separate orbit pass hours/days later)
  if (outsideBoth.length === evaluatedCandidates.length) {
    return {
      decisionType: 'EVENT_CREATED',
      targetEventId: null,
      candidateEventIds: outsideBoth.map(c => c.eventId),
      stepDriftMinutes: outsideBoth[0].stepDriftMinutes,
      cumulativeDriftMinutes: outsideBoth[0].cumulativeDriftMinutes,
      matchingPolicyVersion: config.policyVersion,
      decisionReason: `All ${outsideBoth.length} existing active events for pair exceed correlation horizons (step > ${config.stepToleranceMinutes}m and cumulative > ${config.maxCumulativeDriftMinutes}m); created distinct encounter event.`,
    };
  }

  // Fallback for edge cases
  return {
    decisionType: 'AMBIGUOUS_MATCH',
    targetEventId: null,
    candidateEventIds: evaluatedCandidates.map(c => c.eventId),
    stepDriftMinutes: evaluatedCandidates[0].stepDriftMinutes,
    cumulativeDriftMinutes: evaluatedCandidates[0].cumulativeDriftMinutes,
    matchingPolicyVersion: config.policyVersion,
    decisionReason:
      'Ambiguous correlation: observation does not satisfy a single unambiguous matching condition.',
  };
}
