/**
 * How design-loop variant files become board artifacts: intrinsic image sizing, the file each
 * variant letter shows, and the image document the board frames for each variant.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { parse } from 'parse5';

import {
  createDesignBoardArtifactEnvelope,
  discoverVariants,
  imageDimensions,
} from '../../lib/design-engine/artifact-adapter.mjs';

const dirs = [];
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'planr-board-variants-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

/** The 24 leading bytes of a PNG: signature plus the IHDR width and height. */
function pngHeader(width, height) {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(0x89504e47, 0);
  bytes.writeUInt32BE(0x0d0a1a0a, 4);
  bytes.writeUInt32BE(0x0d, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const planrAnchors = (html) =>
  [...html.matchAll(/data-planr-id="([^"]+)"/g)].map((match) => match[1]);

function elements(node, found = []) {
  if (node.tagName) found.push(node);
  for (const child of node.childNodes ?? []) elements(child, found);
  return found;
}

test('imageDimensions reads an SVG viewBox, a PNG IHDR, and falls back', () => {
  const dir = tmp();
  writeFileSync(
    join(dir, 'a.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"></svg>',
  );
  assert.deepEqual(imageDimensions(join(dir, 'a.svg')), { width: 800, height: 600 });

  writeFileSync(join(dir, 'b.png'), pngHeader(5, 3));
  assert.deepEqual(imageDimensions(join(dir, 'b.png')), { width: 5, height: 3 });

  // an SVG with neither viewBox nor width/height → desktop fallback frame
  writeFileSync(join(dir, 'c.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert.deepEqual(imageDimensions(join(dir, 'c.svg')), { width: 1440, height: 1024 });
});

test('each image variant is one board artifact that shows the image itself at its own size', async () => {
  const dir = tmp();
  const png = pngHeader(1536, 1024);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"></svg>';
  writeFileSync(join(dir, 'variant-A.png'), png);
  writeFileSync(join(dir, 'variant-B.svg'), svg);

  const envelope = await createDesignBoardArtifactEnvelope({ sessionDir: dir, mode: 'loop' });

  assert.deepEqual(
    envelope.artifacts.map(({ id, viewport }) => [id, viewport]),
    [
      ['A', { width: 1536, height: 1024 }],
      ['B', { width: 800, height: 600 }],
    ],
    'each frame takes the image size, not a fixed canvas viewport',
  );
  const [a, b] = envelope.artifacts;
  assert.ok(
    a.html.includes(
      `<img data-planr-id="design-variant-A" src="data:image/png;base64,${png.toString('base64')}"`,
    ),
    'variant A shows the exact PNG bytes under its per-variant anchor',
  );
  assert.ok(
    b.html.includes(
      `<img data-planr-id="design-variant-B" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"`,
    ),
    'variant B shows the exact SVG bytes under its per-variant anchor',
  );
  for (const { id, html } of envelope.artifacts) {
    assert.doesNotMatch(html, /<script/i, `variant ${id} carries no script runtime`);
    assert.doesNotMatch(html, /vendor\//, `variant ${id} loads nothing from a vendor directory`);
  }
});

test('a hostile variant title reaches the image document as text only', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'variant-A.png'), pngHeader(10, 10));
  const title = 'evil </title><script>alert(1)</script><img src=x onerror=alert(1)>';

  const envelope = await createDesignBoardArtifactEnvelope({
    sessionDir: dir,
    mode: 'loop',
    variants: [{ id: 'A', label: title, src: 'variant-A.png', type: 'image' }],
  });

  const found = elements(parse(envelope.artifacts[0].html));
  assert.equal(found.filter((node) => node.tagName === 'script').length, 0, 'no script element');
  const images = found.filter((node) => node.tagName === 'img');
  assert.equal(images.length, 1, 'the title adds no element');
  assert.equal(images[0].attrs.find(({ name }) => name === 'alt')?.value, title);
  const titleElement = found.find((node) => node.tagName === 'title');
  assert.deepEqual(
    titleElement.childNodes.map((node) => node.value),
    [title],
    'the document title is the escaped text',
  );
});

test('each variant keeps one stable anchor when its image is replaced in place', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'variant-A.png'), pngHeader(1024, 1024));
  writeFileSync(join(dir, 'variant-B.png'), pngHeader(1536, 1024));
  const first = await createDesignBoardArtifactEnvelope({ sessionDir: dir, mode: 'loop' });

  writeFileSync(join(dir, 'variant-A.png'), pngHeader(1024, 1536));
  const second = await createDesignBoardArtifactEnvelope({ sessionDir: dir, mode: 'loop' });

  const anchors = (envelope) => envelope.artifacts.map(({ html }) => planrAnchors(html));
  assert.deepEqual(anchors(first), [['design-variant-A'], ['design-variant-B']]);
  assert.deepEqual(anchors(second), anchors(first), 'pins stay on the same variant');
  assert.notEqual(second.artifacts[0].sha256, first.artifacts[0].sha256, 'the new image is shown');
  assert.deepEqual(second.artifacts[0].viewport, { width: 1024, height: 1536 });
  assert.equal(second.artifacts[1].sha256, first.artifacts[1].sha256, 'variant B is unchanged');
});

test('discoverVariants keeps one entry per letter: HTML, then SVG, then PNG', () => {
  // A has both an image and an HTML design → the HTML; B is png-only, C is svg-only
  const variants = discoverVariants([
    'variant-A.svg',
    'variant-A.html',
    'variant-B.png',
    'variant-C.svg',
    'noise.txt',
  ]);
  assert.deepEqual(
    variants.map((v) => `${v.id}:${v.type}`),
    ['A:html', 'B:image', 'C:svg'],
  );
  // exactly one entry per letter (no duplicate A from the .svg sibling)
  assert.equal(variants.filter((v) => v.id === 'A').length, 1);
  assert.equal(variants.find((v) => v.id === 'A').src, 'variant-A.html');
});
