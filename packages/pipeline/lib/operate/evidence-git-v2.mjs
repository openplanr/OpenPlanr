import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export const LOCAL_GIT_EVIDENCE_PROVIDER_ID_V2 = 'local-git-evidence-provider';
export const LOCAL_GIT_EVIDENCE_RESOLVER_ID_V2 = 'local-git-evidence-resolver';
export const LOCAL_GIT_EVIDENCE_CAPABILITY_V2 = 'evidence.git.read';
export const DEFAULT_GIT_EVIDENCE_MAX_BYTES_V2 = 262144;

const GIT_ENV = Object.freeze({
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  HOME: '/nonexistent',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_PAGER: 'cat',
  GIT_TERMINAL_PROMPT: '0',
  LC_ALL: 'C',
});

const SAFE_OBJECT_TYPES = new Set(['commit', 'tree', 'blob', 'tag']);
const CLASSIFICATIONS = new Set(['public', 'internal', 'confidential', 'restricted']);
const SECRET_PATTERNS = [
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/u,
  /(?:^|[^A-Za-z0-9])AKIA[0-9A-Z]{16}(?:$|[^A-Za-z0-9])/u,
  /(?:^|[^A-Za-z0-9])(?:ghp|github_pat)_[A-Za-z0-9_]{20,}(?:$|[^A-Za-z0-9])/u,
];

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function safeError(candidate, provider, resolver, code, context = {}) {
  return freeze({
    status: 'rejected',
    provider: provider ?? null,
    resolver: resolver ?? null,
    capture: null,
    error: {
      code,
      retryable: false,
      context: {
        evidenceKind: 'git',
        ...(candidate?.locator?.repositoryId ? { repositoryId: candidate.locator.repositoryId } : {}),
        ...(resolver?.resolverId ? { resolverId: resolver.resolverId } : {}),
        ...context,
      },
    },
  });
}

function hasCapability(capabilities, capability) {
  return Array.isArray(capabilities) && capabilities.includes(capability);
}

function safeRelativePath(path) {
  return typeof path === 'string'
    && path.length > 0
    && !isAbsolute(path)
    && !path.includes('\\')
    && path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function configuredRepository(context, repositoryId) {
  const repositories = context?.gitRepositories ?? context?.sources?.git;
  if (!Array.isArray(repositories)) return null;
  return repositories.find((entry) => entry?.repositoryId === repositoryId) ?? null;
}

function configuredMaximum(source) {
  const maximum = source?.maxBytes ?? DEFAULT_GIT_EVIDENCE_MAX_BYTES_V2;
  return Number.isSafeInteger(maximum) && maximum > 0 && maximum <= DEFAULT_GIT_EVIDENCE_MAX_BYTES_V2 ? maximum : null;
}

function sourceClassification(source) {
  return CLASSIFICATIONS.has(source?.classification) ? source.classification : 'internal';
}

function declaredSourceContract(source) {
  const value = source?.sourceContract;
  return value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.id === 'string' && typeof value.version === 'string'
    ? value
    : null;
}

function usableRepositoryRoot(source) {
  if (!source || typeof source.rootPath !== 'string' || !existsSync(source.rootPath)) return null;
  try {
    if (lstatSync(source.rootPath).isSymbolicLink()) return null;
    return realpathSync(source.rootPath);
  } catch {
    return null;
  }
}

/**
 * Runs a fixed local Git read command without a shell, user/system config,
 * pager, prompts, optional locks, hooks, or network-capable transport.
 */
function git(rootPath, args, { buffer = false } = {}) {
  const result = spawnSync('git', [
    '-c', 'core.fsmonitor=false',
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'credential.helper=',
    '-c', 'protocol.file.allow=never',
    '-C', rootPath,
    ...args,
  ], {
    encoding: buffer ? 'buffer' : 'utf8',
    env: GIT_ENV,
    maxBuffer: DEFAULT_GIT_EVIDENCE_MAX_BYTES_V2 + 4096,
    windowsHide: true,
  });
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    stdout: result.stdout ?? (buffer ? Buffer.alloc(0) : ''),
  };
}

function verifyObject(rootPath, expression) {
  const result = git(rootPath, ['rev-parse', '--verify', '--quiet', '--end-of-options', expression]);
  return result.ok ? result.stdout.trim() : null;
}

function objectType(rootPath, objectId) {
  const result = git(rootPath, ['cat-file', '-t', objectId]);
  return result.ok ? result.stdout.trim() : null;
}

