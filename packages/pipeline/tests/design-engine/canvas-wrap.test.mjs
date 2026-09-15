/**
 * canvas-wrap unit tests — the loop-variant → DesignCanvas wrapper.
 *
 * Covers the pure helpers that let a design-loop variant render on the SAME
 * pannable canvas as design-review: intrinsic image sizing, the single-artboard
 * canvas data (with a per-variant `data-dc-slot` id), the script-safe shell
 * injection, and the prefer-canvas-else-degrade board discovery.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import {
  imageDimensions, buildImageCanvasData, wrapInCanvas, discoverVariants,
} from '../../lib/design-engine/canvas-wrap.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHELL = readFileSync(join(ROOT, 'templates', 'design', 'canvas-shell.html'), 'utf8');
const CANVAS_SOURCE = readFileSync(join(ROOT, 'templates', 'design', 'DesignCanvas.jsx'), 'utf8');
const CANVAS_RUNTIME = readFileSync(join(ROOT, 'templates', 'design', 'vendor', 'DesignCanvas.js'), 'utf8');

test('imageDimensions reads an SVG viewBox, a PNG IHDR, and falls back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-dim-'));
  writeFileSync(join(dir, 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"></svg>');
  assert.deepEqual(imageDimensions(join(dir, 'a.svg')), { width: 800, height: 600 });

  // a minimal 5×3 PNG: signature + IHDR length/type + width(5) + height(3)
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // signature
    Buffer.from([0x00, 0x00, 0x00, 0x0d]), Buffer.from('IHDR'),    // IHDR chunk header
    Buffer.from([0x00, 0x00, 0x00, 0x05]), Buffer.from([0x00, 0x00, 0x00, 0x03]), // W=5 H=3
  ]);
  writeFileSync(join(dir, 'b.png'), png);
  assert.deepEqual(imageDimensions(join(dir, 'b.png')), { width: 5, height: 3 });

  // an SVG with neither viewBox nor width/height → desktop fallback frame
  writeFileSync(join(dir, 'c.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert.deepEqual(imageDimensions(join(dir, 'c.svg')), { width: 1440, height: 1024 });
});

test('buildImageCanvasData makes one artboard whose slot id is the variant letter', () => {
  const data = buildImageCanvasData({ variantId: 'B', label: 'Hero', src: 'variant-B.svg', width: 800, height: 600 });
  assert.equal(data.sections.length, 1);
  const art = data.sections[0].artboards[0];
  assert.equal(art.id, 'B', 'the artboard id (data-dc-slot anchor) is the variant letter');
  assert.equal(art.width, 800);
  assert.equal(art.height, 600);
  assert.match(art.html, /src="variant-B\.svg"/, 'the artboard embeds the source image');
});

test('wrapInCanvas injects the data + neutralizes a </script> breakout (embedJson)', () => {
  // a hostile label that would break out of the inline <script> if hand-concatenated
  const data = buildImageCanvasData({
    variantId: 'A', label: 'evil </script><img src=x onerror=alert(1)>', src: 'variant-A.svg', width: 10, height: 10,
  });
  const html = wrapInCanvas({ shellHtml: SHELL, data, title: 'loop' });

  assert.ok(!html.includes('/* GENERATOR:data */ { sections: [] }'), 'the data marker is replaced');
  assert.ok(!html.includes('</script><img src=x onerror=alert(1)>'), 'no live </script> breakout survives');
  assert.ok(html.includes('\\u003c'), 'angle brackets are \\u-escaped inside the script');
  assert.ok(html.includes('./vendor/DesignCanvas.js'), 'the canvas references the vendored runtime');
});

test('DesignCanvas emits stable unique Planr anchors without replacing legacy canvas attributes', () => {
  assert.match(CANVAS_SOURCE, /data-dc-slot=\{id\}/, 'legacy artboard slot stays declarative');
  assert.match(CANVAS_SOURCE, /data-dc-section=\{sid\}/, 'legacy section marker stays declarative');
  assert.match(CANVAS_SOURCE, /data-planr-id=\{focused \? undefined : planrAnchorId\}/,
    'the background artboard yields its anchor while its focus copy is mounted');
  assert.match(CANVAS_SOURCE, /data-planr-id=\{planrAnchorId\} data-planr-screen=\{String\(sectionId\)\}/,
    'the focus copy carries the same stable id and screen');

  assert.match(CANVAS_RUNTIME, /"data-dc-slot"/);
  assert.match(CANVAS_RUNTIME, /"data-dc-section"/);
  assert.match(CANVAS_RUNTIME, /"data-planr-id"/);
  assert.match(CANVAS_RUNTIME, /"data-planr-screen"/);

  const runtimeWindow = {};
  runInNewContext(CANVAS_RUNTIME, {
    window: runtimeWindow,
    React: { createContext: () => ({}) },
  });
  const anchorId = runtimeWindow.DCPlanrAnchorId;
  assert.equal(typeof anchorId, 'function', 'compiled runtime exports its deterministic anchor helper');

  const checkout = anchorId('Checkout flow', 'Desktop:A');
  assert.equal(checkout, anchorId('Checkout flow', 'Desktop:A'), 'the same artboard is stable');
  assert.match(checkout, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'the bridge can resolve the generated id');
  assert.notEqual(anchorId('a-b', 'c'), anchorId('a', 'b-c'), 'section/artboard boundaries cannot collide');
  assert.notEqual(anchorId('résumé', '桌面'), anchorId('resume', '桌面'), 'Unicode identities remain distinct');
  assert.ok(anchorId('s'.repeat(900), 'a'.repeat(900)).length <= 512, 'pathological ids remain bridge-bounded');
});

test('discoverVariants prefers the canvas (.html) and degrades to the source image', () => {
  // A has both image + canvas → prefer canvas; B is png-only, C is svg-only → degrade
  const variants = discoverVariants(['variant-A.svg', 'variant-A.html', 'variant-B.png', 'variant-C.svg', 'noise.txt']);
  assert.deepEqual(variants.map((v) => `${v.id}:${v.type}`), ['A:html', 'B:image', 'C:svg']);
  // exactly one entry per letter (no duplicate A from the .svg sibling)
  assert.equal(variants.filter((v) => v.id === 'A').length, 1);
  assert.equal(variants.find((v) => v.id === 'A').src, 'variant-A.html', 'A loads the canvas, not the image');
});
