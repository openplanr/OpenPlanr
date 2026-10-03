import assert from 'node:assert/strict';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalizeJson, sha256Hex } from '@openplanr/protocol/canonical-json';
import {
  assertLargeObjectContract,
  LARGE_OBJECT_LIMITS as limits,
  RESOURCE_HTML_SEGMENT_ENCODING,
} from '@openplanr/protocol/large-object-contracts';
import {
  assertDesignReviewBundleMetadata,
  commitWorkspace,
  createWorkspaceSigner,
  prepareWorkspace,
  prepareWorkspaceEvent,
  readWorkspaceEvents,
  signWorkspaceValue,
  verifyWorkspaceSignature,
  workspaceEnvelopeDigest,
} from '../../design/lib/design/workspace-client.mjs';
import {
  decodeHtmlSegments,
  decodeResource,
  encodeHtmlSegments,
  encodeResource,
  encryptResourcePack,
  openCompanyResourcePack,
  openResourcePack,
  packCompanyResourceBundle,
  packResourceBundle,
} from '../lib/artifact/resource-pack.mjs';
import { persistUploadSpool, spoolChunkReader } from '../lib/artifact/upload-spool.mjs';

const encoder = new TextEncoder();
function noise(size) {
  const bytes = new Uint8Array(size);
  for (let at = 0; at < size; at += 65536)
    crypto.getRandomValues(bytes.subarray(at, Math.min(at + 65536, size)));
  return Buffer.from(bytes).toString('base64');
}
function bundle(html = ['<h1>Private design</h1>']) {
  return {
    schemaVersion: '1.0.0',
    kind: 'openplanr-design-review-bundle',
    revision: 'render-1',
    design: {
      id: 'work',
      title: 'Private design',
      screens: html.map((_, i) => ({ id: `s${i}`, title: `Screen ${i}` })),
      frames: [{ id: 'desktop', label: 'Desktop', width: 1440, height: 1024 }],
      variants: [{ id: 'A', label: 'First', status: 'ready' }],
      screenOrder: html.map((_, i) => `s${i}`),
      selectedVariant: 'A',
      defaultView: 'canvas',
    },
    envelope: {
      schemaVersion: '1.0.0',
      artifacts: html.map((value, i) => ({ id: `s${i}`, html: value })),
      viewer: { mode: html.length === 1 ? 'single' : 'gallery' },
    },
    entries: html.map((_, i) => ({
      artifactId: `s${i}`,
      screenId: `s${i}`,
      variantId: 'A',
      frameId: 'desktop',
    })),
    state: { positions: {} },
    verification: { status: 'unverified' },
  };
}
async function encrypted(input) {
  const signer = await createWorkspaceSigner();
  const pack = await packResourceBundle(input),
    key = crypto.getRandomValues(new Uint8Array(32));
  return {
    ...(await encryptResourcePack(pack, {
      workspaceId: 'W'.repeat(22),
      revisionId: 'R'.repeat(22),
      epoch: 1,
      rawKey: key,
      sign: (value) => signWorkspaceValue(value, signer.privateKey),
    })),
    key,
    pack,
    signer,
  };
}
test('93 screens pool repeated script/style blocks before compression and reconstruct exact UTF-8', async () => {
  const shared = noise(20000),
    html = Array.from(
      { length: 93 },
      (_, i) =>
        `<!doctype html><style>${shared}</style><h1>Screen ${i} مرحبا</h1><script>${shared}</script>`,
    ),
    input = bundle(html);
  const { manifest, chunks, key, signer, pack } = await encrypted(input);
  assert.equal(pack.catalog.sources.length, 93);
  assert.equal(pack.catalog.resources.filter((r) => r.type === 'shared-block').length, 1);
  assert.ok(pack.catalog.totalDecodedBytes < pack.catalog.uniqueHtmlBytes / 20);
  const reader = await openResourcePack(manifest, {
    rawKey: key,
    verify: (value) => verifyWorkspaceSignature(value, signer.publicKey),
    fetchChunk: async (i) => chunks[i],
  });
  assert.equal((await reader.loadView('s92')).html, html[92]);
  assert.deepEqual(await reader.loadBundle(), input);
  reader.dispose();
});
test('catalog-last lazy delivery reads only catalog and selected source, then rejects tampering and wrong AAD', async () => {
  const input = bundle(
    Array.from({ length: 4 }, (_, i) => `<article>${i}:${noise(1300000)}</article>`),
  );
  const data = await encrypted(input),
    fetched = [];
  const reader = await openResourcePack(data.manifest, {
    rawKey: data.key,
    verify: (value) => verifyWorkspaceSignature(value, data.signer.publicKey),
    fetchChunk: async (i) => {
      fetched.push(i);
      return data.chunks[i];
    },
  });
  assert.ok(data.chunks.length > 4);
  assert.ok(fetched.length < 2);
  assert.equal(fetched[0], data.chunks.length - 1);
  const selected = await reader.loadView('s0');
  assert.equal(selected.html, input.envelope.artifacts[0].html);
  assert.ok(new Set(fetched).size < data.chunks.length);
  reader.dispose();
  await assert.rejects(reader.loadView('s1'), /disposed/);
  const corrupt = data.chunks.map((chunk) => chunk.slice());
  corrupt.at(-1)[0] ^= 1;
  await assert.rejects(
    openResourcePack(data.manifest, {
      rawKey: data.key,
      verify: (value) => verifyWorkspaceSignature(value, data.signer.publicKey),
      fetchChunk: async (i) => corrupt[i],
    }),
    /integrity/,
  );
  const foreign = await signWorkspaceValue(
    { ...data.manifest, workspaceId: 'F'.repeat(22) },
    data.signer.privateKey,
  );
  await assert.rejects(
    openResourcePack(foreign, {
      rawKey: data.key,
      verify: (value) => verifyWorkspaceSignature(value, data.signer.publicKey),
      fetchChunk: async (i) => data.chunks[i],
    }),
  );
});
test('company service-visible resource catalog binds logical scope and content without an inline giant JSON', async () => {
  const input = bundle(['<h1>Company confidential</h1>']),
    scope = {
      organizationId: 'org_acme',
      projectId: 'p_acme',
      artifactId: 'a_design',
      revisionId: 'R'.repeat(22),
    };
  const packed = await packCompanyResourceBundle(input, scope),
    reader = await openCompanyResourcePack(packed.manifest, {
      fetchChunk: async (i) => packed.chunks[i],
    });
  assert.deepEqual(await reader.loadBundle(), input);
  await assert.rejects(
    openCompanyResourcePack(
      { ...packed.manifest, contentDigest: `sha256:${'0'.repeat(64)}` },
      { fetchChunk: async (i) => packed.chunks[i] },
    ),
    /identity/,
  );
  assert.ok(!Object.hasOwn(packed.manifest, 'iv'));
  assert.equal(packed.manifest.organizationId, scope.organizationId);
  reader.dispose();
});
test('selected-source read limits preserve valid pooled Unicode and reject oversized views before fetching', async () => {
  const shared = 'مرحبا 🌍 '.repeat(300);
  const html = `<style>${shared}</style><h1>Chosen</h1><script>${shared}</script>`;
  const input = bundle([html, `${html}<p>Second view</p>`]);
  const data = await encrypted(input),
    fetched = [];
  const reader = await openResourcePack(data.manifest, {
    rawKey: data.key,
    verify: (value) => verifyWorkspaceSignature(value, data.signer.publicKey),
    fetchChunk: async (i) => {
      fetched.push(i);
      return data.chunks[i];
    },
  });
  const before = fetched.length;
  await assert.rejects(reader.loadView('s0', { maxSourceBytes: 8 }), /read limit/);
  assert.equal(fetched.length, before);
  for (const maxSourceBytes of [0, -1, 1.5, Infinity, limits.uniqueHtmlBytes + 1])
    await assert.rejects(reader.loadView('s0', { maxSourceBytes }), /read limit is invalid/);
  assert.equal(
    (await reader.loadView('s0', { maxSourceBytes: encoder.encode(html).length })).html,
    html,
  );
  assert.equal(await reader.loadSource(data.pack.catalog.viewSources.s0), html);
  assert.equal((await reader.loadView('s1')).html, input.envelope.artifacts[1].html);
  reader.dispose();
});
test('a bounded read rejects a forged decoded-resource size before fetching or inflating its chunk', async () => {
  const pack = await packResourceBundle(bundle(['x']));
  // The authenticated catalog lies about reconstructed HTML size. Its compressed
  // resource occupies an earlier chunk; opening the tail catalog cannot read it.
  const resource = new Uint8Array(limits.chunkPlaintextBytes + 2);
  const descriptor = pack.catalog.resources[0];
  Object.assign(descriptor, {
    encodedBytes: resource.length,
    decodedBytes: 64 * 1024 * 1024,
    codec: 'deflate-raw',
    sha256: '0'.repeat(64),
  });
  let catalogBytes;
  for (let i = 0; i < 4; i++) {
    catalogBytes = encoder.encode(canonicalizeJson(pack.catalog));
    const total = descriptor.decodedBytes + catalogBytes.length;
    if (pack.catalog.totalDecodedBytes === total) break;
    pack.catalog.totalDecodedBytes = total;
  }
  catalogBytes = encoder.encode(canonicalizeJson(pack.catalog));
  assert.equal(pack.catalog.totalDecodedBytes, descriptor.decodedBytes + catalogBytes.length);
  const catalog = encodeResource(catalogBytes);
  Object.assign(pack, {
    encodedResources: [resource, catalog.bytes],
    catalogSpan: {
      offset: resource.length,
      encodedBytes: catalog.bytes.length,
      decodedBytes: catalogBytes.length,
      codec: catalog.codec,
    },
    plaintextBytes: resource.length + catalog.bytes.length,
  });
  const signer = await createWorkspaceSigner(),
    key = crypto.getRandomValues(new Uint8Array(32));
  const data = await encryptResourcePack(pack, {
    workspaceId: 'W'.repeat(22),
    revisionId: 'R'.repeat(22),
    epoch: 1,
    rawKey: key,
    sign: (value) => signWorkspaceValue(value, signer.privateKey),
  });
  const fetched = [];
  const reader = await openResourcePack(data.manifest, {
    rawKey: key,
    verify: (value) => verifyWorkspaceSignature(value, signer.publicKey),
    fetchChunk: async (i) => {
      fetched.push(i);
      return data.chunks[i];
    },
  });
  assert.deepEqual(fetched, [1]);
  await assert.rejects(
    reader.loadView('s0', { maxSourceBytes: 8 }),
    /resource exceeds its read limit/,
  );
  assert.deepEqual(fetched, [1]);
  reader.dispose();
});
test('bounded codecs reject declared expansion overflow and trailing compressed bytes', () => {
  const value = encoder.encode('x'.repeat(200000)),
    encoded = encodeResource(value),
    span = {
      offset: 0,
      codec: encoded.codec,
      encodedBytes: encoded.bytes.length,
      decodedBytes: value.length,
    };
  assert.deepEqual(decodeResource(encoded.bytes, span), value);
  assert.throws(
    () => decodeResource(encoded.bytes, { ...span, decodedBytes: 10 }),
    /expands|corrupt/,
  );
  const trailing = new Uint8Array(encoded.bytes.length + 1);
  trailing.set(encoded.bytes);
  trailing[trailing.length - 1] = 42;
  assert.throws(
    () => decodeResource(trailing, { ...span, encodedBytes: trailing.length }),
    /trailing/,
  );
});
test('bounded inflate drains pending matches and requires an actual deflate end marker', () => {
  const value = encodeHtmlSegments(['"'.repeat(1048576)]);
  const encoded = encodeResource(value);
  const descriptor = {
    offset: 0,
    codec: encoded.codec,
    encodedBytes: encoded.bytes.length,
    decodedBytes: value.length,
  };
  assert.deepEqual(decodeResource(encoded.bytes, descriptor), value);
  const shortened = encoded.bytes.subarray(0, encoded.bytes.length - 1);
  assert.throws(
    () => decodeResource(shortened, { ...descriptor, encodedBytes: shortened.length }),
    /corrupt/,
  );
  // Two nonterminal stored blocks emit all 64 KiB, but contain no end-of-stream marker.
  const unterminated = new Uint8Array(65536 + 10);
  unterminated.set([0, 255, 255, 0, 0]);
  unterminated.fill(65, 5, 65540);
  unterminated.set([0, 1, 0, 254, 255, 65], 65540);
  assert.throws(
    () =>
      decodeResource(unterminated, {
        offset: 0,
        codec: 'deflate-raw',
        encodedBytes: unterminated.length,
        decodedBytes: 65536,
      }),
    /corrupt/,
  );
});
test('catalog validation rejects resource gaps, repeated IVs, accessors and unbounded metadata before reading', async () => {
  const data = await encrypted(bundle());
  const catalog = structuredClone(data.pack.catalog);
  catalog.resources[0].offset = 1;
  assert.throws(() => assertLargeObjectContract(catalog, 'resource-catalog'), /sequence/);
  const metadata = {};
  let cursor = metadata;
  for (let i = 0; i < 50; i++) cursor = cursor.next = {};
  assert.throws(
    () => assertLargeObjectContract({ ...data.pack.catalog, bundle: metadata }, 'resource-catalog'),
    /complexity/,
  );
  let accessed = false;
  const malicious = { ...data.pack.catalog };
  Object.defineProperty(malicious, 'bundle', {
    enumerable: true,
    get() {
      accessed = true;
      return {};
    },
  });
  assert.throws(() => assertLargeObjectContract(malicious, 'resource-catalog'), /accessors/);
  assert.equal(accessed, false);
  assert.equal(limits.chunks, Math.ceil(limits.decodedBytes / limits.chunkPlaintextBytes));
  assert.equal(limits.ciphertextBytes, limits.decodedBytes + limits.chunks * 16);
});
test('durable spool resumes lost chunk and commit responses across restarts without duplicate publication', async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'planr-chunk-upload-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const original = await prepareWorkspace(bundle(), {
    transport: '2',
    baseUrl: 'https://share.openplanr.dev',
  });
  await persistUploadSpool(original, root);
  assert.equal(lstatSync(original.spoolDirectory).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(original.spoolDirectory, 'request.json')).mode & 0o777, 0o600);
  const exact = canonicalizeJson(original.pendingCreate),
    prepared = original.pendingCreate,
    hash = sha256Hex(canonicalizeJson(prepared.manifest));
  let receipt = null,
    commits = 0,
    chunkWrites = 0,
    loseChunk = true,
    loseCommit = true;
  const received = [];
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/commit')) {
      commits++;
      receipt = {
        schemaVersion: '2.0.0',
        workspaceId: original.id,
        operationId: prepared.operationId,
        revisionId: prepared.manifest.revisionId,
        manifestSha256: hash,
        status: 'committed',
        version: 1,
        committedAt: new Date().toISOString(),
      };
      if (loseCommit) {
        loseCommit = false;
        throw new Error('lost commit response');
      }
      return Response.json(receipt);
    }
    if (url.includes('/chunks/')) {
      chunkWrites++;
      const index = Number(url.split('/').at(-1)),
        descriptor = prepared.manifest.chunks[index];
      assert.deepEqual(
        new Uint8Array(init.body),
        new Uint8Array(readFileSync(join(original.spoolDirectory, `${index}.bin`))),
      );
      assert.ok(!received.some((chunk) => chunk.index === index));
      received.push({ index, sha256: descriptor.sha256, byteLength: descriptor.byteLength });
      if (loseChunk) {
        loseChunk = false;
        throw new Error('lost chunk response');
      }
      return new Response(null, { status: 204 });
    }
    assert.equal(init.body, exact);
    return Response.json({
      schemaVersion: '2.0.0',
      workspaceId: original.id,
      operationId: prepared.operationId,
      revisionId: prepared.manifest.revisionId,
      manifestSha256: hash,
      status: receipt ? 'committed' : 'prepared',
      receivedChunks: received,
      ...(receipt ? { receipt } : {}),
    });
  };
  await assert.rejects(
    commitWorkspace(original, {
      fetchImpl,
      readChunk: spoolChunkReader(original.spoolDirectory, prepared),
    }),
    /interrupted/,
  );
  assert.equal(commits, 0);
  assert.equal(chunkWrites, 1);
  assert.equal(canonicalizeJson(original.pendingCreate), exact);
  const restartedAfterChunk = JSON.parse(JSON.stringify(original));
  await assert.rejects(
    commitWorkspace(restartedAfterChunk, {
      fetchImpl,
      readChunk: spoolChunkReader(
        restartedAfterChunk.spoolDirectory,
        restartedAfterChunk.pendingCreate,
      ),
    }),
    /interrupted/,
  );
  assert.equal(commits, 1);
  assert.equal(chunkWrites, prepared.manifest.chunks.length);
  assert.equal(canonicalizeJson(restartedAfterChunk.pendingCreate), exact);
  const restarted = JSON.parse(JSON.stringify(restartedAfterChunk));
  await commitWorkspace(restarted, {
    fetchImpl,
    readChunk: spoolChunkReader(restarted.spoolDirectory, restarted.pendingCreate),
  });
  assert.equal(commits, 1);
  assert.equal(chunkWrites, prepared.manifest.chunks.length);
  assert.equal(restarted.version, 1);
  assert.equal(restarted.currentRevision, prepared.manifest.revisionId);
  assert.ok(!restarted.pendingCreate);
  const path = join(original.spoolDirectory, '0.bin'),
    bad = readFileSync(path);
  bad[0] ^= 1;
  writeFileSync(path, bad);
  await assert.rejects(spoolChunkReader(original.spoolDirectory, prepared)(0), /corrupt/);
});

