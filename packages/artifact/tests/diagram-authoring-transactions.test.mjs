import assert from 'node:assert/strict';
import test from 'node:test';
import {
  makeBundle,
  makeTransaction,
  placement,
  sealBundle,
} from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { compileDiagramCommand } from '../lib/artifact/diagram/authoring/commands.mjs';
import { geometryFields, snapshot } from '../lib/artifact/diagram/authoring/model.mjs';
import { previewDiagramTransaction } from '../lib/artifact/diagram/authoring/transactions.mjs';
import { createConditionalInverse } from '../lib/artifact/diagram/authoring/undo.mjs';

const tx = (bundle, operations, transactionId = 'edit-one') => ({
  kind: 'diagram-edit-transaction',
  schemaVersion: '1.0.0',
  protocolVersion: '1.13.0',
  diagramId: bundle.diagramId,
  base: snapshot(bundle),
  transactionId,
  operations,
  undoOf: null,
});
const command = (bundle, value, transactionId = 'command-one') =>
  compileDiagramCommand(bundle, value, { transactionId });
function roundTrip(bundle, preview) {
  assert.equal(preview.ok, true, JSON.stringify(preview.diagnostics));
  const inverse = createConditionalInverse(preview.bundle, preview.inverse, {
    transactionId: 'undo-one',
  });
  assert.equal(inverse.ok, true, JSON.stringify(inverse.diagnostics));
  const undo = previewDiagramTransaction(preview.bundle, inverse.transaction);
  assert.equal(undo.ok, true, JSON.stringify(undo.diagnostics));
  assert.deepEqual(undo.bundle, bundle);
  const redo = createConditionalInverse(undo.bundle, undo.inverse, { transactionId: 'redo-one' });
  assert.equal(redo.ok, true, JSON.stringify(redo.diagnostics));
  const replay = previewDiagramTransaction(undo.bundle, redo.transaction);
  assert.equal(replay.ok, true, JSON.stringify(replay.diagnostics));
  assert.deepEqual(replay.bundle, preview.bundle);
}

test('failed second operation never yields a partial result or mutates the input', () => {
  const bundle = makeBundle();
  const before = structuredClone(bundle);
  const cases = [
    {
      type: 'remove-elements',
      elements: [
        { collection: 'annotations', value: { id: 'node-a', text: 'wrong class', targetId: null } },
      ],
      presentation: [bundle.presentation.elements[0]],
    },
    {
      type: 'update-semantics',
      collection: 'nodes',
      elementId: 'node-b',
      before: { label: 'stale', kind: 'end', description: 'Checkout finished.' },
      after: { label: 'Renamed', kind: 'end', description: 'Checkout finished.' },
    },
    { type: 'unrecognized-operation' },
    {
      type: 'insert-elements',
      elements: [{ collection: 'nodes', value: bundle.document.nodes[0] }],
      presentation: [bundle.presentation.elements[0]],
    },
  ];
  for (const invalid of cases) {
    const result = previewDiagramTransaction(
      bundle,
      tx(bundle, [...makeTransaction(bundle).operations, invalid]),
    );
    assert.equal(result.ok, false);
    assert.equal(Object.hasOwn(result, 'bundle'), false);
    assert.deepEqual(bundle, before);
  }
});

test('a batch may construct forward references but final dangling references reject', () => {
  const bundle = makeBundle('flowchart', { blank: true });
  const a = { id: 'a', label: 'A', kind: 'process', description: null };
  const b = { ...a, id: 'b', label: 'B' };
  const edge = {
    id: 'edge',
    from: 'a',
    to: 'b',
    kind: 'flow',
    direction: 'forward',
    label: null,
    weight: null,
  };
  const route = {
    ...placement('edge', 'connector'),
    bounds: null,
    route: {
      mode: 'automatic',
      strategy: 'straight',
      from: { side: 'right', offset: 0.5 },
      to: { side: 'left', offset: 0.5 },
      points: [],
    },
  };
  const operations = [
    {
      type: 'insert-elements',
      elements: [{ collection: 'relations', value: edge }],
      presentation: [route],
    },
    {
      type: 'insert-elements',
      elements: [
        { collection: 'nodes', value: a },
        { collection: 'nodes', value: b },
      ],
      presentation: [placement('a'), placement('b')],
    },
  ];
  assert.equal(previewDiagramTransaction(bundle, tx(bundle, operations)).ok, true);
  const result = previewDiagramTransaction(bundle, tx(bundle, operations.slice(0, 1)));
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((value) => value.rule === 'endpoint'));
});

