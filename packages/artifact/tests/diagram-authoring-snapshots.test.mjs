import assert from 'node:assert/strict';
import test from 'node:test';
import {
  copyImmutableDiagramData,
  DIAGRAM_AUTHORING_LIMITS,
  diagramDocumentDigest,
  validateDiagramAuthoringBundle,
  validateDiagramEditTransaction,
} from '@openplanr/protocol/diagram-authoring-contracts';
import {
  createVersionedDiagramAuthoringSnapshot,
  normalizeDiagramPresentation,
} from '@openplanr/protocol/studio-presentation-contracts';
import { makeBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import {
  compileDiagramCommand,
  previewDiagramTransaction,
  validateAuthoringBundle,
} from '../lib/artifact/diagram/authoring/index.mjs';
import {
  createAuthoringSnapshot,
  isAuthoringSnapshot,
} from '../lib/artifact/diagram/authoring/model.mjs';
import { previewDiagramTransactionForEditor } from '../lib/artifact/diagram/authoring/transactions.mjs';
import { createDiagramEditorSession } from '../lib/artifact/diagram/editor/session.mjs';

test('only detached, fully validated, recursively immutable engine copies carry validation provenance', () => {
  const input = makeBundle();
  const snapshot = createAuthoringSnapshot(input);
  assert.equal(snapshot.ok, true);
  assert.equal(isAuthoringSnapshot(input), false);
  assert.equal(isAuthoringSnapshot(snapshot.bundle), true);
  assert.notEqual(snapshot.bundle.document.nodes[0], input.document.nodes[0]);
  const visit = (value) => {
    if (value && typeof value === 'object') {
      assert.ok(Object.isFrozen(value));
      for (const child of Object.values(value)) visit(child);
    }
  };
  visit(snapshot.bundle);
  assert.equal(validateAuthoringBundle(snapshot.bundle).ok, true);
  input.document.nodes[0].label = 'Caller mutation';
  assert.equal(validateAuthoringBundle(input).ok, false);
  assert.equal(snapshot.bundle.document.nodes[0].label, makeBundle().document.nodes[0].label);
  assert.equal(validateDiagramAuthoringBundle(snapshot.bundle).length, 0);
});

test('shallow freezing, copied digests and previously valid mutable identities cannot forge a snapshot', () => {
  const input = makeBundle();
  assert.equal(validateAuthoringBundle(input).ok, true);
  Object.freeze(input);
  input.document.nodes[0].label = 'Changed behind shallow freeze';
  assert.equal(isAuthoringSnapshot(input), false);
  assert.equal(validateAuthoringBundle(input).ok, false);
  assert.throws(() => createVersionedDiagramAuthoringSnapshot(input));
  const copied = structuredClone(makeBundle());
  const digest = diagramDocumentDigest(copied.document);
  copied.document.nodes[0].label = 'Second mutable change';
  assert.notEqual(diagramDocumentDigest(copied.document), digest);
});

test('snapshot copying does not invoke accessors or omit hostile own properties', () => {
  let invoked = 0;
  const input = makeBundle();
  Object.defineProperty(input.document.nodes[0], 'label', {
    enumerable: true,
    get() {
      invoked++;
      return 'Start';
    },
  });
  assert.equal(createAuthoringSnapshot(input).ok, false);
  assert.equal(invoked, 0);
  for (const add of [
    (value) => Object.defineProperty(value.document, 'secret', { value: 'x', enumerable: false }),
    (value) => (value.document[Symbol('hidden')] = 'x'),
    (value) => Object.defineProperty(value.document, '__proto__', { value: {}, enumerable: true }),
  ]) {
    const value = makeBundle();
    add(value);
    assert.equal(createAuthoringSnapshot(value).ok, false);
  }
});

test('public and editor transaction dispatch reject version accessors without executing them or changing the bundle', () => {
  const bundle = makeBundle();
  const certified = createAuthoringSnapshot(bundle).bundle;
  const editor = createDiagramEditorSession({ bundle, acknowledged: true });
  const before = JSON.stringify(bundle);
  const privateBefore = JSON.stringify(certified);
  for (const version of ['1.0.0', '1.1.0', null]) {
    for (const preview of [
      (value) => previewDiagramTransaction(bundle, value),
      (value) => previewDiagramTransactionForEditor(certified, value),
      (value) => editor.submitTransaction(value),
    ]) {
      let calls = 0;
      const transaction = {};
      Object.defineProperty(transaction, 'schemaVersion', {
        enumerable: true,
        get() {
          calls++;
          if (version === null) throw new Error('Version getter must not execute.');
          return version;
        },
      });
      const result = preview(transaction);
      assert.equal(result.ok, false);
      assert.equal(calls, 0);
      assert.ok(result.diagnostics.length > 0);
      assert.equal(JSON.stringify(bundle), before);
      assert.equal(JSON.stringify(certified), privateBefore);
      const state = editor.getState();
      assert.deepEqual(state.bundle, bundle);
      assert.equal(state.pendingCount, 0);
      assert.equal(state.canUndo, false);
    }
  }
});

test('inert transaction dispatch preserves legacy diagnostics and accepts a complete versioned palette revision', () => {
  const bundle = makeBundle();
  const compiled = compileDiagramCommand(
    bundle,
    { type: 'move', ids: ['node-a'], dx: 5, dy: 0 },
    { transactionId: 'legacy-dispatch' },
  );
  assert.equal(compiled.ok, true);
  for (const edit of [
    (value) => delete value.kind,
    (value) => (value.unexpected = true),
    (value) => (value.operations = []),
    (value) => (value.base.bundleDigest = 'invalid'),
  ]) {
    const transaction = structuredClone(compiled.transaction);
    edit(transaction);
    const expected = validateDiagramEditTransaction(transaction);
    assert.ok(expected.length > 0);
    for (const preview of [previewDiagramTransaction, previewDiagramTransactionForEditor]) {
      const result = preview(bundle, transaction);
      assert.equal(result.ok, false);
      assert.deepEqual(result.diagnostics, expected);
    }
  }
  const palette = compileDiagramCommand(
    bundle,
    {
      type: 'set-studio-presentation',
      presentation: normalizeDiagramPresentation({ theme: 'dark' }),
    },
    { transactionId: 'versioned-dispatch' },
  );
  assert.equal(palette.ok, true);
  assert.equal(palette.transaction.schemaVersion, '1.1.0');
  for (const preview of [previewDiagramTransaction, previewDiagramTransactionForEditor]) {
    const result = preview(bundle, palette.transaction);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.bundle, palette.bundle);
    assert.deepEqual(result.bundle.document, bundle.document);
    assert.deepEqual(result.bundle.presentation, bundle.presentation);
  }
  const editor = createDiagramEditorSession({ bundle, acknowledged: true });
  assert.equal(editor.submitTransaction(palette.transaction).ok, true);
  assert.deepEqual(editor.getState().bundle, palette.bundle);
});

