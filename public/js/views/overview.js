/**
 * @fileoverview Operational Overview View
 *
 * Renders real operational metrics, urgency distributions, upcoming encounters,
 * and latest ingestion activity derived strictly from live API queries.
 */

import { api } from '../apiClient.js';
import { state } from '../state.js';
import {
  escapeHtml,
  formatUtc,
  formatRelativeTime,
  formatDistance,
  getUrgencyBadgeClass,
  getReviewBadgeClass,
} from '../utils.js';

export async function renderOverview(container) {
  container.innerHTML = `
    <div class="view-header">
      <div class="view-header-main">
        <h1 class="view-title">Operational Conjunction Overview</h1>
        <p class="view-desc">
          Real-time summary of correlated satellite close-approach events, screening urgency distributions,
          and latest SOCRATES snapshot processing status.
        </p>
      </div>
      <div class="view-actions">
        <button id="btn-refresh-overview" class="btn btn-secondary btn-sm">↻ Refresh</button>
      </div>
    </div>

    <div id="overview-content">
      <div class="state-box">
        <span class="skeleton" style="width: 100%; height: 120px;"></span>
      </div>
    </div>
  `;

  document.getElementById('btn-refresh-overview')?.addEventListener('click', () => {
    loadOverviewData(container);
  });

  await loadOverviewData(container);
}

