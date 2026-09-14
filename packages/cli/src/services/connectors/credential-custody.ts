import { createHash, randomBytes } from 'node:crypto';
import { sha256CanonicalJson } from '../canonical-json.js';
import type { ConnectorProviderIdentityV2 } from './connector-registry.js';

export type ConnectorCredentialSourceV2 =
  | Readonly<{ kind: 'environment-name'; name: string }>
  | Readonly<{ kind: 'os-custody-key'; service: string; account: string }>;

export type ConnectorCredentialLocalBindingV2 = Readonly<{
  credentialRef: string;
  provider: ConnectorProviderIdentityV2;
  adapterVersion: string;
  accountIdentityHash: `sha256:${string}`;
  source: ConnectorCredentialSourceV2;
}>;

export type ConnectorCredentialProtocolBindingV2 = Readonly<{
  actorId: string;
  credentialRef: string;
  consentRecordId: string;
  protocolDocketHash: `sha256:${string}`;
  provider: ConnectorProviderIdentityV2;
  adapterVersion: string;
  accountIdentityHash: `sha256:${string}`;
}>;

export type ConnectorCredentialCapabilityBindingV2 = ConnectorCredentialProtocolBindingV2 &
  Readonly<{ requestHash: `sha256:${string}` }>;

declare const OWNER_CONFIRMATION_BRAND: unique symbol;
declare const CREDENTIAL_CAPABILITY_BRAND: unique symbol;
export type ConnectorOwnerConfirmationV2 = Readonly<{
  readonly [OWNER_CONFIRMATION_BRAND]: true;
}>;
export type ConnectorCredentialCapabilityV2 = Readonly<{
  readonly [CREDENTIAL_CAPABILITY_BRAND]: true;
}>;

export type ConnectorOwnerConfirmationDocketV2 = Readonly<{
  kind: 'openplanr-live-evidence-owner-confirmation-docket';
  schemaVersion: '1.0.0';
  actorId: string;
  consentRecordId: string;
  requestHash: `sha256:${string}`;
  logicalCredentialRef: string;
  protocolDocket: Readonly<Record<string, unknown>>;
  protocolDocketHash: `sha256:${string}`;
  effect: 'provider-call';
  authorityBoundary: 'confirmation-is-not-credential-authority';
  choices: readonly ['approve', 'cancel'];
  defaultChoice: null;
  cancelEffect: 'none';
  expiresAt: string;
}>;

export type ConnectorCredentialCustodyErrorCode =
  | 'LIVE_EVIDENCE_CREDENTIAL_CONFIG_INVALID'
  | 'LIVE_EVIDENCE_CREDENTIAL_CUSTODY_UNAVAILABLE'
  | 'LIVE_EVIDENCE_CREDENTIAL_READ_FAILED'
  | 'LIVE_EVIDENCE_CREDENTIAL_UNAVAILABLE'
  | 'LIVE_EVIDENCE_CONSENT_INVALID'
  | 'LIVE_EVIDENCE_CONSENT_EXPIRED'
  | 'LIVE_EVIDENCE_OWNER_CONFIRMATION_REQUIRED'
  | 'LIVE_EVIDENCE_OWNER_CONFIRMATION_INVALID'
  | 'LIVE_EVIDENCE_CAPABILITY_INVALID'
  | 'LIVE_EVIDENCE_CAPABILITY_EXPIRED'
  | 'LIVE_EVIDENCE_CAPABILITY_REPLAYED';

type ConnectorCredentialSourceErrorCode =
  | 'LIVE_EVIDENCE_KEYRING_UNAVAILABLE'
  | 'LIVE_EVIDENCE_KEYRING_READ_FAILED';

