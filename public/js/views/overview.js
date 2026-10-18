/**
 * @fileoverview Part 6A: Operational Overview View
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
      <div class="view-title-group">
        <h1>Operational Conjunction Overview</h1>
        <p class="view-description">
          Real-time summary of correlated satellite close-approach events, screening urgency distributions,
          and latest SOCRATES snapshot processing status.
        </p>
      </div>
      <div class="header-action-group">
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

    // Filter upcoming critical / high priority events for top list
    const topUrgentEvents = events.slice(0, 6);

    contentEl.innerHTML = `
      <!-- KPI Metric Cards Grid -->
      <div class="metrics-grid">
        <div class="metric-card">
          <span class="metric-label">Active Encounters</span>
          <span class="metric-value">${totalEvents}</span>
          <span class="metric-subtext">${unreviewedCount} pending initial operator review</span>
        </div>

        <div class="metric-card" style="border-left: 3px solid var(--color-critical);">
          <span class="metric-label">Critical Review Urgency</span>
          <span class="metric-value" style="color: var(--color-critical);">${criticalCount}</span>
          <span class="metric-subtext">Immediate screening required</span>
        </div>

        <div class="metric-card" style="border-left: 3px solid ${reReviewCount > 0 ? 'var(--color-critical)' : 'var(--color-success)'};">
          <span class="metric-label">Fresh Re-Review Required</span>
          <span class="metric-value" style="color: ${reReviewCount > 0 ? 'var(--color-critical)' : 'var(--text-primary)'};">${reReviewCount}</span>
          <span class="metric-subtext">Material prediction drift detected</span>
        </div>

        <div class="metric-card">
          <span class="metric-label">Minimum Miss Distance</span>
          <span class="metric-value" style="font-size: var(--text-2xl);">${formatDistance(closestEvent.min_predicted_range_km)}</span>
          <span class="metric-subtext">${escapeHtml(closestEvent.primary_object_name)} vs ${escapeHtml(closestEvent.secondary_object_name)}</span>
        </div>
      </div>

      <!-- Urgency Distribution and Ingestion Summary -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: var(--space-6); margin-bottom: var(--space-6);">
        <!-- Priority Classification Breakdown -->
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Priority Assessment Classification</h2>
          </div>
          <div style="display: flex; flex-direction: column; gap: var(--space-3);">
            <div>
              <div style="display: flex; justify-content: space-between; font-size: var(--text-xs); margin-bottom: var(--space-1);">
                <span class="badge badge-critical">Critical Urgency</span>
                <span style="font-family: var(--font-mono); font-weight: bold;">${criticalCount} (${totalEvents ? Math.round((criticalCount / totalEvents) * 100) : 0}%)</span>
              </div>
              <div style="background: var(--bg-surface-2); height: 6px; border-radius: 3px; overflow: hidden;">
                <div style="background: var(--color-critical); width: ${totalEvents ? (criticalCount / totalEvents) * 100 : 0}%; height: 100%;"></div>
              </div>
            </div>

            <div>
              <div style="display: flex; justify-content: space-between; font-size: var(--text-xs); margin-bottom: var(--space-1);">
                <span class="badge badge-high">High Urgency</span>
                <span style="font-family: var(--font-mono); font-weight: bold;">${highCount} (${totalEvents ? Math.round((highCount / totalEvents) * 100) : 0}%)</span>
              </div>
              <div style="background: var(--bg-surface-2); height: 6px; border-radius: 3px; overflow: hidden;">
                <div style="background: var(--color-high); width: ${totalEvents ? (highCount / totalEvents) * 100 : 0}%; height: 100%;"></div>
              </div>
            </div>

            <div>
              <div style="display: flex; justify-content: space-between; font-size: var(--text-xs); margin-bottom: var(--space-1);">
                <span class="badge badge-medium">Medium Urgency</span>
                <span style="font-family: var(--font-mono); font-weight: bold;">${mediumCount} (${totalEvents ? Math.round((mediumCount / totalEvents) * 100) : 0}%)</span>
              </div>
              <div style="background: var(--bg-surface-2); height: 6px; border-radius: 3px; overflow: hidden;">
                <div style="background: var(--color-medium); width: ${totalEvents ? (mediumCount / totalEvents) * 100 : 0}%; height: 100%;"></div>
              </div>
            </div>

            <div>
              <div style="display: flex; justify-content: space-between; font-size: var(--text-xs); margin-bottom: var(--space-1);">
                <span class="badge badge-low">Low / Monitoring</span>
                <span style="font-family: var(--font-mono); font-weight: bold;">${lowCount} (${totalEvents ? Math.round((lowCount / totalEvents) * 100) : 0}%)</span>
              </div>
              <div style="background: var(--bg-surface-2); height: 6px; border-radius: 3px; overflow: hidden;">
                <div style="background: var(--color-low); width: ${totalEvents ? (lowCount / totalEvents) * 100 : 0}%; height: 100%;"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Latest Ingestion Activity -->
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Latest SOCRATES Ingestion Status</h2>
            <button id="btn-view-all-batches" class="btn btn-secondary btn-sm">All Batches →</button>
          </div>
          ${
            latestBatch
              ? `
            <div style="display: flex; flex-direction: column; gap: var(--space-3); font-size: var(--text-sm);">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-muted);">Batch ID</span>
                <span style="font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-secondary);">${latestBatch.id.slice(0, 13)}...</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-muted);">Status</span>
                <span class="badge badge-success">${escapeHtml(latestBatch.status)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-muted);">Ingested At</span>
                <span style="font-family: var(--font-mono); font-size: var(--text-xs);">${formatUtc(latestBatch.ingested_at)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-muted);">Rows / Valid Obs</span>
                <span style="font-family: var(--font-mono);">${latestBatch.row_count} total / ${latestBatch.valid_count} valid</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-muted);">Scope</span>
                <span class="badge badge-neutral">${escapeHtml(latestBatch.screening_scope)}</span>
              </div>
            </div>
          `
              : `<p class="state-desc">No ingestion batches recorded yet.</p>`
          }
        </div>
      </div>

      <!-- Priority Triage Queue (Top Encounters) -->
      <div class="table-container">
        <div class="table-toolbar">
          <h2 class="card-title">Priority Encounter Queue (Closest Miss Distance)</h2>
          <button id="btn-view-all-events" class="btn btn-secondary btn-sm">View Full Triage Queue (${totalEvents}) →</button>
        </div>
        <div style="overflow-x: auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Primary Object</th>
                <th>Secondary Object</th>
                <th>Predicted TCA</th>
                <th>Miss Distance</th>
                <th>Priority</th>
                <th>Review Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${topUrgentEvents
                .map(
                  evt => `
                <tr class="clickable" data-event-id="${evt.id}">
                  <td>
                    <div style="font-weight: 600;">${escapeHtml(evt.primary_object_name)}</div>
                    <div style="font-size: var(--text-xs); font-family: var(--font-mono); color: var(--text-muted);">NORAD ${evt.primary_object_id}</div>
                  </td>
                  <td>
                    <div style="font-weight: 600;">${escapeHtml(evt.secondary_object_name)}</div>
                    <div style="font-size: var(--text-xs); font-family: var(--font-mono); color: var(--text-muted);">NORAD ${evt.secondary_object_id}</div>
                  </td>
                  <td>
                    <div>${formatUtc(evt.latest_tca)}</div>
                    <div style="font-size: var(--text-xs); font-family: var(--font-mono); color: var(--text-muted);">${formatRelativeTime(evt.latest_tca)}</div>
                  </td>
                  <td>
                    <div style="font-family: var(--font-mono); font-weight: 700; color: ${parseFloat(evt.latest_range_km) < 1.0 ? 'var(--color-critical)' : 'var(--text-primary)'};">
                      ${formatDistance(evt.latest_range_km)}
                    </div>
                    <div style="font-size: 11px; font-family: var(--font-mono); color: var(--text-muted);">
                      min: ${formatDistance(evt.min_predicted_range_km)}
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
    contentEl.querySelectorAll('.clickable').forEach(row => {
      row.addEventListener('click', e => {
        const eventId = row.getAttribute('data-event-id');
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
