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

export type RendererTraceMarks = Readonly<{
  frame?: string;
  start?: string;
  end?: string;
}>;

export function rendererFrameWork(
  events: readonly RendererTraceEvent[],
  marks: RendererTraceMarks = {},
): number[] {
  const frameName = marks.frame ?? 'canvas-frame';
  const startName = marks.start ?? 'canvas-interaction-start';
  const endName = marks.end ?? 'canvas-interaction-end';
  const frame = events.find((event) => event.name === frameName);
  if (!frame)
    throw new Error(`Frame marks ${frameName} are absent. Preserve native performance.mark.`);
  const main = events.find(
    (event) =>
      event.name === 'thread_name' &&
      event.ph === 'M' &&
      event.args?.name === 'CrRendererMain' &&
      event.pid === frame.pid &&
      event.tid === frame.tid,
  );
  if (!main) throw new Error('Renderer main thread metadata is absent.');
  const owned = events.filter((event) => event.pid === main.pid && event.tid === main.tid);
  const start = owned.find((event) => event.name === startName)?.ts;
  const end = owned.find((event) => event.name === endName)?.ts;
  if (start === undefined || end === undefined || end <= start)
    throw new Error(
      `Interaction trace boundaries ${startName} and ${endName} are absent or invalid.`,
    );
  const frames = owned
    .filter((event) => event.name === frameName && event.ts >= start && event.ts <= end)
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
export type LayoutShiftRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}>;

export type LayoutShift = Readonly<{
  value: number;
  startTime: number;
  hadRecentInput: boolean;
  phase: string;
  sources: readonly Readonly<{
    selector: string | null;
    nodeKind: 'element' | 'text' | 'other' | 'unavailable';
    connected: boolean | null;
    previousRect: LayoutShiftRect;
    currentRect: LayoutShiftRect;
  }>[];
}>;

export type LayoutShiftReport = Readonly<{
  phases: readonly Readonly<{ phase: string; startTime: number }>[];
  inputActions: readonly Readonly<{ phase: string; phaseIndex: number; startTime: number }>[];
  shifts: readonly LayoutShift[];
}>;

export type LayoutShiftPolicy = Readonly<{
  inputPhase: (phase: string) => boolean;
  inputWindowMs?: number;
}>;

export function classifyLayoutShift(
  shift: LayoutShift,
  evidence: LayoutShiftReport,
  policy: LayoutShiftPolicy,
): { inputDriven: boolean; reason: 'counted' | 'native-excluded' | 'input-driven' } {
  let phaseIndex = -1;
  for (let index = evidence.phases.length - 1; index >= 0; index -= 1) {
    if (evidence.phases[index].startTime <= shift.startTime) {
      phaseIndex = index;
      break;
    }
  }
  const phase = evidence.phases[phaseIndex];
  if (!phase || phase.phase !== shift.phase || !policy.inputPhase(phase.phase))
    return { inputDriven: false, reason: 'counted' };
  const inputDriven = evidence.inputActions.some(
    (action) =>
      action.phase === phase.phase &&
      action.phaseIndex === phaseIndex &&
      action.startTime >= phase.startTime &&
      action.startTime <= shift.startTime &&
      shift.startTime - action.startTime <= (policy.inputWindowMs ?? 500),
  );
  return {
    inputDriven,
    reason: !inputDriven ? 'counted' : shift.hadRecentInput ? 'native-excluded' : 'input-driven',
  };
}

export function aggregateLayoutShifts(evidence: LayoutShiftReport, policy: LayoutShiftPolicy) {
  for (const shift of evidence.shifts)
    if (
      !Number.isFinite(shift.value) ||
      shift.value < 0 ||
      !Number.isFinite(shift.startTime) ||
      shift.startTime < 0
    )
      throw new TypeError(
        'Layout shift samples must have finite nonnegative values and start times.',
      );
  const shifts = evidence.shifts.map((shift) => ({
    ...shift,
    ...classifyLayoutShift(shift, evidence, policy),
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
