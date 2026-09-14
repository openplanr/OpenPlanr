import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(
  typeof process.env.PLANR_OPENPLANR_ROOT,
  'string',
  'run this paired test through npm run test:unified-dashboard:paired',
);
const openPlanrRoot = resolve(process.env.PLANR_OPENPLANR_ROOT);
const openPlanrDashboard = join(openPlanrRoot, 'dist', 'dashboard');

function runNpm(args, cwd, env = {}) {
  const npmCli = process.env.npm_execpath;
  const result = npmCli
    ? spawnSync(process.execPath, [npmCli, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false', ...env },
    })
    : spawnSync('npm', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false', ...env },
    });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result;
}

function packTo(sourceRoot, packDir, npmCache) {
  const report = JSON.parse(
    runNpm(
      ['pack', '--json', '--ignore-scripts', '--pack-destination', packDir],
      sourceRoot,
      { npm_config_cache: npmCache },
    ).stdout,
  );
  const filename = report[0]?.filename;
  assert.equal(typeof filename, 'string', `npm pack did not report an archive for ${sourceRoot}`);
  return join(packDir, filename);
}

test('resolvePackagedDashboardRoot finds an installed OpenPlanr dashboard without a sibling checkout', {
  timeout: 180_000,
}, () => {
  assert.equal(
    existsSync(join(openPlanrDashboard, 'dashboard-manifest.json')),
    true,
    'OpenPlanr dist/dashboard must exist; run npm run build:dashboard in OpenPlanr',
  );
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-dashboard-consumer-'));
  const consumerDir = join(temporaryRoot, 'consumer');
  const packDir = join(temporaryRoot, 'pack');
  const npmCache = join(temporaryRoot, 'npm-cache');
  mkdirSync(consumerDir, { recursive: true });
  mkdirSync(packDir, { recursive: true });
  try {
    const openPlanrTarball = packTo(openPlanrRoot, packDir, npmCache);
    const pipelineTarball = packTo(root, packDir, npmCache);
    writeFileSync(join(consumerDir, 'package.json'), JSON.stringify({
      name: 'dashboard-consumer-fixture',
      private: true,
      type: 'module',
      dependencies: {
        openplanr: `file:${openPlanrTarball}`,
        'planr-pipeline': `file:${pipelineTarball}`,
      },
    }, null, 2));
    runNpm(
      ['install', '--ignore-scripts', '--no-package-lock', '--prefer-offline'],
      consumerDir,
      { npm_config_cache: npmCache },
    );
    assert.notEqual(
      realpathSync(join(consumerDir, 'node_modules', 'openplanr')),
      realpathSync(openPlanrRoot),
    );
    assert.notEqual(
      realpathSync(join(consumerDir, 'node_modules', 'planr-pipeline')),
      realpathSync(root),
    );
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { resolvePackagedDashboardRoot } from 'planr-pipeline/dashboard/resolve-packaged-dashboard-root';
      console.log(resolvePackagedDashboardRoot({ OPENPLANR_DASHBOARD_ROOT: '' }));
    `], {
      cwd: consumerDir,
      encoding: 'utf8',
      env: { ...process.env, OPENPLANR_DASHBOARD_ROOT: '' },
    });
    assert.equal(probe.status, 0, probe.stderr);
    const resolved = probe.stdout.trim();
    assert.match(resolved, /node_modules[\\/]+openplanr[\\/]+dist[\\/]+dashboard$/u);
    assert.equal(existsSync(join(resolved, 'dashboard-manifest.json')), true);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
