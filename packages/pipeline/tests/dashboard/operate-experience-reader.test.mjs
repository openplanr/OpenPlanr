import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildOperateExperienceTransportView,
  decodeOperateExperienceCheckpoint,
  encodeOperateExperienceCheckpoint,
  readOperateExperienceProjection,
  resolveOperateExperienceSearchDestination,
  selectOperateExperienceSurface,
} from '../../lib/dashboard/operate-experience-reader.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import { rehashExperienceView } from './experience-view-test-support.mjs';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;
const HASH_D = `sha256:${'d'.repeat(64)}`;
const HASH_E = `sha256:${'e'.repeat(64)}`;
const HASH_F = `sha256:${'f'.repeat(64)}`;

function historyEvent(overrides = {}) {
  return {
    eventId: 'event-1',
    sequence: 1,
    type: 'cycle.started',
    entityId: 'cycle-1',
    actorKind: 'engine',
    actorId: 'openplanr',
    timestamp: '2026-08-11T08:00:00Z',
    correlationId: 'correlation-1',
    eventHash: HASH_A,
    change: { subjectKind: 'cycle', summary: 'Cycle started.' },
    why: 'The owner started it.',
    authority: null,
    evidenceRefIds: [],
    prior: { previousEventHash: null, causationId: null },
    result: null,
    next: null,
    deepLinks: ['#/operate/cycles/cycle-1'],
    beforeAfter: null,
    ...overrides,
  };
}

function view(overrides = {}) {
  const base = {
    kind: 'operate-experience-view',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    viewId: 'xview_1234567890abcdef1234567890abcdef',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    actorId: 'owner-acme',
    accessLevel: 'public',
    generatedAt: '2026-08-11T08:00:00Z',
    eventHead: { sequence: 1, hash: HASH_A },
    sourceStateHash: HASH_B,
    status: 'ready',
    attention: [
      {
        attentionId: 'attention-decision-1',
        kind: 'decision',
        subjectId: 'decision-1',
        priority: 500,
        title: 'Review retention evidence',
        whyNow: 'Other work is waiting.',
        consequence: 'The operating plan remains blocked.',
        state: 'proposed',
        dueAt: null,
        evidenceRefIds: [],
      },
    ],
    domainMetrics: [
      {
        metricId: 'metric-retention',
        title: 'Retention rate',
        value: 91,
        unit: 'percent',
        change: {
          kind: 'changed',
          priorValue: 89,
          currentValue: 91,
          deltaValue: 2,
          deltaId: 'delta-retention',
        },
        window: '30 days',
        freshness: 'current',
        state: 'current',
        target: 93,
        threshold: 90,
        evidenceRefIds: [],
        snapshot: null,
        delta: null,
        dueVerification: [],
        accessReason: null,
      },
    ],
    cycles: [
      {
        cycleId: 'cycle-1',
        state: 'approved',
        health: 'normal',
        focus: ['Retention'],
        createdAt: '2026-08-11T07:00:00Z',
        updatedAt: '2026-08-11T08:00:00Z',
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
        assignments: [
          {
            assignmentId: 'assignment-1',
            title: 'Validate retention drivers',
            role: 'advisor',
            ownerLabel: 'Product advisor',
            state: 'available',
            absence: null,
            dueAt: null,
            next: { label: 'Claim assignment', tool: 'operate.assignment.claim' },
            deepLink: '#/operate/cycles/cycle-1',
            dependencies: [],
            blockers: [],
            inputArtifactIds: ['artifact-input-1'],
            outputArtifactIds: [],
          },
        ],
        lensAbsences: [],
        executiveBoard: null,
        dependencies: [],
        blockers: [],
        persistentActionIds: ['action-1'],
        replayCheckpoint: null,
        deepLink: '#/operate/cycles/cycle-1',
      },
    ],
    inbox: [],
    actions: [],
    evidence: [
      {
        evidenceRefId: 'evidence-1',
        classification: 'restricted',
        accessState: 'restricted',
        freshness: 'current',
        evidenceKind: null,
        resolvedAt: null,
        claimStatus: 'restricted',
        supportClaimIds: [],
        contradictClaimIds: [],
        source: null,
        producer: null,
        observedAt: null,
        scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
        sensitivity: 'restricted',
        provenance: null,
        confidence: null,
        gaps: [],
        errors: [],
        accessReason: 'access-denied',
        causalLinks: [],
        deepLink: '#/operate/evidence/evidence-1',
      },
    ],
    claims: [
      {
        claimId: 'claim-retention',
        status: 'supported',
        epistemicStatus: 'strongly-supported',
        statement: 'Retention improved after onboarding changes.',
        supportEvidenceRefIds: [],
        contradictEvidenceRefIds: [],
        source: null,
        producer: null,
        observedAt: '2026-08-11T08:00:00Z',
        scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
        sensitivity: 'public',
        provenance: null,
        confidence: 0.9,
        gaps: [],
        errors: [],
        accessReason: null,
        causalLinks: [],
        deepLink: '#/operate/evidence/claim-retention',
      },
    ],
    rationale: [],
    outcomes: [
      {
        outcomeId: 'outcome-1',
        actionId: 'action-1',
        verificationPlanId: 'verify-1',
        status: 'pending',
        metric: null,
        observationIds: [],
        evidenceRefIds: [],
        observedAt: '2026-08-11T08:00:00Z',
        decision: null,
        execution: [],
        rollback: [],
        verification: null,
        nextObservation: null,
        revisit: null,
        snapshot: null,
        delta: null,
        accessReason: null,
        deepLink: '#/operate/outcomes/outcome-1',
      },
    ],
    learnings: [],
    history: [historyEvent()],
    replay: {
      checkpoint: null,
      tail: { startSequence: 1, endSequence: 1, eventCount: 1, eventReplayIndexHash: HASH_A },
      finalHead: { sequence: 1, hash: HASH_A },
      liveAccessUsed: false,
      parityProof: {
        sourceStateHash: HASH_B,
        eventReplayIndexHash: HASH_A,
        checkpointVerified: false,
        finalEventHashMatches: true,
        stateParityVerified: true,
      },
      filterDimensions: ['cycle', 'actor', 'event-type'],
      redactions: [{ classification: 'restricted', count: 1, reason: 'access-denied' }],
    },
    allowedActions: [],
    omissions: [{ classification: 'restricted', count: 1, reason: 'access-denied' }],
    export: { formats: ['html', 'json'], accessSafe: true, redactionCount: 1 },
    ...overrides,
  };
  return rehashExperienceView(base);
}

