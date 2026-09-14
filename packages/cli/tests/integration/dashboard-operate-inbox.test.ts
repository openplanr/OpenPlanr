import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { startDashboard } from 'planr-pipeline';
import { buildOperatingReviewBoundSubmissionV1 } from 'planr-pipeline/operate/runtime-v2';
import { sha256Jcs } from 'planr-pipeline/protocol';
import {
  assertOperateExperienceDisplaySurfaceV1,
  assertOperateExperiencePreviewV1,
  type OperateExperienceDisplaySurfaceV1,
} from 'planr-pipeline/schemas/v1.2.0/operate-experience-display-surface.mjs';
import { describe, expect, it, vi } from 'vitest';
import { createInboxActions } from '../../../../apps/dashboard/src/features/operate/inbox/inbox-actions.js';
import {
  dashboardProductStatePolicy,
  isValidatedDashboardProductState,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import {
  createDashboardQueryIdentity,
  type DashboardQueryIdentity,
} from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { installedOpenPlanrDashboardRoot } from '../../src/cli/commands/operate.js';
import type { OperateClient } from '../../src/services/operate/client.js';
import { createOperateCommandGateway } from '../../src/services/operate/command-gateway.js';
import { createOperateSessionCapabilityIssuerV2 } from '../../src/services/operate/session-capability.js';
import { reviewWorkspace } from '../helpers/operate-command-gateway-review.js';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

type RecordValue = Record<string, unknown>;
type Display = Readonly<OperateExperienceDisplaySurfaceV1>;

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;
const HASH_D = `sha256:${'d'.repeat(64)}`;
const CYCLE_ID = 'cyc_inbox_1234567890abcdef';
const DECISION_ID = 'dec_inbox_1234567890abcdef';
const REVIEW_ID = 'rev_inbox_1234567890abcdef';
const ORIGIN = 'http://127.0.0.1:7473';
const PRIVATE_VALUE = 'private-runtime-target-and-grant-must-never-echo';
const HEAD_A = Object.freeze({ sequence: 1, hash: HASH_A });
const HEAD_B = Object.freeze({ sequence: 2, hash: HASH_B });

function reviewAction(actorId = 'owner-inbox') {
  return {
    tool: 'operate.review.submit',
    arguments: {
      reviewId: REVIEW_ID,
      cycleId: CYCLE_ID,
      actor: { actorId, kind: 'human', runtime: 'openplanr' },
      scope: {
        scopeId: 'scope-inbox',
        domainId: 'business',
        domainVersion: '1.0.0',
      },
      disposition: 'approved',
      workDispositions: [
        {
          entityType: 'operating-decision',
          entityId: DECISION_ID,
          disposition: 'approved',
        },
      ],
    },
    label: 'Approve the exact owner Decision',
    effect: 'project-write',
  };
}

function terminalReviewReceipt(actorId: string, note: string | null = null): RecordValue {
  const selected = reviewAction(actorId);
  const choice = {
    choiceId: 'rch_inbox_1234567890abcdef',
    choiceHash: sha256Jcs(selected.arguments as never),
    submitArguments: structuredClone(selected.arguments),
  };
  return {
    kind: 'operating-review-receipt',
    receiptId: 'rrc_inbox_1234567890abcdef',
    cycleId: CYCLE_ID,
    readEventHead: structuredClone(HEAD_A),
    eventHead: structuredClone(HEAD_B),
    review: {
      reviewId: REVIEW_ID,
      workDispositions: structuredClone(selected.arguments.workDispositions),
    },
    appliedChoiceId: choice.choiceId,
    appliedChoiceHash: choice.choiceHash,
    appliedWorkDispositions: structuredClone(selected.arguments.workDispositions),
    dispositionChoices: [choice],
    boundSubmission: buildOperatingReviewBoundSubmissionV1({
      expectedReadEventHead: HEAD_A,
      choice,
      note,
    }),
  };
}

function inboxReviewWorkspace(
  view: RecordValue,
  actorId: string,
  receipt?: RecordValue,
): RecordValue {
  return reviewWorkspace({
    ...(receipt ? { receipt } : { currentActions: [reviewAction(actorId)] }),
    sourceView: view,
    context: {
      actorId,
      scopeId: 'scope-inbox',
      domainId: 'business',
      domainVersion: '1.0.0',
      cycleId: CYCLE_ID,
      reviewId: REVIEW_ID,
      choiceId: 'rch_inbox_1234567890abcdef',
    },
  });
}

function actionLocator(actorId: string) {
  return Object.freeze({
    subjectId: REVIEW_ID,
    actionDigest: sha256Jcs(reviewAction(actorId) as never),
  });
}

function inboxItems(actorId: string) {
  return [
    {
      itemId: 'decision:dec_inbox_1234567890abcdef',
      kind: 'decision',
      subjectId: DECISION_ID,
      ownerActorId: actorId,
      state: 'proposed',
      title: 'Approve café Δ — exact owner Decision 🚀',
      consequence: 'The Cycle remains blocked until the exact review is resolved.',
      expiresAt: '2099-08-12T08:00:00.000Z',
      blocking: true,
      evidence: [],
      requiredParties: [
        {
          partyId: 'party-owner',
          actorKind: 'human',
          actorId,
          requiredCapability: { id: 'operate-review', version: '1.0.0' },
          state: 'required',
          redacted: false,
        },
      ],
      redactions: [],
      actionLocator: { ...actionLocator(actorId) },
      navigationLocator: null,
      unavailableReason: null,
    },
    {
      itemId: 'approval:aprq_inbox_12345678',
      kind: 'approval',
      subjectId: 'act_inbox_1234567890abcdef',
      ownerActorId: actorId,
      state: 'waiting',
      title: 'Approval requires another named party',
      consequence: 'The governed Action remains blocked.',
      expiresAt: '2099-08-12T08:00:00.000Z',
      blocking: true,
      evidence: [],
      requiredParties: [
        {
          partyId: 'party-restricted',
          actorKind: 'human',
          actorId: null,
          requiredCapability: { id: 'action-approve', version: '1.0.0' },
          state: 'redacted',
          redacted: true,
        },
      ],
      redactions: [{ classification: 'confidential', count: 1, reason: 'identity-redacted' }],
      actionLocator: null,
      navigationLocator: null,
      unavailableReason: {
        code: 'OPERATE_APPROVAL_PARTY_UNAVAILABLE',
        message: 'This actor is not an eligible remaining approval party.',
      },
    },
    {
      itemId: 'verification:asg_inbox_12345678',
      kind: 'verification',
      subjectId: 'asg_inbox_1234567890abcdef',
      ownerActorId: actorId,
      state: 'available',
      title: 'Verification evidence is required',
      consequence: 'The expected outcome remains unverified.',
      expiresAt: null,
      blocking: false,
      evidence: [],
      requiredParties: [],
      redactions: [],
      actionLocator: null,
      navigationLocator: null,
      unavailableReason: {
        code: 'OPERATE_VERIFICATION_SUBMISSION_UNAVAILABLE',
        message: 'No exact owner-issued verification submission is available.',
      },
    },
  ].sort(
    (left, right) =>
      Number(right.blocking) - Number(left.blocking) || left.itemId.localeCompare(right.itemId),
  );
}

function experienceView({
  actorId = 'owner-inbox',
  head = HEAD_A,
  commandable = true,
}: {
  actorId?: string;
  head?: Readonly<{ sequence: number; hash: string }>;
  commandable?: boolean;
} = {}): RecordValue {
  const source: RecordValue = {
    kind: 'operate-experience-view',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    viewId: 'xview_inbox_1234567890abcdef',
    scopeId: 'scope-inbox',
    domainId: 'business',
    domainVersion: '1.0.0',
    actorId,
    accessLevel: 'internal',
    generatedAt: '2026-08-11T08:00:00.000Z',
    eventHead: structuredClone(head),
    sourceStateHash: HASH_C,
    status: 'ready',
    attention: [],
    domainMetrics: [],
    cycles: [
      {
        cycleId: CYCLE_ID,
        state: 'approved',
        health: 'normal',
        focus: ['Resolve exact owner Inbox work.'],
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
        persistentActionIds: [],
        replayCheckpoint: null,
        deepLink: `#/operate/cycles/${CYCLE_ID}`,
      },
    ],
    inbox: commandable
      ? inboxItems(actorId)
      : inboxItems(actorId).filter((item) => item.kind !== 'decision'),
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
        endSequence: head.sequence,
        eventCount: head.sequence,
        eventReplayIndexHash: head.hash,
      },
      finalHead: structuredClone(head),
      liveAccessUsed: false,
      parityProof: {
        sourceStateHash: HASH_C,
        eventReplayIndexHash: head.hash,
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
    allowedActions: commandable ? [{ subjectId: REVIEW_ID, action: reviewAction(actorId) }] : [],
    omissions: [],
    export: { formats: ['json', 'html'], accessSafe: true, redactionCount: 0 },
  };
  return { ...source, viewHash: sha256Jcs(source as never) };
}

let previewSequence = 0;

function previewFixture(view: RecordValue, input: RecordValue): RecordValue {
  previewSequence += 1;
  const allowedAction = reviewAction(String(view.actorId));
  const base: RecordValue = {
    kind: 'operate-experience-preview',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    previewId: `xprv_inbox_${String(previewSequence).padStart(8, '0')}`,
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
    actorId: view.actorId,
    subject: { kind: 'review', id: REVIEW_ID, revision: null, hash: HASH_D },
    eventHead: structuredClone(view.eventHead),
    sourceViewHash: view.viewHash,
    actionDigest: sha256Jcs(allowedAction as never),
    allowedAction,
    authority: input.authority,
    consequence: 'Approve the exact Decision without executing a governed Action.',
    reasonCodes: input.reasonCodes,
    transition: {
      kind: 'review',
      targets: [
        {
          kind: 'operating-decision',
          id: DECISION_ID,
          revision: 1,
          hash: HASH_C,
          disposition: 'approved',
        },
      ],
      reversible: false,
      nextState: 'approved',
      threshold: null,
    },
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
  };
  return { ...base, previewHash: sha256Jcs(base as never) };
}

function fakeClient(read: () => RecordValue): OperateClient {
  return {
    dispatch: vi.fn(async () => ({
      ok: true,
      operation: 'operate.experience.get',
      data: structuredClone(read()),
      allowedActions: [],
    })),
    createExperiencePreview: vi.fn(async (input: RecordValue) =>
      previewFixture(input.view as RecordValue, input),
    ),
  } as unknown as OperateClient;
}

function actor(actorId: string) {
  return { actorId, kind: 'human' as const, runtime: 'openplanr' };
}

function sessionRequest(view: RecordValue, actorId: string) {
  return {
    cycleId: CYCLE_ID,
    eventHead: structuredClone(view.eventHead) as { sequence: number; hash: string },
    sourceViewHash: String(view.viewHash),
    actionLocator: { ...actionLocator(actorId) },
    actor: actor(actorId),
    origin: ORIGIN,
  };
}

function displayBinding(view: RecordValue, projectId: string, generation: number) {
  return {
    actorId: String(view.actorId),
    scopeId: String(view.scopeId),
    domainId: String(view.domainId),
    domainVersion: String(view.domainVersion),
    generatedAt: String(view.generatedAt),
    eventHead: structuredClone(view.eventHead) as { sequence: number; hash: string },
    viewHash: String(view.viewHash),
    surface: 'inbox' as const,
    projectId,
    generation,
    subjectId: null,
  };
}

function dashboardIdentity(
  view: RecordValue,
  projectId: string,
  generation = 7,
  route = '#/operate/inbox',
  subjectId: string | null = null,
): DashboardQueryIdentity {
  return createDashboardQueryIdentity({
    productArea: 'operate',
    route,
    actorId: view.actorId,
    projectId,
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
    cycleId: CYCLE_ID,
    subjectId,
    eventHead: view.eventHead,
    viewHash: view.viewHash,
    generation,
  });
}

function projectId(project: TestProject): string {
  const root = realpathSync(project.dir);
  const bytes = Buffer.from(`${root}\0${project.config.projectName}`, 'utf8');
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function firstSse(url: string, actorId: string) {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: { 'x-openplanr-actor': actorId },
    signal: controller.signal,
  });
  if (!response.body) throw new Error('Expected an SSE response body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (!text.includes('\n\n')) {
      const part = await reader.read();
      if (part.done) break;
      text += decoder.decode(part.value, { stream: true });
    }
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
  const frame = text.split('\n\n')[0];
  const event = frame
    .split('\n')
    .find((line) => line.startsWith('event: '))
    ?.slice('event: '.length);
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length))
    .join('\n');
  return { response, event, json: JSON.parse(data) as RecordValue };
}

