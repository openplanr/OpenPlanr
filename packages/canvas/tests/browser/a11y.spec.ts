import { createRequire } from 'node:module';
import { expect, type Page, test } from '@playwright/test';
import type {} from '../../bench/main';
import { waitForBench } from './bench';

declare global {
  interface Window {
    axe: typeof import('axe-core');
  }
}

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');

async function openBench(page: Page, query = ''): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/?${query}`);
  await waitForBench(page);
}

test('Tab enters and leaves the populated canvas in one stop', async ({ page }) => {
  await openBench(page);
  await page.evaluate(() => {
    const stage = document.getElementById('stage');
    if (!stage) throw new Error('Bench stage is missing');
    for (const id of ['before-canvas', 'after-canvas']) {
      const button = document.createElement('button');
      button.id = id;
      button.textContent = id;
      Object.assign(button.style, { position: 'fixed', top: '0px', left: '0px' });
      if (id === 'before-canvas') stage.before(button);
      else stage.after(button);
    }
  });
  await page.locator('#before-canvas').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#stage')).toBeFocused();
  await expect(page.locator('#stage')).toHaveAttribute('role', 'group');
  await expect(page.locator('#stage')).toHaveAttribute('aria-roledescription', 'canvas');
  await expect(page.locator('#stage')).toHaveAccessibleName('Canvas engine bench');
  await expect(page.locator('[data-canvas-node-id][tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(page.locator('#after-canvas')).toBeFocused();
});

test('arrows move real DOM focus through every node in a twenty-node grid', async ({ page }) => {
  await openBench(page);
  await page.evaluate(async () => {
    window.bench.setNodes(
      Array.from({ length: 20 }, (_, index) => ({
        id: `grid-${index + 1}`,
        bounds: {
          x: 80 + (index % 5) * 150,
          y: 80 + Math.floor(index / 5) * 110,
          width: 100,
          height: 66,
        },
      })),
    );
    await window.canvas.focusNode('grid-1');
  });
  await expect(page.locator('[data-canvas-node-id="grid-1"]')).toBeFocused();
  let visited = 1;
  for (let row = 0; row < 4; row += 1) {
    const columns = row % 2 === 0 ? [1, 2, 3, 4] : [3, 2, 1, 0];
    for (const column of columns) {
      await page.keyboard.press(row % 2 === 0 ? 'ArrowRight' : 'ArrowLeft');
      const id = `grid-${row * 5 + column + 1}`;
      await expect(page.locator(`[data-canvas-node-id="${id}"]`)).toBeFocused();
      await expect.poll(() => page.evaluate(() => window.canvas.getFocus())).toBe(id);
      await expect(page.locator('[data-canvas-node-id][tabindex="0"]')).toHaveCount(1);
      visited += 1;
    }
    if (row === 3) continue;
    await page.keyboard.press('ArrowDown');
    const id = `grid-${(row + 1) * 5 + (row % 2 === 0 ? 5 : 1)}`;
    await expect(page.locator(`[data-canvas-node-id="${id}"]`)).toBeFocused();
    visited += 1;
  }
  expect(visited).toBe(20);
});

test('focusNode mounts a node ten viewports away and resolves inside the safe area', async ({
  page,
}) => {
  await openBench(page);
  const result = await page.evaluate(async () => {
    const stage = document.getElementById('stage');
    if (!stage) throw new Error('Bench stage is missing');
    stage.focus();
    window.canvas.setChrome({
      id: 'focus-sidebar',
      edge: 'left',
      rect: { x: 0, y: 0, width: 264, height: stage.clientHeight },
      open: true,
    });
    window.bench.setNodes([
      { id: 'near-card', bounds: { x: 320, y: 80, width: 230, height: 66 } },
      {
        id: 'distant-card',
        bounds: { x: stage.clientWidth * 10, y: stage.clientHeight * 10, width: 230, height: 66 },
      },
    ]);
    const mountedBefore = window.canvas.getMountedIds().has('distant-card');
    await window.canvas.focusNode('distant-card');
    const element = document.querySelector('[data-canvas-node-id="distant-card"]');
    if (!element) throw new Error('Distant focus node did not mount');
    const bounds = element.getBoundingClientRect();
    const origin = stage.getBoundingClientRect();
    return {
      mountedBefore,
      activeAtResolution: document.activeElement === element,
      focus: window.canvas.getFocus(),
      safe: window.canvas.getSafeArea(),
      rect: {
        x: bounds.x - origin.x,
        y: bounds.y - origin.y,
        right: bounds.right - origin.x,
        bottom: bounds.bottom - origin.y,
      },
    };
  });
  expect(result.mountedBefore).toBe(false);
  expect(result.activeAtResolution).toBe(true);
  expect(result.focus).toBe('distant-card');
  expect(result.safe.x).toBeGreaterThan(264);
  expect(result.rect.x).toBeGreaterThanOrEqual(result.safe.x - 0.5);
  expect(result.rect.y).toBeGreaterThanOrEqual(result.safe.y - 0.5);
  expect(result.rect.right).toBeLessThanOrEqual(result.safe.x + result.safe.width + 0.5);
  expect(result.rect.bottom).toBeLessThanOrEqual(result.safe.y + result.safe.height + 0.5);
  await expect(page.locator('[data-canvas-node-id="distant-card"]')).toBeFocused();
});

test('focusNode rejects an unknown node with its typed error', async ({ page }) => {
  await openBench(page);
  const result = await page.evaluate(async () => {
    try {
      await window.canvas.focusNode('missing-focus-node');
      throw new Error('Unknown focus node unexpectedly resolved');
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error)) throw error;
      return { name: error.name, code: error.code, message: error.message };
    }
  });
  expect(result.name).toBe('CanvasFocusError');
  expect(result.code).toBe('unknown-node');
  expect(result.message).toContain('missing-focus-node');
});

test('an outline keyboard jump focuses, selects and announces the node name', async ({ page }) => {
  await openBench(page, 'outline=1');
  await page.evaluate(() => {
    window.bench.setNodes([
      { id: 'outline-card', bounds: { x: 15_000, y: 80, width: 230, height: 66 } },
    ]);
  });
  const jump = page.locator('[data-canvas-outline] button').filter({ hasText: 'outline-card' });
  await expect(jump).toHaveCount(1);
  await jump.focus();
  await page.keyboard.press('Enter');
  const node = page.locator('[data-canvas-node-id="outline-card"]');
  await expect(node).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => window.canvas.getSelection()))
    .toEqual(['outline-card']);
  const name = await node.getAttribute('aria-label');
  expect(name).toBeTruthy();
  await expect(page.locator('#stage [role="status"]')).toHaveText(name ?? '');
});

test('three zoom keys within one announcement window write only the latest message', async ({
  page,
}) => {
  await openBench(page);
  await page.locator('#stage').focus();
  await page.evaluate(() => {
    const status = document.querySelector('#stage [role="status"]');
    if (!(status instanceof HTMLElement)) throw new Error('Canvas live region is missing');
    status.dataset.messageWrites = '0';
    const observer = new MutationObserver((records) => {
      status.dataset.messageWrites = String(Number(status.dataset.messageWrites) + records.length);
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true });
  });
  const started = Date.now();
  for (let index = 0; index < 3; index += 1) await page.keyboard.press('+');
  expect(Date.now() - started).toBeLessThan(500);
  const region = page.locator('#stage [role="status"]');
  await expect(region).toHaveText('Zoom 195%');
  await page.waitForTimeout(550);
  await expect(region).toHaveAttribute('data-message-writes', '1');
  await expect(region).toHaveAttribute('aria-live', 'polite');
  await expect(region).toHaveAttribute('aria-atomic', 'true');
});

test('a boundary arrow leaves focus in place and announces the edge', async ({ page }) => {
  await openBench(page);
  await page.evaluate(async () => {
    window.bench.setNodes([
      { id: 'boundary-card', bounds: { x: 100, y: 100, width: 230, height: 66 } },
    ]);
    await window.canvas.focusNode('boundary-card');
  });
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-canvas-node-id="boundary-card"]')).toBeFocused();
  await expect(page.locator('#stage [role="status"]')).toHaveText('Edge of canvas');
});

test('focus remains on the pinned node throughout the switch to overview', async ({ page }) => {
  await openBench(page);
  const result = await page.evaluate(async () => {
    window.bench.setNodes([
      { id: 'focused-card', bounds: { x: 100, y: 100, width: 230, height: 66 } },
      { id: 'ordinary-card', bounds: { x: 500, y: 100, width: 230, height: 66 } },
    ]);
    await window.canvas.focusNode('focused-card');
    const element = document.activeElement;
    let lostFocus = 0;
    window.canvas.setCamera({ x: 0, y: 0, zoom: 0.3 });
    for (let frame = 0; frame < 20; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (document.activeElement !== element || document.activeElement === document.body)
        lostFocus += 1;
    }
    return { level: window.canvas.getLevel(), focus: window.canvas.getFocus(), lostFocus };
  });
  expect(result).toEqual({ level: 'overview', focus: 'focused-card', lostFocus: 0 });
  await expect(page.locator('[data-canvas-node-id="focused-card"]')).toBeFocused();
  await expect(page.locator('[data-canvas-node-id="focused-card"]')).toBeVisible();
});

for (const world of ['html', 'svg']) {
  for (const zoom of [1, 0.3]) {
    test(`${world} axe reports no serious or critical violations at zoom ${zoom}`, async ({
      page,
    }) => {
      await openBench(page, `world=${world}&zoom=${zoom}&outline=1`);
      await expect
        .poll(() => page.evaluate(() => window.canvas.getLevel()))
        .toBe(zoom === 1 ? 'dom' : 'overview');
      await page.addScriptTag({ path: axePath });
      const violations = await page.evaluate(async () => {
        const result = await window.axe.run();
        return result.violations
          .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
          .map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            description: violation.description,
            nodes: violation.nodes.map((node) => node.target),
          }));
      });
      expect(violations).toEqual([]);
    });
  }
}
