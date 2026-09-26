import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { PipelineError } from './errors.mjs';

function fail(code, message) {
  throw new PipelineError(code, message);
}

export function closurePaths(featureRoot, runId, custodyRoot = undefined) {
  const shipRoot = join(featureRoot, '.ship');
  return {
    custodyRoot,
    featureRoot,
    shipRoot,
    activeDir: join(shipRoot, 'active'),
    receiptDir: join(shipRoot, 'receipts'),
    lockDir: join(shipRoot, 'locks'),
    active: join(shipRoot, 'active', `${runId}.json`),
    receipt: join(shipRoot, 'receipts', `${runId}.json`),
    lock: join(shipRoot, 'locks', `${runId}.lock`),
    featureLock: join(shipRoot, 'locks', 'feature-start.lock'),
    projectionLock: join(shipRoot, 'locks', 'compatibility-projection.lock'),
  };
}

export function assertPathCustody(
  custodyRoot,
  target,
  { allowMissing = false, expectedKind = undefined } = {},
) {
  if (typeof custodyRoot !== 'string' || !isAbsolute(resolve(custodyRoot)))
    fail('E_SHIP_STORAGE_UNSAFE', 'SHIP custody requires one trusted absolute project root.');
  const root = resolve(custodyRoot);
  const resolvedTarget = resolve(target);
  if (resolvedTarget !== root && !resolvedTarget.startsWith(`${root}${sep}`))
    fail('E_SHIP_STORAGE_UNSAFE', `SHIP custody target escapes its trusted root: ${target}`);
  const segments = relative(root, resolvedTarget).split(sep).filter(Boolean);
  let current = root;
  for (let index = -1; index < segments.length; index += 1) {
    if (index >= 0) current = join(current, segments[index]);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (allowMissing && error?.code === 'ENOENT') return null;
      throw error;
    }
    if (stat.isSymbolicLink())
      fail('E_SHIP_STORAGE_UNSAFE', `SHIP custody traverses a symlink: ${current}`);
    if (index < segments.length - 1 && !stat.isDirectory())
      fail('E_SHIP_STORAGE_UNSAFE', `SHIP custody ancestor is not a directory: ${current}`);
    if (index === segments.length - 1 && expectedKind === 'directory' && !stat.isDirectory())
      fail('E_SHIP_STORAGE_UNSAFE', `SHIP custody target is not a directory: ${current}`);
    if (index === segments.length - 1 && expectedKind === 'file' && !stat.isFile())
      fail('E_SHIP_STORAGE_UNSAFE', `SHIP custody target is not a regular file: ${current}`);
  }
  return lstatSync(resolvedTarget);
}

function ensureOwnedDirectory(path) {
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      fail('E_SHIP_STORAGE_UNSAFE', `SHIP storage component is not an owned directory: ${path}`);
    return;
  }
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      fail('E_SHIP_STORAGE_UNSAFE', `SHIP storage component is not an owned directory: ${path}`);
  }
}

export function ensureClosureDirs(paths) {
  if (paths.custodyRoot)
    assertPathCustody(paths.custodyRoot, paths.featureRoot, { expectedKind: 'directory' });
  const feature = lstatSync(paths.featureRoot);
  if (feature.isSymbolicLink() || !feature.isDirectory())
    fail('E_SHIP_STORAGE_UNSAFE', `Feature root is not a real directory: ${paths.featureRoot}`);
  ensureOwnedDirectory(paths.shipRoot);
  ensureOwnedDirectory(paths.activeDir);
  ensureOwnedDirectory(paths.receiptDir);
  ensureOwnedDirectory(paths.lockDir);
}

export function assertRegularCustodyFile(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile())
    fail('E_SHIP_STORAGE_UNSAFE', `SHIP custody file is not a regular file: ${path}`);
  return stat;
}

