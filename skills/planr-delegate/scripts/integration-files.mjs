import { execFile as execFileCallback } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  linkSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { chmod, lstat, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { captureFileState, gitFileState, headFileState } from './custody.mjs';

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

export function retainedEntryState(file) {
  try {
    const info = lstatSync(file);
    if (info.isSymbolicLink())
      return { kind: 'symlink', mode: info.mode & 0o777, target: readlinkSync(file) };
    if (!info.isFile())
      throw new IntegrationError('E_INTEGRATION_STATE', 'Destination is not a file.', {
        path: file,
      });
    return {
      kind: 'file',
      mode: info.mode & 0o777,
      contentBase64: readFileSync(file).toString('base64'),
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { kind: 'absent' };
    throw error;
  }
}

const LOCAL_CUSTODY = '.planr-delegate-write-custody';

async function privateDirectory(path, create = true) {
  if (create)
    await mkdir(path, { mode: 0o700 }).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new IntegrationError(
      'E_INTEGRATION_CUSTODY',
      'Write custody is not a private directory.',
    );
}

// Git metadata can be on another volume. Keep claims and staging beside the
// destination in that case, and save the location before the first source write.
async function writeCustody(root, target, suffix, create = true) {
  if (basename(safePath(suffix)) !== suffix)
    throw new IntegrationError('E_INTEGRATION_CUSTODY', 'Invalid write custody identifier.');
  const gitDirectory = (await git(root, 'rev-parse', '--absolute-git-dir')).toString('utf8').trim();
  const base = resolve(gitDirectory, 'planr-delegate-write-custody');
  const metadata = resolve(base, suffix);
  for (const directory of [base, metadata]) {
    try {
      await privateDirectory(directory, false);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const reference = resolve(metadata, 'location.json');
  let location;
  try {
    location = JSON.parse(await readFile(reference, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (location) {
    const directory = await safeDestination(root, location.path);
    const anchor = dirname(dirname(directory));
    if (
      basename(directory) !== suffix ||
      basename(dirname(directory)) !== LOCAL_CUSTODY ||
      !target.startsWith(`${anchor}${sep}`)
    )
      throw new IntegrationError('E_INTEGRATION_CUSTODY', 'Write custody location changed.');
    await privateDirectory(dirname(directory), false);
    await privateDirectory(directory, false);
    return directory;
  }
  if (!create) return metadata;
  await privateDirectory(base);
  await privateDirectory(metadata);
  let anchor = dirname(target);
  let info;
  for (;;) {
    try {
      info = await lstat(anchor);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      anchor = dirname(anchor);
    }
  }
  if (info.dev === (await lstat(gitDirectory)).dev) return metadata;
  const local = resolve(anchor, LOCAL_CUSTODY);
  await privateDirectory(local);
  const ignore = resolve(local, '.gitignore');
  try {
    await writeFile(ignore, '*\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST' || (await readFile(ignore, 'utf8')) !== '*\n') throw error;
  }
  const directory = resolve(local, suffix);
  await privateDirectory(directory);
  await writeFile(reference, JSON.stringify({ path: relative(root, directory) }), {
    flag: 'wx',
    mode: 0o600,
  });
  return directory;
}

function parentEntries(root, target) {
  const entries = [];
  for (let path = dirname(target); ; path = dirname(path)) {
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new IntegrationError(
        'E_INTEGRATION_PATH',
        'Destination parent is not a real directory.',
      );
    entries.push({ path, dev: info.dev, ino: info.ino });
    if (path === resolve(root)) return entries;
  }
}

function assertParentEntries(entries) {
  for (const entry of entries) {
    const info = lstatSync(entry.path);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.dev !== entry.dev ||
      info.ino !== entry.ino
    )
      throw new IntegrationError(
        'E_INTEGRATION_SOURCE_DRIFT',
        'Destination parent changed during integration.',
        { path: entry.path },
      );
  }
}

// Claim the current directory entry, inspect the claimed bytes, then publish with
// exclusive link creation. A concurrent replacement is never overwritten. Claimed
// entries remain private for crash recovery and for writers holding the old inode.
export async function putStateGuarded(
  root,
  path,
  state,
  expected,
  suffix,
  createdDirectories = [],
) {
  const target = await safeDestination(root, path);
  const custody = await writeCustody(root, target, suffix);
  const key = createHash('sha256').update(path).digest('hex');
  const claimed = resolve(custody, `${key}.before`);
  const staged = `${key}.after-${randomUUID()}`;
  await assertSafeChanges(root, [{ path, after: state }]);
  if (state.kind === 'file') {
    await writeFile(resolve(custody, staged), Buffer.from(state.contentBase64, 'base64'), {
      flag: 'wx',
      mode: 0o600,
    });
    await chmod(resolve(custody, staged), state.mode);
  } else if (state.kind === 'symlink') await symlink(state.target, resolve(custody, staged));
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
  const parents = parentEntries(root, target);
  let moved = false;
  let published = false;
  try {
    if (expected.kind !== 'absent') {
      try {
        if (retainedEntryState(claimed).kind === 'absent') renameSync(target, claimed);
        moved = true;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (!moved || !sameState(retainedEntryState(claimed), expected))
        throw new IntegrationError(
          'E_INTEGRATION_SOURCE_DRIFT',
          'Destination changed before its write was claimed.',
          { path, retainedPath: moved ? claimed : null },
        );
    }
    assertParentEntries(parents);
    // link is atomic and fails if an editor created a replacement during the claim.
    if (state.kind !== 'absent') {
      if (state.kind === 'symlink') symlinkSync(state.target, target);
      else linkSync(resolve(custody, staged), target);
      published = true;
    } else if (retainedEntryState(target).kind !== 'absent')
      throw new IntegrationError(
        'E_INTEGRATION_SOURCE_DRIFT',
        'A concurrent replacement blocks deletion.',
        { path, retainedPath: claimed },
      );
    assertParentEntries(parents);
    if (moved && !sameState(retainedEntryState(claimed), expected))
      throw new IntegrationError(
        'E_INTEGRATION_SOURCE_DRIFT',
        'A writer changed the claimed original; retained for recovery.',
        { path, retainedPath: claimed },
      );
    return moved ? claimed : null;
  } catch (error) {
    if (published)
      error.details = { ...error.details, published: true, path, retainedPath: claimed };
    if (moved) {
      // Restore exclusively: an owner's replacement always takes precedence.
      try {
        assertParentEntries(parents);
        const original = retainedEntryState(claimed);
        if (original.kind === 'symlink') symlinkSync(original.target, target);
        else linkSync(claimed, target);
      } catch (restoreError) {
        if (restoreError.code !== 'EEXIST')
          error.details = { ...error.details, restoreCode: restoreError.code };
      }
    }
    if (error.code === 'EEXIST')
      throw new IntegrationError(
        'E_INTEGRATION_SOURCE_DRIFT',
        'A concurrent destination was preserved.',
        { path, retainedPath: moved ? claimed : null },
      );
    throw error;
  } finally {
    if (state.kind !== 'absent') {
      try {
        unlinkSync(resolve(custody, staged));
      } catch (error) {
        // Staging is private and recoverable; cleanup failure must not replace a write conflict.
        if (error.code !== 'ENOENT')
          process.emitWarning(`Private write staging cleanup failed: ${error.code}`);
      }
    }
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
      let claimed;
      if (change.writeId) {
        const target = await safeDestination(root, change.path);
        const directory = await writeCustody(root, target, change.writeId, false);
        const file = `${createHash('sha256').update(change.path).digest('hex')}.before`;
        claimed = retainedEntryState(resolve(directory, file));
        if (claimed.kind !== 'absent' && !sameState(claimed, change.sourceBefore)) {
          errors.push({
            path: change.path,
            retainedPath: resolve(directory, file),
            code: 'E_INTEGRATION_ROLLBACK_CONFLICT',
          });
          continue;
        }
      }
      if (
        current.kind === 'absent' &&
        claimed?.kind !== 'absent' &&
        claimed &&
        sameState(claimed, change.sourceBefore)
      ) {
        await putStateGuarded(
          root,
          change.path,
          change.sourceBefore,
          current,
          `${suffix}-interrupted`,
        );
        continue;
      }
      if (!sameState(current, change.after)) {
        errors.push({ path: change.path, code: 'E_INTEGRATION_ROLLBACK_CONFLICT' });
        continue;
      }
      await putStateGuarded(
        root,
        change.path,
        change.sourceBefore,
        change.after,
        change.writeId ? `${change.writeId}-rollback` : `${suffix}-rollback`,
      );
    } catch (error) {
      errors.push({ path: change.path, code: error.code ?? 'E_INTEGRATION_ROLLBACK' });
    }
  }
  return errors;
}

export async function treeIdentity(root, overrides = new Map()) {
  const paths = new Set(
    (await git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'))
      .toString('utf8')
      .split('\0')
      .filter(Boolean),
  );
  for (const path of overrides.keys()) paths.add(path);
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) {
    const state = overrides.get(path) ?? (await captureFileState(root, safePath(path)));
    const logical = await gitFileState(root, path, state);
    if (logical.kind !== 'absent')
      hash.update(path).update('\0').update(JSON.stringify(logical)).update('\0');
  }
  return hash.digest('hex');
}
