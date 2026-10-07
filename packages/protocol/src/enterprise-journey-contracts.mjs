// @ts-check
/** Portable company revision, delivery and lifecycle contracts. Storage adapters verify authority. */
import { assertLargeObjectData } from './bounded-json-data.mjs';
import { canonicalizeJson, deepFreeze, sha256Hex } from './canonical-json.mjs';
import { ENTERPRISE_ACTIONS } from './enterprise-contracts.mjs';
import { ENTERPRISE_REVIEW_ANCHOR_V11_SCHEMA } from './enterprise-resource-contracts.mjs';
import { validateJson } from './json-schema.mjs';
import {
  assertLargeObjectContract,
  COMPANY_RESOURCE_UPLOAD_PREPARE_SCHEMA,
  COMPANY_RESOURCE_UPLOAD_RECEIPT_SCHEMA,
  COMPANY_RESOURCE_UPLOAD_STATUS_SCHEMA,
} from './large-object-contracts.mjs';

export const ENTERPRISE_JOURNEY_PROTOCOL_VERSION = '1.19.0';
const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(?![\\s\\S])' };
const revisionId = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}(?![\\s\\S])' };
const operationId = { type: 'string', pattern: '^[A-Za-z0-9_-]{22,64}(?![\\s\\S])' };
const digest = { type: 'string', pattern: '^sha256:[a-f0-9]{64}(?![\\s\\S])' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}(?![\\s\\S])' };
const timestamp = {
  type: 'string',
  format: 'date-time',
  maxLength: 40,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z(?![\\s\\S])',
};
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const positive = { ...integer, minimum: 1 };
const closed = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const list = (items, maxItems = 100, minItems = 0) => ({
  type: 'array',
  items,
  maxItems,
  minItems,
});
const scope = { organizationId: id, projectId: id };
const artifact = { ...scope, artifactId: id };
const pin = closed({ revisionId, contentDigest: digest, publicationId: id });
const envelope = (kind) => ({
  kind: { const: `openplanr-${kind}` },
  schemaVersion: { const: '1.0.0' },
  protocolVersion: { const: ENTERPRISE_JOURNEY_PROTOCOL_VERSION },
});
const schema = (name, properties, required) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `https://openplanr.dev/schemas/v1.19.0/${name}.schema.json`,
  'x-openplanr-contract': { id: name, version: ENTERPRISE_JOURNEY_PROTOCOL_VERSION },
  ...closed(properties, required),
});

export const ENTERPRISE_GUEST_INVITATION_SCHEMA = deepFreeze(
  schema('enterprise-guest-invitation', {
    ...envelope('enterprise-guest-invitation'),
    ...artifact,
    invitationId: id,
    deliveryOperationId: operationId,
    inviterId: id,
    recipientId: id,
    role: { enum: ['reviewer', 'viewer'] },
    binding: { const: 'fixed' },
    pin,
    deliveryStatus: { enum: ['queued', 'failed', 'delivered', 'expired'] },
    grantStatus: { enum: ['pending', 'active', 'denied', 'revoked'] },
    createdAt: timestamp,
    expiresAt: timestamp,
  }),
);
const guestAuthorization = schema(
  'enterprise-guest-authorization',
  {
    ...envelope('enterprise-guest-authorization'),
    ...artifact,
    authorizationId: id,
    operationId,
    invitationId: id,
    actorId: id,
    role: { enum: ['reviewer', 'viewer'] },
    binding: { const: 'fixed' },
    pin,
    status: { enum: ['pending', 'active', 'denied', 'revoked'] },
    lifecycleEpoch: positive,
    expiresAt: timestamp,
    receipt: closed({
      receiptId: id,
      operationId,
      authorizedAt: timestamp,
      publicationHeadAdvanced: { const: false },
    }),
  },
  [
    'kind',
    'schemaVersion',
    'protocolVersion',
    ...Object.keys(artifact),
    'authorizationId',
    'operationId',
    'invitationId',
    'actorId',
    'role',
    'binding',
    'pin',
    'status',
    'lifecycleEpoch',
    'expiresAt',
  ],
);
Object.assign(guestAuthorization, {
  allOf: [
    { if: { properties: { status: { const: 'active' } } }, then: { required: ['receipt'] } },
    {
      if: { properties: { status: { const: 'pending' } } },
      then: { not: { required: ['receipt'] } },
    },
  ],
});
export const ENTERPRISE_GUEST_AUTHORIZATION_SCHEMA = deepFreeze(guestAuthorization);

