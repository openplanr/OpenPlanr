import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { digestArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';
import { acquireStartLock } from '@openplanr/artifact/internal/server-util.mjs';
import { createReviewLedger } from '@openplanr/artifact/merge.mjs';
import { createArtifactReview, writeArtifactReviewState } from '@openplanr/artifact/review.mjs';
import { atomicJson, currentDesign, hash, renderDesignDocument } from '../lib/design/document.mjs';
import { importDesignFeedback, readDesignFeedbackImport } from '../lib/design/feedback-import.mjs';
import {
  designReviewPath,
  exportDesignReview,
  readDesignFeedback,
  saveDesignState,
} from '../lib/design/review.mjs';
import { designUtility } from '../lib/design/utility.mjs';
import { designFixture } from './design-fixture.mjs';

const time = '2026-09-30T10:00:00.000Z';
async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'design-feedback-import-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { file, document } = designFixture(root, { count: 1, variants: 2 });
  const env = { ...process.env, PLANR_HOME: join(root, 'private-home') };
  await renderDesignDocument(file);
  const current = currentDesign(file);
  const input = join(root, 'downloaded-feedback.json');
  const review = createArtifactReview({
    reviewId: 'download-review',
    reviewOf: digestArtifactEnvelope(current.envelope),
    decision: 'approved',
    overall: 'Review recommendation',
    createdAt: time,
    updatedAt: time,
    pins: [
      {
        id: 'pin-one',
        author: { name: 'Morgan', id: 'morgan' },
        artifactId: current.entries[0].artifactId,
        region: { x: 0.2, y: 0.3, w: 0.1, h: 0.1 },
        viewport: current.envelope.artifacts[0].viewport,
        anchor: { planrId: 'action-1', screen: 'screen-1' },
        intent: 'improve',
        status: 'open',
        comment: 'Keep this comment and its exact location.',
        replies: [
          {
            id: 'reply-one',
            author: { name: 'Kai' },
            comment: 'Keep this reply.',
            createdAt: time,
          },
        ],
        createdAt: time,
        updatedAt: time,
      },
    ],
  });
  const path = designReviewPath(file, env);
  const save = (value) => writeFileSync(input, JSON.stringify(value));
  const run = (options = {}) =>
    importDesignFeedback(file, { input, revision: currentDesign(file).revision, env, ...options });
  save(review);
  return { root, file, document, current, env, input, review, path, save, run };
}

test('canonical import preserves owner state, attribution and decisions, and repeated imports are idempotent', async (t) => {
  const f = await fixture(t);
  await saveDesignState(f.file, {
    revision: f.current.revision,
    stateVersion: 0,
    state: {
      selectedVariant: 'B',
      ratings: { B: 5 },
      preferences: { selected: ['B'], rejected: ['A'] },
    },
  });
  const ownerPath = join(f.root, '.design/studio-state.json');
  const ownerBytes = readFileSync(ownerPath);
  const result = await f.run();
  assert.equal(result.imported[0].pins, 1);
  const saved = readDesignFeedback(f.file, f.env);
  assert.equal(saved.ledger.reviews[0].review.decision, 'pending');
  assert.deepEqual(saved.pins[0].author, f.review.pins[0].author);
  assert.deepEqual(saved.pins[0].replies, f.review.pins[0].replies);
  assert.deepEqual(readFileSync(ownerPath), ownerBytes);
  assert.equal(statSync(f.path).mode & 0o077, 0);
  const before = readFileSync(f.path);
  await f.run();
  assert.deepEqual(readFileSync(f.path), before);
  const ledger = saved.ledger;
  ledger.reviews[0].review.decision = 'approved';
  writeArtifactReviewState(f.path, ledger);
  await f.run();
  assert.equal(
    readDesignFeedback(f.file, f.env).ledger.reviews[0].review.decision,
    'approved',
    'Existing owner verdict is never downgraded or replaced by imported recommendations',
  );
});

