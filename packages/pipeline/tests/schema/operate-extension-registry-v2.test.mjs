import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  OPERATE_EXTENSION_CONTRACT_KINDS_V2,
  assertProtocolArtifact,
  loadOperateExtensionContract,
} from 'planr-pipeline/protocol';
import {
  DEFERRED_OPERATE_EXTENSION_KINDS_V2,
  OPEN_REFERENCE_OPERATE_EXTENSIONS_V2,
  createOperateExtensionRegistryV2,
  findOperateMetricProviderRegistrationV2,
  findOperateSnapshotProviderRegistrationV2,
  findOperateVerificationProviderRegistrationV2,
  findOperateDomainRegistrationV2,
} from 'planr-pipeline/operate/extensions-v2';
import {
  findOperateCapabilityProviderRegistrationV2,
  findOperateExecutorRegistrationV2,
  findOperatePolicyProviderRegistrationV2,
} from 'planr-pipeline/operate/governed-extensions-v2';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
const clone = (value) => structuredClone(value);
const patchFixtureTarget = (value, descriptor) => {
  const patched = clone(value);
  const segments = descriptor.target.split('.');
  const key = segments.pop();
  let cursor = patched;
  for (const segment of segments) cursor = cursor[segment];
  cursor[key] = descriptor.value;
  return patched;
};

const phase5DomainRegistration = (name) => {
  const registration = fixture(name);
  registration.policyRequirements = [];
  return registration;
};
const business = () => phase5DomainRegistration('business-domain-valid.json');
const software = () => phase5DomainRegistration('software-domain-valid.json');

test('only the compiler-owned extension declarations are public and exact-v2', () => {
  assert.deepEqual(OPERATE_EXTENSION_CONTRACT_KINDS_V2, [
    'agent-runtime-manifest',
    'operate-capability-provider-registration',
    'operate-domain-registration',
    'operate-evidence-provider-registration',
    'operate-evidence-resolver-registration',
    'operate-executor-registration',
    'operate-live-evidence-provider-registration',
    'operate-live-evidence-provider-registry',
    'operate-metric-provider-registration',
    'operate-policy-provider-registration',
    'operate-snapshot-provider-registration',
    'operate-verification-provider-registration',
  ]);
  for (const kind of OPERATE_EXTENSION_CONTRACT_KINDS_V2) {
    const contract = loadOperateExtensionContract(kind, { protocolVersion: '2.0.0' });
    assert.deepEqual(contract.schema['x-openplanr-contract'], { id: kind, version: '2.0.0' });
    assert.throws(() => loadOperateExtensionContract(kind), { code: 'E_SCHEMA_VERSION_REQUIRED' });
  }
  assert.deepEqual(DEFERRED_OPERATE_EXTENSION_KINDS_V2, []);
});

test('governed-execution extensions remain closed data-only registrations', () => {
  const extensions = fixture('extensions-valid.json');
  const invalid = fixture('extensions-invalid.json');
  const registrations = extensions.governedExecutionRegistrations;
  const entries = [
    ['operate-capability-provider-registration', registrations.capabilityProviders[0]],
    ['operate-policy-provider-registration', registrations.policyProviders[0]],
    ['operate-executor-registration', registrations.executors[0]],
  ];
  for (const [kind, registration] of entries) {
    assert.ok(assertProtocolArtifact(kind, registration, { protocolVersion: '2.0.0' }));
  }

  const unsafe = [
    [
      'operate-capability-provider-registration',
      'capabilityProviderCredential',
      'capabilityProviders',
    ],
    ['operate-policy-provider-registration', 'policyProviderDecision', 'policyProviders'],
    ['operate-executor-registration', 'executorEffectWidening', 'executors'],
    ['operate-executor-registration', 'executorConnector', 'executors'],
    ['operate-executor-registration', 'executorFallbackSubstitution', 'executors'],
  ];
  for (const [kind, descriptorName, collection] of unsafe) {
    const patched = patchFixtureTarget(extensions, invalid[descriptorName]);
    assert.throws(
      () =>
        assertProtocolArtifact(kind, patched.governedExecutionRegistrations[collection][0], {
          protocolVersion: '2.0.0',
        }),
      { code: 'E_PROTOCOL_ARTIFACT_INVALID' },
    );
  }
});

