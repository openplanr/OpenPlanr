import { base64UrlToBytes, bytesToBase64Url } from './codec.mjs';
import { decryptArtifactPayload } from './crypto.mjs';
import { ARTIFACT_ERROR_CODES, PipelineError } from '@openplanr/protocol/errors';

export const ARTIFACT_ROOM_PROTOCOL_VERSION = '2.0.0';
export const ARTIFACT_ROOM_SIGNATURE_ALGORITHM = 'ECDSA-P256-SHA256';
export const ARTIFACT_ROOM_PUBLIC_KEY_ENCODING = 'spki-base64url';
export const ARTIFACT_ROOM_SIGNATURE_CONTEXT = 'openplanr.artifact-live-room.event.v2';
export const ARTIFACT_ROOM_GENESIS_HASH = `sha256:${'0'.repeat(64)}`;
export const ARTIFACT_ROOM_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const ARTIFACT_ROOM_CAPABILITIES = Object.freeze({
  reviewer: 'reviewer-write',
  owner: 'owner-verdict',
  management: 'room-management',
});

const ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
const EVENT_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA_RE = /^sha256:[a-f0-9]{64}$/;
const REVIEW_RE = /^[a-f0-9]{64}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const OWNER_KINDS = new Set(['owner_decision', 'review_snapshot']);
const REVIEWER_KINDS = new Set(['pin', 'reply', 'pin_status', 'recommendation']);
const textEncoder = new TextEncoder();

function failure(code, message, fix = '') {
  throw new PipelineError(code, message, fix);
}

function cryptoProvider(value) {
  const provider = value ?? globalThis.crypto;
  if (!provider?.subtle || typeof provider.getRandomValues !== 'function') {
    failure(ARTIFACT_ERROR_CODES.BROWSER_UNSUPPORTED, 'Web Crypto is required for signed live review rooms.');
  }
  return provider;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, expected, label) {
  if (!isPlainObject(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, `${label} has an invalid shape.`);
  }
}

function assertUnicode(value, path) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, `Signed room value is not valid Unicode at ${path}.`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, `Signed room value is not valid Unicode at ${path}.`);
    }
  }
}

function canonical(value, path = '$', seen = new Set()) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    assertUnicode(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, `Signed room number is invalid at ${path}.`);
    return JSON.stringify(value);
  }
  if (!isPlainObject(value) && !Array.isArray(value)) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, `Signed room value is not JSON at ${path}.`);
  }
  if (seen.has(value)) failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, `Signed room value is cyclic at ${path}.`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const values = value.map((item, index) => {
        if (!Object.hasOwn(value, index)) failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, `Signed room array is sparse at ${path}.`);
        return canonical(item, `${path}[${index}]`, seen);
      });
      return `[${values.join(',')}]`;
    }
    const fields = Object.keys(value).sort().map((key) => {
      assertUnicode(key, `${path} key`);
      return `${JSON.stringify(key)}:${canonical(value[key], `${path}.${key}`, seen)}`;
    });
    return `{${fields.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

function canonicalBytes(value) {
  return textEncoder.encode(canonical(value));
}

function bytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Signed room binary value is invalid.');
}

async function sha256(value, provider) {
  const digest = await provider.subtle.digest('SHA-256', bytes(value));
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('')}`;
}

function decodeBase64(value, label, { min = 1, max = 1024 } = {}) {
  if (typeof value !== 'string' || !BASE64URL_RE.test(value) || value.includes('=')) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, `${label} is invalid.`);
  }
  try {
    const decoded = base64UrlToBytes(value, { label, maxBytes: max });
    if (decoded.byteLength < min || decoded.byteLength > max) throw new Error('invalid bounds');
    return decoded;
  } catch {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, `${label} is invalid.`);
  }
}

