import type { DashboardQueryIdentity } from '../binding/query-identity.js';
import {
  createDashboardQueryIdentity,
  isCurrentDashboardQuery,
} from '../binding/query-identity.js';
import {
  type DashboardSafeError,
  type DashboardSafeErrorCode,
  parseDashboardSafeError,
} from './safe-errors.js';
import {
  DashboardValidationError,
  exactBoolean,
  exactRecord,
  exactString,
  parseExactJson,
} from './validation.js';

export const DASHBOARD_PRODUCT_STATE_KINDS = Object.freeze([
  'booting',
  'loading',
  'first-use',
  'ready',
  'empty',
  'read-only',
  'refreshing',
  'stale',
  'degraded',
  'blocked',
  'unavailable',
  'unauthorized',
  'offline',
  'incompatible',
  'corrupt',
  'conflict',
  'partial',
  'uncertain',
  'recovering',
] as const);

export type DashboardProductStateKind = (typeof DASHBOARD_PRODUCT_STATE_KINDS)[number];
export type DashboardProductRecovery =
  | 'wait'
  | 'none'
  | 'server-action-only'
  | 'inspect'
  | 'reconcile'
  | 'request-access'
  | 'restore-connection'
  | 'reinstall'
  | 'canonical-recovery-only';

export type DashboardProductStatePolicy = Readonly<{
  state: DashboardProductStateKind;
  mutation: 'disabled' | 'server-validated';
  focus: 'route-heading' | 'state-heading' | 'recovery-heading';
  recovery: DashboardProductRecovery;
  blindRetry: false;
}>;

const POLICY: Readonly<Record<DashboardProductStateKind, DashboardProductStatePolicy>> =
  Object.freeze({
    booting: policy('booting', 'disabled', 'route-heading', 'wait'),
    loading: policy('loading', 'disabled', 'route-heading', 'wait'),
    'first-use': policy('first-use', 'disabled', 'state-heading', 'server-action-only'),
    ready: policy('ready', 'server-validated', 'route-heading', 'none'),
    empty: policy('empty', 'disabled', 'state-heading', 'server-action-only'),
    'read-only': policy('read-only', 'disabled', 'route-heading', 'inspect'),
    refreshing: policy('refreshing', 'disabled', 'route-heading', 'wait'),
    stale: policy('stale', 'disabled', 'state-heading', 'reconcile'),
    degraded: policy('degraded', 'disabled', 'state-heading', 'inspect'),
    blocked: policy('blocked', 'disabled', 'state-heading', 'canonical-recovery-only'),
    unavailable: policy('unavailable', 'disabled', 'state-heading', 'inspect'),
    unauthorized: policy('unauthorized', 'disabled', 'state-heading', 'request-access'),
    offline: policy('offline', 'disabled', 'state-heading', 'restore-connection'),
    incompatible: policy('incompatible', 'disabled', 'recovery-heading', 'reinstall'),
    corrupt: policy('corrupt', 'disabled', 'recovery-heading', 'canonical-recovery-only'),
    conflict: policy('conflict', 'disabled', 'recovery-heading', 'reconcile'),
    partial: policy('partial', 'disabled', 'recovery-heading', 'reconcile'),
    uncertain: policy('uncertain', 'disabled', 'recovery-heading', 'canonical-recovery-only'),
    recovering: policy('recovering', 'disabled', 'recovery-heading', 'wait'),
  });

function policy(
  state: DashboardProductStateKind,
  mutation: DashboardProductStatePolicy['mutation'],
  focus: DashboardProductStatePolicy['focus'],
  recovery: DashboardProductRecovery,
): DashboardProductStatePolicy {
  return Object.freeze({ state, mutation, focus, recovery, blindRetry: false });
}

export type DashboardProductState<T> = Readonly<{
  kind: DashboardProductStateKind;
  binding: DashboardQueryIdentity | null;
  data: T | null;
  reasonCodes: readonly string[];
  error: DashboardSafeError | null;
  mutationEnabled: boolean;
  policy: DashboardProductStatePolicy;
}>;

export type DashboardProductStateOptions<T> = Readonly<{
  currentBinding?: DashboardQueryIdentity | null;
  validateData?: (value: unknown) => value is T;
}>;

