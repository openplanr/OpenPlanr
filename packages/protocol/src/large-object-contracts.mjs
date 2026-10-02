/** Additive Protocol 1.17 contracts for bounded, resumable encrypted resources. */
import { assertLargeObjectData } from './bounded-json-data.mjs';
import { canonicalizeJson } from './canonical-json.mjs';
import {
  assertEnterpriseContract,
  ENTERPRISE_ARTIFACT_REVISION_SCHEMA,
} from './enterprise-contracts.mjs';
import {
  assertEnterpriseResourceContract,
  ENTERPRISE_RESOURCE_SCHEMAS,
} from './enterprise-resource-contracts.mjs';
import { ARTIFACT_ENVELOPE_METADATA_SCHEMAS } from './generated/artifact-envelope-metadata.mjs';
import { SHARING_SECURITY_SCHEMAS } from './sharing-security-contracts.mjs';
import {
  DIAGRAM_AUTHORING_BUNDLE_V11_SCHEMA,
  DIAGRAM_EDIT_TRANSACTION_V11_SCHEMA,
  DIAGRAM_PRESENTATION_SCHEMA,
  DIAGRAM_REVIEW_BUNDLE_V11_SCHEMA,
} from './studio-presentation-contracts.mjs';

export { assertLargeObjectData } from './bounded-json-data.mjs';
export { canonicalizeJson } from './canonical-json.mjs';

import { validateJson } from './json-schema.mjs';
import { LARGE_OBJECT_LIMITS } from './large-object-limits.mjs';

export { LARGE_OBJECT_LIMITS } from './large-object-limits.mjs';

export const LARGE_OBJECT_VERSION = '2.0.0';
export const LARGE_OBJECT_CHUNK_CONTEXT = 'openplanr.encrypted-resource.chunk.v2';
/** A zero-prefixed magic string, count and tagged length spans distinguish raw UTF-8 from legacy JSON. */
export const RESOURCE_HTML_SEGMENT_ENCODING = 'openplanr.html-segments.utf8-v1';
const id = { type: 'string', pattern: '^[A-Za-z0-9_-]{22,64}$' };
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const signature = { type: 'string', pattern: '^[A-Za-z0-9_-]{86}$' };
const integer = (max, min = 0) => ({ type: 'integer', minimum: min, maximum: max });
const closed = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const iso = { type: 'string', format: 'date-time', maxLength: 40 };
const codec = { enum: ['identity', 'deflate-raw'] };
const publicKey = closed({
  kty: { const: 'EC' },
  crv: { const: 'P-256' },
  x: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
  y: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
});
const keyring = closed({
  iv: { type: 'string', pattern: '^[A-Za-z0-9_-]{16}$' },
  ciphertext: { type: 'string', pattern: '^[A-Za-z0-9_-]+$', maxLength: 65536 },
});
const chunk = closed({
  index: integer(128),
  byteLength: integer(LARGE_OBJECT_LIMITS.chunkBytes, 17),
  iv: { type: 'string', pattern: '^[A-Za-z0-9_-]{16}$' },
  sha256: digest,
});
const catalogSpan = closed({
  offset: integer(LARGE_OBJECT_LIMITS.decodedBytes),
  encodedBytes: integer(LARGE_OBJECT_LIMITS.catalogBytes, 1),
  decodedBytes: integer(LARGE_OBJECT_LIMITS.catalogBytes, 1),
  codec,
});
const schema = (name, properties, required) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `https://openplanr.dev/schemas/v1.17.0/${name}.schema.json`,
  'x-openplanr-contract': { id: name, version: '1.17.0' },
  ...closed(properties, required),
});

