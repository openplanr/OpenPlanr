import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync, readdirSync, writeFileSync, rmSync, statSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { designFixture } from './design-fixture.mjs';
import { renderDesignDocument } from '../lib/design/document.mjs';
import { prepareDesignShareBundle, getDesignShareStatus, shareDesign, publishDesignShare, manageDesignShare, syncDesignShare, exportDesignShareRecovery, importDesignShareRecovery, publishDesignReviewMetadata } from '../lib/design/share.mjs';
import { decryptWorkspaceRevision, getWorkspace, prepareWorkspaceEvent } from '../lib/design/workspace-client.mjs';
import { readDesignFeedback, startDesignReview } from '../lib/design/review.mjs';

async function fixture(t) {
  const outer = realpathSync(mkdtempSync(join(tmpdir(), 'planr-design-share-')));
  const root = join(outer, 'project');
  t.after(() => rmSync(outer, { recursive: true, force: true }));
  const { file } = designFixture(root); await renderDesignDocument(file);
  const options = { custodyRoot: join(outer, 'private'), env: { ...process.env, PLANR_HOME: join(outer, 'home') }, baseUrl: 'https://share.test' };
  const state = { revisions: new Map(), events: [], requests: [], failNext: false, failAfter: false };
  options.fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname.split('/').filter(Boolean), route = path[4];
    const body = init.body ? JSON.parse(init.body) : null;
    state.requests.push({ url, init });
    if (state.failNext) { state.failNext = false; throw new Error('disconnected'); }
    if (init.method === 'PUT') {
      const files = readdirSync(options.custodyRoot).filter((name) => name.endsWith('.json'));
      assert.equal(files.length, 1, 'Owner custody must exist before creating the review');
      assert.equal(statSync(join(options.custodyRoot, files[0])).mode & 0o777, 0o600);
      if (!state.workspace) {
        state.workspace = { schemaVersion: body.schemaVersion, id: body.id, version: 1, epoch: 1, currentRevision: body.revision.id, commentsPaused: false, ownerPublicKey: body.ownerPublicKey, keyring: body.keyring };
        state.revisions.set(body.revision.id, body.revision);
      }
      if (state.failAfter) { state.failAfter = false; throw new Error('response lost'); }
      return Response.json(state.workspace);
    }
    if (route === 'publish' && init.method === 'POST') {
      if (state.conflictNext) { state.conflictNext = false; state.workspace.version++; return new Response('{}', { status: 409 }); }
      state.workspace.version++; state.workspace.currentRevision = body.revision.id; state.revisions.set(body.revision.id, body.revision);
      return Response.json(state.workspace);
    }
    if (route === 'rotate') { Object.assign(state.workspace, { epoch: body.epoch, keyring: body.keyring, version: state.workspace.version + 1 }); return Response.json(state.workspace); }
    if (route === 'manage') { if (body.action === 'pause' || body.action === 'resume') state.workspace.commentsPaused = body.action === 'pause'; state.workspace.version++; return Response.json(state.workspace); }
    if (route === 'revisions') return Response.json(state.revisions.get(path[5]));
    if (route === 'events') {
      if (init.method === 'POST') {
        let event = state.events.find(event => event.id === body.id);
        if (!event) { event = { ...body, sequence: state.events.length + 1 }; state.events.push(event); }
        return Response.json({ event, sequence: event.sequence });
      }
      const after = Number(new URL(url).searchParams.get('after')); return Response.json({ events: state.events.filter((item) => item.sequence > after), cursor: state.events.length, hasMore: false });
    }
    return Response.json(state.workspace);
  };
  const record = () => JSON.parse(readFileSync(join(options.custodyRoot, readdirSync(options.custodyRoot).find((name) => name.endsWith('.json'))), 'utf8'));
  return { root, file, options, state, record };
}

