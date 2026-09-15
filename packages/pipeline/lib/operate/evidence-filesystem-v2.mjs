import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const LOCAL_FILESYSTEM_EVIDENCE_PROVIDER_ID_V2 = 'local-filesystem-evidence-provider';
export const LOCAL_FILESYSTEM_EVIDENCE_RESOLVER_ID_V2 = 'local-filesystem-evidence-resolver';
export const LOCAL_FILESYSTEM_EVIDENCE_CAPABILITY_V2 = 'evidence.filesystem.read';
export const DEFAULT_FILESYSTEM_EVIDENCE_MAX_BYTES_V2 = 262144;

const CLASSIFICATIONS = new Set(['public', 'internal', 'confidential', 'restricted']);
const PRIVATE_PATH_SEGMENTS = new Set([
  '.aws', '.azure', '.git', '.gnupg', '.gradle', '.kube', '.pnpm', '.ssh', '.venv', '.yarn',
  '__pycache__', 'bower_components', 'node_modules', 'pods', 'venv', 'vendor',
]);
const PRIVATE_OPERATE_DIRECTORIES = new Set(['archive', 'packets', 'state']);
const SECRET_FILE_PATTERNS = [
  /^\.env(?:\..+)?$/iu,
  /^(?:\.netrc|\.npmrc|\.pypirc)$/iu,
  /^(?:credentials?|secrets?)(?:\..+)?$/iu,
  /^id_(?:dsa|ecdsa|ed25519|rsa)(?:\..+)?$/iu,
  /\.(?:jks|key|keystore|p12|pfx|pem)$/iu,
];
const SECRET_PATTERNS = [
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/u,
  /(?:^|[^A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?:$|[^A-Za-z0-9])/u,
  /(?:^|[^A-Za-z0-9])(?:gho|ghp|ghr|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}(?:$|[^A-Za-z0-9])/u,
  /(?:^|[^A-Za-z0-9])AIza[0-9A-Za-z_-]{35}(?:$|[^A-Za-z0-9_-])/u,
  /(?:^|[^A-Za-z0-9])npm_[A-Za-z0-9]{36}(?:$|[^A-Za-z0-9])/u,
  /(?:^|[^A-Za-z0-9])sk_(?:live|test)_[A-Za-z0-9]{16,}(?:$|[^A-Za-z0-9])/u,
  /(?:^|[^A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{16,}(?:$|[^A-Za-z0-9-])/u,
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
        evidenceKind: 'filesystem',
        ...(candidate?.locator?.sourceRootId ? { sourceRootId: candidate.locator.sourceRootId } : {}),
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

function restrictedRepositoryPath(path) {
  const segments = path.split('/');
  const normalized = segments.map((segment) => segment.toLowerCase());
  if (normalized.some((segment) => PRIVATE_PATH_SEGMENTS.has(segment))) return 'SENSITIVITY_BLOCKED';
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] !== '.planr') continue;
    if (normalized[index + 1] === 'operate-v2' || normalized[index + 1] === 'operate-legacy') {
      return 'SENSITIVITY_BLOCKED';
    }
    if (normalized[index + 1] === 'operate' && PRIVATE_OPERATE_DIRECTORIES.has(normalized[index + 2])) {
      return 'SENSITIVITY_BLOCKED';
    }
  }
  const filename = segments.at(-1);
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(filename)) ? 'SECRET_DETECTED' : null;
}

