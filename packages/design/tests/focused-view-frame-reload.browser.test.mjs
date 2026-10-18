import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { browserEngine, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { renderDesignDocument } from '../lib/design/document.mjs';
import { designFixture } from './design-fixture.mjs';
import { startDesignReview } from './studio-http-fixture.mjs';

const engine = browserEngine();

async function productFrame(page, artifactId) {
  await page.waitForFunction((id) => {
    const frame = document.querySelector(`[data-planr-artifact-frame="${id}"]`);
    return (
      frame?.dataset.planrFrameState === 'ready' &&
      frame.dataset.planrBridgeTrusted === 'true' &&
      !document.querySelector('[data-design-screen-loading]')
    );
  }, artifactId);
  return (
    await page.locator(`[data-planr-artifact-frame="${artifactId}"]`).elementHandle()
  ).contentFrame();
}

// Locator clicks misplace pointers across a scaled sandboxed frame; click its real screen point.
async function clickProductButton(page, frame, artifactId, name) {
  const button = frame.getByRole('button', { name, exact: true });
  const position = await button.evaluate((node) => ({
    rect: node.getBoundingClientRect().toJSON(),
    width: innerWidth,
    height: innerHeight,
  }));
  const bounds = await page.locator(`[data-planr-artifact-frame="${artifactId}"]`).boundingBox();
  await page.mouse.click(
    bounds.x + ((position.rect.x + position.rect.width / 2) * bounds.width) / position.width,
    bounds.y + ((position.rect.y + position.rect.height / 2) * bounds.height) / position.height,
  );
}

async function productState(frame) {
  return frame.evaluate(() => ({
    marked: window.__sameDocument === true,
    value: document.querySelector('input').value,
    scrollY,
  }));
}

test(`a focused view reloads only a frame that stayed live through Canvas comments (${engine})`, {
  timeout: 90000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-focused-reload-'));
  let browser, session;
  try {
    const { file, document } = designFixture(root, { count: 2 });
    writeFileSync(
      join(root, document.screens[0].source.html),
      `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><label>Workspace name <input aria-label="Workspace name" value="Product team"></label>
      <button data-planr-id="action-1" onclick="document.getElementById('saved').textContent='Product saved'">Save product</button>
      <p id="saved">Unsaved</p><div style="height:2400px">Long product content</div></body></html>`,
    );
    const rendered = await renderDesignDocument(file);
    session = await startDesignReview(file, {
      env: { ...process.env, PLANR_HOME: join(root, 'home') },
      port: 0,
    });
    browser = await launchBrowser({ engine });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    page.setDefaultTimeout(15000);
    for (const [host, url] of [
      ['portable', pathToFileURL(rendered.views.canvas).href],
      ['local', session.url],
    ]) {
      await page.goto(url);
      await page.waitForSelector('[data-design-ready="true"]');
      await page.locator('[data-design-view="prototype"]').click();
      const artifactId = await page
        .locator('.planr-artifact-panel:not([hidden]) iframe')
        .getAttribute('data-planr-artifact-frame');

      let frame = await productFrame(page, artifactId);
      await frame.evaluate(() => {
        window.__sameDocument = true;
      });
      await frame.getByRole('textbox', { name: 'Workspace name' }).fill('Typed in Prototype');
      await frame.evaluate(() => scrollTo(0, 400));
      await page.locator('[data-design-view="walkthrough"]').click();
      await page.locator('[data-design-view="canvas"]').click();
      await page.locator('[data-design-view="prototype"]').click();
      frame = await productFrame(page, artifactId);
      assert.deepEqual(
        await productState(frame),
        { marked: true, value: 'Typed in Prototype', scrollY: 400 },
        `${host}: ordinary view switches keep the product document, typed input and scroll`,
      );

      await page.locator('[data-design-view="canvas"]').click();
      await page.locator('[data-planr-mode="comment"]').click();
      await page.locator('[data-design-view="prototype"]').click();
      frame = await productFrame(page, artifactId);
      assert.equal(
        (await productState(frame)).marked,
        false,
        `${host}: a frame that stayed live through Canvas comments gets a fresh document`,
      );
      await frame.evaluate(() => scrollTo(0, 0));
      await clickProductButton(page, frame, artifactId, 'Save product');
      await frame.getByText('Product saved', { exact: true }).waitFor();

      await frame.evaluate(() => {
        window.__sameDocument = true;
      });
      await page.locator('[data-design-view="walkthrough"]').click();
      frame = await productFrame(page, artifactId);
      assert.equal(
        (await productState(frame)).marked,
        true,
        `${host}: the reload happens once, not on every later switch`,
      );

      await page.locator('[data-design-view="canvas"]').click();
      await page.locator('[data-planr-mode="comment"]').click();
      await page.locator('[data-design-view="prototype"]').click();
      await page.evaluate(() => window.__openPlanrDesignStudio.selectScreen('screen-2'));
      await page.waitForFunction(
        () =>
          window.__openPlanrDesignStudio.getState().screenId === 'screen-2' &&
          !document.querySelector('[data-design-screen-loading]'),
      );
      await page.evaluate(() => window.__openPlanrDesignStudio.selectScreen('screen-1'));
      await productFrame(page, artifactId);
    }
  } finally {
    await browser?.close();
    await session?.close();
    await rm(root, { recursive: true, force: true });
  }
});
