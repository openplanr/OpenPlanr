import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { protocolAssetUrl } from '../../protocol/src/browser-contracts.mjs';
import { canonicalizeJson, sha256Hex } from '../../protocol/src/canonical-json.mjs';
import { validateProtocolArtifact } from '../../protocol/src/contracts.mjs';
import {
  assertDesignReviewBundle,
  DESIGN_REVIEW_BUNDLE_V12_SCHEMA,
} from '../../protocol/src/review-experience-contracts.mjs';
import {
  ARTIFACT_BRIDGE_CHANNEL,
  ARTIFACT_BRIDGE_VERSION,
  createArtifactBridgeNonce,
  prepareArtifactSourceTemplate,
  renderArtifactParentRuntime,
  validateArtifactBridgeMessage,
} from '../lib/artifact/bridge.mjs';
import {
  compressArtifactPayload,
  decodeCompressedArtifactPayload,
} from '../lib/artifact/codec.mjs';
import {
  createArtifactEnvelope,
  createSharedArtifactEnvelope,
  digestArtifactEnvelope,
  resolveArtifactHtml,
  validateArtifactEnvelope,
} from '../lib/artifact/envelope.mjs';
import { prepareLiveReviewRoom } from '../lib/artifact/live-room.mjs';
import { createArtifactReview, createArtifactReviewEnvelope } from '../lib/artifact/review.mjs';
import { renderArtifactShellDocument } from '../lib/artifact/ui/shell.mjs';
import { createArtifactStagePayload } from '../lib/artifact/ui/stage-payload.mjs';

function board(screenCount = 93, frameCount = 5) {
  const sources = Array.from({ length: screenCount }, (_, i) => ({
    id: `screen-${i}`,
    html: `<main data-screen="${i}">Screen ${i}</main>`,
  }));
  const artifacts = sources.flatMap((source, i) =>
    Array.from({ length: frameCount }, (_, frame) => ({
      id: `view-${i}-${frame}`,
      sourceId: source.id,
      title: `Screen ${i}, frame ${frame}`,
      viewport: { width: 400 + frame * 200, height: 900 },
    })),
  );
  return createSharedArtifactEnvelope({
    sources,
    artifacts,
    viewer: { mode: 'single', activeArtifactId: artifacts[0].id },
  });
}

function portable(template, refs) {
  const source = renderArtifactParentRuntime({
    nonce: createArtifactBridgeNonce(),
    stageRuntimeUrl: 'data:text/javascript;base64,Ow==',
    inlineSources: { shared: template },
    inlineArtifactSources: refs,
  });
  const realm = { Blob, document: { createElement: () => ({}), head: { append() {} } } };
  runInNewContext(source, realm);
  return realm.__OPENPLANR_ARTIFACT_STAGE_OPTIONS__;
}

test('parent source fetch preserves request restrictions and cancels with its owning signal', async () => {
  const requests = [];
  const releases = [];
  const realm = {
    Blob,
    document: { createElement: () => ({}), head: { append() {} } },
    fetch(url, options) {
      requests.push({ url, options });
      return new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(options.signal.reason), {
          once: true,
        });
        releases.push(() =>
          resolve({
            ok: true,
            headers: new Headers({ 'content-type': 'application/octet-stream' }),
            arrayBuffer: async () => new TextEncoder().encode('<main>Original source</main>'),
          }),
        );
      });
    },
  };
  runInNewContext(
    renderArtifactParentRuntime({
      nonce: createArtifactBridgeNonce(),
      artifactBaseUrl: '/artifacts/',
      stageRuntimeUrl: '/stage.js',
    }),
    realm,
  );
  const resolver = realm.__OPENPLANR_ARTIFACT_STAGE_OPTIONS__.resolveArtifactSource;
  const legacy = resolver({ id: 'screen-0' });
  releases.shift()();
  assert.equal(await (await legacy).text(), '<main>Original source</main>');
  const owner = new AbortController();
  const pending = resolver({ id: 'screen-1' }, { signal: owner.signal });
  assert.equal(requests[1].options.signal, owner.signal);
  assert.equal(requests[1].url, '/artifacts/screen-1');
  assert.equal(requests[1].options.cache, 'no-store');
  assert.equal(requests[1].options.credentials, 'omit');
  assert.equal(requests[1].options.referrerPolicy, 'no-referrer');
  const cancelled = assert.rejects(pending, { name: 'AbortError' });
  owner.abort();
  await cancelled;
});

