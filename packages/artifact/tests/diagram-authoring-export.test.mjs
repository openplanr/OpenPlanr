import assert from 'node:assert/strict';
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import {
  makeBundle,
  placement,
  sealBundle,
} from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { compileDiagramCommand } from '../lib/artifact/diagram/authoring/commands.mjs';
import {
  exportAuthoredDiagram,
  verifyAuthoredDiagramExports,
} from '../lib/artifact/diagram/authoring/exports.mjs';
import { renderAuthoredDiagramSvg } from '../lib/artifact/diagram/authoring/renderer.mjs';
import { digestBytes, jsonBytes } from '../lib/artifact/diagram/custody/bytes.mjs';
import { renderDiagramPng } from '../lib/artifact/diagram/rendering/png.mjs';

function authoredFixture() {
  const bundle = makeBundle('swimlane', { blank: true });
  bundle.document.nodes = [
    { id: 'node-a', label: 'Receive', kind: 'process', description: null },
    { id: 'node-b', label: 'Done', kind: 'end', description: null },
  ];
  bundle.document.relations = [
    {
      id: 'edge-a',
      from: 'node-a',
      to: 'node-b',
      kind: 'flow',
      direction: 'forward',
      label: 'Accepted',
      weight: null,
    },
  ];
  bundle.document.groups = [{ id: 'group-a', label: 'Intake', members: ['node-a'] }];
  bundle.document.lanes = [{ id: 'lane-a', label: 'Operations', members: ['group-a', 'node-b'] }];
  bundle.document.laneOrder = ['lane-a'];
  bundle.document.accessibility.readingOrder = ['lane-a', 'group-a', 'node-a', 'edge-a', 'node-b'];
  const bounded = (id, shape, bounds, zIndex, fill = 'surface') => ({
    ...placement(id, shape),
    bounds,
    zIndex,
    appearance: { ...placement(id, shape).appearance, fill },
  });
  bundle.presentation.elements = [
    bounded('lane-a', 'container', { x: -40, y: -60, width: 640, height: 310 }, 0),
    bounded('group-a', 'container', { x: 0, y: 20, width: 260, height: 200 }, 1),
    bounded('node-a', 'rectangle', { x: 40, y: 100, width: 180, height: 80 }, 3, 'accent'),
    bounded('node-b', 'rounded-rectangle', { x: 360, y: 100, width: 180, height: 80 }, 3),
    {
      ...placement('edge-a', 'connector'),
      bounds: null,
      zIndex: 2,
      route: {
        mode: 'manual',
        strategy: 'straight',
        from: { side: 'right', offset: 0.5 },
        to: { side: 'left', offset: 0.5 },
        points: [
          { x: 220, y: 140 },
          { x: 360, y: 140 },
        ],
      },
      label: { x: 270, y: 60, width: 80 },
    },
  ];
  return sealBundle(bundle);
}
async function temporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'planr-authored-export-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function snapshot(directory) {
  return Object.fromEntries(
    await Promise.all(
      (await readdir(directory))
        .sort()
        .map(async (name) => [name, (await readFile(join(directory, name))).toString('base64')]),
    ),
  );
}
async function replace(path, bytes) {
  await chmod(path, 0o600);
  await writeFile(path, bytes);
}
const good = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
};

// Decode actual emitted PNG scanlines independently of the SVG renderer. This
// deliberately checks raster pixels, rather than trusting only IHDR dimensions.
function decodePng(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8);
  assert.equal(bytes[25], 6);
  assert.equal(bytes[28], 0);
  const chunks = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = bytes.readUInt32BE(offset),
      type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4,
    pixels = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c,
      x = Math.abs(p - a),
      y = Math.abs(p - b),
      z = Math.abs(p - c);
    return x <= y && x <= z ? a : y <= z ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const above = y ? pixels[(y - 1) * stride + x] : 0;
      const diagonal = y && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
      const predicted = [
        0,
        left,
        above,
        Math.floor((left + above) / 2),
        paeth(left, above, diagonal),
      ][filter];
      pixels[y * stride + x] = (raw[y * (stride + 1) + x + 1] + predicted) & 255;
    }
  }
  return {
    width,
    height,
    pixel(x, y) {
      return [
        ...pixels.subarray(
          (Math.round(y) * width + Math.round(x)) * 4,
          (Math.round(y) * width + Math.round(x)) * 4 + 4,
        ),
      ];
    },
  };
}
const color = (hex) => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
  255,
];

