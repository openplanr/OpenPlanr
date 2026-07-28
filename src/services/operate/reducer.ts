import { loadOperatingProtocol } from './protocol.js';
import type { OperatingCheckpoint, OperatingEvent, OperatingState } from './types.js';

/** Canonical projection is owned by planr-pipeline/protocol, never duplicated here. */
export async function reduceOperatingEvents(
  events: OperatingEvent[],
  options: { checkpoint?: OperatingCheckpoint | null } = {},
): Promise<OperatingState> {
  return (await loadOperatingProtocol()).reduceOperatingEvents(events, {
    checkpoint: options.checkpoint ?? null,
  });
}

export async function verifyOperatingEvents(
  events: OperatingEvent[],
): Promise<{ sequence: number; hash: `sha256:${string}` | null }> {
  return (await loadOperatingProtocol()).verifyOperatingEventChain(events);
}
