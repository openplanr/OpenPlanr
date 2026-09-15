import { cp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Jcs, validateProtocolArtifact } from 'planr-pipeline/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { createOperateClient } from '../../src/services/operate/client.js';
import {
  type AssignmentClaimV2,
  authoredChairResultForFixture,
  authoredChallengerResultForFixture,
  CHAIR_ROLE_ID,
  CHALLENGER_ROLE_ID,
  EXECUTIVE_ADVISOR_ROLE_IDS,
  readExactOwnerReviewForFixture,
  readIssuedAssignmentClaim,
  submitAuthoredAdvisorAssignments,
  writeScreenedEvidenceFixture,
} from '../helpers/operate-business-board-lifecycle.js';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

type RecordValue = Record<string, unknown>;
type Assignment = { assignmentId: string; roleId: string };

const projects: TestProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.cleanup();
});

async function claimAndSubmit(
  client: ReturnType<typeof createOperateClient>,
  assignment: Assignment,
  body: (claim: AssignmentClaimV2) => RecordValue,
) {
  const actor = { actorId: `agent-${assignment.roleId}`, kind: 'agent' as const, runtime: 'codex' };
  const claimed = await client.dispatch({
    operation: 'operate.assignment.claim',
    request: {
      assignmentId: assignment.assignmentId,
      actor,
    },
  });
  if (!claimed.ok) throw new Error(JSON.stringify(claimed));
  const data = await readIssuedAssignmentClaim(client, claimed.data as RecordValue, actor);
  const submitted = await client.dispatch({
    operation: 'operate.assignment.submit',
    request: {
      assignmentId: assignment.assignmentId,
      submissionId: data.submissionId,
      actor,
      mediaType: 'application/json',
      encoding: 'utf-8',
      contentBase64: Buffer.from(JSON.stringify(body(data))).toString('base64'),
    },
  });
  if (!submitted.ok) throw new Error(JSON.stringify(submitted));
  return { submitted, claim: data };
}

