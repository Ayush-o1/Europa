/**
 * @fileoverview Pure Assessment Engine for Conjunction Events
 *
 * Implements deterministic, explainable scoring and review-priority classification
 * without external database or network dependencies.
 */

import {
  DEFAULT_RULE_CONFIG,
  DEFAULT_RULE_SET_VERSION,
  evaluateMissDistance,
  evaluateTimeToTca,
  evaluateProbability,
  evaluateDataFreshness,
  determineUrgencyLevel,
} from './assessmentRules.js';

/**
 * Pure evaluation function assessing a conjunction event and its latest observation.
 *
 * @param {object} event - Conjunction event record
 * @param {object} [observation] - Latest raw observation record
 * @param {object} [options={}]
 * @param {Date | string} [options.referenceTime] - Injectable clock for deterministic testing
 * @param {object} [options.ruleConfig] - Custom rule configuration
 * @param {string} [options.ruleSetVersion] - Version of rule set used
 * @returns {object} Assessment result
 */
export function assessConjunctionEvent(event, observation = null, options = {}) {
  const ruleConfig = options.ruleConfig || DEFAULT_RULE_CONFIG;
  const ruleSetVersion = options.ruleSetVersion || ruleConfig.version || DEFAULT_RULE_SET_VERSION;

  // Resolve inputs from observation (preferred) or event record
  const rangeKm = observation?.tca_range_km ?? event?.latest_range_km ?? null;
  const tca = observation?.tca ?? event?.latest_tca ?? null;
  const maxProb = observation?.max_prob ?? observation?.max_probability ?? null;
  const dse1 = observation?.dse_primary ?? observation?.dse_1 ?? null;
  const dse2 = observation?.dse_secondary ?? observation?.dse_2 ?? null;

  // Reference time: options.referenceTime -> observation.captured_at -> event.latest_captured_at -> now
  const referenceTime =
    options.referenceTime ||
    observation?.captured_at ||
    event?.latest_captured_at ||
    new Date().toISOString();

  // Evaluate individual components
  const missDistanceComp = evaluateMissDistance(rangeKm, ruleConfig);
  const timeToTcaComp = evaluateTimeToTca(tca, referenceTime, ruleConfig);
  const probComp = evaluateProbability(maxProb, ruleConfig);
  const freshnessComp = evaluateDataFreshness(dse1, dse2, ruleConfig);

  const rawScore =
    missDistanceComp.score + timeToTcaComp.score + probComp.score + freshnessComp.score;
  const score = Math.min(100, Math.max(0, parseFloat(rawScore.toFixed(2))));

  const urgencyLevel = determineUrgencyLevel(
    score,
    missDistanceComp.value,
    timeToTcaComp.value,
    ruleConfig,
  );

  const explanations = [
    `Assigned score of ${score}/100 resulting in ${urgencyLevel} review priority under rule set ${ruleSetVersion}.`,
    missDistanceComp.reason,
    timeToTcaComp.reason,
    probComp.reason,
    freshnessComp.reason,
  ];

  if (urgencyLevel === 'CRITICAL' && score < ruleConfig.classification.criticalScore) {
    explanations.push(
      'Triggered CRITICAL priority override: miss distance < 0.5 km within 24 hours of TCA.',
    );
  }

  const isStale = timeToTcaComp.value !== null && timeToTcaComp.value <= 0; // TCA already passed relative to reference time
  const isValid = missDistanceComp.value !== null && timeToTcaComp.value !== null;

  return {
    score,
    urgencyLevel,
    ruleSetVersion,
    componentScores: {
      missDistance: {
        score: missDistanceComp.score,
        maxScore: ruleConfig.weights.missDistance,
        value: missDistanceComp.value,
        reason: missDistanceComp.reason,
      },
      timeToTca: {
        score: timeToTcaComp.score,
        maxScore: ruleConfig.weights.timeToTca,
        value: timeToTcaComp.value,
        reason: timeToTcaComp.reason,
      },
      probability: {
        score: probComp.score,
        maxScore: ruleConfig.weights.probability,
        value: probComp.value,
        reason: probComp.reason,
      },
      dataFreshness: {
        score: freshnessComp.score,
        maxScore: ruleConfig.weights.dataFreshness,
        value: freshnessComp.value,
        reason: freshnessComp.reason,
      },
    },
    inputSnapshot: {
      tca,
      missDistanceKm: missDistanceComp.value,
      timeToTcaHours: timeToTcaComp.value,
      maxProbability: probComp.value,
      dse1: typeof dse1 === 'number' ? dse1 : null,
      dse2: typeof dse2 === 'number' ? dse2 : null,
      referenceTime: new Date(referenceTime).toISOString(),
    },
    explanations,
    evaluatedAt: new Date(referenceTime),
    isStale,
    isValid,
  };
}
