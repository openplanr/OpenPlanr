import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  diagramAuthoringBundleDigest,
  diagramDocumentDigest,
  diagramPresentationDigest,
  inspectLegacyDiagramDocument,
} from '@openplanr/protocol/diagram-authoring-contracts';
import { assertDiagramSlug } from '../custody/paths.mjs';
import { readDiagramSet } from '../custody/workspace.mjs';
import { layoutDiagram } from '../rendering/layout.mjs';
import { isDashedRelation } from '../rendering/theme.mjs';
import { validateAuthoringBundle } from './model.mjs';

const meta = (kind) => ({ kind, schemaVersion: '1.0.0', protocolVersion: '1.13.0' });
const fail = (code, message, elementIds = []) => ({
  ok: false,
  sourceModified: false,
  diagnostics: [{ code, message, elementIds }],
});
const bounds = ({ x, y, width, height }) => ({ x, y, width, height });

function placement(item, shape, zIndex) {
  return {
    elementId: item.id,
    bounds: bounds(item),
    route: null,
    label: null,
    zIndex,
    appearance: {
      shape,
      fill: shape === 'container' ? 'transparent' : 'surface',
      stroke: item.emphasis ? 'accent' : 'default',
      strokeWidth: 2,
      strokeStyle: 'solid',
      fontSize: shape === 'container' ? 13 : 16,
      textAlign: 'center',
    },
    locks: { position: false, size: false, route: false },
  };
}

function attachment(box, point) {
  const sides = [
    { side: 'top', distance: Math.abs(point.y - box.y), offset: (point.x - box.x) / box.width },
    {
      side: 'right',
      distance: Math.abs(point.x - box.x - box.width),
      offset: (point.y - box.y) / box.height,
    },
    {
      side: 'bottom',
      distance: Math.abs(point.y - box.y - box.height),
      offset: (point.x - box.x) / box.width,
    },
    { side: 'left', distance: Math.abs(point.x - box.x), offset: (point.y - box.y) / box.height },
  ].sort((a, b) => a.distance - b.distance);
  return { side: sides[0].side, offset: Math.max(0, Math.min(1, sides[0].offset)) };
}

/** Capture the existing derived placement without changing the legacy document. */
export function previewLegacyDiagramDocument(document) {
  const inspection = inspectLegacyDiagramDocument(document);
  if (!inspection.valid)
    return {
      ...fail('invalid-legacy-document', 'The legacy document is invalid.'),
      diagnostics: inspection.errors,
    };
  if (!inspection.authoringAvailable)
    return fail(
      'unsupported-legacy-content',
      'This grammar or semantic kind has no certified authoring migration. Keep using its existing reader.',
      document.nodes
        .filter((node) => inspection.unsupportedNodeKinds.includes(node.kind))
        .map((node) => node.id),
    );
  const nodeIds = new Set(document.nodes.map((node) => node.id));
  if (document.relations.some((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to))) {
    return fail(
      'unsupported-legacy-endpoint',
      'Legacy non-node connector endpoints require explicit conversion.',
    );
  }
  let scene;
  try {
    scene = layoutDiagram(document);
  } catch (error) {
    return fail('legacy-layout-unavailable', error.message);
  }
  const semantic = {
    ...meta('planr-diagram'),
    diagramId: document.diagramId,
    title: document.title,
    summary: document.summary,
    audience: document.audience,
    grammar: structuredClone(document.grammar),
    nodes: document.nodes.map(({ id, label, kind, description }) => ({
      id,
      label,
      kind,
      description,
    })),
    // Legacy graph rendering draws a forward arrow for every relation.
    relations: document.relations.map(({ id, from, to, kind, label, weight }) => ({
      id,
      from,
      to,
      kind,
      label,
      weight,
      direction: 'forward',
    })),
    groups: structuredClone(document.groups),
    lanes: structuredClone(document.lanes),
    events: [],
    series: [],
    axes: [],
    sets: [],
    annotations: structuredClone(document.annotations),
    emphasis: structuredClone(document.emphasis),
    laneOrder: document.lanes.map((lane) => lane.id),
    accessibility: structuredClone(document.accessibility),
    documentDigest: '',
  };
  semantic.documentDigest = diagramDocumentDigest(semantic);
  const boxes = new Map(scene.boxes.map((box) => [box.id, box]));
  const elements = [
    ...scene.lanes.map((item) => placement(item, 'container', 0)),
    ...scene.groups.map((item) => placement(item, 'container', 1)),
    ...scene.edges.map((edge) => {
      const item = placement({ ...edge, x: 0, y: 0, width: 1, height: 1 }, 'connector', 2);
      const points = (
        edge.routePoints ?? [
          [edge.x1, edge.y1],
          [edge.x2, edge.y2],
        ]
      ).map(([x, y]) => ({ x, y }));
      const from = boxes.get(edge.from),
        to = boxes.get(edge.to);
      if (!from || !to)
        throw new TypeError('Legacy connector endpoints are not supported authoring nodes.');
      item.bounds = null;
      item.route = {
        mode: 'manual',
        strategy: points.every(
          (point, i) => i === 0 || point.x === points[i - 1].x || point.y === points[i - 1].y,
        )
          ? 'orthogonal'
          : 'straight',
        from: attachment(from, points[0]),
        to: attachment(to, points.at(-1)),
        points,
      };
      item.label = edge.labelBounds
        ? { x: edge.labelBounds.x, y: edge.labelBounds.y, width: edge.labelBounds.width }
        : null;
      item.appearance.strokeStyle = isDashedRelation(edge.kind) ? 'dashed' : 'solid';
      item.appearance.fontSize = 14;
      return item;
    }),
    ...scene.notes.map((item) => placement(item, 'text', 3)),
    ...scene.boxes.map((item) => placement(item, 'rounded-rectangle', 4)),
  ];
  const presentation = {
    ...meta('diagram-presentation'),
    diagramId: document.diagramId,
    semanticDigest: semantic.documentDigest,
    coordinateSystem: 'global-canvas',
    layout: structuredClone(document.layout),
    theme: { themeId: 'paper', mode: 'light' },
    elements,
    presentationDigest: '',
  };
  presentation.presentationDigest = diagramPresentationDigest(presentation);
  const bundle = {
    ...meta('diagram-authoring-bundle'),
    diagramId: document.diagramId,
    document: semantic,
    presentation,
    originalSource: null,
    sourceMap: null,
    bundleDigest: '',
  };
  bundle.bundleDigest = diagramAuthoringBundleDigest(bundle);
  const validation = validateAuthoringBundle(bundle);
  if (!validation.ok)
    return {
      ...fail(
        'unsupported-legacy-geometry',
        'The legacy scene cannot be adopted without an explicit geometry correction.',
      ),
      diagnostics: validation.diagnostics,
    };
  return {
    ok: true,
    bundle,
    sourceModified: false,
    adoption: 'explicit-save-required',
    diagnostics: [
      {
        code: 'legacy-presentation-captured',
        message:
          'Captured derived bounds, routes and labels. The supported paper palette replaces the legacy theme; source files remain unchanged.',
        elementIds: [],
      },
    ],
  };
}

