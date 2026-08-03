import { type ClaudeCommandRunner, type ClaudePluginOperation } from './claude-plugin-service.js';
export type RuntimeId = 'claude-code' | 'codex' | 'cursor';
export type RuntimeChoice = RuntimeId | 'auto' | 'all';
export type InstallScope = 'user' | 'project' | 'both';
interface AdapterRegistryEntry {
    id: RuntimeId;
    version: string;
    capabilityLevel: 'artifact' | 'workflow' | 'product';
    installScopes: Array<'user' | 'project'>;
    capabilities?: {
        interactiveQuestions?: 'native' | 'chat' | 'terminal' | 'none';
    };
}
export interface SetupOptions {
    projectDir: string;
    cliVersion: string;
    runtime?: RuntimeChoice;
    /** Explicit runtime selection from the interactive setup wizard. */
    runtimes?: RuntimeId[];
    scope?: InstallScope;
    minimal?: boolean;
    version?: string;
    dryRun?: boolean;
    /** Preserve already-managed adapters when installing or updating one runtime. */
    merge?: boolean;
    /** Reuse every recorded adapter scope when doctor repairs managed assets. */
    preserveExistingScopes?: boolean;
    /** Disable external runtime package changes for owned-file-only repair flows. */
    manageExternalRuntimes?: boolean;
    /** Injectable Claude command boundary for deterministic runtime integration tests. */
    claudeCommandRunner?: ClaudeCommandRunner;
}
export interface SetupPreview {
    ok: true;
    dryRun: boolean;
    minimal: boolean;
    runtimes: RuntimeId[];
    runtimeScopes: Partial<Record<RuntimeId, InstallScope>>;
    scope: InstallScope;
    pipelineVersion: string | null;
    detectedRuntimes: RuntimeId[];
    unavailableRuntimes: RuntimeId[];
    scopeIncompatibleRuntimes: RuntimeId[];
    projectContext: {
        valid: boolean;
        path: string;
        reason: 'planr' | 'git' | 'none';
    };
    actions: Array<{
        runtime: string;
        scope: string;
        target: string;
        operation: 'create' | 'update' | 'unchanged';
        description: string;
    }>;
    runtimeOperations: ClaudePluginOperation[];
    runtimeDiagnostics: Array<{
        runtime: RuntimeId;
        status: 'pass' | 'warn' | 'fail';
        message: string;
        fix?: string;
    }>;
}
export declare class RuntimeManagerError extends Error {
    code: string;
    recovery?: string | undefined;
    constructor(code: string, message: string, recovery?: string | undefined);
    toJSON(): {
        ok: boolean;
        code: string;
        problem: string;
        recovery: string | undefined;
    };
}
export declare function inspectProjectContext(projectDir: string): SetupPreview['projectContext'];
export declare function detectRuntimes(): Array<{
    runtime: RuntimeId;
    installed: boolean;
    command: string;
}>;
export declare function listRuntimeAdapters(): AdapterRegistryEntry[];
export declare function previewSetup(options: SetupOptions): Promise<SetupPreview>;
export declare function applySetup(options: SetupOptions): Promise<SetupPreview & {
    backupDir?: string;
    appliedRuntimeOperations?: ClaudePluginOperation[];
    restartRequired?: boolean;
}>;
export declare function rollbackRuntime(projectDir: string, backupDir?: string): Promise<{
    ok: true;
    restored: string[];
    retainedShared: string[];
}>;
export declare function removeRuntime(runtime: RuntimeId, projectDir: string): Promise<{
    ok: true;
    removed: string[];
    retainedShared: string[];
}>;
export declare function previewHomeProjectCleanup(): Promise<string[]>;
export declare function managedRuntimesForProject(projectDir: string): Promise<RuntimeId[]>;
export declare function isOpenPlanrHome(projectDir: string): boolean;
export declare function cleanupHomeProjectInstall(): Promise<{
    ok: true;
    removed: string[];
}>;
export declare function runtimeDoctor(projectDir: string, options?: {
    pipelineRepair?: 'preview' | 'apply';
    claudeCommandRunner?: ClaudeCommandRunner;
}): Promise<{
    ok: boolean;
    repairs: Array<{
        id: string;
        operation: 'remove';
        target: string;
        applied: boolean;
    }>;
    diagnostics: Array<{
        code: string;
        status: 'pass' | 'warn' | 'fail';
        message: string;
        fix?: string;
    }>;
}>;
export declare function clearRuntimeStateForTests(root: string): Promise<void>;
export {};
//# sourceMappingURL=runtime-manager-service.d.ts.map