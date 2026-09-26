import { canonicalizeJson, sha256Jcs, sha256Hex } from './canonical-json.mjs';
import { validateJson } from './json-schema.mjs';
import { DIAGRAM_REGISTRIES } from './generated/diagram-registries.mjs';
import { LEGACY_DIAGRAM_DOCUMENT_SCHEMA } from './generated/legacy-diagram-schema.mjs';

/** Portable, inert data contracts. Validation confers no authorization or readiness. */
export const DIAGRAM_AUTHORING_PROTOCOL_VERSION = '1.13.0';
export const DIAGRAM_AUTHORING_CONTRACT_VERSION = '1.0.0';
const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};
export const DIAGRAM_EDIT_OPERATION_CLASSES = deepFreeze([
  'insert-elements',
  'update-semantics',
  'remove-elements',
  'set-membership-order',
  'set-geometry',
  'set-appearance-locks',
]);
export const DIAGRAM_AUTHORING_LIMITS = deepFreeze({
  depth: 48,
  values: 500000,
  textCodeUnits: 8388608,
  sourceBytes: 1048576,
  elements: 10000,
  operations: 256,
  coordinate: 1000000,
});

const closed = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const arr = (items, maxItems, minItems = 0, uniqueItems = false) => ({
  type: 'array',
  items,
  minItems,
  maxItems,
  ...(uniqueItems ? { uniqueItems } : {}),
});
const nullable = (schema) => ({ anyOf: [{ type: 'null' }, schema] });
const str = (maxLength = 4096, minLength = 0) => ({ type: 'string', minLength, maxLength });
const enumOf = (...values) => ({ enum: values });
const id = {
  type: 'string',
  pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
  minLength: 1,
  maxLength: 128,
};
const digest = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const token = { type: 'string', pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$', maxLength: 64 };
const relativePath = {
  type: 'string',
  minLength: 1,
  maxLength: 1024,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._/-]*$',
};
const coordinate = { type: 'number', minimum: -1000000, maximum: 1000000 };
const positiveSize = { type: 'number', minimum: 0.01, maximum: 1000000 };
const index = { type: 'integer', minimum: 0, maximum: 10000 };
const ids = arr(id, 10000, 0, true);
const semanticKinds = ['process', 'start', 'end', 'decision', 'data-store', 'component'];
const relationKinds = ['association', 'dependency', 'flow', 'message', 'transition'];
const node = closed({
  id,
  label: str(),
  kind: enumOf(...semanticKinds),
  description: nullable(str()),
});
const relation = closed({
  id,
  from: id,
  to: id,
  kind: enumOf(...relationKinds),
  direction: enumOf('forward', 'both', 'none'),
  label: nullable(str()),
  weight: nullable({ type: 'number', minimum: 0, maximum: 1000000 }),
});
const container = closed({ id, label: str(), members: ids });
const annotation = closed({ id, text: str(), targetId: nullable(id) });
const emphasis = closed({ targetId: id, level: enumOf('primary', 'secondary', 'muted') });
const semanticCollections = {
  nodes: arr(node, 4096),
  relations: arr(relation, 8192),
  groups: arr(container, 1024),
  lanes: arr(container, 256),
  events: arr(false, 0),
  series: arr(false, 0),
  axes: arr(false, 0),
  sets: arr(false, 0),
  annotations: arr(annotation, 1024),
  emphasis: arr(emphasis, 1024),
};
const bounds = closed({ x: coordinate, y: coordinate, width: positiveSize, height: positiveSize });
const point = closed({ x: coordinate, y: coordinate });
const attachment = closed({
  side: enumOf('top', 'right', 'bottom', 'left'),
  offset: { type: 'number', minimum: 0, maximum: 1 },
});
const route = closed({
  mode: enumOf('automatic', 'manual'),
  strategy: enumOf('straight', 'orthogonal'),
  from: attachment,
  to: attachment,
  points: arr(point, 256),
});
const labelPlacement = closed({ x: coordinate, y: coordinate, width: positiveSize });
const appearance = closed({
  shape: enumOf(
    'rectangle',
    'rounded-rectangle',
    'ellipse',
    'diamond',
    'cylinder',
    'text',
    'container',
    'connector',
  ),
  fill: enumOf('surface', 'accent', 'success', 'warning', 'danger', 'transparent'),
  stroke: enumOf('default', 'accent', 'muted', 'danger', 'none'),
  strokeWidth: { type: 'number', minimum: 0, maximum: 16 },
  strokeStyle: enumOf('solid', 'dashed', 'dotted'),
  fontSize: { type: 'integer', minimum: 8, maximum: 72 },
  textAlign: enumOf('left', 'center', 'right'),
});
const locks = closed({
  position: { type: 'boolean' },
  size: { type: 'boolean' },
  route: { type: 'boolean' },
});
const placement = closed({
  elementId: id,
  bounds: nullable(bounds),
  route: nullable(route),
  label: nullable(labelPlacement),
  zIndex: index,
  appearance,
  locks,
});
const snapshot = closed({
  bundleDigest: digest,
  semanticDigest: digest,
  presentationDigest: digest,
});
const schema = (name, kind, properties) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `https://openplanr.dev/schemas/v1.13.0/${name}.schema.json`,
  'x-openplanr-contract': { id: name, version: '1.13.0' },
  ...closed({
    kind: { const: kind },
    schemaVersion: { const: '1.0.0' },
    protocolVersion: { const: '1.13.0' },
    ...properties,
  }),
});

const documentSchema = schema('diagram-document', 'planr-diagram', {
  diagramId: id,
  title: str(),
  summary: str(),
  audience: enumOf('engineer', 'executive', 'mixed'),
  grammar: closed({
    id: enumOf('flowchart', 'process', 'swimlane', 'architecture'),
    version: { const: '1.0.0' },
  }),
  ...semanticCollections,
  laneOrder: ids,
  accessibility: closed({ title: str(), description: str(), readingOrder: ids }),
  documentDigest: digest,
});
const presentationSchema = schema('diagram-presentation', 'diagram-presentation', {
  diagramId: id,
  semanticDigest: digest,
  coordinateSystem: { const: 'global-canvas' },
  layout: closed({
    direction: enumOf('top-down', 'left-right', 'right-left', 'bottom-up'),
    detailTier: enumOf('simplified', 'balanced', 'faithful'),
  }),
  theme: closed({
    themeId: enumOf('paper', 'slate', 'midnight'),
    mode: enumOf('light', 'dark', 'auto'),
  }),
  elements: arr(placement, 10000),
  presentationDigest: digest,
});
const range = closed({
  startByte: { type: 'integer', minimum: 0, maximum: 1048576 },
  endByte: { type: 'integer', minimum: 0, maximum: 1048576 },
});
const sourceMapSchema = schema('diagram-source-map', 'diagram-source-map', {
  diagramId: id,
  semanticDigest: digest,
  sourceDigest: digest,
  sourceByteLength: { type: 'integer', minimum: 0, maximum: 1048576 },
  encoding: { const: 'utf-8' },
  parser: closed({ id: token, version: str(64, 1) }),
  certificationVersion: { const: 'flowchart-copy-v1' },
  entries: arr(
    closed({
      sourceId: nullable(str(128, 1)),
      elementIds: ids,
      range: nullable(range),
      construct: token,
      confidence: enumOf('exact', 'ambiguous'),
      losses: arr(str(512, 1), 64),
    }),
    10000,
  ),
});
const fidelityValue = enumOf('lossless', 'partial', 'unsupported');
const fidelitySchema = schema('diagram-fidelity-report', 'diagram-fidelity-report', {
  diagramId: id,
  basis: snapshot,
  sourceDigest: nullable(digest),
  sourceFormat: enumOf('mermaid', 'planr-diagram-bundle'),
  targetFormat: enumOf('mermaid', 'planr-diagram-bundle', 'svg', 'html', 'png'),
  semantic: fidelityValue,
  presentation: fidelityValue,
  sourceText: fidelityValue,
  losses: arr(
    closed({
      dimension: enumOf('semantic', 'presentation', 'sourceText'),
      code: token,
      elementIds: ids,
      message: str(512, 1),
    }),
    1024,
  ),
});
const bundleSchema = schema('diagram-authoring-bundle', 'diagram-authoring-bundle', {
  diagramId: id,
  document: documentSchema,
  presentation: presentationSchema,
  originalSource: nullable(
    closed({ format: { const: 'mermaid' }, text: str(1048576), sourceDigest: digest }),
  ),
  sourceMap: nullable(sourceMapSchema),
  bundleDigest: digest,
});
const semanticEntry = {
  oneOf: [
    closed({ collection: { const: 'nodes' }, value: node }),
    closed({ collection: { const: 'relations' }, value: relation }),
    closed({ collection: { const: 'groups' }, value: container }),
    closed({ collection: { const: 'lanes' }, value: container }),
    closed({ collection: { const: 'annotations' }, value: annotation }),
  ],
};
const editableSemanticValue = (collection, properties) =>
  closed({
    type: { const: 'update-semantics' },
    collection: { const: collection },
    elementId: id,
    before: closed(properties),
    after: closed(properties),
  });