test('public registry is deterministic and contains only exact public domains and closed built-ins', () => {
  const registry = createOperateExtensionRegistryV2({
    domains: [software(), fixture('business-domain-valid.json')],
  });
  assert.deepEqual(registry, OPEN_REFERENCE_OPERATE_EXTENSIONS_V2);
  assert.equal(Object.isFrozen(registry), true);
  assert.deepEqual(
    registry.domains.map(({ domainId, domainVersion, domainContract }) => ({
      domainId,
      domainVersion,
      domainContract,
    })),
    [
      {
        domainId: 'business',
        domainVersion: '1.0.0',
        domainContract: { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' },
      },
      {
        domainId: 'software',
        domainVersion: '1.0.0',
        domainContract: { apiDomainId: 'software', id: 'software-domain', version: '1.0.0' },
      },
    ],
  );
  assert.equal(
    findOperateDomainRegistrationV2(registry, 'reference-domain', { domainVersion: '1.0.0' }),
    null,
  );
  assert.equal(
    findOperateDomainRegistrationV2(registry, 'business', { domainVersion: '1.0.0' })
      ?.domainContract.id,
    'business-domain',
  );
  assert.equal(
    findOperateSnapshotProviderRegistrationV2(registry, 'open-reference-snapshot-provider', {
      providerVersion: '1.0.0',
    })?.implementation.id,
    'open-reference-snapshot-provider-v2',
  );
  assert.equal(
    findOperateMetricProviderRegistrationV2(registry, 'open-reference-metric-provider', {
      providerVersion: '1.0.0',
    })?.implementation.id,
    'open-reference-metric-provider-v2',
  );
  assert.equal(
    findOperateVerificationProviderRegistrationV2(
      registry,
      'open-reference-verification-provider',
      { providerVersion: '1.0.0' },
    )?.implementation.id,
    'open-reference-verification-provider-v2',
  );
  assert.equal(registry.snapshotProviders.length, 1);
  assert.equal(registry.metricProviders.length, 1);
  assert.equal(registry.verificationProviders.length, 1);
  assert.equal(registry.capabilityProviders.length, 1);
  assert.equal(registry.policyProviders.length, 1);
  assert.equal(registry.executors.length, 2);
  const governedRegistry = {
    capabilityProviders: registry.capabilityProviders,
    policyProviders: registry.policyProviders,
    executors: registry.executors,
  };
  assert.equal(
    findOperateCapabilityProviderRegistrationV2(
      governedRegistry,
      'open-reference-capability-provider',
      { providerVersion: '1.0.0' },
    )?.effectCeiling,
    'project-write',
  );
  assert.equal(
    findOperatePolicyProviderRegistrationV2(governedRegistry, 'open-reference-policy-provider', {
      providerVersion: '1.0.0',
    })?.narrowingOnly,
    true,
  );
  assert.equal(
    findOperateExecutorRegistrationV2(governedRegistry, 'open-reference-project-executor', {
      executorVersion: '1.0.0',
    })?.implementation.id,
    'open-reference-project-executor-v2',
  );
  assert.equal(
    findOperateExecutorRegistrationV2(governedRegistry, 'open-reference-containment-executor', {
      executorVersion: '1.0.0',
    })?.implementation.id,
    'open-reference-containment-executor-v2',
  );
});

test('invalid, authority-bearing, cross-domain, and implicit domain declarations fail closed before a registry exists', () => {
  const invalid = phase5DomainRegistration('operating-domain-invalid.json');
  assert.ok(
    assertProtocolArtifact('operate-domain-registration', business(), { protocolVersion: '2.0.0' }),
  );
  assert.throws(() => createOperateExtensionRegistryV2({ domains: [invalid, software()] }), {
    code: 'E_PROTOCOL_ARTIFACT_INVALID',
  });
  const path = business();
  path.projectionContracts[0].module = './unsafe.mjs';
  assert.throws(() => createOperateExtensionRegistryV2({ domains: [path, software()] }), {
    code: 'E_EXTENSION_REGISTRATION_INVALID',
  });
  const authority = business();
  authority.requestedCapabilities = [
    { id: 'execute-work', version: '1.0.0', reason: 'Run an executor.' },
  ];
  assert.throws(() => createOperateExtensionRegistryV2({ domains: [authority, software()] }), {
    code: 'E_EXTENSION_REGISTRATION_INVALID',
  });
  const mismatched = business();
  mismatched.domainContract.id = 'software-domain';
  assert.throws(() => createOperateExtensionRegistryV2({ domains: [mismatched, software()] }), {
    code: 'E_PROTOCOL_ARTIFACT_INVALID',
  });
  assert.throws(() => createOperateExtensionRegistryV2({ domains: [business()] }), {
    code: 'E_EXTENSION_REGISTRATION_INVALID',
  });
});

test('an explicitly enabled synthetic conformance domain uses the same data-only shape without acquiring a provider or authority', () => {
  const synthetic = clone(business());
  synthetic.domainId = 'synthetic-domain';
  synthetic.domainContract = {
    apiDomainId: 'synthetic-domain',
    id: 'synthetic-domain-domain',
    version: '1.0.0',
  };
  synthetic.projectionContracts = [
    { schemaId: 'operating-domain-projection', schemaVersion: '2.0.0' },
  ];
  synthetic.actionKinds = [{ id: 'synthetic-operating-hypothesis', version: '1.0.0' }];
  const registry = createOperateExtensionRegistryV2({
    domains: [business(), software(), synthetic],
    allowSyntheticDomains: true,
  });
  assert.equal(
    findOperateDomainRegistrationV2(registry, 'synthetic-domain', { domainVersion: '1.0.0' })
      ?.requestedCapabilities.length,
    0,
  );
  assert.throws(
    () => createOperateExtensionRegistryV2({ domains: [business(), software(), synthetic] }),
    {
      code: 'E_EXTENSION_REGISTRATION_INVALID',
    },
  );
});