test('encrypted lazy catalog preserves the full review basis before any selected HTML is loaded', async () => {
  const input = bundle(['<h1>Full basis</h1>']);
  const custody = await prepareWorkspace(input, { transport: '2' });
  const { uploadChunksFor } = await import('../lib/artifact/chunked-workspace-client.mjs');
  const chunks = uploadChunksFor(custody);
  const reader = await openResourcePack(custody.pendingCreate.manifest, {
    rawKey: Buffer.from(custody.keys[1], 'base64url'),
    verify: (value) => verifyWorkspaceSignature(value, custody.ownerPublicKey),
    fetchChunk: async (i) => chunks[i],
  });
  assert.equal(reader.reviewOf, workspaceEnvelopeDigest(input.envelope));
  assert.notEqual(reader.reviewOf, workspaceEnvelopeDigest(reader.bundle.envelope));
  assert.ok(!Object.hasOwn(reader.bundle.envelope.artifacts[0], 'html'));
  assert.deepEqual(await reader.loadBundle(), input);
  reader.dispose();
});

test('metadata-only envelope validation checks shared source/view identity without fabricated HTML', async () => {
  const { createSharedArtifactEnvelope } = await import('../lib/artifact/envelope.mjs');
  const envelope = createSharedArtifactEnvelope({
    sources: [{ id: 'source', html: '<h1>Source</h1>' }],
    artifacts: [{ id: 's0', title: 'Home', sourceId: 'source' }],
  });
  const input = bundle();
  input.envelope = envelope;
  const packed = await packResourceBundle(input);
  assert.equal(assertDesignReviewBundleMetadata(packed.catalog.bundle), packed.catalog.bundle);
  const invalid = structuredClone(packed.catalog.bundle);
  invalid.envelope.artifacts[0].sourceId = 'missing';
  assert.throws(() => assertDesignReviewBundleMetadata(invalid), /source identity/);
  const inline = structuredClone(packed.catalog.bundle);
  inline.envelope.sources[0].html = '<h1>Unexpected inline data</h1>';
  assert.throws(() => assertDesignReviewBundleMetadata(inline), /metadata/);
});
test('authenticated v2 feedback normalizes the semantic signer alias without exposing review basis in the wire record', async () => {
  const custody = await prepareWorkspace(bundle(), { transport: '2' });
  custody.currentRevision = custody.pendingCreate.manifest.revisionId;
  custody.version = 1;
  const reviewOf = workspaceEnvelopeDigest(bundle().envelope),
    payload = { kind: 'direction', author: 'Reviewer', reviewOf, summary: 'Adjust contrast' };
  const record = await prepareWorkspaceEvent(custody, payload, { reviewOf });
  assert.ok(!Object.hasOwn(record, 'reviewOf'));
  assert.ok(!Object.hasOwn(record, 'publicKey'));
  const result = await readWorkspaceEvents(custody, {
    fetchImpl: async () =>
      Response.json({ events: [{ ...record, sequence: 1 }], cursor: 1, hasMore: false }),
  });
  assert.equal(result.issues.length, 0);
  assert.deepEqual(result.events[0].publicKey, record.authorPublicKey);
  assert.equal(result.events[0].reviewOf, reviewOf);
});

