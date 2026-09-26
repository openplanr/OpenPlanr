import { assertProtocolArtifact } from '@openplanr/protocol/contracts';
import { withDocumentDigest } from '@openplanr/protocol/canonical-json';

import { DIAGRAM_ERROR_CODES, DiagramError, diagramFail } from './errors.mjs';
import { getGrammar } from './registry.mjs';

const COLLECTIONS = Object.freeze({
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
});

const SEMANTIC_POSITION_GRAMMARS = new Set(['quadrant', 'scatter', 'wardley']);
export const MAX_DIAGRAM_PRIMITIVE_ITEMS = 10_000;
const RENDERER_COORDINATE_KEYS = new Set([
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'width',
  'height',
  'coordinates',
  'position',
  'points',
  'viewBox',
]);

function collectCoordinatePath(value, path = '$', insideSemanticPosition = false) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = collectCoordinatePath(
        value[index],
        `${path}[${index}]`,
        insideSemanticPosition,
      );
      if (found) return found;
    }
    return null;
  }
  for (const [key, nested] of Object.entries(value)) {
    const semantic = insideSemanticPosition || key === 'semanticPosition';
    if (!semantic && RENDERER_COORDINATE_KEYS.has(key)) return `${path}.${key}`;
    const found = collectCoordinatePath(nested, `${path}.${key}`, semantic);
    if (found) return found;
  }
  return null;
}

function schemaCheck(document) {
  try {
    assertProtocolArtifact('diagram-document', document, { protocolVersion: '1.6.0' });
  } catch (error) {
    diagramFail(
      DIAGRAM_ERROR_CODES.SCHEMA_INVALID,
      'Diagram document does not satisfy Protocol 1.6.',
      {
        cause: error.message,
        diagnostics: error.details?.errors ?? [],
      },
    );
  }
}

function usedPrimitives(document) {
  return Object.entries(COLLECTIONS)
    .filter(([, collection]) => document[collection].length > 0)
    .map(([primitive]) => primitive);
}

function assertUniqueIds(document) {
  const seen = new Map();
  for (const collection of Object.values(COLLECTIONS).filter((name) => name !== 'emphasis')) {
    for (const [index, value] of document[collection].entries()) {
      if (!value.id) continue;
      const previous = seen.get(value.id);
      if (previous) {
        diagramFail(
          DIAGRAM_ERROR_CODES.GRAMMAR_RULE_INVALID,
          `Duplicate semantic item id: ${value.id}`,
          {
            itemId: value.id,
            first: previous,
            second: `${collection}[${index}]`,
          },
        );
      }
      seen.set(value.id, `${collection}[${index}]`);
    }
  }
  const ids = new Set(seen.keys());
  const missing = [];
  for (const [index, relation] of document.relations.entries()) {
    if (!ids.has(relation.from)) missing.push(`relations[${index}].from=${relation.from}`);
    if (!ids.has(relation.to)) missing.push(`relations[${index}].to=${relation.to}`);
  }
  for (const collection of ['groups', 'lanes', 'sets']) {
    for (const [index, value] of document[collection].entries()) {
      for (const member of value.members)
        if (!ids.has(member)) missing.push(`${collection}[${index}].members=${member}`);
    }
  }
  for (const [index, value] of document.emphasis.entries()) {
    if (!ids.has(value.targetId)) missing.push(`emphasis[${index}].targetId=${value.targetId}`);
  }
  for (const itemId of document.accessibility.readingOrder) {
    if (!ids.has(itemId)) missing.push(`accessibility.readingOrder=${itemId}`);
  }
  if (missing.length > 0) {
    diagramFail(
      DIAGRAM_ERROR_CODES.GRAMMAR_RULE_INVALID,
      'Diagram references unknown semantic item IDs.',
      { missing },
    );
  }
}

export function assertDiagramDocument(document) {
  const primitiveItems = Object.values(COLLECTIONS).reduce(
    (total, collection) =>
      total + (Array.isArray(document?.[collection]) ? document[collection].length : 0),
    0,
  );
  if (primitiveItems > MAX_DIAGRAM_PRIMITIVE_ITEMS) {
    diagramFail(
      DIAGRAM_ERROR_CODES.RESOURCE_BUDGET_EXCEEDED,
      'Diagram exceeds the semantic primitive resource budget.',
      {
        primitiveItems,
        maximum: MAX_DIAGRAM_PRIMITIVE_ITEMS,
        repair: 'Split the source into multiple named diagrams before rendering.',
      },
    );
  }
  schemaCheck(document);
  const coordinatePath = collectCoordinatePath(document);
  if (coordinatePath) {
    diagramFail(
      DIAGRAM_ERROR_CODES.GRAMMAR_RULE_INVALID,
      'Renderer coordinates are forbidden in canonical diagram documents.',
      {
        path: coordinatePath,
        repair: 'Remove renderer geometry or express meaning through semanticPosition.',
      },
    );
  }
  const grammar = getGrammar(document.grammar.id);
  const used = usedPrimitives(document);
  const missing = grammar.requiredPrimitives.filter((primitive) => !used.includes(primitive));
  const forbidden = used.filter((primitive) => !grammar.allowedPrimitives.includes(primitive));
  if (missing.length > 0 || forbidden.length > 0) {
    diagramFail(
      DIAGRAM_ERROR_CODES.GRAMMAR_RULE_INVALID,
      `Diagram violates the ${grammar.grammarId} primitive contract.`,
      {
        grammarId: grammar.grammarId,
        missing,
        forbidden,
      },
    );
  }
  if (!grammar.directions.includes(document.layout.direction)) {
    diagramFail(
      DIAGRAM_ERROR_CODES.GRAMMAR_RULE_INVALID,
      `Direction ${document.layout.direction} is not valid for ${grammar.grammarId}.`,
      {
        allowed: grammar.directions,
      },
    );
  }
  const semanticPositions = document.nodes.filter((node) => node.semanticPosition != null);
  if (semanticPositions.length > 0 && !SEMANTIC_POSITION_GRAMMARS.has(grammar.grammarId)) {
    diagramFail(
      DIAGRAM_ERROR_CODES.GRAMMAR_RULE_INVALID,
      `semanticPosition is not meaningful for ${grammar.grammarId}.`,
      {
        itemIds: semanticPositions.map(({ id }) => id),
        allowedGrammars: [...SEMANTIC_POSITION_GRAMMARS],
      },
    );
  }
  assertUniqueIds(document);
  return document;
}

export function createDiagramDocument(input) {
  const value = withDocumentDigest({
    kind: 'planr-diagram',
    schemaVersion: '1.0.0',
    protocolVersion: '1.6.0',
    documentVersion: '1.0.0',
    digestAlgorithm: 'sha256',
    canonicalization: 'rfc8785',
    ...input,
    nodes: input.nodes ?? [],
    relations: input.relations ?? [],
    groups: input.groups ?? [],
    lanes: input.lanes ?? [],
    events: input.events ?? [],
    series: input.series ?? [],
    axes: input.axes ?? [],
    sets: input.sets ?? [],
    annotations: input.annotations ?? [],
    emphasis: input.emphasis ?? [],
  });
  return assertDiagramDocument(value);
}

export { DiagramError };
