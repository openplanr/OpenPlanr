import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { renderDesignDocument } from '../lib/design/document.mjs';
import { startDesignReview } from '../lib/design/review.mjs';
import { designFixture } from './design-fixture.mjs';

const engines = createRequire(new URL('../../pipeline/package.json', import.meta.url))(
  'playwright',
);
const engine = process.env.PLANR_BROWSER_ENGINE || 'chromium';
const selectors = {
  interact: '[data-planr-mode="interact"]',
  annotate: '[data-planr-mode="comment"]',
  pan: '[data-design-pan]',
  inspect: '[data-design-inspect-mode]',
};

async function activeTool(page, tool) {
  for (const [name, selector] of Object.entries(selectors))
    assert.equal(
      await page.locator(selector).getAttribute('aria-pressed'),
      String(name === tool),
      `Only ${tool} should be selected (${name})`,
    );
  assert.equal(
    await page.locator('.planr-shell').getAttribute('data-design-pan-active'),
    String(tool === 'pan'),
  );
  assert.equal(
    (await page.locator('.design-inspect-overlay:visible').count()) > 0,
    tool === 'inspect',
  );
}

test(`canvas tools are exclusive and interrupted gestures release without a view change (${engine})`, {
  timeout: 90000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-tools-'));
  let browser, review;
  try {
    const { file } = designFixture(root, {
      count: 1,
      frames: [{ id: 'desktop', label: 'Desktop', width: 1000, height: 720 }],
    });
    const rendered = await renderDesignDocument(file);
    review = await startDesignReview(file, {
      env: { ...process.env, PLANR_HOME: join(root, 'home') },
      port: 0,
    });
    browser = await engines[engine].launch({
      headless: true,
      ...(engine === 'chromium' &&
      existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        ? { channel: 'chrome' }
        : {}),
    });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.setDefaultTimeout(8000);
    page.setDefaultNavigationTimeout(30000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const url of [pathToFileURL(rendered.views.canvas).href, review.url]) {
      await page.goto(url);
      await page.locator('[data-design-ready="true"]').waitFor();
      await page.waitForFunction(() => window.__openPlanrDesignExperience);
      await page.evaluate(() => {
        window.__openPlanrDesignStudio.setPanels({ navOpen: false, reviewOpen: true });
        window.__openPlanrDesignStudio.fitSelection();
      });
      // Clicking Interact while stage reviewMode already says interact must still clear Pan.
      for (const target of ['interact', 'annotate', 'inspect']) {
        await page.locator(selectors.pan).click();
        await activeTool(page, 'pan');
        await page.locator(selectors[target]).click();
        await activeTool(page, target);
        await page.locator(selectors.interact).click();
      }
      // Inspect and sidebar annotation participate in the same tool selection.
      await page.locator(selectors.inspect).click();
      await page.getByRole('tab', { name: 'Review', exact: true }).click();
      await page.locator(selectors.pan).click();
      await page.getByRole('button', { name: 'Add comment', exact: true }).click();
      await activeTool(page, 'annotate');
      await page.locator('.planr-annotation-layer').click({ position: { x: 100, y: 80 } });
      await page
        .locator('[data-planr-composer-comment]')
        .fill('Preserve this draft during tool changes');
      await page.locator(selectors.pan).click();
      await activeTool(page, 'pan');
      assert.equal(await page.locator('[data-planr-annotation-composer]').count(), 0);
      await page.locator(selectors.annotate).click();
      assert.equal(
        await page.locator('[data-planr-composer-comment]').inputValue(),
        'Preserve this draft during tool changes',
      );
      await page.getByRole('button', { name: 'Close new comment', exact: true }).click();
      await page.locator(selectors.interact).click();
      const frame = page.frameLocator('[data-planr-artifact-frame]');
      // Let the browser commit iframe hit testing after an overlay is removed.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const control = await frame
        .getByRole('button', { name: 'Save workspace', exact: true })
        .evaluate((button) => ({
          rect: button.getBoundingClientRect().toJSON(),
          width: innerWidth,
          height: innerHeight,
        }));
      const bounds = await page.locator('[data-planr-artifact-frame]').boundingBox();
      await page.mouse.click(
        bounds.x + ((control.rect.x + control.rect.width / 2) * bounds.width) / control.width,
        bounds.y + ((control.rect.y + control.rect.height / 2) * bounds.height) / control.height,
      );
      await frame.getByRole('button', { name: 'Saved', exact: true }).waitFor();
      // Pan owns the whole canvas, including pixels currently covered by a
      // sandboxed product frame. Interact must resume immediately afterward.
      await page.locator(selectors.pan).click();
      const cameraBeforeFramePan = await page.evaluate(
        () => window.__openPlanrDesignStudio.getState().camera,
      );
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width / 2 + 84, bounds.y + bounds.height / 2 + 52);
      await page.mouse.up();
      const cameraAfterFramePan = await page.evaluate(
        () => window.__openPlanrDesignStudio.getState().camera,
      );
      assert.ok(
        cameraAfterFramePan.x - cameraBeforeFramePan.x > 70 &&
          cameraAfterFramePan.y - cameraBeforeFramePan.y > 40,
        'Pan starts over a product frame',
      );
      await page.locator(selectors.interact).click();
      await frame.getByRole('button', { name: 'Saved', exact: true }).click();
      // Keyboard selection also works when the generic stage mode is unchanged.
      await page.locator(selectors.pan).click();
      await page.keyboard.press('i');
      await activeTool(page, 'interact');
      await page.keyboard.press('h');
      await activeTool(page, 'pan');
      await page.keyboard.press('c');
      await activeTool(page, 'annotate');
      await page.locator(selectors.inspect).click();
      await page.keyboard.press('Escape');
      await activeTool(page, 'interact');
      const area = await page.locator('.planr-stage-scroll').boundingBox();
      for (const interruption of ['blur', 'lostpointercapture', 'pointercancel', 'tool']) {
        await page.locator(selectors.pan).click();
        await page.mouse.move(area.x + 8, area.y + 20);
        await page.mouse.down();
        await page.mouse.move(area.x + 50, area.y + 30);
        const before = await page.evaluate(() => window.__openPlanrDesignStudio.getState().camera);
        await page.evaluate((type) => {
          const scroll = document.querySelector('.planr-stage-scroll');
          if (type === 'blur') window.dispatchEvent(new Event('blur'));
          else if (type === 'tool') document.querySelector('[data-planr-mode="interact"]').click();
          else scroll.dispatchEvent(new PointerEvent(type, { pointerId: 1 }));
        }, interruption);
        await page.mouse.move(area.x + 130, area.y + 70);
        await page.mouse.up();
        assert.deepEqual(
          await page.evaluate(() => window.__openPlanrDesignStudio.getState().camera),
          before,
          `${interruption} releases the old drag`,
        );
        await page.locator(selectors.interact).click();
        await activeTool(page, 'interact');
      }
      // Holding Space is temporary and returns to the chosen annotation tool.
      await page.locator(selectors.annotate).click();
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.down('Space');
      await activeTool(page, 'pan');
      await page.keyboard.up('Space');
      await activeTool(page, 'annotate');
      await page.locator(selectors.pan).click();
      await page.keyboard.press('Escape');
      await activeTool(page, 'interact');
      assert.deepEqual(errors, []);
    }
  } finally {
    await browser?.close();
    await review?.close();
    await rm(root, { recursive: true, force: true });
  }
});
