/** Resolve canonical HTML without expanding shared source pools into every viewport record. */
import { ARTIFACT_ERROR_CODES, PipelineError } from '@openplanr/protocol/errors';

export const ARTIFACT_SHARED_ENVELOPE_VERSION = '1.1.0';
export const ARTIFACT_MAX_SOURCES = 256;
export const ARTIFACT_MAX_VIEWS = 4096;

/** Resolve a validated envelope's own artifact by id, preserving legacy inline sources. */
export function resolveArtifactHtml(envelope, artifactOrId) {
  const id = typeof artifactOrId === 'string' ? artifactOrId : artifactOrId?.id;
  const artifact = envelope?.artifacts?.find((value) => value.id === id);
  const source =
    envelope?.schemaVersion === ARTIFACT_SHARED_ENVELOPE_VERSION
      ? envelope.sources?.find((value) => value.id === artifact?.sourceId)
      : artifact;
  if (!artifact || typeof source?.html !== 'string' || source.sha256 !== artifact.sha256) {
    throw new PipelineError(
      ARTIFACT_ERROR_CODES.ENVELOPE_INVALID,
      'Artifact source is missing or does not match its viewport reference.',
    );
  }
  return source.html;
}
