import assert from 'node:assert/strict';
import test from 'node:test';
import {
  makeBundle,
  placement,
  sealBundle,
} from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import {
  compileDiagramCommand,
  createConditionalInverse,
  previewDiagramTransaction,
} from '../lib/artifact/diagram/authoring/index.mjs';
import {
  previewAutomaticLayout,
  previewResetRoute,
} from '../lib/artifact/diagram/authoring/layout.mjs';
import { renderAuthoredDiagramSvg } from '../lib/artifact/diagram/authoring/renderer.mjs';
import {
  resolveDiagramScene,
  resolveShapeAttachment,
} from '../lib/artifact/diagram/authoring/scene.mjs';

function fixture() {
  const bundle = makeBundle('swimlane', { blank: true });
  bundle.document.nodes = [
    { id: 'start', label: 'In', kind: 'start', description: null },
    { id: 'decision', label: 'Pay?', kind: 'decision', description: null },
    { id: 'database', label: 'DB', kind: 'data-store', description: null },
  ];
  bundle.document.groups = [
    { id: 'group', label: 'Checkout', members: ['start', 'decision', 'database', 'note'] },
  ];
  bundle.document.lanes = [{ id: 'lane', label: 'Operations', members: ['group'] }];
  bundle.document.laneOrder = ['lane'];
  bundle.document.annotations = [{ id: 'note', text: 'Keep IDs', targetId: 'start' }];
  bundle.document.relations = [
    {
      id: 'first',
      from: 'start',
      to: 'decision',
      kind: 'flow',
      direction: 'forward',
      label: 'Review',
      weight: null,
    },
    {
      id: 'second',
      from: 'decision',
      to: 'database',
      kind: 'flow',
      direction: 'both',
      label: 'Store',
      weight: null,
    },
  ];
  const p = (id, shape, bounds, zIndex) => ({
    ...placement(id, shape),
    bounds,
    zIndex,
    appearance: {
      ...placement(id, shape).appearance,
      fill: shape === 'container' ? 'transparent' : 'surface',
    },
  });
  bundle.presentation.elements = [
    p('lane', 'container', { x: -20, y: -40, width: 710, height: 450 }, 0),
    p('group', 'container', { x: 0, y: 0, width: 660, height: 370 }, 1),
    p('start', 'ellipse', { x: 40, y: 100, width: 100, height: 80 }, 3),
    p('decision', 'diamond', { x: 240, y: 100, width: 140, height: 100 }, 3),
    p('database', 'cylinder', { x: 470, y: 100, width: 140, height: 100 }, 3),
    p('note', 'text', { x: 40, y: 250, width: 130, height: 70 }, 4),
    {
      ...placement('first', 'connector'),
      bounds: null,
      zIndex: 2,
      label: { x: 160, y: 55, width: 90 },
      route: {
        mode: 'manual',
        strategy: 'orthogonal',
        from: { side: 'right', offset: 0.5 },
        to: { side: 'left', offset: 0.5 },
        points: [
          { x: 140, y: 140 },
          { x: 190, y: 140 },
          { x: 190, y: 150 },
          { x: 240, y: 150 },
        ],
      },
    },
    {
      ...placement('second', 'connector'),
      bounds: null,
      zIndex: 2,
      label: { x: 390, y: 190, width: 70 },
      route: {
        mode: 'manual',
        strategy: 'straight',
        from: { side: 'right', offset: 0.5 },
        to: { side: 'left', offset: 0.5 },
        points: [
          { x: 380, y: 150 },
          { x: 470, y: 150 },
        ],
      },
    },
  ];
  return sealBundle(bundle);
}
function accepted(result) {
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result;
}