test('SVG, decoded PNG and portable review HTML use one authored snapshot and retain previous exports', async (t) => {
  const root = await temporaryRoot(t),
    bundle = authoredFixture(),
    before = jsonBytes(bundle);
  const exported = good(await exportAuthoredDiagram(bundle, { root }));
  const rendered = good(renderAuthoredDiagramSvg(bundle));
  assert.deepEqual(
    await readFile(join(exported.directory, 'snapshot.planr-diagram-bundle.json')),
    before,
  );
  const svg = await readFile(join(exported.directory, 'diagram.svg'), 'utf8');
  assert.equal(svg, rendered.svg);
  const html = await readFile(join(exported.directory, 'review.html'), 'utf8');
  assert.ok(html.includes(svg.trim()));
  assert.ok(html.includes(bundle.bundleDigest));
  assert.ok(html.includes('Export report'));
  assert.equal(exported.manifest.theme.id, 'paper');
  assert.equal(exported.manifest.renderer.id, 'openplanr-authored-svg');
  const png = decodePng(await readFile(join(exported.directory, 'diagram.png')));
  const at = (x, y) => png.pixel(x - exported.scene.viewBox.x, y - exported.scene.viewBox.y);
  assert.deepEqual(
    at(45, 110),
    color(exported.theme.fills.accent),
    'Saved node bounds map directly to raster pixels',
  );
  assert.deepEqual(
    at(365, 125),
    color(exported.theme.fills.surface),
    'Unrelated node placement and fill are preserved',
  );
  assert.deepEqual(
    at(10, 190),
    color(exported.theme.fills.surface),
    'Container interior remains visible below the node',
  );
  assert.deepEqual(jsonBytes(bundle), before);
  good(await verifyAuthoredDiagramExports(bundle, { root }));
  const previous = await snapshot(exported.directory);
  const moved = good(
    compileDiagramCommand(
      bundle,
      { type: 'move', ids: ['node-a'], dx: 20, dy: 0 },
      { transactionId: 'move-export' },
    ),
  );
  const next = good(await exportAuthoredDiagram(moved.bundle, { root }));
  assert.notEqual(next.directory, exported.directory);
  assert.deepEqual(await snapshot(exported.directory), previous);
  const nextPng = decodePng(await readFile(join(next.directory, 'diagram.png')));
  const afterPixel = (x, y) => nextPng.pixel(x - next.scene.viewBox.x, y - next.scene.viewBox.y);
  assert.deepEqual(
    afterPixel(45, 110),
    color(next.theme.fills.surface),
    'Old node position is no longer filled after the move',
  );
  assert.deepEqual(afterPixel(65, 110), color(next.theme.fills.accent));
  assert.deepEqual(afterPixel(365, 125), at(365, 125));
  assert.equal(good(await exportAuthoredDiagram(bundle, { root })).status, 'unchanged');
});

test('blank, dense and obstructed diagrams return truthful export diagnostics without invoking rasterization', async (t) => {
  const root = await temporaryRoot(t);
  let rasterCalls = 0;
  const rasterize = () => {
    rasterCalls++;
    throw new Error('Must not run for a rejected scene');
  };
  const blank = await exportAuthoredDiagram(makeBundle('flowchart', { blank: true }), {
    root,
    rasterize,
  });
  assert.equal(blank.code, 'no-visible-content');
  const dense = makeBundle('flowchart', { blank: true });
  for (let index = 0; index < 1000; index++) {
    const id = `node-${index}`;
    dense.document.nodes.push({ id, label: `Step ${index}`, kind: 'process', description: null });
    dense.presentation.elements.push(
      placement(id, 'rectangle', (index % 40) * 180, Math.floor(index / 40) * 100),
    );
  }
  assert.equal(
    (await exportAuthoredDiagram(sealBundle(dense), { root, rasterize })).code,
    'focused-output-required',
  );
  const obstructed = authoredFixture();
  obstructed.document.nodes.push({ id: 'obstacle', label: '', kind: 'process', description: null });
  obstructed.presentation.elements.push({
    ...placement('obstacle'),
    bounds: { x: 270, y: 110, width: 40, height: 60 },
  });
  const blocked = await exportAuthoredDiagram(sealBundle(obstructed), { root, rasterize });
  assert.equal(blocked.ok, false);
  assert.ok(
    blocked.diagnostics.some(
      (value) => value.rule === 'route-obstruction' && value.elementIds.includes('edge-a'),
    ),
  );
  assert.equal(rasterCalls, 0);
  assert.deepEqual(await readdir(root), []);
});