test('saved reviews retain the shared envelope source pool and immutable identity', () => {
  const envelope = board(1, 5);
  const review = createArtifactReview({ reviewOf: digestArtifactEnvelope(envelope) });
  const reviewed = createArtifactReviewEnvelope(envelope, review);
  assert.equal(reviewed.schemaVersion, '1.1.0');
  assert.deepEqual(reviewed.sources, envelope.sources);
  assert.deepEqual(reviewed.artifacts, envelope.artifacts);
  assert.deepEqual(reviewed.review, review);
  assert.equal(digestArtifactEnvelope(reviewed), digestArtifactEnvelope(envelope));
  assert.ok(Object.isFrozen(reviewed.sources[0]));
  assert.equal(envelope.review, undefined);
});

test('93 canonical sources support 465 viewport references without HTML duplication', () => {
  const envelope = board();
  assert.equal(envelope.schemaVersion, '1.1.0');
  assert.equal(envelope.sources.length, 93);
  assert.equal(envelope.artifacts.length, 465);
  assert(envelope.artifacts.every((artifact) => !Object.hasOwn(artifact, 'html')));
  for (const artifact of envelope.artifacts)
    assert.equal(
      resolveArtifactHtml(envelope, artifact),
      envelope.sources.find((source) => source.id === artifact.sourceId).html,
    );
  const payload = createArtifactStagePayload(envelope);
  assert.equal(payload.artifacts.length, 465);
  assert(!Object.hasOwn(payload, 'sources'));
  assert(!JSON.stringify(payload).includes('<main'));
  assert.deepEqual(
    decodeCompressedArtifactPayload(compressArtifactPayload(envelope).compressed).value,
    envelope,
  );
  assert.deepEqual(
    validateProtocolArtifact('artifact-envelope', envelope, { protocolVersion: '1.16.0' }),
    [],
  );
  assert.equal(
    protocolAssetUrl('artifact-envelope', { protocolVersion: '1.16.0' }).pathname.endsWith(
      '/schemas/v1.16.0/artifact-envelope.schema.json',
    ),
    true,
  );
});

test('five viewport copies remain within transport limits when their HTML source is stored once', () => {
  const html = '<main>' + 'x'.repeat(2 * 1024 * 1024) + '</main>';
  const envelope = createSharedArtifactEnvelope({
    sources: [{ id: 'large-screen', html }],
    artifacts: Array.from({ length: 5 }, (_, i) => ({
      id: `large-view-${i}`,
      title: 'Screen',
      sourceId: 'large-screen',
      viewport: { width: 400 + i * 200, height: 900 },
    })),
  });
  const packed = compressArtifactPayload(envelope);
  assert(packed.expanded.byteLength < 3 * 1024 * 1024);
  assert.deepEqual(decodeCompressedArtifactPayload(packed.compressed).value, envelope);
});

test('shared digests bind source contents, viewport metadata, and reference selection; old envelopes stay inline', () => {
  const envelope = board(2, 2),
    digest = digestArtifactEnvelope(envelope);
  for (const mutate of [
    (value) => {
      value.sources[0].html += '!';
    },
    (value) => {
      value.artifacts[0].viewport.width += 1;
    },
    (value) => {
      value.artifacts[0].sourceId = value.sources[1].id;
      value.artifacts[0].sha256 = value.sources[1].sha256;
    },
    (value) => {
      value.viewer.activeArtifactId = value.artifacts[1].id;
    },
  ]) {
    const changed = structuredClone(envelope);
    mutate(changed);
    assert.notEqual(digestArtifactEnvelope(changed), digest);
  }
  const legacy = createArtifactEnvelope({
    artifacts: [{ id: 'legacy', title: 'Legacy', html: '<main>Same bytes</main>' }],
  });
  assert.equal(legacy.schemaVersion, '1.0.0');
  assert(!Object.hasOwn(legacy, 'sources'));
  assert.equal(resolveArtifactHtml(legacy, 'legacy'), '<main>Same bytes</main>');
  assert.equal(
    digestArtifactEnvelope(legacy),
    'c76790b007acec24faed2c183e62170a222b584213456d9d2c48b555a6ffe45e',
  );
  const reviewState = JSON.parse(
    /id="planr-artifact-review-state">([^<]+)/u.exec(renderArtifactShellDocument({ envelope }))[1],
  );
  assert.equal(reviewState.reviewOf, digest);
});

