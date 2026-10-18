/**
 * @fileoverview Part 6B: Event Triage Queue View
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
      <div class="view-title-group">
        <h1>Conjunction Event Triage Queue</h1>
        <p class="view-description">
          Review correlated close-approach encounters, evaluate assessment urgency,
          and select events to inspect chronological prediction evolution.
        </p>
      </div>
      <div class="header-action-group">
        <button id="btn-refresh-events" class="btn btn-secondary btn-sm">↻ Refresh</button>
      </div>
    </div>

    <!-- Filter & Search Toolbar -->
    <div class="card" style="margin-bottom: var(--space-4); padding: var(--space-4);">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--space-3); align-items: end;">
        <div class="form-group">
          <label class="form-label" for="filter-urgency">Priority Urgency</label>
          <select id="filter-urgency" class="select-input">
            <option value="">All Urgencies</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="filter-review">Review Status</label>
          <select id="filter-review" class="select-input">
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
          <select id="filter-lifecycle" class="select-input">
            <option value="">All Lifecycle</option>
            <option value="MONITORING">Monitoring</option>
            <option value="PAST_TCA">Past TCA</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="filter-norad">NORAD Object ID</label>
          <input type="number" id="filter-norad" class="input-text" placeholder="e.g. 25544" min="1" />
        </div>

        <div class="form-group">
          <label class="form-label" for="filter-max-range">Max Range (km)</label>
          <input type="number" id="filter-max-range" class="input-text" placeholder="e.g. 5.0" step="0.1" min="0" />
        </div>

        <div class="form-group">
          <label class="form-label" for="filter-sort">Sort By</label>
          <select id="filter-sort" class="select-input">
            <option value="latest_range_km:ASC">Miss Distance (Closest First)</option>
            <option value="latest_range_km:DESC">Miss Distance (Furthest First)</option>
            <option value="latest_tca:ASC">Predicted TCA (Soonest First)</option>
            <option value="latest_tca:DESC">Predicted TCA (Furthest First)</option>
            <option value="urgency_level:DESC">Urgency Level (Highest First)</option>
            <option value="observation_count:DESC">Observation Count (Most First)</option>
            <option value="created_at:DESC">Created Date (Newest First)</option>
          </select>
        </div>

        <div style="display: flex; gap: var(--space-2);">
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
        <div class="state-box">
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
      <div style="overflow-x: auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Primary Object</th>
              <th>Secondary Object</th>
              <th>Predicted TCA (UTC)</th>
              <th>Predicted Miss Distance</th>
              <th>Obs</th>
              <th>Priority</th>
              <th>Lifecycle</th>
              <th>Review Status</th>
              <th>Tracking</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${events
              .map(
                evt => `
              <tr class="clickable" data-event-id="${evt.id}">
                <td>
                  <div style="font-weight: 600;">${escapeHtml(evt.primary_object_name)}</div>
                  <div style="font-size: var(--text-xs); font-family: var(--font-mono); color: var(--text-muted);">
                    NORAD ${evt.primary_object_id}
                    <span class="status-tag ${evt.primary_operational_status === 'OPERATIONAL' ? 'active' : 'debris'}">${escapeHtml(evt.primary_operational_status || 'UNKNOWN')}</span>
                  </div>
                </td>
                <td>
                  <div style="font-weight: 600;">${escapeHtml(evt.secondary_object_name)}</div>
                  <div style="font-size: var(--text-xs); font-family: var(--font-mono); color: var(--text-muted);">
                    NORAD ${evt.secondary_object_id}
                    <span class="status-tag ${evt.secondary_operational_status === 'OPERATIONAL' ? 'active' : 'debris'}">${escapeHtml(evt.secondary_operational_status || 'UNKNOWN')}</span>
                  </div>
                </td>
                <td>
                  <div>${formatUtc(evt.latest_tca)}</div>
                  <div style="font-size: var(--text-xs); font-family: var(--font-mono); color: var(--text-muted);">
                    ${formatRelativeTime(evt.latest_tca)}
                  </div>
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
                  <span style="font-family: var(--font-mono); font-weight: 600;">${evt.observation_count}</span>
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
                <td>
                  <button class="btn btn-secondary btn-sm" data-id="${evt.id}">Inspect →</button>
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
          Showing ${(pagination.page - 1) * pagination.limit + 1}–${Math.min(pagination.page * pagination.limit, pagination.total)} of ${pagination.total} events
        </div>
        <div class="pagination-controls">
          <button id="btn-page-prev" class="btn btn-secondary btn-sm" ${pagination.page <= 1 ? 'disabled' : ''}>← Previous</button>
          <span>Page ${pagination.page} of ${pagination.totalPages}</span>
          <button id="btn-page-next" class="btn btn-secondary btn-sm" ${pagination.page >= pagination.totalPages ? 'disabled' : ''}>Next →</button>
        </div>
      </div>
    `;

    // Row click listeners
    wrapper.querySelectorAll('.clickable').forEach(row => {
      row.addEventListener('click', () => {
        const eventId = row.getAttribute('data-event-id');
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
      <div class="state-box">
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
