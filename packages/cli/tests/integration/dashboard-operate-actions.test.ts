import {
  buildOperateExperienceTransportView,
  selectOperateActionDisplayWorkspace,
} from 'planr-pipeline/dashboard/operate-experience-reader';
import { sha256Jcs } from 'planr-pipeline/protocol';
import type { OperateActionDisplayWorkspaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-action-display-workspace.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createOperateActionDisplayWorkspaceValidator,
  resolveOperateActionModel,
} from '../../../../apps/dashboard/src/features/operate/actions/action-model.js';
import { readOperateActionWorkspace } from '../../../../apps/dashboard/src/features/operate/actions/operate-action-api.js';
import {
  type DashboardProductState,
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import {
  createDashboardQueryIdentity,
  type DashboardQueryIdentity,
} from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { createOperateClient } from '../../src/services/operate/client.js';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

type Workspace = Readonly<OperateActionDisplayWorkspaceV1>;

const projects: TestProject[] = [];
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const OTHER_HASH = `sha256:${'f'.repeat(64)}`;

afterEach(() => {
  for (const project of projects.splice(0)) project.cleanup();
});

function productState<T>(
  binding: DashboardQueryIdentity,
  data: T,
  validateData: (value: unknown) => value is T,
  mutationEnabled: boolean,
): DashboardProductState<T> {
  return parseDashboardProductState<T>(
    {
      kind: 'ready',
      binding,
      data: JSON.parse(JSON.stringify(data)),
      reasonCodes: [],
      error: null,
      mutationEnabled,
      policy: dashboardProductStatePolicy('ready'),
    },
    { currentBinding: binding, validateData },
  );
}

function bindingFor(
  project: TestProject,
  actorId: string,
  cycleId: string,
  actionId: string,
  workspace: Workspace,
  generation = 1,
): DashboardQueryIdentity {
  const payload = workspace.payload;
  return createDashboardQueryIdentity({
    productArea: 'operate',
    route: `#/operate/actions/${encodeURIComponent(actionId)}`,
    actorId,
    projectId: sha256Jcs({ project: project.dir } as never),
    scopeId: payload.scopeId,
    domainId: payload.domainId,
    domainVersion: payload.domainVersion,
    cycleId,
    subjectId: actionId,
    eventHead: payload.eventHead,
    viewHash: payload.viewHash,
    generation,
  });
}

function actionFixture(actorId = 'owner-actions') {
  const actionId = 'act_dashboard_00000001';
  const action = {
    actionId,
    revision: 1,
    actionHash: HASH_A,
    title: 'Apply bounded local change',
    state: 'approved',
    ownerActorId: actorId,
    expectedResult: 'Execution remains separate from verification.',
    verificationPlanId: 'vfy_dashboard_00000001',
    deliveryRoute: {
      kind: 'operating-delivery-route',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      routeId: 'droute_dashboard_00000001',
      scopeId: 'scope-dashboard-actions',
      domainId: 'software',
      domainVersion: '1.0.0',
      action: { actionId, revision: 1, actionHash: HASH_A },
      eventHead: { sequence: 8, hash: HASH_A },
      route: 'contained-execution',
      rationale: 'The exact bounded local effect is certified.',
      createdAt: '2026-08-11T08:00:00.000Z',
      routeHash: HASH_B,
    },
    dependencyActionIds: [],
    executions: [
      {
        resultId: 'res_dashboard_00000001',
        operationId: 'op_dashboard_00000001',
        status: 'succeeded',
        completedAt: '2026-08-11T08:00:00.000Z',
        effectSummary: {
          changed: true,
          summary: 'Applied one bounded local change.',
          affectedTargetIds: ['record-dashboard-0001'],
        },
        targetBeforeHash: HASH_A,
        targetAfterHash: HASH_B,
        accessReason: null,
        deepLink: `#/operate/actions/${encodeURIComponent(actionId)}`,
      },
    ],
    rollbacks: [],
    deepLink: `#/operate/actions/${encodeURIComponent(actionId)}`,
  };
  const outcome = {
    outcomeId: 'out_dashboard_00000001',
    actionId,
    verificationPlanId: 'vfy_dashboard_00000001',
    status: 'insufficient-evidence',
    metric: null,
    observationIds: [],
    evidenceRefIds: [],
    observedAt: '2026-08-11T08:00:00.000Z',
    decision: null,
    execution: [],
    rollback: [],
    verification: null,
    nextObservation: null,
    revisit: null,
    snapshot: null,
    delta: null,
    accessReason: null,
    deepLink: '#/operate/outcomes/out_dashboard_00000001',
  };
  const base = {
    kind: 'operate-experience-view',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    viewId: 'xview_dashboard_actions',
    scopeId: 'scope-dashboard-actions',
    domainId: 'software',
    domainVersion: '1.0.0',
    actorId,
    accessLevel: 'internal',
    generatedAt: '2026-08-11T08:00:00.000Z',
    eventHead: { sequence: 8, hash: HASH_A },
    sourceStateHash: HASH_A,
    status: 'ready',
    attention: [],
    domainMetrics: [],
    cycles: [
      {
        cycleId: 'cyc_dashboard_actions',
        state: 'executing',
        health: 'normal',
        focus: ['Governed local work'],
        createdAt: '2026-08-11T07:00:00.000Z',
        updatedAt: '2026-08-11T08:00:00.000Z',
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
        deepLink: '#/operate/cycles/cyc_dashboard_actions',
      },
    ],
    inbox: [],
    actions: [action],
    evidence: [],
    claims: [],
    rationale: [],
    outcomes: [outcome],
    learnings: [],
    history: [
      {
        eventId: 'event-dashboard-action',
        sequence: 8,
        type: 'action.executed',
        entityId: actionId,
        actorKind: 'human',
        actorId,
        timestamp: '2026-08-11T08:00:00.000Z',
        correlationId: 'correlation-dashboard-action',
        eventHash: HASH_A,
        change: { subjectKind: 'action', summary: 'Execution completed.' },
        why: 'The governed Action executed once.',
        authority: null,
        evidenceRefIds: [],
        prior: { previousEventHash: HASH_B, causationId: null },
        result: { status: 'succeeded', completedAt: '2026-08-11T08:00:00.000Z' },
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
      finalHead: { sequence: 8, hash: HASH_A },
      liveAccessUsed: false,
      parityProof: {
        sourceStateHash: HASH_A,
        eventReplayIndexHash: HASH_A,
        checkpointVerified: false,
        finalEventHashMatches: true,
        stateParityVerified: false,
      },
      filterDimensions: ['action', 'operation', 'result'],
      redactions: [],
    },
    allowedActions: [
      {
        subjectId: actionId,
        action: {
          tool: 'operate.action.rollback',
          arguments: {
            action: { actionId, revision: 1, actionHash: HASH_A },
            originalOperationId: 'op_dashboard_00000001',
            rollbackPlanId: 'rbp_dashboard_00000001',
          },
          label: 'Restore the certified local baseline',
          effect: 'project-write',
        },
      },
    ],
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
    commandsAvailable: true,
  }) as Workspace;
  return { view, workspace, actionId, cycleId: 'cyc_dashboard_actions' };
}

describe('dashboard operate action transport', () => {
  it('keeps execution, verification, and rollback boundaries explicit in the owner display', async () => {
    const project = await createTestProject('dashboard-operate-actions-fixture');
    projects.push(project);
    const actorId = 'owner-dashboard-actions';
    const { workspace, actionId, cycleId } = actionFixture(actorId);
    const binding = bindingFor(project, actorId, cycleId, actionId, workspace);
    expect(createOperateActionDisplayWorkspaceValidator(binding)(workspace)).toBe(true);

    const model = resolveOperateActionModel(
      productState(
        binding,
        workspace,
        createOperateActionDisplayWorkspaceValidator(binding),
        workspace.payload.mutationEnabled,
      ),
      binding,
    );
    expect(model).not.toBeNull();
    expect(model?.action.state).toBe('approved');
    expect(model?.action.executions.at(-1)?.status).toBe('succeeded');
    expect(model?.outcome?.status).toBe('insufficient-evidence');
    expect(model?.verification.status).toBe('unverified');
    expect(model?.allowedActions[0]?.action.tool).toBe('operate.action.rollback');
    expect(model?.mutationEnabled).toBe(true);
    expect(model?.boundaries.approvalExecution).toContain('approval');
    expect(JSON.stringify(model)).not.toContain('integrityBoundary');
  });

  it('refuses foreign binding custody and stale view hashes', async () => {
    const project = await createTestProject('dashboard-operate-actions-binding');
    projects.push(project);
    const actorId = 'owner-dashboard-actions-binding';
    const { workspace, actionId, cycleId } = actionFixture(actorId);
    const binding = bindingFor(project, actorId, cycleId, actionId, workspace);
    const foreign = createDashboardQueryIdentity({
      ...binding,
      viewHash: OTHER_HASH,
    });
    expect(
      resolveOperateActionModel(
        productState(
          binding,
          workspace,
          createOperateActionDisplayWorkspaceValidator(binding),
          workspace.payload.mutationEnabled,
        ),
        foreign,
      ),
    ).toBeNull();
  });

  it('reads recovery display from a fresh project without inventing legal actions', async () => {
    const project = await createTestProject('dashboard-operate-actions-recovery');
    projects.push(project);
    const client = createOperateClient(project.dir);
    const actor = { actorId: 'owner-recovery', kind: 'human' as const, runtime: 'openplanr' };
    const started = await client.dispatch({
      operation: 'operate.cycle.start',
      request: {
        scope: {
          scopeId: 'scope-recovery-read',
          domainId: 'software',
          domainVersion: '1.0.0',
        },
        focus: ['Recovery read transport'],
        trigger: { kind: 'manual' },
        mode: 'standard',
        ownerActorId: actor.actorId,
        deliveryRoute: 'observe-only',
      },
    });
    if (!started.ok) throw new Error(JSON.stringify(started));
    const cycleId = String((started.data as { cycle: { cycleId: string } }).cycle.cycleId);
    const display = await client.readRecoveryDisplay(cycleId, actor);
    expect(display).toMatchObject({
      kind: 'operate-recovery-display-surface',
      payload: {
        kind: 'operate-recovery',
        mutationEnabled: false,
        data: {
          recoveryState: expect.any(String),
          inspection: expect.objectContaining({ status: expect.any(String) }),
        },
      },
    });
    expect(JSON.stringify(display)).not.toContain('integrityBoundary');
  });

  it('refuses readActionWorkspace when the action is absent from the projection', async () => {
    const project = await createTestProject('dashboard-operate-actions-missing');
    projects.push(project);
    const client = createOperateClient(project.dir);
    const actor = { actorId: 'owner-missing-action', kind: 'human' as const, runtime: 'openplanr' };
    const started = await client.dispatch({
      operation: 'operate.cycle.start',
      request: {
        scope: {
          scopeId: 'scope-missing-action',
          domainId: 'software',
          domainVersion: '1.0.0',
        },
        focus: ['No projected action'],
        trigger: { kind: 'manual' },
        mode: 'standard',
        ownerActorId: actor.actorId,
        deliveryRoute: 'observe-only',
      },
    });
    if (!started.ok) throw new Error(JSON.stringify(started));
    const cycleId = String((started.data as { cycle: { cycleId: string } }).cycle.cycleId);
    const response = await client.readActionWorkspace('act_missing_00000001', cycleId, actor);
    expect(response).toMatchObject({
      ok: false,
      error: expect.objectContaining({ reasonCode: 'OPERATE_PROJECTION_STALE' }),
    });
    await expect(
      readOperateActionWorkspace(client, 'act_missing_00000001', cycleId, actor),
    ).rejects.toThrow(/did not verify/i);
  });
});
