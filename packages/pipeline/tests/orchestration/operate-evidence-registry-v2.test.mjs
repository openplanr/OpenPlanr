import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
  createOperateEvidenceRegistryV2,
  dispatchOperateEvidenceResolverV2,
  findOperateEvidenceProviderRegistrationV2,
  findOperateEvidenceResolverRegistrationV2,
  prepareOperateEvidenceDispatchV2,
} from 'planr-pipeline/operate/evidence-v2';

const fixture = (name) => JSON.parse(readFileSync(
  new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
  'utf8',
));
const clone = (value) => structuredClone(value);

function setPath(value, path, next) {
  const parts = path.split('.');
  const leaf = parts.pop();
  const parent = parts.reduce((current, part) => current[part], value);
  parent[leaf] = next;
}

test('evidence registrations are deterministic explicit built-ins with exact versions', () => {
  const valid = fixture('evidence-registry-valid.json');
  const registry = createOperateEvidenceRegistryV2(valid);
  assert.deepEqual(registry, createOperateEvidenceRegistryV2({
    providers: [...valid.providers].reverse(),
    resolvers: [...valid.resolvers].reverse(),
  }));
  assert.equal(Object.isFrozen(registry), true);
  assert.equal(OPEN_REFERENCE_EVIDENCE_REGISTRY_V2.providers.length, 4);
  assert.equal(OPEN_REFERENCE_EVIDENCE_REGISTRY_V2.resolvers.length, 4);
  const planrResolver = OPEN_REFERENCE_EVIDENCE_REGISTRY_V2.resolvers.find(({ resolverId }) => (
    resolverId === 'local-planr-evidence-resolver'
  ));
  assert.ok(planrResolver.errorCodes.includes('EVIDENCE_SOURCE_SCOPE_MISMATCH'),
    'the Planr resolver advertises the same precise scope failure it can return');
  assert.deepEqual(
    findOperateEvidenceProviderRegistrationV2(registry, 'local-git-evidence-provider', { providerVersion: '2.0.0' }),
    valid.providers.find(({ providerId }) => providerId === 'local-git-evidence-provider'),
  );
  assert.deepEqual(
    findOperateEvidenceResolverRegistrationV2(registry, 'local-git-evidence-resolver', { resolverVersion: '2.0.0' }),
    valid.resolvers.find(({ resolverId }) => resolverId === 'local-git-evidence-resolver'),
  );
  assert.equal(findOperateEvidenceProviderRegistrationV2(registry, 'missing-provider', { providerVersion: '2.0.0' }), null);
  assert.equal(findOperateEvidenceResolverRegistrationV2(registry, 'missing-resolver', { resolverVersion: '2.0.0' }), null);
  assert.throws(() => findOperateEvidenceProviderRegistrationV2(registry, 'local-git-evidence-provider'), {
    code: 'E_EVIDENCE_VERSION_REQUIRED',
  });
  assert.throws(() => findOperateEvidenceResolverRegistrationV2(registry, 'local-git-evidence-resolver'), {
    code: 'E_EVIDENCE_VERSION_REQUIRED',
  });
});

test('dispatch preparation checks scope, kind, exact registrations, and runtime-held capabilities', () => {
  const valid = fixture('evidence-registry-valid.json');
  const registry = createOperateEvidenceRegistryV2(valid);
  const prepared = prepareOperateEvidenceDispatchV2(registry, valid.candidate, {
    scope: valid.scope,
    capabilities: valid.capabilities,
  });
  assert.equal(prepared.status, 'authorized');
  assert.equal(prepared.provider.providerId, 'local-git-evidence-provider');
  assert.equal(prepared.resolver.resolverId, 'local-git-evidence-resolver');

  const unavailable = dispatchOperateEvidenceResolverV2(registry, valid.candidate, {
    scope: valid.scope,
    capabilities: valid.capabilities,
  });
  assert.deepEqual(unavailable, {
    status: 'unavailable',
    provider: prepared.provider,
    resolver: prepared.resolver,
    error: {
      code: 'EVIDENCE_RESOLVER_UNAVAILABLE',
      retryable: true,
      context: { evidenceKind: 'git', resolverId: 'local-git-evidence-resolver' },
    },
  });

  const missingCapability = prepareOperateEvidenceDispatchV2(registry, valid.candidate, {
    scope: valid.scope,
    capabilities: [],
  });
  assert.deepEqual(missingCapability, {
    status: 'rejected', provider: null, resolver: null,
    error: {
      code: 'CAPABILITY_DENIED', retryable: false,
      context: { evidenceKind: 'git', resolverId: 'local-git-evidence-resolver' },
    },
  });

  const scopeMismatch = prepareOperateEvidenceDispatchV2(registry, valid.candidate, {
    scope: { ...valid.scope, scopeId: 'other-scope' },
    capabilities: valid.capabilities,
  });
  assert.equal(scopeMismatch.error.code, 'EVIDENCE_SOURCE_SCOPE_MISMATCH');

  const unknownResolver = clone(valid.candidate);
  unknownResolver.resolver.id = fixture('evidence-registry-invalid.json').unknownResolver;
  assert.equal(prepareOperateEvidenceDispatchV2(registry, unknownResolver, {
    scope: valid.scope, capabilities: valid.capabilities,
  }).error.code, 'EVIDENCE_RESOLVER_UNREGISTERED');

  const unsupportedVersion = clone(valid.candidate);
  unsupportedVersion.resolver.version = fixture('evidence-registry-invalid.json').unsupportedResolverVersion;
  assert.equal(prepareOperateEvidenceDispatchV2(registry, unsupportedVersion, {
    scope: valid.scope, capabilities: valid.capabilities,
  }).error.code, 'EVIDENCE_RESOLVER_VERSION_UNSUPPORTED');

  const kindMismatch = clone(valid.candidate);
  kindMismatch.provider = { id: 'local-filesystem-evidence-provider', version: '2.0.0' };
  assert.equal(prepareOperateEvidenceDispatchV2(registry, kindMismatch, {
    scope: valid.scope, capabilities: valid.capabilities,
  }).error.code, 'UNSUPPORTED_EVIDENCE_KIND');
});

test('duplicate, dynamic, non-built-in, or authority-bearing registrations fail before dispatch', () => {
  const valid = fixture('evidence-registry-valid.json');
  const invalid = fixture('evidence-registry-invalid.json');

  for (const field of [invalid.duplicateProvider, invalid.duplicateResolver]) {
    const candidate = clone(valid);
    candidate[field].push(clone(candidate[field][0]));
    assert.throws(() => createOperateEvidenceRegistryV2(candidate), {
      code: 'E_EVIDENCE_REGISTRATION_CONFLICT',
    });
  }

  for (const descriptor of [invalid.unknownBuiltIn, invalid.dynamicModule, invalid.wrongCapability, invalid.wrongEffect]) {
    const candidate = clone(valid);
    setPath(candidate, descriptor.target, descriptor.value);
    assert.throws(() => createOperateEvidenceRegistryV2(candidate), (error) => (
      error?.code === 'E_EVIDENCE_REGISTRATION_INVALID' || error?.code === 'E_PROTOCOL_ARTIFACT_INVALID'
    ));
  }

  const source = readFileSync(new URL('../../lib/operate/evidence-v2.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /node:fs|node:child_process|fetch\(|import\(|require\(|spawn\(|exec\(/u);
});
