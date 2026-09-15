import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { OPERATE_CONTRACT_CATALOG_V2 } from '../../lib/protocol/generated/contract-catalog-v2.mjs';
import { getOperateAuthorityArgumentCandidatesV2 } from '../../lib/operate/authorization-v2.mjs';
import { createOperatingActionReviewV2 } from '../../lib/operate/approvals-v2.mjs';
import {
  assertOperateAuthorizedV2,
  createEmptyOperatingRuntimeStateV2,
  deriveOperateAllowedActionsV2,
  evaluateOperateGuardV2,
  readOperatingReviewV2,
  reduceOperatingRuntimeEventsV2,
  submitOperatingReviewV2,
} from '../../lib/operate/runtime-foundation.mjs';

const TIME = '2026-08-08T08:00:00.000Z';
const NEXT_TIME = '2026-08-08T08:01:00.000Z';
const REVIEW_OWNER_ACTOR_ID = 'owner-001';
const REVIEW_SUBMIT_CAPABILITY = Object.freeze({ id: 'operate-review-submit', version: '2.0.0' });
const AUTHORIZATION = JSON.parse(readFileSync(new URL(
  '../../conformance/fixtures/operating-runtime-v2/authorization-valid.json', import.meta.url,
), 'utf8'));
const ALL = JSON.parse(readFileSync(new URL(
  '../../conformance/fixtures/operating-runtime-v2/all-contracts-valid.json', import.meta.url,
), 'utf8'));

function review() {
  return {
    kind: 'operating-review', schemaVersion: '1.0.0', protocolVersion: '2.0.0',
    reviewId: 'rev_00000001', cycleId: 'cyc_00000001', ownerActorId: REVIEW_OWNER_ACTOR_ID,
    state: 'pending', disposition: null, workDispositions: [], createdAt: TIME, updatedAt: TIME,
  };
}

function cycle() {
  return {
    kind: 'operating-cycle', schemaVersion: '1.0.0', protocolVersion: '2.0.0',
    cycleId: 'cyc_00000001', scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0',
    state: 'awaiting_review', inputBindingId: 'inb_00000001', contractVersions: { 'advisor-result': '1.0.0' },
    trigger: { kind: 'manual' }, focus: ['strategy'], health: 'normal', activeReviewId: 'rev_00000001',
    createdAt: TIME, updatedAt: TIME,
  };
}

function state() {
  return { ...createEmptyOperatingRuntimeStateV2(TIME), cycles: [cycle()], reviews: [review()] };
}

function stateWithReviewGaps() {
  const initialState = state();
  const ledger = structuredClone(ALL['operating-decision-ledger']);
  ledger.advisorAbsenceGaps = [{
    absenceId: 'abs_role_review_gap_001',
    kind: 'role',
    roleId: 'Growth Market / EU',
    roleKind: 'advisor',
    roleVersion: '2.0.0',
    absenceCode: 'result-unavailable',
    reason: 'The issued growth Advisor did not produce a validated result.',
    recoveryDisposition: 'Continue with qualified analysis.',
    sourceAssignmentId: 'asg_review_gap_role_001',
    sourceEventId: null,
  }];
  ledger.evidenceGaps = [{
    absenceId: 'abs_evidence_review_gap_001',
    kind: 'evidence',
    requirementId: 'channel-economics',
    evidenceKinds: ['operate-artifact'],
    sourceContracts: [{ id: 'channel-economics', version: '1.0.0' }],
    absenceCode: 'not-available',
    reason: 'No authorized channel-economics evidence was available.',
    recoveryDisposition: 'Request authorized evidence.',
    sourceEvidenceRefIds: [],
    sourceEventIds: [],
  }];
  const limitingGaps = ledger.questionCoverage.find(({ questionId }) => (
    questionId === 'synthesis-limiting-gaps'
  ));
  Object.assign(limitingGaps, {
    disposition: 'gap',
    answer: 'One role result and one required evidence source were unavailable.',
    absenceIds: [
      ledger.advisorAbsenceGaps[0].absenceId,
      ledger.evidenceGaps[0].absenceId,
    ],
    justification: null,
  });
  const sourceArtifact = {
    ...structuredClone(ALL['operating-artifact']),
    artifactId: ledger.sourceArtifactId,
    artifactType: 'chair-result',
    assignmentId: ledger.assignmentId,
    schemaId: 'operating-decision-ledger',
    artifactSchemaVersion: '2.0.0',
    producer: { actorId: 'chair-agent-001', roleId: 'chair', runtime: 'portable' },
  };
  return { ...initialState, artifacts: [sourceArtifact], decisionLedgers: [ledger] };
}

