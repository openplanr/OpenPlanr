import { describe, expect, it } from 'vitest';
import { aggregateTraceRuns, type TraceRun, traceOwnership } from './browser/trace-results';

function run(index: number, main: number, raf: number, longTasks: number[] = []): TraceRun {
  return {
    run: index,
    rendererMainP95Ms: main,
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

  it.each(['rendererMainP95Ms', 'rafIntervalP95Ms'] as const)('rejects invalid %s', (field) => {
    const invalid = run(2, 2, 16.7);
    invalid[field] = Infinity;
    expect(() => aggregateTraceRuns([run(1, 2, 16.7), invalid, run(3, 2, 16.7)])).toThrow(
      new RegExp(`Trace ${field}.*received`, 'u'),
    );
  });
});

describe('trace budget ownership', () => {
  for (const count of [708, 5000]) {
    for (const world of ['html', 'svg'] as const) {
      for (const scenario of ['pan-100', 'pan-40', 'pan-fit', 'zoom-sweep']) {
        it(`${count} ${world} ${scenario}`, () => {
          expect(traceOwnership({ count, world, scenario })).toBe(
            count === 708 && world === 'html' && scenario === 'pan-100'
              ? 'gated'
              : 'reported, owned by culling or SVG tier',
          );
        });
      }
    }
  }
});
