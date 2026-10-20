import { expect, test } from '@playwright/test';
import type {} from '../../bench/main';
import { waitForBench } from './bench';

for (const world of ['html', 'svg'] as const) {
  for (const band of [
    { name: 'full and compact', high: 0.64, low: 0.56, upper: 'dom', lower: 'compact' },
    { name: 'compact and overview', high: 0.44, low: 0.36, upper: 'compact', lower: 'overview' },
  ] as const) {
    test(`${world} crosses ${band.name} twenty times without blank or overlapping layers`, async ({
      page,
    }) => {
      await page.goto(`/?world=${world}`);
      await waitForBench(page);
      const result = await page.evaluate(async (band) => {
        const next = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        window.bench.setNodes([
          { id: 'focus-card', bounds: { x: 200, y: 200, width: 230, height: 66 } },
          { id: 'ordinary-card', bounds: { x: 500, y: 200, width: 230, height: 66 } },
        ]);
        window.canvas.setCamera({ x: -117, y: -83, zoom: band.high });
        for (let index = 0; index < 12; index += 1) await next();
        const focused = document.querySelector('[data-canvas-node-id="focus-card"]');
        const world = document.querySelector('[data-world]');
        if ((!(focused instanceof HTMLElement) && !(focused instanceof SVGElement)) || !world)
          throw new Error('LOD fixture layers or focus card are missing');
        focused.focus();
        await next();
        let switches = 0;
        let blank = 0;
        let both = 0;
        let lostFocus = 0;
        let hiddenFocus = 0;
        let compactFocus = 0;
        const levels: string[] = [];
        const off = window.canvas.on('level', (level) => {
          switches += 1;
          levels.push(level);
        });
        for (let crossing = 0; crossing < 20; crossing += 1) {
          window.canvas.setCamera({
            x: -117,
            y: -83,
            zoom: crossing % 2 === 0 ? band.low : band.high,
          });
          for (let frame = 0; frame < 15; frame += 1) {
            await next();
            const ordinary = document.querySelector('[data-canvas-node-id="ordinary-card"]');
            const domVisible = Boolean(
              ordinary && getComputedStyle(ordinary).visibility !== 'hidden',
            );
            const overview = document.querySelector('[data-canvas-overview]');
            const overviewVisible = Boolean(
              overview &&
                getComputedStyle(overview).visibility !== 'hidden' &&
                getComputedStyle(overview).display !== 'none',
            );
            if (!domVisible && !overviewVisible) blank += 1;
            if (domVisible && overviewVisible) both += 1;
            if (document.activeElement !== focused) lostFocus += 1;
            if (getComputedStyle(focused).visibility !== 'visible') hiddenFocus += 1;
            if (focused.getAttribute('data-card-level') !== 'dom') compactFocus += 1;
          }
        }
        off();
        return { switches, blank, both, lostFocus, hiddenFocus, compactFocus, levels };
      }, band);
      expect(result.switches).toBe(20);
      expect(result.levels).toEqual(
        Array.from({ length: 20 }, (_, index) => (index % 2 === 0 ? band.lower : band.upper)),
      );
      expect(result.blank).toBe(0);
      expect(result.both).toBe(0);
      expect(result.lostFocus).toBe(0);
      expect(result.hiddenFocus).toBe(0);
      expect(result.compactFocus).toBe(0);
      const focused = page.getByRole('button', {
        name: world === 'html' ? 'focus-card focus-card · Layer 0' : 'focus-card focus-card',
        exact: true,
      });
      for (const zoom of [band.low, band.high]) {
        await page.evaluate(async (zoom) => {
          window.canvas.setCamera({ x: -117, y: -83, zoom });
          for (let frame = 0; frame < 15; frame += 1)
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }, zoom);
        await expect(focused).toBeFocused();
        await expect(focused).toBeVisible();
        expect(await focused.ariaSnapshot()).toContain('focus-card');
      }
    });
  }
}

for (const world of ['html', 'svg']) {
  for (const fixture of ['708-997', '5000-7312']) {
    test(`${world} ${fixture} compact cards meet the DOM budget and preserve protected content`, async ({
      page,
    }) => {
      await page.goto(`/?world=${world}&fixture=${fixture}&zoom=0.4`);
      await waitForBench(page);
      await page.evaluate(async () => {
        window.canvas.setPinned('bench-test', ['node-1']);
        window.canvas.setSelection(['node-2']);
        for (let index = 0; index < 20; index += 1)
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const focused = document.querySelector('[data-canvas-node-id="node-3"]');
        if (!(focused instanceof HTMLElement) && !(focused instanceof SVGElement))
          throw new Error('Focus card is missing');
        focused.focus();
      });
      await expect(page.locator('[data-canvas-node-id="node-3"]')).toBeFocused();
      const result = await page.evaluate(() => ({
        level: window.canvas.getLevel(),
        dom: document.querySelectorAll('#stage *').length,
        compactSizes: [...document.querySelectorAll('[data-card-level="compact"]')].map(
          (element) => 1 + element.querySelectorAll('*').length,
        ),
        full: ['node-1', 'node-2', 'node-3'].map((id) => ({
          id,
          level: document
            .querySelector(`[data-canvas-node-id="${id}"]`)
            ?.getAttribute('data-card-level'),
          name: document.querySelector(`[data-canvas-node-id="${id}"]`)?.getAttribute('aria-label'),
        })),
      }));
      expect(result.level).toBe('compact');
      expect(result.dom).toBeLessThanOrEqual(2000);
      expect(result.compactSizes.length).toBeGreaterThan(0);
      for (const size of result.compactSizes) expect(size).toBe(2);
      for (const full of result.full) {
        expect(full.level, full.id).toBe('dom');
        expect(full.name, full.id).toBeTruthy();
      }
      await expect(page.locator('[data-canvas-node-id="node-3"]')).toHaveAccessibleName(
        result.full[2].name ?? '',
      );
    });
  }
}

