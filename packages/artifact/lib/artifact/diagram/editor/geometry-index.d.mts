import type { DiagramAuthoringBundle, DiagramAuthoringValidationError, DiagramBounds, DiagramSemanticEntry } from '@openplanr/protocol/diagram-authoring-contracts';

export interface DiagramGeometryCamera { x: number; y: number; scale: number }
export interface DiagramGeometryRecord {
  id: string;
  collection: DiagramSemanticEntry['collection'];
  bounds: DiagramBounds | null;
  points: Array<{ x: number; y: number }>;
  labelBounds: DiagramBounds | null;
  zIndex: number;
  order: number;
}
export interface DiagramGeometryHit {
  id: string;
  collection: DiagramSemanticEntry['collection'];
  kind: 'bounds' | 'segment' | 'label';
  /** Distance from the pointer in screen pixels. */
  distance: number;
  zIndex: number;
}
export interface DiagramGeometryFailure { ok: false; diagnostics: DiagramAuthoringValidationError[] }
export interface DiagramGeometryStats {
  entries: number; primitives: number; cells: number; overflowPrimitives: number;
  fullBuilds: number; updates: number; validations: number; validatedElements: number;
  metadataEntriesScanned: number; geometryResolved: number;
  lastUpdateResolved: number; lastUpdateRemoved: number; lastMetadataEntriesScanned: number;
  queries: number; lastQueryCandidates: number; lastQueryChecks: number; lastQueryCells: number; lastQueryOverflow: number;
}
export interface DiagramGeometryIndex {
  /** Validate a revision, then refresh affected geometry and its dependencies. Equal revisions are no-ops. */
  update(bundle: DiagramAuthoringBundle, affectedIds: string[]): { ok: true; updatedIds: string[]; removedIds: string[]; diagnostics: [] } | DiagramGeometryFailure;
  /** x/y and optional tolerance (default 6) are screen pixels; screen = world * scale + camera offset. */
  query(input: { x: number; y: number; tolerance?: number; camera: DiagramGeometryCamera }): { ok: true; hits: DiagramGeometryHit[]; world: { x: number; y: number }; tolerance: number; diagnostics: [] } | DiagramGeometryFailure;
  /** Detached world geometry suitable for controls, without access to internal cache storage. */
  get(id: string): DiagramGeometryRecord | null;
  stats(): DiagramGeometryStats;
}
export declare function createDiagramGeometryIndex(bundle: DiagramAuthoringBundle): { ok: true; index: DiagramGeometryIndex; diagnostics: [] } | DiagramGeometryFailure;
