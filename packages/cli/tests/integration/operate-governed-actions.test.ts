import { sha256Jcs } from 'planr-pipeline/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { OperateApiEnvelopeV2, OperateClient } from '../../src/services/operate/client.js';
import {
  createOperateCommandGateway,
  type OperateCommandRuntimeV2,
} from '../../src/services/operate/command-gateway.js';
import type { OperateSessionBindingV2 } from '../../src/services/operate/session-capability.js';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const ACTION_HASH = `sha256:${'c'.repeat(64)}`;
const origin = 'http://127.0.0.1:7473';
const actor = { actorId: 'owner-acme', kind: 'human' as const, runtime: 'openplanr' };
const actionIdentity = {
  actionId: 'act_1234567890abcdef',
  revision: 1,
  actionHash: ACTION_HASH,
};

type AllowedAction = {
  tool: string;
  arguments: Record<string, unknown>;
  label: string;
  effect: string;
};

function allowedAction(
  tool: 'operate.action.approve' | 'operate.action.execute' | 'operate.action.rollback',
) {
  if (tool === 'operate.action.approve') {
    return {
      tool,
      arguments: { action: actionIdentity, decision: 'approved' },
      label: 'Approve the contained Action',
      effect: 'project-write',
    };
  }
  if (tool === 'operate.action.rollback') {
    return {
      tool,
      arguments: {
        action: actionIdentity,
        originalOperationId: 'op_1234567890abcdef',
        rollbackPlanId: 'rbp_1234567890abcdef',
      },
      label: 'Restore the certified local baseline',
      effect: 'project-write',
    };
  }
  return {
    tool,
    arguments: { action: actionIdentity },
    label: 'Execute the contained Action once',
    effect: 'project-write',
  };
}

function projectedAction(state = 'proposed') {
  return {
    ...actionIdentity,
    title: 'Apply the contained local project record',
    state,
    ownerActorId: actor.actorId,
    expectedResult: 'A later accepted observation reaches the declared target.',
    verificationPlanId: 'verify_1234567890abcdef',
    deliveryRoute: {
      kind: 'operating-delivery-route',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      routeId: 'droute_1234567890abcdef',
      scopeId: 'scope-acme',
      domainId: 'software',
      domainVersion: '1.0.0',
      action: actionIdentity,
      eventHead: { sequence: 8, hash: HASH_A },
      route: 'contained-execution',
      rationale: 'The exact bounded local effect is certified.',
      createdAt: '2026-08-11T08:00:00.000Z',
      routeHash: HASH_B,
    },
    dependencyActionIds: [],
    executions: [],
    rollbacks: [],
    deepLink: `#/operate/actions/${actionIdentity.actionId}`,
  };
}

function approvalParty(state = 'required') {
  return {
    partyId: 'party_owner_1234567890abcdef',
    actorKind: 'human',
    actorId: actor.actorId,
    requiredCapability: { id: 'action-approve', version: '1.0.0' },
    state,
    redacted: false,
  };
}

function approvalInboxItem(selected: AllowedAction) {
  return {
    itemId: `approval:${actionIdentity.actionId}`,
    kind: 'approval',
    subjectId: actionIdentity.actionId,
    ownerActorId: actor.actorId,
    state: 'waiting',
    title: 'Approve the exact contained Action',
    consequence: 'The governed Action remains blocked until this approval is recorded.',
    expiresAt: '2099-08-11T08:10:00.000Z',
    blocking: true,
    evidence: [],
    requiredParties: [approvalParty()],
    redactions: [],
    actionLocator: {
      subjectId: actionIdentity.actionId,
      actionDigest: sha256Jcs(selected as never),
    },
    navigationLocator: null,
    unavailableReason: null,
  };
}

