import { mkdir, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release } from 'node:os';
import { resolve } from 'node:path';
import {
  type Browser,
  type BrowserContext,
  type CDPSession,
  expect,
  type Page,
  test,
} from '@playwright/test';
import type { Scenario } from '../../bench/main';
import {
  CANVAS_TRACE_BUDGETS,
  type CanvasTraceMeasurement,
  evaluateCanvasTrace,
  percentile95,
  type RendererTraceEvent,
  rendererFrameWork,
  toClockResolution,
} from '../../src/testing/index.mts';
import { waitForBench } from './bench';
import { benchMetadata } from './metadata';
import { recordRafRun } from './raf-trace';
import {
  aggregateTraceRuns,
  DOM_NODE_BUDGET,
  domBudgetPolicy,
  RUNNER_BUDGETS,
  SECOND_DENSITY,
  type TraceRun,
  traceBudgetPolicy,
  traceOwnership,
} from './trace-results';

// Software-GL runners can present at 30 fps and have noisy chunked remount timings.
const budgets = traceBudgetPolicy(RUNNER_BUDGETS);

function traceEvents(input: unknown): RendererTraceEvent[] {
  if (
    typeof input !== 'object' ||
    input === null ||
    !('traceEvents' in input) ||
    !Array.isArray(input.traceEvents)
  ) {
    throw new TypeError('Chromium trace must contain a traceEvents array');
  }
  return input.traceEvents.map((event: unknown) => {
    if (
      typeof event !== 'object' ||
      event === null ||
      !('name' in event) ||
      typeof event.name !== 'string' ||
      !('ph' in event) ||
      typeof event.ph !== 'string' ||
      !('ts' in event) ||
      typeof event.ts !== 'number' ||
      !('pid' in event) ||
      typeof event.pid !== 'number' ||
      !('tid' in event) ||
      typeof event.tid !== 'number'
    ) {
      throw new TypeError('Chromium trace event is missing name, ph, ts, pid or tid');
    }
    const result: RendererTraceEvent = {
      name: event.name,
      ph: event.ph,
      ts: event.ts,
      pid: event.pid,
      tid: event.tid,
    };
    if ('dur' in event && typeof event.dur === 'number') result.dur = event.dur;
    if (
      'args' in event &&
      typeof event.args === 'object' &&
      event.args !== null &&
      'name' in event.args &&
      typeof event.args.name === 'string'
    )
      result.args = { name: event.args.name };
    return result;
  });
}
async function finishTrace(session: CDPSession): Promise<RendererTraceEvent[]> {
  const completed = new Promise<string>((resolveStream, reject) => {
    session.once('Tracing.tracingComplete', (event: { stream?: string }) => {
      if (!event.stream) reject(new Error('Chromium trace stream is missing'));
      else resolveStream(event.stream);
    });
  });
  await session.send('Tracing.end');
  const stream = await completed;
  let contents = '';
  try {
    for (;;) {
      const chunk = await session.send('IO.read', { handle: stream });
      contents += chunk.base64Encoded
        ? Buffer.from(chunk.data, 'base64').toString('utf8')
        : chunk.data;
      if (chunk.eof) break;
    }
  } finally {
    await session.send('IO.close', { handle: stream });
  }
  const parsed: unknown = JSON.parse(contents);
  return traceEvents(parsed);
}

type Measurement = {
  count: 708 | 5000;
  fixture: string;
  ownership: ReturnType<typeof traceOwnership>;
  domBudget: ReturnType<typeof domBudgetPolicy>;
  world: 'html' | 'svg';
  renderer: 'vanilla' | 'react';
  dpr: 1 | 2;
  scenario: Scenario | 'remount';
  gpuRenderer: string;
  hitTestP95Ms: number;
  rendererMainP95Ms: number;
  rafIntervalP95Ms: number;
  rafIntervalP95MsAtClockResolution: number;
  runs: readonly TraceRun[];
  firstFrameP50Ms: number;
  firstFrameTrialsMs: number[];
  effectiveBudgets: Omit<
    Measurement['referenceBudgets'],
    'rendererMainP95Ms' | 'rafIntervalP95Ms'
  > & {
    rendererMainP95Ms: number | null;
    rafIntervalP95Ms: number | null;
  };
  referenceBudgets: {
    hitTestP95Ms: number;
    rendererMainP95Ms: number;
    rafIntervalP95Ms: number;
    longTasksOver50Ms: number;
    firstFrameP50Ms: number;
    domNodes: number;
  };
};

