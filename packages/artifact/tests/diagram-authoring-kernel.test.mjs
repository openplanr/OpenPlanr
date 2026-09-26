import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clone,
  makeBundle,
  placement,
  sealBundle,
} from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import {
  compileDiagramCommand,
  createConditionalInverse,
  previewDiagramTransaction,
} from '../lib/artifact/diagram/authoring/index.mjs';

const compile = (bundle, command, id = 'gesture-a') =>
  compileDiagramCommand(bundle, command, { transactionId: id });
const accepted = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.ok(result.transaction);
  return result;
};
const bounds = (bundle, id) =>
  bundle.presentation.elements.find((item) => item.elementId === id).bounds;
function undo(current, inverse, id = 'undo-a') {
  const result = createConditionalInverse(current, inverse, { transactionId: id });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return accepted(previewDiagramTransaction(current, result.transaction));
}
function assertContent(actual, expected) {
  assert.deepEqual(actual.document, expected.document);
  assert.deepEqual(actual.presentation, expected.presentation);
  assert.deepEqual(actual.originalSource, expected.originalSource);
  assert.deepEqual(actual.sourceMap, expected.sourceMap);
}

test('create, rename and describe compile precise edits without inventing IDs or moving other objects', () => {
  const blank = makeBundle('flowchart', { blank: true });
  const created = accepted(
    compile(blank, {
      type: 'create',
      elements: [
        {
          collection: 'nodes',
          value: { id: 'new-node', label: 'Checkout', kind: 'process', description: null },
        },
      ],
      presentation: [placement('new-node')],
    }),
  );
  assert.deepEqual(created.bundle.document.nodes, [
    { id: 'new-node', label: 'Checkout', kind: 'process', description: null },
  ]);
  const renamed = accepted(
    compile(created.bundle, { type: 'rename', id: 'new-node', label: 'Accept payment' }),
  );
  const described = accepted(
    compile(renamed.bundle, {
      type: 'describe',
      id: 'new-node',
      description: 'Reserve inventory before capture.',
    }),
  );
  assert.equal(described.bundle.document.nodes[0].description, 'Reserve inventory before capture.');
  assert.deepEqual(described.bundle.presentation.elements, created.bundle.presentation.elements);
  assertContent(undo(created.bundle, created.inverse).bundle, blank);
});

test('moving an ancestor and a selected descendant transforms each shape and internal connector exactly once', () => {
  const bundle = makeBundle('swimlane');
  const before = JSON.stringify(bundle);
  const result = accepted(
    compile(bundle, { type: 'move', ids: ['lane-a', 'group-a', 'node-a'], dx: 40, dy: 20 }),
  );
  assert.deepEqual(bounds(result.bundle, 'node-a'), { x: 60, y: 50, width: 140, height: 70 });
  assert.deepEqual(bounds(result.bundle, 'node-b'), { x: 300, y: 50, width: 140, height: 70 });
  assert.deepEqual(bounds(result.bundle, 'note-a'), bounds(bundle, 'note-a'));
  const edge = result.bundle.presentation.elements.find((item) => item.elementId === 'edge-a');
  assert.deepEqual(edge.route.points, [
    { x: 200, y: 85 },
    { x: 300, y: 85 },
  ]);
  assert.deepEqual(edge.label, { x: 220, y: 60, width: 70 });
  assert.deepEqual(result.bundle.document, bundle.document);
  assert.equal(JSON.stringify(bundle), before);
  assertContent(undo(result.bundle, result.inverse).bundle, bundle);
});

test('reparent and group/ungroup use one semantic parent and retain global geometry', () => {
  const bundle = makeBundle('swimlane');
  const reparented = accepted(
    compile(bundle, { type: 'reparent', ids: ['node-a'], parentId: 'lane-a', index: 1 }),
  );
  assert.deepEqual(reparented.bundle.document.groups[0].members, []);
  assert.deepEqual(reparented.bundle.document.lanes[0].members, ['group-a', 'node-a', 'node-b']);
  assert.deepEqual(reparented.bundle.presentation.elements, bundle.presentation.elements);
  const groupPlacement = {
    ...placement('new-group', 'container'),
    bounds: { x: 0, y: 0, width: 430, height: 150 },
  };
  const grouped = accepted(
    compile(reparented.bundle, {
      type: 'group',
      group: { id: 'new-group', label: 'Payment' },
      ids: ['node-a', 'node-b'],
      placement: groupPlacement,
      parentId: 'lane-a',
    }),
  );
  assert.deepEqual(grouped.bundle.document.groups.find((item) => item.id === 'new-group').members, [
    'node-a',
    'node-b',
  ]);
  assert.deepEqual(bounds(grouped.bundle, 'node-a'), bounds(bundle, 'node-a'));
  const ungrouped = accepted(compile(grouped.bundle, { type: 'ungroup', ids: ['new-group'] }));
  assert.ok(!ungrouped.bundle.document.groups.some((item) => item.id === 'new-group'));
  assert.ok(ungrouped.bundle.document.lanes[0].members.includes('node-a'));
  assertContent(undo(ungrouped.bundle, ungrouped.inverse).bundle, grouped.bundle);
  const cyclic = compile(bundle, { type: 'reparent', ids: ['lane-a'], parentId: 'group-a' });
  assert.equal(cyclic.ok, false);
  assert.equal(cyclic.bundle, undefined);
});

