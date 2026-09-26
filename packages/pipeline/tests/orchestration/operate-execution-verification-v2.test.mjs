import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import {
  OPERATING_EXECUTION_VERIFICATION_STATUSES_V2,
  buildOperatingExecutionLifecycleV2,
  deriveOperatingExecutionVerificationStatusV2,
  deriveOperatingVerificationFeedbackV2,
} from '../../lib/operate/execution-verification-v2.mjs';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
const clone = (value) => structuredClone(value);

function scenario() {
  const action = clone(fixture('authorization-valid.json').action);
  const contracts = fixture('governed-execution-contracts-valid.json');
  const result = clone(contracts['operating-execution-result']);
  const operation = {
    ...clone(contracts['operating-governed-operation']),
    state: result.status,
    resultId: result.resultId,
    updatedAt: result.completedAt,
  };
  delete operation.operationHash;
  operation.operationHash = sha256Jcs(operation);
  const cycle = {
    ...clone(fixture('all-contracts-valid.json')['operating-cycle']),
    cycleId: action.sourceCycleId,
    scopeId: action.scopeId,
    domainId: action.domainId,
    domainVersion: action.domainVersion,
    state: 'approved',
    activeReviewId: null,
  };
  const verificationPlan = {
    kind: 'operating-action-verification-plan',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    verificationPlanId: action.verificationPlanId,
    actionId: action.actionId,
    scopeId: action.scopeId,
    domainId: action.domainId,
    domainVersion: action.domainVersion,
    metricId: action.metricId,
    baseline: action.baseline,
    target: action.target,
    window: action.verificationWindow,
    method: 'Compare one accepted observation with the declared target.',
    observationRequest: { kind: 'future-observation', reason: action.expectedResult },
    evaluationRules: ['succeeded: target reached.'],
    revisitDecisionIds: [action.sourceDecisionId],
    sourceArtifactId: action.sourceArtifactId,
    createdAt: action.createdAt,
  };
  return { action, cycle, operation, result, verificationPlan };
}

test('terminal execution owns one deterministic verification Assignment without claiming hypothesis success', () => {
  const value = scenario();
  const lifecycle = buildOperatingExecutionLifecycleV2(value);
  assert.equal(lifecycle.executionStatus, 'success');
  assert.equal(lifecycle.hypothesisStatus, 'pending');
  assert.equal(lifecycle.transitions.actionQueued.from, 'approved');
  assert.equal(lifecycle.transitions.actionTerminal.to, 'completed');
  assert.equal(lifecycle.verificationAssignment.assignmentKind, 'verification');
  assert.equal(lifecycle.verificationAssignment.governedOperationId, value.operation.operationId);
  assert.equal(lifecycle.verificationAssignment.outputContract.schemaId, 'operating-outcome');
  assert.deepEqual(buildOperatingExecutionLifecycleV2(value), lifecycle);
});

test('direct lifecycle and feedback reject mixed Action, Cycle, and plan scope ownership', () => {
  const value = scenario();
  const foreign = {
    scopeId: 'scope-foreign',
    domainId: value.action.domainId === 'business' ? 'software' : 'business',
    domainVersion: '9.9.9',
  };
  for (const field of ['scopeId', 'domainId', 'domainVersion']) {
    assert.throws(
      () =>
        buildOperatingExecutionLifecycleV2({
          ...value,
          cycle: { ...value.cycle, [field]: foreign[field] },
        }),
      (error) => error?.code === 'OPERATING_SCOPE_INVALID',
    );
    assert.throws(
      () =>
        buildOperatingExecutionLifecycleV2({
          ...value,
          verificationPlan: { ...value.verificationPlan, [field]: foreign[field] },
        }),
      (error) => error?.code === 'OPERATING_SCOPE_INVALID',
    );
    assert.throws(
      () =>
        deriveOperatingVerificationFeedbackV2({
          action: value.action,
          verificationPlan: { ...value.verificationPlan, [field]: foreign[field] },
          executionStatus: 'success',
        }),
      (error) => error?.code === 'OPERATING_SCOPE_INVALID',
    );
    assert.throws(
      () =>
        deriveOperatingVerificationFeedbackV2({
          action: value.action,
          verificationPlan: value.verificationPlan,
          executionStatus: 'success',
          cycle: { ...value.cycle, [field]: foreign[field] },
        }),
      (error) => error?.code === 'OPERATING_SCOPE_INVALID',
    );
  }
});

test('observation-owned Outcome and Learning confirm the hypothesis with exact provenance', () => {
  const value = scenario();
  const records = fixture('action-verification-valid.json');
  const outcome = {
    ...clone(records.outcome),
    actionId: value.action.actionId,
    scopeId: value.action.scopeId,
    domainId: value.action.domainId,
    domainVersion: value.action.domainVersion,
    verificationPlanId: value.verificationPlan.verificationPlanId,
  };
  const learning = {
    ...clone(records.learning),
    outcomeId: outcome.outcomeId,
    scopeId: value.action.scopeId,
    domainId: value.action.domainId,
    domainVersion: value.action.domainVersion,
  };
  const pending = deriveOperatingVerificationFeedbackV2({
    action: value.action,
    verificationPlan: value.verificationPlan,
    executionStatus: 'success',
  });
  const confirmed = deriveOperatingVerificationFeedbackV2({
    action: value.action,
    verificationPlan: value.verificationPlan,
    executionStatus: 'success',
    outcome,
    learning,
  });
  assert.equal(pending.hypothesisStatus, 'pending');
  assert.equal(pending.hypothesisConfirmed, false);
  assert.equal(confirmed.hypothesisStatus, 'confirmed');
  assert.equal(confirmed.provenance.outcomeId, outcome.outcomeId);
  assert.equal(confirmed.provenance.learningId, learning.learningId);
  assert.throws(
    () =>
      deriveOperatingVerificationFeedbackV2({
        action: value.action,
        verificationPlan: value.verificationPlan,
        executionStatus: 'success',
        outcome: { ...outcome, domainId: 'business' },
      }),
    (error) => error?.code === 'OPERATING_SCOPE_INVALID',
  );
  assert.throws(
    () =>
      deriveOperatingVerificationFeedbackV2({
        action: value.action,
        verificationPlan: value.verificationPlan,
        executionStatus: 'success',
        outcome,
        learning: { ...learning, evidenceRefIds: [] },
      }),
    (error) => error?.code === 'STATE_TRANSITION_INVALID',
  );
});

test('execution outcomes remain distinct, including rollback and cancellation truth', () => {
  assert.deepEqual(OPERATING_EXECUTION_VERIFICATION_STATUSES_V2, [
    'success',
    'failure',
    'blocked',
    'uncertain',
    'partial',
    'cancelled',
    'rolled-back',
  ]);
  assert.equal(deriveOperatingExecutionVerificationStatusV2({ cancelled: true }), 'cancelled');
  const { result } = scenario();
  for (const [status, expected] of [
    ['succeeded', 'success'],
    ['failed', 'failure'],
    ['blocked', 'blocked'],
    ['uncertain', 'uncertain'],
    ['partial', 'partial'],
  ]) {
    assert.equal(
      deriveOperatingExecutionVerificationStatusV2({ result: { ...result, status } }),
      expected,
    );
  }
  assert.equal(
    deriveOperatingExecutionVerificationStatusV2({
      rollbackResult: fixture('governed-execution-contracts-valid.json')[
        'operating-rollback-result'
      ],
    }),
    'rolled-back',
  );
});
