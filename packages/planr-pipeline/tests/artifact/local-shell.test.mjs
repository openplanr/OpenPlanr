import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { createArtifactEnvelope } from '../../lib/artifact/envelope.mjs';
import {
  ARTIFACT_STAGE_LIMITS,
  clientPointToNormalized,
  createArtifactStagePayload,
  createArtifactStageState,
  normalizedPointToClient,
  reduceArtifactStageState,
  visibleArtifactIds,
} from '../../lib/artifact/ui/stage.mjs';
import { renderArtifactShellDocument } from '../../lib/artifact/ui/shell.mjs';
import {
  renderArtifactShellAssets,
  renderArtifactStageRuntimeAsset,
} from '../../scripts/generate-artifact-shell.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const snapshotDir = join(root, 'tests/artifact/__snapshots__');
const runBrowser = process.env.PLANR_BROWSER_TESTS === '1'
  || process.env.npm_lifecycle_event === 'test:artifact:browser';
const updateSnapshots = process.env.PLANR_UPDATE_SNAPSHOTS === '1';
if (process.env.PLANR_REQUIRE_BROWSER === '1' && !runBrowser) {
  throw new Error('PLANR_REQUIRE_BROWSER requires the real artifact browser test to run.');
}

function dynamicArtifact(id, title, colorScheme = 'light') {
  return {
    id,
    title,
    colorScheme,
    viewport: { width: 1440, height: 900 },
    html: `<!doctype html>
<html data-artifact="${id}"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;min-height:900px;display:grid;place-items:center;background:${colorScheme === 'dark' ? '#12131a' : '#f8fafc'};color:${colorScheme === 'dark' ? '#f4f4fa' : '#171722'};font-family:system-ui,sans-serif}
main{width:560px;padding:48px;border:1px solid #738096;border-radius:24px;background:${colorScheme === 'dark' ? '#1d1f2a' : '#fff'};box-shadow:0 24px 80px #0002}small{font:12px ui-monospace,monospace;letter-spacing:.08em}h1{font-size:46px;line-height:1.05;margin:18px 0}button{min-height:44px;padding:0 18px;border:0;border-radius:10px;background:#087f73;color:white;font:700 15px system-ui;cursor:pointer}
</style></head><body><main data-planr-id="${id}-screen"><small>${id.toUpperCase()} · DYNAMIC HTML</small><h1>${title}</h1><button id="dynamic" type="button">Interactions <span id="count">0</span></button></main><script>document.querySelector('#dynamic').addEventListener('click',()=>{const n=document.querySelector('#count');n.textContent=String(Number(n.textContent)+1);document.documentElement.dataset.interacted='true'});</script></body></html>`,
  };
}

function fixtureEnvelope() {
  return createArtifactEnvelope({
    artifacts: [
      dynamicArtifact('checkout', 'Checkout flow'),
      dynamicArtifact('insights', 'Insights dashboard', 'dark'),
      dynamicArtifact('components', 'Component states'),
    ],
    viewer: { mode: 'variants', activeArtifactId: 'checkout' },
  });
}

test('stage payload is metadata-only and retains digest plus frozen viewport', () => {
  const envelope = fixtureEnvelope();
  envelope.review = { private: 'must not enter stage metadata' };
  envelope.machinePath = '/Users/private/project';
  const payload = createArtifactStagePayload(envelope);

  assert.equal(payload.artifacts.length, 3);
  assert.equal(payload.artifacts[0].sha256, envelope.artifacts[0].sha256);
  assert.deepEqual(payload.artifacts[0].viewport, { width: 1440, height: 900 });
  assert.equal(Object.isFrozen(payload.artifacts[0].viewport), true);
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /<html|Interactions|private|\/Users\/private|machinePath|review|"html"/);
});

