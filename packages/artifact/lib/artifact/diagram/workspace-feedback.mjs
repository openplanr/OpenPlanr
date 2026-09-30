import { canonicalizeJson, sha256Hex } from '@openplanr/protocol/canonical-json';
import { assertDiagramReviewFeedback } from '@openplanr/protocol/diagram-review-contracts';

export function workspaceReviewerId(publicKey) {
  return sha256Hex(
    canonicalizeJson({ kty: publicKey.kty, crv: publicKey.crv, x: publicKey.x, y: publicKey.y }),
  );
}
function isNewEvent(event, state) {
  if (
    !event ||
    typeof event.id !== 'string' ||
    !event.id ||
    !Number.isSafeInteger(event.sequence) ||
    event.sequence < 1 ||
    typeof event.revisionId !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(event.reviewOf ?? '')
  )
    throw new Error('Invalid diagram feedback identity or revision.');
  const bytes = canonicalizeJson(event);
  if (state.seen.has(event.id)) {
    if (state.seen.get(event.id) !== bytes)
      throw new Error('A feedback identity was reused with changed bytes.');
    return false;
  }
  state.seen.set(event.id, bytes);
  if (state.bases.has(event.revisionId) && state.bases.get(event.revisionId) !== event.reviewOf)
    throw new Error('A revision is bound to conflicting diagram content.');
  state.bases.set(event.revisionId, event.reviewOf);
  return true;
}
/** Element targets belong to the immutable scene named by the feedback revision. */
export function assertDiagramFeedbackTarget(payload, scene) {
  if (payload.kind !== 'comment' || !payload.target.elementId) return;
  if (![...scene.items, ...scene.relations].some((item) => item.id === payload.target.elementId))
    throw new Error('Feedback targets an element outside its published revision.');
}
function addComment(state, payload, signerId) {
  if (state.identities.has(payload.commentId))
    throw new Error('A comment identity cannot be replaced.');
  if (state.comments.size >= 2000) throw new Error('Diagram review exceeds its comment limit.');
  state.comments.set(payload.commentId, {
    commentId: payload.commentId,
    author: payload.author,
    signerId,
    body: payload.body,
    target: structuredClone(payload.target),
    createdAt: payload.createdAt,
    resolved: false,
    replies: [],
  });
  state.identities.set(payload.commentId, signerId);
}
function addReply(state, payload, signerId) {
  const parent = state.comments.get(payload.parentId);
  if (!parent || state.identities.has(payload.commentId))
    throw new Error('A reply requires an existing comment and a new identity.');
  if (parent.replies.length >= 1000) throw new Error('Diagram comment exceeds its reply limit.');
  parent.replies.push({
    commentId: payload.commentId,
    author: payload.author,
    signerId,
    body: payload.body,
    createdAt: payload.createdAt,
  });
  state.identities.set(payload.commentId, signerId);
}
function resolveComment(state, payload, signerId, event, ownerPublicKey) {
  const comment = state.comments.get(payload.commentId);
  const owner = ownerPublicKey?.x === event.publicKey.x && ownerPublicKey?.y === event.publicKey.y;
  if (!comment || (!owner && comment.signerId !== signerId))
    throw new Error('Only the comment author or diagram owner can resolve a comment.');
  comment.resolved = payload.resolved;
  comment.updatedAt = payload.createdAt;
}
function mergeEvent(state, event, { reviewOf, ownerPublicKey, scene }) {
  if (event.reviewOf !== reviewOf || !event.publicKey?.x || !event.publicKey?.y)
    throw new Error('Diagram feedback does not match this revision.');
  const payload = assertDiagramReviewFeedback(event.payload);
  if (payload.reviewOf !== reviewOf)
    throw new Error('Diagram feedback content digest does not match.');
  const signerId = workspaceReviewerId(event.publicKey);
  if (scene) assertDiagramFeedbackTarget(payload, scene);
  if (payload.kind === 'comment') addComment(state, payload, signerId);
  else if (payload.kind === 'reply') addReply(state, payload, signerId);
  else resolveComment(state, payload, signerId, event, ownerPublicKey);
}

/** Only verified events may enter this merge; display names never grant comment ownership. */
export function mergeDiagramWorkspaceFeedback(
  events,
  { revisionId, reviewOf, ownerPublicKey, scene } = {},
) {
  if (!Array.isArray(events) || !revisionId || !/^[a-f0-9]{64}$/u.test(reviewOf ?? ''))
    throw new TypeError('Diagram feedback requires an exact revision and content digest.');
  const state = { comments: new Map(), seen: new Map(), identities: new Map(), bases: new Map() };
  const issues = [],
    acceptedEventIds = [];
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    try {
      if (!isNewEvent(event, state) || event.revisionId !== revisionId) continue;
      mergeEvent(state, event, { reviewOf, ownerPublicKey, scene });
      acceptedEventIds.push(event.id);
    } catch (error) {
      issues.push({
        id: typeof event?.id === 'string' ? event.id : null,
        sequence: event?.sequence ?? null,
        reason: error.message,
      });
    }
  }
  return { comments: [...state.comments.values()], issues, acceptedEventIds };
}
