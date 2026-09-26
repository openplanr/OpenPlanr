import { validateJson } from './json-schema.mjs';
import { DESIGN_REVIEW_BUNDLE_SCHEMA } from './workspace-contracts.mjs';
import { canonicalizeJson, sha256Hex } from './canonical-json.mjs';

const text = { type: 'string', maxLength: 16384 };
const id = { type: 'string', minLength: 1, maxLength: 128 };
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const texts = { type: 'array', maxItems: 256, items: text };
const closed = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const list = (items, maxItems = 256) => ({ type: 'array', maxItems, items });
const schema = (name, properties, required) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `https://openplanr.dev/schemas/v1.10.0/${name}.schema.json`,
  'x-openplanr-contract': { id: name, version: '1.10.0' },
  ...closed(properties, required),
});

export const DESIGN_REVIEW_CONTEXT_SCHEMA = schema(
  'design-review-context',
  {
    kind: { const: 'openplanr-design-review-context' },
    schemaVersion: { const: '1.0.0' },
    designId: id,
    brief: closed({ purpose: text, requests: { ...texts, maxItems: 3 }, audience: text }, [
      'purpose',
      'requests',
    ]),
    revisionSummary: text,
    implementation: closed({
      tokens: list(closed({ name: id, value: text, description: text }, ['name', 'value']), 512),
      components: list(
        closed(
          {
            id,
            name: text,
            screenIds: list(id),
            anchorIds: list(id),
            states: list(closed({ name: id, description: text })),
            notes: text,
            responsive: text,
            accessibility: text,
          },
          ['id', 'name'],
        ),
      ),
      responsive: texts,
      accessibility: texts,
    }),
  },
  ['kind', 'schemaVersion', 'designId', 'brief', 'implementation'],
);

export const DESIGN_FINGERPRINT_SCHEMA = closed({
  screenId: id,
  variantId: id,
  frameId: id,
  contentDigest: digest,
  guidanceDigest: digest,
});
export const DESIGN_REVIEW_BUNDLE_V11_SCHEMA = {
  ...structuredClone(DESIGN_REVIEW_BUNDLE_SCHEMA),
  $id: 'https://openplanr.dev/schemas/v1.10.0/design-review-bundle.schema.json',
  'x-openplanr-contract': { id: 'design-review-bundle', version: '1.10.0' },
};
Object.assign(DESIGN_REVIEW_BUNDLE_V11_SCHEMA.properties, {
  schemaVersion: { const: '1.1.0' },
  reviewContext: DESIGN_REVIEW_CONTEXT_SCHEMA,
  contextDigest: digest,
  fingerprints: list(DESIGN_FINGERPRINT_SCHEMA),
});
DESIGN_REVIEW_BUNDLE_V11_SCHEMA.required.push('reviewContext', 'contextDigest', 'fingerprints');

const item = closed(
  {
    pinId: id,
    reviewId: id,
    screenId: id,
    revisionId: id,
    text,
    refinement: text,
    stale: { type: 'boolean' },
    author: text,
    reviewOf: digest,
    source: text,
  },
  ['pinId', 'text'],
);
export const DESIGN_HANDOFF_CONTENT_SCHEMA = closed({
  summary: text,
  agreedChanges: list(item, 10000),
  openQuestions: list(item, 10000),
  deferred: list(item, 10000),
  rejected: list(item, 10000),
});
export const DESIGN_HANDOFF_SCHEMA = schema(
  'design-review-handoff',
  {
    kind: { const: 'openplanr-design-review-handoff' },
    schemaVersion: { const: '1.0.0' },
    title: text,
    version: { type: 'integer', minimum: 1 },
    status: { enum: ['draft', 'approved'] },
    basis: closed({
      designId: id,
      sourceRevision: digest,
      contextDigest: digest,
      reviewOf: digest,
      selectedVariant: id,
      feedbackDigest: digest,
      verificationDigest: digest,
      feedbackWatermark: { type: 'integer', minimum: 0 },
    }),
    content: DESIGN_HANDOFF_CONTENT_SCHEMA,
    contentHash: digest,
    markdown: { type: 'string', maxLength: 2097152 },
    affectedScreens: list(id),
    verificationGaps: texts,
    reviewNotes: list(closed({ reviewId: id, text }), 10000),
    approval: closed({ contentHash: digest, at: { type: 'string', format: 'date-time' } }),
  },
  [
    'kind',
    'schemaVersion',
    'title',
    'version',
    'status',
    'basis',
    'content',
    'contentHash',
    'markdown',
    'affectedScreens',
    'verificationGaps',
    'reviewNotes',
  ],
);