test('locks and containment reject atomically and explicit unlock permits geometry', () => {
  const bundle = makeBundle();
  bundle.presentation.elements[0].locks.position = true;
  sealBundle(bundle);
  const before = structuredClone(bundle);
  const geometry = geometryFields(bundle.presentation.elements[0]);
  const after = structuredClone(geometry);
  after.bounds.x += 10;
  const move = {
    type: 'set-geometry',
    changes: [{ elementId: 'node-a', before: geometry, after }],
  };
  assert.equal(previewDiagramTransaction(bundle, tx(bundle, [move])).ok, false);
  assert.deepEqual(bundle, before);
  const locks = bundle.presentation.elements[0];
  const unlock = {
    type: 'set-appearance-locks',
    changes: [
      {
        elementId: 'node-a',
        before: { appearance: locks.appearance, locks: locks.locks },
        after: { appearance: locks.appearance, locks: { ...locks.locks, position: false } },
      },
    ],
  };
  roundTrip(bundle, previewDiagramTransaction(bundle, tx(bundle, [unlock, move])));
  const shrink = command(makeBundle(), {
    type: 'resize',
    id: 'group-a',
    bounds: { x: 0, y: 0, width: 60, height: 60 },
  });
  assert.equal(shrink.ok, false);
  assert.ok(shrink.diagnostics.some((value) => value.rule === 'container-bounds'));
});

test('conditional inverse preserves a newer unrelated field and rejects changed dependencies', () => {
  const bundle = makeBundle();
  const renamed = command(bundle, { type: 'rename', id: 'node-a', label: 'Accept checkout' });
  assert.equal(renamed.ok, true);
  const described = command(
    renamed.bundle,
    { type: 'describe', id: 'node-a', description: 'New independent description' },
    'describe-one',
  );
  const inverse = createConditionalInverse(described.bundle, renamed.inverse, {
    transactionId: 'undo-rename',
  });
  assert.equal(inverse.ok, true, JSON.stringify(inverse.diagnostics));
  const restored = previewDiagramTransaction(described.bundle, inverse.transaction);
  assert.equal(restored.bundle.document.nodes[0].label, bundle.document.nodes[0].label);
  assert.equal(restored.bundle.document.nodes[0].description, 'New independent description');
  const overlapping = command(
    renamed.bundle,
    { type: 'rename', id: 'node-a', label: 'Newer label' },
    'rename-two',
  );
  assert.equal(
    createConditionalInverse(overlapping.bundle, renamed.inverse, { transactionId: 'undo-two' }).ok,
    false,
  );
  const edge = { ...bundle.document.relations[0], id: 'edge-new' };
  const added = command(
    renamed.bundle,
    {
      type: 'create',
      elements: [{ collection: 'relations', value: edge }],
      presentation: [{ ...bundle.presentation.elements[2], elementId: 'edge-new' }],
    },
    'new-edge',
  );
  assert.equal(added.ok, true, JSON.stringify(added.diagnostics));
  assert.equal(
    createConditionalInverse(added.bundle, renamed.inverse, { transactionId: 'undo-three' }).ok,
    false,
  );
});

test('delete and undo restore collection order, source correspondence and emphasis exactly', () => {
  const bundle = makeBundle('swimlane', { source: true });
  bundle.document.emphasis = [
    { targetId: 'node-a', level: 'primary' },
    { targetId: 'node-b', level: 'secondary' },
  ];
  sealBundle(bundle);
  const proposed = command(bundle, { type: 'delete', ids: ['node-a'] });
  assert.equal(proposed.ok, false);
  const deleted = command(bundle, {
    type: 'delete',
    ids: ['node-a'],
    confirmedImpact: proposed.deletionImpact,
  });
  assert.equal(deleted.ok, true, JSON.stringify(deleted.diagnostics));
  assert.deepEqual(deleted.bundle.originalSource, bundle.originalSource);
  assert.equal(deleted.bundle.sourceMap.entries[0].confidence, 'ambiguous');
  assert.deepEqual(deleted.bundle.sourceMap.entries[0].elementIds, []);
  roundTrip(bundle, deleted);
});

