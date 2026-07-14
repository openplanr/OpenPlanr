import {
  ARTIFACT_COMPRESSED_LIMIT,
  base64UrlToBytes,
  bytesToBase64Url,
} from './codec.mjs';
import { ARTIFACT_ERROR_CODES, PipelineError } from '../pipeline/errors.mjs';

export const ARTIFACT_ENCRYPTION_ALGORITHM = 'AES-256-GCM';
export const ARTIFACT_ENCRYPTION_KEY_BYTES = 32;
export const ARTIFACT_ENCRYPTION_IV_BYTES = 12;
export const ARTIFACT_ENCRYPTION_TAG_BYTES = 16;
export const ARTIFACT_CRYPTO_AAD = 'openplanr.artifact-paste.v1';

function cryptoError(code, message) {
  return new PipelineError(code, message);
}

function encryptedLimit(value) {
  if (!Number.isInteger(value) || value < ARTIFACT_ENCRYPTION_TAG_BYTES) {
    throw cryptoError(ARTIFACT_ERROR_CODES.PASTE_LIMIT, 'Encrypted artifact byte limit is invalid.');
  }
  return Math.min(value, ARTIFACT_COMPRESSED_LIMIT);
}

function cryptoProvider(value) {
  const provider = value ?? globalThis.crypto;
  if (!provider?.subtle || typeof provider.getRandomValues !== 'function') {
    throw cryptoError(
      ARTIFACT_ERROR_CODES.BROWSER_UNSUPPORTED,
      'This runtime does not provide Web Crypto AES-GCM support.',
    );
  }
  return provider;
}

function bytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  throw new TypeError('binary value required');
}

function utf8(value) {
  if (typeof globalThis.TextEncoder !== 'function') {
    throw cryptoError(ARTIFACT_ERROR_CODES.BROWSER_UNSUPPORTED, 'This runtime does not provide UTF-8 support.');
  }
  return new globalThis.TextEncoder().encode(value);
}

function decodeSized(value, size, label, failureCode) {
  try {
    const decoded = typeof value === 'string'
      ? base64UrlToBytes(value, { label, maxBytes: size })
      : bytes(value);
    if (decoded.byteLength !== size) throw new Error('invalid length');
    return decoded;
  } catch {
    throw cryptoError(failureCode, `Artifact ${label} is invalid.`);
  }
}

function random(size, provider) {
  const output = new Uint8Array(size);
  provider.getRandomValues(output);
  return output;
}

export function generateArtifactEncryptionKey({ crypto, cryptoImpl = crypto } = {}) {
  return random(ARTIFACT_ENCRYPTION_KEY_BYTES, cryptoProvider(cryptoImpl));
}

export function generateArtifactEncryptionIv({ crypto, cryptoImpl = crypto } = {}) {
  return random(ARTIFACT_ENCRYPTION_IV_BYTES, cryptoProvider(cryptoImpl));
}

export function encodeArtifactKey(value) {
  return bytesToBase64Url(decodeSized(
    value,
    ARTIFACT_ENCRYPTION_KEY_BYTES,
    'encryption key',
    ARTIFACT_ERROR_CODES.ENCRYPTION_FAILED,
  ));
}

export function decodeArtifactKey(value) {
  return decodeSized(
    value,
    ARTIFACT_ENCRYPTION_KEY_BYTES,
    'decryption key',
    ARTIFACT_ERROR_CODES.DECRYPTION_FAILED,
  );
}

export function encodeArtifactKeyFragment(value) {
  return `k=${encodeArtifactKey(value)}`;
}

export function decodeArtifactKeyFragment(source) {
  let fragment = source;
  if (typeof source !== 'string' || source.length === 0) {
    throw cryptoError(ARTIFACT_ERROR_CODES.DECRYPTION_FAILED, 'Artifact decryption key is invalid.');
  }
  if (!source.startsWith('k=') && !source.startsWith('#k=')) {
    try { fragment = new globalThis.URL(source).hash; } catch {
      throw cryptoError(ARTIFACT_ERROR_CODES.DECRYPTION_FAILED, 'Artifact decryption key is invalid.');
    }
  }
  const encoded = fragment.startsWith('#k=') ? fragment.slice(3)
    : fragment.startsWith('k=') ? fragment.slice(2) : '';
  if (!encoded || encoded.includes('&') || encoded.includes('=')) {
    throw cryptoError(ARTIFACT_ERROR_CODES.DECRYPTION_FAILED, 'Artifact decryption key is invalid.');
  }
  return decodeArtifactKey(encoded);
}

