import { sha256Jcs } from 'planr-pipeline/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createActionActions } from '../../../../apps/dashboard/src/features/operate/actions/action-actions.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const ACTION_ID = 'act_command_transport_0001';
const CYCLE_ID = 'cyc_command_transport_0001';

function identity() {
  return createDashboardQueryIdentity({
    route: `#/operate/actions/${ACTION_ID}`,
    productArea: 'operate',
    projectId: HASH_A,
    scopeId: 'scope-command-transport',
    domainId: 'software',
    domainVersion: '1.0.0',
    actorId: 'owner-command-transport',
    cycleId: CYCLE_ID,
    subjectId: ACTION_ID,
    eventHead: { sequence: 4, hash: HASH_A },
    viewHash: HASH_A,
    generation: 1,
  });
}

function sessionEnvelope(
  current: ReturnType<typeof identity>,
  locator: { subjectId: string; actionDigest: string },
) {
  return {
    kind: 'operate-command-session',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    sessionId: 'opsess_command_transport_01',
    sessionCapability: 'A'.repeat(43),
    issuedAt: '2026-08-11T08:00:00.000Z',
    expiresAt: '2099-08-11T08:10:00.000Z',
    binding: {
      actorId: current.actorId,
      scopeId: current.scopeId,
      domainId: current.domainId,
      domainVersion: current.domainVersion,
      cycleId: current.cycleId,
      eventHead: current.eventHead,
      sourceViewHash: current.viewHash,
      actionLocator: locator,
    },
    allowedActions: [
      {
        actionReference: 'opact_command_transport_0001',
        subjectId: locator.subjectId,
        actionDigest: locator.actionDigest,
      },
    ],
    readOnly: false,
  };
}

function previewEnvelope(
  current: ReturnType<typeof identity>,
  locator: { subjectId: string; actionDigest: string },
  allowedAction: Record<string, unknown>,
) {
  const base = {
    kind: 'operate-experience-preview',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    previewId: 'xprv_command_transport_12345678',
    scopeId: current.scopeId,
    domainId: current.domainId,
    domainVersion: current.domainVersion,
    actorId: current.actorId,
    subject: { kind: 'action', id: locator.subjectId, revision: 1, hash: HASH_A },
    eventHead: structuredClone(current.eventHead),
    sourceViewHash: current.viewHash,
    actionDigest: locator.actionDigest,
    allowedAction,
    authority: 'allowed',
    consequence: 'Confirm the exact runtime-issued preview.',
    reasonCodes: [],
    transition: {
      kind: 'approval',
      targets: [
        {
          kind: 'operating-action',
          id: locator.subjectId,
          revision: 1,
          hash: HASH_A,
          disposition: 'approved',
        },
      ],
      reversible: false,
      nextState: 'threshold-satisfied',
      threshold: { required: 1, recorded: 1, remaining: 0, parties: [] },
    },
    issuedAt: '2026-08-11T08:00:00.000Z',
    expiresAt: '2099-08-11T08:10:00.000Z',
  };
  return { ...base, previewHash: sha256Jcs(base as never) };
}

function confirmEnvelope(
  current: ReturnType<typeof identity>,
  operation: string,
  eventHead = { sequence: 5, hash: HASH_B },
) {
  const view = {
    kind: 'operate-experience-view',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    viewId: 'xview_command_transport_01',
    scopeId: current.scopeId,
    domainId: current.domainId,
    domainVersion: current.domainVersion,
    actorId: current.actorId,
    accessLevel: 'internal',
    generatedAt: '2026-08-11T08:01:00.000Z',
    eventHead,
    sourceStateHash: HASH_A,
    status: 'ready',
    attention: [],
    domainMetrics: [],
    cycles: [],
    inbox: [],
    actions: [],
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
      finalHead: eventHead,
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
    viewHash: HASH_B,
  };
  return {
    ok: true,
    operation,
    data: view,
    allowedActions: [],
    eventHead,
  };
}

