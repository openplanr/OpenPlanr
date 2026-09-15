import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  base64UrlToBytes,
  bytesToBase64Url,
  compressArtifactPayload,
} from '../../lib/artifact/codec.mjs';
import {
  ARTIFACT_CRYPTO_AAD,
  decryptArtifactPayload,
  encryptArtifactPayload,
  generateArtifactEncryptionIv,
} from '../../lib/artifact/crypto.mjs';
import {
  createPasteClient,
  createReviewLink,
  decodeReviewLink,
  selectReviewLinkTransport,
} from '../../lib/artifact/share-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const errorCode = (code) => (error) => error?.code === code;
const key = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const iv = 'AAECAwQFBgcICQoL';
const plaintext = 'T3BlblBsYW5yIGFydGlmYWN0IHBheWxvYWQgdjE';
const ciphertext = 'CHKzdZWJo3X_Yfb5xYAeDOCip0SRAjMTWQPF8yz21ptb-jfKv6RkirDvrZcx';
const pasteId = 'paste_12345678901';
const deletionToken = 'delete_12345678901234567890123456';
const expiresAt = '2026-07-21T12:00:00.000Z';

function encodedAt(length, compressed = Uint8Array.of(1, 2, 3)) {
  return () => ({
    fragment: `v1.${'A'.repeat(length - 3)}`,
    fragmentLength: length,
    compressed,
  });
}

test('AES-256-GCM matches the fixed v1 vector and authenticated context', async () => {
  assert.equal(ARTIFACT_CRYPTO_AAD, 'openplanr.artifact-paste.v1');
  const encrypted = await encryptArtifactPayload(base64UrlToBytes(plaintext), {
    keyBytes: key,
    ivBytes: iv,
  });
  assert.deepEqual(encrypted, {
    version: 'v1',
    iv,
    ciphertext,
    keyFragment: key,
    compressedBytes: 29,
    encryptedBytes: 45,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(encrypted, 'key'), false);
  assert.equal(
    bytesToBase64Url(await decryptArtifactPayload({ version: 'v1', iv, ciphertext }, { keyFragment: key })),
    plaintext,
  );
});

test('wrong keys, tampering, and unsupported encrypted versions fail identically', async () => {
  const failures = [
    () => decryptArtifactPayload({ version: 'v1', iv, ciphertext }, { keyFragment: 'A'.repeat(43) }),
    () => decryptArtifactPayload({ version: 'v1', iv, ciphertext: `${ciphertext.slice(0, -1)}A` }, { keyFragment: key }),
    () => decryptArtifactPayload({ version: 'v2', iv, ciphertext }, { keyFragment: key }),
  ];
  for (const failure of failures) {
    await assert.rejects(failure, (error) => (
      error?.code === 'E_ARTIFACT_DECRYPTION_FAILED'
      && error.message === 'Artifact payload could not be decrypted. The link may be invalid or modified.'
    ));
  }
});

test('generated encryption IVs do not repeat and encrypted byte ceiling includes the tag', async () => {
  const values = new Set();
  for (let index = 0; index < 256; index += 1) {
    values.add(bytesToBase64Url(generateArtifactEncryptionIv()));
  }
  assert.equal(values.size, 256);
  await assert.rejects(
    () => encryptArtifactPayload(new Uint8Array(5 * 1024 * 1024), { maxEncryptedBytes: 5 * 1024 * 1024 }),
    errorCode('E_ARTIFACT_PASTE_LIMIT'),
  );
  await assert.rejects(
    () => encryptArtifactPayload(new Uint8Array(5 * 1024 * 1024), { maxEncryptedBytes: Number.MAX_SAFE_INTEGER }),
    errorCode('E_ARTIFACT_PASTE_LIMIT'),
    'callers cannot raise the hard five-MiB encrypted ceiling',
  );
  const accepted = await encryptArtifactPayload(new Uint8Array(32), { maxEncryptedBytes: 48 });
  assert.equal(accepted.encryptedBytes, 48);
});

test('paste client reconstructs a ciphertext-only allowlisted request', async () => {
  const seen = [];
  const telemetry = [];
  const client = createPasteClient({
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return {
        ok: true,
        status: 201,
        json: async () => ({
          schemaVersion: '1.0.0', operation: 'created', id: pasteId,
          expiresAt, deletionToken,
        }),
      };
    },
    onRequest: (value) => telemetry.push(value),
  });
  const encryptedBody = bytesToBase64Url(new Uint8Array(16));
  const result = await client.create({
    schemaVersion: '1.0.0', operation: 'create', iv,
    ciphertext: encryptedBody, ttl: '7d', key, deletionToken, plaintext: '<secret>',
  });
  assert.equal(result.id, pasteId);
  const body = JSON.parse(seen[0].options.body);
  assert.deepEqual(Object.keys(body), ['schemaVersion', 'operation', 'iv', 'ciphertext', 'ttl']);
  assert.equal(JSON.stringify({ url: seen[0].url, body, telemetry }).includes(key), false);
  assert.equal(JSON.stringify({ url: seen[0].url, body, telemetry }).includes(deletionToken), false);
  assert.deepEqual(telemetry, [{ operation: 'create', ciphertextBytes: 16, ttl: '7d' }]);
});

