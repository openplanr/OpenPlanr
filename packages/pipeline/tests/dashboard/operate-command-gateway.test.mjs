import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createDashboardServer } from '../../lib/dashboard/server.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

const planrDir = join(process.cwd(), 'conformance/fixtures/dashboard-graph/.planr');
const capability = 'A'.repeat(43);
const bindingQuery = 'scopeId=scope-acme&domainId=business&domainVersion=1.0.0';
const cycleId = 'cyc_1234567890abcdef';
const subjectId = 'rev_1234567890abcdef';
const eventHead = Object.freeze({ sequence: 7, hash: `sha256:${'a'.repeat(64)}` });
const sourceViewHash = `sha256:${'c'.repeat(64)}`;
const allowedAction = Object.freeze({
  tool: 'operate.review.submit',
  arguments: Object.freeze({
    reviewId: subjectId,
    cycleId,
    actor: Object.freeze({
      actorId: 'owner-acme',
      kind: 'human',
      runtime: 'openplanr',
    }),
    scope: Object.freeze({
      scopeId: 'scope-acme',
      domainId: 'business',
      domainVersion: '1.0.0',
    }),
    disposition: 'approved',
    workDispositions: Object.freeze([
      Object.freeze({
        entityType: 'operating-decision',
        entityId: 'dec_1234567890abcdef',
        disposition: 'approved',
      }),
    ]),
  }),
  label: 'Approve the exact Decision review',
  effect: 'project-write',
});
const actionDigest = sha256Jcs(allowedAction);
const actionLocator = Object.freeze({ subjectId, actionDigest });

function exactSessionBody(overrides = {}) {
  return {
    cycleId,
    eventHead: structuredClone(eventHead),
    sourceViewHash,
    actionLocator: structuredClone(actionLocator),
    ...overrides,
  };
}

function exactSessionBinding(actorId = 'owner-acme') {
  return {
    actorId,
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    ...exactSessionBody(),
  };
}

function sessionEnvelope(sessionId, binding) {
  return {
    kind: 'operate-command-session',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    sessionId,
    sessionCapability: capability,
    issuedAt: '2026-08-11T08:00:00.000Z',
    expiresAt: '2026-08-11T08:10:00.000Z',
    binding,
    readOnly: false,
    allowedActions: [{ actionReference: 'opact_1234567890abcdef', subjectId, actionDigest }],
  };
}

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
    subject: { kind: 'review', id: subjectId, revision: null, hash: `sha256:${'d'.repeat(64)}` },
    eventHead: structuredClone(eventHead),
    sourceViewHash,
    actionDigest,
    allowedAction: structuredClone(allowedAction),
    authority: 'allowed',
    consequence: 'Approve the exact reviewed Decision without executing an Action.',
    reasonCodes: [],
    transition: {
      kind: 'review',
      targets: [
        {
          kind: 'operating-decision',
          id: 'dec_1234567890abcdef',
          revision: 3,
          hash: `sha256:${'e'.repeat(64)}`,
          disposition: 'approved',
        },
      ],
      reversible: false,
      nextState: 'approved',
      threshold: null,
    },
    issuedAt: '2026-08-11T08:00:00Z',
    expiresAt: '2026-08-11T08:02:00Z',
  };
  return { ...base, previewHash: sha256Jcs(base) };
}

