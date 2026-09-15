import {
  assertOperateRoleOutputContractV2,
  assertProtocolArtifact,
} from '../protocol/contracts.mjs';
import { OPERATE_CONTRACT_CATALOG_V2 } from '../protocol/generated/contract-catalog-v2.mjs';
import {
  OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
  createOperateEvidenceRegistryV2,
} from './evidence-registry-v2.mjs';
import {
  OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
  createOperateGovernedExtensionRegistryV2,
} from './governed-extensions-v2.mjs';

const VERSION = '2.0.0';
const KERNEL_ROLE_KINDS = Object.freeze(['advisor', 'challenger', 'chair']);
const FORBIDDEN_BUSINESS_ROLE_IDS_V1 = new Set(['cfo', 'finance-cfo', 'product-owner']);
const FORBIDDEN_SOFTWARE_EXECUTIVE_ROLE_IDS_V1 = new Set([
  'growth-market',
  'independent-challenge',
  'operations-customer',
  'product-activation',
  'strategy-finance',
  'technology-risk',
]);
const ANALYSIS_RUBRIC_CLAUSES = Object.freeze([
  'requiredQuestions', 'requiredEvidence', 'failureModes', 'artifactQualityBar', 'outOfScope',
]);

/**
 * Values below these fields are natural-language contract text, not identifiers.
 * A rubric must be able to name approval, policy, and customer contact as things
 * a seat is forbidden to do, so the identifier word-lists do not apply to them.
 * Authority-bearing field names and structural checks still apply.
 */
const PROSE_FIELDS = new Set([
  'analysisProfile',
  'analysisRubric',
  'evidenceRequirements',
  'mandate',
  'resultRequirements',
  'selfAudit',
  'scope',
  'allowedEvidence',
]);
const DOMAIN_KIND = 'operate-domain-registration';
const RUNTIME_KIND = 'agent-runtime-manifest';

const SIGNAL_PROVIDER_KINDS = Object.freeze({
  snapshot: Object.freeze({
    contractKind: 'operate-snapshot-provider-registration',
    registryField: 'snapshotProviders',
    providerId: 'open-reference-snapshot-provider',
    providerVersion: '1.0.0',
    implementationId: 'open-reference-snapshot-provider-v2',
    inputSchemaId: 'operating-artifact',
    outputSchemaId: 'operating-snapshot',
  }),
  metric: Object.freeze({
    contractKind: 'operate-metric-provider-registration',
    registryField: 'metricProviders',
    providerId: 'open-reference-metric-provider',
    providerVersion: '1.0.0',
    implementationId: 'open-reference-metric-provider-v2',
    inputSchemaId: 'operating-metric',
    outputSchemaId: 'operating-metric-observation',
  }),
  verification: Object.freeze({
    contractKind: 'operate-verification-provider-registration',
    registryField: 'verificationProviders',
    providerId: 'open-reference-verification-provider',
    providerVersion: '1.0.0',
    implementationId: 'open-reference-verification-provider-v2',
    inputSchemaId: 'operating-action-verification-plan',
    outputSchemaId: 'operating-outcome',
  }),
});

export const PUBLIC_OPERATE_DOMAIN_BINDINGS_V2 = Object.freeze({
  business: Object.freeze({
    apiDomainId: 'business', id: 'business-domain', version: '1.0.0',
    projection: Object.freeze({ schemaId: 'business-operating-snapshot-projection', schemaVersion: '1.0.0' }),
  }),
  software: Object.freeze({
    apiDomainId: 'software', id: 'software-domain', version: '1.0.0',
    projection: Object.freeze({ schemaId: 'software-operating-snapshot-projection', schemaVersion: '1.0.0' }),
  }),
});

export const DEFERRED_OPERATE_EXTENSION_KINDS_V2 = Object.freeze([]);

export class OperatingExtensionRegistryErrorV2 extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'OperatingExtensionRegistryErrorV2';
    this.code = code;
    this.details = Object.freeze(structuredClone(details));
  }
}

