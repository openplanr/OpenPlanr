import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  DESIGN_STUDIO_ASSET_BUDGETS,
  DESIGN_STUDIO_BUNDLE_BANNER,
  renderDesignStudioAssets,
} from '../scripts/generate-design-studio.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = renderDesignStudioAssets();

test('the generated studio runtime matches its ES module sources', () => {
  for (const [path, bytes] of Object.entries(assets)) {
    assert.equal(
      readFileSync(join(root, path), 'utf8'),
      bytes,
      `${path} is stale; run npm run generate`,
    );
  }
});

test('every studio asset carries a budget and stays within it, raw and gzip', () => {
  assert.deepEqual(
    Object.keys(DESIGN_STUDIO_ASSET_BUDGETS).sort(),
    Object.keys(assets).sort(),
    'each generated asset has exactly one budget',
  );
  for (const [path, text] of Object.entries(assets)) {
    const bytes = Buffer.from(text, 'utf8');
    const gzipBytes = gzipSync(bytes, { level: 9 }).byteLength;
    const budget = DESIGN_STUDIO_ASSET_BUDGETS[path];
    assert.ok(
      bytes.byteLength <= budget.bytes,
      `${path} is ${bytes.byteLength} bytes raw, over its ${budget.bytes} byte budget`,
    );
    assert.ok(
      gzipBytes <= budget.gzipBytes,
      `${path} is ${gzipBytes} bytes gzipped, over its ${budget.gzipBytes} byte budget`,
    );
  }
});

test('the studio runtime names its generator and ships as one strict classic script', () => {
  const runtime = assets['templates/studio/studio.js'];
  assert.ok(runtime.startsWith(`${DESIGN_STUDIO_BUNDLE_BANNER}\n"use strict";\n`));
  assert.doesNotMatch(runtime, /\/Users\//, 'the bundle carries no machine paths');
  assert.doesNotMatch(runtime, /<\/script/iu, 'the bundle can be inlined in a script element');
});
