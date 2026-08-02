import { randomBytes, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import { acquireStartLock } from '../design-engine/server-util.mjs';
import { ARTIFACT_ERROR_CODES, PipelineError } from '../pipeline/errors.mjs';
import {
  createArtifactEnvelope,
  digestArtifactEnvelope,
  validateArtifactEnvelope,
  validateArtifactReview,
} from './envelope.mjs';
import {
  assertUniqueReviewItemIds,
  createReviewLedger,
  effectiveReviewDecision,
  validateReviewLedger,
} from './merge.mjs';

const DECISIONS = new Set(['pending', 'approved', 'changes_requested']);
export const ARTIFACT_REVIEW_MAX_STATE_BYTES = 5 * 1024 * 1024;
const reviewPathQueues = new Map();

function finalEntry(path, fs = { lstatSync }) {
  try { return fs.lstatSync(path); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalObject(value) {
  if (Array.isArray(value)) return value.map(canonicalObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalObject(value[key])]));
}

function stableItemSort(a, b) {
  return String(a.createdAt ?? a.updatedAt ?? '').localeCompare(String(b.createdAt ?? b.updatedAt ?? ''))
    || String(a.id ?? a.reviewId).localeCompare(String(b.id ?? b.reviewId));
}

export function normalizeArtifactReview(review) {
  let normalized;
  try { normalized = clone(review); } catch {
    throw new PipelineError(ARTIFACT_ERROR_CODES.REVIEW_INVALID, 'Artifact review is not cloneable.');
  }
  try {
    validateArtifactReview(normalized);
    assertUniqueReviewItemIds(normalized);
  } catch (error) {
    if (error instanceof PipelineError) {
      throw new PipelineError(
        ARTIFACT_ERROR_CODES.REVIEW_INVALID,
        'Artifact review does not satisfy the Protocol v1.1 review contract.',
        '',
        { issues: error.details?.issues ?? [] },
      );
    }
    throw error;
  }
  normalized.pins = normalized.pins.map((pin) => ({
    ...pin,
    replies: [...pin.replies].sort(stableItemSort),
  })).sort(stableItemSort);
  validateArtifactReview(normalized);
  return normalized;
}

export function createArtifactReview({
  reviewId,
  reviewOf,
  decision = 'pending',
  overall = '',
  pins = [],
  createdAt,
  updatedAt,
  now = () => new Date(),
  createId = randomUUID,
} = {}) {
  if (!DECISIONS.has(decision)) {
    throw new PipelineError(ARTIFACT_ERROR_CODES.REVIEW_INVALID, 'Artifact review decision is invalid.');
  }
  let iso;
  try {
    const timestamp = now();
    iso = timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString();
  } catch {
    throw new PipelineError(ARTIFACT_ERROR_CODES.REVIEW_INVALID, 'Artifact review clock returned an invalid timestamp.');
  }
  return normalizeArtifactReview({
    schemaVersion: '1.0.0',
    reviewId: reviewId ?? createId(),
    reviewOf,
    decision,
    overall,
    createdAt: createdAt ?? iso,
    updatedAt: updatedAt ?? createdAt ?? iso,
    pins: clone(pins),
  });
}

/** Attach a review to an immutable copy of its original review-free envelope. */
export function createArtifactReviewEnvelope(envelope, review) {
  validateArtifactEnvelope(envelope);
  const normalized = normalizeArtifactReview(review);
  const digest = digestArtifactEnvelope(envelope);
  if (normalized.reviewOf !== digest) {
    throw new PipelineError(
      ARTIFACT_ERROR_CODES.DIGEST_MISMATCH,
      'Artifact review digest does not match the review-free artifact envelope.',
      '',
      { localDigest: digest, reviewDigest: normalized.reviewOf },
    );
  }
  const result = createArtifactEnvelope({
    artifacts: envelope.artifacts,
    viewer: envelope.viewer,
    review: normalized,
  });
  return deepFreeze(result);
}

export const createReviewEnvelope = createArtifactReviewEnvelope;

export function serializeReviewState(value) {
  const normalized = value?.kind === 'artifact-review-state'
    ? validateReviewLedger(clone(value))
    : normalizeArtifactReview(value);
  return `${JSON.stringify(canonicalObject(normalized), null, 2)}\n`;
}

export function readArtifactReviewState(path, { allowMissing = false } = {}) {
  const entry = finalEntry(path);
  if (!entry) {
    if (allowMissing) return null;
    throw new PipelineError(ARTIFACT_ERROR_CODES.REVIEW_IMPORT, 'Artifact review state does not exist.');
  }
  try {
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new PipelineError(
        ARTIFACT_ERROR_CODES.SYMLINK_ESCAPE,
        'Artifact review state destination is not a regular file.',
      );
    }
    if (statSync(path).size > ARTIFACT_REVIEW_MAX_STATE_BYTES) {
      throw new PipelineError(
        ARTIFACT_ERROR_CODES.REQUEST_LIMIT,
        `Artifact review state exceeds ${ARTIFACT_REVIEW_MAX_STATE_BYTES} bytes.`,
      );
    }
    return validateReviewLedger(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw new PipelineError(ARTIFACT_ERROR_CODES.REVIEW_INVALID, 'Artifact review state is malformed.');
  }
}

/** Atomic, private persistence with injectable operations for failure testing. */
export function writeArtifactReviewState(path, ledger, {
  fileSystem = {},
  suffix = `${process.pid}.${randomBytes(8).toString('hex')}`,
} = {}) {
  validateReviewLedger(ledger);
  const fs = { existsSync, lstatSync, mkdirSync, writeFileSync, renameSync, rmSync, ...fileSystem };
  const temporary = `${path}.${suffix}.tmp`;
  const serialized = serializeReviewState(ledger);
  if (Buffer.byteLength(serialized, 'utf8') > ARTIFACT_REVIEW_MAX_STATE_BYTES) {
    throw new PipelineError(
      ARTIFACT_ERROR_CODES.REQUEST_LIMIT,
      `Artifact review state exceeds ${ARTIFACT_REVIEW_MAX_STATE_BYTES} bytes.`,
    );
  }
  try {
    const initial = finalEntry(path, fs);
    if (initial) {
      const target = initial;
      if (target.isSymbolicLink() || !target.isFile()) throw new Error('unsafe final target');
    }
    fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    fs.writeFileSync(temporary, serialized, { mode: 0o600, flag: 'wx' });
    const final = finalEntry(path, fs);
    if (final) {
      const target = final;
      if (target.isSymbolicLink() || !target.isFile()) throw new Error('unsafe final target');
    }
    fs.renameSync(temporary, path);
  } catch {
    try { fs.rmSync(temporary, { force: true }); } catch { /* best-effort temp cleanup */ }
    throw new PipelineError(
      ARTIFACT_ERROR_CODES.REVIEW_WRITE,
      'Artifact review state could not be written atomically.',
      'Check destination permissions and retry; the previous review state was left unchanged.',
    );
  }
  return ledger;
}

export const persistArtifactReview = writeArtifactReviewState;

/** Serialize read-modify-write operations that target the same durable review path. */
export function withArtifactReviewLock(path, action) {
  const previous = reviewPathQueues.get(path) ?? Promise.resolve();
  const run = async () => {
    let release;
    try {
      release = await acquireStartLock(`${path}.lock`, { timeout: 15_000, stale: 30_000 });
      return await action();
    } catch (error) {
      if (error instanceof PipelineError) throw error;
      throw new PipelineError(
        ARTIFACT_ERROR_CODES.REVIEW_WRITE,
        'Artifact review state is busy or its cross-process lock is unavailable.',
        'Wait for the active review write to finish, then retry.',
      );
    } finally {
      release?.();
    }
  };
  const operation = previous.then(run, run);
  const tail = operation.then(() => undefined, () => undefined);
  reviewPathQueues.set(path, tail);
  tail.finally(() => {
    if (reviewPathQueues.get(path) === tail) reviewPathQueues.delete(path);
  });
  return operation;
}

function normalizedExportInput(value) {
  if (value?.kind === 'artifact-review-state') return validateReviewLedger(clone(value));
  if (value?.review && value?.artifacts) return normalizeArtifactReview(value.review);
  return normalizeArtifactReview(value);
}

function markdownText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim();
}

