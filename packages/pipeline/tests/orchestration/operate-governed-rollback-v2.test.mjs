import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  createOperatingApprovalRecordV2,
  createOperatingApprovalRequirementV2,
} from '../../lib/operate/approvals-v2.mjs';
import { createOperatingGovernedExecutionRuntimeV2 } from '../../lib/operate/governed-execution-v2.mjs';
import { OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2 } from '../../lib/operate/governed-extensions-v2.mjs';
import {
  buildOperatingRollbackPlanV2,
  classifyOperatingRollbackReconciliationReceiptV2,
  createOperatingGovernedRecoveryRuntimeV2,
  reconcileOperatingGovernedDispatchV2,
  recordOperatingRollbackPlanV2,
  rollbackOperatingGovernedActionV2,
} from '../../lib/operate/governed-recovery-v2.mjs';
import {
  assertOperatingRollbackPolicyV2,
  evaluateOperatingActionPolicyV2,
} from '../../lib/operate/policy-v2.mjs';
import {
  createDisposableLocalProjectTargetV2,
  OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
} from '../../lib/operate/reference-governed-executors-v2.mjs';
import {
  createOperatingRuntimeEventV2,
  reduceOperatingRuntimeEventsV2,
} from '../../lib/operate/runtime-foundation.mjs';
import { canonicalizeJson, sha256Jcs } from '../../lib/protocol/jcs.mjs';
import {
  createGovernedExecutionCheckpointStore,
  governedExecutionScenario,
  rawArtifactStore,
} from './operate-governed-execution-v2.test.mjs';

const TERMINAL_FIELDS = ['submitted', 'artifactCreated', 'validated', 'resultRecorded'];
const runTest = import.meta.url === pathToFileURL(process.argv[1]).href ? test : () => {};
const EVENT_FIELDS = [
  'assignmentCreated',
  'assignmentClaimed',
  'assignmentStarted',
  'availabilityRecorded',
  'capabilityGranted',
  'intentRecorded',
  ...TERMINAL_FIELDS,
];

export function governedRollbackDraft(suffix = '75000002') {
  return {
    assignmentId: `asg_${suffix}`,
    submissionId: `sub_${suffix}`,
    operationId: `op_${suffix}`,
    grantId: `cgr_${suffix}`,
    rollbackResultId: `rbres_${suffix}`,
    resultArtifactId: `art_rollback${suffix}`,
    claimId: `claim-${suffix}`,
    preparedAt: '2026-08-10T12:02:00Z',
    completedAt: '2026-08-10T12:03:00Z',
    grantExpiresAt: '2026-08-10T12:05:00Z',
    availabilityExpiresAt: '2026-08-10T12:06:00Z',
    correlationId: `corr-${suffix}`,
    eventIds: Object.fromEntries(
      EVENT_FIELDS.map((field, index) => [
        field,
        `evt_${suffix}_${String(index + 1).padStart(2, '0')}`,
      ]),
    ),
    uncertainty: {
      rollbackResultId: `rbres_uncertain${suffix}`,
      resultArtifactId: `art_rbuncertain${suffix}`,
      submissionId: `sub_rbuncertain${suffix}`,
      eventIds: Object.fromEntries(
        TERMINAL_FIELDS.map((field, index) => [
          field,
          `evt_${suffix}_uncertain_${String(index + 1).padStart(2, '0')}`,
        ]),
      ),
    },
  };
}

export async function governedRollbackScenario({
  executeSuffix = '75000001',
  rollbackSuffix = '75000002',
} = {}) {
  const execution = governedExecutionScenario({ suffix: executeSuffix, automatic: true });
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: execution.action.targetBinding,
    initialValue: execution.initialValue,
  });
  const executionStore = createGovernedExecutionCheckpointStore(execution.initial);
  const executionRuntime = createOperatingGovernedExecutionRuntimeV2({
    initialState: execution.initial,
    checkpointStore: executionStore,
  });
  const completed = await executionRuntime.execute(execution.request, execution.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter,
  });
  const plan = buildOperatingRollbackPlanV2({
    operation: completed.operation,
    result: completed.result,
    baseline: execution.request.rollbackBaseline,
    expiresAt: '2026-08-11T12:00:00Z',
  });
  const planned = recordOperatingRollbackPlanV2({
    state: completed.state,
    plan,
    eventId: `evt_rollback_plan_${executeSuffix}`,
  });
  const request = {
    actionId: execution.action.actionId,
    originalOperationId: completed.operation.operationId,
    rollbackPlanId: plan.rollbackPlanId,
    payload: structuredClone(execution.request.payload),
    rollbackBaseline: structuredClone(execution.request.rollbackBaseline),
  };
  return {
    execution,
    targetAdapter,
    completed,
    plan,
    planned,
    request,
    draft: governedRollbackDraft(rollbackSuffix),
  };
}

function rehashRecord(record, hashField) {
  delete record[hashField];
  record[hashField] = sha256Jcs(record);
  return record;
}

