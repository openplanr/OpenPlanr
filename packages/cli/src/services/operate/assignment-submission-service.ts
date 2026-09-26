import { createHash } from 'node:crypto';
import {
  assertAcceptedLiveEvidenceBridgeV2,
  assertOperatingLiveEvidenceIngestionV2,
} from 'planr-pipeline';
import { createOperatingActionReviewV2 } from 'planr-pipeline/operate/approvals-v2';
import {
  promoteOperatingActionAuthorityV2,
  recordOperatingTerminalVerificationInsufficientEvidenceV2,
} from 'planr-pipeline/operate/runtime-v2';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { stageRuntimeAssignmentSubmission } from './assignment-lifecycle-service.js';
import { OperateClientError } from './client-error.js';
import {
  type CreateEvent,
  cycleReadActions,
  operateSuccess,
  PROTOCOL_VERSION,
  type ReplaySafeIssue,
  type RuntimeState,
  record,
  stableId,
  state,
} from './client-support.js';
import type {
  LiveEvidenceSubmissionPreparationV2,
  LiveEvidenceSubmissionRequestV2,
  LiveEvidenceSubmissionResultV2,
  OperateActorV2,
  OperateApiEnvelopeV2,
  SubmitRequest,
} from './client-types.js';
import type { JsonRecord, OperateComposition } from './composition.js';
import {
  configureContainedActionAuthority,
  containedActionAuthorityInput,
  deliveryActionAuthorityInput,
  governedArtifactStore,
  mergeRecordsBy,
} from './governed-action-service.js';
import {
  retryReplaySafeGenerationConflict,
  withOperateMutationLane,
} from './replay-safe-retry-service.js';
import type { OperateStore, OperateStoredRuntime } from './store.js';

type SubmissionDependencies = Readonly<{
  root: string;
  requiredRuntime: () => Promise<OperateStoredRuntime>;
  composition: () => Promise<OperateComposition>;
  commit: OperateStore['commit'];
}>;

type AssignmentSubmission = SubmissionDependencies &
  Readonly<{ request: SubmitRequest; createEvent: CreateEvent }>;

function isLiveEvidenceAssignment(value: unknown): value is JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const assignment = value as JsonRecord;
  const outputContract = assignment.outputContract;
  return (
    assignment.assignmentKind === 'verification' &&
    outputContract !== null &&
    typeof outputContract === 'object' &&
    !Array.isArray(outputContract) &&
    (outputContract as JsonRecord).schemaId === 'operating-live-evidence-ingestion' &&
    (outputContract as JsonRecord).schemaVersion === '2.0.0' &&
    (outputContract as JsonRecord).mediaType === 'application/json' &&
    (outputContract as JsonRecord).encoding === 'utf-8'
  );
}

