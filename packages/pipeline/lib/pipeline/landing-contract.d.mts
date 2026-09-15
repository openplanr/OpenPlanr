export declare const LANDING_PROTOCOL_VERSION: '1.2.0';
export declare const LANDING_PORTABLE_AUTHORITY: 'none';
export declare const LANDING_SHIP_PROTOCOL_VERSION: '1.1.0';
export declare class LandingContractError extends Error { code: string; details: Readonly<Record<string, unknown>>; }
export declare function assertLandingOperationRegistry(record: unknown): Readonly<Record<string, unknown>>;
export declare function assertLandingPlan(record: unknown, options?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export declare function assertLandingConfirmation(record: unknown, options?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export declare function assertLandingEvent(record: unknown): Readonly<Record<string, unknown>>;
export declare function createLandingEventState(): Readonly<Record<string, unknown>>;
export declare function reduceLandingEvents(events: unknown[], options?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export declare function assertLandingPhaseReceipt(record: unknown, options?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export declare function assertLandingReceipt(record: unknown, options?: Record<string, unknown>): Readonly<Record<string, unknown>>;
