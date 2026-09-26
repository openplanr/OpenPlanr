import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sha256Jcs } from '@openplanr/protocol/canonical-json';

import {
  createOperatingApprovalRecordV2,
  createOperatingApprovalRequirementV2,
} from '../lib/operate/approvals-v2.mjs';
import {
  buildOperateExperienceViewV2,
  createOperateExperienceReplayCheckpointV2,
} from '../lib/operate/experience-projection-v2.mjs';
import { derivePersistentOperatingActionRevisionHashV2 } from '../lib/operate/persistent-work-v2.mjs';
import { createOperatingDeliveryRouteV1 } from '../lib/operate/planning-bridge-v2.mjs';
import {
  createOperatingActionPolicyV2,
  evaluateOperatingActionPolicyV2,
} from '../lib/operate/policy-v2.mjs';
import {
  createEmptyOperatingRuntimeStateV2,
  createOperatingRuntimeEventV2,
  reduceOperatingRuntimeEventsV2,
} from '../lib/operate/runtime-foundation.mjs';

const SCOPE = Object.freeze({
  scopeId: 'scope-acme',
  domainId: 'software',
  domainVersion: '1.0.0',
});
const CYCLE_ID = 'cyc_00000001';
const CREATED = '2026-08-10T08:00:00Z';
const APPROVED_AT = '2026-08-10T08:01:00Z';
const DISPOSED_AT = '2026-08-10T08:02:00Z';
const LATER = '2026-08-10T08:03:00Z';
const ENGINE = Object.freeze({ kind: 'engine', id: 'openplanr' });
const OWNER = Object.freeze({ kind: 'human', id: 'owner-0001' });

function governedAction() {
  const action = {
    kind: 'operating-action',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    actionId: 'act_00000001',
    revisionId: 'actrev_00000001',
    revision: 1,
    predecessorRevisionId: null,
    actionHash: null,
    ...SCOPE,
    sourceCycleId: CYCLE_ID,
    sourceArtifactId: 'art_00000002',
    title: 'Apply one bounded project record change',
    state: 'proposed',
    actionKind: { id: 'software-operating-hypothesis', version: '1.0.0' },
    requestedCapability: { id: 'bounded-project-write', version: '1.0.0' },
    targetBinding: { kind: 'project-record', id: 'record-0001', revision: 'rev-0001' },
    effectClass: 'project-write',
    preconditionArtifactIds: ['art_00000002'],
    executionBinding: {
      policyId: 'bounded-project-write-policy',
      policyVersion: '1.0.0',
      rollbackRequired: true,
      verificationRequired: true,
    },
    ownerActorId: OWNER.id,
    accountabilityDisposition: null,
    sourceDecisionId: 'dec_00000001',
    sourceFindingIds: ['fnd_00000001'],
    dependsOnActionIds: [],
    objectiveId: 'obj_00000001',
    expectedResult: 'The exact reviewed project record changes once.',
    metricId: 'met_00000001',
    baseline: 0,
    target: 1,
    verificationWindow: 'immediate',
    verificationPlanId: 'vfy_00000001',
    createdAt: CREATED,
    updatedAt: CREATED,
  };
  action.actionHash = derivePersistentOperatingActionRevisionHashV2(action);
  action.revisionId = `actrev_${sha256Jcs({
    actionId: action.actionId,
    revision: action.revision,
    actionHash: action.actionHash,
  }).slice('sha256:'.length)}`;
  return action;
}

function cycle(state) {
  return {
    kind: 'operating-cycle',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    cycleId: CYCLE_ID,
    ...SCOPE,
    state,
    inputBindingId: 'inb_00000001',
    contractVersions: { 'advisor-result': '1.0.0' },
    trigger: { kind: 'manual' },
    focus: ['strategy'],
    health: 'normal',
    activeReviewId: null,
    createdAt: CREATED,
    updatedAt: CREATED,
  };
}

const ACTION = governedAction();
const ACTION_REF = Object.freeze({
  actionId: ACTION.actionId,
  revision: ACTION.revision,
  actionHash: ACTION.actionHash,
});

