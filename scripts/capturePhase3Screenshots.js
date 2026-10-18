/**
 * @fileoverview Automated Screenshot Pipeline for Europa Phase 3 Motion & Polish Evidence
 *
 * Launches Chromium via Playwright to capture genuine visual evidence of the
 * refined Europa landing page and operational workspace across desktop, mobile,
 * and reduced-motion states.
 *
 * Output Directory: artifacts/phase-3-polish/screenshots/
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
const SCREENSHOTS_DIR = path.resolve(__dirname, '../artifacts/phase-3-polish/screenshots');
const PORT = 3099;

export async function capturePhase3Screenshots() {
  console.log('[Phase 3 Capture] Preparing destination directory...');
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

  console.log('[Phase 3 Capture] Ensuring demo dataset is seeded...');
  await seedDemoData();

  const app = createApp();

  console.log(`[Phase 3 Capture] Starting local HTTP server on port ${PORT}...`);
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(PORT, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });

  const baseUrl = `http://127.0.0.1:${PORT}`;
  console.log(`[Phase 3 Capture] Server listening at ${baseUrl}. Launching Chromium...`);

  const isMac = process.platform === 'darwin';
  const isCI = !!process.env.CI;

  const browser = await chromium.launch({
    headless: true,
    ...(isMac && !isCI ? { channel: 'chrome' } : {}),
  });

  try {
    // 1. Desktop Browser Context (1440x900)
    console.log('[Phase 3 Capture] Initializing desktop viewport context (1440x900)...');
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const desktopPage = await desktopContext.newPage();

    // 01. Desktop Landing Hero
    console.log('[Phase 3 Capture] Capturing 01_desktop_landing_hero.png...');
    await desktopPage.goto(`${baseUrl}/`);
    await desktopPage.waitForSelector('.landing-hero');
    await desktopPage.waitForSelector('.hero-svg-canvas');
    await desktopPage.waitForTimeout(600);
    await desktopPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '01_desktop_landing_hero.png'),
      fullPage: false,
    });

    // 02. Desktop Landing Full
    console.log('[Phase 3 Capture] Capturing 02_desktop_landing_full.png...');
    await desktopPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '02_desktop_landing_full.png'),
      fullPage: true,
    });

    // 03. Desktop Dashboard Overview
    console.log('[Phase 3 Capture] Capturing 03_desktop_dashboard.png...');
    await desktopPage.goto(`${baseUrl}/#overview`);
    await desktopPage.waitForSelector('.metrics-grid');
    await desktopPage.waitForSelector('.metric-card');
    await desktopPage.waitForTimeout(700);
    await desktopPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '03_desktop_dashboard.png'),
      fullPage: false,
    });

    // 04. Desktop Event Investigation
    console.log('[Phase 3 Capture] Finding event for 04_desktop_event_investigation.png...');
    const eventRes = await query(
      `SELECT id FROM conjunction_events WHERE canonical_pair_key = '90001:90002' LIMIT 1;`,
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
      path: path.join(SCREENSHOTS_DIR, '04_desktop_event_investigation.png'),
      fullPage: false,
    });

    // 05. Desktop Triage Queue
    console.log('[Phase 3 Capture] Capturing 05_desktop_triage.png...');
    await desktopPage.goto(`${baseUrl}/#events`);
    await desktopPage.waitForSelector('#events-table-wrapper table tbody tr');
    await desktopPage.waitForTimeout(600);
    await desktopPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '05_desktop_triage.png'),
      fullPage: false,
    });

    // 06. Desktop SGP4 Workbench
    console.log('[Phase 3 Capture] Capturing 06_desktop_sgp4.png...');
    await desktopPage.goto(`${baseUrl}/#propagation`);
    await desktopPage.waitForSelector('#btn-quick-fill-iss');
    await desktopPage.click('#btn-quick-fill-iss');
    await desktopPage.waitForTimeout(300);
    await desktopPage.click('#btn-run-propagation');
    await desktopPage.waitForSelector('.ingestion-summary-grid', { timeout: 10000 });
    await desktopPage.waitForTimeout(600);
    await desktopPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '06_desktop_sgp4.png'),
      fullPage: false,
    });

    await desktopContext.close();

    // 2. Mobile Browser Context (375x812)
    console.log('[Phase 3 Capture] Initializing mobile viewport context (375x812)...');
    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 2,
    });
    const mobilePage = await mobileContext.newPage();

    // 07. Mobile Landing Hero
    console.log('[Phase 3 Capture] Capturing 07_mobile_landing_hero.png...');
    await mobilePage.goto(`${baseUrl}/`);
    await mobilePage.waitForSelector('.landing-hero');
    await mobilePage.waitForTimeout(500);
    await mobilePage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '07_mobile_landing_hero.png'),
      fullPage: false,
    });

    // 08. Mobile Workspace
    console.log('[Phase 3 Capture] Capturing 08_mobile_workspace.png...');
    await mobilePage.goto(`${baseUrl}/#overview`);
    await mobilePage.waitForSelector('.metrics-grid');
    await mobilePage.waitForTimeout(600);
    await mobilePage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '08_mobile_workspace.png'),
      fullPage: false,
    });

    await mobileContext.close();

    // 3. Reduced Motion Context (1440x900)
    console.log('[Phase 3 Capture] Initializing reduced-motion context (1440x900)...');
    const reducedMotionContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      reducedMotion: 'reduce',
    });
    const reducedMotionPage = await reducedMotionContext.newPage();

    // 09. Reduced-Motion Landing
    console.log('[Phase 3 Capture] Capturing 09_reduced_motion_landing.png...');
    await reducedMotionPage.goto(`${baseUrl}/`);
    await reducedMotionPage.waitForSelector('.landing-hero');
    await reducedMotionPage.waitForTimeout(500);
    await reducedMotionPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, '09_reduced_motion_landing.png'),
      fullPage: false,
    });

    await reducedMotionContext.close();

    console.log('[Phase 3 Capture] All 9 visual evidence screenshots captured successfully!');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    await closePool();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  capturePhase3Screenshots()
    .then(() => {
      console.log('[Phase 3 Capture] Screenshot pipeline completed successfully.');
      process.exit(0);
    })
    .catch(err => {
      console.error('[Phase 3 Capture] Fatal error:', err);
      process.exit(1);
    });
}
