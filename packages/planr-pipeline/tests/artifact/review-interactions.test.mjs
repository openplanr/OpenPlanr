import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  createArtifactEnvelope,
  validateArtifactReview,
} from '../../lib/artifact/envelope.mjs';
import {
  anchorRegionToViewportRegion,
  annotationDomIds,
  artifactAnchorPoint,
  clientSelectionToNormalized,
  viewportRegionToAnchorRegion,
} from '../../lib/artifact/ui/annotations.mjs';
import {
  ARTIFACT_REVIEW_LIMITS,
  ArtifactReviewStateError,
  createArtifactReview,
  createArtifactReviewController,
  createSecureArtifactReviewId,
  normalizeArtifactReview,
  reduceArtifactReview,
} from '../../lib/artifact/ui/feedback-rail.mjs';
import { renderArtifactShellDocument } from '../../lib/artifact/ui/shell.mjs';
import { renderArtifactStageRuntimeAsset } from '../../scripts/generate-artifact-shell.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const snapshotDir = join(root, 'tests/artifact/__snapshots__');
const runBrowser = process.env.PLANR_BROWSER_TESTS === '1'
  || process.env.npm_lifecycle_event === 'test:artifact:browser';
const updateSnapshots = process.env.PLANR_UPDATE_SNAPSHOTS === '1';
if (process.env.PLANR_REQUIRE_BROWSER === '1' && !runBrowser) {
  throw new Error('PLANR_REQUIRE_BROWSER requires the real artifact browser test to run.');
}

const reviewOf = 'a'.repeat(64);
const timestamp = '2026-07-14T18:00:00.000Z';

function baseReview(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    reviewId: 'review-fixture',
    reviewOf,
    decision: 'pending',
    overall: '',
    pins: [],
    ...overrides,
  };
}

function pinFixture(overrides = {}) {
  return {
    id: 'pin-fixture',
    author: { name: 'Asem' },
    artifactId: 'checkout',
    variant: 'checkout',
    region: { x: 0.2, y: 0.25, w: 0.1, h: 0.15 },
    viewport: { width: 1440, height: 900 },
    intent: 'fix',
    status: 'open',
    comment: 'Tighten the checkout hierarchy.',
    replies: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

test('click and reverse drag selections produce bounded normalized geometry', () => {
  const bounds = { left: 100, top: 50, width: 800, height: 400 };
  const click = clientSelectionToNormalized(bounds, { x: 300, y: 250 });
  assert.deepEqual(click, { x: 0.25, y: 0.5, w: 0, h: 0 });
  assert.equal(Object.isFrozen(click), true);

  const reverse = clientSelectionToNormalized(
    bounds,
    { clientX: 820, clientY: 410 },
    { clientX: 180, clientY: 90 },
  );
  assert.deepEqual(reverse, { x: 0.1, y: 0.1, w: 0.8, h: 0.8 });

  const bounded = clientSelectionToNormalized(bounds, { x: 2_000, y: -100 }, { x: -500, y: 900 });
  assert.deepEqual(bounded, { x: 0, y: 0, w: 1, h: 1 });
  assert.throws(
    () => clientSelectionToNormalized({ ...bounds, width: 0 }, { x: 0, y: 0 }),
    /positive finite dimensions/,
  );
});

test('anchor sampling uses the center of the normalized region in the frozen viewport', () => {
  assert.deepEqual(
    artifactAnchorPoint({ x: 0.25, y: 0.2, w: 0.5, h: 0.4 }, { width: 1440, height: 900 }),
    { x: 720, y: 360 },
  );
  assert.deepEqual(
    artifactAnchorPoint({ x: 0.999, y: 0.999, w: 0.5, h: 0.5 }, { width: 100, height: 100 }),
    { x: 100, y: 100 },
  );
});

test('stable anchor regions round-trip through the frozen artifact viewport', () => {
  const viewport = { width: 1_000, height: 800 };
  const anchorRect = { x: 100, y: 160, width: 400, height: 320 };
  const anchorRegion = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  const viewportRegion = anchorRegionToViewportRegion(anchorRegion, viewport, anchorRect);
  assert.deepEqual(viewportRegion, { x: 0.2, y: 0.3, w: 0.2, h: 0.2 });
  assert.deepEqual(
    viewportRegionToAnchorRegion(viewportRegion, viewport, anchorRect),
    anchorRegion,
  );
  assert.equal(Object.isFrozen(viewportRegion), true);
});

test('annotation DOM ids are injective for FNV collisions, Unicode, and punctuation', () => {
  // `costarring` and `liquid` are a well-known FNV-1a 32-bit collision pair.
  const values = ['costarring', 'liquid', 'é', 'e\u0301', '実装-📌', 'pin/1', 'pin:1'];
  const generated = values.flatMap((value) => Object.values(annotationDomIds(value)));
  assert.equal(new Set(generated).size, generated.length);
  assert.notDeepEqual(annotationDomIds('costarring'), annotationDomIds('liquid'));
  assert.notDeepEqual(annotationDomIds('é'), annotationDomIds('e\u0301'));
  assert.notDeepEqual(annotationDomIds('x\uD800'), annotationDomIds('x\uFFFD'));
  for (const value of values) {
    const ids = annotationDomIds(value);
    assert.match(ids.pin, /^planr-pin-[a-f0-9]+$/);
    assert.match(ids.thread, /^planr-thread-[a-f0-9]+$/);
    assert.equal(Object.isFrozen(ids), true);
  }
});

test('review reducer is deeply immutable and preserves addressed imported feedback', () => {
  const imported = baseReview({
    pins: [pinFixture({ status: 'addressed' })],
  });
  const normalized = normalizeArtifactReview(imported);
  assert.equal(normalized.pins[0].status, 'addressed');
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.pins[0]), true);
  assert.equal(Object.isFrozen(normalized.pins[0].region), true);

  const previous = structuredClone(normalized);
  const resolved = reduceArtifactReview(normalized, {
    type: 'set-status',
    pinId: 'pin-fixture',
    status: 'resolved',
  }, { now: () => '2026-07-14T18:01:00.000Z' });
  assert.deepEqual(normalized, previous, 'the prior review remains byte-for-byte equivalent');
  assert.notEqual(resolved, normalized);
  assert.equal(resolved.pins[0].status, 'resolved');
  assert.equal(resolved.pins[0].updatedAt, '2026-07-14T18:01:00.000Z');
  assert.equal(Object.isFrozen(resolved.pins[0].replies), true);
});

