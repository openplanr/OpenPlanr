import type { ReactScenarioMetrics } from '../../bench/harness';
import type { HitTestProbe } from '../../bench/hit-test';
import type { ScenarioOverviewMetrics } from '../../bench/main';

import { CANVAS_TRACE_BUDGETS } from '../../src/testing/index.mts';

export { domBudgetPolicy, traceBudgetPolicy, traceOwnership } from '../../src/testing/index.mts';

export const DOM_NODE_BUDGET = CANVAS_TRACE_BUDGETS.domNodes;
export const RUNNER_BUDGETS = process.env.CI === 'true';
export const SECOND_DENSITY = parseSecondDensity(process.env.CANVAS_SECOND_DENSITY);

export function parseSecondDensity(value: string | undefined): boolean {
  if (value === undefined || value === '0') return false;
  if (value === '1') return true;
  throw new TypeError(`CANVAS_SECOND_DENSITY: expected 0 or 1; received ${JSON.stringify(value)}`);
}

export type TraceRun = {
  react?: ReactScenarioMetrics;
  run: number;
  gpuRenderer: string;
  hitTestP95Ms: number;
  hitTestProbe: HitTestProbe;
  rendererMainP95Ms: number;
  rendererMainWorstMs: number;
  overview: ScenarioOverviewMetrics;
  rafIntervalP95Ms: number;
  longTasksOver50Ms: number;
  longTaskDurationsMs: number[];
  domNodes: number;
  rendererFrameSamples: number;
  mountCounts?: readonly number[];
};

/**
 * Geometric mean of the non-remount renderer main p95 medians: one number for runner speed.
 * Non-positive or non-finite medians are counted in `skipped`; with no usable row the value is null.
 */
export function traceSpeedIndex(
  measurements: readonly { scenario: string; rendererMainP95Ms: number }[],
): { valueMs: number | null; rows: number; skipped: number } {
  const candidates = measurements
    .filter((item) => item.scenario !== 'remount')
    .map((item) => item.rendererMainP95Ms);
  const values = candidates.filter((value) => Number.isFinite(value) && value > 0);
  const skipped = candidates.length - values.length;
  if (values.length === 0) return { valueMs: null, rows: 0, skipped };
  const logMean = values.reduce((sum, value) => sum + Math.log(value), 0) / values.length;
  return { valueMs: Math.round(Math.exp(logMean) * 1000) / 1000, rows: values.length, skipped };
}

export function aggregateTraceRuns(runs: readonly TraceRun[]): {
  hitTestP95Ms: number;
  rendererMainP95Ms: number;
  rafIntervalP95Ms: number;
  runs: readonly TraceRun[];
} {
  if (runs.length !== 3)
    throw new TypeError(`Trace aggregation requires three runs; received ${runs.length}`);
  const median = (field: 'rendererMainP95Ms' | 'rafIntervalP95Ms' | 'hitTestP95Ms'): number => {
    const values = runs.map((run) => run[field]);
    if (values.some((value) => !Number.isFinite(value) || value < 0))
      throw new TypeError(`Trace ${field} must be finite and nonnegative; received ${values}`);
    return values.sort((left, right) => left - right)[1];
  };
  return {
    hitTestP95Ms: median('hitTestP95Ms'),
    rendererMainP95Ms: median('rendererMainP95Ms'),
    rafIntervalP95Ms: median('rafIntervalP95Ms'),
    runs,
  };
}
