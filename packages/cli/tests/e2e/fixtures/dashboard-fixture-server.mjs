import { sha256Jcs } from 'planr-pipeline/dashboard/verified-json';
import {
  createDashboardApiFixture,
  createDashboardReviewTerminal,
  DASHBOARD_FIXTURE_ACTION_ID,
  DASHBOARD_FIXTURE_ACTOR,
  DASHBOARD_FIXTURE_CYCLE_ID,
  DASHBOARD_FIXTURE_GENERATION,
  DASHBOARD_FIXTURE_ORIGIN,
  DASHBOARD_FIXTURE_PROJECT_ID,
  DASHBOARD_FIXTURE_REVIEW_ID,
} from './dashboard-api-fixture.mjs';

const fixture = createDashboardApiFixture();
const streams = new Set();
let activeLocator = null;
const disposableReviewScenarios = new Map();
const DISPOSABLE_REVIEW_DISPOSITIONS = new Set(['approved', 'changes_requested', 'rejected']);

function responseJson(response, status, value) {
  const body = JSON.stringify(value);
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('content-length', Buffer.byteLength(body));
  response.setHeader('cache-control', 'no-store');
  response.end(body);
}

function refuse(response, status = 400) {
  responseJson(response, status, {
    ok: false,
    error: {
      reasonCode: 'FIXTURE_REQUEST_INVALID',
      message: 'Fixture request rejected.',
      retryable: false,
    },
  });
}

function bootstrapForRequest(request) {
  try {
    const referer = new URL(request.headers.referer ?? DASHBOARD_FIXTURE_ORIGIN);
    const name = referer.searchParams.get('project');
    const localOperate = referer.searchParams.get('localOperate') === '1';
    const bootstrap = localOperate
      ? {
          ...fixture.bootstrap,
          capabilities: {
            ...fixture.bootstrap.capabilities,
            operateCommands: {
              ...fixture.bootstrap.capabilities.operateCommands,
              available: false,
            },
          },
          queryRoots: { ...fixture.bootstrap.queryRoots, operate: null },
        }
      : fixture.bootstrap;
    if (name === null) return bootstrap;
    return { ...bootstrap, project: { ...bootstrap.project, name } };
  } catch {
    return fixture.bootstrap;
  }
}

function planningForRequest(request) {
  try {
    const referer = new URL(request.headers.referer ?? DASHBOARD_FIXTURE_ORIGIN);
    if (referer.searchParams.get('planningScenario') !== 'delivery') return fixture.planning;
  } catch {
    return fixture.planning;
  }
  const graph = {
    nodes: [
      {
        id: 'EPIC-009',
        type: 'epic',
        title: 'Reliable registration operations',
        status: 'in-progress',
        frontmatter: { id: 'EPIC-009', updated: '2026-09-08' },
      },
      {
        id: 'QT-070',
        type: 'quick',
        title: 'Configure the dedicated CRM flow',
        status: 'done',
        frontmatter: { id: 'QT-070', updated: '2026-09-03' },
      },
      {
        id: 'QT-071',
        type: 'quick',
        title: 'Make failed CRM registrations visible and replayable',
        status: 'in-progress',
        frontmatter: {
          id: 'QT-071',
          dependsOn: ['QT-070'],
          updated: '2026-09-08',
          githubIssue: 162,
        },
      },
      {
        id: 'T-072',
        type: 'task',
        title: 'Add structured logs and correlation IDs',
        status: 'outstanding',
        frontmatter: { id: 'T-072', dependsOn: ['QT-071'], updated: '2026-09-09' },
      },
      {
        id: 'T-073',
        type: 'task',
        title: 'Verify alerting and replay outcomes',
        status: 'blocked',
        frontmatter: { id: 'T-073', dependsOn: ['T-072'], updated: '2026-09-10' },
      },
      {
        id: 'SPRINT-009',
        type: 'sprint',
        title: 'SPRINT-009',
        status: 'outstanding',
        frontmatter: {
          id: 'SPRINT-009',
          name: 'CRM recovery and observability',
          status: 'active',
          startDate: '2026-09-08',
          endDate: '2026-09-22',
          goal: 'Recover failed registrations and prove the path is observable.',
          taskIds: ['QT-071', 'T-072', 'T-073'],
        },
      },
      ...Array.from({ length: 32 }, (_, index) => ({
        id: `QT-${String(index + 100).padStart(3, '0')}`,
        type: 'quick',
        title: `Completed maintenance item ${index + 1}`,
        status: 'done',
        frontmatter: {
          id: `QT-${String(index + 100).padStart(3, '0')}`,
          updated: '2026-09-01',
        },
      })),
    ],
    edges: [
      { from: 'QT-071', to: 'QT-070', kind: 'depends_on' },
      { from: 'T-072', to: 'QT-071', kind: 'depends_on' },
      { from: 'T-073', to: 'T-072', kind: 'depends_on' },
    ],
  };
  return {
    ...fixture.planning,
    cursor: { ...fixture.planning.cursor, viewHash: sha256Jcs(graph) },
    mode: 'agile',
    graph,
  };
}

