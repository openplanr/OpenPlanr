import {
  assertOperateExperienceTransportView,
  selectOperateExperienceAuditDisplaySurface,
} from 'planr-pipeline/dashboard/operate-experience-reader';
import { sha256Jcs } from 'planr-pipeline/protocol';
import {
  assertOperateExperienceAuditDisplaySurfaceV1,
  type OperateAuditDisplayBindingV1,
  type OperateExperienceAuditDisplaySurfaceV1,
} from 'planr-pipeline/schemas/v1.2.0/operate-experience-audit-display-surface.mjs';
import { describe, expect, it } from 'vitest';
import {
  createOperateEvidenceDisplayValidator,
  resolveOperateEvidenceModel,
} from '../../../../apps/dashboard/src/features/operate/evidence/evidence-model.js';
import {
  createOperateHistoryAuxiliaryDisplayValidator,
  createOperateHistoryDisplayValidator,
  type OperateHistoryAuxiliaryRequest,
  resolveOperateHistoryAuxiliaryModel,
  resolveOperateHistoryModel,
} from '../../../../apps/dashboard/src/features/operate/history/history-model.js';
import {
  createOperateOutcomeDisplayValidator,
  resolveOperateOutcomeModel,
} from '../../../../apps/dashboard/src/features/operate/outcomes/outcome-model.js';
import {
  type DashboardProductState,
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import {
  createDashboardQueryIdentity,
  type DashboardQueryIdentity,
} from '../../../../apps/dashboard/src/lib/binding/query-identity.js';

type AuditDisplay = Readonly<OperateExperienceAuditDisplaySurfaceV1>;
type AuditSurface = AuditDisplay['requestBinding']['surface'];
type AuditRequest = Readonly<{
  surface: AuditSurface;
  query: string | null;
  format: 'json' | 'html' | null;
}>;

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;
const PROJECT_HASH = sha256Jcs({ project: 't020-dashboard-audit' } as never);
const CYCLE_ID = 'cycle-audit-1';
const EVIDENCE_ID = 'evidence-available';
const RESTRICTED_EVIDENCE_ID = 'evidence-restricted';
const CLAIM_ID = 'claim-retention';
const OUTCOME_ID = 'outcome-retention';
const ACTION_ID = 'act_audit_00000001';
const VERIFICATION_ID = 'verification-retention';
const PRIVATE_LINK_MARKER = 'private-missing-link-must-not-cross-audit-selection';
const HTML_MARKER = '<img src=x onerror="globalThis.__auditInjected=true">';
const GENERATED_AT = '2026-08-11T08:00:00.000Z';
const EVENT_HEAD = Object.freeze({ sequence: 1, hash: HASH_A });

function historyEvent() {
  return {
    eventId: 'event-audit-1',
    sequence: 1,
    type: 'cycle.started',
    entityId: CYCLE_ID,
    actorKind: 'engine',
    actorId: 'openplanr',
    timestamp: GENERATED_AT,
    correlationId: 'correlation-audit-1',
    eventHash: HASH_A,
    change: { subjectKind: 'cycle', summary: 'Retention Cycle started.' },
    why: 'The owner started the exact Cycle.',
    authority: null,
    evidenceRefIds: [EVIDENCE_ID],
    prior: { previousEventHash: null, causationId: null },
    result: null,
    next: null,
    deepLinks: [`#/operate/evidence/${EVIDENCE_ID}`, `#/operate/actions/${PRIVATE_LINK_MARKER}`],
    beforeAfter: null,
  };
}

function evidence(evidenceRefId: string, restricted: boolean) {
  return {
    evidenceRefId,
    classification: restricted ? 'restricted' : 'internal',
    accessState: restricted ? 'restricted' : 'available',
    freshness: 'current',
    evidenceKind: restricted ? null : 'operate-artifact',
    resolvedAt: restricted ? null : GENERATED_AT,
    claimStatus: restricted ? 'restricted' : 'supported',
    supportClaimIds: restricted ? [] : [CLAIM_ID],
    contradictClaimIds: [],
    source: null,
    producer: null,
    observedAt: restricted ? null : GENERATED_AT,
    scope: { scopeId: 'scope-audit', domainId: 'business', domainVersion: '1.0.0' },
    sensitivity: restricted ? 'restricted' : 'internal',
    provenance: null,
    confidence: restricted ? null : 0.91,
    gaps: [],
    errors: [],
    accessReason: restricted ? 'access-denied' : null,
    causalLinks: [],
    deepLink: `#/operate/evidence/${evidenceRefId}`,
  };
}

function action() {
  return {
    actionId: ACTION_ID,
    revision: 1,
    actionHash: HASH_A,
    title: 'Measure retention without inventing success',
    state: 'completed',
    ownerActorId: 'owner-audit',
    expectedResult: 'The exact Outcome remains evidence-bound.',
    verificationPlanId: VERIFICATION_ID,
    deliveryRoute: {
      kind: 'operating-delivery-route',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      routeId: 'droute_audit_00000001',
      scopeId: 'scope-audit',
      domainId: 'business',
      domainVersion: '1.0.0',
      action: { actionId: ACTION_ID, revision: 1, actionHash: HASH_A },
      eventHead: { ...EVENT_HEAD },
      route: 'observe-only',
      rationale: 'The audit representation is read-only.',
      createdAt: GENERATED_AT,
      routeHash: HASH_B,
    },
    dependencyActionIds: [],
    executions: [],
    rollbacks: [],
    deepLink: `#/operate/actions/${ACTION_ID}`,
  };
}

function metric() {
  return {
    metricId: 'metric-retention',
    title: 'Retention rate',
    value: null,
    unit: 'percent',
    change: null,
    window: '30 days',
    freshness: 'unknown',
    state: 'unavailable',
    target: 93,
    threshold: 90,
    evidenceRefIds: [],
    snapshot: null,
    delta: null,
    dueVerification: [
      {
        verificationPlanId: VERIFICATION_ID,
        actionId: ACTION_ID,
        state: 'insufficient-evidence',
        dueAt: null,
        window: '30 days',
        deepLink: `#/operate/actions/${ACTION_ID}`,
      },
    ],
    accessReason: null,
  };
}

function outcome() {
  return {
    outcomeId: OUTCOME_ID,
    actionId: ACTION_ID,
    verificationPlanId: VERIFICATION_ID,
    status: 'insufficient-evidence',
    metric: {
      metricId: 'metric-retention',
      metricHash: HASH_B,
      baseline: 89,
      target: 93,
      observed: null,
      unit: 'percent',
      window: '30 days',
      dueAt: null,
      freshness: 'unknown',
      confidence: null,
    },
    observationIds: [],
    evidenceRefIds: [],
    observedAt: GENERATED_AT,
    decision: {
      decisionId: 'decision-retention',
      revision: 1,
      state: 'approved',
      deepLink: '#/operate/inbox/decision-retention',
    },
    execution: [
      {
        resultId: 'result-retention',
        operationId: 'operation-retention',
        status: 'succeeded',
        completedAt: GENERATED_AT,
        effectSummary: {
          changed: true,
          summary: 'The contained effect completed; its Outcome remains unverified.',
          affectedTargetIds: ['target-retention'],
        },
        targetBeforeHash: HASH_A,
        targetAfterHash: HASH_C,
        accessReason: null,
        deepLink: '#/operate/history/operation-retention',
      },
    ],
    rollback: [],
    verification: {
      verificationPlanId: VERIFICATION_ID,
      verificationPlanHash: HASH_C,
      metricId: 'metric-retention',
      metricHash: HASH_B,
      method: 'Wait for one accepted observation.',
      evaluationRules: ['Do not infer success without an observation.'],
      observationRequest: {
        kind: 'future-observation',
        reason: 'Observe one full retention window.',
      },
      accessReason: null,
    },
    nextObservation: {
      kind: 'future-observation',
      reason: 'Observe one full retention window.',
      dueAt: null,
    },
    revisit: {
      decisionIds: ['decision-retention'],
      conditions: ['The target remains unobserved.'],
    },
    snapshot: null,
    delta: null,
    accessReason: null,
    deepLink: `#/operate/outcomes/${OUTCOME_ID}`,
  };
}

function experienceView() {
  const base = {
    kind: 'operate-experience-view',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    viewId: 'xview_audit_1234567890abcdef',
    scopeId: 'scope-audit',
    domainId: 'business',
    domainVersion: '1.0.0',
    actorId: 'owner-audit',
    accessLevel: 'internal',
    generatedAt: GENERATED_AT,
    eventHead: { ...EVENT_HEAD },
    sourceStateHash: HASH_B,
    status: 'ready',
    attention: [],
    domainMetrics: [metric()],
    cycles: [
      {
        cycleId: CYCLE_ID,
        state: 'approved',
        health: 'normal',
        focus: ['Retention'],
        createdAt: GENERATED_AT,
        updatedAt: GENERATED_AT,
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
        persistentActionIds: [ACTION_ID],
        replayCheckpoint: null,
        deepLink: `#/operate/cycles/${CYCLE_ID}`,
      },
    ],
    inbox: [],
    actions: [action()],
    evidence: [evidence(RESTRICTED_EVIDENCE_ID, true), evidence(EVIDENCE_ID, false)],
    claims: [
      {
        claimId: CLAIM_ID,
        status: 'supported',
        epistemicStatus: 'strongly-supported',
        statement: `Retention improved after onboarding changes. ${HTML_MARKER}`,
        supportEvidenceRefIds: [EVIDENCE_ID],
        contradictEvidenceRefIds: [],
        source: null,
        producer: null,
        observedAt: GENERATED_AT,
        scope: { scopeId: 'scope-audit', domainId: 'business', domainVersion: '1.0.0' },
        sensitivity: 'internal',
        provenance: null,
        confidence: 0.91,
        gaps: [],
        errors: [],
        accessReason: null,
        causalLinks: [],
        deepLink: `#/operate/evidence/${CLAIM_ID}`,
      },
    ],
    rationale: [],
    outcomes: [outcome()],
    learnings: [],
    history: [historyEvent()],
    replay: {
      checkpoint: null,
      tail: {
        startSequence: 1,
        endSequence: 1,
        eventCount: 1,
        eventReplayIndexHash: HASH_A,
      },
      finalHead: { ...EVENT_HEAD },
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
  };
  return Object.freeze({ ...base, viewHash: sha256Jcs(base as never) });
}

function request(
  surface: AuditSurface,
  query: string | null = null,
  format: 'json' | 'html' | null = null,
): AuditRequest {
  return Object.freeze({ surface, query, format });
}

function identityFor(surface: AuditSurface, generation = 1): DashboardQueryIdentity {
  const route =
    surface === 'evidence'
      ? `#/operate/evidence/${EVIDENCE_ID}`
      : surface === 'outcomes'
        ? '#/operate/outcomes'
        : surface === 'outcome'
          ? `#/operate/outcomes/${OUTCOME_ID}`
          : '#/operate/history';
  const subjectId =
    surface === 'evidence' ? EVIDENCE_ID : surface === 'outcome' ? OUTCOME_ID : null;
  const view = experienceView();
  return createDashboardQueryIdentity({
    productArea: 'operate',
    route,
    actorId: view.actorId,
    projectId: PROJECT_HASH,
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
    cycleId: CYCLE_ID,
    subjectId,
    eventHead: view.eventHead,
    viewHash: view.viewHash,
    generation,
  });
}

function ownerBinding(
  current: DashboardQueryIdentity,
  selection: AuditRequest,
): OperateAuditDisplayBindingV1 {
  const view = experienceView();
  return Object.freeze({
    actorId: current.actorId,
    scopeId: current.scopeId,
    domainId: current.domainId,
    domainVersion: current.domainVersion,
    cycleId: CYCLE_ID,
    subjectId:
      selection.surface === 'evidence' || selection.surface === 'outcome'
        ? current.subjectId
        : null,
    surface: selection.surface,
    query: selection.surface === 'search' ? selection.query : null,
    format: selection.surface === 'export' ? selection.format : null,
    generatedAt: view.generatedAt,
    eventHead: view.eventHead,
    viewHash: view.viewHash,
  });
}

function selectDisplay(current: DashboardQueryIdentity, selection: AuditRequest): AuditDisplay {
  const view = experienceView();
  assertOperateExperienceTransportView(view);
  const binding = ownerBinding(current, selection);
  const selected = selectOperateExperienceAuditDisplaySurface(view, {
    surface: selection.surface,
    binding,
    subjectId: binding.subjectId,
    cycleId: binding.cycleId,
    query: selection.query ?? '',
    format: selection.format ?? 'json',
  });
  if (
    typeof selected !== 'object' ||
    selected === null ||
    !('kind' in selected) ||
    selected.kind !== 'operate-experience-audit-display-surface'
  ) {
    throw new Error(`Owner refused ${selection.surface}: ${JSON.stringify(selected)}`);
  }
  return assertOperateExperienceAuditDisplaySurfaceV1(selected, binding);
}

function validatorFor(
  current: DashboardQueryIdentity,
  selection: AuditRequest,
): (value: unknown) => value is AuditDisplay {
  if (selection.surface === 'evidence') return createOperateEvidenceDisplayValidator(current);
  if (selection.surface === 'outcomes' || selection.surface === 'outcome') {
    return createOperateOutcomeDisplayValidator(current);
  }
  if (selection.surface === 'history') return createOperateHistoryDisplayValidator(current);
  return createOperateHistoryAuxiliaryDisplayValidator(
    current,
    selection as OperateHistoryAuxiliaryRequest,
  );
}

function stateFor(
  current: DashboardQueryIdentity,
  display: unknown,
  validateData: (value: unknown) => value is AuditDisplay,
): DashboardProductState<AuditDisplay> {
  return parseDashboardProductState<AuditDisplay>(
    {
      kind: 'ready',
      binding: current,
      data: structuredClone(display),
      reasonCodes: [],
      error: null,
      mutationEnabled: false,
      policy: dashboardProductStatePolicy('ready'),
    },
    { currentBinding: current, validateData },
  );
}

function resolve(
  state: DashboardProductState<unknown>,
  current: DashboardQueryIdentity,
  selection: AuditRequest,
) {
  if (selection.surface === 'evidence') return resolveOperateEvidenceModel(state, current);
  if (selection.surface === 'outcomes' || selection.surface === 'outcome') {
    return resolveOperateOutcomeModel(state, current);
  }
  if (selection.surface === 'history') return resolveOperateHistoryModel(state, current);
  return resolveOperateHistoryAuxiliaryModel(
    state,
    current,
    selection as OperateHistoryAuxiliaryRequest,
  );
}

const SURFACES = [
  request('evidence'),
  request('outcomes'),
  request('outcome'),
  request('history'),
  request('search', 'retention'),
  request('export', null, 'html'),
] as const;

describe('Operate audit browser boundary', () => {
  it('accepts all six owner-selected surfaces, preserves order, and keeps parser data immutable', () => {
    for (const selection of SURFACES) {
      const current = identityFor(selection.surface);
      const display = selectDisplay(current, selection);
      const state = stateFor(current, display, validatorFor(current, selection));
      const model = resolve(state, current, selection);

      expect(model, selection.surface).not.toBeNull();
      expect(model?.kind).toBe(selection.surface);
      expect(Object.isFrozen(state)).toBe(true);
      expect(Object.isFrozen(state.data)).toBe(true);
      expect(Object.isFrozen(state.data?.payload.data)).toBe(true);
      expect(model?.mutationEnabled).toBe(false);
    }

    const selection = request('evidence');
    const current = identityFor('evidence');
    const state = stateFor(
      current,
      selectDisplay(current, selection),
      validatorFor(current, selection),
    );
    const model = resolveOperateEvidenceModel(state, current);
    expect(model?.evidence.map((entry) => entry.evidenceRefId)).toEqual([
      RESTRICTED_EVIDENCE_ID,
      EVIDENCE_ID,
    ]);
  });

  it('refuses structural lookalikes and every foreign outer query identity as a whole surface', () => {
    const selection = request('history');
    const current = identityFor('history');
    const display = selectDisplay(current, selection);
    const state = stateFor(current, display, validatorFor(current, selection));
    const lookalike = Object.freeze({ ...state });
    expect(resolveOperateHistoryModel(lookalike, current)).toBeNull();

    const substitutions: readonly Partial<DashboardQueryIdentity>[] = [
      { actorId: 'owner-foreign' },
      { projectId: HASH_C },
      { scopeId: 'scope-foreign' },
      { domainId: 'software' },
      { domainVersion: '2.0.0' },
      { cycleId: 'cycle-foreign' },
      { eventHead: { sequence: 0, hash: null } },
      { viewHash: HASH_C },
      { generation: 2 },
      { route: '#/operate/evidence', subjectId: null },
    ];
    for (const substitution of substitutions) {
      const foreign = createDashboardQueryIdentity({ ...current, ...substitution });
      expect(resolveOperateHistoryModel(state, foreign), JSON.stringify(substitution)).toBeNull();
    }
  });

  it('rejects content, request-binding, replay, query, and format tamper before model access', () => {
    for (const selection of SURFACES) {
      const current = identityFor(selection.surface);
      const display = selectDisplay(current, selection);
      const tampered = structuredClone(display);
      tampered.payload.generatedAt = '2026-08-11T08:00:01.000Z';
      expect(() => stateFor(current, tampered, validatorFor(current, selection))).toThrow();
    }

    const evidenceRequest = request('evidence');
    const evidenceCurrent = identityFor('evidence');
    const foreignInnerBinding = structuredClone(selectDisplay(evidenceCurrent, evidenceRequest));
    foreignInnerBinding.requestBinding.actorId = 'owner-foreign';
    expect(() =>
      stateFor(
        evidenceCurrent,
        foreignInnerBinding,
        validatorFor(evidenceCurrent, evidenceRequest),
      ),
    ).toThrow();

    const historyRequest = request('history');
    const historyCurrent = identityFor('history');
    const history = structuredClone(selectDisplay(historyCurrent, historyRequest));
    history.payload.data.replay.finalHead = { sequence: 0, hash: null };
    expect(() =>
      stateFor(historyCurrent, history, validatorFor(historyCurrent, historyRequest)),
    ).toThrow();

    const searchRequest = request('search', 'retention');
    const searchCurrent = identityFor('search');
    const search = selectDisplay(searchCurrent, searchRequest);
    expect(
      createOperateHistoryAuxiliaryDisplayValidator(
        searchCurrent,
        request('search', 'other'),
      )(search),
    ).toBe(false);

    const exportRequest = request('export', null, 'html');
    const exportCurrent = identityFor('export');
    const exported = structuredClone(selectDisplay(exportCurrent, exportRequest));
    exported.requestBinding.format = 'json';
    expect(() =>
      stateFor(exportCurrent, exported, validatorFor(exportCurrent, exportRequest)),
    ).toThrow();
  });

  it('exposes only certified links, honest insufficient evidence, exact replay proof, and inert HTML bytes', () => {
    const evidenceRequest = request('evidence');
    const evidenceCurrent = identityFor('evidence');
    const evidenceState = stateFor(
      evidenceCurrent,
      selectDisplay(evidenceCurrent, evidenceRequest),
      validatorFor(evidenceCurrent, evidenceRequest),
    );
    const evidenceModel = resolveOperateEvidenceModel(evidenceState, evidenceCurrent);
    for (const entry of [...(evidenceModel?.evidence ?? []), ...(evidenceModel?.claims ?? [])]) {
      expect(entry.deepLink === null || /^#\/operate\/evidence\//u.test(entry.deepLink)).toBe(true);
    }

    const outcomeRequest = request('outcome');
    const outcomeCurrent = identityFor('outcome');
    const outcomeState = stateFor(
      outcomeCurrent,
      selectDisplay(outcomeCurrent, outcomeRequest),
      validatorFor(outcomeCurrent, outcomeRequest),
    );
    const outcomeModel = resolveOperateOutcomeModel(outcomeState, outcomeCurrent);
    expect(outcomeModel?.kind).toBe('outcome');
    if (outcomeModel?.kind === 'outcome') {
      expect(outcomeModel.outcome.status).toBe('insufficient-evidence');
      expect(outcomeModel.outcome.metric.observed).toBeNull();
      expect(outcomeModel.outcome.verification.metricHash).toBe(HASH_B);
    }

    const historyRequest = request('history');
    const historyCurrent = identityFor('history');
    const historyState = stateFor(
      historyCurrent,
      selectDisplay(historyCurrent, historyRequest),
      validatorFor(historyCurrent, historyRequest),
    );
    const historyModel = resolveOperateHistoryModel(historyState, historyCurrent);
    expect(historyModel?.replay.finalHead).toEqual(EVENT_HEAD);
    expect(JSON.stringify(historyModel)).not.toContain(PRIVATE_LINK_MARKER);

    const exportRequest = request('export', null, 'html');
    const exportCurrent = identityFor('export');
    const exportState = stateFor(
      exportCurrent,
      selectDisplay(exportCurrent, exportRequest),
      validatorFor(exportCurrent, exportRequest),
    );
    const exportModel = resolveOperateHistoryAuxiliaryModel(
      exportState,
      exportCurrent,
      exportRequest,
    );
    expect(exportModel?.kind).toBe('export');
    if (exportModel?.kind === 'export') {
      expect(exportModel.contentText).not.toContain(HTML_MARKER);
      expect(exportModel.contentText).toContain('&lt;img');
      expect(exportModel.contentText).not.toContain(PRIVATE_LINK_MARKER);
    }
  });
});