function multilineText(length) {
  assert.ok(length >= 3);
  return `D\n${'D'.repeat(length - 2)}`;
}

function stateWithReviewDissent(statement) {
  const initialState = stateWithReviewGaps();
  initialState.decisionLedgers[0].dissent = [{
    sourceArtifactId: 'art_challenger_fixture_001',
    localDissentId: 'dissent:asg_challenger_fixture_001:1',
    findingIds: ['finding:asg_challenger_fixture_001:1'],
    statement,
    evidenceRefIds: [],
    resolutionCondition: 'Resolve the linked finding before adopting the recommendation.',
  }];
  return initialState;
}

function context({ actor, capabilities, reviewRequest, reviewReadRequest } = {}) {
  const scope = { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' };
  return {
    actor,
    capabilities,
    cycle: cycle(),
    review: review(),
    scope,
    ...(reviewRequest === undefined ? {} : { reviewRequest }),
    ...(reviewReadRequest === undefined ? {} : { reviewReadRequest }),
  };
}

function ownerRequest(actorId = 'owner-001') {
  return {
    reviewId: 'rev_00000001',
    cycleId: 'cyc_00000001',
    actor: { actorId, kind: 'human', runtime: 'portable' },
    scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
  };
}

function assertOwnerOpaqueRefusal(value, expectedContext) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(REVIEW_OWNER_ACTOR_ID), false, 'the immutable owner identity stays private');
  assert.deepEqual(value.context, expectedContext);
  assert.equal(Object.hasOwn(value.context, 'ownerActorId'), false);
  assert.equal(Object.hasOwn(value.context, 'review'), false, 'the refusal returns no Review content');
}

test('OP-09: only the exact human owner can read target-bound Review choices', () => {
  const advisor = context({
    actor: { actorId: 'advisor-001', kind: 'agent', runtime: 'portable' },
    capabilities: ['operate.review.get', REVIEW_SUBMIT_CAPABILITY],
  });
  assert.deepEqual(deriveOperateAllowedActionsV2(advisor), []);
  assert.equal(evaluateOperateGuardV2('operate.review.get', advisor).error.code, 'RESULT_CONTRACT_INVALID');
  assert.equal(evaluateOperateGuardV2('operate.review.submit', advisor).error.code, 'REVIEW_NOT_AUTHORIZED');

  const request = ownerRequest();
  const owner = context({
    actor: request.actor,
    capabilities: ['operate.review.get', REVIEW_SUBMIT_CAPABILITY],
    reviewReadRequest: request,
  });
  const actions = deriveOperateAllowedActionsV2(owner);
  assert.deepEqual(actions.map(({ tool }) => tool), ['operate.review.get']);
  assert.deepEqual(getOperateAuthorityArgumentCandidatesV2('operate.review.submit', owner), []);

  const read = readOperatingReviewV2(request, {
    initialState: state(), capabilities: ['operate.review.get'], readAt: NEXT_TIME,
  });
  assert.deepEqual(read.data.dispositionChoices.map(({ submitArguments }) => submitArguments.disposition), [
    'approved', 'changes_requested', 'rejected', 'cancelled',
  ]);
  assert.deepEqual(read.allowedActions.map(({ arguments: args }) => args),
    read.data.dispositionChoices.map(({ submitArguments }) => submitArguments));

  assert.throws(() => readOperatingReviewV2(ownerRequest('other-owner'), {
    initialState: state(), capabilities: ['operate.review.get'], readAt: NEXT_TIME,
  }), (error) => {
    assert.equal(error.code, 'REVIEW_NOT_AUTHORIZED');
    const publicError = error.toJSON();
    assert.equal(Object.hasOwn(publicError, 'stack'), false, 'public serialization is stack-free');
    assert.equal(publicError.details.retryable, false);
    assertOwnerOpaqueRefusal(publicError.details, {
      reviewId: 'rev_00000001', state: 'actor.actorId',
    });
    return true;
  });
});