type Tier = {
  count: 708 | 5000;
  fixture: string;
  world: 'html' | 'svg';
  dpr: 1 | 2;
  renderer?: 'vanilla' | 'react';
};

async function firstFrames(context: BrowserContext, url: string): Promise<number[]> {
  const trials: number[] = [];
  for (let load = 0; load < CANVAS_TRACE_BUDGETS.firstFrameLoads; load += 1) {
    const page = await context.newPage();
    try {
      await page.goto(url);
      await waitForBench(page);
      trials.push(
        await page.evaluate(async () => {
          await window.bench.ready;
          return window.bench.firstFrameMs;
        }),
      );
    } finally {
      await page.close();
    }
  }
  return trials;
}

async function recordRuns(
  page: Page,
  session: CDPSession,
  scenario: Scenario | 'remount',
): Promise<TraceRun[]> {
  const runs: TraceRun[] = [];
  for (let run = 1; run <= 3; run += 1) {
    await session.send('Tracing.start', {
      categories:
        'toplevel,devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing',
      transferMode: 'ReturnAsStream',
    });
    const sample =
      scenario === 'remount'
        ? await page.evaluate(() => window.bench.remount())
        : await page.evaluate((name) => window.bench.run(name), scenario);
    const events = await finishTrace(session);
    if (sample.longTasks === null)
      throw new Error('Long-task observations are unavailable for the Chromium trace');
    const rendererSamples = rendererFrameWork(
      events,
      scenario === 'remount' ? { start: 'canvas-remount-start', end: 'canvas-remount-end' } : {},
    );
    if ('mountCounts' in sample) {
      expect(sample.mountCounts.length).toBeGreaterThanOrEqual(5);
      expect(Math.max(...sample.mountCounts)).toBeLessThanOrEqual(200);
    }
    runs.push({
      run,
      gpuRenderer: sample.gpuRenderer,
      hitTestP95Ms: sample.hitTestP95Ms,
      hitTestProbe: sample.hitTestProbe,
      rendererMainP95Ms: percentile95(rendererSamples),
      rendererMainWorstMs: Math.max(...rendererSamples),
      overview: sample.overview,
      rafIntervalP95Ms: percentile95(sample.intervals),
      longTasksOver50Ms: sample.longTasks.length,
      longTaskDurationsMs: sample.longTasks,
      domNodes: sample.domNodes,
      rendererFrameSamples: rendererSamples.length,
      ...('mountCounts' in sample ? { mountCounts: sample.mountCounts } : {}),
      ...(sample.react ? { react: sample.react } : {}),
    });
  }
  return runs;
}

