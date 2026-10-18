/**
 * @fileoverview Event Triage Queue View
 *
 * Provides a responsive, analytical data table for inspecting, filtering, sorting,
 * and paginating correlated conjunction events with live server integration.
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
  getOperationalPillClass,
} from '../utils.js';

let currentFilters = {
  page: 1,
  limit: 20,
  urgency: '',
  lifecycleState: '',
  reviewStatus: '',
  trackingState: '',
  objectId: '',
  missDistanceMax: '',
  sortBy: 'latest_range_km',
  sortOrder: 'ASC',
};

export async function renderEvents(container) {
  container.innerHTML = `
    <div class="view-header">
      <div class="view-header-main">
        <h1 class="view-title">Conjunction Event Triage Queue</h1>
        <p class="view-desc">
          Review correlated close-approach encounters, evaluate assessment urgency,
          and select events to inspect chronological prediction evolution.
        </p>
      </div>
      <div class="view-actions">
        <button id="btn-refresh-events" class="btn btn-secondary btn-sm">↻ Refresh</button>
      </div>
    </div>

    <!-- Filter & Search Toolbar -->
    <div class="card triage-filters-card" style="padding: var(--space-4);">
      <div class="triage-filters-grid">
        <div class="form-group">
          <label class="form-label" for="filter-urgency">Priority Urgency</label>
          <select id="filter-urgency" class="form-select">
            <option value="">All Urgencies</option>
            <option value="CRITICAL">Critical (&lt; 1.0 km)</option>
            <option value="HIGH">High (&lt; 5.0 km)</option>
            <option value="MEDIUM">Medium (&lt; 10.0 km)</option>
            <option value="LOW">Low / Monitoring</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="filter-review">Review Status</label>
          <select id="filter-review" class="form-select">
            <option value="">All Review States</option>
            <option value="UNREVIEWED">Unreviewed</option>
            <option value="UNDER_REVIEW">Under Review</option>
            <option value="ESCALATED">Escalated</option>
            <option value="REQUIRES_RE_REVIEW">Requires Re-Review</option>
            <option value="ACTION_TAKEN">Action Taken</option>
            <option value="DISMISSED">Dismissed</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="filter-lifecycle">Lifecycle State</label>
          <select id="filter-lifecycle" class="form-select">
            <option value="">All Lifecycle</option>
            <option value="MONITORING">Monitoring</option>
            <option value="PAST_TCA">Past TCA</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="filter-norad">NORAD Object ID</label>
          <input type="number" id="filter-norad" class="form-input" placeholder="e.g. 25544" min="1" />
        </div>

        <div class="form-group">
          <label class="form-label" for="filter-max-range">Max Range (km)</label>
          <input type="number" id="filter-max-range" class="form-input" placeholder="e.g. 5.0" step="0.1" min="0" />
        </div>

        <div class="form-group">
          <label class="form-label" for="filter-sort">Sort By</label>
          <select id="filter-sort" class="form-select">
            <option value="latest_range_km:ASC">Miss Distance (Closest First)</option>
            <option value="latest_range_km:DESC">Miss Distance (Furthest First)</option>
            <option value="latest_tca:ASC">Predicted TCA (Soonest First)</option>
            <option value="latest_tca:DESC">Predicted TCA (Furthest First)</option>
            <option value="urgency_level:DESC">Urgency Level (Highest First)</option>
            <option value="observation_count:DESC">Observation Count (Most First)</option>
            <option value="created_at:DESC">Created Date (Newest First)</option>
          </select>
        </div>

        <div class="triage-filter-actions">
          <button id="btn-apply-filters" class="btn btn-primary" style="flex: 1;">Apply</button>
          <button id="btn-reset-filters" class="btn btn-secondary">Reset</button>
        </div>
      </div>
    </div>

    <!-- Table Container -->
    <div id="events-table-wrapper" class="table-container">
      <div class="state-box">
        <span class="skeleton" style="width: 100%; height: 200px;"></span>
      </div>
    </div>
  `;

  // Bind filter events
  const urgencySelect = container.querySelector('#filter-urgency');
  const reviewSelect = container.querySelector('#filter-review');
  const lifecycleSelect = container.querySelector('#filter-lifecycle');
  const noradInput = container.querySelector('#filter-norad');
  const maxRangeInput = container.querySelector('#filter-max-range');
  const sortSelect = container.querySelector('#filter-sort');

  // Set inputs to match current state
  if (urgencySelect) urgencySelect.value = currentFilters.urgency;
  if (reviewSelect) reviewSelect.value = currentFilters.reviewStatus;
  if (lifecycleSelect) lifecycleSelect.value = currentFilters.lifecycleState;
  if (noradInput) noradInput.value = currentFilters.objectId;
  if (maxRangeInput) maxRangeInput.value = currentFilters.missDistanceMax;
  if (sortSelect) {
    sortSelect.value = `${currentFilters.sortBy}:${currentFilters.sortOrder}`;
  }

  container.querySelector('#btn-apply-filters')?.addEventListener('click', () => {
    currentFilters.urgency = urgencySelect?.value || '';
    currentFilters.reviewStatus = reviewSelect?.value || '';
    currentFilters.lifecycleState = lifecycleSelect?.value || '';
    currentFilters.objectId = noradInput?.value ? noradInput.value.trim() : '';
    currentFilters.missDistanceMax = maxRangeInput?.value ? maxRangeInput.value.trim() : '';

    if (sortSelect?.value) {
      const [col, order] = sortSelect.value.split(':');
      currentFilters.sortBy = col;
      currentFilters.sortOrder = order;
    }
    currentFilters.page = 1;
    loadEventsTable(container);
  });

  container.querySelector('#btn-reset-filters')?.addEventListener('click', () => {
    currentFilters = {
      page: 1,
      limit: 20,
      urgency: '',
      lifecycleState: '',
      reviewStatus: '',
      trackingState: '',
      objectId: '',
      missDistanceMax: '',
      sortBy: 'latest_range_km',
      sortOrder: 'ASC',
    };
    if (urgencySelect) urgencySelect.value = '';
    if (reviewSelect) reviewSelect.value = '';
    if (lifecycleSelect) lifecycleSelect.value = '';
    if (noradInput) noradInput.value = '';
    if (maxRangeInput) maxRangeInput.value = '';
    if (sortSelect) sortSelect.value = 'latest_range_km:ASC';
    loadEventsTable(container);
  });

  container.querySelector('#btn-refresh-events')?.addEventListener('click', () => {
    loadEventsTable(container);
  });

  await loadEventsTable(container);
}

async function loadEventsTable(container) {
  const wrapper = container.querySelector('#events-table-wrapper');
  if (!wrapper) return;

  wrapper.innerHTML = `
    <div class="state-box" style="padding: var(--space-8);">
      <span class="skeleton" style="width: 80%; height: 24px; margin-bottom: var(--space-2);"></span>
      <span class="skeleton" style="width: 100%; height: 160px;"></span>
    </div>
  `;

  try {
    const params = {
      page: currentFilters.page,
      limit: currentFilters.limit,
      sortBy: currentFilters.sortBy,
      sortOrder: currentFilters.sortOrder,
    };

    if (currentFilters.urgency) params.urgency = currentFilters.urgency;
    if (currentFilters.reviewStatus) params.reviewStatus = currentFilters.reviewStatus;
    if (currentFilters.lifecycleState) params.lifecycleState = currentFilters.lifecycleState;
    if (currentFilters.objectId) params.objectId = currentFilters.objectId;
    if (currentFilters.missDistanceMax) params.missDistanceMax = currentFilters.missDistanceMax;

    const res = await api.getEvents(params);
    const events = res.data || [];
    const pagination = res.pagination || {
      page: 1,
      limit: 20,
      total: events.length,
      totalPages: 1,
    };

    if (events.length === 0) {
      wrapper.innerHTML = `
        <div class="card state-box">
          <div class="state-icon">🔍</div>
          <h2 class="state-title">No Matching Conjunction Events</h2>
          <p class="state-desc">
            No events match the current filter criteria. Adjust your filters or reset to view all correlated encounters.
          </p>
        </div>
      `;
      return;
    }

    wrapper.innerHTML = `
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Primary Object</th>
              <th>Secondary Object</th>
              <th>Predicted TCA (UTC)</th>
              <th>Predicted Miss Distance</th>
              <th style="text-align: center;">Obs</th>
              <th>Priority</th>
              <th>Lifecycle</th>
              <th>Review Status</th>
              <th>Tracking</th>
              <th style="text-align: right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${events
              .map(
                evt => `
              <tr class="clickable" data-event-id="${evt.id}" style="cursor: pointer;">
                <td>
                  <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(evt.primary_object_name)}</div>
                  <div style="font-size: var(--text-2xs); font-family: var(--font-mono); color: var(--text-muted); display: flex; align-items: center; gap: var(--space-1-5); margin-top: 2px;">
                    <span>NORAD ${evt.primary_object_id}</span>
                    <span class="${getOperationalPillClass(evt.primary_operational_status)}">${escapeHtml(evt.primary_operational_status || 'UNKNOWN')}</span>
                  </div>
                </td>
                <td>
                  <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(evt.secondary_object_name)}</div>
                  <div style="font-size: var(--text-2xs); font-family: var(--font-mono); color: var(--text-muted); display: flex; align-items: center; gap: var(--space-1-5); margin-top: 2px;">
                    <span>NORAD ${evt.secondary_object_id}</span>
                    <span class="${getOperationalPillClass(evt.secondary_operational_status)}">${escapeHtml(evt.secondary_operational_status || 'UNKNOWN')}</span>
                  </div>
                </td>
                <td>
                  <div class="tabular-nums" style="color: var(--text-primary);">${formatUtc(evt.latest_tca)}</div>
                  <div style="font-size: var(--text-2xs); font-family: var(--font-mono); color: var(--color-cyan); margin-top: 2px;">
                    ${formatRelativeTime(evt.latest_tca)}
                  </div>
                </td>
                <td>
                  <div class="range-indicator-cell">
                    <strong class="tabular-nums" style="font-size: var(--text-sm); color: ${parseFloat(evt.latest_range_km) < 1.0 ? 'var(--color-critical)' : parseFloat(evt.latest_range_km) < 5.0 ? 'var(--color-high)' : 'var(--text-primary)'};">
                      ${formatDistance(evt.latest_range_km)}
                    </strong>
                    <div style="font-size: 10px; font-family: var(--font-mono); color: var(--text-muted);">
                      min: ${formatDistance(evt.min_predicted_range_km)}
                    </div>
                  </div>
                </td>
                <td style="text-align: center;">
                  <span class="badge badge-neutral tabular-nums" style="font-size: 11px;">${evt.observation_count}</span>
                </td>
                <td>
                  <span class="badge ${getUrgencyBadgeClass(evt.urgency_level)}">${escapeHtml(evt.urgency_level)}</span>
                </td>
                <td>
                  <span class="badge badge-neutral">${escapeHtml(evt.lifecycle_state)}</span>
                </td>
                <td>
                  <span class="badge ${getReviewBadgeClass(evt.review_status)}">${escapeHtml(evt.review_status)}</span>
                </td>
                <td>
                  <span class="badge ${evt.tracking_state === 'CONFIRMED' ? 'badge-neutral' : 'badge-high'}">${escapeHtml(evt.tracking_state)}</span>
                </td>
                <td style="text-align: right;">
                  <button class="btn btn-secondary btn-sm btn-inspect" data-id="${evt.id}">Inspect →</button>
                </td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
      </div>

      <!-- Pagination Footer -->
      <div class="pagination-bar">
        <div>
          Showing <span class="tabular-nums">${(pagination.page - 1) * pagination.limit + 1}</span>–<span class="tabular-nums">${Math.min(pagination.page * pagination.limit, pagination.total)}</span> of <span class="tabular-nums">${pagination.total}</span> events
        </div>
        <div class="pagination-controls">
          <button id="btn-page-prev" class="btn btn-secondary btn-sm" ${pagination.page <= 1 ? 'disabled' : ''}>← Previous</button>
          <span style="font-family: var(--font-mono); font-size: 11px;">Page ${pagination.page} of ${pagination.totalPages}</span>
          <button id="btn-page-next" class="btn btn-secondary btn-sm" ${pagination.page >= pagination.totalPages ? 'disabled' : ''}>Next →</button>
        </div>
      </div>
    `;

    // Row click listeners
    wrapper.querySelectorAll('.clickable').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.btn-inspect')) return;
        const eventId = row.getAttribute('data-event-id');
        if (eventId) {
          state.set('selectedEventId', eventId);
          state.set('currentView', 'eventDetails');
        }
      });
    });

    wrapper.querySelectorAll('.btn-inspect').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const eventId = btn.getAttribute('data-id');
        if (eventId) {
          state.set('selectedEventId', eventId);
          state.set('currentView', 'eventDetails');
        }
      });
    });

    // Pagination buttons
    wrapper.querySelector('#btn-page-prev')?.addEventListener('click', () => {
      if (currentFilters.page > 1) {
        currentFilters.page -= 1;
        loadEventsTable(container);
      }
    });

    wrapper.querySelector('#btn-page-next')?.addEventListener('click', () => {
      if (currentFilters.page < pagination.totalPages) {
        currentFilters.page += 1;
        loadEventsTable(container);
      }
    });
  } catch (err) {
    wrapper.innerHTML = `
      <div class="card state-box">
        <div class="state-icon">⚠</div>
        <h2 class="state-title">Failed to Query Events</h2>
        <p class="state-desc">${escapeHtml(err.message)}</p>
        <button id="btn-retry-events" class="btn btn-primary btn-sm">Retry Query</button>
      </div>
    `;
    wrapper.querySelector('#btn-retry-events')?.addEventListener('click', () => {
      loadEventsTable(container);
    });
  }
}
