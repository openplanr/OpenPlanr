import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeBundle, sealBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { startDiagramOwner } from '../lib/artifact/diagram/editor/local-owner.mjs';
import { prepareDiagramShareBundle } from '../lib/artifact/diagram/review-bundle.mjs';
import { renderDiagram } from '../lib/artifact/diagram/runtime.mjs';

const enabled = process.env.PLANR_BROWSER_TESTS === '1';
const { build } = createRequire(new URL('../../protocol/package.json', import.meta.url))('esbuild');
const options = { skip: !enabled, timeout: 90000 };
async function fixture(t, { legacy = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'planr-native-share-browser-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const authored = makeBundle('swimlane');
  authored.document.annotations[0].text = 'Note';
  sealBundle(authored);
  const file = join(root, 'saved.json');
  await writeFile(file, JSON.stringify(authored));
  let bundle = await prepareDiagramShareBundle(file);
  if (legacy) {
    const document = JSON.parse(
      readFileSync(
        new URL('../fixtures/diagram/grammars/sequence.planr-diagram.json', import.meta.url),
        'utf8',
      ),
    );
    await renderDiagram(document, { outputRoot: root });
    bundle = await prepareDiagramShareBundle(
      join(root, 'diagrams', document.diagramId, `${document.diagramId}.manifest.json`),
    );
  }
  const entry = join(import.meta.dirname, '../lib/artifact/ui/diagram-shared-review.mjs');
  const built = await build({
    stdin: {
      contents: `import {mountDiagramSharedReview} from ${JSON.stringify(entry)};window.__comments=[];window.__exports=[];window.__mountReview=(options={})=>{window.__review=mountDiagramSharedReview({root:document.querySelector('#review'),bundle:window.__bundle,host:{reviewOf:'a'.repeat(64),onComment:target=>window.__comments.push(target),onExport:format=>window.__exports.push(format),mountReview:({root})=>{root.textContent='Published discussion';},...options}});return window.__review.ready;};window.__mountReview(window.__initialOptions);`,
      resolveDir: import.meta.dirname,
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  const browser = await launchBrowser(),
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => {
    await browser.close();
    assert.deepEqual(errors, []);
  });
  await page.route('https://share.test/diagram/test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><div id="review" style="height:100vh"></div>',
    }),
  );
  await page.goto('https://share.test/diagram/test');
  async function initialize(initialOptions = {}) {
    for (const name of [
      'generated/artifact-theme.css',
      'diagram-editor.css',
      'diagram-studio.css',
      'diagram-shared-review.css',
      'studio-shell.css',
    ])
      await page.addStyleTag({
        content: readFileSync(
          new URL(`../lib/artifact/ui/${name}`, import.meta.url),
          'utf8',
        ).replace(/^@import.*;$/gmu, ''),
      });
    await page.evaluate(
      ({ bundle, initialOptions }) => {
        window.__bundle = bundle;
        window.__initialOptions = initialOptions;
      },
      { bundle, initialOptions },
    );
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.locator('[data-diagram-shared-ready="true"]').waitFor();
  }
  await initialize();
  return {
    page,
    bundle,
    authored,
    reload: async (initialOptions) => {
      await page.reload();
      await initialize(initialOptions);
    },
  };
}
test(
  'read-only authored canvas has verified font, manual geometry, stable free-position pins and feedback-only access',
  options,
  async (t) => {
    const { page, bundle, authored } = await fixture(t);
    assert.equal(await page.evaluate(() => document.fonts.check('400 14px Inter')), true);
    assert.equal(
      await page
        .locator('[data-element-id="node-a"] rect')
        .first()
        .evaluate((rect) => getComputedStyle(rect).fill),
      'rgb(226, 232, 240)',
    );
    const geometry = await page
      .locator('[data-element-id="node-a"] rect')
      .first()
      .getAttribute('x');
    assert.equal(
      Number(geometry),
      authored.presentation.elements.find((item) => item.elementId === 'node-a').bounds.x,
    );
    await page.locator('[data-host-action="pin-comment"]').click();
    const location = await page.evaluate(() => {
      const world = document.querySelector('[data-world]'),
        point = new DOMPoint(160, 160).matrixTransform(world.getScreenCTM());
      return { x: point.x, y: point.y };
    });
    await page.mouse.click(location.x, location.y);
    const target = await page.evaluate(() => window.__comments[0]);
    assert.equal(typeof target.x, 'number');
    assert.equal(typeof target.y, 'number');
    const review = {
      schemaVersion: '1.0.0',
      reviewId: 'review-1',
      reviewOf: 'a'.repeat(64),
      decision: 'pending',
      overall: '',
      pins: [
        {
          id: 'pin-1',
          artifactId: bundle.diagramId,
          region: { x: target.x, y: target.y, w: 0, h: 0 },
          viewport: { width: bundle.scene.width, height: bundle.scene.height },
          author: { name: 'Reviewer' },
          intent: 'question',
          status: 'open',
          comment: 'At this point',
          replies: [],
          createdAt: '2026-09-30T12:00:00Z',
          updatedAt: '2026-09-30T12:00:00Z',
        },
      ],
    };
    await page.evaluate((review) => window.__review.updateReview(review), review);
    const before = await page.locator('[data-review-pin]').getAttribute('cx');
    await page.locator('[data-action="zoom-in"]').click();
    await page.setViewportSize({ width: 600, height: 780 });
    await page.evaluate(() => window.__review.fit());
    assert.equal(await page.locator('[data-review-pin]').getAttribute('cx'), before);
    await page.evaluate(() => window.__review.setReadOnly(true));
    assert.equal(await page.locator('[data-host-action="pin-comment"]').isDisabled(), true);
    await page.evaluate(() => window.__review.fit());
    // Hidden state is written by the camera-driven toolbar refresh, after access changes.
    await page.waitForFunction(() =>
      ['pin-comment', 'comment'].every(
        (id) => document.querySelector(`[data-host-action="${id}"]`)?.hidden === true,
      ),
    );
    for (const action of ['pin-comment', 'comment'])
      assert.equal(await page.locator(`[data-host-action="${action}"]`).isDisabled(), true);
    await page.evaluate(() => {
      window.__review.setReadOnly(false);
      window.__review.fit();
    });
    await page.waitForFunction(() =>
      ['pin-comment', 'comment'].every(
        (id) => document.querySelector(`[data-host-action="${id}"]`)?.hidden === false,
      ),
    );
    for (const action of ['pin-comment', 'comment'])
      assert.equal(await page.locator(`[data-host-action="${action}"]`).isDisabled(), false);
    assert.deepEqual(
      await page.evaluate(() => window.__bundle.authored.presentation.elements),
      authored.presentation.elements,
    );
  },
);

test(
  'legacy sequence uses native full-scene fit, search, element inspection and fonts on mobile',
  options,
  async (t) => {
    const { page, bundle } = await fixture(t, { legacy: true });
    const paint = await page.evaluate(() => ({
      scene: getComputedStyle(document.querySelector('.diagram-scene')).backgroundColor,
      shadow: getComputedStyle(document.querySelector('.diagram-scene')).boxShadow,
      page: getComputedStyle(document.querySelector('[data-canvas-background]')).fill,
      shape: getComputedStyle(document.querySelector('[data-item-id] > rect')).fill,
    }));
    assert.deepEqual(paint, {
      scene: 'rgba(0, 0, 0, 0)',
      shadow: 'none',
      page: 'rgba(0, 0, 0, 0)',
      shape: 'rgb(226, 232, 240)',
    });
    const bounds = await page.evaluate(() => {
      const scene = document.querySelector('.diagram-scene').getBoundingClientRect(),
        canvas = document.querySelector('.diagram-canvas').getBoundingClientRect();
      return { scene: scene.toJSON(), canvas: canvas.toJSON() };
    });
    assert.ok(bounds.scene.left >= bounds.canvas.left - 1);
    assert.ok(bounds.scene.right <= bounds.canvas.right + 1);
    assert.ok(bounds.scene.top >= bounds.canvas.top - 1);
    assert.ok(bounds.scene.bottom <= bounds.canvas.bottom + 1);
    await page.locator('[data-search]').fill(bundle.scene.items[0].label);
    assert.ok((await page.locator('[data-item-index]:visible').count()) > 0);
    await page.evaluate((id) => window.__review.select(id), bundle.scene.items[0].id);
    assert.equal(await page.locator('[data-element-id]').textContent(), bundle.scene.items[0].id);
    assert.deepEqual(
      await page.evaluate(() => ({
        status: getComputedStyle(document.querySelector('[data-canvas-status]')).position,
        actionsGrouped: Boolean(
          document.querySelector('.diagram-element-details > div [data-action="comment-element"]'),
        ),
      })),
      { status: 'absolute', actionsGrouped: true },
    );
    await page.setViewportSize({ width: 390, height: 780 });
    await page.evaluate(() => window.__review.fit());
    assert.equal(await page.evaluate(() => document.fonts.check('400 14px Inter')), true);
  },
);

test('an unlabeled connection is named by its endpoints in the navigator', options, async (t) => {
  const { page, bundle, reload } = await fixture(t, { legacy: true });
  const [relation] = bundle.scene.relations;
  relation.label = '';
  await reload();
  const label = (id) => bundle.scene.items.find((item) => item.id === id).label;
  const index = bundle.scene.items.findIndex((item) => item.id === relation.id);
  assert.ok(index >= 0, 'The connection is listed in the navigator');
  assert.ok(
    (await page.locator(`[data-item-index="${index}"]`).textContent()).endsWith(
      `${label(relation.from)} → ${label(relation.to)}`,
    ),
  );
});

test(
  'rapid Escape during native fullscreen entry leaves presentation and the window closed',
  options,
  async (t) => {
    const { page } = await fixture(t, { legacy: true });
    const hasNativeRequest = await page.evaluate(() => {
      const shell = document.querySelector('.diagram-shell'),
        requestFullscreen = shell.requestFullscreen;
      window.__nativePresentation = { requested: 0, pendingAtEscape: false, result: 'unavailable' };
      window.__nativePresentationSettled = Promise.resolve();
      if (!requestFullscreen) return false;
      shell.requestFullscreen = function (...args) {
        // Invoke the actual browser API; Escape runs before its promise settles.
        const request = requestFullscreen.apply(this, args);
        window.__nativePresentation.requested += 1;
        window.__nativePresentation.pendingAtEscape = !document.fullscreenElement;
        window.__nativePresentationSettled = request.then(
          () => {
            window.__nativePresentation.result = 'entered';
          },
          () => {
            window.__nativePresentation.result = 'rejected';
          },
        );
        shell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return request;
      };
      return true;
    });
    await page.locator('[data-action="present"]').click();
    if (!hasNativeRequest) await page.keyboard.press('Escape');
    await page.evaluate(() => window.__nativePresentationSettled);
    await page.waitForFunction(
      () => !document.fullscreenElement && !matchMedia('(display-mode: fullscreen)').matches,
    );
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.equal(await page.locator('.diagram-shell').getAttribute('data-present'), 'false');
    assert.equal(
      await page.locator('[data-action="present"]').getAttribute('aria-pressed'),
      'false',
    );
    assert.equal(await page.locator('[data-presentation-nav]').isVisible(), false);
    const native = await page.evaluate(() => window.__nativePresentation);
    assert.equal(native.requested, hasNativeRequest ? 1 : 0);
    t.diagnostic(
      JSON.stringify({ engine: process.env.PLANR_BROWSER_ENGINE ?? 'chromium', ...native }),
    );
    await page.setViewportSize({ width: 390, height: 780 });
    assert.equal(await page.locator('[data-presentation-nav]').isVisible(), false);
  },
);

test(
  'rapid Present during native fullscreen exit retains the latest presentation intent',
  options,
  async (t) => {
    const { page } = await fixture(t, { legacy: true });
    await page.evaluate(() => {
      const shell = document.querySelector('.diagram-shell'),
        requestFullscreen = shell.requestFullscreen;
      window.__nativePresentation = {
        requested: 0,
        exits: 0,
        entries: [],
        exitResult: 'unavailable',
      };
      window.__nativePresentationRequests = [];
      window.__nativePresentationExit = Promise.resolve();
      if (requestFullscreen)
        shell.requestFullscreen = function (...args) {
          const request = requestFullscreen.apply(this, args);
          window.__nativePresentation.requested += 1;
          window.__nativePresentationRequests.push(
            request.then(
              () => window.__nativePresentation.entries.push('entered'),
              () => window.__nativePresentation.entries.push('rejected'),
            ),
          );
          return request;
        };
    });
    await page.locator('[data-action="present"]').click();
    await page.evaluate(() => Promise.all(window.__nativePresentationRequests));
    const enteredNative = await page.evaluate(
      () => document.fullscreenElement === document.querySelector('.diagram-shell'),
    );
    if (enteredNative)
      await page.evaluate(() => {
        const shell = document.querySelector('.diagram-shell'),
          exitFullscreen = document.exitFullscreen;
        window.__originalNativeExit = exitFullscreen;
        document.exitFullscreen = function (...args) {
          // Invoke the actual exit API, then request Present before it settles.
          const exit = exitFullscreen.apply(this, args);
          window.__nativePresentation.exits += 1;
          window.__nativePresentationExit = exit.then(
            () => {
              window.__nativePresentation.exitResult = 'exited';
            },
            () => {
              window.__nativePresentation.exitResult = 'rejected';
            },
          );
          shell.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
          return exit;
        };
      });
    await page.locator('[data-action="present"]').click();
    if (!enteredNative) await page.keyboard.press('p');
    await page.evaluate(async () => {
      await window.__nativePresentationExit;
      await Promise.all(window.__nativePresentationRequests);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await page.locator('.diagram-shell').getAttribute('data-present'), 'true');
    assert.equal(
      await page.locator('[data-action="present"]').getAttribute('aria-pressed'),
      'true',
    );
    assert.equal(await page.locator('[data-presentation-nav]').isVisible(), true);
    const native = await page.evaluate(() => window.__nativePresentation);
    assert.equal(native.exits, enteredNative ? 1 : 0);
    t.diagnostic(
      JSON.stringify({
        engine: process.env.PLANR_BROWSER_ENGINE ?? 'chromium',
        enteredNative,
        ...native,
      }),
    );
    await page.evaluate(() => {
      if (window.__originalNativeExit) document.exitFullscreen = window.__originalNativeExit;
    });
    if (
      enteredNative &&
      !(await page.evaluate(
        () => document.fullscreenElement === document.querySelector('.diagram-shell'),
      ))
    ) {
      // A rejected reentry keeps the fitted presentation; a fresh click can enter natively.
      await page.locator('[data-action="present"]').click();
      await page.locator('[data-action="present"]').click();
      await page.evaluate(() => Promise.all(window.__nativePresentationRequests));
      assert.equal(
        await page.evaluate(
          () => document.fullscreenElement === document.querySelector('.diagram-shell'),
        ),
        true,
        'A fresh trusted gesture enters native fullscreen before external exit',
      );
    }
    if (enteredNative) await page.evaluate(() => document.exitFullscreen());
    else await page.locator('[data-action="present"]').click();
    await page.waitForFunction(
      () => document.querySelector('.diagram-shell').dataset.present === 'false',
    );
    assert.equal(
      await page.locator('[data-action="present"]').getAttribute('aria-pressed'),
      'false',
    );
    assert.equal(await page.locator('[data-presentation-nav]').isVisible(), false);
    assert.equal(await page.evaluate(() => document.fullscreenElement), null);
    t.diagnostic(JSON.stringify({ externalNativeExitExercised: enteredNative }));
  },
);

test(
  'standalone legacy pins retain canonical scene geometry and Discussion counts across revision remount, mobile resize and reload',
  options,
  async (t) => {
    const { page, bundle, reload } = await fixture(t, { legacy: true });
    const review = {
      schemaVersion: '1.0.0',
      reviewId: 'review-1',
      reviewOf: 'a'.repeat(64),
      decision: 'pending',
      overall: '',
      pins: [
        {
          id: 'pin-1',
          artifactId: bundle.diagramId,
          anchor: { planrId: bundle.scene.items[0].id },
          region: { x: 0.3, y: 0.3, w: 0, h: 0 },
          viewport: { width: bundle.scene.width, height: bundle.scene.height },
          author: { name: 'Reviewer' },
          intent: 'question',
          status: 'open',
          comment: 'Published comment',
          replies: [],
          createdAt: '2026-09-30T12:00:00Z',
          updatedAt: '2026-09-30T12:00:00Z',
        },
      ],
    };
    await page.evaluate(async (review) => {
      window.__review.dispose();
      await window.__mountReview({ initialReview: review, readOnly: true });
    }, review);
    assert.equal(await page.locator('[data-action="comment"]').isDisabled(), true);
    assert.equal(await page.locator('[data-comment-count]').textContent(), '1');
    async function assertDiscussionBounds() {
      await page.locator('[data-action="review"]').click();
      const bounds = await page.evaluate(() => {
        const workspace = document.querySelector('.diagram-workspace'),
          canvas = document.querySelector('.diagram-canvas'),
          rail = document.querySelector('.planr-review-rail');
        return {
          workspace: workspace.getBoundingClientRect().toJSON(),
          canvas: canvas.getBoundingClientRect().toJSON(),
          rail: rail.getBoundingClientRect().toJSON(),
          position: getComputedStyle(rail).position,
          mobile: innerWidth <= 700,
        };
      });
      if (bounds.mobile) {
        assert.equal(bounds.position, 'static');
        const dialog = await page.locator('.studio-panel-dialog').boundingBox();
        assert.ok(dialog.height >= 750, 'Mobile review uses a full-height controlled dialog');
        assert.ok(
          Math.abs(bounds.canvas.right - bounds.workspace.right) < 1,
          'Mobile canvas keeps its full width',
        );
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.studio-panel-dialog').count(), 0);
      } else {
        assert.equal(bounds.position, 'absolute');
        assert.ok(Math.abs(bounds.rail.right - bounds.workspace.right) < 1);
        assert.ok(Math.abs(bounds.rail.top - bounds.workspace.top) < 1);
        assert.ok(Math.abs(bounds.rail.bottom - bounds.workspace.bottom) < 1);
        assert.ok(
          Math.abs(bounds.canvas.right - bounds.rail.left) < 1,
          'Desktop review reserves its rail width',
        );
      }
      assert.ok(Math.abs(bounds.canvas.top - bounds.workspace.top) < 1);
      assert.ok(Math.abs(bounds.canvas.height - bounds.workspace.height) < 1);
      const exportCount = await page.evaluate(() => window.__exports.length);
      await page.locator('[data-studio-export-menu]').click();
      const svgExport = page.locator('[data-export="svg"]');
      const box = await svgExport.boundingBox();
      const hit = await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.closest('[data-export]')?.getAttribute('data-export'),
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      );
      assert.equal(hit, 'svg', 'The native Export menu remains above open Discussion');
      await svgExport.click();
      assert.equal(await page.evaluate(() => window.__exports.length), exportCount + 1);
      assert.equal(await page.evaluate(() => window.__exports.at(-1)), 'svg');
      if (bounds.mobile) await page.locator('[data-action=review]').click();
      const metrics = await page.evaluate(() => {
        const open = document.querySelector('[data-planr-metric="open"]'),
          total = document.querySelector('[data-planr-metric="total"]');
        return {
          gap: total.getBoundingClientRect().left - open.getBoundingClientRect().right,
          cssGap: getComputedStyle(open.parentElement).columnGap,
          countDisplay: getComputedStyle(total).display,
        };
      });
      assert.equal(metrics.cssGap, '6px');
      assert.ok(
        Math.abs(metrics.gap - 6) <= 1 / 64,
        'Metric spacing differs only by layout rounding',
      );
      assert.equal(metrics.countDisplay, 'grid');
      if (bounds.mobile) await page.keyboard.press('Escape');
      else await page.locator('[data-action="review"]').click();
    }
    await assertDiscussionBounds();
    await page.locator('[data-action="present"]').click();
    await page.waitForFunction(
      () => document.querySelector('.diagram-shell').dataset.present === 'true',
    );
    await page.locator('[data-presentation-nav]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-presentation-nav]').isVisible(), true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => document.querySelector('.diagram-shell').dataset.present === 'false',
    );
    // The controller flag changes before the native window finishes leaving fullscreen.
    await page.waitForFunction(
      () => !document.fullscreenElement && !matchMedia('(display-mode: fullscreen)').matches,
    );
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.equal(await page.locator('[data-presentation-nav]').isVisible(), false);
    async function assertPinGeometry(pin) {
      await page.waitForFunction((pin) => {
        const marker = document.querySelector(`[data-planr-pin-id="${pin.id}"]`);
        if (!marker || marker.hidden) return false;
        const scene = document.querySelector('.diagram-scene').getBoundingClientRect();
        const rect = marker.getBoundingClientRect();
        return (
          Math.abs(rect.x + rect.width / 2 - (scene.x + pin.region.x * scene.width)) < 1 &&
          Math.abs(rect.y + rect.height / 2 - (scene.y + pin.region.y * scene.height)) < 1
        );
      }, pin);
      const styles = await page.evaluate((id) => {
        const marker = document.querySelector(`[data-planr-pin-id="${id}"]`),
          style = getComputedStyle(marker),
          layer = getComputedStyle(marker.parentElement);
        return {
          position: style.position,
          background: style.backgroundColor,
          expectedBackground: getComputedStyle(document.querySelector('#review'))
            .getPropertyValue('--planr-color-question')
            .trim(),
          layerPosition: layer.position,
          layerInset: layer.inset,
        };
      }, pin.id);
      assert.equal(styles.position, 'absolute');
      assert.equal(styles.layerPosition, 'absolute');
      assert.equal(styles.layerInset, '0px');
      assert.notEqual(styles.background, 'rgba(0, 0, 0, 0)');
      assert.notEqual(styles.expectedBackground, '');
    }
    await assertPinGeometry(review.pins[0]);
    await page.evaluate(() =>
      document.querySelector('.diagram-shell').dispatchEvent(
        new CustomEvent('planr:artifact-annotation-focus', {
          detail: { target: 'pin', pinId: 'pin-1' },
        }),
      ),
    );
    await page.waitForFunction((pin) => {
      const scene = document.querySelector('.diagram-scene').getBoundingClientRect(),
        canvas = document.querySelector('.diagram-canvas').getBoundingClientRect();
      return (
        Math.abs(scene.x + pin.region.x * scene.width - (canvas.x + canvas.width / 2)) < 1 &&
        Math.abs(scene.y + pin.region.y * scene.height - (canvas.y + (canvas.height - 90) / 2)) < 1
      );
    }, review.pins[0]);
    const updatedReview = {
      ...review,
      pins: [
        ...review.pins,
        {
          ...Object.fromEntries(Object.entries(review.pins[0]).filter(([key]) => key !== 'anchor')),
          id: 'pin-2',
          region: { x: 0.65, y: 0.45, w: 0, h: 0 },
          comment: 'Free-position comment',
        },
      ],
    };
    await page.evaluate((review) => window.__review.updateReview(review), updatedReview);
    assert.equal(await page.locator('[data-comment-count]').textContent(), '2');
    await page.setViewportSize({ width: 390, height: 780 });
    await assertDiscussionBounds();
    await page.evaluate(() => window.__review.fit());
    for (const pin of updatedReview.pins) await assertPinGeometry(pin);
    await reload({ initialReview: updatedReview, readOnly: true });
    assert.equal(await page.locator('[data-comment-count]').textContent(), '2');
    for (const pin of updatedReview.pins) await assertPinGeometry(pin);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => window.__review.fit());
    for (const pin of updatedReview.pins) await assertPinGeometry(pin);
    await page.locator('[data-shared-history]').click();
    assert.equal(
      await page.getByRole('complementary', { name: 'Published revisions' }).isVisible(),
      true,
    );
    await page.evaluate(async (review) => {
      window.__review.dispose();
      await window.__mountReview({ initialReview: review, readOnly: false });
    }, review);
    await page.evaluate((id) => window.__review.select(id), bundle.scene.items[0].id);
    await page.locator('[data-action="comment-element"]').click();
    assert.equal(await page.evaluate(() => window.__comments.length), 1);
    assert.equal(
      await page.evaluate(() => window.__comments[0].elementId),
      bundle.scene.items[0].id,
    );
    assert.equal(await page.locator('[data-action="comment"]').isDisabled(), false);
    async function assertPressedTool(action) {
      await page.locator(`[data-action="${action}"]`).click();
      const style = await page.evaluate((action) => {
        const button = document.querySelector(`[data-action="${action}"]`),
          probe = document.createElement('span');
        probe.style.background = 'var(--planr-color-primary)';
        probe.style.color = 'var(--planr-color-on-improve)';
        document.querySelector('#review').append(probe);
        const expected = getComputedStyle(probe),
          actual = getComputedStyle(button);
        const result = {
          pressed: button.getAttribute('aria-pressed'),
          background: actual.backgroundColor,
          color: actual.color,
          expectedBackground: expected.backgroundColor,
          expectedColor: expected.color,
        };
        probe.remove();
        return result;
      }, action);
      assert.equal(style.pressed, 'true');
      // Move the pointer away to compare the normal selected state, not its hover state.
      await page.mouse.move(0, 0);
      const actual = await page.locator(`[data-action="${action}"]`).evaluate((button) => ({
        background: getComputedStyle(button).backgroundColor,
        color: getComputedStyle(button).color,
      }));
      assert.equal(actual.background, style.expectedBackground);
      assert.equal(actual.color, style.expectedColor);
    }
    await assertPressedTool('comment');
    await assertPressedTool('pan');
    await page.evaluate(() => {
      window.__review.dispose();
      window.__review.dispose();
    });
  },
);