function fail(code, message, details) {
  throw new OperatingExtensionRegistryErrorV2(code, message, details);
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertPortableDeclaration(value, path = '$', prose = false, identity = false) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPortableDeclaration(entry, `${path}[${index}]`, prose, identity));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => (
      assertPortableDeclaration(
        entry,
        `${path}.${key}`,
        prose || PROSE_FIELDS.has(key),
        identity || key === 'roleId' || key === 'label' || key === 'term'
          || key === 'allowedCapabilities' || key === 'forbiddenEffects' || key === 'skillId',
      )
    ));
    return;
  }
  if (typeof value !== 'string') return;
  if (
    value.includes('\u0000')
    || value.startsWith('/')
    || value.startsWith('~')
    || value.split(/[\\/]/u).includes('..')
    || (!prose && !identity && /\b(?:private[-_ ]?consumer|customer|tenant|credential|secret|api[-_ ]?key|access[-_ ]?token|codex|claude|cursor|openai|anthropic|gpt|sonnet|opus)\b/iu.test(value))
  ) {
    fail('E_EXTENSION_REGISTRATION_INVALID', `Extension registration contains a non-portable declaration at ${path}.`, { path });
  }
}

function isPolicyRequirementPath(path) {
  return path === '$.policyRequirements' || /\.policyRequirements\[\d+\]/u.test(path);
}

function assertDataOnly(value, path = '$', prose = false) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertDataOnly(entry, `${path}[${index}]`, prose));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => {
      const childPath = `${path}.${key}`;
      const declaredPolicyBinding = /\.policyRequirements\[\d+\]$/u.test(path) && key === 'policy';
      if (!isPolicyRequirementPath(path) && !declaredPolicyBinding && /^(?:function|path|module|url|connector|credential|policy|approval|executor|transition|grant|dynamicImport)$/iu.test(key)) {
        fail('E_EXTENSION_REGISTRATION_INVALID', `Extension registration has an authority-bearing field at ${childPath}.`, { path: childPath });
      }
      assertDataOnly(entry, childPath, prose || PROSE_FIELDS.has(key) || isPolicyRequirementPath(childPath));
    });
    return;
  }
  if (typeof value !== 'string') return;
  if (!prose && !isPolicyRequirementPath(path) && /\b(?:dynamic[- ]?import|external[- ]?effect|network|filesystem|connector|executor|policy|approval|capability[- ]?grant)\b/iu.test(value)) {
    fail('E_EXTENSION_REGISTRATION_INVALID', `Extension registration contains an authority-bearing declaration at ${path}.`, { path });
  }
}

function domainArtifact(registration) {
  return { kind: DOMAIN_KIND, schemaVersion: '1.0.0', protocolVersion: VERSION, ...clone(registration) };
}

function runtimeArtifact(manifest) {
  return { kind: RUNTIME_KIND, schemaVersion: '1.0.0', protocolVersion: VERSION, ...clone(manifest) };
}

function providerArtifact(kind, registration) {
  return { kind: SIGNAL_PROVIDER_KINDS[kind].contractKind, schemaVersion: '1.0.0', protocolVersion: VERSION, ...clone(registration) };
}

function assertRubric(domain, role) {
  const rubric = role.analysisRubric;
  const clauses = rubric === null || typeof rubric !== 'object' || Array.isArray(rubric)
    ? null
    : Object.keys(rubric).sort();
  const complete = clauses !== null
    && clauses.length === ANALYSIS_RUBRIC_CLAUSES.length
    && ANALYSIS_RUBRIC_CLAUSES.every((clause) => clauses.includes(clause))
    && ANALYSIS_RUBRIC_CLAUSES.every((clause) => (
      Array.isArray(rubric[clause])
      && rubric[clause].length > 0
      && rubric[clause].every((text) => typeof text === 'string' && text.trim().length > 0)
      && new Set(rubric[clause]).size === rubric[clause].length
    ));
  if (!complete) {
    fail('E_EXTENSION_REGISTRATION_INVALID', 'A domain role requires a complete versioned analysis rubric.', {
      domainId: domain.domainId, roleId: role.roleId, roleVersion: role.roleVersion,
    });
  }
}