test('foreign Review readers and submitters receive owner-opaque refusals without Review content or mutation', () => {
  const foreignRead = ownerRequest('foreign-owner-001');
  const readGuard = evaluateOperateGuardV2('operate.review.get', context({
    actor: foreignRead.actor,
    capabilities: ['operate.review.get'],
    reviewReadRequest: foreignRead,
  }));
  assert.equal(readGuard.error.code, 'REVIEW_NOT_AUTHORIZED');
  assertOwnerOpaqueRefusal(readGuard.error, {
    reviewId: 'rev_00000001',
    state: 'actor.actorId',
  });

  const foreignSubmit = {
    ...foreignRead,
    disposition: 'approved',
    workDispositions: [],
  };
  const submitGuard = evaluateOperateGuardV2('operate.review.submit', context({
    actor: foreignSubmit.actor,
    capabilities: [REVIEW_SUBMIT_CAPABILITY],
    reviewRequest: foreignSubmit,
  }));
  assert.equal(submitGuard.error.code, 'REVIEW_NOT_AUTHORIZED');
  assertOwnerOpaqueRefusal(submitGuard.error, {
    operation: 'operate.review.submit',
    reviewId: 'rev_00000001',
    state: 'actor.actorId',
  });

  const initialState = state();
  const before = structuredClone(initialState);
  assert.throws(() => submitOperatingReviewV2(foreignSubmit, {
    eventId: 'evt_foreign_review_submit_001',
    timestamp: NEXT_TIME,
    correlationId: 'corr_foreign_review_submit_001',
  }, {
    initialState,
    capabilities: [REVIEW_SUBMIT_CAPABILITY],
  }), (error) => {
    assert.equal(error.code, 'REVIEW_NOT_AUTHORIZED');
    assert.equal(error.toJSON().details.retryable, false);
    assertOwnerOpaqueRefusal(error.toJSON().details, {
      reviewId: 'rev_00000001', state: 'actor.actorId',
    });
    return true;
  });
  assert.deepEqual(initialState, before, 'foreign refusal leaves Review and Cycle state unchanged');
});

test('Review read, receipt, and exact replay preserve useful typed gap identities without private source details', () => {
  const initialState = stateWithReviewGaps();
  const exactLedger = structuredClone(initialState.decisionLedgers[0]);
  const read = readOperatingReviewV2(ownerRequest(), {
    initialState, capabilities: ['operate.review.get'], readAt: NEXT_TIME,
  });
  const expectedGaps = [
    {
      absenceId: 'abs_role_review_gap_001',
      kind: 'role',
      roleId: 'Growth Market / EU',
      roleKind: 'advisor',
      roleVersion: '2.0.0',
      sourceAssignmentId: 'asg_review_gap_role_001',
      reason: 'The issued growth Advisor did not produce a validated result.',
      recoveryDisposition: 'Continue with qualified analysis.',
    },
    {
      absenceId: 'abs_evidence_review_gap_001',
      kind: 'evidence',
      requirementId: 'channel-economics',
      sourceContracts: [{ id: 'channel-economics', version: '1.0.0' }],
      reason: 'No authorized channel-economics evidence was available.',
      recoveryDisposition: 'Request authorized evidence.',
    },
  ];
  assert.deepEqual(read.data.gaps, expectedGaps);
  assert.deepEqual(initialState.decisionLedgers[0], exactLedger, 'the source ledger bytes remain unchanged');
  assert.equal(JSON.stringify(read.data.gaps).includes('.planr/operate'), false);
  assert.equal(Object.hasOwn(read.data.gaps[0], 'sourceEventId'), false);
  assert.equal(Object.hasOwn(read.data.gaps[1], 'sourceEventIds'), false);

  const request = read.data.dispositionChoices.find(({ submitArguments }) => (
    submitArguments.disposition === 'changes_requested'
  )).submitArguments;
  const draft = {
    eventId: 'evt_review_gap_receipt_001',
    timestamp: NEXT_TIME,
    correlationId: 'corr_review_gap_receipt_001',
  };
  const committed = submitOperatingReviewV2(request, draft, {
    initialState, capabilities: [REVIEW_SUBMIT_CAPABILITY],
  });
  assert.deepEqual(committed.response.data.gaps, expectedGaps);
  assert.equal(committed.response.data.summary.gapCount, expectedGaps.length);
  const replayed = submitOperatingReviewV2(request, draft, {
    initialState: committed.state, capabilities: [REVIEW_SUBMIT_CAPABILITY],
  });
  assert.equal(replayed.replayed, true);
  assert.deepEqual(replayed.response.data, committed.response.data);
});

