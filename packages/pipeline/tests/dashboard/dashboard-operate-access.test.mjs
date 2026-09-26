import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { assertOperateExperienceAuditDisplaySurfaceV1 } from '../../lib/dashboard/operate-experience-audit-display-contract.mjs';
import { assertOperateActionDisplayWorkspaceV1 } from '../../lib/dashboard/operate-experience-display-contract.mjs';
import { selectOperateExperienceSurface } from '../../lib/dashboard/operate-experience-reader.mjs';
import { createDashboardServer } from '../../lib/dashboard/server.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const planrDir = join(root, 'conformance/fixtures/dashboard-graph/.planr');
const PRIVATE_LOCATOR = 'private-repository-locator-must-not-cross-http';
const PRIVATE_QUERY = 'private-query-value-must-not-echo';
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;

const emptyView = JSON.parse(
  readFileSync(
    join(root, 'conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json'),
    'utf8',
  ),
)['operate-experience-view'];

function request(port, path, headers = {}) {
  return new Promise((resolvePromise, reject) => {
    const requestHandle = get({ host: '127.0.0.1', port, path, headers }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () =>
        resolvePromise({
          status: response.statusCode,
          headers: response.headers,
          body,
        }),
      );
    });
    requestHandle.on('error', reject);
    requestHandle.setTimeout(4_000, () => requestHandle.destroy(new Error('request timed out')));
  });
}

function cycle() {
  return {
    cycleId: 'cycle-1',
    state: 'approved',
    health: 'normal',
    focus: ['Keep audit reads evidence-bound.'],
    createdAt: '2026-08-11T07:00:00Z',
    updatedAt: emptyView.generatedAt,
    stages: ['observe', 'understand', 'decide', 'govern', 'act', 'verify', 'learn'].map(
      (id, index) => ({
        id,
        state: index < 4 ? 'complete' : index === 4 ? 'current' : 'waiting',
        reason: null,
        inputArtifactIds: [],
        outputArtifactIds: [],
        gates: [],
        evidenceGapIds: [],
        uncertaintyIds: [],
        persistentActionIds: [],
      }),
    ),
    assignments: [],
    lensAbsences: [],
    executiveBoard: null,
    dependencies: [],
    blockers: [],
    persistentActionIds: ['act_00000001'],
    replayCheckpoint: null,
    deepLink: '#/operate/cycles/cycle-1',
  };
}

function action() {
  return {
    actionId: 'act_00000001',
    revision: 1,
    actionHash: HASH_A,
    title: 'Measure retention',
    state: 'completed',
    ownerActorId: emptyView.actorId,
    expectedResult: 'Retention remains evidence-bound.',
    verificationPlanId: 'verify-1',
    deliveryRoute: {
      kind: 'operating-delivery-route',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      routeId: 'droute_00000001',
      scopeId: emptyView.scopeId,
      domainId: emptyView.domainId,
      domainVersion: emptyView.domainVersion,
      action: {
        actionId: 'act_00000001',
        revision: 1,
        actionHash: HASH_A,
      },
      eventHead: structuredClone(emptyView.eventHead),
      route: 'observe-only',
      rationale: 'The audit surface is read-only.',
      createdAt: emptyView.generatedAt,
      routeHash: HASH_B,
    },
    dependencyActionIds: [],
    executions: [],
    rollbacks: [],
    deepLink: '#/operate/actions/act_00000001',
  };
}

function evidence() {
  return {
    evidenceRefId: 'evidence-available',
    classification: 'public',
    accessState: 'available',
    freshness: 'current',
    evidenceKind: 'operate-artifact',
    resolvedAt: emptyView.generatedAt,
    claimStatus: 'supported',
    supportClaimIds: ['claim-retention'],
    contradictClaimIds: [],
    source: {
      evidenceKind: 'operate-artifact',
      provider: { id: 'provider-public', version: '1.0.0' },
      resolver: { id: 'resolver-public', version: '1.0.0' },
    },
    producer: {
      actorId: 'advisor-agent',
      roleId: 'advisor',
      runtime: 'openplanr',
    },
    observedAt: emptyView.generatedAt,
    scope: {
      scopeId: emptyView.scopeId,
      domainId: emptyView.domainId,
      domainVersion: emptyView.domainVersion,
    },
    sensitivity: 'public',
    provenance: {
      sourceArtifactId: 'artifact-source',
      evidenceArtifactId: 'artifact-evidence',
      rawHash: HASH_A,
      canonicalHash: HASH_B,
      sizeBytes: 128,
      mediaType: 'application-json',
      accessLevel: 'public',
    },
    confidence: 0.8,
    gaps: [],
    errors: [
      {
        resolutionId: 'resolution-1',
        error: {
          code: 'SOURCE_STALE',
          retryable: false,
          context: { repositoryId: PRIVATE_LOCATOR },
        },
        resolvedAt: emptyView.generatedAt,
      },
    ],
    accessReason: null,
    causalLinks: [],
    deepLink: '#/operate/evidence/evidence-available',
  };
}

