import { expect, it } from 'vitest';
import type {
  DashboardLayoutShift,
  DashboardLayoutShiftReport,
} from './fixtures/dashboard-layout-shifts.js';
import {
  aggregateDashboardLayoutShifts,
  classifyDashboardLayoutShift,
  type DashboardTraceMeasurements,
  evaluateDashboardTrace,
  TRACE_PLAN,
} from './fixtures/dashboard-trace-model.js';

const shift = (
  startTime: number,
  phase = 'filter-input 1',
  hadRecentInput = false,
): DashboardLayoutShift => ({
  value: 0.125,
  startTime,
  phase,
  hadRecentInput,
  sources: [],
});

function evidence(
  shifts: readonly DashboardLayoutShift[],
  phase = 'filter-input 1',
): DashboardLayoutShiftReport {
  return {
    phases: [{ phase, startTime: 0 }],
    inputActions: [{ phase, phaseIndex: 0, startTime: 100 }],
    shifts,
  };
}

function measurements(): DashboardTraceMeasurements {
  const selection = { id: 'task', focusedId: 'task', scrollTop: 30, anchorTop: 100 };
  const interaction = {
    durationMs: TRACE_PLAN.durationMs,
    frameWorkMs: [10],
    frameIntervalsMs: [16],
    longTasksMs: [],
    cls: 0,
    interactionObserved: true,
  };
  return {
    coldShellMs: 500,
    usefulSnapshotMs: 1000,
    warmRoutesMs: [100],
    panelsMs: [100],
    filterMs: Array(TRACE_PLAN.inputCount).fill(100),
    paletteMs: Array(TRACE_PLAN.inputCount).fill(100),
    palettePreviewMs: Array(TRACE_PLAN.inputCount).fill(100),
    patchesMs: Array(TRACE_PLAN.patchCount).fill(100),
    graph: interaction,
    list: interaction,
    cls: 0,
    selectionBefore: selection,
    selectionAfter: Array(TRACE_PLAN.patchCount).fill(selection),
    nodeCount: 708,
    edgeCount: 477,
    browserErrors: [],
  };
}

it.each([
  [-0.001, false],
  [0, true],
  [499.999, true],
  [500, true],
  [500.001, false],
  [1000, false],
] as const)('classifies an input action age of %s ms at entry start time', (age, inputDriven) => {
  const sample = shift(100 + age);
  expect(classifyDashboardLayoutShift(sample, evidence([sample]))).toEqual({
    inputDriven,
    reason: inputDriven ? 'input-driven' : 'counted',
  });
});

it('requires the same phase name and occurrence, including when a label is reused', () => {
  const sample = shift(200);
  const report = evidence([sample]);
  expect(classifyDashboardLayoutShift(sample, { ...report, inputActions: [] }).reason).toBe(
    'counted',
  );
  expect(
    classifyDashboardLayoutShift(sample, {
      ...report,
      inputActions: [{ phase: 'filter-input 2', phaseIndex: 0, startTime: 100 }],
    }).reason,
  ).toBe('counted');
  expect(
    classifyDashboardLayoutShift(sample, {
      ...report,
      phases: [
        { phase: sample.phase, startTime: 0 },
        { phase: sample.phase, startTime: 150 },
      ],
    }).reason,
  ).toBe('counted');
  expect(
    classifyDashboardLayoutShift(sample, {
      ...report,
      phases: [{ phase: 'palette query 1', startTime: 0 }],
    }).reason,
  ).toBe('counted');
});

it.each([
  'route-load #/list',
  'route-load #/graph',
  'patch 1',
  'inspector 1',
  'pan-scroll list',
  'pan-scroll graph',
  'filter-inputs',
  'graph-lens',
  'graph-lens dependencies',
  'graph-lens whole project extra',
])(
  'never excludes %s shifts, even with native recent-input evidence and a marked action',
  (phase) => {
    for (const hadRecentInput of [false, true]) {
      const sample = shift(100, phase, hadRecentInput);
      expect(classifyDashboardLayoutShift(sample, evidence([sample], phase))).toEqual({
        inputDriven: false,
        reason: 'counted',
      });
      expect(aggregateDashboardLayoutShifts(evidence([sample], phase)).admittedCls).toBe(0.125);
    }
  },
);

