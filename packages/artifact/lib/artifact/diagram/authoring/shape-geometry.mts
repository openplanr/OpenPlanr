import type {
  DiagramBoundaryAttachment,
  DiagramBounds,
} from '@openplanr/protocol/diagram-authoring-contracts';
import type {
  ShapeDefinition,
  ShapeOutline,
  ShapePrimitive,
  ShapeReference,
} from '@openplanr/protocol/shape-library-contracts';
import { escapeXml } from '../rendering/svg.mjs';

type Point = { x: number; y: number };
export interface CompiledDiagramShape {
  primitives: ShapePrimitive[];
  attachment: ShapeOutline;
  textRegion: DiagramBounds;
}
const cache = new Map<string, CompiledDiagramShape>();
const CACHE_LIMIT = 512;
const n = (value: number) => String(Number(value.toFixed(6)));

function scaleOutline(shape: ShapeOutline, bounds: DiagramBounds): ShapeOutline {
  const { x, y, width, height } = bounds;
  if (shape.type === 'polygon')
    return {
      ...shape,
      points: shape.points.map((point) => ({ x: x + point.x * width, y: y + point.y * height })),
    };
  if (shape.type === 'ellipse')
    return {
      ...shape,
      cx: x + shape.cx * width,
      cy: y + shape.cy * height,
      rx: shape.rx * width,
      ry: shape.ry * height,
    };
  return {
    ...shape,
    x: x + shape.x * width,
    y: y + shape.y * height,
    width: shape.width * width,
    height: shape.height * height,
    radius: shape.radius * Math.min(width, height),
  };
}

/** Compile a validated immutable definition into shared world geometry. */
export function compileDiagramShape(
  definition: ShapeDefinition,
  bounds: DiagramBounds,
): CompiledDiagramShape {
  const key = `${definition.definitionDigest}:${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`;
  const found = cache.get(key);
  if (found) return found;
  const primitives = definition.primitives.map((primitive): ShapePrimitive => {
    if (primitive.type === 'line')
      return {
        ...primitive,
        x1: bounds.x + primitive.x1 * bounds.width,
        y1: bounds.y + primitive.y1 * bounds.height,
        x2: bounds.x + primitive.x2 * bounds.width,
        y2: bounds.y + primitive.y2 * bounds.height,
      };
    return { ...primitive, ...scaleOutline(primitive, bounds) } as ShapePrimitive;
  });
  const region = definition.textRegion;
  const result = {
    primitives,
    attachment: scaleOutline(definition.attachment, bounds),
    textRegion: {
      x: bounds.x + region.x * bounds.width,
      y: bounds.y + region.y * bounds.height,
      width: region.width * bounds.width,
      height: region.height * bounds.height,
    },
  };
  for (const primitive of [...primitives, result.attachment]) {
    if (primitive.type === 'polygon') {
      primitive.points.forEach(Object.freeze);
      Object.freeze(primitive.points);
    }
    Object.freeze(primitive);
  }
  Object.freeze(primitives);
  Object.freeze(result.textRegion);
  Object.freeze(result);
  if (cache.size >= CACHE_LIMIT) {
    const first = cache.keys().next();
    if (!first.done) cache.delete(first.value);
  }
  cache.set(key, result);
  return result;
}

/** Resolve a pinned definition after document validation. */
export function findDiagramShape(library: ShapeDefinition[], ref: ShapeReference): ShapeDefinition {
  const definition = library.find(
    (entry) =>
      entry.packId === ref.packId &&
      entry.packVersion === ref.packVersion &&
      entry.shapeId === ref.shapeId &&
      entry.definitionDigest === ref.definitionDigest,
  );
  if (!definition)
    throw new Error(
      `Missing shape definition ${ref.packId}/${ref.shapeId}@${ref.packVersion} (${ref.definitionDigest}).`,
    );
  return definition;
}

function segmentDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length));
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

/** Negative values are inside the declared convex attachment outline. */
export function diagramShapeInterior(point: Point, outline: ShapeOutline): number {
  if (outline.type === 'ellipse')
    return (
      ((point.x - outline.cx) / outline.rx) ** 2 + ((point.y - outline.cy) / outline.ry) ** 2 - 1
    );
  if (outline.type === 'rect') {
    const radius = Math.min(outline.radius, outline.width / 2, outline.height / 2);
    const dx = Math.abs(point.x - outline.x - outline.width / 2) - (outline.width / 2 - radius);
    const dy = Math.abs(point.y - outline.y - outline.height / 2) - (outline.height / 2 - radius);
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
  }
  const points = outline.points;
  const area = points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p.x * q.y - q.x * p.y;
  }, 0);
  const sign = area >= 0 ? 1 : -1;
  return Math.max(
    ...points.map((p, i) => {
      const q = points[(i + 1) % points.length];
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      return (-sign * ((q.x - p.x) * (point.y - p.y) - (q.y - p.y) * (point.x - p.x))) / length;
    }),
  );
}

/** Distance in world units for pointer tolerance around the visible outline. */
export function diagramShapeDistance(point: Point, outline: ShapeOutline): number {
  if (diagramShapeInterior(point, outline) <= 0) return 0;
  if (outline.type === 'rect') return diagramShapeInterior(point, outline);
  if (outline.type === 'polygon')
    return Math.min(
      ...outline.points.map((p, i) =>
        segmentDistance(point, p, outline.points[(i + 1) % outline.points.length]),
      ),
    );
  const dx = Math.abs(point.x - outline.cx),
    dy = Math.abs(point.y - outline.cy);
  let low = 0,
    high = Math.PI / 2;
  for (let i = 0; i < 40; i++) {
    const a = low + (high - low) / 3,
      b = high - (high - low) / 3;
    const distance = (t: number) =>
      Math.hypot(dx - outline.rx * Math.cos(t), dy - outline.ry * Math.sin(t));
    if (distance(a) < distance(b)) high = b;
    else low = a;
  }
  const t = (low + high) / 2;
  return Math.hypot(dx - outline.rx * Math.cos(t), dy - outline.ry * Math.sin(t));
}

