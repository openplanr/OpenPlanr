export type LandingOperationRegistryErrorCode =
  | 'E_LANDING_OPERATION_REGISTRY_INVALID'
  | 'E_LANDING_OPERATION_ADAPTER_MISSING'
  | 'E_LANDING_OPERATION_ADAPTER_MISMATCH'
  | 'E_LANDING_OPERATION_TARGET_MISMATCH'
  | 'E_LANDING_OPERATION_OUTPUT_UNSAFE'
  | 'E_LANDING_OPERATION_TIMEOUT'
  | 'E_LANDING_OPERATION_FAILED';

export class LandingOperationRegistryError extends Error {
  readonly code: LandingOperationRegistryErrorCode;

  constructor(code: LandingOperationRegistryErrorCode, message: string) {
    super(message);
    this.name = 'LandingOperationRegistryError';
    this.code = code;
  }
}

export type LandingOperationRegistrationV1 = Readonly<{
  operationId: string;
  operationVersion: string;
  kind: string;
  effectClass: string;
  recoveryClass: string;
  runtimeAdapterRequired: true;
  portableAuthority: 'none';
  registrationHash: `sha256:${string}`;
}>;

export type LandingOperationInspectionV1 = Readonly<{
  targetStateHash: `sha256:${string}`;
}>;

export type LandingOperationDispatchResultV1 = Readonly<{
  status: 'succeeded' | 'failed' | 'blocked' | 'uncertain' | 'recovery_required';
  targetAfterHash: `sha256:${string}` | null;
  completedAt: string;
  evidenceRecords: readonly Readonly<Record<string, unknown>>[];
  evidenceContexts: Readonly<Record<string, unknown>>;
  canary: Readonly<Record<string, unknown>> | null;
  containment: Readonly<Record<string, unknown>> | null;
  recovery: Readonly<Record<string, unknown>> | null;
}>;

export type LandingOperationReconciliationV1 =
  | LandingOperationDispatchResultV1
  | Readonly<{
      disposition: 'not-started' | 'unknown';
      targetAfterHash: null;
      completedAt: string;
    }>;

export interface LandingOperationAdapterV1 {
  readonly adapterId: string;
  readonly operationId: string;
  readonly operationVersion: string;
  readonly registrationHash: `sha256:${string}`;
  inspectTarget(request: Readonly<Record<string, unknown>>): Promise<LandingOperationInspectionV1>;
  dispatch(request: Readonly<Record<string, unknown>>): Promise<LandingOperationDispatchResultV1>;
  reconcile(request: Readonly<Record<string, unknown>>): Promise<LandingOperationReconciliationV1>;
}

const HASH = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[a-z][a-z0-9-]{0,63}$/u;
const PRIVATE_VALUE =
  /(?:^|[\s"'`(])\/(?:Users|home|private|var|etc|tmp)\/|(?:^|[\s"'`(])[A-Za-z]:[\\/][^\s]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[-_ ]?key|access[-_ ]?token|client[-_ ]?secret|password|passwd|secret|token)\s*[:=]\s*[^\s]+/iu;
const SENSITIVE_KEY =
  /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|credential|private[-_]?key)/iu;

function fail(code: LandingOperationRegistryErrorCode, message: string): never {
  throw new LandingOperationRegistryError(code, message);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('E_LANDING_OPERATION_REGISTRY_INVALID', 'Landing operation registry is invalid.');
  }
  return value as Readonly<Record<string, unknown>>;
}

function portable(value: unknown, key = '', seen = new Set<object>()): void {
  if (SENSITIVE_KEY.test(key)) {
    fail('E_LANDING_OPERATION_OUTPUT_UNSAFE', 'Landing adapter output is not portable.');
  }
  if (typeof value === 'string') {
    if (PRIVATE_VALUE.test(value)) {
      fail('E_LANDING_OPERATION_OUTPUT_UNSAFE', 'Landing adapter output is not portable.');
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) {
    fail('E_LANDING_OPERATION_OUTPUT_UNSAFE', 'Landing adapter output contains a cycle.');
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (const nested of value) portable(nested, key, seen);
    } else {
      for (const [nestedKey, nested] of Object.entries(value)) portable(nested, nestedKey, seen);
    }
  } finally {
    seen.delete(value);
  }
}

function inspection(value: unknown): LandingOperationInspectionV1 {
  const input = record(value);
  if (
    Object.keys(input).length !== 1 ||
    typeof input.targetStateHash !== 'string' ||
    !HASH.test(input.targetStateHash)
  ) {
    fail('E_LANDING_OPERATION_TARGET_MISMATCH', 'Landing target inspection is invalid.');
  }
  return Object.freeze({ targetStateHash: input.targetStateHash as `sha256:${string}` });
}

