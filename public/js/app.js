/**
 * @fileoverview Europa Main Frontend Application Controller
 *
 * Bootstraps the analytical workbench, binds navigation tabs, manages URL hash routing,
 * and dynamically renders view modules.
 */

import { state } from './state.js';
import { setupNavigation } from './components/nav.js';
import { renderOverview } from './views/overview.js';
import { renderEvents } from './views/events.js';
import { renderEventDetails } from './views/eventDetails.js';
import { renderIngestion } from './views/ingestion.js';
import { renderAudit } from './views/audit.js';

function initApp() {
  setupNavigation();

  const container = document.getElementById('view-content-root');
  if (!container) return;

  // View router map
  const views = {
    overview: renderOverview,
    events: renderEvents,
    eventDetails: renderEventDetails,
    ingestion: renderIngestion,
    audit: renderAudit,
  };

  /**
   * Renders the active view.
   * @param {string} viewName
   */
  async function switchView(viewName) {
    const renderFn = views[viewName] || renderOverview;
    container.innerHTML = `
      <div class="state-box" style="padding: var(--space-10);">
        <span class="skeleton" style="width: 60%; height: 28px; margin-bottom: var(--space-3);"></span>
        <span class="skeleton" style="width: 100%; height: 200px;"></span>
      </div>
    `;

    try {
      await renderFn(container);
    } catch (err) {
      container.innerHTML = `
        <div class="card state-box">
          <div class="state-icon">⚠</div>
          <h2 class="state-title">Error Rendering View</h2>
          <p class="state-desc">${err.message}</p>
          <button id="btn-reload-view" class="btn btn-primary btn-sm">Reload View</button>
        </div>
      `;
      container
        .querySelector('#btn-reload-view')
        ?.addEventListener('click', () => switchView(viewName));
    }
  }

  // Subscribe to view changes in state
  state.subscribe('currentView', activeView => {
    // Sync URL hash
    if (activeView === 'eventDetails') {
      const eventId = state.get('selectedEventId');
      window.location.hash = eventId ? `details/${eventId}` : 'events';
    } else {
      window.location.hash = activeView;
    }

    switchView(activeView);
  });

  // Handle URL hash changes (browser back/forward & direct links)
  function handleHashChange() {
    const hash = window.location.hash.replace(/^#\/?/, '').trim();

    if (hash.startsWith('details/')) {
      const id = hash.replace('details/', '').trim();
      if (id) {
        state.set('selectedEventId', id);
        state.set('currentView', 'eventDetails');
        return;
      }
    }

    if (views[hash]) {
      state.set('currentView', hash);
    } else {
      state.set('currentView', 'overview');
    }
  }

  window.addEventListener('hashchange', handleHashChange);

  // Initial load
  handleHashChange();
}

// Bootstrap on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
