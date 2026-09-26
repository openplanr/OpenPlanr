import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  createDashboardServer,
  defaultDashboardStaticRoot,
  resolveDashboardStaticRoot,
} from '../../lib/dashboard/server.mjs';

const fixturePlanrDir = new URL(
  '../../conformance/fixtures/dashboard-graph/.planr/',
  import.meta.url,
).pathname;

function request(port, pathname) {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = get({ host: '127.0.0.1', port, path: pathname }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolveRequest({
          status: res.statusCode,
          contentType: res.headers['content-type'],
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', rejectRequest);
  });
}

test('external static root serves only its contained entry and assets', async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'planr-dashboard-root-'));
  const root = join(workspace, 'dashboard');
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<main>OpenPlanr dashboard build</main>\n');
  writeFileSync(join(root, 'assets', 'app.js'), 'globalThis.OPENPLANR_DASHBOARD = true;\n');
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  const dashboard = createDashboardServer({
    staticRoot: root,
    planrDir: fixturePlanrDir,
    watch: false,
  });
  t.after(() => dashboard.close());
  const port = await dashboard.listen(0, {
    env: { ...process.env, PLANR_HOME: join(workspace, 'home') },
  });

  assert.equal(dashboard.staticRoot, realpathSync(root));
  assert.deepEqual(await request(port, '/'), {
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<main>OpenPlanr dashboard build</main>\n',
  });
  assert.deepEqual(await request(port, '/assets/app.js'), {
    status: 200,
    contentType: 'text/javascript; charset=utf-8',
    body: 'globalThis.OPENPLANR_DASHBOARD = true;\n',
  });
  assert.equal((await request(port, '/missing.js')).status, 404);
});

test('explicit unified root resolves without a sibling-source fallback', async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'planr-dashboard-default-'));
  const root = join(workspace, 'dashboard');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'index.html'), '<main id="root">Installed dashboard</main>\n');
  writeFileSync(
    join(root, 'dashboard-manifest.json'),
    JSON.stringify({
      kind: 'openplanr-dashboard-build',
      schemaVersion: '1.0.0',
      buildId: 'dashboard-explicit-fixture',
      entry: 'index.html',
      assets: ['index.html'],
    }),
  );
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const resolvedRoot = defaultDashboardStaticRoot({ OPENPLANR_DASHBOARD_ROOT: root });
  const dashboard = createDashboardServer({
    staticRoot: resolvedRoot,
    planrDir: fixturePlanrDir,
    watch: false,
  });
  t.after(() => dashboard.close());
  assert.equal(dashboard.staticRoot, realpathSync(root));
  const port = await dashboard.listen(0, {
    env: { ...process.env, PLANR_HOME: join(workspace, 'home') },
  });
  const response = await request(port, '/');
  assert.equal(response.status, 200);
  assert.match(response.body, /Installed dashboard/u);
  const manifestResponse = await request(port, '/dashboard-manifest.json');
  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.body, /openplanr-dashboard-build/u);
});

test('static root validation refuses missing, relative, file, and missing-entry roots', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'planr-dashboard-invalid-'));
  try {
    const fileRoot = join(workspace, 'file-root');
    const emptyRoot = join(workspace, 'empty-root');
    writeFileSync(fileRoot, 'not a directory');
    mkdirSync(emptyRoot);
    assert.throws(() => resolveDashboardStaticRoot('relative/root'), /absolute path/u);
    assert.throws(() => resolveDashboardStaticRoot(join(workspace, 'missing')), /does not exist/u);
    assert.throws(() => resolveDashboardStaticRoot(fileRoot), /must be a directory/u);
    assert.throws(() => resolveDashboardStaticRoot(emptyRoot), /contain index\.html/u);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('static root and entry symlinks are refused; request traversal stays contained', async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'planr-dashboard-traversal-'));
  const realRoot = join(workspace, 'real');
  const linkedRoot = join(workspace, 'linked');
  const entryRoot = join(workspace, 'entry-link');
  const outside = join(workspace, 'outside.html');
  mkdirSync(realRoot);
  mkdirSync(entryRoot);
  writeFileSync(join(realRoot, 'index.html'), 'inside');
  writeFileSync(outside, 'outside-secret');
  symlinkSync(realRoot, linkedRoot, 'dir');
  symlinkSync(outside, join(entryRoot, 'index.html'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  assert.throws(() => resolveDashboardStaticRoot(linkedRoot), /must not be a symbolic link/u);
  assert.throws(() => resolveDashboardStaticRoot(entryRoot), /contained regular file/u);

  const dashboard = createDashboardServer({
    staticRoot: realRoot,
    planrDir: fixturePlanrDir,
    watch: false,
  });
  t.after(() => dashboard.close());
  const port = await dashboard.listen(0, {
    env: { ...process.env, PLANR_HOME: join(workspace, 'home') },
  });
  const traversal = await request(port, '/..%2Foutside.html');
  assert.notEqual(traversal.status, 200);
  assert.equal(traversal.body.includes('outside-secret'), false);
});
