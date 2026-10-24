import { canonicalizeJson, sha256Hex } from './canonical-json.mjs';
import { assertDiagramData } from './diagram-authoring-contracts.mjs';
import { validateJson } from './json-schema.mjs';

const closed = (properties) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const unit = { type: 'number', minimum: 0, maximum: 1 };
const extent = { type: 'number', exclusiveMinimum: 0, maximum: 1 };
const point = closed({ x: unit, y: unit });
const identifier = { type: 'string', pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$', maxLength: 128 };
const version = { type: 'string', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$', maxLength: 32 };
const digest = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const rect = {
  type: { const: 'rect' },
  x: unit,
  y: unit,
  width: extent,
  height: extent,
  radius: unit,
};
const ellipse = { type: { const: 'ellipse' }, cx: unit, cy: unit, rx: extent, ry: extent };
const polygon = {
  type: { const: 'polygon' },
  points: { type: 'array', minItems: 3, maxItems: 32, items: point },
};
const paint = { fill: { enum: ['fill', 'none'] }, stroke: { enum: ['stroke', 'none'] } };
const pixels = { type: 'number', minimum: 1, maximum: 10000 };

export const SHAPE_REFERENCE_SCHEMA = closed({
  packId: identifier,
  packVersion: version,
  shapeId: identifier,
  definitionDigest: digest,
});
export const SHAPE_DEFINITION_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://openplanr.dev/schemas/v1.21.0/diagram-shape-definition.schema.json',
  'x-openplanr-contract': { id: 'diagram-shape-definition', version: '1.21.0' },
  ...closed({
    ...SHAPE_REFERENCE_SCHEMA.properties,
    name: { type: 'string', minLength: 1, maxLength: 128 },
    description: { type: 'string', maxLength: 1024 },
    tags: {
      type: 'array',
      maxItems: 16,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 64 },
    },
    primitives: {
      type: 'array',
      minItems: 1,
      maxItems: 32,
      items: {
        oneOf: [
          closed({ ...rect, ...paint }),
          closed({ ...ellipse, ...paint }),
          closed({ ...polygon, ...paint }),
          closed({
            type: { const: 'line' },
            x1: unit,
            y1: unit,
            x2: unit,
            y2: unit,
            stroke: paint.stroke,
          }),
        ],
      },
    },
    attachment: { oneOf: [closed(rect), closed(ellipse), closed(polygon)] },
    textRegion: closed({ x: unit, y: unit, width: extent, height: extent }),
    sizing: closed({ width: pixels, height: pixels, minWidth: pixels, minHeight: pixels }),
  }),
};
export const SHAPE_LIBRARY_SCHEMA = {
  type: 'array',
  maxItems: 512,
  items: SHAPE_DEFINITION_SCHEMA,
};

export function shapeReferenceKey(value) {
  return `${value.packId}@${value.packVersion}/${value.shapeId}`;
}

export function shapeDefinitionDigest(value) {
  assertDiagramData(value);
  const { definitionDigest: _digest, ...definition } = value;
  return `sha256:${sha256Hex(canonicalizeJson(definition))}`;
}

function assertConvexPolygon(points, label) {
  let orientation = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const c = points[(index + 2) % points.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (a.x === b.x && a.y === b.y)
      throw new TypeError(`${label}: polygon has duplicate adjacent points.`);
    if (cross !== 0) {
      if (orientation !== 0 && Math.sign(cross) !== orientation)
        throw new TypeError(`${label}: polygon must be convex.`);
      orientation = Math.sign(cross);
    }
  }
  if (orientation === 0) throw new TypeError(`${label}: polygon has no area.`);
  // Every other vertex must lie on the same side of each edge, excluding self intersections.
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    for (const c of points) {
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (cross * orientation < -1e-10)
        throw new TypeError(`${label}: polygon must be simple and convex.`);
    }
  }
}

function assertGeometry(value, label) {
  if (value.type === 'ellipse') {
    if (
      value.cx - value.rx < 0 ||
      value.cy - value.ry < 0 ||
      value.cx + value.rx > 1 ||
      value.cy + value.ry > 1
    )
      throw new TypeError(`${label}: ellipse exceeds normalized bounds.`);
  } else if (value.type === 'polygon') {
    assertConvexPolygon(value.points, label);
  } else if (value.type !== 'line') {
    if (
      value.x + value.width > 1 ||
      value.y + value.height > 1 ||
      (value.radius ?? 0) > Math.min(value.width, value.height) / 2
    )
      throw new TypeError(`${label}: rectangle exceeds normalized bounds or radius.`);
  }
}

export function assertShapeDefinition(value) {
  assertDiagramData(value);
  const failures = validateJson(value, SHAPE_DEFINITION_SCHEMA);
  if (failures.length)
    throw new TypeError(
      `Invalid shape definition: ${failures[0].path} ${failures[0].detail ?? failures[0].rule}.`,
    );
  const key = shapeReferenceKey(value);
  if (shapeDefinitionDigest(value) !== value.definitionDigest)
    throw new TypeError(`Shape ${key}: definition digest does not match.`);
  for (const primitive of value.primitives) assertGeometry(primitive, `Shape ${key}`);
  assertGeometry(value.attachment, `Shape ${key} attachment`);
  const { fill: _fill, stroke: _stroke, ...outline } = value.primitives[0];
  if (canonicalizeJson(outline) !== canonicalizeJson(value.attachment))
    throw new TypeError(`Shape ${key}: first primitive must match its attachment outline.`);
  assertGeometry(value.textRegion, `Shape ${key} text region`);
  if (value.sizing.width < value.sizing.minWidth || value.sizing.height < value.sizing.minHeight)
    throw new TypeError(`Shape ${key}: default size is below its minimum size.`);
  return value;
}

export function assertShapeLibrary(value) {
  assertDiagramData(value);
  if (validateJson(value, SHAPE_LIBRARY_SCHEMA).length)
    throw new TypeError('Invalid shape library: expected at most 512 inert shape definitions.');
  const keys = new Set();
  for (const definition of value) {
    assertShapeDefinition(definition);
    const key = shapeReferenceKey(definition);
    if (keys.has(key)) throw new TypeError(`Shape library contains duplicate identity ${key}.`);
    keys.add(key);
  }
  return value;
}

export function assertShapeReference(value, library) {
  assertDiagramData(value);
  if (validateJson(value, SHAPE_REFERENCE_SCHEMA).length)
    throw new TypeError('Invalid shape reference.');
  const key = shapeReferenceKey(value);
  const definition = library?.find((entry) => shapeReferenceKey(entry) === key);
  if (!definition)
    throw new TypeError(`Shape ${key}: definition is missing from the document library.`);
  if (definition.definitionDigest !== value.definitionDigest)
    throw new TypeError(`Shape ${key}: reference digest does not match its definition.`);
  return definition;
}