class ConnectorCredentialSourceError extends Error {
  constructor(
    readonly code: ConnectorCredentialSourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}

export class ConnectorCredentialCustodyError extends Error {
  constructor(
    readonly code: ConnectorCredentialCustodyErrorCode,
    message: string,
    readonly sourceCode?: ConnectorCredentialSourceErrorCode,
  ) {
    super(message);
    this.name = code;
  }
}

type ConsentRecord = Readonly<Record<string, unknown>>;

type OwnerConfirmationState = {
  bindingHash: `sha256:${string}`;
  consentHash: `sha256:${string}`;
  consentRecord: ConsentRecord;
  expiresAtMs: number;
  used: boolean;
};

type CapabilityState = {
  bindingHash: `sha256:${string}`;
  capabilityHash: `sha256:${string}`;
  consentHash: `sha256:${string}`;
  expiresAtMs: number;
  used: boolean;
};

const HASH = /^sha256:[a-f0-9]{64}$/u;
const TEXT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;

function fail(code: ConnectorCredentialCustodyErrorCode, message: string): never {
  throw new ConnectorCredentialCustodyError(code, message);
}

function object(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('LIVE_EVIDENCE_CONSENT_INVALID', `${label} is unavailable or invalid.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function createOpaqueHandle<T>(label: string): T {
  const handle = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(handle, 'toJSON', {
    enumerable: false,
    value: () => {
      throw new TypeError(`${label} is process-local and cannot be serialized.`);
    },
  });
  return Object.freeze(handle) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function bytesHash(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function assertProtocolBinding(binding: ConnectorCredentialProtocolBindingV2): void {
  if (
    !TEXT_ID.test(binding.actorId) ||
    !TEXT_ID.test(binding.credentialRef) ||
    !TEXT_ID.test(binding.consentRecordId) ||
    !TEXT_ID.test(binding.provider.id) ||
    !VERSION.test(binding.provider.version) ||
    !VERSION.test(binding.adapterVersion) ||
    !HASH.test(binding.protocolDocketHash) ||
    !HASH.test(binding.accountIdentityHash)
  ) {
    fail('LIVE_EVIDENCE_CREDENTIAL_CONFIG_INVALID', 'Credential capability binding is invalid.');
  }
}

function assertBinding(binding: ConnectorCredentialCapabilityBindingV2): void {
  assertProtocolBinding(binding);
  if (!HASH.test(binding.requestHash)) {
    fail('LIVE_EVIDENCE_CREDENTIAL_CONFIG_INVALID', 'Credential request binding is invalid.');
  }
}

function localBindingHash(binding: ConnectorCredentialLocalBindingV2): `sha256:${string}` {
  return sha256CanonicalJson({
    credentialRef: binding.credentialRef,
    provider: binding.provider,
    adapterVersion: binding.adapterVersion,
    accountIdentityHash: binding.accountIdentityHash,
  });
}

function capabilityBindingHash(
  binding: ConnectorCredentialCapabilityBindingV2,
): `sha256:${string}` {
  assertBinding(binding);
  return sha256CanonicalJson({
    actorId: binding.actorId,
    credentialRef: binding.credentialRef,
    requestHash: binding.requestHash,
    consentRecordId: binding.consentRecordId,
    protocolDocketHash: binding.protocolDocketHash,
    provider: binding.provider,
    adapterVersion: binding.adapterVersion,
    accountIdentityHash: binding.accountIdentityHash,
  });
}

function matchesLocalBinding(
  local: ConnectorCredentialLocalBindingV2,
  requested: ConnectorCredentialCapabilityBindingV2,
): boolean {
  return (
    local.credentialRef === requested.credentialRef &&
    local.provider.id === requested.provider.id &&
    local.provider.version === requested.provider.version &&
    local.adapterVersion === requested.adapterVersion &&
    local.accountIdentityHash === requested.accountIdentityHash
  );
}

async function defaultKeychainRead(
  service: string,
  account: string,
): Promise<string | Uint8Array | undefined> {
  let Entry: typeof import('@napi-rs/keyring')['Entry'];
  try {
    ({ Entry } = await import('@napi-rs/keyring'));
  } catch {
    throw new ConnectorCredentialSourceError(
      'LIVE_EVIDENCE_KEYRING_UNAVAILABLE',
      'OS credential-store support is unavailable on this platform.',
    );
  }
  try {
    return new Entry(service, account).getPassword() ?? undefined;
  } catch {
    throw new ConnectorCredentialSourceError(
      'LIVE_EVIDENCE_KEYRING_READ_FAILED',
      'The OS credential store refused or failed the credential read.',
    );
  }
}

function credentialSourceError(error: unknown): ConnectorCredentialSourceError {
  if (error instanceof ConnectorCredentialSourceError) return error;
  return new ConnectorCredentialSourceError(
    'LIVE_EVIDENCE_KEYRING_READ_FAILED',
    'The OS credential store refused or failed the credential read.',
  );
}

export class ConnectorCredentialCustodyV2 {
  readonly #bindings: readonly ConnectorCredentialLocalBindingV2[];
  readonly #allowedEnvironmentNames: ReadonlySet<string>;
  readonly #assertConsent: (record: unknown) => Readonly<Record<string, unknown>>;
  readonly #loadConsentRecord: (consentRecordId: string) => Promise<unknown | null>;
  readonly #persistConsentRecord: (record: ConsentRecord) => Promise<unknown>;
  readonly #confirmOwner: (
    docket: ConnectorOwnerConfirmationDocketV2,
  ) => Promise<Readonly<{ approved: boolean; actorId: string }>>;
  readonly #readEnvironment: (name: string) => string | Uint8Array | undefined;
  readonly #readKeychain: (
    service: string,
    account: string,
  ) => Promise<string | Uint8Array | undefined>;
  readonly #now: () => number;
  readonly #entropy: () => Uint8Array;
  readonly #ttlMs: number;
  readonly #ownerConfirmations = new WeakMap<object, OwnerConfirmationState>();
  readonly #capabilities = new WeakMap<object, CapabilityState>();

  constructor(input: {
    contracts: Readonly<{
      assertOperatingLiveEvidenceConsentRecordV2(
        record: unknown,
      ): Readonly<Record<string, unknown>>;
    }>;
    bindings: readonly ConnectorCredentialLocalBindingV2[];
    allowedEnvironmentNames: readonly string[];
    loadConsentRecord(consentRecordId: string): Promise<unknown | null>;
    persistConsentRecord(record: Readonly<Record<string, unknown>>): Promise<unknown>;
    confirmOwner(
      docket: ConnectorOwnerConfirmationDocketV2,
    ): Promise<Readonly<{ approved: boolean; actorId: string }>>;
    readEnvironment?: (name: string) => string | Uint8Array | undefined;
    readKeychain?: (service: string, account: string) => Promise<string | Uint8Array | undefined>;
    now?: () => number;
    entropy?: () => Uint8Array;
    ttlMs?: number;
  }) {
    if (
      !Number.isSafeInteger(input.ttlMs ?? 60_000) ||
      (input.ttlMs ?? 60_000) < 1_000 ||
      (input.ttlMs ?? 60_000) > 300_000
    ) {
      fail('LIVE_EVIDENCE_CREDENTIAL_CONFIG_INVALID', 'Credential capability TTL is invalid.');
    }
    const environmentNames = new Set(input.allowedEnvironmentNames);
    if (environmentNames.size !== input.allowedEnvironmentNames.length) {
      fail('LIVE_EVIDENCE_CREDENTIAL_CONFIG_INVALID', 'Environment allowlist is not unique.');
    }
    const identities = new Set<string>();
    this.#bindings = Object.freeze(
      input.bindings.map((binding) => {
        if (
          !TEXT_ID.test(binding.credentialRef) ||
          !TEXT_ID.test(binding.provider.id) ||
          !VERSION.test(binding.provider.version) ||
          !VERSION.test(binding.adapterVersion) ||
          !HASH.test(binding.accountIdentityHash)
        ) {
          fail('LIVE_EVIDENCE_CREDENTIAL_CONFIG_INVALID', 'Credential binding is invalid.');
        }
        if (
          binding.source.kind === 'environment-name' &&
          !environmentNames.has(binding.source.name)
        ) {
          fail('LIVE_EVIDENCE_CREDENTIAL_CONFIG_INVALID', 'Credential source is not allowlisted.');
        }
        if (
          binding.source.kind === 'os-custody-key' &&
          (!binding.source.service.trim() || !binding.source.account.trim())
        ) {
          fail('LIVE_EVIDENCE_CREDENTIAL_CONFIG_INVALID', 'Credential source is invalid.');
        }
        const identity = localBindingHash(binding);
        if (identities.has(identity)) {
          fail('LIVE_EVIDENCE_CREDENTIAL_CONFIG_INVALID', 'Credential binding is duplicated.');
        }
        identities.add(identity);
        return Object.freeze(structuredClone(binding));
      }),
    );
    this.#allowedEnvironmentNames = environmentNames;
    this.#assertConsent = input.contracts.assertOperatingLiveEvidenceConsentRecordV2;
    this.#loadConsentRecord = input.loadConsentRecord;
    this.#persistConsentRecord = input.persistConsentRecord;
    this.#confirmOwner = input.confirmOwner;
    this.#readEnvironment = input.readEnvironment ?? ((name) => process.env[name]);
    this.#readKeychain = input.readKeychain ?? defaultKeychainRead;
    this.#now = input.now ?? Date.now;
    this.#entropy = input.entropy ?? (() => randomBytes(32));
    this.#ttlMs = input.ttlMs ?? 60_000;
  }

  #assertExactConsent(
    binding: ConnectorCredentialProtocolBindingV2,
    value: unknown,
  ): { record: ConsentRecord; consentHash: `sha256:${string}`; expiresAtMs: number } {
    assertProtocolBinding(binding);
    let asserted: Readonly<Record<string, unknown>>;
    try {
      asserted = this.#assertConsent(value);
    } catch {
      fail('LIVE_EVIDENCE_CONSENT_INVALID', 'The trusted local consent is invalid.');
    }
    const consent = object(asserted, 'Consent record');
    const actor = object(consent.actor, 'Consent actor');
    const provider = object(consent.provider, 'Consent provider');
    const expiresAtMs = Date.parse(String(consent.expiresAt));
    const consentHash = String(consent.consentHash);
    if (
      consent.kind !== 'operating-live-evidence-consent-record' ||
      consent.consentRecordId !== binding.consentRecordId ||
      consent.decision !== 'approved' ||
      consent.authority !== 'none' ||
      actor.actorId !== binding.actorId ||
      actor.kind !== 'human' ||
      provider.id !== binding.provider.id ||
      provider.version !== binding.provider.version ||
      consent.adapterVersion !== binding.adapterVersion ||
      consent.accountIdentityHash !== binding.accountIdentityHash ||
      consent.docketHash !== binding.protocolDocketHash ||
      !HASH.test(consentHash) ||
      !Number.isFinite(expiresAtMs)
    ) {
      fail(
        'LIVE_EVIDENCE_CONSENT_INVALID',
        'The exact trusted local consent does not match the request.',
      );
    }
    if (expiresAtMs <= this.#now()) {
      fail('LIVE_EVIDENCE_CONSENT_EXPIRED', 'The exact trusted local consent has expired.');
    }
    return { record: consent, consentHash: consentHash as `sha256:${string}`, expiresAtMs };
  }

  async #loadExactConsent(
    binding: ConnectorCredentialProtocolBindingV2,
    optional = false,
  ): Promise<{
    record: ConsentRecord;
    consentHash: `sha256:${string}`;
    expiresAtMs: number;
  } | null> {
    const value = await this.#loadConsentRecord(binding.consentRecordId);
    if (value === null || value === undefined) {
      if (optional) return null;
      fail('LIVE_EVIDENCE_CONSENT_INVALID', 'The trusted local consent is unavailable.');
    }
    try {
      return await this.#assertExactConsent(binding, value);
    } catch (error) {
      if (optional && error instanceof ConnectorCredentialCustodyError) return null;
      throw error;
    }
  }

  async validatedConsent(
    binding: ConnectorCredentialCapabilityBindingV2,
  ): Promise<Readonly<Record<string, unknown>>> {
    const consent = await this.#loadExactConsent(binding);
    if (!consent)
      fail('LIVE_EVIDENCE_CONSENT_INVALID', 'The trusted local consent is unavailable.');
    return Object.freeze(structuredClone(consent.record));
  }

  async issueOwnerConfirmation(
    input: Readonly<{
      binding: ConnectorCredentialCapabilityBindingV2;
      proposedConsentRecord: unknown;
    }>,
  ): Promise<ConnectorOwnerConfirmationV2> {
    const { binding } = input;
    const { record, consentHash, expiresAtMs } = await this.#assertExactConsent(
      binding,
      input.proposedConsentRecord,
    );
    const docket = Object.freeze({
      kind: 'openplanr-live-evidence-owner-confirmation-docket',
      schemaVersion: '1.0.0',
      actorId: binding.actorId,
      consentRecordId: binding.consentRecordId,
      requestHash: binding.requestHash,
      logicalCredentialRef: binding.credentialRef,
      protocolDocket: deepFreeze(structuredClone(object(record.docket, 'Consent protocol docket'))),
      protocolDocketHash: binding.protocolDocketHash,
      effect: 'provider-call',
      authorityBoundary: 'confirmation-is-not-credential-authority',
      choices: Object.freeze(['approve', 'cancel'] as const),
      defaultChoice: null,
      cancelEffect: 'none',
      expiresAt: new Date(Math.min(expiresAtMs, this.#now() + this.#ttlMs)).toISOString(),
    } satisfies ConnectorOwnerConfirmationDocketV2);
    const decision = await this.#confirmOwner(docket);
    if (decision.approved !== true || decision.actorId !== binding.actorId) {
      fail(
        'LIVE_EVIDENCE_OWNER_CONFIRMATION_INVALID',
        'Owner confirmation was declined or mismatched.',
      );
    }
    const handle = createOpaqueHandle<ConnectorOwnerConfirmationV2>('Owner confirmation');
    this.#ownerConfirmations.set(handle, {
      bindingHash: capabilityBindingHash(binding),
      consentHash,
      consentRecord: Object.freeze(structuredClone(record)),
      expiresAtMs: Math.min(expiresAtMs, this.#now() + this.#ttlMs),
      used: false,
    });
    return handle;
  }

  async issueCapability(input: {
    binding: ConnectorCredentialCapabilityBindingV2;
    ownerConfirmation?: ConnectorOwnerConfirmationV2;
  }): Promise<ConnectorCredentialCapabilityV2> {
    const { binding } = input;
    const bindingHash = capabilityBindingHash(binding);
    let consent = await this.#loadExactConsent(binding, true);
    if (!consent) {
      const confirmation = input.ownerConfirmation
        ? this.#ownerConfirmations.get(input.ownerConfirmation)
        : undefined;
      if (!confirmation) {
        fail(
          'LIVE_EVIDENCE_OWNER_CONFIRMATION_REQUIRED',
          'A one-shot owner confirmation is required.',
        );
      }
      if (
        confirmation.used ||
        confirmation.bindingHash !== bindingHash ||
        confirmation.expiresAtMs <= this.#now()
      ) {
        fail(
          'LIVE_EVIDENCE_OWNER_CONFIRMATION_INVALID',
          'Owner confirmation is expired, replayed, or foreign.',
        );
      }
      confirmation.used = true;
      await this.#persistConsentRecord(Object.freeze(structuredClone(confirmation.consentRecord)));
      consent = await this.#loadExactConsent(binding);
      if (!consent || consent.consentHash !== confirmation.consentHash) {
        fail(
          'LIVE_EVIDENCE_CONSENT_INVALID',
          'Persisted consent does not match the confirmed grant.',
        );
      }
    }
    const { consentHash, expiresAtMs } = consent;
    const entropy = this.#entropy();
    if (!(entropy instanceof Uint8Array) || entropy.byteLength < 32) {
      fail('LIVE_EVIDENCE_CREDENTIAL_CONFIG_INVALID', 'Credential capability entropy is invalid.');
    }
    const capability = createOpaqueHandle<ConnectorCredentialCapabilityV2>('Credential capability');
    this.#capabilities.set(capability, {
      bindingHash,
      capabilityHash: bytesHash(entropy),
      consentHash,
      expiresAtMs: Math.min(expiresAtMs, this.#now() + this.#ttlMs),
      used: false,
    });
    return capability;
  }

  capabilityHash(capability: ConnectorCredentialCapabilityV2): `sha256:${string}` {
    const state = this.#capabilities.get(capability);
    if (!state) fail('LIVE_EVIDENCE_CAPABILITY_INVALID', 'Credential capability is invalid.');
    return state.capabilityHash;
  }

  /** Stable, non-authoritative protocol custody for restart-safe checkpoint identity. */
  async protocolBindingHash(
    binding: ConnectorCredentialProtocolBindingV2,
  ): Promise<`sha256:${string}`> {
    const consent = await this.#loadExactConsent(binding);
    if (!consent)
      fail('LIVE_EVIDENCE_CONSENT_INVALID', 'The trusted local consent is unavailable.');
    return sha256CanonicalJson({
      domain: 'openplanr-local-live-evidence-capability-binding-v2',
      authority: 'none',
      bindingHash: sha256CanonicalJson({
        actorId: binding.actorId,
        credentialRef: binding.credentialRef,
        consentRecordId: binding.consentRecordId,
        protocolDocketHash: binding.protocolDocketHash,
        provider: binding.provider,
        adapterVersion: binding.adapterVersion,
        accountIdentityHash: binding.accountIdentityHash,
      }),
      consentHash: consent.consentHash,
    });
  }

  async withResolvedCredential<T>(
    capability: ConnectorCredentialCapabilityV2,
    binding: ConnectorCredentialCapabilityBindingV2,
    use: (credential: Uint8Array) => Promise<T>,
  ): Promise<T> {
    const state = this.#capabilities.get(capability);
    if (!state || state.bindingHash !== capabilityBindingHash(binding)) {
      fail('LIVE_EVIDENCE_CAPABILITY_INVALID', 'Credential capability is invalid or foreign.');
    }
    if (state.used) {
      fail('LIVE_EVIDENCE_CAPABILITY_REPLAYED', 'Credential capability has already been consumed.');
    }
    if (state.expiresAtMs <= this.#now()) {
      fail('LIVE_EVIDENCE_CAPABILITY_EXPIRED', 'Credential capability has expired.');
    }
    const consent = await this.#loadExactConsent(binding);
    if (!consent)
      fail('LIVE_EVIDENCE_CONSENT_INVALID', 'The trusted local consent is unavailable.');
    const { consentHash } = consent;
    if (consentHash !== state.consentHash) {
      fail(
        'LIVE_EVIDENCE_CAPABILITY_INVALID',
        'Credential capability no longer matches trusted consent.',
      );
    }
    const local = this.#bindings.find((candidate) => matchesLocalBinding(candidate, binding));
    if (!local) {
      fail(
        'LIVE_EVIDENCE_CREDENTIAL_UNAVAILABLE',
        'No trusted local credential binding is available.',
      );
    }
    state.used = true;
    let resolved: string | Uint8Array | undefined;
    if (local.source.kind === 'environment-name') {
      resolved = this.#allowedEnvironmentNames.has(local.source.name)
        ? this.#readEnvironment(local.source.name)
        : undefined;
    } else {
      try {
        resolved = await this.#readKeychain(local.source.service, local.source.account);
      } catch (error) {
        const cause = credentialSourceError(error);
        if (cause.code === 'LIVE_EVIDENCE_KEYRING_UNAVAILABLE') {
          throw new ConnectorCredentialCustodyError(
            'LIVE_EVIDENCE_CREDENTIAL_CUSTODY_UNAVAILABLE',
            `OS credential-store support is unavailable for logical credential reference "${binding.credentialRef}".`,
            cause.code,
          );
        }
        throw new ConnectorCredentialCustodyError(
          'LIVE_EVIDENCE_CREDENTIAL_READ_FAILED',
          `OS credential-store access failed for logical credential reference "${binding.credentialRef}".`,
          cause.code,
        );
      }
    }
    if (!resolved || resolved.length === 0) {
      fail(
        'LIVE_EVIDENCE_CREDENTIAL_UNAVAILABLE',
        `The trusted local credential "${binding.credentialRef}" is absent from its configured source.`,
      );
    }
    const credential =
      typeof resolved === 'string'
        ? Buffer.from(resolved, 'utf8')
        : Buffer.from(resolved.buffer, resolved.byteOffset, resolved.byteLength);
    try {
      return await use(credential);
    } finally {
      credential.fill(0);
    }
  }
}

export function createConnectorCredentialCustodyV2(
  input: ConstructorParameters<typeof ConnectorCredentialCustodyV2>[0],
): ConnectorCredentialCustodyV2 {
  return new ConnectorCredentialCustodyV2(input);
}