async function measureTier(browser: Browser, baseURL: string, tier: Tier): Promise<Measurement[]> {
  const { count, fixture, world, dpr, renderer = 'vanilla' } = tier;
  const url = `${baseURL}/${renderer === 'react' ? 'react.html' : ''}?fixture=${fixture}&world=${world}`;
  const mainBudget =
    CANVAS_TRACE_BUDGETS.rendererMainP95Ms[world === 'svg' ? 'svg' : renderer][count];
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: dpr,
  });
  try {
    const firstFrameTrialsMs = await firstFrames(context, url);
    const firstFrameP50Ms = [...firstFrameTrialsMs].sort((a, b) => a - b)[2];
    const page = await context.newPage();
    await page.goto(url);
    await waitForBench(page);
    if (count === 708) await page.evaluate(() => window.bench.run('pan-100'));
    const session = await context.newCDPSession(page);
    try {
      const measurements: Measurement[] = [];
      const scenarios: (Scenario | 'remount')[] = [
        'pan-100',
        'pan-40',
        'pan-fit',
        'zoom-sweep',
        'remount',
      ];
      for (const scenario of scenarios) {
        const runs = await recordRuns(page, session, scenario);
        const aggregate = aggregateTraceRuns(runs);
        const referenceBudgets = {
          rendererMainP95Ms:
            scenario === 'remount' ? CANVAS_TRACE_BUDGETS.remountRendererMainP95Ms : mainBudget,
          rafIntervalP95Ms: CANVAS_TRACE_BUDGETS.rafIntervalP95Ms,
          longTasksOver50Ms: CANVAS_TRACE_BUDGETS.longTasksOver50Ms,
          firstFrameP50Ms: CANVAS_TRACE_BUDGETS.firstFrameP50Ms,
          domNodes: DOM_NODE_BUDGET,
          hitTestP95Ms: CANVAS_TRACE_BUDGETS.hitTestP95Ms,
        };
        measurements.push({
          count,
          fixture,
          ownership: traceOwnership({ count, world, scenario }),
          domBudget: domBudgetPolicy({ count, world, scenario }),
          world,
          renderer,
          dpr,
          scenario,
          gpuRenderer: runs[0].gpuRenderer,
          ...aggregate,
          rafIntervalP95MsAtClockResolution: toClockResolution(aggregate.rafIntervalP95Ms),
          firstFrameP50Ms,
          firstFrameTrialsMs,
          referenceBudgets,
          effectiveBudgets: {
            ...referenceBudgets,
            rendererMainP95Ms:
              scenario === 'remount'
                ? budgets.remountRendererMainP95Ms
                : scenario === 'zoom-sweep' && world === 'html' && count === 5000
                  ? (budgets.htmlZoomSweep5000RendererMainP95Ms ?? mainBudget)
                  : (scenario === 'pan-40' || scenario === 'zoom-sweep') &&
                      renderer === 'vanilla' &&
                      world === 'html' &&
                      count === 708
                    ? (budgets.vanillaHtml708PanZoomRendererMainP95Ms ?? mainBudget)
                    : mainBudget,
            rafIntervalP95Ms: budgets.rafIntervalP95Ms,
            firstFrameP50Ms: budgets.firstFrameP50Ms,
          },
        });
      }
      return measurements;
    } finally {
      await session.detach();
      await page.close();
    }
  } finally {
    await context.close();
  }
}