function experienceView(selected: AllowedAction, overrides: Record<string, unknown> = {}) {
  if (selected.tool !== 'operate.action.approve') {
    throw new Error('Only the owner-issued Approval is projected into Inbox command custody.');
  }
  const eventHead = (overrides.eventHead as { sequence: number; hash: string } | undefined) ?? {
    sequence: 8,
    hash: HASH_A,
  };
  const sourceStateHash = String(overrides.sourceStateHash ?? ACTION_HASH);
  const inbox = (overrides.inbox as unknown[] | undefined) ?? [approvalInboxItem(selected)];
  const actions = (overrides.actions as unknown[] | undefined) ?? [projectedAction()];
  const history = (overrides.history as unknown[] | undefined) ?? [];
  const allowedActions = (overrides.allowedActions as unknown[] | undefined) ?? [
    { subjectId: actionIdentity.actionId, action: selected },
  ];
  const source = {
    kind: 'operate-experience-view',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    viewId: 'xview_1234567890abcdef',
    scopeId: 'scope-acme',
    domainId: 'software',
    domainVersion: '1.0.0',
    actorId: actor.actorId,
    accessLevel: 'internal',
    generatedAt: '2026-08-11T08:00:00.000Z',
    eventHead,
    sourceStateHash,
    status: 'ready',
    attention: [],
    domainMetrics: [],
    cycles: [
      {
        cycleId: 'cyc_1234567890abcdef',
        state: 'approved',
        health: 'normal',
        focus: ['Governed local work'],
        createdAt: '2026-08-11T07:00:00.000Z',
        updatedAt: '2026-08-11T08:00:00.000Z',
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
        persistentActionIds: [actionIdentity.actionId],
        replayCheckpoint: null,
        deepLink: '#/operate/cycles/cyc_1234567890abcdef',
      },
    ],
    inbox,
    actions,
    evidence: [],
    claims: [],
    rationale: [],
    outcomes: [],
    learnings: [],
    history,
    replay: {
      checkpoint: null,
      tail: {
        startSequence: 1,
        endSequence: eventHead.sequence,
        eventCount: eventHead.sequence,
        eventReplayIndexHash: eventHead.hash,
      },
      finalHead: eventHead,
      liveAccessUsed: false,
      parityProof: {
        sourceStateHash,
        eventReplayIndexHash: eventHead.hash,
        checkpointVerified: false,
        finalEventHashMatches: true,
        stateParityVerified: false,
      },
      filterDimensions: [
        'cycle',
        'action',
        'decision',
        'actor',
        'operation',
        'result',
        'event-type',
        'date',
      ],
      redactions: [],
    },
    allowedActions,
    omissions: [],
    export: { formats: ['json'], accessSafe: true, redactionCount: 0 },
  };
  return { ...source, viewHash: sha256Jcs(source) };
}

function approvalPreview(view: Record<string, unknown>, input: Record<string, unknown>) {
  const selected = allowedAction('operate.action.approve');
  const base = {
    kind: 'operate-experience-preview',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    previewId: 'xprv_approval_1234567890abcdef',
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
    actorId: view.actorId,
    subject: {
      kind: 'action',
      id: actionIdentity.actionId,
      revision: actionIdentity.revision,
      hash: actionIdentity.actionHash,
    },
    eventHead: structuredClone(view.eventHead),
    sourceViewHash: view.viewHash,
    actionDigest: sha256Jcs(selected as never),
    allowedAction: selected,
    authority: input.authority,
    consequence: 'Record this exact approval without executing the governed Action.',
    reasonCodes: input.reasonCodes,
    transition: {
      kind: 'approval',
      targets: [
        {
          kind: 'operating-action',
          id: actionIdentity.actionId,
          revision: actionIdentity.revision,
          hash: actionIdentity.actionHash,
          disposition: 'approved',
        },
      ],
      reversible: false,
      nextState: 'threshold-satisfied',
      threshold: {
        required: 1,
        recorded: 1,
        remaining: 0,
        parties: [approvalParty('recorded')],
      },
    },
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
  };
  return { ...base, previewHash: sha256Jcs(base as never) };
}

function fakeClient(read: () => Record<string, unknown>): OperateClient {
  return {
    dispatch: vi.fn(async () => ({
      ok: true,
      operation: 'operate.experience.get',
      data: read(),
      allowedActions: [],
    })),
    createExperiencePreview: vi.fn(async (input: Record<string, unknown>) =>
      approvalPreview(input.view as Record<string, unknown>, input),
    ),
  } as unknown as OperateClient;
}

class DisposableGovernedRuntime implements OperateCommandRuntimeV2 {
  readonly receipts = new Map<string, { inputHash: string; result: OperateApiEnvelopeV2 }>();
  effectCount = 0;
  targetAccessCount = 0;
  uncertain = false;