test('shrinking around children and changing locked geometry fail atomically; explicit unlock enables movement', () => {
  const bundle = makeBundle();
  const shrink = compile(bundle, {
    type: 'resize',
    id: 'group-a',
    bounds: { x: 0, y: 0, width: 50, height: 50 },
  });
  assert.equal(shrink.ok, false);
  assert.equal(shrink.bundle, undefined);
  bundle.presentation.elements[0].locks.position = true;
  sealBundle(bundle);
  const before = JSON.stringify(bundle);
  const locked = compile(bundle, { type: 'move', ids: ['group-a'], dx: 10, dy: 0 });
  assert.equal(locked.ok, false);
  assert.equal(locked.bundle, undefined);
  assert.equal(JSON.stringify(bundle), before);
  const item = bundle.presentation.elements[0];
  const unlocked = accepted(
    compile(bundle, {
      type: 'appearance',
      changes: [
        {
          elementId: item.elementId,
          before: { appearance: item.appearance, locks: item.locks },
          after: { appearance: item.appearance, locks: { ...item.locks, position: false } },
        },
      ],
    }),
  );
  accepted(compile(unlocked.bundle, { type: 'move', ids: ['group-a'], dx: 10, dy: 0 }));
});

test('duplicate/paste use supplied IDs, retain originals and disclose excluded external links', () => {
  const bundle = makeBundle();
  const before = JSON.stringify(bundle);
  const command = {
    type: 'duplicate',
    ids: ['group-a'],
    idMap: { 'group-a': 'group-copy', 'node-a': 'node-copy', 'note-a': 'note-copy' },
    dx: 30,
    dy: 50,
  };
  const result = accepted(compile(bundle, command));
  assert.deepEqual(result.disclosures.excludedRelationIds, ['edge-a']);
  assert.equal(result.bundle.document.relations.length, 1);
  assert.equal(
    result.bundle.document.annotations.find((item) => item.id === 'note-copy').targetId,
    'node-copy',
  );
  assert.deepEqual(result.bundle.document.groups.find((item) => item.id === 'group-copy').members, [
    'node-copy',
  ]);
  assert.equal(result.bundle.document.nodes[0].id, 'node-a');
  assert.equal(JSON.stringify(bundle), before);
  assertContent(undo(result.bundle, result.inverse).bundle, bundle);
  const pasted = accepted(
    compile(makeBundle('flowchart', { blank: true }), {
      ...command,
      type: 'paste',
      sourceBundle: bundle,
    }),
  );
  assert.equal(pasted.bundle.document.nodes.length, 1);
  assert.equal(pasted.bundle.document.relations.length, 0);
  assert.equal(
    compile(bundle, { ...command, idMap: { ...command.idMap, 'node-a': 'node-a' } }).ok,
    false,
  );
});

test('delete requires its exact connector, annotation, membership and reading-order impact; undo restores ordering and source correspondence', () => {
  const bundle = makeBundle('process', { source: true });
  const before = JSON.stringify(bundle);
  const preview = compile(bundle, { type: 'delete', ids: ['node-a'] });
  assert.equal(preview.ok, false);
  assert.equal(preview.transaction, undefined);
  assert.equal(preview.bundle, undefined);
  assert.deepEqual(preview.deletionImpact.elementIds, ['edge-a', 'node-a', 'note-a']);
  assert.deepEqual(preview.deletionImpact.membershipIds, ['group-a']);
  const result = accepted(
    compile(bundle, { type: 'delete', ids: ['node-a'], confirmedImpact: preview.deletionImpact }),
  );
  assert.deepEqual(
    result.bundle.document.nodes.map((item) => item.id),
    ['node-b'],
  );
  assert.deepEqual(result.bundle.document.relations, []);
  assert.deepEqual(result.bundle.document.groups[0].members, []);
  assert.equal(result.bundle.originalSource.text, bundle.originalSource.text);
  assert.equal(JSON.stringify(bundle), before);
  const restored = undo(result.bundle, result.inverse);
  assertContent(restored.bundle, bundle);
  assertContent(undo(restored.bundle, restored.inverse, 'redo-a').bundle, result.bundle);
});

