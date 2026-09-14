import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderDesignDocument } from '../lib/design/document.mjs';
import { startDesignReview } from '../lib/design/review.mjs';
import { designFixture } from './design-fixture.mjs';

const { chromium } = createRequire(new URL('../../pipeline/package.json', import.meta.url))('playwright');

test('camera movement preserves artboard geometry and quiet personal saves while review edits retain save status', { timeout: 45000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-canvas-stability-'));
  let session, browser;
  try {
    const { file } = designFixture(root);
    await renderDesignDocument(file);
    session = await startDesignReview(file, { env: { ...process.env, PLANR_HOME: join(root, 'home') }, port: 0 });
    browser = await chromium.launch({ headless: true, ...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? { channel: 'chrome' } : {}) });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(session.url);
    await page.waitForSelector('[data-design-ready="true"]');
    await page.evaluate(async () => {
      const studio = window.__openPlanrDesignStudio;
      studio.setPanels({ navOpen: false, reviewOpen: false });
      studio.setCamera({ x: 60, y: 40, zoom: 0.55 });
      await studio.flush();
    });
    await page.waitForTimeout(300);
    const evidence = process.env.OPENPLANR_CANVAS_EVIDENCE_DIR;
    if (evidence) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, 'canvas-before.png') }); }
    await page.evaluate(() => {
      window.motionMutations = [];
      window.saveChanges = [];
      const geometryObserver = new MutationObserver(records => window.motionMutations.push(...records.map(record => `${record.target.tagName}:${record.attributeName}`)));
      for (const node of document.querySelectorAll('.planr-artifact-panel, [data-planr-artifact-frame]')) geometryObserver.observe(node, { attributes: true });
      window.geometryObserver = geometryObserver;
      const status = document.querySelector('[data-design-save-state]');
      window.saveObserver = new MutationObserver(() => window.saveChanges.push(status.textContent));
      window.saveObserver.observe(status, { attributes: true, childList: true, subtree: true });
    });
    const scroll = await page.locator('.planr-stage-scroll').boundingBox();
    await page.mouse.move(scroll.x + scroll.width - 180, scroll.y + 190);
    await page.mouse.wheel(95, 60);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 35);
    await page.keyboard.up('Control');
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(scroll.x + scroll.width - 90, scroll.y + 235, { steps: 12 });
    await page.mouse.up({ button: 'middle' });
    const geometry = await page.evaluate(async () => {
      const studio = window.__openPlanrDesignStudio;
      const samples = [];
      for (const zoom of [0.23, 0.31, 0.47, 0.63, 0.83]) {
        studio.setCamera({ x: 60.3, y: 40.7, zoom });
        await new Promise(resolve => requestAnimationFrame(resolve));
        const panel = document.querySelector('[data-design-active="true"]');
        const frame = panel.querySelector('iframe');
        const rect = frame.getBoundingClientRect();
        const outline = document.querySelector('.design-selection-outline');
        const border = outline.getBoundingClientRect();
        samples.push({ zoom, visible: !panel.hidden, intrinsicWidth: frame.clientWidth, intrinsicHeight: frame.clientHeight,
          renderedWidth: rect.width, renderedHeight: rect.height, borderWidth: getComputedStyle(outline).borderLeftWidth,
          offsetX: rect.x - border.x, offsetY: rect.y - border.y, extraWidth: border.width - rect.width, extraHeight: border.height - rect.height });
      }
      await studio.flush();
      await new Promise(resolve => requestAnimationFrame(resolve));
      window.geometryObserver.disconnect();
      return { samples, mutations: window.motionMutations, saveChanges: window.saveChanges };
    });
    assert.deepEqual(geometry.mutations, [], 'pan/zoom never rewrites artboard attributes, geometry, visibility or iframe tab stops');
    assert.deepEqual(geometry.saveChanges, [], 'camera changes do not touch the review save status');
    for (const sample of geometry.samples) {
      assert.equal(sample.visible, true);
      assert.equal(sample.intrinsicWidth, 1440);
      assert.equal(sample.intrinsicHeight, 1024);
      assert.ok(Math.abs(sample.renderedWidth - 1440 * sample.zoom) < 0.01);
      assert.ok(Math.abs(sample.renderedHeight - 1024 * sample.zoom) < 0.01);
      assert.equal(sample.borderWidth, '1px', 'selection stays one viewport pixel at every zoom');
      assert.ok(Math.abs(sample.offsetX - 3) <= 0.51 && Math.abs(sample.offsetY - 3) <= 0.51);
      assert.ok(Math.abs(sample.extraWidth - 6) <= 0.51 && Math.abs(sample.extraHeight - 6) <= 0.51);
    }
    if (evidence) await page.screenshot({ path: join(evidence, 'canvas-after-motion.png') });
    await page.locator('[data-planr-action="feedback"]').click();
    await page.locator('.design-toolbar [data-design-toggle-nav]').click();
    await page.locator('[data-design-screen="screen-2"]').click();
    await page.evaluate(async () => {
      const studio = window.__openPlanrDesignStudio;
      studio.setView('prototype'); studio.setView('walkthrough'); studio.setView('canvas');
      await studio.flush();
    });
    assert.deepEqual(await page.evaluate(() => window.saveChanges), [], 'sidebar, screen and view changes persist without review save announcements');
    assert.equal(await page.evaluate(() => window.__openPlanrDesignStudio.getSaveState().dirty), false);
    const state = await page.evaluate(() => window.__openPlanrDesignStudio.getState());
    const saved = await (await fetch(`${session.url}api/design-state`)).json();
    assert.equal(saved.state.screenId, 'screen-2');
    assert.equal(saved.state.navOpen, state.navOpen);
    assert.equal(saved.state.reviewOpen, state.reviewOpen);
    assert.deepEqual(saved.state.camera, state.camera);
    await page.reload();
    await page.waitForSelector('[data-design-ready="true"]');
    const restored = await page.evaluate(() => window.__openPlanrDesignStudio.getState());
    assert.deepEqual(restored.camera, state.camera, 'personal camera remains recoverable after reload');
    assert.equal(restored.screenId, state.screenId);
    await page.locator('[data-design-rating="4"]').click();
    assert.equal(await page.locator('[data-design-save-state]').textContent(), 'Saving changes');
    await page.evaluate(() => window.__openPlanrDesignStudio.flush());
    assert.equal(await page.locator('[data-design-save-state]').textContent(), 'All changes saved');
    assert.equal((await (await fetch(`${session.url}api/design-state`)).json()).state.ratings.A, 4);

    // Hosted clients may persist personal state separately. Their content callback
    // must not run just because a reviewer opens a sidebar or moves the canvas.
    await page.evaluate(() => {
      window.hostSaves = { personal: 0, content: 0 };
      const options = window.__OPENPLANR_DESIGN_STUDIO_OPTIONS__;
      options.savePersonalState = async () => { window.hostSaves.personal++; return {}; };
      options.saveState = async () => { window.hostSaves.content++; return {}; };
    });
    await page.evaluate(async () => {
      window.__openPlanrDesignStudio.setPanels({ reviewOpen: false });
      window.__openPlanrDesignStudio.setCamera({ x: 40, y: 60 });
      await window.__openPlanrDesignStudio.flush();
    });
    assert.equal(await page.evaluate(() => window.hostSaves.content), 0);
    assert.ok(await page.evaluate(() => window.hostSaves.personal) > 0);
    await page.evaluate(() => window.__openPlanrDesignStudio.setPanels({ reviewOpen: true }));
    await page.locator('[data-design-rating="5"]').click();
    await page.evaluate(() => window.__openPlanrDesignStudio.flush());
    assert.ok(await page.evaluate(() => window.hostSaves.content) > 0);
    await page.evaluate(() => { document.documentElement.dataset.designOpening = 'true'; });
    for (const selector of ['.planr-workspace', '.design-navigator', '.planr-review-rail'])
      assert.equal(await page.locator(selector).evaluate(node => getComputedStyle(node).transitionDuration), '0s', 'restored chrome never animates halfway through opening');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await session?.close(); await rm(root, { recursive: true, force: true }); }
});
