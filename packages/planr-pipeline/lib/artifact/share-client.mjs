import {
  ARTIFACT_COMPRESSED_LIMIT,
  ARTIFACT_FRAGMENT_LIMIT,
  ARTIFACT_FRAGMENT_PREFIX,
  base64UrlToBytes,
  decodeArtifactFragment,
  decodeCompressedArtifactPayload,
  encodeArtifactFragmentDetails,
} from './codec.mjs';
import { decryptArtifactPayload, encryptArtifactPayload } from './crypto.mjs';
import { ARTIFACT_ERROR_CODES, PipelineError } from '../pipeline/errors.mjs';

export const ARTIFACT_SHARE_BASE_URL = 'https://share.openplanr.dev';
export const ARTIFACT_SHARE_TTLS = Object.freeze(['1d', '7d', '30d']);

const ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,256}$/;
const IV_RE = /^[A-Za-z0-9_-]{16}$/;
const CIPHERTEXT_RE = /^[A-Za-z0-9_-]+$/;

function shareError(code, message, fix = '') {
  return new PipelineError(code, message, fix);
}

function loopback(hostname) {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
}

function normalizeBaseUrl(value = ARTIFACT_SHARE_BASE_URL) {
  let url;
  try { url = new globalThis.URL(value); } catch {
    throw shareError(ARTIFACT_ERROR_CODES.PASTE_INVALID, 'Artifact share service URL is invalid.');
  }
  if (url.username || url.password || url.search || url.hash
    || (url.pathname !== '/' && url.pathname !== '')
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback(url.hostname)))) {
    throw shareError(ARTIFACT_ERROR_CODES.PASTE_INVALID, 'Artifact share service URL is not a secure origin.');
  }
  return url;
}

function ciphertextBytes(value) {
  try {
    return base64UrlToBytes(value, {
      label: 'ciphertext',
      maxBytes: ARTIFACT_COMPRESSED_LIMIT,
    });
  } catch (error) {
    if (error?.code === ARTIFACT_ERROR_CODES.PASTE_LIMIT) throw error;
    throw shareError(ARTIFACT_ERROR_CODES.PASTE_INVALID, 'Artifact paste ciphertext is invalid.');
  }
}

function validateIv(value) {
  if (typeof value !== 'string' || !IV_RE.test(value)) {
    throw shareError(ARTIFACT_ERROR_CODES.PASTE_INVALID, 'Artifact paste IV is invalid.');
  }
  return value;
}

function validateCiphertext(value, declaredSize) {
  if (typeof value !== 'string' || !CIPHERTEXT_RE.test(value)) {
    throw shareError(ARTIFACT_ERROR_CODES.PASTE_INVALID, 'Artifact paste ciphertext is invalid.');
  }
  const decoded = ciphertextBytes(value);
  if (decoded.byteLength < 16 || decoded.byteLength > ARTIFACT_COMPRESSED_LIMIT
    || (declaredSize !== undefined && declaredSize !== decoded.byteLength)) {
    throw shareError(ARTIFACT_ERROR_CODES.PASTE_INVALID, 'Artifact paste ciphertext size is invalid.');
  }
  return decoded.byteLength;
}

function validateCreateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== '1.0.0' || value.operation !== 'create'
    || !ARTIFACT_SHARE_TTLS.includes(value.ttl)) {
    throw shareError(ARTIFACT_ERROR_CODES.PASTE_INVALID, 'Artifact paste creation request is invalid.');
  }
  validateIv(value.iv);
  validateCiphertext(value.ciphertext);
  return Object.freeze({
    schemaVersion: '1.0.0',
    operation: 'create',
    iv: value.iv,
    ciphertext: value.ciphertext,
    ttl: value.ttl,
  });
}

function validateCreated(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== '1.0.0' || value.operation !== 'created'
    || !ID_RE.test(value.id ?? '') || !TOKEN_RE.test(value.deletionToken ?? '')
    || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) {
    throw shareError(ARTIFACT_ERROR_CODES.PASTE_INVALID, 'Artifact paste service returned an invalid creation response.');
  }
  return Object.freeze({
    schemaVersion: '1.0.0', operation: 'created',
    id: value.id, expiresAt: value.expiresAt, deletionToken: value.deletionToken,
  });
}

