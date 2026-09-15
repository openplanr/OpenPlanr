// @vitest-environment node

import { sha256Jcs } from 'planr-pipeline/protocol';
import type { OperateCycleDisplayWorkspaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-cycle-display-workspace.mjs';
import type { OperateExecutiveBoardDisplaySurfaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-executive-board-display-surface.mjs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CycleDetailPage } from '../../../../apps/dashboard/src/features/operate/cycles/CycleDetailPage.js';
import {
  createOperateCycleDisplayWorkspaceValidator,
  resolveOperateCycleModel,
} from '../../../../apps/dashboard/src/features/operate/cycles/cycle-model.js';
import { ExecutiveBoardSeats } from '../../../../apps/dashboard/src/features/operate/cycles/ExecutiveBoardSeats.js';
import {
  createOperateExecutiveBoardDisplayValidator,
  resolveOperateCycleExecutiveBoardSection,
} from '../../../../apps/dashboard/src/features/operate/cycles/executive-board-model.js';
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
  authoredChairResultForFixture,
  authoredChallengerResultForFixture,
  readIssuedAssignmentClaim,
  submitAuthoredAdvisorAssignments,
  writeScreenedEvidenceFixture,
} from '../helpers/operate-business-board-lifecycle.js';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

type CycleWorkspace = Readonly<OperateCycleDisplayWorkspaceV1>;
type BoardDisplay = Readonly<OperateExecutiveBoardDisplaySurfaceV1>;

type BoardFixture = Readonly<{
  project: TestProject;
  cycleId: string;
  actorId: string;
  workspace: CycleWorkspace;
  executiveBoard: BoardDisplay | null;
  detailBinding: DashboardQueryIdentity;
}>;

type RecordValue = Record<string, unknown>;
type Assignment = { assignmentId: string; roleId: string };

let businessBoard: BoardFixture;
let softwareWorkspace: BoardFixture;

function productState<T>(
  binding: DashboardQueryIdentity,
  data: T,
  validateData: (value: unknown) => value is T,
): DashboardProductState<T> {
  return parseDashboardProductState<T>(
    {
      kind: 'ready',
      binding,
      data: JSON.parse(JSON.stringify(data)),
      reasonCodes: [],
      error: null,
      mutationEnabled: false,
      policy: dashboardProductStatePolicy('ready'),
    },
    { currentBinding: binding, validateData },
  );
}

function detailBinding(
  fixture: Pick<BoardFixture, 'cycleId' | 'actorId' | 'workspace'>,
): DashboardQueryIdentity {
  const payload = fixture.workspace.payload;
  return createDashboardQueryIdentity({
    productArea: 'operate',
    route: `#/operate/cycles/${encodeURIComponent(fixture.cycleId)}`,
    actorId: fixture.actorId,
    projectId: sha256Jcs({ project: `t038-${fixture.cycleId}` } as never),
    scopeId: payload.scopeId,
    domainId: payload.domainId,
    domainVersion: payload.domainVersion,
    cycleId: fixture.cycleId,
    subjectId: fixture.cycleId,
    eventHead: payload.eventHead,
    viewHash: payload.viewHash,
    generation: 38,
  });
}

function installExperienceOverride(
  client: ReturnType<typeof createOperateClient>,
  view: Record<string, unknown>,
): void {
  Object.defineProperty(client, 'experience', {
    configurable: true,
    value: async () => ({
      ok: true,
      operation: 'operate.experience.get',
      data: structuredClone(view),
      allowedActions: [],
    }),
  });
}

async function claimAndSubmit(
  client: ReturnType<typeof createOperateClient>,
  assignment: Assignment,
  body: (claim: AssignmentClaimV2) => RecordValue,
): Promise<void> {
  const actor = { actorId: `agent-${assignment.roleId}`, kind: 'agent' as const, runtime: 'codex' };
  const claimed = await client.dispatch({
    operation: 'operate.assignment.claim',
    request: { assignmentId: assignment.assignmentId, actor },
  });
  if (!claimed.ok) throw new Error(JSON.stringify(claimed));
  const claim = await readIssuedAssignmentClaim(client, claimed.data as RecordValue, actor);
  const submitted = await client.dispatch({
    operation: 'operate.assignment.submit',
    request: {
      assignmentId: assignment.assignmentId,
      submissionId: claim.submissionId,
      actor,
      mediaType: 'application/json',
      encoding: 'utf-8',
      contentBase64: Buffer.from(JSON.stringify(body(claim))).toString('base64'),
    },
  });
  if (!submitted.ok) throw new Error(JSON.stringify(submitted));
}