test('conditional undo permits an unrelated edit and rejects overlap or newly introduced incident dependencies', () => {
  const bundle = makeBundle();
  bundle.document.nodes.push({
    id: 'unrelated',
    label: 'Elsewhere',
    kind: 'process',
    description: null,
  });
  bundle.presentation.elements.push(placement('unrelated', 'rectangle', 700, 400));
  sealBundle(bundle);
  const edited = accepted(compile(bundle, { type: 'rename', id: 'node-a', label: 'Pay now' }));
  const unrelated = accepted(
    compile(
      edited.bundle,
      { type: 'rename', id: 'unrelated', label: 'Updated unrelated node' },
      'later-a',
    ),
  );
  const restored = undo(unrelated.bundle, edited.inverse);
  assert.equal(restored.bundle.document.nodes[0].label, bundle.document.nodes[0].label);
  assert.equal(
    restored.bundle.document.nodes.find((item) => item.id === 'unrelated').label,
    'Updated unrelated node',
  );
  const overlapping = accepted(
    compile(edited.bundle, { type: 'rename', id: 'node-a', label: 'Pay later' }, 'later-b'),
  );
  assert.equal(
    createConditionalInverse(overlapping.bundle, edited.inverse, { transactionId: 'undo-conflict' })
      .ok,
    false,
  );
  const moved = accepted(compile(bundle, { type: 'move', ids: ['group-a'], dx: 10, dy: 0 }));
  const newEdge = clone(bundle.presentation.elements.find((item) => item.elementId === 'edge-a'));
  newEdge.elementId = 'edge-new';
  newEdge.route.mode = 'automatic';
  newEdge.route.points = [];
  const attached = accepted(
    compile(
      moved.bundle,
      {
        type: 'create',
        elements: [
          { collection: 'relations', value: { ...bundle.document.relations[0], id: 'edge-new' } },
        ],
        presentation: [newEdge],
      },
      'later-edge',
    ),
  );
  assert.equal(
    createConditionalInverse(attached.bundle, moved.inverse, { transactionId: 'undo-move' }).ok,
    false,
  );
});

test('closed command validation and cancellation leave input unchanged and return no applicable transaction', () => {
  const bundle = makeBundle(),
    original = JSON.stringify(bundle);
  for (const command of [
    null,
    { type: 'execute', script: 'bad' },
    { type: 'move', ids: ['node-a'], dx: 1, dy: 1, authority: 'owner' },
    { type: 'move', ids: ['node-a'], dx: Infinity, dy: 0 },
    { type: 'reparent', ids: ['edge-a'], parentId: 'group-a' },
  ]) {
    const result = compile(bundle, command);
    assert.equal(result.ok, false);
    assert.equal(result.bundle, undefined);
  }
  const canceled = compileDiagramCommand(bundle, { type: 'cancel' });
  assert.equal(canceled.ok, true);
  assert.equal(canceled.transaction, null);
  assert.equal(canceled.bundle, undefined);
  assert.equal(JSON.stringify(bundle), original);
});

test('copy maps accept valid reserved-looking IDs and detach excluded annotation targets by own key', () => {
  const bundle = makeBundle('flowchart', { blank: true });
  for (const id of ['constructor', 'prototype']) {
    bundle.document.nodes.push({ id, label: id, kind: 'process', description: null });
    bundle.presentation.elements.push(placement(id));
  }
  bundle.document.annotations.push({
    id: 'note-a',
    text: 'Keep this note',
    targetId: 'constructor',
  });
  bundle.presentation.elements.push(placement('note-a', 'text', 20, 200));
  sealBundle(bundle);
  const copied = accepted(
    compile(bundle, {
      type: 'duplicate',
      ids: ['constructor', 'prototype'],
      idMap: { constructor: 'copy-a', prototype: 'copy-b', 'note-a': 'copy-note' },
    }),
  );
  assert.equal(
    copied.bundle.document.annotations.find((value) => value.id === 'copy-note').targetId,
    'copy-a',
  );
  const detached = accepted(
    compile(bundle, { type: 'duplicate', ids: ['note-a'], idMap: { 'note-a': 'note-copy' } }),
  );
  assert.equal(
    detached.bundle.document.annotations.find((value) => value.id === 'note-copy').targetId,
    null,
  );
  assert.deepEqual(detached.disclosures.detachedAnnotationIds, ['note-a']);
  assert.equal({}.polluted, undefined);
});

test('optional numeric command fields reject explicit null without mutating the source', () => {
  const bundle = makeBundle('swimlane'),
    before = JSON.stringify(bundle);
  const duplicate = { type: 'duplicate', ids: ['node-b'], idMap: { 'node-b': 'node-copy' } };
  for (const command of [
    { ...duplicate, dx: null },
    { ...duplicate, dy: null },
    { type: 'reparent', ids: ['node-a'], parentId: 'lane-a', index: null },
  ]) {
    const result = compile(bundle, command);
    assert.equal(result.ok, false);
    assert.equal(result.bundle, undefined);
    assert.equal(JSON.stringify(bundle), before);
  }
});
