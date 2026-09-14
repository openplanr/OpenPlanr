import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { createArtifactEnvelope } from '../../lib/artifact/envelope.mjs';
import {
  HOSTED_ARTIFACT_STATE_COPY,
  HOSTED_ARTIFACT_VIEWER_STATES,
  hostedArtifactStateForError,
  parseHostedArtifactLocation,
} from '../../lib/artifact/ui/hosted-viewer.mjs';
import { renderArtifactShellMarkup, normalizeArtifactShellModel } from '../../lib/artifact/ui/renderers.mjs';
import {
  ARTIFACT_SHARE_FRAGMENT_LIMIT,
  ARTIFACT_SHARE_TTLS,
  artifactShareExpiry,
  createArtifactShareDialogState,
  establishArtifactOwnerCustody,
  normalizeArtifactSharePreview,
  reduceArtifactShareDialog,
} from '../../lib/artifact/ui/share-dialog.mjs';
import { renderArtifactShellDocument } from '../../lib/artifact/ui/shell.mjs';
import { renderArtifactStageRuntimeAsset } from '../../scripts/generate-artifact-shell.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const snapshotDir = join(root, 'tests/artifact/__snapshots__');
const runBrowser = process.env.PLANR_BROWSER_TESTS === '1'
  || process.env.npm_lifecycle_event === 'test:artifact:browser';
const updateSnapshots = process.env.PLANR_UPDATE_SNAPSHOTS === '1';

function fixtureArtifact() {
  return {
    id: 'checkout',
    kind: 'html',
    title: 'Checkout confidence pass',
    colorScheme: 'light',
    viewport: { width: 1440, height: 900 },
    html: `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;min-height:900px;display:grid;place-items:center;background:#f8fafc;color:#171722;font-family:system-ui,sans-serif}main{width:720px;padding:52px;border:1px solid #dfe3ea;border-radius:24px;background:#fff;box-shadow:0 24px 80px #0002}small{font:12px ui-monospace,monospace;letter-spacing:.08em}h1{font-size:48px;line-height:1.05;margin:18px 0}p{font-size:18px;color:#65657d}
</style></head><body><main><small>NORTHLINE / PRIVATE REVIEW</small><h1>Finish your order</h1><p>The artifact remains isolated while the review chrome explains exactly where shared bytes live.</p></main></body></html>`,
  };
}

function fixtureEnvelope() {
  return createArtifactEnvelope({ artifacts: [fixtureArtifact()] });
}

function fixtureOwnerCustody(overrides = {}) {
  const keyId = `sha256:${'a'.repeat(64)}`;
  const publicKey = 'A'.repeat(120);
  const signer = {
    role: 'owner',
    algorithm: 'ECDSA-P256-SHA256',
    encoding: 'spki-base64url',
    keyId,
    value: publicKey,
  };
  Object.defineProperty(signer, 'sign', { enumerable: false, value: async () => 'signature' });
  return {
    signer,
    secret: {
      schemaVersion: '1.0.0',
      kind: 'openplanr-live-room-signer',
      role: 'owner',
      algorithm: 'ECDSA-P256-SHA256',
      keyId,
      publicKey,
      privateKey: 'B'.repeat(160),
    },
    ...overrides,
  };
}

test('live rooms are the default while snapshot selection still enforces the fragment boundary', () => {
  const atLimit = normalizeArtifactSharePreview({
    fragmentLength: ARTIFACT_SHARE_FRAGMENT_LIMIT,
    compressedBytes: 5_900,
    ciphertextBytes: 5_928,
  });
  assert.equal(atLimit.fragmentEligible, true);
  let state = createArtifactShareDialogState({ preview: atLimit });
  assert.equal(state.transport, 'live');
  state = reduceArtifactShareDialog(state, { type: 'select-transport', transport: 'fragment' });
  assert.equal(state.transport, 'fragment');

  const overLimit = normalizeArtifactSharePreview({
    fragmentLength: ARTIFACT_SHARE_FRAGMENT_LIMIT + 1,
    compressedBytes: 5_901,
    ciphertextBytes: 5_929,
  });
  state = reduceArtifactShareDialog(state, { type: 'preview-ready', preview: overLimit });
  assert.equal(state.transport, 'short');
  assert.equal(state.preview.fragmentEligible, false);
  assert.equal(
    reduceArtifactShareDialog(state, { type: 'select-transport', transport: 'fragment' }),
    state,
    'an oversized final fragment cannot be manually selected',
  );
});

test('manual short selection, TTL, and deletion-token result remain explicit immutable state', () => {
  let state = createArtifactShareDialogState({
    preview: { fragmentLength: 4_000, compressedBytes: 2_900, ciphertextBytes: 2_928 },
  });
  state = reduceArtifactShareDialog(state, { type: 'select-transport', transport: 'short' });
  state = reduceArtifactShareDialog(state, { type: 'set-ttl', ttl: '30d' });
  state = reduceArtifactShareDialog(state, { type: 'create-start' });
  state = reduceArtifactShareDialog(state, {
    type: 'create-success',
    result: {
      transport: 'short',
      url: 'https://share.openplanr.dev/p/paste-1#k=private-key',
      deletionToken: 'delete-once',
      expiresAt: '2026-08-13T12:00:00.000Z',
    },
  });
  assert.equal(state.phase, 'created');
  assert.equal(state.ttl, '30d');
  assert.equal(state.result.deletionToken, 'delete-once');
  assert.doesNotMatch(state.result.url, /delete-once/);
  assert.equal(Object.isFrozen(state.result), true);
  assert.equal(
    artifactShareExpiry('1d', '2026-07-14T12:00:00.000Z'),
    '2026-07-15T12:00:00.000Z',
  );
  assert.deepEqual(Object.keys(ARTIFACT_SHARE_TTLS), ['1d', '7d', '30d']);
  assert.equal(
    reduceArtifactShareDialog(state, {
      type: 'create-success',
      result: { transport: 'unknown', url: 'https://share.openplanr.dev/#v1.abc' },
    }),
    state,
    'a terminal receipt cannot be replaced by another create result',
  );
  assert.equal(
    reduceArtifactShareDialog(state, {
      type: 'create-success',
      result: {
        transport: 'short',
        url: 'https://share.openplanr.dev/p/id#k=key&delete=leaked-token',
        deletionToken: 'leaked-token',
      },
    }),
    state,
    'a terminal receipt cannot be erased by a divergent result',
  );
});

