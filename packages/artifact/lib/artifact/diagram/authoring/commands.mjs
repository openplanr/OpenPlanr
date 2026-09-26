import {
  clone,
  geometryFields,
  inspectPlainData,
  membershipState,
  same,
  semanticFields,
  snapshot,
  validateAuthoringBundle,
} from './model.mjs';
import { previewDiagramTransaction } from './transactions.mjs';

const collections = ['nodes', 'relations', 'groups', 'lanes', 'annotations'];
const fields = {
  create: ['elements', 'presentation'],
  rename: ['id', 'label'],
  describe: ['id', 'description'],
  reconnect: ['id', 'from', 'to'],
  move: ['ids', 'dx', 'dy'],
  resize: ['id', 'bounds'],
  geometry: ['changes'],
  appearance: ['changes'],
  reparent: ['ids', 'parentId', 'index'],
  group: ['group', 'ids', 'placement', 'parentId'],
  ungroup: ['ids'],
  'reorder-lanes': ['ids'],
  duplicate: ['ids', 'idMap', 'dx', 'dy'],
  paste: ['sourceBundle', 'ids', 'idMap', 'dx', 'dy'],
  delete: ['ids', 'confirmedImpact'],
  cancel: [],
};
const fail = (rule, detail, path = '$command') => ({
  ok: false,
  diagnostics: [{ path, rule, detail }],
});
const entries = (document) =>
  collections.flatMap((collection) => document[collection].map((value) => ({ collection, value })));
const placement = (bundle, id) =>
  bundle.presentation.elements.find((value) => value.elementId === id);
const entry = (bundle, id) => entries(bundle.document).find((item) => item.value.id === id);
const documentFields = (doc) =>
  clone({
    title: doc.title,
    summary: doc.summary,
    audience: doc.audience,
    accessibility: doc.accessibility,
  });