function validIso(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function normalizePublicKey(value, label = 'Live room author key') {
  assertExactKeys(value, ['algorithm', 'encoding', 'keyId', 'value'], label);
  if (value.algorithm !== ARTIFACT_ROOM_SIGNATURE_ALGORITHM
    || value.encoding !== ARTIFACT_ROOM_PUBLIC_KEY_ENCODING
    || !SHA_RE.test(value.keyId)) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, `${label} is invalid.`);
  }
  decodeBase64(value.value, `${label} bytes`, { min: 64, max: 256 });
  return Object.freeze({ ...value });
}

export function normalizeLiveRoomDescriptor(value) {
  assertExactKeys(value, [
    'schemaVersion', 'protocolVersion', 'roomId', 'reviewOf', 'ownerKey', 'capabilities', 'createdAt',
  ], 'Live room descriptor');
  if (value.schemaVersion !== '2.0.0'
    || value.protocolVersion !== ARTIFACT_ROOM_PROTOCOL_VERSION
    || typeof value.roomId !== 'string'
    || !ID_RE.test(value.roomId)
    || typeof value.reviewOf !== 'string'
    || !REVIEW_RE.test(value.reviewOf)
    || !validIso(value.createdAt)) {
    failure(ARTIFACT_ERROR_CODES.ROOM_INVALID, 'Live room descriptor is invalid.');
  }
  assertExactKeys(value.capabilities, ['reviewer', 'owner', 'management'], 'Live room capabilities');
  if (value.capabilities.reviewer !== ARTIFACT_ROOM_CAPABILITIES.reviewer
    || value.capabilities.owner !== ARTIFACT_ROOM_CAPABILITIES.owner
    || value.capabilities.management !== ARTIFACT_ROOM_CAPABILITIES.management) {
    failure(ARTIFACT_ERROR_CODES.ROOM_INVALID, 'Live room capabilities are invalid.');
  }
  const ownerKey = normalizePublicKey(value.ownerKey, 'Live room owner key');
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    protocolVersion: value.protocolVersion,
    roomId: value.roomId,
    reviewOf: value.reviewOf,
    ownerKey,
    capabilities: ARTIFACT_ROOM_CAPABILITIES,
    createdAt: value.createdAt,
  });
}

export async function createLiveRoomSigner({ role, crypto } = {}) {
  if (role !== 'owner' && role !== 'reviewer') {
    failure(ARTIFACT_ERROR_CODES.ROOM_FORBIDDEN, 'Live room signer role must be owner or reviewer.');
  }
  const provider = cryptoProvider(crypto);
  let keyPair;
  let publicBytes;
  try {
    keyPair = await provider.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    publicBytes = new Uint8Array(await provider.subtle.exportKey('spki', keyPair.publicKey));
  } catch {
    failure(ARTIFACT_ERROR_CODES.BROWSER_UNSUPPORTED, 'This runtime cannot create a signed live room key.');
  }
  const publicKey = Object.freeze({
    algorithm: ARTIFACT_ROOM_SIGNATURE_ALGORITHM,
    encoding: ARTIFACT_ROOM_PUBLIC_KEY_ENCODING,
    keyId: await sha256(publicBytes, provider),
    value: bytesToBase64Url(publicBytes),
  });
  const signer = { role, ...publicKey };
  Object.defineProperty(signer, 'sign', {
    enumerable: false,
    value: async (value) => {
      try {
        const signature = await provider.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          keyPair.privateKey,
          bytes(value),
        );
        return bytesToBase64Url(new Uint8Array(signature));
      } catch {
        failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live room event could not be signed.');
      }
    },
  });
  Object.defineProperty(signer, 'exportSecret', {
    enumerable: false,
    value: async () => {
      try {
        const privateBytes = new Uint8Array(await provider.subtle.exportKey('pkcs8', keyPair.privateKey));
        const secret = Object.freeze({
          schemaVersion: '1.0.0',
          kind: 'openplanr-live-room-signer',
          role,
          algorithm: ARTIFACT_ROOM_SIGNATURE_ALGORITHM,
          keyId: publicKey.keyId,
          publicKey: publicKey.value,
          privateKey: bytesToBase64Url(privateBytes),
        });
        privateBytes.fill(0);
        return secret;
      } catch {
        failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live room signer could not be exported to explicit secret custody.');
      }
    },
  });
  return Object.freeze(signer);
}

