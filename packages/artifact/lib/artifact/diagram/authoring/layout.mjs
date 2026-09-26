import {
  clone,
  same,
  failure,
  inspectPlainData,
  validateAuthoringBundle,
  elementIndex,
  parentIndex,
  descendants,
  geometryFields,
  snapshot,
} from './model.mjs';
import { previewDiagramTransaction } from './transactions.mjs';

const inside = (bounds, frame) =>
  !frame ||
  (bounds.x >= frame.x &&
    bounds.y >= frame.y &&
    bounds.x + bounds.width <= frame.x + frame.width &&
    bounds.y + bounds.height <= frame.y + frame.height);
const overlaps = (a, b, gap = 0) =>
  a.x < b.x + b.width + gap &&
  a.x + a.width + gap > b.x &&
  a.y < b.y + b.height + gap &&
  a.y + a.height + gap > b.y;
function check(bundle, options, keys) {
  const checked = validateAuthoringBundle(bundle);
  if (!checked.ok) return checked;
  const diagnostics = inspectPlainData(options);
  if (diagnostics.length) return { ok: false, diagnostics };
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => !keys.includes(key)) ||
    typeof options.transactionId !== 'string' ||
    !Array.isArray(options.targetIds) ||
    !options.targetIds.length ||
    new Set(options.targetIds).size !== options.targetIds.length
  )
    return failure(
      '$.options',
      'layout-options',
      'Supply distinct targetIds and one transactionId.',
    );
  const byId = elementIndex(bundle.document);
  if (options.targetIds.some((id) => typeof id !== 'string' || !byId.has(id)))
    return failure(
      '$.options.targetIds',
      'reference',
      'Every layout target must exist in this diagram.',
    );
  return { ok: true };
}
function preview(bundle, changes, transactionId) {
  if (!changes.length)
    return failure(
      '$.options.targetIds',
      'no-change',
      'The selected objects already have the requested geometry.',
    );
  return previewDiagramTransaction(bundle, {
    kind: 'diagram-edit-transaction',
    schemaVersion: '1.0.0',
    protocolVersion: '1.13.0',
    diagramId: bundle.diagramId,
    transactionId,
    base: snapshot(bundle),
    undoOf: null,
    operations: [{ type: 'set-geometry', changes }],
  });
}
function translate(geometry, dx, dy) {
  const after = clone(geometry);
  if (after.bounds) {
    after.bounds.x += dx;
    after.bounds.y += dy;
  }
  if (after.route?.mode === 'manual')
    after.route.points = after.route.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
  if (after.label) {
    after.label.x += dx;
    after.label.y += dy;
  }
  return after;
}

