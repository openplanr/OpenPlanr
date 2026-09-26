import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { assertProtocolArtifact } from '@openplanr/protocol/contracts';
import { PipelineError } from '@openplanr/protocol/errors';
import {
  assertOperatingExecutiveBoardV2,
  buildOperatingExecutiveBoardRecordV2,
} from './executive-board-materialization-v2.mjs';

const PROTOCOL_VERSION = '2.0.0';

function fail(code, message, context = {}) {
  throw new PipelineError(code, message, '', { retryable: false, context });
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

function selectReview(state, cycleId, reviewId) {
  const candidates = state.reviews.filter(
    (review) =>
      review.cycleId === cycleId &&
      review.subject?.type !== 'action' &&
      (reviewId === undefined || review.reviewId === reviewId),
  );
  if (candidates.length !== 1) {
    fail(
      'E_OPERATE_BOARD_COMPATIBILITY_UNAVAILABLE',
      'Compatibility board requires one exact Cycle Review.',
      {
        cycleId,
        reviewId: reviewId ?? null,
        matchCount: candidates.length,
      },
    );
  }
  return candidates[0];
}

function selectPlanAndLedger(state, cycleId) {
  const planIds = new Set(
    state.assignments
      .filter((assignment) => assignment.cycleId === cycleId)
      .map((assignment) => assignment.intelligenceContext?.intelligencePlanId)
      .filter((value) => typeof value === 'string'),
  );
  const candidates = (state.decisionLedgers ?? []).filter((ledger) =>
    planIds.has(ledger.intelligencePlanId),
  );
  if (candidates.length !== 1) {
    fail(
      'E_OPERATE_BOARD_COMPATIBILITY_UNAVAILABLE',
      'Compatibility board requires one exact Chair ledger for the Cycle.',
      {
        cycleId,
        matchCount: candidates.length,
      },
    );
  }
  return { planId: candidates[0].intelligencePlanId, ledgerId: candidates[0].ledgerId };
}

function selectReviewCreationCustody(state, review) {
  const events = state.eventReplayIndex.filter(
    (entry) =>
      entry.type === 'review.created' &&
      entry.entityId === review.reviewId &&
      entry.cycleId === review.cycleId,
  );
  if (events.length === 1) {
    const [event] = events;
    if (event.timestamp !== review.createdAt) {
      fail(
        'E_OPERATE_BOARD_BINDING_INVALID',
        'Cycle Review creation custody has a divergent timestamp.',
        {
          cycleId: review.cycleId,
          reviewId: review.reviewId,
        },
      );
    }
    return event;
  }
  if (
    events.length === 0 &&
    review.state === 'pending' &&
    review.disposition === null &&
    review.updatedAt === review.createdAt
  ) {
    return {
      eventId: null,
      eventHash: null,
      payloadHash: sha256Jcs(review),
      sequence: null,
      previousEventHash: null,
      correlationId: null,
      causationId: null,
      timestamp: review.createdAt,
    };
  }
  fail(
    'E_OPERATE_BOARD_COMPATIBILITY_UNAVAILABLE',
    'Compatibility board requires one exact pending Review or durable review.created custody.',
    {
      cycleId: review.cycleId,
      reviewId: review.reviewId,
      eventCount: events.length,
    },
  );
}

function assertStoredBoardCustody(state, board, review, reviewCreation) {
  const events = state.eventReplayIndex.filter(
    (entry) =>
      entry.type === 'executive-board.materialized' &&
      entry.entityId === board.boardId &&
      entry.cycleId === board.cycleId,
  );
  const event = events.length === 1 ? events[0] : null;
  const submissionEvents = state.eventReplayIndex.filter(
    (entry) =>
      entry.type === 'review.submitted' &&
      entry.entityId === review.reviewId &&
      entry.cycleId === review.cycleId,
  );
  const creationProjection =
    submissionEvents.length === 1
      ? (submissionEvents[0].receiptProjection?.read?.review ?? null)
      : null;
  const currentReviewBound =
    review.state === 'pending'
      ? sha256Jcs(review) === board.reviewHash
      : submissionEvents.length === 1 &&
        creationProjection &&
        sha256Jcs(creationProjection) === board.reviewHash &&
        creationProjection.reviewId === review.reviewId &&
        creationProjection.cycleId === review.cycleId &&
        creationProjection.ownerActorId === review.ownerActorId &&
        creationProjection.createdAt === review.createdAt &&
        sha256Jcs(creationProjection.subject ?? null) === sha256Jcs(review.subject ?? null);
  if (
    !event ||
    event.eventId !== board.materializedEventId ||
    event.actor.kind !== 'runtime' ||
    event.actor.id !== 'openplanr' ||
    event.payloadHash !== sha256Jcs(board) ||
    event.sequence !== board.sourceEventHead.sequence + 1 ||
    event.previousEventHash !== board.sourceEventHead.hash ||
    reviewCreation.eventId === null ||
    reviewCreation.sequence !== event.sequence + 1 ||
    reviewCreation.previousEventHash !== event.eventHash ||
    reviewCreation.causationId !== event.eventId ||
    reviewCreation.correlationId !== event.correlationId ||
    reviewCreation.payloadHash !== board.reviewHash ||
    reviewCreation.timestamp !== board.createdAt ||
    review.createdAt !== board.createdAt ||
    !currentReviewBound
  ) {
    fail(
      'E_OPERATE_BOARD_BINDING_INVALID',
      'Materialized Executive Board lost its exact Event and adjacent Review-creation custody.',
      {
        cycleId: board.cycleId,
        reviewId: board.reviewId,
        boardId: board.boardId,
      },
    );
  }
}

/**
 * Prefer one durable materialized board. When an old v2 Cycle predates that
 * Event, derive the same closed contract in memory and mark it compatibility,
 * false for mutation authority, with no materialized Event ID.
 */
export function readOperatingExecutiveBoardV2(
  state,
  { cycleId, reviewId = undefined, accessLevel = 'restricted', eventHead = state?.eventHead } = {},
) {
  assertProtocolArtifact('operating-runtime-state', state, { protocolVersion: PROTOCOL_VERSION });
  const review = selectReview(state, cycleId, reviewId);
  const reviewCreation = selectReviewCreationCustody(state, review);
  const stored = (state.executiveBoards ?? []).filter(
    (board) => board.cycleId === cycleId && board.reviewId === review.reviewId,
  );
  if (stored.length > 1) {
    fail(
      'E_OPERATE_BOARD_BINDING_INVALID',
      'Cycle Review has more than one materialized Executive Board.',
      {
        cycleId,
        reviewId: review.reviewId,
      },
    );
  }
  if (stored.length === 1) {
    assertOperatingExecutiveBoardV2(stored[0], { materializedOnly: true });
    assertStoredBoardCustody(state, stored[0], review, reviewCreation);
    return freeze(structuredClone(stored[0]));
  }
  const { planId, ledgerId } = selectPlanAndLedger(state, cycleId);
  return buildOperatingExecutiveBoardRecordV2(state, {
    cycleId,
    planId,
    ledgerId,
    reviewId: review.reviewId,
    reviewHash: reviewCreation.payloadHash,
    projectionMode: 'compatibility',
    materializedEventId: null,
    createdAt: review.createdAt,
    eventHead,
    accessLevel,
  });
}

/** Explicit read-only old-Cycle entry point used by Store-neutral tests. */
export function buildExistingOperatingExecutiveBoardCompatibilityV2(state, options = {}) {
  const board = readOperatingExecutiveBoardV2(
    Object.hasOwn(state ?? {}, 'executiveBoards') ? { ...state, executiveBoards: [] } : state,
    options,
  );
  if (
    board.projectionMode !== 'compatibility' ||
    board.authoritativeForMutation !== false ||
    board.materializedEventId !== null
  ) {
    fail(
      'E_OPERATE_BOARD_CONTRACT_INVALID',
      'Existing-Cycle compatibility projection became mutation-authoritative.',
    );
  }
  return board;
}