async function completeBusinessBoard(
  client: ReturnType<typeof createOperateClient>,
  cycleId: string,
): Promise<void> {
  await submitAuthoredAdvisorAssignments(client, cycleId, (assignment, body) =>
    claimAndSubmit(client, assignment, body),
  );
  const afterAdvisors = await client.dispatch({
    operation: 'operate.cycle.resume',
    request: { cycleId },
  });
  if (!afterAdvisors.ok) throw new Error(JSON.stringify(afterAdvisors));
  const challenger = (afterAdvisors.data as { availableAssignments: Assignment[] })
    .availableAssignments[0];
  await claimAndSubmit(client, challenger, authoredChallengerResultForFixture);
  const beforeChair = await client.dispatch({
    operation: 'operate.cycle.get',
    request: { cycleId },
  });
  if (!beforeChair.ok) throw new Error(JSON.stringify(beforeChair));
  const chair = (beforeChair.data as { availableAssignments: Assignment[] })
    .availableAssignments[0];
  await claimAndSubmit(client, chair, authoredChairResultForFixture);
}

async function createBoardFixture(domainId: 'business' | 'software'): Promise<BoardFixture> {
  const project = await createTestProject(`t038-executive-board-${domainId}`);
  const actorId = `owner-t038-${domainId}`;
  if (domainId === 'business') await writeScreenedEvidenceFixture(project.dir);
  const client = createOperateClient(project.dir);
  const started = await client.dispatch({
    operation: 'operate.cycle.start',
    request: {
      scope: { scopeId: `scope-t038-${domainId}`, domainId, domainVersion: '1.0.0' },
      focus: ['Executive board UI coverage'],
      trigger: { kind: 'manual' },
      mode: 'standard',
      ownerActorId: actorId,
      deliveryRoute: 'observe-only',
    },
  });
  if (!started.ok) throw new Error(JSON.stringify(started));
  const cycleId = String((started.data as { cycle: { cycleId: string } }).cycle.cycleId);
  if (domainId === 'business') await completeBusinessBoard(client, cycleId);
  const actor = { actorId, kind: 'human' as const, runtime: 'openplanr' };
  const experience = await client.dispatch({
    operation: 'operate.experience.get',
    request: { cycleId, actor },
  });
  if (!experience.ok) throw new Error(JSON.stringify(experience));
  const durableView = experience.data as Record<string, unknown>;
  const view = structuredClone(durableView);
  installExperienceOverride(client, view);
  const workspace = (await client.readCycleWorkspace(cycleId, actor)) as CycleWorkspace;
  if (!workspace || typeof workspace !== 'object' || !('payload' in workspace)) {
    throw new Error(`invalid Cycle workspace: ${JSON.stringify(workspace)}`);
  }
  const executiveBoard =
    domainId === 'business'
      ? ((await client.readExecutiveBoardDisplay(cycleId, actor)) as BoardDisplay)
      : null;
  const partial = { project, cycleId, actorId, workspace, executiveBoard };
  const fixture = {
    ...partial,
    detailBinding: detailBinding(partial),
  };
  if (
    !createOperateCycleDisplayWorkspaceValidator(fixture.detailBinding)(workspace) ||
    (domainId === 'business' &&
      (!executiveBoard ||
        !createOperateExecutiveBoardDisplayValidator(fixture.detailBinding)(executiveBoard)))
  ) {
    project.cleanup();
    throw new Error('Executive board fixture did not verify.');
  }
  return Object.freeze(fixture);
}

beforeAll(async () => {
  businessBoard = await createBoardFixture('business');
  softwareWorkspace = await createBoardFixture('software');
});

afterAll(() => {
  businessBoard?.project.cleanup();
  softwareWorkspace?.project.cleanup();
});

