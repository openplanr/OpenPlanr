import { ARTIFACT_COMPRESSED_LIMIT, bytesToBase64Url, compressArtifactPayload, decodeCompressedArtifactPayload } from './codec.mjs';
import { decryptArtifactPayload, encryptArtifactPayload, generateArtifactEncryptionKey } from './crypto.mjs';
import { ARTIFACT_ERROR_CODES, PipelineError } from '../pipeline/errors.mjs';

export const ARTIFACT_ROOM_VERSION = 'v1';
export const ARTIFACT_ROOM_EVENT_KINDS = Object.freeze(['pin', 'reply', 'pin_status', 'recommendation', 'owner_decision', 'review_snapshot']);
export const ARTIFACT_ROOM_TTLS = Object.freeze(['1d', '7d', '30d']);

const ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const SHA_RE = /^[a-f0-9]{64}$/;

function error(code, message, fix = '') { return new PipelineError(code, message, fix); }
function clone(value) { return structuredClone(value); }
function nowIso(now = () => new Date()) { const value = now(); return (value instanceof Date ? value : new Date(value)).toISOString(); }
function validIso(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function randomToken(crypto = globalThis.crypto) { return bytesToBase64Url(generateArtifactEncryptionKey({ crypto })); }
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (!value || typeof value !== 'object') return value; return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])); }
function assertEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== '1.0.0' || !Array.isArray(value.artifacts) || !value.viewer) {
    throw error(ARTIFACT_ERROR_CODES.ENVELOPE_INVALID, 'Live review artifact envelope is invalid.');
  }
  return value;
}
async function digestEnvelope(value, crypto = globalThis.crypto) {
  assertEnvelope(value);
  if (!crypto?.subtle) throw error(ARTIFACT_ERROR_CODES.BROWSER_UNSUPPORTED, 'Web Crypto is required for live review rooms.');
  const reviewFree = { schemaVersion: value.schemaVersion, artifacts: value.artifacts, viewer: value.viewer };
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(reviewFree)));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map((item) => item.toString(16).padStart(2, '0')).join('');
}

function validateId(value, label = 'room ID') {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw error(ARTIFACT_ERROR_CODES.ROOM_INVALID, `${label} is invalid.`);
  return value;
}
function validateKey(value, label) {
  if (typeof value !== 'string' || !KEY_RE.test(value)) throw error(ARTIFACT_ERROR_CODES.ROOM_INVALID, `${label} is invalid.`);
  return value;
}
function validateDigest(value) {
  if (typeof value !== 'string' || !SHA_RE.test(value)) throw error(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Room event artifact digest is invalid.');
  return value;
}

export function parseLiveRoomLink(source) {
  let url;
  try { url = new URL(source); } catch { throw error(ARTIFACT_ERROR_CODES.ROOM_INVALID, 'Live review URL is malformed.'); }
  const room = /^\/r\/([A-Za-z0-9_-]{16,128})\/?$/.exec(url.pathname)?.[1];
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (!room || !fragment || [...fragment.keys()].some((key) => !['k', 'w', 'm'].includes(key))) {
    throw error(ARTIFACT_ERROR_CODES.ROOM_INVALID, 'Live review URL is malformed.');
  }
  const key = validateKey(fragment.get('k'), 'Live review decryption key');
  const write = fragment.get('w');
  const manage = fragment.get('m');
  if (write !== null) validateKey(write, 'Live review write capability');
  if (manage !== null) validateKey(manage, 'Live review management capability');
  if (write !== null && manage !== null) throw error(ARTIFACT_ERROR_CODES.ROOM_INVALID, 'A live review URL cannot expose both write and management capabilities.');
  return Object.freeze({ origin: url.origin, roomId: room, key, ...(write ? { write } : {}), ...(manage ? { manage } : {}) });
}

export function createLiveRoomLinks({ baseUrl = 'https://share.openplanr.dev', roomId, key, writeCapability, manageCapability }) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.pathname !== '/' || base.search || base.hash) throw error(ARTIFACT_ERROR_CODES.ROOM_INVALID, 'Live review service URL is invalid.');
  validateId(roomId); validateKey(key, 'Live review decryption key'); validateKey(writeCapability, 'Live review write capability'); validateKey(manageCapability, 'Live review management capability');
  const review = new URL(`/r/${roomId}`, base);
  review.hash = new URLSearchParams({ k: key, w: writeCapability }).toString();
  const manage = new URL(`/r/${roomId}`, base);
  manage.hash = new URLSearchParams({ k: key, m: manageCapability }).toString();
  return Object.freeze({ url: review.toString(), manageUrl: manage.toString() });
}

