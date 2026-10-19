import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readGraph } from '../../lib/dashboard/graph-reader.mjs';
import {
  assertPlanningDiagnosticsEnvelope,
  PLANNING_DIAGNOSTICS_MAX_BYTES,
  PLANNING_DIAGNOSTICS_MAX_COUNT,
} from '../../lib/dashboard/planning-diagnostics-contracts.mjs';
import { createPlanningState } from '../../lib/dashboard/server/planning-state.mjs';
import { handleDashboardRequest } from '../../lib/dashboard/server/routes.mjs';

const fixtureDir = fileURLToPath(
  new URL('../../conformance/fixtures/dashboard-identity/.planr/', import.meta.url),
);
const projectId = `sha256:${'b'.repeat(64)}`;
const actorId = 'diagnostics-owner';
function harness(planrDir = fixtureDir, getGraph = () => readGraph(planrDir)) {
  const planning = createPlanningState({ planrDir, getGraph });
  const dashboard = { planrDir, project: { projectId }, planningActorId: actorId, planning };
  const cursor = planning.cursor();
  const binding = {
    actorId,
    projectId,
    scopeId: 'planning',
    domainId: 'planning',
    domainVersion: '1.0.0',
    generation: 4,
  };
  const request = async ({
    params = {},
    actor = actorId,
    append,
    remove,
    headersDistinct,
  } = {}) => {
    const query = new URLSearchParams({
      ...Object.fromEntries(Object.entries(binding).filter(([key]) => key !== 'actorId')),
      sourceViewHash: cursor.viewHash,
      ...params,
    });
    if (append) query.append(...append);
    if (remove) query.delete(remove);
    const req = {
      method: 'GET',
      url: `/api/planning/diagnostics?${query}`,
      headers: { host: 'localhost:7473', ...(actor ? { 'x-openplanr-actor': actor } : {}) },
      headersDistinct,
      socket: { localPort: 7473, remoteAddress: '127.0.0.1' },
    };
    const res = {
      status: null,
      body: '',
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(body) {
        this.body = body;
      },
    };
    await handleDashboardRequest(dashboard, req, res);
    return { ...res, json: JSON.parse(res.body) };
  };
  return { dashboard, binding, cursor, request };
}

test('diagnostics exposes native evidence bound to the exact real-shape graph without writes', async () => {
  const { binding, cursor, request } = harness();
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const envelope = assertPlanningDiagnosticsEnvelope(response.json, { binding, cursor });
  assert.equal(envelope.state, 'available');
  assert.equal(envelope.truncated, false);
  assert.equal(envelope.totalCount, envelope.diagnostics.length);
  assert.ok(envelope.diagnostics.some((entry) => entry.reason === 'closed-before-start'));
  assert.ok(envelope.diagnostics.some((entry) => entry.reason === 'ambiguous-reference'));
  assert.ok(envelope.diagnostics.every((entry) => entry.sourcePath.startsWith('.planr/')));
  assert.equal(response.body.includes(fixtureDir), false);
  const graph = readGraph(fixtureDir);
  assert.equal(graph.nodes.find((node) => node.id === 'ADR-024').title, 'Native-first delegation');
  assert.equal(
    envelope.diagnostics.some((entry) => entry.nodeId === 'ADR-024'),
    false,
  );
  assert.equal(
    envelope.diagnostics.some(
      (entry) => entry.nodeId === 'SPRINT-001' && entry.reason === 'missing-reference',
    ),
    true,
  );
});

test('diagnostics rejects missing, duplicate, foreign and malformed request bindings before a read', async () => {
  const { request } = harness();
  for (const options of [
    { actor: null },
    { actor: 'foreign-owner' },
    { headersDistinct: { 'x-openplanr-actor': [actorId, actorId] } },
    { remove: 'projectId' },
    { params: { projectId: `sha256:${'c'.repeat(64)}` } },
    { params: { scopeId: 'other' } },
    { params: { domainId: 'other' } },
    { params: { domainVersion: '2.0.0' } },
    { params: { generation: '04' } },
    { params: { generation: '-1' } },
    { params: { generation: '9007199254740992' } },
    { append: ['generation', '4'] },
    { params: { unknown: 'value' } },
  ]) {
    const response = await request(options);
    assert.equal(response.status, 403, JSON.stringify(options));
  }
  for (const options of [{ remove: 'sourceViewHash' }, { append: ['sourceViewHash', 'invalid'] }])
    assert.equal((await request(options)).status, 400);
  assert.equal(
    (await request({ params: { sourceViewHash: `sha256:${'c'.repeat(64)}` } })).status,
    409,
  );
});

