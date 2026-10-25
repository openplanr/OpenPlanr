import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { getDiagramAuthoringCapability } from '@openplanr/protocol/diagram-authoring-contracts';
import {
  assertShapeDefinition,
  shapeDefinitionDigest,
} from '@openplanr/protocol/shape-library-contracts';
import { makeBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import {
  compileDiagramCommand,
  createConditionalInverse,
  previewDiagramTransaction,
} from '../lib/artifact/diagram/authoring/index.mjs';
import {
  createDiagramShapeSearch,
  DIAGRAM_PATTERNS,
  DIAGRAM_SHAPE_CATALOG,
  diagramShapeAllowed,
  diagramShapeEntry,
} from '../lib/artifact/diagram/authoring/shape-catalog.mjs';
import {
  createCatalogPattern,
  createCatalogShape,
  visibleInsertionPoint,
} from '../lib/artifact/ui/diagram-editor-actions.mjs';

const accepted = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result;
};
test('catalog definitions validate, pin their content and remain separate from semantics', () => {
  assert.equal(DIAGRAM_SHAPE_CATALOG.length, 30);
  assert.deepEqual(
    Object.fromEntries(
      ['basics', 'engineering', 'process', 'general'].map((id) => [
        id,
        DIAGRAM_SHAPE_CATALOG.filter((entry) => entry.library === id).length,
      ]),
    ),
    { basics: 12, engineering: 8, process: 6, general: 4 },
  );
  for (const entry of DIAGRAM_SHAPE_CATALOG) {
    assertShapeDefinition(entry.definition);
    assert.equal(entry.definition.definitionDigest, shapeDefinitionDigest(entry.definition));
    assert.equal(Object.isFrozen(entry.definition.primitives), true);
    assert.equal(diagramShapeAllowed(entry, getDiagramAuthoringCapability('flowchart')), true);
  }
  assert.throws(() => diagramShapeEntry('unknown/shadow'), /does not exist/u);
  assert.equal(
    diagramShapeAllowed(diagramShapeEntry('engineering/service'), {
      primitives: ['node'],
      nodeKinds: ['process'],
    }),
    false,
  );
});

test('every catalog entry inserts with only its pinned definition and undoes promotion', () => {
  for (const entry of DIAGRAM_SHAPE_CATALOG) {
    const before = makeBundle('flowchart', { blank: true });
    const command = createCatalogShape(entry.id, { x: 120, y: 80 });
    const created = accepted(
      compileDiagramCommand(before, command, {
        transactionId: `insert-${entry.definition.shapeId}`,
      }),
    );
    assert.equal(created.bundle.schemaVersion, '1.2.0');
    assert.deepEqual(created.bundle.shapeLibrary, [entry.definition]);
    assert.equal(
      created.bundle.presentation.elements[0].appearance.shapeRef.definitionDigest,
      entry.definition.definitionDigest,
    );
    const inverse = accepted(
      createConditionalInverse(created.bundle, created.inverse, { transactionId: 'undo-insert' }),
    );
    const undone = accepted(previewDiagramTransaction(created.bundle, inverse.transaction));
    assert.equal(undone.bundle.bundleDigest, before.bundleDigest);
  }
});

test('patterns insert connected editable objects atomically and remap IDs on each insertion', () => {
  for (const pattern of DIAGRAM_PATTERNS) {
    const before = makeBundle('flowchart', { blank: true });
    const command = createCatalogPattern(pattern.id, { x: 0, y: 0 }, 'flowchart');
    const next = createCatalogPattern(pattern.id, { x: 700, y: 0 }, 'flowchart');
    assert.equal(
      command.elements.some((element) =>
        next.elements.some((other) => other.value.id === element.value.id),
      ),
      false,
    );
    const created = accepted(
      compileDiagramCommand(before, command, { transactionId: 'insert-pattern' }),
    );
    assert.equal(created.bundle.document.relations.length, pattern.edges.length);
    assert.equal(
      created.bundle.document.nodes.length + created.bundle.document.annotations.length,
      pattern.nodes.length,
    );
    const nodeIds = new Set(created.bundle.document.nodes.map((node) => node.id));
    for (const edge of created.bundle.document.relations) {
      assert.equal(nodeIds.has(edge.from), true);
      assert.equal(nodeIds.has(edge.to), true);
    }
    const inverse = accepted(
      createConditionalInverse(created.bundle, created.inverse, { transactionId: 'undo-pattern' }),
    );
    assert.equal(
      accepted(previewDiagramTransaction(created.bundle, inverse.transaction)).bundle.bundleDigest,
      before.bundleDigest,
    );
  }
  assert.throws(
    () => createCatalogPattern('approval-process', { x: 0, y: 0 }, 'unknown'),
    /not supported/u,
  );
});

test('viewport insertion separates repeated shapes and ignores distant objects within visible bounds', () => {
  const center = { x: 200, y: 400 },
    size = { width: 160, height: 80 };
  const viewport = { x: 0, y: 0, width: 400, height: 800 };
  const origin = visibleInsertionPoint(center, size, [{ x: 100000, y: 200000, ...size }], viewport);
  assert.deepEqual(origin, { x: 120, y: 360 });
  const existing = [];
  for (let index = 0; index < 5; index++) {
    const point = visibleInsertionPoint(center, size, existing, viewport);
    assert.ok(point.x >= viewport.x && point.x + size.width <= viewport.width);
    assert.ok(point.y >= viewport.y && point.y + size.height <= viewport.height);
    assert.equal(
      existing.some(
        (rect) =>
          point.x < rect.x + rect.width &&
          point.x + size.width > rect.x &&
          point.y < rect.y + rect.height &&
          point.y + size.height > rect.y,
      ),
      false,
    );
    existing.push({ ...point, ...size });
  }
  assert.deepEqual(
    visibleInsertionPoint(
      center,
      size,
      [{ x: -1000, y: -1000, width: 3000, height: 3000 }],
      viewport,
    ),
    origin,
  );
});

test('indexed catalog search matches words and libraries with 10,000 entries under budget', (t) => {
  const entries = Array.from({ length: 10000 }, (_, index) => ({
    ...DIAGRAM_SHAPE_CATALOG[index % 30],
    id: `synthetic-${index}`,
  }));
  const search = createDiagramShapeSearch(entries);
  assert.equal(createDiagramShapeSearch()('gateway')[0].id, 'engineering/api-gateway');
  assert.equal(createDiagramShapeSearch()('storage', 'engineering').length, 1);
  assert.equal(createDiagramShapeSearch()('not a shape').length, 0);
  const runs = [];
  for (let run = 0; run < 5; run++) {
    for (let warm = 0; warm < 20; warm++) search('service', 'engineering');
    const samples = [];
    for (let sample = 0; sample < 100; sample++) {
      const start = performance.now();
      search(sample % 2 ? 'storage' : '', sample % 3 ? 'engineering' : 'all');
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    runs.push(samples[94]);
  }
  t.diagnostic(
    `10,000-entry catalog; five warm p95 runs (ms): ${runs.map((time) => time.toFixed(3)).join(', ')}`,
  );
  assert.ok(
    runs.every((p95) => p95 <= 100),
    JSON.stringify(runs),
  );
});
