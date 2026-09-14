import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
  assertContainedExecutorInputEnvelopeV2,
  createContainedExecutorInputEnvelopeV2,
  createOperateGovernedExtensionRegistryV2,
  createTrustedExecutorBindingV2,
  deriveContainedExecutorRequestFingerprintV2,
  selectOperateExecutorV2,
} from '../../lib/operate/governed-extensions-v2.mjs';
import { OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2 } from '../../lib/operate/reference-governed-executors-v2.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

const fixture = (name) => JSON.parse(readFileSync(
  new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
  'utf8',
));
const clone = (value) => structuredClone(value);
const registrations = fixture('extensions-valid.json').governedExecutionRegistrations;
const valid = fixture('governed-extensions-valid.json');
const invalid = fixture('governed-extensions-invalid.json');
const baseCriteria = {
  protocolVersion: valid.protocolVersion,
  runtimeVersion: valid.runtimeVersion,
  now: valid.observedAt,
  ...valid.projectExecutorSelection,
};

function rotate(values, offset) {
  return values.map((_, index) => clone(values[(index + offset) % values.length]));
}

test('registry canonicalization and exact selection are deterministic across bounded input permutations', () => {
  const expectedHash = sha256Jcs(OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2);
  for (let seed = 0; seed < 64; seed += 1) {
    const registry = createOperateGovernedExtensionRegistryV2({
      capabilityProviders: rotate(registrations.capabilityProviders, seed),
      policyProviders: rotate(registrations.policyProviders, seed),
      executors: rotate(registrations.executors, seed),
    });
    assert.equal(sha256Jcs(registry), expectedHash, `seed ${seed}: registry`);
    assert.equal(sha256Jcs(selectOperateExecutorV2(registry, clone(baseCriteria))),
      sha256Jcs(selectOperateExecutorV2(OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2, clone(baseCriteria))), `seed ${seed}: selection`);
  }
});

test('bounded incompatibility and ceiling mutations always return explicit unavailable without substitution', () => {
  for (const vector of invalid.vectors.filter(({ kind }) => kind === 'executor-selection')) {
    const criteria = clone(baseCriteria);
    criteria[vector.field] = clone(vector.value);
    const result = selectOperateExecutorV2(OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2, criteria);
    assert.equal(result.status, 'unavailable', vector.name);
    assert.equal(result.reasonCode, vector.reasonCode, vector.name);
    assert.deepEqual(result.fallback, { kind: 'unavailable', errorCode: 'EXECUTOR_UNAVAILABLE' }, vector.name);
    assert.equal(Object.hasOwn(result.fallback, 'executorId'), false, vector.name);
  }
});

test('closed registration input rejects executable values and ambient identity without invoking them', () => {
  let calls = 0;
  const functionRegistration = clone(registrations);
  functionRegistration.executors[0].factory = () => { calls += 1; };
  assert.throws(() => createOperateGovernedExtensionRegistryV2(functionRegistration), {
    code: 'E_EXTENSION_REGISTRATION_INVALID',
  });
  assert.equal(calls, 0);

  const accessorRegistration = clone(registrations);
  Object.defineProperty(accessorRegistration.policyProviders[0], 'loader', {
    enumerable: true,
    get() { calls += 1; return 'dynamic-import'; },
  });
  assert.throws(() => createOperateGovernedExtensionRegistryV2(accessorRegistration), {
    code: 'E_EXTENSION_REGISTRATION_INVALID',
  });
  assert.equal(calls, 0, 'accessor was inspected as a descriptor and never invoked');
});

test('reserved identities and host connector proofs remain immutable across bounded hostile variants', () => {
  const selection = selectOperateExecutorV2(OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2, clone(baseCriteria));
  for (let seed = 0; seed < 64; seed += 1) {
    const input = clone(registrations);
    const target = [input.capabilityProviders[0], input.policyProviders[0], input.executors[seed % input.executors.length]][seed % 3];
    if (seed % 3 === 0) target.provenance.packageVersion = `0.42.${seed + 1}`;
    if (seed % 3 === 1) target.health.healthHash = `sha256:${'0'.repeat(64)}`;
    if (seed % 3 === 2) target.conformanceDigest = `sha256:${'0'.repeat(64)}`;
    assert.throws(() => createOperateGovernedExtensionRegistryV2(input), {
      code: 'E_EXTENSION_REGISTRATION_CONFLICT',
    }, `seed ${seed}: reserved catalog declaration`);

    const forgedHost = {
      ...OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      connector: {
        ...OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.connector,
        [seed % 2 === 0 ? 'url' : 'secret']: `hostile-${seed}`,
      },
    };
    assert.throws(() => createTrustedExecutorBindingV2({ selection, trustedHost: forgedHost }), {
      code: 'EXECUTOR_UNAVAILABLE',
    }, `seed ${seed}: host-owned connector`);
  }
});

