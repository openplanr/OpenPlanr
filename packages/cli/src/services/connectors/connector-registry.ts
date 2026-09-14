import { createHash } from 'node:crypto';
import { sha256CanonicalJson } from '../canonical-json.js';

export const CONNECTOR_ADAPTER_CATEGORIES_V2 = Object.freeze([
  'delivery',
  'work',
  'error',
  'product',
  'deployment',
  'business-metrics',
] as const);

export const CONNECTOR_ABSENCE_KINDS_V2 = Object.freeze([
  'missing-consent',
  'missing-credential',
  'stale',
  'unhealthy',
  'provider-unavailable',
  'rate-limited',
  'insufficient-evidence',
  'unsupported',
] as const);

export type ConnectorAdapterCategoryV2 = (typeof CONNECTOR_ADAPTER_CATEGORIES_V2)[number];
export type ConnectorAbsenceKindV2 = (typeof CONNECTOR_ABSENCE_KINDS_V2)[number];
export type ConnectorClassificationV2 = 'public' | 'internal' | 'confidential' | 'restricted';
export type ConnectorJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ConnectorJsonValue[]
  | Readonly<{ [key: string]: ConnectorJsonValue }>;

export type ConnectorProviderIdentityV2 = Readonly<{ id: string; version: string }>;
export type ConnectorSourceContractV2 = Readonly<{ id: string; version: '1.0.0' }>;
export type ConnectorBoundsV2 = Readonly<{
  maxCalls: number;
  maxPages: number;
  maxRecords: number;
  maxBytes: number;
}>;
export type ConnectorHealthProofV2 = Readonly<{
  status: 'available' | 'degraded' | 'unavailable';
  checkedAt: string;
  freshUntil: string;
  proofDigest: `sha256:${string}`;
}>;

export type ConnectorAdapterOperationV2 = Readonly<{
  operation: string;
  collection: string;
  sourceContracts: readonly string[];
}>;

export type ConnectorAdapterDefinitionV2 = Readonly<{
  adapterId: string;
  adapterVersion: string;
  provider: ConnectorProviderIdentityV2;
  category: ConnectorAdapterCategoryV2;
  operations: readonly ConnectorAdapterOperationV2[];
  supportedDomains: readonly string[];
  scopes: readonly string[];
  allowedMethods: readonly ['GET'];
  transport: 'https-or-loopback';
  healthMaxAgeSeconds: number;
  unavailableBehavior: 'typed-absence';
  conformanceDigest: `sha256:${string}`;
}>;

export type ConnectorAdapterNormalizeInputV2 = Readonly<{
  operation: string;
  sourceContract: ConnectorSourceContractV2;
  requestHash: `sha256:${string}`;
  sourceIdentityHash: `sha256:${string}`;
  classification: ConnectorClassificationV2;
  status: 'materialized' | 'absent' | 'uncertain';
  requestedAt: string;
  capturedAt: string;
  freshUntil: string;
  health: ConnectorHealthProofV2;
  bounds: ConnectorBoundsV2;
  payload: unknown;
  absence?: Readonly<{
    kind: ConnectorAbsenceKindV2;
    reasonCode: string;
    required: boolean;
    observedAt: string;
    details: unknown;
  }>;
}>;

export type ConnectorAdapterRecordManifestV2 = Readonly<{
  recordIdentityHash: `sha256:${string}`;
  contentDigest: `sha256:${string}`;
  classification: ConnectorClassificationV2;
}>;

export type ConnectorAdapterAbsenceV2 = Readonly<{
  kind: ConnectorAbsenceKindV2;
  reasonCode: string;
  required: boolean;
  observedAt: string;
  detailsHash: `sha256:${string}`;
}>;

export type ConnectorAdapterResultV2 = Readonly<{
  kind: 'openplanr-live-evidence-adapter-result';
  schemaVersion: '1.0.0';
  provider: ConnectorProviderIdentityV2;
  adapterVersion: string;
  category: ConnectorAdapterCategoryV2;
  operation: string;
  sourceContract: ConnectorSourceContractV2;
  requestHash: `sha256:${string}`;
  sourceIdentityHash: `sha256:${string}`;
  status: 'materialized' | 'absent' | 'uncertain';
  sourceTiming: Readonly<{
    requestedAt: string;
    capturedAt: string;
    freshUntil: string;
  }>;
  health: ConnectorHealthProofV2;
  records: readonly ConnectorAdapterRecordManifestV2[];
  absences: readonly ConnectorAdapterAbsenceV2[];
  redactedBytes: Uint8Array;
  redactedBytesDigest: `sha256:${string}`;
}>;