const REASON_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const DATA_REQUIRED = new Set<DashboardProductStateKind>([
  'ready',
  'read-only',
  'refreshing',
  'stale',
  'degraded',
  'blocked',
  'partial',
  'uncertain',
  'recovering',
]);
const BINDING_OPTIONAL = new Set<DashboardProductStateKind>([
  'booting',
  'unauthorized',
  'offline',
  'incompatible',
  'corrupt',
]);
const ERROR_REQUIRED = new Set<DashboardProductStateKind>([
  'unauthorized',
  'incompatible',
  'corrupt',
  'conflict',
  'uncertain',
]);
const NO_REASON_ALLOWED = new Set<DashboardProductStateKind>(['booting', 'loading', 'ready']);
const errorCodes = (...codes: DashboardSafeErrorCode[]): ReadonlySet<DashboardSafeErrorCode> =>
  new Set(codes);
const ERROR_CODES_BY_KIND: Readonly<
  Record<DashboardProductStateKind, ReadonlySet<DashboardSafeErrorCode>>
> = Object.freeze({
  booting: errorCodes(),
  loading: errorCodes(),
  'first-use': errorCodes(),
  ready: errorCodes(),
  empty: errorCodes(),
  'read-only': errorCodes(),
  refreshing: errorCodes(),
  stale: errorCodes('DASHBOARD_STALE_RESPONSE', 'DASHBOARD_READ_FAILED'),
  degraded: errorCodes('DASHBOARD_ERROR_UNAVAILABLE', 'DASHBOARD_READ_FAILED'),
  blocked: errorCodes(),
  unavailable: errorCodes('DASHBOARD_ERROR_UNAVAILABLE', 'DASHBOARD_READ_FAILED'),
  unauthorized: errorCodes('CAPABILITY_DENIED'),
  offline: errorCodes('DASHBOARD_ERROR_UNAVAILABLE', 'DASHBOARD_READ_FAILED'),
  incompatible: errorCodes(
    'DASHBOARD_BUILD_MISMATCH',
    'DASHBOARD_ASSET_MISSING',
    'DASHBOARD_MANIFEST_MISSING',
  ),
  corrupt: errorCodes(
    'DASHBOARD_RESPONSE_INVALID',
    'DASHBOARD_MANIFEST_INVALID',
    'DASHBOARD_BOOTSTRAP_INVALID',
  ),
  conflict: errorCodes('CONCURRENT_MODIFICATION', 'OPERATION_CONFLICT'),
  partial: errorCodes('DASHBOARD_READ_FAILED'),
  uncertain: errorCodes('OPERATION_UNCERTAIN'),
  recovering: errorCodes(),
});
const PRESENTATION_REASON_CODES = new Set(
  DASHBOARD_PRODUCT_STATE_KINDS.map((kind) => productStateReason(kind)),
);
const VALIDATED_PRODUCT_STATES = new WeakSet<object>();

function productStateReason(kind: DashboardProductStateKind): string {
  return `DASHBOARD_${kind.toUpperCase().replace('-', '_')}`;
}

function stateKind(value: unknown): DashboardProductStateKind {
  if (
    typeof value !== 'string' ||
    !DASHBOARD_PRODUCT_STATE_KINDS.includes(value as DashboardProductStateKind)
  ) {
    throw new DashboardValidationError('$.kind', 'contains an unsupported product state');
  }
  return value as DashboardProductStateKind;
}

function reasonCodes(value: unknown, kind: DashboardProductStateKind): readonly string[] {
  if (!Array.isArray(value) || value.length > 16) {
    throw new DashboardValidationError('$.reasonCodes', 'expected a bounded reason array');
  }
  const parsed = value.map((reason, index) =>
    exactString(reason, `$.reasonCodes[${index}]`, REASON_CODE),
  );
  if (new Set(parsed).size !== parsed.length) {
    throw new DashboardValidationError('$.reasonCodes', 'contains duplicate reasons');
  }
  if (NO_REASON_ALLOWED.has(kind) && parsed.length !== 0) {
    throw new DashboardValidationError('$.reasonCodes', 'is not valid for this product state');
  }
  if (!NO_REASON_ALLOWED.has(kind) && parsed.length === 0) {
    throw new DashboardValidationError('$.reasonCodes', 'requires a certified reason');
  }
  if (!NO_REASON_ALLOWED.has(kind) && parsed[0] !== productStateReason(kind)) {
    throw new DashboardValidationError(
      '$.reasonCodes',
      'does not begin with the tagged presentation-state reason',
    );
  }
  if (parsed.slice(1).some((reason) => PRESENTATION_REASON_CODES.has(reason))) {
    throw new DashboardValidationError(
      '$.reasonCodes',
      'contains a secondary presentation-state substitution',
    );
  }
  return Object.freeze(parsed);
}

