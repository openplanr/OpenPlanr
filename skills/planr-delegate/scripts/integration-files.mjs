import { execFile as execFileCallback } from 'node:child_process';
import { chmod, lstat, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { captureFileState, headFileState } from './custody.mjs';

const execFile = promisify(execFileCallback);
const gitOptions = { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 };

export class IntegrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IntegrationError';
    this.code = code;
    this.details = details;
  }
}

export function safePath(path) {
  if (
    typeof path !== 'string' ||
    !path ||
    path.includes('\\') ||
    path.includes('\0') ||
    isAbsolute(path) ||
    /^[A-Za-z]:/u.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new IntegrationError('E_INTEGRATION_PATH', 'A changed path must be repository-relative.');
  }
  return path;
}

export function covers(rule, path) {
  const normalized = safePath(rule.replace(/\/$/u, ''));
  return path === normalized || path.startsWith(`${normalized}/`);
}

export function sameState(left, right) {
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === 'absent') return true;
  if (left.mode !== right.mode) return false;
  if (left.kind === 'symlink') return left.target === right.target;
  return left.contentBase64 === right.contentBase64;
}

export async function git(cwd, ...args) {
  const { stdout } = await execFile('git', args, { ...gitOptions, cwd });
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
}

export async function safeDestination(root, path) {
  const full = resolve(root, safePath(path));
  if (!full.startsWith(`${resolve(root)}${sep}`))
    throw new IntegrationError('E_INTEGRATION_PATH', 'Destination escapes repository.');
  let parent = dirname(full);
  while (parent !== resolve(root)) {
    try {
      const info = await lstat(parent);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new IntegrationError(
          'E_INTEGRATION_PATH',
          'Destination parent is not a real directory.',
          { path },
        );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    parent = dirname(parent);
  }
  return full;
}

export async function putState(root, path, state, suffix, createdDirectories = []) {
  const target = await safeDestination(root, path);
  if (state.kind === 'absent') {
    await rm(target, { force: true });
    return;
  }
  const missing = [];
  let directory = dirname(target);
  while (directory !== resolve(root)) {
    try {
      await lstat(directory);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.push(directory);
      directory = dirname(directory);
    }
  }
  for (const created of missing.reverse()) {
    await mkdir(created);
    createdDirectories.push(created);
  }
  const temporary = `${target}.planr-delegate-${suffix}`;
  try {
    if (state.kind === 'file') {
      await writeFile(temporary, Buffer.from(state.contentBase64, 'base64'), {
        mode: 0o600,
        flag: 'wx',
      });
      await chmod(temporary, state.mode);
    } else if (state.kind === 'symlink') {
      if (
        isAbsolute(state.target) ||
        !resolve(dirname(target), state.target).startsWith(`${resolve(root)}${sep}`)
      )
        throw new IntegrationError('E_INTEGRATION_LINK', 'Delegate symlink target is unsafe.', {
          path,
        });
      await symlink(state.target, temporary);
    } else throw new IntegrationError('E_INTEGRATION_STATE', 'Unsupported file state.', { path });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function workingPaths(root) {
  const [tracked, untracked] = await Promise.all([
    git(root, 'diff', '--name-only', '-z', 'HEAD'),
    git(root, 'ls-files', '--others', '--exclude-standard', '-z'),
  ]);
  return [
    ...new Set(
      [...tracked.toString('utf8').split('\0'), ...untracked.toString('utf8').split('\0')]
        .filter(Boolean)
        .map(safePath),
    ),
  ].sort();
}

export async function workingSnapshot(root) {
  const paths = await workingPaths(root);
  const states = new Map();
  for (const path of paths) states.set(path, await captureFileState(root, path));
  return states;
}

export async function changedSinceSnapshot(root, before) {
  const candidates = new Set([...before.keys(), ...(await workingPaths(root))]);
  const changes = [];
  for (const path of candidates) {
    const prior = before.get(path) ?? (await headFileState(root, path, 'HEAD'));
    const after = await captureFileState(root, path);
    if (!sameState(prior, after)) changes.push({ path, before: prior, after });
  }
  return changes;
}

export async function assertSafeChanges(root, changes) {
  for (const change of changes) {
    await safeDestination(root, change.path);
    const target = change.after?.target;
    if (
      change.after.kind === 'symlink' &&
      (typeof target !== 'string' ||
        isAbsolute(target) ||
        target.includes('\\') ||
        !resolve(dirname(resolve(root, change.path)), target).startsWith(`${resolve(root)}${sep}`))
    )
      throw new IntegrationError('E_INTEGRATION_LINK', 'Delegate symlink target is unsafe.', {
        path: change.path,
      });
  }
}

export async function rollbackWritten(root, changes, suffix) {
  const errors = [];
  for (const change of [...changes].reverse()) {
    try {
      const current = await captureFileState(root, change.path);
      if (sameState(current, change.sourceBefore)) continue;
      if (!sameState(current, change.after)) {
        errors.push({ path: change.path, code: 'E_INTEGRATION_ROLLBACK_CONFLICT' });
        continue;
      }
      await putState(root, change.path, change.sourceBefore, suffix);
    } catch (error) {
      errors.push({ path: change.path, code: error.code ?? 'E_INTEGRATION_ROLLBACK' });
    }
  }
  return errors;
}
