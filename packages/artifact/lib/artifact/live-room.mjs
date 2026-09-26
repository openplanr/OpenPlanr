import {
  ARTIFACT_COMPRESSED_LIMIT,
  bytesToBase64Url,
  canonicalArtifactJson,
  compressArtifactPayload,
  decodeCompressedArtifactPayload,
} from './codec.mjs';
import {
  decryptArtifactPayload,
  encryptArtifactPayload,
  generateArtifactEncryptionKey,
} from './crypto.mjs';
import {
  ARTIFACT_ROOM_CAPABILITIES,
  ARTIFACT_ROOM_GENESIS_HASH,
  ARTIFACT_ROOM_PROTOCOL_VERSION,
  createLiveRoomSigner,
  createSignedLiveRoomEvent,
  exportLiveRoomSignerSecret,
  importLiveRoomSignerSecret,
  normalizeLiveRoomDescriptor,
  verifySignedLiveRoomEvent,
  verifyLiveRoomEventChain,
} from './live-room-integrity.mjs';
import { ARTIFACT_ERROR_CODES, PipelineError } from '@openplanr/protocol/errors';

export const ARTIFACT_ROOM_VERSION = 'v1';
export const ARTIFACT_ROOM_EVENT_KINDS = Object.freeze([
  'pin',
  'reply',
  'pin_status',
  'recommendation',
  'owner_decision',
  'review_snapshot',
]);
export const ARTIFACT_ROOM_TTLS = Object.freeze(['1d', '7d', '30d']);

const ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
const ARTIFACT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const EVENT_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const SHA_RE = /^[a-f0-9]{64}$/;
const HASH_RE = /^sha256:[a-f0-9]{64}$/;
const MAX_ARTIFACT_HTML_BYTES = 10 * 1024 * 1024;
const LIVE_ROOM_PREPARATION_VERSION = '1.0.0';
const LIVE_ROOM_PREPARATION_KIND = 'openplanr-live-room-preparation';
const LIVE_ROOM_RECOVERY_KIND = 'openplanr-live-room-recovery';
const liveRoomPreparations = new WeakMap();

