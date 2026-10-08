import assert from 'node:assert/strict';
import test from 'node:test';
import { makeBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import {
  compileDiagramCommand,
  previewDiagramMerge,
} from '../lib/artifact/diagram/authoring/index.mjs';
import {
  createDiagramEditorDraft,
  createDiagramEditorRecovery,
  createDiagramEditorSession,
} from '../lib/artifact/diagram/editor/index.mjs';

const rename = (label) => ({ type: 'rename', id: 'node-a', label });
let counter = 0;
const nextId = () => `conflict-${++counter}`;
function edit(bundle, command) {
  const result = compileDiagramCommand(bundle, command, { transactionId: nextId() });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.bundle;
}
function session(bundle, options = {}) {
  return createDiagramEditorSession({
    bundle,
    acknowledged: true,
    nextTransactionId: nextId,
    ...options,
  });
}
function resolution(editor, choices = {}) {
  const state = editor.getState();
  return {
    localDigest: state.bundle.bundleDigest,
    remoteDigest: state.comparison.bundle.bundleDigest,
    choices,
  };
}
const basis = (bundle) => ({
  bundleDigest: bundle.bundleDigest,
  semanticDigest: bundle.document.documentDigest,
  presentationDigest: bundle.presentation.presentationDigest,
});

test('independent fields survive a fresh CAS resolution, recovery, acknowledgement and undo', async () => {
  const base = makeBundle();
  const remote = edit(base, {
    type: 'describe',
    id: 'node-a',
    description: 'Changed by another author',
  });
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const scope = { sessionId: 'actor-company', diagramId: base.diagramId };
  const recovery = () => createDiagramEditorRecovery({ storage, scope });
  let captured;
  const transport = {
    read: async () => ({ ok: true, status: 'ready', bundle: remote }),
    saveBatch: async (batch) => {
      captured = structuredClone(batch);
      assert.deepEqual(batch.base, remote);
      return {
        ok: true,
        status: 'saved',
        bundle: batch.result,
        receipt: { batchId: batch.batchId, result: basis(batch.result) },
      };
    },
  };
  const editor = session(base, { recovery: recovery(), transport });
  editor.submit(rename('My local label'));
  editor.setView({ camera: { x: 18, y: 27, scale: 2, fit: null }, selection: ['node-a'] });
  editor.refresh(remote);
  const before = editor.getState();
  assert.equal(editor.previewConflict().ok, true);
  assert.deepEqual(editor.getState(), before, 'preview must not mutate the draft');
  assert.deepEqual(editor.resolveConflict(resolution(editor)), { ok: true, changed: true });
  const resolved = editor.getState();
  assert.equal(resolved.saveState, 'unsaved');
  assert.equal(resolved.bundle.document.nodes[0].label, 'My local label');
  assert.equal(resolved.bundle.document.nodes[0].description, 'Changed by another author');
  assert.deepEqual(resolved.view, before.view);
  const reopened = session(remote, { recovery: recovery(), transport });
  assert.deepEqual(reopened.getState().bundle, resolved.bundle);
  assert.equal((await reopened.save()).ok, true);
  assert.equal(captured.transactions.length, 1);
  assert.deepEqual(captured.transactions[0].base, basis(remote));
  assert.equal(reopened.getState().saveState, 'saved');
  assert.equal(reopened.undo().ok, true);
  assert.deepEqual(reopened.getState().bundle, remote, 'undo preserves the other author’s edit');
});

test('every overlapping field requires a choice; choosing remote retains independent local edits', () => {
  const base = makeBundle();
  const editor = session(base);
  editor.submit(rename('Mine'));
  editor.submit({ type: 'describe', id: 'node-a', description: 'Independent local detail' });
  const remote = edit(base, rename('Theirs'));
  editor.refresh(remote);
  const result = editor.previewConflict();
  assert.equal(result.ok, false);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.conflicts[0].path, ['document', 'nodes', 'node-a', 'label']);
  const before = editor.getState();
  assert.equal(editor.resolveConflict(resolution(editor)).ok, false);
  assert.deepEqual(editor.getState(), before);
  const choices = { [result.conflicts[0].id]: 'remote' };
  assert.equal(editor.resolveConflict(resolution(editor, choices)).ok, true);
  assert.equal(editor.getState().bundle.document.nodes[0].label, 'Theirs');
  assert.equal(editor.getState().bundle.document.nodes[0].description, 'Independent local detail');
});

