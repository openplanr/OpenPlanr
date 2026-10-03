import { canonicalizeJson, sha256Hex } from './canonical-json.mjs';
import {
  assertDiagramAuthoringBundle,
  assertDiagramData,
  assertDiagramEditTransaction,
  copyImmutableDiagramData,
  DIAGRAM_AUTHORING_SCHEMAS,
  diagramAuthoringBundleDigest,
  sealImmutableDiagramData,
  validateDiagramAuthoringArtifact,
} from './diagram-authoring-contracts.mjs';
/** Versioned brand presentation; semantic diagram scene and historical palettes stay unchanged. */
import {
  assertDiagramReviewBundle,
  DIAGRAM_REVIEW_BUNDLE_SCHEMA,
} from './diagram-review-contracts.mjs';
import { validateJson } from './json-schema.mjs';
export const DIAGRAM_PRESENTATION_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://openplanr.dev/schemas/v1.17.0/diagram-presentation.schema.json',
  'x-openplanr-contract': { id: 'diagram-presentation', version: '1.17.0' },
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'schemaVersion', 'palette', 'theme', 'fontFamily'],
  properties: {
    kind: { const: 'openplanr-diagram-presentation' },
    schemaVersion: { const: '2.0.0' },
    palette: { const: 'openplanr-brand-v2' },
    theme: { enum: ['light', 'dark'] },
    fontFamily: { const: 'Inter' },
  },
};
export const DIAGRAM_REVIEW_BUNDLE_V11_SCHEMA = structuredClone(DIAGRAM_REVIEW_BUNDLE_SCHEMA);
Object.assign(DIAGRAM_REVIEW_BUNDLE_V11_SCHEMA, {
  $id: 'https://openplanr.dev/schemas/v1.17.0/diagram-review-bundle.schema.json',
  'x-openplanr-contract': { id: 'diagram-review-bundle', version: '1.17.0' },
});
DIAGRAM_REVIEW_BUNDLE_V11_SCHEMA.properties.schemaVersion = { const: '1.1.0' };
DIAGRAM_REVIEW_BUNDLE_V11_SCHEMA.properties.presentation = DIAGRAM_PRESENTATION_SCHEMA;
DIAGRAM_REVIEW_BUNDLE_V11_SCHEMA.required.push('presentation');
export function assertDiagramPresentation(value) {
  assertDiagramData(value);
  if (validateJson(value, DIAGRAM_PRESENTATION_SCHEMA).length)
    throw new TypeError('Invalid diagram presentation.');
  return value;
}
export function normalizeDiagramPresentation(options = {}) {
  assertDiagramData(options);
  const { theme = 'light' } = options;
  return assertDiagramPresentation({
    kind: 'openplanr-diagram-presentation',
    schemaVersion: '2.0.0',
    palette: 'openplanr-brand-v2',
    theme,
    fontFamily: 'Inter',
  });
}
export function assertDiagramReviewBundleV11(value) {
  assertDiagramData(value);
  if (validateJson(value, DIAGRAM_REVIEW_BUNDLE_V11_SCHEMA).length)
    throw new TypeError('Invalid diagram review bundle 1.1.0.');
  const { presentation, ...legacy } = value;
  assertDiagramPresentation(presentation);
  if (legacy.authored?.schemaVersion === '1.1.0') {
    assertVersionedDiagramAuthoringBundle(legacy.authored);
    if (canonicalizeJson(legacy.authored.studioPresentation) !== canonicalizeJson(presentation))
      throw new TypeError('Review and authored presentations differ.');
    legacy.authored = legacyDiagramAuthoringProjection(legacy.authored);
  }
  assertDiagramReviewBundle({ ...legacy, schemaVersion: '1.0.0' });
  return value;
}
export function assertVersionedDiagramReviewBundle(value) {
  assertDiagramData(value);
  return value?.schemaVersion === '1.1.0'
    ? assertDiagramReviewBundleV11(value)
    : assertDiagramReviewBundle(value);
}

export function versionedDiagramReviewBundleDigest(value) {
  return sha256Hex(canonicalizeJson(assertVersionedDiagramReviewBundle(value)));
}

