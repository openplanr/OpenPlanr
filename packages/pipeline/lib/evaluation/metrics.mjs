import { PipelineError } from '../pipeline/errors.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';

export const EVALUATION_BASIS_POINTS = 10_000;

/** Token estimate divisor. Deterministic stand-in for a tokenizer the runner must not depend on. */
export const EVALUATION_BYTES_PER_TOKEN = 4;

/** Cost model, not a gate. The gate threshold lives in the gate policy. */
export const EVALUATION_COST_MICROS_PER_1K_TOKENS = 3_000;

export const EVALUATION_FRICTION_CLASSES = Object.freeze([
  'permission-prompt',
  'retry',
  'clarification',
  'typed-unavailable',
]);

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const IDENTIFIER = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

function fail(code, message, fix = '', details = undefined) {
  throw new PipelineError(code, message, fix, details);
}

function wholeNumber(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(
      'E_EVALUATION_METRIC_INVALID',
      `${label} must be a non-negative integer.`,
      'Measurements are whole units; a float or a negative count is refused.',
      { actual: value ?? null },
    );
  }
  return value;
}

/**
 * Integer basis points of part over whole, truncated toward zero.
 * Truncation is deliberate: a `>=` gate must never round a miss up into a pass.
 */
export function basisPoints(part, whole) {
  wholeNumber(part, 'metric numerator');
  wholeNumber(whole, 'metric denominator');
  if (part > whole) {
    fail(
      'E_EVALUATION_METRIC_INVALID',
      'A metric numerator exceeds its population.',
      'A subset counter never exceeds the population it is measured against.',
      { part, whole },
    );
  }
  if (whole === 0) return EVALUATION_BASIS_POINTS;
  return Math.floor((part * EVALUATION_BASIS_POINTS) / whole);
}

/**
 * Regression of an observed measurement against a frozen baseline, in basis points.
 * Rounded away from zero on the regression side so a `<=` gate never rounds a
 * regression down into a pass. Improvements are reported as negative basis points.
 */
export function regressionBasisPoints(observed, baseline) {
  wholeNumber(observed, 'observed measurement');
  wholeNumber(baseline, 'frozen baseline');
  if (baseline === 0) return observed === 0 ? 0 : EVALUATION_BASIS_POINTS * 100;
  const delta = observed - baseline;
  const scaled = (delta * EVALUATION_BASIS_POINTS) / baseline;
  return delta >= 0 ? Math.ceil(scaled) : Math.floor(scaled);
}

