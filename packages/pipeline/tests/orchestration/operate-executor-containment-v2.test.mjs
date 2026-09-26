import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createOperatingApprovalRecordV2,
  createOperatingApprovalRequirementV2,
} from '../../lib/operate/approvals-v2.mjs';
import {
  assertOperateAuthorityV2,
  evaluateOperateAuthorityV2,
} from '../../lib/operate/authorization-v2.mjs';
import {
  createContainedExecutorInputEnvelopeV2,
  createTrustedExecutorBindingV2,
  deriveContainedExecutorRequestFingerprintV2,
  OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
  selectOperateExecutorV2,
} from '../../lib/operate/governed-extensions-v2.mjs';
import {
  createOperatingActionPolicyV2,
  evaluateOperatingActionPolicyV2,
} from '../../lib/operate/policy-v2.mjs';
import {
  createDisposableLocalProjectTargetV2,
  createSyntheticNoNetworkTargetV2,
  OPEN_REFERENCE_CONTAINMENT_EXECUTOR_HOST_V2,
  OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
} from '../../lib/operate/reference-governed-executors-v2.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
const clone = (value) => structuredClone(value);
const authorization = fixture('authorization-valid.json');
const governed = fixture('governed-execution-contracts-valid.json');
const selectionFixture = fixture('governed-extensions-valid.json');

function authorityContext() {
  const action = clone(authorization.action);
  const templateId = 'aprq_00000001';
  const corePolicy = createOperatingActionPolicyV2({
    policyId: 'core-governed-action-policy',
    policyVersion: '1.0.0',
    domainId: action.domainId,
    actionKind: action.actionKind,
    capability: action.requestedCapability,
    effectClasses: [action.effectClass],
    targetKinds: [action.targetBinding.kind],
    decisionMode: 'automatic',
    approvalRequirementIds: [],
    rollbackRequired: true,
    verificationRequired: true,
    tier: 'core',
    provenance: {
      providerId: 'core-policy-provider',
      providerVersion: '1.0.0',
      sourceHash: `sha256:${'c'.repeat(64)}`,
    },
  });
  const actionPolicy = createOperatingActionPolicyV2({
    ...clone(governed['operating-action-policy']),
    approvalRequirementIds: [templateId],
  });
  const policyEvaluation = evaluateOperatingActionPolicyV2({
    action,
    configuredPolicies: [corePolicy, actionPolicy],
    evaluatedAt: '2026-08-10T08:00:00Z',
  });
  const requirement = createOperatingApprovalRequirementV2({
    policyRequirementId: templateId,
    evaluation: policyEvaluation,
    action,
    parties: clone(governed['operating-approval-requirement'].parties),
    expiresAt: governed['operating-approval-requirement'].expiresAt,
    consumable: true,
  });
  const party = requirement.parties[0];
  const approval = createOperatingApprovalRecordV2({
    approvalId: 'aprv_00000001',
    requirement,
    evaluation: policyEvaluation,
    action,
    partyId: party.partyId,
    actor: {
      kind: party.actorKind,
      actorId: party.actorId,
      capability: clone(party.requiredCapability),
    },
    decision: 'approved',
    issuedAt: '2026-08-10T08:01:00Z',
    expiresAt: requirement.expiresAt,
  });
  const grant = {
    ...clone(governed['operating-capability-grant']),
    evaluationId: policyEvaluation.evaluationId,
    approvalIds: [approval.approvalId],
    scopeHash: requirement.scopeHash,
  };
  const operation = {
    ...clone(governed['operating-governed-operation']),
    evaluationId: policyEvaluation.evaluationId,
    approvalIds: [approval.approvalId],
  };
  return {
    actor: {
      actorId: 'operate-runtime-v2',
      kind: 'engine',
      capabilities: [clone(action.requestedCapability)],
    },
    capabilities: [clone(authorization.toolCapabilities.actionExecute)],
    now: authorization.now,
    action,
    actionRequest: clone(authorization.executeRequest),
    scope: clone(authorization.scope),
    target: clone(authorization.target),
    actionPolicy,
    actionPolicies: [corePolicy, actionPolicy],
    policyEvaluation,
    approvalRequirements: [requirement],
    approvals: [approval],
    capabilityAvailability: clone(governed['operating-capability-availability']),
    grant,
    operation,
    operationHistory: [],
    currentPreconditionArtifactIds: [...action.preconditionArtifactIds],
    executor: clone(governed['operate-executor-registration']),
    governedExtensions: OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
  };
}

