import {
  OPERATE_EVIDENCE_KINDS_V2,
  OPERATE_EVIDENCE_RESOLVER_ERROR_CODES_V2,
  assertProtocolArtifact,
} from '../protocol/contracts.mjs';

const VERSION = '2.0.0';
const PROVIDER_KIND = 'operate-evidence-provider-registration';
const RESOLVER_KIND = 'operate-evidence-resolver-registration';
const OPEN_REFERENCE_SOURCE_CONTRACTS = Object.freeze([
  'capacity-throughput',
  'channel-economics',
  'ci-test-evidence',
  'competitor-positioning',
  'context-manifest',
  'demand-market',
  'finance-metrics',
  'incident-history',
  'objective-metrics',
  'operations-customer-health',
  'planning-acceptance',
  'prior-decisions',
  'product-activation',
  'repository-architecture',
  'retention-discovery',
  'support-incidents',
].map((id) => Object.freeze({ id, version: '1.0.0' })));

const REQUIRED_CAPABILITY_BY_KIND = Object.freeze({
  filesystem: 'evidence.filesystem.read',
  git: 'evidence.git.read',
  'operate-artifact': 'evidence.operate-artifact.read',
  planr: 'evidence.planr.read',
});

const RESOLVER_REGISTRATION_ERROR_CODES = Object.freeze([
  'SOURCE_NOT_FOUND',
  'REVISION_NOT_FOUND',
  'OBJECT_TYPE_MISMATCH',
  'PATH_NOT_FOUND',
  'LINE_RANGE_INVALID',
  'ANCESTRY_MISMATCH',
  'ARTIFACT_NOT_FOUND',
  'ARTIFACT_HASH_MISMATCH',
  'SOURCE_UNTRACKED',
  'SOURCE_STALE',
  'CAPABILITY_DENIED',
  'CONSENT_REQUIRED',
  'SENSITIVITY_BLOCKED',
  'SECRET_DETECTED',
  'UNSUPPORTED_EVIDENCE_KIND',
  'EVIDENCE_RESOLVER_UNAVAILABLE',
  'EVIDENCE_SOURCE_SCOPE_MISMATCH',
  'EVIDENCE_LOCATOR_INVALID',
]);

const BUILT_IN_IDENTITIES = Object.freeze({
  filesystem: Object.freeze({
    providerId: 'local-filesystem-evidence-provider',
    providerImplementationId: 'operate-evidence-filesystem-provider-v2',
    resolverId: 'local-filesystem-evidence-resolver',
    resolverImplementationId: 'operate-evidence-filesystem-resolver-v2',
  }),
  git: Object.freeze({
    providerId: 'local-git-evidence-provider',
    providerImplementationId: 'operate-evidence-git-provider-v2',
    resolverId: 'local-git-evidence-resolver',
    resolverImplementationId: 'operate-evidence-git-resolver-v2',
  }),
  'operate-artifact': Object.freeze({
    providerId: 'local-operate-artifact-evidence-provider',
    providerImplementationId: 'operate-evidence-artifact-provider-v2',
    resolverId: 'local-operate-artifact-evidence-resolver',
    resolverImplementationId: 'operate-evidence-artifact-resolver-v2',
  }),
  planr: Object.freeze({
    providerId: 'local-planr-evidence-provider',
    providerImplementationId: 'operate-evidence-planr-provider-v2',
    resolverId: 'local-planr-evidence-resolver',
    resolverImplementationId: 'operate-evidence-planr-resolver-v2',
  }),
});

export const BUILT_IN_EVIDENCE_PROVIDER_IDS_V2 = Object.freeze(
  Object.values(BUILT_IN_IDENTITIES).map(({ providerId }) => providerId).sort(),
);

export const BUILT_IN_EVIDENCE_RESOLVER_IDS_V2 = Object.freeze(
  Object.values(BUILT_IN_IDENTITIES).map(({ resolverId }) => resolverId).sort(),
);

