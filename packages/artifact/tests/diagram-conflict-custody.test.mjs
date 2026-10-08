import assert from 'node:assert/strict';
import test from 'node:test';
import { makeBundle, sealBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import {
  compileDiagramBundleTransaction,
  compileDiagramCommand,
  previewDiagramMerge,
} from '../lib/artifact/diagram/authoring/index.mjs';
import { createDiagramEditorSession } from '../lib/artifact/diagram/editor/index.mjs';

let counter = 0;
const nextId = () => `independent-qa-${++counter}`;
function edit(base, command) {
  const result = compileDiagramCommand(base, command, { transactionId: nextId() });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.bundle;
}
function remove(base, id) {
  const impact = compileDiagramCommand(
    base,
    { type: 'delete', ids: [id] },
    { transactionId: nextId() },
  );
  return edit(base, { type: 'delete', ids: [id], confirmedImpact: impact.deletionImpact });
}
const allChoices = (preview, choice) =>
  Object.fromEntries(preview.conflicts.map((item) => [item.id, choice]));

test('retaining semantic edit against remote deletion retains a valid placement', () => {
  const base = makeBundle();
  const local = edit(base, { type: 'rename', id: 'node-a', label: 'Retained' });
  const remote = remove(base, 'node-a');
  const preview = previewDiagramMerge(base, local, remote);
  const resolved = previewDiagramMerge(base, local, remote, allChoices(preview, 'local'));
  assert.equal(resolved.ok, true, JSON.stringify(resolved));
  assert.equal(
    resolved.bundle.document.nodes.find((node) => node.id === 'node-a').label,
    'Retained',
  );
  assert.ok(
    resolved.bundle.presentation.elements.some((placement) => placement.elementId === 'node-a'),
  );
});

test('independent source-linked edits cannot restore stale exact correspondence', () => {
  const base = makeBundle('flowchart', { source: true });
  const local = edit(base, { type: 'rename', id: 'node-a', label: 'New local A' });
  const remote = edit(base, { type: 'rename', id: 'node-b', label: 'New remote B' });
  const preview = previewDiagramMerge(base, local, remote);
  for (const choice of ['local', 'remote']) {
    const resolved = previewDiagramMerge(base, local, remote, allChoices(preview, choice));
    assert.equal(resolved.ok, true, JSON.stringify(resolved));
    assert.deepEqual(resolved.bundle.originalSource, base.originalSource);
    assert.deepEqual(
      resolved.bundle.document.nodes.map((node) => node.label),
      ['New local A', 'New remote B'],
    );
    assert.deepEqual(
      resolved.bundle.sourceMap.entries.map((entry) => entry.confidence),
      ['ambiguous', 'ambiguous'],
    );
    assert.equal(
      compileDiagramBundleTransaction(remote, resolved.bundle, { transactionId: nextId() }).ok,
      true,
    );
  }
});

test('unknown individual commit keeps exact retry identity through attempted resolution', async () => {
  const base = makeBundle();
  const remote = edit(base, { type: 'rename', id: 'node-a', label: 'Remote' });
  let retained;
  const recovery = {
    load: () => null,
    save: (record) => {
      retained = structuredClone(record);
    },
    clear: () => {
      retained = null;
    },
    status: () => ({ mode: 'persistent' }),
  };
  const editor = createDiagramEditorSession({
    bundle: base,
    acknowledged: true,
    nextTransactionId: nextId,
    recovery,
    transport: {
      read: async () => ({ ok: true, status: 'ready', bundle: remote }),
      initialize: async () => ({ ok: false, status: 'unknown' }),
      commit: async () => ({ ok: false, status: 'unknown' }),
    },
  });
  editor.submit({ type: 'rename', id: 'node-a', label: 'Unknown outcome local' });
  await editor.save();
  const exact = structuredClone(retained);
  editor.refresh(remote);
  const state = editor.getState();
  const resolved = editor.resolveConflict({
    localDigest: state.bundle.bundleDigest,
    remoteDigest: state.comparison.bundle.bundleDigest,
    choices: allChoices(editor.previewConflict(), 'local'),
  });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.diagnostics[0].rule, 'resolution-pending');
  assert.deepEqual(retained, exact);
});

test('unsupported collection reorder fails without silently changing target', () => {
  const base = makeBundle();
  const target = structuredClone(base);
  target.document.nodes.reverse();
  sealBundle(target);
  const before = structuredClone(target);
  const result = compileDiagramBundleTransaction(base, target, { transactionId: nextId() });
  assert.equal(result.ok, false);
  assert.deepEqual(target, before);
});

test('retaining source-linked deletion choices keeps exact original source bytes', () => {
  const base = makeBundle('flowchart', { source: true });
  const local = edit(base, { type: 'rename', id: 'node-a', label: 'Retained source node' });
  const remote = remove(base, 'node-a');
  const preview = previewDiagramMerge(base, local, remote);
  const resolved = previewDiagramMerge(base, local, remote, allChoices(preview, 'local'));
  assert.equal(resolved.ok, true, JSON.stringify(resolved));
  assert.deepEqual(resolved.bundle.originalSource, base.originalSource);
  assert.equal(
    compileDiagramBundleTransaction(remote, resolved.bundle, { transactionId: nextId() }).ok,
    true,
  );
});

