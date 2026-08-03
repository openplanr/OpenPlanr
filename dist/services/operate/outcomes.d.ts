import { type OperatingOutcome, type OperatingOutcomeObservation, type OperatingState } from './types.js';
export declare function createOperatingOutcome(input: Omit<OperatingOutcome, 'kind' | 'schemaVersion' | 'protocolVersion' | 'status' | 'createdAt' | 'updatedAt'> & {
    createdAt?: string;
}): Promise<OperatingOutcome>;
export declare function evaluateOperatingOutcome(input: {
    outcome: OperatingOutcome;
    observationId: string;
    observedAt: string;
    window: {
        from: string;
        to: string;
    };
    value: number | null;
    unit: string;
    queryIdentity: string;
    aggregation: OperatingOutcome['aggregation'];
    sampleSize: number;
    coverage: number;
    freshness: 'fresh' | 'stale' | 'unknown';
    guardrailValues: Record<string, number | null>;
    evidenceRefs: string[];
}): Promise<OperatingOutcomeObservation>;
/**
 * Commits one immutable observation and derives its evaluation, learning, and
 * optional follow-up gap under the same event-head lease. Replays are
 * idempotent by observation ID.
 */
export declare function recordOperatingOutcomeObservation(input: {
    projectRoot: string;
    observation: OperatingOutcomeObservation;
    localRoot?: string;
}): Promise<{
    applied: boolean;
    state: OperatingState;
}>;
/**
 * Imports validated observation envelopes dropped into the committed outcome
 * inbox. This is the zero-model reconciliation performed by review-only runs.
 */
export declare function reconcileOperatingOutcomeFiles(input: {
    projectRoot: string;
    localRoot?: string;
}): Promise<{
    reconciled: number;
    shipObserved: number;
    state: OperatingState;
}>;
//# sourceMappingURL=outcomes.d.ts.map