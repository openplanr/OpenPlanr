import assert from 'node:assert/strict';
import test from 'node:test';

import { runOperatingIntelligenceJourneyV2 } from '../../conformance/verify-operate-v2-operating-intelligence.mjs';
import {
  buildExistingOperatingExecutiveBoardCompatibilityV2,
  readOperatingExecutiveBoardV2,
} from '../../lib/operate/executive-board-compatibility-v2.mjs';
import {
  assertOperatingExecutiveBoardV2,
  buildOperatingExecutiveBoardRecordV2,
  createOperatingExecutiveBoardMaterializationV2,
} from '../../lib/operate/executive-board-materialization-v2.mjs';
import {
  createOperatingRuntimeEventV2,
  readOperatingReviewV2,
  reduceOperatingRuntimeEventsV2,
  submitOperatingReviewV2,
} from '../../lib/operate/runtime-foundation.mjs';
import { assertProtocolArtifact } from '../../lib/protocol/contracts.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

function clone(value) { return structuredClone(value); }
function without(value, field) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}

function rehashBoard(board) {
  const trace = without(without(without(board.traceMatrix, 'matrixId'), 'eventHead'), 'matrixHash');
  board.semanticHash = sha256Jcs({
    scopeId: board.scopeId,
    domainId: board.domainId,
    domainVersion: board.domainVersion,
    cycleId: board.cycleId,
    planId: board.planId,
    ledgerId: board.ledgerId,
    reviewId: board.reviewId,
    reviewHash: board.reviewHash,
    seatBindings: board.seatBindings,
    findingIds: board.findingIds,
    decisionIds: board.decisionIds,
    actionIds: board.actionIds,
    trace,
  });
  board.boardHash = sha256Jcs(without(board, 'boardHash'));
  return board;
}

const journey = runOperatingIntelligenceJourneyV2('business', {
  includeContext: true,
  stopAfterAction: true,
});

function oldReviewState() {
  const state = clone(journey.context.state);
  const cycle = state.cycles.find(({ cycleId }) => cycleId === journey.cycleId);
  const review = {
    kind: 'operating-review',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    reviewId: 'rev_executive_board_compat_001',
    cycleId: cycle.cycleId,
    subject: { type: 'cycle', cycleId: cycle.cycleId },
    ownerActorId: 'owner-phase5-business',
    state: 'pending',
    disposition: null,
    workDispositions: [],
    createdAt: '2026-08-10T10:14:00.000Z',
    updatedAt: '2026-08-10T10:14:00.000Z',
  };
  cycle.state = 'awaiting_review';
  cycle.activeReviewId = review.reviewId;
  cycle.updatedAt = review.createdAt;
  state.generatedAt = review.createdAt;
  state.reviews = [review];
  delete state.executiveBoards;
  assertProtocolArtifact('operating-runtime-state', state, { protocolVersion: '2.0.0' });
  return { state, cycle, review, plan: state.intelligencePlans[0], ledger: state.decisionLedgers[0] };
}

function materializedReviewTransaction() {
  const state = clone(journey.context.state);
  state.executiveBoards ??= [];
  const cycle = state.cycles.find(({ cycleId }) => cycleId === journey.cycleId);
  const plan = state.intelligencePlans[0];
  const ledger = state.decisionLedgers[0];
  const review = {
    kind: 'operating-review',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    reviewId: 'rev_executive_board_materialized_001',
    cycleId: cycle.cycleId,
    subject: { type: 'cycle', cycleId: cycle.cycleId },
    ownerActorId: 'owner-phase5-business',
    state: 'pending',
    disposition: null,
    workDispositions: [],
    createdAt: '2026-08-10T10:14:00.000Z',
    updatedAt: '2026-08-10T10:14:00.000Z',
  };
  const prepared = createOperatingExecutiveBoardMaterializationV2({
    cycleId: cycle.cycleId,
    planId: plan.planId,
    ledgerId: ledger.ledgerId,
    review,
  }, {
    eventId: 'evt_executive_board_materialized_001',
    timestamp: review.createdAt,
    correlationId: 'corr_executive_board_materialized_001',
  }, { initialState: state });
  const reviewEvent = createOperatingRuntimeEventV2({
    eventId: 'evt_executive_board_review_created_001',
    timestamp: review.createdAt,
    cycleId: cycle.cycleId,
    type: 'review.created',
    entityId: review.reviewId,
    actor: { kind: 'runtime', id: 'openplanr' },
    causationId: prepared.event.eventId,
    correlationId: prepared.event.correlationId,
    payload: review,
  }, { previousEvent: prepared.event });
  const finalState = reduceOperatingRuntimeEventsV2([prepared.event, reviewEvent], {
    initialState: state,
  });
  return { state, cycle, plan, ledger, review, prepared, reviewEvent, finalState };
}

