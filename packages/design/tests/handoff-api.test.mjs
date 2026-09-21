import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { digestArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';
import { createReviewLedger } from '@openplanr/artifact/merge.mjs';
import { writeArtifactReviewState } from '@openplanr/artifact/review.mjs';
import { assertDesignReviewBundle } from '@openplanr/protocol/review-experience-contracts';
import { designFixture } from './design-fixture.mjs';
import { atomicJson, currentDesign, renderDesignDocument } from '../lib/design/document.mjs';
import { emptyReviewContext } from '../lib/design/context.mjs';
import { designReviewPath, startDesignReview } from '../lib/design/review.mjs';

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-handoff-http-'));
  const { file, document } = designFixture(root, { count: 1, frames: [{ id: 'desktop', label: 'Desktop', width: 1440, height: 1024 }] });
  document.brief.text = 'PRIVATE_BRIEF_MARKER'; atomicJson(file, document);
  writeFileSync(join(root, 'unrelated-owner-material.txt'), 'UNRELATED_PRIVATE_MATERIAL');
  const context = emptyReviewContext(document); context.brief.purpose = 'Review workspace discoverability.'; context.brief.requests = ['Is the primary action clear?'];
  atomicJson(join(root, 'review-context.json'), context);
  const env = { ...process.env, PLANR_HOME: join(root, 'private-test-home') };
  await renderDesignDocument(file);
  const server = await startDesignReview(file, { env, noOpen: true });
  t.after(async () => { await server.close(); rmSync(root, { recursive: true, force: true }); });
  const origin = new URL(server.url).origin;
  const headers = { 'content-type': 'application/json', 'x-openplanr-design': '1', origin };
  const request = async (route, input, override = {}) => {
    const response = await fetch(`${server.url}api/${route}`, input === undefined ? override : { method: 'POST', headers, body: JSON.stringify(input), ...override });
    const raw = await response.text(); let value; try { value = JSON.parse(raw); } catch { value = raw; }
    return { status: response.status, value, raw, headers: response.headers };
  };
  const seed = ({ comment = 'Make Continue easier to find.', overall = '', reply = false } = {}) => {
    const current = currentDesign(file), reviewOf = digestArtifactEnvelope(current.envelope);
    const review = { schemaVersion: '1.0.0', reviewId: 'owner-local-review', reviewOf, decision: 'pending', overall, pins: [{ id: 'primary-action', artifactId: current.entries[0].artifactId,
      author: { name: 'Morgan', id: 'morgan-one' }, comment, intent: 'improve', status: 'open', region: { x: 0.1, y: 0.2, w: 0, h: 0 }, viewport: { width: 1440, height: 1024 },
      createdAt: '2026-09-10T10:00:00Z', updatedAt: '2026-09-10T10:00:00Z', replies: reply ? [{ id: 'reply-one', author: { name: 'Morgan', id: 'morgan-two' }, comment: 'Also consider keyboard access.', createdAt: '2026-09-10T10:01:00Z' }] : [] }] };
    writeArtifactReviewState(designReviewPath(file, env), createReviewLedger({ artifactId: 'operations', currentReviewOf: reviewOf, reviews: [{ review, stale: false }] }));
  };
  return { root, file, document, context, env, server, origin, headers, request, seed };
}

