/**
 * @fileoverview Assessment Rules Configuration and Heuristic Evaluators
 *
 * Provides deterministic, explainable scoring components for satellite close-approach
 * review priority. Note: This is an operational review-priority heuristic, not a
 * scientifically certified collision probability.
 */

export const DEFAULT_RULE_SET_VERSION = 'v1.0.0-heuristic';

export const DEFAULT_RULE_CONFIG = {
  version: 'v1.0.0-heuristic',
  name: 'Standard Operational Screening Heuristic',
  description:
    'Explainable 100-point priority scoring evaluating miss distance (50%), time to TCA (30%), upper-bound screening probability metric (15%), and orbit data freshness (5%).',
  weights: {
    missDistance: 50,
    timeToTca: 30,
    probability: 15,
    dataFreshness: 5,
  },
  thresholds: {
    missDistanceKm: {
      critical: 0.5,
      high: 1.0,
      medium: 2.0,
      moderate: 5.0,
      low: 10.0,
    },
    timeToTcaHours: {
      critical: 12,
      high: 24,
      medium: 48,
      low: 72,
    },
    probability: {
      high: 1e-4,
      elevated: 1e-5,
      moderate: 1e-6,
    },
    dataFreshnessDays: {
      fresh: 1.0,
      acceptable: 3.0,
    },
  },
  classification: {
    criticalScore: 75,
    highScore: 55,
    mediumScore: 35,
  },
};

/**
 * Evaluates miss distance component (max 50 points).
 * @param {number | null} rangeKm
 * @param {object} [config=DEFAULT_RULE_CONFIG]
 * @returns {{ score: number, value: number | null, reason: string }}
 */
export function evaluateMissDistance(rangeKm, config = DEFAULT_RULE_CONFIG) {
  if (rangeKm === null || rangeKm === undefined) {
    return {
      score: 0,
      value: null,
      reason: 'Predicted miss distance is unpopulated or invalid.',
    };
  }

  const num = typeof rangeKm === 'number' ? rangeKm : parseFloat(rangeKm);
  if (isNaN(num) || num < 0) {
    return {
      score: 0,
      value: null,
      reason: 'Predicted miss distance is unpopulated or invalid.',
    };
  }

  const th = config.thresholds.missDistanceKm;
  if (num < th.critical) {
    return {
      score: 50,
      value: num,
      reason: `Predicted miss distance < ${th.critical} km (critical proximity: ${num.toFixed(3)} km).`,
    };
  }
  if (num < th.high) {
    return {
      score: 40,
      value: num,
      reason: `Predicted miss distance ${th.critical}-${th.high} km (high proximity: ${num.toFixed(3)} km).`,
    };
  }
  if (num < th.medium) {
    return {
      score: 30,
      value: num,
      reason: `Predicted miss distance ${th.high}-${th.medium} km (moderate proximity: ${num.toFixed(3)} km).`,
    };
  }
  if (num < th.moderate) {
    return {
      score: 20,
      value: num,
      reason: `Predicted miss distance ${th.medium}-${th.moderate} km (screening proximity: ${num.toFixed(3)} km).`,
    };
  }
  if (num < th.low) {
    return {
      score: 10,
      value: num,
      reason: `Predicted miss distance ${th.moderate}-${th.low} km (extended screening: ${num.toFixed(3)} km).`,
    };
  }

  return {
    score: 0,
    value: num,
    reason: `Predicted miss distance >= ${th.low} km (wide separation: ${num.toFixed(3)} km).`,
  };
}

/**
 * Evaluates time remaining until predicted TCA (max 30 points).
 * @param {Date | string | null} tca
 * @param {Date | string} referenceTime
 * @param {object} [config=DEFAULT_RULE_CONFIG]
 * @returns {{ score: number, value: number | null, reason: string }}
 */
export function evaluateTimeToTca(tca, referenceTime, config = DEFAULT_RULE_CONFIG) {
  if (!tca) {
    return {
      score: 0,
      value: null,
      reason: 'Predicted TCA is unpopulated.',
    };
  }

  const tcaMs = new Date(tca).getTime();
  const refMs = new Date(referenceTime).getTime();

  if (isNaN(tcaMs) || isNaN(refMs)) {
    return {
      score: 0,
      value: null,
      reason: 'Invalid TCA or reference timestamp provided.',
    };
  }

  const hoursRemaining = (tcaMs - refMs) / (1000 * 60 * 60);
  const th = config.thresholds.timeToTcaHours;

  if (hoursRemaining <= 0) {
    return {
      score: 0,
      value: hoursRemaining,
      reason: `Predicted TCA has passed (${Math.abs(hoursRemaining).toFixed(1)} hours ago).`,
    };
  }
  if (hoursRemaining < th.critical) {
    return {
      score: 30,
      value: hoursRemaining,
      reason: `Predicted TCA within ${th.critical} hours (${hoursRemaining.toFixed(1)} h remaining; immediate screening priority).`,
    };
  }
  if (hoursRemaining < th.high) {
    return {
      score: 25,
      value: hoursRemaining,
      reason: `Predicted TCA within ${th.critical}-${th.high} hours (${hoursRemaining.toFixed(1)} h remaining; imminent conjunction).`,
    };
  }
  if (hoursRemaining < th.medium) {
    return {
      score: 20,
      value: hoursRemaining,
      reason: `Predicted TCA within ${th.high}-${th.medium} hours (${hoursRemaining.toFixed(1)} h remaining; intermediate monitoring).`,
    };
  }
  if (hoursRemaining < th.low) {
    return {
      score: 10,
      value: hoursRemaining,
      reason: `Predicted TCA within ${th.medium}-${th.low} hours (${hoursRemaining.toFixed(1)} h remaining; standard monitoring).`,
    };
  }

  return {
    score: 0,
    value: hoursRemaining,
    reason: `Predicted TCA > ${th.low} hours away (${hoursRemaining.toFixed(1)} h remaining; long-range screening).`,
  };
}