test('design publishing keeps credentials local and bundles only presentation material', async (t) => {
  const { root, file, options, state, record } = await fixture(t);
  const bundle = prepareDesignShareBundle(file);
  assert.equal(bundle.design.screens[0].source, undefined);
  assert.equal(bundle.design.brief, undefined);
  assert.equal(bundle.design.designSystem, undefined);
  assert.ok(!JSON.stringify(bundle).includes(root));
  const result = await shareDesign(file, options);
  assert.match(result.url, /^https:\/\/share.test\/d\/[A-Za-z0-9_-]+$/);
  const custody = record().custody;
  for (const secret of [custody.token, custody.ownerAuth, custody.ownerPrivateKey]) assert.ok(!JSON.stringify(result).includes(secret));
  const remoteBytes = JSON.stringify(state.requests.map(({ url, init }) => ({ url, body: init.body })));
  assert.ok(!remoteBytes.includes(custody.token)); assert.ok(!remoteBytes.includes(custody.ownerPrivateKey));
  assert.ok(!remoteBytes.includes('Workspace overview'));
  const access = { id: custody.id, token: custody.token, baseUrl: custody.baseUrl };
  await getWorkspace(access, options);
  const restored = await decryptWorkspaceRevision(access, access.currentRevision, options);
  assert.deepEqual(restored.design, bundle.design);
  assert.equal(getDesignShareStatus(file, options).hasUpdate, false);
  const output = join(root, 'recovery.json'); await exportDesignShareRecovery(file, { ...options, output });
  assert.equal(statSync(output).mode & 0o777, 0o600);
  await assert.rejects(exportDesignShareRecovery(file, { ...options, output }), /exist/);
});

test('lost creation response retries the same request and keeps original revision identity', async (t) => {
  const { root, file, options, state, record } = await fixture(t);
  state.failAfter = true;
  await assert.rejects(shareDesign(file, options), /unreachable/);
  const original = record(), first = state.requests[0].init.body;
  writeFileSync(join(root, 'source/screen-1.html'), readFileSync(join(root, 'source/screen-1.html'), 'utf8').replace('12 active tasks', '24 active tasks'));
  await renderDesignDocument(file);
  const retried = await shareDesign(file, options);
  assert.equal(state.requests[1].init.body, first);
  assert.equal(retried.publishedRevision, original.pendingRevision);
  assert.equal(retried.hasUpdate, true);
  const published = await publishDesignShare(file, options);
  assert.equal(published.url, retried.url); assert.equal(published.hasUpdate, false);
  assert.equal(state.revisions.size, 2);
});

test('rotation retries safely and credentials are revealed only by explicit access', async (t) => {
  const { file, options, state, record } = await fixture(t);
  await shareDesign(file, options);
  const previous = record().custody.token;
  state.failNext = true;
  await assert.rejects(manageDesignShare(file, 'rotate', options), /unreachable/);
  assert.equal(record().custody.token, previous);
  await manageDesignShare(file, 'rotate', options);
  assert.notEqual(record().custody.token, previous);
  assert.equal((await manageDesignShare(file, 'access', options)).token, record().custody.token);
  assert.equal((await manageDesignShare(file, 'pause', options)).commentsPaused, true);
  assert.equal((await manageDesignShare(file, 'resume', options)).commentsPaused, false);
  assert.equal((await manageDesignShare(file, 'revoke', options)).revoked, true);
  await assert.rejects(manageDesignShare(file, 'access', options), /no longer accessible/);
});

