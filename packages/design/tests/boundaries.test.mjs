import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkPackageBoundaries } from '../../../scripts/domains/boundary-check.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('Design imports only artifact, protocol, and Node built-ins', () => {
  assert.deepEqual(
    checkPackageBoundaries(packageRoot, {
      sourceDirectories: ['lib'],
      allowedBare: [/^node:/u, /^@openplanr\/artifact(?:\/|$)/u, /^@openplanr\/protocol(?:\/|$)/u],
    }),
    [],
  );
});
