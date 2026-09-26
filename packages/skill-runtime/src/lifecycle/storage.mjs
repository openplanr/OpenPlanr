import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { assertNonBlank } from './internal.mjs';

const MAX_STATE_BYTES = 64 * 1024;

function contained(root, candidate) {
  const within = relative(root, candidate);
  return within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within);
}

function relativeStatePath(path, label) {
  assertNonBlank(path, label);
  if (isAbsolute(path) || path.includes('\\')) {
    throw new TypeError(`${label} must be a portable project-relative path.`);
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new TypeError(`${label} contains an unsafe path segment.`);
  }
  return segments;
}

export function resolveProjectRoot(projectRoot) {
  assertNonBlank(projectRoot, 'projectRoot');
  const root = realpathSync(resolve(projectRoot));
  if (!lstatSync(root).isDirectory())
    throw new TypeError('projectRoot must resolve to a directory.');
  return root;
}

export function resolveStatePath(projectRoot, path, label = 'state path') {
  const root = resolveProjectRoot(projectRoot);
  const segments = relativeStatePath(path, label);
  const target = resolve(root, ...segments);
  if (!contained(root, target)) throw new TypeError(`${label} escapes projectRoot.`);

  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) break;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new TypeError(`${label} traverses a symbolic link.`);
  }
  return { root, target };
}

export function ensureStateDirectory(projectRoot, path) {
  const { root } = resolveStatePath(projectRoot, path, 'state directory');
  let current = root;
  for (const segment of relativeStatePath(path, 'state directory')) {
    current = resolve(current, segment);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new TypeError('state directory must contain only real directories.');
    }
    const canonical = realpathSync(current);
    if (!contained(root, canonical)) throw new TypeError('state directory escapes projectRoot.');
    current = canonical;
  }
  return current;
}

export function readStateJson(projectRoot, path) {
  const { target } = resolveStatePath(projectRoot, path);
  if (!existsSync(target)) return null;
  const stat = lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new TypeError(`${path} must be a regular state file.`);
  if (stat.size > MAX_STATE_BYTES)
    throw new RangeError(`${path} exceeds the 64 KiB lifecycle-state limit.`);
  return JSON.parse(readFileSync(target, 'utf8'));
}

export function writeStateJson(projectRoot, path, value) {
  const { target } = resolveStatePath(projectRoot, path);
  const parentPath = relative(resolveProjectRoot(projectRoot), dirname(target))
    .split(sep)
    .join('/');
  const parent = ensureStateDirectory(projectRoot, parentPath);
  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new TypeError(`${path} must be a regular state file.`);
  }

  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(bytes, 'utf8') > MAX_STATE_BYTES) {
    throw new RangeError(`${path} exceeds the 64 KiB lifecycle-state limit.`);
  }
  const temporary = resolve(parent, `.openplanr-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, bytes, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    renameSync(temporary, target);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
  return path;
}

export function listStateJson(projectRoot, directory) {
  const { target } = resolveStatePath(projectRoot, directory, 'state directory');
  if (!existsSync(target)) return [];
  const stat = lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new TypeError(`${directory} must be a real state directory.`);
  return readdirSync(target, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.json'))
    .map((entry) => `${directory}/${entry.name}`)
    .sort();
}

export function removeOwnedStateJson(projectRoot, path, owns) {
  const { target } = resolveStatePath(projectRoot, path);
  if (!existsSync(target)) return false;
  const stat = lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile()) return false;
  let document;
  try {
    document = readStateJson(projectRoot, path);
  } catch {
    return false;
  }
  if (!owns(document)) return false;
  unlinkSync(target);
  return true;
}