function renderPinMarkdown(pin, number) {
  const region = `${pin.region.x}, ${pin.region.y}, ${pin.region.w}, ${pin.region.h}`;
  const lines = [
    `### ${number}. ${pin.intent.toUpperCase()} · ${pin.status}`,
    '',
    `- Pin: \`${pin.id}\``,
    `- Artifact: \`${pin.artifactId}\`${pin.variant ? ` · variant \`${pin.variant}\`` : ''}`,
    `- Author: ${pin.author.name}`,
    `- Region: \`${region}\` at ${pin.viewport.width}×${pin.viewport.height}`,
    ...(pin.anchor ? [`- Anchor: \`${pin.anchor.planrId}\`${pin.anchor.screen ? ` · screen \`${pin.anchor.screen}\`` : ''}`] : []),
    `- Updated: ${pin.updatedAt}`,
    '',
    markdownText(pin.comment),
  ];
  if (pin.replies.length > 0) {
    lines.push('', '#### Thread', '');
    for (const reply of pin.replies) {
      lines.push(`- **${reply.author.name}** (${reply.createdAt}): ${markdownText(reply.comment)}`);
    }
  }
  return lines.join('\n');
}

function reviewMarkdown(review, headingLevel = 2, stale = false) {
  const mark = '#'.repeat(headingLevel);
  const lines = [
    `${mark} Review ${review.reviewId}${stale ? ' · STALE' : ''}`,
    '',
    `- Digest: \`${review.reviewOf}\``,
    `- Decision: **${review.decision}**`,
    `- Pins: ${review.pins.length}`,
    ...(review.createdAt ? [`- Created: ${review.createdAt}`] : []),
    ...(review.updatedAt ? [`- Updated: ${review.updatedAt}`] : []),
    '',
    `${mark}# Overall feedback`,
    '',
    markdownText(review.overall) || '_No overall feedback._',
  ];
  if (review.pins.length > 0) {
    lines.push('', `${mark}# Pins`, '');
    review.pins.forEach((pin, index) => lines.push(renderPinMarkdown(pin, index + 1), ''));
    if (lines.at(-1) === '') lines.pop();
  }
  return lines.join('\n');
}