function requireValue(condition, message) {
  if (!condition) throw new TypeError(message);
}
function selected(bundle, ids) {
  requireValue(
    Array.isArray(ids) && ids.length > 0 && ids.length <= 10000 && new Set(ids).size === ids.length,
    'Select distinct element IDs.',
  );
  const byId = new Map(entries(bundle.document).map((item) => [item.value.id, item]));
  requireValue(
    ids.every((id) => typeof id === 'string' && byId.has(id)),
    'A selected element is missing.',
  );
  return byId;
}
function closure(bundle, ids) {
  const byId = selected(bundle, ids),
    found = new Set(ids),
    queue = [...ids];
  for (let i = 0; i < queue.length; i++) {
    const value = byId.get(queue[i]).value;
    for (const id of value.members ?? [])
      if (!found.has(id)) {
        found.add(id);
        queue.push(id);
      }
  }
  return found;
}
function parentMap(document) {
  return new Map(
    [...document.groups, ...document.lanes].flatMap((item) =>
      item.members.map((id) => [id, item.id]),
    ),
  );
}
function roots(bundle, ids) {
  selected(bundle, ids);
  const chosen = new Set(ids),
    parents = parentMap(bundle.document);
  return ids.filter((id) => {
    let parent = parents.get(id);
    while (parent) {
      if (chosen.has(parent)) return false;
      parent = parents.get(parent);
    }
    return true;
  });
}
const membershipOp = (before, after) => ({ type: 'set-membership-order', before, after });
const semanticOp = (item, after) => ({
  type: 'update-semantics',
  collection: item.collection,
  elementId: item.value.id,
  before: semanticFields(item.collection, item.value),
  after,
});
function translate(geometry, dx, dy) {
  const next = clone(geometry);
  if (next.bounds) {
    next.bounds.x += dx;
    next.bounds.y += dy;
  }
  if (next.route?.mode === 'manual')
    next.route.points = next.route.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
  if (next.label) {
    next.label.x += dx;
    next.label.y += dy;
  }
  return next;
}
function reparent(bundle, ids, parentId, index) {
  const chosen = roots(bundle, ids),
    selectedClosure = closure(bundle, chosen);
  const parent = parentId === null ? null : entry(bundle, parentId);
  requireValue(
    parentId === null || ['groups', 'lanes'].includes(parent?.collection),
    'Choose a container or the diagram root as parent.',
  );
  requireValue(
    !selectedClosure.has(parentId),
    'A container cannot contain itself or its ancestor.',
  );
  requireValue(
    chosen.every((id) => entry(bundle, id).collection !== 'relations'),
    'Connectors cannot become container members.',
  );
  const before = membershipState(bundle.document),
    after = clone(before);
  for (const container of [...after.groups, ...after.lanes])
    container.members = container.members.filter((id) => !chosen.includes(id));
  if (parent) {
    const container = [...after.groups, ...after.lanes].find((item) => item.id === parentId);
    const offset = index === undefined ? container.members.length : index;
    requireValue(
      Number.isInteger(offset) && offset >= 0 && offset <= container.members.length,
      'Membership insertion index is outside the container.',
    );
    container.members.splice(offset, 0, ...chosen);
  } else requireValue(index === undefined, 'Root placement does not have a membership index.');
  return membershipOp(before, after);
}
function removal(bundle, ids, ungroup = false) {
  selected(bundle, ids);
  const removed = ungroup ? new Set(ids) : closure(bundle, ids);
  if (ungroup)
    requireValue(
      ids.every((id) => ['groups', 'lanes'].includes(entry(bundle, id).collection)),
      'Ungroup selects containers only.',
    );
  if (!ungroup) {
    for (const edge of bundle.document.relations)
      if (removed.has(edge.from) || removed.has(edge.to)) removed.add(edge.id);
    // An annotation may target another annotation; close this set transitively.
    let changed = true;
    while (changed) {
      changed = false;
      for (const note of bundle.document.annotations)
        if (removed.has(note.targetId) && !removed.has(note.id)) {
          removed.add(note.id);
          changed = true;
        }
    }
  }
  const before = membershipState(bundle.document),
    after = clone(before);
  const byId = new Map(entries(bundle.document).map((item) => [item.value.id, item]));
  function retain(id) {
    return removed.has(id)
      ? ungroup
        ? (byId.get(id).value.members ?? []).flatMap(retain)
        : []
      : [id];
  }
  for (const container of [...after.groups, ...after.lanes])
    container.members = removed.has(container.id) ? [] : container.members.flatMap(retain);
  // Removed lanes remain in the temporary membership state until the removal op.
  const operations = [membershipOp(before, after)];
  const readingOrderIds = bundle.document.accessibility.readingOrder.filter((id) =>
    removed.has(id),
  );
  if (readingOrderIds.length) {
    const beforeDocument = documentFields(bundle.document),
      afterDocument = clone(beforeDocument);
    afterDocument.accessibility.readingOrder = afterDocument.accessibility.readingOrder.filter(
      (id) => !removed.has(id),
    );
    operations.push({
      type: 'update-semantics',
      collection: 'document',
      before: beforeDocument,
      after: afterDocument,
    });
  }
  for (const emphasis of bundle.document.emphasis)
    if (removed.has(emphasis.targetId))
      operations.push({
        type: 'update-semantics',
        collection: 'emphasis',
        elementId: emphasis.targetId,
        before: emphasis.level,
        after: null,
      });
  if (ungroup)
    for (const note of bundle.document.annotations)
      if (removed.has(note.targetId))
        operations.push(
          semanticOp(
            { collection: 'annotations', value: note },
            { text: note.text, targetId: null },
          ),
        );
  const elements = entries(bundle.document)
    .filter((item) => removed.has(item.value.id))
    .map((item) => ({
      collection: item.collection,
      value: { ...clone(item.value), ...(item.value.members ? { members: [] } : {}) },
    }));
  operations.push({
    type: 'remove-elements',
    elements,
    presentation: bundle.presentation.elements
      .filter((item) => removed.has(item.elementId))
      .map(clone),
  });
  const impact = {
    elementIds: [...removed].sort(),
    relationIds: bundle.document.relations
      .filter((item) => removed.has(item.id))
      .map((item) => item.id)
      .sort(),
    annotationIds: bundle.document.annotations
      .filter((item) => removed.has(item.id) || removed.has(item.targetId))
      .map((item) => item.id)
      .sort(),
    membershipIds: [...before.groups, ...before.lanes]
      .filter((item) => removed.has(item.id) || item.members.some((id) => removed.has(id)))
      .map((item) => item.id)
      .sort(),
    readingOrderIds: [...readingOrderIds].sort(),
    emphasisIds: bundle.document.emphasis
      .filter((item) => removed.has(item.targetId))
      .map((item) => item.targetId)
      .sort(),
  };
  return { operations, impact };
}
function duplicate(bundle, command) {
  const source = command.type === 'paste' ? command.sourceBundle : bundle;
  const validation = validateAuthoringBundle(source);
  requireValue(validation.ok, 'The copied diagram bundle is invalid.');
  const copied = closure(source, command.ids);
  for (const relation of source.document.relations)
    if (copied.has(relation.from) && copied.has(relation.to)) copied.add(relation.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const note of source.document.annotations)
      if (copied.has(note.targetId) && !copied.has(note.id)) {
        copied.add(note.id);
        changed = true;
      }
  }
  // Explicitly selected connectors may not fabricate links into uncopied nodes.
  const excludedRelationIds = source.document.relations
    .filter(
      (item) =>
        (copied.has(item.id) || copied.has(item.from) || copied.has(item.to)) &&
        !(copied.has(item.from) && copied.has(item.to)),
    )
    .map((item) => item.id);
  excludedRelationIds.forEach((id) => copied.delete(id));
  const idMap = command.idMap;
  requireValue(
    idMap &&
      !Array.isArray(idMap) &&
      typeof idMap === 'object' &&
      same(Object.keys(idMap).sort(), [...copied].sort()),
    'Supply exactly one fresh ID for every copied element, including internal connectors and attached annotations.',
  );
  const fresh = Object.values(idMap),
    existing = new Set(entries(bundle.document).map((item) => item.value.id));
  requireValue(
    fresh.every((id) => typeof id === 'string' && !existing.has(id)) &&
      new Set(fresh).size === fresh.length,
    'Copied element IDs must be fresh and distinct.',
  );
  const dx = command.dx === undefined ? 0 : command.dx,
    dy = command.dy === undefined ? 0 : command.dy;
  requireValue(Number.isFinite(dx) && Number.isFinite(dy), 'Copy offsets must be finite numbers.');
  const detachedAnnotationIds = [];
  const elements = entries(source.document)
    .filter((item) => copied.has(item.value.id))
    .map((item) => {
      const value = clone(item.value);
      value.id = idMap[value.id];
      if (value.members)
        value.members = value.members.filter((id) => copied.has(id)).map((id) => idMap[id]);
      if (item.collection === 'relations') {
        value.from = idMap[value.from];
        value.to = idMap[value.to];
      }
      if (item.collection === 'annotations' && value.targetId !== null) {
        if (!copied.has(value.targetId)) detachedAnnotationIds.push(item.value.id);
        value.targetId = Object.hasOwn(idMap, value.targetId) ? idMap[value.targetId] : null;
      }
      return { collection: item.collection, value };
    });
  requireValue(elements.length > 0, 'Selection has no self-contained elements to copy.');
  const presentation = source.presentation.elements
    .filter((item) => copied.has(item.elementId))
    .map((item) => ({
      ...clone(item),
      ...translate(geometryFields(item), dx, dy),
      elementId: idMap[item.elementId],
    }));
  const operations = [{ type: 'insert-elements', elements, presentation }];
  // Explicit order and emphasis are separate semantics, not inferred from array indexes.
  const before = membershipState(bundle.document);
  for (const collection of ['groups', 'lanes'])
    before[collection].push(
      ...elements
        .filter((item) => item.collection === collection)
        .map((item) => ({ id: item.value.id, members: [...item.value.members] })),
    );
  before.laneOrder.push(
    ...elements.filter((item) => item.collection === 'lanes').map((item) => item.value.id),
  );
  const after = clone(before);
  after.laneOrder = [
    ...bundle.document.laneOrder,
    ...source.document.laneOrder.filter((id) => copied.has(id)).map((id) => idMap[id]),
  ];
  operations.push(membershipOp(before, after));
  for (const item of source.document.emphasis)
    if (copied.has(item.targetId))
      operations.push({
        type: 'update-semantics',
        collection: 'emphasis',
        elementId: idMap[item.targetId],
        before: null,
        after: item.level,
      });
  const beforeDocument = documentFields(bundle.document),
    afterDocument = clone(beforeDocument);
  afterDocument.accessibility.readingOrder.push(
    ...source.document.accessibility.readingOrder
      .filter((id) => copied.has(id))
      .map((id) => idMap[id]),
  );
  operations.push({
    type: 'update-semantics',
    collection: 'document',
    before: beforeDocument,
    after: afterDocument,
  });
  return {
    operations,
    disclosures: {
      excludedRelationIds: excludedRelationIds.sort(),
      detachedAnnotationIds: detachedAnnotationIds.sort(),
    },
  };
}

