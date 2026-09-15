import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { digestArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';
import { createReviewLedger } from '@openplanr/artifact/merge.mjs';
import { writeArtifactReviewState } from '@openplanr/artifact/review.mjs';
import { designFixture } from './design-fixture.mjs';
import { atomicJson, currentDesign, renderDesignDocument } from '../lib/design/document.mjs';
import { designReviewKey, designReviewPath, exportDesignReview, startDesignReview } from '../lib/design/review.mjs';
import { designUtility } from '../lib/design/utility.mjs';

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-export-local-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { file, document } = designFixture(root, { count: 1, frames: [{ id: 'desktop', label: 'Desktop', width: 1440, height: 1024 }] });
  document.brief.text = 'PRIVATE_LOCAL_BRIEF'; atomicJson(file, document);
  writeFileSync(join(root, 'private.txt'), 'PRIVATE_UNRELATED_FILE');
  const env = { ...process.env, PLANR_HOME: join(root, 'private-home') };
  await renderDesignDocument(file);
  const original = currentDesign(file);
  const review = (current, id, comment) => ({ schemaVersion: '1.0.0', reviewId: id, reviewOf: digestArtifactEnvelope(current.envelope), decision: 'pending', overall: id === 'local-current' ? 'Current overall note' : '', pins: [{
    id: 'pin', artifactId: current.entries[0].artifactId, author: { id: 'morgan', name: 'Morgan' }, intent: 'improve', status: 'open', comment,
    anchor: { planrId: 'action-1', screen: 'screen-1' }, region: { x: .4, y: .5, w: .2, h: .2 }, viewport: { width: 1440, height: 1024 },
    createdAt: '2026-09-11T10:00:00Z', updatedAt: '2026-09-11T10:01:00Z', replies: [{ id: 'reply', author: { name: 'Kai', id: 'kai' }, comment: 'Original reply', createdAt: '2026-09-11T10:01:00Z' }],
  }] });
  const oldReview = review(original, 'shared-published-old', 'Historical review text');
  document.screens[0].title = 'Updated workspace'; atomicJson(file, document);
  const source = join(root, 'source/screen-1.html'); writeFileSync(source, readFileSync(source, 'utf8').replace('12 active tasks', '13 active tasks'));
  await renderDesignDocument(file);
  const current = currentDesign(file), nowReview = review(current, 'local-current', 'Current review text');
  const unknown = { ...review(current, 'shared-missing-bundle', 'Do not relocate this pin'), reviewOf: 'f'.repeat(64) };
  writeArtifactReviewState(designReviewPath(file, env), createReviewLedger({ artifactId: designReviewKey(document), currentReviewOf: digestArtifactEnvelope(current.envelope), reviews: [oldReview, nowReview, unknown].map(review => ({ review, stale: review.reviewOf !== digestArtifactEnvelope(current.envelope) })) }));
  atomicJson(join(root, '.design/shared-feedback.json'), { importedReviews: { [oldReview.reviewId]: oldReview }, metadataByRevision: { 'published-old': { categories: { pin: 'question' }, dispositions: {} } }, issues: [], events: [] });
  atomicJson(join(root, '.design/review-metadata.json'), { version: 1, byRevision: { 'local-current': { categories: { pin: 'change' }, dispositions: { pin: { disposition: 'accept', reason: 'Owner explanation', author: 'Owner', updatedAt: '2026-09-11T11:00:00Z' } } } } });
  return { root, file, env, current, original };
}

