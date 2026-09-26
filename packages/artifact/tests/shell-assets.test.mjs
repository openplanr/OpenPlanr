import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { ARTIFACT_SHELL_ASSET_PATHS } from '../lib/artifact/ui/shell.mjs';
import {
  ARTIFACT_SHELL_ASSET_BUDGETS,
  ARTIFACT_SHELL_BUNDLE_BANNER,
  renderArtifactShellAssets,
} from '../scripts/generate-artifact-shell.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = renderArtifactShellAssets();
const manifest = JSON.parse(assets[ARTIFACT_SHELL_ASSET_PATHS.manifest]);
const bundlePaths = manifest.assets.map(({ path }) => path).filter((path) => path.endsWith('.js'));

test('the committed shell asset manifest matches the rendered assets', () => {
  assert.equal(
    readFileSync(join(root, ARTIFACT_SHELL_ASSET_PATHS.manifest), 'utf8'),
    assets[ARTIFACT_SHELL_ASSET_PATHS.manifest],
    'artifact-shell-assets.json is stale; run npm run generate',
  );
});

test('every shell asset carries a budget and stays within it, raw and gzip', () => {
  assert.deepEqual(
    Object.keys(ARTIFACT_SHELL_ASSET_BUDGETS).sort(),
    manifest.assets.map(({ path }) => path),
    'each manifest asset has exactly one budget',
  );
  for (const record of manifest.assets) {
    const bytes = Buffer.from(assets[record.path], 'utf8');
    const gzipBytes = gzipSync(bytes, { level: 9 }).byteLength;
    assert.equal(record.bytes, bytes.byteLength, `${record.path} records its raw size`);
    assert.deepEqual(record.budget, ARTIFACT_SHELL_ASSET_BUDGETS[record.path]);
    assert.ok(
      bytes.byteLength <= record.budget.bytes,
      `${record.path} is ${bytes.byteLength} bytes raw, over its ${record.budget.bytes} byte budget`,
    );
    assert.ok(
      gzipBytes <= record.budget.gzipBytes,
      `${record.path} is ${gzipBytes} bytes gzipped, over its ${record.budget.gzipBytes} byte budget`,
    );
  }
});

test('browser bundles name their generator and keep third-party license headers', () => {
  assert.equal(bundlePaths.length, 4);
  for (const path of bundlePaths) {
    assert.ok(
      assets[path].startsWith(`${ARTIFACT_SHELL_BUNDLE_BANNER}\n`),
      `${path} starts with the generator banner`,
    );
    assert.doesNotMatch(assets[path], /\/Users\//, `${path} carries no machine paths`);
  }
  assert.match(
    assets['templates/design/design-board-adapter.js'],
    /^\s*\/\*! pako 2\.1\.0 https:\/\/github\.com\/nodeca\/pako @license \(MIT AND Zlib\) \*\/$/m,
    'the pako license header travels inside the bundle',
  );
});