test('records production camera traces beside the reference budgets', async ({
  browser,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Renderer main-thread traces require Chromium CDP');
  test.setTimeout(1_800_000);
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL) throw new Error('Canvas trace baseURL is missing');
  const measurements: Measurement[] = [];
  for (const dpr of [2, 1] as const) {
    for (const count of [708, 5000] as const) {
      const fixture = count === 708 ? '708-997' : '5000-7312';
      for (const world of ['html', 'svg'] as const) {
        measurements.push(
          ...(await measureTier(browser, baseURL, {
            count,
            fixture: world === 'svg' ? `svg-${count}` : fixture,
            world,
            dpr,
          })),
        );
      }
      measurements.push(
        ...(await measureTier(browser, baseURL, {
          count,
          fixture,
          world: 'html',
          dpr,
          renderer: 'react',
        })),
      );
      if (SECOND_DENSITY) {
        for (const renderer of ['vanilla', 'react'] as const) {
          measurements.push(
            ...(await measureTier(browser, baseURL, {
              count,
              fixture: count === 708 ? '708-477' : '5000-8499',
              world: 'html',
              dpr,
              renderer,
            })),
          );
        }
      }
    }
  }
  const metadata = benchMetadata(browser, browserName);
  const results = {
    ...metadata,
    secondDensity: SECOND_DENSITY,
    budgetSet: budgets.budgetSet,
    measurements,
  };
  const evaluations = ([708, 5000] as const).map((tier) => evaluateCanvasTrace(results, tier));
  const report = {
    ...metadata,
    secondDensity: SECOND_DENSITY,
    evaluations,
    runner: {
      os: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      ci: Boolean(process.env.CI),
    },
    reference: 'Apple M5 Max; approved reference budgets',
    budgetSet: budgets.budgetSet,
    stage: { width: 1440, height: 900 },
    frames: 180,
    remount: {
      nodes: 968,
      maxMountsPerFrame: 200,
      minimumFrames: 5,
      rendererMainP95BudgetMs: budgets.remountRendererMainP95Ms,
      rendererMainP95Budget: budgets.remountRendererMainP95Ms ?? 'reported (reference 16)',
    },
    recordedRunsPerScenario: 3,
    aggregation: 'median of three per-run p95s',
    clockResolution: 'interval gates compare the rAF median rounded to 0.1 ms; raw values are kept',
    hitTest: {
      method: 'p95 of per-query means at 1000 seeded screen points',
      minimumSampleDurationMs: 1,
      units: 'milliseconds per query',
      window: 'outside interaction marks',
    },
    react: {
      commits: 'DevTools production root commits during each measured scenario',
      pureCameraFrames: 'interaction frames with no mount or level events',
      pureCameraCommits:
        'commits during those pure camera frames; mount and level changes are reported separately',
    },
    overview: {
      redraws: 'per-scenario difference between final and initial redraw counters',
      cachePixelBytes: 'final reported cache allocation',
      peakCachePixelBytes:
        'maximum reported cache allocation at scenario start, each animation frame and scenario end',
    },
    warmup: {
      count: 708,
      scenario: 'pan-100',
      runsPerInteractionPage: 1,
      traced: false,
      discarded: true,
    },
    measurements,
  };
  const output = resolve(
    import.meta.dirname,
    `../../test-results/bench-trace-${metadata.gpuMode}.json`,
  );
  await mkdir(resolve(import.meta.dirname, '../../test-results'), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach('bench-trace', { path: output, contentType: 'application/json' });
  process.stdout.write(
    [
      '| Fixture | Renderer | World | DPR | Scenario | Ownership | Budget set | Main p95 median / effective budget ms | Raw main p95s ms | rAF p95 median at 0.1 ms (raw) / effective budget ms | Raw rAF p95s ms | Long tasks per run | Long-task durations per run ms | First frame p50 / budget ms | DOM nodes per run | GPU renderer | Hit-test p95 median / budget ms | DOM ownership | DOM reference budget / regression limit | Hit-test queries per run | Overview redraws per run | Overview cache bytes per run | Peak overview cache bytes per run | React metrics per run |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...measurements.map(
        (item) =>
          `| ${item.fixture} | ${item.renderer} | ${item.world} | ${item.dpr} | ${item.scenario} | ${item.ownership} | ${budgets.budgetSet} | ${item.rendererMainP95Ms} / ${item.effectiveBudgets.rendererMainP95Ms ?? `reported (reference ${item.referenceBudgets.rendererMainP95Ms})`} | ${JSON.stringify(item.runs.map((run) => run.rendererMainP95Ms))} | ${item.rafIntervalP95MsAtClockResolution} (${item.rafIntervalP95Ms}) / ${item.effectiveBudgets.rafIntervalP95Ms ?? `reported (reference ${item.referenceBudgets.rafIntervalP95Ms})`} | ${JSON.stringify(item.runs.map((run) => run.rafIntervalP95Ms))} | ${JSON.stringify(item.runs.map((run) => run.longTasksOver50Ms))} | ${JSON.stringify(item.runs.map((run) => run.longTaskDurationsMs))} | ${item.firstFrameP50Ms} / ${item.effectiveBudgets.firstFrameP50Ms}${item.effectiveBudgets.firstFrameP50Ms === item.referenceBudgets.firstFrameP50Ms ? '' : ` (reference ${item.referenceBudgets.firstFrameP50Ms})`} | ${JSON.stringify(item.runs.map((run) => run.domNodes))} | ${item.gpuRenderer} | ${item.hitTestP95Ms} / ${item.referenceBudgets.hitTestP95Ms} | ${item.domBudget.ownership} | ${item.referenceBudgets.domNodes} / ${item.domBudget.regressionLimit ?? 'reported'} | ${JSON.stringify(item.runs.map((run) => run.hitTestProbe.queryCount))} | ${JSON.stringify(item.runs.map((run) => run.overview.redraws))} | ${JSON.stringify(item.runs.map((run) => run.overview.cachePixelBytes))} | ${JSON.stringify(item.runs.map((run) => run.overview.peakCachePixelBytes))} | ${JSON.stringify(item.runs.map((run) => run.react ?? null))} |`,
      ),
      '',
    ].join('\n'),
  );
  for (const evaluation of evaluations)
    expect.soft(evaluation.failures, `canvas trace tier ${evaluation.tier}`).toEqual([]);
});