function error(code, message, fix = '', details = undefined) {
  return new PipelineError(code, message, fix, details);
}
function clone(value) {
  return structuredClone(value);
}
function nowIso(now = () => new Date()) {
  const value = now();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
function validIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function randomToken(crypto = globalThis.crypto) {
  return bytesToBase64Url(generateArtifactEncryptionKey({ crypto }));
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}
function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function sha256Hex(value, crypto = globalThis.crypto) {
  if (!crypto?.subtle)
    throw error(
      ARTIFACT_ERROR_CODES.BROWSER_UNSUPPORTED,
      'Web Crypto is required for live review rooms.',
    );
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  return [...digest].map((item) => item.toString(16).padStart(2, '0')).join('');
}
function exactKeys(value, required, optional = []) {
  if (!isRecord(value) || required.some((key) => !Object.hasOwn(value, key))) return false;
  const allowed = new Set([...required, ...optional]);
  return Object.keys(value).every((key) => allowed.has(key));
}
function bounded(value, min, max) {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}
function assertAuthor(value, label) {
  if (
    !exactKeys(value, ['name'], ['id']) ||
    !bounded(value.name, 1, 256) ||
    (value.id !== undefined && !bounded(value.id, 1, 128))
  ) {
    throw error(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, `${label} is invalid.`);
  }
}
function assertReply(value) {
  if (
    !exactKeys(value, ['id', 'author', 'comment', 'createdAt']) ||
    !bounded(value.id, 1, 128) ||
    !bounded(value.comment, 1, 65_536) ||
    !validIso(value.createdAt)
  ) {
    throw error(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review reply is invalid.');
  }
  assertAuthor(value.author, 'Live review reply author');
}
function assertPin(value) {
  const required = [
    'id',
    'author',
    'artifactId',
    'region',
    'viewport',
    'intent',
    'status',
    'comment',
    'replies',
    'createdAt',
    'updatedAt',
  ];
  if (
    !exactKeys(value, required, ['variant', 'anchor']) ||
    !bounded(value.id, 1, 128) ||
    !bounded(value.artifactId, 1, 128) ||
    (value.variant !== undefined && !bounded(value.variant, 1, 128)) ||
    !['fix', 'improve', 'question'].includes(value.intent) ||
    !['open', 'addressed', 'resolved'].includes(value.status) ||
    !bounded(value.comment, 1, 65_536) ||
    !validIso(value.createdAt) ||
    !validIso(value.updatedAt) ||
    !Array.isArray(value.replies) ||
    value.replies.length > 10_000 ||
    !exactKeys(value.region, ['x', 'y', 'w', 'h']) ||
    ['x', 'y', 'w', 'h'].some(
      (key) =>
        typeof value.region[key] !== 'number' || value.region[key] < 0 || value.region[key] > 1,
    ) ||
    value.region.x + value.region.w > 1 ||
    value.region.y + value.region.h > 1 ||
    !exactKeys(value.viewport, ['width', 'height']) ||
    !Number.isInteger(value.viewport.width) ||
    value.viewport.width < 1 ||
    value.viewport.width > 16_384 ||
    !Number.isInteger(value.viewport.height) ||
    value.viewport.height < 1 ||
    value.viewport.height > 262_144
  ) {
    throw error(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review pin is invalid.');
  }
  assertAuthor(value.author, 'Live review pin author');
  if (
    value.anchor !== undefined &&
    (!exactKeys(value.anchor, ['planrId'], ['screen']) ||
      !bounded(value.anchor.planrId, 1, 512) ||
      (value.anchor.screen !== undefined && !bounded(value.anchor.screen, 1, 128)))
  ) {
    throw error(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review pin anchor is invalid.');
  }
  for (const reply of value.replies) assertReply(reply);
}
function assertReview(value, reviewOf) {
  if (
    !exactKeys(
      value,
      ['schemaVersion', 'reviewId', 'reviewOf', 'decision', 'overall', 'pins'],
      ['createdAt', 'updatedAt'],
    ) ||
    value.schemaVersion !== '1.0.0' ||
    !bounded(value.reviewId, 1, 128) ||
    value.reviewOf !== reviewOf ||
    !['pending', 'approved', 'changes_requested'].includes(value.decision) ||
    !bounded(value.overall, 0, 65_536) ||
    !Array.isArray(value.pins) ||
    value.pins.length > 10_000 ||
    (value.createdAt !== undefined && !validIso(value.createdAt)) ||
    (value.updatedAt !== undefined && !validIso(value.updatedAt))
  ) {
    throw error(
      ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID,
      'Live review snapshot is invalid or belongs to another artifact.',
    );
  }
  for (const pin of value.pins) assertPin(pin);
}
function assertEventPayload(kind, payload, reviewOf) {
  if (!isRecord(payload))
    throw error(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review event payload is invalid.');
  if (kind === 'pin') return assertPin(payload);
  if (kind === 'reply') {
    if (!exactKeys(payload, ['pinId', 'reply']) || !bounded(payload.pinId, 1, 128))
      throw error(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review reply event is invalid.');
    return assertReply(payload.reply);
  }
  if (kind === 'pin_status') {
    if (
      !exactKeys(payload, ['pinId', 'status']) ||
      !bounded(payload.pinId, 1, 128) ||
      !['open', 'addressed', 'resolved'].includes(payload.status)
    )
      throw error(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review status event is invalid.');
    return;
  }
  if (kind === 'recommendation') {
    if (
      !exactKeys(payload, ['author', 'decision', 'overall']) ||
      !['pending', 'approved', 'changes_requested'].includes(payload.decision) ||
      !bounded(payload.overall, 0, 65_536)
    )
      throw error(
        ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID,
        'Live review recommendation is invalid.',
      );
    return assertAuthor(payload.author, 'Live review recommendation author');
  }
  if (kind === 'owner_decision') {
    if (
      !exactKeys(payload, ['decision'], ['overall']) ||
      !['approved', 'changes_requested'].includes(payload.decision) ||
      (payload.overall !== undefined && !bounded(payload.overall, 0, 65_536))
    )
      throw error(
        ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID,
        'Live review owner decision is invalid.',
      );
    return;
  }
  if (kind === 'review_snapshot') {
    if (!exactKeys(payload, ['review']))
      throw error(
        ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID,
        'Live review snapshot event is invalid.',
      );
    return assertReview(payload.review, reviewOf);
  }
  throw error(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review event kind is invalid.');
}
function assertEnvelope(value) {
  if (
    !exactKeys(value, ['schemaVersion', 'artifacts', 'viewer'], ['review']) ||
    value.schemaVersion !== '1.0.0' ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length < 1 ||
    value.artifacts.length > 256 ||
    !isRecord(value.viewer)
  ) {
    throw error(ARTIFACT_ERROR_CODES.ENVELOPE_INVALID, 'Live review artifact envelope is invalid.');
  }
  return value;
}
async function digestEnvelope(value, crypto = globalThis.crypto) {
  assertEnvelope(value);
  if (!crypto?.subtle)
    throw error(
      ARTIFACT_ERROR_CODES.BROWSER_UNSUPPORTED,
      'Web Crypto is required for live review rooms.',
    );
  const ids = new Set();
  for (const artifact of value.artifacts) {
    if (
      !exactKeys(artifact, ['id', 'kind', 'title', 'sha256', 'html', 'viewport', 'colorScheme']) ||
      !bounded(artifact.id, 1, 128) ||
      !ARTIFACT_ID_RE.test(artifact.id) ||
      ids.has(artifact.id) ||
      artifact.kind !== 'html' ||
      !bounded(artifact.title, 1, 512) ||
      !bounded(artifact.html, 1, Number.MAX_SAFE_INTEGER) ||
      new TextEncoder().encode(artifact.html).byteLength > MAX_ARTIFACT_HTML_BYTES ||
      !SHA_RE.test(artifact.sha256) ||
      !exactKeys(artifact.viewport, ['width', 'height']) ||
      !Number.isInteger(artifact.viewport.width) ||
      artifact.viewport.width < 1 ||
      artifact.viewport.width > 16_384 ||
      !Number.isInteger(artifact.viewport.height) ||
      artifact.viewport.height < 1 ||
      artifact.viewport.height > 16_384 ||
      !['light', 'dark'].includes(artifact.colorScheme)
    )
      throw error(
        ARTIFACT_ERROR_CODES.ENVELOPE_INVALID,
        'Live review artifact envelope is invalid.',
      );
    ids.add(artifact.id);
    const normalized = artifact.html.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized)),
    );
    const actual = [...digest].map((item) => item.toString(16).padStart(2, '0')).join('');
    if (actual !== artifact.sha256)
      throw error(
        ARTIFACT_ERROR_CODES.DIGEST_MISMATCH,
        'Live review artifact HTML digest is invalid.',
      );
  }
  if (
    !exactKeys(value.viewer, ['mode', 'activeArtifactId'], ['presentation']) ||
    !['single', 'variants'].includes(value.viewer.mode) ||
    !bounded(value.viewer.activeArtifactId, 1, 128) ||
    !ids.has(value.viewer.activeArtifactId) ||
    (value.viewer.presentation !== undefined &&
      !['document', 'canvas'].includes(value.viewer.presentation))
  ) {
    throw error(ARTIFACT_ERROR_CODES.ENVELOPE_INVALID, 'Live review artifact viewer is invalid.');
  }
  const reviewFree = {
    schemaVersion: value.schemaVersion,
    artifacts: value.artifacts,
    viewer: value.viewer,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(reviewFree)));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const digest = [...hash].map((item) => item.toString(16).padStart(2, '0')).join('');
  if (value.review !== undefined) assertReview(value.review, digest);
  return digest;
}

function validateId(value, label = 'room ID') {
  if (typeof value !== 'string' || !ID_RE.test(value))
    throw error(ARTIFACT_ERROR_CODES.ROOM_INVALID, `${label} is invalid.`);
  return value;
}
function validateKey(value, label) {
  if (typeof value !== 'string' || !KEY_RE.test(value))
    throw error(ARTIFACT_ERROR_CODES.ROOM_INVALID, `${label} is invalid.`);
  return value;
}
function validateDigest(value) {
  if (typeof value !== 'string' || !SHA_RE.test(value))
    throw error(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Room event artifact digest is invalid.');
  return value;
}

function isExactLoopback(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

function normalizeServiceUrl(source, { roomLink = false } = {}) {
  let url;
  try {
    url = new URL(source);
  } catch {
    throw error(ARTIFACT_ERROR_CODES.ROOM_INVALID, 'Live review service URL is malformed.');
  }
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && isExactLoopback(url.hostname))) ||
    (!roomLink && (url.pathname !== '/' || url.search || url.hash))
  ) {
    throw error(
      ARTIFACT_ERROR_CODES.ROOM_INVALID,
      'Live review service URLs require HTTPS, except exact loopback HTTP, and cannot contain credentials or redirects.',
    );
  }
  return url;
}

function publicOwnerKey(ownerSigner) {
  return Object.freeze({
    algorithm: ownerSigner.algorithm,
    encoding: ownerSigner.encoding,
    keyId: ownerSigner.keyId,
    value: ownerSigner.publicKey ?? ownerSigner.value,
  });
}

function liveRoomPreparationState(prepared) {
  const state = isRecord(prepared) ? liveRoomPreparations.get(prepared) : undefined;
  if (!state) {
    throw error(
      ARTIFACT_ERROR_CODES.ROOM_INVALID,
      'Live review room creation requires an intact client-held preparation.',
    );
  }
  return state;
}

/**
 * Prepare every secret and byte needed for one retry-safe live-room creation.
 * The returned object serializes only public metadata; URL capabilities, the
 * owner signer, ciphertext, and the create identity stay in a private WeakMap.
 */
export async function prepareLiveReviewRoom(
  envelope,
  {
    baseUrl = 'https://share.openplanr.dev',
    ttl = '7d',
    ownerSigner: suppliedOwnerSigner,
    crypto,
  } = {},
) {
  assertEnvelope(envelope);
  if (!ARTIFACT_ROOM_TTLS.includes(ttl)) {
    throw error(ARTIFACT_ERROR_CODES.ROOM_INVALID, 'Live review TTL must be 1d, 7d, or 30d.');
  }
  const base = normalizeServiceUrl(baseUrl);
  const ownerSigner =
    suppliedOwnerSigner ?? (await createLiveRoomSigner({ role: 'owner', crypto }));
  if (ownerSigner?.role !== 'owner' || typeof ownerSigner.sign !== 'function') {
    throw error(ARTIFACT_ERROR_CODES.ROOM_FORBIDDEN, 'A client-held owner signer is required.');
  }
  const reviewOf = await digestEnvelope(envelope, crypto);
  const inputDigest = await sha256Hex(canonicalArtifactJson(envelope), crypto);
  const preparedPayload = compressArtifactPayload(envelope);
  const encrypted = await encryptArtifactPayload(preparedPayload.compressed, { crypto });
  const roomId = randomToken(crypto);
  const creationId = randomToken(crypto);
  const reviewerCapability = randomToken(crypto);
  const ownerCapability = randomToken(crypto);
  const manageCapability = randomToken(crypto);
  const ownerKey = publicOwnerKey(ownerSigner);
  const links = createLiveRoomLinks({
    baseUrl: base.origin,
    roomId,
    key: encrypted.keyFragment,
    writeCapability: reviewerCapability,
    ownerCapability,
    manageCapability,
  });
  const requestBody = Object.freeze({
    schemaVersion: '2.0.0',
    operation: 'create',
    roomId,
    creationId,
    ttl,
    reviewOf,
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
    ownerKey,
    reviewerCapability,
    ownerCapability,
    manageCapability,
  });
  const prepared = {
    schemaVersion: LIVE_ROOM_PREPARATION_VERSION,
    kind: LIVE_ROOM_PREPARATION_KIND,
    protocolVersion: ARTIFACT_ROOM_PROTOCOL_VERSION,
    id: roomId,
    roomId,
    reviewOf,
    ttl,
    ownerKey,
  };
  Object.defineProperties(prepared, {
    url: { enumerable: false, value: links.url },
    ownerUrl: { enumerable: false, value: links.ownerUrl },
    manageUrl: { enumerable: false, value: links.manageUrl },
    ownerSigner: { enumerable: false, value: ownerSigner },
  });
  Object.freeze(prepared);
  liveRoomPreparations.set(prepared, {
    baseOrigin: base.origin,
    dispatchCount: 0,
    inputDigest,
    links,
    ownerSigner,
    requestBody,
  });
  return prepared;
}

/** Explicitly export the pre-effect recovery material selected by the owner. */
export async function exportLiveRoomRecoveryBundle(prepared) {
  const state = liveRoomPreparationState(prepared);
  const ownerSigner = await exportLiveRoomSignerSecret(state.ownerSigner);
  return Object.freeze({
    schemaVersion: LIVE_ROOM_PREPARATION_VERSION,
    kind: LIVE_ROOM_RECOVERY_KIND,
    protocolVersion: ARTIFACT_ROOM_PROTOCOL_VERSION,
    id: prepared.roomId,
    roomId: prepared.roomId,
    reviewOf: prepared.reviewOf,
    ttl: prepared.ttl,
    ownerKey: prepared.ownerKey,
    url: state.links.url,
    ownerUrl: state.links.ownerUrl,
    manageUrl: state.links.manageUrl,
    ownerSigner,
  });
}

/** Validate an explicitly supplied recovery file and rehydrate its owner signer. */
export async function importLiveRoomRecoveryBundle(value, { crypto } = {}) {
  if (
    !exactKeys(value, [
      'schemaVersion',
      'kind',
      'protocolVersion',
      'id',
      'roomId',
      'reviewOf',
      'ttl',
      'ownerKey',
      'url',
      'ownerUrl',
      'manageUrl',
      'ownerSigner',
    ]) ||
    value.schemaVersion !== LIVE_ROOM_PREPARATION_VERSION ||
    value.kind !== LIVE_ROOM_RECOVERY_KIND ||
    value.protocolVersion !== ARTIFACT_ROOM_PROTOCOL_VERSION ||
    value.id !== value.roomId ||
    !ID_RE.test(value.roomId) ||
    !SHA_RE.test(value.reviewOf) ||
    !ARTIFACT_ROOM_TTLS.includes(value.ttl)
  ) {
    throw error(ARTIFACT_ERROR_CODES.ROOM_INVALID, 'Live review recovery bundle is invalid.');
  }
  const descriptor = normalizeLiveRoomDescriptor({
    schemaVersion: ARTIFACT_ROOM_PROTOCOL_VERSION,
    protocolVersion: ARTIFACT_ROOM_PROTOCOL_VERSION,
    roomId: value.roomId,
    reviewOf: value.reviewOf,
    ownerKey: value.ownerKey,
    capabilities: ARTIFACT_ROOM_CAPABILITIES,
    createdAt: '2000-01-01T00:00:00.000Z',
  });
  const review = parseLiveRoomLink(value.url);
  const owner = parseLiveRoomLink(value.ownerUrl);
  const management = parseLiveRoomLink(value.manageUrl);
  if (
    review.role !== 'reviewer' ||
    owner.role !== 'owner' ||
    management.role !== 'management' ||
    review.origin !== owner.origin ||
    review.origin !== management.origin ||
    review.roomId !== value.roomId ||
    owner.roomId !== value.roomId ||
    management.roomId !== value.roomId ||
    review.key !== owner.key ||
    review.key !== management.key ||
    new Set([review.write, owner.owner, management.manage]).size !== 3
  ) {
    throw error(
      ARTIFACT_ERROR_CODES.ROOM_INVALID,
      'Live review recovery bundle capabilities do not describe one room.',
    );
  }
  const ownerSigner = await importLiveRoomSignerSecret(value.ownerSigner, { crypto });
  if (
    ownerSigner.role !== 'owner' ||
    ownerSigner.keyId !== descriptor.ownerKey.keyId ||
    (ownerSigner.publicKey ?? ownerSigner.value) !== descriptor.ownerKey.value
  ) {
    throw error(
      ARTIFACT_ERROR_CODES.ROOM_FORBIDDEN,
      'Live review recovery owner key does not match the room.',
    );
  }
  const recovered = {
    schemaVersion: value.schemaVersion,
    kind: value.kind,
    protocolVersion: value.protocolVersion,
    id: value.id,
    roomId: value.roomId,
    reviewOf: value.reviewOf,
    ttl: value.ttl,
    ownerKey: descriptor.ownerKey,
  };
  Object.defineProperties(recovered, {
    url: { enumerable: false, value: value.url },
    ownerUrl: { enumerable: false, value: value.ownerUrl },
    manageUrl: { enumerable: false, value: value.manageUrl },
    ownerSigner: { enumerable: false, value: ownerSigner },
  });
  return Object.freeze(recovered);
}

/** Recover and authenticate a committed room from a pre-effect recovery file. */
export async function recoverLiveReviewRoom(value, { client, crypto } = {}) {
  const recovered = await importLiveRoomRecoveryBundle(value, { crypto });
  const room = await hydrateLiveReviewRoom(recovered.ownerUrl, { client, crypto });
  if (
    room.descriptor?.roomId !== recovered.roomId ||
    room.descriptor?.reviewOf !== recovered.reviewOf ||
    room.descriptor?.ownerKey?.keyId !== recovered.ownerKey.keyId ||
    room.descriptor?.ownerKey?.value !== recovered.ownerKey.value
  ) {
    throw error(
      ARTIFACT_ERROR_CODES.ROOM_FORBIDDEN,
      'Live review recovery bundle does not match the committed room descriptor.',
    );
  }
  const result = { ...room };
  Object.defineProperty(result, 'ownerSigner', { enumerable: false, value: recovered.ownerSigner });
  return Object.freeze(result);
}

export function parseLiveRoomLink(source) {
  const url = normalizeServiceUrl(source, { roomLink: true });
  const room = /^\/r\/([A-Za-z0-9_-]{16,128})\/?$/.exec(url.pathname)?.[1];
  const fragment = new URLSearchParams(url.hash.slice(1));
  const keys = [...fragment.keys()];
  if (
    !room ||
    url.search ||
    keys.some((key) => !['k', 'w', 'o', 'm'].includes(key)) ||
    keys.some((key) => fragment.getAll(key).length !== 1)
  ) {
    throw error(ARTIFACT_ERROR_CODES.ROOM_INVALID, 'Live review URL is malformed.');
  }
  const key = validateKey(fragment.get('k'), 'Live review decryption key');
  const write = fragment.get('w');
  const owner = fragment.get('o');
  const manage = fragment.get('m');
  if (write !== null) validateKey(write, 'Live review write capability');
  if (owner !== null) validateKey(owner, 'Live review owner capability');
  if (manage !== null) validateKey(manage, 'Live review management capability');
  if ([write, owner, manage].filter((value) => value !== null).length > 1) {
    throw error(
      ARTIFACT_ERROR_CODES.ROOM_INVALID,
      'A live review URL can expose only one scoped capability.',
    );
  }
  return Object.freeze({
    origin: url.origin,
    roomId: room,
    key,
    role: write ? 'reviewer' : owner ? 'owner' : manage ? 'management' : 'reader',
    ...(write ? { write } : {}),
    ...(owner ? { owner } : {}),
    ...(manage ? { manage } : {}),
  });
}

export function createLiveRoomLinks({
  baseUrl = 'https://share.openplanr.dev',
  roomId,
  key,
  writeCapability,
  ownerCapability,
  manageCapability,
}) {
  const base = normalizeServiceUrl(baseUrl);
  validateId(roomId);
  validateKey(key, 'Live review decryption key');
  validateKey(writeCapability, 'Live review write capability');
  validateKey(ownerCapability, 'Live review owner capability');
  validateKey(manageCapability, 'Live review management capability');
  const review = new URL(`/r/${roomId}`, base);
  review.hash = new URLSearchParams({ k: key, w: writeCapability }).toString();
  const owner = new URL(`/r/${roomId}`, base);
  owner.hash = new URLSearchParams({ k: key, o: ownerCapability }).toString();
  const manage = new URL(`/r/${roomId}`, base);
  manage.hash = new URLSearchParams({ k: key, m: manageCapability }).toString();
  return Object.freeze({
    url: review.toString(),
    ownerUrl: owner.toString(),
    manageUrl: manage.toString(),
  });
}

export function createLiveRoomEvent({
  roomId,
  reviewOf,
  kind,
  payload,
  eventId = globalThis.crypto?.randomUUID?.(),
  createdAt = nowIso(),
} = {}) {
  validateId(roomId);
  validateDigest(reviewOf);
  if (typeof eventId !== 'string' || !EVENT_ID_RE.test(eventId))
    throw error(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Room event ID is invalid.');
  if (
    !ARTIFACT_ROOM_EVENT_KINDS.includes(kind) ||
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    !validIso(createdAt)
  ) {
    throw error(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review event is invalid.');
  }
  assertEventPayload(kind, payload, reviewOf);
  return Object.freeze({
    schemaVersion: '1.0.0',
    eventId,
    roomId,
    reviewOf,
    kind,
    createdAt,
    payload: clone(payload),
  });
}

function withoutUpdatedAt(value) {
  if (!isRecord(value)) return value;
  const { updatedAt: _updatedAt, ...rest } = value;
  return rest;
}

function equalJson(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

/** Convert one coherent review-controller mutation into the least-authority room event. */
export function createLiveRoomEventFromReviewChange({
  roomId,
  reviewOf,
  role,
  previousReview,
  nextReview,
  author,
  eventId,
  createdAt,
} = {}) {
  assertReview(previousReview, reviewOf);
  assertReview(nextReview, reviewOf);
  const eventOptions = { roomId, reviewOf, eventId, createdAt };
  if (role === 'owner') {
    if (
      !equalJson(previousReview.pins, nextReview.pins) ||
      !['approved', 'changes_requested'].includes(nextReview.decision) ||
      (previousReview.decision === nextReview.decision &&
        previousReview.overall === nextReview.overall)
    ) {
      throw error(
        ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID,
        'Owner review changes must be one explicit verdict over the current reviewed digest.',
      );
    }
    return createLiveRoomEvent({
      ...eventOptions,
      kind: 'owner_decision',
      payload: { decision: nextReview.decision, overall: nextReview.overall },
    });
  }
  if (role !== 'reviewer')
    throw error(
      ARTIFACT_ERROR_CODES.ROOM_FORBIDDEN,
      'This room authority cannot author review events.',
    );

  if (
    nextReview.pins.length === previousReview.pins.length + 1 &&
    previousReview.pins.every((pin) =>
      nextReview.pins.some((candidate) => equalJson(pin, candidate)),
    )
  ) {
    const added = nextReview.pins.find(
      (pin) => !previousReview.pins.some(({ id }) => id === pin.id),
    );
    if (added) return createLiveRoomEvent({ ...eventOptions, kind: 'pin', payload: added });
  }
  if (nextReview.pins.length === previousReview.pins.length) {
    for (const previousPin of previousReview.pins) {
      const nextPin = nextReview.pins.find(({ id }) => id === previousPin.id);
      if (!nextPin) continue;
      if (
        nextPin.replies.length === previousPin.replies.length + 1 &&
        previousPin.replies.every((reply) =>
          nextPin.replies.some((candidate) => equalJson(reply, candidate)),
        ) &&
        equalJson(
          withoutUpdatedAt({ ...previousPin, replies: [] }),
          withoutUpdatedAt({ ...nextPin, replies: [] }),
        )
      ) {
        const reply = nextPin.replies.find(
          (candidate) => !previousPin.replies.some(({ id }) => id === candidate.id),
        );
        if (reply)
          return createLiveRoomEvent({
            ...eventOptions,
            kind: 'reply',
            payload: { pinId: nextPin.id, reply },
          });
      }
      if (
        nextPin.status !== previousPin.status &&
        equalJson(
          withoutUpdatedAt({ ...previousPin, status: nextPin.status }),
          withoutUpdatedAt(nextPin),
        )
      ) {
        return createLiveRoomEvent({
          ...eventOptions,
          kind: 'pin_status',
          payload: { pinId: nextPin.id, status: nextPin.status },
        });
      }
    }
  }
  if (
    equalJson(previousReview.pins, nextReview.pins) &&
    (previousReview.decision !== nextReview.decision ||
      previousReview.overall !== nextReview.overall)
  ) {
    assertAuthor(author, 'Live review recommendation author');
    return createLiveRoomEvent({
      ...eventOptions,
      kind: 'recommendation',
      payload: { author, decision: nextReview.decision, overall: nextReview.overall },
    });
  }
  throw error(
    ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID,
    'Review change is not one coherent event for this room authority.',
  );
}

export async function encryptLiveRoomEvent(event, { key, crypto } = {}) {
  const normalized = createLiveRoomEvent(event);
  const encoded = new TextEncoder().encode(JSON.stringify(normalized));
  return encryptArtifactPayload(encoded, {
    key,
    crypto,
    maxEncryptedBytes: ARTIFACT_COMPRESSED_LIMIT,
  });
}

export async function decryptLiveRoomEvent(record, { key, roomId, reviewOf, crypto } = {}) {
  const encrypted = record?.version ? record : { ...record, version: ARTIFACT_ROOM_VERSION };
  const bytes = await decryptArtifactPayload(encrypted, {
    keyFragment: key,
    crypto,
    maxEncryptedBytes: ARTIFACT_COMPRESSED_LIMIT,
  });
  let value;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw error(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review event could not be decoded.');
  }
  const normalized = createLiveRoomEvent(value);
  if (normalized.roomId !== roomId || normalized.reviewOf !== reviewOf)
    throw error(
      ARTIFACT_ERROR_CODES.DIGEST_MISMATCH,
      'Live review event belongs to another room or artifact.',
    );
  return normalized;
}

/** Deterministically reduce append-only ciphertext events into the existing review shape. */
export function reduceLiveRoomEvents({ roomId, reviewOf, events = [], reviewId = roomId } = {}) {
  validateId(roomId);
  validateDigest(reviewOf);
  const pins = new Map();
  const recommendations = new Map();
  const seen = new Set();
  let ownerDecision = 'pending';
  let ownerOverall = '';
  let snapshot = null;
  for (const event of events) {
    const item = createLiveRoomEvent(event);
    if (item.roomId !== roomId || item.reviewOf !== reviewOf)
      throw error(
        ARTIFACT_ERROR_CODES.DIGEST_MISMATCH,
        'Live review event belongs to another room or artifact.',
      );
    if (seen.has(item.eventId)) continue;
    seen.add(item.eventId);
    if (item.kind === 'pin') {
      if (!pins.has(item.payload.id)) pins.set(item.payload.id, clone(item.payload));
      continue;
    }
    if (item.kind === 'reply') {
      const pin = pins.get(item.payload.pinId);
      if (pin && !pin.replies.some((reply) => reply.id === item.payload.reply.id))
        pin.replies.push(clone(item.payload.reply));
      continue;
    }
    if (item.kind === 'pin_status') {
      const pin = pins.get(item.payload.pinId);
      if (pin) {
        pin.status = item.payload.status;
        pin.updatedAt = item.createdAt;
      }
      continue;
    }
    if (item.kind === 'recommendation') {
      recommendations.set(item.payload.author?.name ?? item.eventId, clone(item.payload));
      continue;
    }
    if (item.kind === 'owner_decision') {
      ownerDecision = item.payload.decision;
      if (item.payload.overall !== undefined) ownerOverall = item.payload.overall;
    }
    if (
      item.kind === 'review_snapshot' &&
      item.payload.review &&
      typeof item.payload.review === 'object'
    )
      snapshot = clone(item.payload.review);
  }
  const createdAt = events[0]?.createdAt ?? new Date(0).toISOString();
  const updatedAt = events.at(-1)?.createdAt ?? createdAt;
  const review = Object.freeze(
    snapshot ?? {
      schemaVersion: '1.0.0',
      reviewId,
      reviewOf,
      decision: ownerDecision,
      overall: ownerOverall,
      createdAt,
      updatedAt,
      pins: [...pins.values()],
    },
  );
  return Object.freeze({ review, recommendations: [...recommendations.values()] });
}

/** Verify a v2 signed chain before projecting its decrypted semantic events. */
export async function reduceSignedLiveRoomEvents({
  descriptor,
  entries = [],
  reviewId,
  key,
  crypto,
} = {}) {
  const verified = await verifyLiveRoomEventChain({ descriptor, entries, key, crypto });
  const projection = reduceLiveRoomEvents({
    roomId: verified.descriptor.roomId,
    reviewOf: verified.descriptor.reviewOf,
    events: verified.events,
    reviewId,
  });
  return Object.freeze({
    ...projection,
    integrity: Object.freeze({
      protocolVersion: verified.descriptor.protocolVersion,
      generation: verified.generation,
      head: verified.head,
      replayedEventIds: verified.replayedEventIds,
    }),
  });
}

/** Project the last valid semantic state while retaining the authenticated record head. */
export async function reduceResilientSignedLiveRoomEvents({
  descriptor,
  records = [],
  reviewId,
  key,
  crypto,
} = {}) {
  const verified = await verifyLiveRoomEventChain({
    descriptor,
    entries: records.map((record) => ({ record })),
    crypto,
  });
  const events = [];
  const quarantinedEventIds = [];
  for (const record of verified.records) {
    try {
      const semantic = await verifySignedLiveRoomEvent({
        descriptor: verified.descriptor,
        record,
        key,
        crypto,
      });
      events.push(semantic.event);
    } catch {
      quarantinedEventIds.push(record.eventId);
    }
  }
  const projection = reduceLiveRoomEvents({
    roomId: verified.descriptor.roomId,
    reviewOf: verified.descriptor.reviewOf,
    events,
    reviewId,
  });
  return Object.freeze({
    ...projection,
    integrity: Object.freeze({
      protocolVersion: verified.descriptor.protocolVersion,
      generation: verified.generation,
      head: verified.head,
      replayedEventIds: verified.replayedEventIds,
      quarantinedEventIds: Object.freeze(quarantinedEventIds),
    }),
  });
}

function request(base, fetchImpl, path, options) {
  return fetchImpl(new URL(path, base).toString(), {
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    ...options,
  });
}
function responseError(status, body) {
  if (status === 410)
    return error(ARTIFACT_ERROR_CODES.ROOM_EXPIRED, 'Live review room has expired.');
  if (status === 403)
    return error(ARTIFACT_ERROR_CODES.ROOM_FORBIDDEN, 'Live review capability was rejected.');
  if (status === 409 && body?.error === 'legacy_read_only') {
    return error(
      ARTIFACT_ERROR_CODES.ROOM_LEGACY_READ_ONLY,
      'Legacy unsigned live review rooms are readable but cannot be mutated.',
    );
  }
  if (status === 409 && ['room_conflict', 'room_stale', 'room_clock_skew'].includes(body?.error)) {
    return error(
      ARTIFACT_ERROR_CODES.ROOM_EVENT_REPLAY,
      'Live review room generation is stale or the event identity diverged.',
    );
  }
  if (status === 409)
    return error(ARTIFACT_ERROR_CODES.ROOM_CLOSED, 'Live review comments are paused.');
  return error(ARTIFACT_ERROR_CODES.ROOM_UNAVAILABLE, 'Live review room is unavailable.');
}

function assertCiphertext(value, label = 'Live review ciphertext') {
  if (
    !exactKeys(value, ['version', 'iv', 'ciphertext']) ||
    value.version !== ARTIFACT_ROOM_VERSION ||
    !bounded(value.iv, 16, 16) ||
    !bounded(value.ciphertext, 22, 7_000_000)
  ) {
    throw error(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, `${label} is invalid.`);
  }
  return value;
}

function assertCreateResponse(value, { reviewOf, ownerSigner }) {
  if (
    !exactKeys(value, ['id', 'expiresAt', 'descriptor', 'generation', 'head']) ||
    !validIso(value.expiresAt) ||
    value.generation !== 0 ||
    value.head !== ARTIFACT_ROOM_GENESIS_HASH
  ) {
    throw error(ARTIFACT_ERROR_CODES.ROOM_INVALID, 'Live review service returned an invalid room.');
  }
  validateId(value.id);
  const descriptor = normalizeLiveRoomDescriptor(value.descriptor);
  if (
    descriptor.roomId !== value.id ||
    descriptor.reviewOf !== reviewOf ||
    descriptor.ownerKey.keyId !== ownerSigner.keyId ||
    descriptor.ownerKey.value !== (ownerSigner.publicKey ?? ownerSigner.value)
  ) {
    throw error(
      ARTIFACT_ERROR_CODES.ROOM_INVALID,
      'Live review service returned a descriptor for another room or owner.',
    );
  }
  return { ...value, descriptor };
}

function assertV2RoomResponse(value, roomId) {
  if (
    !exactKeys(value, [
      'schemaVersion',
      'operation',
      'descriptor',
      'iv',
      'ciphertext',
      'expiresAt',
      'commentsEnabled',
      'generation',
      'head',
      'events',
    ]) ||
    value.schemaVersion !== '2.0.0' ||
    value.operation !== 'read' ||
    !validIso(value.expiresAt) ||
    typeof value.commentsEnabled !== 'boolean' ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 0 ||
    !HASH_RE.test(value.head) ||
    !Array.isArray(value.events) ||
    value.events.length > 10_000 ||
    value.events.length !== value.generation
  ) {
    throw error(
      ARTIFACT_ERROR_CODES.ROOM_INVALID,
      'Live review service returned an invalid signed room.',
    );
  }
  const descriptor = normalizeLiveRoomDescriptor(value.descriptor);
  if (descriptor.roomId !== roomId)
    throw error(ARTIFACT_ERROR_CODES.ROOM_INVALID, 'Live review service returned another room.');
  assertCiphertext(
    { version: ARTIFACT_ROOM_VERSION, iv: value.iv, ciphertext: value.ciphertext },
    'Live review room ciphertext',
  );
  return Object.freeze({ ...value, descriptor });
}

function isLegacyRoomResponse(value) {
  return (
    isRecord(value) &&
    !Object.hasOwn(value, 'descriptor') &&
    typeof value.iv === 'string' &&
    typeof value.ciphertext === 'string' &&
    typeof value.reviewOf === 'string'
  );
}

export function createLiveRoomClient({
  baseUrl = 'https://share.openplanr.dev',
  fetchImpl = globalThis.fetch,
} = {}) {
  const base = normalizeServiceUrl(baseUrl);
  if (typeof fetchImpl !== 'function')
    throw error(
      ARTIFACT_ERROR_CODES.BROWSER_UNSUPPORTED,
      'This runtime does not provide fetch support.',
    );
  const json = async (path, options) => {
    let response;
    try {
      response = await request(base, fetchImpl, path, options);
    } catch {
      throw error(ARTIFACT_ERROR_CODES.SHARE_NETWORK, 'Live review service is unavailable.');
    }
    let value;
    try {
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > 32 * 1024 * 1024)
        throw new Error('response too large');
      value = JSON.parse(body);
    } catch {
      if (!response.ok) throw responseError(response.status);
      throw error(
        ARTIFACT_ERROR_CODES.ROOM_INVALID,
        'Live review service returned malformed JSON.',
      );
    }
    if (!response.ok) throw responseError(response.status, value);
    return value;
  };
  return Object.freeze({
    async create({
      prepared: suppliedPreparation,
      envelope,
      ttl = '7d',
      ownerSigner,
      crypto,
    } = {}) {
      const prepared =
        suppliedPreparation ??
        (await prepareLiveReviewRoom(envelope, {
          baseUrl: base.origin,
          ttl,
          ownerSigner,
          crypto,
        }));
      const state = liveRoomPreparationState(prepared);
      if (state.baseOrigin !== base.origin) {
        throw error(
          ARTIFACT_ERROR_CODES.ROOM_INVALID,
          'Live review preparation belongs to another service origin.',
        );
      }
      const hadPriorDispatch = state.dispatchCount > 0;
      state.dispatchCount += 1;
      let response;
      try {
        response = await request(base, fetchImpl, '/api/v1/rooms', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-openplanr-room-id': prepared.roomId,
          },
          body: JSON.stringify(state.requestBody),
        });
      } catch {
        throw error(
          ARTIFACT_ERROR_CODES.ROOM_CREATE_AMBIGUOUS,
          'Live review room creation outcome is unknown. Retry this exact prepared creation or use its recovery bundle.',
          '',
          { effect: 'ambiguous', roomId: prepared.roomId },
        );
      }
      let createdValue;
      try {
        const body = await response.text();
        if (new TextEncoder().encode(body).byteLength > 32 * 1024 * 1024)
          throw new Error('response too large');
        createdValue = JSON.parse(body);
      } catch {
        throw error(
          ARTIFACT_ERROR_CODES.ROOM_CREATE_AMBIGUOUS,
          'Live review room creation returned an unverifiable outcome. Retry this exact prepared creation or use its recovery bundle.',
          '',
          { effect: 'ambiguous', roomId: prepared.roomId },
        );
      }
      if (!response.ok) {
        const definitelyRejected =
          !hadPriorDispatch && [400, 403, 413, 429].includes(response.status);
        if (definitelyRejected) {
          throw error(
            ARTIFACT_ERROR_CODES.ROOM_INVALID,
            'Live review room creation was rejected before any room was committed.',
            '',
            { effect: 'none', status: response.status },
          );
        }
        if (response.status === 409 && createdValue?.error === 'room_conflict') {
          throw error(
            ARTIFACT_ERROR_CODES.ROOM_EVENT_REPLAY,
            'Live review room creation identity was replayed with divergent bytes.',
            '',
            { effect: 'ambiguous', roomId: prepared.roomId },
          );
        }
        throw error(
          ARTIFACT_ERROR_CODES.ROOM_CREATE_AMBIGUOUS,
          'Live review room creation outcome is unknown. Retry this exact prepared creation or use its recovery bundle.',
          '',
          { effect: 'ambiguous', roomId: prepared.roomId },
        );
      }
      let created;
      try {
        created = assertCreateResponse(createdValue, {
          reviewOf: prepared.reviewOf,
          ownerSigner: state.ownerSigner,
        });
        if (created.id !== prepared.roomId) throw new Error('foreign room');
      } catch {
        throw error(
          ARTIFACT_ERROR_CODES.ROOM_CREATE_AMBIGUOUS,
          'Live review room creation returned an unverifiable receipt. Retry this exact prepared creation or use its recovery bundle.',
          '',
          { effect: 'ambiguous', roomId: prepared.roomId },
        );
      }
      const result = {
        ok: true,
        action: 'artifact_live_room_created',
        id: created.id,
        reviewOf: prepared.reviewOf,
        expiresAt: created.expiresAt,
        descriptor: created.descriptor,
        generation: created.generation,
        head: created.head,
        ...state.links,
      };
      Object.defineProperties(result, {
        ownerSigner: { enumerable: false, value: state.ownerSigner },
        prepared: { enumerable: false, value: prepared },
      });
      return Object.freeze(result);
    },
    async read(roomId) {
      validateId(roomId);
      return json(`/api/v1/rooms/${encodeURIComponent(roomId)}`, {
        headers: { accept: 'application/json' },
      });
    },
    async append(roomId, capability, { expectedGeneration, record } = {}) {
      validateId(roomId);
      validateKey(capability, 'Live review event capability');
      if (
        !Number.isSafeInteger(expectedGeneration) ||
        expectedGeneration < 0 ||
        !isRecord(record) ||
        record.schemaVersion !== '2.0.0' ||
        record.roomId !== roomId ||
        record.sequence !== expectedGeneration + 1
      ) {
        throw error(
          ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID,
          'Signed live review append request is invalid.',
        );
      }
      return json(`/api/v1/rooms/${encodeURIComponent(roomId)}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${capability}` },
        body: JSON.stringify({
          schemaVersion: '2.0.0',
          operation: 'append',
          expectedGeneration,
          record,
        }),
      });
    },
    async manage(roomId, capability, operation) {
      validateId(roomId);
      validateKey(capability, 'Live review management capability');
      return json(`/api/v1/rooms/${encodeURIComponent(roomId)}/manage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${capability}` },
        body: JSON.stringify(operation),
      });
    },
  });
}

