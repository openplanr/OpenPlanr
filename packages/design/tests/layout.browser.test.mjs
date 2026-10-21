import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { browserEngine, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { renderDesignDocument } from '../lib/design/document.mjs';
import { currentDesign } from '../lib/design/document-state.mjs';
import { designFixture } from './design-fixture.mjs';
import { startDesignReview } from './studio-http-fixture.mjs';
import { settleStudioChrome } from './studio-readiness.mjs';

test(`legacy board positions migrate once from server and local state (${browserEngine()})`, {
  timeout: 60000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-layout-migration-'));
  let browser, session;
  try {
    const { file, document } = designFixture(root, {
      count: 3,
      frames: [{ id: 'desktop', label: 'Desktop', width: 600, height: 450 }],
    });
    const keys = ['screen-1/desktop/A', 'screen-2/desktop/A', 'screen-3/desktop/A'];
    const authored = { x: 450, y: 210, title: 'Authored board' };
    document.layout = {
      boards: {
        'screen-2': { x: 900, y: 300, title: 'Second row' },
        [keys[2]]: authored,
      },
    };
    writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
    await renderDesignDocument(file);
    const current = currentDesign(file);
    const artifactIds = keys.map(
      (key) =>
        current.entries.find(
          ({ screenId, frameId, variantId }) => `${screenId}/${frameId}/${variantId}` === key,
        ).artifactId,
    );
    const stateFile = join(root, '.design/studio-state.json');
    writeFileSync(
      stateFile,
      JSON.stringify({
        state: {
          positions: {
            [artifactIds[0]]: { x: 100.6, y: 90.4 },
            [artifactIds[2]]: { x: -100, y: -100 },
          },
        },
        stateVersion: 7,
        revision: current.revision,
      }),
    );
    session = await startDesignReview(file, {
      env: { ...process.env, PLANR_HOME: join(root, 'home') },
      port: 0,
    });
    browser = await launchBrowser({ engine: browserEngine() });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    page.setDefaultTimeout(10000);
    const layoutRequests = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/design-layout') && request.method() === 'PUT')
        layoutRequests.push(request.postDataJSON());
    });
    await page.addInitScript(
      ({ artifactIds, storageKey }) => {
        if (sessionStorage.getItem('layout-migration-seeded')) return;
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            state: {
              positions: {
                [artifactIds[0]]: { x: 700, y: 700 },
                [artifactIds[1]]: { x: 200.2, y: 180.6 },
                [artifactIds[2]]: { x: 800, y: 800 },
              },
            },
          }),
        );
        sessionStorage.setItem('layout-migration-seeded', 'true');
      },
      { artifactIds, storageKey: 'openplanr.design-studio.operations' },
    );
    const stateLoaded = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/design-state') && response.request().method() === 'GET',
    );
    await page.goto(session.url);
    await (await stateLoaded).finished();
    await page.locator('[data-design-ready="true"]').waitFor();
    await settleStudioChrome(page);
    await page.evaluate(() => window.__openPlanrDesignStudio.flush());
    const migrated = await page.evaluate(
      (keys) => keys.map((key) => window.__openPlanrDesignStudio.getLayout().boards[key]),
      keys,
    );
    assert.deepEqual(
      migrated.map((point) => point && { x: point.x, y: point.y }),
      [
        { x: 101, y: 90 },
        { x: 200, y: 181 },
        { x: authored.x, y: authored.y },
      ],
      'server coordinates win, local coordinates fill absent exact keys, and authored coordinates remain',
    );
    assert.equal(layoutRequests.length, 1, 'all legacy positions use one layout revision');
    const saved = JSON.parse(readFileSync(file, 'utf8')).layout.boards;
    for (const [index, key] of keys.entries()) assert.deepEqual(saved[key], migrated[index]);
    assert.deepEqual(saved[keys[2]], authored);
    for (const [index, artifactId] of artifactIds.entries()) {
      const panel = page.locator(`.planr-artifact-panel[data-artifact-id="${artifactId}"]`);
      assert.deepEqual(
        await panel.evaluate((node) => ({
          x: parseFloat(node.style.left),
          y: parseFloat(node.style.top),
        })),
        { x: migrated[index].x, y: migrated[index].y },
      );
    }
    assert.equal(
      await page.evaluate(() => {
        const draft = JSON.parse(localStorage.getItem('openplanr.design-studio.operations'));
        return Object.hasOwn(draft.state, 'positions');
      }),
      false,
      'a successful migration removes legacy coordinates from the stored local draft',
    );
    await page.evaluate(async () => {
      window.__openPlanrDesignStudio.setPanels({ navOpen: false });
      await window.__openPlanrDesignStudio.flush();
    });
    assert.equal(
      Object.hasOwn(JSON.parse(readFileSync(stateFile, 'utf8')).state, 'positions'),
      false,
      'the next personal state save removes legacy coordinates from the server state',
    );
    await page.reload();
    await page.locator('[data-design-ready="true"]').waitFor();
    await settleStudioChrome(page);
    await page.evaluate(() => window.__openPlanrDesignStudio.flush());
    assert.equal(layoutRequests.length, 1, 'a reload does not migrate again');
    assert.deepEqual(
      await page.evaluate(
        (keys) => keys.map((key) => window.__openPlanrDesignStudio.getLayout().boards[key]),
        keys,
      ),
      migrated,
    );
  } finally {
    await browser?.close();
    await session?.close();
    await rm(root, { recursive: true, force: true });
  }
});

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
    await settleStudioChrome(page);
    const stage = await page.locator('.planr-stage-scroll').boundingBox();
    const headingBounds = await heading.boundingBox();
    assert.ok(
      headingBounds.x >= stage.x && headingBounds.y >= stage.y,
      `Section starts inside the stage: ${JSON.stringify({ headingBounds, stage })}`,
    );
    assert.ok(
      headingBounds.x + headingBounds.width <= stage.x + stage.width,
      `Section ends inside the stage horizontally: ${JSON.stringify({ headingBounds, stage })}`,
    );
    assert.ok(
      headingBounds.y + headingBounds.height <= stage.y + stage.height,
      `Section ends inside the stage vertically: ${JSON.stringify({ headingBounds, stage })}`,
    );
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
    assert.ok(
      moved.x > original.x && moved.y > original.y,
      `Board moves with the drag: ${JSON.stringify({ moved, original })}`,
    );
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

