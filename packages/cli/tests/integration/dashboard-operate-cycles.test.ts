import { selectOperateExperienceDisplaySurface } from 'planr-pipeline/dashboard/operate-experience-reader';
import { sha256Jcs } from 'planr-pipeline/protocol';
import type { OperateCycleDisplayWorkspaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-cycle-display-workspace.mjs';
import type { OperateExperienceDisplaySurfaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-experience-display-surface.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { createOperateCyclesDisplayValidator } from '../../../../apps/dashboard/src/features/operate/cycles/CyclesPage.js';
import {
  createOperateCycleDisplayWorkspaceValidator,
  type OperateCycleProjectionSet,
  resolveOperateCycleModel,
} from '../../../../apps/dashboard/src/features/operate/cycles/cycle-model.js';
import { readOperateCycleDetailProjections } from '../../../../apps/dashboard/src/features/operate/cycles/operate-cycle-api.js';
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
import {
  type AssignmentClaimV2,
  approveExactOwnerReviewForFixture,
  authoredChairResultForFixture,
  authoredChallengerResultForFixture,
  readIssuedAssignmentClaim,
  readPersistedActionSeedForFixture,
  submitAuthoredAdvisorAssignments,
  writeScreenedEvidenceFixture,
} from '../helpers/operate-business-board-lifecycle.js';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

type RecordValue = Record<string, unknown>;
type Client = ReturnType<typeof createOperateClient>;
type Workspace = Readonly<OperateCycleDisplayWorkspaceV1>;
type Surface = Readonly<OperateExperienceDisplaySurfaceV1>;
type Assignment = { assignmentId: string; roleId: string };
type Fixture = Readonly<{
  project: TestProject;
  actorId: string;
  cycleId: string;
  publicText: string;
  workspace: Workspace;
  cyclesDisplay: Surface;
  detailBinding: DashboardQueryIdentity;
  collectionBinding: DashboardQueryIdentity;
}>;

const projects: TestProject[] = [];
const PRIVATE_LEDGER_MARKER = 'PRIVATE_LEDGER_MARKER_T037_MUST_NOT_CROSS_DISPLAY_BOUNDARY';
const TAMPER = 'UNCOMMITTED_CYCLE_TAMPER_MUST_NOT_RENDER';
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

function detailState(fixture: Fixture, workspace = fixture.workspace) {
  return productState(
    fixture.detailBinding,
    workspace,
    createOperateCycleDisplayWorkspaceValidator(fixture.detailBinding),
    false,
  );
}

function collectionState(fixture: Fixture, display = fixture.cyclesDisplay) {
  return productState(
    fixture.collectionBinding,
    display,
    createOperateCyclesDisplayValidator(fixture.collectionBinding),
    display.payload.mutationEnabled,
  );
}

function projectionSet(fixture: Fixture, workspace = fixture.workspace): OperateCycleProjectionSet {
  return Object.freeze({ workspace: detailState(fixture, workspace) });
}

function bindingFor(
  project: TestProject,
  actorId: string,
  cycleId: string,
  workspace: Workspace,
  route: '#/operate/cycles' | `#/operate/cycles/${string}`,
  generation = 1,
): DashboardQueryIdentity {
  const detail = route.startsWith('#/operate/cycles/');
  const payload = workspace.payload;
  return createDashboardQueryIdentity({
    productArea: 'operate',
    route,
    actorId,
    projectId: sha256Jcs({ project: project.dir } as never),
    scopeId: payload.scopeId,
    domainId: payload.domainId,
    domainVersion: payload.domainVersion,
    cycleId,
    subjectId: detail ? cycleId : null,
    eventHead: payload.eventHead,
    viewHash: payload.viewHash,
    generation,
  });
}

async function startCycle(
  project: TestProject,
  domainId: 'business' | 'software',
  actorId: string,
  publicText: string,
): Promise<string> {
  const response = await createOperateClient(project.dir).dispatch({
    operation: 'operate.cycle.start',
    request: {
      scope: { scopeId: `scope-t037-cycle-${domainId}`, domainId, domainVersion: '1.0.0' },
      focus: [publicText],
      trigger: { kind: 'manual' },
      mode: 'standard',
      ownerActorId: actorId,
      deliveryRoute: 'observe-only',
    },
  });
  if (!response.ok) throw new Error(JSON.stringify(response));
  return String((response.data as { cycle: { cycleId: string } }).cycle.cycleId);
}

async function readFixture(
  project: TestProject,
  actorId: string,
  cycleId: string,
  publicText: string,
  generation = 1,
): Promise<Fixture> {
  const client = createOperateClient(project.dir);
  const actor = { actorId, kind: 'human' as const, runtime: 'openplanr' };
  const workspace = (await client.readCycleWorkspace(cycleId, actor)) as Workspace;
  const detailBinding = bindingFor(
    project,
    actorId,
    cycleId,
    workspace,
    `#/operate/cycles/${encodeURIComponent(cycleId)}`,
    generation,
  );
  if (!createOperateCycleDisplayWorkspaceValidator(detailBinding)(Object.freeze(workspace))) {
    throw new Error('Owner Cycle display workspace failed its public verifier.');
  }

  const experience = await client.dispatch({
    operation: 'operate.experience.get',
    request: { cycleId, actor },
  });
  if (!experience.ok) throw new Error(JSON.stringify(experience));
  const view = experience.data as Record<string, unknown>;
  const cyclesDisplay = selectOperateExperienceDisplaySurface(view, {
    surface: 'cycles',
    binding: {
      actorId: String(view.actorId),
      scopeId: String(view.scopeId),
      domainId: String(view.domainId),
      domainVersion: String(view.domainVersion),
      generatedAt: String(view.generatedAt),
      eventHead: view.eventHead,
      viewHash: String(view.viewHash),
      surface: 'cycles',
      subjectId: null,
      cycleId,
    } as never,
    cycleId,
  }) as Surface;
  const collectionBinding = bindingFor(
    project,
    actorId,
    cycleId,
    workspace,
    '#/operate/cycles',
    generation,
  );
  if (!createOperateCyclesDisplayValidator(collectionBinding)(Object.freeze(cyclesDisplay))) {
    throw new Error('Owner Cycles display surface failed its public verifier.');
  }
  return Object.freeze({
    project,
    actorId,
    cycleId,
    publicText,
    workspace,
    cyclesDisplay,
    detailBinding,
    collectionBinding,
  });
}

async function fixture(domainId: 'business' | 'software'): Promise<Fixture> {
  const project = await createTestProject(`t037-cycle-integration-${domainId}`);
  projects.push(project);
  const actorId = `owner-t037-cycle-${domainId}`;
  const publicText =
    domainId === 'software'
      ? 'C#/.NET API/CLI https://[2001:db8::31]/cycle?q=$HOME#$(pwd); `echo ~/repo`.'
      : 'Business API/CLI https://[2001:db8::32]/forecast?q=$PWD#~+/cash; C#/.NET notes.';
  const cycleId = await startCycle(project, domainId, actorId, publicText);
  return await readFixture(project, actorId, cycleId, publicText);
}

function tamper<T>(value: T, mutate: (draft: T) => void): T {
  const draft = structuredClone(value);
  mutate(draft);
  return draft;
}

async function claimAndSubmit(
  client: Client,
  assignment: Assignment,
  body: (claim: AssignmentClaimV2) => RecordValue,
) {
  const claimant = {
    actorId: `agent-${assignment.roleId}`,
    kind: 'agent' as const,
    runtime: 'codex',
  };
  const claimed = await client.dispatch({
    operation: 'operate.assignment.claim',
    request: {
      assignmentId: assignment.assignmentId,
      actor: claimant,
    },
  });
  if (!claimed.ok) throw new Error(JSON.stringify(claimed));
  const claim = await readIssuedAssignmentClaim(client, claimed.data as RecordValue, claimant);
  const submitted = await client.dispatch({
    operation: 'operate.assignment.submit',
    request: {
      assignmentId: assignment.assignmentId,
      submissionId: claim.submissionId,
      actor: claimant,
      mediaType: 'application/json',
      encoding: 'utf-8',
      contentBase64: Buffer.from(JSON.stringify(body(claim))).toString('base64'),
    },
  });
  if (!submitted.ok) throw new Error(JSON.stringify(submitted));
  return submitted;
}

async function closeCycleWithPersistentWork(project: TestProject) {
  const actorId = 'owner-t037-persistent-work';
  const publicText = 'Persistent business work remains owner-projected after restart.';
  await writeScreenedEvidenceFixture(project.dir);
  const client = createOperateClient(project.dir);
  const cycleId = await startCycle(project, 'business', actorId, publicText);
  const actionSeed = await readPersistedActionSeedForFixture(project.dir);
  await submitAuthoredAdvisorAssignments(client, cycleId, (assignment, body) =>
    claimAndSubmit(client, assignment, body),
  );

  const afterAdvisor = await client.dispatch({
    operation: 'operate.cycle.resume',
    request: { cycleId },
  });
  if (!afterAdvisor.ok) throw new Error(JSON.stringify(afterAdvisor));
  const challenger = (afterAdvisor.data as { availableAssignments: Assignment[] })
    .availableAssignments[0];
  await claimAndSubmit(client, challenger, authoredChallengerResultForFixture);

  const beforeChair = await client.dispatch({
    operation: 'operate.cycle.get',
    request: { cycleId },
  });
  if (!beforeChair.ok) throw new Error(JSON.stringify(beforeChair));
  const chair = (beforeChair.data as { availableAssignments: Assignment[] })
    .availableAssignments[0];
  await claimAndSubmit(client, chair, (claim) =>
    authoredChairResultForFixture(claim, {
      title: PRIVATE_LEDGER_MARKER,
      question: 'What bounded work should happen next?',
      outcome: 'Collect one accepted observation.',
      rationale: 'The challenged evidence supports a reversible observation.',
      actionHypothesis: {
        title: 'Observe the declared metric',
        objectiveId: actionSeed.objectiveId,
        metricId: actionSeed.metricId,
        expectedResult: 'An accepted observation is recorded.',
        verificationWindow: 'next cycle',
      },
    }),
  );
  const ownerActor = { actorId, kind: 'human' as const, runtime: 'openplanr' };
  await approveExactOwnerReviewForFixture(client, cycleId, ownerActor);
  return { actorId, cycleId, publicText };
}

describe('T-037 Cycle owner-display integration', () => {
  it.each([
    ['business', 'Business Cycle'],
    ['software', 'Repository Cycle'],
  ] as const)(
    'consumes the %s workspace and collection with owner order, links, and restart parity',
    async (domainId, title) => {
      const current = await fixture(domainId);
      const state = detailState(current);
      const model = resolveOperateCycleModel(
        { current: { workspace: state } },
        current.detailBinding,
      );
      expect(model).toMatchObject({
        kind: 'cycle',
        source: 'current',
        vocabulary: { title },
        cycle: { cycleId: current.cycleId },
        mutationEnabled: false,
      });
      if (!model || current.cyclesDisplay.payload.surface !== 'cycles') {
        throw new Error('Expected a verified Cycle model and collection.');
      }
      expect(model.stages).toEqual(current.workspace.payload.data.cycle.stages);
      expect(model.assignments).toEqual(current.workspace.payload.data.cycle.assignments);
      expect(model.allowedActions).toEqual(current.workspace.payload.data.allowedActions);
      expect(model.stages.map((stage) => stage.id)).toEqual([
        'observe',
        'understand',
        'decide',
        'govern',
        'act',
        'verify',
        'learn',
      ]);
      expect(model.cycle.focus).toContain(current.publicText);
      const collectionCycle = current.cyclesDisplay.payload.data.cycles[0];
      expect(collectionCycle.cycleId).toBe(current.cycleId);
      expect(collectionCycle.deepLink).toBe(`#/operate/cycles/${current.cycleId}`);
      expect(collectionCycle.focus).toContain(current.publicText);
      expect(collectionState(current).data).toEqual(current.cyclesDisplay);

      const restarted = await readFixture(
        current.project,
        current.actorId,
        current.cycleId,
        current.publicText,
      );
      expect(restarted.workspace).toEqual(current.workspace);
      expect(restarted.cyclesDisplay).toEqual(current.cyclesDisplay);
      expect(
        resolveOperateCycleModel({ current: projectionSet(restarted) }, restarted.detailBinding),
      ).toEqual(model);
    },
  );

  it.each([
    ['content', (display: Workspace) => Reflect.set(display.payload.data.cycle, 'focus', [TAMPER])],
    ['digest', (display: Workspace) => Reflect.set(display.integrity, 'contentHash', OTHER_HASH)],
    ['binding', (display: Workspace) => Reflect.set(display.payload, 'scopeId', 'foreign-scope')],
    [
      'stage order',
      (display: Workspace) => {
        const stages = display.payload.data.cycle.stages;
        [stages[0], stages[1]] = [stages[1], stages[0]];
      },
    ],
    [
      'lifecycle',
      (display: Workspace) => Reflect.set(display.payload.data.cycle.stages[0], 'state', 'current'),
    ],
  ] as const)(
    'refuses workspace %s tampering before product state or model',
    async (_case, mutate) => {
      const current = await fixture('software');
      expect(() => detailState(current, tamper(current.workspace, mutate))).toThrow(
        /owner-boundary contract/u,
      );
    },
  );

  it.each([
    [
      'content',
      (display: Surface) => {
        if (display.payload.surface !== 'cycles') throw new Error('Expected Cycles display.');
        Reflect.set(display.payload.data.cycles[0], 'focus', [TAMPER]);
      },
    ],
    ['digest', (display: Surface) => Reflect.set(display.integrity, 'contentHash', OTHER_HASH)],
    [
      'canonical link',
      (display: Surface) => {
        if (display.payload.surface !== 'cycles') throw new Error('Expected Cycles display.');
        Reflect.set(display.payload.data.cycles[0], 'deepLink', '#/operate/cycles/cyc_00000099');
      },
    ],
  ] as const)('refuses collection %s tampering before product state', async (_case, mutate) => {
    const current = await fixture('business');
    expect(() => collectionState(current, tamper(current.cyclesDisplay, mutate))).toThrow(
      /owner-boundary contract/u,
    );
  });

  it('requires parser branding, deep freeze, and the exact current route identity', async () => {
    const current = await fixture('software');
    const parsed = detailState(current);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.data)).toBe(true);
    expect(Object.isFrozen(parsed.data?.payload.data.cycle.stages)).toBe(true);
    expect(
      resolveOperateCycleModel(
        { current: { workspace: { ...parsed } as DashboardProductState<unknown> } },
        current.detailBinding,
      ),
    ).toBeNull();
    const foreign = createDashboardQueryIdentity({
      ...current.detailBinding,
      actorId: 'foreign-owner',
    });
    expect(resolveOperateCycleModel({ current: projectionSet(current) }, foreign)).toBeNull();
  });

  it('keeps owner-certified persistent work discoverable while excluding private ledger bodies', async () => {
    const project = await createTestProject('t037-cycle-integration-persistent');
    projects.push(project);
    const closed = await closeCycleWithPersistentWork(project);
    const current = await readFixture(project, closed.actorId, closed.cycleId, closed.publicText);
    const restarted = await readFixture(project, closed.actorId, closed.cycleId, closed.publicText);
    const raw = await createOperateClient(project.dir).dispatch({
      operation: 'operate.cycle.get',
      request: { cycleId: closed.cycleId },
    });
    expect(JSON.stringify(raw)).toContain(PRIVATE_LEDGER_MARKER);
    const model = resolveOperateCycleModel(
      { current: projectionSet(current), resumable: projectionSet(restarted) },
      restarted.detailBinding,
    );
    expect(model).toMatchObject({
      source: 'durable-resume',
      cycle: { cycleId: closed.cycleId, state: 'closed' },
      verification: {
        status: 'unverified',
        reasonCodes: ['OPERATE_VERIFICATION_EVIDENCE_MISSING'],
      },
    });
    expect(model?.persistentWork.decisions.length).toBeGreaterThan(0);
    expect(model?.persistentWork.actions.length).toBeGreaterThan(0);
    expect(JSON.stringify(model)).not.toContain(PRIVATE_LEDGER_MARKER);
    expect(JSON.stringify(model)).not.toContain('contentBase64');
    expect(JSON.stringify(model)).not.toContain(project.dir);
  });

  it('pairs the Cycle workspace display with an optional executive board display', async () => {
    const current = await fixture('business');
    const client = createOperateClient(current.project.dir);
    const actor = { actorId: current.actorId, kind: 'human' as const, runtime: 'openplanr' };
    const projections = await readOperateCycleDetailProjections(client, current.cycleId, actor);
    expect(projections.workspace.kind).toBe('operate-cycle-display-workspace');
    expect(projections.executiveBoard?.kind).toBe('operate-executive-board-display-surface');
    expect(projections.executiveBoard?.payload.data.executiveBoard.seats).toHaveLength(7);
  });

  it('rejects invalid Cycle identifiers through the existing owner composition boundary', async () => {
    const current = await fixture('software');
    await expect(
      createOperateClient(current.project.dir).readCycleWorkspace('../foreign', {
        actorId: current.actorId,
        kind: 'human',
        runtime: 'openplanr',
      }),
    ).resolves.toMatchObject({
      ok: false,
      operation: 'operate.cycle.get',
      error: { code: 'RESULT_CONTRACT_INVALID' },
    });
  });
});
