import { shapeDefinitionDigest } from '@openplanr/protocol/shape-library-contracts';

const rect = (radius = 0) => ({ type: 'rect', x: 0, y: 0, width: 1, height: 1, radius });
const ellipse = { type: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5 };
const polygon = (points) => ({ type: 'polygon', points: points.map(([x, y]) => ({ x, y })) });
const line = (x1, y1, x2, y2) => ({ type: 'line', x1, y1, x2, y2, stroke: 'stroke' });
const painted = (shape) => ({ ...shape, fill: 'fill', stroke: 'stroke' });
const geometries = {
  rectangle: rect(),
  rounded: rect(0.12),
  ellipse,
  diamond: polygon([
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 0.5],
  ]),
  hexagon: polygon([
    [0.2, 0],
    [0.8, 0],
    [1, 0.5],
    [0.8, 1],
    [0.2, 1],
    [0, 0.5],
  ]),
  triangle: polygon([
    [0.5, 0],
    [1, 1],
    [0, 1],
  ]),
  parallelogram: polygon([
    [0.2, 0],
    [1, 0],
    [0.8, 1],
    [0, 1],
  ]),
  trapezoid: polygon([
    [0.2, 0],
    [0.8, 0],
    [1, 1],
    [0, 1],
  ]),
  document: polygon([
    [0, 0],
    [0.8, 0],
    [1, 0.2],
    [1, 1],
    [0, 1],
  ]),
  note: polygon([
    [0, 0],
    [1, 0],
    [1, 0.8],
    [0.8, 1],
    [0, 1],
  ]),
};
const cylinderOutline = polygon([
  [0, 0.15],
  [0.03806, 0.092597],
  [0.146447, 0.043934],
  [0.308658, 0.011418],
  [0.5, 0],
  [0.691342, 0.011418],
  [0.853553, 0.043934],
  [0.96194, 0.092597],
  [1, 0.15],
  [1, 0.85],
  [0.96194, 0.907403],
  [0.853553, 0.956066],
  [0.691342, 0.988582],
  [0.5, 1],
  [0.308658, 0.988582],
  [0.146447, 0.956066],
  [0.03806, 0.907403],
  [0, 0.85],
]);
const cylinderPrimitives = [
  painted(cylinderOutline),
  { ...ellipse, cy: 0.15, ry: 0.15, fill: 'none', stroke: 'stroke' },
];
const variants = {
  cylinder: { attachment: cylinderOutline, primitives: cylinderPrimitives },
  document: { decoration: [line(0.8, 0, 0.8, 0.2), line(0.8, 0.2, 1, 0.2)] },
  note: { decoration: [line(0.8, 1, 0.8, 0.8), line(0.8, 0.8, 1, 0.8)] },
  queue: { geometry: 'rounded', decoration: [line(0.18, 0, 0.18, 1), line(0.82, 0, 0.82, 1)] },
  cache: { geometry: 'rounded', decoration: [line(0, 0.22, 1, 0.22)] },
  client: { geometry: 'rectangle', decoration: [line(0, 0.78, 1, 0.78)] },
  subprocess: { geometry: 'rectangle', decoration: [line(0.1, 0, 0.1, 1), line(0.9, 0, 0.9, 1)] },
  person: {
    geometry: 'rounded',
    decoration: [painted({ type: 'ellipse', cx: 0.5, cy: 0.22, rx: 0.09, ry: 0.13 })],
  },
};
const PACK_NAMES = {
  basics: 'Basics',
  engineering: 'Engineering',
  process: 'Process',
  general: 'General',
};
const rows = [
  ['basics', 'rectangle', 'Rectangle', 'process', 'rectangle', ['box']],
  ['basics', 'rounded-rectangle', 'Rounded rectangle', 'process', 'rounded', ['box']],
  ['basics', 'ellipse', 'Ellipse', 'process', 'ellipse', ['oval', 'circle']],
  ['basics', 'diamond', 'Diamond', 'decision', 'diamond', ['branch']],
  ['basics', 'hexagon', 'Hexagon', 'process', 'hexagon', ['preparation']],
  ['basics', 'triangle', 'Triangle', 'process', 'triangle', ['warning']],
  ['basics', 'parallelogram', 'Parallelogram', 'process', 'parallelogram', ['input', 'output']],
  ['basics', 'trapezoid', 'Trapezoid', 'process', 'trapezoid', ['manual']],
  ['basics', 'cylinder', 'Cylinder', 'data-store', 'cylinder', ['storage']],
  ['basics', 'document', 'Document', 'process', 'document', ['file']],
  ['basics', 'note', 'Note', 'annotation', 'note', ['annotation', 'text']],
  ['basics', 'container', 'Container', 'container', 'rectangle', ['group']],
  ['engineering', 'service', 'Service', 'component', 'rounded', ['application', 'component']],
  ['engineering', 'api-gateway', 'API gateway', 'component', 'hexagon', ['endpoint', 'router']],
  ['engineering', 'worker', 'Worker', 'component', 'rectangle', ['job', 'background']],
  ['engineering', 'queue', 'Queue', 'component', 'queue', ['message', 'event']],
  ['engineering', 'database', 'Database', 'data-store', 'cylinder', ['storage', 'sql']],
  ['engineering', 'cache', 'Cache', 'data-store', 'cache', ['memory', 'key value']],
  ['engineering', 'client', 'Client', 'component', 'client', ['browser', 'device']],
  [
    'engineering',
    'external-system',
    'External system',
    'component',
    'rounded',
    ['integration', 'third party'],
  ],
  ['process', 'start', 'Start', 'start', 'ellipse', ['begin']],
  ['process', 'end', 'End', 'end', 'ellipse', ['finish']],
  ['process', 'task', 'Task', 'process', 'rounded', ['step', 'activity']],
  ['process', 'decision', 'Decision', 'decision', 'diamond', ['approval', 'branch']],
  ['process', 'input-output', 'Input/output', 'process', 'parallelogram', ['data']],
  ['process', 'subprocess', 'Subprocess', 'process', 'subprocess', ['procedure']],
  ['general', 'topic', 'Topic', 'process', 'rounded', ['idea', 'subject']],
  ['general', 'person-card', 'Person card', 'component', 'person', ['team', 'role']],
  ['general', 'milestone', 'Milestone', 'process', 'diamond', ['goal', 'delivery']],
  ['general', 'callout', 'Callout', 'annotation', 'rounded', ['annotation', 'comment']],
];
function catalogEntry([library, shapeId, name, kind, geometry, tags]) {
  const variant = variants[geometry] ?? {};
  const attachment = variant.attachment ?? geometries[variant.geometry ?? geometry];
  const textRegion =
    geometry === 'diamond'
      ? { x: 0.25, y: 0.3, width: 0.5, height: 0.4 }
      : geometry === 'triangle'
        ? { x: 0.3, y: 0.55, width: 0.4, height: 0.25 }
        : geometry === 'person'
          ? { x: 0.12, y: 0.45, width: 0.76, height: 0.4 }
          : { x: 0.2, y: 0.25, width: 0.6, height: 0.5 };
  const definition = {
    packId: `openplanr-${library}`,
    packVersion: '1.0.0',
    shapeId,
    definitionDigest: '',
    name,
    description: `${name} from the ${PACK_NAMES[library]} library.`,
    tags,
    primitives: variant.primitives ?? [painted(attachment), ...(variant.decoration ?? [])],
    textRegion,
    attachment,
    sizing: {
      width: kind === 'container' ? 540 : kind === 'annotation' ? 240 : 160,
      height:
        kind === 'container'
          ? 240
          : kind === 'annotation'
            ? 120
            : geometry === 'diamond' || geometry === 'triangle'
              ? 100
              : 80,
      minWidth: 48,
      minHeight: 32,
    },
  };
  definition.definitionDigest = shapeDefinitionDigest(definition);
  return { id: `${library}/${shapeId}`, library, kind, definition };
}
const freeze = (value) => {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};
export const DIAGRAM_SHAPE_LIBRARIES = freeze(
  Object.entries(PACK_NAMES).map(([id, name]) => ({ id, name })),
);
export const DIAGRAM_SHAPE_CATALOG = freeze(rows.map(catalogEntry));
export const DIAGRAM_PATTERNS = freeze([
  {
    id: 'service-architecture',
    name: 'Service architecture',
    library: 'engineering',
    description: 'Client, service and datastore',
    nodes: [
      { shape: 'engineering/client', label: 'Client', x: 0, y: 0 },
      { shape: 'engineering/service', label: 'Service', x: 240, y: 0 },
      { shape: 'engineering/database', label: 'Datastore', x: 480, y: 0 },
    ],
    edges: [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
    ],
  },
  {
    id: 'approval-process',
    name: 'Approval process',
    library: 'process',
    description: 'Request, decision and two outcomes',
    nodes: [
      { shape: 'process/task', label: 'Request', x: 0, y: 70 },
      { shape: 'process/decision', label: 'Approved?', x: 240, y: 60 },
      { shape: 'process/end', label: 'Approved', x: 480, y: 0 },
      { shape: 'process/end', label: 'Rejected', x: 480, y: 160 },
    ],
    edges: [
      { from: 0, to: 1 },
      { from: 1, to: 2, label: 'Yes' },
      { from: 1, to: 3, label: 'No' },
    ],
  },
  {
    id: 'product-journey',
    name: 'Product journey',
    library: 'general',
    description: 'Discover, evaluate and adopt',
    nodes: [
      { shape: 'general/topic', label: 'Discover', x: 0, y: 0 },
      { shape: 'general/topic', label: 'Evaluate', x: 240, y: 0 },
      { shape: 'general/milestone', label: 'Adopt', x: 480, y: 0 },
      { shape: 'general/callout', label: 'Capture customer needs', x: 0, y: 160 },
    ],
    edges: [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
    ],
  },
]);
const catalogById = new Map(DIAGRAM_SHAPE_CATALOG.map((entry) => [entry.id, entry]));
export function diagramShapeEntry(id) {
  const entry = catalogById.get(id);
  if (!entry) throw new TypeError(`Shape catalog entry ${id} does not exist.`);
  return entry;
}
export function diagramPattern(id) {
  const pattern = DIAGRAM_PATTERNS.find((item) => item.id === id);
  if (!pattern) throw new TypeError(`Diagram pattern ${id} does not exist.`);
  return pattern;
}
/** Build once per catalog revision; searches inspect pre-normalized text. */
export function createDiagramShapeSearch(entries = DIAGRAM_SHAPE_CATALOG) {
  const indexed = entries.map((entry) => ({
    entry,
    text: `${entry.definition.name} ${entry.definition.description} ${entry.definition.tags.join(' ')}`.toLowerCase(),
  }));
  return (query = '', library = 'all') => {
    const terms = query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
    return indexed
      .filter(
        ({ entry, text }) =>
          (library === 'all' || entry.library === library) &&
          terms.every((term) => text.includes(term)),
      )
      .map(({ entry }) => entry);
  };
}
export function diagramShapeAllowed(entry, capability) {
  if (!capability) return false;
  const primitive =
    entry.kind === 'container' ? 'group' : entry.kind === 'annotation' ? 'annotation' : 'node';
  return (
    capability.primitives.includes(primitive) &&
    (primitive !== 'node' || capability.nodeKinds.includes(entry.kind))
  );
}
