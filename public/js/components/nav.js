/**
 * @fileoverview Application Header & Navigation Component
 * Manages tab switching, system readiness indicator, live UTC clock,
 * breadcrumb hierarchy, and transient operator key modal.
 */

import { state } from '../state.js';
import { api } from '../apiClient.js';
import { createModal } from './modal.js';
import { showToast } from './toast.js';

export function setupNavigation() {
  const tabs = document.querySelectorAll('.nav-tab');
  const authBadge = document.getElementById('operator-auth-badge');
  const statusDot = document.getElementById('system-status-dot');
  const statusText = document.getElementById('system-status-text');
  const utcDisplay = document.getElementById('utc-time-display');

  // Handle Tab Navigation
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetView = tab.getAttribute('data-view');
      if (targetView) {
        state.set('currentView', targetView);
      }
    });
  });

  // React to view changes
  state.subscribe('currentView', activeView => {
    tabs.forEach(tab => {
      if (tab.getAttribute('data-view') === activeView) {
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
      } else {
        tab.classList.remove('active');
        tab.setAttribute('aria-selected', 'false');
      }
    });

    // Reset breadcrumb if navigating to a top-level tab
    if (activeView !== 'eventDetails') {
      setBreadcrumbs([]);
    }
  });

  // Operator Auth Badge click -> Open Modal
  authBadge?.addEventListener('click', () => {
    openOperatorAuthModal();
  });

  // React to operator auth state change
  state.subscribe('operatorApiKey', updateAuthBadge);
  state.subscribe('operatorActorId', updateAuthBadge);

  function updateAuthBadge() {
    if (!authBadge) return;
    if (state.hasOperatorAuth()) {
      authBadge.classList.add('authenticated');
      authBadge.innerHTML = `
        <span class="status-dot" style="background-color: var(--color-success);"></span>
        <span>Operator: ${state.get('operatorActorId') || 'authorized'}</span>
      `;
    } else {
      authBadge.classList.remove('authenticated');
      authBadge.innerHTML = `
        <span class="status-dot" style="background-color: var(--text-muted);"></span>
        <span>Operator Auth: Set Key</span>
      `;
    }
  }

  // Live UTC Clock
  function updateUtcClock() {
    if (!utcDisplay) return;
    const now = new Date();
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const mins = String(now.getUTCMinutes()).padStart(2, '0');
    const secs = String(now.getUTCSeconds()).padStart(2, '0');
    utcDisplay.textContent = `${hours}:${mins}:${secs}`;
  }

  updateUtcClock();
  setInterval(updateUtcClock, 1000);

  // Periodic Health Check (every 60s)
  async function checkHealth() {
    try {
      const res = await api.getHealth();
      if (statusDot) statusDot.className = 'status-dot';
      if (statusText) statusText.textContent = 'System Ready';
      state.set('health', res.data);
    } catch (_err) {
      if (statusDot) statusDot.className = 'status-dot offline';
      if (statusText) statusText.textContent = 'DB Degraded';
    }
  }

  checkHealth();
  setInterval(checkHealth, 60000);
}

/**
 * Sets application breadcrumb bar.
 * @param {Array<{ label: string, view?: string, eventId?: string }>} items
 */
export function setBreadcrumbs(items = []) {
  const root = document.getElementById('breadcrumb-root');
  if (!root) return;

  if (!items || items.length === 0) {
    root.style.display = 'none';
    root.innerHTML = '';
    return;
  }

  root.style.display = 'flex';
  const html = items
    .map((item, idx) => {
      const isLast = idx === items.length - 1;
      if (isLast) {
        return `<span class="breadcrumb-current">${item.label}</span>`;
      }
      return `
        <a href="#${item.view || 'overview'}" class="breadcrumb-link" data-view="${item.view || 'overview'}">${item.label}</a>
        <span class="breadcrumb-separator">/</span>
      `;
    })
    .join('');

  root.innerHTML = html;

  // Bind click handlers
  root.querySelectorAll('.breadcrumb-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const target = link.getAttribute('data-view');
      if (target) {
        state.set('currentView', target);
      }
    });
  });
}

/**
 * Opens operator authentication modal.
 */
export function openOperatorAuthModal() {
  const currentKey = state.get('operatorApiKey') || '';
  const currentActor = state.get('operatorActorId') || 'operator';

  const content = document.createElement('div');
  content.innerHTML = `
    <p style="font-size: var(--text-xs); color: var(--text-secondary); margin-bottom: var(--space-4); line-height: 1.5;">
      Write operations (such as uploading snapshots and submitting operator review decisions)
      require an operator API key. The key is kept strictly in transient memory for this session
      and is never written to disk or browser web storage.
    </p>

    <div class="form-group" style="margin-bottom: var(--space-3);">
      <label class="form-label" for="modal-input-key">Operator API Key</label>
      <input
        type="password"
        id="modal-input-key"
        class="form-input"
        placeholder="Enter operator API key..."
        value="${currentKey}"
      />
      <span class="form-hint">Default development key: <code style="color: var(--text-primary);">europa-dev-key</code></span>
    </div>

    <div class="form-group" style="margin-bottom: var(--space-3);">
      <label class="form-label" for="modal-input-actor">Operator Identity / Call-sign</label>
      <input
        type="text"
        id="modal-input-actor"
        class="form-input"
        placeholder="e.g. flight-director-alpha"
        value="${currentActor}"
      />
      <span class="form-hint">Attributed in the immutable audit ledger.</span>
    </div>
  `;

  const modal = createModal({
    title: 'Operator Access Authorization',
    content,
    actions: [
      {
        text: 'Clear Key',
        className: 'btn-secondary',
        onClick: m => {
          state.clearOperatorAuth();
          state.set('operatorActorId', 'operator');
          showToast('Operator key cleared from memory.', 'info');
          m.close();
        },
      },
      {
        text: 'Save Key in Memory',
        className: 'btn-primary',
        onClick: m => {
          const keyInput = content.querySelector('#modal-input-key');
          const actorInput = content.querySelector('#modal-input-actor');

          const key = keyInput?.value ? keyInput.value.trim() : null;
          const actor = actorInput?.value ? actorInput.value.trim() : 'operator';

          if (key) {
            state.set('operatorActorId', actor || 'operator');
            state.set('operatorApiKey', key);
            showToast('Operator key stored in transient session memory.', 'success');
          } else {
            state.clearOperatorAuth();
            state.set('operatorActorId', 'operator');
            showToast('Operator key removed.', 'info');
          }
          m.close();
        },
      },
    ],
  });

  modal.open();
}
