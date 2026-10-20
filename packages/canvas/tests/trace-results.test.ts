import { describe, expect, it } from 'vitest';
import {
  aggregateTraceRuns,
  domBudgetPolicy,
  type TraceRun,
  traceBudgetPolicy,
  traceOwnership,
} from './browser/trace-results';

describe('trace budget selection', () => {
  it('enforces local remount, rAF and first-frame limits at the reference budgets', () => {
    expect(traceBudgetPolicy(false)).toEqual({
      budgetSet: 'local',
      remountRendererMainP95Ms: 16,
      rafIntervalP95Ms: 16.8,
      firstFrameP50Ms: 150,
    });
  });

  it('reports runner remount and rAF and gates the runner first frame at 250 ms', () => {
    expect(traceBudgetPolicy(true)).toEqual({
      budgetSet: 'runner',
      remountRendererMainP95Ms: null,
      rafIntervalP95Ms: null,
      firstFrameP50Ms: 250,
    });
  });
});

function run(index: number, main: number, raf: number, longTasks: number[] = []): TraceRun {
  return {
    run: index,
    gpuRenderer: 'ANGLE test renderer',
    rendererMainP95Ms: main,
    rendererMainWorstMs: main,
    overview: {
      cachePixelBytes: 0,
      peakCachePixelBytes: 0,
      redraws: 0,
      cameraFrame: 0,
      presentedCameraFrame: 0,
      presentationLagFrames: [],
    },
    hitTestP95Ms: main / 100,
    hitTestProbe: {
      p95Ms: main / 100,
      sampleCount: 1000,
      queryCount: 500_000,
      hitCount: 100_000,
      minSampleDurationMs: 1,
    },
    rafIntervalP95Ms: raf,
    longTasksOver50Ms: longTasks.length,
    longTaskDurationsMs: longTasks,
    domNodes: 2130,
    rendererFrameSamples: 179,
  };
}

describe('trace aggregation', () => {
  it('takes independent unrounded medians and preserves every raw run', () => {
    const runs = [
      run(1, 2.123456789, 16.8000000000001),
      run(2, 3.000000001, 16.7, [51.23456789]),
      run(3, 1.999999999, 16.8000000000002),
    ];
    const original = structuredClone(runs);
    const result = aggregateTraceRuns(runs);
    expect(result.rendererMainP95Ms).toBe(2.123456789);
    expect(result.hitTestP95Ms).toBe(2.123456789 / 100);
    expect(result.rafIntervalP95Ms).toBe(16.8000000000001);
    expect(result.runs).toBe(runs);
    expect(runs).toEqual(original);
    expect(result.runs.map((sample) => sample.longTasksOver50Ms)).toEqual([0, 1, 0]);
    expect(result.runs[1].longTaskDurationsMs).toEqual([51.23456789]);
  });

  it('preserves per-scenario redraws and peak cache bytes when the final allocation shrinks', () => {
    const runs = [run(1, 2, 16.7), run(2, 3, 16.8), run(3, 4, 16.9)];
    const overviewSamples = [
      { redraws: 7, cachePixelBytes: 0, peakCachePixelBytes: 83_000_000 },
      { redraws: 4, cachePixelBytes: 8_000_000, peakCachePixelBytes: 21_000_000 },
      { redraws: 2, cachePixelBytes: 4_000_000, peakCachePixelBytes: 4_000_000 },
    ];
    for (const [index, sample] of overviewSamples.entries())
      runs[index].overview = { ...runs[index].overview, ...sample };
    const original = structuredClone(runs);
    const result = aggregateTraceRuns(runs);
    expect(
      result.runs.map(({ overview }) => ({
        redraws: overview.redraws,
        cachePixelBytes: overview.cachePixelBytes,
        peakCachePixelBytes: overview.peakCachePixelBytes,
      })),
    ).toEqual(overviewSamples);
    expect(JSON.stringify(result.runs.map((run) => run.overview))).toBe(
      JSON.stringify(original.map((run) => run.overview)),
    );
    expect(runs).toEqual(original);
  });

  it.each([0, 1, 2, 4])('rejects %i samples instead of three', (count) => {
    expect(() => aggregateTraceRuns(Array.from({ length: count }, () => run(1, 2, 16.7)))).toThrow(
      `Trace aggregation requires three runs; received ${count}`,
    );
  });

  it.each(['rendererMainP95Ms', 'rafIntervalP95Ms', 'hitTestP95Ms'] as const)(
    'rejects invalid %s',
    (field) => {
      const invalid = run(2, 2, 16.7);
      invalid[field] = Infinity;
      expect(() => aggregateTraceRuns([run(1, 2, 16.7), invalid, run(3, 2, 16.7)])).toThrow(
        new RegExp(`Trace ${field}.*received`, 'u'),
      );
    },
  );
});

describe('trace budget ownership', () => {
  for (const count of [708, 5000]) {
    for (const world of ['html', 'svg'] as const) {
      for (const scenario of ['pan-100', 'pan-40', 'pan-fit', 'zoom-sweep']) {
        it(`${count} ${world} ${scenario}`, () => {
          expect(traceOwnership({ count, world, scenario })).toBe(
            world === 'html' || count === 708 ? 'gated' : 'reported, SVG stress tier',
          );
        });
      }
    }
  }
});

describe('DOM budget ownership', () => {
  for (const count of [708, 5000]) {
    for (const world of ['html', 'svg'] as const) {
      it(`gates ${count} ${world} fit DOM with its timing ownership`, () => {
        expect(domBudgetPolicy({ count, world, scenario: 'pan-fit' })).toEqual({
          ownership: world === 'html' || count === 708 ? 'gated' : 'reported, SVG stress tier',
          regressionLimit: world === 'html' || count === 708 ? 2000 : null,
        });
        expect(traceOwnership({ count, world, scenario: 'pan-fit' })).toBe(
          world === 'html' || count === 708 ? 'gated' : 'reported, SVG stress tier',
        );
      });
    }
    it(`gates ${count} HTML compact cards at the reference budget`, () => {
      expect(domBudgetPolicy({ count, world: 'html', scenario: 'pan-40' })).toEqual({
        ownership: 'gated',
        regressionLimit: 2000,
      });
      expect(traceOwnership({ count, world: 'html', scenario: 'pan-40' })).toBe('gated');
    });
    for (const scenario of ['pan-100', 'zoom-sweep']) {
      it(`keeps ${count} HTML ${scenario} DOM gated at the reference budget`, () => {
        expect(domBudgetPolicy({ count, world: 'html', scenario })).toEqual({
          ownership: 'gated',
          regressionLimit: 2000,
        });
      });
    }
  }
  it('keeps the SVG DOM-level tier gated and the stress tier reported', () => {
    expect(domBudgetPolicy({ count: 708, world: 'svg', scenario: 'pan-40' })).toEqual({
      ownership: 'gated',
      regressionLimit: 2000,
    });
    expect(domBudgetPolicy({ count: 5000, world: 'svg', scenario: 'pan-40' })).toEqual({
      ownership: 'reported, SVG stress tier',
      regressionLimit: null,
    });
  });
  it('preserves the remount trace as a timing-only gate', () => {
    expect(domBudgetPolicy({ count: 708, world: 'html', scenario: 'remount' })).toEqual({
      ownership: 'reported, remount timing only',
      regressionLimit: null,
    });
  });
});
