import {
  COLLECTIONS,
  clone,
  same,
  elementIndex,
  parentIndex,
  descendants,
  validateAuthoringBundle,
  failure,
} from './model.mjs';

function fields(before, after, base, result, path = []) {
  if (same(before, after)) return;
  if (
    before &&
    after &&
    !Array.isArray(before) &&
    !Array.isArray(after) &&
    typeof before === 'object' &&
    typeof after === 'object'
  ) {
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort())
      fields(before[key], after[key], base, result, [...path, key]);
  } else
    result.push({
      ...base,
      path,
      before: before === undefined ? null : clone(before),
      after: after === undefined ? null : clone(after),
    });
}
function records(before, after, collection, identity, result) {
  const old = new Map(before.map((value) => [value[identity], value]));
  const next = new Map(after.map((value) => [value[identity], value]));
  for (const id of [...new Set([...old.keys(), ...next.keys()])].sort()) {
    const base = { collection, elementId: id };
    if (!old.has(id) || !next.has(id))
      result.push({
        ...base,
        path: [],
        before: clone(old.get(id) ?? null),
        after: clone(next.get(id) ?? null),
      });
    else fields(old.get(id), next.get(id), base, result);
  }
}
export function affectedState(before, after, semantic, presentation) {
  const writes = new Set(
    [...semantic, ...presentation].flatMap((change) =>
      change.elementId === null ? [] : [change.elementId],
    ),
  );
  const reads = new Set(writes);
  for (const change of semantic)
    if (
      change.collection === 'document' &&
      (change.path[0] === 'laneOrder' ||
        (change.path[0] === 'accessibility' && change.path[1] === 'readingOrder'))
    ) {
      for (const id of [...change.before, ...change.after]) reads.add(id);
    }
  for (const bundle of [before, after]) {
    const document = bundle.document;
    const parents = parentIndex(document);
    for (const id of descendants(document, [...writes])) reads.add(id);
    for (const edge of document.relations)
      if (reads.has(edge.id) || reads.has(edge.from) || reads.has(edge.to)) {
        reads.add(edge.id);
        reads.add(edge.from);
        reads.add(edge.to);
      }
    for (const note of document.annotations)
      if (reads.has(note.id) || reads.has(note.targetId)) {
        reads.add(note.id);
        if (note.targetId !== null) reads.add(note.targetId);
      }
    for (const id of [...reads]) {
      let parent = parents.get(id);
      while (parent) {
        reads.add(parent);
        parent = parents.get(parent);
      }
    }
  }
  const readIds = [...reads].sort();
  const writeIds = [...writes].sort();
  return { affectedIds: readIds, readIds, writeIds };
}

/** Identity-keyed user changes; derived digest/basis fields are deliberately omitted. */
export function diffDiagramBundles(before, after) {
  for (const bundle of [before, after]) {
    const checked = validateAuthoringBundle(bundle);
    if (!checked.ok) return checked;
  }
  if (before.diagramId !== after.diagramId)
    return failure('$.diagramId', 'diagram-id', 'Diff requires snapshots of the same diagram.');
  const semantic = [];
  const presentation = [];
  for (const collection of COLLECTIONS)
    records(before.document[collection], after.document[collection], collection, 'id', semantic);
  records(before.document.emphasis, after.document.emphasis, 'emphasis', 'targetId', semantic);
  for (const field of ['title', 'summary', 'audience', 'grammar', 'laneOrder', 'accessibility'])
    fields(
      before.document[field],
      after.document[field],
      { collection: 'document', elementId: null },
      semantic,
      [field],
    );
  records(
    before.presentation.elements,
    after.presentation.elements,
    'elements',
    'elementId',
    presentation,
  );
  for (const field of ['layout', 'theme'])
    fields(
      before.presentation[field],
      after.presentation[field],
      { collection: 'presentation', elementId: null },
      presentation,
      [field],
    );
  return {
    ok: true,
    semantic,
    presentation,
    impact: affectedState(before, after, semantic, presentation),
  };
}

/** Snapshot only values the inverse reads. Unrelated fields on edited records survive. */
export function inverseDependencies(bundle, impact) {
  const elements = elementIndex(bundle.document);
  const parents = parentIndex(bundle.document);
  const placements = new Map(bundle.presentation.elements.map((value) => [value.elementId, value]));
  const writes = new Set(impact.writeIds);
  const incident = new Map();
  const annotations = new Map();
  for (const { id, from, to } of bundle.document.relations)
    for (const endpoint of new Set([from, to])) {
      if (!incident.has(endpoint)) incident.set(endpoint, []);
      incident.get(endpoint).push({ id, from, to });
    }
  for (const values of incident.values())
    values.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const { id, targetId } of bundle.document.annotations)
    if (targetId !== null) {
      if (!annotations.has(targetId)) annotations.set(targetId, []);
      annotations.get(targetId).push(id);
    }
  for (const values of annotations.values()) values.sort();
  return impact.readIds.map((elementId) => {
    const entry = elements.get(elementId);
    if (!entry) return { elementId, value: null };
    if (!writes.has(elementId))
      return {
        elementId,
        value: clone({
          semantic: entry,
          placement: placements.get(elementId),
          parent: parents.get(elementId) ?? null,
        }),
      };
    const { from, to, targetId, members } = entry.value;
    return {
      elementId,
      value: clone({
        collection: entry.collection,
        parent: parents.get(elementId) ?? null,
        ...(from === undefined ? {} : { from, to }),
        ...(targetId === undefined ? {} : { targetId }),
        ...(members === undefined ? {} : { members }),
        locks: placements.get(elementId).locks,
        incident: incident.get(elementId) ?? [],
        annotations: annotations.get(elementId) ?? [],
      }),
    };
  });
}

export function sourceMapChanges(before, after) {
  const changes = [];
  if (before === null || after === null) {
    if (!same(before, after))
      changes.push({
        collection: 'source-map',
        elementId: null,
        path: [],
        before: clone(before),
        after: clone(after),
      });
    return changes;
  }
  // Source entries retain their captured positions and original bytes; compare each
  // correspondence separately so undo can preserve another entry's newer change.
  for (const key of Object.keys(before).filter(
    (key) => key !== 'semanticDigest' && key !== 'entries',
  ))
    fields(before[key], after[key], { collection: 'source-map', elementId: null }, changes, [key]);
  if (before.entries.length !== after.entries.length)
    fields(before.entries, after.entries, { collection: 'source-map', elementId: null }, changes, [
      'entries',
    ]);
  else
    for (let index = 0; index < before.entries.length; index++)
      fields(
        before.entries[index],
        after.entries[index],
        { collection: 'source-map', elementId: null },
        changes,
        ['entries', String(index)],
      );
  return changes;
}
