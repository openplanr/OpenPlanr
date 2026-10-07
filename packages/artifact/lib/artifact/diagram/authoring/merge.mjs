// @ts-check
import {
  clone,
  elementIndex,
  failure,
  inspectPlainData,
  same,
  sealBundle,
  validateAuthoringBundle,
} from './model.mjs';

const absent = Symbol('absent');
const isRootField = (path, field) => path.length === 1 && path[0] === field;
const isObject = (value) =>
  value !== absent && value !== null && typeof value === 'object' && !Array.isArray(value);
const identical = (left, right) =>
  left === absent || right === absent ? left === right : same(left, right);
const copy = (value) => (value === absent ? absent : clone(value));
const collectionKey = (path) => {
  if (path.length !== 2) return null;
  if (path[0] === 'presentation' && path[1] === 'elements') return 'elementId';
  if (path[0] !== 'document') return null;
  if (path[1] === 'emphasis') return 'targetId';
  return ['nodes', 'relations', 'groups', 'lanes', 'annotations'].includes(path[1]) ? 'id' : null;
};
const derived = (path, key) =>
  (path.length === 0 && key === 'bundleDigest') ||
  (path.length === 1 && path[0] === 'document' && key === 'documentDigest') ||
  (path.length === 1 &&
    path[0] === 'presentation' &&
    ['semanticDigest', 'presentationDigest'].includes(key)) ||
  (path.length === 1 && path[0] === 'sourceMap' && key === 'semanticDigest');

function validateMergeInputs(base, local, remote, choices) {
  for (const bundle of [base, local, remote]) {
    const checked = validateAuthoringBundle(bundle);
    if (!checked.ok) return checked;
  }
  if (base.diagramId !== local.diagramId || base.diagramId !== remote.diagramId)
    return failure('$.diagramId', 'diagram-id', 'Compare copies of the same diagram.');
  if (
    inspectPlainData(choices).length ||
    !isObject(choices) ||
    Object.values(choices).some((choice) => !['local', 'remote'].includes(choice))
  )
    return failure('$.choices', 'merge-choices', 'Choose local or remote for each overlap.');
  const correspondenceBasis = (map) =>
    map === null
      ? null
      : {
          ...map,
          semanticDigest: null,
          entries: map.entries.map(({ elementIds, confidence, losses, ...entry }) => entry),
        };
  if (
    ![local, remote].every((bundle) =>
      same(correspondenceBasis(base.sourceMap), correspondenceBasis(bundle.sourceMap)),
    )
  )
    return failure(
      '$.sourceMap',
      'source-correspondence',
      'Source correspondence changed independently. Keep the complete copies before resolving it.',
    );
  if (
    base.sourceMap &&
    [local, remote].some((bundle) => {
      const ids = elementIndex(bundle.document);
      return bundle.sourceMap.entries.some(
        (entry, index) =>
          !same(
            entry.elementIds,
            base.sourceMap.entries[index].elementIds.filter((id) => ids.has(id)),
          ),
      );
    })
  )
    return failure(
      '$.sourceMap',
      'source-correspondence',
      'Source identities were remapped independently. Keep the complete copies before resolving it.',
    );
  return null;
}
function collectStructuralChoices(base, local, remote, indexes, overlap) {
  const structural = new Map();
  for (const id of new Set(indexes.flatMap((index) => [...index.keys()]))) {
    const pairs = [base, local, remote].map((bundle, i) =>
      indexes[i].has(id)
        ? {
            semantic: clone(indexes[i].get(id)),
            placement: clone(bundle.presentation.elements.find((item) => item.elementId === id)),
          }
        : absent,
    );
    if (pairs[1] !== absent && pairs[2] !== absent) continue;
    if (
      identical(pairs[1], pairs[2]) ||
      identical(pairs[0], pairs[1]) ||
      identical(pairs[0], pairs[2])
    )
      continue;
    const collection =
      indexes[0].get(id)?.collection ??
      indexes[1].get(id)?.collection ??
      indexes[2].get(id)?.collection;
    structural.set(id, overlap(...pairs, ['document', collection, id]));
  }
  return structural;
}
function structuralValue(path, structural) {
  if (path.length === 3 && structural.has(path[2])) {
    const pair = structural.get(path[2]);
    if (path[0] === 'presentation' && path[1] === 'elements')
      return { value: pair === absent ? absent : clone(pair.placement) };
    if (
      path[0] === 'document' &&
      ['nodes', 'relations', 'groups', 'lanes', 'annotations'].includes(path[1])
    )
      return { value: pair === absent ? absent : clone(pair.semantic.value) };
  }
  return null;
}
function mergeObjects(original, mine, theirs, path, merge) {
  const result = {};
  for (const key of new Set([
    ...Object.keys(original),
    ...Object.keys(mine),
    ...Object.keys(theirs),
  ])) {
    const value = derived(path, key)
      ? copy(theirs[key])
      : merge(
          Object.hasOwn(original, key) ? original[key] : absent,
          Object.hasOwn(mine, key) ? mine[key] : absent,
          Object.hasOwn(theirs, key) ? theirs[key] : absent,
          [...path, key],
        );
    if (value !== absent) result[key] = value;
  }
  return result;
}
function mergeElements(original, mine, theirs, path, key, merge) {
  const maps = [original, mine, theirs].map(
    (items) => new Map(items.map((item) => [item[key], item])),
  );
  const result = [];
  // Preserve the observed head's order; new local identities append in their explicit order.
  for (const id of new Set([
    ...theirs.map((item) => item[key]),
    ...mine.map((item) => item[key]),
    ...original.map((item) => item[key]),
  ])) {
    const value = merge(...maps.map((map) => (map.has(id) ? map.get(id) : absent)), [...path, id]);
    if (value !== absent) result.push(value);
  }
  const order = merge(
    original.map((item) => item[key]),
    mine.map((item) => item[key]),
    theirs.map((item) => item[key]),
    [...path, '$order'],
  );
  const positions = new Map(order.map((id, index) => [id, index]));
  result.sort(
    (left, right) =>
      (positions.get(left[key]) ?? Infinity) - (positions.get(right[key]) ?? Infinity),
  );
  return result;
}
function applyStructuralChoices(target, structural, choices, local, remote) {
  // Structural choices carry a semantic element and its placement together, even
  // when a parent object could otherwise take an unchanged-side shortcut.
  for (const [id, pair] of structural) {
    for (const collection of ['nodes', 'relations', 'groups', 'lanes', 'annotations'])
      target.document[collection] = target.document[collection].filter((item) => item.id !== id);
    target.presentation.elements = target.presentation.elements.filter(
      (item) => item.elementId !== id,
    );
    if (pair !== absent) {
      const chosen =
        choices[JSON.stringify(['document', pair.semantic.collection, id])] === 'local'
          ? local
          : remote;
      const collection = pair.semantic.collection;
      const semanticIndex = chosen.document[collection].findIndex((item) => item.id === id);
      const presentationIndex = chosen.presentation.elements.findIndex(
        (item) => item.elementId === id,
      );
      target.document[collection].splice(Math.max(0, semanticIndex), 0, clone(pair.semantic.value));
      target.presentation.elements.splice(Math.max(0, presentationIndex), 0, clone(pair.placement));
    }
  }
}
function retainSourceCorrespondence(target, base, local, remote, indexes) {
  // Source bytes stay immutable. Correspondence confidence may only become more
  // conservative as independently edited semantics are combined.
  if (!base.sourceMap) return;
  target.sourceMap = clone(base.sourceMap);
  const finalEntries = elementIndex(target.document);
  for (let i = 0; i < target.sourceMap.entries.length; i++) {
    const entry = target.sourceMap.entries[i];
    const counterparts = [local.sourceMap.entries[i], remote.sourceMap.entries[i]];
    const changed = entry.elementIds.some((id) => !same(indexes[0].get(id), finalEntries.get(id)));
    entry.losses = [...new Set([entry.losses, ...counterparts.map((item) => item.losses)].flat())];
    if (changed || counterparts.some((item) => item.confidence !== 'exact')) {
      entry.confidence = 'ambiguous';
      if (changed) {
        const loss = 'Semantic content changed after this source correspondence was captured.';
        if (!entry.losses.includes(loss)) entry.losses.push(loss);
      }
    }
    entry.elementIds = entry.elementIds.filter((id) => finalEntries.has(id));
  }
}

