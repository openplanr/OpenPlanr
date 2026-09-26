import assert from 'node:assert/strict';
import { lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import {
  checkOperateRuntimePurity,
  packOperateV2DevelopmentSnapshot,
} from '../../scripts/check-operate-runtime-purity.mjs';

const packageVersion = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
).version;
const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-operate-v2-product-package-'));

after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

test('product package has complete public assets and no private or workspace custody', {
  timeout: 180_000,
}, () => {
  const purity = checkOperateRuntimePurity();
  assert.equal(purity.ok, true);
  const packed = packOperateV2DevelopmentSnapshot(join(temporaryRoot, 'package'));
  assert.equal(packed.ok, true);
  assert.equal(packed.sourcePurity.ok, true);
  assert.equal(packed.tarballPurity.ok, true);
  const files = new Set(packed.files.map(({ path }) => path));
  for (const path of [
    'conformance/verify-operate-v2-product-experience.mjs',
    'conformance/verify-unified-dashboard-absence.mjs',
    'docs/unified-dashboard-migration.md',
    'lib/dashboard/resolve-packaged-dashboard-root.mjs',
    'lib/dashboard/server.mjs',
  ])
    assert.equal(files.has(path), true, `missing installed product asset: ${path}`);
  for (const entry of packed.files) {
    assert.equal(entry.path.startsWith('.planr/products/'), false, entry.path);
    assert.equal(entry.path.includes('/private/'), false, entry.path);
    assert.equal(entry.path.includes('node_modules/'), false, entry.path);
    assert.equal(entry.path.includes('..'), false, entry.path);
  }
  const archive = lstatSync(packed.tarballPath);
  assert.equal(archive.isFile(), true);
  assert.equal(packed.packageName, 'planr-pipeline');
  assert.equal(packed.version, packageVersion);
});