test('diagnostics refuses to join native evidence onto a different delegated graph', async () => {
  const { request } = harness(fixtureDir, () => ({ nodes: [], edges: [] }));
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.json.state, 'unavailable');
  assert.equal(response.json.totalCount, null);
  assert.deepEqual(response.json.diagnostics, []);
  assert.match(response.json.reason, /do not match/);
});

test('diagnostics refreshes source evidence even when duplicate edits leave graph hash unchanged', async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), 'planning-diagnostics-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(fixtureDir, root, { recursive: true });
  const { request, cursor, dashboard } = harness(root);
  const before = (await request()).json;
  fs.writeFileSync(
    join(root, 'quick/QT-999-duplicate.md'),
    '---\nid: QT-006\ntitle: Duplicate\nstatus: pending\n---\n',
  );
  const after = (await request()).json;
  assert.equal(dashboard.planning.cursor().viewHash, cursor.viewHash);
  assert.equal(after.totalCount, before.totalCount + 1);
});

test('diagnostics caps records and bytes and explicitly discloses omitted evidence', async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), 'planning-diagnostics-limit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(join(root, 'quick'));
  const refs = Array.from(
    { length: PLANNING_DIAGNOSTICS_MAX_COUNT + 10 },
    (_, index) => `missing-${index}`,
  );
  const directory = join(root, 'quick', ...Array.from({ length: 4 }, () => 'long'.repeat(50)));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    join(directory, 'QT-001-many.md'),
    `---\nid: QT-001\ntitle: Many references\ndependsOn: ${JSON.stringify(refs)}\n---\n`,
  );
  const { request } = harness(root);
  const response = await request();
  assert.equal(response.json.state, 'available');
  assert.ok(response.json.diagnostics.length < PLANNING_DIAGNOSTICS_MAX_COUNT);
  assert.ok(response.json.diagnostics.length > 0);
  assert.equal(response.json.totalCount, refs.length);
  assert.equal(response.json.truncated, true);
  assert.match(response.json.reason, /omitted/);
  assert.ok(Buffer.byteLength(response.body) <= PLANNING_DIAGNOSTICS_MAX_BYTES);
});

test('diagnostic source read errors surface only safe error codes and recovery', async (t) => {
  const { request } = harness();
  const original = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    if (String(file).startsWith(fixtureDir)) {
      throw Object.assign(new Error('/private/credential source failed'), { code: 'EACCES' });
    }
    return original(file, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const response = await request();
  assert.equal(response.json.state, 'error');
  assert.equal(response.json.errorCode, 'EACCES');
  assert.equal(response.body.includes('/private/credential'), false);
  assert.equal(response.json.totalCount, null);
});

test('diagnostics refuses evidence if the committed cursor changes during the source read', async (t) => {
  const { request, dashboard } = harness();
  const original = fs.readFileSync;
  let patched = false;
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    if (!patched && String(file).startsWith(fixtureDir)) {
      patched = true;
      dashboard.planning.commitPatch(
        dashboard.planning.preparePatch({
          added: [
            {
              id: 'new-item',
              type: 'quick',
              title: 'New item',
              status: 'outstanding',
              frontmatter: {},
            },
          ],
          updated: [],
          removed: [],
          edges: { added: [], removed: [] },
        }),
      );
    }
    return original(file, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const response = await request();
  assert.equal(response.json.state, 'unavailable');
  assert.equal(response.json.totalCount, null);
  assert.deepEqual(response.json.diagnostics, []);
});

test('diagnostics discloses count truncation separately from the byte limit', async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), 'planning-diagnostics-count-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(join(root, 'quick'));
  const refs = Array.from(
    { length: PLANNING_DIAGNOSTICS_MAX_COUNT + 1 },
    (_, index) => `missing-${index}`,
  );
  fs.writeFileSync(
    join(root, 'quick/QT-001-many.md'),
    `---\nid: QT-001\ntitle: Many references\ndependsOn: ${JSON.stringify(refs)}\n---\n`,
  );
  const response = await harness(root).request();
  assert.equal(response.json.diagnostics.length, PLANNING_DIAGNOSTICS_MAX_COUNT);
  assert.equal(response.json.totalCount, refs.length);
  assert.equal(response.json.truncated, true);
  assert.ok(Buffer.byteLength(response.body) < PLANNING_DIAGNOSTICS_MAX_BYTES);
});

test('source discovery permission failures cannot produce an empty healthy response', async (t) => {
  const { request } = harness();
  const original = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', (file, ...args) => {
    if (String(file).startsWith(fixtureDir)) {
      throw Object.assign(new Error('/private/discovery denied'), { code: 'EPERM' });
    }
    return original(file, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const response = await request();
  assert.equal(response.json.state, 'error');
  assert.equal(response.json.errorCode, 'EPERM');
  assert.equal(response.json.totalCount, null);
  assert.equal(response.body.includes('/private/discovery'), false);
});
