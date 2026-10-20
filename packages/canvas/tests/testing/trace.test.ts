import { describe, expect, it } from 'vitest';
import {
  aggregateLayoutShifts,
  classifyLayoutShift,
  percentile95,
  rendererFrameWork,
} from '../../src/testing/index.mjs';
import expected from '../fixtures/dashboard-trace-expected.json';
import sample from '../fixtures/dashboard-trace-sample.json';

const policy = {
  inputPhase: (phase: string) =>
    /^(filter-input|palette)(?:\s|$)/u.test(phase) || phase === 'graph-lens whole project',
};
const evidence = expected.layoutShiftEvidence;

describe('trace port parity', () => {
  it('preserves recorded renderer work and p95 numbers byte for byte', () => {
    const work = rendererFrameWork(sample, {
      frame: 'dashboard-frame',
      start: 'dashboard-interaction-start',
      end: 'dashboard-interaction-end',
    });
    expect(JSON.stringify(work)).toBe(JSON.stringify(expected.frameWorkMs));
    expect(percentile95(work)).toBe(expected.frameWorkP95Ms);
    const renamed = sample.map((event) => ({
      ...event,
      name: event.name.replace(
        /^dashboard-(frame|interaction-start|interaction-end)$/u,
        'canvas-$1',
      ),
    }));
    expect(JSON.stringify(rendererFrameWork(renamed))).toBe(JSON.stringify(work));
  });

  it('preserves classifications and all aggregate numbers and sources', () => {
    expect(
      JSON.stringify(evidence.shifts.map((shift) => classifyLayoutShift(shift, evidence, policy))),
    ).toBe(JSON.stringify(expected.classifications));
    const { admittedCls, excludedCls, nativeExcludedCls, inputDrivenCls, shifts } =
      aggregateLayoutShifts(evidence, policy);
    expect(
      JSON.stringify({ admittedCls, excludedCls, nativeExcludedCls, inputDrivenCls, shifts }),
    ).toBe(JSON.stringify(expected.aggregate));
    expect(aggregateLayoutShifts(evidence, { inputPhase: () => false }).excludedCls).toBe(0);
  });

  it.each([
    [499.999, true],
    [500, true],
    [500.001, false],
  ] as const)('classifies the %s ms input boundary', (elapsed, inputDriven) => {
    const shift = {
      value: 0.01,
      startTime: 150 + elapsed,
      hadRecentInput: false,
      phase: 'filter-input 1',
      sources: [],
    };
    expect(classifyLayoutShift(shift, evidence, policy).inputDriven).toBe(inputDriven);
  });

  it('honors a custom input window and rejects invalid shift samples', () => {
    const shift = {
      value: 0.1,
      startTime: 350,
      hadRecentInput: false,
      phase: 'filter-input 1',
      sources: [],
    };
    expect(
      classifyLayoutShift(shift, evidence, { ...policy, inputWindowMs: 199 }).inputDriven,
    ).toBe(false);
    for (const invalid of [
      { value: NaN },
      { value: -1 },
      { startTime: Infinity },
      { startTime: -1 },
    ])
      expect(() =>
        aggregateLayoutShifts({ ...evidence, shifts: [{ ...shift, ...invalid }] }, policy),
      ).toThrow(TypeError);
  });
});
