import assert from 'node:assert/strict';
import test from 'node:test';
import * as integrations from '../src/index.mjs';
import { IntegrationError, runPortableSync } from '../src/portable-sync.mjs';

test('the portable helper routes Linear to a connector or the openplanr CLI', async () => {
  for (const action of ['inspect', 'sync']) {
    await assert.rejects(
      runPortableSync(['linear', action, '--apply'], { stdout: { write() {} } }),
      (error) =>
        error instanceof IntegrationError &&
        error.code === 'E_SYNC_USAGE' &&
        /Linear connector/u.test(error.message) &&
        /planr linear push/u.test(error.message) &&
        /planr linear sync/u.test(error.message),
    );
  }
});

test('the portable helper exposes no Linear transport', () => {
  assert.equal('inspectLinear' in integrations, false);
  assert.equal('executeLinearOperations' in integrations, false);
});