function policy(overrides) {
  return createOperatingActionPolicyV2({
    domainId: SCOPE.domainId,
    actionKind: ACTION.actionKind,
    capability: ACTION.requestedCapability,
    effectClasses: [ACTION.effectClass],
    targetKinds: [ACTION.targetBinding.kind],
    rollbackRequired: true,
    verificationRequired: true,
    policyVersion: '1.0.0',
    ...overrides,
  });
}

const POLICIES = [
  policy({
    policyId: 'core-runtime-policy',
    decisionMode: 'automatic',
    approvalRequirementIds: [],
    tier: 'core',
    provenance: {
      providerId: 'core-policy-provider',
      providerVersion: '1.0.0',
      sourceHash: `sha256:${'c'.repeat(64)}`,
    },
  }),
  policy({
    policyId: ACTION.executionBinding.policyId,
    decisionMode: 'named-single-party',
    approvalRequirementIds: ['aprq_replay01'],
    tier: 'domain',
    provenance: {
      providerId: 'bounded-policy-provider',
      providerVersion: '1.0.0',
      sourceHash: `sha256:${'d'.repeat(64)}`,
    },
  }),
];
const EVALUATION = evaluateOperatingActionPolicyV2({
  action: ACTION,
  configuredPolicies: POLICIES,
  evaluatedAt: CREATED,
});
const PARTY = Object.freeze({
  partyId: 'owner-party',
  actorKind: 'human',
  actorId: OWNER.id,
  requiredCapability: { id: 'action-approve', version: '1.0.0' },
});
const REQUIREMENT = createOperatingApprovalRequirementV2({
  policyRequirementId: 'aprq_replay01',
  evaluation: EVALUATION,
  action: ACTION,
  parties: [PARTY],
  expiresAt: '2026-08-11T08:00:00Z',
  consumable: true,
});

function initialState({ cycleState = 'awaiting_review', actions = [ACTION] } = {}) {
  return {
    ...createEmptyOperatingRuntimeStateV2(CREATED, {
      actionPolicies: POLICIES,
      approvalRequirements: [REQUIREMENT],
    }),
    cycles: [cycle(cycleState)],
    actions: structuredClone(actions),
  };
}

/** An Event log reduced one Event at a time from a checkpoint. */
function eventLog(initial) {
  const log = { initial, state: initial, events: [] };
  log.next = (
    type,
    payload,
    {
      actor = ENGINE,
      timestamp = DISPOSED_AT,
      requestHash,
      entityId = type.startsWith('cycle.') ? CYCLE_ID : payload.action.actionId,
    } = {},
  ) =>
    createOperatingRuntimeEventV2(
      {
        eventId: `evt-replay-${String(log.state.eventHead.sequence + 1).padStart(3, '0')}`,
        timestamp,
        cycleId: CYCLE_ID,
        type,
        entityId,
        actor,
        causationId: log.events.at(-1)?.eventId ?? null,
        correlationId: 'corr-replay-001',
        ...(requestHash === undefined ? {} : { requestHash }),
        payload,
      },
      {
        previousEvent:
          log.state.eventHead.sequence === 0
            ? null
            : { sequence: log.state.eventHead.sequence, eventHash: log.state.eventHead.hash },
      },
    );
  log.reduce = (event) => reduceOperatingRuntimeEventsV2([event], { initialState: log.state });
  log.append = (type, payload, options) => {
    const event = log.next(type, payload, options);
    log.state = log.reduce(event);
    log.events.push(event);
    return log.state;
  };
  return log;
}

function recordApproval(log, decision) {
  log.append('policy.evaluated', EVALUATION, {
    entityId: EVALUATION.evaluationId,
    actor: { kind: 'runtime', id: 'openplanr' },
    timestamp: EVALUATION.evaluatedAt,
    requestHash: EVALUATION.inputHash,
  });
  const approval = createOperatingApprovalRecordV2({
    approvalId: `aprv_${decision}01`,
    requirement: REQUIREMENT,
    evaluation: EVALUATION,
    action: ACTION,
    partyId: PARTY.partyId,
    actor: { kind: 'human', actorId: OWNER.id, capability: PARTY.requiredCapability },
    decision,
    issuedAt: APPROVED_AT,
    expiresAt: REQUIREMENT.expiresAt,
  });
  log.append('approval.recorded', approval, {
    entityId: approval.approvalId,
    actor: OWNER,
    timestamp: approval.issuedAt,
  });
  return log;
}