test('Review read and receipt preserve exact multiline 513 and 4096 character dissent', () => {
  for (const length of [513, 4096]) {
    const statement = multilineText(length);
    const initialState = stateWithReviewDissent(statement);
    const read = readOperatingReviewV2(ownerRequest(), {
      initialState, capabilities: ['operate.review.get'], readAt: NEXT_TIME,
    });
    assert.equal(read.data.dissent[0].statement, statement);
    assert.equal(read.data.dissent[0].statement.length, length);

    const request = read.data.dispositionChoices.find(({ submitArguments }) => (
      submitArguments.disposition === 'changes_requested'
    )).submitArguments;
    const committed = submitOperatingReviewV2(request, {
      eventId: `evt_review_multiline_dissent_${length}`,
      timestamp: NEXT_TIME,
      correlationId: `corr_review_multiline_dissent_${length}`,
    }, {
      initialState, capabilities: [REVIEW_SUBMIT_CAPABILITY],
    });
    assert.equal(committed.response.data.dissent[0].statement, statement);
  }
});

test('OP-09: every advertised pending disposition commits atomically and exact retry returns its receipt', () => {
  assert.equal(OPERATE_CONTRACT_CATALOG_V2.operations.some(({ id }) => id.includes('finalize')), false);
  assert.deepEqual(
    OPERATE_CONTRACT_CATALOG_V2.operations.filter(({ id }) => id.startsWith('operate.action.')).map(({ id }) => id),
    ['operate.action.approve', 'operate.action.execute', 'operate.action.rollback'],
    'governed Action tools join the same compiler-owned guard table only in Phase 6',
  );

  for (const disposition of ['approved', 'changes_requested', 'rejected', 'cancelled']) {
    const initialState = state();
    const read = readOperatingReviewV2(ownerRequest(), {
      initialState, capabilities: ['operate.review.get'], readAt: NEXT_TIME,
    });
    const request = read.data.dispositionChoices.find((choice) => (
      choice.submitArguments.disposition === disposition
    )).submitArguments;
    const draft = {
      eventId: `evt-review-${disposition}`,
      timestamp: NEXT_TIME,
      correlationId: `corr-review-${disposition}`,
    };
    const committed = submitOperatingReviewV2(request, draft, {
      initialState, capabilities: [REVIEW_SUBMIT_CAPABILITY],
    });
    const next = committed.state;
    assert.equal(next.reviews[0].state, disposition, disposition);
    assert.equal(next.reviews[0].disposition, disposition, disposition);
    assert.equal(next.cycles[0].activeReviewId, null, disposition);
    if (disposition === 'approved') {
      assert.equal(next.cycles[0].state, 'closed');
      assert.equal(next.cycles[0].closedAt, NEXT_TIME);
    } else {
      assert.equal(next.cycles[0].state, 'awaiting_review');
    }
    assert.deepEqual(committed.response.data.appliedWorkDispositions, request.workDispositions);
    assert.equal(committed.response.data.actor.actorId, 'owner-001');
    assert.deepEqual(committed.response.data.readEventHead, read.data.eventHead);
    assert.deepEqual(committed.response.data.dispositionChoices, read.data.dispositionChoices);
    assert.deepEqual(committed.response.data.seatStatus, read.data.seatStatus);
    assert.deepEqual(committed.response.data.decisions, read.data.decisions);
    assert.deepEqual(committed.response.data.actions, read.data.actions);
    assert.deepEqual(committed.response.data.findings, read.data.findings);
    assert.deepEqual(committed.response.data.dissent, read.data.dissent);
    assert.deepEqual(committed.response.data.gaps, read.data.gaps);
    const applied = read.data.dispositionChoices.find(({ submitArguments }) => (
      submitArguments.disposition === disposition
    ));
    assert.equal(committed.response.data.appliedChoiceId, applied.choiceId);
    assert.equal(committed.response.data.appliedChoiceHash, applied.choiceHash);
    const replayEntry = next.eventReplayIndex.find(({ eventId }) => eventId === draft.eventId);
    assert.deepEqual(replayEntry.receiptProjection, {
      read: read.data,
      appliedChoiceId: applied.choiceId,
      appliedChoiceHash: applied.choiceHash,
    });
    const replayed = submitOperatingReviewV2(request, draft, {
      initialState: next, capabilities: [REVIEW_SUBMIT_CAPABILITY],
    });
    assert.equal(replayed.replayed, true);
    assert.deepEqual(replayed.events, []);
    assert.deepEqual(replayed.response.data, committed.response.data);
  }
});

