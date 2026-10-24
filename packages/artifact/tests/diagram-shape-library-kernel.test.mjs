import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { shapeDefinitionDigest } from '@openplanr/protocol/shape-library-contracts';
import {
  normalizeDiagramPresentation,
  validateVersionedDiagramAuthoringArtifact,
} from '@openplanr/protocol/studio-presentation-contracts';
import { makeBundle, placement } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import {
  compileDiagramBundleTransaction,
  compileDiagramCommand,
  createConditionalInverse,
  previewAutomaticLayout,
  previewDiagramMerge,
  previewDiagramTransaction,
  previewMermaidCopy,
  validateAuthoringBundle,
} from '../lib/artifact/diagram/authoring/index.mjs';
import { createAuthoringSnapshot, snapshot } from '../lib/artifact/diagram/authoring/model.mjs';
import { createDiagramAuthoringStore } from '../lib/artifact/diagram/authoring/store.mjs';
import {
  copyDiagramSelection,
  pasteDiagramSelection,
} from '../lib/artifact/diagram/editor/clipboard.mjs';
import { createDiagramEditorDraft } from '../lib/artifact/diagram/editor/draft.mjs';

const accepted = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result;
};
const compile = (bundle, command, transactionId = 'create-shape') =>
  compileDiagramCommand(bundle, command, { transactionId });
function definition(shapeId = 'hexagon') {
  const boundary = {
    type: 'polygon',
    points: [
      { x: 0.25, y: 0 },
      { x: 0.75, y: 0 },
      { x: 1, y: 0.5 },
      { x: 0.75, y: 1 },
      { x: 0.25, y: 1 },
      { x: 0, y: 0.5 },
    ],
  };
  const value = {
    packId: 'test-basics',
    packVersion: '1.0.0',
    shapeId,
    name: 'Hexagon',
    description: 'A bounded hexagon.',
    tags: ['basic'],
    primitives: [{ ...boundary, fill: 'fill', stroke: 'stroke' }],
    attachment: boundary,
    textRegion: { x: 0.25, y: 0.1, width: 0.5, height: 0.8 },
    sizing: { width: 140, height: 70, minWidth: 40, minHeight: 30 },
  };
  return { ...value, definitionDigest: shapeDefinitionDigest(value) };
}
function create(shape = definition(), id = 'hexagon-a', x = 20) {
  const { packId, packVersion, shapeId, definitionDigest } = shape;
  const item = placement(id, 'rectangle', x);
  item.appearance.shapeRef = { packId, packVersion, shapeId, definitionDigest };
  return {
    type: 'create',
    elements: [
      { collection: 'nodes', value: { id, label: 'Hexagon', kind: 'process', description: null } },
    ],
    presentation: [item],
    shapeDefinitions: [shape],
  };
}
function undo(bundle, inverse, transactionId = 'undo-shape') {
  const transaction = accepted(
    createConditionalInverse(bundle, inverse, { transactionId }),
  ).transaction;
  assert.deepEqual(
    validateVersionedDiagramAuthoringArtifact('diagram-edit-transaction', transaction, {
      baseBundle: bundle,
    }),
    [],
  );
  return accepted(previewDiagramTransaction(bundle, transaction));
}

test('shape insertion promotes atomically and exact inverse and redo preserve legacy snapshots', () => {
  for (const themed of [false, true]) {
    const legacy = makeBundle('flowchart', { blank: true });
    const original = themed
      ? accepted(
          compile(legacy, {
            type: 'set-studio-presentation',
            presentation: normalizeDiagramPresentation({ theme: 'dark' }),
          }),
        ).bundle
      : legacy;
    const bytes = JSON.stringify(original);
    const result = accepted(compile(original, create()));
    assert.equal(JSON.stringify(original), bytes);
    assert.equal(result.bundle.schemaVersion, '1.2.0');
    assert.equal(result.transaction.schemaVersion, '1.2.0');
    assert.equal(result.bundle.shapeLibrary.length, 1);
    assert.equal(result.transaction.operations[0].type, 'set-shape-library');
    const restored = undo(result.bundle, result.inverse);
    assert.deepEqual(restored.bundle, original);
    assert.deepEqual(undo(restored.bundle, restored.inverse, 'redo-shape').bundle, result.bundle);
  }
});