function actionTransition(from, to, reasonCode = null) {
  return { action: { ...ACTION_REF }, from, to, operationId: null, resultId: null, reasonCode };
}

function cycleTransition(from, to, reasonCode = null, actionId = null) {
  return {
    cycleId: CYCLE_ID,
    from,
    to,
    actionId,
    operationId: null,
    resultId: null,
    reasonCode,
  };
}

function experienceView(log, state = log.state) {
  return buildOperateExperienceViewV2(state, {
    scope: SCOPE,
    actor: { actorId: OWNER.id, accessLevel: 'internal' },
    deliveryRoutes: log.state.actions.map((action) =>
      createOperatingDeliveryRouteV1({
        state: log.state,
        action,
        route: 'human-external',
        rationale: 'The owner decides outside the runtime.',
      }),
    ),
    events: log.events,
    checkpoint: createOperateExperienceReplayCheckpointV2(log.initial),
    checkpointState: log.initial,
  });
}

/** The experience projection accepts the log and rejects a state that drifted from it. */
function assertEventParity(log, drift) {
  const view = experienceView(log);
  assert.equal(view.replay.parityProof.checkpointVerified, true);
  assert.equal(view.replay.tail.eventCount, log.events.length);
  const drifted = structuredClone(log.state);
  drift(drifted);
  assert.throws(() => experienceView(log, drifted), { code: 'E_OPERATE_BINDING_MISMATCH' });
  return view;
}

for (const decision of ['rejected', 'deferred']) {
  test(`action.${decision} applies the complete ${decision} approval disposition`, () => {
    const log = recordApproval(eventLog(initialState()), decision);
    const other = decision === 'rejected' ? 'deferred' : 'rejected';

    assert.throws(
      () =>
        log.reduce(
          log.next(`action.${other}`, actionTransition('proposed', other, `approval-${other}`)),
        ),
      { code: 'APPROVAL_REQUIRED' },
    );
    assert.throws(
      () =>
        log.reduce(
          log.next(`action.${decision}`, actionTransition('proposed', decision, 'policy-deferred')),
        ),
      { code: 'APPROVAL_REQUIRED' },
    );
    assert.throws(
      () =>
        log.reduce(
          log.next(
            `action.${decision}`,
            actionTransition('proposed', decision, `approval-${decision}`),
            { actor: OWNER },
          ),
        ),
      { code: 'CAPABILITY_DENIED' },
    );

    const state = log.append(
      `action.${decision}`,
      actionTransition('proposed', decision, `approval-${decision}`),
    );
    assert.deepEqual(state.actions, [{ ...ACTION, state: decision, updatedAt: DISPOSED_AT }]);
    const view = assertEventParity(log, (drifted) => {
      drifted.actions[0].state = 'proposed';
    });
    assert.equal(view.actions[0].state, decision);
  });
}

test('action.reopened returns only a deferred Action to proposed', () => {
  const rejected = recordApproval(eventLog(initialState()), 'rejected');
  rejected.append('action.rejected', actionTransition('proposed', 'rejected', 'approval-rejected'));
  assert.throws(
    () =>
      rejected.reduce(rejected.next('action.reopened', actionTransition('deferred', 'proposed'))),
    { code: 'ACTION_REVISION_MISMATCH', message: /^Action reopening must bind/ },
  );

  const log = recordApproval(eventLog(initialState()), 'deferred');
  log.append('action.deferred', actionTransition('proposed', 'deferred', 'approval-deferred'));
  assert.throws(
    () =>
      log.reduce(
        log.next('action.reopened', {
          ...actionTransition('deferred', 'proposed'),
          action: { ...ACTION_REF, revision: 2 },
        }),
      ),
    { code: 'ACTION_REVISION_MISMATCH', message: /^Action reopening must bind/ },
  );
  assert.throws(
    () =>
      log.reduce(
        log.next('action.reopened', actionTransition('deferred', 'proposed'), {
          actor: { kind: 'runtime', id: 'openplanr' },
        }),
      ),
    { code: 'CAPABILITY_DENIED' },
  );

  const state = log.append('action.reopened', actionTransition('deferred', 'proposed'), {
    timestamp: LATER,
  });
  assert.deepEqual(state.actions, [{ ...ACTION, state: 'proposed', updatedAt: LATER }]);
  assertEventParity(log, (drifted) => {
    drifted.actions[0].state = 'deferred';
  });
});

