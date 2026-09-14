import { withDocumentDigest } from '../src/canonical-json.mjs';
import {
  DIAGRAM_V16_CONTRACT_FILES,
  DIAGRAM_V16_REGISTRIES,
} from '../src/skill-source-contracts.mjs';

const SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
const BASE = 'https://openplanr.dev/schemas/v1.6.0/';
const PROTOCOL_VERSION = '1.6.0';

export const DIAGRAM_PRIMITIVES = Object.freeze([
  'node',
  'relation',
  'group',
  'lane',
  'event',
  'series',
  'axis',
  'set',
  'annotation',
  'emphasis',
]);

export const DIAGRAM_LAYOUT_FAMILIES = Object.freeze([
  'cause-effect',
  'chart',
  'chronology',
  'containment',
  'entity',
  'graph',
  'hierarchy',
  'lanes',
  'sankey',
  'wardley',
]);

const ALL_DIRECTIONS = Object.freeze(['top-down', 'left-right', 'right-left', 'bottom-up', 'radial']);
const GRAPH = ['node', 'relation', 'group', 'annotation', 'emphasis'];
const HIERARCHY = ['node', 'relation', 'group', 'annotation', 'emphasis'];
const CHRONOLOGY = ['node', 'relation', 'event', 'annotation', 'emphasis'];
const LANES = ['node', 'relation', 'lane', 'event', 'annotation', 'emphasis'];
const CONTAINMENT = ['node', 'relation', 'group', 'set', 'annotation', 'emphasis'];
const ENTITY = ['node', 'relation', 'group', 'annotation', 'emphasis'];
const CHART = ['node', 'series', 'axis', 'annotation', 'emphasis'];
const SANKEY = ['node', 'relation', 'series', 'annotation', 'emphasis'];
const WARDLEY = ['node', 'relation', 'axis', 'annotation', 'emphasis'];
const CAUSE_EFFECT = ['node', 'relation', 'group', 'annotation', 'emphasis'];

const layouts = Object.freeze({
  graph: GRAPH,
  hierarchy: HIERARCHY,
  chronology: CHRONOLOGY,
  lanes: LANES,
  containment: CONTAINMENT,
  entity: ENTITY,
  chart: CHART,
  sankey: SANKEY,
  wardley: WARDLEY,
  'cause-effect': CAUSE_EFFECT,
});

const grammar = (
  grammarId,
  title,
  layoutFamily,
  aliases,
  {
    required = ['node'],
    directions = ALL_DIRECTIONS,
    mermaid = 'partial',
    excalidraw = 'editable',
    hardLimit = 24,
    maxCrossings = 12,
    maxFanIn = 6,
    aspectRatios = ['fit', 'doc-wide', 'slide-16x9'],
  } = {},
) => Object.freeze({
  grammarId,
  grammarVersion: '1.0.0',
  title,
  summary: `${title} semantic grammar using the ${layoutFamily} layout family.`,
  layoutFamily,
  aliases: Object.freeze([...aliases]),
  requiredPrimitives: Object.freeze([...required]),
  allowedPrimitives: Object.freeze([...layouts[layoutFamily]]),
  directions: Object.freeze([...directions]),
  detailLimits: Object.freeze({
    simplified: Math.min(7, hardLimit),
    balanced: Math.min(12, hardLimit),
    faithful: Math.min(24, hardLimit),
    hard: hardLimit,
  }),
  readability: Object.freeze({
    maxLabelCharacters: 80,
    maxCrossings,
    maxFanIn,
    minTextSize: 12,
    aspectRatios: Object.freeze([...aspectRatios]),
  }),
  projections: Object.freeze({ mermaid, excalidraw }),
  fixture: `fixtures/diagram/grammars/${grammarId}.planr-diagram.json`,
  reference: `references/diagram/${grammarId}.md`,
  rendererContract: Object.freeze({
    layoutFamily,
    contractVersion: '1.0.0',
    staticByDefault: true,
  }),
  accessibilityTemplate: Object.freeze({
    title: `${title} diagram`,
    description: `Diagram content for the ${title.toLowerCase()} grammar in semantic reading order.`,
  }),
});

