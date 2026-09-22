import type { DiagramAuthoringBundle, DiagramAuthoringValidationError, DiagramAppearance } from '@openplanr/protocol/diagram-authoring-contracts';
import type { AuthoredDiagramScene, DiagramSceneQuality } from './scene.mjs';

export interface AuthoredDiagramTheme {
  id: 'paper' | 'slate' | 'midnight'; version: '1.0.0';
  background: string; surface: string; foreground: string; border: string; accent: string; muted: string;
  success: string; warning: string; danger: string; fontFamily: string; fontSize: number;
  fills: Record<DiagramAppearance['fill'], string>;
}
export interface AuthoredDiagramSvgResult {
  ok: true; svg: string; scene: AuthoredDiagramScene; quality: DiagramSceneQuality;
  renderer: { id: 'openplanr-authored-svg'; version: '1.0.0' }; theme: AuthoredDiagramTheme; diagnostics: [];
}
export interface AuthoredDiagramRenderFailure {
  ok: false; code: 'invalid-bundle' | 'invalid-options' | 'invalid-geometry' | 'no-visible-content' | 'focused-output-required';
  scene?: AuthoredDiagramScene; quality?: DiagramSceneQuality; diagnostics: DiagramAuthoringValidationError[];
}
export declare const AUTHORED_DIAGRAM_RENDERER: Readonly<{ id: 'openplanr-authored-svg'; version: '1.0.0' }>;
export declare function renderAuthoredDiagramSvg(bundle: DiagramAuthoringBundle, options?: { theme?: 'paper' | 'slate' | 'midnight' }): AuthoredDiagramSvgResult | AuthoredDiagramRenderFailure;
