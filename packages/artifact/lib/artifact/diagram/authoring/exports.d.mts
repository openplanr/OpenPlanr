import type {
  DiagramAuthoringBundle,
  DiagramAuthoringManifest,
  DiagramAuthoringValidationError,
} from '@openplanr/protocol/diagram-authoring-contracts';
import type { AuthoredDiagramTheme } from './renderer.mjs';
import type { AuthoredDiagramScene, DiagramSceneQuality } from './scene.mjs';

export interface AuthoredDiagramExportOptions {
  root: string;
  slug?: string;
  /** Node adapter seam for deterministic rasterization and failure verification. */
  rasterize?: (
    svg: string,
    options: { scale: number; theme: AuthoredDiagramTheme },
  ) => { bytes: Uint8Array } | Promise<{ bytes: Uint8Array }>;
}
export interface AuthoredDiagramExportFailure {
  ok: false;
  code: string;
  diagnostics: DiagramAuthoringValidationError[];
  scene?: AuthoredDiagramScene;
  quality?: DiagramSceneQuality;
}
export interface VerifiedAuthoredDiagramExports {
  ok: true;
  directory: string;
  manifest: DiagramAuthoringManifest;
  quality: DiagramSceneQuality;
}
export interface AuthoredDiagramExportResult extends VerifiedAuthoredDiagramExports {
  status: 'created' | 'unchanged';
  scene: AuthoredDiagramScene;
  theme: AuthoredDiagramTheme;
}
/** Interrupted export locks require explicit recovery after confirming the exporter is inactive. */
export declare function exportAuthoredDiagram(
  bundle: DiagramAuthoringBundle,
  options: AuthoredDiagramExportOptions,
): Promise<AuthoredDiagramExportResult | AuthoredDiagramExportFailure>;
/**
 * Verify exact snapshot bytes, rederived SVG/HTML, and PNG digest/dimensions.
 * This is custody verification, not authentication of a replaced PNG and manifest.
 */
export declare function verifyAuthoredDiagramExports(
  bundle: DiagramAuthoringBundle,
  options: Omit<AuthoredDiagramExportOptions, 'rasterize'>,
): Promise<VerifiedAuthoredDiagramExports | AuthoredDiagramExportFailure>;