describe('dashboard action command transport', () => {
  it('requires bind before preview and confirms governed approval through session custody', async () => {
    const current = identity();
    const approveAction = {
      tool: 'operate.action.approve',
      arguments: {
        action: { actionId: ACTION_ID, revision: 1, actionHash: HASH_A },
        decision: 'approved',
      },
      label: 'Approve the governed Action',
      effect: 'project-write',
    };
    const locator = {
      subjectId: ACTION_ID,
      actionDigest: sha256Jcs(approveAction as never),
    };
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/api/operate/session')) {
        return new Response(JSON.stringify(sessionEnvelope(current, locator)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/operate/commands/preview')) {
        return new Response(JSON.stringify(previewEnvelope(current, locator, approveAction)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/operate/commands/confirm')) {
        return new Response(JSON.stringify(confirmEnvelope(current, 'operate.action.approve')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    });
    const actions = createActionActions({
      origin: 'http://127.0.0.1:7473',
      fetcher,
    });
    await expect(actions.preview(locator)).rejects.toMatchObject({
      name: 'OPERATE_BINDING_REQUIRED',
    });
    actions.bind(current);
    const custody = await actions.preview(locator);
    expect(custody.preview.allowedAction.tool).toBe('operate.action.approve');
    const confirmed = await custody.confirm();
    expect(confirmed).toEqual({ ok: true, eventHead: { sequence: 5, hash: HASH_B } });
    expect(calls.filter((url) => url.includes('/api/operate/session'))).toHaveLength(1);
    expect(calls.filter((url) => url.includes('/api/operate/commands/preview'))).toHaveLength(1);
    expect(calls.filter((url) => url.includes('/api/operate/commands/confirm'))).toHaveLength(1);
  });

  it('issues preview and confirm requests for governed execute controls', async () => {
    const current = identity();
    const executeAction = {
      tool: 'operate.action.execute',
      arguments: {
        action: { actionId: ACTION_ID, revision: 1, actionHash: HASH_A },
      },
      label: 'Execute this exact approved Action',
      effect: 'project-write',
    };
    const locator = {
      subjectId: ACTION_ID,
      actionDigest: sha256Jcs(executeAction as never),
    };
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/api/operate/session')) {
        return new Response(JSON.stringify(sessionEnvelope(current, locator)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/operate/commands/preview')) {
        return new Response(JSON.stringify(previewEnvelope(current, locator, executeAction)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/operate/commands/confirm')) {
        return new Response(JSON.stringify(confirmEnvelope(current, 'operate.action.execute')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    });
    const actions = createActionActions({
      origin: 'http://127.0.0.1:7473',
      fetcher,
    });
    actions.bind(current);
    const custody = await actions.preview(locator);
    expect(custody.preview.allowedAction.tool).toBe('operate.action.execute');
    const confirmed = await custody.confirm();
    expect(confirmed).toEqual({ ok: true, eventHead: { sequence: 5, hash: HASH_B } });
    expect(calls.filter((url) => url.includes('/api/operate/commands/preview'))).toHaveLength(1);
    expect(calls.filter((url) => url.includes('/api/operate/commands/confirm'))).toHaveLength(1);
  });

  it('keeps an uncertain command locked until an exact bound reconciliation', async () => {
    const current = identity();
    const approveAction = {
      tool: 'operate.action.approve',
      arguments: {
        action: { actionId: ACTION_ID, revision: 1, actionHash: HASH_A },
        decision: 'approved',
      },
      label: 'Approve the governed Action',
      effect: 'project-write',
    };
    const locator = {
      subjectId: ACTION_ID,
      actionDigest: sha256Jcs(approveAction as never),
    };
    let loseConfirmation = true;
    const fetcher = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes('/api/operate/session')) {
        return new Response(JSON.stringify(sessionEnvelope(current, locator)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/operate/commands/preview')) {
        return new Response(JSON.stringify(previewEnvelope(current, locator, approveAction)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/operate/commands/confirm')) {
        if (loseConfirmation) throw new TypeError('acknowledgement lost');
        return new Response(JSON.stringify(confirmEnvelope(current, 'operate.action.approve')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    });
    const actions = createActionActions({ origin: 'http://127.0.0.1:7473', fetcher });
    actions.bind(current);
    const custody = await actions.preview(locator);
    await expect(custody.confirm()).resolves.toEqual({
      ok: false,
      reasonCode: 'OPERATION_UNCERTAIN',
    });
    actions.cancel();
    await expect(actions.preview(locator)).rejects.toMatchObject({
      name: 'OPERATION_UNCERTAIN',
    });
    expect(() =>
      actions.reconcile(createDashboardQueryIdentity({ ...current, scopeId: 'foreign-scope' })),
    ).toThrow(/refused without effect/u);
    await expect(actions.preview(locator)).rejects.toMatchObject({
      name: 'OPERATION_UNCERTAIN',
    });

    actions.reconcile(current);
    loseConfirmation = false;
    await expect(actions.preview(locator)).resolves.toMatchObject({
      preview: { allowedAction: { tool: 'operate.action.approve' } },
    });
  });

  it('refuses a late preview when fetch ignores abort and the route rebinds', async () => {
    const current = identity();
    const approveAction = {
      tool: 'operate.action.approve',
      arguments: {
        action: { actionId: ACTION_ID, revision: 1, actionHash: HASH_A },
        decision: 'approved',
      },
      label: 'Approve the governed Action',
      effect: 'project-write',
    };
    const locator = {
      subjectId: ACTION_ID,
      actionDigest: sha256Jcs(approveAction as never),
    };
    let releasePreview: ((response: Response) => void) | null = null;
    const fetcher = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes('/api/operate/session')) {
        return new Response(JSON.stringify(sessionEnvelope(current, locator)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/operate/commands/preview')) {
        return await new Promise<Response>((resolve) => {
          releasePreview = resolve;
        });
      }
      return new Response('{}', { status: 404 });
    });
    const actions = createActionActions({ origin: 'http://127.0.0.1:7473', fetcher });
    actions.bind(current);
    const stalePreview = actions.preview(locator);
    await vi.waitFor(() => expect(releasePreview).not.toBeNull());

    actions.bind(createDashboardQueryIdentity({ ...current, generation: current.generation + 1 }));
    releasePreview?.(
      new Response(JSON.stringify({ stale: 'must-not-parse-or-retain' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(stalePreview).rejects.toMatchObject({ name: 'AbortError' });
  });
});