test('raster failure preserves canonical save bytes and every prior complete derived member', async (t) => {
  const root = await temporaryRoot(t),
    bundle = authoredFixture();
  const first = good(await exportAuthoredDiagram(bundle, { root }));
  const prior = await snapshot(first.directory);
  const canonical = join(
    root,
    'diagrams',
    bundle.diagramId,
    `${bundle.diagramId}.planr-diagram-bundle.json`,
  );
  const next = good(
    compileDiagramCommand(
      bundle,
      { type: 'rename', id: 'node-a', label: 'Intake' },
      { transactionId: 'rename-export' },
    ),
  ).bundle;
  const saved = jsonBytes(next);
  await writeFile(canonical, saved);
  const result = await exportAuthoredDiagram(next, {
    root,
    rasterize() {
      throw new Error('Injected raster failure');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'export-failed');
  assert.deepEqual(await readFile(canonical), saved);
  assert.deepEqual(await snapshot(first.directory), prior);
  good(await verifyAuthoredDiagramExports(bundle, { root }));
});

test('verification rejects another basis, changed renderer and self-consistent substituted SVG', async (t) => {
  const root = await temporaryRoot(t),
    bundle = authoredFixture();
  const first = good(await exportAuthoredDiagram(bundle, { root }));
  const nextBundle = good(
    compileDiagramCommand(
      bundle,
      { type: 'rename', id: 'node-a', label: 'Intake' },
      { transactionId: 'next-snapshot' },
    ),
  ).bundle;
  const next = good(await exportAuthoredDiagram(nextBundle, { root }));
  const manifestPath = join(first.directory, 'manifest.json');
  await replace(manifestPath, jsonBytes(next.manifest));
  assert.equal((await verifyAuthoredDiagramExports(bundle, { root })).ok, false);
  const reordered = structuredClone(first.manifest);
  reordered.renderer = { version: reordered.renderer.version, id: reordered.renderer.id };
  reordered.theme = { version: reordered.theme.version, id: reordered.theme.id };
  await replace(manifestPath, jsonBytes(reordered));
  good(await verifyAuthoredDiagramExports(bundle, { root }));
  const wrongTheme = structuredClone(first.manifest);
  wrongTheme.theme.version = '99.0.0';
  await replace(manifestPath, jsonBytes(wrongTheme));
  assert.equal((await verifyAuthoredDiagramExports(bundle, { root })).code, 'stale-renderer');
  const stale = structuredClone(first.manifest);
  stale.renderer.version = '99.0.0';
  await replace(manifestPath, jsonBytes(stale));
  assert.equal((await verifyAuthoredDiagramExports(bundle, { root })).code, 'stale-renderer');
  const substituted = structuredClone(first.manifest),
    svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  substituted.outputs.find((value) => value.mediaType === 'image/svg+xml').transportDigest =
    digestBytes(svg);
  await replace(join(first.directory, 'diagram.svg'), svg);
  await replace(manifestPath, jsonBytes(substituted));
  assert.equal((await verifyAuthoredDiagramExports(bundle, { root })).code, 'stale-output');
  assert.equal(
    (await exportAuthoredDiagram(bundle, { root })).ok,
    false,
    'Unowned changed bytes are never replaced',
  );
});

test('path escape, symlink directories, linked members and unowned collisions fail closed', async (t) => {
  const root = await temporaryRoot(t),
    outside = await temporaryRoot(t),
    bundle = authoredFixture();
  assert.equal((await exportAuthoredDiagram(bundle, { root, slug: '../escape' })).ok, false);
  await symlink(outside, join(root, 'diagrams'));
  assert.equal((await exportAuthoredDiagram(bundle, { root })).ok, false);
  assert.deepEqual(await readdir(outside), []);
  await unlinkForTest(join(root, 'diagrams'));
  const first = good(await exportAuthoredDiagram(bundle, { root }));
  await link(join(first.directory, 'diagram.svg'), join(outside, 'linked.svg'));
  assert.equal((await verifyAuthoredDiagramExports(bundle, { root })).ok, false);
  await unlinkForTest(join(outside, 'linked.svg'));
  await writeFile(join(first.directory, 'unowned.txt'), 'keep me');
  assert.equal((await exportAuthoredDiagram(bundle, { root })).code, 'unowned-collision');
  assert.equal(await readFile(join(first.directory, 'unowned.txt'), 'utf8'), 'keep me');
});
async function unlinkForTest(path) {
  await rm(path);
}

test('exports isolate caller mutation while rasterization is pending', async (t) => {
  const root = await temporaryRoot(t),
    bundle = authoredFixture(),
    expected = structuredClone(bundle);
  const result = good(
    await exportAuthoredDiagram(bundle, {
      root,
      rasterize(svg, options) {
        bundle.document.title = 'Changed by caller during export';
        return renderDiagramPng(svg, options);
      },
    }),
  );
  assert.deepEqual(result.manifest.basis.bundleDigest, expected.bundleDigest);
  assert.deepEqual(
    await readFile(join(result.directory, 'snapshot.planr-diagram-bundle.json')),
    jsonBytes(expected),
  );
  good(await verifyAuthoredDiagramExports(expected, { root }));
});

test('an interrupted exporter lock fails closed until explicitly recovered', async (t) => {
  const basisRoot = await temporaryRoot(t),
    root = await temporaryRoot(t),
    bundle = authoredFixture();
  const completed = good(await exportAuthoredDiagram(bundle, { root: basisRoot }));
  const configuration = basename(completed.directory);
  const parent = join(root, 'diagrams', bundle.diagramId, 'exports', bundle.bundleDigest.slice(7));
  await mkdir(parent, { recursive: true });
  const lockPath = join(parent, `.${configuration}.lock`);
  await writeFile(lockPath, 'unresolved exporter');
  assert.equal((await exportAuthoredDiagram(bundle, { root })).code, 'exports-busy');
  assert.equal(await readFile(lockPath, 'utf8'), 'unresolved exporter');
  assert.deepEqual(await readdir(parent), [`.${configuration}.lock`]);
  assert.equal((await verifyAuthoredDiagramExports(bundle, { root })).code, 'exports-missing');
});
