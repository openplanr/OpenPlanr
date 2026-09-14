import { createHash } from 'node:crypto';

const DEFAULT_MAXIMUM_ATTEMPTS = 5;
const mutationLanes = new Map<string, Promise<unknown>>();

type ReplaySafeRetryOptions = Readonly<{
  maximumAttempts?: number;
  wait?: (milliseconds: number) => Promise<void>;
}>;

function closedRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Only optimistic-generation conflicts with both custody generations are safe to
 * replay. The predicate is deliberately total so an unrelated error is preserved
 * byte-for-byte instead of being replaced by adapter validation.
 */
export function isReplaySafeGenerationConflict(error: unknown): boolean {
  const candidate = closedRecord(error);
  const context = closedRecord(candidate?.context);
  return (
    candidate?.code === 'OPERATE_STORE_CONFLICT' &&
    context !== null &&
    Object.hasOwn(context, 'expectedGeneration') &&
    Object.hasOwn(context, 'currentGeneration')
  );
}

export function replaySafeRetryDelay(requestKey: string, retryOrdinal: number): number {
  const jitter = createHash('sha256').update(`${requestKey}:${retryOrdinal}`).digest()[0] % 41;
  return Math.min(200, 20 * 2 ** (retryOrdinal - 1) + jitter);
}

/** Initial attempt plus at most four byte-identical optimistic retries. */
export async function retryReplaySafeGenerationConflict<T>(
  requestKey: string,
  attempt: () => Promise<T>,
  options: ReplaySafeRetryOptions = {},
): Promise<T> {
  const maximumAttempts = options.maximumAttempts ?? DEFAULT_MAXIMUM_ATTEMPTS;
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 5) {
    throw new TypeError('maximumAttempts must be an integer between 1 and 5.');
  }
  const wait =
    options.wait ??
    (async (milliseconds: number) => {
      await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
    });

  for (let attemptIndex = 0; attemptIndex < maximumAttempts; attemptIndex += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (attemptIndex === maximumAttempts - 1 || !isReplaySafeGenerationConflict(error)) {
        throw error;
      }
      await wait(replaySafeRetryDelay(requestKey, attemptIndex + 1));
    }
  }
  throw new TypeError('Replay-safe retry exhausted without returning or throwing.');
}

/**
 * Prevents same-process clients for one Store from manufacturing a live-lock.
 * Cross-process custody remains protected by the durable Store lock; this lane
 * only orders the full load/transition/commit attempt in the current adapter.
 */
export async function withOperateMutationLane<T>(
  storeRoot: string,
  mutation: () => Promise<T>,
): Promise<T> {
  const previous = mutationLanes.get(storeRoot) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(mutation);
  mutationLanes.set(storeRoot, current);
  try {
    return await current;
  } finally {
    if (mutationLanes.get(storeRoot) === current) mutationLanes.delete(storeRoot);
  }
}