test('scene and SVG use independently specified saved shapes, routes, labels and stacking', () => {
  const bundle = fixture(),
    before = JSON.stringify(bundle);
  const scene = accepted(resolveDiagramScene(bundle)).scene;
  assert.equal(scene.quality.status, 'pass', JSON.stringify(scene.quality));
  assert.deepEqual(scene.boxes.find((value) => value.id === 'decision').bounds, {
    x: 240,
    y: 100,
    width: 140,
    height: 100,
  });
  assert.deepEqual(scene.edges.find((value) => value.id === 'first').points, [
    { x: 140, y: 140 },
    { x: 190, y: 140 },
    { x: 190, y: 150 },
    { x: 240, y: 150 },
  ]);
  assert.equal(scene.edges.find((value) => value.id === 'first').text.bounds.x, 160);
  assert.equal(scene.edges.find((value) => value.id === 'first').text.bounds.y, 55);
  assert.deepEqual(
    scene.elements.map((value) => value.id),
    ['lane', 'group', 'first', 'second', 'start', 'decision', 'database', 'note'],
  );
  assert.deepEqual(scene.viewBox, { x: -52, y: -72, width: 774, height: 514 });
  const output = accepted(renderAuthoredDiagramSvg(bundle));
  assert.match(output.svg, /<ellipse cx="90" cy="140" rx="50" ry="40"/);
  assert.match(output.svg, /M 310 100 L 380 150 L 310 200 L 240 150 Z/);
  assert.match(output.svg, /data-element-id="second"[^>]*data-direction="both"/);
  assert.match(output.svg, /marker-start="url\(#checkout-second-arrow\)"/);
  assert.match(output.svg, /font-size="14"/);
  assert.equal(JSON.stringify(bundle), before);
});

test('offset attachments meet the actual diamond and ellipse outlines while manual bends survive', () => {
  assert.deepEqual(
    resolveShapeAttachment({ x: 0, y: 0, width: 100, height: 100 }, 'diamond', {
      side: 'right',
      offset: 0.25,
    }),
    { x: 75, y: 25 },
  );
  const ellipse = resolveShapeAttachment({ x: 0, y: 0, width: 100, height: 100 }, 'ellipse', {
    side: 'right',
    offset: 0.25,
  });
  assert.ok(Math.abs(((ellipse.x - 50) / 50) ** 2 + ((ellipse.y - 50) / 50) ** 2 - 1) < 1e-10);
  const bundle = fixture();
  bundle.presentation.elements.find((value) => value.elementId === 'first').route.to.offset = 0.25;
  sealBundle(bundle);
  const scene = accepted(resolveDiagramScene(bundle)).scene;
  const points = scene.edges.find((value) => value.id === 'first').points;
  assert.deepEqual(points.slice(1, 3), [
    { x: 190, y: 140 },
    { x: 190, y: 150 },
  ]);
  assert.deepEqual(points.at(-1), { x: 275, y: 125 });
  assert.equal(
    bundle.presentation.elements.find((value) => value.elementId === 'first').route.points.at(-1).x,
    240,
  );
});

test('moving an endpoint changes only its visible endpoint segments and retains unrelated placement', () => {
  const bundle = fixture();
  const moved = accepted(
    compileDiagramCommand(
      bundle,
      { type: 'move', ids: ['start'], dx: 20, dy: 0 },
      { transactionId: 'move-start' },
    ),
  );
  const scene = accepted(resolveDiagramScene(moved.bundle)).scene;
  assert.deepEqual(scene.edges.find((value) => value.id === 'first').points.slice(0, 3), [
    { x: 160, y: 140 },
    { x: 190, y: 140 },
    { x: 190, y: 150 },
  ]);
  for (const id of ['decision', 'database', 'note', 'second'])
    assert.deepEqual(
      moved.bundle.presentation.elements.find((value) => value.elementId === id),
      bundle.presentation.elements.find((value) => value.elementId === id),
    );
});

