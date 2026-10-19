import { cpus, freemem, platform, release, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { expect, type Page, test } from '@playwright/test';
import { installDashboardLayoutShifts } from '../../dashboard/fixtures/dashboard-layout-shifts.js';
import {
  aggregateDashboardLayoutShifts,
  type DashboardTraceMeasurements,
  evaluateDashboardTrace,
  type InteractionTrace,
  installFixedDashboardDate,
  type RendererTraceEvent,
  rendererFrameWork,
  type SelectionSample,
  TRACE_PLAN,
} from '../../dashboard/fixtures/dashboard-trace-model.js';
import {
  buildPremiumDashboardFixture,
  FIXTURE_CLOCK,
  fixtureHash,
} from '../../dashboard/fixtures/premium-dashboard-fixtures.js';
import { productionManifest } from './premium-dashboard-server.js';

type BrowserMetrics = {
  tracing: boolean;
  shellAt: number | null;
  usefulAt: number | null;
  inputAt: number;
  frames: number[];
  longTasks: { start: number; duration: number }[];
};
declare global {
  interface Window {
    __dashboardMetrics: BrowserMetrics;
  }
}

async function installMetrics(page: Page) {
  // Playwright's clock also fakes performance.mark and requestAnimationFrame,
  // which removes the renderer marks needed to attribute real task work.
  await page.addInitScript(installFixedDashboardDate, Date.parse(FIXTURE_CLOCK));
  await page.addInitScript(installDashboardLayoutShifts);
  await page.addInitScript(() => {
    const metrics: BrowserMetrics = {
      tracing: false,
      shellAt: null,
      usefulAt: null,
      inputAt: 0,
      frames: [],
      longTasks: [],
    };
    window.__dashboardMetrics = metrics;
    document.addEventListener(
      'input',
      () => {
        metrics.inputAt = performance.now();
      },
      true,
    );
    const observer = new MutationObserver(() => {
      if (metrics.shellAt === null && document.querySelector('.pc-shell'))
        metrics.shellAt = performance.now();
      if (metrics.usefulAt === null && document.querySelector('.pc-list tbody tr[tabindex]'))
        metrics.usefulAt = performance.now();
    });
    observer.observe(document, { subtree: true, childList: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        metrics.longTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
    const frame = (time: number) => {
      metrics.frames.push(time);
      if (metrics.tracing) performance.mark('dashboard-frame');
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

async function markPhase(page: Page, phase: string) {
  await page.evaluate((phase) => window.__dashboardLayoutShifts.markPhase(phase), phase);
}

async function markInputAction(page: Page, phase: string) {
  await page.evaluate((phase) => {
    window.__dashboardLayoutShifts.markPhase(phase);
    window.__dashboardLayoutShifts.markInputAction();
  }, phase);
}

async function paintLatency(
  page: Page,
  selector: string,
  expectedText: string,
  input = false,
): Promise<number> {
  return page.evaluate(
    async ({ selector, expectedText, input }) => {
      const start = input ? window.__dashboardMetrics.inputAt : performance.now();
      while (!document.querySelector(selector)?.textContent?.includes(expectedText)) {
        if (performance.now() - start > 10_000)
          throw new Error(`Expected rendered result: ${expectedText}`);
        await new Promise(requestAnimationFrame);
      }
      await new Promise(requestAnimationFrame);
      return performance.now() - start;
    },
    { selector, expectedText, input },
  );
}

async function warmRoute(page: Page, route: string, kind: string) {
  return page.evaluate(
    async ({ route, kind }) => {
      window.__dashboardLayoutShifts.markPhase(`route-load ${route}`);
      const started = performance.now();
      window.location.hash = route;
      while (!document.querySelector(`[data-route-kind="${kind}"]`)) {
        if (performance.now() - started > 10_000) throw new Error(`Route did not render: ${route}`);
        await new Promise(requestAnimationFrame);
      }
      await new Promise(requestAnimationFrame);
      return performance.now() - started;
    },
    { route, kind },
  );
}

async function interactionTrace(
  page: Page,
  kind: 'graph' | 'list',
  attach: (events: RendererTraceEvent[]) => Promise<void>,
): Promise<InteractionTrace> {
  await markPhase(page, `pan-scroll ${kind}`);
  const session = await page.context().newCDPSession(page);
  const events: RendererTraceEvent[] = [];
  session.on('Tracing.dataCollected', ({ value }) => {
    events.push(...(value as unknown as RendererTraceEvent[]));
  });
  await session.send('Tracing.start', {
    categories:
      'devtools.timeline,disabled-by-default-devtools.timeline,toplevel,blink.user_timing',
    transferMode: 'ReportEvents',
  });
  const selector = kind === 'graph' ? '.pc-graph' : '.pc-list';
  const target = page.locator(selector);
  const box = await target.boundingBox();
  if (!box) throw new Error(`Missing ${kind} interaction surface.`);
  await page.mouse.move(
    box.x + Math.min(box.width / 2, 400),
    box.y + Math.min(box.height / 2, 200),
  );
  const before = await page.evaluate((selector) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error('Missing interaction surface.');
    return {
      scroll:
        element.scrollTop +
        element.scrollLeft +
        (document.querySelector('.pc-shell__scroll')?.scrollTop ?? 0),
      transform: element.querySelector('.pc-graph__canvas')?.getAttribute('style') ?? '',
    };
  }, selector);
  const started = await page.evaluate(() => {
    window.__dashboardMetrics.tracing = true;
    performance.mark('dashboard-interaction-start');
    return performance.now();
  });
  let scrollObserved = false;
  let zoomObserved = kind !== 'graph';
  let ended = started;
  try {
    let step = 0;
    while ((await page.evaluate(() => performance.now())) - started < TRACE_PLAN.durationMs) {
      const direction = Math.floor(step / 20) % 2 === 0 ? 1 : -1;
      await page.mouse.wheel(kind === 'graph' ? direction * 120 : 0, direction * 180);
      if (kind === 'graph' && step % 10 === 0) {
        await page.keyboard.down('Control');
        await page.mouse.wheel(0, direction * 60);
        await page.keyboard.up('Control');
      }
      const state = await page.evaluate((selector) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error('Interaction surface disappeared.');
        return {
          scroll:
            element.scrollTop +
            element.scrollLeft +
            (document.querySelector('.pc-shell__scroll')?.scrollTop ?? 0),
          transform: element.querySelector('.pc-graph__canvas')?.getAttribute('style') ?? '',
        };
      }, selector);
      scrollObserved ||= state.scroll !== before.scroll;
      zoomObserved ||= state.transform !== before.transform;
      step += 1;
    }
  } finally {
    ended = await page.evaluate(() => {
      performance.mark('dashboard-interaction-end');
      window.__dashboardMetrics.tracing = false;
      return performance.now();
    });
    const complete = new Promise<void>((resolve) =>
      session.once('Tracing.tracingComplete', () => resolve()),
    );
    await session.send('Tracing.end');
    await complete;
    await session.detach();
  }
  const measured = await page.evaluate(
    ({ started, end }) => {
      const metrics = window.__dashboardMetrics;
      const frames = metrics.frames.filter((time) => time >= started && time <= end);
      const shifts = window.__dashboardLayoutShifts.snapshot().shifts;
      return {
        durationMs: end - started,
        frameIntervalsMs: frames.slice(1).map((time, index) => time - frames[index]),
        longTasksMs: metrics.longTasks
          .filter((entry) => entry.start >= started && entry.start < end)
          .map((entry) => entry.duration),
        cls: shifts
          .filter((entry) => entry.startTime >= started && entry.startTime < end)
          .reduce((sum, entry) => sum + entry.value, 0),
      };
    },
    { started, end: ended },
  );
  await attach(events);
  return {
    ...measured,
    frameWorkMs: rendererFrameWork(events),
    interactionObserved: scrollObserved && zoomObserved,
    ...(kind === 'graph' && !zoomObserved
      ? {
          pendingReason:
            'The current production graph has no working zoom interaction; pan measurements alone do not certify pan/zoom.',
        }
      : {}),
  };
}

async function selectionSample(page: Page, id: string): Promise<SelectionSample> {
  return page.evaluate((id) => {
    const selected = document.querySelector<HTMLElement>('.pc-list tr[data-selected="true"]');
    const focused = document.activeElement;
    const canonicalId =
      document.querySelector('[aria-label="Inspector"] .pc-shell-inspector__head .pc-artifact-tag')
        ?.textContent ?? null;
    const matching = canonicalId === id && selected?.getAttribute('data-keyboard-item') === id;
    let scrollTop = window.scrollY;
    for (let parent = selected?.parentElement; parent; parent = parent.parentElement)
      scrollTop += parent.scrollTop;
    return {
      id: matching ? id : null,
      focusedId: selected === focused ? id : null,
      scrollTop,
      anchorTop: selected?.getBoundingClientRect().top ?? -1,
    };
  }, id);
}

export function registerDashboardPerformanceTraceTests() {
  test.afterEach(async ({ page }, testInfo) => {
    if (page.isClosed()) return;
    const raw = await page.evaluate(() => window.__dashboardLayoutShifts?.snapshot());
    if (!raw || raw.shifts.length === 0) return;
    const layoutShifts = aggregateDashboardLayoutShifts(raw);
    await testInfo.attach('dashboard-layout-shifts.json', {
      body: Buffer.from(JSON.stringify({ test: testInfo.title, ...layoutShifts }, null, 2)),
      contentType: 'application/json',
    });
  });
  for (const dataset of ['representative', 'scaling'] as const) {
    test(`records production dashboard ${dataset} performance`, async ({
      page,
      browser,
    }, testInfo) => {
      test.setTimeout(240_000);
      const fixture = buildPremiumDashboardFixture(dataset);
      const errors: string[] = [];
      const assets = new Set<string>();
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('crash', () => errors.push('Renderer crashed.'));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('response', (response) => {
        if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
        if (['script', 'stylesheet', 'font'].includes(response.request().resourceType()))
          assets.add(new URL(response.url()).pathname);
      });
      await installMetrics(page);
      const reset = await page.request.post(`/__fixture/reset?dataset=${dataset}`);
      expect(reset.ok(), await reset.text()).toBe(true);
      await page.setViewportSize(fixture.manifest.artboard.layout.desktop);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      await cdp.send('Network.clearBrowserCache');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await page.goto(`/__production/?dataset=${dataset}#/list`);
      await expect(page.locator('.pc-list tbody tr[tabindex]').first()).toBeVisible();
      const cold = await page.evaluate(() => window.__dashboardMetrics);
      expect(cold.shellAt).not.toBeNull();
      expect(cold.usefulAt).not.toBeNull();
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
      await cdp.detach();
      await page.evaluate(() => document.fonts.ready);
      const warmRoutesMs: number[] = [];
      const panelsMs: number[] = [];
      const filterMs: number[] = [];
      const paletteMs: number[] = [];
      let palettePreviewMs: number[] | null = [];
      const patchesMs: number[] = [];
      for (let index = 0; index < 20; index += 1) {
        warmRoutesMs.push(await warmRoute(page, '#/board', 'planning.board'));
        warmRoutesMs.push(await warmRoute(page, '#/list', 'planning.list'));
      }
      const filter = page.getByRole('textbox', { name: 'Filter by id or title' });
      for (let index = 0; index < TRACE_PLAN.inputCount; index += 1) {
        const node = fixture.graph.nodes[index];
        await markInputAction(page, `filter-input ${index + 1}`);
        await filter.fill(index % 2 === 0 ? node.id : node.title);
        filterMs.push(await paintLatency(page, '.pc-list tbody', node.title, true));
      }
      await markInputAction(page, 'palette open');
      await page.keyboard.press('Control+K');
      const palette = page.locator('dialog.pc-palette');
      for (let index = 0; index < TRACE_PLAN.inputCount; index += 1) {
        const node = fixture.graph.nodes[index];
        await markInputAction(page, `palette query ${index + 1}`);
        await palette.getByRole('searchbox').fill(index % 2 === 0 ? node.id : node.title);
        paletteMs.push(await paintLatency(page, '.pc-palette__results', node.title, true));
        const previewSelector = '[data-palette-preview], .pc-palette__preview';
        if (await palette.locator(previewSelector).count()) {
          if (palettePreviewMs !== null)
            palettePreviewMs.push(await paintLatency(page, previewSelector, node.title, true));
        } else palettePreviewMs = null;
      }
      const palettePreviewAvailable =
        (await palette.locator('[data-palette-preview], .pc-palette__preview').count()) > 0;
      await markInputAction(page, 'palette close');
      await page.keyboard.press('Escape');
      await markInputAction(page, 'filter-input selected item');
      await filter.fill(fixture.manifest.selectedId);
      const rows = page.locator('.pc-list tbody tr[tabindex]');
      await expect(rows).toHaveCount(1);
      const row = rows.first();
      for (let index = 0; index < 20; index += 1) {
        await markPhase(page, `inspector ${index + 1}`);
        const hideInspector = page.getByRole('button', { name: 'Hide inspector', exact: true });
        if (await hideInspector.count()) await hideInspector.click();
        const latency = await row.evaluate(async (element) => {
          const started = performance.now();
          if (!(element instanceof HTMLElement)) throw new Error('Expected an HTML artifact row.');
          element.click();
          while (
            !document
              .querySelector('[aria-label="Inspector"]')
              ?.textContent?.includes(
                element.querySelector('.pc-work-item__title')?.textContent ?? '',
              )
          ) {
            if (performance.now() - started > 10_000) throw new Error('Inspector did not render.');
            await new Promise(requestAnimationFrame);
          }
          await new Promise(requestAnimationFrame);
          return performance.now() - started;
        });
        panelsMs.push(latency);
      }
      await markInputAction(page, 'filter-input type task');
      await page.getByRole('combobox', { name: 'Filter by type' }).selectOption('task');
      await markInputAction(page, 'filter-input clear text');
      await filter.fill('');
      const selectedRow = page.locator('.pc-list tbody tr[data-selected="true"]');
      await expect(selectedRow).toHaveCount(1);
      await selectedRow.focus();
      await markPhase(page, 'pan-scroll patch anchor');
      await page.evaluate(() => {
        const scroller = document.querySelector('.pc-shell__scroll');
        if (!scroller) throw new Error('Missing dashboard scroll container.');
        scroller.scrollTop = 30;
        if (scroller.scrollTop === 0)
          throw new Error('Patch fixture must have a nonzero scroll anchor.');
      });
      const selectionBefore = await selectionSample(page, fixture.manifest.selectedId);
      const selectionAfter: SelectionSample[] = [];
      for (let index = 1; index <= TRACE_PLAN.patchCount; index += 1) {
        await markPhase(page, `patch ${index}`);
        const started = performance.now();
        const response = await page.request.post(`/__fixture/patch?dataset=${dataset}`);
        expect(response.ok(), await response.text()).toBe(true);
        await expect(selectedRow).toContainText(`Fixture patch ${index}`);
        patchesMs.push(performance.now() - started);
        selectionAfter.push(await selectionSample(page, fixture.manifest.selectedId));
      }
      await testInfo.attach('dashboard-patch-retention.json', {
        body: Buffer.from(JSON.stringify({ selectionBefore, selectionAfter }, null, 2)),
        contentType: 'application/json',
      });
      await markInputAction(page, 'filter-input clear type');
      await page.getByRole('combobox', { name: 'Filter by type' }).selectOption('all');
      await expect(page.locator('.pc-list')).toContainText(
        `${fixture.manifest.nodeCount} of ${fixture.manifest.nodeCount}`,
      );
      const list = await interactionTrace(page, 'list', async (events) =>
        testInfo.attach('list-renderer-trace.json', {
          body: Buffer.from(JSON.stringify({ traceEvents: events })),
          contentType: 'application/json',
        }),
      );
      await warmRoute(page, '#/graph', 'planning.graph');
      const graph = await interactionTrace(page, 'graph', async (events) =>
        testInfo.attach('graph-renderer-trace.json', {
          body: Buffer.from(JSON.stringify({ traceEvents: events })),
          contentType: 'application/json',
        }),
      );
      const stateResponse = await page.request.get(`/__fixture/state?dataset=${dataset}`);
      expect(stateResponse.ok()).toBe(true);
      const state = await stateResponse.json();
      expect(state.cursor.eventHead.sequence).toBe(TRACE_PLAN.patchCount);
      expect(state.cursor.viewHash).toBe(
        fixtureHash({
          ...fixture.graph,
          nodes: fixture.graph.nodes.map((node) =>
            node.id === fixture.manifest.selectedId
              ? { ...node, title: `Fixture patch ${TRACE_PLAN.patchCount}` }
              : node,
          ),
        }),
      );
      const layoutShiftEvidence = await page.evaluate(() => window.__dashboardLayoutShifts.snapshot());
      const cls = aggregateDashboardLayoutShifts(layoutShiftEvidence).admittedCls;
      const metrics: DashboardTraceMeasurements = {
        coldShellMs: cold.shellAt ?? Number.NaN,
        usefulSnapshotMs: cold.usefulAt ?? Number.NaN,
        warmRoutesMs,
        panelsMs,
        filterMs,
        paletteMs,
        palettePreviewMs,
        patchesMs,
        graph,
        list,
        cls,
        layoutShiftEvidence,
        selectionBefore,
        selectionAfter,
        nodeCount: state.graphCounts.nodes,
        edgeCount: state.graphCounts.edges,
        browserErrors: errors,
      };
      const evaluation = evaluateDashboardTrace(dataset, metrics);
      const metadata = {
        node: process.version,
        os: {
          platform: platform(),
          release: release(),
          image: process.env.ImageOS ?? 'local',
          imageVersion: process.env.ImageVersion ?? null,
        },
        cpu: cpus().map(({ model, speed }) => ({ model, speed })),
        memory: { total: totalmem(), free: freemem() },
        browser: browser.version(),
        viewport: page.viewportSize(),
        runner: process.env.RUNNER_NAME ?? 'local',
        throttling: { cpu: 'disabled', network: 'disabled' },
        build: { ...productionManifest(), servedAssets: [...assets].sort(), mode: 'production' },
      };
      await testInfo.attach('dashboard-performance.json', {
        body: Buffer.from(
          JSON.stringify(
            {
              fixture: fixture.manifest,
              manifestHash: fixture.manifestHash,
              metrics,
              evaluation,
              metadata,
              capabilities: {
                palettePreview: {
                  available: palettePreviewAvailable,
                  reason: palettePreviewAvailable
                    ? null
                    : 'Production palette does not expose a preview surface.',
                },
                graphPanZoom: {
                  available: graph.interactionObserved,
                  reason: graph.interactionObserved
                    ? null
                    : 'Graph scroll and canvas zoom were not both observed.',
                },
              },
            },
            null,
            2,
          ),
        ),
        contentType: 'application/json',
      });
      expect([...assets].every((asset) => asset.startsWith('/__production/'))).toBe(true);
      expect(evaluation.failures).toEqual([]);
      if (evaluation.pending.length > 0) {
        for (const scenario of evaluation.pending)
          testInfo.annotations.push({
            type: 'pending',
            description: `${scenario.scenario}: ${scenario.reason}`,
          });
        test.skip(
          true,
          evaluation.pending
            .map((scenario) => `${scenario.scenario}: ${scenario.reason}`)
            .join(' '),
        );
      }
    });
  }
}
