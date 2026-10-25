import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import type {} from '../../bench/react-main';
import {
  aggregateLayoutShifts,
  type CanvasChromeMeasurement,
  type CanvasChromeSnapshot,
  type CanvasHitTestMeasurement,
  type CanvasLodMeasurement,
  type CanvasPinMeasurement,
  type CanvasTraceIdentity,
  evaluateCanvasTrace,
  type LayoutShift,
  type LayoutShiftReport,
} from '../../src/testing/index.mts';
import { waitForBench } from './bench';
import { benchMetadata } from './metadata';
import { RUNNER_BUDGETS, SECOND_DENSITY, traceBudgetPolicy } from './trace-results';

async function chromeToggles(page: Page, requireLayoutShift: boolean) {
  return page.evaluate(async (requireLayoutShift) => {
    const supportsLayoutShift =
      typeof PerformanceObserver !== 'undefined' &&
      PerformanceObserver.supportedEntryTypes.includes('layout-shift');
    if (requireLayoutShift && !supportsLayoutShift)
      throw new Error('Canvas chrome layout-shift observation is unavailable');
    const stage = document.getElementById('stage');
    if (!stage) throw new Error('Canvas chrome stage is missing');
    const next = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const snapshot = (): CanvasChromeSnapshot => {
      const { x, y, width, height } = stage.getBoundingClientRect();
      return { camera: window.canvas.getCamera(), stage: { x, y, width, height } };
    };
    const phases: { phase: string; startTime: number }[] = [];
    const inputActions: { phase: string; phaseIndex: number; startTime: number }[] = [];
    const shifts: LayoutShift[] = [];
    const panels: { edge: 'left' | 'right'; panel: HTMLElement }[] = [];
    if (!window.chromeBench) {
      for (const edge of ['left', 'right'] as const) {
        const panel = document.createElement('aside');
        panel.id = `budget-chrome-${edge}`;
        panel.textContent = `${edge} panel`;
        Object.assign(panel.style, {
          position: 'fixed',
          top: '64px',
          bottom: '64px',
          [edge]: '0px',
          width: edge === 'left' ? '264px' : '312px',
          background: 'white',
          visibility: 'hidden',
          zIndex: '100',
        });
        document.body.append(panel);
        panels.push({ edge, panel });
      }
    }
    await next();
    await next();
    const before = snapshot();
    const rect = (value: DOMRectReadOnly) => ({
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
      top: value.top,
      right: value.right,
      bottom: value.bottom,
      left: value.left,
    });
    type ObservedShift = PerformanceEntry & {
      value: number;
      hadRecentInput: boolean;
      sources: readonly {
        node: Node | null;
        previousRect: DOMRectReadOnly;
        currentRect: DOMRectReadOnly;
      }[];
    };
    const record = (entries: readonly PerformanceEntry[]) => {
      for (const entry of entries) {
        const shift = entry as ObservedShift;
        const phase = [...phases].reverse().find((phase) => phase.startTime <= entry.startTime);
        if (!phase)
          throw new Error(`Layout shift at ${entry.startTime} has no chrome-toggle phase`);
        shifts.push({
          value: shift.value,
          startTime: shift.startTime,
          hadRecentInput: shift.hadRecentInput,
          phase: phase.phase,
          sources: shift.sources.map(({ node, previousRect, currentRect }) => ({
            selector:
              node instanceof Element
                ? node.id
                  ? `#${CSS.escape(node.id)}`
                  : node.localName
                : null,
            nodeKind:
              node === null
                ? 'unavailable'
                : node instanceof Element
                  ? 'element'
                  : node.nodeType === Node.TEXT_NODE
                    ? 'text'
                    : 'other',
            connected: node === null ? null : node.isConnected,
            previousRect: rect(previousRect),
            currentRect: rect(currentRect),
          })),
        });
      }
    };
    const observer = supportsLayoutShift
      ? new PerformanceObserver((list) => record(list.getEntries()))
      : null;
    observer?.observe({ type: 'layout-shift', buffered: false });
    const snapshots: CanvasChromeSnapshot[] = [];
    try {
      for (let index = 0; index < 16; index += 1) {
        const phase = `chrome-toggle ${index}`;
        phases.push({ phase, startTime: performance.now() });
        if (window.chromeBench) {
          document.dispatchEvent(
            new KeyboardEvent('keydown', { code: 'KeyZ', altKey: true, bubbles: true }),
          );
        } else {
          const stageBounds = stage.getBoundingClientRect();
          for (const { edge, panel } of panels) {
            const open = index % 2 === 0;
            panel.style.visibility = open ? 'visible' : 'hidden';
            const bounds = panel.getBoundingClientRect();
            window.canvas.setChrome({
              id: panel.id,
              edge,
              open,
              rect: {
                x: bounds.x - stageBounds.x,
                y: bounds.y - stageBounds.y,
                width: bounds.width,
                height: bounds.height,
              },
            });
          }
        }
        await next();
        await next();
        snapshots.push(snapshot());
      }
      await next();
      if (observer) record(observer.takeRecords());
      const layoutShifts: LayoutShiftReport | 'unsupported' = observer
        ? { phases, inputActions, shifts }
        : 'unsupported';
      return { before, after: snapshot(), snapshots, layoutShifts };
    } finally {
      observer?.disconnect();
      for (const { panel } of panels) panel.remove();
    }
  }, requireLayoutShift);
}

