import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  loadOperateGovernedExecutionContract,
  OPERATE_GOVERNED_EFFECT_CLASSES_V2,
  OPERATE_GOVERNED_EXECUTION_CONTRACT_KINDS_V2,
  OPERATE_GOVERNED_OPERATION_STATES_V2,
  OPERATE_GOVERNED_POLICY_OUTCOMES_V2,
  OPERATE_GOVERNED_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2,
  validateProtocolArtifact,
} from 'planr-pipeline/protocol';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
const valid = fixture('governed-execution-contracts-valid.json');
const invalid = fixture('governed-execution-contracts-invalid.json');
const allContracts = fixture('all-contracts-valid.json');
const schema = (name) =>
  JSON.parse(
    readFileSync(new URL(`../../schemas/v2.0.0/${name}.schema.json`, import.meta.url), 'utf8'),
  );
const registry = JSON.parse(
  readFileSync(new URL('../../registry/operate-v2-contracts.json', import.meta.url), 'utf8'),
);

test('Phase 6 publishes one exact closed governed-execution contract family', () => {
  assert.equal(OPERATE_GOVERNED_EXECUTION_CONTRACT_KINDS_V2.length, 13);
  assert.deepEqual(
    Object.keys(valid).sort(),
    [...OPERATE_GOVERNED_EXECUTION_CONTRACT_KINDS_V2].sort(),
  );
  assert.deepEqual(OPERATE_GOVERNED_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2, [
    'operate-capability-provider-registration',
    'operate-executor-registration',
    'operate-policy-provider-registration',
  ]);
  assert.deepEqual(OPERATE_GOVERNED_EFFECT_CLASSES_V2, [
    'read-only',
    'machine-local-write',
    'project-write',
    'provider-call',
    'external-effect',
    'destructive',
  ]);
  assert.deepEqual(OPERATE_GOVERNED_POLICY_OUTCOMES_V2, [
    'automatic',
    'deferred',
    'named-multi-party',
    'named-single-party',
    'prohibited',
    'rejected',
    'threshold',
  ]);
  assert.equal(OPERATE_GOVERNED_OPERATION_STATES_V2.length, 10);
  for (const kind of OPERATE_GOVERNED_EXECUTION_CONTRACT_KINDS_V2) {
    assert.equal(
      loadOperateGovernedExecutionContract(kind, { protocolVersion: '2.0.0' }).kind,
      kind,
    );
    assert.deepEqual(
      validateProtocolArtifact(kind, valid[kind], { protocolVersion: '2.0.0' }),
      [],
      kind,
    );
    const candidate = structuredClone(valid[kind]);
    Object.assign(candidate, invalid[kind].patch);
    assert.ok(
      validateProtocolArtifact(kind, candidate, { protocolVersion: '2.0.0' }).length > 0,
      `${kind} negative fixture`,
    );
  }
});

test('authority records bind one exact action revision, target, capability, policy and operation', () => {
  const evaluation = valid['operating-policy-evaluation'];
  const grant = valid['operating-capability-grant'];
  const operation = valid['operating-governed-operation'];
  assert.deepEqual(evaluation.action, grant.action);
  assert.deepEqual(grant.action, operation.action);
  assert.deepEqual(evaluation.target, grant.target);
  assert.deepEqual(grant.target, operation.target);
  assert.deepEqual(evaluation.capability, grant.capability);
  assert.equal(grant.operationId, operation.operationId);
  assert.equal(grant.useLimit, 1);
});

