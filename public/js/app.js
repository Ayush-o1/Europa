/**
 * @fileoverview Europa Main Frontend Application Controller
 *
 * Bootstraps the analytical workbench, binds navigation tabs, manages URL hash routing,
 * and dynamically renders view modules.
 */

import { state } from './state.js';
import { setupNavigation } from './components/nav.js';
import { renderLanding } from './views/landing.js';
import { renderOverview } from './views/overview.js';
import { renderEvents } from './views/events.js';
import { renderEventDetails } from './views/eventDetails.js';
import { renderPropagation } from './views/propagation.js';
import { renderIngestion } from './views/ingestion.js';
import { renderAudit } from './views/audit.js';

function initApp() {
  setupNavigation();

  const container = document.getElementById('view-content-root');
  const appHeader = document.getElementById('app-workbench-header');
  if (!container) return;

  // View router map
  const views = {
    landing: renderLanding,
    overview: renderOverview,
    events: renderEvents,
    eventDetails: renderEventDetails,
    propagation: renderPropagation,
    ingestion: renderIngestion,
    audit: renderAudit,
  };

  /**
   * Renders the active view.
   * @param {string} viewName
   */
  async function switchView(viewName) {
    const renderFn = views[viewName] || renderLanding;
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
    // Show/hide workbench operational header based on active view
    if (appHeader) {
      appHeader.style.display = activeView === 'landing' ? 'none' : 'flex';
    }

    // Sync URL hash
    if (activeView === 'landing') {
      if (
        window.location.hash.startsWith('#overview') ||
        window.location.hash.startsWith('#events') ||
        window.location.hash.startsWith('#propagation')
      ) {
        window.location.hash = '';
      }
    } else if (activeView === 'eventDetails') {
      const eventId = state.get('selectedEventId');
      window.location.hash = eventId ? `details/${eventId}` : 'events';
    } else {
      window.location.hash = activeView;
    }

    switchView(activeView);
  });

  const landingSections = [
    'problem',
    'showcase',
    'capabilities',
    'workflow',
    'architecture',
    'limitations',
    'home',
  ];

  // Handle URL hash changes (browser back/forward & direct links)
  function handleHashChange() {
    const rawHash = window.location.hash.replace(/^#\/?/, '').trim();
    const pathname = window.location.pathname;

    // Check if hash targets an anchor section on the landing page
    if (landingSections.includes(rawHash)) {
      if (state.get('currentView') !== 'landing') {
        state.set('currentView', 'landing');
      }
      setTimeout(() => {
        const el = document.getElementById(rawHash);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth' });
        }
      }, 50);
      return;
    }

    if (rawHash.startsWith('details/')) {
      const id = rawHash.replace('details/', '').trim();
      if (id) {
        state.set('selectedEventId', id);
        state.set('currentView', 'eventDetails');
        return;
      }
    }

    if (views[rawHash]) {
      state.set('currentView', rawHash);
      return;
    }

    // Direct /app route defaults to workbench overview
    if (pathname.startsWith('/app')) {
      state.set('currentView', 'overview');
      return;
    }

    // Default root path with empty hash renders public landing page
    state.set('currentView', 'landing');
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
