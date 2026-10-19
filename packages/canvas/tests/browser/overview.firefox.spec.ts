import { expect, test } from '@playwright/test';
import type {} from '../../bench/main';
import { percentile95 } from '../../src/testing/index.mts';
import { waitForBench } from './bench';

test('Firefox cached fit overview meets its frame budget and matches a fresh draw', async ({
  browserName,
  browser,
  page,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL) throw new Error('Firefox bench baseURL is missing');
  await page.goto(`${baseURL}/?fixture=5000-7312`);
  await waitForBench(page);
  const sample = await page.evaluate(() => window.bench.run('pan-fit'));
  const comparison = await page.evaluate(async () => {
    const next = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const nodes = [{ id: 'cache-rectangle', bounds: { x: 250, y: 150, width: 180, height: 96 } }];
    window.bench.setNodes(nodes);
    window.canvas.setCamera({ x: -137, y: -93, zoom: 0.3 });
    await next();
    window.canvas.panBy(27, 19);
    await next();
    const snapshot = () => {
      const canvas = document.querySelector('[data-canvas-overview]');
      const stage = document.getElementById('stage');
      if (!(canvas instanceof HTMLCanvasElement) || !stage)
        throw new Error('Cached canvas is missing');
      const target = document.createElement('canvas');
      target.width = stage.clientWidth;
      target.height = stage.clientHeight;
      const context = target.getContext('2d');
      if (!context) throw new Error('Cached pixel context is unavailable');
      const box = canvas.getBoundingClientRect();
      const origin = stage.getBoundingClientRect();
      context.drawImage(
        canvas,
        box.left - origin.left,
        box.top - origin.top,
        box.width,
        box.height,
      );
      return context.getImageData(0, 0, target.width, target.height).data;
    };
    const redraws = window.canvas.getOverviewMetrics().redraws;
    const cached = snapshot();
    window.bench.setNodes(nodes.map((node) => ({ ...node, kind: 'fresh' })));
    await next();
    const fresh = snapshot();
    let unmatchedPixels = 0;
    const stage = document.getElementById('stage');
    if (!stage) throw new Error('Cache comparison stage is missing');
    const width = stage.clientWidth;
    for (let index = 3; index < cached.length; index += 4) {
      if (cached[index] > 0 === fresh[index] > 0) continue;
      const pixel = (index - 3) / 4;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      let neighbor = false;
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          const other = ((y + dy) * width + x + dx) * 4 + 3;
          if (
            other >= 0 &&
            other < fresh.length &&
            (cached[index] > 0 ? fresh[other] > 0 : cached[other] > 0)
          )
            neighbor = true;
        }
      if (!neighbor) unmatchedPixels += 1;
    }
    return { unmatchedPixels, redraws, freshRedraws: window.canvas.getOverviewMetrics().redraws };
  });
  await testInfo.attach('firefox-overview', {
    body: JSON.stringify({ runner: browserName, version: browser.version(), sample, comparison }),
    contentType: 'application/json',
  });
  expect(percentile95(sample.intervals)).toBeLessThanOrEqual(25);
  expect(sample.domNodes).toBeLessThanOrEqual(2000);
  expect(comparison.unmatchedPixels).toBe(0);
  expect(comparison.freshRedraws).toBeGreaterThan(comparison.redraws);
});
