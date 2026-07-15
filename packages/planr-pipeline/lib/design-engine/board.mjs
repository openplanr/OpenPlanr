/**
 * Design-board document adapter.
 *
 * The artifact review shell is the only chrome. Design-specific ratings,
 * regeneration, presence and legacy feedback persistence are mounted by the
 * browser adapter loaded through the daemon's trusted runtime endpoint.
 */
import { createArtifactEnvelope } from '../artifact/envelope.mjs';
import { renderArtifactShellDocument } from '../artifact/ui/shell.mjs';

export const DESIGN_BOARD_ENVELOPE_FILE = '.planr-artifact-envelope.json';
export const DESIGN_BOARD_SOURCES_FILE = '.planr-artifact-sources.json';

function fallbackEnvelope(variants = []) {
  const artifacts = variants.map((variant, index) => ({
    id: String(variant.id ?? `variant-${index + 1}`),
    kind: 'html',
    title: String(variant.label ?? variant.id ?? `Variant ${index + 1}`),
    html: '<!doctype html><html><head></head><body><p>Artifact source is loading.</p></body></html>',
    viewport: { width: 1440, height: 1024 },
    colorScheme: 'light',
  }));
  return createArtifactEnvelope({
    artifacts: artifacts.length > 0 ? artifacts : [{
      id: 'artifact',
      kind: 'html',
      title: 'Design artifact',
      html: '<!doctype html><html><head></head><body><p>No design artifact is available.</p></body></html>',
      viewport: { width: 1440, height: 1024 },
      colorScheme: 'light',
    }],
    viewer: {
      mode: artifacts.length > 1 ? 'variants' : 'single',
      activeArtifactId: artifacts[0]?.id ?? 'artifact',
      presentation: 'canvas',
    },
  });
}

export function renderBoardHtml({
  title = 'OpenPlanr design review',
  mode = 'loop',
  variants = [],
  envelope,
} = {}) {
  const source = envelope ?? fallbackEnvelope(variants);
  return renderArtifactShellDocument({
    envelope: source,
    viewer: source.viewer,
    shell: {
      title,
      privacy: 'local',
      theme: 'auto',
      railOpen: true,
      feedbackCount: source.review?.pins?.length ?? 0,
      zoom: 72,
      mode,
    },
  }, { stageRuntimeUrl: './runtime.js' });
}
