/**
 * Git integration for `planr revise`.
 *
 * Two responsibilities:
 *
 * 1. **Clean-tree gate:** revise refuses to run with a dirty
 *    working tree by default. Users can override with `--allow-dirty`, but
 *    post-flight rollback depends on a clean pre-run state, so the gate is
 *    the load-bearing safety net.
 *
 * 2. **Capture + rollback anchor:** before bulk writes,
 *    revise captures HEAD and the set of touched paths so a post-flight
 *    graph-integrity failure can restore via `git checkout`.
 *
 * All git operations use `execFile` (not shell), matching the pattern in
 * github-service.ts. If git is not available or the project is not a git
 * repo, clean-tree checks fail closed (revise refuses to run) unless
 * --allow-dirty is passed, because without git there is no safety net.
 */
export type GitTreeStatus = {
    kind: 'clean';
    head: string;
} | {
    kind: 'dirty';
    head: string;
    changedPaths: string[];
} | {
    kind: 'not-a-repo';
    reason: string;
} | {
    kind: 'git-missing';
    reason: string;
};
export interface GitCleanTreeCheckOptions {
    allowDirty: boolean;
}
export interface GitCleanTreeCheckResult {
    ok: boolean;
    status: GitTreeStatus;
    /** User-facing message describing why the gate opened or closed. */
    message: string;
}
/**
 * Inspect the working tree. Never throws — always returns a typed status so
 * callers can render errors consistently.
 */
export declare function inspectGitTree(projectDir: string): Promise<GitTreeStatus>;
/**
 * The clean-tree gate: clean → pass; dirty → pass only when --allow-dirty;
 * missing git / not a repo → fail closed unless --allow-dirty was passed
 * (because without git there is no post-flight rollback safety net).
 */
export declare function checkCleanTree(projectDir: string, options: GitCleanTreeCheckOptions): Promise<GitCleanTreeCheckResult>;
/**
 * Restore a set of paths from HEAD — the primitive the post-flight
 * rollback invokes when graph integrity breaks after writes. Paths are
 * relative to `projectDir`. Empty list is a no-op.
 */
export declare function checkoutPaths(projectDir: string, relativePaths: string[]): Promise<void>;
//# sourceMappingURL=git-service.d.ts.map