test('hosted review remains tied to its original revision and never imports reviewer approval', async (t) => {
  const { root, file, options, state, record } = await fixture(t);
  await shareDesign(file, options);
  const custody = record().custody;
  const bundle = await decryptWorkspaceRevision(custody, custody.currentRevision, options);
  const date = new Date().toISOString();
  const review = { schemaVersion: '1.0.0', reviewId: 'reviewer-1', reviewOf: bundle.reviewOf, decision: 'approved', overall: 'Looks good', createdAt: date, updatedAt: date, pins: [{ id: 'pin-1', artifactId: bundle.envelope.artifacts[0].id, author: { name: 'Teammate' }, intent: 'improve', status: 'open', comment: 'Increase label contrast', region: { x: .1, y: .1, w: 0, h: 0 }, viewport: bundle.envelope.artifacts[0].viewport, replies: [], createdAt: date, updatedAt: date }] };
  const event = await prepareWorkspaceEvent(custody, { kind: 'review', author: 'Teammate', reviewOf: bundle.reviewOf, review }, { reviewOf: bundle.reviewOf });
  state.events.push({ ...event, sequence: 1 });
  const synced = await syncDesignShare(file, options); assert.equal(synced.imported, 1);
  assert.equal(readDesignFeedback(file, options.env).ledger.reviews[0].review.decision, 'pending');
  assert.equal((await syncDesignShare(file, options)).imported, 0);
  state.failNext = true;
  const queued = await publishDesignReviewMetadata(file, { schemaVersion: '1.0.0', kind: 'disposition', author: 'Design owner', reviewOf: bundle.reviewOf, pinId: 'pin-1', disposition: 'accepted', reason: 'Improve clarity', updatedAt: date }, { ...options, revisionId: custody.currentRevision });
  assert.equal(queued.pending, true);
  assert.equal(record().pendingReviewMetadata.length, 1, 'Unsent owner intent is durable before retry.');
  await syncDesignShare(file, options);
  assert.equal(record().pendingReviewMetadata.length, 0);
  assert.equal(readDesignFeedback(file, options.env).shared.metadataByRevision[custody.currentRevision].dispositions['pin-1'].disposition, 'accepted');
  const upload = state.requests.find(({ url, init }) => url.endsWith('/events') && init.method === 'POST');
  assert.equal(upload.init.headers.Authorization, `Bearer ${custody.ownerAuth}`);
  assert.deepEqual(JSON.parse(upload.init.body).publicKey, custody.ownerPublicKey);
  assert.equal(readDesignFeedback(file, options.env).pins[0].status, 'open');
  writeFileSync(join(root, 'source/screen-1.html'), readFileSync(join(root, 'source/screen-1.html'), 'utf8').replace('12 active tasks', '24 active tasks'));
  await renderDesignDocument(file);
  assert.equal(readDesignFeedback(file, options.env).pins[0].stale, true);
  assert.equal(readDesignFeedback(file, options.env).pins[0].id, 'pin-1');
});

test('unsafe custody permissions are rejected rather than loaded', async (t) => {
  const { file, options } = await fixture(t); await shareDesign(file, options);
  const path = join(options.custodyRoot, readdirSync(options.custodyRoot).find((name) => name.endsWith('.json')));
  chmodSync(path, 0o644); assert.throws(() => getDesignShareStatus(file, options), /0600/);
});

