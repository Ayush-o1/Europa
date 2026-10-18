/**
 * @fileoverview Precision SVG Observation Evolution & SGP4 Encounter Charts
 * Renders accessible, zero-dependency SVG visualizations of predicted miss distance
 * across chronological snapshot arrivals and SGP4 propagation time-windows.
 */

import { formatDistance, formatUtc } from '../utils.js';

/**
 * Generates an SVG chart visualizing predicted miss distance across observation history.
 * @param {Array<object>} observations - Chronological observation array
 * @returns {string} SVG HTML string
 */
export function renderEvolutionChart(observations) {
  if (!observations || observations.length === 0) {
    return `<div class="state-box" style="padding: var(--space-4);">
      <span class="state-desc">No observation history available to chart.</span>
    </div>`;
  }

  const width = 680;
  const height = 220;
  const padding = { top: 25, right: 35, bottom: 42, left: 60 };

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // Extract valid range values
  const points = observations.map((obs, idx) => ({
    seq: obs.chronological_sequence || idx + 1,
    capturedAt: obs.captured_at,
    rangeKm: parseFloat(obs.tca_range_km),
    speedKms: parseFloat(obs.relative_speed_kms),
    isConfirmation: obs.is_unchanged_confirmation,
  }));

  const ranges = points.map(p => p.rangeKm);
  const minRange = Math.min(...ranges);
  const maxRange = Math.max(...ranges);

  // Buffer range bounds for aesthetic spacing
  const rangeSpan = maxRange - minRange;
  const yMin = Math.max(0, minRange - (rangeSpan > 0 ? rangeSpan * 0.2 : minRange * 0.15));
  const yMax = maxRange + (rangeSpan > 0 ? rangeSpan * 0.2 : maxRange * 0.15 || 1);

  const scaleY = val => {
    if (yMax === yMin) return padding.top + plotHeight / 2;
    return padding.top + plotHeight - ((val - yMin) / (yMax - yMin)) * plotHeight;
  };

  const scaleX = idx => {
    if (points.length === 1) return padding.left + plotWidth / 2;
    return padding.left + (idx / (points.length - 1)) * plotWidth;
  };

  // Line coordinates
  const lineCoords = points.map((p, idx) => `${scaleX(idx)},${scaleY(p.rangeKm)}`);
  const pathD = points.length > 1 ? `M ${lineCoords.join(' L ')}` : '';

  // Area under curve
  let areaD = '';
  if (points.length > 1) {
    const bottomY = padding.top + plotHeight;
    areaD = `M ${scaleX(0)},${bottomY} L ${lineCoords.join(' L ')} L ${scaleX(points.length - 1)},${bottomY} Z`;
  }

  // 1.0 km screening threshold line (if within yMin..yMax or close)
  let thresholdLineSvg = '';
  if (1.0 >= yMin && 1.0 <= yMax) {
    const y1km = scaleY(1.0);
    thresholdLineSvg = `
      <line x1="${padding.left}" y1="${y1km}" x2="${width - padding.right}" y2="${y1km}" stroke="rgba(244,63,94,0.4)" stroke-width="1.5" stroke-dasharray="4,4" />
      <text x="${width - padding.right}" y="${y1km - 5}" fill="var(--color-critical)" font-size="9" font-family="var(--font-mono)" text-anchor="end">1.0 km Threshold</text>
    `;
  }

  // Horizontal gridlines (4 lines)
  const gridSteps = 4;
  let gridSvg = '';
  for (let i = 0; i <= gridSteps; i++) {
    const val = yMin + (i / gridSteps) * (yMax - yMin);
    const y = scaleY(val);
    gridSvg += `
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3,3" />
      <text x="${padding.left - 8}" y="${y + 3}" fill="var(--text-muted)" font-size="10" font-family="var(--font-mono)" text-anchor="end">${val.toFixed(2)}</text>
    `;
  }

  // Data points
  let pointsSvg = '';
  points.forEach((p, idx) => {
    const cx = scaleX(idx);
    const cy = scaleY(p.rangeKm);
    const isLatest = idx === points.length - 1;
    const isTightest = p.rangeKm === minRange;
    const color = isLatest
      ? p.rangeKm < 1.0
        ? 'var(--color-critical)'
        : p.rangeKm < 5.0
          ? 'var(--color-high)'
          : 'var(--color-brand)'
      : isTightest
        ? 'var(--color-high)'
        : 'var(--color-brand)';

    pointsSvg += `
      <g class="chart-point-group" tabindex="0">
        <circle cx="${cx}" cy="${cy}" r="${isLatest ? 5.5 : 4}" fill="${color}" stroke="var(--bg-surface-0)" stroke-width="2" />
        <title>Seq #${p.seq} | Range: ${formatDistance(p.rangeKm)} | ${formatUtc(p.capturedAt)}</title>
        <text x="${cx}" y="${height - padding.bottom + 18}" fill="var(--text-muted)" font-size="10" font-family="var(--font-mono)" text-anchor="middle">#${p.seq}</text>
        <text x="${cx}" y="${cy - 9}" fill="var(--text-secondary)" font-size="9" font-family="var(--font-mono)" text-anchor="middle">${p.rangeKm.toFixed(2)}</text>
      </g>
    `;
  });

  return `
    <div class="chart-container">
      <svg viewBox="0 0 ${width} ${height}" class="chart-svg" preserveAspectRatio="none" role="img" aria-label="Miss distance prediction trend chart">
        <defs>
          <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--color-brand)" stop-opacity="0.25" />
            <stop offset="100%" stop-color="var(--color-brand)" stop-opacity="0.0" />
          </linearGradient>
        </defs>

        <!-- Grid -->
        ${gridSvg}

        <!-- 1.0 km Threshold Line -->
        ${thresholdLineSvg}

        <!-- Axes -->
        <line x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${width - padding.right}" y2="${padding.top + plotHeight}" stroke="var(--border-medium)" />
        <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotHeight}" stroke="var(--border-medium)" />

        <!-- Area fill -->
        ${areaD ? `<path d="${areaD}" fill="url(#areaGradient)" />` : ''}

        <!-- Trajectory Line -->
        ${pathD ? `<path d="${pathD}" fill="none" stroke="var(--color-brand-light)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />` : ''}

        <!-- Points -->
        ${pointsSvg}

        <!-- Y Axis Unit Label -->
        <text x="${padding.left - 8}" y="${padding.top - 8}" fill="var(--text-muted)" font-size="10" font-family="var(--font-mono)" text-anchor="end">km</text>
        <text x="${width - padding.right}" y="${height - 8}" fill="var(--text-muted)" font-size="10" font-family="var(--font-mono)" text-anchor="end">Observation sequence →</text>
      </svg>
    </div>
  `;
}

/**
 * Generates an SVG chart visualizing encounter range profile over SGP4 propagation window.
 * @param {object} screeningResult - SGP4 screening result with estimatedTca and miss distance
 * @returns {string} SVG HTML string
 */
export function renderEncounterProfileChart(screeningResult) {
  if (!screeningResult) return '';

  const width = 640;
  const height = 160;
  const padding = { top: 20, right: 30, bottom: 35, left: 55 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // Generate synthetic parabolic encounter profile around TCA for visual comprehension
  const missDist = Number(screeningResult.estimatedMissDistanceKm) || 5.0;
  const relSpeed = Number(screeningResult.estimatedRelativeSpeedKmS) || 10.0;
  const steps = 21;
  const halfWindowSec = (screeningResult.searchWindowMinutes || 10) * 60;

  const points = [];
  for (let i = 0; i < steps; i++) {
    const tSec = -halfWindowSec + (i / (steps - 1)) * (2 * halfWindowSec);
    // Hyperbolic encounter distance: r(t) = sqrt(b^2 + (v*t)^2)
    const dist = Math.sqrt(Math.pow(missDist, 2) + Math.pow(relSpeed * tSec, 2));
    points.push({ tSec, dist });
  }

  const maxDist = points[0].dist;
  const scaleY = d =>
    padding.top + plotHeight - ((d - missDist) / (maxDist - missDist || 1)) * plotHeight;
  const scaleX = (idx, len) => padding.left + (idx / (len - 1)) * plotWidth;

  const lineCoords = points.map((p, idx) => `${scaleX(idx, points.length)},${scaleY(p.dist)}`);
  const pathD = `M ${lineCoords.join(' L ')}`;
  const tcaX = scaleX(Math.floor(steps / 2), points.length);
  const tcaY = scaleY(missDist);

  return `
    <div class="chart-container" style="margin-top: var(--space-3);">
      <svg viewBox="0 0 ${width} ${height}" class="chart-svg" style="height: 150px;" preserveAspectRatio="none">
        <line x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${width - padding.right}" y2="${padding.top + plotHeight}" stroke="var(--border-subtle)" />
        <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotHeight}" stroke="var(--border-subtle)" />

        <!-- Center TCA marker line -->
        <line x1="${tcaX}" y1="${padding.top}" x2="${tcaX}" y2="${padding.top + plotHeight}" stroke="rgba(99,102,241,0.3)" stroke-dasharray="3,3" />

        <path d="${pathD}" fill="none" stroke="var(--color-cyan)" stroke-width="2" />

        <!-- TCA Closest point marker -->
        <circle cx="${tcaX}" cy="${tcaY}" r="5" fill="var(--color-critical)" stroke="var(--bg-surface-0)" stroke-width="2" />

        <text x="${tcaX}" y="${tcaY - 8}" fill="var(--color-critical)" font-size="10" font-family="var(--font-mono)" text-anchor="middle">TCA Min Range: ${missDist.toFixed(3)} km</text>
        <text x="${padding.left}" y="${height - 10}" fill="var(--text-muted)" font-size="9" font-family="var(--font-mono)">-${screeningResult.searchWindowMinutes || 10}m</text>
        <text x="${tcaX}" y="${height - 10}" fill="var(--text-secondary)" font-size="9" font-family="var(--font-mono)" text-anchor="middle">Estimated TCA</text>
        <text x="${width - padding.right}" y="${height - 10}" fill="var(--text-muted)" font-size="9" font-family="var(--font-mono)" text-anchor="end">+${screeningResult.searchWindowMinutes || 10}m</text>
      </svg>
    </div>
  `;
}
