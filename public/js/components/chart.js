/**
 * @fileoverview Precision SVG Observation Evolution Chart
 * Renders an accessible, zero-dependency SVG visualization of predicted miss distance
 * across chronological snapshot arrivals.
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

  const width = 640;
  const height = 180;
  const padding = { top: 20, right: 30, bottom: 35, left: 55 };

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
  const yMin = Math.max(0, minRange - (rangeSpan > 0 ? rangeSpan * 0.15 : minRange * 0.1));
  const yMax = maxRange + (rangeSpan > 0 ? rangeSpan * 0.15 : maxRange * 0.1 || 1);

  /**
   * Scales value to Y coordinate.
   * @param {number} val
   */
  const scaleY = val => {
    if (yMax === yMin) return padding.top + plotHeight / 2;
    return padding.top + plotHeight - ((val - yMin) / (yMax - yMin)) * plotHeight;
  };

  /**
   * Scales sequence index to X coordinate.
   * @param {number} idx
   */
  const scaleX = idx => {
    if (points.length === 1) return padding.left + plotWidth / 2;
    return padding.left + (idx / (points.length - 1)) * plotWidth;
  };

  // Build line path
  const lineCoords = points.map((p, idx) => `${scaleX(idx)},${scaleY(p.rangeKm)}`);
  const pathD = points.length > 1 ? `M ${lineCoords.join(' L ')}` : '';

  // Area under curve
  let areaD = '';
  if (points.length > 1) {
    const bottomY = padding.top + plotHeight;
    areaD = `M ${scaleX(0)},${bottomY} L ${lineCoords.join(' L ')} L ${scaleX(points.length - 1)},${bottomY} Z`;
  }

  // Horizontal gridlines (3 lines)
  const gridSteps = 3;
  let gridSvg = '';
  for (let i = 0; i <= gridSteps; i++) {
    const val = yMin + (i / gridSteps) * (yMax - yMin);
    const y = scaleY(val);
    gridSvg += `
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3,3" />
      <text x="${padding.left - 8}" y="${y + 3}" fill="var(--text-muted)" font-size="10" font-family="var(--font-mono)" text-anchor="end">${val.toFixed(2)}</text>
    `;
  }

  // Data points with tooltips
  let pointsSvg = '';
  points.forEach((p, idx) => {
    const cx = scaleX(idx);
    const cy = scaleY(p.rangeKm);
    const isLatest = idx === points.length - 1;
    const color = isLatest ? 'var(--color-critical)' : 'var(--color-brand)';

    pointsSvg += `
      <g class="chart-point-group" tabindex="0">
        <circle cx="${cx}" cy="${cy}" r="${isLatest ? 5 : 3.5}" fill="${color}" stroke="var(--bg-surface-1)" stroke-width="2" />
        <title>Seq #${p.seq} | Range: ${formatDistance(p.rangeKm)} | ${formatUtc(p.capturedAt)}</title>
        <text x="${cx}" y="${height - padding.bottom + 16}" fill="var(--text-muted)" font-size="10" font-family="var(--font-mono)" text-anchor="middle">#${p.seq}</text>
      </g>
    `;
  });

  return `
    <div class="chart-wrapper">
      <svg viewBox="0 0 ${width} ${height}" class="svg-chart" preserveAspectRatio="none" role="img" aria-label="Miss distance prediction trend chart">
        <defs>
          <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--color-brand)" stop-opacity="0.25" />
            <stop offset="100%" stop-color="var(--color-brand)" stop-opacity="0.0" />
          </linearGradient>
        </defs>

        <!-- Grid -->
        ${gridSvg}

        <!-- Axes -->
        <line x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${width - padding.right}" y2="${padding.top + plotHeight}" stroke="var(--border-medium)" />
        <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotHeight}" stroke="var(--border-medium)" />

        <!-- Area fill -->
        ${areaD ? `<path d="${areaD}" fill="url(#areaGradient)" />` : ''}

        <!-- Line -->
        ${pathD ? `<path d="${pathD}" fill="none" stroke="var(--color-brand)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />` : ''}

        <!-- Points -->
        ${pointsSvg}

        <!-- Y Axis Unit Label -->
        <text x="${padding.left - 8}" y="${padding.top - 6}" fill="var(--text-muted)" font-size="9" font-family="var(--font-mono)" text-anchor="end">km</text>
        <text x="${width - padding.right}" y="${height - 6}" fill="var(--text-muted)" font-size="9" font-family="var(--font-mono)" text-anchor="end">Snapshot sequence →</text>
      </svg>
    </div>
  `;
}
