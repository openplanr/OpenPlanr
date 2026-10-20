import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { browserEngine, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { prepareDesignDocument, standaloneDesignHtml } from '../lib/design/document.mjs';
import { designFixture } from './design-fixture.mjs';
import { settleStudioChrome } from './studio-readiness.mjs';

for (const height of ['auto', 450]) {
  test(`studio renders ${height} frames with numeric geometry (${browserEngine()})`, {
    timeout: 30000,
  }, async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'design-auto-browser-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { file } = designFixture(root, {
      count: 2,
      frames: [{ id: 'page', label: 'Page', width: 600, height }],
    });
    for (let index = 1; index <= 2; index++)
      writeFileSync(
        join(root, `source/screen-${index}.html`),
        `<!doctype html><style>
        body{margin:0;padding:0;box-sizing:border-box}main{height:1800px;display:flex;flex-direction:column;justify-content:space-between}
        button{height:40px;width:120px}</style><body><main><h1>Long page</h1><button data-planr-id="action-${index}">Continue</button></main></body>`,
      );
    const prepared = prepareDesignDocument(file);
    const html = join(root, 'studio.html');
    writeFileSync(html, standaloneDesignHtml(prepared));
    const browser = await launchBrowser({ engine: browserEngine() });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(pathToFileURL(html).href);
    await page.locator('[data-design-ready="true"]').waitFor();
    await settleStudioChrome(page);
    const id = prepared.entries[0].artifactId;
    const panel = page.locator(`[data-artifact-id="${id}"].planr-artifact-panel`);
    const expected = height === 'auto' ? 1800 : height;
    await page.waitForFunction(
      ({ id, expected }) => window.__openPlanrDesignStudio.getViewport(id).height === expected,
      { id, expected },
    );
    assert.equal(await panel.evaluate((node) => node.offsetHeight), expected);
    const second = page.locator(
      `[data-artifact-id="${prepared.entries[1].artifactId}"].planr-artifact-panel`,
    );
    const row = height === 'auto' ? 1148 : 698;
    assert.equal(await second.evaluate((node) => parseFloat(node.style.top)), row);
    assert.match(
      await page.locator('[data-design-frame] option').textContent(),
      new RegExp(`600 × ${height}`),
    );
    await page.evaluate(() => window.__openPlanrDesignStudio.fitSelection());
    const camera = await page.evaluate(() => window.__openPlanrDesignStudio.getState());
    const outline = await page
      .locator('.design-selection-outline')
      .evaluate((node) => parseFloat(node.style.height));
    assert.ok(Math.abs(outline - (expected * camera.zoom + 6)) <= 1);
    assert.ok(Number.isFinite(camera.camera.y));
    if (height === 'auto') {
      const frame = await (await panel.locator('iframe').elementHandle()).contentFrame();
      await frame.locator('main').evaluate((node) => {
        node.style.height = '2400px';
      });
      await page.waitForFunction(
        (id) => window.__openPlanrDesignStudio.getViewport(id).height === 2400,
        id,
      );
      assert.equal(
        await second.evaluate((node) => parseFloat(node.style.top)),
        row,
        'measurement does not move later grid rows',
      );
      const result = await page.evaluate(async (id) => {
        const bridge = window.__openPlanrArtifactStage.getFrame(id).__openPlanrBridge;
        const inspected = await bridge.inspectAt(60, 2380);
        const anchor = await bridge.hitTest(60, 2380);
        return { inspected, anchor };
      }, id);
      assert.equal(result.inspected.viewport.height, 2400);
      assert.equal(result.anchor.planrId, 'action-1');
      let captured;
      await page.evaluate(() => {
        document.querySelector('.planr-shell').addEventListener(
          'planr:artifact-region',
          (event) => {
            window.__autoRegion = event.detail;
          },
          { once: true },
        );
        window.__openPlanrDesignStudio.setTool('annotate');
      });
      await panel.locator('[data-planr-annotation-layer]').focus();
      await page.keyboard.press('Enter');
      captured = await page.evaluate(() => window.__autoRegion);
      assert.deepEqual(captured.viewport, { width: 600, height: 2400 });
      assert.equal(captured.region.y, 0.5);
      await page.keyboard.press('Escape');
      await frame.locator('main').evaluate((node) => {
        node.style.height = '20000px';
      });
      await page.waitForFunction(
        (id) => window.__openPlanrDesignStudio.getViewport(id).height === 16384,
        id,
      );
    }
    for (const view of ['prototype', 'walkthrough']) {
      await page.evaluate((view) => window.__openPlanrDesignStudio.setView(view), view);
      await settleStudioChrome(page);
      const current = await page.evaluate(() => window.__openPlanrDesignStudio.getState());
      assert.ok(current.zoom > 0 && Number.isFinite(current.camera.y));
    }
    assert.deepEqual(errors, []);
  });
}