test('reserved identities and prohibited registration semantics survive bounded version and spelling permutations', () => {
  const semanticPairs = [
    ['contact', 'customer'], ['payment', 'send'], ['deploy', 'production'],
    ['merge', 'production'], ['transfer', 'funds'], ['publish', 'now'],
    ['delete', 'record'], ['rotate', 'secret'], ['change', 'credential'],
    ['release', 'public'], ['remove', 'record'], ['erase', 'record'],
    ['wipe', 'record'], ['remit', 'funds'], ['pay', 'send'], ['transfer', 'pay'],
    ['money', 'transfer'], ['ship', 'production'], ['deliver', 'production'],
    ['message', 'customer'], ['email', 'customer'], ['reachout', 'customer'],
  ];
  for (let seed = 0; seed < 72; seed += 1) {
    const reserved = clone(registrations);
    const collections = ['capabilityProviders', 'policyProviders', 'executors'];
    const collection = collections[seed % collections.length];
    const target = reserved[collection][seed % reserved[collection].length];
    const versionField = collection === 'executors' ? 'executorVersion' : 'providerVersion';
    target[versionField] = `${2 + (seed % 7)}.0.0`;
    target.implementation.id = `fresh-implementation-${seed}`;
    assert.throws(() => createOperateGovernedExtensionRegistryV2(reserved), {
      code: 'E_EXTENSION_REGISTRATION_CONFLICT',
    }, `seed ${seed}: version-independent reservation`);

    const [left, right] = semanticPairs[seed % semanticPairs.length];
    const words = seed % 2 === 0 ? [left, right] : [right, left];
    const mode = seed % 4;
    const identifier = mode === 0 ? words.join('-')
      : mode === 1 ? words.join('_')
        : mode === 2 ? words.join('.')
          : `${words[0]}${words[1][0].toUpperCase()}${words[1].slice(1)}`;
    const prohibited = clone(registrations);
    const community = clone(prohibited.executors[0]);
    community.executorId = `community-contained-executor-${seed}`;
    community.implementation.id = `community-contained-executor-v2-${seed}`;
    community.provenance.packageName = 'community-operate-package';
    community.supportedActionKinds = [{ id: identifier, version: '1.0.0' }];
    prohibited.executors.push(community);
    assert.throws(() => createOperateGovernedExtensionRegistryV2(prohibited), {
      code: 'E_EXTENSION_REGISTRATION_INVALID',
    }, `seed ${seed}: ${identifier}`);
  }
});

test('executor envelope fingerprint rejects bounded payload, baseline, target, and prototype divergence', () => {
  const operation = fixture('governed-execution-contracts-valid.json')['operating-governed-operation'];
  const payload = {
    artifactId: operation.inputArtifactIds[0],
    contentHash: sha256Jcs({ requested: 'after' }),
    value: { requested: 'after' },
  };
  const rollbackBaseline = {
    artifactId: operation.inputArtifactIds[0],
    contentHash: sha256Jcs({ requested: 'before' }),
    value: { requested: 'before' },
  };
  operation.requestFingerprint = deriveContainedExecutorRequestFingerprintV2({ operation, payload, rollbackBaseline });
  const envelope = createContainedExecutorInputEnvelopeV2({ operation, payload, rollbackBaseline });
  assert.equal(assertContainedExecutorInputEnvelopeV2(envelope, { operation }), envelope);

  for (let seed = 0; seed < 64; seed += 1) {
    const divergent = clone(envelope);
    if (seed % 4 === 0) divergent.payload.value.requested = `different-${seed}`;
    if (seed % 4 === 1) divergent.rollbackBaseline.contentHash = `sha256:${(seed % 16).toString(16).repeat(64)}`;
    if (seed % 4 === 2) divergent.operation.target.id = `substitute-${seed}`;
    if (seed % 4 === 3) divergent.payload = Object.assign(Object.create({ inherited: true }), divergent.payload);
    assert.throws(() => assertContainedExecutorInputEnvelopeV2(divergent, { operation }), {
      code: 'OPERATION_CONFLICT',
    }, `seed ${seed}: executor input divergence`);
  }
});
