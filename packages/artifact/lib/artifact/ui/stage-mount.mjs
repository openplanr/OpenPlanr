/** Dispatched on the window when a stage controller is mounted; `detail` is the controller. */
export const ARTIFACT_STAGE_MOUNT_EVENT = 'planr:artifact-stage-mount';

/** Publishes a mounted stage controller and resolves every pending `whenArtifactStage`. */
export function publishArtifactStage(window, stage) {
  window.__openPlanrArtifactStage = stage;
  window.dispatchEvent(new window.CustomEvent(ARTIFACT_STAGE_MOUNT_EVENT, { detail: stage }));
}

/**
 * Resolves with the stage controller mounted in `window`, now or once one is published.
 * Side-effect free, so bundles that sit beside the stage runtime can import it.
 */
export function whenArtifactStage(window) {
  const mounted = window.__openPlanrArtifactStage;
  if (mounted) return Promise.resolve(mounted);
  return new Promise((resolve) => {
    window.addEventListener(ARTIFACT_STAGE_MOUNT_EVENT, (event) => resolve(event.detail), {
      once: true,
    });
  });
}
