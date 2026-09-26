/** Response writers and the closed safe-error wire contract shared by the dashboard routes. */

import { types as utilTypes } from 'node:util';

export const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

export const planningJson = (res, code, body) => {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
};

export const experienceJson = (res, code, body) => {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
};

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
]);
const DASHBOARD_SAFE_ERROR_CODE_SET = new Set(DASHBOARD_SAFE_ERROR_CODES);
export const DASHBOARD_SAFE_CONTEXT_FIELDS = Object.freeze([
  'operation',
  'cycleId',
  'assignmentId',
  'submissionId',
  'submissionState',
  'reviewId',
  'state',
  'maxBytes',
]);
const DASHBOARD_SAFE_CONTEXT_FIELD_SET = new Set(DASHBOARD_SAFE_CONTEXT_FIELDS);
const DASHBOARD_SAFE_OPERATION =
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*){1,7}$/u;
const DASHBOARD_PRIVATE_OPERATION_SEGMENTS = new Set(['private', 'secret']);
const DASHBOARD_SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DASHBOARD_SAFE_STATE = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+){0,7}$/u;
const DASHBOARD_SAFE_CONTEXT_TEXT_LENGTH = 160;
const DASHBOARD_SAFE_MAX_BYTES = 16 * 1024 * 1024;

function dashboardSafeOperation(value) {
  return (
    typeof value === 'string' &&
    value.length <= DASHBOARD_SAFE_CONTEXT_TEXT_LENGTH &&
    DASHBOARD_SAFE_OPERATION.test(value) &&
    !value.split(/[.-]/u).some((segment) => DASHBOARD_PRIVATE_OPERATION_SEGMENTS.has(segment))
  );
}
const DASHBOARD_SAFE_ERROR_FALLBACK = Object.freeze({
  code: 'DASHBOARD_ERROR_UNAVAILABLE',
  retryable: false,
  context: Object.freeze({}),
});

export function safeDashboardErrorRecord(value, allowInternalError = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return null;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (
      prototype !== Object.prototype &&
      prototype !== null &&
      !(allowInternalError && value instanceof Error)
    ) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).some(
        (key) =>
          typeof key !== 'string' ||
          descriptors[key]?.get !== undefined ||
          descriptors[key]?.set !== undefined,
      )
    )
      return null;
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
    );
  } catch {
    return null;
  }
}

function dashboardSafeErrorContext(value) {
  if (value === undefined || value === null) return Object.freeze({});
  const source = safeDashboardErrorRecord(value);
  if (!source) return null;
  const context = {};
  for (const key of DASHBOARD_SAFE_CONTEXT_FIELDS) {
    if (!Object.hasOwn(source, key)) continue;
    const candidate = source[key];
    if (key === 'maxBytes') {
      if (!Number.isSafeInteger(candidate) || candidate < 0 || candidate > DASHBOARD_SAFE_MAX_BYTES)
        return null;
      context[key] = candidate;
    } else {
      const valid =
        key === 'operation'
          ? dashboardSafeOperation(candidate)
          : typeof candidate === 'string' &&
            candidate.length <= DASHBOARD_SAFE_CONTEXT_TEXT_LENGTH &&
            (key.endsWith('State') || key === 'state'
              ? DASHBOARD_SAFE_STATE
              : DASHBOARD_SAFE_ID
            ).test(candidate);
      if (!valid) return null;
      context[key] = candidate;
    }
  }
  return Object.freeze(context);
}

/**
 * Map an arbitrary internal failure to the closed dashboard wire contract.
 * Messages, stacks, paths, nested bodies, and non-allowlisted context are never echoed.
 */
export function mapDashboardSafeError(error) {
  const source = safeDashboardErrorRecord(error, true);
  if (!source || typeof source.code !== 'string' || !DASHBOARD_SAFE_ERROR_CODE_SET.has(source.code))
    return DASHBOARD_SAFE_ERROR_FALLBACK;
  const context = dashboardSafeErrorContext(source.context);
  if (!context) return DASHBOARD_SAFE_ERROR_FALLBACK;
  return Object.freeze({
    code: source.code,
    retryable: typeof source.retryable === 'boolean' ? source.retryable : false,
    context,
  });
}

/** Validate exact server/client parity for the public safe-error output. */
export function assertDashboardSafeError(value) {
  const source = safeDashboardErrorRecord(value);
  if (
    !source ||
    Object.keys(source).sort().join(',') !== 'code,context,retryable' ||
    typeof source.code !== 'string' ||
    !DASHBOARD_SAFE_ERROR_CODE_SET.has(source.code) ||
    typeof source.retryable !== 'boolean'
  ) {
    throw new TypeError('Invalid dashboard safe error.');
  }
  const context = safeDashboardErrorRecord(source.context);
  if (!context || Object.keys(context).some((key) => !DASHBOARD_SAFE_CONTEXT_FIELD_SET.has(key))) {
    throw new TypeError('Invalid dashboard safe error.');
  }
  for (const [key, candidate] of Object.entries(context)) {
    if (key === 'maxBytes') {
      if (
        !Number.isSafeInteger(candidate) ||
        candidate < 0 ||
        candidate > DASHBOARD_SAFE_MAX_BYTES
      ) {
        throw new TypeError('Invalid dashboard safe error.');
      }
    } else {
      const valid =
        key === 'operation'
          ? dashboardSafeOperation(candidate)
          : typeof candidate === 'string' &&
            candidate.length <= DASHBOARD_SAFE_CONTEXT_TEXT_LENGTH &&
            (key.endsWith('State') || key === 'state'
              ? DASHBOARD_SAFE_STATE
              : DASHBOARD_SAFE_ID
            ).test(candidate);
      if (!valid) {
        throw new TypeError('Invalid dashboard safe error.');
      }
    }
  }
  const canonicalContext = dashboardSafeErrorContext(context);
  if (!canonicalContext) throw new TypeError('Invalid dashboard safe error.');
  return Object.freeze({
    code: source.code,
    retryable: source.retryable,
    context: canonicalContext,
  });
}

export const dashboardSafeErrorJson = (res, status, error) =>
  experienceJson(res, status, {
    error: assertDashboardSafeError(mapDashboardSafeError(error)),
  });

export function commandError(res, error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 409;
  const code =
    typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]*$/u.test(error.code)
      ? error.code
      : 'OPERATE_COMMAND_REFUSED';
  return experienceJson(res, status, {
    ok: false,
    error: {
      reasonCode: code,
      message: 'The governed local command was refused without effect.',
      retryable: false,
    },
  });
}

export function sseFrame(event, payload, id = null) {
  return `${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function planningBindingError(res) {
  return dashboardSafeErrorJson(res, 403, {
    code: 'CAPABILITY_DENIED',
    retryable: false,
    context: {},
  });
}

export function planningResponseError(res, status = 409) {
  return dashboardSafeErrorJson(res, status, {
    code: 'DASHBOARD_RESPONSE_INVALID',
    retryable: false,
    context: {},
  });
}