test('handoff HTTP endpoints require the local owner capability plus same-origin JSON write headers', async (t) => {
  const f = await fixture(t), initial = currentDesign(f.file);
  const input = { action: 'draft', revision: initial.revision, version: 0 };
  const studioResponse = await fetch(f.server.url);
  assert.equal(studioResponse.status, 200);
  assert.match(studioResponse.headers.get('permissions-policy'), /(?:^|,\s*)fullscreen=\(self\)(?:,|$)/, 'Only the trusted top-level studio may present fullscreen');
  await studioResponse.arrayBuffer();
  for (const route of ['design-experience', 'design-handoff-readiness', 'design-handoff', 'design-implementation-handoff', 'design-revisions']) {
    const url = new URL(`api/${route}`, f.server.url);
    const segments = url.pathname.split('/'); segments[3] = 'A'.repeat(43); url.pathname = segments.join('/');
    const denied = await fetch(url); assert.equal(denied.status, 404);
    const body = await denied.text(); assert.doesNotMatch(body, /PRIVATE_BRIEF_MARKER|discoverability|contentHash|ownerPublicKey/);
    assert.equal((await fetch(`${f.origin}/api/${route}`)).status, 404);
  }
  for (const headers of [
    { 'content-type': 'application/json', origin: f.origin },
    { 'x-openplanr-design': '1', 'content-type': 'text/plain', origin: f.origin },
    { ...f.headers, origin: 'https://outside.example' },
    { ...f.headers, origin: 'null' },
  ]) assert.equal((await f.request('design-handoff', input, { headers })).status, 403);
  assert.equal((await f.request('design-handoff')).value.draft, null);
  const created = await f.request('design-handoff', input);
  assert.equal(created.status, 200); assert.equal(created.value.draft.status, 'draft');
  assert.equal((await f.request('design-experience')).value.capabilities.owner, true);
});

test('HTTP handoff writers conflict, approval requires exact reviewed content, and revisions preserve approved snapshots', async (t) => {
  const f = await fixture(t); f.seed(); const revision = currentDesign(f.file).revision;
  let result = await f.request('design-handoff', { action: 'draft', revision, version: 0 });
  assert.equal(result.status, 200);
  const original = result.value.draft.content.openQuestions[0].text;
  const content = structuredClone(result.value.draft.content); content.summary = 'Clarify the primary action.';
  content.openQuestions[0].refinement = 'Use a strong primary button and a descriptive label.';
  const writes = await Promise.all([1, 2].map(() => f.request('design-handoff', { action: 'update', revision, version: 1, content })));
  assert.deepEqual(writes.map(value => value.status).sort(), [200, 409]);
  result = await f.request('design-handoff'); let draft = result.value.draft;
  assert.equal(draft.content.openQuestions[0].text, original, 'Refinement must not replace the reviewer quotation');
  assert.equal((await f.request('design-handoff', { action: 'approve', revision, version: draft.version, contentHash: 'b'.repeat(64) })).status, 409);
  assert.equal((await f.request('design-handoff', { action: 'approve', revision: 'b'.repeat(64), version: draft.version, contentHash: draft.contentHash })).status, 409);
  result = await f.request('design-handoff', { action: 'approve', revision, version: draft.version, contentHash: draft.contentHash });
  assert.equal(result.status, 200); assert.equal(result.value.current, true); assert.equal(result.value.draft.status, 'approved'); draft = result.value.draft;
  const archive = join(f.root, '.design/handoff-approvals', `${draft.contentHash}.json`), archived = readFileSync(archive, 'utf8');
  f.seed({ overall: 'New unresolved company policy question.' });
  result = await f.request('design-handoff'); assert.equal(result.value.current, false);
  assert.equal((await f.request('design-handoff', { action: 'approve', revision, version: draft.version, contentHash: draft.contentHash })).status, 409);
  result = await f.request('design-handoff', { action: 'draft', revision, version: draft.version });
  assert.equal(result.status, 200); assert.equal(result.value.draft.status, 'draft'); assert.equal(readFileSync(archive, 'utf8'), archived);
  assert.match(result.value.draft.markdown, /New unresolved company policy question/);
  assert.equal(readdirSync(join(f.root, '.design/handoff-approvals')).length, 1);
});

