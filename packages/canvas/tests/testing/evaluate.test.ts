import { describe, expect, it } from 'vitest';
import {
  CANVAS_TRACE_BUDGETS,
  type CanvasTraceIdentity,
  type CanvasTraceMeasurement,
  type CanvasTraceResults,
  evaluateCanvasTrace,
  toClockResolution,
} from '../../src/testing/index.mjs';

function complete(count: 708 | 5000) {
  const identity: CanvasTraceIdentity = {
    count,
    fixture: `${count}-fixture`,
    renderer: 'vanilla',
    world: 'html',
    dpr: 2,
  };
  const probe = () => ({
    p95Ms: 0.01,
    sampleCount: 1000,
    queryCount: 2000,
    minSampleDurationMs: 1,
  });
  const snapshot = () => ({
    camera: { x: 0, y: 0, zoom: 1 },
    stage: { x: 0, y: 0, width: 1440, height: 900 },
  });
  return {
    browser: { name: 'chromium' as CanvasTraceResults['browser']['name'], version: 'test-version' },
    budgetSet: 'local' as CanvasTraceResults['budgetSet'],
    measurements: [
      {
        ...identity,
        scenario: 'pan-100' as CanvasTraceMeasurement['scenario'],
        firstFrameP50Ms: 100,
        firstFrameTrialsMs: [100, 100, 100, 100, 100],
        runs: Array.from({ length: 3 }, (_, index) => ({
          run: index + 1,
          rendererMainP95Ms: 6,
          rafIntervalP95Ms: 16,
          worstFrameMs: 20,
          longTasksOver50Ms: 0,
          domNodes: 1000,
          hitTestP95Ms: 0.01,
          hitTestProbe: probe(),
          react: { pureCameraCommits: 0, pureCameraFrames: 180 },
        })),
      },
    ],
    hitTests: [{ ...identity, hitTestProbe: probe() }],
    chrome: [
      {
        ...identity,
        layoutShifts: {
          phases: Array.from({ length: 16 }, (_, index) => ({
            phase: `chrome-toggle ${index}`,
            startTime: index,
          })),
          inputActions: [{ phase: 'chrome-toggle 0', phaseIndex: 0, startTime: 0 }],
          shifts: [
            { value: 0, startTime: 0, hadRecentInput: true, phase: 'chrome-toggle 0', sources: [] },
          ],
        },
        before: snapshot(),
        after: snapshot(),
        snapshots: Array.from({ length: 16 }, snapshot),
      },
    ],
    lod: (['full-compact', 'compact-overview'] as const).map((band) => ({
      ...identity,
      band,
      switches: 20,
      blank: 0,
      both: 0,
      levels: Array.from({ length: 20 }, (_, index) =>
        band === 'full-compact'
          ? index % 2 === 0
            ? 'compact'
            : 'dom'
          : index % 2 === 0
            ? 'overview'
            : 'compact',
      ),
    })),
    pins: ([50, 500] as const).map((pinCount) => ({
      ...identity,
      pinCount,
      domNodes: 1500,
      droppedPins: 0,
    })),
  } satisfies CanvasTraceResults;
}
type Complete = ReturnType<typeof complete>;
const evaluate = (results: Complete) => evaluateCanvasTrace(results, results.measurements[0].count);
const setFirstFrame = (results: Complete, time: number) => {
  results.measurements[0].firstFrameP50Ms = time;
  results.measurements[0].firstFrameTrialsMs.fill(time);
};