test('OP-09: terminal or detached Reviews have no successful submit action', () => {
  const terminal = review();
  terminal.state = 'cancelled';
  terminal.disposition = 'cancelled';
  const terminalResult = evaluateOperateGuardV2('operate.review.submit', {
    actor: { actorId: 'owner-001', kind: 'human', runtime: 'portable' },
    capabilities: [REVIEW_SUBMIT_CAPABILITY],
    review: terminal,
    cycle: { ...cycle(), activeReviewId: terminal.reviewId },
    scope: ownerRequest().scope,
    reviewRequest: { ...ownerRequest(), disposition: 'approved', workDispositions: [] },
  });
  assert.equal(terminalResult.allowed, false);
  assert.equal(terminalResult.error.code, 'REVIEW_NOT_PENDING');

  const detachedResult = evaluateOperateGuardV2('operate.review.submit', {
    actor: { actorId: 'owner-001', kind: 'human', runtime: 'portable' },
    capabilities: [REVIEW_SUBMIT_CAPABILITY],
    review: review(),
    cycle: { ...cycle(), activeReviewId: null },
    scope: ownerRequest().scope,
    reviewRequest: { ...ownerRequest(), disposition: 'approved', workDispositions: [] },
  });
  assert.equal(detachedResult.allowed, false);
  assert.equal(detachedResult.error.code, 'REVIEW_NOT_FOUND');
});

test('Action-scoped review authority is exact and does not borrow the Cycle review gate', () => {
  const action = structuredClone(AUTHORIZATION.action);
  action.state = 'proposed';
  const actionReview = createOperatingActionReviewV2({
    reviewId: 'rev_action0001', action, ownerActorId: 'owner-0001', timestamp: TIME,
  });
  const detachedCycle = {
    ...cycle(), domainId: action.domainId, domainVersion: action.domainVersion,
    scopeId: action.scopeId, activeReviewId: null, state: 'advising',
  };
  const actionContext = {
    actor: { actorId: 'owner-0001', kind: 'human', runtime: 'portable' },
    capabilities: [REVIEW_SUBMIT_CAPABILITY],
    review: actionReview,
    cycle: detachedCycle,
    action,
    scope: { scopeId: action.scopeId, domainId: action.domainId, domainVersion: action.domainVersion },
    reviewRequest: {
      reviewId: actionReview.reviewId,
      cycleId: actionReview.cycleId,
      actor: { actorId: 'owner-0001', kind: 'human', runtime: 'portable' },
      scope: { scopeId: action.scopeId, domainId: action.domainId, domainVersion: action.domainVersion },
      disposition: 'approved',
      workDispositions: [],
    },
  };
  assert.equal(assertOperateAuthorizedV2('operate.review.submit', actionContext).allowed, true);
  const copied = structuredClone(actionContext);
  copied.action.actionHash = `sha256:${'f'.repeat(64)}`;
  assert.equal(evaluateOperateGuardV2('operate.review.submit', copied).error.code, 'ACTION_REVISION_MISMATCH');
});

