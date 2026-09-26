import { inverseDependencies } from './diff.mjs';
import {
  appearanceFields,
  COLLECTIONS,
  clone,
  diagnostic,
  elementIndex,
  failure,
  geometryFields,
  inspectPlainData,
  membershipState,
  same,
  sealBundle,
  semanticFields,
  snapshot,
  validateAuthoringBundle,
} from './model.mjs';
import { applyOperation, previewDiagramTransaction } from './transactions.mjs';

function record(bundle, change) {
  if (change.collection === 'source-map') return bundle.sourceMap;
  if (change.collection === 'document') return bundle.document;
  if (change.collection === 'presentation') return bundle.presentation;
  if (change.collection === 'elements')
    return (
      bundle.presentation.elements.find((value) => value.elementId === change.elementId) ?? null
    );
  if (change.collection === 'emphasis')
    return bundle.document.emphasis.find((value) => value.targetId === change.elementId) ?? null;
  return bundle.document[change.collection]?.find((value) => value.id === change.elementId) ?? null;
}
const atPath = (value, path) => path.reduce((current, key) => current?.[key], value);
function restoreChange(bundle, change, positions, emphasisOrder) {
  if (!change.path.length) {
    if (change.collection === 'source-map') {
      bundle.sourceMap = clone(change.before);
      return;
    }
    const collection =
      change.collection === 'elements'
        ? bundle.presentation.elements
        : bundle.document[change.collection];
    const key =
      change.collection === 'elements'
        ? 'elementId'
        : change.collection === 'emphasis'
          ? 'targetId'
          : 'id';
    const index = collection.findIndex((value) => value[key] === change.elementId);
    if (index >= 0) collection.splice(index, 1);
    if (change.before !== null) {
      const position = positions.find((value) => value.elementId === change.elementId);
      const requested =
        change.collection === 'emphasis'
          ? emphasisOrder.indexOf(change.elementId)
          : position?.[change.collection === 'elements' ? 'presentationIndex' : 'semanticIndex'];
      collection.splice(
        requested === undefined || requested < 0
          ? collection.length
          : Math.min(requested, collection.length),
        0,
        clone(change.before),
      );
    }
    return;
  }
  const value = record(bundle, change);
  const parent = atPath(value, change.path.slice(0, -1));
  parent[change.path.at(-1)] = clone(change.before);
}
function validateInverse(value) {
  const diagnostics = inspectPlainData(value);
  if (diagnostics.length) return diagnostics;
  const fail = (detail) => [diagnostic('$.inverse', 'inverse-shape', detail)];
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.diagramId !== 'string' ||
    typeof value.transactionId !== 'string' ||
    !value.changes ||
    !Array.isArray(value.dependencies) ||
    !Array.isArray(value.positions) ||
    !Array.isArray(value.emphasisOrder)
  )
    return fail('Expected conditional inverse data from a successful preview.');
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'diagramId',
          'transactionId',
          'changes',
          'dependencies',
          'positions',
          'emphasisOrder',
        ].includes(key),
    )
  )
    return fail('Unknown inverse field.');
  for (const name of ['semantic', 'presentation', 'sourceMap']) {
    if (!Array.isArray(value.changes[name])) return fail('Inverse change lists are required.');
    for (const change of value.changes[name])
      if (
        !change ||
        typeof change.collection !== 'string' ||
        ![
          ...COLLECTIONS,
          'document',
          'emphasis',
          'elements',
          'presentation',
          'source-map',
        ].includes(change.collection) ||
        (change.elementId !== null && typeof change.elementId !== 'string') ||
        !Array.isArray(change.path) ||
        change.path.some(
          (key) =>
            typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key),
        ) ||
        !Object.hasOwn(change, 'before') ||
        !Object.hasOwn(change, 'after')
      )
        return fail('Malformed inverse change.');
  }
  if (
    value.dependencies.some(
      (item) => !item || typeof item.elementId !== 'string' || !Object.hasOwn(item, 'value'),
    )
  )
    return fail('Malformed inverse dependency.');
  if (
    value.positions.some(
      (item) =>
        !item ||
        typeof item.elementId !== 'string' ||
        !Number.isInteger(item.semanticIndex) ||
        item.semanticIndex < 0 ||
        !Number.isInteger(item.presentationIndex) ||
        item.presentationIndex < 0,
    )
  )
    return fail('Malformed inverse insertion position.');
  return [];
}

