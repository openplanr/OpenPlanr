import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeWorkspaceFeedback, workspaceReviewerId } from '../lib/design/workspace-feedback.mjs';

const digest = 'a'.repeat(64),
  revisionId = 'revision-abcdefghijklmnop';
const pin = (id = 'pin-1') => ({
  id,
  artifactId: 'screen',
  intent: 'improve',
  status: 'open',
  comment: 'Original',
  author: { name: 'spoofed' },
  position: { x: 0.2, y: 0.2 },
  region: { x: 0.2, y: 0.2, w: 0, h: 0 },
  viewport: { width: 1440, height: 1024 },
  replies: [],
  createdAt: '2026-09-09T10:00:00Z',
  updatedAt: '2026-09-09T10:00:00Z',
});
const event = (sequence, author, pins) => ({
  id: `event-${sequence}`,
  sequence,
  revisionId,
  reviewOf: digest,
  publicKey: { kty: 'EC', crv: 'P-256', x: author, y: author },
  payload: {
    kind: 'review',
    author,
    reviewOf: digest,
    review: {
      schemaVersion: '1.0.0',
      reviewId: 'arbitrary',
      reviewOf: digest,
      overall: '',
      decision: 'approved',
      pins,
    },
  },
});
test('signed author owns pin, immutable geometry and replies; copied snapshots cannot take over', () => {
  const original = pin();
  const forged = {
    ...pin(),
    comment: 'Replaced',
    status: 'resolved',
    position: { x: 0.8, y: 0.8 },
    replies: [
      {
        id: 'reply',
        author: { name: 'Fake owner' },
        comment: 'Review response',
        createdAt: '2026-09-09T11:00:00Z',
      },
    ],
  };
  const result = mergeWorkspaceFeedback(
    [
      event(1, 'Alice', [original]),
      event(2, 'Bob', [forged]),
      event(3, 'Alice', [{ ...original, status: 'addressed', position: { x: 0.9, y: 0.9 } }]),
    ],
    { revisionId, reviewOf: digest },
  );
  assert.equal(result.review.decision, 'pending');
  assert.equal(result.review.pins[0].comment, 'Original');
  assert.equal(result.review.pins[0].status, 'addressed');
  assert.equal(result.review.pins[0].region.x, 0.2);
  assert.equal(result.review.pins[0].author.name, 'Alice');
  assert.equal(result.review.pins[0].replies[0].author.name, 'Bob');
});
test('quarantines invalid snapshots and digest mismatches without losing later feedback', () => {
  const bad = event(2, 'Bob', [pin()]);
  bad.payload.review.reviewOf = 'b'.repeat(64);
  const malformed = event(3, 'Eve', [{ id: 'bad' }]);
  const result = mergeWorkspaceFeedback(
    [event(1, 'Alice', [pin()]), bad, malformed, event(4, 'Sam', [pin('new')])],
    { revisionId, reviewOf: digest },
  );
  assert.equal(result.issues.length, 2);
  assert.equal(result.review.pins.length, 2);
  assert.deepEqual(result.acceptedEventIds, ['event-1', 'event-4']);
});
test('reviewer badges distinguish identical display names using verified signer identities', () => {
  const first = event(1, 'first-signer', [pin('first')]);
  const second = event(2, 'second-signer', [pin('second')]);
  first.payload.author = second.payload.author = 'Alex';
  second.payload.review.pins[0].author.id = workspaceReviewerId(first.publicKey);
  const result = mergeWorkspaceFeedback([first, second], { revisionId, reviewOf: digest });
  assert.deepEqual(
    result.review.pins.map((value) => value.author.name),
    ['Alex', 'Alex'],
  );
  assert.equal(result.review.pins[0].author.id, workspaceReviewerId(first.publicKey));
  assert.equal(result.review.pins[1].author.id, workspaceReviewerId(second.publicKey));
  assert.notEqual(result.review.pins[0].author.id, result.review.pins[1].author.id);
});
test('union overflow is quarantined before any event mutation', () => {
  const full = event(
    1,
    'Alice',
    Array.from({ length: 10000 }, (_, i) => pin(`pin-${i}`)),
  );
  const extra = event(2, 'Bob', [pin('overflow')]);
  const result = mergeWorkspaceFeedback([full, extra], { revisionId, reviewOf: digest });
  assert.equal(result.review.pins.length, 10000);
  assert.equal(result.issues.length, 1);
  assert.deepEqual(result.acceptedEventIds, ['event-1']);
});

