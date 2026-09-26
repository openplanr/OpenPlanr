import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDashboardServer } from '../../lib/dashboard/server.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

const planrDir = join(process.cwd(), 'conformance/fixtures/dashboard-graph/.planr');
const capability = 'A'.repeat(43);
const cycleId = 'cyc_1234567890abcdef';
const subjectId = 'act_1234567890abcdef';
const actionReference = 'opact_1234567890abcdef';
const eventHead = Object.freeze({
  sequence: 7,
  hash: `sha256:${'a'.repeat(64)}`,
});
const advancedHead = Object.freeze({
  sequence: 8,
  hash: `sha256:${'b'.repeat(64)}`,
});
const sourceViewHash = `sha256:${'c'.repeat(64)}`;
const privateValue = 'private-grant-and-target-must-never-escape';
const bindingQuery = 'scopeId=scope-acme&domainId=business&domainVersion=1.0.0';
const operation = 'operate.action.execute';

const allowedAction = Object.freeze({
  tool: operation,
  arguments: Object.freeze({
    action: Object.freeze({
      actionId: subjectId,
      revision: 1,
      actionHash: `sha256:${'d'.repeat(64)}`,
    }),
  }),
  label: 'Execute the exact approved Action',
  effect: 'project-write',
});
const actionDigest = sha256Jcs(allowedAction);
const actionLocator = Object.freeze({ subjectId, actionDigest });

function previewFixture() {
  const base = {
    kind: 'operate-experience-preview',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    previewId: 'xprv_1234567890abcdef',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    actorId: 'owner-acme',
    subject: {
      kind: 'action',
      id: subjectId,
      revision: 1,
      hash: `sha256:${'d'.repeat(64)}`,
    },
    eventHead: structuredClone(eventHead),
    sourceViewHash,
    actionDigest,
    allowedAction: structuredClone(allowedAction),
    authority: 'allowed',
    consequence: 'Execute the exact approved Action.',
    reasonCodes: [],
    transition: {
      kind: 'execution',
      targets: [
        {
          kind: 'operating-action',
          id: subjectId,
          revision: 1,
          hash: `sha256:${'d'.repeat(64)}`,
          disposition: 'executing',
        },
      ],
      reversible: false,
      nextState: 'executing',
      threshold: null,
    },
    issuedAt: '2026-08-11T08:00:00Z',
    expiresAt: '2026-08-11T08:02:00Z',
  };
  return { ...base, previewHash: sha256Jcs(base) };
}

function commandExperienceView(head) {
  const base = {
    kind: 'operate-experience-view',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    viewId: 'xview_command_binding_1234567890abcdef',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    actorId: 'owner-acme',
    accessLevel: 'public',
    generatedAt: '2026-08-11T08:00:00Z',
    eventHead: structuredClone(head),
    sourceStateHash: `sha256:${'9'.repeat(64)}`,
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
        startSequence: head.sequence === 0 ? null : 1,
        endSequence: head.sequence === 0 ? null : head.sequence,
        eventCount: head.sequence,
        eventReplayIndexHash: head.hash,
      },
      finalHead: structuredClone(head),
      liveAccessUsed: false,
      parityProof: {
        sourceStateHash: `sha256:${'9'.repeat(64)}`,
        eventReplayIndexHash: head.hash,
        checkpointVerified: false,
        stateParityVerified: true,
        finalEventHashMatches: true,
      },
      filterDimensions: [],
      redactions: [],
    },
    allowedActions: [],
    omissions: [],
    export: { formats: ['json'], accessSafe: true, redactionCount: 0 },
  };
  return { ...base, viewHash: sha256Jcs(base) };
}

function mutateCommandExperienceView(view, mutate) {
  const { viewHash: _discarded, ...base } = structuredClone(view);
  const mutated = mutate(base);
  return { ...mutated, viewHash: sha256Jcs(mutated) };
}