test('old Cycle compatibility board is deterministic, schema-valid, non-authoritative, and Store-neutral', () => {
  const { state, cycle, review, plan, ledger } = oldReviewState();
  const beforeBytes = JSON.stringify(state);
  const beforeInventoryHash = sha256Jcs({
    eventReplayIndex: state.eventReplayIndex,
    artifacts: state.artifacts,
    reviews: state.reviews,
    executiveBoards: state.executiveBoards ?? null,
  });
  const first = buildExistingOperatingExecutiveBoardCompatibilityV2(state, {
    cycleId: cycle.cycleId,
    reviewId: review.reviewId,
  });
  const replay = buildExistingOperatingExecutiveBoardCompatibilityV2(state, {
    cycleId: cycle.cycleId,
    reviewId: review.reviewId,
  });
  assert.deepEqual(first, replay);
  assert.equal(first.projectionMode, 'compatibility');
  assert.equal(first.authoritativeForMutation, false);
  assert.equal(first.materializedEventId, null);
  assert.equal(first.planId, plan.planId);
  assert.equal(first.ledgerId, ledger.ledgerId);
  assert.equal(first.reviewId, review.reviewId);
  assert.equal(first.reviewHash, sha256Jcs(review));
  assert.equal(first.seatBindings.every(({ roleId }) => typeof roleId === 'string'), true);
  assert.doesNotThrow(() => assertOperatingExecutiveBoardV2(first));
  assert.equal(JSON.stringify(state), beforeBytes);
  assert.equal(sha256Jcs({
    eventReplayIndex: state.eventReplayIndex,
    artifacts: state.artifacts,
    reviews: state.reviews,
    executiveBoards: state.executiveBoards ?? null,
  }), beforeInventoryHash);
});

test('materialized and compatibility variants share semantic Chair truth but only the materialized branch can enter an Event', () => {
  const existing = oldReviewState();
  const state = clone(journey.context.state);
  delete state.executiveBoards;
  const cycle = state.cycles.find(({ cycleId }) => cycleId === journey.cycleId);
  const plan = state.intelligencePlans[0];
  const ledger = state.decisionLedgers[0];
  const { review } = existing;
  const beforeHash = sha256Jcs(state);
  const materialized = createOperatingExecutiveBoardMaterializationV2({
    cycleId: cycle.cycleId,
    planId: plan.planId,
    ledgerId: ledger.ledgerId,
    review: clone(review),
  }, {
    eventId: 'evt_executive_board_001',
    timestamp: review.createdAt,
    correlationId: 'corr_executive_board_001',
  }, { initialState: state });
  const compatibility = buildExistingOperatingExecutiveBoardCompatibilityV2(existing.state, {
    cycleId: existing.cycle.cycleId,
    reviewId: review.reviewId,
  });
  assert.equal(materialized.board.projectionMode, 'materialized');
  assert.equal(materialized.board.authoritativeForMutation, true);
  assert.equal(materialized.board.materializedEventId, materialized.event.eventId);
  assert.equal(materialized.board.reviewHash, sha256Jcs(review));
  assert.equal(materialized.board.semanticHash, compatibility.semanticHash);
  assert.notEqual(materialized.board.boardHash, compatibility.boardHash);
  assert.equal(materialized.event.type, 'executive-board.materialized');
  assert.equal(materialized.event.sequence, state.eventHead.sequence + 1);
  assert.equal(materialized.event.previousEventHash, state.eventHead.hash);
  assert.equal(materialized.event.entityId, materialized.board.boardId);
  assert.equal(materialized.event.payload.boardHash, materialized.board.boardHash);
  assert.equal(sha256Jcs(state), beforeHash, 'pure preparation cannot mutate runtime state');

  const forgedEvent = clone(materialized.event);
  forgedEvent.payload = clone(compatibility);
  forgedEvent.eventHash = sha256Jcs(without(forgedEvent, 'eventHash'));
  assert.throws(() => assertProtocolArtifact('operating-event', forgedEvent, {
    protocolVersion: '2.0.0',
  }), { code: 'E_PROTOCOL_ARTIFACT_INVALID' });

  const forgedBoard = clone(compatibility);
  forgedBoard.authoritativeForMutation = true;
  forgedBoard.boardHash = sha256Jcs(without(forgedBoard, 'boardHash'));
  assert.throws(() => assertOperatingExecutiveBoardV2(forgedBoard), {
    code: 'E_PROTOCOL_ARTIFACT_INVALID',
  });
});

