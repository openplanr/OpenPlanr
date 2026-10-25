import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateCanvasTrace } from '../src/testing/index.mts';
import { sampleRafScenario, summarizeRafIntervals } from './browser/raf-trace';
import recorded from './fixtures/dashboard-trace-sample.json';

describe('rAF interval summary', () => {
  it('keeps the recorded p95 and worst frame distinct without rounding or mutation', () => {
    const frames = recorded
      .filter((event) => event.name === 'dashboard-frame')
      .map((event) => event.ts);
    const intervals = frames.slice(1).map((time, index) => (time - frames[index]) / 1000);
    const original = [...intervals];
    expect(summarizeRafIntervals(intervals)).toEqual({
      rafIntervalP95Ms: 17.139,
      worstFrameMs: 17.399,
    });
    expect(intervals).toEqual(original);
  });

  it.each([[], [NaN], [Infinity], [-1]].map((intervals) => ({ intervals })))(
    'rejects invalid interval evidence $intervals',
    ({ intervals }) => {
      expect(() => summarizeRafIntervals(intervals)).toThrow(TypeError);
    },
  );
});

describe('rAF observer evidence', () => {
  class Observer {
    static supportedEntryTypes: string[] = [];
    static instances: Observer[] = [];
    type = '';
    disconnect = vi.fn();
    constructor() {
      Observer.instances.push(this);
    }
    observe({ type }: { type: string }) {
      this.type = type;
    }
    takeRecords() {
      if (this.type === 'longtask')
        return [
          { startTime: 90, duration: 80 },
          { startTime: 120, duration: 60 },
          { startTime: 140, duration: 50 },
          { startTime: 510, duration: 90 },
        ];
      if (this.type === 'layout-shift')
        return [
          { startTime: 90, value: 0.5 },
          { startTime: 150, value: 0.01 },
          { startTime: 510, value: 0.5 },
        ];
      throw new Error(`Unexpected observer type ${this.type}`);
    }
  }
  beforeEach(() => {
    Observer.supportedEntryTypes = [];
    Observer.instances = [];
    vi.stubGlobal('PerformanceObserver', Observer);
    vi.stubGlobal('performance', {
      getEntriesByName: (name: string) => {
        const marks: Record<string, number[]> = {
          'canvas-first-frame': [50],
          'canvas-interaction-start': [100],
          'canvas-interaction-end': [500],
          'canvas-frame': [50, 110, 130, 150, 600],
        };
        return marks[name].map((startTime) => ({ startTime }));
      },
    });
    vi.stubGlobal('window', {
      bench: {
        run: vi.fn(async () => ({
          intervals: [16, 17, 18],
          domNodes: 1200,
          gpuRenderer: 'test renderer',
          hitTestP95Ms: 0.01,
          hitTestProbe: {
            p95Ms: 0.01,
            sampleCount: 1000,
            queryCount: 2000,
            minSampleDurationMs: 1,
          },
        })),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('preserves unsupported observations through serialization and evaluation', async () => {
    const sample = await sampleRafScenario('pan-100');
    expect(Observer.instances).toHaveLength(0);
    expect(sample).toMatchObject({
      rendererMainP95Ms: 'unsupported',
      longTasksOver50Ms: 'unsupported',
      longTaskDurationsMs: 'unsupported',
      layoutShiftValue: 'unsupported',
      engineFrameSamples: 3,
      firstFrameMs: 50,
      domNodes: 1200,
    });
    const measurement = {
      count: 708 as const,
      fixture: '708-997',
      renderer: 'vanilla' as const,
      world: 'html' as const,
      dpr: 2 as const,
      scenario: 'pan-100' as const,
      firstFrameP50Ms: 50,
      firstFrameTrialsMs: [50, 50, 50, 50, 50],
      runs: [1, 2, 3].map((run) => ({
        run,
        ...sample,
        ...summarizeRafIntervals(sample.intervals),
      })),
    };
    const evaluation = evaluateCanvasTrace(
      {
        browser: { name: 'webkit', version: 'test' },
        budgetSet: 'local',
        measurements: [JSON.parse(JSON.stringify(measurement))],
      },
      708,
    );
    expect(evaluation.failures).toEqual([]);
    for (const metric of ['rendererMainP95Ms', 'longTasksOver50Ms', 'layoutShiftValue']) {
      expect(
        evaluation.pending.filter((line) => line.includes(`${metric} unsupported`)),
      ).toHaveLength(3);
      expect(evaluation.reported.some((line) => line.includes(metric))).toBe(false);
    }
  });

  it('drains supported observations only within the interaction marks', async () => {
    Observer.supportedEntryTypes = ['longtask', 'layout-shift'];
    const sample = await sampleRafScenario('pan-40');
    expect(sample.longTaskDurationsMs).toEqual([60]);
    expect(sample.longTasksOver50Ms).toBe(1);
    expect(sample.layoutShiftValue).toBe(0.01);
    expect(Observer.instances).toHaveLength(2);
    for (const observer of Observer.instances) expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  it('disconnects observers when the bench fails', async () => {
    Observer.supportedEntryTypes = ['longtask', 'layout-shift'];
    vi.mocked(window.bench.run).mockRejectedValue(new Error('fixture failed'));
    await expect(sampleRafScenario('pan-fit')).rejects.toThrow('fixture failed');
    for (const observer of Observer.instances) expect(observer.disconnect).toHaveBeenCalledOnce();
  });
});
