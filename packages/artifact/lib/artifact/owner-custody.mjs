import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { sha256Hex } from '@openplanr/protocol/canonical-json';
import { configuredPlanrHome } from './internal/planr-home.mjs';
import { acquireStartLock } from './internal/server-util.mjs';

function custodyError(message, code = 'E_OWNER_CUSTODY_LOCATION') {
  return Object.assign(new Error(message), { code, status: 400 });
}

export function ownerCustodyLocation({
  sourceRoot,
  sourceId,
  namespace,
  label = 'Owner',
  options = {},
  allowMissing = false,
}) {
  sourceRoot = realpathSync(resolve(sourceRoot));
  const env = options.env ?? process.env;
  const root = resolve(
    options.custodyRoot ??
      join(
        configuredPlanrHome(env) ?? join(realpathSync(env.HOME || homedir()), '.planr'),
        namespace,
      ),
  );
  let project = resolve(sourceRoot);
  for (let candidate = project; dirname(candidate) !== candidate; candidate = dirname(candidate)) {
    if (existsSync(join(candidate, '.git')) || existsSync(join(candidate, '.planr'))) {
      project = candidate;
      break;
    }
  }
  const path = join(root, `${sha256Hex(`${resolve(sourceRoot)}\n${sourceId}`)}.json`);
  const within = relative(project, root);
  if (
    (!allowMissing || existsSync(path)) &&
    (within === '' ||
      (!within.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
        within !== '..' &&
        !isAbsolute(within)))
  )
    throw custodyError(
      `${label} owner credentials must be stored outside the project. Set PLANR_HOME to a private user-level directory.`,
    );
  const legacyPath =
    !options.custodyRoot && !configuredPlanrHome(env)
      ? join(realpathSync(env.HOME || homedir()), '.openplanr', namespace, basename(path))
      : null;
  return { root, path, legacyPath };
}

export async function withOwnerCustody(location, { label = 'Owner', format }, action) {
  ensurePrivateDirectory(location.root, { label });
  const unlock = await acquireStartLock(`${location.path}.lock`);
  try {
    let record = readCustody(location.path, { label, format });
    if (!record && location.legacyPath && pathExists(location.legacyPath)) {
      // Check custody before creating a lock beside it, then check again while both locks are held.
      readCustody(location.legacyPath, { label, format });
      const legacyUnlock = await acquireStartLock(`${location.legacyPath}.lock`);
      try {
        const legacy = readCustody(location.legacyPath, { label, format });
        if (legacy && !pathExists(location.path)) {
          const temp = `${location.path}.${randomBytes(8).toString('hex')}.migration`;
          const fd = openSync(temp, 'wx', 0o600);
          try {
            writeFileSync(fd, `${JSON.stringify(legacy)}\n`);
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
          try {
            try {
              linkSync(temp, location.path);
            } catch (error) {
              if (error.code !== 'EEXIST') throw error;
            }
            const directory = openSync(location.root, 'r');
            try {
              fsyncSync(directory);
            } finally {
              closeSync(directory);
            }
          } finally {
            unlinkSync(temp);
          }
        }
        record = readCustody(location.path, { label, format });
      } finally {
        legacyUnlock();
      }
    }
    return await action({
      ...location,
      record,
      save(value = record) {
        record = value;
        writeCustody(location.path, value, { label });
      },
    });
  } finally {
    unlock();
  }
}

function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
function assertDirectoryAncestry(root, label) {
  for (let path = root; dirname(path) !== path; path = dirname(path)) {
    if (pathExists(path) && lstatSync(path).isSymbolicLink())
      throw custodyError(`${label} custody directory must not contain symbolic links.`);
  }
}
function assertPrivateFile(path, label) {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (process.platform !== 'win32' && (stat.mode & 0o077 || stat.uid !== process.getuid()))
  )
    throw custodyError(
      `${label} owner custody must be a private 0600 file.`,
      'E_OWNER_CUSTODY_INVALID',
    );
}
function physicalDirectoryPath(directory) {
  let existing = resolve(directory);
  const missing = [];
  while (!existsSync(existing) && dirname(existing) !== existing) {
    missing.unshift(basename(existing));
    existing = dirname(existing);
  }
  return join(realpathSync(existing), ...missing);
}
export function resolveRecoveryOutputPath(output) {
  const path = resolve(output);
  return join(physicalDirectoryPath(dirname(path)), basename(path));
}
function assertPrivateDirectory(root, label, recoveryOutput = false) {
  const stat = lstatSync(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (!recoveryOutput &&
      process.platform !== 'win32' &&
      (stat.mode & 0o077 || stat.uid !== process.getuid()))
  )
    throw custodyError(`${label} custody must use a private local directory.`);
}
export function ensurePrivateDirectory(root, { label = 'Owner', recoveryOutput = false } = {}) {
  if (recoveryOutput) root = physicalDirectoryPath(root);
  assertDirectoryAncestry(root, label);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  assertPrivateDirectory(root, label, recoveryOutput);
}
export function readCustody(path, { label = 'Owner', format, recoveryInput = false } = {}) {
  if (recoveryInput && existsSync(path)) {
    assertPrivateFile(path, label);
    path = realpathSync(path);
  }
  assertDirectoryAncestry(dirname(path), label);
  if (!pathExists(path)) return null;
  assertPrivateDirectory(dirname(path), label, recoveryInput);
  assertPrivateFile(path, label);
  let record;
  try {
    record = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw custodyError(`${label} owner custody is invalid.`, 'E_OWNER_CUSTODY_INVALID');
  }
  if (record?.kind !== format || record.schemaVersion !== '1.0.0' || !record.custody)
    throw custodyError(`${label} owner custody is invalid.`, 'E_OWNER_CUSTODY_INVALID');
  return record;
}
export function writeCustody(path, record, { label = 'Owner' } = {}) {
  assertDirectoryAncestry(dirname(path), label);
  assertPrivateDirectory(dirname(path), label);
  if (existsSync(path)) assertPrivateFile(path, label);
  const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(record)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temp, path);
    if (process.platform !== 'win32') {
      chmodSync(path, 0o600);
      const directory = openSync(dirname(path), 'r');
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    }
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {}
    throw error;
  }
}
