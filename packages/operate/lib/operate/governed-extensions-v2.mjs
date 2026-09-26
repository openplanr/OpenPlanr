import { PipelineError } from '@openplanr/protocol/errors';
import {
  OPERATE_GOVERNED_EFFECT_CLASSES_V2,
  assertProtocolArtifact,
  findOperateCoreProhibitionV2,
} from '@openplanr/protocol/contracts';
import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { OPERATE_CONTRACT_CATALOG_V2 } from '@openplanr/protocol/operate-contract-catalog-v2';
import {
  findOpenReferenceExecutorHostDeclarationV2,
  resolveOpenReferenceExecutorHostV2,
} from './reference-governed-executors-v2.mjs';

const PROTOCOL_VERSION = '2.0.0';
const TRUSTED_BINDINGS = new WeakSet();
const REGISTRATION_KINDS = Object.freeze({
  capability: Object.freeze({
    contractKind: 'operate-capability-provider-registration',
    field: 'capabilityProviders',
    idField: 'providerId',
    versionField: 'providerVersion',
    unavailableCode: 'CAPABILITY_PROVIDER_UNAVAILABLE',
  }),
  policy: Object.freeze({
    contractKind: 'operate-policy-provider-registration',
    field: 'policyProviders',
    idField: 'providerId',
    versionField: 'providerVersion',
    unavailableCode: 'POLICY_PROVIDER_UNAVAILABLE',
  }),
  executor: Object.freeze({
    contractKind: 'operate-executor-registration',
    field: 'executors',
    idField: 'executorId',
    versionField: 'executorVersion',
    unavailableCode: 'EXECUTOR_UNAVAILABLE',
  }),
});

export const OPERATE_GOVERNED_EFFECT_RANK_V2 = Object.freeze(
  Object.assign(
    Object.create(null),
    Object.fromEntries(OPERATE_GOVERNED_EFFECT_CLASSES_V2.map((effect, index) => [effect, index])),
  ),
);

const SHIPPED_GOVERNED_REGISTRATION_RESERVATIONS = Object.freeze(
  Object.entries(REGISTRATION_KINDS).flatMap(([kind, definition]) =>
    OPERATE_CONTRACT_CATALOG_V2.extensions[definition.field].map((entry) =>
      Object.freeze({
        kind,
        primaryId: entry[definition.idField],
        implementationId: entry.implementation.id,
        entry,
      }),
    ),
  ),
);

export class OperatingGovernedExtensionErrorV2 extends PipelineError {
  constructor(code, message, context = {}) {
    super(code, message, '', { retryable: false, context: structuredClone(context) });
    this.name = 'OperatingGovernedExtensionErrorV2';
  }
}

function fail(code, message, context = {}) {
  throw new OperatingGovernedExtensionErrorV2(code, message, context);
}

function clone(value) {
  return structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

function sameJson(left, right) {
  return sha256Jcs(left) === sha256Jcs(right);
}

function sameIdentity(left, right) {
  return left?.id === right?.id && left?.version === right?.version;
}

function plainRecord(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function exactRecord(value, fields) {
  const keys = plainRecord(value) ? Object.getOwnPropertyNames(value).sort() : [];
  const expected = [...fields].sort();
  return (
    plainRecord(value) &&
    keys.every((field, index) => field === expected[index]) &&
    keys.length === expected.length &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) =>
        Object.hasOwn(descriptor, 'value') &&
        descriptor.get === undefined &&
        descriptor.set === undefined,
    )
  );
}

function exactIdentity(entries, expected) {
  return entries.some((entry) => sameIdentity(entry, expected));
}

function semverParts(value, field) {
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.exec(value ?? '');
  if (match === null)
    fail('E_EXTENSION_VERSION_REQUIRED', `${field} requires one exact semantic version.`, {
      field,
    });
  return match.slice(1).map(Number);
}

