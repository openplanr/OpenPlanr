import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { sha256CanonicalJson } from '../canonical-json.js';
import type {
  LiveEvidenceSubmissionPreparationV2,
  LiveEvidenceSubmissionResultV2,
  OperateActorV2,
} from '../operate/client.js';
import type { ConnectorCheckpointCustodyV2 } from './checkpoint-custody.js';
import { ConnectorCheckpointCustodyError } from './checkpoint-custody.js';
import type {
  ConnectorAdapterResultV2,
  ConnectorBoundsV2,
  ConnectorClassificationV2,
  ConnectorHealthProofV2,
  ConnectorRegistryV2,
  ConnectorSourceContractV2,
} from './connector-registry.js';
import { readConnectorAdapterResultBytesV2 } from './connector-registry.js';
import type {
  ConnectorCredentialCapabilityBindingV2,
  ConnectorCredentialCustodyV2,
  ConnectorCredentialProtocolBindingV2,
} from './credential-custody.js';
import { ConnectorCredentialCustodyError } from './credential-custody.js';

type JsonRecord = Readonly<Record<string, unknown>>;
type Hash = `sha256:${string}`;

const HASH = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const TEXT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const PRIVATE_VALUE =
  /(?:^|[\s"'`(])\/(?:Users|home|private|var|etc|tmp)\/|(?:^|[\s"'`(])[A-Za-z]:[\\/][^\s]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]+|\b(?:api[-_ ]?key|access[-_ ]?token|client[-_ ]?secret|credential(?:Value)?|password|passwd|secret|token)\s*[:=]\s*[^\s]+/iu;
const SENSITIVE_KEY =
  /(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|api[-_]?key|client[-_]?secret|credentialValue|private[-_]?key)/iu;
const RESULT_EFFECTS = Object.freeze([
  'provider-call',
  'operate-assignment-submit',
  'evidence-materialization',
] as const);

export type ConnectorRuntimeOperationV2 =
  | 'evidence.providers'
  | 'evidence.preview'
  | 'evidence.collect'
  | 'evidence.status';

export type ConnectorRuntimeEffectV2 = Readonly<{
  id: (typeof RESULT_EFFECTS)[number];
  executed: boolean;
}>;

export type ConnectorRuntimeResultV2 = Readonly<{
  ok: boolean;
  operation: ConnectorRuntimeOperationV2;
  effects: readonly ConnectorRuntimeEffectV2[];
  authorityRequired: boolean;
  ownerActionRequired: boolean;
  nextAction: string;
  data?: JsonRecord;
  error?: Readonly<{ code: string; problem: string }>;
}>;

export type ConnectorEvidenceRequestV2 = Readonly<{
  kind: 'openplanr-live-evidence-request';
  schemaVersion: '1.0.0';
  assignmentId: string;
  submissionId: string;
  actor: OperateActorV2;
  ownerActorId: string;
  provider: Readonly<{ id: string; version: string }>;
  adapterVersion: string;
  operation: string;
  sourceContract: ConnectorSourceContractV2;
  scope: Readonly<{ scopeId: string; domainId: string; domainVersion: string }>;
  logicalCredentialRef: string;
  consentRecordId: string;
  accountIdentityHash: Hash;
  selectors: readonly string[];
  scopes: readonly string[];
  queryHash: Hash;
  window: Readonly<{ from: string; to: string }>;
  bounds: ConnectorBoundsV2;
  classification: ConnectorClassificationV2;
  sensitivity: ConnectorClassificationV2;
  purpose: string;
  consentExpiresAt: string;
  claim: Readonly<{
    localClaimId: string;
    relation: 'supportedBy' | 'contradictedBy';
    confidence: number;
  }>;
}>;

export type ConnectorProtocolDocketV2 = Readonly<{
  provider: Readonly<{ id: string; version: string }>;
  adapterVersion: string;
  accountIdentityHash: Hash;
  selectors: readonly string[];
  effect: 'provider-call';
  scopes: readonly string[];
  queryHash: Hash;
  window: Readonly<{ from: string; to: string }>;
  ceilings: ConnectorBoundsV2;
  classification: ConnectorClassificationV2;
  sensitivity: ConnectorClassificationV2;
  purpose: string;
  expiresAt: string;
  changedRecordDiffHash: Hash | null;
  consequences: readonly string[];
  authorityBoundary: 'consent-is-not-access-authority';
  choices: readonly ['approve', 'cancel'];
  defaultChoice: null;
  cancelEffect: 'none';
}>;

export type ConnectorProviderCallResultV2 = Readonly<{
  status: 'materialized' | 'absent' | 'uncertain';
  requestedAt: string;
  capturedAt: string;
  freshUntil: string;
  health: ConnectorHealthProofV2;
  payload: unknown;
  absence?: Readonly<{
    kind:
      | 'missing-consent'
      | 'missing-credential'
      | 'stale'
      | 'unhealthy'
      | 'provider-unavailable'
      | 'rate-limited'
      | 'insufficient-evidence'
      | 'unsupported';
    reasonCode: string;
    required: boolean;
    observedAt: string;
    details: unknown;
  }>;
  providerCursor?: Uint8Array;
}>;

export type ConnectorProviderTransportV2 = Readonly<{
  health(
    input: Readonly<{
      request: ConnectorEvidenceRequestV2;
      registration: JsonRecord;
    }>,
  ): ConnectorHealthProofV2;
  execute(
    input: Readonly<{
      request: ConnectorEvidenceRequestV2;
      registration: JsonRecord;
      collection: string;
      credential: Uint8Array;
      expectedHealth: ConnectorHealthProofV2;
    }>,
  ): Promise<ConnectorProviderCallResultV2>;
}>;

export type ConnectorRuntimeContractsV2 = Readonly<{
  assertOperatingLiveEvidenceConsentRecordV2(record: unknown): JsonRecord;
  assertOperatingConnectorCheckpointV2(record: unknown): JsonRecord;
  assertOperatingLiveEvidenceIngestionV2(record: unknown, options?: JsonRecord): JsonRecord;
  deriveOperatingLiveEvidenceRequestHashV2(input: JsonRecord): Hash;
  deriveOperatingLiveEvidenceContentDigestV2(record: JsonRecord): Hash;
  reduceOperatingConnectorCheckpointV2(current: unknown, event: unknown): JsonRecord;
}>;

export type ConnectorOperateBridgeV2 = Readonly<{
  prepareLiveEvidenceSubmission(
    input: Readonly<{
      assignmentId: string;
      submissionId: string;
      actor: OperateActorV2;
    }>,
  ): Promise<LiveEvidenceSubmissionPreparationV2>;
  acceptLiveEvidenceSubmission(
    input: Readonly<{
      assignmentId: string;
      submissionId: string;
      actor: OperateActorV2;
      preparationHash: string;
      contentBase64: string;
      custody: Readonly<{
        issuedAssignment: JsonRecord;
        liveProviderRegistration: JsonRecord;
        baseEvidenceProvider: JsonRecord;
        baseResolver: JsonRecord;
        consentRecord: JsonRecord;
        connectorCheckpoint: JsonRecord;
        resultCheckpoint: JsonRecord;
        checkpointHistory?: readonly JsonRecord[];
      }>;
    }>,
  ): Promise<LiveEvidenceSubmissionResultV2>;
}>;

export type ConnectorEvidenceRegistryV2 = Readonly<{
  providers: readonly JsonRecord[];
  resolvers: readonly JsonRecord[];
}>;

type ConnectorCheckpointContextV2 = Readonly<{
  checkpointId: string;
  requestId: string;
  requestHash: Hash;
  sourceIdentityHash: Hash;
  health: ConnectorHealthProofV2;
  prepared: JsonRecord;
}>;

export class ConnectorRuntimeErrorV2 extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}

function fail(code: string, message: string): never {
  throw new ConnectorRuntimeErrorV2(code, message);
}

function exactKeys(value: JsonRecord, expected: readonly string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    fail('E_LIVE_EVIDENCE_REQUEST_INVALID', `${label} contains missing or unsupported fields.`);
  }
}

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('E_LIVE_EVIDENCE_REQUEST_INVALID', `${label} must be one closed object.`);
  }
  return value as JsonRecord;
}