test('categories retain author ownership and owner dispositions cannot be forged by reviewers', () => {
  const ownerPublicKey = { kty: 'EC', crv: 'P-256', x: 'Owner', y: 'Owner' };
  const metadata = (sequence, author, kind, fields) => ({
    ...event(sequence, author, []),
    payload: {
      schemaVersion: '1.0.0',
      kind,
      author,
      reviewOf: digest,
      pinId: 'pin-1',
      updatedAt: '2026-09-10T10:00:00Z',
      ...fields,
    },
  });
  const values = [
    event(1, 'Alice', [pin()]),
    metadata(2, 'Alice', 'category', { category: 'blocker' }),
    metadata(3, 'Bob', 'category', { category: 'suggestion' }),
    metadata(4, 'Bob', 'disposition', { disposition: 'accepted', reason: 'Pretend owner' }),
    metadata(5, 'Owner', 'disposition', { disposition: 'deferred', reason: 'Separate change' }),
  ];
  const result = mergeWorkspaceFeedback(values, { revisionId, reviewOf: digest, ownerPublicKey });
  assert.equal(result.metadata.categories['pin-1'], 'blocker');
  assert.equal(result.metadata.dispositions['pin-1'].disposition, 'deferred');
  assert.equal(result.review.pins[0].status, 'open');
  assert.equal(result.review.pins[0].intent, 'improve');
  assert.equal(result.issues.length, 2);
  assert.equal(
    mergeWorkspaceFeedback(values, { revisionId, reviewOf: digest }).metadata.dispositions['pin-1'],
    undefined,
  );
});

test('change request metadata preserves original pins, independent legacy intent and owner authority', () => {
  const original = { ...pin(), intent: 'fix' };
  const category = (sequence, author, schemaVersion, category) => ({
    ...event(sequence, author, []),
    payload: {
      schemaVersion,
      kind: 'category',
      author,
      reviewOf: digest,
      pinId: original.id,
      category,
      updatedAt: '2026-09-11T10:00:00Z',
    },
  });
  const result = mergeWorkspaceFeedback(
    [
      event(1, 'Alice', [original]),
      category(2, 'Alice', '1.1.0', 'change-request'),
      category(3, 'Alice', '1.0.0', 'change-request'),
      category(4, 'Bob', '1.1.0', 'blocker'),
    ],
    { revisionId, reviewOf: digest },
  );
  assert.equal(result.metadata.categories[original.id], 'change-request');
  assert.deepEqual(result.metadata.dispositions, {});
  assert.equal(result.review.pins[0].intent, 'fix');
  assert.equal(result.review.pins[0].status, 'open');
  assert.deepEqual(result.review.pins[0].region, original.region);
  assert.deepEqual(result.acceptedEventIds, ['event-1', 'event-2']);
  assert.equal(result.issues.length, 2);
});

test('exact event replay is idempotent while changed bytes and revision rebinding are quarantined', () => {
  const first = event(1, 'Alice', [pin()]);
  const exact = structuredClone(first);
  const changed = {
    ...structuredClone(first),
    sequence: 2,
    payload: { ...structuredClone(first.payload), author: 'Mallory' },
  };
  const rebound = {
    ...event(3, 'Bob', [pin('other')]),
    reviewOf: 'b'.repeat(64),
    payload: {
      ...event(3, 'Bob', [pin('other')]).payload,
      reviewOf: 'b'.repeat(64),
      review: { ...event(3, 'Bob', [pin('other')]).payload.review, reviewOf: 'b'.repeat(64) },
    },
  };
  const result = mergeWorkspaceFeedback([first, exact, changed, rebound], {
    revisionId,
    reviewOf: digest,
  });
  assert.deepEqual(result.acceptedEventIds, ['event-1']);
  assert.equal(result.review.pins.length, 1);
  assert.equal(result.issues.length, 2);
  assert.match(result.issues[0].reason, /changed bytes/);
  assert.match(result.issues[1].reason, /conflicting design content/);
});
