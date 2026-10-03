/** Protocol 1.17 room-v3 and paste-v2 contracts; legacy formats remain frozen. */
import { assertLargeObjectData } from './bounded-json-data.mjs';
import { canonicalizeJson } from './canonical-json.mjs';
import { validateJson } from './json-schema.mjs';
export const ROOM_V3_READ_LIMITS = Object.freeze({
  pageBytes: 8 * 1024 * 1024,
  eventPageBytes: 1024 * 1024,
  eventPageCount: 100,
  aggregateBytes: 128 * 1024 * 1024,
  projectionBytes: 128 * 1024 * 1024,
  retainedEvents: 10000,
});
export const ROOM_V3_VERSION = '3.0.0';
export const ROOM_V3_API = '/api/v2/rooms';
export const ROOM_V3_GENESIS_HASH = `sha256:${'0'.repeat(64)}`;
export const ROOM_V3_CAPABILITIES = Object.freeze({
  read: 'room-read',
  reviewer: 'reviewer-write',
  owner: 'owner-verdict',
  management: 'room-management',
});
export const SHARING_CRYPTO_VERSION = '2.0.0';
export const SHARING_CRYPTO_CONTEXT = 'openplanr.sharing.aes-gcm.v2';
const id = { type: 'string', pattern: '^[A-Za-z0-9_-]{16,128}$' };
const token = { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' };
const sha = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const iso = { type: 'string', format: 'date-time', maxLength: 40 };
const signature = { type: 'string', pattern: '^[A-Za-z0-9_-]{86}$' };
const closed = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const schema = (name, properties, required) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `https://openplanr.dev/schemas/v1.17.0/${name}.schema.json`,
  'x-openplanr-contract': { id: name, version: '1.17.0' },
  ...closed(properties, required),
});
const ownerKey = closed({
  algorithm: { const: 'ECDSA-P256-SHA256' },
  encoding: { const: 'spki-base64url' },
  keyId: sha,
  value: { type: 'string', pattern: '^[A-Za-z0-9_-]+$', minLength: 86, maxLength: 342 },
});
const cipher = (limit) => ({
  iv: { type: 'string', pattern: '^[A-Za-z0-9_-]{16}$' },
  ciphertext: {
    type: 'string',
    pattern: '^[A-Za-z0-9_-]+$',
    minLength: 22,
    maxLength: Math.ceil((limit * 4) / 3),
  },
});
export const ROOM_V3_DESCRIPTOR_SCHEMA = schema('artifact-room-descriptor-v3', {
  schemaVersion: { const: ROOM_V3_VERSION },
  protocolVersion: { const: ROOM_V3_VERSION },
  roomId: id,
  reviewCommitment: digest,
  ownerKey,
  capabilities: closed(
    Object.fromEntries(
      Object.entries(ROOM_V3_CAPABILITIES).map(([key, value]) => [key, { const: value }]),
    ),
  ),
  createdAt: iso,
});
export const ROOM_V3_CREATE_SCHEMA = schema('artifact-room-create-v3', {
  schemaVersion: { const: ROOM_V3_VERSION },
  operation: { const: 'create' },
  roomId: id,
  creationId: token,
  ttl: { enum: ['1d', '7d', '30d'] },
  reviewCommitment: digest,
  ...cipher(5 * 1024 * 1024),
  ownerKey,
  readCapability: token,
  reviewerCapability: token,
  ownerCapability: token,
  manageCapability: token,
  signature,
});
export const ROOM_V3_EVENT_SCHEMA = schema('artifact-room-event-v3', {
  schemaVersion: { const: ROOM_V3_VERSION },
  protocolVersion: { const: ROOM_V3_VERSION },
  roomId: id,
  eventId: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,128}$' },
  sequence: { ...integer, minimum: 1 },
  predecessor: sha,
  kind: {
    enum: ['pin', 'reply', 'pin_status', 'recommendation', 'owner_decision', 'review_snapshot'],
  },
  reviewCommitment: digest,
  authorRole: { enum: ['owner', 'reviewer'] },
  authorKey: ownerKey,
  capability: { enum: ['reviewer-write', 'owner-verdict'] },
  createdAt: iso,
  ...cipher(256 * 1024),
  ciphertextDigest: sha,
  signature,
});
export const ROOM_V3_APPEND_SCHEMA = schema('artifact-room-append-v3', {
  schemaVersion: { const: ROOM_V3_VERSION },
  operation: { const: 'append' },
  expectedGeneration: integer,
  record: ROOM_V3_EVENT_SCHEMA,
});
export const ROOM_V3_READ_PAGE_SCHEMA = schema(
  'artifact-room-read-page-v3',
  {
    version: { const: 'v3' },
    descriptor: ROOM_V3_DESCRIPTOR_SCHEMA,
    expiresAt: iso,
    commentsEnabled: { type: 'boolean' },
    generation: integer,
    sequence: { ...integer, maximum: ROOM_V3_READ_LIMITS.retainedEvents },
    head: sha,
    cursor: { ...integer, maximum: ROOM_V3_READ_LIMITS.retainedEvents },
    eventBytes: { ...integer, maximum: ROOM_V3_READ_LIMITS.eventPageBytes },
    events: {
      type: 'array',
      maxItems: ROOM_V3_READ_LIMITS.eventPageCount,
      items: ROOM_V3_EVENT_SCHEMA,
    },
    nextCursor: {
      oneOf: [
        { ...integer, minimum: 1, maximum: ROOM_V3_READ_LIMITS.retainedEvents },
        { type: 'null' },
      ],
    },
    ...cipher(5 * 1024 * 1024),
  },
  [
    'version',
    'descriptor',
    'expiresAt',
    'commentsEnabled',
    'generation',
    'sequence',
    'head',
    'cursor',
    'eventBytes',
    'events',
    'nextCursor',
  ],
);
export const ROOM_V3_MANAGEMENT_SCHEMA = schema('artifact-room-management-v3', {
  schemaVersion: { const: ROOM_V3_VERSION },
  roomId: id,
  operation: { enum: ['pause', 'resume', 'delete'] },
  operationId: id,
  expectedGeneration: integer,
  signature,
});
export const PASTE_V2_SCHEMA = schema('artifact-paste-v2', {
  schemaVersion: { const: '2.0.0' },
  operation: { const: 'create' },
  id,
  creationId: token,
  ttl: { enum: ['1d', '7d', '30d'] },
  ...cipher(5 * 1024 * 1024),
});
export const SHARING_CRYPTO_AAD_SCHEMA = schema('sharing-crypto-aad', {
  version: { const: '2.0.0' },
  purpose: { enum: ['artifact-paste', 'room-envelope', 'room-event'] },
  objectId: id,
  recordId: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,128}$' },
});
export const PREVIEW_BRIDGE_MESSAGE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://openplanr.dev/schemas/v1.17.0/preview-bridge-message.schema.json',
  'x-openplanr-contract': { id: 'preview-bridge-message', version: '1.17.0' },
  oneOf: [
    schema('preview-bridge-ready', {
      schemaVersion: { const: '1.0.0' },
      channel: token,
      type: { const: 'ready' },
      viewId: id,
    }),
    schema('preview-bridge-navigate', {
      schemaVersion: { const: '1.0.0' },
      channel: token,
      type: { const: 'navigate' },
      viewId: id,
      screenId: id,
    }),
    schema('preview-bridge-select', {
      schemaVersion: { const: '1.0.0' },
      channel: token,
      type: { const: 'select' },
      viewId: id,
      elementId: id,
    }),
    schema('preview-bridge-state', {
      schemaVersion: { const: '1.0.0' },
      channel: token,
      type: { const: 'state' },
      viewId: id,
      state: closed({ session: { type: 'object' }, forms: { type: 'object' } }),
    }),
    schema('preview-bridge-failed', {
      schemaVersion: { const: '1.0.0' },
      channel: token,
      type: { const: 'failed' },
      viewId: id,
    }),
  ],
};
// Artifact view/screen/element IDs are semantic tokens, not opaque service object IDs.
for (const alternative of PREVIEW_BRIDGE_MESSAGE_SCHEMA.oneOf)
  for (const key of ['viewId', 'screenId', 'elementId'])
    if (alternative.properties[key])
      alternative.properties[key] = {
        type: 'string',
        pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$',
      };