const LOCAL_REVIEW_ID = '2026-09-14-modul-events';
const LOCAL_REVIEW_MARKDOWN = `# Operating board report — Modul events

## Scope
- **Subject:** Modul events release operations
- **Window:** current snapshot on main
- **Requested decision:** periodic review
- **Custody:** local-only

## Executive summary
**Overall signal: act now.** Act now on the verified release path.

## Decision queue
### D1 — [P0] Verify the CRM flow
- **Recommendation:** Run the smoke test before engineering work.
- **Why now:** A dated event depends on the flow and failures are silent.
- **Suggested owner:** Asem; CRM owner if it fails
- **Confidence:** high on the code path; unknown on current flow state
- **First step:** Run the CRM smoke test and record the result.
- **Expected result:** The test row reaches created and failed rows are counted.
- **Check:** Inspect the admin row and record a dated result.
- **Dependencies:** none
- **Sources:** \`docs/crm-registration-webhook.md:12\`

## Action plan
| ID | Priority | Action | Suggested owner | First step | Success measure | Check | Depends on |
|---|---|---|---|---|---|---|---|
| A1 | P0 | Run the CRM smoke test | Asem | Submit one test registration | Row reaches created | Inspect the admin row | D1 |

## Risks and dissent
- **Challenger dissent:** Verify before dispatching engineering.

## Decision-changing gaps
- **G1 — Live flow state:** A smoke test decides whether this is an outage or hardening.

## Review coverage
| Lens | Outcome | Note | Informed |
|---|---|---|---|
| CEO | reported (signal: action) | \`ceo.md\` | D1 |
| CTO | reported (signal: action) | \`cto.md\` | D1 |
| CPO | reported (signal: action) | \`cpo.md\` | D1 |
| CMO | reported (signal: insufficient context) | \`cmo.md\` | watch acquisition |
| COO | reported (signal: action) | \`coo.md\` | D1 |
| Challenger | reported (verdict: holds with exceptions) | \`challenger.md\` | D1 |
| Chair | reported | \`chair.md\` | synthesis |

## Issues
- **I1 — Validator wrapper:** exits one after clean validation.
`;
const LOCAL_REVIEW_ITEM = Object.freeze({
  cycleId: LOCAL_REVIEW_ID,
  title: 'Operating board report — Modul events',
  summary: 'Act now on the verified release path.',
  signal: 'act now',
  updatedAt: '2026-09-14T20:10:00.000Z',
  counts: Object.freeze({ decisions: 1, actions: 1, gaps: 1, issues: 1 }),
  href: `#/operate/cycles/${LOCAL_REVIEW_ID}`,
});
const LOCAL_REVIEW_DETAIL = Object.freeze({
  ...LOCAL_REVIEW_ITEM,
  scope: Object.freeze({
    subject: 'Modul events release operations',
    window: 'current snapshot on main',
    requestedDecision: 'periodic review',
    custody: 'local-only',
  }),
  decisions: Object.freeze([
    Object.freeze({
      id: 'D1',
      priority: 'P0',
      title: 'Verify the CRM flow',
      recommendation: 'Run the smoke test before engineering work.',
      whyNow: 'A dated event depends on the flow and failures are silent.',
      owner: 'Asem; CRM owner if it fails',
      confidence: 'high on the code path; unknown on current flow state',
      firstStep: 'Run the CRM smoke test and record the result.',
      expectedResult: 'The test row reaches created and failed rows are counted.',
      check: 'Inspect the admin row and record a dated result.',
      dependencies: 'none',
      revisitWhen: '',
      sources: 'docs/crm-registration-webhook.md:12',
      dissent: 'Verify before dispatching engineering.',
    }),
  ]),
  actions: Object.freeze([
    Object.freeze({
      id: 'A1',
      priority: 'P0',
      action: 'Run the CRM smoke test',
      owner: 'Asem',
      firstStep: 'Submit one test registration before dispatching QT-071',
      successMeasure: 'Row reaches created',
      check: 'Inspect the admin row',
      dependencies: 'D1',
      state: 'proposed',
    }),
  ]),
  gaps: Object.freeze([
    Object.freeze({
      id: 'G1',
      title: 'Live flow state',
      detail: 'A smoke test decides whether this is an outage or hardening.',
    }),
  ]),
  risks: Object.freeze([
    Object.freeze({
      id: 'R1',
      title: 'Challenger dissent',
      detail: 'Verify before dispatching engineering.',
    }),
  ]),
  issues: Object.freeze([
    Object.freeze({
      id: 'I1',
      title: 'Validator wrapper',
      detail: 'exits one after clean validation.',
    }),
  ]),
  lenses: Object.freeze(
    [
      ['CEO', 'action', 5, 'D1'],
      ['CTO', 'action', 5, 'D1'],
      ['CPO', 'action', 5, 'D1'],
      ['CMO', 'insufficient context', 4, 'watch acquisition'],
      ['COO', 'action', 5, 'D1'],
      ['Challenger', 'holds with exceptions', 1, 'D1'],
      ['Chair', 'reported', 1, 'synthesis'],
    ].map(([name, signal, findings, informed]) =>
      Object.freeze({
        name,
        filename: `${String(name).toLowerCase()}.md`,
        present: true,
        outcome: `reported (signal: ${signal})`,
        signal,
        informed,
        findings,
        recommendation: '',
      }),
    ),
  ),
  evidence: Object.freeze([
    Object.freeze({
      id: 'E1',
      reference: 'docs/crm-registration-webhook.md:12',
      kind: 'source location',
      freshness: 'captured in cycle',
    }),
  ]),
  recovery: Object.freeze({
    complete: true,
    presentFiles: Object.freeze([
      'board-report.md',
      'cycle.md',
      'ceo.md',
      'cto.md',
      'cpo.md',
      'cmo.md',
      'coo.md',
      'challenger.md',
      'chair.md',
    ]),
    missingFiles: Object.freeze([]),
    totalBytes: 14_208,
    custody: 'local-only',
  }),
  markdown: LOCAL_REVIEW_MARKDOWN,
});

