import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyDashboardAssets } from '../../lib/dashboard-verifier.mjs';
import { installedOpenPlanrDashboardBuildId } from '../../src/cli/commands/operate.js';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'openplanr-dashboard-error-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  delete process.env.OPENPLANR_DASHBOARD_ROOT;
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('installed dashboard asset errors', () => {
  it('returns a stable missing-assets report when the dashboard root is absent', () => {
    const missing = path.join(temporaryRoot(), 'private', 'missing-dashboard');
    const report = verifyDashboardAssets(missing);
    expect(report).toMatchObject({
      ok: false,
      code: 'E_DASHBOARD_ASSETS_MISSING',
      problem: 'The installed OpenPlanr dashboard assets are incomplete.',
      root: 'dashboard',
    });
    expect(JSON.stringify(report)).not.toContain(missing);
    expect(JSON.stringify(report)).not.toMatch(/ENOENT|\n\s+at\s/u);
  });

  it('classifies a manifest with absent declared files as missing assets', () => {
    const dashboard = path.join(temporaryRoot(), 'dashboard');
    mkdirSync(dashboard, { recursive: true });
    const digest = `sha256:${'0'.repeat(64)}`;
    writeFileSync(
      path.join(dashboard, 'dashboard-manifest.json'),
      `${JSON.stringify({
        kind: 'openplanr-dashboard-build',
        schemaVersion: '1.0.0',
        buildId: 'dashboard-incomplete',
        entry: 'index.html',
        assets: ['assets/app.js'],
        assetDigests: {
          'assets/app.js': { bytes: 1, sha256: digest },
          'index.html': { bytes: 1, sha256: digest },
        },
      })}\n`,
    );

    const report = verifyDashboardAssets(dashboard);
    expect(report.code).toBe('E_DASHBOARD_ASSETS_MISSING');
    expect(report.violations).toContain('manifest asset is missing: index.html');
    expect(report.violations).toContain('manifest asset is missing: assets/app.js');
  });

  it('maps a missing installed dashboard to a typed CLI error without its path', () => {
    const missing = path.join(temporaryRoot(), 'private-dashboard');
    process.env.OPENPLANR_DASHBOARD_ROOT = missing;
    expect(() => installedOpenPlanrDashboardBuildId()).toThrowError(
      expect.objectContaining({
        code: 'E_DASHBOARD_ASSETS_MISSING',
        message: 'The installed OpenPlanr dashboard assets are incomplete.',
      }),
    );
    try {
      installedOpenPlanrDashboardBuildId();
    } catch (error) {
      const value = (error as { toJSON(): unknown }).toJSON();
      expect(JSON.stringify(value)).not.toContain(missing);
      expect(JSON.stringify(value)).not.toMatch(/ENOENT|\n\s+at\s/u);
    }
  });
});
