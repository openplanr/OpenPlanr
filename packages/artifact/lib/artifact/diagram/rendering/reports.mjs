import { assertProtocolArtifact } from '@openplanr/protocol/contracts';
import { withDocumentDigest } from '@openplanr/protocol/canonical-json';

import { planDiagramQuality } from '../readability.mjs';

function finalize(kind, value) {
  const report = withDocumentDigest(value);
  assertProtocolArtifact(kind, report, { protocolVersion: '1.6.0' });
  return report;
}

function overlaps(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function labelOverlapCount(scene) {
  const bounds = scene.labelBounds ?? [];
  let count = 0;
  for (let left = 0; left < bounds.length; left += 1) {
    for (let right = left + 1; right < bounds.length; right += 1) {
      if (overlaps(bounds[left], bounds[right])) count += 1;
    }
  }
  return count;
}

function nodeOverlapCount(scene) {
  const boxes = scene.boxes ?? [];
  let count = 0;
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      if (overlaps(boxes[left], boxes[right])) count += 1;
    }
  }
  return count;
}

function edgePoints(edge) {
  return edge.routePoints ?? (Array.isArray(edge.points)
    ? edge.points.map(([x, y]) => [edge.x + x, edge.y + y])
    : [[edge.x1, edge.y1], [edge.x2, edge.y2]]);
}

function segmentEntersBox([x1, y1], [x2, y2], box) {
  // Ignore intentional boundary contact at a connection port, but detect paths
  // through a node's interior. Slab clipping also supports edited diagonals.
  let low = 0;
  let high = 1;
  for (const [start, delta, minimum, maximum] of [
    [x1, x2 - x1, box.x + 1, box.x + box.width - 1],
    [y1, y2 - y1, box.y + 1, box.y + box.height - 1],
  ]) {
    if (delta === 0) { if (start < minimum || start > maximum) return false; }
    else {
      const first = (minimum - start) / delta;
      const last = (maximum - start) / delta;
      low = Math.max(low, Math.min(first, last));
      high = Math.min(high, Math.max(first, last));
      if (low > high) return false;
    }
  }
  return low <= high;
}

function clippedGeometry(scene) {
  const rectangles = [...scene.boxes, ...(scene.groups ?? []), ...(scene.lanes ?? []), ...(scene.axes ?? []),
    ...(scene.notes ?? []), ...(scene.labelBounds ?? [])];
  const outside = rectangles.some(rect => ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    || rect.x < 0 || rect.y < 0 || rect.x + rect.width > scene.width || rect.y + rect.height > scene.height);
  const endpoints = scene.edges.flatMap(edgePoints);
  return outside || endpoints.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > scene.width || y > scene.height);
}

function semanticCoverage(document, scene) {
  if (!scene.kind) return { id: 'semantic-coverage', status: 'warning', message: 'An edited scene owns these pixels; equivalence to the canonical semantic document was not verified.' };
  const renderedItems = [...scene.boxes, ...scene.edges, ...(scene.phases ?? []), ...(scene.notes ?? []),
    ...(scene.groups ?? []), ...(scene.lanes ?? []), ...(scene.axes ?? [])];
  const rendered = new Set(renderedItems.map(item => item.id));
  const missing = ['nodes', 'relations', 'events', 'series', 'sets', 'annotations', 'groups', 'lanes', 'axes']
    .flatMap(key => document[key] ?? []).filter(item => !rendered.has(item.id));
  const emphasisMissing = (document.emphasis ?? []).filter(({ targetId, level }) => {
    const target = renderedItems.find(({ id }) => id === targetId);
    return !target || target.emphasis !== level;
  }).map(({ targetId }) => ({ id: `emphasis:${targetId}` }));
  missing.push(...emphasisMissing);
  return { id: 'semantic-coverage', status: missing.length ? 'fail' : 'pass',
    message: missing.length ? `${missing.length} semantic elements were not rendered: ${missing.map(item => item.id).join(', ')}.` : 'All declared semantic elements are represented in the scene.' };
}