const failures: [string, (results: Complete) => void][] = [
  [
    'rendererMainP95Ms',
    (r) => {
      for (const run of r.measurements[0].runs) run.rendererMainP95Ms = 1000;
    },
  ],
  [
    'rendererMainP95Ms',
    (r) => {
      r.measurements[0].scenario = 'remount';
      for (const run of r.measurements[0].runs) run.rendererMainP95Ms = 17;
    },
  ],
  [
    'longTasksOver50Ms',
    (r) => {
      r.measurements[0].runs[0].longTasksOver50Ms = 1;
    },
  ],
  [
    'longTasksOver50Ms',
    (r) => {
      r.measurements[0].scenario = 'remount';
      r.measurements[0].runs[0].longTasksOver50Ms = 1;
    },
  ],
  [
    'rafIntervalP95Ms',
    (r) => {
      for (const run of r.measurements[0].runs) run.rafIntervalP95Ms = 17;
    },
  ],
  [
    'domNodes',
    (r) => {
      r.measurements[0].runs[0].domNodes = 2001;
    },
  ],
  [
    'domNodes',
    (r) => {
      r.pins[0].domNodes = 2001;
    },
  ],
  ['firstFrameP50Ms', (r) => setFirstFrame(r, 151)],
  [
    'firstFrameLoads',
    (r) => {
      r.measurements[0].firstFrameTrialsMs.pop();
    },
  ],
  [
    'hitTestP95Ms',
    (r) => {
      r.hitTests[0].hitTestProbe.p95Ms = 0.11;
    },
  ],
  [
    'hitTestP95Ms',
    (r) => {
      r.measurements[0].runs[0].hitTestP95Ms = 0.11;
    },
  ],
  [
    'hitTestP95Ms',
    (r) => {
      r.measurements[0].runs[0].hitTestProbe.p95Ms = 0.11;
    },
  ],
  [
    'hitTestP95Ms',
    (r) => {
      r.hitTests[0].hitTestProbe.p95Ms = 0;
    },
  ],
  [
    'sampleCount',
    (r) => {
      r.hitTests[0].hitTestProbe.sampleCount = 999;
    },
  ],
  [
    'queryCount',
    (r) => {
      r.hitTests[0].hitTestProbe.queryCount = 999;
    },
  ],
  [
    'minSampleDurationMs',
    (r) => {
      r.hitTests[0].hitTestProbe.minSampleDurationMs = 0.9;
    },
  ],
  [
    'admittedCls',
    (r) => {
      r.chrome[0].layoutShifts.shifts[0].value = 0.01;
    },
  ],
  [
    'camera unchanged',
    (r) => {
      r.chrome[0].after.camera.x = 1;
    },
  ],
  [
    'stage unchanged',
    (r) => {
      r.chrome[0].after.stage.width = 1200;
    },
  ],
  [
    'camera unchanged',
    (r) => {
      r.chrome[0].snapshots[2].camera.zoom = 2;
    },
  ],
  [
    'toggles',
    (r) => {
      r.chrome[0].snapshots.pop();
    },
  ],
  [
    'phases',
    (r) => {
      r.chrome[0].layoutShifts.phases[0].phase = 'wrong';
    },
  ],
  [
    'switches',
    (r) => {
      r.lod[0].switches = 19;
    },
  ],
  [
    'alternating levels',
    (r) => {
      r.lod[0].levels[1] = 'overview';
    },
  ],
  [
    'blankFrames',
    (r) => {
      r.lod[0].blank = 1;
    },
  ],
  [
    'doubleLayerFrames',
    (r) => {
      r.lod[1].both = 1;
    },
  ],
  [
    'droppedPins',
    (r) => {
      r.pins[1].droppedPins = 1;
    },
  ],
  [
    'pureCameraCommits',
    (r) => {
      r.measurements[0].renderer = 'react';
      r.measurements[0].runs[0].react.pureCameraCommits = 1;
    },
  ],
  [
    'pureCameraFrames',
    (r) => {
      r.measurements[0].renderer = 'react';
      r.measurements[0].runs[0].react.pureCameraFrames = 0;
    },
  ],
];