runTest(
  'rollback is a separately authorized operation that restores the exact baseline once',
  async () => {
    const scenario = await governedRollbackScenario();
    const store = createGovernedExecutionCheckpointStore(scenario.planned.state);
    const runtime = createOperatingGovernedRecoveryRuntimeV2({
      initialState: scenario.planned.state,
      checkpointStore: store,
    });
    const rolledBack = await runtime.rollback(scenario.request, scenario.draft, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter: scenario.targetAdapter,
    });
    assert.equal(rolledBack.result.status, 'succeeded');
    assert.equal(rolledBack.result.originalOperationId, scenario.completed.operation.operationId);
    assert.equal(rolledBack.result.rollbackPlanId, scenario.plan.rollbackPlanId);
    assert.equal(
      rolledBack.result.targetAfterHash,
      scenario.execution.request.rollbackBaseline.contentHash,
    );
    assert.equal(rolledBack.operation.operationKind, 'rollback');
    assert.notEqual(rolledBack.operation.operationId, scenario.completed.operation.operationId);
    assert.equal(rolledBack.state.governedOperations.length, 2);
    assert.equal(rolledBack.state.executionResults.length, 1);
    assert.equal(rolledBack.state.rollbackResults.length, 1);
    assert.equal(scenario.targetAdapter.describe().effectCount, 2);

    const original = rolledBack.state.governedOperations.find(
      ({ operationKind }) => operationKind === 'execute',
    );
    assert.deepEqual(
      original,
      scenario.completed.operation,
      'rollback never mutates original operation history',
    );

    const exactRetry = await runtime.rollback(scenario.request, scenario.draft, {
      trustedHost: new Proxy(
        {},
        {
          get() {
            throw new Error('rollback replay touched host');
          },
        },
      ),
      targetAdapter: new Proxy(
        {},
        {
          get() {
            throw new Error('rollback replay touched target');
          },
        },
      ),
    });
    assert.equal(exactRetry.replayed, true);
    assert.equal(scenario.targetAdapter.describe().effectCount, 2);
    await assert.rejects(
      runtime.rollback(scenario.request, governedRollbackDraft('75000009'), {
        trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
        targetAdapter: scenario.targetAdapter,
      }),
      { code: 'ROLLBACK_NOT_ELIGIBLE' },
    );
    assert.equal(
      scenario.targetAdapter.describe().effectCount,
      2,
      'a fresh identity cannot reuse a consumed rollback plan',
    );
  },
);

runTest(
  'rollback consumes one fresh complete approval disposition independent of the parent execution',
  async () => {
    const execution = governedExecutionScenario({ suffix: '75000018', automatic: false });
    const targetAdapter = createDisposableLocalProjectTargetV2({
      target: execution.action.targetBinding,
      initialValue: execution.initialValue,
    });
    const executionRuntime = createOperatingGovernedExecutionRuntimeV2({
      initialState: execution.initial,
      checkpointStore: createGovernedExecutionCheckpointStore(execution.initial),
    });
    const completed = await executionRuntime.execute(execution.request, execution.draft, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter,
    });
    const state = structuredClone(completed.state);
    const evaluation = evaluateOperatingActionPolicyV2({
      action: execution.action,
      configuredPolicies: state.actionPolicies,
      evaluatedAt: '2026-08-10T12:01:30Z',
      evaluationId: 'pevl_rollback75000018',
    });
    const party = {
      partyId: 'rollback-owner-party',
      actorKind: 'human',
      actorId: 'rollback-owner-0001',
      requiredCapability: { id: 'action-approve', version: '1.0.0' },
    };
    const requirement = createOperatingApprovalRequirementV2({
      policyRequirementId: 'aprq_template01',
      evaluation,
      action: execution.action,
      parties: [party],
      expiresAt: '2026-08-11T08:00:00Z',
      consumable: true,
    });
    const approval = createOperatingApprovalRecordV2({
      approvalId: 'aprv_rollback75000018',
      requirement,
      evaluation,
      action: execution.action,
      partyId: party.partyId,
      actor: {
        kind: party.actorKind,
        actorId: party.actorId,
        capability: party.requiredCapability,
      },
      decision: 'approved',
      issuedAt: '2026-08-10T12:01:45Z',
      expiresAt: '2026-08-11T08:00:00Z',
    });
    state.policyEvaluations.push(evaluation);
    state.approvalRequirements.push(requirement);
    state.approvalRecords.push(approval);
    const validatedState = reduceOperatingRuntimeEventsV2([], { initialState: state });
    const plan = buildOperatingRollbackPlanV2({
      operation: completed.operation,
      result: completed.result,
      baseline: execution.request.rollbackBaseline,
      expiresAt: '2026-08-11T12:00:00Z',
    });
    const planned = recordOperatingRollbackPlanV2({
      state: validatedState,
      plan,
      eventId: 'evt_rollback_plan_75000018',
    });
    const draft = governedRollbackDraft('75000019');
    const runtime = createOperatingGovernedRecoveryRuntimeV2({
      initialState: planned.state,
      checkpointStore: createGovernedExecutionCheckpointStore(planned.state),
    });
    const result = await runtime.rollback(
      {
        actionId: execution.action.actionId,
        originalOperationId: completed.operation.operationId,
        rollbackPlanId: plan.rollbackPlanId,
        payload: execution.request.payload,
        rollbackBaseline: execution.request.rollbackBaseline,
      },
      draft,
      { trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2, targetAdapter },
    );
    const rollbackGrant = result.state.capabilityGrants.find(
      ({ operationId }) => operationId === draft.operationId,
    );
    const consumed = result.state.approvalRecords.find(
      ({ approvalId }) => approvalId === approval.approvalId,
    );
    assert.deepEqual(rollbackGrant.approvalIds, [approval.approvalId]);
    assert.equal(consumed.consumedByOperationId, draft.operationId);
    assert.notEqual(consumed.consumedByOperationId, completed.operation.operationId);
    assert.equal(result.result.status, 'succeeded');
  },
);