function compareSemver(left, right) {
  const a = semverParts(left, 'runtimeVersion');
  const b = semverParts(right, 'registeredRuntimeVersion');
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function explicitTime(value, field) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(parsed))
    fail('E_EXTENSION_REGISTRATION_INVALID', `${field} requires an explicit RFC 3339 timestamp.`, {
      field,
    });
  return parsed;
}

function assertClosedData(value, path = '$') {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      fail('E_EXTENSION_REGISTRATION_INVALID', `Registration data must be finite at ${path}.`, {
        path,
      });
    }
    if (
      typeof value === 'string' &&
      (value.includes('\u0000') ||
        value.startsWith('/') ||
        value.startsWith('~') ||
        /^[A-Za-z]:[\\/]/u.test(value) ||
        value.split(/[\\/]/u).includes('..') ||
        /^(?:file|https?|data|node):/iu.test(value) ||
        /\b(?:dynamic[- ]?import|private[-_ ]?consumer|access[-_ ]?token|api[-_ ]?key)\b/iu.test(
          value,
        ))
    ) {
      fail(
        'E_EXTENSION_REGISTRATION_INVALID',
        `Registration contains a non-portable or private declaration at ${path}.`,
        { path },
      );
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    fail(
      'E_EXTENSION_REGISTRATION_INVALID',
      `Registration must contain closed JSON data at ${path}.`,
      { path },
    );
  }
  const prototype = Object.getPrototypeOf(value);
  const expectedPrototype = Array.isArray(value) ? Array.prototype : Object.prototype;
  if (prototype !== expectedPrototype) {
    fail(
      'E_EXTENSION_REGISTRATION_INVALID',
      `Registration must use plain data objects at ${path}.`,
      { path },
    );
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail(
      'E_EXTENSION_REGISTRATION_INVALID',
      `Registration cannot contain symbol fields at ${path}.`,
      { path },
    );
  }
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    const field = `${path}.${key}`;
    if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
      fail(
        'E_EXTENSION_REGISTRATION_INVALID',
        `Registration cannot contain an accessor at ${field}.`,
        { path: field },
      );
    }
    if (
      /^(?:module|path|url|connector|factory|loader|import|require|credential|secret|token|grant|approval|transition|dispatch|targetAdapter)$/iu.test(
        key,
      )
    ) {
      fail(
        'E_EXTENSION_REGISTRATION_INVALID',
        `Registration contains an implementation or authority field at ${field}.`,
        { path: field },
      );
    }
    assertClosedData(descriptor.value, field);
  }
}

function registrationSemanticValues(value, values = []) {
  if (typeof value === 'string') {
    values.push(value);
    return values;
  }
  if (Array.isArray(value)) {
    for (const entry of value) registrationSemanticValues(entry, values);
    return values;
  }
  if (value && typeof value === 'object') {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (Object.hasOwn(descriptor, 'value')) registrationSemanticValues(descriptor.value, values);
    }
  }
  return values;
}

function governedEffectRank(value) {
  if (typeof value !== 'string' || !Object.hasOwn(OPERATE_GOVERNED_EFFECT_RANK_V2, value))
    return null;
  const rank = OPERATE_GOVERNED_EFFECT_RANK_V2[value];
  return Number.isSafeInteger(rank) ? rank : null;
}

function sortIdentities(values) {
  return values
    .map(clone)
    .sort(
      (left, right) => left.id.localeCompare(right.id) || left.version.localeCompare(right.version),
    );
}

