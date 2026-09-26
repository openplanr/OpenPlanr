import type {
  DiagramAppearance,
  DiagramAuthoringBundle,
  DiagramAuthoringValidationError,
} from '@openplanr/protocol/diagram-authoring-contracts';
import type {
  AuthoredDiagramScene,
  AuthoredDiagramSceneElement,
  DiagramSceneQuality,
} from './scene.mjs';

export interface AuthoredDiagramTheme {
  id: 'paper' | 'slate' | 'midnight';
  version: '1.0.0';
  background: string;
  surface: string;
  foreground: string;
  border: string;
  accent: string;
  muted: string;
  success: string;
  warning: string;
  danger: string;
  fontFamily: string;
  fontSize: number;
  fills: Record<DiagramAppearance['fill'], string>;
}
export interface AuthoredDiagramSvgResult {
  ok: true;
  svg: string;
  scene: AuthoredDiagramScene;
  quality: DiagramSceneQuality;
  renderer: { id: 'openplanr-authored-svg'; version: '1.0.0' };
  theme: AuthoredDiagramTheme;
  diagnostics: [];
}
export interface AuthoredDiagramRenderFailure {
  ok: false;
  code:
    | 'invalid-bundle'
    | 'invalid-options'
    | 'invalid-geometry'
    | 'no-visible-content'
    | 'focused-output-required';
  scene?: AuthoredDiagramScene;
  quality?: DiagramSceneQuality;
  diagnostics: DiagramAuthoringValidationError[];
}
export declare const AUTHORED_DIAGRAM_RENDERER: Readonly<{
  id: 'openplanr-authored-svg';
  version: '1.0.0';
}>;
/** Internal renderer palette shared by static output and the live editor. */
export declare function authoredDiagramPalette(
  themeId?: AuthoredDiagramTheme['id'],
): AuthoredDiagramTheme;
/** Render one resolved scene element as an SVG fragment at its saved geometry. */
export declare function renderAuthoredSceneElement(
  element: AuthoredDiagramSceneElement,
  theme: AuthoredDiagramTheme,
  diagramId: string,
): string;
export declare function renderAuthoredDiagramSvg(
  bundle: DiagramAuthoringBundle,
  options?: { theme?: 'paper' | 'slate' | 'midnight' },
): AuthoredDiagramSvgResult | AuthoredDiagramRenderFailure;
