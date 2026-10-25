import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CliBoundaryError } from '../../cli/error-boundary.js';
import type { ChangedFile, ChangedFileStatus, ShipDiagnostic } from './contract.js';
import { diagnostic } from './contract.js';

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

export async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: root, maxBuffer: GIT_MAX_BUFFER });
  return stdout;
}

/** Runs a git probe whose failure means the ref or object is absent. */
async function gitOrNull(root: string, args: string[]): Promise<string | null> {
  try {
    return await git(root, args);
  } catch {
    return null;
  }
}

/** The repository top level for a project directory. */
export async function repositoryRoot(projectDir: string): Promise<string> {
  try {
    return (await git(projectDir, ['rev-parse', '--show-toplevel'])).trim();
  } catch (cause) {
    throw new CliBoundaryError(
      'E_SHIP_CHECKS_NOT_A_REPOSITORY',
      'The project directory is not inside a git repository.',
      { cause, recovery: 'Run the command inside a git checkout or pass --project-dir.' },
    );
  }
}

export type ChangeBase = { ref: string; commit: string };

/** Resolves `--base`, else the merge base with `origin/HEAD`, else with `main`. */
export async function resolveBase(
  root: string,
  requested: string | undefined,
): Promise<ChangeBase | null> {
  if (requested !== undefined) {
    const commit = await gitOrNull(root, ['merge-base', 'HEAD', requested]);
    if (commit === null) {
      throw new CliBoundaryError(
        'E_SHIP_CHECKS_BASE_INVALID',
        `The base "${requested}" has no merge base with HEAD.`,
        { recovery: 'Pass a branch, tag or commit that shares history with HEAD.' },
      );
    }
    return { ref: requested, commit: commit.trim() };
  }
  for (const ref of ['origin/HEAD', 'main']) {
    const commit = await gitOrNull(root, ['merge-base', 'HEAD', ref]);
    if (commit !== null) return { ref, commit: commit.trim() };
  }
  return null;
}

const STATUS: Readonly<Record<string, ChangedFileStatus>> = {
  A: 'added',
  C: 'added',
  M: 'modified',
  T: 'modified',
  D: 'deleted',
  R: 'renamed',
};

function parseNameStatus(output: string): ChangedFile[] {
  const fields = output.split('\0');
  const files: ChangedFile[] = [];
  for (let index = 0; index < fields.length; ) {
    const code = fields[index];
    if (!code) break;
    const letter = code[0] ?? '';
    if (letter === 'R' || letter === 'C') {
      files.push({ path: fields[index + 2] ?? '', status: STATUS[letter] ?? 'modified' });
      index += 3;
    } else {
      files.push({ path: fields[index + 1] ?? '', status: STATUS[letter] ?? 'modified' });
      index += 2;
    }
  }
  return files;
}

export type ChangeSet = {
  base: ChangeBase | null;
  files: ChangedFile[];
  diagnostics: ShipDiagnostic[];
};

/** Committed, staged, unstaged and untracked changes against the base. */
export async function readChangeSet(
  root: string,
  requestedBase: string | undefined,
): Promise<ChangeSet> {
  const base = await resolveBase(root, requestedBase);
  const diagnostics: ShipDiagnostic[] = [];
  const hasHead = (await gitOrNull(root, ['rev-parse', '--verify', 'HEAD'])) !== null;
  if (base === null) {
    diagnostics.push(
      diagnostic(
        'BASE_UNRESOLVED',
        'warning',
        'No merge base with origin/HEAD or main; only working-tree changes are counted. Pass --base to compare a branch.',
      ),
    );
  }
  const against = base?.commit ?? (hasHead ? 'HEAD' : null);
  const tracked =
    against === null
      ? []
      : parseNameStatus(await git(root, ['diff', '--name-status', '-z', '-M', against, '--']));
  const untracked = (await git(root, ['ls-files', '-z', '--others', '--exclude-standard']))
    .split('\0')
    .filter(Boolean)
    .map((path): ChangedFile => ({ path, status: 'untracked' }));
  const byPath = new Map<string, ChangedFile>();
  for (const file of [...tracked, ...untracked]) byPath.set(file.path, file);
  const files = [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
  return { base, files, diagnostics };
}

/** Added lines per file in the diff against the base, untracked files included whole. */
export async function readAddedLines(
  root: string,
  changes: ChangeSet,
  include: (path: string) => boolean,
  readUntracked: (path: string) => string | null,
): Promise<Map<string, string[]>> {
  const added = new Map<string, string[]>();
  const against =
    changes.base?.commit ??
    ((await gitOrNull(root, ['rev-parse', '--verify', 'HEAD'])) === null ? null : 'HEAD');
  if (against !== null) {
    const diff = await git(root, ['diff', '--no-color', '--no-ext-diff', '-U0', against, '--']);
    let current: string | null = null;
    for (const line of diff.split('\n')) {
      if (line.startsWith('+++ ')) {
        const path = line.slice(4);
        current = path.startsWith('b/') && include(path.slice(2)) ? path.slice(2) : null;
      } else if (current !== null && line.startsWith('+')) {
        const lines = added.get(current) ?? [];
        lines.push(line.slice(1));
        added.set(current, lines);
      }
    }
  }
  for (const file of changes.files) {
    if (file.status !== 'untracked' || !include(file.path)) continue;
    const text = readUntracked(file.path);
    if (text !== null) added.set(file.path, text.split('\n'));
  }
  return added;
}

/** A file's content at the base commit, or null when it did not exist there. */
export async function readAtBase(
  root: string,
  base: ChangeBase | null,
  path: string,
): Promise<string | null> {
  if (base === null) return null;
  return gitOrNull(root, ['show', `${base.commit}:${path}`]);
}

/** Tracked and untracked, non-ignored files. */
export async function listFiles(root: string): Promise<string[]> {
  return (await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']))
    .split('\0')
    .filter(Boolean);
}