function canonicalizeRegistration(kind, registration) {
  const definition = REGISTRATION_KINDS[kind];
  assertClosedData(registration);
  const prohibition = findOperateCoreProhibitionV2(registrationSemanticValues(registration));
  if (prohibition !== null) {
    fail(
      'E_EXTENSION_REGISTRATION_INVALID',
      'Reference-governed registrations cannot declare a prohibited semantic class.',
      {
        registrationId: registration?.[definition.idField] ?? null,
        prohibition,
      },
    );
  }
  try {
    assertProtocolArtifact(definition.contractKind, registration, {
      protocolVersion: PROTOCOL_VERSION,
    });
  } catch (cause) {
    fail('E_EXTENSION_REGISTRATION_INVALID', `${definition.contractKind} is not contract-valid.`, {
      cause: cause?.code ?? null,
    });
  }
  const checkedAt = explicitTime(registration.health.checkedAt, 'health.checkedAt');
  const expiresAt = explicitTime(registration.health.expiresAt, 'health.expiresAt');
  if (checkedAt >= expiresAt) {
    fail('E_EXTENSION_REGISTRATION_INVALID', 'Extension health must expire after its check time.', {
      registrationId: registration[definition.idField],
    });
  }
  const minimum = registration.versionCompatibility.minimumRuntimeVersion;
  const maximum = registration.versionCompatibility.maximumRuntimeVersion;
  if (maximum !== null && compareSemver(minimum, maximum) > 0) {
    fail('E_EXTENSION_REGISTRATION_INVALID', 'Extension runtime compatibility range is inverted.', {
      registrationId: registration[definition.idField],
    });
  }
  const result = clone(registration);
  result.supportedActionKinds = sortIdentities(result.supportedActionKinds);
  result.supportedDomains.sort();
  result.errorCodes.sort();
  result.retryPolicy.retryableErrorCodes.sort();
  if (kind !== 'policy') {
    result.capabilities = sortIdentities(result.capabilities);
    result.supportedTargetKinds.sort();
  }
  if (kind === 'policy') result.policyRefs = sortIdentities(result.policyRefs);
  if (kind === 'executor') result.operationKinds.sort();
  const reserved = SHIPPED_GOVERNED_REGISTRATION_RESERVATIONS.find(
    (entry) =>
      entry.primaryId === result[definition.idField] ||
      entry.implementationId === result.implementation.id,
  );
  if (
    reserved &&
    (reserved.kind !== kind ||
      !sameJson(result, registrationArtifact(reserved.kind, reserved.entry)))
  ) {
    fail(
      'E_EXTENSION_REGISTRATION_CONFLICT',
      'A shipped open-reference identity must equal its immutable catalog declaration.',
      {
        registrationId: result[definition.idField],
        registrationVersion: result[definition.versionField],
        implementationId: result.implementation.id,
        reservedKind: reserved.kind,
        reservedId: reserved.primaryId,
      },
    );
  }
  return freeze(result);
}

function registrationArtifact(kind, registration) {
  return {
    kind: REGISTRATION_KINDS[kind].contractKind,
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    ...clone(registration),
  };
}

function registrationIdentity(kind, registration) {
  const definition = REGISTRATION_KINDS[kind];
  return `${registration[definition.idField]}@${registration[definition.versionField]}`;
}

function canonicalizeList(kind, registrations) {
  if (!Array.isArray(registrations) || registrations.length === 0) {
    fail(
      'E_EXTENSION_REGISTRATION_INVALID',
      `${REGISTRATION_KINDS[kind].field} requires at least one registration.`,
    );
  }
  const seen = new Set();
  const canonical = registrations.map((entry) => {
    const registration = canonicalizeRegistration(kind, entry);
    const identity = registrationIdentity(kind, registration);
    if (seen.has(identity)) {
      fail(
        'E_EXTENSION_REGISTRATION_CONFLICT',
        `Duplicate governed extension registration ${identity}.`,
        { identity },
      );
    }
    seen.add(identity);
    return registration;
  });
  return canonical.sort((left, right) =>
    registrationIdentity(kind, left).localeCompare(registrationIdentity(kind, right)),
  );
}

