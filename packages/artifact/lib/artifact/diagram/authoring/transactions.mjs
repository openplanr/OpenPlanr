import {
  validateDiagramEditTransaction,
  diagramDocumentDigest,
} from '@openplanr/protocol/diagram-authoring-contracts';
import {
  clone,
  same,
  diagnostic,
  failure,
  validateAuthoringBundle,
  snapshot,
  elementIndex,
  semanticFields,
  geometryFields,
  appearanceFields,
  membershipState,
  sealBundle,
} from './model.mjs';
import { diffDiagramBundles, inverseDependencies, sourceMapChanges } from './diff.mjs';

function precondition(actual, expected, path, diagnostics) {
  if (same(actual, expected)) return true;
  diagnostics.push(
    diagnostic(
      path,
      'precondition',
      'The current affected value no longer matches the operation before-value.',
    ),
  );
  return false;
}
export function applyOperation(bundle, op, path, diagnostics) {
  const document = bundle.document;
  const entries = elementIndex(document);
  const placements = new Map(bundle.presentation.elements.map((value) => [value.elementId, value]));
  if (op.type === 'insert-elements') {
    for (const { value } of op.elements)
      if (entries.has(value.id))
        diagnostics.push(diagnostic(path, 'duplicate-id', `Element ${value.id} already exists.`));
    if (diagnostics.length) return;
    if (op.positions) {
      const positions = new Map(op.positions.map((value) => [value.elementId, value]));
      for (const collection of ['nodes', 'relations', 'groups', 'lanes', 'annotations']) {
        const inserted = op.elements
          .filter((entry) => entry.collection === collection)
          .sort(
            (a, b) =>
              positions.get(a.value.id).semanticIndex - positions.get(b.value.id).semanticIndex,
          );
        let previous = -1;
        for (const { value } of inserted) {
          const index = positions.get(value.id).semanticIndex;
          if (index <= previous || index > document[collection].length) {
            diagnostics.push(
              diagnostic(
                path,
                'insertion-position',
                `Invalid semantic insertion position for ${value.id}.`,
              ),
            );
            return;
          }
          document[collection].splice(index, 0, clone(value));
          previous = index;
        }
      }
      let previous = -1;
      for (const value of [...op.presentation].sort(
        (a, b) =>
          positions.get(a.elementId).presentationIndex -
          positions.get(b.elementId).presentationIndex,
      )) {
        const index = positions.get(value.elementId).presentationIndex;
        if (index <= previous || index > bundle.presentation.elements.length) {
          diagnostics.push(
            diagnostic(
              path,
              'insertion-position',
              `Invalid presentation insertion position for ${value.elementId}.`,
            ),
          );
          return;
        }
        bundle.presentation.elements.splice(index, 0, clone(value));
        previous = index;
      }
    } else {
      for (const { collection, value } of op.elements) document[collection].push(clone(value));
      bundle.presentation.elements.push(...clone(op.presentation));
    }
    for (const { collection, value } of op.elements)
      if (collection === 'lanes' && !document.laneOrder.includes(value.id))
        document.laneOrder.push(value.id);
  } else if (op.type === 'remove-elements') {
    for (const { collection, value } of op.elements) {
      const actual = entries.get(value.id);
      if (!actual || actual.collection !== collection) {
        diagnostics.push(
          diagnostic(
            path,
            'element-class',
            `Element ${value.id} does not belong to ${collection}.`,
          ),
        );
        return;
      }
      if (!precondition(actual.value, value, `${path}.${value.id}`, diagnostics)) return;
    }
    for (const value of op.presentation)
      if (
        !precondition(
          placements.get(value.elementId) ?? null,
          value,
          `${path}.${value.elementId}`,
          diagnostics,
        )
      )
        return;
    const ids = new Set(op.elements.map((entry) => entry.value.id));
    for (const collection of ['nodes', 'relations', 'groups', 'lanes', 'annotations'])
      document[collection] = document[collection].filter((value) => !ids.has(value.id));
    bundle.presentation.elements = bundle.presentation.elements.filter(
      (value) => !ids.has(value.elementId),
    );
    document.laneOrder = document.laneOrder.filter((id) => !ids.has(id));
  } else if (op.type === 'update-semantics') {
    if (op.collection === 'source-map') {
      if (precondition(bundle.sourceMap, op.before, path, diagnostics))
        bundle.sourceMap = clone(op.after);
    } else if (op.collection === 'document') {
      if (precondition(semanticFields('document', document), op.before, path, diagnostics))
        Object.assign(document, clone(op.after));
    } else if (op.collection === 'emphasis') {
      const actual =
        document.emphasis.find((value) => value.targetId === op.elementId)?.level ?? null;
      if (!precondition(actual, op.before, path, diagnostics)) return;
      const index = document.emphasis.findIndex((value) => value.targetId === op.elementId);
      if (op.after === null) document.emphasis.splice(index, index < 0 ? 0 : 1);
      else if (index >= 0) document.emphasis[index].level = op.after;
      else {
        const target = op.index ?? document.emphasis.length;
        if (target > document.emphasis.length) {
          diagnostics.push(
            diagnostic(path, 'insertion-position', 'Emphasis insertion index is out of range.'),
          );
          return;
        }
        document.emphasis.splice(target, 0, { targetId: op.elementId, level: op.after });
      }
    } else {
      const entry = entries.get(op.elementId);
      if (!entry || entry.collection !== op.collection) {
        diagnostics.push(
          diagnostic(
            path,
            'element-class',
            `Element ${op.elementId} does not belong to ${op.collection}.`,
          ),
        );
        return;
      }
      if (precondition(semanticFields(op.collection, entry.value), op.before, path, diagnostics))
        Object.assign(entry.value, clone(op.after));
    }
  } else if (op.type === 'set-membership-order') {
    if (!precondition(membershipState(document), op.before, path, diagnostics)) return;
    for (const collection of ['groups', 'lanes']) {
      if (
        !same(
          document[collection].map((value) => value.id).sort(),
          op.after[collection].map((value) => value.id).sort(),
        )
      ) {
        diagnostics.push(
          diagnostic(
            path,
            'containment-reference',
            'Membership must include exactly the existing containers.',
          ),
        );
        return;
      }
      for (const value of op.after[collection])
        entries.get(value.id).value.members = clone(value.members);
    }
    document.laneOrder = clone(op.after.laneOrder);
  } else {
    const geometry = op.type === 'set-geometry';
    for (const change of op.changes) {
      const placement = placements.get(change.elementId);
      if (!placement) {
        diagnostics.push(diagnostic(path, 'reference', `Missing placement ${change.elementId}.`));
        return;
      }
      if (
        !precondition(
          geometry ? geometryFields(placement) : appearanceFields(placement),
          change.before,
          `${path}.${change.elementId}`,
          diagnostics,
        )
      )
        return;
      if (geometry) {
        const oldBounds = placement.bounds;
        const newBounds = change.after.bounds;
        const positionChanged =
          !same(
            oldBounds && { x: oldBounds.x, y: oldBounds.y },
            newBounds && { x: newBounds.x, y: newBounds.y },
          ) ||
          !same(placement.label, change.after.label) ||
          placement.zIndex !== change.after.zIndex;
        const sizeChanged = !same(
          oldBounds && { width: oldBounds.width, height: oldBounds.height },
          newBounds && { width: newBounds.width, height: newBounds.height },
        );
        if (
          (placement.locks.position && positionChanged) ||
          (placement.locks.size && sizeChanged) ||
          (placement.locks.route && !same(placement.route, change.after.route))
        ) {
          diagnostics.push(
            diagnostic(
              `${path}.${change.elementId}`,
              'geometry-lock',
              `Geometry is locked for ${change.elementId}; explicitly unlock it first.`,
            ),
          );
          return;
        }
      }
      Object.assign(placement, clone(change.after));
    }
  }
}
function containmentIssues(before, after) {
  const oldEntries = elementIndex(before.document);
  const placements = new Map(after.presentation.elements.map((value) => [value.elementId, value]));
  const oldPlacements = new Map(
    before.presentation.elements.map((value) => [value.elementId, value]),
  );
  const diagnostics = [];
  for (const parent of [...after.document.groups, ...after.document.lanes]) {
    const old = oldEntries.get(parent.id)?.value;
    const bounds = placements.get(parent.id)?.bounds;
    const oldBounds = oldPlacements.get(parent.id)?.bounds;
    const childrenChanged = parent.members.some(
      (id) => !same(oldPlacements.get(id)?.bounds, placements.get(id)?.bounds),
    );
    if (
      !bounds ||
      (old && same(old.members, parent.members) && same(oldBounds, bounds) && !childrenChanged)
    )
      continue;
    for (const id of parent.members) {
      const child = placements.get(id)?.bounds;
      if (
        child &&
        (child.x < bounds.x ||
          child.y < bounds.y ||
          child.x + child.width > bounds.x + bounds.width ||
          child.y + child.height > bounds.y + bounds.height)
      )
        diagnostics.push(
          diagnostic(
            `$.presentation.${parent.id}`,
            'container-bounds',
            `Container ${parent.id} must contain child ${id}.`,
          ),
        );
    }
  }
  return diagnostics;
}
function attachmentPoint(bounds, attachment) {
  if (attachment.side === 'left' || attachment.side === 'right')
    return {
      x: bounds.x + (attachment.side === 'right' ? bounds.width : 0),
      y: bounds.y + bounds.height * attachment.offset,
    };
  return {
    x: bounds.x + bounds.width * attachment.offset,
    y: bounds.y + (attachment.side === 'bottom' ? bounds.height : 0),
  };
}
function resolveIncidentRoutes(before, after) {
  const oldEntries = elementIndex(before.document);
  const oldPlacements = new Map(
    before.presentation.elements.map((value) => [value.elementId, value]),
  );
  const placements = new Map(after.presentation.elements.map((value) => [value.elementId, value]));
  const changes = [];
  for (const relation of after.document.relations) {
    const old = oldEntries.get(relation.id)?.value;
    const placement = placements.get(relation.id);
    if (placement?.route?.mode !== 'manual') continue;
    const from = placements.get(relation.from)?.bounds;
    const to = placements.get(relation.to)?.bounds;
    if (!from || !to) continue;
    if (
      old &&
      old.from === relation.from &&
      old.to === relation.to &&
      same(oldPlacements.get(old.from)?.bounds, from) &&
      same(oldPlacements.get(old.to)?.bounds, to) &&
      same(oldPlacements.get(relation.id)?.route, placement.route)
    )
      continue;
    const geometry = geometryFields(placement);
    const route = geometry.route;
    const start = attachmentPoint(from, route.from);
    const end = attachmentPoint(to, route.to);
    if (route.strategy === 'straight') route.points = [start, end];
    else {
      const interior = route.points.slice(1, -1);
      const points = [start, ...interior, end];
      const resolved = [points[0]];
      for (let index = 1; index < points.length; index++) {
        const previous = resolved.at(-1);
        const next = points[index];
        if (previous.x !== next.x && previous.y !== next.y) {
          // Retain authored bends; an attachment extension may add a short elbow.
          const horizontal =
            index === 1
              ? ['left', 'right'].includes(route.from.side)
              : !['left', 'right'].includes(route.to.side);
          resolved.push(horizontal ? { x: next.x, y: previous.y } : { x: previous.x, y: next.y });
        }
        if (!same(resolved.at(-1), next)) resolved.push(next);
      }
      route.points = resolved;
    }
    if (!same(geometry, geometryFields(placement)))
      changes.push({ elementId: relation.id, before: geometryFields(placement), after: geometry });
  }
  return changes;
}
function derivedSourceMap(before, after) {
  if (!before.sourceMap) return null;
  const map = clone(before.sourceMap);
  const old = elementIndex(before.document);
  const current = elementIndex(after.document);
  for (const entry of map.entries) {
    if (!entry.elementIds.some((id) => !same(old.get(id), current.get(id)))) continue;
    entry.elementIds = entry.elementIds.filter((id) => current.has(id));
    entry.confidence = 'ambiguous';
    const loss = 'Semantic content changed after this source correspondence was captured.';
    if (!entry.losses.includes(loss)) entry.losses.push(loss);
  }
  map.semanticDigest = diagramDocumentDigest(after.document);
  return map;
}

