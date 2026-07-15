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

test('exact 8,000/8,001 preview boundary selects fragment then forces encrypted short', () => {
  const atLimit = normalizeArtifactSharePreview({
    fragmentLength: ARTIFACT_SHARE_FRAGMENT_LIMIT,
    compressedBytes: 5_900,
    ciphertextBytes: 5_928,
  });
  assert.equal(atLimit.fragmentEligible, true);
  let state = createArtifactShareDialogState({ preview: atLimit });
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
  assert.throws(
    () => reduceArtifactShareDialog(state, {
      type: 'create-success',
      result: { transport: 'unknown', url: 'https://share.openplanr.dev/#v1.abc' },
    }),
    (error) => error.code === 'E_ARTIFACT_SHARE_RESULT_INVALID',
  );
  assert.throws(
    () => reduceArtifactShareDialog(state, {
      type: 'create-success',
      result: {
        transport: 'short',
        url: 'https://share.openplanr.dev/p/id#k=key&delete=leaked-token',
        deletionToken: 'leaked-token',
      },
    }),
    (error) => error.code === 'E_ARTIFACT_SHARE_DELETION_TOKEN_LEAK',
  );
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
        async createShare(input) {
          globalThis.__planrCreateCalls.push(structuredClone(input));
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
  const short = page.locator('[data-planr-share-transport="short"]');
  assert.equal(await fragment.isEnabled(), true);
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
  await compareSnapshot('artifact-share-fragment-desktop-light', await page.screenshot({ animations: 'disabled' }), {
    PNG,
    pixelmatch,
  });
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
  await compareSnapshot('artifact-share-encrypted-short-desktop-dark', await page.screenshot({ animations: 'disabled' }), {
    PNG,
    pixelmatch,
  });
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
  await page.locator('[data-planr-share-copy-deletion]').click();
  await page.waitForFunction(() => globalThis.__planrCopies.at(-1) === 'delete-once-789');
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
  await compareSnapshot('artifact-share-mobile', await page.screenshot({ animations: 'disabled' }), {
    PNG,
    pixelmatch,
  });
  await context.close();
});