  async perform(input: Parameters<OperateCommandRuntimeV2['perform']>[0]) {
    const identity = input.action.arguments.action as typeof actionIdentity;
    const key = `${input.action.tool}:${identity.actionId}:${identity.revision}`;
    const inputHash = sha256Jcs(input.action as never);
    const existing = this.receipts.get(key);
    if (existing) {
      if (existing.inputHash !== inputHash) {
        const error = new Error('The durable operation identity already has different bytes.');
        (error as Error & { code: string }).code = 'OPERATION_ID_REUSE';
        throw error;
      }
      return structuredClone(existing.result);
    }
    this.targetAccessCount += 1;
    this.effectCount += 1;
    if (this.uncertain) {
      const error = new Error('Acknowledgement was lost; reconcile before any redispatch.');
      (error as Error & { code: string }).code = 'OPERATION_UNCERTAIN';
      throw error;
    }
    const result: OperateApiEnvelopeV2 = {
      ok: true,
      operation: input.action.tool as never,
      data: {
        durableResultId: `res_${identity.actionId.slice(4)}`,
        operationId: `op_${identity.actionId.slice(4)}`,
        effectCount: this.effectCount,
        verificationAssignmentId:
          input.action.tool === 'operate.action.execute' ? 'asg_verify_12345678' : null,
        rollbackResultId:
          input.action.tool === 'operate.action.rollback' ? 'rbr_1234567890abcdef' : null,
        reconciliation: 'not-required',
      },
      allowedActions: [],
    };
    this.receipts.set(key, { inputHash, result: structuredClone(result) });
    return result;
  }
}

async function command(runtime: OperateCommandRuntimeV2, selected: AllowedAction) {
  if (selected.tool !== 'operate.action.approve') {
    throw new Error('Execute and Rollback use the direct governed runtime, not Inbox custody.');
  }
  let current = experienceView(selected);
  const publicRuntime: OperateCommandRuntimeV2 = {
    async perform(input) {
      const result = await runtime.perform(input);
      if (result.ok) {
        current = experienceView(selected, {
          eventHead: { sequence: 9, hash: HASH_B },
          sourceStateHash: HASH_A,
          inbox: [],
          actions: [projectedAction('approved')],
          history: [
            {
              eventId: 'evt_result_123456789',
              sequence: 9,
              type: 'approval.recorded',
              entityId: actionIdentity.actionId,
              actorKind: 'runtime',
              actorId: 'current-actor',
              timestamp: '2026-08-11T08:01:00.000Z',
              correlationId: 'corr_result_12345678',
              eventHash: HASH_B,
              change: {
                subjectKind: 'action',
                summary: 'Recorded the governed local result.',
              },
              why: 'The exact runtime-issued Action was confirmed.',
              authority: null,
              evidenceRefIds: [],
              prior: { previousEventHash: HASH_A, causationId: null },
              result: { status: 'succeeded', completedAt: '2026-08-11T08:01:00.000Z' },
              next: null,
              deepLinks: ['#/operate/actions/act_1234567890abcdef'],
              beforeAfter: null,
            },
          ],
          allowedActions: [],
        });
      }
      return result;
    },
  };
  const gateway = createOperateCommandGateway({
    client: fakeClient(() => current),
    runtime: publicRuntime,
  });
  const actionLocator = {
    subjectId: actionIdentity.actionId,
    actionDigest: sha256Jcs(selected as never),
  };
  const session = await gateway.issueSession({
    cycleId: 'cyc_1234567890abcdef',
    eventHead: structuredClone(current.eventHead) as { sequence: number; hash: string },
    sourceViewHash: String(current.viewHash),
    actionLocator,
    actor,
    origin,
  });
  expect(session.binding).toMatchObject({
    actorId: actor.actorId,
    cycleId: 'cyc_1234567890abcdef',
    eventHead: { sequence: 8, hash: HASH_A },
    sourceViewHash: current.viewHash,
    actionLocator,
  });
  expect(session.allowedActions).toEqual([
    {
      actionReference: expect.stringMatching(/^opact_/u),
      subjectId: actionIdentity.actionId,
      actionDigest: actionLocator.actionDigest,
    },
  ]);
  expect(JSON.stringify(session)).not.toContain('arguments');
  const preview = await gateway.preview({
    sessionId: session.sessionId,
    capability: session.sessionCapability,
    origin,
    actionReference: session.allowedActions[0].actionReference,
  });
  return { gateway, session, preview };
}

function directRuntimeInput(selected: AllowedAction) {
  const binding: OperateSessionBindingV2 = {
    actorId: actor.actorId,
    scopeId: 'scope-acme',
    domainId: 'software',
    domainVersion: '1.0.0',
    cycleId: 'cyc_1234567890abcdef',
    eventHead: { sequence: 8, hash: HASH_A },
    sourceViewHash: sha256Jcs({ direct: selected.tool, action: selected } as never),
    actionLocator: {
      subjectId: actionIdentity.actionId,
      actionDigest: sha256Jcs(selected as never),
    },
  };
  return {
    action: structuredClone(selected),
    actor,
    binding,
    previewId: `xprv_direct_${selected.tool.slice('operate.action.'.length)}_12345678`,
    previewHash: sha256Jcs({ binding, action: selected } as never),
  };
}

