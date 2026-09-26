import { compileDiagramCommand } from '../diagram/authoring/index.mjs';
import {
  appearanceFields,
  clone,
  descendants,
  elementIndex,
  geometryFields,
  parentIndex,
  same,
  semanticFields,
  snapshot,
} from '../diagram/authoring/model.mjs';
import { copyDiagramSelection, pasteDiagramSelection } from '../diagram/editor/clipboard.mjs';

export const freshId = (prefix = 'edit') => `${prefix}-${globalThis.crypto.randomUUID()}`;
export const labelOf = (value) => value.label ?? value.text ?? value.id;
export const transaction = (bundle, operations) => ({
  kind: 'diagram-edit-transaction',
  schemaVersion: '1.0.0',
  protocolVersion: '1.13.0',
  transactionId: freshId(),
  diagramId: bundle.diagramId,
  base: snapshot(bundle),
  operations,
  undoOf: null,
});
export function placement(id, shape, bounds) {
  return {
    elementId: id,
    bounds,
    route: null,
    label: null,
    zIndex: shape === 'container' ? 0 : 1,
    appearance: {
      shape,
      fill: shape === 'text' || shape === 'container' ? 'transparent' : 'surface',
      stroke: shape === 'text' ? 'none' : 'default',
      strokeWidth: 1.5,
      strokeStyle: 'solid',
      fontSize: 14,
      textAlign: shape === 'container' || shape === 'text' ? 'left' : 'center',
    },
    locks: { position: false, size: false, route: false },
  };
}
export function createObject(kind, position) {
  const id = freshId(kind === 'horizontal-lane' || kind === 'vertical-lane' ? 'lane' : kind);
  const { x, y } = position;
  const bounds = { x, y, width: 160, height: 72 };
  let collection = 'nodes',
    value,
    shape = 'rectangle';
  if (kind === 'annotation') {
    collection = 'annotations';
    value = { id, text: 'Add a note', targetId: null };
    shape = 'text';
  } else if (kind === 'container' || kind.endsWith('-lane')) {
    collection = kind === 'container' ? 'groups' : 'lanes';
    value = { id, label: kind === 'container' ? 'Container' : 'Lane', members: [] };
    shape = 'container';
    Object.assign(
      bounds,
      kind === 'vertical-lane' ? { width: 240, height: 480 } : { width: 540, height: 240 },
    );
  } else {
    const names = {
      process: 'Process',
      start: 'Start',
      end: 'End',
      decision: 'Decision',
      'data-store': 'Data store',
      component: 'Component',
    };
    value = { id, label: names[kind], kind, description: null };
    shape =
      {
        start: 'ellipse',
        end: 'ellipse',
        decision: 'diamond',
        'data-store': 'cylinder',
        component: 'rounded-rectangle',
      }[kind] ?? 'rectangle';
    if (kind === 'decision') bounds.height = 100;
  }
  return {
    type: 'create',
    elements: [{ collection, value }],
    presentation: [placement(id, shape, bounds)],
  };
}
export function connector(from, to, label = '') {
  const id = freshId('connector');
  const entry = placement(id, 'connector', null);
  entry.route = {
    mode: 'automatic',
    strategy: 'orthogonal',
    from: { side: 'right', offset: 0.5 },
    to: { side: 'left', offset: 0.5 },
    points: [],
  };
  return {
    type: 'create',
    elements: [
      {
        collection: 'relations',
        value: {
          id,
          from,
          to,
          label: label || null,
          kind: 'flow',
          direction: 'forward',
          weight: null,
        },
      },
    ],
    presentation: [entry],
  };
}
/** @returns {Extract<import('../diagram/authoring/index.d.mts').DiagramCommand, { type: 'create' }>} */
export function processTemplate(position) {
  const start = createObject('start', position),
    process = createObject('process', { x: position.x + 240, y: position.y }),
    end = createObject('end', { x: position.x + 480, y: position.y });
  const first = connector(start.elements[0].value.id, process.elements[0].value.id),
    second = connector(process.elements[0].value.id, end.elements[0].value.id);
  const parts = [start, process, end, first, second];
  return {
    type: 'create',
    elements: parts.flatMap((part) => part.elements),
    presentation: parts.flatMap((part) => part.presentation),
  };
}
/**
 * @returns {import('../diagram/editor/index.d.mts').DiagramEditorFailure
 *   | (import('../diagram/authoring/index.d.mts').DiagramCommandResult & { selectedIds: string[] })}
 */
