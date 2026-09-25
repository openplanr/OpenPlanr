import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeBundle, placement, sealBundle, SOURCE_TEXT } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { createDiagramAuthoringStore } from '../lib/artifact/diagram/authoring/store.mjs';
import { adoptMermaidCopy, compileDiagramCommand, previewMermaidCopy } from '../lib/artifact/diagram/authoring/index.mjs';
import {
  createDiagramEditorSession, openDiagramEditorSession, createDiagramEditorDraft,
  createDiagramEditorRecovery, copyDiagramSelection, pasteDiagramSelection, bindDiagramEditorCancellation,
} from '../lib/artifact/diagram/editor/index.mjs';

const ids = () => { let id = 0; return () => `editor-${++id}`; };
const session = (bundle = makeBundle(), options = {}) => createDiagramEditorSession({ bundle, acknowledged: true, nextTransactionId: ids(), ...options });
const rename = label => ({ type: 'rename', id: 'node-a', label });
const storage = () => { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
function importedCopy({ diagramId = 'checkout', title = 'Checkout' } = {}) {
  const preview = previewMermaidCopy(SOURCE_TEXT, { diagramId, title });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  const adopted = adoptMermaidCopy(preview, preview.acknowledgement);
  assert.equal(adopted.ok, true, JSON.stringify(adopted));
  return adopted.bundle;
}
async function storeFor(t, slug) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'openplanr-editor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return createDiagramAuthoringStore({ root, slug });
}

test('offline blank creation, edit, save and reopen retain the complete paired revision', async t => {
  const draft = createDiagramEditorDraft({ diagramId: 'offline', title: 'Offline diagram' });
  assert.equal(draft.ok, true, JSON.stringify(draft));
  const store = await storeFor(t, 'offline');
  const editor = await openDiagramEditorSession({ transport: store, create: draft.bundle, nextTransactionId: ids() });
  assert.equal(editor.getState().saveState, 'unsaved');
  const created = editor.submit({ type: 'create', elements: [{ collection: 'nodes', value: { id: 'first', label: 'First step', kind: 'process', description: null } }], presentation: [placement('first')] });
  assert.equal(created.ok, true);
  assert.equal(editor.getState().pendingCount, 1);
  const saved = await editor.save(); assert.equal(saved.status, 'saved', JSON.stringify(saved));
  editor.dispose();
  const reopened = await openDiagramEditorSession({ transport: store });
  assert.deepEqual(reopened.getState().bundle, created.bundle);
  assert.equal(reopened.getState().saveState, 'saved');
  assert.equal((await store.history()).length, 2);
});

test('validated templates receive diagram identity without retaining linked source custody', () => {
  const source = makeBundle('swimlane', { source: true });
  const draft = createDiagramEditorDraft({ diagramId: 'new-workflow', title: 'New workflow', template: source });
  assert.equal(draft.ok, true, JSON.stringify(draft));
  assert.equal(draft.bundle.document.diagramId, 'new-workflow');
  assert.deepEqual(draft.bundle.document.nodes, source.document.nodes);
  assert.deepEqual(draft.bundle.presentation.elements, source.presentation.elements);
  assert.equal(draft.bundle.sourceMap, null);
  assert.equal(source.diagramId, 'checkout');
  const invalid = structuredClone(source); invalid.document.nodes[0].label = '<script>alert(1)</script>';
  assert.equal(createDiagramEditorDraft({ diagramId: 'invalid', title: 'Invalid', template: invalid }).ok, false);
});

test('the named process template starts a new diagram with a connected start, step and end', () => {
  const draft = createDiagramEditorDraft({ diagramId: 'onboarding', title: 'Onboarding', template: 'process' });
  assert.equal(draft.ok, true, JSON.stringify(draft));
  assert.deepEqual(draft.bundle.document.nodes.map(node => node.kind), ['start', 'process', 'end']);
  assert.equal(draft.bundle.document.relations.length, 2);
  assert.equal(draft.bundle.presentation.elements.length, 5);
  assert.equal(draft.bundle.document.title, 'Onboarding');
  assert.equal(createDiagramEditorSession({ bundle: draft.bundle }).getState().pendingCount, 0, 'The template belongs to the new diagram, not to its pending edits');
  const unknown = createDiagramEditorDraft({ diagramId: 'kanban', title: 'Kanban', template: 'kanban' });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.diagnostics[0].detail, 'Unknown diagram template: kanban.');
});

