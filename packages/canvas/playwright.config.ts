import { defineConfig } from '@playwright/test';

const gpuMode = process.env.CANVAS_GPU_MODE ?? 'software';
if (gpuMode !== 'software' && gpuMode !== 'metal')
  throw new TypeError(`CANVAS_GPU_MODE: invalid value ${gpuMode}`);
if (process.env.CI && gpuMode === 'metal')
  throw new TypeError('CANVAS_GPU_MODE: metal is unavailable on the software CI runner');

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
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/*.firefox.spec.ts',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: gpuMode === 'metal' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : [],
        },
      },
    },
    {
      name: 'firefox',
      testMatch: '**/*.firefox.spec.ts',
      use: {
        browserName: 'firefox',
        launchOptions: { executablePath: process.env.CANVAS_FIREFOX_NIGHTLY_PATH },
      },
    },
  ],
  webServer: {
    command: 'npm exec -- vite build bench --outDir ../test-results/bench --emptyOutDir && npm exec -- vite preview bench --outDir ../test-results/bench --host 127.0.0.1 --port 4178 --strictPort',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