/** Explicit scoped packing; it never resizes objects or invokes global layout. */
export function previewAutomaticLayout(bundle, options) {
  const checked = check(bundle, options, ['targetIds', 'transactionId', 'gap', 'columns']);
  if (!checked.ok) return checked;
  const gap = options.gap === undefined ? 32 : options.gap;
  if (options.targetIds.length > 256)
    return failure(
      '$.options.targetIds',
      'focused-region-required',
      'Select at most 256 direct targets for one layout preview, or select their containing regions.',
    );
  if (
    !Number.isFinite(gap) ||
    gap < 8 ||
    gap > 512 ||
    (options.columns !== undefined &&
      (!Number.isInteger(options.columns) || options.columns < 1 || options.columns > 32))
  )
    return failure(
      '$.options',
      'layout-options',
      'Gap must be 8–512 canvas units; columns must be an integer from 1 to 32.',
    );
  const byId = elementIndex(bundle.document),
    parents = parentIndex(bundle.document);
  const placements = new Map(bundle.presentation.elements.map((value) => [value.elementId, value]));
  if (options.targetIds.some((id) => byId.get(id).collection === 'relations'))
    return failure(
      '$.options.targetIds',
      'layout-target',
      'Select shapes or containers for layout; resetting a connector route is a separate explicit operation.',
    );
  const selected = new Set(options.targetIds);
  const roots = options.targetIds.filter((id) => {
    let parent = parents.get(id);
    while (parent) {
      if (selected.has(parent)) return false;
      parent = parents.get(parent);
    }
    return true;
  });
  const lockedIds = [];
  const movable = [];
  const closureById = new Map();
  for (const id of roots) {
    const closure = descendants(bundle.document, [id]);
    closureById.set(id, closure);
    const locked = closure.filter((member) => placements.get(member).locks.position);
    if (locked.length) lockedIds.push(...locked);
    else movable.push(id);
  }
  if (!movable.length)
    return {
      ...failure(
        '$.options.targetIds',
        'geometry-lock',
        'All selected regions contain a position-locked object.',
      ),
      layout: {
        targetIds: [...options.targetIds],
        movedIds: [],
        lockedIds: [...new Set(lockedIds)].sort(),
      },
    };
  const groups = new Map();
  for (const id of movable) {
    const parent = parents.get(id) ?? null;
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push(id);
  }
  const deltas = new Map();
  const occupied = [];
  let collisionChecks = 0;
  for (const [parentId, ids] of groups) {
    const frame = parentId ? placements.get(parentId).bounds : null;
    const selectedClosure = new Set(ids.flatMap((id) => closureById.get(id)));
    const ancestors = new Set();
    for (const id of ids) {
      let parent = parents.get(id);
      while (parent) {
        ancestors.add(parent);
        parent = parents.get(parent);
      }
    }
    const obstacles = bundle.presentation.elements
      .filter(
        (value) =>
          value.bounds && !selectedClosure.has(value.elementId) && !ancestors.has(value.elementId),
      )
      .map((value) => value.bounds);
    const width = Math.max(...ids.map((id) => placements.get(id).bounds.width));
    const height = Math.max(...ids.map((id) => placements.get(id).bounds.height));
    const availableColumns = frame
      ? Math.max(1, Math.floor((frame.width + gap) / (width + gap)))
      : 32;
    const columns = Math.min(
      options.columns ?? Math.max(1, Math.ceil(Math.sqrt(ids.length))),
      availableColumns,
    );
    const origin = {
      x: Math.min(...ids.map((id) => placements.get(id).bounds.x)),
      y: Math.min(...ids.map((id) => placements.get(id).bounds.y)),
    };
    if (frame) {
      origin.x = Math.max(frame.x, Math.min(origin.x, frame.x + frame.width - width));
      origin.y = Math.max(frame.y, Math.min(origin.y, frame.y + frame.height - height));
    }
    const ordered = ['right-left', 'bottom-up'].includes(bundle.presentation.layout.direction)
      ? [...ids].reverse()
      : ids;
    let slot = 0;
    const maximumSlots = Math.min(100000, Math.max(256, ids.length * 64));
    for (const id of ordered) {
      const old = placements.get(id).bounds;
      let proposed;
      while (slot < maximumSlots) {
        const column = slot % columns,
          row = Math.floor(slot / columns);
        slot++;
        const candidate = {
          ...old,
          x: origin.x + column * (width + gap),
          y: origin.y + row * (height + gap),
        };
        if (frame && candidate.y + candidate.height > frame.y + frame.height) break;
        collisionChecks += obstacles.length + occupied.length;
        if (collisionChecks > 250000)
          return failure(
            '$.options.targetIds',
            'focused-region-required',
            'This layout exceeds the bounded obstacle-search budget; select a smaller region.',
          );
        if (
          !inside(candidate, frame) ||
          [...obstacles, ...occupied].some((bounds) => overlaps(candidate, bounds, gap / 2))
        )
          continue;
        proposed = candidate;
        break;
      }
      if (!proposed)
        return failure(
          `$.presentation.${id}`,
          'layout-space',
          `The selected region has insufficient space around fixed objects for ${id}; expand its container or select a smaller region.`,
        );
      occupied.push(proposed);
      for (const member of closureById.get(id))
        deltas.set(member, { dx: proposed.x - old.x, dy: proposed.y - old.y });
    }
  }
  const changes = [];
  for (const [id, delta] of deltas) {
    const before = geometryFields(placements.get(id)),
      after = translate(before, delta.dx, delta.dy);
    if (!same(before, after)) changes.push({ elementId: id, before, after });
  }
  for (const relation of bundle.document.relations) {
    const from = deltas.get(relation.from),
      to = deltas.get(relation.to);
    if (!from || !to || !same(from, to)) continue;
    const before = geometryFields(placements.get(relation.id)),
      after = translate(before, from.dx, from.dy);
    if (!same(before, after)) changes.push({ elementId: relation.id, before, after });
  }
  const result = preview(bundle, changes, options.transactionId);
  return {
    ...result,
    layout: {
      targetIds: [...options.targetIds],
      movedIds: changes.map((change) => change.elementId).sort(),
      lockedIds: [...new Set(lockedIds)].sort(),
    },
  };
}

/** Drop only explicitly selected connector routing intent; label anchors survive. */
export function previewResetRoute(bundle, options) {
  const checked = check(bundle, options, ['targetIds', 'transactionId']);
  if (!checked.ok) return checked;
  const byId = elementIndex(bundle.document);
  if (options.targetIds.some((id) => byId.get(id).collection !== 'relations'))
    return failure('$.options.targetIds', 'route-target', 'Reset route selects connectors only.');
  const placements = new Map(bundle.presentation.elements.map((value) => [value.elementId, value]));
  const changes = options.targetIds.flatMap((elementId) => {
    const before = geometryFields(placements.get(elementId));
    const after = clone(before);
    after.route.mode = 'automatic';
    after.route.points = [];
    return same(before, after) ? [] : [{ elementId, before, after }];
  });
  return preview(bundle, changes, options.transactionId);
}