function validateRead(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== '1.0.0' || value.operation !== 'read'
    || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))
    || !Number.isInteger(value.size) || value.size < 16 || value.size > ARTIFACT_COMPRESSED_LIMIT) {
    throw shareError(ARTIFACT_ERROR_CODES.PASTE_INVALID, 'Artifact paste service returned an invalid read response.');
  }
  validateIv(value.iv);
  validateCiphertext(value.ciphertext, value.size);
  return Object.freeze({
    schemaVersion: '1.0.0', operation: 'read', iv: value.iv,
    ciphertext: value.ciphertext, expiresAt: value.expiresAt, size: value.size,
  });
}

function safeId(value) {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    throw shareError(ARTIFACT_ERROR_CODES.PASTE_INVALID, 'Artifact paste identifier is invalid.');
  }
  return value;
}

async function responseJson(response) {
  try { return await response.json(); } catch {
    throw shareError(ARTIFACT_ERROR_CODES.PASTE_INVALID, 'Artifact paste service returned malformed JSON.');
  }
}

/** Ciphertext-only HTTP client. Every outbound body is reconstructed from an allowlist. */
export function createPasteClient({
  baseUrl = ARTIFACT_SHARE_BASE_URL,
  fetchImpl = globalThis.fetch,
  onRequest,
  now = () => new Date(),
} = {}) {
  const base = normalizeBaseUrl(baseUrl);
  if (typeof fetchImpl !== 'function') {
    throw shareError(ARTIFACT_ERROR_CODES.BROWSER_UNSUPPORTED, 'This runtime does not provide fetch support.');
  }
  const request = async (path, options, meta) => {
    try {
      onRequest?.(Object.freeze({ ...meta }));
      return await fetchImpl(new globalThis.URL(path, base).toString(), {
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        ...options,
      });
    } catch (error) {
      if (error instanceof PipelineError) throw error;
      throw shareError(
        ARTIFACT_ERROR_CODES.SHARE_NETWORK,
        'Artifact share service is unavailable.',
        'Check the connection and retry. No plaintext was uploaded.',
      );
    }
  };
  return Object.freeze({
    baseUrl: base.origin,
    async create(value) {
      const body = validateCreateRequest(value);
      const size = validateCiphertext(body.ciphertext);
      const response = await request('/api/v1/pastes', {
        method: 'POST',
        headers: Object.freeze({ 'content-type': 'application/json' }),
        body: JSON.stringify(body),
      }, { operation: 'create', ciphertextBytes: size, ttl: body.ttl });
      if (!response?.ok) {
        throw shareError(ARTIFACT_ERROR_CODES.PASTE_UNAVAILABLE, 'Artifact paste could not be created.');
      }
      return validateCreated(await responseJson(response));
    },
    async get(id) {
      const pasteId = safeId(id);
      const response = await request(`/api/v1/pastes/${encodeURIComponent(pasteId)}`, {
        method: 'GET', headers: Object.freeze({ accept: 'application/json' }),
      }, { operation: 'read' });
      if (response?.status === 410) {
        throw shareError(ARTIFACT_ERROR_CODES.PASTE_EXPIRED, 'Artifact paste has expired.');
      }
      if (!response?.ok) {
        throw shareError(ARTIFACT_ERROR_CODES.PASTE_UNAVAILABLE, 'Artifact paste is unavailable.');
      }
      const value = validateRead(await responseJson(response));
      let current;
      try {
        const result = now();
        current = result instanceof Date ? result.getTime() : new Date(result).getTime();
      } catch { current = Number.NaN; }
      if (!Number.isFinite(current)) {
        throw shareError(ARTIFACT_ERROR_CODES.PASTE_INVALID, 'Artifact paste clock is invalid.');
      }
      if (Date.parse(value.expiresAt) <= current) {
        throw shareError(ARTIFACT_ERROR_CODES.PASTE_EXPIRED, 'Artifact paste has expired.');
      }
      return value;
    },
    async delete(id, deletionToken) {
      const pasteId = safeId(id);
      if (typeof deletionToken !== 'string' || !TOKEN_RE.test(deletionToken)) {
        throw shareError(ARTIFACT_ERROR_CODES.PASTE_INVALID, 'Artifact paste deletion token is invalid.');
      }
      const response = await request(`/api/v1/pastes/${encodeURIComponent(pasteId)}`, {
        method: 'DELETE',
        headers: Object.freeze({ authorization: `Bearer ${deletionToken}` }),
      }, { operation: 'delete' });
      if (!response?.ok) {
        throw shareError(ARTIFACT_ERROR_CODES.PASTE_UNAVAILABLE, 'Artifact paste could not be deleted.');
      }
      return Object.freeze({ ok: true });
    },
  });
}