function localReviewRequest(request) {
  try {
    const referer = new URL(request.headers.referer ?? DASHBOARD_FIXTURE_ORIGIN);
    return referer.searchParams.get('localOperate') === '1';
  } catch {
    return false;
  }
}

function exactQuery(url, expected) {
  const actual = [...url.searchParams.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const required = Object.entries(expected).sort(([left], [right]) => left.localeCompare(right));
  return (
    actual.length === required.length &&
    actual.every(
      ([key, value], index) => key === required[index][0] && value === required[index][1],
    )
  );
}

function actorIsBound(request) {
  return request.headers['x-openplanr-actor'] === DASHBOARD_FIXTURE_ACTOR;
}

function disposableReviewScenario(request) {
  try {
    const referer = new URL(request.headers.referer ?? DASHBOARD_FIXTURE_ORIGIN);
    const disposition = referer.searchParams.get('reviewDisposition');
    const proof = referer.searchParams.get('reviewProof');
    if (
      !DISPOSABLE_REVIEW_DISPOSITIONS.has(disposition) ||
      proof === null ||
      !/^[a-z0-9_-]{1,80}$/u.test(proof)
    ) {
      return null;
    }
    const key = `${disposition}:${proof}`;
    let state = disposableReviewScenarios.get(key);
    if (!state) {
      state = { active: null, terminal: null };
      disposableReviewScenarios.set(key, state);
    }
    return { disposition, state };
  } catch {
    return null;
  }
}

function reviewChoiceForAction(action) {
  const choiceHash = sha256Jcs(action.arguments);
  return fixture.review.payload.data.choices.find((choice) => choice.choiceHash === choiceHash);
}

function reviewActionForLocator(locator) {
  const capability = fixture.review.payload.data.capability;
  if (!capability.available) return null;
  const matches = capability.actions.filter(
    ({ subjectId, action }) =>
      subjectId === locator.subjectId && sha256Jcs(action) === locator.actionDigest,
  );
  return matches.length === 1 ? matches[0].action : null;
}

function reviewPreview(action, actionDigest, disposition) {
  const choice = reviewChoiceForAction(action);
  if (!choice) throw new TypeError('Review fixture action has no exact displayed choice.');
  const base = {
    kind: 'operate-experience-preview',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    previewId: `xprv_review_browser_${disposition}`,
    scopeId: fixture.review.payload.scopeId,
    domainId: fixture.review.payload.domainId,
    domainVersion: fixture.review.payload.domainVersion,
    actorId: fixture.review.payload.actorId,
    subject: {
      kind: 'review',
      id: DASHBOARD_FIXTURE_REVIEW_ID,
      revision: null,
      hash: choice.choiceHash,
    },
    eventHead: fixture.review.payload.sourceEventHead,
    sourceViewHash: fixture.review.payload.sourceViewHash,
    actionDigest,
    allowedAction: action,
    authority: 'allowed',
    consequence: choice.consequence,
    reasonCodes: [],
    transition: {
      kind: 'review',
      targets: [
        {
          kind: 'review',
          id: DASHBOARD_FIXTURE_REVIEW_ID,
          revision: null,
          hash: choice.choiceHash,
          disposition,
        },
      ],
      reversible: false,
      nextState: disposition,
      threshold: null,
    },
    issuedAt: '2026-08-19T08:00:00.000Z',
    expiresAt: '2099-08-19T08:10:00.000Z',
  };
  return { ...base, previewHash: sha256Jcs(base) };
}

function reviewSession(actionDigest, disposition) {
  const actionReference = `opact_review_browser_${disposition}`;
  return {
    kind: 'operate-command-session',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    sessionId: `opsess_review_browser_${disposition}`,
    sessionCapability: 'R'.repeat(43),
    issuedAt: '2026-08-19T08:00:00.000Z',
    expiresAt: '2099-08-19T08:10:00.000Z',
    binding: {
      actorId: fixture.review.payload.actorId,
      scopeId: fixture.review.payload.scopeId,
      domainId: fixture.review.payload.domainId,
      domainVersion: fixture.review.payload.domainVersion,
      cycleId: DASHBOARD_FIXTURE_CYCLE_ID,
      eventHead: fixture.review.payload.sourceEventHead,
      sourceViewHash: fixture.review.payload.sourceViewHash,
      actionLocator: { subjectId: DASHBOARD_FIXTURE_REVIEW_ID, actionDigest },
    },
    allowedActions: [{ actionReference, subjectId: DASHBOARD_FIXTURE_REVIEW_ID, actionDigest }],
    readOnly: false,
  };
}

function validReviewNote(note) {
  return (
    note === null ||
    (typeof note === 'string' &&
      note.length > 0 &&
      note.length <= 2_048 &&
      /^\S(?:[\s\S]*\S)?$/u.test(note))
  );
}

function reviewCommandResponse(request, response, pathname, body, scenario) {
  const { disposition, state } = scenario;
  if (pathname === '/api/operate/session') {
    if (
      !exactObject(body, ['cycleId', 'eventHead', 'sourceViewHash', 'actionLocator']) ||
      body.cycleId !== DASHBOARD_FIXTURE_CYCLE_ID ||
      JSON.stringify(body.eventHead) !== JSON.stringify(fixture.review.payload.sourceEventHead) ||
      body.sourceViewHash !== fixture.review.payload.sourceViewHash ||
      !exactObject(body.actionLocator, ['subjectId', 'actionDigest'])
    ) {
      return refuse(response);
    }
    const action = reviewActionForLocator(body.actionLocator);
    if (!action || action.arguments.disposition !== disposition) return refuse(response);
    const session = reviewSession(body.actionLocator.actionDigest, disposition);
    state.active = {
      action,
      actionDigest: body.actionLocator.actionDigest,
      actionReference: session.allowedActions[0].actionReference,
      preview: null,
    };
    return responseJson(response, 200, session);
  }
  if (!state.active || request.headers.authorization !== `Bearer ${'R'.repeat(43)}`) {
    return refuse(response);
  }
  if (pathname === '/api/operate/commands/preview') {
    if (
      !exactObject(body, ['sessionId', 'actionReference']) ||
      body.sessionId !== `opsess_review_browser_${disposition}` ||
      body.actionReference !== state.active.actionReference
    ) {
      return refuse(response);
    }
    state.active.preview = reviewPreview(
      state.active.action,
      state.active.actionDigest,
      disposition,
    );
    return responseJson(response, 200, state.active.preview);
  }
  if (
    pathname !== '/api/operate/commands/confirm' ||
    !state.active.preview ||
    !exactObject(body, ['sessionId', 'previewId', 'previewHash', 'note']) ||
    body.sessionId !== `opsess_review_browser_${disposition}` ||
    body.previewId !== state.active.preview.previewId ||
    body.previewHash !== state.active.preview.previewHash ||
    !validReviewNote(body.note)
  ) {
    return refuse(response);
  }
  const terminal = createDashboardReviewTerminal(disposition, body.note);
  state.terminal = terminal;
  return responseJson(response, 200, {
    ok: true,
    operation: 'operate.review.submit',
    data: { receipt: terminal.receipt, workspace: terminal.workspace },
    allowedActions: [],
    eventHead: terminal.receipt.eventHead,
  });
}

function operateRootQuery(url) {
  return exactQuery(url, {
    scopeId: fixture.view.scopeId,
    domainId: fixture.view.domainId,
    domainVersion: fixture.view.domainVersion,
  });
}

function boundCollectionQuery(url, includeCycle) {
  return exactQuery(url, {
    scopeId: fixture.view.scopeId,
    domainId: fixture.view.domainId,
    domainVersion: fixture.view.domainVersion,
    projectId: DASHBOARD_FIXTURE_PROJECT_ID,
    generation: String(DASHBOARD_FIXTURE_GENERATION),
    ...(includeCycle ? { cycleId: DASHBOARD_FIXTURE_CYCLE_ID } : {}),
  });
}

function auditQuery(url) {
  return exactQuery(url, {
    scopeId: fixture.view.scopeId,
    domainId: fixture.view.domainId,
    domainVersion: fixture.view.domainVersion,
    cycleId: DASHBOARD_FIXTURE_CYCLE_ID,
  });
}

function openStream(request, response) {
  response.statusCode = 200;
  response.setHeader('content-type', 'text/event-stream; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('connection', 'keep-alive');
  response.flushHeaders();
  response.write(': owner fixture stream ready\n\n');
  streams.add(response);
  request.once('close', () => streams.delete(response));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new TypeError('Fixture request exceeds its limit.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function exactObject(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
  );
}

async function commandResponse(request, response, pathname) {
  if (request.method !== 'POST' || !actorIsBound(request)) return refuse(response);
  const url = new URL(request.url, DASHBOARD_FIXTURE_ORIGIN);
  if (!operateRootQuery(url)) return refuse(response);
  const body = await readJsonBody(request);
  const reviewScenario = disposableReviewScenario(request);
  if (
    reviewScenario &&
    ((pathname === '/api/operate/session' &&
      body.actionLocator?.subjectId === DASHBOARD_FIXTURE_REVIEW_ID) ||
      ((pathname === '/api/operate/commands/preview' ||
        pathname === '/api/operate/commands/confirm') &&
        reviewScenario.state.active !== null))
  ) {
    return reviewCommandResponse(request, response, pathname, body, reviewScenario);
  }
  if (pathname === '/api/operate/session') {
    if (
      !exactObject(body, ['cycleId', 'eventHead', 'sourceViewHash', 'actionLocator']) ||
      body.cycleId !== DASHBOARD_FIXTURE_CYCLE_ID ||
      JSON.stringify(body.eventHead) !== JSON.stringify(fixture.view.eventHead) ||
      body.sourceViewHash !== fixture.view.viewHash ||
      !exactObject(body.actionLocator, ['subjectId', 'actionDigest']) ||
      body.actionLocator.subjectId !== DASHBOARD_FIXTURE_ACTION_ID ||
      body.actionLocator.actionDigest !== sha256Jcs(fixture.allowedAction)
    ) {
      return refuse(response);
    }
    activeLocator = body.actionLocator;
    return responseJson(response, 200, {
      kind: 'operate-command-session',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      sessionId: 'opsess_browser_fixture_01',
      sessionCapability: 'A'.repeat(43),
      issuedAt: '2026-08-19T08:00:00.000Z',
      expiresAt: '2099-08-19T08:10:00.000Z',
      binding: {
        actorId: DASHBOARD_FIXTURE_ACTOR,
        scopeId: fixture.view.scopeId,
        domainId: fixture.view.domainId,
        domainVersion: fixture.view.domainVersion,
        cycleId: DASHBOARD_FIXTURE_CYCLE_ID,
        eventHead: fixture.view.eventHead,
        sourceViewHash: fixture.view.viewHash,
        actionLocator: activeLocator,
      },
      allowedActions: [
        {
          actionReference: 'opact_browser_fixture_01',
          subjectId: DASHBOARD_FIXTURE_ACTION_ID,
          actionDigest: activeLocator.actionDigest,
        },
      ],
      readOnly: false,
    });
  }
  if (
    pathname !== '/api/operate/commands/preview' ||
    !activeLocator ||
    request.headers.authorization !== `Bearer ${'A'.repeat(43)}` ||
    !exactObject(body, ['sessionId', 'actionReference']) ||
    body.sessionId !== 'opsess_browser_fixture_01' ||
    body.actionReference !== 'opact_browser_fixture_01'
  ) {
    return refuse(response);
  }
  const preview = {
    kind: 'operate-experience-preview',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    previewId: 'xprv_browser_fixture_12345678',
    scopeId: fixture.view.scopeId,
    domainId: fixture.view.domainId,
    domainVersion: fixture.view.domainVersion,
    actorId: DASHBOARD_FIXTURE_ACTOR,
    subject: {
      kind: 'action',
      id: DASHBOARD_FIXTURE_ACTION_ID,
      revision: 1,
      hash: fixture.allowedAction.arguments.action.actionHash,
    },
    eventHead: fixture.view.eventHead,
    sourceViewHash: fixture.view.viewHash,
    actionDigest: activeLocator.actionDigest,
    allowedAction: fixture.allowedAction,
    authority: 'allowed',
    consequence: 'Review the reminder setting rollback before confirming.',
    reasonCodes: [],
    transition: {
      kind: 'rollback',
      targets: [
        {
          kind: 'operating-action',
          id: DASHBOARD_FIXTURE_ACTION_ID,
          revision: 1,
          hash: fixture.allowedAction.arguments.action.actionHash,
          disposition: 'rolling-back',
        },
      ],
      reversible: false,
      nextState: 'rolling-back',
      threshold: null,
    },
    issuedAt: '2026-08-19T08:00:00.000Z',
    expiresAt: '2099-08-19T08:10:00.000Z',
  };
  return responseJson(response, 200, { ...preview, previewHash: sha256Jcs(preview) });
}

async function routeApi(request, response, next) {
  const url = new URL(request.url, DASHBOARD_FIXTURE_ORIGIN);
  const { pathname } = url;
  if (!pathname.startsWith('/api/')) return next();
  try {
    if (pathname === '/api/bootstrap') {
      return request.method === 'GET' && exactQuery(url, {})
        ? responseJson(response, 200, bootstrapForRequest(request))
        : refuse(response);
    }
    if (pathname === '/api/planning/graph') {
      const valid =
        request.method === 'GET' &&
        actorIsBound(request) &&
        exactQuery(url, {
          projectId: DASHBOARD_FIXTURE_PROJECT_ID,
          scopeId: 'planning',
          domainId: 'planning',
          domainVersion: '1.0.0',
          generation: String(DASHBOARD_FIXTURE_GENERATION),
        });
      return valid ? responseJson(response, 200, planningForRequest(request)) : refuse(response);
    }
    if (pathname === '/api/planning/events') {
      const valid =
        request.method === 'GET' &&
        actorIsBound(request) &&
        exactQuery(url, {
          projectId: DASHBOARD_FIXTURE_PROJECT_ID,
          scopeId: 'planning',
          domainId: 'planning',
          domainVersion: '1.0.0',
          generation: String(DASHBOARD_FIXTURE_GENERATION),
        });
      return valid ? openStream(request, response) : refuse(response);
    }
    if (pathname === '/api/operate/local-reviews') {
      const embeddedRequest = exactQuery(url, { page: '1', pageSize: '1' });
      const routeRequest =
        localReviewRequest(request) && exactQuery(url, { page: '1', pageSize: '12' });
      const valid = request.method === 'GET' && (embeddedRequest || routeRequest);
      return valid
        ? responseJson(response, 200, {
            kind: 'local-operate-review-index',
            schemaVersion: '1.0.0',
            readOnly: true,
            pagination: {
              page: 1,
              pageSize: embeddedRequest ? 1 : 12,
              pageCount: 1,
              total: 1,
            },
            items: [LOCAL_REVIEW_ITEM],
          })
        : refuse(response);
    }
    if (pathname === `/api/operate/local-reviews/${LOCAL_REVIEW_ID}`) {
      return request.method === 'GET' && exactQuery(url, {})
        ? responseJson(response, 200, {
            kind: 'local-operate-review',
            schemaVersion: '1.0.0',
            readOnly: true,
            item: LOCAL_REVIEW_DETAIL,
          })
        : refuse(response);
    }
    if (pathname === '/api/operate/events') {
      const valid =
        request.method === 'GET' &&
        actorIsBound(request) &&
        exactQuery(url, {
          scopeId: fixture.view.scopeId,
          domainId: fixture.view.domainId,
          domainVersion: fixture.view.domainVersion,
          generation: String(DASHBOARD_FIXTURE_GENERATION),
        });
      return valid ? openStream(request, response) : refuse(response);
    }
    if (pathname === '/api/operate/planning/trace/SPEC-020') {
      const valid = request.method === 'GET' && actorIsBound(request) && operateRootQuery(url);
      return valid ? responseJson(response, 200, fixture.planningTrace) : refuse(response);
    }
    if (pathname === `/api/operate/cycles/${DASHBOARD_FIXTURE_CYCLE_ID}`) {
      const valid = request.method === 'GET' && actorIsBound(request) && operateRootQuery(url);
      return valid ? responseJson(response, 200, fixture.cycle) : refuse(response);
    }
    if (
      pathname ===
      `/api/operate/cycles/${DASHBOARD_FIXTURE_CYCLE_ID}/reviews/${DASHBOARD_FIXTURE_REVIEW_ID}`
    ) {
      const valid = request.method === 'GET' && actorIsBound(request) && operateRootQuery(url);
      const scenario = disposableReviewScenario(request);
      const review = scenario?.state.terminal?.workspace ?? fixture.review;
      return valid ? responseJson(response, 200, review) : refuse(response);
    }
    if (pathname === '/api/operate/today' || pathname === '/api/operate/cycles') {
      const valid = request.method === 'GET' && actorIsBound(request) && operateRootQuery(url);
      const value = pathname.endsWith('/today') ? fixture.today : fixture.cycles;
      return valid ? responseJson(response, 200, value) : refuse(response);
    }
    if (pathname === '/api/operate/actions') {
      const valid =
        request.method === 'GET' && actorIsBound(request) && boundCollectionQuery(url, true);
      return valid ? responseJson(response, 200, fixture.actions) : refuse(response);
    }
    if (pathname === `/api/operate/actions/${DASHBOARD_FIXTURE_ACTION_ID}`) {
      const valid = request.method === 'GET' && actorIsBound(request) && operateRootQuery(url);
      return valid ? responseJson(response, 200, fixture.action) : refuse(response);
    }
    if (pathname === '/api/operate/inbox') {
      const valid =
        request.method === 'GET' && actorIsBound(request) && boundCollectionQuery(url, false);
      return valid ? responseJson(response, 200, fixture.inbox) : refuse(response);
    }
    if (pathname === '/api/operate/inbox/verification%3Aasg_reminder_delivery_0001') {
      const valid =
        request.method === 'GET' && actorIsBound(request) && boundCollectionQuery(url, false);
      return valid ? responseJson(response, 200, fixture.inboxItem) : refuse(response);
    }
    if (pathname === '/api/operate/recovery') {
      const valid = request.method === 'GET' && actorIsBound(request) && operateRootQuery(url);
      return valid ? responseJson(response, 200, fixture.recovery) : refuse(response);
    }
    if (
      pathname === '/api/operate/evidence' ||
      pathname === '/api/operate/outcomes' ||
      pathname === '/api/operate/history'
    ) {
      const valid = request.method === 'GET' && actorIsBound(request) && auditQuery(url);
      const value = pathname.endsWith('/evidence')
        ? fixture.evidence
        : pathname.endsWith('/outcomes')
          ? fixture.outcomes
          : fixture.history;
      return valid ? responseJson(response, 200, value) : refuse(response);
    }
    if (pathname === '/api/operate/evidence/evref_reminder_delivery_0001') {
      const valid = request.method === 'GET' && actorIsBound(request) && auditQuery(url);
      return valid ? responseJson(response, 200, fixture.evidenceItem) : refuse(response);
    }
    if (pathname === '/api/operate/outcomes/out_reminder_delivery_0001') {
      const valid = request.method === 'GET' && actorIsBound(request) && auditQuery(url);
      return valid ? responseJson(response, 200, fixture.outcome) : refuse(response);
    }
    if (
      pathname === '/api/operate/session' ||
      pathname === '/api/operate/commands/preview' ||
      pathname === '/api/operate/commands/confirm'
    ) {
      return commandResponse(request, response, pathname);
    }
    return refuse(response, 404);
  } catch {
    return refuse(response);
  }
}

export function dashboardFixtureServerPlugin() {
  return {
    name: 'openplanr-dashboard-owner-fixture',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        void routeApi(request, response, next);
      });
      server.httpServer?.once('close', () => {
        for (const response of streams) response.end();
        streams.clear();
      });
    },
  };
}
