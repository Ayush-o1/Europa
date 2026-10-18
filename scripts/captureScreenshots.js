/**
 * @fileoverview Automated Screenshot Capture Pipeline for Europa (Phase 4 Evidence)
 *
 * Launches a headless Chromium browser instance via Playwright to capture genuine,
 * high-resolution visual evidence of all core Europa workflows using populated
 * deterministic demo data.
 *
 * Output Directory: artifacts/phase-4/screenshots/
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createApp } from '../src/app.js';
import { query, closePool } from '../src/db/pool.js';
import { seedDemoData } from './seedDemoData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.resolve(__dirname, '../artifacts/phase-4/screenshots');
const PORT = 3097;

export async function captureScreenshots() {
  console.log('[Europa Capture] Preparing screenshot destination directory...');
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

  console.log('[Europa Capture] Ensuring demo dataset is seeded...');
  await seedDemoData();

  const app = createApp();

  console.log(`[Europa Capture] Starting local HTTP server on port ${PORT}...`);
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(PORT, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });

  const baseUrl = `http://127.0.0.1:${PORT}`;
  console.log(`[Europa Capture] Server listening at ${baseUrl}. Launching Chromium...`);

  const isMac = process.platform === 'darwin';
  const isCI = !!process.env.CI;

  const browser = await chromium.launch({
    headless: true,
    ...(isMac && !isCI ? { channel: 'chrome' } : {}),
  });

  try {
    // 1. Desktop Browser Context (1440x900)
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2, // HiDPI / Retina quality
    });
    const desktopPage = await desktopContext.newPage();

    // 01. Dashboard Overview
    console.log('[Europa Capture] Capturing 01_dashboard_overview.png...');
    await desktopPage.goto(`${baseUrl}/#overview`);
    await desktopPage.waitForSelector('.metrics-grid');
    await desktopPage.waitForSelector('.metric-card');
    await desktopPage.waitForSelector('.telemetry-strip');
    await desktopPage.waitForTimeout(600);
    await desktopPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '01_dashboard_overview.png'),
      fullPage: false,
    });

    // 02. Triage Queue (with filtering / sorting)
    console.log('[Europa Capture] Capturing 02_triage_queue.png...');
    await desktopPage.goto(`${baseUrl}/#events`);
    await desktopPage.waitForSelector('#events-table-wrapper table tbody tr');
    await desktopPage.selectOption('#filter-urgency', 'HIGH');
    await desktopPage.selectOption('#filter-sort', 'latest_range_km:ASC');
    await desktopPage.click('#btn-apply-filters');
    await desktopPage.waitForSelector('#events-table-wrapper table tbody tr');
    await desktopPage.waitForTimeout(500);
    await desktopPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '02_triage_queue.png'),
      fullPage: false,
    });

    // 03. Event Detail & Evolution
    console.log('[Europa Capture] Finding critical event for 03_event_detail_and_evolution.png...');
    const eventRes = await query(
      `SELECT id, canonical_pair_key, latest_range_km
       FROM conjunction_events
       WHERE canonical_pair_key = '90001:90002'
       LIMIT 1;`,
    );
    const criticalEventId = eventRes.rows[0]?.id;

    if (!criticalEventId) {
      throw new Error('Critical event 90001:90002 not found in conjunction_events');
    }

    await desktopPage.goto(`${baseUrl}/#details/${criticalEventId}`);
    await desktopPage.waitForSelector('.chart-wrapper');
    await desktopPage.waitForSelector('.timeline-content');
    await desktopPage.waitForTimeout(700);
    await desktopPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '03_event_detail_and_evolution.png'),
      fullPage: true,
    });

    // 04. SGP4 Orbital Screening
    console.log('[Europa Capture] Capturing 04_sgp4_orbital_screening.png...');
    await desktopPage.goto(`${baseUrl}/#propagation`);
    await desktopPage.waitForSelector('#btn-quick-fill-iss');
    await desktopPage.click('#btn-quick-fill-iss');
    await desktopPage.waitForTimeout(300);
    await desktopPage.click('#btn-run-propagation');
    await desktopPage.waitForSelector('.ingestion-summary-grid', { timeout: 10000 });
    await desktopPage.waitForTimeout(600);
    await desktopPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '04_sgp4_orbital_screening.png'),
      fullPage: true,
    });

    // 05. Snapshot Ingestion & Provenance
    console.log('[Europa Capture] Capturing 05_ingestion_and_provenance.png...');
    await desktopPage.goto(`${baseUrl}/#ingestion`);
    await desktopPage.waitForSelector('#csv-dropzone');
    await desktopPage.waitForSelector('#batches-table-wrapper table tbody tr');
    await desktopPage.waitForTimeout(500);
    await desktopPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '05_ingestion_and_provenance.png'),
      fullPage: false,
    });

    // 06. Audit Ledger Verification
    console.log('[Europa Capture] Capturing 06_audit_ledger_verification.png...');
    await desktopPage.goto(`${baseUrl}/#audit`);
    await desktopPage.waitForSelector('#btn-run-verification');
    await desktopPage.click('#btn-run-verification');
    await desktopPage.waitForSelector('.verification-card.verified', { timeout: 10000 });
    await desktopPage.waitForSelector('#verification-diagnostic-panel');
    await desktopPage.waitForTimeout(600);
    await desktopPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '06_audit_ledger_verification.png'),
      fullPage: true,
    });

    await desktopContext.close();

    // 2. Mobile Browser Context (375x812 - iPhone 12 / 13)
    console.log('[Europa Capture] Initializing mobile viewport context (375x812)...');
    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const mobilePage = await mobileContext.newPage();

    // 07. Responsive Mobile Dashboard
    console.log('[Europa Capture] Capturing 07_mobile_dashboard.png...');
    await mobilePage.goto(`${baseUrl}/#overview`);
    await mobilePage.waitForSelector('.metrics-grid');
    await mobilePage.waitForTimeout(500);
    await mobilePage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '07_mobile_dashboard.png'),
      fullPage: false,
    });

    // 08. Responsive Mobile Event Detail
    console.log('[Europa Capture] Capturing 08_mobile_event_detail.png...');
    await mobilePage.goto(`${baseUrl}/#details/${criticalEventId}`);
    await mobilePage.waitForSelector('.chart-wrapper');
    await mobilePage.waitForTimeout(600);
    await mobilePage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '08_mobile_event_detail.png'),
      fullPage: true,
    });

    await mobileContext.close();

    console.log('[Europa Capture] All 8 genuine screenshots captured successfully.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    await closePool();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  captureScreenshots()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[Europa Capture] Error capturing screenshots:', err);
      process.exit(1);
    });
}