export function createLiveRoomEvent({ roomId, reviewOf, kind, payload, eventId = globalThis.crypto?.randomUUID?.(), createdAt = nowIso() } = {}) {
  validateId(roomId); validateDigest(reviewOf);
  if (typeof eventId !== 'string' || eventId.length < 1 || eventId.length > 128) throw error(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Room event ID is invalid.');
  if (!ARTIFACT_ROOM_EVENT_KINDS.includes(kind) || !payload || typeof payload !== 'object' || Array.isArray(payload) || !validIso(createdAt)) {
    throw error(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review event is invalid.');
  }
  return Object.freeze({ schemaVersion: '1.0.0', eventId, roomId, reviewOf, kind, createdAt, payload: clone(payload) });
}

export async function encryptLiveRoomEvent(event, { key, crypto } = {}) {
  const normalized = createLiveRoomEvent(event);
  const encoded = new TextEncoder().encode(JSON.stringify(normalized));
  return encryptArtifactPayload(encoded, { key, crypto, maxEncryptedBytes: ARTIFACT_COMPRESSED_LIMIT });
}

export async function decryptLiveRoomEvent(record, { key, roomId, reviewOf, crypto } = {}) {
  const encrypted = record?.version ? record : { ...record, version: ARTIFACT_ROOM_VERSION };
  const bytes = await decryptArtifactPayload(encrypted, { keyFragment: key, crypto, maxEncryptedBytes: ARTIFACT_COMPRESSED_LIMIT });
  let value;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw error(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review event could not be decoded.'); }
  const normalized = createLiveRoomEvent(value);
  if (normalized.roomId !== roomId || normalized.reviewOf !== reviewOf) throw error(ARTIFACT_ERROR_CODES.DIGEST_MISMATCH, 'Live review event belongs to another room or artifact.');
  return normalized;
}

/** Deterministically reduce append-only ciphertext events into the existing review shape. */
export function reduceLiveRoomEvents({ roomId, reviewOf, events = [], reviewId = roomId } = {}) {
  validateId(roomId); validateDigest(reviewOf);
  const pins = new Map(); const recommendations = new Map(); const seen = new Set(); let ownerDecision = 'pending'; let snapshot = null;
  for (const event of events) {
    const item = createLiveRoomEvent(event);
    if (item.roomId !== roomId || item.reviewOf !== reviewOf) throw error(ARTIFACT_ERROR_CODES.DIGEST_MISMATCH, 'Live review event belongs to another room or artifact.');
    if (seen.has(item.eventId)) continue; seen.add(item.eventId);
    if (item.kind === 'pin') { if (!pins.has(item.payload.id)) pins.set(item.payload.id, clone(item.payload)); continue; }
    if (item.kind === 'reply') { const pin = pins.get(item.payload.pinId); if (pin && !pin.replies.some((reply) => reply.id === item.payload.reply.id)) pin.replies.push(clone(item.payload.reply)); continue; }
    if (item.kind === 'pin_status') { const pin = pins.get(item.payload.pinId); if (pin) { pin.status = item.payload.status; pin.updatedAt = item.createdAt; } continue; }
    if (item.kind === 'recommendation') { recommendations.set(item.payload.author?.name ?? item.eventId, clone(item.payload)); continue; }
    if (item.kind === 'owner_decision') ownerDecision = item.payload.decision;
    if (item.kind === 'review_snapshot' && item.payload.review && typeof item.payload.review === 'object') snapshot = clone(item.payload.review);
  }
  const createdAt = events[0]?.createdAt ?? new Date(0).toISOString();
  const updatedAt = events.at(-1)?.createdAt ?? createdAt;
  const review = Object.freeze(snapshot ?? { schemaVersion: '1.0.0', reviewId, reviewOf, decision: ownerDecision, overall: '', createdAt, updatedAt, pins: [...pins.values()] });
  return Object.freeze({ review, recommendations: [...recommendations.values()] });
}

function request(base, fetchImpl, path, options) {
  return fetchImpl(new URL(path, base).toString(), { cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', ...options });
}
function responseError(status) {
  if (status === 410) return error(ARTIFACT_ERROR_CODES.ROOM_EXPIRED, 'Live review room has expired.');
  if (status === 403) return error(ARTIFACT_ERROR_CODES.ROOM_FORBIDDEN, 'Live review capability was rejected.');
  if (status === 409) return error(ARTIFACT_ERROR_CODES.ROOM_CLOSED, 'Live review comments are paused.');
  return error(ARTIFACT_ERROR_CODES.ROOM_UNAVAILABLE, 'Live review room is unavailable.');
}

export function createLiveRoomClient({ baseUrl = 'https://share.openplanr.dev', fetchImpl = globalThis.fetch } = {}) {
  const base = new URL(baseUrl);
  if (typeof fetchImpl !== 'function') throw error(ARTIFACT_ERROR_CODES.BROWSER_UNSUPPORTED, 'This runtime does not provide fetch support.');
  const json = async (path, options) => { let response; try { response = await request(base, fetchImpl, path, options); } catch { throw error(ARTIFACT_ERROR_CODES.SHARE_NETWORK, 'Live review service is unavailable.'); } if (!response.ok) throw responseError(response.status); try { return await response.json(); } catch { throw error(ARTIFACT_ERROR_CODES.ROOM_INVALID, 'Live review service returned malformed JSON.'); } };
  return Object.freeze({
    async create({ envelope, ttl = '7d', crypto } = {}) {
      assertEnvelope(envelope); if (!ARTIFACT_ROOM_TTLS.includes(ttl)) throw error(ARTIFACT_ERROR_CODES.ROOM_INVALID, 'Live review TTL must be 1d, 7d, or 30d.');
      const reviewOf = await digestEnvelope(envelope, crypto); const prepared = compressArtifactPayload(envelope); const encrypted = await encryptArtifactPayload(prepared.compressed, { crypto });
      const writeCapability = randomToken(crypto); const manageCapability = randomToken(crypto);
      const created = await json('/api/v1/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schemaVersion: '1.0.0', operation: 'create', ttl, reviewOf, iv: encrypted.iv, ciphertext: encrypted.ciphertext, writeCapability, manageCapability }) });
      validateId(created.id); if (!validIso(created.expiresAt)) throw error(ARTIFACT_ERROR_CODES.ROOM_INVALID, 'Live review service returned an invalid room.');
      return Object.freeze({ ok: true, action: 'artifact_live_room_created', id: created.id, reviewOf, expiresAt: created.expiresAt, ...createLiveRoomLinks({ baseUrl: base.origin, roomId: created.id, key: encrypted.keyFragment, writeCapability, manageCapability }) });
    },
    async read(roomId) { validateId(roomId); return json(`/api/v1/rooms/${encodeURIComponent(roomId)}`, { headers: { accept: 'application/json' } }); },
    async append(roomId, capability, encryptedEvent) {
      validateId(roomId); validateKey(capability, 'Live review write capability');
      if (!encryptedEvent || encryptedEvent.version !== 'v1' || typeof encryptedEvent.iv !== 'string' || typeof encryptedEvent.ciphertext !== 'string') throw error(ARTIFACT_ERROR_CODES.ROOM_EVENT_INVALID, 'Live review event ciphertext is invalid.');
      return json(`/api/v1/rooms/${encodeURIComponent(roomId)}/events`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${capability}` }, body: JSON.stringify({ schemaVersion: '1.0.0', operation: 'append', iv: encryptedEvent.iv, ciphertext: encryptedEvent.ciphertext }) });
    },
    async manage(roomId, capability, operation) { validateId(roomId); validateKey(capability, 'Live review management capability'); return json(`/api/v1/rooms/${encodeURIComponent(roomId)}/manage`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${capability}` }, body: JSON.stringify(operation) }); },
  });
}

export async function createLiveReviewRoom(envelope, options = {}) { return createLiveRoomClient(options).create({ envelope, ...options }); }
export async function appendLiveRoomEvent(link, event, { client = createLiveRoomClient({ baseUrl: parseLiveRoomLink(link).origin }), crypto } = {}) {
  const parsed = parseLiveRoomLink(link);
  const capability = parsed.write ?? parsed.manage;
  if (!capability) throw error(ARTIFACT_ERROR_CODES.ROOM_FORBIDDEN, 'This live review URL cannot add feedback.');
  const encrypted = await encryptLiveRoomEvent(event, { key: parsed.key, crypto });
  return client.append(parsed.roomId, capability, encrypted);
}
export async function hydrateLiveReviewRoom(link, { client = createLiveRoomClient({ baseUrl: parseLiveRoomLink(link).origin }), crypto } = {}) {
  const parsed = parseLiveRoomLink(link); const room = await client.read(parsed.roomId);
  const compressed = await decryptArtifactPayload({ version: 'v1', iv: room.iv, ciphertext: room.ciphertext }, { keyFragment: parsed.key, crypto });
  const envelope = decodeCompressedArtifactPayload(compressed).value; assertEnvelope(envelope);
  const reviewOf = await digestEnvelope(envelope, crypto); if (room.reviewOf !== reviewOf) throw error(ARTIFACT_ERROR_CODES.DIGEST_MISMATCH, 'Live review room artifact digest is invalid.');
  const events = [];
  for (const record of room.events ?? []) events.push(await decryptLiveRoomEvent(record, { key: parsed.key, roomId: parsed.roomId, reviewOf, crypto }));
  return Object.freeze({ room: parsed, envelope, reviewOf, commentsEnabled: Boolean(room.commentsEnabled), expiresAt: room.expiresAt, ...reduceLiveRoomEvents({ roomId: parsed.roomId, reviewOf, events }) });
}