test('live result state preserves three disjoint room capabilities without exposing an owner signer', () => {
  const roomId = 'room_123456789012';
  const key = 'K'.repeat(43);
  const review = 'R'.repeat(43);
  const owner = 'O'.repeat(43);
  const manage = 'M'.repeat(43);
  let state = createArtifactShareDialogState({
    preview: { fragmentLength: 4_000, compressedBytes: 2_900, ciphertextBytes: 2_928 },
  });
  state = reduceArtifactShareDialog(state, { type: 'custody-start' });
  assert.equal(state.phase, 'custody-preparing');
  state = reduceArtifactShareDialog(state, { type: 'custody-ready' });
  assert.equal(state.ownerCustodyEstablished, true);
  state = reduceArtifactShareDialog(state, {
    type: 'create-success',
    result: {
      transport: 'live',
      url: `https://share.openplanr.dev/r/${roomId}#k=${key}&w=${review}`,
      ownerUrl: `https://share.openplanr.dev/r/${roomId}#k=${key}&o=${owner}`,
      manageUrl: `https://share.openplanr.dev/r/${roomId}#k=${key}&m=${manage}`,
      ownerSigner: fixtureOwnerCustody().signer,
    },
  });
  assert.equal(state.phase, 'created');
  assert.equal(state.result.ownerUrl.includes(`o=${owner}`), true);
  assert.equal(state.result.manageUrl.includes(`m=${manage}`), true);
  assert.equal(Object.hasOwn(state.result, 'ownerSigner'), false);
  assert.doesNotMatch(JSON.stringify(state), /privateKey|signature/);

  assert.equal(
    reduceArtifactShareDialog(state, {
      type: 'create-success',
      result: {
        transport: 'live',
        url: `https://share.openplanr.dev/r/${roomId}#k=${key}&w=${review}`,
        ownerUrl: `https://share.openplanr.dev/r/${roomId}#k=${key}&o=${owner}`,
        manageUrl: `https://share.openplanr.dev/r/${roomId}#k=${key}&m=${owner}`,
      },
    }),
    state,
    'owner and management authorities cannot replace a terminal receipt',
  );
  assert.equal(reduceArtifactShareDialog(state, { type: 'set-ttl', ttl: '30d' }), state);
  assert.equal(reduceArtifactShareDialog(state, { type: 'select-transport', transport: 'short' }), state);
  assert.equal(reduceArtifactShareDialog(state, { type: 'create-start' }), state);
});

test('owner custody validates and completes its explicit local handoff before returning the private signer', async () => {
  const custody = fixtureOwnerCustody();
  const calls = [];
  const signer = await establishArtifactOwnerCustody({
    prepareOwnerCustody: async () => custody,
    saveOwnerCustody: async (value) => {
      calls.push(value);
      return { saved: true };
    },
  });
  assert.equal(signer, custody.signer);
  assert.equal(calls.length, 1);
  assert.match(calls[0].filename, /^openplanr-live-room-owner-[a-f0-9]{12}\.json$/);
  assert.deepEqual(JSON.parse(calls[0].serialized), custody.secret);

  await assert.rejects(
    establishArtifactOwnerCustody({
      prepareOwnerCustody: async () => custody,
      saveOwnerCustody: async () => false,
    }),
    (error) => error.code === 'E_ARTIFACT_SHARE_OWNER_CUSTODY_UNAVAILABLE',
  );
  await assert.rejects(
    establishArtifactOwnerCustody({
      prepareOwnerCustody: async () => fixtureOwnerCustody({
        secret: { ...custody.secret, keyId: `sha256:${'b'.repeat(64)}` },
      }),
      saveOwnerCustody: async () => true,
    }),
    (error) => error.code === 'E_ARTIFACT_SHARE_OWNER_CUSTODY_INVALID',
  );
  await assert.rejects(
    establishArtifactOwnerCustody({
      prepareOwnerCustody: async () => fixtureOwnerCustody({
        secret: { ...custody.secret, privateKey: 'A'.repeat(65 * 1024) },
      }),
      saveOwnerCustody: async () => true,
    }),
    (error) => error.code === 'E_ARTIFACT_SHARE_OWNER_CUSTODY_INVALID',
  );
});

test('full retry-safe recovery custody is downloaded before its opaque preparation is returned', async () => {
  const { signer, secret } = fixtureOwnerCustody();
  const roomId = 'room_123456789012';
  const key = 'K'.repeat(43);
  const prepared = {
    schemaVersion: '1.0.0',
    kind: 'openplanr-live-room-preparation',
    protocolVersion: '2.0.0',
    id: roomId,
    roomId,
    reviewOf: 'a'.repeat(64),
    ttl: '7d',
    ownerKey: {
      algorithm: signer.algorithm,
      encoding: signer.encoding,
      keyId: signer.keyId,
      value: signer.value,
    },
  };
  Object.defineProperties(prepared, {
    url: { enumerable: false, value: `https://share.openplanr.dev/r/${roomId}#k=${key}&w=${'R'.repeat(43)}` },
    ownerUrl: { enumerable: false, value: `https://share.openplanr.dev/r/${roomId}#k=${key}&o=${'O'.repeat(43)}` },
    manageUrl: { enumerable: false, value: `https://share.openplanr.dev/r/${roomId}#k=${key}&m=${'M'.repeat(43)}` },
    ownerSigner: { enumerable: false, value: signer },
  });
  Object.freeze(prepared);
  const recovery = {
    schemaVersion: '1.0.0',
    kind: 'openplanr-live-room-recovery',
    protocolVersion: '2.0.0',
    id: roomId,
    roomId,
    reviewOf: prepared.reviewOf,
    ttl: prepared.ttl,
    ownerKey: prepared.ownerKey,
    url: prepared.url,
    ownerUrl: prepared.ownerUrl,
    manageUrl: prepared.manageUrl,
    ownerSigner: secret,
  };
  const saved = [];
  const credential = await establishArtifactOwnerCustody({
    prepareOwnerCustody: async () => ({ prepared, recovery }),
    saveOwnerCustody: async (value) => { saved.push(value); return true; },
  });
  assert.equal(credential, prepared);
  assert.match(saved[0].filename, /^openplanr-live-room-recovery-room_1234567\.json$/);
  assert.deepEqual(JSON.parse(saved[0].serialized), recovery);
  assert.equal(JSON.stringify(prepared).includes(secret.privateKey), false);
  await assert.rejects(
    () => establishArtifactOwnerCustody({
      prepareOwnerCustody: async () => ({
        prepared,
        recovery: { ...recovery, manageUrl: recovery.ownerUrl },
      }),
      saveOwnerCustody: async () => true,
    }),
    { code: 'E_ARTIFACT_SHARE_OWNER_CUSTODY_INVALID' },
  );
});