async function measureRafTier(
  browser: Browser,
  baseURL: string,
  tier: Tier,
  browserName: 'webkit' | 'firefox',
) {
  const { count, fixture, dpr, renderer = 'vanilla' } = tier;
  const url = `${baseURL}/${renderer === 'react' ? 'react.html' : ''}?fixture=${fixture}`;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: dpr,
  });
  try {
    const firstFrameTrialsMs = await firstFrames(context, url);
    const firstFrameP50Ms = [...firstFrameTrialsMs].sort((a, b) => a - b)[2];
    const page = await context.newPage();
    await page.goto(url);
    await waitForBench(page);
    if (count === 708) await page.evaluate(() => window.bench.run('pan-100'));
    const scenarios: Scenario[] =
      browserName === 'webkit'
        ? ['pan-100', 'pan-40', 'pan-fit', 'zoom-sweep']
        : ['pan-100', 'pan-fit'];
    const measurements = [];
    for (const scenario of scenarios) {
      const runs = [];
      for (let run = 1; run <= 3; run += 1)
        runs.push({ run, ...(await recordRafRun(page, scenario)) });
      const item = {
        count,
        fixture,
        renderer,
        world: 'html' as const,
        dpr,
        scenario,
        firstFrameP50Ms,
        firstFrameTrialsMs,
        runs,
      } satisfies CanvasTraceMeasurement;
      measurements.push(item);
    }
    return measurements;
  } finally {
    await context.close();
  }
}

test('records non-CDP camera traces beside the browser reference budgets', async ({
  browser,
  browserName,
}, testInfo) => {
  test.skip(browserName === 'chromium', 'Chromium uses its renderer main-thread trace');
  if (browserName === 'chromium') return;
  test.setTimeout(1_800_000);
  const started = Date.now();
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL) throw new Error('Canvas rAF trace baseURL is missing');
  const measurements = [];
  for (const dpr of [2, 1] as const) {
    for (const count of [708, 5000] as const) {
      for (const renderer of ['vanilla', 'react'] as const) {
        measurements.push(
          ...(await measureRafTier(
            browser,
            baseURL,
            {
              count,
              fixture: count === 708 ? '708-997' : '5000-7312',
              world: 'html',
              dpr,
              renderer,
            },
            browserName,
          )),
        );
      }
    }
  }
  const metadata = benchMetadata(browser, browserName);
  const results = { ...metadata, budgetSet: budgets.budgetSet, measurements };
  const evaluations = ([708, 5000] as const).map((tier) => evaluateCanvasTrace(results, tier));
  const durationMs = Date.now() - started;
  const report = {
    ...results,
    evaluations,
    secondDensity: false,
    runner: {
      os: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      ci: RUNNER_BUDGETS,
    },
    durationMs,
    runnerMinutes: durationMs / 60_000,
    stage: { width: 1440, height: 900 },
    frames: 180,
    recordedRunsPerScenario: 3,
    aggregation: 'median of three per-run rAF p95s; worst frame checked per run',
    clockResolution: 'interval gates compare values rounded to 0.1 ms; raw intervals are kept',
    measurementPath:
      'bench requestAnimationFrame intervals bounded by canvas interaction and frame marks',
    referenceBudgets: CANVAS_TRACE_BUDGETS[browserName],
    effectiveBudgets: {
      ...CANVAS_TRACE_BUDGETS[browserName],
      ...(budgets.rafIntervalP95Ms === null
        ? browserName === 'webkit'
          ? { rafIntervalP95Ms: null, pan40WorstFrameMs: null }
          : { pan100FrameP95Ms: null, panFitFrameP95Ms: null }
        : {}),
      firstFrameP50Ms: budgets.firstFrameP50Ms,
      ...(browserName === 'webkit'
        ? { reactFirstFrameP50Ms: budgets.webkitReactFirstFrameP50Ms ?? budgets.firstFrameP50Ms }
        : {}),
    },
  };
  const directory = resolve(import.meta.dirname, '../../test-results');
  await mkdir(directory, { recursive: true });
  const output = resolve(directory, `bench-trace-${browserName}-${metadata.gpuMode}.json`);
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach(`bench-trace-${browserName}`, {
    path: output,
    contentType: 'application/json',
  });
  for (const evaluation of evaluations)
    expect
      .soft(evaluation.failures, `canvas ${browserName} trace tier ${evaluation.tier}`)
      .toEqual([]);
});

