// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import {
  buildOperateExperienceTransportView,
  selectOperateActionDisplayWorkspace,
  selectOperateExperienceDisplaySurface,
  selectOperateRecoveryDisplay,
} from 'planr-pipeline/dashboard/operate-experience-reader';
import { sha256Jcs } from 'planr-pipeline/protocol';
import type { OperateActionDisplayWorkspaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-action-display-workspace.mjs';
import {
  assertOperateExperienceDisplaySurfaceV1,
  assertOperateExperiencePreviewV1,
  type OperateExperienceDisplaySurfaceV1,
} from 'planr-pipeline/schemas/v1.2.0/operate-experience-display-surface.mjs';
import type { OperateRecoveryDisplaySurfaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-recovery-display-surface.mjs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DashboardProviders } from '../../../../apps/dashboard/src/app/providers.js';
import { ActionDetailPage } from '../../../../apps/dashboard/src/features/operate/actions/ActionDetailPage.js';
import { ActionsPage } from '../../../../apps/dashboard/src/features/operate/actions/ActionsPage.js';
import type {
  ActionActionConfirmation,
  ActionActions,
} from '../../../../apps/dashboard/src/features/operate/actions/action-actions.js';
import { createOperateActionDisplayWorkspaceValidator } from '../../../../apps/dashboard/src/features/operate/actions/action-model.js';
import { createOperateActionsSurfaceValidator } from '../../../../apps/dashboard/src/features/operate/actions/actions-list-model.js';
import { RecoveryPage } from '../../../../apps/dashboard/src/features/operate/recovery/RecoveryPage.js';
import { createOperateRecoveryDisplayValidator } from '../../../../apps/dashboard/src/features/operate/recovery/recovery-model.js';
import { UnifiedShell } from '../../../../apps/dashboard/src/features/shell/UnifiedShell.js';
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

type ActionWorkspace = Readonly<OperateActionDisplayWorkspaceV1>;
type ActionsDisplay = Readonly<OperateExperienceDisplaySurfaceV1>;
type RecoveryDisplay = Readonly<OperateRecoveryDisplaySurfaceV1>;

type ActionFixture = Readonly<{
  actionId: string;
  cycleId: string;
  actorId: string;
  workspace: ActionWorkspace;
  actionsDisplay: ActionsDisplay;
  recoveryDisplay: RecoveryDisplay;
  publicText: string;
  listBinding: DashboardQueryIdentity;
  detailBinding: DashboardQueryIdentity;
  recoveryBinding: DashboardQueryIdentity;
}>;

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const PRODUCTION_SOURCE = [
  'actions/ActionsPage.tsx',
  'actions/ActionDetailPage.tsx',
  'actions/actions-list-model.ts',
  'actions/action-model.ts',
  'recovery/RecoveryPage.tsx',
  'recovery/recovery-model.ts',
]
  .map((file) =>
    readFileSync(
      resolve(TEST_ROOT, '../../../../apps/dashboard/src/features/operate', file),
      'utf8',
    ),
  )
  .join('\n');
const ACTION_STYLES = readFileSync(
  resolve(TEST_ROOT, '../../../../apps/dashboard/src/features/shell/unified-shell.css'),
  'utf8',
);
const TAMPER_SENTINEL = 'UNVERIFIED_TAMPER_MUST_NOT_RENDER';
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const OTHER_HASH = `sha256:${'f'.repeat(64)}`;

function renderStatic(element: Parameters<typeof render>[0]): string {
  const { container } = render(element);
  return container.innerHTML;
}

let fixture: ActionFixture;

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

function bindingFor(
  payload: Pick<ActionFixture, 'actionId' | 'cycleId' | 'actorId' | 'workspace'>,
  route: '#/operate/actions' | `#/operate/actions/${string}` | '#/operate/recovery',
  generation = 17,
): DashboardQueryIdentity {
  const workspacePayload = payload.workspace.payload;
  const detail = route.startsWith('#/operate/actions/');
  return createDashboardQueryIdentity({
    productArea: 'operate',
    route,
    actorId: payload.actorId,
    projectId: sha256Jcs({ project: `t017-${payload.actionId}` } as never),
    scopeId: workspacePayload.scopeId,
    domainId: workspacePayload.domainId,
    domainVersion: workspacePayload.domainVersion,
    cycleId: payload.cycleId,
    subjectId: detail ? payload.actionId : null,
    eventHead: workspacePayload.eventHead,
    viewHash: workspacePayload.viewHash,
    generation,
  });
}

function surfaceBinding(view: Record<string, unknown>) {
  return {
    actorId: String(view.actorId),
    scopeId: String(view.scopeId),
    domainId: String(view.domainId),
    domainVersion: String(view.domainVersion),
    generatedAt: String(view.generatedAt),
    eventHead: view.eventHead,
    viewHash: String(view.viewHash),
  } as const;
}

function deepFreeze<T>(value: T): T {
  const seen = new WeakSet<object>();
  const freeze = (entry: unknown): void => {
    if (entry === null || typeof entry !== 'object' || seen.has(entry)) return;
    seen.add(entry);
    for (const nested of Object.values(entry)) freeze(nested);
    Object.freeze(entry);
  };
  const clone = structuredClone(value);
  freeze(clone);
  return clone;
}

function buildFixture(actorId = 'owner-t017-actions', commandsAvailable = false): ActionFixture {
  const actionId = 'act_t017_00000001';
  const publicText =
    'C#/.NET API/CLI docs: https://[2001:db8::1]/guide?q=$HOME#$(pwd); run `echo ~/repo`.';
  const action = {
    actionId,
    revision: 1,
    actionHash: HASH_A,
    title: publicText,
    state: 'approved',
    ownerActorId: actorId,
    expectedResult: 'Execution remains separate from verification.',
    verificationPlanId: 'vfy_t017_00000001',
    deliveryRoute: {
      kind: 'operating-delivery-route',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      routeId: 'droute_t017_00000001',
      scopeId: 'scope-t017-actions',
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
        resultId: 'res_t017_00000001',
        operationId: 'op_t017_00000001',
        status: 'succeeded',
        completedAt: '2026-08-11T08:00:00.000Z',
        effectSummary: {
          changed: true,
          summary: 'Applied one bounded local change.',
          affectedTargetIds: ['record-t017-0001'],
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
    outcomeId: 'out_t017_00000001',
    actionId,
    verificationPlanId: 'vfy_t017_00000001',
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
    deepLink: '#/operate/outcomes/out_t017_00000001',
  };
  const base = {
    kind: 'operate-experience-view',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    viewId: 'xview_t017_actions',
    scopeId: 'scope-t017-actions',
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
        cycleId: 'cyc_t017_actions',
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
        deepLink: '#/operate/cycles/cyc_t017_actions',
      },
    ],
    inbox: [],
    actions: [action],
    evidence: [],
    claims: [],
    rationale: [],
    outcomes: [outcome],
    learnings: [
      {
        learningId: 'lrn_t017_00000001',
        outcomeId: 'out_t017_00000001',
        statement: 'Governed local work requires explicit verification before promoting results.',
        decisionIds: [],
        evidenceRefIds: [],
        createdAt: '2026-08-11T09:00:00.000Z',
      },
    ],
    history: [
      {
        eventId: 'event-t017-action',
        sequence: 8,
        type: 'action.executed',
        entityId: actionId,
        actorKind: 'human',
        actorId,
        timestamp: '2026-08-11T08:00:00.000Z',
        correlationId: 'correlation-t017-action',
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
            originalOperationId: 'op_t017_00000001',
            rollbackPlanId: 'rbp_t017_00000001',
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
  const binding = surfaceBinding(view);
  const workspace = deepFreeze(
    selectOperateActionDisplayWorkspace(view, {
      binding: { ...binding, actionId, subjectId: actionId },
      subjectId: actionId,
      commandsAvailable,
    }) as ActionWorkspace,
  );
  const actionsDisplay = deepFreeze(
    assertOperateExperienceDisplaySurfaceV1(
      selectOperateExperienceDisplaySurface(view, {
        surface: 'actions',
        binding: {
          ...binding,
          projectId: sha256Jcs({ project: `t017-${actionId}` } as never),
          generation: 17,
          surface: 'actions',
          subjectId: null,
          cycleId: 'cyc_t017_actions',
        },
        cycleId: 'cyc_t017_actions',
      }),
      {
        actorId: binding.actorId,
        scopeId: binding.scopeId,
        domainId: binding.domainId,
        domainVersion: binding.domainVersion,
        generatedAt: binding.generatedAt,
        eventHead: binding.eventHead,
        viewHash: binding.viewHash,
        projectId: sha256Jcs({ project: `t017-${actionId}` } as never),
        generation: 17,
        surface: 'actions',
        subjectId: null,
        cycleId: 'cyc_t017_actions',
      },
    ),
  );
  const recoveryRead = {
    ok: true,
    operation: 'operate.recovery.inspect',
    data: {
      status: 'repairable',
      currentGeneration: 'gen_t017_00000001',
      recoverableGeneration: 'gen_t017_00000000',
      generationCount: 2,
      reason: 'A stale writer lock was detected.',
      allowedRecovery: 'clear-stale-lock',
      lock: {
        status: 'stale',
        ownerPid: 4242,
        nonce: 'nonce-t017',
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
  const recoveryRaw = selectOperateRecoveryDisplay(view, recoveryRead, {
    binding,
  });
  if (
    typeof recoveryRaw !== 'object' ||
    recoveryRaw === null ||
    (recoveryRaw as { kind?: string }).kind !== 'operate-recovery-display-surface'
  ) {
    throw new Error(`Recovery display failed: ${JSON.stringify(recoveryRaw)}`);
  }
  const recoveryDisplay = deepFreeze(recoveryRaw as RecoveryDisplay);
  const cycleId = 'cyc_t017_actions';
  const partial = {
    actionId,
    cycleId,
    actorId,
    workspace,
    actionsDisplay,
    recoveryDisplay,
    publicText,
  };
  const built = {
    ...partial,
    listBinding: bindingFor(partial, '#/operate/actions'),
    detailBinding: bindingFor(partial, `#/operate/actions/${encodeURIComponent(actionId)}`),
    recoveryBinding: bindingFor(partial, '#/operate/recovery'),
  };
  const listOk = createOperateActionsSurfaceValidator(built.listBinding)(actionsDisplay);
  const detailOk = createOperateActionDisplayWorkspaceValidator(built.detailBinding)(workspace);
  const recoveryOk = createOperateRecoveryDisplayValidator(built.recoveryBinding)(recoveryDisplay);
  if (!listOk || !detailOk || !recoveryOk) {
    throw new Error(
      `T-017 display contracts: list=${listOk} detail=${detailOk} recovery=${recoveryOk}`,
    );
  }
  return Object.freeze(built);
}

function listState(
  current: ActionFixture = fixture,
  display: ActionsDisplay = current.actionsDisplay,
): DashboardProductState<ActionsDisplay> {
  return productState(
    'ready',
    current.listBinding,
    display,
    createOperateActionsSurfaceValidator(current.listBinding),
    display.payload.mutationEnabled,
  );
}

function detailState(
  current: ActionFixture = fixture,
  workspace: ActionWorkspace = current.workspace,
): DashboardProductState<ActionWorkspace> {
  return productState(
    'ready',
    current.detailBinding,
    workspace,
    createOperateActionDisplayWorkspaceValidator(current.detailBinding),
    workspace.payload.mutationEnabled,
  );
}

function actionPreviewFixture(current: ActionFixture) {
  const payload = current.workspace.payload;
  const action = payload.data.action;
  const allowedAction = payload.data.allowedActions[0]?.action;
  if (!allowedAction) throw new Error('Expected one runtime-issued Action for the fixture.');
  const actionDigest = sha256Jcs(allowedAction as never);
  const base = {
    kind: 'operate-experience-preview',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    previewId: 'xprv_t017_1234567890abcdef',
    scopeId: payload.scopeId,
    domainId: payload.domainId,
    domainVersion: payload.domainVersion,
    actorId: payload.actorId,
    subject: {
      kind: 'action',
      id: current.actionId,
      revision: action.revision,
      hash: action.actionHash,
    },
    eventHead: payload.eventHead,
    sourceViewHash: payload.viewHash,
    actionDigest,
    allowedAction,
    authority: 'allowed',
    consequence: 'Review the certified rollback before confirming.',
    reasonCodes: [],
    transition: {
      kind: 'rollback',
      targets: [
        {
          kind: 'operating-action',
          id: current.actionId,
          revision: action.revision,
          hash: action.actionHash,
          disposition: 'rolling-back',
        },
      ],
      reversible: false,
      nextState: 'rolling-back',
      threshold: null,
    },
    issuedAt: '2026-08-11T08:00:00.000Z',
    expiresAt: '2099-08-11T08:10:00.000Z',
  };
  return assertOperateExperiencePreviewV1(
    { ...base, previewHash: sha256Jcs(base as never) },
    {
      actorId: payload.actorId,
      scopeId: payload.scopeId,
      domainId: payload.domainId,
      domainVersion: payload.domainVersion,
      eventHead: payload.eventHead,
      sourceViewHash: payload.viewHash,
      subjectId: current.actionId,
      actionDigest,
    },
  );
}

function recoveryState(
  current: ActionFixture = fixture,
  display: RecoveryDisplay = current.recoveryDisplay,
): DashboardProductState<RecoveryDisplay> {
  return productState(
    'ready',
    current.recoveryBinding,
    display,
    createOperateRecoveryDisplayValidator(current.recoveryBinding),
    false,
  );
}

function mutation<T>(value: T, change: (draft: T) => void): T {
  const draft = structuredClone(value);
  change(draft);
  return draft;
}

beforeAll(() => {
  fixture = buildFixture();
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  fixture = undefined as never;
});

describe('operate actions and recovery UI', () => {
  it('renders the Actions collection from an exact experience surface', () => {
    const html = renderStatic(
      <ActionsPage currentBinding={fixture.listBinding} current={listState()} />,
    );
    expect(html).toContain('Review approved work, its outcome, and the next safe step.');
    expect(html).toContain(fixture.publicText);
    expect(html).toContain(`aria-label="Open ${fixture.publicText}"`);
    expect(html).not.toContain('Unified boot and first use');
  });

  it('renders Action detail boundaries, execution, and verification warnings', () => {
    const html = renderStatic(
      <ActionDetailPage currentBinding={fixture.detailBinding} current={detailState()} />,
    );
    expect(html).toContain('Approval does not make a change');
    expect(html).toContain('The change is complete; its result is still being checked');
    expect(html).toContain('More evidence is needed');
    expect(html).toContain('Applied one bounded local change.');
    expect(html).toContain('Restore the certified local baseline');
  });

  it('keeps the ready Action workspace product-first while retaining audit data in closed details', () => {
    const { container } = render(
      <ActionDetailPage currentBinding={fixture.detailBinding} current={detailState()} />,
    );
    const header = container.querySelector('.op-action-detail__header');
    const details = [
      ...container.querySelectorAll<HTMLDetailsElement>('.op-action-detail__technical-details'),
    ];

    expect(header?.textContent).toContain('planr-operate · action');
    expect(header?.textContent).toContain('Approved');
    expect(header?.textContent).toContain('No dependencies');
    expect(header?.textContent).not.toContain(fixture.actionId);
    expect(header?.textContent).not.toContain(HASH_A);
    expect(container.textContent).toContain('More evidence is needed');
    expect(details).toHaveLength(4);
    expect(details.every((entry) => !entry.open)).toBe(true);
    expect(details[0]?.textContent).toContain(fixture.actionId);
    expect(details[0]?.textContent).toContain(HASH_A);
  });

  it('repeats the exact runtime-issued Action label throughout high-stakes confirmation', async () => {
    const commandable = buildFixture('owner-t017-confirmation-label', true);
    const issuedPreview = actionPreviewFixture(commandable);
    const confirm = vi.fn().mockResolvedValue<ActionActionConfirmation>({
      ok: true,
      eventHead: { sequence: 9, hash: HASH_B },
    });
    const onRefetch = vi.fn().mockResolvedValue(detailState(commandable));
    const actions = Object.freeze({
      bind: vi.fn(),
      preview: vi.fn(() =>
        Promise.resolve(Object.freeze({ preview: issuedPreview, confirm, cancel: vi.fn() })),
      ),
      reconcile: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn(),
    }) satisfies ActionActions;
    const user = userEvent.setup();
    render(
      <ActionDetailPage
        currentBinding={commandable.detailBinding}
        current={detailState(commandable)}
        actions={actions}
        onRefetch={onRefetch}
      />,
    );

    const label = issuedPreview.allowedAction.label;
    await user.click(screen.getByRole('button', { name: label }));
    const dialog = await screen.findByRole('alertdialog', { name: `Confirm ${label}` });
    expect(
      within(dialog).getByText(`You are about to ${label}. ${issuedPreview.consequence}`),
    ).toBeTruthy();
    const confirmButton = within(dialog).getByRole('button', { name: `Confirm ${label}` });
    await user.click(confirmButton);
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    await waitFor(() => expect(onRefetch).toHaveBeenCalledOnce());
  });

  it('retains the Action uncertainty lock when exact refetch fails', async () => {
    const commandable = buildFixture('owner-t017-action-reconciliation', true);
    const uncertainty = Object.assign(new Error('preview acknowledgement lost'), {
      name: 'OPERATION_UNCERTAIN',
    });
    const reconcile = vi.fn();
    const actions = Object.freeze({
      bind: vi.fn(),
      preview: vi.fn().mockRejectedValue(uncertainty),
      reconcile,
      cancel: vi.fn(),
      dispose: vi.fn(),
    }) satisfies ActionActions;
    const onRefetch = vi.fn().mockRejectedValueOnce(new Error('verified refetch failed'));
    const user = userEvent.setup();
    render(
      <ActionDetailPage
        currentBinding={commandable.detailBinding}
        current={detailState(commandable)}
        actions={actions}
        onRefetch={onRefetch}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Restore the certified local baseline' }));
    await screen.findByText(/We could not confirm the current action status/u);
    const reconcileControl = screen.getByRole('button', { name: 'Reconcile current Action' });
    await waitFor(() => expect((reconcileControl as HTMLButtonElement).disabled).toBe(false));
    expect(onRefetch).toHaveBeenCalledOnce();
    expect(reconcile).not.toHaveBeenCalled();

    onRefetch.mockResolvedValue(detailState(commandable));
    await user.click(reconcileControl);
    await screen.findByText(/The current action status is confirmed/u);
    expect(reconcile).toHaveBeenCalledWith(commandable.detailBinding);
  });

  it('renders result, outcome, and learning as visually distinct sections', () => {
    const html = renderStatic(
      <ActionDetailPage currentBinding={fixture.detailBinding} current={detailState()} />,
    );
    expect(html).toContain('data-result-kind="execution"');
    expect(html).toContain('data-result-kind="outcome"');
    expect(html).toContain('data-result-kind="learning"');
    expect(html).toContain('Execution result');
    expect(html).toContain('Outcome');
    expect(html).toContain('What we learned');
    expect(html).toContain('Governed local work requires explicit verification');
    expect(html).toContain('More evidence is needed');
  });

  it('renders Recovery states and legal recovery controls as disabled governed actions', () => {
    const html = renderStatic(
      <RecoveryPage currentBinding={fixture.recoveryBinding} current={recoveryState()} />,
    );
    expect(html).toContain('Recovery is blocked');
    expect(html).toContain('Archive the stale writer lock and retry safely');
    expect(html).toContain('Prohibited action');
    expect(html).toContain('What support can collect');
  });

  it.each([
    [
      'list surface hash',
      () =>
        mutation(fixture.actionsDisplay, (draft) => {
          draft.payload.viewHash = OTHER_HASH;
        }),
      'list',
    ],
    [
      'detail workspace hash',
      () =>
        mutation(fixture.workspace, (draft) => {
          draft.integrity.contentHash = OTHER_HASH;
        }),
      'detail',
    ],
    [
      'recovery display hash',
      () =>
        mutation(fixture.recoveryDisplay, (draft) => {
          draft.integrity.contentHash = OTHER_HASH;
        }),
      'recovery',
    ],
  ] as const)('refuses tampered %s before any trusted child renders', (_label, tamper, surface) => {
    if (surface === 'list') {
      const html = renderStatic(
        <ActionsPage
          currentBinding={fixture.listBinding}
          current={Object.freeze({
            ...listState(),
            data: tamper(),
          })}
        />,
      );
      expect(html).toContain('Actions cannot be trusted');
      expect(html).not.toContain(TAMPER_SENTINEL);
      expect(html).not.toContain(fixture.publicText);
      return;
    }
    if (surface === 'detail') {
      const html = renderStatic(
        <ActionDetailPage
          currentBinding={fixture.detailBinding}
          current={Object.freeze({
            ...detailState(),
            data: tamper(),
          })}
        />,
      );
      expect(html).toContain('Action cannot be trusted');
      expect(html).not.toContain(TAMPER_SENTINEL);
      expect(html).not.toContain('Approval is not execution');
      return;
    }
    const html = renderStatic(
      <RecoveryPage
        currentBinding={fixture.recoveryBinding}
        current={Object.freeze({
          ...recoveryState(),
          data: tamper(),
        })}
      />,
    );
    expect(html).toContain('Recovery cannot be trusted');
    expect(html).not.toContain(TAMPER_SENTINEL);
    expect(html).not.toContain('Recovery history');
  });

  it('reaches collection, detail, and recovery through UnifiedShell routes', () => {
    const cases = [
      {
        hash: '#/operate/actions',
        binding: fixture.listBinding,
        projection: listState(),
        expected: 'Review approved work, its outcome, and the next safe step.',
      },
      {
        hash: `#/operate/actions/${fixture.actionId}`,
        binding: fixture.detailBinding,
        projection: detailState(),
        expected: 'Approval does not make a change',
      },
      {
        hash: '#/operate/recovery',
        binding: fixture.recoveryBinding,
        projection: recoveryState(),
        expected: 'Recovery history',
      },
    ];
    for (const entry of cases) {
      const html = renderStatic(
        <DashboardProviders
          connection={{
            state: 'connected',
            label: 'Connected',
            reason: 'Verified test connection.',
          }}
          buildId="t017-actions-recovery"
          initialHash={entry.hash}
          binding={entry.binding}
          projection={entry.projection}
        >
          <UnifiedShell />
        </DashboardProviders>,
      );
      expect(html).toContain(entry.expected);
      expect(html).not.toContain('Unified boot and first use');
    }
  });

  it('keeps verified Action, Actions, and Recovery pages axe-clean', async () => {
    const pages = [
      <ActionsPage key="list" currentBinding={fixture.listBinding} current={listState()} />,
      <ActionDetailPage
        key="detail"
        currentBinding={fixture.detailBinding}
        current={detailState()}
      />,
      <RecoveryPage
        key="recovery"
        currentBinding={fixture.recoveryBinding}
        current={recoveryState()}
      />,
    ];
    for (const page of pages) {
      const { container, unmount } = render(<main>{page}</main>);
      expect(container.querySelectorAll('h1')).toHaveLength(1);
      expect(
        (
          await axe.run(container, {
            rules: { 'color-contrast': { enabled: false } },
          })
        ).violations,
      ).toEqual([]);
      unmount();
    }
  });

  it('does not retain browser lexical privacy or lifecycle authority in production sources', () => {
    expect(PRODUCTION_SOURCE).not.toMatch(
      /isAccessSafe|normalizeBrowser|containsPrivate|PRIVATE_BODY|SENSITIVE_RELATIVE|hasPathRoot|blankCertifiedHttps|HTML_ENTITY/u,
    );
    expect(PRODUCTION_SOURCE).toContain('assertOperateExperienceDisplaySurfaceV1');
    expect(PRODUCTION_SOURCE).toContain('assertOperateActionDisplayWorkspaceV1');
    expect(PRODUCTION_SOURCE).toContain('assertOperateRecoveryDisplaySurfaceV1');
  });

  it('preserves responsive and touch presentation rules for Action workspaces', () => {
    expect(ACTION_STYLES).toMatch(/\.op-action-list__rows > li/u);
    expect(ACTION_STYLES).toMatch(/\.op-action-detail__controls/u);
    expect(ACTION_STYLES).toMatch(/\.op-recovery__grid/u);
    expect(ACTION_STYLES).toMatch(
      /@media \(max-width: 480px\)[\s\S]*\.op-cycle-list__rows \.op-cycle-link/u,
    );
  });
});
