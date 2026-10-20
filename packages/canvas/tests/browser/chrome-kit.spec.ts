import { createRequire } from 'node:module';
import { expect, type Page, test } from '@playwright/test';
import type {} from '../../bench/react-main';
import { waitForBench } from './bench';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');
const slot = (name: string) => `[data-chrome-slot="${name}"]`;

async function openChrome(page: Page, query = '') {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/react.html?chrome=1&${query}`);
  await waitForBench(page);
  await expect(page.locator(slot('toolbar'))).toBeVisible();
}
async function state(page: Page) {
  return page.evaluate(() => {
    const bench = window.chromeBench;
    if (!bench) throw new Error('Chrome bench hooks did not initialize');
    const chrome = bench.getState();
    return {
      panels: chrome.panels,
      layout: chrome.layout,
      hidden: chrome.chromeHidden,
      pending: chrome.inspectorPending,
      safeArea: chrome.safeArea,
    };
  });
}
async function setSidebar(page: Page, open: boolean) {
  if ((await state(page)).panels.sidebar?.open !== open)
    await page.getByRole('button', { name: 'Sidebar', exact: true }).click();
  await expect(page.locator(slot('sidebar'))).toHaveAttribute('data-open', String(open));
}
async function selectCard(page: Page) {
  const node = page.locator('[data-canvas-node-id]').first();
  const id = await node.getAttribute('data-canvas-node-id');
  if (!id) throw new Error('Bench rendered a node without an id');
  await node.click();
  await expect.poll(() => page.evaluate(() => window.canvas.getSelection())).toEqual([id]);
  return id;
}
async function emptyCanvasPoint(page: Page) {
  return page.evaluate(() => {
    const stage = document.querySelector('.canvas-stage');
    if (!(stage instanceof HTMLElement)) throw new Error('Canvas stage is missing');
    const bounds = stage.getBoundingClientRect();
    for (let y = 120; y < bounds.height - 100; y += 40) {
      for (let x = 120; x < bounds.width - 420; x += 40) {
        const target = document.elementFromPoint(bounds.x + x, bounds.y + y);
        if (
          target === stage ||
          (target instanceof Element && target.matches('.canvas-world, .canvas-edges'))
        )
          return { x: bounds.x + x, y: bounds.y + y };
      }
    }
    throw new Error('No uncovered empty canvas point found');
  });
}
async function emptyCanvasClick(page: Page) {
  const point = await emptyCanvasPoint(page);
  await page.mouse.click(point.x, point.y);
}

test('fixed slots expose binding hints, tooltips, and transient overflow rows', async ({
  page,
}) => {
  await openChrome(page);
  expect(
    await page
      .locator('[data-chrome-slot]')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-chrome-slot')).sort(),
      ),
  ).toEqual(['action', 'help', 'history', 'menu', 'navigation', 'sidebar', 'toolbar', 'zoom']);
  for (const [label, hint] of [
    ['Select', 'V'],
    ['Hand', 'H'],
    ['Rectangle', 'R'],
    ['Text', 'T'],
  ]) {
    const item = page.getByRole('button', { name: new RegExp(`^${label}`, 'u') });
    await expect(item).toContainText(hint);
    await expect(item).toHaveAttribute('title', new RegExp(hint ?? '', 'u'));
  }
  const before = (await state(page)).safeArea;
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /^Add rectangle/u })).toContainText('R');
  await expect(page.getByRole('menuitem', { name: /^Add text/u })).toContainText('T');
  await expect.poll(async () => (await state(page)).safeArea).toEqual(before);
  await page.evaluate(() => {
    const bench = window.chromeBench;
    if (!bench) throw new Error('Chrome bench hooks did not initialize');
    const current = bench.getState().keymap;
    bench.setKeymap({ ...current, sidebar: { code: 'KeyI', ctrlKey: true } });
    bench.setToolShortcut('select', { code: 'KeyS', shiftKey: true });
  });
  await expect(page.getByRole('menuitem', { name: /^Toggle sidebar/u })).toContainText(
    /(?:Ctrl\+I|⌃I)/u,
  );
  await expect(page.getByRole('button', { name: /^Select/u })).toContainText(/(?:Shift\+S|⇧S)/u);
  await page.getByRole('button', { name: 'More tools', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /^Add rectangle/u })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /^Fit all/u })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^Inspect selection/u })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await emptyCanvasClick(page);
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('selection fills the closed inspector, Enter opens it, and pin controls dismissal', async ({
  page,
}) => {
  await openChrome(page);
  const sidebar = page.locator(slot('sidebar'));
  expect((await state(page)).panels.sidebar).toEqual({ open: false, pinned: false });
  await expect(sidebar).toHaveAttribute('inert', '');
  await expect(sidebar).not.toHaveAttribute('aria-hidden');
  const id = await selectCard(page);
  await expect.poll(async () => (await state(page)).pending).toBe(true);
  await expect.poll(async () => (await state(page)).panels.sidebar?.open).toBe(false);
  await expect(sidebar).toContainText(id);
  await expect(page.locator('[data-inspector-pending]')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(sidebar).toHaveAttribute('data-open', 'true');
  await expect(sidebar).not.toHaveAttribute('inert');
  await expect.poll(async () => (await state(page)).pending).toBe(false);
  await selectCard(page);
  await expect.poll(async () => (await state(page)).panels.sidebar?.open).toBe(true);
  await page.keyboard.press('Escape');
  await expect(sidebar).toHaveAttribute('inert', '');
  await setSidebar(page, true);
  await emptyCanvasClick(page);
  await expect(sidebar).toHaveAttribute('data-open', 'false');
  await setSidebar(page, true);
  await page.getByRole('button', { name: 'Pin sidebar', exact: true }).click();
  await page.keyboard.press('Escape');
  await emptyCanvasClick(page);
  await expect
    .poll(async () => (await state(page)).panels.sidebar)
    .toEqual({ open: true, pinned: true });
  await page.getByRole('button', { name: 'Pin sidebar', exact: true }).click();
  await emptyCanvasClick(page);
  await expect(sidebar).toHaveAttribute('data-open', 'false');
});

test('an unpinned sidebar survives a canvas pan and closes on an empty-canvas click', async ({
  page,
}) => {
  await openChrome(page);
  await page.getByRole('button', { name: /^Hand/u }).click();
  await setSidebar(page, true);
  const before = await page.evaluate(() => window.canvas.getCamera());
  const point = await emptyCanvasPoint(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await expect(page.locator(slot('sidebar'))).toHaveAttribute('data-open', 'true');
  await page.mouse.move(point.x - 60, point.y + 35, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.canvas.getCamera())).not.toEqual(before);
  await expect
    .poll(async () => (await state(page)).panels.sidebar)
    .toEqual({ open: true, pinned: false });
  await emptyCanvasClick(page);
  await expect(page.locator(slot('sidebar'))).toHaveAttribute('data-open', 'false');
});

test('F6 follows region order in both directions and physical Alt keys toggle chrome', async ({
  page,
}) => {
  await openChrome(page);
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  const order = ['skip-link', 'menu', 'toolbar', 'action', 'canvas', 'zoom', 'history', 'help'];
  const focus = () =>
    page.evaluate(() => {
      const element = document.activeElement;
      if (element?.matches('.canvas-stage')) return 'canvas';
      if (element?.matches('.canvas-skip-link')) return 'skip-link';
      return element?.closest('[data-chrome-slot]')?.getAttribute('data-chrome-slot');
    });
  for (const region of order) {
    await page.keyboard.press('F6');
    expect(await focus()).toBe(region);
  }
  for (const region of [...order].reverse().slice(1)) {
    await page.keyboard.press('Shift+F6');
    expect(await focus()).toBe(region);
  }
  await page.evaluate(() =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'BracketLeft', key: '“', altKey: true, bubbles: true }),
    ),
  );
  await expect.poll(async () => (await state(page)).panels.navigation?.open).toBe(true);
  await page.evaluate(() =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'BracketRight', key: '‘', altKey: true, bubbles: true }),
    ),
  );
  await expect.poll(async () => (await state(page)).panels.sidebar?.open).toBe(true);
  await page.evaluate(() =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyZ', key: 'Ω', altKey: true, bubbles: true }),
    ),
  );
  await expect.poll(async () => (await state(page)).hidden).toBe(true);
  await expect(page.locator(slot('toolbar'))).not.toBeVisible();
  await expect(page.locator(slot('zoom'))).toBeVisible();
});

test('panel and hint persistence round trip and adapter failures are observable', async ({
  page,
}) => {
  await openChrome(page);
  await setSidebar(page, true);
  await page.getByRole('button', { name: 'Pin sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss toolbar hint', exact: true }).click();
  await page.reload();
  await waitForBench(page);
  await expect
    .poll(() => state(page).then((value) => value.panels.sidebar))
    .toEqual({ open: true, pinned: true });
  await expect(page.getByRole('button', { name: 'Dismiss toolbar hint', exact: true })).toHaveCount(
    0,
  );
  await page.evaluate(() => {
    const bench = window.chromeBench;
    if (!bench) throw new Error('Chrome bench hooks did not initialize');
    return bench.setStorageFailure(true);
  });
  await page.getByRole('button', { name: 'Pin sidebar', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const bench = window.chromeBench;
        if (!bench) throw new Error('Chrome bench hooks did not initialize');
        return bench.storageErrors.length;
      }),
    )
    .toBeGreaterThan(0);
  const messages = await page.evaluate(() => {
    const bench = window.chromeBench;
    if (!bench) throw new Error('Chrome bench hooks did not initialize');
    return bench.storageErrors;
  });
  expect(messages.some((message) => message.includes('set') && message.includes('sidebar'))).toBe(
    true,
  );
});

test('mobile uses a bottom tool pill, top-left zoom, one sheet, and menu overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChrome(page);
  expect((await state(page)).layout).toBe('mobile');
  const toolbar = await page.locator(slot('toolbar')).boundingBox();
  const zoom = await page.locator(slot('zoom')).boundingBox();
  if (!toolbar || !zoom) throw new Error('Mobile toolbar or zoom did not render');
  expect(toolbar.y).toBeGreaterThan(700);
  expect(Math.abs(toolbar.x + toolbar.width / 2 - 195)).toBeLessThanOrEqual(4);
  expect(zoom.x).toBeLessThanOrEqual(20);
  expect(zoom.y).toBeLessThanOrEqual(20);
  await expect(page.locator(slot('history'))).not.toBeVisible();
  await expect(page.locator(slot('help'))).not.toBeVisible();
  await page.getByRole('button', { name: 'More tools', exact: true }).click();
  const more = await page.getByRole('menu', { name: 'More tools', exact: true }).boundingBox();
  if (!more) throw new Error('Mobile More menu did not render');
  expect(more.x).toBeGreaterThanOrEqual(0);
  expect(more.y).toBeGreaterThanOrEqual(0);
  expect(more.x + more.width).toBeLessThanOrEqual(390);
  expect(more.y + more.height).toBeLessThanOrEqual(844);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  for (const name of ['Share', 'Undo', 'Redo', 'Help'])
    await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await setSidebar(page, true);
  const sheet = await page.locator(slot('sidebar')).boundingBox();
  if (!sheet) throw new Error('Sidebar sheet did not render');
  expect(Math.abs(sheet.height - 844 * 0.55)).toBeLessThanOrEqual(4);
  await expect
    .poll(async () => {
      const area = (await state(page)).safeArea;
      return area.y + area.height;
    })
    .toBeLessThanOrEqual(sheet.y);
  const controllerArea = await page.evaluate(() => window.canvas.getSafeArea());
  expect(controllerArea.y + controllerArea.height).toBeLessThanOrEqual(sheet.y);
  await expect.poll(async () => (await state(page)).safeArea).toEqual(controllerArea);
  await page.evaluate(() => {
    const bench = window.chromeBench;
    if (!bench) throw new Error('Chrome bench hooks did not initialize');
    return bench.getState().setPanelOpen('navigation', true);
  });
  await expect.poll(async () => (await state(page)).panels.sidebar?.open).toBe(false);
  await expect.poll(async () => (await state(page)).panels.navigation?.open).toBe(true);
});

test('one-panel mode closes the opposite panel', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await openChrome(page);
  expect((await state(page)).layout).toBe('one-panel');
  await page.evaluate(() => {
    const bench = window.chromeBench;
    if (!bench) throw new Error('Chrome bench hooks did not initialize');
    return bench.getState().setPanelOpen('navigation', true);
  });
  await setSidebar(page, true);
  await expect.poll(async () => (await state(page)).panels.navigation?.open).toBe(false);
});

test('history remains one shared gap beside a themed zoom pill width', async ({ page }) => {
  await openChrome(page);
  await page.locator('.canvas-chrome-root').evaluate((root) => {
    if (!(root instanceof HTMLElement)) throw new Error('Chrome root is missing');
    root.style.setProperty('--canvas-chrome-zoom-width', '200px');
  });
  const zoom = await page.locator(slot('zoom')).boundingBox();
  const history = await page.locator(slot('history')).boundingBox();
  if (!zoom || !history) throw new Error('Zoom or history pill did not render');
  expect(zoom.width).toBe(200);
  expect(history.x - zoom.x - zoom.width).toBe(12);
});

test('sixteen chrome toggles produce no layout shifts or camera movement', async ({ page }) => {
  await openChrome(page);
  const result = await page.evaluate(async () => {
    let total = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if ('value' in entry && typeof entry.value === 'number') total += entry.value;
    });
    observer.observe({ type: 'layout-shift', buffered: false });
    const before = window.canvas.getCamera();
    for (let index = 0; index < 16; index += 1) {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'KeyZ', altKey: true, bubbles: true }),
      );
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    observer.disconnect();
    return { total, before, after: window.canvas.getCamera() };
  });
  expect(result.total).toBe(0);
  expect(result.after).toEqual(result.before);
});

test('welcome hints anchor to measured controls and disappear when a node is added', async ({
  page,
}) => {
  await openChrome(page, 'empty=1');
  await expect(
    page.getByRole('group', { name: 'Getting started actions' }).getByRole('button', {
      name: /^Add rectangle/u,
    }),
  ).toBeVisible();
  const anchors = await page.evaluate(() => {
    return ['menu', 'toolbar'].map((name) => {
      const hint = document.querySelector(`[data-welcome-anchor="${name}"]`);
      const target = document.querySelector(`[data-chrome-slot="${name}"]`);
      if (!(hint instanceof HTMLElement) || !(target instanceof HTMLElement))
        throw new Error(`Missing ${name} hint anchor`);
      const bounds = target.getBoundingClientRect();
      return {
        x: parseFloat(hint.style.left),
        y: parseFloat(hint.style.top) - 4,
        targetX: bounds.x + bounds.width / 2,
        targetY: bounds.bottom,
      };
    });
  });
  for (const anchor of anchors) {
    expect(Math.abs(anchor.x - anchor.targetX)).toBeLessThanOrEqual(4);
    expect(Math.abs(anchor.y - anchor.targetY)).toBeLessThanOrEqual(4);
  }
  await page.evaluate(() => {
    const bench = window.chromeBench;
    if (!bench) throw new Error('Chrome bench hooks did not initialize');
    return bench.addNode();
  });
  await expect(page.locator('[data-welcome-anchor]')).toHaveCount(0);
});

test('accent is restricted to active tools, pressed toggles, and the single primary action', async ({
  page,
}) => {
  await openChrome(page);
  await setSidebar(page, true);
  await page.getByRole('button', { name: 'Pin sidebar', exact: true }).click();
  const colors = await page.evaluate(() => {
    const root = document.querySelector('.canvas-chrome-root');
    if (!(root instanceof HTMLElement)) throw new Error('Chrome root is missing');
    root.style.setProperty('--canvas-chrome-accent', 'rgb(211, 17, 97)');
    return [...root.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].map((element) => {
      const style = getComputedStyle(element);
      return {
        name: element.getAttribute('aria-label') ?? element.textContent,
        accent: [style.color, style.backgroundColor, style.borderColor].includes(
          'rgb(211, 17, 97)',
        ),
        allowed:
          element.matches('.canvas-chrome-tool[aria-pressed="true"], .canvas-chrome-primary') ||
          (element.getAttribute('aria-label') === 'Sidebar' &&
            element.getAttribute('aria-pressed') === 'true'),
      };
    });
  });
  expect(colors.filter((entry) => entry.accent).length).toBeGreaterThanOrEqual(3);
  expect(colors.filter((entry) => entry.accent && !entry.allowed)).toEqual([]);
});

for (const interaction of ['pan', 'zoom'] as const) {
  test(`180 ${interaction} frames with open chrome produce zero React commits`, async ({
    page,
  }) => {
    await openChrome(page);
    await setSidebar(page, true);
    const result = await page.evaluate(async (kind) => {
      window.bench.setNodes([{ id: 'steady', bounds: { x: 100, y: 100, width: 220, height: 76 } }]);
      window.canvas.setCamera({ x: 0, y: 0, zoom: 1 });
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      const before = window.reactCommits;
      for (let index = 0; index < 180; index += 1) {
        const phase = Math.sin(index / 20);
        window.canvas.setCamera(
          kind === 'pan'
            ? { x: phase * 10, y: phase * 10, zoom: 1 }
            : { x: 0, y: 0, zoom: 1 + phase * 0.02 },
        );
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      return { commits: window.reactCommits - before, error: window.benchError };
    }, interaction);
    expect(result.error).toBeUndefined();
    expect(result.commits).toBe(0);
  });
}

async function expectAccessibleChrome(page: Page) {
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run();
    return result.violations
      .filter((item) => item.impact === 'serious' || item.impact === 'critical')
      .map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.target) }));
  });
  expect(violations).toEqual([]);
}

for (const mode of ['chrome', 'sidebar', 'mobile', 'mobile-menu', 'empty'] as const) {
  test(`axe reports no serious or critical violations with ${mode}`, async ({ page }) => {
    if (mode === 'mobile' || mode === 'mobile-menu')
      await page.setViewportSize({ width: 390, height: 844 });
    await openChrome(page, mode === 'empty' ? 'empty=1' : '');
    if (mode === 'sidebar') await setSidebar(page, true);
    if (mode === 'mobile-menu')
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await expectAccessibleChrome(page);
  });
}

for (const appearance of ['dark', 'forced-colors'] as const) {
  for (const mode of ['mobile-menu', 'empty'] as const) {
    test(`axe reports no serious or critical violations with ${mode} in ${appearance}`, async ({
      page,
    }) => {
      await page.emulateMedia({
        colorScheme: appearance === 'dark' ? 'dark' : 'light',
        forcedColors: appearance === 'forced-colors' ? 'active' : 'none',
      });
      if (mode === 'mobile-menu') await page.setViewportSize({ width: 390, height: 844 });
      await openChrome(page, mode === 'empty' ? 'empty=1' : '');
      if (mode === 'mobile-menu')
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await expectAccessibleChrome(page);
    });
  }
}
