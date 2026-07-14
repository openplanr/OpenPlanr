import { createHash } from 'node:crypto';

import { validate } from '../design/schema-loader.mjs';
import { ARTIFACT_ERROR_CODES, PipelineError } from '../pipeline/errors.mjs';

const textEncoder = new TextEncoder();
const SHA256_RE = /^[a-f0-9]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_ARTIFACTS = 256;
const MAX_ARTIFACT_HTML_BYTES = 10 * 1024 * 1024;
const MAX_PINS = 10_000;
const MAX_REPLIES = 10_000;
const MAX_PASTE_BYTES = 5 * 1024 * 1024;

function invalid(message, details = undefined) {
  throw new PipelineError(ARTIFACT_ERROR_CODES.ENVELOPE_INVALID, message, '', details);
}

function assertBoundedString(value, label, { min = 0, max, pattern } = {}) {
  if (typeof value !== 'string' || value.length < min || (max !== undefined && value.length > max)
    || (pattern && !pattern.test(value))) {
    invalid(`${label} is outside its allowed string bounds.`);
  }
}

function assertViewport(viewport, label) {
  if (!viewport || !Number.isInteger(viewport.width) || !Number.isInteger(viewport.height)
    || viewport.width < 1 || viewport.width > 16384
    || viewport.height < 1 || viewport.height > 16384) {
    invalid(`${label} must be an integer viewport from 1 through 16384 pixels.`);
  }
}

export function normalizeUtf8Text(value) {
  if (typeof value !== 'string') {
    throw new PipelineError(ARTIFACT_ERROR_CODES.INPUT_INVALID, 'Artifact HTML must be a string.');
  }
  return value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

export function canonicalArtifactBytes(html) {
  return textEncoder.encode(normalizeUtf8Text(html));
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function digestArtifact(html) {
  return sha256Hex(canonicalArtifactBytes(html));
}

function canonicalObject(value) {
  if (Array.isArray(value)) return value.map(canonicalObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalObject(value[key])]),
  );
}

export function canonicalSerialize(value) {
  return JSON.stringify(canonicalObject(value));
}

export function canonicalBytes(value) {
  return textEncoder.encode(canonicalSerialize(value));
}

function normalizeViewport(viewport = {}) {
  const width = viewport.width ?? 1440;
  const height = viewport.height ?? 900;
  if (!Number.isInteger(width) || width < 1 || width > 16384
    || !Number.isInteger(height) || height < 1 || height > 16384) {
    throw new PipelineError(
      ARTIFACT_ERROR_CODES.ENVELOPE_INVALID,
      'Artifact viewport width and height must be integers from 1 through 16384.',
    );
  }
  return { width, height };
}

function normalizeArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object') {
    throw new PipelineError(ARTIFACT_ERROR_CODES.ENVELOPE_INVALID, 'Each artifact must be an object.');
  }
  const id = artifact.id;
  const title = artifact.title;
  if (typeof id !== 'string' || !ID_RE.test(id) || id.length > 128) {
    throw new PipelineError(ARTIFACT_ERROR_CODES.ENVELOPE_INVALID, `Invalid artifact id: ${String(id)}`);
  }
  if (typeof title !== 'string' || title.length === 0 || title.length > 512) {
    throw new PipelineError(ARTIFACT_ERROR_CODES.ENVELOPE_INVALID, `Artifact ${id} requires a title.`);
  }
  const html = normalizeUtf8Text(artifact.html);
  if (html.length === 0) {
    throw new PipelineError(ARTIFACT_ERROR_CODES.ENVELOPE_INVALID, `Artifact ${id} HTML is empty.`);
  }
  if (Buffer.byteLength(html, 'utf8') > MAX_ARTIFACT_HTML_BYTES) {
    invalid(`Artifact ${id} exceeds ${MAX_ARTIFACT_HTML_BYTES} UTF-8 bytes.`);
  }
  const sha256 = digestArtifact(html);
  if (artifact.sha256 !== undefined && artifact.sha256 !== sha256) {
    throw new PipelineError(
      ARTIFACT_ERROR_CODES.ENVELOPE_INVALID,
      `Artifact ${id} digest does not match its canonical bundled HTML.`,
      '',
      { expected: sha256, actual: artifact.sha256 },
    );
  }
  const colorScheme = artifact.colorScheme ?? 'light';
  if (!['light', 'dark'].includes(colorScheme)) {
    throw new PipelineError(ARTIFACT_ERROR_CODES.ENVELOPE_INVALID, `Artifact ${id} has an invalid color scheme.`);
  }
  return {
    id,
    kind: 'html',
    title,
    sha256,
    html,
    viewport: normalizeViewport(artifact.viewport),
    colorScheme,
  };
}