async function lodCrossings(page: Page, band: 'full-compact' | 'compact-overview') {
  return page.evaluate(async (band) => {
    const next = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const high = band === 'full-compact' ? 0.64 : 0.44;
    const low = band === 'full-compact' ? 0.56 : 0.36;
    window.canvas.setCamera({ x: -117, y: -83, zoom: high });
    for (let frame = 0; frame < 15; frame += 1) await next();
    let switches = 0;
    let blank = 0;
    let both = 0;
    const levels: string[] = [];
    const off = window.canvas.on('level', (level) => {
      switches += 1;
      levels.push(level);
    });
    try {
      for (let crossing = 0; crossing < 20; crossing += 1) {
        window.canvas.setCamera({ x: -117, y: -83, zoom: crossing % 2 === 0 ? low : high });
        for (let frame = 0; frame < 15; frame += 1) {
          await next();
          const ordinary = document.querySelector('[data-canvas-node-id="node-1"]');
          const domVisible = Boolean(
            ordinary &&
              getComputedStyle(ordinary).visibility !== 'hidden' &&
              getComputedStyle(ordinary).display !== 'none',
          );
          const overview = document.querySelector('[data-canvas-overview]');
          const overviewVisible = Boolean(
            overview &&
              getComputedStyle(overview).visibility !== 'hidden' &&
              getComputedStyle(overview).display !== 'none',
          );
          if (!domVisible && !overviewVisible) blank += 1;
          if (domVisible && overviewVisible) both += 1;
        }
      }
      return { band, switches, levels, blank, both };
    } finally {
      off();
    }
  }, band);
}

async function pinSample(page: Page, count: 708 | 5000, pinCount: 50 | 500) {
  return page.evaluate(
    async ({ count, pinCount }) => {
      window.canvas.setCamera({ x: 0, y: 0, zoom: 1 });
      const ids = Array.from({ length: pinCount }, (_, index) => `node-${count - index}`);
      window.canvas.setPinned('budget', ids);
      for (let frame = 0; frame < 15; frame += 1)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const mounted = window.canvas.getMountedIds();
      return {
        pinCount,
        droppedPins: ids.filter((id) => !mounted.has(id)).length,
        domNodes: document.querySelectorAll('#stage *').length,
      };
    },
    { count, pinCount },
  );
}