export function assertPreviewBridgeMessage(value) {
  assertLargeObjectData(value);
  if (validateJson(value, PREVIEW_BRIDGE_MESSAGE_SCHEMA).length)
    throw new TypeError('Invalid preview bridge message.');
  if (value.type === 'state') {
    let keys = 0;
    const pending = [[value.state, 0]],
      seen = new Set();
    for (let entry = pending.pop(); entry; entry = pending.pop()) {
      const [item, depth] = entry;
      if (depth > 6) throw new RangeError('Preview state exceeds its depth limit.');
      if (item === null || typeof item === 'boolean') continue;
      if (typeof item === 'number') {
        if (!Number.isFinite(item)) throw new TypeError('Preview state numbers must be finite.');
        continue;
      }
      if (typeof item === 'string') {
        if (item.length > 8192) throw new RangeError('Preview state string is too long.');
        continue;
      }
      if (!item || typeof item !== 'object' || seen.has(item))
        throw new TypeError('Preview state must be acyclic JSON.');
      seen.add(item);
      if (Array.isArray(item)) {
        if (item.length > 128) throw new RangeError('Preview state array is too long.');
        for (const child of item) pending.push([child, depth + 1]);
      } else {
        if (
          Object.getPrototypeOf(item) !== Object.prototype &&
          Object.getPrototypeOf(item) !== null
        )
          throw new TypeError('Preview state must be plain JSON.');
        for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
          if (
            ++keys > 128 ||
            key.length > 256 ||
            ['__proto__', 'constructor', 'prototype'].includes(key) ||
            !('value' in descriptor)
          )
            throw new TypeError('Preview state key is invalid.');
          pending.push([descriptor.value, depth + 1]);
        }
      }
    }
    if (new TextEncoder().encode(canonicalizeJson(value.state)).byteLength > 16384)
      throw new RangeError('Preview state exceeds its byte limit.');
  }
  return value;
}
export const SHARING_SECURITY_SCHEMAS = Object.freeze({
  'preview-bridge-message': PREVIEW_BRIDGE_MESSAGE_SCHEMA,
  'artifact-room-descriptor-v3': ROOM_V3_DESCRIPTOR_SCHEMA,
  'artifact-room-create-v3': ROOM_V3_CREATE_SCHEMA,
  'artifact-room-read-page-v3': ROOM_V3_READ_PAGE_SCHEMA,
  'artifact-room-append-v3': ROOM_V3_APPEND_SCHEMA,
  'artifact-room-event-v3': ROOM_V3_EVENT_SCHEMA,
  'artifact-room-management-v3': ROOM_V3_MANAGEMENT_SCHEMA,
  'artifact-paste-v2': PASTE_V2_SCHEMA,
  'sharing-crypto-aad': SHARING_CRYPTO_AAD_SCHEMA,
});
function decode(value, limit) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length > Math.ceil((limit * 4) / 3))
    throw new TypeError('Invalid room encoding.');
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) =>
    char.charCodeAt(0),
  );
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  if (
    btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '') !== value ||
    bytes.byteLength > limit
  )
    throw new TypeError('Noncanonical room encoding.');
  return bytes;
}
export function assertSharingSecurityContract(value, kind) {
  if (kind === 'preview-bridge-message') return assertPreviewBridgeMessage(value);
  assertLargeObjectData(value);
  const selected = Object.hasOwn(SHARING_SECURITY_SCHEMAS, kind)
    ? SHARING_SECURITY_SCHEMAS[kind]
    : null;
  if (!selected || validateJson(value, selected).length) throw new TypeError(`Invalid ${kind}.`);
  if (kind === 'artifact-room-append-v3')
    assertSharingSecurityContract(value.record, 'artifact-room-event-v3');
  if (kind === 'artifact-room-read-page-v3') {
    const actual = new TextEncoder().encode(canonicalizeJson(value.events)).byteLength;
    if (
      actual !== value.eventBytes ||
      actual > ROOM_V3_READ_LIMITS.eventPageBytes ||
      new TextEncoder().encode(canonicalizeJson(value)).byteLength >
        ROOM_V3_READ_LIMITS.pageBytes ||
      value.cursor > value.sequence ||
      value.generation < value.sequence
    )
      throw new TypeError('Room page byte accounting or snapshot is invalid.');
    if (
      value.cursor === 0
        ? !value.iv || !value.ciphertext
        : Object.hasOwn(value, 'iv') || Object.hasOwn(value, 'ciphertext')
    )
      throw new TypeError('Only the first room page carries its envelope.');
    let last = value.cursor;
    for (const event of value.events) {
      if (event.sequence !== last + 1) throw new TypeError('Room page skips event history.');
      last = event.sequence;
    }
    if (
      last > value.sequence ||
      (value.nextCursor === null
        ? last !== value.sequence
        : !value.events.length || value.nextCursor !== last || last >= value.sequence)
    )
      throw new TypeError('Room page continuation is incomplete.');
  }
  if (value.ciphertext) {
    const bytes = decode(
      value.ciphertext,
      kind === 'artifact-room-event-v3' ? 256 * 1024 : 5 * 1024 * 1024,
    );
    if (bytes.byteLength < 16) throw new TypeError('Room ciphertext is too small.');
  }
  if (
    kind === 'artifact-room-create-v3' &&
    new Set([
      value.readCapability,
      value.reviewerCapability,
      value.ownerCapability,
      value.manageCapability,
    ]).size !== 4
  )
    throw new TypeError('Room capabilities must be distinct.');
  if (kind === 'artifact-room-event-v3') {
    const ownerKind = ['owner_decision', 'review_snapshot'].includes(value.kind);
    if (
      (value.authorRole === 'owner') !== ownerKind ||
      value.capability !== ROOM_V3_CAPABILITIES[value.authorRole]
    )
      throw new TypeError('Room event role is invalid.');
  }
  return value;
}
export function roomV3SignatureBytes(type, value) {
  if (!['create', 'event', 'management'].includes(type))
    throw new TypeError('Unknown room signature purpose.');
  const { signature: _signature, ...body } = value;
  return new TextEncoder().encode(
    canonicalizeJson({ context: `openplanr.artifact-live-room.${type}.v3`, ...body }),
  );
}
export async function verifyRoomV3Signature(
  type,
  value,
  publicKey,
  { crypto: provider = globalThis.crypto } = {},
) {
  try {
    const bytes = decode(publicKey.value, 256),
      hash = [...new Uint8Array(await provider.subtle.digest('SHA-256', bytes))]
        .map((part) => part.toString(16).padStart(2, '0'))
        .join('');
    if (
      publicKey.algorithm !== 'ECDSA-P256-SHA256' ||
      publicKey.encoding !== 'spki-base64url' ||
      publicKey.keyId !== `sha256:${hash}`
    )
      return false;
    const key = await provider.subtle.importKey(
      'spki',
      bytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return provider.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      decode(value.signature, 64),
      roomV3SignatureBytes(type, value),
    );
  } catch {
    return false;
  }
}