test('stored board reads prefer the exact materialized record while compatibility never claims mutation authority', () => {
  const { cycle, review, finalState, prepared } = materializedReviewTransaction();
  assert.deepEqual(readOperatingExecutiveBoardV2(finalState, {
    cycleId: cycle.cycleId,
    reviewId: review.reviewId,
  }), prepared.board);
  const compatibility = buildExistingOperatingExecutiveBoardCompatibilityV2(finalState, {
    cycleId: cycle.cycleId,
    reviewId: review.reviewId,
  });
  assert.equal(compatibility.projectionMode, 'compatibility');
  assert.equal(compatibility.authoritativeForMutation, false);
  assert.equal(compatibility.materializedEventId, null);

  const forgedState = clone(finalState);
  forgedState.reviews[0].ownerActorId = 'owner-foreign-001';
  assert.throws(() => readOperatingExecutiveBoardV2(forgedState, {
    cycleId: cycle.cycleId,
    reviewId: review.reviewId,
  }), { code: 'E_OPERATE_BOARD_BINDING_INVALID' });
});

test('materialized Board remains readable with its frozen trace after terminal Review submission', () => {
  const { cycle, review, finalState, prepared } = materializedReviewTransaction();
  const request = {
    reviewId: review.reviewId,
    cycleId: cycle.cycleId,
    actor: { actorId: review.ownerActorId, kind: 'human', runtime: 'portable' },
    scope: {
      scopeId: cycle.scopeId,
      domainId: cycle.domainId,
      domainVersion: cycle.domainVersion,
    },
  };
  const read = readOperatingReviewV2(request, {
    initialState: finalState,
    capabilities: ['operate.review.get'],
    readAt: '2026-08-10T10:15:00.000Z',
  });
  const rejected = read.data.dispositionChoices.find(({ submitArguments }) => (
    submitArguments.disposition === 'rejected'
  ));
  const committed = submitOperatingReviewV2(rejected.submitArguments, {
    eventId: 'evt_executive_board_review_submitted_001',
    timestamp: '2026-08-10T10:15:00.000Z',
    correlationId: prepared.event.correlationId,
  }, {
    initialState: finalState,
    capabilities: [{ id: 'operate-review-submit', version: '2.0.0' }],
  });
  assert.deepEqual(readOperatingExecutiveBoardV2(committed.state, {
    cycleId: cycle.cycleId,
    reviewId: review.reviewId,
  }), prepared.board);
  assert.deepEqual(
    committed.state.executiveBoards[0].traceMatrix,
    prepared.board.traceMatrix,
    'later Events reuse the board-time trace instead of relabeling current state',
  );
});

