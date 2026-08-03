import { type OperatingConfig, type OperatingWorkspaceManifest } from './types.js';
export interface OperatingPaths {
    root: string;
    config: string;
    charter: string;
    workspace: string;
    state: string;
    events: string;
    checkpoint: string;
    records: string;
    cycles: string;
    routes: string;
    outcomes: string;
    artifacts: string;
    migrations: string;
    brief: string;
    findingsDoc: string;
    decisionsDoc: string;
    gapsDoc: string;
    routesDoc: string;
    evidenceIndex: string;
    localRoot: string;
    roots: string;
    journals: string;
    transactions: string;
    locks: string;
    cache: string;
    evidence: string;
    advisors: string;
    quarantine: string;
    sessions: string;
}
export declare function projectMachineKey(projectRoot: string): string;
export declare function resolveOperatingPaths(projectRoot: string, options?: {
    localRoot?: string;
}): OperatingPaths;
export declare function isPathInside(root: string, candidate: string): boolean;
export declare function resolveContainedPath(projectRoot: string, relativePath: string, options?: {
    mustExist?: boolean;
}): Promise<string>;
export declare function resolveOperatingProject(projectRoot: string): Promise<string>;
export declare function assertOperatingProject(projectRoot: string): Promise<string>;
export declare function buildWorkspaceManifest(controlRoot: string, componentRoots?: string[], options?: {
    capturedAt?: string;
    localRoot?: string;
    persistRoots?: boolean;
    ignoredControlPaths?: string[];
}): Promise<OperatingWorkspaceManifest>;
/**
 * Rebuilds the workspace identity from committed component metadata and the
 * machine-local root map. No roots or absolute paths enter committed state.
 */
export declare function refreshOperatingWorkspaceManifest(projectRoot: string, options?: {
    localRoot?: string;
    ignoredControlPaths?: string[];
}): Promise<OperatingWorkspaceManifest>;
export declare function ensureOperatingDirectories(projectRoot: string, options?: {
    localRoot?: string;
}): Promise<OperatingPaths>;
export declare function writeOperatingConfig(projectRoot: string, config: OperatingConfig, options?: {
    localRoot?: string;
}): Promise<void>;
export declare function readOperatingConfig(projectRoot: string, options?: {
    localRoot?: string;
}): Promise<OperatingConfig>;
//# sourceMappingURL=workspace.d.ts.map