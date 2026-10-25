import type { Page } from '@playwright/test';
import type { Scenario } from '../../bench/main';
import { percentile95 } from '../../src/testing/index.mts';

export function summarizeRafIntervals(intervals: readonly number[]) {
  return {
    rafIntervalP95Ms: percentile95(intervals),
    worstFrameMs: Math.max(...intervals),
  };
}

export async function sampleRafScenario(scenario: Scenario) {
  const supported =
    typeof PerformanceObserver === 'undefined' ? [] : PerformanceObserver.supportedEntryTypes;
  const longTasks: PerformanceEntry[] = [];
  const layoutShifts: PerformanceEntry[] = [];
  const observe = (type: string, entries: PerformanceEntry[]) => {
    if (!supported.includes(type)) return null;
    const observer = new PerformanceObserver((list) => entries.push(...list.getEntries()));
    observer.observe({ type, buffered: false });
    return observer;
  };
  const taskObserver = observe('longtask', longTasks);
  const shiftObserver = observe('layout-shift', layoutShifts);
  try {
    const result = await window.bench.run(scenario);
    const start = performance.getEntriesByName('canvas-interaction-start', 'mark').at(-1);
    const end = performance.getEntriesByName('canvas-interaction-end', 'mark').at(-1);
    const firstFrame = performance.getEntriesByName('canvas-first-frame', 'mark').at(-1);
    if (!start || !end || end.startTime <= start.startTime || !firstFrame)
      throw new Error(`Canvas rAF ${scenario}: interaction or first-frame marks are missing`);
    const inWindow = (entry: PerformanceEntry) =>
      entry.startTime >= start.startTime && entry.startTime <= end.startTime;
    const engineFrameSamples = performance
      .getEntriesByName('canvas-frame', 'mark')
      .filter(inWindow).length;
    if (engineFrameSamples < 2)
      throw new Error(
        `Canvas rAF ${scenario}: expected frame marks, received ${engineFrameSamples}`,
      );
    longTasks.push(...(taskObserver?.takeRecords() ?? []));
    layoutShifts.push(...(shiftObserver?.takeRecords() ?? []));
    const longTaskDurationsMs = taskObserver
      ? longTasks
          .filter((entry) => inWindow(entry) && entry.duration > 50)
          .map((entry) => entry.duration)
      : ('unsupported' as const);
    const layoutShiftValue = shiftObserver
      ? layoutShifts.filter(inWindow).reduce((total, entry) => {
          if (
            !('value' in entry) ||
            typeof entry.value !== 'number' ||
            !Number.isFinite(entry.value) ||
            entry.value < 0
          )
            throw new TypeError(
              `Canvas rAF ${scenario}: invalid layout-shift value at ${entry.startTime}`,
            );
          return total + entry.value;
        }, 0)
      : ('unsupported' as const);
    return {
      intervals: result.intervals,
      rendererMainP95Ms: 'unsupported' as const,
      longTasksOver50Ms:
        longTaskDurationsMs === 'unsupported'
          ? ('unsupported' as const)
          : longTaskDurationsMs.length,
      longTaskDurationsMs,
      layoutShiftValue,
      engineFrameSamples,
      firstFrameMs: firstFrame.startTime,
      domNodes: result.domNodes,
      gpuRenderer: result.gpuRenderer,
      hitTestP95Ms: result.hitTestP95Ms,
      hitTestProbe: result.hitTestProbe,
      overview: result.overview,
      ...(result.react ? { react: result.react } : {}),
    };
  } finally {
    taskObserver?.disconnect();
    shiftObserver?.disconnect();
  }
}

export async function recordRafRun(page: Page, scenario: Scenario) {
  const sample = await page.evaluate(sampleRafScenario, scenario);
  return { ...sample, ...summarizeRafIntervals(sample.intervals) };
}
