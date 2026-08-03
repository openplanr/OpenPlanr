import type { OperatingState } from './types.js';
/**
 * Discovers pipeline shipment proof for operating-linked specs without
 * modifying pipeline artifacts. Only a complete, mutually consistent proof
 * emits `ship.observed`; incomplete or contradictory evidence is ignored.
 */
export declare function reconcileOperatingShipObservations(input: {
    projectRoot: string;
    localRoot?: string;
}): Promise<{
    observed: number;
    state: OperatingState;
}>;
//# sourceMappingURL=shipment-observer.d.ts.map