test('custody-bound and ambiguous phases freeze configuration until exact retry reaches a terminal receipt', () => {
  let state = createArtifactShareDialogState({
    preview: { fragmentLength: 4_000, compressedBytes: 2_900, ciphertextBytes: 2_928 },
  });
  state = reduceArtifactShareDialog(state, { type: 'custody-start' });
  state = reduceArtifactShareDialog(state, { type: 'custody-ready' });
  const custodyReady = state;
  assert.equal(reduceArtifactShareDialog(state, { type: 'set-ttl', ttl: '30d' }), state);
  assert.equal(reduceArtifactShareDialog(state, { type: 'select-transport', transport: 'short' }), state);
  state = reduceArtifactShareDialog(state, { type: 'create-start' });
  state = reduceArtifactShareDialog(state, {
    type: 'failure',
    ambiguous: true,
    ownerCustodyEstablished: true,
    error: 'response lost',
  });
  assert.equal(state.phase, 'ambiguous');
  assert.equal(state.ttl, custodyReady.ttl);
  assert.equal(reduceArtifactShareDialog(state, { type: 'close' }), state);
  assert.equal(reduceArtifactShareDialog(state, { type: 'set-ttl', ttl: '30d' }), state);
  state = reduceArtifactShareDialog(state, { type: 'create-start' });
  assert.equal(state.phase, 'creating');
});

test('privacy receipt copy distinguishes encoded fragments from encrypted storage', () => {
  const markup = renderArtifactShellMarkup(normalizeArtifactShellModel({
    envelope: fixtureEnvelope(),
    shell: { status: 'ready' },
  }));
  const fragmentRow = markup.match(/<button[^>]+data-planr-share-transport="fragment"[\s\S]*?<\/button>/)?.[0];
  const shortRow = markup.match(/<button[^>]+data-planr-share-transport="short"[\s\S]*?<\/button>/)?.[0];
  assert.ok(fragmentRow);
  assert.match(fragmentRow, /Compressed into the URL\. Nothing is uploaded\./);
  assert.doesNotMatch(fragmentRow, /encrypt/i);
  assert.ok(shortRow);
  assert.match(shortRow, /AES-256-GCM ciphertext is stored until expiry; the key stays in this link fragment\./);
  assert.doesNotMatch(shortRow, /nothing is uploaded/i);
  assert.match(markup, /Store this token now; it cannot be recovered\. It is separate from the review URL\./);
  assert.match(markup, /Download the private owner key first\./);
  assert.match(markup, /Private owner-verdict URL/);
  assert.match(markup, /Use this URL with the matching downloaded owner key to approve or request changes\./);
  assert.match(markup, /Management cannot set a verdict\./);
  assert.doesNotMatch(markup, /management URL[^.]*set (?:the )?(?:final )?(?:decision|verdict)/i);
});

test('hosted presentation parser covers empty, version, shape, threshold, fragment, and short URLs', () => {
  assert.equal(parseHostedArtifactLocation('https://share.openplanr.dev/').status, 'empty-hash');
  assert.equal(parseHostedArtifactLocation('https://share.openplanr.dev/#v2.abc').status, 'invalid-version');
  assert.equal(parseHostedArtifactLocation('https://share.openplanr.dev/#v1.').status, 'malformed-payload');
  assert.equal(parseHostedArtifactLocation('https://share.openplanr.dev/#v1.a%20b').status, 'malformed-payload');
  assert.equal(
    parseHostedArtifactLocation(`https://share.openplanr.dev/#v1.${'a'.repeat(7_997)}`).ok,
    true,
    'the final v1 fragment is exactly 8,000 characters',
  );
  assert.deepEqual(
    parseHostedArtifactLocation(`https://share.openplanr.dev/r/room_123456789012#k=${'A'.repeat(43)}&w=${'B'.repeat(43)}`),
    { ok: true, transport: 'room', id: 'room_123456789012', key: 'A'.repeat(43), write: 'B'.repeat(43) },
  );
  assert.deepEqual(
    parseHostedArtifactLocation(`https://share.openplanr.dev/r/room_123456789012#k=${'A'.repeat(43)}&o=${'C'.repeat(43)}`),
    { ok: true, transport: 'room', id: 'room_123456789012', key: 'A'.repeat(43), owner: 'C'.repeat(43) },
  );
  assert.equal(
    parseHostedArtifactLocation(`https://share.openplanr.dev/r/room_123456789012#k=${'A'.repeat(43)}&w=${'B'.repeat(43)}&o=${'C'.repeat(43)}`).status,
    'malformed-payload',
  );
  assert.equal(
    parseHostedArtifactLocation(`https://share.openplanr.dev/#v1.${'a'.repeat(7_998)}`).status,
    'too-large',
  );
  assert.deepEqual(
    parseHostedArtifactLocation('https://share.openplanr.dev/#v1.abc_DEF-123'),
    { ok: true, transport: 'fragment', version: 'v1', payload: 'abc_DEF-123' },
  );
  assert.deepEqual(
    parseHostedArtifactLocation(`https://share.openplanr.dev/p/paste_123#k=${'k'.repeat(43)}`),
    { ok: true, transport: 'short', id: 'paste_123', key: 'k'.repeat(43) },
  );
  assert.equal(parseHostedArtifactLocation('https://share.openplanr.dev/p/paste_123').status, 'malformed-payload');
  assert.equal(parseHostedArtifactLocation('https://share.openplanr.dev/p/paste_123#k=bad%20key').status, 'malformed-payload');
});

test('hosted errors map to every safe actionable state and only network errors retry', () => {
  const cases = {
    E_ARTIFACT_FRAGMENT_VERSION_UNSUPPORTED: 'invalid-version',
    E_ARTIFACT_DECOMPRESSION_LIMIT: 'too-large',
    E_ARTIFACT_PASTE_INVALID: 'malformed-payload',
    E_ARTIFACT_PASTE_UNAVAILABLE: 'paste-missing',
    E_ARTIFACT_PASTE_EXPIRED: 'expired',
    E_ARTIFACT_DECRYPTION_FAILED: 'decryption-failed',
    E_ARTIFACT_BROWSER_UNSUPPORTED: 'unsupported-browser',
    E_ARTIFACT_SHARE_NETWORK: 'network-error',
  };
  for (const [code, expected] of Object.entries(cases)) {
    assert.equal(hostedArtifactStateForError(Object.assign(new Error(code), { code })), expected);
  }
  const visibleStates = HOSTED_ARTIFACT_VIEWER_STATES.filter((state) => !['idle', 'ready'].includes(state));
  for (const state of visibleStates) {
    assert.ok(HOSTED_ARTIFACT_STATE_COPY[state], `${state} has hosted copy`);
    assert.equal(Boolean(HOSTED_ARTIFACT_STATE_COPY[state].action), state === 'network-error');
  }
});

