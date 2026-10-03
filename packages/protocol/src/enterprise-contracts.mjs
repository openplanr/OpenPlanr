// @ts-check
/**
 * Enterprise collaboration contracts (Protocol 1.12.0): closed schemas and validators for access
 * context, revisions, review threads, change proposals, evidence, sync state and agent handoffs,
 * plus a fail-closed access policy, escaped handoff Markdown and semantic document diffs.
 * Entry points: `assertEnterpriseContract`, `authorizeEnterpriseAccess`, `createEnterpriseHandoff`,
 * `diffEnterpriseDocuments`, `applyEnterpriseOperations`. Identity verification, current grants
 * and atomic revision writes belong to the caller's storage adapter.
 */

import { canonicalizeJson, deepFreeze, sha256Hex } from './canonical-json.mjs';
import {
  assertEnterpriseContractWithSchema,
  assertEnterpriseEvidenceWithSchema,
  assertEnterpriseHandoffWithSchema,
  assertEnterpriseProposalWithSchema,
  assertEnterpriseReviewThreadWithSchema,
  assertEnterpriseSyncWithSchema,
  assertPlainData,
  isEnterpriseRepositoryPathData,
  renderEnterpriseHandoffMarkdownData,
} from './enterprise-contract-validation.mjs';
import { validateJson } from './json-schema.mjs';

/** @type {typeof import('./enterprise-contracts.d.mts').ENTERPRISE_CONTRACT_VERSION} */
export const ENTERPRISE_CONTRACT_VERSION = '1.0.0';
/** @type {typeof import('./enterprise-contracts.d.mts').ENTERPRISE_PROTOCOL_VERSION} */
export const ENTERPRISE_PROTOCOL_VERSION = '1.12.0';
/** @type {typeof import('./enterprise-contracts.d.mts').ENTERPRISE_CONTENT_DIGEST_HEADER} */
export const ENTERPRISE_CONTENT_DIGEST_HEADER = 'X-OpenPlanr-Content-Digest';
/** @type {typeof import('./enterprise-contracts.d.mts').ENTERPRISE_ID_PATTERN} */
export const ENTERPRISE_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\\s\\S])';
/** @type {typeof import('./enterprise-contracts.d.mts').ENTERPRISE_REVIEW_CATEGORIES} */
export const ENTERPRISE_REVIEW_CATEGORIES = Object.freeze([
  'question',
  'suggestion',
  'change-request',
  'blocker',
]);
/** @type {typeof import('./enterprise-contracts.d.mts').ENTERPRISE_ACTIONS} */
export const ENTERPRISE_ACTIONS = Object.freeze([
  'organization.manage',
  'ownership.transfer',
  'billing.manage',
  'audit.read',
  'project.create',
  'project.manage',
  'artifact.read',
  'artifact.author',
  'artifact.export',
  'review.write',
  'review.resolve',
]);
const id = { type: 'string', pattern: ENTERPRISE_ID_PATTERN };
const semanticId = {
  type: 'string',
  minLength: 1,
  maxLength: 512,
  pattern: '^[^\\s\\u0000-\\u001f\\u007f]+$',
};
const nullableId = { anyOf: [id, { type: 'null' }] };
const digest = { type: 'string', minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' };
const timestamp = {
  type: 'string',
  format: 'date-time',
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$',
};
const text = { type: 'string', minLength: 1, maxLength: 16384 };
const title = { ...text, maxLength: 240 };
const closed = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const list = (items, maxItems = 1000) => ({ type: 'array', items, maxItems });
const schema = (name, properties, required) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `https://openplanr.dev/schemas/v1.12.0/${name}.schema.json`,
  'x-openplanr-contract': { id: name, version: ENTERPRISE_PROTOCOL_VERSION },
  ...closed(properties, required),
});
const envelope = (kind) => ({
  kind: { const: `openplanr-${kind}` },
  schemaVersion: { const: ENTERPRISE_CONTRACT_VERSION },
});
const scoped = { organizationId: id, projectId: id };
const versionedArtifact = { ...scoped, artifactId: id, revisionId: id };
const activeStatus = { enum: ['active', 'revoked'] };
const projectRole = { enum: ['maintainer', 'author', 'reviewer', 'viewer'] };

