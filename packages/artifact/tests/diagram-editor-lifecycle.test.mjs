import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDiagramEditorSession } from '../lib/artifact/diagram/editor/session.mjs';
import { createDiagramEditorRecovery } from '../lib/artifact/diagram/editor/recovery.mjs';
import { createDiagramAuthoringStore } from '../lib/artifact/diagram/authoring/store.mjs';
import { adoptMermaidCopy, compileDiagramCommand, previewMermaidCopy } from '../lib/artifact/diagram/authoring/index.mjs';
import { makeBundle, SOURCE_TEXT } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';

const good = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result; };
const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };
const ids = prefix => { let sequence = 0; return () => `${prefix}-${++sequence}`; };
const rename = (id, label) => ({ type: 'rename', id, label });
function memoryStorage() {
  const entries = new Map();
  return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
}
function recovery(storage, sessionId = 'owner-one') {
  return createDiagramEditorRecovery({ storage, scope: { sessionId, diagramId: 'checkout' } });
}
async function persisted(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'planr-editor-lifecycle-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bundle = makeBundle();
  const store = createDiagramAuthoringStore({ root, slug: bundle.diagramId });
  good(await store.initialize(bundle, { transactionId: 'initialize-fixture' }));
  return { store, bundle };
}
function session(t, bundle, options = {}) {
  const editor = createDiagramEditorSession({ bundle, acknowledged: true, nextTransactionId: ids('edit'), ...options });
  t.after(() => editor.dispose());
  return editor;
}
async function externalEdit(store, command, transactionId) {
  const head = good(await store.read());
  const preview = good(compileDiagramCommand(head.bundle, command, { transactionId }));
  return good(await store.commit(preview.transaction));
}

// Deferred delivery sits above the real durable store: the content commits before
// the response is released, matching lost/late HTTP acknowledgement scenarios.
function delayedCommit(store) {
  const committed = deferred(), release = deferred(); let first = true;
  return { committed, release, transport: { ...store, async commit(transaction) {
    const result = await store.commit(transaction);
    if (first) { first = false; committed.resolve(result); await release.promise; }
    return result;
  } } };
}

test('an adopted initial copy retains exact source and initialization identity through recovery and first save', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'planr-editor-initial-copy-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const blank = makeBundle('flowchart', { blank: true });
  const preview = good(previewMermaidCopy(SOURCE_TEXT, { diagramId: blank.diagramId, title: blank.document.title }));
  const copy = good(adoptMermaidCopy(preview, preview.acknowledgement)).bundle;
  const store = createDiagramAuthoringStore({ root, slug: blank.diagramId }), storage = memoryStorage();
  let initialization = null;
  const transport = { ...store, async initialize(bundle, identity) {
    initialization = { bundle: structuredClone(bundle), identity: { ...identity } };
    return store.initialize(bundle, identity);
  } };

  const original = session(t, blank, {
    acknowledged: false, transport, recovery: recovery(storage), nextTransactionId: () => 'initial-copy',
  });
  const input = structuredClone(copy);
  const adopted = good(original.adoptInitialCopy(input));
  assert.deepEqual(input, copy, 'Adoption does not mutate the certified input bundle');
  assert.deepEqual(adopted.bundle, copy);
  let state = original.getState();
  assert.equal(state.bundle.bundleDigest, copy.bundleDigest);
  assert.equal(state.bundle.originalSource.sourceDigest, copy.originalSource.sourceDigest);
  assert.deepEqual(Buffer.from(state.bundle.originalSource.text, 'utf8'), Buffer.from(SOURCE_TEXT, 'utf8'));
  assert.equal(state.bundle.document.title, blank.document.title);
  assert.equal(state.bundle.document.accessibility.title, blank.document.accessibility.title);
  assert.equal(state.pendingCount, 0); assert.equal(state.needsInitialization, true);
  assert.equal(state.canUndo, false); assert.equal(state.canRedo, false);
  assert.equal((await store.read()).status, 'absent', 'Adoption remains an unsaved local initialization');

  original.dispose();
  const reopened = session(t, blank, {
    acknowledged: false, transport, recovery: recovery(storage), nextTransactionId: () => 'replacement-copy',
  });
  state = reopened.getState();
  assert.deepEqual(state.bundle, copy);
  assert.equal(state.pendingCount, 0); assert.equal(state.needsInitialization, true);
  good(await reopened.save());
  assert.deepEqual(initialization, { bundle: copy, identity: { transactionId: 'initial-copy' } });
  assert.deepEqual(good(await store.read()).bundle, copy);
  assert.equal((await store.history()).length, 1, 'The adopted copy is the sole initial durable revision');
  assert.equal(reopened.getState().saveState, 'saved');
  assert.equal(storage.entries.size, 0);
});