/** Authoring 1.1 adds explicit brand palette custody without changing historical geometry themes. */
export const DIAGRAM_AUTHORING_BUNDLE_V11_SCHEMA = structuredClone(
  DIAGRAM_AUTHORING_SCHEMAS['diagram-authoring-bundle'],
);
Object.assign(DIAGRAM_AUTHORING_BUNDLE_V11_SCHEMA, {
  $id: 'https://openplanr.dev/schemas/v1.17.0/diagram-authoring-bundle.schema.json',
  'x-openplanr-contract': { id: 'diagram-authoring-bundle', version: '1.17.0' },
});
Object.assign(DIAGRAM_AUTHORING_BUNDLE_V11_SCHEMA.properties, {
  schemaVersion: { const: '1.1.0' },
  protocolVersion: { const: '1.17.0' },
  studioPresentation: DIAGRAM_PRESENTATION_SCHEMA,
});
DIAGRAM_AUTHORING_BUNDLE_V11_SCHEMA.required.push('studioPresentation');
export const DIAGRAM_EDIT_TRANSACTION_V11_SCHEMA = structuredClone(
  DIAGRAM_AUTHORING_SCHEMAS['diagram-edit-transaction'],
);
Object.assign(DIAGRAM_EDIT_TRANSACTION_V11_SCHEMA, {
  $id: 'https://openplanr.dev/schemas/v1.17.0/diagram-edit-transaction.schema.json',
  'x-openplanr-contract': { id: 'diagram-edit-transaction', version: '1.17.0' },
});
Object.assign(DIAGRAM_EDIT_TRANSACTION_V11_SCHEMA.properties, {
  schemaVersion: { const: '1.1.0' },
  protocolVersion: { const: '1.17.0' },
});
DIAGRAM_EDIT_TRANSACTION_V11_SCHEMA.properties.operations.items.oneOf.push({
  type: 'object',
  additionalProperties: false,
  required: ['type', 'before', 'after'],
  properties: {
    type: { const: 'set-studio-presentation' },
    before: { anyOf: [DIAGRAM_PRESENTATION_SCHEMA, { type: 'null' }] },
    after: { anyOf: [DIAGRAM_PRESENTATION_SCHEMA, { type: 'null' }] },
  },
});
export function legacyDiagramAuthoringProjection(value) {
  assertDiagramData(value);
  const { studioPresentation: _studio, ...legacy } = value;
  legacy.schemaVersion = '1.0.0';
  legacy.protocolVersion = '1.13.0';
  legacy.bundleDigest = diagramAuthoringBundleDigest(legacy);
  return legacy;
}
export function assertVersionedDiagramAuthoringBundle(value) {
  assertDiagramData(value);
  if (value?.schemaVersion !== '1.1.0') return assertDiagramAuthoringBundle(value);
  if (
    validateJson(value, DIAGRAM_AUTHORING_BUNDLE_V11_SCHEMA).length ||
    value.bundleDigest !== diagramAuthoringBundleDigest(value)
  )
    throw new TypeError('Invalid diagram authoring bundle 1.1.0.');
  assertDiagramPresentation(value.studioPresentation);
  assertDiagramAuthoringBundle(legacyDiagramAuthoringProjection(value));
  return value;
}
export function assertVersionedDiagramEditTransaction(value, options = {}) {
  assertDiagramData(value);
  assertDiagramData(options);
  if (value?.schemaVersion !== '1.1.0') return assertDiagramEditTransaction(value, options);
  if (validateJson(value, DIAGRAM_EDIT_TRANSACTION_V11_SCHEMA).length)
    throw new TypeError('Invalid diagram transaction 1.1.0.');
  const basis = options.baseBundle ?? options.bundle;
  if (!basis) return value;
  assertVersionedDiagramAuthoringBundle(basis);
  if (
    value.diagramId !== basis.diagramId ||
    value.base.bundleDigest !== basis.bundleDigest ||
    value.base.semanticDigest !== basis.document.documentDigest ||
    value.base.presentationDigest !== basis.presentation.presentationDigest
  )
    throw new TypeError('Studio transaction basis differs.');
  let presentation = basis.studioPresentation ?? null;
  const ordinary = [];
  for (const op of value.operations) {
    if (op.type !== 'set-studio-presentation') {
      ordinary.push(op);
      continue;
    }
    if (
      canonicalizeJson(op.before) !== canonicalizeJson(presentation) ||
      canonicalizeJson(op.after) === canonicalizeJson(presentation)
    )
      throw new TypeError('Studio presentation operation before/after differs.');
    presentation = op.after;
  }
  if (ordinary.length) {
    const legacy = legacyDiagramAuthoringProjection(basis);
    assertDiagramEditTransaction(
      {
        ...value,
        schemaVersion: '1.0.0',
        protocolVersion: '1.13.0',
        base: { ...value.base, bundleDigest: legacy.bundleDigest },
        operations: ordinary,
      },
      { baseBundle: legacy },
    );
  }
  return value;
}