export class OperatingEvidenceRegistryErrorV2 extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'OperatingEvidenceRegistryErrorV2';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details) {
  throw new OperatingEvidenceRegistryErrorV2(code, message, details);
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

function portable(value, path = '$') {
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    fail('E_EVIDENCE_REGISTRATION_INVALID', 'Evidence registration must be JSON-only data.', { path });
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => portable(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => portable(entry, `${path}.${key}`));
    return;
  }
  if (typeof value !== 'string') return;
  if (
    value.includes('\u0000')
    || value.startsWith('/')
    || value.startsWith('~')
    || value.split(/[\\/]/u).includes('..')
    || /(?:^|[^a-z])(?:file|data|node|npm|http|https):/iu.test(value)
    || /\b(?:module|plugin|function|import|require|private[-_ ]?consumer|credential|secret|api[-_ ]?key|access[-_ ]?token|codex|claude|cursor|openai|anthropic)\b/iu.test(value)
  ) {
    fail('E_EVIDENCE_REGISTRATION_INVALID', 'Evidence registration contains a non-portable declaration.', { path });
  }
}

function registrationFor(kind, identity, { resolver = false } = {}) {
  const capability = REQUIRED_CAPABILITY_BY_KIND[kind];
  const base = {
    kind: resolver ? RESOLVER_KIND : PROVIDER_KIND,
    schemaVersion: '1.0.0',
    protocolVersion: VERSION,
    supportedEvidenceKinds: [kind],
    inputContract: { schemaId: 'operating-evidence-candidate', schemaVersion: VERSION },
    outputContract: { schemaId: 'operating-evidence-resolution', schemaVersion: VERSION },
    effectClass: 'local-read-only',
    requiredCapabilities: [capability],
    classificationCeiling: 'restricted',
    retentionClass: 'restricted-machine-local',
    provenance: {
      packageName: 'planr-pipeline',
      // This provenance is part of the preserved v2 registration bytes. The
      // package can advance independently; changing this value would break the
      // digest references in the frozen live-evidence provider registry.
      packageVersion: '0.42.0',
      integrity: `sha256:${'a'.repeat(64)}`,
    },
    conformanceDigest: `sha256:${'b'.repeat(64)}`,
    implementation: {
      kind: 'built-in',
      id: resolver ? identity.resolverImplementationId : identity.providerImplementationId,
    },
    fallback: {
      kind: 'unavailable',
      errorCode: resolver ? 'EVIDENCE_RESOLVER_UNAVAILABLE' : 'EVIDENCE_PROVIDER_UNAVAILABLE',
    },
  };
  if (resolver) {
    return {
      ...base,
      resolverId: identity.resolverId,
      resolverVersion: VERSION,
      supportedSourceContracts: clone(OPEN_REFERENCE_SOURCE_CONTRACTS),
      evidenceRefContract: { schemaId: 'operating-evidence-ref', schemaVersion: VERSION },
      errorCodes: [...RESOLVER_REGISTRATION_ERROR_CODES],
    };
  }
  return {
    ...base,
    providerId: identity.providerId,
    providerVersion: VERSION,
  };
}

export const OPEN_REFERENCE_EVIDENCE_PROVIDERS_V2 = freeze(
  Object.entries(BUILT_IN_IDENTITIES)
    .map(([kind, identity]) => registrationFor(kind, identity))
    .sort((left, right) => left.providerId.localeCompare(right.providerId)),
);

export const OPEN_REFERENCE_EVIDENCE_RESOLVERS_V2 = freeze(
  Object.entries(BUILT_IN_IDENTITIES)
    .map(([kind, identity]) => registrationFor(kind, identity, { resolver: true }))
    .sort((left, right) => left.resolverId.localeCompare(right.resolverId)),
);

