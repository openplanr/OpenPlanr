import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyOperatingReviewWorkDispositionsV2,
  closeVerifiedOperatingCycleV2,
} from '../../lib/operate/cycle-closure-v2.mjs';
import {
  buildOperatingTerminalVerificationAssignmentV2,
  deriveOperatingVerificationFeedbackV2,
} from '../../lib/operate/execution-verification-v2.mjs';
import { derivePersistentOperatingActionRevisionHashV2 } from '../../lib/operate/persistent-work-v2.mjs';
import {
  createEmptyOperatingRuntimeStateV2,
  readOperatingReviewV2,
  submitOperatingReviewV2,
  transitionOperatingActionLifecycleV2,
} from '../../lib/operate/runtime-foundation.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

const TIME = '2026-08-08T10:00:00.000Z';
const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
const clone = (value) => structuredClone(value);
const REVIEW_SUBMIT_CAPABILITY = Object.freeze({ id: 'operate-review-submit', version: '2.0.0' });

function canonicalVerifiedClosure() {
  const approved = clone(fixture('authorization-valid.json').action);
  approved.actionHash = derivePersistentOperatingActionRevisionHashV2(approved);
  approved.revisionId = `actrev_${sha256Jcs({
    actionId: approved.actionId,
    revision: approved.revision,
    actionHash: approved.actionHash,
  }).slice('sha256:'.length)}`;
  const queued = transitionOperatingActionLifecycleV2(approved, 'queued', {
    updatedAt: '2026-08-10T08:01:30Z',
  });
  const started = transitionOperatingActionLifecycleV2(queued, 'in_progress', {
    updatedAt: '2026-08-10T08:02:00Z',
  });
  const completed = transitionOperatingActionLifecycleV2(started, 'completed', {
    updatedAt: '2026-08-10T08:03:00Z',
  });
  const sourceCycle = {
    ...clone(fixture('all-contracts-valid.json')['operating-cycle']),
    cycleId: completed.sourceCycleId,
    scopeId: completed.scopeId,
    domainId: completed.domainId,
    domainVersion: completed.domainVersion,
    state: 'verifying',
    activeReviewId: null,
  };
  const verificationPlan = {
    kind: 'operating-action-verification-plan',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    verificationPlanId: completed.verificationPlanId,
    actionId: completed.actionId,
    scopeId: completed.scopeId,
    domainId: completed.domainId,
    domainVersion: completed.domainVersion,
    metricId: completed.metricId,
    baseline: completed.baseline,
    target: completed.target,
    window: completed.verificationWindow,
    method: 'Compare one accepted observation with the target.',
    observationRequest: { kind: 'future-observation', reason: completed.expectedResult },
    evaluationRules: ['succeeded: target reached.'],
    revisitDecisionIds: [completed.sourceDecisionId],
    sourceArtifactId: completed.sourceArtifactId,
    createdAt: completed.createdAt,
  };
  const contracts = fixture('governed-execution-contracts-valid.json');
  const result = {
    ...clone(contracts['operating-execution-result']),
    action: {
      actionId: completed.actionId,
      revision: completed.revision,
      actionHash: completed.actionHash,
    },
  };
  const operation = {
    ...clone(contracts['operating-governed-operation']),
    action: clone(result.action),
    state: result.status,
    resultId: result.resultId,
    updatedAt: result.completedAt,
  };
  delete operation.operationHash;
  operation.operationHash = sha256Jcs(operation);
  const assignment = buildOperatingTerminalVerificationAssignmentV2({
    action: completed,
    cycle: sourceCycle,
    operation,
    result,
    verificationPlan,
    timestamp: result.completedAt,
  });
  const records = fixture('action-verification-valid.json');
  const outcome = {
    ...clone(records.outcome),
    actionId: completed.actionId,
    scopeId: completed.scopeId,
    domainId: completed.domainId,
    domainVersion: completed.domainVersion,
    verificationPlanId: verificationPlan.verificationPlanId,
  };
  const learning = {
    ...clone(records.learning),
    outcomeId: outcome.outcomeId,
    scopeId: completed.scopeId,
    domainId: completed.domainId,
    domainVersion: completed.domainVersion,
  };
  const feedback = deriveOperatingVerificationFeedbackV2({
    action: completed,
    verificationPlan,
    executionStatus: 'success',
    sourceCycle,
    operation,
    result,
    verificationAssignments: [assignment],
    outcome,
    learning,
    cycle: sourceCycle,
  });
  return {
    action: completed,
    cycle: sourceCycle,
    verificationPlan,
    operation,
    result,
    assignment,
    feedback,
  };
}

