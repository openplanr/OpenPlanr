// @ts-check
import { canonicalizeJson, sha256Hex } from './canonical-json.mjs';
import { validateJson } from './json-schema.mjs';

/** @type {typeof import('./design-handoff-contracts.d.mts').DESIGN_HANDOFF_PROTOCOL_VERSION} */
export const DESIGN_HANDOFF_PROTOCOL_VERSION = '1.11.0';
/** @type {typeof import('./design-handoff-contracts.d.mts').DESIGN_HANDOFF_CONTRACT_VERSION} */
export const DESIGN_HANDOFF_CONTRACT_VERSION = '1.0.0';
/** @type {typeof import('./design-handoff-contracts.d.mts').DESIGN_HANDOFF_AUTHORITY} */
export const DESIGN_HANDOFF_AUTHORITY = 'prepare-plan';

/** @type {typeof import('./design-handoff-contracts.d.mts').DESIGN_HANDOFF_CHECK_IDS} */
export const DESIGN_HANDOFF_CHECK_IDS = Object.freeze([
  'current-revision',
  'selected-direction',
  'design-specification',
  'rendered-verification',
  'review-freshness',
  'review-dispositions',
  'unresolved-blockers',
  'approved-review-handoff',
]);

/** @type {typeof import('./design-handoff-contracts.d.mts').DESIGN_HANDOFF_SOURCE_KINDS} */
export const DESIGN_HANDOFF_SOURCE_KINDS = Object.freeze([
  'design-revision',
  'selected-direction',
  'design-specification',
  'rendered-verification',
  'review-context',
  'review-feedback',
  'review-metadata',
  'review-handoff',
  'screen',
  'frame',
  'component',
  'state',
  'flow',
  'token',
  'review-decision',
  'element-anchor',
]);

/** @type {typeof import('./design-handoff-contracts.d.mts').DESIGN_HANDOFF_REQUIREMENT_KINDS} */
export const DESIGN_HANDOFF_REQUIREMENT_KINDS = Object.freeze([
  'behavior',
  'visual-state',
  'responsive',
  'accessibility',
  'content-data-assumption',
  'constraint',
  'verification-intent',
]);

/** @type {typeof import('./design-handoff-contracts.d.mts').DESIGN_HANDOFF_CONTRACT_FILES} */
export const DESIGN_HANDOFF_CONTRACT_FILES = Object.freeze({
  'design-handoff-readiness': 'design-handoff-readiness.schema.json',
  'design-implementation-handoff': 'design-implementation-handoff.schema.json',
  'design-planning-lineage': 'design-planning-lineage.schema.json',
});

const text = { type: 'string', minLength: 1, maxLength: 16384 };
const title = { ...text, maxLength: 240 };
const id = {
  type: 'string',
  minLength: 1,
  maxLength: 160,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
};
const digest = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const relativePath = { type: 'string', minLength: 1, maxLength: 4096 };
const timestamp = { type: 'string', format: 'date-time' };
const list = (items, maxItems = 1000) => ({ type: 'array', items, maxItems });
const closed = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const contract = (name, body) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `https://openplanr.dev/schemas/v1.11.0/${name}.schema.json`,
  'x-openplanr-contract': { id: name, version: DESIGN_HANDOFF_PROTOCOL_VERSION },
  ...body,
});

const action = closed({ id, label: title });
const anchor = {
  oneOf: [
    closed({ section: id }),
    closed({ screenId: id }),
    closed({ screenId: id, elementId: id }),
    closed({ reviewId: id, pinId: id }),
  ],
};
const evidenceReference = closed(
  {
    id,
    kind: { enum: DESIGN_HANDOFF_SOURCE_KINDS },
    path: relativePath,
    revision: digest,
    digest,
    anchor,
  },
  ['id', 'kind', 'path'],
);

const readinessCheck = closed(
  {
    id: { enum: DESIGN_HANDOFF_CHECK_IDS },
    status: { enum: ['pass', 'attention', 'blocked', 'stale'] },
    message: title,
    evidenceRefs: list(id, 64),
    recoveryAction: action,
  },
  ['id', 'status', 'message', 'evidenceRefs'],
);

const readinessRecord = closed({
  kind: { const: 'openplanr-design-handoff-readiness' },
  schemaVersion: { const: DESIGN_HANDOFF_CONTRACT_VERSION },
  scope: { const: 'design-originated' },
  authority: { const: 'none' },
  designId: id,
  sourceRevision: { anyOf: [digest, { type: 'null' }] },
  selectedVariant: { anyOf: [id, { type: 'null' }] },
  status: { enum: ['ready', 'attention', 'blocked', 'stale'] },
  continuation: closed({
    action: { const: DESIGN_HANDOFF_AUTHORITY },
    available: { type: 'boolean' },
  }),
  checks: list(readinessCheck, DESIGN_HANDOFF_CHECK_IDS.length),
  evidence: list(evidenceReference, 10000),
  blockers: list({ enum: DESIGN_HANDOFF_CHECK_IDS }, DESIGN_HANDOFF_CHECK_IDS.length),
  nextActions: list(action, DESIGN_HANDOFF_CHECK_IDS.length),
});

