import { randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import {
  artifactReviewToDesignFeedback,
  assertValidFeedback,
  FEEDBACK_FILE,
} from '../design-engine/feedback.mjs';
import { planrHome } from '../design-engine/paths.mjs';
import { ARTIFACT_ERROR_CODES, PipelineError } from '../pipeline/errors.mjs';
import {
  digestArtifactEnvelope,
  validateArtifactEnvelope,
  validateArtifactReview,
} from './envelope.mjs';
import {
  createReviewLedger,
  effectiveReviewDecision,
  mergeReviewLedger,
  validateReviewLedger,
} from './merge.mjs';
import {
  ARTIFACT_REVIEW_MAX_STATE_BYTES,
  readArtifactReviewState,
  serializeReviewState,
  withArtifactReviewLock,
  writeArtifactReviewState,
} from './review.mjs';

const ARTIFACT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function pathError(code, message) {
  throw new PipelineError(code, message, 'Choose a real, non-symlinked project or user review destination.');
}

function pathEntry(path, fs = { lstatSync }) {
  try { return fs.lstatSync(path); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function inside(base, candidate) {
  const rel = relative(base, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function parseablePlanrConfig(root) {
  const path = join(root, '.planr', 'config.json');
  if (!existsSync(path)) return false;
  try {
    if (lstatSync(path).isSymbolicLink()) return false;
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value)
      && ((typeof value.projectName === 'string' && value.projectName.trim() !== '')
        || (value.idPrefix && typeof value.idPrefix === 'object'
          && !Array.isArray(value.idPrefix) && Object.keys(value.idPrefix).length > 0));
  } catch (error) {
    return false;
  }
}

function hasGitMarker(root) {
  const marker = join(root, '.git');
  if (!existsSync(marker)) return false;
  try {
    const stat = lstatSync(marker);
    if (stat.isSymbolicLink()) return false;
    if (stat.isDirectory()) {
      const head = join(marker, 'HEAD');
      return existsSync(head) && lstatSync(head).isFile();
    }
    if (!stat.isFile() || stat.size > 4_096) return false;
    const match = /^gitdir:\s*(.+?)\s*$/u.exec(readFileSync(marker, 'utf8'));
    if (!match) return false;
    const gitDir = resolve(root, match[1]);
    return existsSync(gitDir) && statSync(gitDir).isDirectory()
      && existsSync(join(gitDir, 'HEAD')) && lstatSync(join(gitDir, 'HEAD')).isFile();
  } catch (error) {
    return false;
  }
}

export function findArtifactProjectRoot(start = process.cwd(), { env = process.env } = {}) {
  let current;
  try { current = realpathSync(resolve(start)); } catch {
    pathError(ARTIFACT_ERROR_CODES.REVIEW_IMPORT, 'Artifact review working directory does not exist.');
  }
  const homeCandidate = resolve(env.HOME ?? homedir());
  let home = homeCandidate;
  try { home = realpathSync(homeCandidate); } catch { /* a synthetic test HOME may not exist yet */ }
  while (true) {
    if (current !== home && (parseablePlanrConfig(current) || hasGitMarker(current))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function assertSafeDestination(base, relativeParts) {
  const absoluteBase = resolve(base);
  if (existsSync(absoluteBase) && lstatSync(absoluteBase).isSymbolicLink()) {
    pathError(ARTIFACT_ERROR_CODES.SYMLINK_ESCAPE, 'Artifact review destination base is a symlink.');
  }
  let realBase = absoluteBase;
  if (existsSync(absoluteBase)) realBase = realpathSync(absoluteBase);
  let current = absoluteBase;
  for (const part of relativeParts) {
    if (!part || part === '.' || part === '..' || part.includes('/') || part.includes('\\') || part.includes('\0')) {
      pathError(ARTIFACT_ERROR_CODES.PATH_TRAVERSAL, 'Artifact review destination contains an unsafe segment.');
    }
    current = join(current, part);
    const entry = pathEntry(current);
    if (!entry) continue;
    if (entry.isSymbolicLink()) {
      pathError(ARTIFACT_ERROR_CODES.SYMLINK_ESCAPE, 'Artifact review destination contains a symlink.');
    }
    if (!inside(realBase, realpathSync(current))) {
      pathError(ARTIFACT_ERROR_CODES.PATH_TRAVERSAL, 'Artifact review destination escapes its storage root.');
    }
  }
  if (!inside(absoluteBase, current)) {
    pathError(ARTIFACT_ERROR_CODES.PATH_TRAVERSAL, 'Artifact review destination escapes its storage root.');
  }
  return current;
}

/** Resolve the exact generic project/user or adjacent design-review destination. */
export function resolveArtifactReviewDestination({
  cwd = process.cwd(),
  env = process.env,
  artifactId,
  designDir,
} = {}) {
  if (!ARTIFACT_ID_RE.test(artifactId ?? '')) {
    pathError(ARTIFACT_ERROR_CODES.PATH_TRAVERSAL, 'Artifact review ID is unsafe for local storage.');
  }
  if (designDir !== undefined) {
    const lexical = resolve(designDir);
    if (!existsSync(lexical) || !statSync(lexical).isDirectory()) {
      pathError(ARTIFACT_ERROR_CODES.REVIEW_IMPORT, 'Design review destination does not exist.');
    }
    if (lstatSync(lexical).isSymbolicLink()) {
      pathError(ARTIFACT_ERROR_CODES.SYMLINK_ESCAPE, 'Design review destination must be a real directory.');
    }
    const requested = realpathSync(lexical);
    return Object.freeze({
      kind: 'design',
      artifactId,
      directory: requested,
      path: join(requested, FEEDBACK_FILE),
      reviewStatePath: join(requested, 'artifact-review-state.json'),
    });
  }
  const projectRoot = findArtifactProjectRoot(cwd, { env });
  if (projectRoot) {
    const directory = assertSafeDestination(projectRoot, ['.planr', 'artifacts', artifactId]);
    return Object.freeze({
      kind: 'project', artifactId, root: projectRoot, directory, path: join(directory, 'review-state.json'),
    });
  }
  const root = resolve(planrHome(env));
  const directory = assertSafeDestination(root, ['artifacts', artifactId]);
  return Object.freeze({
    kind: 'user', artifactId, root, directory, path: join(directory, 'review-state.json'),
  });
}

function reviewsFromDecoded(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PipelineError(ARTIFACT_ERROR_CODES.REVIEW_IMPORT, 'Decoded review payload is not an object.');
  }
  if (value.kind === 'artifact-review-state') {
    validateReviewLedger(value);
    return value.reviews.map((entry) => ({ review: entry.review, stale: entry.stale }));
  }
  if (value.artifacts && value.viewer) {
    validateArtifactEnvelope(value);
    if (!value.review) {
      throw new PipelineError(ARTIFACT_ERROR_CODES.REVIEW_IMPORT, 'Decoded artifact envelope contains no review.');
    }
    return [{ review: value.review, stale: false }];
  }
  if (value.review && !value.reviewId) return reviewsFromDecoded(value.review);
  validateArtifactReview(value);
  return [{ review: value, stale: false }];
}

export async function decodeArtifactReviewSources(sources, { decodeSource, withMetadata = false } = {}) {
  const list = Array.isArray(sources) ? sources : [sources];
  if (list.length === 0) {
    throw new PipelineError(ARTIFACT_ERROR_CODES.REVIEW_IMPORT, 'At least one artifact review source is required.');
  }
  const entries = [];
  for (let index = 0; index < list.length; index += 1) {
    const source = list[index];
    let decoded = source;
    if (typeof source === 'string') {
      if (typeof decodeSource !== 'function') {
        throw new PipelineError(
          ARTIFACT_ERROR_CODES.REVIEW_DECODER_REQUIRED,
          'String and URL review sources require an injected async decoder.',
          'Provide decodeSource(source, { index }); the review lifecycle has no transport dependency.',
          { sourceIndex: index },
        );
      }
      try { decoded = await decodeSource(source, { index }); } catch {
        throw new PipelineError(
          ARTIFACT_ERROR_CODES.REVIEW_IMPORT,
          'Artifact review source could not be decoded.',
          'Verify the immutable review link and retry.',
          { sourceIndex: index },
        );
      }
    }
    try {
      entries.push(...reviewsFromDecoded(decoded).map((entry) => ({
        review: structuredClone(entry.review),
        stale: Boolean(entry.stale),
      })));
    } catch (error) {
      if (error instanceof PipelineError && error.code === ARTIFACT_ERROR_CODES.REVIEW_IMPORT) {
        error.details = { sourceIndex: index };
        throw error;
      }
      throw new PipelineError(
        ARTIFACT_ERROR_CODES.REVIEW_IMPORT,
        'Decoded artifact review does not satisfy the Protocol v1.1 contract.',
        '',
        { sourceIndex: index },
      );
    }
  }
  return withMetadata ? entries : entries.map((entry) => entry.review);
}

function safeReviewSummary(review, stale) {
  return Object.freeze({
    reviewId: review.reviewId,
    reviewDigest: review.reviewOf,
    stale,
    decision: review.decision,
    pinCount: review.pins.length,
    replyCount: review.pins.reduce((total, pin) => total + pin.replies.length, 0),
  });
}

function assertRegularFinal(path, fs) {
  const target = pathEntry(path, fs);
  if (!target) return;
  if (target.isSymbolicLink() || !target.isFile()) {
    throw new PipelineError(
      ARTIFACT_ERROR_CODES.SYMLINK_ESCAPE,
      'Artifact review final destination is not a regular file.',
    );
  }
}

function readDesignFeedback(path) {
  if (!pathEntry(path)) return undefined;
  assertRegularFinal(path, { existsSync, lstatSync });
  try {
    if (statSync(path).size > ARTIFACT_REVIEW_MAX_STATE_BYTES) {
      throw new PipelineError(ARTIFACT_ERROR_CODES.REQUEST_LIMIT, 'Design feedback exceeds the local review byte limit.');
    }
    return assertValidFeedback(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw new PipelineError(ARTIFACT_ERROR_CODES.REVIEW_IMPORT, 'Existing design feedback is malformed.');
  }
}

function atomicDesignReviewWrite({ statePath, feedbackPath, ledger, feedback }, {
  fileSystem = {},
} = {}) {
  assertValidFeedback(feedback);
  validateReviewLedger(ledger);
  const fs = {
    existsSync, lstatSync, mkdirSync, writeFileSync, renameSync, rmSync, ...fileSystem,
  };
  const suffix = `${process.pid}.${randomBytes(8).toString('hex')}`;
  const files = [
    { path: statePath, content: serializeReviewState(ledger) },
    { path: feedbackPath, content: `${JSON.stringify(feedback, null, 2)}\n` },
  ].map((entry) => ({
    ...entry,
    temporary: `${entry.path}.${suffix}.tmp`,
    backup: `${entry.path}.${suffix}.bak`,
    backedUp: false,
    installed: false,
  }));
  try {
    for (const entry of files) {
      if (Buffer.byteLength(entry.content, 'utf8') > ARTIFACT_REVIEW_MAX_STATE_BYTES) {
        throw new PipelineError(ARTIFACT_ERROR_CODES.REQUEST_LIMIT, 'Artifact review state exceeds the local byte limit.');
      }
      assertRegularFinal(entry.path, fs);
      fs.mkdirSync(dirname(entry.path), { recursive: true, mode: 0o700 });
      fs.writeFileSync(entry.temporary, entry.content, { mode: 0o600, flag: 'wx' });
    }
    for (const entry of files) {
      assertRegularFinal(entry.path, fs);
      if (fs.existsSync(entry.path)) {
        fs.renameSync(entry.path, entry.backup);
        entry.backedUp = true;
      }
    }
    for (const entry of files) {
      fs.renameSync(entry.temporary, entry.path);
      entry.installed = true;
    }
    for (const entry of files) {
      if (entry.backedUp) {
        try { fs.rmSync(entry.backup, { force: true }); } catch { /* committed data is authoritative */ }
      }
    }
  } catch (error) {
    for (const entry of [...files].reverse()) {
      try {
        if (entry.installed) fs.rmSync(entry.path, { force: true });
        if (entry.backedUp && fs.existsSync(entry.backup)) fs.renameSync(entry.backup, entry.path);
      } catch { /* keep recovery backup if restoration itself fails */ }
    }
    if (error instanceof PipelineError) throw error;
    throw new PipelineError(
      ARTIFACT_ERROR_CODES.REVIEW_WRITE,
      'Design review state and feedback could not be committed atomically.',
      'Check destination permissions and retry; recovery backups are preserved if restoration was interrupted.',
    );
  } finally {
    for (const entry of files) {
      try { fs.rmSync(entry.temporary, { force: true }); } catch { /* best effort */ }
    }
  }
}

/** Decode, validate, digest-check, merge, and optionally persist one or many reviews. */
export async function importArtifactReview({
  sources,
  currentEnvelope,
  decodeSource,
  allowStale = false,
  cwd = process.cwd(),
  env = process.env,
  designDir,
  persist = true,
  fileSystem,
} = {}) {
  validateArtifactEnvelope(currentEnvelope);
  const currentReviewOf = digestArtifactEnvelope(currentEnvelope);
  const artifactId = currentEnvelope.viewer.activeArtifactId;
  const decodedEntries = await decodeArtifactReviewSources(sources, { decodeSource, withMetadata: true });
  const reviews = decodedEntries.map((entry) => entry.review);
  const summaries = decodedEntries.map((entry) => {
    const { review } = entry;
    const stale = review.reviewOf !== currentReviewOf;
    if (stale && !allowStale) {
      const summary = safeReviewSummary(review, true);
      throw new PipelineError(
        ARTIFACT_ERROR_CODES.STALE_REVIEW,
        'Artifact review targets a different canonical artifact digest.',
        'Preview the stale review, then retry with explicit allowStale confirmation.',
        {
          localDigest: currentReviewOf,
          reviewDigest: review.reviewOf,
          pinCount: summary.pinCount,
          replyCount: summary.replyCount,
        },
      );
    }
    return safeReviewSummary(review, stale || entry.stale);
  });
  const destination = resolveArtifactReviewDestination({ cwd, env, artifactId, designDir });
  const reviewStatePath = destination.reviewStatePath ?? destination.path;
  return withArtifactReviewLock(reviewStatePath, () => {
    let ledger = readArtifactReviewState(reviewStatePath, { allowMissing: true });
    if (!ledger) ledger = createReviewLedger({ artifactId, currentReviewOf });
    if (ledger.artifactId !== artifactId) {
      throw new PipelineError(ARTIFACT_ERROR_CODES.REVIEW_IMPORT, 'Stored review state belongs to another artifact.');
    }
    if (ledger.currentReviewOf !== currentReviewOf) {
      ledger = createReviewLedger({
        artifactId,
        currentReviewOf,
        reviews: ledger.reviews.map((entry) => ({
          review: entry.review,
          stale: entry.stale || entry.review.reviewOf !== currentReviewOf,
        })),
      });
    }
    for (const [index, review] of reviews.entries()) {
      ledger = mergeReviewLedger(ledger, review, { stale: summaries[index].stale });
    }

    if (persist && destination.kind === 'design') {
      let feedback = readDesignFeedback(destination.path);
      for (const review of reviews) {
        feedback = artifactReviewToDesignFeedback(review, {
          storedFeedback: feedback,
          boardId: feedback?.boardId ?? artifactId,
        });
      }
      atomicDesignReviewWrite({
        statePath: reviewStatePath,
        feedbackPath: destination.path,
        ledger,
        feedback,
      }, { ...(fileSystem ? { fileSystem } : {}) });
    } else if (persist) {
      writeArtifactReviewState(destination.path, ledger, { ...(fileSystem ? { fileSystem } : {}) });
    }

    return Object.freeze({
      ok: true,
      action: 'artifact_review_imported',
      artifactId,
      currentReviewOf,
      imported: Object.freeze(summaries),
      effectiveDecision: effectiveReviewDecision(ledger),
      destination: Object.freeze({ kind: destination.kind, artifactId }),
      reviewState: ledger,
    });
  });
}