/** Nearest-rank percentile over a copy of the sample, so callers keep their ordering. */
export function percentileMs(samples, percentile) {
  if (!Array.isArray(samples))
    fail(
      'E_EVALUATION_METRIC_INVALID',
      'Latency samples must be an array.',
      'Pass one integer millisecond sample per observation.',
    );
  if (!Number.isSafeInteger(percentile) || percentile < 1 || percentile > 100) {
    fail(
      'E_EVALUATION_METRIC_INVALID',
      'A percentile must be a whole number between 1 and 100.',
      'Use 50 or 95.',
      { percentile },
    );
  }
  if (samples.length === 0) return 0;
  const sorted = [...samples];
  sorted.forEach((sample, index) => wholeNumber(sample, `latency sample ${index}`));
  sorted.sort((left, right) => left - right);
  const rank = Math.ceil((percentile / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

export function estimateTokens(text) {
  if (typeof text !== 'string')
    fail(
      'E_EVALUATION_METRIC_INVALID',
      'A token estimate needs decoded text.',
      'Pass the prompt or output text.',
    );
  return Math.ceil(Buffer.byteLength(text, 'utf8') / EVALUATION_BYTES_PER_TOKEN);
}

export function estimateCostMicros(totalTokens) {
  wholeNumber(totalTokens, 'total tokens');
  return Math.ceil((totalTokens * EVALUATION_COST_MICROS_PER_1K_TOKENS) / 1_000);
}

/**
 * Trigger confusion counts over the positive and negative corpora together.
 * A scenario that must not invoke and does is a false positive; a scenario that
 * must invoke and does not is a false negative.
 */
export function deriveTriggerCounts(decisions) {
  if (!Array.isArray(decisions))
    fail(
      'E_EVALUATION_METRIC_INVALID',
      'Trigger decisions must be an array.',
      'Pass one decision per scenario.',
    );
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let trueNegatives = 0;
  decisions.forEach((decision, index) => {
    const cursor = `trigger decision ${index}`;
    if (!decision || typeof decision !== 'object' || Array.isArray(decision))
      fail(
        'E_EVALUATION_METRIC_INVALID',
        `${cursor} must be an object.`,
        'Pass { expected, observed } per scenario.',
      );
    const keys = Object.keys(decision).sort();
    if (keys.length !== 2 || keys[0] !== 'expected' || keys[1] !== 'observed') {
      fail(
        'E_EVALUATION_METRIC_INVALID',
        `${cursor} must carry exactly expected and observed.`,
        'Trigger decisions are closed; remove unknown fields.',
      );
    }
    const expectedInvoke = decision.expected === 'invoke';
    const observedInvoke = decision.observed === 'invoke';
    if (expectedInvoke && observedInvoke) truePositives += 1;
    else if (!expectedInvoke && observedInvoke) falsePositives += 1;
    else if (expectedInvoke && !observedInvoke) falseNegatives += 1;
    else trueNegatives += 1;
  });
  return Object.freeze({ truePositives, falsePositives, falseNegatives, trueNegatives });
}

/**
 * Precision and recall in basis points.
 * With no invocation at all, precision is vacuous, but recall still fails the
 * moment the positive corpus was missed, so a silent skill never certifies.
 */
export function triggerRates(counts) {
  const { truePositives, falsePositives, falseNegatives } = counts;
  wholeNumber(truePositives, 'truePositives');
  wholeNumber(falsePositives, 'falsePositives');
  wholeNumber(falseNegatives, 'falseNegatives');
  return Object.freeze({
    triggerPrecision: basisPoints(truePositives, truePositives + falsePositives),
    triggerRecall: basisPoints(truePositives, truePositives + falseNegatives),
  });
}

/** Sums the per-scenario measurement samples into the run-level measurement block. */
export function aggregateMeasurements(samples) {
  if (!Array.isArray(samples))
    fail(
      'E_EVALUATION_METRIC_INVALID',
      'Measurement samples must be an array.',
      'Pass one sample per scenario.',
    );
  const latencies = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let permissionPrompts = 0;
  let retries = 0;
  for (const [index, sample] of samples.entries()) {
    const cursor = `measurement sample ${index}`;
    if (!sample || typeof sample !== 'object' || Array.isArray(sample))
      fail(
        'E_EVALUATION_METRIC_INVALID',
        `${cursor} must be an object.`,
        'Pass the per-scenario measurement record.',
      );
    latencies.push(wholeNumber(sample.latencyMs, `${cursor}.latencyMs`));
    inputTokens += wholeNumber(sample.inputTokens, `${cursor}.inputTokens`);
    outputTokens += wholeNumber(sample.outputTokens, `${cursor}.outputTokens`);
    permissionPrompts += wholeNumber(sample.permissionPrompts, `${cursor}.permissionPrompts`);
    retries += wholeNumber(sample.retries, `${cursor}.retries`);
  }
  const totalTokens = inputTokens + outputTokens;
  return Object.freeze({
    latencyMsP50: percentileMs(latencies, 50),
    latencyMsP95: percentileMs(latencies, 95),
    inputTokens,
    outputTokens,
    totalTokens,
    costEstimateCurrency: 'USD',
    costEstimateMicros: estimateCostMicros(totalTokens),
    permissionPrompts,
    retries,
  });
}

/** Friction is everything the operator had to absorb to reach a terminal state. */
export function frictionCount({
  permissionPrompts = 0,
  retries = 0,
  clarifications = 0,
  typedUnavailable = 0,
} = {}) {
  return (
    wholeNumber(permissionPrompts, 'permissionPrompts') +
    wholeNumber(retries, 'retries') +
    wholeNumber(clarifications, 'clarifications') +
    wholeNumber(typedUnavailable, 'typedUnavailable')
  );
}

/**
 * The frozen measurement envelope the regression gates are read against.
 * It carries no verdict and no threshold, so a baseline can never widen a gate.
 */
export function assertEvaluationBaseline(value, label = 'baseline') {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(
      'E_EVALUATION_BASELINE_INVALID',
      `${label} must be one plain JSON object.`,
      'Pass the parsed baseline record itself.',
    );
  }
  const expected = [
    'kind',
    'schemaVersion',
    'frozen',
    'scope',
    'capturedAt',
    'latencyMsP50',
    'latencyMsP95',
    'costEstimateCurrency',
    'costEstimateMicros',
  ].sort();
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      'E_EVALUATION_BASELINE_INVALID',
      `${label} has missing or unknown fields.`,
      `Declare exactly: ${expected.join(', ')}.`,
      {
        missing: expected.filter((key) => !actual.includes(key)),
        unknown: actual.filter((key) => !expected.includes(key)),
      },
    );
  }
  if (value.kind !== 'evaluation-baseline' || value.schemaVersion !== '1.0.0') {
    fail(
      'E_EVALUATION_BASELINE_INVALID',
      `${label} carries an implicit or foreign baseline version.`,
      'Declare kind "evaluation-baseline" and schemaVersion "1.0.0" explicitly.',
    );
  }
  if (value.frozen !== true)
    fail(
      'E_EVALUATION_BASELINE_INVALID',
      `${label}.frozen must be true.`,
      'A regression is only meaningful against a frozen baseline.',
    );
  if (typeof value.scope !== 'string' || !IDENTIFIER.test(value.scope)) {
    fail(
      'E_EVALUATION_BASELINE_INVALID',
      `${label}.scope must name the corpus by its closed identifier.`,
      'Use the same scope identifier the budget declares.',
    );
  }
  if (
    typeof value.capturedAt !== 'string' ||
    new Date(value.capturedAt).toISOString() !== value.capturedAt
  ) {
    fail(
      'E_EVALUATION_BASELINE_INVALID',
      `${label}.capturedAt must be one canonical RFC 3339 UTC timestamp.`,
      'Use the exact form 2026-01-01T00:00:00.000Z.',
    );
  }
  wholeNumber(value.latencyMsP50, `${label}.latencyMsP50`);
  wholeNumber(value.latencyMsP95, `${label}.latencyMsP95`);
  wholeNumber(value.costEstimateMicros, `${label}.costEstimateMicros`);
  if (value.costEstimateCurrency !== 'USD')
    fail(
      'E_EVALUATION_BASELINE_INVALID',
      `${label}.costEstimateCurrency must be USD.`,
      'Cost is recorded in one currency.',
    );
  if (value.latencyMsP95 < value.latencyMsP50)
    fail(
      'E_EVALUATION_BASELINE_INVALID',
      `${label}.latencyMsP95 is below the p50 baseline.`,
      'Capture both percentiles from the same frozen sample.',
    );
  return value;
}

/** The digest a budget and a gate policy bind their frozen baseline by. */
export function evaluationBaselineDigest(baseline) {
  return sha256Jcs(assertEvaluationBaseline(baseline));
}

export function assertBaselineDigest(baseline, declaredDigest, label = 'baseline') {
  if (typeof declaredDigest !== 'string' || !DIGEST.test(declaredDigest)) {
    fail(
      'E_EVALUATION_BASELINE_INVALID',
      `${label} digest must be an exact sha256 digest.`,
      'Bind the baseline by digest, never by name.',
    );
  }
  const actual = evaluationBaselineDigest(baseline);
  if (actual !== declaredDigest) {
    fail(
      'E_EVALUATION_DIGEST_MISMATCH',
      `${label} no longer matches the digest the policy binds.`,
      'Recapture the frozen baseline and reseal the budget and gate policy against it.',
      { expected: declaredDigest, actual },
    );
  }
  return baseline;
}
