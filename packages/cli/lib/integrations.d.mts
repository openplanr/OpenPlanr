export type ConflictStrategy = 'local' | 'remote' | 'prompt';
export interface StatusDecision {
  final: string;
  side: 'unchanged' | 'local' | 'remote';
  conflictDecisions: number;
  isTrueConflict: boolean;
}
export interface SyncOperation {
  action: 'create' | 'update';
  id?: string;
  title?: string;
  body?: string;
  state?: string;
  labels?: string[];
  projectId?: string;
  teamId?: string;
}
export declare class IntegrationError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>);
}
export declare function isLikelyLinearIssueId(value: unknown): boolean;
export declare function reconcileStatus(
  conflict: { base?: string; local: string; remote: string },
  strategy: ConflictStrategy,
): StatusDecision;
export declare function inspectGitHub(options?: { cwd?: string }): Promise<Record<string, unknown>>;
export declare function executeGitHubOperations(
  operations: SyncOperation[],
  options?: { cwd?: string; apply?: boolean },
): Promise<Record<string, unknown>>;
export declare function inspectLinear(options?: {
  token?: string;
}): Promise<Record<string, unknown>>;
export declare function executeLinearOperations(
  operations: SyncOperation[],
  options?: { token?: string; apply?: boolean },
): Promise<Record<string, unknown>>;
export declare function runPortableSync(
  argv?: string[],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdin?: NodeJS.ReadableStream;
    stdout?: NodeJS.WritableStream;
  },
): Promise<Record<string, unknown>>;