test('controller authors pins and replies locally without serializing reviewer identity', () => {
  const ids = ['review-1', 'pin-1', 'reply-1'];
  let minute = 1;
  const changes = [];
  const controller = createArtifactReviewController({
    reviewOf,
    createId: () => ids.shift(),
    now: () => `2026-07-14T18:${String(minute++).padStart(2, '0')}:00.000Z`,
  });
  const unsubscribe = controller.subscribe((state, change) => {
    assert.equal(Object.isFrozen(state), true);
    assert.equal(Object.isFrozen(change), true);
    changes.push({ state, change });
  });

  controller.setIdentity({ id: 'local-user', name: 'Asem' });
  const withPin = controller.dispatch({
    type: 'add-pin',
    pin: {
      artifactId: 'checkout',
      variant: 'checkout',
      region: { x: 0.1, y: 0.2, w: 0, h: 0 },
      viewport: { width: 1440, height: 900 },
      anchor: { planrId: 'checkout-card', screen: 'checkout' },
      intent: 'improve',
      comment: 'Keep the order summary visible.',
    },
  });
  assert.equal(Object.hasOwn(withPin, 'identity'), false);
  assert.equal(withPin.pins[0].author.name, 'Asem');
  assert.equal(withPin.pins[0].id, 'pin-1');
  assert.equal(controller.getState().activePinId, 'pin-1');

  const withReply = controller.dispatch({
    type: 'add-reply',
    pinId: 'pin-1',
    comment: 'Agreed; preserve it through payment.',
  });
  assert.equal(withReply.pins[0].replies[0].id, 'reply-1');
  assert.equal(withReply.pins[0].replies[0].author.name, 'Asem');

  const resolved = controller.dispatch({ type: 'set-status', pinId: 'pin-1', status: 'resolved' });
  assert.equal(resolved.pins[0].status, 'resolved');
  const reopened = controller.dispatch({ type: 'set-status', pinId: 'pin-1', status: 'open' });
  assert.equal(reopened.pins[0].status, 'open');
  controller.dispatch({ type: 'set-overall', overall: 'Ready after the hierarchy adjustment.' });
  const requested = controller.dispatch({ type: 'set-decision', decision: 'changes_requested' });
  assert.equal(requested.decision, 'changes_requested');
  const pending = controller.dispatch({ type: 'set-decision', decision: 'pending' });
  assert.equal(pending.decision, 'pending');

  const serialized = JSON.stringify(controller.getReview());
  assert.doesNotMatch(serialized, /"identity"|"activePinId"/);
  assert.doesNotThrow(() => validateArtifactReview(controller.getReview()));
  assert.ok(changes.some(({ change }) => change.type === 'identity'));
  assert.ok(changes.filter(({ change }) => change.type === 'review').length >= 6);
  unsubscribe();
  controller.destroy();
});

