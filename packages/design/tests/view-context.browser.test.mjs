import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { browserEngine, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { currentDesign, renderDesignDocument } from '../lib/design/document.mjs';
import { designFixture } from './design-fixture.mjs';
import { startDesignReview } from './studio-http-fixture.mjs';
import { settleStudioChrome } from './studio-readiness.mjs';

async function waitForContext(path, matches, { since = performance.now(), timeout = 500 } = {}) {
  let context;
  do {
    try {
      context = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (context && matches(context)) {
      assert.ok(performance.now() - since <= timeout, `view context updates within ${timeout} ms`);
      return context;
    }
    await setTimeout(10);
  } while (performance.now() - since <= timeout);
  assert.fail(`View context did not update within ${timeout} ms: ${JSON.stringify(context)}`);
}

test(`inspected elements and visible boards reach live view context within 500 ms (${browserEngine()})`, {
  timeout: 60000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'planr-view-context-browser-'));
  let browser, session;
  try {
    const { file, document } = designFixture(root, {
      count: 2,
      frames: [{ id: 'desktop', label: 'Desktop', width: 600, height: 'auto' }],
    });
    document.layout = {
      boards: {
        'screen-1/desktop/A': { x: 0, y: 0 },
        'screen-2/desktop/A': { x: 800, y: 0 },
      },
    };
    await writeFile(file, `${JSON.stringify(document, null, 2)}\n`);
    for (let index = 1; index <= 2; index++)
      await writeFile(
        join(root, `source/screen-${index}.html`),
        `<!doctype html><html lang="en"><title>Screen ${index}</title><style>body{margin:0!important;padding:0!important}main{height:900px;display:flex!important;flex-direction:column;justify-content:space-between}button{width:200px;height:60px}</style><body><main><h1>Screen ${index}</h1><button data-planr-id="action-${index}">Continue</button></main></body></html>`,
      );
    await renderDesignDocument(file);
    const current = currentDesign(file);
    const boards = current.entries.map(({ screenId, frameId, variantId }) => ({
      screenId,
      frameId,
      variantId,
    }));
    const path = join(root, '.design/view-context.json');
    session = await startDesignReview(file, {
      env: { ...process.env, PLANR_HOME: join(root, 'home') },
      port: 0,
    });
    browser = await launchBrowser({ engine: browserEngine() });
    const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(session.url);
    await page.locator('[data-design-ready="true"]').waitFor();
    await settleStudioChrome(page);
    await page.evaluate(() => {
      const studio = window.__openPlanrDesignStudio;
      studio.setPanels({ navOpen: false, reviewOpen: true });
      studio.fit();
    });
    await page.waitForFunction(
      (ids) => ids.every((id) => window.__openPlanrDesignStudio.getViewport(id).height === 900),
      current.entries.map((entry) => entry.artifactId),
    );
    await page.locator('[data-design-inspect-mode]').click();
    await settleStudioChrome(page);
    await waitForContext(path, (context) => context.visibleScreens.length === 2, { timeout: 5000 });
    const panel = page.locator(
      `[data-artifact-id="${current.entries[0].artifactId}"].planr-artifact-panel`,
    );
    const frame = await (await panel.locator('iframe').elementHandle()).contentFrame();
    const anchor = await frame.locator('[data-planr-id="action-1"]').boundingBox();
    assert.ok(anchor);
    const clickedAt = performance.now();
    await page.mouse.click(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2);
    const inspected = await waitForContext(
      path,
      (context) => context.selected.planrId === 'action-1',
      { since: clickedAt },
    );
    assert.equal(inspected.view, 'canvas');
    assert.equal(inspected.revision, current.revision);
    assert.deepEqual(inspected.selected, { ...boards[0], planrId: 'action-1' });
    assert.deepEqual(inspected.visibleScreens, boards);
    assert.equal(inspected.dirty, false);

    const stage = await page.locator('.planr-stage-scroll').boundingBox();
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    const pannedAt = performance.now();
    await page.mouse.wheel(0, 4000);
    await waitForContext(path, (context) => context.visibleScreens.length === 0, {
      since: pannedAt,
    });
    for (const view of ['prototype', 'walkthrough']) {
      const changedAt = performance.now();
      await page.evaluate((view) => {
        const studio = window.__openPlanrDesignStudio;
        studio.selectScreen('screen-2');
        studio.setView(view);
      }, view);
      const focused = await waitForContext(
        path,
        (context) => context.view === view && context.selected.screenId === 'screen-2',
        { since: changedAt },
      );
      assert.deepEqual(focused.visibleScreens, [boards[1]]);
      assert.deepEqual(focused.selected, { ...boards[1], planrId: null });
    }

    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await session?.close();
    await rm(root, { recursive: true, force: true });
  }
});
