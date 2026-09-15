// @vitest-environment node

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyDashboardAssets } from '../../scripts/verify-dashboard-assets.mjs';
import {
  installedOpenPlanrDashboardBuildId,
  installedOpenPlanrDashboardRoot,
} from '../../src/cli/commands/operate.js';
import { installPackedPipeline, type PackedPipelineInstall } from './helpers/installed-pipeline.js';

const dashboardRoot = installedOpenPlanrDashboardRoot();
let pipeline: PackedPipelineInstall;

beforeAll(async () => {
  pipeline = await installPackedPipeline();
}, 120_000);

afterAll(() => pipeline?.cleanup());

const LEGACY_PIPELINE_PATHS = [
  'lib/dashboard/app/index.html',
  'lib/dashboard/app/main.js',
  'lib/dashboard/app/shell.js',
  'lib/dashboard/app/ds.css',
  'lib/dashboard/app/views/operate.js',
  'lib/dashboard/app/views/operate/today.js',
  'lib/dashboard/app/styles/operate-product.css',
];

function httpGet(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{
    status: number;
    body: string;
    headers: Record<string, string | string[] | undefined>;
  }>((resolveRequest, rejectRequest) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolveRequest({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
        }),
      );
    });
    req.on('error', rejectRequest);
    req.end();
  });
}

describe('dashboard atomic cutover', () => {
  it('removes the legacy pipeline dashboard shell from the product boundary', () => {
    for (const relativePath of LEGACY_PIPELINE_PATHS) {
      expect(existsSync(join(pipeline.packageRoot, relativePath)), relativePath).toBe(false);
    }
  });

  it('serves only the unified React dashboard build through the installed static root', async () => {
    expect(existsSync(dashboardRoot), 'run npm run build before cutover tests').toBe(true);
    const report = verifyDashboardAssets(dashboardRoot);
    expect(report.ok, report.violations.join('; ')).toBe(true);
    expect(installedOpenPlanrDashboardBuildId()).toBe(report.buildId);

    const temporaryRoot = mkdtempSync(join(tmpdir(), 'openplanr-dashboard-cutover-'));
    const planrDir = join(temporaryRoot, 'project', '.planr');
    mkdirSync(planrDir, { recursive: true });
    writeFileSync(
      join(planrDir, 'config.json'),
      JSON.stringify({ projectName: 'Cutover dogfood' }),
    );

    const dashboard = pipeline.startDashboard({
      staticRoot: dashboardRoot,
      dashboardBuildId: report.buildId,
      planrDir,
      watch: false,
      getOperatingCommandGateway: () => null,
    });

    try {
      const port = await dashboard.listen(0, {
        env: { ...process.env, PLANR_HOME: join(temporaryRoot, 'home') },
      });
      const index = await httpGet(port, '/');
      expect(index.status).toBe(200);
      expect(index.body).toContain('id="root"');
      expect(index.body.includes('shell.js')).toBe(false);
      expect(index.body.includes('views/operate.js')).toBe(false);

      const bootstrap = await httpGet(port, '/api/bootstrap', { accept: 'application/json' });
      expect(bootstrap.status).toBe(200);
      const body = JSON.parse(bootstrap.body) as {
        compatibility: { status: string };
        ui: { buildId: string };
      };
      expect(body.compatibility.status).toBe('compatible');
      expect(body.ui.buildId).toBe(report.buildId);
    } finally {
      await dashboard.close();
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('refuses mixed legacy and unified manifests instead of partially booting', async () => {
    expect(existsSync(dashboardRoot), 'run npm run build before cutover tests').toBe(true);
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'openplanr-dashboard-mixed-'));
    const mixedRoot = join(temporaryRoot, 'mixed');
    mkdirSync(mixedRoot, { recursive: true });
    writeFileSync(join(mixedRoot, 'index.html'), '<main id="root"></main>\n');
    writeFileSync(
      join(mixedRoot, 'dashboard-manifest.json'),
      JSON.stringify({
        kind: 'legacy-dashboard-build',
        schemaVersion: '1.0.0',
        buildId: 'dashboard-legacy-test',
        entry: 'index.html',
        assets: [],
      }),
    );

    const planrDir = join(temporaryRoot, 'project', '.planr');
    mkdirSync(planrDir, { recursive: true });
    writeFileSync(join(planrDir, 'config.json'), JSON.stringify({ projectName: 'Mixed manifest' }));

    const dashboard = pipeline.startDashboard({
      staticRoot: mixedRoot,
      planrDir,
      watch: false,
    });

    try {
      const port = await dashboard.listen(0, {
        env: { ...process.env, PLANR_HOME: join(temporaryRoot, 'home') },
      });
      const bootstrap = await httpGet(port, '/api/bootstrap', { accept: 'application/json' });
      expect(bootstrap.status).toBe(200);
      const body = JSON.parse(bootstrap.body) as {
        compatibility: { status: string; reasonCodes: string[] };
      };
      expect(body.compatibility.status).not.toBe('compatible');
      expect(body.compatibility.reasonCodes.length).toBeGreaterThan(0);
    } finally {
      await dashboard.close();
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