/** Read-only custody check. Unlike inspectDiagram, this never performs recovery. */
export async function previewLegacyDiagramMigration({ root, slug }) {
  assertDiagramSlug(slug);
  if (typeof root !== 'string' || !root || root.includes('\0'))
    return fail('invalid-root', 'A configured diagram root is required.');
  const directory = resolve(root);
  try {
    for (const target of [
      directory,
      join(directory, 'diagrams'),
      join(directory, 'diagrams', slug),
    ]) {
      const info = await lstat(target);
      if (!info.isDirectory() || info.isSymbolicLink())
        return fail('unsafe-legacy-path', 'Legacy custody requires real directories.');
    }
    const members = await readdir(join(directory, 'diagrams', slug), { withFileTypes: true });
    for (const member of members) {
      if (!member.isFile() || member.isSymbolicLink())
        return fail(
          'unsafe-legacy-path',
          'Legacy custody contains an unowned or non-regular member.',
        );
    }
    const current = await readDiagramSet(directory, slug);
    if (!current || current.sourceChanges.length || current.generatedChanges.length)
      return fail(
        'changed-legacy-set',
        'Legacy files must match their manifest before migration can be previewed.',
      );
    if (!current.manifest.source.path.endsWith('.planr-diagram.json'))
      return fail(
        'unsupported-source-owner',
        'A scene-owned or external source stays on its existing rendering path. Explicit semantic adoption requires its own conversion.',
      );
    const sourceBytes = current.files.get(current.manifest.source.path);
    if (!sourceBytes)
      return fail('missing-legacy-source', 'The manifest does not include its canonical source.');
    const source = JSON.parse(sourceBytes.toString('utf8'));
    if (source.diagramId !== slug)
      return fail(
        'legacy-identity-mismatch',
        'Legacy source and manifest identify different diagrams.',
      );
    const preview = previewLegacyDiagramDocument(source);
    if (!preview.ok) return preview;
    // Ensure no mutation between custody inspection and the returned preview.
    const currentBytes = await readFile(join(directory, current.manifest.source.path));
    if (!sourceBytes.equals(currentBytes))
      return fail('changed-legacy-source', 'The legacy source changed during migration preview.');
    return {
      ...preview,
      source: { ...current.manifest.source, manifestDigest: current.manifest.documentDigest },
    };
  } catch (error) {
    return fail('legacy-custody-invalid', error.message);
  }
}
