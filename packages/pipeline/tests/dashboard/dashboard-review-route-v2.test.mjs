import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  buildOperateExperienceTransportView,
  selectOperateReviewDisplayWorkspace,
} from '../../lib/dashboard/operate-experience-reader.mjs';
import { createDashboardServer, parseOperateApiRoute } from '../../lib/dashboard/server.mjs';
import {
  buildOperatingReviewBoundSubmissionV1,
  createEmptyOperatingRuntimeStateV2,
  readOperatingReviewV2,
  submitBoundOperatingReviewV2,
} from '../../lib/operate/runtime-foundation.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import { rehashExperienceView } from './experience-view-test-support.mjs';

const STATIC_ROOT = resolve('tests/dashboard/fixtures/unified-root');
const PLANR_DIR = resolve('conformance/fixtures/dashboard-graph/.planr');
const TIME = '2026-08-23T08:00:00.000Z';
const COMMIT_TIME = '2026-08-23T08:01:00.000Z';
const ACTOR = Object.freeze({ actorId: 'owner-bound-001', kind: 'human', runtime: 'portable' });
const SCOPE = Object.freeze({
  scopeId: 'scope-bound',
  domainId: 'business',
  domainVersion: '1.0.0',
});
const CYCLE_ID = 'cyc_bound_00000001';
const REVIEW_ID = 'rev_bound_00000001';
const CAPABILITY = 'A'.repeat(43);
const QUERY = 'scopeId=scope-bound&domainId=business&domainVersion=1.0.0';
const HASH = `sha256:${'a'.repeat(64)}`;
const LATER_HASH = `sha256:${'b'.repeat(64)}`;
const fixtureView = JSON.parse(
  readFileSync(
    new URL(
      '../../conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json',
      import.meta.url,
    ),
    'utf8',
  ),
)['operate-experience-view'];

function runtimeState() {
  return {
    ...createEmptyOperatingRuntimeStateV2(TIME),
    cycles: [
      {
        kind: 'operating-cycle',
        schemaVersion: '1.0.0',
        protocolVersion: '2.0.0',
        cycleId: CYCLE_ID,
        scopeId: SCOPE.scopeId,
        domainId: SCOPE.domainId,
        domainVersion: SCOPE.domainVersion,
        state: 'awaiting_review',
        inputBindingId: 'inb_bound_00000001',
        contractVersions: { 'advisor-result': '1.0.0' },
        trigger: { kind: 'manual' },
        focus: ['strategy'],
        health: 'normal',
        activeReviewId: REVIEW_ID,
        createdAt: TIME,
        updatedAt: TIME,
      },
    ],
    reviews: [
      {
        kind: 'operating-review',
        schemaVersion: '1.0.0',
        protocolVersion: '2.0.0',
        reviewId: REVIEW_ID,
        cycleId: CYCLE_ID,
        ownerActorId: ACTOR.actorId,
        state: 'pending',
        disposition: null,
        workDispositions: [],
        createdAt: TIME,
        updatedAt: TIME,
      },
    ],
  };
}

function readReview(state) {
  return readOperatingReviewV2(
    {
      reviewId: REVIEW_ID,
      cycleId: CYCLE_ID,
      actor: ACTOR,
      scope: SCOPE,
    },
    { initialState: state, capabilities: ['operate.review.get'], readAt: COMMIT_TIME },
  ).data;
}

function stages() {
  return ['observe', 'understand', 'decide', 'govern', 'act', 'verify', 'learn'].map(
    (id, index) => ({
      id,
      state: index < 4 ? 'complete' : 'waiting',
      reason: null,
      inputArtifactIds: [],
      outputArtifactIds: [],
      gates: [],
      evidenceGapIds: [],
      uncertaintyIds: [],
      persistentActionIds: [],
    }),
  );
}