export const DIAGRAM_GRAMMARS = Object.freeze([
  grammar('architecture', 'Architecture', 'graph', ['system architecture', 'software architecture', 'components']),
  grammar('it-current-state', 'IT current state', 'graph', ['legacy landscape', 'current state', 'modernization']),
  grammar('flowchart', 'Flowchart', 'graph', ['decision flow', 'workflow', 'process flow'], { mermaid: 'editable' }),
  grammar('sequence', 'Sequence', 'chronology', ['message sequence', 'interaction sequence', 'request trace'], { required: ['node', 'relation', 'event'], mermaid: 'editable' }),
  grammar('state-machine', 'State machine', 'graph', ['state diagram', 'lifecycle states', 'transitions'], { mermaid: 'editable' }),
  grammar('er-data-model', 'ER data model', 'entity', ['entity relationship', 'logical data model', 'er diagram'], { mermaid: 'editable' }),
  grammar('timeline', 'Timeline', 'chronology', ['milestones', 'history', 'roadmap'], { required: ['event'] }),
  grammar('swimlane', 'Swimlane', 'lanes', ['cross functional', 'handoff flow', 'responsibility lanes'], { required: ['node', 'lane'] }),
  grammar('quadrant', 'Quadrant', 'chart', ['two axis matrix', 'impact effort', 'four quadrants'], { required: ['node', 'axis'], directions: ['radial'] }),
  grammar('radar', 'Radar chart', 'chart', ['spider chart', 'multi axis comparison'], { required: ['series', 'axis'], directions: ['radial'], mermaid: 'unsupported' }),
  grammar('polar', 'Polar chart', 'chart', ['polar area', 'cyclic magnitude'], { required: ['series', 'axis'], directions: ['radial'], mermaid: 'unsupported' }),
  grammar('loop-flywheel', 'Loop and flywheel', 'graph', ['flywheel', 'reinforcing loop', 'feedback loop'], { directions: ['radial'] }),
  grammar('nested', 'Nested containment', 'containment', ['nested boxes', 'containment map'], { required: ['node', 'group'] }),
  grammar('tree', 'Tree', 'hierarchy', ['hierarchy tree', 'parent child'], { mermaid: 'editable' }),
  grammar('org-chart', 'Organization chart', 'hierarchy', ['org chart', 'reporting lines', 'team structure']),
  grammar('layer-stack', 'Layer stack', 'hierarchy', ['layered architecture', 'stacked abstractions']),
  grammar('venn', 'Venn', 'containment', ['set overlap', 'venn diagram'], { required: ['set'], directions: ['radial'], mermaid: 'unsupported' }),
  grammar('pyramid-funnel', 'Pyramid and funnel', 'hierarchy', ['pyramid', 'funnel', 'ranked hierarchy']),
  grammar('bar', 'Bar chart', 'chart', ['bar graph', 'categorical comparison'], { required: ['series', 'axis'], mermaid: 'unsupported' }),
  grammar('treemap', 'Treemap', 'containment', ['part of whole', 'area hierarchy'], { required: ['node', 'group'], mermaid: 'unsupported' }),
  grammar('line', 'Line chart', 'chart', ['line graph', 'trend chart'], { required: ['series', 'axis'], mermaid: 'unsupported' }),
  grammar('gantt', 'Gantt', 'chronology', ['gantt chart', 'project schedule', 'task timeline'], { required: ['event'], mermaid: 'editable' }),
  grammar('scatter', 'Scatter plot', 'chart', ['scatter chart', 'correlation', 'distribution plot'], { required: ['series', 'axis'], mermaid: 'unsupported' }),
  grammar('high-level', 'High-level system view', 'graph', ['high level architecture', 'end to end stack']),
  grammar('process', 'Process', 'lanes', ['business process', 'multi actor process'], { required: ['node', 'relation', 'lane'] }),
  grammar('medallion', 'Medallion', 'hierarchy', ['bronze silver gold', 'data lakehouse tiers']),
  grammar('data-flow', 'Data flow', 'graph', ['data pipeline', 'information flow']),
  grammar('dp-integration', 'Data platform integration', 'graph', ['sources core consumers', 'integration landscape']),
  grammar('dp-security-matrix', 'Data platform security matrix', 'lanes', ['access matrix', 'role permissions'], { required: ['node', 'lane'] }),
  grammar('sankey', 'Sankey', 'sankey', ['flow quantities', 'split and merge'], { required: ['node', 'relation', 'series'], mermaid: 'unsupported', maxFanIn: 8 }),
  grammar('fishbone', 'Fishbone', 'cause-effect', ['ishikawa', 'cause and effect', 'root causes'], { required: ['node', 'relation', 'group'], mermaid: 'unsupported' }),
  grammar('wardley', 'Wardley map', 'wardley', ['value chain evolution', 'wardley'], { required: ['node', 'relation', 'axis'], mermaid: 'unsupported' }),
  grammar('kanban', 'Kanban', 'lanes', ['kanban board', 'work in progress'], { required: ['node', 'lane'], mermaid: 'unsupported' }),
  grammar('user-journey', 'User journey', 'lanes', ['customer journey', 'experience map'], { required: ['event', 'lane'], mermaid: 'partial' }),
  grammar('deployment', 'Deployment', 'containment', ['deployment diagram', 'zones hosts artifacts'], { required: ['node', 'group'], mermaid: 'partial' }),
  grammar('dependency-graph', 'Dependency graph', 'graph', ['dependencies', 'fan in graph', 'package graph'], { mermaid: 'editable', maxFanIn: 10 }),
  grammar('uml-class', 'UML class', 'entity', ['class diagram', 'typed relations'], { mermaid: 'editable' }),
  grammar('story-map', 'Story map', 'lanes', ['user story map', 'release slices'], { required: ['node', 'lane'], mermaid: 'unsupported' }),
  grammar('database-schema', 'Database schema', 'entity', ['physical schema', 'database tables', 'foreign keys'], { mermaid: 'editable' }),
]);