export function liveEvidenceSubmissionPreparation(
  runtime: OperateStoredRuntime,
  input: Readonly<{
    assignmentId: string;
    submissionId: string;
    actor: OperateActorV2;
  }>,
): LiveEvidenceSubmissionPreparationV2 {
  const snapshot = state(runtime);
  const assignment = snapshot.assignments.find(
    (candidate) => candidate.assignmentId === input.assignmentId,
  );
  const submission = snapshot.submissions.find(
    (candidate) =>
      candidate.assignmentId === input.assignmentId &&
      candidate.submissionId === input.submissionId,
  );
  const claim =
    assignment?.claim !== null &&
    typeof assignment?.claim === 'object' &&
    !Array.isArray(assignment.claim)
      ? (assignment.claim as JsonRecord)
      : null;
  if (
    !assignment ||
    !submission ||
    !isLiveEvidenceAssignment(assignment) ||
    !['running', 'validated'].includes(String(assignment.state)) ||
    !['issued', 'accepted'].includes(String(submission.state)) ||
    claim === null ||
    claim.actorId !== input.actor.actorId ||
    claim.actorKind !== input.actor.kind ||
    claim.runtime !== input.actor.runtime
  ) {
    throw new OperateClientError(
      'CAPABILITY_DENIED',
      'Live evidence requires the exact retained claimant and issued ingestion Assignment.',
      false,
      { assignmentId: input.assignmentId, submissionId: input.submissionId },
    );
  }
  const artifactId = runtime.preferences.assignmentArtifactIds[input.assignmentId];
  if (typeof artifactId !== 'string' || artifactId.length === 0) {
    throw new OperateClientError(
      'OPERATE_STORE_CORRUPT',
      'The live-evidence Assignment lost its runtime-owned Artifact reservation.',
      false,
      { assignmentId: input.assignmentId },
    );
  }
  const issuedAssignment =
    assignment.state === 'validated'
      ? { ...structuredClone(assignment), state: 'running', completedAt: null }
      : structuredClone(assignment);
  const identities = {
    assignmentHash: sha256Jcs(issuedAssignment as never),
    assignmentId: input.assignmentId,
    submissionId: input.submissionId,
    artifactId,
    ingestionId: stableId('ling', `live-evidence-ingestion:${input.submissionId}`),
    candidateId: stableId('evc', `live-evidence-candidate:${input.submissionId}`),
    evidenceRefId: stableId('evr', `live-evidence-ref:${input.submissionId}`),
    evidenceArtifactId: stableId('art', `live-evidence-snapshot:${input.submissionId}`),
    evidenceResolutionId: stableId('evs', `live-evidence-resolution:${input.submissionId}`),
    resolutionEventId: stableId('evt', `live-evidence-resolution:${input.submissionId}`),
    acceptanceEventIds: {
      submitted: stableId('evt', `${input.submissionId}:submitted`),
      artifactCreated: stableId('evt', `${input.submissionId}:artifact-created`),
      validated: stableId('evt', `${input.submissionId}:validated`),
    },
    correlationId: stableId('corr', `live-evidence:${input.submissionId}`),
  };
  return Object.freeze({
    assignment: issuedAssignment,
    submissionId: identities.submissionId,
    artifactId: identities.artifactId,
    ingestionId: identities.ingestionId,
    candidateId: identities.candidateId,
    evidenceRefId: identities.evidenceRefId,
    evidenceArtifactId: identities.evidenceArtifactId,
    evidenceResolutionId: identities.evidenceResolutionId,
    resolutionEventId: identities.resolutionEventId,
    acceptanceEventIds: Object.freeze({ ...identities.acceptanceEventIds }),
    correlationId: identities.correlationId,
    preparationHash: sha256Jcs(identities as never),
  });
}

function parseLiveEvidenceIngestion(contentBase64: string): JsonRecord {
  let decoded: string;
  let value: unknown;
  try {
    const bytes = Buffer.from(contentBase64, 'base64');
    if (bytes.toString('base64') !== contentBase64) throw new Error('non-canonical base64');
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(decoded);
  } catch {
    throw new OperateClientError(
      'RESULT_CONTRACT_INVALID',
      'Live-evidence submission bytes must be canonical base64 containing valid UTF-8 JSON.',
      false,
    );
  }
  return record(value);
}

/** Accept one Assignment result in the replay-safe mutation lane and commit its follow-on work. */
export async function submitOperateAssignment(
  input: AssignmentSubmission & Readonly<{ issueFactory: () => () => ReplaySafeIssue }>,
): Promise<OperateApiEnvelopeV2> {
  const { request } = input;
  const issue = input.issueFactory();
  return await retryReplaySafeGenerationConflict(`submit:${sha256Jcs(request as never)}`, () =>
    withOperateMutationLane(input.root, () => submitAttempt(input, issue())),
  );
}