function normalizeViewer(viewer, artifacts) {
  const ids = new Set(artifacts.map(({ id }) => id));
  const normalized = {
    mode: viewer?.mode ?? (artifacts.length > 1 ? 'variants' : 'single'),
    activeArtifactId: viewer?.activeArtifactId ?? artifacts[0].id,
  };
  if (!['single', 'variants'].includes(normalized.mode)) {
    throw new PipelineError(ARTIFACT_ERROR_CODES.ENVELOPE_INVALID, 'Viewer mode must be single or variants.');
  }
  if (!ids.has(normalized.activeArtifactId)) {
    throw new PipelineError(ARTIFACT_ERROR_CODES.ENVELOPE_INVALID, 'Viewer activeArtifactId is not present in artifacts.');
  }
  return normalized;
}

function envelopeWithoutReview(envelope) {
  return {
    schemaVersion: envelope.schemaVersion,
    artifacts: envelope.artifacts,
    viewer: envelope.viewer,
  };
}

export function canonicalEnvelopeBytes(envelope, { includeReview = false } = {}) {
  const value = includeReview ? envelope : envelopeWithoutReview(envelope);
  return canonicalBytes(value);
}

export function digestArtifactEnvelope(envelope) {
  return sha256Hex(canonicalEnvelopeBytes(envelope));
}

export function validateArtifactReview(review) {
  const issues = validate(review, 'artifact-review', 'v1.1.0');
  if (issues.length > 0) {
    throw new PipelineError(
      ARTIFACT_ERROR_CODES.ENVELOPE_INVALID,
      `Invalid artifact review at ${issues[0].path}: ${issues[0].detail}`,
      '',
      { issues },
    );
  }
  assertBoundedString(review.reviewId, 'reviewId', { min: 1, max: 128 });
  assertBoundedString(review.reviewOf, 'reviewOf', { min: 64, max: 64, pattern: SHA256_RE });
  assertBoundedString(review.overall, 'overall', { max: 65_536 });
  if (!Array.isArray(review.pins) || review.pins.length > MAX_PINS) invalid(`Review pins exceed ${MAX_PINS}.`);
  for (const [pinIndex, pin] of review.pins.entries()) {
    const label = `pins[${pinIndex}]`;
    assertBoundedString(pin.id, `${label}.id`, { min: 1, max: 128 });
    assertBoundedString(pin.author?.id ?? '', `${label}.author.id`, { max: 128 });
    assertBoundedString(pin.author?.name, `${label}.author.name`, { min: 1, max: 256 });
    assertBoundedString(pin.artifactId, `${label}.artifactId`, { min: 1, max: 128 });
    if (pin.variant !== undefined) assertBoundedString(pin.variant, `${label}.variant`, { min: 1, max: 128 });
    assertBoundedString(pin.comment, `${label}.comment`, { min: 1, max: 65_536 });
    if (pin.anchor) {
      assertBoundedString(pin.anchor.planrId, `${label}.anchor.planrId`, { min: 1, max: 512 });
      if (pin.anchor.screen !== undefined) assertBoundedString(pin.anchor.screen, `${label}.anchor.screen`, { min: 1, max: 128 });
    }
    assertViewport(pin.viewport, `${label}.viewport`);
    for (const coordinate of ['x', 'y', 'w', 'h']) {
      const value = pin.region?.[coordinate];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        invalid(`${label}.region.${coordinate} must be a finite normalized coordinate.`);
      }
    }
    if (pin.region.x + pin.region.w > 1 || pin.region.y + pin.region.h > 1) {
      invalid(`${label}.region must remain inside normalized artifact bounds.`);
    }
    if (!Array.isArray(pin.replies) || pin.replies.length > MAX_REPLIES) invalid(`${label}.replies exceeds ${MAX_REPLIES}.`);
    for (const [replyIndex, reply] of pin.replies.entries()) {
      const replyLabel = `${label}.replies[${replyIndex}]`;
      assertBoundedString(reply.id, `${replyLabel}.id`, { min: 1, max: 128 });
      assertBoundedString(reply.author?.id ?? '', `${replyLabel}.author.id`, { max: 128 });
      assertBoundedString(reply.author?.name, `${replyLabel}.author.name`, { min: 1, max: 256 });
      assertBoundedString(reply.comment, `${replyLabel}.comment`, { min: 1, max: 65_536 });
    }
  }
  return review;
}