function request(
  port,
  path,
  {
    method = 'POST',
    body,
    origin,
    actor = 'owner-acme',
    authorization,
    contentType = 'application/json',
    headers = {},
  } = {},
) {
  const content = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((resolveResponse, rejectResponse) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          ...(contentType ? { 'Content-Type': contentType } : {}),
          ...(method === 'POST' ? { 'Content-Length': Buffer.byteLength(content) } : {}),
          ...(origin ? { Origin: origin } : {}),
          ...(actor ? { 'X-OpenPlanr-Actor': actor } : {}),
          ...(authorization ? { Authorization: authorization } : {}),
          ...headers,
        },
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(responseBody);
          } catch {
            json = null;
          }
          resolveResponse({
            status: res.statusCode,
            headers: res.headers,
            body: responseBody,
            json,
          });
        });
      },
    );
    req.on('error', rejectResponse);
    req.end(content);
  });
}

function exactSessionBody(overrides = {}) {
  return {
    cycleId,
    eventHead: structuredClone(eventHead),
    sourceViewHash,
    actionLocator: structuredClone(actionLocator),
    ...overrides,
  };
}

function commandGateway({ onDurableHead = () => {} } = {}) {
  const calls = [];
  const sessionBinding = Object.freeze({
    actorId: 'owner-acme',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    cycleId,
    eventHead: structuredClone(eventHead),
    sourceViewHash,
    actionLocator: structuredClone(actionLocator),
  });
  const gateway = {
    async issueSession(input) {
      calls.push(['session', structuredClone(input)]);
      if (
        input.cycleId !== cycleId ||
        input.eventHead?.sequence !== eventHead.sequence ||
        input.eventHead?.hash !== eventHead.hash ||
        input.sourceViewHash !== sourceViewHash ||
        input.actionLocator?.subjectId !== subjectId ||
        input.actionLocator?.actionDigest !== actionDigest
      ) {
        throw Object.assign(new Error(privateValue), {
          code: 'OPERATE_ACTION_REFERENCE_STALE',
          status: 409,
        });
      }
      return {
        kind: 'operate-command-session',
        schemaVersion: '1.0.0',
        protocolVersion: '2.0.0',
        sessionId: 'opsess_1234567890abcdef',
        sessionCapability: capability,
        issuedAt: '2026-08-11T08:00:00.000Z',
        expiresAt: '2026-08-11T08:05:00.000Z',
        binding: structuredClone(sessionBinding),
        allowedActions: [
          {
            actionReference,
            subjectId,
            actionDigest,
          },
        ],
        readOnly: false,
      };
    },
    assertSessionBinding(input) {
      calls.push(['assert', structuredClone(input)]);
      if (input.capability !== capability) {
        throw Object.assign(new Error(privateValue), {
          code: 'OPERATE_SESSION_DENIED',
          status: 401,
        });
      }
      if (input.sessionId.includes('expired')) {
        throw Object.assign(new Error(privateValue), {
          code: 'OPERATE_SESSION_EXPIRED',
          status: 401,
        });
      }
      if (input.sessionId.includes('revoked')) {
        throw Object.assign(new Error(privateValue), {
          code: 'OPERATE_SESSION_REVOKED',
          status: 401,
        });
      }
      return structuredClone(sessionBinding);
    },
    async preview(input) {
      calls.push(['preview', structuredClone(input)]);
      if (input.actionReference !== actionReference) {
        throw Object.assign(new Error(privateValue), {
          code: 'OPERATE_ACTION_REFERENCE_INVALID',
          status: 404,
        });
      }
      return previewFixture();
    },
    assertPreviewBinding(input) {
      calls.push(['preview-binding', structuredClone(input)]);
      if (input.capability !== capability) {
        throw Object.assign(new Error(privateValue), {
          code: 'OPERATE_SESSION_DENIED',
          status: 401,
        });
      }
      return {
        binding: structuredClone(sessionBinding),
        operation,
      };
    },
    async confirm(input) {
      calls.push(['confirm', structuredClone(input)]);
      if (input.previewId.includes('expired')) {
        throw Object.assign(new Error(privateValue), {
          code: 'OPERATE_PREVIEW_EXPIRED',
          status: 409,
        });
      }
      if (input.previewId.includes('uncertain')) {
        return {
          ok: false,
          operation,
          error: {
            code: 'OPERATION_UNCERTAIN',
            message: 'Inspect recovery state; do not retry blindly.',
            retryable: false,
            context: {},
          },
          allowedActions: [],
        };
      }
      const proof = input.previewId.includes('advanced')
        ? structuredClone(advancedHead)
        : input.previewId.includes('absent')
          ? undefined
          : structuredClone(eventHead);
      if (proof?.sequence > eventHead.sequence) onDurableHead(proof);
      return {
        ok: true,
        operation,
        ...(proof ? { eventHead: proof } : {}),
        data: commandExperienceView(proof ?? eventHead),
        allowedActions: [],
      };
    },
  };
  return { gateway, calls, sessionBinding };
}

