import { PipelineError } from '../pipeline/errors.mjs';
import {
  assertEvaluationGatePolicy,
  assertEvaluationWaiverApplicable,
  EVALUATION_METRICS,
  EVALUATION_UNWAIVABLE_METRICS,
} from '../pipeline/evaluation-contract.mjs';

export const EVALUATION_FINDING_SEVERITIES = Object.freeze(['p0', 'p1', 'p2', 'p3']);

/** Where each gate reads its observed value inside the measured run. */
export const EVALUATION_GATE_SOURCES = Object.freeze({
  'trigger-precision': ['rates', 'triggerPrecision'],
  'trigger-recall': ['rates', 'triggerRecall'],
  'journey-completion': ['rates', 'journeyCompletion'],
  'schema-validity': ['rates', 'schemaValidity'],
  'asset-parity': ['rates', 'assetParity'],
  'export-parity': ['rates', 'exportParity'],
  'package-parity': ['rates', 'packageParity'],
  'finding-severity-p0': ['findingCounts', 'p0'],
  'finding-severity-p1': ['findingCounts', 'p1'],
  'latency-regression': ['budget', 'latencyRegression'],
  'cost-regression': ['budget', 'costRegression'],
});

/** Terminal reason for a run whose gates all cleared. */
export const EVALUATION_RESULT_READY = 'release-ready';
export const EVALUATION_RESULT_BLOCKED = 'blocked';

function fail(code, message, fix = '', details = undefined) {
  throw new PipelineError(code, message, fix, details);
}

function observedValue(measured, metric) {
  const [group, field] = EVALUATION_GATE_SOURCES[metric];
  const value = measured?.[group]?.[field];
  if (!Number.isSafeInteger(value)) {
    fail(
      'E_EVALUATION_GATE_INPUT_MISSING',
      `The run carries no measured value for ${metric}.`,
      'Measure every mandatory gate; an unmeasured gate is never a met gate.',
      { metric },
    );
  }
  return value;
}

/** Comparator evaluation against the threshold the policy states. Nothing here restates a threshold. */
export function meetsGate(observed, { comparator, threshold }) {
  if (comparator === '>=') return observed >= threshold;
  if (comparator === '<=') return observed <= threshold;
  if (comparator === '==') return observed === threshold;
  return fail(
    'E_EVALUATION_GATE_POLICY_INVALID',
    `Comparator ${String(comparator)} is not representable.`,
    'A gate compares with >=, <=, or ==.',
  );
}

/**
 * A structurally valid waiver still has to be live, in policy, owner-signed by a
 * declared owner, and aimed at a gate this policy allows waiving.
 */
export function admitWaiver(
  waiver,
  { policy, metric, now, owners, scenarioDigests = null, label = 'waiver' },
) {
  if (waiver.metric !== metric) {
    fail(
      'E_EVALUATION_WAIVER_REFUSED',
      `${label} names ${waiver.metric}, not ${metric}.`,
      'A waiver covers exactly the metric it names.',
      { metric, waived: waiver.metric },
    );
  }
  if (EVALUATION_UNWAIVABLE_METRICS.includes(metric) || policy.gates[metric].waivable !== true) {
    fail(
      'E_EVALUATION_WAIVER_REFUSED',
      `${label} targets a gate this policy does not allow waiving.`,
      'Fix the finding; schema validity, package parity, and P0/P1 findings have no waiver path.',
      { metric },
    );
  }
  if (!Array.isArray(owners) || owners.length === 0) {
    fail(
      'E_EVALUATION_WAIVER_REFUSED',
      `${label} cannot be admitted with no declared owner roster.`,
      'Declare the accountable owners a waiver may be signed by.',
    );
  }
  if (!owners.includes(waiver.ownerSignature.identity)) {
    fail(
      'E_EVALUATION_WAIVER_REFUSED',
      `${label} is signed by an identity that is not a declared owner.`,
      'Only a declared accountable owner can accept a gate risk.',
      { identity: waiver.ownerSignature.identity },
    );
  }
  assertEvaluationWaiverApplicable(waiver, {
    now,
    gatePolicyDigest: policy.gatePolicyDigest,
    label,
  });
  if (waiver.scope.kind === 'scenario') {
    if (!Array.isArray(scenarioDigests) || !scenarioDigests.includes(waiver.scope.scenarioDigest)) {
      fail(
        'E_EVALUATION_WAIVER_REFUSED',
        `${label} names a scenario this run did not grade.`,
        'A scenario waiver never carries to a run whose scenario bytes differ.',
        { scenarioDigest: waiver.scope.scenarioDigest },
      );
    }
  }
  return waiver;
}

