import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { renderDesignDocument } from '../lib/design/document.mjs';
import { designFixture } from './design-fixture.mjs';
import { fetch, startDesignReview } from './studio-http-fixture.mjs';

async function selected(page, screenId) {
  await page.waitForFunction((id) => {
    const studio = window.__openPlanrDesignStudio;
    const stage = window.__openPlanrArtifactStage;
    return (
      studio?.getState().screenId === id &&
      !document.querySelector('[data-design-screen-loading], [data-design-transition]') &&
      stage.getFrame(stage.getState().activeArtifactId).dataset.planrFrameState === 'ready'
    );
  }, screenId);
  assert.equal(await page.locator('.planr-artifact-panel:not([hidden])').count(), 1);
  assert.equal(await page.locator('[data-design-transition-outgoing]').count(), 0);
}

test('view changes retain queued screen choices and the newest pending document', {
  timeout: 45000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-screen-selection-'));
  let session, browser;
  try {
    const { file } = designFixture(root, {
      count: 4,
      frames: [{ id: 'desktop', label: 'Desktop', width: 1000, height: 720 }],
    });
    await renderDesignDocument(file);
    session = await startDesignReview(file, {
      env: { ...process.env, PLANR_HOME: join(root, 'home') },
      port: 0,
    });
    browser = await launchBrowser({ engine: 'chromium' });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(session.url);
    await page.locator('[data-design-ready="true"]').waitFor();
    await page.evaluate(async () => {
      const studio = window.__openPlanrDesignStudio;
      const stage = window.__openPlanrArtifactStage;
      studio.setView('walkthrough');
      const payload = JSON.parse(
        document.getElementById('planr-design-studio-payload').textContent,
      );
      const ids = ['screen-1', 'screen-2', 'screen-3'].map(
        (id) => payload.entries.find((entry) => entry.screenId === id).artifactId,
      );
      await stage.ensureFrames(ids);
    });
    const queued = await page.evaluate(() => {
      const studio = window.__openPlanrDesignStudio;
      studio.selectScreen('screen-2');
      studio.selectScreen('screen-3');
      const before = studio.getState().screenId;
      studio.setView('prototype');
      return before;
    });
    assert.equal(queued, 'screen-2', 'the third screen is queued behind the current transition');
    await selected(page, 'screen-3');

    await page.evaluate(() => window.__openPlanrDesignStudio.selectScreen('screen-1'));
    await selected(page, 'screen-1');
    const pending = await page.evaluate(() => {
      const studio = window.__openPlanrDesignStudio;
      studio.setView('walkthrough');
      studio.selectScreen('screen-2');
      studio.selectScreen('screen-3');
      studio.selectScreen('screen-4');
      const loading = Boolean(document.querySelector('[data-design-screen-loading]'));
      studio.setView('prototype');
      return loading;
    });
    assert.equal(pending, true, 'the latest screen is still loading when the view changes');
    await selected(page, 'screen-4');
    await page.evaluate(() => window.__openPlanrDesignStudio.flush());
    assert.equal(
      (await (await fetch(`${session.url}api/design-state`)).json()).state.screenId,
      'screen-4',
    );
    await page.reload();
    await page.locator('[data-design-ready="true"]').waitFor();
    await selected(page, 'screen-4');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await session?.close();
    await rm(root, { recursive: true, force: true });
  }
});