function isContained(root, target) {
  const path = relative(root, target);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function configuredRoot(context, sourceRootId) {
  const roots = context?.filesystemRoots ?? context?.sources?.filesystem;
  if (!Array.isArray(roots)) return null;
  return roots.find((entry) => entry?.sourceRootId === sourceRootId) ?? null;
}

function configuredMaximum(source) {
  const maximum = source?.maxBytes ?? DEFAULT_FILESYSTEM_EVIDENCE_MAX_BYTES_V2;
  return Number.isSafeInteger(maximum) && maximum > 0 && maximum <= DEFAULT_FILESYSTEM_EVIDENCE_MAX_BYTES_V2 ? maximum : null;
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

function usableRoot(source) {
  if (!source || typeof source.rootPath !== 'string' || !existsSync(source.rootPath)) return null;
  try {
    if (lstatSync(source.rootPath).isSymbolicLink()) return null;
    return realpathSync(source.rootPath);
  } catch {
    return null;
  }
}

function containsSecret(bytes) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) return false;
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function readRegularFileNoFollow(candidate, maximum) {
  let descriptor;
  try {
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
    descriptor = openSync(candidate, flags);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maximum) return { error: 'SENSITIVITY_BLOCKED' };
    const bytes = readFileSync(descriptor);
    if (bytes.byteLength > maximum) return { error: 'SENSITIVITY_BLOCKED' };
    return { bytes };
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { error: 'PATH_NOT_FOUND' };
    return { error: 'SENSITIVITY_BLOCKED' };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function assertSelection(candidate, provider, resolver) {
  return candidate?.evidenceKind === 'filesystem'
    && provider?.providerId === LOCAL_FILESYSTEM_EVIDENCE_PROVIDER_ID_V2
    && resolver?.resolverId === LOCAL_FILESYSTEM_EVIDENCE_RESOLVER_ID_V2;
}

/**
 * Resolves only a registered, local, regular file beneath an explicit root.
 * It cannot read absolute paths, traverse, follow symlinks, execute content,
 * create durable records, or reach a connected source.
 */
export function resolveLocalFilesystemEvidenceV2(candidate, {
  provider,
  resolver,
  capabilities = [],
  ...context
} = {}) {
  if (!assertSelection(candidate, provider, resolver)) {
    return safeError(candidate, provider, resolver, 'UNSUPPORTED_EVIDENCE_KIND');
  }
  if (!hasCapability(capabilities, LOCAL_FILESYSTEM_EVIDENCE_CAPABILITY_V2)) {
    return safeError(candidate, provider, resolver, 'CAPABILITY_DENIED');
  }
  const locator = candidate.locator;
  if (!locator || typeof locator !== 'object' || typeof locator.sourceRootId !== 'string' || !safeRelativePath(locator.path)) {
    return safeError(candidate, provider, resolver, 'EVIDENCE_LOCATOR_INVALID');
  }
  const pathRestriction = restrictedRepositoryPath(locator.path);
  if (pathRestriction !== null) return safeError(candidate, provider, resolver, pathRestriction);
  const source = configuredRoot(context, locator.sourceRootId);
  const rootPath = usableRoot(source);
  if (rootPath === null) return safeError(candidate, provider, resolver, 'SOURCE_NOT_FOUND');
  const sourceContract = declaredSourceContract(source);
  if (sourceContract === null) return safeError(candidate, provider, resolver, 'EVIDENCE_LOCATOR_INVALID');
  const maximum = configuredMaximum(source);
  if (maximum === null) return safeError(candidate, provider, resolver, 'SENSITIVITY_BLOCKED');

  const candidatePath = resolve(rootPath, ...locator.path.split('/'));
  if (!isContained(rootPath, candidatePath)) return safeError(candidate, provider, resolver, 'EVIDENCE_LOCATOR_INVALID');
  try {
    if (!existsSync(candidatePath)) return safeError(candidate, provider, resolver, 'PATH_NOT_FOUND');
    if (lstatSync(candidatePath).isSymbolicLink()) return safeError(candidate, provider, resolver, 'SENSITIVITY_BLOCKED');
    const realCandidate = realpathSync(candidatePath);
    if (!isContained(rootPath, realCandidate)) return safeError(candidate, provider, resolver, 'SENSITIVITY_BLOCKED');
  } catch {
    return safeError(candidate, provider, resolver, 'PATH_NOT_FOUND');
  }
  const read = readRegularFileNoFollow(candidatePath, maximum);
  if (read.error) return safeError(candidate, provider, resolver, read.error);
  if (containsSecret(read.bytes)) return safeError(candidate, provider, resolver, 'SECRET_DETECTED');

  return freeze({
    status: 'resolved',
    provider,
    resolver,
    error: null,
    capture: {
      contentBase64: read.bytes.toString('base64'),
      rawHash: sha256(read.bytes),
      sizeBytes: read.bytes.byteLength,
      classification: sourceClassification(source),
      freshness: 'current',
      sourceContract,
      locator: { sourceRootId: locator.sourceRootId, path: locator.path },
      provenance: { sourceRootId: locator.sourceRootId, path: locator.path },
    },
  });
}

/** The registered provider and resolver share one bounded local capture path. */
export const resolveLocalFilesystemEvidenceProviderV2 = resolveLocalFilesystemEvidenceV2;