export const DIAGRAM_SEMANTIC_PATTERNS = Object.freeze([
  ['fan-in-bottleneck', ['queue', 'bottleneck', 'fan in'], ['dependency-graph', 'sankey', 'data-flow']],
  ['repeated-stages', ['stages', 'pipeline slots', 'repeat'], ['process', 'swimlane', 'data-flow']],
  ['unstructured-transformation', ['unstructured input', 'transform', 'normalize'], ['data-flow', 'dp-integration']],
  ['paired-policy-trace', ['policy trace', 'allow deny', 'decision path'], ['sequence', 'flowchart']],
  ['secure-paved-road', ['secure path', 'paved road', 'guardrails'], ['architecture', 'deployment']],
  ['governance-catalog', ['catalog', 'governance', 'ownership'], ['tree', 'org-chart', 'layer-stack']],
  ['compensating-layers', ['defense in depth', 'compensating controls'], ['layer-stack', 'dp-security-matrix']],
].map(([patternId, triggers, candidateGrammars]) => Object.freeze({
  patternId,
  patternVersion: '1.0.0',
  triggers: Object.freeze(triggers),
  candidateGrammars: Object.freeze(candidateGrammars),
  selection: 'rank-only',
})));

const ref = (name) => ({ $ref: `common.schema.json#/$defs/${name}` });
const array = (items, minItems = 0, maxItems = 4096, uniqueItems = false) => ({
  type: 'array', items, minItems, maxItems, ...(uniqueItems ? { uniqueItems: true } : {}),
});
const closed = (required, properties, extra = {}) => ({
  type: 'object', additionalProperties: false, required, properties, ...extra,
});
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const nonBlank = ref('nonBlankText');
const identifier = ref('identifier');
const envelope = {
  kind: { type: 'string', minLength: 1, maxLength: 96 },
  schemaVersion: ref('semver'),
  protocolVersion: { const: PROTOCOL_VERSION },
  documentVersion: ref('semver'),
  digestAlgorithm: { const: 'sha256' },
  canonicalization: { const: 'rfc8785' },
  documentDigest: ref('digest'),
};