test('native93-screen five-frame publication keeps465 views and lazily decrypts a selected source', async () => {
  const { createSharedArtifactEnvelope } = await import('../lib/artifact/envelope.mjs');
  const { bundleDesignRevision } = await import('../../design/lib/design/context.mjs');
  const { uploadChunksFor } = await import('../lib/artifact/chunked-workspace-client.mjs');
  const shared = noise(20000);
  const html = Array.from(
    { length: 93 },
    (_, index) => `<style>${shared}</style><main>${index}:${noise(32768)}</main>`,
  );
  const document = bundle(html).design;
  document.frames = Array.from({ length: 5 }, (_, index) => ({
    id: `frame${index}`,
    label: `Frame ${index}`,
    width: 360 + index * 240,
    height: 800,
  }));
  const entries = document.screenOrder.flatMap((screenId) =>
    document.frames.map((frame) => ({
      artifactId: `${screenId}-A-${frame.id}`,
      screenId,
      variantId: 'A',
      frameId: frame.id,
    })),
  );
  const envelope = createSharedArtifactEnvelope({
    sources: html.map((value, index) => ({ id: `s${index}`, html: value })),
    artifacts: entries.map((entry) => ({
      id: entry.artifactId,
      title: entry.artifactId,
      sourceId: entry.screenId,
      viewport: document.frames.find((frame) => frame.id === entry.frameId),
    })),
  });
  const input = bundleDesignRevision({ document, envelope, entries, revision: 'R'.repeat(64) });
  const custody = await prepareWorkspace(input, { transport: '2' });
  const manifest = custody.pendingCreate.manifest,
    chunks = uploadChunksFor(custody),
    fetched = [];
  const reader = await openResourcePack(manifest, {
    rawKey: Buffer.from(custody.keys[1], 'base64url'),
    verify: (value) => verifyWorkspaceSignature(value, custody.ownerPublicKey),
    fetchChunk: async (index) => {
      fetched.push(index);
      return chunks[index];
    },
  });
  assert.equal(reader.bundle.envelope.sources.length, 93);
  assert.equal(reader.bundle.envelope.artifacts.length, 465);
  assert.equal(reader.bundle.design.frames.length, 5);
  assertDesignReviewBundleMetadata(reader.bundle);
  assert.equal((await reader.loadView(entries.at(-1).artifactId)).html, html.at(-1));
  assert.ok(new Set(fetched).size < chunks.length);
  reader.dispose();
});