test('action.cancelled withdraws an approved Action that has no operation', () => {
  const proposed = recordApproval(eventLog(initialState()), 'approved');
  assert.throws(
    () =>
      proposed.reduce(
        proposed.next('action.cancelled', actionTransition('approved', 'cancelled', 'withdrawn')),
      ),
    { code: 'ACTION_REVISION_MISMATCH', message: /^Action execution transition must bind/ },
  );

  const log = recordApproval(eventLog(initialState()), 'approved');
  log.append('action.approved', actionTransition('proposed', 'approved'));
  assert.throws(
    () =>
      log.reduce(
        log.next('action.cancelled', actionTransition('approved', 'cancelled', 'withdrawn'), {
          actor: OWNER,
        }),
      ),
    { code: 'ACTION_REVISION_MISMATCH', message: /^Action execution transition must bind/ },
  );

  const state = log.append(
    'action.cancelled',
    actionTransition('approved', 'cancelled', 'withdrawn'),
    { timestamp: LATER },
  );
  assert.deepEqual(state.actions, [{ ...ACTION, state: 'cancelled', updatedAt: LATER }]);
  assertEventParity(log, (drifted) => {
    drifted.actions[0].state = 'approved';
  });
});

test('cycle.approved moves an awaiting-review Cycle to approved under the governance engine', () => {
  const advising = eventLog(initialState({ cycleState: 'advising', actions: [] }));
  assert.throws(
    () =>
      advising.reduce(
        advising.next('cycle.approved', cycleTransition('awaiting_review', 'approved')),
      ),
    { code: 'STATE_TRANSITION_INVALID', message: /^Cycle lifecycle transition must bind/ },
  );

  const log = eventLog(initialState({ actions: [] }));
  assert.throws(
    () =>
      log.reduce(
        log.next('cycle.approved', cycleTransition('awaiting_review', 'approved'), {
          actor: OWNER,
        }),
      ),
    { code: 'STATE_TRANSITION_INVALID', message: /^Cycle lifecycle transition must bind/ },
  );

  const state = log.append('cycle.approved', cycleTransition('awaiting_review', 'approved'));
  assert.deepEqual(state.cycles, [{ ...cycle('approved'), updatedAt: DISPOSED_AT }]);
  const view = assertEventParity(log, (drifted) => {
    drifted.cycles[0].state = 'awaiting_review';
  });
  assert.equal(view.cycles[0].state, 'approved');
});

test('cycle.closed closes an approved Cycle that never executed', () => {
  const log = eventLog(initialState({ cycleState: 'approved', actions: [] }));
  assert.throws(
    () =>
      log.reduce(
        log.next(
          'cycle.closed',
          cycleTransition('verifying', 'closed', 'not-executed', ACTION.actionId),
        ),
      ),
    { code: 'STATE_TRANSITION_INVALID', message: /^Cycle lifecycle transition must bind/ },
  );
  assert.throws(
    () =>
      log.reduce(
        log.next('cycle.closed', cycleTransition('approved', 'closed', 'not-executed'), {
          actor: OWNER,
        }),
      ),
    { code: 'STATE_TRANSITION_INVALID', message: /^Cycle lifecycle transition must bind/ },
  );

  const state = log.append('cycle.closed', cycleTransition('approved', 'closed', 'not-executed'));
  assert.deepEqual(state.cycles, [
    { ...cycle('closed'), updatedAt: DISPOSED_AT, closedAt: DISPOSED_AT },
  ]);
  const view = assertEventParity(log, (drifted) => {
    drifted.cycles[0].updatedAt = LATER;
  });
  assert.equal(view.cycles[0].state, 'closed');
});
