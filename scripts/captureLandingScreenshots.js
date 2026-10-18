import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEST_DIR = path.resolve(__dirname, '../artifacts/phase-1-redesign/screenshots');
const ARTIFACT_DEST =
  '/Users/ayush/.gemini/antigravity-ide/brain/eb9281c3-02c6-4683-81df-6eac12d82ca5';
const PORT = 3096;

async function run() {
  await fs.mkdir(DEST_DIR, { recursive: true });

  const app = createApp();
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(PORT, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });

  const baseUrl = `http://127.0.0.1:${PORT}`;
  console.log(`Server running at ${baseUrl}`);

  const isMac = process.platform === 'darwin';
  const isCI = !!process.env.CI;

  const browser = await chromium.launch({
    headless: true,
    ...(isMac && !isCI ? { channel: 'chrome' } : {}),
  });

  try {
    // 1. Desktop 1440x900 Viewport
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const desktopPage = await desktopContext.newPage();
    await desktopPage.goto(`${baseUrl}/`);
    await desktopPage.waitForSelector('.hero-title');
    await desktopPage.waitForSelector('.hero-svg-canvas');
    await desktopPage.waitForTimeout(600);

    // Hero viewport
    const desktopHeroPath = path.join(DEST_DIR, '01_desktop_hero_viewport.png');
    await desktopPage.screenshot({ path: desktopHeroPath, fullPage: false });
    await fs.copyFile(desktopHeroPath, path.join(ARTIFACT_DEST, 'desktop_hero_viewport.png'));
    console.log(`Captured ${desktopHeroPath}`);

    // Full page desktop
    const desktopFullPath = path.join(DEST_DIR, '02_desktop_landing_full.png');
    await desktopPage.screenshot({ path: desktopFullPath, fullPage: true });
    await fs.copyFile(desktopFullPath, path.join(ARTIFACT_DEST, 'desktop_landing_full.png'));
    console.log(`Captured ${desktopFullPath}`);

    // 2. Mobile 375x812 (iPhone X/12/13 mini size)
    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(`${baseUrl}/`);
    await mobilePage.waitForSelector('.hero-title');
    await mobilePage.waitForTimeout(600);

    const mobileHeroPath = path.join(DEST_DIR, '03_mobile_hero_viewport.png');
    await mobilePage.screenshot({ path: mobileHeroPath, fullPage: false });
    await fs.copyFile(mobileHeroPath, path.join(ARTIFACT_DEST, 'mobile_hero_viewport.png'));
    console.log(`Captured ${mobileHeroPath}`);

    const mobileFullPath = path.join(DEST_DIR, '04_mobile_landing_full.png');
    await mobilePage.screenshot({ path: mobileFullPath, fullPage: true });
    await fs.copyFile(mobileFullPath, path.join(ARTIFACT_DEST, 'mobile_landing_full.png'));
    console.log(`Captured ${mobileFullPath}`);

    // Open mobile menu drawer
    await mobilePage.click('#landing-menu-btn');
    await mobilePage.waitForTimeout(300);
    const mobileDrawerPath = path.join(DEST_DIR, '05_mobile_drawer_open.png');
    await mobilePage.screenshot({ path: mobileDrawerPath, fullPage: false });
    await fs.copyFile(mobileDrawerPath, path.join(ARTIFACT_DEST, 'mobile_drawer_open.png'));
    console.log(`Captured ${mobileDrawerPath}`);
  } finally {
    await browser.close();
    server.close();
    await closePool();
  }
}

run().catch(err => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
