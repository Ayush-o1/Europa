/**
 * @fileoverview SGP4 Encounter Estimator
 *
 * Pinpoints the Time of Closest Approach (TCA), minimum miss distance,
 * and relative velocity vector across an encounter screening window between two space objects.
 */

import {
  initializeSatrec,
  propagateObject,
  calculateRelativeState,
  SGP4_ALGORITHM_METADATA,
} from './sgp4Propagator.js';

/**
 * Evaluates an encounter between two satellite Two-Line Element (TLE) sets over a search window.
 *
 * @param {object} options
 * @param {{ line1: string, line2: string }} options.primaryTle
 * @param {{ line1: string, line2: string }} options.secondaryTle
 * @param {Date | string} options.nominalTca
 * @param {number} [options.searchWindowMinutes=10] - Half-window in minutes (+/-) around nominal TCA (1..60)
 * @param {number} [options.stepSeconds=5] - Coarse grid step size in seconds (1..30)
 * @param {number} [options.maxSamples=40] - Maximum trajectory points returned for charting
 * @returns {object} Encounter estimation analysis
 */
export function estimateEncounterCloseApproach(options) {
  const {
    primaryTle,
    secondaryTle,
    nominalTca,
    searchWindowMinutes = 10,
    stepSeconds = 5,
    maxSamples = 40,
  } = options || {};

  if (!primaryTle?.line1 || !primaryTle?.line2) {
    throw new Error('Primary TLE (line1 and line2) is required.');
  }
  if (!secondaryTle?.line1 || !secondaryTle?.line2) {
    throw new Error('Secondary TLE (line1 and line2) is required.');
  }

  const nominalDate = nominalTca instanceof Date ? nominalTca : new Date(nominalTca);
  if (Number.isNaN(nominalDate.getTime())) {
    throw new Error(`Invalid nominalTca: "${nominalTca}". Must be a valid ISO-8601 date string.`);
  }

  const windowMinutes = Math.max(1, Math.min(60, Number(searchWindowMinutes) || 10));
  const coarseStepSec = Math.max(1, Math.min(30, Number(stepSeconds) || 5));

  const primary = initializeSatrec(primaryTle.line1, primaryTle.line2);
  const secondary = initializeSatrec(secondaryTle.line1, secondaryTle.line2);

  const nominalMs = nominalDate.getTime();
  const windowMs = windowMinutes * 60 * 1000;
  const startMs = nominalMs - windowMs;
  const endMs = nominalMs + windowMs;
  const coarseStepMs = coarseStepSec * 1000;

  let minCoarseDist = Infinity;
  let minCoarseTimeMs = nominalMs;
  const coarseTrajectory = [];

  // 1. Coarse Grid Sweep across [T_nom - window, T_nom + window]
  for (let t = startMs; t <= endMs; t += coarseStepMs) {
    const curDate = new Date(t);
    const pState = propagateObject(primary.satrec, curDate);
    const sState = propagateObject(secondary.satrec, curDate);

    if (!pState.success || !sState.success) {
      continue;
    }

    const rel = calculateRelativeState(pState, sState);
    coarseTrajectory.push({
      timestamp: curDate.toISOString(),
      timeMs: t,
      missDistanceKm: parseFloat(rel.missDistanceKm.toFixed(4)),
      relativeSpeedKmS: parseFloat(rel.relativeSpeedKmS.toFixed(4)),
    });

    if (rel.missDistanceKm < minCoarseDist) {
      minCoarseDist = rel.missDistanceKm;
      minCoarseTimeMs = t;
    }
  }

  if (coarseTrajectory.length === 0) {
    throw new Error(
      'SGP4 propagation failed for all timestamps in the search window. Objects may be decayed or invalid.',
    );
  }

  // 2. Fine Local Refinement: Sweep +/- 1 coarse step at 100ms resolution
  const fineStartMs = Math.max(startMs, minCoarseTimeMs - coarseStepMs);
  const fineEndMs = Math.min(endMs, minCoarseTimeMs + coarseStepMs);
  const fineStepMs = 100; // 100 ms

  let minMissDistanceKm = Infinity;
  let refinedTcaMs = minCoarseTimeMs;
  let relativeSpeedAtTca = 0;

  for (let t = fineStartMs; t <= fineEndMs; t += fineStepMs) {
    const curDate = new Date(t);
    const pState = propagateObject(primary.satrec, curDate);
    const sState = propagateObject(secondary.satrec, curDate);

    if (!pState.success || !sState.success) continue;

    const rel = calculateRelativeState(pState, sState);
    if (rel.missDistanceKm < minMissDistanceKm) {
      minMissDistanceKm = rel.missDistanceKm;
      refinedTcaMs = t;
      relativeSpeedAtTca = rel.relativeSpeedKmS;
    }
  }

  // 3. TLE Age Relative to Refined TCA (hours)
  const primaryTleAgeHours = Math.abs(refinedTcaMs - primary.metadata.epoch.getTime()) / 3600000;
  const secondaryTleAgeHours =
    Math.abs(refinedTcaMs - secondary.metadata.epoch.getTime()) / 3600000;

  // 4. Downsample trajectory points for frontend presentation
  let sampledPoints = coarseTrajectory;
  if (coarseTrajectory.length > maxSamples) {
    const stride = Math.ceil(coarseTrajectory.length / maxSamples);
    sampledPoints = coarseTrajectory.filter((_, idx) => idx % stride === 0);
  }

  const estimatedTcaDate = new Date(refinedTcaMs);
  const tcaDeltaSeconds = (refinedTcaMs - nominalMs) / 1000;

  return {
    success: true,
    algorithm: SGP4_ALGORITHM_METADATA,
    primaryObject: {
      catalogNumber: primary.metadata.catalogNumber,
      epoch: primary.metadata.epoch.toISOString(),
      inclinationDeg: primary.metadata.inclinationDeg,
      eccentricity: primary.metadata.eccentricity,
      meanMotionRevDay: primary.metadata.meanMotionRevDay,
      tleAgeHours: parseFloat(primaryTleAgeHours.toFixed(2)),
    },
    secondaryObject: {
      catalogNumber: secondary.metadata.catalogNumber,
      epoch: secondary.metadata.epoch.toISOString(),
      inclinationDeg: secondary.metadata.inclinationDeg,
      eccentricity: secondary.metadata.eccentricity,
      meanMotionRevDay: secondary.metadata.meanMotionRevDay,
      tleAgeHours: parseFloat(secondaryTleAgeHours.toFixed(2)),
    },
    nominalTca: nominalDate.toISOString(),
    estimatedTca: estimatedTcaDate.toISOString(),
    tcaDeltaSeconds: parseFloat(tcaDeltaSeconds.toFixed(3)),
    estimatedMissDistanceKm: parseFloat(minMissDistanceKm.toFixed(4)),
    estimatedRelativeSpeedKmS: parseFloat(relativeSpeedAtTca.toFixed(4)),
    searchWindowMinutes: windowMinutes,
    stepSeconds: coarseStepSec,
    isStaleTle: primaryTleAgeHours > 72 || secondaryTleAgeHours > 72,
    trajectorySamples: sampledPoints,
    scientificDisclaimer: SGP4_ALGORITHM_METADATA.scientificDisclaimer,
  };
}
