import { Deflate, Inflate } from 'pako';

import { ARTIFACT_ERROR_CODES, PipelineError } from '../pipeline/errors.mjs';

export const ARTIFACT_FRAGMENT_VERSION = 'v1';
export const ARTIFACT_FRAGMENT_PREFIX = `${ARTIFACT_FRAGMENT_VERSION}.`;
export const ARTIFACT_FRAGMENT_LIMIT = 8_000;
export const ARTIFACT_COMPRESSED_LIMIT = 5 * 1024 * 1024;
export const ARTIFACT_EXPANDED_LIMIT = 10 * 1024 * 1024;

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

function codecError(code, message, fix = '') {
  return new PipelineError(code, message, fix);
}

function boundedLimit(value, hardMaximum, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw codecError(ARTIFACT_ERROR_CODES.CODEC_INVALID, `Artifact ${label} limit is invalid.`);
  }
  return Math.min(value, hardMaximum);
}

function byteArray(value, label = 'payload') {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw codecError(ARTIFACT_ERROR_CODES.CODEC_INVALID, `Artifact ${label} must be binary bytes.`);
}

function textEncoder() {
  if (typeof globalThis.TextEncoder !== 'function') {
    throw codecError(
      ARTIFACT_ERROR_CODES.CODEC_UNAVAILABLE,
      'This runtime does not provide UTF-8 TextEncoder support.',
      'Use a current Node.js or evergreen browser runtime.',
    );
  }
  return new globalThis.TextEncoder();
}

function textDecoder() {
  if (typeof globalThis.TextDecoder !== 'function') {
    throw codecError(
      ARTIFACT_ERROR_CODES.CODEC_UNAVAILABLE,
      'This runtime does not provide UTF-8 TextDecoder support.',
      'Use a current Node.js or evergreen browser runtime.',
    );
  }
  return new globalThis.TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
}

function canonicalValue(value, ancestors) {
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw codecError(ARTIFACT_ERROR_CODES.CODEC_INVALID, 'Artifact payload is cyclic.');
    ancestors.add(value);
    const output = value.map((item) => canonicalValue(item, ancestors));
    ancestors.delete(value);
    return output;
  }
  if (!value || typeof value !== 'object') return value;
  if (ancestors.has(value)) throw codecError(ARTIFACT_ERROR_CODES.CODEC_INVALID, 'Artifact payload is cyclic.');
  ancestors.add(value);
  const output = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (item !== undefined && typeof item !== 'function' && typeof item !== 'symbol') {
      output[key] = canonicalValue(item, ancestors);
    }
  }
  ancestors.delete(value);
  return output;
}

export function canonicalArtifactJson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw codecError(ARTIFACT_ERROR_CODES.CODEC_INVALID, 'Artifact payload must be a non-array JSON object.');
  }
  let serialized;
  try { serialized = JSON.stringify(canonicalValue(value, new Set())); } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw codecError(ARTIFACT_ERROR_CODES.CODEC_INVALID, 'Artifact payload cannot be serialized as canonical JSON.');
  }
  if (typeof serialized !== 'string') {
    throw codecError(ARTIFACT_ERROR_CODES.CODEC_INVALID, 'Artifact payload must serialize to a JSON value.');
  }
  return serialized;
}

export function bytesToBase64Url(value) {
  const bytes = byteArray(value);
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const hasB = index + 1 < bytes.length;
    const hasC = index + 2 < bytes.length;
    const b = hasB ? bytes[index + 1] : 0;
    const c = hasC ? bytes[index + 2] : 0;
    output += BASE64URL_ALPHABET[a >>> 2];
    output += BASE64URL_ALPHABET[((a & 3) << 4) | (b >>> 4)];
    if (hasB) output += BASE64URL_ALPHABET[((b & 15) << 2) | (c >>> 6)];
    if (hasC) output += BASE64URL_ALPHABET[c & 63];
  }
  return output;
}