function exactCheckpointView() {
  const current = view();
  const checkpoint = {
    createdAt: current.generatedAt,
    eventHead: structuredClone(current.eventHead),
    runtimeStateHash: current.sourceStateHash,
    eventReplayIndexHash: current.replay.tail.eventReplayIndexHash,
    recoveryVersion: '2.0.0',
  };
  current.replay.checkpoint = checkpoint;
  current.replay.tail = {
    ...current.replay.tail,
    startSequence: current.eventHead.sequence + 1,
    endSequence: null,
    eventCount: 0,
  };
  current.replay.parityProof.checkpointVerified = true;
  current.replay.parityProof.stateParityVerified = true;
  current.cycles.forEach((cycle) => {
    cycle.replayCheckpoint = structuredClone(checkpoint);
  });
  return rehashExperienceView(current);
}

function retainedCheckpointView() {
  const current = view();
  const checkpoint = {
    createdAt: current.generatedAt,
    eventHead: { sequence: 1, hash: HASH_A },
    runtimeStateHash: HASH_B,
    eventReplayIndexHash: HASH_E,
    recoveryVersion: '2.0.0',
  };
  current.eventHead = { sequence: 3, hash: HASH_C };
  current.sourceStateHash = HASH_D;
  current.replay.checkpoint = checkpoint;
  current.replay.finalHead = structuredClone(current.eventHead);
  current.replay.tail = {
    startSequence: 2,
    endSequence: 3,
    eventCount: 2,
    eventReplayIndexHash: HASH_F,
  };
  current.replay.parityProof = {
    sourceStateHash: HASH_D,
    eventReplayIndexHash: HASH_F,
    checkpointVerified: true,
    finalEventHashMatches: true,
    stateParityVerified: false,
  };
  current.cycles.forEach((cycle) => {
    cycle.replayCheckpoint = structuredClone(checkpoint);
  });
  return rehashExperienceView(current);
}

