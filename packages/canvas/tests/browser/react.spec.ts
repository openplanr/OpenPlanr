import { createRequire } from 'node:module';
import { expect, type Page, test } from '@playwright/test';
import type {} from '../../bench/react-main';
import { waitForBench } from './bench';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');

async function openReactBench(page: Page, query = ''): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/react.html?${query}`);
  await waitForBench(page);
}

for (const fixture of ['708-997', '5000-7312']) {
  test(`React bench loads ${fixture}`, async ({ page }) => {
    await openReactBench(page, `fixture=${fixture}`);
    expect(await page.evaluate(() => window.bench.fixture)).toBe(fixture);
    await expect(page.locator('#mounted-count')).toContainText(`${fixture.split('-')[0]} nodes`);
    await expect(page.locator('[data-canvas-node-id]').first()).toBeVisible();
    expect(await page.evaluate(() => window.reactCommits)).toBeGreaterThan(0);
    const result = await page.evaluate(() => ({
      cards: [...document.querySelectorAll<HTMLElement>('[data-canvas-node-id]')].map((node) => ({
        width: node.style.width,
        height: node.style.height,
      })),
      firstFrame: window.bench.firstFrameMs,
    }));
    expect(result.firstFrame).toBeGreaterThan(0);
    expect(result.cards.length).toBeGreaterThan(0);
    expect(result.cards.every((card) => card.width === '220px' && card.height === '76px')).toBe(
      true,
    );
  });
}

for (const replacement of [false, true]) {
  for (const interaction of ['pan', 'zoom'] as const) {
    test(`180-frame pure ${interaction} with ${replacement ? 'one replacement card' : 'the 708 fixture'} produces zero React commits`, async ({
      page,
    }) => {
      await openReactBench(page, 'fixture=708-997');
      const result = await page.evaluate(
        async ({ kind, replace }) => {
          if (replace)
            window.bench.setNodes([
              { id: 'steady-card', bounds: { x: 100, y: 100, width: 220, height: 76 } },
            ]);
          window.canvas.setCamera({ x: 0, y: 0, zoom: 1 });
          await new Promise<void>((resolve) => setTimeout(resolve, 300));
          const mountedBefore = [...window.canvas.getMountedIds()];
          const initial = window.reactCommits;
          let mounts = 0;
          let levels = 0;
          const offMount = window.canvas.on('mount', () => {
            mounts += 1;
          });
          const offLevel = window.canvas.on('level', () => {
            levels += 1;
          });
          for (let frame = 0; frame < 180; frame += 1) {
            const phase = Math.sin(frame / 20);
            window.canvas.setCamera(
              kind === 'pan'
                ? { x: phase * 10, y: phase * 10, zoom: 1 }
                : {
                    x: 0,
                    y: 0,
                    zoom: replace ? 0.65 + ((phase + 1) / 2) * 3.35 : 1 + phase * 0.02,
                  },
            );
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 250));
          offMount();
          offLevel();
          return {
            initial,
            commits: window.reactCommits - initial,
            mounts,
            levels,
            mountedBefore,
            mountedAfter: [...window.canvas.getMountedIds()],
            outlineCount: window.canvas.getOutline().length,
            error: window.benchError,
          };
        },
        { kind: interaction, replace: replacement },
      );
      expect(result.error).toBeUndefined();
      expect(result.outlineCount).toBe(replacement ? 1 : 708);
      expect(result.mountedBefore.length).toBeGreaterThan(replacement ? 0 : 1);
      expect(result.mountedAfter).toEqual(result.mountedBefore);
      expect(result.initial).toBeGreaterThan(0);
      expect(result.mounts).toBe(0);
      expect(result.levels).toBe(0);
      expect(result.commits).toBe(0);
    });
  }
}

test('a changed mounted set commits React node content', async ({ page }) => {
  await openReactBench(page);
  const before = await page.evaluate(() => window.reactCommits);
  const liveController = await page.evaluate(() => {
    const controller = window.canvas;
    window.bench.setNodes([
      { id: 'newly-mounted', bounds: { x: 100, y: 100, width: 220, height: 76 } },
    ]);
    return window.canvas === controller && Number.isFinite(controller.getCamera().zoom);
  });
  expect(liveController).toBe(true);
  await expect(page.locator('[data-canvas-node-id="newly-mounted"]')).toBeVisible();
  expect(await page.evaluate(() => window.reactCommits)).toBeGreaterThan(before);
});

for (const zoom of [1, 0.4]) {
  test(`React axe reports no serious or critical violations at zoom ${zoom}`, async ({ page }) => {
    await openReactBench(page, `zoom=${zoom}`);
    await expect
      .poll(() => page.evaluate(() => window.canvas.getLevel()))
      .toBe(zoom === 1 ? 'dom' : 'compact');
    const cards = page.locator('[data-canvas-node-id]');
    expect(await cards.count()).toBeGreaterThan(0);
    if (zoom === 0.4) {
      expect(
        await cards.evaluateAll((nodes) =>
          nodes.every((node) => node.querySelectorAll('*').length <= 1),
        ),
      ).toBe(true);
    }
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
