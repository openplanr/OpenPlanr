import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { protocolAssetUrl } from '../../packages/protocol/src/browser-contracts.mjs';
import {
  assertLargeObjectContract,
  LARGE_OBJECT_SCHEMAS,
  LARGE_OBJECT_LIMITS as limits,
} from '../../packages/protocol/src/large-object-contracts.mjs';
import { assertPreviewBridgeMessage } from '../../packages/protocol/src/sharing-security-contracts.mjs';

function maximumManifest() {
  const chunks = Array.from({ length: limits.chunks }, (_, index) => {
    const iv = Buffer.alloc(12);
    iv.writeUInt32BE(index, 8);
    return {
      index,
      iv: iv.toString('base64url'),
      sha256: '0'.repeat(64),
      byteLength:
        index < limits.chunks - 1
          ? limits.chunkBytes
          : limits.decodedBytes - (limits.chunks - 1) * limits.chunkPlaintextBytes + 16,
    };
  });
  return {
    schemaVersion: '2.0.0',
    kind: 'openplanr-encrypted-resource-manifest',
    workspaceId: 'W'.repeat(22),
    revisionId: 'R'.repeat(22),
    epoch: 1,
    createdAt: '2026-10-02T00:00:00.000Z',
    plaintextBytes: limits.decodedBytes,
    ciphertextBytes: limits.ciphertextBytes,
    catalog: {
      offset: limits.decodedBytes - 1,
      encodedBytes: 1,
      decodedBytes: 1,
      codec: 'identity',
    },
    chunks,
    signature: 'X'.repeat(86),
  };
}
test('maximum binary manifest has 129 bounded chunks and rejects every one-step count, size and accounting overflow', () => {
  const valid = maximumManifest();
  assert.equal(assertLargeObjectContract(valid, 'encrypted-resource-manifest'), valid);
  for (const change of [
    (v) => v.chunks.push({ ...v.chunks.at(-1), index: 129 }),
    (v) => v.plaintextBytes++,
    (v) => v.ciphertextBytes++,
    (v) => v.chunks[0].byteLength++,
    (v) => (v.chunks[1].iv = v.chunks[0].iv),
    (v) => (v.chunks[0].index = 1),
    (v) => (v.catalog.decodedBytes = limits.catalogBytes + 1),
    (v) => v.catalog.offset--,
    (v) => v.chunks.pop(),
  ]) {
    const invalid = structuredClone(valid);
    change(invalid);
    assert.throws(() => assertLargeObjectContract(invalid, 'encrypted-resource-manifest'));
  }
});
test('one bounded catalog can describe 256 independent sources, 1024 resources and 4096 lazy views', () => {
  const resources = Array.from({ length: limits.resources }, (_, i) => ({
    id: `r${i}`,
    type: i < limits.sources ? 'html-segments' : 'shared-block',
    offset: i,
    encodedBytes: 1,
    decodedBytes: 1,
    codec: 'identity',
    sha256: '0'.repeat(64),
  }));
  const sources = Array.from({ length: limits.sources }, (_, i) => ({
    id: `s${i}`,
    resourceId: `r${i}`,
    htmlBytes: limits.uniqueHtmlBytes / limits.sources,
    sha256: '0'.repeat(64),
  }));
  const catalog = {
    schemaVersion: '1.0.0',
    kind: 'openplanr-resource-catalog',
    bundle: {},
    uniqueHtmlBytes: limits.uniqueHtmlBytes,
    totalDecodedBytes: 1024 * 1024,
    resources,
    sources,
    viewSources: Object.fromEntries(
      Array.from({ length: limits.views }, (_, i) => [`view${i}`, `s${i % limits.sources}`]),
    ),
  };
  assert.equal(assertLargeObjectContract(catalog, 'resource-catalog'), catalog);
  for (const change of [
    (v) => v.sources.push({ ...v.sources[0], id: 'overflow' }),
    (v) => v.resources.push({ ...v.resources[0], id: 'r1024' }),
    (v) => (v.viewSources.extra = 's0'),
    (v) => v.uniqueHtmlBytes++,
    (v) => (v.totalDecodedBytes = limits.decodedBytes + 1),
    (v) => (v.resources[1].offset = 0),
    (v) => (v.sources[1].resourceId = 'r999'),
    (v) => (v.viewSources.view1 = 'absent'),
  ]) {
    const invalid = structuredClone(catalog);
    change(invalid);
    assert.throws(() => assertLargeObjectContract(invalid, 'resource-catalog'));
  }
});
test('every additive Studio contract resolves to its exact published schema', () => {
  for (const [kind, schema] of Object.entries(LARGE_OBJECT_SCHEMAS)) {
    const url = protocolAssetUrl(kind, { protocolVersion: '1.17.0' });
    assert.deepEqual(JSON.parse(readFileSync(url, 'utf8')), schema, kind);
    assert.equal(schema['x-openplanr-contract'].version, '1.17.0', kind);
  }
});

test('preview bridge carries declared actions and rejects arbitrary authority or unbounded state', () => {
  const ready = {
    schemaVersion: '1.0.0',
    channel: 'N'.repeat(43),
    type: 'ready',
    viewId: 'home:desktop',
  };
  assert.equal(assertPreviewBridgeMessage(ready), ready);
  for (const forged of [
    { ...ready, type: 'fetch', url: 'https://example.com' },
    { ...ready, type: 'execute', code: 'alert(1)' },
    { ...ready, type: 'write', projectId: 'private' },
    { ...ready, channel: 'short' },
    { ...ready, extra: true },
  ])
    assert.throws(() => assertPreviewBridgeMessage(forged));
  const state = { ...ready, type: 'state', state: { session: { tab: 'overview' }, forms: {} } };
  assert.equal(assertPreviewBridgeMessage(state), state);
  assert.throws(() =>
    assertPreviewBridgeMessage({
      ...state,
      state: { session: { text: 'x'.repeat(8193) }, forms: {} },
    }),
  );
  assert.throws(() =>
    assertPreviewBridgeMessage({
      ...state,
      state: { session: { constructor: 'unsafe' }, forms: {} },
    }),
  );
});
