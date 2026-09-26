import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('the clean-install gate remains wired to the isolated package proof', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const packageTest = readFileSync(
    join(root, 'tests/ecosystem/operate-v2-development-package.test.mjs'),
    'utf8',
  );

  assert.match(
    packageJson.scripts['test:operate-v2-development'],
    /operate-v2-development-package/,
  );
  assert.match(packageTest, /packOperateV2DevelopmentSnapshot/);
  assert.match(packageTest, /--offline/);
  assert.match(packageTest, /assertPackagedMarkdownLinks/);
  assert.match(packageTest, /checkOperateRuntimePurity/);
});
