/**
 * @fileoverview Dedicated Experimental SGP4 Orbital Screening Workbench
 *
 * Provides an interactive environment for operators to evaluate two TLE sets,
 * propagate orbits using SGP4, estimate closest-approach geometry, and compare
 * results against screening thresholds with explicit scientific disclaimers.
 */

import { api } from '../apiClient.js';
import { renderEncounterProfileChart } from '../components/chart.js';
import { showToast } from '../components/toast.js';
import {
  escapeHtml,
  formatUtc,
  formatDistance,
  formatVelocity,
  computeTleChecksum,
} from '../utils.js';

const TLE_PRESETS = [
  {
    id: 'iss_cosmos',
    name: 'ISS (25544) vs COSMOS 2251 Debris (34454)',
    pName: 'ISS (ZARYA)',
    sName: 'COSMOS 2251 DEB',
    primary: {
      line1: '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9009',
      line2: '2 25544  51.6400 208.9163 0004780  69.9862  25.2906 15.49815016431907',
    },
    secondary: {
      line1: '1 34454U 93036SX  24001.50000000  .00001234  00000-0  56789-4 0  9004',
      line2: '2 34454  74.0400 210.1234 0021500 120.4500  45.6700 14.85000000213455',
    },
    defaultWindow: 10,
  },
  {
    id: 'starlink_pair',
    name: 'Starlink-30526 (58006) vs Starlink-36931 (68000)',
    pName: 'STARLINK-30526',
    sName: 'STARLINK-36931',
    primary: {
      line1: '1 58006U 23150A   24001.50000000  .00005000  00000-0  12345-3 0  9004',
      line2: '2 58006  53.2000 150.1234 0001200  80.4500  30.1200 15.1000000012344',
    },
    secondary: {
      line1: '1 68000U 24010A   24001.50000000  .00005200  00000-0  12500-3 0  9009',
      line2: '2 68000  53.2100 150.1300 0001250  80.4600  30.1300 15.1000500012349',
    },
    defaultWindow: 15,
  },
];

