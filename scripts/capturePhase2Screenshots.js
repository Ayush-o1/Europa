/**
 * @fileoverview Automated Screenshot Pipeline for Europa Phase 2 Redesign Evidence
 *
 * Launches Chromium via Playwright to capture genuine visual evidence of the
 * redesigned Europa operational workspace across desktop and mobile viewports.
 *
 * Output Directory: artifacts/phase-2-redesign/screenshots/
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
const SCREENSHOTS_DIR = path.resolve(__dirname, '../artifacts/phase-2-redesign/screenshots');
const PORT = 3098;

export async function capturePhase2Screenshots() {
  console.log('[Phase 2 Capture] Preparing destination directory...');
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

  console.log('[Phase 2 Capture] Ensuring demo dataset is seeded...');
  await seedDemoData();

  const app = createApp();

  console.log(`[Phase 2 Capture] Starting local HTTP server on port ${PORT}...`);
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(PORT, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });

  const baseUrl = `http://127.0.0.1:${PORT}`;
  console.log(`[Phase 2 Capture] Server listening at ${baseUrl}. Launching Chromium...`);

  const isMac = process.platform === 'darwin';
  const isCI = !!process.env.CI;

  const browser = await chromium.launch({
    headless: true,
    ...(isMac && !isCI ? { channel: 'chrome' } : {}),
  });

  try {
    // 1. Desktop Browser Context (1440x900)
    console.log('[Phase 2 Capture] Initializing desktop viewport context (1440x900)...');
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const desktopPage = await desktopContext.newPage();

    // 01. Dashboard Desktop
    console.log('[Phase 2 Capture] Capturing 01_dashboard_desktop.png...');
    await desktopPage.goto(`${baseUrl}/#overview`);
    await desktopPage.waitForSelector('.metrics-grid');
    await desktopPage.waitForSelector('.metric-card');
    await desktopPage.waitForSelector('.telemetry-strip');
    await desktopPage.waitForTimeout(600);
    await desktopPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '01_dashboard_desktop.png'),
      fullPage: false,
    });

    // 02. Triage Queue Desktop
    console.log('[Phase 2 Capture] Capturing 02_triage_queue_desktop.png...');
    await desktopPage.goto(`${baseUrl}/#events`);
    await desktopPage.waitForSelector('#events-table-wrapper table tbody tr');
    await desktopPage.waitForTimeout(600);
    await desktopPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '02_triage_queue_desktop.png'),
      fullPage: false,
    });

    // 03. Event Investigation Desktop
    console.log('[Phase 2 Capture] Finding event for 03_event_investigation_desktop.png...');
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
    await desktopPage.waitForSelector('.chart-svg');
    await desktopPage.waitForSelector('.timeline-content');
    await desktopPage.waitForTimeout(700);
    await desktopPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '03_event_investigation_desktop.png'),
      fullPage: false,
    });

    // 04. SGP4 Workbench Desktop
    console.log('[Phase 2 Capture] Capturing 04_sgp4_workbench_desktop.png...');
    await desktopPage.goto(`${baseUrl}/#propagation`);
    await desktopPage.waitForSelector('#btn-quick-fill-iss');
    await desktopPage.click('#btn-quick-fill-iss');
    await desktopPage.waitForTimeout(300);
    await desktopPage.click('#btn-run-propagation');
    await desktopPage.waitForSelector('.ingestion-summary-grid', { timeout: 10000 });
    await desktopPage.waitForTimeout(600);
    await desktopPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '04_sgp4_workbench_desktop.png'),
      fullPage: false,
    });

    // 05. Ingestion Desktop
    console.log('[Phase 2 Capture] Capturing 05_ingestion_desktop.png...');
    await desktopPage.goto(`${baseUrl}/#ingestion`);
    await desktopPage.waitForSelector('#csv-dropzone');
    await desktopPage.waitForSelector('#batches-table-wrapper table tbody tr');
    await desktopPage.waitForTimeout(500);
    await desktopPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '05_ingestion_desktop.png'),
      fullPage: false,
    });

    // 06. Audit Verification Desktop
    console.log('[Phase 2 Capture] Capturing 06_audit_verification_desktop.png...');
    await desktopPage.goto(`${baseUrl}/#audit`);
    await desktopPage.waitForSelector('#btn-run-verification');
    await desktopPage.click('#btn-run-verification');
    await desktopPage.waitForSelector('.verification-card.verified', { timeout: 10000 });
    await desktopPage.waitForSelector('#verification-diagnostic-panel');
    await desktopPage.waitForTimeout(600);
    await desktopPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '06_audit_verification_desktop.png'),
      fullPage: false,
    });

    await desktopContext.close();

    // 2. Mobile Browser Context (375x812)
    console.log('[Phase 2 Capture] Initializing mobile viewport context (375x812)...');
    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 2,
    });
    const mobilePage = await mobileContext.newPage();

    // 07. Dashboard Mobile
    console.log('[Phase 2 Capture] Capturing 07_dashboard_mobile.png...');
    await mobilePage.goto(`${baseUrl}/#overview`);
    await mobilePage.waitForSelector('.metrics-grid');
    await mobilePage.waitForSelector('.metric-card');
    await mobilePage.waitForTimeout(600);
    await mobilePage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '07_dashboard_mobile.png'),
      fullPage: false,
    });

    // 08. Event Investigation Mobile
    console.log('[Phase 2 Capture] Capturing 08_event_investigation_mobile.png...');
    await mobilePage.goto(`${baseUrl}/#details/${criticalEventId}`);
    await mobilePage.waitForSelector('.chart-svg');
    await mobilePage.waitForSelector('.timeline-content');
    await mobilePage.waitForTimeout(700);
    await mobilePage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '08_event_investigation_mobile.png'),
      fullPage: false,
    });

    await mobileContext.close();
    console.log('[Phase 2 Capture] All screenshots captured successfully.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    await closePool();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  capturePhase2Screenshots().catch(err => {
    console.error('[Phase 2 Capture Error]:', err);
    process.exit(1);
  });
}