function claim() {
  return {
    claimId: 'claim-retention',
    status: 'supported',
    epistemicStatus: 'strongly-supported',
    statement: 'Retention remains measurable.',
    supportEvidenceRefIds: ['evidence-available'],
    contradictEvidenceRefIds: [],
    source: null,
    producer: null,
    observedAt: emptyView.generatedAt,
    scope: {
      scopeId: emptyView.scopeId,
      domainId: emptyView.domainId,
      domainVersion: emptyView.domainVersion,
    },
    sensitivity: 'public',
    provenance: null,
    confidence: 0.9,
    gaps: [],
    errors: [],
    accessReason: null,
    causalLinks: [],
    deepLink: '#/operate/evidence/claim-retention',
  };
}

function outcome() {
  return {
    outcomeId: 'outcome-1',
    actionId: 'act_00000001',
    verificationPlanId: 'verify-1',
    status: 'insufficient-evidence',
    metric: {
      metricId: 'metric-retention',
      metricHash: HASH_B,
      baseline: 72,
      target: 85,
      observed: null,
      unit: 'percent',
      window: 'Q3',
      dueAt: null,
      freshness: 'unknown',
      confidence: null,
    },
    observationIds: [],
    evidenceRefIds: [],
    observedAt: emptyView.generatedAt,
    decision: null,
    execution: [],
    rollback: [],
    verification: {
      verificationPlanId: 'verify-1',
      verificationPlanHash: HASH_C,
      metricId: 'metric-retention',
      metricHash: HASH_B,
      method: 'Wait for an accepted observation.',
      evaluationRules: ['Never infer success.'],
      observationRequest: {
        kind: 'future-observation',
        reason: 'Observe one full window.',
      },
      accessReason: null,
    },
    nextObservation: {
      kind: 'future-observation',
      reason: 'Observe one full window.',
      dueAt: null,
    },
    revisit: { decisionIds: [], conditions: ['The target is unobserved.'] },
    snapshot: null,
    delta: null,
    accessReason: null,
    deepLink: '#/operate/outcomes/outcome-1',
  };
}

function history() {
  return {
    eventId: 'event-1',
    sequence: 1,
    type: 'verification.recorded',
    entityId: 'outcome-1',
    actorKind: 'runtime',
    actorId: 'openplanr',
    timestamp: emptyView.generatedAt,
    correlationId: 'correlation-1',
    eventHash: emptyView.eventHead.hash,
    change: {
      subjectKind: 'outcome',
      summary: 'Insufficient evidence was recorded.',
    },
    why: 'No accepted observation exists.',
    authority: null,
    evidenceRefIds: [],
    prior: { previousEventHash: null, causationId: null },
    result: null,
    next: null,
    deepLinks: ['#/operate/outcomes/outcome-1'],
    beforeAfter: null,
  };
}

function auditView() {
  const value = {
    ...structuredClone(emptyView),
    cycles: [cycle()],
    actions: [action()],
    evidence: [evidence()],
    claims: [claim()],
    outcomes: [outcome()],
    history: [history()],
    replay: {
      ...structuredClone(emptyView.replay),
      parityProof: {
        ...structuredClone(emptyView.replay.parityProof),
        stateParityVerified: true,
      },
    },
  };
  delete value.viewHash;
  return { ...value, viewHash: sha256Jcs(value) };
}

function commandableActionView() {
  const value = auditView();
  value.allowedActions = [
    {
      subjectId: 'act_00000001',
      action: {
        tool: 'operate.action.execute',
        arguments: {
          action: {
            actionId: 'act_00000001',
            revision: 1,
            actionHash: HASH_A,
          },
        },
        label: 'Execute approved Action',
        effect: 'project-write',
      },
    },
  ];
  delete value.viewHash;
  return { ...value, viewHash: sha256Jcs(value) };
}

function governedCommandGateway() {
  return {
    issueSession() {},
    assertSessionBinding() {},
    preview() {},
    assertPreviewBinding() {},
    confirm() {},
  };
}

