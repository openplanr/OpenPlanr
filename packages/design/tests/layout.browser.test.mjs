import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { browserEngine, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { renderDesignDocument } from '../lib/design/document.mjs';
import { designFixture } from './design-fixture.mjs';
import { startDesignReview } from './studio-http-fixture.mjs';
import { settleStudioChrome } from './studio-readiness.mjs';

test(`board layout saves without replacing previews, supports undo and survives reload (${browserEngine()})`, {
  timeout: 60000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-layout-browser-'));
  let browser, session;
  try {
    const { file, document } = designFixture(root, {
      count: 1,
      frames: [{ id: 'desktop', label: 'Desktop', width: 600, height: 450 }],
    });
    const key = 'screen-1/desktop/A';
    const original = { x: 100, y: 90, title: 'Workspace board' };
    document.layout = {
      boards: { [key]: original },
      sections: [{ id: 'workspace', x: -400, y: -180, text: 'Workspace flow', maxW: 360 }],
    };
    writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
    await renderDesignDocument(file);
    session = await startDesignReview(file, {
      env: { ...process.env, PLANR_HOME: join(root, 'home') },
      port: 0,
    });
    browser = await launchBrowser({ engine: browserEngine() });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(session.url);
    await page.locator('[data-design-ready="true"]').waitFor();
    await settleStudioChrome(page);
    const initialRevision = await page.evaluate(() => window.__openPlanrDesignStudio.getRevision());
    const heading = page.getByRole('heading', { name: 'Workspace flow', level: 2, exact: true });
    assert.equal(await heading.isVisible(), true);
    assert.equal(await heading.evaluate((node) => getComputedStyle(node).maxWidth), '360px');
    assert.equal(await heading.evaluate((node) => getComputedStyle(node).pointerEvents), 'none');
    await page.locator('[data-design-fit]').click();
    const stage = await page.locator('.planr-stage-scroll').boundingBox();
    const headingBounds = await heading.boundingBox();
    assert.ok(headingBounds.x >= stage.x && headingBounds.y >= stage.y);
    assert.ok(headingBounds.x + headingBounds.width <= stage.x + stage.width);
    assert.ok(headingBounds.y + headingBounds.height <= stage.y + stage.height);
    assert.equal(await page.locator('[data-design-drag] strong').textContent(), 'Workspace board');

    const frame = page.locator('.planr-artifact-panel iframe');
    const product = await (await frame.elementHandle()).contentFrame();
    await product.getByRole('textbox', { name: 'Workspace name' }).fill('Keep this product draft');
    await page.evaluate(() => {
      window.__layoutPreview = document.querySelector('.planr-artifact-panel iframe');
      window.__layoutStudio = window.__openPlanrDesignStudio;
    });
    const handle = page.locator('[data-design-drag]');
    const bounds = await handle.boundingBox();
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/design-layout') && response.request().method() === 'PUT',
    );
    await page.mouse.move(bounds.x + 50, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 130, bounds.y + bounds.height / 2 + 45, { steps: 8 });
    await page.mouse.up();
    assert.equal((await saved).status(), 200);
    await page.evaluate(() => window.__openPlanrDesignStudio.flush());
    const moved = await page.evaluate(
      (key) => window.__openPlanrDesignStudio.getLayout().boards[key],
      key,
    );
    const movedRevision = await page.evaluate(() => window.__openPlanrDesignStudio.getRevision());
    assert.ok(moved.x > original.x && moved.y > original.y);
    assert.ok(Number.isInteger(moved.x) && Number.isInteger(moved.y));
    assert.equal(moved.title, original.title);
    assert.notEqual(movedRevision, initialRevision);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).layout.boards[key], moved);

    await page.waitForResponse((response) => response.url().endsWith('/api/design-status'));
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.__layoutPreview === document.querySelector('.planr-artifact-panel iframe') &&
          window.__layoutStudio === window.__openPlanrDesignStudio,
      ),
      true,
      'the studio adopts its own layout revision without a page or preview replacement',
    );
    assert.equal(
      await product.getByRole('textbox', { name: 'Workspace name' }).inputValue(),
      'Keep this product draft',
    );
    assert.equal(
      await page.evaluate(() =>
        Object.keys(localStorage).some((key) => {
          const value = localStorage.getItem(key);
          return value && /"(?:positions|boards)"\s*:/.test(value);
        }),
      ),
      false,
      'board coordinates are absent from browser storage',
    );
    assert.equal(
      await page.evaluate(() =>
        Object.hasOwn(window.__openPlanrDesignStudio.getState(), 'positions'),
      ),
      false,
    );

    await handle.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await page.evaluate(() => window.__openPlanrDesignStudio.flush());
    assert.equal(
      await page.evaluate(() => window.__openPlanrDesignStudio.getRevision()),
      initialRevision,
    );
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).layout.boards[key], original);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await page.evaluate(() => window.__openPlanrDesignStudio.flush());
    assert.equal(
      await page.evaluate(() => window.__openPlanrDesignStudio.getRevision()),
      movedRevision,
    );
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).layout.boards[key], moved);

    await page.reload();
    await page.locator('[data-design-ready="true"]').waitFor();
    assert.deepEqual(
      await page.evaluate((key) => window.__openPlanrDesignStudio.getLayout().boards[key], key),
      moved,
    );
    const panel = page.locator('.planr-artifact-panel');
    assert.deepEqual(
      await panel.evaluate((node) => ({
        x: parseFloat(node.style.left),
        y: parseFloat(node.style.top),
      })),
      { x: moved.x, y: moved.y },
    );
    for (const view of ['prototype', 'walkthrough']) {
      await page.locator(`[data-design-view="${view}"]`).click();
      assert.equal(await page.getByText('Workspace flow', { exact: true }).isVisible(), false);
    }
    await page.locator('[data-design-view="canvas"]').click();
    assert.equal(await heading.isVisible(), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await session?.close();
    await rm(root, { recursive: true, force: true });
  }
});