function safePortable(value: unknown, key = '', seen = new Set<object>()): void {
  if (SENSITIVE_KEY.test(key)) {
    fail('E_LIVE_EVIDENCE_PRIVATE_DATA', 'Live-evidence input contains restricted content.');
  }
  if (typeof value === 'string') {
    if (value.length > 2_048 || PRIVATE_VALUE.test(value) || value.includes('\u0000')) {
      fail('E_LIVE_EVIDENCE_PRIVATE_DATA', 'Live-evidence input contains restricted content.');
    }
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value))
    fail('E_LIVE_EVIDENCE_REQUEST_INVALID', 'Live-evidence input contains a cycle.');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (const entry of value) safePortable(entry, key, seen);
    } else {
      for (const [nestedKey, nested] of Object.entries(value)) {
        safePortable(nested, nestedKey, seen);
      }
    }
  } finally {
    seen.delete(value);
  }
}

function sortedUnique(values: readonly string[], label: string): void {
  if (
    values.length < 1 ||
    values.length > 32 ||
    values.some((value) => !TEXT_ID.test(value)) ||
    new Set(values).size !== values.length ||
    values.some((value, index) => index > 0 && value.localeCompare(values[index - 1]) <= 0)
  ) {
    fail('E_LIVE_EVIDENCE_REQUEST_INVALID', `${label} must be unique and canonically ordered.`);
  }
}