const updateSchemas = [
  editableSemanticValue('nodes', {
    label: str(),
    kind: enumOf(...semanticKinds),
    description: nullable(str()),
  }),
  editableSemanticValue('relations', {
    from: id,
    to: id,
    kind: enumOf(...relationKinds),
    direction: enumOf('forward', 'both', 'none'),
    label: nullable(str()),
    weight: nullable({ type: 'number', minimum: 0, maximum: 1000000 }),
  }),
  editableSemanticValue('groups', { label: str() }),
  editableSemanticValue('lanes', { label: str() }),
  editableSemanticValue('annotations', { text: str(), targetId: nullable(id) }),
  closed(
    {
      type: { const: 'update-semantics' },
      collection: { const: 'emphasis' },
      elementId: id,
      before: nullable(enumOf('primary', 'secondary', 'muted')),
      after: nullable(enumOf('primary', 'secondary', 'muted')),
      index: { type: 'integer', minimum: 0, maximum: 1024 },
    },
    ['type', 'collection', 'elementId', 'before', 'after'],
  ),
  closed({
    type: { const: 'update-semantics' },
    collection: { const: 'document' },
    before: closed({
      title: str(),
      summary: str(),
      audience: enumOf('engineer', 'executive', 'mixed'),
      accessibility: documentSchema.properties.accessibility,
    }),
    after: closed({
      title: str(),
      summary: str(),
      audience: enumOf('engineer', 'executive', 'mixed'),
      accessibility: documentSchema.properties.accessibility,
    }),
  }),
  closed({
    type: { const: 'update-semantics' },
    collection: { const: 'source-map' },
    before: nullable(sourceMapSchema),
    after: nullable(sourceMapSchema),
  }),
];
const membershipState = closed({
  groups: arr(closed({ id, members: ids }), 1024),
  lanes: arr(closed({ id, members: ids }), 256),
  laneOrder: ids,
});
const geometryValue = closed({
  bounds: nullable(bounds),
  route: nullable(route),
  label: nullable(labelPlacement),
  zIndex: index,
});
const appearanceValue = closed({ appearance, locks });
const operation = {
  oneOf: [
    closed(
      {
        type: { const: 'insert-elements' },
        elements: arr(semanticEntry, 10000, 1),
        presentation: arr(placement, 10000, 1),
        positions: arr(
          closed({ elementId: id, semanticIndex: index, presentationIndex: index }),
          10000,
          1,
        ),
      },
      ['type', 'elements', 'presentation'],
    ),
    ...updateSchemas,
    closed({
      type: { const: 'remove-elements' },
      elements: arr(semanticEntry, 10000, 1),
      presentation: arr(placement, 10000, 1),
    }),
    closed({
      type: { const: 'set-membership-order' },
      before: membershipState,
      after: membershipState,
    }),
    closed({
      type: { const: 'set-geometry' },
      changes: arr(
        closed({ elementId: id, before: geometryValue, after: geometryValue }),
        10000,
        1,
      ),
    }),
    closed({
      type: { const: 'set-appearance-locks' },
      changes: arr(
        closed({ elementId: id, before: appearanceValue, after: appearanceValue }),
        10000,
        1,
      ),
    }),
  ],
};
const transactionSchema = schema('diagram-edit-transaction', 'diagram-edit-transaction', {
  transactionId: id,
  diagramId: id,
  base: snapshot,
  operations: arr(operation, 256, 1),
  undoOf: nullable(id),
});
const proposalSchema = schema('diagram-change-proposal', 'diagram-change-proposal', {
  proposalId: id,
  diagramId: id,
  base: snapshot,
  transaction: transactionSchema,
  summary: str(4096, 1),
  author: closed({ kind: enumOf('human', 'agent'), id }),
  status: enumOf('proposed', 'accepted', 'rejected', 'stale'),
});
const publicationSchema = schema('diagram-publication-state', 'diagram-publication-state', {
  diagramId: id,
  draft: nullable(snapshot),
  published: nullable(snapshot),
  audience: enumOf('private', 'company', 'public'),
  capabilitySemantics: { const: 'descriptive-only-requires-host-authorization' },
});
const manifestSchema = schema('diagram-manifest', 'diagram-manifest', {
  diagramId: id,
  basis: snapshot,
  bundle: closed({ path: relativePath, transportDigest: digest }),
  renderer: closed({ id: token, version: str(64, 1) }),
  outputs: arr(
    closed({
      path: relativePath,
      mediaType: enumOf('image/svg+xml', 'text/html', 'image/png'),
      transportDigest: digest,
      fidelity: fidelitySchema,
    }),
    32,
    1,
  ),
});
// Export consumers record the concrete palette version independently of renderer code.
manifestSchema.properties.theme = closed({ id: token, version: str(64, 1) });
const mermaidConstruct = closed({
  construct: token,
  import: fidelityValue,
  export: fidelityValue,
  semanticRoundTrip: fidelityValue,
  mapping: str(512, 1),
});
const capabilityProfile = closed({
  grammarId: enumOf('flowchart', 'process', 'swimlane', 'architecture'),
  authoring: { const: true },
  primitives: arr(
    enumOf('node', 'relation', 'group', 'lane', 'annotation', 'emphasis'),
    6,
    1,
    true,
  ),
  nodeKinds: arr(enumOf(...semanticKinds), 6, 1, true),
  relationKinds: arr(enumOf(...relationKinds), 5, 1, true),
  operations: arr(enumOf(...DIAGRAM_EDIT_OPERATION_CLASSES), 6, 6, true),
  mermaid: closed({
    mode: { const: 'copy' },
    certificationVersion: { const: 'flowchart-copy-v1' },
    constructs: arr(mermaidConstruct, 32, 1),
    linkedSource: { const: false },
  }),
});
const capabilitiesSchema = schema(
  'diagram-authoring-capabilities',
  'diagram-authoring-capabilities',
  {
    version: { const: '1.0.0' },
    liveCollaboration: { const: false },
    profiles: arr(capabilityProfile, 4, 4),
    unsupportedGrammars: arr(token, 128, 0, true),
  },
);
const schemas = {
  'diagram-document': documentSchema,
  'diagram-presentation': presentationSchema,
  'diagram-authoring-bundle': bundleSchema,
  'diagram-edit-transaction': transactionSchema,
  'diagram-source-map': sourceMapSchema,
  'diagram-fidelity-report': fidelitySchema,
  'diagram-manifest': manifestSchema,
  'diagram-change-proposal': proposalSchema,
  'diagram-publication-state': publicationSchema,
  'diagram-authoring-capabilities': capabilitiesSchema,
};
export const DIAGRAM_AUTHORING_SCHEMAS = deepFreeze(schemas);
export const DIAGRAM_AUTHORING_CONTRACT_FILES = deepFreeze(
  Object.fromEntries(Object.keys(schemas).map((name) => [name, `${name}.schema.json`])),
);
const mermaidConstructs = [
  [
    'flowchart-direction',
    'lossless',
    'lossless',
    'lossless',
    'flowchart TB/TD/LR/RL/BT maps to presentation layout direction',
  ],
  [
    'explicit-node-id',
    'lossless',
    'lossless',
    'lossless',
    'Explicit source ID maps through source-map to stable semantic node ID; labels never establish identity',
  ],
  [
    'plain-node-label',
    'lossless',
    'lossless',
    'lossless',
    'Escaped plain text maps to node label; HTML is inert text and is not executed',
  ],
  [
    'rectangle-node',
    'lossless',
    'lossless',
    'lossless',
    'node.kind process and presentation shape rectangle',
  ],
  [
    'rounded-node',
    'lossless',
    'lossless',
    'lossless',
    'node.kind process and presentation shape rounded-rectangle',
  ],
  [
    'decision-node',
    'lossless',
    'lossless',
    'lossless',
    'node.kind decision and presentation shape diamond',
  ],
  [
    'cylinder-node',
    'lossless',
    'lossless',
    'lossless',
    'node.kind data-store and presentation shape cylinder',
  ],
  [
    'directed-edge',
    'lossless',
    'lossless',
    'lossless',
    'relation.kind flow and direction forward; source and target IDs are semantic endpoints',
  ],
  [
    'bidirectional-edge',
    'lossless',
    'lossless',
    'lossless',
    'relation.kind flow and direction both',
  ],
  [
    'undirected-edge',
    'lossless',
    'lossless',
    'lossless',
    'relation.kind association and direction none',
  ],
  [
    'plain-edge-label',
    'lossless',
    'lossless',
    'lossless',
    'Escaped plain text maps to relation label',
  ],
  [
    'subgraph',
    'lossless',
    'lossless',
    'lossless',
    'Explicit subgraph ID maps to one semantic group in an acyclic single-parent forest',
  ],
  [
    'lane-semantics',
    'unsupported',
    'partial',
    'partial',
    'Mermaid subgraphs do not encode lane identity or explicit lane order',
  ],
  [
    'manual-geometry',
    'unsupported',
    'partial',
    'partial',
    'Standard Mermaid does not preserve coordinates, routes, attachments, stacking or locks',
  ],
  [
    'styles-and-directives',
    'unsupported',
    'unsupported',
    'unsupported',
    'CSS, classDef, init directives, links, callbacks and HTML labels are outside this certified subset',
  ],
  [
    'unsupported-construct',
    'unsupported',
    'unsupported',
    'unsupported',
    'Unrecognized syntax is retained as original source with explicit loss diagnostics',
  ],
].map(([construct, input, output, roundTrip, mapping]) => ({
  construct,
  import: input,
  export: output,
  semanticRoundTrip: roundTrip,
  mapping,
}));
const profileIds = ['flowchart', 'process', 'swimlane', 'architecture'];
export const DIAGRAM_AUTHORING_CAPABILITIES = deepFreeze({
  kind: 'diagram-authoring-capabilities',
  schemaVersion: '1.0.0',
  protocolVersion: '1.13.0',
  version: '1.0.0',
  liveCollaboration: false,
  profiles: profileIds.map((grammarId) => ({
    grammarId,
    authoring: true,
    primitives: [
      'node',
      'relation',
      'group',
      ...(grammarId === 'process' || grammarId === 'swimlane' ? ['lane'] : []),
      'annotation',
      'emphasis',
    ],
    nodeKinds: [...semanticKinds],
    relationKinds: [...relationKinds],
    operations: [...DIAGRAM_EDIT_OPERATION_CLASSES],
    mermaid: {
      mode: 'copy',
      certificationVersion: 'flowchart-copy-v1',
      constructs: mermaidConstructs.map((entry) => ({ ...entry })),
      linkedSource: false,
    },
  })),
  unsupportedGrammars: DIAGRAM_REGISTRIES['diagram-grammars.json'].grammars
    .map((entry) => entry.grammarId)
    .filter((value) => !profileIds.includes(value)),
});
export function getDiagramAuthoringCapability(grammarId) {
  return (
    DIAGRAM_AUTHORING_CAPABILITIES.profiles.find((entry) => entry.grammarId === grammarId) ?? null
  );
}