test('shared source validation rejects missing, forged, duplicate, orphan, and out-of-bound references', () => {
  for (const mutate of [
    (value) => {
      value.artifacts[0].sourceId = 'missing';
    },
    (value) => {
      value.artifacts[0].sha256 = '0'.repeat(64);
    },
    (value) => {
      value.sources[0].html = 'tampered';
    },
    (value) => {
      value.sources.push(structuredClone(value.sources[0]));
    },
    (value) => {
      value.artifacts.push(structuredClone(value.artifacts[0]));
    },
    (value) => {
      value.sources.push({ ...value.sources[0], id: 'orphan' });
    },
    (value) => {
      value.artifacts[0].html = 'duplicate';
    },
    (value) => {
      value.artifacts[0].viewport.width = 16385;
    },
  ]) {
    const value = board(2, 2);
    mutate(value);
    assert.throws(() => validateArtifactEnvelope(value), { code: 'E_ARTIFACT_ENVELOPE_INVALID' });
  }
  assert.throws(() =>
    createSharedArtifactEnvelope({
      sources: Array.from({ length: 257 }, (_, i) => ({ id: `source-${i}`, html: 'x' })),
      artifacts: [{ id: 'view', title: 'View', sourceId: 'source-0' }],
    }),
  );
  assert.throws(() =>
    createSharedArtifactEnvelope({
      sources: [{ id: 'source', html: 'x' }],
      artifacts: Array.from({ length: 4097 }, (_, i) => ({
        id: `view-${i}`,
        title: 'View',
        sourceId: 'source',
      })),
    }),
  );
  assert.throws(() => resolveArtifactHtml(board(1, 1), { id: 'not-owned', html: 'forged' }));
});

test('portable source templates bind distinct artifact IDs only at resolution and keep sandbox guards', async () => {
  const nonce = createArtifactBridgeNonce();
  const template = prepareArtifactSourceTemplate({
    html: '<button>Authored screen</button>',
    nonce,
  });
  const other = prepareArtifactSourceTemplate({ html: '<button>Authored screen</button>', nonce });
  assert.notEqual(template.artifactIdToken, other.artifactIdToken);
  assert.equal(template.html.split(template.artifactIdToken).length, 2);
  const options = portable(template, { desktop: 'shared', mobile: 'shared' });
  const desktop = await (await options.resolveArtifactSource({ id: 'desktop' })).text();
  const mobile = await (await options.resolveArtifactSource({ id: 'mobile' })).text();
  assert(desktop.includes('"artifactId":"desktop"'));
  assert(mobile.includes('"artifactId":"mobile"'));
  assert(!desktop.includes('"artifactId":"mobile"'));
  assert(!desktop.includes(template.artifactIdToken));
  assert(desktop.includes('Content-Security-Policy'));
  assert(desktop.includes("connect-src 'none'"));
  const source = {};
  const message = {
    source,
    origin: 'null',
    data: {
      channel: ARTIFACT_BRIDGE_CHANNEL,
      schemaVersion: ARTIFACT_BRIDGE_VERSION,
      type: 'bridge.ready',
      nonce,
      artifactId: 'desktop',
    },
  };
  assert.equal(
    validateArtifactBridgeMessage(message, { source, nonce, artifactId: 'desktop' }).ok,
    true,
  );
  assert.equal(
    validateArtifactBridgeMessage(message, { source, nonce, artifactId: 'mobile' }).ok,
    false,
  );
  assert.equal(
    validateArtifactBridgeMessage(
      { ...message, source: {} },
      { source, nonce, artifactId: 'desktop' },
    ).ok,
    false,
  );
  await assert.rejects(() => options.resolveArtifactSource({ id: 'unknown' }));
  const loopback = prepareArtifactSourceTemplate({
    html: '<main>HTTP</main>',
    nonce,
    parentOrigin: 'http://127.0.0.1:12345',
  });
  assert(loopback.html.includes('"parentOrigin":"http://127.0.0.1:12345"'));
  assert.throws(() =>
    prepareArtifactSourceTemplate({ html: 'x', nonce, parentOrigin: 'https://example.test' }),
  );
});