function expectedIdentity(registration, { resolver }) {
  const field = resolver ? 'resolverId' : 'providerId';
  const kind = registration.supportedEvidenceKinds?.[0];
  const expected = BUILT_IN_IDENTITIES[kind];
  if (!expected || registration.supportedEvidenceKinds.length !== 1 || registration[field] !== expected[field]) {
    fail('E_EVIDENCE_REGISTRATION_INVALID', 'Evidence registration must name one supported built-in implementation.', {
      kind,
      [field]: registration[field],
    });
  }
  const implementationId = resolver ? expected.resolverImplementationId : expected.providerImplementationId;
  if (registration.implementation.kind !== 'built-in' || registration.implementation.id !== implementationId) {
    fail('E_EVIDENCE_REGISTRATION_INVALID', 'Evidence registration implementation must match its explicit built-in identity.', {
      kind,
      implementationId: registration.implementation?.id,
    });
  }
  if (registration.requiredCapabilities.length !== 1 || registration.requiredCapabilities[0] !== REQUIRED_CAPABILITY_BY_KIND[kind]) {
    fail('E_EVIDENCE_REGISTRATION_INVALID', 'Evidence registration must require the exact local read capability for its kind.', {
      kind,
    });
  }
  if (registration.effectClass !== 'local-read-only') {
    fail('E_EVIDENCE_REGISTRATION_INVALID', 'Evidence registration must remain local and read-only.', { kind });
  }
  if (resolver && JSON.stringify(registration.supportedSourceContracts) !== JSON.stringify(OPEN_REFERENCE_SOURCE_CONTRACTS)) {
    fail('E_EVIDENCE_REGISTRATION_INVALID', 'Evidence resolver registration must declare the exact built-in source-contract vocabulary.', {
      kind,
    });
  }
}

function validateRegistration(registration, { resolver }) {
  portable(registration);
  const contractKind = resolver ? RESOLVER_KIND : PROVIDER_KIND;
  assertProtocolArtifact(contractKind, registration, { protocolVersion: VERSION });
  expectedIdentity(registration, { resolver });
  if (resolver && registration.errorCodes.some((code) => !OPERATE_EVIDENCE_RESOLVER_ERROR_CODES_V2.includes(code))) {
    fail('E_EVIDENCE_REGISTRATION_INVALID', 'Evidence resolver registration declares an unsupported error code.');
  }
  return clone(registration);
}

function indexRegistrations(registrations, { resolver }) {
  const identity = resolver
    ? ({ resolverId, resolverVersion }) => `${resolverId}@${resolverVersion}`
    : ({ providerId, providerVersion }) => `${providerId}@${providerVersion}`;
  const label = resolver ? 'resolver' : 'provider';
  const indexed = new Map();
  for (const registration of registrations.map((entry) => validateRegistration(entry, { resolver }))) {
    const key = identity(registration);
    if (indexed.has(key)) {
      fail('E_EVIDENCE_REGISTRATION_CONFLICT', `Duplicate evidence ${label} registration ${key}.`, { key });
    }
    indexed.set(key, freeze(registration));
  }
  return indexed;
}

function ensureArray(value, field) {
  if (!Array.isArray(value)) fail('E_EVIDENCE_REGISTRATION_INVALID', `${field} must be an array.`, { field });
  return value;
}

/**
 * Builds a read-only index of explicit local evidence declarations. It accepts
 * data only, never imports a module, invokes a registration callback, grants a
 * capability, or mutates an Artifact/Event/runtime projection.
 */
export function createOperateEvidenceRegistryV2({
  providers = OPEN_REFERENCE_EVIDENCE_PROVIDERS_V2,
  resolvers = OPEN_REFERENCE_EVIDENCE_RESOLVERS_V2,
} = {}) {
  const providerIndex = indexRegistrations(ensureArray(providers, 'providers'), { resolver: false });
  const resolverIndex = indexRegistrations(ensureArray(resolvers, 'resolvers'), { resolver: true });
  return freeze({
    protocolVersion: VERSION,
    providers: [...providerIndex.values()].sort((left, right) => (
      `${left.providerId}@${left.providerVersion}`.localeCompare(`${right.providerId}@${right.providerVersion}`)
    )),
    resolvers: [...resolverIndex.values()].sort((left, right) => (
      `${left.resolverId}@${left.resolverVersion}`.localeCompare(`${right.resolverId}@${right.resolverVersion}`)
    )),
  });
}

export const OPEN_REFERENCE_EVIDENCE_REGISTRY_V2 = createOperateEvidenceRegistryV2();