const projectQuery = closed({
  organizationId: id,
  actorId: id,
  scope: { const: 'projects' },
  filter: closed({
    status: { enum: ['all', 'active', 'archived'] },
    search: { type: 'string', maxLength: 240 },
  }),
});
const artifactQuery = closed({
  ...scope,
  actorId: id,
  scope: { const: 'artifacts' },
  filter: closed(
    {
      kind: { enum: ['all', 'diagram', 'design', 'artifact'] },
      contentFormat: {
        enum: [
          'all',
          'diagram-authoring',
          'design-review',
          'planning-document',
          'generic-artifact',
        ],
      },
      status: { enum: ['all', 'active', 'archived'] },
      search: { type: 'string', maxLength: 240 },
    },
    ['kind', 'status', 'search'],
  ),
});
const reviewQuery = {
  oneOf: [
    closed({
      organizationId: id,
      actorId: id,
      scope: { const: 'organization-reviews' },
      filter: artifactQuery.properties.filter,
    }),
    closed({
      ...scope,
      actorId: id,
      scope: { const: 'project-reviews' },
      filter: artifactQuery.properties.filter,
    }),
  ],
};
const query = { oneOf: [projectQuery, artifactQuery, ...reviewQuery.oneOf] };
const cursor = closed({
  token: { type: 'string', minLength: 1, maxLength: 2048 },
  queryDigest: hash,
});
const capabilities = {
  ...list({ enum: ENTERPRISE_ACTIONS }, ENTERPRISE_ACTIONS.length),
  uniqueItems: true,
};
export const ENTERPRISE_PROJECT_PAGE_SCHEMA = deepFreeze(
  schema('enterprise-project-page', {
    ...envelope('enterprise-project-page'),
    query: projectQuery,
    items: list(
      closed({
        organizationId: id,
        projectId: id,
        slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 128 },
        name: { type: 'string', minLength: 1, maxLength: 240 },
        status: { enum: ['active', 'archiving', 'archived', 'restoring'] },
        capabilities,
      }),
    ),
    nextCursor: { oneOf: [cursor, { type: 'null' }] },
  }),
);
const artifactSummary = closed({
  ...artifact,
  kind: { enum: ['diagram', 'design', 'artifact'] },
  contentFormat: {
    enum: ['diagram-authoring', 'design-review', 'planning-document', 'generic-artifact'],
  },
  title: { type: 'string', minLength: 1, maxLength: 240 },
  revisionId: { oneOf: [revisionId, { type: 'null' }] },
  status: { enum: ['active', 'archived'] },
  capabilities,
});
artifactSummary.allOf = [
  {
    if: { properties: { kind: { const: 'diagram' } } },
    then: { properties: { contentFormat: { const: 'diagram-authoring' } } },
  },
  {
    if: { properties: { kind: { const: 'design' } } },
    then: { properties: { contentFormat: { const: 'design-review' } } },
  },
  {
    if: { properties: { kind: { const: 'artifact' } } },
    then: { properties: { contentFormat: { enum: ['planning-document', 'generic-artifact'] } } },
  },
];
export const ENTERPRISE_ARTIFACT_PAGE_SCHEMA = deepFreeze(
  schema('enterprise-artifact-page', {
    ...envelope('enterprise-artifact-page'),
    query: artifactQuery,
    items: list(artifactSummary),
    nextCursor: { oneOf: [cursor, { type: 'null' }] },
  }),
);
export const ENTERPRISE_REVIEW_PROJECTION_SCHEMA = deepFreeze(
  schema('enterprise-review-projection', {
    ...envelope('enterprise-review-projection'),
    query: reviewQuery,
    items: list(
      closed({
        ...artifact,
        threadId: id,
        revisionId,
        publicationId: id,
        category: { enum: ['question', 'suggestion', 'change-request', 'blocker'] },
        status: { enum: ['open', 'addressed', 'resolved'] },
        updatedAt: timestamp,
      }),
    ),
    nextCursor: { oneOf: [cursor, { type: 'null' }] },
    index: closed({ status: { enum: ['current', 'lagging'] }, watermark: timestamp }),
  }),
);
export const ENTERPRISE_REVIEW_MENTION_SCHEMA = deepFreeze(
  schema('enterprise-review-mention', {
    ...envelope('enterprise-review-mention'),
    ...artifact,
    operationId,
    actorId: id,
    threadId: id,
    anchor: ENTERPRISE_REVIEW_ANCHOR_V11_SCHEMA,
    recipients: { ...list(id, 50, 1), uniqueItems: true },
    authority: { const: 'notification-only' },
  }),
);

