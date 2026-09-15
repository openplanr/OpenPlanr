import { assertOperateReviewDisplayWorkspaceV1 } from 'planr-pipeline/dashboard/operate-review-contract';
import { issueOperateReviewDisplayWorkspaceV1 } from 'planr-pipeline/dashboard/operate-review-display-workspace-contract';
import {
  createOperatingApprovalRecordV2,
  createOperatingApprovalRequirementV2,
} from 'planr-pipeline/operate/approvals-v2';
import { createOperatingGovernedExecutionRuntimeV2 } from 'planr-pipeline/operate/governed-execution-v2';
import {
  buildOperatingRollbackPlanV2,
  recordOperatingRollbackPlanV2,
} from 'planr-pipeline/operate/governed-recovery-v2';
import { derivePersistentOperatingActionRevisionHashV2 } from 'planr-pipeline/operate/persistent-work-v2';
import {
  createOperatingActionPolicyV2,
  evaluateOperatingActionPolicyV2,
} from 'planr-pipeline/operate/policy-v2';
import {
  createDisposableLocalProjectTargetV2,
  OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
} from 'planr-pipeline/operate/reference-governed-executors-v2';
import { buildOperateReviewWorkspacePayloadV1 } from 'planr-pipeline/operate/review-workspace-projection-v2';
import {
  buildOperatingReviewBoundSubmissionV1,
  createEmptyOperatingRuntimeStateV2,
} from 'planr-pipeline/operate/runtime-v2';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { assertOperateCycleDisplayWorkspaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-cycle-display-workspace.mjs';
import { assertOperateExperienceDisplaySurfaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-experience-display-surface.mjs';
import { describe, expect, it, vi } from 'vitest';
import {
  renderOperateExperienceSurfaceHuman,
  startOperateDashboard,
} from '../../src/cli/commands/operate.js';
import {
  createOperateClient,
  type OperateApiEnvelopeV2,
  type OperateClient,
} from '../../src/services/operate/client.js';
import {
  createOperateClientCommandRuntime,
  createOperateCommandGateway,
  OperateCommandGatewayErrorV2,
} from '../../src/services/operate/command-gateway.js';
import { createOperateComposition } from '../../src/services/operate/composition.js';
import { createOperatingReviewReadGatewayV1 } from '../../src/services/operate/review-read-gateway.js';
import {
  createOperateSessionCapabilityIssuerV2,
  type OperateSessionBindingV2,
  OperateSessionCapabilityError,
} from '../../src/services/operate/session-capability.js';
import { ensureOperateStorageLayout } from '../../src/services/operate/storage-layout.js';
import {
  createEmptyOperatePreferences,
  createOperateStore,
  type OperateStoredRuntime,
} from '../../src/services/operate/store.js';
import {
  type AssignmentClaimV2,
  authoredChairResultForFixture,
  authoredChallengerResultForFixture,
  readIssuedAssignmentClaim,
  readPersistedActionSeedForFixture,
  submitAuthoredAdvisorAssignments,
  writeScreenedEvidenceFixture,
} from '../helpers/operate-business-board-lifecycle.js';
import { reviewWorkspace } from '../helpers/operate-command-gateway-review.js';
import { createTestProject } from '../helpers/test-project.js';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;
const origin = 'http://127.0.0.1:7473';
const actor = { actorId: 'owner-acme', kind: 'human' as const, runtime: 'openplanr' };

type RecordValue = Record<string, unknown>;
type Assignment = { assignmentId: string; roleId: string };
async function claimAndSubmitReal(
  client: ReturnType<typeof createOperateClient>,
  assignment: Assignment,
  body: (claim: AssignmentClaimV2) => RecordValue,
) {
  const claimant = {
    actorId: `agent-${assignment.roleId}`,
    kind: 'agent' as const,
    runtime: 'codex',
  };
  const claimed = await client.dispatch({
    operation: 'operate.assignment.claim',
    request: {
      assignmentId: assignment.assignmentId,
      actor: claimant,
    },
  });
  if (!claimed.ok) throw new Error(JSON.stringify(claimed));
  const claim = await readIssuedAssignmentClaim(client, claimed.data as RecordValue, claimant);
  const submitted = await client.dispatch({
    operation: 'operate.assignment.submit',
    request: {
      assignmentId: assignment.assignmentId,
      submissionId: claim.submissionId,
      actor: claimant,
      mediaType: 'application/json',
      encoding: 'utf-8',
      contentBase64: Buffer.from(JSON.stringify(body(claim))).toString('base64'),
    },
  });
  if (!submitted.ok) throw new Error(JSON.stringify(submitted));
  return submitted;
}

async function prepareContainedCycle(
  client: ReturnType<typeof createOperateClient>,
  projectDir: string,
): Promise<string> {
  await writeScreenedEvidenceFixture(projectDir);
  const started = await client.dispatch({
    operation: 'operate.cycle.start',
    request: {
      scope: { scopeId: 'scope-dashboard', domainId: 'business', domainVersion: '1.0.0' },
      focus: ['real command lifecycle'],
      trigger: { kind: 'manual' },
      mode: 'standard',
      ownerActorId: 'owner-dashboard',
      deliveryRoute: 'contained-execution',
    },
  });
  if (!started.ok) throw new Error(JSON.stringify(started));
  const initial = started.data as {
    cycle: RecordValue & { cycleId: string };
    availableAssignments: Assignment[];
  };
  const actionSeed = await readPersistedActionSeedForFixture(projectDir);
  await submitAuthoredAdvisorAssignments(client, initial.cycle.cycleId, (assignment, body) =>
    claimAndSubmitReal(client, assignment, body),
  );
  const afterAdvisor = await client.dispatch({
    operation: 'operate.cycle.resume',
    request: { cycleId: initial.cycle.cycleId },
  });
  if (!afterAdvisor.ok) throw new Error(JSON.stringify(afterAdvisor));
  const challenger = (afterAdvisor.data as { availableAssignments: Assignment[] })
    .availableAssignments[0];
  await claimAndSubmitReal(client, challenger, authoredChallengerResultForFixture);
  const beforeChair = await client.dispatch({
    operation: 'operate.cycle.get',
    request: { cycleId: initial.cycle.cycleId },
  });
  if (!beforeChair.ok) throw new Error(JSON.stringify(beforeChair));
  const chair = (beforeChair.data as { availableAssignments: Assignment[] })
    .availableAssignments[0];
  await claimAndSubmitReal(client, chair, (claim) =>
    authoredChairResultForFixture(claim, {
      title: 'Run one contained operating change',
      question: 'What bounded change should be tested next?',
      outcome: 'Apply one reversible local change and verify it independently.',
      rationale: 'The challenged evidence supports a contained, reversible test.',
      actionHypothesis: {
        title: 'Apply the contained local project record',
        objectiveId: actionSeed.objectiveId,
        metricId: actionSeed.metricId,
        expectedResult: 'A later accepted observation reaches the declared target.',
        verificationMethod: 'Compare a future accepted observation with the target.',
      },
    }),
  );
  return initial.cycle.cycleId;
}

async function currentRealExperience(
  client: ReturnType<typeof createOperateClient>,
  cycleId: string,
): Promise<RecordValue> {
  const response = await client.dispatch({
    operation: 'operate.experience.get',
    request: {
      cycleId,
      actor: { actorId: 'owner-dashboard', kind: 'human', runtime: 'openplanr' },
      actionBinding: { cycleId, actorId: 'owner-dashboard' },
    },
  });
  if (!response.ok) throw new Error(JSON.stringify(response));
  return response.data as RecordValue;
}

async function performCurrentRealAction(
  client: ReturnType<typeof createOperateClient>,
  cycleId: string,
  label: RegExp,
) {
  const view = await currentRealExperience(client, cycleId);
  const entry = ((view.allowedActions as RecordValue[]) ?? []).find((candidate) =>
    label.test(String((candidate.action as RecordValue).label)),
  );
  if (!entry) throw new Error(`missing action ${label}: ${JSON.stringify(view)}`);
  const action = entry.action as RecordValue;
  const operation = String(action.tool) as Parameters<OperateClient['dispatch']>[0]['operation'];
  const argumentsValue = (action.arguments as RecordValue) ?? {};
  return client.dispatch({
    operation,
    request:
      operation === 'operate.assignment.submit'
        ? (argumentsValue as never)
        : ({
            ...argumentsValue,
            actor: { actorId: 'owner-dashboard', kind: 'human', runtime: 'openplanr' },
          } as never),
  } as Parameters<OperateClient['dispatch']>[0]);
}

async function approveCurrentReview(
  client: ReturnType<typeof createOperateClient>,
  cycleId: string,
) {
  const view = await currentRealExperience(client, cycleId);
  const readAction = ((view.allowedActions as RecordValue[]) ?? []).find(
    (candidate) => String((candidate.action as RecordValue).tool) === 'operate.review.get',
  );
  if (!readAction) throw new Error(`missing exact Review read: ${JSON.stringify(view)}`);
  const read = await client.dispatch({
    operation: 'operate.review.get',
    request: ((readAction.action as RecordValue).arguments ?? {}) as never,
  });
  if (!read.ok) throw new Error(`Review read failed: ${JSON.stringify(read)}`);
  const approval = (read.allowedActions as RecordValue[]).find((candidate) => {
    const argumentsValue = (candidate.arguments as RecordValue) ?? {};
    return (
      candidate.tool === 'operate.review.submit' &&
      argumentsValue.disposition === 'approved' &&
      Array.isArray(argumentsValue.workDispositions)
    );
  });
  if (!approval)
    throw new Error(`missing runtime-advertised Review approval: ${JSON.stringify(read)}`);
  const submitted = await client.dispatch({
    operation: 'operate.review.submit',
    request: (approval.arguments ?? {}) as never,
  });
  if (!submitted.ok) throw new Error(`Review submission failed: ${JSON.stringify(submitted)}`);
  return { read, submitted };
}

async function createDurableThresholdRollbackRuntime(projectDir: string) {
  await ensureOperateStorageLayout(projectDir);
  const cycleId = 'cyc_threshold_rollback_0001';
  const actionId = 'act_threshold_rollback_0001';
  const baselineArtifactId = 'art_threshold_baseline_0001';
  const sourceArtifactId = 'art_threshold_source_0001';
  const now = Date.now();
  const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  const action = {
    kind: 'operating-action',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    actionId,
    revisionId: 'actrev_pending',
    revision: 1,
    predecessorRevisionId: null,
    actionHash: HASH_A,
    scopeId: 'scope-dashboard',
    domainId: 'business',
    domainVersion: '1.0.0',
    sourceCycleId: cycleId,
    sourceArtifactId,
    title: 'Apply one threshold-authorized project record change',
    state: 'approved',
    actionKind: { id: 'business-operating-hypothesis', version: '1.0.0' },
    requestedCapability: { id: 'bounded-project-write', version: '1.0.0' },
    targetBinding: {
      kind: 'project-record',
      id: 'record-threshold-rollback-0001',
      revision: 'source-v1',
    },
    effectClass: 'project-write',
    preconditionArtifactIds: [baselineArtifactId, sourceArtifactId].sort(),
    executionBinding: {
      policyId: 'bounded-project-write-policy',
      policyVersion: '1.0.0',
      rollbackRequired: true,
      verificationRequired: true,
    },
    ownerActorId: 'owner-dashboard',
    accountabilityDisposition: null,
    sourceDecisionId: 'dec_threshold_rollback_0001',
    sourceFindingIds: ['fnd_threshold_rollback_0001'],
    dependsOnActionIds: [],
    objectiveId: 'obj_threshold_rollback_0001',
    expectedResult: 'The exact reviewed project record changes once.',
    metricId: 'met_threshold_rollback_0001',
    baseline: 0,
    target: 1,
    verificationWindow: 'immediate',
    verificationPlanId: 'vfy_threshold_rollback_0001',
    createdAt: at(-20_000),
    updatedAt: at(-19_000),
  };
  action.actionHash = derivePersistentOperatingActionRevisionHashV2(action as never);
  action.revisionId = `actrev_${sha256Jcs({
    actionId: action.actionId,
    revision: action.revision,
    actionHash: action.actionHash,
  }).slice('sha256:'.length)}`;
  const policyTuple = {
    domainId: action.domainId,
    actionKind: action.actionKind,
    capability: action.requestedCapability,
    effectClasses: [action.effectClass],
    targetKinds: [action.targetBinding.kind],
    rollbackRequired: true,
    verificationRequired: true,
  };
  const corePolicy = createOperatingActionPolicyV2({
    policyId: 'core-governed-action-policy',
    policyVersion: '1.0.0',
    ...policyTuple,
    decisionMode: 'automatic',
    approvalRequirementIds: [],
    tier: 'core',
    provenance: {
      providerId: 'core-policy-provider',
      providerVersion: '1.0.0',
      sourceHash: sha256Jcs({ contract: 'test-threshold-core-policy', version: 1 }),
    },
  } as never);
  const domainPolicy = createOperatingActionPolicyV2({
    policyId: 'bounded-project-write-policy',
    policyVersion: '1.0.0',
    ...policyTuple,
    decisionMode: 'threshold',
    approvalRequirementIds: ['aprq_openplanr_owner'],
    tier: 'domain',
    provenance: {
      providerId: 'open-reference-policy-provider',
      providerVersion: '1.0.0',
      sourceHash: sha256Jcs({ contract: 'test-threshold-domain-policy', version: 1 }),
    },
  } as never);
  const evaluation = evaluateOperatingActionPolicyV2({
    action: action as never,
    configuredPolicies: [corePolicy, domainPolicy],
    evaluatedAt: at(-18_000),
  });
  const parties = [
    {
      partyId: 'owner-party-threshold-one',
      actorKind: 'human',
      actorId: 'owner-dashboard',
      requiredCapability: { id: 'action-approve', version: '1.0.0' },
    },
    {
      partyId: 'owner-party-threshold-two',
      actorKind: 'human',
      actorId: 'owner-dashboard-two',
      requiredCapability: { id: 'action-approve', version: '1.0.0' },
    },
  ] as const;
  const requirement = createOperatingApprovalRequirementV2({
    policyRequirementId: 'aprq_openplanr_owner',
    evaluation,
    action: action as never,
    parties: structuredClone(parties) as never,
    threshold: 2,
    expiresAt: at(10 * 60_000),
    consumable: true,
  });
  const approvals = parties.map((party, index) =>
    createOperatingApprovalRecordV2({
      approvalId: `aprv_threshold_execute_${String(index + 1).padStart(4, '0')}`,
      requirement,
      evaluation,
      action: action as never,
      partyId: party.partyId,
      actor: {
        kind: 'human',
        actorId: party.actorId,
        capability: structuredClone(party.requiredCapability),
      },
      decision: 'approved',
      issuedAt: at(-17_000 + index * 1_000),
      expiresAt: requirement.expiresAt,
    }),
  );
  const initial = createEmptyOperatingRuntimeStateV2(at(-15_000), {
    actionPolicies: [corePolicy, domainPolicy],
    approvalRequirements: [requirement],
  });
  initial.cycles = [
    {
      kind: 'operating-cycle',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      cycleId,
      scopeId: action.scopeId,
      domainId: action.domainId,
      domainVersion: action.domainVersion,
      state: 'approved',
      inputBindingId: 'inb_threshold_rollback_0001',
      contractVersions: { 'advisor-result': '1.0.0' },
      trigger: { kind: 'manual' },
      focus: ['threshold rollback lifecycle'],
      health: 'normal',
      activeReviewId: null,
      createdAt: action.createdAt,
      updatedAt: action.updatedAt,
    },
  ] as never;
  initial.actions = [action] as never;
  initial.policyEvaluations = [evaluation];
  initial.approvalRecords = approvals;
  initial.verificationPlans = [
    {
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
    },
  ] as never;
  let checkpoint = structuredClone(initial);
  const checkpointStore = {
    readSnapshot: () => structuredClone(checkpoint),
    compareAndSwap(input: { expectedEventHead: RecordValue; nextState: typeof checkpoint }) {
      const committed =
        input.expectedEventHead.sequence === checkpoint.eventHead.sequence &&
        input.expectedEventHead.hash === checkpoint.eventHead.hash;
      if (committed) checkpoint = structuredClone(input.nextState);
      return { committed, state: structuredClone(checkpoint) };
    },
  };
  const artifactBytes = new Map<string, Uint8Array>();
  const artifactStore = {
    stageRaw(input: { artifact: { artifactId: string; rawHash: string }; rawBytes: Uint8Array }) {
      const bytes = Uint8Array.from(input.rawBytes);
      const prior = artifactBytes.get(input.artifact.artifactId);
      if (prior && Buffer.compare(Buffer.from(prior), Buffer.from(bytes)) !== 0) {
        throw new Error('artifact byte collision');
      }
      artifactBytes.set(input.artifact.artifactId, bytes);
      return true as const;
    },
    readRaw(input: { artifactId: string; rawHash: string }) {
      const bytes = artifactBytes.get(input.artifactId);
      if (!bytes) throw new Error(`missing artifact ${input.artifactId}`);
      return Uint8Array.from(bytes);
    },
  };
  const initialValue = { status: 'before', count: 0 };
  const payloadValue = { status: 'after', count: 1 };
  const execution = createOperatingGovernedExecutionRuntimeV2({
    initialState: initial,
    checkpointStore: checkpointStore as never,
    artifactStore,
  });
  const completed = await execution.execute(
    {
      actionId,
      payload: {
        artifactId: sourceArtifactId,
        contentHash: sha256Jcs(payloadValue),
        value: payloadValue,
      },
      rollbackBaseline: {
        artifactId: baselineArtifactId,
        contentHash: sha256Jcs(initialValue),
        value: initialValue,
      },
    },
    {
      assignmentId: 'asg_threshold_rollback_0001',
      submissionId: 'sub_threshold_rollback_0001',
      operationId: 'op_threshold_rollback_0001',
      grantId: 'cgr_threshold_rollback_0001',
      resultId: 'xres_threshold_rollback_0001',
      resultArtifactId: 'art_threshold_result_0001',
      claimId: 'claim-threshold-rollback-0001',
      preparedAt: at(-14_000),
      completedAt: at(-13_000),
      grantExpiresAt: at(5 * 60_000),
      availabilityExpiresAt: at(6 * 60_000),
      correlationId: 'corr-threshold-rollback-0001',
      eventIds: Object.fromEntries(
        [
          'assignmentCreated',
          'assignmentClaimed',
          'assignmentStarted',
          'availabilityRecorded',
          'capabilityGranted',
          'intentRecorded',
          'submitted',
          'artifactCreated',
          'validated',
          'resultRecorded',
        ].map((field, index) => [
          field,
          `evt_threshold_execute_${String(index + 1).padStart(4, '0')}`,
        ]),
      ) as never,
      uncertainty: {
        resultId: 'xres_threshold_uncertain_0001',
        resultArtifactId: 'art_threshold_uncertain_0001',
        submissionId: 'sub_threshold_uncertain_0001',
        eventIds: Object.fromEntries(
          ['submitted', 'artifactCreated', 'validated', 'resultRecorded'].map((field, index) => [
            field,
            `evt_threshold_uncertain_${String(index + 1).padStart(4, '0')}`,
          ]),
        ) as never,
      },
    },
    {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter: createDisposableLocalProjectTargetV2({
        target: action.targetBinding as never,
        initialValue,
      }),
    },
  );
  const plan = buildOperatingRollbackPlanV2({
    operation: completed.operation,
    result: completed.result,
    baseline: {
      artifactId: baselineArtifactId,
      contentHash: sha256Jcs(initialValue),
      value: initialValue,
    },
    expiresAt: at(10 * 60_000),
  });
  const planned = recordOperatingRollbackPlanV2({
    state: completed.state,
    plan,
    eventId: 'evt_threshold_rollback_plan_0001',
  });
  const preferences = createEmptyOperatePreferences();
  preferences.selectedScopeId = action.scopeId;
  preferences.selectedDomainId = action.domainId;
  preferences.selectedDomainVersion = action.domainVersion;
  preferences.lastCycleId = cycleId;
  preferences.reviewOwners[cycleId] = 'owner-dashboard';
  preferences.cycleModes[cycleId] = 'lifecycle';
  preferences.cycleDeliveryRoutes[cycleId] = 'contained-execution';
  preferences.actorMemberships['owner-dashboard'] = {
    actorId: 'owner-dashboard',
    scopeId: action.scopeId,
    domainId: action.domainId,
    domainVersion: action.domainVersion,
    role: 'owner',
  };
  preferences.actorMemberships['owner-dashboard-two'] = {
    actorId: 'owner-dashboard-two',
    scopeId: action.scopeId,
    domainId: action.domainId,
    domainVersion: action.domainVersion,
    role: 'owner',
  };
  const store = createOperateStore(projectDir);
  await store.commit(
    {
      baseState: initial as unknown as RecordValue,
      state: planned.state as unknown as RecordValue,
      events: [...completed.events, planned.event] as unknown as RecordValue[],
      artifacts: artifactBytes,
      preferences,
    },
    null,
  );
  return {
    cycleId,
    action,
    plan,
    executionApprovalIds: approvals.map((approval) => approval.approvalId),
  };
}

function reviewAction() {
  return {
    tool: 'operate.review.submit',
    arguments: {
      reviewId: 'rev_1234567890abcdef',
      cycleId: 'cyc_1234567890abcdef',
      actor,
      scope: {
        scopeId: 'scope-acme',
        domainId: 'business',
        domainVersion: '1.0.0',
      },
      disposition: 'approved',
      workDispositions: [],
    },
    label: 'Approve this exact operating decision',
    effect: 'project-write',
  };
}

function assignmentAction() {
  return {
    tool: 'operate.assignment.submit',
    arguments: {
      assignmentId: 'asg_1234567890abcdef',
      submissionId: 'sub_1234567890abcdef',
      actor,
      mediaType: 'application/json',
      encoding: 'utf-8',
      contentBase64: 'e30=',
    },
    label: 'Submit the exact verification observation',
    effect: 'machine-local-write',
  };
}

function terminalReviewReceipt(note: string | null = null) {
  const selected = reviewAction();
  const choice = {
    choiceId: 'rch_1234567890abcdef',
    choiceHash: sha256Jcs(selected.arguments),
    submitArguments: structuredClone(selected.arguments),
  };
  return {
    kind: 'operating-review-receipt',
    receiptId: 'rrc_1234567890abcdef',
    cycleId: 'cyc_1234567890abcdef',
    readEventHead: { sequence: 1, hash: HASH_A },
    eventHead: { sequence: 2, hash: HASH_B },
    review: {
      reviewId: 'rev_1234567890abcdef',
      workDispositions: [],
    },
    appliedChoiceId: 'rch_1234567890abcdef',
    appliedChoiceHash: sha256Jcs(selected.arguments),
    appliedWorkDispositions: [],
    dispositionChoices: [choice],
    boundSubmission: buildOperatingReviewBoundSubmissionV1({
      expectedReadEventHead: { sequence: 1, hash: HASH_A },
      choice,
      note,
    }),
  };
}

function inboxItems(allowedActions: RecordValue[]) {
  return allowedActions
    .filter((entry) => String((entry.action as RecordValue).effect) !== 'read-only')
    .map((entry, index) => {
      const action = entry.action as RecordValue;
      const subjectId = String(entry.subjectId);
      const verification = action.tool === 'operate.assignment.submit';
      return {
        itemId: `${verification ? 'verification' : 'decision'}:${subjectId}:${index}`,
        kind: verification ? 'verification' : 'decision',
        subjectId: verification ? subjectId : `dec_${String(index + 1).padStart(16, '0')}`,
        ownerActorId: actor.actorId,
        state: verification ? 'available' : 'proposed',
        title: verification ? 'Verify the exact assignment' : 'Review the exact decision',
        consequence: 'One exact governed transition will be previewed before confirmation.',
        expiresAt: null,
        blocking: !verification,
        evidence: [],
        requiredParties: [
          {
            partyId: `party_${String(index + 1).padStart(16, '0')}`,
            actorKind: 'human',
            actorId: actor.actorId,
            requiredCapability: {
              id: verification ? 'assignment-submit' : 'review-submit-authorized',
              version: '1.0.0',
            },
            state: 'required',
            redacted: false,
          },
        ],
        redactions: [],
        actionLocator: { subjectId, actionDigest: sha256Jcs(action) },
        navigationLocator: null,
        unavailableReason: null,
      };
    });
}

function experienceView(overrides: Record<string, unknown> = {}) {
  const allowedActions = (overrides.allowedActions as RecordValue[] | undefined) ?? [
    {
      subjectId: 'rev_1234567890abcdef',
      action: {
        tool: 'operate.review.get',
        arguments: {
          reviewId: 'rev_1234567890abcdef',
          cycleId: 'cyc_1234567890abcdef',
          actor,
          scope: {
            scopeId: 'scope-acme',
            domainId: 'business',
            domainVersion: '1.0.0',
          },
        },
        label: 'Refresh this Review',
        effect: 'read-only',
      },
    },
    { subjectId: 'rev_1234567890abcdef', action: reviewAction() },
  ];
  const source = {
    kind: 'operate-experience-view',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    viewId: 'xview_1234567890abcdef',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    actorId: actor.actorId,
    accessLevel: 'internal',
    generatedAt: '2026-08-11T08:00:00.000Z',
    eventHead: { sequence: 1, hash: HASH_A },
    sourceStateHash: HASH_B,
    status: 'ready',
    attention: [],
    domainMetrics: [],
    cycles: [
      {
        cycleId: 'cyc_1234567890abcdef',
        state: 'approved',
        health: 'normal',
        focus: ['Governed local work'],
        createdAt: '2026-08-11T07:00:00.000Z',
        updatedAt: '2026-08-11T08:00:00.000Z',
        stages: ['observe', 'understand', 'decide', 'govern', 'act', 'verify', 'learn'].map(
          (id, index) => ({
            id,
            state: index < 4 ? 'complete' : index === 4 ? 'current' : 'waiting',
            reason: null,
            inputArtifactIds: [],
            outputArtifactIds: [],
            gates: [],
            evidenceGapIds: [],
            uncertaintyIds: [],
            persistentActionIds: [],
          }),
        ),
        assignments: [],
        lensAbsences: [],
        executiveBoard: null,
        dependencies: [],
        blockers: [],
        persistentActionIds: [],
        replayCheckpoint: null,
        deepLink: '#/operate/cycles/cyc_1234567890abcdef',
      },
    ],
    inbox: inboxItems(allowedActions),
    actions: [],
    evidence: [],
    claims: [],
    rationale: [],
    outcomes: [],
    learnings: [],
    history: [],
    replay: {
      checkpoint: null,
      tail: {
        startSequence: 1,
        endSequence: 1,
        eventCount: 1,
        eventReplayIndexHash: HASH_A,
      },
      finalHead: { sequence: 1, hash: HASH_A },
      liveAccessUsed: false,
      parityProof: {
        sourceStateHash: HASH_B,
        eventReplayIndexHash: HASH_A,
        checkpointVerified: false,
        finalEventHashMatches: true,
        stateParityVerified: false,
      },
      filterDimensions: [
        'cycle',
        'action',
        'decision',
        'actor',
        'operation',
        'result',
        'event-type',
        'date',
      ],
      redactions: [],
    },
    allowedActions,
    omissions: [],
    export: { formats: ['json', 'html'], accessSafe: true, redactionCount: 0 },
    ...overrides,
  };
  return { ...source, viewHash: sha256Jcs(source) };
}

function assignmentExperienceView(overrides: Record<string, unknown> = {}) {
  const allowedActions = Object.hasOwn(overrides, 'allowedActions')
    ? overrides.allowedActions
    : [{ subjectId: 'asg_1234567890abcdef', action: assignmentAction() }];
  return experienceView({ ...overrides, allowedActions });
}

function sessionRequest(view: RecordValue, selectedActor = actor) {
  const entry = (view.allowedActions as RecordValue[]).find(
    (candidate) => String((candidate.action as RecordValue).effect) !== 'read-only',
  );
  if (!entry) throw new Error(`missing command action: ${JSON.stringify(view)}`);
  return {
    cycleId: 'cyc_1234567890abcdef',
    eventHead: view.eventHead as { sequence: number; hash: string | null },
    sourceViewHash: String(view.viewHash),
    actionLocator: {
      subjectId: String(entry.subjectId),
      actionDigest: sha256Jcs(entry.action as never),
    },
    actor: selectedActor,
    origin,
  };
}

function ownerPreview(input: RecordValue, view: RecordValue) {
  const actionDigest = String(input.actionDigest);
  const entry = (view.allowedActions as RecordValue[]).find(
    (candidate) => sha256Jcs(candidate.action as never) === actionDigest,
  );
  if (!entry) throw new Error('missing owner preview action');
  const selected = entry.action as RecordValue;
  const verification = selected.tool === 'operate.assignment.submit';
  const subjectId = String(entry.subjectId);
  const base = {
    kind: 'operate-experience-preview',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    previewId: `xprv_${actionDigest.slice(7, 23)}`,
    scopeId: String(view.scopeId),
    domainId: String(view.domainId),
    domainVersion: String(view.domainVersion),
    actorId: String(view.actorId),
    subject: {
      kind: verification ? 'assignment' : 'review',
      id: subjectId,
      revision: null,
      hash: HASH_B,
    },
    eventHead: structuredClone(view.eventHead),
    sourceViewHash: String(view.viewHash),
    actionDigest,
    allowedAction: structuredClone(selected),
    authority: input.authority,
    consequence: 'One exact governed transition will be recorded after confirmation.',
    reasonCodes: structuredClone(input.reasonCodes),
    transition: {
      kind: verification ? 'verification' : 'review',
      targets: [
        {
          kind: verification ? 'assignment' : 'review',
          id: subjectId,
          revision: null,
          hash: HASH_B,
          disposition: verification ? 'submitted' : 'approved',
        },
      ],
      reversible: false,
      nextState: verification ? 'submitted' : 'approved',
      threshold: null,
    },
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
  };
  return { ...base, previewHash: sha256Jcs(base) };
}

function fakeClient(read: () => Record<string, unknown>): OperateClient {
  return {
    dispatch: vi.fn(async () => ({
      ok: true,
      operation: 'operate.experience.get',
      data: read(),
      allowedActions: [],
    })),
    createExperiencePreview: vi.fn(async (input: RecordValue) => ownerPreview(input, read())),
  } as unknown as OperateClient;
}

describe('OpenPlanr governed local command gateway', () => {
  it('is reachable through the production OpenPlanr dashboard entrypoint', async () => {
    const fixture = await createTestProject('operate-dashboard');
    let startedDashboard: Awaited<ReturnType<typeof startOperateDashboard>> | null = null;
    try {
      const client = createOperateClient(fixture.dir);
      const cycleId = await prepareContainedCycle(client, fixture.dir);
      const reviewed = await approveCurrentReview(client, cycleId);
      expect(reviewed.read.data).toMatchObject({
        kind: 'operating-review-read',
        decisions: [expect.objectContaining({ title: 'Run one contained operating change' })],
        actions: [expect.objectContaining({ title: 'Apply the contained local project record' })],
      });
      expect(reviewed.submitted.data).toMatchObject({
        kind: 'operating-review-receipt',
        decision: 'approved',
      });
      const reviewId = String((reviewed.read.data.review as RecordValue).reviewId);
      const exactReviewRequest = {
        reviewId,
        cycleId,
        actor: { actorId: 'owner-dashboard', kind: 'human' as const, runtime: 'openplanr' },
        scope: { scopeId: 'scope-dashboard', domainId: 'business', domainVersion: '1.0.0' },
      };
      const committedReceipt = await client.readCommittedReviewReceipt(exactReviewRequest);
      if (!committedReceipt.ok) throw new Error(JSON.stringify(committedReceipt));
      const receiptView = await client.readExperienceAtEventHead(
        {
          cycleId,
          actor: exactReviewRequest.actor,
          actionBinding: { cycleId, actorId: 'owner-dashboard' },
        },
        (committedReceipt.data as RecordValue).eventHead as never,
      );
      if (!receiptView.ok) throw new Error(JSON.stringify(receiptView));
      const manualPayload = buildOperateReviewWorkspacePayloadV1(
        committedReceipt.data as never,
        receiptView.data as never,
      );
      expect(() => issueOperateReviewDisplayWorkspaceV1(manualPayload)).not.toThrow();
      await expect(
        createOperatingReviewReadGatewayV1({ client })({
          cycleId,
          reviewId,
          actorId: 'owner-dashboard',
          scopeId: 'scope-dashboard',
          domainId: 'business',
          domainVersion: '1.0.0',
        }),
      ).resolves.toMatchObject({
        kind: 'operate-review-display-workspace',
        payload: { status: 'terminal', reviewId },
      });
      startedDashboard = await startOperateDashboard({
        projectDir: fixture.dir,
        cycleId,
        actorId: 'owner-dashboard',
        port: 0,
        watch: false,
        client,
        env: { ...process.env, PLANR_HOME: `${fixture.dir}/.planr-home` },
      });
      const base = `http://127.0.0.1:${startedDashboard.port}`;
      const shellResponse = await fetch(base);
      expect(shellResponse.status).toBe(200);
      const shellHtml = await shellResponse.text();
      expect(shellHtml).toContain('<div id="root"></div>');
      const entryAsset = shellHtml.match(/src="\.\/(assets\/[^"]+\.js)"/u)?.[1];
      expect(entryAsset).toBeTruthy();
      const entryResponse = await fetch(`${base}/${String(entryAsset)}`);
      expect(entryResponse.status).toBe(200);
      expect(entryResponse.headers.get('content-type')).toContain('text/javascript');
      const commandQuery = 'scopeId=scope-dashboard&domainId=business&domainVersion=1.0.0';
      const cycleResponse = await fetch(
        `${base}/api/operate/cycles/${encodeURIComponent(cycleId)}?${commandQuery}`,
        { headers: { 'x-openplanr-actor': 'owner-dashboard' } },
      );
      expect(cycleResponse.status).toBe(200);
      const cycleDisplay = assertOperateCycleDisplayWorkspaceV1(await cycleResponse.json());
      expect(cycleDisplay).toMatchObject({
        kind: 'operate-cycle-display-workspace',
        payload: {
          actorId: 'owner-dashboard',
          scopeId: 'scope-dashboard',
          domainId: 'business',
          domainVersion: '1.0.0',
          data: { cycle: { cycleId } },
        },
      });
      const reviewResponse = await fetch(
        `${base}/api/operate/cycles/${encodeURIComponent(cycleId)}/reviews/${encodeURIComponent(reviewId)}?${commandQuery}`,
        { headers: { 'x-openplanr-actor': 'owner-dashboard' } },
      );
      const reviewJson = await reviewResponse.json();
      expect(reviewResponse.status, JSON.stringify(reviewJson)).toBe(200);
      const serializedReview = JSON.stringify(reviewJson);
      expect(serializedReview).not.toContain(fixture.dir);
      expect(serializedReview).not.toContain('.planr/operate');
      expect(serializedReview).not.toMatch(/password|accessToken|refreshToken/u);
      const reviewDisplay = assertOperateReviewDisplayWorkspaceV1(reviewJson);
      expect(reviewDisplay).toMatchObject({
        kind: 'operate-review-display-workspace',
        payload: {
          actorId: 'owner-dashboard',
          scopeId: 'scope-dashboard',
          domainId: 'business',
          domainVersion: '1.0.0',
          cycleId,
          reviewId,
          status: 'terminal',
          mutationEnabled: false,
          data: {
            terminalDisposition: {
              receiptId: (reviewed.submitted.data as RecordValue).receiptId,
            },
          },
        },
      });
      const post = async (path: string, body: Record<string, unknown>, capability?: string) => {
        const response = await fetch(`${base}${path}?${commandQuery}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: base,
            'x-openplanr-actor': 'owner-dashboard',
            ...(capability ? { authorization: `Bearer ${capability}` } : {}),
          },
          body: JSON.stringify(body),
        });
        const json = (await response.json()) as Record<string, unknown>;
        if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(json)}`);
        return json;
      };
      const confirm = async (label: RegExp) => {
        const current = await currentRealExperience(client, cycleId);
        const issuedAction = ((current.allowedActions as RecordValue[]) ?? []).find((entry) =>
          label.test(String((entry.action as RecordValue).label)),
        );
        if (!issuedAction) throw new Error(`missing action ${label}: ${JSON.stringify(current)}`);
        const action = issuedAction.action as RecordValue;
        const locator = {
          subjectId: String(issuedAction.subjectId),
          actionDigest: sha256Jcs(action as never),
        };
        expect(
          ((current.inbox as RecordValue[]) ?? []).some(
            (item) =>
              (item.actionLocator as RecordValue | null)?.subjectId === locator.subjectId &&
              (item.actionLocator as RecordValue | null)?.actionDigest === locator.actionDigest,
          ),
          JSON.stringify(
            { locator, inbox: current.inbox, allowedActions: current.allowedActions },
            null,
            2,
          ),
        ).toBe(true);
        const session = await post('/api/operate/session', {
          cycleId,
          eventHead: current.eventHead,
          sourceViewHash: current.viewHash,
          actionLocator: locator,
        });
        const [selected] = session.allowedActions as RecordValue[];
        expect(selected).toMatchObject(locator);
        const capability = String(session.sessionCapability);
        const preview = await post(
          '/api/operate/commands/preview',
          {
            sessionId: session.sessionId,
            actionReference: selected.actionReference,
          },
          capability,
        );
        const confirmed = await post(
          '/api/operate/commands/confirm',
          {
            sessionId: session.sessionId,
            previewId: preview.previewId,
            previewHash: preview.previewHash,
          },
          capability,
        );
        const replayed = await post(
          '/api/operate/commands/confirm',
          {
            sessionId: session.sessionId,
            previewId: preview.previewId,
            previewHash: preview.previewHash,
          },
          capability,
        );
        expect(replayed).toEqual(confirmed);
        return confirmed;
      };
      const viewResponse = await fetch(`${base}/api/operate/today?${commandQuery}`, {
        headers: { 'x-openplanr-actor': 'owner-dashboard' },
      });
      expect(viewResponse.status).toBe(200);
      const display = assertOperateExperienceDisplaySurfaceV1(await viewResponse.json());
      expect(display).toMatchObject({
        kind: 'operate-experience-display-surface',
        schemaVersion: '1.0.0',
        protocolVersion: '2.0.0',
        payload: {
          kind: 'operate-experience-surface',
          surface: 'today',
          actorId: 'owner-dashboard',
        },
        integrity: {
          algorithm: 'sha-256-jcs',
          domain: 'openplanr:operate-experience-display-surface:1.0.0',
          sourceViewHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        },
      });
      expect(display.integrity.sourceViewHash).toBe(display.payload.viewHash);
      await confirm(/Record Action approval/u);
      const laterView = await currentRealExperience(client, cycleId);
      const receiptHead = (reviewed.submitted.data as RecordValue).eventHead as RecordValue;
      expect(Number((laterView.eventHead as RecordValue).sequence)).toBeGreaterThan(
        Number(receiptHead.sequence),
      );
      const compactedFixture = await createTestProject('operate-compacted-current-review');
      try {
        await ensureOperateStorageLayout(compactedFixture.dir);
        const composition = await createOperateComposition();
        const currentRuntime = await createOperateStore(fixture.dir).load(
          async ({ baseState, events, artifacts }) =>
            composition.replay(baseState, events, artifacts),
        );
        if (!currentRuntime) throw new Error('missing current runtime for compaction proof');
        const historical = await (
          client as unknown as {
            runtimeAtEventHead(
              runtime: OperateStoredRuntime,
              eventHead: RecordValue,
            ): Promise<OperateStoredRuntime>;
          }
        ).runtimeAtEventHead(currentRuntime, receiptHead);
        const retainedEvents = currentRuntime.events.filter(
          (event) => Number(event.sequence) > Number(receiptHead.sequence),
        );
        expect(retainedEvents.length).toBeGreaterThan(0);
        await createOperateStore(compactedFixture.dir).commit(
          {
            baseState: structuredClone(historical.state),
            state: structuredClone(currentRuntime.state),
            events: structuredClone(retainedEvents),
            artifacts: new Map(
              [...currentRuntime.artifacts].map(([artifactId, bytes]) => [
                artifactId,
                Uint8Array.from(bytes),
              ]),
            ),
            preferences: structuredClone(currentRuntime.preferences),
          },
          null,
        );
        const compactedClient = createOperateClient(compactedFixture.dir);
        const compactedExperience = await compactedClient.dispatch({
          operation: 'operate.experience.get',
          request: {
            cycleId,
            actor: { actorId: 'owner-dashboard', kind: 'human', runtime: 'openplanr' },
            actionBinding: { cycleId, actorId: 'owner-dashboard' },
          },
        });
        expect(compactedExperience, JSON.stringify(compactedExperience)).toMatchObject({
          ok: true,
          data: {
            replay: {
              checkpoint: { eventHead: receiptHead },
              tail: { eventCount: retainedEvents.length },
              parityProof: { checkpointVerified: true, stateParityVerified: false },
            },
          },
        });
        await expect(
          createOperatingReviewReadGatewayV1({ client: compactedClient })({
            cycleId,
            reviewId,
            actorId: 'owner-dashboard',
            scopeId: 'scope-dashboard',
            domainId: 'business',
            domainVersion: '1.0.0',
          }),
        ).resolves.toMatchObject({
          kind: 'operate-review-display-workspace',
          payload: {
            status: 'terminal',
            reviewId,
            sourceEventHead: receiptHead,
          },
        });
      } finally {
        compactedFixture.cleanup();
      }
      const historicalReviewResponse = await fetch(
        `${base}/api/operate/cycles/${encodeURIComponent(cycleId)}/reviews/${encodeURIComponent(reviewId)}?${commandQuery}`,
        { headers: { 'x-openplanr-actor': 'owner-dashboard' } },
      );
      const historicalReviewJson = await historicalReviewResponse.json();
      expect(historicalReviewResponse.status, JSON.stringify(historicalReviewJson)).toBe(200);
      const historicalReview = assertOperateReviewDisplayWorkspaceV1(historicalReviewJson);
      expect(historicalReview.payload.sourceEventHead).toEqual(receiptHead);
      expect(historicalReview.payload.sourceViewHash).not.toBe(laterView.viewHash);
      expect(historicalReview.payload.data.terminalDisposition?.receiptId).toBe(
        (reviewed.submitted.data as RecordValue).receiptId,
      );
      const executed = await performCurrentRealAction(
        client,
        cycleId,
        /Execute this exact approved Action/u,
      );
      expect(executed, JSON.stringify(executed, null, 2)).toMatchObject({
        ok: true,
        data: { effectCount: 1 },
      });
      const afterExecution = await currentRealExperience(client, cycleId);
      expect(afterExecution).toMatchObject({
        outcomes: [],
        allowedActions: expect.arrayContaining([
          expect.objectContaining({
            action: expect.objectContaining({
              tool: 'operate.assignment.submit',
            }),
          }),
        ]),
      });
      const verified = await confirm(/lacks accepted metric evidence/u);
      expect(verified).toMatchObject({
        ok: true,
        data: {
          outcomes: [expect.objectContaining({ status: 'insufficient-evidence' })],
          learnings: [
            expect.objectContaining({
              statement: expect.stringContaining('hypothesis remains unconfirmed'),
            }),
          ],
        },
      });
      const rollbackApproved = await confirm(/Approve this exact rollback plan/u);
      expect(rollbackApproved).toMatchObject({ ok: true });
      const beforeRollback = await currentRealExperience(client, cycleId);
      const directRollback = ((beforeRollback.allowedActions as RecordValue[]) ?? []).find(
        (entry) =>
          /Rollback this exact reversible Action/u.test(
            String((entry.action as RecordValue).label),
          ),
      );
      if (!directRollback) {
        throw new Error(`missing direct rollback: ${JSON.stringify(beforeRollback)}`);
      }
      const rollbackRequest = {
        ...(((directRollback.action as RecordValue).arguments as RecordValue) ?? {}),
        actor: { actorId: 'owner-dashboard', kind: 'human' as const, runtime: 'openplanr' },
      };
      const rolledBack = await client.dispatch({
        operation: 'operate.action.rollback',
        request: rollbackRequest as never,
      });
      expect(rolledBack, JSON.stringify(rolledBack, null, 2)).toMatchObject({
        ok: true,
        data: { effectCount: 1 },
      });
      const afterRollback = await currentRealExperience(client, cycleId);
      expect(JSON.stringify(afterRollback)).toContain('rollback.result-recorded');
      expect(JSON.stringify(afterRollback)).not.toContain('terminalReceipt');
      expect(JSON.stringify(afterRollback)).not.toContain('submissionId');
      const restarted = createOperateClient(fixture.dir);
      await expect(
        restarted.dispatch({
          operation: 'operate.action.rollback',
          request: rollbackRequest as never,
        }),
      ).resolves.toMatchObject({
        ok: true,
        data: { replayed: true, effectCount: 0 },
      });
      expect(startedDashboard.url).toBe(`${base}/#/operate/today`);
    } finally {
      await startedDashboard?.close();
      fixture.cleanup();
    }
  }, 180_000);

  it.each([
    ['approved', 'Approve'],
    ['changes_requested', 'Request changes'],
    ['rejected', 'Reject'],
  ] as const)(
    'commits the disposable %s Review choice through the bound dashboard gateway',
    async (disposition, label) => {
      const fixture = await createTestProject(`operate-review-${disposition}`);
      try {
        const client = createOperateClient(fixture.dir);
        const cycleId = await prepareContainedCycle(client, fixture.dir);
        const current = await currentRealExperience(client, cycleId);
        const reviewReadAction = ((current.allowedActions as RecordValue[]) ?? []).find(
          (candidate) => String((candidate.action as RecordValue).tool) === 'operate.review.get',
        );
        if (!reviewReadAction) throw new Error(`missing Review read: ${JSON.stringify(current)}`);
        const readArguments = (reviewReadAction.action as RecordValue).arguments as RecordValue;
        const reviewId = String(readArguments.reviewId);
        const readGateway = createOperatingReviewReadGatewayV1({ client });
        const readRequest = {
          cycleId,
          reviewId,
          actorId: 'owner-dashboard',
          scopeId: 'scope-dashboard',
          domainId: 'business',
          domainVersion: '1.0.0',
        };
        const pending = await readGateway(readRequest);
        const capability = pending.payload.data.capability;
        if (!capability.available) {
          throw new Error(`Review capability unavailable: ${JSON.stringify(capability)}`);
        }
        const selected = capability.actions.find(
          ({ action }) =>
            action.tool === 'operate.review.submit' &&
            (action.arguments as RecordValue).disposition === disposition,
        );
        if (!selected) {
          throw new Error(`missing ${disposition} choice: ${JSON.stringify(capability)}`);
        }
        expect(selected.action.label).toContain(label);

        const gateway = createOperateCommandGateway({
          client,
          runtime: createOperateClientCommandRuntime(client, readGateway),
          getOperatingReviewRead: readGateway,
        });
        const session = await gateway.issueSession({
          cycleId,
          eventHead: pending.payload.sourceEventHead,
          sourceViewHash: pending.payload.sourceViewHash,
          actionLocator: {
            subjectId: selected.subjectId,
            actionDigest: sha256Jcs(selected.action),
          },
          actor: { actorId: 'owner-dashboard', kind: 'human', runtime: 'openplanr' },
          origin,
        });
        const issued = session.allowedActions.find(
          (entry) =>
            entry.subjectId === selected.subjectId &&
            entry.actionDigest === sha256Jcs(selected.action),
        );
        if (!issued) throw new Error(`missing issued ${disposition} action reference`);
        const preview = await gateway.preview({
          sessionId: session.sessionId,
          capability: session.sessionCapability,
          origin,
          actionReference: issued.actionReference,
        });
        const note = `Disposable ${disposition} browser-gateway proof.`;
        const result = await gateway.confirm({
          sessionId: session.sessionId,
          capability: session.sessionCapability,
          origin,
          previewId: String(preview.previewId),
          previewHash: String(preview.previewHash),
          note,
        });
        if (!result.ok) throw new Error(JSON.stringify(result));
        const receipt = result.data.receipt as RecordValue;
        const terminal = result.data.workspace;
        const selectedChoice = pending.payload.data.choices.find(
          (choice) => choice.choiceHash === sha256Jcs(selected.action.arguments),
        );
        if (!selectedChoice) throw new Error(`missing displayed ${disposition} choice proof`);

        expect(receipt).toMatchObject({
          kind: 'operating-review-receipt',
          decision: disposition,
          readEventHead: pending.payload.sourceEventHead,
          appliedChoiceId: selectedChoice.choiceId,
          appliedChoiceHash: selectedChoice.choiceHash,
          boundSubmission: {
            expectedReadEventHead: pending.payload.sourceEventHead,
            choiceId: selectedChoice.choiceId,
            choiceHash: selectedChoice.choiceHash,
            submitArguments: selected.action.arguments,
            note,
          },
        });
        expect((receipt.eventHead as RecordValue).sequence).toBeGreaterThan(
          pending.payload.sourceEventHead.sequence,
        );
        expect(result.eventHead).toEqual(receipt.eventHead);
        expect(terminal).toMatchObject({
          kind: 'operate-review-display-workspace',
          payload: {
            status: 'terminal',
            mutationEnabled: false,
            sourceEventHead: receipt.eventHead,
            sourceArtifactHash: sha256Jcs(receipt),
            data: {
              choices: [],
              terminalDisposition: {
                decision: disposition,
                receiptId: receipt.receiptId,
                appliedChoiceId: selectedChoice.choiceId,
                appliedChoiceHash: selectedChoice.choiceHash,
                eventHead: receipt.eventHead,
              },
            },
          },
        });
      } finally {
        fixture.cleanup();
      }
    },
    180_000,
  );

  it('requires exact canonical Review-read custody before issuing a Review session', async () => {
    const current = experienceView();
    const request = sessionRequest(current);
    const perform = vi.fn();
    const withoutRead = createOperateCommandGateway({
      client: fakeClient(() => current),
      runtime: { perform },
    });
    await expect(withoutRead.issueSession(request)).rejects.toMatchObject({
      code: 'OPERATE_ACTION_REFERENCE_STALE',
    });

    const exact = reviewWorkspace({ currentActions: [reviewAction()], sourceView: current });
    const hostile = [
      {
        name: 'foreign owner',
        mutate(workspace: RecordValue) {
          (workspace.payload as RecordValue).actorId = 'foreign-owner';
        },
      },
      {
        name: 'stale head',
        mutate(workspace: RecordValue) {
          (workspace.payload as RecordValue).sourceEventHead = { sequence: 2, hash: HASH_B };
        },
      },
      {
        name: 'substituted choice',
        mutate(workspace: RecordValue) {
          const payload = workspace.payload as RecordValue;
          const data = payload.data as RecordValue;
          const capability = data.capability as RecordValue;
          const [entry] = capability.actions as RecordValue[];
          entry.action = { ...(entry.action as RecordValue), label: 'Substituted choice' };
        },
      },
      {
        name: 'duplicate choice',
        mutate(workspace: RecordValue) {
          const payload = workspace.payload as RecordValue;
          const data = payload.data as RecordValue;
          const capability = data.capability as RecordValue;
          const actions = capability.actions as RecordValue[];
          actions.push(structuredClone(actions[0]));
        },
      },
    ];
    for (const attack of hostile) {
      const workspace = structuredClone(exact) as unknown as RecordValue;
      attack.mutate(workspace);
      const read = vi.fn(async () => workspace as never);
      const gateway = createOperateCommandGateway({
        client: fakeClient(() => current),
        runtime: { perform },
        getOperatingReviewRead: read,
      });
      await expect(gateway.issueSession(request), attack.name).rejects.toMatchObject({
        code: 'OPERATE_ACTION_REFERENCE_STALE',
      });
      expect(read, attack.name).toHaveBeenCalledOnce();
    }

    const unsupportedEffect = { ...reviewAction(), effect: 'network-write' };
    const unsafeCurrent = experienceView({
      allowedActions: [{ subjectId: 'rev_1234567890abcdef', action: unsupportedEffect }],
    });
    const read = vi.fn(async () => exact as never);
    const unsafeGateway = createOperateCommandGateway({
      client: fakeClient(() => unsafeCurrent),
      runtime: { perform },
      getOperatingReviewRead: read,
    });
    await expect(unsafeGateway.issueSession(sessionRequest(unsafeCurrent))).rejects.toMatchObject({
      code: 'E_PROTOCOL_ARTIFACT_INVALID',
    });
    expect(read).not.toHaveBeenCalled();
    expect(perform).not.toHaveBeenCalled();
  });

  it('reuses one durable threshold rollback template across two exact parties and reloads', async () => {
    const fixture = await createTestProject('operate-rollback-threshold');
    try {
      const threshold = await createDurableThresholdRollbackRuntime(fixture.dir);
      const original = createOperateClient(fixture.dir);
      const approvalArguments = {
        action: {
          actionId: threshold.action.actionId,
          revision: threshold.action.revision,
          actionHash: threshold.action.actionHash,
        },
        decision: 'approved',
        rollback: {
          rollbackPlanId: threshold.plan.rollbackPlanId,
          planHash: threshold.plan.planHash,
          originalOperationId: threshold.plan.operationId,
          executionResultId: threshold.plan.executionResultId,
          expectedTargetHash: threshold.plan.steps[0]?.expectedTargetHash,
        },
      };
      const approve = (client: ReturnType<typeof createOperateClient>, actorId: string) =>
        client.dispatch({
          operation: 'operate.action.approve',
          request: {
            ...structuredClone(approvalArguments),
            actor: { actorId, kind: 'human' as const, runtime: 'openplanr' },
          } as never,
        });

      const first = await approve(original, 'owner-dashboard');
      expect(first, JSON.stringify(first, null, 2)).toMatchObject({
        ok: true,
        data: { complete: false },
      });
      const store = createOperateStore(fixture.dir);
      const composition = await createOperateComposition();
      const load = () =>
        store.load(async ({ baseState, events, artifacts }) =>
          composition.replay(baseState, events, artifacts),
        );
      const afterFirst = await load();
      if (!afterFirst) throw new Error('missing first-party runtime');
      const firstApprovals = ((afterFirst.state.approvalRecords as RecordValue[]) ?? []).filter(
        (record) => !threshold.executionApprovalIds.includes(String(record.approvalId)),
      );
      expect(firstApprovals).toHaveLength(1);
      const firstApproval = structuredClone(firstApprovals[0]);
      const rollbackEvaluation = ((afterFirst.state.policyEvaluations as RecordValue[]) ?? []).find(
        (candidate) => candidate.evaluationId === firstApproval.evaluationId,
      );
      const rollbackRequirement = (
        (afterFirst.state.approvalRequirements as RecordValue[]) ?? []
      ).find((candidate) => candidate.requirementId === firstApproval.requirementId);
      expect(rollbackRequirement).toMatchObject({ threshold: 2 });
      expect(
        afterFirst.events.filter(
          (event) =>
            event.type === 'policy.evaluated' &&
            event.entityId === rollbackEvaluation?.evaluationId,
        ),
      ).toHaveLength(1);

      const reloaded = createOperateClient(fixture.dir);
      const duplicate = await approve(reloaded, 'owner-dashboard');
      expect(duplicate).toMatchObject({
        ok: false,
        error: { code: 'APPROVAL_INVALID', retryable: false },
      });
      const foreign = await approve(reloaded, 'foreign-owner');
      expect(foreign).toMatchObject({
        ok: false,
        error: { code: 'APPROVAL_INVALID', retryable: false },
      });
      const second = await approve(reloaded, 'owner-dashboard-two');
      expect(second).toMatchObject({ ok: true, data: { complete: true } });

      const finalRuntime = await load();
      if (!finalRuntime) throw new Error('missing second-party runtime');
      const finalApprovals = ((finalRuntime.state.approvalRecords as RecordValue[]) ?? []).filter(
        (record) => !threshold.executionApprovalIds.includes(String(record.approvalId)),
      );
      expect(finalApprovals).toHaveLength(2);
      expect(finalApprovals).toContainEqual(firstApproval);
      expect(
        finalApprovals.map((record) => String((record.actor as RecordValue).actorId)).sort(),
      ).toEqual(['owner-dashboard', 'owner-dashboard-two']);
      expect(
        ((finalRuntime.state.policyEvaluations as RecordValue[]) ?? []).find(
          (candidate) => candidate.evaluationId === rollbackEvaluation?.evaluationId,
        ),
      ).toEqual(rollbackEvaluation);
      expect(
        ((finalRuntime.state.approvalRequirements as RecordValue[]) ?? []).find(
          (candidate) => candidate.requirementId === rollbackRequirement?.requirementId,
        ),
      ).toEqual(rollbackRequirement);
      expect(
        finalRuntime.events.filter(
          (event) =>
            event.type === 'policy.evaluated' &&
            event.entityId === rollbackEvaluation?.evaluationId,
        ),
      ).toHaveLength(1);
    } finally {
      fixture.cleanup();
    }
  });

  it('refuses blind rollback after restart without the exact process-local target receipt', async () => {
    const fixture = await createTestProject('operate-rollback-restart');
    try {
      const original = createOperateClient(fixture.dir);
      const cycleId = await prepareContainedCycle(original, fixture.dir);
      await approveCurrentReview(original, cycleId);
      for (const label of [
        /Record Action approval/u,
        /Execute this exact approved Action/u,
        /lacks accepted metric evidence/u,
        /Approve this exact rollback plan/u,
      ]) {
        const result = await performCurrentRealAction(original, cycleId, label);
        if (!result.ok) throw new Error(JSON.stringify(result));
      }
      const before = await currentRealExperience(original, cycleId);
      const rollbackEntry = ((before.allowedActions as RecordValue[]) ?? []).find((candidate) =>
        /Rollback this exact reversible Action/u.test(
          String((candidate.action as RecordValue).label),
        ),
      );
      if (!rollbackEntry) throw new Error(`missing rollback: ${JSON.stringify(before)}`);
      const request = {
        ...((((rollbackEntry.action as RecordValue).arguments as RecordValue) ?? {}) as object),
        actor: { actorId: 'owner-dashboard', kind: 'human' as const, runtime: 'openplanr' },
      };
      const restarted = createOperateClient(fixture.dir);
      const first = await restarted.dispatch({
        operation: 'operate.action.rollback',
        request: request as never,
      });
      const second = await restarted.dispatch({
        operation: 'operate.action.rollback',
        request: request as never,
      });
      for (const refusal of [first, second]) {
        expect(refusal).toMatchObject({
          ok: false,
          error: {
            code: 'OPERATION_UNCERTAIN',
            retryable: false,
            message: expect.stringContaining('blind rollback is forbidden'),
          },
        });
      }
      const after = await currentRealExperience(restarted, cycleId);
      expect(after.eventHead).toEqual(before.eventHead);
      expect(after.outcomes).toEqual(before.outcomes);
      expect(after.learnings).toEqual(before.learnings);
    } finally {
      fixture.cleanup();
    }
  });

  it('renders runtime-provided governed action value without exposing exact arguments', () => {
    const lines = renderOperateExperienceSurfaceHuman({
      kind: 'operate-experience-surface',
      surface: 'today',
      domainId: 'business',
      scopeId: 'scope-acme',
      status: 'ready',
      eventHead: { sequence: 1 },
      viewHash: HASH_A,
      reasonCodes: [],
      data: {
        attention: [],
        allowedActions: [{ subjectId: 'rev_1234567890abcdef', action: reviewAction() }],
      },
    });
    expect(lines).toContain('Available governed actions:');
    expect(lines).toContain('- Approve this exact operating decision · project-write');
    expect(lines.join('\n')).not.toContain('workDispositions');
  });

  it('binds one opaque writable action to an unguessable local session and exact preview', async () => {
    let current = assignmentExperienceView();
    const perform = vi.fn(async () => {
      current = assignmentExperienceView({
        eventHead: { sequence: 2, hash: HASH_B },
        sourceStateHash: HASH_A,
        allowedActions: [],
      });
      return {
        ok: true as const,
        operation: 'operate.assignment.submit' as const,
        data: { durableResultId: 'res_1234567890abcdef', effectCount: 1 },
        allowedActions: [],
      };
    });
    const gateway = createOperateCommandGateway({
      client: fakeClient(() => current),
      runtime: { perform },
    });
    const session = await gateway.issueSession(sessionRequest(current));
    expect(session.sessionCapability).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(session.allowedActions).toHaveLength(1);
    expect(session.allowedActions[0]).toMatchObject({
      actionReference: expect.stringMatching(/^opact_/u),
      subjectId: 'asg_1234567890abcdef',
      actionDigest: sha256Jcs(assignmentAction()),
    });
    expect(JSON.stringify(session)).not.toContain('workDispositions');
    expect(JSON.stringify(session)).not.toContain('grants');

    const preview = await gateway.preview({
      sessionId: session.sessionId,
      capability: session.sessionCapability,
      origin,
      actionReference: session.allowedActions[0].actionReference,
    });
    expect(preview).toMatchObject({
      kind: 'operate-experience-preview',
      scopeId: 'scope-acme',
      domainId: 'business',
      domainVersion: '1.0.0',
      actorId: actor.actorId,
      eventHead: { sequence: 1, hash: HASH_A },
      allowedAction: assignmentAction(),
      authority: 'allowed',
    });

    const result = await gateway.confirm({
      sessionId: session.sessionId,
      capability: session.sessionCapability,
      origin,
      previewId: String(preview.previewId),
      previewHash: String(preview.previewHash),
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        kind: 'operate-experience-view',
        eventHead: { sequence: 2, hash: HASH_B },
      },
    });
    expect(JSON.stringify(result)).not.toContain('durableResultId');
    expect(perform).toHaveBeenCalledOnce();
    expect(perform.mock.calls[0][0]).toMatchObject({
      action: assignmentAction(),
      actor,
      binding: {
        actorId: actor.actorId,
        scopeId: 'scope-acme',
        domainId: 'business',
        domainVersion: '1.0.0',
        cycleId: 'cyc_1234567890abcdef',
        eventHead: { sequence: 1, hash: HASH_A },
        sourceViewHash: expect.stringMatching(/^sha256:/u),
        actionLocator: {
          subjectId: 'asg_1234567890abcdef',
          actionDigest: sha256Jcs(assignmentAction()),
        },
      },
      previewId: preview.previewId,
      previewHash: preview.previewHash,
    });

    const exactReplay = await gateway.confirm({
      sessionId: session.sessionId,
      capability: session.sessionCapability,
      origin,
      previewId: String(preview.previewId),
      previewHash: String(preview.previewHash),
    });
    expect(exactReplay).toEqual(result);
    expect(perform).toHaveBeenCalledOnce();

    await expect(
      gateway.preview({
        sessionId: session.sessionId,
        capability: session.sessionCapability,
        origin,
        actionReference: 'opact_caller_forged_reference',
      }),
    ).rejects.toMatchObject({ code: 'OPERATE_ACTION_REFERENCE_INVALID' });
    await expect(
      gateway.preview({
        sessionId: session.sessionId,
        capability: session.sessionCapability,
        origin: 'http://localhost:7473',
        actionReference: session.allowedActions[0].actionReference,
      }),
    ).rejects.toBeInstanceOf(OperateSessionCapabilityError);
    await expect(
      gateway.confirm({
        sessionId: session.sessionId,
        capability: session.sessionCapability,
        origin,
        previewId: String(preview.previewId),
        previewHash: HASH_B,
      }),
    ).rejects.toMatchObject({ code: 'OPERATE_PREVIEW_CONFLICT' });

    expect(perform).toHaveBeenCalledOnce();
  });

  it('preserves the immutable Review receipt with the exact refreshed terminal workspace', async () => {
    let current = experienceView();
    const note = 'Approve after reviewing the exact evidence.';
    const receipt = terminalReviewReceipt(note);
    const workspace = reviewWorkspace({ receipt });
    const pendingWorkspace = reviewWorkspace({
      currentActions: [reviewAction()],
      sourceView: current,
    });
    const perform = vi.fn(async () => {
      current = experienceView({
        eventHead: { sequence: 3, hash: HASH_C },
        sourceStateHash: HASH_A,
        allowedActions: [],
      });
      return {
        ok: true as const,
        operation: 'operate.review.submit' as const,
        data: structuredClone(receipt),
        allowedActions: [],
      };
    });
    const getOperatingReviewRead = vi
      .fn()
      .mockResolvedValueOnce(structuredClone(pendingWorkspace) as never)
      .mockResolvedValue(structuredClone(workspace) as never);
    const gateway = createOperateCommandGateway({
      client: fakeClient(() => current),
      runtime: { perform },
      getOperatingReviewRead,
    });
    const session = await gateway.issueSession(sessionRequest(current));
    const preview = await gateway.preview({
      sessionId: session.sessionId,
      capability: session.sessionCapability,
      origin,
      actionReference: session.allowedActions[0].actionReference,
    });
    const confirmation = {
      sessionId: session.sessionId,
      capability: session.sessionCapability,
      origin,
      previewId: String(preview.previewId),
      previewHash: String(preview.previewHash),
      note,
    };
    const result = await gateway.confirm(confirmation);
    expect(result).toEqual({
      ok: true,
      operation: 'operate.review.submit',
      data: { receipt, workspace },
      allowedActions: [],
      eventHead: receipt.eventHead,
    });
    await expect(gateway.confirm(confirmation)).resolves.toEqual(result);
    await expect(
      gateway.confirm({ ...confirmation, note: 'Changed after commit.' }),
    ).rejects.toMatchObject({
      code: 'OPERATE_PREVIEW_CONFLICT',
    });
    expect(perform).toHaveBeenCalledOnce();
    expect(getOperatingReviewRead).toHaveBeenCalledWith({
      cycleId: 'cyc_1234567890abcdef',
      reviewId: 'rev_1234567890abcdef',
      actorId: actor.actorId,
      scopeId: 'scope-acme',
      domainId: 'business',
      domainVersion: '1.0.0',
    });
  });

  it('returns only current legal Review actions when the confirmed read is stale', async () => {
    let current = experienceView();
    const perform = vi.fn();
    const getOperatingReviewRead = vi.fn(
      async () =>
        reviewWorkspace({ currentActions: [reviewAction()], sourceView: current }) as never,
    );
    const gateway = createOperateCommandGateway({
      client: fakeClient(() => current),
      runtime: { perform },
      getOperatingReviewRead,
    });
    const session = await gateway.issueSession(sessionRequest(current));
    const preview = await gateway.preview({
      sessionId: session.sessionId,
      capability: session.sessionCapability,
      origin,
      actionReference: session.allowedActions[0].actionReference,
    });
    current = experienceView({
      eventHead: { sequence: 2, hash: HASH_B },
      sourceStateHash: HASH_A,
    });

    await expect(
      gateway.confirm({
        sessionId: session.sessionId,
        capability: session.sessionCapability,
        origin,
        previewId: String(preview.previewId),
        previewHash: String(preview.previewHash),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'CONCURRENT_MODIFICATION', retryable: false, context: {} },
      allowedActions: [reviewAction()],
    });
    expect(perform).not.toHaveBeenCalled();
    expect(JSON.stringify(await getOperatingReviewRead.mock.results[0].value)).not.toContain(
      '/Users/',
    );
  });

  it('normalizes a determinate Review race after the current-view check and returns refreshed actions', async () => {
    const current = experienceView();
    const perform = vi.fn(async () => ({
      ok: false as const,
      operation: 'operate.review.submit' as const,
      error: {
        code: 'OPERATE_ACTION_REFERENCE_STALE' as never,
        message: 'private changed choice details',
        retryable: false,
        context: { path: '/Users/private/operate-store' },
      },
      allowedActions: [],
    }));
    const getOperatingReviewRead = vi.fn(
      async () =>
        reviewWorkspace({ currentActions: [reviewAction()], sourceView: current }) as never,
    );
    const gateway = createOperateCommandGateway({
      client: fakeClient(() => current),
      runtime: { perform },
      getOperatingReviewRead,
    });
    const session = await gateway.issueSession(sessionRequest(current));
    const preview = await gateway.preview({
      sessionId: session.sessionId,
      capability: session.sessionCapability,
      origin,
      actionReference: session.allowedActions[0].actionReference,
    });

    const result = await gateway.confirm({
      sessionId: session.sessionId,
      capability: session.sessionCapability,
      origin,
      previewId: String(preview.previewId),
      previewHash: String(preview.previewHash),
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'CONCURRENT_MODIFICATION', retryable: false, context: {} },
      allowedActions: [reviewAction()],
    });
    expect(JSON.stringify(result)).not.toContain('private changed choice');
    expect(JSON.stringify(result)).not.toContain('/Users/');
    expect(perform).toHaveBeenCalledOnce();
    expect(getOperatingReviewRead).toHaveBeenCalledTimes(2);
  });

  it('treats an untyped post-dispatch Review failure as commit uncertainty', async () => {
    const current = experienceView();
    const gateway = createOperateCommandGateway({
      client: fakeClient(() => current),
      runtime: {
        perform: vi.fn(async () => {
          throw new Error('private transport failure after dispatch');
        }),
      },
      getOperatingReviewRead: vi.fn(
        async () =>
          reviewWorkspace({ currentActions: [reviewAction()], sourceView: current }) as never,
      ),
    });
    const session = await gateway.issueSession(sessionRequest(current));
    const preview = await gateway.preview({
      sessionId: session.sessionId,
      capability: session.sessionCapability,
      origin,
      actionReference: session.allowedActions[0].actionReference,
    });
    const result = await gateway.confirm({
      sessionId: session.sessionId,
      capability: session.sessionCapability,
      origin,
      previewId: String(preview.previewId),
      previewHash: String(preview.previewHash),
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'OPERATION_UNCERTAIN', retryable: false, context: {} },
      allowedActions: [reviewAction()],
    });
    expect(JSON.stringify(result)).not.toContain('private transport failure');
  });

  it('builds and submits one canonical bound wrapper from the exact Review choice', async () => {
    const selected = reviewAction();
    const workspace = reviewWorkspace({ currentActions: [selected] });
    const submitBoundReview = vi.fn(async (submission) => ({
      ok: true as const,
      operation: 'operate.review.submit' as const,
      data: { boundSubmission: submission },
      allowedActions: [],
    }));
    const runtime = createOperateClientCommandRuntime(
      { submitBoundReview } as unknown as OperateClient,
      vi.fn(async () => structuredClone(workspace) as never),
    );
    const result = await runtime.perform({
      action: selected,
      actor,
      binding: {
        actorId: actor.actorId,
        scopeId: 'scope-acme',
        domainId: 'business',
        domainVersion: '1.0.0',
        cycleId: 'cyc_1234567890abcdef',
        eventHead: { sequence: 2, hash: HASH_B },
        sourceViewHash: HASH_A,
        actionLocator: {
          subjectId: 'rev_1234567890abcdef',
          actionDigest: sha256Jcs(selected),
        },
      },
      previewId: 'xprv_1234567890abcdef',
      previewHash: HASH_A,
      note: 'Owner-reviewed evidence is sufficient.',
    });
    expect(result.ok).toBe(true);
    expect(submitBoundReview).toHaveBeenCalledWith({
      kind: 'operate-review-bound-submission',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      expectedReadEventHead: { sequence: 2, hash: HASH_B },
      choiceId: 'rch_1234567890abcdef',
      choiceHash: sha256Jcs(selected.arguments),
      submitArguments: selected.arguments,
      note: 'Owner-reviewed evidence is sufficient.',
      boundSubmissionHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  });

  it('atomically coalesces concurrent exact confirmation and dispatches once', async () => {
    let current = assignmentExperienceView();
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const perform = vi.fn(async () => {
      await blocked;
      current = assignmentExperienceView({
        eventHead: { sequence: 2, hash: HASH_B },
        sourceStateHash: HASH_A,
        allowedActions: [],
      });
      return {
        ok: true as const,
        operation: 'operate.assignment.submit' as const,
        data: { internalReceipt: 'must-not-project' },
        allowedActions: [],
      };
    });
    const gateway = createOperateCommandGateway({
      client: fakeClient(() => current),
      runtime: { perform },
    });
    const session = await gateway.issueSession(sessionRequest(current));
    const preview = await gateway.preview({
      sessionId: session.sessionId,
      capability: session.sessionCapability,
      origin,
      actionReference: session.allowedActions[0].actionReference,
    });
    const request = {
      sessionId: session.sessionId,
      capability: session.sessionCapability,
      origin,
      previewId: String(preview.previewId),
      previewHash: String(preview.previewHash),
    };
    const first = gateway.confirm(request);
    const second = gateway.confirm(request);
    await vi.waitFor(() => expect(perform).toHaveBeenCalledOnce());
    release?.();
    const [left, right] = await Promise.all([first, second]);
    expect(left).toEqual(right);
    expect(JSON.stringify(left)).not.toContain('internalReceipt');
    expect(perform).toHaveBeenCalledOnce();
  });

  it('rejects foreign bindings before action access and after an effect without leaking them', async () => {
    let current = assignmentExperienceView();
    const published: Record<string, unknown>[] = [];
    const perform = vi.fn(async () => {
      current = assignmentExperienceView({
        actorId: 'foreign-actor-must-not-leak',
        eventHead: { sequence: 2, hash: HASH_B },
        sourceStateHash: HASH_A,
        allowedActions: [],
      });
      return {
        ok: true as const,
        operation: 'operate.assignment.submit' as const,
        data: { foreignResult: 'must-not-leak' },
        allowedActions: [],
      };
    });
    const gateway = createOperateCommandGateway({
      client: fakeClient(() => current),
      runtime: { perform },
      onView: (view) => published.push(view),
    });
    const session = await gateway.issueSession(sessionRequest(current));
    const preview = await gateway.preview({
      sessionId: session.sessionId,
      capability: session.sessionCapability,
      origin,
      actionReference: session.allowedActions[0].actionReference,
    });
    const result = await gateway.confirm({
      sessionId: session.sessionId,
      capability: session.sessionCapability,
      origin,
      previewId: String(preview.previewId),
      previewHash: String(preview.previewHash),
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'OPERATION_UNCERTAIN', retryable: false, context: {} },
    });
    expect(JSON.stringify(result)).not.toContain('foreign-actor-must-not-leak');
    expect(JSON.stringify(result)).not.toContain('foreignResult');
    expect(perform).toHaveBeenCalledOnce();
    expect(published.length).toBeGreaterThan(0);
    expect(published.every((view) => view.actorId === actor.actorId)).toBe(true);
    const safeCount = published.length;

    current = assignmentExperienceView({ scopeId: 'foreign-scope-must-not-leak' });
    await expect(
      gateway.preview({
        sessionId: session.sessionId,
        capability: session.sessionCapability,
        origin,
        actionReference: session.allowedActions[0].actionReference,
      }),
    ).rejects.toMatchObject({ code: 'OPERATE_BINDING_MISMATCH' });
    expect(perform).toHaveBeenCalledOnce();
    expect(published).toHaveLength(safeCount);
  });

  it('accepts only a runtime-returned canonical verification submission control', async () => {
    const verification = {
      tool: 'operate.assignment.submit',
      arguments: {
        assignmentId: 'asg_1234567890abcdef',
        submissionId: 'sub_1234567890abcdef',
        actor,
        mediaType: 'application/json',
        encoding: 'utf-8',
        contentBase64: 'e30=',
      },
      label: 'Submit the exact verification observation',
      effect: 'machine-local-write',
    };
    let current = experienceView({
      allowedActions: [{ subjectId: 'asg_1234567890abcdef', action: verification }],
    });
    const perform = vi.fn(async () => {
      current = experienceView({
        eventHead: { sequence: 2, hash: HASH_B },
        sourceStateHash: HASH_A,
        allowedActions: [],
      });
      return {
        ok: true as const,
        operation: 'operate.assignment.submit' as const,
        data: {},
        allowedActions: [],
      };
    });
    const gateway = createOperateCommandGateway({
      client: fakeClient(() => current),
      runtime: { perform },
    });
    const session = await gateway.issueSession(sessionRequest(current));
    expect(session.allowedActions).toHaveLength(1);
    const preview = await gateway.preview({
      sessionId: session.sessionId,
      capability: session.sessionCapability,
      origin,
      actionReference: session.allowedActions[0].actionReference,
    });
    expect(preview).toMatchObject({
      subject: { kind: 'assignment', id: 'asg_1234567890abcdef' },
      allowedAction: verification,
    });
    await expect(
      gateway.confirm({
        sessionId: session.sessionId,
        capability: session.sessionCapability,
        origin,
        previewId: String(preview.previewId),
        previewHash: String(preview.previewHash),
      }),
    ).resolves.toMatchObject({ ok: true, data: { eventHead: { sequence: 2, hash: HASH_B } } });
    expect(perform).toHaveBeenCalledOnce();
  });

  it('preserves the exact runtime-issued claimant on assignment submit', async () => {
    const dispatch = vi.fn(async (request) => ({
      ok: true as const,
      operation: request.operation,
      data: {},
      allowedActions: [],
    }));
    const runtime = createOperateClientCommandRuntime({ dispatch } as unknown as OperateClient);
    const verification = {
      tool: 'operate.assignment.submit',
      arguments: {
        assignmentId: 'asg_1234567890abcdef',
        submissionId: 'sub_1234567890abcdef',
        actor,
        mediaType: 'application/json',
        encoding: 'utf-8',
        contentBase64: 'e30=',
      },
      label: 'Submit the exact verification observation',
      effect: 'machine-local-write',
    };
    await runtime.perform({
      action: verification,
      actor,
      binding: {} as OperateSessionBindingV2,
      previewId: 'opprv_1234567890abcdef',
      previewHash: HASH_A,
    });
    expect(dispatch).toHaveBeenLastCalledWith({
      operation: 'operate.assignment.submit',
      request: verification.arguments,
    });
    expect(dispatch.mock.calls[0][0].request).toMatchObject({ actor });
  });

  it('invalidates stale/expired authority before dispatch and disables commands in read-only state', async () => {
    let now = Date.parse('2026-08-11T08:00:00.000Z');
    let current = assignmentExperienceView();
    const perform = vi.fn();
    const sessions = createOperateSessionCapabilityIssuerV2({ now: () => now });
    const gateway = createOperateCommandGateway({
      client: fakeClient(() => current),
      runtime: { perform },
      sessions,
      now: () => now,
    });
    const session = await gateway.issueSession(sessionRequest(current));
    const preview = await gateway.preview({
      sessionId: session.sessionId,
      capability: session.sessionCapability,
      origin,
      actionReference: session.allowedActions[0].actionReference,
    });
    current = assignmentExperienceView({ eventHead: { sequence: 2, hash: HASH_B } });
    await expect(
      gateway.confirm({
        sessionId: session.sessionId,
        capability: session.sessionCapability,
        origin,
        previewId: String(preview.previewId),
        previewHash: String(preview.previewHash),
      }),
    ).rejects.toMatchObject({ code: 'OPERATE_PREVIEW_STALE' });
    expect(perform).not.toHaveBeenCalled();

    current = assignmentExperienceView();
    const expiring = await gateway.issueSession(sessionRequest(current));
    const expiringPreview = await gateway.preview({
      sessionId: expiring.sessionId,
      capability: expiring.sessionCapability,
      origin,
      actionReference: expiring.allowedActions[0].actionReference,
    });
    now += 2 * 60 * 1000;
    await expect(
      gateway.confirm({
        sessionId: expiring.sessionId,
        capability: expiring.sessionCapability,
        origin,
        previewId: String(expiringPreview.previewId),
        previewHash: String(expiringPreview.previewHash),
      }),
    ).rejects.toMatchObject({ code: 'OPERATE_PREVIEW_EXPIRED' });

    current = assignmentExperienceView({ status: 'read-only' });
    await expect(gateway.issueSession(sessionRequest(current))).rejects.toMatchObject({
      code: 'OPERATE_ACTION_REFERENCE_STALE',
    });
  });

  it('asserts the exact session binding without projection, action, preview, or runtime access', async () => {
    let now = Date.parse('2026-08-11T08:00:00.000Z');
    const client = fakeClient(() => assignmentExperienceView());
    const perform = vi.fn();
    const sessions = createOperateSessionCapabilityIssuerV2({ now: () => now });
    const gateway = createOperateCommandGateway({
      client,
      runtime: { perform },
      sessions,
      now: () => now,
    });
    const session = await gateway.issueSession(sessionRequest(assignmentExperienceView()));
    vi.mocked(client.dispatch).mockClear();
    expect(
      gateway.assertSessionBinding({
        sessionId: session.sessionId,
        capability: session.sessionCapability,
        origin,
      }),
    ).toEqual(session.binding);
    expect(client.dispatch).not.toHaveBeenCalled();
    expect(perform).not.toHaveBeenCalled();

    for (const request of [
      {
        sessionId: 'opsess_unknown_1234567890abcdef',
        capability: session.sessionCapability,
        origin,
      },
      {
        sessionId: session.sessionId,
        capability: 'B'.repeat(43),
        origin,
      },
      {
        sessionId: session.sessionId,
        capability: session.sessionCapability,
        origin: 'http://localhost:7473',
      },
    ]) {
      expect(() => gateway.assertSessionBinding(request)).toThrow(OperateCommandGatewayErrorV2);
    }
    sessions.revoke(session.sessionId);
    expect(() =>
      gateway.assertSessionBinding({
        sessionId: session.sessionId,
        capability: session.sessionCapability,
        origin,
      }),
    ).toThrow(OperateCommandGatewayErrorV2);

    const expiring = await gateway.issueSession(sessionRequest(assignmentExperienceView()));
    vi.mocked(client.dispatch).mockClear();
    now += 10 * 60 * 1000;
    expect(() =>
      gateway.assertSessionBinding({
        sessionId: expiring.sessionId,
        capability: expiring.sessionCapability,
        origin,
      }),
    ).toThrow(OperateCommandGatewayErrorV2);
    expect(client.dispatch).not.toHaveBeenCalled();
    expect(perform).not.toHaveBeenCalled();
  });

  it('revokes capabilities on process restart and rejects binding substitution', () => {
    const binding: OperateSessionBindingV2 = {
      actorId: actor.actorId,
      scopeId: 'scope-acme',
      domainId: 'business',
      domainVersion: '1.0.0',
      cycleId: 'cyc_1234567890abcdef',
      eventHead: { sequence: 1, hash: HASH_A },
      sourceViewHash: HASH_B,
      actionLocator: {
        subjectId: 'rev_1234567890abcdef',
        actionDigest: sha256Jcs(reviewAction()),
      },
    };
    const firstProcess = createOperateSessionCapabilityIssuerV2();
    const issued = firstProcess.issue(binding, origin);
    expect(
      firstProcess.authorize({
        sessionId: issued.sessionId,
        capability: issued.capability,
        origin,
        binding,
      }).binding,
    ).toEqual(binding);
    expect(() =>
      firstProcess.authorize({
        sessionId: issued.sessionId,
        capability: issued.capability,
        origin,
        binding: { ...binding, scopeId: 'scope-substituted' },
      }),
    ).toThrow(OperateSessionCapabilityError);
    const restartedProcess = createOperateSessionCapabilityIssuerV2();
    expect(() =>
      restartedProcess.authorize({
        sessionId: issued.sessionId,
        capability: issued.capability,
        origin,
        binding,
      }),
    ).toThrow(OperateSessionCapabilityError);
  });

  it('rejects unsupported request fields before any state read or effect', async () => {
    const client = fakeClient(() => experienceView());
    const perform = vi.fn();
    const gateway = createOperateCommandGateway({ client, runtime: { perform } });
    await expect(
      gateway.issueSession({
        cycleId: 'cyc_1234567890abcdef',
        actor,
        origin,
        executor: 'caller-selected',
      } as never),
    ).rejects.toBeInstanceOf(OperateCommandGatewayErrorV2);
    expect(client.dispatch).not.toHaveBeenCalled();
    expect(perform).not.toHaveBeenCalled();
  });

  it('exposes recovery inspection through one closed read method', async () => {
    const envelope = {
      ok: true,
      operation: 'operate.recovery.inspect',
      data: { recovery: null },
      allowedActions: [],
    } as unknown as OperateApiEnvelopeV2;
    const dispatch = vi.fn().mockResolvedValue(envelope);
    const perform = vi.fn();
    const gateway = createOperateCommandGateway({
      client: { dispatch } as unknown as OperateClient,
      runtime: { perform },
    });

    await expect(gateway.inspectRecovery()).resolves.toBe(envelope);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({
      operation: 'operate.recovery.inspect',
      request: {},
    });
    expect(perform).not.toHaveBeenCalled();
  });
});
