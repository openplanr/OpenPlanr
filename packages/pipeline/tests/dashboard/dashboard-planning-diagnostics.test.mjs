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
function harness(
  planrDir = fixtureDir,
  getGraph = () => readGraph(planrDir),
  { lazyCursor = false } = {},
) {
  const planning = createPlanningState({ planrDir, getGraph });
  const dashboard = { planrDir, project: { projectId }, planningActorId: actorId, planning };
  // A lazy harness lets a test observe the first route response even when reading the graph fails.
  const cursor = lazyCursor ? null : planning.cursor();
  const binding = {
    actorId,
    projectId,
    scopeId: 'planning',
    domainId: 'planning',
    domainVersion: '1.0.0',
    generation: 4,
  };
  const request = async ({
    pathname = '/api/planning/diagnostics',
    params = {},
    actor = actorId,
    append,
    remove,
    headersDistinct,
  } = {}) => {
    const query = new URLSearchParams({
      ...Object.fromEntries(Object.entries(binding).filter(([key]) => key !== 'actorId')),
      ...(cursor ? { sourceViewHash: cursor.viewHash } : {}),
      ...params,
    });
    if (append) query.append(...append);
    if (remove) query.delete(remove);
    const req = {
      method: 'GET',
      url: `${pathname}?${query}`,
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

test('one unusual id or source path is reported without failing the other findings', async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), 'planning-diagnostics-unusual-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(join(root, 'backlog'));
  const item = (name, frontmatter) =>
    fs.writeFileSync(
      join(root, 'backlog', name),
      `---\n${frontmatter}title: Item\nstatus: outstanding\ndependsOn: [MISSING-1]\n---\n`,
    );
  item('BL-001-100%-done.md', 'id: BL-001\n');
  item('BL-002-colon.md', 'id: "BL:002"\n');
  item('BL-003-a\u0001b.md', 'id: BL-003\n');
  item('BL-004-plain.md', 'id: BL-004\n');
  const { request, binding, cursor } = harness(root);
  const response = await request();
  const envelope = assertPlanningDiagnosticsEnvelope(response.json, { binding, cursor });
  assert.equal(envelope.state, 'available');
  assert.equal(envelope.totalCount, 4);
  const shown = envelope.diagnostics.map((entry) => [entry.nodeId, entry.sourcePath]);
  assert.deepEqual(shown, [
    ['BL-001', '.planr/backlog/BL-001-100%-done.md'],
    ['BL:002', '.planr/backlog/BL-002-colon.md'],
    ['BL-003', '.planr/backlog/BL-003-a\uFFFDb.md'],
    ['BL-004', '.planr/backlog/BL-004-plain.md'],
  ]);
});

test('a skipped file is reported beside the other findings without a node', async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), 'planning-diagnostics-skipped-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(join(root, 'backlog'));
  fs.writeFileSync(
    join(root, 'backlog', 'BL-001-a.md'),
    '---\nid: BL-001\ntitle: Item\nstatus: outstanding\ndependsOn: [MISSING-1]\n---\n',
  );
  fs.writeFileSync(join(root, 'backlog', 'notes\u0001.md'), '---\ntitle: Notes\n---\n');
  fs.writeFileSync(join(root, 'backlog', 'README.md'), '# Backlog\n');
  const { request, binding, cursor } = harness(root);
  const envelope = assertPlanningDiagnosticsEnvelope((await request()).json, { binding, cursor });
  assert.equal(envelope.state, 'available');
  assert.deepEqual(
    envelope.diagnostics.map((entry) => [entry.reason, entry.nodeId, entry.sourcePath]),
    [
      ['missing-reference', 'BL-001', '.planr/backlog/BL-001-a.md'],
      ['unrecognized-identity', 'notes\uFFFD', '.planr/backlog/notes\uFFFD.md'],
    ],
  );
});

test('a backslash in a file name is reported without failing the other findings', async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), 'planning-diagnostics-backslash-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(join(root, 'backlog'));
  const item = (name, id) =>
    fs.writeFileSync(
      join(root, 'backlog', name),
      `---\nid: ${id}\ntitle: Item\nstatus: outstanding\ndependsOn: [MISSING-1]\n---\n`,
    );
  item('BL-001-plain.md', 'BL-001');
  item('BL-002-a\\b.md', 'BL-002');
  fs.writeFileSync(join(root, 'backlog', 'a\\b.md'), '---\ntitle: Stray\n---\n');
  const { request, binding, cursor } = harness(root);
  const envelope = assertPlanningDiagnosticsEnvelope((await request()).json, { binding, cursor });
  assert.equal(envelope.state, 'available');
  assert.deepEqual(
    envelope.diagnostics.map((entry) => [entry.reason, entry.nodeId, entry.sourcePath]),
    [
      ['missing-reference', 'BL-001', '.planr/backlog/BL-001-plain.md'],
      ['missing-reference', 'BL-002', '.planr/backlog/BL-002-a�b.md'],
      ['unrecognized-identity', 'a\\b', '.planr/backlog/a�b.md'],
    ],
  );
});

test('a file name that cannot be a node id is a finding, not a failed graph', async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), 'planning-diagnostics-node-id-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(join(root, 'backlog'));
  fs.writeFileSync(
    join(root, 'backlog', 'BL-001-plain.md'),
    '---\nid: BL-001\ntitle: Healthy\nstatus: outstanding\n---\n',
  );
  fs.writeFileSync(join(root, 'backlog', 'x\\y-5.md'), '---\ntitle: Backslash\n---\n');
  fs.writeFileSync(join(root, 'backlog', 'x\u0001y-6.md'), '---\ntitle: Control\n---\n');
  const { dashboard, request } = harness(root, () => readGraph(root), { lazyCursor: true });
  const graph = await request({ pathname: '/api/planning/graph' });
  assert.equal(graph.status, 200);
  assert.deepEqual(
    graph.json.graph.nodes.map((node) => node.id),
    ['BL-001'],
  );
  const detail = await request({ pathname: '/api/planning/detail/BL-001' });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.node.id, 'BL-001');
  const diagnostics = await request({
    params: { sourceViewHash: dashboard.planning.cursor().viewHash },
  });
  assert.equal(diagnostics.json.state, 'available');
  assert.deepEqual(
    diagnostics.json.diagnostics.map((entry) => [entry.reason, entry.nodeId, entry.sourcePath]),
    [
      ['unrecognized-identity', 'x\uFFFDy-6', '.planr/backlog/x\uFFFDy-6.md'],
      ['unrecognized-identity', 'x\\y-5', '.planr/backlog/x\uFFFDy-5.md'],
    ],
  );
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
