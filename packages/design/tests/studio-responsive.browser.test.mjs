import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { browserEngine, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { currentDesign, renderDesignDocument } from '../lib/design/document.mjs';
import { startDesignReview } from '../lib/design/review.mjs';
import { designFixture } from './design-fixture.mjs';

test('93 logical screens at five widths stay bounded and preserve deep links across refresh and back', {
  timeout: 45000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-studio-responsive-'));
  let browser, session;
  try {
    const frames = [390, 768, 1024, 1280, 1440].map((width) => ({
      id: `width-${width}`,
      label: `${width} pixels`,
      width,
      height: 1024,
    }));
    const { file, document } = designFixture(root, { count: 93, frames });
    document.defaultView = 'prototype';
    writeFileSync(file, JSON.stringify(document));
    await renderDesignDocument(file);
    const current = currentDesign(file);
    assert.equal(current.envelope.sources.length, 93);
    assert.equal(current.envelope.artifacts.length, 465);
    assert.ok(current.envelope.artifacts.every((artifact) => !Object.hasOwn(artifact, 'html')));
    session = await startDesignReview(file, {
      env: { ...process.env, PLANR_HOME: join(root, 'home') },
      noOpen: true,
    });
    browser = await launchBrowser({ engine: browserEngine() });
    const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
    page.setDefaultTimeout(10000);
    await page.goto(session.url);
    await page.waitForSelector('[data-design-ready="true"]');
    assert.equal(await page.locator('.planr-artifact-panel').count(), 465);
    assert.equal(
      await page.evaluate(() => {
        const stage = window.__openPlanrArtifactStage;
        window.responsiveFrames = [...document.querySelectorAll('.planr-artifact-panel')].map(
          (panel) => ({
            id: panel.dataset.artifactId,
            frame: stage.getFrame(panel.dataset.artifactId),
          }),
        );
        return new Set(window.responsiveFrames.map(({ frame }) => frame)).size;
      }),
      465,
      'all logical views retain distinct registry frame nodes',
    );
    assert.equal(await page.locator('.planr-artifact-panel iframe').count(), 1);
    assert.equal(await page.evaluate(() => window.length), 1);
    assert.equal(await page.locator('[data-design-screen]').count(), 93);
    const loaded = () => page.locator('iframe[src], iframe[srcdoc]').count();
    assert.equal(await loaded(), 1, 'prototype startup loads the active source only');
    await page.locator('[data-design-view="canvas"]').click();
    await page.locator('[data-design-screen="screen-2"]').click();
    await page.waitForFunction(
      () => window.__openPlanrDesignStudio.getState().screenId === 'screen-2',
    );
    const activePanel = page.locator('.planr-artifact-panel[data-design-active="true"]');
    const beforePan = await activePanel.boundingBox();
    const cameraBeforePan = await page.evaluate(
      () => window.__openPlanrDesignStudio.getState().camera,
    );
    await page.locator('[data-design-pan]').click();
    const stageBounds = await page.locator('.planr-stage-scroll').boundingBox();
    const panStart = {
      x: stageBounds.x + stageBounds.width - 160,
      y: stageBounds.y + stageBounds.height - 180,
    };
    await page.mouse.move(panStart.x, panStart.y);
    await page.mouse.down();
    await page.mouse.move(panStart.x + 80, panStart.y + 45, { steps: 8 });
    await page.mouse.up();
    await page.locator('[data-design-pan]').click();
    const cameraAfterPan = await page.evaluate(
      () => window.__openPlanrDesignStudio.getState().camera,
    );
    assert.equal(cameraAfterPan.x, cameraBeforePan.x + 80);
    assert.equal(cameraAfterPan.y, cameraBeforePan.y + 45);
    const afterPan = await activePanel.boundingBox();
    assert.ok(Math.abs(afterPan.x - beforePan.x - 80) < 2);
    assert.ok(Math.abs(afterPan.y - beforePan.y - 45) < 2);
    await page.locator('[data-design-zoom="in"]').click();
    assert.ok((await activePanel.boundingBox()).width > afterPan.width);
    for (const width of [1440, 768]) {
      await page.getByLabel('Responsive frame').selectOption(`width-${width}`);
      await page.locator('[data-design-screen="screen-1"]').click();
      await page.locator('[data-design-screen="screen-93"]').click();
      await page.waitForFunction(
        () => window.__openPlanrDesignStudio.getState().screenId === 'screen-93',
      );
      const selected = current.entries.find(
        (entry) => entry.screenId === 'screen-93' && entry.frameId === `width-${width}`,
      );
      const product = page.frameLocator(`[data-artifact-id="${selected.artifactId}"] iframe`);
      await product.getByRole('heading', { name: 'Step 93', exact: true }).waitFor();
      assert.equal(await product.locator('body').evaluate(() => innerWidth), width);
      assert.ok((await loaded()) <= 3);
      assert.ok((await page.evaluate(() => window.length)) <= 3);
      assert.equal(
        await page.evaluate(() =>
          window.responsiveFrames.every(
            ({ id, frame }) => window.__openPlanrArtifactStage.getFrame(id) === frame,
          ),
        ),
        true,
      );
    }
    await page.locator('[data-design-view="prototype"]').click();
    await page.locator('[data-design-screen="screen-93"]').click();
    await page.waitForFunction(
      () => window.__openPlanrDesignStudio.getState().screenId === 'screen-93',
    );
    for (const frame of frames) {
      await page.getByLabel('Responsive frame').selectOption(frame.id);
      await page.waitForFunction(
        (id) => window.__openPlanrDesignStudio.getState().frameId === id,
        frame.id,
      );
      const product = page.frameLocator('.planr-artifact-panel:not([hidden]) iframe');
      await product.getByRole('heading', { name: 'Step 93', exact: true }).waitFor();
      assert.equal(await product.locator('body').evaluate(() => innerWidth), frame.width);
      assert.ok((await loaded()) <= 3);
      assert.equal(
        await page.evaluate(() =>
          window.responsiveFrames.every(
            ({ id, frame }) => frame && window.__openPlanrArtifactStage.getFrame(id) === frame,
          ),
        ),
        true,
      );
      assert.ok((await page.locator('.planr-artifact-panel iframe').count()) <= 3);
      assert.ok((await page.evaluate(() => window.length)) <= 3);
      assert.equal(
        await page.locator('.planr-artifact-panel:not([hidden]) iframe').getAttribute('sandbox'),
        'allow-scripts allow-forms',
      );
    }
    const deepLink = page.url();
    assert.match(deepLink, /#screen=screen-93&frame=width-1440&direction=A&view=prototype$/);
    await page.reload();
    await page.waitForSelector('[data-design-ready="true"]');
    assert.equal(
      await page.evaluate(() => window.__openPlanrDesignStudio.getState().screenId),
      'screen-93',
    );
    assert.equal(
      await page.evaluate(() => window.__openPlanrDesignStudio.getState().frameId),
      'width-1440',
    );
    await page.getByLabel('Search screens', { exact: true }).fill('Step 92');
    assert.equal(await page.locator('[data-design-screen]:visible').count(), 1);
    await page.locator('[data-design-screen="screen-92"]').click();
    await page.waitForFunction(
      () => window.__openPlanrDesignStudio.getState().screenId === 'screen-92',
    );
    await page.goBack();
    await page.waitForFunction(
      () => window.__openPlanrDesignStudio.getState().screenId === 'screen-93',
    );
    assert.equal(page.url(), deepLink);
    assert.ok((await loaded()) <= 3);
  } finally {
    await browser?.close();
    await session?.close();
    await rm(root, { recursive: true, force: true });
  }
});
