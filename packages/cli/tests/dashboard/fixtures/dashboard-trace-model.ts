import {
  aggregateLayoutShifts,
  rendererFrameWork as canvasFrameWork,
  classifyLayoutShift,
  percentile95,
  type RendererTraceEvent,
} from '@openplanr/canvas/testing';
import type {
  DashboardLayoutShift,
  DashboardLayoutShiftReport,
} from './dashboard-layout-shifts.js';

export const TRACE_PLAN = Object.freeze({ durationMs: 10_000, inputCount: 100, patchCount: 50 });
export function paletteTraceInputs<T extends Readonly<{ id: string; title: string }>>(
  nodes: readonly T[],
) {
  if (nodes.length < TRACE_PLAN.inputCount)
    throw new Error('Palette trace requires a complete fixture.');
  return Array.from({ length: TRACE_PLAN.inputCount }, (_, index) => {
    const node = nodes[index % 2 === 0 ? index : nodes.length - index];
    return { node, query: index % 2 === 0 ? node.id : node.title };
  });
}

export const TRACE_BUDGETS = Object.freeze({
  coldShellMs: 500,
  usefulSnapshotMs: 1_000,
  latencyP95Ms: 100,
  listWarmRouteP95Ms: 60,
  frameWorkP95Ms: 16.7,
  longTaskMs: 50,
  cls: 0,
});

// CI runners are about twice as slow as the reference machine; only these List gates differ there.
export const RUNNER_BUDGETS = process.env.CI === 'true';
const RUNNER_OVERRIDES = Object.freeze({ listWarmRouteP95Ms: 100, frameWorkP95Ms: 24 });

/** The budget set a representative trace is gated by, with the local reference values. */
export function traceBudgetPolicy(runnerBudgets: boolean = RUNNER_BUDGETS) {
  return Object.freeze({
    budgetSet: runnerBudgets ? ('runner' as const) : ('local' as const),
    effective: Object.freeze(
      runnerBudgets ? { ...TRACE_BUDGETS, ...RUNNER_OVERRIDES } : TRACE_BUDGETS,
    ),
    reference: TRACE_BUDGETS,
  });
}

/** Shifts in these phases may follow the input that caused them, within 500 ms. */
const DASHBOARD_SHIFT_POLICY = Object.freeze({
  inputPhase: (phase: string) =>
    /^(filter-input|palette)(?:\s|$)/u.test(phase) || phase === 'graph-lens whole project',
  inputWindowMs: 500,
});

export function classifyDashboardLayoutShift(
  shift: DashboardLayoutShift,
  evidence: Pick<DashboardLayoutShiftReport, 'phases' | 'inputActions'>,
): Readonly<{ inputDriven: boolean; reason: 'counted' | 'native-excluded' | 'input-driven' }> {
  return classifyLayoutShift(shift, { ...evidence, shifts: [] }, DASHBOARD_SHIFT_POLICY);
}

export function aggregateDashboardLayoutShifts(evidence: DashboardLayoutShiftReport) {
  return aggregateLayoutShifts(evidence, DASHBOARD_SHIFT_POLICY);
}

/** Freeze fixture wall time without replacing native performance marks, timers or frames. */
export function installFixedDashboardDate(now: number): void {
  const NativeDate = Date;
  globalThis.Date = new Proxy(NativeDate, {
    apply: () => new NativeDate(now).toString(),
    construct: (target, args, newTarget) =>
      Reflect.construct(target, args.length === 0 ? [now] : args, newTarget),
    get: (target, property, receiver) =>
      property === 'now' ? () => now : Reflect.get(target, property, receiver),
  });
}

export { percentile95, type RendererTraceEvent };

/** Renderer main-thread work per frame between the dashboard's own trace marks. */
export function rendererFrameWork(events: readonly RendererTraceEvent[]): number[] {
  return canvasFrameWork(events, {
    frame: 'dashboard-frame',
    start: 'dashboard-interaction-start',
    end: 'dashboard-interaction-end',
  });
}

export type InteractionTrace = Readonly<{
  durationMs: number;
  frameWorkMs: readonly number[];
  frameIntervalsMs: readonly number[];
  longTasksMs: readonly number[];
  cls: number;
  interactionObserved: boolean;
  panObserved?: boolean;
  zoomObserved?: boolean;
}>;
export type SelectionSample = Readonly<{
  id: string | null;
  focusedId: string | null;
  scrollTop: number;
  anchorTop: number;
}>;
export type DashboardTraceMeasurements = Readonly<{
  coldShellMs: number;
  usefulSnapshotMs: number;
  warmRoutesMs: readonly number[];
  warmRouteSamples?: readonly Readonly<{ route: string; durationMs: number }>[];
  panelsMs: readonly number[];
  filterMs: readonly number[];
  paletteMs: readonly number[];
  palettePreviewMs: readonly number[] | null;
  patchesMs: readonly number[];
  graph: InteractionTrace;
  list: InteractionTrace;
  cls: number;
  layoutShiftEvidence?: DashboardLayoutShiftReport;
  selectionBefore: SelectionSample;
  selectionAfter: readonly SelectionSample[];
  nodeCount: number;
  edgeCount: number;
  browserErrors: readonly string[];
}>;

