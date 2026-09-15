import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  assertProtocolArtifact,
  validateProtocolArtifact,
} from 'planr-pipeline/protocol';
import {
  canonicalizeOperateExtensionRegistryV2,
  createOperateExtensionRegistryV2,
} from 'planr-pipeline/operate/extensions-v2';

const fixture = (name) => JSON.parse(readFileSync(
  new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
  'utf8',
));
const clone = (value) => structuredClone(value);

const business = () => fixture('business-domain-valid.json');
const software = () => fixture('software-domain-valid.json');
const runtimeDomain = (registration) => {
  const value = clone(registration);
  delete value.policyRequirements;
  return value;
};

test('public domain-registration fixtures require exact API bindings and their own projection identity', () => {
  for (const registration of [business(), software()]) {
    assert.deepEqual(validateProtocolArtifact('operate-domain-registration', registration, {
      protocolVersion: '2.0.0',
    }), []);
    assert.doesNotThrow(() => assertProtocolArtifact('operate-domain-registration', registration, {
      protocolVersion: '2.0.0',
    }));
  }
  assert.equal(business().policyRequirements[0].actionKind.id, 'business-operating-hypothesis');
  assert.deepEqual(software().policyRequirements, [],
    'the deferred software executor advertises no executable policy requirement');

  const wrongBinding = business();
  wrongBinding.domainContract.id = 'software-domain';
  assert.ok(validateProtocolArtifact('operate-domain-registration', wrongBinding, {
    protocolVersion: '2.0.0',
  }).length > 0);

  const crossDomainProjection = business();
  crossDomainProjection.projectionContracts[0].schemaId = 'software-operating-snapshot-projection';
  assert.ok(validateProtocolArtifact('operate-domain-registration', crossDomainProjection, {
    protocolVersion: '2.0.0',
  }).length > 0);
});

test('domain declarations and consumer registries reject authority-bearing or incomplete shapes before use', () => {
  const executable = business();
  executable.projectionContracts[0].module = './load-this.mjs';
  assert.ok(validateProtocolArtifact('operate-domain-registration', executable, {
    protocolVersion: '2.0.0',
  }).length > 0);

  const capabilitySeeking = business();
  capabilitySeeking.requestedCapabilities = [{
    id: 'filesystem-read', version: '1.0.0', reason: 'Need filesystem access.',
  }];
  assert.throws(() => createOperateExtensionRegistryV2({
    domains: [capabilitySeeking, runtimeDomain(software())],
  }), { code: 'E_EXTENSION_REGISTRATION_INVALID' });

  const policyNamedVocabulary = business();
  policyNamedVocabulary.vocabulary[0].definition = 'A policy-driven operating observation.';
  assert.throws(() => createOperateExtensionRegistryV2({
    domains: [runtimeDomain(policyNamedVocabulary), runtimeDomain(software())],
  }), { code: 'E_EXTENSION_REGISTRATION_INVALID' });

  const registry = createOperateExtensionRegistryV2({
    domains: [runtimeDomain(business()), runtimeDomain(software())],
  });
  assert.throws(() => canonicalizeOperateExtensionRegistryV2({
    domains: clone(registry.domains),
    capabilityGrants: [],
  }), { code: 'E_EXTENSION_REGISTRATION_INVALID' });
});
