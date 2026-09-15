import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { get } from 'node:http';
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createDashboardServer } from '../../lib/dashboard/server.mjs';
import { encodeOperateExperienceCheckpoint } from '../../lib/dashboard/operate-experience-reader.mjs';
import { assertOperateExperienceDisplaySurfaceV1 } from '../../lib/dashboard/operate-experience-display-contract.mjs';
import { deriveOperateSharedTruthSummaryV1 } from '../../lib/dashboard/operate-review-workspace-projection-v2.mjs';
import {
  assertDashboardBootstrapV1,
  validateDashboardBootstrapV1,
  validateProtocolArtifact,
} from '../../lib/protocol/contracts.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import { validate } from '../../conformance/json-schema-validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

const planrDir = join(root, 'conformance/fixtures/dashboard-graph/.planr');
const graphSchema = JSON.parse(
  readFileSync(join(root, 'schemas/v1.0.0/graph.schema.json'), 'utf-8'),
);
const bootstrapSchema = JSON.parse(
  readFileSync(join(root, 'schemas/v1.2.0/dashboard-bootstrap.schema.json'), 'utf-8'),
);

/** GET a path on 127.0.0.1:port; resolves { status, headers, body }. */
function request(port, path, headers = {}) {
  return new Promise((resolvePromise, reject) => {
    const req = get({ host: '127.0.0.1', port, path, headers }, (res) => {
      let body = '';
      res.setEncoding('utf-8');
      // SSE streams never "end"; resolve as soon as we have the headers + first frame.
      const isStream = (res.headers['content-type'] || '').includes('text/event-stream');
      res.on('data', (chunk) => {
        body += chunk;
        if (isStream) {
          req.destroy();
          resolvePromise({ status: res.statusCode, headers: res.headers, body });
        }
      });
      res.on('end', () => resolvePromise({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', (err) => {
      // A deliberate destroy() on the SSE stream surfaces as ECONNRESET — ignore it.
      if (err && err.code === 'ECONNRESET') return;
      reject(err);
    });
    req.setTimeout(4000, () => req.destroy(new Error('request timed out')));
  });
}

function rawRequest(port, bytes) {
  return new Promise((resolvePromise, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    let response = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.end(bytes));
    socket.on('data', (chunk) => { response += chunk; });
    socket.on('end', () => resolvePromise(response));
    socket.on('error', reject);
  });
}

function firstSseEnvelope(body) {
  const line = body.split('\n').find((entry) => entry.startsWith('data: '));
  assert.ok(line, 'SSE response must contain one data line');
  return JSON.parse(line.slice('data: '.length));
}

function dashboardFixture(parent, overrides = {}, { includeAssetDigests = false } = {}) {
  const staticRoot = join(parent, 'dashboard');
  mkdirSync(join(staticRoot, 'assets'), { recursive: true });
  writeFileSync(join(staticRoot, 'index.html'), '<main id="root"></main>\n');
  writeFileSync(join(staticRoot, 'assets/main.js'), 'globalThis.__OPENPLANR_DASHBOARD__ = true;\n');
  const manifest = {
    kind: 'openplanr-dashboard-build',
    schemaVersion: '1.0.0',
    buildId: 'dashboard-test-build',
    entry: 'index.html',
    assets: ['assets/main.js'],
    ...overrides,
  };
  if (includeAssetDigests) {
    manifest.assetDigests = Object.fromEntries(
      [manifest.entry, ...manifest.assets].sort().map((asset) => {
        const bytes = readFileSync(join(staticRoot, asset));
        return [asset, {
          bytes: bytes.byteLength,
          sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        }];
      }),
    );
  }
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(staticRoot, 'dashboard-manifest.json'), manifestBytes);
  return {
    staticRoot,
    manifest,
    manifestHash: `sha256:${createHash('sha256').update(manifestBytes).digest('hex')}`,
  };
}

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;

function experienceHistory(overrides = {}) {
  return {
    eventId: 'evt_test_0001', sequence: 1, type: 'cycle.started', entityId: 'cycle-1',
    actorKind: 'engine', actorId: 'openplanr', timestamp: '2026-08-11T08:00:00Z',
    correlationId: 'correlation-1', eventHash: HASH_A,
    change: { subjectKind: 'cycle', summary: 'Cycle started.' }, why: 'The owner started it.',
    authority: null, evidenceRefIds: [], prior: { previousEventHash: null, causationId: null },
    result: null, next: null, deepLinks: ['#/operate/cycles/cycle-1'], beforeAfter: null,
    ...overrides,
  };
}

function experienceMetric() {
  return {
    metricId: 'metric-retention', title: 'Retention rate', value: 91, unit: 'percent',
    change: { kind: 'changed', priorValue: 89, currentValue: 91, deltaValue: 2, deltaId: 'delta-retention' },
    window: '30 days', freshness: 'current', state: 'current', target: 93, threshold: 90,
    evidenceRefIds: [], snapshot: null, delta: null, dueVerification: [], accessReason: null,
  };
}

function experienceInboxItem() {
  return {
    itemId: 'verification:asg_reminder_delivery_0001',
    kind: 'verification',
    subjectId: 'asg_reminder_delivery_0001',
    ownerActorId: 'owner-acme',
    state: 'available',
    title: 'Verify reminder delivery',
    consequence: 'Delivery remains unverified until exact evidence is accepted.',
    expiresAt: null,
    blocking: false,
    evidence: [],
    requiredParties: [],
    redactions: [],
    actionLocator: null,
    navigationLocator: null,
    unavailableReason: {
      code: 'OPERATE_VERIFICATION_SUBMISSION_UNAVAILABLE',
      message: 'No exact owner-issued verification submission is available.',
    },
  };
}

function experienceCycle() {
  return {
    cycleId: 'cycle-1', state: 'approved', health: 'normal', focus: ['Audit transport'],
    createdAt: '2026-08-11T07:00:00Z', updatedAt: '2026-08-11T08:00:00Z',
    stages: ['observe', 'understand', 'decide', 'govern', 'act', 'verify', 'learn']
      .map((id, index) => ({
        id, state: index < 3 ? 'complete' : index === 3 ? 'current' : 'waiting',
        reason: null, inputArtifactIds: [], outputArtifactIds: [],
        gates: [], evidenceGapIds: [], uncertaintyIds: [], persistentActionIds: [],
      })),
    assignments: [], lensAbsences: [], executiveBoard: null, dependencies: [], blockers: [], persistentActionIds: [],
    replayCheckpoint: null, deepLink: '#/operate/cycles/cycle-1',
  };
}

function experienceView(overrides = {}) {
  const base = {
    kind: 'operate-experience-view', schemaVersion: '1.0.0', protocolVersion: '2.0.0',
    viewId: 'xview_1234567890abcdef1234567890abcdef', scopeId: 'scope-acme',
    domainId: 'business', domainVersion: '1.0.0', actorId: 'owner-acme', accessLevel: 'public',
    generatedAt: '2026-08-11T08:00:00Z', eventHead: { sequence: 1, hash: HASH_A },
    sourceStateHash: HASH_B, status: 'ready', attention: [], domainMetrics: [], cycles: [],
    inbox: [], actions: [], evidence: [], claims: [], rationale: [], outcomes: [], learnings: [],
    history: [experienceHistory()],
    replay: {
      checkpoint: null,
      tail: { startSequence: 1, endSequence: 1, eventCount: 1, eventReplayIndexHash: HASH_A },
      finalHead: { sequence: 1, hash: HASH_A }, liveAccessUsed: false,
      parityProof: {
        sourceStateHash: HASH_B, eventReplayIndexHash: HASH_A, checkpointVerified: false,
        finalEventHashMatches: true, stateParityVerified: true,
      },
      filterDimensions: ['cycle', 'actor', 'event-type'], redactions: [],
    },
    allowedActions: [],
    omissions: [], export: { formats: ['html', 'json'], accessSafe: true, redactionCount: 0 },
    ...overrides,
  };
  delete base.viewHash;
  return { ...base, viewHash: sha256Jcs(base) };
}

/** Probe /health like the dashboard preflight does; null when nothing answers. */
function probeHealth(port) {
  return new Promise((resolvePromise) => {
    const req = get({ host: '127.0.0.1', port, path: '/health' }, (res) => {
      let body = '';
      res.setEncoding('utf-8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolvePromise(parsed && parsed.ok === true ? parsed : null);
        } catch {
          resolvePromise(null);
        }
      });
    });
    req.on('error', () => resolvePromise(null));
    req.setTimeout(1500, () => { req.destroy(); resolvePromise(null); });
  });
}

