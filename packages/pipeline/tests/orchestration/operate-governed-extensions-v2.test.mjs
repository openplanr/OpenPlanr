import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  OPERATE_GOVERNED_EFFECT_RANK_V2,
  OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
  OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSION_CATALOG_DIGEST_V2,
  assertOperateExecutorRegistrationV2,
  assertTrustedExecutorBindingV2,
  createOperateGovernedExtensionRegistryV2,
  createTrustedExecutorBindingV2,
  findOperateCapabilityProviderRegistrationV2,
  findOperateExecutorRegistrationV2,
  findOperatePolicyProviderRegistrationV2,
  selectOperateCapabilityProviderV2,
  selectOperateExecutorV2,
  selectOperatePolicyProviderV2,
} from '../../lib/operate/governed-extensions-v2.mjs';
import {
  OPEN_REFERENCE_CONTAINMENT_EXECUTOR_HOST_V2,
  OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
  createOpenReferenceCapabilityAvailabilityV2,
} from '../../lib/operate/reference-governed-executors-v2.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
const clone = (value) => structuredClone(value);
const extensions = fixture('extensions-valid.json').governedExecutionRegistrations;
const selectionFixture = fixture('governed-extensions-valid.json');
const action = fixture('authorization-valid.json').action;

function criteria(value) {
  return {
    protocolVersion: selectionFixture.protocolVersion,
    runtimeVersion: selectionFixture.runtimeVersion,
    now: selectionFixture.observedAt,
    ...clone(value),
  };
}

function registrationsWithCommunityExecutor(actionKindId) {
  const input = clone(extensions);
  const registration = clone(input.executors[0]);
  registration.executorId = 'community-contained-executor';
  registration.implementation.id = 'community-contained-executor-v2';
  registration.supportedActionKinds = [{ id: actionKindId, version: '1.0.0' }];
  registration.provenance.packageName = 'community-operate-package';
  input.executors.push(registration);
  return input;
}

test('the public governed registry is closed, deterministic, exact-versioned, and independent of private implementations', () => {
  const registry = createOperateGovernedExtensionRegistryV2({
    capabilityProviders: [...extensions.capabilityProviders].reverse(),
    policyProviders: [...extensions.policyProviders].reverse(),
    executors: [...extensions.executors].reverse(),
  });
  assert.deepEqual(registry, OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2);
  assert.equal(Object.isFrozen(registry), true);
  assert.equal(Object.isFrozen(registry.executors[0]), true);
  assert.deepEqual(
    registry.executors.map(({ executorId }) => executorId),
    ['open-reference-containment-executor', 'open-reference-project-executor'],
  );
  assert.equal(
    findOperateCapabilityProviderRegistrationV2(registry, 'open-reference-capability-provider', {
      providerVersion: '1.0.0',
    })?.implementation.source,
    'built-in',
  );
  assert.equal(
    findOperatePolicyProviderRegistrationV2(registry, 'open-reference-policy-provider', {
      providerVersion: '1.0.0',
    })?.narrowingOnly,
    true,
  );
  assert.equal(
    findOperateExecutorRegistrationV2(registry, 'open-reference-project-executor', {
      executorVersion: '1.0.1',
    }),
    null,
  );
  assert.doesNotMatch(
    JSON.stringify(registry),
    /(?:private-consumer|credential|secret|dynamic-import|https?:|\.\.[/\\])/iu,
  );
  assert.equal(
    OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSION_CATALOG_DIGEST_V2,
    'sha256:e5c93534b8ca3eb427a075851b72d7b44226366a72f2dafa51352c8a07791b02',
  );
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import { OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSION_CATALOG_DIGEST_V2 as digest }
      from ${JSON.stringify(new URL('../../lib/operate/governed-extensions-v2.mjs', import.meta.url).href)};
    process.stdout.write(digest);
  `,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSION_CATALOG_DIGEST_V2);
  const reservationChild = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import {
      OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2 as registry,
      createOperateGovernedExtensionRegistryV2 as createRegistry,
    } from ${JSON.stringify(new URL('../../lib/operate/governed-extensions-v2.mjs', import.meta.url).href)};
    const input = structuredClone(registry);
    input.executors[0].executorVersion = '2.0.0';
    input.executors[0].implementation.id = 'restart-substitute-executor-v2';
    try { createRegistry(input); process.stdout.write('accepted'); }
    catch (error) { process.stdout.write(error.code ?? 'unknown'); }
  `,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(reservationChild.status, 0, reservationChild.stderr);
  assert.equal(reservationChild.stdout, 'E_EXTENSION_REGISTRATION_CONFLICT');
});