runTest(
  'exact rollback replay reconstructs from Event and Artifact history without target access',
  async () => {
    const scenario = await governedRollbackScenario({
      executeSuffix: '75000003',
      rollbackSuffix: '75000004',
    });
    const store = createGovernedExecutionCheckpointStore(scenario.planned.state);
    const runtime = createOperatingGovernedRecoveryRuntimeV2({
      initialState: scenario.planned.state,
      checkpointStore: store,
    });
    const first = await runtime.rollback(scenario.request, scenario.draft, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter: scenario.targetAdapter,
    });
    const restarted = createOperatingGovernedRecoveryRuntimeV2({
      initialState: first.state,
      checkpointStore: createGovernedExecutionCheckpointStore(first.state),
    });
    const replay = await restarted.rollback(scenario.request, scenario.draft, {
      trustedHost: new Proxy(
        {},
        {
          get() {
            throw new Error('replay touched host');
          },
        },
      ),
      targetAdapter: new Proxy(
        {},
        {
          get() {
            throw new Error('replay touched target');
          },
        },
      ),
    });
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.events, []);
    assert.deepEqual(replay.result, first.result);
    assert.equal(restarted.dispatchCount, 0);
  },
);

runTest(
  'required rollback eligibility survives construction, direct reduction, checkpoint loading, and restart replay',
  async () => {
    const scenario = await governedRollbackScenario({
      executeSuffix: '75000020',
      rollbackSuffix: '75000021',
    });
    const requiredPlan = buildOperatingRollbackPlanV2({
      operation: scenario.completed.operation,
      result: scenario.completed.result,
      baseline: scenario.execution.request.rollbackBaseline,
      eligibility: 'required',
      expiresAt: '2026-08-11T12:00:00Z',
    });
    assert.equal(requiredPlan.eligibility, 'required');
    const planned = recordOperatingRollbackPlanV2({
      state: scenario.completed.state,
      plan: requiredPlan,
      eventId: 'evt_rollback_plan_75000020_required',
    });
    const request = {
      ...structuredClone(scenario.request),
      rollbackPlanId: requiredPlan.rollbackPlanId,
    };
    const store = createGovernedExecutionCheckpointStore(planned.state);
    const runtime = createOperatingGovernedRecoveryRuntimeV2({
      initialState: planned.state,
      checkpointStore: store,
    });
    const completed = await runtime.rollback(request, scenario.draft, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter: scenario.targetAdapter,
    });
    assert.equal(completed.result.status, 'succeeded');
    const restarted = createOperatingGovernedRecoveryRuntimeV2({
      initialState: planned.state,
      checkpointStore: createGovernedExecutionCheckpointStore(completed.state),
    });
    const replay = await restarted.rollback(request, scenario.draft, {
      trustedHost: new Proxy(
        {},
        {
          get() {
            throw new Error('required replay touched host');
          },
        },
      ),
      targetAdapter: new Proxy(
        {},
        {
          get() {
            throw new Error('required replay touched target');
          },
        },
      ),
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.result.rollbackPlanId, requiredPlan.rollbackPlanId);
  },
);

