import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { browserEngine, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { renderDesignDocument } from '../lib/design/document.mjs';
import { designFixture } from './design-fixture.mjs';
import { startDesignReview } from './studio-http-fixture.mjs';
import { settleStudioChrome } from './studio-readiness.mjs';

const engine = browserEngine();

async function assertHeaderPixels(page, before, after, details) {
  if (after.equals(before)) return;
  const { sameSize, changedPixels, maxChannelDifference, width, height } = await page.evaluate(
    async (images) => {
      const [expected, actual] = await Promise.all(
        images.map(async (image) => {
          const bytes = Uint8Array.from(atob(image), (character) => character.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          return context.getImageData(0, 0, canvas.width, canvas.height);
        }),
      );
      const sameSize = expected.width === actual.width && expected.height === actual.height;
      let changedPixels = 0,
        maxChannelDifference = 0;
      for (let index = 0; index < Math.min(expected.data.length, actual.data.length); index += 4) {
        let changed = false;
        for (let channel = 0; channel < 4; channel++) {
          const difference = Math.abs(
            expected.data[index + channel] - actual.data[index + channel],
          );
          changed ||= difference !== 0;
          maxChannelDifference = Math.max(maxChannelDifference, difference);
        }
        if (changed) changedPixels++;
      }
      return {
        sameSize,
        changedPixels,
        maxChannelDifference,
        width: expected.width,
        height: expected.height,
      };
    },
    [before.toString('base64'), after.toString('base64')],
  );
  // Compare decoded pixels strictly; PNG encoding metadata can differ without a paint change.
  const allowedPixels = 0;
  if (sameSize && changedPixels === 0) return;
  const evidence = await mkdtemp(join(tmpdir(), 'openplanr-header-mismatch-'));
  await Promise.all([
    writeFile(join(evidence, 'before.png'), before),
    writeFile(join(evidence, 'after.png'), after),
    writeFile(
      join(evidence, 'state.json'),
      JSON.stringify(
        {
          ...details,
          sameSize,
          changedPixels,
          allowedPixels,
          maxChannelDifference,
        },
        null,
        2,
      ),
    ),
  ]);
  assert.fail(`Canvas zoom changed header pixels; evidence: ${evidence}`);
}

test(`canvas zoom preserves shell geometry, minimap focus and frame identity (${engine})`, {
  timeout: 90000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-zoom-shell-'));
  let browser, review;
  try {
    const { file } = designFixture(root, { count: 9 });
    const rendered = await renderDesignDocument(file);
    review = await startDesignReview(file, {
      env: { ...process.env, PLANR_HOME: join(root, 'home') },
      port: 0,
    });
    browser = await launchBrowser({ engine });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    page.setDefaultTimeout(8000);
    page.setDefaultNavigationTimeout(30000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const url of [pathToFileURL(rendered.views.canvas).href, review.url]) {
      await page.goto(url);
      await page.locator('[data-design-ready="true"]').waitFor();
      await page.waitForFunction(() => window.__openPlanrDesignExperience);
      await page.evaluate(async () => {
        await document.fonts.ready;
        window.__openPlanrDesignStudio.setPanels({ navOpen: true, reviewOpen: true });
      });
      await page.locator('.design-minimap-board').first().waitFor();
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      await page.evaluate(() =>
        Promise.all(
          [...document.querySelectorAll('.planr-workspace,.design-navigator,.planr-review-rail')]
            .flatMap((n) => n.getAnimations())
            .map((a) => a.finished.catch(() => {})),
        ),
      );
      const result = await page.evaluate(async () => {
        const studio = window.__openPlanrDesignStudio;
        const nodes = [
          ...document.querySelectorAll(
            '.design-toolbar,.design-navigator,.planr-review-rail,.design-stage-context,.design-canvas-tools',
          ),
        ];
        const geometry = () =>
          nodes.map((n) => {
            const r = n.getBoundingClientRect();
            return [r.x, r.y, r.width, r.height];
          });
        const initial = geometry();
        const first = document.querySelector('.design-minimap-board');
        first.focus();
        const boards = [...document.querySelectorAll('.design-minimap-board')];
        const boardGeometry = boards.map((n) =>
          ['x', 'y', 'width', 'height'].map((k) => n.getAttribute(k)),
        );
        const frames = [...document.querySelectorAll('[data-planr-artifact-frame]')];
        let rootChanges = 0,
          structuralRenders = 0;
        const onRender = () => structuralRenders++;
        const shell = document.querySelector('.planr-shell');
        shell.addEventListener('planr:design-render', onRender);
        const observer = new MutationObserver((records) => (rootChanges += records.length));
        observer.observe(shell, { attributes: true });
        const samples = [];
        for (const zoom of [0.09, 0.1, 0.11, 0.99, 1, 1.11, 1.2, 0.98]) {
          studio.setCamera({ x: 28.7, y: 62.3, zoom });
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          samples.push(geometry());
        }
        observer.disconnect();
        shell.removeEventListener('planr:design-render', onRender);
        return {
          initial,
          samples,
          rootChanges,
          structuralRenders,
          focusRetained: document.activeElement === first,
          mapNodesStable: boards.every(
            (n, i) => n === document.querySelectorAll('.design-minimap-board')[i],
          ),
          mapGeometryStable:
            JSON.stringify(boardGeometry) ===
            JSON.stringify(
              boards.map((n) => ['x', 'y', 'width', 'height'].map((k) => n.getAttribute(k))),
            ),
          framesStable: frames.every(
            (n, i) => n === document.querySelectorAll('[data-planr-artifact-frame]')[i],
          ),
        };
      });
      assert.ok(
        result.samples.every((sample) => JSON.stringify(sample) === JSON.stringify(result.initial)),
        `Zoom must not resize or recenter shell controls: ${JSON.stringify(result)}`,
      );
      assert.equal(
        result.rootChanges,
        0,
        'Camera updates do not invalidate inherited styles across the shell',
      );
      assert.equal(result.structuralRenders, 0, 'Zoom does not dispatch structural renders');
      assert.ok(
        result.focusRetained && result.mapNodesStable && result.mapGeometryStable,
        'Only the minimap viewport moves on zoom; artboards and keyboard focus remain stable',
      );
      assert.ok(result.framesStable, 'Zoom does not recreate product frames');
      // Exercise the real toolbar controls as well as a burst of wheel events.
      const before = await page.locator('.design-canvas-tools').boundingBox();
      // Compare the stable branding and view controls; connection status and
      // right-side actions can update independently of the camera.
      const header = await page.locator('.design-toolbar').boundingBox();
      const headerClip = { ...header, width: Math.min(1000, header.width) };
      const headerState = () =>
        page.evaluate(() => ({
          markup: ['.design-toolbar-leading', '.design-view-picker']
            .map((selector) => document.querySelector(selector).outerHTML)
            .join(''),
          focus: document.activeElement.outerHTML,
          hover: [...document.querySelectorAll(':hover')].map((node) => node.className),
          animations: document.getAnimations().map((animation) => ({
            playState: animation.playState,
            target: animation.effect?.target?.className,
          })),
        }));
      const pointerTarget = await page.locator('.planr-stage-scroll').boundingBox();
      await page.mouse.move(pointerTarget.x + 8, pointerTarget.y + 20);
      await settleStudioChrome(page);
      const stateBefore = await headerState();
      const headerBefore = await page.screenshot({ clip: headerClip });
      for (const action of ['in', 'in', 'out', 'out'])
        await page.locator(`[data-design-zoom="${action}"]`).click();
      assert.deepEqual(await page.locator('.design-canvas-tools').boundingBox(), before);
      // Restore the pre-action focus before comparing pixels. Keyboard focus
      // is an intentional toolbar paint and is independent of canvas movement.
      await page.locator('.design-minimap-board').first().focus();
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      await page.mouse.move(pointerTarget.x + 8, pointerTarget.y + 20);
      await settleStudioChrome(page);
      const headerAfter = await page.screenshot({ clip: headerClip });
      const stateAfter = await headerState();
      assert.equal(stateAfter.markup, stateBefore.markup, 'Zoom preserves header controls');
      assert.equal(stateAfter.focus, stateBefore.focus, 'Zoom restores the original minimap focus');
      await assertHeaderPixels(page, headerBefore, headerAfter, { url, stateBefore, stateAfter });
      const scroll = await page.locator('.planr-stage-scroll').boundingBox();
      await page.mouse.move(scroll.x + 8, scroll.y + 20);
      await page.keyboard.down('Control');
      for (const delta of [30, -30, 80, -80]) await page.mouse.wheel(0, delta);
      await page.keyboard.up('Control');
      assert.deepEqual(await page.locator('.design-canvas-tools').boundingBox(), before);
      await page.evaluate(() =>
        window.__openPlanrDesignStudio.setCamera({ x: 40, y: 40, zoom: 0.5 }),
      );
      await page.locator('[data-planr-mode="interact"]').click();
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const viewport = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        ratio: devicePixelRatio,
      }));
      const product = await page.locator('[data-planr-artifact-frame]').first().boundingBox();
      const cameraBeforeProductPan = await page.evaluate(
        () => window.__openPlanrDesignStudio.getState().camera,
      );
      await page.mouse.move(product.x + product.width / 2, product.y + product.height / 2);
      await page.mouse.wheel(95, 60);
      await page.waitForFunction((before) => {
        const camera = window.__openPlanrDesignStudio.getState().camera;
        return camera.x < before.x - 80 && camera.y < before.y - 50;
      }, cameraBeforeProductPan);
      assert.deepEqual(
        await page.locator('.design-canvas-tools').boundingBox(),
        before,
        'Trackpad pan over a product keeps the shell stable',
      );
      const prior = await page.evaluate(() => window.__openPlanrDesignStudio.getState().zoom);
      await page.mouse.move(product.x + product.width / 2, product.y + product.height / 2);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, 45);
      await page.keyboard.up('Control');
      await page.waitForFunction(
        (prior) => window.__openPlanrDesignStudio.getState().zoom < prior,
        prior,
      );
      assert.deepEqual(
        await page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
          ratio: devicePixelRatio,
        })),
        viewport,
        'Modifier-wheel over a product zooms the canvas without zooming the browser shell',
      );
      assert.deepEqual(await page.locator('.design-canvas-tools').boundingBox(), before);
      assert.deepEqual(errors, []);
    }
  } finally {
    await browser?.close();
    await review?.close();
    await rm(root, { recursive: true, force: true });
  }
});