test('capability, policy, and executor discovery select only an exact healthy compatible declaration', () => {
  const registry = OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2;
  const capability = selectOperateCapabilityProviderV2(
    registry,
    criteria(selectionFixture.capabilitySelection),
  );
  const policy = selectOperatePolicyProviderV2(
    registry,
    criteria(selectionFixture.policySelection),
  );
  const project = selectOperateExecutorV2(
    registry,
    criteria(selectionFixture.projectExecutorSelection),
  );
  const containment = selectOperateExecutorV2(
    registry,
    criteria(selectionFixture.containmentExecutorSelection),
  );
  assert.deepEqual(
    [
      `${capability.registration.providerId}@${capability.registration.providerVersion}`,
      `${policy.registration.providerId}@${policy.registration.providerVersion}`,
      `${project.registration.executorId}@${project.registration.executorVersion}`,
      `${containment.registration.executorId}@${containment.registration.executorVersion}`,
    ],
    Object.values(selectionFixture.expected).slice(0, 4),
  );
  for (const result of [capability, policy, project, containment]) {
    assert.equal(result.status, 'available');
    assert.equal(result.reasonCode, 'exact-registration-available');
    assert.equal(result.fallback, selectionFixture.expected.fallback);
  }
  const releaseWindowSelection = selectOperateExecutorV2(registry, {
    ...criteria(selectionFixture.projectExecutorSelection),
    now: '2026-08-12T12:00:00Z',
  });
  assert.equal(releaseWindowSelection.status, 'available');
  assert.equal(releaseWindowSelection.reasonCode, 'exact-registration-available');

  const expiredInput = clone(extensions);
  const expiredEquivalent = clone(
    expiredInput.executors.find(
      ({ executorId }) => executorId === 'open-reference-project-executor',
    ),
  );
  expiredEquivalent.executorId = 'expired-project-executor';
  expiredEquivalent.implementation.id = 'expired-project-executor-v2';
  expiredEquivalent.provenance.packageName = 'expired-project-executor-package';
  expiredEquivalent.health = {
    status: 'available',
    checkedAt: '2026-08-11T00:00:00Z',
    expiresAt: '2026-08-12T00:00:00Z',
    healthHash: sha256Jcs({
      status: 'available',
      checkedAt: '2026-08-11T00:00:00Z',
      expiresAt: '2026-08-12T00:00:00Z',
    }),
  };
  expiredInput.executors.push(expiredEquivalent);
  const expiredRegistry = createOperateGovernedExtensionRegistryV2(expiredInput);
  const expiredSelection = selectOperateExecutorV2(expiredRegistry, {
    ...criteria(selectionFixture.projectExecutorSelection),
    executorId: 'expired-project-executor',
    now: '2026-08-12T12:00:00Z',
  });
  assert.equal(expiredSelection.status, 'unavailable');
  assert.equal(expiredSelection.reasonCode, 'health-expired');

  const unavailable = selectOperateExecutorV2(registry, {
    ...criteria(selectionFixture.projectExecutorSelection),
    executorVersion: '1.0.1',
  });
  assert.deepEqual(unavailable, {
    status: 'unavailable',
    registration: null,
    reasonCode: 'registration-not-found',
    fallback: { kind: 'unavailable', errorCode: 'EXECUTOR_UNAVAILABLE' },
  });
});