test('company full reconstruction preserves repeated inline sources as a bounded pool before assembling a giant bundle', async () => {
  const html = '<main>' + 'x'.repeat(1024 * 1024) + '</main>';
  const input = bundle(Array.from({ length: 256 }, () => html));
  const packed = await packCompanyResourceBundle(input, {
    organizationId: 'org_acme',
    projectId: 'p_acme',
    artifactId: 'a_design',
    revisionId: 'A'.repeat(22),
  });
  const reader = await openCompanyResourcePack(packed.manifest, {
    fetchChunk: async (index) => packed.chunks[index],
  });
  assert.ok(reader.catalog.totalDecodedBytes < 2 * 1024 * 1024);
  const materialized = await reader.loadBundle();
  assert.equal(materialized.envelope.schemaVersion, '1.1.0');
  assert.equal(materialized.envelope.sources.length, 1);
  assert.equal(materialized.envelope.artifacts.length, 256);
  assert.equal(materialized.envelope.sources[0].html, html);
  assert.ok(encoder.encode(canonicalizeJson(materialized)).byteLength < 2 * 1024 * 1024);
  await reader.assertMatchesBundle(input);
  await assert.rejects(reader.assertMatchesBundle({ ...input, revision: 'changed' }), /differs/);
  assert.equal((await reader.loadView('s255')).html, html, 'lazy selected views remain available');
  reader.dispose();
});