test('local agent export preserves original revision, screen, frame, metadata and quotations without project material', async t => {
  const f = await fixture(t), before = readFileSync(designReviewPath(f.file, f.env), 'utf8');
  const exported = exportDesignReview(f.file, { env: f.env });
  assert.deepEqual(exportDesignReview(f.file, { env: f.env }), exported, 'Export is deterministic');
  assert.equal(exported.summary.threads, 3); assert.equal(exported.summary.replies, 3);
  const previous = exported.groups.find(group => group.sourceRevisionId === 'published-old');
  assert.equal(previous.screen.title, 'Workspace overview'); assert.equal(previous.screen.id, 'screen-1');
  assert.equal(previous.frame.id, 'desktop'); assert.equal(previous.frame.width, 1440); assert.equal(previous.threads[0].category, 'question');
  assert.equal(previous.threads[0].comment, 'Historical review text'); assert.equal(previous.threads[0].location.coordinateSpace, 'anchor-normalized');
  assert.equal(previous.threads[0].location.viewportPixels, null);
  const latest = exported.groups.find(group => group.reviewId === 'local-current');
  assert.equal(latest.screen.title, 'Updated workspace'); assert.equal(latest.threads[0].category, 'change'); assert.equal(latest.threads[0].disposition.value, 'accept');
  const missing = exported.groups.find(group => group.sourceRevisionId === 'missing-bundle');
  assert.equal(missing.sourceMapping, 'unavailable'); assert.equal(missing.threads[0].stale, true); assert.equal(missing.screen.id, null);
  assert.ok(missing.threads[0].staleReasons.some(reason => reason.includes('do not relocate')));
  const raw = JSON.stringify(exported); assert.ok(!raw.includes(f.root));
  assert.doesNotMatch(raw, /PRIVATE_LOCAL_BRIEF|PRIVATE_UNRELATED_FILE|ownerAuth|ownerPrivateKey|accessToken|sourceDigests|file:\/\//);
  assert.equal(readFileSync(designReviewPath(f.file, f.env), 'utf8'), before, 'Export cannot resolve pins or rewrite feedback');
  assert.equal(exportDesignReview(f.file, { scope: 'current', env: f.env }).summary.threads, 1);
  assert.throws(() => exportDesignReview(f.file, { scope: 'invalid', env: f.env }), /scope/);
});

test('bundled feedback utility exports JSON and Markdown without overwriting and reports scoped summaries', async t => {
  const f = await fixture(t), output = join(f.root, 'exports/review.json'), printed = [];
  const result = await designUtility(['feedback', f.file, '--action', 'export', '--format', 'json', '--output', output, '--scope', 'current'], { env: f.env, stdout: value => printed.push(value) });
  assert.equal(result.summary.threads, 1); assert.equal(printed.length, 1);
  assert.equal(JSON.parse(readFileSync(output, 'utf8')).groups[0].threads[0].comment, 'Current review text');
  assert.equal(statSync(output).mode & 0o077, 0);
  const before = readFileSync(output, 'utf8');
  await assert.rejects(() => designUtility(['feedback', f.file, '--action', 'export', '--output', output], { env: f.env, stdout() {} }), /already exists/);
  assert.equal(readFileSync(output, 'utf8'), before);
  const markdown = join(f.root, 'exports/review.md');
  await designUtility(['feedback', f.file, '--action', 'export', '--format', 'markdown', '--output', markdown, '--scope', 'all'], { env: f.env, stdout() {} });
  assert.match(readFileSync(markdown, 'utf8'), /Historical review text/); assert.match(readFileSync(markdown, 'utf8'), /anchor-normalized/);
  for (const flags of [['--format', 'html'], ['--scope', 'invalid'], []]) {
    await assert.rejects(() => designUtility(['feedback', f.file, '--action', 'export', ...flags], { env: f.env, stdout() {} }), /format|scope|output/);
  }
});

test('local export API requires the owner session capability and same-origin JSON, then returns only review data', async t => {
  const f = await fixture(t), server = await startDesignReview(f.file, { env: f.env, noOpen: true });
  t.after(() => server.close());
  const origin = new URL(server.url).origin, url = `${server.url}api/design-feedback-export`;
  const headers = { 'content-type': 'application/json', 'x-openplanr-design': '1', origin };
  for (const bad of [{ 'content-type': 'application/json', origin }, { ...headers, origin: 'https://outside.example' }, { ...headers, 'content-type': 'text/plain' }]) {
    const response = await fetch(url, { method: 'POST', headers: bad, body: '{}' }); assert.equal(response.status, 403); await response.arrayBuffer();
  }
  assert.equal((await fetch(`${origin}/api/design-feedback-export`, { method: 'POST', headers, body: '{}' })).status, 404);
  const wrong = new URL(url), segments = wrong.pathname.split('/'); segments[3] = 'A'.repeat(43); wrong.pathname = segments.join('/');
  assert.equal((await fetch(wrong, { method: 'POST', headers, body: '{}' })).status, 404);
  for (const input of [{ scope: 'invalid' }, { scope: 'all', token: 'unrelated' }, []]) {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(input) }); assert.equal(response.status, 400); await response.arrayBuffer();
  }
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ scope: 'current' }) });
  assert.equal(response.status, 200); const text = await response.text(), snapshot = JSON.parse(text);
  assert.equal(snapshot.summary.threads, 1); assert.ok(!text.includes(f.root)); assert.doesNotMatch(text, /PRIVATE_LOCAL_BRIEF|PRIVATE_UNRELATED_FILE|ownerPrivateKey/);
  const runtime = await fetch(`${server.url}runtime.js`).then(response => response.text()); assert.match(runtime, /loadReviewExport/); assert.match(runtime, /api\/design-feedback-export/);
});
