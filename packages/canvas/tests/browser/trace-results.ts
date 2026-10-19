export type TraceRun = {
  run: number;
  rendererMainP95Ms: number;
  rafIntervalP95Ms: number;
  longTasksOver50Ms: number;
  longTaskDurationsMs: number[];
  domNodes: number;
  rendererFrameSamples: number;
};

export function traceOwnership(input: {
  count: number;
  world: 'html' | 'svg';
  scenario: string;
}): 'gated' | 'reported, owned by culling or SVG tier' {
  return input.count === 708 && input.world === 'html' && input.scenario === 'pan-100'
    ? 'gated'
    : 'reported, owned by culling or SVG tier';
}

export function aggregateTraceRuns(runs: readonly TraceRun[]): {
  rendererMainP95Ms: number;
  rafIntervalP95Ms: number;
  runs: readonly TraceRun[];
} {
  if (runs.length !== 3)
    throw new TypeError(`Trace aggregation requires three runs; received ${runs.length}`);
  const median = (field: 'rendererMainP95Ms' | 'rafIntervalP95Ms'): number => {
    const values = runs.map((run) => run[field]);
    if (values.some((value) => !Number.isFinite(value) || value < 0))
      throw new TypeError(`Trace ${field} must be finite and nonnegative; received ${values}`);
    return values.sort((left, right) => left - right)[1];
  };
  return {
    rendererMainP95Ms: median('rendererMainP95Ms'),
    rafIntervalP95Ms: median('rafIntervalP95Ms'),
    runs,
  };
}