export async function encryptArtifactPayload(value, {
  crypto,
  cryptoImpl = crypto,
  keyBytes: requestedKeyBytes,
  ivBytes: requestedIvBytes,
  key = requestedKeyBytes,
  iv = requestedIvBytes,
  maxEncryptedBytes = ARTIFACT_COMPRESSED_LIMIT,
  maxCiphertextBytes = maxEncryptedBytes,
} = {}) {
  const provider = cryptoProvider(cryptoImpl);
  const encryptedByteLimit = encryptedLimit(Math.min(maxEncryptedBytes, maxCiphertextBytes));
  let plaintext;
  let keyBytes;
  let ivBytes;
  try {
    plaintext = bytes(value);
    keyBytes = key === undefined
      ? generateArtifactEncryptionKey({ cryptoImpl: provider })
      : decodeSized(key, ARTIFACT_ENCRYPTION_KEY_BYTES, 'encryption key', ARTIFACT_ERROR_CODES.ENCRYPTION_FAILED);
    ivBytes = iv === undefined
      ? generateArtifactEncryptionIv({ cryptoImpl: provider })
      : decodeSized(iv, ARTIFACT_ENCRYPTION_IV_BYTES, 'encryption IV', ARTIFACT_ERROR_CODES.ENCRYPTION_FAILED);
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw cryptoError(ARTIFACT_ERROR_CODES.ENCRYPTION_FAILED, 'Artifact payload encryption failed.');
  }
  if (plaintext.byteLength < 1 || plaintext.byteLength + ARTIFACT_ENCRYPTION_TAG_BYTES > encryptedByteLimit) {
    throw cryptoError(
      ARTIFACT_ERROR_CODES.PASTE_LIMIT,
      `Encrypted artifact payload exceeds the ${encryptedByteLimit}-byte limit.`,
    );
  }
  try {
    const imported = await provider.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    const encrypted = await provider.subtle.encrypt({
      name: 'AES-GCM',
      iv: ivBytes,
      additionalData: utf8(ARTIFACT_CRYPTO_AAD),
      tagLength: 128,
    }, imported, plaintext);
    const ciphertextBytes = new Uint8Array(encrypted);
    if (ciphertextBytes.byteLength > encryptedByteLimit) {
      throw cryptoError(ARTIFACT_ERROR_CODES.PASTE_LIMIT, 'Encrypted artifact payload exceeds its byte limit.');
    }
    return Object.freeze({
      version: 'v1',
      iv: bytesToBase64Url(ivBytes),
      ciphertext: bytesToBase64Url(ciphertextBytes),
      keyFragment: bytesToBase64Url(keyBytes),
      compressedBytes: plaintext.byteLength,
      encryptedBytes: ciphertextBytes.byteLength,
    });
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw cryptoError(ARTIFACT_ERROR_CODES.ENCRYPTION_FAILED, 'Artifact payload encryption failed.');
  }
}

export async function decryptArtifactPayload(payload, {
  crypto,
  cryptoImpl = crypto,
  key,
  keyFragment = key ?? payload?.keyFragment,
  maxEncryptedBytes = ARTIFACT_COMPRESSED_LIMIT,
  maxCiphertextBytes = maxEncryptedBytes,
} = {}) {
  const provider = cryptoProvider(cryptoImpl);
  const encryptedByteLimit = encryptedLimit(Math.min(maxEncryptedBytes, maxCiphertextBytes));
  try {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.version !== 'v1') {
      throw new Error('invalid payload');
    }
    const keyBytes = decodeSized(
      keyFragment,
      ARTIFACT_ENCRYPTION_KEY_BYTES,
      'decryption key',
      ARTIFACT_ERROR_CODES.DECRYPTION_FAILED,
    );
    const ivBytes = decodeSized(
      payload.iv,
      ARTIFACT_ENCRYPTION_IV_BYTES,
      'decryption IV',
      ARTIFACT_ERROR_CODES.DECRYPTION_FAILED,
    );
    const ciphertext = base64UrlToBytes(payload.ciphertext, {
      label: 'ciphertext',
      maxBytes: encryptedByteLimit,
    });
    if (ciphertext.byteLength < ARTIFACT_ENCRYPTION_TAG_BYTES) throw new Error('short ciphertext');
    const imported = await provider.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    const decrypted = await provider.subtle.decrypt({
      name: 'AES-GCM',
      iv: ivBytes,
      additionalData: utf8(ARTIFACT_CRYPTO_AAD),
      tagLength: 128,
    }, imported, ciphertext);
    return new Uint8Array(decrypted);
  } catch {
    throw cryptoError(
      ARTIFACT_ERROR_CODES.DECRYPTION_FAILED,
      'Artifact payload could not be decrypted. The link may be invalid or modified.',
    );
  }
}