export function createOperateGovernedExtensionRegistryV2(input = {}) {
  if (!plainRecord(input)) {
    fail(
      'E_EXTENSION_REGISTRATION_INVALID',
      'Governed extension registrations must be one object of arrays.',
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    Object.values(descriptors).some(
      (descriptor) =>
        !Object.hasOwn(descriptor, 'value') ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined,
    )
  ) {
    fail(
      'E_EXTENSION_REGISTRATION_INVALID',
      'Governed extension registry fields must be closed data properties.',
    );
  }
  const unknown = Object.getOwnPropertyNames(input).filter(
    (key) => !['capabilityProviders', 'policyProviders', 'executors'].includes(key),
  );
  if (unknown.length > 0) {
    fail(
      'E_EXTENSION_REGISTRATION_INVALID',
      'Governed extension registry contains unsupported fields.',
      { unknown: unknown.sort() },
    );
  }
  const capabilityProviders =
    input.capabilityProviders ??
    OPERATE_CONTRACT_CATALOG_V2.extensions.capabilityProviders.map((entry) =>
      registrationArtifact('capability', entry),
    );
  const policyProviders =
    input.policyProviders ??
    OPERATE_CONTRACT_CATALOG_V2.extensions.policyProviders.map((entry) =>
      registrationArtifact('policy', entry),
    );
  const executors =
    input.executors ??
    OPERATE_CONTRACT_CATALOG_V2.extensions.executors.map((entry) =>
      registrationArtifact('executor', entry),
    );
  return freeze({
    capabilityProviders: canonicalizeList('capability', capabilityProviders),
    policyProviders: canonicalizeList('policy', policyProviders),
    executors: canonicalizeList('executor', executors),
  });
}

export const OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2 =
  createOperateGovernedExtensionRegistryV2();
export const OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSION_CATALOG_DIGEST_V2 = sha256Jcs(
  OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
);

export function canonicalizeOperateGovernedExtensionRegistryV2(registry) {
  if (!plainRecord(registry)) {
    fail(
      'E_EXTENSION_REGISTRATION_INVALID',
      'A governed extension registry must be a complete plain object.',
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(registry);
  const keys = Object.keys(descriptors).sort();
  const expected = ['capabilityProviders', 'executors', 'policyProviders'];
  if (!sameJson(keys, expected)) {
    fail(
      'E_EXTENSION_REGISTRATION_INVALID',
      'A governed extension registry must declare exactly its three closed collections.',
      { fields: keys },
    );
  }
  const input = {};
  for (const field of expected) {
    const descriptor = descriptors[field];
    if (!Object.hasOwn(descriptor, 'value') || !Array.isArray(descriptor.value)) {
      fail(
        'E_EXTENSION_REGISTRATION_INVALID',
        'Governed registry collections must be data arrays.',
        { field },
      );
    }
    input[field] = descriptor.value;
  }
  return createOperateGovernedExtensionRegistryV2(input);
}

function findRegistration(kind, registry, id, version) {
  semverParts(version, `${kind} registration version`);
  const definition = REGISTRATION_KINDS[kind];
  const canonical = canonicalizeOperateGovernedExtensionRegistryV2(registry);
  const match = canonical[definition.field].find(
    (entry) => entry[definition.idField] === id && entry[definition.versionField] === version,
  );
  return match === undefined ? null : clone(match);
}

export function findOperateCapabilityProviderRegistrationV2(
  registry,
  providerId,
  { providerVersion } = {},
) {
  return findRegistration('capability', registry, providerId, providerVersion);
}

export function findOperatePolicyProviderRegistrationV2(
  registry,
  providerId,
  { providerVersion } = {},
) {
  return findRegistration('policy', registry, providerId, providerVersion);
}

export function findOperateExecutorRegistrationV2(registry, executorId, { executorVersion } = {}) {
  return findRegistration('executor', registry, executorId, executorVersion);
}

function selectionFailure(kind, reasonCode, registration = null) {
  return freeze({
    status: 'unavailable',
    registration: registration === null ? null : clone(registration),
    reasonCode,
    fallback: { kind: 'unavailable', errorCode: REGISTRATION_KINDS[kind].unavailableCode },
  });
}

function selectRegistration(kind, registry, criteria) {
  const definition = REGISTRATION_KINDS[kind];
  const id = criteria[definition.idField];
  const version = criteria[definition.versionField];
  const registration = findRegistration(kind, registry, id, version);
  if (registration === null) return selectionFailure(kind, 'registration-not-found');
  if (criteria.protocolVersion !== PROTOCOL_VERSION)
    return selectionFailure(kind, 'protocol-version-incompatible', registration);
  const runtimeVersion = criteria.runtimeVersion;
  semverParts(runtimeVersion, 'runtimeVersion');
  const compatibility = registration.versionCompatibility;
  if (
    compareSemver(runtimeVersion, compatibility.minimumRuntimeVersion) < 0 ||
    (compatibility.maximumRuntimeVersion !== null &&
      compareSemver(runtimeVersion, compatibility.maximumRuntimeVersion) > 0)
  ) {
    return selectionFailure(kind, 'runtime-version-incompatible', registration);
  }
  const now = explicitTime(criteria.now, 'now');
  if (registration.health.status !== 'available') {
    return selectionFailure(kind, `health-${registration.health.status}`, registration);
  }
  if (explicitTime(registration.health.checkedAt, 'health.checkedAt') > now) {
    return selectionFailure(kind, 'health-not-yet-valid', registration);
  }
  if (explicitTime(registration.health.expiresAt, 'health.expiresAt') <= now) {
    return selectionFailure(kind, 'health-expired', registration);
  }
  const requestedEffectRank = governedEffectRank(criteria.effectClass);
  const ceilingEffectRank = governedEffectRank(registration.effectCeiling);
  if (
    requestedEffectRank === null ||
    ceilingEffectRank === null ||
    !registration.supportedDomains.includes(criteria.domainId) ||
    !exactIdentity(registration.supportedActionKinds, criteria.actionKind) ||
    ceilingEffectRank < requestedEffectRank
  ) {
    return selectionFailure(kind, 'declared-ceiling-insufficient', registration);
  }
  if (
    kind !== 'policy' &&
    (!exactIdentity(registration.capabilities, criteria.capability) ||
      !registration.supportedTargetKinds.includes(criteria.targetKind))
  ) {
    return selectionFailure(kind, 'declared-ceiling-insufficient', registration);
  }
  if (
    kind === 'policy' &&
    criteria.policyRef &&
    !exactIdentity(registration.policyRefs, criteria.policyRef)
  ) {
    return selectionFailure(kind, 'policy-version-incompatible', registration);
  }
  if (kind === 'executor' && !registration.operationKinds.includes(criteria.operationKind)) {
    return selectionFailure(kind, 'operation-kind-unsupported', registration);
  }
  return freeze({
    status: 'available',
    registration,
    reasonCode: 'exact-registration-available',
    fallback: null,
  });
}

export function selectOperateCapabilityProviderV2(registry, criteria) {
  return selectRegistration('capability', registry, criteria);
}

export function selectOperatePolicyProviderV2(registry, criteria) {
  return selectRegistration('policy', registry, criteria);
}

export function selectOperateExecutorV2(registry, criteria) {
  return selectRegistration('executor', registry, criteria);
}

/** Reduce an exact Executor declaration to the only safe crash-recovery modes. */
export function classifyOperateExecutorRecoveryCapabilityV2(executor) {
  const registration = canonicalizeRegistration('executor', executor);
  if (registration.idempotency.intrinsicallyIdempotent === true) {
    return 'intrinsically-idempotent';
  }
  if (
    registration.reconciliation.supported === true &&
    registration.reconciliation.mode === 'deterministic'
  ) {
    return 'reconcile-before-redispatch';
  }
  return 'uncertain-no-redispatch';
}

export function assertOperateExecutorRegistrationV2(
  executor,
  { registry = OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2 } = {},
) {
  const registered = findOperateExecutorRegistrationV2(registry, executor?.executorId, {
    executorVersion: executor?.executorVersion,
  });
  if (
    registered === null ||
    !sameJson(registered, canonicalizeRegistration('executor', executor))
  ) {
    fail('EXECUTOR_UNAVAILABLE', 'Executor must equal one exact registered closed declaration.', {
      executorId: executor?.executorId ?? null,
      executorVersion: executor?.executorVersion ?? null,
    });
  }
  return freeze(registered);
}

export function createTrustedExecutorBindingV2({ selection, trustedHost }) {
  if (selection?.status !== 'available' || !selection.registration) {
    fail(
      'EXECUTOR_UNAVAILABLE',
      'A trusted connector can bind only beneath an available exact Executor selection.',
    );
  }
  const registration = canonicalizeRegistration('executor', selection.registration);
  const host = resolveOpenReferenceExecutorHostV2(trustedHost);
  if (
    host === null ||
    host.executorId !== registration.executorId ||
    host.executorVersion !== registration.executorVersion ||
    host.implementationId !== registration.implementation.id
  ) {
    fail(
      'EXECUTOR_UNAVAILABLE',
      'Trusted host implementation must bind the selected Executor and one host-owned connector exactly.',
      {
        executorId: registration.executorId,
      },
    );
  }
  semverParts(host.connector.version, 'trustedHost.connector.version');
  const binding = {
    kind: 'operate-trusted-executor-binding',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    executor: {
      executorId: registration.executorId,
      executorVersion: registration.executorVersion,
    },
    implementation: clone(registration.implementation),
    connector: clone(host.connector),
    registrationHash: sha256Jcs(registration),
  };
  binding.bindingHash = sha256Jcs(binding);
  const trustedBinding = freeze(binding);
  TRUSTED_BINDINGS.add(trustedBinding);
  return trustedBinding;
}

export function assertTrustedExecutorBindingV2(binding, { executor }) {
  const host = findOpenReferenceExecutorHostDeclarationV2({
    executorId: executor?.executorId,
    executorVersion: executor?.executorVersion,
    implementationId: executor?.implementation?.id,
  });
  if (
    !TRUSTED_BINDINGS.has(binding) ||
    !exactRecord(binding, [
      'kind',
      'schemaVersion',
      'protocolVersion',
      'executor',
      'implementation',
      'connector',
      'registrationHash',
      'bindingHash',
    ]) ||
    !exactRecord(binding.executor, ['executorId', 'executorVersion']) ||
    !exactRecord(binding.implementation, ['id', 'source']) ||
    !exactRecord(binding.connector, ['id', 'version']) ||
    host === null ||
    !sameJson(binding.connector, host.connector) ||
    binding.kind !== 'operate-trusted-executor-binding' ||
    binding.schemaVersion !== '1.0.0' ||
    binding.protocolVersion !== PROTOCOL_VERSION ||
    binding.executor?.executorId !== executor?.executorId ||
    binding.executor?.executorVersion !== executor?.executorVersion ||
    !sameJson(binding.implementation, executor?.implementation) ||
    binding.registrationHash !== sha256Jcs(canonicalizeRegistration('executor', executor)) ||
    binding.bindingHash !==
      sha256Jcs(
        Object.fromEntries(Object.entries(binding).filter(([key]) => key !== 'bindingHash')),
      )
  ) {
    fail(
      'EXECUTOR_UNAVAILABLE',
      'Trusted connector binding is invalid or does not belong to the selected Executor.',
      {
        executorId: executor?.executorId ?? null,
      },
    );
  }
  return binding;
}

const EXECUTOR_INPUT_FIELDS = Object.freeze([
  'kind',
  'schemaVersion',
  'protocolVersion',
  'operation',
  'payload',
  'rollbackBaseline',
  'requestFingerprint',
  'envelopeHash',
]);
const PAYLOAD_FIELDS = Object.freeze(['artifactId', 'contentHash', 'value']);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function immutableOperationRequest(operation) {
  return {
    operationId: operation.operationId,
    operationKind: operation.operationKind,
    action: clone(operation.action),
    assignmentId: operation.assignmentId,
    evaluationId: operation.evaluationId,
    approvalIds: clone(operation.approvalIds),
    grantId: operation.grantId,
    capability: clone(operation.capability),
    target: clone(operation.target),
    effectClass: operation.effectClass,
    executor: clone(operation.executor),
    connector: clone(operation.connector),
    preconditionArtifactIds: clone(operation.preconditionArtifactIds),
    inputArtifactIds: clone(operation.inputArtifactIds),
    verificationPlanId: operation.verificationPlanId,
    rollbackClass: operation.rollbackClass,
    intentEventId: operation.intentEventId,
    rollbackPlanId: operation.rollbackPlanId,
    parentOperationId: operation.parentOperationId,
    createdAt: operation.createdAt,
  };
}

function assertExecutorPayload(value, field, operation) {
  if (
    !exactRecord(value, PAYLOAD_FIELDS) ||
    typeof value.artifactId !== 'string' ||
    !operation.inputArtifactIds.includes(value.artifactId) ||
    typeof value.contentHash !== 'string' ||
    !HASH_PATTERN.test(value.contentHash) ||
    value.contentHash !== sha256Jcs(value.value)
  ) {
    fail(
      'OPERATION_CONFLICT',
      `${field} must be one exact reviewed Artifact identity, content hash, and closed value.`,
      {
        operationId: operation.operationId,
        field,
      },
    );
  }
  assertClosedExecutorValue(value.value, `${field}.value`);
}

function assertClosedExecutorValue(value, path) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      fail('OPERATION_CONFLICT', `Executor input must be finite at ${path}.`, { path });
    }
    return;
  }
  const expectedPrototype = Array.isArray(value) ? Array.prototype : Object.prototype;
  if (
    !value ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== expectedPrototype ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    fail('OPERATION_CONFLICT', `Executor input must use plain closed data at ${path}.`, { path });
  }
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (
      !Object.hasOwn(descriptor, 'value') ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      typeof descriptor.value === 'function'
    ) {
      fail(
        'OPERATION_CONFLICT',
        `Executor input cannot contain executable data at ${path}.${key}.`,
        { path: `${path}.${key}` },
      );
    }
    assertClosedExecutorValue(descriptor.value, `${path}.${key}`);
  }
}

