import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkPackageBoundaries } from '../../../scripts/domains/boundary-check.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('Operate imports only protocol and Node built-ins', () => {
  assert.deepEqual(
    checkPackageBoundaries(packageRoot, {
      sourceDirectories: ['lib'],
      allowedBare: [/^node:/u, /^@openplanr\/protocol(?:\/|$)/u],
    }),
    [],
  );
});
