import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

import { freezeJson } from './internal.mjs';
import { ensureStateDirectory, resolveProjectRoot, resolveStatePath } from './storage.mjs';

export const LIFECYCLE_RUNTIME_DIRECTORY = '.planr/runtime';
export const LIFECYCLE_SESSION_DIRECTORY = '.planr/runtime/skill-sessions';
export const LIFECYCLE_IGNORE_RULE = '.planr/runtime/';

const IGNORE_PROBE = '.planr/runtime/.openplanr-ignore-probe';

function git(root, arguments_, stdio = 'pipe') {
  return spawnSync('git', ['-C', root, ...arguments_], {
    encoding: 'utf8',
    stdio,
  });
}

function isRepository(root) {
  const result = git(root, ['rev-parse', '--is-inside-work-tree']);
  return result.status === 0 && result.stdout.trim() === 'true';
}

function isIgnored(root) {
  return git(root, ['check-ignore', '--quiet', '--no-index', IGNORE_PROBE], 'ignore').status === 0;
}

function contained(root, candidate) {
  const within = relative(root, candidate);
  return within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within);
}

function resolveGitDirectory(root, argument) {
  const result = git(root, ['rev-parse', argument]);
  if (result.status !== 0 || result.stdout.trim().length === 0) {
    throw new TypeError(`Git could not resolve ${argument}.`);
  }
  const path = result.stdout.trim();
  return realpathSync(isAbsolute(path) ? path : resolve(root, path));
}

function ensureIgnoreRule(root) {
  if (isIgnored(root)) return true;

  const gitDirectory = resolveGitDirectory(root, '--absolute-git-dir');
  const commonDirectory = resolveGitDirectory(root, '--git-common-dir');
  const result = git(root, ['rev-parse', '--git-path', 'info/exclude']);
  if (result.status !== 0 || result.stdout.trim().length === 0) {
    throw new TypeError('Git could not resolve its local exclude file.');
  }
  const rawExclude = result.stdout.trim();
  const exclude = resolve(root, rawExclude);
  if (!contained(gitDirectory, exclude) && !contained(commonDirectory, exclude)) {
    throw new TypeError('Git resolved an exclude file outside the repository metadata directory.');
  }

  const info = resolve(exclude, '..');
  if (!existsSync(info)) mkdirSync(info, { mode: 0o700 });
  const infoStat = lstatSync(info);
  if (infoStat.isSymbolicLink() || !infoStat.isDirectory()) {
    throw new TypeError('Git info directory must be a real directory.');
  }
  if (existsSync(exclude)) {
    const stat = lstatSync(exclude);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new TypeError('Git exclude path must be a regular file.');
  }
  const existing = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  if (existing.split(/\r?\n/u).includes(LIFECYCLE_IGNORE_RULE)) {
    return isIgnored(root);
  }
  const prefix = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  appendFileSync(exclude, `${prefix}${LIFECYCLE_IGNORE_RULE}\n`, { encoding: 'utf8', mode: 0o600 });
  return isIgnored(root);
}

/** Inspect repository-local lifecycle support without changing the project. */
export function detectLifecycleEnvironment({ projectRoot } = {}) {
  const root = resolveProjectRoot(projectRoot);
  const repository = isRepository(root);
  const { target } = resolveStatePath(root, LIFECYCLE_RUNTIME_DIRECTORY, 'lifecycle runtime directory');
  const stateExists = existsSync(target);
  if (stateExists) {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new TypeError('Lifecycle runtime directory must be a real directory.');
    }
  }
  return freezeJson({
    projectRoot: root,
    repository,
    runtimePath: LIFECYCLE_RUNTIME_DIRECTORY,
    runtimeIgnored: repository ? isIgnored(root) : true,
    stateExists,
    nodeMajor: Number(process.versions.node.split('.')[0]),
  });
}

/** Prepare one ignored project-local state directory, or continue without persistence. */
export function prepareLifecycleEnvironment({ projectRoot } = {}) {
  let detected;
  try {
    detected = detectLifecycleEnvironment({ projectRoot });
    const runtimeIgnored = detected.repository ? ensureIgnoreRule(detected.projectRoot) : true;
    if (!runtimeIgnored) throw new TypeError('Project-local lifecycle state is not ignored by Git.');
    ensureStateDirectory(detected.projectRoot, LIFECYCLE_SESSION_DIRECTORY);
    return freezeJson({
      status: 'completed',
      ...detected,
      runtimeIgnored,
      stateAvailable: true,
      firstRun: !detected.stateExists,
      notice: !detected.stateExists
        ? 'Prepared quiet project-local skill state.'
        : 'Project-local skill state is available.',
    });
  } catch (error) {
    const root = detected?.projectRoot ?? resolveProjectRoot(projectRoot);
    return freezeJson({
      status: 'partial',
      projectRoot: root,
      repository: detected?.repository ?? isRepository(root),
      runtimePath: LIFECYCLE_RUNTIME_DIRECTORY,
      runtimeIgnored: false,
      stateExists: detected?.stateExists ?? false,
      stateAvailable: false,
      firstRun: true,
      nodeMajor: Number(process.versions.node.split('.')[0]),
      notice: 'Continued without persisted skill state because a safe ignored path was unavailable.',
      issue: error instanceof Error ? error.message : String(error),
    });
  }
}