export function deriveContainedExecutorRequestFingerprintV2({
  operation,
  payload,
  rollbackBaseline,
} = {}) {
  assertClosedExecutorValue(operation, 'operation');
  try {
    assertProtocolArtifact('operating-governed-operation', operation, {
      protocolVersion: PROTOCOL_VERSION,
    });
  } catch (cause) {
    fail(
      'OPERATION_CONFLICT',
      'Executor request fingerprint requires one contract-valid governed operation.',
      {
        cause: cause?.code ?? null,
      },
    );
  }
  if (!exactRecord(operation.target, ['kind', 'id', 'revision'])) {
    fail('OPERATION_CONFLICT', 'Executor request target must be one exact plain target binding.', {
      operationId: operation.operationId,
    });
  }
  assertExecutorPayload(payload, 'payload', operation);
  if ((operation.rollbackClass === 'not-applicable') !== (rollbackBaseline === null)) {
    fail(
      'OPERATION_CONFLICT',
      'Rollback baseline presence must equal the governed rollback classification.',
      {
        operationId: operation.operationId,
      },
    );
  }
  if (rollbackBaseline !== null)
    assertExecutorPayload(rollbackBaseline, 'rollbackBaseline', operation);
  return deriveContainedExecutorRequestFingerprintFromBindingV2({
    operation,
    payload: { artifactId: payload.artifactId, contentHash: payload.contentHash },
    rollbackBaseline:
      rollbackBaseline === null
        ? null
        : {
            artifactId: rollbackBaseline.artifactId,
            contentHash: rollbackBaseline.contentHash,
          },
  });
}