const error = (path, rule, detail) => ({ path, rule, detail });
// Descriptors are inspected before values; neither validation nor hashing invokes accessors.
function inspectData(value) {
  const issues = [];
  const ancestors = new Set();
  let count = 0;
  let textSize = 0;
  function visit(current, path, depth) {
    if (issues.length) return;
    if (++count > DIAGRAM_AUTHORING_LIMITS.values || depth > DIAGRAM_AUTHORING_LIMITS.depth) {
      issues.push(
        error(path, 'resource-limit', 'Data exceeds the portable value or nesting limit.'),
      );
      return;
    }
    if (typeof current === 'string') {
      textSize += current.length;
      if (textSize > DIAGRAM_AUTHORING_LIMITS.textCodeUnits)
        issues.push(error(path, 'resource-limit', 'Data exceeds the portable text limit.'));
      else if (
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(current)
      )
        issues.push(error(path, 'unicode', 'Unpaired Unicode surrogate is not portable UTF-8.'));
      return;
    }
    if (current === null || typeof current === 'boolean') return;
    if (typeof current === 'number') {
      if (!Number.isFinite(current))
        issues.push(error(path, 'finite-number', 'Numbers must be finite.'));
      return;
    }
    if (typeof current !== 'object') {
      issues.push(error(path, 'plain-data', 'Only JSON data is accepted.'));
      return;
    }
    const proto = Object.getPrototypeOf(current);
    if (
      Array.isArray(current)
        ? proto !== Array.prototype
        : proto !== Object.prototype && proto !== null
    ) {
      issues.push(error(path, 'plain-data', 'Custom prototypes are not accepted.'));
      return;
    }
    if (ancestors.has(current)) {
      issues.push(error(path, 'cycle', 'Cyclic data is not accepted.'));
      return;
    }
    ancestors.add(current);
    const descriptors = Object.getOwnPropertyDescriptors(current);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (
        typeof key !== 'string' ||
        key === '__proto__' ||
        key === 'constructor' ||
        key === 'prototype'
      ) {
        issues.push(error(path, 'unsafe-key', 'Unsafe or symbolic object key.'));
        break;
      }
      const descriptor = descriptors[key];
      if (descriptor.get || descriptor.set || !('value' in descriptor)) {
        issues.push(error(path, 'accessor', 'Accessors are not accepted.'));
        break;
      }
      if (Array.isArray(current) && key === 'length') continue;
      if (
        !descriptor.enumerable ||
        (Array.isArray(current) &&
          (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= current.length))
      ) {
        issues.push(error(path, 'plain-data', 'Non-JSON properties are not accepted.'));
        break;
      }
      visit(
        descriptor.value,
        Array.isArray(current) ? `${path}[${key}]` : `${path}.${key}`,
        depth + 1,
      );
      if (issues.length) break;
    }
    if (
      !issues.length &&
      Array.isArray(current) &&
      Object.keys(descriptors).length !== current.length + 1
    )
      issues.push(error(path, 'sparse-array', 'Sparse arrays are not accepted.'));
    ancestors.delete(current);
  }
  try {
    visit(value, '$', 0);
  } catch {
    issues.push(error('$', 'plain-data', 'Data cannot be inspected safely.'));
  }
  return issues;
}
function assertData(value) {
  const issues = inspectData(value);
  if (issues.length) throw new TypeError(`${issues[0].path}: ${issues[0].rule}`);
}
function digestExcluding(value, field) {
  assertData(value);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Digest input must be an object.');
  const input = { ...value };
  delete input[field];
  return sha256Jcs(input);
}
export const diagramDocumentDigest = (value) => digestExcluding(value, 'documentDigest');
export const diagramPresentationDigest = (value) => digestExcluding(value, 'presentationDigest');
export const diagramAuthoringBundleDigest = (value) => digestExcluding(value, 'bundleDigest');
const same = (a, b) => canonicalizeJson(a) === canonicalizeJson(b);
const sourceDigest = (text) => `sha256:${sha256Hex(text)}`;
const semanticNames = [
  'nodes',
  'relations',
  'groups',
  'lanes',
  'events',
  'series',
  'axes',
  'sets',
  'annotations',
];
const allElements = (doc) => semanticNames.flatMap((name) => doc[name]);
const expectedSnapshot = (bundle) => ({
  bundleDigest: bundle.bundleDigest,
  semanticDigest: bundle.document.documentDigest,
  presentationDigest: bundle.presentation.presentationDigest,
});
function hasContainmentCycle(parents) {
  const complete = new Set();
  for (const member of parents.keys()) {
    const visited = new Set();
    let current = member;
    while (current && !complete.has(current)) {
      if (visited.has(current)) return true;
      visited.add(current);
      current = parents.get(current);
    }
    for (const item of visited) complete.add(item);
  }
  return false;
}

