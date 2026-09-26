import {
  DIAGRAM_AUTHORING_LIMITS,
  diagramAuthoringBundleDigest,
  diagramDocumentDigest,
  diagramPresentationDigest,
  validateDiagramAuthoringBundle,
} from '@openplanr/protocol/diagram-authoring-contracts';

export const COLLECTIONS = ['nodes', 'relations', 'groups', 'lanes', 'annotations'];
export const clone = (value) => JSON.parse(JSON.stringify(value));
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
export const same = (left, right) =>
  JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
export const diagnostic = (path, rule, detail) => ({ path, rule, detail });
/** @type {(path: string, rule: string, detail: string) => import('./index.d.mts').DiagramKernelFailure} */
export const failure = (path, rule, detail) => ({
  ok: false,
  diagnostics: [diagnostic(path, rule, detail)],
});

/** Check inert JSON before command helpers read fields, clone or hash values. */
export function inspectPlainData(value, allowedKeyPaths = []) {
  const ancestors = new Set();
  let values = 0;
  let text = 0;
  let issue;
  const reject = (path, rule, detail) => {
    issue ??= diagnostic(path, rule, detail);
  };
  function visit(current, path, depth) {
    if (issue) return;
    if (++values > DIAGRAM_AUTHORING_LIMITS.values || depth > DIAGRAM_AUTHORING_LIMITS.depth)
      return reject(path, 'resource-limit', 'Input exceeds portable data limits.');
    if (typeof current === 'string') {
      text += current.length;
      if (text > DIAGRAM_AUTHORING_LIMITS.textCodeUnits)
        reject(path, 'resource-limit', 'Input exceeds the text limit.');
      return;
    }
    if (current === null || typeof current === 'boolean') return;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) reject(path, 'finite-number', 'Numbers must be finite.');
      return;
    }
    if (typeof current !== 'object')
      return reject(path, 'plain-data', 'Only inert JSON data is accepted.');
    const proto = Object.getPrototypeOf(current);
    if (
      Array.isArray(current)
        ? proto !== Array.prototype
        : proto !== Object.prototype && proto !== null
    )
      return reject(path, 'plain-data', 'Custom prototypes are not accepted.');
    if (ancestors.has(current)) return reject(path, 'cycle', 'Cyclic input is not accepted.');
    ancestors.add(current);
    const descriptors = Object.getOwnPropertyDescriptors(current);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (
        typeof key !== 'string' ||
        key === '__proto__' ||
        (['constructor', 'prototype'].includes(key) && !allowedKeyPaths.includes(path))
      ) {
        reject(path, 'unsafe-key', 'Unsafe object key.');
        break;
      }
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, 'value')) {
        reject(path, 'accessor', 'Accessors are not accepted.');
        break;
      }
      if (Array.isArray(current) && key === 'length') continue;
      if (!descriptor.enumerable || (Array.isArray(current) && !/^(0|[1-9][0-9]*)$/u.test(key))) {
        reject(path, 'plain-data', 'Non-JSON properties are not accepted.');
        break;
      }
      visit(descriptor.value, `${path}.${key}`, depth + 1);
    }
    if (Array.isArray(current) && Object.keys(descriptors).length !== current.length + 1)
      reject(path, 'sparse-array', 'Sparse arrays are not accepted.');
    ancestors.delete(current);
  }
  try {
    visit(value, '$', 0);
  } catch {
    reject('$', 'plain-data', 'Input could not be inspected as inert JSON data.');
  }
  return issue ? [issue] : [];
}

/** @type {typeof import('./index.d.mts').validateAuthoringBundle} */
export function validateAuthoringBundle(bundle) {
  let diagnostics = inspectPlainData(bundle);
  if (!diagnostics.length) {
    try {
      diagnostics = validateDiagramAuthoringBundle(bundle);
    } catch {
      diagnostics = [
        diagnostic('$', 'plain-data', 'Bundle could not be inspected as inert JSON data.'),
      ];
    }
  }
  return { ok: diagnostics.length === 0, diagnostics };
}
export const snapshot = (bundle) => ({
  bundleDigest: bundle.bundleDigest,
  semanticDigest: bundle.document.documentDigest,
  presentationDigest: bundle.presentation.presentationDigest,
});
export const elementIndex = (document) =>
  new Map(
    COLLECTIONS.flatMap((collection) =>
      document[collection].map((value) => [value.id, { collection, value }]),
    ),
  );
export const parentIndex = (document) =>
  new Map(
    [...document.groups, ...document.lanes].flatMap((value) =>
      value.members.map((id) => [id, value.id]),
    ),
  );
export function descendants(document, ids) {
  const byId = elementIndex(document);
  const result = new Set(ids);
  const pending = [...ids];
  while (pending.length)
    for (const member of byId.get(pending.pop())?.value.members ?? [])
      if (!result.has(member)) {
        result.add(member);
        pending.push(member);
      }
  return [...result];
}
export function semanticFields(collection, value) {
  if (collection === 'document')
    return clone({
      title: value.title,
      summary: value.summary,
      audience: value.audience,
      accessibility: value.accessibility,
    });
  if (collection === 'groups' || collection === 'lanes') return { label: value.label };
  const { id: _id, ...fields } = value;
  return clone(fields);
}
export const geometryFields = ({ bounds, route, label, zIndex }) =>
  clone({ bounds, route, label, zIndex });
export const appearanceFields = ({ appearance, locks }) => clone({ appearance, locks });
export const membershipState = (document) =>
  clone({
    groups: document.groups.map(({ id, members }) => ({ id, members })),
    lanes: document.lanes.map(({ id, members }) => ({ id, members })),
    laneOrder: document.laneOrder,
  });
export function sealBundle(bundle) {
  const result = clone(bundle);
  result.document.documentDigest = diagramDocumentDigest(result.document);
  result.presentation.semanticDigest = result.document.documentDigest;
  if (result.sourceMap) result.sourceMap.semanticDigest = result.document.documentDigest;
  result.presentation.presentationDigest = diagramPresentationDigest(result.presentation);
  result.bundleDigest = diagramAuthoringBundleDigest(result);
  return result;
}
