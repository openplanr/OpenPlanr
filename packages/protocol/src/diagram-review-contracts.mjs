// @ts-check
import { canonicalizeJson, sha256Hex } from './canonical-json.mjs';
import {
  DIAGRAM_AUTHORING_SCHEMAS,
  validateDiagramAuthoringBundle,
} from './diagram-authoring-contracts.mjs';
import { validateJson } from './json-schema.mjs';
import { DESIGN_WORKSPACE_ID_PATTERN, DESIGN_WORKSPACE_SCHEMAS } from './workspace-contracts.mjs';

/** @type {typeof import('./diagram-review-contracts.d.mts').DIAGRAM_REVIEW_VERSION} */
export const DIAGRAM_REVIEW_VERSION = '1.0.0';
/** @type {typeof import('./diagram-review-contracts.d.mts').DIAGRAM_WORKSPACE_VERSION} */
export const DIAGRAM_WORKSPACE_VERSION = '1.0.0';
/** @type {typeof import('./diagram-review-contracts.d.mts').DIAGRAM_WORKSPACE_API} */
export const DIAGRAM_WORKSPACE_API = '/api/v1/diagram-workspaces';
/** @type {typeof import('./diagram-review-contracts.d.mts').DIAGRAM_WORKSPACE_MAX_BYTES} */
export const DIAGRAM_WORKSPACE_MAX_BYTES = 5 * 1024 * 1024;
/** @type {typeof import('./diagram-review-contracts.d.mts').DIAGRAM_WORKSPACE_MAX_EVENT_BYTES} */
export const DIAGRAM_WORKSPACE_MAX_EVENT_BYTES = 256 * 1024;
/** @type {typeof import('./diagram-review-contracts.d.mts').DIAGRAM_WORKSPACE_ID_PATTERN} */
export const DIAGRAM_WORKSPACE_ID_PATTERN = DESIGN_WORKSPACE_ID_PATTERN;
const text = { type: 'string', maxLength: 8192 };
const id = { type: 'string', minLength: 1, maxLength: 160 };
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const shaDigest = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const coord = { type: 'number', minimum: 0, maximum: 1 };
const closed = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const list = (items, maxItems = 10000) => ({ type: 'array', items, maxItems });
const contract = (name, shape) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `https://openplanr.dev/schemas/v1.15.0/${name}.schema.json`,
  'x-openplanr-contract': { id: name, version: '1.15.0' },
  ...shape,
});
const item = closed({ id, label: text, kind: id, x: { type: 'number' }, y: { type: 'number' } });
const relation = closed({ id, from: id, to: id, label: text, kind: id });
/** @type {typeof import('./diagram-review-contracts.d.mts').DIAGRAM_REVIEW_BUNDLE_SCHEMA} */
export const DIAGRAM_REVIEW_BUNDLE_SCHEMA = contract(
  'diagram-review-bundle',
  closed(
    {
      kind: { const: 'openplanr-diagram-review-bundle' },
      schemaVersion: { const: '1.0.0' },
      diagramId: id,
      title: text,
      source: closed({ kind: { enum: ['manifest', 'authoring'] }, digest: shaDigest }),
      rendering: closed({ id, version: id, fontFamily: { const: 'Inter' } }),
      summary: text,
      grammar: id,
      colorScheme: { enum: ['light', 'dark'] },
      scene: closed({
        svg: { type: 'string', minLength: 1, maxLength: 5 * 1024 * 1024 },
        width: { type: 'number', exclusiveMinimum: 0, maximum: 16384 },
        height: { type: 'number', exclusiveMinimum: 0, maximum: 16384 },
        items: list(item),
        relations: list(relation),
      }),
      authored: DIAGRAM_AUTHORING_SCHEMAS['diagram-authoring-bundle'],
    },
    ['kind', 'schemaVersion', 'diagramId', 'title', 'source', 'rendering', 'scene'],
  ),
);
const feedbackBase = {
  kind: { enum: ['comment', 'reply', 'resolve'] },
  author: { ...id, maxLength: 160 },
  reviewOf: digest,
  createdAt: { type: 'string', format: 'date-time' },
  commentId: id,
};
/** @type {typeof import('./diagram-review-contracts.d.mts').DIAGRAM_REVIEW_FEEDBACK_SCHEMA} */
export const DIAGRAM_REVIEW_FEEDBACK_SCHEMA = contract('diagram-review-feedback', {
  oneOf: [
    closed({
      ...feedbackBase,
      kind: { const: 'comment' },
      body: { ...text, minLength: 1 },
      target: closed({ elementId: id, x: coord, y: coord }, []),
    }),
    closed({
      ...feedbackBase,
      kind: { const: 'reply' },
      body: { ...text, minLength: 1 },
      parentId: id,
    }),
    closed({ ...feedbackBase, kind: { const: 'resolve' }, resolved: { type: 'boolean' } }),
  ],
});
function workspaceSchema(name, original) {
  return contract(name, {
    ...structuredClone(original),
    $id: `https://openplanr.dev/schemas/v1.15.0/${name}.schema.json`,
    'x-openplanr-contract': { id: name, version: '1.15.0' },
  });
}
/** @type {typeof import('./diagram-review-contracts.d.mts').DIAGRAM_WORKSPACE_SCHEMA} */
export const DIAGRAM_WORKSPACE_SCHEMA = workspaceSchema(
  'diagram-review-workspace',
  DESIGN_WORKSPACE_SCHEMAS['design-review-workspace'],
);
/** @type {typeof import('./diagram-review-contracts.d.mts').DIAGRAM_WORKSPACE_CREATE_SCHEMA} */
export const DIAGRAM_WORKSPACE_CREATE_SCHEMA = workspaceSchema(
  'diagram-workspace-create',
  DESIGN_WORKSPACE_SCHEMAS['design-workspace-create'],
);
/** @type {typeof import('./diagram-review-contracts.d.mts').DIAGRAM_WORKSPACE_REVISION_SCHEMA} */
export const DIAGRAM_WORKSPACE_REVISION_SCHEMA = workspaceSchema(
  'diagram-workspace-revision',
  DESIGN_WORKSPACE_SCHEMAS['design-workspace-revision'],
);
/** @type {typeof import('./diagram-review-contracts.d.mts').DIAGRAM_WORKSPACE_EVENT_SCHEMA} */
export const DIAGRAM_WORKSPACE_EVENT_SCHEMA = workspaceSchema(
  'diagram-workspace-event',
  DESIGN_WORKSPACE_SCHEMAS['design-workspace-event'],
);
/** @type {typeof import('./diagram-review-contracts.d.mts').DIAGRAM_REVIEW_SCHEMAS} */
export const DIAGRAM_REVIEW_SCHEMAS = Object.freeze({
  'diagram-review-bundle': DIAGRAM_REVIEW_BUNDLE_SCHEMA,
  'diagram-review-feedback': DIAGRAM_REVIEW_FEEDBACK_SCHEMA,
  'diagram-review-workspace': DIAGRAM_WORKSPACE_SCHEMA,
  'diagram-workspace-create': DIAGRAM_WORKSPACE_CREATE_SCHEMA,
  'diagram-workspace-revision': DIAGRAM_WORKSPACE_REVISION_SCHEMA,
  'diagram-workspace-event': DIAGRAM_WORKSPACE_EVENT_SCHEMA,
});
function inert(value) {
  const seen = new Set();
  let values = 0;
  let chars = 0;
  function visit(v, depth) {
    if (++values > 200000 || depth > 64)
      throw new Error('Review data exceeds its structural limit.');
    if (typeof v === 'string') {
      chars += v.length;
      if (chars > 8 * 1024 * 1024) throw new Error('Review data exceeds its text limit.');
      return;
    }
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (typeof v !== 'object' || seen.has(v)) throw new Error('Review data must be inert JSON.');
    const proto = Object.getPrototypeOf(v);
    if (Array.isArray(v) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
      throw new Error('Custom objects are not review data.');
    seen.add(v);
    const descriptors = Object.getOwnPropertyDescriptors(v);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') throw new Error('Symbol keys are not review data.');
      const d = descriptors[key];
      if (
        typeof key !== 'string' ||
        !Object.hasOwn(d, 'value') ||
        ['__proto__', 'constructor', 'prototype'].includes(key)
      )
        throw new Error('Accessors and unsafe keys are not review data.');
      if (Array.isArray(v) && key === 'length') continue;
      if (!d.enumerable || (Array.isArray(v) && !/^(0|[1-9][0-9]*)$/u.test(key)))
        throw new Error('Review data must contain JSON properties only.');
      visit(d.value, depth + 1);
    }
    if (Array.isArray(v) && Object.keys(descriptors).length !== v.length + 1)
      throw new Error('Sparse arrays are not review data.');
    seen.delete(v);
  }
  visit(value, 0);
}
function assert(value, schema) {
  try {
    inert(value);
    const issues = validateJson(value, schema);
    if (issues.length)
      throw new Error(issues.map((issue) => issue.detail ?? issue.path).join('; '));
    return value;
  } catch (cause) {
    const error = Object.assign(
      new Error(
        `Invalid diagram review data: ${cause instanceof Error ? cause.message : 'Invalid value.'}`,
      ),
      { code: 'E_DIAGRAM_REVIEW_CONTRACT' },
    );
    error.name = 'E_DIAGRAM_REVIEW_CONTRACT';
    error.code = 'E_DIAGRAM_REVIEW_CONTRACT';
    throw error;
  }
}
/** @param {unknown} input @returns {import('./diagram-review-contracts.d.mts').DiagramReviewBundle} */
export function assertDiagramReviewBundle(input) {
  const value = /** @type {import('./diagram-review-contracts.d.mts').DiagramReviewBundle} */ (
    input
  );
  assert(value, DIAGRAM_REVIEW_BUNDLE_SCHEMA);
  const ids = new Set();
  for (const item of value.scene.items) {
    if (ids.has(item.id)) throw new Error('Diagram review element IDs must be unique.');
    ids.add(item.id);
  }
  const relations = new Set();
  for (const relation of value.scene.relations) {
    if (relations.has(relation.id) || !ids.has(relation.from) || !ids.has(relation.to))
      throw new Error('Diagram review relations must target this scene.');
    relations.add(relation.id);
  }
  if (value.source.kind === 'manifest' && value.authored)
    throw new Error('A manifest review cannot contain an authored projection.');
  if (value.source.kind === 'authoring' && !value.authored)
    throw new Error('An authored review needs its read-only projection.');
  if (value.authored) {
    if (
      value.authored.originalSource !== null ||
      value.authored.sourceMap !== null ||
      value.authored.diagramId !== value.diagramId ||
      value.authored.document.title !== value.title ||
      validateDiagramAuthoringBundle(value.authored).length
    )
      throw new Error('The authored review projection is invalid or contains source material.');
  }
  return value;
}
/** @param {unknown} input @returns {import('./diagram-review-contracts.d.mts').DiagramReviewFeedback} */
export function assertDiagramReviewFeedback(input) {
  const value = /** @type {import('./diagram-review-contracts.d.mts').DiagramReviewFeedback} */ (
    input
  );
  assert(value, DIAGRAM_REVIEW_FEEDBACK_SCHEMA);
  if (
    !value.author.trim() ||
    ('body' in value && !value.body.trim()) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value.createdAt) ||
    !Number.isFinite(Date.parse(value.createdAt))
  )
    throw new Error('Feedback needs an author, nonempty body and an ISO UTC timestamp.');
  if (
    value.kind === 'comment' &&
    Object.hasOwn(value.target, 'x') !== Object.hasOwn(value.target, 'y')
  )
    throw new Error('Diagram coordinates must be supplied as a pair.');
  return value;
}
/** @param {unknown} value @returns {string} */
export function diagramReviewBundleDigest(value) {
  return sha256Hex(canonicalizeJson(assertDiagramReviewBundle(value)));
}
/** @template T @param {T} value @param {string|Readonly<Record<string,unknown>>} schema @returns {T} */
export function assertDiagramWorkspaceContract(value, schema) {
  const descriptor = typeof schema === 'string' ? DIAGRAM_REVIEW_SCHEMAS[schema] : schema;
  if (!descriptor) throw new Error('Unknown diagram workspace contract.');
  return assert(value, descriptor);
}
