import { describe, expect, it, vi } from 'vitest';
import {
  isReplaySafeGenerationConflict,
  replaySafeRetryDelay,
  retryReplaySafeGenerationConflict,
} from '../../src/services/operate/replay-safe-retry-service.js';

function generationConflict(expectedGeneration = 'gen-a', currentGeneration = 'gen-b') {
  return Object.freeze({
    code: 'OPERATE_STORE_CONFLICT',
    context: Object.freeze({ expectedGeneration, currentGeneration }),
  });
}

describe('Operate replay-safe generation retry', () => {
  it('uses an initial attempt plus at most four deterministic bounded retries', async () => {
    const wait = vi.fn(async () => undefined);
    const attempts: number[] = [];
    await expect(
      retryReplaySafeGenerationConflict(
        'submit:exact-request-hash',
        async () => {
          attempts.push(attempts.length + 1);
          if (attempts.length < 5) throw generationConflict();
          return 'accepted';
        },
        { wait },
      ),
    ).resolves.toBe('accepted');

    expect(attempts).toEqual([1, 2, 3, 4, 5]);
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual(
      [1, 2, 3, 4].map((ordinal) => replaySafeRetryDelay('submit:exact-request-hash', ordinal)),
    );
    expect(wait.mock.calls.every(([delay]) => delay <= 200)).toBe(true);
  });

  it('reuses the exact request and content bytes across every retry', async () => {
    const request = Object.freeze({
      assignmentId: 'asg-retry',
      actor: Object.freeze({ actorId: 'agent-retry', kind: 'agent', runtime: 'codex' }),
    });
    const contentBytes = Buffer.from('{"exact":true}', 'utf8');
    const observedRequests: unknown[] = [];
    const observedBytes: unknown[] = [];
    let attempts = 0;

    await retryReplaySafeGenerationConflict(
      'submit:byte-identical',
      async () => {
        observedRequests.push(request);
        observedBytes.push(contentBytes);
        attempts += 1;
        if (attempts < 3) throw generationConflict();
        return undefined;
      },
      { wait: async () => undefined },
    );

    expect(observedRequests.every((candidate) => candidate === request)).toBe(true);
    expect(observedBytes.every((candidate) => candidate === contentBytes)).toBe(true);
    expect(contentBytes.toString('utf8')).toBe('{"exact":true}');
  });

  it.each([
    ['foreign claim', { code: 'ASSIGNMENT_ALREADY_CLAIMED' }],
    ['authorization', { code: 'CAPABILITY_DENIED', context: {} }],
    ['corruption', { code: 'OPERATE_STORE_CORRUPT', context: {} }],
    ['live lock', { code: 'OPERATE_STORE_LOCKED', context: {} }],
    ['generation code without custody', { code: 'OPERATE_STORE_CONFLICT', context: {} }],
    ['missing context', { code: 'RESULT_CONTRACT_INVALID' }],
    ['array context', { code: 'OPERATE_STORE_CONFLICT', context: [] }],
  ])('preserves %s errors without retrying or replacing them', async (_label, original) => {
    const attempt = vi.fn(async () => {
      throw original;
    });
    const wait = vi.fn(async () => undefined);

    await expect(
      retryReplaySafeGenerationConflict('claim:non-generation', attempt, { wait }),
    ).rejects.toBe(original);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    expect(isReplaySafeGenerationConflict(original)).toBe(false);
  });

  it('returns the exact fifth conflict when generation contention is exhausted', async () => {
    const conflicts = Array.from({ length: 5 }, (_, index) =>
      generationConflict(`gen-${index}`, `gen-${index + 1}`),
    );
    let attempts = 0;
    await expect(
      retryReplaySafeGenerationConflict(
        'claim:exhausted',
        async () => {
          const error = conflicts[attempts];
          attempts += 1;
          throw error;
        },
        { wait: async () => undefined },
      ),
    ).rejects.toBe(conflicts[4]);
    expect(attempts).toBe(5);
  });
});
