/** Dispatched on the window when a stage controller is mounted; `detail` is the controller. */
export const ARTIFACT_STAGE_MOUNT_EVENT = 'planr:artifact-stage-mount';

/** A window that a stage controller is, or will be, published on. */
type StageWindow = Window & typeof globalThis & { __openPlanrArtifactStage?: object };
type StageMountEvent = CustomEvent<object>;

/** Publishes a mounted stage controller and resolves every pending `whenArtifactStage`. */
export function publishArtifactStage(window: StageWindow, stage: object) {
  window.__openPlanrArtifactStage = stage;
  window.dispatchEvent(new window.CustomEvent(ARTIFACT_STAGE_MOUNT_EVENT, { detail: stage }));
}

/**
 * Resolves with the stage controller mounted in `window`, now or once one is published.
 * Side-effect free, so bundles that sit beside the stage runtime can import it.
 */
export function whenArtifactStage(window: StageWindow) {
  const mounted = window.__openPlanrArtifactStage;
  if (mounted) return Promise.resolve(mounted);
  return new Promise<object>((resolve) => {
    // publishArtifactStage dispatches the mount event as a CustomEvent carrying the stage.
    // biome-ignore format: bundles keep this call's layout; wrapping would change their bytes.
    window.addEventListener(ARTIFACT_STAGE_MOUNT_EVENT, (event) => resolve((event as StageMountEvent).detail), {
      once: true,
    });
  });
}