test('an older save acknowledgement retains edits created while that save was in flight', async t => {
  const { store, bundle } = await persisted(t), delayed = delayedCommit(store), storage = memoryStorage();
  const editor = session(t, bundle, { transport: delayed.transport, recovery: recovery(storage) });
  good(editor.submit(rename('node-a', 'Receive order')));
  const firstSave = editor.save(); await delayed.committed.promise;
  const latest = good(editor.submit(rename('node-b', 'Complete order'))).bundle;
  delayed.release.resolve();
  good(await firstSave);
  const state = editor.getState();
  assert.equal(state.saveState, 'unsaved'); assert.equal(state.pendingCount, 1);
  assert.deepEqual(state.bundle, latest);
  assert.notEqual(state.acknowledged.bundleDigest, latest.bundleDigest);
  assert.ok(storage.entries.size > 0, 'Newer unacknowledged edits retain refresh recovery');
  good(await editor.save());
  assert.equal(editor.getState().saveState, 'saved'); assert.equal(editor.getState().pendingCount, 0);
  assert.deepEqual(good(await store.read()).bundle, latest);
  assert.equal((await store.history()).length, 3, 'Initialization and exactly two edits committed');
  assert.equal(storage.entries.size, 0);
});

test('lost acknowledgement followed by refresh and exact retry settles recovery without a false conflict', async t => {
  const { store, bundle } = await persisted(t), storage = memoryStorage(); let loseResponse = true;
  const transport = { ...store, async commit(transaction) {
    const result = await store.commit(transaction);
    if (loseResponse) { loseResponse = false; throw new Error('Connection closed after durable save'); }
    return result;
  } };
  const original = session(t, bundle, { transport, recovery: recovery(storage) });
  const expected = good(original.submit(rename('node-a', 'Receive order'))).bundle;
  assert.equal((await original.save()).ok, false);
  assert.equal(original.getState().pendingCount, 1); original.dispose();
  const reopened = session(t, good(await store.read()).bundle, { transport, recovery: recovery(storage), nextTransactionId: ids('reopened') });
  assert.deepEqual(reopened.getState().bundle, expected);
  good(await reopened.save());
  assert.equal(reopened.getState().saveState, 'saved', 'An exact replay that matches the refreshed head resolves uncertainty');
  assert.equal(reopened.getState().comparison, null);
  assert.equal(reopened.getState().pendingCount, 0);
  assert.equal((await store.history()).length, 2, 'Retry must not create another durable revision');
  assert.equal(storage.entries.size, 0);
});

test('a historical acknowledgement cannot replace a newer authoritative comparison', async t => {
  const { store, bundle } = await persisted(t), delayed = delayedCommit(store);
  const editor = session(t, bundle, { transport: delayed.transport });
  const draft = good(editor.submit(rename('node-a', 'Receive order'))).bundle;
  const saving = editor.save(); await delayed.committed.promise;
  const newer = await externalEdit(store, rename('node-b', 'External completion'), 'external-completion');
  assert.equal(editor.refresh(newer.bundle).ok, false);
  delayed.release.resolve(); await saving;
  const state = editor.getState();
  assert.equal(state.saveState, 'conflict'); assert.deepEqual(state.bundle, draft);
  assert.deepEqual(state.comparison.bundle, newer.bundle);
  good(editor.useAuthoritative());
  assert.deepEqual(editor.getState().bundle, newer.bundle);
  assert.equal(editor.getState().saveState, 'saved');
});

test('the latest invalid gesture cannot commit an earlier valid preview; indexed selection uses the session camera', t => {
  const bundle = makeBundle(), editor = session(t, bundle);
  good(editor.setView({ camera: { x: 100, y: 200, scale: 2, fit: null }, selection: ['node-a'] }));
  const hit = good(editor.query({ x: 160, y: 280, tolerance: 2 }));
  assert.ok(hit.hits.some(value => value.id === 'node-a'));
  const beforeView = editor.getState().view;
  good(editor.beginGesture()); good(editor.previewGesture({ type: 'move', ids: ['node-a'], dx: 5, dy: 0 }));
  assert.equal(editor.previewGesture({ type: 'move', ids: ['node-a'], dx: 500, dy: 0 }).ok, false);
  assert.equal(editor.completeGesture().ok, false);
  assert.deepEqual(editor.getState().bundle, bundle); assert.equal(editor.getState().pendingCount, 0);
  assert.deepEqual(editor.geometry('node-a').bounds, bundle.presentation.elements[0].bounds);
  good(editor.cancelGesture('pointercancel'));
  good(editor.refresh(bundle));
  assert.deepEqual(editor.getState().view, beforeView);
  assert.equal(editor.getState().canUndo, false);
});