function exactPolicy(value: unknown, kind: DashboardProductStateKind): DashboardProductStatePolicy {
  const candidate = exactRecord(
    value,
    ['state', 'mutation', 'focus', 'recovery', 'blindRetry'],
    '$.policy',
  );
  const expected = POLICY[kind];
  if (
    candidate.state !== expected.state ||
    candidate.mutation !== expected.mutation ||
    candidate.focus !== expected.focus ||
    candidate.recovery !== expected.recovery ||
    candidate.blindRetry !== false
  ) {
    throw new DashboardValidationError('$.policy', 'does not match the tagged product state');
  }
  return expected;
}

/** Deep-clone and freeze wire payloads before owner-boundary validators run. */
export function freezeDashboardWire<T>(value: T): T {
  let clone: T;
  try {
    clone = structuredClone(value);
  } catch {
    throw new DashboardValidationError('$.data', 'cannot be cloned safely');
  }
  const seen = new WeakSet<object>();
  const freeze = (entry: unknown): void => {
    if (entry === null || typeof entry !== 'object' || seen.has(entry)) return;
    seen.add(entry);
    for (const nested of Object.values(entry)) freeze(nested);
    Object.freeze(entry);
  };
  freeze(clone);
  return clone;
}

function stateError(
  value: unknown,
  kind: DashboardProductStateKind,
  binding: DashboardQueryIdentity | null,
): DashboardSafeError | null {
  if (value === null) {
    if (ERROR_REQUIRED.has(kind)) {
      throw new DashboardValidationError('$.error', 'is required for this product state');
    }
    return null;
  }
  const allowedCodes = ERROR_CODES_BY_KIND[kind];
  if (allowedCodes.size === 0) {
    throw new DashboardValidationError('$.error', 'is not valid for this product state');
  }
  const error = parseDashboardSafeError(value);
  if (!allowedCodes.has(error.code)) {
    throw new DashboardValidationError('$.error.code', 'does not match the tagged product state');
  }
  if (binding === null && Object.keys(error.context).length !== 0) {
    throw new DashboardValidationError(
      '$.error.context',
      'must not disclose owner-bound identifiers in this product state',
    );
  }
  if (
    error.context.cycleId !== undefined &&
    (binding?.cycleId === null ||
      binding?.cycleId === undefined ||
      error.context.cycleId !== binding.cycleId)
  ) {
    throw new DashboardValidationError('$.error.context.cycleId', 'does not match exact custody');
  }
  for (const field of ['assignmentId', 'submissionId', 'reviewId'] as const) {
    if (
      error.context[field] !== undefined &&
      (binding?.subjectId === null ||
        binding?.subjectId === undefined ||
        error.context[field] !== binding.subjectId)
    ) {
      throw new DashboardValidationError(
        `$.error.context.${field}`,
        'does not match exact custody',
      );
    }
  }
  return error;
}

function normalizeCurrentBinding(
  value: DashboardQueryIdentity | null | undefined,
): DashboardQueryIdentity | null | undefined {
  if (value === undefined || value === null) return value;
  try {
    return createDashboardQueryIdentity(value);
  } catch {
    throw new DashboardValidationError(
      '$.currentBinding',
      'does not satisfy the exact current-binding contract',
    );
  }
}

