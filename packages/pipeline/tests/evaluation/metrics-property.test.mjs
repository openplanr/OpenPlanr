import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EVALUATION_BASIS_POINTS,
  aggregateMeasurements,
  assertEvaluationBaseline,
  basisPoints,
  deriveTriggerCounts,
  estimateCostMicros,
  estimateTokens,
  evaluationBaselineDigest,
  frictionCount,
  percentileMs,
  regressionBasisPoints,
  triggerRates,
} from '../../lib/evaluation/metrics.mjs';

/** Deterministic pseudo-random source, so a failing property reproduces exactly. */
function sequence(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

test('basis points never round a miss up into a pass', () => {
  const next = sequence(7);
  for (let iteration = 0; iteration < 2_000; iteration += 1) {
    const whole = 1 + Math.floor(next() * 500);
    const part = Math.floor(next() * (whole + 1));
    const rate = basisPoints(part, whole);
    assert.ok(Number.isSafeInteger(rate));
    assert.ok(rate >= 0 && rate <= EVALUATION_BASIS_POINTS);
    assert.ok(rate <= (part * EVALUATION_BASIS_POINTS) / whole);
    assert.equal(rate === EVALUATION_BASIS_POINTS, part === whole);
  }
});

test('an empty population is vacuously total and a numerator over its population is refused', () => {
  assert.equal(basisPoints(0, 0), EVALUATION_BASIS_POINTS);
  assert.throws(() => basisPoints(3, 2), { code: 'E_EVALUATION_METRIC_INVALID' });
  assert.throws(() => basisPoints(1.5, 2), { code: 'E_EVALUATION_METRIC_INVALID' });
  assert.throws(() => basisPoints(-1, 2), { code: 'E_EVALUATION_METRIC_INVALID' });
});

test('the exact certification boundaries land where the thresholds state', () => {
  assert.equal(basisPoints(19, 20), 9_500);
  assert.equal(basisPoints(189, 200), 9_450);
  assert.equal(basisPoints(9, 10), 9_000);
  assert.equal(basisPoints(89, 100), 8_900);
  assert.equal(basisPoints(100, 100), 10_000);
  assert.equal(basisPoints(99, 100), 9_900);
});

test('a regression never rounds down into a pass and an improvement reports negative', () => {
  assert.equal(regressionBasisPoints(120, 100), 2_000);
  assert.equal(regressionBasisPoints(121, 100), 2_100);
  assert.equal(regressionBasisPoints(1_201, 1_000), 2_010);
  assert.equal(regressionBasisPoints(100, 100), 0);
  assert.equal(regressionBasisPoints(50, 100), -5_000);
  assert.equal(regressionBasisPoints(0, 0), 0);
  assert.ok(regressionBasisPoints(1, 0) > 2_000);
  const next = sequence(11);
  for (let iteration = 0; iteration < 2_000; iteration += 1) {
    const baseline = 1 + Math.floor(next() * 5_000);
    const observed = Math.floor(next() * 10_000);
    const regression = regressionBasisPoints(observed, baseline);
    if (observed >= baseline) assert.ok(regression >= ((observed - baseline) * EVALUATION_BASIS_POINTS) / baseline);
    else assert.ok(regression < 0);
  }
});

test('percentiles use nearest rank and leave the caller sample untouched', () => {
  const samples = [50, 10, 30, 20, 40];
  assert.equal(percentileMs(samples, 50), 30);
  assert.equal(percentileMs(samples, 95), 50);
  assert.equal(percentileMs(samples, 100), 50);
  assert.deepEqual(samples, [50, 10, 30, 20, 40]);
  assert.equal(percentileMs([], 95), 0);
  assert.throws(() => percentileMs([1], 0), { code: 'E_EVALUATION_METRIC_INVALID' });
});

test('precision and recall come from the positive and negative corpora together', () => {
  const decisions = [
    { expected: 'invoke', observed: 'invoke' },
    { expected: 'invoke', observed: 'clarify' },
    { expected: 'decline', observed: 'invoke' },
    { expected: 'decline', observed: 'decline' },
    { expected: 'refuse', observed: 'refuse' },
  ];
  const counts = deriveTriggerCounts(decisions);
  assert.deepEqual({ ...counts }, { truePositives: 1, falsePositives: 1, falseNegatives: 1, trueNegatives: 2 });
  const rates = triggerRates(counts);
  assert.equal(rates.triggerPrecision, 5_000);
  assert.equal(rates.triggerRecall, 5_000);
});

test('a scenario that must not trigger and does is a precision failure', () => {
  const rates = triggerRates(deriveTriggerCounts([
    ...Array.from({ length: 19 }, () => ({ expected: 'invoke', observed: 'invoke' })),
    { expected: 'decline', observed: 'invoke' },
  ]));
  assert.equal(rates.triggerPrecision, 9_500);
  assert.equal(rates.triggerRecall, 10_000);
});

test('a silent skill fails recall even though it never fires falsely', () => {
  const rates = triggerRates(deriveTriggerCounts([{ expected: 'invoke', observed: 'decline' }]));
  assert.equal(rates.triggerPrecision, EVALUATION_BASIS_POINTS);
  assert.equal(rates.triggerRecall, 0);
});

test('a trigger decision with unknown fields is refused', () => {
  assert.throws(() => deriveTriggerCounts([{ expected: 'invoke', observed: 'invoke', certified: true }]), { code: 'E_EVALUATION_METRIC_INVALID' });
});

test('aggregation is order independent and sums every friction', () => {
  const samples = [
    { latencyMs: 30, inputTokens: 5, outputTokens: 7, permissionPrompts: 1, retries: 0 },
    { latencyMs: 10, inputTokens: 2, outputTokens: 1, permissionPrompts: 0, retries: 2 },
    { latencyMs: 20, inputTokens: 3, outputTokens: 4, permissionPrompts: 2, retries: 1 },
  ];
  const forward = aggregateMeasurements(samples);
  const reversed = aggregateMeasurements([...samples].reverse());
  assert.deepEqual({ ...forward }, { ...reversed });
  assert.equal(forward.totalTokens, forward.inputTokens + forward.outputTokens);
  assert.equal(forward.permissionPrompts, 3);
  assert.equal(forward.retries, 3);
  assert.ok(forward.latencyMsP95 >= forward.latencyMsP50);
  assert.equal(forward.costEstimateMicros, estimateCostMicros(forward.totalTokens));
  assert.equal(frictionCount({ permissionPrompts: 3, retries: 3, clarifications: 1, typedUnavailable: 2 }), 9);
});

test('token and cost estimates are a pure function of the bytes measured', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
  assert.equal(estimateCostMicros(1_000), 3_000);
  assert.equal(estimateCostMicros(0), 0);
});

test('a frozen baseline is closed and digest bound', () => {
  const baseline = {
    kind: 'evaluation-baseline',
    schemaVersion: '1.0.0',
    frozen: true,
    scope: 'planr.professional.skills',
    capturedAt: '2026-08-25T00:00:00.000Z',
    latencyMsP50: 1_000,
    latencyMsP95: 1_500,
    costEstimateCurrency: 'USD',
    costEstimateMicros: 21_141,
  };
  assert.equal(assertEvaluationBaseline(baseline), baseline);
  assert.match(evaluationBaselineDigest(baseline), /^sha256:[a-f0-9]{64}$/u);
  assert.throws(() => assertEvaluationBaseline({ ...baseline, verdict: 'release-ready' }), { code: 'E_EVALUATION_BASELINE_INVALID' });
  assert.throws(() => assertEvaluationBaseline({ ...baseline, capturedAt: '2026-08-25' }), { code: 'E_EVALUATION_BASELINE_INVALID' });
});
