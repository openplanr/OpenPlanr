/** Current, revision-bound handoff queries without publishing or Studio operations. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { digestArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';
import {
  assertReviewExperience,
  DESIGN_HANDOFF_SCHEMA,
} from '@openplanr/protocol/review-experience-contracts';
import { emptyReviewContext, reviewDigest } from './context.mjs';
import { currentDesign, designSpecPath, hash, readJson } from './document-state.mjs';
import { readDesignFeedback } from './feedback-reader.mjs';
import { renderMarkdown } from './handoff-format.mjs';
import {
  compileDesignHandoffReadiness,
  designHandoffReadinessDigest,
} from './handoff-readiness.mjs';
import { compileDesignHandoffResolution } from './handoff-resolution.mjs';
import { getDesignShareStatus } from './share-status.mjs';

export const sections = ['agreedChanges', 'openQuestions', 'deferred', 'rejected'];
export const metadataPath = (current) => join(current.root, '.design/review-metadata.json');
export const designHandoffPath = (file, options = {}) =>
  join(dirname(designSpecPath(currentDesign(file, options).root)), 'review-handoff.json');
export const revisionOf = (pin) => pin.revisionId ?? pin.reviewId;
export const pinKey = (pin) => `${revisionOf(pin)}:${pin.id}`;
function metadata(current, feedback) {
  const local = readJson(metadataPath(current), { version: 0, byRevision: {} });
  const byRevision = structuredClone(feedback.shared?.metadataByRevision ?? {});
  for (const [revision, value] of Object.entries(local.byRevision ?? {})) {
    const remote = byRevision[revision] ?? {};
    byRevision[revision] = {
      categories: { ...remote.categories, ...value.categories },
      dispositions: { ...remote.dispositions, ...value.dispositions },
    };
  }
  const counts = new Map();
  for (const pin of feedback.pins) counts.set(pin.id, (counts.get(pin.id) ?? 0) + 1);
  const categories = {},
    dispositions = {};
  for (const pin of feedback.pins) {
    const value = byRevision[revisionOf(pin)];
    if (counts.get(pin.id) === 1 && value) {
      if (Object.hasOwn(value.categories ?? {}, pin.id))
        Object.defineProperty(categories, pin.id, {
          value: value.categories[pin.id],
          enumerable: true,
        });
      if (Object.hasOwn(value.dispositions ?? {}, pin.id))
        Object.defineProperty(dispositions, pin.id, {
          value: value.dispositions[pin.id],
          enumerable: true,
        });
    }
    if (
      counts.get(pin.id) === 1 &&
      !Object.hasOwn(categories, pin.id) &&
      Object.hasOwn(local.categories ?? {}, pin.id)
    )
      Object.defineProperty(categories, pin.id, {
        value: local.categories[pin.id],
        enumerable: true,
      });
    if (
      counts.get(pin.id) === 1 &&
      !Object.hasOwn(dispositions, pin.id) &&
      Object.hasOwn(local.dispositions ?? {}, pin.id)
    )
      Object.defineProperty(dispositions, pin.id, {
        value: local.dispositions[pin.id],
        enumerable: true,
      });
  }
  return {
    version: local.version,
    categories,
    dispositions,
    byRevision,
    legacy: {
      categories: structuredClone(local.categories ?? {}),
      dispositions: structuredClone(local.dispositions ?? {}),
    },
  };
}
export function findPin(pins, id, revision) {
  const candidates = pins.filter(
    (pin) => pin.id === id && (!revision || revisionOf(pin) === revision),
  );
  if (candidates.length !== 1)
    throw new Error(
      'The comment identity is missing or ambiguous. Include its original revisionId.',
    );
  return candidates[0];
}

function resolutionFor(value, shareStatus) {
  return compileDesignHandoffResolution({
    currentReviewOf: value.basis.reviewOf,
    pins: value.feedback.pins,
    metadata: {
      byRevision: value.metadata.byRevision,
      categories: value.metadata.legacy.categories,
      dispositions: value.metadata.legacy.dispositions,
    },
    historyComplete: !value.feedback.shared?.issues?.length,
    synchronizationPending: Boolean(shareStatus?.pendingReviewMetadata),
    synchronizationIssues: value.feedback.shared?.issues ?? [],
  });
}

export function snapshot(file, env, shareOptions = {}) {
  const current = currentDesign(file, shareOptions),
    feedback = readDesignFeedback(file, env, shareOptions),
    meta = metadata(current, feedback);
  const reviewContext = current.reviewContext ?? emptyReviewContext(current.document);
  const basis = {
    designId: current.document.id,
    sourceRevision: current.revision,
    contextDigest: current.contextDigest ?? reviewDigest(reviewContext),
    reviewOf: digestArtifactEnvelope(current.envelope),
    selectedVariant: feedback.state.selectedVariant ?? current.document.selectedVariant,
    feedbackDigest: reviewDigest({
      pins: feedback.pins,
      metadata: {
        byRevision: meta.byRevision,
        categories: meta.categories,
        dispositions: meta.dispositions,
      },
      overall: (feedback.ledger?.reviews ?? []).map((entry) => ({
        reviewId: entry.review.reviewId,
        reviewOf: entry.review.reviewOf,
        overall: entry.review.overall,
      })),
      directions: feedback.shared?.directions ?? [],
    }),
    verificationDigest: reviewDigest(current.verification),
    feedbackWatermark: Math.max(
      0,
      ...(feedback.shared?.events ?? []).map((event) => event.sequence ?? 0),
    ),
  };
  let shareStatus = null;
  try {
    shareStatus = getDesignShareStatus(file, { env, ...shareOptions });
  } catch (error) {
    if (error.code === 'E_DESIGN_PUBLICATION_PENDING') throw error;
    /* Local-only review. */
  }
  const value = { current, feedback, metadata: meta, reviewContext, basis };
  return { ...value, resolution: resolutionFor(value, shareStatus), shareStatus };
}
export function readDesignExperience(file, { env = process.env } = {}) {
  const value = snapshot(file, env);
  return {
    ok: true,
    capabilities: { owner: true, revisions: true, handoff: true },
    revision: value.current.revision,
    reviewContext: value.reviewContext,
    contextDigest: value.basis.contextDigest,
    fingerprints: value.current.fingerprints ?? [],
    metadata: value.metadata,
    loadingHistory: false,
  };
}
export function readDesignHandoff(file, { env = process.env, ...shareOptions } = {}) {
  const value = snapshot(file, env, shareOptions);
  const path = join(dirname(designSpecPath(value.current.root)), 'review-handoff.json');
  const draft = readJson(path, null);
  if (draft) {
    assertDraft(draft);
    const markdownPath = path.replace(/\.json$/u, '.md');
    if (!existsSync(markdownPath) || readFileSync(markdownPath, 'utf8') !== draft.markdown)
      throw new Error(
        'The handoff Markdown differs from its approved JSON. Rebuild the handoff projection before using it in Plan.',
      );
  }
  return {
    ok: true,
    path,
    revision: value.current.revision,
    draft,
    current: Boolean(draft && reviewDigest(draft.basis) === reviewDigest(value.basis)),
    metadata: value.metadata,
    feedback: { pins: value.feedback.pins },
    basis: value.basis,
    resolution: value.resolution,
  };
}
export function readDesignHandoffReadiness(file, { env = process.env, ...shareOptions } = {}) {
  const value = snapshot(file, env, shareOptions);
  const path = join(dirname(designSpecPath(value.current.root)), 'review-handoff.json');
  const handoff = readJson(path, null);
  if (handoff) assertDraft(handoff);
  const outcomes = new Map(value.resolution.items.map((item) => [item.id, item]));
  const pins = value.feedback.pins.map((pin) => {
    const resolved = outcomes.get(pinKey(pin));
    const disposition =
      resolved?.outcome === 'accepted'
        ? 'accepted'
        : resolved?.outcome === 'deferred'
          ? 'deferred'
          : resolved?.outcome === 'declined'
            ? 'rejected'
            : undefined;
    return {
      id: pin.id,
      ...(pin.screenId ? { screenId: pin.screenId } : {}),
      ...(pin.anchor?.planrId ? { elementId: pin.anchor.planrId } : {}),
      category: resolved?.category,
      ...(disposition ? { disposition } : {}),
      stale: Boolean(pin.stale),
    };
  });
  const specificationPath = designSpecPath(value.current.root);
  const specification = existsSync(specificationPath)
    ? {
        path: 'design-spec.md',
        revision: value.current.revision,
        digest: `sha256:${hash(readFileSync(specificationPath))}`,
        complete: true,
      }
    : undefined;
  const studioState = readJson(join(value.current.root, '.design/studio-state.json'), {
    state: {},
  }).state;
  const readiness = compileDesignHandoffReadiness({
    document: value.current.document,
    documentPath: 'design-document.json',
    sourceRevision: value.current.revision,
    studioState,
    studioStatePath: '.design/studio-state.json',
    specification,
    verification: { path: '.design/verification/current.json', ...value.current.verification },
    review: {
      path: '.design/review.json',
      revision: value.current.revision,
      current: pins.every((pin) => !pin.stale),
      pins,
    },
    reviewHandoff: handoff
      ? {
          ...handoff,
          path: 'review-handoff.json',
          digest: `sha256:${handoff.contentHash}`,
          current: reviewDigest(handoff.basis) === reviewDigest(value.basis),
        }
      : undefined,
  });
  return { ok: true, readiness, digest: designHandoffReadinessDigest(readiness) };
}
export function assertDraft(draft) {
  assertReviewExperience(draft, DESIGN_HANDOFF_SCHEMA);
  const expected = reviewDigest({
    title: draft.title,
    reviewNotes: draft.reviewNotes,
    basis: draft.basis,
    content: draft.content,
    affectedScreens: draft.affectedScreens ?? [],
    verificationGaps: draft.verificationGaps ?? [],
  });
  if (
    draft.contentHash !== expected ||
    (draft.status === 'approved' && draft.approval?.contentHash !== expected)
  )
    throw new Error(
      'The handoff content does not match its approval digest. Refine it through the handoff utility.',
    );
  if (draft.markdown !== renderMarkdown(draft, draft.title))
    throw new Error('The handoff Markdown does not match its approved content.');
  return draft;
}