function compileCompensation(current, target, inverse, transactionId) {
  const working = clone(current);
  const operations = [];
  const diagnostics = [];
  const add = (operation) => {
    operations.push(operation);
    applyOperation(working, operation, '$.inverse', diagnostics);
  };
  const oldEntries = elementIndex(current.document);
  const targetEntries = elementIndex(target.document);
  const targetPlacements = new Map(
    target.presentation.elements.map((value) => [value.elementId, value]),
  );
  // Unlock only already-guarded geometry temporarily. The final locks are restored
  // by the same compensating transaction; no additional authority is implied.
  const unlock = current.presentation.elements.flatMap((placement) => {
    const wanted = targetPlacements.get(placement.elementId);
    if (
      !wanted ||
      same(geometryFields(placement), geometryFields(wanted)) ||
      !Object.values(placement.locks).some(Boolean)
    )
      return [];
    return [
      {
        elementId: placement.elementId,
        before: appearanceFields(placement),
        after: {
          appearance: clone(placement.appearance),
          locks: { position: false, size: false, route: false },
        },
      },
    ];
  });
  if (unlock.length) add({ type: 'set-appearance-locks', changes: unlock });
  const removed = [...oldEntries].filter(([id]) => !targetEntries.has(id));
  if (removed.length)
    add({
      type: 'remove-elements',
      elements: removed.map(([, entry]) => clone(entry)),
      presentation: working.presentation.elements
        .filter((value) => removed.some(([id]) => id === value.elementId))
        .map(clone),
    });
  const inserted = [...targetEntries].filter(([id]) => !oldEntries.has(id));
  if (inserted.length)
    add({
      type: 'insert-elements',
      elements: inserted.map(([, entry]) => ({
        collection: entry.collection,
        value: { ...clone(entry.value), ...(entry.value.members ? { members: [] } : {}) },
      })),
      presentation: inserted.map(([id]) => clone(targetPlacements.get(id))),
      positions: inserted.map(([id, entry]) => ({
        elementId: id,
        semanticIndex: target.document[entry.collection].findIndex((value) => value.id === id),
        presentationIndex: target.presentation.elements.findIndex(
          (value) => value.elementId === id,
        ),
      })),
    });
  const workingEntries = elementIndex(working.document);
  for (const [id, entry] of targetEntries) {
    const currentEntry = workingEntries.get(id);
    if (
      !same(
        semanticFields(entry.collection, currentEntry.value),
        semanticFields(entry.collection, entry.value),
      )
    )
      add({
        type: 'update-semantics',
        collection: entry.collection,
        elementId: id,
        before: semanticFields(entry.collection, currentEntry.value),
        after: semanticFields(entry.collection, entry.value),
      });
  }
  if (!same(membershipState(working.document), membershipState(target.document)))
    add({
      type: 'set-membership-order',
      before: membershipState(working.document),
      after: membershipState(target.document),
    });
  if (
    !same(semanticFields('document', working.document), semanticFields('document', target.document))
  )
    add({
      type: 'update-semantics',
      collection: 'document',
      before: semanticFields('document', working.document),
      after: semanticFields('document', target.document),
    });
  const emphasisIds = [
    ...new Set(
      [...working.document.emphasis, ...target.document.emphasis].map((value) => value.targetId),
    ),
  ];
  // Remove first, then insert in target order to preserve exact explicit positions.
  emphasisIds.sort(
    (left, right) =>
      target.document.emphasis.findIndex((value) => value.targetId === left) -
      target.document.emphasis.findIndex((value) => value.targetId === right),
  );
  for (const id of emphasisIds) {
    const before = working.document.emphasis.find((value) => value.targetId === id)?.level ?? null;
    const after = target.document.emphasis.find((value) => value.targetId === id)?.level ?? null;
    if (before !== after)
      add({
        type: 'update-semantics',
        collection: 'emphasis',
        elementId: id,
        before,
        after,
        ...(before === null && after !== null
          ? { index: target.document.emphasis.findIndex((value) => value.targetId === id) }
          : {}),
      });
  }
  const geometry = [];
  const appearance = [];
  for (const placement of working.presentation.elements) {
    const wanted = targetPlacements.get(placement.elementId);
    if (!same(geometryFields(placement), geometryFields(wanted)))
      geometry.push({
        elementId: placement.elementId,
        before: geometryFields(placement),
        after: geometryFields(wanted),
      });
    if (!same(appearanceFields(placement), appearanceFields(wanted)))
      appearance.push({
        elementId: placement.elementId,
        before: appearanceFields(placement),
        after: appearanceFields(wanted),
      });
  }
  if (geometry.length) add({ type: 'set-geometry', changes: geometry });
  if (appearance.length) add({ type: 'set-appearance-locks', changes: appearance });
  if (!same(working.sourceMap, target.sourceMap))
    add({
      type: 'update-semantics',
      collection: 'source-map',
      before: clone(working.sourceMap),
      after: clone(target.sourceMap),
    });
  if (diagnostics.length) return { ok: false, diagnostics };
  if (!operations.length)
    return failure('$.inverse', 'no-change', 'This inverse has no remaining content change.');
  return {
    ok: true,
    transaction: {
      kind: 'diagram-edit-transaction',
      schemaVersion: '1.0.0',
      protocolVersion: '1.13.0',
      diagramId: current.diagramId,
      transactionId,
      base: snapshot(current),
      operations,
      undoOf: inverse.transactionId,
    },
  };
}