test('canonical derived operations replay identically and source edits round-trip', () => {
  const bundle = makeBundle('flowchart', { source: true });
  const moved = command(bundle, { type: 'move', ids: ['node-a'], dx: 10, dy: 20 });
  assert.equal(moved.ok, true, JSON.stringify(moved.diagnostics));
  const replayed = previewDiagramTransaction(bundle, moved.transaction);
  assert.equal(replayed.ok, true, JSON.stringify(replayed.diagnostics));
  assert.deepEqual(replayed.bundle, moved.bundle);
  roundTrip(bundle, moved);
  const renamed = command(bundle, { type: 'rename', id: 'node-a', label: 'A clearer label' });
  roundTrip(bundle, renamed);
});

test('removing an identity does not make it fresh again in the same transaction', () => {
  const bundle = makeBundle();
  const entry = { collection: 'nodes', value: bundle.document.nodes[0] };
  const result = previewDiagramTransaction(
    bundle,
    tx(bundle, [
      {
        type: 'remove-elements',
        elements: [entry],
        presentation: [bundle.presentation.elements[0]],
      },
      {
        type: 'insert-elements',
        elements: [{ collection: 'nodes', value: { ...entry.value, kind: 'decision' } }],
        presentation: [bundle.presentation.elements[0]],
      },
    ]),
  );
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((value) => value.rule === 'duplicate-id'));
});

test('malformed conditional inverse data returns diagnostics without throwing', () => {
  const bundle = makeBundle();
  const inverse = {
    diagramId: bundle.diagramId,
    transactionId: 'prior',
    changes: {
      semantic: [],
      presentation: [],
      sourceMap: [{ collection: 'source-map', elementId: null, path: [], before: 1, after: null }],
    },
    dependencies: [],
    positions: [],
    emphasisOrder: [],
  };
  const result = createConditionalInverse(bundle, inverse, { transactionId: 'new' });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].rule, 'inverse-shape');
});

test('new manual routes resolve endpoint attachments and the returned transaction replays', () => {
  const bundle = makeBundle();
  const edge = { ...bundle.document.relations[0], id: 'new-edge' };
  const route = structuredClone(bundle.presentation.elements[2]);
  route.elementId = edge.id;
  route.route.points = [
    { x: 999, y: 999 },
    { x: 888, y: 888 },
  ];
  const result = command(bundle, {
    type: 'create',
    elements: [{ collection: 'relations', value: edge }],
    presentation: [route],
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(
    result.bundle.presentation.elements.find((value) => value.elementId === edge.id).route.points,
    [
      { x: 160, y: 65 },
      { x: 260, y: 65 },
    ],
  );
  assert.deepEqual(previewDiagramTransaction(bundle, result.transaction).bundle, result.bundle);
  roundTrip(bundle, result);
});

test('document order edits identify their semantic references in read and affected sets', () => {
  const bundle = makeBundle('swimlane');
  const before = {
    title: bundle.document.title,
    summary: bundle.document.summary,
    audience: bundle.document.audience,
    accessibility: structuredClone(bundle.document.accessibility),
  };
  const after = structuredClone(before);
  after.accessibility.readingOrder.reverse();
  const result = previewDiagramTransaction(
    bundle,
    tx(bundle, [{ type: 'update-semantics', collection: 'document', before, after }]),
  );
  assert.equal(result.ok, true);
  for (const id of before.accessibility.readingOrder) {
    assert.ok(result.impact.readIds.includes(id));
    assert.ok(result.impact.affectedIds.includes(id));
  }
  roundTrip(bundle, result);
});

test('raw geometry cannot move only a parent away or move its child outside containment', () => {
  for (const [id, x] of [
    ['group-a', 500],
    ['node-a', 500],
  ]) {
    const bundle = makeBundle();
    const original = structuredClone(bundle);
    const before = geometryFields(
      bundle.presentation.elements.find((value) => value.elementId === id),
    );
    const after = structuredClone(before);
    after.bounds.x = x;
    const result = previewDiagramTransaction(
      bundle,
      tx(bundle, [{ type: 'set-geometry', changes: [{ elementId: id, before, after }] }]),
    );
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((value) => value.rule === 'container-bounds'));
    assert.deepEqual(bundle, original);
  }
});
