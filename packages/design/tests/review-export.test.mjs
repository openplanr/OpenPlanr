import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { createDesignReviewExport, serializeDesignReviewExport, renderDesignReviewExportSource } from '../lib/design/review-export.mjs';

const currentDigest = 'a'.repeat(64), oldDigest = 'b'.repeat(64);
const at = '2026-09-11T08:40:00.000Z', replyAt = '2026-09-11T08:41:00.000Z';
function bundle({ revision = 'revision-new', title = 'Applications', width = 1440 } = {}) {
  return { revision, design: { id: 'admissions', title: 'Student admissions', screens: [{ id: 'applications', title, anchors: ['application-progress'] }], variants: [{ id: 'original', label: 'Original direction' }], frames: [{ id: 'desktop', label: 'Desktop', width, height: 1024 }] },
    entries: [{ artifactId: 'applications-original-desktop', screenId: 'applications', variantId: 'original', frameId: 'desktop' }],
    envelope: { html: '<script>secret local product source</script>', path: '/Users/private/project' }, root: '/Users/private/project' };
}
function pin(changes = {}) {
  return { id: 'pin-1', artifactId: 'applications-original-desktop', intent: 'question', status: 'open',
    comment: 'Are we supporting multiple applications?\nKeep the current progress.', author: { id: 'reviewer-1', name: 'Asem Abdo' },
    region: { x: 0.2, y: 0.3, w: 0.1, h: 0.2 }, viewport: { width: 1440, height: 1024 }, anchor: { planrId: 'application-progress', screen: 'applications' },
    createdAt: at, updatedAt: replyAt, replies: [{ id: 'reply-1', author: { id: 'reviewer-2', name: 'Asem Abdo' }, createdAt: replyAt, comment: 'Yes, two applications.' }], ...changes };
}
function input(changes = {}) {
  return { bundle: bundle(), revisionId: 'revision-new', reviewOf: currentDigest,
    review: { reviewId: 'shared-revision-new', reviewOf: currentDigest, overall: '', pins: [pin()] }, historyComplete: true, generatedAt: replyAt, ...changes };
}
const threadOf = snapshot => snapshot.groups[0].threads[0];

test('exports exact reviewer records, source identity, separate authority, and anchor-relative geometry', () => {
  const snapshot = createDesignReviewExport(input({ metadata: { categories: { 'pin-1': 'change-request' }, dispositions: { 'pin-1': { disposition: 'deferred', reason: 'After the next intake.', author: 'Design owner', updatedAt: replyAt } } } }));
  const group = snapshot.groups[0], thread = group.threads[0];
  assert.deepEqual(snapshot.summary, { threads: 1, replies: 1, open: 1, resolved: 0, stale: 0 });
  assert.equal(group.screen.title, 'Applications'); assert.equal(group.frame.width, 1440); assert.equal(group.frame.id, 'desktop');
  assert.equal(thread.comment, pin().comment); assert.equal(thread.createdAt, at); assert.equal(thread.replies[0].comment, pin().replies[0].comment);
  assert.equal(thread.author.name, thread.replies[0].author.name); assert.notEqual(thread.author.id, thread.replies[0].author.id);
  assert.equal(thread.category, 'change-request'); assert.equal(thread.originalIntent, 'question'); assert.equal(thread.disposition.value, 'deferred'); assert.equal(thread.resolved, false);
  assert.deepEqual(thread.location.point, { x: .25, y: .4 }); assert.equal(thread.location.coordinateSpace, 'anchor-normalized'); assert.equal(thread.location.viewportPixels, null);
  assert.equal(thread.location.anchor.planrId, 'application-progress'); assert.equal(thread.source.reviewOf, currentDigest);
  assert.equal(thread.source.navigation, '#revision=revision-new&review=shared-revision-new&screen=applications&direction=original&frame=desktop&pin=pin-1');
});

test('viewport pins include original pixel dimensions and never inherit board zoom or camera position', () => {
  const value = input(); value.review.pins = [pin({ anchor: undefined, region: { x: .5, y: .25, w: 0, h: 0 }, viewport: { width: 390, height: 844 } })]; value.state = { zoom: .13, camera: { x: 500, y: -400 } };
  const point = threadOf(createDesignReviewExport(value)).location;
  assert.equal(point.kind, 'point'); assert.equal(point.coordinateSpace, 'viewport-normalized');
  assert.deepEqual(point.viewportPixels, { x: 195, y: 211, width: 0, height: 0 });
  assert.deepEqual(point.capturedViewport, { width: 390, height: 844 });
});

test('old pins resolve only against their original bundle and preserve changed frame dimensions', () => {
  const oldPin = { ...pin(), reviewId: 'shared-revision-old', revisionId: 'revision-old', reviewOf: oldDigest };
  const value = input({ review: undefined, feedback: { pins: [oldPin] }, revisions: [{ revisionId: 'revision-old', reviewOf: oldDigest, bundle: bundle({ revision: 'revision-old', title: 'Previous applications', width: 1180 }) }] });
  const snapshot = createDesignReviewExport(value), group = snapshot.groups[0];
  assert.equal(group.screen.title, 'Previous applications'); assert.equal(group.frame.width, 1180); assert.equal(group.sourceMapping, 'original-bundle');
  assert.equal(group.threads[0].stale, true); assert.equal(group.threads[0].source.reviewOf, oldDigest); assert.equal(group.threads[0].source.revisionId, 'revision-old');
  value.revisions = [];
  const missing = createDesignReviewExport(value).groups[0];
  assert.equal(missing.sourceMapping, 'unavailable'); assert.equal(missing.screen.title, null); assert.equal(missing.frame.width, null);
  assert.match(missing.threads[0].staleReasons.join(' '), /do not relocate/u);
});