export function base64UrlToBytes(value, {
  label = 'base64url value',
  maxBytes = ARTIFACT_COMPRESSED_LIMIT,
} = {}) {
  if (typeof value !== 'string' || value.length === 0 || !BASE64URL_RE.test(value)
    || value.includes('=') || value.length % 4 === 1) {
    throw codecError(ARTIFACT_ERROR_CODES.FRAGMENT_INVALID, `Artifact ${label} is not strict unpadded base64url.`);
  }
  const remainder = value.length % 4;
  const finalValue = BASE64URL_ALPHABET.indexOf(value.at(-1));
  if ((remainder === 2 && (finalValue & 15) !== 0) || (remainder === 3 && (finalValue & 3) !== 0)) {
    throw codecError(ARTIFACT_ERROR_CODES.FRAGMENT_INVALID, `Artifact ${label} has non-canonical trailing bits.`);
  }
  const length = Math.floor((value.length * 6) / 8);
  if (!Number.isInteger(maxBytes) || maxBytes < 0 || length > maxBytes) {
    throw codecError(
      ARTIFACT_ERROR_CODES.PASTE_LIMIT,
      `Artifact ${label} exceeds the ${maxBytes}-byte decoded limit.`,
    );
  }
  const output = new Uint8Array(length);
  let accumulator = 0;
  let bits = 0;
  let offset = 0;
  for (const character of value) {
    accumulator = (accumulator << 6) | BASE64URL_ALPHABET.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[offset++] = (accumulator >>> bits) & 255;
    }
  }
  return output;
}

export const encodeBase64Url = bytesToBase64Url;
export const decodeBase64Url = base64UrlToBytes;

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export function compressArtifactPayload(value, {
  maxExpandedBytes: requestedExpandedBytes = ARTIFACT_EXPANDED_LIMIT,
  maxCompressedBytes: requestedCompressedBytes = ARTIFACT_COMPRESSED_LIMIT,
} = {}) {
  const maxExpandedBytes = boundedLimit(
    requestedExpandedBytes,
    ARTIFACT_EXPANDED_LIMIT,
    'expanded byte',
  );
  const maxCompressedBytes = boundedLimit(
    requestedCompressedBytes,
    ARTIFACT_COMPRESSED_LIMIT,
    'compressed byte',
  );
  const json = canonicalArtifactJson(value);
  const expanded = textEncoder().encode(json);
  if (expanded.byteLength > maxExpandedBytes) {
    throw codecError(
      ARTIFACT_ERROR_CODES.DECOMPRESSION_LIMIT,
      `Artifact payload exceeds the ${maxExpandedBytes}-byte expanded limit.`,
    );
  }
  let compressed;
  try {
    const deflator = new Deflate({ raw: true, level: 9 });
    deflator.push(expanded, true);
    if (deflator.err || !(deflator.result instanceof Uint8Array)) throw new Error('deflate failed');
    compressed = deflator.result;
  } catch {
    throw codecError(ARTIFACT_ERROR_CODES.CODEC_FAILED, 'Artifact payload compression failed.');
  }
  if (compressed.byteLength > maxCompressedBytes) {
    throw codecError(
      ARTIFACT_ERROR_CODES.PASTE_LIMIT,
      `Compressed artifact payload exceeds the ${maxCompressedBytes}-byte limit.`,
    );
  }
  return Object.freeze({ json, expanded, compressed });
}