export function duplicateSelection(bundle, ids, copied = null) {
  const result = copied ? { ok: true, value: copied } : copyDiagramSelection(bundle, ids);
  if (!result.ok) return result;
  const idMap = Object.fromEntries(result.value.ids.map((id) => [id, freshId('copy')]));
  const preview = pasteDiagramSelection(bundle, result.value, {
    idMap,
    transactionId: freshId(),
    dx: 24,
    dy: 24,
  });
  return { ...preview, selectedIds: ids.filter((id) => idMap[id]).map((id) => idMap[id]) };
}
export function propertyTransaction(bundle, id, { semantic, geometry, appearance }) {
  const entry = elementIndex(bundle.document).get(id);
  const current = bundle.presentation.elements.find((item) => item.elementId === id);
  const operations = [];
  if (semantic)
    operations.push({
      type: 'update-semantics',
      collection: entry.collection,
      elementId: id,
      before: semanticFields(entry.collection, entry.value),
      after: semantic,
    });
  if (geometry) {
    const before = geometryFields(current);
    let changes = [{ elementId: id, before, after: geometry }];
    if (
      before.bounds &&
      geometry.bounds &&
      (before.bounds.x !== geometry.bounds.x || before.bounds.y !== geometry.bounds.y)
    ) {
      const moved = compileDiagramCommand(
        bundle,
        {
          type: 'move',
          ids: [id],
          dx: geometry.bounds.x - before.bounds.x,
          dy: geometry.bounds.y - before.bounds.y,
        },
        { transactionId: freshId() },
      );
      if (moved.ok && moved.transaction) {
        changes = moved.transaction.operations.flatMap((operation) => operation.changes ?? []);
        const target = changes.find((change) => change.elementId === id);
        if (target)
          target.after = {
            ...target.after,
            bounds: geometry.bounds,
            route: same(geometry.route, before.route) ? target.after.route : geometry.route,
            label: same(geometry.label, before.label) ? target.after.label : geometry.label,
            zIndex: geometry.zIndex,
          };
      }
    }
    operations.push({ type: 'set-geometry', changes });
  }
  if (appearance)
    operations.push({
      type: 'set-appearance-locks',
      changes: [{ elementId: id, before: appearanceFields(current), after: appearance }],
    });
  return transaction(bundle, operations);
}
/**
 * Compose existing move previews into one transaction, preserving container descendants.
 * @returns {import('../diagram/authoring/index.d.mts').DiagramCommand}
 */
