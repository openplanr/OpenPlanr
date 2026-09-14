import {
  DashboardValidationError,
  exactBoolean,
  exactRecord,
  exactString,
  parseExactJson,
  plainRecord,
} from './validation.js';

export const DASHBOARD_SAFE_ERROR_CODES = Object.freeze([
  'DASHBOARD_ERROR_UNAVAILABLE',
  'DASHBOARD_LOOPBACK_HOST_INVALID',
  'DASHBOARD_BOOTSTRAP_INVALID',
  'CAPABILITY_DENIED',
  'DASHBOARD_BUILD_MISMATCH',
  'DASHBOARD_RESPONSE_INVALID',
  'CONCURRENT_MODIFICATION',
  'OPERATION_UNCERTAIN',
  'DASHBOARD_ASSET_MISSING',
  'DASHBOARD_MANIFEST_INVALID',
  'DASHBOARD_MANIFEST_MISSING',
  'DASHBOARD_READ_FAILED',
  'DASHBOARD_STALE_RESPONSE',
  'OPERATION_CONFLICT',
] as const);
export type DashboardSafeErrorCode = (typeof DASHBOARD_SAFE_ERROR_CODES)[number];
const DASHBOARD_SAFE_ERROR_CODE_SET = new Set<string>(DASHBOARD_SAFE_ERROR_CODES);

export const DASHBOARD_SAFE_CONTEXT_FIELDS = Object.freeze([
  'operation',
  'cycleId',
  'assignmentId',
  'submissionId',
  'submissionState',
  'reviewId',
  'state',
  'maxBytes',
] as const);
const SAFE_CONTEXT_FIELDS = DASHBOARD_SAFE_CONTEXT_FIELDS;
const SAFE_CONTEXT_FIELD_SET = new Set<string>(SAFE_CONTEXT_FIELDS);
const PUBLIC_OPERATION = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*){1,7}$/u;
const PRIVATE_OPERATION_SEGMENTS = new Set(['private', 'secret']);
const PUBLIC_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PUBLIC_STATE = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+){0,7}$/u;
const MAX_SAFE_CONTEXT_TEXT_LENGTH = 160;
const MAX_SAFE_ERROR_BYTES = 16 * 1024 * 1024;

function exactPublicOperation(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > MAX_SAFE_CONTEXT_TEXT_LENGTH) {
    throw new DashboardValidationError(path, 'contains an overlong public operation');
  }
  const operation = exactString(value, path, PUBLIC_OPERATION);
  if (operation.split(/[.-]/u).some((segment) => PRIVATE_OPERATION_SEGMENTS.has(segment))) {
    throw new DashboardValidationError(path, 'contains a non-public operation segment');
  }
  return operation;
}

function exactPublicState(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > MAX_SAFE_CONTEXT_TEXT_LENGTH) {
    throw new DashboardValidationError(path, 'contains an overlong public state');
  }
  return exactString(value, path, PUBLIC_STATE);
}

export type DashboardSafeErrorContext = Readonly<
  Partial<{
    operation: string;
    cycleId: string;
    assignmentId: string;
    submissionId: string;
    submissionState: string;
    reviewId: string;
    state: string;
    maxBytes: number;
  }>
>;

export type DashboardSafeError = Readonly<{
  code: DashboardSafeErrorCode;
  retryable: boolean;
  context: DashboardSafeErrorContext;
}>;

export const DASHBOARD_SAFE_ERROR_FALLBACK: DashboardSafeError = Object.freeze({
  code: 'DASHBOARD_ERROR_UNAVAILABLE',
  retryable: false,
  context: Object.freeze({}),
});

function safeContext(value: unknown): DashboardSafeErrorContext {
  const record = plainRecord(value, '$.context');
  const keys = Object.keys(record);
  if (keys.length > SAFE_CONTEXT_FIELDS.length) {
    throw new DashboardValidationError('$.context', 'contains too many fields');
  }
  if (keys.some((key) => !SAFE_CONTEXT_FIELD_SET.has(key))) {
    throw new DashboardValidationError('$.context', 'contains a non-public field');
  }
  const context: Record<string, string | number> = {};
  for (const key of SAFE_CONTEXT_FIELDS) {
    if (!Object.hasOwn(record, key)) continue;
    const field = record[key];
    if (key === 'maxBytes') {
      if (
        !Number.isSafeInteger(field) ||
        (field as number) < 0 ||
        (field as number) > MAX_SAFE_ERROR_BYTES
      ) {
        throw new DashboardValidationError('$.context.maxBytes', 'expected a bounded byte count');
      }
      context[key] = field as number;
    } else {
      const path = `$.context.${key}`;
      if (key === 'operation') context[key] = exactPublicOperation(field, path);
      else if (key.endsWith('State') || key === 'state') {
        context[key] = exactPublicState(field, path);
      } else context[key] = exactString(field, path, PUBLIC_ID);
    }
  }
  return Object.freeze(context) as DashboardSafeErrorContext;
}

/** Accept only the new closed wire shape. Messages and arbitrary details never enter the client. */
export function parseDashboardSafeError(value: unknown): DashboardSafeError {
  const record = exactRecord(value, ['code', 'retryable', 'context'], '$');
  if (typeof record.code !== 'string' || !DASHBOARD_SAFE_ERROR_CODE_SET.has(record.code)) {
    throw new DashboardValidationError('$.code', 'contains an unsupported public error code');
  }
  return Object.freeze({
    code: record.code as DashboardSafeErrorCode,
    retryable: exactBoolean(record.retryable, '$.retryable'),
    context: safeContext(record.context),
  });
}

/**
 * Non-echoing boundary used for untrusted or compatibility-pinned responses.
 * Retryability is retained as information only; it never authorizes an automatic retry.
 */
export function mapDashboardSafeError(value: unknown): DashboardSafeError {
  try {
    return parseDashboardSafeError(value);
  } catch {
    return DASHBOARD_SAFE_ERROR_FALLBACK;
  }
}

export function parseDashboardSafeErrorJson(text: string): DashboardSafeError {
  return parseDashboardSafeError(parseExactJson(text));
}

export type DashboardErrorRecoveryPolicy = Readonly<{
  blindRetry: false;
  requiresReconciliation: true;
  retryableAfterReconciliation: boolean;
}>;

export function dashboardErrorRecoveryPolicy(
  error: DashboardSafeError,
): DashboardErrorRecoveryPolicy {
  return Object.freeze({
    blindRetry: false,
    requiresReconciliation: true,
    retryableAfterReconciliation: error.retryable,
  });
}
