// @ts-check
import { validateJson } from './json-schema.mjs';

/**
 * The authored document version is independent of the Protocol release.
 * @type {typeof import('./design-contracts.d.mts').DESIGN_DOCUMENT_VERSION}
 */
export const DESIGN_DOCUMENT_VERSION = '1.0.0';

/** Initial viewport height for content-sized frames.
 * @type {typeof import('./design-contracts.d.mts').initialFrameHeight}
 */
export function initialFrameHeight(document) {
  const fixed = document.frames.flatMap(({ height }) =>
    typeof height === 'number' && Number.isInteger(height) ? [height] : [],
  );
  return fixed.length ? Math.max(...fixed) : 900;
}

const freeze = (value) => {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
};

const FRAME_SCHEMA = {
  type: 'array',
  minItems: 1,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'label', 'width', 'height'],
    properties: {
      id: { $ref: '#/$defs/id' },
      label: { $ref: '#/$defs/text' },
      width: { type: 'integer', minimum: 1, maximum: 16384 },
      height: { type: 'integer', minimum: 1, maximum: 16384 },
    },
  },
};

/**
 * Portable source of truth for the packaged Protocol 1.9 schema. Rendering,
 * file existence, symlink containment and revisions belong to the design domain.
 * @type {typeof import('./design-contracts.d.mts').DESIGN_DOCUMENT_V1_SCHEMA}
 */
export const DESIGN_DOCUMENT_V1_SCHEMA = freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://openplanr.dev/schemas/v1.9.0/design-document.schema.json',
  'x-openplanr-contract': { id: 'design-document', version: '1.9.0' },
  title: 'OpenPlanr authored design document',
  type: 'object',
  additionalProperties: false,
  required: [
    'kind',
    'schemaVersion',
    'id',
    'title',
    'brief',
    'frames',
    'screens',
    'screenOrder',
    'variants',
    'selectedVariant',
    'defaultView',
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
          type: 'array',
          minItems: 1,
          uniqueItems: true,
          items: { type: 'number', minimum: 0, maximum: 16384 },
        },
      },
    },
    assets: { $ref: '#/$defs/paths' },
    frames: FRAME_SCHEMA,
    screens: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
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
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'screens'],
        properties: {
          id: { $ref: '#/$defs/id' },
          title: { $ref: '#/$defs/text' },
          screens: { type: 'array', minItems: 1, items: { $ref: '#/$defs/id' } },
        },
      },
    },
    variants: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
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
      type: 'string',
      minLength: 1,
      description:
        'Path relative to the authored document directory. No URL, traversal, encoded path, query or fragment.',
      pattern: '^(?!/)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*//)(?!.*[/ ]$)[^\\\\:\\u0000-\\u001F%?#]+$',
    },
    paths: { type: 'array', items: { $ref: '#/$defs/localPath' }, uniqueItems: true },
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['html'],
      properties: {
        html: { $ref: '#/$defs/localPath' },
        styles: { $ref: '#/$defs/paths' },
        scripts: { $ref: '#/$defs/paths' },
      },
    },
  },
});

/** @type {typeof import('./design-contracts.d.mts').DESIGN_DOCUMENT_V120_SCHEMA} */
export const DESIGN_DOCUMENT_V120_SCHEMA = freeze({
  ...DESIGN_DOCUMENT_V1_SCHEMA,
  $id: 'https://openplanr.dev/schemas/v1.20.0/design-document.schema.json',
  'x-openplanr-contract': { id: 'design-document', version: '1.20.0' },
  properties: {
    .../** @type {Record<string, unknown>} */ (DESIGN_DOCUMENT_V1_SCHEMA.properties),
    frames: {
      ...FRAME_SCHEMA,
      items: {
        ...FRAME_SCHEMA.items,
        properties: {
          ...FRAME_SCHEMA.items.properties,
          height: { anyOf: [{ type: 'integer', minimum: 1, maximum: 16384 }, { const: 'auto' }] },
        },
      },
    },
    layout: {
      type: 'object',
      additionalProperties: false,
      properties: {
        boards: {
          type: 'object',
          description:
            'Keys are screenId, screenId/frameId or screenId/frameId/variantId; each ID must exist in the document.',
          additionalProperties: {
            type: 'object',
            additionalProperties: false,
            required: ['x', 'y'],
            properties: {
              x: { $ref: '#/$defs/coordinate' },
              y: { $ref: '#/$defs/coordinate' },
              title: { $ref: '#/$defs/text' },
            },
          },
        },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'x', 'y', 'text'],
            properties: {
              id: { $ref: '#/$defs/id' },
              x: { $ref: '#/$defs/coordinate' },
              y: { $ref: '#/$defs/coordinate' },
              text: { $ref: '#/$defs/text' },
              maxW: { type: 'integer', minimum: 1, maximum: 16384 },
            },
          },
        },
      },
    },
  },
  $defs: {
    .../** @type {Record<string, unknown>} */ (DESIGN_DOCUMENT_V1_SCHEMA.$defs),
    coordinate: { type: 'number', minimum: -1e7, maximum: 1e7 },
  },
});