test('an Action carries either no Phase 6 bindings or the complete exact governed tuple', () => {
  const historical = structuredClone(allContracts['operating-action']);
  const bindings = {
    revisionId: 'actrev_00000001',
    revision: 1,
    predecessorRevisionId: null,
    actionHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    actionKind: { id: 'operating-hypothesis', version: '1.0.0' },
    requestedCapability: { id: 'bounded-project-write', version: '1.0.0' },
    targetBinding: { kind: 'project-record', id: 'retention-plan', revision: 'rev-0001' },
    effectClass: 'project-write',
    preconditionArtifactIds: ['art_00000001'],
    executionBinding: {
      policyId: 'bounded-project-write-policy',
      policyVersion: '1.0.0',
      rollbackRequired: true,
      verificationRequired: true,
    },
  };
  assert.deepEqual(
    validateProtocolArtifact('operating-action', historical, { protocolVersion: '2.0.0' }),
    [],
    'historical Phase 5 Action',
  );
  const complete = { ...historical, ...bindings };
  assert.deepEqual(
    validateProtocolArtifact('operating-action', complete, { protocolVersion: '2.0.0' }),
    [],
    'complete Phase 6 Action',
  );

  for (const [field, value] of Object.entries(bindings)) {
    assert.ok(
      validateProtocolArtifact(
        'operating-action',
        { ...historical, [field]: value },
        {
          protocolVersion: '2.0.0',
        },
      ).length > 0,
      `${field}: singleton rejected`,
    );
    const partial = structuredClone(complete);
    delete partial[field];
    assert.ok(
      validateProtocolArtifact('operating-action', partial, {
        protocolVersion: '2.0.0',
      }).length > 0,
      `${field}: missing from otherwise complete tuple`,
    );
  }
});

test('governed tools accept no caller authority or request fingerprint', () => {
  const action = valid['operating-governed-operation'].action;
  const requests = [
    ['operate.action.execute', { action }],
    [
      'operate.action.rollback',
      { action, originalOperationId: 'op_00000001', rollbackPlanId: 'rbp_00000001' },
    ],
  ];
  const forbidden = [
    [
      'requestFingerprint',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ],
    ['grantId', 'cgr_caller'],
    ['approvalIds', ['aprv_caller']],
    ['executorId', 'caller-executor'],
    ['idempotencyKey', 'caller-key'],
    ['credential', 'secret'],
  ];
  for (const [operation, request] of requests) {
    const toolCall = {
      kind: 'operate-tool-call',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      direction: 'request',
      operation,
      request,
    };
    const allowedAction = {
      tool: operation,
      arguments: request,
      label: operation,
      effect: 'project-write',
    };
    assert.deepEqual(
      validateProtocolArtifact('operate-tool-call', toolCall, { protocolVersion: '2.0.0' }),
      [],
      `${operation}: tool call`,
    );
    assert.deepEqual(
      validateProtocolArtifact('operate-allowed-action', allowedAction, {
        protocolVersion: '2.0.0',
      }),
      [],
      `${operation}: allowed action`,
    );
    for (const [field, value] of forbidden) {
      const unsafeToolCall = structuredClone(toolCall);
      unsafeToolCall.request[field] = value;
      assert.ok(
        validateProtocolArtifact('operate-tool-call', unsafeToolCall, { protocolVersion: '2.0.0' })
          .length > 0,
        `${operation}:${field}:tool`,
      );
      const unsafeAllowedAction = structuredClone(allowedAction);
      unsafeAllowedAction.arguments[field] = value;
      assert.ok(
        validateProtocolArtifact('operate-allowed-action', unsafeAllowedAction, {
          protocolVersion: '2.0.0',
        }).length > 0,
        `${operation}:${field}:allowed-action`,
      );
    }
  }
});

