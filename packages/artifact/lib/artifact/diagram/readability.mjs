import { withDocumentDigest } from '@openplanr/protocol/canonical-json';

import { DIAGRAM_ERROR_CODES, diagramFail } from './errors.mjs';
import { assertDiagramDocument } from './model.mjs';
import { getGrammar } from './registry.mjs';

const primaryItems = (document) => [
  ...document.nodes,
  ...document.events,
  ...document.series,
  ...document.sets,
];

function splitStrategy(document) {
  if (document.groups.length > 1) return ['by-group', document.groups];
  if (document.lanes.length > 1) return ['by-lane', document.lanes];
  if (document.events.length > 1) return ['by-sequence', document.events];
  return ['by-subgraph', primaryItems(document)];
}

// Protocol bounds a split plan to 2..32 panels of at most 256 items each.
const MAX_SPLIT_PANELS = 32;
const MAX_SPLIT_PANEL_ITEMS = 256;

function chunkPanels(document, allIds, limit) {
  if (allIds.length > MAX_SPLIT_PANELS * MAX_SPLIT_PANEL_ITEMS) {
    diagramFail(
      DIAGRAM_ERROR_CODES.RESOURCE_BUDGET_EXCEEDED,
      'Diagram exceeds the largest expressible split plan.',
      {
        primaryItems: allIds.length,
        maximum: MAX_SPLIT_PANELS * MAX_SPLIT_PANEL_ITEMS,
        repair: 'Split the source into multiple named diagrams before rendering.',
      },
    );
  }
  // Panels grow past the detail budget only when the panel cap forces it.
  const size = Math.min(
    MAX_SPLIT_PANEL_ITEMS,
    Math.max(limit, Math.ceil(allIds.length / MAX_SPLIT_PANELS)),
  );
  const panels = [];
  for (let index = 0; index < allIds.length; index += size) {
    const number = Math.floor(index / size) + 1;
    panels.push({
      id: `panel-${number}`,
      title: `${document.title} — panel ${number}`,
      itemIds: allIds.slice(index, index + size),
    });
  }
  return panels;
}

function buildSplitPlan(document, limit) {
  const [preferredStrategy, preferred] = splitStrategy(document);
  const allIds = primaryItems(document).map(({ id }) => id);
  const containersFit =
    ['by-group', 'by-lane'].includes(preferredStrategy) &&
    preferred.length <= MAX_SPLIT_PANELS &&
    preferred.every(({ members }) => members.length > 0 && members.length <= MAX_SPLIT_PANEL_ITEMS);
  const strategy =
    containersFit || preferredStrategy === 'by-sequence' ? preferredStrategy : 'by-subgraph';
  let groups = containersFit
    ? preferred.map(({ id, label, members }) => ({ id, title: label, itemIds: members }))
    : chunkPanels(document, allIds, limit);
  if (groups.length < 2) {
    const midpoint = Math.max(1, Math.ceil(allIds.length / 2));
    groups = [
      { id: 'panel-1', title: `${document.title} — panel 1`, itemIds: allIds.slice(0, midpoint) },
      { id: 'panel-2', title: `${document.title} — panel 2`, itemIds: allIds.slice(midpoint) },
    ].filter(({ itemIds }) => itemIds.length > 0);
  }
  return { strategy, panels: groups };
}

function fanIn(document) {
  const incoming = new Map();
  for (const relation of document.relations)
    incoming.set(relation.to, (incoming.get(relation.to) ?? 0) + 1);
  return Math.max(0, ...incoming.values());
}

export function planDiagramQuality(
  document,
  { crossings = 0, clipped = false, contrastRatio = 21 } = {},
) {
  assertDiagramDocument(document);
  const grammar = getGrammar(document.grammar.id);
  const items = primaryItems(document);
  const budget = grammar.detailLimits[document.layout.detailTier];
  const longestLabel = Math.max(0, ...items.map(({ label = '' }) => label.length));
  const checks = [
    [
      'item-budget',
      items.length <= budget,
      `${items.length} primary items; ${budget} allowed for ${document.layout.detailTier}.`,
    ],
    [
      'label-length',
      longestLabel <= grammar.readability.maxLabelCharacters,
      `Longest label is ${longestLabel} characters.`,
    ],
    [
      'crossings',
      crossings <= grammar.readability.maxCrossings,
      `${crossings} estimated crossings; ${grammar.readability.maxCrossings} allowed.`,
    ],
    [
      'fan-in',
      fanIn(document) <= grammar.readability.maxFanIn,
      `Maximum fan-in is ${fanIn(document)}; ${grammar.readability.maxFanIn} allowed.`,
    ],
    ['contrast', contrastRatio >= 4.5, `Contrast ratio is ${contrastRatio.toFixed(2)}:1.`],
    [
      'clipping',
      !clipped,
      clipped ? 'Destination would clip semantic content.' : 'No clipping reported.',
    ],
  ].map(([id, passed, message]) => ({ id, status: passed ? 'pass' : 'warning', message }));
  const splitRequired = items.length > budget || items.length > grammar.detailLimits.hard;
  const warning = checks.some(({ status }) => status === 'warning');
  return withDocumentDigest({
    kind: 'diagram-quality-report',
    schemaVersion: '1.0.0',
    protocolVersion: '1.6.0',
    documentVersion: '1.0.0',
    digestAlgorithm: 'sha256',
    canonicalization: 'rfc8785',
    diagramId: document.diagramId,
    status: splitRequired ? 'split-required' : warning ? 'warning' : 'pass',
    checks,
    splitPlan: splitRequired ? buildSplitPlan(document, Math.max(1, budget)) : null,
  });
}