export function atomicWrite(path, bytes) {
  const parent = dirname(path);
  const parentStat = lstatSync(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory())
    fail('E_SHIP_STORAGE_UNSAFE', `SHIP write parent is unsafe: ${parent}`);
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, path);
    const directoryFd = openSync(parent, 'r');
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try {
      unlinkSync(temp);
    } catch (cleanupError) {
      if (cleanupError?.code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }
}

export function writeJson(path, value) {
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}

function processStartIdentity(pid) {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

function inspectProcess(pid) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error?.code === 'ESRCH') return { exists: false, processStart: null };
    return { exists: true, processStart: null };
  }
  return { exists: true, processStart: processStartIdentity(pid) };
}

function lockMetadata() {
  return {
    pid: process.pid,
    host: hostname(),
    processStart: processStartIdentity(process.pid),
    createdAt: new Date().toISOString(),
  };
}

function provablyStaleLock(path) {
  let bytes;
  let stat;
  try {
    stat = assertRegularCustodyFile(path);
    bytes = readFileSync(path, 'utf8');
  } catch {
    return false;
  }
  let metadata;
  try {
    metadata = JSON.parse(bytes);
  } catch {
    return false;
  }
  if (
    metadata?.host !== hostname() ||
    !Number.isSafeInteger(metadata.pid) ||
    metadata.pid < 1 ||
    typeof metadata.processStart !== 'string'
  )
    return false;
  const inspected = inspectProcess(metadata.pid);
  if (
    inspected.exists &&
    (inspected.processStart === null || inspected.processStart === metadata.processStart)
  )
    return false;
  const current = lstatSync(path);
  if (current.dev !== stat.dev || current.ino !== stat.ino || readFileSync(path, 'utf8') !== bytes)
    return false;
  return true;
}

function lockOwner(path) {
  let metadata;
  try {
    assertRegularCustodyFile(path);
    metadata = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  if (
    metadata?.host !== hostname() ||
    !Number.isSafeInteger(metadata.pid) ||
    metadata.pid < 1 ||
    typeof metadata.processStart !== 'string'
  )
    return null;
  const inspected = inspectProcess(metadata.pid);
  return inspected.exists &&
    inspected.processStart !== null &&
    inspected.processStart === metadata.processStart
    ? metadata
    : null;
}

export function lockIsProvablyLive(path) {
  return lockOwner(path) !== null;
}

function acquire(path) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const bytes = `${JSON.stringify(lockMetadata())}\n`;
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    let fd;
    try {
      fd = openSync(temp, 'wx', 0o600);
      try {
        writeSync(fd, bytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
        fd = undefined;
      }
      linkSync(temp, path);
      unlinkSync(temp);
      const stat = assertRegularCustodyFile(path);
      return { bytes, dev: stat.dev, ino: stat.ino };
    } catch (error) {
      if (fd !== undefined) closeSync(fd);
      try {
        unlinkSync(temp);
      } catch (cleanupError) {
        if (cleanupError?.code !== 'ENOENT') throw cleanupError;
      }
      if (error.code !== 'EEXIST') throw error;
      if (attempt === 0 && provablyStaleLock(path)) {
        unlinkSync(path);
        continue;
      }
      fail('E_SHIP_LOCKED', `SHIP closure has a live or unprovable lock: ${path}`);
    }
  }
}

export function withLock(path, fn) {
  const parent = dirname(path);
  const stat = lstatSync(parent);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    fail('E_SHIP_STORAGE_UNSAFE', `SHIP lock parent is unsafe: ${parent}`);
  const ownership = acquire(path);
  try {
    return fn();
  } finally {
    try {
      const current = assertRegularCustodyFile(path);
      if (
        current.dev !== ownership.dev ||
        current.ino !== ownership.ino ||
        readFileSync(path, 'utf8') !== ownership.bytes
      ) {
        fail('E_SHIP_LOCK_OWNERSHIP', `SHIP lock ownership changed before release: ${path}`);
      }
      unlinkSync(path);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}