const PROP_TOKEN_SCHEMA = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[a-z][a-z0-9-]*(?![\\s\\S])',
};
const propTokenPattern = new RegExp(PROP_TOKEN_SCHEMA.pattern, 'u');
const isPropToken = (value) =>
  typeof value === 'string' &&
  value.length <= PROP_TOKEN_SCHEMA.maxLength &&
  propTokenPattern.test(value);

const currentDocument =
  /** @type {{ properties: Record<string, unknown>; [key: string]: unknown }} */ (
    structuredClone(DESIGN_DOCUMENT_V120_SCHEMA)
  );
currentDocument.$id = 'https://openplanr.dev/schemas/v1.22.0/design-document.schema.json';
currentDocument['x-openplanr-contract'] = { id: 'design-document', version: '1.22.0' };
currentDocument.properties.schemaVersion = { enum: ['1.0.0', '1.1.0'] };
const screenSchema = /** @type {{ items: { properties: Record<string, unknown> } }} */ (
  currentDocument.properties.screens
);
screenSchema.items.properties.props = {
  type: 'object',
  propertyNames: PROP_TOKEN_SCHEMA,
  additionalProperties: {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'options', 'default'],
        properties: {
          type: { const: 'enum' },
          options: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: PROP_TOKEN_SCHEMA,
          },
          default: PROP_TOKEN_SCHEMA,
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'default'],
        properties: { type: { const: 'boolean' }, default: { type: 'boolean' } },
      },
    ],
  },
};
const variantSchema = /** @type {{ items: { properties: Record<string, unknown> } }} */ (
  currentDocument.properties.variants
);
variantSchema.items.properties.props = {
  type: 'object',
  propertyNames: { $ref: '#/$defs/id' },
  additionalProperties: {
    type: 'object',
    propertyNames: PROP_TOKEN_SCHEMA,
    additionalProperties: { anyOf: [PROP_TOKEN_SCHEMA, { type: 'boolean' }] },
  },
};
currentDocument.allOf = [
  {
    if: { properties: { schemaVersion: { const: '1.1.0' } }, required: ['schemaVersion'] },
    else: {
      properties: {
        screens: { items: { not: { required: ['props'] } } },
        variants: { items: { not: { required: ['props'] } } },
      },
    },
  },
];
/** @type {typeof import('./design-contracts.d.mts').DESIGN_DOCUMENT_SCHEMA} */
export const DESIGN_DOCUMENT_SCHEMA = freeze(currentDocument);

/** Validate prop references and values after structural validation.
 * @type {typeof import('./design-contracts.d.mts').validateDesignProps}
 */
export function validateDesignProps(document) {
  const errors = [];
  const checkToken = (value, path) => {
    if (!isPropToken(value))
      errors.push(
        `${path}: ${JSON.stringify(value)} must be a lowercase token matching ${PROP_TOKEN_SCHEMA.pattern} with at most ${PROP_TOKEN_SCHEMA.maxLength} characters`,
      );
  };
  const screens = new Map(document.screens.map((screen) => [screen.id, screen]));
  for (const [index, screen] of document.screens.entries()) {
    for (const [name, prop] of Object.entries(screen.props ?? {})) {
      const path = `$.screens[${index}].props.${name}`;
      checkToken(name, path);
      if (prop.type === 'enum') {
        for (const [optionIndex, option] of prop.options.entries())
          checkToken(option, `${path}.options[${optionIndex}]`);
        checkToken(prop.default, `${path}.default`);
        if (!prop.options.includes(prop.default))
          errors.push(`${path}.default: '${prop.default}' is not an enum option`);
      }
    }
  }
  for (const [index, variant] of document.variants.entries()) {
    for (const [screenId, values] of Object.entries(variant.props ?? {})) {
      const screen = screens.get(screenId);
      const path = `$.variants[${index}].props.${screenId}`;
      if (!screen) {
        errors.push(`${path}: unknown screen '${screenId}'`);
        continue;
      }
      for (const [name, value] of Object.entries(values)) {
        checkToken(name, `${path}.${name}`);
        if (typeof value === 'string') checkToken(value, `${path}.${name}`);
        const props = screen.props ?? {};
        const prop = Object.hasOwn(props, name) ? props[name] : undefined;
        if (!prop) errors.push(`${path}.${name}: unknown prop '${name}' on screen '${screenId}'`);
        else if (prop.type === 'boolean' && typeof value !== 'boolean')
          errors.push(`${path}.${name}: expected a boolean, received ${JSON.stringify(value)}`);
        else if (
          prop.type === 'enum' &&
          (typeof value !== 'string' || !prop.options.includes(value))
        )
          errors.push(`${path}.${name}: ${JSON.stringify(value)} is not an enum option`);
      }
    }
  }
  return errors;
}