const readinessAbsence = closed({
  kind: { const: 'openplanr-design-handoff-readiness-absence' },
  schemaVersion: { const: DESIGN_HANDOFF_CONTRACT_VERSION },
  status: { const: 'absent' },
  reason: { enum: ['not-computed', 'not-applicable', 'unavailable'] },
  message: title,
  nextAction: action,
});

/** @type {typeof import('./design-handoff-contracts.d.mts').DESIGN_HANDOFF_READINESS_SCHEMA} */
export const DESIGN_HANDOFF_READINESS_SCHEMA = contract('design-handoff-readiness', {
  oneOf: [readinessRecord, readinessAbsence],
});

const requirement = closed({
  id: { type: 'string', pattern: '^REQ-[0-9]{3,}$' },
  kind: { enum: DESIGN_HANDOFF_REQUIREMENT_KINDS },
  statement: text,
  sourceRefs: { ...list(id, 256), minItems: 1 },
  verification: { ...list(text, 256), minItems: 1 },
});

const implementationHandoff = closed(
  {
    kind: { const: 'openplanr-design-implementation-handoff' },
    schemaVersion: { const: DESIGN_HANDOFF_CONTRACT_VERSION },
    id,
    version: { type: 'integer', minimum: 1 },
    status: { enum: ['draft', 'approved', 'superseded', 'revoked'] },
    authority: { const: DESIGN_HANDOFF_AUTHORITY },
    title,
    basis: closed({
      designId: id,
      sourceRevision: digest,
      selectedVariant: id,
      readiness: closed({ status: { enum: ['ready', 'attention', 'blocked', 'stale'] }, digest }),
      reviewHandoff: closed({ version: { type: 'integer', minimum: 1 }, contentDigest: digest }),
    }),
    sources: list(evidenceReference, 10000),
    requirements: { ...list(requirement, 10000), minItems: 1 },
    contentDigest: digest,
    markdown: { type: 'string', maxLength: 2097152 },
    approval: closed({
      actorId: id,
      approvedAt: timestamp,
      contentDigest: digest,
      authority: { const: DESIGN_HANDOFF_AUTHORITY },
    }),
    supersededBy: closed({ id, version: { type: 'integer', minimum: 1 }, contentDigest: digest }),
    revocation: closed({ actorId: id, revokedAt: timestamp, reason: text }),
  },
  [
    'kind',
    'schemaVersion',
    'id',
    'version',
    'status',
    'authority',
    'title',
    'basis',
    'sources',
    'requirements',
    'contentDigest',
    'markdown',
  ],
);

implementationHandoff.allOf = [
  {
    if: { properties: { status: { const: 'approved' } }, required: ['status'] },
    then: {
      required: ['approval'],
      not: { anyOf: [{ required: ['supersededBy'] }, { required: ['revocation'] }] },
    },
  },
  {
    if: { properties: { status: { const: 'superseded' } }, required: ['status'] },
    then: { required: ['approval', 'supersededBy'], not: { required: ['revocation'] } },
  },
  {
    if: { properties: { status: { const: 'revoked' } }, required: ['status'] },
    then: { required: ['approval', 'revocation'], not: { required: ['supersededBy'] } },
  },
  {
    if: { properties: { status: { const: 'draft' } }, required: ['status'] },
    then: {
      not: {
        anyOf: [
          { required: ['approval'] },
          { required: ['supersededBy'] },
          { required: ['revocation'] },
        ],
      },
    },
  },
];

/** @type {typeof import('./design-handoff-contracts.d.mts').DESIGN_IMPLEMENTATION_HANDOFF_SCHEMA} */
export const DESIGN_IMPLEMENTATION_HANDOFF_SCHEMA = contract(
  'design-implementation-handoff',
  implementationHandoff,
);

const lineageMapping = closed({
  requirementId: { type: 'string', pattern: '^REQ-[0-9]{3,}$' },
  acceptanceRefs: {
    ...list(
      closed({
        storyId: { type: 'string', pattern: '^US-[0-9]{3,}$' },
        acceptanceId: { type: 'string', pattern: '^AC-[0-9]{3,}$' },
      }),
      256,
    ),
    minItems: 1,
  },
  taskIds: { ...list({ type: 'string', pattern: '^T-[0-9]{3,}$' }, 256), minItems: 1 },
});