export function assertConnectorEvidenceRequestV2(value: unknown): ConnectorEvidenceRequestV2 {
  const input = record(value, 'Live-evidence request');
  exactKeys(
    input,
    [
      'accountIdentityHash',
      'actor',
      'adapterVersion',
      'assignmentId',
      'bounds',
      'claim',
      'classification',
      'consentExpiresAt',
      'consentRecordId',
      'kind',
      'logicalCredentialRef',
      'operation',
      'ownerActorId',
      'provider',
      'purpose',
      'queryHash',
      'schemaVersion',
      'scope',
      'scopes',
      'selectors',
      'sensitivity',
      'sourceContract',
      'submissionId',
      'window',
    ],
    'Live-evidence request',
  );
  const actor = record(input.actor, 'Actor');
  const provider = record(input.provider, 'Provider');
  const sourceContract = record(input.sourceContract, 'Source contract');
  const scope = record(input.scope, 'Scope');
  const window = record(input.window, 'Window');
  const bounds = record(input.bounds, 'Bounds');
  const claim = record(input.claim, 'Claim');
  exactKeys(actor, ['actorId', 'kind', 'runtime'], 'Actor');
  exactKeys(provider, ['id', 'version'], 'Provider');
  exactKeys(sourceContract, ['id', 'version'], 'Source contract');
  exactKeys(scope, ['domainId', 'domainVersion', 'scopeId'], 'Scope');
  exactKeys(window, ['from', 'to'], 'Window');
  exactKeys(bounds, ['maxBytes', 'maxCalls', 'maxPages', 'maxRecords'], 'Bounds');
  exactKeys(claim, ['confidence', 'localClaimId', 'relation'], 'Claim');
  safePortable(input);
  if (
    input.kind !== 'openplanr-live-evidence-request' ||
    input.schemaVersion !== '1.0.0' ||
    typeof input.assignmentId !== 'string' ||
    !/^asg_[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u.test(input.assignmentId) ||
    typeof input.submissionId !== 'string' ||
    !/^sub_[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u.test(input.submissionId) ||
    typeof actor.actorId !== 'string' ||
    !TEXT_ID.test(actor.actorId) ||
    !['agent', 'human'].includes(String(actor.kind)) ||
    typeof actor.runtime !== 'string' ||
    !TEXT_ID.test(actor.runtime) ||
    typeof input.ownerActorId !== 'string' ||
    !TEXT_ID.test(input.ownerActorId) ||
    typeof provider.id !== 'string' ||
    !ID.test(provider.id) ||
    typeof provider.version !== 'string' ||
    !VERSION.test(provider.version) ||
    typeof input.adapterVersion !== 'string' ||
    !VERSION.test(input.adapterVersion) ||
    typeof input.operation !== 'string' ||
    !ID.test(input.operation) ||
    typeof sourceContract.id !== 'string' ||
    !ID.test(sourceContract.id) ||
    sourceContract.version !== '1.0.0' ||
    typeof scope.scopeId !== 'string' ||
    !TEXT_ID.test(scope.scopeId) ||
    typeof scope.domainId !== 'string' ||
    !ID.test(scope.domainId) ||
    typeof scope.domainVersion !== 'string' ||
    !VERSION.test(scope.domainVersion) ||
    typeof input.logicalCredentialRef !== 'string' ||
    !TEXT_ID.test(input.logicalCredentialRef) ||
    typeof input.consentRecordId !== 'string' ||
    !/^lcon_[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u.test(input.consentRecordId) ||
    typeof input.accountIdentityHash !== 'string' ||
    !HASH.test(input.accountIdentityHash) ||
    typeof input.queryHash !== 'string' ||
    !HASH.test(input.queryHash) ||
    typeof input.purpose !== 'string' ||
    input.purpose.length < 1 ||
    input.purpose.length > 512 ||
    !['public', 'internal', 'confidential', 'restricted'].includes(String(input.classification)) ||
    !['public', 'internal', 'confidential', 'restricted'].includes(String(input.sensitivity)) ||
    typeof window.from !== 'string' ||
    typeof window.to !== 'string' ||
    !Number.isFinite(Date.parse(window.from)) ||
    !Number.isFinite(Date.parse(window.to)) ||
    Date.parse(window.from) >= Date.parse(window.to) ||
    typeof input.consentExpiresAt !== 'string' ||
    !Number.isFinite(Date.parse(input.consentExpiresAt)) ||
    Date.parse(window.to) >= Date.parse(input.consentExpiresAt) ||
    typeof claim.localClaimId !== 'string' ||
    !TEXT_ID.test(claim.localClaimId) ||
    !['supportedBy', 'contradictedBy'].includes(String(claim.relation)) ||
    typeof claim.confidence !== 'number' ||
    !Number.isFinite(claim.confidence) ||
    claim.confidence < 0 ||
    claim.confidence > 1
  ) {
    fail('E_LIVE_EVIDENCE_REQUEST_INVALID', 'Live-evidence request fields are invalid.');
  }
  const maxima = { maxCalls: 100, maxPages: 100, maxRecords: 10_000, maxBytes: 10_485_760 };
  for (const [key, maximum] of Object.entries(maxima)) {
    const bound = bounds[key];
    if (!Number.isSafeInteger(bound) || (bound as number) < 1 || (bound as number) > maximum) {
      fail('E_LIVE_EVIDENCE_REQUEST_INVALID', 'Live-evidence request bounds are invalid.');
    }
  }
  if (!Array.isArray(input.selectors) || !Array.isArray(input.scopes)) {
    fail('E_LIVE_EVIDENCE_REQUEST_INVALID', 'Live-evidence selectors and scopes are invalid.');
  }
  sortedUnique(input.selectors as string[], 'selectors');
  sortedUnique(input.scopes as string[], 'scopes');
  return Object.freeze(structuredClone(input)) as ConnectorEvidenceRequestV2;
}

function effects(executed: ReadonlySet<string> = new Set()): readonly ConnectorRuntimeEffectV2[] {
  return Object.freeze(
    RESULT_EFFECTS.map((id) => Object.freeze({ id, executed: executed.has(id) })),
  );
}

function ok(
  operation: ConnectorRuntimeOperationV2,
  data: JsonRecord,
  executed: ReadonlySet<string>,
  nextAction: string,
): ConnectorRuntimeResultV2 {
  return Object.freeze({
    ok: true,
    operation,
    effects: effects(executed),
    authorityRequired: operation === 'evidence.preview',
    ownerActionRequired: false,
    nextAction,
    data: Object.freeze(structuredClone(data)),
  });
}

function failed(
  operation: ConnectorRuntimeOperationV2,
  code: string,
  problem: string,
  executed: ReadonlySet<string>,
  options: Readonly<{ ownerActionRequired?: boolean; nextAction?: string }> = {},
): ConnectorRuntimeResultV2 {
  return Object.freeze({
    ok: false,
    operation,
    effects: effects(executed),
    authorityRequired:
      code.includes('AUTHORITY') || code.includes('CONSENT') || code.includes('OWNER_CONFIRMATION'),
    ownerActionRequired: options.ownerActionRequired ?? false,
    nextAction:
      options.nextAction ??
      'Inspect the bounded failure and retry only after correcting its cause.',
    error: Object.freeze({ code, problem }),
  });
}

function digestId(prefix: string, value: unknown): string {
  return `${prefix}_${sha256CanonicalJson(value).slice('sha256:'.length, 38)}`;
}

function protocolDocket(request: ConnectorEvidenceRequestV2): ConnectorProtocolDocketV2 {
  return Object.freeze({
    provider: Object.freeze(structuredClone(request.provider)),
    adapterVersion: request.adapterVersion,
    accountIdentityHash: request.accountIdentityHash,
    selectors: Object.freeze([...request.selectors]),
    effect: 'provider-call',
    scopes: Object.freeze([...request.scopes]),
    queryHash: request.queryHash,
    window: Object.freeze(structuredClone(request.window)),
    ceilings: Object.freeze(structuredClone(request.bounds)),
    classification: request.classification,
    sensitivity: request.sensitivity,
    purpose: request.purpose,
    expiresAt: request.consentExpiresAt,
    changedRecordDiffHash: null,
    consequences: Object.freeze(['The provider receives one bounded read-only evidence query.']),
    authorityBoundary: 'consent-is-not-access-authority',
    choices: Object.freeze(['approve', 'cancel'] as const),
    defaultChoice: null,
    cancelEffect: 'none',
  });
}

function consentRecord(
  request: ConnectorEvidenceRequestV2,
  docket: ConnectorProtocolDocketV2,
  issuedAt: string,
): JsonRecord {
  const body = {
    kind: 'operating-live-evidence-consent-record',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    consentRecordId: request.consentRecordId,
    authority: 'none',
    decision: 'approved',
    docket,
    docketHash: sha256CanonicalJson(docket),
    actor: { actorId: request.ownerActorId, kind: 'human' },
    provider: request.provider,
    adapterVersion: request.adapterVersion,
    accountIdentityHash: request.accountIdentityHash,
    selectors: request.selectors,
    scopes: request.scopes,
    queryHash: request.queryHash,
    window: request.window,
    ceilings: request.bounds,
    classification: request.classification,
    purpose: request.purpose,
    issuedAt,
    expiresAt: request.consentExpiresAt,
  };
  return Object.freeze({ ...body, consentHash: sha256CanonicalJson(body) });
}

function exactConsentForRequest(
  value: JsonRecord,
  request: ConnectorEvidenceRequestV2,
  docket: ConnectorProtocolDocketV2,
): boolean {
  return (
    value.consentRecordId === request.consentRecordId &&
    value.authority === 'none' &&
    value.decision === 'approved' &&
    sha256CanonicalJson(value.docket) === sha256CanonicalJson(docket) &&
    sha256CanonicalJson(value.provider) === sha256CanonicalJson(request.provider) &&
    value.adapterVersion === request.adapterVersion &&
    value.accountIdentityHash === request.accountIdentityHash &&
    sha256CanonicalJson(value.selectors) === sha256CanonicalJson(request.selectors) &&
    sha256CanonicalJson(value.scopes) === sha256CanonicalJson(request.scopes) &&
    value.queryHash === request.queryHash &&
    sha256CanonicalJson(value.window) === sha256CanonicalJson(request.window) &&
    sha256CanonicalJson(value.ceilings) === sha256CanonicalJson(request.bounds) &&
    value.classification === request.classification &&
    value.purpose === request.purpose &&
    value.expiresAt === request.consentExpiresAt
  );
}

function selfHashed<T extends JsonRecord>(body: T, field: string): JsonRecord {
  return Object.freeze({ ...body, [field]: sha256CanonicalJson(body) });
}

function checkpointEvent(
  checkpoint: JsonRecord,
  type: 'request' | 'materialize' | 'commit' | 'absent' | 'uncertain',
  at: string,
  patch: JsonRecord,
): JsonRecord {
  const body = {
    eventId: digestId('lcev', {
      checkpointId: checkpoint.checkpointId,
      generation: checkpoint.generation,
      type,
      patch,
    }),
    type,
    expectedGeneration: checkpoint.generation,
    expectedCheckpointHash: checkpoint.checkpointHash,
    at,
    patch,
  };
  return Object.freeze({ ...body, eventHash: sha256CanonicalJson(body) });
}

function findBaseRecord(
  records: readonly JsonRecord[],
  identity: JsonRecord,
  fields: readonly string[],
  label: string,
): JsonRecord {
  const matches = records.filter((entry) =>
    fields.every((field) => entry[field] === identity[field]),
  );
  if (matches.length !== 1)
    fail('E_LIVE_EVIDENCE_PACKAGE_INVALID', `${label} is not uniquely available.`);
  return matches[0];
}

function asHash(value: unknown, label: string): Hash {
  if (typeof value !== 'string' || !HASH.test(value)) {
    fail('E_LIVE_EVIDENCE_PACKAGE_INVALID', `${label} is invalid.`);
  }
  return value as Hash;
}

function sha256Bytes(bytes: Uint8Array): Hash {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export class ConnectorRuntimeV2 {
  readonly #registry: ConnectorRegistryV2;
  readonly #credentials: ConnectorCredentialCustodyV2;
  readonly #checkpoints: ConnectorCheckpointCustodyV2;
  readonly #contracts: ConnectorRuntimeContractsV2;
  readonly #evidenceRegistry: ConnectorEvidenceRegistryV2;
  readonly #operate: ConnectorOperateBridgeV2;
  readonly #transport: ConnectorProviderTransportV2;
  readonly #now: () => number;

  constructor(
    input: Readonly<{
      registry: ConnectorRegistryV2;
      credentials: ConnectorCredentialCustodyV2;
      checkpoints: ConnectorCheckpointCustodyV2;
      contracts: ConnectorRuntimeContractsV2;
      evidenceRegistry: ConnectorEvidenceRegistryV2;
      operate: ConnectorOperateBridgeV2;
      transport: ConnectorProviderTransportV2;
      now?: () => number;
    }>,
  ) {
    this.#registry = input.registry;
    this.#credentials = input.credentials;
    this.#checkpoints = input.checkpoints;
    this.#contracts = input.contracts;
    this.#evidenceRegistry = input.evidenceRegistry;
    this.#operate = input.operate;
    this.#transport = input.transport;
    this.#now = input.now ?? Date.now;
  }

  async providers(): Promise<ConnectorRuntimeResultV2> {
    const providers = this.#registry.list().map(({ registration, adapter }) => ({
      provider: adapter.definition.provider,
      adapterVersion: adapter.definition.adapterVersion,
      category: adapter.definition.category,
      operations: adapter.definition.operations.map(({ operation, sourceContracts }) => ({
        operation,
        sourceContracts,
      })),
      registrationHash: registration.registrationHash,
    }));
    return ok(
      'evidence.providers',
      { providers },
      new Set(),
      'Preview one exact provider request before collecting evidence.',
    );
  }

  async preview(value: ConnectorEvidenceRequestV2): Promise<ConnectorRuntimeResultV2> {
    const request = assertConnectorEvidenceRequestV2(value);
    const selected = this.#registry.resolve({
      providerId: request.provider.id,
      providerVersion: request.provider.version,
      adapterVersion: request.adapterVersion,
      operation: request.operation,
      sourceContractId: request.sourceContract.id,
      domainId: request.scope.domainId,
    });
    const docket = protocolDocket(request);
    return Object.freeze({
      ok: true,
      operation: 'evidence.preview',
      effects: effects(),
      authorityRequired: true,
      ownerActionRequired: true,
      nextAction: 'Ask the named owner to choose approve or cancel on this exact neutral docket.',
      data: Object.freeze({
        provider: request.provider,
        adapterVersion: request.adapterVersion,
        category: selected.adapter.definition.category,
        logicalCredentialRef: request.logicalCredentialRef,
        docket,
        protocolDocketHash: sha256CanonicalJson(docket),
      }),
    });
  }

  async status(value: ConnectorEvidenceRequestV2 | string): Promise<ConnectorRuntimeResultV2> {
    if (typeof value === 'string') {
      const snapshot = await this.#checkpoints.readByIdentity(value);
      const checkpoint = snapshot.checkpoint;
      return ok(
        'evidence.status',
        {
          checkpointId: checkpoint.checkpointId,
          requestId: checkpoint.requestId,
          state: checkpoint.state,
          generation: checkpoint.generation,
          requestHash: checkpoint.requestHash,
          artifactId: checkpoint.artifactId,
          artifactHash: checkpoint.artifactHash,
          updatedAt: checkpoint.updatedAt,
        },
        new Set(),
        checkpoint.state === 'committed'
          ? 'Use the accepted Evidence through normal Operate reads.'
          : 'Resume only the exact bound collection request.',
      );
    }
    const request = assertConnectorEvidenceRequestV2(value);
    const docket = protocolDocket(request);
    const protocolBinding: ConnectorCredentialProtocolBindingV2 = Object.freeze({
      actorId: request.ownerActorId,
      credentialRef: request.logicalCredentialRef,
      consentRecordId: request.consentRecordId,
      protocolDocketHash: sha256CanonicalJson(docket),
      provider: request.provider,
      adapterVersion: request.adapterVersion,
      accountIdentityHash: request.accountIdentityHash,
    });
    try {
      const consent = await this.#credentials.validatedConsent({
        ...protocolBinding,
        requestHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      });
      if (!exactConsentForRequest(consent, request, docket)) {
        fail(
          'E_LIVE_EVIDENCE_CONSENT_INVALID',
          'Stored consent does not match this exact request.',
        );
      }
      const protocolBindingHash = await this.#credentials.protocolBindingHash(protocolBinding);
      const selected = this.#registry.resolve({
        providerId: request.provider.id,
        providerVersion: request.provider.version,
        adapterVersion: request.adapterVersion,
        operation: request.operation,
        sourceContractId: request.sourceContract.id,
        domainId: request.scope.domainId,
      });
      const preparation = await this.#operate.prepareLiveEvidenceSubmission({
        assignmentId: request.assignmentId,
        submissionId: request.submissionId,
        actor: request.actor,
      });
      const baseEvidenceProvider = findBaseRecord(
        this.#evidenceRegistry.providers,
        record(selected.registration.baseEvidenceProvider, 'Provider base reference'),
        ['providerId', 'providerVersion'],
        'Base evidence-provider registration',
      );
      const baseResolver = findBaseRecord(
        this.#evidenceRegistry.resolvers,
        record(selected.registration.baseResolver, 'Resolver base reference'),
        ['resolverId', 'resolverVersion'],
        'Base evidence-resolver registration',
      );
      const checkpointId = digestId('lchk', { request, protocolBindingHash });
      const snapshot = await this.#checkpoints.readByIdentity(checkpointId);
      const context = this.#checkpointContext({
        request,
        preparation,
        registration: selected.registration,
        baseEvidenceProvider,
        baseResolver,
        consent,
        protocolBindingHash,
        health: record(
          snapshot.checkpoint.health,
          'Stored provider health',
        ) as ConnectorHealthProofV2,
      });
      const checkpoint = snapshot.checkpoint;
      this.#assertCheckpointContext(context, checkpoint);
      return ok(
        'evidence.status',
        {
          checkpointId: context.checkpointId,
          state: checkpoint.state,
          generation: checkpoint.generation,
          requestHash: checkpoint.requestHash,
          artifactId: checkpoint.artifactId,
          artifactHash: checkpoint.artifactHash,
          updatedAt: checkpoint.updatedAt,
        },
        new Set(),
        checkpoint.state === 'committed'
          ? 'Use the accepted Evidence through normal Operate reads.'
          : 'Resume the exact collection request; changed inputs will conflict.',
      );
    } catch (error) {
      if (
        error instanceof ConnectorCheckpointCustodyError &&
        error.code === 'LIVE_EVIDENCE_CHECKPOINT_NOT_FOUND'
      ) {
        return failed(
          'evidence.status',
          error.code,
          'No checkpoint exists for this exact request.',
          new Set(),
          { nextAction: 'Preview the request before choosing whether to collect.' },
        );
      }
      throw error;
    }
  }

  #checkpointContext(
    input: Readonly<{
      request: ConnectorEvidenceRequestV2;
      preparation: LiveEvidenceSubmissionPreparationV2;
      registration: JsonRecord;
      baseEvidenceProvider: JsonRecord;
      baseResolver: JsonRecord;
      consent: JsonRecord;
      protocolBindingHash: Hash;
      health: ConnectorHealthProofV2;
    }>,
  ): ConnectorCheckpointContextV2 {
    const {
      request,
      preparation,
      registration,
      baseEvidenceProvider,
      baseResolver,
      consent,
      protocolBindingHash,
      health,
    } = input;
    const sourceIdentityHash = sha256CanonicalJson({
      provider: request.provider,
      adapterVersion: request.adapterVersion,
      accountIdentityHash: request.accountIdentityHash,
      selectors: request.selectors,
      sourceContract: request.sourceContract,
    });
    const checkpointId = digestId('lchk', { request, protocolBindingHash });
    const requestId = digestId('lreq', { request, protocolBindingHash });
    const createdAt = String(consent.issuedAt);
    const immutable = {
      kind: 'operating-connector-checkpoint',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      checkpointId,
      requestId,
      effect: 'provider-call',
      provider: request.provider,
      providerRegistrationHash: registration.registrationHash,
      adapterVersion: request.adapterVersion,
      sourceIdentityHash,
      credentialRefHash: sha256CanonicalJson({
        logicalCredentialRef: request.logicalCredentialRef,
        protocolDocket: protocolDocket(request),
      }),
      boundsHash: sha256CanonicalJson(request.bounds),
      queryHash: request.queryHash,
      windowHash: sha256CanonicalJson(request.window),
      health,
      redactionVersion: '1.0.0',
      createdAt,
    };
    const provisionalRequesting = selfHashed(
      {
        ...immutable,
        generation: 1,
        lastEventId: digestId('lcev', { checkpointId, type: 'request' }),
        lastEventHash: sha256CanonicalJson({ checkpointId, type: 'request' }),
        state: 'requesting',
        requestHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        consentRecordId: consent.consentRecordId,
        consentRecordHash: consent.consentHash,
        consentExpiresAt: consent.expiresAt,
        runtimeCapabilityHash: protocolBindingHash,
        predecessorDigest:
          'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        watermarkDigest: null,
        artifactId: null,
        artifactHash: null,
        absenceDigest: null,
        updatedAt: createdAt,
      },
      'checkpointHash',
    );
    this.#contracts.assertOperatingConnectorCheckpointV2(provisionalRequesting);
    const requestHash = this.#contracts.deriveOperatingLiveEvidenceRequestHashV2({
      assignment: preparation.assignment,
      consentRecord: consent,
      connectorCheckpoint: provisionalRequesting,
      liveProviderRegistration: registration,
      baseEvidenceProvider,
      baseResolver,
      sourceContract: request.sourceContract,
      classification: request.classification,
    });
    const prepared = this.#contracts.assertOperatingConnectorCheckpointV2(
      selfHashed(
        {
          ...immutable,
          generation: 0,
          lastEventId: null,
          lastEventHash: null,
          state: 'prepared',
          requestHash,
          consentRecordId: null,
          consentRecordHash: null,
          consentExpiresAt: null,
          runtimeCapabilityHash: null,
          predecessorDigest: null,
          watermarkDigest: null,
          artifactId: null,
          artifactHash: null,
          absenceDigest: null,
          updatedAt: createdAt,
        },
        'checkpointHash',
      ),
    );
    return Object.freeze({
      checkpointId,
      requestId,
      requestHash,
      sourceIdentityHash,
      health,
      prepared,
    });
  }

  #assertCheckpointContext(
    context: Readonly<{ prepared: JsonRecord }>,
    checkpoint: JsonRecord,
  ): void {
    const immutableFields = [
      'kind',
      'schemaVersion',
      'protocolVersion',
      'checkpointId',
      'requestId',
      'effect',
      'provider',
      'providerRegistrationHash',
      'adapterVersion',
      'sourceIdentityHash',
      'credentialRefHash',
      'boundsHash',
      'queryHash',
      'windowHash',
      'health',
      'redactionVersion',
      'createdAt',
      'requestHash',
    ] as const;
    if (
      immutableFields.some(
        (field) =>
          sha256CanonicalJson(checkpoint[field]) !== sha256CanonicalJson(context.prepared[field]),
      )
    ) {
      fail(
        'E_LIVE_EVIDENCE_CHECKPOINT_CONFLICT',
        'Stored checkpoint custody does not match the exact request.',
      );
    }
  }

  #assertPreflightHealth(health: ConnectorHealthProofV2): void {
    if (
      health.status !== 'available' ||
      !HASH.test(health.proofDigest) ||
      !Number.isFinite(Date.parse(health.checkedAt)) ||
      !Number.isFinite(Date.parse(health.freshUntil)) ||
      Date.parse(health.checkedAt) >= Date.parse(health.freshUntil) ||
      this.#now() >= Date.parse(health.freshUntil)
    ) {
      fail(
        'E_LIVE_EVIDENCE_PROVIDER_UNHEALTHY',
        'The provider lacks one current trusted available-health proof.',
      );
    }
  }

  async collect(
    value: ConnectorEvidenceRequestV2,
    options: Readonly<{ allowOwnerConfirmation?: boolean }> = {},
  ): Promise<ConnectorRuntimeResultV2> {
    const operation = 'evidence.collect' as const;
    const executed = new Set<string>();
    const request = assertConnectorEvidenceRequestV2(value);
    const selected = this.#registry.resolve({
      providerId: request.provider.id,
      providerVersion: request.provider.version,
      adapterVersion: request.adapterVersion,
      operation: request.operation,
      sourceContractId: request.sourceContract.id,
      domainId: request.scope.domainId,
    });
    const registration = selected.registration;
    const operationDefinition = selected.adapter.definition.operations.find(
      (candidate) => candidate.operation === request.operation,
    );
    if (!operationDefinition) {
      fail('E_LIVE_EVIDENCE_PROVIDER_INCOMPATIBLE', 'The exact provider operation is unavailable.');
    }
    const registrationBounds = record(registration.bounds, 'Registration bounds');
    for (const key of ['maxCalls', 'maxPages', 'maxRecords', 'maxBytes'] as const) {
      if ((request.bounds[key] as number) > Number(registrationBounds[key])) {
        return failed(
          operation,
          'E_LIVE_EVIDENCE_SCOPE_EXPANSION',
          'The request exceeds the frozen provider bounds.',
          executed,
          {
            ownerActionRequired: true,
            nextAction: 'Ask the owner to approve a separately registered bounded provider scope.',
          },
        );
      }
    }
    if (
      !selected.adapter.definition.scopes.every((scope) => request.scopes.includes(scope)) ||
      !request.scopes.every((scope) => selected.adapter.definition.scopes.includes(scope))
    ) {
      return failed(
        operation,
        'E_LIVE_EVIDENCE_SCOPE_EXPANSION',
        'The request scopes differ from the frozen adapter scopes.',
        executed,
        {
          ownerActionRequired: true,
          nextAction: 'Ask the owner to approve a separately registered exact scope.',
        },
      );
    }

    const docket = protocolDocket(request);
    const protocolDocketHash = sha256CanonicalJson(docket);
    const protocolBinding: ConnectorCredentialProtocolBindingV2 = Object.freeze({
      actorId: request.ownerActorId,
      credentialRef: request.logicalCredentialRef,
      consentRecordId: request.consentRecordId,
      protocolDocketHash,
      provider: request.provider,
      adapterVersion: request.adapterVersion,
      accountIdentityHash: request.accountIdentityHash,
    });
    const proposedConsent = this.#contracts.assertOperatingLiveEvidenceConsentRecordV2(
      consentRecord(request, docket, new Date(this.#now()).toISOString()),
    );
    let currentConsent: JsonRecord | null = null;
    try {
      currentConsent = await this.#credentials.validatedConsent({
        ...protocolBinding,
        requestHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      });
    } catch (error) {
      if (
        !(error instanceof ConnectorCredentialCustodyError) ||
        !['LIVE_EVIDENCE_CONSENT_INVALID', 'LIVE_EVIDENCE_CONSENT_EXPIRED'].includes(error.code)
      ) {
        throw error;
      }
    }
    if (currentConsent && !exactConsentForRequest(currentConsent, request, docket)) {
      currentConsent = null;
    }
    if (!currentConsent && !options.allowOwnerConfirmation) {
      return failed(
        operation,
        'E_LIVE_EVIDENCE_OWNER_CONFIRMATION_REQUIRED',
        'The exact current owner consent grant is unavailable or changed.',
        executed,
        {
          ownerActionRequired: true,
          nextAction: 'Ask the named owner to review the exact neutral consent docket.',
        },
      );
    }
    const preparation = await this.#operate.prepareLiveEvidenceSubmission({
      assignmentId: request.assignmentId,
      submissionId: request.submissionId,
      actor: request.actor,
    });
    const baseEvidenceProvider = findBaseRecord(
      this.#evidenceRegistry.providers,
      record(registration.baseEvidenceProvider, 'Provider base reference'),
      ['providerId', 'providerVersion'],
      'Base evidence-provider registration',
    );
    const baseResolver = findBaseRecord(
      this.#evidenceRegistry.resolvers,
      record(registration.baseResolver, 'Resolver base reference'),
      ['resolverId', 'resolverVersion'],
      'Base evidence-resolver registration',
    );
    const consent = currentConsent ?? proposedConsent;
    const protocolBindingHash = currentConsent
      ? await this.#credentials.protocolBindingHash(protocolBinding)
      : sha256CanonicalJson({
          domain: 'openplanr-local-live-evidence-capability-binding-v2',
          authority: 'none',
          bindingHash: sha256CanonicalJson(protocolBinding),
          consentHash: proposedConsent.consentHash,
        });
    const checkpointId = digestId('lchk', { request, protocolBindingHash });
    let snapshot: Awaited<ReturnType<ConnectorCheckpointCustodyV2['readByIdentity']>> | undefined;
    let activeContext: ConnectorCheckpointContextV2;
    try {
      snapshot = await this.#checkpoints.readByIdentity(checkpointId);
      activeContext = this.#checkpointContext({
        request,
        preparation,
        registration,
        baseEvidenceProvider,
        baseResolver,
        consent,
        protocolBindingHash,
        health: record(
          snapshot.checkpoint.health,
          'Stored provider health',
        ) as ConnectorHealthProofV2,
      });
      this.#assertCheckpointContext(activeContext, snapshot.checkpoint);
    } catch (error) {
      if (
        !(error instanceof ConnectorCheckpointCustodyError) ||
        error.code !== 'LIVE_EVIDENCE_CHECKPOINT_NOT_FOUND'
      ) {
        throw error;
      }
      const preflightHealth = this.#transport.health({ request, registration });
      this.#assertPreflightHealth(preflightHealth);
      activeContext = this.#checkpointContext({
        request,
        preparation,
        registration,
        baseEvidenceProvider,
        baseResolver,
        consent,
        protocolBindingHash,
        health: preflightHealth,
      });
    }
    const credentialBinding: ConnectorCredentialCapabilityBindingV2 = Object.freeze({
      ...protocolBinding,
      requestHash: activeContext.requestHash,
    });
    let confirmedCapability:
      | Awaited<ReturnType<ConnectorCredentialCustodyV2['issueCapability']>>
      | undefined;
    if (!currentConsent) {
      const confirmation = await this.#credentials.issueOwnerConfirmation({
        binding: credentialBinding,
        proposedConsentRecord: proposedConsent,
      });
      confirmedCapability = await this.#credentials.issueCapability({
        binding: credentialBinding,
        ownerConfirmation: confirmation,
      });
      currentConsent = await this.#credentials.validatedConsent(credentialBinding);
      if (!exactConsentForRequest(currentConsent, request, docket)) {
        fail(
          'E_LIVE_EVIDENCE_CONSENT_INVALID',
          'Confirmed consent does not match the exact request.',
        );
      }
      const persistedBindingHash = await this.#credentials.protocolBindingHash(protocolBinding);
      if (persistedBindingHash !== protocolBindingHash) {
        fail('E_LIVE_EVIDENCE_CONSENT_INVALID', 'Confirmed consent changed its protocol binding.');
      }
    }
    if (!snapshot) {
      snapshot = await this.#checkpoints.initialize(activeContext.prepared);
    }
    const { sourceIdentityHash } = activeContext;
    let checkpoint = snapshot.checkpoint;

    if (checkpoint.state === 'committed') {
      return ok(
        operation,
        this.#acceptedSummary(checkpoint, snapshot.evidence?.bytes),
        executed,
        'Use the existing accepted Evidence; no provider or Store effect was repeated.',
      );
    }
    if (checkpoint.state === 'materialized') {
      return this.#completeMaterialized(
        request,
        preparation,
        registration,
        baseEvidenceProvider,
        baseResolver,
        consent,
        checkpoint,
        snapshot.evidence?.bytes,
        executed,
        snapshot.checkpointHistory,
      );
    }
    this.#assertPreflightHealth(checkpoint.health as ConnectorHealthProofV2);
    const capability =
      confirmedCapability ??
      (await this.#credentials.issueCapability({ binding: credentialBinding }));
    if (checkpoint.state === 'prepared') {
      const requestedAt = new Date(this.#now()).toISOString();
      snapshot = await this.#checkpoints.transition({
        checkpointId,
        event: checkpointEvent(checkpoint, 'request', requestedAt, {
          consentRecordId: consent.consentRecordId,
          consentRecordHash: consent.consentHash,
          consentExpiresAt: consent.expiresAt,
          runtimeCapabilityHash: protocolBindingHash,
          health: checkpoint.health,
        }),
      });
      checkpoint = snapshot.checkpoint;
    }
    if (checkpoint.state !== 'requesting') {
      return failed(
        operation,
        'E_LIVE_EVIDENCE_CHECKPOINT_TERMINAL',
        'The exact request already reached a non-materialized terminal checkpoint.',
        executed,
        { nextAction: 'Inspect the typed absence or uncertainty before creating a new request.' },
      );
    }

    let providerResult: ConnectorProviderCallResultV2;
    try {
      providerResult = await this.#credentials.withResolvedCredential(
        capability,
        credentialBinding,
        async (credential) => {
          executed.add('provider-call');
          return this.#transport.execute({
            request,
            registration,
            collection: operationDefinition.collection,
            credential,
            expectedHealth: checkpoint.health as ConnectorHealthProofV2,
          });
        },
      );
    } catch (error) {
      if (error instanceof ConnectorCredentialCustodyError) throw error;
      const observedAt = new Date(this.#now()).toISOString();
      providerResult = {
        status: 'uncertain',
        requestedAt: String(checkpoint.updatedAt),
        capturedAt: observedAt,
        freshUntil: new Date(this.#now() + 60_000).toISOString(),
        health: {
          status: 'unavailable',
          checkedAt: observedAt,
          freshUntil: new Date(this.#now() + 60_000).toISOString(),
          proofDigest: sha256CanonicalJson({
            domain: 'openplanr-live-evidence-provider-unavailable-v2',
            provider: request.provider,
            requestHash: checkpoint.requestHash,
            observedAt,
          }),
        },
        payload: {},
        absence: {
          kind: 'provider-unavailable',
          reasonCode: 'PROVIDER_UNAVAILABLE',
          required: true,
          observedAt,
          details: { retryable: false },
        },
      };
    }

    if (
      providerResult.status === 'materialized' &&
      (providerResult.health.status !== 'available' ||
        sha256CanonicalJson(providerResult.health) !== sha256CanonicalJson(checkpoint.health))
    ) {
      const observedAt = providerResult.capturedAt;
      providerResult = {
        ...providerResult,
        status: 'uncertain',
        payload: {},
        absence: {
          kind: 'unhealthy',
          reasonCode: 'PROVIDER_HEALTH_DIVERGED',
          required: true,
          observedAt,
          details: { expectedProofDigest: (checkpoint.health as JsonRecord).proofDigest },
        },
      };
    }

    const adapterResult = selected.adapter.normalize({
      operation: request.operation,
      sourceContract: request.sourceContract,
      requestHash: asHash(checkpoint.requestHash, 'Checkpoint request hash'),
      sourceIdentityHash,
      classification: request.classification,
      status: providerResult.status,
      requestedAt: providerResult.requestedAt,
      capturedAt: providerResult.capturedAt,
      freshUntil: providerResult.freshUntil,
      health: providerResult.health,
      bounds: request.bounds,
      payload: providerResult.payload,
      ...(providerResult.absence ? { absence: providerResult.absence } : {}),
    });
    if (adapterResult.status !== 'materialized') {
      const absence = adapterResult.absences[0];
      const terminalType = adapterResult.status === 'uncertain' ? 'uncertain' : 'absent';
      await this.#checkpoints.transition({
        checkpointId,
        event: checkpointEvent(checkpoint, terminalType, adapterResult.sourceTiming.capturedAt, {
          absenceDigest: absence.detailsHash,
          health: adapterResult.health,
        }),
        ...(providerResult.providerCursor ? { providerCursor: providerResult.providerCursor } : {}),
      });
      return failed(
        operation,
        absence.reasonCode,
        'The exact provider returned a typed absence or uncertain result.',
        executed,
        { nextAction: 'Resolve the declared provider condition or create a new bounded request.' },
      );
    }

    const redactedBytes = readConnectorAdapterResultBytesV2(adapterResult);
    if (sha256Bytes(redactedBytes) !== adapterResult.redactedBytesDigest) {
      fail('E_LIVE_EVIDENCE_RESPONSE_INVALID', 'Redacted adapter bytes changed after validation.');
    }

    const ingestion = this.#buildIngestion({
      request,
      preparation,
      registration,
      baseResolver,
      consent,
      checkpoint,
      adapterResult,
    });
    const ingestionBytes = Buffer.from(JSON.stringify(ingestion), 'utf8');
    snapshot = await this.#checkpoints.transition({
      checkpointId,
      event: checkpointEvent(checkpoint, 'materialize', adapterResult.sourceTiming.capturedAt, {
        artifactId: preparation.artifactId,
        artifactHash: sha256CanonicalJson(ingestion),
        watermarkDigest: providerResult.providerCursor
          ? sha256Bytes(providerResult.providerCursor)
          : null,
        health: adapterResult.health,
      }),
      evidenceBytes: ingestionBytes,
      evidenceFreshness: {
        capturedAt: adapterResult.sourceTiming.capturedAt,
        freshUntil: adapterResult.sourceTiming.freshUntil,
      },
      ...(providerResult.providerCursor ? { providerCursor: providerResult.providerCursor } : {}),
    });
    return this.#completeMaterialized(
      request,
      preparation,
      registration,
      baseEvidenceProvider,
      baseResolver,
      consent,
      snapshot.checkpoint,
      snapshot.evidence?.bytes,
      executed,
      snapshot.checkpointHistory,
    );
  }

  #buildIngestion(
    input: Readonly<{
      request: ConnectorEvidenceRequestV2;
      preparation: LiveEvidenceSubmissionPreparationV2;
      registration: JsonRecord;
      baseResolver: JsonRecord;
      consent: JsonRecord;
      checkpoint: JsonRecord;
      adapterResult: ConnectorAdapterResultV2;
    }>,
  ): JsonRecord {
    const { request, preparation, registration, consent, checkpoint, adapterResult } = input;
    const assignment = preparation.assignment;
    const candidate = {
      kind: 'operating-evidence-candidate',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      candidateId: preparation.candidateId,
      scopeId: request.scope.scopeId,
      domainId: request.scope.domainId,
      domainVersion: request.scope.domainVersion,
      sourceArtifactId: preparation.artifactId,
      evidenceKind: 'operate-artifact',
      locator: {
        artifactId: preparation.artifactId,
        expectedArtifactType: 'live-evidence-ingestion',
        expectedSchemaId: 'operating-live-evidence-ingestion',
        expectedSchemaVersion: '2.0.0',
      },
      provider: {
        id: (registration.baseEvidenceProvider as JsonRecord).providerId,
        version: (registration.baseEvidenceProvider as JsonRecord).providerVersion,
      },
      resolver: {
        id: (registration.baseResolver as JsonRecord).resolverId,
        version: (registration.baseResolver as JsonRecord).resolverVersion,
      },
    };
    const body: Record<string, unknown> = {
      kind: 'operating-live-evidence-ingestion',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      ingestionId: preparation.ingestionId,
      requestId: checkpoint.requestId,
      requestHash: checkpoint.requestHash,
      assignment: {
        assignmentId: assignment.assignmentId,
        assignmentRevision: 1,
        assignmentHash: sha256CanonicalJson(assignment),
        requestHash: checkpoint.requestHash,
        assignmentKind: 'verification',
        outputContract: {
          schemaId: 'operating-live-evidence-ingestion',
          schemaVersion: '2.0.0',
        },
      },
      submission: {
        operation: 'operate.assignment.submit',
        submissionId: preparation.submissionId,
        submittedEventId: preparation.acceptanceEventIds.submitted,
        artifactCreatedEventId: preparation.acceptanceEventIds.artifactCreated,
        validatedEventId: preparation.acceptanceEventIds.validated,
        artifactId: preparation.artifactId,
        evidenceRefId: preparation.evidenceRefId,
      },
      provider: request.provider,
      providerRegistration: registration.baseEvidenceProvider,
      providerRegistrationHash: registration.registrationHash,
      resolverRegistration: registration.baseResolver,
      resolverRegistrationHash: (registration.baseResolver as JsonRecord).recordDigest,
      adapterVersion: request.adapterVersion,
      status: 'materialized',
      consentRecordHash: consent.consentHash,
      runtimeCapabilityHash: checkpoint.runtimeCapabilityHash,
      checkpoint: {
        checkpointId: checkpoint.checkpointId,
        predecessorDigest: checkpoint.predecessorDigest,
        checkpointHash: checkpoint.checkpointHash,
      },
      health: adapterResult.health,
      boundsHash: sha256CanonicalJson(request.bounds),
      classification: request.classification,
      sourceContract: request.sourceContract,
      sourceTiming: adapterResult.sourceTiming,
      records: adapterResult.records,
      absences: [],
      evidenceCandidates: [candidate],
      evidenceClaimLinks: [
        {
          candidateId: preparation.candidateId,
          sourceArtifactId: preparation.artifactId,
          localClaimId: request.claim.localClaimId,
          relation: request.claim.relation,
          confidence: request.claim.confidence,
        },
      ],
      materialization: {
        artifactId: preparation.artifactId,
        artifactCreatedEventId: preparation.acceptanceEventIds.artifactCreated,
        evidenceRefId: preparation.evidenceRefId,
        contentDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        redactionVersion: '1.0.0',
      },
    };
    (body.materialization as Record<string, unknown>).contentDigest =
      this.#contracts.deriveOperatingLiveEvidenceContentDigestV2(body);
    body.ingestionHash = sha256CanonicalJson(body);
    return Object.freeze(body);
  }

  #acceptedSummary(checkpoint: JsonRecord, bytes?: Uint8Array): JsonRecord {
    if (!bytes)
      fail('E_LIVE_EVIDENCE_CHECKPOINT_INVALID', 'Accepted evidence custody is unavailable.');
    let ingestion: JsonRecord;
    try {
      ingestion = record(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
        'Accepted ingestion',
      );
    } catch {
      fail('E_LIVE_EVIDENCE_CHECKPOINT_INVALID', 'Accepted evidence custody is invalid.');
    }
    const submission = record(ingestion.submission, 'Accepted submission');
    return Object.freeze({
      checkpointId: checkpoint.checkpointId,
      state: checkpoint.state,
      requestHash: checkpoint.requestHash,
      artifactId: checkpoint.artifactId,
      artifactHash: checkpoint.artifactHash,
      evidenceRefId: submission.evidenceRefId,
      ingestionId: ingestion.ingestionId,
      replayed: true,
    });
  }

  async #completeMaterialized(
    request: ConnectorEvidenceRequestV2,
    preparation: LiveEvidenceSubmissionPreparationV2,
    registration: JsonRecord,
    baseEvidenceProvider: JsonRecord,
    baseResolver: JsonRecord,
    consent: JsonRecord,
    checkpoint: JsonRecord,
    bytes: Uint8Array | undefined,
    executed: Set<string>,
    checkpointHistory: readonly JsonRecord[] = [],
  ): Promise<ConnectorRuntimeResultV2> {
    if (!bytes)
      fail('E_LIVE_EVIDENCE_CHECKPOINT_INVALID', 'Materialized evidence bytes are unavailable.');
    const ingestion = record(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      'Materialized ingestion',
    );
    const requestingCheckpoints = checkpointHistory.filter(
      (candidate) => candidate.state === 'requesting',
    );
    if (requestingCheckpoints.length !== 1) {
      fail(
        'E_LIVE_EVIDENCE_CHECKPOINT_INVALID',
        'Materialized evidence does not retain one exact requesting checkpoint.',
      );
    }
    const requestingCheckpoint = requestingCheckpoints[0];
    this.#contracts.assertOperatingLiveEvidenceIngestionV2(ingestion, {
      liveProviderRegistration: registration,
      baseEvidenceProvider,
      baseResolver,
      assignment: preparation.assignment,
      consentRecord: consent,
      connectorCheckpoint: requestingCheckpoint,
    });
    const result = await this.#operate.acceptLiveEvidenceSubmission({
      assignmentId: request.assignmentId,
      submissionId: request.submissionId,
      actor: request.actor,
      preparationHash: preparation.preparationHash,
      contentBase64: Buffer.from(bytes).toString('base64'),
      custody: {
        issuedAssignment: preparation.assignment,
        liveProviderRegistration: registration,
        baseEvidenceProvider,
        baseResolver,
        consentRecord: consent,
        connectorCheckpoint: requestingCheckpoint,
        resultCheckpoint: checkpoint,
        checkpointHistory: [],
      },
    });
    executed.add('operate-assignment-submit');
    executed.add('evidence-materialization');
    const committedAt = new Date(this.#now()).toISOString();
    const committed = await this.#checkpoints.transition({
      checkpointId: String(checkpoint.checkpointId),
      event: checkpointEvent(checkpoint, 'commit', committedAt, {
        watermarkDigest: checkpoint.watermarkDigest,
      }),
    });
    return ok(
      'evidence.collect',
      {
        checkpointId: committed.checkpoint.checkpointId,
        state: committed.checkpoint.state,
        requestHash: committed.checkpoint.requestHash,
        artifactId: result.artifactId,
        artifactHash: result.artifactHash,
        evidenceRefId: result.evidenceRefId,
        evidenceArtifactId: result.evidenceArtifactId,
        resolutionId: result.resolutionId,
        replayed: result.replayed,
      },
      executed,
      'Use the accepted Evidence through normal Operate reads.',
    );
  }
}