runTest(
  'dispatching rollback reconciliation binds the durable plan and classifies exact postconditions',
  async () => {
    const absent = await governedRollbackScenario({
      executeSuffix: '75000022',
      rollbackSuffix: '75000023',
    });
    const absentStore = createGovernedExecutionCheckpointStore(absent.planned.state, {
      afterCommit({ phase }) {
        if (phase === 'rollback-intent') {
          throw Object.assign(new Error('stop-after-rollback-intent'), {
            code: 'STOP_AFTER_ROLLBACK_INTENT',
          });
        }
      },
    });
    const absentRuntime = createOperatingGovernedRecoveryRuntimeV2({
      initialState: absent.planned.state,
      checkpointStore: absentStore,
    });
    await assert.rejects(
      absentRuntime.rollback(absent.request, absent.draft, {
        trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
        targetAdapter: absent.targetAdapter,
      }),
      { code: 'OPERATION_UNCERTAIN' },
    );
    const absentState = absentStore.snapshot();
    const notApplied = await reconcileOperatingGovernedDispatchV2({
      state: absentState,
      operationId: absent.draft.operationId,
      request: absent.request,
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter: absent.targetAdapter,
      observedAt: absent.draft.completedAt,
    });
    assert.equal(notApplied.classification, 'not-applied');
    assert.equal(notApplied.receipt, null);
    assert.equal(absent.targetAdapter.describe().restoreCallCount, 0);

    const operation = absentState.governedOperations.find(
      ({ operationKind }) => operationKind === 'rollback',
    );
    const parentReceipt = absentState.operationReplayIndex.find(
      ({ operationId }) => operationId === absent.plan.operationId,
    ).terminalReceipt;
    const baseReceipt = {
      operationId: operation.operationId,
      requestFingerprint: operation.requestFingerprint,
      target: { kind: operation.target.kind, id: operation.target.id },
      before: {
        value: structuredClone(absent.request.payload.value),
        revision: parentReceipt.after.revision,
        stateHash: absent.plan.steps[0].expectedTargetHash,
      },
      after: {
        value: structuredClone(absent.request.rollbackBaseline.value),
        revision: 'rev-rollback-after',
        stateHash: absent.plan.baselineHash,
      },
      changed: true,
      synthetic: false,
      effectCount: 1,
    };
    const applied = classifyOperatingRollbackReconciliationReceiptV2({
      state: absentState,
      operationId: operation.operationId,
      response: { status: 'succeeded', receipt: baseReceipt },
    });
    assert.equal(applied.classification, 'applied');
    assert.equal(applied.receipt.after.stateHash, absent.plan.baselineHash);

    const partialReceipt = structuredClone(baseReceipt);
    partialReceipt.after.value = { partially: 'restored' };
    partialReceipt.after.stateHash = sha256Jcs(partialReceipt.after.value);
    const partial = classifyOperatingRollbackReconciliationReceiptV2({
      state: absentState,
      operationId: operation.operationId,
      response: { status: 'succeeded', receipt: partialReceipt },
    });
    assert.equal(partial.classification, 'partial');
    assert.equal(partial.receipt.after.stateHash, partialReceipt.after.stateHash);

    const foreignReceipt = structuredClone(baseReceipt);
    foreignReceipt.operationId = 'op_foreign75000023';
    const unknown = classifyOperatingRollbackReconciliationReceiptV2({
      state: absentState,
      operationId: operation.operationId,
      response: { status: 'succeeded', receipt: foreignReceipt },
    });
    assert.deepEqual(unknown, { classification: 'unknown', receipt: null });

    for (const [field, invalidRevision] of [
      ['before', null],
      ['before', ''],
      ['after', { revision: 'foreign' }],
    ]) {
      const invalid = structuredClone(baseReceipt);
      invalid[field].revision = invalidRevision;
      assert.deepEqual(
        classifyOperatingRollbackReconciliationReceiptV2({
          state: absentState,
          operationId: operation.operationId,
          response: { status: 'succeeded', receipt: invalid },
        }),
        { classification: 'unknown', receipt: null },
        `${field} revision ${String(invalidRevision)}`,
      );
    }

    const divergentValidRevision = structuredClone(baseReceipt);
    divergentValidRevision.before.revision = 'rev-valid-but-not-parent-post-revision';
    assert.deepEqual(
      classifyOperatingRollbackReconciliationReceiptV2({
        state: absentState,
        operationId: operation.operationId,
        response: { status: 'succeeded', receipt: divergentValidRevision },
      }),
      { classification: 'unknown', receipt: null },
    );

    for (const stalePostRevision of [baseReceipt.before.revision, parentReceipt.before.revision]) {
      const stalePost = structuredClone(baseReceipt);
      stalePost.after.revision = stalePostRevision;
      assert.deepEqual(
        classifyOperatingRollbackReconciliationReceiptV2({
          state: absentState,
          operationId: operation.operationId,
          response: { status: 'succeeded', receipt: stalePost },
        }),
        { classification: 'unknown', receipt: null },
        stalePostRevision,
      );
    }

    const staleOperationState = structuredClone(absentState);
    staleOperationState.governedOperations.find(
      ({ operationId }) => operationId === operation.operationId,
    ).target.id = 'foreign-target-with-stale-operation-hash';
    assert.throws(
      () =>
        classifyOperatingRollbackReconciliationReceiptV2({
          state: staleOperationState,
          operationId: operation.operationId,
          response: { status: 'succeeded', receipt: baseReceipt },
        }),
      (error) => ['OPERATION_CONFLICT', 'STATE_TRANSITION_INVALID'].includes(error.code),
    );

    const stalePlanState = structuredClone(absentState);
    stalePlanState.rollbackPlans.find(
      ({ rollbackPlanId }) => rollbackPlanId === absent.plan.rollbackPlanId,
    ).baselineHash = `sha256:${'f'.repeat(64)}`;
    assert.throws(
      () =>
        classifyOperatingRollbackReconciliationReceiptV2({
          state: stalePlanState,
          operationId: operation.operationId,
          response: { status: 'succeeded', receipt: baseReceipt },
        }),
      (error) =>
        ['OPERATION_CONFLICT', 'ROLLBACK_NOT_ELIGIBLE', 'STATE_TRANSITION_INVALID'].includes(
          error.code,
        ),
    );

    assert.throws(() =>
      classifyOperatingRollbackReconciliationReceiptV2({
        operation,
        rollbackPlan: absent.plan,
        response: { status: 'succeeded', receipt: baseReceipt },
      }),
    );
  },
);

runTest(
  'stale target and expired or repeated plans fail closed without a second restoration',
  async () => {
    const stale = await governedRollbackScenario({
      executeSuffix: '75000005',
      rollbackSuffix: '75000006',
    });
    stale.targetAdapter.apply({
      operationId: 'op_external75000006',
      requestFingerprint: `sha256:${'e'.repeat(64)}`,
      expectedRevision: stale.targetAdapter.read().revision,
      nextValue: { external: true },
    });
    const staleRuntime = createOperatingGovernedRecoveryRuntimeV2({
      initialState: stale.planned.state,
      checkpointStore: createGovernedExecutionCheckpointStore(stale.planned.state),
    });
    await assert.rejects(
      staleRuntime.rollback(stale.request, stale.draft, {
        trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
        targetAdapter: stale.targetAdapter,
      }),
      { code: 'ROLLBACK_NOT_ELIGIBLE' },
    );
    assert.equal(staleRuntime.getState().rollbackResults.length, 0);

    const expired = await governedRollbackScenario({
      executeSuffix: '75000007',
      rollbackSuffix: '75000008',
    });
    expired.draft.preparedAt = '2026-08-12T12:02:00Z';
    expired.draft.completedAt = '2026-08-12T12:03:00Z';
    expired.draft.grantExpiresAt = '2026-08-12T12:05:00Z';
    expired.draft.availabilityExpiresAt = '2026-08-12T12:06:00Z';
    const expiredRuntime = createOperatingGovernedRecoveryRuntimeV2({
      initialState: expired.planned.state,
      checkpointStore: createGovernedExecutionCheckpointStore(expired.planned.state),
    });
    await assert.rejects(
      expiredRuntime.rollback(expired.request, expired.draft, {
        trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
        targetAdapter: expired.targetAdapter,
      }),
      { code: 'ROLLBACK_NOT_ELIGIBLE' },
    );
  },
);

