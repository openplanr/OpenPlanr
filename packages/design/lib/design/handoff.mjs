/** Owner-local review organization and explicit, revision-bound handoff approval. */
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { acquireStartLock } from '@openplanr/artifact/internal/server-util.mjs';
import { withArtifactReviewLock } from '@openplanr/artifact/review.mjs';
import {
  assertReviewExperience,
  DESIGN_HANDOFF_CONTENT_SCHEMA,
  DESIGN_HANDOFF_SCHEMA,
} from '@openplanr/protocol/review-experience-contracts';
import { reviewDigest } from './context.mjs';
import { atomicJson, currentDesign, designSpecPath, readJson } from './document-state.mjs';
import { designReviewPath } from './feedback-reader.mjs';
import { renderMarkdown } from './handoff-format.mjs';
import {
  assertDraft,
  findPin,
  metadataPath,
  pinKey,
  readDesignHandoff,
  revisionOf,
  sections,
  snapshot,
} from './handoff-reader.mjs';
import { canApproveDesignHandoffResolution } from './handoff-resolution.mjs';
import { getDesignShareStatus } from './share-status.mjs';

export {
  designHandoffPath,
  readDesignExperience,
  readDesignHandoff,
  readDesignHandoffReadiness,
} from './handoff-reader.mjs';

import { publishDesignReviewMetadata } from './share.mjs';

const conflict = (message) => Object.assign(new Error(message), { statusCode: 409 });
function sourceItem(pin, shareUrl) {
  const source = pin.revisionId
    ? `${shareUrl ?? ''}#revision=${encodeURIComponent(pin.revisionId)}&pin=${encodeURIComponent(pin.id)}`
    : `#review=${encodeURIComponent(pin.reviewId)}&pin=${encodeURIComponent(pin.id)}`;
  return {
    pinId: pin.id,
    ...(pin.screenId ? { screenId: pin.screenId } : {}),
    reviewId: pin.reviewId,
    ...(pin.revisionId ? { revisionId: pin.revisionId } : {}),
    text: pin.comment,
    author: pin.author.name,
    reviewOf: pin.reviewOf,
    stale: Boolean(pin.stale),
    source,
  };
}
function contentFromFeedback(value, shareUrl) {
  const content = { summary: '', agreedChanges: [], openQuestions: [], deferred: [], rejected: [] };
  const pins = new Map(value.feedback.pins.map((pin) => [pinKey(pin), pin]));
  for (const resolved of value.resolution.items) {
    const pin = pins.get(resolved.id);
    const item = sourceItem(pin, shareUrl);
    if (resolved.outcome === 'accepted') content.agreedChanges.push(item);
    else if (resolved.outcome === 'deferred') content.deferred.push(item);
    else if (resolved.outcome === 'declined') content.rejected.push(item);
    else content.openQuestions.push(item);
  }
  return content;
}
function enrichContent(content, value, shareUrl) {
  assertReviewExperience(content, DESIGN_HANDOFF_CONTENT_SCHEMA);
  const seen = new Set();
  const enriched = { summary: content.summary };
  for (const key of sections)
    enriched[key] = content[key].map((item) => {
      const pin = findPin(value.feedback.pins, item.pinId, item.revisionId ?? item.reviewId);
      if (seen.has(pinKey(pin)))
        throw new Error('Handoff items must cite distinct recorded comments.');
      seen.add(pinKey(pin));
      const resolved = value.resolution.items.find((itemValue) => itemValue.id === pinKey(pin));
      const expected =
        key === 'agreedChanges'
          ? ['accepted']
          : key === 'deferred'
            ? ['deferred']
            : key === 'rejected'
              ? ['declined']
              : ['open', 'blocking'];
      if (!resolved || !expected.includes(resolved.outcome))
        throw new Error(
          'Record the owner disposition before moving a comment into this handoff section.',
        );
      const refinement = item.refinement ?? (item.text !== pin.comment ? item.text : undefined);
      return { ...sourceItem(pin, shareUrl), ...(refinement !== undefined ? { refinement } : {}) };
    });
  // An agent may refine text, but may not quietly omit any recorded comment.
  for (const pin of value.feedback.pins)
    if (!seen.has(pinKey(pin)))
      throw new Error(
        `Keep every recorded review comment in the handoff; ${pinKey(pin)} is missing.`,
      );
  return enriched;
}