test('the public declaration exposes every governed schema surface without caller fingerprint input', () => {
  const declaration = readFileSync(
    new URL('../../lib/protocol/index.d.ts', import.meta.url),
    'utf8',
  );
  const eventTypes = [
    'policy.evaluated',
    'approval.recorded',
    'capability.availability-recorded',
    'capability.granted',
    'operation.intent-recorded',
    'execution.result-recorded',
    'rollback.plan-recorded',
    'rollback.result-recorded',
  ];
  const eventPayloads = [
    'OperatingPolicyEvaluationV2',
    'OperatingApprovalRecordV2',
    'OperatingCapabilityAvailabilityV2',
    'OperatingCapabilityGrantV2',
    null,
    null,
    'OperatingRollbackPlanV2',
    'OperatingRollbackResultV2',
  ];
  for (const [index, eventType] of eventTypes.entries()) {
    assert.ok(declaration.includes(`| '${eventType}'`), `${eventType}: event type`);
    assert.ok(
      declaration.includes(
        eventPayloads[index] === null
          ? `'${eventType}': {`
          : `'${eventType}': ${eventPayloads[index]};`,
      ),
      `${eventType}: payload map`,
    );
  }
  for (const snippet of [
    'operation: OperatingGovernedOperationV2;',
    'payload: { artifactId: string; contentHash: string };',
    'rollbackBaseline: { artifactId: string; contentHash: string } | null;',
    'targetBeforeHash: string;',
    'result: OperatingExecutionResultV2;',
    'receipt: OperatingExecutionReceiptProofV2 | null;',
    'export type OperatingActionAuthorityTupleV2 =',
    'revisionId?: never; revision?: never; predecessorRevisionId?: never; actionHash?: never;',
    'revisionId: string; revision: number; predecessorRevisionId: string | null; actionHash: string;',
    'export type OperatingActionV2 = OperatingActionV2Base & OperatingActionAuthorityTupleV2;',
    'export type OperatingAuthorityHistoryV2 =',
    'actionPolicies?: never; policyEvaluations?: never; approvalRequirements?: never;',
    'actionPolicies: OperatingActionPolicyV2[];',
    'operationReplayIndex: OperatingOperationReplayEntryV2[];',
    'export type OperatingRuntimeStateV2 = OperatingRuntimeStateV2Base & OperatingAuthorityHistoryV2;',
    'export type OperatingCheckpointAuthorityHashesV2 =',
    'operationReplayIndexHash?: never; authorityHistoryHash?: never',
    'operationReplayIndexHash: string; authorityHistoryHash: string',
    'export type OperatingCheckpointV2 = OperatingCheckpointV2Base & OperatingCheckpointAuthorityHashesV2;',
    'policyRequirements?: Array<{',
    'governedOperationId?: string | null;',
    'authorityRecordIds?: string[];',
    "export type OperatePolicyTierV2 = 'core' | 'project' | 'domain';",
    'supportedActionKinds: OperateVersionedIdentityV2[];',
    "onTimeout: 'fail-closed'",
    "keySource: 'runtime-derived-request-fingerprint'",
    'export type OperateGovernedReconciliationV2 =',
    "| { supported: false; mode: 'none' }",
    "| { supported: true; mode: 'deterministic' }",
    "source: 'built-in' | 'public-optional' | 'external'",
    'preconditionArtifactIds: string[];',
    "operationKind: 'execute'; requestFingerprint: string;",
    "operationKind: 'rollback'; requestFingerprint: string;",
    "'action.approved': OperatingActionApprovedPayloadV2;",
    "'action.cancelled': OperatingActionCancelledPayloadV2;",
    "'action.rejected': OperatingActionRejectedPayloadV2;",
    "'action.deferred': OperatingActionDeferredPayloadV2;",
    "'action.reopened': OperatingActionReopenedPayloadV2;",
    "'action.queued': OperatingActionQueuedPayloadV2;",
    "'action.started': OperatingActionStartedPayloadV2;",
    "'action.completed': OperatingActionCompletedPayloadV2;",
    "'action.blocked': OperatingActionBlockedPayloadV2;",
    "'cycle.approved': OperatingCycleApprovedPayloadV2;",
    "'cycle.executing': OperatingCycleExecutingPayloadV2;",
    "'cycle.verifying': OperatingCycleVerifyingPayloadV2;",
    "'cycle.closed': OperatingCycleClosedPayloadV2;",
    "OperatingActionTransitionPayloadV2<'proposed', 'approved'> & { operationId: null; resultId: null; reasonCode: null }",
    "OperatingActionTransitionPayloadV2<'proposed', 'rejected'> & { operationId: null; resultId: null; reasonCode: string }",
    "OperatingActionTransitionPayloadV2<'proposed', 'deferred'> & { operationId: null; resultId: null; reasonCode: string }",
    "OperatingActionTransitionPayloadV2<'deferred', 'proposed'> & { operationId: null; resultId: null; reasonCode: null }",
    "OperatingActionTransitionPayloadV2<'blocked', 'queued'>",
    "OperatingActionTransitionPayloadV2<'blocked', 'in_progress'>",
    "OperatingActionTransitionPayloadV2<'in_progress', 'completed'> & { operationId: string; resultId: string; reasonCode: null }",
    "OperatingActionTransitionPayloadV2<'queued' | 'in_progress', 'blocked'> & { operationId: string; resultId: string; reasonCode: string }",
    "OperatingCycleTransitionPayloadV2<'awaiting_review', 'approved'> & { actionId: null; operationId: null; resultId: null; reasonCode: null }",
    "OperatingCycleTransitionPayloadV2<'approved', 'executing'> & { actionId: string; operationId: string; resultId: null; reasonCode: null }",
    "OperatingCycleTransitionPayloadV2<'approved', 'verifying'>",
    "OperatingCycleTransitionPayloadV2<'approved', 'closed'>",
    'persistentWork: {',
    'ledger: OperatingWorkLedgerV2;',
    'cycleLinks: OperatingWorkCycleLinkV2[];',
    "effectClass: Exclude<OperateGovernedEffectClassV2, 'destructive'>; parties: Array<{ partyId: string; actorKind: 'human' | 'engine'; actorId: string | null;",
  ])
    assert.ok(declaration.includes(snippet), snippet);
  assert.ok(
    declaration.includes(
      "export type OperatingActionStateV2 = 'proposed' | 'approved' | 'queued' | 'in_progress' | 'completed' | 'blocked' | 'rejected' | 'deferred' | 'cancelled';",
    ),
  );
  const publicRequestMap =
    declaration.match(/export interface OperateToolRequestMapV2 \{([\s\S]*?)\n\}/u)?.[1] ?? '';
  assert.ok(
    publicRequestMap.includes("'operate.action.execute': { action: OperateActionIdentityV2 };"),
  );
  assert.ok(publicRequestMap.includes("'operate.action.rollback': {"));
  assert.doesNotMatch(publicRequestMap, /requestFingerprint/u);
});