test('cached immutable subtree proofs retain aggregate text and nesting limits', () => {
  const child = copyImmutableDiagramData({
    text: 'x'.repeat(DIAGRAM_AUTHORING_LIMITS.textCodeUnits / 2 + 1),
  });
  assert.throws(() => copyImmutableDiagramData({ first: child, second: child }), /resource-limit/);
  let nested = copyImmutableDiagramData({ leaf: 'x' });
  for (let index = 0; index < DIAGRAM_AUTHORING_LIMITS.depth + 1; index++)
    nested = { child: nested };
  assert.throws(() => copyImmutableDiagramData(nested), /resource-limit/);
});

test('final validation rejects a newly dangling reference even with a certified base', () => {
  const certified = createAuthoringSnapshot(makeBundle()).bundle;
  const result = previewDiagramTransaction(certified, {
    kind: 'diagram-edit-transaction',
    schemaVersion: '1.0.0',
    protocolVersion: '1.13.0',
    diagramId: certified.diagramId,
    transactionId: 'dangling-edit',
    base: {
      bundleDigest: certified.bundleDigest,
      semanticDigest: certified.document.documentDigest,
      presentationDigest: certified.presentation.presentationDigest,
    },
    operations: [
      {
        type: 'update-semantics',
        collection: 'relations',
        elementId: certified.document.relations[0].id,
        before: (({ id: _id, ...fields }) => fields)(certified.document.relations[0]),
        after: (({ id: _id, ...fields }) => ({ ...fields, to: 'missing-node' }))(
          certified.document.relations[0],
        ),
      },
    ],
    undoOf: null,
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some((issue) => issue.rule === 'endpoint'),
    JSON.stringify(result.diagnostics),
  );
  assert.equal(validateAuthoringBundle(certified).ok, true);
});

test('public preview/session results stay mutable and detached from internal revisions and undo', () => {
  const input = makeBundle();
  const editor = createDiagramEditorSession({ bundle: input, acknowledged: true });
  const result = editor.submit(
    { type: 'move', ids: ['node-a'], dx: 10, dy: 0 },
    { transactionId: 'move-a' },
  );
  assert.equal(result.ok, true);
  const expected = editor.getState().bundle;
  assert.equal(Object.isFrozen(result.bundle), false);
  result.bundle.document.nodes[0].label = 'Public mutation';
  result.bundle.presentation.elements[0].appearance.fill = '#123456';
  const state = editor.getState();
  state.bundle.document.nodes[0].label = 'Another public mutation';
  assert.deepEqual(editor.getState().bundle, expected);
  assert.equal(editor.undo({ transactionId: 'undo-a' }).ok, true);
  assert.deepEqual(editor.getState().bundle, input);
  const preview = compileDiagramCommand(
    input,
    { type: 'move', ids: ['node-a'], dx: 5, dy: 0 },
    { transactionId: 'preview-a' },
  );
  assert.equal(preview.ok, true);
  assert.equal(Object.isFrozen(preview.bundle.document), false);
});

test('trusted chrome reads share only engine-certified frozen bundle roots and never alter public snapshot behavior', async () => {
  const { readEditorState, registerEditorStateReader } = await import(
    '../lib/artifact/diagram/editor/session-view.mjs'
  );
  const editor = createDiagramEditorSession({ bundle: makeBundle(), acknowledged: true });
  const first = readEditorState(editor),
    second = readEditorState(editor);
  assert.equal(first.bundle, second.bundle);
  assert.equal(isAuthoringSnapshot(first.bundle), true);
  assert.ok(Object.isFrozen(first.bundle.document.nodes[0]));
  first.view.selection.push('node-a');
  assert.deepEqual(editor.getState().view.selection, []);
  assert.throws(() => registerEditorStateReader(editor, () => first), /already registered/);
  const ordinary = editor.getState();
  assert.notEqual(ordinary.bundle, first.bundle);
  ordinary.bundle.document.title = 'Mutable public snapshot';
  assert.notEqual(readEditorState(editor).bundle.document.title, ordinary.bundle.document.title);
  assert.equal(
    editor.submit(
      { type: 'move', ids: ['node-a'], dx: 5, dy: 0 },
      { transactionId: 'private-view-move' },
    ).ok,
    true,
  );
  const changed = readEditorState(editor);
  assert.notEqual(changed.bundle, first.bundle);
  assert.equal(changed.bundle.document, first.bundle.document);
});
