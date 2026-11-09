export type ConflictStrategy = 'local' | 'remote' | 'prompt';
export interface StatusDecision {
  final: string;
  side: 'unchanged' | 'local' | 'remote';
  conflictDecisions: number;
  isTrueConflict: boolean;
}
export type GitHubOperation =
  | { action: 'create'; title: string; body?: string; labels?: string[] }
  | { action: 'update'; id: string; title?: string; body?: string; labels?: string[] }
  | { action: 'close' | 'reopen'; id: string; comment?: string };
export type GitHubOperationStatus = 'planned' | 'applied' | 'failed' | 'not-run';
export interface GitHubOperationResult {
  index: number;
  action: GitHubOperation['action'];
  status: GitHubOperationStatus;
  id?: string;
  title?: string;
  url?: string;
  error?: { code: string; problem: string; recovery?: string };
}
export interface GitHubSyncResult {
  provider: 'github';
  applied: boolean;
  complete: boolean;
  results: GitHubOperationResult[];
}
export interface GitHubInspection {
  provider: 'github';
  repository: unknown;
}
export interface LocalInspection {
  provider: 'local';
  roots: string[];
  configured: boolean;
}
export declare const GH_ENVIRONMENT: readonly string[];
export declare class IntegrationError extends Error {
  readonly code: string;
  readonly recovery?: string;
  readonly details: Record<string, unknown>;
  constructor(
    code: string,
    message: string,
    details?: { recovery?: string } & Record<string, unknown>,
  );
}
export declare function isLikelyLinearIssueId(value: unknown): boolean;
export declare function reconcileStatus(
  conflict: { base?: string; local: string; remote: string },
  strategy: ConflictStrategy,
): StatusDecision;
export declare function ghEnvironment(env?: NodeJS.ProcessEnv): Record<string, string>;
export declare function validateGitHubOperations(operations: unknown): GitHubOperation[];
export declare function executeGitHubOperations(
  operations: unknown,
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; apply?: boolean },
): Promise<GitHubSyncResult>;
export declare function inspectGitHub(options?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<GitHubInspection>;
export declare function inspectLocal(options?: { cwd?: string }): Promise<LocalInspection>;
