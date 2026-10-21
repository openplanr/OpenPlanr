import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { browserEngine, launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { auditDesignPage } from '../lib/design/browser-audit.mjs';
import { renderDesignDocument } from '../lib/design/document.mjs';
import { currentDesign } from '../lib/design/document-state.mjs';
import { designFixture } from './design-fixture.mjs';
import { startDesignReview } from './studio-http-fixture.mjs';
import { settleStudioChrome } from './studio-readiness.mjs';

async function dragBoard(page) {
  const bounds = await page.locator('[data-design-drag]').first().boundingBox();
  await page.mouse.move(bounds.x + 50, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 130, bounds.y + bounds.height / 2 + 45, { steps: 8 });
  await page.mouse.up();
  await page.evaluate(() => window.__openPlanrDesignStudio.flush());
}

async function pendingLayout(page) {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('openplanr.design-studio.operations')).pendingLayout,
  );
}

async function assertCanvasLabels(
  page,
  selector = '.planr-artifact-panel:not([hidden]) .design-artboard-label',
) {
  const geometry = await page.evaluate((selector) => {
    const rect = (node) => node.getBoundingClientRect().toJSON();
    return {
      stage: rect(document.querySelector('.planr-stage-scroll')),
      chrome: [
        ...document.querySelectorAll(
          '.design-toolbar,.design-stage-context,.design-canvas-tools,.design-navigator,.planr-review-rail',
        ),
      ]
        .filter((node) => !node.inert && node.getAttribute('aria-hidden') !== 'true')
        .map(rect),
      labels: [...document.querySelectorAll(selector)].map(rect),
    };
  }, selector);
  assert.ok(geometry.labels.length > 0);
  for (const label of geometry.labels) {
    const details = JSON.stringify({ label, ...geometry });
    assert.ok(
      label.left >= geometry.stage.left - 1 && label.right <= geometry.stage.right + 1,
      `Title stays inside the stage horizontally: ${details}`,
    );
    assert.ok(
      label.top >= geometry.stage.top - 1 && label.bottom <= geometry.stage.bottom + 1,
      `Title stays inside the stage vertically: ${details}`,
    );
    for (const chrome of geometry.chrome)
      assert.equal(
        label.left < chrome.right &&
          label.right > chrome.left &&
          label.top < chrome.bottom &&
          label.bottom > chrome.top,
        false,
        `Title clears chrome: ${details}`,
      );
  }
}

