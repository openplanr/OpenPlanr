import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertPlanningGraph } from '../../lib/dashboard/graph-engine.mjs';
import {
  assertPlanningGraphEnvelope,
  assertPlanningLiveEventEnvelope,
  createDashboardServer,
  decodePlanningCheckpoint,
  encodePlanningCheckpoint,
} from '../../lib/dashboard/server.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

const planrDir = join(process.cwd(), 'conformance/fixtures/dashboard-graph/.planr');
const actorId = 'owner-planning-contract';

function request(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = get({ host: '127.0.0.1', port, path, headers }, (res) => {
      let body = '';
      const stream = String(res.headers['content-type'] ?? '').includes('text/event-stream');
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (stream && body.includes('\n\n')) {
          req.destroy();
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', (error) => {
      if (error?.code !== 'ECONNRESET') reject(error);
    });
    req.setTimeout(4_000, () => req.destroy(new Error('request timed out')));
  });
}

function eventFrom(body) {
  const line = body.split('\n').find((entry) => entry.startsWith('data: '));
  assert.ok(line);
  return JSON.parse(line.slice(6));
}

function query(projectId, generation = 4) {
  return new URLSearchParams({
    projectId,
    scopeId: 'planning',
    domainId: 'planning',
    domainVersion: '1.0.0',
    generation: String(generation),
  }).toString();
}