async function submitAttempt(
  input: AssignmentSubmission,
  issue: ReplaySafeIssue,
): Promise<OperateApiEnvelopeV2> {
  const { request } = input;
  const runtime = await input.requiredRuntime();
  const snapshot = state(runtime);
  const requestedAssignment = snapshot.assignments.find(
    (candidate) => candidate.assignmentId === request.assignmentId,
  );
  if (isLiveEvidenceAssignment(requestedAssignment)) {
    throw new OperateClientError(
      'CAPABILITY_DENIED',
      'Live-evidence ingestion requires the governed connector bridge and exact local consent custody.',
      false,
      { assignmentId: request.assignmentId, submissionId: request.submissionId },
    );
  }
  const composition = await input.composition();
  const artifacts = new Map(runtime.artifacts);
  const { assignment, accepted } = stageRuntimeAssignmentSubmission({
    composition,
    request,
    runtimeState: runtime.state,
    artifactBytes: artifacts,
    assignmentArtifactIds: runtime.preferences.assignmentArtifactIds,
    issue,
    refuse: (code, message, context = {}) => {
      throw new OperateClientError(code, message, false, context);
    },
  });
  if (accepted.replayed) {
    return operateSuccess(
      'operate.assignment.submit',
      accepted.response,
      cycleReadActions(String(assignment.cycleId), request.actor),
    );
  }
  if (assignment.assignmentKind === 'verification') {
    const submission = snapshot.submissions.find(
      (candidate) =>
        candidate.assignmentId === assignment.assignmentId &&
        candidate.submissionId === request.submissionId &&
        candidate.state === 'issued',
    );
    const operation = snapshot.governedOperations.find(
      (candidate) => candidate.operationId === assignment.governedOperationId,
    );
    const actionId = operation ? String(record(operation.action).actionId) : '';
    const action = snapshot.actions.find((candidate) => candidate.actionId === actionId);
    if (!submission || !operation || !action) {
      throw new OperateClientError(
        'OPERATE_STORE_CORRUPT',
        'The terminal verification Assignment lost its exact operation or Submission binding.',
        false,
        { assignmentId: String(assignment.assignmentId) },
      );
    }
    const recordingRuntime = { ...runtime, artifacts };
    const recorded = recordOperatingTerminalVerificationInsufficientEvidenceV2(
      {
        cycleId: String(assignment.cycleId),
        actionId,
        verificationPlanId: String(action.verificationPlanId),
        assignmentId: String(assignment.assignmentId),
        submissionId: String(submission.submissionId),
      },
      {
        eventIds: {
          outcome: issue.stableId('evt', `verification-outcome:${submission.submissionId}`),
          learning: issue.stableId('evt', `verification-learning:${submission.submissionId}`),
        },
        timestamp: String(submission.issuedAt),
        correlationId: issue.stableId('corr', `verification-outcome:${submission.submissionId}`),
      },
      {
        initialState: accepted.state as never,
        artifactStore: governedArtifactStore(recordingRuntime) as never,
      },
    );
    await input.commit(
      {
        baseState: runtime.baseState,
        state: recorded.state as unknown as JsonRecord,
        events: [
          ...runtime.events,
          ...(accepted.events as JsonRecord[]),
          ...(recorded.events as unknown as JsonRecord[]),
        ],
        artifacts,
        preferences: runtime.preferences,
      },
      runtime.generation,
    );
    return operateSuccess(
      'operate.assignment.submit',
      accepted.response,
      cycleReadActions(String(assignment.cycleId), request.actor),
    );
  }
  if (assignment.assignmentKind !== 'chair') {
    await input.commit(
      {
        baseState: runtime.baseState,
        state: accepted.state,
        events: [...runtime.events, ...(accepted.events as JsonRecord[])],
        artifacts,
        preferences: runtime.preferences,
      },
      runtime.generation,
    );
    return operateSuccess(
      'operate.assignment.submit',
      accepted.response,
      cycleReadActions(String(assignment.cycleId), request.actor),
    );
  }
  const planId = runtime.preferences.cycleIntelligencePlanIds[String(assignment.cycleId)];
  const plan = state({ ...runtime, state: accepted.state }).intelligencePlans.find(
    (entry) => entry.planId === planId,
  );
  if (!plan) {
    throw new OperateClientError(
      'OPERATE_STORE_CORRUPT',
      'The Chair Assignment is missing its canonical intelligence plan.',
      false,
    );
  }
  const roleAssignments =
    runtime.preferences.cycleRoleAssignments[String(assignment.cycleId)] ?? {};
  const artifactForRole = (roleId: string): JsonRecord | null => {
    const assignmentId = roleAssignments[roleId];
    return assignmentId
      ? (accepted.state.artifacts.find(
          (entry: JsonRecord) => entry.assignmentId === assignmentId,
        ) ?? null)
      : null;
  };
  const selectedRoles = Array.isArray(plan.selectedRoles)
    ? (plan.selectedRoles as JsonRecord[])
    : [];
  const advisorRoleIds = selectedRoles
    .filter((role) => role.roleKind === 'advisor')
    .map((role) => String(role.roleId))
    .sort((left, right) => left.localeCompare(right));
  const challengerRoleId = String(
    selectedRoles.find((role) => role.roleKind === 'challenger')?.roleId ?? 'challenger',
  );
  const advisorArtifacts = advisorRoleIds
    .map((roleId) => artifactForRole(roleId))
    .filter((artifact): artifact is JsonRecord => artifact !== null);
  if (advisorArtifacts.length !== advisorRoleIds.length || advisorArtifacts.length === 0) {
    throw new OperateClientError(
      'OPERATE_STORE_CORRUPT',
      'The Chair Assignment has no accepted canonical advisor Artifact.',
      false,
    );
  }
  const advisorArtifact = advisorArtifacts[0];
  const challengerArtifact = artifactForRole(challengerRoleId);
  const acceptedRoleBody = (artifact: JsonRecord, subject: string): JsonRecord => {
    const artifactId = String(artifact.artifactId);
    const rawBytes = artifacts.get(artifactId);
    if (!rawBytes) {
      throw new OperateClientError(
        'OPERATE_STORE_CORRUPT',
        `${subject} accepted Artifact bytes are unavailable.`,
        false,
        { artifactId },
      );
    }
    try {
      return record(JSON.parse(Buffer.from(rawBytes).toString('utf8')) as unknown);
    } catch {
      throw new OperateClientError(
        'OPERATE_STORE_CORRUPT',
        `${subject} accepted Artifact bytes are not valid JSON.`,
        false,
        { artifactId },
      );
    }
  };
  const advisorBodies = advisorArtifacts.map((artifact) => acceptedRoleBody(artifact, 'Advisor'));
  const challengerBody = challengerArtifact
    ? acceptedRoleBody(challengerArtifact, 'Challenger')
    : null;
  const chairBody = record(
    JSON.parse(Buffer.from(accepted.stagedRawBytes).toString('utf8')) as unknown,
  );
  const ledgerDecisions = Array.isArray(chairBody.decisions) ? chairBody.decisions : [];
  const advisorClaims = advisorBodies.flatMap((body) =>
    Array.isArray(body.claims) ? body.claims : [],
  );
  const advisorRisks = advisorBodies.flatMap((body) =>
    Array.isArray(body.risks) ? body.risks : [],
  );
  const challengerFindings =
    challengerBody && Array.isArray(challengerBody.findings) ? challengerBody.findings : [];
  const snapshotId = String(plan.snapshotId);
  const acceptedSnapshot = accepted.state as unknown as RuntimeState;
  const operatingSnapshot = acceptedSnapshot.operatingSnapshots.find(
    (entry) => entry.snapshotId === snapshotId,
  );
  if (!operatingSnapshot) {
    throw new OperateClientError(
      'OPERATE_STORE_CORRUPT',
      'The intelligence plan snapshot is unavailable.',
      false,
    );
  }
  const materialized = composition.materializeDecisionLedger(
    {
      cycleId: assignment.cycleId,
      snapshotId,
      stateId: operatingSnapshot.stateId,
      intelligencePlanId: plan.planId,
      advisorArtifactIds: advisorArtifacts.map((artifact) => String(artifact.artifactId)),
      challengerArtifactId: challengerArtifact?.artifactId ?? null,
      chairArtifactId: accepted.artifact.artifactId,
    },
    {
      eventId: issue.id('evt'),
      claimEventIds: advisorClaims.map(() => issue.id('evt')),
      riskEventIds: advisorRisks.map(() => issue.id('evt')),
      findingEventIds: challengerFindings.map(() => issue.id('evt')),
      decisionEventIds: ledgerDecisions.map(() => issue.id('evt')),
      timestamp: issue.timestamp(),
      correlationId: issue.id('corr'),
    },
    accepted.state,
    artifacts,
  );
  const completeHypotheses = (materialized.actionHypotheses as JsonRecord[]).filter(
    (hypothesis) =>
      typeof hypothesis.objectiveId === 'string' &&
      typeof hypothesis.metricId === 'string' &&
      typeof hypothesis.baseline === 'number' &&
      typeof hypothesis.target === 'number' &&
      Array.isArray(hypothesis.sourceFindingIds) &&
      hypothesis.sourceFindingIds.length > 0,
  );
  const actionVerification =
    completeHypotheses.length === 0
      ? { state: materialized.state, events: [] as JsonRecord[] }
      : composition.materializeActionVerification(
          {
            cycleId: assignment.cycleId,
            snapshotId,
            stateId: operatingSnapshot.stateId,
            ledgerId: (materialized.ledger as JsonRecord).ledgerId,
          },
          {
            eventIds: completeHypotheses.map(() => issue.id('evt')),
            timestamp: issue.timestamp(),
            correlationId: issue.id('corr'),
          },
          materialized.state,
          artifacts,
        );
  const acceptedEvents = [
    ...accepted.events,
    ...materialized.events,
    ...actionVerification.events,
  ] as JsonRecord[];
  const reviewAt = issue.timestamp();
  const deliveryRoute = runtime.preferences.cycleDeliveryRoutes[String(assignment.cycleId)];
  const containedExecution = deliveryRoute === 'contained-execution';
  let authority = {
    actions: [] as JsonRecord[],
    policies: [] as JsonRecord[],
    evaluations: [] as JsonRecord[],
    requirements: [] as JsonRecord[],
  };
  let promotionState = actionVerification.state as unknown as RuntimeState;
  const promotionEvents: JsonRecord[] = [];
  const proposed = promotionState.actions.filter(
    (action) => action.sourceCycleId === assignment.cycleId && action.state === 'proposed',
  );
  for (const action of proposed) {
    if (!deliveryRoute) {
      throw new OperateClientError(
        'RESULT_CONTRACT_INVALID',
        'Action authority promotion requires one exact cycle delivery route.',
        false,
      );
    }
    const promoted = promoteOperatingActionAuthorityV2(
      {
        action: action as never,
        authority: (containedExecution
          ? containedActionAuthorityInput(action, String(advisorArtifact.artifactId), reviewAt)
          : deliveryActionAuthorityInput(
              action,
              deliveryRoute as 'planning-work' | 'human-external' | 'observe-only',
              String(advisorArtifact.artifactId),
              reviewAt,
            )) as never,
      },
      {
        eventId: issue.id('evt'),
        timestamp: reviewAt,
        correlationId: issue.id('corr'),
      },
      { initialState: promotionState as never },
    );
    promotionState = promoted.state as unknown as RuntimeState;
    promotionEvents.push(...(promoted.events as unknown as JsonRecord[]));
  }
  if (containedExecution) {
    authority = configureContainedActionAuthority(
      promotionState.actions.filter((action) => action.sourceCycleId === assignment.cycleId),
      runtime.preferences.reviewOwners[String(assignment.cycleId)],
      reviewAt,
    );
  }
  const reviewBaseState = {
    ...runtime.baseState,
    cycles: (runtime.baseState.cycles as JsonRecord[]).map((cycle) =>
      cycle.cycleId === assignment.cycleId
        ? containedExecution
          ? {
              ...cycle,
              state: 'awaiting_review',
              activeReviewId: null,
              updatedAt: reviewAt,
            }
          : cycle
        : cycle,
    ),
    ...(containedExecution
      ? {
          actionPolicies: mergeRecordsBy(
            runtime.baseState.actionPolicies as JsonRecord[] | undefined,
            authority.policies,
            (policy) => `${String(policy.policyId)}@${String(policy.policyVersion)}`,
          ),
          policyEvaluations:
            (runtime.baseState.policyEvaluations as JsonRecord[] | undefined) ?? [],
          approvalRequirements: mergeRecordsBy(
            runtime.baseState.approvalRequirements as JsonRecord[] | undefined,
            authority.requirements,
            (requirement) => String(requirement.requirementId),
          ),
          approvalRecords: (runtime.baseState.approvalRecords as JsonRecord[] | undefined) ?? [],
          capabilityAvailability:
            (runtime.baseState.capabilityAvailability as JsonRecord[] | undefined) ?? [],
          capabilityGrants: (runtime.baseState.capabilityGrants as JsonRecord[] | undefined) ?? [],
          governedOperations:
            (runtime.baseState.governedOperations as JsonRecord[] | undefined) ?? [],
          executionResults: (runtime.baseState.executionResults as JsonRecord[] | undefined) ?? [],
          rollbackPlans: (runtime.baseState.rollbackPlans as JsonRecord[] | undefined) ?? [],
          rollbackResults: (runtime.baseState.rollbackResults as JsonRecord[] | undefined) ?? [],
          operationReplayIndex:
            (runtime.baseState.operationReplayIndex as JsonRecord[] | undefined) ?? [],
        }
      : {}),
  };
  let current = composition.replay(
    reviewBaseState,
    [...runtime.events, ...acceptedEvents, ...promotionEvents],
    artifacts,
  );
  let stagedRuntime: OperateStoredRuntime = {
    ...runtime,
    baseState: reviewBaseState,
    state: current,
    events: [...runtime.events, ...acceptedEvents, ...promotionEvents],
    artifacts,
  };
  for (const evaluation of authority.evaluations) {
    const evaluated = await input.createEvent(stagedRuntime, {
      type: 'policy.evaluated',
      entityId: String(evaluation.evaluationId),
      cycleId: String(assignment.cycleId),
      correlationId: issue.id('corr'),
      timestamp: String(evaluation.evaluatedAt),
      requestHash: String(evaluation.inputHash),
      actor: { kind: 'runtime', id: 'openplanr' },
      payload: evaluation,
    });
    current = composition.reduce(current, [evaluated], artifacts);
    stagedRuntime = {
      ...stagedRuntime,
      state: current,
      events: [...stagedRuntime.events, evaluated],
    };
  }
  const reviews = containedExecution
    ? authority.actions.map(
        (action) =>
          createOperatingActionReviewV2({
            reviewId: issue.id('rev'),
            action: action as never,
            ownerActorId: runtime.preferences.reviewOwners[String(assignment.cycleId)],
            timestamp: reviewAt,
          }) as unknown as JsonRecord,
      )
    : [
        {
          kind: 'operating-review',
          schemaVersion: '1.0.0',
          protocolVersion: PROTOCOL_VERSION,
          reviewId: issue.id('rev'),
          cycleId: assignment.cycleId,
          subject: { type: 'cycle', cycleId: assignment.cycleId },
          ownerActorId: runtime.preferences.reviewOwners[String(assignment.cycleId)],
          state: 'pending',
          disposition: null,
          workDispositions: [],
          createdAt: reviewAt,
          updatedAt: reviewAt,
        },
      ];
  if (!containedExecution) {
    const [review] = reviews;
    const boardReview = composition.materializeExecutiveBoardReview(
      {
        cycleId: String(assignment.cycleId),
        planId: String(plan.planId),
        ledgerId: String((materialized.ledger as JsonRecord).ledgerId),
        review,
      },
      {
        boardEventId: issue.id('evt'),
        reviewEventId: issue.id('evt'),
        timestamp: reviewAt,
        correlationId: issue.id('corr'),
      },
      current,
      artifacts,
    );
    current = boardReview.state;
    stagedRuntime = {
      ...stagedRuntime,
      state: current,
      events: [...stagedRuntime.events, ...boardReview.events],
    };
  } else {
    for (const review of reviews) {
      const reviewCreated = await input.createEvent(stagedRuntime, {
        type: 'review.created',
        entityId: String(review.reviewId),
        cycleId: String(assignment.cycleId),
        correlationId: issue.id('corr'),
        timestamp: reviewAt,
        payload: review,
      });
      current = composition.reduce(current, [reviewCreated], artifacts);
      stagedRuntime = {
        ...stagedRuntime,
        state: current,
        events: [...stagedRuntime.events, reviewCreated],
      };
    }
  }
  await input.commit(
    {
      baseState: reviewBaseState,
      state: current,
      events: stagedRuntime.events,
      artifacts,
      preferences: runtime.preferences,
    },
    runtime.generation,
  );
  return operateSuccess(
    'operate.assignment.submit',
    accepted.response,
    cycleReadActions(String(assignment.cycleId), request.actor),
  );
}