test('full reconstruction counts JSON escaping per repeated view while pooled output counts each source once', async () => {
  const html = '"'.repeat(1024 * 1024);
  const input = bundle(Array.from({ length: 65 }, () => html));
  const scope = {
    organizationId: 'org_acme',
    projectId: 'p_acme',
    artifactId: 'a_design',
    revisionId: 'B'.repeat(22),
  };
  const packed = await packCompanyResourceBundle(input, scope);
  const reader = await openCompanyResourcePack(packed.manifest, {
    fetchChunk: async (index) => packed.chunks[index],
  });
  const escaped = await reader.loadBundle();
  assert.equal(escaped.envelope.sources.length, 1);
  assert.ok(encoder.encode(canonicalizeJson(escaped)).byteLength < 3 * 1024 * 1024);
  reader.catalog.bundle.revision = 'forged-public-metadata';
  await reader.assertMatchesBundle(input);
  const changed = structuredClone(input);
  changed.envelope.artifacts[0].html += 'changed';
  await assert.rejects(reader.assertMatchesBundle(changed), /differs/);
  reader.dispose();
  const pooled = structuredClone(input);
  pooled.envelope.schemaVersion = '1.1.0';
  pooled.envelope.sources = [{ id: 'shared', html }];
  pooled.envelope.artifacts = pooled.envelope.artifacts.map(({ html: _html, ...view }) => ({
    ...view,
    sourceId: 'shared',
  }));
  const packedPool = await packCompanyResourceBundle(pooled, scope);
  const poolReader = await openCompanyResourcePack(packedPool.manifest, {
    fetchChunk: async (index) => packedPool.chunks[index],
  });
  assert.deepEqual(await poolReader.loadBundle(), pooled);
  poolReader.dispose();
});