export function validateArtifactEnvelope(envelope) {
  const issues = validate(envelope, 'artifact-envelope', 'v1.1.0');
  if (issues.length > 0) {
    throw new PipelineError(
      ARTIFACT_ERROR_CODES.ENVELOPE_INVALID,
      `Invalid artifact envelope at ${issues[0].path}: ${issues[0].detail}`,
      '',
      { issues },
    );
  }
  if (!Array.isArray(envelope.artifacts) || envelope.artifacts.length < 1 || envelope.artifacts.length > MAX_ARTIFACTS) {
    invalid(`Envelope requires 1 through ${MAX_ARTIFACTS} artifacts.`);
  }
  const ids = envelope.artifacts.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    throw new PipelineError(ARTIFACT_ERROR_CODES.ENVELOPE_INVALID, 'Artifact ids must be unique.');
  }
  let artifactBytes = 0;
  for (const artifact of envelope.artifacts) {
    assertBoundedString(artifact.id, 'artifact.id', { min: 1, max: 128, pattern: ID_RE });
    assertBoundedString(artifact.title, `Artifact ${artifact.id} title`, { min: 1, max: 512 });
    assertBoundedString(artifact.html, `Artifact ${artifact.id} HTML`, { min: 1 });
    artifactBytes += Buffer.byteLength(artifact.html, 'utf8');
    if (artifactBytes > MAX_ARTIFACT_HTML_BYTES) {
      invalid(`Envelope artifacts exceed ${MAX_ARTIFACT_HTML_BYTES} UTF-8 bytes in total.`);
    }
    assertViewport(artifact.viewport, `Artifact ${artifact.id} viewport`);
    if (!SHA256_RE.test(artifact.sha256) || digestArtifact(artifact.html) !== artifact.sha256) {
      throw new PipelineError(ARTIFACT_ERROR_CODES.ENVELOPE_INVALID, `Artifact ${artifact.id} digest is invalid.`);
    }
  }
  assertBoundedString(envelope.viewer.activeArtifactId, 'viewer.activeArtifactId', { min: 1, max: 128 });
  if (!ids.includes(envelope.viewer.activeArtifactId)) {
    throw new PipelineError(ARTIFACT_ERROR_CODES.ENVELOPE_INVALID, 'Viewer references an unknown artifact.');
  }
  if (envelope.review) {
    validateArtifactReview(envelope.review);
    for (const pin of envelope.review.pins) {
      if (!ids.includes(pin.artifactId)) invalid(`Review pin references unknown artifact: ${pin.artifactId}`);
    }
    const expected = digestArtifactEnvelope(envelope);
    if (envelope.review.reviewOf !== expected) {
      throw new PipelineError(
        ARTIFACT_ERROR_CODES.ENVELOPE_INVALID,
        'Review digest does not match the canonical review-free envelope.',
        '',
        { expected, actual: envelope.review.reviewOf },
      );
    }
  }
  return envelope;
}

export function createArtifactEnvelope({ artifacts, viewer, review } = {}) {
  if (!Array.isArray(artifacts) || artifacts.length === 0 || artifacts.length > MAX_ARTIFACTS) {
    throw new PipelineError(ARTIFACT_ERROR_CODES.ENVELOPE_INVALID, 'Envelope requires 1 through 256 artifacts.');
  }
  const normalizedArtifacts = [];
  let artifactBytes = 0;
  for (const artifact of artifacts) {
    const normalized = normalizeArtifact(artifact);
    artifactBytes += Buffer.byteLength(normalized.html, 'utf8');
    if (artifactBytes > MAX_ARTIFACT_HTML_BYTES) {
      invalid(`Envelope artifacts exceed ${MAX_ARTIFACT_HTML_BYTES} UTF-8 bytes in total.`);
    }
    normalizedArtifacts.push(normalized);
  }
  if (new Set(normalizedArtifacts.map(({ id }) => id)).size !== normalizedArtifacts.length) {
    throw new PipelineError(ARTIFACT_ERROR_CODES.ENVELOPE_INVALID, 'Artifact ids must be unique.');
  }
  const envelope = {
    schemaVersion: '1.0.0',
    artifacts: normalizedArtifacts,
    viewer: normalizeViewer(viewer, normalizedArtifacts),
    ...(review ? { review: canonicalObject(review) } : {}),
  };
  return validateArtifactEnvelope(envelope);
}

export function validateArtifactPaste(paste) {
  const issues = validate(paste, 'artifact-paste', 'v1.1.0');
  if (issues.length > 0) {
    invalid(`Invalid artifact paste at ${issues[0].path}: ${issues[0].detail}`, { issues });
  }
  if (paste.id !== undefined) assertBoundedString(paste.id, 'paste.id', { min: 16, max: 128 });
  if (paste.iv !== undefined) assertBoundedString(paste.iv, 'paste.iv', { min: 16, max: 16 });
  if (paste.deletionToken !== undefined) {
    assertBoundedString(paste.deletionToken, 'paste.deletionToken', { min: 32, max: 256 });
  }
  if (paste.ciphertext !== undefined) {
    assertBoundedString(paste.ciphertext, 'paste.ciphertext', { min: 1 });
    const bytes = Buffer.from(paste.ciphertext, 'base64url').byteLength;
    if (bytes < 1 || bytes > MAX_PASTE_BYTES) invalid(`Paste ciphertext exceeds ${MAX_PASTE_BYTES} bytes.`);
  }
  if (paste.size !== undefined
    && (!Number.isInteger(paste.size) || paste.size < 1 || paste.size > MAX_PASTE_BYTES)) {
    invalid(`Paste size must be between 1 and ${MAX_PASTE_BYTES} bytes.`);
  }
  return paste;
}