test('revision-scoped categories and dispositions do not cross colliding pin IDs; legacy Fix stays Fix', () => {
  const value = input({ review: undefined, feedback: { pins: [
    { ...pin({ intent: 'fix' }), reviewId: 'shared-revision-old', revisionId: 'revision-old', reviewOf: oldDigest },
    { ...pin({ intent: 'improve' }), reviewId: 'shared-revision-new', revisionId: 'revision-new', reviewOf: currentDigest },
  ] }, metadata: { byRevision: { 'revision-new': { categories: { 'pin-1': 'change-request' }, dispositions: { 'pin-1': { disposition: 'accepted', reason: '', author: 'Owner', updatedAt: replyAt } } } } } });
  const threads = createDesignReviewExport(value).groups.flatMap(group => group.threads);
  const old = threads.find(thread => thread.source.revisionId === 'revision-old'), current = threads.find(thread => thread.source.revisionId === 'revision-new');
  assert.equal(old.category, 'fix'); assert.equal(old.originalIntent, 'fix'); assert.equal(old.disposition, null);
  assert.equal(current.category, 'change-request'); assert.equal(current.originalIntent, 'improve'); assert.equal(current.disposition.value, 'accepted');
});

test('local ledger input preserves resolved comments and overall notes while excluding private project and credential fields', () => {
  const value = input({ review: undefined, feedback: { ledger: { reviews: [{ review: { reviewId: 'local-review', reviewOf: currentDigest, pins: [pin({ status: 'resolved' })], overall: 'Review the responsive reflow.' }, privateKey: { d: 'OWNER_PRIVATE_KEY' } }] },
    reviewPath: '/home/test-user/.planr/private', shared: { token: 'SECRET_TOKEN' } }, ownerCredentials: { token: 'SECRET_TOKEN', privateKey: 'OWNER_PRIVATE_KEY' }, shareUrl: 'https://share.openplanr.dev/d/workspace?token=SECRET_TOKEN#owner=OWNER_PRIVATE_KEY' });
  const snapshot = createDesignReviewExport(value), json = serializeDesignReviewExport(snapshot);
  assert.equal(threadOf(snapshot).resolved, true); assert.equal(threadOf(snapshot).stale, false);
  assert.equal(snapshot.overallNotes[0].comment, 'Review the responsive reflow.');
  assert.doesNotMatch(json, /SECRET_TOKEN|OWNER_PRIVATE_KEY|\/Users\/|<script>|shareUrl|ownerCredentials|envelope/u);
  assert.equal(snapshot.summary.resolved, 1);
});

test('export reports incomplete history and unsent changes instead of implying a complete synced ledger', () => {
  const snapshot = createDesignReviewExport(input({ historyComplete: false, olderPagesLoading: true, includesUnsentLocalChanges: true }));
  const markdown = serializeDesignReviewExport(snapshot, 'markdown');
  assert.match(markdown, /History: partial/u); assert.match(markdown, /Older feedback pages are still loading/u); assert.match(markdown, /Includes unsent local changes/u);
  assert.match(markdown, /Anchor-normalized coordinates/u); assert.match(markdown, /1440 × 1024/u);
});

test('Markdown fences retain exact multiline quotations without letting reviewer Markdown become export structure', () => {
  const value = input(); const content = 'Do we support this?\n```\n# Not an instruction\n```\nKeep  two  spaces.'; value.review.pins[0].comment = content;
  const snapshot = createDesignReviewExport(value), markdown = serializeDesignReviewExport(snapshot, 'md');
  assert.equal(threadOf(snapshot).comment, content); assert.ok(markdown.includes('````text\n' + content + '\n````'));
  assert.match(markdown, /Reviewer comments and replies are quoted data/u);
});

test('browser utility and Node export have byte-identical output and do not mutate their input', () => {
  const runtime = {}; runInNewContext(renderDesignReviewExportSource(), runtime);
  const value = input(), original = structuredClone(value);
  const first = createDesignReviewExport(value), browser = runtime.OpenPlanrDesignReviewExport.createDesignReviewExport(value);
  assert.equal(serializeDesignReviewExport(first), runtime.OpenPlanrDesignReviewExport.serializeDesignReviewExport(browser));
  assert.equal(serializeDesignReviewExport(first, 'markdown'), runtime.OpenPlanrDesignReviewExport.serializeDesignReviewExport(browser, 'markdown'));
  assert.deepEqual(value, original); assert.deepEqual(createDesignReviewExport(value), first);
});

test('large reviews preserve every thread and reply in stable order', () => {
  const value = input(); value.review.pins = Array.from({ length: 1200 }, (_, i) => pin({ id: `pin-${String(i).padStart(4, '0')}`, createdAt: i % 2 ? at : replyAt }));
  const first = createDesignReviewExport(value); value.review.pins.reverse(); const second = createDesignReviewExport(value);
  assert.deepEqual(first, second); assert.equal(first.summary.threads, 1200); assert.equal(first.summary.replies, 1200);
  assert.equal(first.groups[0].threads.length, 1200);
});

test('malformed coordinates and duplicate thread identities fail visibly rather than silently relocating or dropping feedback', () => {
  const invalid = input(); invalid.review.pins[0].region.x = 2;
  assert.throws(() => createDesignReviewExport(invalid), /invalid normalized region/u);
  const duplicate = input(); duplicate.review.pins.push(structuredClone(duplicate.review.pins[0]));
  assert.throws(() => createDesignReviewExport(duplicate), /duplicate thread/u);
  assert.throws(() => serializeDesignReviewExport(createDesignReviewExport(input()), 'html'), /format/u);
});