test(
  'local authored studio verifies its separately served font and previews sharing without publication',
  options,
  async (t) => {
    const outer = await realpath(await mkdtemp(join(tmpdir(), 'planr-owner-share-browser-'))),
      root = join(outer, 'project');
    await mkdir(root);
    t.after(() => rm(outer, { recursive: true, force: true }));
    const owner = await startDiagramOwner({
      root,
      slug: 'checkout',
      noOpen: true,
      env: { ...process.env, PLANR_HOME: join(outer, 'home') },
    });
    t.after(() => owner.close());
    const authored = makeBundle('swimlane');
    authored.document.annotations[0].text = 'Note';
    sealBundle(authored);
    const initialized = await fetch(`${owner.apiBase}initialize`, {
      method: 'POST',
      headers: {
        ...owner.headers,
        origin: new URL(owner.baseUrl).origin,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ bundle: authored, transactionId: 'create-owner' }),
    });
    assert.equal(initialized.status, 200);
    const browser = await launchBrowser();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(10000);
    let publications = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/share')) publications++;
    });
    await page.goto(owner.url);
    await page.locator('[data-owner-ready="true"]').waitFor();
    assert.equal(await page.evaluate(() => document.fonts.check('400 14px Inter')), true);
    assert.equal(
      await page
        .locator('[data-element-id="node-a"] rect')
        .first()
        .evaluate((rect) => getComputedStyle(rect).fill),
      'rgb(226, 232, 240)',
    );
    await page.locator('[data-host-action="share-diagram"]').click();
    await page
      .getByRole('dialog', { name: 'Share diagram' })
      .getByText('Create shared review', { exact: true })
      .waitFor();
    assert.equal(publications, 0);
    await page.getByRole('dialog').getByText('Publication details', { exact: true }).click();
    assert.ok((await page.getByRole('dialog').textContent()).includes(authored.bundleDigest));
    assert.match(
      await page.locator('[data-publication-contents]').textContent(),
      /\d+ elements, \d+ connections/u,
    );
    assert.ok(!(await page.getByRole('dialog').textContent()).includes(root));
    const colors = await page
      .getByRole('button', { name: 'Create shared review' })
      .evaluate((button) => {
        const style = getComputedStyle(button);
        return { foreground: style.color, background: style.backgroundColor };
      });
    assert.equal(colors.foreground, 'rgb(5, 42, 40)');
    assert.equal(colors.background, 'rgb(103, 232, 213)');
  },
);