DIAGRAM_REVIEW_BUNDLE_V11_SCHEMA.properties.authored = {
  oneOf: [
    DIAGRAM_REVIEW_BUNDLE_V11_SCHEMA.properties.authored,
    DIAGRAM_AUTHORING_BUNDLE_V11_SCHEMA,
  ],
};

export const versionedDiagramAuthoringBundleDigest = diagramAuthoringBundleDigest;
export function validateVersionedDiagramAuthoringBundle(value) {
  try {
    assertVersionedDiagramAuthoringBundle(value);
    return [];
  } catch (error) {
    return [{ path: '$', rule: 'diagram-authoring-contract', detail: error.message }];
  }
}
export function validateVersionedDiagramEditTransaction(value, options) {
  try {
    assertVersionedDiagramEditTransaction(value, options);
    return [];
  } catch (error) {
    return [{ path: '$', rule: 'diagram-edit-contract', detail: error.message }];
  }
}

/** Validate historical authoring artifacts against an exact versioned bundle context. */
export function validateVersionedDiagramAuthoringArtifact(kind, value, options = {}) {
  try {
    assertDiagramData(value);
    assertDiagramData(options);
  } catch (error) {
    return [{ path: '$', rule: 'diagram-authoring-contract', detail: error.message }];
  }
  if (kind === 'diagram-authoring-bundle') return validateVersionedDiagramAuthoringBundle(value);
  if (kind === 'diagram-edit-transaction' && value?.schemaVersion === '1.1.0')
    return validateVersionedDiagramEditTransaction(value, options);
  const context = options.baseBundle ?? options.bundle;
  if (context?.schemaVersion !== '1.1.0')
    return validateDiagramAuthoringArtifact(kind, value, options);
  const failures = validateVersionedDiagramAuthoringBundle(context);
  if (failures.length) return failures.map((entry) => ({ ...entry, path: '$options.bundle' }));
  if (
    options.bundle &&
    options.baseBundle &&
    canonicalizeJson(options.bundle) !== canonicalizeJson(options.baseBundle)
  )
    return [
      { path: '$options', rule: 'basis', detail: 'Conflicting bundle contexts are not accepted.' },
    ];
  const legacy = legacyDiagramAuthoringProjection(context);
  const fullSnapshot = {
    bundleDigest: context.bundleDigest,
    semanticDigest: context.document.documentDigest,
    presentationDigest: context.presentation.presentationDigest,
  };
  let invalidBasis = false;
  function project(item) {
    if (!item || typeof item !== 'object') return;
    if (
      Object.hasOwn(item, 'bundleDigest') &&
      Object.hasOwn(item, 'semanticDigest') &&
      Object.hasOwn(item, 'presentationDigest')
    ) {
      if (canonicalizeJson(item) === canonicalizeJson(fullSnapshot))
        item.bundleDigest = legacy.bundleDigest;
      else if (item.bundleDigest === legacy.bundleDigest) invalidBasis = true;
    }
    for (const child of Object.values(item)) project(child);
  }
  // First bound shape/complexity without trusting any context, then project only exact snapshots.
  const shape = validateDiagramAuthoringArtifact(kind, value);
  if (shape.length) return shape;
  const projected = structuredClone(value);
  project(projected);
  if (invalidBasis)
    return [
      {
        path: '$',
        rule: 'basis',
        detail: 'The artifact must reference the complete supplied bundle snapshot.',
      },
    ];
  const projectedOptions = {
    ...options,
    ...(options.bundle ? { bundle: legacy } : {}),
    ...(options.baseBundle ? { baseBundle: legacy } : {}),
  };
  return validateDiagramAuthoringArtifact(kind, projected, projectedOptions);
}

/** Create an internal immutable snapshot, retaining full schema, semantic and digest validation. */
export function createVersionedDiagramAuthoringSnapshot(value, previous = null) {
  const copy = copyImmutableDiagramData(value, previous);
  assertVersionedDiagramAuthoringBundle(copy);
  return copy;
}

/** Seal then fully validate one internal immutable revision; public outputs copy it. */
export function sealVersionedDiagramAuthoringSnapshot(value, previous = null) {
  const copy = sealImmutableDiagramData(value, previous);
  assertVersionedDiagramAuthoringBundle(copy);
  return copy;
}
