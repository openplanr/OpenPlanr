import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { renderDesignDocument } from '../lib/design/document.mjs';
import { startDesignReview } from '../lib/design/review.mjs';
import { designFixture } from './design-fixture.mjs';

const engines = createRequire(new URL('../../pipeline/package.json', import.meta.url))('playwright');
const engine = process.env.PLANR_BROWSER_ENGINE || 'chromium';
const loadedSelector = '.planr-artifact-panel iframe[src], .planr-artifact-panel iframe[srcdoc]';

async function settled(page, screenId, frameId = 'desktop') {
  await page.waitForFunction(({ screenId, frameId }) => {
    const studio = window.__openPlanrDesignStudio;
    const stage = window.__openPlanrArtifactStage;
    return studio?.getState().screenId === screenId && studio.getState().frameId === frameId
      && !document.querySelector('[data-design-screen-loading], [data-design-transition]')
      && stage?.getFrame(stage.getState().activeArtifactId)?.dataset.planrFrameState === 'ready';
  }, { screenId, frameId });
  const result = await page.locator(loadedSelector).count();
  assert.ok(result >= 1 && result <= 3, `At most three authored documents are live, received ${result}`);
}

async function productFrame(page) {
  return (await page.locator('.planr-artifact-panel:not([hidden]) iframe').elementHandle()).contentFrame();
}

async function tapProductButton(page, name) {
  const frameElement = page.locator('.planr-artifact-panel:not([hidden]) iframe');
  const frame = await productFrame(page);
  const button = frame.getByRole('button', { name, exact: true });
  await button.scrollIntoViewIfNeeded();
  const point = await button.evaluate(value => ({ rect: value.getBoundingClientRect().toJSON(), width: innerWidth, height: innerHeight }));
  const bounds = await frameElement.boundingBox();
  // Playwright's nested-frame hit test ignores the artboard scale on some
  // mobile engines. Exercise a real screen-coordinate touch, without force.
  await page.touchscreen.tap(bounds.x + (point.rect.x + point.rect.width / 2) * bounds.width / point.width,
    bounds.y + (point.rect.y + point.rect.height / 2) * bounds.height / point.height);
}

async function focusedGeometry(page) {
  await page.waitForFunction(() => {
    const frame = document.querySelector('.planr-artifact-panel:not([hidden]) iframe')?.getBoundingClientRect();
    const stage = document.querySelector('.planr-stage-scroll')?.getBoundingClientRect();
    return frame && stage && frame.width > 100 && frame.height > 100
      && frame.left >= stage.left - 1 && frame.right <= stage.right + 1
      && frame.top >= stage.top - 1 && frame.bottom <= stage.bottom + 1;
  });
}