/** Resolve saved side/offset intent against the same outline used for hit testing. */
export function diagramShapeAttachment(
  compiled: CompiledDiagramShape,
  _bounds: DiagramBounds,
  attachment: DiagramBoundaryAttachment,
): Point {
  const shape = compiled.attachment;
  const horizontal = attachment.side === 'left' || attachment.side === 'right';
  const negative = attachment.side === 'left' || attachment.side === 'top';
  const extent =
    shape.type === 'polygon'
      ? {
          x: Math.min(...shape.points.map((p) => p.x)),
          y: Math.min(...shape.points.map((p) => p.y)),
          right: Math.max(...shape.points.map((p) => p.x)),
          bottom: Math.max(...shape.points.map((p) => p.y)),
        }
      : shape.type === 'ellipse'
        ? {
            x: shape.cx - shape.rx,
            y: shape.cy - shape.ry,
            right: shape.cx + shape.rx,
            bottom: shape.cy + shape.ry,
          }
        : { x: shape.x, y: shape.y, right: shape.x + shape.width, bottom: shape.y + shape.height };
  const fixed = horizontal
    ? extent.y + (extent.bottom - extent.y) * attachment.offset
    : extent.x + (extent.right - extent.x) * attachment.offset;
  const values: number[] = [];
  if (shape.type === 'polygon') {
    for (let i = 0; i < shape.points.length; i++) {
      const a = shape.points[i],
        b = shape.points[(i + 1) % shape.points.length];
      const start = horizontal ? a.y : a.x,
        end = horizontal ? b.y : b.x;
      if (fixed < Math.min(start, end) - 1e-8 || fixed > Math.max(start, end) + 1e-8) continue;
      if (start === end) values.push(horizontal ? a.x : a.y, horizontal ? b.x : b.y);
      else {
        const t = (fixed - start) / (end - start);
        values.push(horizontal ? a.x + (b.x - a.x) * t : a.y + (b.y - a.y) * t);
      }
    }
  } else if (shape.type === 'ellipse') {
    const center = horizontal ? shape.cy : shape.cx,
      radius = horizontal ? shape.ry : shape.rx;
    const extent =
      (horizontal ? shape.rx : shape.ry) *
      Math.sqrt(Math.max(0, 1 - ((fixed - center) / radius) ** 2));
    values.push(
      (horizontal ? shape.cx : shape.cy) - extent,
      (horizontal ? shape.cx : shape.cy) + extent,
    );
  } else {
    const start = horizontal ? shape.y : shape.x,
      size = horizontal ? shape.height : shape.width;
    const radius = Math.min(shape.radius, shape.width / 2, shape.height / 2);
    const delta = Math.max(start + radius - fixed, fixed - (start + size - radius), 0);
    const inset = radius - Math.sqrt(Math.max(0, radius ** 2 - delta ** 2));
    values.push(
      (horizontal ? shape.x : shape.y) + inset,
      (horizontal ? shape.x + shape.width : shape.y + shape.height) - inset,
    );
  }
  if (!values.length)
    throw new Error(
      `Shape outline has no ${attachment.side} attachment at offset ${attachment.offset}.`,
    );
  const variable = negative ? Math.min(...values) : Math.max(...values);
  return horizontal ? { x: variable, y: fixed } : { x: fixed, y: variable };
}

/** Render compiled primitives without embedding executable SVG or external resources. */
export function renderCompiledDiagramShape(
  shape: CompiledDiagramShape,
  paint: {
    fill: string;
    stroke: string;
    strokeWidth: number;
    strokeStyle?: 'solid' | 'dashed' | 'dotted';
  },
): string {
  return shape.primitives
    .map((primitive) => {
      const fill = 'fill' in primitive && primitive.fill === 'fill' ? paint.fill : 'none';
      const stroke = primitive.stroke === 'stroke' ? paint.stroke : 'none';
      const dash =
        paint.strokeStyle === 'dashed'
          ? ' stroke-dasharray="7 5"'
          : paint.strokeStyle === 'dotted'
            ? ' stroke-dasharray="2 4" stroke-linecap="round"'
            : '';
      const common = `fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${n(paint.strokeWidth)}"${dash}`;
      if (primitive.type === 'rect')
        return `<rect x="${n(primitive.x)}" y="${n(primitive.y)}" width="${n(primitive.width)}" height="${n(primitive.height)}" rx="${n(primitive.radius)}" ${common}/>`;
      if (primitive.type === 'ellipse')
        return `<ellipse cx="${n(primitive.cx)}" cy="${n(primitive.cy)}" rx="${n(primitive.rx)}" ry="${n(primitive.ry)}" ${common}/>`;
      if (primitive.type === 'line')
        return `<line x1="${n(primitive.x1)}" y1="${n(primitive.y1)}" x2="${n(primitive.x2)}" y2="${n(primitive.y2)}" ${common}/>`;
      return `<polygon points="${primitive.points.map((p) => `${n(p.x)},${n(p.y)}`).join(' ')}" ${common}/>`;
    })
    .join('');
}

export function renderDiagramShapeSvg(
  definition: ShapeDefinition,
  bounds: DiagramBounds,
  paint: Parameters<typeof renderCompiledDiagramShape>[1],
): string {
  return renderCompiledDiagramShape(compileDiagramShape(definition, bounds), paint);
}