test('selected layout leaves fixed objects intact and one inverse restores its complete result', () => {
  const bundle = makeBundle('flowchart', { blank: true });
  for (const [id, x, y] of [
    ['alpha', 40, 40],
    ['beta', 400, 250],
    ['fixed', 600, 40],
    ['unrelated', 1000, 500],
  ]) {
    bundle.document.nodes.push({ id, label: id, kind: 'process', description: null });
    bundle.presentation.elements.push(placement(id, 'rectangle', x, y));
  }
  bundle.presentation.elements[2].locks.position = true;
  sealBundle(bundle);
  const before = JSON.stringify(bundle);
  const preview = accepted(
    previewAutomaticLayout(bundle, {
      targetIds: ['alpha', 'beta', 'fixed'],
      transactionId: 'layout-selected',
      columns: 2,
    }),
  );
  assert.equal(JSON.stringify(bundle), before);
  assert.deepEqual(
    preview.bundle.presentation.elements.find((value) => value.elementId === 'beta').bounds,
    { x: 212, y: 40, width: 140, height: 70 },
  );
  for (const id of ['fixed', 'unrelated'])
    assert.deepEqual(
      preview.bundle.presentation.elements.find((value) => value.elementId === id),
      bundle.presentation.elements.find((value) => value.elementId === id),
    );
  assert.deepEqual(preview.layout.lockedIds, ['fixed']);
  const inverse = accepted(
    createConditionalInverse(preview.bundle, preview.inverse, { transactionId: 'undo-layout' }),
  );
  assert.deepEqual(
    accepted(previewDiagramTransaction(preview.bundle, inverse.transaction)).bundle,
    bundle,
  );
});

test('reset-route is explicit, preserves labels and other connectors, and obeys shared locks', () => {
  const bundle = fixture();
  const preview = accepted(
    previewResetRoute(bundle, { targetIds: ['first'], transactionId: 'reset-first' }),
  );
  const reset = preview.bundle.presentation.elements.find((value) => value.elementId === 'first');
  assert.equal(reset.route.mode, 'automatic');
  assert.deepEqual(reset.route.points, []);
  assert.deepEqual(
    reset.label,
    bundle.presentation.elements.find((value) => value.elementId === 'first').label,
  );
  assert.deepEqual(
    preview.bundle.presentation.elements.find((value) => value.elementId === 'second'),
    bundle.presentation.elements.find((value) => value.elementId === 'second'),
  );
  bundle.presentation.elements.find((value) => value.elementId === 'first').locks.route = true;
  sealBundle(bundle);
  assert.equal(
    previewResetRoute(bundle, { targetIds: ['first'], transactionId: 'locked-reset' }).ok,
    false,
  );
});

test('blank, dense, unreadable and obstructed layouts retain valid source but report export limits', () => {
  const blank = makeBundle('flowchart', { blank: true });
  assert.equal(accepted(resolveDiagramScene(blank)).scene.quality.status, 'no-visible-content');
  assert.equal(renderAuthoredDiagramSvg(blank).code, 'no-visible-content');
  const dense = makeBundle('flowchart', { blank: true });
  for (let index = 0; index < 1000; index++) {
    const id = `item-${index}`;
    dense.document.nodes.push({ id, label: id, kind: 'process', description: null });
    dense.presentation.elements.push(
      placement(id, 'rectangle', (index % 25) * 180, Math.floor(index / 25) * 100),
    );
  }
  sealBundle(dense);
  assert.equal(accepted(resolveDiagramScene(dense)).scene.elements.length, 1000);
  assert.equal(renderAuthoredDiagramSvg(dense).code, 'focused-output-required');
  const tiny = fixture();
  tiny.presentation.elements[2].appearance.fontSize = 8;
  sealBundle(tiny);
  const rejected = renderAuthoredDiagramSvg(tiny);
  assert.equal(rejected.ok, false);
  assert.ok(rejected.diagnostics.some((value) => value.rule === 'unreadable-text'));
  const blocked = fixture();
  blocked.presentation.elements.find((value) => value.elementId === 'note').bounds = {
    x: 160,
    y: 120,
    width: 60,
    height: 60,
  };
  sealBundle(blocked);
  const impossible = renderAuthoredDiagramSvg(blocked);
  assert.equal(impossible.ok, false);
  assert.ok(impossible.diagnostics.some((value) => value.rule === 'route-obstruction'));
});

