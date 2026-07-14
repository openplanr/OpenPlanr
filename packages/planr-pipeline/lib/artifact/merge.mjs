import { canonicalSerialize, validateArtifactReview } from './envelope.mjs';
import { ARTIFACT_ERROR_CODES, PipelineError } from '../pipeline/errors.mjs';

export const ARTIFACT_REVIEW_STATE_VERSION = '1.0.0';
export const ARTIFACT_REVIEW_STATE_KIND = 'artifact-review-state';

const SHA256_RE = /^[a-f0-9]{64}$/;
const ARTIFACT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function conflict(message, details = undefined) {
  throw new PipelineError(
    ARTIFACT_ERROR_CODES.MERGE_CONFLICT,
    message,
    'Keep both reviews under different stable IDs or resolve the conflicting item explicitly.',
    details,
  );
}

export function assertUniqueReviewItemIds(review) {
  const pinIds = new Set();
  for (const pin of review.pins ?? []) {
    if (pinIds.has(pin.id)) {
      throw new PipelineError(
        ARTIFACT_ERROR_CODES.REVIEW_INVALID,
        'Artifact review contains a duplicate pin ID.',
      );
    }
    pinIds.add(pin.id);
    const replyIds = new Set();
    for (const reply of pin.replies ?? []) {
      if (replyIds.has(reply.id)) {
        throw new PipelineError(
          ARTIFACT_ERROR_CODES.REVIEW_INVALID,
          'Artifact review contains a duplicate reply ID in one thread.',
        );
      }
      replyIds.add(reply.id);
    }
  }
  return review;
}

function clone(value) {
  return structuredClone(value);
}

function same(a, b) {
  return canonicalSerialize(a) === canonicalSerialize(b);
}

function timeValue(value) {
  if (typeof value !== 'string') return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function compareStable(a, b, idKey) {
  const aTime = a.createdAt ?? a.updatedAt ?? '';
  const bTime = b.createdAt ?? b.updatedAt ?? '';
  return aTime.localeCompare(bTime) || String(a[idKey]).localeCompare(String(b[idKey]));
}

function replyMap(replies) {
  const map = new Map();
  for (const reply of replies ?? []) {
    const previous = map.get(reply.id);
    if (previous && !same(previous, reply)) {
      conflict('A reply ID refers to different immutable reply content.', { entity: 'reply' });
    }
    map.set(reply.id, clone(reply));
  }
  return map;
}

function mergeReplies(stored = [], incoming = []) {
  const merged = replyMap(stored);
  for (const reply of incoming) {
    const previous = merged.get(reply.id);
    if (previous && !same(previous, reply)) {
      conflict('A reply ID refers to different immutable reply content.', { entity: 'reply' });
    }
    if (!previous) merged.set(reply.id, clone(reply));
  }
  return [...merged.values()].sort((a, b) => compareStable(a, b, 'id'));
}

const immutablePin = (pin) => ({
  id: pin.id,
  author: pin.author,
  artifactId: pin.artifactId,
  ...(pin.variant === undefined ? {} : { variant: pin.variant }),
  region: pin.region,
  viewport: pin.viewport,
  ...(pin.anchor === undefined ? {} : { anchor: pin.anchor }),
  createdAt: pin.createdAt,
});

const mutablePin = (pin) => ({
  intent: pin.intent,
  status: pin.status,
  comment: pin.comment,
});

function mergePin(stored, incoming) {
  if (!same(immutablePin(stored), immutablePin(incoming))) {
    conflict('A pin ID refers to different immutable geometry, author, or artifact content.', { entity: 'pin' });
  }
  const replies = mergeReplies(stored.replies, incoming.replies);
  const storedTime = timeValue(stored.updatedAt);
  const incomingTime = timeValue(incoming.updatedAt);
  let selected = stored;
  if (incomingTime > storedTime) selected = incoming;
  if (incomingTime === storedTime && !same(mutablePin(stored), mutablePin(incoming))) {
    conflict('A pin has divergent mutable content at the same update time.', { entity: 'pin' });
  }
  return { ...clone(selected), replies };
}

function mergePins(stored = [], incoming = []) {
  const merged = new Map();
  for (const pin of stored) merged.set(pin.id, clone(pin));
  for (const pin of incoming) {
    const previous = merged.get(pin.id);
    merged.set(pin.id, previous ? mergePin(previous, pin) : clone(pin));
  }
  return [...merged.values()].sort((a, b) => compareStable(a, b, 'id'));
}

const immutableReview = (review) => ({
  schemaVersion: review.schemaVersion,
  reviewId: review.reviewId,
  reviewOf: review.reviewOf,
  ...(review.createdAt === undefined ? {} : { createdAt: review.createdAt }),
});

const mutableReview = (review) => ({ decision: review.decision, overall: review.overall });

/** Merge two revisions of the same review without changing immutable anchors. */
export function mergeArtifactReviews(stored, incoming) {
  validateArtifactReview(stored);
  validateArtifactReview(incoming);
  assertUniqueReviewItemIds(stored);
  assertUniqueReviewItemIds(incoming);
  if (stored.reviewId !== incoming.reviewId) {
    conflict('Only reviews with the same review ID can be revision-merged.', {
      entity: 'review',
    });
  }
  if (same(stored, incoming)) return stored;
  if (!same(immutableReview(stored), immutableReview(incoming))) {
    conflict('A review ID refers to a different digest or creation identity.', {
      entity: 'review',
    });
  }
  const storedTime = timeValue(stored.updatedAt);
  const incomingTime = timeValue(incoming.updatedAt);
  let selected = stored;
  if (incomingTime > storedTime) selected = incoming;
  if (incomingTime === storedTime && !same(mutableReview(stored), mutableReview(incoming))) {
    conflict('A review has divergent verdict or overall feedback at the same update time.', {
      entity: 'review',
    });
  }
  const merged = {
    ...clone(selected),
    pins: mergePins(stored.pins, incoming.pins),
  };
  validateArtifactReview(merged);
  return merged;
}

export function validateReviewLedger(ledger) {
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)
    || ledger.schemaVersion !== ARTIFACT_REVIEW_STATE_VERSION
    || ledger.kind !== ARTIFACT_REVIEW_STATE_KIND
    || !ARTIFACT_ID_RE.test(ledger.artifactId ?? '')
    || !SHA256_RE.test(ledger.currentReviewOf ?? '')
    || !Array.isArray(ledger.reviews)) {
    throw new PipelineError(
      ARTIFACT_ERROR_CODES.REVIEW_INVALID,
      'Artifact review state is not a valid versioned review ledger.',
    );
  }
  const ids = new Set();
  for (const entry of ledger.reviews) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.stale !== 'boolean' || !entry.review) {
      throw new PipelineError(ARTIFACT_ERROR_CODES.REVIEW_INVALID, 'Artifact review ledger entry is invalid.');
    }
    validateArtifactReview(entry.review);
    assertUniqueReviewItemIds(entry.review);
    if (ids.has(entry.review.reviewId)) {
      throw new PipelineError(ARTIFACT_ERROR_CODES.REVIEW_INVALID, 'Artifact review ledger IDs must be unique.');
    }
    ids.add(entry.review.reviewId);
  }
  return ledger;
}