export async function exportLiveRoomSignerSecret(signer) {
  if (!signer || typeof signer.exportSecret !== 'function') {
    failure(ARTIFACT_ERROR_CODES.ROOM_FORBIDDEN, 'Live room signer does not permit explicit secret export.');
  }
  return signer.exportSecret();
}

export async function importLiveRoomSignerSecret(secret, { crypto } = {}) {
  assertExactKeys(
    secret,
    ['schemaVersion', 'kind', 'role', 'algorithm', 'keyId', 'publicKey', 'privateKey'],
    'Live room signer secret',
  );
  if (secret.schemaVersion !== '1.0.0'
    || secret.kind !== 'openplanr-live-room-signer'
    || (secret.role !== 'owner' && secret.role !== 'reviewer')
    || secret.algorithm !== ARTIFACT_ROOM_SIGNATURE_ALGORITHM
    || !SHA_RE.test(secret.keyId)) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live room signer secret is invalid.');
  }
  const provider = cryptoProvider(crypto);
  const publicBytes = decodeBase64(secret.publicKey, 'Live room signer public key', { min: 64, max: 256 });
  const privateBytes = decodeBase64(secret.privateKey, 'Live room signer private key', { min: 64, max: 512 });
  if (await sha256(publicBytes, provider) !== secret.keyId) {
    privateBytes.fill(0);
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live room signer secret key ID is invalid.');
  }
  let publicKey;
  let privateKey;
  try {
    [publicKey, privateKey] = await Promise.all([
      provider.subtle.importKey('spki', publicBytes, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']),
      provider.subtle.importKey('pkcs8', privateBytes, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']),
    ]);
  } catch {
    privateBytes.fill(0);
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live room signer secret key material is invalid.');
  }
  privateBytes.fill(0);
  const challenge = textEncoder.encode(ARTIFACT_ROOM_SIGNATURE_CONTEXT);
  const proof = await provider.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, challenge);
  if (!await provider.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, proof, challenge)) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live room signer secret key pair does not match.');
  }
  const signer = {
    role: secret.role,
    algorithm: ARTIFACT_ROOM_SIGNATURE_ALGORITHM,
    encoding: ARTIFACT_ROOM_PUBLIC_KEY_ENCODING,
    keyId: secret.keyId,
    value: secret.publicKey,
  };
  Object.defineProperty(signer, 'sign', {
    enumerable: false,
    value: async (value) => bytesToBase64Url(new Uint8Array(await provider.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      bytes(value),
    ))),
  });
  Object.defineProperty(signer, 'exportSecret', {
    enumerable: false,
    value: async () => Object.freeze(structuredClone(secret)),
  });
  return Object.freeze(signer);
}

export function createLiveRoomDescriptor({ roomId, reviewOf, ownerSigner, createdAt = new Date().toISOString() } = {}) {
  if (ownerSigner?.role !== 'owner' || typeof ownerSigner.sign !== 'function') {
    failure(ARTIFACT_ERROR_CODES.ROOM_FORBIDDEN, 'A client-held owner signer is required to create a v2 live room.');
  }
  return normalizeLiveRoomDescriptor({
    schemaVersion: '2.0.0',
    protocolVersion: ARTIFACT_ROOM_PROTOCOL_VERSION,
    roomId,
    reviewOf,
    ownerKey: {
      algorithm: ownerSigner.algorithm,
      encoding: ownerSigner.encoding,
      keyId: ownerSigner.keyId,
      value: ownerSigner.publicKey ?? ownerSigner.value,
    },
    capabilities: ARTIFACT_ROOM_CAPABILITIES,
    createdAt,
  });
}

function capabilityForRole(role) {
  if (role === 'owner') return ARTIFACT_ROOM_CAPABILITIES.owner;
  if (role === 'reviewer') return ARTIFACT_ROOM_CAPABILITIES.reviewer;
  failure(ARTIFACT_ERROR_CODES.ROOM_FORBIDDEN, 'Management capability cannot author live room events.');
}

