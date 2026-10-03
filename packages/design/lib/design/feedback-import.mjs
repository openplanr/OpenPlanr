/** Explicit, bounded reconciliation of downloaded feedback into the local review ledger. */
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { digestArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';
import {
  decodeArtifactReviewSources,
  resolveArtifactReviewDestination,
} from '@openplanr/artifact/import.mjs';
import { acquireStartLock } from '@openplanr/artifact/internal/server-util.mjs';
import { createReviewLedger, mergeReviewLedger } from '@openplanr/artifact/merge.mjs';
import {
  ARTIFACT_REVIEW_MAX_STATE_BYTES,
  normalizeArtifactReview,
  readArtifactReviewState,
  withArtifactReviewLock,
  writeArtifactReviewState,
} from '@openplanr/artifact/review.mjs';
import { ARTIFACT_ERROR_CODES, PipelineError } from '@openplanr/protocol/errors';
import { listDesignRevisions, readDesignRevision } from './context.mjs';
import { currentDesign, hash } from './document.mjs';

function invalid(message, code = ARTIFACT_ERROR_CODES.REVIEW_IMPORT) {
  throw new PipelineError(code, message);
}

/** Bound bytes before parsing, including a file that grows while being read. */
export function readDesignFeedbackImport(input) {
  if (typeof input !== 'string' || !input.trim()) invalid('Feedback import requires a JSON file.');
  let fd;
  try {
    fd = openSync(resolve(input), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile()) invalid('Feedback import must be a regular JSON file.');
    if (stat.size > ARTIFACT_REVIEW_MAX_STATE_BYTES)
      invalid('Feedback import exceeds the 5 MB limit.', ARTIFACT_ERROR_CODES.REQUEST_LIMIT);
    const bytes = Buffer.alloc(ARTIFACT_REVIEW_MAX_STATE_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = readSync(fd, bytes, size, bytes.length - size, null);
      if (!read) break;
      size += read;
    }
    if (size > ARTIFACT_REVIEW_MAX_STATE_BYTES)
      invalid('Feedback import exceeds the 5 MB limit.', ARTIFACT_ERROR_CODES.REQUEST_LIMIT);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    invalid('Feedback import is unreadable or is not valid UTF-8 JSON.');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function originalBundles(file, current) {
  return { file, current, cache: new Map([[current.revision, current]]) };
}

function originalBundle(bundles, reviewOf, revisionId) {
  if (!/^[a-f0-9]{64}$/u.test(reviewOf ?? ''))
    invalid('Feedback has an invalid original artifact digest.');
  const load = (revision) => {
    if (!bundles.cache.has(revision)) {
      try {
        const historical = readDesignRevision(bundles.file, revision);
        bundles.cache.set(revision, { ...historical, document: historical.design });
      } catch {
        invalid(
          'The original feedback revision is unavailable. Restore its immutable render bundle before importing.',
        );
      }
    }
    const bundle = bundles.cache.get(revision);
    if (bundle.document.id !== bundles.current.document.id)
      invalid('Feedback revision belongs to another design document.');
    return bundle;
  };
  if (revisionId && /^[a-f0-9]{64}$/u.test(revisionId)) {
    const exact = load(revisionId);
    if (digestArtifactEnvelope(exact.envelope) !== reviewOf)
      invalid('Feedback revision does not match its original artifact digest.');
    return exact;
  }
  for (const bundle of bundles.cache.values())
    if (digestArtifactEnvelope(bundle.envelope) === reviewOf) return bundle;
  // A hosted alias or raw Artifact review uses its full content digest to find the original local render.
  for (const { revision } of listDesignRevisions(bundles.file).revisions) {
    const bundle = load(revision);
    if (digestArtifactEnvelope(bundle.envelope) === reviewOf) return bundle;
  }
  invalid(
    'The original feedback revision is unavailable. Restore its immutable render bundle before importing.',
  );
}

function validatePin(pin, bundle) {
  const entry = bundle.entries.find((value) => value.artifactId === pin.artifactId);
  const frame = bundle.document.frames.find((value) => value.id === entry?.frameId);
  const screen = bundle.document.screens.find((value) => value.id === entry?.screenId);
  if (!entry || pin.viewport.width !== frame?.width || pin.viewport.height !== frame?.height)
    invalid('Feedback pin does not match its original screen and captured frame.');
  if (pin.variant !== undefined && pin.variant !== entry.variantId)
    invalid('Feedback pin targets another design direction.');
  if (pin.region.x + pin.region.w > 1.000001 || pin.region.y + pin.region.h > 1.000001)
    invalid('Feedback pin region extends beyond its original viewport or anchor.');
  if (
    pin.anchor &&
    ((pin.anchor.screen !== undefined && pin.anchor.screen !== entry.screenId) ||
      (pin.anchor.planrId !== screen.id && !screen.anchors?.includes(pin.anchor.planrId)))
  )
    invalid('Feedback pin anchor is not declared in its original screen.');
}

function identity(value) {
  return { name: value?.name, ...(value?.id == null ? {} : { id: value.id }) };
}

function projectedPin(thread, group, bundle) {
  const source = thread.source;
  if (
    !source ||
    source.reviewId !== group.reviewId ||
    source.reviewOf !== group.reviewOf ||
    source.artifactId !== group.artifactId ||
    source.revisionId !== group.sourceRevisionId
  )
    invalid('Feedback thread and group have conflicting source identities.');
  const entry = bundle.entries.find((value) => value.artifactId === group.artifactId);
  if (
    !entry ||
    entry.screenId !== group.screen?.id ||
    entry.variantId !== group.direction?.id ||
    entry.frameId !== group.frame?.id
  )
    invalid('Feedback group has an invalid original screen mapping.');
  const location = thread.location;
  if (
    !location ||
    !['anchor-normalized', 'viewport-normalized'].includes(location.coordinateSpace) ||
    Boolean(location.anchor) !== (location.coordinateSpace === 'anchor-normalized')
  )
    invalid('Feedback location has an invalid coordinate space.');
  if (!Array.isArray(thread.replies)) invalid('Feedback replies must be an array.');
  const pin = {
    id: thread.id,
    artifactId: source.artifactId,
    author: identity(thread.author),
    intent: thread.originalIntent,
    status: thread.status,
    comment: thread.comment,
    region: location.region,
    viewport: location.capturedViewport,
    ...(location.anchor
      ? {
          anchor: {
            planrId: location.anchor.planrId,
            ...(location.anchor.screen == null ? {} : { screen: location.anchor.screen }),
          },
        }
      : {}),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    replies: thread.replies.map((reply) => ({ ...reply, author: identity(reply.author) })),
  };
  return pin;
}

function appendProjectedThread(entry, thread, group, bundle, stored) {
  const pin = projectedPin(thread, group, bundle);
  const previousPin = stored?.reviews
    .find((value) => value.review.reviewId === group.reviewId)
    ?.review.pins.find((value) => value.id === pin.id);
  if (previousPin?.variant !== undefined) pin.variant = previousPin.variant;
  entry.review.pins.push(pin);
  if (!entry.review.updatedAt || Date.parse(pin.updatedAt) > Date.parse(entry.review.updatedAt))
    entry.review.updatedAt = pin.updatedAt;
  entry.stale ||= thread.stale === true;
}

function decodeProjection(value, current, bundles, stored) {
  if (
    value.schemaVersion !== '1.0.0' ||
    value.design?.id !== current.document.id ||
    !Array.isArray(value.groups) ||
    value.groups.length > 10000 ||
    !Array.isArray(value.overallNotes) ||
    value.overallNotes.length > 10000
  )
    invalid('Feedback export does not match this design document or supported schema.');
  originalBundle(bundles, value.currentArtifactDigest, value.currentRevisionId);
  const reviews = new Map();
  const reviewFor = (reviewId, reviewOf) => {
    if (typeof reviewId !== 'string' || !reviewId || reviewId.length > 128)
      invalid('Feedback export is missing its original review identity.');
    const previous = reviews.get(reviewId);
    if (previous && previous.review.reviewOf !== reviewOf)
      invalid('Feedback review identity is bound to conflicting artifact digests.');
    if (previous) return previous;
    const existing = stored?.reviews.find((entry) => entry.review.reviewId === reviewId)?.review;
    const entry = {
      review: {
        schemaVersion: '1.0.0',
        reviewId,
        reviewOf,
        decision: 'pending',
        overall: '',
        pins: [],
        ...(existing?.createdAt ? { createdAt: existing.createdAt } : {}),
        ...(existing?.updatedAt ? { updatedAt: existing.updatedAt } : {}),
      },
      stale: false,
    };
    reviews.set(reviewId, entry);
    return entry;
  };
  for (const group of value.groups) {
    if (
      !group ||
      !Array.isArray(group.threads) ||
      group.threads.length > 10000 ||
      group.sourceMapping !== 'original-bundle'
    )
      invalid('Feedback export lacks its original thread mapping.');
    const bundle = originalBundle(bundles, group.reviewOf, group.sourceRevisionId);
    const entry = reviewFor(group.reviewId, group.reviewOf);
    for (const thread of group.threads) appendProjectedThread(entry, thread, group, bundle, stored);
  }
  for (const note of value.overallNotes) {
    originalBundle(bundles, note?.reviewOf);
    const entry = reviewFor(note?.reviewId, note?.reviewOf);
    if (entry.review.overall) invalid('Feedback export contains duplicate overall notes.');
    entry.review.overall = note.comment;
  }
  return [...reviews.values()].map((entry) => ({
    ...entry,
    review: normalizeArtifactReview(entry.review),
  }));
}

function rejectLegacy(value) {
  if (
    value?.kind === 'openplanr-design-review-export' ||
    value?.kind === 'artifact-review-state' ||
    value?.artifacts ||
    value?.reviewId ||
    value?.review
  )
    return;
  invalid(
    'Legacy notes.json is not canonical review feedback. Keep the file and re-export JSON from the original supported Studio; it cannot be converted safely without its revision and anchor mapping.',
  );
}

function rebaseLedger(stored, artifactId, digest) {
  if (stored && stored.artifactId !== artifactId)
    invalid('Stored feedback belongs to another design document.');
  return createReviewLedger({
    artifactId,
    currentReviewOf: digest,
    reviews: (stored?.reviews ?? []).map((entry) => ({
      ...entry,
      stale: entry.stale || entry.review.reviewOf !== digest,
    })),
  });
}

function mergeImportedEntries(stored, artifactId, digest, entries, bundles, allowStale) {
  let ledger = rebaseLedger(stored, artifactId, digest);
  const imported = [];
  for (const entry of entries) {
    const bundle = originalBundle(bundles, entry.review.reviewOf);
    for (const pin of entry.review.pins) validatePin(pin, bundle);
    const stale = entry.stale || entry.review.reviewOf !== digest;
    if (stale && !allowStale)
      invalid(
        'Feedback belongs to an earlier revision. Inspect it and retry with explicit --allow-stale confirmation.',
        ARTIFACT_ERROR_CODES.STALE_REVIEW,
      );
    const previous = ledger.reviews.find(
      (value) => value.review.reviewId === entry.review.reviewId,
    )?.review;
    const review = { ...entry.review, decision: previous?.decision ?? 'pending' };
    ledger = mergeReviewLedger(ledger, review, { stale });
    imported.push({ reviewId: review.reviewId, stale, pins: review.pins.length });
  }
  return { ledger, imported };
}

/** Host-authorized import. Downloaded data cannot select a direction or approve a handoff. */
export async function importDesignFeedback(
  file,
  { input, revision, allowStale = false, env = process.env } = {},
) {
  if (!/^[a-f0-9]{64}$/u.test(revision ?? ''))
    invalid('Feedback import requires the current render revision from feedback inspect.');
  if (typeof allowStale !== 'boolean')
    invalid('Stale feedback requires an explicit boolean confirmation.');
  const source = readDesignFeedbackImport(input);
  rejectLegacy(source);
  const initial = currentDesign(file);
  const release = await acquireStartLock(join(initial.root, '.design/render.lock'), {
    timeout: 1000,
    stale: 30000,
  });
  try {
    const current = currentDesign(file);
    if (current.revision !== revision)
      invalid(
        'The design changed before feedback import. Inspect the current revision and retry.',
        ARTIFACT_ERROR_CODES.STALE_REVIEW,
      );
    const artifactId = `design-${hash(current.document.id).slice(0, 24)}`;
    const path = resolveArtifactReviewDestination({ cwd: current.root, env, artifactId }).path;
    return await withArtifactReviewLock(path, async () => {
      const stored = readArtifactReviewState(path, { allowMissing: true });
      const bundles = originalBundles(file, current);
      const entries =
        source.kind === 'openplanr-design-review-export'
          ? decodeProjection(source, current, bundles, stored)
          : await decodeArtifactReviewSources(source, { withMetadata: true });
      if (source.kind === 'artifact-review-state' && source.artifactId !== artifactId)
        invalid('Imported ledger belongs to another design document.');
      const digest = digestArtifactEnvelope(current.envelope);
      const { ledger, imported } = mergeImportedEntries(
        stored,
        artifactId,
        digest,
        entries,
        bundles,
        allowStale,
      );
      writeArtifactReviewState(path, ledger);
      return {
        ok: true,
        action: 'design_feedback_imported',
        revision: current.revision,
        imported,
        note: 'Feedback merged. Imported votes, dispositions and decisions do not change owner selection or handoff approval.',
      };
    });
  } finally {
    release();
  }
}
