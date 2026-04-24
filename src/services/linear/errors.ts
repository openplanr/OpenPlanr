/**
 * Linear error classification, user-facing mapping, and retry wrapper.
 *
 * Two responsibilities:
 *   1. Map raw SDK errors to user-friendly messages (branded guidance for
 *      auth / network / rate-limit; surfaced friendly SDK message for other
 *      classified types; sanitized fallback for unclassified errors).
 *   2. Wrap Linear calls with small exponential backoff that honours
 *      `RatelimitedLinearError.retryAfter`.
 */

import { LinearError, LinearErrorType, RatelimitedLinearError } from '@linear/sdk';
import { logger } from '../../utils/logger.js';

const DEFAULT_RETRIES = 3;

/**
 * Extract the first user-facing message from a LinearError. The SDK exposes
 * per-GraphQL-error `.message` strings on `errors[]` — these are backend-
 * authored user descriptions (e.g., "Milestone already exists with this
 * name"). Falls back to `err.message` and finally to the error `type`.
 * Safe to surface — this is not the raw query/variables.
 */
function extractLinearFriendlyMessage(err: LinearError): string | undefined {
  const first = err.errors?.[0]?.message?.trim();
  if (first) return first;
  const top = err.message?.trim();
  if (top) return top;
  const type = (err as { type?: string }).type;
  return type || undefined;
}

function isRetriableLinearError(err: unknown): boolean {
  if (err instanceof LinearError) {
    const t = (err as { type?: string }).type ?? LinearErrorType.Unknown;
    return t === LinearErrorType.Ratelimited || t === LinearErrorType.NetworkError;
  }
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

/** Wraps a Linear call with small exponential backoff on rate limit / network errors. */
export async function withLinearRetry<T>(
  op: string,
  fn: () => Promise<T>,
  retries: number = DEFAULT_RETRIES,
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (attempt < retries && isRetriableLinearError(err)) {
        // Prefer Linear's own `Retry-After` when the error is a rate-limit
        // (surfaced on the `RatelimitedLinearError` subclass as a seconds
        // value). Fall back to exponential backoff for network errors and
        // when the server didn't advertise a retry hint. Use `Math.max` so
        // we respect both: never retry sooner than Linear asked, never
        // faster than our own backoff schedule.
        const retryAfterMs =
          err instanceof RatelimitedLinearError && typeof err.retryAfter === 'number'
            ? Math.max(0, err.retryAfter) * 1000
            : 0;
        const backoffMs = Math.min(30_000, 500 * 2 ** attempt);
        const waitMs = Math.max(retryAfterMs, backoffMs);
        logger.dim(`Linear ${op}: retrying in ${waitMs}ms (attempt ${attempt + 1}/${retries})...`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw mapLinearError(err, op);
    }
  }
  throw mapLinearError(last, op);
}

export function mapLinearError(err: unknown, context: string): Error {
  if (err instanceof Error && err.name === 'AbortError') {
    return new Error(`Network error while ${context}: request was cancelled or timed out.`);
  }
  if (err instanceof LinearError) {
    const t = (err as { type?: string }).type ?? LinearErrorType.Unknown;
    if (t === LinearErrorType.AuthenticationError) {
      return new Error(
        `Linear rejected this token while ${context}. Create a new PAT at https://linear.app/settings/account/security (app, read, write as needed) and run \`planr linear init\` again.`,
      );
    }
    if (t === LinearErrorType.NetworkError) {
      return new Error(
        `Cannot reach Linear while ${context}. Check your network connection, try again, and see https://status.linear.app for outages.`,
      );
    }
    if (t === LinearErrorType.Ratelimited) {
      return new Error(
        'Linear rate limit reached. Wait about 1–2 minutes (longer if you are polling heavily), then retry. See https://status.linear.app if issues persist.',
      );
    }
    // For other classified LinearError types (Forbidden, InvalidInput, UserError,
    // FeatureNotAccessible, Internal, LockTimeout, UsageLimitExceeded, Graphql,
    // Other, Bootstrap, Unknown) surface the SDK's friendly .message string —
    // backend-authored user descriptions like "Milestone name already exists
    // in project" or "Input invalid: projectId". Also log the full object at
    // debug level for --verbose diagnostics.
    logger.debug(`Linear error (${context}, type=${t})`, err);
    const friendly = extractLinearFriendlyMessage(err);
    const suffix = friendly ? `: ${friendly}` : '';
    if (t === LinearErrorType.Forbidden) {
      return new Error(
        `Permission denied while ${context}${suffix}. Your token may be missing the required scope, or your user cannot access this resource.`,
      );
    }
    return new Error(`Linear error while ${context} (${t})${suffix}`);
  }
  // Unknown / unclassified error class: log the full object at debug level so
  // operators can inspect it with `--verbose`, but do NOT surface the raw
  // message to end users — could contain arbitrary response bodies.
  logger.debug(`Linear error (${context})`, err);
  const klass = err instanceof Error ? err.constructor.name : 'Unknown';
  return new Error(
    `Linear error while ${context} (${klass}). Re-run with --verbose for diagnostic details.`,
  );
}
