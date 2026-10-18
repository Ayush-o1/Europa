/**
 * @fileoverview Conjunction Event Details, Assessment Explanation,
 * Chronological Prediction Evolution, SGP4 Screening, and Operator Review Workflow.
 */

import { api } from '../apiClient.js';
import { state } from '../state.js';
import { renderEvolutionChart, renderEncounterProfileChart } from '../components/chart.js';
import { setBreadcrumbs } from '../components/nav.js';
import { showToast } from '../components/toast.js';
import {
  escapeHtml,
  formatUtc,
  formatRelativeTime,
  formatDistance,
  formatVelocity,
  formatScientific,
  getUrgencyBadgeClass,
  getReviewBadgeClass,
  getOperationalPillClass,
  truncateHash,
  copyToClipboard,
  computeTleChecksum,
} from '../utils.js';

function renderSgp4ScreeningsList(screenings, event) {
  if (!screenings || screenings.length === 0) {
    return `
      <div style="text-align: center; padding: var(--space-4); background-color: var(--bg-surface-0); border-radius: var(--radius-xs); border: 1px solid var(--border-subtle); color: var(--text-muted); font-size: var(--text-xs);">
        No SGP4 encounter estimation has been computed for this pair yet. Click "Load Sample TLEs" and compute an experimental screening above.
      </div>
    `;
  }

  return screenings
    .map(
      s => `
      <div class="sgp4-result-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-2); flex-wrap: wrap; gap: var(--space-2);">
          <div style="display: flex; align-items: center; gap: var(--space-2);">
            <span class="badge badge-brand" style="font-size: 10px;">SGP4 SCREENING</span>
            <span style="font-size: 11px; font-family: var(--font-mono); color: var(--text-muted);">${formatUtc(s.createdAt)}</span>
          </div>
          <span style="font-size: 11px; font-family: var(--font-mono); color: ${s.primaryTleAgeHours > 72 || s.secondaryTleAgeHours > 72 ? 'var(--color-high)' : 'var(--color-success)'};">
            ${s.primaryTleAgeHours > 72 || s.secondaryTleAgeHours > 72 ? '⚠️ Stale TLE (>72h)' : '✓ Fresh Elements'}
          </span>
        </div>
        <div class="sgp4-result-grid">
          <div>
            <span style="color: var(--text-muted); font-size: 10px; display: block;">Refined TCA (UTC):</span>
            <strong style="font-family: var(--font-mono); font-size: var(--text-xs);">${formatUtc(s.estimatedTca)}</strong>
          </div>
          <div>
            <span style="color: var(--text-muted); font-size: 10px; display: block;">SGP4 Miss Distance:</span>
            <strong style="font-family: var(--font-mono); font-size: var(--text-sm); color: ${s.estimatedMissDistanceKm < 1.0 ? 'var(--color-critical)' : s.estimatedMissDistanceKm < 5.0 ? 'var(--color-high)' : 'var(--text-primary)'};">
              ${formatDistance(s.estimatedMissDistanceKm)}
            </strong>
          </div>
          <div>
            <span style="color: var(--text-muted); font-size: 10px; display: block;">SOCRATES Reported:</span>
            <span style="font-family: var(--font-mono); color: var(--text-secondary);">${formatDistance(event.latest_range_km)}</span>
          </div>
          <div>
            <span style="color: var(--text-muted); font-size: 10px; display: block;">Relative Speed:</span>
            <span style="font-family: var(--font-mono);">${formatVelocity(s.estimatedRelativeSpeedKmS)}</span>
          </div>
          <div>
            <span style="color: var(--text-muted); font-size: 10px; display: block;">Element Age (P / S):</span>
            <span style="font-family: var(--font-mono);">${s.primaryTleAgeHours}h / ${s.secondaryTleAgeHours}h</span>
          </div>
        </div>
        ${renderEncounterProfileChart(s)}
      </div>
    `,
    )
    .join('');
}

export async function renderEventDetails(container) {
  const eventId = state.get('selectedEventId');

  if (!eventId) {
    container.innerHTML = `
      <div class="view-header">
        <div class="view-header-main">
          <h1 class="view-title">Event Details</h1>
          <p class="view-desc">No encounter event selected.</p>
        </div>
      </div>
      <div class="card state-box">
        <div class="state-icon">🛰️</div>
        <h2 class="state-title">Select an Encounter Event</h2>
        <p class="state-desc">Please choose an event from the Triage Queue to inspect its prediction history.</p>
        <button id="btn-back-to-queue" class="btn btn-primary btn-sm">Open Triage Queue →</button>
      </div>
    `;
    container.querySelector('#btn-back-to-queue')?.addEventListener('click', () => {
      state.set('currentView', 'events');
    });
    return;
  }

  container.innerHTML = `
    <div class="view-header">
      <div class="view-header-main">
        <div style="display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-1);">
          <button id="btn-back-events" class="btn btn-secondary btn-xs">← Back to Queue</button>
          <span style="color: var(--text-muted); font-size: var(--text-xs);">/ Event Details</span>
        </div>
        <h1 id="details-event-title" class="view-title">Loading Encounter Event...</h1>
        <p class="view-desc">
          Detailed observation evolution, explainable assessment heuristics, and auditable operational review decisions.
        </p>
      </div>
      <div class="view-actions">
        <button id="btn-refresh-event" class="btn btn-secondary btn-sm">↻ Refresh</button>
      </div>
    </div>

    <div id="event-details-content">
      <div class="state-box">
        <span class="skeleton" style="width: 100%; height: 260px;"></span>
      </div>
    </div>
  `;

  container.querySelector('#btn-back-events')?.addEventListener('click', () => {
    state.set('currentView', 'events');
  });

  container.querySelector('#btn-refresh-event')?.addEventListener('click', () => {
    loadEventDetailsData(container, eventId);
  });

  await loadEventDetailsData(container, eventId);
}