test('theme, layout, ordinary deletion and clipboard retain the shape capability', () => {
  const original = makeBundle('flowchart', { blank: true });
  const first = accepted(compile(original, create())).bundle;
  const second = accepted(
    compile(first, create(definition('other'), 'hexagon-b', 300), 'create-second'),
  ).bundle;
  const themed = accepted(
    compile(
      second,
      {
        type: 'set-studio-presentation',
        presentation: normalizeDiagramPresentation({ theme: 'dark' }),
      },
      'theme',
    ),
  );
  assert.equal(themed.bundle.schemaVersion, '1.2.0');
  assert.deepEqual(themed.bundle.shapeLibrary, second.shapeLibrary);
  const layout = accepted(
    previewAutomaticLayout(themed.bundle, {
      transactionId: 'layout',
      targetIds: ['hexagon-a', 'hexagon-b'],
    }),
  );
  assert.equal(layout.transaction.schemaVersion, '1.2.0');
  const copied = accepted(copyDiagramSelection(second, ['hexagon-a']));
  assert.equal(copied.value.sourceBundle.shapeLibrary.length, 1);
  const pasted = accepted(
    pasteDiagramSelection(original, copied.value, {
      idMap: { 'hexagon-a': 'pasted' },
      transactionId: 'paste',
    }),
  );
  assert.equal(pasted.bundle.schemaVersion, '1.2.0');
  assert.deepEqual(pasted.bundle.shapeLibrary, first.shapeLibrary);
  assert.equal(pasted.bundle.document.nodes[0].id, 'pasted');
  assert.deepEqual(undo(pasted.bundle, pasted.inverse).bundle, original);
  const impact = compile(first, { type: 'delete', ids: ['hexagon-a'] }).deletionImpact;
  const removed = accepted(
    compile(first, { type: 'delete', ids: ['hexagon-a'], confirmedImpact: impact }, 'delete'),
  );
  assert.equal(removed.bundle.schemaVersion, '1.2.0');
  assert.deepEqual(removed.bundle.shapeLibrary, first.shapeLibrary);
});

test('missing, tampered and conflicting definitions fail without partial insertion', () => {
  const original = makeBundle('flowchart', { blank: true });
  const missing = create();
  missing.shapeDefinitions = [];
  assert.equal(compile(original, missing).ok, false);
  const tampered = create();
  tampered.shapeDefinitions[0].name = 'Tampered';
  assert.equal(compile(original, tampered).ok, false);
  const first = accepted(compile(original, create())).bundle;
  const changed = definition();
  changed.name = 'Different immutable definition';
  changed.definitionDigest = shapeDefinitionDigest(changed);
  const conflict = compile(first, create(changed, 'another'));
  assert.equal(conflict.ok, false);
  assert.match(conflict.diagnostics[0].detail, /conflicts/);
  assert.equal(original.document.nodes.length, 0);
  assert.equal(validateAuthoringBundle(first).ok, true);
});

test('adding a library appearance to an existing element restores absent fields on undo', () => {
  const original = accepted(createAuthoringSnapshot(makeBundle('flowchart'))).bundle;
  const shape = definition();
  const { packId, packVersion, shapeId, definitionDigest } = shape;
  const placement = original.presentation.elements.find((item) => item.elementId === 'node-b');
  const before = {
    appearance: structuredClone(placement.appearance),
    locks: structuredClone(placement.locks),
  };
  const result = accepted(
    previewDiagramTransaction(original, {
      kind: 'diagram-edit-transaction',
      schemaVersion: '1.2.0',
      protocolVersion: '1.21.0',
      diagramId: original.diagramId,
      transactionId: 'appearance',
      undoOf: null,
      base: {
        bundleDigest: original.bundleDigest,
        semanticDigest: original.document.documentDigest,
        presentationDigest: original.presentation.presentationDigest,
      },
      operations: [
        { type: 'set-shape-library', before: null, after: [shape] },
        {
          type: 'set-appearance-locks',
          changes: [
            {
              elementId: 'node-b',
              before,
              after: {
                ...before,
                appearance: {
                  ...before.appearance,
                  shapeRef: { packId, packVersion, shapeId, definitionDigest },
                },
              },
            },
          ],
        },
      ],
    }),
  );
  assert.deepEqual(undo(result.bundle, result.inverse).bundle, original);
});