test(`canvas engine preserves legacy fit, zoom anchors, saved cameras and board layout (${browserEngine()})`, {
  timeout: 60000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-canvas-engine-'));
  let browser, session;
  try {
    const { file } = designFixture(root, {
      frames: [{ id: 'desktop', label: 'Desktop', width: 600, height: 450 }],
    });
    await renderDesignDocument(file);
    session = await startDesignReview(file, {
      env: { ...process.env, PLANR_HOME: join(root, 'home') },
      port: 0,
    });
    browser = await launchBrowser({ engine: browserEngine() });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(session.url);
    await page.locator('[data-design-ready="true"]').waitFor();
    await settleStudioChrome(page);
    const stage = page.locator('.planr-stage-scroll');
    assert.equal(await stage.getAttribute('aria-roledescription'), 'canvas');
    await page.locator('[data-design-fit]').click();
    const fitted = await page.evaluate(() => {
      const stage = document.querySelector('.planr-stage-scroll');
      const panels = [...document.querySelectorAll('.planr-artifact-panel:not([hidden])')];
      const minX = Math.min(...panels.map((panel) => parseFloat(panel.style.left)));
      const minY = Math.min(...panels.map((panel) => parseFloat(panel.style.top) - 64));
      const maxX = Math.max(...panels.map((panel) => parseFloat(panel.style.left) + 600));
      const maxY = Math.max(...panels.map((panel) => parseFloat(panel.style.top) + 450));
      const zoom = Math.max(
        0.05,
        Math.min(
          1,
          (stage.clientWidth - 96) / (maxX - minX),
          (stage.clientHeight - 96) / (maxY - minY),
        ),
      );
      window.engineFrames = panels.flatMap((panel) => {
        const frame = panel.querySelector('iframe');
        return frame ? [{ frame, parent: frame.parentElement }] : [];
      });
      return {
        actual: window.__openPlanrDesignStudio.getState(),
        expected: {
          zoom,
          x: (stage.clientWidth - (maxX - minX) * zoom) / 2 - minX * zoom,
          y: (stage.clientHeight - (maxY - minY) * zoom) / 2 - minY * zoom,
        },
      };
    });
    assert.ok(
      await page.evaluate(() => window.engineFrames.length > 0),
      'At least one preview is loaded',
    );
    assert.ok(Math.abs(fitted.actual.zoom - fitted.expected.zoom) < 0.00001);
    assert.ok(Math.abs(fitted.actual.camera.x - fitted.expected.x) < 1);
    assert.ok(Math.abs(fitted.actual.camera.y - fitted.expected.y) < 1);
    const box = await stage.boundingBox();
    const point = { x: box.width * 0.7, y: box.height * 0.6 };
    await page.mouse.move(box.x + point.x, box.y + point.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -30);
    await page.keyboard.up('Control');
    await page.waitForFunction(
      (zoom) => window.__openPlanrDesignStudio.getState().zoom > zoom,
      fitted.actual.zoom,
    );
    const zoomed = await page.evaluate(() => window.__openPlanrDesignStudio.getState());
    assert.ok(Math.abs(zoomed.zoom - fitted.actual.zoom * 1.25) < 0.00001);
    for (const axis of ['x', 'y']) {
      const before = (point[axis] - fitted.actual.camera[axis]) / fitted.actual.zoom;
      const after = (point[axis] - zoomed.camera[axis]) / zoomed.zoom;
      assert.ok(Math.abs(after - before) < 1, `${axis} wheel anchor stays fixed`);
    }
    await page.locator('[data-design-fit]').click();
    await page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await window.__openPlanrDesignStudio.flush();
    });
    const savedCamera = await page.evaluate(() => window.__openPlanrDesignStudio.getState());
    assert.equal(
      await page.evaluate(() =>
        window.engineFrames.every(
          ({ frame, parent }) => frame.isConnected && frame.parentElement === parent,
        ),
      ),
      true,
    );
    await page.reload();
    await page.locator('[data-design-ready="true"]').waitFor();
    await settleStudioChrome(page);
    const restored = await page.evaluate(() => window.__openPlanrDesignStudio.getState());
    for (const axis of ['x', 'y'])
      assert.ok(Math.abs(restored.camera[axis] - savedCamera.camera[axis]) < 0.00001);
    assert.equal(restored.zoom, savedCamera.zoom);
    const handle = page.locator('[data-design-drag]').first();
    const bounds = await handle.boundingBox();
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/design-layout') && response.request().method() === 'PUT',
    );
    await page.mouse.move(bounds.x + 50, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 110, bounds.y + bounds.height / 2 + 30, { steps: 6 });
    await page.mouse.up();
    assert.equal((await saved).status(), 200);
    await page.evaluate(() => window.__openPlanrDesignStudio.flush());
    const moved = await page.evaluate(
      () => window.__openPlanrDesignStudio.getLayout().boards['screen-1/desktop/A'],
    );
    assert.ok(moved.x > 0 && moved.y > 72);
    assert.deepEqual(
      JSON.parse(readFileSync(file, 'utf8')).layout.boards['screen-1/desktop/A'],
      moved,
    );
    for (const view of ['prototype', 'walkthrough']) {
      await page.locator(`[data-design-view="${view}"]`).click();
      assert.equal(await stage.getAttribute('aria-roledescription'), null);
    }
    await page.locator('[data-design-view="canvas"]').click();
    assert.equal(await stage.getAttribute('aria-roledescription'), 'canvas');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await session?.close();
    await rm(root, { recursive: true, force: true });
  }
});