runTest(
  'getter-backed CAS receipts cannot claim intent or terminal checkpoint ownership',
  async () => {
    function accessorReceipt(claimedState, durableState) {
      const committedValues = [true, false, false, true];
      let committedRead = 0;
      return Object.defineProperties(
        {},
        {
          committed: {
            enumerable: true,
            get() {
              const value = committedValues[Math.min(committedRead, committedValues.length - 1)];
              committedRead += 1;
              return value;
            },
          },
          state: {
            enumerable: true,
            get() {
              return committedRead <= 2
                ? structuredClone(claimedState)
                : structuredClone(durableState);
            },
          },
        },
      );
    }

    const intent = await governedRollbackScenario({
      executeSuffix: '75000038',
      rollbackSuffix: '75000039',
    });
    const intentStore = {
      readSnapshot: () => structuredClone(intent.planned.state),
      compareAndSwap(input) {
        return accessorReceipt(input.nextState, intent.planned.state);
      },
      snapshot: () => structuredClone(intent.planned.state),
    };
    const intentRuntime = createOperatingGovernedRecoveryRuntimeV2({
      initialState: intent.planned.state,
      checkpointStore: intentStore,
    });
    await assert.rejects(
      intentRuntime.rollback(intent.request, intent.draft, {
        trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
        targetAdapter: intent.targetAdapter,
      }),
      { code: 'RESULT_CONTRACT_INVALID' },
    );
    assert.equal(intentRuntime.dispatchCount, 0);
    assert.equal(intent.targetAdapter.describe().restoreCallCount, 0);
    assert.equal(
      intentStore
        .snapshot()
        .governedOperations.filter(({ operationKind }) => operationKind === 'rollback').length,
      0,
    );

    const terminal = await governedRollbackScenario({
      executeSuffix: '75000040',
      rollbackSuffix: '75000041',
    });
    const durableTerminalStore = createGovernedExecutionCheckpointStore(terminal.planned.state);
    const terminalStore = {
      readSnapshot: durableTerminalStore.readSnapshot,
      compareAndSwap(input) {
        if (input.phase !== 'rollback-result') return durableTerminalStore.compareAndSwap(input);
        return accessorReceipt(input.nextState, durableTerminalStore.snapshot());
      },
      snapshot: durableTerminalStore.snapshot,
    };
    const terminalRuntime = createOperatingGovernedRecoveryRuntimeV2({
      initialState: terminal.planned.state,
      checkpointStore: terminalStore,
    });
    await assert.rejects(
      terminalRuntime.rollback(terminal.request, terminal.draft, {
        trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
        targetAdapter: terminal.targetAdapter,
      }),
      (error) =>
        error.code === 'RESULT_CONTRACT_INVALID' && error.details.context.provenTerminal === true,
    );
    const durable = terminalStore.snapshot();
    const terminalOperation = durable.governedOperations.find(
      ({ operationKind }) => operationKind === 'rollback',
    );
    assert.equal(terminalOperation.state, 'dispatching');
    assert.equal(terminalOperation.resultId, null);
    assert.equal(durable.rollbackResults.length, 0);
    assert.equal(
      durable.artifacts.some(
        ({ artifactId }) => artifactId === terminal.draft.uncertainty.resultArtifactId,
      ),
      false,
    );
    assert.equal(terminalRuntime.dispatchCount, 1);
    assert.equal(terminal.targetAdapter.describe().restoreCallCount, 1);
  },
);

runTest(
  'proven rollback success rebases terminal CAS contention without a second host call',
  async () => {
    const scenario = await governedRollbackScenario({
      executeSuffix: '75000010',
      rollbackSuffix: '75000011',
    });
    const artifactStore = rawArtifactStore();
    let interleaved = false;
    const store = createGovernedExecutionCheckpointStore(scenario.planned.state, {
      beforeCommit(input, durable) {
        if (input.phase !== 'rollback-result' || interleaved) return undefined;
        interleaved = true;
        const prior = durable.eventReplayIndex.find(
          ({ sequence }) => sequence === durable.eventHead.sequence,
        );
        const availability = structuredClone(
          durable.capabilityAvailability.find(
            ({ checkedAt }) => checkedAt === scenario.draft.preparedAt,
          ),
        );
        availability.availabilityId = 'cava_unrelated75000011';
        availability.checkedAt = scenario.draft.completedAt;
        delete availability.availabilityHash;
        availability.availabilityHash = sha256Jcs(availability);
        const event = createOperatingRuntimeEventV2(
          {
            eventId: 'evt_unrelated75000011',
            timestamp: scenario.draft.completedAt,
            cycleId: scenario.execution.action.sourceCycleId,
            type: 'capability.availability-recorded',
            entityId: availability.availabilityId,
            actor: { kind: 'engine', id: 'operate-runtime-v2' },
            causationId: prior.eventId,
            correlationId: 'corr-unrelated-75000011',
            payload: availability,
          },
          { previousEvent: { sequence: prior.sequence, eventHash: prior.eventHash } },
        );
        return reduceOperatingRuntimeEventsV2([event], { initialState: durable });
      },
    });
    const runtime = createOperatingGovernedRecoveryRuntimeV2({
      initialState: scenario.planned.state,
      checkpointStore: store,
      artifactStore,
    });
    const rolledBack = await runtime.rollback(scenario.request, scenario.draft, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter: scenario.targetAdapter,
    });
    assert.equal(rolledBack.result.status, 'succeeded');
    assert.equal(interleaved, true);
    assert.equal(scenario.targetAdapter.describe().restoreCallCount, 1);
    assert.equal(scenario.targetAdapter.describe().effectCount, 2);
    assert.equal(store.snapshot().rollbackResults.length, 1);
    assert.equal(store.snapshot().capabilityAvailability.length, 3);
    assert.deepEqual(
      artifactStore.read(scenario.draft.resultArtifactId),
      Buffer.from(canonicalizeJson(rolledBack.result), 'utf8'),
    );
  },
);