test('undo after a conflicting authoritative refresh preserves newer content and the undo opportunity', async t => {
  const { store, bundle } = await persisted(t), editor = session(t, bundle, { transport: store });
  good(editor.submit(rename('node-a', 'My label'))); good(await editor.save());
  const newer = await externalEdit(store, rename('node-a', 'Another author label'), 'external-rename');
  good(editor.refresh(newer.bundle));
  const result = editor.undo({ transactionId: 'undo-original' });
  assert.equal(result.ok, false); assert.ok(result.diagnostics.some(item => item.rule === 'inverse-conflict'));
  assert.deepEqual(editor.getState().bundle, newer.bundle);
  assert.equal(editor.getState().pendingCount, 0); assert.equal(editor.getState().canUndo, true);
  assert.equal(editor.getState().canRedo, false);
  assert.deepEqual(good(await store.read()).bundle, newer.bundle);
});

test('recovery copied across owner scopes is concealed and unavailable storage retains an honest in-memory draft', t => {
  const bundle = makeBundle(), storage = memoryStorage();
  const original = session(t, bundle, { recovery: recovery(storage) });
  good(original.submit(rename('node-a', 'Private draft')));
  const [key, value] = [...storage.entries][0];
  storage.entries.set(key.replace(':owner-one:', ':owner-two:'), value);
  const other = session(t, bundle, { recovery: recovery(storage, 'owner-two') });
  assert.deepEqual(other.getState().bundle, bundle); assert.equal(other.getState().pendingCount, 0);
  assert.equal(other.getState().recovery.mode, 'memory-only');
  const quota = { getItem: () => null, removeItem() {}, setItem() { throw new Error('Quota exceeded'); } };
  const offline = session(t, bundle, { recovery: recovery(quota) });
  const edited = good(offline.submit(rename('node-a', 'Still available'))).bundle;
  assert.deepEqual(offline.getState().bundle, edited); assert.equal(offline.getState().pendingCount, 1);
  assert.equal(offline.getState().saveState, 'unsaved');
  assert.equal(offline.getState().recovery.mode, 'memory-only'); assert.ok(offline.getState().recovery.warning);
});

for (const action of ['dispose', 'revoke']) test(`late save responses after ${action} cannot repopulate cleared recovery or emit events`, async t => {
  const { store, bundle } = await persisted(t), delayed = delayedCommit(store), storage = memoryStorage();
  const editor = session(t, bundle, { transport: delayed.transport, recovery: recovery(storage) });
  const events = []; editor.subscribe(event => events.push(event));
  good(editor.submit(rename('node-a', 'Awaiting acknowledgement')));
  const saving = editor.save(); await delayed.committed.promise;
  if (action === 'dispose') editor.dispose(); else editor.setCapabilities({ read: false, write: false });
  storage.entries.clear(); const count = events.length;
  delayed.release.resolve(); assert.equal((await saving).ok, false);
  assert.equal(storage.entries.size, 0); assert.equal(events.length, count);
  if (action === 'revoke') assert.equal(editor.getState().bundle, null);
  assert.equal((await store.history()).length, 2, 'The response can be ignored without denying the actual durable save');
});

test('a mismatched successful acknowledgement is returned as failure and leaves the exact edit pending', async t => {
  const { store, bundle } = await persisted(t);
  const transport = { ...store, async commit(transaction) {
    const result = good(await store.commit(transaction));
    return { ...result, receipt: { ...result.receipt, transactionId: 'wrong-operation' } };
  } };
  const editor = session(t, bundle, { transport });
  const expected = good(editor.submit(rename('node-a', 'Pending exact identity'))).bundle;
  assert.equal((await editor.save()).ok, false, 'An unusable ok:true payload is not a successful save result');
  assert.equal(editor.getState().pendingCount, 1); assert.notEqual(editor.getState().saveState, 'saved');
  assert.deepEqual(editor.getState().bundle, expected);
});

test('reentrant save subscribers share one in-flight queue head and cannot drop a newer edit', async t => {
  const { store, bundle } = await persisted(t), committed = deferred(), release = deferred();
  let calls = 0;
  const transport = { ...store, async commit(transaction) {
    calls++;
    const result = await store.commit(transaction); committed.resolve();
    await release.promise; return result;
  } };
  const editor = session(t, bundle, { transport });
  good(editor.submit(rename('node-a', 'First operation')));
  let reentered;
  editor.subscribe(event => {
    if (event.type === 'save' && event.saveState === 'saving' && !reentered) {
      reentered = true;
      reentered = editor.save();
    }
  });
  const saving = editor.save(); await committed.promise;
  const newest = good(editor.submit(rename('node-b', 'Still unacknowledged'))).bundle;
  release.resolve(); await Promise.all([saving, reentered]);
  assert.equal(editor.getState().pendingCount, 1, 'The second edit has not been submitted or acknowledged');
  assert.equal(calls, 1, 'A save subscriber must not dispatch the same queue head a second time');
  assert.equal(editor.getState().saveState, 'unsaved');
  assert.deepEqual(editor.getState().bundle, newest);
  assert.equal((await store.history()).length, 2);
});