function assertRoleKind(role, kind) {
  const allowed = role === 'owner' ? OWNER_KINDS : REVIEWER_KINDS;
  if (!allowed.has(kind)) {
    failure(
      ARTIFACT_ERROR_CODES.ROOM_FORBIDDEN,
      role === 'owner'
        ? 'Owner verdict capability cannot author reviewer feedback.'
        : 'Reviewer capability cannot author owner verdicts or snapshots.',
    );
  }
}

function normalizeCiphertext(value) {
  if (!isPlainObject(value) || value.version !== 'v1') {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live room ciphertext version is invalid.');
  }
  const iv = decodeBase64(value.iv, 'Live room ciphertext IV', { min: 12, max: 12 });
  const ciphertext = decodeBase64(value.ciphertext, 'Live room ciphertext', { min: 16, max: 5 * 1024 * 1024 });
  return { iv, ciphertext };
}

function assertSemanticShape(value, required, optional, label) {
  if (!isPlainObject(value)
    || required.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, `${label} has an invalid shape.`);
  }
}

function assertSemanticString(value, min, max, label) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, `${label} is invalid.`);
  }
}

function assertSemanticAuthor(value, label) {
  assertSemanticShape(value, ['name'], ['id'], label);
  assertSemanticString(value.name, 1, 256, label);
  if (value.id !== undefined) assertSemanticString(value.id, 1, 128, label);
}

function assertSemanticReply(value) {
  assertSemanticShape(value, ['id', 'author', 'comment', 'createdAt'], [], 'Live review reply');
  assertSemanticString(value.id, 1, 128, 'Live review reply ID');
  assertSemanticString(value.comment, 1, 65_536, 'Live review reply comment');
  if (!validIso(value.createdAt)) failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review reply timestamp is invalid.');
  assertSemanticAuthor(value.author, 'Live review reply author');
}

function assertSemanticPin(value) {
  assertSemanticShape(
    value,
    ['id', 'author', 'artifactId', 'region', 'viewport', 'intent', 'status', 'comment', 'replies', 'createdAt', 'updatedAt'],
    ['variant', 'anchor'],
    'Live review pin',
  );
  assertSemanticString(value.id, 1, 128, 'Live review pin ID');
  assertSemanticString(value.artifactId, 1, 128, 'Live review pin artifact ID');
  if (value.variant !== undefined) assertSemanticString(value.variant, 1, 128, 'Live review pin variant');
  assertSemanticString(value.comment, 1, 65_536, 'Live review pin comment');
  if (!['fix', 'improve', 'question'].includes(value.intent)
    || !['open', 'addressed', 'resolved'].includes(value.status)
    || !validIso(value.createdAt)
    || !validIso(value.updatedAt)
    || !Array.isArray(value.replies)
    || value.replies.length > 10_000) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review pin is invalid.');
  }
  assertSemanticShape(value.region, ['x', 'y', 'w', 'h'], [], 'Live review pin region');
  if (['x', 'y', 'w', 'h'].some((key) => typeof value.region[key] !== 'number'
    || value.region[key] < 0 || value.region[key] > 1)
    || value.region.x + value.region.w > 1
    || value.region.y + value.region.h > 1) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review pin region is invalid.');
  }
  assertSemanticShape(value.viewport, ['width', 'height'], [], 'Live review pin viewport');
  if (!Number.isInteger(value.viewport.width) || value.viewport.width < 1 || value.viewport.width > 16_384
    || !Number.isInteger(value.viewport.height) || value.viewport.height < 1 || value.viewport.height > 262_144) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review pin viewport is invalid.');
  }
  assertSemanticAuthor(value.author, 'Live review pin author');
  for (const reply of value.replies) assertSemanticReply(reply);
  if (value.anchor !== undefined) {
    assertSemanticShape(value.anchor, ['planrId'], ['screen'], 'Live review pin anchor');
    assertSemanticString(value.anchor.planrId, 1, 512, 'Live review pin anchor');
    if (value.anchor.screen !== undefined) assertSemanticString(value.anchor.screen, 1, 128, 'Live review pin screen');
  }
}