export async function commitLiveReviewRoom(prepared, options = {}) {
  const state = liveRoomPreparationState(prepared);
  return createLiveRoomClient({
    baseUrl: options.baseUrl ?? state.baseOrigin,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
  }).create({ prepared });
}

export async function createLiveReviewRoom(envelope, options = {}) {
  const prepared = await prepareLiveReviewRoom(envelope, options);
  return commitLiveReviewRoom(prepared, options);
}
export async function appendLiveRoomEvent(
  link,
  event,
  {
    client = createLiveRoomClient({ baseUrl: parseLiveRoomLink(link).origin }),
    signer: suppliedSigner,
    crypto,
  } = {},
) {
  const parsed = parseLiveRoomLink(link);
  const roomValue = await client.read(parsed.roomId);
  if (isLegacyRoomResponse(roomValue)) {
    throw error(
      ARTIFACT_ERROR_CODES.ROOM_LEGACY_READ_ONLY,
      'Legacy unsigned live review rooms are readable but cannot be mutated.',
    );
  }
  const room = assertV2RoomResponse(roomValue, parsed.roomId);
  const normalizedEvent = createLiveRoomEvent(event);
  if (
    normalizedEvent.roomId !== parsed.roomId ||
    normalizedEvent.reviewOf !== room.descriptor.reviewOf
  ) {
    throw error(
      ARTIFACT_ERROR_CODES.DIGEST_MISMATCH,
      'Live review event belongs to another room or artifact.',
    );
  }
  const ownerKind =
    normalizedEvent.kind === 'owner_decision' || normalizedEvent.kind === 'review_snapshot';
  const capability = ownerKind ? parsed.owner : parsed.write;
  if (!capability)
    throw error(
      ARTIFACT_ERROR_CODES.ROOM_FORBIDDEN,
      ownerKind
        ? 'This live review URL does not carry the owner verdict capability.'
        : 'This live review URL does not carry the reviewer capability.',
    );
  const signer =
    suppliedSigner ?? (ownerKind ? null : await createLiveRoomSigner({ role: 'reviewer', crypto }));
  if (!signer)
    throw error(
      ARTIFACT_ERROR_CODES.ROOM_FORBIDDEN,
      'Owner events require the client-held room owner signer.',
    );
  const encrypted = await encryptLiveRoomEvent(normalizedEvent, { key: parsed.key, crypto });
  const record = await createSignedLiveRoomEvent({
    descriptor: room.descriptor,
    event: normalizedEvent,
    ciphertext: encrypted,
    sequence: room.generation + 1,
    predecessor: room.head,
    signer,
    key: parsed.key,
    crypto,
  });
  return client.append(parsed.roomId, capability, { expectedGeneration: room.generation, record });
}
export async function hydrateLiveReviewRoom(
  link,
  { client = createLiveRoomClient({ baseUrl: parseLiveRoomLink(link).origin }), crypto } = {},
) {
  const parsed = parseLiveRoomLink(link);
  const roomValue = await client.read(parsed.roomId);
  const legacy = isLegacyRoomResponse(roomValue);
  const room = legacy ? roomValue : assertV2RoomResponse(roomValue, parsed.roomId);
  const compressed = await decryptArtifactPayload(
    { version: 'v1', iv: room.iv, ciphertext: room.ciphertext },
    { keyFragment: parsed.key, crypto },
  );
  const envelope = decodeCompressedArtifactPayload(compressed).value;
  assertEnvelope(envelope);
  const reviewOf = await digestEnvelope(envelope, crypto);
  const declaredReviewOf = legacy ? room.reviewOf : room.descriptor.reviewOf;
  if (declaredReviewOf !== reviewOf)
    throw error(
      ARTIFACT_ERROR_CODES.DIGEST_MISMATCH,
      'Live review room artifact digest is invalid.',
    );
  if (legacy) {
    const events = [];
    for (const record of room.events ?? [])
      events.push(
        await decryptLiveRoomEvent(record, {
          key: parsed.key,
          roomId: parsed.roomId,
          reviewOf,
          crypto,
        }),
      );
    return Object.freeze({
      room: parsed,
      envelope,
      reviewOf,
      commentsEnabled: Boolean(room.commentsEnabled),
      expiresAt: room.expiresAt,
      protocolVersion: '1.0.0',
      mutation: Object.freeze({ enabled: false, reason: 'legacy-unsigned-room' }),
      ...reduceLiveRoomEvents({ roomId: parsed.roomId, reviewOf, events }),
    });
  }
  if (room.descriptor.reviewOf !== reviewOf)
    throw error(
      ARTIFACT_ERROR_CODES.DIGEST_MISMATCH,
      'Live review room descriptor digest is invalid.',
    );
  const projection = await reduceResilientSignedLiveRoomEvents({
    descriptor: room.descriptor,
    records: room.events,
    key: parsed.key,
    crypto,
  });
  if (
    projection.integrity.generation !== room.generation ||
    projection.integrity.head !== room.head
  ) {
    throw error(
      ARTIFACT_ERROR_CODES.ROOM_EVENT_REPLAY,
      'Live review room head does not match its authenticated event chain.',
    );
  }
  const enabled = (parsed.role === 'reviewer' && room.commentsEnabled) || parsed.role === 'owner';
  return Object.freeze({
    room: parsed,
    envelope,
    reviewOf,
    commentsEnabled: room.commentsEnabled,
    expiresAt: room.expiresAt,
    protocolVersion: ARTIFACT_ROOM_PROTOCOL_VERSION,
    descriptor: room.descriptor,
    mutation: Object.freeze({
      enabled,
      reason: enabled
        ? null
        : parsed.role === 'management'
          ? 'management-only'
          : room.commentsEnabled
            ? 'read-only-link'
            : 'comments-paused',
    }),
    ...projection,
  });
}

export { createLiveRoomSigner, exportLiveRoomSignerSecret, importLiveRoomSignerSecret };
