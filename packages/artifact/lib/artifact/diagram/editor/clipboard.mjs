import {
  clone,
  inspectPlainData,
  sealBundle,
  descendants,
  COLLECTIONS,
} from '../authoring/model.mjs';
import { validateAuthoringBundle, compileDiagramCommand } from '../authoring/index.mjs';

const MAX_BYTES = 1024 * 1024;
const MAX_ELEMENTS = 1000;
const fail = (detail) => ({
  ok: false,
  diagnostics: [{ path: '$clipboard', rule: 'clipboard', detail }],
});
const size = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

/** Return only the self-contained selected fragment. No source bytes or view data. */
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

/** Unknown fields, active resources and graph relationships are validated by the kernel. */
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
  if (
    inspectPlainData(input).length ||
    !input ||
    input.kind !== 'openplanr-diagram-selection' ||
    input.version !== 1 ||
    Object.keys(input).some((key) => !['kind', 'version', 'sourceBundle', 'ids'].includes(key)) ||
    !Array.isArray(input.ids) ||
    input.ids.length > MAX_ELEMENTS ||
    size(input) > MAX_BYTES
  )
    return fail('Invalid or oversized clipboard fragment.');
  return compileDiagramCommand(
    bundle,
    { type: 'paste', sourceBundle: input.sourceBundle, ids: input.ids, idMap, dx, dy },
    { transactionId },
  );
}