/** @type {typeof import('./enterprise-contracts.d.mts').ENTERPRISE_ACCESS_CONTEXT_SCHEMA} */
export const ENTERPRISE_ACCESS_CONTEXT_SCHEMA = schema(
  'enterprise-access-context',
  {
    actor: closed({ id, verified: { type: 'boolean' } }),
    organization: closed({ id, status: { enum: ['active', 'suspended'] } }),
    membership: closed({
      organizationId: id,
      actorId: id,
      role: { enum: ['owner', 'admin', 'member'] },
      status: activeStatus,
    }),
    projectMembership: closed({ ...scoped, actorId: id, role: projectRole, status: activeStatus }),
    guestGrant: closed({
      ...scoped,
      artifactId: id,
      actorId: id,
      role: { enum: ['reviewer', 'viewer'] },
      status: activeStatus,
      expiresAt: timestamp,
    }),
    resource: closed({ organizationId: id, projectId: id, artifactId: id }, ['organizationId']),
    action: { enum: ENTERPRISE_ACTIONS },
    now: timestamp,
  },
  ['actor', 'organization', 'resource', 'action', 'now'],
);

/** @type {typeof import('./enterprise-contracts.d.mts').ENTERPRISE_ARTIFACT_REVISION_SCHEMA} */
export const ENTERPRISE_ARTIFACT_REVISION_SCHEMA = schema('enterprise-artifact-revision', {
  ...envelope('enterprise-artifact-revision'),
  id,
  ...scoped,
  artifactId: id,
  parentRevisionId: nullableId,
  contentDigest: digest,
  contentType: { enum: ['application/json', 'text/markdown', 'image/svg+xml', 'text/html'] },
  byteLength: { type: 'integer', minimum: 0, maximum: 5 * 1024 * 1024 },
  createdAt: timestamp,
  actorId: id,
});

/** @type {typeof import('./enterprise-contracts.d.mts').ENTERPRISE_REVIEW_ANCHOR_SCHEMA} */
export const ENTERPRISE_REVIEW_ANCHOR_SCHEMA = {
  ...closed(
    {
      revisionId: id,
      elementId: semanticId,
      screenId: semanticId,
      frameId: semanticId,
      x: { type: 'number', minimum: 0, maximum: 1 },
      y: { type: 'number', minimum: 0, maximum: 1 },
    },
    ['revisionId'],
  ),
  anyOf: [
    { required: ['elementId'] },
    { required: ['screenId', 'frameId'] },
    { required: ['x', 'y'] },
  ],
  allOf: [
    { if: { required: ['x'] }, then: { required: ['y'] } },
    { if: { required: ['y'] }, then: { required: ['x'] } },
    { if: { required: ['frameId'] }, then: { required: ['screenId'] } },
  ],
};
const reply = closed({ id, authorId: id, body: text, createdAt: timestamp });
/** @type {typeof import('./enterprise-contracts.d.mts').ENTERPRISE_REVIEW_THREAD_SCHEMA} */
export const ENTERPRISE_REVIEW_THREAD_SCHEMA = {
  ...schema(
    'enterprise-review-thread',
    {
      ...envelope('enterprise-review-thread'),
      id,
      ...scoped,
      artifactId: id,
      anchor: ENTERPRISE_REVIEW_ANCHOR_SCHEMA,
      category: { enum: ENTERPRISE_REVIEW_CATEGORIES },
      status: { enum: ['open', 'addressed', 'resolved'] },
      authorId: id,
      body: text,
      createdAt: timestamp,
      updatedAt: timestamp,
      replies: list(reply, 10000),
      assigneeId: nullableId,
      addressedRevisionId: id,
      resolvedAt: timestamp,
    },
    [
      'kind',
      'schemaVersion',
      'id',
      'organizationId',
      'projectId',
      'artifactId',
      'anchor',
      'category',
      'status',
      'authorId',
      'body',
      'createdAt',
      'updatedAt',
      'replies',
    ],
  ),
  allOf: [
    {
      if: { properties: { status: { const: 'addressed' } } },
      then: { required: ['addressedRevisionId'], not: { required: ['resolvedAt'] } },
    },
    {
      if: { properties: { status: { const: 'resolved' } } },
      then: { required: ['resolvedAt'] },
      else: { not: { required: ['resolvedAt'] } },
    },
  ],
};

