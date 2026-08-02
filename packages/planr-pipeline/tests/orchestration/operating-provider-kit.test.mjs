import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runOperatingProviderConformance } from '../../conformance/operating-provider-kit.mjs';
import {
  computeOperatingProviderPolicyDigest,
  validateOperatingProviderPolicyDigest,
} from '../../lib/pipeline/index.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const registry = JSON.parse(readFileSync(join(root, 'registry/operating-providers.json'), 'utf8'));
const definition = registry.providers.find(({ id }) => id === 'repository');
const digest = (character) => `sha256:${character.repeat(64)}`;

function evidence(summary = 'Repository evidence') {
  return {
    kind: 'operating-evidence',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    cycleId: 'CYCLE-001',
    fingerprint: digest('a'),
    collectedAt: '2026-07-28T09:00:00Z',
    truncated: false,
    items: [{
      id: 'EVD-repository',
      source: 'repository',
      location: 'src/payments.mjs',
      digest: digest('b'),
      collectedAt: '2026-07-28T09:00:00Z',
      observedFrom: null,
      observedTo: null,
      freshness: 'fresh',
      sensitivity: 'internal',
      claimTypes: ['code'],
      repository: {
        componentId: 'planr-pipeline',
        canonicalRemote: 'https://github.com/openplanr/planr-pipeline.git',
        revision: '1234567890abcdef1234567890abcdef12345678',
        configuredBranch: 'main',
        dirtyFingerprint: null,
      },
      summary,
    }],
    sources: [{
      id: 'repository',
      fingerprint: digest('c'),
      status: 'collected',
      itemCount: 1,
      byteCount: 512,
    }],
    warnings: [],
  };
}

test('provider conformance accepts deterministic, attributed, budgeted read-only output', async () => {
  const result = await runOperatingProviderConformance({
    definition,
    providerRegistry: registry,
    fixtureContext: { root: '/fixture', cycleId: 'CYCLE-001' },
    collect: async (context) => {
      assert.ok(Object.isFrozen(context));
      return evidence();
    },
  });
  assert.equal(result.ok, true);
  assert.match(result.outputDigest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(result.failures, []);
});

test('provider conformance rejects registry drift and nondeterministic output', async () => {
  const drift = await runOperatingProviderConformance({
    definition: {
      ...definition,
      limits: { ...definition.limits, maxItems: definition.limits.maxItems + 1 },
    },
    providerRegistry: registry,
    fixtureContext: {},
    collect: async () => evidence(),
  });
  assert.equal(drift.ok, false);
  assert.ok(drift.failures.some(({ check }) => check === 'definition'));

  let invocation = 0;
  const nondeterministic = await runOperatingProviderConformance({
    definition,
    providerRegistry: registry,
    fixtureContext: {},
    collect: async () => evidence(`Run ${invocation += 1}`),
  });
  assert.equal(nondeterministic.ok, false);
  assert.ok(nondeterministic.failures.some(({ check }) => check === 'determinism'));
});

test('provider conformance rejects invalid schema and missing source attribution', async () => {
  const result = await runOperatingProviderConformance({
    definition,
    providerRegistry: registry,
    fixtureContext: {},
    collect: async () => ({
      ...evidence(),
      sources: [{
        id: 'git',
        fingerprint: digest('d'),
        status: 'collected',
        itemCount: 1,
        byteCount: 512,
      }],
    }),
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(({ check }) => check.endsWith('-attribution')));
});

test('provider policy digest binds safe endpoint, consent policy, retention, and budgets', () => {
  const manifest = JSON.parse(readFileSync(
    join(root, 'conformance/fixtures/operating-board/provider-manifest.json'),
    'utf8',
  ));
  assert.equal(computeOperatingProviderPolicyDigest(manifest), manifest.policyDigest);
  assert.equal(validateOperatingProviderPolicyDigest(manifest), manifest);

  const drift = structuredClone(manifest);
  drift.limits.maxRequests += 1;
  assert.throws(
    () => validateOperatingProviderPolicyDigest(drift),
    (error) => error.code === 'E_OPERATE_PROVIDER_POLICY_INVALID',
  );
});
