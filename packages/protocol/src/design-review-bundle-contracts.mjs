// @ts-check
import { DESIGN_DOCUMENT_V1_SCHEMA } from './design-contracts.mjs';

/** @type {typeof import('./design-review-bundle-contracts.d.mts').DESIGN_WORKSPACE_VERSION} */
export const DESIGN_WORKSPACE_VERSION = '1.0.0';

// An explicit presentation-only model. Authored paths, source provenance, and
// design-system references are deliberately not part of a published workspace.
const designProperties =
  /** @type {Record<string, { items: { properties: Record<string, unknown>; required: string[] } }>} */ (
    structuredClone(DESIGN_DOCUMENT_V1_SCHEMA.properties)
  );
for (const key of ['kind', 'schemaVersion', 'brief', 'assets', 'designSystem'])
  delete designProperties[key];
delete designProperties.screens.items.properties.source;
designProperties.screens.items.required = ['id', 'title'];
delete designProperties.variants.items.properties.sources;
/** @type {typeof import('./design-review-bundle-contracts.d.mts').DESIGN_REVIEW_BUNDLE_SCHEMA} */
export const DESIGN_REVIEW_BUNDLE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://openplanr.dev/schemas/v1.9.0/design-review-bundle.schema.json',
  'x-openplanr-contract': { id: 'design-review-bundle', version: '1.9.0' },
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { const: 'openplanr-design-review-bundle' },
    schemaVersion: { const: DESIGN_WORKSPACE_VERSION },
    design: {
      type: 'object',
      additionalProperties: false,
      properties: designProperties,
      required: [
        'id',
        'title',
        'frames',
        'screens',
        'screenOrder',
        'variants',
        'selectedVariant',
        'defaultView',
      ],
    },
    envelope: {
      type: 'object',
      required: ['schemaVersion', 'artifacts', 'viewer'],
    },
    entries: {
      type: 'array',
      minItems: 1,
      maxItems: 256,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['artifactId', 'screenId', 'variantId', 'frameId'],
        properties: Object.fromEntries(
          ['artifactId', 'screenId', 'variantId', 'frameId'].map((key) => [
            key,
            { type: 'string', minLength: 1, maxLength: 128 },
          ]),
        ),
      },
    },
    state: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        positions: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            additionalProperties: false,
            required: ['x', 'y'],
            properties: {
              x: { type: 'number', minimum: -1e7, maximum: 1e7 },
              y: { type: 'number', minimum: -1e7, maximum: 1e7 },
            },
          },
        },
      },
    },
    revision: { type: 'string', minLength: 1, maxLength: 128 },
    verification: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        status: { enum: ['verified', 'unverified', 'failed', 'pending'] },
      },
    },
  },
  required: ['kind', 'schemaVersion', 'design', 'envelope', 'entries', 'revision'],
  $defs: structuredClone(DESIGN_DOCUMENT_V1_SCHEMA.$defs),
};
