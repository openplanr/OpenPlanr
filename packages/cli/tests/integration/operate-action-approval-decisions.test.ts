import { afterEach, describe, expect, it } from 'vitest';
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
type Assignment = { assignmentId: string; roleId: string };

const owner = { actorId: 'owner-approvals', kind: 'human' as const, runtime: 'openplanr' };
const decisions = ['approved', 'rejected', 'deferred'] as const;

const projects: TestProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.cleanup();
});

async function claimAndSubmit(
  client: Client,
  assignment: Assignment,
  body: (claim: AssignmentClaimV2) => RecordValue,
) {
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

/** Runs one contained-execution Cycle whose approved Review proposes one Action per title. */
async function proposedActions(titles: readonly string[]) {
  const project = await createTestProject('operate-action-approvals');
  projects.push(project);
  await writeScreenedEvidenceFixture(project.dir);
  const client = createOperateClient(project.dir);
  const started = await client.dispatch({
    operation: 'operate.cycle.start',
    request: {
      scope: { scopeId: 'scope-approvals', domainId: 'business', domainVersion: '1.0.0' },
      focus: ['governed approval decisions'],
      trigger: { kind: 'manual' },
      mode: 'standard',
      ownerActorId: owner.actorId,
      deliveryRoute: 'contained-execution',
    },
  });
  if (!started.ok) throw new Error(JSON.stringify(started));
  const cycleId = (started.data as { cycle: { cycleId: string } }).cycle.cycleId;
  const actionSeed = await readPersistedActionSeedForFixture(project.dir);
  await submitAuthoredAdvisorAssignments(client, cycleId, (assignment, body) =>
    claimAndSubmit(client, assignment, body),
  );
  const afterAdvisor = await client.dispatch({
    operation: 'operate.cycle.resume',
    request: { cycleId },
  });
  if (!afterAdvisor.ok) throw new Error(JSON.stringify(afterAdvisor));
  const [challenger] = (afterAdvisor.data as { availableAssignments: Assignment[] })
    .availableAssignments;
  await claimAndSubmit(client, challenger, authoredChallengerResultForFixture);
  const beforeChair = await client.dispatch({
    operation: 'operate.cycle.get',
    request: { cycleId },
  });
  if (!beforeChair.ok) throw new Error(JSON.stringify(beforeChair));
  const [chair] = (beforeChair.data as { availableAssignments: Assignment[] }).availableAssignments;
  await claimAndSubmit(client, chair, (claim) => {
    const body = authoredChairResultForFixture(claim, {
      actionHypothesis: {
        title: titles[0],
        objectiveId: actionSeed.objectiveId,
        metricId: actionSeed.metricId,
      },
    });
    const [decision] = body.decisions as RecordValue[];
    const [template] = decision.actionHypotheses as RecordValue[];
    decision.actionHypotheses = titles.map((title, index) => ({
      ...structuredClone(template),
      localActionHypothesisId: `action-hypothesis:${claim.assignment.assignmentId}:${index + 1}`,
      title,
    }));
    return body;
  });
  await approveExactOwnerReviewForFixture(client, cycleId, owner);
  return { project, client, cycleId };
}

async function ownerExperience(client: Client, cycleId: string): Promise<RecordValue> {
  const experience = await client.dispatch({
    operation: 'operate.experience.get',
    request: { cycleId, actor: owner, actionBinding: { cycleId, actorId: owner.actorId } },
  });
  if (!experience.ok) throw new Error(JSON.stringify(experience));
  return experience.data as RecordValue;
}

describe('operate.action.approve records every human decision', () => {
  it('commits approved, rejected and deferred decisions on separate Actions', async () => {
    const titles = decisions.map((decision) => `Contained Action to be ${decision}`);
    const { project, client, cycleId } = await proposedActions(titles);
    const before = await ownerExperience(client, cycleId);
    const actions = before.actions as RecordValue[];
    expect(actions.map((action) => [action.title, action.state]).sort()).toEqual(
      titles.map((title) => [title, 'proposed']).sort(),
    );
    const actionFor = (decision: (typeof decisions)[number]) => {
      const action = actions.find((entry) => entry.title === `Contained Action to be ${decision}`);
      if (!action) throw new Error(`missing Action for ${decision}: ${JSON.stringify(actions)}`);
      return action;
    };

    for (const decision of decisions) {
      const action = actionFor(decision);
      const recorded = await client.dispatch({
        operation: 'operate.action.approve',
        request: {
          action: {
            actionId: String(action.actionId),
            revision: Number(action.revision),
            actionHash: String(action.actionHash),
          },
          decision,
          actor: owner,
        },
      });
      expect(recorded, JSON.stringify(recorded)).toMatchObject({
        ok: true,
        data: { actionId: action.actionId, disposition: decision, complete: true },
      });
    }

    const after = await ownerExperience(createOperateClient(project.dir), cycleId);
    for (const decision of decisions) {
      const actionId = actionFor(decision).actionId;
      expect(
        (after.actions as RecordValue[]).find((entry) => entry.actionId === actionId),
      ).toMatchObject({ state: decision });
      expect(
        (after.history as RecordValue[]).filter(
          (entry) => entry.entityId === actionId && entry.type === `action.${decision}`,
        ),
      ).toEqual([
        expect.objectContaining({
          why: decision === 'approved' ? null : `approval-${decision}`,
          change: { subjectKind: 'action', summary: `proposed → ${decision}` },
        }),
      ]);
    }
  });
});