function assertRoles(value) {
  const roles = new Set();
  const kinds = new Map(KERNEL_ROLE_KINDS.map((kind) => [kind, 0]));
  for (const role of value.roles) {
    const identity = `${role.roleId}@${role.roleVersion}`;
    if (roles.has(identity)) {
      fail('E_EXTENSION_REGISTRATION_CONFLICT', 'A domain cannot register the same role identity twice.', {
        domainId: value.domainId, domainVersion: value.domainVersion, roleId: role.roleId, roleVersion: role.roleVersion,
      });
    }
    roles.add(identity);
    if (!kinds.has(role.roleKind)) {
      fail('E_EXTENSION_REGISTRATION_INVALID', 'A domain role must declare one kernel scheduling kind.', {
        domainId: value.domainId, roleId: role.roleId, roleKind: role.roleKind,
      });
    }
    if (role.roleId === role.label) {
      fail('E_EXTENSION_REGISTRATION_INVALID', 'A presentation label cannot stand in for a role identity.', {
        domainId: value.domainId, roleId: role.roleId,
      });
    }
    if (value.domainId === 'business' && value.domainVersion === '1.0.0' && FORBIDDEN_BUSINESS_ROLE_IDS_V1.has(role.roleId)) {
      fail('E_EXTENSION_REGISTRATION_INVALID', 'A business registration cannot introduce a forbidden finance or product-owner seat.', {
        domainId: value.domainId, roleId: role.roleId,
      });
    }
    if (value.domainId === 'software' && value.domainVersion === '1.0.0' && FORBIDDEN_SOFTWARE_EXECUTIVE_ROLE_IDS_V1.has(role.roleId)) {
      fail('E_EXTENSION_REGISTRATION_INVALID', 'A software registration cannot copy a business executive identity.', {
        domainId: value.domainId, roleId: role.roleId,
      });
    }
    kinds.set(role.roleKind, kinds.get(role.roleKind) + 1);
    assertRubric(value, role);
    assertOperateRoleOutputContractV2(role.roleKind, role.output, { roleVersion: role.roleVersion });
  }
  const choreography = kinds.get('advisor') >= 1 && kinds.get('challenger') === 1 && kinds.get('chair') === 1;
  if (!choreography) {
    fail('E_EXTENSION_REGISTRATION_INVALID', 'A public domain requires at least one advisor and exactly one challenger and chair.', {
      domainId: value.domainId,
      declared: Object.fromEntries(kinds),
    });
  }
}

function expectedSyntheticBinding(value) {
  return {
    apiDomainId: value.domainId,
    id: `${value.domainId}-domain`,
    version: value.domainVersion,
  };
}