export const ENTERPRISE_PROJECT_LIFECYCLE_SCHEMA = deepFreeze(
  schema(
    'enterprise-project-lifecycle',
    {
      ...envelope('enterprise-project-lifecycle'),
      ...scope,
      status: { enum: ['active', 'archiving', 'archived', 'restoring'] },
      version: integer,
      epoch: positive,
      updatedAt: timestamp,
      operation: closed({
        operationId,
        action: { enum: ['archive', 'restore'] },
        expectedVersion: integer,
        previousEpoch: positive,
        inventoryDigest: digest,
        artifactCount: integer,
        acknowledgedCount: integer,
        acknowledgedInventoryDigest: { oneOf: [digest, { type: 'null' }] },
      }),
      receipt: closed({
        receiptId: id,
        operationId,
        action: { enum: ['archive', 'restore'] },
        version: integer,
        epoch: positive,
        completedAt: timestamp,
      }),
    },
    [
      'kind',
      'schemaVersion',
      'protocolVersion',
      'organizationId',
      'projectId',
      'status',
      'version',
      'epoch',
      'updatedAt',
    ],
  ),
);
export const ENTERPRISE_PROJECT_TRANSITION_SCHEMA = deepFreeze(
  schema('enterprise-project-transition', {
    ...envelope('enterprise-project-transition'),
    ...scope,
    operationId,
    actorId: id,
    action: { enum: ['archive', 'restore'] },
    expectedVersion: integer,
    expectedEpoch: positive,
  }),
);
export const ENTERPRISE_JOURNEY_FEATURES = Object.freeze([
  'resource-draft',
  'resource-publication',
  'fixed-guest',
  'project-lifecycle',
  'review-mentions',
  'scoped-pages',
]);
export const ENTERPRISE_JOURNEY_READER_REQUIREMENTS = deepFreeze({
  'resource-draft': ['resource-draft', 'project-lifecycle'],
  'resource-publication': ['resource-publication', 'fixed-guest', 'project-lifecycle'],
  'fixed-guest': ['fixed-guest', 'project-lifecycle'],
  'project-lifecycle': ['project-lifecycle'],
  'review-mentions': ['review-mentions', 'fixed-guest', 'project-lifecycle'],
  'scoped-pages': ['scoped-pages'],
});
export const ENTERPRISE_JOURNEY_CAPABILITIES_SCHEMA = deepFreeze(
  schema('enterprise-journey-capabilities', {
    ...envelope('enterprise-journey-capabilities'),
    readers: { ...list({ enum: ENTERPRISE_JOURNEY_FEATURES }, 6), uniqueItems: true },
    writers: { ...list({ enum: ENTERPRISE_JOURNEY_FEATURES }, 6), uniqueItems: true },
    rollbackFloor: closed({
      protocolVersion: { const: '1.19.0' },
      serviceVersion: id,
      candidateDigest: digest,
    }),
  }),
);