export function arrangementCommand(bundle, ids, mode) {
  const parents = parentIndex(bundle.document),
    selected = new Set(ids);
  const roots = ids.filter((id) => {
    let parent = parents.get(id);
    while (parent) {
      if (selected.has(parent)) return false;
      parent = parents.get(parent);
    }
    return true;
  });
  const placements = new Map(bundle.presentation.elements.map((item) => [item.elementId, item]));
  const boxes = roots.map((id) => placements.get(id)).filter((item) => item?.bounds);
  if (boxes.length < 2) throw new Error('Select at least two shapes or containers.');
  const horizontal = mode.endsWith('horizontal');
  if (mode.startsWith('distribute') && boxes.length < 3)
    throw new Error('Select at least three shapes to distribute.');
  const ordered = [...boxes].sort(
    (a, b) => a.bounds[horizontal ? 'x' : 'y'] - b.bounds[horizontal ? 'x' : 'y'],
  );
  const first = ordered[0].bounds,
    last = ordered.at(-1).bounds;
  const totalSize = ordered.reduce(
    (sum, item) => sum + item.bounds[horizontal ? 'width' : 'height'],
    0,
  );
  const gap =
    ((horizontal ? last.x + last.width - first.x : last.y + last.height - first.y) - totalSize) /
    (boxes.length - 1);
  let offset = horizontal ? first.x : first.y;
  const changes = new Map();
  for (const item of mode.startsWith('distribute') ? ordered : boxes) {
    const bounds = item.bounds;
    let dx = 0,
      dy = 0;
    if (mode === 'align-left') dx = Math.min(...boxes.map((p) => p.bounds.x)) - bounds.x;
    if (mode === 'align-top') dy = Math.min(...boxes.map((p) => p.bounds.y)) - bounds.y;
    if (mode === 'align-center')
      dx = boxes[0].bounds.x + boxes[0].bounds.width / 2 - bounds.x - bounds.width / 2;
    if (mode.startsWith('distribute')) {
      if (horizontal) dx = offset - bounds.x;
      else dy = offset - bounds.y;
      offset += bounds[horizontal ? 'width' : 'height'] + gap;
    }
    const preview = compileDiagramCommand(
      bundle,
      { type: 'move', ids: [item.elementId], dx, dy },
      { transactionId: freshId() },
    );
    if (!preview.ok) throw new Error(preview.diagnostics[0].detail);
    for (const op of preview.transaction?.operations ?? [])
      for (const change of op.changes ?? []) changes.set(change.elementId, change);
  }
  return { type: 'geometry', changes: [...changes.values()] };
}
/** @returns {import('../diagram/authoring/index.d.mts').DiagramCommand} */
export function laneArrangementCommand(bundle, laneId, direction) {
  const lane = [...bundle.document.lanes, ...bundle.document.groups].find(
    (item) => item.id === laneId,
  );
  if (!lane) throw new Error('Select a lane or container.');
  const byId = new Map(bundle.presentation.elements.map((item) => [item.elementId, item]));
  const container = byId.get(laneId),
    before = geometryFields(container),
    horizontal = direction === 'horizontal';
  let x = container.bounds.x + 24,
    y = container.bounds.y + 48,
    cross = 0;
  const changes = new Map();
  for (const member of lane.members) {
    const bounds = byId.get(member).bounds;
    if (!bounds) continue;
    const preview = compileDiagramCommand(
      bundle,
      { type: 'move', ids: [member], dx: x - bounds.x, dy: y - bounds.y },
      { transactionId: freshId() },
    );
    // A move may temporarily extend beyond the current lane; final validation below
    // must see the resized parent and moved children together, so derive deltas only.
    if (preview.ok)
      for (const op of preview.transaction?.operations ?? [])
        for (const change of op.changes ?? []) changes.set(change.elementId, change);
    else {
      const moved = new Set(descendants(bundle.document, [member]));
      for (const edge of bundle.document.relations)
        if (moved.has(edge.from) && moved.has(edge.to)) moved.add(edge.id);
      for (const id of moved) {
        const old = geometryFields(byId.get(id)),
          next = clone(old),
          dx = x - bounds.x,
          dy = y - bounds.y;
        if (next.bounds) {
          next.bounds.x += dx;
          next.bounds.y += dy;
        }
        if (next.label) {
          next.label.x += dx;
          next.label.y += dy;
        }
        if (next.route?.mode === 'manual')
          next.route.points = next.route.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        changes.set(id, { elementId: id, before: old, after: next });
      }
    }
    if (horizontal) x += bounds.width + 40;
    else y += bounds.height + 40;
    cross = Math.max(cross, bounds[horizontal ? 'height' : 'width']);
  }
  const after = clone(before);
  after.bounds.width = Math.max(240, horizontal ? x - before.bounds.x - 16 : cross + 48);
  after.bounds.height = Math.max(160, horizontal ? cross + 72 : y - before.bounds.y - 16);
  changes.set(laneId, { elementId: laneId, before, after });
  return { type: 'geometry', changes: [...changes.values()] };
}

/** Insert a visible Manhattan detour into the longest existing segment. */
export function addOrthogonalDetour(points) {
  if (points.length < 2) throw new Error('The connector needs two attached endpoints.');
  const lengths = points
    .slice(1)
    .map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  const index = lengths.indexOf(Math.max(...lengths));
  const start = points[index],
    end = points[index + 1];
  if (lengths[index] < 24) throw new Error('The connector segment is too short for a bend.');
  const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
  const detour = horizontal
    ? [
        { x: Math.round((start.x + end.x) / 2), y: start.y },
        { x: Math.round((start.x + end.x) / 2), y: start.y + 40 },
        { x: end.x, y: start.y + 40 },
      ]
    : [
        { x: start.x, y: Math.round((start.y + end.y) / 2) },
        { x: start.x + 40, y: Math.round((start.y + end.y) / 2) },
        { x: start.x + 40, y: end.y },
      ];
  return [...points.slice(0, index + 1), ...detour, ...points.slice(index + 1)];
}

/** Move one corner while retaining its orthogonal neighbors and fixed endpoints. */
export function moveOrthogonalBend(points, index, dx, dy) {
  if (index <= 0 || index >= points.length - 1) throw new Error('Only an interior bend can move.');
  const next = points.map((point) => ({ ...point }));
  const before = points[index - 1],
    corner = points[index],
    after = points[index + 1];
  const x = Math.round(corner.x + dx),
    y = Math.round(corner.y + dy);
  if (before.x === corner.x) {
    next[index].x = index === 1 ? before.x : x;
    if (index > 1) next[index - 1].x = x;
  } else {
    next[index].y = index === 1 ? before.y : y;
    if (index > 1) next[index - 1].y = y;
  }
  if (after.x === corner.x) {
    next[index].x = index === points.length - 2 ? after.x : x;
    if (index < points.length - 2) next[index + 1].x = x;
  } else {
    next[index].y = index === points.length - 2 ? after.y : y;
    if (index < points.length - 2) next[index + 1].y = y;
  }
  return next;
}