describe('canvas trace evaluation', () => {
  it.each([708, 5000] as const)(
    'passes complete tier %i evidence with compositor work pending',
    (tier) => {
      const results = complete(tier);
      const original = structuredClone(results);
      const evaluation = evaluate(results);
      expect(evaluation.passed).toBe(true);
      expect(evaluation.failures).toEqual([]);
      expect(evaluation.pending).toEqual([
        'dropped frames at fit: compositor trace is not measured',
      ]);
      expect(results).toEqual(original);
    },
  );

  for (const tier of [708, 5000] as const) {
    it.each(failures)(`fails %s at tier ${tier}`, (metric, mutate) => {
      const results = complete(tier);
      mutate(results);
      const evaluation = evaluate(results);
      expect(evaluation.passed).toBe(false);
      expect(evaluation.failures.some((failure) => failure.includes(metric))).toBe(true);
      for (const failure of evaluation.failures) {
        expect(failure).toContain(`${tier}-fixture`);
        expect(failure).toContain('html DPR 2');
        expect(failure).toMatch(/vanilla|react/u);
        expect(failure).toMatch(/measured .+, limit /u);
      }
    });
  }

  it.each([
    ['vanilla', 'html', 708, 6],
    ['vanilla', 'html', 5000, 8],
    ['react', 'html', 708, 8],
    ['react', 'html', 5000, 10],
    ['vanilla', 'svg', 708, 8],
    ['vanilla', 'svg', 5000, 12],
  ] as const)('preserves %s %s tier %i main limit %i', (renderer, world, tier, limit) => {
    expect(CANVAS_TRACE_BUDGETS.rendererMainP95Ms[world === 'svg' ? 'svg' : renderer][tier]).toBe(
      limit,
    );
    const results = complete(tier);
    const item = results.measurements[0];
    item.renderer = renderer;
    item.world = world;
    for (const run of item.runs) run.rendererMainP95Ms = limit;
    expect(evaluate(results).failures).toEqual([]);
    for (const run of item.runs) run.rendererMainP95Ms += 0.001;
    const evaluation = evaluate(results);
    expect(
      (world === 'svg' && tier === 5000 ? evaluation.reported : evaluation.failures).join('\n'),
    ).toContain('rendererMainP95Ms');
  });

  it.each([
    [16.80000000000291, true],
    [16.84, true],
    [16.85, false],
  ])('compares a Chromium rAF p95 of %d ms with 16.8 at clock resolution', (raf, passes) => {
    const results = complete(708);
    for (const run of results.measurements[0].runs) run.rafIntervalP95Ms = raf;
    const evaluation = evaluate(results);
    expect(evaluation.passed).toBe(passes);
    if (!passes)
      expect(evaluation.failures).toEqual([
        `708-fixture vanilla html DPR 2 pan-100: rafIntervalP95Ms measured 16.9 (raw ${raf}), limit 16.8`,
      ]);
  });

  it('rounds interval-derived metrics to the 0.1 ms clock resolution', () => {
    expect(toClockResolution(16.80000000000291)).toBe(16.8);
    expect(toClockResolution(16.84)).toBe(16.8);
    expect(toClockResolution(16.85)).toBe(16.9);
    expect(toClockResolution(16.7)).toBe(16.7);
  });

  it('reports runner rAF and remount while preserving the 250 ms first-frame gate', () => {
    const results = complete(5000);
    results.budgetSet = 'runner';
    results.measurements[0].scenario = 'remount';
    for (const run of results.measurements[0].runs) {
      run.rendererMainP95Ms = 1000;
      run.rafIntervalP95Ms = 1000;
    }
    setFirstFrame(results, 250);
    const evaluation = evaluate(results);
    expect(evaluation.failures).toEqual([]);
    expect(evaluation.reported.join('\n')).toContain('rendererMainP95Ms measured 1000, limit 16');
    expect(evaluation.reported.join('\n')).toContain('rafIntervalP95Ms measured 1000, limit 16.8');
    setFirstFrame(results, 250.001);
    expect(evaluate(results).failures.join('\n')).toContain('firstFrameP50Ms');
    results.measurements[0].runs[0].longTasksOver50Ms = 1;
    expect(evaluate(results).failures.join('\n')).toContain('longTasksOver50Ms');
  });

  it('keeps remount DOM and 500-pin DOM reported', () => {
    const results = complete(708);
    results.measurements[0].scenario = 'remount';
    results.measurements[0].runs[0].domNodes = 9000;
    results.pins[1].domNodes = 9000;
    expect(evaluate(results).failures).toEqual([]);
    expect(
      evaluate(results).reported.filter((line) => line.includes('domNodes measured 9000')),
    ).toHaveLength(2);
  });

  it('reports traced SVG stress-tier measurements instead of gating them', () => {
    const results = complete(5000);
    for (const key of ['measurements', 'hitTests', 'chrome', 'lod', 'pins'] as const)
      for (const item of results[key]) item.world = 'svg';
    for (const run of results.measurements[0].runs) run.rendererMainP95Ms = 1000;
    expect(evaluate(results).failures).toEqual([]);
    expect(evaluate(results).reported.join('\n')).toContain(
      'rendererMainP95Ms measured 1000, limit 12',
    );
  });

  it.each([
    [
      'chrome',
      'admittedCls',
      (r: Complete) => {
        r.chrome[0].layoutShifts.shifts[0].value = 0.01;
      },
    ],
    [
      'lod',
      'blankFrames',
      (r: Complete) => {
        r.lod[0].blank = 1;
      },
    ],
    [
      'pins',
      'droppedPins',
      (r: Complete) => {
        r.pins[1].droppedPins = 1;
      },
    ],
    [
      'hitTests',
      'hitTestP95Ms',
      (r: Complete) => {
        r.hitTests[0].hitTestProbe.p95Ms = 0.11;
      },
    ],
  ] as const)('gates untraced svg-5000 %s evidence', (section, metric, mutate) => {
    const results = complete(5000);
    for (const item of results[section]) {
      item.fixture = 'svg-5000';
      item.world = 'svg';
    }
    mutate(results);
    const evaluation = evaluate(results);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.failures).toHaveLength(1);
    expect(evaluation.failures[0]).toContain('svg-5000 vanilla svg DPR 2');
    expect(evaluation.failures[0]).toContain(metric);
    expect(
      evaluation.reported.filter((line) => line.includes('svg-5000') && line.includes(metric)),
    ).toEqual([]);
  });

  it('gates svg-5000 fifty-pin DOM while reporting five-hundred-pin DOM', () => {
    const results = complete(5000);
    for (const item of results.pins) {
      item.fixture = 'svg-5000';
      item.world = 'svg';
      item.domNodes = 2001;
    }
    const evaluation = evaluate(results);
    expect(evaluation.failures).toHaveLength(1);
    expect(evaluation.failures[0]).toContain('pins-50: domNodes measured 2001, limit 2000');
    expect(evaluation.reported).toHaveLength(1);
    expect(evaluation.reported[0]).toContain('pins-500: domNodes measured 2001, limit 2000');
  });

  it('lists absent sections and absent tiers as pending', () => {
    const results = complete(708);
    const evaluation = evaluateCanvasTrace(
      { browser: results.browser, budgetSet: results.budgetSet },
      708,
    );
    for (const section of ['measurements', 'hitTests', 'chrome', 'lod', 'pins'])
      expect(evaluation.pending).toContain(`${section}: absent for tier 708`);
    expect(evaluation.passed).toBe(true);
    expect(evaluateCanvasTrace(results, 5000).pending).toContain(
      'measurements: absent for tier 5000',
    );
  });

  it('fails empty LOD observations and lists empty sections as pending', () => {
    const results = complete(708);
    results.lod[0].levels = [];
    results.lod[0].switches = 0;
    expect(evaluate(results).failures.join('\n')).toContain('alternating levels');
    results.hitTests = [];
    expect(evaluate(results).pending).toContain('hitTests: absent for tier 708');
  });

  it.each(['webkit', 'firefox'] as const)(
    'accepts %s frame evidence without Chromium main work',
    (name) => {
      const results = complete(708);
      const measurements = results.measurements.map((item) => ({
        ...item,
        runs: item.runs.map(({ rendererMainP95Ms: _main, ...run }) => run),
      }));
      expect(
        evaluateCanvasTrace(
          { ...results, browser: { ...results.browser, name }, measurements },
          708,
        ).failures,
      ).toEqual([]);
      expect(() => evaluateCanvasTrace({ ...results, measurements }, 708)).toThrow(
        'rendererMainP95Ms',
      );
    },
  );

  it.each(['webkit', 'firefox'] as const)(
    'keeps unsupported %s metrics pending while gating supported timing',
    (name) => {
      const results = complete(708);
      const measurements = results.measurements.map((item) => ({
        ...item,
        scenario: 'pan-100' as const,
        runs: item.runs.map((run) => ({
          ...run,
          rendererMainP95Ms: 'unsupported' as const,
          longTasksOver50Ms: 'unsupported' as const,
          layoutShiftValue: 'unsupported' as const,
        })),
      }));
      const evaluation = evaluateCanvasTrace(
        { ...results, browser: { ...results.browser, name }, measurements },
        708,
      );
      expect(evaluation.failures).toEqual([]);
      expect(evaluation.reported.filter((line) => line.includes('pan-100'))).toEqual([]);
      for (const metric of ['rendererMainP95Ms', 'longTasksOver50Ms', 'layoutShiftValue']) {
        const pending = evaluation.pending.filter((line) => line.includes(`${metric} unsupported`));
        expect(pending).toHaveLength(3);
        expect(pending[0]).toContain('708-fixture vanilla html DPR 2 pan-100 run 1');
        expect(pending[0]).toContain('tier 708');
      }
      expect(
        evaluateCanvasTrace(
          { ...results, browser: { ...results.browser, name }, measurements },
          5000,
        ).pending.filter((line) => line.includes('unsupported')),
      ).toEqual([]);
      for (const run of measurements[0].runs) run.rafIntervalP95Ms = 1000;
      expect(
        evaluateCanvasTrace(
          { ...results, browser: { ...results.browser, name }, measurements },
          708,
        ).failures.join('\n'),
      ).toContain(name === 'webkit' ? 'rafIntervalP95Ms' : 'frameP95Ms');
    },
  );

  for (const budgetSet of ['local', 'runner'] as const) {
    it.each([
      ['chromium', 'rendererMainP95Ms'],
      ['chromium', 'rafIntervalP95Ms'],
      ['chromium', 'longTasksOver50Ms'],
      ['webkit', 'rafIntervalP95Ms'],
      ['firefox', 'rafIntervalP95Ms'],
      ['chromium', 'worstFrameMs'],
      ['webkit', 'worstFrameMs'],
      ['firefox', 'worstFrameMs'],
      ['chromium', 'engineFrameSamples'],
      ['webkit', 'engineFrameSamples'],
      ['firefox', 'engineFrameSamples'],
    ] as const)(`rejects unsupported %s %s with ${budgetSet} budgets`, (name, metric) => {
      const results = complete(708);
      const measurements = results.measurements.map((item) => ({
        ...item,
        scenario: metric === 'worstFrameMs' ? ('pan-40' as const) : item.scenario,
        runs: item.runs.map((run) => ({ ...run, [metric]: 'unsupported' })),
      }));
      const malformed = {
        ...results,
        budgetSet,
        browser: { ...results.browser, name },
        measurements,
      } as CanvasTraceResults;
      expect(() => evaluateCanvasTrace(malformed, 708)).toThrow(TypeError);
      expect(() => evaluateCanvasTrace(malformed, 708)).toThrow(metric);
    });
  }

  it('still gates supported long tasks alongside unsupported observations', () => {
    const results = complete(708);
    results.browser.name = 'firefox';
    const measurements = results.measurements.map((item) => ({
      ...item,
      runs: item.runs.map((run, index) => ({
        ...run,
        longTasksOver50Ms: index === 0 ? ('unsupported' as const) : 1,
      })),
    }));
    const evaluation = evaluateCanvasTrace({ ...results, measurements }, 708);
    expect(evaluation.failures).toHaveLength(2);
    expect(evaluation.failures.join('\n')).toContain('longTasksOver50Ms measured 1, limit 0');
    expect(evaluation.pending.join('\n')).toContain('longTasksOver50Ms unsupported');
  });

  it('accepts numeric optional browser evidence without marking it unsupported', () => {
    const results = complete(708);
    const measurements = results.measurements.map((item) => ({
      ...item,
      runs: item.runs.map((run) => ({ ...run, layoutShiftValue: 0, engineFrameSamples: 180 })),
    }));
    expect(evaluateCanvasTrace({ ...results, measurements }, 708).pending).toEqual([
      'dropped frames at fit: compositor trace is not measured',
    ]);
  });

  it('keeps chrome geometry and toggle gates active when layout shifts are unsupported', () => {
    const results = complete(708);
    const chrome = results.chrome.map((item) => ({
      ...item,
      layoutShifts: 'unsupported' as const,
    }));
    const evaluation = evaluateCanvasTrace({ ...results, chrome }, 708);
    expect(evaluation.failures).toEqual([]);
    expect(evaluation.pending.join('\n')).toContain('layoutShifts unsupported for tier 708');
    chrome[0].snapshots.pop();
    chrome[0].after.camera.x = 1;
    chrome[0].after.stage.width = 1200;
    const failures = evaluateCanvasTrace({ ...results, chrome }, 708).failures;
    expect(failures).toHaveLength(3);
    expect(failures.join('\n')).toContain('toggles');
    expect(failures.join('\n')).toContain('camera unchanged');
    expect(failures.join('\n')).toContain('stage unchanged');
    expect(failures.join('\n')).not.toMatch(/admittedCls|phases/u);
    expect(
      evaluateCanvasTrace({ ...results, chrome }, 5000).pending.filter((line) =>
        line.includes('unsupported'),
      ),
    ).toEqual([]);
  });

  it('enforces WebKit rAF and worst pan-40 frame limits', () => {
    const results = complete(708);
    results.browser.name = 'webkit';
    results.measurements[0].scenario = 'pan-40';
    for (const run of results.measurements[0].runs) {
      run.rafIntervalP95Ms = 19;
      run.worstFrameMs = 33;
    }
    expect(evaluate(results).failures).toEqual([]);
    results.measurements[0].runs[0].worstFrameMs = 33.05;
    for (const run of results.measurements[0].runs) run.rafIntervalP95Ms = 19.05;
    expect(evaluate(results).failures.join('\n')).toContain('rafIntervalP95Ms');
    expect(evaluate(results).failures.join('\n')).toContain('worstFrameMs');
  });

  it('requires WebKit pan-40 worst-frame evidence even with runner timing budgets', () => {
    const results = complete(708);
    results.browser.name = 'webkit';
    results.budgetSet = 'runner';
    results.measurements[0].scenario = 'pan-40';
    const measurements = results.measurements.map((item) => ({
      ...item,
      runs: item.runs.map(({ worstFrameMs: _worst, ...run }) => run),
    }));
    expect(() => evaluateCanvasTrace({ ...results, measurements }, 708)).toThrow(
      'worstFrameMs is required for WebKit pan-40',
    );
  });

  it.each([708, 5000] as const)('enforces Firefox frame limits at tier %i', (tier) => {
    const results = complete(tier);
    results.browser.name = 'firefox';
    for (const run of results.measurements[0].runs) run.rafIntervalP95Ms = 17;
    expect(evaluate(results).failures).toEqual([]);
    for (const run of results.measurements[0].runs) run.rafIntervalP95Ms = 17.05;
    expect(evaluate(results).failures.join('\n')).toContain('frameP95Ms');
    results.measurements[0].scenario = 'pan-fit';
    const limit = tier === 708 ? 20 : 25;
    for (const run of results.measurements[0].runs) run.rafIntervalP95Ms = limit;
    expect(evaluate(results).failures).toEqual([]);
    for (const run of results.measurements[0].runs) run.rafIntervalP95Ms = limit + 0.05;
    expect(evaluate(results).failures.join('\n')).toContain(`limit ${limit}`);
  });

  it.each([
    ['webkit', 'pan-40', 708, 'rafIntervalP95Ms', 19],
    ['firefox', 'pan-100', 708, 'frameP95Ms', 17],
    ['firefox', 'pan-fit', 708, 'frameP95Ms', 20],
    ['firefox', 'pan-fit', 5000, 'frameP95Ms', 25],
  ] as const)(
    'reports runner %s %s timing at tier %i while retaining structural gates',
    (name, scenario, tier, metric, limit) => {
      const results = complete(tier);
      results.browser.name = name;
      results.budgetSet = 'runner';
      results.measurements[0].scenario = scenario;
      for (const run of results.measurements[0].runs) {
        run.rafIntervalP95Ms = 1000;
        run.worstFrameMs = 1000;
      }
      const evaluation = evaluate(results);
      expect(evaluation.failures).toEqual([]);
      expect(evaluation.reported.join('\n')).toContain(`${metric} measured 1000, limit ${limit}`);
      if (name === 'webkit')
        expect(evaluation.reported.filter((line) => line.includes('worstFrameMs'))).toHaveLength(3);
      results.measurements[0].runs[0].domNodes = 2001;
      results.measurements[0].runs[0].longTasksOver50Ms = 1;
      expect(evaluate(results).failures.join('\n')).toContain('domNodes');
      expect(evaluate(results).failures.join('\n')).toContain('longTasksOver50Ms');
    },
  );

  it.each([
    ['rendererMainP95Ms', '16'],
    ['rafIntervalP95Ms', null],
    ['longTasksOver50Ms', undefined],
    ['worstFrameMs', -1],
    ['layoutShiftValue', NaN],
    ['engineFrameSamples', Infinity],
  ] as const)('rejects malformed %s browser evidence', (metric, value) => {
    const results = complete(708);
    const measurements = results.measurements.map((item) => ({
      ...item,
      runs: item.runs.map((run) => ({ ...run, [metric]: value })),
    }));
    const malformed = { ...results, measurements } as CanvasTraceResults;
    expect(() => evaluateCanvasTrace(malformed, 708)).toThrow(TypeError);
    expect(() => evaluateCanvasTrace(malformed, 708)).toThrow(String(metric));
  });

  it.each([
    ['budgetSet', (r: Complete) => ({ ...r, budgetSet: undefined })],
    ['browser', (r: Complete) => ({ ...r, browser: null })],
    ['browser.name', (r: Complete) => ({ ...r, browser: { ...r.browser, name: 'unknown' } })],
    ['browser.version', (r: Complete) => ({ ...r, browser: { ...r.browser, version: '' } })],
    ['measurements', (r: Complete) => ({ ...r, measurements: null })],
    [
      'fixture',
      (r: Complete) => {
        r.measurements[0].fixture = '';
        return r;
      },
    ],
    [
      'react',
      (r: Complete) => ({
        ...r,
        measurements: [
          {
            ...r.measurements[0],
            renderer: 'react',
            runs: r.measurements[0].runs.map((run) => ({ ...run, react: undefined })),
          },
        ],
      }),
    ],
    [
      'hitTestProbe',
      (r: Complete) => ({ ...r, hitTests: [{ ...r.hitTests[0], hitTestProbe: null }] }),
    ],
    [
      'rendererMainP95Ms',
      (r: Complete) => {
        r.measurements[0].runs[0].rendererMainP95Ms = NaN;
        return r;
      },
    ],
    [
      'firstFrameP50Ms',
      (r: Complete) => {
        r.measurements[0].firstFrameP50Ms = 1;
        return r;
      },
    ],
    [
      'firstFrameTrialsMs',
      (r: Complete) => ({
        ...r,
        measurements: [{ ...r.measurements[0], firstFrameTrialsMs: undefined }],
      }),
    ],
    [
      'runs',
      (r: Complete) => {
        r.measurements[0].runs.pop();
        return r;
      },
    ],
    ['before', (r: Complete) => ({ ...r, chrome: [{ ...r.chrome[0], before: null }] })],
    [
      'layoutShifts',
      (r: Complete) => ({ ...r, chrome: [{ ...r.chrome[0], layoutShifts: 'unavailable' }] }),
    ],
    [
      'startTime',
      (r: Complete) => {
        r.chrome[0].layoutShifts.shifts[0].startTime = -1;
        return r;
      },
    ],
    ['levels', (r: Complete) => ({ ...r, lod: [{ ...r.lod[0], levels: null }] })],
    ['pinCount', (r: Complete) => ({ ...r, pins: [{ ...r.pins[0], pinCount: 5 }] })],
  ])('rejects malformed %s with its field name', (field, mutate) => {
    const malformed = mutate(complete(708)) as CanvasTraceResults;
    expect(() => evaluateCanvasTrace(malformed, 708)).toThrow(TypeError);
    expect(() => evaluateCanvasTrace(malformed, 708)).toThrow(field);
  });
});