function normalizedLocalMetadata(local, pins) {
  const byRevision = structuredClone(local.byRevision ?? {});
  const counts = new Map();
  for (const pin of pins) counts.set(pin.id, (counts.get(pin.id) ?? 0) + 1);
  for (const field of ['categories', 'dispositions']) {
    for (const [pinId, item] of Object.entries(local[field] ?? {})) {
      if (counts.get(pinId) !== 1) continue;
      const pin = pins.find((value) => value.id === pinId);
      const revision = revisionOf(pin);
      const scoped = byRevision[revision] ?? { categories: {}, dispositions: {} };
      byRevision[revision] = { ...scoped, [field]: { ...scoped[field], [pinId]: item } };
    }
  }
  return { version: local.version ?? 0, byRevision };
}
async function preserveReviewErrors(path, action) {
  let failure, result;
  await withArtifactReviewLock(path, async () => {
    try {
      result = await action();
    } catch (error) {
      failure = error;
    }
  });
  if (failure) throw failure;
  return result;
}
export async function updateDesignHandoff(
  file,
  input,
  { env = process.env, fetchImpl = fetch, ...shareOptions } = {},
) {
  if (!input || !['draft', 'update', 'approve', 'category', 'disposition'].includes(input.action))
    throw new Error('Unknown design handoff action.');
  const initial = currentDesign(file);
  const unlockRender = await acquireStartLock(join(initial.root, '.design/render.lock'));
  let outgoing;
  try {
    const unlock = await acquireStartLock(join(initial.root, '.design/handoff.lock'));
    try {
      await preserveReviewErrors(designReviewPath(file, env), async () => {
        const value = snapshot(file, env, shareOptions);
        if (input.revision !== value.current.revision)
          throw conflict('The design changed. Refresh the review before updating its handoff.');
        if (['category', 'disposition'].includes(input.action)) {
          if (input.version !== value.metadata.version)
            throw conflict('Review organization changed in another window. Reload before saving.');
          const pin = findPin(value.feedback.pins, input.pinId, input.revisionId ?? input.reviewId);
          if (!pin) throw new Error('The comment is no longer available.');
          const choices =
            input.action === 'category'
              ? ['question', 'suggestion', 'change-request', 'blocker']
              : ['accepted', 'deferred', 'rejected'];
          if (!choices.includes(input[input.action])) throw new Error(`Invalid ${input.action}.`);
          if (typeof (input.reason ?? '') !== 'string' || (input.reason ?? '').length > 16384)
            throw new Error('Disposition reason is too long.');
          const updatedAt = new Date().toISOString();
          const local = normalizedLocalMetadata(
            readJson(metadataPath(value.current), { version: 0, byRevision: {} }),
            value.feedback.pins,
          );
          const revision = revisionOf(pin);
          const scoped = local.byRevision?.[revision] ?? { categories: {}, dispositions: {} };
          const valueForRevision = { ...scoped };
          if (input.action === 'category')
            valueForRevision.categories = { ...scoped.categories, [pin.id]: input.category };
          else
            valueForRevision.dispositions = {
              ...scoped.dispositions,
              [pin.id]: {
                disposition: input.disposition,
                reason: input.reason ?? '',
                updatedAt,
                author: 'Design owner',
              },
            };
          const next = {
            version: value.metadata.version + 1,
            byRevision: { ...local.byRevision, [revision]: valueForRevision },
          };
          atomicJson(metadataPath(value.current), next);
          if (pin.revisionId)
            outgoing = {
              revisionId: pin.revisionId,
              payload: {
                schemaVersion: input.category === 'change-request' ? '1.1.0' : '1.0.0',
                kind: input.action,
                author: 'Design owner',
                reviewOf: pin.reviewOf,
                pinId: pin.id,
                [input.action]: input[input.action],
                ...(input.action === 'disposition' ? { reason: input.reason ?? '' } : {}),
                updatedAt,
              },
            };
          return;
        }
        const path = join(dirname(designSpecPath(value.current.root)), 'review-handoff.json');
        const previous = readJson(path, null);
        if (previous) assertDraft(previous);
        if (input.version !== (previous?.version ?? 0))
          throw conflict('The handoff changed in another window. Reload before saving.');
        let shareUrl;
        try {
          shareUrl = getDesignShareStatus(file, { env, ...shareOptions }).url;
        } catch {
          /* Local-only review. */
        }
        if (input.action === 'approve') {
          if (
            !previous ||
            input.contentHash !== previous.contentHash ||
            reviewDigest(previous.basis) !== reviewDigest(value.basis)
          )
            throw conflict(
              'The handoff is out of date. Rebuild and review the current draft before approving.',
            );
          if (!canApproveDesignHandoffResolution(value.resolution)) {
            const diagnostic = value.resolution.diagnostics[0];
            throw conflict(
              diagnostic?.message ??
                'Resolve the blocking review decisions before approving this handoff.',
            );
          }
          if (!previous.content.summary.trim())
            throw new Error('Write or refine the handoff summary before approving it.');
          const approved = {
            ...previous,
            version: previous.version + 1,
            status: 'approved',
            approval: { contentHash: previous.contentHash, at: new Date().toISOString() },
          };
          approved.markdown = renderMarkdown(approved, value.current.document.title);
          assertReviewExperience(approved, DESIGN_HANDOFF_SCHEMA);
          const archive = join(
            value.current.root,
            '.design/handoff-approvals',
            `${approved.contentHash}.json`,
          );
          if (!existsSync(archive)) atomicJson(archive, approved);
          atomicJson(path, approved);
          writeFileSync(path.replace(/\.json$/u, '.md'), approved.markdown);
          return;
        }
        const content =
          input.action === 'draft'
            ? contentFromFeedback(value, shareUrl)
            : enrichContent(input.content, value, shareUrl);
        if (
          input.action === 'update' &&
          (!previous || reviewDigest(previous.basis) !== reviewDigest(value.basis))
        )
          throw conflict('The review changed. Rebuild the draft before refining it.');
        const affectedScreens = [
          ...new Set(
            sections.flatMap((key) => content[key].map((item) => item.screenId).filter(Boolean)),
          ),
        ];
        const verificationGaps =
          value.current.verification.status === 'verified'
            ? []
            : [`Rendered design verification: ${value.current.verification.status}.`];
        for (const issue of value.current.verification.issues ?? [])
          if (issue.message && verificationGaps.length < 256) verificationGaps.push(issue.message);
        const reviewNotes = (value.feedback.ledger?.reviews ?? [])
          .filter((entry) => entry.review.overall?.trim())
          .map((entry) => ({ reviewId: entry.review.reviewId, text: entry.review.overall }));
        const title = value.current.document.title;
        const draft = {
          title,
          reviewNotes,
          kind: 'openplanr-design-review-handoff',
          schemaVersion: '1.0.0',
          version: (previous?.version ?? 0) + 1,
          status: 'draft',
          basis: value.basis,
          content,
          affectedScreens,
          verificationGaps,
          contentHash: reviewDigest({
            title,
            reviewNotes,
            basis: value.basis,
            content,
            affectedScreens,
            verificationGaps,
          }),
          markdown: '',
        };
        draft.markdown = renderMarkdown(draft, value.current.document.title);
        assertReviewExperience(draft, DESIGN_HANDOFF_SCHEMA);
        atomicJson(path, draft);
        writeFileSync(path.replace(/\.json$/u, '.md'), draft.markdown);
      });
    } finally {
      unlock();
    }
  } finally {
    unlockRender();
  }
  let synchronization;
  if (outgoing) {
    try {
      synchronization = await publishDesignReviewMetadata(file, outgoing.payload, {
        revisionId: outgoing.revisionId,
        env,
        fetchImpl,
        ...shareOptions,
      });
    } catch (error) {
      synchronization = { pending: true, error: error.message };
    }
  }
  return {
    ...readDesignHandoff(file, { env, ...shareOptions }),
    ...(synchronization ? { synchronization } : {}),
  };
}