test('independent pack and theme changes merge with compatible metadata and exact compensation', () => {
  const base = makeBundle('flowchart', { blank: true });
  const local = accepted(compile(base, create())).bundle;
  const remote = accepted(
    compile(
      base,
      {
        type: 'set-studio-presentation',
        presentation: normalizeDiagramPresentation({ theme: 'dark' }),
      },
      'remote-theme',
    ),
  ).bundle;
  const merged = accepted(previewDiagramMerge(base, local, remote)).bundle;
  assert.equal(merged.schemaVersion, '1.2.0');
  assert.deepEqual(merged.shapeLibrary, local.shapeLibrary);
  assert.deepEqual(merged.studioPresentation, remote.studioPresentation);
  const transaction = accepted(
    compileDiagramBundleTransaction(remote, merged, { transactionId: 'merge' }),
  ).transaction;
  const preview = accepted(previewDiagramTransaction(remote, transaction));
  assert.deepEqual(preview.bundle, merged);
  assert.deepEqual(undo(preview.bundle, preview.inverse).bundle, remote);
});

test('different immutable pack additions merge their definitions without dropping either closure', () => {
  const base = makeBundle('flowchart', { blank: true });
  const local = accepted(compile(base, create())).bundle;
  const remote = accepted(
    compile(base, create(definition('other'), 'other', 300), 'remote-shape'),
  ).bundle;
  const initial = previewDiagramMerge(base, local, remote);
  assert.equal(initial.ok, false);
  assert.ok(initial.conflicts.length > 0);
  assert.equal(
    initial.conflicts.some((item) =>
      ['shapeLibrary', 'schemaVersion', 'protocolVersion'].includes(item.path[0]),
    ),
    false,
  );
  const choices = Object.fromEntries(initial.conflicts.map((item) => [item.id, 'remote']));
  const merged = accepted(previewDiagramMerge(base, local, remote, choices)).bundle;
  assert.equal(merged.shapeLibrary.length, 2);
  assert.equal(merged.document.nodes.length, 2);
  assert.equal(validateAuthoringBundle(merged).ok, true);
});

test('source refresh and template adoption retain portable library custody', () => {
  const source = 'flowchart TB\nA[Start]\nB[Done]\nA --> B\n';
  const imported = accepted(previewMermaidCopy(source, { diagramId: 'library-source' })).bundle;
  const inserted = accepted(compile(imported, create())).bundle;
  const first = inserted.presentation.elements.find(
    (item) => item.elementId === imported.document.nodes[0].id,
  );
  const shapeRef = inserted.presentation.elements.find((item) => item.elementId === 'hexagon-a')
    .appearance.shapeRef;
  const before = { appearance: first.appearance, locks: first.locks };
  const authored = accepted(
    compile(
      inserted,
      {
        type: 'appearance',
        changes: [
          {
            elementId: first.elementId,
            before,
            after: { ...before, appearance: { ...before.appearance, shapeRef } },
          },
        ],
      },
      'source-appearance',
    ),
  ).bundle;
  const refreshed = accepted(
    previewMermaidCopy(source, { diagramId: authored.diagramId, previousBundle: authored }),
  ).bundle;
  assert.equal(refreshed.schemaVersion, '1.2.0');
  assert.deepEqual(refreshed.shapeLibrary, authored.shapeLibrary);
  assert.deepEqual(
    refreshed.presentation.elements.find((item) => item.elementId === first.elementId).appearance
      .shapeRef,
    shapeRef,
  );
  const copy = accepted(
    createDiagramEditorDraft({ diagramId: 'template-copy', title: 'Copy', template: authored }),
  ).bundle;
  assert.equal(copy.schemaVersion, '1.2.0');
  assert.deepEqual(copy.shapeLibrary, authored.shapeLibrary);
  assert.deepEqual(copy.presentation.elements, authored.presentation.elements);
  assert.equal(copy.sourceMap, null);
  assert.equal(copy.originalSource, null);
});