function assertSemanticReview(value, reviewOf) {
  assertSemanticShape(value, ['schemaVersion', 'reviewId', 'reviewOf', 'decision', 'overall', 'pins'], ['createdAt', 'updatedAt'], 'Live review snapshot');
  assertSemanticString(value.reviewId, 1, 128, 'Live review ID');
  assertSemanticString(value.overall, 0, 65_536, 'Live review overall note');
  if (value.schemaVersion !== '1.0.0'
    || value.reviewOf !== reviewOf
    || !['pending', 'approved', 'changes_requested'].includes(value.decision)
    || !Array.isArray(value.pins)
    || value.pins.length > 10_000
    || (value.createdAt !== undefined && !validIso(value.createdAt))
    || (value.updatedAt !== undefined && !validIso(value.updatedAt))) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review snapshot is invalid.');
  }
  for (const pin of value.pins) assertSemanticPin(pin);
}

function assertSemanticPayload(kind, payload, reviewOf) {
  if (kind === 'pin') return assertSemanticPin(payload);
  if (kind === 'reply') {
    assertSemanticShape(payload, ['pinId', 'reply'], [], 'Live review reply event');
    assertSemanticString(payload.pinId, 1, 128, 'Live review reply pin ID');
    return assertSemanticReply(payload.reply);
  }
  if (kind === 'pin_status') {
    assertSemanticShape(payload, ['pinId', 'status'], [], 'Live review status event');
    assertSemanticString(payload.pinId, 1, 128, 'Live review status pin ID');
    if (!['open', 'addressed', 'resolved'].includes(payload.status)) failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review pin status is invalid.');
    return;
  }
  if (kind === 'recommendation') {
    assertSemanticShape(payload, ['author', 'decision', 'overall'], [], 'Live review recommendation');
    assertSemanticString(payload.overall, 0, 65_536, 'Live review recommendation note');
    if (!['pending', 'approved', 'changes_requested'].includes(payload.decision)) failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review recommendation is invalid.');
    return assertSemanticAuthor(payload.author, 'Live review recommendation author');
  }
  if (kind === 'owner_decision') {
    assertSemanticShape(payload, ['decision'], ['overall'], 'Live review owner decision');
    if (!['approved', 'changes_requested'].includes(payload.decision)) failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review owner decision is invalid.');
    if (payload.overall !== undefined) assertSemanticString(payload.overall, 0, 65_536, 'Live review owner decision note');
    return;
  }
  assertSemanticShape(payload, ['review'], [], 'Live review snapshot event');
  assertSemanticReview(payload.review, reviewOf);
}

function normalizeSemanticEvent(value) {
  assertExactKeys(
    value,
    ['schemaVersion', 'eventId', 'roomId', 'reviewOf', 'kind', 'createdAt', 'payload'],
    'Live review plaintext event',
  );
  if (value.schemaVersion !== '1.0.0'
    || typeof value.eventId !== 'string'
    || !EVENT_ID_RE.test(value.eventId)
    || typeof value.roomId !== 'string'
    || !ID_RE.test(value.roomId)
    || typeof value.reviewOf !== 'string'
    || !REVIEW_RE.test(value.reviewOf)
    || ![...OWNER_KINDS, ...REVIEWER_KINDS].includes(value.kind)
    || !validIso(value.createdAt)
    || !isPlainObject(value.payload)) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review event is invalid.');
  }
  assertSemanticPayload(value.kind, value.payload, value.reviewOf);
  return structuredClone(value);
}

function signedBinding(record) {
  return {
    context: ARTIFACT_ROOM_SIGNATURE_CONTEXT,
    protocolVersion: record.protocolVersion,
    roomId: record.roomId,
    eventId: record.eventId,
    sequence: record.sequence,
    predecessor: record.predecessor,
    kind: record.kind,
    reviewOf: record.reviewOf,
    authorRole: record.authorRole,
    authorKeyId: record.authorKey.keyId,
    capability: record.capability,
    createdAt: record.createdAt,
    iv: record.iv,
    plaintextDigest: record.plaintextDigest,
    ciphertextDigest: record.ciphertextDigest,
  };
}

