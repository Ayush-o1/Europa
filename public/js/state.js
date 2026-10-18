/**
 * @fileoverview Europa Client State Management
 *
 * Manages reactive in-memory state for active view, selected encounter event,
 * query filters, and transient operator credentials.
 * Operator credentials are kept strictly in transient memory and are never persisted to web storage.
 */

class AppState {
  constructor() {
    this.state = {
      currentView: 'overview',
      selectedEventId: null,
      operatorApiKey: null, // Strictly in-memory
      operatorActorId: 'operator',
      health: null,
      eventsFilter: {
        page: 1,
        limit: 20,
        urgency: '',
        lifecycleState: '',
        reviewStatus: '',
        objectId: '',
        sortBy: 'latest_range_km',
        sortOrder: 'ASC',
      },
    };

    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
  }

  /**
   * Retrieves a value from state.
   * @param {string} key
   * @returns {any}
   */
  get(key) {
    return this.state[key];
  }

  /**
   * Updates state and notifies subscribers.
   * @param {string} key
   * @param {any} value
   */
  set(key, value) {
    this.state[key] = value;
    this.notify(key, value);
  }

  /**
   * Subscribes to changes on a specific state key.
   * @param {string} key
   * @param {Function} callback
   * @returns {() => void} Unsubscribe function
   */
  subscribe(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key).add(callback);

    return () => {
      this.listeners.get(key)?.delete(callback);
    };
  }

  /**
   * Notifies subscribers of state change.
   * @param {string} key
   * @param {any} value
   */
  notify(key, value) {
    const callbacks = this.listeners.get(key);
    if (callbacks) {
      callbacks.forEach(cb => {
        try {
          cb(value);
        } catch (err) {
          console.error(`Error in state subscriber for '${key}':`, err);
        }
      });
    }
  }

  /**
   * Checks if an operator API key is present in memory.
   * @returns {boolean}
   */
  hasOperatorAuth() {
    return Boolean(this.state.operatorApiKey && this.state.operatorApiKey.trim().length > 0);
  }

  /**
   * Clears operator credentials from transient memory.
   */
  clearOperatorAuth() {
    this.set('operatorApiKey', null);
  }
}

export const state = new AppState();