/** @type {typeof import('./design-handoff-contracts.d.mts').DESIGN_PLANNING_LINEAGE_SCHEMA} */
export const DESIGN_PLANNING_LINEAGE_SCHEMA = contract(
  'design-planning-lineage',
  closed({
    kind: { const: 'openplanr-design-planning-lineage' },
    schemaVersion: { const: DESIGN_HANDOFF_CONTRACT_VERSION },
    handoff: closed({ id, version: { type: 'integer', minimum: 1 }, contentDigest: digest }),
    specId: { type: 'string', pattern: '^SPEC-[0-9]{3,}$' },
    mappings: { ...list(lineageMapping, 10000), minItems: 1 },
  }),
);

/** @type {typeof import('./design-handoff-contracts.d.mts').DESIGN_HANDOFF_SCHEMAS} */
export const DESIGN_HANDOFF_SCHEMAS = deepFreeze({
  'design-handoff-readiness': DESIGN_HANDOFF_READINESS_SCHEMA,
  'design-implementation-handoff': DESIGN_IMPLEMENTATION_HANDOFF_SCHEMA,
  'design-planning-lineage': DESIGN_PLANNING_LINEAGE_SCHEMA,
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function assertPlainData(value, depth = 0, seen = new Set()) {
  if (depth > 64) throw new TypeError('Design handoff data exceeds the maximum nesting depth.');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || seen.has(value))
    throw new TypeError('Design handoff data must be finite, acyclic JSON.');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('Design handoff data must contain only plain JSON objects.');
  seen.add(value);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (
      ['__proto__', 'prototype', 'constructor'].includes(key) ||
      !Object.hasOwn(descriptor, 'value')
    )
      throw new TypeError('Design handoff data contains a forbidden property.');
    assertPlainData(descriptor.value, depth + 1, seen);
  }
  seen.delete(value);
}

function distinct(items, select, label) {
  const values = items.map(select);
  if (new Set(values).size !== values.length) throw new TypeError(`Duplicate ${label}.`);
}

/** @type {typeof import('./design-handoff-contracts.d.mts').isDesignHandoffRelativePath} */
export function isDesignHandoffRelativePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    !/^(?:[A-Za-z]:|\/|[A-Za-z][A-Za-z0-9+.-]*:)|[\\?#%\u0000-\u001f\u007f]/u.test(value) &&
    value
      .split('/')
      .every(
        (part) =>
          part &&
          part !== '.' &&
          part !== '..' &&
          !['__proto__', 'prototype', 'constructor'].includes(part),
      )
  );
}

/** @returns {ReturnType<typeof import('./design-handoff-contracts.d.mts').assertDesignHandoffContract>} */
export function assertDesignHandoffContract(value, schemaOrName) {
  const schema =
    typeof schemaOrName === 'string' ? DESIGN_HANDOFF_SCHEMAS[schemaOrName] : schemaOrName;
  if (!schema) throw new TypeError('Unknown design handoff contract.');
  assertPlainData(value);
  canonicalizeJson(value);
  const errors = validateJson(value, schema);
  if (errors.length)
    throw new TypeError(
      `Invalid ${schema['x-openplanr-contract']?.id ?? 'design handoff data'}: ${errors
        .slice(0, 5)
        .map((error) => `${error.path} (${error.rule})`)
        .join('; ')}`,
    );
  return value;
}

function assertEvidenceReferences(evidence) {
  distinct(evidence, (item) => item.id, 'evidence reference identity');
  for (const item of evidence)
    if (!isDesignHandoffRelativePath(item.path))
      throw new TypeError('Design handoff evidence requires a repository-relative logical path.');
}

function assertProductCopy(value) {
  if (/\b(?:hash|digest|checksum|sha[- ]?256|canonical(?:ize|ization)?)\b/iu.test(value))
    throw new TypeError('Design readiness guidance must use product language.');
}