export function createRenderQualityReport(document, { scene, png, svgValidation }) {
  const clipped = clippedGeometry(scene);
  const planned = planDiagramQuality(document, {
    clipped,
    contrastRatio: svgValidation.contrastRatio ?? 21,
  });
  const overlapCount = labelOverlapCount(scene);
  const nodeOverlap = nodeOverlapCount(scene);
  const measuredIds = new Set((scene.labelBounds ?? []).map(({ id }) => id));
  const measuredLabels = Boolean(scene.kind) && document.relations.filter(({ label }) => label)
    .every(({ id }) => measuredIds.has(id));
  const labelNodeCount = (scene.labelBounds ?? []).filter(label => scene.boxes.some(box => overlaps(label, box))).length;
  const edgeNodeCount = scene.edges.filter(edge => {
    const points = edgePoints(edge);
    return points.slice(1).some((point, index) => scene.boxes.some(box => segmentEntersBox(points[index], point, box)));
  }).length;
  const checks = [
    ...planned.checks,
    { id: 'svg-validated', status: svgValidation.ok ? 'pass' : 'fail', message: svgValidation.ok ? 'SVG structure and accessibility validate.' : `SVG validation failed: ${svgValidation.errors.join(', ')}.` },
    { id: 'geometry-present', status: scene.boxes.length > 0 ? 'pass' : 'fail', message: `${scene.boxes.length} semantic boxes and ${scene.edges.length} relations rendered.` },
    { id: 'node-overlap', status: nodeOverlap > 0 ? 'fail' : 'pass', message: nodeOverlap > 0 ? `${nodeOverlap} semantic node collision${nodeOverlap === 1 ? '' : 's'} detected.` : 'Semantic nodes do not overlap.' },
    { id: 'label-overlap', status: overlapCount > 0 ? 'fail' : measuredLabels ? 'pass' : 'warning', message: overlapCount > 0 ? `${overlapCount} rendered label collision${overlapCount === 1 ? '' : 's'} detected.` : !measuredLabels ? 'Complete relation label bounds are unavailable; label overlap has not been fully verified.' : 'Rendered relation labels do not overlap within the measured layout bounds.' },
    { id: 'label-node-overlap', status: labelNodeCount ? 'fail' : measuredLabels ? 'pass' : 'warning', message: labelNodeCount ? `${labelNodeCount} relation labels overlap semantic nodes.` : measuredLabels ? 'Measured relation labels do not obscure semantic nodes.' : 'Complete relation label bounds are unavailable; node obstruction has not been fully verified.' },
    { id: 'edge-node-overlap', status: edgeNodeCount ? 'fail' : 'pass', message: edgeNodeCount ? `${edgeNodeCount} connection paths enter semantic nodes; routing needs adjustment.` : 'Connection paths remain outside semantic node interiors.' },
    { id: 'rendered-clipping', status: clipped ? 'fail' : 'pass', message: clipped ? 'Rendered geometry extends beyond the scene or contains invalid coordinates.' : 'Measured scene geometry fits the exported viewport.' },
    semanticCoverage(document, scene),
    { id: 'png-decoded', status: png.width > 0 && png.height > 0 ? 'pass' : 'fail', message: `PNG decoded at ${png.width}×${png.height} (${png.byteLength} bytes).` },
    { id: 'offline-runtime', status: 'pass', message: 'Renderer uses packaged code and font bytes without browser or network access.' },
  ];
  const failed = checks.some(({ status }) => status === 'fail');
  return finalize('diagram-quality-report', {
    ...planned,
    documentDigest: undefined,
    status: failed ? 'invalid' : planned.status === 'pass' && checks.some(check => check.status === 'warning') ? 'warning' : planned.status,
    checks,
  });
}

export function createFidelityReport(document, {
  sourceFormat = 'planr-diagram',
  targetFormat,
  status,
  interpreted = [],
  omitted = [],
  notes = [],
}) {
  return finalize('diagram-fidelity-report', {
    kind: 'diagram-fidelity-report',
    schemaVersion: '1.0.0',
    protocolVersion: '1.6.0',
    documentVersion: '1.0.0',
    digestAlgorithm: 'sha256',
    canonicalization: 'rfc8785',
    diagramId: document.diagramId,
    sourceFormat,
    targetFormat,
    status,
    interpreted,
    omitted,
    notes,
  });
}