export function liveRoomSignedEventBytes(record) {
  return canonicalBytes(signedBinding(record));
}

function normalizeSignedRecord(value) {
  assertExactKeys(value, [
    'schemaVersion', 'protocolVersion', 'roomId', 'eventId', 'sequence', 'predecessor', 'kind', 'reviewOf',
    'authorRole', 'authorKey', 'capability', 'createdAt', 'iv', 'ciphertext', 'plaintextDigest', 'ciphertextDigest', 'signature',
  ], 'Signed live room event');
  if (value.schemaVersion !== '2.0.0'
    || value.protocolVersion !== ARTIFACT_ROOM_PROTOCOL_VERSION
    || typeof value.roomId !== 'string'
    || !ID_RE.test(value.roomId)
    || typeof value.eventId !== 'string'
    || !EVENT_ID_RE.test(value.eventId)
    || !Number.isSafeInteger(value.sequence)
    || value.sequence < 1
    || typeof value.predecessor !== 'string'
    || !SHA_RE.test(value.predecessor)
    || ![...OWNER_KINDS, ...REVIEWER_KINDS].includes(value.kind)
    || typeof value.reviewOf !== 'string'
    || !REVIEW_RE.test(value.reviewOf)
    || (value.authorRole !== 'owner' && value.authorRole !== 'reviewer')
    || typeof value.capability !== 'string'
    || !validIso(value.createdAt)
    || typeof value.iv !== 'string'
    || typeof value.ciphertext !== 'string'
    || typeof value.plaintextDigest !== 'string'
    || !SHA_RE.test(value.plaintextDigest)
    || typeof value.ciphertextDigest !== 'string'
    || !SHA_RE.test(value.ciphertextDigest)
    || typeof value.signature !== 'string') {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Signed live room event is invalid.');
  }
  decodeBase64(value.iv, 'Live room ciphertext IV', { min: 12, max: 12 });
  decodeBase64(value.ciphertext, 'Live room ciphertext', { min: 16, max: 5 * 1024 * 1024 });
  decodeBase64(value.signature, 'Live room signature', { min: 64, max: 80 });
  const authorKey = normalizePublicKey(value.authorKey);
  assertRoleKind(value.authorRole, value.kind);
  if (value.capability !== capabilityForRole(value.authorRole)) {
    failure(ARTIFACT_ERROR_CODES.ROOM_FORBIDDEN, 'Live room event capability does not match its author role.');
  }
  return Object.freeze({ ...value, authorKey });
}

async function publicKeyId(publicKey, provider) {
  return sha256(decodeBase64(publicKey.value, 'Live room author key bytes', { min: 64, max: 256 }), provider);
}

