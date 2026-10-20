import { aggregateLayoutShifts, type LayoutShiftReport } from './trace.mjs';

export const CANVAS_TRACE_BUDGETS = Object.freeze({
  rendererMainP95Ms: Object.freeze({
    vanilla: Object.freeze({ 708: 6, 5000: 8 }),
    react: Object.freeze({ 708: 8, 5000: 10 }),
    svg: Object.freeze({ 708: 8, 5000: 12 }),
  }),
  remountRendererMainP95Ms: 16,
  longTasksOver50Ms: 0,
  rafIntervalP95Ms: 16.8,
  domNodes: 2000,
  firstFrameP50Ms: 150,
  runnerFirstFrameP50Ms: 250,
  firstFrameLoads: 5,
  hitTestP95Ms: 0.1,
  hitTestSampleCount: 1000,
  hitTestQueryCount: 1000,
  hitTestMinSampleDurationMs: 1,
  admittedCls: 0,
  chromeToggles: 16,
  lodSwitches: 20,
  blankFrames: 0,
  doubleLayerFrames: 0,
  droppedPins: 0,
  pureCameraCommits: 0,
  webkit: Object.freeze({ rafIntervalP95Ms: 19, pan40WorstFrameMs: 33 }),
  firefox: Object.freeze({
    pan100FrameP95Ms: 17,
    panFitFrameP95Ms: Object.freeze({ 708: 20, 5000: 25 }),
  }),
});

export function traceBudgetPolicy(runnerBudgets: boolean): {
  budgetSet: 'local' | 'runner';
  remountRendererMainP95Ms: number | null;
  rafIntervalP95Ms: number | null;
  firstFrameP50Ms: number;
} {
  return {
    budgetSet: runnerBudgets ? 'runner' : 'local',
    remountRendererMainP95Ms: runnerBudgets ? null : CANVAS_TRACE_BUDGETS.remountRendererMainP95Ms,
    rafIntervalP95Ms: runnerBudgets ? null : CANVAS_TRACE_BUDGETS.rafIntervalP95Ms,
    firstFrameP50Ms: runnerBudgets
      ? CANVAS_TRACE_BUDGETS.runnerFirstFrameP50Ms
      : CANVAS_TRACE_BUDGETS.firstFrameP50Ms,
  };
}

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
  return { ownership: 'gated', regressionLimit: CANVAS_TRACE_BUDGETS.domNodes };
}

export type CanvasTraceIdentity = Readonly<{
  count: 708 | 5000;
  fixture: string;
  renderer: 'vanilla' | 'react';
  world: 'html' | 'svg';
  dpr: 1 | 2;
}>;
export type CanvasHitTestProbe = Readonly<{
  p95Ms: number;
  sampleCount: number;
  queryCount: number;
  minSampleDurationMs: number;
}>;
export type CanvasTraceRun = Readonly<{
  run: number;
  rendererMainP95Ms?: number;
  rafIntervalP95Ms: number;
  worstFrameMs?: number;
  longTasksOver50Ms: number;
  domNodes: number;
  hitTestP95Ms: number;
  hitTestProbe: CanvasHitTestProbe;
  react?: Readonly<{ pureCameraCommits: number; pureCameraFrames: number }>;
}>;
export type CanvasTraceMeasurement = CanvasTraceIdentity &
  Readonly<{
    scenario: 'pan-100' | 'pan-40' | 'pan-fit' | 'zoom-sweep' | 'remount';
    runs: readonly CanvasTraceRun[];
    firstFrameP50Ms: number;
    firstFrameTrialsMs: readonly number[];
  }>;
export type CanvasHitTestMeasurement = CanvasTraceIdentity &
  Readonly<{ hitTestProbe: CanvasHitTestProbe }>;
export type CanvasChromeSnapshot = Readonly<{
  camera: Readonly<{ x: number; y: number; zoom: number }>;
  stage: Readonly<{ x: number; y: number; width: number; height: number }>;
}>;
export type CanvasChromeMeasurement = CanvasTraceIdentity &
  Readonly<{
    layoutShifts: LayoutShiftReport;
    before: CanvasChromeSnapshot;
    after: CanvasChromeSnapshot;
    snapshots: readonly CanvasChromeSnapshot[];
  }>;