function resourceSuccessor(source, name) {
  const result = structuredClone(source);
  result.$id = `https://openplanr.dev/schemas/v1.19.0/${name}.schema.json`;
  result['x-openplanr-contract'] = { id: name, version: '1.19.0' };
  result.properties.schemaVersion = { const: '2.1.0' };
  result.properties.protocolVersion = { const: '1.19.0' };
  result.required.push('protocolVersion');
  return result;
}
const intent = { enum: ['draft', 'publish'] };
const prepare = resourceSuccessor(
  COMPANY_RESOURCE_UPLOAD_PREPARE_SCHEMA,
  'company-resource-upload-prepare',
);
Object.assign(prepare.properties, { intent, expectedVersion: integer, lifecycleEpoch: positive });
prepare.required.push('intent', 'expectedVersion', 'lifecycleEpoch');
export const COMPANY_RESOURCE_UPLOAD_PREPARE_V21_SCHEMA = deepFreeze(prepare);
const receipt = resourceSuccessor(
  COMPANY_RESOURCE_UPLOAD_RECEIPT_SCHEMA,
  'company-resource-upload-receipt',
);
Object.assign(receipt.properties, {
  intent,
  baseRevisionId: prepare.properties.baseRevisionId,
  version: positive,
  lifecycleEpoch: positive,
  effect: {
    oneOf: [
      closed({
        kind: { const: 'draft' },
        authorHeadRevisionId: revisionId,
        publicationHeadUnchanged: { const: true },
      }),
      closed({
        kind: { const: 'publication' },
        authorHeadRevisionId: revisionId,
        publicationId: id,
        publicationRevisionId: revisionId,
      }),
    ],
  },
});
receipt.required.push('intent', 'baseRevisionId', 'version', 'lifecycleEpoch', 'effect');
receipt.allOf = [
  {
    if: { properties: { intent: { const: 'draft' } } },
    then: { properties: { effect: { properties: { kind: { const: 'draft' } } } } },
    else: { properties: { effect: { properties: { kind: { const: 'publication' } } } } },
  },
];
export const COMPANY_RESOURCE_UPLOAD_RECEIPT_V21_SCHEMA = deepFreeze(receipt);
const status = resourceSuccessor(
  COMPANY_RESOURCE_UPLOAD_STATUS_SCHEMA,
  'company-resource-upload-status',
);
Object.assign(status.properties, {
  intent,
  revisionId: operationId,
  manifestSha256: hash,
  expiresAt: timestamp,
  lifecycleEpoch: positive,
  status: { enum: ['prepared', 'committed', 'cancelled', 'expired'] },
  receipt: COMPANY_RESOURCE_UPLOAD_RECEIPT_V21_SCHEMA,
});
status.required.push('intent', 'revisionId', 'manifestSha256', 'expiresAt', 'lifecycleEpoch');
status.allOf = [
  {
    if: { properties: { status: { const: 'committed' } } },
    then: { required: ['receipt'] },
    else: { not: { required: ['receipt'] } },
  },
];
export const COMPANY_RESOURCE_UPLOAD_STATUS_V21_SCHEMA = deepFreeze(status);

export const ENTERPRISE_JOURNEY_SCHEMAS = deepFreeze({
  'enterprise-guest-invitation': ENTERPRISE_GUEST_INVITATION_SCHEMA,
  'enterprise-guest-authorization': ENTERPRISE_GUEST_AUTHORIZATION_SCHEMA,
  'enterprise-project-page': ENTERPRISE_PROJECT_PAGE_SCHEMA,
  'enterprise-artifact-page': ENTERPRISE_ARTIFACT_PAGE_SCHEMA,
  'enterprise-review-projection': ENTERPRISE_REVIEW_PROJECTION_SCHEMA,
  'enterprise-review-mention': ENTERPRISE_REVIEW_MENTION_SCHEMA,
  'enterprise-project-lifecycle': ENTERPRISE_PROJECT_LIFECYCLE_SCHEMA,
  'enterprise-project-transition': ENTERPRISE_PROJECT_TRANSITION_SCHEMA,
  'enterprise-journey-capabilities': ENTERPRISE_JOURNEY_CAPABILITIES_SCHEMA,
  'company-resource-upload-prepare': COMPANY_RESOURCE_UPLOAD_PREPARE_V21_SCHEMA,
  'company-resource-upload-receipt': COMPANY_RESOURCE_UPLOAD_RECEIPT_V21_SCHEMA,
  'company-resource-upload-status': COMPANY_RESOURCE_UPLOAD_STATUS_V21_SCHEMA,
});

