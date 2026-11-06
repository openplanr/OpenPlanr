import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { digestArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';
import { createReviewLedger } from '@openplanr/artifact/merge.mjs';
import { writeArtifactReviewState } from '@openplanr/artifact/review.mjs';
import { currentDesign, renderDesignDocument } from '../lib/design/document.mjs';
import { readDesignHandoff, updateDesignHandoff } from '../lib/design/handoff.mjs';
import { readDesignHandoffReadiness } from '../lib/design/handoff-reader.mjs';
import { designReviewKey, designReviewPath } from '../lib/design/review.mjs';
import { designFixture } from './design-fixture.mjs';

async function approvedHandoff(t, rendererRevision) {
  const root = mkdtempSync(join(tmpdir(), 'planr-handoff-currency-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { file } = designFixture(root);
  const env = { ...process.env, PLANR_HOME: join(root, '.test-home') };
  const { revision } = await renderDesignDocument(file, { rendererRevision });
  const drafted = await updateDesignHandoff(
    file,
    { action: 'draft', revision, version: 0 },
    { env },
  );
  const content = { ...drafted.draft.content, summary: 'Build the reviewed workspace overview.' };
  await updateDesignHandoff(file, { action: 'update', revision, version: 1, content }, { env });
  const { draft } = readDesignHandoff(file, { env });
  const approved = await updateDesignHandoff(
    file,
    { action: 'approve', revision, version: 2, contentHash: draft.contentHash },
    { env },
  );
  assert.equal(approved.current, true);
  return { root, file, env, revision };
}

const handoffCheck = (file, env) =>
  readDesignHandoffReadiness(file, { env }).readiness.checks.find(
    ({ id }) => id === 'approved-review-handoff',
  ).status;

/** Rewrites a render record as releases before the content revision wrote it. */
function withoutContentRevision(root, revision) {
  const path = join(root, '.design/revisions', revision, 'render.json');
  const { contentRevision, ...record } = JSON.parse(readFileSync(path, 'utf8'));
  assert.match(contentRevision, /^[a-f0-9]{64}$/u);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
}

test('a renderer-only re-render keeps an approved handoff current', async (t) => {
  const { file, env, revision } = await approvedHandoff(t, 'renderer-3.4.0');
  const upgraded = await renderDesignDocument(file, { rendererRevision: 'renderer-next' });
  assert.notEqual(upgraded.revision, revision);
  assert.equal(readDesignHandoff(file, { env }).current, true);
  assert.equal(handoffCheck(file, env), 'pass');
  const { checks } = readDesignHandoffReadiness(file, { env }).readiness;
  assert.equal(checks.find(({ id }) => id === 'rendered-verification').status, 'blocked');
});

test('one changed source or specification byte makes the approved handoff stale under any renderer', async (t) => {
  const edits = [
    ['source/style.css', '#275c46', '#275c47'],
    ['design-spec.md', 'project tokens.', 'project tokens!'],
  ];
  for (const [path, before, after] of edits)
    for (const recordedBefore of [false, true]) {
      const { root, file, env, revision } = await approvedHandoff(t, 'renderer-3.4.0');
      if (recordedBefore) withoutContentRevision(root, revision);
      writeFileSync(
        join(root, path),
        readFileSync(join(root, path), 'utf8').replace(before, after),
      );
      await renderDesignDocument(file, { rendererRevision: 'renderer-next' });
      assert.equal(readDesignHandoff(file, { env }).current, false, `${path}, ${recordedBefore}`);
      assert.equal(handoffCheck(file, env), 'stale', `${path}, ${recordedBefore}`);
    }
});

test('a render recorded without a content revision stays current after an upgrade render', async (t) => {
  const { root, file, env, revision } = await approvedHandoff(t, 'renderer-3.4.0');
  withoutContentRevision(root, revision);
  await renderDesignDocument(file, { rendererRevision: 'renderer-next' });
  assert.equal(readDesignHandoff(file, { env }).current, true);
});

test('new feedback alongside a renderer-only re-render makes the approved handoff stale', async (t) => {
  const { file, env } = await approvedHandoff(t, 'renderer-3.4.0');
  const current = currentDesign(file),
    reviewOf = digestArtifactEnvelope(current.envelope);
  const review = {
    schemaVersion: '1.0.0',
    reviewId: 'owner-review',
    reviewOf,
    decision: 'pending',
    overall: '',
    pins: [
      {
        id: 'primary-action',
        artifactId: current.entries[0].artifactId,
        author: { name: 'Morgan', id: 'morgan' },
        comment: 'Keep the primary action visible.',
        intent: 'improve',
        status: 'open',
        region: { x: 0.1, y: 0.2, w: 0, h: 0 },
        viewport: { width: 1440, height: 1024 },
        replies: [],
        createdAt: '2026-11-06T10:00:00Z',
        updatedAt: '2026-11-06T10:00:00Z',
      },
    ],
  };
  writeArtifactReviewState(
    designReviewPath(file, env),
    createReviewLedger({
      artifactId: designReviewKey(current.document),
      currentReviewOf: reviewOf,
      reviews: [{ review, stale: false }],
    }),
  );
  await renderDesignDocument(file, { rendererRevision: 'renderer-next' });
  assert.equal(readDesignHandoff(file, { env }).current, false);
  assert.equal(handoffCheck(file, env), 'stale');
});

test('a derived content revision counts only when it reproduces the recorded render', async (t) => {
  const { root, file, env, revision } = await approvedHandoff(t, 'renderer-3.4.0');
  withoutContentRevision(root, revision);
  const spec = join(root, 'design-spec.md');
  writeFileSync(spec, readFileSync(spec, 'utf8').replace('project tokens.', 'project tokens!'));
  await renderDesignDocument(file, { rendererRevision: 'renderer-next' });
  // The approved render's copy now claims the new specification it was never rendered from.
  writeFileSync(join(root, '.design/revisions', revision, 'design-spec.md'), readFileSync(spec));
  assert.equal(readDesignHandoff(file, { env }).current, false);
  assert.equal(handoffCheck(file, env), 'stale');
});
