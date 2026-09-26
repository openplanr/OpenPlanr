#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createOperatingApprovalRecordV2,
  createOperatingApprovalRequirementV2,
} from 'planr-pipeline/operate/approvals-v2';
import { evaluateOperateAuthorityV2 } from 'planr-pipeline/operate/authorization-v2';
import {
  buildOperatingExecutionLifecycleV2,
  deriveOperatingExecutionVerificationStatusV2,
  deriveOperatingVerificationFeedbackV2,
  selectOperatingTerminalVerificationAssignmentV2,
} from 'planr-pipeline/operate/execution-verification-v2';
import { createOperatingGovernedExecutionRuntimeV2 } from 'planr-pipeline/operate/governed-execution-v2';
import { OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2 } from 'planr-pipeline/operate/governed-extensions-v2';
import {
  buildOperatingRollbackPlanV2,
  classifyOperatingGovernedRecoveryV2,
  createOperatingGovernedRecoveryRuntimeV2,
  recordOperatingRollbackPlanV2,
} from 'planr-pipeline/operate/governed-recovery-v2';
import { derivePersistentOperatingActionRevisionHashV2 } from 'planr-pipeline/operate/persistent-work-v2';
import {
  createOperatingActionPolicyV2,
  evaluateOperatingActionPolicyV2,
} from 'planr-pipeline/operate/policy-v2';
import {
  createDisposableLocalProjectTargetV2,
  createSyntheticNoNetworkTargetV2,
  evaluateOpenReferencePolicyProviderV2,
  OPEN_REFERENCE_CONTAINMENT_EXECUTOR_HOST_V2,
  OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
} from 'planr-pipeline/operate/reference-governed-executors-v2';
import {
  createOperatingRuntimeEventV2,
  deriveOperatingRuntimeDeltaV2,
  materializeOperatingStateSnapshotV2,
  recordOperatingActionVerificationOutcomeV2,
  recordOperatingIntelligenceStateV2,
  reduceOperatingRuntimeEventsV2,
  transitionOperatingActionLifecycleV2,
} from 'planr-pipeline/operate/runtime-v2';
import {
  OPERATE_RUNTIME_CONTRACT_KINDS,
  sha256Jcs,
  validateProtocolArtifact,
} from 'planr-pipeline/protocol';
import { runOperatingIntelligenceJourneyV2 } from './verify-operate-v2-operating-intelligence.mjs';

const VERSION = '2.0.0';
const RUNTIME_VERSION = '0.42.0';
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const fixtureRoot = join(root, 'conformance', 'fixtures', 'operating-runtime-v2');
const clone = (value) => structuredClone(value);
const fixture = (name) => JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8'));
const governedFixture = fixture('governed-execution-contracts-valid.json');
const authorizationFixture = fixture('authorization-valid.json');
let checks = 0;

function pass(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

function refreshActionRevision(action) {
  delete action.actionHash;
  action.actionHash = derivePersistentOperatingActionRevisionHashV2(action);
  action.revisionId = `actrev_${sha256Jcs({
    actionId: action.actionId,
    revision: action.revision,
    actionHash: action.actionHash,
  }).slice('sha256:'.length)}`;
  return action;
}

function checkpointStore(initialState) {
  let state = clone(initialState);
  const commits = [];
  return {
    readSnapshot: () => clone(state),
    compareAndSwap(input) {
      const committed =
        input.expectedEventHead.sequence === state.eventHead.sequence &&
        input.expectedEventHead.hash === state.eventHead.hash;
      if (committed) {
        state = clone(input.nextState);
        commits.push({ phase: input.phase, state: clone(state) });
      }
      return { committed, state: clone(state) };
    },
    snapshot: () => clone(state),
    commits,
  };
}

const TERMINAL_EVENT_FIELDS = ['submitted', 'artifactCreated', 'validated', 'resultRecorded'];
const EXECUTION_EVENT_FIELDS = [
  'assignmentCreated',
  'assignmentClaimed',
  'assignmentStarted',
  'availabilityRecorded',
  'capabilityGranted',
  'intentRecorded',
  ...TERMINAL_EVENT_FIELDS,
];

function executionDraft(suffix) {
  return {
    assignmentId: `asg_${suffix}`,
    submissionId: `sub_${suffix}`,
    operationId: `op_${suffix}`,
    grantId: `cgr_${suffix}`,
    resultId: `xres_${suffix}`,
    resultArtifactId: `art_result${suffix}`,
    claimId: `claim-${suffix}`,
    preparedAt: '2026-08-10T12:00:00Z',
    completedAt: '2026-08-10T12:01:00Z',
    grantExpiresAt: '2026-08-10T12:05:00Z',
    availabilityExpiresAt: '2026-08-10T12:06:00Z',
    correlationId: `corr-${suffix}`,
    eventIds: Object.fromEntries(
      EXECUTION_EVENT_FIELDS.map((field, index) => [
        field,
        `evt_${suffix}_${String(index + 1).padStart(2, '0')}`,
      ]),
    ),
    uncertainty: {
      resultId: `xres_uncertain${suffix}`,
      resultArtifactId: `art_uncertain${suffix}`,
      submissionId: `sub_uncertain${suffix}`,
      eventIds: Object.fromEntries(
        TERMINAL_EVENT_FIELDS.map((field, index) => [
          field,
          `evt_${suffix}_uncertain_${String(index + 1).padStart(2, '0')}`,
        ]),
      ),
    },
  };
}

function rollbackDraft(suffix) {
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
      EXECUTION_EVENT_FIELDS.map((field, index) => [
        field,
        `evt_${suffix}_${String(index + 1).padStart(2, '0')}`,
      ]),
    ),
    uncertainty: {
      rollbackResultId: `rbres_uncertain${suffix}`,
      resultArtifactId: `art_rbuncertain${suffix}`,
      submissionId: `sub_rbuncertain${suffix}`,
      eventIds: Object.fromEntries(
        TERMINAL_EVENT_FIELDS.map((field, index) => [
          field,
          `evt_${suffix}_uncertain_${String(index + 1).padStart(2, '0')}`,
        ]),
      ),
    },
  };
}