function projectBinding() {
  const selection = selectOperateExecutorV2(OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2, {
    protocolVersion: selectionFixture.protocolVersion,
    runtimeVersion: selectionFixture.runtimeVersion,
    now: selectionFixture.observedAt,
    ...selectionFixture.projectExecutorSelection,
  });
  return {
    selection,
    binding: createTrustedExecutorBindingV2({
      selection,
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    }),
  };
}

function bindExecutorInput(context, binding, { payloadValue, baselineValue }) {
  context.operation.connector = clone(binding.connector);
  const artifactId = context.operation.inputArtifactIds[0];
  const payload = { artifactId, contentHash: sha256Jcs(payloadValue), value: clone(payloadValue) };
  const rollbackBaseline =
    context.operation.rollbackClass === 'not-applicable'
      ? null
      : {
          artifactId,
          contentHash: sha256Jcs(baselineValue),
          value: clone(baselineValue),
        };
  context.operation.requestFingerprint = deriveContainedExecutorRequestFingerprintV2({
    operation: context.operation,
    payload,
    rollbackBaseline,
  });
  const executorInput = createContainedExecutorInputEnvelopeV2({
    operation: context.operation,
    payload,
    rollbackBaseline,
  });
  context.trustedExecutorBinding = binding;
  context.executorInput = executorInput;
  return executorInput;
}

test('the disposable project executor applies once, replays idempotently, reconciles, and persists no Artifact or Event', () => {
  const context = authorityContext();
  const { selection, binding } = projectBinding();
  context.executor = clone(selection.registration);
  const initialValue = { status: 'before', count: 0 };
  const executorInput = bindExecutorInput(context, binding, {
    payloadValue: { status: 'after', count: 1 },
    baselineValue: initialValue,
  });
  const decision = assertOperateAuthorityV2('operate.action.execute', context);
  const contextHash = sha256Jcs(context);
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: context.operation.target,
    initialValue,
  });
  const invocation = {
    authorityContext: context,
    authorityDecision: decision,
    executorInput,
    binding,
    executor: selection.registration,
    targetAdapter,
  };
  const receipt = OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.execute(invocation);
  const replay = OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.execute(invocation);
  assert.deepEqual(replay, receipt);
  assert.equal(receipt.effectCount, 1);
  assert.equal(receipt.changed, true);
  assert.deepEqual(targetAdapter.read().value, { status: 'after', count: 1 });
  assert.deepEqual(
    OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.reconcile({
      targetAdapter,
      executorInput,
      binding,
      executor: selection.registration,
      rollbackPlan: null,
    }),
    { status: 'succeeded', receipt },
  );
  const divergentPayloadValue = { status: 'different', count: 2 };
  const divergentOperation = clone(context.operation);
  const divergentPayload = {
    artifactId: divergentOperation.inputArtifactIds[0],
    contentHash: sha256Jcs(divergentPayloadValue),
    value: divergentPayloadValue,
  };
  const divergentBaseline = clone(executorInput.rollbackBaseline);
  divergentOperation.requestFingerprint = deriveContainedExecutorRequestFingerprintV2({
    operation: divergentOperation,
    payload: divergentPayload,
    rollbackBaseline: divergentBaseline,
  });
  const divergentReconcileInput = createContainedExecutorInputEnvelopeV2({
    operation: divergentOperation,
    payload: divergentPayload,
    rollbackBaseline: divergentBaseline,
  });
  assert.throws(
    () =>
      OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.reconcile({
        targetAdapter,
        executorInput: divergentReconcileInput,
        binding,
        executor: selection.registration,
        rollbackPlan: null,
      }),
    { code: 'OPERATION_CONFLICT' },
  );
  assert.equal(targetAdapter.describe().effectCount, 1);
  assert.equal(
    sha256Jcs(context),
    contextHash,
    'executor did not mutate or persist into authority state',
  );
  assert.equal(
    Object.keys(receipt).some((key) => /(?:artifact|event|resultId)/u.test(key)),
    false,
  );
});