export function createConnectorRuntimeV2(
  input: ConstructorParameters<typeof ConnectorRuntimeV2>[0],
): ConnectorRuntimeV2 {
  return new ConnectorRuntimeV2(input);
}

export type BoundedConnectorFetchPolicyV2 = Readonly<{
  providerId: string;
  origin: string;
  pathnameByOperation: Readonly<Record<string, string>>;
  allowLoopback: boolean;
  authorizationScheme: 'Bearer';
  timeoutMs: number;
}>;

function privateAddress(address: string): boolean {
  if (address.includes(':')) {
    const value = address.toLowerCase();
    const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(value)?.[1];
    const words = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(value);
    if (dotted) return privateAddress(dotted);
    if (words) {
      const high = Number.parseInt(words[1], 16);
      const low = Number.parseInt(words[2], 16);
      return privateAddress(`${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`);
    }
    return (
      value === '::' ||
      value === '::1' ||
      value.startsWith('fc') ||
      value.startsWith('fd') ||
      /^fe[89ab]/u.test(value) ||
      value.startsWith('ff')
    );
  }
  const parts = address.split('.').map(Number);
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    parts[0] >= 224
  );
}

async function assertTransportTarget(
  url: URL,
  allowLoopback: boolean,
  resolveHost: (hostname: string) => Promise<readonly Readonly<{ address: string }>[]>,
): Promise<readonly string[]> {
  const exactLoopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !(allowLoopback && exactLoopback && url.protocol === 'http:'))
  ) {
    fail('E_LIVE_EVIDENCE_TRANSPORT_FORBIDDEN', 'Provider transport target is not allowed.');
  }
  const addresses = isIP(url.hostname.replace(/^\[|\]$/gu, ''))
    ? [{ address: url.hostname.replace(/^\[|\]$/gu, '') }]
    : await resolveHost(url.hostname);
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => privateAddress(address) && !(allowLoopback && exactLoopback))
  ) {
    fail('E_LIVE_EVIDENCE_TRANSPORT_FORBIDDEN', 'Provider address is not allowed.');
  }
  return Object.freeze(addresses.map(({ address }) => address.toLowerCase()).sort());
}