function reviewView(source) {
  const actor = source.kind === 'operating-review-read' ? source.reader : source.actor;
  const generatedAt = source.kind === 'operating-review-read' ? source.readAt : source.committedAt;
  const eventCount = source.eventHead.sequence;
  const allowedActions =
    source.kind === 'operating-review-read'
      ? source.dispositionChoices.map((choice) => ({
          subjectId: source.review.reviewId,
          action: {
            tool: 'operate.review.submit',
            arguments: structuredClone(choice.submitArguments),
            label: choice.label,
            effect: 'project-write',
          },
        }))
      : [];
  return rehashExperienceView({
    ...structuredClone(fixtureView),
    actorId: actor.actorId,
    scopeId: source.scope.scopeId,
    domainId: source.scope.domainId,
    domainVersion: source.scope.domainVersion,
    accessLevel: 'internal',
    generatedAt,
    eventHead: structuredClone(source.eventHead),
    status: 'ready',
    cycles: [
      {
        cycleId: source.cycleId,
        state: source.kind === 'operating-review-read' ? 'awaiting_review' : 'closed',
        health: 'normal',
        focus: ['Review the exact owner disposition'],
        createdAt: TIME,
        updatedAt: generatedAt,
        stages: stages(),
        assignments: [],
        lensAbsences: [],
        executiveBoard: null,
        dependencies: [],
        blockers: [],
        persistentActionIds: [],
        replayCheckpoint: null,
        deepLink: `#/operate/cycles/${source.cycleId}`,
      },
    ],
    attention: [],
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
        startSequence: eventCount === 0 ? null : 1,
        endSequence: eventCount === 0 ? null : eventCount,
        eventCount,
        eventReplayIndexHash: HASH,
      },
      finalHead: structuredClone(source.eventHead),
      liveAccessUsed: false,
      parityProof: {
        sourceStateHash: fixtureView.sourceStateHash,
        eventReplayIndexHash: HASH,
        checkpointVerified: false,
        finalEventHashMatches: true,
        stateParityVerified: false,
      },
      filterDimensions: [],
      redactions: [],
    },
    allowedActions,
    omissions: [],
    export: { formats: ['json', 'html'], accessSafe: true, redactionCount: 0 },
  });
}

function workspaceFor(source, view) {
  return selectOperateReviewDisplayWorkspace(view, source, {
    subjectId: source.review.reviewId,
    binding: {
      actorId: view.actorId,
      scopeId: view.scopeId,
      domainId: view.domainId,
      domainVersion: view.domainVersion,
      cycleId: source.cycleId,
      reviewId: source.review.reviewId,
      generatedAt: source.kind === 'operating-review-read' ? source.readAt : source.committedAt,
      sourceArtifactKind: source.kind,
      sourceArtifactHash: sha256Jcs(source),
      sourceEventHead: structuredClone(source.eventHead),
      sourceReadEventHead: structuredClone(
        source.kind === 'operating-review-read' ? source.eventHead : source.readEventHead,
      ),
      sourceViewHash: view.viewHash,
    },
  });
}

function laterExperienceView(view) {
  return rehashExperienceView({
    ...structuredClone(view),
    generatedAt: '2026-08-23T08:02:00.000Z',
    eventHead: { sequence: view.eventHead.sequence + 1, hash: LATER_HASH },
    cycles: view.cycles.map((cycle) => ({
      ...structuredClone(cycle),
      updatedAt: '2026-08-23T08:02:00.000Z',
    })),
    replay: {
      ...structuredClone(view.replay),
      tail: {
        ...structuredClone(view.replay.tail),
        endSequence: view.eventHead.sequence + 1,
        eventCount: view.eventHead.sequence + 1,
        eventReplayIndexHash: LATER_HASH,
      },
      finalHead: { sequence: view.eventHead.sequence + 1, hash: LATER_HASH },
      parityProof: {
        ...structuredClone(view.replay.parityProof),
        eventReplayIndexHash: LATER_HASH,
      },
    },
  });
}

function request(
  port,
  path,
  { method = 'GET', body, origin, actor = ACTOR.actorId, authorization } = {},
) {
  const content = body === undefined ? '' : JSON.stringify(body);
  return new Promise((resolveResponse, rejectResponse) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          ...(method === 'POST'
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(content),
              }
            : {}),
          ...(origin ? { Origin: origin } : {}),
          ...(actor ? { 'X-OpenPlanr-Actor': actor } : {}),
          ...(authorization ? { Authorization: authorization } : {}),
        },
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () =>
          resolveResponse({
            status: res.statusCode,
            body: responseBody,
            json: JSON.parse(responseBody),
          }),
        );
      },
    );
    req.on('error', rejectResponse);
    req.end(content);
  });
}