async function serve(document, runtime, artifact) {
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/artifact-review-stage.js') {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.end(runtime);
      return;
    }
    if (request.url === '/artifact/checkout') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(artifact.html);
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(document);
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolveClose, reject) => server.close((error) => (
      error ? reject(error) : resolveClose()
    ))),
  };
}

async function compareSnapshot(name, actual, { PNG, pixelmatch }) {
  const path = join(snapshotDir, `${name}.png`);
  if (updateSnapshots) {
    mkdirSync(snapshotDir, { recursive: true });
    writeFileSync(path, actual);
    return;
  }
  const expected = readFileSync(path);
  const actualPng = PNG.sync.read(actual);
  const expectedPng = PNG.sync.read(expected);
  assert.equal(actualPng.width, expectedPng.width, `${name} width`);
  assert.equal(actualPng.height, expectedPng.height, `${name} height`);
  const changed = pixelmatch(
    expectedPng.data,
    actualPng.data,
    null,
    actualPng.width,
    actualPng.height,
    { includeAA: false, threshold: 0.12 },
  );
  const ratio = changed / (actualPng.width * actualPng.height);
  assert.ok(ratio <= 0.02, `${name} visual delta ${(ratio * 100).toFixed(3)}% exceeds 2%`);
}

test('real browser share receipt is explicit, focus-safe, upload-safe, and visually approved', {
  skip: !runBrowser,
  timeout: 60_000,
}, async (t) => {
  const [{ chromium }, pngModule, pixelmatchModule] = await Promise.all([
    import('playwright'),
    import('pngjs'),
    import('pixelmatch'),
  ]);
  const PNG = pngModule.PNG ?? pngModule.default?.PNG;
  const pixelmatch = pixelmatchModule.default ?? pixelmatchModule;
  const envelope = fixtureEnvelope();
  const artifact = envelope.artifacts[0];
  const document = renderArtifactShellDocument({
    envelope,
    viewer: { mode: 'single', activeArtifactId: artifact.id, presentation: 'canvas' },
    shell: { title: 'Checkout confidence pass', theme: 'light', privacy: 'local', status: 'ready' },
  });
  const host = await serve(document, renderArtifactStageRuntimeAsset(), artifact);
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await host.close();
  });

  const context = await browser.newContext({
    colorScheme: 'light',
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(({ artifactUrl }) => {
    globalThis.__planrSharePreview = { fragmentLength: 8_000, compressedBytes: 5_914, ciphertextBytes: 5_942 };
    globalThis.__planrCreateCalls = [];
    globalThis.__planrCopies = [];
    globalThis.__planrCustodyExports = [];
    globalThis.__planrAttemptMatches = [];
    globalThis.__planrCustodySaveMode = 'ok';
    globalThis.__planrLiveCreateMode = 'ok';
    globalThis.__planrCopyMode = 'ok';
    globalThis.__planrHostedLocation = { pathname: '/', hash: '' };
    globalThis.__planrHostedMode = 'ready';
    globalThis.__OPENPLANR_ARTIFACT_STAGE_OPTIONS__ = {
      async resolveArtifactSource() {
        const response = await fetch(artifactUrl, { cache: 'no-store' });
        return response.blob();
      },
      share: {
        async prepareShare() {
          return { ...globalThis.__planrSharePreview };
        },
        async prepareOwnerCustody({ ttl }) {
          const keyId = `sha256:${'a'.repeat(64)}`;
          const publicKey = 'A'.repeat(120);
          const signer = {
            role: 'owner',
            algorithm: 'ECDSA-P256-SHA256',
            encoding: 'spki-base64url',
            keyId,
            value: publicKey,
          };
          Object.defineProperty(signer, 'sign', { enumerable: false, value: async () => 'signature' });
          const roomId = 'room_123456789012';
          const key = 'K'.repeat(43);
          const prepared = {
            schemaVersion: '1.0.0',
            kind: 'openplanr-live-room-preparation',
            protocolVersion: '2.0.0',
            id: roomId,
            roomId,
            reviewOf: 'a'.repeat(64),
            ttl,
            ownerKey: { algorithm: signer.algorithm, encoding: signer.encoding, keyId, value: publicKey },
          };
          Object.defineProperties(prepared, {
            url: { enumerable: false, value: `https://share.openplanr.dev/r/${roomId}#k=${key}&w=${'R'.repeat(43)}` },
            ownerUrl: { enumerable: false, value: `https://share.openplanr.dev/r/${roomId}#k=${key}&o=${'O'.repeat(43)}` },
            manageUrl: { enumerable: false, value: `https://share.openplanr.dev/r/${roomId}#k=${key}&m=${'M'.repeat(43)}` },
            ownerSigner: { enumerable: false, value: signer },
          });
          Object.freeze(prepared);
          globalThis.__planrPreparedAttempt = prepared;
          return { prepared, recovery: {
            schemaVersion: '1.0.0',
            kind: 'openplanr-live-room-recovery',
            protocolVersion: '2.0.0',
            id: roomId,
            roomId,
            reviewOf: prepared.reviewOf,
            ttl,
            ownerKey: prepared.ownerKey,
            url: prepared.url,
            ownerUrl: prepared.ownerUrl,
            manageUrl: prepared.manageUrl,
            ownerSigner: {
              schemaVersion: '1.0.0',
              kind: 'openplanr-live-room-signer',
              role: 'owner',
              algorithm: 'ECDSA-P256-SHA256',
              keyId,
              publicKey,
              privateKey: 'B'.repeat(160),
            },
          } };
        },
        async saveOwnerCustody(value) {
          if (globalThis.__planrCustodySaveMode === 'fail') {
            throw new Error('Owner key download was refused.');
          }
          globalThis.__planrCustodyExports.push(structuredClone(value));
          return true;
        },
        async createShare(input) {
          globalThis.__planrCreateCalls.push(structuredClone(input));
          if (input.transport === 'live') {
            globalThis.__planrAttemptMatches.push(input.prepared === globalThis.__planrPreparedAttempt);
            if (globalThis.__planrLiveCreateMode === 'fail') {
              throw Object.assign(new Error('Live room creation outcome is unknown.'), {
                details: { effect: 'ambiguous' },
              });
            }
            if (globalThis.__planrLiveCreateMode === 'delay') {
              await new Promise((resolveDelay) => {
                globalThis.__planrResolveLiveCreate = resolveDelay;
              });
            }
            const roomId = 'room_123456789012';
            const key = 'K'.repeat(43);
            const result = {
              url: `https://share.openplanr.dev/r/${roomId}#k=${key}&w=${'R'.repeat(43)}`,
              ownerUrl: `https://share.openplanr.dev/r/${roomId}#k=${key}&o=${'O'.repeat(43)}`,
              manageUrl: `https://share.openplanr.dev/r/${roomId}#k=${key}&m=${'M'.repeat(43)}`,
              expiresAt: '2026-07-21T12:00:00.000Z',
            };
            Object.defineProperty(result, 'ownerSigner', {
              enumerable: false,
              value: input.prepared?.ownerSigner ?? input.ownerSigner,
            });
            return result;
          }
          if (input.transport === 'short') {
            return {
              url: `https://share.openplanr.dev/p/paste-123#k=${'k'.repeat(43)}`,
              deletionToken: 'delete-once-789',
              expiresAt: '2026-08-13T12:00:00.000Z',
            };
          }
          return { url: `https://share.openplanr.dev/#v1.${'a'.repeat(7_997)}` };
        },
        async copyText(value) {
          if (globalThis.__planrCopyMode === 'fail') throw new Error('Clipboard unavailable.');
          globalThis.__planrCopies.push(value);
        },
        now: () => new Date('2026-07-14T12:00:00.000Z'),
      },
      hosted: {
        enabled: true,
        location: globalThis.__planrHostedLocation,
        supportsTransport() {
          return globalThis.__planrHostedMode !== 'unsupported';
        },
        async decodeFragment() {
          if (globalThis.__planrHostedMode === 'loading') {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          if (globalThis.__planrHostedMode === 'network') {
            throw Object.assign(new Error('network'), { code: 'E_ARTIFACT_SHARE_NETWORK' });
          }
          return { schemaVersion: '1.0.0', artifacts: [] };
        },
        async loadShort() {
          const code = {
            expired: 'E_ARTIFACT_PASTE_EXPIRED',
            missing: 'E_ARTIFACT_PASTE_UNAVAILABLE',
            wrong: 'E_ARTIFACT_DECRYPTION_FAILED',
            network: 'E_ARTIFACT_SHARE_NETWORK',
          }[globalThis.__planrHostedMode];
          if (code) throw Object.assign(new Error(code), { code });
          return { schemaVersion: '1.0.0', artifacts: [] };
        },
        onEnvelope(envelopeValue) {
          globalThis.__planrHostedEnvelope = envelopeValue;
        },
      },
    };
  }, { artifactUrl: `${host.url}artifact/checkout` });
  const page = await context.newPage();
  await page.goto(host.url);
  await page.waitForFunction(() => globalThis.__openPlanrArtifactStage?.getState().status === 'ready');
  assert.equal(await page.evaluate(() => globalThis.__openPlanrHostedArtifactViewer.getState().status), 'empty-hash');

  const shareTrigger = page.locator('[data-planr-action="share"]');
  await shareTrigger.focus();
  await shareTrigger.click();
  await page.waitForFunction(() => globalThis.__openPlanrArtifactShare.getState().phase === 'ready');
  const fragment = page.locator('[data-planr-share-transport="fragment"]');
  const live = page.locator('[data-planr-share-transport="live"]');
  const short = page.locator('[data-planr-share-transport="short"]');
  assert.equal(await fragment.isEnabled(), true);
  assert.equal(await live.getAttribute('aria-pressed'), 'true');
  await fragment.click();
  assert.equal(await fragment.getAttribute('aria-pressed'), 'true');
  assert.match(await fragment.textContent(), /8,000 chars/);
  assert.doesNotMatch(await fragment.textContent(), /encrypt/i);
  assert.doesNotMatch(await short.textContent(), /nothing is uploaded/i);

  const close = page.locator('[data-planr-share-close]');
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(
    await page.locator('[data-planr-share-confirm]').evaluate((element) => document.activeElement === element),
    true,
    'focus wraps backward inside the dialog',
  );
  assert.equal(await page.locator('.planr-share-dialog').getAttribute('data-planr-share-selected'), 'fragment');
  await page.keyboard.press('Escape');
  assert.equal(await shareTrigger.evaluate((element) => document.activeElement === element), true);
  assert.equal(await page.evaluate(() => globalThis.__planrCreateCalls.length), 0);

  await page.locator('[data-planr-action="theme"]').click();
  assert.equal(await page.locator('html').getAttribute('data-planr-theme'), 'dark');
  await page.evaluate(() => {
    globalThis.__planrSharePreview = { fragmentLength: 8_001, compressedBytes: 5_915, ciphertextBytes: 5_943 };
  });
  await shareTrigger.click();
  await page.waitForFunction(() => globalThis.__openPlanrArtifactShare.getState().phase === 'ready');
  assert.equal(await fragment.isDisabled(), true);
  assert.equal(await short.getAttribute('aria-pressed'), 'true');
  await page.locator('[data-planr-share-ttl]').selectOption('30d');
  assert.match(await page.locator('[data-planr-share-ttl-row]').textContent(), /Aug 13, 2026/);
  assert.equal(await page.locator('[data-planr-share-ttl-row]').isVisible(), true);
  await page.locator('[data-planr-share-cancel]').click();
  assert.equal(await page.evaluate(() => globalThis.__planrCreateCalls.length), 0, 'cancel performs no upload');

  await page.evaluate(() => {
    globalThis.__planrSharePreview = { fragmentLength: 4_000, compressedBytes: 2_914, ciphertextBytes: 2_942 };
  });
  await shareTrigger.click();
  await page.waitForFunction(() => globalThis.__openPlanrArtifactShare.getState().phase === 'ready');
  await short.click();
  await page.locator('[data-planr-share-ttl]').selectOption('1d');
  await page.locator('[data-planr-share-confirm]').click();
  await page.waitForFunction(() => globalThis.__openPlanrArtifactShare.getState().phase === 'created');
  const created = await page.evaluate(() => globalThis.__planrCreateCalls.at(-1));
  assert.equal(created.transport, 'short');
  assert.equal(created.ttl, '1d');
  assert.equal(created.confirmed, true);
  assert.equal(await page.locator('[data-planr-share-deletion]').isVisible(), true);
  assert.equal(await page.locator('[data-planr-share-deletion-token]').textContent(), 'delete-once-789');
  assert.doesNotMatch(await page.locator('[data-planr-share-url]').inputValue(), /delete-once-789/);
  assert.equal(
    await page.evaluate(() => globalThis.__planrCopies.at(-1)),
    `https://share.openplanr.dev/p/paste-123#k=${'k'.repeat(43)}`,
  );
  await page.locator('[data-planr-share-copy-url]').click();
  assert.equal(await page.locator('[data-planr-share-copy-url]').getAttribute('data-planr-copy-state'), 'copied');
  assert.equal(await page.locator('[data-planr-share-copy-url]').textContent(), 'Copied');
  await page.locator('[data-planr-share-copy-deletion]').click();
  await page.waitForFunction(() => globalThis.__planrCopies.at(-1) === 'delete-once-789');
  await page.locator('[data-planr-share-close]').click();

  const callsBeforeLive = await page.evaluate(() => globalThis.__planrCreateCalls.length);
  await page.evaluate(() => { globalThis.__planrCustodySaveMode = 'fail'; });
  await shareTrigger.click();
  await page.waitForFunction(() => globalThis.__openPlanrArtifactShare.getState().phase === 'ready');
  await live.click();
  assert.equal(await page.locator('[data-planr-share-confirm]').textContent(), 'Download recovery bundle');
  await page.locator('[data-planr-share-confirm]').click();
  await page.waitForFunction(() => globalThis.__openPlanrArtifactShare.getState().phase === 'error');
  assert.equal(await page.evaluate(() => globalThis.__planrCreateCalls.length), callsBeforeLive);
  assert.match(await page.locator('[data-planr-share-error]').textContent(), /download was refused/i);
  await page.locator('[data-planr-share-close]').click();

  await page.evaluate(() => { globalThis.__planrCustodySaveMode = 'ok'; });
  await shareTrigger.click();
  await page.waitForFunction(() => globalThis.__openPlanrArtifactShare.getState().phase === 'ready');
  await page.locator('[data-planr-share-confirm]').click();
  await page.waitForFunction(() => globalThis.__openPlanrArtifactShare.getState().phase === 'custody-ready');
  assert.equal(await page.evaluate(() => globalThis.__planrCreateCalls.length), callsBeforeLive);
  assert.equal(await page.evaluate(() => globalThis.__planrCustodyExports.length), 1);
  assert.equal(
    await page.evaluate(() => JSON.parse(globalThis.__planrCustodyExports[0].serialized).kind),
    'openplanr-live-room-recovery',
  );
  assert.equal(await page.locator('[data-planr-share-ttl]').isDisabled(), true);
  assert.equal(await page.locator('[data-planr-share-transport="short"]').isDisabled(), true);
  assert.doesNotMatch(
    await page.evaluate(() => JSON.stringify(globalThis.__openPlanrArtifactShare.getState())),
    /privateKey|BBBBBBBB/,
  );
  assert.match(await page.locator('[data-planr-share-owner-custody-status]').textContent(), /no room exists/i);
  assert.equal(await page.locator('[data-planr-share-confirm]').textContent(), 'I saved it — create live room');
  await page.evaluate(() => { globalThis.__planrLiveCreateMode = 'fail'; });
  await page.locator('[data-planr-share-confirm]').click();
  await page.waitForFunction(() => globalThis.__openPlanrArtifactShare.getState().phase === 'ambiguous');
  assert.equal(await page.locator('[data-planr-share-result]').isHidden(), true);
  assert.equal(await page.evaluate(() => globalThis.__openPlanrArtifactShare.getState().ownerCustodyEstablished), true);
  assert.equal(await page.evaluate(() => globalThis.__planrCustodyExports.length), 1);
  assert.equal(await page.locator('[data-planr-share-confirm]').textContent(), 'Retry exact room creation');
  assert.equal(await page.locator('[data-planr-share-close]').isDisabled(), true);
  assert.equal(await page.locator('[data-planr-share-cancel]').isDisabled(), true);
  await page.evaluate(() => globalThis.__openPlanrArtifactShare.close());
  assert.equal(await page.evaluate(() => globalThis.__openPlanrArtifactShare.getState().phase), 'ambiguous');
  assert.equal(await page.evaluate(() => globalThis.__openPlanrArtifactStage.destroy()), false);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => globalThis.__openPlanrArtifactShare.getState().phase), 'ambiguous');
  await page.evaluate(() => {
    globalThis.__planrLiveCreateMode = 'delay';
    globalThis.__planrCopyMode = 'fail';
  });
  await page.locator('[data-planr-share-confirm]').click();
  await page.waitForFunction(() => globalThis.__openPlanrArtifactShare.getState().phase === 'creating');
  assert.equal(await page.locator('[data-planr-share-close]').isDisabled(), true);
  assert.equal(await page.locator('[data-planr-share-cancel]').isDisabled(), true);
  await page.evaluate(() => globalThis.__openPlanrArtifactShare.close());
  assert.equal(await page.evaluate(() => globalThis.__openPlanrArtifactShare.getState().phase), 'creating');
  assert.equal(
    await page.evaluate(() => globalThis.__openPlanrArtifactStage.destroy()),
    false,
    'outer stage teardown is blocked while a room receipt is in flight',
  );
  assert.equal(await page.evaluate(() => globalThis.__openPlanrArtifactShare.getState().phase), 'creating');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => globalThis.__openPlanrArtifactShare.getState().phase), 'creating');
  assert.match(await page.locator('[data-planr-share-status]').textContent(), /creation is in progress/i);
  await page.evaluate(() => {
    globalThis.__planrLiveCreateMode = 'ok';
    globalThis.__planrResolveLiveCreate();
  });
  await page.waitForFunction(() => globalThis.__openPlanrArtifactShare.getState().phase === 'created');
  assert.equal(await page.evaluate(() => globalThis.__planrCreateCalls.length), callsBeforeLive + 2);
  assert.deepEqual(await page.evaluate(() => globalThis.__planrAttemptMatches), [true, true]);
  assert.equal(await page.locator('[data-planr-share-result]').isVisible(), true, 'clipboard failure keeps the room receipt visible');
  assert.equal(await page.locator('[data-planr-share-owner]').isVisible(), true);
  assert.equal(await page.locator('[data-planr-share-manage]').isVisible(), true);
  assert.match(await page.locator('[data-planr-share-owner-url]').inputValue(), /#k=.*&o=/);
  assert.match(await page.locator('[data-planr-share-manage-url]').inputValue(), /#k=.*&m=/);
  assert.match(await page.locator('[data-planr-share-manage]').textContent(), /cannot set a verdict/i);
  assert.doesNotMatch(
    await page.evaluate(() => JSON.stringify(globalThis.__openPlanrArtifactShare.getState())),
    /privateKey|BBBBBBBB/,
  );
  await page.locator('[data-planr-share-copy-owner]').click();
  await page.waitForFunction(() => document.querySelector('[data-planr-share-copy-owner]')?.dataset.planrCopyState === 'error');
  assert.equal(
    await page.evaluate(() => globalThis.__openPlanrArtifactShare.getState().phase),
    'created',
    'a manual clipboard failure cannot erase owner custody URLs',
  );
  assert.equal(await page.locator('[data-planr-share-result]').isVisible(), true);
  const terminalReceipt = await page.evaluate(() => JSON.stringify(globalThis.__openPlanrArtifactShare.getState().result));
  const terminalCalls = await page.evaluate(() => globalThis.__planrCreateCalls.length);
  assert.equal(await page.locator('[data-planr-share-confirm]').isDisabled(), true);
  assert.equal(await page.locator('[data-planr-share-confirm]').isHidden(), true);
  assert.equal(await page.locator('[data-planr-share-ttl]').isDisabled(), true);
  assert.equal(await page.locator('[data-planr-share-ttl-row]').isHidden(), true);
  assert.equal(await page.locator('[data-planr-share-transport="short"]').isDisabled(), true);
  assert.equal(await page.locator('[data-planr-share-transport="short"]').isHidden(), true);
  await page.evaluate(async () => {
    globalThis.__openPlanrArtifactShare.dispatch({ type: 'set-ttl', ttl: '30d' });
    globalThis.__openPlanrArtifactShare.dispatch({ type: 'select-transport', transport: 'short' });
    await globalThis.__openPlanrArtifactShare.confirm();
  });
  assert.equal(
    await page.evaluate(() => JSON.stringify(globalThis.__openPlanrArtifactShare.getState().result)),
    terminalReceipt,
  );
  assert.equal(await page.evaluate(() => globalThis.__planrCreateCalls.length), terminalCalls);
  await page.evaluate(() => { globalThis.__planrCopyMode = 'ok'; });
  await page.locator('[data-planr-share-copy-owner]').click();
  assert.match(await page.evaluate(() => globalThis.__planrCopies.at(-1)), /&o=/);
  await page.locator('[data-planr-share-copy-manage]').click();
  assert.match(await page.evaluate(() => globalThis.__planrCopies.at(-1)), /&m=/);
  await page.locator('[data-planr-share-close]').click();

  const hostedCases = [
    { pathname: '/', hash: '#v2.abc', expected: 'invalid-version' },
    { pathname: '/', hash: '#v1.', expected: 'malformed-payload' },
    { pathname: '/', hash: `#v1.${'a'.repeat(7_998)}`, expected: 'too-large' },
    { pathname: '/p/paste-123', hash: `#k=${'k'.repeat(43)}`, mode: 'missing', expected: 'paste-missing' },
    { pathname: '/p/paste-123', hash: `#k=${'k'.repeat(43)}`, mode: 'expired', expected: 'expired' },
    { pathname: '/p/paste-123', hash: `#k=${'k'.repeat(43)}`, mode: 'wrong', expected: 'decryption-failed' },
    { pathname: '/', hash: '#v1.abc', mode: 'unsupported', expected: 'unsupported-browser' },
  ];
  for (const value of hostedCases) {
    await page.evaluate(({ pathname, hash, mode }) => {
      globalThis.__planrHostedLocation.pathname = pathname;
      globalThis.__planrHostedLocation.hash = hash;
      globalThis.__planrHostedMode = mode ?? 'ready';
    }, value);
    await page.evaluate(() => globalThis.__openPlanrHostedArtifactViewer.load());
    assert.equal(
      await page.evaluate(() => globalThis.__openPlanrHostedArtifactViewer.getState().status),
      value.expected,
    );
  }
  await page.evaluate(() => {
    globalThis.__planrHostedLocation.pathname = '/p/paste-123';
    globalThis.__planrHostedLocation.hash = `#k=${'k'.repeat(43)}`;
    globalThis.__planrHostedMode = 'wrong';
  });
  await page.evaluate(() => globalThis.__openPlanrHostedArtifactViewer.load());
  assert.equal(
    await page.evaluate(() => globalThis.__openPlanrHostedArtifactViewer.getState().status),
    'decryption-failed',
  );
  await compareSnapshot('artifact-hosted-review-states', await page.screenshot({ animations: 'disabled' }), {
    PNG,
    pixelmatch,
  });

  await page.evaluate(() => {
    globalThis.__planrHostedLocation.pathname = '/';
    globalThis.__planrHostedLocation.hash = '#v1.abc';
    globalThis.__planrHostedMode = 'network';
  });
  await page.evaluate(() => globalThis.__openPlanrHostedArtifactViewer.load());
  assert.equal(await page.locator('[data-planr-hosted-retry]').isVisible(), true);
  await page.evaluate(() => { globalThis.__planrHostedMode = 'ready'; });
  await page.locator('[data-planr-hosted-retry]').click();
  await page.waitForFunction(() => globalThis.__openPlanrHostedArtifactViewer.getState().status === 'ready');
  assert.equal(await page.evaluate(() => globalThis.__planrHostedEnvelope.schemaVersion), '1.0.0');

  await page.setViewportSize({ width: 390, height: 844 });
  await shareTrigger.click();
  await page.waitForFunction(() => globalThis.__openPlanrArtifactShare.getState().phase === 'ready');
  const modalStyle = await page.locator('.planr-share-dialog').evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    maxHeight: getComputedStyle(element).maxHeight,
    transition: getComputedStyle(element).transitionDuration,
  }));
  assert.equal(Math.round(modalStyle.width), 390);
  assert.equal(modalStyle.transition, '0s');
  assert.ok(Number.parseFloat(modalStyle.maxHeight) <= 680);
  await context.close();

  const downloadContext = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 900, height: 700 },
  });
  await downloadContext.addInitScript(({ artifactUrl }) => {
    globalThis.__planrDefaultCustodyCreateCalls = 0;
    globalThis.__OPENPLANR_ARTIFACT_STAGE_OPTIONS__ = {
      async resolveArtifactSource() {
        const response = await fetch(artifactUrl, { cache: 'no-store' });
        return response.blob();
      },
      share: {
        async prepareShare() {
          return { fragmentLength: 4_000, compressedBytes: 2_914, ciphertextBytes: 2_942 };
        },
        async prepareOwnerCustody({ ttl }) {
          const keyId = `sha256:${'c'.repeat(64)}`;
          const publicKey = 'C'.repeat(120);
          const signer = {
            role: 'owner',
            algorithm: 'ECDSA-P256-SHA256',
            encoding: 'spki-base64url',
            keyId,
            value: publicKey,
          };
          Object.defineProperty(signer, 'sign', { enumerable: false, value: async () => 'signature' });
          const roomId = 'room_abcdefghijklmn';
          const key = 'K'.repeat(43);
          const prepared = {
            schemaVersion: '1.0.0', kind: 'openplanr-live-room-preparation', protocolVersion: '2.0.0',
            id: roomId, roomId, reviewOf: 'c'.repeat(64), ttl,
            ownerKey: { algorithm: signer.algorithm, encoding: signer.encoding, keyId, value: publicKey },
          };
          Object.defineProperties(prepared, {
            url: { enumerable: false, value: `https://share.openplanr.dev/r/${roomId}#k=${key}&w=${'R'.repeat(43)}` },
            ownerUrl: { enumerable: false, value: `https://share.openplanr.dev/r/${roomId}#k=${key}&o=${'O'.repeat(43)}` },
            manageUrl: { enumerable: false, value: `https://share.openplanr.dev/r/${roomId}#k=${key}&m=${'M'.repeat(43)}` },
            ownerSigner: { enumerable: false, value: signer },
          });
          Object.freeze(prepared);
          return { prepared, recovery: {
            schemaVersion: '1.0.0', kind: 'openplanr-live-room-recovery', protocolVersion: '2.0.0',
            id: roomId, roomId, reviewOf: prepared.reviewOf, ttl, ownerKey: prepared.ownerKey,
            url: prepared.url, ownerUrl: prepared.ownerUrl, manageUrl: prepared.manageUrl,
            ownerSigner: {
              schemaVersion: '1.0.0',
              kind: 'openplanr-live-room-signer',
              role: 'owner',
              algorithm: 'ECDSA-P256-SHA256',
              keyId,
              publicKey,
              privateKey: 'D'.repeat(160),
            },
          } };
        },
        async createShare() {
          globalThis.__planrDefaultCustodyCreateCalls += 1;
          throw new Error('must not create during custody handoff');
        },
        async copyText() {},
      },
    };
  }, { artifactUrl: `${host.url}artifact/checkout` });
  const downloadPage = await downloadContext.newPage();
  await downloadPage.goto(host.url);
  await downloadPage.waitForFunction(() => globalThis.__openPlanrArtifactStage?.getState().status === 'ready');
  await downloadPage.locator('[data-planr-action="share"]').click();
  await downloadPage.waitForFunction(() => globalThis.__openPlanrArtifactShare.getState().phase === 'ready');
  const [ownerDownload] = await Promise.all([
    downloadPage.waitForEvent('download'),
    downloadPage.locator('[data-planr-share-confirm]').click(),
  ]);
  await downloadPage.waitForFunction(() => globalThis.__openPlanrArtifactShare.getState().phase === 'custody-ready');
  assert.match(ownerDownload.suggestedFilename(), /^openplanr-live-room-recovery-room_abcdefg\.json$/);
  const ownerStream = await ownerDownload.createReadStream();
  let ownerBytes = '';
  for await (const chunk of ownerStream) ownerBytes += chunk.toString('utf8');
  const downloadedRecovery = JSON.parse(ownerBytes);
  assert.equal(downloadedRecovery.kind, 'openplanr-live-room-recovery');
  assert.equal(downloadedRecovery.ownerSigner.privateKey, 'D'.repeat(160));
  assert.match(downloadedRecovery.url, /&w=/);
  assert.match(downloadedRecovery.ownerUrl, /&o=/);
  assert.match(downloadedRecovery.manageUrl, /&m=/);
  assert.equal(Object.hasOwn(downloadedRecovery, 'ciphertext'), false);
  assert.equal(await downloadPage.evaluate(() => globalThis.__planrDefaultCustodyCreateCalls), 0);
  assert.deepEqual(await downloadPage.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
    state: JSON.stringify(globalThis.__openPlanrArtifactShare.getState()),
  })), { local: 0, session: 0, state: JSON.stringify({
    open: true,
    phase: 'custody-ready',
    transport: 'live',
    ttl: '7d',
    preview: {
      fragmentLength: 4_000,
      compressedBytes: 2_914,
      ciphertextBytes: 2_942,
      fragmentEligible: true,
    },
    ownerCustodyEstablished: true,
    result: null,
    error: '',
  }) });
  assert.doesNotMatch(
    await downloadPage.evaluate(() => JSON.stringify(globalThis.__openPlanrArtifactShare.getState())),
    /privateKey|DDDDDDDD/,
  );
  await downloadPage.locator('[data-planr-share-close]').click();
  await downloadPage.locator('[data-planr-action="share"]').click();
  await downloadPage.waitForFunction(() => globalThis.__openPlanrArtifactShare.getState().phase === 'ready');
  assert.equal(await downloadPage.evaluate(() => globalThis.__openPlanrArtifactShare.getState().ownerCustodyEstablished), false);
  await downloadContext.close();

  const roomContext = await browser.newContext({ viewport: { width: 900, height: 700 } });
  await roomContext.addInitScript(({ artifactUrl }) => {
    globalThis.__planrRoomCopies = [];
    globalThis.__OPENPLANR_ARTIFACT_STAGE_OPTIONS__ = {
      async resolveArtifactSource() {
        const response = await fetch(artifactUrl, { cache: 'no-store' });
        return response.blob();
      },
      share: {
        existingRoom: true,
        existingShareUrl: 'https://share.openplanr.dev/r/room-stable#k=key&w=write',
        async copyText(value) { globalThis.__planrRoomCopies.push(value); },
      },
    };
  }, { artifactUrl: `${host.url}artifact/checkout` });
  const roomPage = await roomContext.newPage();
  await roomPage.goto(host.url);
  await roomPage.waitForFunction(() => globalThis.__openPlanrArtifactStage?.getState().status === 'ready');
  const roomShare = roomPage.locator('[data-planr-action="share"]');
  assert.equal(await roomShare.textContent(), 'Copy link');
  assert.equal(await roomShare.getAttribute('aria-haspopup'), null);
  await roomShare.click();
  assert.deepEqual(await roomPage.evaluate(() => globalThis.__planrRoomCopies), [
    'https://share.openplanr.dev/r/room-stable#k=key&w=write',
  ]);
  assert.equal(await roomShare.textContent(), 'Copied');
  assert.equal(await roomPage.locator('[data-planr-share-dialog]').isHidden(), true);
  await roomContext.close();
});