test('stage reducer keeps transient layout and interaction state valid and immutable', () => {
  const payload = createArtifactStagePayload(fixtureEnvelope());
  const initial = createArtifactStageState(payload, {
    viewMode: 'variants',
    activeArtifact: { id: 'checkout' },
    reviewMode: 'interact',
    zoom: 100,
    railOpen: true,
    theme: 'light',
    status: 'ready',
  });

  const split = reduceArtifactStageState(initial, { type: 'set-view-mode', viewMode: 'split' });
  assert.deepEqual(visibleArtifactIds(split), ['checkout', 'insights']);
  const swapped = reduceArtifactStageState(split, { type: 'set-active', artifactId: 'insights' });
  assert.equal(swapped.activeArtifactId, 'insights');
  assert.equal(swapped.comparisonArtifactId, 'checkout');
  assert.deepEqual(visibleArtifactIds(swapped), ['insights', 'checkout']);
  assert.equal(initial.activeArtifactId, 'checkout', 'the prior state is never mutated');

  const comment = reduceArtifactStageState(swapped, { type: 'set-review-mode', reviewMode: 'comment' });
  assert.equal(comment.reviewMode, 'comment');
  const zoomed = reduceArtifactStageState(comment, { type: 'set-zoom', zoom: 999 });
  assert.equal(zoomed.zoom, ARTIFACT_STAGE_LIMITS.maxZoom);
  const minimum = reduceArtifactStageState(zoomed, { type: 'zoom-by', delta: -999 });
  assert.equal(minimum.zoom, ARTIFACT_STAGE_LIMITS.minZoom);
  assert.equal(reduceArtifactStageState(minimum, { type: 'unknown' }), minimum);
});

test('zero and one artifact can never enter variants or split state', () => {
  const empty = createArtifactStageState(createArtifactStagePayload({ artifacts: [] }), {
    viewMode: 'split',
    status: 'ready',
  });
  assert.equal(empty.viewMode, 'single');
  assert.equal(empty.status, 'empty');

  const envelope = createArtifactEnvelope({ artifacts: [dynamicArtifact('only', 'Only artifact')] });
  const one = createArtifactStageState(createArtifactStagePayload(envelope), { viewMode: 'variants' });
  assert.equal(one.viewMode, 'single');
  assert.equal(one.zoom, ARTIFACT_STAGE_LIMITS.defaultZoom);
  assert.equal(
    reduceArtifactStageState(one, { type: 'set-view-mode', viewMode: 'split' }).viewMode,
    'single',
  );
});

test('normalized coordinates round-trip independently of visual zoom', () => {
  const unscaled = { left: 20, top: 40, width: 1440, height: 900 };
  const scaled = { left: 20, top: 40, width: 720, height: 450 };
  const expected = { x: 0.25, y: 0.6 };

  const unscaledClient = normalizedPointToClient(unscaled, expected);
  const scaledClient = normalizedPointToClient(scaled, expected);
  assert.deepEqual(clientPointToNormalized(unscaled, unscaledClient), expected);
  assert.deepEqual(clientPointToNormalized(scaled, scaledClient), expected);
  assert.throws(
    () => clientPointToNormalized({ left: 0, top: 0, width: 0, height: 1 }, { x: 0, y: 0 }),
    /positive finite dimensions/,
  );
});

