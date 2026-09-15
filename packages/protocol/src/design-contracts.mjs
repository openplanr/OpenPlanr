import { validateJson } from './json-schema.mjs';

/** The authored document version is independent of the Protocol release. */
export const DESIGN_DOCUMENT_VERSION = '1.0.0';

const freeze = (value) => {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
};

/**
 * Portable source of truth for the packaged Protocol 1.9 schema. Rendering,
 * file existence, symlink containment and revisions belong to the design domain.
 */
export const DESIGN_DOCUMENT_SCHEMA = freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://openplanr.dev/schemas/v1.9.0/design-document.schema.json',
  'x-openplanr-contract': { id: 'design-document', version: '1.9.0' },
  title: 'OpenPlanr authored design document',
  type: 'object',
  additionalProperties: false,
  required: [
    'kind', 'schemaVersion', 'id', 'title', 'brief', 'frames', 'screens',
    'screenOrder', 'variants', 'selectedVariant', 'defaultView',
  ],
  properties: {
    kind: { const: 'openplanr-design-document' },
    schemaVersion: { const: DESIGN_DOCUMENT_VERSION },
    id: { $ref: '#/$defs/id' },
    title: { $ref: '#/$defs/text' },
    brief: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'source', 'provenance'],
      properties: {
        text: { $ref: '#/$defs/text' },
        source: { enum: ['spec', 'png', 'describe'] },
        provenance: { enum: ['spec', 'inferred'] },
        references: { type: 'array', items: { $ref: '#/$defs/text' }, uniqueItems: true },
      },
    },
    designSystem: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { $ref: '#/$defs/localPath' },
        tokens: { $ref: '#/$defs/localPath' },
        spacing: {
          type: 'array', minItems: 1, uniqueItems: true,
          items: { type: 'number', minimum: 0, maximum: 16384 },
        },
      },
    },
    assets: { $ref: '#/$defs/paths' },
    frames: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'label', 'width', 'height'],
        properties: {
          id: { $ref: '#/$defs/id' },
          label: { $ref: '#/$defs/text' },
          width: { type: 'integer', minimum: 1, maximum: 16384 },
          height: { type: 'integer', minimum: 1, maximum: 16384 },
        },
      },
    },
    screens: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'title', 'source'],
        properties: {
          id: { $ref: '#/$defs/id' },
          title: { $ref: '#/$defs/text' },
          description: { $ref: '#/$defs/text' },
          source: { $ref: '#/$defs/source' },
          anchors: { $ref: '#/$defs/ids' },
        },
      },
    },
    screenOrder: { type: 'array', minItems: 1, items: { $ref: '#/$defs/id' }, uniqueItems: true },
    flows: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'title', 'screens'],
        properties: {
          id: { $ref: '#/$defs/id' },
          title: { $ref: '#/$defs/text' },
          screens: { type: 'array', minItems: 1, items: { $ref: '#/$defs/id' } },
        },
      },
    },
    variants: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'label', 'status'],
        properties: {
          id: { $ref: '#/$defs/id' },
          label: { $ref: '#/$defs/text' },
          description: { $ref: '#/$defs/text' },
          status: { enum: ['ready', 'failed'] },
          issue: { $ref: '#/$defs/text' },
          sources: { type: 'object', additionalProperties: { $ref: '#/$defs/source' } },
        },
        if: { properties: { status: { const: 'failed' } } },
        then: { required: ['issue'] },
      },
    },
    selectedVariant: { $ref: '#/$defs/id' },
    defaultView: { enum: ['canvas', 'prototype', 'walkthrough'] },
  },
  $defs: {
    id: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z][A-Za-z0-9_-]*$' },
    text: { type: 'string', minLength: 1, pattern: '\\S' },
    ids: { type: 'array', items: { $ref: '#/$defs/id' }, uniqueItems: true },
    localPath: {
      type: 'string', minLength: 1,
      description: 'Path relative to the authored document directory. No URL, traversal, encoded path, query or fragment.',
      pattern: '^(?!/)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*//)(?!.*[/ ]$)[^\\\\:\\u0000-\\u001F%?#]+$',
    },
    paths: { type: 'array', items: { $ref: '#/$defs/localPath' }, uniqueItems: true },
    source: {
      type: 'object', additionalProperties: false, required: ['html'],
      properties: {
        html: { $ref: '#/$defs/localPath' },
        styles: { $ref: '#/$defs/paths' },
        scripts: { $ref: '#/$defs/paths' },
      },
    },
  },
});

/** Validate structure plus stable identity and cross-reference constraints. */
export function validateDesignDocument(value) {
  const errors = validateJson(value, DESIGN_DOCUMENT_SCHEMA)
    .map(({ path, detail }) => `${path}: ${detail}`);
  if (errors.length > 0) return { ok: false, errors };

  for (const field of ['frames', 'screens', 'flows', 'variants']) {
    const seen = new Set();
    for (const [index, item] of (value[field] ?? []).entries()) {
      if (seen.has(item.id)) errors.push(`$.${field}[${index}].id: duplicate identity '${item.id}'`);
      seen.add(item.id);
    }
  }

  const screenIds = new Set(value.screens.map(({ id }) => id));
  const orderedIds = new Set(value.screenOrder);
  for (const id of value.screenOrder) {
    if (!screenIds.has(id)) errors.push(`$.screenOrder: unknown screen '${id}'`);
  }
  for (const id of screenIds) {
    if (!orderedIds.has(id)) errors.push(`$.screenOrder: missing screen '${id}'`);
  }
  for (const [index, flow] of (value.flows ?? []).entries()) {
    for (const id of flow.screens) {
      if (!screenIds.has(id)) errors.push(`$.flows[${index}].screens: unknown screen '${id}'`);
    }
  }
  for (const [index, variant] of value.variants.entries()) {
    for (const id of Object.keys(variant.sources ?? {})) {
      if (!screenIds.has(id)) errors.push(`$.variants[${index}].sources: unknown screen '${id}'`);
    }
  }
  const selected = value.variants.find(({ id }) => id === value.selectedVariant);
  if (!selected) errors.push(`$.selectedVariant: unknown variant '${value.selectedVariant}'`);
  else if (selected.status !== 'ready') errors.push('$.selectedVariant: selected variant must be ready');

  for (const [index, spacing] of (value.designSystem?.spacing ?? []).entries()) {
    if (!Number.isFinite(spacing)) errors.push(`$.designSystem.spacing[${index}]: expected a finite spacing value`);
  }
  return { ok: errors.length === 0, errors };
}

/** Return the original valid document; never normalize authored design intent. */
export function assertDesignDocument(value) {
  const result = validateDesignDocument(value);
  if (!result.ok) throw new TypeError(`Invalid design document:\n${result.errors.join('\n')}`);
  return value;
}