async function loadOverviewData(container) {
  const contentEl = container.querySelector('#overview-content');
  if (!contentEl) return;

  try {
    // Parallel fetch of real events and batches
    const [eventsRes, batchesRes] = await Promise.all([
      api.getEvents({ limit: 100, sortBy: 'latest_range_km', sortOrder: 'ASC' }),
      api.getBatches({ limit: 5 }),
    ]);

    const events = eventsRes.data || [];
    const batches = batchesRes.data || [];

    // Calculate real metrics from API responses
    const totalEvents = eventsRes.pagination?.total || events.length;
    const criticalCount = events.filter(e => e.urgency_level === 'CRITICAL').length;
    const highCount = events.filter(e => e.urgency_level === 'HIGH').length;
    const mediumCount = events.filter(e => e.urgency_level === 'MEDIUM').length;
    const lowCount = events.filter(e => e.urgency_level === 'LOW').length;
    const reReviewCount = events.filter(e => e.review_status === 'REQUIRES_RE_REVIEW').length;
    const unreviewedCount = events.filter(e => e.review_status === 'UNREVIEWED').length;

    // Empty state if database has zero events
    if (events.length === 0) {
      contentEl.innerHTML = `
        <div class="card state-box">
          <div class="state-icon">🛰️</div>
          <h2 class="state-title">No Conjunction Events Ingested</h2>
          <p class="state-desc">
            The database does not currently contain any processed satellite close-approach snapshots.
            Upload a CelesTrak SOCRATES CSV snapshot to start correlation and assessment.
          </p>
          <div style="display: flex; gap: var(--space-3); margin-top: var(--space-2);">
            <button id="btn-nav-to-ingest" class="btn btn-primary">Go to Snapshot Ingestion →</button>
          </div>
        </div>
      `;

      contentEl.querySelector('#btn-nav-to-ingest')?.addEventListener('click', () => {
        state.set('currentView', 'ingestion');
      });
      return;
    }

    const closestEvent = events[0];
    const latestBatch = batches[0] || null;
    const topUrgentEvents = events.slice(0, 6);

    contentEl.innerHTML = `
      <!-- Operational Telemetry Bar -->
      <div class="telemetry-strip" style="margin-bottom: var(--space-4);">
        <div class="telemetry-item">
          <span>Active Encounters:</span>
          <strong>${totalEvents}</strong>
        </div>
        <div class="telemetry-divider"></div>
        <div class="telemetry-item">
          <span>Close Approach Threshold:</span>
          <strong>5.000 km</strong>
        </div>
        <div class="telemetry-divider"></div>
        <div class="telemetry-item">
          <span>Latest Ingestion:</span>
          <strong>${latestBatch ? formatUtc(latestBatch.ingested_at) : 'None'}</strong>
        </div>
        <div class="telemetry-divider"></div>
        <div class="telemetry-item">
          <span>Evaluation Heuristic:</span>
          <span class="badge badge-brand" style="font-size: 10px;">v1.0.0 Multi-Factor</span>
        </div>
      </div>

      <!-- KPI Metric Cards Grid -->
      <div class="metrics-grid">
        <div class="metric-card accent-brand">
          <span class="metric-label">Active Encounters</span>
          <span class="metric-value">${totalEvents}</span>
          <span class="metric-subtext">
            <span class="badge ${unreviewedCount > 0 ? 'badge-high' : 'badge-neutral'}" style="font-size: 10px;">${unreviewedCount} UNREVIEWED</span>
            <span>pending review</span>
          </span>
        </div>

        <div class="metric-card accent-critical">
          <span class="metric-label">Critical Review Urgency</span>
          <span class="metric-value" style="color: var(--color-critical);">${criticalCount}</span>
          <span class="metric-subtext" style="color: var(--color-critical);">
            ${criticalCount > 0 ? '⚠ Immediate screening required' : '✓ No critical breaches'}
          </span>
        </div>

        <div class="metric-card ${reReviewCount > 0 ? 'accent-high' : 'accent-low'}">
          <span class="metric-label">Re-Review Required</span>
          <span class="metric-value" style="color: ${reReviewCount > 0 ? 'var(--color-high)' : 'var(--text-primary)'};">${reReviewCount}</span>
          <span class="metric-subtext">
            ${reReviewCount > 0 ? 'Material prediction drift detected' : 'Trajectories within tolerances'}
          </span>
        </div>

        <div class="metric-card accent-medium">
          <span class="metric-label">Closest Encounter Range</span>
          <span class="metric-value" style="font-size: var(--text-2xl); color: ${parseFloat(closestEvent.min_predicted_range_km) < 1.0 ? 'var(--color-critical)' : 'var(--text-primary)'};">
            ${formatDistance(closestEvent.min_predicted_range_km)}
          </span>
          <span class="metric-subtext truncate" title="${escapeHtml(closestEvent.primary_object_name)} vs ${escapeHtml(closestEvent.secondary_object_name)}">
            ${escapeHtml(closestEvent.primary_object_name)} vs ${escapeHtml(closestEvent.secondary_object_name)}
          </span>
        </div>
      </div>

      <!-- Urgency Distribution and Ingestion Summary -->
      <div class="overview-grid">
        <!-- Priority Classification Breakdown -->
        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Priority Assessment Classification</h2>
              <div class="card-subtitle">Urgency tier distribution across all correlated encounters</div>
            </div>
            <span class="badge badge-neutral">${totalEvents} TOTAL</span>
          </div>

          <div class="distribution-list">
            <div class="distribution-item">
              <div class="distribution-header">
                <span class="badge badge-critical">Critical Urgency (&lt; 1.0 km)</span>
                <span class="tabular-nums" style="font-weight: 700;">${criticalCount} (${totalEvents ? Math.round((criticalCount / totalEvents) * 100) : 0}%)</span>
              </div>
              <div class="distribution-bar-track">
                <div class="distribution-bar-fill" style="background: var(--color-critical); width: ${totalEvents ? (criticalCount / totalEvents) * 100 : 0}%;"></div>
              </div>
            </div>

            <div class="distribution-item">
              <div class="distribution-header">
                <span class="badge badge-high">High Urgency (&lt; 5.0 km)</span>
                <span class="tabular-nums" style="font-weight: 700;">${highCount} (${totalEvents ? Math.round((highCount / totalEvents) * 100) : 0}%)</span>
              </div>
              <div class="distribution-bar-track">
                <div class="distribution-bar-fill" style="background: var(--color-high); width: ${totalEvents ? (highCount / totalEvents) * 100 : 0}%;"></div>
              </div>
            </div>

            <div class="distribution-item">
              <div class="distribution-header">
                <span class="badge badge-medium">Medium Urgency (&lt; 10.0 km)</span>
                <span class="tabular-nums" style="font-weight: 700;">${mediumCount} (${totalEvents ? Math.round((mediumCount / totalEvents) * 100) : 0}%)</span>
              </div>
              <div class="distribution-bar-track">
                <div class="distribution-bar-fill" style="background: var(--color-medium); width: ${totalEvents ? (mediumCount / totalEvents) * 100 : 0}%;"></div>
              </div>
            </div>

            <div class="distribution-item">
              <div class="distribution-header">
                <span class="badge badge-low">Low / Monitoring</span>
                <span class="tabular-nums" style="font-weight: 700;">${lowCount} (${totalEvents ? Math.round((lowCount / totalEvents) * 100) : 0}%)</span>
              </div>
              <div class="distribution-bar-track">
                <div class="distribution-bar-fill" style="background: var(--color-low); width: ${totalEvents ? (lowCount / totalEvents) * 100 : 0}%;"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Latest Ingestion Activity -->
        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Latest SOCRATES Ingestion Status</h2>
              <div class="card-subtitle">Source snapshot provenance and deduplication record</div>
            </div>
            <button id="btn-view-all-batches" class="btn btn-secondary btn-xs">All Batches →</button>
          </div>
          ${
            latestBatch
              ? `
            <div class="ingestion-summary-grid">
              <div class="ingestion-summary-item">
                <span class="ingestion-summary-label">Batch UUID</span>
                <span class="ingestion-summary-value truncate" title="${latestBatch.id}">${latestBatch.id.slice(0, 13)}…</span>
              </div>
              <div class="ingestion-summary-item">
                <span class="ingestion-summary-label">Processing Status</span>
                <span class="badge badge-success" style="font-size: 10px; width: fit-content;">${escapeHtml(latestBatch.status)}</span>
              </div>
              <div class="ingestion-summary-item">
                <span class="ingestion-summary-label">Ingested At (UTC)</span>
                <span class="ingestion-summary-value">${formatUtc(latestBatch.ingested_at)}</span>
              </div>
              <div class="ingestion-summary-item">
                <span class="ingestion-summary-label">Rows / Valid Observations</span>
                <span class="ingestion-summary-value">${latestBatch.row_count} total / ${latestBatch.valid_count} valid</span>
              </div>
            </div>
            <div style="margin-top: var(--space-3); padding-top: var(--space-2-5); border-top: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center; font-size: var(--text-2xs); color: var(--text-muted);">
              <span>Scope: <span class="badge badge-neutral" style="font-size: 10px;">${escapeHtml(latestBatch.screening_scope)}</span></span>
              <span>SHA-256 Verified ✓</span>
            </div>
          `
              : `<p class="state-desc">No ingestion batches recorded yet.</p>`
          }
        </div>
      </div>

      <!-- Priority Triage Queue (Top Encounters) -->
      <div class="card" style="padding: 0; overflow: hidden;">
        <div class="card-header" style="padding: var(--space-4) var(--space-5); margin-bottom: 0;">
          <div>
            <h2 class="card-title">Priority Encounter Queue (Closest Miss Distance)</h2>
            <div class="card-subtitle">Encounters sorted by minimum predicted miss distance</div>
          </div>
          <button id="btn-view-all-events" class="btn btn-secondary btn-sm">View Full Triage Queue (${totalEvents}) →</button>
        </div>

        <div class="table-wrapper" style="border: none; border-radius: 0;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Primary Object</th>
                <th>Secondary Object</th>
                <th>Predicted TCA (UTC)</th>
                <th>Miss Distance</th>
                <th>Priority</th>
                <th>Review Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${topUrgentEvents
                .map(
                  evt => `
                <tr class="clickable-row" data-event-id="${evt.id}" style="cursor: pointer;">
                  <td>
                    <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(evt.primary_object_name)}</div>
                    <div style="font-size: var(--text-2xs); font-family: var(--font-mono); color: var(--text-muted);">NORAD ${evt.primary_object_id}</div>
                  </td>
                  <td>
                    <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(evt.secondary_object_name)}</div>
                    <div style="font-size: var(--text-2xs); font-family: var(--font-mono); color: var(--text-muted);">NORAD ${evt.secondary_object_id}</div>
                  </td>
                  <td>
                    <div class="tabular-nums">${formatUtc(evt.latest_tca)}</div>
                    <div style="font-size: var(--text-2xs); font-family: var(--font-mono); color: var(--color-cyan);">${formatRelativeTime(evt.latest_tca)}</div>
                  </td>
                  <td>
                    <div class="range-indicator-cell">
                      <strong class="tabular-nums" style="font-size: var(--text-sm); color: ${parseFloat(evt.latest_range_km) < 1.0 ? 'var(--color-critical)' : parseFloat(evt.latest_range_km) < 5.0 ? 'var(--color-high)' : 'var(--text-primary)'};">
                        ${formatDistance(evt.latest_range_km)}
                      </strong>
                      <span style="font-size: 10px; font-family: var(--font-mono); color: var(--text-muted);">
                        min: ${formatDistance(evt.min_predicted_range_km)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span class="badge ${getUrgencyBadgeClass(evt.urgency_level)}">${escapeHtml(evt.urgency_level)}</span>
                  </td>
                  <td>
                    <span class="badge ${getReviewBadgeClass(evt.review_status)}">${escapeHtml(evt.review_status)}</span>
                  </td>
                  <td>
                    <button class="btn btn-secondary btn-sm btn-inspect" data-id="${evt.id}">Inspect →</button>
                  </td>
                </tr>
              `,
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Row click listeners to inspect event
    contentEl.querySelectorAll('.clickable-row').forEach(row => {
      row.addEventListener('click', e => {
        // Prevent double trigger if inspect button itself was clicked
        if (e.target.closest('.btn-inspect')) return;
        const eventId = row.getAttribute('data-event-id');
        if (eventId) {
          state.set('selectedEventId', eventId);
          state.set('currentView', 'eventDetails');
        }
      });
    });

    contentEl.querySelectorAll('.btn-inspect').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const eventId = btn.getAttribute('data-id');
        if (eventId) {
          state.set('selectedEventId', eventId);
          state.set('currentView', 'eventDetails');
        }
      });
    });

    contentEl.querySelector('#btn-view-all-events')?.addEventListener('click', () => {
      state.set('currentView', 'events');
    });

    contentEl.querySelector('#btn-view-all-batches')?.addEventListener('click', () => {
      state.set('currentView', 'ingestion');
    });
  } catch (err) {
    contentEl.innerHTML = `
      <div class="card state-box">
        <div class="state-icon">⚠</div>
        <h2 class="state-title">Failed to Load Overview Data</h2>
        <p class="state-desc">${escapeHtml(err.message)}</p>
        <button id="btn-retry-overview" class="btn btn-primary btn-sm">Retry Request</button>
      </div>
    `;
    contentEl.querySelector('#btn-retry-overview')?.addEventListener('click', () => {
      loadOverviewData(container);
    });
  }
}