function expectedBinding(view, surface, options = {}) {
  return {
    actorId: view.actorId,
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
    cycleId: 'cycle-1',
    subjectId: options.subjectId ?? null,
    surface,
    query: options.query ?? null,
    format: options.format ?? null,
    generatedAt: view.generatedAt,
    eventHead: view.eventHead,
    viewHash: view.viewHash,
  };
}

function queryFor(surface, options = {}) {
  const query = new URLSearchParams({
    scopeId: emptyView.scopeId,
    domainId: emptyView.domainId,
    domainVersion: emptyView.domainVersion,
    cycleId: 'cycle-1',
  });
  if (surface === 'search') query.set('q', options.query);
  if (surface === 'export') query.set('format', options.format);
  return query.toString();
}

test('audit REST signs all exact surfaces and closes hostile transport input', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-dashboard-audit-access-'));
  const view = auditView();
  let providerReads = 0;
  const dashboard = createDashboardServer({
    planrDir,
    watch: false,
    getOperatingExperience: () => {
      providerReads += 1;
      return {
        available: true,
        readOnly: true,
        status: 'ready',
        view,
        reasonCodes: [],
      };
    },
  });
  const headers = { 'X-OpenPlanr-Actor': view.actorId };
  const base = `scopeId=${view.scopeId}&domainId=${view.domainId}&domainVersion=${view.domainVersion}`;
  try {
    const port = await dashboard.listen(0, {
      env: { ...process.env, PLANR_HOME: home },
    });

    const closedBeforeRead = [
      ['/api/operate/evidence?cycleId=cycle-1', 'OPERATE_BINDING_REQUIRED'],
      [`/api/operate/evidence?${base}`, 'OPERATE_QUERY_INVALID'],
      [`/api/operate/evidence?${base}&cycleId=cycle-1&cycleId=cycle-1`, 'OPERATE_QUERY_INVALID'],
      [
        `/api/operate/evidence?${base}&cycleId=cycle-1&unknown=${PRIVATE_QUERY}`,
        'OPERATE_QUERY_INVALID',
      ],
      [
        `/api/operate/evidence?${base}&cycleId=cycle-1&pr%69vateActor=${PRIVATE_QUERY}`,
        'OPERATE_QUERY_INVALID',
      ],
      [`/api/operate/%65vidence?${base}&cycleId=cycle-1`, 'OPERATE_ROUTE_INVALID'],
      [
        `/api/operate/evidence/evidence-available%2F${PRIVATE_QUERY}?${base}&cycleId=cycle-1`,
        'OPERATE_ROUTE_INVALID',
      ],
      [`/api/operate/evidence/private/extra?${base}&cycleId=cycle-1`, 'OPERATE_ROUTE_INVALID'],
      [`/api/operate/search?${base}&cycleId=cycle-1&q=a&q=b`, 'OPERATE_QUERY_INVALID'],
      [
        `/api/operate/export?${base}&cycleId=cycle-1&format=json&format=html`,
        'OPERATE_QUERY_INVALID',
      ],
      [`/api/operate/search?${base}&cycleId=cycle-1&q=${'x'.repeat(513)}`, 'OPERATE_QUERY_INVALID'],
      [
        `/api/operate/export?${base}&cycleId=cycle-1&format=${PRIVATE_QUERY}`,
        'OPERATE_QUERY_INVALID',
      ],
    ];
    for (const [path, reasonCode] of closedBeforeRead) {
      const readsBeforeRequest = providerReads;
      const response = await request(port, path, headers);
      assert.equal(response.status, 400, path);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.headers.location, undefined);
      assert.equal(response.body.includes(PRIVATE_QUERY), false);
      assert.equal(JSON.parse(response.body).error.reasonCode, reasonCode);
      assert.equal(providerReads, readsBeforeRequest, `${path} must fail before owner access`);
    }
    assert.equal(providerReads, 0, 'invalid grammar must fail before owner access');

    for (const [path, foreignHeaders] of [
      [`/api/operate/evidence?${base}&cycleId=cycle-1`, { 'X-OpenPlanr-Actor': PRIVATE_QUERY }],
      [
        `/api/operate/evidence?scopeId=${PRIVATE_QUERY}&domainId=${view.domainId}&domainVersion=${view.domainVersion}&cycleId=cycle-1`,
        headers,
      ],
      [`/api/operate/evidence?${base}&cycleId=${PRIVATE_QUERY}`, headers],
    ]) {
      const response = await request(port, path, foreignHeaders);
      assert.equal(response.status, 403, path);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.body.includes(PRIVATE_QUERY), false);
      assert.equal(JSON.parse(response.body).error.reasonCode, 'OPERATE_BINDING_MISMATCH');
    }

    const cases = [
      ['evidence', '/api/operate/evidence', {}],
      ['evidence', '/api/operate/evidence/evidence-available', { subjectId: 'evidence-available' }],
      ['outcomes', '/api/operate/outcomes', {}],
      ['outcome', '/api/operate/outcomes/outcome-1', { subjectId: 'outcome-1' }],
      ['history', '/api/operate/history', {}],
      ['search', '/api/operate/search', { query: 'Measure retention' }],
      ['export', '/api/operate/export', { format: 'json' }],
      ['export', '/api/operate/export', { format: 'html' }],
    ];
    const envelopes = new Map();
    for (const [surface, route, options] of cases) {
      const response = await request(port, `${route}?${queryFor(surface, options)}`, headers);
      assert.equal(response.status, 200, `${surface}: ${response.body}`);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.match(response.headers['content-type'] ?? '', /application\/json/u);
      assert.equal(response.headers.location, undefined);
      assert.equal(response.body.includes(PRIVATE_LOCATOR), false);
      if (surface !== 'search') {
        assert.equal(response.body.includes('#/operate/actions/'), false);
      }
      const envelope = JSON.parse(response.body);
      const expected = expectedBinding(view, surface, options);
      assert.equal(assertOperateExperienceAuditDisplaySurfaceV1(envelope, expected), envelope);
      assert.equal(envelope.payload.mutationEnabled, false);
      assert.equal(envelope.payload.viewHash, view.viewHash);
      assert.equal(envelope.integrity.sourceViewHash, view.viewHash);
      envelopes.set(`${surface}:${options.format ?? options.subjectId ?? ''}`, {
        envelope,
        expected,
      });

      const legacy = selectOperateExperienceSurface(view, {
        surface,
        binding: expected,
        subjectId: options.subjectId ?? null,
        cycleId: 'cycle-1',
        query: options.query ?? '',
        format: options.format ?? 'json',
      });
      assert.equal(legacy.ok, true);
      assert.equal(envelope.payload.surface, legacy.surface);
      assert.equal(envelope.payload.viewHash, legacy.viewHash);
      if (surface === 'search') {
        const hit = envelope.payload.data.results.find(
          (entry) => entry.kind === 'action' && entry.subjectId === 'act_00000001',
        );
        assert.equal(hit?.deepLink, '#/operate/actions/act_00000001');
      }
    }

    const evidenceEnvelope = envelopes.get('evidence:');
    const contentTamper = structuredClone(evidenceEnvelope.envelope);
    contentTamper.payload.data.evidence[0].freshness = 'stale';
    assert.throws(() =>
      assertOperateExperienceAuditDisplaySurfaceV1(contentTamper, evidenceEnvelope.expected),
    );
    assert.throws(() =>
      assertOperateExperienceAuditDisplaySurfaceV1(evidenceEnvelope.envelope, {
        ...evidenceEnvelope.expected,
        actorId: 'actor-foreign',
      }),
    );
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
  assert.equal(existsSync(home), false, 'loopback state must be cleaned up');
});