function assertDomain(value, { allowSyntheticDomains }) {
  assertPortableDeclaration(value);
  assertDataOnly(value);
  assertProtocolArtifact(DOMAIN_KIND, value, { protocolVersion: VERSION });
  assertRoles(value);
  const expected = PUBLIC_OPERATE_DOMAIN_BINDINGS_V2[value.domainId];
  if (expected) {
    if (value.domainVersion !== expected.version
      || !sameJson(value.domainContract, { apiDomainId: expected.apiDomainId, id: expected.id, version: expected.version })
      || value.projectionContracts.length !== 1
      || !sameJson(value.projectionContracts[0], expected.projection)) {
      fail('E_EXTENSION_REGISTRATION_INVALID', 'Public API domains require their exact explicit contract and projection bindings.', {
        domainId: value.domainId, domainVersion: value.domainVersion,
      });
    }
  } else {
    if (!allowSyntheticDomains || value.domainId !== 'synthetic-domain'
      || !sameJson(value.domainContract, expectedSyntheticBinding(value))
      || value.projectionContracts.length !== 1
      || !sameJson(value.projectionContracts[0], { schemaId: 'operating-domain-projection', schemaVersion: '2.0.0' })) {
      fail('E_EXTENSION_REGISTRATION_INVALID', 'Only an explicit test-only synthetic domain may accompany the two public domains.', {
        domainId: value.domainId,
      });
    }
  }
  if (value.requestedCapabilities.length !== 0) {
    fail('E_EXTENSION_REGISTRATION_INVALID', 'Domain registration is data-only and cannot request an authority-bearing capability.', {
      domainId: value.domainId,
    });
  }
  return {
    ...clone(value),
    roles: value.roles.map((role) => ({
      ...clone(role),
      requirements: [...role.requirements].sort(),
    })).sort((left, right) => (
      left.roleId.localeCompare(right.roleId) || left.roleVersion.localeCompare(right.roleVersion)
    )),
    vocabulary: value.vocabulary.map(clone).sort((left, right) => left.term.localeCompare(right.term)),
    projectionContracts: value.projectionContracts.map(clone).sort((left, right) => (
      left.schemaId.localeCompare(right.schemaId) || left.schemaVersion.localeCompare(right.schemaVersion)
    )),
    actionKinds: value.actionKinds.map(clone).sort((left, right) => (
      left.id.localeCompare(right.id) || left.version.localeCompare(right.version)
    )),
    requestedCapabilities: value.requestedCapabilities.map(clone).sort((left, right) => (
      left.id.localeCompare(right.id) || left.version.localeCompare(right.version)
    )),
    requirements: [...value.requirements].sort(),
  };
}

function assertRuntime(value) {
  assertPortableDeclaration(value);
  assertProtocolArtifact(RUNTIME_KIND, value, { protocolVersion: VERSION });
  return value;
}

function expectedSupportedDomains() {
  return Object.values(PUBLIC_OPERATE_DOMAIN_BINDINGS_V2).map(({ apiDomainId, id, version }) => ({
    apiDomainId, domainContractId: id, domainContractVersion: version,
  })).sort((left, right) => left.apiDomainId.localeCompare(right.apiDomainId));
}

function assertSignalProvider(kind, value) {
  const expected = SIGNAL_PROVIDER_KINDS[kind];
  assertPortableDeclaration(value);
  assertDataOnly(value);
  assertProtocolArtifact(expected.contractKind, value, { protocolVersion: VERSION });
  const actualDomains = [...value.supportedDomains].sort((left, right) => left.apiDomainId.localeCompare(right.apiDomainId));
  if (value.providerId !== expected.providerId
    || value.providerVersion !== expected.providerVersion
    || value.implementation.kind !== 'built-in'
    || value.implementation.id !== expected.implementationId
    || value.inputContract.schemaId !== expected.inputSchemaId
    || value.inputContract.schemaVersion !== VERSION
    || value.outputContract.schemaId !== expected.outputSchemaId
    || value.outputContract.schemaVersion !== VERSION
    || value.accessMode !== 'accepted-input-only'
    || value.returnSemantics !== 'candidate'
    || value.fallback.kind !== 'unavailable'
    || value.fallback.errorCode !== 'OPERATING_PROVIDER_UNAVAILABLE'
    || !sameJson(actualDomains, expectedSupportedDomains())) {
    fail('E_EXTENSION_REGISTRATION_INVALID', 'Signal providers must use one exact public built-in declaration and public domain bindings.', {
      providerKind: kind, providerId: value.providerId,
    });
  }
  return value;
}

function index(entries, identity, label) {
  const indexed = new Map();
  for (const entry of entries) {
    const key = identity(entry);
    if (indexed.has(key)) fail('E_EXTENSION_REGISTRATION_CONFLICT', `Duplicate ${label} registration ${key}.`, { key });
    indexed.set(key, freeze(clone(entry)));
  }
  return indexed;
}