test('controller atomically hydrates a compatible review and clears stale selection', () => {
  const initial = normalizeArtifactReview(baseReview({
    reviewId: 'review-initial', pins: [pinFixture()],
    createdAt: timestamp, updatedAt: timestamp,
  }));
  const replacement = normalizeArtifactReview(baseReview({
    reviewId: 'review-hydrated', pins: [],
    createdAt: timestamp, updatedAt: timestamp,
  }));
  const changes = [];
  const controller = createArtifactReviewController({ initialReview: initial, reviewOf });
  controller.subscribe((_state, change) => changes.push(change));
  controller.selectPin('pin-fixture');
  assert.equal(controller.getState().activePinId, 'pin-fixture');
  assert.equal(controller.replaceReview(replacement).reviewId, 'review-hydrated');
  assert.equal(controller.getState().activePinId, null);
  assert.ok(changes.some(({ type }) => type === 'review-replaced'));
  assert.throws(
    () => controller.replaceReview(normalizeArtifactReview(baseReview({
      reviewId: 'review-stale', reviewOf: 'b'.repeat(64),
      createdAt: timestamp, updatedAt: timestamp,
    }))),
    (error) => error.code === 'E_ARTIFACT_REVIEW_DIGEST_MISMATCH',
  );
  controller.destroy();
});