test('dashboard server: /api/graph, /api/events SSE, and reuse-if-running', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-dash-server-'));
  const env = { ...process.env, PLANR_HOME: home };
  // watch:false keeps the test deterministic (no background fs.watch noise).
  const dash = createDashboardServer({ planrDir, watch: false });
  let port;
  try {
    port = await dash.listen(0, { env });

    // ── /api/graph → 200, application/json, schema-valid body ──────────────
    const graphRes = await request(port, '/api/graph');
    assert.equal(graphRes.status, 200, '/api/graph should answer 200');
    assert.match(
      graphRes.headers['content-type'] || '',
      /application\/json/,
      '/api/graph Content-Type should be application/json',
    );
    const graph = JSON.parse(graphRes.body);
    const errs = validate(graph, graphSchema);
    assert.equal(errs.length, 0, `/api/graph body must validate; errors: ${JSON.stringify(errs)}`);
    assert.ok(Array.isArray(graph.nodes) && graph.nodes.length > 0, 'graph should carry nodes');

    // ── /api/events → 200, text/event-stream ──────────────────────────────
    const eventsRes = await request(port, '/api/events');
    assert.equal(eventsRes.status, 200, '/api/events should answer 200');
    assert.match(
      eventsRes.headers['content-type'] || '',
      /text\/event-stream/,
      '/api/events Content-Type should be text/event-stream',
    );
    assert.match(eventsRes.body, /event: ready/, '/api/events should emit a ready event');

    // ── reuse-if-running: a /health probe answers and carries the kind + version
    //    a reuse decision requires, so a second launch reuses instead of binding.
    const health = await probeHealth(port);
    assert.ok(health && health.ok === true, '/health should answer { ok: true } for reuse detection');
    assert.equal(health.kind, 'openplanr-dashboard', '/health must name its server kind for safe reuse');
    assert.equal(typeof health.version, 'string', '/health must carry the package version for safe reuse');
    assert.equal(health.pid, process.pid, '/health must report the owning pid');
    assert.equal(
      dash.getOperatingCommandGateway(),
      null,
      'the standalone dashboard remains read-only until OpenPlanr injects a command gateway',
    );
    // The discovery port file the daemon wrote points at the running server.
    const portFile = join(home, 'dashboard-daemon', 'port');
    assert.equal(
      Number(readFileSync(portFile, 'utf-8').trim()),
      port,
      'the daemon should record its bound port for reuse discovery',
    );

    // ── contended bind: a second server on the SAME live port must reuse it,
    //    not throw EADDRINUSE. Port 0 (above) can never exercise this.
    const second = createDashboardServer({ planrDir, watch: false });
    const reusedPort = await second.listen(port, { env });
    assert.equal(reusedPort, port, 'a contended bind must resolve to the running port, not crash');
    assert.equal(second.reused, true, 'a contended bind must report reuse');
    assert.equal(second.ownerPid, process.pid, 'reuse must report the running server pid');
    await second.close();
  } finally {
    await dash.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('dashboard server: local operating reviews are bounded, paginated, and refresh without a gateway', async () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'planr-dash-local-operate-'));
  const projectPlanrDir = join(fixtureRoot, 'project', '.planr');
  const operateDir = join(projectPlanrDir, 'operate');
  const cycleId = '2026-09-14-modul-events';
  const cycleDir = join(operateDir, cycleId);
  const unsafeDir = join(operateDir, 'unsafe-cycle');
  mkdirSync(cycleDir, { recursive: true });
  mkdirSync(unsafeDir, { recursive: true });
  const firstReport = [
    '# Operating board report — Modul events',
    '',
    '## Scope',
    '- **Subject:** Modul events release operations',
    '- **Window:** current snapshot',
    '- **Requested decision:** periodic review',
    '- **Custody:** local-only',
    '',
    '## Executive summary',
    '**Overall signal: act now.** Act now on the release path.',
    '',
    '## Decision queue',
    '### D1 — [P0] Verify the CRM flow',
    '- **Recommendation:** Run the smoke test before engineering work.',
    '- **Why now:** A dated event depends on this flow.',
    '- **Suggested owner:** Asem',
    '- **First step:** Run `crm:smoke`.',
    '- **Expected result:** The test row reaches created.',
    '- **Check:** Inspect the admin row.',
    '- **Sources:** `docs/crm.md:12`',
    '',
    '## Action plan',
    '| ID | Priority | Action | Suggested owner | First step | Success measure | Check | Depends on |',
    '|---|---|---|---|---|---|---|---|',
    '| A1 | P0 | Run the smoke test | Asem | Run `crm:smoke` | Row is created | Inspect row | D1 |',
    '',
    '## Decision-changing gaps',
    '- **G1 — Live flow state:** Verify it with the smoke test.',
    '',
    '## Review coverage',
    '| Lens | Outcome | Note | Informed |',
    '|---|---|---|---|',
    '| CEO | reported (signal: action) | `ceo.md` | D1 |',
    '',
    '## Issues',
    '- **I1 — Wrapper:** exits one after a clean validation.',
    '',
  ].join('\n');
  writeFileSync(join(cycleDir, 'board-report.md'), firstReport);
  const privateFile = join(fixtureRoot, 'private-report.md');
  writeFileSync(privateFile, '# must never be served\nprivate-marker\n');
  symlinkSync(privateFile, join(cycleDir, 'ceo.md'));
  symlinkSync(privateFile, join(unsafeDir, 'board-report.md'));
  const fixture = dashboardFixture(fixtureRoot, {}, { includeAssetDigests: true });
  const dash = createDashboardServer({
    staticRoot: fixture.staticRoot,
    dashboardBuildId: fixture.manifest.buildId,
    planrDir: projectPlanrDir,
    watch: false,
  });
  try {
    const port = await dash.listen(0, {
      env: { ...process.env, PLANR_HOME: join(fixtureRoot, 'home') },
    });
    const indexResponse = await request(port, '/api/operate/local-reviews?page=1&pageSize=10');
    assert.equal(indexResponse.status, 200);
    assert.equal(indexResponse.headers['cache-control'], 'no-store');
    const index = JSON.parse(indexResponse.body);
    assert.equal(index.kind, 'local-operate-review-index');
    assert.equal(index.readOnly, true);
    assert.deepEqual(index.pagination, { page: 1, pageSize: 10, pageCount: 1, total: 1 });
    assert.equal(index.items[0].cycleId, cycleId);
    assert.equal(index.items[0].counts.decisions, 1);
    assert.equal(index.items[0].counts.actions, 1);
    assert.equal(index.items[0].counts.gaps, 1);
    assert.equal(index.items[0].counts.issues, 1);
    assert.equal(index.items[0].signal, 'act now');
    assert.equal(indexResponse.body.includes(fixtureRoot), false);
    assert.equal(indexResponse.body.includes('private-marker'), false);

    const detailPath = `/api/operate/local-reviews/${encodeURIComponent(cycleId)}`;
    const detailResponse = await request(port, detailPath);
    assert.equal(detailResponse.status, 200);
    const detail = JSON.parse(detailResponse.body);
    assert.equal(detail.kind, 'local-operate-review');
    assert.equal(detail.readOnly, true);
    assert.equal(detail.item.markdown, firstReport);
    assert.equal(detail.item.decisions[0].priority, 'P0');
    assert.equal(detail.item.decisions[0].owner, 'Asem');
    assert.equal(detail.item.actions[0].firstStep, 'Run crm:smoke');
    assert.equal(detail.item.gaps[0].id, 'G1');
    assert.equal(detail.item.lenses[0].signal, 'action');
    assert.equal(detail.item.lenses[0].present, false);
    assert.equal(detail.item.evidence[0].reference, 'docs/crm.md:12');
    assert.equal(detailResponse.body.includes('private-marker'), false);
    assert.equal(detail.item.recovery.complete, false);

    const updatedReport = firstReport.replace('Act now on the release path.', 'Act now; CRM is verified.');
    writeFileSync(join(cycleDir, 'board-report.md'), updatedReport);
    const refreshed = JSON.parse((await request(port, detailPath)).body);
    assert.equal(refreshed.item.markdown, updatedReport);

    const malformed = await request(port, '/api/operate/local-reviews?page=1&page=2');
    assert.equal(malformed.status, 400);
    const traversal = await request(port, '/api/operate/local-reviews/%2e%2e');
    assert.equal(traversal.status, 400);
  } finally {
    await dash.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('dashboard server: Operate REST/SSE requires exact binding and fails stale on gaps', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-dash-operate-'));
  let current = experienceView();
  const dash = createDashboardServer({
    planrDir,
    watch: false,
    getOperatingExperience: () => ({
      available: true, readOnly: true, status: 'ready', view: current, reasonCodes: [],
    }),
  });
  const query = 'scopeId=scope-acme&domainId=business&domainVersion=1.0.0';
  const actorHeaders = { 'X-OpenPlanr-Actor': 'owner-acme' };
  try {
    const port = await dash.listen(0, { env: { ...process.env, PLANR_HOME: home } });
    const today = await request(port, `/api/operate/today?${query}`, actorHeaders);
    assert.equal(today.status, 200);
    assert.match(today.headers['cache-control'] || '', /no-store/);
    const todayDisplay = JSON.parse(today.body);
    assert.equal(assertOperateExperienceDisplaySurfaceV1(todayDisplay, {
      actorId: 'owner-acme',
      scopeId: 'scope-acme',
      domainId: 'business',
      domainVersion: '1.0.0',
      generatedAt: current.generatedAt,
      eventHead: current.eventHead,
      viewHash: current.viewHash,
      surface: 'today',
    }), todayDisplay);
    assert.deepEqual(todayDisplay.payload, {
      ok: true,
      kind: 'operate-experience-surface',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      surface: 'today',
      readOnly: true,
      mutationEnabled: true,
      scopeId: 'scope-acme',
      domainId: 'business',
      domainVersion: '1.0.0',
      actorId: 'owner-acme',
      accessLevel: 'public',
      generatedAt: current.generatedAt,
      eventHead: current.eventHead,
      viewHash: current.viewHash,
      truthSummary: {
        ...deriveOperateSharedTruthSummaryV1(current),
        sourceEventHead: current.eventHead,
        sourceViewHash: current.viewHash,
      },
      status: 'ready',
      reasonCodes: [],
      data: {
        attention: [], domainMetrics: [], activeCycle: null, inbox: [], actions: [],
        outcomes: [], allowedActions: [],
      },
    });

    const missing = await request(port, '/api/operate/today');
    assert.equal(missing.status, 400);
    assert.equal(JSON.parse(missing.body).error.reasonCode, 'OPERATE_BINDING_REQUIRED');
    const privateIdentity = 'private-approver-must-not-leak';
    for (const key of [
      'actorId', 'ACTORID', 'actor_id', 'current-actor-id', 'OwnerActorId',
      'approver', 'APPROVER_ID', 'userId', 'principal-id', 'X-OpenPlanr-Actor',
    ]) {
      const urlActor = await request(
        port,
        `/api/operate/today?${encodeURIComponent(key)}=${privateIdentity}&${query}`,
        actorHeaders,
      );
      assert.equal(urlActor.status, 400, `${key} identities in URLs are not accepted`);
      assert.match(urlActor.headers['cache-control'] || '', /no-store/);
      assert.equal(urlActor.headers.location, undefined);
      assert.equal(urlActor.body.includes(privateIdentity), false);
      assert.deepEqual(JSON.parse(urlActor.body).error, {
        reasonCode: 'OPERATE_QUERY_INVALID',
        message: 'The operating route accepts only its documented query fields.',
        retryable: false,
      });
    }
    const foreign = await request(
      port,
      `/api/operate/today?${query.replace('scope-acme', 'scope-foreign')}`,
      actorHeaders,
    );
    assert.equal(foreign.status, 403);
    assert.equal(JSON.stringify(JSON.parse(foreign.body)).includes('scope-acme'), false);

    const snapshot = await request(port, `/api/operate/events?${query}&generation=7`, actorHeaders);
    assert.equal(snapshot.status, 200);
    assert.match(snapshot.body, /event: snapshot/);
    assert.match(snapshot.body, new RegExp(current.viewHash));
    const snapshotEnvelope = firstSseEnvelope(snapshot.body);
    assert.equal(snapshotEnvelope.kind, 'dashboard-live-event');
    assert.equal(snapshotEnvelope.event, 'snapshot');
    assert.equal(snapshotEnvelope.binding.generation, 7);
    assert.match(snapshotEnvelope.binding.projectId, /^sha256:[a-f0-9]{64}$/u);
    assert.deepEqual(snapshotEnvelope.cursor, {
      eventHead: current.eventHead, viewHash: current.viewHash,
    });
    assert.equal(snapshotEnvelope.payload.kind, 'operate-experience-display-surface');
    assert.equal(snapshotEnvelope.payload.payload.surface, 'today');
    assert.deepEqual(snapshotEnvelope.payload, todayDisplay);

    const missingGeneration = await request(port, `/api/operate/events?${query}`, actorHeaders);
    assert.equal(missingGeneration.status, 400);
    assert.match(missingGeneration.headers['content-type'] || '', /application\/json/u);
    assert.equal(missingGeneration.body.includes('event:'), false);
    assert.equal(missingGeneration.body.includes(privateIdentity), false);
    assert.equal(JSON.parse(missingGeneration.body).error.reasonCode, 'OPERATE_GENERATION_INVALID');

    const invalidGeneration = await request(
      port,
      `/api/operate/events?${query}&generation=unsafe`,
      actorHeaders,
    );
    assert.equal(invalidGeneration.status, 400);
    assert.equal(JSON.parse(invalidGeneration.body).error.reasonCode, 'OPERATE_GENERATION_INVALID');

    const checkpoint = encodeOperateExperienceCheckpoint(current);
    const ready = await request(port, `/api/operate/events?${query}&generation=7`, {
      ...actorHeaders,
      'Last-Event-ID': checkpoint,
    });
    assert.match(ready.body, /event: ready/);
    assert.deepEqual(firstSseEnvelope(ready.body).binding, snapshotEnvelope.binding);

    current = experienceView({
      eventHead: { sequence: 2, hash: HASH_B },
      sourceStateHash: HASH_A,
      domainMetrics: [experienceMetric()],
      history: [experienceHistory({
        eventId: 'evt_private_approver_0001',
        sequence: 2,
        type: 'review.submitted',
        entityId: 'rev_private_approver_0001',
        actorKind: 'human',
        actorId: 'restricted-actor',
        timestamp: '2026-08-11T08:01:00Z',
        correlationId: 'corr_private_approver_0001',
        eventHash: HASH_B,
        prior: { previousEventHash: HASH_A, causationId: null },
      })],
      replay: {
        ...current.replay,
        tail: { startSequence: 1, endSequence: 2, eventCount: 2, eventReplayIndexHash: HASH_B },
        finalHead: { sequence: 2, hash: HASH_B },
        parityProof: {
          ...current.replay.parityProof,
          sourceStateHash: HASH_A,
          eventReplayIndexHash: HASH_B,
        },
      },
    });
    dash.refreshOperatingExperience();
    const patched = await request(port, `/api/operate/events?${query}&generation=7`, {
      ...actorHeaders,
      'Last-Event-ID': checkpoint,
    });
    assert.match(patched.body, /event: patch/);
    assert.match(patched.body, new RegExp(current.viewHash));
    assert.match(patched.body, /"sequence":2/);
    assert.match(patched.body, /\/domainMetrics/);
    assert.equal(patched.body.includes('metric-retention'), false);
    assert.equal(patched.body.includes('restricted-actor'), false);
    assert.equal(patched.body.includes(privateIdentity), false);
    const patchEnvelope = firstSseEnvelope(patched.body);
    assert.equal(patchEnvelope.event, 'patch');
    assert.deepEqual(Object.keys(patchEnvelope.payload).sort(), [
      'changedPaths', 'from', 'patchHash', 'patchId', 'to',
    ]);
    assert.deepEqual(patchEnvelope.payload.changedPaths, ['/domainMetrics', '/history', '/replay']);
    assert.equal(Object.hasOwn(patchEnvelope.payload, 'operations'), false);
    assert.deepEqual(patchEnvelope.cursor, {
      eventHead: current.eventHead, viewHash: current.viewHash,
    });

    const prior = encodeOperateExperienceCheckpoint({
      eventHead: { sequence: 0, hash: null }, viewHash: `sha256:${'c'.repeat(64)}`,
    });
    const stale = await request(port, `/api/operate/events?${query}&generation=7`, {
      ...actorHeaders,
      'Last-Event-ID': prior,
    });
    assert.match(stale.body, /event: stale/);
    assert.match(stale.body, /OPERATE_EVENT_GAP/);
    assert.match(stale.body, /"mutationEnabled":false/);
    assert.equal(firstSseEnvelope(stale.body).event, 'stale');
  } finally {
    await dash.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('dashboard server: Inbox detail returns one exact itemId-bound display', async () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'planr-dash-operate-inbox-item-'));
  const home = join(fixtureRoot, 'home');
  const fixture = dashboardFixture(fixtureRoot, {}, { includeAssetDigests: true });
  const item = experienceInboxItem();
  const current = experienceView({ inbox: [item] });
  const dash = createDashboardServer({
    staticRoot: fixture.staticRoot,
    dashboardBuildId: fixture.manifest.buildId,
    planrDir,
    watch: false,
    getOperatingExperience: () => ({
      available: true, readOnly: true, status: 'ready', view: current, reasonCodes: [],
    }),
  });
  const actorHeaders = { 'X-OpenPlanr-Actor': 'owner-acme' };
  try {
    const port = await dash.listen(0, { env: { ...process.env, PLANR_HOME: home } });
    const bootstrap = JSON.parse((await request(port, '/api/bootstrap')).body);
    const projectId = bootstrap.project.projectId;
    const query = new URLSearchParams({
      scopeId: current.scopeId,
      domainId: current.domainId,
      domainVersion: current.domainVersion,
      projectId,
      generation: '3',
    }).toString();
    const path = `/api/operate/inbox/${encodeURIComponent(item.itemId)}?${query}`;
    const response = await request(port, path, actorHeaders);
    assert.equal(response.status, 200);
    const display = JSON.parse(response.body);
    const expected = {
      actorId: current.actorId,
      scopeId: current.scopeId,
      domainId: current.domainId,
      domainVersion: current.domainVersion,
      generatedAt: current.generatedAt,
      eventHead: current.eventHead,
      viewHash: current.viewHash,
      surface: 'inbox',
      projectId,
      generation: 3,
      subjectId: item.itemId,
    };
    assert.equal(assertOperateExperienceDisplaySurfaceV1(display, expected), display);
    assert.deepEqual(display.payload.data.inbox, [item]);
    assert.deepEqual(display.payload.data.requestBinding, {
      projectId, generation: 3, subjectId: item.itemId,
    });

    const collection = await request(port, `/api/operate/inbox?${query}`, actorHeaders);
    assert.equal(collection.status, 200);
    assert.deepEqual(JSON.parse(collection.body).payload.data.requestBinding, {
      projectId, generation: 3, subjectId: null,
    });

    const missingId = 'verification:asg_foreign_0001';
    const missing = await request(
      port,
      `/api/operate/inbox/${encodeURIComponent(missingId)}?${query}`,
      actorHeaders,
    );
    assert.equal(missing.status, 404);
    assert.equal(JSON.parse(missing.body).error.reasonCode, 'OPERATE_SUBJECT_NOT_FOUND');
    assert.equal(missing.body.includes(missingId), false);

    const foreignQuery = new URLSearchParams({
      scopeId: current.scopeId,
      domainId: current.domainId,
      domainVersion: current.domainVersion,
      projectId: HASH_A,
      generation: '3',
    }).toString();
    const foreignProject = await request(
      port,
      `/api/operate/inbox/${encodeURIComponent(item.itemId)}?${foreignQuery}`,
      actorHeaders,
    );
    assert.equal(foreignProject.status, 403);
    assert.equal(JSON.parse(foreignProject.body).error.reasonCode, 'OPERATE_BINDING_MISMATCH');
  } finally {
    await dash.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('dashboard server: missing live generation is rejected before provider or stream publication', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-dash-live-generation-'));
  let providerReads = 0;
  const privateIdentity = 'private-provider-identity-must-not-leak';
  const dash = createDashboardServer({
    planrDir,
    watch: false,
    getOperatingExperience: () => {
      providerReads += 1;
      throw new Error(privateIdentity);
    },
  });
  try {
    const port = await dash.listen(0, { env: { ...process.env, PLANR_HOME: home } });
    const response = await request(
      port,
      '/api/operate/events?scopeId=scope-acme&domainId=business&domainVersion=1.0.0',
      { 'X-OpenPlanr-Actor': 'owner-acme' },
    );
    assert.equal(response.status, 400);
    assert.match(response.headers['content-type'] || '', /application\/json/u);
    assert.equal(providerReads, 0);
    assert.equal(response.body.includes('event:'), false);
    assert.equal(response.body.includes(privateIdentity), false);
    assert.equal(JSON.parse(response.body).error.reasonCode, 'OPERATE_GENERATION_INVALID');
  } finally {
    await dash.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('dashboard server: noncanonical live checkpoints fail before replay or provider publication', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-dash-live-checkpoint-'));
  let providerReads = 0;
  const privateMarker = 'private-checkpoint-member-must-not-leak';
  const dash = createDashboardServer({
    planrDir,
    watch: false,
    getOperatingExperience: () => {
      providerReads += 1;
      throw new Error(privateMarker);
    },
  });
  const encoded = (value) => Buffer.from(value, 'utf8').toString('base64url');
  const canonical = encodeOperateExperienceCheckpoint({
    eventHead: { sequence: 1, hash: HASH_A }, viewHash: HASH_B,
  });
  const hostile = [
    encoded(`{"sequence":0,"sequence":1,"hash":"${HASH_A}","viewHash":"${HASH_B}"}`),
    encoded(`{"sequence":1,"hash":"${HASH_A}","viewHash":"${HASH_B}","private":"${privateMarker}"}`),
    encoded(`{"hash":"${HASH_A}","sequence":1,"viewHash":"${HASH_B}"}`),
    `${canonical}=`,
  ];
  const path = '/api/operate/events?scopeId=scope-acme&domainId=business&domainVersion=1.0.0&generation=4';
  try {
    const port = await dash.listen(0, { env: { ...process.env, PLANR_HOME: home } });
    for (const checkpoint of hostile) {
      const response = await request(port, path, {
        'X-OpenPlanr-Actor': 'owner-acme',
        'Last-Event-ID': checkpoint,
      });
      assert.equal(response.status, 400);
      assert.equal(JSON.parse(response.body).error.reasonCode, 'OPERATE_CHECKPOINT_INVALID');
      assert.equal(response.body.includes(privateMarker), false);
      assert.equal(response.body.includes('event:'), false);
    }
    const duplicateHeader = await rawRequest(
      port,
      `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nX-OpenPlanr-Actor: owner-acme\r\nLast-Event-ID: ${canonical}\r\nLast-Event-ID: ${canonical}\r\nConnection: close\r\n\r\n`,
    );
    assert.match(duplicateHeader, /^HTTP\/1\.1 400/u);
    assert.equal(duplicateHeader.includes(privateMarker), false);
    assert.equal(providerReads, 0);
  } finally {
    await dash.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('dashboard server: valid live reads and generic failures never echo provider errors', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-dash-provider-error-'));
  const privateMarker = 'private-provider-error-must-not-leak';
  const dash = createDashboardServer({
    planrDir,
    watch: false,
    getOperatingExperience: () => { throw new Error(privateMarker); },
    getGraph: () => { throw new Error(privateMarker); },
  });
  try {
    const port = await dash.listen(0, { env: { ...process.env, PLANR_HOME: home } });
    const live = await request(
      port,
      '/api/operate/events?scopeId=scope-acme&domainId=business&domainVersion=1.0.0&generation=1',
      { 'X-OpenPlanr-Actor': 'owner-acme' },
    );
    assert.equal(live.status, 409);
    assert.equal(live.body.includes(privateMarker), false);
    assert.equal(JSON.parse(live.body).error.reasonCode, 'OPERATE_PROJECTION_INVALID');

    const graph = await request(port, '/api/graph');
    assert.equal(graph.status, 500);
    assert.equal(graph.body.includes(privateMarker), false);
    assert.deepEqual(JSON.parse(graph.body), { error: 'dashboard request unavailable' });
  } finally {
    await dash.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('dashboard server: raw provider history is rebound to one safe REST/SSE transport view', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-dash-operate-unsafe-'));
  const privateIdentity = 'private-approver-must-not-leak';
  const unsafe = experienceView({
    cycles: [experienceCycle()],
    history: [experienceHistory({
      eventId: 'evt_private_approver_0001', sequence: 1, type: 'review.submitted',
      entityId: 'rev_private_approver_0001', actorKind: 'human', actorId: privateIdentity,
      timestamp: '2026-08-11T08:00:00Z', correlationId: 'corr_private_approver_0001',
      eventHash: HASH_A,
    })],
  });
  const dash = createDashboardServer({
    planrDir,
    watch: false,
    getOperatingExperience: () => ({
      available: true, readOnly: true, status: 'ready', view: unsafe, reasonCodes: [],
    }),
  });
  const query = 'scopeId=scope-acme&domainId=business&domainVersion=1.0.0';
  const headers = { 'X-OpenPlanr-Actor': 'owner-acme' };
  try {
    const port = await dash.listen(0, { env: { ...process.env, PLANR_HOME: home } });
    const history = await request(port, `/api/operate/history?${query}&cycleId=cycle-1`, headers);
    assert.equal(history.status, 200);
    assert.equal(history.body.includes(privateIdentity), false);
    assert.match(history.body, /restricted-actor/);
    const today = await request(port, `/api/operate/today?${query}`, headers);
    assert.equal(today.status, 200, today.body);
    const events = await request(port, `/api/operate/events?${query}&generation=9`, headers);
    assert.equal(events.status, 200);
    assert.equal(events.body.includes(privateIdentity), false);
    assert.match(events.body, /event: snapshot/);
  } finally {
    await dash.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('dashboard server: every Operate route rejects unknown query keys before provider access', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-dash-operate-queries-'));
  let providerReads = 0;
  const current = experienceView({ cycles: [experienceCycle()] });
  const dash = createDashboardServer({
    planrDir,
    watch: false,
    getOperatingExperience: () => {
      providerReads += 1;
      return { available: true, readOnly: true, status: 'ready', view: current, reasonCodes: [] };
    },
  });
  const bindingQuery = 'scopeId=scope-acme&domainId=business&domainVersion=1.0.0';
  const headers = { 'X-OpenPlanr-Actor': 'owner-acme' };
  const routes = [
    'today', 'cycles', 'cycles/cycle-1', 'cycle/cycle-1', 'evidence', 'outcomes',
    'outcomes/outcome-1', 'outcome/outcome-1', 'history', 'search', 'export', 'events',
  ];
  const adversarialKeys = [
    'ReviewerId', 'reviewer%49d', 'agentId', 'party-id', 'namedActorId', 'member_id',
    'email', 'ActorId', '%61ctorId', 'scopeid', 'domainversion', 'unknown',
  ];
  const privateIdentity = 'private-query-identity-must-not-echo';
  try {
    const port = await dash.listen(0, { env: { ...process.env, PLANR_HOME: home } });
    for (const route of routes) {
      for (const key of adversarialKeys) {
        const response = await request(
          port,
          `/api/operate/${route}?${key}=${privateIdentity}&${bindingQuery}`,
          headers,
        );
        assert.equal(response.status, 400, `${route} must close ${key}`);
        assert.match(response.headers['cache-control'] || '', /no-store/);
        assert.equal(response.headers.location, undefined);
        assert.equal(response.body.includes(privateIdentity), false);
        assert.equal(JSON.parse(response.body).error.reasonCode, 'OPERATE_QUERY_INVALID');
      }
    }
    for (const [route, key] of [['today', 'q'], ['history', 'format']]) {
      const response = await request(
        port,
        `/api/operate/${route}?${key}=safe&${bindingQuery}`,
        headers,
      );
      assert.equal(response.status, 400);
    }
    const duplicate = await request(
      port,
      `/api/operate/today?scopeId=scope-acme&${bindingQuery}`,
      headers,
    );
    assert.equal(duplicate.status, 400);
    assert.equal(providerReads, 0, 'invalid queries must not reach the projection provider');

    const search = await request(
      port,
      `/api/operate/search?q=retention&cycleId=cycle-1&${bindingQuery}`,
      headers,
    );
    const exported = await request(
      port,
      `/api/operate/export?format=json&cycleId=cycle-1&${bindingQuery}`,
      headers,
    );
    assert.equal(search.status, 200);
    assert.equal(exported.status, 200);
    assert.equal(providerReads, 1, 'the validated view is cached after the first allowed lookup');
  } finally {
    await dash.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('dashboard server: exact Operate route grammar rejects malformed paths before provider access', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-dash-operate-paths-'));
  let providerReads = 0;
  const current = experienceView();
  const dash = createDashboardServer({
    planrDir,
    watch: false,
    getOperatingExperience: () => {
      providerReads += 1;
      return { available: true, readOnly: true, status: 'ready', view: current, reasonCodes: [] };
    },
  });
  const query = 'scopeId=scope-acme&domainId=business&domainVersion=1.0.0';
  const headers = { 'X-OpenPlanr-Actor': 'owner-acme' };
  const privateIdentity = 'private-route-identity-must-not-echo';
  const singletonRoutes = ['today', 'history', 'search', 'export', 'events'];
  const invalidPaths = [
    ...singletonRoutes.map((route) => `${route}/${privateIdentity}`),
    'cycles/cycle-1/extra', 'outcomes/outcome-1/extra',
    'cycle', 'outcome', 'cycle/', 'outcome/', 'cycle//cycle-1',
    'cycle/.', 'cycle/..', 'cycle/%2E', 'cycle/%2E%2E',
    `cycle/cycle-1%2F${privateIdentity}`,
    `cycles/cycle-1%2f${privateIdentity}`,
    'cycle/%252F', 'Today', 'Cycles', 'Outcome/outcome-1',
    '%74oday', `today%2F${privateIdentity}`, 'cycles%2Fcycle-1',
  ];
  try {
    const port = await dash.listen(0, { env: { ...process.env, PLANR_HOME: home } });
    for (const path of invalidPaths) {
      const response = await request(port, `/api/operate/${path}?${query}`, headers);
      assert.equal(response.status, 400, `${path} must fail the closed route grammar`);
      assert.match(response.headers['cache-control'] || '', /no-store/);
      assert.equal(response.headers.location, undefined);
      assert.equal(response.body.includes(privateIdentity), false);
      assert.deepEqual(JSON.parse(response.body).error, {
        reasonCode: 'OPERATE_ROUTE_INVALID',
        message: 'The operating route does not match a documented surface shape.',
        retryable: false,
      }, path);
    }
    assert.equal(providerReads, 0, 'invalid paths must not reach the projection provider');

    const collection = await request(port, `/api/operate/cycles?${query}`, headers);
    const detail = await request(port, `/api/operate/cycles/cycle-1?${query}`, headers);
    const alias = await request(port, `/api/operate/cycle/cycle-1?${query}`, headers);
    assert.equal(collection.status, 200);
    assert.equal(detail.status, 409);
    assert.equal(alias.status, 409);
    assert.equal(JSON.parse(detail.body).error.reasonCode, 'OPERATE_PROJECTION_UNAVAILABLE');
    assert.equal(JSON.parse(alias.body).error.reasonCode, 'OPERATE_PROJECTION_UNAVAILABLE');
    assert.equal(providerReads, 1, 'schema-valid paths share the validated cached provider view');
  } finally {
    await dash.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('dashboard server: bootstrap binds manifest, origin, project, and semantic protocol identity', async () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'planr-dash-bootstrap-'));
  const home = join(fixtureRoot, 'home');
  const projectRoot = join(fixtureRoot, 'project-private-name');
  const projectPlanrDir = join(projectRoot, '.planr');
  mkdirSync(projectPlanrDir, { recursive: true });
  writeFileSync(join(projectPlanrDir, 'config.json'), JSON.stringify({ projectName: 'Public dogfood' }));
  const fixture = dashboardFixture(fixtureRoot, {}, { includeAssetDigests: true });
  let gatewayReads = 0;
  const dash = createDashboardServer({
    staticRoot: fixture.staticRoot,
    dashboardBuildId: fixture.manifest.buildId,
    planrDir: projectPlanrDir,
    watch: false,
    getOperatingCommandGateway: () => {
      gatewayReads += 1;
      return null;
    },
  });
  try {
    const port = await dash.listen(0, { env: { ...process.env, PLANR_HOME: home } });
    const numeric = await request(port, '/api/bootstrap');
    assert.equal(numeric.status, 200);
    assert.equal(numeric.headers['cache-control'], 'no-store');
    const bootstrap = JSON.parse(numeric.body);
    assert.equal(validate(bootstrap, bootstrapSchema).length, 0);
    assert.equal(validateProtocolArtifact('dashboard-bootstrap', bootstrap, {
      protocolVersion: '1.2.0',
    }).length, 0);
    assert.equal(validateDashboardBootstrapV1(bootstrap).length, 0);
    assert.equal(bootstrap.origin, `http://127.0.0.1:${port}`);
    assert.equal(bootstrap.ui.buildId, fixture.manifest.buildId);
    assert.equal(bootstrap.ui.expectedBuildId, fixture.manifest.buildId);
    assert.equal(bootstrap.ui.assetManifestHash, fixture.manifestHash);
    assert.match(bootstrap.project.projectId, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(bootstrap.project.name, 'Public dogfood');
    assert.deepEqual(new Set(bootstrap.project.products), new Set(['planning', 'operate']));
    assert.equal(numeric.body.includes(projectRoot), false, 'bootstrap must not disclose its project path');
    assert.equal(numeric.body.includes('project-private-name'), false, 'bootstrap must not disclose a private basename');

    const localhost = await request(port, '/api/bootstrap', { Host: `localhost:${port}` });
    assert.equal(localhost.status, 200);
    assert.equal(JSON.parse(localhost.body).origin, `http://localhost:${port}`);

    const semanticMismatch = structuredClone(bootstrap);
    semanticMismatch.ui.expectedBuildId = 'dashboard-foreign-build';
    assert.equal(validate(semanticMismatch, bootstrapSchema).length, 0, 'equality is a semantic invariant');
    assert.notEqual(validateDashboardBootstrapV1(semanticMismatch).length, 0);
    assert.throws(() => assertDashboardBootstrapV1(semanticMismatch), {
      code: 'E_PROTOCOL_ARTIFACT_INVALID',
    });
    const controlName = structuredClone(bootstrap);
    controlName.project.name = 'Public\nname';
    assert.notEqual(validate(controlName, bootstrapSchema).length, 0);
    assert.notEqual(validateDashboardBootstrapV1(controlName).length, 0);
    assert.equal(gatewayReads, 1, 'the validated command capability is resolved once and cached');
  } finally {
    await dash.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('dashboard server: bootstrap rejects duplicate and wrong-port Host before capability access', async () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'planr-dash-bootstrap-host-'));
  const fixture = dashboardFixture(fixtureRoot);
  let gatewayReads = 0;
  const dash = createDashboardServer({
    staticRoot: fixture.staticRoot,
    dashboardBuildId: fixture.manifest.buildId,
    planrDir,
    watch: false,
    getOperatingCommandGateway: () => {
      gatewayReads += 1;
      return null;
    },
  });
  try {
    const port = await dash.listen(0, {
      env: { ...process.env, PLANR_HOME: join(fixtureRoot, 'home') },
    });
    const wrongPort = await request(port, '/api/bootstrap', { Host: '127.0.0.1:9999' });
    assert.equal(wrongPort.status, 400);
    const duplicate = await rawRequest(
      port,
      `GET /api/bootstrap HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`,
    );
    assert.match(duplicate, /^HTTP\/1\.1 400/u);
    assert.equal(gatewayReads, 0, 'invalid Host input must fail before capability discovery');

    const privateMarker = 'private-provider-failure-must-not-leak';
    const throwing = createDashboardServer({
      staticRoot: fixture.staticRoot,
      dashboardBuildId: fixture.manifest.buildId,
      planrDir,
      watch: false,
      getOperatingCommandGateway: () => { throw new Error(privateMarker); },
    });
    try {
      const throwingPort = await throwing.listen(0, {
        env: { ...process.env, PLANR_HOME: join(fixtureRoot, 'home-throwing') },
      });
      const response = await request(throwingPort, '/api/bootstrap');
      assert.equal(response.status, 200);
      assert.equal(JSON.parse(response.body).capabilities.operateCommands.available, false);
      assert.equal(response.body.includes(privateMarker), false);
    } finally {
      await throwing.close();
    }
  } finally {
    await dash.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('dashboard server: every route enforces loopback Host and mutation Origin', async () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'planr-dash-global-boundary-'));
  const fixture = dashboardFixture(fixtureRoot);
  const dash = createDashboardServer({
    staticRoot: fixture.staticRoot,
    dashboardBuildId: fixture.manifest.buildId,
    planrDir,
    watch: false,
  });
  try {
    const port = await dash.listen(0, {
      env: { ...process.env, PLANR_HOME: join(fixtureRoot, 'home') },
    });
    for (const route of ['/', '/assets/main.js', '/api/graph', '/api/events']) {
      const response = await request(port, route, { Host: 'attacker.example' });
      assert.equal(response.status, 400, `${route} must reject a foreign Host`);
    }
    const hostileMutation = await rawRequest(
      port,
      `POST /api/graph HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: https://attacker.example\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
    );
    assert.match(hostileMutation, /^HTTP\/1\.1 400/u);

    const localMutation = await rawRequest(
      port,
      `POST /api/graph HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: http://127.0.0.1:${port}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
    );
    assert.match(localMutation, /^HTTP\/1\.1 404/u);
  } finally {
    await dash.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('dashboard server: bootstrap reports closed manifest failures and collision-resistant project IDs', async () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'planr-dash-bootstrap-states-'));
  const staticRoot = dashboardFixture(fixtureRoot).staticRoot;
  const cases = [
    [['DASHBOARD_BUILD_MISMATCH'], () => {}, 'dashboard-other-build'],
    [['DASHBOARD_MANIFEST_MISSING', 'DASHBOARD_BUILD_MISMATCH'],
      () => rmSync(join(staticRoot, 'dashboard-manifest.json')), 'dashboard-test-build'],
    [['DASHBOARD_MANIFEST_INVALID', 'DASHBOARD_BUILD_MISMATCH'],
      () => writeFileSync(join(staticRoot, 'dashboard-manifest.json'), '{'), 'dashboard-test-build'],
    [['DASHBOARD_ASSET_MISSING'], () => {
      dashboardFixture(fixtureRoot, { assets: ['assets/missing.js'] });
    }, undefined],
    [['DASHBOARD_MANIFEST_INVALID'], () => {
      dashboardFixture(fixtureRoot, {}, { includeAssetDigests: true });
      writeFileSync(join(staticRoot, 'assets/main.js'), 'globalThis.__TAMPERED__ = true;\n');
    }, undefined],
    [['DASHBOARD_MANIFEST_INVALID'], () => {
      dashboardFixture(fixtureRoot, {}, { includeAssetDigests: true });
      writeFileSync(join(staticRoot, 'index.html'), '<main id="tampered"></main>\n');
    }, undefined],
    [['DASHBOARD_MANIFEST_INVALID'], () => {
      const fixture = dashboardFixture(fixtureRoot, {}, { includeAssetDigests: true });
      delete fixture.manifest.assetDigests['index.html'];
      writeFileSync(
        join(staticRoot, 'dashboard-manifest.json'),
        `${JSON.stringify(fixture.manifest, null, 2)}\n`,
      );
    }, undefined],
    [['DASHBOARD_MANIFEST_INVALID'], () => {
      const fixture = dashboardFixture(fixtureRoot, {}, { includeAssetDigests: true });
      fixture.manifest.assetDigests['assets/main.js'].privateField = true;
      writeFileSync(
        join(staticRoot, 'dashboard-manifest.json'),
        `${JSON.stringify(fixture.manifest, null, 2)}\n`,
      );
    }, undefined],
  ];
  try {
    for (const [reasons, mutate, dashboardBuildId] of cases) {
      dashboardFixture(fixtureRoot);
      mutate();
      const dash = createDashboardServer({ staticRoot, dashboardBuildId, planrDir, watch: false });
      try {
        const port = await dash.listen(0, {
          env: { ...process.env, PLANR_HOME: join(fixtureRoot, `home-${reasons[0]}`) },
        });
        const response = await request(port, '/api/bootstrap');
        assert.equal(response.status, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.compatibility.status, 'incompatible');
        assert.deepEqual(body.compatibility.reasonCodes, reasons);
        assert.equal(
          validateDashboardBootstrapV1(body).length,
          0,
          `${reasons.join('+')} must be semantically valid`,
        );
      } finally {
        await dash.close();
      }
    }

    const ids = [];
    for (const suffix of ['one', 'two']) {
      const projectPlanrDir = join(fixtureRoot, suffix, '.planr');
      mkdirSync(projectPlanrDir, { recursive: true });
      writeFileSync(join(projectPlanrDir, 'config.json'), JSON.stringify({ projectName: 'Same public name' }));
      const dash = createDashboardServer({ staticRoot, planrDir: projectPlanrDir, watch: false });
      try {
        const port = await dash.listen(0, {
          env: { ...process.env, PLANR_HOME: join(fixtureRoot, `home-project-${suffix}`) },
        });
        ids.push(JSON.parse((await request(port, '/api/bootstrap')).body).project.projectId);
      } finally {
        await dash.close();
      }
    }
    assert.notEqual(ids[0], ids[1], 'same-name roots must retain distinct opaque public IDs');

    const hostilePlanrDir = join(fixtureRoot, 'private-hostile-name', '.planr');
    mkdirSync(hostilePlanrDir, { recursive: true });
    writeFileSync(join(hostilePlanrDir, 'config.json'), JSON.stringify({ projectName: 'Public\nname' }));
    const hostile = createDashboardServer({ staticRoot, planrDir: hostilePlanrDir, watch: false });
    try {
      const port = await hostile.listen(0, {
        env: { ...process.env, PLANR_HOME: join(fixtureRoot, 'home-hostile-name') },
      });
      const body = (await request(port, '/api/bootstrap')).body;
      assert.equal(JSON.parse(body).project.name, 'OpenPlanr project');
      assert.equal(body.includes('private-hostile-name'), false);
      assert.equal(body.includes('Public\\nname'), false);
    } finally {
      await hostile.close();
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
