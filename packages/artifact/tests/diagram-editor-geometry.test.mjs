import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBundle, placement, sealBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { createDiagramGeometryIndex } from '../lib/artifact/diagram/editor/geometry-index.mjs';
import { compileDiagramCommand, resolveDiagramScene } from '../lib/artifact/diagram/authoring/index.mjs';
import { geometryFields } from '../lib/artifact/diagram/authoring/model.mjs';

const accepted = result => { assert.equal(result.ok, true, JSON.stringify(result.diagnostics)); return result; };
const screen = (point, camera) => ({ x: point.x * camera.scale + camera.x, y: point.y * camera.scale + camera.y });
const center = bounds => ({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
const camera = { x: 37, y: -19, scale: 1.5 };
function mixedBundle(laneCount = 50) {
  const bundle = makeBundle('swimlane', { blank: true });
  for (let lane = 0; lane < laneCount; lane++) {
    const x = lane % 10 * 2400, y = Math.floor(lane / 10) * 600;
    const laneId = `lane-${lane}`, groupId = `group-${lane}`;
    const members = Array.from({ length: 12 }, (_, index) => `node-${lane * 12 + index}`);
    bundle.document.lanes.push({ id: laneId, label: `Lane ${lane}`, members: [groupId] }); bundle.document.laneOrder.push(laneId);
    bundle.document.groups.push({ id: groupId, label: `Group ${lane}`, members });
    for (const [id, bounds, zIndex] of [[laneId, { x, y, width: 2200, height: 500 }, 0], [groupId, { x: x + 20, y: y + 80, width: 2000, height: 320 }, 1]]) {
      const value = placement(id, 'container'); value.bounds = bounds; value.zIndex = zIndex; value.appearance.fill = 'transparent'; bundle.presentation.elements.push(value);
    }
    const nodePlacements = [];
    for (let index = 0; index < members.length; index++) {
      const id = members[index]; bundle.document.nodes.push({ id, label: `N${lane * 12 + index}`, kind: 'process', description: null });
      const value = placement(id, 'rectangle', x + 80 + index % 6 * 280, y + 140 + Math.floor(index / 6) * 100); value.zIndex = 3;
      nodePlacements.push(value); bundle.presentation.elements.push(value);
    }
    for (let index = 0; index < 6; index++) {
      const id = `edge-${lane * 6 + index}`, from = nodePlacements[index * 2], to = nodePlacements[index * 2 + 1];
      bundle.document.relations.push({ id, from: from.elementId, to: to.elementId, kind: 'flow', direction: 'forward', label: 'Next', weight: null });
      bundle.presentation.elements.push({ ...placement(id, 'connector'), bounds: null, zIndex: 2, label: { x: from.bounds.x + from.bounds.width + 30, y: from.bounds.y - 30, width: 70 }, route: {
        mode: 'manual', strategy: 'straight', from: { side: 'right', offset: 0.5 }, to: { side: 'left', offset: 0.5 }, points: [{ x: from.bounds.x + from.bounds.width, y: from.bounds.y + 35 }, { x: to.bounds.x, y: to.bounds.y + 35 }],
      } });
    }
  }
  return sealBundle(bundle);
}

test('mixed 1,000-element lookup uses candidates and one screen-to-world camera without resolving geometry', () => {
  const bundle = mixedBundle(), before = JSON.stringify(bundle);
  const index = accepted(createDiagramGeometryIndex(bundle)).index;
  assert.equal(index.stats().entries, 1000);
  const point = center(index.get('node-7').bounds);
  const beforeWork = index.stats();
  for (let attempt = 0; attempt < 40; attempt++) {
    const result = accepted(index.query({ ...screen(point, camera), camera, tolerance: 4 }));
    assert.deepEqual(result.world, point);
    assert.equal(result.hits[0].id, 'node-7');
    assert.ok(result.hits.some(hit => hit.id === 'group-0'));
    assert.ok(result.hits.some(hit => hit.id === 'lane-0'));
  }
  const work = index.stats();
  assert.ok(work.lastQueryCandidates < 50, JSON.stringify(work));
  assert.ok(work.lastQueryChecks + work.lastQueryOverflow < work.entries / 4, JSON.stringify(work));
  assert.equal(work.geometryResolved, beforeWork.geometryResolved);
  assert.equal(work.validations, beforeWork.validations);
  assert.equal(work.metadataEntriesScanned, beforeWork.metadataEntriesScanned);
  assert.equal(work.fullBuilds, 1);
  assert.equal(JSON.stringify(bundle), before);
});

test('pixel tolerance scales through the camera and segment lookup does not use an edge bounding rectangle', () => {
  const bundle = mixedBundle(1), index = accepted(createDiagramGeometryIndex(bundle)).index;
  const edge = index.get('edge-0'), middle = { x: (edge.points[0].x + edge.points[1].x) / 2, y: edge.points[0].y };
  for (const scale of [0.25, 1, 4]) {
    const camera = { x: -101, y: 89, scale };
    const hit = accepted(index.query({ ...screen({ x: middle.x, y: middle.y + 5 / scale }, camera), camera, tolerance: 6 })).hits.find(value => value.id === 'edge-0');
    assert.equal(hit.kind, 'segment'); assert.ok(Math.abs(hit.distance - 5) < 1e-9);
    assert.ok(!accepted(index.query({ ...screen({ x: middle.x, y: middle.y + 7 / scale }, camera), camera, tolerance: 6 })).hits.some(value => value.id === 'edge-0'));
  }
});

test('one moved node updates only it and its incident route among 1,000 cached elements', () => {
  const bundle = mixedBundle(), index = accepted(createDiagramGeometryIndex(bundle)).index;
  const unrelated = index.get('node-599'), previous = index.stats().geometryResolved;
  const moved = accepted(compileDiagramCommand(bundle, { type: 'move', ids: ['node-7'], dx: 20, dy: 0 }, { transactionId: 'indexed-move' }));
  const updated = accepted(index.update(moved.bundle, ['node-7']));
  assert.deepEqual(updated.updatedIds, ['edge-3', 'node-7']);
  assert.deepEqual(updated.removedIds, []);
  assert.equal(index.stats().geometryResolved - previous, 2);
  assert.equal(index.stats().lastMetadataEntriesScanned, 1000);
  assert.deepEqual(index.get('node-599'), unrelated);
  assert.equal(index.get('edge-3').points.at(-1).x, index.get('node-7').bounds.x);
  assert.equal(index.stats().fullBuilds, 1);
});

test('nested lane and container movement refreshes descendants and connected endpoints in global coordinates', () => {
  const bundle = mixedBundle(), index = accepted(createDiagramGeometryIndex(bundle)).index;
  const oldNode = index.get('node-0'), oldEdge = index.get('edge-0'), fixed = index.get('group-49');
  const moved = accepted(compileDiagramCommand(bundle, { type: 'move', ids: ['lane-0'], dx: 60, dy: 40 }, { transactionId: 'indexed-lane' }));
  const updated = accepted(index.update(moved.bundle, ['lane-0']));
  assert.equal(updated.updatedIds.length, 20);
  assert.ok(updated.updatedIds.includes('group-0'));
  assert.deepEqual(index.get('node-0').bounds, { ...oldNode.bounds, x: oldNode.bounds.x + 60, y: oldNode.bounds.y + 40 });
  assert.deepEqual(index.get('edge-0').points, oldEdge.points.map(point => ({ x: point.x + 60, y: point.y + 40 })));
  assert.deepEqual(index.get('group-49'), fixed);
  assert.equal(accepted(index.query({ ...screen(center(index.get('node-0').bounds), camera), camera })).hits[0].id, 'node-0');
});

test('reconnect, manual bend and label changes share exact renderer geometry and retain unrelated routes', () => {
  let bundle = mixedBundle(1);
  const index = accepted(createDiagramGeometryIndex(bundle)).index, fixed = index.get('edge-5');
  bundle = accepted(compileDiagramCommand(bundle, { type: 'reconnect', id: 'edge-0', from: 'node-0', to: 'node-2' }, { transactionId: 'indexed-reconnect' })).bundle;
  assert.deepEqual(accepted(index.update(bundle, ['edge-0'])).updatedIds, ['edge-0']);
  assert.equal(index.get('edge-0').points.at(-1).x, index.get('node-2').bounds.x);
  const placement = bundle.presentation.elements.find(value => value.elementId === 'edge-0'), before = geometryFields(placement), after = structuredClone(before);
  const start = index.get('edge-0').points[0], end = index.get('edge-0').points.at(-1);
  after.route.strategy = 'orthogonal'; after.route.points = [start, { x: start.x + 40, y: start.y }, { x: start.x + 40, y: start.y - 80 }, { x: end.x - 40, y: start.y - 80 }, { x: end.x - 40, y: end.y }, end];
  after.label = { x: start.x + 100, y: start.y - 120, width: 100 };
  bundle = accepted(compileDiagramCommand(bundle, { type: 'geometry', changes: [{ elementId: 'edge-0', before, after }] }, { transactionId: 'indexed-bend-label' })).bundle;
  assert.deepEqual(accepted(index.update(bundle, ['edge-0'])).updatedIds, ['edge-0']);
  const scene = accepted(resolveDiagramScene(bundle)).scene, edge = scene.edges.find(value => value.id === 'edge-0');
  assert.deepEqual(index.get('edge-0').points, edge.points);
  assert.deepEqual(index.get('edge-0').labelBounds, edge.text.bounds);
  const labelHit = accepted(index.query({ ...screen(center(edge.text.bounds), camera), camera })).hits.find(value => value.id === 'edge-0');
  assert.equal(labelHit.kind, 'label');
  const bendHit = accepted(index.query({ ...screen({ x: start.x + 60, y: start.y - 80 }, camera), camera })).hits.find(value => value.id === 'edge-0');
  assert.equal(bendHit.kind, 'segment');
  assert.ok(!accepted(index.query({ ...screen({ x: start.x + 80, y: start.y - 30 }, camera), camera, tolerance: 2 })).hits.some(value => value.id === 'edge-0'));
  assert.deepEqual(index.get('edge-5'), fixed);
});

test('equal revisions do no geometry work, deleted IDs leave no hit entries, and returned records are detached', () => {
  const bundle = mixedBundle(1), index = accepted(createDiagramGeometryIndex(bundle)).index;
  const node = index.get('node-0'); node.bounds.x = 999999;
  assert.notEqual(index.get('node-0').bounds.x, node.bounds.x);
  const resolved = index.stats().geometryResolved;
  assert.deepEqual(accepted(index.update(structuredClone(bundle), ['lane-0'])).updatedIds, []);
  assert.equal(index.stats().lastMetadataEntriesScanned, 0);
  assert.equal(index.stats().geometryResolved, resolved);
  const old = index.get('edge-0'), point = { x: (old.points[0].x + old.points[1].x) / 2, y: old.points[0].y };
  bundle.document.relations = bundle.document.relations.filter(value => value.id !== 'edge-0');
  bundle.presentation.elements = bundle.presentation.elements.filter(value => value.elementId !== 'edge-0'); sealBundle(bundle);
  const update = accepted(index.update(bundle, ['edge-0']));
  assert.deepEqual(update.removedIds, ['edge-0']); assert.deepEqual(update.updatedIds, []); assert.equal(index.get('edge-0'), null);
  assert.equal(index.stats().lastUpdateResolved, 0);
  assert.ok(!accepted(index.query({ ...screen(point, camera), camera })).hits.some(value => value.id === 'edge-0'));
});

test('query and update reject unsafe data or extreme selection work without changing cached geometry', () => {
  const bundle = mixedBundle(1), index = accepted(createDiagramGeometryIndex(bundle)).index;
  let reads = 0;
  const input = { x: 0, y: 0 }; Object.defineProperty(input, 'camera', { enumerable: true, get() { reads++; return camera; } });
  assert.equal(index.query(input).ok, false); assert.equal(reads, 0);
  const invalid = {}; Object.defineProperty(invalid, 'presentation', { enumerable: true, get() { reads++; return bundle.presentation; } });
  assert.equal(index.update(invalid, []).ok, false); assert.equal(reads, 0);
  const original = index.get('node-0');
  for (const camera of [{ x: 0, y: 0, scale: 0 }, { x: 0, y: 0, scale: Number.MIN_VALUE }, { x: 0, y: 0, scale: 1e-10 }]) assert.equal(index.query({ x: 1, y: 1, camera }).ok, false);
  assert.equal(index.update(bundle, ['unknown']).ok, false);
  bundle.presentation.elements.find(value => value.elementId === 'node-0').bounds.x += 1;
  assert.equal(index.update(bundle, ['node-0']).ok, false);
  assert.deepEqual(index.get('node-0'), original);
});


test('reordering equal-z objects updates hit priority without recomputing their geometry', () => {
  const bundle = makeBundle('flowchart', { blank: true });
  for (const id of ['first', 'second']) {
    bundle.document.nodes.push({ id, label: id, kind: 'process', description: null });
    bundle.presentation.elements.push(placement(id));
  }
  sealBundle(bundle);
  const index = accepted(createDiagramGeometryIndex(bundle)).index;
  const query = { ...screen({ x: 90, y: 65 }, camera), camera };
  assert.equal(accepted(index.query(query)).hits[0].id, 'second');
  const work = index.stats().geometryResolved;
  bundle.presentation.elements.reverse(); sealBundle(bundle);
  assert.deepEqual(accepted(index.update(bundle, [])).updatedIds, []);
  assert.equal(index.stats().geometryResolved, work);
  assert.equal(accepted(index.query(query)).hits[0].id, 'first');
  assert.equal(index.get('first').order, 1);
});