describe('OpenPlanr canonical operating lifecycle', () => {
  it('runs all seven executive seats through closed claim/read/submit custody and stops at human review without inventing Action identities', async () => {
    const fixture = await createTestProject('operate-canonical-lifecycle');
    projects.push(fixture);
    await writeScreenedEvidenceFixture(fixture.dir);
    const client = createOperateClient(fixture.dir);
    const started = await client.dispatch({
      operation: 'operate.cycle.start',
      request: {
        scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
        focus: ['retention'],
        trigger: { kind: 'manual' },
        mode: 'standard',
        ownerActorId: 'owner-test',
        deliveryRoute: 'planning-work',
      },
    });
    if (!started.ok) throw new Error(JSON.stringify(started));
    const initial = started.data as {
      cycle: RecordValue & { cycleId: string };
      availableAssignments: Assignment[];
    };
    expect(initial.availableAssignments.map(({ roleId }) => roleId).sort()).toEqual(
      [...EXECUTIVE_ADVISOR_ROLE_IDS].sort(),
    );

    await submitAuthoredAdvisorAssignments(client, initial.cycle.cycleId, (assignment, body) =>
      claimAndSubmit(client, assignment, body),
    );

    const afterAdvisor = await client.dispatch({
      operation: 'operate.cycle.resume',
      request: { cycleId: initial.cycle.cycleId },
    });
    if (!afterAdvisor.ok) throw new Error(JSON.stringify(afterAdvisor));
    const challenger = (afterAdvisor.data as { availableAssignments: Assignment[] })
      .availableAssignments[0];
    expect(challenger.roleId).toBe(CHALLENGER_ROLE_ID);
    const challenged = await claimAndSubmit(client, challenger, authoredChallengerResultForFixture);
    expect(challenged.submitted.ok).toBe(true);

    const beforeChair = await client.dispatch({
      operation: 'operate.cycle.get',
      request: { cycleId: initial.cycle.cycleId },
    });
    if (!beforeChair.ok) throw new Error(JSON.stringify(beforeChair));
    const chair = (beforeChair.data as { availableAssignments: Assignment[] })
      .availableAssignments[0];
    expect(chair.roleId).toBe(CHAIR_ROLE_ID);
    let chairBody: RecordValue | null = null;
    const synthesized = await claimAndSubmit(client, chair, (claim) => {
      chairBody = authoredChairResultForFixture(claim, {
        title: 'Measure retention before reallocating',
        question: 'What should the next bounded operating loop prioritize?',
        outcome: 'Measure retention before reallocating investment.',
        rationale: 'The challenged evidence supports a reversible measurement-first decision.',
      });
      return chairBody;
    });
    expect(synthesized.submitted).toMatchObject({
      ok: true,
      data: {
        accepted: true,
        assignmentState: 'validated',
        artifactId: expect.stringMatching(/^art_/u),
      },
    });
    const afterChair = await client.dispatch({
      operation: 'operate.cycle.get',
      request: { cycleId: initial.cycle.cycleId },
    });
    if (!afterChair.ok) throw new Error(JSON.stringify(afterChair));
    const awaiting = afterChair.data as {
      persistentWork: {
        ledger: { decisions: RecordValue[]; actions: RecordValue[] };
      };
    };
    expect(awaiting.persistentWork.ledger.decisions).toHaveLength(1);
    expect(awaiting.persistentWork.ledger.actions).toEqual([]);
    const generation = (
      await readFile(join(fixture.dir, '.planr', 'operate', 'state', 'CURRENT'), 'utf8')
    ).trim();
    const ledger = await readFile(
      join(fixture.dir, '.planr', 'operate', 'state', 'generations', generation, 'events.jsonl'),
      'utf8',
    );
    expect(ledger).toContain('"type":"decision-ledger.materialized"');
    expect(ledger).not.toContain('"type":"verification.plan-recorded"');
    const events = ledger
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as RecordValue);
    const boardEvents = events.filter((event) => event.type === 'executive-board.materialized');
    expect(boardEvents).toHaveLength(1);
    const boardIndex = events.findIndex((event) => event.type === 'executive-board.materialized');
    const boardEvent = boardEvents[0];
    const reviewCreated = events[boardIndex + 1];
    expect(reviewCreated).toMatchObject({
      type: 'review.created',
      cycleId: initial.cycle.cycleId,
      causationId: boardEvent.eventId,
      correlationId: boardEvent.correlationId,
    });
    expect((boardEvent.payload as RecordValue).reviewId).toBe(
      (reviewCreated.payload as RecordValue).reviewId,
    );
    expect((boardEvent.payload as RecordValue).reviewHash).toBe(
      sha256Jcs(reviewCreated.payload as never),
    );

    if (chairBody === null) throw new Error('missing exact authored Chair retry bytes');
    const replayedChair = await client.dispatch({
      operation: 'operate.assignment.submit',
      request: {
        assignmentId: chair.assignmentId,
        submissionId: synthesized.claim.submissionId,
        actor: { actorId: `agent-${chair.roleId}`, kind: 'agent', runtime: 'codex' },
        mediaType: 'application/json',
        encoding: 'utf-8',
        contentBase64: Buffer.from(JSON.stringify(chairBody)).toString('base64'),
      },
    });
    if (!replayedChair.ok) throw new Error(JSON.stringify(replayedChair));
    const replayGeneration = (
      await readFile(join(fixture.dir, '.planr', 'operate', 'state', 'CURRENT'), 'utf8')
    ).trim();
    const replayLedger = await readFile(
      join(
        fixture.dir,
        '.planr',
        'operate',
        'state',
        'generations',
        replayGeneration,
        'events.jsonl',
      ),
      'utf8',
    );
    const replayEvents = replayLedger
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as RecordValue);
    expect(
      replayEvents.filter((event) => event.type === 'executive-board.materialized'),
    ).toHaveLength(1);
    expect(replayEvents.filter((event) => event.type === 'review.created')).toHaveLength(1);

    const ownerActor = { actorId: 'owner-test', kind: 'human' as const, runtime: 'openplanr' };
    const ownerExperience = await client.dispatch({
      operation: 'operate.experience.get',
      request: {
        cycleId: initial.cycle.cycleId,
        actor: ownerActor,
        actionBinding: { cycleId: initial.cycle.cycleId, actorId: ownerActor.actorId },
      },
    });
    if (!ownerExperience.ok) throw new Error(JSON.stringify(ownerExperience));
    const projectedReviewActions = (ownerExperience.allowedActions as RecordValue[]).filter(
      (action) => ['operate.review.get', 'operate.review.submit'].includes(String(action.tool)),
    );
    expect(projectedReviewActions).not.toHaveLength(0);
    for (const action of projectedReviewActions) {
      expect(
        validateProtocolArtifact('operate-allowed-action', action, {
          protocolVersion: '2.0.0',
        }),
      ).toEqual([]);
      expect(action.arguments).toMatchObject({
        cycleId: initial.cycle.cycleId,
        actor: ownerActor,
        scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
      });
    }
    const review = await readExactOwnerReviewForFixture(client, initial.cycle.cycleId, ownerActor);
    const reviewId = String(review.readRequest.reviewId);
    expect(JSON.stringify(review.allowedActions)).not.toContain('<required>');
    expect(review.allowedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: 'operate.review.submit',
          arguments: expect.objectContaining({
            reviewId,
            actor: expect.objectContaining({ actorId: 'owner-test' }),
          }),
        }),
      ]),
    );

    const reviewActions = review.allowedActions as Array<{
      tool: 'operate.review.get' | 'operate.review.submit';
      arguments: Record<string, unknown>;
    }>;
    const approvalAction = reviewActions.find(
      ({ tool, arguments: argumentsValue }) =>
        tool === 'operate.review.submit' &&
        argumentsValue.disposition === 'approved' &&
        Array.isArray(argumentsValue.workDispositions) &&
        argumentsValue.workDispositions.every(
          (entry) =>
            (entry as Record<string, unknown>).disposition === 'approved' ||
            (entry as Record<string, unknown>).disposition === 'accepted',
        ),
    );
    if (!approvalAction) throw new Error('missing exact decision-ready Review approval');
    const storeRoot = join(fixture.dir, '.planr', 'operate', 'state');
    const actionMatrixBackup = join(fixture.dir, '.planr', 'operate-action-matrix');
    await cp(storeRoot, actionMatrixBackup, { recursive: true });
    for (const [index, action] of reviewActions.entries()) {
      if (index > 0) {
        await rm(storeRoot, { recursive: true, force: true });
        await cp(actionMatrixBackup, storeRoot, { recursive: true });
      }
      const actionResult = await createOperateClient(fixture.dir).dispatch({
        operation: action.tool,
        request: action.arguments as never,
      });
      if (!actionResult.ok) {
        throw new Error(
          `advertised Review choice failed: ${JSON.stringify({ action, actionResult })}`,
        );
      }
      expect(actionResult).toMatchObject({ ok: true, operation: action.tool });
    }
    await rm(storeRoot, { recursive: true, force: true });
    await cp(actionMatrixBackup, storeRoot, { recursive: true });
    const substitutedApproval = structuredClone(approvalAction);
    (substitutedApproval.arguments.actor as { actorId: string }).actorId = 'substituted-owner';
    expect(
      await client.dispatch({
        operation: substitutedApproval.tool,
        request: substitutedApproval.arguments as never,
      }),
    ).toMatchObject({ ok: false, error: { code: 'REVIEW_NOT_AUTHORIZED' } });

    const approved = await client.dispatch({
      operation: approvalAction.tool,
      request: approvalAction.arguments as never,
    });
    expect(approved).toMatchObject({
      ok: true,
      data: {
        kind: 'operating-review-receipt',
        protocolVersion: '2.0.0',
        cycleId: initial.cycle.cycleId,
        decision: 'approved',
        decisions: [expect.objectContaining({ decisionId: expect.stringMatching(/^dec_/u) })],
        actions: [],
        appliedChoiceId: expect.stringMatching(/^rch_/u),
        appliedChoiceHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      },
    });
    expect(JSON.stringify(approved).includes('<required>')).toBe(false);
    const closed = await client.dispatch({
      operation: 'operate.cycle.get',
      request: { cycleId: initial.cycle.cycleId },
    });
    expect(closed).toMatchObject({
      ok: true,
      data: {
        cycle: { state: 'closed' },
        persistentWork: {
          ledger: {
            decisions: [{ state: 'approved' }],
            actions: [],
          },
        },
        actions: [{ tool: 'operate.cycle.get', effect: 'read-only' }],
      },
    });
    expect(
      (
        await client.dispatch({
          operation: 'operate.cycle.resume',
          request: { cycleId: initial.cycle.cycleId },
        })
      ).ok,
    ).toBe(true);
  });
});