export type CanvasLodMeasurement = CanvasTraceIdentity &
  Readonly<{
    band: 'full-compact' | 'compact-overview';
    switches: number;
    levels: readonly string[];
    blank: number;
    both: number;
  }>;
export type CanvasPinMeasurement = CanvasTraceIdentity &
  Readonly<{
    pinCount: 50 | 500;
    domNodes: number;
    droppedPins: number;
  }>;
export type CanvasTraceResults = Readonly<{
  browser: Readonly<{ name: 'chromium' | 'webkit' | 'firefox'; version: string }>;
  budgetSet: 'local' | 'runner';
  measurements?: readonly CanvasTraceMeasurement[];
  hitTests?: readonly CanvasHitTestMeasurement[];
  chrome?: readonly CanvasChromeMeasurement[];
  lod?: readonly CanvasLodMeasurement[];
  pins?: readonly CanvasPinMeasurement[];
}>;
export type CanvasTraceEvaluation = {
  tier: 708 | 5000;
  budgetSet: CanvasTraceResults['budgetSet'];
  browser: CanvasTraceResults['browser'];
  failures: string[];
  reported: string[];
  pending: string[];
  passed: boolean;
};

function object(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError(`${field} must be an object; received ${String(value)}`);
}
function numeric(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new TypeError(`${field} must be finite and nonnegative; received ${String(value)}`);
}
function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0)
    throw new TypeError(`${field} must be a nonempty string; received ${String(value)}`);
}
function choice(value: unknown, choices: readonly unknown[], field: string): void {
  if (!choices.includes(value))
    throw new TypeError(`${field} must be one of ${choices.join(', ')}; received ${String(value)}`);
}
function samples(value: unknown, field: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new TypeError(`${field} must be a nonempty array`);
}
function identity(item: CanvasTraceIdentity, field: string): void {
  object(item, field);
  choice(item.count, [708, 5000], `${field}.count`);
  text(item.fixture, `${field}.fixture`);
  choice(item.renderer, ['vanilla', 'react'], `${field}.renderer`);
  choice(item.world, ['html', 'svg'], `${field}.world`);
  choice(item.dpr, [1, 2], `${field}.dpr`);
}
function snapshot(value: CanvasChromeSnapshot, field: string): void {
  object(value, field);
  for (const group of ['camera', 'stage'] as const) {
    object(value[group], `${field}.${group}`);
    for (const key of group === 'camera' ? ['x', 'y', 'zoom'] : ['x', 'y', 'width', 'height']) {
      const coordinates: unknown = value[group];
      object(coordinates, `${field}.${group}`);
      const coordinate = coordinates[key];
      if (typeof coordinate !== 'number' || !Number.isFinite(coordinate))
        throw new TypeError(`${field}.${group}.${key} must be finite`);
    }
  }
}
function layoutEvidence(evidence: LayoutShiftReport, field: string): void {
  object(evidence, field);
  for (const key of ['phases', 'inputActions', 'shifts'] as const) {
    if (!Array.isArray(evidence[key])) throw new TypeError(`${field}.${key} must be an array`);
    for (const [index, entry] of evidence[key].entries()) {
      const path = `${field}.${key}[${index}]`;
      object(entry, path);
      text(entry.phase, `${path}.phase`);
      numeric(entry.startTime, `${path}.startTime`);
      if (key === 'inputActions') numeric(entry.phaseIndex, `${path}.phaseIndex`);
      if (key !== 'shifts') continue;
      numeric(entry.value, `${path}.value`);
      if (typeof entry.hadRecentInput !== 'boolean')
        throw new TypeError(`${path}.hadRecentInput must be boolean`);
      if (!Array.isArray(entry.sources)) throw new TypeError(`${path}.sources must be an array`);
      for (const [sourceIndex, source] of entry.sources.entries()) {
        const sourcePath = `${path}.sources[${sourceIndex}]`;
        object(source, sourcePath);
        if (source.selector !== null) text(source.selector, `${sourcePath}.selector`);
        choice(
          source.nodeKind,
          ['element', 'text', 'other', 'unavailable'],
          `${sourcePath}.nodeKind`,
        );
        choice(source.connected, [true, false, null], `${sourcePath}.connected`);
        for (const rect of ['previousRect', 'currentRect']) {
          object(source[rect], `${sourcePath}.${rect}`);
          for (const key of ['x', 'y', 'width', 'height', 'top', 'right', 'bottom', 'left'])
            if (typeof source[rect][key] !== 'number' || !Number.isFinite(source[rect][key]))
              throw new TypeError(`${sourcePath}.${rect}.${key} must be finite`);
        }
      }
    }
  }
}