runTest(
  'rollback wrapper proves write-then-throw byte custody and restart replay reads the exact bytes',
  async () => {
    const scenario = await governedRollbackScenario({
      executeSuffix: '75000012',
      rollbackSuffix: '75000013',
    });
    const artifactStore = rawArtifactStore({ writeThenThrow: true });
    const store = createGovernedExecutionCheckpointStore(scenario.planned.state);
    const first = await rollbackOperatingGovernedActionV2(scenario.request, scenario.draft, {
      initialState: scenario.planned.state,
      checkpointStore: store,
      artifactStore,
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter: scenario.targetAdapter,
    });
    assert.equal(first.result.status, 'succeeded');
    assert.deepEqual(
      artifactStore.read(scenario.draft.resultArtifactId),
      Buffer.from(canonicalizeJson(first.result), 'utf8'),
    );
    assert.equal(artifactStore.read(scenario.draft.uncertainty.resultArtifactId), null);

    const restarted = createOperatingGovernedRecoveryRuntimeV2({
      initialState: scenario.planned.state,
      checkpointStore: store,
      artifactStore,
    });
    const replay = await restarted.rollback(scenario.request, scenario.draft, {
      trustedHost: new Proxy(
        {},
        {
          get() {
            throw new Error('byte replay touched host');
          },
        },
      ),
      targetAdapter: new Proxy(
        {},
        {
          get() {
            throw new Error('byte replay touched target');
          },
        },
      ),
    });
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.result, first.result);
    assert.equal(restarted.dispatchCount, 0);
    assert.equal(scenario.targetAdapter.describe().restoreCallCount, 1);

    const corruptReplay = createOperatingGovernedRecoveryRuntimeV2({
      initialState: scenario.planned.state,
      checkpointStore: store,
      artifactStore: {
        stageRaw() {
          return true;
        },
        readRaw() {
          return Buffer.from('{}', 'utf8');
        },
      },
    });
    await assert.rejects(
      corruptReplay.rollback(scenario.request, scenario.draft, {
        trustedHost: new Proxy(
          {},
          {
            get() {
              throw new Error('corrupt replay touched host');
            },
          },
        ),
        targetAdapter: new Proxy(
          {},
          {
            get() {
              throw new Error('corrupt replay touched target');
            },
          },
        ),
      }),
      (error) =>
        error.code === 'RESULT_CONTRACT_INVALID' &&
        error.details.context.provenTerminal === true &&
        error.details.context.recoveryDisposition === 'restore-exact-result-custody-before-retry',
    );
    assert.equal(corruptReplay.dispatchCount, 0);

    const unreadableReplay = createOperatingGovernedRecoveryRuntimeV2({
      initialState: scenario.planned.state,
      checkpointStore: store,
      artifactStore: {
        stageRaw() {
          return true;
        },
        readRaw() {
          throw Object.assign(new Error('fresh-runtime-read-failed'), {
            code: 'FRESH_RUNTIME_READ_FAILED',
          });
        },
      },
    });
    await assert.rejects(
      unreadableReplay.rollback(scenario.request, scenario.draft, {
        trustedHost: new Proxy(
          {},
          {
            get() {
              throw new Error('unreadable replay touched host');
            },
          },
        ),
        targetAdapter: new Proxy(
          {},
          {
            get() {
              throw new Error('unreadable replay touched target');
            },
          },
        ),
      }),
      (error) =>
        error.code === 'RESULT_CONTRACT_INVALID' &&
        error.details.context.provenTerminal === true &&
        error.details.context.recoveryDisposition === 'restore-exact-result-custody-before-retry',
    );
    assert.equal(unreadableReplay.dispatchCount, 0);
    assert.equal(store.snapshot().rollbackResults.length, 1);
    assert.equal(store.snapshot().rollbackResults[0].status, 'succeeded');
    assert.equal(
      store.snapshot().rollbackResults.some(({ status }) => status === 'uncertain'),
      false,
    );
    assert.equal(scenario.targetAdapter.describe().restoreCallCount, 1);
  },
);

