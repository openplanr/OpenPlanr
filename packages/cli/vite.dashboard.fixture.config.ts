import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { dashboardFixtureServerPlugin } from './tests/e2e/fixtures/dashboard-fixture-server.mjs';
import { packedPipelineVitePlugin } from './scripts/packed-pipeline-vite.mjs';

const repositoryRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(repositoryRoot, '..', '..');
const fixtureRoot = resolve(repositoryRoot, 'tests/e2e/fixtures');
const rawFixturePort = process.env.OPENPLANR_DASHBOARD_FIXTURE_PORT ?? '4173';

if (!/^[1-9]\d{0,4}$/u.test(rawFixturePort)) {
  throw new TypeError('OPENPLANR_DASHBOARD_FIXTURE_PORT must be a TCP port number.');
}

const fixturePort = Number.parseInt(rawFixturePort, 10);
if (fixturePort > 65_535) {
  throw new RangeError('OPENPLANR_DASHBOARD_FIXTURE_PORT must be a valid TCP port.');
}

export default defineConfig({
  root: fixtureRoot,
  cacheDir: resolve(tmpdir(), 'openplanr-dashboard-fixture-vite'),
  publicDir: false,
  plugins: [packedPipelineVitePlugin(), dashboardFixtureServerPlugin(), react(), tailwindcss()].filter(
    Boolean,
  ),
  resolve: {
    alias: {
      '@dashboard': resolve(workspaceRoot, 'apps/dashboard/src'),
    },
  },
  define: {
    __OPENPLANR_DASHBOARD_BUILD_ID__: JSON.stringify('dashboard-browser-fixture'),
  },
  server: {
    host: '127.0.0.1',
    port: fixturePort,
    strictPort: true,
    fs: {
      allow: [workspaceRoot],
    },
  },
});