test('default review ids are UUIDv4 and the fallback requires secure randomness', () => {
  const native = createSecureArtifactReviewId({
    randomUUID: () => '123e4567-e89b-42d3-a456-426614174000',
  });
  assert.equal(native, '123e4567-e89b-42d3-a456-426614174000');
  const fallback = createSecureArtifactReviewId({
    getRandomValues(bytes) {
      bytes.fill(0);
      return bytes;
    },
  });
  assert.equal(fallback, '00000000-0000-4000-8000-000000000000');
  assert.match(fallback, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.throws(
    () => createSecureArtifactReviewId({}),
    (error) => error.code === 'E_ARTIFACT_REVIEW_UUID_UNAVAILABLE',
  );
});

test('review actions reject absent identity, invalid timestamps, unknown actions, and limits', () => {
  const review = createArtifactReview({ reviewId: 'review-limits', reviewOf });
  const controller = createArtifactReviewController({ initialReview: review, reviewOf });
  assert.throws(
    () => controller.dispatch({
      type: 'add-pin',
      pin: {
        artifactId: 'checkout',
        region: { x: 0, y: 0, w: 0, h: 0 },
        viewport: { width: 1440, height: 900 },
        intent: 'fix',
        comment: 'Identity is required.',
      },
    }),
    (error) => error instanceof ArtifactReviewStateError
      && error.code === 'E_ARTIFACT_REVIEW_IDENTITY_REQUIRED',
  );
  assert.throws(
    () => reduceArtifactReview(review, { type: 'not-a-real-action' }),
    (error) => error.code === 'E_ARTIFACT_REVIEW_ACTION_UNKNOWN',
  );
  assert.throws(
    () => reduceArtifactReview(review, { type: 'set-overall', overall: '' }, {
      now: () => '2026-07-14 18:00:00',
    }),
    /ISO-8601/,
  );
  assert.throws(
    () => normalizeArtifactReview(baseReview({
      pins: [pinFixture({ createdAt: '2026-07-14T18:00:00' })],
    })),
    /ISO-8601/,
  );
  assert.throws(
    () => reduceArtifactReview(review, {
      type: 'set-overall',
      overall: 'x'.repeat(ARTIFACT_REVIEW_LIMITS.text + 1),
    }, { now: () => timestamp }),
    /65536/,
  );
  assert.throws(
    () => normalizeArtifactReview(baseReview({
      pins: Array.from({ length: ARTIFACT_REVIEW_LIMITS.pins + 1 }),
    })),
    /no more than 10000/,
  );
  assert.throws(
    () => controller.setIdentity({ name: 'x'.repeat(ARTIFACT_REVIEW_LIMITS.authorName + 1) }),
    /256/,
  );
  controller.destroy();
});

function dynamicArtifact(id, title, colorScheme = 'light') {
  return {
    id,
    title,
    colorScheme,
    viewport: { width: 1440, height: 900 },
    html: `<!doctype html>
<html data-artifact="${id}"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;min-height:900px;display:grid;place-items:center;background:${colorScheme === 'dark' ? '#11131a' : '#f8fafc'};color:${colorScheme === 'dark' ? '#f4f4fa' : '#171722'};font-family:system-ui,sans-serif}main{width:600px;padding:52px;border:1px solid #738096;border-radius:24px;background:${colorScheme === 'dark' ? '#1d1f2a' : '#fff'};box-shadow:0 24px 80px #0002}small{font:12px ui-monospace,monospace;letter-spacing:.08em}h1{font-size:46px;line-height:1.05;margin:18px 0}button{min-height:44px;padding:0 18px;border:0;border-radius:10px;background:#087f73;color:white;font:700 15px system-ui;cursor:pointer}
</style></head><body><main data-planr-id="${id}-screen"><small>${id.toUpperCase()} · DYNAMIC HTML</small><h1>${title}</h1><button id="dynamic" type="button">Interactions <span id="count">0</span></button></main><script>document.querySelector('#dynamic').addEventListener('click',()=>{const n=document.querySelector('#count');n.textContent=String(Number(n.textContent)+1);document.documentElement.dataset.interacted='true'});</script></body></html>`,
  };
}

function fixtureEnvelope() {
  return createArtifactEnvelope({
    artifacts: [
      dynamicArtifact('checkout', 'Checkout flow'),
      dynamicArtifact('insights', 'Insights dashboard', 'dark'),
    ],
    viewer: { mode: 'variants', activeArtifactId: 'checkout' },
  });
}

async function serve(document, runtime, artifacts) {
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
  assert.ok(ratio <= 0.02, `${name} visual delta ${(ratio * 100).toFixed(3)}% exceeds 2%`);
}

test('real browser review supports dynamic artifacts, comments, threads, decisions, and mobile focus', {
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
      title: 'Artifact review interactions',
      theme: 'light',
      privacy: 'local',
      status: 'ready',
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
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(({ sources }) => {
    let id = 0;
    let minute = 0;
    globalThis.__planrReviewEvents = [];
    globalThis.__planrSelections = [];
    globalThis.__planrAnchorMode = 'normal';
    addEventListener('planr:artifact-review-change', (event) => {
      globalThis.__planrReviewEvents.push(event.detail);
    });
    addEventListener('planr:artifact-review-select', (event) => {
      globalThis.__planrSelections.push(event.detail);
    });
    globalThis.__OPENPLANR_ARTIFACT_STAGE_OPTIONS__ = {
      async resolveArtifactSource(artifact) {
        const response = await fetch(sources[artifact.id], { cache: 'no-store' });
        if (!response.ok) throw new Error(`Artifact source failed: ${response.status}`);
        return response.blob();
      },
      bridgeClient: {
        attach({ artifact, frame }) {
          frame.__openPlanrBridge = {
            async hitTest() {
              if (globalThis.__planrAnchorMode === 'null') return null;
              if (globalThis.__planrAnchorMode === 'error') throw new Error('bridge unavailable');
              if (globalThis.__planrAnchorMode === 'timeout') {
                return new Promise((resolve) => setTimeout(() => resolve({
                  planrId: 'late-anchor',
                  screen: artifact.id,
                }), 1_200));
              }
              return { planrId: `${artifact.id}-screen`, screen: artifact.id };
            },
          };
        },
      },
      review: {
        createId(kind) {
          id += 1;
          return `${kind}-${String(id).padStart(3, '0')}`;
        },
        now() {
          minute += 1;
          return `2026-07-14T18:${String(minute).padStart(2, '0')}:00.000Z`;
        },
      },
    };
  }, {
    sources: Object.fromEntries(envelope.artifacts.map(({ id }) => [
      id,
      `${host.url}artifact/${encodeURIComponent(id)}`,
    ])),
  });

  const page = await context.newPage();
  await page.goto(host.url);
  await page.waitForFunction(() => globalThis.__openPlanrArtifactStage?.getState().status === 'ready');

  const checkoutFrame = page.frameLocator('[data-planr-artifact-frame="checkout"]');
  await checkoutFrame.locator('#dynamic').click();
  assert.equal(await checkoutFrame.locator('#count').textContent(), '1');

  await page.locator('[data-planr-mode="comment"]').click();
  const checkoutLayer = page.locator('[data-planr-annotation-layer="checkout"]');
  const checkoutBounds = await checkoutLayer.boundingBox();
  assert.ok(checkoutBounds);
  await page.mouse.click(
    checkoutBounds.x + checkoutBounds.width * 0.36,
    checkoutBounds.y + checkoutBounds.height * 0.42,
  );
  const composer = page.locator('[data-planr-annotation-composer]');
  await composer.waitFor();
  assert.equal(
    await composer.locator('[data-planr-composer-comment]').evaluate((element) => document.activeElement === element),
    true,
  );
  await composer.locator('[data-planr-composer-identity]').fill('Asem <admin>');
  await composer.locator('[data-planr-intent="improve"]').click();
  const hostileText = '<img src=x onerror="globalThis.__planrXss=true"> Keep the summary visible.';
  const comment = composer.locator('[data-planr-composer-comment]');
  await comment.fill(hostileText);
  await comment.press('Enter');
  await comment.type('Across each payment step.');
  await compareSnapshot(
    'artifact-review-composer-desktop-light',
    await page.screenshot({ animations: 'disabled' }),
    { PNG, pixelmatch },
  );
  await composer.locator('[data-planr-composer-submit]').click();
  await page.waitForFunction(() => globalThis.__openPlanrArtifactStage.review?.getReview()?.pins.length === 1);
  assert.equal(await page.locator('[data-planr-slot="review-announcer"]').textContent(), 'improve feedback added.');

  const firstReview = await page.evaluate(() => globalThis.__openPlanrArtifactStage.review.getReview());
  assert.equal(firstReview.pins[0].intent, 'improve');
  assert.equal(firstReview.pins[0].variant, 'checkout');
  assert.deepEqual(firstReview.pins[0].anchor, { planrId: 'checkout-screen', screen: 'checkout' });
  assert.match(firstReview.pins[0].comment, /\nAcross each payment step\.$/);
  assert.equal(Object.hasOwn(firstReview, 'identity'), false);
  assert.equal(await page.evaluate(() => globalThis.__planrXss ?? false), false);
  assert.equal(await page.locator('.planr-thread-comment img').count(), 0);
  assert.equal(await page.locator('.planr-thread-comment').textContent(), firstReview.pins[0].comment);

  const firstPinId = firstReview.pins[0].id;
  const firstPin = page.locator(`[data-planr-annotation-layer="checkout"] [data-planr-pin-id="${firstPinId}"]`);
  const firstThread = page.locator(`#${annotationDomIds(firstPinId).thread}`);
  await firstPin.click();
  assert.equal(await firstThread.evaluate((element) => document.activeElement === element), true);
  await firstThread.locator('[data-planr-thread-focus]').click();
  assert.equal(await firstPin.evaluate((element) => document.activeElement === element), true);
  await firstPin.press('Enter');
  assert.equal(await firstThread.evaluate((element) => document.activeElement === element), true);
  assert.ok(await page.evaluate(() => globalThis.__planrSelections.length >= 1));

  const replyForm = firstThread.locator('[data-planr-reply-form]');
  const hostileReply = '<svg onload="globalThis.__replyXss=true"> Confirmed in the responsive state.';
  await replyForm.locator('textarea').fill(hostileReply);
  await replyForm.locator('button[type="submit"]').click();
  await page.waitForFunction(() => globalThis.__openPlanrArtifactStage.review.getReview().pins[0].replies.length === 1);
  assert.equal(await firstThread.locator('.planr-reply').count(), 1);
  assert.equal(await firstThread.locator('.planr-reply').textContent().then((value) => value.includes(hostileReply)), true);
  assert.equal(await firstThread.locator('.planr-reply svg').count(), 0);
  assert.equal(await page.evaluate(() => globalThis.__replyXss ?? false), false);
  assert.equal(await page.locator('[data-planr-slot="review-announcer"]').textContent(), 'Reply added');

  await firstThread.locator('[data-planr-thread-action="resolve"]').click();
  assert.equal(
    await page.evaluate(() => globalThis.__openPlanrArtifactStage.review.getReview().pins[0].status),
    'resolved',
  );
  assert.equal(await page.locator('[data-planr-slot="review-announcer"]').textContent(), 'Feedback resolved');
  await firstThread.locator('[data-planr-thread-action="reopen"]').click();
  assert.equal(
    await page.evaluate(() => globalThis.__openPlanrArtifactStage.review.getReview().pins[0].status),
    'open',
  );
  assert.equal(await page.locator('[data-planr-slot="review-announcer"]').textContent(), 'Feedback reopened');

  await page.locator('[data-planr-action="theme"]').click();
  assert.equal(await page.locator('html').getAttribute('data-planr-theme'), 'dark');
  await compareSnapshot(
    'artifact-review-thread-desktop-dark',
    await page.screenshot({ animations: 'disabled' }),
    { PNG, pixelmatch },
  );

  const overall = page.locator('[data-planr-overall]');
  const hostileOverall = '<script>globalThis.__overallXss=true</script> Preserve the summary and clarify payment hierarchy.';
  await overall.fill(hostileOverall);
  await overall.blur();
  assert.equal(
    await page.evaluate(() => globalThis.__openPlanrArtifactStage.review.getReview().overall),
    hostileOverall,
  );
  assert.equal(await page.evaluate(() => globalThis.__overallXss ?? false), false);
  const requestChanges = page.locator('[data-planr-decision="changes_requested"]');
  await requestChanges.click();
  assert.equal(await requestChanges.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-planr-slot="review-announcer"]').textContent(), 'Changes requested');
  await compareSnapshot(
    'artifact-review-decision-changes-requested',
    await page.screenshot({ animations: 'disabled' }),
    { PNG, pixelmatch },
  );
  await requestChanges.click();
  assert.equal(
    await page.evaluate(() => globalThis.__openPlanrArtifactStage.review.getReview().decision),
    'pending',
  );
  await page.locator('[data-planr-decision="approved"]').click();
  assert.equal(
    await page.evaluate(() => globalThis.__openPlanrArtifactStage.review.getReview().decision),
    'approved',
  );

  await page.locator('[data-artifact-id="insights"][role="tab"]').click();
  await page.evaluate(() => { globalThis.__planrAnchorMode = 'null'; });
  const insightsLayer = page.locator('[data-planr-annotation-layer="insights"]');
  const insightsBounds = await insightsLayer.boundingBox();
  assert.ok(insightsBounds);
  await page.mouse.move(
    insightsBounds.x + insightsBounds.width * 0.72,
    insightsBounds.y + insightsBounds.height * 0.66,
  );
  await page.mouse.down();
  await page.mouse.move(
    insightsBounds.x + insightsBounds.width * 0.42,
    insightsBounds.y + insightsBounds.height * 0.38,
    { steps: 4 },
  );
  await page.mouse.up();
  const regionComposer = page.locator('[data-planr-annotation-layer="insights"] [data-planr-annotation-composer]');
  await regionComposer.waitFor();
  await regionComposer.locator('[data-planr-intent="question"]').click();
  await regionComposer.locator('[data-planr-composer-comment]').fill('Should this chart use the same comparison period?');
  await regionComposer.locator('[data-planr-composer-submit]').click();
  await page.waitForFunction(() => globalThis.__openPlanrArtifactStage.review.getReview().pins.length === 2);
  const retained = await page.evaluate(() => globalThis.__openPlanrArtifactStage.review.getReview());
  assert.equal(retained.pins[0].id, firstPinId);
  assert.equal(retained.pins[1].artifactId, 'insights');
  assert.equal(Object.hasOwn(retained.pins[1], 'anchor'), false, 'null anchors keep coordinate fallback');
  assert.ok(retained.pins[1].region.w > 0.25);
  assert.ok(retained.pins[1].region.h > 0.2);
  const invariantRegion = structuredClone(retained.pins[1].region);

  await page.evaluate(() => globalThis.__openPlanrArtifactStage.dispatch({ type: 'set-zoom', zoom: 25 }));
  await page.evaluate(() => globalThis.__openPlanrArtifactStage.dispatch({ type: 'set-zoom', zoom: 200 }));
  await page.evaluate(() => globalThis.__openPlanrArtifactStage.dispatch({ type: 'set-zoom', zoom: 72 }));
  await page.evaluate(() => globalThis.__openPlanrArtifactStage.dispatch({ type: 'set-view-mode', viewMode: 'split' }));
  await page.evaluate(() => globalThis.__openPlanrArtifactStage.dispatch({ type: 'set-view-mode', viewMode: 'variants' }));
  await page.evaluate(() => globalThis.__openPlanrArtifactStage.dispatch({ type: 'set-rail-open', railOpen: false }));
  await page.evaluate(() => globalThis.__openPlanrArtifactStage.dispatch({ type: 'set-rail-open', railOpen: true }));
  assert.deepEqual(
    await page.evaluate(() => globalThis.__openPlanrArtifactStage.review.getReview().pins[1].region),
    invariantRegion,
  );

  // A late bridge result is ignored after the draft's artifact is hidden.
  await page.locator('[data-artifact-id="checkout"][role="tab"]').click();
  await page.evaluate(() => { globalThis.__planrAnchorMode = 'timeout'; });
  const checkoutAgain = await checkoutLayer.boundingBox();
  assert.ok(checkoutAgain);
  await page.mouse.click(checkoutAgain.x + checkoutAgain.width * 0.52, checkoutAgain.y + checkoutAgain.height * 0.52);
  await page.locator('[data-planr-annotation-composer]').waitFor();
  await page.locator('[data-artifact-id="insights"][role="tab"]').click();
  await page.waitForTimeout(900);
  assert.equal(await page.locator('[data-planr-annotation-composer]').count(), 0);
  assert.equal(await page.evaluate(() => globalThis.__openPlanrArtifactStage.review.getReview().pins.length), 2);

  // Rejected anchor lookups also keep valid coordinate-only review state.
  await page.locator('[data-artifact-id="checkout"][role="tab"]').click();
  await page.evaluate(() => { globalThis.__planrAnchorMode = 'error'; });
  const errorFallbackBounds = await checkoutLayer.boundingBox();
  assert.ok(errorFallbackBounds);
  await page.mouse.click(errorFallbackBounds.x + errorFallbackBounds.width * 0.62, errorFallbackBounds.y + errorFallbackBounds.height * 0.32);
  const fallbackComposer = page.locator('[data-planr-annotation-composer]');
  await fallbackComposer.locator('[data-planr-composer-comment]').fill('Coordinate fallback remains actionable.');
  await fallbackComposer.locator('[data-planr-composer-submit]').click();
  await page.waitForFunction(() => globalThis.__openPlanrArtifactStage.review.getReview().pins.length === 3);
  assert.equal(
    await page.evaluate(() => Object.hasOwn(globalThis.__openPlanrArtifactStage.review.getReview().pins[2], 'anchor')),
    false,
  );
  await page.evaluate(() => { globalThis.__planrAnchorMode = 'normal'; });

  await firstThread.locator('[data-planr-thread-focus]').click();
  assert.equal(
    await page.evaluate(() => globalThis.__openPlanrArtifactStage.getState().activeArtifactId),
    'checkout',
    'choosing a hidden thread activates its artifact before focusing the pin',
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press('Escape');
  const feedbackToggle = page.locator('[data-planr-action="feedback"]');
  assert.equal(await feedbackToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await feedbackToggle.evaluate((element) => document.activeElement === element), true);
  await feedbackToggle.click();
  assert.equal(await feedbackToggle.getAttribute('aria-expanded'), 'true');
  const mobileRail = await page.locator('#planr-review-rail').evaluate((element) => {
    const style = getComputedStyle(element);
    return { position: style.position, height: element.getBoundingClientRect().height };
  });
  assert.equal(mobileRail.position, 'fixed');
  assert.ok(mobileRail.height <= 844 * 0.52 + 1);
  assert.deepEqual(
    await page.evaluate(() => globalThis.__openPlanrArtifactStage.review.getReview().pins[1].region),
    invariantRegion,
  );
  const reducedMotion = await feedbackToggle.evaluate((element) => getComputedStyle(element).transitionDuration);
  assert.ok(reducedMotion.split(',').every((value) => Number.parseFloat(value) === 0));
  await compareSnapshot(
    'artifact-review-mobile-bottom-sheet',
    await page.screenshot({ animations: 'disabled' }),
    { PNG, pixelmatch },
  );

  const emitted = await page.evaluate(() => globalThis.__planrReviewEvents.at(-1));
  assert.equal(Object.hasOwn(emitted, 'identity'), false);
  assert.doesNotThrow(() => validateArtifactReview(emitted));
  assert.deepEqual(emitted, await page.evaluate(() => globalThis.__openPlanrArtifactStage.review.getReview()));
  await context.close();
});