function adapterSession(identity: DashboardQueryIdentity): RecordValue {
  return {
    kind: 'operate-command-session',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    sessionId: 'opsess_hostile_1234567890abcdef',
    sessionCapability: 'D'.repeat(43),
    issuedAt: '2026-08-11T08:00:00.000Z',
    expiresAt: '2026-08-11T08:10:00.000Z',
    binding: {
      actorId: identity.actorId,
      scopeId: identity.scopeId,
      domainId: identity.domainId,
      domainVersion: identity.domainVersion,
      cycleId: identity.cycleId,
      eventHead: identity.eventHead,
      sourceViewHash: identity.viewHash,
      actionLocator: actionLocator(identity.actorId),
    },
    allowedActions: [
      {
        actionReference: 'opact_hostile_1234567890abcdef',
        subjectId: REVIEW_ID,
        actionDigest: actionLocator(identity.actorId).actionDigest,
      },
    ],
    readOnly: false,
  };
}

function publicConfirmationView(
  identity: DashboardQueryIdentity,
  eventHead: Readonly<{ sequence: number; hash: string | null }> = HEAD_B,
): RecordValue {
  return {
    kind: 'operate-experience-view',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    actorId: identity.actorId,
    scopeId: identity.scopeId,
    domainId: identity.domainId,
    domainVersion: identity.domainVersion,
    eventHead: structuredClone(eventHead),
    privateReceipt: PRIVATE_VALUE,
  };
}

