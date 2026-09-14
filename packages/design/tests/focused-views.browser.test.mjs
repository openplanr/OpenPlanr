import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { renderDesignDocument } from '../lib/design/document.mjs';
import { startDesignReview } from '../lib/design/review.mjs';
import { designFixture } from './design-fixture.mjs';

const engines = createRequire(new URL('../../pipeline/package.json', import.meta.url))('playwright');
const engine = process.env.PLANR_BROWSER_ENGINE || 'chromium';

// Check visible geometry, real input and authored handlers. A controller that
// merely reports a fixed camera while its stage moves must fail this regression.
async function focusedGeometry(page) {
  await page.waitForFunction(() => {
    const frames = [...document.querySelectorAll('.planr-artifact-panel:not([hidden]) iframe')];
    if (frames.length !== 1) return false;
    const frame = frames[0].getBoundingClientRect();
    const stage = document.querySelector('.planr-stage-scroll').getBoundingClientRect();
    return frame.width > 100 && frame.left >= stage.left - 1 && frame.right <= stage.right + 1
      && frame.top >= stage.top - 1 && frame.bottom <= stage.bottom + 1
      && Math.abs(frame.left + frame.width / 2 - stage.left - stage.width / 2) < 3;
  }).catch(async error => {
    const geometry = await page.evaluate(() => ({ view: window.__openPlanrDesignStudio.getState().view,
      frame: document.querySelector('.planr-artifact-panel:not([hidden]) iframe')?.getBoundingClientRect().toJSON(),
      stage: document.querySelector('.planr-stage-scroll').getBoundingClientRect().toJSON(),
      canvas: window.__openPlanrDesignStudio.getState().camera,
      window: { width: innerWidth, height: innerHeight },
    }));
    throw new Error(`Focused screen escaped its viewport: ${JSON.stringify(geometry)}`, { cause: error });
  });
  return page.locator('.planr-artifact-panel:not([hidden]) iframe').boundingBox();
}

async function pointerAction(page, name) {
  const frame = page.locator('.planr-artifact-panel:not([hidden]) iframe');
  const child = await (await frame.elementHandle()).contentFrame();
  const button = child.getByRole('button', { name, exact: true });
  await button.scrollIntoViewIfNeeded();
  const position = await button.evaluate(node => ({ rect: node.getBoundingClientRect().toJSON(), width: innerWidth, height: innerHeight }));
  const bounds = await frame.boundingBox();
  await page.mouse.click(bounds.x + (position.rect.x + position.rect.width / 2) * bounds.width / position.width,
    bounds.y + (position.rect.y + position.rect.height / 2) * bounds.height / position.height);
  return child;
}

