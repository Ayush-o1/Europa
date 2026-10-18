process.env.NODE_ENV = process.env.NODE_ENV || 'test';
import { defineConfig } from '@playwright/test';

const isMac = process.platform === 'darwin';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './test/e2e',
  testMatch: '**/*.spec.js',
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  workers: 1, // Serial execution to preserve database isolation
  retries: isCI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:3099',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // On macOS local dev, use system Chrome if available, otherwise default Chromium
    ...(isMac && !isCI ? { channel: 'chrome' } : {}),
  },
  webServer: {
    command: 'node src/index.js',
    url: 'http://127.0.0.1:3099/api/v1/health',
    reuseExistingServer: !isCI,
    timeout: 15000,
    env: {
      PORT: '3099',
      NODE_ENV: 'test',
    },
  },
});
