import { assertProtocolArtifact } from '../../../protocol/contracts.mjs';
import { withDocumentDigest } from '../../../protocol/canonical-json.mjs';
import { DIAGRAM_GRAMMAR_REGISTRY } from '../../../protocol/diagram-contracts.mjs';

import { DIAGRAM_RENDERER, DIAGRAM_THEME } from '../rendering/theme.mjs';

export function createDiagramRenderManifest(document, { source, outputs }) {
  const manifest = withDocumentDigest({
    kind: 'diagram-manifest',
    schemaVersion: '1.0.0',
    protocolVersion: '1.6.0',
    documentVersion: '1.0.0',
    digestAlgorithm: 'sha256',
    canonicalization: 'rfc8785',
    diagramId: document.diagramId,
    source,
    registry: {
      path: 'registry/v1.6.0/diagram-grammars.json',
      digest: DIAGRAM_GRAMMAR_REGISTRY.documentDigest,
      grammarId: document.grammar.id,
      grammarVersion: document.grammar.version,
    },
    renderer: { id: DIAGRAM_RENDERER.id, version: DIAGRAM_RENDERER.version },
    theme: { id: DIAGRAM_THEME.id, version: DIAGRAM_THEME.version },
    outputs: [...outputs].sort((left, right) => left.path.localeCompare(right.path)),
  });
  assertProtocolArtifact('diagram-manifest', manifest, { protocolVersion: '1.6.0' });
  return manifest;
}

export function assertDiagramRenderManifest(manifest, { slug = null } = {}) {
  assertProtocolArtifact('diagram-manifest', manifest, { protocolVersion: '1.6.0' });
  if (slug && manifest.diagramId !== slug) {
    throw new TypeError(`Diagram manifest identity mismatch: expected ${slug}, received ${manifest.diagramId}.`);
  }
  return manifest;
}
