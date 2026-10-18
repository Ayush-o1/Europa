/**
 * @fileoverview Part 7A: Real Browser End-to-End Test Suite
 *
 * Exercises the complete Europa system:
 * Browser DOM <-> Frontend JS <-> Express REST API <-> Domain Services <-> PostgreSQL (europa_test)
 *
 * Scenarios covered:
 * Scenario A — Fresh installation & readiness
 * Scenario B — Snapshot ingestion, duplicate detection, malformed file rejection
 * Scenario C — Event investigation, prediction evolution tracking, assessments
 * Scenario D — Operator review workflow, justification rules, re-review, audit verification & tamper detection
 * Scenario E — Usability, viewport responsiveness, client routing, and security boundaries
 */
/* global document, window */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTestConfig, resetTestDatabase } from '../helpers/dbCleanup.js';
import { query, closePool } from '../../src/db/pool.js';

const testConfig = getTestConfig();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

const VALID_KEY = testConfig.operatorApiKey || 'test-operator-key';

test.describe('Part 7A: Real Browser End-to-End Workflows', () => {
  test.beforeAll(async () => {
    // Calibrate snapshot fixture modification times for deterministic cross-platform E2E execution:
    // Snapshot 1 (Baseline): 01:00:00 UTC
    // Snapshot 2 (Tightening update): 02:00:00 UTC
    // Snapshot 4 (Subsequent poll identical to baseline): 03:00:00 UTC
    const baseline = path.join(FIXTURES_DIR, 'synthetic_scenario_1_baseline.csv');
    const tightening = path.join(FIXTURES_DIR, 'synthetic_scenario_2_tightening.csv');
    const identical = path.join(FIXTURES_DIR, 'synthetic_scenario_4_identical.csv');

    const t1 = new Date('2026-10-18T01:00:00.000Z');
    const t2 = new Date('2026-10-18T02:00:00.000Z');
    const t3 = new Date('2026-10-18T03:00:00.000Z');

    fs.utimesSync(baseline, t1, t1);
    fs.utimesSync(tightening, t2, t2);
    fs.utimesSync(identical, t3, t3);
  });

  test.beforeEach(async () => {
    await resetTestDatabase();
  });

  test.afterAll(async () => {
    await resetTestDatabase();
    await closePool();
  });

  test('Scenario A: Fresh installation, home page load, real health status, and empty states', async ({
    page,
  }) => {
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // 1. Visit root page -> verify landing page loads
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Verify Title and Meta
    await expect(page).toHaveTitle(/Europa — Satellite Conjunction & Assessment Workbench/);

    // Verify Landing Page hero and branding
    await expect(page.locator('.hero-title')).toHaveText('Understand the encounters that matter.');
    await expect(page.locator('#btn-hero-open-app')).toBeVisible();

    // 2. Open workspace from landing page
    await page.click('#btn-hero-open-app');

    // 3. Health indicator reports actual server and database state in workbench
    const statusText = page.locator('#system-status-text');
    await expect(statusText).toHaveText('System Ready', { timeout: 10000 });
    const statusDot = page.locator('#system-status-dot');
    await expect(statusDot).toBeVisible();

    // 4. Overview view displays meaningful zero/empty state
    await expect(page.locator('h2.state-title')).toHaveText('No Conjunction Events Ingested');
    await expect(page.locator('#btn-nav-to-ingest')).toBeVisible();

    // 5. Navigate to Triage Queue tab and verify empty state
    await page.click('#tab-events');
    await expect(page.locator('#view-content-root')).toContainText(
      'No Matching Conjunction Events',
    );

    // 6. Navigate to Ingestion tab and verify empty batches state
    await page.click('#tab-ingestion');
    await expect(page.locator('#batches-table-wrapper')).toContainText(
      'No ingestion batches recorded yet',
    );

    // 7. Navigate to Audit Ledger tab and verify initial state
    await page.click('#tab-audit');
    await expect(page.locator('.verification-card')).toBeVisible();

    // Assert no unexpected browser console errors were thrown
    expect(consoleErrors).toEqual([]);
  });

  test('Scenario B: Snapshot ingestion, operator auth, provenance, duplicates, and malformed files', async ({
    page,
  }) => {
    await page.goto('/#ingestion');
    await page.waitForLoadState('domcontentloaded');

    // 1. Attempt upload without operator key -> should show required feedback
    const baselineFixture = path.join(FIXTURES_DIR, 'synthetic_scenario_1_baseline.csv');
    await page.setInputFiles('#csv-file-input', baselineFixture);
    await expect(page.locator('#file-name-display')).toContainText(
      'synthetic_scenario_1_baseline.csv',
    );

    // Ensure upload button is enabled
    const submitBtn = page.locator('#btn-upload-submit');
    await expect(submitBtn).toBeEnabled();

    // Try submit without key
    await submitBtn.click();
    await expect(page.locator('#toast-container')).toContainText('Operator API Key required');

    // 2. Set operator key via in-memory modal
    await page.click('#operator-auth-badge');
    await expect(page.locator('#modal-input-key')).toBeVisible();
    await page.fill('#modal-input-key', VALID_KEY);
    await page.fill('#modal-input-actor', 'flight-director-alpha');
    await page.click('button:has-text("Save Key in Memory")');

    // Verify auth badge updated
    await expect(page.locator('#operator-auth-badge')).toContainText(
      'Operator: flight-director-alpha',
    );

    // 3. Successful upload of baseline fixture
    await submitBtn.click();
    await expect(page.locator('#toast-container')).toContainText(
      'Snapshot processed successfully!',
      { timeout: 10000 },
    );

    // Verify Ingestion Outcome Banner
    const outcomePanel = page.locator('#ingestion-outcome-panel');
    await expect(outcomePanel).toBeVisible();
    await expect(outcomePanel).toContainText('Snapshot Ingestion Completed');
    await expect(outcomePanel).toContainText('Total Rows: 2');
    await expect(outcomePanel).toContainText('Valid Observations: 2');
    await expect(outcomePanel).toContainText('Events Created: 2');

    // Verify batch appears in provenance table
    const batchesTable = page.locator('#batches-table-wrapper');
    await expect(batchesTable).toContainText('COMPLETED');
    await expect(batchesTable).toContainText('synthetic_scenario_1_baseline.csv');

    // 4. Duplicate upload of identical snapshot
    await page.setInputFiles('#csv-file-input', baselineFixture);
    await submitBtn.click();

    // Verify duplicate recognition
    await expect(outcomePanel).toContainText('Identical Snapshot Detected (Duplicate Ignored)');
    await expect(outcomePanel).toContainText('DUPLICATE_IGNORED');

    // 5. Separate snapshot containing identical observations (confirms observations without duplicating events)
    // Note: Calibrated in beforeAll to 03:00:00 UTC (subsequent to baseline 01:00:00 UTC) so this snapshot is
    // processed as a subsequent observation poll rather than an identical duplicate re-upload.
    const identicalFixture = path.join(FIXTURES_DIR, 'synthetic_scenario_4_identical.csv');
    await page.setInputFiles('#csv-file-input', identicalFixture);
    await submitBtn.click();
    await expect(outcomePanel).toContainText('Snapshot Ingestion Completed');
    await expect(outcomePanel).toContainText('Confirmations: 2');
    await expect(outcomePanel).toContainText('Events Created: 0');

    // 6. Malformed file upload
    const malformedFixture = path.join(FIXTURES_DIR, 'synthetic_scenario_8_malformed.csv');
    await page.setInputFiles('#csv-file-input', malformedFixture);
    await submitBtn.click();

    // Outcome reports both valid and invalid counts
    await expect(outcomePanel).toContainText('Total Rows: 4');
    await expect(outcomePanel).toContainText('Valid Observations: 1');
    await expect(outcomePanel).toContainText('Validation Errors: 3');

    // 7. Navigate to resulting events using the action button
    const inspectQueueBtn = page.locator('#btn-view-queue-after-upload');
    await inspectQueueBtn.click();
    await expect(page.locator('h1')).toHaveText('Conjunction Event Triage Queue');
    await expect(page.locator('table.data-table tbody tr.clickable')).toHaveCount(2);
  });

  test('Scenario C: Event investigation, prediction evolution, assessments, and historical charts', async ({
    page,
  }) => {
    // Authenticate operator first in workspace
    await page.goto('/#overview');
    await page.click('#operator-auth-badge');
    await page.fill('#modal-input-key', VALID_KEY);
    await page.click('button:has-text("Save Key in Memory")');

    // Ingest baseline snapshot (Pair 90001 vs 90002 has 4.500 km range)
    await page.goto('/#ingestion');
    await page.setInputFiles(
      '#csv-file-input',
      path.join(FIXTURES_DIR, 'synthetic_scenario_1_baseline.csv'),
    );
    await page.click('#btn-upload-submit');
    await expect(page.locator('#toast-container')).toContainText('processed successfully');

    // Ingest tightening snapshot (Pair 90001 vs 90002 contracts to 0.280 km)
    await page.setInputFiles(
      '#csv-file-input',
      path.join(FIXTURES_DIR, 'synthetic_scenario_2_tightening.csv'),
    );
    await page.click('#btn-upload-submit');
    await expect(page.locator('#toast-container')).toContainText('processed successfully');

    // Navigate to Triage Queue
    await page.click('#tab-events');
    await expect(page.locator('table.data-table tbody tr.clickable')).toHaveCount(2);

    // Find the tightened event (SYNTHETIC-SAT-A vs SYNTHETIC-DEB-B, range 0.28 km)
    const criticalRow = page.locator('tr:has-text("SYNTHETIC-SAT-A")');
    await expect(criticalRow).toContainText('0.280 km');
    await expect(criticalRow).toContainText('HIGH');

    // Click Inspect to open Event Detail View
    await criticalRow.locator('button:has-text("Inspect →")').click();
    await page.waitForSelector('#event-details-content');

    // Verify Title & Encounter Banner
    await expect(page.locator('#details-event-title')).toContainText(
      'SYNTHETIC-SAT-A vs SYNTHETIC-DEB-B',
    );
    await expect(page.locator('.encounter-banner')).toContainText('NORAD 90001');
    await expect(page.locator('.encounter-banner')).toContainText('NORAD 90002');

    // Verify Prediction Evolution Chart SVG is rendered
    const chartSvg = page.locator('.chart-wrapper svg');
    await expect(chartSvg).toBeVisible();
    await expect(page.locator('.metrics-grid')).toContainText('0.280 km');

    // Verify Observation History Timeline
    const historyCards = page.locator('.timeline-item');
    await expect(historyCards).toHaveCount(2);
    await expect(historyCards.first()).toContainText('4.500 km');
    await expect(historyCards.nth(1)).toContainText('0.280 km');

    // Verify Assessment score and rule explanation
    const assessmentBanner = page.locator('.assessment-score-banner');
    await expect(assessmentBanner).toContainText('HIGH');
    await expect(page.locator('.score-num')).not.toHaveText('0');
    await expect(page.locator('#event-details-content')).toContainText('v1.0.0-heuristic');

    // Verify cryptographic audit trail for this event
    const eventAuditTable = page.locator('.card:has-text("Event Cryptographic Audit Trail")');
    await expect(eventAuditTable).toBeVisible();
    await expect(eventAuditTable).toContainText('EVENT_CREATED');

    // Verify Experimental Orbital Screening (SGP4) panel (Phase 8)
    const sgp4Card = page.locator('#card-sgp4-screening');
    await expect(sgp4Card).toBeVisible();
    await expect(sgp4Card).toContainText('Experimental Orbital Screening (SGP4)');
    await expect(sgp4Card).toContainText('Scientific Limitation Notice');

    // Click "Load Sample TLEs"
    await page.click('#btn-load-sample-tles');
    await expect(page.locator('#sgp4-primary-line1')).not.toHaveValue('');
    await expect(page.locator('#sgp4-secondary-line1')).not.toHaveValue('');

    // Submit SGP4 encounter estimation
    await page.click('#btn-compute-sgp4');
    await expect(page.locator('#toast-container')).toContainText(
      'SGP4 orbital encounter screening computed successfully',
    );
    await expect(page.locator('#sgp4-results-container')).toContainText('LATEST SCREENING RESULT');
    await expect(page.locator('#sgp4-results-container')).toContainText('SGP4 Miss Distance:');
    await expect(page.locator('#sgp4-results-container')).toContainText('Relative Velocity:');
  });

  test('Scenario D: Operator review workflow, justification rules, re-review, and controlled audit integrity violation', async ({
    page,
  }) => {
    // 1. Prepare data: Ingest baseline
    await page.goto('/#ingestion');
    await page.click('#operator-auth-badge');
    await page.fill('#modal-input-key', VALID_KEY);
    await page.fill('#modal-input-actor', 'analyst-orbital-1');
    await page.click('button:has-text("Save Key in Memory")');

    await page.setInputFiles(
      '#csv-file-input',
      path.join(FIXTURES_DIR, 'synthetic_scenario_1_baseline.csv'),
    );
    await page.click('#btn-upload-submit');
    await expect(page.locator('#toast-container')).toContainText('processed successfully');

    // Open target event details (SYNTHETIC-SAT-A vs SYNTHETIC-DEB-B)
    await page.click('#tab-events');
    const targetRow = page.locator('tr:has-text("SYNTHETIC-SAT-A")');
    await targetRow.locator('button:has-text("Inspect →")').click();
    await page.waitForSelector('#review-action-form');

    // 2. Test client-side justification length validation (< 10 chars)
    const justInput = page.locator('#review-justification');
    await justInput.fill('Short');
    const submitReviewBtn = page.locator('#btn-submit-review');
    await submitReviewBtn.click();
    await expect(page.locator('#review-form-feedback')).toContainText(
      'A meaningful justification of at least 10 characters is required.',
    );

    // 3. Clear auth and verify unauthorized rejection
    await page.click('#operator-auth-badge');
    await page.click('button:has-text("Clear Key")');
    await justInput.fill('Valid technical justification stating conjunction monitoring active.');
    await submitReviewBtn.click();
    await expect(page.locator('#review-form-feedback')).toContainText('Operator API key required');

    // 4. Restore valid auth and submit review
    await page.click('#operator-auth-badge');
    await page.fill('#modal-input-key', VALID_KEY);
    await page.fill('#modal-input-actor', 'senior-astrodynamicist');
    await page.click('button:has-text("Save Key in Memory")');

    await page.selectOption('#review-action-select', 'ESCALATE');
    await justInput.fill('Conjunction geometry requires immediate escalation to spacecraft owner.');
    await submitReviewBtn.click();

    // Verify toast and updated status
    await expect(page.locator('#toast-container')).toContainText('recorded successfully!');
    await expect(page.locator('.encounter-banner')).toContainText('ESCALATED');

    // Verify review appears in historical stream
    const reviewsStream = page.locator('#reviews-history-stream');
    await expect(reviewsStream).toContainText('ESCALATE');
    await expect(reviewsStream).toContainText(
      'Conjunction geometry requires immediate escalation to spacecraft owner.',
    );
    await expect(reviewsStream).toContainText('senior-astrodynamicist');

    // 5. Test re-review triggering upon material change: Ingest tightening snapshot
    await page.goto('/#ingestion');
    await page.setInputFiles(
      '#csv-file-input',
      path.join(FIXTURES_DIR, 'synthetic_scenario_2_tightening.csv'),
    );
    await page.click('#btn-upload-submit');
    await expect(page.locator('#toast-container')).toContainText('processed successfully');

    // Re-open event details
    await page.click('#tab-events');
    const updatedRow = page.locator('tr:has-text("SYNTHETIC-SAT-A")');
    await updatedRow.locator('button:has-text("Inspect →")').click();
    await page.waitForSelector('#event-details-content');

    // Verify re-review banner appears and previous review decision is preserved
    await expect(page.locator('.card:has-text("FRESH OPERATOR REVIEW REQUIRED")')).toBeVisible();
    await expect(page.locator('#reviews-history-stream')).toContainText('ESCALATE');

    // 6. Test Audit Ledger verification on intact chain
    await page.goto('/#audit');
    await page.waitForSelector('#btn-run-verification');
    await page.click('#btn-run-verification');
    await expect(page.locator('.verification-card.verified')).toBeVisible();
    await expect(page.locator('.verification-card')).toContainText('CHAIN INTACT');

    // 7. Deliberate controlled integrity violation:
    // Disable trigger, tamper with one entry payload, re-enable trigger
    await query('ALTER TABLE audit_ledger DISABLE TRIGGER trg_audit_ledger_no_mutation;');
    await query(
      `UPDATE audit_ledger SET payload = '{"tampered": "unauthorized edit"}'::jsonb WHERE sequence_number = 2;`,
    );
    await query('ALTER TABLE audit_ledger ENABLE TRIGGER trg_audit_ledger_no_mutation;');

    // Run verification again in browser
    await page.click('#btn-run-verification');

    // Verify UI accurately detects and reports the integrity violation
    await expect(page.locator('.verification-card.failed')).toBeVisible();
    await expect(page.locator('.verification-card')).toContainText('TAMPER DETECTED');
    await expect(page.locator('.verification-card')).toContainText('Failed at sequence: #2');

    // Clean up: Reset test database so audit ledger is not left corrupted
    await resetTestDatabase();
  });

  test('Scenario E: Browser usability, viewport responsiveness, client routing, and security boundaries', async ({
    page,
  }) => {
    // 1. Viewport responsiveness: Desktop (1280x720)
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/#overview');
    await expect(page.locator('.app-header')).toBeVisible();
    await expect(page.locator('.main-nav')).toBeVisible();

    // 2. Mobile Viewport (375x667 iPhone SE)
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.locator('.app-header')).toBeVisible();
    // Navigation bar should remain scrollable / accessible
    await expect(page.locator('#tab-events')).toBeVisible();
    await page.click('#tab-events');
    await expect(page.locator('#view-content-root')).toBeVisible();

    // Reset to desktop viewport
    await page.setViewportSize({ width: 1280, height: 720 });

    // 3. Client-side routing and page refresh behavior
    await page.goto('/#ingestion');
    await expect(page.locator('h1')).toHaveText('SOCRATES Snapshot Ingestion');
    await page.reload();
    await expect(page.locator('h1')).toHaveText('SOCRATES Snapshot Ingestion');

    await page.goto('/#audit');
    await expect(page.locator('h1')).toHaveText('Cryptographic Audit Ledger');
    await page.reload();
    await expect(page.locator('h1')).toHaveText('Cryptographic Audit Ledger');

    // 4. Standalone Orbital Screening tab navigation & computation
    await page.click('#tab-propagation');
    await expect(page.locator('h1')).toHaveText('Orbital Propagation Screening');
    await expect(page.locator('.sgp4-banner')).toContainText(
      'Scientific Scope and Model Assumptions',
    );

    // Run preset propagation calculation
    await page.click('#btn-quick-fill-iss');
    await page.click('#btn-run-propagation');
    await expect(page.locator('#results-display-area')).toContainText('Estimated Miss Distance', {
      timeout: 10000,
    });
    await expect(page.locator('#results-display-area')).toContainText('Relative Speed');

    // 5. Mobile horizontal overflow check
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/#overview');
    const isOverflown = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(isOverflown).toBe(false);

    // Reset to desktop
    await page.setViewportSize({ width: 1280, height: 720 });

    // 6. Security boundaries: Operator key is transient in memory only
    await page.click('#operator-auth-badge');
    await page.fill('#modal-input-key', 'secret-transient-key-xyz');
    await page.click('button:has-text("Save Key in Memory")');

    // Check localStorage & sessionStorage to verify key is NOT persisted
    const localStorageData = await page.evaluate(() => JSON.stringify(globalThis.localStorage));
    const sessionStorageData = await page.evaluate(() => JSON.stringify(globalThis.sessionStorage));
    expect(localStorageData).not.toContain('secret-transient-key-xyz');
    expect(sessionStorageData).not.toContain('secret-transient-key-xyz');

    // Check page URL does not leak the key
    expect(page.url()).not.toContain('secret-transient-key-xyz');

    // On page reload, the transient key is safely cleared from memory
    await page.reload();
    await expect(page.locator('#operator-auth-badge')).toContainText('Operator Auth: Set Key');
  });

  test('Scenario F: Landing page brand identity, responsive drawer, interactive showcase, and scientific boundaries', async ({
    page,
  }) => {
    // 1. Visit landing page root
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Check brand wordmark, hero title and deck
    await expect(page.locator('.landing-nav-bar .landing-brand-name')).toHaveText('Europa');
    await expect(page.locator('.hero-title')).toHaveText('Understand the encounters that matter.');
    await expect(page.locator('.hero-lead')).toContainText(
      'An analytical workbench for satellite close-approach screening',
    );

    // Verify custom hero SVG orbital encounter illustration
    await expect(page.locator('.hero-svg-canvas')).toBeVisible();

    // 2. Interactive Product Showcase tabs switching
    const showcaseImg = page.locator('#showcase-active-img');
    await expect(showcaseImg).toHaveAttribute('src', /01_dashboard_overview\.png/);

    // Switch to Event Detail
    await page.click('.showcase-tab[data-shot="03"]');
    await expect(showcaseImg).toHaveAttribute('src', /03_event_detail_and_evolution\.png/);
    await expect(page.locator('#showcase-caption-text')).toContainText(
      'Event Detail & Prediction Evolution',
    );

    // Switch to SGP4 Screening
    await page.click('.showcase-tab[data-shot="04"]');
    await expect(showcaseImg).toHaveAttribute('src', /04_sgp4_orbital_screening\.png/);
    await expect(page.locator('#showcase-caption-text')).toContainText(
      'Experimental SGP4 Orbital Screening',
    );

    // Switch to Audit Ledger
    await page.click('.showcase-tab[data-shot="06"]');
    await expect(showcaseImg).toHaveAttribute('src', /06_audit_ledger_verification\.png/);
    await expect(page.locator('#showcase-caption-text')).toContainText(
      'Cryptographic Audit Ledger',
    );

    // 3. Verify Scientific Boundaries & Limits section
    await expect(page.locator('#limitations h3')).toContainText('Analytical Research Workbench');
    await expect(page.locator('#limitations')).toContainText(
      'MAX_PROB is an Upper-Bound Screening Metric',
    );
    await expect(page.locator('#limitations')).toContainText(
      'Experimental SGP4 Trajectory Propagation',
    );

    // 4. Verify Architecture section
    await expect(page.locator('#architecture h2')).toContainText(
      'Engineered for high-throughput operational safety.',
    );
    await expect(page.locator('#architecture')).toContainText('PostgreSQL 16');
    await expect(page.locator('#architecture')).toContainText('Node.js');
    await expect(page.locator('#architecture')).toContainText('Express');

    // 5. Mobile viewport navigation & drawer
    await page.setViewportSize({ width: 375, height: 667 });
    const mobileToggle = page.locator('#landing-menu-btn');
    await expect(mobileToggle).toBeVisible();

    // Drawer opens on click
    await mobileToggle.click();
    const mobileDrawer = page.locator('#landing-mobile-drawer');
    await expect(mobileDrawer).toHaveClass(/open/);

    // Drawer closes on escape
    await page.keyboard.press('Escape');
    await expect(mobileDrawer).not.toHaveClass(/open/);

    // 6. Navigation to Workspace
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.click('#btn-hero-open-app');
    await expect(page).toHaveURL(/#overview/);
    await expect(page.locator('#app-workbench-header')).toBeVisible();
    await expect(page.locator('#system-status-text')).toHaveText('System Ready', {
      timeout: 10000,
    });
  });
});