export type ConnectorAdapterV2 = Readonly<{
  definition: ConnectorAdapterDefinitionV2;
  normalize(input: ConnectorAdapterNormalizeInputV2): ConnectorAdapterResultV2;
}>;

export type LiveEvidenceContractsV2 = Readonly<{
  assertLiveEvidenceProviderRegistrationV2(record: unknown, options?: unknown): unknown;
  assertLiveEvidenceProviderRegistryV2(record: unknown, options?: unknown): unknown;
}>;

export type ConnectorRegistrySelectionV2 = Readonly<{
  providerId: string;
  providerVersion: string;
  adapterVersion: string;
  operation: string;
  sourceContractId: string;
  domainId: string;
}>;

export type ResolvedConnectorAdapterV2 = Readonly<{
  registration: Readonly<Record<string, unknown>>;
  adapter: ConnectorAdapterV2;
}>;

export class ConnectorRegistryError extends Error {
  constructor(
    readonly code:
      | 'LIVE_EVIDENCE_ADAPTER_INVALID'
      | 'LIVE_EVIDENCE_ADAPTER_CONFLICT'
      | 'LIVE_EVIDENCE_PROVIDER_UNAVAILABLE'
      | 'LIVE_EVIDENCE_PROVIDER_INCOMPATIBLE'
      | 'LIVE_EVIDENCE_RESULT_INVALID'
      | 'LIVE_EVIDENCE_RESULT_UNSAFE',
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const TEXT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const ERROR_CODE = /^[A-Z][A-Z0-9_]*$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const SENSITIVE_KEY =
  /(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|api[-_]?key|client[-_]?secret|credential|private[-_]?key)/iu;
const PRIVATE_VALUE =
  /(?:^|[\s"'`(])\/(?:Users|home|private|var|etc|tmp)\/|(?:^|[\s"'`(])[A-Za-z]:[\\/][^\s]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]+|\b(?:api[-_ ]?key|access[-_ ]?token|client[-_ ]?secret|password|passwd|secret|token)\s*[:=]\s*[^\s]+/iu;
const MAX_SAFE_STRING = 2_048;

type MutableJsonObject = { [key: string]: ConnectorJsonValue };

function fail(
  code: ConstructorParameters<typeof ConnectorRegistryError>[0],
  message: string,
): never {
  throw new ConnectorRegistryError(code, message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('LIVE_EVIDENCE_RESULT_INVALID', `${label} must be one object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail('LIVE_EVIDENCE_RESULT_INVALID', `${label} has missing or unsupported fields.`);
  }
}

function safeId(value: unknown, label: string, pattern = TEXT_ID): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('LIVE_EVIDENCE_ADAPTER_INVALID', `${label} is not a closed identifier.`);
  }
  return value;
}

function iso(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    fail('LIVE_EVIDENCE_RESULT_INVALID', `${label} must be an ISO timestamp.`);
  }
  return value;
}

function sortedUnique(values: readonly string[], label: string): readonly string[] {
  if (values.length === 0 || new Set(values).size !== values.length) {
    fail('LIVE_EVIDENCE_ADAPTER_INVALID', `${label} must be non-empty and unique.`);
  }
  const sorted = [...values].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(values) !== JSON.stringify(sorted)) {
    fail('LIVE_EVIDENCE_ADAPTER_INVALID', `${label} must be canonically ordered.`);
  }
  return Object.freeze(sorted);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    if (!(value instanceof Uint8Array)) {
      for (const nested of Object.values(value)) deepFreeze(nested);
      Object.freeze(value);
    }
  }
  return value;
}

function sanitizeJson(value: unknown, key = '', seen = new Set<object>()): ConnectorJsonValue {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      fail('LIVE_EVIDENCE_RESULT_INVALID', 'Provider records require finite numbers.');
    return value;
  }
  if (typeof value === 'string') {
    if (PRIVATE_VALUE.test(value)) return '[REDACTED]';
    return value.length <= MAX_SAFE_STRING
      ? value
      : `${value.slice(0, MAX_SAFE_STRING)}...[TRUNCATED]`;
  }
  if (
    typeof value !== 'object' ||
    value === undefined ||
    (Array.isArray(value) && value.length > 10_000)
  ) {
    fail('LIVE_EVIDENCE_RESULT_INVALID', 'Provider records must be bounded JSON values.');
  }
  if (seen.has(value))
    fail('LIVE_EVIDENCE_RESULT_INVALID', 'Provider records cannot contain cycles.');
  seen.add(value);
  try {
    if (Array.isArray(value))
      return Object.freeze(value.map((entry) => sanitizeJson(entry, key, seen)));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail('LIVE_EVIDENCE_RESULT_INVALID', 'Provider records require plain JSON objects.');
    }
    const result: MutableJsonObject = {};
    for (const [nestedKey, nested] of Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      result[nestedKey] = sanitizeJson(nested, nestedKey, seen);
    }
    return Object.freeze(result);
  } finally {
    seen.delete(value);
  }
}

function canonicalJson(value: ConnectorJsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(',')}}`;
}

function bytesDigest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function validateDefinition(
  input: Omit<ConnectorAdapterDefinitionV2, 'conformanceDigest'>,
): ConnectorAdapterDefinitionV2 {
  safeId(input.adapterId, 'adapterId', ID);
  safeId(input.provider.id, 'provider.id', ID);
  if (!VERSION.test(input.adapterVersion) || !VERSION.test(input.provider.version)) {
    fail(
      'LIVE_EVIDENCE_ADAPTER_INVALID',
      'Adapter and provider versions must be exact semver values.',
    );
  }
  if (!CONNECTOR_ADAPTER_CATEGORIES_V2.includes(input.category)) {
    fail('LIVE_EVIDENCE_ADAPTER_INVALID', 'Adapter category is unsupported.');
  }
  if (input.allowedMethods.length !== 1 || input.allowedMethods[0] !== 'GET') {
    fail('LIVE_EVIDENCE_ADAPTER_INVALID', 'Live-evidence adapters are GET-only.');
  }
  if (
    input.transport !== 'https-or-loopback' ||
    input.unavailableBehavior !== 'typed-absence' ||
    !Number.isSafeInteger(input.healthMaxAgeSeconds) ||
    input.healthMaxAgeSeconds < 1 ||
    input.healthMaxAgeSeconds > 86_400
  ) {
    fail('LIVE_EVIDENCE_ADAPTER_INVALID', 'Adapter health or transport policy is invalid.');
  }
  sortedUnique(input.supportedDomains, 'supportedDomains');
  sortedUnique(input.scopes, 'scopes');
  if (input.operations.length === 0) {
    fail('LIVE_EVIDENCE_ADAPTER_INVALID', 'Adapter must declare at least one operation.');
  }
  let previous = '';
  const operationIds = new Set<string>();
  for (const operation of input.operations) {
    safeId(operation.operation, 'operation', ID);
    safeId(operation.collection, 'collection');
    sortedUnique(operation.sourceContracts, `${operation.operation}.sourceContracts`);
    if (operationIds.has(operation.operation) || operation.operation.localeCompare(previous) <= 0) {
      fail(
        'LIVE_EVIDENCE_ADAPTER_INVALID',
        'Adapter operations must be unique and canonically ordered.',
      );
    }
    operationIds.add(operation.operation);
    previous = operation.operation;
  }
  const projection = structuredClone(input) as Omit<
    ConnectorAdapterDefinitionV2,
    'conformanceDigest'
  >;
  const conformanceDigest = sha256CanonicalJson({
    domain: 'openplanr-live-evidence-adapter-v2',
    ...projection,
  });
  return deepFreeze({ ...projection, conformanceDigest });
}

export function createConnectorAdapterResultV2(
  definition: ConnectorAdapterDefinitionV2,
  input: ConnectorAdapterNormalizeInputV2,
): ConnectorAdapterResultV2 {
  if (!CONNECTOR_ADAPTER_CATEGORIES_V2.includes(definition.category)) {
    fail('LIVE_EVIDENCE_ADAPTER_INVALID', 'Adapter category is unsupported.');
  }
  const operation = definition.operations.find(
    (candidate) => candidate.operation === input.operation,
  );
  if (!operation?.sourceContracts.includes(input.sourceContract.id)) {
    fail(
      'LIVE_EVIDENCE_PROVIDER_INCOMPATIBLE',
      'The exact adapter operation and source contract are incompatible.',
    );
  }
  if (input.sourceContract.version !== '1.0.0') {
    fail('LIVE_EVIDENCE_PROVIDER_INCOMPATIBLE', 'The source contract version is unsupported.');
  }
  if (!HASH.test(input.requestHash) || !HASH.test(input.sourceIdentityHash)) {
    fail('LIVE_EVIDENCE_RESULT_INVALID', 'Adapter result lost exact request or source custody.');
  }
  const requestedAt = iso(input.requestedAt, 'requestedAt');
  const capturedAt = iso(input.capturedAt, 'capturedAt');
  const freshUntil = iso(input.freshUntil, 'freshUntil');
  if (
    Date.parse(requestedAt) > Date.parse(capturedAt) ||
    Date.parse(capturedAt) >= Date.parse(freshUntil)
  ) {
    fail('LIVE_EVIDENCE_RESULT_INVALID', 'Evidence timing is not ordered or current.');
  }
  const health = record(input.health, 'health');
  exactKeys(health, ['status', 'checkedAt', 'freshUntil', 'proofDigest'], 'health');
  if (
    !['available', 'degraded', 'unavailable'].includes(String(input.health.status)) ||
    !HASH.test(input.health.proofDigest) ||
    Date.parse(iso(input.health.checkedAt, 'health.checkedAt')) >=
      Date.parse(iso(input.health.freshUntil, 'health.freshUntil'))
  ) {
    fail('LIVE_EVIDENCE_RESULT_INVALID', 'Provider health proof is invalid.');
  }
  const bounds = record(input.bounds, 'bounds');
  exactKeys(bounds, ['maxCalls', 'maxPages', 'maxRecords', 'maxBytes'], 'bounds');
  for (const [key, value, maximum] of [
    ['maxCalls', input.bounds.maxCalls, 100],
    ['maxPages', input.bounds.maxPages, 100],
    ['maxRecords', input.bounds.maxRecords, 10_000],
    ['maxBytes', input.bounds.maxBytes, 10_485_760],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      fail('LIVE_EVIDENCE_RESULT_INVALID', `Connector ${key} is outside the frozen bound.`);
    }
  }

  const records: ConnectorAdapterRecordManifestV2[] = [];
  const redactedRecords: ConnectorJsonValue[] = [];
  const absences: ConnectorAdapterAbsenceV2[] = [];
  if (input.status === 'materialized') {
    if (input.health.status !== 'available' || input.absence !== undefined) {
      fail(
        'LIVE_EVIDENCE_RESULT_INVALID',
        'Materialized evidence requires available health and no absence.',
      );
    }
    const payload = record(input.payload, 'payload');
    const candidates = payload[operation.collection];
    if (
      !Array.isArray(candidates) ||
      candidates.length === 0 ||
      candidates.length > input.bounds.maxRecords
    ) {
      fail(
        'LIVE_EVIDENCE_RESULT_INVALID',
        'Materialized evidence has no bounded operation records.',
      );
    }
    for (const candidateValue of candidates) {
      const candidate = record(candidateValue, 'record');
      exactKeys(candidate, ['id', 'observedAt', 'data'], 'record');
      const id = safeId(candidate.id, 'record.id');
      const observedAt = iso(candidate.observedAt, 'record.observedAt');
      const data = sanitizeJson(candidate.data);
      const redacted = deepFreeze({ id, observedAt, data }) as ConnectorJsonValue;
      redactedRecords.push(redacted);
      records.push(
        deepFreeze({
          recordIdentityHash: sha256CanonicalJson({
            domain: 'openplanr-live-evidence-record-identity-v2',
            provider: definition.provider,
            operation: input.operation,
            requestHash: input.requestHash,
            sourceContract: input.sourceContract,
            sourceIdentityHash: input.sourceIdentityHash,
            id,
          }),
          contentDigest: sha256CanonicalJson(redacted),
          classification: input.classification,
        }),
      );
    }
  } else {
    if (input.absence === undefined) {
      fail(
        'LIVE_EVIDENCE_RESULT_INVALID',
        'Absent or uncertain evidence requires one typed absence.',
      );
    }
    if (!CONNECTOR_ABSENCE_KINDS_V2.includes(input.absence.kind)) {
      fail('LIVE_EVIDENCE_RESULT_INVALID', 'Evidence absence kind is unsupported.');
    }
    if (!ERROR_CODE.test(input.absence.reasonCode)) {
      fail('LIVE_EVIDENCE_RESULT_INVALID', 'Evidence absence reason code is invalid.');
    }
    const details = sanitizeJson(input.absence.details);
    absences.push(
      deepFreeze({
        kind: input.absence.kind,
        reasonCode: input.absence.reasonCode,
        required: input.absence.required,
        observedAt: iso(input.absence.observedAt, 'absence.observedAt'),
        detailsHash: sha256CanonicalJson(details),
      }),
    );
  }

  const redactedEnvelope = deepFreeze({
    kind: 'openplanr-live-evidence-redacted-response',
    schemaVersion: '1.0.0',
    provider: definition.provider,
    adapterVersion: definition.adapterVersion,
    category: definition.category,
    operation: input.operation,
    sourceContract: input.sourceContract,
    requestHash: input.requestHash,
    sourceIdentityHash: input.sourceIdentityHash,
    status: input.status,
    sourceTiming: { requestedAt, capturedAt, freshUntil },
    health: input.health,
    records: redactedRecords,
    absences,
  }) as ConnectorJsonValue;
  const redactedBytes = Buffer.from(canonicalJson(redactedEnvelope), 'utf8');
  if (redactedBytes.byteLength > input.bounds.maxBytes) {
    fail(
      'LIVE_EVIDENCE_RESULT_INVALID',
      'Redacted provider response exceeds the exact byte ceiling.',
    );
  }
  return deepFreeze({
    kind: 'openplanr-live-evidence-adapter-result',
    schemaVersion: '1.0.0',
    provider: definition.provider,
    adapterVersion: definition.adapterVersion,
    category: definition.category,
    operation: input.operation,
    sourceContract: input.sourceContract,
    requestHash: input.requestHash,
    sourceIdentityHash: input.sourceIdentityHash,
    status: input.status,
    sourceTiming: { requestedAt, capturedAt, freshUntil },
    health: input.health,
    records: Object.freeze(records),
    absences: Object.freeze(absences),
    get redactedBytes(): Uint8Array {
      return new Uint8Array(redactedBytes);
    },
    redactedBytesDigest: bytesDigest(redactedBytes),
  });
}

/** Returns a fresh copy only after re-verifying the immutable result digest. */
export function readConnectorAdapterResultBytesV2(result: ConnectorAdapterResultV2): Uint8Array {
  const bytes = result.redactedBytes;
  if (bytesDigest(bytes) !== result.redactedBytesDigest) {
    fail(
      'LIVE_EVIDENCE_RESULT_INVALID',
      'Adapter result bytes no longer match their exact digest.',
    );
  }
  return new Uint8Array(bytes);
}

export function defineConnectorAdapterV2(
  input: Omit<ConnectorAdapterDefinitionV2, 'conformanceDigest'>,
): ConnectorAdapterV2 {
  const definition = validateDefinition(input);
  return Object.freeze({
    definition,
    normalize: (request: ConnectorAdapterNormalizeInputV2) =>
      createConnectorAdapterResultV2(definition, request),
  });
}

function valueRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('LIVE_EVIDENCE_ADAPTER_INVALID', `${label} is not a validated record.`);
  }
  return deepFreeze(structuredClone(value as Record<string, unknown>));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

export class ConnectorRegistryV2 {
  readonly #entries: readonly ResolvedConnectorAdapterV2[];

  constructor(input: {
    contracts: LiveEvidenceContractsV2;
    registry: unknown;
    baseEvidenceProviders: readonly unknown[];
    baseResolvers: readonly unknown[];
    adapters: readonly ConnectorAdapterV2[];
  }) {
    const asserted = input.contracts.assertLiveEvidenceProviderRegistryV2(input.registry, {
      baseEvidenceProviders: input.baseEvidenceProviders,
      baseResolvers: input.baseResolvers,
    });
    const registry = valueRecord(asserted, 'Provider registry');
    if (!Array.isArray(registry.providers)) {
      fail('LIVE_EVIDENCE_ADAPTER_INVALID', 'Provider registry membership is unavailable.');
    }
    const adapterIdentities = new Set<string>();
    for (const adapter of input.adapters) {
      const identity = `${adapter.definition.provider.id}@${adapter.definition.provider.version}`;
      if (adapterIdentities.has(identity)) {
        fail(
          'LIVE_EVIDENCE_ADAPTER_CONFLICT',
          'Duplicate adapter provider identity is not allowed.',
        );
      }
      adapterIdentities.add(identity);
    }
    const entries = registry.providers.map((value) => {
      const registration = valueRecord(
        input.contracts.assertLiveEvidenceProviderRegistrationV2(value, {
          baseEvidenceProviders: input.baseEvidenceProviders,
          baseResolvers: input.baseResolvers,
        }),
        'Provider registration',
      );
      const adapter = input.adapters.find(
        (candidate) =>
          candidate.definition.provider.id === registration.providerId &&
          candidate.definition.provider.version === registration.providerVersion,
      );
      if (!adapter) {
        fail(
          'LIVE_EVIDENCE_PROVIDER_UNAVAILABLE',
          'The exact registered provider adapter is unavailable.',
        );
      }
      const definition = adapter.definition;
      const operationSources = [
        ...new Set(definition.operations.flatMap((operation) => operation.sourceContracts)),
      ].sort();
      if (
        registration.adapterVersion !== definition.adapterVersion ||
        registration.conformanceDigest !== definition.conformanceDigest ||
        (registration.implementation as Record<string, unknown> | undefined)?.id !==
          definition.adapterId ||
        !Array.isArray(registration.supportedKinds) ||
        !sameStrings(registration.supportedKinds as string[], operationSources) ||
        !Array.isArray(registration.supportedDomains) ||
        !sameStrings(registration.supportedDomains as string[], definition.supportedDomains) ||
        !Array.isArray(registration.effects) ||
        !sameStrings(registration.effects as string[], ['provider-call'])
      ) {
        fail(
          'LIVE_EVIDENCE_PROVIDER_INCOMPATIBLE',
          'Registered provider bytes do not match the frozen adapter.',
        );
      }
      return Object.freeze({ registration, adapter });
    });
    if (entries.length !== input.adapters.length) {
      fail(
        'LIVE_EVIDENCE_PROVIDER_UNAVAILABLE',
        'An adapter exists without exact frozen registry membership.',
      );
    }
    this.#entries = Object.freeze(entries);
  }

  list(): readonly ResolvedConnectorAdapterV2[] {
    return this.#entries;
  }

  resolve(selection: ConnectorRegistrySelectionV2): ResolvedConnectorAdapterV2 {
    const providerMatches = this.#entries.filter(
      ({ adapter }) =>
        adapter.definition.provider.id === selection.providerId &&
        adapter.definition.provider.version === selection.providerVersion,
    );
    if (providerMatches.length !== 1) {
      fail('LIVE_EVIDENCE_PROVIDER_UNAVAILABLE', 'The exact requested provider is unavailable.');
    }
    const selected = providerMatches[0];
    const operation = selected.adapter.definition.operations.find(
      (candidate) => candidate.operation === selection.operation,
    );
    if (
      selected.adapter.definition.adapterVersion !== selection.adapterVersion ||
      !selected.adapter.definition.supportedDomains.includes(selection.domainId) ||
      !operation?.sourceContracts.includes(selection.sourceContractId)
    ) {
      fail(
        'LIVE_EVIDENCE_PROVIDER_INCOMPATIBLE',
        'The exact requested provider binding is incompatible.',
      );
    }
    return selected;
  }
}

export function createConnectorRegistryV2(
  input: ConstructorParameters<typeof ConnectorRegistryV2>[0],
): ConnectorRegistryV2 {
  return new ConnectorRegistryV2(input);
}