test('measures cached canvas and worker overview work, cache memory and presentation lag', async ({
  browser,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Overview renderer comparison requires Chromium CDP');
  test.setTimeout(600_000);
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL) throw new Error('Overview comparison baseURL is missing');
  const measurements: {
    nodes: number;
    renderer: 'canvas' | 'worker';
    runs: TraceRun[];
  }[] = [];
  for (const nodes of [5000, 50_000]) {
    for (const renderer of ['canvas', 'worker'] as const) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      try {
        const page = await context.newPage();
        const fixture = nodes === 5000 ? '5000-7312' : 'stress-50000';
        await page.goto(`${baseURL}/?fixture=${fixture}&overviewRenderer=${renderer}`);
        await waitForBench(page);
        const session = await context.newCDPSession(page);
        try {
          const runs = await recordRuns(page, session, 'pan-fit');
          measurements.push({ nodes, renderer, runs });
          for (const run of runs) {
            expect(run.rendererFrameSamples).toBeGreaterThan(0);
            expect(run.rendererMainWorstMs).toBeGreaterThanOrEqual(run.rendererMainP95Ms);
            expect(run.overview.cachePixelBytes).toBeGreaterThan(0);
            if (renderer === 'worker')
              expect(run.overview.presentationLagFrames.length).toBeGreaterThan(0);
            for (const lag of run.overview.presentationLagFrames) {
              expect(Number.isFinite(lag)).toBe(true);
              expect(lag).toBeGreaterThanOrEqual(0);
            }
          }
        } finally {
          await session.detach();
        }
      } finally {
        await context.close();
      }
    }
  }
  await testInfo.attach('overview-renderer-comparison', {
    body: JSON.stringify(
      {
        stage: { width: 1440, height: 900, dpr: 1 },
        framesPerRun: 180,
        mainWork: 'Chromium renderer main-thread work between frame marks',
        presentationLag: 'presentation frame minus the camera-write frame',
        measurements,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  process.stdout.write(
    `${JSON.stringify(
      measurements.map(({ nodes, renderer, runs }) => ({
        nodes,
        renderer,
        mainP95Ms: runs.map((run) => run.rendererMainP95Ms),
        worstMainFrameMs: runs.map((run) => run.rendererMainWorstMs),
        redraws: runs.map((run) => run.overview.redraws),
        cachePixelBytes: runs.map((run) => run.overview.cachePixelBytes),
        peakCachePixelBytes: runs.map((run) => run.overview.peakCachePixelBytes),
        presentationLagFrames: runs.map((run) => run.overview.presentationLagFrames),
      })),
      null,
      2,
    )}\n`,
  );
});