const binding = {
  actorId: 'owner-acme',
  scopeId: 'scope-acme',
  domainId: 'business',
  domainVersion: '1.0.0',
};

test('experience reader validates a canonical access-safe projection and fails closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'operate-experience-reader-'));
  try {
    const planrDir = join(root, '.planr');
    const projectionDir = join(planrDir, 'operate', 'projections');
    mkdirSync(projectionDir, { recursive: true });
    writeFileSync(join(projectionDir, 'experience-view.json'), JSON.stringify(view()));
    const accepted = readOperateExperienceProjection(planrDir);
    assert.equal(accepted.status, 'ready');
    assert.equal(accepted.view.viewHash, view().viewHash);

    const privateActor = 'private-approver-identity';
    const raw = view({
      history: [
        historyEvent({
          eventId: 'event-private',
          sequence: 1,
          type: 'approval.recorded',
          entityId: 'approval-1',
          actorKind: 'human',
          actorId: privateActor,
          timestamp: '2026-08-11T08:00:00Z',
          correlationId: 'correlation-private',
          eventHash: HASH_A,
        }),
      ],
    });
    writeFileSync(join(projectionDir, 'experience-view.json'), JSON.stringify(raw));
    const rebound = readOperateExperienceProjection(planrDir);
    assert.equal(rebound.status, 'ready');
    assert.equal(rebound.view.history[0].actorId, 'restricted-actor');
    assert.notEqual(rebound.view.viewHash, raw.viewHash);
    assert.equal(JSON.stringify(rebound).includes(privateActor), false);

    writeFileSync(
      join(projectionDir, 'experience-view.json'),
      JSON.stringify({ ...view(), viewHash: HASH_A }),
    );
    const refused = readOperateExperienceProjection(planrDir);
    assert.equal(refused.status, 'invalid');
    assert.equal(JSON.stringify(refused).includes(root), false);
    assert.deepEqual(refused.reasonCodes, ['OPERATE_PROJECTION_INVALID']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('experience reader rejects recomputed replay custody substitutions without echo', () => {
  const privateMarker = 'private-replay-marker-must-not-echo';
  const mutations = [
    (candidate) => {
      candidate.replay.finalHead = { sequence: 0, hash: null };
    },
    (candidate) => {
      candidate.replay.parityProof.sourceStateHash = HASH_A;
    },
    (candidate) => {
      candidate.replay.parityProof.eventReplayIndexHash = HASH_B;
    },
    (candidate) => {
      candidate.replay.parityProof.checkpointVerified = true;
    },
    (candidate) => {
      candidate.replay.tail.startSequence = 2;
    },
    (candidate) => {
      candidate.replay.tail.endSequence = null;
    },
    (candidate) => {
      candidate.replay.tail.eventCount = 0;
    },
    (candidate) => {
      candidate.replay.parityProof.finalEventHashMatches = false;
    },
  ];
  for (const mutate of mutations) {
    const candidate = view();
    mutate(candidate);
    candidate.replay.redactions = [
      { classification: 'restricted', count: 1, reason: 'access-denied' },
    ];
    candidate.omissions = [{ classification: 'restricted', count: 1, reason: 'access-denied' }];
    candidate.history[0].why = privateMarker;
    delete candidate.viewHash;
    candidate.viewHash = sha256Jcs(candidate);
    assert.throws(
      () => buildOperateExperienceTransportView(candidate),
      (error) =>
        error.code === 'OPERATE_PROJECTION_INVALID' &&
        !String(error.message).includes(privateMarker),
    );
    const response = selectOperateExperienceSurface(candidate, { surface: 'today', binding });
    assert.equal(response.error.reasonCode, 'OPERATE_PROJECTION_INVALID');
    assert.equal(JSON.stringify(response).includes(privateMarker), false);
  }
});

test('reader accepts exact-base and retained-tail checkpoints while rejecting custody substitutions', () => {
  const exact = exactCheckpointView();
  assert.equal(buildOperateExperienceTransportView(exact).viewHash, exact.viewHash);
  const exactHostile = structuredClone(exact);
  exactHostile.replay.checkpoint.runtimeStateHash = HASH_C;
  exactHostile.cycles.forEach((cycle) => {
    cycle.replayCheckpoint = structuredClone(exactHostile.replay.checkpoint);
  });
  assert.throws(() => buildOperateExperienceTransportView(rehashExperienceView(exactHostile)), {
    code: 'OPERATE_PROJECTION_INVALID',
  });

  const retained = retainedCheckpointView();
  assert.equal(buildOperateExperienceTransportView(retained).viewHash, retained.viewHash);
  assert.equal(selectOperateExperienceSurface(retained, { surface: 'today', binding }).ok, true);
  const mutations = [
    (candidate) => {
      candidate.replay.finalHead = { sequence: 2, hash: HASH_C };
    },
    (candidate) => {
      candidate.replay.tail.startSequence = 3;
    },
    (candidate) => {
      candidate.replay.tail.endSequence = 2;
    },
    (candidate) => {
      candidate.replay.tail.eventCount = 1;
    },
    (candidate) => {
      candidate.replay.parityProof.eventReplayIndexHash = HASH_E;
    },
    (candidate) => {
      candidate.replay.parityProof.checkpointVerified = false;
    },
    (candidate) => {
      candidate.replay.parityProof.stateParityVerified = true;
    },
    (candidate) => {
      candidate.cycles[0].replayCheckpoint.runtimeStateHash = HASH_C;
    },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(retained);
    mutate(candidate);
    assert.throws(() => buildOperateExperienceTransportView(rehashExperienceView(candidate)), {
      code: 'OPERATE_PROJECTION_INVALID',
    });
  }
});

test('surface selectors retain one Event head and reject actor/scope substitution', () => {
  const current = view();
  const today = selectOperateExperienceSurface(current, { surface: 'today', binding });
  const cycle = selectOperateExperienceSurface(current, {
    surface: 'cycle',
    subjectId: 'cycle-1',
    binding,
  });
  const evidence = selectOperateExperienceSurface(current, { surface: 'evidence', binding });
  const outcomes = selectOperateExperienceSurface(current, { surface: 'outcomes', binding });
  const outcome = selectOperateExperienceSurface(current, {
    surface: 'outcome',
    subjectId: 'outcome-1',
    binding,
  });
  const history = selectOperateExperienceSurface(current, { surface: 'history', binding });
  for (const response of [today, cycle, evidence, outcomes, outcome, history]) {
    assert.equal(response.ok, true);
    assert.deepEqual(response.eventHead, current.eventHead);
    assert.equal(response.viewHash, current.viewHash);
    assert.equal(response.readOnly, true);
  }
  assert.deepEqual(today.data.domainMetrics, current.domainMetrics);
  assert.deepEqual(cycle.data.cycle.assignments, current.cycles[0].assignments);
  assert.deepEqual(cycle.data.cycle.stages, current.cycles[0].stages);
  assert.deepEqual(evidence.data, {
    evidence: current.evidence,
    claims: current.claims,
    rationale: current.rationale,
  });
  assert.deepEqual(outcomes.data, {
    domainMetrics: current.domainMetrics,
    outcomes: current.outcomes,
    learnings: current.learnings,
  });
  assert.deepEqual(history.data, { history: current.history, replay: current.replay });
  const foreign = selectOperateExperienceSurface(current, {
    surface: 'today',
    binding: { ...binding, scopeId: 'scope-foreign' },
  });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.error.reasonCode, 'OPERATE_BINDING_MISMATCH');
  assert.equal(JSON.stringify(foreign).includes('scope-acme'), false);
});

test('validated immutable transport caching cannot be reused after mutation or cloning', () => {
  const source = view();
  const current = buildOperateExperienceTransportView(source);
  const first = selectOperateExperienceSurface(current, { surface: 'today', binding });
  assert.equal(first.ok, true);
  assert.equal(
    Object.isFrozen(current),
    false,
    'the compatibility facade remains clone-and-rehash capable',
  );
  assert.equal(Object.isFrozen(current.replay), true);
  assert.equal(Object.isFrozen(current.history[0]), true);

  assert.throws(() => {
    current.replay.finalHead.sequence = 0;
  }, TypeError);
  assert.throws(() => {
    current.history[0].actorId = 'private-cache-bypass';
  }, TypeError);
  assert.equal(
    selectOperateExperienceSurface(current, { surface: 'today', binding }).viewHash,
    first.viewHash,
  );

  const hostileFacade = buildOperateExperienceTransportView(view());
  assert.equal(
    selectOperateExperienceSurface(hostileFacade, { surface: 'today', binding }).ok,
    true,
  );
  hostileFacade.status = 'blocked';
  const refusedFacade = selectOperateExperienceSurface(hostileFacade, {
    surface: 'today',
    binding,
  });
  assert.equal(refusedFacade.ok, false);
  assert.equal(refusedFacade.error.reasonCode, 'OPERATE_PROJECTION_INVALID');

  const hostileClone = structuredClone(current);
  hostileClone.replay.finalHead.sequence = 0;
  const refused = selectOperateExperienceSurface(hostileClone, { surface: 'today', binding });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.reasonCode, 'OPERATE_PROJECTION_INVALID');
  assert.equal(JSON.stringify(refused).includes('private-cache-bypass'), false);

  source.status = 'blocked';
  assert.equal(
    current.status,
    'ready',
    'the immutable transport root is detached from caller-owned input',
  );
});

test('truth summaries remain bound to immutable snapshot identity and revalidate caller-owned views', () => {
  const current = buildOperateExperienceTransportView(view());
  const first = selectOperateExperienceSurface(current, { surface: 'today', binding });
  const repeated = selectOperateExperienceSurface(current, { surface: 'cycles', binding });
  assert.equal(first.ok, true);
  assert.equal(repeated.ok, true);
  assert.equal(repeated.truthSummary, first.truthSummary);
  assert.equal(Object.isFrozen(first.truthSummary.attention), true);

  const independent = buildOperateExperienceTransportView(view());
  const second = selectOperateExperienceSurface(independent, { surface: 'today', binding });
  assert.equal(second.viewHash, first.viewHash);
  assert.deepEqual(second.truthSummary, first.truthSummary);
  assert.notEqual(
    second.truthSummary,
    first.truthSummary,
    'identical hashes do not share snapshot authority',
  );

  const changed = buildOperateExperienceTransportView(view({ attention: [] }));
  const updated = selectOperateExperienceSurface(changed, { surface: 'today', binding });
  assert.equal(updated.ok, true);
  assert.equal(updated.truthSummary.attention.total, 0);
  assert.notEqual(updated.truthSummary.sourceViewHash, first.truthSummary.sourceViewHash);

  const mutable = structuredClone(current);
  assert.equal(selectOperateExperienceSurface(mutable, { surface: 'today', binding }).ok, true);
  mutable.attention = [];
  const rejectedMutation = selectOperateExperienceSurface(mutable, { surface: 'today', binding });
  assert.equal(rejectedMutation.error.reasonCode, 'OPERATE_PROJECTION_INVALID');

  const forged = Object.freeze({ ...current, attention: [] });
  const rejectedForgery = selectOperateExperienceSurface(forged, { surface: 'today', binding });
  assert.equal(rejectedForgery.error.reasonCode, 'OPERATE_PROJECTION_INVALID');

  const foreign = selectOperateExperienceSurface(current, {
    surface: 'today',
    binding: { ...binding, scopeId: 'scope-foreign' },
  });
  assert.equal(foreign.error.reasonCode, 'OPERATE_BINDING_MISMATCH');
});

test('search and export operate only over projected safe values', () => {
  const privateActor = 'private-approver-identity';
  const privateErrorContext = 'private-repository-context';
  const baseView = view();
  const baseClaim = baseView.claims[0];
  const actionId = 'act_search_00000001';
  const actionHash = `sha256:${'d'.repeat(64)}`;
  const availableEvidence = {
    ...baseView.evidence[0],
    evidenceRefId: 'evidence-available',
    classification: 'public',
    accessState: 'available',
    freshness: 'current',
    evidenceKind: 'filesystem',
    claimStatus: 'supported',
    supportClaimIds: ['claim-retention'],
    observedAt: '2026-08-11T08:00:00Z',
    sensitivity: 'public',
    confidence: 0.8,
    accessReason: null,
    deepLink: '#/operate/evidence/evidence-available',
  };
  const action = {
    actionId,
    revision: 1,
    actionHash,
    title: 'Audit search destination links',
    state: 'approved',
    ownerActorId: 'owner-acme',
    expectedResult: 'Every emitted search link resolves.',
    verificationPlanId: 'verification-search-1',
    deliveryRoute: {
      kind: 'operating-delivery-route',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      routeId: 'droute_search_00000001',
      scopeId: 'scope-acme',
      domainId: 'business',
      domainVersion: '1.0.0',
      action: { actionId, revision: 1, actionHash },
      eventHead: { sequence: 1, hash: HASH_A },
      route: 'observe-only',
      rationale: 'This Action is represented read-only.',
      createdAt: '2026-08-11T08:00:00Z',
      routeHash: HASH_B,
    },
    dependencyActionIds: [],
    executions: [],
    rollbacks: [],
    deepLink: `#/operate/actions/${actionId}`,
  };
  const current = view({
    attention: [
      {
        attentionId: 'attention-safe',
        kind: 'decision',
        subjectId: 'decision-safe',
        priority: 700,
        title: 'Safe visible retention claim',
        whyNow: 'Review it now.',
        consequence: 'A project decision is waiting.',
        state: 'proposed',
        dueAt: null,
        evidenceRefIds: ['evidence-1'],
      },
    ],
    history: [
      historyEvent({
        eventId: 'event-private',
        sequence: 1,
        type: 'approval.recorded',
        entityId: 'approval-1',
        actorKind: 'human',
        actorId: 'restricted-actor',
        timestamp: '2026-08-11T08:00:00Z',
        correlationId: 'correlation-private',
        eventHash: HASH_A,
      }),
    ],
    claims: [
      {
        ...baseClaim,
        supportEvidenceRefIds: ['evidence-available'],
        errors: [
          {
            resolutionId: 'resolution-1',
            resolvedAt: '2026-08-11T08:00:00Z',
            error: {
              code: 'SOURCE_NOT_FOUND',
              retryable: false,
              context: { repositoryId: privateErrorContext },
            },
          },
        ],
      },
    ],
    actions: [action],
    evidence: [baseView.evidence[0], availableEvidence],
    rationale: [
      {
        nodeId: 'action-search-rationale',
        kind: 'action',
        subjectId: actionId,
        summary: 'Search must not invent an Action detail destination.',
        artifactId: null,
        evidenceRefIds: [],
      },
    ],
    learnings: [
      {
        learningId: 'learning-search-1',
        outcomeId: 'outcome-1',
        statement: 'Learning links return to their owning Outcome.',
        decisionIds: [],
        evidenceRefIds: ['evidence-available'],
        createdAt: '2026-08-11T08:00:00Z',
      },
    ],
  });
  const search = selectOperateExperienceSurface(current, {
    surface: 'search',
    query: 'retention',
    binding,
  });
  assert.equal(search.data.results.length, 5);
  assert.equal(
    search.data.results.some((entry) => entry.deepLink?.startsWith('#/operate/')),
    true,
  );
  assert.equal(JSON.stringify(search.data.results).includes('evidence-1'), false);
  assert.equal(
    selectOperateExperienceSurface(current, {
      surface: 'search',
      query: 'claim-retention',
      binding,
    }).data.results[0].kind,
    'claim',
  );
  assert.deepEqual(
    selectOperateExperienceSurface(current, {
      surface: 'search',
      query: privateErrorContext,
      binding,
    }).data.results,
    [],
    'search never indexes evidence-resolution context',
  );

  const emitted = [
    'retention',
    'assignment-1',
    'claim-retention',
    'evidence-available',
    actionId,
    'learning-search-1',
    'outcome-1',
    'event-private',
  ]
    .flatMap(
      (query) =>
        selectOperateExperienceSurface(current, {
          surface: 'search',
          query,
          binding,
        }).data.results,
    )
    .filter(
      (entry, index, all) =>
        all.findIndex(
          (candidate) => candidate.kind === entry.kind && candidate.subjectId === entry.subjectId,
        ) === index,
    );
  for (const result of emitted) {
    if (!result.deepLink) {
      assert.equal(
        ['decision', 'metric', 'action'].includes(result.kind),
        true,
        `${result.kind} must fail closed`,
      );
      continue;
    }
    const destination = resolveOperateExperienceSearchDestination(current, result.deepLink);
    assert.ok(destination, result.deepLink);
    const response = selectOperateExperienceSurface(current, {
      surface: destination.surface,
      subjectId: destination.subjectId,
      binding,
    });
    assert.equal(response.ok, true, `${result.deepLink} must resolve to a callable surface`);
  }
  const assignmentResult = emitted.find((entry) => entry.kind === 'assignment');
  assert.equal(assignmentResult.deepLink, '#/operate/cycles/cycle-1');
  assert.deepEqual(resolveOperateExperienceSearchDestination(current, assignmentResult.deepLink), {
    route: 'cycles',
    surface: 'cycle',
    subjectId: 'cycle-1',
  });
  assert.equal(
    emitted.find((entry) => entry.kind === 'action').deepLink,
    '#/operate/actions/act_search_00000001',
  );
  assert.equal(
    emitted.find((entry) => entry.kind === 'learning').deepLink,
    '#/operate/outcomes/outcome-1',
  );
  for (const fabricated of [
    '#/operate/actions/action-1',
    '#/operate/outcomes/metric-retention',
    '#/operate/cycles/assignment-1',
    '#/operate/history/event-private',
    '#/operate/evidence/private-unknown',
  ])
    assert.equal(resolveOperateExperienceSearchDestination(current, fabricated), null, fabricated);

  const html = selectOperateExperienceSurface(current, {
    surface: 'export',
    format: 'html',
    binding,
  });
  assert.equal(html.data.mediaType, 'text/html; charset=utf-8');
  assert.equal(html.data.content.includes('<script'), false);
  assert.equal(html.data.content.includes('owner-acme'), false);
  assert.equal(html.data.content.includes(privateActor), false);
  assert.equal(html.data.content.includes('restricted-actor'), true);
  assert.equal(html.data.content.includes('evidence-1'), true);
  assert.equal(html.data.content.includes('domainMetrics'), true);
  assert.equal(html.data.content.includes('claims'), true);
  assert.equal(html.data.content.includes('replay'), true);

  const history = selectOperateExperienceSurface(current, { surface: 'history', binding });
  assert.equal(history.data.history[0].actorId, 'restricted-actor');
  assert.deepEqual(history.data.replay, current.replay);

  const unsafe = view({
    history: [
      historyEvent({
        eventId: 'event-private',
        sequence: 1,
        type: 'approval.recorded',
        entityId: 'approval-1',
        actorKind: 'human',
        actorId: privateActor,
        timestamp: '2026-08-11T08:00:00Z',
        correlationId: 'correlation-private',
        eventHash: HASH_A,
      }),
    ],
  });
  const rebound = buildOperateExperienceTransportView(unsafe);
  assert.equal(rebound.history[0].actorId, 'restricted-actor');
  assert.notEqual(rebound.viewHash, unsafe.viewHash);
  const accepted = selectOperateExperienceSurface(rebound, { surface: 'history', binding });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.data.history[0].actorId, 'restricted-actor');
  assert.equal(JSON.stringify(accepted).includes(privateActor), false);
});

test('checkpoint codec round-trips exact head/view and rejects malformed values', () => {
  const current = view();
  const token = encodeOperateExperienceCheckpoint(current);
  assert.deepEqual(decodeOperateExperienceCheckpoint(token), {
    eventHead: current.eventHead,
    viewHash: current.viewHash,
  });
  assert.equal(decodeOperateExperienceCheckpoint('not-a-checkpoint'), null);
  assert.equal(decodeOperateExperienceCheckpoint('x'.repeat(513)), null);
});

test('bounded search and closed export formats fail with the machine reason code', () => {
  const current = view();
  for (const response of [
    selectOperateExperienceSurface(current, {
      surface: 'search',
      query: 'x'.repeat(513),
      binding,
    }),
    selectOperateExperienceSurface(current, {
      surface: 'export',
      format: 'yaml',
      binding,
    }),
  ]) {
    assert.equal(response.ok, false);
    assert.equal(response.status, 400);
    assert.equal(response.error.reasonCode, 'RESULT_CONTRACT_INVALID');
  }
});
