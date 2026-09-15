import assert from 'node:assert/strict';
import test from 'node:test';
import { executeLinearOperations, IntegrationError } from '../src/portable-sync.mjs';

const operation = [{ action: 'create', teamId: 'team-1', title: 'Create review' }];

async function withFetch(implementation, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try {
    return await callback();
  } finally {
    globalThis.fetch = original;
  }
}

test('Linear mutation requires explicit success and complete issue custody', async () => {
  for (const payload of [
    { data: { issueCreate: { success: false, issue: null } } },
    { data: { issueCreate: { success: true, issue: { id: 'one' } } } },
  ]) {
    await assert.rejects(
      withFetch(
        async () => ({ ok: true, status: 200, json: async () => payload }),
        async () => executeLinearOperations(operation, { token: 'fixture', apply: true }),
      ),
      (error) => error instanceof IntegrationError && error.code === 'E_LINEAR_API',
    );
  }
});

test('Linear transport and malformed JSON failures remain typed and closed', async () => {
  for (const fetchImpl of [
    async () => {
      throw new Error('network down');
    },
    async () => ({ ok: true, status: 200, json: async () => {
      throw new SyntaxError('invalid json');
    } }),
  ]) {
    await assert.rejects(
      withFetch(fetchImpl, async () =>
        executeLinearOperations(operation, { token: 'fixture', apply: true }),
      ),
      (error) => error instanceof IntegrationError && error.code === 'E_LINEAR_API',
    );
  }
});

test('Linear mutation returns only an explicitly confirmed issue', async () => {
  const result = await withFetch(
    async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          issueCreate: {
            success: true,
            issue: { id: 'uuid', identifier: 'ACME-1', url: 'https://linear.app/acme/issue/ACME-1' },
          },
        },
      }),
    }),
    async () => executeLinearOperations(operation, { token: 'fixture', apply: true }),
  );
  assert.deepEqual(result, {
    provider: 'linear',
    applied: true,
    results: [
      {
        action: 'create',
        id: 'uuid',
        identifier: 'ACME-1',
        url: 'https://linear.app/acme/issue/ACME-1',
      },
    ],
  });
});