export function exportArtifactReview(value, { format = 'json' } = {}) {
  let normalized;
  try { normalized = normalizedExportInput(value); } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw new PipelineError(ARTIFACT_ERROR_CODES.REVIEW_EXPORT, 'Artifact review cannot be exported.');
  }
  if (format === 'json') return serializeReviewState(normalized);
  if (format !== 'markdown') {
    throw new PipelineError(
      ARTIFACT_ERROR_CODES.REVIEW_EXPORT,
      'Artifact review export format must be json or markdown.',
    );
  }
  if (normalized.kind !== 'artifact-review-state') {
    return `# OpenPlanr Artifact Review\n\n${reviewMarkdown(normalized)}\n`;
  }
  const lines = [
    '# OpenPlanr Artifact Reviews',
    '',
    `- Artifact: \`${normalized.artifactId}\``,
    `- Current digest: \`${normalized.currentReviewOf}\``,
    `- Effective decision: **${effectiveReviewDecision(normalized)}**`,
    `- Reviews: ${normalized.reviews.length}`,
  ];
  for (const entry of normalized.reviews) {
    lines.push('', reviewMarkdown(entry.review, 2, entry.stale));
  }
  return `${lines.join('\n')}\n`;
}

export function createEmptyArtifactReviewState(envelope) {
  validateArtifactEnvelope(envelope);
  return createReviewLedger({
    artifactId: envelope.viewer.activeArtifactId,
    currentReviewOf: digestArtifactEnvelope(envelope),
  });
}
