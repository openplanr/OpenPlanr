import { type OperatingEventHead, type OperatingLockRecord } from './types.js';
export interface OperatingLock {
    readonly record: OperatingLockRecord;
    readonly path: string;
    assertEventHead(currentEventHead: OperatingEventHead): void;
    advanceEventHead(currentEventHead: OperatingEventHead, nextEventHead: OperatingEventHead): Promise<void>;
    heartbeat(currentEventHead: OperatingEventHead, now?: Date): Promise<void>;
    release(): Promise<void>;
}
export interface AcquireLockOptions {
    projectKey: string;
    name?: string;
    now?: Date;
    leaseDurationMs?: number;
    expectedEventHead: OperatingEventHead;
    currentEventHead: OperatingEventHead;
    localRoot?: string;
}
/**
 * Returns null where the platform offers no `ps` — notably Windows. Callers
 * treat a null identity as "cannot corroborate", so lock ownership falls back
 * to the lease and heartbeat rather than to a fabricated identity.
 */
export declare function readProcessStartIdentity(pid: number): Promise<string | null>;
export declare function readOperatingLock(lockPath: string): Promise<OperatingLockRecord>;
export declare function acquireOperatingLock(projectRoot: string, options: AcquireLockOptions): Promise<OperatingLock>;
export declare function recoverStaleOperatingLock(projectRoot: string, options: {
    projectKey: string;
    name?: string;
    expectedNonce: string;
    expectedProcessStartedAt?: string;
    now?: Date;
    localRoot?: string;
    processIdentityReader?: (pid: number) => Promise<string | null>;
}): Promise<void>;
export declare function withOperatingLock<T>(projectRoot: string, options: AcquireLockOptions, operation: (lock: OperatingLock) => Promise<T>): Promise<T>;
//# sourceMappingURL=lock-service.d.ts.map