// Mobile emulation does not recreate iOS process-memory limits. This regression
// checks the cause we can control: real document sources stay bounded throughout
// navigation, including transitions, instead of merely hiding fourteen iframes.
test(`mobile reviews demand-load bounded product documents and remain usable (${engine})`, { timeout: 180000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-mobile-loading-'));
  let browser, review;
  try {
    const { file, document } = designFixture(root, { count: 7, frames: [
      { id: 'desktop', label: 'Desktop', width: 1000, height: 720 },
      { id: 'mobile', label: 'Mobile', width: 390, height: 760 },
    ] });
    document.defaultView = 'walkthrough';
    for (const screen of document.screens) {
      screen.source.styles = [];
      writeFileSync(join(root, screen.source.html), `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
        *{box-sizing:border-box}body{margin:0;padding:20px;background:#f5f7f6;color:#18342a;font:16px/1.5 system-ui}
        button,input{font:inherit;padding:8px;max-width:100%}label{display:block}button{margin-top:16px}
        </style></head><body><h1>${screen.title}</h1><label>Workspace name <input aria-label="Workspace name" value="Product team"></label>
        <button data-planr-id="${screen.anchors[0]}" onclick="this.textContent='Saved'">Save workspace</button>
        <p>Authored content for ${screen.id}.</p></body></html>`);
    }
    writeFileSync(file, JSON.stringify(document));
    const rendered = await renderDesignDocument(file);
    review = await startDesignReview(file, { env: { ...process.env, PLANR_HOME: join(root, 'home') }, port: 0 });
    browser = await engines[engine].launch({ headless: true,
      ...(engine === 'chromium' && existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? { channel: 'chrome' } : {}),
    });
    for (const [host, url] of [['portable', pathToFileURL(rendered.views.walkthrough).href], ['local', review.url]]) {
      const context = await browser.newContext({ ...engines.devices['iPhone 13'], reducedMotion: 'no-preference' });
      await context.addInitScript(() => {
        window.__mobileFramePeak = 0;
        window.__mobileThumbnailRequests = 0;
        const sample = () => {
          const count = document.querySelectorAll('.planr-artifact-panel iframe[src], .planr-artifact-panel iframe[srcdoc]').length;
          window.__mobileFramePeak = Math.max(window.__mobileFramePeak, count);
        };
        new MutationObserver(sample).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcdoc'] });
        window.addEventListener('message', event => {
          if (/^thumbnail\./u.test(event.data?.type || '')) window.__mobileThumbnailRequests++;
        });
      });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      page.on('crash', () => errors.push('Browser page crashed'));
      await page.goto(url);
      await page.locator('[data-design-ready="true"]').waitFor();
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-design-opening'));
      assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'test uses a touch device');
      await settled(page, 'screen-1');
      assert.equal(await page.locator(loadedSelector).count(), 1, `${host}: startup loads only the selected product document`);
      assert.equal(await page.locator('.planr-artifact-panel iframe').count(), 14, 'unloaded artboards retain their stable frames');
      await focusedGeometry(page);
      const first = await productFrame(page);
      await first.getByRole('textbox', { name: 'Workspace name' }).fill('Mobile reviewer');
      await tapProductButton(page, 'Save workspace');
      await first.getByRole('button', { name: 'Saved', exact: true }).waitFor();

      for (let index = 2; index <= 7; index++) {
        await page.locator('[data-design-step-change="1"]').tap();
        await settled(page, `screen-${index}`);
        await (await productFrame(page)).getByRole('heading', { name: document.screens[index - 1].title, exact: true }).waitFor();
      }
      for (let index = 6; index >= 1; index--) {
        await page.locator('[data-design-step-change="-1"]').tap();
        await settled(page, `screen-${index}`);
      }
      await page.locator('[data-design-frame]').selectOption('mobile');
      await settled(page, 'screen-1', 'mobile'); await focusedGeometry(page);
      const mobile = await productFrame(page);
      assert.equal(await mobile.evaluate(() => innerWidth), 390, 'responsive selection renders its authored frame width');
      await mobile.getByRole('textbox', { name: 'Workspace name' }).fill('Responsive input works');
      await page.evaluate(() => {
        const next = document.querySelector('[data-design-step-change="1"]');
        next.click(); next.click(); next.click();
      });
      await settled(page, 'screen-4', 'mobile');

      // Leave a real unsent annotation while its original frame is evicted, then
      // return to that screen. It must keep its text and original coordinates.
      await page.evaluate(() => { window.__openPlanrArtifactStage.review.setIdentity({ name: 'Mobile reviewer' }); window.__openPlanrDesignStudio.setTool('annotate'); });
      await page.locator('.planr-artifact-panel:not([hidden]) .planr-annotation-layer').tap({ position: { x: 30, y: 35 } });
      const draft = page.locator('[data-planr-composer-comment]');
      await draft.fill('Keep this mobile annotation draft.');
      await page.evaluate(() => window.__openPlanrDesignStudio.selectScreen('screen-7'));
      await settled(page, 'screen-7', 'mobile');
      await page.evaluate(() => window.__openPlanrDesignStudio.selectScreen('screen-6'));
      await settled(page, 'screen-6', 'mobile');
      await page.evaluate(() => window.__openPlanrDesignStudio.selectScreen('screen-5'));
      await settled(page, 'screen-5', 'mobile');
      await page.evaluate(() => window.__openPlanrDesignStudio.selectScreen('screen-4'));
      await settled(page, 'screen-4', 'mobile');
      assert.equal(await draft.inputValue(), 'Keep this mobile annotation draft.');
      await page.getByRole('button', { name: 'Close new comment', exact: true }).tap();

      await page.locator('[data-design-view="canvas"]').tap();
      await page.evaluate(() => window.__openPlanrDesignStudio.fit());
      await page.waitForFunction(() => [...document.querySelectorAll('[data-design-load-frame]')].some(button => !button.hidden && !button.disabled));
      assert.ok(await page.locator('[data-design-load-frame]:visible').count() >= 4, 'canvas exposes useful unloaded screen placeholders');
      await page.evaluate(() => {
        const target = [...document.querySelectorAll('.planr-artifact-panel:not([hidden]) [data-design-load-frame]')].find(button => !button.hidden && !button.disabled);
        const panel = target.closest('.planr-artifact-panel');
        window.__selectedPlaceholder = panel.dataset.artifactId;
        target.click();
      });
      await page.waitForFunction(() => {
        const stage = window.__openPlanrArtifactStage;
        return stage.getState().activeArtifactId === window.__selectedPlaceholder
          && stage.getFrame(window.__selectedPlaceholder).dataset.planrFrameState === 'ready'
          && !document.querySelector('[data-design-screen-loading]');
      });
      await page.locator('[data-design-view="prototype"]').tap();
      await focusedGeometry(page);
      await page.setViewportSize({ width: 844, height: 390 });
      await focusedGeometry(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await focusedGeometry(page);
      assert.equal(await page.locator('.design-thumbnail img').count(), 0, 'mobile does not rasterize thumbnails');
      assert.equal(await page.evaluate(() => window.__mobileThumbnailRequests), 0);
      assert.ok(await page.evaluate(() => window.__mobileFramePeak <= 3), `${host}: transitions and demand loading never exceed the document budget`);
      const evidence = process.env.OPENPLANR_MOBILE_EVIDENCE_DIR;
      if (evidence) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, `${host}-mobile-${engine}.png`) }); }
      await page.evaluate(() => window.__openPlanrDesignStudio.flush());
      await page.reload();
      await page.locator('[data-design-ready="true"]').waitFor();
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-design-opening'));
      await focusedGeometry(page);
      assert.equal(await page.locator(loadedSelector).count(), 1, 'reload returns to a single ready focused screen');
      assert.deepEqual(errors, [], `${host}: no runtime errors or browser crashes`);
      await context.close();
    }
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await desktop.goto(pathToFileURL(rendered.views.walkthrough).href);
    await desktop.locator('[data-design-ready="true"]').waitFor();
    assert.equal(await desktop.locator(loadedSelector).count(), 14, 'desktop retains its existing eager product-frame behavior');
    await desktop.close();
  } finally { await browser?.close(); await review?.close(); await rm(root, { recursive: true, force: true }); }
});
