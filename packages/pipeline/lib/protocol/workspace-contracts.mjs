import { validateJson } from './json-schema.mjs';
import { DESIGN_DOCUMENT_SCHEMA } from './design-contracts.mjs';

export const DESIGN_WORKSPACE_VERSION = '1.0.0';
export const DESIGN_WORKSPACE_API = '/api/v1/design-workspaces';
export const DESIGN_WORKSPACE_MAX_BYTES = 5 * 1024 * 1024;
export const DESIGN_WORKSPACE_MAX_EVENT_BYTES = 256 * 1024;
export const DESIGN_WORKSPACE_ID_PATTERN = '^[A-Za-z0-9_-]{22,64}$';
const id = { type: 'string', pattern: DESIGN_WORKSPACE_ID_PATTERN };
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const b64 = { type: 'string', pattern: '^[A-Za-z0-9_-]+$' };
const epoch = { type: 'integer', minimum: 1, maximum: 2147483647 };
const cipherProperties = { iv: { ...b64, minLength: 16, maxLength: 16 }, ciphertext: { ...b64, minLength: 22, maxLength: Math.ceil(DESIGN_WORKSPACE_MAX_BYTES * 4 / 3) } };
const signature = { ...b64, minLength: 86, maxLength: 86 };
const publicKey = {
  type: 'object', additionalProperties: false, required: ['kty', 'crv', 'x', 'y'],
  properties: { kty: { const: 'EC' }, crv: { const: 'P-256' }, x: { ...b64, minLength: 43, maxLength: 43 }, y: { ...b64, minLength: 43, maxLength: 43 }, ext: { type: 'boolean' }, key_ops: { type: 'array', items: { const: 'verify' }, maxItems: 1 } },
};
const schema = (name, properties, required = Object.keys(properties)) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `https://openplanr.dev/schemas/v1.9.0/${name}.schema.json`,
  'x-openplanr-contract': { id: name, version: '1.9.0' },
  type: 'object', additionalProperties: false, properties, required,
});

export const DESIGN_WORKSPACE_REVISION_SCHEMA = schema('design-workspace-revision', {
  id, epoch, reviewOf: digest, createdAt: { type: 'string', format: 'date-time' }, ...cipherProperties, signature,
});
export const DESIGN_WORKSPACE_EVENT_SCHEMA = schema('design-workspace-event', {
  id, revisionId: id, reviewOf: digest, epoch, ...cipherProperties, publicKey, signature,
});
const sealed = { type: 'object', additionalProperties: false, required: ['iv', 'ciphertext'], properties: cipherProperties };
export const DESIGN_WORKSPACE_CREATE_SCHEMA = schema('design-workspace-create', {
  schemaVersion: { const: DESIGN_WORKSPACE_VERSION }, id, ownerPublicKey: publicKey,
  ownerAuthHash: digest, reviewerAuthHash: digest, epoch: { const: 1 }, keyring: sealed,
  revision: DESIGN_WORKSPACE_REVISION_SCHEMA, operationId: id, signature,
});
export const DESIGN_WORKSPACE_SCHEMA = schema('design-review-workspace', {
  schemaVersion: { const: DESIGN_WORKSPACE_VERSION }, id, version: epoch, epoch,
  currentRevision: id, commentsPaused: { type: 'boolean' }, ownerPublicKey: publicKey, keyring: sealed,
});

// An explicit presentation-only model. Authored paths, source provenance, and
// design-system references are deliberately not part of a published workspace.
const designProperties = structuredClone(DESIGN_DOCUMENT_SCHEMA.properties);
for (const key of ['kind', 'schemaVersion', 'brief', 'assets', 'designSystem']) delete designProperties[key];
delete designProperties.screens.items.properties.source;
designProperties.screens.items.required = ['id', 'title'];
delete designProperties.variants.items.properties.sources;
export const DESIGN_REVIEW_BUNDLE_SCHEMA = schema('design-review-bundle', {
  kind: { const: 'openplanr-design-review-bundle' }, schemaVersion: { const: DESIGN_WORKSPACE_VERSION },
  design: { type: 'object', additionalProperties: false, properties: designProperties, required: ['id', 'title', 'frames', 'screens', 'screenOrder', 'variants', 'selectedVariant', 'defaultView'] },
  envelope: { type: 'object', required: ['schemaVersion', 'artifacts', 'viewer'] },
  entries: { type: 'array', minItems: 1, maxItems: 256, items: { type: 'object', additionalProperties: false, required: ['artifactId', 'screenId', 'variantId', 'frameId'], properties: Object.fromEntries(['artifactId', 'screenId', 'variantId', 'frameId'].map((key) => [key, { type: 'string', minLength: 1, maxLength: 128 }])) } },
  state: {
    type: ['object', 'null'], additionalProperties: false,
    properties: {
      positions: {
        type: 'object', additionalProperties: {
          type: 'object', additionalProperties: false, required: ['x', 'y'],
          properties: { x: { type: 'number', minimum: -1e7, maximum: 1e7 }, y: { type: 'number', minimum: -1e7, maximum: 1e7 } },
        },
      },
    },
  },
  revision: { type: 'string', minLength: 1, maxLength: 128 },
  verification: { type: ['object', 'null'], additionalProperties: false, properties: { status: { enum: ['verified', 'unverified', 'failed', 'pending'] } } },
}, ['kind', 'schemaVersion', 'design', 'envelope', 'entries', 'revision']);
DESIGN_REVIEW_BUNDLE_SCHEMA.$defs = structuredClone(DESIGN_DOCUMENT_SCHEMA.$defs);

export function assertWorkspaceContract(value, contract) {
  const errors = validateJson(value, contract);
  if (errors.length) throw new TypeError(`Invalid ${contract['x-openplanr-contract'].id}: ${errors.slice(0, 5).map(({ path, detail }) => `${path}: ${detail}`).join('; ')}`);
  return value;
}

export const DESIGN_WORKSPACE_SCHEMAS = Object.freeze({
  'design-review-workspace': DESIGN_WORKSPACE_SCHEMA,
  'design-workspace-create': DESIGN_WORKSPACE_CREATE_SCHEMA,
  'design-workspace-revision': DESIGN_WORKSPACE_REVISION_SCHEMA,
  'design-workspace-event': DESIGN_WORKSPACE_EVENT_SCHEMA,
  'design-review-bundle': DESIGN_REVIEW_BUNDLE_SCHEMA,
});
