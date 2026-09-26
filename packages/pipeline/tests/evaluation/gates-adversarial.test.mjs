import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  admitWaiver,
  countFindings,
  evaluateGates,
  findingSeverity,
  meetsGate,
} from '../../lib/evaluation/gates.mjs';
import {
  assertEvaluationWaiver,
  EVALUATION_METRICS,
  EVALUATION_UNWAIVABLE_METRICS,
} from '../../lib/pipeline/evaluation-contract.mjs';
import { deriveEvaluationIdentity } from '../../lib/pipeline/evaluation-identity.mjs';

const root = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const contracts = JSON.parse(
  readFileSync(join(root, 'conformance/fixtures/skill-evaluation/contracts-valid.json'), 'utf8'),
);
const policy = contracts['evaluation-gate-policy'];
const reference = contracts['evaluation-waiver'];
const OWNERS = ['openplanr.release.owner'];
const NOW = '2026-08-25T09:16:00.000Z';
const scenarioDigests = [reference.scope.scenarioDigest];

const CLEAN = Object.freeze({
  rates: {
    triggerPrecision: 10_000,
    triggerRecall: 10_000,
    journeyCompletion: 10_000,
    schemaValidity: 10_000,
    assetParity: 10_000,
    exportParity: 10_000,
    packageParity: 10_000,
  },
  findingCounts: { p0: 0, p1: 0, p2: 0, p3: 0 },
  budget: { latencyRegression: 0, costRegression: 0 },
});

function reseal(overrides) {
  const candidate = { ...structuredClone(reference), ...overrides };
  const derived = deriveEvaluationIdentity(candidate, 'evaluation-waiver');
  return { ...candidate, waiverId: derived.id, waiverDigest: derived.digest };
}

function measured(patch) {
  return {
    rates: { ...CLEAN.rates, ...(patch.rates ?? {}) },
    findingCounts: { ...CLEAN.findingCounts, ...(patch.findingCounts ?? {}) },
    budget: { ...CLEAN.budget, ...(patch.budget ?? {}) },
  };
}

test('a clean run certifies and names no blocking gate', () => {
  const outcome = evaluateGates({
    policy,
    measured: CLEAN,
    owners: OWNERS,
    now: NOW,
    scenarioDigests,
  });
  assert.equal(outcome.result, 'release-ready');
  assert.deepEqual([...outcome.blockingMetrics], []);
  assert.equal(outcome.gateEvaluation.length, EVALUATION_METRICS.length);
});

test('every mandatory gate is evaluated exactly once', () => {
  const outcome = evaluateGates({
    policy,
    measured: CLEAN,
    owners: OWNERS,
    now: NOW,
    scenarioDigests,
  });
  const evaluated = outcome.gateEvaluation.map((entry) => entry.metric).sort();
  assert.deepEqual(evaluated, [...EVALUATION_METRICS].sort());
});

test('an unmeasured gate is refused rather than treated as met', () => {
  assert.throws(
    () =>
      evaluateGates({
        policy,
        measured: { ...CLEAN, budget: { latencyRegression: 0 } },
        owners: OWNERS,
        now: NOW,
        scenarioDigests,
      }),
    { code: 'E_EVALUATION_GATE_INPUT_MISSING' },
  );
});

test('comparators read the policy and refuse anything else', () => {
  assert.equal(meetsGate(9_500, policy.gates['trigger-precision']), true);
  assert.equal(meetsGate(9_499, policy.gates['trigger-precision']), false);
  assert.equal(meetsGate(10_000, policy.gates['schema-validity']), true);
  assert.equal(meetsGate(10_001, policy.gates['schema-validity']), false);
  assert.equal(meetsGate(2_000, policy.gates['latency-regression']), true);
  assert.equal(meetsGate(2_001, policy.gates['latency-regression']), false);
  assert.throws(() => meetsGate(1, { comparator: '~=', threshold: 1 }), {
    code: 'E_EVALUATION_GATE_POLICY_INVALID',
  });
});

test('an owner-signed live waiver clears exactly the metric it names', () => {
  const outcome = evaluateGates({
    policy,
    measured: measured({ budget: { latencyRegression: 5_000, costRegression: 0 } }),
    waivers: [assertEvaluationWaiver(reference)],
    owners: OWNERS,
    now: NOW,
    scenarioDigests,
  });
  assert.equal(outcome.result, 'release-ready');
  assert.equal(outcome.appliedWaivers.length, 1);
  assert.equal(
    outcome.gateEvaluation.find((entry) => entry.metric === 'latency-regression').status,
    'waived',
  );
  assert.equal(
    outcome.gateEvaluation.find((entry) => entry.metric === 'cost-regression').status,
    'met',
  );
});

test('a waiver never clears a metric it does not name', () => {
  const outcome = evaluateGates({
    policy,
    measured: measured({ budget: { latencyRegression: 0, costRegression: 5_000 } }),
    waivers: [assertEvaluationWaiver(reference)],
    owners: OWNERS,
    now: NOW,
    scenarioDigests,
  });
  assert.equal(outcome.result, 'blocked');
  assert.deepEqual([...outcome.blockingMetrics], ['cost-regression']);
});

