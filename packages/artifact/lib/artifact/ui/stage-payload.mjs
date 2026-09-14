const PRESENTATIONS = Object.freeze(['document', 'canvas']);

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function freezeArtifactMetadata(artifact, index) {
  if (!artifact || typeof artifact !== 'object') {
    throw new TypeError(`Artifact ${index + 1} must be an object.`);
  }
  if (typeof artifact.id !== 'string' || artifact.id.length === 0) {
    throw new TypeError(`Artifact ${index + 1} requires an id.`);
  }
  return Object.freeze({
    id: artifact.id,
    title: typeof artifact.title === 'string' && artifact.title.length > 0
      ? artifact.title
      : `Artifact ${index + 1}`,
    sha256: typeof artifact.sha256 === 'string' ? artifact.sha256 : '',
    viewport: Object.freeze({
      width: positiveInteger(artifact.viewport?.width, 1440),
      height: positiveInteger(artifact.viewport?.height, 900),
    }),
    colorScheme: ['light', 'dark'].includes(artifact.colorScheme)
      ? artifact.colorScheme
      : 'light',
  });
}

function requestedArtifactId(value) {
  if (typeof value === 'string') return value;
  return typeof value?.id === 'string' ? value.id : '';
}

function availableId(artifacts, requested, fallback = '') {
  return artifacts.some(({ id }) => id === requested) ? requested : fallback;
}

function normalizeViewMode(value, artifactCount) {
  if (artifactCount < 2) return 'single';
  return ['single', 'variants', 'split'].includes(value) ? value : 'variants';
}

/**
 * Build the metadata-only value embedded in the shell document. Artifact HTML,
 * review state, and all unknown/machine metadata are intentionally excluded.
 * This module has no DOM side effects so hosted viewers can bundle it safely.
 */
export function createArtifactStagePayload(envelope = {}, { viewer } = {}) {
  const artifacts = Object.freeze(
    (Array.isArray(envelope?.artifacts) ? envelope.artifacts : []).map(freezeArtifactMetadata),
  );
  const sourceViewer = viewer && typeof viewer === 'object'
    ? viewer
    : (envelope?.viewer && typeof envelope.viewer === 'object' ? envelope.viewer : {});
  const firstId = artifacts[0]?.id ?? '';
  const activeArtifactId = availableId(
    artifacts,
    requestedArtifactId(sourceViewer.activeArtifactId),
    firstId,
  );
  const mode = normalizeViewMode(sourceViewer.mode, artifacts.length);
  return Object.freeze({
    schemaVersion: '1.0.0',
    artifacts,
    viewer: Object.freeze({
      mode,
      activeArtifactId,
      ...(PRESENTATIONS.includes(sourceViewer.presentation)
        ? { presentation: sourceViewer.presentation }
        : {}),
    }),
  });
}
