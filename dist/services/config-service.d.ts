import type { OpenPlanrConfig } from '../models/types.js';
/** Error thrown when no OpenPlanr config file exists in the given project directory. */
export declare class ConfigNotFoundError extends Error {
    constructor(projectDir: string);
}
/** Load and validate the OpenPlanr config file from the given project directory. */
export declare function loadConfig(projectDir: string): Promise<OpenPlanrConfig>;
/** Write the OpenPlanr config to disk as formatted JSON. */
export declare function saveConfig(projectDir: string, config: OpenPlanrConfig): Promise<void>;
/**
 * Walk up from `startDir` looking for a directory containing `.planr/config.json`.
 * Returns the first match, or `startDir` if none found (so `planr init` still works).
 */
export declare function findProjectRoot(startDir?: string): string;
/** Build a default OpenPlanr config with standard prefixes and output paths. */
export declare function createDefaultConfig(projectName: string): OpenPlanrConfig;
//# sourceMappingURL=config-service.d.ts.map