test('connector, decision, executor, and target substitution fail before a contained effect', () => {
  const context = authorityContext();
  const { selection, binding } = projectBinding();
  context.executor = clone(selection.registration);
  const executorInput = bindExecutorInput(context, binding, {
    payloadValue: { count: 1 },
    baselineValue: { count: 0 },
  });
  const decision = assertOperateAuthorityV2('operate.action.execute', context);
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: context.operation.target,
    initialValue: { count: 0 },
  });
  const input = {
    authorityContext: context,
    authorityDecision: decision,
    executorInput,
    binding,
    executor: selection.registration,
    targetAdapter,
  };

  assert.throws(
    () =>
      OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.execute({
        ...input,
        operation: context.operation,
      }),
    { code: 'OPERATION_CONFLICT' },
    'obsolete top-level operation is not part of the runtime invocation',
  );

  const forged = clone(decision);
  forged.checks = forged.checks.filter((check) => check !== 'trusted-executor-connector-binding');
  assert.throws(
    () => OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.execute({ ...input, authorityDecision: forged }),
    {
      code: 'CAPABILITY_DENIED',
    },
  );
  assert.deepEqual(targetAdapter.read().value, { count: 0 });

  const disconnected = clone(context);
  disconnected.operation.connector = null;
  delete disconnected.trustedExecutorBinding;
  delete disconnected.executorInput;
  assert.equal(
    evaluateOperateAuthorityV2('operate.action.execute', disconnected).allowed,
    true,
    'legacy connectorless validation remains data-only and does not dispatch',
  );
  assert.throws(
    () =>
      OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.execute({
        ...input,
        authorityContext: disconnected,
      }),
    { code: 'OPERATION_CONFLICT' },
  );
  assert.deepEqual(targetAdapter.read().value, { count: 0 });

  const syntheticTarget = createSyntheticNoNetworkTargetV2({
    target: { kind: 'synthetic-target', id: 'synthetic-0001', revision: 'rev-0001' },
    initialValue: { count: 0 },
  });
  assert.throws(
    () =>
      OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.execute({ ...input, targetAdapter: syntheticTarget }),
    {
      code: 'OPERATION_CONFLICT',
    },
  );
  assert.deepEqual(targetAdapter.read().value, { count: 0 });

  const substitutedTarget = createDisposableLocalProjectTargetV2({
    target: { ...clone(context.operation.target), id: 'record-substituted' },
    initialValue: { count: 0 },
  });
  assert.throws(
    () =>
      OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.execute({
        ...input,
        targetAdapter: substitutedTarget,
      }),
    { code: 'OPERATION_CONFLICT' },
  );
  assert.deepEqual(substitutedTarget.read().value, { count: 0 });

  const tamperedEnvelope = clone(executorInput);
  tamperedEnvelope.payload.value.count = 999;
  assert.equal(
    evaluateOperateAuthorityV2('operate.action.execute', {
      ...context,
      executorInput: tamperedEnvelope,
    }).allowed,
    false,
  );
  assert.throws(
    () =>
      OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.execute({
        ...input,
        executorInput: tamperedEnvelope,
      }),
    { code: 'OPERATION_CONFLICT' },
  );
  assert.deepEqual(targetAdapter.read().value, { count: 0 });
});

test('missing Action keeps ACTION_NOT_FOUND precedence over valid or invalid connected containment input', () => {
  const { selection, binding } = projectBinding();
  for (const invalidEnvelope of [false, true]) {
    const context = authorityContext();
    context.executor = clone(selection.registration);
    const executorInput = bindExecutorInput(context, binding, {
      payloadValue: { count: 1 },
      baselineValue: { count: 0 },
    });
    if (invalidEnvelope) {
      const divergent = clone(executorInput);
      divergent.payload.value.count = 999;
      context.executorInput = divergent;
    }
    delete context.action;
    const decision = evaluateOperateAuthorityV2('operate.action.execute', context);
    assert.equal(decision.allowed, false, invalidEnvelope ? 'invalid envelope' : 'valid envelope');
    assert.equal(
      decision.error.code,
      'ACTION_NOT_FOUND',
      invalidEnvelope ? 'invalid envelope' : 'valid envelope',
    );
  }
});