test('authenticated history returns allowlisted immutable bundles and isolated comparison sources', async (t) => {
  const f = await fixture(t), before = currentDesign(f.file);
  const source = join(f.root, 'source/screen-1.html'); writeFileSync(source, readFileSync(source, 'utf8').replace('12 active tasks', '13 active tasks'));
  await renderDesignDocument(f.file); const after = currentDesign(f.file);
  assert.notEqual(after.revision, before.revision);
  const history = await f.request('design-revisions'); assert.equal(history.status, 200); assert.equal(history.value.revisions.length, 2);
  const old = await f.request('design-revisions', { revision: before.revision }); assert.equal(old.status, 200);
  const { comparisonSources, ...bundle } = old.value; assertDesignReviewBundle(bundle);
  assert.equal(bundle.revision, before.revision); assert.match(bundle.envelope.artifacts[0].html, /12 active tasks/); assert.doesNotMatch(bundle.envelope.artifacts[0].html, /13 active tasks/);
  assert.doesNotMatch(old.raw, /PRIVATE_BRIEF_MARKER|UNRELATED_PRIVATE_MATERIAL|ownerPrivateKey|ownerAuth|sourceDigests/);
  assert.ok(!old.raw.includes(f.root));
  for (const html of Object.values(comparisonSources)) { assert.match(html, /Content-Security-Policy/); assert.match(html, /connect-src 'none'/); assert.match(html, /form-action 'none'/); assert.match(html, /injectedScript\?\.remove/); }
  assert.equal(Object.keys(comparisonSources).length, before.entries.length);
  const unauthorized = await f.request('design-revisions', { revision: before.revision }, { headers: { 'content-type': 'application/json' } }); assert.equal(unauthorized.status, 403);
  for (const revision of ['../current', '../unrelated-owner-material.txt', 'not-a-revision']) {
    const invalid = await f.request('design-revisions', { revision }); assert.equal(invalid.status, 400); assert.doesNotMatch(invalid.raw, /UNRELATED_PRIVATE_MATERIAL/);
  }
});

test('implementation handoff endpoints compose, export, and import one exact portable package', async (t) => {
  const f = await fixture(t), current = currentDesign(f.file);
  const sourcePath = 'source/screen-1.html', source = readFileSync(join(f.root, sourcePath));
  const sha = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
  writeFileSync(join(f.root, 'design-spec.md'), '# Complete design specification\n');
  atomicJson(join(f.root, '.design/verification', `${current.revision}.json`), { status: 'verified', revision: current.revision });
  let review = await f.request('design-handoff', { action: 'draft', revision: current.revision, version: 0 });
  const reviewContent = structuredClone(review.value.draft.content); reviewContent.summary = 'The current design is ready for implementation planning.';
  review = await f.request('design-handoff', { action: 'update', revision: current.revision, version: review.value.draft.version, content: reviewContent });
  review = await f.request('design-handoff', { action: 'approve', revision: current.revision, version: review.value.draft.version, contentHash: review.value.draft.contentHash });
  assert.equal(review.status, 200, JSON.stringify(review.value));
  const readiness = await f.request('design-handoff-readiness');
  assert.equal(readiness.status, 200, JSON.stringify(readiness.value)); assert.equal(readiness.value.readiness.status, 'ready');
  const packageInput = {
    id: 'operations-implementation', version: 1, title: 'Operations implementation package',
    sources: [{ id: 'screen-one', kind: 'screen', path: sourcePath, revision: `sha256:${current.revision}`, digest: sha(source) }],
    requirements: [{ kind: 'behavior', statement: 'Keep the operations summary visible.', sourceRefs: ['screen-one'], verification: ['The summary is visible at the desktop frame.'] }],
  };
  const initial = await f.request('design-implementation-handoff');
  assert.equal(initial.status, 200, JSON.stringify(initial.value)); assert.equal(initial.value.draft, null);
  assert.equal((await f.request('design-implementation-handoff', { action: 'draft', package: packageInput }, { headers: { 'content-type': 'application/json', origin: f.origin } })).status, 403);
  let result = await f.request('design-implementation-handoff', { action: 'draft', package: packageInput });
  assert.equal(result.status, 200); assert.equal(result.value.draft.status, 'draft');
  const requirementId = result.value.draft.requirements[0].id;
  assert.match(requirementId, /^REQ-[0-9]{3,}$/u);
  assert.equal((await f.request('design-implementation-handoff')).value.draft.requirements[0].id, requirementId);
  result = await f.request('design-implementation-handoff', { action: 'export' });
  assert.equal(result.status, 200); assert.match(result.value.package.markdown, new RegExp(requirementId, 'u'));
  const imported = await f.request('design-implementation-handoff', { action: 'import', package: result.value.package });
  assert.equal(imported.status, 200); assert.equal(imported.value.draft.contentDigest, JSON.parse(result.value.package.json).contentDigest);
});