function cycle() {
  return {
    kind: 'operating-cycle',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    cycleId: 'cyc_00000001',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    state: 'awaiting_review',
    inputBindingId: 'inb_00000001',
    contractVersions: { 'chair-result': '1.0.0' },
    trigger: { kind: 'manual' },
    focus: ['retention'],
    health: 'normal',
    activeReviewId: 'rev_00000001',
    createdAt: TIME,
    updatedAt: TIME,
  };
}

function review() {
  return {
    kind: 'operating-review',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    reviewId: 'rev_00000001',
    cycleId: 'cyc_00000001',
    ownerActorId: 'owner-001',
    state: 'pending',
    disposition: null,
    workDispositions: [],
    createdAt: TIME,
    updatedAt: TIME,
  };
}

function finding() {
  return {
    kind: 'operating-finding',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    origin: 'persistent-work',
    findingId: 'fnd_00000001',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    sourceCycleId: 'cyc_00000001',
    sourceArtifactId: 'art_00000001',
    title: 'Retention risk',
    statement: 'Retention is declining.',
    state: 'open',
    ownerActorId: 'owner-001',
    revisitAt: null,
    createdAt: TIME,
    updatedAt: TIME,
  };
}

function action() {
  return {
    kind: 'operating-action',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    actionId: 'act_00000001',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    sourceCycleId: 'cyc_00000001',
    sourceArtifactId: 'art_00000001',
    title: 'Interview customers',
    state: 'proposed',
    ownerActorId: 'owner-001',
    accountabilityDisposition: null,
    sourceDecisionId: null,
    sourceFindingIds: ['fnd_00000001'],
    dependsOnActionIds: [],
    objectiveId: 'obj_00000001',
    expectedResult: 'Customer interviews reveal retention friction.',
    metricId: 'met_00000001',
    baseline: 0.4,
    target: 0.6,
    verificationWindow: '30d',
    verificationPlanId: 'vfy_00000001',
    createdAt: TIME,
    updatedAt: TIME,
  };
}

function initialState() {
  const sourceAction = action();
  const sourcePlan = fixture('action-verification-valid.json').verificationPlan;
  const verificationPlan = {
    ...clone(sourcePlan),
    verificationPlanId: sourceAction.verificationPlanId,
    actionId: sourceAction.actionId,
    scopeId: sourceAction.scopeId,
    domainId: sourceAction.domainId,
    domainVersion: sourceAction.domainVersion,
    metricId: sourceAction.metricId,
    baseline: sourceAction.baseline,
    target: sourceAction.target,
    window: sourceAction.verificationWindow,
    sourceArtifactId: sourceAction.sourceArtifactId,
    createdAt: sourceAction.createdAt,
  };
  return {
    ...createEmptyOperatingRuntimeStateV2(TIME),
    cycles: [cycle()],
    reviews: [review()],
    findings: [finding()],
    actions: [sourceAction],
    verificationPlans: [verificationPlan],
  };
}

function reviewRequest() {
  const sourceCycle = cycle();
  return {
    reviewId: review().reviewId,
    cycleId: sourceCycle.cycleId,
    actor: { actorId: 'owner-001', kind: 'human', runtime: 'portable' },
    scope: {
      scopeId: sourceCycle.scopeId,
      domainId: sourceCycle.domainId,
      domainVersion: sourceCycle.domainVersion,
    },
  };
}

function readReview(initialState) {
  return readOperatingReviewV2(reviewRequest(), {
    initialState,
    capabilities: ['operate.review.get'],
    readAt: '2026-08-08T10:01:00.000Z',
  }).data;
}