test(`focused journeys contain the screen, preserve product interaction and return to the free canvas (${engine})`, { timeout: 90000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-focused-views-'));
  let browser, session;
  try {
    const { file, document } = designFixture(root, { count: 3, variants: 2, frames: [
      { id: 'desktop', label: 'Desktop', width: 1000, height: 720 },
      { id: 'mobile', label: 'Mobile', width: 390, height: 720 },
    ] });
    for (const [index, screen] of document.screens.entries()) {
      screen.source.styles = [];
      writeFileSync(join(root, screen.source.html), `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
        *{box-sizing:border-box}body{margin:0;padding:24px;font:16px/1.5 system-ui;background:#f4f6f5;color:#16372b}
        button,input{font:inherit;padding:8px 12px}button{cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #168575;outline-offset:3px}
        .scroll-content{height:1600px;padding-top:24px;background:linear-gradient(#f4f6f5,#c7ded5)}
        </style></head><body><h1>${screen.title}</h1><label>Workspace name <input aria-label="Workspace name" value="Product team"></label>
        <p><button data-planr-id="save-${index + 1}" onclick="document.getElementById('saved').textContent='Product saved'">Save product</button>
        <button data-planr-id="action-${index + 1}" data-design-navigate="screen-${index + 1 === document.screens.length ? 1 : index + 2}">Continue</button></p>
        <p id="saved" role="status">Unsaved</p><div class="scroll-content">Product content scrolls within this screen.</div><p>End of product screen</p></body></html>`);
    }
    writeFileSync(file, JSON.stringify(document));
    const rendered = await renderDesignDocument(file);
    session = await startDesignReview(file, { env: { ...process.env, PLANR_HOME: join(root, 'home') }, port: 0 });
    browser = await engines[engine].launch({ headless: true,
      ...(engine === 'chromium' && existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? { channel: 'chrome' } : {}),
    });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const [host, url] of [['portable', pathToFileURL(rendered.views.canvas).href], ['local', session.url]]) {
      await page.setViewportSize({ width: 1600, height: 1050 });
      await page.goto(url);
      await page.waitForSelector('[data-design-ready="true"]');
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-design-opening'));
      await page.evaluate(async () => {
        const studio = window.__openPlanrDesignStudio;
        studio.setView('canvas');
        const firstArtifact = document.querySelector('.planr-artifact-panel').dataset.artifactId;
        studio.restorePresentation({ ...studio.getState(), compare: true,
          positions: { ...studio.getState().positions, [firstArtifact]: { x: 350, y: 170 } } });
        studio.setCamera({ x: -275, y: 85, zoom: 0.42 });
        await studio.flush();
      });
      const canvas = await page.evaluate(() => window.__openPlanrDesignStudio.getState());
      await page.locator('[data-planr-mode="comment"]').click();
      await page.locator('[data-design-view="prototype"]').click();
      assert.equal(await page.locator('[data-planr-mode="interact"]').getAttribute('aria-pressed'), 'true', 'entering Prototype clears a prior comment cursor');

      for (const view of ['prototype', 'walkthrough']) {
        if (view === 'walkthrough') {
          await page.locator('[data-design-inspect-mode]').click();
          assert.equal(await page.locator('.planr-shell').getAttribute('data-design-inspect'), 'true');
          await page.locator('[data-design-view="walkthrough"]').click();
          assert.notEqual(await page.locator('.planr-shell').getAttribute('data-design-inspect'), 'true', 'entering Walkthrough clears inspection overlay');
          assert.equal(await page.locator('[data-planr-mode="interact"]').getAttribute('aria-pressed'), 'true');
        }
        await focusedGeometry(page);
        const before = await page.evaluate(() => window.__openPlanrDesignStudio.getState());
        const rectBefore = await focusedGeometry(page);
        const stage = await page.locator('.planr-stage-scroll').boundingBox();
        const background = { x: stage.x + 7, y: stage.y + stage.height / 2 };
        await page.mouse.move(background.x, background.y);
        await page.mouse.wheel(180, 140);
        await page.keyboard.down('Control');
        await page.mouse.wheel(0, 120);
        await page.keyboard.up('Control');
        for (const { button, space } of [{ button: 'left', space: false }, { button: 'middle', space: false }, { button: 'left', space: true }]) {
          await page.mouse.move(background.x, background.y);
          if (space) await page.keyboard.down('Space');
          await page.mouse.down({ button });
          await page.mouse.move(background.x + 90, background.y + 70, { steps: 6 });
          await page.mouse.up({ button });
          if (space) await page.keyboard.up('Space');
        }
        assert.equal(await page.locator('.planr-artifact-panel:not([hidden]) .design-artboard-label').isVisible(), false, 'focused screens do not expose draggable artboard chrome');
        await page.evaluate(() => window.__openPlanrDesignStudio.setCamera({ x: -100000, y: 100000, zoom: 0.05 }));
        const after = await page.evaluate(() => window.__openPlanrDesignStudio.getState());
        assert.deepEqual(after.camera, before.camera, `${host}/${view}: canvas gestures cannot move a focused screen`);
        assert.equal(after.zoom, before.zoom, `${host}/${view}: canvas zoom cannot shrink a focused screen`);
        assert.deepEqual(await focusedGeometry(page), rectBefore);
        assert.equal(await page.locator('[data-design-pan]').isVisible(), false);
        for (const control of await page.locator('[data-design-zoom]').all()) assert.equal(await control.isVisible(), false);
        assert.equal(await page.getByRole('button', { name: 'Fit screen', exact: true }).isVisible(), true);
        assert.equal(await page.locator('[data-planr-mode="interact"]').getAttribute('aria-pressed'), 'true');

        const child = await pointerAction(page, 'Save product');
        await child.getByText('Product saved', { exact: true }).waitFor();
        const input = child.getByRole('textbox', { name: 'Workspace name' });
        await input.focus();
        await input.fill('Keyboard team');
        await child.getByRole('button', { name: 'Continue', exact: true }).focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(previous => window.__openPlanrDesignStudio.getState().screenId !== previous, before.screenId);
        await focusedGeometry(page);
        const product = await (await page.locator('.planr-artifact-panel:not([hidden]) iframe').elementHandle()).contentFrame();
        await product.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const scrollBefore = await product.evaluate(() => scrollY);
        const frameRect = await focusedGeometry(page);
        await page.mouse.move(frameRect.x + frameRect.width / 2, frameRect.y + frameRect.height * 0.75);
        await page.mouse.wheel(0, 360);
        await product.waitForFunction(y => scrollY > y + 20, scrollBefore);
        assert.deepEqual(await focusedGeometry(page), frameRect, 'product scroll stays inside the selected screen');

        await page.locator('[data-planr-mode="comment"]').click();
        const annotation = page.locator('.planr-artifact-panel:not([hidden]) [data-planr-annotation-layer]');
        const commentRect = await annotation.boundingBox();
        await page.mouse.click(commentRect.x + 50, commentRect.y + 65);
        await page.locator('[data-planr-annotation-composer]').waitFor({ state: 'visible' });
        assert.equal(await page.locator('[data-planr-composer-comment]').isVisible(), true, 'annotation remains an explicit usable tool');
        await page.keyboard.press('Escape');
        await page.locator('[data-planr-mode="interact"]').click();

        await page.locator('[data-design-frame]').selectOption('mobile');
        await focusedGeometry(page);
        await page.evaluate(() => window.__openPlanrDesignStudio.setPanels({ navOpen: false, reviewOpen: false }));
        await focusedGeometry(page);
        await page.setViewportSize({ width: 760, height: 720 });
        await focusedGeometry(page);
        await page.setViewportSize({ width: 390, height: 844 });
        await focusedGeometry(page);
        await page.setViewportSize({ width: 1600, height: 1050 });
        await page.evaluate(() => window.__openPlanrDesignStudio.setPanels({ navOpen: true, reviewOpen: true }));
        await page.locator('.planr-workspace').evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))));
        await focusedGeometry(page);
        const evidence = process.env.OPENPLANR_FOCUSED_EVIDENCE_DIR;
        if (evidence) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, `${host}-${view}-${engine}.png`) }); }
        await page.locator('[data-design-frame]').selectOption('desktop');
        await focusedGeometry(page);
      }
      await page.locator('[data-design-view="canvas"]').click();
      const restored = await page.evaluate(() => window.__openPlanrDesignStudio.getState());
      assert.deepEqual(restored.camera, canvas.camera, 'returning to Canvas restores its free camera');
      assert.equal(restored.zoom, canvas.zoom);
      assert.deepEqual(restored.positions, canvas.positions, 'focused journeys never alter the freeform artboard arrangement');
      assert.equal(restored.compare, canvas.compare, 'Canvas retains its direction-comparison setting');
      assert.ok(await page.locator('.planr-artifact-panel:visible').count() > 1);
      await page.evaluate(() => window.__openPlanrDesignStudio.setCamera({ x: 160, y: 140, zoom: 0.65 }));
      assert.deepEqual((await page.evaluate(() => window.__openPlanrDesignStudio.getState())).camera, { x: 160, y: 140 }, 'Canvas remains freely movable');
    }
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await session?.close(); await rm(root, { recursive: true, force: true }); }
});