test('portable pool rejects partial mappings and ambiguous generated guard replacements', () => {
  const template = prepareArtifactSourceTemplate({
    html: '<main>Source</main>',
    nonce: createArtifactBridgeNonce(),
  });
  for (const source of [
    { ...template, html: template.html + template.artifactIdToken },
    { ...template, html: template.html.replace(template.artifactIdToken, '') },
    { ...template, artifactIdToken: 'Authored' },
  ])
    assert.throws(() => portable(source, { view: 'shared' }));
  assert.throws(() => portable(template, { view: 'missing' }));
  assert.throws(() =>
    renderArtifactParentRuntime({
      nonce: createArtifactBridgeNonce(),
      stageRuntimeUrl: '/stage.js',
      inlineSources: { shared: template },
    }),
  );
});

test('live room browser validation hashes pooled sources once and agrees with the canonical Node digest', async () => {
  const envelope = board(),
    html = new Set(envelope.sources.map((source) => source.html));
  let sourceHashCalls = 0;
  const subtle = new Proxy(webcrypto.subtle, {
    get(target, key) {
      if (key === 'digest')
        return async (algorithm, bytes) => {
          if (html.has(new TextDecoder().decode(bytes))) sourceHashCalls += 1;
          return target.digest(algorithm, bytes);
        };
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const crypto = {
    subtle,
    getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
    randomUUID: webcrypto.randomUUID.bind(webcrypto),
  };
  const prepared = await prepareLiveReviewRoom(envelope, { crypto, protocolVersion: '2.0.0' });
  assert.equal(prepared.reviewOf, digestArtifactEnvelope(envelope));
  assert.equal(sourceHashCalls, 93);
  for (const mutate of [
    (value) => {
      value.artifacts[0].sourceId = 'missing';
    },
    (value) => {
      value.sources[0].html = 'changed';
    },
    (value) => {
      value.sources.push({ ...value.sources[0], id: 'orphan' });
    },
  ]) {
    const invalid = board(1, 1);
    mutate(invalid);
    await assert.rejects(() => prepareLiveReviewRoom(invalid));
  }
});

test('the additive Design bundle contract supports pooled references and freezes published schemas', () => {
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        new URL('../../protocol/schemas/v1.16.0/design-review-bundle.schema.json', import.meta.url),
      ),
    ),
    DESIGN_REVIEW_BUNDLE_V12_SCHEMA,
  );
  const envelope = board();
  const reviewContext = {
    kind: 'openplanr-design-review-context',
    schemaVersion: '1.0.0',
    designId: 'design',
    brief: { purpose: '', requests: [] },
    implementation: { tokens: [], components: [], responsive: [], accessibility: [] },
  };
  const bundle = {
    kind: 'openplanr-design-review-bundle',
    schemaVersion: '1.2.0',
    design: {
      id: 'design',
      title: 'Board',
      frames: [{ id: 'desktop', label: 'Desktop', width: 1440, height: 900 }],
      screens: [{ id: 'screen', title: 'Screen' }],
      screenOrder: ['screen'],
      variants: [{ id: 'main', label: 'Main', status: 'ready' }],
      selectedVariant: 'main',
      defaultView: 'canvas',
    },
    envelope,
    entries: envelope.artifacts.map((artifact) => ({
      artifactId: artifact.id,
      screenId: 'screen',
      variantId: 'main',
      frameId: artifact.id,
    })),
    revision: 'revision',
    reviewContext,
    contextDigest: sha256Hex(canonicalizeJson(reviewContext)),
    fingerprints: [],
  };
  assert.equal(assertDesignReviewBundle(bundle), bundle);
  assert.deepEqual(
    validateProtocolArtifact('design-review-bundle', bundle, { protocolVersion: '1.16.0' }),
    [],
  );
  assert.throws(() => assertDesignReviewBundle({ ...bundle, schemaVersion: '1.1.0' }));
  const invalid = structuredClone(bundle);
  invalid.contextDigest = '0'.repeat(64);
  assert.throws(() => assertDesignReviewBundle(invalid));
});
