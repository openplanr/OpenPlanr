// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function npm(args: string[], cwd: string, cache: string): string {
  return execFileSync('npm', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_cache: cache,
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('incomplete installed dashboard package', () => {
  it('returns one bounded product error from the packed public verifier', () => {
    const root = mkdtempSync(join(tmpdir(), 'openplanr-incomplete-dashboard-'));
    const fixture = join(root, 'fixture');
    const archives = join(root, 'archives');
    const consumer = join(root, 'consumer');
    const cache = join(root, 'npm-cache');
    try {
      mkdirSync(join(fixture, 'lib'), { recursive: true });
      mkdirSync(archives, { recursive: true });
      mkdirSync(consumer, { recursive: true });
      copyFileSync(
        join(repositoryRoot, 'lib', 'dashboard-verifier.mjs'),
        join(fixture, 'lib', 'dashboard-verifier.mjs'),
      );
      writeFileSync(
        join(fixture, 'package.json'),
        `${JSON.stringify({
          name: 'openplanr-incomplete-dashboard-fixture',
          version: '0.0.0',
          private: true,
          type: 'module',
          exports: {
            './dashboard': './dist/dashboard/dashboard-manifest.json',
            './dashboard-verifier': './lib/dashboard-verifier.mjs',
          },
          files: ['lib/', 'dist/dashboard/'],
        })}\n`,
      );
      writeFileSync(
        join(consumer, 'package.json'),
        '{"name":"incomplete-dashboard-consumer","private":true,"type":"module"}\n',
      );

      const packed = JSON.parse(
        npm(['pack', '--json', '--ignore-scripts', '--pack-destination', archives], fixture, cache),
      ) as Array<{ filename?: unknown }>;
      expect(typeof packed[0]?.filename).toBe('string');
      const archive = join(archives, packed[0]?.filename as string);
      npm(
        ['install', '--ignore-scripts', '--no-package-lock', '--omit=optional', archive],
        consumer,
        cache,
      );

      const probe = [
        "import { verifyDashboardAssets } from 'openplanr-incomplete-dashboard-fixture/dashboard-verifier';",
        'process.stdout.write(JSON.stringify(verifyDashboardAssets()));',
      ].join('\n');
      const raw = execFileSync(process.execPath, ['--input-type=module', '--eval', probe], {
        cwd: consumer,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const report = JSON.parse(raw) as Record<string, unknown>;
      expect(report).toMatchObject({
        ok: false,
        code: 'E_DASHBOARD_ASSETS_MISSING',
        problem: 'The installed OpenPlanr dashboard assets are incomplete.',
        root: 'dashboard',
      });
      expect(raw).not.toContain(root);
      expect(raw).not.toMatch(/ENOENT|\n\s+at\s/u);
      expect(readFileSync(archive).length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
