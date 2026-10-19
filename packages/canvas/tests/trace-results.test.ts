import { describe, expect, it } from 'vitest';
import {
  aggregateTraceRuns,
  domBudgetPolicy,
  type TraceRun,
  traceOwnership,
} from './browser/trace-results';

function run(index: number, main: number, raf: number, longTasks: number[] = []): TraceRun {
  return {
    run: index,
    gpuRenderer: 'ANGLE test renderer',
    rendererMainP95Ms: main,
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
      it(`reports ${count} ${world} fit DOM separately from its timing ownership`, () => {
        expect(domBudgetPolicy({ count, world, scenario: 'pan-fit' })).toEqual({
          ownership: 'reported, owned by overview',
          regressionLimit: null,
        });
        expect(traceOwnership({ count, world, scenario: 'pan-fit' })).toBe(
          world === 'html' || count === 708 ? 'gated' : 'reported, SVG stress tier',
        );
      });
    }
    it(`retains the ${count} HTML conflict with a regression ceiling`, () => {
      expect(domBudgetPolicy({ count, world: 'html', scenario: 'pan-40' })).toEqual({
        ownership: 'budget conflict, owner decision pending',
        regressionLimit: 2100,
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