async function loadEventDetailsData(container, eventId) {
  const contentEl = container.querySelector('#event-details-content');
  if (!contentEl) return;

  try {
    // Parallel fetch of event details, observation history, assessments, audit trail, and SGP4 screenings
    const [eventRes, historyRes, assessmentsRes, auditRes, propagationRes] = await Promise.all([
      api.getEvent(eventId),
      api.getEventHistory(eventId),
      api.getEventAssessments(eventId),
      api.getEventAudit(eventId, { limit: 50 }),
      api.getEventPropagation(eventId).catch(() => ({ data: { screenings: [] } })),
    ]);

    const { event, latestObservation, latestAssessment, latestReview } = eventRes.data;
    const history = historyRes.data || [];
    const assessments = assessmentsRes.data || [];
    const auditRecords = auditRes.data || [];
    const screenings = propagationRes?.data?.screenings || [];

    // Set contextual breadcrumbs
    setBreadcrumbs([
      { label: 'Triage Queue', view: 'events' },
      { label: `${event.primary_object_name} vs ${event.secondary_object_name}` },
    ]);

    // Update view title
    const titleEl = container.querySelector('#details-event-title');
    if (titleEl) {
      titleEl.textContent = `${event.primary_object_name} vs ${event.secondary_object_name}`;
    }

    const isReReviewNeeded = event.review_status === 'REQUIRES_RE_REVIEW';

    contentEl.innerHTML = `
      <!-- Object Pair Encounter Banner -->
      <div class="encounter-banner" style="margin-bottom: var(--space-6);">
        <div class="objects-pair-display">
          <div class="object-item">
            <span class="object-norad">PRIMARY OBJECT (NORAD ${event.primary_object_id})</span>
            <span class="object-name">
              ${escapeHtml(event.primary_object_name)}
              <span class="${getOperationalPillClass(event.primary_operational_status)}">${escapeHtml(event.primary_operational_status || 'UNKNOWN')}</span>
            </span>
          </div>

          <div class="encounter-vs">VS</div>

          <div class="object-item">
            <span class="object-norad">SECONDARY OBJECT (NORAD ${event.secondary_object_id})</span>
            <span class="object-name">
              ${escapeHtml(event.secondary_object_name)}
              <span class="${getOperationalPillClass(event.secondary_operational_status)}">${escapeHtml(event.secondary_operational_status || 'UNKNOWN')}</span>
            </span>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap;">
          <span class="badge ${getUrgencyBadgeClass(event.urgency_level)}" style="font-size: var(--text-sm); padding: var(--space-1) var(--space-3);">
            ${escapeHtml(event.urgency_level)} URGENCY
          </span>
          <span class="badge ${getReviewBadgeClass(event.review_status)}" style="font-size: var(--text-sm); padding: var(--space-1) var(--space-3);">
            ${escapeHtml(event.review_status)}
          </span>
          <span class="badge badge-neutral" style="font-size: var(--text-sm); padding: var(--space-1) var(--space-3);">
            ${escapeHtml(event.lifecycle_state)}
          </span>
        </div>
      </div>

      ${
        isReReviewNeeded
          ? `
        <div class="card" style="border-left: 4px solid var(--color-critical); background-color: var(--color-critical-bg); margin-bottom: var(--space-6); padding: var(--space-4);">
          <div style="display: flex; align-items: center; gap: var(--space-2); color: var(--color-critical); font-weight: 700; margin-bottom: var(--space-1);">
            <span>⚠</span> FRESH OPERATOR REVIEW REQUIRED
          </div>
          <p style="font-size: var(--text-sm); color: var(--text-primary); margin: 0;">
            A newer observation materially altered this encounter's prediction (urgency elevation, miss distance contraction >= 20%, or time to TCA < 24h).
            A justified operational decision is required.
          </p>
        </div>
      `
          : ''
      }

      <!-- Encounter Metric Highlights -->
      <div class="metrics-grid" style="margin-bottom: var(--space-6);">
        <div class="metric-card accent-brand">
          <span class="metric-label">Predicted TCA (UTC)</span>
          <span class="metric-value" style="font-size: var(--text-lg);">${formatUtc(event.latest_tca)}</span>
          <span class="metric-subtext">${formatRelativeTime(event.latest_tca)} | Initial: ${formatUtc(event.initial_tca)}</span>
        </div>

        <div class="metric-card ${parseFloat(event.latest_range_km) < 1.0 ? 'accent-critical' : 'accent-high'}">
          <span class="metric-label">Current Miss Distance</span>
          <span class="metric-value" style="color: ${parseFloat(event.latest_range_km) < 1.0 ? 'var(--color-critical)' : 'var(--text-primary)'};">
            ${formatDistance(event.latest_range_km)}
          </span>
          <span class="metric-subtext">Minimum predicted: ${formatDistance(event.min_predicted_range_km)}</span>
        </div>

        <div class="metric-card accent-medium">
          <span class="metric-label">Observation History</span>
          <span class="metric-value">${event.observation_count}</span>
          <span class="metric-subtext">Correlated snapshots across time</span>
        </div>

        <div class="metric-card accent-low">
          <span class="metric-label">Tracking Continuity</span>
          <span class="metric-value" style="font-size: var(--text-lg);">${escapeHtml(event.tracking_state)}</span>
          <span class="metric-subtext">Pair key: ${escapeHtml(event.canonical_pair_key)}</span>
        </div>
      </div>

      <!-- Main Layout: 2 Columns -->
      <div class="event-details-layout">
        <!-- Left Column: Chart, Observations Timeline, SGP4 Screening, Historical Audit -->
        <div class="details-main-column">
          <!-- Prediction Evolution Chart -->
          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Miss Distance Evolution (km)</h2>
                <div class="card-subtitle">Predicted encounter range progression across incoming snapshots</div>
              </div>
              <span style="font-size: var(--text-xs); color: var(--text-muted); font-family: var(--font-mono);">
                ${history.length} snapshots correlated
              </span>
            </div>
            <div class="chart-wrapper">
              ${renderEvolutionChart(history)}
            </div>
          </div>

          <!-- Chronological Observation Sequence -->
          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Chronological Observation Timeline</h2>
                <div class="card-subtitle">Ordered raw observations linked to this encounter</div>
              </div>
              <span style="font-size: var(--text-xs); color: var(--text-muted);">Snapshot Chronology (captured_at ASC)</span>
            </div>
            <div class="timeline">
              ${history
                .map(
                  (obs, idx) => `
                <div class="timeline-item">
                  <div class="timeline-marker ${idx === history.length - 1 ? 'latest' : ''}">
                    #${obs.chronological_sequence || idx + 1}
                  </div>
                  <div class="timeline-content">
                    <div class="timeline-header">
                      <span class="timeline-timestamp">Snapshot: ${formatUtc(obs.captured_at)}</span>
                      <span class="badge ${obs.is_unchanged_confirmation ? 'badge-neutral' : 'badge-brand'}">
                        ${obs.is_unchanged_confirmation ? 'Unchanged Confirmation' : 'Prediction Update'}
                      </span>
                    </div>
                    <div class="timeline-grid">
                      <div>
                        <span class="timeline-label">Predicted TCA:</span>
                        <strong class="timeline-value">${formatUtc(obs.tca)}</strong>
                      </div>
                      <div>
                        <span class="timeline-label">Miss Distance:</span>
                        <strong class="timeline-value" style="color: ${parseFloat(obs.tca_range_km) < 1.0 ? 'var(--color-critical)' : 'var(--text-primary)'};">
                          ${formatDistance(obs.tca_range_km)}
                        </strong>
                      </div>
                      <div>
                        <span class="timeline-label">Relative Velocity:</span>
                        <span class="timeline-value">${formatVelocity(obs.relative_speed_kms)}</span>
                      </div>
                      <div>
                        <span class="timeline-label">Screening Max Prob:</span>
                        <span class="timeline-value">${formatScientific(obs.max_prob)}</span>
                      </div>
                    </div>
                    <div class="timeline-source">
                      Source: ${escapeHtml(obs.source_uri)} (${escapeHtml(obs.screening_scope)})
                    </div>
                  </div>
                </div>
              `,
                )
                .join('')}
            </div>
          </div>

          <!-- Experimental Orbital Screening (SGP4) Card -->
          <div class="card" id="card-sgp4-screening">
            <div class="card-header">
              <div style="display: flex; align-items: center; gap: var(--space-2);">
                <h2 class="card-title">Experimental Orbital Screening (SGP4)</h2>
                <span class="badge badge-medium" style="font-size: 10px;">EXPERIMENTAL</span>
              </div>
              <span style="font-size: var(--text-xs); color: var(--text-muted); font-family: var(--font-mono);">
                satellite.js v7.1.0 (Vallado SGP4)
              </span>
            </div>

            <div class="sgp4-banner">
              <strong>Scientific Limitation Notice:</strong> SGP4 computes mean Keplerian trajectories under simplified zonal harmonics (J2, J3, J4) and atmospheric drag. Standard TLEs lack covariance matrices and cannot calculate authoritative collision probabilities (P_c). Estimated miss distances are experimental screening aids only. SOCRATES MAX_PROB is an upper-bound screening metric.
            </div>

            <!-- Form for Running SGP4 Screening -->
            <form id="sgp4-screening-form" style="display: flex; flex-direction: column; gap: var(--space-3); margin-bottom: var(--space-4);">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; color: var(--text-muted);">
                  Two-Line Element (TLE) Inputs
                </span>
                <button type="button" id="btn-load-sample-tles" class="btn btn-secondary btn-xs">
                  Load Sample TLEs
                </button>
              </div>

              <div>
                <label class="form-label" style="font-size: 11px; margin-bottom: 2px;">
                  Primary Object (NORAD ${event.primary_object_id}) TLE:
                </label>
                <input type="text" id="sgp4-primary-line1" class="form-input tle-textarea" style="margin-bottom: 4px;" placeholder="Line 1: 1 ${event.primary_object_id}U ..." />
                <input type="text" id="sgp4-primary-line2" class="form-input tle-textarea" placeholder="Line 2: 2 ${event.primary_object_id} ..." />
              </div>

              <div>
                <label class="form-label" style="font-size: 11px; margin-bottom: 2px;">
                  Secondary Object (NORAD ${event.secondary_object_id}) TLE:
                </label>
                <input type="text" id="sgp4-secondary-line1" class="form-input tle-textarea" style="margin-bottom: 4px;" placeholder="Line 1: 1 ${event.secondary_object_id}U ..." />
                <input type="text" id="sgp4-secondary-line2" class="form-input tle-textarea" placeholder="Line 2: 2 ${event.secondary_object_id} ..." />
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3);">
                <div>
                  <label class="form-label" style="font-size: 11px;">Nominal TCA (UTC):</label>
                  <input type="text" id="sgp4-nominal-tca" class="form-input" style="font-family: var(--font-mono); font-size: 11px;" value="${event.latest_tca ? new Date(event.latest_tca).toISOString() : new Date().toISOString()}" />
                </div>
                <div>
                  <label class="form-label" style="font-size: 11px;">Search Window (+/- min):</label>
                  <input type="number" id="sgp4-window-minutes" class="form-input" style="font-family: var(--font-mono); font-size: 11px;" value="10" min="1" max="60" />
                </div>
              </div>

              <div id="sgp4-feedback" style="display: none; font-size: var(--text-xs); padding: var(--space-2); border-radius: var(--radius-xs);"></div>

              <button type="submit" id="btn-compute-sgp4" class="btn btn-primary" style="margin-top: var(--space-2);">
                Compute SGP4 Encounter Estimate
              </button>
            </form>

            <!-- Screening Results Container -->
            <div id="sgp4-results-container">
              ${renderSgp4ScreeningsList(screenings, event)}
            </div>
          </div>

          <!-- Audit Ledger Records for this Event -->
          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Event Cryptographic Audit Trail</h2>
                <div class="card-subtitle">Immutable append-only ledger entries anchored to this conjunction event</div>
              </div>
              <span style="font-size: var(--text-xs); font-family: var(--font-mono); color: var(--text-muted);">
                ${auditRecords.length} records verified
              </span>
            </div>
            <div class="table-wrapper">
              <table class="data-table" style="font-size: var(--text-xs);">
                <thead>
                  <tr>
                    <th>Seq #</th>
                    <th>Action</th>
                    <th>Actor</th>
                    <th>Timestamp (UTC)</th>
                    <th>SHA-256 Entry Hash</th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    auditRecords.length > 0
                      ? auditRecords
                          .map(
                            audit => `
                      <tr>
                        <td style="font-family: var(--font-mono); font-weight: bold; color: var(--text-primary);">#${audit.sequence_number}</td>
                        <td><span class="badge badge-brand">${escapeHtml(audit.action_type)}</span></td>
                        <td>${escapeHtml(audit.actor_type)}: <strong style="font-family: var(--font-mono); color: var(--text-primary);">${escapeHtml(audit.actor_id)}</strong></td>
                        <td class="tabular-nums">${formatUtc(audit.created_at)}</td>
                        <td>
                          <div class="hash-cell">
                            <span title="${audit.entry_hash}">${truncateHash(audit.entry_hash, 8, 8)}</span>
                            <button class="copy-btn btn-ghost btn-xs" data-hash="${audit.entry_hash}" title="Copy full SHA-256 hash">📋</button>
                          </div>
                        </td>
                      </tr>
                    `,
                          )
                          .join('')
                      : `<tr><td colspan="5" class="state-desc" style="text-align: center; padding: var(--space-4);">No audit records found.</td></tr>`
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Right Column: Assessment Explanation & Operator Review Workflow -->
        <div class="details-sidebar-column">
          <!-- Assessment Explanation Card -->
          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Review-Priority Assessment</h2>
                <div class="card-subtitle">Deterministic multi-factor review score</div>
              </div>
              <span class="badge badge-neutral" style="font-size: 11px;">
                ${latestAssessment ? escapeHtml(latestAssessment.rule_set_version) : 'v1.0.0-heuristic'}
              </span>
            </div>

            ${
              latestAssessment
                ? `
              <div class="assessment-score-banner assessment-score-card">
                <div>
                  <div style="font-size: var(--text-2xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Composite Priority Score</div>
                  <div class="score-display" style="display: flex; align-items: baseline; gap: var(--space-1); margin-top: 2px;">
                    <span class="score-num assessment-score-num">${latestAssessment.assessment_score}</span>
                    <span class="score-denom" style="color: var(--text-muted); font-size: var(--text-xs); font-family: var(--font-mono);">/ 100 PTS</span>
                  </div>
                </div>
                <span class="badge ${getUrgencyBadgeClass(latestAssessment.urgency_level)}" style="font-size: var(--text-sm); padding: var(--space-1) var(--space-2-5);">
                  ${escapeHtml(latestAssessment.urgency_level)}
                </span>
              </div>

              <!-- Component Scores Breakdown -->
              <div class="assessment-factors-list">
                <!-- Miss Distance Component (50%) -->
                <div class="factor-item">
                  <div class="factor-header">
                    <span class="factor-name">Miss Distance Weight</span>
                    <span class="factor-weight">${latestAssessment.component_scores.missDistance?.score || 0} / 50</span>
                  </div>
                  <div class="distribution-bar-track">
                    <div class="distribution-bar-fill" style="background: var(--color-brand); width: ${((latestAssessment.component_scores.missDistance?.score || 0) / 50) * 100}%;"></div>
                  </div>
                  <p class="factor-reason">${escapeHtml(latestAssessment.explanations.missDistance || 'Proximity evaluation')}</p>
                </div>

                <!-- Time to TCA Component (30%) -->
                <div class="factor-item">
                  <div class="factor-header">
                    <span class="factor-name">Time to TCA Weight</span>
                    <span class="factor-weight">${latestAssessment.component_scores.timeToTca?.score || 0} / 30</span>
                  </div>
                  <div class="distribution-bar-track">
                    <div class="distribution-bar-fill" style="background: var(--color-brand); width: ${((latestAssessment.component_scores.timeToTca?.score || 0) / 30) * 100}%;"></div>
                  </div>
                  <p class="factor-reason">${escapeHtml(latestAssessment.explanations.timeToTca || 'Encounter lead time')}</p>
                </div>

                <!-- Probability Metric Component (15%) -->
                <div class="factor-item">
                  <div class="factor-header">
                    <span class="factor-name">Screening Max Probability</span>
                    <span class="factor-weight">${latestAssessment.component_scores.probability?.score || 0} / 15</span>
                  </div>
                  <div class="distribution-bar-track">
                    <div class="distribution-bar-fill" style="background: var(--color-brand); width: ${((latestAssessment.component_scores.probability?.score || 0) / 15) * 100}%;"></div>
                  </div>
                  <p class="factor-reason">${escapeHtml(latestAssessment.explanations.probability || 'Upper-bound catalog metric')}</p>
                </div>

                <!-- Data Freshness Component (5%) -->
                <div class="factor-item">
                  <div class="factor-header">
                    <span class="factor-name">TLE Data Freshness</span>
                    <span class="factor-weight">${latestAssessment.component_scores.dataFreshness?.score || 0} / 5</span>
                  </div>
                  <div class="distribution-bar-track">
                    <div class="distribution-bar-fill" style="background: var(--color-brand); width: ${((latestAssessment.component_scores.dataFreshness?.score || 0) / 5) * 100}%;"></div>
                  </div>
                  <p class="factor-reason">${escapeHtml(latestAssessment.explanations.dataFreshness || 'Epoch propagation uncertainty')}</p>
                </div>
              </div>

              <!-- Scientific Limitation Disclaimer -->
              <div class="methodology-notice" style="margin-top: var(--space-4);">
                <span>ℹ</span>
                <div>
                  <strong>Scientific Methodology Notice:</strong> The score above is an explainable review-priority heuristic
                  designed for operational triage, not an authoritative collision probability or maneuver recommendation.
                  CelesTrak SOCRATES MAX_PROB values represent upper-bound screening indicators based on simplified error covariances.
                </div>
              </div>
            `
                : `<p class="state-desc">No assessment recorded for this encounter.</p>`
            }
          </div>

          <!-- Operator Review Workflow -->
          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Operator Review Decision</h2>
                <div class="card-subtitle">Auditable human-in-the-loop operational adjudication</div>
              </div>
              <span class="badge ${getReviewBadgeClass(event.review_status)}">${escapeHtml(event.review_status)}</span>
            </div>

            <!-- Review Submission Form -->
            <form id="review-action-form" style="display: flex; flex-direction: column; gap: var(--space-3);">
              <div class="form-group">
                <label class="form-label" for="review-action-select">Review Action</label>
                <select id="review-action-select" class="form-select" required>
                  <option value="ACKNOWLEDGE">ACKNOWLEDGE (Under Active Monitoring)</option>
                  <option value="ESCALATE">ESCALATE (Escalate for Manoeuvre Screening)</option>
                  <option value="DISMISS">DISMISS (No Conjunction Threat)</option>
                  <option value="REQUEST_REASSESSMENT">REQUEST_REASSESSMENT (Re-evaluate Heuristics)</option>
                </select>
              </div>

              <div class="form-group">
                <label class="form-label" for="review-justification">
                  <span>Technical Justification <span class="req">*</span></span>
                  <span id="char-counter" class="review-char-counter">
                    0 / 10 min chars
                  </span>
                </label>
                <textarea
                  id="review-justification"
                  class="form-textarea"
                  rows="3"
                  placeholder="Provide a mandatory technical justification (minimum 10 characters)..."
                  required
                ></textarea>
              </div>

              <!-- Operator Authentication Prompt if not already set -->
              <div id="operator-key-prompt-wrapper" style="${state.hasOperatorAuth() ? 'display: none;' : ''}">
                <div class="form-group">
                  <label class="form-label" for="input-operator-key">Operator API Key</label>
                  <input
                    type="password"
                    id="input-operator-key"
                    class="form-input"
                    placeholder="Enter operator API key..."
                    value="${state.get('operatorApiKey') || ''}"
                  />
                  <span class="form-hint">
                    Key is held in transient memory only; never stored on disk.
                  </span>
                </div>
              </div>

              <div id="review-form-feedback" style="display: none; font-size: var(--text-xs); padding: var(--space-2); border-radius: var(--radius-xs);"></div>

              <button type="submit" id="btn-submit-review" class="btn btn-primary" style="width: 100%;">
                Submit Operator Review Decision
              </button>
            </form>

            <!-- Review History Stream -->
            <div style="margin-top: var(--space-5); border-top: 1px solid var(--border-subtle); padding-top: var(--space-4);">
              <h3 style="font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: var(--space-3);">
                Historical Operator Decisions
              </h3>
              <div id="reviews-history-stream" class="review-history-list">
                ${
                  latestReview
                    ? `
                  <div class="review-history-item">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-1);">
                      <span class="badge ${getReviewBadgeClass(latestReview.new_review_status)}">${escapeHtml(latestReview.action)}</span>
                      <span class="tabular-nums" style="font-size: 11px; color: var(--text-muted);">${formatUtc(latestReview.created_at)}</span>
                    </div>
                    <div style="font-size: var(--text-xs); color: var(--text-primary); margin-bottom: var(--space-1); font-style: italic;">
                      "${escapeHtml(latestReview.justification)}"
                    </div>
                    <div style="font-size: 11px; font-family: var(--font-mono); color: var(--text-muted);">
                      Operator: <strong style="color: var(--text-secondary);">${escapeHtml(latestReview.actor_id)}</strong> | ${escapeHtml(latestReview.previous_review_status)} → ${escapeHtml(latestReview.new_review_status)}
                    </div>
                  </div>
                `
                    : `<p class="state-desc" style="font-size: var(--text-xs);">No operator review recorded yet.</p>`
                }
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Copy buttons for audit trail
    contentEl.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const hash = btn.getAttribute('data-hash');
        if (hash) {
          copyToClipboard(hash, 'Audit Entry Hash');
        }
      });
    });

    // Character counter for justification
    const justEl = contentEl.querySelector('#review-justification');
    const counterEl = contentEl.querySelector('#char-counter');
    if (justEl && counterEl) {
      justEl.addEventListener('input', () => {
        const len = justEl.value.trim().length;
        counterEl.textContent = `${len} / 10 min chars`;
        if (len >= 10) {
          counterEl.classList.add('valid');
        } else {
          counterEl.classList.remove('valid');
        }
      });
    }

    // React to operator authentication changes
    state.subscribe('operatorApiKey', key => {
      const promptWrapper = contentEl.querySelector('#operator-key-prompt-wrapper');
      const keyInput = contentEl.querySelector('#input-operator-key');
      if (promptWrapper) {
        promptWrapper.style.display = key ? 'none' : 'block';
      }
      if (keyInput && !key) {
        keyInput.value = '';
      }
    });

    // Review form submission handler
    const reviewForm = contentEl.querySelector('#review-action-form');
    reviewForm?.addEventListener('submit', async e => {
      e.preventDefault();
      const actionSelect = contentEl.querySelector('#review-action-select');
      const feedbackEl = contentEl.querySelector('#review-form-feedback');
      const submitBtn = contentEl.querySelector('#btn-submit-review');
      const keyInput = contentEl.querySelector('#input-operator-key');

      const action = actionSelect.value;
      const justification = justEl.value.trim();

      // Check justification length
      if (justification.length < 10) {
        if (feedbackEl) {
          feedbackEl.style.display = 'block';
          feedbackEl.style.backgroundColor = 'var(--color-critical-bg)';
          feedbackEl.style.color = 'var(--color-critical)';
          feedbackEl.textContent =
            'A meaningful justification of at least 10 characters is required.';
        }
        return;
      }

      // If operator key is provided in input, save to transient in-memory state
      if (keyInput && keyInput.value.trim()) {
        state.set('operatorApiKey', keyInput.value.trim());
      }

      if (!state.hasOperatorAuth()) {
        if (feedbackEl) {
          feedbackEl.style.display = 'block';
          feedbackEl.style.backgroundColor = 'var(--color-critical-bg)';
          feedbackEl.style.color = 'var(--color-critical)';
          feedbackEl.textContent =
            'Operator API key required to record decisions. Please enter your key.';
        }
        contentEl.querySelector('#operator-key-prompt-wrapper').style.display = 'block';
        return;
      }

      // Disable button during submission
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting decision...';
      if (feedbackEl) feedbackEl.style.display = 'none';

      try {
        await api.postReview(eventId, {
          action,
          justification,
          actorId: state.get('operatorActorId') || 'flight-operator',
        });

        showToast(`Review action '${action}' recorded successfully!`, 'success');
        // Clear textarea
        justEl.value = '';
        counterEl.textContent = '0 / 10 min chars';

        // Reload data to reflect state change & audit append
        await loadEventDetailsData(container, eventId);
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Operator Review Decision';

        if (feedbackEl) {
          feedbackEl.style.display = 'block';
          feedbackEl.style.backgroundColor = 'var(--color-critical-bg)';
          feedbackEl.style.color = 'var(--color-critical)';
          feedbackEl.textContent = `Submission failed: ${err.message}`;
        }

        if (err.status === 401 || err.status === 403) {
          contentEl.querySelector('#operator-key-prompt-wrapper').style.display = 'block';
          state.clearOperatorAuth();
        }
      }
    });

    // SGP4 Screening Form Handling
    const sgp4Form = contentEl.querySelector('#sgp4-screening-form');
    const btnLoadTle = contentEl.querySelector('#btn-load-sample-tles');
    const sgp4Feedback = contentEl.querySelector('#sgp4-feedback');
    const resultsContainer = contentEl.querySelector('#sgp4-results-container');
    const p1Input = contentEl.querySelector('#sgp4-primary-line1');
    const p2Input = contentEl.querySelector('#sgp4-primary-line2');
    const s1Input = contentEl.querySelector('#sgp4-secondary-line1');
    const s2Input = contentEl.querySelector('#sgp4-secondary-line2');
    const tcaInput = contentEl.querySelector('#sgp4-nominal-tca');
    const winInput = contentEl.querySelector('#sgp4-window-minutes');
    const btnComputeSgp4 = contentEl.querySelector('#btn-compute-sgp4');

    btnLoadTle?.addEventListener('click', () => {
      const pIdStr = String(event.primary_object_id).padStart(5, '0');
      const sIdStr = String(event.secondary_object_id).padStart(5, '0');

      const p1Pref = `1 ${pIdStr}U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  900`;
      const p1 = p1Pref + computeTleChecksum(p1Pref + '0');
      const p2Pref = `2 ${pIdStr}  51.6400 208.9163 0004780  69.9862  25.2906 15.4981501643190`;
      const p2 = p2Pref + computeTleChecksum(p2Pref + '0');

      const s1Pref = `1 ${sIdStr}U 93036SX  24001.50000000  .00001234  00000-0  56789-4 0  900`;
      const s1 = s1Pref + computeTleChecksum(s1Pref + '0');
      const s2Pref = `2 ${sIdStr}  74.0400 210.1234 0021500 120.4500  45.6700 14.8500000021345`;
      const s2 = s2Pref + computeTleChecksum(s2Pref + '0');

      if (p1Input) p1Input.value = p1;
      if (p2Input) p2Input.value = p2;
      if (s1Input) s1Input.value = s1;
      if (s2Input) s2Input.value = s2;
      showToast('Sample TLE elements loaded.', 'info');
    });

    sgp4Form?.addEventListener('submit', async e => {
      e.preventDefault();
      if (sgp4Feedback) sgp4Feedback.style.display = 'none';

      const line1P = p1Input ? p1Input.value.trim() : '';
      const line2P = p2Input ? p2Input.value.trim() : '';
      const line1S = s1Input ? s1Input.value.trim() : '';
      const line2S = s2Input ? s2Input.value.trim() : '';
      const nomTca = tcaInput ? tcaInput.value.trim() : '';
      const win = winInput ? parseInt(winInput.value, 10) || 10 : 10;

      if (!line1P || !line2P || !line1S || !line2S) {
        if (sgp4Feedback) {
          sgp4Feedback.style.display = 'block';
          sgp4Feedback.style.backgroundColor = 'var(--color-critical-bg)';
          sgp4Feedback.style.color = 'var(--color-critical)';
          sgp4Feedback.textContent = 'Both Primary and Secondary TLE lines (1 and 2) are required.';
        }
        return;
      }

      if (btnComputeSgp4) {
        btnComputeSgp4.disabled = true;
        btnComputeSgp4.textContent = 'Computing SGP4 trajectory...';
      }

      try {
        const res = await api.computePropagation({
          primaryTle: { line1: line1P, line2: line2P },
          secondaryTle: { line1: line1S, line2: line2S },
          nominalTca: nomTca,
          searchWindowMinutes: win,
          eventId: event.id,
        });

        const est = res.data;
        showToast('SGP4 orbital encounter screening computed successfully.', 'success');

        if (resultsContainer) {
          resultsContainer.innerHTML =
            `
            <div class="sgp4-result-card">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-2); flex-wrap: wrap; gap: var(--space-2);">
                <div style="display: flex; align-items: center; gap: var(--space-2);">
                  <span class="badge badge-success" style="font-size: 10px;">LATEST SCREENING RESULT</span>
                  <span style="font-size: 11px; font-family: var(--font-mono); color: var(--text-muted);">${formatUtc(est.estimatedTca)}</span>
                </div>
                <span style="font-size: 10px; font-family: var(--font-mono); color: var(--text-muted);">
                  Δt from TCA: ${est.tcaDeltaSeconds > 0 ? '+' : ''}${est.tcaDeltaSeconds}s
                </span>
              </div>
              <div class="sgp4-result-grid">
                <div>
                  <span style="color: var(--text-muted); font-size: 10px; display: block;">SGP4 Miss Distance:</span>
                  <strong style="font-family: var(--font-mono); font-size: var(--text-sm); color: ${est.estimatedMissDistanceKm < 1.0 ? 'var(--color-critical)' : est.estimatedMissDistanceKm < 5.0 ? 'var(--color-high)' : 'var(--text-primary)'};">
                    ${formatDistance(est.estimatedMissDistanceKm)}
                  </strong>
                </div>
                <div>
                  <span style="color: var(--text-muted); font-size: 10px; display: block;">SOCRATES Range:</span>
                  <span style="font-family: var(--font-mono);">${formatDistance(event.latest_range_km)}</span>
                </div>
                <div>
                  <span style="color: var(--text-muted); font-size: 10px; display: block;">Relative Velocity:</span>
                  <span style="font-family: var(--font-mono);">${formatVelocity(est.estimatedRelativeSpeedKmS)}</span>
                </div>
                <div>
                  <span style="color: var(--text-muted); font-size: 10px; display: block;">Primary TLE Age:</span>
                  <span style="font-family: var(--font-mono);">${est.primaryObject.tleAgeHours}h</span>
                </div>
                <div>
                  <span style="color: var(--text-muted); font-size: 10px; display: block;">Secondary TLE Age:</span>
                  <span style="font-family: var(--font-mono);">${est.secondaryObject.tleAgeHours}h</span>
                </div>
              </div>
              ${renderEncounterProfileChart(est)}
              ${est.persisted ? `<div style="margin-top: var(--space-2); font-size: 11px; font-family: var(--font-mono); color: var(--color-success);">✓ Persisted to orbital_screenings & appended to cryptographic audit ledger.</div>` : ''}
            </div>
          ` + resultsContainer.innerHTML;
        }
      } catch (err) {
        if (sgp4Feedback) {
          sgp4Feedback.style.display = 'block';
          sgp4Feedback.style.backgroundColor = 'var(--color-critical-bg)';
          sgp4Feedback.style.color = 'var(--color-critical)';
          sgp4Feedback.textContent = `Screening failed: ${err.message}`;
        }
      } finally {
        if (btnComputeSgp4) {
          btnComputeSgp4.disabled = false;
          btnComputeSgp4.textContent = 'Compute SGP4 Encounter Estimate';
        }
      }
    });
  } catch (err) {
    contentEl.innerHTML = `
      <div class="card state-box">
        <div class="state-icon">⚠</div>
        <h2 class="state-title">Failed to Load Event Details</h2>
        <p class="state-desc">${escapeHtml(err.message)}</p>
        <button id="btn-retry-details" class="btn btn-primary btn-sm">Retry Request</button>
      </div>
    `;
    contentEl.querySelector('#btn-retry-details')?.addEventListener('click', () => {
      loadEventDetailsData(container, eventId);
    });
  }
}
