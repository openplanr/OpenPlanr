import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import {
  assertDashboardPathWithin,
  checkDashboardAssetCopy,
  dashboardAssetInventory,
} from '../../scripts/dashboard/copy-dashboard-assets.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

test('dashboard app is a private 0.1 workspace with protocol-only internal dependency', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(workspaceRoot, 'apps/dashboard/package.json'), 'utf8'),
  );
  assert.equal(manifest.name, '@openplanr/dashboard-app');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.private, true);
  assert.equal(manifest.dependencies['@openplanr/protocol'], '0.1.0');
  assert.equal(manifest.dependencies.openplanr, undefined);
  assert.equal(manifest.dependencies['planr-pipeline'], undefined);
});

test('built app and CLI copy retain exact digest custody', () => {
  assert.equal(
    existsSync(resolve(workspaceRoot, 'apps/dashboard/dist/dashboard-manifest.json')),
    true,
  );
  assert.equal(
    existsSync(resolve(workspaceRoot, 'packages/cli/dist/dashboard/dashboard-manifest.json')),
    true,
  );
  const report = checkDashboardAssetCopy();
  assert.equal(report.ok, true);
  assert.match(report.buildId, /^dashboard-0\.1\.0-[a-f0-9]{16}$/u);
  assert.match(report.inventoryDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.ok(report.files >= 5);
});

test('path escape and symbolic-link asset inputs fail closed', {
  skip: process.platform === 'win32',
}, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'openplanr-dashboard-custody-test-')));
  temporaryRoots.push(root);
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'ok.js'), 'export {};\n');
  assert.equal(
    assertDashboardPathWithin(root, join(root, 'assets', 'ok.js')),
    join('assets', 'ok.js'),
  );
  assert.throws(
    () => assertDashboardPathWithin(root, resolve(root, '..', 'escape.js')),
    /escapes custody root/u,
  );
  symlinkSync(join(root, 'assets', 'ok.js'), join(root, 'assets', 'linked.js'));
  assert.throws(() => dashboardAssetInventory(root), /refuses symbolic links/u);
});
