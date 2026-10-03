import type { VersionedDiagramAuthoringBundle as DiagramAuthoringBundle } from '@openplanr/protocol/studio-presentation-contracts';

import type { DiagramCommandResult } from '../authoring/index.mjs';
import { compileDiagramCommand, validateAuthoringBundle } from '../authoring/index.mjs';
import {
  COLLECTIONS,
  clone,
  descendants,
  inspectPlainData,
  sealBundle,
} from '../authoring/model.mjs';
import type { DiagramEditorFailure } from './session.mjs';

export interface DiagramSelectionClipboard {
  kind: 'openplanr-diagram-selection';
  version: 1;
  sourceBundle: DiagramAuthoringBundle;
  ids: string[];
}
interface DiagramSelectionPasteOptions {
  idMap: Record<string, string>;
  transactionId: string;
  dx?: number;
  dy?: number;
}

const MAX_BYTES = 1024 * 1024;
const MAX_ELEMENTS = 1000;
const fail = (detail: string): DiagramEditorFailure => ({
  ok: false,
  diagnostics: [{ path: '$clipboard', rule: 'clipboard', detail }],
});
const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/** Return only the self-contained selected fragment. No source bytes or view data. */
export function copyDiagramSelection(
  bundle: DiagramAuthoringBundle,
  ids: string[],
): { ok: true; value: DiagramSelectionClipboard } | DiagramEditorFailure {
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
      if (note.targetId !== null && selected.has(note.targetId) && !selected.has(note.id)) {
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
    fragment.document[collection].splice(
      0,
      fragment.document[collection].length,
      ...(fragment.document[collection].filter((item: { id: string }) =>
        selected.has(item.id),
      ) as never[]),
    );
  for (const parent of [...fragment.document.groups, ...fragment.document.lanes])
    parent.members = parent.members.filter((id: string) => selected.has(id));
  for (const note of fragment.document.annotations)
    if (note.targetId === null || !selected.has(note.targetId)) note.targetId = null;
  // biome-ignore format: bundles keep this one-line call; wrapping would change their bytes.
  fragment.document.laneOrder = fragment.document.laneOrder.filter((id: string) => selected.has(id));
  fragment.document.emphasis = fragment.document.emphasis.filter((item: { targetId: string }) =>
    selected.has(item.targetId),
  );
  fragment.document.accessibility.readingOrder =
    fragment.document.accessibility.readingOrder.filter((id: string) => selected.has(id));
  fragment.presentation.elements = fragment.presentation.elements.filter(
    (item: { elementId: string }) => selected.has(item.elementId),
  );
  const sourceBundle: DiagramAuthoringBundle = sealBundle(fragment);
  const checked = validateAuthoringBundle(sourceBundle);
  if (!checked.ok) return checked;
  const value: DiagramSelectionClipboard = {
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
export function pasteDiagramSelection(
  bundle: DiagramAuthoringBundle,
  input: unknown,
  { idMap, transactionId, dx = 24, dy = 24 }: DiagramSelectionPasteOptions,
): DiagramCommandResult {
  if (typeof input === 'string') {
    if (input.length > MAX_BYTES || new TextEncoder().encode(input).length > MAX_BYTES)
      return fail('The clipboard exceeds 1 MiB.');
    try {
      input = JSON.parse(input);
    } catch {
      return fail('The clipboard does not contain an OpenPlanr selection.');
    }
  }
  // Every field is checked below before the fragment is used.
  const fragment = input as Partial<Record<keyof DiagramSelectionClipboard, unknown>> | null;
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
  const sourceBundle = fragment.sourceBundle as DiagramAuthoringBundle;
  return compileDiagramCommand(
    bundle,
    { type: 'paste', sourceBundle, ids: fragment.ids, idMap, dx, dy },
    { transactionId },
  );
}