export const DESIGN_REVIEW_METADATA_PAYLOAD_SCHEMA = schema(
  'design-review-metadata-payload',
  {
    schemaVersion: { const: '1.0.0' },
    kind: { enum: ['category', 'disposition'] },
    author: { ...text, minLength: 1, maxLength: 160 },
    reviewOf: digest,
    pinId: id,
    category: { enum: ['question', 'suggestion', 'blocker'] },
    disposition: { enum: ['accepted', 'deferred', 'rejected'] },
    reason: text,
    updatedAt: { type: 'string', format: 'date-time' },
  },
  ['schemaVersion', 'kind', 'author', 'reviewOf', 'pinId', 'updatedAt'],
);
DESIGN_REVIEW_METADATA_PAYLOAD_SCHEMA.allOf = [
  {
    if: { properties: { kind: { const: 'category' } } },
    then: { required: ['category'], not: { required: ['disposition'] } },
  },
  {
    if: { properties: { kind: { const: 'disposition' } } },
    then: { required: ['disposition', 'reason'], not: { required: ['category'] } },
  },
];

// A request to change the product is distinct from a suggestion or a blocker.
// Keep the closed 1.0.0 payload intact for existing signed review history.
export const DESIGN_REVIEW_METADATA_PAYLOAD_V11_SCHEMA = {
  ...structuredClone(DESIGN_REVIEW_METADATA_PAYLOAD_SCHEMA),
  $id: 'https://openplanr.dev/schemas/v1.11.0/design-review-metadata-payload.schema.json',
  'x-openplanr-contract': { id: 'design-review-metadata-payload', version: '1.11.0' },
};
Object.assign(DESIGN_REVIEW_METADATA_PAYLOAD_V11_SCHEMA.properties, {
  schemaVersion: { const: '1.1.0' },
  category: { enum: ['question', 'suggestion', 'change-request', 'blocker'] },
});

export function assertReviewExperience(value, contract) {
  const errors = validateJson(value, contract);
  if (errors.length)
    throw new TypeError(
      `Invalid ${contract['x-openplanr-contract']?.id ?? 'review data'}: ${errors
        .slice(0, 4)
        .map((item) => `${item.path} ${item.detail}`)
        .join('; ')}`,
    );
  return value;
}
export function assertDesignReviewMetadata(value) {
  return assertReviewExperience(
    value,
    value?.schemaVersion === '1.1.0'
      ? DESIGN_REVIEW_METADATA_PAYLOAD_V11_SCHEMA
      : DESIGN_REVIEW_METADATA_PAYLOAD_SCHEMA,
  );
}
export function assertDesignReviewBundle(value) {
  assertReviewExperience(
    value,
    value?.schemaVersion === '1.1.0'
      ? DESIGN_REVIEW_BUNDLE_V11_SCHEMA
      : DESIGN_REVIEW_BUNDLE_SCHEMA,
  );
  if (value.schemaVersion === '1.1.0') {
    if (
      value.reviewContext.designId !== value.design.id ||
      value.contextDigest !== sha256Hex(canonicalizeJson(value.reviewContext))
    )
      throw new TypeError('Review context identity or digest does not match its published design.');
    const entries = new Set(
      value.entries.map((entry) => `${entry.screenId}:${entry.variantId}:${entry.frameId}`),
    );
    const seen = new Set();
    for (const item of value.fingerprints) {
      const key = `${item.screenId}:${item.variantId}:${item.frameId}`;
      if (!entries.has(key) || seen.has(key))
        throw new TypeError('Review fingerprints must identify distinct published artboards.');
      seen.add(key);
    }
    if (seen.size && seen.size !== entries.size)
      throw new TypeError('Review fingerprints must cover every published artboard.');
  }
  return value;
}
export const REVIEW_EXPERIENCE_SCHEMAS = Object.freeze({
  'design-review-context': DESIGN_REVIEW_CONTEXT_SCHEMA,
  'design-review-bundle': DESIGN_REVIEW_BUNDLE_V11_SCHEMA,
  'design-review-handoff': DESIGN_HANDOFF_SCHEMA,
  'design-review-metadata-payload': DESIGN_REVIEW_METADATA_PAYLOAD_SCHEMA,
});