function publicRegistry({
  domains,
  agentRuntimeManifests,
  evidenceProviders,
  evidenceResolvers,
  snapshotProviders,
  metricProviders,
  verificationProviders,
  capabilityProviders,
  policyProviders,
  executors,
  allowSyntheticDomains,
}) {
  const domainIndex = index(domains.map((entry) => assertDomain(entry, { allowSyntheticDomains })), ({ domainId, domainVersion }) => `${domainId}@${domainVersion}`, 'domain');
  const publicDomainKeys = Object.keys(PUBLIC_OPERATE_DOMAIN_BINDINGS_V2).map((domainId) => `${domainId}@1.0.0`);
  if (!publicDomainKeys.every((key) => domainIndex.has(key))) {
    fail('E_EXTENSION_REGISTRATION_INVALID', 'The public registry must contain both exact business and software domains.', {});
  }
  const runtimeIndex = index(agentRuntimeManifests.map(assertRuntime), ({ runtimeId, runtimeVersion }) => `${runtimeId}@${runtimeVersion}`, 'agent runtime');
  const providerIndexes = Object.fromEntries(Object.entries({ snapshot: snapshotProviders, metric: metricProviders, verification: verificationProviders })
    .map(([kind, registrations]) => [kind, index(registrations.map((entry) => assertSignalProvider(kind, entry)), ({ providerId, providerVersion }) => `${providerId}@${providerVersion}`, `${kind} provider`)]));
  for (const [kind, expected] of Object.entries(SIGNAL_PROVIDER_KINDS)) {
    const providers = providerIndexes[kind];
    if (providers.size !== 1 || !providers.has(`${expected.providerId}@${expected.providerVersion}`)) {
      fail('E_EXTENSION_REGISTRATION_INVALID', 'The public registry must contain one exact reference provider for each signal kind.', {
        providerKind: kind,
      });
    }
  }
  const evidence = createOperateEvidenceRegistryV2({ providers: evidenceProviders, resolvers: evidenceResolvers });
  const governed = createOperateGovernedExtensionRegistryV2({
    capabilityProviders,
    policyProviders,
    executors,
  });
  for (const manifest of runtimeIndex.values()) {
    if (manifest.fallback.kind === 'runtime') {
      const fallbackKey = `${manifest.fallback.runtimeId}@${manifest.fallback.runtimeVersion}`;
      if (fallbackKey === `${manifest.runtimeId}@${manifest.runtimeVersion}` || !runtimeIndex.has(fallbackKey)) {
        fail('E_EXTENSION_REGISTRATION_CONFLICT', 'An agent runtime fallback must name a different registered runtime.', {
          runtimeId: manifest.runtimeId, runtimeVersion: manifest.runtimeVersion,
        });
      }
    }
  }
  return freeze({
    domains: [...domainIndex.values()].sort((left, right) => `${left.domainId}@${left.domainVersion}`.localeCompare(`${right.domainId}@${right.domainVersion}`)),
    agentRuntimeManifests: [...runtimeIndex.values()].sort((left, right) => `${left.runtimeId}@${left.runtimeVersion}`.localeCompare(`${right.runtimeId}@${right.runtimeVersion}`)),
    evidenceProviders: evidence.providers,
    evidenceResolvers: evidence.resolvers,
    snapshotProviders: [...providerIndexes.snapshot.values()].sort((left, right) => `${left.providerId}@${left.providerVersion}`.localeCompare(`${right.providerId}@${right.providerVersion}`)),
    metricProviders: [...providerIndexes.metric.values()].sort((left, right) => `${left.providerId}@${left.providerVersion}`.localeCompare(`${right.providerId}@${right.providerVersion}`)),
    verificationProviders: [...providerIndexes.verification.values()].sort((left, right) => `${left.providerId}@${left.providerVersion}`.localeCompare(`${right.providerId}@${right.providerVersion}`)),
    capabilityProviders: governed.capabilityProviders,
    policyProviders: governed.policyProviders,
    executors: governed.executors,
  });
}

