import type { DiagramAuthoringNodeKind } from '@openplanr/protocol/diagram-authoring-contracts';
import type { DiagramShapeDefinition } from '@openplanr/protocol/shape-library-contracts';
export interface DiagramShapeCatalogEntry {
  id: string;
  library: string;
  kind: DiagramAuthoringNodeKind | 'annotation' | 'container';
  definition: DiagramShapeDefinition;
}
export interface DiagramPattern {
  id: string;
  name: string;
  library: string;
  description: string;
  nodes: Array<{ shape: string; label: string; x: number; y: number }>;
  edges: Array<{ from: number; to: number; label?: string }>;
}
export const DIAGRAM_SHAPE_LIBRARIES: ReadonlyArray<{ id: string; name: string }>;
export const DIAGRAM_SHAPE_CATALOG: readonly DiagramShapeCatalogEntry[];
export const DIAGRAM_PATTERNS: readonly DiagramPattern[];
export function diagramShapeEntry(id: string): DiagramShapeCatalogEntry;
export function diagramPattern(id: string): DiagramPattern;
export function createDiagramShapeSearch(
  entries?: readonly DiagramShapeCatalogEntry[],
): (query?: string, library?: string) => DiagramShapeCatalogEntry[];
export function diagramShapeAllowed(
  entry: DiagramShapeCatalogEntry,
  capability: { primitives: readonly string[]; nodeKinds: readonly string[] } | null,
): boolean;