test('shell document keeps artifact bytes out of the parent and exposes only the generated runtime seam', () => {
  const envelope = fixtureEnvelope();
  const document = renderArtifactShellDocument({
    envelope,
    viewer: { mode: 'split', activeArtifactId: 'checkout', comparisonArtifactId: 'insights' },
    shell: { title: 'Artifact behavior review', theme: 'light', status: 'ready' },
  });

  assert.doesNotMatch(document, /Interactions <span|data-planr-id|<html data-artifact/);
  assert.match(document, /id="planr-artifact-stage-payload"/);
  assert.match(document, /script-src 'self' 'unsafe-inline'/);
  assert.match(document, /frame-src blob:/);
  assert.match(document, /connect-src 'self'/);
  assert.doesNotMatch(document, /frame-src[^;]*'self'|frame-src[^;]*data:/);
  assert.match(document, /<script src="\.\/artifact-review-stage\.js" defer><\/script>/);
  assert.equal((document.match(/sandbox="allow-scripts"/g) ?? []).length, 3);
  assert.doesNotMatch(document, /allow-same-origin|allow-forms|allow-popups|allow-downloads|allow-top-navigation/);

  const stageJson = document.match(/id="planr-artifact-stage-payload">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(stageJson);
  const payload = JSON.parse(stageJson);
  assert.equal(payload.artifacts[0].sha256, envelope.artifacts[0].sha256);
  assert.equal(Object.hasOwn(payload.artifacts[0], 'html'), false);
});

test('generated browser controller and manifest are deterministic portable assets', () => {
  const first = renderArtifactStageRuntimeAsset();
  const second = renderArtifactStageRuntimeAsset();
  assert.equal(first, second);
  assert.match(first, /OpenPlanrArtifactStage/);
  assert.match(first, /resolveArtifactSource/);
  assert.match(first, /planr:artifact-point/);
  assert.doesNotMatch(first, /\/Users\//);

  const assets = renderArtifactShellAssets();
  assert.equal(assets['templates/artifact-review-stage.js'], first);
  assert.match(assets['templates/artifact-review-shell.html'], /artifact-review-stage\.js/);
});

async function serve(document, runtime, artifacts = []) {
  const artifactByPath = new Map(artifacts.map((artifact) => [
    `/artifact/${encodeURIComponent(artifact.id)}`,
    artifact.html,
  ]));
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/artifact-review-stage.js') {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.end(runtime);
      return;
    }
    if (artifactByPath.has(request.url)) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(artifactByPath.get(request.url));
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
  // Baselines run only in the pinned macOS Chromium lane. The approved font
  // families retain safe system fallbacks, so a 2% budget absorbs host glyph
  // rasterization without hiding structural, token, or responsive regressions.
  assert.ok(ratio <= 0.02, `${name} visual delta ${(ratio * 100).toFixed(3)}% exceeds 2%`);
}

test('real browser stage preserves dynamic interaction, comment routing, accessibility, and approved visuals', {
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
  const document = renderArtifactShellDocument({
    envelope,
    viewer: { mode: 'variants', activeArtifactId: 'checkout' },
    shell: {
      title: 'Artifact behavior review',
      theme: 'light',
      privacy: 'local',
      status: 'ready',
      feedbackCount: 3,
      railOpen: true,
    },
  });
  const runtime = renderArtifactStageRuntimeAsset();
  const host = await serve(document, runtime, envelope.artifacts);
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await host.close();
  });

  const context = await browser.newContext({
    colorScheme: 'light',
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript((sources) => {
    globalThis.__OPENPLANR_ARTIFACT_STAGE_OPTIONS__ = {
      async resolveArtifactSource(artifact) {
        const response = await fetch(sources[artifact.id], {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!response.ok) throw new Error(`Artifact source failed: ${response.status}`);
        return response.blob();
      },
      onState(state) {
        globalThis.__planrStageState = state;
      },
      bridgeClient: {
        attach({ artifact, frame }) {
          globalThis.__planrBridgeAttachments.push(artifact.id);
          frame.dataset.planrBridge = 'attached';
        },
      },
    };
    globalThis.__planrPointEvents = [];
    globalThis.__planrBridgeAttachments = [];
    addEventListener('planr:artifact-point', (event) => globalThis.__planrPointEvents.push(event.detail));
  }, Object.fromEntries(envelope.artifacts.map(({ id }) => [
    id,
    `${host.url}artifact/${encodeURIComponent(id)}`,
  ])));
  const page = await context.newPage();
  const cspScriptViolations = [];
  page.on('console', (message) => {
    const value = message.text();
    if (/content security policy|violat(?:e|es|ing).*script-src|refused to execute/i.test(value)) {
      cspScriptViolations.push(value);
    }
  });
  await page.goto(host.url);
  await page.waitForFunction(() => globalThis.__openPlanrArtifactStage?.getState().status === 'ready');
  assert.equal(await page.evaluate(() => globalThis.__openPlanrArtifactStage.getState().zoom), 72);
  assert.deepEqual(
    await page.evaluate(() => globalThis.__planrBridgeAttachments),
    ['checkout', 'insights', 'components'],
  );
  assert.deepEqual(
    await page.locator('[data-planr-artifact-frame]').evaluateAll((frames) => (
      frames.map((frame) => frame.getAttribute('src')?.startsWith('blob:'))
    )),
    [true, true, true],
    'tokenized source responses are converted to Blob URLs before iframe navigation',
  );

  const checkout = page.frameLocator('[data-planr-artifact-frame="checkout"]');
  await checkout.locator('#dynamic').click();
  assert.equal(await checkout.locator('#count').textContent(), '1');
  assert.deepEqual(
    cspScriptViolations,
    [],
    'packaged artifact scripts execute without a CSP violation inside the opaque Blob frame',
  );
  assert.equal(await page.locator('[data-planr-artifact-frame="checkout"]').getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await page.locator('[data-planr-artifact-frame="checkout"]').evaluate((frame) => frame.contentDocument), null);

  await compareSnapshot('local-shell-desktop-light', await page.screenshot({ animations: 'disabled' }), {
    PNG,
    pixelmatch,
  });

  await page.locator('[data-planr-mode="interact"]').focus();
  await page.keyboard.press('c');
  assert.equal(await page.locator('.planr-shell').getAttribute('data-planr-review-mode'), 'comment');
  const layer = page.locator('[data-planr-annotation-layer="checkout"]');
  const bounds = await layer.boundingBox();
  assert.ok(bounds);
  await page.mouse.click(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.6);
  await page.waitForFunction(() => globalThis.__planrPointEvents.length === 1);
  const point = await page.evaluate(() => globalThis.__planrPointEvents[0]);
  assert.equal(point.artifactId, 'checkout');
  assert.ok(Math.abs(point.region.x - 0.25) < 0.01);
  assert.ok(Math.abs(point.region.y - 0.6) < 0.01);
  assert.deepEqual(point.viewport, { width: 1440, height: 900 });
  assert.equal(await checkout.locator('#count').textContent(), '1', 'comment input never reaches the artifact');

  const before = await layer.boundingBox();
  await page.locator('[data-planr-action="zoom-in"]').click();
  await page.waitForFunction(() => globalThis.__openPlanrArtifactStage.getState().zoom === 82);
  await page.waitForFunction(() => getComputedStyle(
    document.querySelector('.planr-stage-surface'),
  ).transform.startsWith('matrix(0.82'));
  const after = await layer.boundingBox();
  assert.ok(after.width > before.width);
  const frozen = await page.evaluate(() => globalThis.__openPlanrArtifactStage.getState().artifacts[0].viewport);
  assert.deepEqual(frozen, { width: 1440, height: 900 });
  await page.locator('[data-planr-action="zoom-reset"]').click();
  assert.equal(await page.evaluate(() => globalThis.__openPlanrArtifactStage.getState().zoom), 72);

  await page.locator('[data-planr-mode="interact"]').click();
  await page.locator('#planr-variant-tab-2').click();
  assert.equal(await page.locator('#planr-artifact-2-panel').isVisible(), true);
  assert.equal(await page.locator('#planr-artifact-1-panel').isVisible(), false);
  await page.locator('[data-planr-view="split"]').click();
  assert.equal(await page.locator('.planr-artifact-panel:visible').count(), 2);
  await page.evaluate(() => globalThis.__openPlanrArtifactStage.dispatch({ type: 'set-zoom', zoom: 25 }));
  await page.waitForFunction(() => getComputedStyle(
    document.querySelector('.planr-stage-surface'),
  ).transform.startsWith('matrix(0.25'));
  await page.locator('[data-planr-action="theme"]').click();
  assert.equal(await page.locator('html').getAttribute('data-planr-theme'), 'dark');
  await compareSnapshot('local-shell-desktop-dark-split', await page.screenshot({ animations: 'disabled' }), {
    PNG,
    pixelmatch,
  });

  await page.locator('#planr-variant-tab-2').focus();
  await page.keyboard.press('End');
  assert.equal(await page.locator('#planr-variant-tab-3').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#planr-variant-tab-3').evaluate((element) => document.activeElement === element), true);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page.locator('.planr-workspace').evaluate((element) => getComputedStyle(element).transitionDuration),
    '0s',
  );

  await page.locator('[data-planr-view="single"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-planr-action="feedback"]').click();
  await page.locator('[data-planr-action="feedback"]').click();
  const railStyle = await page.locator('#planr-review-rail').evaluate((element) => {
    const style = getComputedStyle(element);
    return { position: style.position, height: element.getBoundingClientRect().height };
  });
  assert.equal(railStyle.position, 'fixed');
  assert.ok(railStyle.height <= 844 * 0.52 + 1);
  await compareSnapshot('local-shell-mobile-bottom-sheet', await page.screenshot({ animations: 'disabled' }), {
    PNG,
    pixelmatch,
  });

  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-planr-action="feedback"]').getAttribute('aria-expanded'), 'false');
  await context.close();
});