test('initial copy adoption rejects every non-initial session state without changing either bundle', async () => {
  const blank = makeBundle('flowchart', { blank: true });
  const candidate = importedCopy();
  const editors = [];
  const add = (name, editor) => { editors.push(editor); return { name, editor }; };

  const pending = session(blank, { acknowledged: false });
  assert.equal(pending.submit({ type: 'create', elements: [{ collection: 'nodes', value: { id: 'draft-node', label: 'Draft', kind: 'process', description: null } }], presentation: [placement('draft-node')] }).ok, true);
  const gesturing = session(blank, { acknowledged: false });
  assert.equal(gesturing.beginGesture({ transactionId: 'copy-gesture' }).ok, true);
  const conflicted = session(blank, { acknowledged: false });
  assert.equal(conflicted.refresh(makeBundle()).ok, false);
  const offline = session(blank, { acknowledged: false });
  assert.equal((await offline.save()).ok, false);

  const cases = [
    add('acknowledged', session(blank)),
    add('populated', session(makeBundle(), { acknowledged: false })),
    add('pending', pending),
    add('gesture', gesturing),
    add('conflict', conflicted),
    add('offline', offline),
  ];
  for (const { name, editor } of cases) {
    const before = editor.getState();
    const input = structuredClone(candidate);
    const result = editor.adoptInitialCopy(input);
    assert.equal(result.ok, false, `${name} session unexpectedly adopted a copy`);
    assert.equal(result.diagnostics[0].rule, 'initial-copy-state');
    assert.deepEqual(editor.getState(), before, `${name} session changed after rejection`);
    assert.deepEqual(input, candidate, `${name} adoption mutated the caller's bundle`);
  }
  editors.forEach(editor => editor.dispose());

  const titled = session(blank, { acknowledged: false });
  const before = titled.getState();
  const mismatched = importedCopy({ title: 'Imported title' });
  const result = titled.adoptInitialCopy(mismatched);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].rule, 'diagram-title');
  assert.deepEqual(titled.getState(), before);
  titled.dispose();
});

test('one multi-object gesture commits one inverse; cancel events persist no partial edit', () => {
  const bundle = makeBundle('swimlane'); const editor = session(bundle); const target = new EventTarget();
  const unbind = bindDiagramEditorCancellation(editor, target);
  for (const eventName of ['keydown', 'pointercancel', 'lostpointercapture', 'blur']) {
    editor.beginGesture();
    assert.equal(editor.previewGesture({ type: 'move', ids: ['lane-a'], dx: 20, dy: 10 }).ok, true);
    assert.deepEqual(editor.getState().bundle, bundle);
    const event = new Event(eventName); if (eventName === 'keydown') Object.defineProperty(event, 'key', { value: 'Escape' });
    target.dispatchEvent(event);
    assert.equal(editor.getState().gesture, null);
    assert.equal(editor.getState().pendingCount, 0);
    assert.equal(editor.getState().canUndo, false);
  }
  editor.beginGesture();
  for (let dx = 1; dx <= 5; dx++) assert.equal(editor.previewGesture({ type: 'move', ids: ['lane-a'], dx, dy: 10 }).ok, true);
  assert.equal(editor.completeGesture().ok, true);
  assert.equal(editor.getState().pendingCount, 1);
  const changed = editor.getState().bundle;
  assert.equal(changed.presentation.elements[0].bounds.x, bundle.presentation.elements[0].bounds.x + 5);
  assert.equal(editor.undo().ok, true);
  assert.deepEqual(editor.getState().bundle, bundle);
  assert.equal(editor.getState().canUndo, false);
  assert.equal(editor.redo().ok, true);
  assert.deepEqual(editor.getState().bundle, changed);
  unbind();
});

test('explicit layout preview cancels without content and applies as one transaction', () => {
  const bundle = makeBundle(); bundle.document.groups = []; bundle.presentation.elements = bundle.presentation.elements.filter(item => item.elementId !== 'group-a');
  bundle.document.accessibility.readingOrder = bundle.document.accessibility.readingOrder.filter(id => id !== 'group-a'); sealBundle(bundle);
  const editor = session(bundle);
  editor.beginGesture();
  assert.equal(editor.previewLayout({ targetIds: ['node-a', 'node-b'], columns: 1 }).ok, true);
  editor.cancelGesture(); assert.deepEqual(editor.getState().bundle, bundle);
  editor.beginGesture(); editor.previewLayout({ targetIds: ['node-a', 'node-b'], columns: 1 });
  assert.equal(editor.completeGesture().ok, true);
  assert.equal(editor.getState().pendingCount, 1);
  assert.equal(editor.undo().ok, true);
  assert.deepEqual(editor.getState().bundle, bundle);
});

test('locked mixed selections and invalid containment reject the whole session edit', () => {
  const bundle = makeBundle('swimlane'); bundle.presentation.elements[0].locks.position = true; sealBundle(bundle);
  const editor = session(bundle);
  assert.equal(editor.submit({ type: 'move', ids: ['lane-a'], dx: 10, dy: 10 }).ok, false);
  assert.equal(editor.submit({ type: 'reparent', ids: ['lane-a'], parentId: 'group-a' }).ok, false);
  assert.deepEqual(editor.getState().bundle, bundle); assert.equal(editor.getState().pendingCount, 0);
});