function post(
  port,
  path,
  body,
  { origin, actor = 'owner-acme', authorization, headers = {} } = {},
) {
  const content = typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((resolveResponse, rejectResponse) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(content),
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
        res.on('end', () =>
          resolveResponse({
            status: res.statusCode,
            headers: res.headers,
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

function get(port, path, { origin, actor = 'owner-acme', authorization, headers = {} } = {}) {
  return new Promise((resolveResponse, rejectResponse) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: {
          ...(origin ? { Origin: origin } : {}),
          ...(actor ? { 'X-OpenPlanr-Actor': actor } : {}),
          ...(authorization ? { Authorization: authorization } : {}),
          ...headers,
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () =>
          resolveResponse({ status: res.statusCode, body, json: JSON.parse(body) }),
        );
      },
    );
    req.on('error', rejectResponse);
    req.end();
  });
}

test('governed command routes require exact local authority and accept only opaque references', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-operate-command-'));
  const calls = [];
  const assertions = [];
  const sessionBinding = exactSessionBinding();
  const gateway = {
    async issueSession(input) {
      calls.push(['session', input]);
      return sessionEnvelope('opsess_1234567890abcdef', sessionBinding);
    },
    assertSessionBinding(input) {
      assertions.push(input);
      if (input.sessionId !== 'opsess_1234567890abcdef' || input.capability !== capability) {
        throw Object.assign(new Error('private session details must not escape'), {
          code: input.sessionId.includes('expired')
            ? 'OPERATE_SESSION_EXPIRED'
            : 'OPERATE_SESSION_DENIED',
          status: 401,
        });
      }
      return sessionBinding;
    },
    async preview(input) {
      calls.push(['preview', input]);
      return previewFixture();
    },
    assertPreviewBinding() {
      return { binding: sessionBinding, operation: 'operate.review.submit' };
    },
    async confirm(input) {
      calls.push(['confirm', input]);
      return {
        ok: false,
        operation: 'operate.review.submit',
        error: {
          code: 'OPERATION_CONFLICT',
          message: 'Refused.',
          retryable: false,
          context: {},
        },
        allowedActions: [],
      };
    },
  };
  const dash = createDashboardServer({
    planrDir,
    watch: false,
    getOperatingCommandGateway: () => gateway,
  });
  try {
    const port = await dash.listen(0, { env: { ...process.env, PLANR_HOME: home } });
    const origin = `http://127.0.0.1:${port}`;
    const session = await post(port, `/api/operate/session?${bindingQuery}`, exactSessionBody(), {
      origin,
    });
    assert.equal(session.status, 200);
    assert.match(session.headers['cache-control'] ?? '', /no-store/);
    assert.equal(session.json.sessionCapability, capability);
    assert.deepEqual(calls[0], [
      'session',
      {
        ...exactSessionBody(),
        actor: { actorId: 'owner-acme', kind: 'human', runtime: 'openplanr' },
        origin,
      },
    ]);

    const preview = await post(
      port,
      `/api/operate/commands/preview?${bindingQuery}`,
      { sessionId: session.json.sessionId, actionReference: 'opact_1234567890abcdef' },
      { origin, authorization: `Bearer ${capability}` },
    );
    assert.equal(preview.status, 200);
    assert.deepEqual(calls[1], [
      'preview',
      {
        sessionId: 'opsess_1234567890abcdef',
        actionReference: 'opact_1234567890abcdef',
        capability,
        origin,
      },
    ]);
    assert.deepEqual(assertions[0], {
      sessionId: 'opsess_1234567890abcdef',
      capability,
      origin,
    });

    const confirmed = await post(
      port,
      `/api/operate/commands/confirm?${bindingQuery}`,
      {
        sessionId: session.json.sessionId,
        previewId: preview.json.previewId,
        previewHash: preview.json.previewHash,
      },
      { origin, authorization: `Bearer ${capability}` },
    );
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.json.ok, false);
    assert.equal(confirmed.json.error.code, 'OPERATION_CONFLICT');
    assert.deepEqual(calls[2], [
      'confirm',
      {
        sessionId: 'opsess_1234567890abcdef',
        previewId: 'xprv_1234567890abcdef',
        previewHash: preview.json.previewHash,
        capability,
        origin,
      },
    ]);
    assert.deepEqual(assertions[1], {
      sessionId: 'opsess_1234567890abcdef',
      capability,
      origin,
    });

    const hostileBody = await post(
      port,
      `/api/operate/commands/preview?${bindingQuery}`,
      {
        sessionId: session.json.sessionId,
        actionReference: 'opact_1234567890abcdef',
        grants: [{ effect: 'external-effect' }],
      },
      { origin, authorization: `Bearer ${capability}` },
    );
    assert.equal(hostileBody.status, 400);
    assert.equal(hostileBody.json.error.reasonCode, 'OPERATE_COMMAND_INVALID');
    assert.equal(calls.length, 3, 'caller-created authority must not reach OpenPlanr');

    const duplicateMember = await post(
      port,
      `/api/operate/commands/preview?${bindingQuery}`,
      `{"sessionId":"${session.json.sessionId}","actionReference":"opact_1234567890abcdef","action\\u0052eference":"opact_divergent"}`,
      { origin, authorization: `Bearer ${capability}` },
    );
    assert.equal(duplicateMember.status, 400);
    assert.equal(duplicateMember.json.error.reasonCode, 'OPERATE_DUPLICATE_MEMBER');

    const nestedDuplicateMember = await post(
      port,
      `/api/operate/commands/preview?${bindingQuery}`,
      `{"sessionId":"${session.json.sessionId}","actionReference":"opact_1234567890abcdef","foreign":{"grant":1,"grant":2}}`,
      { origin, authorization: `Bearer ${capability}` },
    );
    assert.equal(nestedDuplicateMember.status, 400);
    assert.equal(nestedDuplicateMember.json.error.reasonCode, 'OPERATE_DUPLICATE_MEMBER');
    assert.equal(calls.length, 3, 'duplicate JSON members are refused before gateway access');

    const substitutedActor = await post(
      port,
      `/api/operate/session?${bindingQuery}`,
      exactSessionBody(),
      { origin, actor: 'substituted-owner' },
    );
    assert.equal(substitutedActor.status, 403);
    assert.equal(substitutedActor.json.error.reasonCode, 'OPERATE_BINDING_MISMATCH');
    assert.equal(substitutedActor.body.includes(capability), false);
    assert.equal(
      calls.length,
      4,
      'the returned canonical binding must be checked before disclosure',
    );

    const crossOrigin = await post(
      port,
      `/api/operate/session?${bindingQuery}`,
      exactSessionBody(),
      { origin: 'http://example.test' },
    );
    assert.equal(crossOrigin.status, 403);
    assert.equal(crossOrigin.json.error.reasonCode, 'OPERATE_ORIGIN_INVALID');
    assert.equal(crossOrigin.body.includes('example.test'), false);

    const missingCapability = await post(
      port,
      `/api/operate/commands/preview?${bindingQuery}`,
      { sessionId: session.json.sessionId, actionReference: 'opact_1234567890abcdef' },
      { origin },
    );
    assert.equal(missingCapability.status, 401);
    assert.equal(missingCapability.json.error.reasonCode, 'OPERATE_SESSION_DENIED');

    const duplicateBinding = await post(
      port,
      `/api/operate/session?scopeId=scope-acme&${bindingQuery}`,
      exactSessionBody(),
      { origin },
    );
    assert.equal(duplicateBinding.status, 400);
    assert.equal(duplicateBinding.json.error.reasonCode, 'OPERATE_BINDING_REQUIRED');

    const oversized = await post(
      port,
      `/api/operate/session?${bindingQuery}`,
      JSON.stringify({ cycleId: 'x'.repeat(33 * 1024) }),
      { origin },
    );
    assert.equal(oversized.status, 413);
    assert.equal(oversized.json.error.reasonCode, 'OPERATE_BODY_TOO_LARGE');
    assert.equal(calls.length, 4);
  } finally {
    await dash.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('planning routes reuse the authenticated session and keep Planning authority separate', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-operate-planning-'));
  const planningCalls = [];
  const assertionCalls = [];
  const planningActionId = 'act_1234567890abcdef';
  const planningActionDigest = sha256Jcs({
    actionId: planningActionId,
    revision: 1,
    actionHash: `sha256:${'f'.repeat(64)}`,
  });
  const sessionBinding = {
    ...exactSessionBinding(),
    actionLocator: {
      subjectId: planningActionId,
      actionDigest: planningActionDigest,
    },
  };
  const commandGateway = {
    async issueSession() {
      return {
        kind: 'operate-command-session',
        schemaVersion: '1.0.0',
        protocolVersion: '2.0.0',
        sessionId: 'opsess_planning_12345678',
        sessionCapability: capability,
        issuedAt: '2026-08-11T08:00:00.000Z',
        expiresAt: '2026-08-11T08:10:00.000Z',
        binding: sessionBinding,
        readOnly: false,
        allowedActions: [
          {
            actionReference: 'opact_1234567890abcdef',
            subjectId: planningActionId,
            actionDigest: planningActionDigest,
          },
        ],
      };
    },
    assertSessionBinding(input) {
      assertionCalls.push(input);
      if (input.sessionId !== 'opsess_planning_12345678' || input.capability !== capability) {
        throw Object.assign(new Error('denied'), { code: 'OPERATE_SESSION_DENIED', status: 401 });
      }
      return sessionBinding;
    },
  };
  const planningGateway = {
    async preview(input) {
      planningCalls.push(['preview', input]);
      return {
        proposal: { proposalId: 'oprop_1234567890abcdef1234567890abcdef' },
        specPreview: { specId: 'SPEC-001', status: 'shaping' },
      };
    },
    async createSpec(input) {
      planningCalls.push(['create-spec', input]);
      return {
        receipt: { specId: 'SPEC-001', replayed: false },
        progress: { nodes: [{ kind: 'plan', state: 'not-started' }] },
      };
    },
    async trace(input) {
      planningCalls.push(['trace', input]);
      return {
        receipt: { specId: input.specId, replayed: true },
        origin: { cycleId: sessionBinding.cycleId },
        progress: { nodes: [{ kind: 'plan', state: 'not-started' }] },
      };
    },
  };
  const dash = createDashboardServer({
    planrDir,
    watch: false,
    getOperatingCommandGateway: () => commandGateway,
    getOperatingPlanningGateway: () => planningGateway,
  });
  try {
    const port = await dash.listen(0, { env: { ...process.env, PLANR_HOME: home } });
    const origin = `http://127.0.0.1:${port}`;
    const session = await post(
      port,
      `/api/operate/session?${bindingQuery}`,
      exactSessionBody({
        actionLocator: {
          subjectId: planningActionId,
          actionDigest: planningActionDigest,
        },
      }),
      { origin },
    );
    assert.equal(session.status, 200);
    const framing = {
      title: 'Reviewed title',
      slug: 'reviewed-title',
      problem: 'Problem',
      objective: 'Objective',
      users: ['Operators'],
      scope: ['One change'],
      nonScope: [],
      risks: [],
      constraints: [],
      requirements: ['Requirement'],
      acceptanceOutcomes: ['Accepted outcome'],
    };
    const preview = await post(
      port,
      `/api/operate/planning/preview?${bindingQuery}`,
      { sessionId: session.json.sessionId, actionId: planningActionId, framing },
      { origin, authorization: `Bearer ${capability}` },
    );
    assert.equal(preview.status, 200);
    assert.equal(preview.json.specPreview.specId, 'SPEC-001');
    const foreignPreview = await post(
      port,
      `/api/operate/planning/preview?${bindingQuery}`,
      { sessionId: session.json.sessionId, actionId: 'act_foreign_1234567890abcdef', framing },
      { origin, authorization: `Bearer ${capability}` },
    );
    assert.equal(foreignPreview.status, 403);
    assert.equal(foreignPreview.json.error.reasonCode, 'OPERATE_BINDING_MISMATCH');
    assert.equal(planningCalls.length, 1);
    assert.deepEqual(planningCalls[0], [
      'preview',
      {
        actionId: planningActionId,
        framing,
        actor: { actorId: 'owner-acme', kind: 'human', runtime: 'openplanr' },
        binding: sessionBinding,
      },
    ]);
    const created = await post(
      port,
      `/api/operate/planning/create-spec?${bindingQuery}`,
      {
        sessionId: session.json.sessionId,
        proposalId: 'oprop_1234567890abcdef1234567890abcdef',
        confirmDigest: `sha256:${'b'.repeat(64)}`,
      },
      { origin, authorization: `Bearer ${capability}` },
    );
    assert.equal(created.status, 200);
    assert.equal(created.json.receipt.specId, 'SPEC-001');
    assert.equal(planningCalls.length, 2);
    const traceQuery = bindingQuery;
    const trace = await get(port, `/api/operate/planning/trace/SPEC-001?${traceQuery}`, {});
    assert.equal(trace.status, 200);
    assert.equal(trace.json.receipt.specId, 'SPEC-001');
    assert.deepEqual(planningCalls[2], [
      'trace',
      {
        specId: 'SPEC-001',
        actor: { actorId: 'owner-acme', kind: 'human', runtime: 'openplanr' },
        binding: {
          actorId: sessionBinding.actorId,
          scopeId: sessionBinding.scopeId,
          domainId: sessionBinding.domainId,
          domainVersion: sessionBinding.domainVersion,
        },
      },
    ]);

    for (const hostile of [
      {
        sessionId: session.json.sessionId,
        actionId: 'act_1234567890abcdef',
        framing: { ...framing, privateBody: 'no' },
      },
      {
        sessionId: session.json.sessionId,
        actionId: 'act_1234567890abcdef',
        framing: { ...framing, scope: ['safe', 1] },
      },
      { sessionId: session.json.sessionId, actionId: 'act_1234567890abcdef', actor: 'foreign' },
    ]) {
      const refused = await post(port, `/api/operate/planning/preview?${bindingQuery}`, hostile, {
        origin,
        authorization: `Bearer ${capability}`,
      });
      assert.equal(refused.status, 400);
    }
    assert.equal(planningCalls.length, 3, 'invalid bodies stop before Planning gateway access');
    const foreign = await post(
      port,
      '/api/operate/planning/preview?scopeId=foreign&domainId=business&domainVersion=1.0.0',
      { sessionId: session.json.sessionId, actionId: 'act_1234567890abcdef' },
      { origin, authorization: `Bearer ${capability}` },
    );
    assert.equal(foreign.status, 403);
    assert.equal(planningCalls.length, 3);
    for (const hostilePath of [
      `/api/operate/planning/trace/SPEC-001?${traceQuery}&scopeId=duplicate`,
      `/api/operate/planning/trace/SPEC-001?${traceQuery}&foreign=1`,
      `/api/operate/planning/trace/SPEC%2F001?${traceQuery}`,
    ]) {
      const refused = await get(port, hostilePath, {
        origin,
      });
      assert.notEqual(refused.status, 200, hostilePath);
    }
    assert.equal(planningCalls.length, 3, 'invalid trace inputs stop before Planning access');
    const hostileHost = await get(port, `/api/operate/planning/trace/SPEC-001?${traceQuery}`, {
      headers: { Host: 'example.com' },
    });
    assert.equal(hostileHost.status, 403);
    assert.equal(planningCalls.length, 3);
    assert.equal(assertionCalls.length, 4);
  } finally {
    await dash.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('transport rejects every session-binding substitution before preview, confirm, or runtime work', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-operate-command-binding-'));
  const previewCalls = [];
  const confirmCalls = [];
  const runtimeCalls = [];
  const assertionCalls = [];
  const exactBinding = exactSessionBinding();
  const gateway = {
    async issueSession() {
      runtimeCalls.push('issue-session');
      return sessionEnvelope('opsess_1234567890abcdef', exactBinding);
    },
    assertSessionBinding(input) {
      assertionCalls.push(input);
      if (input.sessionId !== 'opsess_1234567890abcdef' || input.capability !== capability) {
        const expired = input.sessionId === 'opsess_expired_12345678';
        throw Object.assign(new Error('must remain private'), {
          code: expired ? 'OPERATE_SESSION_EXPIRED' : 'OPERATE_SESSION_DENIED',
          status: 401,
        });
      }
      return exactBinding;
    },
    async preview(input) {
      previewCalls.push(input);
      throw new Error('preview must not run for hostile transport input');
    },
    assertPreviewBinding() {
      throw new Error('preview custody must not run for hostile transport input');
    },
    async confirm(input) {
      confirmCalls.push(input);
      throw new Error('confirm must not run for hostile transport input');
    },
  };
  const dash = createDashboardServer({
    planrDir,
    watch: false,
    getOperatingCommandGateway: () => gateway,
  });
  try {
    const port = await dash.listen(0, { env: { ...process.env, PLANR_HOME: home } });
    const origin = `http://127.0.0.1:${port}`;
    const previewBody = {
      sessionId: 'opsess_1234567890abcdef',
      actionReference: 'opact_1234567890abcdef',
    };
    const confirmBody = {
      sessionId: 'opsess_1234567890abcdef',
      previewId: 'xprv_1234567890abcdef',
      previewHash: `sha256:${'b'.repeat(64)}`,
    };
    const hostileBindings = [
      ['actor', bindingQuery, { actor: 'foreign-owner' }, 403, 'OPERATE_BINDING_MISMATCH'],
      [
        'duplicate actor header',
        bindingQuery,
        {
          headers: { 'X-OpenPlanr-Actor': ['owner-acme', 'foreign-owner'] },
        },
        400,
        'OPERATE_BINDING_REQUIRED',
      ],
      [
        'scope',
        'scopeId=foreign-scope&domainId=business&domainVersion=1.0.0',
        {},
        403,
        'OPERATE_BINDING_MISMATCH',
      ],
      [
        'domain',
        'scopeId=scope-acme&domainId=software&domainVersion=1.0.0',
        {},
        403,
        'OPERATE_BINDING_MISMATCH',
      ],
      [
        'version',
        'scopeId=scope-acme&domainId=business&domainVersion=9.9.9',
        {},
        403,
        'OPERATE_BINDING_MISMATCH',
      ],
    ];
    for (const [name, query, options, expectedStatus, expectedCode] of hostileBindings) {
      for (const [route, body] of [
        ['preview', previewBody],
        ['confirm', confirmBody],
      ]) {
        const response = await post(port, `/api/operate/commands/${route}?${query}`, body, {
          origin,
          authorization: `Bearer ${capability}`,
          ...options,
        });
        assert.equal(response.status, expectedStatus, `${name} ${route}`);
        assert.equal(response.json.error.reasonCode, expectedCode);
        assert.equal(response.body.includes('foreign'), false);
      }
    }

    const assertionCount = assertionCalls.length;
    for (const query of [
      'ScopeId=scope-acme&domainId=business&domainVersion=1.0.0',
      'scope%49d=scope-acme&domainId=business&domainVersion=1.0.0',
      `${bindingQuery}&scopeId=scope-acme`,
      `${bindingQuery}&ACTORID=owner-acme`,
    ]) {
      const response = await post(port, `/api/operate/commands/preview?${query}`, previewBody, {
        origin,
        authorization: `Bearer ${capability}`,
      });
      assert.equal(response.status, 400, query);
      assert.equal(response.json.error.reasonCode, 'OPERATE_BINDING_REQUIRED');
    }
    assert.equal(
      assertionCalls.length,
      assertionCount,
      'malformed binding keys stop before session access',
    );

    const duplicateAuthorization = await post(
      port,
      `/api/operate/commands/preview?${bindingQuery}`,
      previewBody,
      {
        origin,
        headers: { Authorization: [`Bearer ${capability}`, `Bearer ${'B'.repeat(43)}`] },
      },
    );
    assert.equal(duplicateAuthorization.status, 401);
    assert.equal(duplicateAuthorization.json.error.reasonCode, 'OPERATE_SESSION_DENIED');
    assert.equal(
      assertionCalls.length,
      assertionCount,
      'duplicate bearer stops before session access',
    );

    for (const [sessionId, suppliedCapability, expectedCode] of [
      ['opsess_unknown_12345678', capability, 'OPERATE_SESSION_DENIED'],
      ['opsess_revoked_12345678', capability, 'OPERATE_SESSION_DENIED'],
      ['opsess_expired_12345678', capability, 'OPERATE_SESSION_EXPIRED'],
      ['opsess_1234567890abcdef', 'B'.repeat(43), 'OPERATE_SESSION_DENIED'],
    ]) {
      const response = await post(
        port,
        `/api/operate/commands/preview?${bindingQuery}`,
        { ...previewBody, sessionId },
        { origin, authorization: `Bearer ${suppliedCapability}` },
      );
      assert.equal(response.status, 401, sessionId);
      assert.equal(response.json.error.reasonCode, expectedCode);
      assert.equal(response.body.includes(sessionId), false);
      assert.equal(response.body.includes(suppliedCapability), false);
    }

    const cycleSubstitution = await post(
      port,
      `/api/operate/session?${bindingQuery}`,
      exactSessionBody({ cycleId: 'cyc_substituted_12345678' }),
      { origin, authorization: `Bearer ${capability}` },
    );
    assert.equal(cycleSubstitution.status, 403);
    assert.equal(cycleSubstitution.json.error.reasonCode, 'OPERATE_BINDING_MISMATCH');
    assert.equal(cycleSubstitution.body.includes('cyc_substituted'), false);
    assert.deepEqual(previewCalls, []);
    assert.deepEqual(confirmCalls, []);
    assert.deepEqual(runtimeCalls, ['issue-session']);
  } finally {
    await dash.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('command routes fail read-only when OpenPlanr did not install a gateway', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-operate-command-readonly-'));
  const dash = createDashboardServer({ planrDir, watch: false });
  try {
    const port = await dash.listen(0, { env: { ...process.env, PLANR_HOME: home } });
    const response = await post(port, `/api/operate/session?${bindingQuery}`, exactSessionBody(), {
      origin: `http://127.0.0.1:${port}`,
    });
    assert.equal(response.status, 409);
    assert.equal(response.json.error.reasonCode, 'OPERATE_READ_ONLY');
    assert.match(response.headers['cache-control'] ?? '', /no-store/);
  } finally {
    await dash.close();
    rmSync(home, { recursive: true, force: true });
  }
});
