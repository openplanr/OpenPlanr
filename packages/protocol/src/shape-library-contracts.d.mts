export interface ShapeReference {
  packId: string;
  packVersion: string;
  shapeId: string;
  definitionDigest: string;
}
export type DiagramShapeReference = ShapeReference;
export interface ShapePoint {
  x: number;
  y: number;
}
export interface ShapeRect {
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}
export interface ShapeEllipse {
  type: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}
export interface ShapePolygon {
  type: 'polygon';
  points: ShapePoint[];
}
export type ShapeOutline = ShapeRect | ShapeEllipse | ShapePolygon;
export type ShapePrimitive =
  | (ShapeOutline & { fill: 'fill' | 'none'; stroke: 'stroke' | 'none' })
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: 'stroke' | 'none' };
export interface ShapeDefinition extends ShapeReference {
  name: string;
  description: string;
  tags: string[];
  primitives: ShapePrimitive[];
  attachment: ShapeOutline;
  textRegion: { x: number; y: number; width: number; height: number };
  sizing: { width: number; height: number; minWidth: number; minHeight: number };
}
export type DiagramShapeDefinition = ShapeDefinition;
export declare const SHAPE_REFERENCE_SCHEMA: Record<string, unknown>;
export declare const SHAPE_DEFINITION_SCHEMA: Record<string, unknown>;
export declare const SHAPE_LIBRARY_SCHEMA: Record<string, unknown>;
export declare function shapeReferenceKey(value: ShapeReference): string;
export declare function shapeDefinitionDigest(
  value: Omit<ShapeDefinition, 'definitionDigest'> | ShapeDefinition,
): string;
export declare function assertShapeDefinition<T>(value: T): T;
export declare function assertShapeLibrary<T>(value: T): T;
export declare function assertShapeReference(
  value: ShapeReference,
  library: ShapeDefinition[] | null | undefined,
): ShapeDefinition;
