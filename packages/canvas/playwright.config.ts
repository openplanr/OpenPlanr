import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'line',
  timeout: 120_000,
  outputDir: './test-results/browser',
  use: {
    baseURL: 'http://127.0.0.1:4178',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm exec -- vite build bench --outDir ../test-results/bench --emptyOutDir && npm exec -- vite preview bench --outDir ../test-results/bench --host 127.0.0.1 --port 4178 --strictPort',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