test('Planning REST is exact-bound, graph-revision committed, and byte-parallel with legacy graph', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-planning-contract-'));
  const dashboard = createDashboardServer({ planrDir, watch: false, planningActorId: actorId });
  try {
    const port = await dashboard.listen(0, { env: { ...process.env, PLANR_HOME: home } });
    const bootstrap = JSON.parse((await request(port, '/api/bootstrap')).body);
    const projectId = bootstrap.project.projectId;
    const legacy = await request(port, '/api/graph');
    const response = await request(port, `/api/planning/graph?${query(projectId)}`, {
      'X-OpenPlanr-Actor': actorId,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(legacy.headers['cache-control'], undefined);
    const envelope = assertPlanningGraphEnvelope(JSON.parse(response.body));
    assert.equal(JSON.stringify(envelope.graph), legacy.body);
    assert.equal(envelope.cursor.viewHash, sha256Jcs(envelope.graph));
    assert.deepEqual(Object.keys(envelope.cursor).sort(), ['eventHead', 'viewHash']);
    assert.equal(Object.hasOwn(envelope.cursor, 'revision'), false);
    const legacyEvents = await request(port, '/api/events');
    assert.equal(
      legacyEvents.body,
      `event: ready\ndata: ${JSON.stringify({ ok: true, pid: process.pid })}\n\n`,
    );

    for (const path of [
      `/api/planning/graph?${query(projectId).replace('scopeId=planning', 'scopeId=foreign')}`,
      `/api/planning/graph?${query(projectId)}&extra=true`,
      `/api/planning/graph?${query(projectId)}&generation=4`,
    ]) {
      const refused = await request(port, path, { 'X-OpenPlanr-Actor': actorId });
      assert.equal(refused.status, 403);
      assert.equal(refused.body.includes(projectId), false);
      assert.equal(refused.body.includes(actorId), false);
    }
    const foreignActor = await request(port, `/api/planning/graph?${query(projectId)}`, {
      'X-OpenPlanr-Actor': 'foreign-owner',
    });
    assert.equal(foreignActor.status, 403);
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('Planning detail is bound to the exact graph summary and refuses foreign substitution', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-planning-detail-'));
  const graph = assertPlanningGraph({
    nodes: [
      {
        id: 'T-022',
        type: 'task',
        title: 'Planning transport',
        status: 'in-progress',
        frontmatter: { id: 'T-022', storyId: 'US-011' },
      },
    ],
    edges: [],
  });
  let detail = { ...graph.nodes[0], body: 'Exact public body.' };
  const dashboard = createDashboardServer({
    planrDir,
    watch: false,
    planningActorId: actorId,
    getGraph: () => graph,
    getNode: () => detail,
  });
  try {
    const port = await dashboard.listen(0, { env: { ...process.env, PLANR_HOME: home } });
    const bootstrap = JSON.parse((await request(port, '/api/bootstrap')).body);
    const path = `/api/planning/detail/T-022?${query(bootstrap.project.projectId)}`;
    const accepted = await request(port, path, { 'X-OpenPlanr-Actor': actorId });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.headers['cache-control'], 'no-store');
    const body = JSON.parse(accepted.body);
    assert.equal(body.subjectId, 'T-022');
    assert.equal(body.nodeHash, sha256Jcs(body.node));
    assert.equal(body.cursor.viewHash, sha256Jcs(graph));
    const legacyDetail = await request(port, '/api/node/T-022');
    assert.equal(legacyDetail.status, 200);
    assert.equal(legacyDetail.headers['cache-control'], undefined);
    assert.equal(legacyDetail.body, JSON.stringify(body.node));

    detail = { ...detail, title: 'Foreign title' };
    const refused = await request(port, path, { 'X-OpenPlanr-Actor': actorId });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.includes('Foreign title'), false);
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('Planning SSE replays a committed patch and emits stale after a gap or restart', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-planning-sse-'));
  const graph = assertPlanningGraph({
    nodes: [
      {
        id: 'T-022',
        type: 'task',
        title: 'Before',
        status: 'outstanding',
        frontmatter: { id: 'T-022' },
      },
    ],
    edges: [],
  });
  const dashboard = createDashboardServer({
    planrDir,
    watch: false,
    planningActorId: actorId,
    getGraph: () => graph,
    getNode: () => ({ ...graph.nodes[0], body: '' }),
  });
  try {
    const port = await dashboard.listen(0, { env: { ...process.env, PLANR_HOME: home } });
    const bootstrap = JSON.parse((await request(port, '/api/bootstrap')).body);
    const path = `/api/planning/events?${query(bootstrap.project.projectId)}`;
    const headers = { 'X-OpenPlanr-Actor': actorId };
    const snapshot = assertPlanningLiveEventEnvelope(
      eventFrom((await request(port, path, headers)).body),
    );
    assert.equal(snapshot.event, 'snapshot');
    const checkpoint = encodePlanningCheckpoint(snapshot.cursor);
    assert.deepEqual(decodePlanningCheckpoint(checkpoint), snapshot.cursor);

    assert.equal(
      dashboard.acceptPlanningWatcherPatch({
        updated: [{ ...graph.nodes[0], title: 'After', status: 'in-progress' }],
        added: [],
        removed: [],
        edges: { added: [], removed: [] },
      }),
      true,
    );
    const replay = await request(port, path, { ...headers, 'Last-Event-ID': checkpoint });
    const patch = assertPlanningLiveEventEnvelope(eventFrom(replay.body));
    assert.equal(patch.event, 'patch');
    assert.deepEqual(patch.payload.from, snapshot.cursor);
    assert.equal(patch.payload.to.eventHead.sequence, 1);
    assert.equal(patch.payload.to.viewHash, sha256Jcs(dashboard.getCurrentGraph()));

    const committedCursor = dashboard.getPlanningCursor();
    assert.equal(
      dashboard.acceptPlanningWatcherPatch({
        updated: [dashboard.getCurrentGraph().nodes[0]],
        added: [],
        removed: [],
        edges: { added: [], removed: [] },
      }),
      false,
      'a no-op cannot advance the event cursor without a new graph revision',
    );
    assert.equal(
      dashboard.acceptPlanningWatcherPatch({
        updated: [],
        added: [],
        removed: ['T-foreign'],
        edges: { added: [], removed: [] },
      }),
      false,
      'a patch cannot target a foreign graph identity',
    );
    assert.deepEqual(dashboard.getPlanningCursor(), committedCursor);

    const staleCursor = encodePlanningCheckpoint({
      eventHead: { sequence: 0, hash: null },
      viewHash: `sha256:${'f'.repeat(64)}`,
    });
    const stale = await request(port, path, { ...headers, 'Last-Event-ID': staleCursor });
    const staleEvent = assertPlanningLiveEventEnvelope(eventFrom(stale.body));
    assert.equal(staleEvent.event, 'stale');
    assert.deepEqual(staleEvent.payload.reasonCodes, ['PLANNING_EVENT_GAP']);
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('Planning graph owner rejects duplicate identities, orphan edges, bodies, and unsafe values', () => {
  const node = { id: 'T-1', type: 'task', title: 'Task', status: 'outstanding', frontmatter: {} };
  assert.throws(() => assertPlanningGraph({ nodes: [node, node], edges: [] }));
  assert.throws(() =>
    assertPlanningGraph({
      nodes: [node],
      edges: [{ from: 'T-1', to: 'T-2', kind: 'depends_on' }],
    }),
  );
  assert.throws(() => assertPlanningGraph({ nodes: [{ ...node, body: 'leak' }], edges: [] }));
  const hostile = { nodes: [node], edges: [] };
  Object.defineProperty(hostile, 'secret', { enumerable: true, get: () => 'executed' });
  assert.throws(() => assertPlanningGraph(hostile));
  for (const id of ['\uD800', '\uDC00']) {
    assert.throws(() => assertPlanningGraph({ nodes: [{ ...node, id }], edges: [] }));
  }
  assert.doesNotThrow(() =>
    assertPlanningGraph({
      nodes: [
        { ...node, id: '\uFFFD' },
        { ...node, id: 'unicode-مرحبا-計画-😀' },
      ],
      edges: [],
    }),
  );
});
