/**
 * Design-board -> Protocol v1.1 artifact adapter.
 *
 * This module owns the deterministic, runtime-neutral boundary between the
 * established design session directory and the generic artifact review
 * engine. It deliberately does not know about board chrome, daemon routes,
 * SSE, or share transports.
 */

import { randomUUID } from 'node:crypto';
import {
  existsSync,
  realpathSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';

import { bundleArtifact } from '../artifact/bundle.mjs';
import {
  createArtifactEnvelope,
  digestArtifactEnvelope,
} from '../artifact/envelope.mjs';
import { escapeHtml } from '../design/escape.mjs';
import { ARTIFACT_ERROR_CODES, PipelineError } from '../pipeline/errors.mjs';
import { discoverVariants, imageDimensions } from './canvas-wrap.mjs';
import { designFeedbackToArtifactReview } from './feedback.mjs';

export const DESIGN_BOARD_MAX_FILES = 1_000;
export const DESIGN_BOARD_MAX_BYTES = 10 * 1024 * 1024;

const ARTIFACT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_ARTIFACTS = 256;
const WINDOWS_ABSOLUTE_RE = /^[A-Za-z]:[\\/]/;
const TYPE_BY_EXTENSION = Object.freeze({
  '.htm': 'html',
  '.html': 'html',
  '.png': 'image',
  '.svg': 'svg',
});

function adapterError(code, message, details = undefined) {
  return new PipelineError(code, message, '', details);
}

function resolveSessionRoot(sessionDir) {
  if (typeof sessionDir !== 'string' || sessionDir.trim() === '') {
    throw adapterError(
      ARTIFACT_ERROR_CODES.INPUT_INVALID,
      'A non-empty design session directory is required.',
    );
  }
  const candidate = resolve(sessionDir);
  if (!existsSync(candidate)) {
    throw adapterError(
      ARTIFACT_ERROR_CODES.ROOT_MISSING,
      'The design session directory does not exist.',
    );
  }
  const root = realpathSync(candidate);
  if (!statSync(root).isDirectory()) {
    throw adapterError(
      ARTIFACT_ERROR_CODES.ROOT_MISSING,
      'The design session path must be a directory.',
    );
  }
  return root;
}

function normalizeMode(mode = 'loop') {
  if (!['loop', 'review'].includes(mode)) {
    throw adapterError(
      ARTIFACT_ERROR_CODES.INPUT_INVALID,
      'Design artifact mode must be loop or review.',
    );
  }
  return mode;
}

function normalizeLimit(value, maximum, label) {
  if (value === undefined) return maximum;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw adapterError(
      ARTIFACT_ERROR_CODES.INPUT_INVALID,
      `${label} must be a positive integer no greater than ${maximum}.`,
    );
  }
  return value;
}

function assertShareSafeMetadata(value, label, root, sensitiveValues = []) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw adapterError(ARTIFACT_ERROR_CODES.INPUT_INVALID, `${label} must be a non-empty string.`);
  }
  const inspected = value.trim();
  if (inspected.length > 512) {
    throw adapterError(ARTIFACT_ERROR_CODES.INPUT_INVALID, `${label} exceeds 512 characters.`);
  }
  const containsMachinePath = inspected.includes(root)
    || /(?:^|[^A-Za-z0-9._-])\/(?:Users|home|private|Volumes)\/[A-Za-z0-9._-]+\//.test(inspected)
    || /[A-Za-z]:\\(?:Users|Documents and Settings)\\/i.test(inspected);
  const containsRemote = /(?:git@|ssh:\/\/|git(?:\+ssh)?:\/\/)[^\s"']+|https?:\/\/[^\s"']+\.git(?:\b|$)/i.test(inspected);
  const containsSensitiveValue = sensitiveValues.some((item) => (
    typeof item === 'string' && item.length >= 4 && inspected.includes(item)
  ));
  if (containsMachinePath || containsRemote || containsSensitiveValue) {
    throw adapterError(
      ARTIFACT_ERROR_CODES.REDACTION,
      `${label} contains machine-private metadata and cannot be shared.`,
    );
  }
  return inspected;
}