function documentIssues(doc, path, issues) {
  const entries = allElements(doc);
  const byId = new Map();
  if (entries.length + doc.emphasis.length > 10000)
    issues.push(error(path, 'resource-limit', 'Too many semantic primitive entries.'));
  for (const collection of semanticNames)
    for (let i = 0; i < doc[collection].length; i += 1) {
      const entry = doc[collection][i];
      if (byId.has(entry.id))
        issues.push(
          error(
            `${path}.${collection}[${i}].id`,
            'duplicate-id',
            'Semantic element IDs must be globally unique.',
          ),
        );
      byId.set(entry.id, { ...entry, collection });
    }
  const capability = getDiagramAuthoringCapability(doc.grammar.id);
  if (!capability.primitives.includes('lane') && doc.lanes.length)
    issues.push(
      error(`${path}.lanes`, 'profile-primitive', 'This authoring profile does not support lanes.'),
    );
  doc.relations.forEach((edge, i) =>
    ['from', 'to'].forEach((key) => {
      if (byId.get(edge[key])?.collection !== 'nodes')
        issues.push(
          error(
            `${path}.relations[${i}].${key}`,
            'endpoint',
            'Relationship endpoints must reference semantic nodes.',
          ),
        );
    }),
  );
  const parent = new Map();
  for (const collection of ['groups', 'lanes'])
    doc[collection].forEach((group, i) =>
      group.members.forEach((member, j) => {
        const child = byId.get(member);
        const memberPath = `${path}.${collection}[${i}].members[${j}]`;
        if (!child || !['nodes', 'groups', 'lanes', 'annotations'].includes(child.collection))
          issues.push(
            error(
              memberPath,
              'containment-reference',
              'Container members must reference a placeable semantic element.',
            ),
          );
        if (parent.has(member))
          issues.push(
            error(
              memberPath,
              'multiple-parents',
              'An element has more than one immediate container.',
            ),
          );
        parent.set(member, group.id);
      }),
    );
  if (hasContainmentCycle(parent))
    issues.push(error(path, 'containment-cycle', 'Container membership must form a forest.'));
  if (!same([...doc.laneOrder].sort(), doc.lanes.map((item) => item.id).sort()))
    issues.push(
      error(`${path}.laneOrder`, 'lane-order', 'Every lane must occur exactly once in laneOrder.'),
    );
  doc.annotations.forEach((entry, i) => {
    if (entry.targetId !== null && !byId.has(entry.targetId))
      issues.push(
        error(`${path}.annotations[${i}].targetId`, 'reference', 'Annotation target is missing.'),
      );
  });
  const emphasisIds = new Set();
  doc.emphasis.forEach((entry, i) => {
    if (!byId.has(entry.targetId))
      issues.push(
        error(`${path}.emphasis[${i}].targetId`, 'reference', 'Emphasis target is missing.'),
      );
    if (emphasisIds.has(entry.targetId))
      issues.push(
        error(
          `${path}.emphasis[${i}].targetId`,
          'duplicate-id',
          'Only one emphasis entry is allowed per target.',
        ),
      );
    emphasisIds.add(entry.targetId);
  });
  doc.accessibility.readingOrder.forEach((entry, i) => {
    if (!byId.has(entry))
      issues.push(
        error(
          `${path}.accessibility.readingOrder[${i}]`,
          'reference',
          'Reading order target is missing.',
        ),
      );
  });
  if (doc.documentDigest !== diagramDocumentDigest(doc))
    issues.push(
      error(`${path}.documentDigest`, 'digest', 'Semantic content digest does not match.'),
    );
}
function presentationIssues(value, doc, path, issues) {
  const idsSeen = new Set();
  const byId = doc ? new Map(allElements(doc).map((entry) => [entry.id, entry])) : null;
  const nodes = doc ? new Set(doc.nodes.map((entry) => entry.id)) : null;
  const relations = doc ? new Map(doc.relations.map((entry) => [entry.id, entry])) : null;
  const containers = doc ? new Set([...doc.groups, ...doc.lanes].map((entry) => entry.id)) : null;
  if (doc && (value.diagramId !== doc.diagramId || value.semanticDigest !== doc.documentDigest))
    issues.push(
      error(path, 'basis', 'Presentation does not reference the exact semantic document.'),
    );
  value.elements.forEach((entry, i) => {
    const location = `${path}.elements[${i}]`;
    geometryIssues(entry, location, issues);
    if (idsSeen.has(entry.elementId))
      issues.push(
        error(`${location}.elementId`, 'duplicate-id', 'Presentation element IDs must be unique.'),
      );
    idsSeen.add(entry.elementId);
    if (byId && !byId.has(entry.elementId))
      issues.push(
        error(
          `${location}.elementId`,
          'reference',
          'Presentation element is not in the semantic document.',
        ),
      );
    if (entry.route !== null && entry.bounds !== null)
      issues.push(error(location, 'geometry-kind', 'A connector has a route; a shape has bounds.'));
    if (entry.route === null && entry.bounds === null)
      issues.push(error(location, 'geometry-kind', 'A placed element requires bounds or a route.'));
    if (entry.route?.mode === 'manual' && entry.route.points.length < 2)
      issues.push(
        error(
          `${location}.route.points`,
          'manual-route',
          'A manual route requires at least two global points.',
        ),
      );
    if (entry.route?.mode === 'automatic' && entry.route.points.length !== 0)
      issues.push(
        error(
          `${location}.route.points`,
          'automatic-route',
          'Automatic route geometry is derived and must not carry authored points.',
        ),
      );
    if (entry.route && entry.appearance.shape !== 'connector')
      issues.push(
        error(`${location}.appearance.shape`, 'shape-kind', 'Routes must use the connector shape.'),
      );
    if (entry.bounds && entry.appearance.shape === 'connector')
      issues.push(
        error(
          `${location}.appearance.shape`,
          'shape-kind',
          'Bounded elements cannot use the connector shape.',
        ),
      );
    if (relations?.has(entry.elementId) && !entry.route)
      issues.push(error(location, 'geometry-kind', 'Semantic relations require route geometry.'));
    if (doc && !relations.has(entry.elementId) && !entry.bounds)
      issues.push(error(location, 'geometry-kind', 'Non-relation elements require bounds.'));
    if (containers?.has(entry.elementId) && entry.appearance.shape !== 'container')
      issues.push(
        error(
          `${location}.appearance.shape`,
          'shape-kind',
          'Containers require the container visual shape.',
        ),
      );
    if (nodes?.has(entry.elementId) && ['container', 'text'].includes(entry.appearance.shape))
      issues.push(
        error(`${location}.appearance.shape`, 'shape-kind', 'Nodes require a node visual shape.'),
      );
  });
  if (byId && (idsSeen.size !== byId.size || [...byId.keys()].some((key) => !idsSeen.has(key))))
    issues.push(
      error(
        `${path}.elements`,
        'presentation-coverage',
        'Every semantic element must have exactly one placement.',
      ),
    );
  if (value.presentationDigest !== diagramPresentationDigest(value))
    issues.push(
      error(`${path}.presentationDigest`, 'digest', 'Presentation content digest does not match.'),
    );
}
function sourceMapIssues(value, doc, text, path, issues) {
  if (doc && (value.diagramId !== doc.diagramId || value.semanticDigest !== doc.documentDigest))
    issues.push(error(path, 'basis', 'Source map does not reference the exact semantic document.'));
  const elementIds = doc ? new Set(allElements(doc).map((entry) => entry.id)) : null;
  const sourceIds = new Set();
  let boundaries = null;
  if (text !== undefined) {
    const byteLength = new TextEncoder().encode(text).length;
    if (value.sourceDigest !== sourceDigest(text) || value.sourceByteLength !== byteLength)
      issues.push(
        error(
          path,
          'source-digest',
          'Source digest and byte length must match exact UTF-8 source text.',
        ),
      );
    const requested = new Set(
      value.entries.flatMap((entry) =>
        entry.range ? [entry.range.startByte, entry.range.endByte] : [],
      ),
    );
    boundaries = new Set([0]);
    let cursor = 0;
    for (const character of text) {
      const code = character.codePointAt(0);
      cursor += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      if (requested.has(cursor)) boundaries.add(cursor);
    }
  }
  value.entries.forEach((entry, i) => {
    const location = `${path}.entries[${i}]`;
    if (entry.sourceId !== null && sourceIds.has(entry.sourceId))
      issues.push(
        error(
          `${location}.sourceId`,
          'ambiguous-source-id',
          'Duplicate explicit source IDs must be represented by one ambiguous entry.',
        ),
      );
    if (entry.sourceId !== null) sourceIds.add(entry.sourceId);
    if (
      entry.confidence === 'exact' &&
      ((entry.sourceId === null && entry.range === null) || entry.elementIds.length !== 1)
    )
      issues.push(
        error(
          location,
          'source-identity',
          'Exact correspondence requires a source ID or exact range and one semantic element.',
        ),
      );
    const certification = mermaidConstructs.find((item) => item.construct === entry.construct);
    if (
      !certification ||
      (certification.import === 'unsupported' &&
        (entry.confidence === 'exact' || entry.losses.length === 0))
    )
      issues.push(
        error(
          `${location}.construct`,
          'source-certification',
          'Unsupported syntax requires the certified loss record and cannot claim exact correspondence.',
        ),
      );
    if (elementIds)
      entry.elementIds.forEach((item, j) => {
        if (!elementIds.has(item))
          issues.push(
            error(
              `${location}.elementIds[${j}]`,
              'reference',
              'Source map semantic element is missing.',
            ),
          );
      });
    if (
      entry.range &&
      (entry.range.startByte > entry.range.endByte ||
        entry.range.endByte > value.sourceByteLength ||
        (boundaries &&
          (!boundaries.has(entry.range.startByte) || !boundaries.has(entry.range.endByte))))
    )
      issues.push(
        error(
          `${location}.range`,
          'source-range',
          'Source range must lie on UTF-8 boundaries within the original source.',
        ),
      );
  });
}
function bundleIssues(bundle, path, issues) {
  documentIssues(bundle.document, `${path}.document`, issues);
  presentationIssues(bundle.presentation, bundle.document, `${path}.presentation`, issues);
  if (
    bundle.diagramId !== bundle.document.diagramId ||
    bundle.diagramId !== bundle.presentation.diagramId
  )
    issues.push(
      error(`${path}.diagramId`, 'diagram-id', 'Bundle members must identify one diagram.'),
    );
  if ((bundle.originalSource === null) !== (bundle.sourceMap === null))
    issues.push(
      error(
        path,
        'source-pair',
        'Original source and its correspondence map must be retained together.',
      ),
    );
  if (bundle.originalSource) {
    if (
      new TextEncoder().encode(bundle.originalSource.text).length >
      DIAGRAM_AUTHORING_LIMITS.sourceBytes
    )
      issues.push(
        error(
          `${path}.originalSource.text`,
          'resource-limit',
          'Original source exceeds the UTF-8 byte limit.',
        ),
      );
    if (bundle.originalSource.sourceDigest !== sourceDigest(bundle.originalSource.text))
      issues.push(
        error(
          `${path}.originalSource.sourceDigest`,
          'source-digest',
          'Source digest must match exact original UTF-8 bytes.',
        ),
      );
  }
  if (bundle.sourceMap)
    sourceMapIssues(
      bundle.sourceMap,
      bundle.document,
      bundle.originalSource?.text,
      `${path}.sourceMap`,
      issues,
    );
  if (bundle.bundleDigest !== diagramAuthoringBundleDigest(bundle))
    issues.push(error(`${path}.bundleDigest`, 'digest', 'Bundle content digest does not match.'));
}

