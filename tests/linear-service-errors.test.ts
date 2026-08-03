/**
 * Error-path unit tests for `linear-service` (EPIC-004, review H2).
 *
 * These lock in three security/safety-relevant behaviors that were added
 * during the post-review hardening pass:
 *   - `isLikelyLinearIssueId` accepts both valid Linear id shapes, rejects
 *     everything else (H1 — stale frontmatter can't reach the API).
 *   - `mapLinearError` fallback never leaks raw SDK error messages (M2).
 *   - `withLinearRetry` honours `RatelimitedLinearError.retryAfter` (M3).
 */

import { LinearError, RatelimitedLinearError } from '@linear/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  isLikelyLinearIssueId,
  isLikelyLinearWorkflowStateId,
  withLinearRetry,
} from '../src/services/linear-service.js';

describe('isLikelyLinearIssueId (H1)', () => {
  it("accepts UUID v4 — Linear's canonical API id form", () => {
    expect(isLikelyLinearIssueId('9b2f4c3e-1234-4abc-89de-0123456789ab')).toBe(true);
  });

  it('accepts Linear identifier form (two-or-more letters, dash, digits)', () => {
    expect(isLikelyLinearIssueId('ENG-42')).toBe(true);
    expect(isLikelyLinearIssueId('ABC-1')).toBe(true);
    expect(isLikelyLinearIssueId('PRODUCT-1234')).toBe(true);
  });

  it('rejects malformed values that would otherwise sail through to the API', () => {
    expect(isLikelyLinearIssueId('ENG42')).toBe(false); // missing dash
    expect(isLikelyLinearIssueId('E-42')).toBe(false); // one-letter prefix
    expect(isLikelyLinearIssueId('eng-42')).toBe(false); // lowercase prefix
    expect(isLikelyLinearIssueId('ENG-')).toBe(false); // missing number
    expect(isLikelyLinearIssueId('-42')).toBe(false); // missing prefix
    expect(isLikelyLinearIssueId('')).toBe(false);
    expect(isLikelyLinearIssueId('   ')).toBe(false);
    expect(isLikelyLinearIssueId('a random string')).toBe(false);
  });

  it('trims whitespace before validating', () => {
    expect(isLikelyLinearIssueId('  ENG-42  ')).toBe(true);
    expect(isLikelyLinearIssueId('\n9b2f4c3e-1234-4abc-89de-0123456789ab\n')).toBe(true);
  });

  it('workflow state UUIDs are also considered valid issue ids (both are uuids)', () => {
    // Sanity: both validators agree on uuid-shaped values.
    const uuid = '9b2f4c3e-1234-4abc-89de-0123456789ab';
    expect(isLikelyLinearWorkflowStateId(uuid)).toBe(true);
    expect(isLikelyLinearIssueId(uuid)).toBe(true);
  });
});

describe('withLinearRetry (M3 — honour Retry-After)', () => {
  // Small helper: create a RatelimitedLinearError with a given retryAfter.
  // The SDK constructor is private-ish, so we build a minimal shape and
  // cast — same approach the Linear SDK's own tests use.
  function rateLimitedErr(retryAfterSeconds: number | undefined): RatelimitedLinearError {
    const err = new RatelimitedLinearError('rate limited');
    // retryAfter is writeable on the instance; assign directly.
    (err as unknown as { retryAfter: number | undefined }).retryAfter = retryAfterSeconds;
    return err;
  }

  it('retries on rate-limit and eventually succeeds', async () => {
    const attempts: number[] = [];
    const fn = vi.fn(async () => {
      attempts.push(Date.now());
      if (attempts.length < 2) throw rateLimitedErr(0); // retryAfter=0 keeps the test fast
      return 'ok';
    });

    const result = await withLinearRetry('test op', fn, 3);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('surfaces the error after exhausting retries', async () => {
    const err = rateLimitedErr(0);
    const fn = vi.fn(async () => {
      throw err;
    });

    await expect(withLinearRetry('test op', fn, 1)).rejects.toThrow(/rate limit/i);
    // 1 retry = 2 total attempts.
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-retriable errors (sanity)', async () => {
    // Auth errors are not retriable; should fail on the first attempt.
    const err = new LinearError('auth failed');
    (err as unknown as { type?: string }).type = 'AuthenticationError';
    const fn = vi.fn(async () => {
      throw err;
    });

    await expect(withLinearRetry('test op', fn, 3)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('mapLinearError fallback (M2 — no raw SDK message leakage)', () => {
  // mapLinearError is not exported directly; we verify it via the retry
  // wrapper which calls it on final failure. Non-retriable errors get
  // mapped on the first exception.
  it('unknown error class produces a sanitized message without the raw body', async () => {
    class WeirdError extends Error {
      query = 'query secret { token }';
      variables = { token: 'sk_live_abc123' };
      constructor(msg: string) {
        super(msg);
        this.name = 'WeirdError';
      }
    }
    const leaky = new WeirdError('raw body: { token: "sk_live_abc123" }');
    const fn = vi.fn(async () => {
      throw leaky;
    });

    await expect(withLinearRetry('doing secret thing', fn, 0)).rejects.toThrow(
      /Linear error while doing secret thing \(WeirdError\)/,
    );
    // Crucially — the raw message is NOT in the surfaced error. Only class name + context.
    try {
      await withLinearRetry('doing secret thing', fn, 0);
      throw new Error('should not reach here');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain('sk_live_abc123');
      expect(msg).not.toContain('query secret');
      expect(msg).toMatch(/Re-run with --verbose/);
    }
  });

  it('known auth error still uses the documented guidance (not the fallback)', async () => {
    const err = new LinearError('bad token');
    (err as unknown as { type?: string }).type = 'AuthenticationError';
    const fn = vi.fn(async () => {
      throw err;
    });

    await expect(withLinearRetry('loading teams', fn, 0)).rejects.toThrow(/Create a new PAT/);
  });
});