function normalizeVariant(variant, index, root, sensitiveValues) {
  if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
    throw adapterError(
      ARTIFACT_ERROR_CODES.INPUT_INVALID,
      `Design variant ${index + 1} must be an object.`,
    );
  }
  const id = String(variant.id ?? '').trim();
  if (!ARTIFACT_ID_RE.test(id) || id.length > 128) {
    throw adapterError(
      ARTIFACT_ERROR_CODES.INPUT_INVALID,
      `Design variant ${index + 1} has an invalid stable id.`,
    );
  }
  const rawSource = String(variant.src ?? '').trim();
  if (!rawSource || isAbsolute(rawSource) || WINDOWS_ABSOLUTE_RE.test(rawSource)) {
    throw adapterError(
      ARTIFACT_ERROR_CODES.INPUT_INVALID,
      `Design variant ${id} requires a project-relative source path.`,
    );
  }
  const src = rawSource.split('\\').join('/');
  if (basename(src).toLowerCase() === 'board.html') {
    throw adapterError(
      ARTIFACT_ERROR_CODES.INPUT_INVALID,
      'board.html is review chrome and cannot be embedded as a design artifact.',
    );
  }
  const type = TYPE_BY_EXTENSION[extname(src).toLowerCase()];
  if (!type) {
    throw adapterError(
      ARTIFACT_ERROR_CODES.INPUT_INVALID,
      `Design variant ${id} must reference HTML, SVG, or PNG.`,
    );
  }
  if (variant.type !== undefined && variant.type !== type) {
    throw adapterError(
      ARTIFACT_ERROR_CODES.INPUT_INVALID,
      `Design variant ${id} type does not match its source extension.`,
    );
  }
  const label = assertShareSafeMetadata(
    String(variant.title ?? variant.label ?? `Variant ${id}`),
    `Design variant ${id} title`,
    root,
    sensitiveValues,
  );
  return {
    id,
    label,
    src,
    type,
    ...(variant.viewport === undefined ? {} : { viewport: variant.viewport }),
    ...(variant.colorScheme === undefined ? {} : { colorScheme: variant.colorScheme }),
  };
}

/**
 * Resolve the ordered board sources without exposing machine paths.
 * Explicit variant order is retained. Discovered loop variants use the
 * established A..Z order; review mode selects finalized.html before canvas.html.
 */
export function resolveDesignBoardVariants({
  sessionDir,
  mode = 'loop',
  variants,
  sensitiveValues = [],
} = {}) {
  const root = resolveSessionRoot(sessionDir);
  const normalizedMode = normalizeMode(mode);
  if (!Array.isArray(sensitiveValues)) {
    throw adapterError(
      ARTIFACT_ERROR_CODES.INPUT_INVALID,
      'sensitiveValues must be an array of strings.',
    );
  }

  let sources = variants;
  if (sources === undefined) {
    if (normalizedMode === 'review') {
      const src = ['finalized.html', 'canvas.html'].find((name) => existsSync(join(root, name)));
      if (!src) {
        throw adapterError(
          ARTIFACT_ERROR_CODES.FILE_MISSING,
          'Review mode requires finalized.html or canvas.html in the design session.',
        );
      }
      sources = [{ id: 'artifact', label: src, src, type: 'html' }];
    } else {
      sources = discoverVariants(readdirSync(root));
      if (sources.length === 0) {
        throw adapterError(
          ARTIFACT_ERROR_CODES.FILE_MISSING,
          'Loop mode requires at least one variant-*.html, variant-*.svg, or variant-*.png file.',
        );
      }
    }
  }
  if (!Array.isArray(sources) || sources.length === 0) {
    throw adapterError(
      ARTIFACT_ERROR_CODES.INPUT_INVALID,
      'At least one design variant is required.',
    );
  }
  if (sources.length > MAX_ARTIFACTS) {
    throw adapterError(
      ARTIFACT_ERROR_CODES.INPUT_INVALID,
      `A design board can contain at most ${MAX_ARTIFACTS} artifacts.`,
    );
  }
  if (normalizedMode === 'review' && sources.length !== 1) {
    throw adapterError(
      ARTIFACT_ERROR_CODES.INPUT_INVALID,
      'Review mode accepts exactly one design artifact.',
    );
  }

  const resolvedVariants = sources.map((variant, index) => (
    normalizeVariant(variant, index, root, sensitiveValues)
  ));
  if (new Set(resolvedVariants.map(({ id }) => id)).size !== resolvedVariants.length) {
    throw adapterError(
      ARTIFACT_ERROR_CODES.INPUT_INVALID,
      'Design variant ids must be unique.',
    );
  }
  return { mode: normalizedMode, variants: resolvedVariants };
}