function objectSize(rootPath, expression) {
  const result = git(rootPath, ['cat-file', '-s', expression]);
  if (!result.ok || !/^[0-9]+$/u.test(result.stdout.trim())) return null;
  const size = Number(result.stdout.trim());
  return Number.isSafeInteger(size) ? size : null;
}

function objectBytes(rootPath, type, expression) {
  const result = git(rootPath, ['cat-file', type, expression], { buffer: true });
  return result.ok ? Buffer.from(result.stdout) : null;
}

function worktreeState(rootPath) {
  const bare = git(rootPath, ['rev-parse', '--is-bare-repository']);
  if (!bare.ok) return 'unknown';
  if (bare.stdout.trim() === 'true') return 'bare';
  const status = git(rootPath, ['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none']);
  return status.ok && status.stdout.length === 0 ? 'clean' : 'dirty';
}

function isText(bytes) {
  const text = bytes.toString('utf8');
  return Buffer.from(text, 'utf8').equals(bytes);
}

function containsSecret(bytes) {
  if (!isText(bytes)) return false;
  const text = bytes.toString('utf8');
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function selectedLineBytes(bytes, lines) {
  if (!isText(bytes) || !Number.isInteger(lines?.start) || !Number.isInteger(lines?.end) || lines.start < 1 || lines.end < lines.start) {
    return null;
  }
  if (bytes.byteLength === 0) return null;
  const starts = [0];
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] === 0x0a && index + 1 < bytes.byteLength) starts.push(index + 1);
  }
  if (lines.end > starts.length) return null;
  const start = starts[lines.start - 1];
  const end = lines.end < starts.length ? starts[lines.end] : bytes.byteLength;
  return Buffer.from(bytes.subarray(start, end));
}

function resolvedFreshness(rootPath, revisionId, worktree) {
  if (worktree !== 'clean') return 'historical';
  return verifyObject(rootPath, 'HEAD^{object}') === revisionId ? 'current' : 'historical';
}

function assertSelection(candidate, provider, resolver) {
  return candidate?.evidenceKind === 'git'
    && provider?.providerId === LOCAL_GIT_EVIDENCE_PROVIDER_ID_V2
    && resolver?.resolverId === LOCAL_GIT_EVIDENCE_RESOLVER_ID_V2;
}

/**
 * Resolves a registered local Git source into an immutable, byte-exact capture.
 * It deliberately cannot create an Artifact, EvidenceRef, Event, graph edge,
 * or runtime state. Phase 4 materialization owns those durable effects.
 */