test('public cycle view and approval declarations exactly match their closed schemas', () => {
  const declaration = readFileSync(
    new URL('../../lib/protocol/index.d.ts', import.meta.url),
    'utf8',
  );
  const cycleView =
    declaration.match(/export interface OperatingCycleViewV2 \{([\s\S]*?)\n\}/u)?.[1] ?? '';
  assert.match(
    cycleView,
    /persistentWork: \{\s+ledger: OperatingWorkLedgerV2;\s+cycleLinks: OperatingWorkCycleLinkV2\[\];\s+\};/u,
  );
  const requirement = structuredClone(valid['operating-approval-requirement']);
  requirement.parties[0].actorId = null;
  assert.deepEqual(
    validateProtocolArtifact('operating-approval-requirement', requirement, {
      protocolVersion: '2.0.0',
    }),
    [],
  );
  for (const kind of ['operating-approval-requirement', 'operating-approval-record']) {
    const destructive = { ...structuredClone(valid[kind]), effectClass: 'destructive' };
    assert.ok(
      validateProtocolArtifact(kind, destructive, { protocolVersion: '2.0.0' }).length > 0,
      `${kind}:destructive effect`,
    );
  }
  const recordWithNullActor = structuredClone(valid['operating-approval-record']);
  recordWithNullActor.actor.actorId = null;
  assert.ok(
    validateProtocolArtifact('operating-approval-record', recordWithNullActor, {
      protocolVersion: '2.0.0',
    }).length > 0,
    'an issued approval has an exact actor',
  );
});

test('the public guide lists the exact Phase 6 cycle, assignment, tool, and effect vocabulary', () => {
  const guide = readFileSync(
    new URL('../../docs/protocol/operate-runtime-v2.md', import.meta.url),
    'utf8',
  );
  assert.match(
    guide,
    /created \| observing \| advising \| challenging \| synthesizing \| awaiting_review\napproved \| executing \| verifying \| closed \| blocked \| failed \| cancelled/u,
  );
  assert.match(guide, /advisor \| challenger \| chair \| execution \| verification/u);
  const tools =
    guide
      .match(
        /The only trigger is `manual`\. The public tools are:\n\n```text\n([\s\S]*?)\n```/u,
      )?.[1]
      ?.split('\n') ?? [];
  assert.deepEqual(tools, [
    'operate.cycle.start',
    'operate.cycle.get',
    'operate.cycle.resume',
    'operate.assignment.claim',
    'operate.assignment.submit',
    'operate.artifact.get',
    'operate.review.get',
    'operate.review.submit',
    'operate.action.approve',
    'operate.action.execute',
    'operate.action.rollback',
  ]);
  assert.match(
    guide,
    /`read-only`,\n`machine-local-write`, `project-write`, `provider-call`, `external-effect`, and\n`destructive`/u,
  );
});