/** Structural and identity consistency only; current authenticated records come from the adapter. */
export function assertEnterpriseJourneyContract(value, kind) {
  assertLargeObjectData(value);
  const selected = Object.hasOwn(ENTERPRISE_JOURNEY_SCHEMAS, kind)
    ? ENTERPRISE_JOURNEY_SCHEMAS[kind]
    : null;
  if (!selected) throw new TypeError('Unknown company journey contract.');
  const errors = validateJson(value, selected);
  if (errors.length) throw new TypeError(`Invalid ${kind}: ${errors[0].path} ${errors[0].detail}`);
  assertCalendarTimestamps(value);
  const check = semanticChecks[kind];
  if (check) check(value);
  return value;
}
// JSON Schema date-time checks are lexical; reject impossible calendar dates too.
function assertCalendarTimestamps(value) {
  for (const [key, nested] of Object.entries(value)) {
    if (key.endsWith('At') || key === 'watermark') {
      const time = Date.parse(nested);
      if (
        !Number.isFinite(time) ||
        new Date(time).toISOString().replace('.000Z', 'Z') !== nested.replace('.000Z', 'Z')
      )
        throw new TypeError('Expected an actual UTC calendar timestamp.');
    } else if (nested && typeof nested === 'object') assertCalendarTimestamps(nested);
  }
}
const semanticChecks = {
  'enterprise-guest-invitation': (value) => {
    if (Date.parse(value.expiresAt) <= Date.parse(value.createdAt))
      throw new TypeError('Invitation expiry must follow creation.');
  },
  'enterprise-guest-authorization': (value) => {
    if (value.receipt && value.receipt.operationId !== value.operationId)
      throw new TypeError('Guest authorization needs its exact receipt.');
  },
  'enterprise-project-page': assertPage,
  'enterprise-artifact-page': assertPage,
  'enterprise-review-projection': assertPage,
  'enterprise-project-lifecycle': assertLifecycle,
  'enterprise-journey-capabilities': (value) => {
    if (
      value.writers.some((feature) =>
        ENTERPRISE_JOURNEY_READER_REQUIREMENTS[feature].some(
          (reader) => !value.readers.includes(reader),
        ),
      )
    )
      throw new TypeError('A writer requires its compatible reader.');
  },
  'company-resource-upload-prepare': (value) =>
    assertLargeObjectContract(value.manifest, 'company-resource-manifest'),
  'company-resource-upload-receipt': assertResourceReceipt,
  'company-resource-upload-status': assertResourceStatus,
};
function assertPage(value) {
  if (value.nextCursor && value.nextCursor.queryDigest !== enterprisePageQueryDigest(value.query))
    throw new TypeError('Cursor does not match the selected actor, project and filters.');
  if (
    value.items.some(
      (item) =>
        item.organizationId !== value.query.organizationId ||
        (value.query.projectId && item.projectId !== value.query.projectId),
    )
  )
    throw new TypeError('Page contains another project.');
}
function assertResourceReceipt(value) {
  if (
    (value.intent === 'draft') !== (value.effect.kind === 'draft') ||
    value.effect.authorHeadRevisionId !== value.revisionId ||
    (value.intent === 'publish' && value.effect.publicationRevisionId !== value.revisionId)
  )
    throw new TypeError('Commit effect does not match the exact revision and intent.');
}
function assertResourceStatus(value) {
  if (new Set(value.receivedChunks.map((part) => part.index)).size !== value.receivedChunks.length)
    throw new TypeError('Upload status has repeated chunks.');
  if (!value.receipt) return;
  assertEnterpriseJourneyContract(value.receipt, 'company-resource-upload-receipt');
  if (
    ['operationId', 'revisionId', 'manifestSha256', 'intent', 'lifecycleEpoch'].some(
      (key) => value[key] !== value.receipt[key],
    )
  )
    throw new TypeError('Upload status identity differs from its receipt.');
}
function sameScope(left, right) {
  return ['organizationId', 'projectId'].every((key) => left[key] === right[key]);
}
function assertLifecycle(value) {
  const { operation, receipt: completed } = value;
  if (['archiving', 'restoring', 'archived'].includes(value.status) && !operation)
    throw new TypeError('A lifecycle transition needs its durable operation.');
  if (!operation) {
    if (completed) throw new TypeError('A lifecycle receipt needs its operation.');
    return;
  }
  if (
    value.epoch !== operation.previousEpoch + 1 ||
    value.version !== operation.expectedVersion + (completed ? 2 : 1)
  )
    throw new TypeError('Lifecycle epoch or version differs from its transition.');
  if (
    operation.acknowledgedCount > operation.artifactCount ||
    (operation.acknowledgedInventoryDigest !== null &&
      operation.acknowledgedInventoryDigest !== operation.inventoryDigest)
  )
    throw new TypeError('Barrier acknowledgements differ from the frozen inventory.');
  const terminal = value.status === 'archived' || value.status === 'active';
  if (
    terminal !== Boolean(completed) ||
    (operation.action === 'archive') !== ['archiving', 'archived'].includes(value.status)
  )
    throw new TypeError('Lifecycle status differs from its operation.');
  if (completed) assertLifecycleReceipt(value, operation, completed);
}
function assertLifecycleReceipt(value, operation, completed) {
  if (
    operation.acknowledgedCount !== operation.artifactCount ||
    operation.acknowledgedInventoryDigest !== operation.inventoryDigest ||
    ['operationId', 'action'].some((key) => completed[key] !== operation[key]) ||
    ['epoch', 'version'].some((key) => completed[key] !== value[key])
  )
    throw new TypeError('Lifecycle completion needs all barriers and its exact receipt.');
}
export function enterprisePageQueryDigest(value) {
  assertLargeObjectData(value);
  const errors = validateJson(value, query);
  if (errors.length) throw new TypeError('Invalid scoped page query.');
  return sha256Hex(canonicalizeJson(value));
}
/** Fail closed before any new-mode bytes are sent. Deployment readiness is verified separately. */
export function assertEnterpriseJourneyWrite(capabilities, feature) {
  assertEnterpriseJourneyContract(capabilities, 'enterprise-journey-capabilities');
  if (!capabilities.writers.includes(feature) || !capabilities.readers.includes(feature))
    throw new TypeError('The selected company write mode is not supported.');
  return feature;
}
/** Exact upload retries cannot change intent, basis, scope, epoch or frozen bytes. */
export function assertCompanyResourcePreparationRetry(previous, next) {
  for (const value of [previous, next])
    assertEnterpriseJourneyContract(value, 'company-resource-upload-prepare');
  if (canonicalizeJson(previous) !== canonicalizeJson(next))
    throw new TypeError('A prepared upload identity cannot change.');
  return next;
}
/** Authenticated recipient eligibility is supplied by the server for this exact anchored revision. */
export function assertEnterpriseMentionRecipients(value, authorization) {
  assertEnterpriseJourneyContract(value, 'enterprise-review-mention');
  assertLargeObjectData(authorization);
  if (
    !sameScope(value, authorization) ||
    value.artifactId !== authorization.artifactId ||
    value.anchor.revisionId !== authorization.revisionId ||
    value.actorId !== authorization.actorId ||
    !Array.isArray(authorization.recipientIds) ||
    value.recipients.some((entry) => !authorization.recipientIds.includes(entry))
  )
    throw new TypeError('Mention recipients are not authorized on the anchored revision.');
  return value;
}
/** No following-head fallback is permitted for a fixed guest. */
export function assertEnterpriseFixedGuestAccess(value, requested, now) {
  assertEnterpriseJourneyContract(value, 'enterprise-guest-authorization');
  assertLargeObjectData(requested);
  if (
    !Number.isFinite(Date.parse(now)) ||
    value.status !== 'active' ||
    Date.parse(value.expiresAt) <= Date.parse(now) ||
    !sameScope(value, requested) ||
    value.artifactId !== requested.artifactId ||
    value.actorId !== requested.actorId ||
    value.lifecycleEpoch !== requested.lifecycleEpoch ||
    ['revisionId', 'contentDigest', 'publicationId'].some(
      (key) => value.pin[key] !== requested[key],
    )
  )
    throw new TypeError('Guest access requires the exact active authorized publication.');
  return value.pin;
}
/** The adapter rechecks this admission before delivering newly requested content. */
export function enterpriseProjectAdmission(value, epoch) {
  assertEnterpriseJourneyContract(value, 'enterprise-project-lifecycle');
  return value.status === 'active' && value.epoch === epoch;
}