/** Changes to one field merge independently. Arrays other than keyed element collections
 * remain atomic, so explicit order and membership never become accidental interleavings.
 * @type {typeof import('./index.d.mts').previewDiagramMerge}
 */
export function previewDiagramMerge(base, local, remote, choices = {}) {
  const invalid = validateMergeInputs(base, local, remote, choices);
  if (invalid) return invalid;
  const conflicts = [];
  const used = new Set();
  const unresolved = [];
  function overlap(original, mine, theirs, path) {
    const id = JSON.stringify(path);
    const conflict = {
      id,
      path: [...path],
      base: original === absent ? null : clone(original),
      local: mine === absent ? null : clone(mine),
      remote: theirs === absent ? null : clone(theirs),
      present: { base: original !== absent, local: mine !== absent, remote: theirs !== absent },
    };
    conflicts.push(conflict);
    if (Object.hasOwn(choices, id)) {
      used.add(id);
      return copy(choices[id] === 'local' ? mine : theirs);
    }
    unresolved.push(id);
    return copy(theirs);
  }
  const indexes = [base, local, remote].map((bundle) => elementIndex(bundle.document));
  const structural = collectStructuralChoices(base, local, remote, indexes, overlap);
  function merge(original, mine, theirs, path) {
    if (isRootField(path, 'sourceMap')) return copy(original);
    const selected = structuralValue(path, structural);
    if (selected) return selected.value;
    if (identical(mine, theirs)) return copy(mine);
    if (identical(original, mine)) return copy(theirs);
    if (identical(original, theirs)) return copy(mine);
    if ([original, mine, theirs].every(isObject))
      return mergeObjects(original, mine, theirs, path, merge);
    const key = collectionKey(path);
    if (key && [original, mine, theirs].every(Array.isArray))
      return mergeElements(original, mine, theirs, path, key, merge);
    return overlap(original, mine, theirs, path);
  }
  const target = merge(base, local, remote, []);
  const unknown = Object.keys(choices).filter((id) => !used.has(id));
  if (unknown.length)
    return {
      ...failure(
        '$.choices',
        'stale-choices',
        'An overlap changed. Review the current comparison again.',
      ),
      conflicts,
    };
  if (unresolved.length)
    return {
      ...failure(
        '$.choices',
        'unresolved-conflict',
        'Choose a value for every overlapping change.',
      ),
      conflicts,
    };
  applyStructuralChoices(target, structural, choices, local, remote);
  retainSourceCorrespondence(target, base, local, remote, indexes);
  let sealed;
  try {
    sealed = sealBundle(target);
  } catch {
    return {
      ...failure('$.merge', 'invalid-resolution', 'These choices do not form a complete diagram.'),
      conflicts,
    };
  }
  const checked = validateAuthoringBundle(sealed);
  if (!checked.ok) return { ...checked, conflicts };
  return { ok: true, bundle: sealed, conflicts };
}