/**
 * Evaluates upper-bound screening probability metric (max 15 points).
 * Note: SOCRATES MAX_PROB represents an uncalibrated 2D maximum probability
 * upper bound under simplified spherical covariance assumptions, used strictly as an
 * illustrative screening metric rather than an authoritative operational collision probability.
 * @param {number | null} maxProb
 * @param {object} [config=DEFAULT_RULE_CONFIG]
 * @returns {{ score: number, value: number | null, reason: string }}
 */
export function evaluateProbability(maxProb, config = DEFAULT_RULE_CONFIG) {
  if (maxProb === null || maxProb === undefined) {
    return {
      score: 0,
      value: null,
      reason: 'Upper-bound screening probability metric unpopulated in source catalog.',
    };
  }

  const num = typeof maxProb === 'number' ? maxProb : parseFloat(maxProb);
  if (isNaN(num) || num <= 0) {
    return {
      score: 0,
      value: null,
      reason: 'Upper-bound screening probability metric unpopulated in source catalog.',
    };
  }

  const th = config.thresholds.probability;
  if (num >= th.high) {
    return {
      score: 15,
      value: num,
      reason: `Upper-bound screening probability metric >= ${th.high.toExponential(0)} (${num.toExponential(2)}).`,
    };
  }
  if (num >= th.elevated) {
    return {
      score: 10,
      value: num,
      reason: `Upper-bound screening probability metric >= ${th.elevated.toExponential(0)} (${num.toExponential(2)}).`,
    };
  }
  if (num >= th.moderate) {
    return {
      score: 5,
      value: num,
      reason: `Upper-bound screening probability metric >= ${th.moderate.toExponential(0)} (${num.toExponential(2)}).`,
    };
  }

  return {
    score: 0,
    value: num,
    reason: `Upper-bound screening probability metric < ${th.moderate.toExponential(0)} (${num.toExponential(2)}).`,
  };
}

/**
 * Evaluates orbit data freshness / propagation uncertainty (max 5 points).
 * @param {number | null} dse1
 * @param {number | null} dse2
 * @param {object} [config=DEFAULT_RULE_CONFIG]
 * @returns {{ score: number, value: number | null, reason: string }}
 */
export function evaluateDataFreshness(dse1, dse2, config = DEFAULT_RULE_CONFIG) {
  const num1 = dse1 !== null && dse1 !== undefined ? parseFloat(dse1) : NaN;
  const num2 = dse2 !== null && dse2 !== undefined ? parseFloat(dse2) : NaN;

  const has1 = !isNaN(num1);
  const has2 = !isNaN(num2);

  if (!has1 && !has2) {
    return {
      score: 0,
      value: null,
      reason: 'Orbit epoch age (days since epoch) unpopulated in source data.',
    };
  }

  const maxDse = Math.max(has1 ? num1 : 0, has2 ? num2 : 0);
  const th = config.thresholds.dataFreshnessDays;

  if (maxDse <= th.fresh) {
    return {
      score: 5,
      value: maxDse,
      reason: `Fresh orbital determinations (max ${maxDse.toFixed(1)} days since TLE epoch; high propagation confidence).`,
    };
  }
  if (maxDse <= th.acceptable) {
    return {
      score: 3,
      value: maxDse,
      reason: `Acceptable orbital determinations (max ${maxDse.toFixed(1)} days since TLE epoch; moderate propagation confidence).`,
    };
  }

  return {
    score: 0,
    value: maxDse,
    reason: `Aged orbital determinations (max ${maxDse.toFixed(1)} days since TLE epoch; degraded propagation confidence).`,
  };
}

/**
 * Maps composite score and key triggers to urgency classification.
 * @param {number} score
 * @param {number | null} missDistanceKm
 * @param {number | null} timeToTcaHours
 * @param {object} [config=DEFAULT_RULE_CONFIG]
 * @returns {'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'}
 */
export function determineUrgencyLevel(
  score,
  missDistanceKm,
  timeToTcaHours,
  config = DEFAULT_RULE_CONFIG,
) {
  const isImminentSevere =
    missDistanceKm !== null &&
    missDistanceKm < 0.5 &&
    timeToTcaHours !== null &&
    timeToTcaHours > 0 &&
    timeToTcaHours < 24;

  if (isImminentSevere || score >= config.classification.criticalScore) {
    return 'CRITICAL';
  }
  if (score >= config.classification.highScore) {
    return 'HIGH';
  }
  if (score >= config.classification.mediumScore) {
    return 'MEDIUM';
  }
  return 'LOW';
}