/** Compile one completed gesture. Callers retain previews until their adapter acknowledges a save. */
export function compileDiagramCommand(bundle, command, options = {}) {
  const validation = validateAuthoringBundle(bundle);
  if (!validation.ok) return validation;
  const diagnostics = [...inspectPlainData(command, ['$.idMap']), ...inspectPlainData(options)];
  if (diagnostics.length) return { ok: false, diagnostics };
  if (
    !command ||
    typeof command !== 'object' ||
    Array.isArray(command) ||
    !Object.hasOwn(fields, command.type)
  )
    return fail('command', 'Unknown diagram command.');
  if (Object.keys(command).some((key) => key !== 'type' && !fields[command.type].includes(key)))
    return fail('command-field', 'The command contains an unsupported field.');
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => key !== 'transactionId')
  )
    return fail('options', 'Only a caller-supplied transactionId is accepted.', '$options');
  if (command.type === 'cancel') return { ok: true, cancelled: true, transaction: null };
  let operations, disclosures;
  try {
    switch (command.type) {
      case 'create':
        operations = [
          {
            type: 'insert-elements',
            elements: clone(command.elements),
            presentation: clone(command.presentation),
          },
        ];
        break;
      case 'rename':
      case 'describe':
      case 'reconnect': {
        const item = entry(bundle, command.id);
        requireValue(item, 'The edited element is missing.');
        const before = semanticFields(item.collection, item.value),
          after = clone(before);
        if (command.type === 'rename') {
          requireValue(typeof command.label === 'string', 'The label must be text.');
          if (item.collection === 'annotations') after.text = command.label;
          else after.label = command.label;
        } else if (command.type === 'describe') {
          requireValue(item.collection === 'nodes', 'Descriptions belong to nodes.');
          after.description = command.description;
        } else {
          requireValue(item.collection === 'relations', 'Reconnect selects a connector.');
          after.from = command.from;
          after.to = command.to;
        }
        operations = [semanticOp(item, after)];
        break;
      }
      case 'move': {
        requireValue(
          Number.isFinite(command.dx) && Number.isFinite(command.dy),
          'Movement offsets must be finite numbers.',
        );
        const moved = closure(bundle, command.ids);
        for (const relation of bundle.document.relations)
          if (moved.has(relation.from) && moved.has(relation.to)) moved.add(relation.id);
        operations = [
          {
            type: 'set-geometry',
            changes: bundle.presentation.elements
              .filter((item) => moved.has(item.elementId))
              .map((item) => ({
                elementId: item.elementId,
                before: geometryFields(item),
                after: translate(geometryFields(item), command.dx, command.dy),
              })),
          },
        ];
        break;
      }
      case 'resize': {
        const current = placement(bundle, command.id);
        requireValue(current?.bounds, 'Resize selects a bounded element.');
        operations = [
          {
            type: 'set-geometry',
            changes: [
              {
                elementId: command.id,
                before: geometryFields(current),
                after: { ...geometryFields(current), bounds: clone(command.bounds) },
              },
            ],
          },
        ];
        break;
      }
      case 'geometry':
        operations = [{ type: 'set-geometry', changes: clone(command.changes) }];
        break;
      case 'appearance':
        operations = [{ type: 'set-appearance-locks', changes: clone(command.changes) }];
        break;
      case 'reparent':
        operations = [reparent(bundle, command.ids, command.parentId, command.index)];
        break;
      case 'reorder-lanes': {
        requireValue(
          Array.isArray(command.ids) &&
            same([...command.ids].sort(), bundle.document.lanes.map((item) => item.id).sort()),
          'Lane order must include every lane exactly once.',
        );
        const before = membershipState(bundle.document);
        operations = [membershipOp(before, { ...clone(before), laneOrder: [...command.ids] })];
        break;
      }
      case 'group': {
        requireValue(
          command.group && same(Object.keys(command.group).sort(), ['id', 'label']),
          'A new group requires only its ID and label.',
        );
        const chosen = roots(bundle, command.ids),
          parents = parentMap(bundle.document);
        const parentIds = new Set(chosen.map((id) => parents.get(id) ?? null));
        const parentId = Object.hasOwn(command, 'parentId')
          ? command.parentId
          : parentIds.size === 1
            ? [...parentIds][0]
            : null;
        const group = { ...clone(command.group), members: [] };
        const temporary = clone(bundle);
        temporary.document.groups.push(group);
        temporary.presentation.elements.push(clone(command.placement));
        requireValue(
          command.placement?.elementId === group.id,
          'The group placement must identify the new group.',
        );
        const intoGroup = reparent(temporary, chosen, group.id);
        for (const container of [...intoGroup.after.groups, ...intoGroup.after.lanes])
          if (container.id === parentId) container.members.push(group.id);
        requireValue(
          parentId === null ||
            [...intoGroup.after.groups, ...intoGroup.after.lanes].some(
              (item) => item.id === parentId,
            ),
          'The group parent is missing.',
        );
        operations = [
          {
            type: 'insert-elements',
            elements: [{ collection: 'groups', value: group }],
            presentation: [clone(command.placement)],
          },
          intoGroup,
        ];
        break;
      }
      case 'ungroup':
        operations = removal(bundle, command.ids, true).operations;
        break;
      case 'delete': {
        const preview = removal(bundle, command.ids);
        if (!same(command.confirmedImpact ?? null, preview.impact))
          return {
            ...fail(
              'confirmation-required',
              'Confirm the complete deletion impact before compiling this transaction.',
            ),
            deletionImpact: preview.impact,
          };
        operations = preview.operations;
        disclosures = { deletionImpact: preview.impact };
        break;
      }
      case 'duplicate':
      case 'paste':
        ({ operations, disclosures } = duplicate(bundle, command));
        break;
      default:
        return fail('command', 'Unknown diagram command.');
    }
    operations = operations.filter(
      (op) => !Object.hasOwn(op, 'before') || !same(op.before, op.after),
    );
    if (!operations.length) return { ok: true, changed: false, transaction: null };
    const transaction = {
      kind: 'diagram-edit-transaction',
      schemaVersion: '1.0.0',
      protocolVersion: '1.13.0',
      transactionId: options.transactionId,
      diagramId: bundle.diagramId,
      base: snapshot(bundle),
      operations,
      undoOf: null,
    };
    const result = previewDiagramTransaction(bundle, transaction);
    return disclosures ? { ...result, disclosures } : result;
  } catch (error) {
    return fail(
      'command-value',
      error instanceof TypeError ? error.message : 'The command cannot be compiled.',
    );
  }
}