test('all governed selectors use an own-known-key null-prototype effect rank', () => {
  assert.equal(Object.getPrototypeOf(OPERATE_GOVERNED_EFFECT_RANK_V2), null);
  const selectors = [
    [
      selectOperateCapabilityProviderV2,
      selectionFixture.capabilitySelection,
      'CAPABILITY_PROVIDER_UNAVAILABLE',
    ],
    [
      selectOperatePolicyProviderV2,
      selectionFixture.policySelection,
      'POLICY_PROVIDER_UNAVAILABLE',
    ],
    [selectOperateExecutorV2, selectionFixture.projectExecutorSelection, 'EXECUTOR_UNAVAILABLE'],
  ];
  for (const effectClass of ['toString', 'constructor', '__proto__', 'arbitrary-effect']) {
    assert.equal(Object.hasOwn(OPERATE_GOVERNED_EFFECT_RANK_V2, effectClass), false);
    for (const [select, selection, errorCode] of selectors) {
      const result = select(
        OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
        criteria({ ...clone(selection), effectClass }),
      );
      assert.deepEqual(
        result,
        {
          status: 'unavailable',
          registration: result.registration,
          reasonCode: 'declared-ceiling-insufficient',
          fallback: { kind: 'unavailable', errorCode },
        },
        `${select.name}: ${effectClass}`,
      );
    }
  }

  for (const [collection, index] of [
    ['capabilityProviders', 0],
    ['policyProviders', 0],
    ['executors', 0],
  ]) {
    for (const effectCeiling of ['toString', 'constructor', '__proto__', 'arbitrary-effect']) {
      const input = clone(extensions);
      input[collection][index].effectCeiling = effectCeiling;
      assert.throws(
        () => createOperateGovernedExtensionRegistryV2(input),
        {
          code: 'E_EXTENSION_REGISTRATION_INVALID',
        },
        `${collection}: ${effectCeiling}`,
      );
    }
  }
});

test('registration and health create no grant, approval, transition, target access, or fallback authority', () => {
  const before = sha256Jcs(action);
  const availability = createOpenReferenceCapabilityAvailabilityV2({
    action,
    runtimeVersion: '0.42.0',
    checkedAt: '2026-08-12T12:00:00Z',
    expiresAt: '2026-08-12T12:05:00Z',
  });
  assert.equal(availability.status, 'available');
  assert.deepEqual(availability.capability, action.requestedCapability);
  assert.deepEqual(availability.target, action.targetBinding);
  assert.equal(sha256Jcs(action), before);
  assert.equal(Object.hasOwn(availability, 'grant'), false);
  assert.equal(Object.hasOwn(availability, 'approval'), false);
  assert.equal(Object.hasOwn(availability, 'transition'), false);
  assert.equal(Object.hasOwn(availability, 'targetAdapter'), false);

  assert.throws(
    () =>
      createOpenReferenceCapabilityAvailabilityV2({
        action,
        runtimeVersion: '0.42.0',
        checkedAt: '2026-08-12T12:00:00Z',
        expiresAt: '2027-08-12T00:00:00.001Z',
      }),
    { code: 'OPERATING_PROVIDER_INPUT_INVALID' },
  );

  const expired = selectOperateCapabilityProviderV2(OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2, {
    ...criteria(selectionFixture.capabilitySelection),
    now: '2027-08-12T00:00:00Z',
  });
  assert.equal(expired.status, 'unavailable');
  assert.equal(expired.reasonCode, 'health-expired');
  assert.deepEqual(expired.fallback, {
    kind: 'unavailable',
    errorCode: 'CAPABILITY_PROVIDER_UNAVAILABLE',
  });
});

