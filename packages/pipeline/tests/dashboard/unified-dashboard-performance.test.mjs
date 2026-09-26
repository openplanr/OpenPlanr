import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { checkOperateRuntimePurity } from '../../scripts/check-operate-runtime-purity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(
  typeof process.env.PLANR_OPENPLANR_ROOT,
  'string',
  'run this paired test through npm run test:unified-dashboard:paired',
);
const openPlanrRoot = resolve(process.env.PLANR_OPENPLANR_ROOT);
const dashboardRoot = join(openPlanrRoot, 'dist/dashboard');

function httpGet(port, path, headers = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolveRequest({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', rejectRequest);
    req.end();
  });
}

test('unified dashboard protocol custody remains in the packed pipeline product', () => {
  const purity = checkOperateRuntimePurity();
  assert.equal(purity.ok, true);
  for (const path of [
    'schemas/v1.2.0/dashboard-bootstrap.schema.json',
    'lib/dashboard/server.mjs',
    'lib/protocol/contracts.mjs',
  ]) {
    assert.equal(existsSync(join(root, path)), true, path);
  }
});

test('unified dashboard optional dependency absence keeps diagnostics available', {
  timeout: 120_000,
}, async () => {
  assert.equal(
    existsSync(dashboardRoot),
    true,
    'OpenPlanr dist/dashboard must exist; run npm run build in OpenPlanr',
  );
  const manifest = JSON.parse(readFileSync(join(dashboardRoot, 'dashboard-manifest.json'), 'utf8'));
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-unified-dashboard-optional-'));
  const planrDir = join(temporaryRoot, 'project', '.planr');
  mkdirSync(planrDir, { recursive: true });
  writeFileSync(
    join(planrDir, 'config.json'),
    JSON.stringify({ projectName: 'Optional dependency dogfood' }),
  );

  const { createDashboardServer } = await import(
    pathToFileURL(join(root, 'lib/dashboard/server.mjs')).href
  );
  const dashboard = createDashboardServer({
    staticRoot: dashboardRoot,
    dashboardBuildId: manifest.buildId,
    planrDir,
    watch: false,
    getOperatingCommandGateway: () => null,
  });

  try {
    const port = await dashboard.listen(0, {
      env: { ...process.env, PLANR_HOME: join(temporaryRoot, 'home') },
    });
    const bootstrap = await httpGet(port, '/api/bootstrap', { accept: 'application/json' });
    assert.equal(bootstrap.status, 200);
    const body = JSON.parse(bootstrap.body);
    assert.equal(body.capabilities.diagnostics.available, true);
    assert.equal(body.capabilities.operateCommands.available, false);
    assert.equal(body.compatibility.status, 'compatible');
    assert.equal(bootstrap.body.includes('Optional dependency dogfood'), true);
  } finally {
    await dashboard.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('unified dashboard static reads remain bounded under repeated access', {
  timeout: 120_000,
}, async () => {
  assert.equal(
    existsSync(dashboardRoot),
    true,
    'OpenPlanr dist/dashboard must exist; run npm run build in OpenPlanr',
  );
  const manifest = JSON.parse(readFileSync(join(dashboardRoot, 'dashboard-manifest.json'), 'utf8'));
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-unified-dashboard-static-'));
  const planrDir = join(temporaryRoot, 'project', '.planr');
  mkdirSync(planrDir, { recursive: true });
  writeFileSync(
    join(planrDir, 'config.json'),
    JSON.stringify({ projectName: 'Static read budget' }),
  );

  const { createDashboardServer } = await import(
    pathToFileURL(join(root, 'lib/dashboard/server.mjs')).href
  );
  const dashboard = createDashboardServer({
    staticRoot: dashboardRoot,
    dashboardBuildId: manifest.buildId,
    planrDir,
    watch: false,
  });

  try {
    const port = await dashboard.listen(0, {
      env: { ...process.env, PLANR_HOME: join(temporaryRoot, 'home') },
    });
    const beforeHeap = process.memoryUsage().heapUsed;
    for (let round = 0; round < 100; round += 1) {
      for (const asset of manifest.assets) {
        const response = await httpGet(port, `/${asset}`);
        assert.equal(response.status, 200, asset);
      }
    }
    const heapDelta = Math.max(0, process.memoryUsage().heapUsed - beforeHeap);
    assert.ok(heapDelta <= 64 * 1024 * 1024, `heap delta ${heapDelta} exceeds 64MiB`);
  } finally {
    await dashboard.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