test('local deletion versus remote geometry editing also requires a paired structural choice', () => {
  const base = makeBundle();
  const local = remove(base, 'node-a');
  const remote = edit(base, { type: 'move', ids: ['node-a'], dx: 10, dy: 0 });
  const preview = previewDiagramMerge(base, local, remote);
  assert.equal(preview.ok, false);
  const resolved = previewDiagramMerge(base, local, remote, allChoices(preview, 'remote'));
  assert.equal(resolved.ok, true, JSON.stringify(resolved));
  assert.deepEqual(
    resolved.bundle.presentation.elements.find((item) => item.elementId === 'node-a'),
    remote.presentation.elements.find((item) => item.elementId === 'node-a'),
  );
});

test('independent manual source remapping remains retained instead of being silently reset', () => {
  const base = makeBundle('flowchart', { source: true });
  const local = structuredClone(base);
  local.sourceMap.entries[0].elementIds = ['node-b'];
  local.sourceMap.entries[0].confidence = 'ambiguous';
  local.sourceMap.entries[0].losses = ['Explicitly remapped correspondence'];
  sealBundle(local);
  const remote = edit(base, { type: 'describe', id: 'node-b', description: 'Independent note' });
  const before = structuredClone(local);
  const result = previewDiagramMerge(base, local, remote);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].rule, 'source-correspondence');
  assert.deepEqual(local, before);
});

test('unknown individual commit survives reopening and retries exact transaction bytes', async () => {
  const base = makeBundle();
  let retained;
  const recovery = {
    load: () => structuredClone(retained ?? null),
    save: (record) => {
      retained = structuredClone(record);
    },
    clear: () => {
      retained = null;
    },
    status: () => ({ mode: 'persistent' }),
  };
  let sent;
  let expected;
  let unknown = true;
  const transport = {
    read: async () => ({ ok: true, status: 'ready', bundle: base }),
    initialize: async () => ({ ok: false, status: 'unknown' }),
    commit: async (transaction) => {
      if (unknown) {
        sent = structuredClone(transaction);
        return { ok: false, status: 'unknown' };
      }
      assert.deepEqual(transaction, sent);
      return {
        ok: true,
        status: 'saved',
        bundle: expected,
        receipt: {
          transactionId: sent.transactionId,
          result: {
            bundleDigest: expected.bundleDigest,
            semanticDigest: expected.document.documentDigest,
            presentationDigest: expected.presentation.presentationDigest,
          },
        },
      };
    },
  };
  const original = createDiagramEditorSession({
    bundle: base,
    acknowledged: true,
    recovery,
    transport,
    nextTransactionId: nextId,
  });
  original.submit({ type: 'rename', id: 'node-a', label: 'Unknown bytes retained' });
  expected = original.getState().bundle;
  await original.save();
  unknown = false;
  const remote = edit(base, { type: 'describe', id: 'node-b', description: 'New remote detail' });
  const reopened = createDiagramEditorSession({
    bundle: remote,
    acknowledged: true,
    recovery,
    transport,
    nextTransactionId: nextId,
  });
  assert.deepEqual(reopened.getState().bundle, expected);
  assert.equal((await reopened.save()).ok, true);
  assert.equal(reopened.getState().pendingCount, 0);
  assert.equal(reopened.getState().saveState, 'conflict');
});

test('unknown initialization survives reopening and retries exact initial bytes and identity', async () => {
  const base = makeBundle();
  let retained;
  const recovery = {
    load: () => structuredClone(retained ?? null),
    save: (record) => {
      retained = structuredClone(record);
    },
    clear: () => {
      retained = null;
    },
    status: () => ({ mode: 'persistent' }),
  };
  const snapshot = (bundle) => ({
    bundleDigest: bundle.bundleDigest,
    semanticDigest: bundle.document.documentDigest,
    presentationDigest: bundle.presentation.presentationDigest,
  });
  let firstRequest;
  let firstIdentity;
  let expected;
  let unknown = true;
  const transport = {
    read: async () => ({ ok: true, status: 'absent' }),
    initialize: async (bundle, identity) => {
      if (unknown) {
        firstRequest = structuredClone(bundle);
        firstIdentity = structuredClone(identity);
        return { ok: false, status: 'unknown' };
      }
      assert.deepEqual(bundle, firstRequest);
      assert.deepEqual(identity, firstIdentity);
      return {
        ok: true,
        status: 'saved',
        bundle,
        receipt: { transactionId: identity.transactionId, result: snapshot(bundle) },
      };
    },
    commit: async (transaction) => ({
      ok: true,
      status: 'saved',
      bundle: expected,
      receipt: { transactionId: transaction.transactionId, result: snapshot(expected) },
    }),
  };
  const original = createDiagramEditorSession({
    bundle: base,
    recovery,
    transport,
    nextTransactionId: nextId,
  });
  original.submit({ type: 'rename', id: 'node-a', label: 'Initial local edit' });
  expected = original.getState().bundle;
  await original.save();
  assert.equal(retained.uncertain.count, 0);
  assert.equal(retained.initialization, firstIdentity.transactionId);
  unknown = false;
  const reopened = createDiagramEditorSession({
    bundle: base,
    recovery,
    transport,
    nextTransactionId: nextId,
  });
  assert.deepEqual(reopened.getState().bundle, expected);
  assert.equal((await reopened.save()).ok, true);
  assert.equal(reopened.getState().saveState, 'saved');
  assert.equal(retained, null);
});
