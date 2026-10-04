/** Read committed feedback without loading the Studio server or browser assets. */
import { join } from 'node:path';
import { digestArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';
import { resolveArtifactReviewDestination } from '@openplanr/artifact/import.mjs';
import { readArtifactReviewState } from '@openplanr/artifact/review.mjs';
import { currentDesign, hash, readJson } from './document-state.mjs';

export const designReviewKey = (document) => `design-${hash(document.id).slice(0, 24)}`;
export function designReviewPath(file, env = process.env, options = {}) {
  const { root, document } = currentDesign(file, options);
  return resolveArtifactReviewDestination({
    cwd: root,
    env,
    artifactId: designReviewKey(document),
  }).path;
}
export function readDesignFeedback(file, env = process.env, options = {}) {
  const current = currentDesign(file, options);
  const ledger = readArtifactReviewState(designReviewPath(file, env, options), {
    allowMissing: true,
  });
  const digest = digestArtifactEnvelope(current.envelope);
  const pins = (ledger?.reviews ?? []).flatMap((entry) =>
    entry.review.pins.map((pin) => {
      const target = current.entries.find((item) => item.artifactId === pin.artifactId);
      const screen = target && current.document.screens.find((item) => item.id === target.screenId);
      const anchorMissing =
        pin.anchor?.planrId &&
        screen?.anchors?.length &&
        !screen.anchors.includes(pin.anchor.planrId) &&
        pin.anchor.planrId !== screen.id;
      return {
        ...pin,
        reviewId: entry.review.reviewId,
        reviewOf: entry.review.reviewOf,
        ...(entry.review.reviewId.startsWith('shared-')
          ? { revisionId: entry.review.reviewId.slice(7) }
          : {}),
        stale: entry.stale || entry.review.reviewOf !== digest || !target || Boolean(anchorMissing),
        ...(target ? { screenId: target.screenId, variantId: target.variantId } : {}),
      };
    }),
  );
  return {
    revision: current.revision,
    reviewPath: designReviewPath(file, env, options),
    pins,
    state: readJson(join(current.root, '.design/studio-state.json'), {
      state: {},
      stateVersion: 0,
    }).state,
    ledger,
    shared: readJson(join(current.root, '.design/shared-feedback.json'), null),
  };
}