async function boundedResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > maxBytes) {
    fail('E_LIVE_EVIDENCE_RESPONSE_TOO_LARGE', 'Provider response exceeds the exact byte ceiling.');
  }
  if (!response.body)
    fail('E_LIVE_EVIDENCE_RESPONSE_INVALID', 'Provider response body is unavailable.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        fail(
          'E_LIVE_EVIDENCE_RESPONSE_TOO_LARGE',
          'Provider response exceeds the exact byte ceiling.',
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function csvPayload(text: string, collection: string, observedAt: string): JsonRecord {
  const rows = text.trim().split(/\r?\n/u);
  if (rows.length < 2) fail('E_LIVE_EVIDENCE_RESPONSE_INVALID', 'CSV response is empty.');
  const headings = rows[0].split(',').map((value) => value.trim());
  if (headings.some((value) => !TEXT_ID.test(value))) {
    fail('E_LIVE_EVIDENCE_RESPONSE_INVALID', 'CSV headings are invalid.');
  }
  return {
    [collection]: rows.slice(1).map((row, index) => {
      const values = row.split(',').map((value) => value.trim());
      if (values.length !== headings.length) {
        fail('E_LIVE_EVIDENCE_RESPONSE_INVALID', 'CSV row shape changed.');
      }
      return {
        id: `row-${index + 1}`,
        observedAt,
        data: Object.fromEntries(headings.map((heading, position) => [heading, values[position]])),
      };
    }),
  };
}

export function createBoundedFetchConnectorTransportV2(
  input: Readonly<{
    policies: readonly BoundedConnectorFetchPolicyV2[];
    fetchImpl?: typeof fetch;
    now?: () => number;
    resolveHost?: (hostname: string) => Promise<readonly Readonly<{ address: string }>[]>;
  }>,
): ConnectorProviderTransportV2 {
  const policies = new Map(input.policies.map((policy) => [policy.providerId, policy]));
  if (policies.size !== input.policies.length) {
    fail('E_LIVE_EVIDENCE_TRANSPORT_CONFIG_INVALID', 'Provider transport policy is duplicated.');
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? Date.now;
  const resolveHost =
    input.resolveHost ??
    (async (hostname: string) => lookup(hostname, { all: true, verbatim: true }));
  return Object.freeze({
    health({ request }) {
      const policy = policies.get(request.provider.id);
      if (!policy)
        fail('E_LIVE_EVIDENCE_TRANSPORT_CONFIG_INVALID', 'Provider policy is unavailable.');
      const checkedAt = new Date(now()).toISOString();
      const freshUntil = new Date(now() + Math.min(policy.timeoutMs * 2, 300_000)).toISOString();
      return Object.freeze({
        status: 'available',
        checkedAt,
        freshUntil,
        proofDigest: sha256CanonicalJson({
          domain: 'openplanr-live-evidence-transport-health-v2',
          provider: request.provider,
          origin: policy.origin,
          checkedAt,
          freshUntil,
        }),
      });
    },
    async execute({ request, collection, credential, expectedHealth }) {
      const policy = policies.get(request.provider.id);
      if (!policy)
        fail('E_LIVE_EVIDENCE_TRANSPORT_CONFIG_INVALID', 'Provider policy is unavailable.');
      const pathname = policy.pathnameByOperation[request.operation];
      if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.includes('?')) {
        fail('E_LIVE_EVIDENCE_TRANSPORT_CONFIG_INVALID', 'Provider operation path is unavailable.');
      }
      const origin = new URL(policy.origin);
      const beforeAddresses = await assertTransportTarget(
        origin,
        policy.allowLoopback,
        resolveHost,
      );
      const target = new URL(pathname, origin);
      if (target.origin !== origin.origin) {
        fail(
          'E_LIVE_EVIDENCE_TRANSPORT_FORBIDDEN',
          'Provider operation escaped its allowed origin.',
        );
      }
      const requestedAt = new Date(now()).toISOString();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), policy.timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(target, {
          method: 'GET',
          redirect: 'manual',
          headers: {
            accept: 'application/json, text/csv',
            authorization: `${policy.authorizationScheme} ${Buffer.from(credential).toString('utf8')}`,
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      const afterAddresses = await assertTransportTarget(origin, policy.allowLoopback, resolveHost);
      if (JSON.stringify(afterAddresses) !== JSON.stringify(beforeAddresses)) {
        fail(
          'E_LIVE_EVIDENCE_DNS_REBINDING',
          'Provider address resolution changed during the bounded request.',
        );
      }
      if (response.status >= 300 && response.status < 400) {
        fail('E_LIVE_EVIDENCE_REDIRECT_FORBIDDEN', 'Provider redirects are not followed.');
      }
      const capturedAt = new Date(now()).toISOString();
      const health: ConnectorHealthProofV2 = Object.freeze({
        status: response.ok ? 'available' : 'unavailable',
        checkedAt: capturedAt,
        freshUntil: new Date(now() + 60_000).toISOString(),
        proofDigest: sha256CanonicalJson({
          domain: 'openplanr-live-evidence-http-health-v2',
          provider: request.provider,
          status: response.status,
          capturedAt,
        }),
      });
      if (!response.ok) {
        return {
          status: 'absent',
          requestedAt,
          capturedAt,
          freshUntil: health.freshUntil,
          health,
          payload: {},
          absence: {
            kind: response.status === 429 ? 'rate-limited' : 'provider-unavailable',
            reasonCode: response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
            required: true,
            observedAt: capturedAt,
            details: { statusClass: `${Math.floor(response.status / 100)}xx` },
          },
        };
      }
      const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
      if (mediaType !== 'application/json' && mediaType !== 'text/csv') {
        fail('E_LIVE_EVIDENCE_RESPONSE_INVALID', 'Provider response media type is unsupported.');
      }
      const bytes = await boundedResponseBytes(response, request.bounds.maxBytes);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      let payload: unknown;
      try {
        payload =
          mediaType === 'text/csv' ? csvPayload(text, collection, capturedAt) : JSON.parse(text);
      } catch (cause) {
        if (cause instanceof ConnectorRuntimeErrorV2) throw cause;
        fail('E_LIVE_EVIDENCE_RESPONSE_INVALID', 'Provider response is invalid UTF-8 data.');
      }
      return {
        status: 'materialized',
        requestedAt,
        capturedAt,
        freshUntil: new Date(now() + 300_000).toISOString(),
        health: expectedHealth,
        payload,
      };
    },
  });
}
