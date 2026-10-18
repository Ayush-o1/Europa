/**
 * @fileoverview SGP4 Orbital Propagator & Relative State Calculator
 *
 * Implements SGP4/SDP4 satellite state propagation using satellite.js (Vallado SGP4),
 * generating True Equator Mean Equinox (TEME) position and velocity vectors and
 * relative encounter metrics between two orbiting bodies.
 */

import * as satellite from 'satellite.js';
import { validateTle } from './tleValidator.js';

export const SGP4_ALGORITHM_METADATA = {
  name: 'SGP4_SIMPLIFIED_PERTURBATIONS_VALLADO',
  library: 'satellite.js@7.1.0',
  license: 'MIT',
  referenceFrame: 'TEME (True Equator, Mean Equinox)',
  perturbationModel:
    'Zonal harmonics J2, J3, J4, BSTAR atmospheric drag, lunar-solar deep space (SDP4)',
  scientificDisclaimer:
    'EXPERIMENTAL SCREENING ONLY: SGP4 orbital propagation computes mean Keplerian elements under low-order zonal harmonics and simplified drag perturbations. TLE elements do not contain covariance matrices or orbital uncertainty ellipsoids. Estimated encounter parameters and miss distances MUST NOT be treated as authoritative collision probabilities or operational maneuver thresholds. SOCRATES MAX_PROB is an upper-bound screening metric under simplified covariance assumptions.',
};

/**
 * Creates an SGP4 satellite record from a validated TLE pair.
 *
 * @param {string} rawLine1
 * @param {string} rawLine2
 * @returns {{
 *   satrec: object,
 *   metadata: object
 * }}
 */
export function initializeSatrec(rawLine1, rawLine2) {
  const validation = validateTle(rawLine1, rawLine2);
  if (!validation.valid) {
    throw new Error(`TLE validation failed: ${validation.errors.join('; ')}`);
  }

  const satrec = satellite.twoline2satrec(rawLine1.trim(), rawLine2.trim());
  if (satrec.error && satrec.error !== 0) {
    throw new Error(`SGP4 satrec initialization error (code ${satrec.error})`);
  }

  return {
    satrec,
    metadata: validation.data,
  };
}

/**
 * Propagates an SGP4 satellite record to a specific target UTC date.
 *
 * @param {object} satrec - Satellite record from satellite.twoline2satrec
 * @param {Date | string | number} targetDate - Target epoch
 * @returns {{
 *   success: boolean,
 *   targetDate: Date,
 *   positionKm: { x: number, y: number, z: number } | null,
 *   velocityKmS: { x: number, y: number, z: number } | null,
 *   radiusKm: number | null,
 *   speedKmS: number | null,
 *   error?: string
 * }}
 */
export function propagateObject(satrec, targetDate) {
  const dateObj = targetDate instanceof Date ? targetDate : new Date(targetDate);
  if (Number.isNaN(dateObj.getTime())) {
    return {
      success: false,
      targetDate: dateObj,
      positionKm: null,
      velocityKmS: null,
      radiusKm: null,
      speedKmS: null,
      error: 'Invalid targetDate passed to propagateObject.',
    };
  }

  const result = satellite.propagate(satrec, dateObj);

  if (
    !result.position ||
    !result.velocity ||
    typeof result.position.x !== 'number' ||
    Number.isNaN(result.position.x)
  ) {
    return {
      success: false,
      targetDate: dateObj,
      positionKm: null,
      velocityKmS: null,
      radiusKm: null,
      speedKmS: null,
      error: `SGP4 propagation failed (satellite decayed or numerical error, satrec code: ${satrec.error || 'DECAY'}).`,
    };
  }

  const px = result.position.x;
  const py = result.position.y;
  const pz = result.position.z;
  const vx = result.velocity.x;
  const vy = result.velocity.y;
  const vz = result.velocity.z;

  const radiusKm = Math.sqrt(px * px + py * py + pz * pz);
  const speedKmS = Math.sqrt(vx * vx + vy * vy + vz * vz);

  return {
    success: true,
    targetDate: dateObj,
    positionKm: { x: px, y: py, z: pz },
    velocityKmS: { x: vx, y: vy, z: vz },
    radiusKm,
    speedKmS,
  };
}

/**
 * Computes the relative spatial vector and scalar miss distance between two propagated states.
 *
 * @param {object} state1 - Primary object propagated state
 * @param {object} state2 - Secondary object propagated state
 * @returns {{
 *   timestamp: Date,
 *   relativePositionKm: { x: number, y: number, z: number },
 *   missDistanceKm: number,
 *   relativeVelocityKmS: { x: number, y: number, z: number },
 *   relativeSpeedKmS: number
 * }}
 */
export function calculateRelativeState(state1, state2) {
  if (!state1.success || !state2.success) {
    throw new Error('Both propagated states must be successful to compute relative state.');
  }

  const dx = state2.positionKm.x - state1.positionKm.x;
  const dy = state2.positionKm.y - state1.positionKm.y;
  const dz = state2.positionKm.z - state1.positionKm.z;

  const dvx = state2.velocityKmS.x - state1.velocityKmS.x;
  const dvy = state2.velocityKmS.y - state1.velocityKmS.y;
  const dvz = state2.velocityKmS.z - state1.velocityKmS.z;

  const missDistanceKm = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const relativeSpeedKmS = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);

  return {
    timestamp: state1.targetDate,
    relativePositionKm: { x: dx, y: dy, z: dz },
    missDistanceKm,
    relativeVelocityKmS: { x: dvx, y: dvy, z: dvz },
    relativeSpeedKmS,
  };
}