function commitReview(initialState, submitArguments, eventId = 'evt-review-close-001') {
  return submitOperatingReviewV2(
    submitArguments,
    {
      eventId,
      timestamp: '2026-08-08T10:01:00.000Z',
      correlationId: 'corr-review-close-001',
    },
    {
      initialState,
      capabilities: [REVIEW_SUBMIT_CAPABILITY],
    },
  );
}

test('OP-02: an approved human Review atomically defers unresolved source work and closes the Cycle', () => {
  const before = initialState();
  const dispositions = [
    { entityType: 'operating-finding', entityId: 'fnd_00000001', disposition: 'deferred' },
    { entityType: 'operating-action', entityId: 'act_00000001', disposition: 'deferred' },
  ];
  const read = readReview(before);
  const choice = read.dispositionChoices.find(
    ({ submitArguments }) =>
      submitArguments.disposition === 'approved' &&
      submitArguments.workDispositions.length === dispositions.length &&
      submitArguments.workDispositions.every(({ disposition }) => disposition === 'deferred'),
  );
  assert.ok(choice, 'the owner read advertises the exact complete defer choice');
  const next = commitReview(before, choice.submitArguments).state;
  assert.equal(next.cycles[0].state, 'closed');
  assert.equal(next.cycles[0].closedAt, '2026-08-08T10:01:00.000Z');
  assert.equal(next.reviews[0].state, 'approved');
  assert.equal(next.reviews[0].workDispositions.length, 2);
  assert.equal(next.findings[0].state, 'deferred');
  assert.equal(next.actions[0].state, 'deferred');
  assert.deepEqual(
    before.findings,
    [finding()],
    'failed or successful reductions never mutate the source checkpoint',
  );
});

test('OP-02: an incomplete or invalid disposition blocks closure without exposing state changes', () => {
  const before = initialState();
  const read = readReview(before);
  const advertised = read.dispositionChoices.find(
    ({ submitArguments }) => submitArguments.disposition === 'approved',
  );
  const forged = {
    ...clone(advertised.submitArguments),
    workDispositions: [
      { entityType: 'operating-finding', entityId: 'fnd_00000001', disposition: 'deferred' },
    ],
  };
  assert.throws(
    () => commitReview(before, forged),
    (error) => error.code === 'STATE_TRANSITION_INVALID',
  );
  assert.equal(before.cycles[0].state, 'awaiting_review');
  assert.equal(before.findings[0].state, 'open');
  assert.equal(before.actions[0].state, 'proposed');
});

test('approved Review projection reuses exact closure transitions and rejects substitution', () => {
  const proposed = {
    decisionId: 'dec_00000001',
    sourceCycleId: cycle().cycleId,
    scopeId: cycle().scopeId,
    domainId: cycle().domainId,
    domainVersion: cycle().domainVersion,
    state: 'proposed',
    updatedAt: TIME,
  };
  const deferred = { ...proposed, decisionId: 'dec_00000002', state: 'deferred' };
  const projected = applyOperatingReviewWorkDispositionsV2({
    cycle: cycle(),
    findings: [],
    decisions: [proposed, deferred],
    actions: [],
    workDispositions: [
      { entityType: 'operating-decision', entityId: proposed.decisionId, disposition: 'approved' },
      { entityType: 'operating-decision', entityId: deferred.decisionId, disposition: 'deferred' },
    ],
    timestamp: '2026-08-08T10:01:00.000Z',
  });
  assert.equal(projected.decisions[0].state, 'approved');
  assert.deepEqual(projected.decisions[1], deferred);
  for (const workDispositions of [
    [{ entityType: 'operating-decision', entityId: 'dec_unknown', disposition: 'approved' }],
    [
      { entityType: 'operating-decision', entityId: proposed.decisionId, disposition: 'approved' },
      { entityType: 'operating-decision', entityId: proposed.decisionId, disposition: 'approved' },
    ],
  ]) {
    assert.throws(
      () =>
        applyOperatingReviewWorkDispositionsV2({
          cycle: cycle(),
          findings: [],
          decisions: [proposed],
          actions: [],
          workDispositions,
          timestamp: '2026-08-08T10:01:00.000Z',
        }),
      (error) => error.code === 'STATE_TRANSITION_INVALID',
    );
  }
  assert.throws(
    () =>
      applyOperatingReviewWorkDispositionsV2({
        cycle: cycle(),
        findings: [],
        decisions: [{ ...proposed, state: 'approved' }],
        actions: [],
        workDispositions: [
          {
            entityType: 'operating-decision',
            entityId: proposed.decisionId,
            disposition: 'approved',
          },
        ],
        timestamp: '2026-08-08T10:01:00.000Z',
      }),
    (error) => error.code === 'STATE_TRANSITION_INVALID',
  );
  assert.throws(
    () =>
      applyOperatingReviewWorkDispositionsV2({
        cycle: cycle(),
        findings: [],
        decisions: [{ ...proposed, sourceCycleId: 'cyc_foreign' }],
        actions: [],
        workDispositions: [
          {
            entityType: 'operating-decision',
            entityId: proposed.decisionId,
            disposition: 'approved',
          },
        ],
        timestamp: '2026-08-08T10:01:00.000Z',
      }),
    (error) => error.code === 'STATE_TRANSITION_INVALID',
  );
});