test('maximum 4096 view references reuse one 1MiB source without allocating repeated inline HTML', async () => {
  const html = '<main>' + 'x'.repeat(1024 * 1024) + '</main>';
  const input = bundle([html]);
  input.envelope.artifacts = Array.from({ length: limits.views }, (_, index) => ({
    id: `v${index}`,
    html,
  }));
  input.entries = input.envelope.artifacts.map(({ id }) => ({
    artifactId: id,
    screenId: 's0',
    variantId: 'A',
    frameId: 'desktop',
  }));
  const packed = await packCompanyResourceBundle(input, {
    organizationId: 'org_acme',
    projectId: 'p_acme',
    artifactId: 'a_design',
    revisionId: 'C'.repeat(22),
  });
  assert.equal(packed.catalog.sources.length, 1);
  const reader = await openCompanyResourcePack(packed.manifest, {
    fetchChunk: async (index) => packed.chunks[index],
  });
  const restored = await reader.loadBundle();
  assert.equal(restored.envelope.artifacts.length, limits.views);
  assert.equal(restored.envelope.sources.length, 1);
  assert.equal(restored.envelope.sources[0].html, html);
  assert.ok(encoder.encode(canonicalizeJson(restored)).byteLength < 3 * 1024 * 1024);
  assert.equal((await reader.loadView('v4095')).html, html);
  await reader.assertMatchesBundle(input);
  reader.dispose();
});