test('minimum sizing and immutable pinned definitions apply to raw transactions', () => {
  const original = accepted(compile(makeBundle('flowchart', { blank: true }), create())).bundle;
  const placement = original.presentation.elements[0];
  const resized = compile(
    original,
    { type: 'resize', id: 'hexagon-a', bounds: { ...placement.bounds, width: 39 } },
    'resize-small',
  );
  assert.equal(resized.ok, false);
  const altered = structuredClone(original.shapeLibrary[0]);
  altered.name = 'Redefined';
  altered.definitionDigest = shapeDefinitionDigest(altered);
  const before = { appearance: placement.appearance, locks: placement.locks };
  const raw = previewDiagramTransaction(original, {
    kind: 'diagram-edit-transaction',
    schemaVersion: '1.2.0',
    protocolVersion: '1.21.0',
    diagramId: original.diagramId,
    transactionId: 'redefine',
    undoOf: null,
    base: snapshot(original),
    operations: [
      { type: 'set-shape-library', before: original.shapeLibrary, after: [altered] },
      {
        type: 'set-appearance-locks',
        changes: [
          {
            elementId: 'hexagon-a',
            before,
            after: {
              ...before,
              appearance: {
                ...before.appearance,
                shapeRef: {
                  ...before.appearance.shapeRef,
                  definitionDigest: altered.definitionDigest,
                },
              },
            },
          },
        ],
      },
    ],
  });
  assert.equal(raw.ok, false);
  assert.equal(validateAuthoringBundle(original).ok, true);
});

test('resolved copy carries new definitions before insertion and removes old definitions last', () => {
  const base = makeBundle('flowchart', { blank: true });
  const current = accepted(compile(base, create())).bundle;
  const target = accepted(compile(base, create(definition('other'), 'other'), 'other')).bundle;
  const transaction = accepted(
    compileDiagramBundleTransaction(current, target, { transactionId: 'replace-library' }),
  ).transaction;
  assert.deepEqual(
    validateVersionedDiagramAuthoringArtifact('diagram-edit-transaction', transaction, {
      baseBundle: current,
    }),
    [],
  );
  assert.deepEqual(accepted(previewDiagramTransaction(current, transaction)).bundle, target);
});

test('portable shape definitions survive store restart and reject stale writes', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'planr-shape-library-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = makeBundle('flowchart', { blank: true });
  const store = createDiagramAuthoringStore({ root, slug: 'checkout' });
  await store.initialize(original, { transactionId: 'initialize' });
  const first = accepted(compile(original, create()));
  const concurrent = accepted(
    compile(original, create(definition('other'), 'other'), 'concurrent'),
  );
  assert.equal((await store.commit(first.transaction)).status, 'saved');
  assert.deepEqual(
    (await createDiagramAuthoringStore({ root, slug: 'checkout' }).read()).bundle,
    first.bundle,
  );
  await assert.rejects(
    store.commit(concurrent.transaction),
    (error) =>
      error.code === 'E_DIAGRAM_STORE_INVALID_TRANSACTION' &&
      error.details.diagnostics.some((item) => item.rule === 'stale-base'),
  );
  const inverse = accepted(
    createConditionalInverse(first.bundle, first.inverse, { transactionId: 'undo-store' }),
  );
  assert.deepEqual((await store.commit(inverse.transaction)).bundle, original);
});
