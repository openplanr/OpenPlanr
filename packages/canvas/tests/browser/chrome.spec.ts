import { expect, type Page, test } from '@playwright/test';
import type {} from '../../bench/main';
import type { ChromeSurface, Rect } from '../../src/index.mts';
import { generateLayeredGraph } from '../../src/testing/index.mts';
import { waitForBench } from './bench';

type PanelEdge = 'left' | 'right';
const fixture = generateLayeredGraph(708, 997);
const panelSets: readonly (readonly PanelEdge[])[] = [['left'], ['right'], ['left', 'right']];

async function openBench(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?fixture=708-997');
  await waitForBench(page);
  await page.evaluate(() => {
    const stage = document.getElementById('stage');
    if (!stage) throw new Error('Bench stage is missing');
    const bounds = stage.getBoundingClientRect();
    for (const edge of ['left', 'right'] as const) {
      const width = edge === 'left' ? 264 : 312;
      const panel = document.createElement('aside');
      panel.id = `chrome-${edge}`;
      panel.textContent = `${edge} panel`;
      Object.assign(panel.style, {
        position: 'fixed',
        top: '64px',
        bottom: '64px',
        [edge]: '0px',
        width: `${width}px`,
        background: 'white',
        visibility: 'hidden',
        zIndex: '100',
      });
      document.body.append(panel);
      const surface: ChromeSurface = {
        id: panel.id,
        edge,
        rect: {
          x: edge === 'left' ? 0 : bounds.width - width,
          y: 64,
          width,
          height: bounds.height - 128,
        },
        open: false,
      };
      window.canvas.setChrome(surface);
    }
  });
}

async function setPanels(page: Page, edges: readonly PanelEdge[], open: boolean): Promise<void> {
  await page.evaluate(
    ({ edges, open }) => {
      const stage = document.getElementById('stage');
      if (!stage) throw new Error('Bench stage is missing');
      const stageBounds = stage.getBoundingClientRect();
      for (const edge of edges) {
        const panel = document.getElementById(`chrome-${edge}`);
        if (!panel) throw new Error(`Chrome panel ${edge} is missing`);
        panel.style.visibility = open ? 'visible' : 'hidden';
        const bounds = panel.getBoundingClientRect();
        window.canvas.setChrome({
          id: panel.id,
          edge,
          rect: {
            x: bounds.x - stageBounds.x,
            y: bounds.y - stageBounds.y,
            width: bounds.width,
            height: bounds.height,
          },
          open,
        });
      }
    },
    { edges, open },
  );
}

async function paint(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

for (const edges of panelSets) {
  const label = edges.join(' and ');
  test(`${label} chrome toggles preserve an uncovered selection, stage bounds and zero CLS`, async ({
    page,
  }) => {
    await openBench(page);
    const initial = await page.evaluate((node) => {
      const stage = document.getElementById('stage');
      if (!stage) throw new Error('Bench stage is missing');
      const bounds = stage.getBoundingClientRect();
      window.canvas.setCamera({
        x: node.bounds.x - (bounds.width - node.bounds.width) / 2,
        y: node.bounds.y - (bounds.height - node.bounds.height) / 2,
        zoom: 1,
      });
      window.canvas.setSelection([node.id]);
      return { camera: window.canvas.getCamera(), stage: bounds.toJSON() };
    }, fixture.nodes[0]);
    await paint(page);
    const results = await page.evaluate(async (edges) => {
      if (!PerformanceObserver.supportedEntryTypes.includes('layout-shift'))
        throw new Error('Layout shift observation is unavailable');
      const stage = document.getElementById('stage');
      if (!stage) throw new Error('Bench stage is missing');
      const panels = edges.map((edge) => {
        const panel = document.getElementById(`chrome-${edge}`);
        if (!panel) throw new Error(`Chrome panel ${edge} is missing`);
        return { edge, panel };
      });
      let cls = 0;
      const record = (entries: readonly PerformanceEntry[]) => {
        for (const entry of entries) {
          if ('value' in entry && typeof entry.value === 'number') cls += entry.value;
        }
      };
      const observer = new PerformanceObserver((list) => record(list.getEntries()));
      observer.observe({ type: 'layout-shift' });
      const snapshots = [];
      try {
        for (let toggle = 0; toggle < 16; toggle += 1) {
          const stageBounds = stage.getBoundingClientRect();
          const open = toggle % 2 === 0;
          for (const { edge, panel } of panels) {
            panel.style.visibility = open ? 'visible' : 'hidden';
            const bounds = panel.getBoundingClientRect();
            window.canvas.setChrome({
              id: panel.id,
              edge,
              rect: {
                x: bounds.x - stageBounds.x,
                y: bounds.y - stageBounds.y,
                width: bounds.width,
                height: bounds.height,
              },
              open,
            });
          }
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          });
          snapshots.push({
            camera: window.canvas.getCamera(),
            stage: stage.getBoundingClientRect().toJSON(),
          });
        }
        record(observer.takeRecords());
        return { snapshots, cls };
      } finally {
        observer.disconnect();
      }
    }, edges);
    expect(results.snapshots).toHaveLength(16);
    for (const snapshot of results.snapshots) expect(snapshot).toEqual(initial);
    expect(results.cls).toBe(0);
  });

  test(`${label} chrome minimally pans a selection covered by more than half without zooming`, async ({
    page,
  }) => {
    await openBench(page);
    const before = await page.evaluate(
      ({ node, coveredEdge }) => {
        const stage = document.getElementById('stage');
        if (!stage) throw new Error('Bench stage is missing');
        const bounds = stage.getBoundingClientRect();
        const x = coveredEdge === 'left' ? 80 : bounds.width - 80 - node.bounds.width;
        const y = (bounds.height - node.bounds.height) / 2;
        window.canvas.setCamera({ x: node.bounds.x - x, y: node.bounds.y - y, zoom: 1 });
        window.canvas.setSelection([node.id]);
        const coveredWidth =
          coveredEdge === 'left' ? 264 - x : x + node.bounds.width - (bounds.width - 312);
        return {
          camera: window.canvas.getCamera(),
          screen: { x, y, width: node.bounds.width, height: node.bounds.height },
          coveredFraction: Math.min(coveredWidth, node.bounds.width) / node.bounds.width,
        };
      },
      { node: fixture.nodes[0], coveredEdge: edges[0] },
    );
    expect(before.coveredFraction).toBeGreaterThan(0.5);
    await setPanels(page, edges, true);
    await paint(page);
    const after = await page.evaluate(
      (bounds) => ({
        camera: window.canvas.getCamera(),
        safe: window.canvas.getSafeArea(),
        start: window.canvas.worldToScreen(bounds),
        end: window.canvas.worldToScreen({
          x: bounds.x + bounds.width,
          y: bounds.y + bounds.height,
        }),
      }),
      fixture.nodes[0].bounds,
    );
    const targetX = Math.max(
      after.safe.x,
      Math.min(before.screen.x, after.safe.x + after.safe.width - before.screen.width),
    );
    expect(after.camera.x).toBeCloseTo(
      before.camera.x - (targetX - before.screen.x) / before.camera.zoom,
      6,
    );
    expect(after.camera.y).toBeCloseTo(before.camera.y, 6);
    expect(after.camera.zoom).toBe(before.camera.zoom);
    expect(after.start.x).toBeGreaterThanOrEqual(after.safe.x);
    expect(after.start.y).toBeGreaterThanOrEqual(after.safe.y);
    expect(after.end.x).toBeLessThanOrEqual(after.safe.x + after.safe.width);
    expect(after.end.y).toBeLessThanOrEqual(after.safe.y + after.safe.height);
  });
}