export function resolveLocalGitEvidenceV2(candidate, {
  provider,
  resolver,
  capabilities = [],
  ...context
} = {}) {
  if (!assertSelection(candidate, provider, resolver)) {
    return safeError(candidate, provider, resolver, 'UNSUPPORTED_EVIDENCE_KIND');
  }
  if (!hasCapability(capabilities, LOCAL_GIT_EVIDENCE_CAPABILITY_V2)) {
    return safeError(candidate, provider, resolver, 'CAPABILITY_DENIED');
  }
  const locator = candidate.locator;
  if (!locator || typeof locator !== 'object' || typeof locator.repositoryId !== 'string' || typeof locator.revision !== 'string'
    || (locator.path !== undefined && !safeRelativePath(locator.path))
    || (locator.lines !== undefined && !locator.path)
    || (locator.objectType !== undefined && !SAFE_OBJECT_TYPES.has(locator.objectType))) {
    return safeError(candidate, provider, resolver, 'EVIDENCE_LOCATOR_INVALID');
  }
  const source = configuredRepository(context, locator.repositoryId);
  const rootPath = usableRepositoryRoot(source);
  if (rootPath === null) return safeError(candidate, provider, resolver, 'SOURCE_NOT_FOUND');
  const sourceContract = declaredSourceContract(source);
  if (sourceContract === null) return safeError(candidate, provider, resolver, 'EVIDENCE_LOCATOR_INVALID');
  const maximum = configuredMaximum(source);
  if (maximum === null) return safeError(candidate, provider, resolver, 'SENSITIVITY_BLOCKED');
  if (!git(rootPath, ['rev-parse', '--git-dir']).ok) return safeError(candidate, provider, resolver, 'SOURCE_NOT_FOUND');

  const revisionId = verifyObject(rootPath, `${locator.revision}^{object}`);
  if (revisionId === null) return safeError(candidate, provider, resolver, 'REVISION_NOT_FOUND');
  const revisionType = objectType(rootPath, revisionId);
  if (revisionType === null) return safeError(candidate, provider, resolver, 'REVISION_NOT_FOUND');

  if (locator.ancestry) {
    if (typeof locator.ancestry.ancestorRevision !== 'string') {
      return safeError(candidate, provider, resolver, 'EVIDENCE_LOCATOR_INVALID');
    }
    const ancestorId = verifyObject(rootPath, `${locator.ancestry.ancestorRevision}^{commit}`);
    const descendantId = verifyObject(rootPath, `${revisionId}^{commit}`);
    if (ancestorId === null || descendantId === null) {
      return safeError(candidate, provider, resolver, ancestorId === null ? 'REVISION_NOT_FOUND' : 'OBJECT_TYPE_MISMATCH');
    }
    if (!git(rootPath, ['merge-base', '--is-ancestor', ancestorId, descendantId]).ok) {
      return safeError(candidate, provider, resolver, 'ANCESTRY_MISMATCH');
    }
  }

  let targetId = revisionId;
  let targetType = revisionType;
  let expression = revisionId;
  if (locator.path) {
    const treeId = verifyObject(rootPath, `${revisionId}^{tree}`);
    if (treeId === null) return safeError(candidate, provider, resolver, 'OBJECT_TYPE_MISMATCH');
    expression = `${treeId}:${locator.path}`;
    targetId = verifyObject(rootPath, expression);
    if (targetId === null) return safeError(candidate, provider, resolver, 'PATH_NOT_FOUND');
    targetType = objectType(rootPath, targetId);
    if (targetType === null) return safeError(candidate, provider, resolver, 'PATH_NOT_FOUND');
  }
  const expectedType = locator.objectType ?? (locator.path ? 'blob' : revisionType);
  if (targetType !== expectedType) return safeError(candidate, provider, resolver, 'OBJECT_TYPE_MISMATCH');
  if (locator.lines && targetType !== 'blob') return safeError(candidate, provider, resolver, 'OBJECT_TYPE_MISMATCH');

  const size = objectSize(rootPath, expression);
  if (size === null) return safeError(candidate, provider, resolver, locator.path ? 'PATH_NOT_FOUND' : 'REVISION_NOT_FOUND');
  if (size > maximum) return safeError(candidate, provider, resolver, 'SENSITIVITY_BLOCKED');
  const fullBytes = objectBytes(rootPath, targetType, expression);
  if (fullBytes === null || fullBytes.byteLength !== size) {
    return safeError(candidate, provider, resolver, locator.path ? 'PATH_NOT_FOUND' : 'REVISION_NOT_FOUND');
  }
  const bytes = locator.lines ? selectedLineBytes(fullBytes, locator.lines) : fullBytes;
  if (bytes === null) return safeError(candidate, provider, resolver, 'LINE_RANGE_INVALID');
  if (bytes.byteLength > maximum) return safeError(candidate, provider, resolver, 'SENSITIVITY_BLOCKED');
  if (containsSecret(bytes)) return safeError(candidate, provider, resolver, 'SECRET_DETECTED');

  const worktree = worktreeState(rootPath);
  const pinnedLocator = {
    repositoryId: locator.repositoryId,
    revision: revisionId,
    objectType: targetType,
    ...(locator.path ? { path: locator.path } : {}),
    ...(locator.lines ? { lines: { start: locator.lines.start, end: locator.lines.end } } : {}),
    ...(locator.ancestry ? {
      ancestry: { ancestorRevision: verifyObject(rootPath, `${locator.ancestry.ancestorRevision}^{commit}`) },
    } : {}),
  };
  return freeze({
    status: 'resolved',
    provider,
    resolver,
    error: null,
    capture: {
      contentBase64: bytes.toString('base64'),
      rawHash: sha256(bytes),
      sizeBytes: bytes.byteLength,
      classification: sourceClassification(source),
      freshness: resolvedFreshness(rootPath, revisionId, worktree),
      sourceContract,
      locator: pinnedLocator,
      provenance: {
        repositoryId: locator.repositoryId,
        revisionObjectId: revisionId,
        resolvedObjectId: targetId,
        resolvedObjectType: targetType,
        worktreeState: worktree,
      },
    },
  });
}

/** The registered provider and resolver share one bounded local capture path. */
export const resolveLocalGitEvidenceProviderV2 = resolveLocalGitEvidenceV2;