test('studio supplies design share adapter and rejects cross-origin owner requests', async (t) => {
  const { file, options } = await fixture(t);
  const session = await startDesignReview(file, { env: options.env }); t.after(() => session.close());
  const page = await fetch(session.url).then((r) => r.text()); assert.match(page, /design-share-dialog/);
  const runtime = await fetch(`${session.url}runtime.js`).then((r) => r.text()); assert.match(runtime, /design-share-runtime/);
  const adapter = await fetch(`${session.url}api/design-share-runtime`).then((r) => r.text()); assert.match(adapter, /Copy access token/);
  const denied = await fetch(`${session.url}api/design-share`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://untrusted.test' }, body: JSON.stringify({ action: 'create' }) });
  assert.equal(denied.status, 403);
});


test('recovery restores matching authority without overwriting another workspace', async (t) => {
  const { root, file, options, record } = await fixture(t);
  await shareDesign(file, options);
  const output = join(root, 'recovery.json'); await exportDesignShareRecovery(file, { ...options, output });
  const restoredOptions = { ...options, custodyRoot: join(root, '..', 'second-machine') };
  const restored = await importDesignShareRecovery(file, { ...restoredOptions, input: output });
  assert.equal(restored.id, record().custody.id);
  assert.equal(getDesignShareStatus(file, restoredOptions).id, restored.id);
  const invalid = JSON.parse(readFileSync(output, 'utf8')); invalid.custody.ownerPublicKey.x = 'x'.repeat(43);
  writeFileSync(output, JSON.stringify(invalid), { mode: 0o600 });
  await assert.rejects(importDesignShareRecovery(file, { ...restoredOptions, input: output }), /owner identity/);
});

test('custody refuses project paths and symbolic-link ancestors', async (t) => {
  const { root, file, options } = await fixture(t);
  assert.throws(() => getDesignShareStatus(file, { ...options, custodyRoot: join(root, 'credentials') }), /outside the project/);
  const link = join(root, '..', 'linked'); symlinkSync(join(root, '..'), link);
  await assert.rejects(shareDesign(file, { ...options, custodyRoot: join(link, 'credentials') }), /symbolic links/);
});

test('concurrent creation is serialized into one durable workspace', async (t) => {
  const { file, options, state } = await fixture(t);
  const [first, second] = await Promise.all([shareDesign(file, options), shareDesign(file, options)]);
  assert.equal(first.id, second.id);
  assert.equal(state.requests.filter(({ init }) => init.method === 'PUT').length, 1);
});


test('Share design completes in the real browser without generic missing-handler controls', { timeout: 30000 }, async (t) => {
  const { file, options } = await fixture(t);
  options.custodyRoot = join(options.env.PLANR_HOME, 'design-shares');
  const session = await startDesignReview(file, {
    env: { ...options.env, OPENPLANR_SHARE_BASE: options.baseUrl },
    fetchImpl: (url, init) => new URL(url).origin === options.baseUrl ? options.fetchImpl(url, init) : fetch(url, init),
  });
  t.after(() => session.close());
  const require = createRequire(new URL('../../pipeline/package.json', import.meta.url));
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, ...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? { channel: 'chrome' } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(session.url);
  await page.getByRole('button', { name: 'Share design', exact: true }).click();
  const dialog = page.locator('.design-share-dialog');
  await dialog.getByRole('button', { name: 'Create shared review' }).click();
  await dialog.getByRole('button', { name: 'Copy access token' }).waitFor();
  assert.match(await dialog.getByLabel('Design review link').inputValue(), /^https:\/\/share.test\/d\//);
  assert.equal(await dialog.getByText('Private fragment', { exact: true }).count(), 0);
  assert.equal(await dialog.getByText('Owner-verdict custody', { exact: true }).count(), 0);
  await dialog.getByRole('button', { name: 'Close sharing' }).click();
  assert.equal(await page.locator('.design-share-dialog').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Share design', exact: true }).evaluate((button) => button === document.activeElement), true);
  assert.deepEqual(errors, []);
});


test('definite publication conflict preserves intent and allows an authenticated retry', async (t) => {
  const { root, file, options, state, record } = await fixture(t);
  await shareDesign(file, options); const original = state.workspace.currentRevision;
  writeFileSync(join(root, 'source/screen-1.html'), readFileSync(join(root, 'source/screen-1.html'), 'utf8').replace('12 active tasks', '18 active tasks'));
  await renderDesignDocument(file);
  state.conflictNext = true;
  await assert.rejects(publishDesignShare(file, options), /shared review changed/);
  assert.equal(state.workspace.currentRevision, original);
  assert.equal(record().conflictedMutation.action, 'publish');
  assert.equal(record().custody.pendingMutation, undefined);
  await publishDesignShare(file, options);
  assert.notEqual(state.workspace.currentRevision, original);
});

test('ordinary unshared feedback does not create or require owner credentials', async (t) => {
  const { root, file, options } = await fixture(t);
  const result = await syncDesignShare(file, { env: { ...options.env, PLANR_HOME: join(root, 'project-state') } });
  assert.equal(result.shared, false);
  assert.equal(existsSync(join(root, 'project-state')), false);
});

test('arrangement changes can be explicitly published without changing authored source revision', async (t) => {
  const { root, file, options } = await fixture(t);
  await shareDesign(file, options);
  const before = getDesignShareStatus(file, options);
  const artifactId = prepareDesignShareBundle(file).entries[0].artifactId;
  writeFileSync(join(root, '.design/studio-state.json'), JSON.stringify({ stateVersion: 1, state: { positions: { [artifactId]: { x: -240, y: 650 } }, ratings: { A: 5 }, remix: { A: 'Private preference' } } }));
  assert.equal(getDesignShareStatus(file, options).hasUpdate, true);
  const bundle = prepareDesignShareBundle(file);
  assert.deepEqual(bundle.state, { positions: { [artifactId]: { x: -240, y: 650 } } });
  assert.ok(!JSON.stringify(bundle).includes('Private preference'));
  const after = await publishDesignShare(file, options);
  assert.equal(after.publishedRevision, before.publishedRevision);
  assert.notEqual(after.revision, before.revision);
  assert.equal(after.hasUpdate, false);
});