export function decodeCompressedArtifactPayload(value, {
  maxExpandedBytes: requestedExpandedBytes = ARTIFACT_EXPANDED_LIMIT,
  maxCompressedBytes: requestedCompressedBytes = ARTIFACT_COMPRESSED_LIMIT,
} = {}) {
  const maxExpandedBytes = boundedLimit(
    requestedExpandedBytes,
    ARTIFACT_EXPANDED_LIMIT,
    'expanded byte',
  );
  const maxCompressedBytes = boundedLimit(
    requestedCompressedBytes,
    ARTIFACT_COMPRESSED_LIMIT,
    'compressed byte',
  );
  const compressed = byteArray(value, 'compressed payload');
  if (compressed.byteLength < 1 || compressed.byteLength > maxCompressedBytes) {
    throw codecError(
      ARTIFACT_ERROR_CODES.PASTE_LIMIT,
      `Compressed artifact payload must be 1 through ${maxCompressedBytes} bytes.`,
    );
  }
  const chunks = [];
  let expandedBytes = 0;
  let exceeded = false;
  const limitSentinel = Object.freeze({ code: 'artifact-expanded-limit' });
  const inflator = new Inflate({ raw: true, chunkSize: 64 * 1024 });
  inflator.onData = (chunk) => {
    expandedBytes += chunk.byteLength;
    if (expandedBytes > maxExpandedBytes) {
      exceeded = true;
      throw limitSentinel;
    }
    chunks.push(chunk);
  };
  try { inflator.push(compressed, true); } catch (error) {
    if (error !== limitSentinel && !exceeded) {
      throw codecError(ARTIFACT_ERROR_CODES.CODEC_FAILED, 'Artifact compressed payload is malformed.');
    }
  }
  if (exceeded) {
    throw codecError(
      ARTIFACT_ERROR_CODES.DECOMPRESSION_LIMIT,
      `Artifact payload exceeds the ${maxExpandedBytes}-byte expanded limit.`,
    );
  }
  if (inflator.err || !inflator.ended) {
    throw codecError(ARTIFACT_ERROR_CODES.CODEC_FAILED, 'Artifact compressed payload is malformed.');
  }
  const expanded = new Uint8Array(expandedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    expanded.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let json;
  let parsed;
  try {
    json = textDecoder().decode(expanded);
    parsed = JSON.parse(json);
  } catch {
    throw codecError(ARTIFACT_ERROR_CODES.CODEC_INVALID, 'Artifact payload is not valid UTF-8 canonical JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw codecError(ARTIFACT_ERROR_CODES.CODEC_INVALID, 'Artifact payload must be a non-array JSON object.');
  }
  if (canonicalArtifactJson(parsed) !== json) {
    throw codecError(ARTIFACT_ERROR_CODES.CODEC_INVALID, 'Artifact JSON is not in canonical form.');
  }
  const canonicalCompressed = compressArtifactPayload(parsed, {
    maxExpandedBytes,
    maxCompressedBytes,
  }).compressed;
  if (!equalBytes(compressed, canonicalCompressed)) {
    throw codecError(ARTIFACT_ERROR_CODES.CODEC_INVALID, 'Artifact compressed bytes are not canonical raw DEFLATE.');
  }
  return Object.freeze({ value: parsed, json, expanded, compressed });
}

export function encodeArtifactFragmentDetails(value, options = {}) {
  const encoded = compressArtifactPayload(value, options);
  const fragment = `${ARTIFACT_FRAGMENT_PREFIX}${bytesToBase64Url(encoded.compressed)}`;
  return Object.freeze({ ...encoded, fragment, fragmentLength: fragment.length });
}

export function encodeArtifactFragment(value, options = {}) {
  return encodeArtifactFragmentDetails(value, options).fragment;
}

function loopbackHostname(hostname) {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
}

function extractFragment(source, { allowedOrigins } = {}) {
  if (typeof source !== 'string' || source.length === 0) {
    throw codecError(ARTIFACT_ERROR_CODES.FRAGMENT_INVALID, 'Artifact fragment must be a non-empty string.');
  }
  // Keep direct versioned fragments transport-neutral so the version parser can
  // return the precise unsupported-version diagnostic instead of treating them
  // as malformed URLs.
  if (/^v[0-9]+\./.test(source)) return source;
  if (source.startsWith('#')) return source.slice(1);
  let url;
  try { url = new globalThis.URL(source); } catch {
    throw codecError(ARTIFACT_ERROR_CODES.FRAGMENT_INVALID, 'Artifact review URL is malformed.');
  }
  const transportAllowed = url.protocol === 'https:'
    || (url.protocol === 'http:' && loopbackHostname(url.hostname));
  const originAllowed = allowedOrigins === undefined || allowedOrigins.includes(url.origin);
  if (!transportAllowed || !originAllowed || url.username || url.password || !url.hash || url.search) {
    throw codecError(ARTIFACT_ERROR_CODES.FRAGMENT_INVALID, 'Artifact review URL is not an allowed fragment link.');
  }
  return url.hash.slice(1);
}

export function decodeArtifactFragmentDetails(source, {
  maxFragmentChars: requestedFragmentChars = ARTIFACT_FRAGMENT_LIMIT,
  ...options
} = {}) {
  const maxFragmentChars = boundedLimit(
    requestedFragmentChars,
    ARTIFACT_FRAGMENT_LIMIT,
    'fragment character',
  );
  const fragment = extractFragment(source, options);
  const versionEnd = fragment.indexOf('.');
  const version = versionEnd === -1 ? fragment : fragment.slice(0, versionEnd);
  if (version !== ARTIFACT_FRAGMENT_VERSION) {
    throw codecError(
      ARTIFACT_ERROR_CODES.FRAGMENT_VERSION_UNSUPPORTED,
      'Artifact fragment version is unsupported.',
    );
  }
  if (fragment.length > maxFragmentChars) {
    throw codecError(
      ARTIFACT_ERROR_CODES.FRAGMENT_TOO_LARGE,
      `Artifact fragment exceeds the ${maxFragmentChars}-character limit.`,
    );
  }
  const payload = fragment.slice(ARTIFACT_FRAGMENT_PREFIX.length);
  const compressed = base64UrlToBytes(payload, {
    label: 'fragment payload',
    maxBytes: options.maxCompressedBytes ?? ARTIFACT_COMPRESSED_LIMIT,
  });
  const decoded = decodeCompressedArtifactPayload(compressed, options);
  return Object.freeze({ ...decoded, fragment, fragmentLength: fragment.length });
}

export function decodeArtifactFragment(source, options = {}) {
  return decodeArtifactFragmentDetails(source, options).value;
}
