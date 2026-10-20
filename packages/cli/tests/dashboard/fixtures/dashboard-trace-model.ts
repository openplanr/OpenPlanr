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

export function classifyDashboardLayoutShift(
  shift: DashboardLayoutShift,
  evidence: Pick<DashboardLayoutShiftReport, 'phases' | 'inputActions'>,
): Readonly<{ inputDriven: boolean; reason: 'counted' | 'native-excluded' | 'input-driven' }> {
  let phaseIndex = -1;
  for (let index = evidence.phases.length - 1; index >= 0; index -= 1) {
    if (evidence.phases[index].startTime <= shift.startTime) {
      phaseIndex = index;
      break;
    }
  }
  const phase = evidence.phases[phaseIndex];
  if (
    !phase ||
    phase.phase !== shift.phase ||
    (!/^(filter-input|palette)(?:\s|$)/u.test(phase.phase) &&
      phase.phase !== 'graph-lens whole project')
  )
    return { inputDriven: false, reason: 'counted' };
  const inputDriven = evidence.inputActions.some(
    (action) =>
      action.phase === phase.phase &&
      action.phaseIndex === phaseIndex &&
      action.startTime >= phase.startTime &&
      action.startTime <= shift.startTime &&
      shift.startTime - action.startTime <= 500,
  );
  return {
    inputDriven,
    reason: !inputDriven ? 'counted' : shift.hadRecentInput ? 'native-excluded' : 'input-driven',
  };
}

export function aggregateDashboardLayoutShifts(evidence: DashboardLayoutShiftReport) {
  for (const shift of evidence.shifts) {
    if (
      !Number.isFinite(shift.value) ||
      shift.value < 0 ||
      !Number.isFinite(shift.startTime) ||
      shift.startTime < 0
    )
      throw new TypeError(
        'Layout shift samples must have finite nonnegative values and start times.',
      );
  }
  const shifts = evidence.shifts.map((shift) => ({
    ...shift,
    ...classifyDashboardLayoutShift(shift, evidence),
  }));
  const sum = (reason: (typeof shifts)[number]['reason']) =>
    shifts.reduce((total, shift) => total + (shift.reason === reason ? shift.value : 0), 0);
  const nativeExcludedCls = sum('native-excluded');
  const inputDrivenCls = sum('input-driven');
  return {
    ...evidence,
    shifts,
    admittedCls: sum('counted'),
    excludedCls: nativeExcludedCls + inputDrivenCls,
    nativeExcludedCls,
    inputDrivenCls,
  };
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

export function percentile95(values: readonly number[]): number {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value) || value < 0))
    throw new TypeError('Trace samples must be nonempty finite nonnegative values.');
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
}

export type RendererTraceEvent = {
  name: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: { name?: string };
};

export function rendererFrameWork(events: readonly RendererTraceEvent[]): number[] {
  const frame = events.find((event) => event.name === 'dashboard-frame');
  if (!frame)
    throw new Error('Dashboard frame marks are absent. Preserve native performance.mark.');
  const main = events.find(
    (event) =>
      event.name === 'thread_name' &&
      event.ph === 'M' &&
      event.args?.name === 'CrRendererMain' &&
      event.pid === frame?.pid &&
      event.tid === frame?.tid,
  );
  if (!main) throw new Error('Renderer main thread metadata is absent.');
  const owned = events.filter((event) => event.pid === main.pid && event.tid === main.tid);
  const start = owned.find((event) => event.name === 'dashboard-interaction-start')?.ts;
  const end = owned.find((event) => event.name === 'dashboard-interaction-end')?.ts;
  if (start === undefined || end === undefined || end <= start)
    throw new Error('Interaction trace boundaries are absent.');
  const frames = owned
    .filter((event) => event.name === 'dashboard-frame' && event.ts >= start && event.ts <= end)
    .map((event) => event.ts)
    .sort((a, b) => a - b);
  const tasks = owned.filter(
    (event) =>
      ['RunTask', 'ThreadControllerImpl::RunTask'].includes(event.name) &&
      event.ph === 'X' &&
      event.dur !== undefined,
  );
  if (frames.length < 2 || tasks.length === 0)
    throw new Error('Renderer frame/task samples are absent.');
  return frames.slice(1).map((end, index) => {
    const start = frames[index];
    const spans = tasks
      .map((task) => [Math.max(start, task.ts), Math.min(end, task.ts + (task.dur ?? 0))])
      .filter(([left, right]) => right > left)
      .sort((a, b) => a[0] - b[0]);
    let covered = start;
    let work = 0;
    for (const [left, right] of spans) {
      work += Math.max(0, right - Math.max(left, covered));
      covered = Math.max(covered, right);
    }
    return work / 1_000;
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
) {
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
    require(metrics.coldShellMs <= TRACE_BUDGETS.coldShellMs, 'Cold shell exceeds budget.');
    require(metrics.usefulSnapshotMs <=
      TRACE_BUDGETS.usefulSnapshotMs, 'Useful snapshot exceeds budget.');
    for (const [name, value] of Object.entries(summaries).filter(
      ([name]) => !name.includes('Frame') && name !== 'patchP95Ms',
    ))
      if (value !== null) require(value <= TRACE_BUDGETS.latencyP95Ms, `${name} exceeds budget.`);
    for (const [route, value] of Object.entries(warmRouteP95ByRouteMs))
      require(route === '#/list'
        ? value < TRACE_BUDGETS.listWarmRouteP95Ms
        : value <= TRACE_BUDGETS.latencyP95Ms, `${route} warmRouteP95Ms exceeds budget.`);
    require(summaries.graphFrameWorkP95Ms <= TRACE_BUDGETS.frameWorkP95Ms &&
      summaries.listFrameWorkP95Ms <= TRACE_BUDGETS.frameWorkP95Ms, 'Frame work exceeds budget.');
    require([...metrics.graph.longTasksMs, ...metrics.list.longTasksMs].every(
      (value) => value <= TRACE_BUDGETS.longTaskMs,
    ), 'Steady interaction contains a long task.');
    require(cls === 0 &&
      metrics.graph.cls === 0 &&
      metrics.list.cls === 0, 'Unexpected layout shift occurred.');
  }
  return {
    cls,
    ...(layoutShifts ? { layoutShifts } : {}),
    policy: tier === 'representative' ? 'budget' : 'scaling-baseline',
    summaries: { ...summaries, warmRouteP95ByRouteMs },
    failures,
    pending,
    status: failures.length > 0 ? 'failed' : 'passed',
    passed: failures.length === 0 && pending.length === 0,
  };
}
