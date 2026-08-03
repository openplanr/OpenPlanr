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
/** Wraps a Linear call with small exponential backoff on rate limit / network errors. */
export declare function withLinearRetry<T>(op: string, fn: () => Promise<T>, retries?: number): Promise<T>;
export declare function mapLinearError(err: unknown, context: string): Error;
//# sourceMappingURL=errors.d.ts.map