test('rendering escapes labels, rejects unsafe options and preserves saved theme intent', () => {
  const bundle = fixture();
  bundle.document.nodes[0].label = '<x>';
  sealBundle(bundle);
  const result = accepted(renderAuthoredDiagramSvg(bundle, { theme: 'midnight' }));
  assert.ok(result.svg.includes('&lt;x&gt;'));
  assert.ok(!result.svg.includes('<x>'));
  assert.equal(result.theme.id, 'midnight');
  assert.equal(bundle.presentation.theme.themeId, 'paper');
  assert.equal(renderAuthoredDiagramSvg(bundle, { theme: '<script>' }).ok, false);
  for (const options of [1, true, null])
    assert.equal(renderAuthoredDiagramSvg(bundle, options).code, 'invalid-options');
  let reads = 0;
  const options = {};
  Object.defineProperty(options, 'theme', {
    enumerable: true,
    get() {
      reads++;
      return 'paper';
    },
  });
  assert.equal(renderAuthoredDiagramSvg(bundle, options).ok, false);
  assert.equal(reads, 0);
});

test('manual routes cannot double back through their endpoint shapes', () => {
  const bundle = fixture();
  const first = bundle.presentation.elements.find((value) => value.elementId === 'first');
  first.route.points = [
    { x: 140, y: 140 },
    { x: 80, y: 140 },
    { x: 80, y: 150 },
    { x: 240, y: 150 },
  ];
  sealBundle(bundle);
  const result = renderAuthoredDiagramSvg(bundle);
  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (value) => value.rule === 'route-obstruction' && value.elementIds.includes('start'),
    ),
  );
  // The normal offset port remains valid despite lying inside the ellipse's box.
  const clean = fixture();
  clean.presentation.elements.find((value) => value.elementId === 'first').route.from.offset = 0.25;
  sealBundle(clean);
  const cleanScene = accepted(resolveDiagramScene(clean)).scene;
  assert.ok(
    !cleanScene.quality.diagnostics.some(
      (value) => value.rule === 'route-obstruction' && value.elementIds.includes('start'),
    ),
  );
});

test('layout rejects null numeric options and bounds direct-target search work', () => {
  const bundle = fixture();
  assert.equal(
    previewAutomaticLayout(bundle, { targetIds: ['start'], transactionId: 'null-gap', gap: null })
      .ok,
    false,
  );
  const large = makeBundle('flowchart', { blank: true });
  for (let index = 0; index < 257; index++) {
    const id = `item-${index}`;
    large.document.nodes.push({ id, label: '', kind: 'process', description: null });
    large.presentation.elements.push(placement(id, 'rectangle', index * 180, 0));
  }
  sealBundle(large);
  const result = previewAutomaticLayout(large, {
    targetIds: large.document.nodes.map((value) => value.id),
    transactionId: 'large-layout',
  });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].rule, 'focused-region-required');
});