async function withServer(runTest) {
  const home = mkdtempSync(join(tmpdir(), 'planr-command-binding-'));
  let projectionHead = structuredClone(eventHead);
  const fixtureGateway = commandGateway({
    onDurableHead: (head) => {
      projectionHead = structuredClone(head);
    },
  });
  const dashboard = createDashboardServer({
    planrDir,
    watch: false,
    getOperatingCommandGateway: () => fixtureGateway.gateway,
    getOperatingExperience: () => ({
      available: true,
      readOnly: true,
      status: 'ready',
      view: commandExperienceView(projectionHead),
      reasonCodes: [],
    }),
  });
  try {
    const port = await dashboard.listen(0, {
      env: { ...process.env, PLANR_HOME: home },
    });
    await runTest({
      port,
      origin: `http://127.0.0.1:${port}`,
      ...fixtureGateway,
    });
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
}

async function issueSession(port, origin, overrides = {}) {
  return request(port, `/api/operate/session?${bindingQuery}`, {
    body: exactSessionBody(overrides),
    origin,
  });
}

test('session disclosure requires exact Cycle, head, source view, and owner action locator', async () => {
  await withServer(async ({ port, origin, calls, sessionBinding }) => {
    const response = await issueSession(port, origin);
    assert.equal(response.status, 200);
    assert.match(response.headers['cache-control'] ?? '', /no-store/u);
    assert.equal(response.json.sessionCapability, capability);
    assert.deepEqual(response.json.binding, sessionBinding);
    assert.deepEqual(response.json.allowedActions, [{ actionReference, subjectId, actionDigest }]);
    assert.deepEqual(calls[0], [
      'session',
      {
        ...exactSessionBody(),
        actor: {
          actorId: 'owner-acme',
          kind: 'human',
          runtime: 'openplanr',
        },
        origin,
      },
    ]);
    assert.equal(JSON.stringify(response.json).includes('actionHash'), false);
    assert.equal(JSON.stringify(response.json).includes(privateValue), false);
    assert.equal(JSON.stringify(response.json).includes('arguments'), false);

    for (const [label, overrides] of [
      ['cycle', { cycleId: 'cyc_foreign00000001' }],
      ['head-sequence', { eventHead: { ...eventHead, sequence: 8 } }],
      ['head-hash', { eventHead: { ...eventHead, hash: `sha256:${'f'.repeat(64)}` } }],
      ['source-view', { sourceViewHash: `sha256:${'f'.repeat(64)}` }],
      ['subject', { actionLocator: { ...actionLocator, subjectId: 'act_foreign0000001' } }],
      ['digest', { actionLocator: { ...actionLocator, actionDigest: `sha256:${'f'.repeat(64)}` } }],
    ]) {
      const refused = await issueSession(port, origin, overrides);
      assert.equal(refused.status, 409, label);
      assert.equal(refused.json.ok, false, label);
      assert.equal(refused.body.includes(privateValue), false, label);
      assert.equal(refused.body.includes(String(Object.values(overrides)[0])), false, label);
    }

    for (const foreignBody of [
      { ...exactSessionBody(), action: allowedAction },
      { ...exactSessionBody(), target: privateValue },
      { ...exactSessionBody(), partyId: privateValue },
      { ...exactSessionBody(), grants: [{ capability: privateValue }] },
    ]) {
      const before = calls.length;
      const refused = await request(port, `/api/operate/session?${bindingQuery}`, {
        body: foreignBody,
        origin,
      });
      assert.equal(refused.status, 400);
      assert.equal(refused.json.error.reasonCode, 'OPERATE_COMMAND_INVALID');
      assert.equal(calls.length, before);
      assert.equal(refused.body.includes(privateValue), false);
    }
  });
});

test('server checks exact actor/scope/domain/version and returned session locator before capability disclosure', async () => {
  await withServer(async ({ port, origin, calls, gateway }) => {
    for (const [path, actor] of [
      [`/api/operate/session?${bindingQuery}`, 'owner-foreign'],
      [
        '/api/operate/session?scopeId=scope-foreign&domainId=business&domainVersion=1.0.0',
        'owner-acme',
      ],
      [
        '/api/operate/session?scopeId=scope-acme&domainId=software&domainVersion=1.0.0',
        'owner-acme',
      ],
      [
        '/api/operate/session?scopeId=scope-acme&domainId=business&domainVersion=9.9.9',
        'owner-acme',
      ],
    ]) {
      const response = await request(port, path, {
        body: exactSessionBody(),
        origin,
        actor,
      });
      assert.equal(response.status, 403);
      assert.equal(response.json.error.reasonCode, 'OPERATE_BINDING_MISMATCH');
      assert.equal(response.body.includes(capability), false);
    }

    const original = gateway.issueSession;
    gateway.issueSession = async (input) => {
      const issued = await original.call(gateway, input);
      issued.allowedActions[0].actionDigest = `sha256:${'f'.repeat(64)}`;
      return issued;
    };
    const substituted = await issueSession(port, origin);
    assert.equal(substituted.status, 403);
    assert.equal(substituted.json.error.reasonCode, 'OPERATE_BINDING_MISMATCH');
    assert.equal(substituted.body.includes(capability), false);
    assert.equal(substituted.body.includes(privateValue), false);
    assert.ok(calls.length >= 5);
  });
});

test('preview route forwards only opaque custody and validates the owner preview before browser disclosure', async () => {
  await withServer(async ({ port, origin, calls, gateway }) => {
    const session = await issueSession(port, origin);
    assert.equal(session.status, 200);
    const response = await request(port, `/api/operate/commands/preview?${bindingQuery}`, {
      body: {
        sessionId: session.json.sessionId,
        actionReference,
      },
      origin,
      authorization: `Bearer ${capability}`,
    });
    assert.equal(response.status, 200);
    assert.equal(response.json.actionDigest, actionDigest);
    assert.equal(response.json.sourceViewHash, sourceViewHash);
    assert.deepEqual(calls.at(-1), [
      'preview',
      {
        sessionId: session.json.sessionId,
        actionReference,
        capability,
        origin,
      },
    ]);

    for (const field of [
      'action',
      'effect',
      'target',
      'revision',
      'partyId',
      'grants',
      'actionDigest',
    ]) {
      const before = calls.length;
      const refused = await request(port, `/api/operate/commands/preview?${bindingQuery}`, {
        body: {
          sessionId: session.json.sessionId,
          actionReference,
          [field]: field === 'revision' ? 99 : privateValue,
        },
        origin,
        authorization: `Bearer ${capability}`,
      });
      assert.equal(refused.status, 400, field);
      assert.equal(refused.body.includes(privateValue), false, field);
      assert.equal(calls.length, before, field);
    }

    const originalPreview = gateway.preview;
    gateway.preview = async (input) => {
      const preview = await originalPreview.call(gateway, input);
      preview.transition.targets[0].revision += 1;
      return preview;
    };
    const hostile = await request(port, `/api/operate/commands/preview?${bindingQuery}`, {
      body: { sessionId: session.json.sessionId, actionReference },
      origin,
      authorization: `Bearer ${capability}`,
    });
    assert.notEqual(hostile.status, 200);
    assert.equal(hostile.body.includes(subjectId), false);
    assert.equal(hostile.body.includes(privateValue), false);
  });
});

test('restart, expiry, revocation, wrong origin, capability, reference, and duplicate bodies fail closed without private echo', async () => {
  await withServer(async ({ port, origin, calls }) => {
    const session = await issueSession(port, origin);
    assert.equal(session.status, 200);
    const previewPath = `/api/operate/commands/preview?${bindingQuery}`;
    for (const [label, body, authorization, expectedCode] of [
      [
        'missing-capability',
        { sessionId: session.json.sessionId, actionReference },
        undefined,
        'OPERATE_SESSION_DENIED',
      ],
      [
        'wrong-capability',
        { sessionId: session.json.sessionId, actionReference },
        `Bearer ${'B'.repeat(43)}`,
        'OPERATE_SESSION_DENIED',
      ],
      [
        'expired-session',
        { sessionId: 'opsess_expired_12345678', actionReference },
        `Bearer ${capability}`,
        'OPERATE_SESSION_EXPIRED',
      ],
      [
        'revoked-session',
        { sessionId: 'opsess_revoked_12345678', actionReference },
        `Bearer ${capability}`,
        'OPERATE_SESSION_REVOKED',
      ],
      [
        'wrong-reference',
        { sessionId: session.json.sessionId, actionReference: 'opact_foreign0000001' },
        `Bearer ${capability}`,
        'OPERATE_ACTION_REFERENCE_INVALID',
      ],
    ]) {
      const response = await request(port, previewPath, {
        body,
        origin,
        authorization,
      });
      assert.equal(response.json.error.reasonCode, expectedCode, label);
      assert.equal(response.body.includes(privateValue), false, label);
    }

    const crossOrigin = await request(port, previewPath, {
      body: { sessionId: session.json.sessionId, actionReference },
      origin: 'http://example.test',
      authorization: `Bearer ${capability}`,
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(crossOrigin.json.error.reasonCode, 'OPERATE_ORIGIN_INVALID');
    assert.equal(crossOrigin.body.includes('example.test'), false);

    const duplicate = await request(port, previewPath, {
      body: `{"sessionId":"${session.json.sessionId}","actionReference":"${actionReference}","action\\u0052eference":"${privateValue}"}`,
      origin,
      authorization: `Bearer ${capability}`,
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.json.error.reasonCode, 'OPERATE_DUPLICATE_MEMBER');
    assert.equal(duplicate.body.includes(privateValue), false);

    const wrongType = await request(port, previewPath, {
      body: { sessionId: session.json.sessionId, actionReference },
      origin,
      authorization: `Bearer ${capability}`,
      contentType: 'text/plain',
    });
    assert.equal(wrongType.status, 415);
    assert.equal(wrongType.json.error.reasonCode, 'OPERATE_CONTENT_TYPE_INVALID');

    const wrongMethod = await request(port, previewPath, {
      method: 'GET',
      origin,
      authorization: `Bearer ${capability}`,
    });
    assert.notEqual(wrongMethod.status, 200);
    assert.equal(wrongMethod.body.includes(privateValue), false);
    assert.ok(calls.length >= 1);
  });
});

test('confirmation exposes success only with an advanced public Event head and preserves terminal uncertainty', async () => {
  await withServer(async ({ port, origin, calls }) => {
    const session = await issueSession(port, origin);
    assert.equal(session.status, 200);
    const confirm = (previewId, previewHash = `sha256:${'f'.repeat(64)}`) =>
      request(port, `/api/operate/commands/confirm?${bindingQuery}`, {
        body: { sessionId: session.json.sessionId, previewId, previewHash },
        origin,
        authorization: `Bearer ${capability}`,
      });

    const sameHead = await confirm('xprv_same_head_12345678');
    assert.equal(sameHead.json.ok, false);
    assert.equal(sameHead.json.error.code ?? sameHead.json.error.reasonCode, 'OPERATION_UNCERTAIN');
    assert.equal(sameHead.body.includes('result-public-0001'), false);

    const absentProof = await confirm('xprv_absent_head_12345678');
    assert.equal(absentProof.json.ok, false);
    assert.equal(
      absentProof.json.error.code ?? absentProof.json.error.reasonCode,
      'OPERATION_UNCERTAIN',
    );
    assert.equal(absentProof.body.includes('result-public-0001'), false);

    const advanced = await confirm('xprv_advanced_head_12345678');
    assert.equal(advanced.status, 200);
    assert.equal(advanced.json.ok, true);
    assert.deepEqual(advanced.json.eventHead, advancedHead);

    const beforeUncertain = calls.filter(([kind]) => kind === 'confirm').length;
    const uncertain = await confirm('xprv_uncertain_12345678');
    assert.equal(uncertain.json.ok, false);
    assert.equal(uncertain.json.error.code, 'OPERATION_UNCERTAIN');
    assert.equal(uncertain.json.error.retryable, false);
    assert.equal(
      calls.filter(([kind]) => kind === 'confirm').length,
      beforeUncertain + 1,
      'one HTTP confirmation must never retry an uncertain gateway result',
    );

    const expired = await confirm('xprv_expired_12345678');
    assert.equal(expired.status, 409);
    assert.equal(expired.json.error.reasonCode, 'OPERATE_PREVIEW_EXPIRED');
    assert.equal(expired.body.includes(privateValue), false);

    for (const field of ['action', 'target', 'partyId', 'effect', 'revision', 'actionDigest']) {
      const before = calls.length;
      const refused = await request(port, `/api/operate/commands/confirm?${bindingQuery}`, {
        body: {
          sessionId: session.json.sessionId,
          previewId: 'xprv_advanced_head_12345678',
          previewHash: `sha256:${'f'.repeat(64)}`,
          [field]: field === 'revision' ? 99 : privateValue,
        },
        origin,
        authorization: `Bearer ${capability}`,
      });
      assert.equal(refused.status, 400, field);
      assert.equal(refused.body.includes(privateValue), false, field);
      assert.equal(calls.length, before, field);
    }
  });
});

test('session and confirmation responses are closed and reconstructed without gateway-private values', async () => {
  await withServer(async ({ port, origin, gateway }) => {
    const originalIssue = gateway.issueSession;
    for (const mutate of [
      (issued) => ({ ...issued, privateExtra: privateValue }),
      (issued) => ({ ...issued, issuedAt: privateValue }),
      (issued) => ({ ...issued, issuedAt: '2026-08-11T08:00:00Z' }),
      (issued) => ({ ...issued, expiresAt: privateValue }),
      (issued) => ({ ...issued, expiresAt: '2026-08-11T08:05:00Z' }),
      (issued) => ({ ...issued, expiresAt: issued.issuedAt }),
      (issued) => ({ ...issued, expiresAt: '2026-08-11T07:59:59.999Z' }),
      (issued) => ({ ...issued, expiresAt: '2026-08-11T08:00:00.999Z' }),
      (issued) => ({ ...issued, expiresAt: '2026-08-11T09:00:00.001Z' }),
      (issued) => ({ ...issued, binding: { ...issued.binding, privateExtra: privateValue } }),
      (issued) => ({
        ...issued,
        binding: {
          ...issued.binding,
          eventHead: { ...issued.binding.eventHead, privateExtra: privateValue },
        },
      }),
      (issued) => ({
        ...issued,
        binding: {
          ...issued.binding,
          actionLocator: { ...issued.binding.actionLocator, privateExtra: privateValue },
        },
      }),
      (issued) => ({
        ...issued,
        allowedActions: [{ ...issued.allowedActions[0], privateExtra: privateValue }],
      }),
    ]) {
      gateway.issueSession = async (input) => mutate(await originalIssue.call(gateway, input));
      const refused = await issueSession(port, origin);
      assert.equal(refused.status, 403);
      assert.equal(refused.body.includes(privateValue), false);
      assert.equal(refused.body.includes(capability), false);
    }
    gateway.issueSession = originalIssue;

    const session = await issueSession(port, origin);
    assert.equal(session.status, 200);
    const confirm = (previewId) =>
      request(port, `/api/operate/commands/confirm?${bindingQuery}`, {
        body: {
          sessionId: session.json.sessionId,
          previewId,
          previewHash: `sha256:${'f'.repeat(64)}`,
        },
        origin,
        authorization: `Bearer ${capability}`,
      });

    const originalProof = gateway.assertPreviewBinding;
    gateway.assertPreviewBinding = (input) => ({
      ...originalProof.call(gateway, input),
      operation: 'operate.action.approve',
      privateExtra: privateValue,
    });
    const badProof = await confirm('xprv_advanced_private_proof_01');
    assert.equal(badProof.status, 403);
    assert.equal(badProof.body.includes(privateValue), false);
    gateway.assertPreviewBinding = originalProof;

    const originalConfirm = gateway.confirm;
    gateway.confirm = async (input) => {
      const response = await originalConfirm.call(gateway, input);
      if (input.previewId.includes('failure_private')) {
        return {
          ...response,
          error: {
            ...response.error,
            message: privateValue,
            context: { privateExtra: privateValue },
          },
        };
      }
      if (input.previewId.includes('failure_extra')) {
        return { ...response, privateExtra: privateValue };
      }
      if (input.previewId.includes('failure_operation')) {
        return { ...response, operation: 'operate.action.approve' };
      }
      if (input.previewId.includes('failure_actions')) {
        return { ...response, allowedActions: [{ privateExtra: privateValue }] };
      }
      if (input.previewId.includes('failure_code')) {
        return { ...response, error: { ...response.error, code: privateValue } };
      }
      if (input.previewId.includes('success_extra')) {
        return { ...response, privateExtra: privateValue };
      }
      if (input.previewId.includes('success_operation')) {
        return { ...response, operation: 'operate.action.approve' };
      }
      if (input.previewId.includes('success_actions')) {
        return { ...response, allowedActions: [{ privateExtra: privateValue }] };
      }
      const dataMutation = [
        ['success_data_extra', (data) => ({ ...data, privateExtra: privateValue })],
        ['success_data_kind', (data) => ({ ...data, kind: 'private-kind' })],
        ['success_data_schema', (data) => ({ ...data, schemaVersion: '9.9.9' })],
        ['success_data_protocol', (data) => ({ ...data, protocolVersion: '9.9.9' })],
        ['success_data_access', (data) => ({ ...data, accessLevel: 'private' })],
        ['success_data_actor', (data) => ({ ...data, actorId: privateValue })],
        ['success_data_scope', (data) => ({ ...data, scopeId: privateValue })],
        ['success_data_domain', (data) => ({ ...data, domainId: privateValue })],
        ['success_data_version', (data) => ({ ...data, domainVersion: '9.9.9' })],
        [
          'success_data_head',
          (data) => ({
            ...data,
            eventHead: { sequence: data.eventHead.sequence + 1, hash: `sha256:${'e'.repeat(64)}` },
          }),
        ],
      ].find(([marker]) => input.previewId.includes(marker));
      return dataMutation
        ? {
            ...response,
            data: mutateCommandExperienceView(response.data, dataMutation[1]),
          }
        : response;
    };

    const privateFailure = await confirm('xprv_uncertain_failure_private_01');
    assert.equal(privateFailure.status, 200);
    assert.deepEqual(privateFailure.json.error, {
      code: 'OPERATION_UNCERTAIN',
      message: 'The durable result is uncertain. Inspect recovery state; do not retry blindly.',
      retryable: false,
      context: {},
    });
    assert.equal(privateFailure.body.includes(privateValue), false);

    for (const previewId of [
      'xprv_uncertain_failure_extra_01',
      'xprv_uncertain_failure_operation_01',
      'xprv_uncertain_failure_actions_01',
      'xprv_uncertain_failure_code_01',
      'xprv_advanced_success_extra_01',
      'xprv_advanced_success_operation_01',
      'xprv_advanced_success_actions_01',
      'xprv_advanced_success_data_extra_01',
      'xprv_advanced_success_data_kind_01',
      'xprv_advanced_success_data_schema_01',
      'xprv_advanced_success_data_protocol_01',
      'xprv_advanced_success_data_access_01',
      'xprv_advanced_success_data_actor_01',
      'xprv_advanced_success_data_scope_01',
      'xprv_advanced_success_data_domain_01',
      'xprv_advanced_success_data_version_01',
      'xprv_advanced_success_data_head_01',
    ]) {
      const refused = await confirm(previewId);
      assert.equal(refused.status, 409, previewId);
      assert.equal(refused.body.includes(privateValue), false, previewId);
    }
  });
});