test('Review REST route is exact and rejects traversal, encoded separators, and surplus segments', () => {
  assert.deepEqual(parseOperateApiRoute(`/api/operate/cycles/${CYCLE_ID}/reviews/${REVIEW_ID}`), {
    surface: 'review',
    cycleId: CYCLE_ID,
    subjectId: REVIEW_ID,
  });
  for (const path of [
    `/api/operate/cycles/${CYCLE_ID}/reviews`,
    `/api/operate/cycles/${CYCLE_ID}/reviews/${REVIEW_ID}/foreign`,
    `/api/operate/cycles/../reviews/${REVIEW_ID}`,
    `/api/operate/cycles/%2e%2e/reviews/${REVIEW_ID}`,
    `/api/operate/cycles/${CYCLE_ID}/reviews/rev%2Fforeign`,
    `/api/operate/cycles/${CYCLE_ID}/reviews/rev%5Cforeign`,
  ])
    assert.equal(parseOperateApiRoute(path), null, path);
});

test('Review route is owner-bound and confirmation preserves the exact immutable receipt and refreshed workspace', async () => {
  const state = runtimeState();
  const pending = readReview(state);
  const pendingView = reviewView(pending);
  const pendingTransportView = buildOperateExperienceTransportView(pendingView);
  assert.equal(pendingTransportView.viewHash, pendingView.viewHash);
  const pendingWorkspace = workspaceFor(pending, pendingView);
  assert.equal(
    pendingWorkspace.kind,
    'operate-review-display-workspace',
    JSON.stringify(pendingWorkspace),
  );
  const [choice] = pending.dispositionChoices.filter(
    ({ submitArguments }) => submitArguments.disposition === 'approved',
  );
  const bound = buildOperatingReviewBoundSubmissionV1({
    expectedReadEventHead: pending.eventHead,
    choice,
    note: 'Approve the exact evidence-bound recommendation.',
  });
  const committed = submitBoundOperatingReviewV2(
    bound,
    {
      eventId: 'evt_bound_review_route_0001',
      timestamp: COMMIT_TIME,
      correlationId: 'corr_bound_review_route_0001',
    },
    {
      initialState: state,
      capabilities: [{ id: 'operate-review-submit', version: '2.0.0' }],
    },
  );
  const receipt = committed.response.data;
  const terminalView = reviewView(receipt);
  const terminalWorkspace = workspaceFor(receipt, terminalView);
  const laterView = laterExperienceView(terminalView);
  const allowedAction = pendingView.allowedActions.find(
    ({ subjectId }) => subjectId === REVIEW_ID,
  ).action;
  const actionDigest = sha256Jcs(allowedAction);
  const actionReference = 'opact_bound_review_0001';
  const sessionBinding = {
    actorId: ACTOR.actorId,
    scopeId: SCOPE.scopeId,
    domainId: SCOPE.domainId,
    domainVersion: SCOPE.domainVersion,
    cycleId: CYCLE_ID,
    eventHead: structuredClone(pending.eventHead),
    sourceViewHash: pendingView.viewHash,
    actionLocator: { subjectId: REVIEW_ID, actionDigest },
  };
  const previewBase = {
    kind: 'operate-experience-preview',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    previewId: 'xprv_bound_review_0001',
    scopeId: SCOPE.scopeId,
    domainId: SCOPE.domainId,
    domainVersion: SCOPE.domainVersion,
    actorId: ACTOR.actorId,
    subject: { kind: 'review', id: REVIEW_ID, revision: null, hash: HASH },
    eventHead: structuredClone(pending.eventHead),
    sourceViewHash: pendingView.viewHash,
    actionDigest,
    allowedAction: structuredClone(allowedAction),
    authority: 'allowed',
    consequence: 'Commit the exact owner Review disposition without executing Actions.',
    reasonCodes: [],
    transition: {
      kind: 'review',
      targets: [
        {
          kind: 'operating-review',
          id: REVIEW_ID,
          revision: null,
          hash: HASH,
          disposition: 'approved',
        },
      ],
      reversible: false,
      nextState: 'approved',
      threshold: null,
    },
    issuedAt: TIME,
    expiresAt: '2026-08-23T08:02:00.000Z',
  };
  const preview = { ...previewBase, previewHash: sha256Jcs(previewBase) };
  let currentView = pendingView;
  let currentWorkspace = pendingWorkspace;
  let conflict = true;
  let unsafeReceipt = false;
  const readCalls = [];
  const gateway = {
    async issueSession() {
      return {
        kind: 'operate-command-session',
        schemaVersion: '1.0.0',
        protocolVersion: '2.0.0',
        sessionId: 'opsess_bound_review_0001',
        sessionCapability: CAPABILITY,
        issuedAt: TIME,
        expiresAt: '2026-08-23T08:05:00.000Z',
        binding: structuredClone(sessionBinding),
        readOnly: false,
        allowedActions: [{ actionReference, subjectId: REVIEW_ID, actionDigest }],
      };
    },
    assertSessionBinding() {
      return structuredClone(sessionBinding);
    },
    async preview() {
      return structuredClone(preview);
    },
    assertPreviewBinding() {
      return { binding: structuredClone(sessionBinding), operation: 'operate.review.submit' };
    },
    async confirm() {
      if (conflict) {
        return {
          ok: false,
          operation: 'operate.review.submit',
          error: {
            code: 'CONCURRENT_MODIFICATION',
            message: 'private stale owner/content',
            retryable: false,
            context: {},
          },
          allowedActions: [],
        };
      }
      currentView = laterView;
      currentWorkspace = terminalWorkspace;
      const responseReceipt = structuredClone(receipt);
      if (unsafeReceipt) {
        responseReceipt.summary.message = 'Inspect /Users/owner/private/review-notes.md.';
      }
      return {
        ok: true,
        operation: 'operate.review.submit',
        data: { receipt: responseReceipt, workspace: structuredClone(terminalWorkspace) },
        allowedActions: [],
        eventHead: structuredClone(receipt.eventHead),
      };
    },
  };
  const home = mkdtempSync(join(tmpdir(), 'planr-review-route-'));
  const dashboard = createDashboardServer({
    staticRoot: STATIC_ROOT,
    planrDir: PLANR_DIR,
    watch: false,
    getOperatingExperience: () => ({
      available: true,
      readOnly: true,
      status: 'ready',
      view: currentView,
      reasonCodes: [],
    }),
    getOperatingReviewRead: async (input) => {
      readCalls.push(structuredClone(input));
      return structuredClone(currentWorkspace);
    },
    getOperatingCommandGateway: () => gateway,
  });
  try {
    const port = await dashboard.listen(0, { env: { ...process.env, PLANR_HOME: home } });
    const origin = `http://127.0.0.1:${port}`;
    const initialDashboardView = dashboard.getCurrentExperience().view;
    assert.deepEqual(
      {
        actorId: pendingWorkspace.payload.actorId,
        scopeId: pendingWorkspace.payload.scopeId,
        domainId: pendingWorkspace.payload.domainId,
        domainVersion: pendingWorkspace.payload.domainVersion,
        eventHead: pendingWorkspace.payload.sourceEventHead,
        viewHash: pendingWorkspace.payload.sourceViewHash,
      },
      {
        actorId: initialDashboardView.actorId,
        scopeId: initialDashboardView.scopeId,
        domainId: initialDashboardView.domainId,
        domainVersion: initialDashboardView.domainVersion,
        eventHead: initialDashboardView.eventHead,
        viewHash: initialDashboardView.viewHash,
      },
    );
    const route = await request(
      port,
      `/api/operate/cycles/${CYCLE_ID}/reviews/${REVIEW_ID}?${QUERY}`,
    );
    assert.equal(route.status, 200, route.body);
    assert.deepEqual(route.json, pendingWorkspace);
    assert.deepEqual(readCalls[0], {
      cycleId: CYCLE_ID,
      reviewId: REVIEW_ID,
      actorId: ACTOR.actorId,
      scopeId: SCOPE.scopeId,
      domainId: SCOPE.domainId,
      domainVersion: SCOPE.domainVersion,
    });

    currentWorkspace = {
      ...structuredClone(pendingWorkspace),
      privateOwnerContent: 'must-not-escape',
    };
    const hostile = await request(
      port,
      `/api/operate/cycles/${CYCLE_ID}/reviews/${REVIEW_ID}?${QUERY}`,
    );
    assert.equal(hostile.status, 409);
    assert.equal(hostile.body.includes('must-not-escape'), false);
    currentWorkspace = pendingWorkspace;

    const session = await request(port, `/api/operate/session?${QUERY}`, {
      method: 'POST',
      body: {
        cycleId: CYCLE_ID,
        eventHead: structuredClone(pending.eventHead),
        sourceViewHash: pendingView.viewHash,
        actionLocator: { subjectId: REVIEW_ID, actionDigest },
      },
      origin,
    });
    assert.equal(session.status, 200);
    const previewResponse = await request(port, `/api/operate/commands/preview?${QUERY}`, {
      method: 'POST',
      body: { sessionId: session.json.sessionId, actionReference },
      origin,
      authorization: `Bearer ${CAPABILITY}`,
    });
    assert.equal(previewResponse.status, 200);
    const confirmBody = {
      sessionId: session.json.sessionId,
      previewId: previewResponse.json.previewId,
      previewHash: previewResponse.json.previewHash,
      note: bound.note,
    };
    for (const note of ['', ' leading', 'trailing ', 'x'.repeat(2049), 7]) {
      const invalidNote = await request(port, `/api/operate/commands/confirm?${QUERY}`, {
        method: 'POST',
        body: { ...confirmBody, note },
        origin,
        authorization: `Bearer ${CAPABILITY}`,
      });
      assert.equal(invalidNote.status, 400);
      assert.equal(invalidNote.json.error.reasonCode, 'OPERATE_COMMAND_INVALID');
    }
    const stale = await request(port, `/api/operate/commands/confirm?${QUERY}`, {
      method: 'POST',
      body: confirmBody,
      origin,
      authorization: `Bearer ${CAPABILITY}`,
    });
    assert.equal(stale.status, 200);
    assert.equal(stale.json.ok, false);
    assert.equal(stale.json.error.code, 'CONCURRENT_MODIFICATION');
    assert.equal(stale.body.includes('private stale owner/content'), false);
    assert.deepEqual(stale.json.allowedActions, pendingWorkspace.payload.data.capability.actions);

    conflict = false;
    unsafeReceipt = true;
    const unsafeConfirmation = await request(port, `/api/operate/commands/confirm?${QUERY}`, {
      method: 'POST',
      body: confirmBody,
      origin,
      authorization: `Bearer ${CAPABILITY}`,
    });
    assert.equal(unsafeConfirmation.status, 409);
    assert.equal(unsafeConfirmation.json.error.reasonCode, 'OPERATION_UNCERTAIN');
    assert.equal(unsafeConfirmation.body.includes('/Users/owner/private/review-notes.md'), false);
    unsafeReceipt = false;
    const confirmed = await request(port, `/api/operate/commands/confirm?${QUERY}`, {
      method: 'POST',
      body: confirmBody,
      origin,
      authorization: `Bearer ${CAPABILITY}`,
    });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.json.ok, true);
    assert.deepEqual(confirmed.json.data.receipt, receipt);
    assert.deepEqual(confirmed.json.data.workspace, terminalWorkspace);
    assert.equal(
      confirmed.json.data.receipt.boundSubmission.boundSubmissionHash,
      bound.boundSubmissionHash,
    );
    assert.equal(confirmed.json.data.receipt.boundSubmission.note, bound.note);
    assert.deepEqual(confirmed.json.eventHead, receipt.eventHead);

    const terminalAfterLaterEvent = await request(
      port,
      `/api/operate/cycles/${CYCLE_ID}/reviews/${REVIEW_ID}?${QUERY}`,
    );
    assert.equal(terminalAfterLaterEvent.status, 200);
    assert.deepEqual(terminalAfterLaterEvent.json, terminalWorkspace);
    assert.ok(
      terminalAfterLaterEvent.json.payload.sourceEventHead.sequence <
        dashboard.getCurrentExperience().view.eventHead.sequence,
    );
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});