function documentSchema(name, kind, required, properties, extra = {}) {
  return {
    $schema: SCHEMA,
    $id: `${BASE}${name}.schema.json`,
    'x-openplanr-contract': { id: name, version: PROTOCOL_VERSION },
    ...closed(
      [...Object.keys(envelope), ...required],
      { ...envelope, kind: { const: kind }, schemaVersion: { const: '1.0.0' }, ...properties },
      extra,
    ),
  };
}

const itemId = { type: 'string', pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$', maxLength: 128 };
const primitive = { enum: DIAGRAM_PRIMITIVES };
const direction = { enum: ALL_DIRECTIONS };
const detailTier = { enum: ['simplified', 'balanced', 'faithful'] };
const fidelity = { enum: ['editable', 'render-only', 'partial', 'lossy', 'unsupported'] };
const sourceRef = closed(['format', 'path', 'digest'], {
  format: { enum: ['english', 'mermaid', 'excalidraw', 'planr-diagram'] },
  path: nullable(ref('relativePath')),
  digest: nullable(ref('digest')),
});
const node = closed(['id', 'label', 'kind'], {
  id: itemId,
  label: nonBlank,
  kind: identifier,
  description: nullable(nonBlank),
  semanticPosition: nullable(closed(['horizontal', 'vertical', 'meaning'], {
    horizontal: { type: 'number', minimum: 0, maximum: 1 },
    vertical: { type: 'number', minimum: 0, maximum: 1 },
    meaning: nonBlank,
  })),
});
const relation = closed(['id', 'from', 'to', 'kind'], {
  id: itemId, from: itemId, to: itemId, kind: { enum: ['association', 'dependency', 'flow', 'message', 'transition', 'containment'] },
  label: nullable(nonBlank), weight: nullable({ type: 'number', minimum: 0 }),
});
const group = closed(['id', 'label', 'members'], { id: itemId, label: nonBlank, members: array(itemId, 1, 256, true) });
const lane = closed(['id', 'label', 'members'], { id: itemId, label: nonBlank, members: array(itemId, 0, 256, true) });
const event = closed(['id', 'label', 'order'], { id: itemId, label: nonBlank, order: { type: 'integer', minimum: 0 }, at: nullable({ type: 'string', minLength: 1, maxLength: 128 }) });
const series = closed(['id', 'label', 'values'], {
  id: itemId, label: nonBlank,
  values: array(closed(['key', 'value'], { key: { type: 'string', minLength: 1, maxLength: 128 }, value: { type: 'number' } }), 1, 512),
});
const axis = closed(['id', 'label', 'scale'], { id: itemId, label: nonBlank, scale: { enum: ['categorical', 'linear', 'logarithmic', 'ordinal', 'temporal'] } });
const set = closed(['id', 'label', 'members'], { id: itemId, label: nonBlank, members: array(itemId, 1, 256, true) });
const annotation = closed(['id', 'text', 'targetId'], { id: itemId, text: nonBlank, targetId: nullable(itemId) });
const emphasis = closed(['targetId', 'level'], { targetId: itemId, level: { enum: ['primary', 'secondary', 'muted'] } });

export function buildDiagramSchemas() {
  const diagramDocument = documentSchema('diagram-document', 'planr-diagram', [
    'diagramId', 'title', 'summary', 'audience', 'grammar', 'layout', 'theme', 'source',
    'nodes', 'relations', 'groups', 'lanes', 'events', 'series', 'axes', 'sets',
    'annotations', 'emphasis', 'accessibility',
  ], {
    diagramId: itemId,
    title: nonBlank,
    summary: nonBlank,
    audience: { enum: ['engineer', 'executive', 'mixed'] },
    grammar: closed(['id', 'version'], { id: identifier, version: { const: '1.0.0' } }),
    layout: closed(['direction', 'detailTier'], { direction, detailTier }),
    theme: closed(['themeId', 'mode'], { themeId: identifier, mode: { enum: ['light', 'dark', 'auto'] } }),
    source: sourceRef,
    nodes: array(node, 0, 4096),
    relations: array(relation, 0, 8192),
    groups: array(group, 0, 1024),
    lanes: array(lane, 0, 256),
    events: array(event, 0, 4096),
    series: array(series, 0, 256),
    axes: array(axis, 0, 16),
    sets: array(set, 0, 64),
    annotations: array(annotation, 0, 1024),
    emphasis: array(emphasis, 0, 1024),
    accessibility: closed(['title', 'description', 'readingOrder'], {
      title: nonBlank, description: nonBlank, readingOrder: array(itemId, 0, 4096, true),
    }),
  }, {
    anyOf: [
      'nodes', 'relations', 'groups', 'lanes', 'events', 'series', 'axes', 'sets', 'annotations', 'emphasis',
    ].map((name) => ({ properties: { [name]: { minItems: 1 } } })),
  });

  const manifest = documentSchema('diagram-manifest', 'diagram-manifest', [
    'diagramId', 'source', 'registry', 'renderer', 'theme', 'outputs',
  ], {
    diagramId: itemId,
    source: closed(['path', 'digest'], { path: ref('relativePath'), digest: ref('digest') }),
    registry: closed(['path', 'digest', 'grammarId', 'grammarVersion'], {
      path: ref('relativePath'), digest: ref('digest'), grammarId: identifier, grammarVersion: ref('semver'),
    }),
    renderer: closed(['id', 'version'], { id: identifier, version: ref('semver') }),
    theme: closed(['id', 'version'], { id: identifier, version: ref('semver') }),
    outputs: array(closed(['path', 'mediaType', 'digest', 'fidelity'], {
      path: ref('relativePath'), mediaType: { type: 'string', minLength: 3, maxLength: 128 }, digest: ref('digest'), fidelity,
    }), 1, 32),
  });

  const quality = documentSchema('diagram-quality-report', 'diagram-quality-report', [
    'diagramId', 'status', 'checks', 'splitPlan',
  ], {
    diagramId: itemId,
    status: { enum: ['pass', 'warning', 'split-required', 'invalid'] },
    checks: array(closed(['id', 'status', 'message'], {
      id: identifier, status: { enum: ['pass', 'warning', 'fail'] }, message: nonBlank,
    }), 1, 128),
    splitPlan: nullable(closed(['strategy', 'panels'], {
      strategy: { enum: ['by-group', 'by-lane', 'by-sequence', 'by-subgraph'] },
      panels: array(closed(['id', 'title', 'itemIds'], {
        id: itemId, title: nonBlank, itemIds: array(itemId, 1, 256, true),
      }), 2, 32),
    })),
  });

  const fidelityReport = documentSchema('diagram-fidelity-report', 'diagram-fidelity-report', [
    'diagramId', 'sourceFormat', 'targetFormat', 'status', 'interpreted', 'omitted', 'notes',
  ], {
    diagramId: itemId,
    sourceFormat: { enum: ['english', 'mermaid', 'excalidraw', 'planr-diagram'] },
    targetFormat: { enum: ['planr-diagram', 'mermaid', 'excalidraw', 'svg', 'html', 'png'] },
    status: fidelity,
    interpreted: array(closed(['source', 'targetId', 'construct'], {
      source: nonBlank, targetId: itemId, construct: identifier,
    }), 0, 8192),
    omitted: array(closed(['source', 'reason'], { source: nonBlank, reason: nonBlank }), 0, 8192),
    notes: array(nonBlank, 0, 256),
  });

  const diagramAsset = closed(['path', 'digest'], {
    path: ref('relativePath'),
    digest: ref('digest'),
  });
  const consumerReference = documentSchema('diagram-consumer-reference', 'diagram-consumer-reference', [
    'referenceId', 'diagramId', 'consumer', 'manifest', 'source', 'output', 'accessibility',
  ], {
    referenceId: itemId,
    diagramId: itemId,
    consumer: closed(['kind', 'path'], {
      kind: { enum: ['specification', 'documentation', 'pdf'] },
      path: nullable(ref('relativePath')),
    }),
    manifest: diagramAsset,
    source: diagramAsset,
    output: closed(['path', 'mediaType', 'digest', 'fidelity'], {
      path: ref('relativePath'),
      mediaType: { enum: ['image/svg+xml; charset=utf-8', 'image/png'] },
      digest: ref('digest'),
      fidelity,
    }),
    accessibility: closed(['title', 'description'], {
      title: nonBlank,
      description: nonBlank,
    }),
  });

  const reviewBinding = documentSchema('diagram-review-binding', 'diagram-review-binding', [
    'bindingId', 'diagramId', 'manifest', 'artifact', 'review',
  ], {
    bindingId: itemId,
    diagramId: itemId,
    manifest: diagramAsset,
    artifact: closed(['artifactId', 'envelopeDigest', 'htmlDigest'], {
      artifactId: itemId,
      envelopeDigest: ref('digest'),
      htmlDigest: ref('digest'),
    }),
    review: nullable(closed(['reviewId', 'reviewDigest', 'pinIds'], {
      reviewId: { type: 'string', minLength: 1, maxLength: 128 },
      reviewDigest: ref('digest'),
      pinIds: array({ type: 'string', minLength: 1, maxLength: 128 }, 0, 10_000, true),
    })),
  });

  const grammarEntry = closed([
    'grammarId', 'grammarVersion', 'title', 'summary', 'layoutFamily', 'aliases',
    'requiredPrimitives', 'allowedPrimitives', 'directions', 'detailLimits', 'readability',
    'projections', 'fixture', 'reference', 'rendererContract', 'accessibilityTemplate',
  ], {
    grammarId: identifier,
    grammarVersion: { const: '1.0.0' },
    title: nonBlank,
    summary: nonBlank,
    layoutFamily: { enum: DIAGRAM_LAYOUT_FAMILIES },
    aliases: array({ type: 'string', minLength: 2, maxLength: 128 }, 1, 32, true),
    requiredPrimitives: array(primitive, 1, DIAGRAM_PRIMITIVES.length, true),
    allowedPrimitives: array(primitive, 1, DIAGRAM_PRIMITIVES.length, true),
    directions: array(direction, 1, ALL_DIRECTIONS.length, true),
    detailLimits: closed(['simplified', 'balanced', 'faithful', 'hard'], {
      simplified: { type: 'integer', minimum: 1, maximum: 24 },
      balanced: { type: 'integer', minimum: 1, maximum: 24 },
      faithful: { type: 'integer', minimum: 1, maximum: 48 },
      hard: { type: 'integer', minimum: 1, maximum: 128 },
    }),
    readability: closed(['maxLabelCharacters', 'maxCrossings', 'maxFanIn', 'minTextSize', 'aspectRatios'], {
      maxLabelCharacters: { type: 'integer', minimum: 8, maximum: 256 },
      maxCrossings: { type: 'integer', minimum: 0, maximum: 256 },
      maxFanIn: { type: 'integer', minimum: 1, maximum: 64 },
      minTextSize: { type: 'integer', minimum: 9, maximum: 24 },
      aspectRatios: array({ enum: ['fit', 'doc-inline', 'doc-wide', 'slide-16x9', 'slide-4x3', 'social-square', 'print-landscape'] }, 1, 8, true),
    }),
    projections: closed(['mermaid', 'excalidraw'], { mermaid: fidelity, excalidraw: fidelity }),
    fixture: ref('relativePath'),
    reference: ref('relativePath'),
    rendererContract: closed(['layoutFamily', 'contractVersion', 'staticByDefault'], {
      layoutFamily: { enum: DIAGRAM_LAYOUT_FAMILIES }, contractVersion: ref('semver'), staticByDefault: { const: true },
    }),
    accessibilityTemplate: closed(['title', 'description'], { title: nonBlank, description: nonBlank }),
  });

  const typeRegistry = documentSchema('diagram-type-registry', 'diagram-type-registry', [
    'registryVersion', 'primitives', 'layoutFamilies', 'grammars',
  ], {
    registryVersion: { const: '1.0.0' },
    primitives: array(primitive, DIAGRAM_PRIMITIVES.length, DIAGRAM_PRIMITIVES.length, true),
    layoutFamilies: array({ enum: DIAGRAM_LAYOUT_FAMILIES }, DIAGRAM_LAYOUT_FAMILIES.length, DIAGRAM_LAYOUT_FAMILIES.length, true),
    grammars: array(grammarEntry, 1, 64),
  });

  const semanticPatternRegistry = documentSchema(
    'diagram-semantic-pattern-registry',
    'diagram-semantic-pattern-registry',
    ['patterns'],
    {
      patterns: array(closed(['patternId', 'patternVersion', 'triggers', 'candidateGrammars', 'selection'], {
        patternId: identifier,
        patternVersion: { const: '1.0.0' },
        triggers: array({ type: 'string', minLength: 2, maxLength: 128 }, 1, 32, true),
        candidateGrammars: array(identifier, 1, 16, true),
        selection: { const: 'rank-only' },
      }), 1, 64),
    },
  );

  return new Map([
    ['diagram-consumer-reference.schema.json', consumerReference],
    ['diagram-document.schema.json', diagramDocument],
    ['diagram-fidelity-report.schema.json', fidelityReport],
    ['diagram-manifest.schema.json', manifest],
    ['diagram-quality-report.schema.json', quality],
    ['diagram-review-binding.schema.json', reviewBinding],
    ['diagram-semantic-pattern-registry.schema.json', semanticPatternRegistry],
    ['diagram-type-registry.schema.json', typeRegistry],
  ]);
}

const document = (kind, fields) => withDocumentDigest({
  kind,
  schemaVersion: '1.0.0',
  protocolVersion: PROTOCOL_VERSION,
  documentVersion: '1.0.0',
  digestAlgorithm: 'sha256',
  canonicalization: 'rfc8785',
  ...fields,
});

export function buildDiagramRegistries() {
  const payloads = new Map([
    ['diagram-type-registry', {
      registryVersion: '1.0.0',
      primitives: [...DIAGRAM_PRIMITIVES],
      layoutFamilies: [...DIAGRAM_LAYOUT_FAMILIES],
      grammars: DIAGRAM_GRAMMARS.map((entry) => structuredClone(entry)),
    }],
    ['diagram-semantic-pattern-registry', {
      patterns: DIAGRAM_SEMANTIC_PATTERNS.map((entry) => structuredClone(entry)),
    }],
  ]);
  return new Map(Object.entries(DIAGRAM_V16_REGISTRIES).map(([file, descriptor]) => [
    file,
    document(descriptor.kind, payloads.get(descriptor.kind)),
  ]));
}

export const DIAGRAM_CONTRACT_FILES = DIAGRAM_V16_CONTRACT_FILES;