test('evaluates untraced fixture budgets at both pixel densities', async ({
  browser,
  browserName,
}, testInfo) => {
  test.setTimeout(600_000);
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL) throw new Error('Canvas budgets baseURL is missing');
  const metadata = benchMetadata(browser, browserName);
  const hitTests: CanvasHitTestMeasurement[] = [];
  const chrome: (CanvasChromeMeasurement & {
    classification: ReturnType<typeof aggregateLayoutShifts> | 'unsupported';
  })[] = [];
  const lod: CanvasLodMeasurement[] = [];
  const pins: CanvasPinMeasurement[] = [];
  const renderers: (CanvasTraceIdentity & { gpuRenderer: string })[] = [];
  for (const dpr of [2, 1] as const) {
    for (const fixture of [
      ...(browserName === 'chromium' && SECOND_DENSITY ? ['708-477'] : []),
      '708-997',
      ...(browserName === 'chromium' && SECOND_DENSITY ? ['5000-8499'] : []),
      '5000-7312',
      ...(browserName === 'chromium' ? ['svg-708', 'svg-5000'] : []),
    ]) {
      const world = fixture.startsWith('svg-') ? 'svg' : 'html';
      const count = fixture.includes('5000') ? 5000 : 708;
      for (const renderer of world === 'svg'
        ? (['vanilla'] as const)
        : (['vanilla', 'react'] as const)) {
        const identity = { count, fixture, renderer, world, dpr } as const;
        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          deviceScaleFactor: dpr,
          reducedMotion: 'reduce',
        });
        try {
          const page = await context.newPage();
          await page.goto(
            `${baseURL}/${renderer === 'react' ? 'react.html?chrome=1&' : '?'}fixture=${fixture}&world=${world}`,
          );
          await waitForBench(page);
          if (renderer === 'react')
            await expect(page.locator('[data-chrome-slot="toolbar"]')).toBeVisible();
          const probe = await page.evaluate(() => ({
            hitTestProbe: window.bench.probeHitTests(),
            gpuRenderer: window.bench.gpuRenderer,
          }));
          hitTests.push({ ...identity, hitTestProbe: probe.hitTestProbe });
          renderers.push({ ...identity, gpuRenderer: probe.gpuRenderer });
          const toggles = await chromeToggles(page, browserName === 'chromium');
          chrome.push({
            ...identity,
            ...toggles,
            classification:
              toggles.layoutShifts === 'unsupported'
                ? 'unsupported'
                : aggregateLayoutShifts(toggles.layoutShifts, { inputPhase: () => false }),
          });
          for (const band of ['full-compact', 'compact-overview'] as const)
            lod.push({ ...identity, ...(await lodCrossings(page, band)) });
          for (const pinCount of [50, 500] as const)
            pins.push({ ...identity, ...(await pinSample(page, count, pinCount)) });
        } finally {
          await context.close();
        }
      }
    }
  }
  const results = {
    ...metadata,
    secondDensity: browserName === 'chromium' && SECOND_DENSITY,
    budgetSet: traceBudgetPolicy(RUNNER_BUDGETS).budgetSet,
    hitTests,
    chrome,
    lod,
    pins,
    renderers,
  };
  const evaluations = ([708, 5000] as const).map((tier) => evaluateCanvasTrace(results, tier));
  const directory = resolve(import.meta.dirname, '../../test-results');
  await mkdir(directory, { recursive: true });
  const output = resolve(
    directory,
    `canvas-budgets-${browserName === 'chromium' ? '' : `${browserName}-`}${metadata.gpuMode}.json`,
  );
  await writeFile(output, `${JSON.stringify({ ...results, evaluations }, null, 2)}\n`);
  await testInfo.attach('canvas-budgets', { path: output, contentType: 'application/json' });
  for (const evaluation of evaluations)
    expect.soft(evaluation.failures, `canvas budgets tier ${evaluation.tier}`).toEqual([]);
});
