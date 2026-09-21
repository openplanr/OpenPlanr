import { canonicalizeJson, sha256Hex } from '../protocol/canonical-json.mjs';
import { ARTIFACT_REVIEW_LIMITS, normalizeArtifactReview } from '../artifact/ui/feedback-rail.mjs';
import { assertDesignReviewMetadata } from '../protocol/review-experience-contracts.mjs';

export function workspaceReviewerId(publicKey) {
  return sha256Hex(canonicalizeJson({ kty: publicKey.kty, crv: publicKey.crv, x: publicKey.x, y: publicKey.y }));
}

/** Merge already verified/decrypted events. Signer identity, not display name,
 * owns pins and replies. A snapshot cannot replace another signer's work. */
export function mergeWorkspaceFeedback(events, { revisionId, reviewOf, ownerPublicKey } = {}) {
  if (!Array.isArray(events) || !revisionId || !/^[a-f0-9]{64}$/u.test(reviewOf)) throw new TypeError('Feedback merge requires a revision and content digest.');
  const pins = new Map();
  const pinOwners = new Map();
  const replyOwners = new Map();
  const overall = new Map();
  const directions = new Map();
  const seen = new Map();
  const revisionBases = new Map();
  const acceptedEventIds = [];
  const issues = [];
  const categories = {}, dispositions = {};
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    try {
    if (!event || typeof event.id !== 'string' || !event.id || typeof event.revisionId !== 'string' || !/^[a-f0-9]{64}$/u.test(event.reviewOf ?? '') || !Number.isSafeInteger(event.sequence) || event.sequence < 1) throw new TypeError('Shared feedback has an invalid event identity or revision.');
    const eventHash = sha256Hex(canonicalizeJson(event));
    if (seen.has(event.id)) {
      if (seen.get(event.id) !== eventHash) throw new TypeError('Shared feedback reuses an event identity with changed bytes.');
      continue;
    }
    seen.set(event.id, eventHash);
    const boundReviewOf = revisionBases.get(event.revisionId);
    if (boundReviewOf && boundReviewOf !== event.reviewOf) throw new TypeError('A shared revision identity is bound to conflicting design content.');
    revisionBases.set(event.revisionId, event.reviewOf);
    if (event.revisionId !== revisionId) continue;
    if (event.reviewOf !== reviewOf || !event.publicKey?.x || !event.publicKey?.y) throw new TypeError('Shared feedback has an invalid revision or signer.');
    const signerId = workspaceReviewerId(event.publicKey);
    const payload = event.payload;
    if (!payload || typeof payload.author !== 'string' || !payload.author.trim() || payload.author.length > 160 || payload.reviewOf !== reviewOf) throw new TypeError('Shared feedback has an invalid author or digest.');
    const author = { id: signerId, name: payload.author.trim() };
    if (['category', 'disposition'].includes(payload.kind)) {
      assertDesignReviewMetadata(payload);
      if (!pins.has(payload.pinId)) throw new TypeError('Review metadata targets an unknown pin.');
      const owner = ownerPublicKey?.x === event.publicKey.x && ownerPublicKey?.y === event.publicKey.y;
      if (payload.kind === 'disposition' && !owner) throw new TypeError('Only the design owner can record a disposition.');
      if (payload.kind === 'category' && !owner && pinOwners.get(payload.pinId) !== signerId) throw new TypeError('Only the comment author or owner can change its category.');
      if (payload.kind === 'category') categories[payload.pinId] = payload.category;
      else dispositions[payload.pinId] = { disposition: payload.disposition, reason: payload.reason, updatedAt: payload.updatedAt, author: author.name };
      acceptedEventIds.push(event.id);
      continue;
    }
    if (payload.kind === 'direction') {
      for (const value of [payload.ratings ?? {}, payload.remix ?? {}]) if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 256) throw new TypeError('Shared direction feedback is too large or invalid.');
      const ratings = {};
      const remix = {};
      for (const [id, rating] of Object.entries(payload.ratings ?? {})) {
        if (Number.isInteger(rating) && rating >= 1 && rating <= 5) ratings[id] = rating;
      }
      for (const [id, note] of Object.entries(payload.remix ?? {})) {
        if (typeof note === 'string' && note.length <= 8192) remix[id] = note;
      }
      directions.set(signerId, { signerId, author: author.name, revisionId, ratings, remix });
      acceptedEventIds.push(event.id);
      continue;
    }
    if (payload.kind !== 'review' || payload.review?.reviewOf !== reviewOf) throw new TypeError('Shared review snapshot does not match its signed revision.');
    const review = normalizeArtifactReview(payload.review);
    const additions = review.pins.filter(pin => !pins.has(pin.id)).length;
    if (pins.size + additions > ARTIFACT_REVIEW_LIMITS.pins) throw new TypeError('Shared feedback exceeds the total pin limit.');
    for (const incoming of review.pins) {
      const previous = pins.get(incoming.id);
      const replies = new Set([...(previous?.replies ?? []).map(reply => reply.id), ...incoming.replies.map(reply => reply.id)]);
      if (replies.size > ARTIFACT_REVIEW_LIMITS.replies) throw new TypeError('Shared feedback exceeds the thread reply limit.');
    }
    overall.set(signerId, { author: author.name, note: review.overall });
    for (const incoming of review.pins) {
      const previous = pins.get(incoming.id);
      if (!previous) {
        pins.set(incoming.id, { ...structuredClone(incoming), author, replies: [] });
        pinOwners.set(incoming.id, signerId);
      } else if (pinOwners.get(incoming.id) === signerId) {
        pins.set(incoming.id, { ...previous, comment: incoming.comment, status: incoming.status, updatedAt: incoming.updatedAt, author, replies: previous.replies });
      }
      const pin = pins.get(incoming.id);
      for (const reply of incoming.replies) {
        const key = `${incoming.id}:${reply.id}`;
        if (!replyOwners.has(key)) {
          replyOwners.set(key, signerId);
          pin.replies.push({ ...structuredClone(reply), author });
        }
      }
    }
    acceptedEventIds.push(event.id);
    } catch (error) { issues.push({eventId:event.id, sequence:event.sequence, reason:error.message}); }
  }
  const review = normalizeArtifactReview({
    schemaVersion: '1.0.0', reviewId: `shared-${revisionId}`, reviewOf,
    decision: 'pending', overall: [...overall.values()].filter(({ note }) => note).map(({ author, note }) => `${author}: ${note}`).join('\n\n').slice(0, 16384),
    pins: [...pins.values()],
  });
  return { review, directions: [...directions.values()], metadata: { categories, dispositions }, acceptedEventIds, issues };
}