/** Validate exact bases and before-values, apply on a private value, then validate once. */
export function previewDiagramTransaction(bundle, transaction) {
  const checked = validateAuthoringBundle(bundle);
  if (!checked.ok) return checked;
  let diagnostics;
  try {
    diagnostics = validateDiagramEditTransaction(transaction);
  } catch {
    return failure('$', 'plain-data', 'Transaction could not be inspected as inert JSON data.');
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  if (transaction.diagramId !== bundle.diagramId || !same(transaction.base, snapshot(bundle)))
    return failure(
      '$.base',
      'stale-base',
      'The transaction requires the exact current diagram snapshot.',
    );
  const originalIds = elementIndex(bundle.document);
  for (const op of transaction.operations)
    if (
      op.type === 'insert-elements' &&
      op.elements.some((entry) => originalIds.has(entry.value.id))
    )
      return failure(
        '$.operations',
        'duplicate-id',
        'Inserted identities must be fresh even when the same transaction removes an existing element.',
      );
  const next = clone(bundle);
  const canonicalTransaction = clone(transaction);
  for (const [index, op] of transaction.operations.entries()) {
    applyOperation(next, op, `$.operations[${index}]`, diagnostics);
    if (diagnostics.length) return { ok: false, diagnostics };
  }
  const routes = resolveIncidentRoutes(bundle, next);
  if (
    routes.some(
      (change) =>
        next.presentation.elements.find((value) => value.elementId === change.elementId).locks
          .route,
    )
  )
    return failure(
      '$.operations',
      'geometry-lock',
      'Incident connector routing is locked; explicitly unlock it before changing its attachment.',
    );
  if (routes.length) {
    // Endpoints are derived from node bounds. No node geometry is changed here.
    for (const change of routes)
      Object.assign(
        next.presentation.elements.find((value) => value.elementId === change.elementId),
        change.after,
      );
    canonicalTransaction.operations.push({ type: 'set-geometry', changes: routes });
  }
  if (
    bundle.sourceMap &&
    !transaction.operations.some(
      (op) => op.type === 'update-semantics' && op.collection === 'source-map',
    )
  ) {
    const map = derivedSourceMap(bundle, next);
    if (!same(next.sourceMap, map)) {
      canonicalTransaction.operations.push({
        type: 'update-semantics',
        collection: 'source-map',
        before: clone(next.sourceMap),
        after: map,
      });
      next.sourceMap = map;
    }
  }
  if (
    next.sourceMap &&
    transaction.operations.some(
      (op) => op.type === 'update-semantics' && op.collection === 'source-map',
    ) &&
    next.sourceMap.semanticDigest !== diagramDocumentDigest(next.document)
  )
    return failure(
      '$.sourceMap.semanticDigest',
      'basis',
      'The updated source map must identify the resulting semantic document.',
    );
  const sealed = sealBundle(next);
  diagnostics.push(...containmentIssues(bundle, sealed));
  const finalCheck = validateAuthoringBundle(sealed);
  diagnostics.push(...finalCheck.diagnostics);
  diagnostics.push(...validateDiagramEditTransaction(canonicalTransaction));
  if (diagnostics.length) return { ok: false, diagnostics };
  const diff = diffDiagramBundles(bundle, sealed);
  const positions = [];
  const finalIds = elementIndex(sealed.document);
  for (const [id, entry] of elementIndex(bundle.document))
    if (!finalIds.has(id))
      positions.push({
        elementId: id,
        semanticIndex: bundle.document[entry.collection].findIndex((value) => value.id === id),
        presentationIndex: bundle.presentation.elements.findIndex(
          (value) => value.elementId === id,
        ),
      });
  return {
    ok: true,
    bundle: sealed,
    transaction: canonicalTransaction,
    diff: { semantic: diff.semantic, presentation: diff.presentation },
    impact: diff.impact,
    inverse: {
      diagramId: bundle.diagramId,
      transactionId: transaction.transactionId,
      changes: {
        semantic: diff.semantic,
        presentation: diff.presentation,
        sourceMap: sourceMapChanges(bundle.sourceMap, sealed.sourceMap),
      },
      dependencies: inverseDependencies(sealed, diff.impact),
      positions,
      emphasisOrder: bundle.document.emphasis.map((value) => value.targetId),
    },
  };
}
