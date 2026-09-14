import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { startDashboard } from 'planr-pipeline';
import {
  assertOperateExperienceTransportView,
  buildOperateExperienceTransportView,
} from 'planr-pipeline/dashboard/operate-experience-reader';
import { assertOperateExperienceArtifactV2, sha256Jcs } from 'planr-pipeline/protocol';
import {
  assertOperateExperienceDisplaySurfaceV1,
  assertOperateExperiencePreviewV1,
  type OperateExperienceDisplaySurfaceV1,
} from 'planr-pipeline/schemas/v1.2.0/operate-experience-display-surface.mjs';
import { describe, expect, it, vi } from 'vitest';
import {
  createOperateActionsSurfaceValidator,
  resolveOperateActionsListModel,
} from '../../../../apps/dashboard/src/features/operate/actions/actions-list-model.js';
import { fetchOperateActionsDisplay } from '../../../../apps/dashboard/src/features/operate/actions/operate-action-api.js';
import { fetchOperateSearchHits } from '../../../../apps/dashboard/src/features/search/operate-search-api.js';
import {
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import {
  createDashboardQueryIdentity,
  type DashboardQueryIdentity,
} from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { installedOpenPlanrDashboardRoot } from '../../src/cli/commands/operate.js';
import { createOperateCommandGateway } from '../../src/services/operate/command-gateway.js';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

type RecordValue = Record<string, unknown>;
type Display = Readonly<OperateExperienceDisplaySurfaceV1>;

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const CYCLE_ID = 'cyc_actions_transport_01';
const ACTION_ID = 'act_actions_transport_01';
const PRIVATE_MARKER = 'private-runtime-grant-must-not-echo';

function projectId(project: TestProject): string {
  const root = realpathSync(project.dir);
  const bytes = Buffer.from(`${root}\0${project.config.projectName}`, 'utf8');
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function experienceView(
  actorId = 'owner-actions-transport',
  overrides: {
    eventHead?: { sequence: number; hash: string };
    allowedActions?: RecordValue[];
    actionState?: string;
    inbox?: RecordValue[];
  } = {},
): RecordValue {
  const eventHead = overrides.eventHead ?? { sequence: 4, hash: HASH_A };
  const action = {
    actionId: ACTION_ID,
    revision: 1,
    actionHash: HASH_A,
    title: 'Audit callable search destination links',
    state: overrides.actionState ?? 'approved',
    ownerActorId: actorId,
    expectedResult: 'Every emitted search link resolves.',
    verificationPlanId: 'vfy_actions_transport_01',
    deliveryRoute: {
      kind: 'operating-delivery-route',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      routeId: 'droute_actions_transport_01',
      scopeId: 'scope-actions-transport',
      domainId: 'software',
      domainVersion: '1.0.0',
      action: { actionId: ACTION_ID, revision: 1, actionHash: HASH_A },
      eventHead: structuredClone(eventHead),
      route: 'observe-only',
      rationale: 'The audit surface is read-only.',
      createdAt: '2026-08-11T08:00:00.000Z',
      routeHash: HASH_B,
    },
    dependencyActionIds: [],
    executions: [],
    rollbacks: [],
    deepLink: `#/operate/actions/${ACTION_ID}`,
  };
  const base: RecordValue = {
    kind: 'operate-experience-view',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    viewId: 'xview_actions_transport',
    scopeId: 'scope-actions-transport',
    domainId: 'software',
    domainVersion: '1.0.0',
    actorId,
    accessLevel: 'internal',
    generatedAt: '2026-08-11T08:00:00.000Z',
    eventHead,
    sourceStateHash: HASH_A,
    status: 'ready',
    attention: [],
    domainMetrics: [],
    cycles: [
      {
        cycleId: CYCLE_ID,
        state: 'executing',
        health: 'normal',
        focus: ['Callable Actions transport'],
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
            persistentActionIds: index >= 4 ? [ACTION_ID] : [],
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
    inbox: overrides.inbox ?? [],
    actions: [action],
    evidence: [],
    claims: [],
    rationale: [],
    outcomes: [],
    learnings: [],
    history: [],
    replay: {
      checkpoint: null,
      tail: {
        startSequence: 1,
        endSequence: eventHead.sequence,
        eventCount: eventHead.sequence,
        eventReplayIndexHash: eventHead.hash,
      },
      finalHead: structuredClone(eventHead),
      liveAccessUsed: false,
      parityProof: {
        sourceStateHash: HASH_A,
        eventReplayIndexHash: eventHead.hash,
        checkpointVerified: false,
        finalEventHashMatches: true,
        stateParityVerified: false,
      },
      filterDimensions: ['action'],
      redactions: [],
    },
    allowedActions: overrides.allowedActions ?? [
      {
        subjectId: ACTION_ID,
        action: {
          tool: 'operate.action.rollback',
          arguments: {
            action: { actionId: ACTION_ID, revision: 1, actionHash: HASH_A },
            originalOperationId: 'op_actions_transport_01',
            rollbackPlanId: 'rbp_actions_transport_01',
          },
          label: `Restore baseline ${PRIVATE_MARKER}`,
          effect: 'project-write',
        },
      },
    ],
    omissions: [],
    export: { formats: ['json'], accessSafe: true, redactionCount: 0 },
  };
  return buildOperateExperienceTransportView({
    ...base,
    viewHash: sha256Jcs(base),
  });
}

function displayBinding(view: RecordValue, exactProjectId: string, generation: number) {
  return {
    actorId: String(view.actorId),
    scopeId: String(view.scopeId),
    domainId: String(view.domainId),
    domainVersion: String(view.domainVersion),
    generatedAt: String(view.generatedAt),
    eventHead: structuredClone(view.eventHead) as { sequence: number; hash: string },
    viewHash: String(view.viewHash),
    surface: 'actions' as const,
    projectId: exactProjectId,
    generation,
    subjectId: null,
    cycleId: CYCLE_ID,
  };
}

function rollbackPreview(view: RecordValue, input: RecordValue): RecordValue {
  const allowedAction = view.allowedActions[0].action as RecordValue;
  const base = {
    kind: 'operate-experience-preview',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    previewId: 'xprv_actions_transport_12345678',
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
    actorId: view.actorId,
    subject: {
      kind: 'action',
      id: ACTION_ID,
      revision: 1,
      hash: HASH_A,
    },
    eventHead: structuredClone(view.eventHead),
    sourceViewHash: view.viewHash,
    actionDigest: sha256Jcs(allowedAction as never),
    allowedAction,
    authority: input.authority,
    consequence: 'Restore the certified local baseline without inventing new authority.',
    reasonCodes: input.reasonCodes,
    transition: {
      kind: 'rollback',
      targets: [
        {
          kind: 'operating-action',
          id: ACTION_ID,
          revision: 1,
          hash: HASH_A,
          disposition: 'rolled-back',
        },
      ],
      reversible: false,
      nextState: 'rolled-back',
      threshold: null,
    },
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
  };
  return { ...base, previewHash: sha256Jcs(base as never) };
}

function dashboardIdentity(
  view: RecordValue,
  exactProjectId: string,
  generation: number,
): DashboardQueryIdentity {
  return createDashboardQueryIdentity({
    productArea: 'operate',
    route: '#/operate/actions',
    actorId: String(view.actorId),
    projectId: exactProjectId,
    scopeId: String(view.scopeId),
    domainId: String(view.domainId),
    domainVersion: String(view.domainVersion),
    cycleId: CYCLE_ID,
    subjectId: null,
    eventHead: view.eventHead as { sequence: number; hash: string },
    viewHash: String(view.viewHash),
    generation,
  });
}

describe('T-017 Actions dashboard transport', () => {
  it('keeps advanced transport views canonical after governed command refresh', () => {
    const advanced = experienceView(undefined, {
      eventHead: { sequence: 5, hash: HASH_B },
      allowedActions: [],
    });
    const current = experienceView();
    const rollbackAllowed = current.allowedActions[0].action as RecordValue;
    const preview = rollbackPreview(current, {
      authority: 'allowed',
      reasonCodes: [],
      issuedAt: '2026-08-11T08:00:00.000Z',
      expiresAt: '2026-08-11T08:02:00.000Z',
    });
    expect(() => assertOperateExperienceTransportView(advanced)).not.toThrow();
    expect(() =>
      assertOperateExperienceArtifactV2('operate-experience-view', advanced),
    ).not.toThrow();
    expect(() =>
      assertOperateExperiencePreviewV1(preview, {
        actorId: String(current.actorId),
        scopeId: String(current.scopeId),
        domainId: String(current.domainId),
        domainVersion: String(current.domainVersion),
        eventHead: current.eventHead as { sequence: number; hash: string },
        sourceViewHash: String(current.viewHash),
        subjectId: ACTION_ID,
        actionDigest: sha256Jcs(rollbackAllowed as never),
      }),
    ).not.toThrow();
    expect(() =>
      assertOperateExperienceArtifactV2('operate-experience-preview', preview),
    ).not.toThrow();
  });

  it('serves one exact owner-issued Actions collection over REST and fetchOperateActionsDisplay', async () => {
    const project = await createTestProject('t017-actions-transport');
    const view = experienceView();
    const dashboard = startDashboard({
      planrDir: join(project.dir, '.planr'),
      staticRoot: installedOpenPlanrDashboardRoot(),
      watch: false,
      getOperatingExperience: () => ({
        available: true,
        readOnly: false,
        status: 'ready',
        view: structuredClone(view),
        reasonCodes: [],
      }),
    });
    try {
      const port = await dashboard.listen(0, {
        env: { ...process.env, PLANR_HOME: join(project.dir, '.planr-home') },
      });
      const base = `http://127.0.0.1:${port}`;
      const exactProjectId = projectId(project);
      const generation = 3;
      const query = new URLSearchParams({
        scopeId: String(view.scopeId),
        domainId: String(view.domainId),
        domainVersion: String(view.domainVersion),
        cycleId: CYCLE_ID,
        projectId: exactProjectId,
        generation: String(generation),
      });
      const response = await fetch(`${base}/api/operate/actions?${query}`, {
        headers: { 'x-openplanr-actor': String(view.actorId) },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toContain('no-store');
      const display = assertOperateExperienceDisplaySurfaceV1(
        await response.json(),
        displayBinding(view, exactProjectId, generation),
      );
      expect(display.payload).toMatchObject({
        surface: 'actions',
        mutationEnabled: true,
        data: {
          requestBinding: { projectId: exactProjectId, generation },
          actions: [
            expect.objectContaining({
              actionId: ACTION_ID,
              deepLink: `#/operate/actions/${ACTION_ID}`,
            }),
          ],
        },
      });
      expect(JSON.stringify(display)).not.toContain(PRIVATE_MARKER);

      const identity = dashboardIdentity(view, exactProjectId, generation);
      const fetched = await fetchOperateActionsDisplay({
        origin: base,
        identity,
      });
      expect(fetched).toEqual(display);

      const state = parseDashboardProductState<Display>(
        {
          kind: 'ready',
          binding: identity,
          data: display,
          reasonCodes: [],
          error: null,
          mutationEnabled: true,
          policy: dashboardProductStatePolicy('ready'),
        },
        {
          currentBinding: identity,
          validateData(value): value is Display {
            return createOperateActionsSurfaceValidator(identity)(value);
          },
        },
      );
      const model = resolveOperateActionsListModel(state, identity);
      expect(model).toMatchObject({
        kind: 'actions',
        presentation: 'ready',
        mutationEnabled: true,
        actions: [expect.objectContaining({ actionId: ACTION_ID })],
      });
    } finally {
      await dashboard.close();
      project.cleanup();
    }
  });

  it('returns access-safe Operate search hits with callable action deep links', async () => {
    const project = await createTestProject('t017-actions-search');
    const view = experienceView();
    const dashboard = startDashboard({
      planrDir: join(project.dir, '.planr'),
      staticRoot: installedOpenPlanrDashboardRoot(),
      watch: false,
      getOperatingExperience: () => ({
        available: true,
        readOnly: false,
        status: 'ready',
        view: structuredClone(view),
        reasonCodes: [],
      }),
    });
    try {
      const port = await dashboard.listen(0, {
        env: { ...process.env, PLANR_HOME: join(project.dir, '.planr-home') },
      });
      const base = `http://127.0.0.1:${port}`;
      const exactProjectId = projectId(project);
      const identity = dashboardIdentity(view, exactProjectId, 1);
      const hits = await fetchOperateSearchHits({
        origin: base,
        identity,
        query: 'Audit callable',
      });
      expect(hits).toEqual([
        expect.objectContaining({
          kind: 'action',
          subjectId: ACTION_ID,
          deepLink: `#/operate/actions/${ACTION_ID}`,
        }),
      ]);
      expect(JSON.stringify(hits)).not.toContain(PRIVATE_MARKER);
    } finally {
      await dashboard.close();
      project.cleanup();
    }
  });

  it('confirms governed approval through the command gateway for Action workspace custody', async () => {
    const approveAction = {
      tool: 'operate.action.approve',
      arguments: {
        action: { actionId: ACTION_ID, revision: 1, actionHash: HASH_A },
        decision: 'approved',
      },
      label: 'Approve the contained Action',
      effect: 'project-write',
    };
    const actionDigest = sha256Jcs(approveAction as never);
    let current = experienceView(undefined, {
      actionState: 'proposed',
      allowedActions: [{ subjectId: ACTION_ID, action: approveAction }],
      inbox: [
        {
          itemId: `approval:${ACTION_ID}`,
          kind: 'approval',
          subjectId: ACTION_ID,
          ownerActorId: 'owner-actions-transport',
          state: 'waiting',
          title: 'Approve the contained Action',
          consequence: 'The governed Action remains blocked until approval is recorded.',
          expiresAt: '2099-08-11T08:10:00.000Z',
          blocking: true,
          evidence: [],
          requiredParties: [
            {
              partyId: 'party_owner_actions_transport',
              actorKind: 'human',
              actorId: 'owner-actions-transport',
              requiredCapability: { id: 'action-approve', version: '1.0.0' },
              state: 'required',
              redacted: false,
            },
          ],
          redactions: [],
          actionLocator: { subjectId: ACTION_ID, actionDigest },
          navigationLocator: null,
          unavailableReason: null,
        },
      ],
    });
    const perform = vi.fn(async () => {
      current = experienceView(undefined, {
        eventHead: { sequence: 5, hash: HASH_B },
        allowedActions: [],
        inbox: [],
      });
      return {
        ok: true as const,
        operation: 'operate.action.approve' as const,
        data: { durableResultId: 'res_actions_transport_01' },
        allowedActions: [],
      };
    });
    const client = {
      dispatch: vi.fn(async () => ({
        ok: true,
        operation: 'operate.experience.get',
        data: current,
        allowedActions: [],
      })),
      createExperiencePreview: vi.fn(async (input: RecordValue) => {
        const base = {
          kind: 'operate-experience-preview',
          schemaVersion: '1.0.0',
          protocolVersion: '2.0.0',
          previewId: 'xprv_actions_transport_12345678',
          scopeId: current.scopeId,
          domainId: current.domainId,
          domainVersion: current.domainVersion,
          actorId: current.actorId,
          subject: { kind: 'action', id: ACTION_ID, revision: 1, hash: HASH_A },
          eventHead: structuredClone(current.eventHead),
          sourceViewHash: current.viewHash,
          actionDigest,
          allowedAction: approveAction,
          authority: input.authority,
          consequence: 'Record this exact approval without executing the governed Action.',
          reasonCodes: input.reasonCodes,
          transition: {
            kind: 'approval',
            targets: [
              {
                kind: 'operating-action',
                id: ACTION_ID,
                revision: 1,
                hash: HASH_A,
                disposition: 'approved',
              },
            ],
            reversible: false,
            nextState: 'threshold-satisfied',
            threshold: { required: 1, recorded: 1, remaining: 0, parties: [] },
          },
          issuedAt: input.issuedAt,
          expiresAt: input.expiresAt,
        };
        return { ...base, previewHash: sha256Jcs(base as never) };
      }),
    };
    const gateway = createOperateCommandGateway({
      client: client as never,
      runtime: { perform },
    });
    const origin = 'http://127.0.0.1:7473';
    const session = await gateway.issueSession({
      cycleId: CYCLE_ID,
      eventHead: structuredClone(current.eventHead) as { sequence: number; hash: string },
      sourceViewHash: String(current.viewHash),
      actionLocator: { subjectId: ACTION_ID, actionDigest },
      actor: { actorId: String(current.actorId), kind: 'human', runtime: 'openplanr' },
      origin,
    });
    const preview = await gateway.preview({
      sessionId: session.sessionId,
      capability: session.sessionCapability,
      origin,
      actionReference: session.allowedActions[0].actionReference,
    });
    const confirmed = await gateway.confirm({
      sessionId: session.sessionId,
      capability: session.sessionCapability,
      origin,
      previewId: String(preview.previewId),
      previewHash: String(preview.previewHash),
    });
    expect(confirmed, JSON.stringify(confirmed)).toMatchObject({
      ok: true,
      eventHead: { sequence: 5, hash: HASH_B },
    });
    expect(perform).toHaveBeenCalledOnce();
  });
});
