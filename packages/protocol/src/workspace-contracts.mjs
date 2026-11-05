// @ts-check
import {
  DESIGN_REVIEW_BUNDLE_SCHEMA,
  DESIGN_WORKSPACE_VERSION,
} from './design-review-bundle-contracts.mjs';
import { validateJson } from './json-schema.mjs';

export { DESIGN_REVIEW_BUNDLE_SCHEMA, DESIGN_WORKSPACE_VERSION };
/** @type {typeof import('./workspace-contracts.d.mts').DESIGN_WORKSPACE_API} */
export const DESIGN_WORKSPACE_API = '/api/v1/design-workspaces';
/** @type {typeof import('./workspace-contracts.d.mts').DESIGN_WORKSPACE_MAX_BYTES} */
export const DESIGN_WORKSPACE_MAX_BYTES = 5 * 1024 * 1024;
/** @type {typeof import('./workspace-contracts.d.mts').DESIGN_WORKSPACE_MAX_EVENT_BYTES} */
export const DESIGN_WORKSPACE_MAX_EVENT_BYTES = 256 * 1024;
/** @type {typeof import('./workspace-contracts.d.mts').DESIGN_WORKSPACE_ID_PATTERN} */
export const DESIGN_WORKSPACE_ID_PATTERN = '^[A-Za-z0-9_-]{22,64}$';
const id = { type: 'string', pattern: DESIGN_WORKSPACE_ID_PATTERN };
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const b64 = { type: 'string', pattern: '^[A-Za-z0-9_-]+$' };
const epoch = { type: 'integer', minimum: 1, maximum: 2147483647 };
const cipherProperties = {
  iv: { ...b64, minLength: 16, maxLength: 16 },
  ciphertext: { ...b64, minLength: 22, maxLength: Math.ceil((DESIGN_WORKSPACE_MAX_BYTES * 4) / 3) },
};
const signature = { ...b64, minLength: 86, maxLength: 86 };
const publicKey = {
  type: 'object',
  additionalProperties: false,
  required: ['kty', 'crv', 'x', 'y'],
  properties: {
    kty: { const: 'EC' },
    crv: { const: 'P-256' },
    x: { ...b64, minLength: 43, maxLength: 43 },
    y: { ...b64, minLength: 43, maxLength: 43 },
    ext: { type: 'boolean' },
    key_ops: { type: 'array', items: { const: 'verify' }, maxItems: 1 },
  },
};
const schema = (name, properties, required = Object.keys(properties)) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `https://openplanr.dev/schemas/v1.9.0/${name}.schema.json`,
  'x-openplanr-contract': { id: name, version: '1.9.0' },
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});

/** @type {typeof import('./workspace-contracts.d.mts').DESIGN_WORKSPACE_REVISION_SCHEMA} */
export const DESIGN_WORKSPACE_REVISION_SCHEMA = schema('design-workspace-revision', {
  id,
  epoch,
  reviewOf: digest,
  createdAt: { type: 'string', format: 'date-time' },
  ...cipherProperties,
  signature,
});
/** @type {typeof import('./workspace-contracts.d.mts').DESIGN_WORKSPACE_EVENT_SCHEMA} */
export const DESIGN_WORKSPACE_EVENT_SCHEMA = schema('design-workspace-event', {
  id,
  revisionId: id,
  reviewOf: digest,
  epoch,
  ...cipherProperties,
  publicKey,
  signature,
});
const sealed = {
  type: 'object',
  additionalProperties: false,
  required: ['iv', 'ciphertext'],
  properties: cipherProperties,
};
/** @type {typeof import('./workspace-contracts.d.mts').DESIGN_WORKSPACE_CREATE_SCHEMA} */
export const DESIGN_WORKSPACE_CREATE_SCHEMA = schema('design-workspace-create', {
  schemaVersion: { const: DESIGN_WORKSPACE_VERSION },
  id,
  ownerPublicKey: publicKey,
  ownerAuthHash: digest,
  reviewerAuthHash: digest,
  epoch: { const: 1 },
  keyring: sealed,
  revision: DESIGN_WORKSPACE_REVISION_SCHEMA,
  operationId: id,
  signature,
});
/** @type {typeof import('./workspace-contracts.d.mts').DESIGN_WORKSPACE_SCHEMA} */
export const DESIGN_WORKSPACE_SCHEMA = schema('design-review-workspace', {
  schemaVersion: { const: DESIGN_WORKSPACE_VERSION },
  id,
  version: epoch,
  epoch,
  currentRevision: id,
  commentsPaused: { type: 'boolean' },
  ownerPublicKey: publicKey,
  keyring: sealed,
});

/** @returns {ReturnType<typeof import('./workspace-contracts.d.mts').assertWorkspaceContract>} */
export function assertWorkspaceContract(value, contract) {
  const errors = validateJson(value, contract);
  if (errors.length)
    throw new TypeError(
      `Invalid ${contract['x-openplanr-contract'].id}: ${errors
        .slice(0, 5)
        .map(({ path, detail }) => `${path}: ${detail}`)
        .join('; ')}`,
    );
  return value;
}

/** @type {typeof import('./workspace-contracts.d.mts').DESIGN_WORKSPACE_SCHEMAS} */
export const DESIGN_WORKSPACE_SCHEMAS = Object.freeze({
  'design-review-workspace': DESIGN_WORKSPACE_SCHEMA,
  'design-workspace-create': DESIGN_WORKSPACE_CREATE_SCHEMA,
  'design-workspace-revision': DESIGN_WORKSPACE_REVISION_SCHEMA,
  'design-workspace-event': DESIGN_WORKSPACE_EVENT_SCHEMA,
  'design-review-bundle': DESIGN_REVIEW_BUNDLE_SCHEMA,
});
