import type { OperatingCheckpoint, OperatingEvent, OperatingState } from './types.js';
/** Canonical projection is owned by planr-pipeline/protocol, never duplicated here. */
export declare function reduceOperatingEvents(events: OperatingEvent[], options?: {
    checkpoint?: OperatingCheckpoint | null;
}): Promise<OperatingState>;
export declare function verifyOperatingEvents(events: OperatingEvent[]): Promise<{
    sequence: number;
    hash: `sha256:${string}` | null;
}>;
//# sourceMappingURL=reducer.d.ts.map