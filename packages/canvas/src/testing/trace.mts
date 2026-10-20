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
