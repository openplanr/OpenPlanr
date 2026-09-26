import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { sha256Jcs } from '../protocol/jcs.mjs';
import { PipelineError } from './errors.mjs';

function fail(code, message, fix = '', details = undefined) {
  throw new PipelineError(code, message, fix, details);
}

function digestBytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function posix(value) {
  return value.split('\\').join('/');
}

function compareCanonical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlanningArtifact(path) {
  const normalized = posix(path);
  if (
    !(normalized.startsWith('.planr/specs/') || normalized.startsWith('output/feats/')) ||
    !normalized.endsWith('.md')
  )
    return false;
  return /(?:^|\/)(?:T-|task-|US-|SPEC-|spec-)[^/]*\.md$/i.test(normalized);
}

function normalizePlanningProjectionBytes(path, bytes) {
  if (!isPlanningArtifact(path)) return Buffer.from(bytes);
  const lines = Buffer.from(bytes).toString('utf8').split(/\r?\n/);
  let definitionOfDone = false;
  const task = /(?:^|\/)(?:T-|task-)[^/]*\.md$/i.test(posix(path));
  for (let index = 0; index < lines.length; index += 1) {
    if (/^status:\s*/.test(lines[index])) lines[index] = 'status: "<runtime-projected>"';
    if (/^updated:\s*/.test(lines[index])) lines[index] = 'updated: "<runtime-projected>"';
    if (/^#{1,4}\s+/.test(lines[index]))
      definitionOfDone = task && /^#{2,4}\s+Definition of done\s*$/i.test(lines[index].trim());
    else if (definitionOfDone) lines[index] = lines[index].replace(/^(\s*-\s+)\[[ xX]\]/, '$1[_]');
  }
  return Buffer.from(lines.join('\n'), 'utf8');
}

function projectionOnlyPlanningChange(root, path, stat) {
  if (!isPlanningArtifact(path) || !stat.isFile()) return false;
  const head = spawnSync('git', ['show', `HEAD:${path}`], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (head.status !== 0) return false;
  const index = spawnSync('git', ['ls-tree', 'HEAD', '--', path], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const headMode = index.status === 0 ? index.stdout.trim().match(/^(\d+)\s/)?.[1] : null;
  const workingMode = stat.mode & 0o111 ? '100755' : '100644';
  return (
    headMode === workingMode &&
    normalizePlanningProjectionBytes(path, head.stdout).equals(
      normalizePlanningProjectionBytes(path, readFileSync(join(root, path))),
    )
  );
}

function lstatOrMissing(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function exactKeys(value, expected, subject) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail('E_SHIP_EVENT_INVALID', `${subject} must be a closed JSON object.`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    fail(
      'E_SHIP_EVENT_INVALID',
      `${subject} fields must be exactly: ${[...expected].sort().join(', ')}.`,
    );
  }
}

export function normalizeRepositoryPath(
  value,
  subject = 'repository path',
  { allowRoot = false } = {},
) {
  exactKeys(value, ['repositoryKey', 'path'], subject);
  if (!/^[a-z][a-z0-9-]*$/.test(value.repositoryKey))
    fail('E_SHIP_PATH_INVALID', `${subject} has an invalid repositoryKey.`);
  if (typeof value.path !== 'string' || value.path.length === 0 || isAbsolute(value.path))
    fail('E_SHIP_PATH_INVALID', `${subject} must use a non-empty repository-relative path.`);
  const path = posix(value.path).replace(/^\.\//, '').replace(/\/$/, '');
  if (
    !path ||
    (!allowRoot && path === '.') ||
    (path !== '.' && path.split('/').some((part) => part === '' || part === '.' || part === '..'))
  ) {
    fail('E_SHIP_PATH_INVALID', `${subject} contains traversal or an empty segment: ${value.path}`);
  }
  return { repositoryKey: value.repositoryKey, path };
}

export function repositoryMap(repositories, { requireRoots = true } = {}) {
  const map = new Map();
  for (const repository of repositories) {
    if (map.has(repository.repositoryKey))
      fail('E_SHIP_REPOSITORY_INVALID', `Duplicate repositoryKey ${repository.repositoryKey}.`);
    if (requireRoots && typeof repository.root !== 'string')
      fail(
        'E_SHIP_REPOSITORY_ROOT_MISSING',
        `Repository ${repository.repositoryKey} has no active local root.`,
      );
    map.set(repository.repositoryKey, repository);
  }
  return map;
}

export function containedPath(root, repositoryPath) {
  const target = resolve(root, repositoryPath);
  if (target !== root && !target.startsWith(`${root}${sep}`))
    fail('E_SHIP_PATH_INVALID', `Path escapes repository ${root}: ${repositoryPath}`);
  const segments = relative(root, target).split(sep).filter(Boolean);
  let ancestor = root;
  for (const segment of segments.slice(0, -1)) {
    ancestor = join(ancestor, segment);
    if (lstatOrMissing(ancestor)?.isSymbolicLink())
      fail('E_SHIP_SYMLINK_ESCAPE', `Path traverses a symlinked ancestor: ${repositoryPath}`);
  }
  return target;
}

function filesystemNode(root, repositoryPath) {
  const absolute = containedPath(root, repositoryPath);
  const stat = lstatOrMissing(absolute);
  if (stat === null)
    return { kind: 'missing', mode: null, contentDigest: null, symlinkTarget: null };
  const mode = stat.mode & 0o7777;
  if (stat.isSymbolicLink()) {
    const target = readlinkSync(absolute);
    return {
      kind: 'symlink',
      mode,
      contentDigest: digestBytes(Buffer.from(target, 'utf8')),
      symlinkTarget: target,
    };
  }
  if (stat.isFile())
    return {
      kind: 'file',
      mode,
      contentDigest: digestBytes(
        normalizePlanningProjectionBytes(repositoryPath, readFileSync(absolute)),
      ),
      symlinkTarget: null,
    };
  if (stat.isDirectory()) {
    const entries = readdirSync(absolute)
      .sort()
      .map((name) => ({ name, ...filesystemNode(root, posix(join(repositoryPath, name))) }));
    return { kind: 'directory', mode, contentDigest: sha256Jcs(entries), symlinkTarget: null };
  }
  fail('E_SHIP_PATH_INVALID', `Unsupported filesystem kind at ${repositoryPath}.`);
}

export function git(root, args, code = 'E_SHIP_REPOSITORY_INVALID') {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: args.includes('-z') ? 'buffer' : 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const detail =
      result.error?.message ??
      Buffer.from(result.stderr ?? '')
        .toString('utf8')
        .trim();
    fail(code, `Git repository inspection failed at ${root}: ${detail || `exit ${result.status}`}`);
  }
  return result.stdout;
}

export function repositoryHead(root) {
  return String(git(root, ['rev-parse', 'HEAD'])).trim();
}

const INTERNAL_CANDIDATE_NAMES = new Set([
  '.pipeline-shipped',
  '.run-manifest.jsonl',
  '.corrections.json',
  '.snapshot-pending',
  'qa-report.md',
]);

function isInternalCandidatePath(path) {
  const normalized = posix(path);
  const planningRuntimePath =
    normalized.startsWith('.planr/specs/') || normalized.startsWith('output/feats/');
  return (
    normalized === '.planr/provenance.jsonl' ||
    (planningRuntimePath &&
      (normalized.includes('/.ship/') || INTERNAL_CANDIDATE_NAMES.has(basename(normalized))))
  );
}

export function changedInventory(repository) {
  const fields = Buffer.from(
    git(repository.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  )
    .toString('utf8')
    .split('\0');
  const inventory = [];
  for (let index = 0; index < fields.length; ) {
    const field = fields[index++];
    if (!field) continue;
    const status = field.slice(0, 2);
    const path = posix(field.slice(3));
    let originalPath = null;
    if (status.includes('R') || status.includes('C')) originalPath = posix(fields[index++] ?? '');
    if (isInternalCandidatePath(path)) {
      if (status.includes('R') && originalPath && !isInternalCandidatePath(originalPath)) {
        inventory.push({
          repositoryKey: repository.repositoryKey,
          path: originalPath,
          changeType: 'deleted',
          kind: 'missing',
          mode: null,
          contentDigest: null,
          symlinkTarget: null,
          originalPath: null,
        });
      }
      continue;
    }
    const currentStat = lstatOrMissing(containedPath(repository.root, path));
    if (
      status.trim() === 'M' &&
      currentStat &&
      projectionOnlyPlanningChange(repository.root, path, currentStat)
    )
      continue;
    const node = filesystemNode(repository.root, path);
    const publicOriginalPath =
      status.includes('R') && originalPath && !isInternalCandidatePath(originalPath)
        ? originalPath
        : null;
    const changeType =
      status.includes('R') && publicOriginalPath
        ? 'renamed'
        : status.includes('D') || node.kind === 'missing'
          ? 'deleted'
          : status === '??' || status.includes('A') || originalPath
            ? 'added'
            : 'modified';
    inventory.push({
      repositoryKey: repository.repositoryKey,
      path,
      changeType,
      kind: node.kind,
      mode: node.mode,
      contentDigest: node.contentDigest,
      symlinkTarget: node.symlinkTarget,
      originalPath: publicOriginalPath,
    });
  }
  return inventory.sort((left, right) => compareCanonical(left.path, right.path));
}

export function filesystemIdentity(root, repositoryPath) {
  if (repositoryPath === '.')
    return sha256Jcs({
      head: repositoryHead(root),
      inventory: changedInventory({ repositoryKey: 'identity', root }),
    });
  return sha256Jcs(filesystemNode(root, repositoryPath));
}

export function captureCandidate(state, now) {
  const repositories = [];
  const inventory = [];
  for (const repository of [...state.repositories].sort((a, b) =>
    compareCanonical(a.repositoryKey, b.repositoryKey),
  )) {
    const head = repositoryHead(repository.root);
    if (head !== repository.head)
      fail(
        'E_SHIP_BASELINE_CHANGED',
        `Repository ${repository.repositoryKey} HEAD changed during SHIP.`,
      );
    const entries = changedInventory(repository);
    repositories.push({
      repositoryKey: repository.repositoryKey,
      head,
      baselineDigest: repository.baselineDigest,
      inventoryDigest: sha256Jcs(entries),
    });
    inventory.push(...entries);
  }
  inventory.sort(
    (left, right) =>
      compareCanonical(left.repositoryKey, right.repositoryKey) ||
      compareCanonical(left.path, right.path),
  );
  const revision = state.candidateRevisions.length + 1;
  const identity = { repositories, inventory };
  return { revision, ...identity, sealedAt: now, digest: sha256Jcs(identity) };
}

export function assertPreserve(state) {
  const repositories = repositoryMap(state.repositories);
  const changed = [];
  for (const task of state.tasks)
    for (const boundary of task.preserve) {
      const repository = repositories.get(boundary.repositoryKey);
      if (!repository)
        fail('E_SHIP_REPOSITORY_INVALID', `Unknown Preserve repository ${boundary.repositoryKey}.`);
      if (filesystemIdentity(repository.root, boundary.path) !== boundary.identity)
        changed.push({
          taskId: task.id,
          repositoryKey: boundary.repositoryKey,
          path: boundary.path,
        });
    }
  if (changed.length)
    fail(
      'E_PRESERVE_VIOLATION',
      `Structured Preserve custody changed: ${changed.map(({ repositoryKey, path }) => `${repositoryKey}:${path}`).join(', ')}`,
      'Restore the exact protected filesystem identities before continuing.',
      { changed },
    );
}

export function normalizeRepositories(projectRoot, supplied = undefined) {
  const records = supplied ?? [{ repositoryKey: 'project', root: projectRoot }];
  const normalized = records
    .map((record) => {
      exactKeys(record, ['repositoryKey', 'root'], 'repository descriptor');
      if (!/^[a-z][a-z0-9-]*$/.test(record.repositoryKey))
        fail('E_SHIP_REPOSITORY_INVALID', `Invalid repositoryKey ${record.repositoryKey}.`);
      const root = realpathSync(resolve(record.root));
      const top = String(git(root, ['rev-parse', '--show-toplevel'])).trim();
      if (realpathSync(resolve(top)) !== root)
        fail('E_SHIP_REPOSITORY_INVALID', `Repository root must be the Git top-level: ${root}`);
      return {
        repositoryKey: record.repositoryKey,
        root,
        head: repositoryHead(root),
        baselineDigest: sha256Jcs(changedInventory({ repositoryKey: record.repositoryKey, root })),
      };
    })
    .sort((left, right) => compareCanonical(left.repositoryKey, right.repositoryKey));
  repositoryMap(normalized);
  return normalized;
}

export function pathsIntersect(left, right) {
  return (
    left.repositoryKey === right.repositoryKey &&
    (left.path === '.' ||
      right.path === '.' ||
      left.path === right.path ||
      left.path.startsWith(`${right.path}/`) ||
      right.path.startsWith(`${left.path}/`))
  );
}

export function candidateCorrectionPaths(before, after) {
  const keyed = (candidate) =>
    new Map(candidate.inventory.map((entry) => [`${entry.repositoryKey}\0${entry.path}`, entry]));
  const left = keyed(before);
  const right = keyed(after);
  const changed = [...new Set([...left.keys(), ...right.keys()])].sort().flatMap((key) => {
    if (sha256Jcs(left.get(key) ?? null) === sha256Jcs(right.get(key) ?? null)) return [];
    const [repositoryKey, path] = key.split('\0');
    const records = [{ repositoryKey, path }];
    for (const entry of [left.get(key), right.get(key)]) {
      if (entry?.originalPath)
        records.push({ repositoryKey: entry.repositoryKey, path: entry.originalPath });
    }
    return records;
  });
  return [
    ...new Map(changed.map((entry) => [`${entry.repositoryKey}\0${entry.path}`, entry])).values(),
  ];
}

export function taskRepositoryPath(task, repositories) {
  const absolute = realpathSync(resolve(task.path));
  const matches = repositories.filter(
    ({ root }) => absolute === root || absolute.startsWith(`${root}${sep}`),
  );
  if (matches.length !== 1)
    fail(
      'E_SHIP_REPOSITORY_INVALID',
      `Task ${task.id} is not owned by exactly one declared repository.`,
    );
  return {
    repositoryKey: matches[0].repositoryKey,
    path: posix(relative(matches[0].root, absolute)),
  };
}