runTest(
  'a proven rollback receipt is never downgraded when exact Artifact custody is unavailable',
  async () => {
    const scenario = await governedRollbackScenario({
      executeSuffix: '75000016',
      rollbackSuffix: '75000017',
    });
    const store = createGovernedExecutionCheckpointStore(scenario.planned.state);
    const artifactStore = rawArtifactStore({ fail: true });
    const runtime = createOperatingGovernedRecoveryRuntimeV2({
      initialState: scenario.planned.state,
      checkpointStore: store,
      artifactStore,
    });
    await assert.rejects(
      runtime.rollback(scenario.request, scenario.draft, {
        trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
        targetAdapter: scenario.targetAdapter,
      }),
      (error) =>
        error.code === 'OPERATION_UNCERTAIN' && error.details.context.provenTerminal === true,
    );
    const durable = store.snapshot();
    const rollbackOperation = durable.governedOperations.find(
      ({ operationKind }) => operationKind === 'rollback',
    );
    assert.equal(rollbackOperation.state, 'dispatching');
    assert.equal(rollbackOperation.resultId, null);
    assert.equal(durable.rollbackResults.length, 0);
    assert.equal(artifactStore.read(scenario.draft.resultArtifactId), null);
    assert.equal(artifactStore.read(scenario.draft.uncertainty.resultArtifactId), null);
    assert.equal(scenario.targetAdapter.describe().restoreCallCount, 1);
    assert.equal(scenario.targetAdapter.describe().effectCount, 2);
    await assert.rejects(
      runtime.rollback(scenario.request, scenario.draft, {
        trustedHost: new Proxy(
          {},
          {
            get() {
              throw new Error('proven retry touched host');
            },
          },
        ),
        targetAdapter: new Proxy(
          {},
          {
            get() {
              throw new Error('proven retry touched target');
            },
          },
        ),
      }),
      { code: 'OPERATION_UNCERTAIN' },
    );
    assert.equal(scenario.targetAdapter.describe().restoreCallCount, 1);
  },
);

runTest(
  'post-proof malformed, rejected, divergent CAS and replay-read failures never create uncertainty or redispatch',
  async () => {
    const assertProvenTerminal = (error) => error?.details?.context?.provenTerminal === true;
    for (const [index, mode] of ['malformed', 'rejected', 'divergent'].entries()) {
      const scenario = await governedRollbackScenario({
        executeSuffix: `7500003${index * 2}`,
        rollbackSuffix: `7500003${index * 2 + 1}`,
      });
      const durableStore = createGovernedExecutionCheckpointStore(scenario.planned.state);
      const checkpointStore = {
        readSnapshot: durableStore.readSnapshot,
        async compareAndSwap(input) {
          if (input.phase !== 'rollback-result') return durableStore.compareAndSwap(input);
          if (mode === 'malformed') {
            return { committed: 'yes', state: durableStore.snapshot() };
          }
          if (mode === 'rejected') {
            return { committed: false, state: durableStore.snapshot() };
          }
          return { committed: true, state: durableStore.snapshot() };
        },
        snapshot: durableStore.snapshot,
      };
      const runtime = createOperatingGovernedRecoveryRuntimeV2({
        initialState: scenario.planned.state,
        checkpointStore,
      });
      await assert.rejects(
        runtime.rollback(scenario.request, scenario.draft, {
          trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
          targetAdapter: scenario.targetAdapter,
        }),
        assertProvenTerminal,
        mode,
      );
      const durable = checkpointStore.snapshot();
      const rollbackOperation = durable.governedOperations.find(
        ({ operationKind }) => operationKind === 'rollback',
      );
      assert.equal(rollbackOperation.state, 'dispatching', mode);
      assert.equal(rollbackOperation.resultId, null, mode);
      assert.equal(durable.rollbackResults.length, 0, mode);
      assert.equal(
        durable.artifacts.some(
          ({ artifactId }) => artifactId === scenario.draft.uncertainty.resultArtifactId,
        ),
        false,
        mode,
      );
      assert.equal(scenario.targetAdapter.describe().restoreCallCount, 1, mode);
      await assert.rejects(
        runtime.rollback(scenario.request, scenario.draft, {
          trustedHost: new Proxy(
            {},
            {
              get() {
                throw new Error(`${mode} retry touched host`);
              },
            },
          ),
          targetAdapter: new Proxy(
            {},
            {
              get() {
                throw new Error(`${mode} retry touched target`);
              },
            },
          ),
        }),
        assertProvenTerminal,
        `${mode} retry`,
      );
      assert.equal(scenario.targetAdapter.describe().restoreCallCount, 1, mode);

      if (mode === 'divergent') {
        const proof = await reconcileOperatingGovernedDispatchV2({
          state: durable,
          operationId: scenario.draft.operationId,
          request: scenario.request,
          trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
          targetAdapter: scenario.targetAdapter,
          observedAt: scenario.draft.completedAt,
        });
        assert.equal(proof.classification, 'applied');
        assert.equal(proof.receipt.after.stateHash, scenario.plan.baselineHash);
      }
    }

    const replayRead = await governedRollbackScenario({
      executeSuffix: '75000036',
      rollbackSuffix: '75000037',
    });
    const bytes = new Map();
    let reads = 0;
    const artifactStore = {
      stageRaw({ artifact, rawBytes }) {
        bytes.set(artifact.artifactId, Buffer.from(rawBytes));
      },
      readRaw({ artifactId }) {
        reads += 1;
        if (reads >= 3)
          throw Object.assign(new Error('replay-read-failed'), {
            code: 'REPLAY_READ_FAILED',
          });
        return Buffer.from(bytes.get(artifactId));
      },
    };
    let lost = false;
    const checkpointStore = createGovernedExecutionCheckpointStore(replayRead.planned.state, {
      afterCommit({ phase }) {
        if (phase === 'rollback-result' && !lost) {
          lost = true;
          throw Object.assign(new Error('rollback-result-ack-lost'), {
            code: 'ROLLBACK_RESULT_ACK_LOST',
          });
        }
      },
    });
    const runtime = createOperatingGovernedRecoveryRuntimeV2({
      initialState: replayRead.planned.state,
      checkpointStore,
      artifactStore,
    });
    await assert.rejects(
      runtime.rollback(replayRead.request, replayRead.draft, {
        trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
        targetAdapter: replayRead.targetAdapter,
      }),
      assertProvenTerminal,
    );
    const durable = checkpointStore.snapshot();
    assert.equal(
      durable.governedOperations.find(({ operationKind }) => operationKind === 'rollback').state,
      'succeeded',
    );
    assert.equal(durable.rollbackResults.length, 1);
    assert.equal(durable.rollbackResults[0].status, 'succeeded');
    assert.equal(
      durable.rollbackResults.some(({ status }) => status === 'uncertain'),
      false,
    );
    assert.equal(replayRead.targetAdapter.describe().restoreCallCount, 1);
    await assert.rejects(
      runtime.rollback(replayRead.request, replayRead.draft, {
        trustedHost: new Proxy(
          {},
          {
            get() {
              throw new Error('replay-read retry touched host');
            },
          },
        ),
        targetAdapter: new Proxy(
          {},
          {
            get() {
              throw new Error('replay-read retry touched target');
            },
          },
        ),
      }),
      assertProvenTerminal,
    );
    assert.equal(replayRead.targetAdapter.describe().restoreCallCount, 1);
  },
);