test('continued editing or a newer head invalidates previously observed choices', () => {
  const base = makeBundle();
  const editor = session(base);
  editor.submit(rename('Mine'));
  const remote = edit(base, rename('Theirs'));
  editor.refresh(remote);
  const conflict = editor.previewConflict().conflicts[0];
  const old = resolution(editor, { [conflict.id]: 'local' });
  editor.submit({ type: 'describe', id: 'node-a', description: 'Still editing' });
  assert.equal(editor.resolveConflict(old).diagnostics[0].rule, 'stale-comparison');
  const next = resolution(editor, { [conflict.id]: 'local' });
  editor.refresh(edit(remote, rename('Third writer')));
  assert.equal(editor.resolveConflict(next).diagnostics[0].rule, 'stale-comparison');
  assert.equal(editor.getState().bundle.document.nodes[0].description, 'Still editing');
});

test('another CAS race retains the resolved draft and opens a new comparison', async () => {
  const base = makeBundle();
  const remote = edit(base, rename('Theirs'));
  const third = edit(remote, rename('Newer head'));
  let writes = 0;
  const editor = session(base, {
    transport: {
      read: async () => ({ ok: true, status: 'ready', bundle: third }),
      saveBatch: async () => {
        writes++;
        return { ok: false, httpStatus: 409 };
      },
    },
  });
  editor.submit(rename('Mine'));
  editor.refresh(remote);
  assert.equal((await editor.save()).ok, false);
  assert.equal(writes, 0, 'unresolved comparisons must never be sent');
  const conflict = editor.previewConflict().conflicts[0];
  assert.equal(editor.resolveConflict(resolution(editor, { [conflict.id]: 'local' })).ok, true);
  const retained = editor.getState().bundle;
  assert.equal((await editor.save()).ok, false);
  assert.equal(editor.getState().saveState, 'conflict');
  editor.refresh(third);
  assert.deepEqual(editor.getState().bundle, retained);
  assert.equal(editor.previewConflict().conflicts.length, 1);
});

test('delete versus edit requires an explicit structural choice and never loses the retained draft', () => {
  const base = makeBundle();
  const mine = edit(base, rename('Retain this'));
  const impact = compileDiagramCommand(
    base,
    { type: 'delete', ids: ['node-a'] },
    { transactionId: nextId() },
  );
  const remote = edit(base, {
    type: 'delete',
    ids: ['node-a'],
    confirmedImpact: impact.deletionImpact,
  });
  const result = previewDiagramMerge(base, mine, remote);
  assert.equal(result.ok, false);
  assert.ok(
    result.conflicts.some((item) => item.id === JSON.stringify(['document', 'nodes', 'node-a'])),
  );
  assert.equal(
    result.conflicts.find((item) => item.path.at(-1) === 'node-a').present.remote,
    false,
  );
});

test('unknown choices, foreign diagrams and malformed choices fail without mutation', () => {
  const base = makeBundle();
  const mine = edit(base, rename('Mine'));
  const remote = edit(base, rename('Theirs'));
  assert.equal(
    previewDiagramMerge(base, mine, remote, { old: 'local' }).diagnostics[0].rule,
    'stale-choices',
  );
  assert.equal(
    previewDiagramMerge(base, mine, remote, { old: 'invalid' }).diagnostics[0].rule,
    'merge-choices',
  );
  assert.equal(previewDiagramMerge(base, mine, remote, null).ok, false);
  const foreign = createDiagramEditorDraft({ diagramId: 'foreign', title: 'Foreign' });
  assert.equal(foreign.ok, true);
  assert.equal(previewDiagramMerge(base, mine, foreign.bundle).diagnostics[0].rule, 'diagram-id');
});

test('active gestures, revoked access and unconfirmed save bytes block resolution', async () => {
  const base = makeBundle();
  const editor = session(base);
  editor.submit(rename('Mine'));
  editor.refresh(edit(base, rename('Theirs')));
  editor.beginGesture();
  assert.equal(
    editor.resolveConflict(resolution(editor)).diagnostics[0].rule,
    'resolution-pending',
  );
  editor.cancelGesture();
  editor.setCapabilities({ read: true, write: false });
  assert.equal(editor.resolveConflict(resolution(editor)).diagnostics[0].rule, 'access-changed');
  const unknown = session(base, {
    transport: {
      read: async () => ({ ok: true, status: 'ready', bundle: base }),
      saveBatch: async () => ({ ok: false, status: 'unknown' }),
    },
  });
  unknown.submit(rename('Unconfirmed'));
  await unknown.save();
  unknown.refresh(edit(base, rename('Theirs')));
  assert.equal(
    unknown.resolveConflict(resolution(unknown)).diagnostics[0].rule,
    'resolution-pending',
  );
});
