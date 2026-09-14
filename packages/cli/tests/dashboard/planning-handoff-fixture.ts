import {
  buildOperateExperienceTransportView,
  selectOperateActionDisplayWorkspace,
} from 'planr-pipeline/dashboard/operate-experience-reader';
import { sha256Jcs } from 'planr-pipeline/protocol';
import type { OperateActionDisplayWorkspaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-action-display-workspace.mjs';
import { createOperateActionDisplayWorkspaceValidator } from '../../../../apps/dashboard/src/features/operate/actions/action-model.js';
import type {
  PlanningHandoffCreation,
  PlanningHandoffPreview,
} from '../../../../apps/dashboard/src/features/operate/planning/planning-actions.js';
import {
  isExactPlanningSpecPreview,
  type PlanningPreviewCurrent,
  resolvePlanningHandoffModel,
} from '../../../../apps/dashboard/src/features/operate/planning/planning-handoff-model.js';
import {
  type DashboardProductState,
  type DashboardProductStateKind,
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import {
  createDashboardQueryIdentity,
  type DashboardQueryIdentity,
} from '../../../../apps/dashboard/src/lib/binding/query-identity.js';

export { isExactPlanningSpecPreview, resolvePlanningHandoffModel };

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;

const framing = {
  title: 'Stabilize release verification',
  slug: 'stabilize-release-verification',
  problem: 'Release confidence is unreliable.',
  objective: 'Make verification explainable and repeatable.',
  users: ['Repository maintainer'],
  scope: ['Verification orchestration'],
  nonScope: ['Commit, deploy, publish'],
  risks: ['A stale signal may overstate readiness.'],
  constraints: ['Keep restart-safe custody.'],
  requirements: ['Render exact accepted evidence.'],
  acceptanceOutcomes: ['Verification completes within the declared window.'],
};

function productState<T>(
  kind: DashboardProductStateKind,
  binding: DashboardQueryIdentity,
  data: T,
  validateData: (value: unknown) => value is T,
  mutationEnabled = false,
): DashboardProductState<T> {
  return parseDashboardProductState<T>(
    {
      kind,
      binding,
      data: JSON.parse(JSON.stringify(data)),
      reasonCodes: kind === 'ready' ? [] : [`DASHBOARD_${kind.toUpperCase().replace('-', '_')}`],
      error: null,
      mutationEnabled,
      policy: dashboardProductStatePolicy(kind),
    },
    { currentBinding: binding, validateData },
  );
}

export function createPlanningHandoffModelFixture(actorId = 'owner-planning-handoff') {
  const actionId = 'act_planning_release_0001';
  const cycleId = 'cyc_planning_release_0001';
  const action = {
    actionId,
    revision: 2,
    actionHash: HASH_A,
    title: 'Stabilize release verification',
    state: 'approved',
    ownerActorId: actorId,
    expectedResult: 'Make delivery verification explainable.',
    verificationPlanId: 'verify_release_0001',
    deliveryRoute: {
      kind: 'operating-delivery-route',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      routeId: 'droute_release_0001',
      scopeId: 'scope-acme',
      domainId: 'software',
      domainVersion: '1.0.0',
      action: { actionId, revision: 2, actionHash: HASH_A },
      eventHead: { sequence: 8, hash: HASH_A },
      route: 'planning-work',
      rationale: 'Cross-functional delivery work is required.',
      createdAt: '2026-08-12T08:00:00Z',
      routeHash: HASH_B,
    },
    dependencyActionIds: [],
    executions: [],
    rollbacks: [],
    deepLink: `#/operate/actions/${encodeURIComponent(actionId)}`,
  };
  const base = {
    kind: 'operate-experience-view',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    viewId: 'xview_planning_release_0001',
    scopeId: 'scope-acme',
    domainId: 'software',
    domainVersion: '1.0.0',
    actorId,
    accessLevel: 'internal',
    generatedAt: '2026-08-12T08:00:00.000Z',
    eventHead: { sequence: 8, hash: HASH_A },
    sourceStateHash: HASH_A,
    status: 'ready',
    attention: [],
    domainMetrics: [],
    cycles: [
      {
        cycleId,
        state: 'approved',
        health: 'normal',
        focus: ['Release reliability'],
        createdAt: '2026-08-12T07:00:00Z',
        updatedAt: '2026-08-12T08:00:00Z',
        stages: ['observe', 'understand', 'decide', 'govern', 'act', 'verify', 'learn'].map(
          (id, index) => ({
            id,
            state: index < 5 ? 'complete' : index === 5 ? 'current' : 'waiting',
            reason: null,
            inputArtifactIds: [],
            outputArtifactIds: [],
            gates: [],
            evidenceGapIds: [],
            uncertaintyIds: [],
            persistentActionIds: index >= 4 ? [actionId] : [],
          }),
        ),
        assignments: [],
        lensAbsences: [],
        executiveBoard: null,
        dependencies: [],
        blockers: [],
        persistentActionIds: [actionId],
        replayCheckpoint: null,
        deepLink: '#/operate/cycles/cyc_planning_release_0001',
      },
    ],
    inbox: [],
    actions: [action],
    evidence: [],
    claims: [],
    rationale: [],
    outcomes: [],
    learnings: [],
    history: [],
    replay: {
      checkpoint: null,
      tail: { startSequence: 1, endSequence: 8, eventCount: 8, eventReplayIndexHash: HASH_A },
      finalHead: { sequence: 8, hash: HASH_A },
      liveAccessUsed: false,
      parityProof: {
        sourceStateHash: HASH_A,
        eventReplayIndexHash: HASH_A,
        checkpointVerified: false,
        stateParityVerified: false,
        finalEventHashMatches: true,
      },
      filterDimensions: [],
      redactions: [],
    },
    allowedActions: [],
    omissions: [],
    export: { formats: ['json'], accessSafe: true, redactionCount: 0 },
  };
  const view = buildOperateExperienceTransportView({
    ...base,
    viewHash: sha256Jcs(base),
  });
  const workspace = selectOperateActionDisplayWorkspace(view, {
    binding: {
      actorId: view.actorId,
      scopeId: view.scopeId,
      domainId: view.domainId,
      domainVersion: view.domainVersion,
      actionId,
      subjectId: actionId,
      generatedAt: view.generatedAt,
      eventHead: view.eventHead,
      viewHash: view.viewHash,
    },
    subjectId: actionId,
  }) as OperateActionDisplayWorkspaceV1;
  const binding = createDashboardQueryIdentity({
    productArea: 'operate',
    route: `#/operate/actions/${encodeURIComponent(actionId)}/planning`,
    actorId,
    projectId: sha256Jcs({ project: 'planning-handoff-fixture' } as never),
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
    cycleId,
    subjectId: actionId,
    eventHead: view.eventHead,
    viewHash: view.viewHash,
    generation: 1,
  });
  const validate = createOperateActionDisplayWorkspaceValidator(
    createDashboardQueryIdentity({
      ...binding,
      route: `#/operate/actions/${encodeURIComponent(actionId)}`,
    }),
  );
  const state = productState('ready', binding, workspace, validate, false);
  const proposal = {
    proposalId: 'oprop_planning_release_0001',
    proposalHash: HASH_B,
    state: 'review-required',
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
    cycleId,
    eventHead: view.eventHead,
    actor: { actorId },
    action: { actionId, revision: 2, actionHash: HASH_A },
    decision: {
      decisionId: 'dec_release_0001',
      title: 'Prioritize release reliability',
      rationale: 'Reliability comes before wider automation.',
    },
    acceptedPerspectiveSummaries: [
      {
        roleId: 'technology-risk',
        roleKind: 'advisor',
        stance: 'support',
        summary: 'Keep restart-safe verification.',
      },
    ],
    evidence: [
      {
        evidenceRefId: 'evidence_available_0001',
        summary: 'Lead time increased while verification retries rose.',
        relation: 'support',
        accessState: 'available',
      },
    ],
    framing,
    preview: {
      digest: HASH_C,
      issuedAt: '2026-08-12T08:00:00Z',
      expiresAt: '2099-08-12T08:10:00Z',
    },
  };
  const specPreview = {
    specId: 'SPEC-042',
    title: framing.title,
    slug: framing.slug,
    status: 'shaping',
    content: `# ${framing.title}\n\n## Problem\n${framing.problem}`,
    contentHash: HASH_A,
    proposalId: proposal.proposalId,
    proposalHash: proposal.proposalHash,
    eventHead: view.eventHead,
    previewDigest: HASH_C,
    generatedAt: '2026-08-12T08:00:00Z',
  };
  const previewPayload: PlanningHandoffPreview = Object.freeze({
    proposal,
    specPreview,
  });
  const creationPayload: PlanningHandoffCreation = Object.freeze({
    receipt: {
      transactionId: 'txn_planning_0001',
      receiptHash: HASH_B,
      correlationId: 'corr_planning_release_0001',
      proposalId: proposal.proposalId,
      proposalHash: proposal.proposalHash,
      specId: 'SPEC-042',
      title: framing.title,
      slug: framing.slug,
      contentHash: HASH_A,
      originHash: HASH_C,
      provenanceEventId: 'prv_planning_0001',
      planningHref: '#/detail/SPEC-042',
    },
    origin: {
      spec: { specId: 'SPEC-042', status: 'shaping', contentHash: HASH_A },
      originHash: HASH_C,
      proposalId: proposal.proposalId,
      proposalHash: proposal.proposalHash,
      correlationId: 'corr_planning_release_0001',
      decision: { id: 'dec_release_0001' },
      action: { id: actionId },
      eventHead: view.eventHead,
    },
    progress: {
      nodes: [
        {
          kind: 'spec',
          label: 'SPEC-042 shaping',
          state: 'shaping',
          subjectId: 'SPEC-042',
          href: '#/detail/SPEC-042',
        },
        { kind: 'plan', label: 'PLAN', state: 'not-started', owner: 'Planning' },
      ],
    },
    nextCommands: ['planr spec show SPEC-042', '$planr:plan SPEC-042', '/planr:plan SPEC-042'],
  });
  const current: PlanningPreviewCurrent = {
    actorId,
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
    action: proposal.action,
    eventHead: view.eventHead,
  };
  return {
    view,
    workspace,
    binding,
    state,
    proposal,
    specPreview,
    previewPayload,
    creationPayload,
    current,
  };
}