test('Board and Cycle Review reduce as one adjacent atomic transaction with bounded replay and legacy omission', () => {
  const transaction = materializedReviewTransaction();
  assert.equal(transaction.finalState.executiveBoards.length, 1);
  assert.equal(transaction.finalState.reviews.length, 1);
  assert.equal(transaction.finalState.cycles.find(({ cycleId }) => cycleId === transaction.cycle.cycleId).state, 'awaiting_review');
  assert.equal(transaction.finalState.cycles.find(({ cycleId }) => cycleId === transaction.cycle.cycleId).activeReviewId, transaction.review.reviewId);
  const replayed = reduceOperatingRuntimeEventsV2([
    transaction.prepared.event,
    transaction.reviewEvent,
  ], { initialState: transaction.finalState });
  assert.equal(sha256Jcs(replayed), sha256Jcs(transaction.finalState));

  assert.throws(() => reduceOperatingRuntimeEventsV2([
    transaction.prepared.event,
  ], { initialState: transaction.state }), { code: 'STATE_TRANSITION_INVALID' });

  const binding = transaction.state.inputBindings.find(({ cycleId }) => cycleId === transaction.cycle.cycleId);
  const intervening = createOperatingRuntimeEventV2({
    eventId: 'evt_executive_board_intervening_001',
    timestamp: transaction.review.createdAt,
    cycleId: transaction.cycle.cycleId,
    type: 'cycle.input-bound',
    entityId: binding.inputBindingId,
    actor: { kind: 'runtime', id: 'openplanr' },
    causationId: transaction.prepared.event.eventId,
    correlationId: transaction.prepared.event.correlationId,
    payload: {
      inputBindingId: binding.inputBindingId,
      scopeId: transaction.cycle.scopeId,
      domainId: transaction.cycle.domainId,
      domainVersion: transaction.cycle.domainVersion,
      contractVersions: clone(transaction.cycle.contractVersions),
    },
  }, { previousEvent: transaction.prepared.event });
  const lateReview = createOperatingRuntimeEventV2({
    ...without(transaction.reviewEvent, 'eventHash'),
    previousEventHash: undefined,
  }, { previousEvent: intervening });
  assert.throws(() => reduceOperatingRuntimeEventsV2([
    transaction.prepared.event,
    intervening,
    lateReview,
  ], { initialState: transaction.state }), { code: 'STATE_TRANSITION_INVALID' });

  const divergentReview = clone(transaction.review);
  divergentReview.ownerActorId = 'owner-divergent-001';
  const divergentEvent = createOperatingRuntimeEventV2({
    ...without(transaction.reviewEvent, 'eventHash'),
    payload: divergentReview,
  }, { previousEvent: transaction.prepared.event });
  assert.throws(() => reduceOperatingRuntimeEventsV2([
    transaction.prepared.event,
    divergentEvent,
  ], { initialState: transaction.state }), { code: 'STATE_TRANSITION_INVALID' });

  const awaitingNew = clone(transaction.state);
  const newCycle = awaitingNew.cycles.find(({ cycleId }) => cycleId === transaction.cycle.cycleId);
  newCycle.state = 'awaiting_review';
  newCycle.updatedAt = transaction.review.createdAt;
  const unboarded = createOperatingRuntimeEventV2({
    ...without(transaction.reviewEvent, 'eventHash'),
    causationId: null,
    correlationId: 'corr_unboarded_new_review_001',
  }, { previousEvent: {
    sequence: awaitingNew.eventHead.sequence,
    eventHash: awaitingNew.eventHead.hash,
  } });
  assert.throws(() => reduceOperatingRuntimeEventsV2([unboarded], {
    initialState: awaitingNew,
  }), { code: 'STATE_TRANSITION_INVALID' });

  const legacy = clone(awaitingNew);
  delete legacy.executiveBoards;
  const legacyResult = reduceOperatingRuntimeEventsV2([unboarded], { initialState: legacy });
  assert.equal(Object.hasOwn(legacyResult, 'executiveBoards'), false);
  assert.equal(legacyResult.reviews[0].reviewId, transaction.review.reviewId);
});

test('stored Board custody rejects canonical reorder, missing/substituted Event owners, and a forged same-ID Review', () => {
  const { finalState, prepared, review } = materializedReviewTransaction();
  const reordered = clone(prepared.board);
  reordered.seatBindings.reverse();
  rehashBoard(reordered);
  assert.throws(() => assertOperatingExecutiveBoardV2(reordered), {
    code: 'E_OPERATE_BOARD_BINDING_INVALID',
  });

  const substitutedEvent = clone(finalState);
  substitutedEvent.eventReplayIndex.find(({ eventId }) => eventId === prepared.event.eventId).entityId = 'xbr_substituted_0001';
  assert.throws(() => reduceOperatingRuntimeEventsV2([], { initialState: substitutedEvent }), {
    code: 'STATE_TRANSITION_INVALID',
  });

  const substitutedBoard = clone(finalState);
  substitutedBoard.executiveBoards[0].reviewId = 'rev_substituted_same_cycle_001';
  rehashBoard(substitutedBoard.executiveBoards[0]);
  assert.throws(() => reduceOperatingRuntimeEventsV2([], { initialState: substitutedBoard }), {
    code: 'STATE_TRANSITION_INVALID',
  });

  const forgedReview = clone(finalState);
  forgedReview.reviews.find(({ reviewId }) => reviewId === review.reviewId).ownerActorId = 'owner-forged-001';
  assert.throws(() => reduceOperatingRuntimeEventsV2([], { initialState: forgedReview }), {
    code: 'STATE_TRANSITION_INVALID',
  });
});
