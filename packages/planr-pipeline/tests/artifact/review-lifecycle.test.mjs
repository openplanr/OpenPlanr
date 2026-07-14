import assert from 'node:assert/strict';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';

import {
  artifactReviewToDesignFeedback,
  designFeedbackToArtifactReview,
} from '../../lib/design-engine/feedback.mjs';
import {
  createArtifactEnvelope,
  digestArtifactEnvelope,
  validateArtifactReview,
} from '../../lib/artifact/envelope.mjs';
import {
  createArtifactReview,
  createArtifactReviewEnvelope,
  createReviewLedger,
  effectiveReviewDecision,
  exportArtifactReview,
  importArtifactReview,
  mergeArtifactReviews,
  mergeReviewLedger,
  readArtifactReviewState,
  resolveArtifactReviewDestination,
  writeArtifactReviewState,
} from '../../lib/artifact/index.mjs';
import {
  ARTIFACT_REVIEW_MAX_STATE_BYTES,
  closeArtifactReviewServers,
  startArtifactReview,
} from '../../lib/artifact/review-server.mjs';
import { ARTIFACT_ERROR_CODES } from '../../lib/pipeline/errors.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, '__fixtures__', name), 'utf8');
const roots = [];
const temporary = (prefix = 'planr-review-') => {
  const path = mkdtempSync(join(tmpdir(), prefix));
  roots.push(path);
  return path;
};