function adapterFetcher(
  identity: DashboardQueryIdentity,
  preview: RecordValue,
  confirm: (init?: RequestInit) => Response | Promise<Response>,
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const pathname = new URL(String(input), ORIGIN).pathname;
    if (pathname === '/api/operate/session') {
      return new Response(JSON.stringify(adapterSession(identity)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname === '/api/operate/commands/preview') {
      return new Response(JSON.stringify(preview), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname === '/api/operate/commands/confirm') return confirm(init);
    throw new Error(`Unexpected route: ${pathname}`);
  });
}

function confirmCallCount(fetcher: ReturnType<typeof vi.fn>): number {
  return fetcher.mock.calls.filter(([input]) =>
    new URL(String(input), ORIGIN).pathname.endsWith('/commands/confirm'),
  ).length;
}

describe('T-016 owner Inbox dashboard integration', () => {
  it('serves one exact owner-issued Inbox over REST and SSE, then parser-freezes and brands it', async () => {
    const project = await createTestProject('t016-owner-inbox');
    const view = experienceView();
    const gateway = createOperateCommandGateway({
      client: fakeClient(() => view),
      runtime: { perform: vi.fn() },
    });
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
      getOperatingCommandGateway: () => gateway,
    });
    try {
      const port = await dashboard.listen(0, {
        env: { ...process.env, PLANR_HOME: join(project.dir, '.planr-home') },
      });
      const base = `http://127.0.0.1:${port}`;
      const exactProjectId = projectId(project);
      const generation = 7;
      const query = new URLSearchParams({
        scopeId: String(view.scopeId),
        domainId: String(view.domainId),
        domainVersion: String(view.domainVersion),
        projectId: exactProjectId,
        generation: String(generation),
      });
      const response = await fetch(`${base}/api/operate/inbox?${query}`, {
        headers: { 'x-openplanr-actor': String(view.actorId) },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toContain('no-store');
      const expected = displayBinding(view, exactProjectId, generation);
      const display = assertOperateExperienceDisplaySurfaceV1(await response.json(), expected);
      expect(display.payload).toMatchObject({
        surface: 'inbox',
        actorId: view.actorId,
        eventHead: view.eventHead,
        viewHash: view.viewHash,
        data: {
          requestBinding: { projectId: exactProjectId, generation, subjectId: null },
          inbox: [
            expect.objectContaining({ kind: 'approval' }),
            expect.objectContaining({
              kind: 'decision',
              actionLocator: actionLocator(String(view.actorId)),
              navigationLocator: null,
              unavailableReason: null,
            }),
            expect.objectContaining({ kind: 'verification' }),
          ],
        },
      });
      expect(JSON.stringify(display)).not.toContain('workDispositions');

      const identity = dashboardIdentity(view, exactProjectId, generation);
      const parsed = parseDashboardProductState<Display>(
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
            try {
              assertOperateExperienceDisplaySurfaceV1(value, expected);
              return true;
            } catch {
              return false;
            }
          },
        },
      );
      expect(isValidatedDashboardProductState(parsed)).toBe(true);
      expect(isValidatedDashboardProductState({ ...parsed })).toBe(false);
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(Object.isFrozen(parsed.data)).toBe(true);
      expect(Object.isFrozen(parsed.data?.payload.data.inbox)).toBe(true);

      const liveQuery = new URLSearchParams(query);
      liveQuery.set('surface', 'inbox');
      const live = await firstSse(`${base}/api/operate/events?${liveQuery}`, String(view.actorId));
      expect(live.response.status).toBe(200);
      expect(live.event).toBe('snapshot');
      expect(live.json.binding).toEqual({
        actorId: view.actorId,
        scopeId: view.scopeId,
        domainId: view.domainId,
        domainVersion: view.domainVersion,
        projectId: exactProjectId,
        generation,
      });
      expect(live.json.cursor).toEqual({ eventHead: view.eventHead, viewHash: view.viewHash });
      assertOperateExperienceDisplaySurfaceV1(live.json.payload, expected);

      for (const [label, url, actorId] of [
        [
          'project',
          `${base}/api/operate/inbox?${new URLSearchParams({
            ...Object.fromEntries(query),
            projectId: HASH_D,
          })}`,
          String(view.actorId),
        ],
        ['actor', `${base}/api/operate/inbox?${query}`, PRIVATE_VALUE],
      ] as const) {
        const refused = await fetch(url, { headers: { 'x-openplanr-actor': actorId } });
        const body = await refused.text();
        expect(refused.status, label).toBe(403);
        expect(body, label).not.toContain(project.dir);
        expect(body, label).not.toContain(PRIVATE_VALUE);
      }
    } finally {
      await dashboard.close();
      project.cleanup();
    }
  });

  it('coalesces one confirmation globally across two sessions and publishes success only after the durable head advances', async () => {
    const actorId = 'owner-inbox-global';
    let current = experienceView({ actorId });
    const receipt = terminalReviewReceipt(actorId);
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const perform = vi.fn(async () => {
      await blocked;
      current = experienceView({ actorId, head: HEAD_B, commandable: false });
      return {
        ok: true as const,
        operation: 'operate.review.submit' as const,
        data: structuredClone(receipt),
        allowedActions: [],
      };
    });
    const client = fakeClient(() => current);
    const getOperatingReviewRead = async () =>
      inboxReviewWorkspace(
        current,
        actorId,
        (current.eventHead as RecordValue).hash === HEAD_B.hash ? receipt : undefined,
      ) as never;
    const firstGateway = createOperateCommandGateway({
      client,
      runtime: { perform },
      getOperatingReviewRead,
    });
    const secondGateway = createOperateCommandGateway({
      client,
      runtime: { perform },
      getOperatingReviewRead,
    });
    const [firstSession, secondSession] = await Promise.all([
      firstGateway.issueSession(sessionRequest(current, actorId)),
      secondGateway.issueSession(sessionRequest(current, actorId)),
    ]);
    const [firstPreview, secondPreview] = await Promise.all([
      firstGateway.preview({
        sessionId: firstSession.sessionId,
        capability: firstSession.sessionCapability,
        origin: ORIGIN,
        actionReference: firstSession.allowedActions[0].actionReference,
      }),
      secondGateway.preview({
        sessionId: secondSession.sessionId,
        capability: secondSession.sessionCapability,
        origin: ORIGIN,
        actionReference: secondSession.allowedActions[0].actionReference,
      }),
    ]);
    for (const [preview, view] of [
      [firstPreview, current],
      [secondPreview, current],
    ] as const) {
      expect(
        assertOperateExperiencePreviewV1(preview, {
          actorId,
          scopeId: String(view.scopeId),
          domainId: String(view.domainId),
          domainVersion: String(view.domainVersion),
          eventHead: view.eventHead as { sequence: number; hash: string },
          sourceViewHash: String(view.viewHash),
          subjectId: REVIEW_ID,
          actionDigest: actionLocator(actorId).actionDigest,
        }),
      ).toEqual(preview);
      expect(preview).toMatchObject({
        transition: {
          kind: 'review',
          targets: [expect.objectContaining({ id: DECISION_ID, disposition: 'approved' })],
          reversible: false,
          nextState: 'approved',
          threshold: null,
        },
      });
    }
    const left = firstGateway.confirm({
      sessionId: firstSession.sessionId,
      capability: firstSession.sessionCapability,
      origin: ORIGIN,
      previewId: String(firstPreview.previewId),
      previewHash: String(firstPreview.previewHash),
    });
    const right = secondGateway.confirm({
      sessionId: secondSession.sessionId,
      capability: secondSession.sessionCapability,
      origin: ORIGIN,
      previewId: String(secondPreview.previewId),
      previewHash: String(secondPreview.previewHash),
    });
    await vi.waitFor(() => expect(perform).toHaveBeenCalledOnce());
    release?.();
    const [first, second] = await Promise.all([left, right]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: true,
      operation: 'operate.review.submit',
      eventHead: HEAD_B,
      allowedActions: [],
      data: {
        receipt: { kind: 'operating-review-receipt', eventHead: HEAD_B },
        workspace: {
          kind: 'operate-review-display-workspace',
          payload: { status: 'terminal', sourceEventHead: HEAD_B },
        },
      },
    });
    expect(JSON.stringify(first)).not.toContain(PRIVATE_VALUE);
    expect(perform).toHaveBeenCalledOnce();
  });

  it('retains expiry tombstones and terminal uncertainty without blind retry or private echo', async () => {
    let now = Date.parse('2026-08-11T08:00:00.000Z');
    const expiryActor = 'owner-inbox-expiry';
    const expiringView = experienceView({ actorId: expiryActor });
    const sessions = createOperateSessionCapabilityIssuerV2({ now: () => now });
    const expiring = createOperateCommandGateway({
      client: fakeClient(() => expiringView),
      runtime: { perform: vi.fn() },
      sessions,
      now: () => now,
      getOperatingReviewRead: async () => inboxReviewWorkspace(expiringView, expiryActor) as never,
    });
    const session = await expiring.issueSession(sessionRequest(expiringView, expiryActor));
    const preview = await expiring.preview({
      sessionId: session.sessionId,
      capability: session.sessionCapability,
      origin: ORIGIN,
      actionReference: session.allowedActions[0].actionReference,
    });
    now += 2 * 60 * 1000;
    const expiredRequest = {
      sessionId: session.sessionId,
      capability: session.sessionCapability,
      origin: ORIGIN,
      previewId: String(preview.previewId),
      previewHash: String(preview.previewHash),
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(expiring.confirm(expiredRequest)).rejects.toMatchObject({
        code: 'OPERATE_PREVIEW_EXPIRED',
      });
    }

    const uncertainActor = 'owner-inbox-uncertain';
    const uncertainView = experienceView({ actorId: uncertainActor });
    const perform = vi.fn(async () => ({
      ok: true as const,
      operation: 'operate.review.submit' as const,
      data: { privateReceipt: PRIVATE_VALUE },
      allowedActions: [],
    }));
    const uncertain = createOperateCommandGateway({
      client: fakeClient(() => uncertainView),
      runtime: { perform },
      getOperatingReviewRead: async () =>
        inboxReviewWorkspace(uncertainView, uncertainActor) as never,
    });
    const uncertainSession = await uncertain.issueSession(
      sessionRequest(uncertainView, uncertainActor),
    );
    const uncertainPreview = await uncertain.preview({
      sessionId: uncertainSession.sessionId,
      capability: uncertainSession.sessionCapability,
      origin: ORIGIN,
      actionReference: uncertainSession.allowedActions[0].actionReference,
    });
    const confirm = () =>
      uncertain.confirm({
        sessionId: uncertainSession.sessionId,
        capability: uncertainSession.sessionCapability,
        origin: ORIGIN,
        previewId: String(uncertainPreview.previewId),
        previewHash: String(uncertainPreview.previewHash),
      });
    const first = await confirm();
    const second = await confirm();
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: false,
      error: { code: 'OPERATION_UNCERTAIN', retryable: false, context: {} },
    });
    expect(JSON.stringify(first)).not.toContain(PRIVATE_VALUE);
    expect(perform).toHaveBeenCalledOnce();
  });

  it('invalidates route, head, and process-local session custody before dispatch', async () => {
    const actorId = 'owner-inbox-invalidation';
    let current = experienceView({ actorId });
    const perform = vi.fn();
    const client = fakeClient(() => current);
    const getOperatingReviewRead = async () => inboxReviewWorkspace(current, actorId) as never;
    const gateway = createOperateCommandGateway({
      client,
      runtime: { perform },
      getOperatingReviewRead,
    });
    const session = await gateway.issueSession(sessionRequest(current, actorId));
    current = experienceView({ actorId, head: HEAD_B });
    await expect(
      gateway.preview({
        sessionId: session.sessionId,
        capability: session.sessionCapability,
        origin: ORIGIN,
        actionReference: session.allowedActions[0].actionReference,
      }),
    ).rejects.toMatchObject({ code: 'OPERATE_PREVIEW_STALE' });
    expect(perform).not.toHaveBeenCalled();

    const restarted = createOperateCommandGateway({
      client,
      runtime: { perform },
      getOperatingReviewRead,
    });
    expect(() =>
      restarted.assertSessionBinding({
        sessionId: session.sessionId,
        capability: session.sessionCapability,
        origin: ORIGIN,
      }),
    ).toThrow(expect.objectContaining({ code: 'OPERATE_SESSION_DENIED' }));
    await expect(
      restarted.preview({
        sessionId: session.sessionId,
        capability: session.sessionCapability,
        origin: ORIGIN,
        actionReference: session.allowedActions[0].actionReference,
      }),
    ).rejects.toMatchObject({ code: 'OPERATE_ACTION_REFERENCE_INVALID' });
    expect(perform).not.toHaveBeenCalled();
  });

  it('keeps Inbox browser actions thin, locator-only, and aborts private custody on every binding change', async () => {
    const view = experienceView({ actorId: 'owner-inbox-adapter' });
    const identity = dashboardIdentity(view, HASH_D, 11);
    const preview = previewFixture(view, {
      authority: 'allowed',
      reasonCodes: [],
      issuedAt: '2026-08-11T08:00:00.000Z',
      expiresAt: '2026-08-11T08:02:00.000Z',
    });
    const calls: Array<{ url: string; body: RecordValue; signal: AbortSignal | null }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const pathname = new URL(url, ORIGIN).pathname;
      const body = JSON.parse(String(init?.body ?? '{}')) as RecordValue;
      calls.push({ url, body, signal: init?.signal ?? null });
      if (pathname === '/api/operate/session') {
        return new Response(
          JSON.stringify({
            kind: 'operate-command-session',
            schemaVersion: '1.0.0',
            protocolVersion: '2.0.0',
            sessionId: 'opsess_inbox_1234567890abcdef',
            sessionCapability: 'A'.repeat(43),
            issuedAt: '2026-08-11T08:00:00.000Z',
            expiresAt: '2026-08-11T08:10:00.000Z',
            binding: {
              actorId: identity.actorId,
              scopeId: identity.scopeId,
              domainId: identity.domainId,
              domainVersion: identity.domainVersion,
              cycleId: identity.cycleId,
              eventHead: identity.eventHead,
              sourceViewHash: identity.viewHash,
              actionLocator: actionLocator(identity.actorId),
            },
            allowedActions: [
              {
                actionReference: 'opact_inbox_1234567890abcdef',
                subjectId: REVIEW_ID,
                actionDigest: actionLocator(identity.actorId).actionDigest,
              },
            ],
            readOnly: false,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (pathname === '/api/operate/commands/preview') {
        return new Response(JSON.stringify(preview), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (pathname === '/api/operate/commands/confirm') {
        return new Response(
          JSON.stringify({
            ok: true,
            operation: 'operate.review.submit',
            data: {
              kind: 'operate-experience-view',
              schemaVersion: '1.0.0',
              protocolVersion: '2.0.0',
              actorId: identity.actorId,
              scopeId: identity.scopeId,
              domainId: identity.domainId,
              domainVersion: identity.domainVersion,
              eventHead: HEAD_B,
              privateReceipt: PRIVATE_VALUE,
            },
            allowedActions: [],
            eventHead: HEAD_B,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected route: ${url}`);
    });
    const actions = createInboxActions({ origin: ORIGIN, fetcher });
    actions.bind(identity);
    const pending = await actions.preview(actionLocator(identity.actorId));
    expect(
      assertOperateExperiencePreviewV1(pending.preview, {
        actorId: identity.actorId,
        scopeId: identity.scopeId,
        domainId: identity.domainId,
        domainVersion: identity.domainVersion,
        eventHead: identity.eventHead as { sequence: number; hash: string },
        sourceViewHash: String(identity.viewHash),
        subjectId: REVIEW_ID,
        actionDigest: actionLocator(identity.actorId).actionDigest,
      }),
    ).toEqual(pending.preview);
    expect(calls.map(({ url }) => new URL(url, ORIGIN).pathname)).toEqual([
      '/api/operate/session',
      '/api/operate/commands/preview',
    ]);
    expect(calls[0].body).toEqual({
      cycleId: CYCLE_ID,
      eventHead: HEAD_A,
      sourceViewHash: view.viewHash,
      actionLocator: actionLocator(identity.actorId),
    });
    expect(calls[1].body).toEqual({
      sessionId: 'opsess_inbox_1234567890abcdef',
      actionReference: 'opact_inbox_1234567890abcdef',
    });
    expect(JSON.stringify(calls)).not.toContain('workDispositions');
    expect(JSON.stringify(calls)).not.toContain(PRIVATE_VALUE);

    const confirmed = await pending.confirm();
    expect(confirmed).toEqual({ ok: true, eventHead: HEAD_B });
    expect(calls[2].body).toEqual({
      sessionId: 'opsess_inbox_1234567890abcdef',
      previewId: preview.previewId,
      previewHash: preview.previewHash,
    });
    expect(JSON.stringify(confirmed)).not.toContain(PRIVATE_VALUE);

    const mutations: Array<[string, DashboardQueryIdentity]> = [
      ['actor', createDashboardQueryIdentity({ ...identity, actorId: 'owner-inbox-foreign' })],
      ['project', createDashboardQueryIdentity({ ...identity, projectId: HASH_C })],
      ['scope', createDashboardQueryIdentity({ ...identity, scopeId: 'scope-foreign' })],
      ['domain', createDashboardQueryIdentity({ ...identity, domainId: 'software' })],
      ['version', createDashboardQueryIdentity({ ...identity, domainVersion: '2.0.0' })],
      ['cycle', createDashboardQueryIdentity({ ...identity, cycleId: 'cyc_foreign_12345678' })],
      [
        'route',
        dashboardIdentity(
          view,
          HASH_D,
          11,
          `#/operate/inbox/${encodeURIComponent(DECISION_ID)}`,
          DECISION_ID,
        ),
      ],
      ['head', createDashboardQueryIdentity({ ...identity, eventHead: HEAD_B, viewHash: HASH_B })],
      ['view', createDashboardQueryIdentity({ ...identity, viewHash: HASH_C })],
      ['generation', createDashboardQueryIdentity({ ...identity, generation: 12 })],
    ];
    for (const [label, changed] of mutations) {
      let observedSignal: AbortSignal | null = null;
      const blockedFetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        observedSignal = init?.signal ?? null;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Cancelled', 'AbortError')),
          );
        });
      });
      const isolated = createInboxActions({ origin: ORIGIN, fetcher: blockedFetcher });
      isolated.bind(identity);
      const inFlight = isolated.preview(actionLocator(identity.actorId));
      await vi.waitFor(() => expect(observedSignal).not.toBeNull());
      isolated.bind(changed);
      expect(observedSignal?.aborted, label).toBe(true);
      await expect(inFlight, label).rejects.toMatchObject({ name: 'AbortError' });
      isolated.dispose();
    }

    await expect(
      actions.preview({ ...actionLocator(identity.actorId), target: PRIVATE_VALUE } as never),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(3);
    actions.cancel();
    actions.dispose();
  });

  it('refuses a non-Inbox route before opening any private command custody', () => {
    const view = experienceView({ actorId: 'owner-inbox-route' });
    const identity = dashboardIdentity(view, HASH_D, 13);
    const today = createDashboardQueryIdentity({
      ...identity,
      route: '#/operate/today',
      subjectId: null,
    });
    const fetcher = vi.fn<typeof fetch>();
    const actions = createInboxActions({ origin: ORIGIN, fetcher });
    expect(() => actions.bind(today)).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    actions.dispose();
  });

  it('returns one safe terminal reason for an uncertain confirmation without retry or echo', async () => {
    const view = experienceView({ actorId: 'owner-inbox-safe-refusal' });
    const identity = dashboardIdentity(view, HASH_D, 14);
    const preview = previewFixture(view, {
      authority: 'allowed',
      reasonCodes: [],
      issuedAt: '2026-08-11T08:00:00.000Z',
      expiresAt: '2026-08-11T08:02:00.000Z',
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input), ORIGIN).pathname;
      if (pathname === '/api/operate/session') {
        return new Response(
          JSON.stringify({
            kind: 'operate-command-session',
            schemaVersion: '1.0.0',
            protocolVersion: '2.0.0',
            sessionId: 'opsess_safe_1234567890abcdef',
            sessionCapability: 'B'.repeat(43),
            issuedAt: '2026-08-11T08:00:00.000Z',
            expiresAt: '2026-08-11T08:10:00.000Z',
            binding: {
              actorId: identity.actorId,
              scopeId: identity.scopeId,
              domainId: identity.domainId,
              domainVersion: identity.domainVersion,
              cycleId: identity.cycleId,
              eventHead: identity.eventHead,
              sourceViewHash: identity.viewHash,
              actionLocator: actionLocator(identity.actorId),
            },
            allowedActions: [
              {
                actionReference: 'opact_safe_1234567890abcdef',
                subjectId: REVIEW_ID,
                actionDigest: actionLocator(identity.actorId).actionDigest,
              },
            ],
            readOnly: false,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (pathname === '/api/operate/commands/preview') {
        return new Response(JSON.stringify(preview), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (pathname === '/api/operate/commands/confirm') {
        return new Response(
          JSON.stringify({
            ok: false,
            operation: 'operate.review.submit',
            error: {
              code: 'OPERATION_UNCERTAIN',
              message: PRIVATE_VALUE,
              retryable: false,
              context: {},
            },
            allowedActions: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected route: ${pathname}`);
    });
    const actions = createInboxActions({ origin: ORIGIN, fetcher });
    actions.bind(identity);
    const pending = await actions.preview(actionLocator(identity.actorId));
    const first = await (pending.confirm as () => Promise<unknown>)();
    const second = await (pending.confirm as () => Promise<unknown>)();
    expect(first).toEqual({ ok: false, reasonCode: 'OPERATION_UNCERTAIN' });
    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toContain(PRIVATE_VALUE);
    expect(
      fetcher.mock.calls.filter(([input]) =>
        new URL(String(input), ORIGIN).pathname.endsWith('/commands/confirm'),
      ),
    ).toHaveLength(1);
    actions.dispose();
  });

  it('refuses malformed HTTP-200 confirmation failures without retry or private echo', async () => {
    const view = experienceView({ actorId: 'owner-inbox-malformed-refusal' });
    const identity = dashboardIdentity(view, HASH_D, 15);
    const preview = previewFixture(view, {
      authority: 'allowed',
      reasonCodes: [],
      issuedAt: '2026-08-11T08:00:00.000Z',
      expiresAt: '2026-08-11T08:02:00.000Z',
    });
    const cases: ReadonlyArray<
      Readonly<{
        label: string;
        mutate(value: RecordValue): void;
      }>
    > = [
      {
        label: 'wrong code',
        mutate(value) {
          (value.error as RecordValue).code = 'OPERATION_CONFLICT';
        },
      },
      {
        label: 'wrong operation',
        mutate(value) {
          value.operation = 'operate.action.approve';
        },
      },
      {
        label: 'retryable uncertainty',
        mutate(value) {
          (value.error as RecordValue).retryable = true;
        },
      },
      {
        label: 'non-empty context',
        mutate(value) {
          (value.error as RecordValue).context = { operation: 'operate.review.submit' };
        },
      },
      {
        label: 'non-empty allowed actions',
        mutate(value) {
          value.allowedActions = [{ privateActionReference: PRIVATE_VALUE }];
        },
      },
      {
        label: 'missing error field',
        mutate(value) {
          delete (value.error as RecordValue).message;
        },
      },
      {
        label: 'extra envelope field',
        mutate(value) {
          value.privateDetail = PRIVATE_VALUE;
        },
      },
      {
        label: 'extra error field',
        mutate(value) {
          (value.error as RecordValue).privateDetail = PRIVATE_VALUE;
        },
      },
    ];

    for (const hostileCase of cases) {
      const failure: RecordValue = {
        ok: false,
        operation: 'operate.review.submit',
        error: {
          code: 'OPERATION_UNCERTAIN',
          message: PRIVATE_VALUE,
          retryable: false,
          context: {},
        },
        allowedActions: [],
      };
      hostileCase.mutate(failure);
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        const pathname = new URL(String(input), ORIGIN).pathname;
        if (pathname === '/api/operate/session') {
          return new Response(
            JSON.stringify({
              kind: 'operate-command-session',
              schemaVersion: '1.0.0',
              protocolVersion: '2.0.0',
              sessionId: 'opsess_malformed_1234567890abcdef',
              sessionCapability: 'C'.repeat(43),
              issuedAt: '2026-08-11T08:00:00.000Z',
              expiresAt: '2026-08-11T08:10:00.000Z',
              binding: {
                actorId: identity.actorId,
                scopeId: identity.scopeId,
                domainId: identity.domainId,
                domainVersion: identity.domainVersion,
                cycleId: identity.cycleId,
                eventHead: identity.eventHead,
                sourceViewHash: identity.viewHash,
                actionLocator: actionLocator(identity.actorId),
              },
              allowedActions: [
                {
                  actionReference: 'opact_malformed_1234567890abcdef',
                  subjectId: REVIEW_ID,
                  actionDigest: actionLocator(identity.actorId).actionDigest,
                },
              ],
              readOnly: false,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (pathname === '/api/operate/commands/preview') {
          return new Response(JSON.stringify(preview), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (pathname === '/api/operate/commands/confirm') {
          return new Response(JSON.stringify(failure), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`Unexpected route: ${pathname}`);
      });
      const actions = createInboxActions({ origin: ORIGIN, fetcher });
      actions.bind(identity);
      const pending = await actions.preview(actionLocator(identity.actorId));

      const first = await pending.confirm();
      const second = await pending.confirm();
      expect(first, hostileCase.label).toEqual({
        ok: false,
        reasonCode: 'OPERATION_UNCERTAIN',
      });
      expect(second, hostileCase.label).toBe(first);
      expect(JSON.stringify(first), hostileCase.label).not.toContain(PRIVATE_VALUE);
      expect(
        fetcher.mock.calls.filter(([input]) =>
          new URL(String(input), ORIGIN).pathname.endsWith('/commands/confirm'),
        ),
        hostileCase.label,
      ).toHaveLength(1);
      actions.dispose();
    }
  });

  it('classifies transport uncertainty without blind retry and preserves controller cancellation', async () => {
    const view = experienceView({ actorId: 'owner-inbox-transport-proof' });
    const identity = dashboardIdentity(view, HASH_D, 16);
    const preview = previewFixture(view, {
      authority: 'allowed',
      reasonCodes: [],
      issuedAt: '2026-08-11T08:00:00.000Z',
      expiresAt: '2026-08-11T08:02:00.000Z',
    });
    const cases: ReadonlyArray<
      Readonly<{
        label: string;
        confirm(init?: RequestInit): Response | Promise<Response>;
      }>
    > = [
      {
        label: 'fetch rejection after send',
        async confirm() {
          throw new TypeError(PRIVATE_VALUE);
        },
      },
      {
        label: 'invalid response body',
        confirm() {
          return new Response('not-json', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
      {
        label: 'truncated response body',
        confirm() {
          return new Response('{"ok":', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
      {
        label: 'transport AbortError without controller cancellation',
        async confirm(init) {
          expect(init?.signal?.aborted).toBe(false);
          throw new DOMException(PRIVATE_VALUE, 'AbortError');
        },
      },
    ];

    for (const hostileCase of cases) {
      const fetcher = adapterFetcher(identity, preview, hostileCase.confirm);
      const actions = createInboxActions({ origin: ORIGIN, fetcher });
      actions.bind(identity);
      const pending = await actions.preview(actionLocator(identity.actorId));
      const first = pending.confirm();
      const second = pending.confirm();
      expect(second, hostileCase.label).toBe(first);
      const result = await first;
      expect(result, hostileCase.label).toEqual({
        ok: false,
        reasonCode: 'OPERATION_UNCERTAIN',
      });
      expect(await second, hostileCase.label).toBe(result);
      expect(JSON.stringify(result), hostileCase.label).not.toContain(PRIVATE_VALUE);
      expect(confirmCallCount(fetcher), hostileCase.label).toBe(1);
      actions.dispose();
    }

    const explicitFetcher = adapterFetcher(
      identity,
      preview,
      () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              reasonCode: 'OPERATE_PREVIEW_EXPIRED',
              message: PRIVATE_VALUE,
              retryable: false,
            },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
    );
    const explicit = createInboxActions({ origin: ORIGIN, fetcher: explicitFetcher });
    explicit.bind(identity);
    const explicitPending = await explicit.preview(actionLocator(identity.actorId));
    const firstExplicit = explicitPending.confirm();
    const secondExplicit = explicitPending.confirm();
    expect(secondExplicit).toBe(firstExplicit);
    await expect(firstExplicit).rejects.toMatchObject({
      name: 'OPERATE_PREVIEW_EXPIRED',
      code: 'OPERATE_PREVIEW_EXPIRED',
    });
    await expect(secondExplicit).rejects.not.toThrow(PRIVATE_VALUE);
    expect(confirmCallCount(explicitFetcher)).toBe(1);
    explicit.dispose();

    let controllerSignal: AbortSignal | null = null;
    const controllerFetcher = adapterFetcher(identity, preview, (init) => {
      controllerSignal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Cancelled', 'AbortError')),
        );
      });
    });
    const controller = createInboxActions({ origin: ORIGIN, fetcher: controllerFetcher });
    controller.bind(identity);
    const controllerPending = await controller.preview(actionLocator(identity.actorId));
    const firstCancellation = controllerPending.confirm();
    const secondCancellation = controllerPending.confirm();
    expect(secondCancellation).toBe(firstCancellation);
    const firstCancellationAssertion = expect(firstCancellation).rejects.toMatchObject({
      name: 'AbortError',
    });
    const secondCancellationAssertion = expect(secondCancellation).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.waitFor(() => expect(controllerSignal).not.toBeNull());
    controller.cancel();
    expect(controllerSignal?.aborted).toBe(true);
    await firstCancellationAssertion;
    await secondCancellationAssertion;
    expect(confirmCallCount(controllerFetcher)).toBe(1);
    controller.dispose();
  });

  it('publishes success only from one exact advanced public confirmation proof', async () => {
    const view = experienceView({ actorId: 'owner-inbox-hostile-success' });
    const identity = dashboardIdentity(view, HASH_D, 17);
    const preview = previewFixture(view, {
      authority: 'allowed',
      reasonCodes: [],
      issuedAt: '2026-08-11T08:00:00.000Z',
      expiresAt: '2026-08-11T08:02:00.000Z',
    });
    const cases: ReadonlyArray<
      Readonly<{
        label: string;
        mutate(value: RecordValue): void;
      }>
    > = [
      {
        label: 'wrong operation',
        mutate(value) {
          value.operation = 'operate.action.approve';
        },
      },
      {
        label: 'non-empty allowed actions',
        mutate(value) {
          value.allowedActions = [{ privateActionReference: PRIVATE_VALUE }];
        },
      },
      {
        label: 'missing public data',
        mutate(value) {
          delete value.data;
        },
      },
      {
        label: 'extra top-level field',
        mutate(value) {
          value.privateDetail = PRIVATE_VALUE;
        },
      },
      {
        label: 'non-advanced outer head',
        mutate(value) {
          value.eventHead = HEAD_A;
        },
      },
      {
        label: 'wrong public data kind',
        mutate(value) {
          (value.data as RecordValue).kind = 'operate-private-view';
        },
      },
      {
        label: 'wrong public data schema',
        mutate(value) {
          (value.data as RecordValue).schemaVersion = '9.0.0';
        },
      },
      {
        label: 'wrong public data protocol',
        mutate(value) {
          (value.data as RecordValue).protocolVersion = '9.0.0';
        },
      },
      {
        label: 'wrong public data actor',
        mutate(value) {
          (value.data as RecordValue).actorId = PRIVATE_VALUE;
        },
      },
      {
        label: 'wrong public data scope',
        mutate(value) {
          (value.data as RecordValue).scopeId = 'scope-foreign';
        },
      },
      {
        label: 'wrong public data domain',
        mutate(value) {
          (value.data as RecordValue).domainId = 'software';
        },
      },
      {
        label: 'wrong public data domain version',
        mutate(value) {
          (value.data as RecordValue).domainVersion = '2.0.0';
        },
      },
      {
        label: 'public data head mismatch',
        mutate(value) {
          (value.data as RecordValue).eventHead = HEAD_A;
        },
      },
    ];

    for (const hostileCase of cases) {
      const result: RecordValue = {
        ok: true,
        operation: 'operate.review.submit',
        data: publicConfirmationView(identity),
        allowedActions: [],
        eventHead: HEAD_B,
      };
      hostileCase.mutate(result);
      const fetcher = adapterFetcher(
        identity,
        preview,
        () =>
          new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      );
      const actions = createInboxActions({ origin: ORIGIN, fetcher });
      actions.bind(identity);
      const pending = await actions.preview(actionLocator(identity.actorId));
      const first = await pending.confirm();
      const second = await pending.confirm();
      expect(first, hostileCase.label).toEqual({
        ok: false,
        reasonCode: 'OPERATION_UNCERTAIN',
      });
      expect(second, hostileCase.label).toBe(first);
      expect(JSON.stringify(first), hostileCase.label).not.toContain(PRIVATE_VALUE);
      expect(confirmCallCount(fetcher), hostileCase.label).toBe(1);
      actions.dispose();
    }
  });
});