test('provider registrations are data-only, fail closed and cannot register destructive authority', () => {
  for (const kind of OPERATE_GOVERNED_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2) {
    const registration = valid[kind];
    for (const patch of [
      { modulePath: './provider.mjs' },
      { sourcePath: './provider.mjs' },
      { credential: 'secret' },
      { grantId: 'cgr_caller' },
      { approvalIds: ['aprv_caller'] },
      { effectCeiling: 'destructive' },
      { fallback: { kind: 'executor', errorCode: 'EXECUTOR_UNAVAILABLE' } },
    ]) {
      assert.ok(
        validateProtocolArtifact(
          kind,
          { ...structuredClone(registration), ...patch },
          { protocolVersion: '2.0.0' },
        ).length > 0,
        `${kind}:${Object.keys(patch)[0]}`,
      );
    }
  }
});

test('provider reconciliation is exactly false/none or true/deterministic', () => {
  const coherent = [
    { supported: false, mode: 'none' },
    { supported: true, mode: 'deterministic' },
  ];
  const contradictory = [
    { supported: false, mode: 'deterministic' },
    { supported: true, mode: 'none' },
  ];
  for (const kind of OPERATE_GOVERNED_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2) {
    for (const reconciliation of coherent) {
      const candidate = { ...structuredClone(valid[kind]), reconciliation };
      assert.deepEqual(
        validateProtocolArtifact(kind, candidate, { protocolVersion: '2.0.0' }),
        [],
        `${kind}:${JSON.stringify(reconciliation)}`,
      );
    }
    for (const reconciliation of contradictory) {
      const candidate = { ...structuredClone(valid[kind]), reconciliation };
      assert.ok(
        validateProtocolArtifact(kind, candidate, { protocolVersion: '2.0.0' }).length > 0,
        `${kind}:${JSON.stringify(reconciliation)}`,
      );
    }
  }
});

test('every governed contract fails closed when any schema-required authority binding is absent', () => {
  for (const kind of OPERATE_GOVERNED_EXECUTION_CONTRACT_KINDS_V2) {
    const required = schema(kind).required;
    for (const field of required) {
      const candidate = structuredClone(valid[kind]);
      delete candidate[field];
      assert.ok(
        validateProtocolArtifact(kind, candidate, { protocolVersion: '2.0.0' }).length > 0,
        `${kind}:${field}`,
      );
    }
  }
});

test('policy tier and precedence are immutable and lower tiers may only narrow', () => {
  for (const kind of ['operating-action-policy', 'operate-policy-provider-registration']) {
    const mismatch = structuredClone(valid[kind]);
    mismatch.tier = 'core';
    assert.ok(
      validateProtocolArtifact(kind, mismatch, { protocolVersion: '2.0.0' }).length > 0,
      `${kind}:core precedence mismatch`,
    );
    const widening = structuredClone(valid[kind]);
    widening.narrowingOnly = false;
    assert.ok(
      validateProtocolArtifact(kind, widening, { protocolVersion: '2.0.0' }).length > 0,
      `${kind}:domain widening`,
    );
  }
  const evaluation = structuredClone(valid['operating-policy-evaluation']);
  evaluation.policyTier = 'project';
  assert.ok(
    validateProtocolArtifact('operating-policy-evaluation', evaluation, {
      protocolVersion: '2.0.0',
    }).length > 0,
  );
});

test('governed operations and terminal results retain exact execute-versus-rollback bindings', () => {
  const execute = valid['operating-governed-operation'];
  const invalidRollback = { ...structuredClone(execute), operationKind: 'rollback' };
  assert.ok(
    validateProtocolArtifact('operating-governed-operation', invalidRollback, {
      protocolVersion: '2.0.0',
    }).length > 0,
  );
  const rollback = {
    ...structuredClone(execute),
    operationId: 'op_00000002',
    operationKind: 'rollback',
    rollbackPlanId: 'rbp_00000001',
    parentOperationId: 'op_00000001',
  };
  assert.deepEqual(
    validateProtocolArtifact('operating-governed-operation', rollback, {
      protocolVersion: '2.0.0',
    }),
    [],
  );
  const wrongExecutionKind = {
    ...structuredClone(valid['operating-execution-result']),
    operationKind: 'rollback',
  };
  assert.ok(
    validateProtocolArtifact('operating-execution-result', wrongExecutionKind, {
      protocolVersion: '2.0.0',
    }).length > 0,
  );
  const wrongRollbackKind = {
    ...structuredClone(valid['operating-rollback-result']),
    operationKind: 'execute',
  };
  assert.ok(
    validateProtocolArtifact('operating-rollback-result', wrongRollbackKind, {
      protocolVersion: '2.0.0',
    }).length > 0,
  );
});