/** Validate the complete tagged presentation model without deriving canonical lifecycle truth. */
export function parseDashboardProductState<T>(
  value: unknown,
  options: DashboardProductStateOptions<T> = {},
): DashboardProductState<T> {
  const record = exactRecord(
    value,
    ['kind', 'binding', 'data', 'reasonCodes', 'error', 'mutationEnabled', 'policy'],
    '$',
  );
  const kind = stateKind(record.kind);
  const parsedPolicy = exactPolicy(record.policy, kind);
  const mutationEnabled = exactBoolean(record.mutationEnabled, '$.mutationEnabled');
  if (kind !== 'ready' && mutationEnabled) {
    throw new DashboardValidationError('$.mutationEnabled', 'is default-denied for this state');
  }
  const binding = record.binding === null ? null : createDashboardQueryIdentity(record.binding);
  const currentBinding = normalizeCurrentBinding(options.currentBinding);
  if (!BINDING_OPTIONAL.has(kind) && binding === null) {
    throw new DashboardValidationError('$.binding', 'is required for this product state');
  }
  if (['booting', 'unauthorized', 'incompatible', 'corrupt'].includes(kind) && binding !== null) {
    throw new DashboardValidationError(
      '$.binding',
      'must not disclose a bound subject in this state',
    );
  }
  if (binding) {
    if (!currentBinding || !isCurrentDashboardQuery(binding, currentBinding)) {
      throw new DashboardValidationError(
        '$.binding',
        'requires an explicitly supplied non-null exact current binding',
      );
    }
  }

  let data: T | null = null;
  if (record.data !== null) {
    if (!options.validateData) {
      throw new DashboardValidationError('$.data', 'requires an owner-boundary validator');
    }
    const cloned = freezeDashboardWire(record.data);
    try {
      if (!options.validateData(cloned)) {
        throw new DashboardValidationError('$.data', 'failed its owner-boundary contract');
      }
    } catch (error) {
      if (error instanceof DashboardValidationError) throw error;
      throw new DashboardValidationError('$.data', 'failed its owner-boundary contract');
    }
    data = cloned;
  }
  if (DATA_REQUIRED.has(kind) && data === null) {
    throw new DashboardValidationError('$.data', 'is required for this product state');
  }
  if (!DATA_REQUIRED.has(kind) && kind !== 'offline' && data !== null) {
    throw new DashboardValidationError('$.data', 'is forbidden for this state');
  }
  if (kind === 'offline' && (binding === null) !== (data === null)) {
    throw new DashboardValidationError('$.data', 'offline cache requires its exact binding');
  }
  if (mutationEnabled) {
    if (
      kind !== 'ready' ||
      !binding ||
      currentBinding === undefined ||
      currentBinding === null ||
      !isCurrentDashboardQuery(binding, currentBinding)
    ) {
      throw new DashboardValidationError(
        '$.mutationEnabled',
        'requires current validated ready data and exact custody',
      );
    }
  }

  const parsedState = Object.freeze({
    kind,
    binding,
    data,
    reasonCodes: reasonCodes(record.reasonCodes, kind),
    error: stateError(record.error, kind, binding),
    mutationEnabled,
    policy: parsedPolicy,
  });
  VALIDATED_PRODUCT_STATES.add(parsedState);
  return parsedState;
}

export function parseDashboardProductStateJson<T>(
  text: string,
  options: DashboardProductStateOptions<T> = {},
): DashboardProductState<T> {
  return parseDashboardProductState(parseExactJson(text), options);
}

/** Mutation is never enabled from a tag alone; exact current ready custody is rechecked at use. */
export function productStateAllowsMutation<T>(
  state: DashboardProductState<T>,
  currentBinding: DashboardQueryIdentity | null,
): boolean {
  if (!VALIDATED_PRODUCT_STATES.has(state)) return false;
  try {
    const normalizedCurrent = normalizeCurrentBinding(currentBinding);
    return (
      state.kind === 'ready' &&
      state.mutationEnabled &&
      state.data !== null &&
      state.binding !== null &&
      normalizedCurrent !== null &&
      normalizedCurrent !== undefined &&
      isCurrentDashboardQuery(state.binding, normalizedCurrent)
    );
  } catch {
    return false;
  }
}

/** Distinguish parser-issued presentation state from structural look-alikes without reading it. */
export function isValidatedDashboardProductState<T>(
  value: unknown,
): value is DashboardProductState<T> {
  return typeof value === 'object' && value !== null && VALIDATED_PRODUCT_STATES.has(value);
}

export function dashboardProductStatePolicy(
  kind: DashboardProductStateKind,
): DashboardProductStatePolicy {
  return POLICY[kind];
}