test('invalid same-scope recovery stays available for explicit recovery instead of being silently deleted', t => {
  const bundle = makeBundle(), storage = memoryStorage(), archive = recovery(storage);
  const invalid = good(compileDiagramCommand(bundle, rename('node-a', 'Recoverable user intent'), { transactionId: 'damaged-pending' })).transaction;
  invalid.operations[0].unexpected = 'corrupted entry';
  good(archive.save({ base: bundle, initialization: null, transactions: [invalid] }));
  const original = [...storage.entries];
  const editor = session(t, bundle, { recovery: archive });
  assert.deepEqual(editor.getState().bundle, bundle);
  assert.equal(editor.getState().pendingCount, 0);
  assert.ok(editor.getState().recovery.warning);
  assert.equal(storage.entries.size, original.length, 'Validation rejection is not permission to discard the stored draft');
  assert.ok(original.every(([key, value]) => storage.entries.get(key) === value), 'Rejected recovery bytes remain unchanged');
});

test('unknown initialization can be retried after refresh with its original identity before later edits', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'planr-editor-initialize-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bundle = makeBundle(), store = createDiagramAuthoringStore({ root, slug: bundle.diagramId }), storage = memoryStorage();
  let loseResponse = true;
  const transport = { ...store, async initialize(value, identity) {
    const result = await store.initialize(value, identity);
    if (loseResponse) { loseResponse = false; throw new Error('Connection lost after initialization'); }
    return result;
  } };
  const original = session(t, bundle, { acknowledged: false, transport, recovery: recovery(storage) });
  const expected = good(original.submit(rename('node-a', 'First unsaved edit'))).bundle;
  assert.equal((await original.save()).ok, false);
  assert.equal(original.getState().needsInitialization, true); original.dispose();
  const reopened = session(t, good(await store.read()).bundle, { transport, recovery: recovery(storage), nextTransactionId: ids('reopened') });
  good(await reopened.save());
  assert.equal(reopened.getState().needsInitialization, false);
  assert.equal(reopened.getState().saveState, 'saved'); assert.equal(reopened.getState().pendingCount, 0);
  assert.deepEqual(good(await store.read()).bundle, expected);
  assert.equal((await store.history()).length, 2, 'Replayed initialization and the later edit are each durable once');
});

test('default transaction IDs remain valid when UUID entropy starts with a digit', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'planr-editor-default-id-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bundle = makeBundle(), store = createDiagramAuthoringStore({ root, slug: bundle.diagramId });
  const original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID');
  let sequence = 0, editor;
  Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `${++sequence}0000000-0000-4000-8000-000000000000` });
  try {
    editor = createDiagramEditorSession({ bundle, transport: store });
    good(editor.submit(rename('node-a', 'Default identity path')));
  } finally {
    if (original) Object.defineProperty(globalThis.crypto, 'randomUUID', original); else delete globalThis.crypto.randomUUID;
  }
  t.after(() => editor.dispose());
  good(await editor.save());
  assert.equal(editor.getState().saveState, 'saved');
  assert.equal((await store.history()).length, 2);
});

test('a malformed recovered initialization identity cannot replace the current usable session', t => {
  const bundle = makeBundle(), storage = memoryStorage(), archive = recovery(storage);
  const transaction = good(compileDiagramCommand(bundle, rename('node-a', 'Retained intent'), { transactionId: 'valid-pending' })).transaction;
  good(archive.save({ base: bundle, initialization: '1-invalid-init', transactions: [transaction] }));
  const retained = [...storage.entries];
  const editor = session(t, bundle, { recovery: archive });
  assert.deepEqual(editor.getState().bundle, bundle);
  assert.equal(editor.getState().pendingCount, 0); assert.equal(editor.getState().needsInitialization, false);
  assert.ok(editor.getState().recovery.warning);
  assert.ok(retained.every(([key, value]) => storage.entries.get(key) === value));
});


test('malformed recovery envelopes are retained without silently clearing or replacing them', t => {
  for (const draft of [undefined, null, false, 0, 'damaged', []]) {
    const storage = memoryStorage();
    const key = 'openplanr:diagram-editor:1:owner-one:checkout';
    const raw = JSON.stringify({ version: 1, scope: { sessionId: 'owner-one', diagramId: 'checkout' }, draft });
    storage.setItem(key, raw);
    const editor = session(t, makeBundle(), { recovery: recovery(storage) });
    assert.equal(editor.getState().pendingCount, 0);
    assert.equal(editor.getState().recovery.mode, 'memory-only');
    editor.submit(rename('node-a', 'Keep the new draft in memory'));
    assert.equal(storage.getItem(key), raw);
  }
});
