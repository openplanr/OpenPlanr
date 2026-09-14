// @vitest-environment node

import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DASHBOARD_BUNDLE_BUDGETS,
  verifyDashboardAssets,
} from '../../scripts/verify-dashboard-assets.mjs';
import { installPackedPipeline, type PackedPipelineInstall } from './helpers/installed-pipeline.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dashboardRoot = join(repositoryRoot, 'dist/dashboard');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const onWindows = process.platform === 'win32';
let pipeline: PackedPipelineInstall;

beforeAll(async () => {
  pipeline = await installPackedPipeline();
}, 120_000);

afterAll(() => pipeline?.cleanup());

function npmExec(
  args: string[],
  options: Parameters<typeof execFileSync>[2] = {},
): string | Buffer {
  return execFileSync(npm, onWindows ? args.map((arg) => `"${arg}"`) : args, {
    ...options,
    ...(onWindows ? { shell: true } : {}),
  });
}

function commandStdout(value: string | Buffer): string {
  return typeof value === 'string' ? value : value.toString('utf8');
}

function dashboardCustody(report: ReturnType<typeof verifyDashboardAssets>) {
  expect(report.ok, report.violations.join('; ')).toBe(true);
  return {
    buildId: report.buildId,
    assetManifestHash: report.assetManifestHash,
    assets: report.assets.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
  };
}

function packDashboardPackage(archiveRoot: string): string {
  const packed = JSON.parse(
    commandStdout(
      npmExec(['pack', '--json', '--ignore-scripts', '--pack-destination', archiveRoot], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        windowsHide: true,
      }),
    ),
  ) as Array<{ filename?: unknown }>;
  const filename = packed[0]?.filename;
  expect(typeof filename).toBe('string');
  return join(archiveRoot, filename as string);
}

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