test(`reloaded board gestures prevent native zoom and retain direct interaction (${browserEngine()})`, {
  timeout: 60000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-board-gestures-'));
  let browser, session;
  try {
    const { file } = designFixture(root, {
      count: 2,
      frames: [{ id: 'desktop', label: 'Desktop', width: 600, height: 450 }],
    });
    await renderDesignDocument(file);
    session = await startDesignReview(file, {
      env: { ...process.env, PLANR_HOME: join(root, 'home') },
      port: 0,
    });
    browser = await launchBrowser({ engine: browserEngine() });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(10000);
    await page.addInitScript(() => {
      if (window === top) return;
      window.boardWheelPrevention = [];
      addEventListener(
        'wheel',
        (event) => {
          // The bridge stops propagation; observe cancellation after its capture handler runs.
          setTimeout(
            () =>
              window.boardWheelPrevention.push({
                trusted: event.isTrusted,
                cancelable: event.cancelable,
                prevented: event.defaultPrevented,
              }),
            0,
          );
        },
        { capture: true, passive: true },
      );
    });
    await page.goto(session.url);
    await page.locator('[data-design-ready="true"]').waitFor();
    await page.evaluate(() => {
      window.__openPlanrDesignStudio.setPanels({ navOpen: false, reviewOpen: false });
      window.__openPlanrDesignStudio.fit();
    });
    await settleStudioChrome(page);
    const frame = page.locator('.planr-artifact-panel[data-design-active="false"] iframe').first();
    await frame.locator('..').locator('iframe[data-planr-frame-state="ready"]').waitFor();
    const artifactId = await frame.getAttribute('data-planr-artifact-frame');
    await page.evaluate((id) => window.__openPlanrArtifactStage.retryFrames([id]), artifactId);
    await page.waitForFunction((id) => {
      const frame = window.__openPlanrArtifactStage.getFrame(id);
      return (
        frame.dataset.planrFrameState === 'ready' && frame.dataset.planrBridgeTrusted === 'true'
      );
    }, artifactId);
    const product = await (await frame.elementHandle()).contentFrame();
    await product.evaluate(() => {
      window.receivedWheels = 0;
      addEventListener('wheel', () => window.receivedWheels++);
    });
    const baseline = await page.evaluate(() => ({
      dpr: devicePixelRatio,
      scale: visualViewport.scale,
    }));
    const readState = () => page.evaluate(() => window.__openPlanrDesignStudio.getState());
    const assertWheelPrevented = async (count) => {
      await product.waitForFunction((count) => window.boardWheelPrevention.length > count, count);
      assert.deepEqual(
        await product.evaluate(() => window.boardWheelPrevention.at(-1)),
        {
          trusted: true,
          cancelable: true,
          prevented: true,
        },
        'the reloaded frame cancels native zoom at the event source',
      );
    };
    const pointer = async () => {
      const box = await frame.boundingBox();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    for (const modifier of ['Control', 'Meta', 'cdp']) {
      if (modifier === 'cdp' && browserEngine() !== 'chromium') continue;
      const point = await pointer();
      const stage = await page.locator('.planr-stage-scroll').boundingBox();
      const before = await readState();
      const wheelCount = await product.evaluate(() => window.boardWheelPrevention.length);
      await page.mouse.move(point.x, point.y);
      if (modifier === 'cdp') {
        const cdp = await page.context().newCDPSession(page);
        try {
          await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            ...point,
            deltaX: 0,
            deltaY: -10,
            modifiers: 2,
          });
        } finally {
          await cdp.detach();
        }
      } else {
        await page.keyboard.down(modifier);
        await page.mouse.wheel(0, -10);
        await page.keyboard.up(modifier);
      }
      await assertWheelPrevented(wheelCount);
      await page.waitForFunction(
        (zoom) => window.__openPlanrDesignStudio.getState().zoom > zoom,
        before.zoom,
      );
      const after = await readState();
      assert.ok(Math.abs(after.zoom - before.zoom * Math.exp(0.1)) < 0.00001);
      for (const axis of ['x', 'y']) {
        const local = point[axis] - stage[axis];
        assert.ok(
          Math.abs(
            (local - before.camera[axis]) / before.zoom - (local - after.camera[axis]) / after.zoom,
          ) < 1,
          `${modifier}: cursor anchor`,
        );
      }
      assert.deepEqual(
        await page.evaluate(() => ({ dpr: devicePixelRatio, scale: visualViewport.scale })),
        baseline,
        `${modifier}: browser zoom stays unchanged`,
      );
      assert.equal(baseline.scale, 1);
    }
    const point = await pointer();
    const before = await readState();
    const wheelCount = await product.evaluate(() => window.boardWheelPrevention.length);
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(24, 36);
    await assertWheelPrevented(wheelCount);
    await page.waitForFunction(
      (y) => window.__openPlanrDesignStudio.getState().camera.y < y,
      before.camera.y,
    );
    const after = await readState();
    assert.equal(after.zoom, before.zoom);
    assert.ok(Math.abs(after.camera.x - before.camera.x + 24) < 1);
    assert.ok(Math.abs(after.camera.y - before.camera.y + 36) < 1);
    assert.equal(await product.evaluate(() => window.receivedWheels), 0);
    assert.equal(
      await frame.locator('..').locator('..').getAttribute('data-design-active'),
      'false',
    );
    await product.getByRole('button', { name: 'Save workspace', exact: true }).click();
    await product.getByRole('button', { name: 'Saved', exact: true }).waitFor();
  } finally {
    await browser?.close();
    await session?.close();
    await rm(root, { recursive: true, force: true });
  }
});

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
    const readyRequests = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/design-layout') && request.method() === 'PUT')
        layoutRequests.push(request.postDataJSON());
      if (request.url().endsWith('/api/design-ready') && request.method() === 'POST')
        readyRequests.push(request.postDataJSON());
    });
    await page.addInitScript(
      ({ artifactIds, storageKey }) => {
        window.__migrationStatuses = [];
        new MutationObserver(() => {
          const text = document.querySelector('[data-design-save-state]')?.textContent;
          if (text) window.__migrationStatuses.push(text);
        }).observe(document, { childList: true, characterData: true, subtree: true });
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
    const readiness = page.waitForResponse((response) =>
      response.url().endsWith('/api/design-ready'),
    );
    await page.goto(session.url);
    await (await stateLoaded).finished();
    await page.locator('[data-design-ready="true"]').waitFor();
    await settleStudioChrome(page);
    await page.evaluate(() => window.__openPlanrDesignStudio.flush());
    assert.equal((await readiness).status(), 200, 'migration readiness uses the adopted revision');
    assert.equal(readyRequests.length, 1);
    assert.equal(readyRequests[0].revision, currentDesign(file).revision);
    assert.deepEqual(
      await page.evaluate(() =>
        window.__migrationStatuses.filter((text) => /disconnected/i.test(text)),
      ),
      [],
      'migration does not flash a disconnected status',
    );
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
    const headingWidth = await heading.evaluate((node) => node.getBoundingClientRect().width);
    assert.ok(headingWidth <= 360, `Section screen width ${headingWidth} exceeds maxW 360`);
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

test(`a failed layout retains Retry through view context failures and recovers in the same session (${browserEngine()})`, {
  timeout: 60000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-layout-retry-'));
  let browser, session;
  try {
    const { file } = designFixture(root, {
      count: 1,
      frames: [{ id: 'desktop', label: 'Desktop', width: 600, height: 450 }],
    });
    await renderDesignDocument(file);
    session = await startDesignReview(file, {
      env: { ...process.env, PLANR_HOME: join(root, 'home') },
      port: 0,
    });
    browser = await launchBrowser({ engine: browserEngine() });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    page.setDefaultTimeout(10000);
    await page.goto(session.url);
    await page.locator('[data-design-ready="true"]').waitFor();
    await settleStudioChrome(page);
    await page.evaluate(() => window.__openPlanrDesignStudio.flush());
    await page.route('**/api/design-layout', (route) => route.abort('connectionrefused'));
    await page.route('**/api/design-view-context', (route) => route.abort('connectionrefused'));
    const contextFailed = page.waitForEvent('requestfailed', {
      predicate: (request) => request.url().endsWith('/api/design-view-context'),
    });
    await dragBoard(page);
    await contextFailed;
    await settleStudioChrome(page);
    await page.waitForFunction(() =>
      document.querySelector('[data-design-notice-message]').textContent.includes('Board layout'),
    );
    assert.equal(await page.locator('[data-design-retry-layout]').isVisible(), true);
    assert.notEqual(
      await page.locator('[data-design-save-state]').textContent(),
      'All changes saved',
    );
    assert.equal((await pendingLayout(page)).operations.length, 1);
    const moved = await page.evaluate(
      () => window.__openPlanrDesignStudio.getLayout().boards['screen-1/desktop/A'],
    );
    await page.unroute('**/api/design-layout');
    await page.unroute('**/api/design-view-context');
    const saved = page.waitForResponse((response) => response.url().endsWith('/api/design-layout'));
    await page.locator('[data-design-retry-layout]').click();
    assert.equal((await saved).status(), 200);
    await page.evaluate(() => window.__openPlanrDesignStudio.flush());
    assert.deepEqual(
      JSON.parse(readFileSync(file, 'utf8')).layout.boards['screen-1/desktop/A'],
      moved,
    );
    assert.equal(await pendingLayout(page), undefined);
    await page.waitForFunction(
      () => document.querySelector('[data-design-save-state]').textContent === 'All changes saved',
    );
    assert.equal(await page.locator('[data-design-retry-layout]').count(), 0);
  } finally {
    await browser?.close();
    await session?.close();
    await rm(root, { recursive: true, force: true });
  }
});

for (const foreignContent of [false, true]) {
  test(`a stopped studio preserves a move across restart and ${foreignContent ? 'drops it for changed authored content' : 'replays it against the new revision'} (${browserEngine()})`, {
    timeout: 60000,
  }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'openplanr-layout-restart-'));
    let browser, session, releaseReplay;
    try {
      const { file, document } = designFixture(root, {
        count: 1,
        frames: [{ id: 'desktop', label: 'Desktop', width: 600, height: 450 }],
      });
      await renderDesignDocument(file);
      const env = { ...process.env, PLANR_HOME: join(root, 'home') };
      session = await startDesignReview(file, { env, port: 0 });
      const port = Number(new URL(session.url).port);
      browser = await launchBrowser({ engine: browserEngine() });
      const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
      page.setDefaultTimeout(10000);
      await page.goto(session.url);
      await page.locator('[data-design-ready="true"]').waitFor();
      await settleStudioChrome(page);
      await page.evaluate(() => window.__openPlanrDesignStudio.flush());
      const basedOn = await page.evaluate(() => window.__openPlanrDesignStudio.getRevision());
      await session.close();
      session = null;
      const contextFailed = page.waitForEvent('requestfailed', {
        predicate: (request) => request.url().endsWith('/api/design-view-context'),
      });
      await dragBoard(page);
      await contextFailed;
      await settleStudioChrome(page);
      await page.waitForFunction(() =>
        document.querySelector('[data-design-notice-message]').textContent.includes('Board layout'),
      );
      assert.equal(await page.locator('[data-design-retry-layout]').isVisible(), true);
      assert.notEqual(
        await page.locator('[data-design-save-state]').textContent(),
        'All changes saved',
      );
      const moved = await page.evaluate(
        () => window.__openPlanrDesignStudio.getLayout().boards['screen-1/desktop/A'],
      );
      const stored = await pendingLayout(page);
      assert.equal(stored.operations.length, 1);
      assert.equal(stored.operations[0].revision, basedOn);
      assert.deepEqual(stored.operations[0].boards['screen-1/desktop/A'], moved);
      const retryFailed = page.waitForEvent('requestfailed', {
        predicate: (request) => request.url().endsWith('/api/design-layout'),
      });
      await page.locator('[data-design-retry-layout]').click();
      await retryFailed;
      await settleStudioChrome(page);
      assert.notEqual(
        await page.locator('[data-design-save-state]').textContent(),
        'All changes saved',
      );
      assert.deepEqual(await pendingLayout(page), stored);

      document.layout = { boards: { 'screen-1/desktop/A': { x: -300, y: 400 } } };
      if (foreignContent) document.title = 'Updated operations workspace';
      writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
      await renderDesignDocument(file);
      const restartedRevision = currentDesign(file).revision;
      assert.notEqual(restartedRevision, basedOn);
      if (foreignContent)
        await page.route('**/api/design-status', (route) => route.abort('connectionrefused'));
      const oldSessionGone = page.waitForResponse(
        (response) =>
          response.url().endsWith(foreignContent ? '/api/design-layout' : '/api/design-status') &&
          response.status() === 404,
      );
      session = await startDesignReview(file, { env, port });
      if (foreignContent) await page.locator('[data-design-retry-layout]').click();
      await oldSessionGone;
      if (foreignContent) await page.unroute('**/api/design-status');
      await page.locator('[data-design-reload-studio]').waitFor();
      assert.match(
        await page.locator('[data-design-notice-message]').textContent(),
        /studio restarted/i,
      );
      assert.notEqual(
        await page.locator('[data-design-save-state]').textContent(),
        'All changes saved',
      );
      assert.deepEqual(await pendingLayout(page), stored);

      let replayRequest;
      const replayStarted = new Promise((resolve) => {
        replayRequest = resolve;
      });
      const replayGate = new Promise((resolve) => {
        releaseReplay = resolve;
      });
      if (!foreignContent)
        await page.route('**/api/design-layout', async (route) => {
          replayRequest(route.request().postDataJSON());
          await replayGate;
          await route.continue();
        });
      await page.locator('[data-design-reload-studio]').click();
      if (!foreignContent) {
        const input = await replayStarted;
        assert.equal(input.revision, restartedRevision, 'the stored move is rebased before replay');
        assert.deepEqual(input.boards['screen-1/desktop/A'], moved);
        assert.notEqual(
          await page.locator('[data-design-save-state]').textContent(),
          'All changes saved',
        );
        assert.equal((await pendingLayout(page)).operations.length, 1);
        releaseReplay();
      }
      await page.locator('[data-design-ready="true"]').waitFor();
      await page.evaluate(() => window.__openPlanrDesignStudio.flush());
      assert.equal(await pendingLayout(page), undefined);
      if (foreignContent) {
        assert.match(
          await page.locator('[data-design-notice-message]').textContent(),
          /pending board moves were dropped because authored content changed/i,
        );
        assert.deepEqual(
          JSON.parse(readFileSync(file, 'utf8')).layout.boards['screen-1/desktop/A'],
          {
            x: -300,
            y: 400,
          },
        );
      } else {
        assert.deepEqual(
          JSON.parse(readFileSync(file, 'utf8')).layout.boards['screen-1/desktop/A'],
          moved,
        );
        await page.waitForFunction(
          () =>
            document.querySelector('[data-design-save-state]').textContent === 'All changes saved',
        );
      }
    } finally {
      releaseReplay?.();
      await browser?.close();
      await session?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}

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
      const minY = Math.min(...panels.map((panel) => parseFloat(panel.style.top)));
      const maxX = Math.max(...panels.map((panel) => parseFloat(panel.style.left) + 600));
      const maxY = Math.max(...panels.map((panel) => parseFloat(panel.style.top) + 450));
      const stageRect = stage.getBoundingClientRect();
      let top = 0,
        bottom = stage.clientHeight;
      for (const selector of ['.design-toolbar', '.design-stage-context', '.design-canvas-tools']) {
        const rect = document.querySelector(selector).getBoundingClientRect();
        if (rect.bottom > stageRect.top && rect.top < stageRect.bottom) {
          if (rect.top + rect.height / 2 > stageRect.top + stageRect.height / 2)
            bottom = Math.min(bottom, rect.top - stageRect.top);
          else top = Math.max(top, rect.bottom - stageRect.top);
        }
      }
      const height = bottom - top;
      const zoom = Math.max(
        0.05,
        Math.min(1, (stage.clientWidth - 96) / (maxX - minX), (height - 96 - 34) / (maxY - minY)),
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
          y: top + (height - (maxY - minY) * zoom + 34) / 2 - minY * zoom,
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

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`Fit keeps boards clear of floating chrome and section labels readable at ${viewport.width}px (${browserEngine()})`, {
    timeout: 60000,
  }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'openplanr-canvas-chrome-'));
    let browser, session;
    try {
      const { file, document } = designFixture(root, {
        count: 3,
        frames: [
          { id: 'desktop', label: 'Desktop viewport · 1440 × auto', width: 1440, height: 'auto' },
          { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
        ],
      });
      document.screens[0].title = 'Public status page';
      document.layout = {
        sections: [{ id: 'journey', x: 0, y: 0, text: 'Workspace journey', maxW: 160 }],
      };
      writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
      await renderDesignDocument(file);
      session = await startDesignReview(file, {
        env: { ...process.env, PLANR_HOME: join(root, 'home') },
        port: 0,
      });
      browser = await launchBrowser({ engine: browserEngine() });
      const page = await browser.newPage({ viewport });
      page.setDefaultTimeout(10000);
      await page.route('**/api/design-status', (route) =>
        route.fulfill({
          json: { verification: 'failed' },
        }),
      );
      await page.goto(session.url);
      await page.locator('[data-design-ready="true"]').waitFor();
      await settleStudioChrome(page);
      assert.equal(
        await page.locator('.design-artboard-drag span').first().textContent(),
        'Desktop viewport · 1440 × auto',
      );
      await page.waitForFunction(
        () =>
          document.querySelector('[data-design-verification]').textContent ===
          'Browser inspection failed',
      );
      await page.route('**/api/design-status', (route) => route.abort('connectionrefused'));
      await page.waitForFunction(
        () => document.querySelector('[data-design-save-state]').textContent === 'Disconnected',
      );
      const saveStatus = page.locator('[data-design-save-state]');
      assert.equal(await saveStatus.getAttribute('title'), 'Disconnected');
      assert.equal(
        await saveStatus.evaluate((node) => {
          const style = getComputedStyle(node);
          return (
            node.scrollWidth <= node.clientWidth ||
            (style.textOverflow === 'ellipsis' && style.overflow === 'hidden')
          );
        }),
        true,
        'save status fits or exposes an ellipsis with the complete title',
      );
      await page.locator('[data-design-fit]').click();
      await settleStudioChrome(page);
      await assertCanvasLabels(page);
      const title = await page
        .locator('.design-artboard-label')
        .first()
        .evaluate((label) => {
          const title = label.querySelector('strong');
          return {
            fits: title.scrollWidth <= title.clientWidth,
            narrow: label.querySelector('.design-artboard-drag').clientWidth < title.scrollWidth,
            tooltip: label.title,
          };
        });
      assert.ok(
        title.fits ||
          (title.narrow && title.tooltip === 'Public status page · Desktop viewport · 1440 × auto'),
        'Fit preserves the full board title or exposes its title and size in the tooltip',
      );
      const geometry = await page.evaluate(() => {
        const rect = (selector) =>
          document.querySelector(selector).getBoundingClientRect().toJSON();
        const { camera, zoom } = window.__openPlanrDesignStudio.getState();
        return {
          stage: rect('.planr-stage-scroll'),
          toolbar: rect('.design-toolbar'),
          tools: rect('.design-canvas-tools'),
          context: rect('.design-stage-context'),
          camera,
          zoom,
          transform: document.querySelector('.planr-frame-grid').style.transform,
          boards: [
            ...document.querySelectorAll('.planr-artifact-panel:not([hidden]) .planr-frame'),
          ].map((board) => board.getBoundingClientRect().toJSON()),
        };
      });
      const intersects = (a, b) =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      for (const board of geometry.boards) {
        const details = JSON.stringify({ viewport, board, ...geometry });
        assert.ok(
          board.left >= geometry.stage.left - 1 && board.right <= geometry.stage.right + 1,
          `Fit keeps the board inside the stage horizontally: ${details}`,
        );
        assert.ok(
          board.top >= geometry.stage.top - 1 && board.bottom <= geometry.stage.bottom + 1,
          `Fit keeps the board inside the stage vertically: ${details}`,
        );
        assert.equal(
          intersects(board, geometry.toolbar),
          false,
          `Fit clears the measured toolbar: ${details}`,
        );
        assert.equal(
          intersects(board, geometry.tools),
          false,
          `Fit clears the measured canvas tools: ${details}`,
        );
        assert.equal(
          intersects(board, geometry.context),
          false,
          `Fit clears the measured stage context: ${details}`,
        );
      }
      for (const zoom of [null, 0.28, 1, 0.05]) {
        if (zoom !== null) {
          await page.evaluate((zoom) => {
            window.__openPlanrDesignStudio.setCamera({ x: 40, y: 200, zoom });
          }, zoom);
          await settleStudioChrome(page);
        }
        const heading = await page.evaluate(() => {
          const node = document.querySelector('.design-section-heading');
          const zoom = window.__openPlanrDesignStudio.getState().zoom;
          return {
            hidden: node.hidden,
            font: parseFloat(getComputedStyle(node).fontSize) * zoom,
            rect: node.getBoundingClientRect().toJSON(),
            maxWidth: parseFloat(getComputedStyle(node).maxWidth) * zoom,
            labels: [
              ...document.querySelectorAll(
                '.planr-artifact-panel:not([hidden]) .design-artboard-label',
              ),
            ].map((label) => label.getBoundingClientRect().toJSON()),
            boards: [
              ...document.querySelectorAll('.planr-artifact-panel:not([hidden]) .planr-frame'),
            ].map((board) => board.getBoundingClientRect().toJSON()),
            anchor: document.querySelector('.planr-frame-grid').getBoundingClientRect().top,
          };
        });
        assert.equal(heading.hidden, false, `heading visible at ${zoom ?? 'Fit'}`);
        assert.ok(heading.font >= 13.99 && heading.font <= 28.01, `screen font: ${heading.font}`);
        assert.ok(Math.abs(heading.maxWidth - 160) < 0.01);
        assert.ok(heading.rect.bottom <= heading.anchor + 1);
        for (const label of heading.labels) assert.equal(intersects(heading.rect, label), false);
        for (const board of heading.boards) assert.equal(intersects(heading.rect, board), false);
        if (zoom === null) {
          assert.ok(heading.rect.top >= geometry.stage.top - 1, 'Fit includes the heading box');
          assert.ok(
            heading.rect.right <= geometry.stage.right + 1,
            'Fit includes its screen width',
          );
        }
      }
      await page.evaluate(() => {
        window.__openPlanrDesignStudio.setCamera({ x: 0, y: 0, zoom: 1 });
        document.querySelector('[data-design-screen="screen-2"]').click();
      });
      await settleStudioChrome(page);
      await assertCanvasLabels(
        page,
        '.planr-artifact-panel[data-design-active="true"] .design-artboard-label',
      );
      await page.evaluate(() => window.__openPlanrDesignStudio.fit());
      await settleStudioChrome(page);
      await assertCanvasLabels(page);
      const fitted = await page.evaluate(() => window.__openPlanrDesignStudio.getState());
      await page.evaluate(() => window.__openPlanrDesignStudio.fit());
      const repeated = await page.evaluate(() => window.__openPlanrDesignStudio.getState());
      assert.ok(Math.abs(repeated.zoom - fitted.zoom) < 0.000001, 'Fit converges');
      assert.ok(Math.abs(repeated.camera.y - fitted.camera.y) < 0.01, 'Fit stays stable');

      const current = currentDesign(file);
      assert.equal(current.entries.length, 6);
      assert.ok((await page.locator('iframe[data-planr-artifact-frame]').count()) <= 3);
      const report = await auditDesignPage(page, {
        document: current.document,
        entries: current.entries,
      });
      assert.deepEqual(
        report.checkedArtifacts,
        current.entries.map(({ artifactId }) => artifactId),
      );
      assert.equal(
        report.issues.some(({ rule }) => rule === 'missing-frame-inspection'),
        false,
      );
    } finally {
      await browser?.close();
      await session?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