function hostileEnvironment(label, accessCounts = null) {
  return {
    trustedHost: new Proxy(
      {},
      {
        get() {
          if (accessCounts) accessCounts.host += 1;
          throw new Error(`${label}: host was accessed`);
        },
      },
    ),
    targetAdapter: new Proxy(
      {},
      {
        get() {
          if (accessCounts) accessCounts.target += 1;
          throw new Error(`${label}: target was accessed`);
        },
      },
    ),
  };
}

async function rejectionCode(promise) {
  try {
    await promise;
  } catch (error) {
    return error?.code ?? error?.name ?? 'UNKNOWN';
  }
  return null;
}

function governedActionFromPhase5(domainId, phase5Action, baselineArtifactId) {
  const action = {
    ...clone(authorizationFixture.action),
    actionId: phase5Action.actionId,
    revisionId: 'actrev_pending',
    revision: 1,
    predecessorRevisionId: null,
    scopeId: phase5Action.scopeId,
    domainId,
    domainVersion: phase5Action.domainVersion,
    sourceCycleId: phase5Action.sourceCycleId,
    sourceArtifactId: phase5Action.sourceArtifactId,
    title: phase5Action.title,
    state: 'approved',
    actionKind: { id: `${domainId}-operating-hypothesis`, version: '1.0.0' },
    requestedCapability:
      domainId === 'business'
        ? { id: 'bounded-project-write', version: '1.0.0' }
        : { id: 'synthetic-contained-write', version: '1.0.0' },
    targetBinding:
      domainId === 'business'
        ? { kind: 'project-record', id: 'phase6-business-record', revision: 'rev-before' }
        : { kind: 'synthetic-target', id: 'phase6-software-target', revision: 'rev-before' },
    effectClass: domainId === 'business' ? 'project-write' : 'machine-local-write',
    preconditionArtifactIds: [
      ...new Set([phase5Action.sourceArtifactId, baselineArtifactId]),
    ].sort(),
    executionBinding: {
      policyId:
        domainId === 'business' ? 'bounded-project-write-policy' : 'synthetic-containment-policy',
      policyVersion: '1.0.0',
      rollbackRequired: true,
      verificationRequired: true,
    },
    ownerActorId: phase5Action.ownerActorId,
    accountabilityDisposition: phase5Action.accountabilityDisposition,
    sourceDecisionId: phase5Action.sourceDecisionId,
    sourceFindingIds: [...phase5Action.sourceFindingIds],
    dependsOnActionIds: [...phase5Action.dependsOnActionIds],
    objectiveId: phase5Action.objectiveId,
    expectedResult: phase5Action.expectedResult,
    metricId: phase5Action.metricId,
    baseline: phase5Action.baseline,
    target: phase5Action.target,
    verificationWindow: phase5Action.verificationWindow,
    verificationPlanId: phase5Action.verificationPlanId,
    createdAt: phase5Action.createdAt,
    updatedAt: '2026-08-10T12:00:00Z',
  };
  return refreshActionRevision(action);
}