afterEach(async () => {
  await closeArtifactReviewServers();
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function envelope(html = '<!doctype html><title>Checkout</title><button>Pay</button>') {
  return createArtifactEnvelope({
    artifacts: [{
      id: 'checkout', title: 'Checkout flow', html,
      viewport: { width: 1440, height: 900 }, colorScheme: 'light',
    }],
  });
}

function pin({
  id = 'pin-1',
  status = 'open',
  comment = 'Clarify the delivery timing.',
  updatedAt = '2026-07-14T10:00:00.000Z',
  replies = [{
    id: 'reply-1', author: { name: 'Sam' }, comment: 'Agreed.',
    createdAt: '2026-07-14T10:05:00.000Z',
  }],
} = {}) {
  return {
    id,
    author: { id: 'reviewer-1', name: 'Asem' },
    artifactId: 'checkout',
    variant: 'desktop',
    region: { x: 0.25, y: 0.5, w: 0.2, h: 0.1 },
    viewport: { width: 1440, height: 900 },
    anchor: { planrId: 'delivery', screen: 'checkout' },
    intent: 'fix', status, comment, replies,
    createdAt: '2026-07-14T10:00:00.000Z', updatedAt,
  };
}

function review(reviewOf, overrides = {}) {
  const { reviewId = 'review-1', ...rest } = overrides;
  return createArtifactReview({
    reviewId, reviewOf,
    decision: 'changes_requested',
    overall: 'Resolve delivery timing before approval.',
    pins: [pin()],
    createdAt: '2026-07-14T09:00:00.000Z',
    updatedAt: '2026-07-14T10:10:00.000Z',
    ...rest,
  });
}

function http(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolveRequest, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolveRequest({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.once('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test('review creation, immutable envelope, and canonical JSON/Markdown exports match golden files', () => {
  const current = envelope();
  const digest = digestArtifactEnvelope(current);
  const value = review(digest);
  validateArtifactReview(value);
  const ledger = mergeReviewLedger(createReviewLedger({
    artifactId: 'checkout', currentReviewOf: digest,
  }), value);
  assert.equal(exportArtifactReview(ledger, { format: 'json' }), fixture('review-export.golden.json'));
  assert.equal(exportArtifactReview(ledger, { format: 'markdown' }), fixture('review-export.golden.md'));
  const attached = createArtifactReviewEnvelope(current, value);
  assert.equal(attached.review.reviewId, 'review-1');
  assert.equal(Object.isFrozen(attached), true);
  assert.equal(Object.isFrozen(attached.review.pins[0].region), true);
});

test('stable merge is idempotent, deterministic, conflict-safe, and preserves distinct verdicts', () => {
  const digest = digestArtifactEnvelope(envelope());
  const original = review(digest);
  const changed = review(digest, {
    decision: 'approved', overall: '',
    updatedAt: '2026-07-14T11:00:00.000Z',
    pins: [pin({
      status: 'resolved', updatedAt: '2026-07-14T10:30:00.000Z',
      replies: [pin().replies[0], {
        id: 'reply-2', author: { name: 'Asem' }, comment: 'Fixed.',
        createdAt: '2026-07-14T10:20:00.000Z',
      }],
    })],
  });
  const merged = mergeArtifactReviews(original, changed);
  assert.equal(merged.decision, 'approved');
  assert.equal(merged.overall, '');
  assert.equal(merged.pins[0].status, 'resolved');
  assert.deepEqual(merged.pins[0].replies.map(({ id }) => id), ['reply-1', 'reply-2']);
  assert.equal(mergeArtifactReviews(merged, changed), merged, 'identical replay is a reference no-op');
  assert.throws(() => mergeArtifactReviews(original, {
    ...original, overall: 'divergent equal-time value',
  }), (error) => error.code === ARTIFACT_ERROR_CODES.MERGE_CONFLICT);
  assert.throws(() => mergeArtifactReviews(original, {
    ...original, pins: [pin({ replies: [...pin().replies, pin().replies[0]] })],
  }), (error) => error.code === ARTIFACT_ERROR_CODES.REVIEW_INVALID);

  let ledger = createReviewLedger({ artifactId: 'checkout', currentReviewOf: digest });
  ledger = mergeReviewLedger(ledger, changed);
  ledger = mergeReviewLedger(ledger, review(digest, {
    reviewId: 'review-2', decision: 'changes_requested',
    createdAt: '2026-07-14T12:00:00.000Z', updatedAt: '2026-07-14T12:00:00.000Z', pins: [],
  }));
  assert.equal(effectiveReviewDecision(ledger), 'changes_requested');
  assert.deepEqual(ledger.reviews.map(({ review: item }) => item.reviewId), ['review-1', 'review-2']);
});

test('transport-neutral import redacts decoder inputs and stale review details', async () => {
  const current = envelope();
  const currentDigest = digestArtifactEnvelope(current);
  const staleDigest = digestArtifactEnvelope(envelope('<!doctype html><p>Old</p>'));
  const source = 'https://share.openplanr.dev/p/private#k=SECRET';
  await assert.rejects(
    importArtifactReview({ sources: source, currentEnvelope: current, persist: false }),
    (error) => error.code === ARTIFACT_ERROR_CODES.REVIEW_DECODER_REQUIRED
      && !JSON.stringify(error).includes('SECRET'),
  );
  await assert.rejects(
    importArtifactReview({
      sources: source, currentEnvelope: current, persist: false,
      decodeSource: async () => { throw new Error(`leak ${source}`); },
    }),
    (error) => error.code === ARTIFACT_ERROR_CODES.REVIEW_IMPORT
      && error.details.sourceIndex === 0 && !JSON.stringify(error).includes('SECRET'),
  );
  await assert.rejects(
    importArtifactReview({
      sources: review(staleDigest), currentEnvelope: current, persist: false,
    }),
    (error) => error.code === ARTIFACT_ERROR_CODES.STALE_REVIEW
      && error.details.localDigest === currentDigest
      && error.details.reviewDigest === staleDigest
      && !Object.hasOwn(error.details, 'reviewId'),
  );
  const accepted = await importArtifactReview({
    sources: review(staleDigest), currentEnvelope: current, persist: false, allowStale: true,
  });
  assert.equal(accepted.reviewState.reviews[0].stale, true);
  assert.equal(accepted.reviewState.reviews[0].review.reviewOf, staleDigest);
  const staleLedger = createReviewLedger({
    artifactId: 'checkout',
    currentReviewOf: currentDigest,
    reviews: [{ review: review(currentDigest), stale: true }],
  });
  const retained = await importArtifactReview({
    sources: staleLedger, currentEnvelope: current, persist: false,
  });
  assert.equal(retained.reviewState.reviews[0].stale, true, 'source ledger audit label survives');
  assert.doesNotMatch(
    readFileSync(join(here, '..', '..', 'lib', 'artifact', 'import.mjs'), 'utf8'),
    /from ['"]\.\/(?:codec|crypto|share-client)/,
  );
});

test('project, user, HOME, worktree, traversal, symlink, and atomic destinations are safe', async () => {
  const home = temporary('planr-review-home-');
  const planr = join(home, '.planr-test');
  const env = { ...process.env, HOME: home, PLANR_HOME: planr };
  const project = temporary('planr-review-project-');
  mkdirSync(join(project, '.git'));
  writeFileSync(join(project, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const nested = join(project, 'packages', 'app');
  mkdirSync(nested, { recursive: true });
  assert.equal(resolveArtifactReviewDestination({ cwd: nested, env, artifactId: 'checkout' }).kind, 'project');
  assert.equal(resolveArtifactReviewDestination({ cwd: home, env, artifactId: 'checkout' }).kind, 'user');
  assert.throws(
    () => resolveArtifactReviewDestination({ cwd: nested, env, artifactId: '../escape' }),
    (error) => error.code === ARTIFACT_ERROR_CODES.PATH_TRAVERSAL,
  );

  const current = envelope();
  const value = review(digestArtifactEnvelope(current));
  const first = await importArtifactReview({ sources: value, currentEnvelope: current, cwd: nested, env });
  assert.equal(first.destination.kind, 'project');
  const destination = resolveArtifactReviewDestination({ cwd: nested, env, artifactId: 'checkout' });
  assert.equal(readArtifactReviewState(destination.path).reviews.length, 1);
  const repeated = await Promise.all([
    importArtifactReview({ sources: value, currentEnvelope: current, cwd: nested, env }),
    importArtifactReview({ sources: value, currentEnvelope: current, cwd: nested, env }),
  ]);
  assert.equal(repeated[1].reviewState.reviews.length, 1);

  rmSync(destination.path);
  symlinkSync(join(home, 'outside.json'), destination.path);
  assert.throws(
    () => readArtifactReviewState(destination.path),
    (error) => error.code === ARTIFACT_ERROR_CODES.SYMLINK_ESCAPE,
  );
  assert.throws(
    () => writeArtifactReviewState(destination.path, first.reviewState),
    (error) => error.code === ARTIFACT_ERROR_CODES.REVIEW_WRITE,
  );
  assert.equal(lstatSync(destination.path).isSymbolicLink(), true);
});

test('design translation preserves every legacy-only field and persists a stale-aware sidecar transactionally', async () => {
  const designDir = temporary('planr-design-review-');
  const current = envelope();
  const digest = digestArtifactEnvelope(current);
  const legacy = {
    schema_version: '1.0.0', boardId: 'board-1', publishedAt: '2026-07-14T08:00:00.000Z',
    preferred: 'A', ratings: { A: 5 }, comments: { A: 'Keep it' }, overall: 'Legacy overall',
    regenerated: true, regenerateAction: 'remix', remixSpec: { layoutFrom: 'A' },
    authors: [{ name: 'Legacy', color: '--avatar-2', initials: 'LG', lastSeen: '2026-07-14T08:00:00.000Z' }],
    pins: [{
      id: 'legacy-pin', author: 'Legacy', variant: 'A',
      x: 0.1, y: 0.2, w: 0, h: 0, comment: 'Legacy pin', intent: 'question',
      replies: [{ author: 'Legacy', comment: 'Legacy reply without an ID' }],
    }],
  };
  writeFileSync(join(designDir, 'feedback.json'), `${JSON.stringify(legacy, null, 2)}\n`);
  const result = await importArtifactReview({
    sources: review(digest), currentEnvelope: current, designDir,
  });
  assert.equal(result.destination.kind, 'design');
  const stored = JSON.parse(readFileSync(join(designDir, 'feedback.json'), 'utf8'));
  assert.deepEqual(stored.ratings, legacy.ratings);
  assert.deepEqual(stored.comments, legacy.comments);
  assert.equal(stored.preferred, legacy.preferred);
  assert.equal(stored.regenerated, true);
  assert.equal(stored.regenerateAction, 'remix');
  assert.deepEqual(stored.remixSpec, legacy.remixSpec);
  assert.equal(stored.overall, 'Resolve delivery timing before approval.');
  const sidecar = readArtifactReviewState(join(designDir, 'artifact-review-state.json'));
  assert.equal(sidecar.reviews[0].review.reviewId, 'review-1');

  const generic = designFeedbackToArtifactReview(legacy, { reviewOf: digest });
  assert.equal(generic.createdAt, '2026-07-14T08:00:00.000Z');
  assert.deepEqual(artifactReviewToDesignFeedback(generic, { storedFeedback: legacy }).ratings, legacy.ratings);
  assert.deepEqual(
    designFeedbackToArtifactReview(legacy, { reviewOf: digest }),
    designFeedbackToArtifactReview(legacy, { reviewOf: digest }),
    'legacy fallback IDs and times are deterministic',
  );
  const cleared = artifactReviewToDesignFeedback(review(digest, { overall: '' }), {
    storedFeedback: legacy,
  });
  assert.equal(cleared.overall, '', 'an explicit empty overall clears the legacy note');
});

test('design feedback and sidecar final-file symlinks are rejected without following them', async () => {
  const current = envelope();
  const value = review(digestArtifactEnvelope(current));
  const external = temporary('planr-review-external-');

  const feedbackDir = temporary('planr-design-feedback-link-');
  const externalFeedback = join(external, 'feedback.json');
  writeFileSync(externalFeedback, '{}\n');
  symlinkSync(externalFeedback, join(feedbackDir, 'feedback.json'));
  await assert.rejects(
    importArtifactReview({ sources: value, currentEnvelope: current, designDir: feedbackDir }),
    (error) => error.code === ARTIFACT_ERROR_CODES.SYMLINK_ESCAPE,
  );

  const stateDir = temporary('planr-design-state-link-');
  const externalState = join(external, 'state.json');
  writeFileSync(externalState, '{}\n');
  symlinkSync(externalState, join(stateDir, 'artifact-review-state.json'));
  await assert.rejects(
    importArtifactReview({ sources: value, currentEnvelope: current, designDir: stateDir }),
    (error) => error.code === ARTIFACT_ERROR_CODES.SYMLINK_ESCAPE,
  );
  assert.equal(readFileSync(externalFeedback, 'utf8'), '{}\n');
  assert.equal(readFileSync(externalState, 'utf8'), '{}\n');
});

test('atomic write failure leaves old design feedback and ledger byte-for-byte intact', async () => {
  const designDir = temporary('planr-design-atomic-');
  const current = envelope();
  const digest = digestArtifactEnvelope(current);
  await importArtifactReview({ sources: review(digest), currentEnvelope: current, designDir });
  const feedbackPath = join(designDir, 'feedback.json');
  const statePath = join(designDir, 'artifact-review-state.json');
  const beforeFeedback = readFileSync(feedbackPath);
  const beforeState = readFileSync(statePath);
  let renames = 0;
  await assert.rejects(importArtifactReview({
    sources: review(digest, {
      reviewId: 'review-2', createdAt: '2026-07-14T12:00:00.000Z',
      updatedAt: '2026-07-14T12:00:00.000Z', pins: [],
    }),
    currentEnvelope: current,
    designDir,
    fileSystem: {
      renameSync(...args) {
        renames += 1;
        if (renames === 4) throw new Error('injected rename failure');
        return renameSync(...args);
      },
    },
  }), (error) => error.code === ARTIFACT_ERROR_CODES.REVIEW_WRITE);
  assert.deepEqual(readFileSync(feedbackPath), beforeFeedback);
  assert.deepEqual(readFileSync(statePath), beforeState);
});

test('capability routes enforce exact Origin, five-MiB bounds, atomic persistence, and cross-session path merging', async () => {
  const home = temporary('planr-review-server-');
  const cwd = temporary('planr-review-cwd-');
  const env = { ...process.env, HOME: home, PLANR_HOME: join(home, '.planr') };
  const current = envelope();
  const digest = digestArtifactEnvelope(current);
  const [first, second] = await Promise.all([
    startArtifactReview({ envelope: current, env, cwd, noOpen: true }),
    startArtifactReview({ envelope: current, env, cwd, noOpen: true }),
  ]);
  const firstUrl = new URL(first.url);
  const secondUrl = new URL(second.url);
  const firstApi = `${firstUrl.pathname}api/review`;
  const secondApi = `${secondUrl.pathname}api/review`;
  assert.equal((await http(first.port, firstApi)).status, 200, 'origin-less read is safe');
  assert.equal((await http(first.port, firstApi, { headers: { origin: 'https://evil.test' } })).status, 403);
  assert.equal((await http(first.port, firstApi, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(review(digest)),
  })).status, 403, 'origin-less public mutation is rejected');
  const origin = `http://127.0.0.1:${first.port}`;
  const [one, two] = await Promise.all([
    http(first.port, firstApi, {
      method: 'PUT', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(review(digest)),
    }),
    http(second.port, secondApi, {
      method: 'PUT', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(review(digest, {
        reviewId: 'review-2', pins: [],
        createdAt: '2026-07-14T12:00:00.000Z', updatedAt: '2026-07-14T12:00:00.000Z',
      })),
    }),
  ]);
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
  const durable = await first.getReview();
  assert.deepEqual(durable.reviewState.reviews.map((entry) => entry.review.reviewId), ['review-1', 'review-2']);
  assert.match(await first.exportReview('markdown'), /Effective decision/);
  assert.doesNotMatch(JSON.stringify(durable), /review-state\.json|planr-review-server/);

  const tooLarge = await http(first.port, firstApi, {
    method: 'PUT',
    headers: {
      origin,
      'content-type': 'application/json',
      'content-length': String(ARTIFACT_REVIEW_MAX_STATE_BYTES + 1),
    },
  });
  assert.equal(tooLarge.status, 413);
  await first.close();
  await second.close();
});

test('oversized durable review state is rejected before JSON parsing', () => {
  const root = temporary('planr-review-oversized-');
  const path = join(root, 'review-state.json');
  writeFileSync(path, ' '.repeat(ARTIFACT_REVIEW_MAX_STATE_BYTES + 1));
  assert.throws(
    () => readArtifactReviewState(path),
    (error) => error.code === ARTIFACT_ERROR_CODES.REQUEST_LIMIT,
  );
});