export function evaluateDashboardTrace(
  tier: 'representative' | 'scaling',
  metrics: DashboardTraceMeasurements,
  budgetPolicy = traceBudgetPolicy(),
) {
  const budgets = budgetPolicy.effective;
  const layoutShifts = metrics.layoutShiftEvidence
    ? aggregateDashboardLayoutShifts(metrics.layoutShiftEvidence)
    : null;
  const cls = layoutShifts?.admittedCls ?? metrics.cls;
  const failures: string[] = [];
  const pending: { scenario: string; reason: string }[] = [];
  const require = (condition: boolean, message: string) => {
    if (!condition) failures.push(message);
  };
  const expectedNodes = tier === 'representative' ? 708 : 5_000;
  const expectedEdges = tier === 'representative' ? 477 : 8_499;
  const routeSamples = new Map<string, number[]>();
  for (const sample of metrics.warmRouteSamples ?? []) {
    if (!sample.route.trim()) throw new TypeError('Warm route identity must be present.');
    const samples = routeSamples.get(sample.route) ?? [];
    samples.push(sample.durationMs);
    routeSamples.set(sample.route, samples);
  }
  const warmRouteP95ByRouteMs = Object.fromEntries(
    [...routeSamples].map(([route, samples]) => [route, percentile95(samples)]),
  );
  if (metrics.warmRouteSamples)
    require(metrics.warmRouteSamples.length === metrics.warmRoutesMs.length &&
      metrics.warmRouteSamples.every(
        (sample, index) => sample.durationMs === metrics.warmRoutesMs[index],
      ), 'Warm route samples are inconsistent.');
  const summaries = {
    warmRouteP95Ms: percentile95(metrics.warmRoutesMs),
    panelP95Ms: percentile95(metrics.panelsMs),
    filterP95Ms: percentile95(metrics.filterMs),
    paletteP95Ms: percentile95(metrics.paletteMs),
    palettePreviewP95Ms:
      metrics.palettePreviewMs === null ? null : percentile95(metrics.palettePreviewMs),
    patchP95Ms: percentile95(metrics.patchesMs),
    graphFrameWorkP95Ms: percentile95(metrics.graph.frameWorkMs),
    listFrameWorkP95Ms: percentile95(metrics.list.frameWorkMs),
    graphFrameIntervalP95Ms: percentile95(metrics.graph.frameIntervalsMs),
    listFrameIntervalP95Ms: percentile95(metrics.list.frameIntervalsMs),
  };
  require(metrics.nodeCount === expectedNodes &&
    metrics.edgeCount === expectedEdges, 'Graph cardinality changed.');
  require(metrics.browserErrors.length === 0, 'Browser errors or crashes occurred.');
  require(metrics.filterMs.length === TRACE_PLAN.inputCount &&
    metrics.paletteMs.length === TRACE_PLAN.inputCount, 'Input samples are incomplete.');
  if (metrics.palettePreviewMs === null) require(false, 'Palette preview measurements are absent.');
  else
    require(metrics.palettePreviewMs.length ===
      TRACE_PLAN.inputCount, 'Palette preview measurements are incomplete.');
  require(metrics.patchesMs.length === TRACE_PLAN.patchCount &&
    metrics.selectionAfter.length === TRACE_PLAN.patchCount, 'Patch samples are incomplete.');
  require(metrics.selectionBefore.id !== null &&
    metrics.selectionBefore.focusedId ===
      metrics.selectionBefore.id, 'Initial canonical selection/focus is absent.');
  require(metrics.selectionAfter.every(
    (sample) =>
      sample.id === metrics.selectionBefore.id &&
      sample.focusedId === metrics.selectionBefore.focusedId &&
      sample.scrollTop === metrics.selectionBefore.scrollTop &&
      Math.abs(sample.anchorTop - metrics.selectionBefore.anchorTop) <= 0.5,
  ), 'Selection, focus or scroll anchor was lost.');
  for (const [name, trace] of [
    ['graph', metrics.graph],
    ['list', metrics.list],
  ] as const) {
    require(trace.durationMs >= TRACE_PLAN.durationMs &&
      trace.interactionObserved, `${name} interaction trace is incomplete.`);
    percentile95([trace.cls, trace.durationMs, ...trace.longTasksMs]);
  }
  percentile95([metrics.coldShellMs, metrics.usefulSnapshotMs, cls]);
  if (tier === 'representative') {
    require(metrics.coldShellMs <= budgets.coldShellMs, 'Cold shell exceeds budget.');
    require(metrics.usefulSnapshotMs <=
      budgets.usefulSnapshotMs, 'Useful snapshot exceeds budget.');
    for (const [name, value] of Object.entries(summaries).filter(
      ([name]) => !name.includes('Frame') && name !== 'patchP95Ms',
    ))
      if (value !== null) require(value <= budgets.latencyP95Ms, `${name} exceeds budget.`);
    for (const [route, value] of Object.entries(warmRouteP95ByRouteMs))
      require(route === '#/list'
        ? value < budgets.listWarmRouteP95Ms
        : value <= budgets.latencyP95Ms, `${route} warmRouteP95Ms exceeds budget.`);
    require(summaries.graphFrameWorkP95Ms <= budgets.frameWorkP95Ms &&
      summaries.listFrameWorkP95Ms <= budgets.frameWorkP95Ms, 'Frame work exceeds budget.');
    require([...metrics.graph.longTasksMs, ...metrics.list.longTasksMs].every(
      (value) => value <= budgets.longTaskMs,
    ), 'Steady interaction contains a long task.');
    require(cls === 0 &&
      metrics.graph.cls === 0 &&
      metrics.list.cls === 0, 'Unexpected layout shift occurred.');
  }
  return {
    cls,
    ...(layoutShifts ? { layoutShifts } : {}),
    policy: tier === 'representative' ? 'budget' : 'scaling-baseline',
    budgetSet: budgetPolicy.budgetSet,
    budgets: { effective: budgetPolicy.effective, reference: budgetPolicy.reference },
    summaries: { ...summaries, warmRouteP95ByRouteMs },
    failures,
    pending,
    status: failures.length > 0 ? 'failed' : 'passed',
    passed: failures.length === 0 && pending.length === 0,
  };
}
