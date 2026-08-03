import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { deflateRaw } from 'pako';

import {
  base64UrlToBytes,
  bytesToBase64Url,
  canonicalArtifactJson,
  compressArtifactPayload,
  decodeArtifactFragment,
  decodeArtifactFragmentDetails,
  decodeCompressedArtifactPayload,
  encodeArtifactFragment,
  encodeArtifactFragmentDetails,
} from '../../lib/artifact/codec.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, '__fixtures__/codec-v1.golden.json'), 'utf8'));
const errorCode = (code) => (error) => error?.code === code;

test('v1 codec matches the byte-exact Unicode golden fixture', () => {
  const encoded = encodeArtifactFragmentDetails(golden.value);
  assert.equal(encoded.json, golden.canonicalJson);
  assert.equal(Buffer.from(encoded.expanded).toString('hex'), golden.utf8Hex);
  assert.equal(bytesToBase64Url(encoded.compressed), golden.compressedBase64Url);
  assert.equal(encoded.fragment, golden.fragment);
  assert.deepEqual(decodeArtifactFragment(golden.fragment), golden.value);
  assert.deepEqual(decodeArtifactFragment(`#${golden.fragment}`), golden.value);
  assert.deepEqual(
    decodeArtifactFragment(`https://share.openplanr.dev/#${golden.fragment}`),
    golden.value,
  );
});

test('canonical JSON sorts object keys while preserving array order and Unicode', () => {
  assert.equal(
    canonicalArtifactJson({ z: '🌍', nested: { b: 2, a: 1 }, list: [{ d: 4, c: 3 }] }),
    '{"list":[{"c":3,"d":4}],"nested":{"a":1,"b":2},"z":"🌍"}',
  );
  const large = { html: `<!doctype html><p>${'مرحبا🌍'.repeat(32_768)}</p>`, schemaVersion: '1.0.0' };
  assert.deepEqual(decodeArtifactFragment(encodeArtifactFragment(large)), large);
  assert.throws(() => canonicalArtifactJson([]), errorCode('E_ARTIFACT_CODEC_INVALID'));
  assert.throws(() => canonicalArtifactJson('scalar'), errorCode('E_ARTIFACT_CODEC_INVALID'));
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalArtifactJson(cyclic), errorCode('E_ARTIFACT_CODEC_INVALID'));
});

test('strict unpadded base64url is byte-identical and rejects unsafe allocations', () => {
  for (let length = 1; length < 80; length += 1) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 73 + length) & 255);
    const expected = Buffer.from(bytes).toString('base64url');
    assert.equal(bytesToBase64Url(bytes), expected);
    assert.deepEqual(base64UrlToBytes(expected), bytes);
  }
  for (const malformed of ['A', 'AA=', 'AA+_', 'AA/_', 'AB', 'AAB']) {
    assert.throws(() => base64UrlToBytes(malformed), errorCode('E_ARTIFACT_FRAGMENT_INVALID'));
  }
  assert.throws(
    () => base64UrlToBytes('AAAA', { maxBytes: 2 }),
    errorCode('E_ARTIFACT_PASTE_LIMIT'),
  );
});

test('decoder rejects malformed, noncanonical, unsupported, and insecure fragments', () => {
  assert.throws(() => decodeArtifactFragment('v2.AAAA'), errorCode('E_ARTIFACT_FRAGMENT_VERSION_UNSUPPORTED'));
  assert.throws(() => decodeArtifactFragment('v1.A'), errorCode('E_ARTIFACT_FRAGMENT_INVALID'));
  assert.throws(() => decodeArtifactFragment('https://example.test/?leak=yes#v1.AAAA'), errorCode('E_ARTIFACT_FRAGMENT_INVALID'));
  assert.throws(() => decodeArtifactFragment('http://example.test/#v1.AAAA'), errorCode('E_ARTIFACT_FRAGMENT_INVALID'));
  assert.throws(() => decodeArtifactFragment('https://user:pass@example.test/#v1.AAAA'), errorCode('E_ARTIFACT_FRAGMENT_INVALID'));

  const noncanonicalJson = '{ "a": 1 }';
  const noncanonical = `v1.${bytesToBase64Url(deflateRaw(new TextEncoder().encode(noncanonicalJson), { level: 9 }))}`;
  assert.throws(() => decodeArtifactFragment(noncanonical), errorCode('E_ARTIFACT_CODEC_INVALID'));
  const scalar = `v1.${bytesToBase64Url(deflateRaw(new TextEncoder().encode('"scalar"'), { level: 9 }))}`;
  assert.throws(() => decodeArtifactFragment(scalar), errorCode('E_ARTIFACT_CODEC_INVALID'));
});

test('fragment and expansion limits are enforced at their exact boundaries', () => {
  const encoded = encodeArtifactFragmentDetails({ message: 'boundary' });
  assert.deepEqual(
    decodeArtifactFragmentDetails(encoded.fragment, { maxFragmentChars: encoded.fragment.length }).value,
    { message: 'boundary' },
  );
  assert.throws(
    () => decodeArtifactFragment(encoded.fragment, { maxFragmentChars: encoded.fragment.length - 1 }),
    errorCode('E_ARTIFACT_FRAGMENT_TOO_LARGE'),
  );
  assert.throws(
    () => decodeArtifactFragment(`v1.${'A'.repeat(7_998)}`, { maxFragmentChars: 9_000 }),
    errorCode('E_ARTIFACT_FRAGMENT_TOO_LARGE'),
    'callers cannot raise the hard 8,000-character ceiling',
  );
  const bomb = compressArtifactPayload({ data: 'x'.repeat(1024 * 1024) }).compressed;
  assert.throws(
    () => decodeCompressedArtifactPayload(bomb, { maxExpandedBytes: 1024 }),
    errorCode('E_ARTIFACT_DECOMPRESSION_LIMIT'),
  );
  assert.throws(
    () => compressArtifactPayload({ ok: true }, { maxExpandedBytes: Number.POSITIVE_INFINITY }),
    errorCode('E_ARTIFACT_CODEC_INVALID'),
  );
});

test('fragment URLs allow HTTPS and loopback HTTP with optional origin pinning', () => {
  assert.deepEqual(decodeArtifactFragment(`http://127.0.0.1:8787/#${golden.fragment}`), golden.value);
  assert.deepEqual(
    decodeArtifactFragment(`https://share.openplanr.dev/#${golden.fragment}`, {
      allowedOrigins: ['https://share.openplanr.dev'],
    }),
    golden.value,
  );
  assert.throws(
    () => decodeArtifactFragment(`https://other.example/#${golden.fragment}`, {
      allowedOrigins: ['https://share.openplanr.dev'],
    }),
    errorCode('E_ARTIFACT_FRAGMENT_INVALID'),
  );
});

test('browser codec source does not depend on Node globals', () => {
  const source = readFileSync(join(here, '../../lib/artifact/codec.mjs'), 'utf8');
  assert.doesNotMatch(source, /(?:from\s+['"]node:|require\s*\(|\bBuffer\b|\bprocess\.)/);
});