function basisIssues(value, bundle, path, issues) {
  if (
    bundle &&
    (value.diagramId !== bundle.diagramId ||
      !same(value.base ?? value.basis, expectedSnapshot(bundle)))
  )
    issues.push(
      error(path, 'basis', 'The artifact does not reference the exact supplied bundle snapshot.'),
    );
}
function transactionIssues(value, bundle, path, issues) {
  basisIssues(value, bundle, path, issues);
  if (value.undoOf === value.transactionId)
    issues.push(
      error(`${path}.undoOf`, 'undo-reference', 'An inverse cannot reference its own transaction.'),
    );
  const available = bundle ? new Set(allElements(bundle.document).map((entry) => entry.id)) : null;
  const collectionById = bundle
    ? new Map(
        semanticNames.flatMap((name) => bundle.document[name].map((entry) => [entry.id, name])),
      )
    : null;
  const insertedCollections = new Map();
  const inserted = new Set();
  const removed = new Set();
  const capability = bundle ? getDiagramAuthoringCapability(bundle.document.grammar.id) : null;
  const collectionOf = (elementId) =>
    collectionById?.get(elementId) ?? insertedCollections.get(elementId);
  const membershipReferences = (collection, item, location) => {
    if (!collectionById) return;
    const actualCollection = collectionOf(item.id);
    if (!actualCollection)
      issues.push(
        error(
          `${location}.id`,
          'containment-reference',
          'Membership container is not in the base or inserts.',
        ),
      );
    else if (actualCollection !== collection)
      issues.push(
        error(
          `${location}.id`,
          'element-class',
          'Membership container must match its semantic collection.',
        ),
      );
    item.members.forEach((member, j) => {
      if (!['nodes', 'groups', 'lanes', 'annotations'].includes(collectionOf(member)))
        issues.push(
          error(
            `${location}.members[${j}]`,
            'containment-reference',
            'Container members must reference placeable elements in the base or inserts.',
          ),
        );
    });
  };
  const semanticGeometry = (collection, geometry, location) => {
    if (collection && (collection === 'relations') !== (geometry.route !== null))
      issues.push(
        error(location, 'geometry-kind', 'Geometry must match the semantic element class.'),
      );
  };
  const semanticAppearance = (collection, appearance, location) => {
    if (!collection) return;
    const shape = appearance.shape;
    if (
      (collection === 'relations' && shape !== 'connector') ||
      (collection !== 'relations' && shape === 'connector') ||
      (['groups', 'lanes'].includes(collection) && shape !== 'container') ||
      (collection === 'nodes' && ['container', 'text'].includes(shape))
    )
      issues.push(
        error(
          `${location}.shape`,
          'shape-kind',
          'Appearance must match the semantic element class.',
        ),
      );
  };
  // This inspects references only. Applying changes, checking before-values in sequence,
  // computing inverse operations and committing revisions belong to the edit kernel.
  value.operations.forEach((op, i) => {
    const location = `${path}.operations[${i}]`;
    if (op.type === 'insert-elements' || op.type === 'remove-elements') {
      const entryIds = op.elements.map((entry) => entry.value.id);
      const presentationIds = op.presentation.map((entry) => entry.elementId);
      if (new Set(entryIds).size !== entryIds.length)
        issues.push(
          error(
            `${location}.elements`,
            'duplicate-id',
            'Each operation must identify unique semantic elements.',
          ),
        );
      if (!same([...entryIds].sort(), [...presentationIds].sort()))
        issues.push(
          error(
            `${location}.presentation`,
            'presentation-coverage',
            'Inserted or removed semantic elements require matching presentation entries.',
          ),
        );
      if (op.type === 'insert-elements' && op.positions) {
        const positionedIds = op.positions.map((entry) => entry.elementId);
        if (new Set(positionedIds).size !== positionedIds.length)
          issues.push(
            error(
              `${location}.positions`,
              'duplicate-id',
              'Insertion positions must identify each element once.',
            ),
          );
        if (!same([...entryIds].sort(), [...positionedIds].sort()))
          issues.push(
            error(
              `${location}.positions`,
              'position-coverage',
              'Insertion positions must cover exactly the inserted elements.',
            ),
          );
      }
      for (const entry of op.elements) {
        if (op.type === 'insert-elements') {
          if (entry.collection === 'lanes' && capability && !capability.primitives.includes('lane'))
            issues.push(
              error(
                `${location}.elements`,
                'profile-primitive',
                'This authoring profile does not support lanes.',
              ),
            );
          if (inserted.has(entry.value.id) || available?.has(entry.value.id))
            issues.push(
              error(
                `${location}.elements`,
                'duplicate-id',
                'An insert must allocate a new stable element ID.',
              ),
            );
          inserted.add(entry.value.id);
          insertedCollections.set(entry.value.id, entry.collection);
        } else {
          if (removed.has(entry.value.id))
            issues.push(
              error(`${location}.elements`, 'duplicate-id', 'An element cannot be removed twice.'),
            );
          if (available && !available.has(entry.value.id) && !inserted.has(entry.value.id))
            issues.push(
              error(
                `${location}.elements`,
                'reference',
                'Removed element is not in the base or earlier inserts.',
              ),
            );
          if (
            collectionById &&
            (collectionById.get(entry.value.id) ?? insertedCollections.get(entry.value.id)) !==
              entry.collection
          )
            issues.push(
              error(
                `${location}.elements`,
                'element-class',
                'Removed entry must identify the actual semantic element class.',
              ),
            );
          removed.add(entry.value.id);
        }
      }
      if (op.type === 'insert-elements' && collectionById)
        op.elements.forEach((entry, j) => {
          if (entry.collection === 'relations')
            for (const endpoint of ['from', 'to']) {
              if (
                (collectionById.get(entry.value[endpoint]) ??
                  insertedCollections.get(entry.value[endpoint])) !== 'nodes'
              )
                issues.push(
                  error(
                    `${location}.elements[${j}].value.${endpoint}`,
                    'endpoint',
                    'Relationship endpoints must identify nodes in the base or this insertion.',
                  ),
                );
            }
          if (['groups', 'lanes'].includes(entry.collection))
            membershipReferences(entry.collection, entry.value, `${location}.elements[${j}].value`);
          if (
            entry.collection === 'annotations' &&
            entry.value.targetId !== null &&
            !collectionOf(entry.value.targetId)
          )
            issues.push(
              error(
                `${location}.elements[${j}].value.targetId`,
                'reference',
                'Annotation target is not in the base or inserts.',
              ),
            );
        });
      // Validate geometry kind and routing even without a semantic context.
      for (const [j, entry] of op.presentation.entries()) {
        const semantic = op.elements.find((item) => item.value.id === entry.elementId);
        geometryIssues(entry, `${location}.presentation[${j}]`, issues);
        semanticGeometry(semantic?.collection, entry, `${location}.presentation[${j}]`);
        semanticAppearance(
          semantic?.collection,
          entry.appearance,
          `${location}.presentation[${j}].appearance`,
        );
      }
    } else if (op.type === 'set-geometry' || op.type === 'set-appearance-locks') {
      const touched = new Set();
      op.changes.forEach((change, j) => {
        if (touched.has(change.elementId))
          issues.push(
            error(
              `${location}.changes[${j}].elementId`,
              'duplicate-id',
              'An operation must list each affected element once.',
            ),
          );
        touched.add(change.elementId);
        if (available && !available.has(change.elementId) && !inserted.has(change.elementId))
          issues.push(
            error(
              `${location}.changes[${j}].elementId`,
              'reference',
              'Affected element is not in the base or earlier inserts.',
            ),
          );
        for (const side of ['before', 'after']) {
          const changePath = `${location}.changes[${j}].${side}`;
          if (op.type === 'set-geometry') {
            geometryIssues(change[side], changePath, issues);
            if (collectionById)
              semanticGeometry(collectionOf(change.elementId), change[side], changePath);
          } else if (collectionById)
            semanticAppearance(
              collectionOf(change.elementId),
              change[side].appearance,
              `${changePath}.appearance`,
            );
        }
      });
    } else if (op.type === 'update-semantics') {
      if (
        op.collection === 'emphasis' &&
        op.index !== undefined &&
        (op.before !== null || op.after === null)
      )
        issues.push(
          error(
            `${location}.index`,
            'insertion-position',
            'An emphasis index is only valid when inserting an emphasis entry.',
          ),
        );
      if (
        !['document', 'source-map'].includes(op.collection) &&
        available &&
        !available.has(op.elementId) &&
        !inserted.has(op.elementId)
      )
        issues.push(
          error(
            `${location}.elementId`,
            'reference',
            'Affected semantic element is not in the base or earlier inserts.',
          ),
        );
      if (
        !['document', 'source-map', 'emphasis'].includes(op.collection) &&
        collectionById &&
        (collectionById.get(op.elementId) ?? insertedCollections.get(op.elementId)) !==
          op.collection
      )
        issues.push(
          error(
            `${location}.collection`,
            'element-class',
            'An update cannot change the class of its semantic element.',
          ),
        );
      if (op.collection === 'relations')
        for (const side of ['before', 'after'])
          for (const end of ['from', 'to']) {
            if (
              collectionById &&
              (collectionById.get(op[side][end]) ?? insertedCollections.get(op[side][end])) !==
                'nodes'
            )
              issues.push(
                error(
                  `${location}.${side}.${end}`,
                  'endpoint',
                  'Relationship endpoints must identify nodes in the base or inserts.',
                ),
              );
          }
      if (collectionById && op.collection === 'annotations')
        for (const side of ['before', 'after']) {
          if (op[side].targetId !== null && !collectionOf(op[side].targetId))
            issues.push(
              error(
                `${location}.${side}.targetId`,
                'reference',
                'Annotation target is not in the base or inserts.',
              ),
            );
        }
      if (collectionById && op.collection === 'document')
        for (const side of ['before', 'after'])
          op[side].accessibility.readingOrder.forEach((elementId, j) => {
            if (!collectionOf(elementId))
              issues.push(
                error(
                  `${location}.${side}.accessibility.readingOrder[${j}]`,
                  'reference',
                  'Reading order target is not in the base or inserts.',
                ),
              );
          });
    } else if (op.type === 'set-membership-order') {
      for (const side of ['before', 'after']) {
        const state = op[side];
        if (state.lanes.length && capability && !capability.primitives.includes('lane'))
          issues.push(
            error(
              `${location}.${side}.lanes`,
              'profile-primitive',
              'This authoring profile does not support lanes.',
            ),
          );
        for (const collection of ['groups', 'lanes'])
          state[collection].forEach((item, j) =>
            membershipReferences(collection, item, `${location}.${side}.${collection}[${j}]`),
          );
        const parents = new Map();
        const containers = [...state.groups, ...state.lanes];
        if (new Set(containers.map((item) => item.id)).size !== containers.length)
          issues.push(
            error(
              `${location}.${side}`,
              'duplicate-id',
              'Membership lists require distinct container IDs.',
            ),
          );
        for (const item of containers)
          for (const member of item.members) {
            if (parents.has(member))
              issues.push(
                error(
                  `${location}.${side}`,
                  'multiple-parents',
                  'Membership assigns more than one immediate parent.',
                ),
              );
            parents.set(member, item.id);
          }
        if (hasContainmentCycle(parents))
          issues.push(
            error(`${location}.${side}`, 'containment-cycle', 'Membership must form a forest.'),
          );
        if (!same([...state.laneOrder].sort(), state.lanes.map((item) => item.id).sort()))
          issues.push(
            error(
              `${location}.${side}.laneOrder`,
              'lane-order',
              'Membership includes every lane in explicit order.',
            ),
          );
      }
    }
  });
}
function geometryIssues(entry, path, issues) {
  if ((entry.bounds === null) === (entry.route === null))
    issues.push(error(path, 'geometry-kind', 'Geometry requires exactly one of bounds or route.'));
  if (entry.route?.mode === 'manual' && entry.route.points.length < 2)
    issues.push(
      error(
        `${path}.route.points`,
        'manual-route',
        'Manual routes require at least two global points.',
      ),
    );
  if (entry.route?.mode === 'automatic' && entry.route.points.length !== 0)
    issues.push(
      error(`${path}.route.points`, 'automatic-route', 'Automatic route points are derived.'),
    );
  if (
    entry.route?.mode === 'manual' &&
    entry.route.strategy === 'straight' &&
    entry.route.points.length !== 2
  )
    issues.push(
      error(
        `${path}.route.points`,
        'route-strategy',
        'A straight manual route has exactly two endpoint points.',
      ),
    );
  if (
    entry.route?.mode === 'manual' &&
    entry.route.strategy === 'orthogonal' &&
    entry.route.points.some(
      (point, i, points) => i > 0 && point.x !== points[i - 1].x && point.y !== points[i - 1].y,
    )
  )
    issues.push(
      error(
        `${path}.route.points`,
        'route-strategy',
        'Every orthogonal segment must be horizontal or vertical.',
      ),
    );
}
function fidelityIssues(value, bundle, path, issues) {
  basisIssues(value, bundle, path, issues);
  const idsKnown = bundle ? new Set(allElements(bundle.document).map((entry) => entry.id)) : null;
  for (const [i, loss] of value.losses.entries()) {
    if (value[loss.dimension] === 'lossless')
      issues.push(
        error(
          `${path}.${loss.dimension}`,
          'fidelity',
          'A dimension with reported loss cannot claim lossless fidelity.',
        ),
      );
    if (idsKnown)
      loss.elementIds.forEach((entry, j) => {
        if (!idsKnown.has(entry))
          issues.push(
            error(
              `${path}.losses[${i}].elementIds[${j}]`,
              'reference',
              'Fidelity loss refers to an unknown semantic element.',
            ),
          );
      });
  }
  if (bundle && value.sourceDigest !== (bundle.originalSource?.sourceDigest ?? null))
    issues.push(
      error(
        `${path}.sourceDigest`,
        'source-digest',
        'Fidelity report must identify the retained source, if any.',
      ),
    );
  if (value.sourceFormat === 'mermaid' && value.sourceDigest === null)
    issues.push(
      error(
        `${path}.sourceDigest`,
        'source-digest',
        'A Mermaid import report must identify its exact source bytes.',
      ),
    );
  if (bundle && value.sourceFormat === 'mermaid') {
    const uncertain = bundle.sourceMap?.entries.some(
      (entry) =>
        entry.confidence === 'ambiguous' ||
        entry.losses.length ||
        mermaidConstructs.find((item) => item.construct === entry.construct)?.import !== 'lossless',
    );
    if (uncertain && value.semantic === 'lossless')
      issues.push(
        error(
          `${path}.semantic`,
          'fidelity',
          'Source correspondence records ambiguity or unsupported content; semantic fidelity cannot be lossless.',
        ),
      );
    const lostPresentation = bundle.sourceMap?.entries.some((entry) =>
      ['styles-and-directives', 'manual-geometry', 'unsupported-construct'].includes(
        entry.construct,
      ),
    );
    if (lostPresentation && value.presentation === 'lossless')
      issues.push(
        error(
          `${path}.presentation`,
          'fidelity',
          'Unsupported source presentation cannot be reported as retained without loss.',
        ),
      );
  }
  if (bundle && value.targetFormat === 'mermaid') {
    if (bundle.presentation.elements.length && value.presentation === 'lossless')
      issues.push(
        error(
          `${path}.presentation`,
          'fidelity',
          'Standard Mermaid does not retain authored global geometry, stacking, attachment offsets or locks.',
        ),
      );
    const appearances = new Map(
      bundle.presentation.elements.map((entry) => [entry.elementId, entry.appearance.shape]),
    );
    const supportedNodes = bundle.document.nodes.every(
      (entry) =>
        (entry.kind === 'process' &&
          ['rectangle', 'rounded-rectangle'].includes(appearances.get(entry.id))) ||
        (entry.kind === 'decision' && appearances.get(entry.id) === 'diamond') ||
        (entry.kind === 'data-store' && appearances.get(entry.id) === 'cylinder'),
    );
    const supportedRelations = bundle.document.relations.every(
      (entry) =>
        (entry.kind === 'flow' && ['forward', 'both'].includes(entry.direction)) ||
        (entry.kind === 'association' && entry.direction === 'none'),
    );
    if (
      (!supportedNodes ||
        !supportedRelations ||
        bundle.document.lanes.length ||
        bundle.document.annotations.length ||
        bundle.document.emphasis.length) &&
      value.semantic === 'lossless'
    )
      issues.push(
        error(
          `${path}.semantic`,
          'fidelity',
          'The certified Mermaid subset cannot preserve all authored semantic roles or primitives.',
        ),
      );
  }
}
const validRelativePath = (value) =>
  !value.split('/').some((part) => part === '' || part === '.' || part === '..') &&
  !/^[A-Za-z]:/u.test(value);