/**
 * Construct a read-only registration index. It validates declarations only:
 * it never loads code, invokes a provider, opens a connection, grants a
 * capability, or changes a core lifecycle projection.
 */
export function createOperateExtensionRegistryV2(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.getPrototypeOf(input) !== Object.prototype
    || Object.getOwnPropertySymbols(input).length > 0) {
    fail('E_EXTENSION_REGISTRATION_INVALID', 'Extension registrations must be an object of arrays.', {});
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Object.values(descriptors).some((descriptor) => !Object.hasOwn(descriptor, 'value')
    || descriptor.get !== undefined || descriptor.set !== undefined)) {
    fail('E_EXTENSION_REGISTRATION_INVALID', 'Extension registration input must contain data properties only.', {});
  }
  const allowed = new Set(['domains', 'agentRuntimeManifests', 'evidenceProviders', 'evidenceResolvers', 'snapshotProviders', 'metricProviders', 'verificationProviders', 'capabilityProviders', 'policyProviders', 'executors', 'allowSyntheticDomains']);
  const unknown = Object.getOwnPropertyNames(input).filter((key) => !allowed.has(key));
  if (unknown.length > 0) fail('E_EXTENSION_REGISTRATION_INVALID', 'Extension registration input contains unsupported fields.', { unknown: unknown.sort() });
  const {
    domains = OPERATE_CONTRACT_CATALOG_V2.extensions.domains.map(domainArtifact),
    agentRuntimeManifests = OPERATE_CONTRACT_CATALOG_V2.extensions.agentRuntimeManifests.map(runtimeArtifact),
    evidenceProviders = OPEN_REFERENCE_EVIDENCE_REGISTRY_V2.providers,
    evidenceResolvers = OPEN_REFERENCE_EVIDENCE_REGISTRY_V2.resolvers,
    snapshotProviders = OPERATE_CONTRACT_CATALOG_V2.extensions.snapshotProviders.map((entry) => providerArtifact('snapshot', entry)),
    metricProviders = OPERATE_CONTRACT_CATALOG_V2.extensions.metricProviders.map((entry) => providerArtifact('metric', entry)),
    verificationProviders = OPERATE_CONTRACT_CATALOG_V2.extensions.verificationProviders.map((entry) => providerArtifact('verification', entry)),
    capabilityProviders = OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.capabilityProviders,
    policyProviders = OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.policyProviders,
    executors = OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.executors,
    allowSyntheticDomains = false,
  } = input;
  if (![domains, agentRuntimeManifests, evidenceProviders, evidenceResolvers, snapshotProviders, metricProviders, verificationProviders, capabilityProviders, policyProviders, executors].every(Array.isArray)
    || typeof allowSyntheticDomains !== 'boolean') {
    fail('E_EXTENSION_REGISTRATION_INVALID', 'Extension registrations must contain arrays and an optional boolean synthetic-domain test flag.', {});
  }
  return publicRegistry({
    domains, agentRuntimeManifests, evidenceProviders, evidenceResolvers,
    snapshotProviders, metricProviders, verificationProviders,
    capabilityProviders, policyProviders, executors, allowSyntheticDomains,
  });
}

export const OPEN_REFERENCE_OPERATE_EXTENSIONS_V2 = createOperateExtensionRegistryV2();

const COMPLETE_REGISTRY_FIELDS = Object.freeze([
  'domains',
  'agentRuntimeManifests',
  'evidenceProviders',
  'evidenceResolvers',
  'snapshotProviders',
  'metricProviders',
  'verificationProviders',
  'capabilityProviders',
  'policyProviders',
  'executors',
].sort());

/**
 * Validate and canonicalize a complete public registry at a consumer boundary.
 * Partial construction is intentionally reserved for registry assembly; public
 * consumers must never silently fill omitted fields from their own defaults.
 */
