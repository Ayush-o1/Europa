/**
 * @fileoverview Voidline Frontend Utility Functions
 * Precision formatting for SSA metrics, timestamps, and sanitization.
 */

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
 * Formats ISO date string to UTC standard format.
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