/** Returns located, value-redacted errors. No option bypasses shape, safety or digest checks. */
export function validateDiagramAuthoringArtifact(kind, value, options = {}) {
  const issues = inspectData(value);
  if (issues.length) return issues;
  const optionIssues = inspectData(options);
  if (optionIssues.length)
    return optionIssues.map((entry) => ({
      ...entry,
      path: entry.path.replace(/^\$/u, '$options'),
    }));
  if (
    !options ||
    Array.isArray(options) ||
    typeof options !== 'object' ||
    Object.keys(options).some(
      (key) => !['document', 'bundle', 'baseBundle', 'sourceText'].includes(key),
    )
  )
    return [
      error(
        '$options',
        'options',
        'Only explicit document, bundle, baseBundle and sourceText contexts are accepted.',
      ),
    ];
  if (options.sourceText !== undefined && typeof options.sourceText !== 'string')
    return [error('$options.sourceText', 'type', 'Source text context must be a string.')];
  if (typeof kind !== 'string' || !Object.hasOwn(DIAGRAM_AUTHORING_SCHEMAS, kind))
    return [error('$', 'contract', 'Unknown diagram authoring contract.')];
  const shapeIssues = validateJson(value, DIAGRAM_AUTHORING_SCHEMAS[kind]);
  if (shapeIssues.length)
    return shapeIssues
      .slice(0, 128)
      .map(({ path, rule }) =>
        error(path, rule, 'Value does not satisfy the diagram authoring contract.'),
      );
  // Context is untrusted too. Validate it before reading nested fields or using a digest.
  for (const name of ['document', 'bundle', 'baseBundle'])
    if (options[name] !== undefined) {
      const contextKind = name === 'document' ? 'diagram-document' : 'diagram-authoring-bundle';
      const failures = validateDiagramAuthoringArtifact(contextKind, options[name]);
      issues.push(
        ...failures.map((entry) => ({
          ...entry,
          path: entry.path.replace(/^\$/u, `$options.${name}`),
        })),
      );
    }
  if (issues.length) return issues;
  if (options.bundle && options.baseBundle && !same(options.bundle, options.baseBundle))
    return [error('$options', 'basis', 'Conflicting bundle contexts are not accepted.')];
  const contextBundle = options.baseBundle ?? options.bundle;
  const contextDoc = options.document ?? contextBundle?.document;
  if (options.document && contextBundle && !same(options.document, contextBundle.document))
    return [
      error('$options.document', 'basis', 'Document context must match the supplied bundle.'),
    ];
  if (
    options.sourceText !== undefined &&
    contextBundle?.originalSource &&
    options.sourceText !== contextBundle.originalSource.text
  )
    return [
      error(
        '$options.sourceText',
        'source-digest',
        'Source text context must match the supplied bundle.',
      ),
    ];
  switch (kind) {
    case 'diagram-document':
      documentIssues(value, '$', issues);
      break;
    case 'diagram-presentation':
      presentationIssues(value, contextDoc, '$', issues);
      break;
    case 'diagram-authoring-bundle':
      bundleIssues(value, '$', issues);
      break;
    case 'diagram-source-map':
      sourceMapIssues(
        value,
        contextDoc,
        options.sourceText ?? contextBundle?.originalSource?.text,
        '$',
        issues,
      );
      break;
    case 'diagram-edit-transaction':
      transactionIssues(value, contextBundle, '$', issues);
      break;
    case 'diagram-change-proposal':
      basisIssues(value, contextBundle, '$', issues);
      transactionIssues(value.transaction, contextBundle, '$.transaction', issues);
      if (
        value.diagramId !== value.transaction.diagramId ||
        !same(value.base, value.transaction.base)
      )
        issues.push(
          error(
            '$.transaction',
            'basis',
            'Proposal and transaction must identify the same exact diagram snapshot.',
          ),
        );
      break;
    case 'diagram-fidelity-report':
      fidelityIssues(value, contextBundle, '$', issues);
      break;
    case 'diagram-manifest':
      basisIssues(value, contextBundle, '$', issues);
      if (!validRelativePath(value.bundle.path))
        issues.push(
          error(
            '$.bundle.path',
            'relative-path',
            'Bundle path must remain within its artifact scope.',
          ),
        );
      if (!value.bundle.path.endsWith('.planr-diagram-bundle.json'))
        issues.push(
          error(
            '$.bundle.path',
            'bundle-path',
            'The canonical bundle uses the planr-diagram-bundle.json extension.',
          ),
        );
      value.outputs.forEach((entry, i) => {
        if (!validRelativePath(entry.path))
          issues.push(
            error(
              `$.outputs[${i}].path`,
              'relative-path',
              'Output path must remain within its artifact scope.',
            ),
          );
        if (entry.path === value.bundle.path)
          issues.push(
            error(
              `$.outputs[${i}].path`,
              'canonical-output-collision',
              'A derived output must not overwrite the canonical bundle.',
            ),
          );
        if (
          entry.fidelity.targetFormat !==
          { 'image/svg+xml': 'svg', 'text/html': 'html', 'image/png': 'png' }[entry.mediaType]
        )
          issues.push(
            error(
              `$.outputs[${i}].fidelity.targetFormat`,
              'output-format',
              'Output fidelity must describe the declared media type.',
            ),
          );
        fidelityIssues(entry.fidelity, contextBundle, `$.outputs[${i}].fidelity`, issues);
        if (
          entry.fidelity.diagramId !== value.diagramId ||
          !same(entry.fidelity.basis, value.basis)
        )
          issues.push(
            error(
              `$.outputs[${i}].fidelity`,
              'basis',
              'Every output must identify the manifest snapshot.',
            ),
          );
      });
      if (new Set(value.outputs.map((entry) => entry.path)).size !== value.outputs.length)
        issues.push(error('$.outputs', 'duplicate-path', 'Output paths must be unique.'));
      break;
    case 'diagram-publication-state':
      if (value.draft === null && value.published === null)
        issues.push(
          error(
            '$',
            'publication-reference',
            'Publication metadata must identify at least one snapshot.',
          ),
        );
      if (
        contextBundle &&
        (value.diagramId !== contextBundle.diagramId ||
          ![value.draft, value.published].some(
            (entry) => entry && same(entry, expectedSnapshot(contextBundle)),
          ))
      )
        issues.push(
          error('$', 'basis', 'Publication metadata does not reference the supplied snapshot.'),
        );
      break;
    case 'diagram-authoring-capabilities':
      if (!same(value, DIAGRAM_AUTHORING_CAPABILITIES))
        issues.push(
          error(
            '$',
            'capability-certification',
            'Capability claims must match the versioned certification catalog exactly.',
          ),
        );
      break;
    default:
      break;
  }
  return issues.slice(0, 128);
}
export function assertDiagramAuthoringArtifact(kind, value, options) {
  const errors = validateDiagramAuthoringArtifact(kind, value, options);
  if (errors.length) {
    const failure = new TypeError(
      `Invalid ${kind}: ${errors.map((entry) => `${entry.path}: ${entry.rule}`).join('; ')}`,
    );
    failure.errors = errors;
    throw failure;
  }
  return value;
}
export const validateDiagramDocument = (value, options) =>
  validateDiagramAuthoringArtifact('diagram-document', value, options);
