import assert from 'node:assert/strict';
import test from 'node:test';
import { diagramAuthoringBundleDigest } from '../../packages/protocol/src/diagram-authoring-contracts.mjs';
import {
  assertShapeDefinition,
  assertShapeLibrary,
  shapeDefinitionDigest,
} from '../../packages/protocol/src/shape-library-contracts.mjs';
import {
  assertVersionedDiagramAuthoringBundle,
  assertVersionedDiagramEditTransaction,
  assertVersionedDiagramReviewBundle,
  diagramAuthoringVersionFields,
  legacyDiagramAuthoringProjection,
  normalizeDiagramPresentation,
} from '../../packages/protocol/src/studio-presentation-contracts.mjs';
import { makeBundle, makeTransaction, sealBundle } from './fixtures/diagram-authoring.mjs';
import { makeReviewBundle } from './fixtures/diagram-review.mjs';

function definition() {
  const value = {
    packId: 'basics',
    packVersion: '1.0.0',
    shapeId: 'hexagon',
    name: 'Hexagon',
    description: 'A bounded six-sided shape.',
    tags: ['basic'],
    primitives: [
      {
        type: 'polygon',
        points: [
          { x: 0.25, y: 0 },
          { x: 0.75, y: 0 },
          { x: 1, y: 0.5 },
          { x: 0.75, y: 1 },
          { x: 0.25, y: 1 },
          { x: 0, y: 0.5 },
        ],
        fill: 'fill',
        stroke: 'stroke',
      },
    ],
    attachment: {
      type: 'polygon',
      points: [
        { x: 0.25, y: 0 },
        { x: 0.75, y: 0 },
        { x: 1, y: 0.5 },
        { x: 0.75, y: 1 },
        { x: 0.25, y: 1 },
        { x: 0, y: 0.5 },
      ],
    },
    textRegion: { x: 0.25, y: 0.1, width: 0.5, height: 0.8 },
    sizing: { width: 160, height: 80, minWidth: 80, minHeight: 40 },
  };
  return { ...value, definitionDigest: shapeDefinitionDigest(value) };
}
function reference(value) {
  const { packId, packVersion, shapeId, definitionDigest } = value;
  return { packId, packVersion, shapeId, definitionDigest };
}
function libraryBundle() {
  const value = makeBundle();
  value.shapeLibrary = [definition()];
  Object.assign(value, diagramAuthoringVersionFields(value));
  value.presentation.elements[0].appearance.shapeRef = reference(value.shapeLibrary[0]);
  return sealBundle(value);
}
function rehashDefinition(value) {
  value.definitionDigest = shapeDefinitionDigest(value);
  return value;
}

test('portable shape definitions survive serialization and legacy projection without mutation', () => {
  const bundle = libraryBundle();
  const encoded = JSON.stringify(bundle);
  assert.equal(assertVersionedDiagramAuthoringBundle(bundle), bundle);
  assert.deepEqual(assertVersionedDiagramAuthoringBundle(JSON.parse(encoded)), bundle);
  const legacy = legacyDiagramAuthoringProjection(bundle);
  assert.equal(legacy.schemaVersion, '1.0.0');
  assert.equal(legacy.presentation.elements[0].appearance.shapeRef, undefined);
  assert.notEqual(legacy.presentation.presentationDigest, bundle.presentation.presentationDigest);
  assertVersionedDiagramAuthoringBundle(legacy);
  assert.equal(JSON.stringify(bundle), encoded);
  bundle.studioPresentation = normalizeDiagramPresentation();
  sealBundle(bundle);
  assertVersionedDiagramAuthoringBundle(bundle);
});

test('definitions reject executable content, invalid geometry, duplicate identity, and tampering', () => {
  const bad = [
    (value) => {
      value.script = 'alert(1)';
    },
    (value) => {
      value.primitives[0].fill = 'url(https://example.com/image.svg)';
    },
    (value) => {
      value.primitives[0].points[0].x = -1;
    },
    (value) => {
      value.attachment.points = [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
        { x: 1, y: 0 },
      ];
    },
    (value) => {
      value.textRegion.width = 1;
    },
    (value) => {
      value.sizing.minWidth = value.sizing.width + 1;
    },
    (value) => {
      value.primitives = Array.from({ length: 33 }, () => value.primitives[0]);
    },
  ];
  for (const change of bad) {
    const value = definition();
    change(value);
    rehashDefinition(value);
    assert.throws(() => assertShapeDefinition(value), TypeError);
  }
  const tampered = definition();
  tampered.name = 'Modified';
  assert.throws(() => assertShapeDefinition(tampered), /digest/);
  assert.throws(() => assertShapeLibrary([definition(), definition()]), /duplicate/);
});

