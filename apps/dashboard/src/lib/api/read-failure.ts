import { parseDashboardSafeError } from './safe-errors.js';
import { DashboardValidationError, exactRecord, parseExactJson } from './validation.js';

const originReasons = new Map([
  ['OPERATE_COMMAND_INVALID', 'The origin request is invalid.'],
  ['OPERATE_ORIGIN_INVALID', 'The local server refused the request origin.'],
  ['OPERATE_BINDING_REQUIRED', 'Reconnect to the project to verify the binding.'],
  ['OPERATE_READ_ONLY', 'The operating trace gateway is unavailable.'],
]);

export class DashboardReadFailure extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export function httpReadFailure(
  status: number,
  text: string,
  originTrace = false,
): DashboardReadFailure {
  const transient = status === 408 || status === 429 || status >= 500;
  try {
    const value = parseExactJson(text);
    if (originTrace) {
      const envelope = exactRecord(value, ['ok', 'error'], '$');
      const error = exactRecord(envelope.error, ['reasonCode', 'message', 'retryable'], '$.error');
      const reason = typeof error.reasonCode === 'string' && originReasons.get(error.reasonCode);
      if (envelope.ok === false && reason && typeof error.retryable === 'boolean') {
        return new DashboardReadFailure(reason, error.retryable);
      }
    } else {
      const envelope = exactRecord(value, ['error'], '$');
      const { code, retryable } = parseDashboardSafeError(envelope.error);
      const reason =
        code === 'DASHBOARD_RESPONSE_INVALID'
          ? 'The server could not verify the response against the project snapshot. Refresh the dashboard.'
          : `The server refused the read (${code}, HTTP ${status}).`;
      return new DashboardReadFailure(reason, retryable);
    }
  } catch (error) {
    if (!(error instanceof DashboardValidationError || error instanceof SyntaxError)) throw error;
  }
  return new DashboardReadFailure(
    `The server returned HTTP ${status} without a recognized reason.`,
    transient,
  );
}

export function readFailure(error: unknown, subject: string) {
  if (error instanceof DashboardReadFailure) {
    return {
      reason: `${subject} could not be verified. ${error.message}`,
      retryable: error.retryable,
    };
  }
  const reason =
    error instanceof TypeError
      ? 'Check the dashboard connection and try again.'
      : 'Refresh the project snapshot or try the read again.';
  return { reason: `${subject} could not be verified. ${reason}`, retryable: true };
}