test('every normative Phase 6 Action and Cycle edge has an independently specified strict Event payload', () => {
  const action = valid['operating-governed-operation'].action;
  const operationId = 'op_00000001';
  const resultId = 'xres_00000001';
  const actionEdge = (event, from, to, bindings) => ({
    entityId: 'operating-action',
    event,
    from,
    to,
    payload: { action, from, to, ...bindings },
  });
  const cycleEdge = (event, from, to, bindings) => ({
    entityId: 'operating-cycle',
    event,
    from,
    to,
    payload: { cycleId: 'cyc_00000001', from, to, ...bindings },
  });
  const edges = [
    actionEdge('action.approved', 'proposed', 'approved', {
      operationId: null,
      resultId: null,
      reasonCode: null,
    }),
    actionEdge('action.cancelled', 'approved', 'cancelled', {
      operationId: null,
      resultId: null,
      reasonCode: 'cancelled-before-dispatch',
    }),
    actionEdge('action.cancelled', 'queued', 'cancelled', {
      operationId,
      resultId: null,
      reasonCode: 'cancelled-while-queued',
    }),
    actionEdge('action.cancelled', 'in_progress', 'cancelled', {
      operationId,
      resultId: null,
      reasonCode: 'cancelled-in-progress',
    }),
    actionEdge('action.rejected', 'proposed', 'rejected', {
      operationId: null,
      resultId: null,
      reasonCode: 'policy-rejected',
    }),
    actionEdge('action.deferred', 'proposed', 'deferred', {
      operationId: null,
      resultId: null,
      reasonCode: 'approval-deferred',
    }),
    actionEdge('action.reopened', 'deferred', 'proposed', {
      operationId: null,
      resultId: null,
      reasonCode: null,
    }),
    actionEdge('action.queued', 'approved', 'queued', {
      operationId,
      resultId: null,
      reasonCode: null,
    }),
    actionEdge('action.queued', 'blocked', 'queued', {
      operationId,
      resultId,
      reasonCode: 'retry-queued',
    }),
    actionEdge('action.started', 'queued', 'in_progress', {
      operationId,
      resultId: null,
      reasonCode: null,
    }),
    actionEdge('action.started', 'blocked', 'in_progress', {
      operationId,
      resultId,
      reasonCode: 'reconciled-resume',
    }),
    actionEdge('action.completed', 'in_progress', 'completed', {
      operationId,
      resultId,
      reasonCode: null,
    }),
    actionEdge('action.blocked', 'queued', 'blocked', {
      operationId,
      resultId,
      reasonCode: 'dispatch-blocked',
    }),
    actionEdge('action.blocked', 'in_progress', 'blocked', {
      operationId,
      resultId,
      reasonCode: 'verification-blocked',
    }),
    cycleEdge('cycle.approved', 'awaiting_review', 'approved', {
      actionId: null,
      operationId: null,
      resultId: null,
      reasonCode: null,
    }),
    cycleEdge('cycle.executing', 'approved', 'executing', {
      actionId: action.actionId,
      operationId,
      resultId: null,
      reasonCode: null,
    }),
    cycleEdge('cycle.verifying', 'executing', 'verifying', {
      actionId: action.actionId,
      operationId,
      resultId,
      reasonCode: null,
    }),
    cycleEdge('cycle.verifying', 'approved', 'verifying', {
      actionId: action.actionId,
      operationId: null,
      resultId: null,
      reasonCode: 'execution-not-required',
    }),
    cycleEdge('cycle.closed', 'verifying', 'closed', {
      actionId: action.actionId,
      operationId,
      resultId,
      reasonCode: null,
    }),
    cycleEdge('cycle.closed', 'approved', 'closed', {
      actionId: null,
      operationId: null,
      resultId: null,
      reasonCode: 'no-execution-or-verification',
    }),
  ];
  const expectedRegistryEdges = edges
    .map(({ entityId, event, from, to }) => `${entityId}:${from}:${to}:${event}`)
    .sort();
  const registeredEdges = registry.transitions
    .filter(({ event }) => event.startsWith('action.') || event.startsWith('cycle.'))
    .map(({ entityId, event, from, to }) => `${entityId}:${from}:${to}:${event}`)
    .sort();
  assert.deepEqual(
    registeredEdges,
    expectedRegistryEdges,
    'registry matches the independent normative edge matrix',
  );

  let sequence = 100;
  for (const { entityId, event: type, from, payload } of edges) {
    const event = {
      ...structuredClone(allContracts['operating-event']),
      eventId: `evt_phase6_${sequence}`,
      sequence: sequence++,
      type,
      entityId: entityId === 'operating-action' ? action.actionId : 'cyc_00000001',
      payload,
    };
    const edgeLabel = `${type}:${payload.from}->${payload.to}`;
    assert.deepEqual(
      validateProtocolArtifact('operating-event', event, { protocolVersion: '2.0.0' }),
      [],
      edgeLabel,
    );
    const fields =
      entityId === 'operating-action'
        ? ['action', 'from', 'to', 'operationId', 'resultId', 'reasonCode']
        : ['cycleId', 'from', 'to', 'actionId', 'operationId', 'resultId', 'reasonCode'];
    for (const field of fields) {
      const missing = structuredClone(event);
      delete missing.payload[field];
      assert.ok(
        validateProtocolArtifact('operating-event', missing, { protocolVersion: '2.0.0' }).length >
          0,
        `${edgeLabel}:missing ${field}`,
      );
    }
    const mutations =
      entityId === 'operating-action'
        ? {
            action: { ...payload.action, revision: 0 },
            from: 'completed',
            to: from,
            operationId: payload.operationId === null ? operationId : null,
            resultId: payload.resultId === null ? resultId : null,
            reasonCode: payload.reasonCode === null ? 'unexpected-reason' : null,
          }
        : {
            cycleId: '',
            from: 'closed',
            to: from,
            actionId: payload.actionId === null ? action.actionId : null,
            operationId: payload.operationId === null ? operationId : null,
            resultId: payload.resultId === null ? resultId : null,
            reasonCode:
              type === 'cycle.closed' && from === 'verifying'
                ? 42
                : payload.reasonCode === null
                  ? 'unexpected-reason'
                  : null,
          };
    for (const [field, value] of Object.entries(mutations)) {
      const wrong = structuredClone(event);
      wrong.payload[field] = value;
      assert.ok(
        validateProtocolArtifact('operating-event', wrong, { protocolVersion: '2.0.0' }).length > 0,
        `${edgeLabel}:wrong ${field}`,
      );
    }
  }

  const approvedDeferred = {
    ...structuredClone(allContracts['operating-event']),
    eventId: 'evt_phase6_approved_deferred',
    sequence: sequence++,
    type: 'action.deferred',
    entityId: action.actionId,
    payload: {
      action,
      from: 'approved',
      to: 'deferred',
      operationId: null,
      resultId: null,
      reasonCode: 'execution-deferred',
    },
  };
  assert.ok(
    validateProtocolArtifact('operating-event', approvedDeferred, { protocolVersion: '2.0.0' })
      .length > 0,
    'approved->deferred remains review.submitted, not action.deferred',
  );
});