async function importVerifier(publicKey, provider) {
  try {
    return await provider.subtle.importKey(
      'spki',
      decodeBase64(publicKey.value, 'Live room author key bytes', { min: 64, max: 256 }),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
  } catch {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live room author key is invalid.');
  }
}

export async function createSignedLiveRoomEvent({
  descriptor: descriptorInput,
  event: eventInput,
  ciphertext,
  sequence,
  predecessor = ARTIFACT_ROOM_GENESIS_HASH,
  signer,
  key,
  crypto,
} = {}) {
  const descriptor = normalizeLiveRoomDescriptor(descriptorInput);
  const event = normalizeSemanticEvent(eventInput);
  const provider = cryptoProvider(crypto);
  if (!signer || typeof signer.sign !== 'function' || (signer.role !== 'owner' && signer.role !== 'reviewer')) {
    failure(ARTIFACT_ERROR_CODES.ROOM_FORBIDDEN, 'A client-held event signer is required.');
  }
  if (event.roomId !== descriptor.roomId || event.reviewOf !== descriptor.reviewOf) {
    failure(ARTIFACT_ERROR_CODES.DIGEST_MISMATCH, 'Live review event belongs to another room or artifact.');
  }
  assertRoleKind(signer.role, event.kind);
  if (!Number.isSafeInteger(sequence) || sequence < 1 || !SHA_RE.test(predecessor)) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review event ordering is invalid.');
  }
  const authorKey = normalizePublicKey({
    algorithm: signer.algorithm,
    encoding: signer.encoding,
    keyId: signer.keyId,
    value: signer.publicKey ?? signer.value,
  });
  if (signer.role === 'owner'
    && (authorKey.keyId !== descriptor.ownerKey.keyId || authorKey.value !== descriptor.ownerKey.value)) {
    failure(ARTIFACT_ERROR_CODES.ROOM_FORBIDDEN, 'Owner event signer does not match the room owner key.');
  }
  const encrypted = normalizeCiphertext(ciphertext);
  if (typeof key !== 'string') {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'The room decryption key is required before signing a live review event.');
  }
  let decrypted;
  try {
    const plaintext = await decryptArtifactPayload(
      { version: 'v1', iv: ciphertext.iv, ciphertext: ciphertext.ciphertext },
      { keyFragment: key, crypto: provider },
    );
    decrypted = normalizeSemanticEvent(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch (error) {
    if (error instanceof PipelineError && error.code === ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID) throw error;
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live room ciphertext does not contain a valid semantic event.');
  }
  if (canonical(decrypted) !== canonical(event)) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live room ciphertext does not match the semantic event being signed.');
  }
  const record = {
    schemaVersion: '2.0.0',
    protocolVersion: ARTIFACT_ROOM_PROTOCOL_VERSION,
    roomId: descriptor.roomId,
    eventId: event.eventId,
    sequence,
    predecessor,
    kind: event.kind,
    reviewOf: descriptor.reviewOf,
    authorRole: signer.role,
    authorKey,
    capability: capabilityForRole(signer.role),
    createdAt: event.createdAt,
    iv: ciphertext.iv,
    ciphertext: ciphertext.ciphertext,
    plaintextDigest: await sha256(canonicalBytes(event), provider),
    ciphertextDigest: await sha256(encrypted.ciphertext, provider),
  };
  return normalizeSignedRecord({ ...record, signature: await signer.sign(liveRoomSignedEventBytes(record)) });
}