function union(bounds: readonly Rect[]): Rect {
  const x = Math.min(...bounds.map((rect) => rect.x));
  const y = Math.min(...bounds.map((rect) => rect.y));
  return {
    x,
    y,
    width: Math.max(...bounds.map((rect) => rect.x + rect.width)) - x,
    height: Math.max(...bounds.map((rect) => rect.y + rect.height)) - y,
  };
}

test('both panels keep keyboard fits and keyboard zoom inside the safe area', async ({ page }) => {
  await openBench(page);
  await setPanels(page, ['left', 'right'], true);
  const selected = [fixture.nodes[39], fixture.nodes[77], fixture.nodes[78]];
  await page.evaluate(
    (ids) => window.canvas.setSelection(ids),
    selected.map((node) => node.id),
  );
  await page.locator('#stage').focus();
  for (const [shortcut, bounds] of [
    ['Shift+1', fixture.bounds],
    ['Shift+2', union(selected.map((node) => node.bounds))],
  ] as const) {
    await page.keyboard.press(shortcut);
    await paint(page);
    const projected = await page.evaluate(
      (bounds) => ({
        safe: window.canvas.getSafeArea(),
        start: window.canvas.worldToScreen(bounds),
        end: window.canvas.worldToScreen({
          x: bounds.x + bounds.width,
          y: bounds.y + bounds.height,
        }),
      }),
      bounds,
    );
    expect(projected.safe.x).toBe(276);
    expect(projected.safe.x + projected.safe.width).toBe(1440 - 312 - 12);
    expect(projected.start.x).toBeGreaterThanOrEqual(projected.safe.x - 1);
    expect(projected.start.y).toBeGreaterThanOrEqual(projected.safe.y - 1);
    expect(projected.end.x).toBeLessThanOrEqual(projected.safe.x + projected.safe.width + 1);
    expect(projected.end.y).toBeLessThanOrEqual(projected.safe.y + projected.safe.height + 1);
  }
  const anchor = await page.evaluate(() => {
    const safe = window.canvas.getSafeArea();
    const screen = { x: safe.x + safe.width / 2, y: safe.y + safe.height / 2 };
    return {
      screen,
      world: window.canvas.screenToWorld(screen),
      zoom: window.canvas.getCamera().zoom,
    };
  });
  await page.keyboard.press('+');
  await paint(page);
  const after = await page.evaluate(
    (world) => ({
      screen: window.canvas.worldToScreen(world),
      zoom: window.canvas.getCamera().zoom,
    }),
    anchor.world,
  );
  expect(after.zoom).toBeGreaterThan(anchor.zoom);
  expect(
    Math.hypot(after.screen.x - anchor.screen.x, after.screen.y - anchor.screen.y),
  ).toBeLessThan(1);
});
