import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import {
  exportAuthoredDiagram,
  verifyAuthoredDiagramExports,
} from '../lib/artifact/diagram/authoring/exports.mjs';
import {
  compileDiagramCommand,
  validateAuthoringBundle,
} from '../lib/artifact/diagram/authoring/index.mjs';
import {
  authoredDiagramPalette,
  renderAuthoredDiagramSvg,
  renderAuthoredSceneElement,
} from '../lib/artifact/diagram/authoring/renderer.mjs';
import { resolveDiagramScene } from '../lib/artifact/diagram/authoring/scene.mjs';
import { DIAGRAM_SHAPE_CATALOG } from '../lib/artifact/diagram/authoring/shape-catalog.mjs';
import {
  compileDiagramShape,
  diagramShapeAttachment,
  diagramShapeInterior,
  renderCompiledDiagramShape,
} from '../lib/artifact/diagram/authoring/shape-geometry.mjs';
import { createDiagramGeometryIndex } from '../lib/artifact/diagram/editor/geometry-index.mjs';
import { prepareAuthoredDiagramReviewBundle } from '../lib/artifact/diagram/review-bundle-browser.mjs';
import {
  createCatalogPattern,
  createCatalogShape,
} from '../lib/artifact/ui/diagram-editor-actions.mjs';

const accepted = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result;
};
const create = (command) =>
  accepted(
    compileDiagramCommand(makeBundle('flowchart', { blank: true }), command, {
      transactionId: 'create-library',
    }),
  ).bundle;

test('every library attachment lies on its visible outline across resize and translation', () => {
  for (const entry of DIAGRAM_SHAPE_CATALOG) {
    for (const bounds of [
      { x: 0, y: 0, width: 160, height: 100 },
      { x: -400, y: 230, width: 320, height: 180 },
    ]) {
      const compiled = compileDiagramShape(entry.definition, bounds);
      assert.equal(compileDiagramShape(entry.definition, bounds), compiled);
      assert.equal(Object.isFrozen(compiled.attachment), true);
      for (const side of ['top', 'bottom', 'left', 'right'])
        for (const offset of [0, 0.2, 0.5, 0.8, 1]) {
          const point = diagramShapeAttachment(compiled, bounds, { side, offset });
          assert.ok(
            Math.abs(diagramShapeInterior(point, compiled.attachment)) < 1e-6,
            `${entry.id} ${side} ${offset}`,
          );
        }
      assert.ok(
        renderCompiledDiagramShape(compiled, { fill: '#fff', stroke: '#000', strokeWidth: 1 })
          .length > 0,
      );
    }
  }
});

test('polygon hit testing excludes empty corners and live rendering matches exported geometry', () => {
  const bundle = create(createCatalogShape('basics/hexagon', { x: 0, y: 0 }));
  const scene = accepted(resolveDiagramScene(bundle)).scene;
  const element = scene.elements[0];
  const index = accepted(createDiagramGeometryIndex(bundle)).index;
  const camera = { x: 0, y: 0, scale: 1 };
  assert.deepEqual(accepted(index.query({ x: 1, y: 1, tolerance: 0, camera })).hits, []);
  assert.equal(
    accepted(index.query({ x: 80, y: 40, tolerance: 0, camera })).hits[0].id,
    element.id,
  );
  const rendered = accepted(renderAuthoredDiagramSvg(bundle));
  const fragment = renderAuthoredSceneElement(element, authoredDiagramPalette(), bundle.diagramId);
  assert.ok(rendered.svg.includes(fragment));
  const review = prepareAuthoredDiagramReviewBundle(bundle);
  assert.equal(review.schemaVersion, '1.2.0');
  assert.deepEqual(review.authored.shapeLibrary, bundle.shapeLibrary);
  assert.equal(accepted(validateAuthoringBundle(review.authored)).ok, true);
});

test('all three patterns resolve and export readable geometry', () => {
  for (const id of ['service-architecture', 'approval-process', 'product-journey']) {
    const bundle = create(createCatalogPattern(id, { x: 0, y: 0 }, 'flowchart'));
    const rendered = accepted(renderAuthoredDiagramSvg(bundle));
    assert.equal(
      rendered.quality.diagnostics.some((item) => item.severity === 'error'),
      false,
      JSON.stringify(rendered.quality.diagnostics),
    );
    for (const element of rendered.scene.elements.filter(
      (entry) => entry.collection !== 'relations',
    ))
      assert.ok(element.compiledShape);
  }
});

test('every catalog entry exports its full default label at its default size', () => {
  for (const entry of DIAGRAM_SHAPE_CATALOG) {
    const bundle = create(createCatalogShape(entry.id, { x: 0, y: 0 }));
    const rendered = renderAuthoredDiagramSvg(bundle);
    assert.equal(rendered.ok, true, `${entry.id}: ${JSON.stringify(rendered.diagnostics)}`);
    assert.equal(rendered.scene.elements[0].label, entry.definition.name);
    assert.equal(
      rendered.quality.diagnostics.some((item) => item.severity === 'error'),
      false,
      `${entry.id}: ${JSON.stringify(rendered.quality.diagnostics)}`,
    );
  }
});

test('native export preserves portable definitions and verifies without the catalog', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'planr-shape-native-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bundle = create(createCatalogShape('basics/hexagon', { x: 0, y: 0 }));
  const result = accepted(await exportAuthoredDiagram(bundle, { root }));
  const snapshot = JSON.parse(
    await readFile(join(result.directory, 'snapshot.planr-diagram-bundle.json'), 'utf8'),
  );
  assert.deepEqual(snapshot, bundle);
  accepted(validateAuthoringBundle(snapshot));
  accepted(await verifyAuthoredDiagramExports(snapshot, { root }));
});