export const assertDiagramDocument = (value, options) =>
  assertDiagramAuthoringArtifact('diagram-document', value, options);
export const validateDiagramPresentation = (value, options) =>
  validateDiagramAuthoringArtifact('diagram-presentation', value, options);
export const assertDiagramPresentation = (value, options) =>
  assertDiagramAuthoringArtifact('diagram-presentation', value, options);
export const validateDiagramAuthoringBundle = (value, options) =>
  validateDiagramAuthoringArtifact('diagram-authoring-bundle', value, options);
export const assertDiagramAuthoringBundle = (value, options) =>
  assertDiagramAuthoringArtifact('diagram-authoring-bundle', value, options);
export const validateDiagramEditTransaction = (value, options) =>
  validateDiagramAuthoringArtifact('diagram-edit-transaction', value, options);
export const assertDiagramEditTransaction = (value, options) =>
  assertDiagramAuthoringArtifact('diagram-edit-transaction', value, options);
export function summarizeDiagramAuthoringContent(bundle) {
  assertDiagramAuthoringBundle(bundle);
  const elementCount = allElements(bundle.document).length;
  return { elementCount, hasVisibleContent: elementCount > 0 };
}

// Inspect the generated, exact frozen v1.6 descriptor without creating migrated data.
export function inspectLegacyDiagramDocument(value) {
  let errors = inspectData(value);
  if (
    !errors.length &&
    value &&
    typeof value === 'object' &&
    (value.protocolVersion !== '1.6.0' || value.schemaVersion !== '1.0.0')
  )
    errors.push(
      error(
        '$',
        'unsupported-version',
        'This inspector accepts only the frozen v1.6 diagram contract.',
      ),
    );
  if (!errors.length)
    errors = validateJson(value, LEGACY_DIAGRAM_DOCUMENT_SCHEMA)
      .slice(0, 128)
      .map(({ path, rule }) =>
        error(path, rule, 'Value does not satisfy the legacy diagram contract.'),
      );
  let grammar = null;
  if (!errors.length) {
    grammar = DIAGRAM_REGISTRIES['diagram-grammars.json'].grammars.find(
      (entry) => entry.grammarId === value.grammar.id,
    );
    if (!grammar) errors.push(error('$.grammar.id', 'grammar', 'Unknown legacy grammar.'));
    if (value.documentDigest !== diagramDocumentDigest(value))
      errors.push(error('$.documentDigest', 'digest', 'Legacy semantic digest does not match.'));
    const elements = allElements(value);
    if (!elements.length && !value.emphasis.length)
      errors.push(error('$', 'visible-content', 'The legacy document contract requires content.'));
    if (elements.length + value.emphasis.length > 10000)
      errors.push(error('$', 'resource-limit', 'Too many legacy semantic primitive entries.'));
    const itemIds = new Set(elements.map((entry) => entry.id));
    if (itemIds.size !== elements.length)
      errors.push(error('$', 'duplicate-id', 'Legacy semantic IDs must be unique.'));
    for (const collection of ['relations', 'groups', 'lanes', 'sets', 'annotations', 'emphasis'])
      value[collection].forEach((entry, i) => {
        const refs =
          collection === 'relations'
            ? [entry.from, entry.to]
            : (entry.members ?? (entry.targetId == null ? [] : [entry.targetId]));
        if (refs.some((ref) => !itemIds.has(ref)))
          errors.push(
            error(`$.${collection}[${i}]`, 'reference', 'Legacy semantic reference is missing.'),
          );
      });
    value.accessibility.readingOrder.forEach((entry, i) => {
      if (!itemIds.has(entry))
        errors.push(
          error(
            `$.accessibility.readingOrder[${i}]`,
            'reference',
            'Legacy reading order target is missing.',
          ),
        );
    });
    if (grammar) {
      if (!grammar.directions.includes(value.layout.direction))
        errors.push(
          error(
            '$.layout.direction',
            'profile-direction',
            'Direction is not supported by the legacy grammar.',
          ),
        );
      if (
        !['quadrant', 'scatter', 'wardley'].includes(grammar.grammarId) &&
        value.nodes.some((entry) => entry.semanticPosition != null)
      )
        errors.push(
          error(
            '$.nodes',
            'semantic-position',
            'Semantic position is not supported by this legacy grammar.',
          ),
        );
      const plural = {
        node: 'nodes',
        relation: 'relations',
        group: 'groups',
        lane: 'lanes',
        event: 'events',
        series: 'series',
        axis: 'axes',
        set: 'sets',
        annotation: 'annotations',
        emphasis: 'emphasis',
      };
      for (const [primitive, collection] of Object.entries(plural)) {
        if (value[collection].length && !grammar.allowedPrimitives.includes(primitive))
          errors.push(
            error(
              `$.${collection}`,
              'profile-primitive',
              'Primitive is not allowed by this legacy grammar.',
            ),
          );
        if (!value[collection].length && grammar.requiredPrimitives.includes(primitive))
          errors.push(
            error(`$.${collection}`, 'required-primitive', 'Required legacy primitive is missing.'),
          );
      }
    }
  }
  const valid = errors.length === 0;
  const unsupportedNodeKinds = valid
    ? [
        ...new Set(
          value.nodes
            .filter((entry) => !semanticKinds.includes(entry.kind))
            .map((entry) => entry.kind),
        ),
      ]
    : [];
  const authoringAvailable =
    valid &&
    getDiagramAuthoringCapability(value.grammar.id) !== null &&
    !unsupportedNodeKinds.length &&
    !value.relations.some((entry) => entry.kind === 'containment') &&
    !['events', 'series', 'axes', 'sets'].some((key) => value[key].length) &&
    !(value.grammar.id === 'flowchart' || value.grammar.id === 'architecture'
      ? value.lanes.length
      : false);
  return {
    valid,
    errors,
    diagramId: valid ? value.diagramId : null,
    grammarId: valid ? value.grammar.id : null,
    authoringAvailable,
    requiresDerivedPresentation: valid,
    unsupportedNodeKinds,
    adoption: 'explicit-save-required',
    sourceModified: false,
  };
}
