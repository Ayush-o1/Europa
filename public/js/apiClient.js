/**
 * @fileoverview Voidline Centralized API Client
 *
 * Encapsulates all backend HTTP communication, JSON parsing, error normalization,
 * and transient operator authentication headers.
 */

import { state } from './state.js';

export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   * @param {number} status
   * @param {any} [details]
   */
  constructor(message, code = 'API_ERROR', status = 500, details = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Base HTTP request wrapper handling standard Voidline envelopes.
 * @param {string} endpoint
 * @param {RequestInit} [options={}]
 * @returns {Promise<{ data: any, pagination?: any }>}
 */
async function request(endpoint, options = {}) {
  const url = endpoint.startsWith('/') ? endpoint : `/api/v1/${endpoint}`;

  const headers = new Headers(options.headers || {});

  // Inject operator credentials from in-memory state if available
  const operatorKey = state.get('operatorApiKey');
  if (operatorKey) {
    headers.set('X-API-Key', operatorKey);
    const actorId = state.get('operatorActorId');
    if (actorId) {
      headers.set('X-Actor-Id', actorId);
    }
  }

  // Set JSON content-type if body is JSON
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  let payload;
  try {
    payload = await response.json();
  } catch (_jsonErr) {
    throw new ApiError(
      `Server returned invalid response (${response.status} ${response.statusText}).`,
      'INVALID_SERVER_RESPONSE',
      response.status,
    );
  }

  if (!response.ok || !payload.success) {
    const errorObj = payload.error || {};
    throw new ApiError(
      errorObj.message || `Request failed with status ${response.status}`,
      errorObj.code || `HTTP_${response.status}`,
      response.status,
      errorObj.details,
    );
  }

  return {
    data: payload.data,
    pagination: payload.pagination,
  };
}

export const api = {
  /**
   * Checks system health and database readiness.
   */
  async getHealth() {
    return request('/api/v1/health');
  },

  /**
   * Fetches paginated, filtered, and sorted conjunction events.
   * @param {Record<string, any>} [params={}]
   */
  async getEvents(params = {}) {
    const query = new URLSearchParams();
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined && val !== null && val !== '') {
        query.set(key, String(val));
      }
    }
    const qs = query.toString();
    return request(`/api/v1/events${qs ? `?${qs}` : ''}`);
  },

  /**
   * Retrieves single conjunction event details.
   * @param {string} id
   */
  async getEvent(id) {
    return request(`/api/v1/events/${id}`);
  },

  /**
   * Retrieves chronological observation history for an event.
   * @param {string} id
   */
  async getEventHistory(id) {
    return request(`/api/v1/events/${id}/history`);
  },

  /**
   * Retrieves historical assessment evolution for an event.
   * @param {string} id
   */
  async getEventAssessments(id) {
    return request(`/api/v1/events/${id}/assessments`);
  },

  /**
   * Retrieves current active assessment for an event.
   * @param {string} id
   */
  async getLatestAssessment(id) {
    return request(`/api/v1/events/${id}/assessments/latest`);
  },

  /**
   * Records an operator review decision for an event (requires operator auth).
   * @param {string} id
   * @param {{ action: string, justification: string, actorId?: string }} body
   */
  async postReview(id, body) {
    return request(`/api/v1/events/${id}/reviews`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /**
   * Retrieves paginated audit trail records for an event.
   * @param {string} id
   * @param {{ page?: number, limit?: number }} [params={}]
   */
  async getEventAudit(id, params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return request(`/api/v1/events/${id}/audit${qs ? `?${qs}` : ''}`);
  },

  /**
   * Retrieves paginated ingestion batch history.
   * @param {{ page?: number, limit?: number }} [params={}]
   */
  async getBatches(params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return request(`/api/v1/ingest/batches${qs ? `?${qs}` : ''}`);
  },

  /**
   * Uploads and ingests a SOCRATES CSV snapshot (requires operator auth).
   * @param {FormData} formData
   */
  async uploadSnapshot(formData) {
    return request('/api/v1/ingest/snapshots', {
      method: 'POST',
      body: formData,
    });
  },

  /**
   * Executes read-only cryptographic verification of the audit ledger.
   */
  async verifyAudit() {
    return request('/api/v1/audit/verify');
  },
};