export function selectReviewLinkTransport({ fragmentLength, short = false } = {}) {
  if (!Number.isInteger(fragmentLength) || fragmentLength < ARTIFACT_FRAGMENT_PREFIX.length) {
    throw shareError(ARTIFACT_ERROR_CODES.CODEC_INVALID, 'Artifact fragment length is invalid.');
  }
  return short || fragmentLength > ARTIFACT_FRAGMENT_LIMIT ? 'short' : 'fragment';
}

export function prepareReviewLink(value, { encodeImpl = encodeArtifactFragmentDetails, ...codecOptions } = {}) {
  const encoded = encodeImpl(value, codecOptions);
  if (!encoded || typeof encoded.fragment !== 'string'
    || !(encoded.compressed instanceof Uint8Array)
    || encoded.fragmentLength !== encoded.fragment.length) {
    throw shareError(ARTIFACT_ERROR_CODES.CODEC_INVALID, 'Artifact fragment encoder returned an invalid result.');
  }
  return Object.freeze({
    fragment: encoded.fragment,
    fragmentLength: encoded.fragmentLength,
    compressed: encoded.compressed,
    compressedBytes: encoded.compressed.byteLength,
    ciphertextBytes: encoded.compressed.byteLength + 16,
    fragmentEligible: encoded.fragmentLength <= ARTIFACT_FRAGMENT_LIMIT,
  });
}

export function createReviewLinkPreview(value, options = {}) {
  const prepared = prepareReviewLink(value, options);
  return Object.freeze({
    fragmentLength: prepared.fragmentLength,
    compressedBytes: prepared.compressedBytes,
    ciphertextBytes: prepared.ciphertextBytes,
    fragmentEligible: prepared.fragmentEligible,
  });
}

