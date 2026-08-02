export declare const OPENPLANR_CLAUDE_MARKETPLACE = "openplanr";
export declare const OPENPLANR_CLAUDE_MARKETPLACE_SOURCE = "openplanr/marketplace";
export declare const OPENPLANR_SKILLS_VERSION = "1.23.0";
export type ClaudePluginOperationKind = 'add-marketplace' | 'refresh-marketplace' | 'install' | 'update' | 'enable';
export interface ClaudePluginOperation {
    runtime: 'claude-code';
    kind: ClaudePluginOperationKind;
    id: string;
    scope: 'user';
    currentVersion?: string;
    targetVersion?: string;
    description: string;
}
export interface ClaudePluginState {
    id: string;
    name: string;
    expectedVersion: string;
    installedVersion?: string;
    enabled: boolean;
    installed: boolean;
    identityValid: boolean;
    installPath?: string;
}
export interface ClaudePluginInspection {
    available: boolean;
    marketplaceConfigured: boolean;
    ready: boolean;
    operations: ClaudePluginOperation[];
    plugins: ClaudePluginState[];
    legacyPluginIds: string[];
    error?: string;
}
export interface ClaudePluginApplyResult {
    operations: ClaudePluginOperation[];
    restartRequired: boolean;
    inspection: ClaudePluginInspection;
}
export interface ClaudeCommandResult {
    status: number | null;
    stdout: string;
    stderr: string;
    error?: Error;
}
export type ClaudeCommandRunner = (args: string[]) => ClaudeCommandResult;
export declare function inspectClaudePluginIntegration(pipelineVersion: string, runner?: ClaudeCommandRunner): ClaudePluginInspection;
export declare function applyClaudePluginIntegration(pipelineVersion: string, inspection: ClaudePluginInspection, runner?: ClaudeCommandRunner): ClaudePluginApplyResult;
//# sourceMappingURL=claude-plugin-service.d.ts.map