export function deriveContainedExecutorRequestFingerprintFromBindingV2({
  operation,
  payload,
  rollbackBaseline,
} = {}) {
  if (
    !exactRecord(payload, ['artifactId', 'contentHash']) ||
    typeof payload.artifactId !== 'string' ||
    !operation?.inputArtifactIds?.includes(payload.artifactId) ||
    typeof payload.contentHash !== 'string' ||
    !HASH_PATTERN.test(payload.contentHash) ||
    (rollbackBaseline !== null &&
      (!exactRecord(rollbackBaseline, ['artifactId', 'contentHash']) ||
        typeof rollbackBaseline.artifactId !== 'string' ||
        !operation?.inputArtifactIds?.includes(rollbackBaseline.artifactId) ||
        typeof rollbackBaseline.contentHash !== 'string' ||
        !HASH_PATTERN.test(rollbackBaseline.contentHash))) ||
    (operation?.rollbackClass === 'not-applicable') !== (rollbackBaseline === null)
  ) {
    fail(
      'OPERATION_CONFLICT',
      'Executor request binding must contain only exact reviewed Artifact identities and canonical hashes.',
      {
        operationId: operation?.operationId ?? null,
      },
    );
  }
  return sha256Jcs({
    contract: { id: 'operate-contained-executor-input', version: '1.0.0' },
    operation: immutableOperationRequest(operation),
    payload,
    rollbackBaseline,
  });
}