export async function renderPropagation(container) {
  const defaultNominalTca = new Date(Date.now() + 3600000 * 2).toISOString().slice(0, 19) + 'Z';

  container.innerHTML = `
    <div class="view-header">
      <div class="view-header-main">
        <div style="display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-1);">
          <span class="badge badge-medium" style="font-size: 10px;">EXPERIMENTAL CAPABILITY</span>
          <span style="font-size: var(--text-2xs); color: var(--text-muted); font-family: var(--font-mono);">
            SGP4 Keplerian Propagator · satellite.js v7.1.0
          </span>
        </div>
        <h1 class="view-title">Orbital Propagation Screening</h1>
        <p class="view-desc">
          Evaluate satellite close-approach geometries using SGP4 analytical propagation of Two-Line Element (TLE) sets.
          Estimates time of closest approach (TCA), relative encounter velocity, and minimum miss distance.
        </p>
      </div>
      <div class="view-actions">
        <select id="preset-selector" class="form-select" style="width: auto;">
          <option value="">Choose Scenario Preset...</option>
          ${TLE_PRESETS.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
        </select>
      </div>
    </div>

    <!-- Scientific Limitation Banner -->
    <div class="sgp4-banner" style="margin-bottom: var(--space-5);">
      <div style="font-weight: 700; color: var(--text-primary); margin-bottom: 2px;">
        ⚠ Scientific Scope and Model Assumptions
      </div>
      <div>
        SGP4 computes mean Keplerian trajectories under simplified Earth oblateness harmonics (J2, J3, J4) and atmospheric drag.
        Standard two-line element sets lack full state covariance matrices and <strong>do not calculate validated collision probabilities ($P_c$)</strong>
        or collision-avoidance maneuver recommendations. Output miss distances and relative velocities are for experimental screening only.
      </div>
    </div>

    <!-- Propagation Workbench Grid -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-5); align-items: start;">
      <!-- Left: TLE Inputs Card -->
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Encounter Two-Line Elements</h2>
            <div class="card-subtitle">Primary and Secondary orbital state vectors</div>
          </div>
          <button id="btn-quick-fill-iss" class="btn btn-secondary btn-xs">Load ISS vs Cosmos</button>
        </div>

        <form id="standalone-sgp4-form" style="display: flex; flex-direction: column; gap: var(--space-4);">
          <!-- Primary Object -->
          <div class="form-group">
            <label class="form-label">
              <span>Primary Satellite TLE</span>
              <span id="primary-meta-badge" class="form-hint"></span>
            </label>
            <input
              type="text"
              id="input-primary-line1"
              class="form-input tle-textarea"
              placeholder="Line 1: 1 25544U 98067A   ..."
              value="${TLE_PRESETS[0].primary.line1}"
              required
            />
            <input
              type="text"
              id="input-primary-line2"
              class="form-input tle-textarea"
              placeholder="Line 2: 2 25544  51.6400 ..."
              value="${TLE_PRESETS[0].primary.line2}"
              required
            />
          </div>

          <!-- Secondary Object -->
          <div class="form-group">
            <label class="form-label">
              <span>Secondary Satellite / Debris TLE</span>
              <span id="secondary-meta-badge" class="form-hint"></span>
            </label>
            <input
              type="text"
              id="input-secondary-line1"
              class="form-input tle-textarea"
              placeholder="Line 1: 1 34454U 93036SX  ..."
              value="${TLE_PRESETS[0].secondary.line1}"
              required
            />
            <input
              type="text"
              id="input-secondary-line2"
              class="form-input tle-textarea"
              placeholder="Line 2: 2 34454  74.0400 ..."
              value="${TLE_PRESETS[0].secondary.line2}"
              required
            />
          </div>

          <!-- Parameters Grid -->
          <div style="display: grid; grid-template-columns: 1.5fr 1fr 1fr; gap: var(--space-3);">
            <div class="form-group">
              <label class="form-label" for="input-nominal-tca">Nominal TCA (UTC)</label>
              <input
                type="text"
                id="input-nominal-tca"
                class="form-input"
                style="font-family: var(--font-mono);"
                value="${defaultNominalTca}"
                required
              />
            </div>
            <div class="form-group">
              <label class="form-label" for="input-search-window">Window (± min)</label>
              <input
                type="number"
                id="input-search-window"
                class="form-input"
                style="font-family: var(--font-mono);"
                value="10"
                min="1"
                max="60"
                required
              />
            </div>
            <div class="form-group">
              <label class="form-label" for="input-step-seconds">Step (sec)</label>
              <select id="input-step-seconds" class="form-select" style="font-family: var(--font-mono);">
                <option value="1">1 sec</option>
                <option value="2">2 sec</option>
                <option value="5">5 sec</option>
              </select>
            </div>
          </div>

          <div id="propagation-feedback" style="display: none; font-size: var(--text-xs); padding: var(--space-2-5); border-radius: var(--radius-xs);"></div>

          <button type="submit" id="btn-run-propagation" class="btn btn-primary" style="margin-top: var(--space-2);">
            Propagate Trajectories &amp; Estimate Closest Approach
          </button>
        </form>
      </div>

      <!-- Right: Screening Results & Visualization Card -->
      <div class="card" id="propagation-output-panel">
        <div class="card-header">
          <div>
            <h2 class="card-title">Encounter Geometry Result</h2>
            <div class="card-subtitle">Calculated relative trajectory metrics</div>
          </div>
          <span class="badge badge-neutral" id="result-status-badge">AWAITING CALCULATION</span>
        </div>

        <div id="results-display-area">
          <div class="state-box" style="padding: var(--space-10);">
            <div class="state-icon">🛰️</div>
            <h3 class="state-title">Ready for Propagation</h3>
            <p class="state-desc">
              Select a preset or enter two valid 69-character TLE records on the left, then click "Propagate Trajectories".
            </p>
          </div>
        </div>
      </div>
    </div>
  `;

  // Bind Preset Selector
  const presetSelect = container.querySelector('#preset-selector');
  const btnQuickFill = container.querySelector('#btn-quick-fill-iss');

  const p1 = container.querySelector('#input-primary-line1');
  const p2 = container.querySelector('#input-primary-line2');
  const s1 = container.querySelector('#input-secondary-line1');
  const s2 = container.querySelector('#input-secondary-line2');
  const win = container.querySelector('#input-search-window');

  function loadPreset(preset) {
    if (!preset) return;
    p1.value = preset.primary.line1;
    p2.value = preset.primary.line2;
    s1.value = preset.secondary.line1;
    s2.value = preset.secondary.line2;
    win.value = preset.defaultWindow || 10;
    showToast(`Loaded preset: ${preset.name}`, 'info');
  }

  presetSelect?.addEventListener('change', () => {
    const found = TLE_PRESETS.find(p => p.id === presetSelect.value);
    if (found) loadPreset(found);
  });

  btnQuickFill?.addEventListener('click', () => {
    loadPreset(TLE_PRESETS[0]);
    if (presetSelect) presetSelect.value = TLE_PRESETS[0].id;
  });

  // Handle Propagation Submission
  const form = container.querySelector('#standalone-sgp4-form');
  const feedback = container.querySelector('#propagation-feedback');
  const btnSubmit = container.querySelector('#btn-run-propagation');
  const resultsArea = container.querySelector('#results-display-area');
  const statusBadge = container.querySelector('#result-status-badge');

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    if (feedback) feedback.style.display = 'none';

    const line1P = p1.value.trim();
    const line2P = p2.value.trim();
    const line1S = s1.value.trim();
    const line2S = s2.value.trim();
    const nomTca = container.querySelector('#input-nominal-tca').value.trim();
    const winMin = parseInt(win.value, 10) || 10;
    const stepSec = parseInt(container.querySelector('#input-step-seconds').value, 10) || 1;

    // Validate inputs
    if (!line1P || !line2P || !line1S || !line2S) {
      if (feedback) {
        feedback.style.display = 'block';
        feedback.style.backgroundColor = 'var(--color-critical-bg)';
        feedback.style.color = 'var(--color-critical)';
        feedback.textContent = 'All 4 TLE lines (Primary 1/2 and Secondary 1/2) are required.';
      }
      return;
    }

    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Computing SGP4 Orbit Trajectories...';

    try {
      const res = await api.computePropagation({
        primaryTle: { line1: line1P, line2: line2P },
        secondaryTle: { line1: line1S, line2: line2S },
        nominalTca: nomTca,
        searchWindowMinutes: winMin,
        stepSeconds: stepSec,
      });

      const est = res.data;
      showToast('SGP4 orbital encounter screening calculated successfully.', 'success');

      if (statusBadge) {
        statusBadge.className = 'badge badge-success';
        statusBadge.textContent = 'COMPUTATION COMPLETE';
      }

      resultsArea.innerHTML = `
        <div class="metrics-grid" style="grid-template-columns: 1fr 1fr; margin-bottom: var(--space-4);">
          <div class="metric-card ${est.estimatedMissDistanceKm < 1.0 ? 'accent-critical' : est.estimatedMissDistanceKm < 5.0 ? 'accent-high' : 'accent-brand'}">
            <span class="metric-label">Estimated Miss Distance</span>
            <span class="metric-value" style="color: ${est.estimatedMissDistanceKm < 1.0 ? 'var(--color-critical)' : est.estimatedMissDistanceKm < 5.0 ? 'var(--color-high)' : 'var(--text-primary)'};">
              ${formatDistance(est.estimatedMissDistanceKm)}
            </span>
            <span class="metric-subtext">Minimum encounter proximity</span>
          </div>

          <div class="metric-card accent-cyan">
            <span class="metric-label">Relative Speed</span>
            <span class="metric-value" style="color: var(--color-cyan); font-size: var(--text-2xl);">
              ${formatVelocity(est.estimatedRelativeSpeedKmS)}
            </span>
            <span class="metric-subtext">Velocity magnitude at TCA</span>
          </div>
        </div>

        <div class="ingestion-summary-grid" style="margin-bottom: var(--space-4);">
          <div class="ingestion-summary-item">
            <span class="ingestion-summary-label">Estimated TCA (UTC)</span>
            <span class="ingestion-summary-value">${formatUtc(est.estimatedTca)}</span>
          </div>
          <div class="ingestion-summary-item">
            <span class="ingestion-summary-label">Delta from Nominal TCA</span>
            <span class="ingestion-summary-value">${est.tcaDeltaSeconds > 0 ? '+' : ''}${est.tcaDeltaSeconds}s</span>
          </div>
          <div class="ingestion-summary-item">
            <span class="ingestion-summary-label">Primary Object (NORAD ${est.primaryObject.catalogNumber})</span>
            <span class="ingestion-summary-value">${est.primaryObject.tleAgeHours}h epoch age</span>
          </div>
          <div class="ingestion-summary-item">
            <span class="ingestion-summary-label">Secondary Object (NORAD ${est.secondaryObject.catalogNumber})</span>
            <span class="ingestion-summary-value">${est.secondaryObject.tleAgeHours}h epoch age</span>
          </div>
        </div>

        <div style="margin-top: var(--space-2);">
          <h4 style="font-size: var(--text-xs); color: var(--text-muted); text-transform: uppercase; font-weight: 600; margin-bottom: var(--space-1);">
            Encounter Range Profile (±${winMin} min window)
          </h4>
          ${renderEncounterProfileChart({ ...est, searchWindowMinutes: winMin })}
        </div>
      `;
    } catch (err) {
      if (statusBadge) {
        statusBadge.className = 'badge badge-critical';
        statusBadge.textContent = 'COMPUTATION FAILED';
      }
      if (feedback) {
        feedback.style.display = 'block';
        feedback.style.backgroundColor = 'var(--color-critical-bg)';
        feedback.style.color = 'var(--color-critical)';
        feedback.textContent = `Screening failed: ${err.message}`;
      }
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Propagate Trajectories & Estimate Closest Approach';
    }
  });
}
