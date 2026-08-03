import type { OperatingEvent, OperatingState } from './types.js';
export interface OperatingStalledItem {
    id: string;
    kind: 'finding' | 'decision';
    stalledCycles: number;
    stalled: boolean;
    lastProgressSequence: number;
}
/**
 * Derives absolute stall counters from lifecycle evidence. Replaying the same
 * event chain always produces the same counters; no wall-clock time is used.
 */
export declare function deriveOperatingStalledItems(state: OperatingState, events: OperatingEvent[]): OperatingStalledItem[];
export declare function projectOperatingStalledItems(state: OperatingState, events: OperatingEvent[]): OperatingState;
export declare function operatingStalledItems(state: OperatingState): OperatingStalledItem[];
export declare function attachOperatingStalledItems(state: OperatingState, stalls: OperatingStalledItem[]): OperatingState;
export declare function overdueOperatingDecisionIds(state: OperatingState, now: Date): string[];
//# sourceMappingURL=stalled-item-service.d.ts.map