export async function createReviewLink(value, {
  baseUrl = ARTIFACT_SHARE_BASE_URL,
  short = false,
  transport = short ? 'short' : 'auto',
  shortConsent = false,
  confirmShort,
  ttl = '7d',
  confirmed = false,
  yes = false,
  pasteClient,
  fetchImpl,
  encodeImpl,
  encryptImpl = encryptArtifactPayload,
  crypto,
  ...codecOptions
} = {}) {
  if (!['auto', 'short'].includes(transport)) {
    throw shareError(ARTIFACT_ERROR_CODES.PASTE_INVALID, 'Artifact share transport must be auto or short.');
  }
  const base = normalizeBaseUrl(baseUrl);
  const prepared = prepareReviewLink(value, { encodeImpl, ...codecOptions });
  const selectedTransport = selectReviewLinkTransport({
    fragmentLength: prepared.fragmentLength,
    short: short || transport === 'short',
  });
  if (selectedTransport === 'fragment') {
    const url = new globalThis.URL('/', base);
    url.hash = prepared.fragment;
    return Object.freeze({
      ok: true,
      action: 'artifact_review_link_created',
      transport: selectedTransport,
      uploaded: false,
      url: url.toString(),
      fragmentLength: prepared.fragmentLength,
      compressedBytes: prepared.compressedBytes,
      ciphertextBytes: prepared.ciphertextBytes,
      size: prepared.compressedBytes,
      expiresAt: null,
      deletionToken: null,
    });
  }
  if (!ARTIFACT_SHARE_TTLS.includes(ttl)) {
    throw shareError(ARTIFACT_ERROR_CODES.PASTE_INVALID, 'Artifact paste TTL must be 1d, 7d, or 30d.');
  }
  let consent = Boolean(confirmed || yes || shortConsent);
  if (!consent && typeof confirmShort === 'function') {
    consent = Boolean(await confirmShort(Object.freeze({
      fragmentLength: prepared.fragmentLength,
      compressedBytes: prepared.compressedBytes,
      ciphertextBytes: prepared.ciphertextBytes,
      ttl,
      forced: prepared.fragmentLength > ARTIFACT_FRAGMENT_LIMIT,
    })));
  }
  if (!consent) {
    throw shareError(
      ARTIFACT_ERROR_CODES.SHORT_CONFIRMATION_REQUIRED,
      'Encrypted short-link creation requires explicit confirmation.',
      'Review the ciphertext size and expiry, then confirm or pass --yes.',
    );
  }
  const encrypted = await encryptImpl(prepared.compressed, {
    crypto,
    maxEncryptedBytes: ARTIFACT_COMPRESSED_LIMIT,
  });
  const client = pasteClient ?? createPasteClient({ baseUrl: base.origin, fetchImpl });
  const created = await client.create({
    schemaVersion: '1.0.0',
    operation: 'create',
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
    ttl,
  });
  const url = new globalThis.URL(`/p/${encodeURIComponent(created.id)}`, base);
  url.hash = `k=${encrypted.keyFragment}`;
  if (url.toString().includes(created.deletionToken)) {
    throw shareError(ARTIFACT_ERROR_CODES.PASTE_INVALID, 'Artifact deletion token isolation failed.');
  }
  return Object.freeze({
    ok: true,
    action: 'artifact_review_link_created',
    transport: selectedTransport,
    uploaded: true,
    id: created.id,
    iv: encrypted.iv,
    url: url.toString(),
    fragmentLength: prepared.fragmentLength,
    compressedBytes: encrypted.compressedBytes,
    ciphertextBytes: encrypted.encryptedBytes,
    size: encrypted.encryptedBytes,
    expiresAt: created.expiresAt,
    deletionToken: created.deletionToken,
  });
}

function parseShortLink(source) {
  let url;
  try { url = new globalThis.URL(source); } catch {
    throw shareError(ARTIFACT_ERROR_CODES.PASTE_INVALID, 'Artifact review link is malformed.');
  }
  if (url.username || url.password || url.search
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback(url.hostname)))) {
    throw shareError(ARTIFACT_ERROR_CODES.PASTE_INVALID, 'Artifact review link is not a secure supported URL.');
  }
  const match = /^\/p\/([A-Za-z0-9_-]{16,128})\/?$/.exec(url.pathname);
  const key = /^#k=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1];
  if (!match || !key) {
    throw shareError(ARTIFACT_ERROR_CODES.PASTE_INVALID, 'Artifact encrypted review link is malformed.');
  }
  return Object.freeze({ origin: url.origin, id: match[1], keyFragment: key });
}

/** Async transport adapter designed to be injected directly into T-008 import. */
export async function decodeReviewLink(source, {
  pasteClient,
  fetchImpl,
  crypto,
  ...codecOptions
} = {}) {
  if (typeof source === 'string'
    && (/^v[0-9]+\./.test(source)
      || /^#v[0-9]+\./.test(source)
      || /#v[0-9]+\./.test(source))) {
    return decodeArtifactFragment(source, codecOptions);
  }
  const link = parseShortLink(source);
  const client = pasteClient ?? createPasteClient({ baseUrl: link.origin, fetchImpl });
  const encrypted = await client.get(link.id);
  const compressed = await decryptArtifactPayload({
    version: 'v1',
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
  }, {
    keyFragment: link.keyFragment,
    crypto,
    maxEncryptedBytes: ARTIFACT_COMPRESSED_LIMIT,
  });
  return decodeCompressedArtifactPayload(compressed, codecOptions).value;
}
