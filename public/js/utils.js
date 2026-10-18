/**
 * @fileoverview Europa Frontend Utility Functions
 * Precision formatting for SSA metrics, timestamps, status badges, and sanitization.
 */

import { showToast } from './components/toast.js';

/**
 * Escapes unsafe characters for HTML injection prevention.
 * @param {string | null | undefined} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats ISO date string to UTC standard format (e.g. 2026-10-18 19:19:25 UTC).
 * @param {string | Date | null} isoString
 * @returns {string}
 */
export function formatUtc(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '—';

  return d
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC');
}

/**
 * Formats relative time from now (e.g., "in 14.2h" or "3.5h ago").
 * @param {string | Date | null} isoString
 * @param {Date | string} [baseTime=new Date()]
 * @returns {string}
 */
export function formatRelativeTime(isoString, baseTime = new Date()) {
  if (!isoString) return '—';
  const targetMs = new Date(isoString).getTime();
  const baseMs = new Date(baseTime).getTime();
  if (isNaN(targetMs) || isNaN(baseMs)) return '—';

  const diffMs = targetMs - baseMs;
  const isFuture = diffMs > 0;
  const absHours = Math.abs(diffMs) / (1000 * 60 * 60);

  if (absHours < 1) {
    const mins = Math.max(1, Math.round(absHours * 60));
    return isFuture ? `in ${mins}m` : `${mins}m ago`;
  }
  if (absHours < 48) {
    return isFuture ? `in ${absHours.toFixed(1)}h` : `${absHours.toFixed(1)}h ago`;
  }
  const days = absHours / 24;
  return isFuture ? `in ${days.toFixed(1)}d` : `${days.toFixed(1)}d ago`;
}

/**
 * Formats distance in kilometers.
 * @param {number | string | null} km
 * @returns {string}
 */
export function formatDistance(km) {
  if (km === null || km === undefined || km === '') return '—';
  const val = Number(km);
  if (isNaN(val)) return '—';
  return `${val.toFixed(3)} km`;
}

/**
 * Formats velocity in km/s.
 * @param {number | string | null} kms
 * @returns {string}
 */
export function formatVelocity(kms) {
  if (kms === null || kms === undefined || kms === '') return '—';
  const val = Number(kms);
  if (isNaN(val)) return '—';
  return `${val.toFixed(2)} km/s`;
}

/**
 * Formats scientific notation (e.g. 1.20e-4).
 * @param {number | string | null} num
 * @returns {string}
 */
export function formatScientific(num) {
  if (num === null || num === undefined || num === '') return '—';
  const val = Number(num);
  if (isNaN(val) || val === 0) return '0';
  return val.toExponential(2);
}

/**
 * Maps urgency level to corresponding badge CSS class.
 * @param {string} urgency
 * @returns {string}
 */
export function getUrgencyBadgeClass(urgency) {
  switch (String(urgency).toUpperCase()) {
    case 'CRITICAL':
      return 'badge-critical';
    case 'HIGH':
      return 'badge-high';
    case 'MEDIUM':
      return 'badge-medium';
    case 'LOW':
    default:
      return 'badge-low';
  }
}

/**
 * Maps review status to corresponding badge CSS class.
 * @param {string} status
 * @returns {string}
 */
export function getReviewBadgeClass(status) {
  switch (String(status).toUpperCase()) {
    case 'REQUIRES_RE_REVIEW':
      return 'badge-critical';
    case 'ESCALATED':
      return 'badge-high';
    case 'UNDER_REVIEW':
      return 'badge-medium';
    case 'ACTION_TAKEN':
      return 'badge-success';
    case 'DISMISSED':
      return 'badge-neutral';
    case 'UNREVIEWED':
    default:
      return 'badge-brand';
  }
}

/**
 * Maps operational status to status-pill class.
 * @param {string} status
 * @returns {string}
 */
export function getOperationalPillClass(status) {
  switch (String(status).toUpperCase()) {
    case 'OPERATIONAL':
      return 'status-pill operational';
    case 'PARTIALLY_OPERATIONAL':
      return 'status-pill partially-operational';
    case 'NON_OPERATIONAL':
      return 'status-pill non-operational';
    default:
      return 'status-pill';
  }
}

/**
 * Truncates a hex hash string with ellipsis.
 * @param {string} hash
 * @param {number} [startChars=8]
 * @param {number} [endChars=8]
 * @returns {string}
 */
export function truncateHash(hash, startChars = 8, endChars = 8) {
  if (!hash || hash.length <= startChars + endChars + 3) return hash || '—';
  return `${hash.slice(0, startChars)}…${hash.slice(-endChars)}`;
}

/**
 * Copies text to user clipboard and provides toast notification.
 * @param {string} text
 * @param {string} [label='Value']
 */
export async function copyToClipboard(text, label = 'Value') {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      showToast(`${label} copied to clipboard!`, 'info');
    } else {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      showToast(`${label} copied to clipboard!`, 'info');
    }
  } catch (_err) {
    showToast(`Unable to copy ${label}`, 'warning');
  }
}

/**
 * Computes modulo-10 checksum for a 69-character TLE line.
 * @param {string} line
 * @returns {number}
 */
export function computeTleChecksum(line) {
  let sum = 0;
  const len = Math.min(line.length, 68);
  for (let i = 0; i < len; i++) {
    const char = line[i];
    if (char >= '0' && char <= '9') {
      sum += parseInt(char, 10);
    } else if (char === '-') {
      sum += 1;
    }
  }
  return sum % 10;
}