/** Compare the command with the loaded lifecycle; the service must serialize the transition. */
export function assertEnterpriseProjectTransition(value, current) {
  assertEnterpriseJourneyContract(value, 'enterprise-project-transition');
  assertEnterpriseJourneyContract(current, 'enterprise-project-lifecycle');
  if (
    !sameScope(value, current) ||
    value.expectedVersion !== current.version ||
    value.expectedEpoch !== current.epoch ||
    (value.action === 'archive' ? current.status !== 'active' : current.status !== 'archived')
  )
    throw new TypeError('Project lifecycle changed; reload before transitioning.');
  return value;
}
/** The commit adapter compares this receipt with its already frozen preparation. */
export function assertCompanyResourceCommitReceipt(value, preparation) {
  assertEnterpriseJourneyContract(value, 'company-resource-upload-receipt');
  assertEnterpriseJourneyContract(preparation, 'company-resource-upload-prepare');
  if (
    !sameScope(value, preparation.manifest) ||
    value.artifactId !== preparation.manifest.artifactId ||
    value.operationId !== preparation.operationId ||
    value.baseRevisionId !== preparation.baseRevisionId ||
    value.revisionId !== preparation.manifest.revisionId ||
    value.contentDigest !== preparation.manifest.contentDigest ||
    value.manifestSha256 !== sha256Hex(canonicalizeJson(preparation.manifest)) ||
    value.intent !== preparation.intent ||
    value.lifecycleEpoch !== preparation.lifecycleEpoch ||
    value.version !== preparation.expectedVersion + 1
  )
    throw new TypeError('Commit receipt differs from its frozen preparation.');
  return value;
}

/** Acceptance preserves the invitation snapshot; authorization never creates another publication. */
export function assertEnterpriseGuestAuthorizationReceipt(value, invitation, now) {
  assertEnterpriseJourneyContract(value, 'enterprise-guest-authorization');
  assertEnterpriseJourneyContract(invitation, 'enterprise-guest-invitation');
  if (
    !sameScope(value, invitation) ||
    value.artifactId !== invitation.artifactId ||
    value.invitationId !== invitation.invitationId ||
    value.actorId !== invitation.recipientId ||
    value.role !== invitation.role ||
    value.expiresAt !== invitation.expiresAt ||
    canonicalizeJson(value.pin) !== canonicalizeJson(invitation.pin) ||
    (value.status === 'active' &&
      (!Number.isFinite(Date.parse(now)) ||
        Date.parse(invitation.expiresAt) <= Date.parse(now) ||
        ['denied', 'revoked'].includes(invitation.grantStatus)))
  )
    throw new TypeError('Guest authorization differs from its original invitation.');
  return value;
}