test('versioned UTF8 segment spans preserve BOM and controls while old JSON segments remain readable', () => {
  const segments = ['\ufeff"\\\u0000\n\t😀', { resourceId: 'r12' }, 'after'];
  const raw = encodeHtmlSegments(segments);
  assert.equal(raw[0], 0);
  assert.deepEqual(decodeHtmlSegments(raw), segments);
  assert.deepEqual(decodeHtmlSegments(encoder.encode(canonicalizeJson(segments))), segments);
  const padded = new Uint8Array(raw.length + 8);
  padded.set(raw, 4);
  assert.deepEqual(decodeHtmlSegments(padded.subarray(4, 4 + raw.length)), segments);
  assert.throws(() => encodeHtmlSegments(['\ud800']), /Unicode/);
  assert.throws(() => encodeHtmlSegments(segments, raw.length - 1), /limit/);
  assert.throws(() => decodeHtmlSegments(raw, raw.length - 1), /limit/);
  let accessed = false;
  const accessor = Object.defineProperty({}, 'resourceId', {
    get() {
      accessed = true;
      return 'r12';
    },
  });
  assert.throws(() => encodeHtmlSegments([accessor]), /invalid/);
  assert.equal(accessed, false);
  const magicBytes = encoder.encode(`\0${RESOURCE_HTML_SEGMENT_ENCODING}\0`).length;
  for (const mutate of [
    (bytes) => {
      bytes[1] ^= 1;
    },
    (bytes) => new DataView(bytes.buffer).setUint32(magicBytes, 0xffffffff),
    (bytes) => {
      bytes[magicBytes + 4] = 255;
    },
    (bytes) => new DataView(bytes.buffer).setUint32(magicBytes + 5, 0xffffffff),
    (bytes) => {
      bytes[magicBytes + 9] = 255;
    },
  ]) {
    const invalid = raw.slice();
    mutate(invalid);
    assert.throws(() => decodeHtmlSegments(invalid));
  }
  assert.throws(() => decodeHtmlSegments(raw.subarray(0, raw.length - 1)), /truncated|invalid/);
  const trailing = new Uint8Array(raw.length + 1);
  trailing.set(raw);
  assert.throws(() => decodeHtmlSegments(trailing), /trailing/);
  assert.throws(() => decodeHtmlSegments(encoder.encode('[{"resourceId":"foreign"}]')), /invalid/);
});

