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

export const LOCAL_PLANR_EVIDENCE_PROVIDER_ID_V2 = 'local-planr-evidence-provider';
export const LOCAL_PLANR_EVIDENCE_RESOLVER_ID_V2 = 'local-planr-evidence-resolver';
export const LOCAL_PLANR_EVIDENCE_CAPABILITY_V2 = 'evidence.planr.read';
export const DEFAULT_PLANR_EVIDENCE_MAX_BYTES_V2 = 262144;

const CLASSIFICATIONS = new Set(['public', 'internal', 'confidential', 'restricted']);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
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
        evidenceKind: 'planr',
        ...(candidate?.locator?.projectId ? { projectId: candidate.locator.projectId } : {}),
        ...(resolver?.resolverId ? { resolverId: resolver.resolverId } : {}),
        ...context,
      },
    },
  });
}

function hasCapability(capabilities, capability) {
  return Array.isArray(capabilities) && capabilities.includes(capability);
}

function safePlanrPath(path) {
  return (
    typeof path === 'string' &&
    path.startsWith('.planr/') &&
    path.length > '.planr/'.length &&
    !isAbsolute(path) &&
    !path.includes('\\') &&
    path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  );
}

function isContained(root, target) {
  const path = relative(root, target);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function configuredProject(context, projectId) {
  const projects = context?.planrProjects ?? context?.sources?.planr;
  if (!Array.isArray(projects)) return null;
  return projects.find((entry) => entry?.projectId === projectId) ?? null;
}

function scopeMatches(candidate, project) {
  const scope = project?.scope;
  return (
    scope &&
    candidate.scopeId === scope.scopeId &&
    candidate.domainId === scope.domainId &&
    candidate.domainVersion === scope.domainVersion
  );
}

function configuredMaximum(project) {
  const maximum = project?.maxBytes ?? DEFAULT_PLANR_EVIDENCE_MAX_BYTES_V2;
  return Number.isSafeInteger(maximum) &&
    maximum > 0 &&
    maximum <= DEFAULT_PLANR_EVIDENCE_MAX_BYTES_V2
    ? maximum
    : null;
}

function classificationFor(project, artifact) {
  if (CLASSIFICATIONS.has(artifact?.classification)) return artifact.classification;
  return CLASSIFICATIONS.has(project?.classification) ? project.classification : 'internal';
}

function declaredSourceContract(project, artifact) {
  const value = artifact?.sourceContract ?? project?.sourceContract;
  return value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.id === 'string' &&
    typeof value.version === 'string'
    ? value
    : null;
}

function usableProjectRoot(project) {
  if (!project || typeof project.rootPath !== 'string' || !existsSync(project.rootPath))
    return null;
  try {
    if (lstatSync(project.rootPath).isSymbolicLink()) return null;
    return realpathSync(project.rootPath);
  } catch {
    return null;
  }
}

function declaredArtifact(project, locator) {
  if (!Array.isArray(project?.artifacts)) return null;
  return project.artifacts.find((artifact) => artifact?.artifactId === locator.artifactId) ?? null;
}

function validDeclaredArtifact(artifact) {
  return (
    artifact &&
    typeof artifact.artifactId === 'string' &&
    typeof artifact.artifactType === 'string' &&
    safePlanrPath(artifact.path) &&
    typeof artifact.contentHash === 'string' &&
    DIGEST.test(artifact.contentHash)
  );
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
  return (
    candidate?.evidenceKind === 'planr' &&
    provider?.providerId === LOCAL_PLANR_EVIDENCE_PROVIDER_ID_V2 &&
    resolver?.resolverId === LOCAL_PLANR_EVIDENCE_RESOLVER_ID_V2
  );
}

/**
 * Resolves an explicitly declared Planr artifact under Planr identity and
 * hash semantics. It only reads a non-symlink regular file below the supplied
 * project root; it never asks Git whether the artifact is tracked.
 */
export function resolveLocalPlanrEvidenceV2(
  candidate,
  { provider, resolver, capabilities = [], ...context } = {},
) {
  if (!assertSelection(candidate, provider, resolver)) {
    return safeError(candidate, provider, resolver, 'UNSUPPORTED_EVIDENCE_KIND');
  }
  if (!hasCapability(capabilities, LOCAL_PLANR_EVIDENCE_CAPABILITY_V2)) {
    return safeError(candidate, provider, resolver, 'CAPABILITY_DENIED');
  }
  const locator = candidate.locator;
  if (
    !locator ||
    typeof locator !== 'object' ||
    typeof locator.projectId !== 'string' ||
    typeof locator.artifactId !== 'string' ||
    typeof locator.artifactType !== 'string' ||
    (locator.path !== undefined && !safePlanrPath(locator.path)) ||
    (locator.contentHash !== undefined &&
      (typeof locator.contentHash !== 'string' || !DIGEST.test(locator.contentHash)))
  ) {
    return safeError(candidate, provider, resolver, 'EVIDENCE_LOCATOR_INVALID');
  }

  const project = configuredProject(context, locator.projectId);
  if (project === null) return safeError(candidate, provider, resolver, 'SOURCE_NOT_FOUND');
  if (!scopeMatches(candidate, project))
    return safeError(candidate, provider, resolver, 'EVIDENCE_SOURCE_SCOPE_MISMATCH');
  const rootPath = usableProjectRoot(project);
  if (rootPath === null) return safeError(candidate, provider, resolver, 'SOURCE_NOT_FOUND');
  const maximum = configuredMaximum(project);
  if (maximum === null) return safeError(candidate, provider, resolver, 'SENSITIVITY_BLOCKED');

  const artifact = declaredArtifact(project, locator);
  if (artifact === null || artifact.artifactType !== locator.artifactType) {
    return safeError(candidate, provider, resolver, 'ARTIFACT_NOT_FOUND');
  }
  if (!validDeclaredArtifact(artifact))
    return safeError(candidate, provider, resolver, 'EVIDENCE_LOCATOR_INVALID');
  const sourceContract = declaredSourceContract(project, artifact);
  if (sourceContract === null)
    return safeError(candidate, provider, resolver, 'EVIDENCE_LOCATOR_INVALID');
  if (locator.path !== undefined && locator.path !== artifact.path) {
    return safeError(candidate, provider, resolver, 'PATH_NOT_FOUND');
  }
  if (locator.contentHash !== undefined && locator.contentHash !== artifact.contentHash) {
    return safeError(candidate, provider, resolver, 'ARTIFACT_HASH_MISMATCH');
  }

  const artifactPath = resolve(rootPath, ...artifact.path.split('/'));
  if (!isContained(rootPath, artifactPath))
    return safeError(candidate, provider, resolver, 'EVIDENCE_LOCATOR_INVALID');
  try {
    if (!existsSync(artifactPath))
      return safeError(candidate, provider, resolver, 'PATH_NOT_FOUND');
    if (lstatSync(artifactPath).isSymbolicLink())
      return safeError(candidate, provider, resolver, 'SENSITIVITY_BLOCKED');
    const realArtifactPath = realpathSync(artifactPath);
    if (!isContained(rootPath, realArtifactPath))
      return safeError(candidate, provider, resolver, 'SENSITIVITY_BLOCKED');
  } catch {
    return safeError(candidate, provider, resolver, 'PATH_NOT_FOUND');
  }
  const read = readRegularFileNoFollow(artifactPath, maximum);
  if (read.error) return safeError(candidate, provider, resolver, read.error);
  if (containsSecret(read.bytes))
    return safeError(candidate, provider, resolver, 'SECRET_DETECTED');
  const rawHash = sha256(read.bytes);
  if (rawHash !== artifact.contentHash)
    return safeError(candidate, provider, resolver, 'ARTIFACT_HASH_MISMATCH');

  return freeze({
    status: 'resolved',
    provider,
    resolver,
    error: null,
    capture: {
      contentBase64: read.bytes.toString('base64'),
      rawHash,
      sizeBytes: read.bytes.byteLength,
      classification: classificationFor(project, artifact),
      freshness: 'current',
      sourceContract,
      locator: {
        projectId: locator.projectId,
        artifactId: artifact.artifactId,
        artifactType: artifact.artifactType,
        path: artifact.path,
        contentHash: rawHash,
      },
      provenance: {
        projectId: locator.projectId,
        artifactId: artifact.artifactId,
        artifactType: artifact.artifactType,
        contentHash: rawHash,
      },
    },
  });
}

/** The registered provider and resolver share one bounded Planr read path. */
export const resolveLocalPlanrEvidenceProviderV2 = resolveLocalPlanrEvidenceV2;