test('reversible project execution restores only its exact fingerprint-bound baseline', () => {
  const executeContext = authorityContext();
  const { selection, binding } = projectBinding();
  executeContext.executor = clone(selection.registration);
  const initialValue = { status: 'before', count: 0 };
  const executeInput = bindExecutorInput(executeContext, binding, {
    payloadValue: { status: 'after', count: 1 },
    baselineValue: initialValue,
  });
  const executeDecision = assertOperateAuthorityV2('operate.action.execute', executeContext);
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: executeContext.operation.target,
    initialValue,
  });
  const executionReceipt = OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.execute({
    authorityContext: executeContext,
    authorityDecision: executeDecision,
    executorInput: executeInput,
    binding,
    executor: selection.registration,
    targetAdapter,
  });

  const rollbackContext = authorityContext();
  rollbackContext.capabilities = [clone(authorization.toolCapabilities.actionRollback)];
  rollbackContext.action.state = 'completed';
  rollbackContext.actionRequest = clone(authorization.rollbackRequest);
  rollbackContext.executor = clone(selection.registration);
  rollbackContext.rollbackPlan = {
    ...clone(governed['operating-rollback-plan']),
    baselineHash: sha256Jcs(initialValue),
    steps: clone(governed['operating-rollback-plan'].steps).map((step) => ({
      ...step,
      expectedTargetHash: sha256Jcs(initialValue),
    })),
  };
  rollbackContext.operationHistory = [
    {
      ...clone(executeContext.operation),
      state: 'succeeded',
      resultId: 'xres_00000001',
    },
  ];
  rollbackContext.operation = {
    ...clone(governed['operating-governed-operation']),
    operationId: 'op_00000002',
    operationKind: 'rollback',
    assignmentId: 'asg_00000002',
    grantId: 'cgr_00000002',
    verificationPlanId: rollbackContext.rollbackPlan.verificationPlanId,
    rollbackPlanId: rollbackContext.rollbackPlan.rollbackPlanId,
    parentOperationId: executeContext.operation.operationId,
    evaluationId: rollbackContext.policyEvaluation.evaluationId,
    approvalIds: rollbackContext.approvals.map(({ approvalId }) => approvalId),
    state: 'authorized',
    intentEventId: 'evt_00000002',
    operationHash: `sha256:${'1'.repeat(64)}`,
    connector: clone(binding.connector),
  };
  rollbackContext.grant = {
    ...clone(governed['operating-capability-grant']),
    grantId: 'cgr_00000002',
    operationId: 'op_00000002',
    assignmentId: 'asg_00000002',
    evaluationId: rollbackContext.policyEvaluation.evaluationId,
    approvalIds: rollbackContext.approvals.map(({ approvalId }) => approvalId),
    scopeHash: rollbackContext.approvalRequirements[0].scopeHash,
    grantHash: `sha256:${'2'.repeat(64)}`,
  };
  const rollbackPayload = {
    artifactId: rollbackContext.operation.inputArtifactIds[0],
    contentHash: sha256Jcs({ command: 'restore-reviewed-baseline' }),
    value: { command: 'restore-reviewed-baseline' },
  };
  const rollbackBaseline = {
    artifactId: rollbackContext.rollbackPlan.baselineArtifactId,
    contentHash: sha256Jcs(initialValue),
    value: initialValue,
  };
  rollbackContext.operation.requestFingerprint = deriveContainedExecutorRequestFingerprintV2({
    operation: rollbackContext.operation,
    payload: rollbackPayload,
    rollbackBaseline,
  });
  const rollbackInput = createContainedExecutorInputEnvelopeV2({
    operation: rollbackContext.operation,
    payload: rollbackPayload,
    rollbackBaseline,
  });
  rollbackContext.trustedExecutorBinding = binding;
  rollbackContext.executorInput = rollbackInput;
  const originalHistoryFingerprint = rollbackContext.operationHistory[0].requestFingerprint;
  rollbackContext.operationHistory[0].requestFingerprint = `sha256:${'9'.repeat(64)}`;
  const divergentParentDecision = assertOperateAuthorityV2(
    'operate.action.rollback',
    rollbackContext,
  );
  assert.throws(
    () =>
      OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.rollback({
        authorityContext: rollbackContext,
        authorityDecision: divergentParentDecision,
        executorInput: rollbackInput,
        binding,
        executor: selection.registration,
        targetAdapter,
      }),
    { code: 'OPERATION_CONFLICT' },
  );
  assert.deepEqual(targetAdapter.read().value, { status: 'after', count: 1 });
  rollbackContext.operationHistory[0].requestFingerprint = originalHistoryFingerprint;
  const rollbackDecision = assertOperateAuthorityV2('operate.action.rollback', rollbackContext);

  const restartedTarget = createDisposableLocalProjectTargetV2({
    target: rollbackContext.operation.target,
    initialValue: { status: 'after', count: 1 },
  });
  assert.throws(
    () =>
      OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.rollback({
        authorityContext: rollbackContext,
        authorityDecision: rollbackDecision,
        executorInput: rollbackInput,
        binding,
        executor: selection.registration,
        targetAdapter: restartedTarget,
      }),
    { code: 'OPERATION_CONFLICT' },
  );
  assert.deepEqual(restartedTarget.read().value, { status: 'after', count: 1 });

  const rollbackReceipt = OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.rollback({
    authorityContext: rollbackContext,
    authorityDecision: rollbackDecision,
    executorInput: rollbackInput,
    binding,
    executor: selection.registration,
    targetAdapter,
  });
  assert.deepEqual(targetAdapter.read().value, initialValue);
  assert.equal(rollbackReceipt.before.revision, executionReceipt.after.revision);
  assert.equal(rollbackReceipt.after.stateHash, sha256Jcs(initialValue));

  const divergent = clone(rollbackInput);
  divergent.rollbackBaseline.value = { status: 'attacker' };
  assert.throws(
    () =>
      OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.rollback({
        authorityContext: rollbackContext,
        authorityDecision: rollbackDecision,
        executorInput: divergent,
        binding,
        executor: selection.registration,
        targetAdapter,
      }),
    { code: 'OPERATION_CONFLICT' },
  );
});

