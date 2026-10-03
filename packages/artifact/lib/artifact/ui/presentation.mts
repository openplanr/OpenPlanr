/** One runtime presentation policy, shared by generated markup and mounted stage reducers. */
export type ArtifactPresentation = 'document' | 'canvas';
export function resolveArtifactPresentation(
  value: unknown,
  {
    mode,
    viewMode = mode ?? 'single',
    artifactCount = 1,
  }: { mode?: string; viewMode?: string; artifactCount?: number } = {},
): ArtifactPresentation {
  if (value === 'document' || value === 'canvas') return value;
  return artifactCount > 1 || viewMode === 'variants' || viewMode === 'split'
    ? 'canvas'
    : 'document';
}
