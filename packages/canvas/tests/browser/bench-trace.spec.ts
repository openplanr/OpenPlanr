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
  percentile95,
  type RendererTraceEvent,
  rendererFrameWork,
} from '../../src/testing/index.mts';
import { waitForBench } from './bench';
import {
  aggregateTraceRuns,
  DOM_NODE_BUDGET,
  domBudgetPolicy,
  RUNNER_BUDGETS,
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
  dpr: number;
  scenario: Scenario | 'remount';
  gpuRenderer: string;
  hitTestP95Ms: number;
  rendererMainP95Ms: number;
  rafIntervalP95Ms: number;
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

type Tier = { count: 708 | 5000; world: 'html' | 'svg'; dpr: 1 | 2 };

async function firstFrames(context: BrowserContext, url: string): Promise<number[]> {
  const trials: number[] = [];
  for (let load = 0; load < 5; load += 1) {
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
    });
  }
  return runs;
}

async function measureTier(browser: Browser, baseURL: string, tier: Tier): Promise<Measurement[]> {
  const { count, world, dpr } = tier;
  const fixture = world === 'svg' ? `svg-${count}` : count === 708 ? '708-997' : '5000-7312';
  const url = `${baseURL}/?fixture=${fixture}&world=${world}`;
  const mainBudget = world === 'html' ? { 708: 6, 5000: 8 }[count] : { 708: 8, 5000: 12 }[count];
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
        const referenceBudgets = {
          rendererMainP95Ms: scenario === 'remount' ? 16 : mainBudget,
          rafIntervalP95Ms: 16.8,
          longTasksOver50Ms: 0,
          firstFrameP50Ms: 150,
          domNodes: DOM_NODE_BUDGET,
          hitTestP95Ms: 0.1,
        };
        measurements.push({
          count,
          fixture,
          ownership: traceOwnership({ count, world, scenario }),
          domBudget: domBudgetPolicy({ count, world, scenario }),
          world,
          dpr,
          scenario,
          gpuRenderer: runs[0].gpuRenderer,
          ...aggregateTraceRuns(runs),
          firstFrameP50Ms,
          firstFrameTrialsMs,
          referenceBudgets,
          effectiveBudgets: {
            ...referenceBudgets,
            rendererMainP95Ms:
              scenario === 'remount' ? budgets.remountRendererMainP95Ms : mainBudget,
            rafIntervalP95Ms: budgets.rafIntervalP95Ms,
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

test('records production vanilla camera traces beside the reference budgets', async ({
  browser,
}, testInfo) => {
  test.setTimeout(1_800_000);
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL) throw new Error('Canvas trace baseURL is missing');
  const measurements: Measurement[] = [];
  for (const dpr of [2, 1] as const) {
    for (const count of [708, 5000] as const) {
      for (const world of ['html', 'svg'] as const) {
        measurements.push(...(await measureTier(browser, baseURL, { count, world, dpr })));
      }
    }
  }
  const report = {
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
    hitTest: {
      method: 'p95 of per-query means at 1000 seeded screen points',
      minimumSampleDurationMs: 1,
      units: 'milliseconds per query',
      window: 'outside interaction marks',
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
  const output = resolve(import.meta.dirname, '../../test-results/bench-trace.json');
  await mkdir(resolve(import.meta.dirname, '../../test-results'), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach('bench-trace', { path: output, contentType: 'application/json' });
  process.stdout.write(
    [
      '| Fixture | World | DPR | Scenario | Ownership | Budget set | Main p95 median / effective budget ms | Raw main p95s ms | rAF p95 median / effective budget ms | Raw rAF p95s ms | Long tasks per run | Long-task durations per run ms | First frame p50 / budget ms | DOM nodes per run | GPU renderer | Hit-test p95 median / budget ms | DOM ownership | DOM reference budget / regression limit | Hit-test queries per run | Overview redraws per run | Overview cache bytes per run | Peak overview cache bytes per run |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...measurements.map(
        (item) =>
          `| ${item.fixture} | ${item.world} | ${item.dpr} | ${item.scenario} | ${item.ownership} | ${budgets.budgetSet} | ${item.rendererMainP95Ms} / ${item.effectiveBudgets.rendererMainP95Ms ?? `reported (reference ${item.referenceBudgets.rendererMainP95Ms})`} | ${JSON.stringify(item.runs.map((run) => run.rendererMainP95Ms))} | ${item.rafIntervalP95Ms} / ${item.effectiveBudgets.rafIntervalP95Ms ?? `reported (reference ${item.referenceBudgets.rafIntervalP95Ms})`} | ${JSON.stringify(item.runs.map((run) => run.rafIntervalP95Ms))} | ${JSON.stringify(item.runs.map((run) => run.longTasksOver50Ms))} | ${JSON.stringify(item.runs.map((run) => run.longTaskDurationsMs))} | ${item.firstFrameP50Ms} / ${item.referenceBudgets.firstFrameP50Ms} | ${JSON.stringify(item.runs.map((run) => run.domNodes))} | ${item.gpuRenderer} | ${item.hitTestP95Ms} / ${item.referenceBudgets.hitTestP95Ms} | ${item.domBudget.ownership} | ${item.referenceBudgets.domNodes} / ${item.domBudget.regressionLimit ?? 'reported'} | ${JSON.stringify(item.runs.map((run) => run.hitTestProbe.queryCount))} | ${JSON.stringify(item.runs.map((run) => run.overview.redraws))} | ${JSON.stringify(item.runs.map((run) => run.overview.cachePixelBytes))} | ${JSON.stringify(item.runs.map((run) => run.overview.peakCachePixelBytes))} |`,
      ),
      '',
    ].join('\n'),
  );
  for (const item of measurements.filter((measurement) => measurement.ownership === 'gated')) {
    const label = `${item.fixture} ${item.world} DPR ${item.dpr} ${item.scenario}`;
    if (item.scenario === 'remount') {
      if (item.effectiveBudgets.rendererMainP95Ms !== null) {
        expect
          .soft(item.rendererMainP95Ms, `${label}: chunked remount renderer main p95`)
          .toBeLessThanOrEqual(item.effectiveBudgets.rendererMainP95Ms);
      }
      continue;
    }
    expect
      .soft(item.hitTestP95Ms, `${label}: batched hit-test p95 over 1000 seeded points`)
      .toBeLessThanOrEqual(item.referenceBudgets.hitTestP95Ms);
    expect
      .soft(item.rendererMainP95Ms, `${label}: renderer main work`)
      .toBeLessThanOrEqual(item.referenceBudgets.rendererMainP95Ms);
    if (item.effectiveBudgets.rafIntervalP95Ms !== null) {
      expect
        .soft(item.rafIntervalP95Ms, `${label}: rAF interval`)
        .toBeLessThanOrEqual(item.effectiveBudgets.rafIntervalP95Ms);
    }
    for (const run of item.runs) {
      expect.soft(run.hitTestProbe.sampleCount, `${label}: timed hit-test points`).toBe(1000);
      expect
        .soft(run.hitTestProbe.queryCount, `${label}: executed hit-test queries`)
        .toBeGreaterThanOrEqual(1000);
      expect
        .soft(run.hitTestProbe.minSampleDurationMs, `${label}: hit-test batch duration`)
        .toBeGreaterThanOrEqual(1);
      expect.soft(run.hitTestP95Ms, `${label}: measurable hit-test latency`).toBeGreaterThan(0);
      expect
        .soft(
          run.hitTestP95Ms,
          `${label}: run ${run.run} batched hit-test p95 over 1000 seeded points`,
        )
        .toBeLessThanOrEqual(item.referenceBudgets.hitTestP95Ms);
      if (item.domBudget.regressionLimit !== null) {
        expect
          .soft(
            run.domNodes,
            `${label}: run ${run.run} stage DOM nodes (${item.domBudget.ownership})`,
          )
          .toBeLessThanOrEqual(item.domBudget.regressionLimit);
      }
      expect
        .soft(run.longTasksOver50Ms, `${label}: run ${run.run} long tasks`)
        .toBe(item.referenceBudgets.longTasksOver50Ms);
    }
    expect
      .soft(item.firstFrameP50Ms, `${label}: first fixture frame`)
      .toBeLessThanOrEqual(item.referenceBudgets.firstFrameP50Ms);
  }
});

test('measures cached canvas and worker overview work, cache memory and presentation lag', async ({
  browser,
}, testInfo) => {
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
