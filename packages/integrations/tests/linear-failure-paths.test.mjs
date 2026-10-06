import assert from 'node:assert/strict';
import test from 'node:test';
import * as integrations from '../src/index.mjs';
import { IntegrationError, runPortableSync } from '../src/portable-sync.mjs';

test("the portable helper routes Linear to the host's Linear connection", async () => {
  for (const action of ['inspect', 'sync']) {
    await assert.rejects(
      runPortableSync(['linear', action, '--apply'], { stdout: { write() {} } }),
      (error) =>
        error instanceof IntegrationError &&
        error.code === 'E_SYNC_USAGE' &&
        /host's Linear connection/u.test(error.message) &&
        !/planr linear/u.test(error.message),
    );
  }
});

test('the portable helper exposes no Linear transport', () => {
  assert.equal('inspectLinear' in integrations, false);
  assert.equal('executeLinearOperations' in integrations, false);
});