test('trusted host bindings sit beneath one selected executor and cannot substitute its identity', () => {
  const selection = selectOperateExecutorV2(
    OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
    criteria(selectionFixture.projectExecutorSelection),
  );
  const binding = createTrustedExecutorBindingV2({
    selection,
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
  });
  assert.deepEqual(
    assertTrustedExecutorBindingV2(binding, { executor: selection.registration }),
    binding,
  );
  assert.deepEqual(
    assertOperateExecutorRegistrationV2(selection.registration),
    selection.registration,
  );
  assert.deepEqual(binding.connector, {
    id: 'disposable-local-project-connector',
    version: '1.0.0',
  });
  assert.equal(Object.hasOwn(selection.registration, 'connector'), false);
  assert.throws(
    () =>
      createTrustedExecutorBindingV2({
        selection,
        trustedHost: OPEN_REFERENCE_CONTAINMENT_EXECUTOR_HOST_V2,
      }),
    { code: 'EXECUTOR_UNAVAILABLE' },
  );
  const tampered = clone(binding);
  tampered.connector = { id: 'substitute', version: '1.0.0' };
  assert.throws(
    () => assertTrustedExecutorBindingV2(tampered, { executor: selection.registration }),
    {
      code: 'EXECUTOR_UNAVAILABLE',
    },
  );
  assert.throws(
    () => assertTrustedExecutorBindingV2(clone(binding), { executor: selection.registration }),
    {
      code: 'EXECUTOR_UNAVAILABLE',
    },
    'caller-constructed byte clones do not carry the host-owned binding proof',
  );
  const forgedHost = {
    ...OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    connector: {
      id: 'disposable-local-project-connector',
      version: '1.0.0',
      url: 'https://example.invalid',
    },
  };
  assert.throws(() => createTrustedExecutorBindingV2({ selection, trustedHost: forgedHost }), {
    code: 'EXECUTOR_UNAVAILABLE',
  });
});

