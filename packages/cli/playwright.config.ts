import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const DEFAULT_DASHBOARD_FIXTURE_PORT = 4173;

function dashboardFixturePort(): number {
  const raw = process.env.OPENPLANR_DASHBOARD_FIXTURE_PORT ?? String(DEFAULT_DASHBOARD_FIXTURE_PORT);
  if (!/^[1-9]\d{0,4}$/u.test(raw)) {
    throw new TypeError('OPENPLANR_DASHBOARD_FIXTURE_PORT must be a TCP port number.');
  }
  const port = Number.parseInt(raw, 10);
  if (port > 65_535) {
    throw new RangeError('OPENPLANR_DASHBOARD_FIXTURE_PORT must be a valid TCP port.');
  }
  return port;
}

const fixtureOrigin = `http://127.0.0.1:${dashboardFixturePort()}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'dashboard-visual-regression.test.ts',
  projects: [{ name: 'chromium' }],
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}',
  outputDir: process.env.CI
    ? 'test-results/dashboard-browser'
    : resolve(tmpdir(), 'openplanr-dashboard-browser-results'),
  use: {
    ...devices['Desktop Chrome'],
    baseURL: fixtureOrigin,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.01,
      scale: 'css',
      threshold: 0.2,
    },
  },
  webServer: {
    command: 'npm run test:browser:fixture',
    url: fixtureOrigin,
    // Visual evidence must come from the fixture started for this run. Reusing an arbitrary
    // developer server can make a changed dashboard look green against stale bytes.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