export function canonicalizeOperateExtensionRegistryV2(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    fail('E_EXTENSION_REGISTRATION_INVALID', 'A public Operate extension registry must be a complete object.', {});
  }
  const prototype = Object.getPrototypeOf(registry);
  if (prototype !== Object.prototype || Object.getOwnPropertySymbols(registry).length > 0) {
    fail('E_EXTENSION_REGISTRATION_INVALID', 'A public Operate extension registry must be a plain data object.', {});
  }
  const descriptors = Object.getOwnPropertyDescriptors(registry);
  const keys = Object.keys(descriptors).sort();
  if (keys.length !== COMPLETE_REGISTRY_FIELDS.length
    || keys.some((key, index) => key !== COMPLETE_REGISTRY_FIELDS[index])) {
    fail('E_EXTENSION_REGISTRATION_INVALID', 'A public Operate extension registry must declare exactly every registry field.', {
      fields: keys,
    });
  }
  const input = {};
  for (const field of COMPLETE_REGISTRY_FIELDS) {
    const descriptor = descriptors[field];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !Array.isArray(descriptor.value)) {
      fail('E_EXTENSION_REGISTRATION_INVALID', 'A public Operate extension registry must contain only data-array fields.', {
        field,
      });
    }
    input[field] = descriptor.value;
  }
  return createOperateExtensionRegistryV2(input);
}

function explicitVersion(version, subject) {
  if (typeof version !== 'string' || version.length === 0) {
    fail('E_EXTENSION_VERSION_REQUIRED', `${subject} requires an explicit version.`);
  }
}

export function findOperateDomainRegistrationV2(registry, domainId, { domainVersion } = {}) {
  explicitVersion(domainVersion, `Domain registration ${domainId}`);
  const match = registry?.domains?.find((entry) => entry.domainId === domainId && entry.domainVersion === domainVersion);
  return match === undefined ? null : clone(match);
}

export function findAgentRuntimeManifestV2(registry, runtimeId, { runtimeVersion } = {}) {
  explicitVersion(runtimeVersion, `Agent runtime ${runtimeId}`);
  const match = registry?.agentRuntimeManifests?.find((entry) => entry.runtimeId === runtimeId && entry.runtimeVersion === runtimeVersion);
  return match === undefined ? null : clone(match);
}

function findSignalProvider(registry, kind, providerId, { providerVersion } = {}) {
  explicitVersion(providerVersion, `${kind} provider ${providerId}`);
  const field = SIGNAL_PROVIDER_KINDS[kind]?.registryField;
  const match = registry?.[field]?.find((entry) => entry.providerId === providerId && entry.providerVersion === providerVersion);
  return match === undefined ? null : clone(match);
}

export function findOperateSnapshotProviderRegistrationV2(registry, providerId, options = {}) {
  return findSignalProvider(registry, 'snapshot', providerId, options);
}

export function findOperateMetricProviderRegistrationV2(registry, providerId, options = {}) {
  return findSignalProvider(registry, 'metric', providerId, options);
}

export function findOperateVerificationProviderRegistrationV2(registry, providerId, options = {}) {
  return findSignalProvider(registry, 'verification', providerId, options);
}

/** Select only an explicitly registered runtime; selection never imports, invokes, or grants it anything. */
export function selectAgentRuntimeManifestV2(registry, runtimeId, { runtimeVersion } = {}) {
  const manifest = findAgentRuntimeManifestV2(registry, runtimeId, { runtimeVersion });
  if (manifest === null) return freeze({ status: 'unavailable', manifest: null, fallback: null });
  if (manifest.implementation.availability === 'available') return freeze({ status: 'available', manifest, fallback: null });
  if (manifest.fallback.kind === 'runtime') {
    const fallback = findAgentRuntimeManifestV2(registry, manifest.fallback.runtimeId, { runtimeVersion: manifest.fallback.runtimeVersion });
    if (fallback?.implementation.availability === 'available') {
      return freeze({ status: 'fallback', manifest: fallback, fallback: { runtimeId: fallback.runtimeId, runtimeVersion: fallback.runtimeVersion } });
    }
  }
  return freeze({ status: 'unavailable', manifest: null, fallback: null });
}