test('current feedback export can be reconciled without duplicating its review or changing owner dispositions', async (t) => {
  const f = await fixture(t);
  await f.run();
  const metadataPath = join(f.root, '.design/review-metadata.json');
  atomicJson(metadataPath, {
    version: 1,
    byRevision: {
      'download-review': {
        categories: { 'pin-one': 'change' },
        dispositions: {
          'pin-one': {
            disposition: 'accept',
            reason: 'Owner decision',
            author: 'Owner',
            updatedAt: time,
          },
        },
      },
    },
  });
  const metadataBytes = readFileSync(metadataPath);
  const exported = exportDesignReview(f.file, { env: f.env });
  f.save(exported);
  const before = readFileSync(f.path);
  await f.run();
  assert.deepEqual(readFileSync(f.path), before);
  assert.deepEqual(readFileSync(metadataPath), metadataBytes);
  assert.equal(readDesignFeedback(f.file, f.env).pins.length, 1);
});

test('a portable Design feedback JSON export imports through the private utility without remote sync', async (t) => {
  const f = await fixture(t);
  await f.run();
  const exported = exportDesignReview(f.file, { env: f.env });
  exported.groups[0].threads[0].disposition = {
    value: 'accept',
    explanation: 'Reviewer recommendation',
  };
  exported.ratings = { B: 5 };
  exported.preferences = { selected: ['B'] };
  rmSync(f.path);
  f.save(exported);
  const result = await designUtility(
    [
      'feedback',
      f.file,
      '--action',
      'import',
      '--input',
      f.input,
      '--revision',
      f.current.revision,
    ],
    {
      env: f.env,
      stdout() {},
      fetchImpl() {
        throw Error('Import must be entirely local');
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(readDesignFeedback(f.file, f.env).pins[0].comment, f.review.pins[0].comment);
  assert.equal(existsSync(join(f.root, '.design/review-metadata.json')), false);
  assert.equal(existsSync(join(f.root, '.design/studio-state.json')), false);
  assert.equal(readDesignFeedback(f.file, f.env).ledger.reviews[0].review.decision, 'pending');
});

test('earlier revision feedback needs explicit stale confirmation and retains original geometry', async (t) => {
  const f = await fixture(t);
  writeFileSync(
    join(f.root, 'source/screen-1.html'),
    readFileSync(join(f.root, 'source/screen-1.html'), 'utf8').replace(
      '12 active tasks',
      '18 active tasks',
    ),
  );
  await renderDesignDocument(f.file);
  await assert.rejects(
    () => f.run(),
    (error) => error.code === 'E_ARTIFACT_STALE_REVIEW',
  );
  await f.run({ allowStale: true });
  const pin = readDesignFeedback(f.file, f.env).pins[0];
  assert.equal(pin.stale, true);
  assert.deepEqual(pin.region, f.review.pins[0].region);
  assert.equal(pin.reviewOf, f.review.reviewOf);
});

test('document, digest, frame, anchor and exported lineage mismatches fail without replacing feedback', async (t) => {
  const f = await fixture(t);
  await f.run();
  const before = readFileSync(f.path);
  const variants = [
    { ...f.review, reviewOf: 'f'.repeat(64) },
    { ...f.review, pins: [{ ...f.review.pins[0], artifactId: 'another-screen' }] },
    { ...f.review, pins: [{ ...f.review.pins[0], viewport: { width: 1441, height: 1024 } }] },
    { ...f.review, pins: [{ ...f.review.pins[0], anchor: { planrId: 'missing-anchor' } }] },
    { ...f.review, pins: [{ ...f.review.pins[0], region: { x: 0.9, y: 0, w: 0.2, h: 0 } }] },
    createReviewLedger({
      artifactId: 'another-design',
      currentReviewOf: f.review.reviewOf,
      reviews: [{ review: f.review, stale: false }],
    }),
  ];
  const snapshot = exportDesignReview(f.file, { env: f.env });
  variants.push({ ...snapshot, design: { ...snapshot.design, id: 'another-document' } });
  const badLineage = structuredClone(snapshot);
  badLineage.groups[0].threads[0].source.revisionId = 'another-revision';
  variants.push(badLineage);
  for (const value of variants) {
    f.save(value);
    await assert.rejects(() => f.run({ allowStale: true }));
    assert.deepEqual(readFileSync(f.path), before);
  }
});

test('duplicate and divergent identities are rejected before any import writes', async (t) => {
  const f = await fixture(t);
  await f.run();
  const before = readFileSync(f.path);
  f.save({ ...f.review, pins: [f.review.pins[0], f.review.pins[0]] });
  await assert.rejects(() => f.run());
  f.save({
    ...f.review,
    pins: [{ ...f.review.pins[0], comment: 'Concurrent conflicting comment' }],
  });
  await assert.rejects(
    () => f.run(),
    (error) => error.code === 'E_ARTIFACT_MERGE_CONFLICT',
  );
  assert.deepEqual(readFileSync(f.path), before);
});

test('a stale caller waiting for the render lock cannot import into a changed revision', async (t) => {
  const f = await fixture(t);
  const release = await acquireStartLock(join(f.root, '.design/render.lock'));
  const result = f.run({ revision: f.current.revision });
  const assertion = assert.rejects(
    () => result,
    (error) => error.code === 'E_ARTIFACT_STALE_REVIEW',
  );
  atomicJson(join(f.root, '.design/current.json'), { revision: 'f'.repeat(64) });
  // Keep a readable immutable target while changing only the current pointer.
  mkdirSync(join(f.root, '.design/revisions', 'f'.repeat(64)), { recursive: true });
  const rendered = JSON.parse(
    readFileSync(join(f.root, '.design/revisions', f.current.revision, 'render.json'), 'utf8'),
  );
  rendered.revision = 'f'.repeat(64);
  atomicJson(join(f.root, '.design/revisions', 'f'.repeat(64), 'render.json'), rendered);
  release();
  await assertion;
  assert.equal(readDesignFeedback(f.file, f.env).ledger, null);
});

test('concurrent imports merge the latest ledger under its shared lock', async (t) => {
  const f = await fixture(t);
  const secondInput = join(f.root, 'second.json');
  writeFileSync(
    secondInput,
    JSON.stringify({
      ...f.review,
      reviewId: 'second-review',
      pins: [{ ...f.review.pins[0], id: 'second-pin' }],
    }),
  );
  await Promise.all([f.run(), f.run({ input: secondInput })]);
  assert.equal(readDesignFeedback(f.file, f.env).pins.length, 2);
});

test('legacy notes, corrupt state and oversized or invalid UTF-8 input are preserved and rejected', async (t) => {
  const f = await fixture(t);
  await f.run();
  const before = readFileSync(f.path);
  const legacy = join(f.root, '.feedback/notes.json');
  mkdirSync(join(f.root, '.feedback'), { recursive: true });
  writeFileSync(legacy, JSON.stringify({ notes: [{ text: 'Historical browser note' }] }));
  const legacyBytes = readFileSync(legacy);
  await assert.rejects(() => f.run({ input: legacy }), /Legacy notes.json/);
  assert.deepEqual(readFileSync(legacy), legacyBytes);
  assert.deepEqual(readFileSync(f.path), before);
  const oversized = join(f.root, 'oversized.json');
  writeFileSync(oversized, '');
  truncateSync(oversized, 5 * 1024 * 1024 + 1);
  assert.throws(
    () => readDesignFeedbackImport(oversized),
    (error) => error.code === 'E_ARTIFACT_REQUEST_LIMIT',
  );
  writeFileSync(f.input, Buffer.from([0xff, 0xfe]));
  assert.throws(() => readDesignFeedbackImport(f.input), /UTF-8 JSON/);
  f.save(f.review);
  writeFileSync(f.path, '{broken');
  await assert.rejects(() => f.run());
  assert.equal(readFileSync(f.path, 'utf8'), '{broken');
});

test('current revision and stale confirmation cannot be inferred from downloaded comments', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    () => f.run({ revision: undefined }),
    /requires the current render revision/,
  );
  await assert.rejects(() => f.run({ allowStale: 'true' }), /explicit boolean/);
});

test('canonical review envelopes and matching ledgers retain their review custody', async (t) => {
  for (const format of ['envelope', 'ledger']) {
    const f = await fixture(t);
    f.save(
      format === 'envelope'
        ? { ...f.current.envelope, review: f.review }
        : createReviewLedger({
            artifactId: `design-${hash(f.document.id).slice(0, 24)}`,
            currentReviewOf: f.review.reviewOf,
            reviews: [{ review: f.review, stale: false }],
          }),
    );
    await f.run();
    const imported = readDesignFeedback(f.file, f.env).ledger.reviews[0].review;
    assert.equal(imported.reviewId, f.review.reviewId);
    assert.equal(imported.createdAt, f.review.createdAt);
    assert.equal(imported.decision, 'pending');
    assert.deepEqual(imported.pins, f.review.pins);
  }
});