test('Phase 6 runtime authority history and checkpoint hashes are atomically present or absent', () => {
  const historicalState = structuredClone(allContracts['operating-runtime-state']);
  assert.deepEqual(
    validateProtocolArtifact('operating-runtime-state', historicalState, {
      protocolVersion: '2.0.0',
    }),
    [],
  );
  const authorityHistory = {
    actionPolicies: [valid['operating-action-policy']],
    policyEvaluations: [valid['operating-policy-evaluation']],
    approvalRequirements: [valid['operating-approval-requirement']],
    approvalRecords: [valid['operating-approval-record']],
    capabilityAvailability: [valid['operating-capability-availability']],
    capabilityGrants: [valid['operating-capability-grant']],
    governedOperations: [valid['operating-governed-operation']],
    executionResults: [valid['operating-execution-result']],
    rollbackPlans: [valid['operating-rollback-plan']],
    rollbackResults: [valid['operating-rollback-result']],
    operationReplayIndex: [
      {
        operationId: 'op_00000001',
        operationKind: 'execute',
        requestFingerprint:
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        actionId: 'act_00000001',
        actionRevision: 1,
        actionHash: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
        intentEventId: 'evt_00000001',
        operationHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        payloadArtifactId: 'art_00000002',
        payloadHash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        baselineArtifactId: 'art_00000003',
        baselineHash: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        targetBeforeHash: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        reservedResultId: 'xres_00000001',
        reservedResultArtifactId: 'art_00000004',
        reservedSubmissionId: 'sub_00000001',
        reservedTerminalEventIds: {
          submitted: 'evt_submitted00000001',
          artifactCreated: 'evt_artifact00000001',
          validated: 'evt_validated00000001',
          resultRecorded: 'evt_result00000001',
        },
        reservedUncertaintyResultId: 'xres_uncertain00000001',
        reservedUncertaintyResultArtifactId: 'art_uncertain00000001',
        reservedUncertaintySubmissionId: 'sub_uncertain00000001',
        reservedUncertaintyTerminalEventIds: {
          submitted: 'evt_uncertain_submitted00000001',
          artifactCreated: 'evt_uncertain_artifact00000001',
          validated: 'evt_uncertain_validated00000001',
          resultRecorded: 'evt_uncertain_result00000001',
        },
        reservedCompletedAt: '2026-08-10T08:02:00Z',
        reservedCorrelationId: 'corr-operate-00000001',
        terminalResultId: 'xres_00000001',
        terminalReceipt: null,
      },
    ],
  };
  const complete = { ...historicalState, ...authorityHistory };
  assert.deepEqual(
    validateProtocolArtifact('operating-runtime-state', complete, { protocolVersion: '2.0.0' }),
    [],
  );
  for (const [field, value] of Object.entries(authorityHistory)) {
    assert.ok(
      validateProtocolArtifact(
        'operating-runtime-state',
        { ...historicalState, [field]: value },
        { protocolVersion: '2.0.0' },
      ).length > 0,
      `${field}:singleton`,
    );
    const partial = structuredClone(complete);
    delete partial[field];
    assert.ok(
      validateProtocolArtifact('operating-runtime-state', partial, { protocolVersion: '2.0.0' })
        .length > 0,
      `${field}:missing`,
    );
  }

  const checkpoint = structuredClone(allContracts['operating-checkpoint']);
  const hash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assert.deepEqual(
    validateProtocolArtifact('operating-checkpoint', checkpoint, { protocolVersion: '2.0.0' }),
    [],
  );
  assert.deepEqual(
    validateProtocolArtifact(
      'operating-checkpoint',
      { ...checkpoint, operationReplayIndexHash: hash, authorityHistoryHash: hash },
      { protocolVersion: '2.0.0' },
    ),
    [],
  );
  assert.ok(
    validateProtocolArtifact(
      'operating-checkpoint',
      { ...checkpoint, operationReplayIndexHash: hash },
      { protocolVersion: '2.0.0' },
    ).length > 0,
  );
  assert.ok(
    validateProtocolArtifact(
      'operating-checkpoint',
      { ...checkpoint, authorityHistoryHash: hash },
      { protocolVersion: '2.0.0' },
    ).length > 0,
  );
});

test('API envelope and declaration expose exactly the registry-owned 56 error codes', () => {
  const expected = registry.errors.map(({ code }) => code);
  assert.equal(expected.length, 56);
  assert.deepEqual(schema('operate-api-envelope').$defs.error.properties.code.enum, expected);
  const declaration = readFileSync(
    new URL('../../lib/protocol/index.d.ts', import.meta.url),
    'utf8',
  );
  const block = declaration.match(/export type OperateErrorCodeV2 =([\s\S]*?);/u)?.[1] ?? '';
  const declared = [...block.matchAll(/'([A-Z][A-Z0-9_]*)'/gu)].map((match) => match[1]);
  assert.deepEqual(declared, expected);
});