test('new bundles reject unresolved and tampered references before legacy validation', () => {
  const missing = libraryBundle();
  missing.shapeLibrary = [];
  sealBundle(missing);
  assert.throws(() => assertVersionedDiagramAuthoringBundle(missing), /missing/);
  assert.throws(() => legacyDiagramAuthoringProjection(missing), /missing/);
  const tampered = libraryBundle();
  tampered.presentation.elements[0].appearance.shapeRef.definitionDigest = `sha256:${'0'.repeat(64)}`;
  sealBundle(tampered);
  assert.throws(() => assertVersionedDiagramAuthoringBundle(tampered), /digest/);
  const digest = libraryBundle();
  digest.presentation.presentationDigest = `sha256:${'0'.repeat(64)}`;
  digest.bundleDigest = diagramAuthoringBundleDigest(digest);
  assert.throws(() => assertVersionedDiagramAuthoringBundle(digest), /digest/);
  const unknown = libraryBundle();
  unknown.schemaVersion = '1.3.0';
  sealBundle(unknown);
  assert.throws(() => assertVersionedDiagramAuthoringBundle(unknown));
});

test('promotion and inverse transactions validate full basis, library identity, and final references', () => {
  const before = makeBundle();
  const after = libraryBundle();
  const oldAppearance = {
    appearance: before.presentation.elements[0].appearance,
    locks: before.presentation.elements[0].locks,
  };
  const newAppearance = {
    appearance: after.presentation.elements[0].appearance,
    locks: after.presentation.elements[0].locks,
  };
  const tx = {
    ...makeTransaction(before),
    schemaVersion: '1.2.0',
    protocolVersion: '1.21.0',
    operations: [
      { type: 'set-shape-library', before: null, after: after.shapeLibrary },
      {
        type: 'set-appearance-locks',
        changes: [{ elementId: 'node-a', before: oldAppearance, after: newAppearance }],
      },
    ],
  };
  assert.equal(assertVersionedDiagramEditTransaction(tx, { baseBundle: before }), tx);
  const inverse = {
    ...makeTransaction(after),
    schemaVersion: '1.2.0',
    protocolVersion: '1.21.0',
    operations: [
      {
        type: 'set-appearance-locks',
        changes: [{ elementId: 'node-a', before: newAppearance, after: oldAppearance }],
      },
      { type: 'set-shape-library', before: after.shapeLibrary, after: null },
    ],
  };
  assertVersionedDiagramEditTransaction(inverse, { baseBundle: after });
  const unresolved = structuredClone(inverse);
  unresolved.operations.shift();
  assert.throws(
    () => assertVersionedDiagramEditTransaction(unresolved, { baseBundle: after }),
    /missing/,
  );
  const stale = structuredClone(tx);
  stale.base.bundleDigest = after.bundleDigest;
  assert.throws(
    () => assertVersionedDiagramEditTransaction(stale, { baseBundle: before }),
    /basis/,
  );
  const mismatched = structuredClone(tx);
  mismatched.operations[0].before = [];
  assert.throws(
    () => assertVersionedDiagramEditTransaction(mismatched, { baseBundle: before }),
    /before\/after/,
  );
});

test('review 1.2 retains verified embedded definitions and requires matching brand presentation', () => {
  const bundle = libraryBundle();
  const review = {
    ...makeReviewBundle(),
    schemaVersion: '1.2.0',
    diagramId: bundle.diagramId,
    title: bundle.document.title,
    source: { kind: 'authoring', digest: bundle.bundleDigest },
    authored: bundle,
  };
  assertVersionedDiagramReviewBundle(review);
  review.presentation = normalizeDiagramPresentation();
  assert.throws(() => assertVersionedDiagramReviewBundle(review), /presentations differ/);
  review.authored.studioPresentation = review.presentation;
  sealBundle(review.authored);
  assertVersionedDiagramReviewBundle(review);
});

test('new contract entrypoints reject accessors without executing them', () => {
  const value = definition();
  let reads = 0;
  Object.defineProperty(value, 'name', {
    enumerable: true,
    get() {
      reads += 1;
      return 'Unsafe';
    },
  });
  assert.throws(() => assertShapeDefinition(value));
  assert.equal(reads, 0);
  const legacy = makeBundle();
  const original = JSON.stringify(legacy);
  assertVersionedDiagramAuthoringBundle(legacy);
  assert.equal(JSON.stringify(legacy), original);
});

test('shape placements enforce minimum size and declared attachment geometry', () => {
  const bundle = libraryBundle();
  bundle.presentation.elements[0].bounds.width = 1;
  sealBundle(bundle);
  assert.throws(() => assertVersionedDiagramAuthoringBundle(bundle), /below shape minimum/u);
  const mismatched = definition();
  mismatched.attachment.points[0].x = 0.3;
  rehashDefinition(mismatched);
  assert.throws(() => assertShapeDefinition(mismatched), /first primitive must match/u);
});

test('multiple library operations cannot redefine a removed immutable identity', () => {
  const before = libraryBundle();
  const changed = structuredClone(before.shapeLibrary[0]);
  changed.name = 'Substituted hexagon';
  rehashDefinition(changed);
  const transaction = {
    ...makeTransaction(before),
    operations: [
      { type: 'set-shape-library', before: before.shapeLibrary, after: [] },
      { type: 'set-shape-library', before: [], after: [changed] },
    ],
  };
  Object.assign(transaction, diagramAuthoringVersionFields(before));
  assert.throws(
    () => assertVersionedDiagramEditTransaction(transaction),
    /immutable library definition/u,
  );
});
