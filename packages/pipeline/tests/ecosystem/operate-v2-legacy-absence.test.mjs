import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { OPERATE_RUNTIME_CONTRACT_KINDS } from '../../lib/protocol/loader.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('Operate v2 has no legacy contract, migration, fixture, or compatibility export', () => {
  const result = spawnSync(process.execPath, ['conformance/verify-operate-v2-absence.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    contracts: OPERATE_RUNTIME_CONTRACT_KINDS.length,
    removedPaths: 34,
  });
});
