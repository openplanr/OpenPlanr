import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { sha256Jcs } from '../protocol/jcs.mjs';
import { PipelineError } from './errors.mjs';
import { assertInvestigationScope } from './investigation-contracts.mjs';

function fail(code, message) {
  throw new PipelineError(code, message);
}
function bytesDigest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
function posix(value) {
  return value.split(sep).join('/');
}

function trustedRoot(repositoryRoots, repositoryKey) {
  const root = repositoryRoots?.[repositoryKey];
  if (typeof root !== 'string' || !isAbsolute(root) || !existsSync(root))
    fail(
      'E_INVESTIGATION_SCOPE_INVALID',
      `No trusted repository root exists for ${repositoryKey}.`,
    );
  const stat = lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    fail(
      'E_INVESTIGATION_SCOPE_INVALID',
      `Repository root ${repositoryKey} is not a real directory.`,
    );
  return resolve(root);
}

function assertContained(root, target) {
  const resolved = resolve(target);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`))
    fail(
      'E_INVESTIGATION_SCOPE_INVALID',
      'Investigation scope escapes its trusted repository root.',
    );
  let current = root;
  const parts = relative(root, resolved).split(sep).filter(Boolean);
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = join(current, parts[index]);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      fail(
        'E_INVESTIGATION_SCOPE_INVALID',
        'Investigation scope traverses an unsafe filesystem node.',
      );
  }
  return resolved;
}

function entry(repositoryKey, root, absolute) {
  const stat = lstatSync(absolute);
  const path = posix(relative(root, absolute)) || '.';
  const base = { repositoryKey, path, mode: stat.mode & 0o777 };
  if (stat.isSymbolicLink())
    return { ...base, type: 'symlink', targetDigest: bytesDigest(readlinkSync(absolute)) };
  if (stat.isFile())
    return { ...base, type: 'file', contentDigest: bytesDigest(readFileSync(absolute)) };
  if (stat.isDirectory()) return { ...base, type: 'directory' };
  fail(
    'E_INVESTIGATION_SCOPE_INVALID',
    `Investigation target ${repositoryKey}:${path} is not a regular file, directory, or symlink.`,
  );
}

function inventory(repositoryKey, root, absolute, output) {
  if (!existsSync(absolute)) {
    output.push({ repositoryKey, path: posix(relative(root, absolute)) || '.', type: 'missing' });
    return;
  }
  const current = entry(repositoryKey, root, absolute);
  output.push(current);
  if (current.type !== 'directory') return;
  for (const child of readdirSync(absolute, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    inventory(repositoryKey, root, join(absolute, child.name), output);
  }
}

export function captureInvestigationBaseline({ repositoryRoots, scope } = {}) {
  const canonicalScope = assertInvestigationScope(scope);
  const entries = [];
  for (const boundary of canonicalScope) {
    const root = trustedRoot(repositoryRoots, boundary.repositoryKey);
    inventory(
      boundary.repositoryKey,
      root,
      assertContained(root, join(root, boundary.path)),
      entries,
    );
  }
  entries.sort(
    (a, b) =>
      a.repositoryKey.localeCompare(b.repositoryKey) ||
      a.path.localeCompare(b.path) ||
      a.type.localeCompare(b.type),
  );
  const duplicate = entries.find(
    (value, index) =>
      index > 0 &&
      value.repositoryKey === entries[index - 1].repositoryKey &&
      value.path === entries[index - 1].path,
  );
  if (duplicate)
    fail(
      'E_INVESTIGATION_SCOPE_INVALID',
      `Overlapping scope duplicates ${duplicate.repositoryKey}:${duplicate.path}.`,
    );
  const baseline = {
    kind: 'investigation-baseline',
    schemaVersion: '1.0.0',
    scope: structuredClone(canonicalScope),
    entries,
  };
  return { ...baseline, digest: sha256Jcs(baseline) };
}

function entryIdentity(value) {
  return `${value.repositoryKey}\0${value.path}`;
}

export function diffInvestigationBaselines(before, after) {
  const left = new Map(before.entries.map((value) => [entryIdentity(value), value]));
  const right = new Map(after.entries.map((value) => [entryIdentity(value), value]));
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  return keys.flatMap((key) => {
    const prior = left.get(key);
    const next = right.get(key);
    if (JSON.stringify(prior) === JSON.stringify(next)) return [];
    const source = next ?? prior;
    return [
      {
        repositoryKey: source.repositoryKey,
        path: source.path,
        changeType:
          prior === undefined
            ? 'add'
            : next === undefined
              ? 'delete'
              : prior.type !== next.type
                ? 'replace'
                : 'modify',
      },
    ];
  });
}

export function scopeContains(scope, target) {
  return scope.some(
    (boundary) =>
      boundary.repositoryKey === target.repositoryKey &&
      (boundary.path === '.' ||
        target.path === boundary.path ||
        target.path.startsWith(`${boundary.path}/`)),
  );
}