test('Action REST signs commandability only when the exact governed gateway is available', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-dashboard-action-access-'));
  const view = commandableActionView();
  const dashboard = createDashboardServer({
    planrDir,
    watch: false,
    getOperatingExperience: () => ({
      available: true,
      readOnly: false,
      status: 'ready',
      view,
      reasonCodes: [],
    }),
    getOperatingCommandGateway: governedCommandGateway,
  });
  try {
    const port = await dashboard.listen(0, {
      env: { ...process.env, PLANR_HOME: home },
    });
    const response = await request(
      port,
      `/api/operate/actions/act_00000001?scopeId=${view.scopeId}&domainId=${view.domainId}&domainVersion=${view.domainVersion}`,
      { 'X-OpenPlanr-Actor': view.actorId },
    );
    assert.equal(response.status, 200);
    const display = JSON.parse(response.body);
    assert.equal(display.payload.readOnly, false);
    assert.equal(display.payload.mutationEnabled, true);
    assert.equal(
      assertOperateActionDisplayWorkspaceV1(display, {
        actorId: view.actorId,
        scopeId: view.scopeId,
        domainId: view.domainId,
        domainVersion: view.domainVersion,
        generatedAt: view.generatedAt,
        eventHead: view.eventHead,
        viewHash: view.viewHash,
        subjectId: 'act_00000001',
        actionId: 'act_00000001',
      }),
      display,
    );
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});