function imageWrapper(variant) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(variant.label)}</title><style>html,body{margin:0;min-height:100%;background:transparent}img{display:block;width:100%;height:auto}</style></head><body><img data-planr-id="design-variant-${escapeHtml(variant.id)}" src="${escapeHtml(variant.src)}" alt="${escapeHtml(variant.label)}" draggable="false"></body></html>`;
}

async function bundleVariant(variant, root, options) {
  if (variant.type === 'html') {
    return bundleArtifact(variant.src, { root, ...options });
  }

  // The hardened bundler intentionally accepts HTML entries only. A unique,
  // short-lived wrapper keeps legacy SVG/PNG sessions on that same security
  // path, including SVG dependency inspection and path/symlink checks.
  const entry = `.planr-artifact-entry-${randomUUID()}.html`;
  const entryPath = join(root, entry);
  writeFileSync(entryPath, imageWrapper(variant), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try {
    return await bundleArtifact(entry, { root, ...options });
  } finally {
    try {
      unlinkSync(entryPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw adapterError(
          ARTIFACT_ERROR_CODES.REVIEW_WRITE,
          'OpenPlanr could not remove its temporary design artifact wrapper.',
        );
      }
    }
  }
}

function variantViewport(variant, root, viewport, viewportByVariant) {
  if (variant.viewport !== undefined) return variant.viewport;
  if (viewportByVariant?.[variant.id] !== undefined) return viewportByVariant[variant.id];
  if (variant.type !== 'html') return imageDimensions(join(root, variant.src));
  return viewport ?? { width: 1440, height: 900 };
}

function variantColorScheme(variant, colorScheme, colorSchemeByVariant) {
  return variant.colorScheme ?? colorSchemeByVariant?.[variant.id] ?? colorScheme ?? 'light';
}

/**
 * Bundle every ordered board variant into exactly one canonical HTML artifact.
 * Limits are aggregated across the complete board, not reset per variant.
 */
export async function bundleDesignBoardVariants({
  sessionDir,
  mode = 'loop',
  variants,
  title,
  viewport,
  viewportByVariant = {},
  colorScheme = 'light',
  colorSchemeByVariant = {},
  maxFiles,
  maxBytes,
  sensitiveValues = [],
} = {}) {
  const root = resolveSessionRoot(sessionDir);
  const resolved = resolveDesignBoardVariants({ sessionDir: root, mode, variants, sensitiveValues });
  const fileLimit = normalizeLimit(maxFiles, DESIGN_BOARD_MAX_FILES, 'maxFiles');
  const byteLimit = normalizeLimit(maxBytes, DESIGN_BOARD_MAX_BYTES, 'maxBytes');
  const reviewTitle = title === undefined
    ? undefined
    : assertShareSafeMetadata(String(title), 'Design review title', root, sensitiveValues);

  let fileCount = 0;
  let inputBytes = 0;
  let outputBytes = 0;
  const artifacts = [];
  const artifactIdByVariant = {};
  const viewportByArtifact = {};

  for (const variant of resolved.variants) {
    const remainingFiles = fileLimit - fileCount;
    const remainingBytes = byteLimit - inputBytes;
    if (remainingFiles < 1) {
      throw adapterError(
        ARTIFACT_ERROR_CODES.FILE_LIMIT,
        `Design board artifact graph exceeds ${fileLimit} files in total.`,
      );
    }
    if (remainingBytes < 1) {
      throw adapterError(
        ARTIFACT_ERROR_CODES.BYTE_LIMIT,
        `Design board artifact graph exceeds ${byteLimit} decoded bytes in total.`,
      );
    }
    const bundled = await bundleVariant(variant, root, {
      maxFiles: remainingFiles,
      maxBytes: remainingBytes,
      sensitiveValues,
    });
    fileCount += bundled.fileCount;
    inputBytes += bundled.inputBytes;
    outputBytes += bundled.bytes;
    if (outputBytes > DESIGN_BOARD_MAX_BYTES) {
      throw adapterError(
        ARTIFACT_ERROR_CODES.OUTPUT_LIMIT,
        `Design board bundled HTML exceeds ${DESIGN_BOARD_MAX_BYTES} UTF-8 bytes in total.`,
      );
    }
    const artifactViewport = variantViewport(variant, root, viewport, viewportByVariant);
    const artifactTitle = resolved.mode === 'review' && reviewTitle ? reviewTitle : variant.label;
    artifacts.push({
      id: variant.id,
      kind: 'html',
      title: artifactTitle,
      sha256: bundled.sha256,
      html: bundled.html,
      viewport: artifactViewport,
      colorScheme: variantColorScheme(variant, colorScheme, colorSchemeByVariant),
    });
    artifactIdByVariant[variant.id] = variant.id;
    viewportByArtifact[variant.id] = artifactViewport;
  }

  return {
    mode: resolved.mode,
    artifacts,
    artifactIdByVariant,
    viewportByArtifact,
    totals: { fileCount, inputBytes, outputBytes },
  };
}

/**
 * Create the canonical Protocol v1.1 envelope for a design board.
 *
 * Legacy feedback is optional. When present it is translated only after the
 * review-free envelope digest has been computed, so `review.reviewOf` binds to
 * the immutable ordered artifacts and never to mutable review state.
 */
export async function createDesignBoardArtifactEnvelope(options = {}) {
  const bundled = await bundleDesignBoardVariants(options);
  const activeArtifactId = options.activeArtifactId ?? bundled.artifacts[0].id;
  const viewer = {
    mode: bundled.mode === 'review' ? 'single' : (bundled.artifacts.length > 1 ? 'variants' : 'single'),
    activeArtifactId,
    presentation: 'canvas',
  };
  const base = createArtifactEnvelope({ artifacts: bundled.artifacts, viewer });
  if (options.feedback === undefined || options.feedback === null) return base;

  const review = designFeedbackToArtifactReview(options.feedback, {
    reviewId: options.reviewId,
    reviewOf: digestArtifactEnvelope(base),
    artifactId: activeArtifactId,
    artifactIdByVariant: bundled.artifactIdByVariant,
    viewport: bundled.viewportByArtifact[activeArtifactId],
    viewportByArtifact: bundled.viewportByArtifact,
    now: options.now,
  });
  return createArtifactEnvelope({ artifacts: bundled.artifacts, viewer, review });
}