test('the exact 100MiB unique HTML boundary counts raw quotes and controls and reconstructs once', async () => {
  const pattern = '"\\\u0001\n\t';
  assert.equal(encoder.encode(pattern).length, 5);
  const head = '<main>',
    tail = '</main>',
    remaining = limits.uniqueHtmlBytes - head.length - tail.length;
  const html =
    head +
    pattern.repeat(Math.floor(remaining / pattern.length)) +
    pattern.slice(0, remaining % pattern.length) +
    tail;
  const input = bundle([html]);
  const packed = await packCompanyResourceBundle(input, {
    organizationId: 'org_acme',
    projectId: 'p_acme',
    artifactId: 'a_design',
    revisionId: 'D'.repeat(22),
  });
  assert.equal(packed.catalog.uniqueHtmlBytes, limits.uniqueHtmlBytes);
  assert.ok(packed.catalog.resources[0].decodedBytes < limits.uniqueHtmlBytes + 128);
  assert.ok(packed.catalog.totalDecodedBytes < limits.uniqueHtmlBytes + 4096);
  const reader = await openCompanyResourcePack(packed.manifest, {
    fetchChunk: async (index) => packed.chunks[index],
  });
  assert.equal((await reader.loadView('s0')).html, html);
  const restored = await reader.loadBundle({ sourcePool: true });
  assert.equal(restored.envelope.sources.length, 1);
  assert.equal(restored.envelope.sources[0].html, html);
  reader.dispose();
  const oversized = `${html}x`,
    encode = TextEncoder.prototype.encode;
  TextEncoder.prototype.encode = function (value) {
    if (value === oversized) throw new Error('Oversized source allocated before validation.');
    return encode.call(this, value);
  };
  try {
    await assert.rejects(packResourceBundle(bundle([oversized])), /unique HTML limit/);
  } finally {
    TextEncoder.prototype.encode = encode;
  }
});

test('raw segment source and shared-block decoding retain leading BOM bytes', async () => {
  const html = '\ufeff<h1>Before</h1><script>' + '\ufeff' + 'x'.repeat(2048) + '</script>';
  const packed = await packCompanyResourceBundle(bundle([html]), {
    organizationId: 'org_acme',
    projectId: 'p_acme',
    artifactId: 'a_design',
    revisionId: 'E'.repeat(22),
  });
  const reader = await openCompanyResourcePack(packed.manifest, {
    fetchChunk: async (index) => packed.chunks[index],
  });
  assert.equal((await reader.loadView('s0')).html, html);
  reader.dispose();
});

test('logical source comparison rejects Unicode replacement and pooled HTML coercion', async () => {
  const input = bundle(['\ufffd', '123']);
  input.envelope = {
    ...input.envelope,
    schemaVersion: '1.1.0',
    sources: [
      { id: 'source-0', html: '\ufffd' },
      { id: 'source-1', html: '123' },
    ],
    artifacts: input.envelope.artifacts.map(({ html: _html, ...view }, index) => ({
      ...view,
      sourceId: `source-${index}`,
    })),
  };
  const packed = await packCompanyResourceBundle(input, {
    organizationId: 'org_acme',
    projectId: 'p_acme',
    artifactId: 'a_design',
    revisionId: 'F'.repeat(22),
  });
  const reader = await openCompanyResourcePack(packed.manifest, {
    fetchChunk: async (index) => packed.chunks[index],
  });
  await reader.assertMatchesBundle(input);
  const unicode = structuredClone(input);
  unicode.envelope.sources[0].html = '\ud800';
  await assert.rejects(reader.assertMatchesBundle(unicode), /differs/);
  await assert.rejects(packResourceBundle(unicode), /Unicode/);
  const coercion = structuredClone(input);
  coercion.envelope.sources[1].html = 123;
  await assert.rejects(reader.assertMatchesBundle(coercion), /differs/);
  reader.dispose();
});
