import { expect, test } from '@playwright/test';
import type {} from '../../bench/main';
import { waitForBench } from './bench';

declare global {
  interface Window {
    frameProbe: { bootIds: string[]; maxLive: number; maxBooting: number };
  }
}

test('remounts 968 nodes nearest first in chunks across at least five frames', async ({ page }) => {
  await page.goto('/');
  await waitForBench(page);
  const result = await page.evaluate(async () => {
    const nodes = Array.from({ length: 968 }, (_, index) => ({
      id: `remount-${index}`,
      bounds: { x: (index % 44) * 30, y: Math.floor(index / 44) * 30, width: 20, height: 20 },
    }));
    const stage = document.getElementById('stage');
    if (!stage) throw new Error('Stage is missing');
    const bounds = stage.getBoundingClientRect();
    const camera = window.canvas.getCamera();
    const centerX = camera.x + bounds.width / camera.zoom / 2;
    const centerY = camera.y + bounds.height / camera.zoom / 2;
    let frame = 0;
    let previous = new Set(window.canvas.getMountedIds());
    const counts = new Map<number, number>();
    const order: string[] = [];
    const off = window.canvas.on('mount', (ids) => {
      const added = [...ids].filter((id) => !previous.has(id));
      counts.set(frame, (counts.get(frame) ?? 0) + added.length);
      order.push(...added);
      previous = new Set(ids);
    });
    window.bench.setNodes(nodes);
    for (; frame < 30 && window.canvas.getMountedIds().size < nodes.length; frame += 1)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    off();
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const distance = (id: string) => {
      const node = byId.get(id);
      if (!node) throw new Error(`Unknown remount ${id}`);
      return (
        (node.bounds.x + node.bounds.width / 2 - centerX) ** 2 +
        (node.bounds.y + node.bounds.height / 2 - centerY) ** 2
      );
    };
    return {
      counts: [...counts.values()].filter((count) => count > 0),
      mounted: window.canvas.getMountedIds().size,
      order,
      expectedOrder: nodes
        .map((node) => node.id)
        .sort((left, right) => distance(left) - distance(right) || left.localeCompare(right)),
    };
  });
  expect(result.mounted).toBe(968);
  expect(result.counts.length).toBeGreaterThanOrEqual(5);
  expect(Math.max(...result.counts)).toBeLessThanOrEqual(200);
  expect(result.order).toEqual(result.expectedOrder);
});

test('freezes optional admissions while zoom changes and keeps stage DOM bounded', async ({
  page,
}) => {
  await page.goto('/?fixture=5000-7312');
  await waitForBench(page);
  const result = await page.evaluate(async () => {
    const next = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    for (let index = 0; index < 15; index += 1) await next();
    let previous = new Set(window.canvas.getMountedIds());
    let added = 0;
    let removed = 0;
    let maxDom = 0;
    const frames: {
      frame: number;
      zoomBefore: number;
      zoomAfter: number;
      added: number;
      removed: number;
    }[] = [];
    const startZoom = window.canvas.getCamera().zoom;
    const off = window.canvas.on('mount', (ids) => {
      added += [...ids].filter((id) => !previous.has(id)).length;
      removed += [...previous].filter((id) => !ids.has(id)).length;
      previous = new Set(ids);
    });
    for (let index = 0; index < 60; index += 1) {
      added = 0;
      removed = 0;
      const zoomBefore = window.canvas.getCamera().zoom;
      window.canvas.setCamera({
        x: index % 2 === 0 ? 6000 : 0,
        y: 0,
        zoom: startZoom + (index + 1) / 100,
      });
      await next();
      frames.push({
        frame: index,
        zoomBefore,
        zoomAfter: window.canvas.getCamera().zoom,
        added,
        removed,
      });
      maxDom = Math.max(maxDom, document.querySelectorAll('#stage *').length);
    }
    off();
    const afterSweep = window.canvas.getMountedIds().size;
    const lastChange = performance.now();
    let resumedAt: number | null = null;
    const resumed = window.canvas.on('mount', (ids) => {
      if (ids.size > afterSweep && resumedAt === null) resumedAt = performance.now() - lastChange;
    });
    for (let index = 0; index < 30; index += 1) await next();
    resumed();
    return {
      frames,
      maxDom,
      resumedAt,
      mounted: window.canvas.getMountedIds().size,
      afterSweep,
    };
  });
  expect(result.frames).toHaveLength(60);
  for (const frame of result.frames) {
    expect(frame.zoomAfter, `frame ${frame.frame} changes zoom`).not.toBe(frame.zoomBefore);
    expect(frame.added, `frame ${frame.frame} admits no optional nodes while zoom changes`).toBe(0);
  }
  expect(result.frames.reduce((total, frame) => total + frame.removed, 0)).toBeGreaterThan(0);
  expect(result.maxDom).toBeLessThanOrEqual(2000);
  expect(result.mounted).toBeGreaterThan(result.afterSweep);
  expect(result.resumedAt).not.toBeNull();
  expect(result.resumedAt).toBeLessThanOrEqual(120 + 3 * (1000 / 60));
});