test('8,000 stays local while 8,001 requires consent before crypto or fetch', async () => {
  assert.equal(selectReviewLinkTransport({ fragmentLength: 8_000 }), 'fragment');
  assert.equal(selectReviewLinkTransport({ fragmentLength: 8_001 }), 'short');
  let encrypted = 0;
  let uploaded = 0;
  const fragment = await createReviewLink({ ok: true }, {
    encodeImpl: encodedAt(8_000),
    encryptImpl: async () => { encrypted += 1; },
    pasteClient: { create: async () => { uploaded += 1; } },
  });
  assert.equal(fragment.transport, 'fragment');
  assert.equal(fragment.uploaded, false);
  assert.equal(fragment.expiresAt, null);
  assert.equal(fragment.deletionToken, null);
  assert.equal(fragment.size, 3);
  assert.match(fragment.url, /#v1\./);
  assert.equal(encrypted, 0);
  assert.equal(uploaded, 0);

  await assert.rejects(
    () => createReviewLink({ ok: true }, {
      encodeImpl: encodedAt(8_001),
      confirmShort: async () => false,
      encryptImpl: async () => { encrypted += 1; },
      pasteClient: { create: async () => { uploaded += 1; } },
    }),
    errorCode('E_ARTIFACT_SHORT_CONFIRMATION_REQUIRED'),
  );
  assert.equal(encrypted, 0);
  assert.equal(uploaded, 0);

  let confirmations = 0;
  await assert.rejects(
    () => createReviewLink({ ok: true }, {
      transport: 'short', ttl: 'forever', encodeImpl: encodedAt(400),
      confirmShort: async () => { confirmations += 1; return true; },
    }),
    errorCode('E_ARTIFACT_PASTE_INVALID'),
  );
  assert.equal(confirmations, 0, 'invalid requests do not prompt for upload consent');
});

test('forced short links isolate the key and deletion token', async () => {
  let preview;
  let request;
  const result = await createReviewLink({ ok: true }, {
    transport: 'short',
    encodeImpl: encodedAt(400),
    confirmShort: async (value) => { preview = value; return true; },
    encryptImpl: async () => ({
      version: 'v1', iv, ciphertext, keyFragment: key,
      compressedBytes: 3, encryptedBytes: 45,
    }),
    pasteClient: {
      create: async (value) => {
        request = value;
        return { id: pasteId, expiresAt, deletionToken };
      },
    },
  });
  assert.equal(preview.forced, false);
  assert.deepEqual(request, {
    schemaVersion: '1.0.0', operation: 'create', iv, ciphertext, ttl: '7d',
  });
  assert.equal(result.uploaded, true);
  assert.equal(result.id, pasteId);
  assert.equal(result.iv, iv);
  assert.equal(result.size, 45);
  assert.equal(result.deletionToken, deletionToken);
  assert.equal(new URL(result.url).hash, `#k=${key}`);
  assert.equal(result.url.includes(deletionToken), false);
  assert.equal(Object.isFrozen(result), true);
});

test('fragment and encrypted short review links decode through one transport adapter', async () => {
  const value = { schemaVersion: '1.0.0', html: '<p>Café 🌍</p>' };
  const fragment = await createReviewLink(value);
  let reads = 0;
  assert.deepEqual(await decodeReviewLink(fragment.url, {
    pasteClient: { get: async () => { reads += 1; } },
  }), value);
  assert.equal(reads, 0);

  let stored;
  const client = {
    create: async (input) => {
      stored = input;
      return { id: pasteId, expiresAt, deletionToken };
    },
    get: async (id) => {
      reads += 1;
      assert.equal(id, pasteId);
      return { iv: stored.iv, ciphertext: stored.ciphertext, expiresAt, size: base64UrlToBytes(stored.ciphertext).length };
    },
  };
  const short = await createReviewLink(value, { transport: 'short', shortConsent: true, pasteClient: client });
  assert.deepEqual(await decodeReviewLink(short.url, { pasteClient: client }), value);
  assert.equal(reads, 1);
});

test('paste reads sanitize expiry, missing, and network failures', async () => {
  const get = async (response, now = () => new Date('2026-07-20T12:00:00.000Z')) => {
    const client = createPasteClient({ fetchImpl: async () => response, now });
    return client.get(pasteId);
  };
  await assert.rejects(
    () => get({ ok: false, status: 410, json: async () => ({ secret: 'do-not-leak' }) }),
    errorCode('E_ARTIFACT_PASTE_EXPIRED'),
  );
  await assert.rejects(
    () => get({ ok: false, status: 404, json: async () => ({ secret: 'do-not-leak' }) }),
    (error) => error?.code === 'E_ARTIFACT_PASTE_UNAVAILABLE' && !error.message.includes('do-not-leak'),
  );
  await assert.rejects(
    () => createPasteClient({ fetchImpl: async () => { throw new Error('private endpoint detail'); } }).get(pasteId),
    (error) => error?.code === 'E_ARTIFACT_SHARE_NETWORK' && !error.message.includes('private endpoint detail'),
  );
  const body = bytesToBase64Url(new Uint8Array(16));
  await assert.rejects(
    () => get({
      ok: true, status: 200,
      json: async () => ({ schemaVersion: '1.0.0', operation: 'read', iv, ciphertext: body, expiresAt, size: 16 }),
    }, () => new Date('2026-07-22T12:00:00.000Z')),
    errorCode('E_ARTIFACT_PASTE_EXPIRED'),
  );
});

test('short-link GET paths never include the fragment key', async () => {
  const compressed = compressArtifactPayload({ hello: 'private' }).compressed;
  const encrypted = await encryptArtifactPayload(compressed, { keyBytes: key, ivBytes: iv });
  const urls = [];
  const client = createPasteClient({
    fetchImpl: async (url) => {
      urls.push(url);
      return {
        ok: true, status: 200,
        json: async () => ({
          schemaVersion: '1.0.0', operation: 'read', iv,
          ciphertext: encrypted.ciphertext, expiresAt, size: encrypted.encryptedBytes,
        }),
      };
    },
    now: () => new Date('2026-07-20T12:00:00.000Z'),
  });
  assert.deepEqual(
    await decodeReviewLink(`https://share.openplanr.dev/p/${pasteId}#k=${key}`, { pasteClient: client }),
    { hello: 'private' },
  );
  assert.equal(urls.length, 1);
  assert.equal(urls[0].includes(key), false);
  assert.equal(new URL(urls[0]).hash, '');
});

test('browser crypto and share sources do not depend on Node globals', () => {
  for (const name of ['crypto.mjs', 'share-client.mjs']) {
    const source = readFileSync(join(here, `../../lib/artifact/${name}`), 'utf8');
    assert.doesNotMatch(source, /(?:from\s+['"]node:|require\s*\(|\bBuffer\b|\bprocess\.)/);
  }
});