test('approved Action Review advances an awaiting contained-execution Cycle without approving the Action', () => {
  const action = structuredClone(AUTHORIZATION.action);
  action.state = 'proposed';
  const actionReview = createOperatingActionReviewV2({
    reviewId: 'rev_action_gate_0001',
    action,
    ownerActorId: 'owner-0001',
    timestamp: TIME,
  });
  const awaitingCycle = {
    ...cycle(),
    cycleId: action.sourceCycleId,
    scopeId: action.scopeId,
    domainId: action.domainId,
    domainVersion: action.domainVersion,
    activeReviewId: null,
    state: 'awaiting_review',
  };
  const initialState = {
    ...createEmptyOperatingRuntimeStateV2(TIME),
    cycles: [awaitingCycle],
    actions: [action],
    reviews: [actionReview],
    verificationPlans: [{
      ...structuredClone(ALL['operating-action-verification-plan']),
      verificationPlanId: action.verificationPlanId,
      actionId: action.actionId,
      scopeId: action.scopeId,
      domainId: action.domainId,
      domainVersion: action.domainVersion,
      metricId: action.metricId,
      baseline: action.baseline,
      target: action.target,
      window: action.verificationWindow,
    }],
  };
  const actor = { actorId: 'owner-0001', kind: 'human', runtime: 'portable' };
  const read = readOperatingReviewV2({
    reviewId: actionReview.reviewId,
    cycleId: awaitingCycle.cycleId,
    actor,
    scope: {
      scopeId: action.scopeId,
      domainId: action.domainId,
      domainVersion: action.domainVersion,
    },
  }, {
    initialState,
    capabilities: ['operate.review.get'],
    readAt: NEXT_TIME,
  });
  const request = read.data.dispositionChoices.find(({ submitArguments }) => (
    submitArguments.disposition === 'approved'
  )).submitArguments;
  assert.deepEqual(request.workDispositions, []);

  for (const disposition of ['changes_requested', 'rejected', 'cancelled']) {
    const alternative = read.data.dispositionChoices.find(({ submitArguments }) => (
      submitArguments.disposition === disposition
    )).submitArguments;
    const refused = submitOperatingReviewV2(alternative, {
      eventId: `evt_action_review_${disposition}`,
      timestamp: NEXT_TIME,
      correlationId: `corr_action_review_${disposition}`,
    }, {
      initialState,
      capabilities: [REVIEW_SUBMIT_CAPABILITY],
    });
    assert.equal(refused.state.cycles[0].state, 'awaiting_review', disposition);
    assert.equal(refused.state.actions[0].state, 'proposed', disposition);
  }

  const cycleReview = {
    ...review(),
    reviewId: 'rev_cycle_gate_0001',
    cycleId: awaitingCycle.cycleId,
    ownerActorId: 'cycle-owner-0001',
  };
  const cycleGatedState = {
    ...structuredClone(initialState),
    cycles: [{ ...awaitingCycle, activeReviewId: cycleReview.reviewId }],
    reviews: [actionReview, cycleReview],
  };
  const gated = submitOperatingReviewV2(request, {
    eventId: 'evt_action_review_cycle_gated_0001',
    timestamp: NEXT_TIME,
    correlationId: 'corr_action_review_cycle_gated_0001',
  }, {
    initialState: cycleGatedState,
    capabilities: [REVIEW_SUBMIT_CAPABILITY],
  });
  assert.equal(gated.state.cycles[0].state, 'awaiting_review');
  assert.equal(gated.state.cycles[0].activeReviewId, cycleReview.reviewId);
  assert.equal(gated.state.actions[0].state, 'proposed');

  const draft = {
    eventId: 'evt_action_review_gate_0001',
    timestamp: NEXT_TIME,
    correlationId: 'corr_action_review_gate_0001',
  };
  const committed = submitOperatingReviewV2(request, draft, {
    initialState,
    capabilities: [REVIEW_SUBMIT_CAPABILITY],
  });
  assert.equal(committed.state.reviews[0].state, 'approved');
  assert.equal(committed.state.cycles[0].state, 'approved');
  assert.equal(committed.state.cycles[0].activeReviewId, null);
  assert.equal(committed.state.cycles[0].updatedAt, NEXT_TIME);
  assert.equal(committed.state.actions[0].state, 'proposed');
  assert.equal(committed.events.length, 1);
  assert.equal(committed.events[0].type, 'review.submitted');

  const restarted = reduceOperatingRuntimeEventsV2(committed.events, { initialState });
  assert.equal(restarted.cycles[0].state, 'approved');
  assert.equal(restarted.actions[0].state, 'proposed');
  assert.deepEqual(restarted.eventHead, committed.state.eventHead);

  const replayed = submitOperatingReviewV2(request, draft, {
    initialState: committed.state,
    capabilities: [REVIEW_SUBMIT_CAPABILITY],
  });
  assert.equal(replayed.replayed, true);
  assert.deepEqual(replayed.events, []);
  assert.equal(replayed.state.cycles[0].state, 'approved');
  assert.equal(replayed.state.actions[0].state, 'proposed');
  assert.deepEqual(replayed.response.data, committed.response.data);
});
