import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { designFixture } from './design-fixture.mjs';
import { prepareDesignDocument, renderDesignDocument, currentDesign, atomicJson } from '../lib/design/document.mjs';
import { emptyReviewContext, loadReviewContext, bundleDesignRevision, listDesignRevisions, readDesignRevision } from '../lib/design/context.mjs';
import { assertDesignReviewBundle } from '@openplanr/protocol/review-experience-contracts';
import { readDesignHandoff, updateDesignHandoff } from '../lib/design/handoff.mjs';
import { designReviewPath, startDesignReview } from '../lib/design/review.mjs';
import { createReviewLedger } from '@openplanr/artifact/merge.mjs';
import { readArtifactReviewState, writeArtifactReviewState } from '@openplanr/artifact/review.mjs';
import { digestArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'planr-experience-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const value = designFixture(root);
  return { ...value, root, env: { ...process.env, PLANR_HOME: join(root, '.test-home') } };
}
test('review context is optional and rejects paths, incorrect identities, excess prompts and missing screen references', t => {
  const { root, file, document } = fixture(t);
  assert.equal(prepareDesignDocument(file).reviewContext.brief.purpose, '');
  const value = emptyReviewContext(document);
  const path = join(root, 'review-context.json');
  for (const invalid of [
    { ...value, designId: 'other' },
    { ...value, brief: { purpose: '/Users/private/customer', requests: [] } },
    { ...value, brief: { purpose: 'Review', requests: ['a', 'b', 'c', 'd'] } },
    { ...value, implementation: { ...value.implementation, components: [{ id: 'nav', name: 'Nav', screenIds: ['missing'] }] } },
  ]) {
    atomicJson(path, invalid); assert.throws(() => loadReviewContext(root, document));
  }
});
test('fingerprints scope source edits and distinguish guidance from authored content', t => {
  const { root, file, document } = fixture(t);
  const first = prepareDesignDocument(file);
  const source = join(root, 'source/screen-1.html');
  writeFileSync(source, readFileSync(source, 'utf8').replace('12 active tasks', '13 active tasks'));
  const edited = prepareDesignDocument(file);
  for (const before of first.fingerprints) {
    const after = edited.fingerprints.find(item => item.screenId === before.screenId && item.frameId === before.frameId);
    assert.equal(after.contentDigest === before.contentDigest, before.screenId !== 'screen-1');
    assert.equal(after.guidanceDigest, before.guidanceDigest);
  }
  const context = emptyReviewContext(document);
  context.implementation.components = [{ id: 'button', name: 'Action', screenIds: ['screen-1'], states: [{ name: 'disabled', description: 'Wait for validation.' }] }];
  atomicJson(join(root, 'review-context.json'), context);
  const guided = prepareDesignDocument(file);
  for (const before of edited.fingerprints) {
    const after = guided.fingerprints.find(item => item.screenId === before.screenId && item.frameId === before.frameId);
    assert.equal(after.contentDigest, before.contentDigest);
    assert.equal(after.guidanceDigest === before.guidanceDigest, before.screenId !== 'screen-1');
  }
  const bundle = bundleDesignRevision(guided);
  assertDesignReviewBundle(bundle);
  assert.ok(!JSON.stringify(bundle).includes(root));
  const legacy = structuredClone(bundle);
  legacy.schemaVersion = '1.0.0'; delete legacy.reviewContext; delete legacy.contextDigest; delete legacy.fingerprints;
  assertDesignReviewBundle(legacy);
  assert.throws(() => assertDesignReviewBundle({ ...bundle, unexpected: true }));
});
test('runtime-only revisions keep authored fingerprints and preserve prior review bundles', async t => {
  const { file } = fixture(t);
  const first = await renderDesignDocument(file, { rendererRevision: 'one' });
  const second = await renderDesignDocument(file, { rendererRevision: 'two' });
  assert.notEqual(first.revision, second.revision);
  assert.deepEqual(readDesignRevision(file, first.revision).fingerprints, readDesignRevision(file, second.revision).fingerprints);
  assert.equal(listDesignRevisions(file).revisions.length, 2);
  assert.throws(() => readDesignRevision(file, '../current'));
});
function seedReview(file, env, comment = 'Make the primary action clearer.') {
  const current = currentDesign(file);
  const reviewOf = digestArtifactEnvelope(current.envelope);
  const review = { schemaVersion: '1.0.0', reviewId: 'local-review', reviewOf, decision: 'pending', overall: '', pins: [{
    id: 'pin-1', artifactId: current.entries[0].artifactId, author: { name: 'Alex' }, region: { x: 0.2, y: 0.2, w: 0, h: 0 }, viewport: { width: 1440, height: 1024 },
    intent: 'improve', status: 'open', comment, replies: [], createdAt: '2026-09-10T10:00:00Z', updatedAt: '2026-09-10T10:00:00Z',
  }] };
  writeArtifactReviewState(designReviewPath(file, env), createReviewLedger({ artifactId: 'operations', currentReviewOf: reviewOf, reviews: [{ review, stale: false }] }));
}
test('categorizing a requested change preserves the open pin and requires a separate owner disposition', async t => {
  const { file, env } = fixture(t);
  const { revision } = await renderDesignDocument(file); seedReview(file, env);
  const changed = await updateDesignHandoff(file, { action: 'category', revision, version: 0, pinId: 'pin-1', category: 'change-request' }, { env });
  assert.equal(changed.metadata.categories['pin-1'], 'change-request');
  assert.deepEqual(changed.metadata.dispositions, {});
  assert.equal(changed.feedback.pins[0].intent, 'improve');
  assert.equal(changed.feedback.pins[0].status, 'open');
  const drafted = await updateDesignHandoff(file, { action: 'draft', revision, version: 0 }, { env });
  assert.equal(drafted.draft.content.agreedChanges.length, 0);
  assert.equal(drafted.draft.content.openQuestions[0].pinId, 'pin-1');
});
test('owner handoff groups dispositions, binds citations, rejects conflicting writers and invalidates approval on new feedback', async t => {
  const { root, file, env } = fixture(t);
  const rendered = await renderDesignDocument(file); seedReview(file, env);
  const revision = rendered.revision;
  await updateDesignHandoff(file, { action: 'disposition', revision, version: 0, pinId: 'pin-1', disposition: 'accepted', reason: 'Improve discoverability' }, { env });
  assert.equal(readDesignHandoff(file, { env }).feedback.pins[0].status, 'open', 'Accepting work must not resolve it');
  let result = await updateDesignHandoff(file, { action: 'draft', revision, version: 0 }, { env });
  assert.equal(result.draft.content.agreedChanges[0].author, 'Alex');
  assert.equal(result.draft.content.agreedChanges[0].reviewOf, result.basis.reviewOf);
  assert.equal(result.draft.affectedScreens[0], 'screen-1');
  assert.ok(result.draft.verificationGaps.length);
  await assert.rejects(updateDesignHandoff(file, { action: 'approve', revision, version: 1, contentHash: result.draft.contentHash }, { env }), /summary/);
  const content = { ...result.draft.content, summary: 'Clarify the workspace primary action.' };
  content.agreedChanges[0].text = 'Use a prominent action with an explicit label.';
  const saves = await Promise.allSettled([1, 2].map(() => updateDesignHandoff(file, { action: 'update', revision, version: 1, content }, { env })));
  assert.equal(saves.filter(value => value.status === 'fulfilled').length, 1);
  result = readDesignHandoff(file, { env });
  assert.equal(result.draft.content.agreedChanges[0].text, 'Make the primary action clearer.');
  assert.equal(result.draft.content.agreedChanges[0].refinement, 'Use a prominent action with an explicit label.');
  result = await updateDesignHandoff(file, { action: 'approve', revision, version: 2, contentHash: result.draft.contentHash }, { env });
  assert.equal(result.draft.status, 'approved'); assert.equal(result.current, true);
  seedReview(file, env, 'Use a clear label and visible shortcut.');
  assert.equal(readDesignHandoff(file, { env }).current, false);
  await assert.rejects(updateDesignHandoff(file, { action: 'approve', revision, version: 3, contentHash: result.draft.contentHash }, { env }), /out of date/);
  const saved = readDesignHandoff(file, { env }); saved.draft.content.summary = 'tampered'; atomicJson(saved.path, saved.draft);
  assert.throws(() => readDesignHandoff(file, { env }), /digest/);
});
test('duplicate pin identities stay scoped to original reviews and overall notes invalidate approval', async t => {
  const { file, env } = fixture(t); const { revision } = await renderDesignDocument(file); seedReview(file, env);
  const path = designReviewPath(file, env), ledger = readArtifactReviewState(path);
  const second = structuredClone(ledger.reviews[0]); second.review.reviewId = 'other-review'; second.review.pins[0].comment = 'Different original quotation';
  writeArtifactReviewState(path, createReviewLedger({ ...ledger, reviews: [...ledger.reviews, second] }));
  await assert.rejects(updateDesignHandoff(file, { action: 'disposition', revision, version: 0, pinId: 'pin-1', disposition: 'accepted' }, { env }), /ambiguous/);
  await updateDesignHandoff(file, { action: 'disposition', revision, version: 0, pinId: 'pin-1', reviewId: 'local-review', disposition: 'accepted' }, { env });
  let result = await updateDesignHandoff(file, { action: 'draft', revision, version: 0 }, { env });
  assert.equal(result.draft.content.agreedChanges[0].text, 'Make the primary action clearer.');
  assert.equal(result.draft.content.openQuestions[0].text, 'Different original quotation');
  result = await updateDesignHandoff(file, { action: 'update', revision, version: 1, content: { ...result.draft.content, summary: 'Keep both original comments.' } }, { env });
  result = await updateDesignHandoff(file, { action: 'approve', revision, version: 2, contentHash: result.draft.contentHash }, { env });
  const updated = readArtifactReviewState(path); updated.reviews[0].review.overall = 'A new overall requirement.';
  writeArtifactReviewState(path, updated);
  assert.equal(readDesignHandoff(file, { env }).current, false);
});
test('owner APIs serve guidance/history and reject cross-origin handoff writes', async t => {
  const { file, env } = fixture(t); await renderDesignDocument(file);
  const server = await startDesignReview(file, { env }); t.after(() => server.close());
  const response = await fetch(`${server.url}api/design-experience`);
  assert.equal((await response.json()).capabilities.owner, true);
  const rejected = await fetch(`${server.url}api/design-handoff`, { method: 'POST', headers: { origin: 'https://outside.test', 'content-type': 'application/json', 'x-openplanr-design': '1' }, body: '{}' });
  assert.equal(rejected.status, 403);
  const history = await fetch(`${server.url}api/design-revisions`).then(response => response.json());
  assert.equal(history.revisions.length, 1);
});