test('invisible connector styles and covering containers are explicit quality failures', () => {
  for (const appearance of [{ stroke: 'none' }, { strokeWidth: 0 }]) {
    const bundle = fixture();
    Object.assign(
      bundle.presentation.elements.find((value) => value.elementId === 'first').appearance,
      appearance,
    );
    sealBundle(bundle);
    const result = renderAuthoredDiagramSvg(bundle);
    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some(
        (value) => value.rule === 'invisible-connector' && value.elementIds.includes('first'),
      ),
    );
  }
  const bundle = fixture();
  const group = bundle.presentation.elements.find((value) => value.elementId === 'group');
  group.zIndex = 10;
  group.appearance.fill = 'surface';
  sealBundle(bundle);
  const saved = JSON.stringify(bundle),
    result = renderAuthoredDiagramSvg(bundle);
  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (value) => value.rule === 'stacking-obstruction' && value.elementIds.includes('first'),
    ),
  );
  assert.ok(
    result.diagnostics.some(
      (value) => value.rule === 'stacking-obstruction' && value.elementIds.includes('decision'),
    ),
  );
  assert.equal(JSON.stringify(bundle), saved);
  // Transparent foreground containers are legitimate authored stacking.
  group.appearance.fill = 'transparent';
  sealBundle(bundle);
  assert.equal(renderAuthoredDiagramSvg(bundle).ok, true);
});

test('shape-aware labels wrap without shrinking and report outline overflow', () => {
  const bundle = fixture();
  bundle.document.nodes[1].label = 'Pay by card';
  sealBundle(bundle);
  const scene = accepted(resolveDiagramScene(bundle)).scene;
  assert.deepEqual(scene.boxes.find((value) => value.id === 'decision').lines, ['Pay by', 'card']);
  assert.equal(scene.quality.status, 'pass', JSON.stringify(scene.quality));
  bundle.document.nodes[1].label = 'Cards\nCards\nCards\nCards';
  sealBundle(bundle);
  const result = renderAuthoredDiagramSvg(bundle);
  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (value) => value.rule === 'label-overflow' && value.elementIds.includes('decision'),
    ),
  );
});

function manyBends(nodeCount, relationCount) {
  const bundle = makeBundle('flowchart', { blank: true });
  for (let index = 0; index < nodeCount; index++) {
    const id = `node-${index}`;
    bundle.document.nodes.push({ id, label: 'Node', kind: 'process', description: null });
    bundle.presentation.elements.push(
      placement(
        id,
        'rectangle',
        index < 2 ? 20 + index * 240 : 500 + (index % 12) * 180,
        index < 2 ? 30 : Math.floor(index / 12) * 100,
      ),
    );
  }
  for (let index = 0; index < relationCount; index++) {
    const id = `edge-${index}`;
    bundle.document.relations.push({
      id,
      from: 'node-0',
      to: 'node-1',
      kind: 'flow',
      direction: 'forward',
      label: '',
      weight: null,
    });
    bundle.presentation.elements.push({
      ...placement(id, 'connector'),
      bounds: null,
      route: {
        mode: 'manual',
        strategy: 'orthogonal',
        from: { side: 'right', offset: 0.5 },
        to: { side: 'left', offset: 0.5 },
        points: Array.from({ length: 256 }, (_, step) => ({ x: 160 + (step * 100) / 255, y: 65 })),
      },
    });
  }
  return sealBundle(bundle);
}

test('valid many-bend drafts retain every scene element without spreading 128,000 points', () => {
  const bundle = manyBends(2, 500),
    digest = bundle.bundleDigest;
  const scene = accepted(resolveDiagramScene(bundle)).scene;
  assert.equal(scene.elements.length, 502);
  assert.equal(
    scene.edges.reduce((total, edge) => total + edge.points.length, 0),
    128000,
  );
  assert.deepEqual(scene.viewBox, { x: -32, y: -32, width: 464, height: 164 });
  assert.equal(scene.quality.status, 'focused-output-required');
  assert.equal(bundle.bundleDigest, digest);
});

test('many-bend scenes below the item cap avoid unbounded geometry inspection', () => {
  const bundle = manyBends(130, 120);
  const scene = accepted(resolveDiagramScene(bundle)).scene;
  assert.equal(scene.elements.length, 250);
  assert.equal(scene.quality.status, 'focused-output-required');
  assert.match(
    scene.quality.diagnostics.find((value) => value.rule === 'focused-output-required').detail,
    /geometry inspection budget/,
  );
  assert.equal(scene.edges[0].points.length, 256);
});