export function createContainedExecutorInputEnvelopeV2({
  operation,
  payload,
  rollbackBaseline = null,
} = {}) {
  const requestFingerprint = deriveContainedExecutorRequestFingerprintV2({
    operation,
    payload,
    rollbackBaseline,
  });
  if (operation.requestFingerprint !== requestFingerprint) {
    fail(
      'OPERATION_CONFLICT',
      'Governed operation requestFingerprint must commit the complete executor input envelope.',
      {
        operationId: operation.operationId,
      },
    );
  }
  const envelope = {
    kind: 'operate-contained-executor-input',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    operation: clone(operation),
    payload: clone(payload),
    rollbackBaseline: clone(rollbackBaseline),
    requestFingerprint,
  };
  envelope.envelopeHash = sha256Jcs(envelope);
  return freeze(envelope);
}

export function assertContainedExecutorInputEnvelopeV2(
  envelope,
  { operation, rollbackPlan = null } = {},
) {
  assertClosedExecutorValue(envelope, 'executorInput');
  if (
    !exactRecord(envelope, EXECUTOR_INPUT_FIELDS) ||
    !exactRecord(envelope?.payload, PAYLOAD_FIELDS) ||
    (envelope?.rollbackBaseline !== null &&
      !exactRecord(envelope?.rollbackBaseline, PAYLOAD_FIELDS)) ||
    envelope.kind !== 'operate-contained-executor-input' ||
    envelope.schemaVersion !== '1.0.0' ||
    envelope.protocolVersion !== PROTOCOL_VERSION ||
    !sameJson(envelope.operation, operation) ||
    envelope.requestFingerprint !== operation?.requestFingerprint ||
    envelope.envelopeHash !==
      sha256Jcs(
        Object.fromEntries(Object.entries(envelope).filter(([key]) => key !== 'envelopeHash')),
      )
  ) {
    fail(
      'OPERATION_CONFLICT',
      'Executor input envelope must be plain, closed, exact, and bound to the governed operation.',
      {
        operationId: operation?.operationId ?? null,
      },
    );
  }
  const expected = deriveContainedExecutorRequestFingerprintV2({
    operation,
    payload: envelope.payload,
    rollbackBaseline: envelope.rollbackBaseline,
  });
  if (expected !== envelope.requestFingerprint) {
    fail(
      'OPERATION_CONFLICT',
      'Executor payload or rollback baseline diverges from the authorized request fingerprint.',
      {
        operationId: operation.operationId,
      },
    );
  }
  if (
    operation.operationKind === 'rollback' &&
    (rollbackPlan === null ||
      envelope.rollbackBaseline?.artifactId !== rollbackPlan.baselineArtifactId ||
      envelope.rollbackBaseline?.contentHash !== rollbackPlan.baselineHash)
  ) {
    fail(
      'ROLLBACK_NOT_ELIGIBLE',
      'Rollback executor input must equal the authorized rollback-plan baseline identity and hash.',
      {
        operationId: operation.operationId,
      },
    );
  }
  return envelope;
}