test('synthetic containment host is package-local, no-network, exact-bound, and rejects ambient targets', () => {
  const selection = selectOperateExecutorV2(OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2, {
    protocolVersion: selectionFixture.protocolVersion,
    runtimeVersion: selectionFixture.runtimeVersion,
    now: selectionFixture.observedAt,
    ...selectionFixture.containmentExecutorSelection,
  });
  const binding = createTrustedExecutorBindingV2({
    selection,
    trustedHost: OPEN_REFERENCE_CONTAINMENT_EXECUTOR_HOST_V2,
  });
  assert.deepEqual(binding.connector, { id: 'synthetic-no-network-connector', version: '1.0.0' });
  const target = createSyntheticNoNetworkTargetV2({
    target: { kind: 'synthetic-target', id: 'synthetic-0001', revision: 'rev-0001' },
    initialValue: {},
  });
  assert.equal(Object.isFrozen(binding), true);
  assert.throws(
    () =>
      OPEN_REFERENCE_CONTAINMENT_EXECUTOR_HOST_V2.reconcile({
        targetAdapter: { reconcile: () => ({ status: 'not-found', receipt: null }) },
      }),
    { code: 'OPERATION_CONFLICT' },
  );

  const source = readFileSync(
    new URL('../../lib/operate/reference-governed-executors-v2.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /from ['"]node:(?:fs|net|http|https|child_process|worker_threads)['"]/u,
  );
  assert.doesNotMatch(source, /\b(?:fetch|WebSocket|EventSource|process\.env|import\s*\()\b/u);
});

test('contained adapters reject prohibited payloads before mutating explicit state', () => {
  const target = createDisposableLocalProjectTargetV2({
    target: { kind: 'project-record', id: 'record-contained', revision: 'rev-0001' },
    initialValue: { safe: true },
  });
  assert.throws(
    () =>
      createDisposableLocalProjectTargetV2({
        target: { kind: 'project-record', id: 'record-secret', revision: 'rev-0001' },
        initialValue: { credential: 'api-key-secret' },
      }),
    { code: 'CAPABILITY_DENIED' },
  );
  for (const value of [
    'Credential Change',
    'customer_contact',
    'DESTROY',
    'transfer funds',
    'payment.transfer',
    'deployProduction',
    'production merge',
    'PUBLISH',
    'mutate_secret',
  ]) {
    assert.throws(
      () =>
        createDisposableLocalProjectTargetV2({
          target: { kind: 'project-record', id: `record-${value.length}`, revision: 'rev-0001' },
          initialValue: { safe: { value } },
        }),
      { code: 'CAPABILITY_DENIED' },
      value,
    );
    const normalizedKey = value.replace(/[^A-Za-z0-9]/gu, '_');
    assert.throws(
      () =>
        createDisposableLocalProjectTargetV2({
          target: {
            kind: 'project-record',
            id: `record-key-${value.length}`,
            revision: 'rev-0001',
          },
          initialValue: { [normalizedKey]: true },
        }),
      { code: 'CAPABILITY_DENIED' },
      `${value} key`,
    );
  }
  assert.deepEqual(target.read().value, { safe: true });
});

test('all consolidated core-prohibition key/value forms fail on the executor path with zero effects', () => {
  const vectors = [
    { payment: 'sent' },
    { funds: 'transferred' },
    { credentialValue: 'rotated' },
    { secretValue: 'rotated' },
    { production: 'deploy' },
    { customer: 'contacted' },
    { delete: 'all' },
    { publishNow: true },
    { mergeTo: 'production' },
    { production: true, deploy: true },
    { production: true, merge: true },
    { funds: 100, transfer: true },
    { payment: 100, send: true },
    { customer: 'acme', contact: true },
    { releasePublic: true },
    { intent: 'release-public' },
    { release: true },
    { intent: 'release' },
    { removeRecord: true },
    { intent: 'remove-record' },
    { eraseRecord: true },
    { intent: 'erase-record' },
    { wipeRecord: true },
    { intent: 'wipe-record' },
    { remitFunds: true },
    { intent: 'remit-funds' },
    { pay: true, send: true },
    { pay: 'transfer' },
    { moneyTransfer: true },
    { money: 'transfer' },
    { shipProduction: true },
    { intent: 'ship-production' },
    { deliverProduction: true },
    { intent: 'delivery-production' },
    { messageCustomer: true },
    { intent: 'message-customer' },
    { emailCustomer: true },
    { intent: 'email-customer' },
    { reachoutCustomer: true },
    { intent: 'reachout-customer' },
  ];
  const { selection, binding } = projectBinding();
  for (const payloadValue of vectors) {
    assert.throws(
      () =>
        createDisposableLocalProjectTargetV2({
          target: {
            kind: 'project-record',
            id: `direct-${Object.keys(payloadValue)[0]}`,
            revision: 'rev-0001',
          },
          initialValue: payloadValue,
        }),
      { code: 'CAPABILITY_DENIED' },
    );

    const context = authorityContext();
    context.executor = clone(selection.registration);
    const executorInput = bindExecutorInput(context, binding, {
      payloadValue,
      baselineValue: { safe: true },
    });
    const decision = assertOperateAuthorityV2('operate.action.execute', context);
    const targetAdapter = createDisposableLocalProjectTargetV2({
      target: context.operation.target,
      initialValue: { safe: true },
    });
    assert.throws(
      () =>
        OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.execute({
          authorityContext: context,
          authorityDecision: decision,
          executorInput,
          binding,
          executor: selection.registration,
          targetAdapter,
        }),
      { code: 'CAPABILITY_DENIED' },
      JSON.stringify(payloadValue),
    );
    assert.deepEqual(
      targetAdapter.read(),
      {
        value: { safe: true },
        revision: context.operation.target.revision,
        stateHash: sha256Jcs({ safe: true }),
      },
      JSON.stringify(payloadValue),
    );
  }

  const payOnly = createDisposableLocalProjectTargetV2({
    target: { kind: 'project-record', id: 'direct-pay-only', revision: 'rev-0001' },
    initialValue: { pay: true },
  });
  assert.deepEqual(
    payOnly.read().value,
    { pay: true },
    'pay alone does not imply a prohibited transfer without send/transfer composition',
  );
  for (const standalone of ['ship', 'message', 'email']) {
    const target = createDisposableLocalProjectTargetV2({
      target: { kind: 'project-record', id: `direct-${standalone}-only`, revision: 'rev-0001' },
      initialValue: { [standalone]: true },
    });
    assert.deepEqual(
      target.read().value,
      { [standalone]: true },
      `${standalone} alone remains outside a bounded compound prohibition`,
    );
  }
});