const collection = { enum: ['nodes', 'relations', 'groups', 'events', 'items'] };
/** @type {typeof import('./enterprise-contracts.d.mts').ENTERPRISE_CHANGE_OPERATION_SCHEMA} */
export const ENTERPRISE_CHANGE_OPERATION_SCHEMA = {
  oneOf: [
    closed({ op: { const: 'replace-document' }, content: { type: 'object' } }),
    closed({
      op: { const: 'set-field' },
      targetId: semanticId,
      field: { enum: ['label', 'description', 'status', 'title'] },
      value: { type: 'string', maxLength: 16384 },
    }),
    closed({
      op: { const: 'add-element' },
      collection,
      element: {
        type: 'object',
        required: ['id'],
        properties: { id: semanticId },
        additionalProperties: true,
      },
    }),
    closed({ op: { const: 'remove-element' }, collection, targetId: semanticId }),
    closed({
      op: { const: 'set-layout' },
      targetId: semanticId,
      x: { type: 'number', minimum: -1e7, maximum: 1e7 },
      y: { type: 'number', minimum: -1e7, maximum: 1e7 },
    }),
  ],
};
/** @type {typeof import('./enterprise-contracts.d.mts').ENTERPRISE_CHANGE_PROPOSAL_SCHEMA} */
export const ENTERPRISE_CHANGE_PROPOSAL_SCHEMA = {
  ...schema(
    'enterprise-change-proposal',
    {
      ...envelope('enterprise-change-proposal'),
      id,
      ...scoped,
      artifactId: id,
      baseRevisionId: id,
      authorId: id,
      createdAt: timestamp,
      status: { enum: ['draft', 'proposed', 'accepted', 'rejected', 'applied', 'conflicted'] },
      summary: title,
      operations: { ...list(ENTERPRISE_CHANGE_OPERATION_SCHEMA, 1000), minItems: 1 },
      validation: closed({
        status: { enum: ['pending', 'passed', 'failed'] },
        issues: list(
          closed({ code: id, message: text, targetId: semanticId }, ['code', 'message']),
        ),
      }),
      application: closed(
        {
          revisionId: id,
          appliedAt: timestamp,
          actorId: id,
          gitCommit: { type: 'string', pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$' },
        },
        ['revisionId', 'appliedAt', 'actorId'],
      ),
    },
    [
      'kind',
      'schemaVersion',
      'id',
      'organizationId',
      'projectId',
      'artifactId',
      'baseRevisionId',
      'authorId',
      'createdAt',
      'status',
      'summary',
      'operations',
      'validation',
    ],
  ),
  allOf: [
    {
      if: { properties: { status: { const: 'applied' } } },
      then: {
        required: ['application'],
        properties: { validation: { properties: { status: { const: 'passed' } } } },
      },
      else: { not: { required: ['application'] } },
    },
    {
      if: { properties: { status: { const: 'accepted' } } },
      then: { properties: { validation: { properties: { status: { const: 'passed' } } } } },
    },
  ],
};

/** @type {typeof import('./enterprise-contracts.d.mts').ENTERPRISE_EVIDENCE_REFERENCE_SCHEMA} */
export const ENTERPRISE_EVIDENCE_REFERENCE_SCHEMA = schema(
  'enterprise-evidence-reference',
  {
    ...envelope('enterprise-evidence-reference'),
    id,
    ...scoped,
    source: {
      oneOf: [
        closed(
          {
            kind: { const: 'repository' },
            repositoryId: id,
            path: text,
            commit: { type: 'string', pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$' },
            line: { type: 'integer', minimum: 1, maximum: 1e9 },
          },
          ['kind', 'repositoryId', 'path', 'commit'],
        ),
        closed(
          { kind: { const: 'artifact' }, artifactId: id, revisionId: id, elementId: semanticId },
          ['kind', 'artifactId', 'revisionId'],
        ),
        closed({ kind: { const: 'url' }, url: { type: 'string', minLength: 1, maxLength: 2048 } }),
      ],
    },
    capturedAt: timestamp,
    freshness: { enum: ['current', 'stale', 'unknown'] },
    label: title,
    contentDigest: digest,
  },
  [
    'kind',
    'schemaVersion',
    'id',
    'organizationId',
    'projectId',
    'source',
    'capturedAt',
    'freshness',
    'label',
  ],
);

/** @type {typeof import('./enterprise-contracts.d.mts').ENTERPRISE_SYNC_STATE_SCHEMA} */
export const ENTERPRISE_SYNC_STATE_SCHEMA = schema('enterprise-sync-state', {
  ...envelope('enterprise-sync-state'),
  ...scoped,
  repositoryId: id,
  direction: { enum: ['push', 'pull'] },
  status: { enum: ['preview', 'pending', 'synchronized', 'failed', 'conflicted'] },
  scope: { ...list(id, 10000), uniqueItems: true },
  cursor: { type: ['string', 'null'], maxLength: 2048 },
  operationId: id,
  updatedAt: timestamp,
  items: list(
    closed({
      artifactId: id,
      baseRevisionId: nullableId,
      revisionId: nullableId,
      contentDigest: digest,
      action: { enum: ['create', 'update', 'unchanged', 'conflict'] },
    }),
    10000,
  ),
  issues: list(closed({ code: id, artifactId: id, message: text }, ['code', 'message'])),
});

/** @type {typeof import('./enterprise-contracts.d.mts').ENTERPRISE_AGENT_HANDOFF_SCHEMA} */
export const ENTERPRISE_AGENT_HANDOFF_SCHEMA = schema('enterprise-agent-handoff', {
  ...envelope('enterprise-agent-handoff'),
  ...versionedArtifact,
  generatedAt: timestamp,
  authority: { const: 'feedback-only' },
  contentTrust: { const: 'untrusted' },
  threads: list(ENTERPRISE_REVIEW_THREAD_SCHEMA, 10000),
  evidence: list(ENTERPRISE_EVIDENCE_REFERENCE_SCHEMA, 10000),
  unresolvedUncertainties: list(text),
  contentDigest: digest,
});

/** @type {typeof import('./enterprise-contracts.d.mts').ENTERPRISE_SCHEMAS} */
export const ENTERPRISE_SCHEMAS = deepFreeze({
  'enterprise-access-context': ENTERPRISE_ACCESS_CONTEXT_SCHEMA,
  'enterprise-artifact-revision': ENTERPRISE_ARTIFACT_REVISION_SCHEMA,
  'enterprise-review-thread': ENTERPRISE_REVIEW_THREAD_SCHEMA,
  'enterprise-change-proposal': ENTERPRISE_CHANGE_PROPOSAL_SCHEMA,
  'enterprise-evidence-reference': ENTERPRISE_EVIDENCE_REFERENCE_SCHEMA,
  'enterprise-sync-state': ENTERPRISE_SYNC_STATE_SCHEMA,
  'enterprise-agent-handoff': ENTERPRISE_AGENT_HANDOFF_SCHEMA,
});

const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
function sameScope(value, expected) {
  return value.organizationId === expected.organizationId && value.projectId === expected.projectId;
}

/**
 * Structural validation is not authentication, signature verification, or domain validation.
 * @returns {ReturnType<typeof import('./enterprise-contracts.d.mts').assertEnterpriseContract>}
 */
export function assertEnterpriseContract(value, schemaOrName) {
  const contract =
    typeof schemaOrName === 'string' ? ENTERPRISE_SCHEMAS[schemaOrName] : schemaOrName;
  return assertEnterpriseContractWithSchema(value, contract);
}

/**
 * Metadata immutability requires the storage adapter to compare-and-set IDs and recompute content digests.
 * @type {typeof import('./enterprise-contracts.d.mts').assertEnterpriseRevision}
 */
export function assertEnterpriseRevision(value) {
  assertEnterpriseContract(value, ENTERPRISE_ARTIFACT_REVISION_SCHEMA);
  if (value.id === value.parentRevisionId)
    throw new TypeError('A revision cannot be its own parent.');
  return value;
}

/**
 * Verify append identity and bytes; the adapter still performs the atomic compare-and-set.
 * @type {typeof import('./enterprise-contracts.d.mts').assertEnterpriseRevisionAppend}
 */
export function assertEnterpriseRevisionAppend(revision, previous, content) {
  assertEnterpriseRevision(revision);
  if (previous) {
    assertEnterpriseRevision(previous);
    if (
      !sameScope(revision, previous) ||
      revision.artifactId !== previous.artifactId ||
      revision.parentRevisionId !== previous.id ||
      revision.id === previous.id
    )
      throw new TypeError('Revision append does not match the current artifact revision.');
    if (Date.parse(revision.createdAt) < Date.parse(previous.createdAt))
      throw new TypeError('Revision append cannot precede its parent.');
  } else if (revision.parentRevisionId !== null)
    throw new TypeError('An initial revision cannot have a parent.');
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  if (
    !(bytes instanceof Uint8Array) ||
    revision.byteLength !== bytes.byteLength ||
    revision.contentDigest !== sha256Hex(bytes)
  )
    throw new TypeError('Revision digest or size does not match its content.');
  return revision;
}

/** @type {typeof import('./enterprise-contracts.d.mts').assertEnterpriseReviewThread} */
export function assertEnterpriseReviewThread(value) {
  return assertEnterpriseReviewThreadWithSchema(value, ENTERPRISE_REVIEW_THREAD_SCHEMA);
}

/** @type {typeof import('./enterprise-contracts.d.mts').assertEnterpriseProposal} */
export function assertEnterpriseProposal(value) {
  return assertEnterpriseProposalWithSchema(value, ENTERPRISE_CHANGE_PROPOSAL_SCHEMA);
}

/** @type {typeof import('./enterprise-contracts.d.mts').assertEnterpriseEvidence} */
export function assertEnterpriseEvidence(value) {
  return assertEnterpriseEvidenceWithSchema(value, ENTERPRISE_EVIDENCE_REFERENCE_SCHEMA);
}

/**
 * A lexical check only; file application must also reject symlinks outside its repository root.
 * @type {typeof import('./enterprise-contracts.d.mts').isEnterpriseRepositoryPath}
 */
export function isEnterpriseRepositoryPath(value) {
  return isEnterpriseRepositoryPathData(value);
}

/** @type {typeof import('./enterprise-contracts.d.mts').assertEnterpriseSync} */
export function assertEnterpriseSync(value) {
  return assertEnterpriseSyncWithSchema(value, ENTERPRISE_SYNC_STATE_SCHEMA);
}

const projectCapabilities = deepFreeze({
  maintainer: [
    'project.manage',
    'artifact.read',
    'artifact.author',
    'artifact.export',
    'review.write',
    'review.resolve',
  ],
  author: ['artifact.read', 'artifact.author', 'artifact.export', 'review.write', 'review.resolve'],
  reviewer: ['artifact.read', 'artifact.export', 'review.write'],
  viewer: ['artifact.read', 'artifact.export'],
});
/** @type {readonly import('./enterprise-contracts.d.mts').EnterpriseAction[]} */
const noCapabilities = Object.freeze([]);

/**
 * Stable UI projection for a server-verified project role. Callers must still
 * authorize every request at the resource boundary; this only describes which
 * controls the verified response may expose.
 * @type {typeof import('./enterprise-contracts.d.mts').enterpriseProjectCapabilities}
 */
export function enterpriseProjectCapabilities(role) {
  return projectCapabilities[role] ?? noCapabilities;
}
/** @type {Readonly<Record<'owner' | 'admin' | 'member', readonly import('./enterprise-contracts.d.mts').EnterpriseAction[]>>} */
const organizationCapabilities = deepFreeze({
  owner: [
    'organization.manage',
    'ownership.transfer',
    'billing.manage',
    'audit.read',
    'project.create',
  ],
  admin: ['organization.manage', 'billing.manage', 'audit.read', 'project.create'],
  member: [],
});
const decision = (allowed, code) => Object.freeze({ allowed, code });

/**
 * Pure fail-closed policy. The adapter must load current membership/grants itself
 * and verify actor identity. Never pass actor/ACL records supplied by a client.
 * Organization administrators do not implicitly gain project content access.
 * @type {typeof import('./enterprise-contracts.d.mts').authorizeEnterpriseAccess}
 */
export function authorizeEnterpriseAccess(context) {
  try {
    assertEnterpriseContract(context, ENTERPRISE_ACCESS_CONTEXT_SCHEMA);
  } catch {
    return decision(false, 'invalid-context');
  }
  const { actor, organization, membership, projectMembership, guestGrant, resource, action, now } =
    context;
  if (!actor.verified) return decision(false, 'unverified-actor');
  if (organization.id !== resource.organizationId) return decision(false, 'organization-mismatch');
  if (organization.status !== 'active') return decision(false, 'organization-inactive');
  if (resource.artifactId && !resource.projectId) return decision(false, 'project-required');
  if (
    membership &&
    (membership.actorId !== actor.id || membership.organizationId !== organization.id)
  )
    return decision(false, 'membership-mismatch');
  if (membership && membership.status !== 'active') return decision(false, 'membership-revoked');
  if (
    action.startsWith('organization.') ||
    ['ownership.transfer', 'billing.manage', 'audit.read', 'project.create'].includes(action)
  ) {
    if (resource.projectId || resource.artifactId)
      return decision(false, 'organization-resource-required');
    return membership && organizationCapabilities[membership.role].includes(action)
      ? decision(true, 'allowed')
      : decision(false, 'insufficient-role');
  }
  if (!resource.projectId) return decision(false, 'project-required');
  if (projectMembership) {
    if (projectMembership.actorId !== actor.id || !sameScope(projectMembership, resource))
      return decision(false, 'project-membership-mismatch');
    if (projectMembership.status !== 'active') return decision(false, 'project-membership-revoked');
    if (!membership) return decision(false, 'membership-required');
    return enterpriseProjectCapabilities(projectMembership.role).includes(action)
      ? decision(true, 'allowed')
      : decision(false, 'insufficient-role');
  }
  if (!guestGrant) return decision(false, 'project-membership-required');
  if (
    !resource.artifactId ||
    !sameScope(guestGrant, resource) ||
    guestGrant.artifactId !== resource.artifactId ||
    guestGrant.actorId !== actor.id
  )
    return decision(false, 'guest-scope-mismatch');
  if (guestGrant.status !== 'active' || Date.parse(guestGrant.expiresAt) <= Date.parse(now))
    return decision(false, 'guest-grant-expired-or-revoked');
  return enterpriseProjectCapabilities(guestGrant.role).includes(action)
    ? decision(true, 'allowed')
    : decision(false, 'insufficient-role');
}

/** @type {typeof import('./enterprise-contracts.d.mts').assertEnterpriseHandoff} */
export function assertEnterpriseHandoff(value) {
  return assertEnterpriseHandoffWithSchema(
    value,
    ENTERPRISE_AGENT_HANDOFF_SCHEMA,
    (thread) => assertEnterpriseReviewThreadWithSchema(thread, ENTERPRISE_REVIEW_THREAD_SCHEMA),
    (evidence) =>
      assertEnterpriseEvidenceWithSchema(evidence, ENTERPRISE_EVIDENCE_REFERENCE_SCHEMA),
  );
}

/** @type {typeof import('./enterprise-contracts.d.mts').createEnterpriseHandoff} */
export function createEnterpriseHandoff({
  organizationId,
  projectId,
  artifactId,
  revisionId,
  generatedAt,
  threads = [],
  evidence = [],
  unresolvedUncertainties = [],
}) {
  // Validate before cloning so exotic objects or accessors cannot acquire authority.
  const content = {
    kind: 'openplanr-enterprise-agent-handoff',
    schemaVersion: ENTERPRISE_CONTRACT_VERSION,
    organizationId,
    projectId,
    artifactId,
    revisionId,
    generatedAt,
    authority: 'feedback-only',
    contentTrust: 'untrusted',
    threads,
    evidence,
    unresolvedUncertainties,
  };
  assertPlainData(content);
  const handoff = {
    ...JSON.parse(canonicalizeJson(content)),
    contentDigest: sha256Hex(canonicalizeJson(content)),
  };
  assertEnterpriseHandoff(handoff);
  return deepFreeze(handoff);
}

/**
 * Render private feedback as escaped content, never executable agent instructions.
 * @type {typeof import('./enterprise-contracts.d.mts').renderEnterpriseHandoffMarkdown}
 */
export function renderEnterpriseHandoffMarkdown(value) {
  assertEnterpriseHandoff(value);
  return renderEnterpriseHandoffMarkdownData(value);
}

const editableCollections = Object.freeze(['nodes', 'relations', 'groups', 'events', 'items']);
const identityCollections = Object.freeze([
  ...editableCollections,
  'lanes',
  'series',
  'axes',
  'sets',
  'annotations',
]);
const copyData = (value) => JSON.parse(canonicalizeJson(value));
function assertDocument(value) {
  assertPlainData(value);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Semantic document must be a JSON object.');
  canonicalizeJson(value);
}
function indexedElements(document) {
  const entries = new Map();
  const add = (targetId, element) => {
    if (
      typeof targetId !== 'string' ||
      validateJson(targetId, semanticId).length ||
      unsafeKeys.has(targetId)
    )
      throw new TypeError('Invalid semantic element identity.');
    if (entries.has(targetId))
      throw new TypeError('Ambiguous or duplicate semantic element identity.');
    entries.set(targetId, element);
  };
  const rootId = document.id ?? document.diagramId;
  if (rootId !== undefined) add(rootId, document);
  for (const collection of identityCollections) {
    if (document[collection] === undefined) continue;
    if (!Array.isArray(document[collection]))
      throw new TypeError('Semantic element collections must be arrays.');
    for (const element of document[collection]) {
      if (!element || typeof element !== 'object' || Array.isArray(element))
        throw new TypeError('Semantic elements must be JSON objects.');
      if (element.id !== undefined) add(element.id, element);
    }
  }
  return entries;
}
function assertLayout(layout, entries) {
  assertPlainData(layout);
  if (!layout || typeof layout !== 'object' || Array.isArray(layout))
    throw new TypeError('Layout must be an element-coordinate map.');
  const coordinateSchema = closed({
    x: { type: 'number', minimum: -1e7, maximum: 1e7 },
    y: { type: 'number', minimum: -1e7, maximum: 1e7 },
  });
  for (const [targetId, point] of Object.entries(layout)) {
    if (!entries.has(targetId) || validateJson(point, coordinateSchema).length)
      throw new TypeError('Layout must identify existing elements and finite coordinates.');
  }
}
const equalData = (left, right) => canonicalizeJson(left) === canonicalizeJson(right);

/**
 * Compare stable element identities; documentDigest is derived metadata, not a semantic change.
 * @returns {ReturnType<typeof import('./enterprise-contracts.d.mts').diffEnterpriseDocuments>}
 */
export function diffEnterpriseDocuments(
  before,
  after,
  { beforeLayout = {}, afterLayout = {} } = {},
) {
  assertDocument(before);
  assertDocument(after);
  const previousEntries = indexedElements(before),
    nextEntries = indexedElements(after);
  assertLayout(beforeLayout, previousEntries);
  assertLayout(afterLayout, nextEntries);
  const changes = [];
  const delta = (left, right, descriptor, hasBefore = true, hasAfter = true) => {
    if (hasBefore && hasAfter && equalData(left, right)) return;
    changes.push({
      ...descriptor,
      op: !hasBefore ? 'add' : !hasAfter ? 'remove' : 'replace',
      ...(hasBefore ? { before: copyData(left) } : {}),
      ...(hasAfter ? { after: copyData(right) } : {}),
    });
  };
  for (const field of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (field === 'documentDigest') continue;
    const hasBefore = Object.hasOwn(before, field),
      hasAfter = Object.hasOwn(after, field);
    if (
      identityCollections.includes(field) &&
      hasBefore &&
      hasAfter &&
      before[field].every((item) => typeof item.id === 'string') &&
      after[field].every((item) => typeof item.id === 'string')
    ) {
      const left = new Map(before[field].map((item) => [item.id, item])),
        right = new Map(after[field].map((item) => [item.id, item]));
      for (const targetId of [...new Set([...left.keys(), ...right.keys()])].sort())
        delta(
          left.get(targetId),
          right.get(targetId),
          { plane: 'semantic', collection: field, targetId },
          left.has(targetId),
          right.has(targetId),
        );
      // Ordering matters for timelines and authored reading sequences.
      delta([...left.keys()], [...right.keys()], { plane: 'semantic', field: `${field}.order` });
    } else
      delta(
        before[field],
        after[field],
        { plane: field === 'layout' ? 'layout' : 'semantic', field },
        hasBefore,
        hasAfter,
      );
  }
  for (const targetId of [
    ...new Set([...Object.keys(beforeLayout), ...Object.keys(afterLayout)]),
  ].sort())
    delta(
      beforeLayout[targetId],
      afterLayout[targetId],
      { plane: 'layout', targetId },
      Object.hasOwn(beforeLayout, targetId),
      Object.hasOwn(afterLayout, targetId),
    );
  return {
    semanticChanged: changes.some((change) => change.plane === 'semantic'),
    layoutChanged: changes.some((change) => change.plane === 'layout'),
    changes,
  };
}

/**
 * Deterministic in-memory proposal preview. No authority or repository writes.
 * Callers must check the base revision, authorize application, validate the final
 * domain document (including all references), and restamp its derived digest.
 * @type {typeof import('./enterprise-contracts.d.mts').applyEnterpriseOperations}
 */
export function applyEnterpriseOperations(document, proposal, { layout = {} } = {}) {
  assertDocument(document);
  assertEnterpriseProposal(proposal);
  let next = copyData(document),
    nextLayout = copyData(layout);
  assertLayout(nextLayout, indexedElements(next));
  for (const operation of proposal.operations) {
    const entries = indexedElements(next);
    if (operation.op === 'replace-document') {
      next = copyData(operation.content);
      const newEntries = indexedElements(next);
      nextLayout = Object.fromEntries(
        Object.entries(nextLayout).filter(([targetId]) => newEntries.has(targetId)),
      );
    } else if (operation.op === 'add-element') {
      if (entries.has(operation.element.id))
        throw new TypeError('Cannot add a duplicate semantic element.');
      next[operation.collection] ??= [];
      if (!Array.isArray(next[operation.collection]))
        throw new TypeError('Cannot add to a non-array collection.');
      next[operation.collection].push(copyData(operation.element));
    } else if (operation.op === 'remove-element') {
      const items = next[operation.collection];
      if (!Array.isArray(items) || !items.some((item) => item.id === operation.targetId))
        throw new TypeError('Cannot remove an absent semantic element.');
      next[operation.collection] = items.filter((item) => item.id !== operation.targetId);
      delete nextLayout[operation.targetId];
    } else {
      const target = entries.get(operation.targetId);
      if (!target) throw new TypeError('Operation target is absent from the semantic document.');
      if (operation.op === 'set-layout')
        nextLayout[operation.targetId] = { x: operation.x, y: operation.y };
      else target[operation.field] = operation.value;
    }
  }
  // Detect ambiguous identities introduced by additions or document replacement.
  indexedElements(next);
  const result = diffEnterpriseDocuments(document, next, {
    beforeLayout: layout,
    afterLayout: nextLayout,
  });
  return { document: next, layout: nextLayout, ...result };
}
