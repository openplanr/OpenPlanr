// @ts-check
import { compileDiagramCommand, validateAuthoringBundle } from '../authoring/index.mjs';
import {
  COLLECTIONS,
  clone,
  descendants,
  inspectPlainData,
  sealBundle,
} from '../authoring/model.mjs';

/** @typedef {import('@openplanr/protocol/diagram-authoring-contracts').DiagramAuthoringBundle} DiagramAuthoringBundle */

const MAX_BYTES = 1024 * 1024;
const MAX_ELEMENTS = 1000;
/** @type {(detail: string) => import('./index.d.mts').DiagramEditorFailure} */
const fail = (detail) => ({
  ok: false,
  diagnostics: [{ path: '$clipboard', rule: 'clipboard', detail }],
});
const size = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * Return only the self-contained selected fragment. No source bytes or view data.
 * @type {typeof import('./index.d.mts').copyDiagramSelection}
 */
export function copyDiagramSelection(bundle, ids) {
  const check = validateAuthoringBundle(bundle);
  if (!check.ok) return check;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > MAX_ELEMENTS ||
    new Set(ids).size !== ids.length
  )
    return fail('Select distinct objects within the clipboard limit.');
  const known = new Set(bundle.presentation.elements.map((item) => item.elementId));
  if (ids.some((id) => typeof id !== 'string' || !known.has(id)))
    return fail('A selected object is missing.');
  const selected = new Set(descendants(bundle.document, ids));
  for (const relation of bundle.document.relations) {
    if (selected.has(relation.from) && selected.has(relation.to)) selected.add(relation.id);
    else selected.delete(relation.id);
  }
  let added = true;
  while (added) {
    added = false;
    for (const note of bundle.document.annotations)
      if (selected.has(note.targetId) && !selected.has(note.id)) {
        selected.add(note.id);
        added = true;
      }
  }
  if (!selected.size || selected.size > MAX_ELEMENTS)
    return fail('The copied fragment must contain between 1 and 1,000 objects.');
  const fragment = clone(bundle);
  fragment.originalSource = null;
  fragment.sourceMap = null;
  for (const collection of COLLECTIONS)
    fragment.document[collection] = fragment.document[collection].filter((item) =>
      selected.has(item.id),
    );
  for (const parent of [...fragment.document.groups, ...fragment.document.lanes])
    parent.members = parent.members.filter((id) => selected.has(id));
  for (const note of fragment.document.annotations)
    if (!selected.has(note.targetId)) note.targetId = null;
  fragment.document.laneOrder = fragment.document.laneOrder.filter((id) => selected.has(id));
  fragment.document.emphasis = fragment.document.emphasis.filter((item) =>
    selected.has(item.targetId),
  );
  fragment.document.accessibility.readingOrder =
    fragment.document.accessibility.readingOrder.filter((id) => selected.has(id));
  fragment.presentation.elements = fragment.presentation.elements.filter((item) =>
    selected.has(item.elementId),
  );
  const sourceBundle = sealBundle(fragment);
  const checked = validateAuthoringBundle(sourceBundle);
  if (!checked.ok) return checked;
  /** @type {import('./index.d.mts').DiagramSelectionClipboard} */
  const value = {
    kind: 'openplanr-diagram-selection',
    version: 1,
    sourceBundle,
    ids: [...selected],
  };
  if (size(value) > MAX_BYTES)
    return fail('The copied fragment exceeds 1 MiB. Copy fewer objects.');
  return { ok: true, value };
}

/**
 * Unknown fields, active resources and graph relationships are validated by the kernel.
 * @type {typeof import('./index.d.mts').pasteDiagramSelection}
 */
export function pasteDiagramSelection(bundle, input, { idMap, transactionId, dx = 24, dy = 24 }) {
  if (typeof input === 'string') {
    if (input.length > MAX_BYTES || new TextEncoder().encode(input).length > MAX_BYTES)
      return fail('The clipboard exceeds 1 MiB.');
    try {
      input = JSON.parse(input);
    } catch {
      return fail('The clipboard does not contain an OpenPlanr selection.');
    }
  }
  const fragment =
    /** @type {Partial<Record<keyof import('./index.d.mts').DiagramSelectionClipboard, unknown>> | null} */ (
      input
    );
  if (
    inspectPlainData(fragment).length ||
    !fragment ||
    fragment.kind !== 'openplanr-diagram-selection' ||
    fragment.version !== 1 ||
    Object.keys(fragment).some(
      (key) => !['kind', 'version', 'sourceBundle', 'ids'].includes(key),
    ) ||
    !Array.isArray(fragment.ids) ||
    fragment.ids.length > MAX_ELEMENTS ||
    size(fragment) > MAX_BYTES
  )
    return fail('Invalid or oversized clipboard fragment.');
  // The kernel validates the fragment's bundle along with the rest of the paste.
  const sourceBundle = /** @type {DiagramAuthoringBundle} */ (fragment.sourceBundle);
  return compileDiagramCommand(
    bundle,
    { type: 'paste', sourceBundle, ids: fragment.ids, idMap, dx, dy },
    { transactionId },
  );
}