test('keeps fifty pins under the DOM budget and drops none of five hundred pins', async ({
  page,
}) => {
  await page.goto('/?fixture=5000-7312');
  await waitForBench(page);
  const sample = async (count: number) =>
    page.evaluate(async (pinCount) => {
      const ids = Array.from({ length: pinCount }, (_, index) => `node-${5000 - index}`);
      window.canvas.setPinned('bench', ids);
      for (let index = 0; index < 8; index += 1)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const mounted = window.canvas.getMountedIds();
      return {
        missing: ids.filter((id) => !mounted.has(id)),
        dom: document.querySelectorAll('#stage *').length,
      };
    }, count);
  const fifty = await sample(50);
  expect(fifty.missing).toEqual([]);
  expect(fifty.dom).toBeLessThanOrEqual(2000);
  expect((await sample(500)).missing).toEqual([]);
});

for (const world of ['html', 'svg']) {
  test(`${world} edge SVG matches drawn route bounds inside HTML camera wrappers`, async ({
    page,
  }) => {
    await page.goto(`/?world=${world}`);
    await waitForBench(page);
    const result = await page.evaluate(() => {
      const world = document.querySelector('[data-world]');
      const overlay = document.querySelector('[data-overlay]');
      const svg = document.querySelector('.edges');
      if (!(svg instanceof SVGSVGElement)) throw new Error('Edge SVG is missing');
      const boxes = [...svg.querySelectorAll('path')].map((path) => path.getBBox());
      if (!boxes.length) throw new Error('Edge SVG has no drawn routes');
      const minX = Math.min(...boxes.map((box) => box.x));
      const minY = Math.min(...boxes.map((box) => box.y));
      const maxX = Math.max(...boxes.map((box) => box.x + box.width));
      const maxY = Math.max(...boxes.map((box) => box.y + box.height));
      const view = svg.viewBox.baseVal;
      return {
        html: world instanceof HTMLElement && overlay instanceof HTMLElement,
        view: [view.x, view.y, view.width, view.height],
        routes: [minX, minY, maxX - minX, maxY - minY],
        positioned: [
          parseFloat(svg.style.left),
          parseFloat(svg.style.top),
          Number(svg.getAttribute('width')),
          Number(svg.getAttribute('height')),
        ],
        content: [...document.querySelectorAll('.svg-content')].map((element) => ({
          viewBox: element.getAttribute('viewBox'),
          width: element.getAttribute('width'),
          height: element.getAttribute('height'),
        })),
      };
    });
    expect(result.html).toBe(true);
    expect(result.view).toEqual(result.routes);
    expect(result.positioned).toEqual(result.routes);
    for (const content of result.content) {
      const view = content.viewBox?.split(' ').map(Number);
      expect(view?.slice(2)).toEqual([Number(content.width), Number(content.height)]);
    }
  });
}

test('loads at most ten frames one at a time nearest first and pauses during pinch', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForBench(page);
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: 650, y: 450, id: 1 },
        { x: 750, y: 450, id: 2 },
      ],
    });
    await page.evaluate(async () => {
      window.frameProbe = { bootIds: [], maxLive: 0, maxBooting: 0 };
      const stage = document.getElementById('stage');
      if (!stage) throw new Error('Stage is missing');
      const observer = new MutationObserver(() => {
        for (const element of stage.querySelectorAll('[data-canvas-frame-live="true"]')) {
          const id = element.closest('[data-canvas-node-id]')?.getAttribute('data-canvas-node-id');
          if (id && !window.frameProbe.bootIds.includes(id)) window.frameProbe.bootIds.push(id);
        }
        window.frameProbe.maxLive = Math.max(
          window.frameProbe.maxLive,
          stage.querySelectorAll('[data-canvas-frame-live="true"]').length,
        );
        window.frameProbe.maxBooting = Math.max(
          window.frameProbe.maxBooting,
          stage.querySelectorAll('[data-canvas-frame-booting="true"]').length,
        );
      });
      observer.observe(stage, { subtree: true, attributes: true, childList: true });
      window.bench.setNodes(
        Array.from({ length: 15 }, (_, index) => ({
          id: `frame-${index}`,
          frame: true,
          bounds: {
            x: 100 + (index % 5) * 220,
            y: 100 + Math.floor(index / 5) * 220,
            width: 180,
            height: 160,
          },
        })),
      );
      window.canvas.setPinned(
        'frame-fixture',
        Array.from({ length: 15 }, (_, index) => `frame-${index}`),
      );
      for (let index = 0; index < 8; index += 1)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(await page.locator('[data-canvas-frame-live="true"]').count()).toBe(0);
    await expect(page.getByRole('button', { name: /^Load frame /u })).toHaveCount(15);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('[data-canvas-frame-live="true"]')).toHaveCount(10);
    await expect(page.getByRole('button', { name: /^Load frame /u })).toHaveCount(5);
    const result = await page.evaluate(() => {
      const distances = window.frameProbe.bootIds.map((id) => {
        const index = Number(id.split('-')[1]);
        return Math.hypot(
          190 + (index % 5) * 220 - innerWidth / 2,
          180 + Math.floor(index / 5) * 220 - innerHeight / 2,
        );
      });
      return { ...window.frameProbe, distances, breakpoint: window.canvas.getBreakpoint() };
    });
    expect(result.breakpoint).toBe('desktop');
    expect(result.maxLive).toBe(10);
    expect(result.maxBooting).toBe(1);
    expect(result.bootIds).toHaveLength(10);
    expect(result.distances).toEqual([...result.distances].sort((left, right) => left - right));
  } finally {
    await cdp.detach();
  }
});
