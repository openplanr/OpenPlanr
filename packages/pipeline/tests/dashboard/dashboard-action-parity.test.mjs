import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { issueOperateActionDisplayWorkspaceV1 } from '../../lib/dashboard/operate-experience-display-contract.mjs';
import {
  buildOperateExperienceTransportView,
  selectOperateActionDisplayWorkspace,
  selectOperateActionWorkspace,
} from '../../lib/dashboard/operate-experience-reader.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import {
  assertOperateActionDisplayWorkspaceV1,
  validateOperateActionDisplayWorkspaceV1,
} from '../../schemas/v1.2.0/operate-action-display-workspace.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;

const emptyView = structuredClone(
  JSON.parse(
    readFileSync(
      join(root, 'conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json'),
      'utf8',
    ),
  ),
)['operate-experience-view'];

function historyEntry(overrides = {}) {
  return {
    eventId: 'event-1',
    sequence: 1,
    type: 'action.approved',
    entityId: 'act_00000001',
    actorKind: 'human',
    actorId: emptyView.actorId,
    timestamp: emptyView.generatedAt,
    correlationId: 'correlation-1',
    eventHash: emptyView.eventHead.hash,
    change: { subjectKind: 'action', summary: 'Action approved' },
    why: 'Named approval recorded.',
    authority: null,
    evidenceRefIds: [],
    prior: { previousEventHash: null, causationId: null },
    result: null,
    next: null,
    deepLinks: ['#/operate/actions/act_00000001'],
    beforeAfter: null,
    ...overrides,
  };
}

function actionFixture() {
  const actionId = 'act_00000001';
  const action = {
    actionId,
    revision: 1,
    actionHash: HASH_A,
    title: 'Measure retention',
    state: 'approved',
    ownerActorId: emptyView.actorId,
    expectedResult: 'Retention remains evidence-bound.',
    verificationPlanId: 'vfy_00000001',
    deliveryRoute: {
      kind: 'operating-delivery-route',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      routeId: 'droute_00000001',
      scopeId: emptyView.scopeId,
      domainId: emptyView.domainId,
      domainVersion: emptyView.domainVersion,
      action: { actionId, revision: 1, actionHash: HASH_A },
      eventHead: structuredClone(emptyView.eventHead),
      route: 'observe-only',
      rationale: 'The audit surface is read-only.',
      createdAt: emptyView.generatedAt,
      routeHash: HASH_B,
    },
    dependencyActionIds: [],
    executions: [],
    rollbacks: [],
    deepLink: `#/operate/actions/${encodeURIComponent(actionId)}`,
  };
  const outcome = {
    outcomeId: 'out_00000001',
    actionId,
    verificationPlanId: 'vfy_00000001',
    status: 'insufficient-evidence',
    metric: null,
    observationIds: [],
    evidenceRefIds: [],
    observedAt: emptyView.generatedAt,
    decision: null,
    execution: [],
    rollback: [],
    verification: null,
    nextObservation: null,
    revisit: null,
    snapshot: null,
    delta: null,
    accessReason: null,
    deepLink: '#/operate/outcomes/out_00000001',
  };
  const view = {
    ...structuredClone(emptyView),
    actions: [action],
    outcomes: [outcome],
    learnings: [],
    inbox: [],
    history: [historyEntry({ entityId: actionId, deepLinks: [action.deepLink] })],
    allowedActions: [
      {
        subjectId: actionId,
        action: {
          tool: 'operate.action.execute',
          arguments: {
            action: {
              actionId,
              revision: 1,
              actionHash: HASH_A,
            },
          },
          label: 'Execute approved Action',
          effect: 'project-write',
        },
      },
    ],
  };
  delete view.viewHash;
  view.viewHash = sha256Jcs(view);
  const transportView = buildOperateExperienceTransportView(view);
  const binding = {
    actorId: transportView.actorId,
    scopeId: transportView.scopeId,
    domainId: transportView.domainId,
    domainVersion: transportView.domainVersion,
    actionId,
    subjectId: actionId,
    generatedAt: transportView.generatedAt,
    eventHead: transportView.eventHead,
    viewHash: transportView.viewHash,
  };
  return { view: transportView, binding, actionId };
}

