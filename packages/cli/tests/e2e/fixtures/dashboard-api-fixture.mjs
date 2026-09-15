import {
  buildOperateExperienceTransportView,
  selectOperateActionDisplayWorkspace,
  selectOperateCycleDisplayWorkspace,
  selectOperateCycleWorkspace,
  selectOperateExperienceAuditDisplaySurface,
  selectOperateExperienceDisplaySurface,
  selectOperateRecoveryDisplay,
} from 'planr-pipeline/dashboard/operate-experience-reader';
import { sha256Jcs } from 'planr-pipeline/dashboard/verified-json';
import { validateProtocolArtifact } from 'planr-pipeline/protocol';
import { assertOperateActionDisplayWorkspaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-action-display-workspace.mjs';
import { assertOperateCycleDisplayWorkspaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-cycle-display-workspace.mjs';
import {
  assertOperateExperienceAuditDisplaySurfaceV1,
  validateOperateExperienceAuditDisplaySurfaceV1,
} from 'planr-pipeline/schemas/v1.2.0/operate-experience-audit-display-surface.mjs';
import { assertOperateExperienceDisplaySurfaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-experience-display-surface.mjs';
import { assertOperateRecoveryDisplaySurfaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-recovery-display-surface.mjs';
import {
  createPendingReviewDisplay,
  createTerminalReviewDisplay,
} from '../../helpers/operate-review-dashboard-fixture.ts';

export const DASHBOARD_FIXTURE_BUILD_ID = 'dashboard-browser-fixture';
const fixturePort = process.env.OPENPLANR_DASHBOARD_FIXTURE_PORT ?? '4173';
if (!/^[1-9]\d{0,4}$/u.test(fixturePort) || Number(fixturePort) > 65_535) {
  throw new TypeError('OPENPLANR_DASHBOARD_FIXTURE_PORT must be a valid TCP port.');
}
export const DASHBOARD_FIXTURE_ORIGIN = `http://127.0.0.1:${fixturePort}`;
export const DASHBOARD_FIXTURE_ACTOR = 'careloop-ops';
export const DASHBOARD_FIXTURE_CYCLE_ID = 'cyc_appointment_reminders';
export const DASHBOARD_FIXTURE_REVIEW_ID = 'rev_appointment_reminders';
export const DASHBOARD_FIXTURE_ACTION_ID = 'act_reminder_delivery_0001';
export const DASHBOARD_FIXTURE_GENERATION = 17;
export const DASHBOARD_FIXTURE_PROJECT_ID = sha256Jcs({
  project: 'careloop-appointment-reminders',
});
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const GENERATED_AT = '2026-08-19T08:00:00.000Z';
const EVENT_HEAD = Object.freeze({ sequence: 8, hash: HASH_A });
const SCOPE_ID = 'appointment-reminders';
const DOMAIN_ID = 'customer-operations';
const DOMAIN_VERSION = '1.0.0';
const DASHBOARD_FIXTURE_REVIEW_IDENTITY = Object.freeze({
  actorId: DASHBOARD_FIXTURE_ACTOR,
  cycleId: DASHBOARD_FIXTURE_CYCLE_ID,
  reviewId: DASHBOARD_FIXTURE_REVIEW_ID,
  scopeId: SCOPE_ID,
  domainId: DOMAIN_ID,
  domainVersion: DOMAIN_VERSION,
  projectId: DASHBOARD_FIXTURE_PROJECT_ID,
  readHead: EVENT_HEAD,
  terminalHead: Object.freeze({ sequence: 9, hash: HASH_B }),
  readAt: GENERATED_AT,
  committedAt: '2026-08-19T08:01:00.000Z',
});

const allowedAction = Object.freeze({
  tool: 'operate.action.rollback',
  arguments: Object.freeze({
    action: Object.freeze({
      actionId: DASHBOARD_FIXTURE_ACTION_ID,
      revision: 1,
      actionHash: HASH_A,
    }),
    originalOperationId: 'op_reminder_delivery_0001',
    rollbackPlanId: 'rbp_reminder_delivery_0001',
  }),
  label: 'Restore the previous reminder settings',
  effect: 'project-write',
});

function stages() {
  return ['observe', 'understand', 'decide', 'govern', 'act', 'verify', 'learn'].map(
    (id, index) => ({
      id,
      state: index < 5 ? 'complete' : index === 5 ? 'current' : 'waiting',
      reason: null,
      inputArtifactIds: [],
      outputArtifactIds: [],
      gates: [],
      evidenceGapIds: [],
      uncertaintyIds: [],
      persistentActionIds: index >= 4 ? [DASHBOARD_FIXTURE_ACTION_ID] : [],
    }),
  );
}

function createExperienceView() {
  const action = {
    actionId: DASHBOARD_FIXTURE_ACTION_ID,
    revision: 1,
    actionHash: HASH_A,
    title: 'Restore appointment reminder delivery',
    state: 'approved',
    ownerActorId: DASHBOARD_FIXTURE_ACTOR,
    expectedResult:
      'Confirm that appointment reminders reach 98% delivery in the next business day.',
    verificationPlanId: 'vfy_reminder_delivery_0001',
    deliveryRoute: {
      kind: 'operating-delivery-route',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      routeId: 'droute_reminder_delivery_0001',
      scopeId: SCOPE_ID,
      domainId: DOMAIN_ID,
      domainVersion: DOMAIN_VERSION,
      action: {
        actionId: DASHBOARD_FIXTURE_ACTION_ID,
        revision: 1,
        actionHash: HASH_A,
      },
      eventHead: EVENT_HEAD,
      route: 'contained-execution',
      rationale: 'Restores a reversible reminder setting while delivery is monitored.',
      createdAt: GENERATED_AT,
      routeHash: HASH_B,
    },
    dependencyActionIds: [],
    executions: [
      {
        resultId: 'res_reminder_delivery_0001',
        operationId: 'op_reminder_delivery_0001',
        status: 'succeeded',
        completedAt: GENERATED_AT,
        effectSummary: {
          changed: true,
          summary: 'Restored appointment reminder delivery for the pilot clinic.',
          affectedTargetIds: ['appointment-reminder-settings'],
        },
        targetBeforeHash: HASH_A,
        targetAfterHash: HASH_B,
        accessReason: null,
        deepLink: `#/operate/actions/${DASHBOARD_FIXTURE_ACTION_ID}`,
      },
    ],
    rollbacks: [],
    deepLink: `#/operate/actions/${DASHBOARD_FIXTURE_ACTION_ID}`,
  };
  const outcome = {
    outcomeId: 'out_reminder_delivery_0001',
    actionId: DASHBOARD_FIXTURE_ACTION_ID,
    verificationPlanId: 'vfy_reminder_delivery_0001',
    status: 'insufficient-evidence',
    metric: {
      metricId: 'met_reminder_delivery_0001',
      metricHash: HASH_B,
      baseline: 86,
      target: 98,
      observed: null,
      unit: 'percent',
      window: 'next business day',
      dueAt: null,
      freshness: 'unknown',
      confidence: null,
    },
    observationIds: [],
    evidenceRefIds: [],
    observedAt: GENERATED_AT,
    decision: null,
    execution: [],
    rollback: [],
    verification: {
      verificationPlanId: 'vfy_reminder_delivery_0001',
      verificationPlanHash: HASH_B,
      metricId: 'met_reminder_delivery_0001',
      metricHash: HASH_B,
      method: 'Compare tomorrow’s reminder delivery rate with the 98% target.',
      evaluationRules: ['Do not treat a completed change as proof that reminders arrived.'],
      observationRequest: {
        kind: 'future-observation',
        reason: 'Tomorrow’s delivery result is still needed.',
      },
      accessReason: null,
    },
    nextObservation: {
      kind: 'future-observation',
      reason: 'Tomorrow’s delivery result is still needed.',
      dueAt: null,
    },
    revisit: null,
    snapshot: null,
    delta: null,
    accessReason: null,
    deepLink: '#/operate/outcomes/out_reminder_delivery_0001',
  };
  const base = {
    kind: 'operate-experience-view',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    viewId: 'xview_browser_fixture',
    scopeId: SCOPE_ID,
    domainId: DOMAIN_ID,
    domainVersion: DOMAIN_VERSION,
    actorId: DASHBOARD_FIXTURE_ACTOR,
    accessLevel: 'internal',
    generatedAt: GENERATED_AT,
    eventHead: EVENT_HEAD,
    sourceStateHash: HASH_A,
    status: 'ready',
    attention: [],
    domainMetrics: [
      {
        metricId: 'met_reminder_delivery_0001',
        title: 'Appointment reminder delivery',
        value: 94,
        unit: 'percent',
        change: null,
        window: 'today',
        freshness: 'current',
        state: 'current',
        target: 98,
        threshold: 95,
        evidenceRefIds: [],
        snapshot: null,
        delta: null,
        dueVerification: [
          {
            verificationPlanId: 'vfy_reminder_delivery_0001',
            actionId: DASHBOARD_FIXTURE_ACTION_ID,
            state: 'insufficient-evidence',
            dueAt: null,
            window: 'next business day',
            deepLink: `#/operate/actions/${DASHBOARD_FIXTURE_ACTION_ID}`,
          },
        ],
        accessReason: null,
      },
    ],
    cycles: [
      {
        cycleId: DASHBOARD_FIXTURE_CYCLE_ID,
        state: 'verifying',
        health: 'normal',
        focus: ['Confirm appointment reminders are arriving'],
        createdAt: '2026-08-19T07:00:00.000Z',
        updatedAt: GENERATED_AT,
        stages: stages(),
        assignments: [],
        lensAbsences: [],
        executiveBoard: null,
        dependencies: [],
        blockers: [],
        persistentActionIds: [DASHBOARD_FIXTURE_ACTION_ID],
        replayCheckpoint: null,
        deepLink: `#/operate/cycles/${DASHBOARD_FIXTURE_CYCLE_ID}`,
      },
    ],
    inbox: [
      {
        itemId: 'verification:asg_reminder_delivery_0001',
        kind: 'verification',
        subjectId: 'asg_reminder_delivery_0001',
        ownerActorId: DASHBOARD_FIXTURE_ACTOR,
        state: 'available',
        title: 'Review tomorrow’s reminder delivery',
        consequence: 'Patients may miss appointment reminders until delivery is confirmed.',
        expiresAt: null,
        blocking: false,
        evidence: [],
        requiredParties: [],
        redactions: [],
        actionLocator: null,
        navigationLocator: null,
        unavailableReason: {
          code: 'OPERATE_VERIFICATION_SUBMISSION_UNAVAILABLE',
          message: 'A verified submission path is not available yet.',
        },
      },
    ],
    actions: [action],
    evidence: [
      {
        evidenceRefId: 'evref_reminder_delivery_0001',
        classification: 'internal',
        accessState: 'available',
        freshness: 'current',
        evidenceKind: 'operate-artifact',
        resolvedAt: GENERATED_AT,
        claimStatus: 'supported',
        supportClaimIds: [],
        contradictClaimIds: [],
        source: null,
        producer: null,
        observedAt: GENERATED_AT,
        scope: { scopeId: SCOPE_ID, domainId: DOMAIN_ID, domainVersion: DOMAIN_VERSION },
        sensitivity: 'internal',
        provenance: null,
        confidence: 0.8,
        gaps: [],
        errors: [],
        accessReason: null,
        causalLinks: [],
        deepLink: '#/operate/evidence/evref_reminder_delivery_0001',
      },
    ],
    claims: [],
    rationale: [],
    outcomes: [outcome],
    learnings: [
      {
        learningId: 'lrn_reminder_delivery_0001',
        outcomeId: outcome.outcomeId,
        statement: 'Restoring delivery is not the same as confirming patients received reminders.',
        decisionIds: [],
        evidenceRefIds: [],
        createdAt: GENERATED_AT,
      },
    ],
    history: [
      {
        eventId: 'event-reminder-delivery-action',
        sequence: 8,
        type: 'action.executed',
        entityId: DASHBOARD_FIXTURE_ACTION_ID,
        actorKind: 'human',
        actorId: DASHBOARD_FIXTURE_ACTOR,
        timestamp: GENERATED_AT,
        correlationId: 'correlation-reminder-delivery',
        eventHash: HASH_A,
        change: {
          subjectKind: 'action',
          summary: 'Appointment reminder delivery was restored for the pilot clinic.',
        },
        why: 'The team restored a safe setting and will review delivery data tomorrow.',
        authority: null,
        evidenceRefIds: [],
        prior: { previousEventHash: HASH_B, causationId: null },
        result: { status: 'succeeded', completedAt: GENERATED_AT },
        next: null,
        deepLinks: [action.deepLink],
        beforeAfter: null,
      },
    ],
    replay: {
      checkpoint: null,
      tail: {
        startSequence: 1,
        endSequence: 8,
        eventCount: 8,
        eventReplayIndexHash: HASH_A,
      },
      finalHead: EVENT_HEAD,
      liveAccessUsed: false,
      parityProof: {
        sourceStateHash: HASH_A,
        eventReplayIndexHash: HASH_A,
        checkpointVerified: false,
        finalEventHashMatches: true,
        stateParityVerified: true,
      },
      filterDimensions: ['cycle', 'action', 'operation', 'result', 'event-type'],
      redactions: [],
    },
    allowedActions: [{ subjectId: DASHBOARD_FIXTURE_ACTION_ID, action: allowedAction }],
    omissions: [],
    export: { formats: ['json'], accessSafe: true, redactionCount: 0 },
  };
  return buildOperateExperienceTransportView({ ...base, viewHash: sha256Jcs(base) });
}

function displayBinding(view, surface, subjectId = null) {
  return {
    actorId: view.actorId,
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
    generatedAt: view.generatedAt,
    eventHead: view.eventHead,
    viewHash: view.viewHash,
    projectId: DASHBOARD_FIXTURE_PROJECT_ID,
    generation: DASHBOARD_FIXTURE_GENERATION,
    surface,
    subjectId,
    cycleId: DASHBOARD_FIXTURE_CYCLE_ID,
  };
}

function selectSurface(view, surface, subjectId = null) {
  const binding = displayBinding(view, surface, subjectId);
  return assertOperateExperienceDisplaySurfaceV1(
    selectOperateExperienceDisplaySurface(view, {
      surface,
      binding,
      subjectId,
      cycleId: DASHBOARD_FIXTURE_CYCLE_ID,
    }),
    binding,
  );
}

function selectAudit(view, surface, subjectId = null) {
  const base = displayBinding(view, surface, subjectId);
  const binding = {
    actorId: base.actorId,
    scopeId: base.scopeId,
    domainId: base.domainId,
    domainVersion: base.domainVersion,
    generatedAt: base.generatedAt,
    eventHead: base.eventHead,
    viewHash: base.viewHash,
    cycleId: base.cycleId,
    subjectId,
    surface,
    query: null,
    format: null,
  };
  const selected = selectOperateExperienceAuditDisplaySurface(view, {
    surface,
    binding,
    subjectId,
    cycleId: DASHBOARD_FIXTURE_CYCLE_ID,
    query: '',
    format: 'json',
  });
  const errors = validateOperateExperienceAuditDisplaySurfaceV1(selected, binding);
  if (errors.length > 0) {
    throw new TypeError(`Invalid ${surface} fixture: ${JSON.stringify({ errors, selected })}`);
  }
  return assertOperateExperienceAuditDisplaySurfaceV1(selected, binding);
}

function selectCycle(view) {
  const cycle = view.cycles.find((entry) => entry.cycleId === DASHBOARD_FIXTURE_CYCLE_ID);
  if (!cycle) throw new TypeError('Cycle fixture is missing its exact Cycle.');
  const binding = displayBinding(view, 'cycle', DASHBOARD_FIXTURE_CYCLE_ID);
  const ledgerAction = {
    kind: 'operating-action',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    actionId: DASHBOARD_FIXTURE_ACTION_ID,
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
    sourceCycleId: DASHBOARD_FIXTURE_CYCLE_ID,
    sourceArtifactId: 'art_reminder_delivery_0001',
    title: 'Restore appointment reminder delivery',
    state: 'approved',
    ownerActorId: DASHBOARD_FIXTURE_ACTOR,
    accountabilityDisposition: null,
    sourceDecisionId: null,
    sourceFindingIds: [],
    dependsOnActionIds: [],
    objectiveId: 'obj_reminder_delivery_0001',
    expectedResult: 'Confirm appointment reminder delivery reaches the target.',
    metricId: 'met_reminder_delivery_0001',
    baseline: 86,
    target: 98,
    verificationWindow: 'next business day',
    verificationPlanId: 'vfy_reminder_delivery_0001',
    createdAt: cycle.createdAt,
    updatedAt: cycle.updatedAt,
  };
  const cycleLinks = [
    {
      entityKind: 'action',
      entityId: DASHBOARD_FIXTURE_ACTION_ID,
      cycleId: DASHBOARD_FIXTURE_CYCLE_ID,
      relation: 'source',
    },
  ];
  const allowedCycleActions = [
    {
      tool: 'operate.cycle.get',
      arguments: { cycleId: DASHBOARD_FIXTURE_CYCLE_ID },
      label: 'Inspect the current cycle',
      effect: 'read-only',
    },
  ];
  const cycleRead = {
    ok: true,
    operation: 'operate.cycle.get',
    data: {
      cycle: {
        kind: 'operating-cycle',
        schemaVersion: '1.0.0',
        protocolVersion: '2.0.0',
        cycleId: DASHBOARD_FIXTURE_CYCLE_ID,
        scopeId: view.scopeId,
        domainId: view.domainId,
        domainVersion: view.domainVersion,
        state: cycle.state,
        inputBindingId: 'inb_reminder_delivery_0001',
        contractVersions: {},
        trigger: { kind: 'manual' },
        focus: cycle.focus,
        health: cycle.health,
        activeReviewId: null,
        createdAt: cycle.createdAt,
        updatedAt: cycle.updatedAt,
      },
      progress: {
        total: 0,
        pending: 0,
        available: 0,
        active: 0,
        submitted: 0,
        validated: 0,
        rejected: 0,
        terminal: 0,
      },
      availableAssignments: [],
      acceptedArtifactIds: [],
      persistentWork: {
        ledger: {
          kind: 'operating-work-ledger',
          schemaVersion: '1.0.0',
          protocolVersion: '2.0.0',
          scopeId: view.scopeId,
          domainId: view.domainId,
          domainVersion: view.domainVersion,
          generatedAt: view.generatedAt,
          findings: [],
          decisions: [],
          actions: [ledgerAction],
          cycleLinks,
        },
        cycleLinks,
      },
      actions: allowedCycleActions,
    },
    allowedActions: allowedCycleActions,
  };
  const protocolErrors = validateProtocolArtifact('operate-api-envelope', cycleRead, {
    protocolVersion: '2.0.0',
  });
  if (protocolErrors.length > 0) {
    throw new TypeError(`Invalid Cycle owner fixture: ${JSON.stringify(protocolErrors)}`);
  }
  const options = {
    binding,
    subjectId: DASHBOARD_FIXTURE_CYCLE_ID,
  };
  const workspace = selectOperateCycleWorkspace(view, cycleRead, options);
  if (!workspace.ok) {
    throw new TypeError(`Invalid Cycle workspace fixture: ${JSON.stringify(workspace)}`);
  }
  const selected = selectOperateCycleDisplayWorkspace(view, cycleRead, options);
  if (selected?.kind !== 'operate-cycle-display-workspace') {
    throw new TypeError(`Invalid Cycle fixture: ${JSON.stringify(selected)}`);
  }
  return assertOperateCycleDisplayWorkspaceV1(selected, binding);
}

function selectAction(view) {
  const binding = {
    ...displayBinding(view, 'actions', DASHBOARD_FIXTURE_ACTION_ID),
    actionId: DASHBOARD_FIXTURE_ACTION_ID,
  };
  return assertOperateActionDisplayWorkspaceV1(
    selectOperateActionDisplayWorkspace(view, {
      binding,
      subjectId: DASHBOARD_FIXTURE_ACTION_ID,
      cycleId: DASHBOARD_FIXTURE_CYCLE_ID,
      commandsAvailable: true,
    }),
    binding,
  );
}

function selectRecovery(view) {
  const binding = displayBinding(view, 'recovery');
  const recoveryRead = {
    ok: true,
    operation: 'operate.recovery.inspect',
    data: {
      status: 'repairable',
      currentGeneration: 'gen_careloop_reminders_0001',
      recoverableGeneration: 'gen_careloop_reminders_0000',
      generationCount: 2,
      reason: 'A previous local edit did not close cleanly.',
      allowedRecovery: 'clear-stale-lock',
      lock: {
        status: 'stale',
        ownerPid: 4242,
        nonce: 'nonce-careloop-reminders',
        expiresAt: null,
        reason: 'stale lock',
      },
      integrityBoundary: {
        model: 'project-local-integrity',
        detects: ['accidental-corruption'],
        authenticity: 'not-provided',
        outsideBoundary: ['fully-coordinated-same-user-offline-rewrite'],
        futureRequirement: 'externally-anchored-or-signed-custody',
      },
    },
    allowedActions: [
      {
        tool: 'operate.recovery.clear-stale-lock',
        arguments: {},
        label: 'Archive the stale writer lock and retry safely',
        effect: 'machine-local-write',
      },
    ],
  };
  return assertOperateRecoveryDisplaySurfaceV1(
    selectOperateRecoveryDisplay(view, recoveryRead, { binding }),
    binding,
  );
}

function planningFixture() {
  const graph = {
    nodes: [
      {
        id: 'SPEC-020',
        type: 'spec',
        title: 'Improve appointment reminder delivery',
        status: 'in-progress',
        frontmatter: { id: 'SPEC-020' },
      },
    ],
    edges: [],
  };
  return {
    kind: 'planning-graph-snapshot',
    schemaVersion: '1.0.0',
    binding: {
      actorId: DASHBOARD_FIXTURE_ACTOR,
      projectId: DASHBOARD_FIXTURE_PROJECT_ID,
      scopeId: 'planning',
      domainId: 'planning',
      domainVersion: '1.0.0',
      generation: DASHBOARD_FIXTURE_GENERATION,
    },
    cursor: { eventHead: { sequence: 0, hash: null }, viewHash: sha256Jcs(graph) },
    mode: 'spec',
    graph,
  };
}

function planningTraceFixture(view) {
  const proposalId = 'oprop_reminder_delivery_0000000000000001';
  const proposalHash = HASH_B;
  const contentHash = HASH_A;
  const originHash = HASH_B;
  const slug = 'improve-appointment-reminder-delivery';
  return Object.freeze({
    receipt: Object.freeze({
      specId: 'SPEC-020',
      slug,
      transactionId: 'txn_reminder_delivery_0001',
      contentHash,
      originHash,
      receiptHash: HASH_A,
      proposalId,
      proposalHash,
      correlationId: 'corr_reminder_delivery_0001',
      provenanceEventId: 'prv_reminder_delivery_0001',
      planningHref: '#/detail/SPEC-020',
    }),
    origin: Object.freeze({
      specId: 'SPEC-020',
      proposalId,
      proposalRevision: 2,
      proposalHash,
      correlationId: 'corr_reminder_delivery_0001',
      originHash,
      actor: Object.freeze({ actorId: view.actorId, kind: 'human' }),
      scopeId: view.scopeId,
      domainId: view.domainId,
      domainVersion: view.domainVersion,
      cycleId: DASHBOARD_FIXTURE_CYCLE_ID,
      eventHead: view.eventHead,
      spec: Object.freeze({ specId: 'SPEC-020', contentHash }),
      action: Object.freeze({ id: DASHBOARD_FIXTURE_ACTION_ID, revision: 1, hash: HASH_A }),
      decision: Object.freeze({ id: 'dec_reminder_delivery_0001' }),
    }),
    progress: Object.freeze({
      nodes: Object.freeze([
        Object.freeze({
          kind: 'spec',
          label: 'SPEC-020 shaping',
          state: 'shaping',
          subjectId: 'SPEC-020',
          href: '#/detail/SPEC-020',
        }),
        Object.freeze({ kind: 'plan', label: 'PLAN', state: 'not-started', owner: 'Planning' }),
      ]),
    }),
    nextCommands: Object.freeze([
      'planr spec show SPEC-020',
      '$planr:plan SPEC-020',
      '/planr:plan SPEC-020',
    ]),
  });
}

export function createDashboardApiFixture() {
  const view = createExperienceView();
  const review = createPendingReviewDisplay(3, DASHBOARD_FIXTURE_REVIEW_IDENTITY);
  const bootstrap = {
    kind: 'dashboard-bootstrap',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    ui: {
      buildId: DASHBOARD_FIXTURE_BUILD_ID,
      expectedBuildId: DASHBOARD_FIXTURE_BUILD_ID,
      assetManifestHash: HASH_A,
    },
    server: { packageVersion: '0.42.0' },
    capabilities: {
      planningGraph: { schemaVersion: '1.0.0' },
      operateExperience: { protocolVersion: '2.0.0', schemaVersion: '1.0.0' },
      operateCommands: { protocolVersion: '2.0.0', transportVersion: '1.0.0', available: true },
      diagnostics: { schemaVersion: '1.0.0', available: true },
    },
    project: {
      projectId: DASHBOARD_FIXTURE_PROJECT_ID,
      name: 'CareLoop',
      branch: 'demo/appointment-reminders',
      products: ['planning', 'operate'],
    },
    queryRoots: {
      planning: {
        actorId: DASHBOARD_FIXTURE_ACTOR,
        projectId: DASHBOARD_FIXTURE_PROJECT_ID,
        scopeId: 'planning',
        domainId: 'planning',
        domainVersion: '1.0.0',
        generation: DASHBOARD_FIXTURE_GENERATION,
      },
      operate: {
        actorId: DASHBOARD_FIXTURE_ACTOR,
        projectId: DASHBOARD_FIXTURE_PROJECT_ID,
        scopeId: SCOPE_ID,
        domainId: DOMAIN_ID,
        domainVersion: DOMAIN_VERSION,
        generation: DASHBOARD_FIXTURE_GENERATION,
      },
    },
    origin: DASHBOARD_FIXTURE_ORIGIN,
    compatibility: { status: 'compatible', reasonCodes: [] },
  };
  return Object.freeze({
    bootstrap,
    planning: planningFixture(),
    today: selectSurface(view, 'today'),
    cycles: selectSurface(view, 'cycles'),
    cycle: selectCycle(view),
    review,
    inbox: selectSurface(view, 'inbox'),
    inboxItem: selectSurface(view, 'inbox', 'verification:asg_reminder_delivery_0001'),
    actions: selectSurface(view, 'actions'),
    action: selectAction(view),
    evidence: selectAudit(view, 'evidence'),
    evidenceItem: selectAudit(view, 'evidence', 'evref_reminder_delivery_0001'),
    outcomes: selectAudit(view, 'outcomes'),
    outcome: selectAudit(view, 'outcome', 'out_reminder_delivery_0001'),
    history: selectAudit(view, 'history'),
    recovery: selectRecovery(view),
    planningTrace: planningTraceFixture(view),
    view,
    allowedAction,
  });
}

export function createDashboardReviewTerminal(disposition, note) {
  return createTerminalReviewDisplay(note, DASHBOARD_FIXTURE_REVIEW_IDENTITY, disposition);
}
