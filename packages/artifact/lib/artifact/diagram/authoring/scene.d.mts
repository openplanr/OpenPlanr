import type {
  DiagramAppearance,
  DiagramAuthoringBundle,
  DiagramAuthoringSnapshot,
  DiagramAuthoringValidationError,
  DiagramBoundaryAttachment,
  DiagramBounds,
  DiagramGeometryLocks,
  DiagramPlacement,
  DiagramRoute,
  DiagramSemanticEntry,
} from '@openplanr/protocol/diagram-authoring-contracts';

export interface DiagramSceneDiagnostic extends DiagramAuthoringValidationError {
  elementIds: string[];
  severity: 'error' | 'warning';
}
export interface DiagramSceneQuality {
  status: 'pass' | 'warning' | 'no-visible-content' | 'focused-output-required' | 'invalid';
  diagnostics: DiagramSceneDiagnostic[];
}
export interface DiagramSceneText {
  lines: string[];
  bounds: DiagramBounds;
  fontSize: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  x: number;
  baseline: number;
}
export interface AuthoredDiagramSceneElement {
  id: string;
  collection: DiagramSemanticEntry['collection'];
  semantic: DiagramSemanticEntry['value'];
  kind: string;
  label: string;
  description: string;
  bounds: DiagramBounds | null;
  savedLabel: { x: number; y: number; width: number } | null;
  zIndex: number;
  order: number;
  appearance: DiagramAppearance;
  locks: DiagramGeometryLocks;
  emphasis: 'primary' | 'secondary' | 'muted' | null;
  text: DiagramSceneText | null;
  lines: string[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  from?: string;
  to?: string;
  direction?: 'forward' | 'both' | 'none';
  route?: DiagramRoute;
  points?: Array<{ x: number; y: number }>;
  routePoints?: Array<[number, number]>;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  labelBounds?: DiagramBounds | null;
  labelLines?: string[];
}
export interface AuthoredDiagramScene {
  kind: 'diagram-authored-scene';
  schemaVersion: '1.0.0';
  diagramId: string;
  basis: DiagramAuthoringSnapshot;
  viewBox: DiagramBounds;
  width: number;
  height: number;
  elements: AuthoredDiagramSceneElement[];
  boxes: AuthoredDiagramSceneElement[];
  groups: AuthoredDiagramSceneElement[];
  lanes: AuthoredDiagramSceneElement[];
  edges: AuthoredDiagramSceneElement[];
  notes: AuthoredDiagramSceneElement[];
  labelBounds: Array<DiagramBounds & { id: string }>;
  quality: DiagramSceneQuality;
}
export interface DiagramSceneFailure {
  ok: false;
  code: 'invalid-bundle';
  diagnostics: DiagramAuthoringValidationError[];
}
export declare const AUTHORED_SCENE_ITEM_BUDGET: 256;
export declare const AUTHORED_MINIMUM_FONT_SIZE: 12;
/** Internal shared geometry for rendering and the editor index; inputs are validated. */
export declare function resolveDiagramSceneElement(
  entry: DiagramSemanticEntry,
  placement: DiagramPlacement,
  placements: Map<string, DiagramPlacement>,
  order: number,
  emphasisLevel?: AuthoredDiagramSceneElement['emphasis'],
  diagnostics?: DiagramSceneDiagnostic[],
): AuthoredDiagramSceneElement;
export declare function resolveDiagramScene(
  bundle: DiagramAuthoringBundle,
): { ok: true; scene: AuthoredDiagramScene; diagnostics: [] } | DiagramSceneFailure;
/** Resolve a validated attachment intent against the supported visible shape boundary. */
export declare function resolveShapeAttachment(
  bounds: DiagramBounds,
  shape: DiagramAppearance['shape'],
  attachment: DiagramBoundaryAttachment,
): { x: number; y: number };
