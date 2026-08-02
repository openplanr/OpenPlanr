import { type OperateActionRequest, type OperateActionResult } from './types.js';
export { canonicalDigest, canonicalize, sha256Digest, } from './canonical.js';
export { OperatingEventStore } from './event-store.js';
export { acquireOperatingLock, recoverStaleOperatingLock, withOperatingLock, } from './lock-service.js';
export { assertOperatingProjectionsCurrent, inspectOperatingProjectionDrift, persistOperatingProjections, prepareOperatingProjectionPersistence, renderOperatingProjectionFiles, } from './projection-persistence.js';
export { assertOperatingArtifact, loadOperatingProtocol, operatingPipelineAvailable, } from './protocol.js';
export type { OperateActionRequest, OperateActionResult, OperatingConfig, } from './types.js';
export declare function usesNativeOperatingAdvisors(projectRoot: string, requestedRuntime: string): Promise<boolean>;
export declare function failure(action: string, error: unknown): OperateActionResult;
/**
 * Stable runtime-neutral Operating Board facade. Public CLI adapters only parse
 * arguments and render this structured result; all state and security semantics
 * live behind this function.
 */
export declare function executeOperateAction(request: OperateActionRequest): Promise<OperateActionResult>;
//# sourceMappingURL=index.d.ts.map