runTest(
  'unsupported, irreversible, prohibited, and non-success parent rollback vectors fail closed',
  async () => {
    const scenario = await governedRollbackScenario({
      executeSuffix: '75000014',
      rollbackSuffix: '75000015',
    });

    const irreversible = structuredClone(scenario.completed.operation);
    irreversible.rollbackClass = 'manual';
    rehashRecord(irreversible, 'operationHash');
    assert.throws(
      () =>
        buildOperatingRollbackPlanV2({
          operation: irreversible,
          result: scenario.completed.result,
          baseline: scenario.execution.request.rollbackBaseline,
          expiresAt: '2026-08-11T12:00:00Z',
        }),
      { code: 'ROLLBACK_NOT_ELIGIBLE' },
    );

    for (const status of ['failed', 'uncertain']) {
      const operation = structuredClone(scenario.completed.operation);
      const result = structuredClone(scenario.completed.result);
      operation.state = status;
      rehashRecord(operation, 'operationHash');
      result.status = status;
      result.targetAfterHash = null;
      result.effectSummary = {
        changed: false,
        summary: `${status} parent result cannot authorize rollback.`,
        affectedTargetIds: [],
      };
      rehashRecord(result, 'resultHash');
      assert.throws(
        () =>
          buildOperatingRollbackPlanV2({
            operation,
            result,
            baseline: scenario.execution.request.rollbackBaseline,
            expiresAt: '2026-08-11T12:00:00Z',
          }),
        { code: 'ROLLBACK_NOT_ELIGIBLE' },
        status,
      );
    }

    const partialOperation = structuredClone(scenario.completed.operation);
    const partialResult = structuredClone(scenario.completed.result);
    partialOperation.state = 'partial';
    rehashRecord(partialOperation, 'operationHash');
    partialResult.status = 'partial';
    partialResult.effectSummary.summary = 'Parent execution was only partially applied.';
    rehashRecord(partialResult, 'resultHash');
    const partialPlan = buildOperatingRollbackPlanV2({
      operation: partialOperation,
      result: partialResult,
      baseline: scenario.execution.request.rollbackBaseline,
      expiresAt: '2026-08-11T12:00:00Z',
    });
    assert.equal(partialPlan.eligibility, 'uncertain');
    assert.throws(
      () =>
        assertOperatingRollbackPolicyV2({
          action: scenario.execution.action,
          evaluation: scenario.completed.state.policyEvaluations[0],
          rollbackPlan: partialPlan,
          at: scenario.draft.preparedAt,
        }),
      { code: 'ROLLBACK_NOT_ELIGIBLE' },
    );

    const prohibitedEvaluation = structuredClone(scenario.completed.state.policyEvaluations[0]);
    prohibitedEvaluation.outcome = 'prohibited';
    rehashRecord(prohibitedEvaluation, 'evaluationHash');
    assert.throws(
      () =>
        assertOperatingRollbackPolicyV2({
          action: scenario.execution.action,
          evaluation: prohibitedEvaluation,
          rollbackPlan: scenario.plan,
          at: scenario.draft.preparedAt,
        }),
      { code: 'ROLLBACK_NOT_ELIGIBLE' },
    );

    const unsupportedRegistry = structuredClone(OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2);
    unsupportedRegistry.executors = unsupportedRegistry.executors.filter(
      ({ executorId }) => executorId !== 'open-reference-project-executor',
    );
    const runtime = createOperatingGovernedRecoveryRuntimeV2({
      initialState: scenario.planned.state,
      checkpointStore: createGovernedExecutionCheckpointStore(scenario.planned.state),
      registry: unsupportedRegistry,
    });
    await assert.rejects(
      runtime.rollback(scenario.request, scenario.draft, {
        trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
        targetAdapter: scenario.targetAdapter,
      }),
      { code: 'EXECUTOR_UNAVAILABLE' },
    );
    assert.equal(runtime.dispatchCount, 0);
    assert.equal(scenario.targetAdapter.describe().restoreCallCount, 0);
    assert.equal(scenario.targetAdapter.describe().effectCount, 1);
  },
);
