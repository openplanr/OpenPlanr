/** Purpose- and identity-bound AES-GCM for additive room and paste formats. */
import { canonicalizeJson } from '@openplanr/protocol/canonical-json';
import {
  assertSharingSecurityContract,
  SHARING_CRYPTO_CONTEXT,
} from '@openplanr/protocol/sharing-security-contracts';
import { decodeResourceBytes, encodeResourceBytes } from './resource-pack.mjs';

const encoder = new TextEncoder();
const token = () => encodeResourceBytes(crypto.getRandomValues(new Uint8Array(32)));
function aad(context) {
  assertSharingSecurityContract(context, 'sharing-crypto-aad');
  return encoder.encode(canonicalizeJson({ context: SHARING_CRYPTO_CONTEXT, ...context }));
}
async function purposeKey(key, context, usage) {
  const material = await crypto.subtle.importKey(
    'raw',
    decodeResourceBytes(key, 32),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(context.objectId),
      info: encoder.encode(`${SHARING_CRYPTO_CONTEXT}/${context.purpose}`),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  );
}
export async function encryptSharingPayload(
  bytes,
  { key = token(), context, limit = 5 * 1024 * 1024 } = {},
) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength + 16 > limit)
    throw new RangeError('Encrypted sharing payload exceeds its byte limit.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(context), tagLength: 128 },
    await purposeKey(key, context, ['encrypt']),
    bytes,
  );
  return {
    version: '2.0.0',
    iv: encodeResourceBytes(iv),
    ciphertext: encodeResourceBytes(new Uint8Array(encrypted)),
    keyFragment: key,
  };
}
export async function decryptSharingPayload(
  payload,
  { key, context, limit = 5 * 1024 * 1024 } = {},
) {
  if (payload.version !== '2.0.0') throw new TypeError('Unknown sharing encryption version.');
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: decodeResourceBytes(payload.iv, 12),
        additionalData: aad(context),
        tagLength: 128,
      },
      await purposeKey(key, context, ['decrypt']),
      decodeResourceBytes(payload.ciphertext, limit),
    ),
  );
}