test('clipboard copies a bounded fragment and kernel remaps internal connectors and annotations', () => {
  const source = makeBundle(); const copied = copyDiagramSelection(source, ['group-a', 'node-b']);
  assert.equal(copied.ok, true, JSON.stringify(copied));
  const idMap = Object.fromEntries(copied.value.ids.map(id => [id, `copy-${id}`]));
  const blank = createDiagramEditorDraft({ diagramId: 'destination', title: 'Destination' }).bundle;
  const pasted = pasteDiagramSelection(blank, JSON.stringify(copied.value), { idMap, transactionId: 'paste', dx: 40, dy: 50 });
  assert.equal(pasted.ok, true, JSON.stringify(pasted));
  assert.equal(pasted.bundle.document.relations[0].from, 'copy-node-a');
  assert.equal(pasted.bundle.document.annotations[0].targetId, 'copy-node-a');
  const editor = session(blank); assert.equal(editor.submitTransaction(pasted.transaction).ok, true);
  assert.equal(pasteDiagramSelection(blank, copied.value, { idMap: {}, transactionId: 'invalid-paste' }).ok, false);
  assert.equal(pasteDiagramSelection(blank, ' '.repeat(1024 * 1024 + 1), { idMap, transactionId: 'oversized' }).ok, false);
  const hostile = structuredClone(copied.value); hostile.sourceBundle.presentation.elements[0].appearance.fill = 'url(https://invalid.test)';
  assert.equal(pasteDiagramSelection(blank, hostile, { idMap, transactionId: 'hostile' }).ok, false);
});

test('equal revision and review refresh preserve personal view without changing document digests', () => {
  const bundle = makeBundle('swimlane'); const editor = session(bundle);
  editor.setView({ camera: { x: -25, y: 35, scale: 0.5, fit: null }, selection: ['node-a'], collapsedGroups: ['group-a'], trace: ['edge-a'], snap: false });
  const before = editor.getState();
  assert.deepEqual(editor.refresh(structuredClone(bundle)), { ok: true, changed: false });
  assert.deepEqual(editor.getState(), before);
  const hit = editor.query({ x: 20, y: 67.5, tolerance: 4 });
  assert.equal(hit.ok, true); assert.ok(hit.hits.some(item => item.id === 'node-a'));
  assert.equal(editor.getState().bundle.bundleDigest, bundle.bundleDigest);
});

test('recovery replays exact pending transactions after refresh and rejects foreign scopes', () => {
  const memory = storage(); const scope = { sessionId: 'owner-1', diagramId: 'checkout' };
  const editor = session(makeBundle(), { recovery: createDiagramEditorRecovery({ storage: memory, scope }) });
  editor.submit(rename('Recovered label'));
  const draft = editor.getState().bundle;
  const reopened = session(makeBundle(), { recovery: createDiagramEditorRecovery({ storage: memory, scope }) });
  assert.deepEqual(reopened.getState().bundle, draft);
  assert.equal(reopened.getState().pendingCount, 1); assert.equal(reopened.getState().saveState, 'unsaved');
  const alien = session(makeBundle(), { recovery: createDiagramEditorRecovery({ storage: memory, scope: { ...scope, sessionId: 'owner-2' } }) });
  assert.equal(alien.getState().pendingCount, 0);
  const copied = [...memory.values.values()][0]; memory.setItem('openplanr:diagram-editor:1:owner-3:checkout', copied);
  const rejected = session(makeBundle(), { recovery: createDiagramEditorRecovery({ storage: memory, scope: { ...scope, sessionId: 'owner-3' } }) });
  assert.equal(rejected.getState().pendingCount, 0); assert.match(rejected.getState().recovery.warning, /safely/u);
});

test('blocked or quota-limited recovery reports memory-only while preserving edits', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  const editor = session(makeBundle(), { recovery: createDiagramEditorRecovery({ storage: blocked, scope: { sessionId: 'owner', diagramId: 'checkout' } }) });
  assert.equal(editor.submit(rename('Not lost')).ok, true);
  assert.equal(editor.getState().recovery.mode, 'memory-only');
  assert.match(editor.getState().recovery.warning, /session open/u);
  assert.equal(editor.getState().bundle.document.nodes[0].label, 'Not lost');
  const limited = session(makeBundle(), { recovery: createDiagramEditorRecovery({ storage: storage(), scope: { sessionId: 'owner', diagramId: 'checkout' }, maxBytes: 20 }) });
  limited.submit(rename('Quota limit')); assert.equal(limited.getState().recovery.mode, 'memory-only');
});

test('conditional undo after authoritative overlapping changes never replaces the newer revision', async t => {
  const bundle = makeBundle(); const store = await storeFor(t, 'checkout'); await store.initialize(bundle, { transactionId: 'initialize' });
  const editor = session(bundle, { transport: store }); editor.submit(rename('My change')); await editor.save();
  const external = compileDiagramCommand(editor.getState().bundle, rename('Another author'), { transactionId: 'external' });
  await store.commit(external.transaction); editor.refresh(external.bundle);
  const before = editor.getState().bundle;
  const undo = editor.undo(); assert.equal(undo.ok, false);
  assert.deepEqual(editor.getState().bundle, before); assert.equal(editor.getState().canUndo, true);
  assert.equal(editor.getState().pendingCount, 0);
});