/** Rebase a compensating edit only after its changed fields and dependencies match. */
export function createConditionalInverse(current, inverse, options) {
  const checked = validateAuthoringBundle(current);
  if (!checked.ok) return checked;
  const diagnostics = [...validateInverse(inverse), ...inspectPlainData(options)];
  if (diagnostics.length) return { ok: false, diagnostics };
  if (
    !options ||
    typeof options !== 'object' ||
    Object.keys(options).some((key) => key !== 'transactionId') ||
    typeof options.transactionId !== 'string'
  )
    return failure('$.options', 'inverse-shape', 'Supply only a fresh transactionId.');
  if (current.diagramId !== inverse.diagramId)
    return failure('$.diagramId', 'diagram-id', 'Inverse belongs to a different diagram.');
  const changes = [
    ...inverse.changes.semantic,
    ...inverse.changes.presentation,
    ...inverse.changes.sourceMap,
  ];
  for (const change of changes)
    if (!same(atPath(record(current, change), change.path), change.after))
      diagnostics.push(
        diagnostic(
          `$.inverse.${change.elementId ?? change.collection}`,
          'inverse-conflict',
          'An affected field changed after the original transaction.',
        ),
      );
  const writeIds = [
    ...new Set(
      [...inverse.changes.semantic, ...inverse.changes.presentation].flatMap((change) =>
        change.elementId === null ? [] : [change.elementId],
      ),
    ),
  ];
  const actual = inverseDependencies(current, {
    readIds: inverse.dependencies.map((item) => item.elementId),
    writeIds,
  });
  if (!same(actual, inverse.dependencies))
    diagnostics.push(
      diagnostic(
        '$.inverse.dependencies',
        'inverse-conflict',
        'An affected dependency changed after the original transaction.',
      ),
    );
  if (diagnostics.length) return { ok: false, diagnostics };
  const target = clone(current);
  try {
    const structural = changes.filter((change) => !change.path.length);
    const patches = changes.filter((change) => change.path.length);
    for (const change of structural.filter((change) => change.before === null))
      restoreChange(target, change, inverse.positions, inverse.emphasisOrder);
    const inserts = structural
      .filter((change) => change.before !== null)
      .sort((a, b) => {
        const position = (change) =>
          change.collection === 'elements'
            ? inverse.positions.find((value) => value.elementId === change.elementId)
                ?.presentationIndex
            : change.collection === 'emphasis'
              ? inverse.emphasisOrder.indexOf(change.elementId)
              : inverse.positions.find((value) => value.elementId === change.elementId)
                  ?.semanticIndex;
        return (position(a) ?? 0) - (position(b) ?? 0);
      });
    for (const change of [...inserts, ...patches])
      restoreChange(target, change, inverse.positions, inverse.emphasisOrder);
  } catch {
    return failure(
      '$.inverse',
      'inverse-shape',
      'Inverse fields cannot be restored in the current diagram.',
    );
  }
  let sealed;
  try {
    sealed = sealBundle(target);
  } catch {
    return failure(
      '$.inverse',
      'inverse-shape',
      'Inverse fields do not describe a complete diagram.',
    );
  }
  const validTarget = validateAuthoringBundle(sealed);
  if (!validTarget.ok) return validTarget;
  const compiled = compileCompensation(current, sealed, inverse, options.transactionId);
  if (!compiled.ok) return compiled;
  const preview = previewDiagramTransaction(current, compiled.transaction);
  if (!preview.ok) return preview;
  if (!same(preview.bundle, sealed))
    return failure(
      '$.inverse',
      'inverse-conflict',
      'Compensation would alter content beyond the guarded inverse.',
    );
  return { ok: true, transaction: preview.transaction };
}
