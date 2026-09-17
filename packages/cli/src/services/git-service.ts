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

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 10 * 1024 * 1024;

export type GitTreeStatus =
  | { kind: 'clean'; head: string }
  | { kind: 'dirty'; head: string; changedPaths: string[] }
  | { kind: 'not-a-repo'; reason: string }
  | { kind: 'git-missing'; reason: string };

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
export async function inspectGitTree(projectDir: string): Promise<GitTreeStatus> {
  let head: string;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: projectDir,
      maxBuffer: GIT_MAX_BUFFER,
    });
    head = stdout.trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not a git repository|fatal:.*repository/i.test(message)) {
      return { kind: 'not-a-repo', reason: message };
    }
    if (/ENOENT|git: not found|command not found/i.test(message)) {
      return { kind: 'git-missing', reason: message };
    }
    // Empty repo (no commits yet) also reaches here; treat it as not-a-repo
    // for clean-tree gating purposes — there is no HEAD to roll back to.
    if (/unknown revision|does not have any commits/i.test(message)) {
      return { kind: 'not-a-repo', reason: 'git repository has no commits yet' };
    }
    return { kind: 'not-a-repo', reason: message };
  }

  const { stdout: porcelain } = await execFileAsync('git', ['status', '--porcelain'], {
    cwd: projectDir,
    maxBuffer: GIT_MAX_BUFFER,
  });

  if (porcelain.trim().length === 0) {
    return { kind: 'clean', head };
  }

  const changedPaths = porcelain
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3).trim());

  return { kind: 'dirty', head, changedPaths };
}

/**
 * The clean-tree gate: clean → pass; dirty → pass only when --allow-dirty;
 * missing git / not a repo → fail closed unless --allow-dirty was passed
 * (because without git there is no post-flight rollback safety net).
 */
export async function checkCleanTree(
  projectDir: string,
  options: GitCleanTreeCheckOptions,
): Promise<GitCleanTreeCheckResult> {
  const status = await inspectGitTree(projectDir);

  switch (status.kind) {
    case 'clean':
      return {
        ok: true,
        status,
        message: `Working tree is clean at ${status.head.slice(0, 12)}.`,
      };

    case 'dirty':
      if (options.allowDirty) {
        return {
          ok: true,
          status,
          message: `Working tree has ${status.changedPaths.length} uncommitted change(s); running with --allow-dirty. Post-flight rollback cannot restore these changes.`,
        };
      }
      return {
        ok: false,
        status,
        message: `Working tree has ${status.changedPaths.length} uncommitted change(s). Commit or stash them, or re-run with --allow-dirty (post-flight rollback cannot restore uncommitted work).`,
      };

    case 'not-a-repo':
      if (options.allowDirty) {
        return {
          ok: true,
          status,
          message: `Not a git repository (${status.reason.trim()}); running with --allow-dirty. Post-flight rollback is disabled.`,
        };
      }
      return {
        ok: false,
        status,
        message: `Not a git repository (${status.reason.trim()}). Revise requires git for its post-flight rollback safety net. Initialize git, or re-run with --allow-dirty to opt out of the safety net.`,
      };

    case 'git-missing':
      if (options.allowDirty) {
        return {
          ok: true,
          status,
          message: `git CLI not found; running with --allow-dirty. Post-flight rollback is disabled.`,
        };
      }
      return {
        ok: false,
        status,
        message: `git CLI not found on PATH. Revise requires git for its post-flight rollback safety net. Install git, or re-run with --allow-dirty to opt out.`,
      };

    default: {
      const _exhaustive: never = status;
      throw new Error(`unhandled GitTreeStatus: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Restore a set of paths from HEAD — the primitive the post-flight
 * rollback invokes when graph integrity breaks after writes. Paths are
 * relative to `projectDir`. Empty list is a no-op.
 */
export async function checkoutPaths(projectDir: string, relativePaths: string[]): Promise<void> {
  if (relativePaths.length === 0) return;
  await execFileAsync('git', ['checkout', '--', ...relativePaths], {
    cwd: projectDir,
    maxBuffer: GIT_MAX_BUFFER,
  });
}

export type GitCommitResult =
  | { committed: true; sha: string; paths: string[] }
  | { committed: false; reason: string };

/** Thrown when git cannot run or `projectDir` is not inside a repository. */
export class GitUnavailableError extends Error {
  readonly kind: 'not-a-repo' | 'git-missing';
  constructor(kind: 'not-a-repo' | 'git-missing', reason: string) {
    super(reason);
    this.name = 'GitUnavailableError';
    this.kind = kind;
  }
}

/**
 * Stage and commit exactly `relativePaths` with `message`, leaving any other
 * staged or unstaged work untouched. Returns `committed: false` when none of
 * the paths changed. Hooks run as usual.
 */
export async function commitPaths(
  projectDir: string,
  relativePaths: string[],
  message: string,
): Promise<GitCommitResult> {
  if (relativePaths.length === 0) return { committed: false, reason: 'no paths to commit' };
  for (const relativePath of relativePaths) {
    if (relativePath.startsWith('/') || relativePath.split(/[\\/]/u).includes('..')) {
      throw new Error(`Refusing to commit a path outside the project: ${relativePath}`);
    }
  }
  const run = (args: string[]) =>
    execFileAsync('git', args, { cwd: projectDir, maxBuffer: GIT_MAX_BUFFER });

  try {
    await run(['rev-parse', '--is-inside-work-tree']);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (/ENOENT|git: not found|command not found/i.test(reason)) {
      throw new GitUnavailableError('git-missing', reason);
    }
    throw new GitUnavailableError('not-a-repo', reason);
  }

  await run(['add', '--', ...relativePaths]);
  const { stdout } = await run(['status', '--porcelain', '--', ...relativePaths]);
  if (stdout.trim().length === 0) return { committed: false, reason: 'nothing changed' };
  await run(['commit', '-q', '-m', message, '--', ...relativePaths]);
  const { stdout: head } = await run(['rev-parse', 'HEAD']);
  return { committed: true, sha: head.trim(), paths: [...relativePaths] };
}
