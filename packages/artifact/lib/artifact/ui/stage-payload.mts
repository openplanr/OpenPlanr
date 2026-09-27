const PRESENTATIONS = Object.freeze(['document', 'canvas']);

type ColorScheme = 'light' | 'dark';
type ViewMode = 'single' | 'variants' | 'split';
type Presentation = 'document' | 'canvas';
/** An envelope artifact as supplied; each field is validated or defaulted. */
interface ArtifactMetadataInput {
  id?: unknown;
  title?: unknown;
  sha256?: unknown;
  viewport?: { width?: unknown; height?: unknown } | null;
  colorScheme?: unknown;
}
/** A viewer as supplied; an unknown mode or presentation falls back. */
interface StageViewerInput {
  mode?: unknown;
  activeArtifactId?: string | { id?: unknown } | null;
  presentation?: unknown;
}
/** An artifact envelope as supplied; only its artifacts and viewer are read. */
interface StageEnvelopeInput {
  artifacts?: unknown;
  viewer?: StageViewerInput | null;
}

function positiveInteger(value: unknown, fallback: number) {
  // Number.isInteger does not narrow its argument to a number.
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : fallback;
}

function freezeArtifactMetadata(artifact: ArtifactMetadataInput | null, index: number) {
  if (!artifact || typeof artifact !== 'object') {
    throw new TypeError(`Artifact ${index + 1} must be an object.`);
  }
  if (typeof artifact.id !== 'string' || artifact.id.length === 0) {
    throw new TypeError(`Artifact ${index + 1} requires an id.`);
  }
  // includes accepts only its element type and does not narrow; a listed value is a scheme.
  return Object.freeze({
    id: artifact.id,
    title:
      typeof artifact.title === 'string' && artifact.title.length > 0
        ? artifact.title
        : `Artifact ${index + 1}`,
    sha256: typeof artifact.sha256 === 'string' ? artifact.sha256 : '',
    viewport: Object.freeze({
      width: positiveInteger(artifact.viewport?.width, 1440),
      height: positiveInteger(artifact.viewport?.height, 900),
    }),
    colorScheme: ['light', 'dark'].includes(artifact.colorScheme as string)
      ? (artifact.colorScheme as ColorScheme)
      : 'light',
  });
}

function requestedArtifactId(value: string | { id?: unknown } | null | undefined) {
  if (typeof value === 'string') return value;
  return typeof value?.id === 'string' ? value.id : '';
}

function availableId(artifacts: ReadonlyArray<{ id: string }>, requested: string, fallback = '') {
  return artifacts.some(({ id }) => id === requested) ? requested : fallback;
}

function normalizeViewMode(value: unknown, artifactCount: number) {
  if (artifactCount < 2) return 'single';
  // includes accepts only its element type and does not narrow; a listed value is a view mode.
  return ['single', 'variants', 'split'].includes(value as string)
    ? (value as ViewMode)
    : 'variants';
}

/**
 * Build the metadata-only value embedded in the shell document. Artifact HTML,
 * review state, and all unknown/machine metadata are intentionally excluded.
 * This module has no DOM side effects so hosted viewers can bundle it safely.
 */
export function createArtifactStagePayload(
  envelope: StageEnvelopeInput | null = {},
  { viewer }: { viewer?: StageViewerInput | null } = {},
) {
  const artifacts = Object.freeze(
    (Array.isArray(envelope?.artifacts) ? envelope.artifacts : []).map(freezeArtifactMetadata),
  );
  const sourceViewer: StageViewerInput =
    viewer && typeof viewer === 'object'
      ? viewer
      : envelope?.viewer && typeof envelope.viewer === 'object'
        ? envelope.viewer
        : {};
  const firstId = artifacts[0]?.id ?? '';
  const activeArtifactId = availableId(
    artifacts,
    requestedArtifactId(sourceViewer.activeArtifactId),
    firstId,
  );
  const mode = normalizeViewMode(sourceViewer.mode, artifacts.length);
  // includes accepts only its element type and does not narrow; a listed value is a presentation.
  return Object.freeze({
    schemaVersion: '1.0.0',
    artifacts,
    viewer: Object.freeze({
      mode,
      activeArtifactId,
      ...(PRESENTATIONS.includes(sourceViewer.presentation as string)
        ? { presentation: sourceViewer.presentation as Presentation }
        : {}),
    }),
  });
}