/**
 * Validate structure plus stable identity and cross-reference constraints.
 * @returns {ReturnType<typeof import('./design-contracts.d.mts').validateDesignDocument>}
 */
export function validateDesignDocument(value) {
  const errors = validateJson(value, DESIGN_DOCUMENT_SCHEMA).map(
    ({ path, detail }) => `${path}: ${detail}`,
  );
  if (
    value?.schemaVersion === '1.0.0' &&
    ['screens', 'variants'].some(
      (field) =>
        Array.isArray(value[field]) &&
        value[field].some((item) => item && Object.hasOwn(item, 'props')),
    )
  )
    errors.push('$.schemaVersion: props require schemaVersion "1.1.0"');
  if (errors.length > 0) return { ok: false, errors };
  errors.push(...validateDesignProps(value));

  for (const field of ['frames', 'screens', 'flows', 'variants']) {
    const seen = new Set();
    for (const [index, item] of (value[field] ?? []).entries()) {
      if (seen.has(item.id))
        errors.push(`$.${field}[${index}].id: duplicate identity '${item.id}'`);
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
  const frameIds = new Set(value.frames.map(({ id }) => id));
  const variantIds = new Set(value.variants.map(({ id }) => id));
  for (const [key, position] of Object.entries(value.layout?.boards ?? {})) {
    const parts = key.split('/');
    const path = `$.layout.boards['${key}']`;
    if (parts.length > 3 || parts.some((id) => !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(id))) {
      errors.push(`${path}: expected screenId, screenId/frameId or screenId/frameId/variantId`);
    } else {
      const [screenId, frameId, variantId] = parts;
      if (!screenIds.has(screenId)) errors.push(`${path}: unknown screen '${screenId}'`);
      if (frameId !== undefined && !frameIds.has(frameId))
        errors.push(`${path}: unknown frame '${frameId}'`);
      if (variantId !== undefined && !variantIds.has(variantId))
        errors.push(`${path}: unknown variant '${variantId}'`);
    }
    for (const axis of ['x', 'y']) {
      if (!Number.isFinite(position[axis]))
        errors.push(`${path}.${axis}: expected a finite coordinate`);
    }
  }
  const sectionIds = new Set();
  for (const [index, section] of (value.layout?.sections ?? []).entries()) {
    if (sectionIds.has(section.id))
      errors.push(`$.layout.sections[${index}].id: duplicate identity '${section.id}'`);
    sectionIds.add(section.id);
    for (const axis of ['x', 'y']) {
      if (!Number.isFinite(section[axis]))
        errors.push(`$.layout.sections[${index}].${axis}: expected a finite coordinate`);
    }
  }
  const selected = value.variants.find(({ id }) => id === value.selectedVariant);
  if (!selected) errors.push(`$.selectedVariant: unknown variant '${value.selectedVariant}'`);
  else if (selected.status !== 'ready')
    errors.push('$.selectedVariant: selected variant must be ready');

  for (const [index, spacing] of (value.designSystem?.spacing ?? []).entries()) {
    if (!Number.isFinite(spacing))
      errors.push(`$.designSystem.spacing[${index}]: expected a finite spacing value`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Return the original valid document; never normalize authored design intent.
 * @returns {ReturnType<typeof import('./design-contracts.d.mts').assertDesignDocument>}
 */
export function assertDesignDocument(value) {
  const result = validateDesignDocument(value);
  if (!result.ok) throw new TypeError(`Invalid design document:\n${result.errors.join('\n')}`);
  return value;
}