for (const deviceScaleFactor of [1, 2]) {
  test.describe(`overview geometry at DPR ${deviceScaleFactor}`, () => {
    test.use({ deviceScaleFactor });
    test('fresh overview pixels agree with off-centre DOM bounds at both band edges', async ({
      page,
    }) => {
      await page.goto('/');
      await waitForBench(page);
      const results = await page.evaluate(async () => {
        const next = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const node = { id: 'rectangle', bounds: { x: 250, y: 150, width: 180, height: 96 } };
        window.bench.setNodes([node]);
        const results: { zoom: number; expected: number[]; actual: number[] }[] = [];
        for (const zoom of [0.37, 0.43]) {
          window.canvas.setCamera({ x: -137, y: -93, zoom: 0.3 });
          await next();
          window.bench.setNodes([{ ...node, kind: `fresh-${zoom}` }]);
          window.canvas.setCamera({ x: -137, y: -93, zoom });
          await next();
          const canvas = document.querySelector('[data-canvas-overview]');
          const stage = document.getElementById('stage');
          if (!(canvas instanceof HTMLCanvasElement) || !stage)
            throw new Error('Overview canvas is missing');
          const target = document.createElement('canvas');
          target.width = stage.clientWidth;
          target.height = stage.clientHeight;
          const context = target.getContext('2d');
          if (!context) throw new Error('Overview pixel context is unavailable');
          const box = canvas.getBoundingClientRect();
          const origin = stage.getBoundingClientRect();
          context.drawImage(
            canvas,
            box.left - origin.left,
            box.top - origin.top,
            box.width,
            box.height,
          );
          const pixels = context.getImageData(0, 0, target.width, target.height).data;
          let left = target.width;
          let top = target.height;
          let right = -1;
          let bottom = -1;
          for (let y = 0; y < target.height; y += 1) {
            for (let x = 0; x < target.width; x += 1) {
              if (pixels[(y * target.width + x) * 4 + 3] === 0) continue;
              left = Math.min(left, x);
              right = Math.max(right, x);
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
            }
          }
          const start = window.canvas.worldToScreen(node.bounds);
          results.push({
            zoom,
            expected: [
              start.x,
              start.y,
              start.x + node.bounds.width * zoom,
              start.y + node.bounds.height * zoom,
            ],
            actual: [left, top, right + 1, bottom + 1],
          });
        }
        window.canvas.setPinned('geometry', [node.id]);
        window.canvas.setCamera({ x: -137, y: -93, zoom: 0.44 });
        for (let frame = 0; frame < 10; frame += 1) await next();
        const dom = document.querySelector('[data-canvas-node-id="rectangle"]');
        if (!dom) throw new Error('DOM geometry card is missing');
        const bounds = dom.getBoundingClientRect();
        const origin = document.getElementById('stage')?.getBoundingClientRect();
        if (!origin) throw new Error('Stage geometry is missing');
        return {
          results,
          dom: [bounds.left - origin.left, bounds.top - origin.top, bounds.width, bounds.height],
          expectedDom: [(250 + 137) * 0.44, (150 + 93) * 0.44, 180 * 0.44, 96 * 0.44],
        };
      });
      for (const sample of results.results)
        for (let coordinate = 0; coordinate < 4; coordinate += 1)
          expect(
            Math.abs(sample.actual[coordinate] - sample.expected[coordinate]),
            `${sample.zoom}: coordinate ${coordinate}`,
          ).toBeLessThanOrEqual(1);
      for (let coordinate = 0; coordinate < 4; coordinate += 1)
        expect(
          Math.abs(results.dom[coordinate] - results.expectedDom[coordinate]),
        ).toBeLessThanOrEqual(1);
    });
  });
}

for (const world of ['html', 'svg']) {
  test(`${world} compact cards draw a box and clip long titles`, async ({ page }) => {
    await page.goto(`/?world=${world}&zoom=0.4`);
    await waitForBench(page);
    const result = await page.evaluate(async () => {
      const id = 'A long compact card title '.repeat(30);
      window.bench.setNodes([{ id, bounds: { x: 100, y: 100, width: 180, height: 66 } }]);
      for (let frame = 0; frame < 15; frame += 1)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const card = document.querySelector('[data-card-level="compact"]');
      if (!card) throw new Error('Compact box fixture is missing');
      const style = getComputedStyle(card);
      const title = card.firstElementChild;
      if (!title) throw new Error('Compact box title is missing');
      const titleStyle = getComputedStyle(title);
      return {
        elements: 1 + card.querySelectorAll('*').length,
        border: parseFloat(style.borderTopWidth),
        background: style.backgroundColor,
        clipped: style.overflow === 'hidden' || titleStyle.overflow === 'hidden',
        name: card.getAttribute('aria-label'),
        id: card.getAttribute('data-canvas-node-id'),
        title: title.textContent,
        width: card.getBoundingClientRect().width,
        svg: card instanceof SVGSVGElement,
        svgBounds: card instanceof SVGSVGElement ? card.getAttribute('viewBox') : null,
      };
    });
    expect(result.elements).toBe(2);
    expect(result.border).toBeGreaterThan(0);
    expect(result.background).toBe('rgb(255, 255, 255)');
    expect(result.clipped).toBe(true);
    expect(result.name).toBe(`${result.title}, ${result.id}`);
    expect(result.width).toBeCloseTo(180 * 0.4, 1);
    expect(result.svg).toBe(world === 'svg');
    if (world === 'svg') expect(result.svgBounds).toBe('0 0 180 66');
  });
}
