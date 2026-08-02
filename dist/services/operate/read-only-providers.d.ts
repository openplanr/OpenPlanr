export declare function assertGitReadOnlyArgs(args: readonly string[]): void;
export declare function executeGitReadOnly(projectRoot: string, args: string[], options?: {
    timeoutMs?: number;
}): Promise<string>;
export declare function assertGitCitationRevision(revision: string): void;
export interface GitCitationBlob {
    exists: boolean;
    content: string | null;
    lineCount: number;
}
/**
 * Read one repository-relative file at a pinned revision through the read-only
 * `show` surface for a repository-path citation. Returns `exists: false` when the
 * path is absent at that revision instead of throwing, so a fabricated or drifted
 * citation becomes a fail-closed rejection rather than an error.
 */
export declare function readGitPathAtRevision(projectRoot: string, revision: string, relativePath: string, options?: {
    maxBytes?: number;
    timeoutMs?: number;
}): Promise<GitCitationBlob>;
/** Read a `.planr/`-rooted control artifact at a pinned revision for a planr-artifact citation. */
export declare function readGitPlanrPathAtRevision(projectRoot: string, revision: string, planrPath: string, options?: {
    maxBytes?: number;
    timeoutMs?: number;
}): Promise<GitCitationBlob>;
/**
 * List the immediate entry names of a `.planr/`-rooted tree at a pinned revision.
 * Returns an empty list when the tree is absent, so an unresolved planr-artifact
 * citation fails closed rather than throwing.
 */
export declare function listGitPlanrTreeAtRevision(projectRoot: string, revision: string, planrTreePath: string, options?: {
    timeoutMs?: number;
}): Promise<string[]>;
/** Whether a cited revision resolves to a commit object, using the read-only rev-parse surface. */
export declare function gitRevisionResolves(projectRoot: string, revision: string, options?: {
    timeoutMs?: number;
}): Promise<boolean>;
/** A compact, snapshot-safe commit summary (hash, ISO commit date, subject) for a git-revision citation. */
export declare function readGitCommitSummary(projectRoot: string, revision: string, options?: {
    timeoutMs?: number;
}): Promise<string | null>;
export declare function assertGitHubReadOnlyArgs(args: readonly string[]): void;
export declare function executeGitHubReadOnly(projectRoot: string, args: string[], options?: {
    allowedHosts?: string[];
    timeoutMs?: number;
}): Promise<string>;
export type ReadOnlyFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface BoundedRemoteRequestOptions {
    allowedHosts: readonly string[];
    timeoutMs?: number;
    maxBytes?: number;
    fetchImpl?: ReadOnlyFetch;
}
export declare function assertReadOnlyRestRequest(endpoint: string | URL, method: string, allowedHosts: readonly string[]): URL;
export declare function executeRestReadOnlyJson<T>(endpoint: string | URL, options: BoundedRemoteRequestOptions & {
    method?: 'GET' | 'HEAD';
    headers?: Readonly<Record<string, string>>;
}): Promise<T>;
export declare function assertLinearReadOnlyQuery(endpoint: string, query: string): void;
export interface LinearQueryTransport {
    readonly endpoint: string;
    query<T>(query: string, variables?: Readonly<Record<string, unknown>>): Promise<T>;
}
export declare class ReadOnlyLinearTransport {
    private readonly transport;
    constructor(transport: LinearQueryTransport);
    query<T>(query: string, variables?: Readonly<Record<string, unknown>>): Promise<T>;
}
export declare function executeLinearReadOnlyQuery<T>(input: BoundedRemoteRequestOptions & {
    endpoint?: string;
    token: string;
    query: string;
    variables?: Readonly<Record<string, unknown>>;
}): Promise<T>;
//# sourceMappingURL=read-only-providers.d.ts.map