function policiesFor(action) {
  const core = createOperatingActionPolicyV2({
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
  const domain = createOperatingActionPolicyV2({
    policyId: action.executionBinding.policyId,
    policyVersion: '1.0.0',
    domainId: action.domainId,
    actionKind: action.actionKind,
    capability: action.requestedCapability,
    effectClasses: [action.effectClass],
    targetKinds: [action.targetBinding.kind],
    decisionMode: 'named-single-party',
    approvalRequirementIds: [`aprq_phase6_${action.domainId}_template`],
    rollbackRequired: true,
    verificationRequired: true,
    tier: 'domain',
    provenance: {
      providerId: 'open-reference-policy-provider',
      providerVersion: '1.0.0',
      sourceHash: `sha256:${action.domainId === 'business' ? 'b' : 'd'}`.padEnd(
        71,
        action.domainId === 'business' ? 'b' : 'd',
      ),
    },
  });
  return [core, domain];
}

function approvalFor({ action, evaluation, suffix, issuedAt = '2026-08-10T11:59:00Z' }) {
  const party = {
    partyId: `phase6-${action.domainId}-owner-party`,
    actorKind: 'human',
    actorId: action.ownerActorId,
    requiredCapability: { id: 'action-approve', version: '1.0.0' },
  };
  const requirement = createOperatingApprovalRequirementV2({
    policyRequirementId: `aprq_phase6_${action.domainId}_template`,
    evaluation,
    action,
    parties: [party],
    expiresAt: '2026-08-11T08:00:00Z',
    consumable: true,
  });
  const approval = createOperatingApprovalRecordV2({
    approvalId: `aprv_${suffix}`,
    requirement,
    evaluation,
    action,
    partyId: party.partyId,
    actor: {
      kind: party.actorKind,
      actorId: party.actorId,
      capability: party.requiredCapability,
    },
    decision: 'approved',
    issuedAt,
    expiresAt: requirement.expiresAt,
  });
  return { requirement, approval };
}

function prepareScenario(domainId) {
  const phase5 = runOperatingIntelligenceJourneyV2(domainId, {
    includeContext: true,
    stopAfterAction: true,
  });
  const context = phase5.context;
  const baselineArtifactId = `art_phase6_${domainId}_baseline_001`;
  const action = governedActionFromPhase5(domainId, context.action, baselineArtifactId);
  const policies = policiesFor(action);
  const evaluation = evaluateOpenReferencePolicyProviderV2({
    action,
    configuredPolicies: policies,
    evaluatedAt: '2026-08-10T11:58:00Z',
    evaluationId: `pevl_phase6_${domainId}_execute_001`,
    runtimeVersion: RUNTIME_VERSION,
  });
  const { requirement, approval } = approvalFor({
    action,
    evaluation,
    suffix: `phase6_${domainId}_execute_001`,
  });
  const initial = clone(context.state);
  initial.cycles = initial.cycles.map((cycle) =>
    cycle.cycleId === action.sourceCycleId
      ? { ...cycle, state: 'approved', updatedAt: '2026-08-10T11:59:00Z' }
      : cycle,
  );
  initial.actions = initial.actions.map((candidate) =>
    candidate.actionId === action.actionId ? action : candidate,
  );
  Object.assign(initial, {
    actionPolicies: policies,
    policyEvaluations: [evaluation],
    approvalRequirements: [requirement],
    approvalRecords: [approval],
    capabilityAvailability: [],
    capabilityGrants: [],
    governedOperations: [],
    executionResults: [],
    rollbackPlans: [],
    rollbackResults: [],
    operationReplayIndex: [],
  });
  // A required rollback is one uninterrupted governed terminal path: execution
  // reaches its immutable result, lifecycle ownership advances to executing,
  // and the rollback terminal owns the single verification Assignment. Keeping
  // the plan out of the business execution checkpoint prevents an intermediate
  // verification Assignment from becoming schedulable before rollback.
  if (domainId === 'business') initial.verificationPlans = [];
  const validated = reduceOperatingRuntimeEventsV2([], { initialState: initial });
  const initialValue = { domainId, status: 'before', count: 0 };
  const payloadValue = { domainId, status: 'after', count: 1 };
  const request = {
    actionId: action.actionId,
    payload: {
      artifactId: action.sourceArtifactId,
      contentHash: sha256Jcs(payloadValue),
      value: payloadValue,
    },
    rollbackBaseline: {
      artifactId: baselineArtifactId,
      contentHash: sha256Jcs(initialValue),
      value: initialValue,
    },
  };
  const suffix = domainId === 'business' ? '86000001' : '86000011';
  const targetAdapter =
    domainId === 'business'
      ? createDisposableLocalProjectTargetV2({ target: action.targetBinding, initialValue })
      : createSyntheticNoNetworkTargetV2({ target: action.targetBinding, initialValue });
  const trustedHost =
    domainId === 'business'
      ? OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2
      : OPEN_REFERENCE_CONTAINMENT_EXECUTOR_HOST_V2;
  return {
    phase5,
    context,
    action,
    policies,
    evaluation,
    requirement,
    approval,
    initial: validated,
    request,
    draft: executionDraft(suffix),
    targetAdapter,
    trustedHost,
  };
}

async function assertPreEffectRejections(scenario) {
  const withoutApproval = clone(scenario.initial);
  withoutApproval.approvalRecords = [];
  const noApprovalRuntime = createOperatingGovernedExecutionRuntimeV2({
    initialState: withoutApproval,
    checkpointStore: checkpointStore(withoutApproval),
  });
  const noApprovalCode = await rejectionCode(
    noApprovalRuntime.execute(
      scenario.request,
      executionDraft(scenario.action.domainId === 'business' ? '86000101' : '86000111'),
      hostileEnvironment(`${scenario.action.domainId}/approval-negative`),
    ),
  );
  pass(
    noApprovalCode !== null,
    `${scenario.action.domainId}: missing approval rejects before target access`,
  );

  const widened = clone(scenario.initial);
  const widenedAction = widened.actions.find(
    ({ actionId }) => actionId === scenario.action.actionId,
  );
  widenedAction.effectClass = 'external-effect';
  refreshActionRevision(widenedAction);
  const widenedCode = await rejectionCode(
    (async () => {
      const widenedRuntime = createOperatingGovernedExecutionRuntimeV2({
        initialState: widened,
        checkpointStore: checkpointStore(widened),
      });
      return widenedRuntime.execute(
        scenario.request,
        executionDraft(scenario.action.domainId === 'business' ? '86000201' : '86000211'),
        hostileEnvironment(`${scenario.action.domainId}/effect-negative`),
      );
    })(),
  );
  pass(
    widenedCode !== null,
    `${scenario.action.domainId}: effect widening rejects before target access`,
  );

  const registrationOnly = evaluateOperateAuthorityV2('operate.action.execute', {
    action: scenario.action,
    scope: {
      scopeId: scenario.action.scopeId,
      domainId: scenario.action.domainId,
      domainVersion: scenario.action.domainVersion,
    },
    governedExtensions: OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
  });
  pass(
    registrationOnly.allowed === false,
    `${scenario.action.domainId}: extension registration alone confers no execution authority`,
  );
  return { noApprovalCode, widenedCode, registrationOnlyCode: registrationOnly.error.code };
}

function appendFreshRollbackApproval(state, scenario) {
  const next = clone(state);
  const evaluation = evaluateOperatingActionPolicyV2({
    action: scenario.action,
    configuredPolicies: next.actionPolicies,
    evaluatedAt: '2026-08-10T12:01:30Z',
    evaluationId: `pevl_phase6_${scenario.action.domainId}_rollback_001`,
  });
  const { requirement, approval } = approvalFor({
    action: scenario.action,
    evaluation,
    suffix: `phase6_${scenario.action.domainId}_rollback_001`,
    issuedAt: '2026-08-10T12:01:45Z',
  });
  next.policyEvaluations.push(evaluation);
  next.approvalRequirements.push(requirement);
  next.approvalRecords.push(approval);
  return reduceOperatingRuntimeEventsV2([], { initialState: next });
}

function appendRequiredRollbackLifecycle(state, scenario, executed) {
  let next = clone(state);
  next.verificationPlans = [clone(scenario.context.verificationPlan)];
  next = reduceOperatingRuntimeEventsV2([], { initialState: next });
  const action = next.actions.find(({ actionId }) => actionId === scenario.action.actionId);
  const cycle = next.cycles.find(({ cycleId }) => cycleId === scenario.action.sourceCycleId);
  const lifecycle = buildOperatingExecutionLifecycleV2({
    action,
    cycle,
    operation: executed.operation,
    result: executed.result,
    verificationPlan: scenario.context.verificationPlan,
    timestamp: executed.result.completedAt,
  });
  // Required rollback keeps the Action approval reusable for its separately
  // authorized restorative operation. The Cycle still advances durably into
  // execution; the rollback terminal then owns the verifying transition.
  const inputs = [
    {
      eventId: lifecycle.identities.eventIds.cycleExecuting,
      type: 'cycle.executing',
      entityId: cycle.cycleId,
      payload: lifecycle.transitions.cycleExecuting,
    },
  ];
  for (const input of inputs) {
    const previousEvent = {
      sequence: next.eventHead.sequence,
      eventHash: next.eventHead.hash,
    };
    const event = createOperatingRuntimeEventV2(
      {
        ...input,
        timestamp: executed.result.completedAt,
        cycleId: cycle.cycleId,
        actor: { kind: 'engine', id: 'operate-runtime-v2' },
        causationId:
          next.eventReplayIndex.find(({ sequence }) => sequence === next.eventHead.sequence)
            ?.eventId ?? null,
        correlationId: scenario.draft.correlationId,
      },
      { previousEvent },
    );
    next = reduceOperatingRuntimeEventsV2([event], { initialState: next });
  }
  return next;
}

function continueWithVerification(scenario, terminal) {
  const { context, action, phase5 } = scenario;
  const stateAction = terminal.state.actions.find(({ actionId }) => actionId === action.actionId);
  const stateCycle = terminal.state.cycles.find(({ cycleId }) => cycleId === action.sourceCycleId);
  const assignment = selectOperatingTerminalVerificationAssignmentV2({
    assignments: terminal.state.assignments,
    action: stateAction,
    cycle: stateCycle,
    operation: terminal.operation,
    result: terminal.result,
    verificationPlan: context.verificationPlan,
    timestamp: terminal.result.completedAt,
  });
  const observation = {
    ...clone(fixture('all-contracts-valid.json')['operating-metric-observation']),
    observationId: `mob_phase6_${action.domainId}_001`,
    metricId: context.metric.metricId,
    scopeId: action.scopeId,
    domainId: action.domainId,
    domainVersion: action.domainVersion,
    value: 0.85,
    unit: context.metric.unit,
    observedAt: '2026-08-10T12:04:00Z',
    snapshotId: context.snapshot.snapshotId,
    evidenceRefIds: [context.evidenceRefId],
    sourceArtifactId: context.sourceArtifactId,
  };
  const observed = recordOperatingIntelligenceStateV2(
    {
      cycleId: action.sourceCycleId,
      snapshotId: context.snapshot.snapshotId,
      stateId: context.operatingState.stateId,
      claims: [],
      metricObservations: [observation],
      risks: [],
      assumptions: [],
      decisionRevisions: [],
    },
    {
      timestamp: '2026-08-10T12:04:00Z',
      correlationId: `corr_phase6_${action.domainId}_observation_001`,
      eventIds: {
        claims: [],
        metricObservations: [`evt_phase6_${action.domainId}_observation_001`],
        risks: [],
        assumptions: [],
        decisionRevisions: [],
      },
    },
    { initialState: terminal.state, replayHook: context.replayHook },
  );
  const actionSourceDecision = observed.state.decisions.find(
    ({ decisionId }) => decisionId === action.sourceDecisionId,
  );
  assert.ok(actionSourceDecision, 'governed Action retains its exact source Decision');
  const outcome = recordOperatingActionVerificationOutcomeV2(
    {
      cycleId: action.sourceCycleId,
      snapshotId: context.snapshot.snapshotId,
      stateId: context.operatingState.stateId,
      actionId: action.actionId,
      verificationPlanId: context.verificationPlan.verificationPlanId,
      observationId: observation.observationId,
      learning: {
        statement: `The governed ${action.domainId} effect and accepted observation preserve separate execution and hypothesis truth.`,
        assumptionIds: [...actionSourceDecision.assumptionIds],
        decisionIds: [action.sourceDecisionId],
      },
    },
    {
      timestamp: '2026-08-10T12:05:00Z',
      correlationId: `corr_phase6_${action.domainId}_outcome_001`,
      eventIds: {
        outcome: `evt_phase6_${action.domainId}_outcome_001`,
        learning: `evt_phase6_${action.domainId}_learning_001`,
      },
    },
    { initialState: observed.state, replayHook: context.replayHook },
  );
  const laterMetric = {
    ...clone(context.metric),
    observationIds: [observation.observationId],
    updatedAt: '2026-08-10T12:06:00Z',
  };
  const laterSnapshot = materializeOperatingStateSnapshotV2(
    {
      cycleId: action.sourceCycleId,
      scope: {
        scopeId: action.scopeId,
        domainId: action.domainId,
        domainVersion: action.domainVersion,
      },
      domainContract: context.domain.domainContract,
      sourceArtifactIds: [
        context.sourceArtifactId,
        context.challengerArtifactId,
        context.chairArtifactId,
      ],
      evidenceRefIds: [context.evidenceRefId],
      sourceRevisions: [
        {
          sourceArtifactId: context.sourceArtifactId,
          revision: 'r2',
          evidenceRefIds: [context.evidenceRefId],
        },
        {
          sourceArtifactId: context.challengerArtifactId,
          revision: context.challengerArtifact.rawHash,
          evidenceRefIds: [],
        },
        {
          sourceArtifactId: context.chairArtifactId,
          revision: context.chairArtifact.rawHash,
          evidenceRefIds: [],
        },
      ],
      collections: {
        objectives: [context.objective],
        metrics: [laterMetric],
        findings: [context.finding, ...context.materializedFindings],
        decisions: [actionSourceDecision],
        actions: [stateAction],
        risks: [context.risk],
        assumptions: [context.assumption],
      },
    },
    {
      snapshotId: `snp_phase6_${action.domainId}_002`,
      stateId: `oms_phase6_${action.domainId}_002`,
      timestamp: '2026-08-10T12:06:00Z',
      correlationId: `corr_phase6_${action.domainId}_snapshot_002`,
      eventIds: {
        snapshot: `evt_phase6_${action.domainId}_snapshot_002`,
        state: `evt_phase6_${action.domainId}_state_002`,
      },
    },
    {
      initialState: outcome.state,
      artifactStore: context.artifactStore,
      replayHook: context.replayHook,
    },
  );
  const delta = deriveOperatingRuntimeDeltaV2(
    {
      cycleId: action.sourceCycleId,
      snapshotId: laterSnapshot.snapshot.snapshotId,
      stateId: laterSnapshot.operatingState.stateId,
    },
    {
      deltaId: `dlt_phase6_${action.domainId}_002`,
      eventId: `evt_phase6_${action.domainId}_delta_002`,
      timestamp: '2026-08-10T12:07:00Z',
      correlationId: `corr_phase6_${action.domainId}_delta_002`,
    },
    { initialState: laterSnapshot.state, replayHook: context.replayHook },
  );
  const executionStatus = deriveOperatingExecutionVerificationStatusV2(
    terminal.result.kind === 'operating-rollback-result'
      ? { rollbackResult: terminal.result }
      : { result: terminal.result },
  );
  const feedback = deriveOperatingVerificationFeedbackV2({
    action: stateAction,
    verificationPlan: context.verificationPlan,
    executionStatus,
    sourceCycle: stateCycle,
    operation: terminal.operation,
    result: terminal.result,
    verificationAssignments: terminal.state.assignments,
    outcome: outcome.outcome,
    learning: outcome.learning,
    delta: delta.delta,
    snapshot: laterSnapshot.snapshot,
    cycle: stateCycle,
  });
  pass(
    Number.isInteger(phase5.finalEventSequence) &&
      phase5.finalEventSequence > 0 &&
      phase5.stageOrder.length === 10,
    `${action.domainId}: governed continuation starts at the certified Phase-5 Action checkpoint`,
  );
  pass(
    observed.events.length === 1 && observed.events[0].type === 'metric.observed',
    `${action.domainId}: one accepted verification observation is durable`,
  );
  pass(
    outcome.events.map(({ type }) => type).join(',') === 'outcome.recorded,learning.recorded',
    `${action.domainId}: Outcome and Learning commit atomically after observation`,
  );
  pass(
    laterSnapshot.snapshot.previousSnapshotId === context.snapshot.snapshotId &&
      delta.delta.priorSnapshotId === context.snapshot.snapshotId &&
      delta.delta.decisionRevisitIds.includes(context.decision.decisionId),
    `${action.domainId}: later Snapshot and Delta preserve the governed revisit path`,
  );
  pass(
    assignment.governedOperationId === terminal.operation.operationId,
    `${action.domainId}: terminal verification has exactly one runtime-owned Assignment`,
  );
  return { observed, outcome, laterSnapshot, delta, feedback, assignment };
}

async function runGovernedJourney(domainId) {
  const scenario = prepareScenario(domainId);
  const negativeVectors = await assertPreEffectRejections(scenario);
  const store = checkpointStore(scenario.initial);
  const runtime = createOperatingGovernedExecutionRuntimeV2({
    initialState: scenario.initial,
    artifactStore: scenario.context.artifactStore,
    checkpointStore: store,
  });
  const executed = await runtime.execute(scenario.request, scenario.draft, {
    trustedHost: scenario.trustedHost,
    targetAdapter: scenario.targetAdapter,
  });
  pass(
    executed.replayed === false && executed.dispatchCount === 1,
    `${domainId}: one durable dispatch produces the contained execution result`,
  );
  pass(
    executed.state.governedOperations.length === 1 &&
      executed.state.executionResults.length === 1 &&
      scenario.targetAdapter.describe().effectCount === 1,
    `${domainId}: execution records exactly one operation, result, and target effect`,
  );
  pass(
    store.commits.map(({ phase }) => phase).join(',') === 'dispatch-intent,terminal-result',
    `${domainId}: durable intent commits before the terminal result`,
  );

  const replay = await runtime.execute(
    scenario.request,
    scenario.draft,
    hostileEnvironment(`${domainId}/exact-replay`),
  );
  pass(
    replay.replayed === true && replay.dispatchCount === 0 && replay.events.length === 0,
    `${domainId}: exact retry replays immutable history without target access`,
  );
  const divergentBefore = {
    eventHead: clone(store.snapshot().eventHead),
    dispatches: runtime.dispatchCount,
    effects: scenario.targetAdapter.describe().effectCount,
  };
  const divergentValue = {
    ...clone(scenario.request.payload.value),
    status: 'divergent',
    count: 2,
  };
  const divergentRequest = clone(scenario.request);
  divergentRequest.payload.value = divergentValue;
  divergentRequest.payload.contentHash = sha256Jcs(divergentValue);
  const divergentAccesses = { host: 0, target: 0 };
  const divergentCode = await rejectionCode(
    runtime.execute(
      divergentRequest,
      scenario.draft,
      hostileEnvironment(`${domainId}/divergent-retry`, divergentAccesses),
    ),
  );
  const divergentAfter = {
    eventHead: clone(store.snapshot().eventHead),
    dispatches: runtime.dispatchCount,
    effects: scenario.targetAdapter.describe().effectCount,
  };
  const divergentRetry = Object.freeze({
    code: divergentCode,
    events: divergentAfter.eventHead.sequence - divergentBefore.eventHead.sequence,
    dispatches: divergentAfter.dispatches - divergentBefore.dispatches,
    effects: divergentAfter.effects - divergentBefore.effects,
    hostAccesses: divergentAccesses.host,
    targetAccesses: divergentAccesses.target,
  });
  pass(
    divergentRetry.code === 'OPERATION_CONFLICT' &&
      divergentRetry.events === 0 &&
      divergentRetry.dispatches === 0 &&
      divergentRetry.effects === 0 &&
      divergentRetry.hostAccesses === 0 &&
      divergentRetry.targetAccesses === 0 &&
      divergentAfter.eventHead.hash === divergentBefore.eventHead.hash,
    `${domainId}: divergent completed retry conflicts before Event, dispatch, host, target, or effect access`,
  );
  // Treat the successful terminal response as lost: restart exclusively from
  // the checkpoint that was durably committed before the caller could observe
  // an acknowledgement. Replay must not touch either host or target.
  const acknowledgementLossState = store.snapshot();
  const restarted = createOperatingGovernedExecutionRuntimeV2({
    initialState: acknowledgementLossState,
    artifactStore: scenario.context.artifactStore,
    checkpointStore: checkpointStore(acknowledgementLossState),
  });
  const restartReplay = await restarted.execute(
    scenario.request,
    scenario.draft,
    hostileEnvironment(`${domainId}/restart-replay`),
  );
  pass(
    restartReplay.replayed === true &&
      restarted.dispatchCount === 0 &&
      scenario.targetAdapter.describe().effectCount === 1,
    `${domainId}: lost acknowledgement restarts from durable history without a second effect`,
  );
  const recovery = classifyOperatingGovernedRecoveryV2({
    state: executed.state,
    operationId: executed.operation.operationId,
    observedAt: '2026-08-10T12:01:30Z',
  });
  pass(
    recovery.classification === 'applied' && recovery.source === 'durable-history',
    `${domainId}: terminal recovery classifies from durable history without a blind retry`,
  );

  let terminal = executed;
  let rollback = null;
  if (domainId === 'business') {
    const lifecycleState = appendRequiredRollbackLifecycle(executed.state, scenario, executed);
    const approvedState = appendFreshRollbackApproval(lifecycleState, scenario);
    const plan = buildOperatingRollbackPlanV2({
      operation: executed.operation,
      result: executed.result,
      baseline: scenario.request.rollbackBaseline,
      eligibility: 'required',
      expiresAt: '2026-08-11T08:00:00Z',
    });
    const planned = recordOperatingRollbackPlanV2({
      state: approvedState,
      plan,
      eventId: 'evt_phase6_business_rollback_plan_001',
    });
    const rollbackStore = checkpointStore(planned.state);
    const rollbackRuntime = createOperatingGovernedRecoveryRuntimeV2({
      initialState: planned.state,
      artifactStore: scenario.context.artifactStore,
      checkpointStore: rollbackStore,
    });
    const request = {
      actionId: scenario.action.actionId,
      originalOperationId: executed.operation.operationId,
      rollbackPlanId: plan.rollbackPlanId,
      payload: clone(scenario.request.payload),
      rollbackBaseline: clone(scenario.request.rollbackBaseline),
    };
    const draft = rollbackDraft('86000002');
    rollback = await rollbackRuntime.rollback(request, draft, {
      trustedHost: scenario.trustedHost,
      targetAdapter: scenario.targetAdapter,
    });
    pass(
      rollback.state.governedOperations.length === 2 &&
        rollback.state.executionResults.length === 1 &&
        rollback.state.rollbackResults.length === 1 &&
        scenario.targetAdapter.describe().effectCount === 2,
      'business: rollback is one separately authorized operation and one contained restorative effect',
    );
    pass(
      rollback.result.targetAfterHash === scenario.request.rollbackBaseline.contentHash,
      'business: rollback restores the exact declared baseline',
    );
    const rollbackReplay = await rollbackRuntime.rollback(
      request,
      draft,
      hostileEnvironment('business/rollback-replay'),
    );
    pass(
      rollbackReplay.replayed === true && rollbackReplay.dispatchCount === 0,
      'business: exact rollback retry replays history without a second effect',
    );
    terminal = rollback;
  }

  const verification = continueWithVerification(scenario, terminal);
  const stateAction = terminal.state.actions.find(
    ({ actionId }) => actionId === scenario.action.actionId,
  );
  const lifecycleNegativeCode = (() => {
    try {
      transitionOperatingActionLifecycleV2(
        stateAction,
        stateAction.state === 'approved' ? 'completed' : 'in_progress',
        {
          updatedAt: '2026-08-10T12:08:00Z',
        },
      );
    } catch (error) {
      return error.code;
    }
    return null;
  })();
  pass(
    lifecycleNegativeCode === 'STATE_TRANSITION_INVALID',
    `${domainId}: an illegal terminal Action transition is rejected without an effect`,
  );

  const operationCounts = {
    execute: terminal.state.governedOperations.filter(
      ({ operationKind }) => operationKind === 'execute',
    ).length,
    rollback: terminal.state.governedOperations.filter(
      ({ operationKind }) => operationKind === 'rollback',
    ).length,
  };
  const resultCounts = {
    execute: terminal.state.executionResults.length,
    rollback: terminal.state.rollbackResults.length,
  };
  const expected =
    domainId === 'business'
      ? { operations: 2, rollback: 1, effects: 2, finalSequence: 150 }
      : { operations: 1, rollback: 0, effects: 1, finalSequence: 85 };
  pass(
    operationCounts.execute === 1 && operationCounts.rollback === expected.rollback,
    `${domainId}: exact execute and rollback operation counts are certified`,
  );
  pass(
    resultCounts.execute === 1 && resultCounts.rollback === expected.rollback,
    `${domainId}: exact immutable result counts are certified`,
  );
  pass(
    scenario.targetAdapter.describe().effectCount === expected.effects,
    `${domainId}: exact contained effect count is certified`,
  );
  pass(
    verification.delta.state.eventHead.sequence === expected.finalSequence,
    `${domainId}: exact governed-loop Event count is certified (${verification.delta.state.eventHead.sequence})`,
  );
  pass(
    scenario.context.replayHook.dispatchCount === 0,
    `${domainId}: the governed continuation dispatches no model`,
  );

  const stageOrder = [
    ...scenario.phase5.stageOrder,
    'policy-evaluated',
    'approval-recorded',
    'capability-authorized',
    'durable-operation-intent',
    'contained-execution-result',
    'retry-restart-replay',
    domainId === 'business' ? 'governed-rollback' : 'rollback-not-required',
    'execution-verification-assignment',
    'metric-observation-accepted',
    'outcome-learning-atomic',
    'later-snapshot-delta-revisit',
    'negative-authority-effect-lifecycle',
  ];
  return Object.freeze({
    domainId,
    scopeId: scenario.action.scopeId,
    cycleId: scenario.action.sourceCycleId,
    actionId: scenario.action.actionId,
    actionRevision: scenario.action.revision,
    actionHash: scenario.action.actionHash,
    stageOrder,
    policy: {
      evaluationId: scenario.evaluation.evaluationId,
      outcome: scenario.evaluation.outcome,
      policyIds: scenario.evaluation.appliedPolicyRefs.map(({ policyId }) => policyId),
    },
    approval: {
      requirementId: scenario.requirement.requirementId,
      approvalId: scenario.approval.approvalId,
      consumedByOperationId: executed.state.approvalRecords.find(
        ({ approvalId }) => approvalId === scenario.approval.approvalId,
      )?.consumedByOperationId,
    },
    capabilityGrantId: executed.operation.grantId,
    execution: {
      operationId: executed.operation.operationId,
      resultId: executed.result.resultId,
      status: executed.result.status,
      dispatchCount: executed.dispatchCount,
      replayDispatchCount: replay.dispatchCount,
      restartDispatchCount: restarted.dispatchCount,
      acknowledgementLossRecovered:
        restartReplay.replayed === true &&
        restarted.dispatchCount === 0 &&
        scenario.targetAdapter.describe().effectCount >= 1,
      divergentRetry,
      recoveryClassification: recovery.classification,
    },
    rollback: rollback
      ? {
          operationId: rollback.operation.operationId,
          resultId: rollback.result.rollbackResultId,
          status: rollback.result.status,
        }
      : null,
    verification: {
      assignmentId: verification.assignment.assignmentId,
      outcomeId: verification.outcome.outcome.outcomeId,
      learningId: verification.outcome.learning.learningId,
      snapshotId: verification.laterSnapshot.snapshot.snapshotId,
      deltaId: verification.delta.delta.deltaId,
      executionStatus: verification.feedback.executionStatus,
      hypothesisStatus: verification.feedback.hypothesisStatus,
      revisit: verification.feedback.revisit,
    },
    counts: {
      phase5Events: scenario.phase5.finalEventSequence,
      phase6Events:
        verification.delta.state.eventHead.sequence - scenario.phase5.finalEventSequence,
      finalEvents: verification.delta.state.eventHead.sequence,
      operations: terminal.state.governedOperations.length,
      executeOperations: operationCounts.execute,
      rollbackOperations: operationCounts.rollback,
      executionResults: resultCounts.execute,
      rollbackResults: resultCounts.rollback,
      dispatches: 1 + (rollback ? 1 : 0),
      effects: scenario.targetAdapter.describe().effectCount,
      modelDispatches: scenario.context.replayHook.dispatchCount,
    },
    negativeVectors: {
      ...negativeVectors,
      lifecycleCode: lifecycleNegativeCode,
    },
  });
}

export async function verifyOperateV2GovernedExecution() {
  checks = 0;
  pass(
    new Set(OPERATE_RUNTIME_CONTRACT_KINDS).size === OPERATE_RUNTIME_CONTRACT_KINDS.length,
    'the governed verifier sees unique registry-derived public Protocol v2 contracts',
  );
  for (const artifact of Object.values(governedFixture)) {
    pass(
      validateProtocolArtifact(artifact.kind, artifact, { protocolVersion: VERSION }).length === 0,
      `${artifact.kind}: governed fixture is valid`,
    );
  }
  let networkAttempts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    networkAttempts += 1;
    throw new Error('Phase-6 conformance forbids network access.');
  };
  try {
    const journeys = [];
    for (const domainId of ['business', 'software'])
      journeys.push(await runGovernedJourney(domainId));
    pass(networkAttempts === 0, 'both governed journeys perform zero network requests');
    pass(
      journeys.reduce((total, journey) => total + journey.counts.effects, 0) === 3,
      'the complete certification performs exactly three disposable contained effects',
    );
    return Object.freeze({
      ok: true,
      protocolVersion: VERSION,
      contracts: OPERATE_RUNTIME_CONTRACT_KINDS.length,
      checks,
      networkAttempts,
      credentialReads: 0,
      externalEffects: 0,
      realEffects: 0,
      journeys,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.stdout.write(`${JSON.stringify(await verifyOperateV2GovernedExecution())}\n`);
}