/** Accept one redacted live-evidence ingestion and resolve its evidence in the same generation. */
export async function acceptOperateLiveEvidenceSubmission(
  input: SubmissionDependencies & Readonly<{ request: LiveEvidenceSubmissionRequestV2 }>,
): Promise<LiveEvidenceSubmissionResultV2> {
  const { request } = input;
  return await retryReplaySafeGenerationConflict(
    `live-evidence-submit:${sha256Jcs({
      assignmentId: request.assignmentId,
      submissionId: request.submissionId,
      preparationHash: request.preparationHash,
      contentHash: `sha256:${createHash('sha256')
        .update(Buffer.from(request.contentBase64, 'base64'))
        .digest('hex')}`,
    } as never)}`,
    () =>
      withOperateMutationLane(input.root, async () => {
        const runtime = await input.requiredRuntime();
        const preparation = liveEvidenceSubmissionPreparation(runtime, request);
        if (preparation.preparationHash !== request.preparationHash) {
          throw new OperateClientError(
            'CONCURRENT_MODIFICATION',
            'The live-evidence Assignment preparation changed before acceptance.',
            true,
            { assignmentId: request.assignmentId, submissionId: request.submissionId },
          );
        }
        const ingestion = parseLiveEvidenceIngestion(request.contentBase64);
        const candidate = Array.isArray(ingestion.evidenceCandidates)
          ? ingestion.evidenceCandidates[0]
          : null;
        const submission = record(ingestion.submission);
        if (
          ingestion.ingestionId !== preparation.ingestionId ||
          !Array.isArray(ingestion.evidenceCandidates) ||
          ingestion.evidenceCandidates.length !== 1 ||
          !candidate ||
          typeof candidate !== 'object' ||
          Array.isArray(candidate) ||
          (candidate as JsonRecord).candidateId !== preparation.candidateId ||
          submission.submissionId !== preparation.submissionId ||
          submission.artifactId !== preparation.artifactId ||
          submission.evidenceRefId !== preparation.evidenceRefId ||
          submission.submittedEventId !== preparation.acceptanceEventIds.submitted ||
          submission.artifactCreatedEventId !== preparation.acceptanceEventIds.artifactCreated ||
          submission.validatedEventId !== preparation.acceptanceEventIds.validated
        ) {
          throw new OperateClientError(
            'RESULT_CONTRACT_INVALID',
            'Live-evidence ingestion changed a runtime-owned submission or evidence identity.',
            false,
            { assignmentId: request.assignmentId, submissionId: request.submissionId },
          );
        }
        const custody = request.custody;
        assertOperatingLiveEvidenceIngestionV2(ingestion, {
          assignment: preparation.assignment,
          liveProviderRegistration: custody.liveProviderRegistration,
          baseEvidenceProvider: custody.baseEvidenceProvider,
          baseResolver: custody.baseResolver,
          consentRecord: custody.consentRecord,
          connectorCheckpoint: custody.connectorCheckpoint,
        });
        const sourceTiming = record(ingestion.sourceTiming);
        if (
          typeof sourceTiming.capturedAt !== 'string' ||
          !Number.isFinite(Date.parse(sourceTiming.capturedAt))
        ) {
          throw new OperateClientError(
            'RESULT_CONTRACT_INVALID',
            'Live-evidence ingestion must bind one valid capture time.',
            false,
          );
        }
        const composition = await input.composition();
        const artifacts = new Map(runtime.artifacts);
        const accepted = composition.acceptSubmission(
          {
            assignmentId: request.assignmentId,
            submissionId: request.submissionId,
            actor: request.actor,
            mediaType: 'application/json',
            encoding: 'utf-8',
            contentBase64: request.contentBase64,
          },
          {
            artifactId: preparation.artifactId,
            artifactType: 'live-evidence-ingestion',
            storageClass: 'machine-local',
            sensitivity: ingestion.classification,
            retentionClass: 'project',
            inputArtifactIds: (preparation.assignment.inputArtifactIds as unknown[]) ?? [],
            timestamp: sourceTiming.capturedAt,
            validatorVersion: 'openplanr-live-evidence-v2',
            correlationId: preparation.correlationId,
            eventIds: preparation.acceptanceEventIds,
          },
          runtime.state,
          artifacts,
        );
        const eventPool = [...runtime.events, ...(accepted.events as JsonRecord[])];
        const requiredEvent = (eventId: string): JsonRecord => {
          const event = eventPool.find((candidateEvent) => candidateEvent.eventId === eventId);
          if (!event) {
            throw new OperateClientError(
              'OPERATE_STORE_INCOMPATIBLE',
              'Accepted live-evidence custody is missing one immutable Event body.',
              false,
              { eventId },
            );
          }
          return event;
        };
        const submittedEvent = requiredEvent(preparation.acceptanceEventIds.submitted);
        const artifactCreatedEvent = requiredEvent(preparation.acceptanceEventIds.artifactCreated);
        const validatedEvent = requiredEvent(preparation.acceptanceEventIds.validated);
        const sourceCustody: JsonRecord = {
          issuedAssignment: preparation.assignment,
          liveProviderRegistration: custody.liveProviderRegistration,
          baseEvidenceProvider: custody.baseEvidenceProvider,
          baseResolver: custody.baseResolver,
          consentRecord: custody.consentRecord,
          connectorCheckpoint: custody.connectorCheckpoint,
          submittedEvent,
          artifactCreatedEvent,
          validatedEvent,
        };
        const links = Array.isArray(ingestion.evidenceClaimLinks)
          ? ingestion.evidenceClaimLinks.map((value) => {
              const link = record(value);
              return {
                sourceArtifactId: link.sourceArtifactId,
                localClaimId: link.localClaimId,
                relation: link.relation,
                confidence: link.confidence,
              };
            })
          : [];
        const materialized = composition.materializeLiveEvidence(
          { candidate: candidate as JsonRecord, claimLinks: links },
          {
            resolutionId: preparation.evidenceResolutionId,
            eventId: preparation.resolutionEventId,
            timestamp: sourceTiming.capturedAt,
            correlationId: preparation.correlationId,
            evidenceRefId: preparation.evidenceRefId,
            evidenceArtifactId: preparation.evidenceArtifactId,
          },
          accepted.state,
          artifacts,
          preparation.artifactId,
          sourceCustody,
        );
        const evidenceRef = record(materialized.evidenceRef);
        const evidenceArtifact = record(materialized.evidenceArtifact);
        const evidenceResolution = record(materialized.resolution);
        assertAcceptedLiveEvidenceBridgeV2(ingestion, {
          ...sourceCustody,
          assignment: preparation.assignment,
          artifact: accepted.artifact,
          evidenceRef,
          evidenceArtifact,
          evidenceResolution,
          resultCheckpoint: custody.resultCheckpoint,
          checkpointHistory: [...(custody.checkpointHistory ?? [])],
        });
        if (!accepted.replayed || !materialized.replayed) {
          await input.commit(
            {
              baseState: runtime.baseState,
              state: materialized.state,
              events: [
                ...runtime.events,
                ...(accepted.events as JsonRecord[]),
                ...(materialized.events as JsonRecord[]),
              ],
              artifacts,
              preferences: runtime.preferences,
            },
            runtime.generation,
          );
        }
        return Object.freeze({
          assignmentId: request.assignmentId,
          submissionId: request.submissionId,
          artifactId: String(accepted.artifact.artifactId),
          artifactHash: String(accepted.artifact.canonicalHash),
          evidenceRefId: String(evidenceRef.evidenceRefId),
          evidenceArtifactId: String(evidenceArtifact.artifactId),
          resolutionId: String(evidenceResolution.resolutionId),
          replayed: Boolean(accepted.replayed && materialized.replayed),
        });
      }),
  );
}
