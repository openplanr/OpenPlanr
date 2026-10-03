import assert from 'node:assert/strict';
import test from 'node:test';
import { validateArtifactReview } from '../lib/artifact/envelope.mjs';
import { mergeArtifactReviews } from '../lib/artifact/merge.mjs';
import {
  createArtifactReview,
  normalizeArtifactReview,
  reduceArtifactReview,
} from '../lib/artifact/ui/feedback-rail.mjs';

const timestamp = '2026-09-11T10:00:00Z';
const later = '2026-09-11T11:00:00Z';
function savedReview(region) {
  return {
    schemaVersion: '1.0.0',
    reviewId: 'review-one',
    reviewOf: 'a'.repeat(64),
    decision: 'pending',
    overall: '',
    pins: [
      {
        id: 'pin-one',
        author: { name: 'Alex' },
        artifactId: 'screen-one',
        region,
        viewport: { width: 1000, height: 720 },
        intent: 'question',
        status: 'open',
        comment: 'Clarify the action.',
        replies: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
}

test('restoring and editing feedback preserves valid immutable region precision', () => {
  for (const region of [
    { x: 0.42000000000000004, y: 0.22999999999999998, w: 0, h: 0 },
    { x: 0.33999999999999997, y: 0.15, w: 0.123456789123, h: 0.234567891234 },
    { x: 0.7000000000000001, y: 0.6000000000000001, w: 0.3, h: 0.4 },
  ]) {
    const stored = savedReview(region);
    validateArtifactReview(stored);
    const restored = normalizeArtifactReview(JSON.parse(JSON.stringify(stored)));
    assert.deepEqual(restored.pins[0].region, region);
    const incoming = reduceArtifactReview(
      restored,
      {
        type: 'add-reply',
        pinId: 'pin-one',
        author: { name: 'Morgan' },
        comment: 'Make the next step clear.',
      },
      { createId: () => 'reply-one', now: () => later },
    );
    const merged = mergeArtifactReviews(stored, incoming);
    assert.deepEqual(merged.pins[0].region, region);
    assert.equal(merged.pins[0].replies[0].comment, 'Make the next step clear.');
  }
});

test('new out-of-bounds feedback is still bounded and non-finite regions are rejected', () => {
  const review = createArtifactReview({ reviewId: 'review-one', reviewOf: 'a'.repeat(64) });
  const action = {
    type: 'add-pin',
    author: { name: 'Alex' },
    pin: {
      id: 'pin-one',
      artifactId: 'screen-one',
      intent: 'question',
      comment: 'Clarify.',
      viewport: { width: 1000, height: 720 },
      region: { x: -0.1, y: 0.9000001, w: 1.2, h: 0.4 },
    },
  };
  const next = reduceArtifactReview(review, action, { now: () => timestamp });
  assert.deepEqual(next.pins[0].region, { x: 0, y: 0.9, w: 1, h: 0.1 });
  validateArtifactReview(next);
  assert.throws(
    () =>
      reduceArtifactReview(review, {
        ...action,
        pin: { ...action.pin, region: { ...action.pin.region, x: Number.NaN } },
      }),
    /must be finite/u,
  );
});

test('server merge continues to reject actual immutable geometry changes', () => {
  const stored = savedReview({ x: 0.42000000000000004, y: 0.22999999999999998, w: 0, h: 0 });
  const incoming = structuredClone(stored);
  incoming.pins[0].region.x = 0.42;
  assert.throws(() => mergeArtifactReviews(stored, incoming), {
    code: 'E_ARTIFACT_MERGE_CONFLICT',
  });
});