describe('dashboard installed package custody', () => {
  it('verifies the built dashboard manifest, assets, and bundle budgets', () => {
    expect(existsSync(dashboardRoot), 'run npm run build before package custody tests').toBe(true);
    const report = verifyDashboardAssets(dashboardRoot);
    expect(report.ok, report.violations.join('; ')).toBe(true);
    expect(report.buildId).toMatch(/^dashboard-/u);
    expect(report.assetManifestHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(report.assets.map(({ path }) => path)).toContain('index.html');
    for (const asset of report.assets) {
      expect(asset.sha256, asset.path).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(asset.bytes, asset.path).toBeGreaterThan(0);
    }
    expect(report.sizes.javascript).toBeLessThanOrEqual(
      DASHBOARD_BUNDLE_BUDGETS.maxJavaScriptBytes,
    );
    expect(report.sizes.css).toBeLessThanOrEqual(DASHBOARD_BUNDLE_BUDGETS.maxCssBytes);
  });

  it('rejects hostile byte tampering against the declared asset digests', () => {
    expect(existsSync(dashboardRoot), 'run npm run build before package custody tests').toBe(true);
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'openplanr-dashboard-tamper-'));
    const tamperedRoot = join(temporaryRoot, 'dashboard');
    try {
      cpSync(dashboardRoot, tamperedRoot, { recursive: true });
      appendFileSync(join(tamperedRoot, 'index.html'), '<!-- hostile byte -->\n');

      const report = verifyDashboardAssets(tamperedRoot);
      expect(report.ok).toBe(false);
      expect(report.violations).toContain('manifest asset digest mismatch: index.html');
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('preserves identical source, packed, and installed dashboard asset digests', () => {
    expect(existsSync(dashboardRoot), 'run npm run build before package custody tests').toBe(true);
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'openplanr-dashboard-pack-'));
    try {
      const archiveRoot = join(temporaryRoot, 'archives');
      const extractionRoot = join(temporaryRoot, 'extracted');
      const consumerRoot = join(temporaryRoot, 'consumer');
      mkdirSync(archiveRoot, { recursive: true });
      mkdirSync(extractionRoot, { recursive: true });
      mkdirSync(consumerRoot, { recursive: true });
      writeFileSync(
        join(consumerRoot, 'package.json'),
        JSON.stringify({ name: 'openplanr-dashboard-custody', private: true }),
      );

      const archive = packDashboardPackage(archiveRoot);
      expect(existsSync(archive)).toBe(true);
      execFileSync('tar', ['-xzf', archive, '-C', extractionRoot], {
        stdio: 'pipe',
        windowsHide: true,
      });

      npmExec(
        [
          'install',
          '--prefix',
          consumerRoot,
          '--omit=optional',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--package-lock=false',
          '--prefer-offline',
          '--no-progress',
          archive,
        ],
        { cwd: temporaryRoot, stdio: 'pipe', windowsHide: true },
      );

      const extractedDashboard = join(extractionRoot, 'package', 'dist', 'dashboard');
      const installedPackage = join(consumerRoot, 'node_modules', 'openplanr');
      const installedDashboard = join(installedPackage, 'dist', 'dashboard');
      expect(lstatSync(installedPackage).isSymbolicLink()).toBe(false);
      expect(realpathSync(installedPackage)).not.toBe(realpathSync(repositoryRoot));
      expect(lstatSync(installedDashboard).isSymbolicLink()).toBe(false);
      expect(realpathSync(installedDashboard)).not.toBe(realpathSync(dashboardRoot));

      const source = dashboardCustody(verifyDashboardAssets(dashboardRoot));
      const packed = dashboardCustody(verifyDashboardAssets(extractedDashboard));
      const installed = dashboardCustody(verifyDashboardAssets(installedDashboard));
      expect(packed).toEqual(source);
      expect(installed).toEqual(source);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 180_000);

  it('serves the installed dashboard through the packed pipeline server without leaking private paths', async () => {
    expect(existsSync(dashboardRoot), 'run npm run build before package custody tests').toBe(true);
    expect(existsSync(join(pipeline.packageRoot, 'package.json'))).toBe(true);
    expect(pipeline.packageRoot).not.toBe(pipeline.sourceRoot);

    const report = verifyDashboardAssets(dashboardRoot);
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'openplanr-dashboard-installed-'));
    const planrDir = join(temporaryRoot, 'project', '.planr');
    mkdirSync(planrDir, { recursive: true });
    writeFileSync(
      join(planrDir, 'config.json'),
      JSON.stringify({ projectName: 'Installed dogfood' }),
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
      const bootstrap = await httpGet(port, '/api/bootstrap', { accept: 'application/json' });
      expect(bootstrap.status).toBe(200);
      expect(bootstrap.headers['cache-control']).toBe('no-store');
      expect(bootstrap.body.includes(temporaryRoot)).toBe(false);
      expect(bootstrap.body.includes('Installed dogfood')).toBe(true);
      const body = JSON.parse(bootstrap.body) as {
        compatibility: { status: string };
        capabilities: {
          operateCommands: { available: boolean };
          diagnostics: { available: boolean };
        };
        project: { projectId: string };
        queryRoots: { planning: null; operate: null };
      };
      expect(body.compatibility.status).toBe('compatible');
      expect(body.capabilities.diagnostics.available).toBe(true);
      expect(body.capabilities.operateCommands.available).toBe(false);
      expect(body.queryRoots).toEqual({ planning: null, operate: null });
      expect(body.project.projectId).toMatch(/^sha256:[a-f0-9]{64}$/u);

      const index = await httpGet(port, '/index.html');
      expect(index.status).toBe(200);
      expect(index.body).toContain('id="root"');

      for (const asset of report.assets) {
        const response = await httpGet(port, `/${asset.path}`);
        expect(response.status, asset.path).toBe(200);
        expect(response.body.length, asset.path).toBeGreaterThan(0);
      }
    } finally {
      await dashboard.close();
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