function rehashView(input) {
  const base = structuredClone(input.view);
  delete base.viewHash;
  const view = buildOperateExperienceTransportView({
    ...base,
    viewHash: sha256Jcs(base),
  });
  input.view = view;
  input.binding = { ...input.binding, viewHash: view.viewHash };
  return input;
}

test('action display workspace commits exact custody and rejects deep-link substitution', () => {
  const input = actionFixture();
  const display = selectOperateActionDisplayWorkspace(input.view, {
    binding: input.binding,
    subjectId: input.actionId,
  });
  assert.equal(display.kind, 'operate-action-display-workspace');
  assert.equal(display.payload.kind, 'operate-action-workspace');
  assert.equal(display.payload.data.action.actionId, input.actionId);
  assert.equal(display.payload.data.allowedActions.length, 1);
  assert.equal(display.payload.data.verification.status, 'unverified');
  assert.equal(assertOperateActionDisplayWorkspaceV1(display, input.binding), display);

  const hostile = structuredClone(display);
  hostile.payload.data.action.deepLink = '#/operate/actions/act_foreign';
  assert.throws(() => assertOperateActionDisplayWorkspaceV1(hostile, input.binding));
});

test('action commandability is owner-issued only for a ready Action with an exact command and gateway', () => {
  const input = actionFixture();
  const commandable = selectOperateActionDisplayWorkspace(input.view, {
    binding: input.binding,
    subjectId: input.actionId,
    commandsAvailable: true,
  });
  assert.equal(commandable.payload.readOnly, false);
  assert.equal(commandable.payload.mutationEnabled, true);
  assert.equal(assertOperateActionDisplayWorkspaceV1(commandable, input.binding), commandable);

  const unavailable = selectOperateActionDisplayWorkspace(input.view, {
    binding: input.binding,
    subjectId: input.actionId,
  });
  assert.equal(unavailable.payload.readOnly, true);
  assert.equal(unavailable.payload.mutationEnabled, false);

  const hostile = structuredClone(commandable);
  hostile.payload.mutationEnabled = false;
  assert.throws(() => assertOperateActionDisplayWorkspaceV1(hostile, input.binding));

  for (const payload of [
    { ...structuredClone(commandable.payload), status: 'read-only' },
    {
      ...structuredClone(commandable.payload),
      data: { ...structuredClone(commandable.payload.data), allowedActions: [] },
    },
    { ...structuredClone(commandable.payload), readOnly: true },
  ]) {
    assert.throws(() => issueOperateActionDisplayWorkspaceV1(payload));
  }
});

test('action workspace refuses foreign bindings and missing actions', () => {
  const input = actionFixture();
  const foreign = selectOperateActionWorkspace(input.view, {
    binding: { ...input.binding, scopeId: 'scope-foreign' },
    subjectId: input.actionId,
  });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.error.reasonCode, 'OPERATE_BINDING_MISMATCH');

  const missing = actionFixture();
  missing.view.actions = [];
  rehashView(missing);
  const stale = selectOperateActionWorkspace(missing.view, {
    binding: missing.binding,
    subjectId: missing.actionId,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.reasonCode, 'OPERATE_PROJECTION_STALE');
});

test('action display rejects post-owner integrity substitutions', () => {
  const input = actionFixture();
  const display = selectOperateActionDisplayWorkspace(input.view, {
    binding: input.binding,
    subjectId: input.actionId,
  });
  const mutations = [
    (candidate) => {
      candidate.payload.data.allowedActions.push({
        subjectId: 'act_foreign',
        action: display.payload.data.allowedActions[0].action,
      });
    },
    (candidate) => {
      candidate.integrity.sourceViewHash = `sha256:${'c'.repeat(64)}`;
    },
    (candidate) => {
      candidate.integrity.contentHash = `sha256:${'d'.repeat(64)}`;
    },
    (candidate) => {
      candidate.payload.scopeId = 'scope-foreign';
    },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(display);
    mutate(candidate);
    assert.equal(validateOperateActionDisplayWorkspaceV1(candidate, input.binding).length, 1);
    assert.throws(() => assertOperateActionDisplayWorkspaceV1(candidate, input.binding));
  }
});