test('cancelled has no successful-close path', () => {
  const before = initialState();
  const read = readReview(before);
  const choice = read.dispositionChoices.find(
    ({ submitArguments }) => submitArguments.disposition === 'cancelled',
  );
  const next = commitReview(before, choice.submitArguments, 'evt-review-cancelled-001').state;
  assert.equal(next.reviews[0].state, 'cancelled');
  assert.equal(next.cycles[0].state, 'awaiting_review');
  assert.equal(next.cycles[0].closedAt, undefined);
});

test('verification closure carries blocked persistent Actions without rewriting their lifecycle', () => {
  const verifying = { ...cycle(), state: 'verifying', activeReviewId: null };
  const blocked = { ...action(), state: 'blocked' };
  const closed = closeVerifiedOperatingCycleV2({
    cycle: verifying,
    actions: [blocked],
    verificationPlans: [],
    governedOperations: [],
    executionResults: [],
    rollbackResults: [],
    verificationAssignments: [],
    verificationFeedback: [],
    carriedActionIds: [blocked.actionId],
    timestamp: '2026-08-08T10:02:00.000Z',
  });
  assert.equal(closed.cycle.state, 'closed');
  assert.equal(closed.actions[0].state, 'blocked');
  assert.deepEqual(closed.carriedActionIds, [blocked.actionId]);
});

test('verification closure requires one canonical Assignment independent of candidate order or objective text', () => {
  const value = canonicalVerifiedClosure();
  const input = {
    cycle: value.cycle,
    actions: [value.action],
    verificationPlans: [value.verificationPlan],
    governedOperations: [value.operation],
    executionResults: [value.result],
    rollbackResults: [],
    verificationAssignments: [value.assignment],
    verificationFeedback: [value.feedback],
    carriedActionIds: [],
    timestamp: '2026-08-10T08:04:00Z',
  };
  assert.equal(closeVerifiedOperatingCycleV2(input).cycle.state, 'closed');
  const forged = { ...clone(value.assignment), assignmentId: 'asg_vfy_forged_closure_0001' };
  for (const verificationAssignments of [
    [forged, value.assignment],
    [value.assignment, forged],
  ]) {
    assert.throws(
      () =>
        closeVerifiedOperatingCycleV2({
          ...input,
          verificationAssignments,
        }),
      (error) => error?.code === 'STATE_TRANSITION_INVALID',
    );
  }
  assert.throws(
    () =>
      closeVerifiedOperatingCycleV2({
        ...input,
        verificationAssignments: [
          { ...clone(value.assignment), objective: 'Contains no trustworthy ownership.' },
        ],
      }),
    (error) => error?.code === 'STATE_TRANSITION_INVALID',
  );
  assert.throws(
    () =>
      closeVerifiedOperatingCycleV2({
        ...input,
        verificationPlans: [{ ...value.verificationPlan, domainVersion: '9.9.9' }],
      }),
    (error) => error?.code === 'STATE_TRANSITION_INVALID',
  );
});