export async function verifySignedLiveRoomEvent({
  descriptor: descriptorInput,
  record: recordInput,
  event: eventInput,
  expectedSequence,
  expectedPredecessor,
  authorizedCapability,
  key,
  crypto,
} = {}) {
  const descriptor = normalizeLiveRoomDescriptor(descriptorInput);
  const record = normalizeSignedRecord(recordInput);
  const provider = cryptoProvider(crypto);
  if (record.roomId !== descriptor.roomId || record.reviewOf !== descriptor.reviewOf) {
    failure(ARTIFACT_ERROR_CODES.DIGEST_MISMATCH, 'Signed live room event belongs to another room or artifact.');
  }
  if (authorizedCapability !== undefined && record.capability !== authorizedCapability) {
    failure(ARTIFACT_ERROR_CODES.ROOM_FORBIDDEN, 'Live room bearer capability cannot authorize this event role.');
  }
  if (expectedSequence !== undefined && record.sequence !== expectedSequence) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_REPLAY, 'Signed live room event sequence is stale or reordered.');
  }
  if (expectedPredecessor !== undefined && record.predecessor !== expectedPredecessor) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_REPLAY, 'Signed live room event predecessor is stale or reordered.');
  }
  if (await publicKeyId(record.authorKey, provider) !== record.authorKey.keyId) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Signed live room event author key ID is invalid.');
  }
  if (record.authorRole === 'owner'
    && (record.authorKey.keyId !== descriptor.ownerKey.keyId || record.authorKey.value !== descriptor.ownerKey.value)) {
    failure(ARTIFACT_ERROR_CODES.ROOM_FORBIDDEN, 'Signed owner event does not match the room owner key.');
  }
  const ciphertextBytes = decodeBase64(record.ciphertext, 'Live room ciphertext', { min: 16, max: 5 * 1024 * 1024 });
  if (await sha256(ciphertextBytes, provider) !== record.ciphertextDigest) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Signed live room event ciphertext digest is invalid.');
  }
  const verifier = await importVerifier(record.authorKey, provider);
  let valid = false;
  try {
    valid = await provider.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifier,
      decodeBase64(record.signature, 'Live room signature', { min: 64, max: 80 }),
      liveRoomSignedEventBytes(record),
    );
  } catch {}
  if (!valid) failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Signed live room event signature is invalid.');
  let event = eventInput === undefined ? null : normalizeSemanticEvent(eventInput);
  if (event && (event.eventId !== record.eventId
    || event.roomId !== record.roomId
    || event.reviewOf !== record.reviewOf
    || event.kind !== record.kind
    || event.createdAt !== record.createdAt)) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Signed live room event plaintext does not match its authenticated binding.');
  }
  if (event && await sha256(canonicalBytes(event), provider) !== record.plaintextDigest) {
    failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Signed live room event plaintext commitment is invalid.');
  }
  if (key !== undefined) {
    if (typeof key !== 'string') failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'The room decryption key is invalid.');
    let decrypted;
    try {
      const plaintext = await decryptArtifactPayload(
        { version: 'v1', iv: record.iv, ciphertext: record.ciphertext },
        { keyFragment: key, crypto: provider },
      );
      decrypted = normalizeSemanticEvent(JSON.parse(new TextDecoder().decode(plaintext)));
    } catch (error) {
      if (error instanceof PipelineError && error.code === ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID) throw error;
      failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Signed live room event plaintext could not be authenticated.');
    }
    if (await sha256(canonicalBytes(decrypted), provider) !== record.plaintextDigest) {
      failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Signed live room event plaintext does not match its authenticated commitment.');
    }
    if (event && canonical(decrypted) !== canonical(event)) {
      failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Signed live room event plaintext does not match its ciphertext.');
    }
    event = decrypted;
  }
  return Object.freeze({
    record,
    event,
    recordHash: await sha256(canonicalBytes(record), provider),
  });
}

export async function verifyLiveRoomEventChain({ descriptor: descriptorInput, entries = [], key, crypto } = {}) {
  const descriptor = normalizeLiveRoomDescriptor(descriptorInput);
  if (!Array.isArray(entries)) failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Signed live room event chain is invalid.');
  const provider = cryptoProvider(crypto);
  const seen = new Map();
  const events = [];
  const records = [];
  const replayedEventIds = [];
  let head = ARTIFACT_ROOM_GENESIS_HASH;
  let sequence = 1;
  for (const entry of entries) {
    if (!isPlainObject(entry) || !Object.hasOwn(entry, 'record')) {
      failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Signed live room event chain entry is invalid.');
    }
    const hasEvent = Object.hasOwn(entry, 'event');
    const identity = entry.record?.eventId;
    const replayBytes = canonical(hasEvent ? { record: entry.record, event: entry.event } : { record: entry.record });
    if (typeof identity === 'string' && seen.has(identity)) {
      if (seen.get(identity) !== replayBytes) {
        failure(ARTIFACT_ERROR_CODES.ROOM_EVENT_REPLAY, 'Signed live room event identity was replayed with divergent bytes.');
      }
      replayedEventIds.push(identity);
      continue;
    }
    const verified = await verifySignedLiveRoomEvent({
      descriptor,
      record: entry.record,
      ...(hasEvent ? { event: entry.event, key } : {}),
      expectedSequence: sequence,
      expectedPredecessor: head,
      crypto: provider,
    });
    seen.set(verified.record.eventId, replayBytes);
    records.push(verified.record);
    if (verified.event) events.push(verified.event);
    head = verified.recordHash;
    sequence += 1;
  }
  return Object.freeze({
    descriptor,
    records: Object.freeze(records),
    events: Object.freeze(events),
    head,
    generation: records.length,
    replayedEventIds: Object.freeze(replayedEventIds),
  });
}