export function evaluateCanvasTrace(
  results: CanvasTraceResults,
  tier: 708 | 5000,
): CanvasTraceEvaluation {
  object(results, 'results');
  choice(tier, [708, 5000], 'tier');
  choice(results.budgetSet, ['local', 'runner'], 'budgetSet');
  object(results.browser, 'browser');
  choice(results.browser.name, ['chromium', 'webkit', 'firefox'], 'browser.name');
  text(results.browser.version, 'browser.version');
  const failures: string[] = [];
  const reported: string[] = [];
  const pending = ['dropped frames at fit: compositor trace is not measured'];
  const limits = CANVAS_TRACE_BUDGETS;
  const policy = traceBudgetPolicy(results.budgetSet === 'runner');
  function check(
    item: CanvasTraceIdentity,
    scenario: string,
    metric: string,
    measured: number | string | boolean,
    limit: number | string | boolean,
    passes: boolean,
    reportOnly = false,
  ): void {
    if (item.count !== tier) return;
    const label = `${item.fixture} ${item.renderer} ${item.world} DPR ${item.dpr} ${scenario}: ${metric} measured ${measured}, limit ${limit}`;
    if (reportOnly) reported.push(label);
    else if (!passes) failures.push(label);
  }
  function maximum(
    item: CanvasTraceIdentity,
    scenario: string,
    metric: string,
    value: number,
    limit: number,
    reportOnly = false,
  ): void {
    numeric(value, `${item.fixture}.${scenario}.${metric}`);
    check(item, scenario, metric, value, limit, value <= limit, reportOnly);
  }
  function hitTest(
    item: CanvasTraceIdentity,
    scenario: string,
    probe: CanvasHitTestProbe,
    reportOnly = false,
  ): void {
    object(probe, `${item.fixture}.${scenario}.hitTestProbe`);
    for (const key of ['p95Ms', 'sampleCount', 'queryCount', 'minSampleDurationMs'] as const)
      numeric(probe[key], `${item.fixture}.${scenario}.hitTestProbe.${key}`);
    maximum(item, scenario, 'hitTestP95Ms', probe.p95Ms, limits.hitTestP95Ms, reportOnly);
    check(item, scenario, 'hitTestP95Ms', probe.p95Ms, '> 0', probe.p95Ms > 0, reportOnly);
    check(
      item,
      scenario,
      'sampleCount',
      probe.sampleCount,
      limits.hitTestSampleCount,
      probe.sampleCount === limits.hitTestSampleCount,
      reportOnly,
    );
    check(
      item,
      scenario,
      'queryCount',
      probe.queryCount,
      `>= ${limits.hitTestQueryCount}`,
      probe.queryCount >= limits.hitTestQueryCount,
      reportOnly,
    );
    check(
      item,
      scenario,
      'minSampleDurationMs',
      probe.minSampleDurationMs,
      `>= ${limits.hitTestMinSampleDurationMs}`,
      probe.minSampleDurationMs >= limits.hitTestMinSampleDurationMs,
      reportOnly,
    );
  }
  for (const section of ['measurements', 'hitTests', 'chrome', 'lod', 'pins'] as const) {
    const entries = results[section];
    if (entries === undefined) {
      pending.push(`${section}: absent for tier ${tier}`);
      continue;
    }
    if (!Array.isArray(entries)) throw new TypeError(`${section} must be an array`);
    for (const [index, item] of entries.entries()) identity(item, `${section}[${index}]`);
    if (!entries.some((item) => item.count === tier))
      pending.push(`${section}: absent for tier ${tier}`);
  }
  for (const item of results.measurements ?? []) {
    const reportOnly = traceOwnership(item) !== 'gated';
    const field = `${item.fixture}.${item.scenario}`;
    choice(
      item.scenario,
      ['pan-100', 'pan-40', 'pan-fit', 'zoom-sweep', 'remount'],
      `${item.fixture}.scenario`,
    );
    samples(item.runs, `${field}.runs`);
    if (item.runs.length !== 3) throw new TypeError(`${field}.runs must contain three runs`);
    samples(item.firstFrameTrialsMs, `${field}.firstFrameTrialsMs`);
    for (const value of item.firstFrameTrialsMs) numeric(value, `${field}.firstFrameTrialsMs`);
    numeric(item.firstFrameP50Ms, `${field}.firstFrameP50Ms`);
    check(
      item,
      item.scenario,
      'firstFrameLoads',
      item.firstFrameTrialsMs.length,
      limits.firstFrameLoads,
      item.firstFrameTrialsMs.length === limits.firstFrameLoads,
      reportOnly,
    );
    const medianFirstFrame = [...item.firstFrameTrialsMs].sort((a, b) => a - b)[
      Math.floor(item.firstFrameTrialsMs.length / 2)
    ];
    if (medianFirstFrame !== item.firstFrameP50Ms)
      throw new TypeError(`${field}.firstFrameP50Ms must equal the median of firstFrameTrialsMs`);
    maximum(
      item,
      item.scenario,
      'firstFrameP50Ms',
      item.firstFrameP50Ms,
      policy.firstFrameP50Ms,
      reportOnly,
    );
    const main: number[] = [];
    const raf: number[] = [];
    for (const run of item.runs) {
      object(run, `${field}.runs`);
      numeric(run.run, `${field}.run`);
      const scenario = `${item.scenario} run ${run.run}`;
      if (results.browser.name === 'chromium' || run.rendererMainP95Ms !== undefined) {
        numeric(run.rendererMainP95Ms, `${field}.rendererMainP95Ms`);
        main.push(run.rendererMainP95Ms);
      }
      numeric(run.rafIntervalP95Ms, `${field}.rafIntervalP95Ms`);
      raf.push(run.rafIntervalP95Ms);
      maximum(
        item,
        scenario,
        'longTasksOver50Ms',
        run.longTasksOver50Ms,
        limits.longTasksOver50Ms,
        reportOnly,
      );
      hitTest(item, scenario, run.hitTestProbe, reportOnly);
      maximum(item, scenario, 'hitTestP95Ms', run.hitTestP95Ms, limits.hitTestP95Ms, reportOnly);
      check(
        item,
        scenario,
        'hitTestP95Ms',
        run.hitTestP95Ms,
        '> 0',
        run.hitTestP95Ms > 0,
        reportOnly,
      );
      const dom = domBudgetPolicy(item);
      maximum(
        item,
        scenario,
        'domNodes',
        run.domNodes,
        limits.domNodes,
        dom.regressionLimit === null,
      );
      if (item.renderer === 'react') {
        object(run.react, `${field}.react`);
        maximum(
          item,
          scenario,
          'pureCameraCommits',
          run.react.pureCameraCommits,
          limits.pureCameraCommits,
          reportOnly,
        );
        numeric(run.react.pureCameraFrames, `${field}.react.pureCameraFrames`);
        if (item.scenario !== 'remount')
          check(
            item,
            scenario,
            'pureCameraFrames',
            run.react.pureCameraFrames,
            '> 0',
            run.react.pureCameraFrames > 0,
            reportOnly,
          );
      }
      if (results.browser.name === 'webkit' && item.scenario === 'pan-40') {
        if (run.worstFrameMs === undefined)
          throw new TypeError(`${field}.worstFrameMs is required for WebKit pan-40`);
        maximum(
          item,
          scenario,
          'worstFrameMs',
          run.worstFrameMs,
          limits.webkit.pan40WorstFrameMs,
          reportOnly,
        );
      }
    }
    const rafMedian = raf.sort((a, b) => a - b)[1];
    if (results.browser.name === 'chromium') {
      const mainMedian = main.sort((a, b) => a - b)[1];
      const mainLimit =
        item.scenario === 'remount'
          ? limits.remountRendererMainP95Ms
          : limits.rendererMainP95Ms[item.world === 'svg' ? 'svg' : item.renderer][item.count];
      maximum(
        item,
        item.scenario,
        'rendererMainP95Ms',
        mainMedian,
        mainLimit,
        reportOnly || (item.scenario === 'remount' && policy.remountRendererMainP95Ms === null),
      );
      maximum(
        item,
        item.scenario,
        'rafIntervalP95Ms',
        rafMedian,
        limits.rafIntervalP95Ms,
        reportOnly || policy.rafIntervalP95Ms === null,
      );
    } else if (results.browser.name === 'webkit') {
      maximum(
        item,
        item.scenario,
        'rafIntervalP95Ms',
        rafMedian,
        limits.webkit.rafIntervalP95Ms,
        reportOnly || policy.rafIntervalP95Ms === null,
      );
    } else if (item.scenario === 'pan-100' || item.scenario === 'pan-fit') {
      maximum(
        item,
        item.scenario,
        'frameP95Ms',
        rafMedian,
        item.scenario === 'pan-100'
          ? limits.firefox.pan100FrameP95Ms
          : limits.firefox.panFitFrameP95Ms[item.count],
        reportOnly,
      );
    }
  }
  for (const item of results.hitTests ?? []) hitTest(item, 'hit-test', item.hitTestProbe);
  for (const item of results.chrome ?? []) {
    const field = `${item.fixture}.chrome`;
    layoutEvidence(item.layoutShifts, `${field}.layoutShifts`);
    snapshot(item.before, `${field}.before`);
    snapshot(item.after, `${field}.after`);
    if (!Array.isArray(item.snapshots)) throw new TypeError(`${field}.snapshots must be an array`);
    const cls = aggregateLayoutShifts(item.layoutShifts, { inputPhase: () => false });
    maximum(item, 'chrome-toggle', 'admittedCls', cls.admittedCls, limits.admittedCls);
    check(
      item,
      'chrome-toggle',
      'toggles',
      item.snapshots.length,
      limits.chromeToggles,
      item.snapshots.length === limits.chromeToggles,
    );
    const phases = item.layoutShifts.phases;
    check(
      item,
      'chrome-toggle',
      'phases',
      JSON.stringify(phases.map((phase) => phase.phase)),
      'chrome-toggle 0 through 15',
      phases.length === limits.chromeToggles &&
        phases.every((phase, index) => phase.phase === `chrome-toggle ${index}`),
    );
    for (const [index, current] of [...item.snapshots, item.after].entries()) {
      snapshot(current, `${field}.snapshots[${index}]`);
      for (const group of ['camera', 'stage'] as const) {
        const unchanged = Object.entries(item.before[group]).every(
          ([key, value]) => current[group][key as keyof (typeof current)[typeof group]] === value,
        );
        check(
          item,
          `chrome-toggle ${index}`,
          `${group} unchanged`,
          JSON.stringify(current[group]),
          JSON.stringify(item.before[group]),
          unchanged,
        );
      }
    }
  }
  for (const item of results.lod ?? []) {
    choice(item.band, ['full-compact', 'compact-overview'], `${item.fixture}.lod.band`);
    const scenario = `lod ${item.band}`;
    numeric(item.switches, `${item.fixture}.${scenario}.switches`);
    if (!Array.isArray(item.levels))
      throw new TypeError(`${item.fixture}.${scenario}.levels must be an array`);
    for (const level of item.levels)
      choice(level, ['dom', 'compact', 'overview'], `${item.fixture}.${scenario}.levels`);
    const [lower, upper] =
      item.band === 'full-compact' ? ['compact', 'dom'] : ['overview', 'compact'];
    check(
      item,
      scenario,
      'switches',
      item.switches,
      limits.lodSwitches,
      item.switches === limits.lodSwitches,
    );
    check(
      item,
      scenario,
      'alternating levels',
      JSON.stringify(item.levels),
      `${lower}/${upper} x ${limits.lodSwitches}`,
      item.levels.length === limits.lodSwitches &&
        item.levels.every((level, index) => level === (index % 2 === 0 ? lower : upper)),
    );
    maximum(item, scenario, 'blankFrames', item.blank, limits.blankFrames);
    maximum(item, scenario, 'doubleLayerFrames', item.both, limits.doubleLayerFrames);
  }
  for (const item of results.pins ?? []) {
    choice(item.pinCount, [50, 500], `${item.fixture}.pinCount`);
    const scenario = `pins-${item.pinCount}`;
    maximum(item, scenario, 'droppedPins', item.droppedPins, limits.droppedPins);
    maximum(item, scenario, 'domNodes', item.domNodes, limits.domNodes, item.pinCount === 500);
  }
  return {
    tier,
    budgetSet: results.budgetSet,
    browser: results.browser,
    failures,
    reported,
    pending,
    passed: failures.length === 0,
  };
}