describe('governed Action execution through the local command boundary', () => {
  it.each(['operate.action.approve', 'operate.action.execute', 'operate.action.rollback'] as const)(
    '%s produces one durable local effect and exact replay',
    async (tool) => {
      const runtime = new DisposableGovernedRuntime();
      const selected = allowedAction(tool);
      if (tool === 'operate.action.approve') {
        const first = await command(runtime, selected);
        expect(first.preview).toMatchObject({
          actionDigest: sha256Jcs(selected as never),
          transition: {
            kind: 'approval',
            targets: [
              expect.objectContaining({
                kind: 'operating-action',
                id: actionIdentity.actionId,
                disposition: 'approved',
              }),
            ],
            reversible: false,
            nextState: 'threshold-satisfied',
            threshold: { required: 1, recorded: 1, remaining: 0 },
          },
        });
        const result = await first.gateway.confirm({
          sessionId: first.session.sessionId,
          capability: first.session.sessionCapability,
          origin,
          previewId: String(first.preview.previewId),
          previewHash: String(first.preview.previewHash),
        });
        expect(result).toMatchObject({
          ok: true,
          eventHead: { sequence: 9, hash: HASH_B },
          data: {
            kind: 'operate-experience-view',
            eventHead: { sequence: 9, hash: HASH_B },
            inbox: [],
            actions: [expect.objectContaining({ state: 'approved' })],
          },
        });
        expect(JSON.stringify(result)).not.toContain('durableResultId');

        const exactRetry = await first.gateway.confirm({
          sessionId: first.session.sessionId,
          capability: first.session.sessionCapability,
          origin,
          previewId: String(first.preview.previewId),
          previewHash: String(first.preview.previewHash),
        });
        expect(exactRetry).toEqual(result);

        // Browser sessions intentionally die on restart. A fresh gateway obtains a
        // fresh exact Approval preview while the durable runtime replays its receipt.
        const restarted = await command(runtime, selected);
        const restartReplay = await restarted.gateway.confirm({
          sessionId: restarted.session.sessionId,
          capability: restarted.session.sessionCapability,
          origin,
          previewId: String(restarted.preview.previewId),
          previewHash: String(restarted.preview.previewHash),
        });
        expect(restartReplay).toEqual(result);
      } else {
        const input = directRuntimeInput(selected);
        const result = await runtime.perform(input);
        expect(result).toMatchObject({
          ok: true,
          operation: tool,
          data: { effectCount: 1, reconciliation: 'not-required' },
        });
        if (tool === 'operate.action.execute') {
          expect(result).toMatchObject({
            data: { verificationAssignmentId: 'asg_verify_12345678' },
          });
        } else {
          expect(result).toMatchObject({
            data: { rollbackResultId: 'rbr_1234567890abcdef' },
          });
        }
        const exactRetry = await runtime.perform(structuredClone(input));
        expect(exactRetry).toEqual(result);
        const restartReplay = await runtime.perform(structuredClone(input));
        expect(restartReplay).toEqual(result);
        expect(runtime.receipts.size).toBe(1);
      }
      expect(runtime.effectCount).toBe(1);
      expect(runtime.targetAccessCount).toBe(1);
    },
  );

  it('rejects divergent confirmation before target access or effect', async () => {
    const runtime = new DisposableGovernedRuntime();
    const request = await command(runtime, allowedAction('operate.action.approve'));
    await expect(
      request.gateway.confirm({
        sessionId: request.session.sessionId,
        capability: request.session.sessionCapability,
        origin,
        previewId: String(request.preview.previewId),
        previewHash: `sha256:${'d'.repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: 'OPERATE_PREVIEW_CONFLICT' });
    expect(runtime.targetAccessCount).toBe(0);
    expect(runtime.effectCount).toBe(0);
  });

  it('keeps uncertain approval terminal and never blindly retries', async () => {
    const runtime = new DisposableGovernedRuntime();
    runtime.uncertain = true;
    const request = await command(runtime, allowedAction('operate.action.approve'));
    const confirm = () =>
      request.gateway.confirm({
        sessionId: request.session.sessionId,
        capability: request.session.sessionCapability,
        origin,
        previewId: String(request.preview.previewId),
        previewHash: String(request.preview.previewHash),
      });
    const first = await confirm();
    expect(first).toMatchObject({
      ok: false,
      error: { code: 'OPERATION_UNCERTAIN', retryable: false },
    });
    const replay = await confirm();
    expect(replay).toEqual(first);
    expect(runtime.targetAccessCount).toBe(1);
    expect(runtime.effectCount).toBe(1);
  });
});
