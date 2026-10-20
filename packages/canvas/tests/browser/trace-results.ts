import type { HitTestProbe } from '../../bench/hit-test';
import type { ScenarioOverviewMetrics } from '../../bench/main';

export const DOM_NODE_BUDGET = 2000;
export const RUNNER_BUDGETS = process.env.CI === 'true';

export function traceBudgetPolicy(runnerBudgets: boolean): {
  budgetSet: 'local' | 'runner';
  remountRendererMainP95Ms: number | null;
  rafIntervalP95Ms: number | null;
} {
  return {
    budgetSet: runnerBudgets ? 'runner' : 'local',
    remountRendererMainP95Ms: runnerBudgets ? null : 16,
    rafIntervalP95Ms: runnerBudgets ? null : 16.8,
  };
}

export type TraceRun = {
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

export function traceOwnership(input: {
  count: number;
  world: 'html' | 'svg';
  scenario: string;
}): 'gated' | 'reported, SVG stress tier' {
  return input.world === 'html' || input.count === 708 ? 'gated' : 'reported, SVG stress tier';
}

export function domBudgetPolicy(input: Parameters<typeof traceOwnership>[0]): {
  ownership: 'gated' | 'reported, SVG stress tier' | 'reported, remount timing only';
  regressionLimit: number | null;
} {
  if (traceOwnership(input) !== 'gated')
    return { ownership: 'reported, SVG stress tier', regressionLimit: null };
  if (input.scenario === 'remount')
    return { ownership: 'reported, remount timing only', regressionLimit: null };
  return { ownership: 'gated', regressionLimit: DOM_NODE_BUDGET };
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