function dispatchResult(value: unknown): LandingOperationDispatchResultV1 {
  const input = record(value);
  const expected = [
    'canary',
    'completedAt',
    'containment',
    'evidenceContexts',
    'evidenceRecords',
    'recovery',
    'status',
    'targetAfterHash',
  ];
  if (
    JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(expected) ||
    !['succeeded', 'failed', 'blocked', 'uncertain', 'recovery_required'].includes(
      String(input.status),
    ) ||
    (input.targetAfterHash !== null &&
      (typeof input.targetAfterHash !== 'string' || !HASH.test(input.targetAfterHash))) ||
    typeof input.completedAt !== 'string' ||
    !Number.isFinite(Date.parse(input.completedAt)) ||
    !Array.isArray(input.evidenceRecords) ||
    !input.evidenceContexts ||
    typeof input.evidenceContexts !== 'object' ||
    Array.isArray(input.evidenceContexts)
  ) {
    fail('E_LANDING_OPERATION_FAILED', 'Landing adapter result is invalid.');
  }
  portable(input);
  return structuredClone(input) as LandingOperationDispatchResultV1;
}

function reconciliation(value: unknown): LandingOperationReconciliationV1 {
  const input = record(value);
  if ('disposition' in input) {
    if (
      !['not-started', 'unknown'].includes(String(input.disposition)) ||
      input.targetAfterHash !== null ||
      typeof input.completedAt !== 'string' ||
      !Number.isFinite(Date.parse(input.completedAt)) ||
      JSON.stringify(Object.keys(input).sort()) !==
        JSON.stringify(['completedAt', 'disposition', 'targetAfterHash'])
    ) {
      fail('E_LANDING_OPERATION_FAILED', 'Landing reconciliation is invalid.');
    }
    return Object.freeze(structuredClone(input)) as LandingOperationReconciliationV1;
  }
  return dispatchResult(input);
}

export class LandingOperationRegistryV1 {
  readonly #registrations: ReadonlyMap<string, LandingOperationRegistrationV1>;
  readonly #adapters: ReadonlyMap<string, LandingOperationAdapterV1>;

  constructor(input: {
    operationRegistry: Readonly<Record<string, unknown>>;
    adapters?: readonly LandingOperationAdapterV1[];
  }) {
    const source = record(input.operationRegistry);
    if (!Array.isArray(source.operations)) {
      fail('E_LANDING_OPERATION_REGISTRY_INVALID', 'Landing operation membership is invalid.');
    }
    const registrations = new Map<string, LandingOperationRegistrationV1>();
    for (const value of source.operations) {
      const row = record(value) as LandingOperationRegistrationV1;
      if (
        !ID.test(row.operationId) ||
        row.operationVersion !== '1.0.0' ||
        row.runtimeAdapterRequired !== true ||
        row.portableAuthority !== 'none' ||
        !HASH.test(row.registrationHash) ||
        registrations.has(row.operationId)
      ) {
        fail('E_LANDING_OPERATION_REGISTRY_INVALID', 'Landing operation row is invalid.');
      }
      registrations.set(row.operationId, Object.freeze(structuredClone(row)));
    }
    const adapters = new Map<string, LandingOperationAdapterV1>();
    for (const adapter of input.adapters ?? []) {
      const registration = registrations.get(adapter.operationId);
      if (
        !registration ||
        !ID.test(adapter.adapterId) ||
        adapter.operationVersion !== registration.operationVersion ||
        adapter.registrationHash !== registration.registrationHash ||
        adapters.has(adapter.operationId)
      ) {
        fail('E_LANDING_OPERATION_ADAPTER_MISMATCH', 'Landing adapter is not registry-bound.');
      }
      adapters.set(adapter.operationId, adapter);
    }
    this.#registrations = registrations;
    this.#adapters = adapters;
  }

  list(): readonly LandingOperationRegistrationV1[] {
    return Object.freeze([...this.#registrations.values()].map((value) => structuredClone(value)));
  }

  registration(operationId: string): LandingOperationRegistrationV1 {
    const value = this.#registrations.get(operationId);
    if (!value) fail('E_LANDING_OPERATION_REGISTRY_INVALID', 'Landing operation is unknown.');
    return Object.freeze(structuredClone(value));
  }

  adapter(operationId: string): LandingOperationAdapterV1 {
    const value = this.#adapters.get(operationId);
    if (!value) {
      fail(
        'E_LANDING_OPERATION_ADAPTER_MISSING',
        'No trusted local landing adapter is configured.',
      );
    }
    return value;
  }

  async inspect(
    operationId: string,
    request: Readonly<Record<string, unknown>>,
  ): Promise<LandingOperationInspectionV1> {
    return inspection(await this.adapter(operationId).inspectTarget(request));
  }

  async dispatch(
    operationId: string,
    request: Readonly<Record<string, unknown>>,
  ): Promise<LandingOperationDispatchResultV1> {
    return dispatchResult(await this.adapter(operationId).dispatch(request));
  }

  async reconcile(
    operationId: string,
    request: Readonly<Record<string, unknown>>,
  ): Promise<LandingOperationReconciliationV1> {
    return reconciliation(await this.adapter(operationId).reconcile(request));
  }
}