/** @returns {ReturnType<typeof import('./design-handoff-contracts.d.mts').assertDesignHandoffReadiness>} */
export function assertDesignHandoffReadiness(value) {
  assertDesignHandoffContract(value, DESIGN_HANDOFF_READINESS_SCHEMA);
  if (value.kind.endsWith('-absence')) {
    assertProductCopy(`${value.message} ${value.nextAction.label}`);
    return value;
  }
  assertEvidenceReferences(value.evidence);
  distinct(value.checks, (item) => item.id, 'readiness check identity');
  const expected = DESIGN_HANDOFF_CHECK_IDS.join('\n');
  if (value.checks.map((item) => item.id).join('\n') !== expected)
    throw new TypeError('Design readiness must contain every stable check in canonical order.');
  const evidenceIds = new Set(value.evidence.map((item) => item.id));
  for (const check of value.checks) {
    distinct(check.evidenceRefs, (item) => item, 'readiness evidence reference');
    if (check.evidenceRefs.some((reference) => !evidenceIds.has(reference)))
      throw new TypeError('Design readiness references missing evidence.');
    assertProductCopy(`${check.message} ${check.recoveryAction?.label ?? ''}`);
  }
  const priority = { pass: 0, attention: 1, blocked: 2, stale: 3 };
  const worst = value.checks.reduce(
    (current, check) => (priority[check.status] > priority[current] ? check.status : current),
    'pass',
  );
  const expectedStatus = worst === 'pass' ? 'ready' : worst;
  if (value.status !== expectedStatus)
    throw new TypeError('Design readiness summary does not match its checks.');
  const blockingIds = value.checks
    .filter((check) => ['blocked', 'stale'].includes(check.status))
    .map((check) => check.id);
  if (value.blockers.join('\n') !== blockingIds.join('\n'))
    throw new TypeError('Design readiness blockers do not match its blocking checks.');
  const actionable = value.checks.filter((check) => check.status !== 'pass');
  if (
    value.nextActions.length !== actionable.length ||
    value.nextActions.some((actionValue, index) => {
      const recoveryAction = actionable[index].recoveryAction;
      return actionValue.id !== recoveryAction?.id || actionValue.label !== recoveryAction?.label;
    })
  )
    throw new TypeError('Design readiness next actions do not match its checks.');
  if (value.continuation.available !== ['ready', 'attention'].includes(value.status))
    throw new TypeError('Design readiness continuation availability does not match its status.');
  return value;
}

/** @type {typeof import('./design-handoff-contracts.d.mts').designImplementationHandoffDigest} */
export function designImplementationHandoffDigest(value) {
  const projection = {
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    id: value.id,
    version: value.version,
    authority: value.authority,
    title: value.title,
    basis: value.basis,
    sources: value.sources,
    requirements: value.requirements,
    markdown: value.markdown,
  };
  return `sha256:${sha256Hex(canonicalizeJson(projection))}`;
}

/** @type {typeof import('./design-handoff-contracts.d.mts').assertDesignImplementationHandoff} */
export function assertDesignImplementationHandoff(value) {
  assertDesignHandoffContract(value, DESIGN_IMPLEMENTATION_HANDOFF_SCHEMA);
  assertEvidenceReferences(value.sources);
  distinct(value.requirements, (item) => item.id, 'implementation requirement identity');
  const sourceIds = new Set(value.sources.map((item) => item.id));
  for (const item of value.requirements) {
    distinct(item.sourceRefs, (reference) => reference, 'requirement source reference');
    if (item.sourceRefs.some((reference) => !sourceIds.has(reference)))
      throw new TypeError('Implementation requirement references missing evidence.');
  }
  if (value.contentDigest !== designImplementationHandoffDigest(value))
    throw new TypeError(
      'Implementation handoff content does not match its recorded integrity value.',
    );
  if (
    value.approval?.contentDigest !== undefined &&
    value.approval.contentDigest !== value.contentDigest
  )
    throw new TypeError('Implementation handoff approval does not match its content.');
  if (value.status !== 'draft' && value.basis.readiness.status !== 'ready')
    throw new TypeError(
      'Only a ready implementation handoff can be approved or retained as approved history.',
    );
  if (
    value.supersededBy &&
    value.supersededBy.id === value.id &&
    value.supersededBy.version <= value.version
  )
    throw new TypeError('A superseding handoff must identify a newer package version.');
  return value;
}

/** @type {typeof import('./design-handoff-contracts.d.mts').assertDesignPlanningLineage} */
export function assertDesignPlanningLineage(value, handoff) {
  assertDesignHandoffContract(value, DESIGN_PLANNING_LINEAGE_SCHEMA);
  distinct(value.mappings, (item) => item.requirementId, 'lineage requirement identity');
  for (const mapping of value.mappings) {
    distinct(
      mapping.acceptanceRefs,
      (item) => `${item.storyId}:${item.acceptanceId}`,
      'lineage acceptance identity',
    );
    distinct(mapping.taskIds, (item) => item, 'lineage task identity');
  }
  if (handoff) {
    assertDesignImplementationHandoff(handoff);
    if (handoff.status !== 'approved')
      throw new TypeError('Planning lineage requires an approved handoff.');
    if (
      value.handoff.id !== handoff.id ||
      value.handoff.version !== handoff.version ||
      value.handoff.contentDigest !== handoff.contentDigest
    )
      throw new TypeError('Planning lineage identifies a different handoff package.');
    const expected = handoff.requirements.map((item) => item.id).sort();
    const actual = value.mappings.map((item) => item.requirementId).sort();
    if (actual.join('\n') !== expected.join('\n'))
      throw new TypeError(
        'Planning lineage must map every implementation requirement exactly once.',
      );
  }
  return value;
}