function requireVersion(version, subject) {
  if (typeof version !== 'string' || version.length === 0) {
    fail('E_EVIDENCE_VERSION_REQUIRED', `${subject} requires an explicit version.`);
  }
}

export function findOperateEvidenceProviderRegistrationV2(registry, providerId, { providerVersion } = {}) {
  requireVersion(providerVersion, `Evidence provider registration ${providerId}`);
  const registration = registry?.providers?.find((entry) => (
    entry.providerId === providerId && entry.providerVersion === providerVersion
  ));
  return registration === undefined ? null : clone(registration);
}

export function findOperateEvidenceResolverRegistrationV2(registry, resolverId, { resolverVersion } = {}) {
  requireVersion(resolverVersion, `Evidence resolver registration ${resolverId}`);
  const registration = registry?.resolvers?.find((entry) => (
    entry.resolverId === resolverId && entry.resolverVersion === resolverVersion
  ));
  return registration === undefined ? null : clone(registration);
}

function rejection(code, context) {
  return freeze({ status: 'rejected', provider: null, resolver: null, error: { code, retryable: false, context } });
}

function capabilitySet(capabilities) {
  if (!Array.isArray(capabilities) || capabilities.some((capability) => typeof capability !== 'string')) {
    fail('E_EVIDENCE_CAPABILITY_CONTEXT_INVALID', 'Evidence dispatch capabilities must be an explicit array of strings.');
  }
  return new Set(capabilities);
}

function sameScope(candidate, scope) {
  return scope
    && candidate.scopeId === scope.scopeId
    && candidate.domainId === scope.domainId
    && candidate.domainVersion === scope.domainVersion;
}

/**
 * Selects a declared provider/resolver pair without invoking it. The caller's
 * scope and read capabilities are checked at this boundary; candidates and
 * registrations never confer either one.
 */
export function prepareOperateEvidenceDispatchV2(registry, candidate, {
  scope,
  capabilities = [],
} = {}) {
  assertProtocolArtifact('operating-evidence-candidate', candidate, { protocolVersion: VERSION });
  if (!sameScope(candidate, scope)) {
    return rejection('EVIDENCE_SOURCE_SCOPE_MISMATCH', { evidenceKind: candidate.evidenceKind });
  }
  const provider = findOperateEvidenceProviderRegistrationV2(registry, candidate.provider.id, {
    providerVersion: candidate.provider.version,
  });
  if (provider === null) {
    return rejection('EVIDENCE_PROVIDER_UNAVAILABLE', { evidenceKind: candidate.evidenceKind });
  }
  const resolver = findOperateEvidenceResolverRegistrationV2(registry, candidate.resolver.id, {
    resolverVersion: candidate.resolver.version,
  });
  if (resolver === null) {
    const knownResolver = registry?.resolvers?.some(({ resolverId }) => resolverId === candidate.resolver.id);
    return rejection(
      knownResolver ? 'EVIDENCE_RESOLVER_VERSION_UNSUPPORTED' : 'EVIDENCE_RESOLVER_UNREGISTERED',
      { evidenceKind: candidate.evidenceKind, resolverId: candidate.resolver.id },
    );
  }
  if (!OPERATE_EVIDENCE_KINDS_V2.includes(candidate.evidenceKind)
    || !provider.supportedEvidenceKinds.includes(candidate.evidenceKind)
    || !resolver.supportedEvidenceKinds.includes(candidate.evidenceKind)) {
    return rejection('UNSUPPORTED_EVIDENCE_KIND', { evidenceKind: candidate.evidenceKind, resolverId: resolver.resolverId });
  }
  const granted = capabilitySet(capabilities);
  const required = [...new Set([...provider.requiredCapabilities, ...resolver.requiredCapabilities])];
  if (required.some((capability) => !granted.has(capability))) {
    return rejection('CAPABILITY_DENIED', { evidenceKind: candidate.evidenceKind, resolverId: resolver.resolverId });
  }
  return freeze({
    status: 'authorized',
    provider: freeze(provider),
    resolver: freeze(resolver),
    error: null,
  });
}