export function createReviewLedger({ artifactId, currentReviewOf, reviews = [] } = {}) {
  const ledger = {
    schemaVersion: ARTIFACT_REVIEW_STATE_VERSION,
    kind: ARTIFACT_REVIEW_STATE_KIND,
    artifactId,
    currentReviewOf,
    reviews: reviews.map((entry) => ({ review: clone(entry.review), stale: Boolean(entry.stale) })),
  };
  ledger.reviews.sort((a, b) => compareStable(a.review, b.review, 'reviewId'));
  return validateReviewLedger(ledger);
}

/** Merge one or many schema-valid reviews into the versioned local state ledger. */
export function mergeReviewLedger(ledger, incoming, { stale = false } = {}) {
  validateReviewLedger(ledger);
  const reviews = Array.isArray(incoming) ? incoming : [incoming];
  const byId = new Map(ledger.reviews.map((entry) => [entry.review.reviewId, {
    review: clone(entry.review), stale: entry.stale,
  }]));
  for (const review of reviews) {
    validateArtifactReview(review);
    const previous = byId.get(review.reviewId);
    if (previous) {
      byId.set(review.reviewId, {
        review: mergeArtifactReviews(previous.review, review),
        stale: previous.stale || Boolean(stale),
      });
    } else {
      byId.set(review.reviewId, { review: clone(review), stale: Boolean(stale) });
    }
  }
  const merged = createReviewLedger({
    artifactId: ledger.artifactId,
    currentReviewOf: ledger.currentReviewOf,
    reviews: [...byId.values()],
  });
  return same(ledger, merged) ? ledger : merged;
}

export function effectiveReviewDecision(value) {
  const entries = Array.isArray(value) ? value : value?.reviews ?? [];
  const decisions = entries.map((entry) => entry.review?.decision ?? entry.decision);
  if (decisions.includes('changes_requested')) return 'changes_requested';
  if (decisions.includes('pending')) return 'pending';
  return decisions.length > 0 && decisions.every((decision) => decision === 'approved')
    ? 'approved'
    : 'pending';
}

/** Public engine name retained by the cross-runtime contract. */
export const mergeArtifactFeedback = mergeReviewLedger;