it.each([
  'filter-input clear type',
  'palette open',
  'palette query 1',
  'palette close',
  'graph-lens whole project',
])(
  'annotates native and harness exclusions separately in %s without dropping raw fields',
  (phase) => {
    const report = evidence(
      [shift(101, phase, true), shift(102, phase), shift(601, phase, true)],
      phase,
    );
    const result = aggregateDashboardLayoutShifts(report);
    expect(result).toMatchObject({
      admittedCls: 0.125,
      nativeExcludedCls: 0.125,
      inputDrivenCls: 0.125,
      excludedCls: 0.25,
    });
    expect(result.shifts.map(({ inputDriven, reason }) => ({ inputDriven, reason }))).toEqual([
      { inputDriven: true, reason: 'native-excluded' },
      { inputDriven: true, reason: 'input-driven' },
      { inputDriven: false, reason: 'counted' },
    ]);
    for (let index = 0; index < report.shifts.length; index += 1)
      expect(result.shifts[index]).toMatchObject(report.shifts[index]);
  },
);

it('requires a matching recent action for the explicit whole-project lens change', () => {
  const phase = 'graph-lens whole project';
  const sample = shift(200, phase, true);
  const marked = evidence([sample], phase);
  for (const inputActions of [
    [],
    [{ phase: 'palette open', phaseIndex: 0, startTime: 100 }],
    [{ phase, phaseIndex: 1, startTime: 100 }],
    [{ phase, phaseIndex: 0, startTime: -301 }],
  ]) {
    const report = { ...marked, inputActions };
    expect(classifyDashboardLayoutShift(sample, report).reason).toBe('counted');
    expect(aggregateDashboardLayoutShifts(report).admittedCls).toBe(0.125);
  }
  const base = measurements();
  expect(
    evaluateDashboardTrace('representative', {
      ...base,
      layoutShiftEvidence: marked,
    }),
  ).toMatchObject({ passed: true, cls: 0 });
  expect(
    evaluateDashboardTrace('representative', {
      ...base,
      layoutShiftEvidence: { ...marked, inputActions: [] },
    }),
  ).toMatchObject({ passed: false, cls: 0.125, failures: ['Unexpected layout shift occurred.'] });
  const routePhase = 'route-load #/graph';
  expect(
    evaluateDashboardTrace('representative', {
      ...base,
      layoutShiftEvidence: evidence([shift(200, routePhase, true)], routePhase),
    }),
  ).toMatchObject({ passed: false, cls: 0.125, failures: ['Unexpected layout shift occurred.'] });
});

it('uses normalized evidence in the evaluator and retains the existing CLS gate without evidence', () => {
  const base = measurements();
  const layoutShiftEvidence = evidence([shift(101)]);
  expect(
    evaluateDashboardTrace('representative', { ...base, cls: 0.125, layoutShiftEvidence }),
  ).toMatchObject({
    passed: true,
    cls: 0,
    layoutShifts: { admittedCls: 0, excludedCls: 0.125 },
  });
  expect(evaluateDashboardTrace('representative', { ...base, cls: 0.125 })).toMatchObject({
    passed: false,
    failures: ['Unexpected layout shift occurred.'],
  });
  expect(
    evaluateDashboardTrace('representative', {
      ...base,
      layoutShiftEvidence: evidence([shift(101, 'patch 1', true)], 'patch 1'),
    }),
  ).toMatchObject({ passed: false, cls: 0.125, failures: ['Unexpected layout shift occurred.'] });
});

it.each(['graph', 'list'] as const)(
  'keeps %s interaction CLS strict when all global evidence is input-driven',
  (kind) => {
    const base = measurements();
    expect(
      evaluateDashboardTrace('representative', {
        ...base,
        layoutShiftEvidence: evidence([shift(101)]),
        [kind]: { ...base[kind], cls: 0.125 },
      }),
    ).toMatchObject({ passed: false, failures: ['Unexpected layout shift occurred.'] });
  },
);

it('rejects corrupt raw shifts even when an input marker would otherwise exclude them', () => {
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const sample = { ...shift(101), value };
    expect(() => aggregateDashboardLayoutShifts(evidence([sample]))).toThrow(TypeError);
  }
  expect(() => aggregateDashboardLayoutShifts(evidence([shift(Number.NaN)]))).toThrow(TypeError);
});