export const ENCRYPTED_RESOURCE_MANIFEST_SCHEMA = schema('encrypted-resource-manifest', {
  schemaVersion: { const: LARGE_OBJECT_VERSION },
  kind: { const: 'openplanr-encrypted-resource-manifest' },
  workspaceId: id,
  revisionId: id,
  epoch: integer(Number.MAX_SAFE_INTEGER, 1),
  createdAt: iso,
  plaintextBytes: integer(LARGE_OBJECT_LIMITS.decodedBytes, 1),
  ciphertextBytes: integer(LARGE_OBJECT_LIMITS.ciphertextBytes, 17),
  catalog: catalogSpan,
  chunks: { type: 'array', minItems: 1, maxItems: LARGE_OBJECT_LIMITS.chunks, items: chunk },
  signature,
});
export const ENCRYPTED_UPLOAD_PREPARE_SCHEMA = schema('encrypted-upload-prepare', {
  schemaVersion: { const: LARGE_OBJECT_VERSION },
  workspaceId: id,
  operationId: id,
  expectedVersion: integer(Number.MAX_SAFE_INTEGER),
  epoch: integer(Number.MAX_SAFE_INTEGER, 1),
  ownerPublicKey: publicKey,
  ownerAuthHash: digest,
  reviewerAuthHash: digest,
  keyring,
  manifest: ENCRYPTED_RESOURCE_MANIFEST_SCHEMA,
  signature,
});
export const ENCRYPTED_UPLOAD_COMMIT_SCHEMA = schema('encrypted-upload-commit', {
  schemaVersion: { const: LARGE_OBJECT_VERSION },
  workspaceId: id,
  operationId: id,
  manifestSha256: digest,
  signature,
});
export const ENCRYPTED_UPLOAD_RECEIPT_SCHEMA = schema('encrypted-upload-receipt', {
  schemaVersion: { const: LARGE_OBJECT_VERSION },
  workspaceId: id,
  operationId: id,
  revisionId: id,
  manifestSha256: digest,
  status: { const: 'committed' },
  version: integer(Number.MAX_SAFE_INTEGER, 1),
  committedAt: iso,
});
export const ENCRYPTED_UPLOAD_STATUS_SCHEMA = schema(
  'encrypted-upload-status',
  {
    schemaVersion: { const: LARGE_OBJECT_VERSION },
    workspaceId: id,
    operationId: id,
    revisionId: id,
    manifestSha256: digest,
    status: { enum: ['prepared', 'committed'] },
    receivedChunks: {
      type: 'array',
      maxItems: LARGE_OBJECT_LIMITS.chunks,
      items: closed({
        index: integer(128),
        sha256: digest,
        byteLength: integer(LARGE_OBJECT_LIMITS.chunkBytes, 17),
      }),
    },
    receipt: ENCRYPTED_UPLOAD_RECEIPT_SCHEMA,
  },
  [
    'schemaVersion',
    'workspaceId',
    'operationId',
    'revisionId',
    'manifestSha256',
    'status',
    'receivedChunks',
  ],
);
export const ENCRYPTED_WORKSPACE_V2_SCHEMA = schema('encrypted-workspace-v2', {
  schemaVersion: { const: LARGE_OBJECT_VERSION },
  id,
  version: integer(Number.MAX_SAFE_INTEGER, 1),
  epoch: integer(Number.MAX_SAFE_INTEGER, 1),
  currentRevision: id,
  ownerPublicKey: publicKey,
  keyring,
  commentsPaused: { type: 'boolean' },
});
export const ENCRYPTED_WORKSPACE_EVENT_V2_SCHEMA = schema('encrypted-workspace-event-v2', {
  id,
  epoch: integer(Number.MAX_SAFE_INTEGER, 1),
  revisionId: id,
  createdAt: iso,
  iv: { type: 'string', pattern: '^[A-Za-z0-9_-]{16}$' },
  ciphertext: {
    type: 'string',
    pattern: '^[A-Za-z0-9_-]+$',
    maxLength: Math.ceil((LARGE_OBJECT_LIMITS.eventBytes * 4) / 3),
  },
  authorPublicKey: publicKey,
  signature,
});
const resource = closed({
  id: { type: 'string', pattern: '^r[0-9]{1,4}$' },
  type: { enum: ['html-segments', 'shared-block', 'asset'] },
  offset: integer(LARGE_OBJECT_LIMITS.decodedBytes),
  encodedBytes: integer(LARGE_OBJECT_LIMITS.decodedBytes, 1),
  decodedBytes: integer(LARGE_OBJECT_LIMITS.decodedBytes, 1),
  codec,
  sha256: digest,
});
export const RESOURCE_CATALOG_SCHEMA = schema('resource-catalog', {
  schemaVersion: { const: '1.0.0' },
  kind: { const: 'openplanr-resource-catalog' },
  bundle: { type: 'object' },
  uniqueHtmlBytes: integer(LARGE_OBJECT_LIMITS.uniqueHtmlBytes),
  totalDecodedBytes: integer(LARGE_OBJECT_LIMITS.decodedBytes, 1),
  resources: {
    type: 'array',
    minItems: 1,
    maxItems: LARGE_OBJECT_LIMITS.resources,
    items: resource,
  },
  sources: {
    type: 'array',
    minItems: 1,
    maxItems: LARGE_OBJECT_LIMITS.sources,
    items: closed({
      id: { type: 'string', minLength: 1, maxLength: 128 },
      resourceId: resource.properties.id,
      htmlBytes: integer(LARGE_OBJECT_LIMITS.uniqueHtmlBytes, 1),
      sha256: digest,
    }),
  },
  viewSources: {
    type: 'object',
    maxProperties: LARGE_OBJECT_LIMITS.views,
    additionalProperties: { type: 'string', minLength: 1, maxLength: 128 },
  },
});
// Optional for plain company packs; encrypted review clients always bind the full review basis.
RESOURCE_CATALOG_SCHEMA.properties.reviewOf = digest;
const companyId = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' };
const companyScope = { organizationId: companyId, projectId: companyId, artifactId: companyId };
export const COMPANY_RESOURCE_MANIFEST_SCHEMA = schema('company-resource-manifest', {
  schemaVersion: { const: '2.0.0' },
  kind: { const: 'openplanr-company-resource-manifest' },
  ...companyScope,
  revisionId: id,
  contentDigest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
  contentType: { const: 'application/json' },
  byteLength: integer(LARGE_OBJECT_LIMITS.decodedBytes, 1),
  decodedBytes: integer(LARGE_OBJECT_LIMITS.decodedBytes, 1),
  catalog: catalogSpan,
  chunks: {
    type: 'array',
    minItems: 1,
    maxItems: 128,
    items: closed({
      index: integer(127),
      byteLength: integer(LARGE_OBJECT_LIMITS.chunkBytes, 1),
      sha256: digest,
    }),
  },
});
export const COMPANY_RESOURCE_UPLOAD_PREPARE_SCHEMA = schema('company-resource-upload-prepare', {
  schemaVersion: { const: '2.0.0' },
  operationId: id,
  baseRevisionId: { oneOf: [id, { type: 'null' }] },
  manifest: COMPANY_RESOURCE_MANIFEST_SCHEMA,
});
export const COMPANY_RESOURCE_UPLOAD_RECEIPT_SCHEMA = schema('company-resource-upload-receipt', {
  schemaVersion: { const: '2.0.0' },
  ...companyScope,
  operationId: id,
  revisionId: id,
  manifestSha256: digest,
  contentDigest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
  status: { const: 'committed' },
  committedAt: iso,
});
export const COMPANY_RESOURCE_UPLOAD_STATUS_SCHEMA = schema(
  'company-resource-upload-status',
  {
    schemaVersion: { const: '2.0.0' },
    operationId: id,
    status: { enum: ['prepared', 'committed'] },
    receivedChunks: {
      type: 'array',
      maxItems: 128,
      items: closed({
        index: integer(127),
        sha256: digest,
        byteLength: integer(LARGE_OBJECT_LIMITS.chunkBytes, 1),
      }),
    },
    receipt: COMPANY_RESOURCE_UPLOAD_RECEIPT_SCHEMA,
  },
  ['schemaVersion', 'operationId', 'status', 'receivedChunks'],
);
export const ENTERPRISE_ARTIFACT_REVISION_V11_SCHEMA = structuredClone(
  ENTERPRISE_ARTIFACT_REVISION_SCHEMA,
);
Object.assign(ENTERPRISE_ARTIFACT_REVISION_V11_SCHEMA, {
  $id: 'https://openplanr.dev/schemas/v1.17.0/enterprise-artifact-revision.schema.json',
  'x-openplanr-contract': { id: 'enterprise-artifact-revision', version: '1.17.0' },
});
Object.assign(ENTERPRISE_ARTIFACT_REVISION_V11_SCHEMA.properties, {
  id,
  parentRevisionId: {
    anyOf: [id, structuredClone(ENTERPRISE_ARTIFACT_REVISION_SCHEMA.properties.parentRevisionId)],
  },
  schemaVersion: { const: '1.1.0' },
  protocolVersion: { const: '1.17.0' },
  contentDigest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
  byteLength: integer(LARGE_OBJECT_LIMITS.decodedBytes, 1),
  contentReference: closed({ transport: { const: 'resources-v2' }, manifestSha256: digest }),
});
ENTERPRISE_ARTIFACT_REVISION_V11_SCHEMA.required.push('contentReference');
export const WORKSPACE_MANAGEMENT_V2_SCHEMA = schema('workspace-management-v2', {
  operationId: id,
  expectedVersion: integer(Number.MAX_SAFE_INTEGER, 1),
  epoch: integer(Number.MAX_SAFE_INTEGER, 1),
  action: { enum: ['pause', 'resume', 'revoke', 'delete'] },
  signature,
});
export const WORKSPACE_ROTATION_V2_SCHEMA = schema('workspace-rotation-v2', {
  operationId: id,
  expectedVersion: integer(Number.MAX_SAFE_INTEGER, 1),
  epoch: integer(Number.MAX_SAFE_INTEGER, 2),
  reviewerAuthHash: digest,
  keyring,
  signature,
});
export const LARGE_OBJECT_SCHEMAS = Object.freeze({
  ...ENTERPRISE_RESOURCE_SCHEMAS,
  ...SHARING_SECURITY_SCHEMAS,
  'diagram-authoring-bundle': DIAGRAM_AUTHORING_BUNDLE_V11_SCHEMA,
  'diagram-edit-transaction': DIAGRAM_EDIT_TRANSACTION_V11_SCHEMA,
  'diagram-presentation': DIAGRAM_PRESENTATION_SCHEMA,
  'diagram-review-bundle': DIAGRAM_REVIEW_BUNDLE_V11_SCHEMA,
  'encrypted-resource-manifest': ENCRYPTED_RESOURCE_MANIFEST_SCHEMA,
  'encrypted-upload-prepare': ENCRYPTED_UPLOAD_PREPARE_SCHEMA,
  'encrypted-upload-commit': ENCRYPTED_UPLOAD_COMMIT_SCHEMA,
  'encrypted-upload-receipt': ENCRYPTED_UPLOAD_RECEIPT_SCHEMA,
  'encrypted-upload-status': ENCRYPTED_UPLOAD_STATUS_SCHEMA,
  'encrypted-workspace-v2': ENCRYPTED_WORKSPACE_V2_SCHEMA,
  'encrypted-workspace-event-v2': ENCRYPTED_WORKSPACE_EVENT_V2_SCHEMA,
  'resource-catalog': RESOURCE_CATALOG_SCHEMA,
  'company-resource-manifest': COMPANY_RESOURCE_MANIFEST_SCHEMA,
  'company-resource-upload-prepare': COMPANY_RESOURCE_UPLOAD_PREPARE_SCHEMA,
  'company-resource-upload-receipt': COMPANY_RESOURCE_UPLOAD_RECEIPT_SCHEMA,
  'company-resource-upload-status': COMPANY_RESOURCE_UPLOAD_STATUS_SCHEMA,
  'enterprise-artifact-revision': ENTERPRISE_ARTIFACT_REVISION_V11_SCHEMA,
  'workspace-management-v2': WORKSPACE_MANAGEMENT_V2_SCHEMA,
  'workspace-rotation-v2': WORKSPACE_ROTATION_V2_SCHEMA,
});
export function assertLargeObjectContract(value, kind) {
  assertLargeObjectData(value);
  const selected = Object.hasOwn(LARGE_OBJECT_SCHEMAS, kind) ? LARGE_OBJECT_SCHEMAS[kind] : null;
  if (!selected) throw new TypeError('Unknown large object contract.');
  const errors = validateJson(value, selected);
  if (errors.length) throw new TypeError(`Invalid ${kind}: ${errors[0].path} ${errors[0].detail}`);
  const byteLength = new TextEncoder().encode(canonicalizeJson(value)).byteLength;
  if (Object.hasOwn(ENTERPRISE_RESOURCE_SCHEMAS, kind)) {
    return assertEnterpriseResourceContract(value, kind);
  } else if (kind === 'enterprise-artifact-revision') {
    assertEnterpriseContract(value, ENTERPRISE_ARTIFACT_REVISION_V11_SCHEMA);
    if (value.id === value.parentRevisionId)
      throw new TypeError('A revision cannot be its own parent.');
  } else if (kind === 'encrypted-resource-manifest') {
    if (byteLength > LARGE_OBJECT_LIMITS.manifestBytes)
      throw new RangeError('Manifest exceeds its byte limit.');
    let cipher = 0,
      plain = 0;
    const ivs = new Set();
    for (const [index, part] of value.chunks.entries()) {
      if (
        part.index !== index ||
        ivs.has(part.iv) ||
        (index < value.chunks.length - 1 && part.byteLength !== LARGE_OBJECT_LIMITS.chunkBytes)
      )
        throw new TypeError('Invalid chunk sequence or repeated IV.');
      ivs.add(part.iv);
      cipher += part.byteLength;
      plain += part.byteLength - 16;
    }
    if (
      cipher !== value.ciphertextBytes ||
      plain !== value.plaintextBytes ||
      value.catalog.offset + value.catalog.encodedBytes !== plain ||
      value.catalog.encodedBytes > value.catalog.decodedBytes
    )
      throw new TypeError('Invalid manifest byte accounting or catalog span.');
  } else if (kind === 'company-resource-manifest') {
    if (byteLength > LARGE_OBJECT_LIMITS.manifestBytes)
      throw new RangeError('Company manifest exceeds its byte limit.');
    let total = 0;
    for (const [index, part] of value.chunks.entries()) {
      if (
        part.index !== index ||
        (index < value.chunks.length - 1 && part.byteLength !== LARGE_OBJECT_LIMITS.chunkBytes)
      )
        throw new TypeError('Invalid company chunk sequence.');
      total += part.byteLength;
    }
    if (
      total !== value.byteLength ||
      value.catalog.offset + value.catalog.encodedBytes !== total ||
      value.byteLength > value.decodedBytes ||
      value.catalog.encodedBytes > value.catalog.decodedBytes
    )
      throw new TypeError('Company resource byte accounting differs.');
  } else if (kind === 'company-resource-upload-status') {
    if (
      new Set(value.receivedChunks.map((part) => part.index)).size !==
        value.receivedChunks.length ||
      (value.status === 'committed') !== Boolean(value.receipt) ||
      (value.receipt && value.receipt.operationId !== value.operationId)
    )
      throw new TypeError('Company upload status differs.');
  } else if (kind === 'company-resource-upload-prepare') {
    assertLargeObjectContract(value.manifest, 'company-resource-manifest');
  } else if (kind === 'encrypted-upload-prepare') {
    assertLargeObjectContract(value.manifest, 'encrypted-resource-manifest');
    if (value.workspaceId !== value.manifest.workspaceId || value.epoch !== value.manifest.epoch)
      throw new TypeError('Upload and manifest identity differ.');
  } else if (kind === 'encrypted-upload-status') {
    if (
      new Set(value.receivedChunks.map((part) => part.index)).size !==
        value.receivedChunks.length ||
      (value.status === 'committed') !== Boolean(value.receipt)
    )
      throw new TypeError('Invalid upload status.');
    if (
      value.receipt &&
      ['workspaceId', 'operationId', 'revisionId', 'manifestSha256'].some(
        (key) => value[key] !== value.receipt[key],
      )
    )
      throw new TypeError('Upload receipt identity differs.');
  } else if (kind === 'resource-catalog') {
    if (byteLength > LARGE_OBJECT_LIMITS.catalogBytes)
      throw new RangeError('Catalog exceeds its byte limit.');
    let nodes = 0;
    const pending = [[value.bundle, 0]];
    for (let next = pending.pop(); next; next = pending.pop()) {
      const [item, depth] = next;
      if (++nodes > 250000 || depth > 40)
        throw new RangeError('Catalog metadata complexity exceeds its limit.');
      if (item && typeof item === 'object')
        for (const child of Object.values(item)) pending.push([child, depth + 1]);
    }
    const resources = new Map();
    let offset = 0,
      decoded = 0;
    for (const part of value.resources) {
      if (resources.has(part.id) || part.offset !== offset || part.encodedBytes > part.decodedBytes)
        throw new TypeError('Invalid resource sequence.');
      resources.set(part.id, part);
      offset += part.encodedBytes;
      decoded += part.decodedBytes;
    }
    const sources = new Set();
    let html = 0;
    for (const source of value.sources) {
      if (sources.has(source.id) || resources.get(source.resourceId)?.type !== 'html-segments')
        throw new TypeError('Invalid source resource.');
      sources.add(source.id);
      html += source.htmlBytes;
    }
    if (
      html !== value.uniqueHtmlBytes ||
      decoded > value.totalDecodedBytes ||
      Object.keys(value.viewSources).length < 1 ||
      Object.keys(value.viewSources).length > LARGE_OBJECT_LIMITS.views ||
      Object.values(value.viewSources).some((id) => !sources.has(id))
    )
      throw new TypeError('Invalid catalog accounting or source references.');
  }
  return value;
}

// These are metadata projections of immutable published contracts. HTML is validated
// separately after selected resources pass authenticated digest and size checks.
export function assertArtifactEnvelopeMetadata(value) {
  assertLargeObjectData(value);
  const shared = value?.schemaVersion === '1.1.0';
  const errors = validateJson(value, ARTIFACT_ENVELOPE_METADATA_SCHEMAS[shared ? 1 : 0]);
  if (errors.length) throw new TypeError('Invalid artifact envelope metadata.');
  const ids = new Set(value.artifacts.map((item) => item.id));
  if (ids.size !== value.artifacts.length || !ids.has(value.viewer.activeArtifactId))
    throw new TypeError('Invalid metadata view identity.');
  if (shared) {
    const sources = new Set(value.sources.map((item) => item.id));
    const used = new Set(value.artifacts.map((item) => item.sourceId));
    if (
      sources.size !== value.sources.length ||
      used.size !== sources.size ||
      [...used].some((id) => !sources.has(id))
    )
      throw new TypeError('Invalid metadata source identity.');
  }
  return value;
}