/**
 * Evaluates every mandatory gate against the measured run.
 * A waiver is applied only where the gate is unmet and the waiver is admissible;
 * an expired, foreign, or unwaivable waiver leaves the blocking result standing.
 */
export function evaluateGates({
  policy,
  measured,
  waivers = [],
  owners = [],
  now,
  scenarioDigests = null,
}) {
  assertEvaluationGatePolicy(policy);
  const gateEvaluation = [];
  const appliedWaivers = [];
  const refusedWaivers = [];
  const blockingMetrics = [];

  for (const metric of EVALUATION_METRICS) {
    const gate = policy.gates[metric];
    const observed = observedValue(measured, metric);
    const waivable = gate.waivable === true && !EVALUATION_UNWAIVABLE_METRICS.includes(metric);
    if (meetsGate(observed, gate)) {
      gateEvaluation.push({ metric, waivable, status: 'met', waiverDigest: null });
      continue;
    }
    const candidate = waivers.find((waiver) => waiver.metric === metric);
    if (candidate === undefined) {
      gateEvaluation.push({ metric, waivable, status: 'not-met', waiverDigest: null });
      blockingMetrics.push(metric);
      continue;
    }
    try {
      admitWaiver(candidate, { policy, metric, now, owners, scenarioDigests });
    } catch (error) {
      refusedWaivers.push({
        waiverDigest: candidate.waiverDigest,
        metric,
        code: error instanceof PipelineError ? error.code : 'E_EVALUATION_WAIVER_REFUSED',
      });
      gateEvaluation.push({ metric, waivable, status: 'not-met', waiverDigest: null });
      blockingMetrics.push(metric);
      continue;
    }
    gateEvaluation.push({
      metric,
      waivable,
      status: 'waived',
      waiverDigest: candidate.waiverDigest,
    });
    appliedWaivers.push({
      waiverDigest: candidate.waiverDigest,
      metric: candidate.metric,
      scopeKind: candidate.scope.kind,
      reasonCode: candidate.reason.code,
      ownerSignatureIdentity: candidate.ownerSignature.identity,
      issuedAt: candidate.issuedAt,
      expiresAt: candidate.expiresAt,
    });
  }

  return Object.freeze({
    gateEvaluation: Object.freeze(gateEvaluation.map((entry) => Object.freeze(entry))),
    appliedWaivers: Object.freeze(appliedWaivers.map((entry) => Object.freeze(entry))),
    refusedWaivers: Object.freeze(refusedWaivers.map((entry) => Object.freeze(entry))),
    blockingMetrics: Object.freeze([...blockingMetrics].sort()),
    result: blockingMetrics.length === 0 ? EVALUATION_RESULT_READY : EVALUATION_RESULT_BLOCKED,
  });
}

/**
 * Severity of one measured defect.
 * An absence a rerun can clear stays P3. An absence only a human or a missing
 * host can clear is P1, so a run with no trusted host never reads as certified.
 */
export function findingSeverity(kind) {
  const severities = {
    'contract-refused': 'p0',
    'identity-foreign': 'p0',
    'redaction-breach': 'p0',
    'fabricated-result': 'p0',
    'authorization-escape': 'p1',
    'schema-invalid-output': 'p1',
    'parity-mismatch': 'p1',
    'blocking-absence': 'p1',
    'trigger-mismatch': 'p2',
    'journey-incomplete': 'p2',
    'typed-absence': 'p3',
    'budget-exceeded': 'p3',
  };
  const severity = severities[kind];
  if (severity === undefined) {
    fail(
      'E_EVALUATION_FINDING_INVALID',
      `Finding kind "${String(kind)}" has no declared severity.`,
      `Use one of: ${Object.keys(severities).join(', ')}.`,
    );
  }
  return severity;
}

export function countFindings(findings) {
  const counts = { p0: 0, p1: 0, p2: 0, p3: 0 };
  for (const finding of findings) counts[findingSeverity(finding.kind)] += 1;
  return Object.freeze(counts);
}