describe('T-038 executive board seats', () => {
  it('renders issued seats from roleId and label without title inference', () => {
    const cycleModel = resolveOperateCycleModel(
      {
        current: {
          workspace: productState(
            businessBoard.detailBinding,
            businessBoard.workspace,
            createOperateCycleDisplayWorkspaceValidator(businessBoard.detailBinding),
          ),
        },
      },
      businessBoard.detailBinding,
    );
    expect(cycleModel).not.toBeNull();
    if (!cycleModel || !businessBoard.executiveBoard) return;
    const boardModel = resolveOperateCycleExecutiveBoardSection(
      cycleModel,
      productState(
        businessBoard.detailBinding,
        structuredClone(businessBoard.executiveBoard),
        createOperateExecutiveBoardDisplayValidator(businessBoard.detailBinding),
      ),
      businessBoard.detailBinding,
    );
    expect(boardModel.kind).toBe('executive-board');
    if (boardModel.kind !== 'executive-board') return;
    const html = renderToStaticMarkup(<ExecutiveBoardSeats model={boardModel} />);
    expect(html).toContain('Executive seats');
    expect(html).toContain('CEO');
    expect(html).toContain('strategy-finance');
    expect(html).toContain('Challenger findings');
    expect(html).toContain('Chair synthesis');
    expect(html).toContain('The recommendation does not fully price');
    expect(html).not.toContain('cannot be trusted');
  });

  it('hides the section for software Cycles and shows unavailable when board is absent', () => {
    const softwareModel = resolveOperateCycleModel(
      {
        current: {
          workspace: productState(
            softwareWorkspace.detailBinding,
            softwareWorkspace.workspace,
            createOperateCycleDisplayWorkspaceValidator(softwareWorkspace.detailBinding),
          ),
        },
      },
      softwareWorkspace.detailBinding,
    );
    expect(softwareModel).not.toBeNull();
    if (!softwareModel) return;
    expect(
      resolveOperateCycleExecutiveBoardSection(softwareModel, null, softwareWorkspace.detailBinding)
        .kind,
    ).toBe('hidden');

    const businessModel = resolveOperateCycleModel(
      {
        current: {
          workspace: productState(
            businessBoard.detailBinding,
            businessBoard.workspace,
            createOperateCycleDisplayWorkspaceValidator(businessBoard.detailBinding),
          ),
        },
      },
      businessBoard.detailBinding,
    );
    const unavailableHtml = renderToStaticMarkup(
      <CycleDetailPage
        currentBinding={businessBoard.detailBinding}
        sources={{
          current: {
            workspace: productState(
              businessBoard.detailBinding,
              businessBoard.workspace,
              createOperateCycleDisplayWorkspaceValidator(businessBoard.detailBinding),
            ),
          },
        }}
      />,
    );
    expect(unavailableHtml).toContain('Executive board not yet issued');

    expect(businessBoard.executiveBoard).not.toBeNull();
    if (!businessBoard.executiveBoard) return;
    const trustedHtml = renderToStaticMarkup(
      <CycleDetailPage
        currentBinding={businessBoard.detailBinding}
        sources={{
          current: {
            workspace: productState(
              businessBoard.detailBinding,
              businessBoard.workspace,
              createOperateCycleDisplayWorkspaceValidator(businessBoard.detailBinding),
            ),
            executiveBoard: productState(
              businessBoard.detailBinding,
              structuredClone(businessBoard.executiveBoard),
              createOperateExecutiveBoardDisplayValidator(businessBoard.detailBinding),
            ),
          },
        }}
      />,
    );
    expect(trustedHtml).toContain('Executive seats');
    expect(trustedHtml).toContain(businessModel?.cycle.focus[0] ?? '');
  });

  it('refuses label substitution before rendering board truth', () => {
    expect(businessBoard.executiveBoard).not.toBeNull();
    if (!businessBoard.executiveBoard) return;
    const trustedBoardState = productState(
      businessBoard.detailBinding,
      structuredClone(businessBoard.executiveBoard),
      createOperateExecutiveBoardDisplayValidator(businessBoard.detailBinding),
    );
    const tampered = structuredClone(businessBoard.executiveBoard);
    tampered.payload.data.executiveBoard.seats[0].label = 'strategy-finance';
    const invalidBoardState = Object.freeze({
      ...trustedBoardState,
      data: Object.freeze(tampered),
    });
    const cycleModel = resolveOperateCycleModel(
      {
        current: {
          workspace: productState(
            businessBoard.detailBinding,
            businessBoard.workspace,
            createOperateCycleDisplayWorkspaceValidator(businessBoard.detailBinding),
          ),
          executiveBoard: invalidBoardState,
        },
      },
      businessBoard.detailBinding,
    );
    expect(cycleModel).not.toBeNull();
    if (!cycleModel) return;
    const section = resolveOperateCycleExecutiveBoardSection(
      cycleModel,
      invalidBoardState,
      businessBoard.detailBinding,
    );
    expect(section.kind).toBe('incompatible');
    const html = renderToStaticMarkup(
      <CycleDetailPage
        currentBinding={businessBoard.detailBinding}
        sources={{
          current: {
            workspace: productState(
              businessBoard.detailBinding,
              businessBoard.workspace,
              createOperateCycleDisplayWorkspaceValidator(businessBoard.detailBinding),
            ),
            executiveBoard: invalidBoardState,
          },
        }}
      />,
    );
    expect(html).toContain('Executive board cannot be trusted');
    expect(html).not.toContain('strategy-finance</h3>');
  });
});