test('an expired waiver restores the blocking result', () => {
  const expired = reseal({
    issuedAt: '2026-05-01T00:00:00.000Z',
    expiresAt: '2026-06-01T00:00:00.000Z',
  });
  const outcome = evaluateGates({
    policy,
    measured: measured({ budget: { latencyRegression: 5_000, costRegression: 0 } }),
    waivers: [expired],
    owners: OWNERS,
    now: NOW,
    scenarioDigests,
  });
  assert.equal(outcome.result, 'blocked');
  assert.deepEqual([...outcome.blockingMetrics], ['latency-regression']);
  assert.equal(outcome.refusedWaivers[0].code, 'E_EVALUATION_WAIVER_REFUSED');
});

test('a waiver signed by a non-owner is refused', () => {
  const foreign = reseal({
    ownerSignature: { ...reference.ownerSignature, identity: 'contributor.without.authority' },
  });
  assert.throws(
    () =>
      admitWaiver(foreign, {
        policy,
        metric: 'latency-regression',
        now: NOW,
        owners: OWNERS,
        scenarioDigests,
      }),
    { code: 'E_EVALUATION_WAIVER_REFUSED' },
  );
});

test('a run with no declared owner roster admits no waiver at all', () => {
  assert.throws(
    () =>
      admitWaiver(reference, {
        policy,
        metric: 'latency-regression',
        now: NOW,
        owners: [],
        scenarioDigests,
      }),
    { code: 'E_EVALUATION_WAIVER_REFUSED' },
  );
});

test('an unwaivable gate has no waiver path even with a live owner signature', () => {
  for (const metric of EVALUATION_UNWAIVABLE_METRICS) {
    assert.throws(
      () =>
        admitWaiver(
          { ...reference, metric },
          { policy, metric, now: NOW, owners: OWNERS, scenarioDigests },
        ),
      { code: 'E_EVALUATION_WAIVER_REFUSED' },
      `${metric} must have no waiver path`,
    );
  }
});

test('schema validity and package parity stay blocking whatever waivers are offered', () => {
  for (const [metric, patch] of [
    ['schema-validity', { schemaValidity: 9_999 }],
    ['package-parity', { packageParity: 9_999 }],
  ]) {
    const outcome = evaluateGates({
      policy,
      measured: measured({ rates: patch }),
      waivers: [reseal({ metric })],
      owners: OWNERS,
      now: NOW,
      scenarioDigests,
    });
    assert.equal(outcome.result, 'blocked');
    assert.ok(outcome.blockingMetrics.includes(metric));
    assert.equal(outcome.appliedWaivers.length, 0);
  }
});

test('a P0 or P1 finding blocks and cannot be waived', () => {
  for (const severity of ['p0', 'p1']) {
    const outcome = evaluateGates({
      policy,
      measured: measured({ findingCounts: { [severity]: 1 } }),
      waivers: [reseal({ metric: `finding-severity-${severity}` })],
      owners: OWNERS,
      now: NOW,
      scenarioDigests,
    });
    assert.equal(outcome.result, 'blocked');
    assert.ok(outcome.blockingMetrics.includes(`finding-severity-${severity}`));
  }
});

test('a waiver issued under a different gate policy is refused', () => {
  const foreign = reseal({ gatePolicyDigest: `sha256:${'1'.repeat(64)}` });
  assert.throws(
    () =>
      admitWaiver(foreign, {
        policy,
        metric: 'latency-regression',
        now: NOW,
        owners: OWNERS,
        scenarioDigests,
      }),
    { code: 'E_EVALUATION_WAIVER_REFUSED' },
  );
});

test('a scenario waiver never carries to a scenario the run did not grade', () => {
  assert.throws(
    () =>
      admitWaiver(reference, {
        policy,
        metric: 'latency-regression',
        now: NOW,
        owners: OWNERS,
        scenarioDigests: [`sha256:${'2'.repeat(64)}`],
      }),
    { code: 'E_EVALUATION_WAIVER_REFUSED' },
  );
});

test('P2 and P3 findings do not block on their own', () => {
  const outcome = evaluateGates({
    policy,
    measured: measured({ findingCounts: { p2: 9, p3: 12 } }),
    owners: OWNERS,
    now: NOW,
    scenarioDigests,
  });
  assert.equal(outcome.result, 'release-ready');
});

test('an absence only a host can clear is P1 while a rerun can clear stays P3', () => {
  assert.equal(findingSeverity('blocking-absence'), 'p1');
  assert.equal(findingSeverity('typed-absence'), 'p3');
  assert.equal(findingSeverity('authorization-escape'), 'p1');
  assert.equal(findingSeverity('fabricated-result'), 'p0');
  assert.throws(() => findingSeverity('unclassified'), { code: 'E_EVALUATION_FINDING_INVALID' });
  assert.deepEqual(
    { ...countFindings([{ kind: 'blocking-absence' }, { kind: 'typed-absence' }]) },
    { p0: 0, p1: 1, p2: 0, p3: 1 },
  );
});
