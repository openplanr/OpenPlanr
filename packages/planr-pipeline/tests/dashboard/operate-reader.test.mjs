import assert from 'node:assert/strict';
import { get } from 'node:http';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createDashboardServer } from '../../lib/dashboard/server.mjs';
import {
  OPERATING_CHECKPOINT_RELATIVE_PATH,
  readOperatingProjection,
} from '../../lib/dashboard/operate-reader.mjs';
import { createOperatingCheckpoint } from '../../lib/pipeline/index.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = JSON.parse(readFileSync(join(
  root,
  'conformance/fixtures/operating-dashboard/.planr/operate/projections/state.json',
), 'utf8'));

function withPlanrDir(run) {
  const dir = mkdtempSync(join(tmpdir(), 'planr-operate-reader-'));
  const planrDir = join(dir, '.planr');
  mkdirSync(planrDir, { recursive: true });
  try {
    return run(planrDir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function request(port, path) {
  return new Promise((resolve, reject) => {
    const req = get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(4000, () => req.destroy(new Error('request timed out')));
  });
}

test('operating reader is absent-safe, read-only, and never exposes machine paths', () => withPlanrDir((planrDir) => {
  const before = readOperatingProjection(planrDir);
  assert.deepEqual(before, {
    available: false,
    readOnly: true,
    status: 'absent',
    path: '.planr/operate/projections/state.json',
    state: null,
  });

  const projectionPath = join(planrDir, 'operate/projections/state.json');
  writeJson(projectionPath, fixture);
  const ready = readOperatingProjection(planrDir);
  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.state, fixture);
  assert.equal(JSON.stringify(ready).includes(planrDir), false);
  assert.deepEqual(JSON.parse(readFileSync(projectionPath, 'utf8')), fixture);
}));

test('operating reader surfaces invalid and stale state without repairing it', () => withPlanrDir((planrDir) => {
  const projectionPath = join(planrDir, 'operate/projections/state.json');
  writeJson(projectionPath, { ...fixture, protocolVersion: '9.9.9' });
  const invalid = readOperatingProjection(planrDir);
  assert.equal(invalid.status, 'invalid');
  assert.match(invalid.recovery, /planr operate integrity status/);

  writeJson(projectionPath, fixture);
  const stale = readOperatingProjection(planrDir, {
    expectedEventHead: {
      sequence: fixture.eventHead.sequence + 1,
      hash: `sha256:${'f'.repeat(64)}`,
    },
  });
  assert.equal(stale.status, 'stale');
  assert.deepEqual(stale.actualEventHead, fixture.eventHead);
  assert.match(stale.recovery, /planr operate integrity status/);
  assert.match(stale.recovery, /planr operate cycles recover/);
}));

test('operating reader validates an optional checkpoint head', () => withPlanrDir((planrDir) => {
  assert.equal(OPERATING_CHECKPOINT_RELATIVE_PATH, 'operate/checkpoints/current.json');
  writeJson(join(planrDir, 'operate/projections/state.json'), fixture);
  const checkpoint = createOperatingCheckpoint(fixture);
  writeJson(join(planrDir, OPERATING_CHECKPOINT_RELATIVE_PATH), checkpoint);
  assert.equal(readOperatingProjection(planrDir).status, 'ready');

  checkpoint.eventHead.sequence += 1;
  writeJson(join(planrDir, OPERATING_CHECKPOINT_RELATIVE_PATH), checkpoint);
  const invalid = readOperatingProjection(planrDir);
  assert.equal(invalid.status, 'invalid');
  assert.match(invalid.error, /^checkpoint:/);
  assert.match(invalid.recovery, /planr operate integrity status/);
  assert.match(invalid.recovery, /planr operate cycles recover/);
}));

test('operating reader ignores the obsolete latest.json checkpoint name', () => withPlanrDir((planrDir) => {
  writeJson(join(planrDir, 'operate/projections/state.json'), fixture);
  const obsoleteCheckpoint = createOperatingCheckpoint(fixture);
  obsoleteCheckpoint.eventHead.sequence += 1;
  writeJson(join(planrDir, 'operate/checkpoints/latest.json'), obsoleteCheckpoint);
  assert.equal(readOperatingProjection(planrDir).status, 'ready');
}));

test('dashboard exposes the operating projection through a read-only JSON endpoint', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-operate-api-'));
  const projection = {
    available: true,
    readOnly: true,
    status: 'ready',
    path: '.planr/operate/projections/state.json',
    state: fixture,
  };
  const dashboard = createDashboardServer({
    watch: false,
    getGraph: () => ({ nodes: [], edges: [] }),
    getOperatingProjection: () => projection,
  });
  try {
    const port = await dashboard.listen(0, { env: { ...process.env, PLANR_HOME: home } });
    const response = await request(port, '/api/operate');
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), projection);
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});