test('hostile registration fields, duplicates, prohibited effects, and fallback substitution fail closed', () => {
  const invalid = fixture('governed-extensions-invalid.json');
  for (const vector of invalid.vectors.filter(({ kind }) => kind === 'registration')) {
    const input = clone(extensions);
    input[vector.collection][0][vector.field] = clone(vector.value);
    assert.throws(
      () => createOperateGovernedExtensionRegistryV2(input),
      { code: vector.errorCode },
      vector.name,
    );
  }
  const duplicate = clone(extensions);
  duplicate.executors.push(clone(duplicate.executors[0]));
  assert.throws(() => createOperateGovernedExtensionRegistryV2(duplicate), {
    code: 'E_EXTENSION_REGISTRATION_CONFLICT',
  });

  for (const mutate of [
    (input) => {
      input.capabilityProviders[0].provenance.packageName = 'substitute-package';
    },
    (input) => {
      input.policyProviders[0].health.expiresAt = '2026-08-12T08:00:00Z';
    },
    (input) => {
      input.executors[1].implementation.id = 'open-reference-project-executor-v2-substitute';
    },
  ]) {
    const reserved = clone(extensions);
    mutate(reserved);
    assert.throws(() => createOperateGovernedExtensionRegistryV2(reserved), {
      code: 'E_EXTENSION_REGISTRATION_CONFLICT',
    });
  }

  for (const { collection, index, idField, versionField } of [
    {
      collection: 'capabilityProviders',
      index: 0,
      idField: 'providerId',
      versionField: 'providerVersion',
    },
    {
      collection: 'policyProviders',
      index: 0,
      idField: 'providerId',
      versionField: 'providerVersion',
    },
    { collection: 'executors', index: 0, idField: 'executorId', versionField: 'executorVersion' },
    { collection: 'executors', index: 1, idField: 'executorId', versionField: 'executorVersion' },
  ]) {
    const differentVersion = clone(extensions);
    differentVersion[collection][index][versionField] = '2.0.0';
    differentVersion[collection][index].implementation.id =
      `unreserved-implementation-${collection.toLowerCase()}-${index}`;
    assert.throws(
      () => createOperateGovernedExtensionRegistryV2(differentVersion),
      {
        code: 'E_EXTENSION_REGISTRATION_CONFLICT',
      },
      `${collection}[${index}] reserved ${idField} across versions`,
    );

    const differentId = clone(extensions);
    differentId[collection][index][idField] = `unreserved-${collection.toLowerCase()}-${index}`;
    assert.throws(
      () => createOperateGovernedExtensionRegistryV2(differentId),
      {
        code: 'E_EXTENSION_REGISTRATION_CONFLICT',
      },
      `${collection}[${index}] reserved implementation identity`,
    );
  }

  const crossKind = clone(extensions);
  crossKind.policyProviders[0].providerId = extensions.capabilityProviders[0].providerId;
  crossKind.policyProviders[0].implementation.id = 'unreserved-cross-kind-provider';
  assert.throws(() => createOperateGovernedExtensionRegistryV2(crossKind), {
    code: 'E_EXTENSION_REGISTRATION_CONFLICT',
  });

  for (const identifier of [
    'contact-customer',
    'payment-send',
    'deploy-production',
    'merge-production',
    'transfer-funds',
    'publish-now',
    'delete-record',
    'rotate-secret',
    'change-credential',
    'contactCustomer',
    'payment_send',
    'deploy.production',
    'production/merge',
  ]) {
    const input = clone(extensions);
    input.executors[0].supportedActionKinds[0].id = identifier;
    assert.throws(
      () => createOperateGovernedExtensionRegistryV2(input),
      {
        code: 'E_EXTENSION_REGISTRATION_INVALID',
      },
      identifier,
    );
  }

  for (const identifier of [
    'release-public',
    'release',
    'remove-record',
    'erase-record',
    'wipe-record',
    'remit-funds',
    'releasePublic',
    'remove_record',
    'erase.record',
    'wipe/record',
    'funds-remit',
    'pay-send',
    'transfer-pay',
    'money-transfer',
    'ship-production',
    'deliver-production',
    'delivery-production',
    'message-customer',
    'email-customer',
    'reachout-customer',
    'productionShip',
    'prod_deliver',
    'customer.email',
    'customer/reachOut',
  ]) {
    assert.throws(
      () =>
        createOperateGovernedExtensionRegistryV2(registrationsWithCommunityExecutor(identifier)),
      { code: 'E_EXTENSION_REGISTRATION_INVALID' },
      `non-reserved ${identifier}`,
    );
  }
  const payOnly = createOperateGovernedExtensionRegistryV2(
    registrationsWithCommunityExecutor('pay'),
  );
  assert.equal(
    payOnly.executors.some(({ executorId }) => executorId === 'community-contained-executor'),
    true,
    'pay alone is not classified as payment transfer without send/transfer composition',
  );
  for (const standalone of ['ship', 'message', 'email']) {
    const registry = createOperateGovernedExtensionRegistryV2(
      registrationsWithCommunityExecutor(standalone),
    );
    assert.equal(
      registry.executors.some(({ executorId }) => executorId === 'community-contained-executor'),
      true,
      `${standalone} alone remains outside a bounded compound prohibition`,
    );
  }

  const customPrototype = Object.assign(Object.create({ inherited: true }), clone(extensions));
  assert.throws(() => createOperateGovernedExtensionRegistryV2(customPrototype), {
    code: 'E_EXTENSION_REGISTRATION_INVALID',
  });
  const nestedPrototype = clone(extensions);
  nestedPrototype.executors[0].implementation = Object.assign(
    Object.create({ inherited: true }),
    nestedPrototype.executors[0].implementation,
  );
  assert.throws(() => createOperateGovernedExtensionRegistryV2(nestedPrototype), {
    code: 'E_EXTENSION_REGISTRATION_INVALID',
  });
});
