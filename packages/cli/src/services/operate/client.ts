import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  actionIdentity,
  artifactValue,
  configureContainedActionAuthority,
  containedActionAuthorityInput,
  deliveryActionAuthorityInput,
  type ExactRollbackApprovalTemplate,
  exactAction,
  exactRollbackApprovalRecord,
  exactRollbackApprovalTemplate,
  exactRollbackPlanContext,
  GOVERNED_APPROVAL_TEMPLATE_ID,
  governedArtifactStore,
  governedDraft,
  later,
  mergeRecordsBy,
  sameActionIdentity,
  sameCanonicalValue,
  withVerificationArtifactReservations,
} from './client/governance.js';
import {
  claimOperateAssignment,
  clearOperateStaleLock,
  createOperateComposition,
  createOperateStore,
  createProjectMeasurementScheduleService,
  createSpecForOperatingPlanning,
  ensureOperateStorageLayout,
  ingestPlanningDeliveryEvidence,
  inspectOperateRecovery,
  isOperatePublicId,
  type JsonRecord,
  loadOperateExperienceReaderOwner,
  type MeasurementSchedule,
  MeasurementScheduleError,
  type MeasurementScheduleService,
  OPERATE_INTEGRITY_BOUNDARY,
  type OperateComposition,
  type OperateStore,
  type OperateStoredRuntime,
  previewOperatingPlanningSpec,
  readCommittedOperateReviewReceipt,
  readOperateActionWorkspace,
  readOperateCycleWorkspace,
  readOperateExecutiveBoardDisplay,
  readOperateRecoveryDisplay,
  readOperateReview,
  restoreOperateGeneration,
  retryReplaySafeGenerationConflict,
  stageRuntimeAssignmentSubmission,
  startOperateCycle,
  submitBoundOperateReview,
  submitOperateReview,
  withOperateMutationLane,
} from './client/lifecycle.js';
import {
  assertAcceptedLiveEvidenceBridgeV2,
  assertOperatingLiveEvidenceIngestionV2,
  assertProtocolArtifact,
  buildOperatingCycleWorkViewV2,
  buildOperatingRollbackPlanV2,
  buildOperatingTerminalVerificationInsufficientEvidenceV2,
  buildOperatingWorkLedgerV2,
  createDisposableLocalProjectTargetV2,
  createOperatingActionReviewV2,
  createOperatingApprovalRecordV2,
  createOperatingApprovalRequirementV2,
  createOperatingGovernedExecutionRuntimeV2,
  createOperatingGovernedRecoveryRuntimeV2,
  deriveOperateAuthorityAllowedActionsV2,
  evaluateOperatingActionPolicyV2,
  evaluateOperatingApprovalSetV2,
  OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
  OPERATE_AUTHORITY_TOOL_CAPABILITIES_V2,
  type OperateReviewBoundSubmissionV1,
  type OperatingAssignmentClaimV2,
  type OperatingSubmissionAcceptanceV2,
  preflightOperatingAssignmentResultV2,
  promoteOperatingActionAuthorityV2,
  readOperatingArtifactV2,
  recordOperatingRollbackPlanV2,
  recordOperatingTerminalVerificationInsufficientEvidenceV2,
  sha256Jcs,
} from './client/runtime.js';
import { OperateClientError, type OperateErrorCodeV2 } from './client-error.js';

export {
  type AccessSafeOperateSearchHitV1,
  projectAccessSafeOperateSearchHits,
} from './search-hit-contract.js';

const PROTOCOL_VERSION = '2.0.0';
const REVIEW_SUBMIT_CAPABILITY = Object.freeze({
  id: 'operate-review-submit',
  version: PROTOCOL_VERSION,
});

export type OperateToolNameV2 =
  | 'operate.cycle.start'
  | 'operate.cycle.get'
  | 'operate.cycle.resume'
  | 'operate.assignment.claim'
  | 'operate.assignment.submit'
  | 'operate.review.get'
  | 'operate.review.submit'
  | 'operate.action.approve'
  | 'operate.action.execute'
  | 'operate.action.rollback'
  | 'operate.artifact.get'
  | 'operate.experience.get'
  | 'operate.planning.preview'
  | 'operate.planning.create-spec'
  | 'operate.planning.ingest-delivery'
  | 'operate.recovery.inspect'
  | 'operate.recovery.restore'
  | 'operate.recovery.clear-stale-lock';

export type OperateActorV2 = {
  actorId: string;
  kind: 'agent' | 'human';
  runtime: string;
};

export type OperateAssignmentResultPreflight = Readonly<{
  valid: boolean;
  assignmentId: string;
  schemaId: string;
  issues: readonly Readonly<{
    code: string;
    path: string;
    message: string;
    context: Readonly<Record<string, unknown>>;
  }>[];
}>;

export type OperateStartRequestV2 = {
  scope: { scopeId: string; domainId: string; domainVersion: string };
  focus: string[];
  trigger: { kind: 'manual' };
  mode: 'standard' | 'preview';
  ownerActorId: string;
  deliveryRoute?: 'contained-execution' | 'planning-work' | 'human-external' | 'observe-only';
};

type ClaimRequest = { assignmentId: string; actor: OperateActorV2 };
type SubmitRequest = {
  assignmentId: string;
  submissionId: string;
  actor: OperateActorV2;
  mediaType: string;
  encoding: 'utf-8' | 'binary';
  contentBase64: string;
};

export type LiveEvidenceSubmissionPreparationV2 = Readonly<{
  assignment: JsonRecord;
  submissionId: string;
  artifactId: string;
  ingestionId: string;
  candidateId: string;
  evidenceRefId: string;
  evidenceArtifactId: string;
  evidenceResolutionId: string;
  resolutionEventId: string;
  acceptanceEventIds: Readonly<{
    submitted: string;
    artifactCreated: string;
    validated: string;
  }>;
  correlationId: string;
  preparationHash: string;
}>;

export type LiveEvidenceSubmissionCustodyV2 = Readonly<{
  issuedAssignment: JsonRecord;
  liveProviderRegistration: JsonRecord;
  baseEvidenceProvider: JsonRecord;
  baseResolver: JsonRecord;
  consentRecord: JsonRecord;
  connectorCheckpoint: JsonRecord;
  resultCheckpoint: JsonRecord;
  checkpointHistory?: readonly JsonRecord[];
}>;

export type LiveEvidenceSubmissionRequestV2 = Readonly<{
  assignmentId: string;
  submissionId: string;
  actor: OperateActorV2;
  preparationHash: string;
  contentBase64: string;
  custody: LiveEvidenceSubmissionCustodyV2;
}>;

export type LiveEvidenceSubmissionResultV2 = Readonly<{
  assignmentId: string;
  submissionId: string;
  artifactId: string;
  artifactHash: string;
  evidenceRefId: string;
  evidenceArtifactId: string;
  resolutionId: string;
  replayed: boolean;
}>;

export type OperateMeasurementCommandV1 =
  | Readonly<{
      operation: 'measurement.preview';
      schedule: MeasurementSchedule;
      actor: OperateActorV2 & { kind: 'human' };
    }>
  | Readonly<{
      operation: 'measurement.enable';
      schedule: MeasurementSchedule;
      transition: JsonRecord;
      confirmDigest: string;
      actor: OperateActorV2 & { kind: 'human' };
    }>
  | Readonly<{
      operation: 'measurement.disable';
      scheduleId: string;
      transition: JsonRecord;
      confirmDigest: string;
      actor: OperateActorV2 & { kind: 'human' };
    }>
  | Readonly<{
      operation: 'measurement.status';
      scheduleId: string;
      actor: OperateActorV2 & { kind: 'human' };
    }>;

export type OperateMeasurementResultV1 = Readonly<{
  ok: boolean;
  operation: OperateMeasurementCommandV1['operation'];
  effects: readonly Readonly<{
    id: 'schedule-custody-write' | 'due-work-issue' | 'provider-call';
    executed: boolean;
  }>[];
  authorityRequired: boolean;
  ownerActionRequired: boolean;
  nextAction: string;
  recovery: string | null;
  data?: JsonRecord;
  error?: Readonly<{ code: string; problem: string }>;
}>;
type ReviewRequest = {
  reviewId: string;
  cycleId: string;
  actor: OperateActorV2 & { kind: 'human' };
  scope: { scopeId: string; domainId: string; domainVersion: string };
};
type ReviewSubmitRequest = ReviewRequest & {
  disposition: 'approved' | 'changes_requested' | 'rejected' | 'cancelled';
  workDispositions: JsonRecord[];
};
type ArtifactRequest = {
  artifactId: string;
  representation: 'raw' | 'canonical' | 'metadata' | 'decoded-json';
  actor: OperateActorV2;
  scope: { scopeId: string; domainId: string; domainVersion: string };
  assignmentId: string | null;
};
type ExperienceRequest = {
  cycleId: string;
  actor: OperateActorV2;
  actionBinding?: { cycleId: string; actorId: string };
  surface?:
    | 'today'
    | 'inbox'
    | 'cycles'
    | 'cycle'
    | 'evidence'
    | 'outcomes'
    | 'outcome'
    | 'history'
    | 'search'
    | 'export';
  subjectId?: string;
  query?: string;
  format?: 'json' | 'html';
  projectId?: string;
  generation?: number;
};

export type OperateAuditDisplayRequestV1 = Readonly<{
  cycleId: string;
  actor: OperateActorV2;
  surface: 'evidence' | 'outcomes' | 'outcome' | 'history' | 'search' | 'export';
  subjectId?: string;
  query?: string;
  format?: 'json' | 'html';
}>;

export type OperateExperiencePreviewRequestV1 = {
  stateCycleId: string;
  actor: OperateActorV2;
  view: JsonRecord;
  actionDigest: string;
  authority: 'allowed' | 'refused' | 'read-only';
  reasonCodes?: string[];
  issuedAt: string;
  expiresAt: string;
};

export type OperateToolRequestMapV2 = {
  'operate.cycle.start': OperateStartRequestV2;
  'operate.cycle.get': { cycleId: string };
  'operate.cycle.resume': { cycleId: string };
  'operate.assignment.claim': ClaimRequest;
  'operate.assignment.submit': SubmitRequest;
  'operate.review.get': ReviewRequest;
  'operate.review.submit': ReviewSubmitRequest;
  'operate.action.approve': {
    action: { actionId: string; revision: number; actionHash: string };
    decision: 'approved' | 'rejected' | 'deferred';
    rollback?: {
      rollbackPlanId: string;
      planHash: string;
      originalOperationId: string;
      executionResultId: string;
      expectedTargetHash: string;
    };
    actor: OperateActorV2;
  };
  'operate.action.execute': {
    action: { actionId: string; revision: number; actionHash: string };
    actor: OperateActorV2;
  };
  'operate.action.rollback': {
    action: { actionId: string; revision: number; actionHash: string };
    originalOperationId: string;
    rollbackPlanId: string;
    actor: OperateActorV2;
  };
  'operate.artifact.get': ArtifactRequest;
  'operate.experience.get': ExperienceRequest;
  'operate.planning.preview': {
    actionId: string;
    actor: OperateActorV2;
    framing?: JsonRecord;
  };
  'operate.planning.create-spec': {
    proposalId: string;
    confirmDigest: string;
    actor: OperateActorV2;
  };
  'operate.planning.ingest-delivery': {
    specId: string;
    planRun: JsonRecord;
    shipRun: JsonRecord;
    tasks: JsonRecord[];
    changedSurfaces: string[];
    qa: JsonRecord;
    limitations?: string[];
    artifacts: Array<{ artifactId: string; path: string; hash: string; classification: string }>;
    classification: 'public' | 'internal' | 'confidential' | 'restricted';
    summary: string;
    deliveryStatus: 'succeeded' | 'blocked' | 'failed' | 'rolled-back';
    rollback?: JsonRecord | null;
    createdAt: string;
  };
  'operate.recovery.inspect': Record<string, never>;
  'operate.recovery.restore': { generation: string };
  'operate.recovery.clear-stale-lock': Record<string, never>;
};

export type OperateDispatchRequestV2 = {
  [Operation in OperateToolNameV2]: {
    operation: Operation;
    request: OperateToolRequestMapV2[Operation];
  };
}[OperateToolNameV2];

export type OperateDispatchRequestForV2<Operation extends OperateToolNameV2> = Extract<
  OperateDispatchRequestV2,
  { operation: Operation }
>;

export type OperateAllowedActionV2 = {
  tool: OperateToolNameV2;
  arguments: Record<string, unknown>;
  label: string;
  effect: 'read-only' | 'machine-local-write' | 'project-write';
};

export type OperateToolResponseMapV2 = {
  [Operation in OperateToolNameV2]: Operation extends 'operate.assignment.claim'
    ? OperatingAssignmentClaimV2
    : Operation extends 'operate.assignment.submit'
      ? OperatingSubmissionAcceptanceV2
      : unknown;
};

export type OperateApiSuccessV2<Operation extends OperateToolNameV2 = OperateToolNameV2> = {
  [CurrentOperation in Operation]: {
    ok: true;
    operation: CurrentOperation;
    data: OperateToolResponseMapV2[CurrentOperation];
    allowedActions: unknown[];
  };
}[Operation];

export type OperateApiFailureV2<Operation extends OperateToolNameV2 = OperateToolNameV2> = {
  [CurrentOperation in Operation]: {
    ok: false;
    operation: CurrentOperation;
    error: {
      code: OperateErrorCodeV2;
      message: string;
      retryable: boolean;
      context: Record<string, string | number | boolean | null>;
    };
    allowedActions: unknown[];
  };
}[Operation];

export type OperateApiEnvelopeV2<Operation extends OperateToolNameV2 = OperateToolNameV2> =
  | OperateApiSuccessV2<Operation>
  | OperateApiFailureV2<Operation>;

type RuntimeState = JsonRecord & {
  eventHead: { sequence: number; hash: string | null };
  eventReplayIndex: JsonRecord[];
  cycles: JsonRecord[];
  inputBindings: JsonRecord[];
  assignments: JsonRecord[];
  submissions: JsonRecord[];
  artifacts: JsonRecord[];
  evidenceRefs: JsonRecord[];
  evidenceResolutions: JsonRecord[];
  reviews: JsonRecord[];
  findings: JsonRecord[];
  decisions: JsonRecord[];
  actions: JsonRecord[];
  outcomes: JsonRecord[];
  learnings: JsonRecord[];
  operatingSnapshots: JsonRecord[];
  operatingModelStates: JsonRecord[];
  deltas: JsonRecord[];
  intelligencePlans: JsonRecord[];
  decisionLedgers: JsonRecord[];
  verificationPlans: JsonRecord[];
  actionPolicies: JsonRecord[];
  policyEvaluations: JsonRecord[];
  approvalRequirements: JsonRecord[];
  approvalRecords: JsonRecord[];
  capabilityAvailability: JsonRecord[];
  capabilityGrants: JsonRecord[];
  governedOperations: JsonRecord[];
  executionResults: JsonRecord[];
  rollbackPlans: JsonRecord[];
  rollbackResults: JsonRecord[];
};

export type OperateEventHeadV2 = Readonly<{ sequence: number; hash: string | null }>;

const SAFE_CODES = new Set<OperateErrorCodeV2>([
  'CYCLE_NOT_FOUND',
  'CYCLE_TERMINAL',
  'ASSIGNMENT_NOT_AVAILABLE',
  'ASSIGNMENT_ALREADY_CLAIMED',
  'ASSIGNMENT_ALREADY_SUBMITTED',
  'ACTION_REVISION_MISMATCH',
  'RESULT_CONTRACT_INVALID',
  'SUBMISSION_ID_CONFLICT',
  'CAPABILITY_DENIED',
  'REVIEW_NOT_FOUND',
  'REVIEW_NOT_PENDING',
  'REVIEW_NOT_AUTHORIZED',
  'STATE_TRANSITION_INVALID',
  'ARTIFACT_NOT_FOUND',
  'CONTRACT_VERSION_UNSUPPORTED',
  'CONCURRENT_MODIFICATION',
  'OPERATING_SCOPE_INVALID',
  'DOMAIN_CONTRACT_UNSUPPORTED',
  'OPERATE_STORE_CORRUPT',
  'OPERATE_STORE_INCOMPATIBLE',
  'OPERATE_STORE_CONFLICT',
  'OPERATE_SUBJECT_NOT_FOUND',
  'OPERATION_CONFLICT',
  'OPERATION_UNCERTAIN',
  'ROLLBACK_NOT_ELIGIBLE',
  'APPROVAL_INVALID',
  'APPROVAL_REQUIRED',
  'POLICY_EVALUATION_REJECTED',
  'E_OPERATE_PLANNING_ACCESS',
  'E_OPERATE_PLANNING_BINDING',
  'E_OPERATE_PLANNING_CONCURRENT',
  'E_OPERATE_PLANNING_CONFIRMATION',
  'E_OPERATE_PLANNING_CONFLICT',
  'E_OPERATE_PLANNING_CUSTODY',
  'E_OPERATE_PLANNING_INVALID',
  'E_OPERATE_PLANNING_PATH',
  'E_OPERATE_PLANNING_ROUTE',
  'E_OPERATE_PLANNING_STALE',
  'E_OPERATE_PLANNING_STATE',
  'E_OPERATE_ORIGIN_INVALID',
  'E_PROVENANCE_CONFLICT',
]);

function timestamp(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

type ReplaySafeIssue = Readonly<{
  id(prefix: string): string;
  stableId(prefix: string, value: string): string;
  timestamp(): string;
}>;

function replaySafeIssueFactory(): () => ReplaySafeIssue {
  const issued = new Map<string, string[]>();
  const allocate = (kind: string, index: number, create: () => string): string => {
    const values = issued.get(kind) ?? [];
    if (!issued.has(kind)) issued.set(kind, values);
    values[index] ??= create();
    return values[index];
  };
  return () => {
    const cursors = new Map<string, number>();
    const next = (kind: string, create: () => string): string => {
      const index = cursors.get(kind) ?? 0;
      cursors.set(kind, index + 1);
      return allocate(kind, index, create);
    };
    return Object.freeze({
      id: (prefix: string) => next(`id:${prefix}`, () => id(prefix)),
      stableId,
      timestamp: () => next('timestamp', timestamp),
    });
  };
}

function record(value: unknown): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OperateClientError(
      'RESULT_CONTRACT_INVALID',
      'The accepted lifecycle result is not a JSON object.',
      false,
    );
  }
  return value as JsonRecord;
}

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

function liveEvidenceSubmissionPreparation(
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

function exactAuditDisplayRequest(value: unknown): value is OperateAuditDisplayRequestV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const allowed = new Set(['cycleId', 'actor', 'surface', 'subjectId', 'query', 'format']);
    if (
      !(
        keys.every(
          (key) =>
            typeof key === 'string' &&
            allowed.has(key) &&
            descriptors[key]?.get === undefined &&
            descriptors[key]?.set === undefined,
        ) && ['cycleId', 'actor', 'surface'].every((key) => Object.hasOwn(descriptors, key))
      )
    ) {
      return false;
    }
    const cycleId = descriptors.cycleId?.value;
    const surface = descriptors.surface?.value;
    const hasSubject = Object.hasOwn(descriptors, 'subjectId');
    const subjectId = descriptors.subjectId?.value;
    const hasQuery = Object.hasOwn(descriptors, 'query');
    const query = descriptors.query?.value;
    const hasFormat = Object.hasOwn(descriptors, 'format');
    const format = descriptors.format?.value;
    if (
      !isOperatePublicId(cycleId) ||
      !['evidence', 'outcomes', 'outcome', 'history', 'search', 'export'].includes(surface) ||
      (hasSubject && !isOperatePublicId(subjectId)) ||
      (surface === 'outcome' && !hasSubject) ||
      (!['evidence', 'outcome'].includes(surface) && hasSubject) ||
      (hasQuery && (typeof query !== 'string' || query.length > 512)) ||
      (surface !== 'search' && hasQuery) ||
      (hasFormat && !['json', 'html'].includes(format)) ||
      (surface !== 'export' && hasFormat)
    ) {
      return false;
    }
    const actor = descriptors.actor?.value;
    if (actor === null || typeof actor !== 'object' || Array.isArray(actor)) return false;
    const actorPrototype = Object.getPrototypeOf(actor);
    if (actorPrototype !== Object.prototype && actorPrototype !== null) return false;
    const actorDescriptors = Object.getOwnPropertyDescriptors(actor);
    const actorKeys = Reflect.ownKeys(actorDescriptors);
    if (
      !actorKeys.every(
        (key) =>
          typeof key === 'string' &&
          ['actorId', 'kind', 'runtime'].includes(key) &&
          actorDescriptors[key]?.get === undefined &&
          actorDescriptors[key]?.set === undefined,
      ) &&
      ['actorId', 'kind'].every((key) => Object.hasOwn(actorDescriptors, key))
    ) {
      return false;
    }
    const actorId = actorDescriptors.actorId?.value;
    const kind = actorDescriptors.kind?.value;
    const hasRuntime = Object.hasOwn(actorDescriptors, 'runtime');
    const runtime = actorDescriptors.runtime?.value;
    return (
      isOperatePublicId(actorId) &&
      ['agent', 'human'].includes(kind) &&
      (!hasRuntime || (typeof runtime === 'string' && runtime.length > 0 && runtime.length <= 128))
    );
  } catch {
    return false;
  }
}

function state(runtime: OperateStoredRuntime): RuntimeState {
  return runtime.state as RuntimeState;
}

function findBy(entries: JsonRecord[], key: string, value: string): JsonRecord | undefined {
  return entries.find((entry) => entry[key] === value);
}

function cycleReadAction(cycleId: string): OperateAllowedActionV2 {
  return {
    tool: 'operate.cycle.get',
    arguments: { cycleId },
    label: 'Inspect the current cycle',
    effect: 'read-only',
  };
}

function recoveryAction(): OperateAllowedActionV2 {
  return {
    tool: 'operate.recovery.inspect',
    arguments: {},
    label: 'Inspect safe recovery options',
    effect: 'read-only',
  };
}

function cycleReadActions(cycleId: string, _actor?: OperateActorV2): OperateAllowedActionV2[] {
  return [cycleReadAction(cycleId)];
}

function assignmentActor(assignment: JsonRecord): OperateActorV2 | undefined {
  const claim = assignment.claim;
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return undefined;
  const actorId = (claim as JsonRecord).actorId;
  const runtime = (claim as JsonRecord).runtime;
  if (typeof actorId !== 'string' || !actorId || typeof runtime !== 'string' || !runtime) {
    return undefined;
  }
  return { actorId, kind: 'agent', runtime };
}

function isDurableCycleActor(
  runtime: OperateStoredRuntime,
  snapshot: RuntimeState,
  cycleId: string,
  actor: OperateActorV2,
): boolean {
  if (
    actor.kind === 'human' &&
    runtime.preferences.reviewOwners[cycleId] === actor.actorId &&
    runtime.preferences.actorMemberships[actor.actorId]?.role === 'owner'
  ) {
    return true;
  }
  if (actor.kind !== 'agent' || !actor.runtime) return false;
  return snapshot.assignments.some((assignment) => {
    if (assignment.cycleId !== cycleId) return false;
    const claimed = assignmentActor(assignment);
    return claimed?.actorId === actor.actorId && claimed.runtime === actor.runtime;
  });
}

function bindActorActions(
  actions: JsonRecord[],
  actor: OperateActorV2,
  approvedWorkDispositions: JsonRecord[],
): JsonRecord[] {
  return actions.map((action) => {
    const tool = String(action.tool ?? '');
    if (!['operate.review.get', 'operate.review.submit'].includes(tool)) return action;
    const argumentsValue = record(action.arguments);
    return {
      ...action,
      arguments: {
        ...argumentsValue,
        actor,
        ...(tool === 'operate.review.submit' && argumentsValue.disposition === 'approved'
          ? { workDispositions: approvedWorkDispositions }
          : {}),
      },
    };
  });
}

function projectAllowedAction(action: JsonRecord): JsonRecord {
  if (
    ['operate.assignment.submit', 'operate.review.get', 'operate.review.submit'].includes(
      String(action.tool),
    )
  ) {
    return structuredClone(action);
  }
  const argumentsValue = record(action.arguments);
  const { actor: _actor, ...publicArguments } = argumentsValue;
  return {
    ...action,
    arguments: publicArguments,
  };
}

function governedExperienceActions(
  runtime: OperateStoredRuntime,
  snapshot: RuntimeState,
  cycle: JsonRecord,
  actor: OperateActorV2,
): Array<{ subjectId: string; action: JsonRecord }> {
  const projected: Array<{ subjectId: string; action: JsonRecord }> = [];
  for (const action of snapshot.actions.filter(
    (candidate) => candidate.sourceCycleId === cycle.cycleId,
  )) {
    if (!Object.hasOwn(action, 'actionHash')) continue;
    const evaluations = (snapshot.policyEvaluations ?? [])
      .filter(
        (candidate) =>
          record(candidate.action).actionId === action.actionId &&
          record(candidate.action).revision === action.revision &&
          record(candidate.action).actionHash === action.actionHash,
      )
      .sort(
        (left, right) =>
          String(left.evaluatedAt).localeCompare(String(right.evaluatedAt)) ||
          String(left.evaluationId).localeCompare(String(right.evaluationId)),
      );
    const evaluation = evaluations.at(-1);
    if (!evaluation) continue;
    const requirements = (snapshot.approvalRequirements ?? []).filter(
      (candidate) => candidate.evaluationId === evaluation.evaluationId,
    );
    const approvals = (snapshot.approvalRecords ?? []).filter(
      (candidate) => candidate.evaluationId === evaluation.evaluationId,
    );
    const effectivePolicy = (snapshot.actionPolicies ?? []).find(
      (candidate) =>
        candidate.policyId === record(evaluation.policy).policyId &&
        candidate.policyVersion === record(evaluation.policy).policyVersion &&
        candidate.policyHash === record(evaluation.policy).policyHash,
    );
    if (!effectivePolicy) continue;
    if (
      action.state === 'proposed' &&
      cycle.state === 'approved' &&
      !snapshot.reviews.some(
        (review) =>
          review.state === 'pending' && record(review.subject).actionId === action.actionId,
      )
    ) {
      const party = requirements
        .flatMap((requirement) =>
          Array.isArray(requirement.parties) ? (requirement.parties as JsonRecord[]) : [],
        )
        .find(
          (candidate) => candidate.actorKind === actor.kind && candidate.actorId === actor.actorId,
        );
      if (party) {
        try {
          const allowed = deriveOperateAuthorityAllowedActionsV2({
            actor: {
              ...actor,
              capabilities: [
                {
                  id: String(record(party.requiredCapability).id),
                  version: String(record(party.requiredCapability).version),
                },
              ],
            },
            capabilities: [
              structuredClone(OPERATE_AUTHORITY_TOOL_CAPABILITIES_V2['operate.action.approve']),
            ],
            now: timestamp(),
            action: action as never,
            scope: {
              scopeId: String(action.scopeId),
              domainId: String(action.domainId),
              domainVersion: String(action.domainVersion),
            },
            target: action.targetBinding as never,
            actionPolicy: effectivePolicy as never,
            actionPolicies: snapshot.actionPolicies as never,
            policyEvaluation: evaluation as never,
            approvalRequirements: requirements as never,
            approvals: approvals as never,
          });
          projected.push(
            ...allowed
              .filter(
                (candidate) =>
                  candidate.tool === 'operate.action.approve' &&
                  record(candidate.arguments as unknown as JsonRecord).decision === 'approved',
              )
              .map((candidate) => ({
                subjectId: String(action.actionId),
                action: candidate as unknown as JsonRecord,
              })),
          );
        } catch {
          // The experience is fail-closed: malformed or expired authority emits
          // no browser command and the public state remains readable.
        }
      }
    }
    if (action.state === 'approved' && cycle.state === 'approved') {
      try {
        const disposition = evaluateOperatingApprovalSetV2({
          evaluation: evaluation as never,
          action: action as never,
          requirements: requirements as never,
          approvals: approvals as never,
          now: timestamp(),
        });
        const ownsOperation = snapshot.governedOperations.some(
          (operation) => record(operation.action).actionId === action.actionId,
        );
        if (disposition.complete && disposition.disposition === 'approved' && !ownsOperation) {
          projected.push({
            subjectId: String(action.actionId),
            action: {
              tool: 'operate.action.execute',
              arguments: { action: actionIdentity(action) },
              label: 'Execute this exact approved Action',
              effect: action.effectClass,
            },
          });
        }
      } catch {
        // Closed omission; the execution runtime performs the full authority
        // chain again before any contained target is reachable.
      }
    }
    if (action.state === 'completed') {
      const operations = snapshot.governedOperations.filter(
        (operation) => record(operation.action).actionId === action.actionId,
      );
      if (
        !snapshot.outcomes.some(
          (outcome) => outcome.verificationPlanId === action.verificationPlanId,
        )
      ) {
        const terminal = [...operations]
          .filter((operation) => operation.state === 'succeeded')
          .sort((left, right) => String(left.updatedAt).localeCompare(String(right.updatedAt)))
          .at(-1);
        const assignment = terminal
          ? snapshot.assignments.find(
              (candidate) =>
                candidate.assignmentKind === 'verification' &&
                candidate.governedOperationId === terminal.operationId &&
                candidate.state === 'running' &&
                record(candidate.claim).actorId === actor.actorId,
            )
          : null;
        const submission = assignment
          ? snapshot.submissions.find(
              (candidate) =>
                candidate.assignmentId === assignment.assignmentId && candidate.state === 'issued',
            )
          : null;
        const verificationPlan = snapshot.verificationPlans.find(
          (candidate) => candidate.verificationPlanId === action.verificationPlanId,
        );
        const sourceArtifactId = assignment
          ? runtime.preferences.assignmentArtifactIds[String(assignment.assignmentId)]
          : null;
        if (assignment && submission && verificationPlan && typeof sourceArtifactId === 'string') {
          try {
            const claimant = record(assignment.claim);
            const records = buildOperatingTerminalVerificationInsufficientEvidenceV2({
              action: action as never,
              verificationPlan: verificationPlan as never,
              assignment: assignment as never,
              sourceArtifactId,
              timestamp: String(submission.issuedAt),
            });
            const allowedAction = {
              subjectId: String(assignment.assignmentId),
              action: {
                tool: 'operate.assignment.submit',
                arguments: {
                  assignmentId: assignment.assignmentId,
                  submissionId: submission.submissionId,
                  actor: {
                    actorId: claimant.actorId,
                    kind: claimant.actorKind,
                    runtime: claimant.runtime,
                  },
                  mediaType: 'application/json',
                  encoding: 'utf-8',
                  contentBase64: Buffer.from(JSON.stringify(records.outcome)).toString('base64'),
                },
                label: 'Record that verification lacks accepted metric evidence',
                effect: 'machine-local-write',
              },
            };
            projected.push(allowedAction);
          } catch {
            // Closed omission. The recording transaction independently proves
            // the accepted Assignment bytes and full terminal authority chain.
          }
        }
      }
      const rollbackPlans = snapshot.rollbackPlans.filter(
        (candidate) =>
          sameActionIdentity(candidate.action, action) &&
          ['eligible', 'required'].includes(String(candidate.eligibility)),
      );
      if (rollbackPlans.length > 0) {
        const { operation: original, plan, binding } = exactRollbackPlanContext(snapshot, action);
        const bindingHash = sha256Jcs({
          contract: 'openplanr-rollback-approval-v1',
          action: actionIdentity(action),
          ...binding,
        });
        const template = exactRollbackApprovalTemplate(snapshot, action, actor);
        const approvalReady =
          exactRollbackApprovalRecord(
            snapshot,
            action,
            actor,
            template,
            bindingHash,
            String(snapshot.generatedAt),
          ) !== null;
        if (approvalReady) {
          projected.push({
            subjectId: String(action.actionId),
            action: {
              tool: 'operate.action.rollback',
              arguments: {
                action: actionIdentity(action),
                originalOperationId: original.operationId,
                rollbackPlanId: plan.rollbackPlanId,
              },
              label: 'Rollback this exact reversible Action',
              effect: action.effectClass,
            },
          });
        } else {
          projected.push({
            subjectId: String(action.actionId),
            action: {
              tool: 'operate.action.approve',
              arguments: {
                action: actionIdentity(action),
                decision: 'approved',
                rollback: binding,
              },
              label: 'Approve this exact rollback plan',
              effect: action.effectClass,
            },
          });
        }
      }
    }
  }
  return projected;
}

function errorCode(value: unknown): OperateErrorCodeV2 {
  const candidate = (value as { code?: unknown })?.code;
  return typeof candidate === 'string' && SAFE_CODES.has(candidate as OperateErrorCodeV2)
    ? (candidate as OperateErrorCodeV2)
    : 'STATE_TRANSITION_INVALID';
}

function errorContext(value: unknown): Record<string, string | number | boolean | null> {
  const details = (value as { details?: unknown; context?: unknown })?.details;
  const candidate =
    details && typeof details === 'object' && !Array.isArray(details)
      ? ((details as { context?: unknown }).context ?? details)
      : (value as { context?: unknown })?.context;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};
  return Object.fromEntries(
    Object.entries(candidate).filter(
      ([, entry]) =>
        typeof entry === 'string' ||
        typeof entry === 'number' ||
        typeof entry === 'boolean' ||
        entry === null,
    ),
  );
}

function previousEvent(runtime: OperateStoredRuntime): JsonRecord | null {
  const last = runtime.events.at(-1);
  if (last) return last;
  const head = state(runtime).eventHead;
  return head.sequence === 0 ? null : { sequence: head.sequence, eventHash: head.hash };
}

function cycleView(runtime: OperateStoredRuntime, cycleId: string): JsonRecord {
  const snapshot = state(runtime);
  const cycle = findBy(snapshot.cycles, 'cycleId', cycleId);
  if (!cycle) {
    throw new OperateClientError('CYCLE_NOT_FOUND', 'The requested cycle does not exist.', false, {
      cycleId,
    });
  }
  const assignmentIds = new Set(
    Object.values(runtime.preferences.cycleRoleAssignments[cycleId] ?? {}),
  );
  const assignments = snapshot.assignments.filter(
    (entry) => entry.cycleId === cycleId && assignmentIds.has(String(entry.assignmentId)),
  );
  const decisions = snapshot.decisions.filter((entry) => entry.sourceCycleId === cycleId);
  const actions = snapshot.actions.filter((entry) => entry.sourceCycleId === cycleId);
  const actionIds = new Set(actions.map((entry) => entry.actionId));
  const outcomes = snapshot.outcomes.filter((entry) => actionIds.has(entry.actionId));
  const outcomeIds = new Set(outcomes.map((entry) => entry.outcomeId));
  const learnings = snapshot.learnings.filter((entry) => outcomeIds.has(entry.outcomeId));
  const verificationPlans = snapshot.verificationPlans.filter((entry) =>
    actionIds.has(entry.actionId),
  );
  const planId = runtime.preferences.cycleIntelligencePlanIds[cycleId];
  const plan = snapshot.intelligencePlans.find((entry) => entry.planId === planId) ?? null;
  const count = (...states: string[]) =>
    assignments.filter((assignment) => states.includes(String(assignment.state))).length;
  return {
    generation: runtime.generation,
    cycle,
    progress: {
      total: assignments.length,
      pending: count('pending'),
      available: count('available'),
      active: count('claimed', 'running'),
      submitted: count('submitted'),
      validated: count('validated'),
      rejected: count('rejected'),
      terminal: count('validated', 'abandoned', 'failed'),
    },
    availableAssignments: assignments.filter((entry) => entry.state === 'available'),
    assignments,
    roleAssignments: runtime.preferences.cycleRoleAssignments[cycleId] ?? {},
    intelligencePlan: plan,
    activeReview:
      snapshot.reviews.find((entry) => entry.cycleId === cycleId && entry.state === 'pending') ??
      null,
    findings: snapshot.findings.filter((entry) => entry.sourceCycleId === cycleId),
    decisions,
    actions,
    verificationPlans,
    outcomes,
    learnings,
    lifecycle: {
      decisionAcceptance: decisions.map((decision) => ({
        decisionId: decision.decisionId,
        state: decision.state,
        acceptance:
          decision.state === 'approved'
            ? 'accepted'
            : decision.state === 'deferred'
              ? 'deferred-pending-accepted-outcome'
              : decision.state === 'proposed'
                ? 'awaiting-human-review'
                : 'not-accepted',
      })),
      actionApproval: actions.map((action) => ({
        actionId: action.actionId,
        state: action.state,
        approval: action.state === 'approved' ? 'approved' : 'not-approved',
      })),
      verification: {
        state: actions.some((action) => action.state === 'approved')
          ? 'planned-not-yet-executed'
          : 'not-yet-planned',
        planIds: verificationPlans.map((entry) => entry.verificationPlanId),
        assignmentState: 'not-yet-produced-before-terminal-execution',
        resultState: 'not-yet-produced-before-verification',
      },
      outcomeState: outcomes.length > 0 ? 'observed' : 'not-yet-produced',
      learningState: learnings.length > 0 ? 'recorded' : 'not-yet-produced',
    },
    acceptedArtifacts: snapshot.artifacts.filter((entry) => entry.cycleId === cycleId),
    acceptedArtifactIds: snapshot.artifacts
      .filter((entry) => entry.cycleId === cycleId)
      .map((entry) => entry.artifactId),
    integrityBoundary: OPERATE_INTEGRITY_BOUNDARY,
  };
}

function canonicalCycleEnvelope(
  runtime: OperateStoredRuntime,
  cycleId: string,
  operation: 'operate.cycle.start' | 'operate.cycle.get' | 'operate.cycle.resume',
): OperateApiEnvelopeV2 {
  const snapshot = state(runtime);
  const legacy = cycleView(runtime, cycleId);
  const cycle = record(legacy.cycle);
  const ledger = buildOperatingWorkLedgerV2(snapshot as never, cycle as never, {
    generatedAt: String(snapshot.generatedAt),
  }) as unknown as JsonRecord;
  const cycleWork = buildOperatingCycleWorkViewV2(snapshot as never, cycleId, {
    generatedAt: String(snapshot.generatedAt),
  }) as unknown as JsonRecord;
  const ownerActions = cycleReadActions(cycleId);
  const projected = {
    cycle,
    progress: legacy.progress,
    availableAssignments: legacy.availableAssignments,
    acceptedArtifactIds: legacy.acceptedArtifactIds,
    persistentWork: {
      ledger,
      cycleLinks: cycleWork.cycleLinks,
    },
    actions: ownerActions,
  };
  return assertProtocolArtifact(
    'operate-api-envelope',
    {
      ok: true,
      operation,
      data: projected,
      allowedActions: ownerActions,
    },
    { protocolVersion: PROTOCOL_VERSION },
  ) as OperateApiEnvelopeV2;
}

function defaultWorkDispositions(snapshot: RuntimeState, cycleId: string): JsonRecord[] {
  return [
    ...snapshot.findings
      .filter(
        (entry) =>
          entry.sourceCycleId === cycleId && ['open', 'deferred'].includes(String(entry.state)),
      )
      .map((entry) => ({
        entityType: 'operating-finding',
        entityId: entry.findingId,
        disposition: entry.state === 'deferred' ? 'deferred' : 'accepted',
      })),
    ...snapshot.decisions
      .filter((entry) => entry.sourceCycleId === cycleId && entry.state === 'proposed')
      .map((entry) => ({
        entityType: 'operating-decision',
        entityId: entry.decisionId,
        disposition: 'approved',
      })),
    ...snapshot.actions
      .filter((entry) => entry.sourceCycleId === cycleId && entry.state === 'proposed')
      .map((entry) => ({
        entityType: 'operating-action',
        entityId: entry.actionId,
        disposition: 'approved',
      })),
  ];
}

/**
 * OpenPlanr composition over the installed public Operate package. Every
 * request first reconstructs state from canonical Event replay records; this class
 * never imports package-private reducers, fixtures, schemas, or sibling source.
 */
export class OperateClient {
  readonly root: string;
  private readonly projectDir: string;
  private readonly store: OperateStore;
  private readonly containedTargets = new Map<
    string,
    ReturnType<typeof createDisposableLocalProjectTargetV2>
  >();
  private compositionPromise: Promise<OperateComposition> | null = null;
  private measurementPromise: Promise<MeasurementScheduleService> | null = null;

  constructor(projectDir: string) {
    this.store = createOperateStore(projectDir);
    this.root = this.store.root;
    this.projectDir = path.resolve(projectDir);
  }

  async measurement(input: OperateMeasurementCommandV1): Promise<OperateMeasurementResultV1> {
    const effects = (scheduleWrite = false) =>
      Object.freeze([
        Object.freeze({ id: 'schedule-custody-write' as const, executed: scheduleWrite }),
        Object.freeze({ id: 'due-work-issue' as const, executed: false }),
        Object.freeze({ id: 'provider-call' as const, executed: false }),
      ]);
    const success = (
      data: JsonRecord,
      options: {
        scheduleWrite?: boolean;
        authorityRequired?: boolean;
        ownerActionRequired?: boolean;
        nextAction: string;
      },
    ): OperateMeasurementResultV1 =>
      Object.freeze({
        ok: true,
        operation: input.operation,
        effects: effects(options.scheduleWrite),
        authorityRequired: options.authorityRequired ?? false,
        ownerActionRequired: options.ownerActionRequired ?? false,
        nextAction: options.nextAction,
        recovery: null,
        data: Object.freeze(structuredClone(data)),
      });
    try {
      const service = await this.measurementService();
      if (input.operation === 'measurement.preview') {
        const candidate = service.preview(input.schedule);
        this.assertMeasurementActor(input.actor, candidate.ownerActorId);
        return success(
          { schedule: candidate, confirmationDigest: candidate.scheduleHash },
          {
            authorityRequired: true,
            ownerActionRequired: true,
            nextAction:
              'The named owner must confirm this exact schedule digest before enabling it.',
          },
        );
      }
      if (input.operation === 'measurement.enable') {
        const candidate = service.preview(input.schedule);
        await this.assertCurrentMeasurementOwner(input.actor, candidate.ownerActorId);
        if (input.confirmDigest !== candidate.scheduleHash) {
          throw new MeasurementScheduleError(
            'E_MEASUREMENT_CONFIRMATION_REQUIRED',
            'Measurement confirmation does not match the exact previewed schedule.',
          );
        }
        const applied = await service.enable(candidate, input.transition);
        return success(
          { schedule: applied.schedule, receipt: applied.receipt, replayed: applied.replay },
          {
            scheduleWrite: !applied.replay,
            nextAction: applied.replay
              ? 'The exact enable transition was already recorded.'
              : 'Inspect schedule status; no monitor or provider was started.',
          },
        );
      }
      if (input.operation === 'measurement.disable') {
        const current = await service.read(input.scheduleId);
        await this.assertCurrentMeasurementOwner(input.actor, current.schedule.ownerActorId);
        if (input.confirmDigest !== current.schedule.scheduleHash) {
          throw new MeasurementScheduleError(
            'E_MEASUREMENT_CONFIRMATION_REQUIRED',
            'Measurement confirmation does not match current schedule custody.',
          );
        }
        const applied = await service.disable(input.scheduleId, input.transition);
        return success(
          { schedule: applied.schedule, receipt: applied.receipt, replayed: applied.replay },
          {
            scheduleWrite: !applied.replay,
            nextAction: applied.replay
              ? 'The exact disable transition was already recorded.'
              : 'The schedule is inactive and no due work can be issued.',
          },
        );
      }
      const current = await service.read(input.scheduleId);
      await this.assertCurrentMeasurementOwner(input.actor, current.schedule.ownerActorId);
      return success(current as unknown as JsonRecord, {
        nextAction:
          current.schedule.state === 'enabled'
            ? 'Use a governed measurement issuer when due work must be scheduled.'
            : 'Preview and explicitly enable an exact schedule before expecting due work.',
      });
    } catch (cause) {
      const knownMeasurement = cause instanceof MeasurementScheduleError ? cause : null;
      const knownOperate = cause instanceof OperateClientError ? cause : null;
      const authorityRequired =
        knownMeasurement?.code === 'E_MEASUREMENT_SCHEDULE_CONFLICT' ||
        knownMeasurement?.code === 'E_MEASUREMENT_SCHEDULE_LOCKED' ||
        knownMeasurement?.code === 'E_MEASUREMENT_OWNER_REQUIRED' ||
        knownMeasurement?.code === 'E_MEASUREMENT_CONFIRMATION_REQUIRED';
      const code = knownMeasurement?.code ?? knownOperate?.code ?? errorCode(cause);
      const problem =
        knownMeasurement?.message ??
        knownOperate?.message ??
        (cause instanceof Error
          ? cause.message
          : 'The requested measurement operation could not be completed.');
      return Object.freeze({
        ok: false,
        operation: input.operation,
        effects: effects(),
        authorityRequired,
        ownerActionRequired: authorityRequired,
        nextAction: authorityRequired
          ? 'The owner must inspect current schedule custody and submit one exact fresh command.'
          : 'Correct the bounded measurement request before retrying.',
        recovery: problem,
        error: Object.freeze({
          code,
          problem,
        }),
      });
    }
  }

  /** Internal packet-recovery read; never projects Assignment bytes outside this process. */
  async readAssignmentState(assignmentId: string, cycleId: string): Promise<string | null> {
    const runtime = await this.requiredRuntime();
    const assignment = state(runtime).assignments.find(
      (candidate) => candidate.assignmentId === assignmentId && candidate.cycleId === cycleId,
    );
    return assignment ? String(assignment.state) : null;
  }

  /** Run the protocol-owned schema/semantic preflight against exact persisted custody. */
  async preflightAssignmentResult(
    assignmentId: string,
    contentBytes: Uint8Array,
  ): Promise<OperateAssignmentResultPreflight> {
    const runtime = await this.requiredRuntime();
    return preflightOperatingAssignmentResultV2(
      { assignmentId, contentBytes },
      {
        initialState: state(runtime) as never,
        artifactStore: governedArtifactStore(runtime) as never,
      },
    ) as OperateAssignmentResultPreflight;
  }

  /**
   * Read the deterministic runtime-owned identities needed to construct one
   * live-evidence ingestion. This is pre-effect: it does not resolve a
   * credential, call a provider, stage bytes, or mutate the Operate Store.
   */
  async prepareLiveEvidenceSubmission(
    input: Readonly<{
      assignmentId: string;
      submissionId: string;
      actor: OperateActorV2;
    }>,
  ): Promise<LiveEvidenceSubmissionPreparationV2> {
    const runtime = await this.requiredRuntime();
    return liveEvidenceSubmissionPreparation(runtime, input);
  }

  /**
   * Accept an already redacted ingestion through the normal Assignment
   * transaction and resolve its operate-artifact candidate in the same durable
   * Store generation. Connector code never receives Store or Event authority.
   */
  async acceptLiveEvidenceSubmission(
    request: LiveEvidenceSubmissionRequestV2,
  ): Promise<LiveEvidenceSubmissionResultV2> {
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
        withOperateMutationLane(this.root, async () => {
          const runtime = await this.requiredRuntime();
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
          const composition = await this.composition();
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
          const artifactCreatedEvent = requiredEvent(
            preparation.acceptanceEventIds.artifactCreated,
          );
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
            await this.store.commit(
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

  /** Build the closed access-safe Cycle DTO before data crosses into browser state. */
  async readCycleWorkspace(cycleId: string, actor: OperateActorV2): Promise<unknown> {
    try {
      return await readOperateCycleWorkspace({
        cycleId,
        actor,
        readExperience: async (request) => await this.experience(request),
        readCycle: async (requestedCycleId) =>
          await this.get(requestedCycleId, 'operate.cycle.get'),
        refuse: (code, message) => {
          throw new OperateClientError(code, message, false);
        },
      });
    } catch (cause) {
      return this.failure('operate.cycle.get', cause);
    }
  }

  /** Build the closed access-safe Action DTO before data crosses into browser state. */
  async readActionWorkspace(
    actionId: string,
    cycleId: string,
    actor: OperateActorV2,
  ): Promise<unknown> {
    try {
      return await readOperateActionWorkspace({
        actionId,
        cycleId,
        actor,
        readExperience: async (request) => await this.experience(request),
        refuse: (code, message) => {
          throw new OperateClientError(code, message, false);
        },
      });
    } catch (cause) {
      return this.failure('operate.experience.get', cause);
    }
  }

  /** Build the closed access-safe recovery DTO before data crosses into browser state. */
  async readRecoveryDisplay(cycleId: string, actor: OperateActorV2): Promise<unknown> {
    try {
      return await readOperateRecoveryDisplay({
        cycleId,
        actor,
        readExperience: async (request) => await this.experience(request),
        inspectRecovery: async () =>
          await this.dispatch({ operation: 'operate.recovery.inspect', request: {} }),
        refuse: (code, message) => {
          throw new OperateClientError(code, message, false);
        },
      });
    } catch (cause) {
      return this.failure('operate.recovery.inspect', cause);
    }
  }

  /** Build the closed access-safe executive board DTO before data crosses into browser state. */
  async readExecutiveBoardDisplay(cycleId: string, actor: OperateActorV2): Promise<unknown> {
    try {
      return await readOperateExecutiveBoardDisplay({
        cycleId,
        actor,
        readExperience: async (request) => await this.experience(request),
        refuse: (code, message) => {
          throw new OperateClientError(code, message, false);
        },
      });
    } catch (cause) {
      return this.failure('operate.cycle.get', cause);
    }
  }

  /** Build one owner-selected, browser-verifiable read-only audit display. */
  async readAuditDisplay(request: OperateAuditDisplayRequestV1): Promise<unknown> {
    try {
      const auditSurfaces = new Set([
        'evidence',
        'outcomes',
        'outcome',
        'history',
        'search',
        'export',
      ]);
      if (
        !exactAuditDisplayRequest(request) ||
        !isOperatePublicId(request.cycleId) ||
        !request.actor ||
        typeof request.actor.actorId !== 'string' ||
        !auditSurfaces.has(request.surface)
      ) {
        throw new OperateClientError(
          'RESULT_CONTRACT_INVALID',
          'The operating audit display request is invalid.',
          false,
        );
      }
      const subjectId = request.subjectId ?? null;
      const query = request.surface === 'search' ? (request.query ?? '') : null;
      const format = request.surface === 'export' ? (request.format ?? 'json') : null;
      if (
        (request.surface === 'outcome' && subjectId === null) ||
        (!['evidence', 'outcome'].includes(request.surface) && subjectId !== null) ||
        (request.surface !== 'search' && request.query !== undefined) ||
        (request.surface !== 'export' && request.format !== undefined) ||
        (typeof query === 'string' && query.length > 512)
      ) {
        throw new OperateClientError(
          'RESULT_CONTRACT_INVALID',
          'The operating audit display selection is invalid.',
          false,
        );
      }
      const experience = await this.experience({
        cycleId: request.cycleId,
        actor: request.actor,
      });
      if (!experience.ok) return experience;
      const view = record(experience.data);
      const owner = await loadOperateExperienceReaderOwner((code, message) => {
        throw new OperateClientError(code, message, false);
      });
      return owner.selectOperateExperienceAuditDisplaySurface(view, {
        surface: request.surface,
        binding: {
          actorId: String(view.actorId),
          scopeId: String(view.scopeId),
          domainId: String(view.domainId),
          domainVersion: String(view.domainVersion),
          cycleId: request.cycleId,
          subjectId,
          surface: request.surface,
          query,
          format,
          generatedAt: String(view.generatedAt),
          eventHead: record(view.eventHead),
          viewHash: String(view.viewHash),
        },
        subjectId,
        cycleId: request.cycleId,
        query,
        format,
      });
    } catch (cause) {
      return this.failure('operate.experience.get', cause);
    }
  }

  /** Compose one exact command preview through the installed projection owner. */
  async createExperiencePreview(input: OperateExperiencePreviewRequestV1): Promise<JsonRecord> {
    const runtime = await this.requiredRuntime();
    const snapshot = state(runtime);
    const cycle = findBy(snapshot.cycles, 'cycleId', input.stateCycleId);
    if (!cycle) {
      throw new OperateClientError('CYCLE_NOT_FOUND', 'The requested cycle does not exist.', false);
    }
    if (String(input.view.actorId) !== input.actor.actorId) {
      throw new OperateClientError(
        'CAPABILITY_DENIED',
        'The preview actor does not match the exact current view.',
        false,
      );
    }
    return (await this.composition()).preview({
      state: snapshot,
      scope: {
        scopeId: String(cycle.scopeId),
        domainId: String(cycle.domainId),
        domainVersion: String(cycle.domainVersion),
      },
      view: input.view,
      actionDigest: input.actionDigest,
      authority: input.authority,
      reasonCodes: input.reasonCodes,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
    });
  }

  /** Read an immutable terminal Review receipt without replaying its mutation. */
  async readCommittedReviewReceipt(
    request: ReviewRequest,
  ): Promise<OperateApiEnvelopeV2<'operate.review.submit'>> {
    try {
      const runtime = await this.requiredRuntime();
      return readCommittedOperateReviewReceipt(
        runtime,
        request,
      ) as OperateApiEnvelopeV2<'operate.review.submit'>;
    } catch (cause) {
      return this.failure('operate.review.submit', cause);
    }
  }

  /**
   * Reconstruct one access-screened experience at an immutable historical
   * Event head. This is read-only and never exposes Store or replay internals.
   */
  async readExperienceAtEventHead(
    request: ExperienceRequest,
    expectedEventHead: OperateEventHeadV2,
  ): Promise<OperateApiEnvelopeV2<'operate.experience.get'>> {
    try {
      const current = await this.requiredRuntime();
      const historical = await this.runtimeAtEventHead(current, expectedEventHead);
      return (await this.experience(
        request,
        historical,
      )) as OperateApiEnvelopeV2<'operate.experience.get'>;
    } catch (cause) {
      return this.failure('operate.experience.get', cause);
    }
  }

  /** Commit one exact owner-bound Review choice through the additive facade. */
  async submitBoundReview(
    submission: OperateReviewBoundSubmissionV1,
  ): Promise<OperateApiEnvelopeV2<'operate.review.submit'>> {
    try {
      return (await submitBoundOperateReview({
        root: this.root,
        submission,
        issueFactory: replaySafeIssueFactory,
        requiredRuntime: async () => await this.requiredRuntime(),
        commit: async (runtime, nextState, events) => await this.commit(runtime, nextState, events),
      })) as OperateApiEnvelopeV2<'operate.review.submit'>;
    } catch (cause) {
      return this.failure('operate.review.submit', cause);
    }
  }

  async dispatch<Operation extends OperateToolNameV2>(
    input: OperateDispatchRequestForV2<Operation>,
  ): Promise<OperateApiEnvelopeV2<Operation>>;
  async dispatch(input: OperateDispatchRequestV2): Promise<OperateApiEnvelopeV2> {
    try {
      switch (input.operation) {
        case 'operate.cycle.start':
          return await this.start(input.request);
        case 'operate.cycle.get':
          return await this.get(input.request.cycleId, input.operation);
        case 'operate.cycle.resume':
          return await this.get(input.request.cycleId, input.operation);
        case 'operate.assignment.claim':
          return await this.claim(input.request);
        case 'operate.assignment.submit':
          return await this.submit(input.request);
        case 'operate.review.get':
          return await this.review(input.request);
        case 'operate.review.submit':
          return await this.submitReview(input.request);
        case 'operate.action.approve':
          return await this.approveAction(input.request);
        case 'operate.action.execute':
          return await this.executeAction(input.request);
        case 'operate.action.rollback':
          return await this.rollbackAction(input.request);
        case 'operate.artifact.get':
          return await this.artifact(input.request);
        case 'operate.experience.get':
          return await this.experience(input.request);
        case 'operate.planning.preview':
          return await this.planningPreview(
            input.request.actionId,
            input.request.actor,
            input.request.framing,
          );
        case 'operate.planning.create-spec':
          return await this.planningCreateSpec(
            input.request.proposalId,
            input.request.confirmDigest,
            input.request.actor,
          );
        case 'operate.planning.ingest-delivery':
          return await this.planningIngestDelivery(input.request);
        case 'operate.recovery.inspect':
          return await this.inspectRecovery();
        case 'operate.recovery.restore':
          return await this.restore(input.request.generation);
        case 'operate.recovery.clear-stale-lock':
          return await this.clearStaleLock();
      }
    } catch (cause) {
      return this.failure(input.operation, cause);
    }
  }

  private assertMeasurementActor(actor: OperateActorV2, expectedOwnerActorId?: string): void {
    if (
      actor.kind !== 'human' ||
      actor.runtime !== 'openplanr' ||
      !actor.actorId ||
      (expectedOwnerActorId !== undefined && actor.actorId !== expectedOwnerActorId)
    ) {
      throw new MeasurementScheduleError(
        'E_MEASUREMENT_OWNER_REQUIRED',
        'Measurement custody requires the exact named human owner.',
      );
    }
  }

  private async assertCurrentMeasurementOwner(
    actor: OperateActorV2,
    expectedOwnerActorId?: string,
  ): Promise<void> {
    this.assertMeasurementActor(actor, expectedOwnerActorId);
    const runtime = await this.requiredRuntime();
    if (runtime.preferences.actorMemberships[actor.actorId]?.role !== 'owner') {
      throw new MeasurementScheduleError(
        'E_MEASUREMENT_OWNER_REQUIRED',
        'Measurement custody requires a current durable Operate owner.',
      );
    }
  }

  private async measurementService(): Promise<MeasurementScheduleService> {
    this.measurementPromise ??= this.composition().then((composition) =>
      createProjectMeasurementScheduleService(this.projectDir, composition),
    );
    return await this.measurementPromise;
  }

  private async composition(): Promise<OperateComposition> {
    this.compositionPromise ??= createOperateComposition();
    return await this.compositionPromise;
  }

  private async planningPreview(
    actionId: string,
    actor: OperateActorV2,
    framing?: JsonRecord,
  ): Promise<OperateApiEnvelopeV2> {
    const runtime = await this.requiredRuntime();
    const proposal = await previewOperatingPlanningSpec({
      projectDir: this.projectDir,
      runtimeRoot: this.root,
      runtime,
      actionId,
      actor: actor as { actorId: string; kind: 'human' },
      framing,
    });
    return this.success('operate.planning.preview', proposal);
  }

  private async planningCreateSpec(
    proposalId: string,
    confirmDigest: string,
    actor: OperateActorV2,
  ): Promise<OperateApiEnvelopeV2> {
    const runtime = await this.requiredRuntime();
    const receipt = await createSpecForOperatingPlanning({
      projectDir: this.projectDir,
      runtimeRoot: this.root,
      runtime,
      proposalId,
      confirmDigest,
      actor: actor as { actorId: string; kind: 'human' },
    });
    return this.success('operate.planning.create-spec', receipt);
  }

  private async planningIngestDelivery(
    evidence: OperateToolRequestMapV2['operate.planning.ingest-delivery'],
  ): Promise<OperateApiEnvelopeV2> {
    const runtime = await this.requiredRuntime();
    const composition = await this.composition();
    const result = await ingestPlanningDeliveryEvidence({
      projectDir: this.projectDir,
      runtime,
      composition,
      evidence,
    });
    const committed = result.replayed
      ? runtime
      : await this.store.commit(
          {
            baseState: runtime.baseState,
            state: result.runtime.state,
            events: result.runtime.events,
            artifacts: result.runtime.artifacts,
            preferences: runtime.preferences,
          },
          runtime.generation,
        );
    return this.success('operate.planning.ingest-delivery', {
      deliveryEvidence: result.deliveryEvidence,
      evidenceRef: result.evidenceRef,
      assignment: result.assignment,
      eventHead: committed.state.eventHead,
      replayed: result.replayed,
    });
  }

  private async load(): Promise<OperateStoredRuntime | null> {
    await ensureOperateStorageLayout(this.projectDir);
    const composition = await this.composition();
    return await this.store.load(async ({ baseState, events, artifacts }) =>
      composition.replay(baseState, events, artifacts),
    );
  }

  private async event(
    runtime: OperateStoredRuntime,
    input: {
      type: string;
      entityId: string;
      cycleId: string;
      payload: unknown;
      correlationId: string;
      timestamp?: string;
      actor?: { kind: 'engine' | 'runtime' | 'human'; id: string };
      causationId?: string | null;
      requestHash?: string;
    },
  ): Promise<JsonRecord> {
    return (await this.composition()).createEvent(
      {
        eventId: id('evt'),
        timestamp: input.timestamp ?? timestamp(),
        cycleId: input.cycleId,
        type: input.type,
        entityId: input.entityId,
        actor: input.actor ?? { kind: 'engine', id: 'openplanr' },
        causationId:
          input.causationId ?? (runtime.events.at(-1)?.eventId as string | undefined) ?? null,
        correlationId: input.correlationId,
        ...(input.requestHash === undefined ? {} : { requestHash: input.requestHash }),
        payload: input.payload,
      },
      previousEvent(runtime),
    );
  }

  private async start(request: OperateStartRequestV2): Promise<OperateApiEnvelopeV2> {
    return (await startOperateCycle({
      request,
      projectDir: this.projectDir,
      composition: async () => await this.composition(),
      load: async () => await this.load(),
      createEvent: async (runtime, eventInput) => await this.event(runtime, eventInput),
      commit: async (next, expectedGeneration) => await this.store.commit(next, expectedGeneration),
      id,
      timestamp,
      cycleEnvelope: canonicalCycleEnvelope,
    })) as OperateApiEnvelopeV2;
  }

  private async get(
    cycleId: string,
    operation: 'operate.cycle.get' | 'operate.cycle.resume',
  ): Promise<OperateApiEnvelopeV2> {
    const runtime = await this.requiredRuntime();
    return canonicalCycleEnvelope(runtime, cycleId, operation);
  }

  private async claim(
    request: ClaimRequest,
  ): Promise<OperateApiEnvelopeV2<'operate.assignment.claim'>> {
    return (await claimOperateAssignment({
      root: this.root,
      request,
      issueFactory: replaySafeIssueFactory,
      requiredRuntime: async () => await this.requiredRuntime(),
      composition: async () => await this.composition(),
      commit: async (runtime, nextState, events) => await this.commit(runtime, nextState, events),
      refuse: (code, message, context = {}) => {
        throw new OperateClientError(code, message, false, context);
      },
    })) as OperateApiEnvelopeV2<'operate.assignment.claim'>;
  }

  private async submit(request: SubmitRequest): Promise<OperateApiEnvelopeV2> {
    const issue = replaySafeIssueFactory();
    return await retryReplaySafeGenerationConflict(`submit:${sha256Jcs(request as never)}`, () =>
      withOperateMutationLane(this.root, () => this.submitAttempt(request, issue())),
    );
  }

  private async submitAttempt(
    request: SubmitRequest,
    issue: ReplaySafeIssue,
  ): Promise<OperateApiEnvelopeV2> {
    const runtime = await this.requiredRuntime();
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
    const composition = await this.composition();
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
      return this.success(
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
      await this.store.commit(
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
      return this.success(
        'operate.assignment.submit',
        accepted.response,
        cycleReadActions(String(assignment.cycleId), request.actor),
      );
    }
    if (assignment.assignmentKind !== 'chair') {
      await this.store.commit(
        {
          baseState: runtime.baseState,
          state: accepted.state,
          events: [...runtime.events, ...(accepted.events as JsonRecord[])],
          artifacts,
          preferences: runtime.preferences,
        },
        runtime.generation,
      );
      return this.success(
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
            capabilityGrants:
              (runtime.baseState.capabilityGrants as JsonRecord[] | undefined) ?? [],
            governedOperations:
              (runtime.baseState.governedOperations as JsonRecord[] | undefined) ?? [],
            executionResults:
              (runtime.baseState.executionResults as JsonRecord[] | undefined) ?? [],
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
      const evaluated = await this.event(stagedRuntime, {
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
        const reviewCreated = await this.event(stagedRuntime, {
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
    await this.store.commit(
      {
        baseState: reviewBaseState,
        state: current,
        events: stagedRuntime.events,
        artifacts,
        preferences: runtime.preferences,
      },
      runtime.generation,
    );
    return this.success(
      'operate.assignment.submit',
      accepted.response,
      cycleReadActions(String(assignment.cycleId), request.actor),
    );
  }

  private async review(request: ReviewRequest): Promise<OperateApiEnvelopeV2> {
    const runtime = await this.requiredRuntime();
    return readOperateReview(runtime, request) as OperateApiEnvelopeV2;
  }

  private async submitReview(request: ReviewSubmitRequest): Promise<OperateApiEnvelopeV2> {
    return (await submitOperateReview({
      root: this.root,
      request,
      issueFactory: replaySafeIssueFactory,
      requiredRuntime: async () => await this.requiredRuntime(),
      commit: async (runtime, nextState, events) => await this.commit(runtime, nextState, events),
    })) as OperateApiEnvelopeV2;
  }

  private async artifact(request: ArtifactRequest): Promise<OperateApiEnvelopeV2> {
    const runtime = await this.requiredRuntime();
    const snapshot = state(runtime);
    const membership = runtime.preferences.actorMemberships[request.actor.actorId];
    return readOperatingArtifactV2(request as never, {
      initialState: snapshot as never,
      artifactStore: governedArtifactStore(runtime) as never,
      capabilities: ['operate.artifact.get'],
      scopeMembership:
        request.actor.kind === 'human' &&
        membership?.role === 'owner' &&
        membership.scopeId === request.scope.scopeId &&
        membership.domainId === request.scope.domainId &&
        membership.domainVersion === request.scope.domainVersion
          ? {
              active: true,
              actorId: request.actor.actorId,
              scopeId: membership.scopeId,
              domainId: membership.domainId,
              domainVersion: membership.domainVersion,
            }
          : null,
    }) as unknown as OperateApiEnvelopeV2;
  }

  private async experience(
    request: ExperienceRequest,
    selectedRuntime?: OperateStoredRuntime,
  ): Promise<OperateApiEnvelopeV2> {
    if (
      request.surface &&
      ![
        'today',
        'inbox',
        'cycles',
        'cycle',
        'evidence',
        'outcomes',
        'outcome',
        'history',
        'search',
        'export',
        'actions',
        'action',
      ].includes(request.surface)
    ) {
      throw new OperateClientError(
        'RESULT_CONTRACT_INVALID',
        'The requested operating experience surface is unsupported.',
        false,
      );
    }
    if (request.surface === 'search' && (request.query?.length ?? 0) > 512) {
      throw new OperateClientError(
        'RESULT_CONTRACT_INVALID',
        'The operating search query exceeds the local read limit.',
        false,
      );
    }
    if (['cycle', 'outcome', 'action'].includes(request.surface ?? '') && !request.subjectId) {
      throw new OperateClientError(
        'RESULT_CONTRACT_INVALID',
        'This operating experience surface requires a subject.',
        false,
      );
    }
    if (
      request.surface === 'export' &&
      request.format &&
      !['json', 'html'].includes(request.format)
    ) {
      throw new OperateClientError(
        'RESULT_CONTRACT_INVALID',
        'The requested operating export format is unsupported.',
        false,
      );
    }
    const runtime = selectedRuntime ?? (await this.requiredRuntime());
    if (
      request.actionBinding &&
      (request.actionBinding.cycleId !== request.cycleId ||
        request.actionBinding.actorId !== request.actor.actorId)
    ) {
      throw new OperateClientError(
        'CAPABILITY_DENIED',
        'This emitted action is bound to a different durable operating context.',
        false,
        { cycleId: request.cycleId, bindingMismatch: true },
      );
    }
    const snapshot = state(runtime);
    const cycle = findBy(snapshot.cycles, 'cycleId', request.cycleId);
    if (!cycle) {
      throw new OperateClientError(
        'CYCLE_NOT_FOUND',
        'The requested cycle does not exist.',
        false,
        {
          cycleId: request.cycleId,
        },
      );
    }
    if (
      request.actionBinding &&
      !isDurableCycleActor(runtime, snapshot, request.cycleId, request.actor)
    ) {
      throw new OperateClientError(
        'CAPABILITY_DENIED',
        'This emitted action is not bound to the durable operating context.',
        false,
        { cycleId: request.cycleId, bindingMismatch: true },
      );
    }
    const review = snapshot.reviews.find(
      (entry) => entry.cycleId === request.cycleId && entry.state === 'pending',
    );
    const reviewedAction =
      review && record(review.subject).type === 'action'
        ? exactAction(snapshot, {
            actionId: String(record(review.subject).actionId),
            revision: Number(record(review.subject).revision),
            actionHash: String(record(review.subject).actionHash),
          })
        : undefined;
    const composition = await this.composition();
    const allowedActionEntries = review
      ? (() => {
          const derived = bindActorActions(
            composition.allowedActions({
              actor: request.actor,
              capabilities: ['operate.review.get', REVIEW_SUBMIT_CAPABILITY],
              cycle,
              review,
              ...(reviewedAction === undefined ? {} : { action: reviewedAction }),
            }),
            request.actor,
            record(review.subject).type === 'action'
              ? []
              : defaultWorkDispositions(snapshot, request.cycleId),
          );
          if (request.actor.kind !== 'human' || review.ownerActorId !== request.actor.actorId) {
            return derived
              .filter((action) => action.tool !== 'operate.review.submit')
              .map((action) => ({ subjectId: String(review.reviewId), action }));
          }
          const exactRead = readOperateReview(runtime, {
            reviewId: String(review.reviewId),
            cycleId: request.cycleId,
            actor: request.actor as OperateActorV2 & { kind: 'human' },
            scope: {
              scopeId: String(cycle.scopeId),
              domainId: String(cycle.domainId),
              domainVersion: String(cycle.domainVersion),
            },
          }) as OperateApiEnvelopeV2<'operate.review.get'>;
          if (!exactRead.ok) return [];
          return [
            ...derived.filter((action) => action.tool !== 'operate.review.submit'),
            ...(exactRead.allowedActions as JsonRecord[]),
          ].map((action) => ({ subjectId: String(review.reviewId), action }));
        })()
      : governedExperienceActions(runtime, snapshot, cycle, request.actor);
    const allowedActions = allowedActionEntries.map((entry) => entry.action);
    const projected = composition.experience({
      state: snapshot,
      baseState: runtime.baseState,
      events: runtime.events,
      cycleId: request.cycleId,
      scope: {
        scopeId: String(cycle.scopeId),
        domainId: String(cycle.domainId),
        domainVersion: String(cycle.domainVersion),
      },
      actor: {
        actorId: request.actor.actorId,
        accessLevel: (() => {
          const membership = runtime.preferences.actorMemberships[request.actor.actorId];
          return membership?.role === 'owner' &&
            membership.scopeId === cycle.scopeId &&
            membership.domainId === cycle.domainId &&
            membership.domainVersion === cycle.domainVersion
            ? 'internal'
            : 'public';
        })(),
      },
      allowedActions: allowedActionEntries.map((entry) => ({
        subjectId: entry.subjectId,
        // Review and Assignment actions carry the exact runtime-issued actor
        // custody required by their frozen command contracts. Other projected
        // commands remain actor-neutral until an authenticated dispatch binds them.
        action: projectAllowedAction(entry.action),
      })),
      routes: runtime.preferences.cycleDeliveryRoutes,
      // Projection identity is durable-state derived. Re-reading or restarting
      // at the same Event head must not manufacture a new view hash.
      generatedAt: String(snapshot.generatedAt),
    });
    if (projected.kind !== 'operate-experience-view') {
      throw new OperateClientError(
        'CONTRACT_VERSION_UNSUPPORTED',
        'The durable operating state cannot be served through the current experience contract.',
        false,
        { cycleId: request.cycleId },
      );
    }
    const owner = await loadOperateExperienceReaderOwner((code, message) => {
      throw new OperateClientError(code, message, false);
    });
    const view = owner.buildOperateExperienceTransportView(projected);
    const selected = request.surface
      ? owner.selectOperateExperienceSurface(view, {
          surface: request.surface,
          binding: {
            actorId: String(view.actorId),
            scopeId: String(view.scopeId),
            domainId: String(view.domainId),
            domainVersion: String(view.domainVersion),
          },
          subjectId: request.subjectId ?? null,
          cycleId: request.cycleId,
          query: request.query ?? '',
          format: request.format ?? 'json',
          projectId: request.projectId ?? null,
          generation: request.generation ?? null,
        })
      : view;
    if (selected === null || (record(selected).ok === false && record(selected).status === 404)) {
      throw new OperateClientError(
        'OPERATE_SUBJECT_NOT_FOUND',
        'The requested operating subject does not exist in this scope.',
        false,
      );
    }
    if (record(selected).ok === false) {
      throw new OperateClientError(
        'RESULT_CONTRACT_INVALID',
        'The requested operating experience surface could not be selected.',
        false,
      );
    }
    return this.success('operate.experience.get', selected, allowedActions);
  }

  private async approveAction(
    request: OperateToolRequestMapV2['operate.action.approve'],
  ): Promise<OperateApiEnvelopeV2> {
    const runtime = await this.requiredRuntime();
    const snapshot = state(runtime);
    const selected = exactAction(snapshot, request.action);
    const rollbackContext = request.rollback;
    let workingRuntime = runtime;
    let workingState = snapshot;
    const prefixEvents: JsonRecord[] = [];
    let rollbackSourceTemplate: ExactRollbackApprovalTemplate | null = null;
    if (rollbackContext) {
      if (request.decision !== 'approved' || selected.state !== 'completed') {
        throw new OperateClientError(
          'APPROVAL_INVALID',
          'Rollback approval is available only for one completed exact Action.',
          false,
        );
      }
      const { plan } = exactRollbackPlanContext(snapshot, selected, {
        binding: rollbackContext as unknown as JsonRecord,
      });
      if (Date.parse(String(plan.expiresAt)) <= Date.now()) {
        throw new OperateClientError(
          'ROLLBACK_NOT_ELIGIBLE',
          'Rollback approval must bind the exact live plan, parent operation/result, and target precondition.',
          false,
        );
      }
      rollbackSourceTemplate = exactRollbackApprovalTemplate(snapshot, selected, request.actor);
      const rollbackEvaluationId = stableId('pevl', `rollback:${sha256Jcs(rollbackContext)}`);
      const rollbackEvaluationEvents = runtime.events.filter(
        (event) => event.type === 'policy.evaluated' && event.entityId === rollbackEvaluationId,
      );
      const stagedTemplateExists =
        rollbackSourceTemplate.evaluation.evaluationId === rollbackEvaluationId;
      if (stagedTemplateExists) {
        if (
          rollbackEvaluationEvents.length !== 1 ||
          Date.parse(String(rollbackSourceTemplate.requirement.expiresAt)) <= Date.now()
        ) {
          throw new OperateClientError(
            'APPROVAL_INVALID',
            'The exact staged rollback approval template is unavailable or expired.',
            false,
          );
        }
      } else {
        if (rollbackEvaluationEvents.length !== 0) {
          throw new OperateClientError(
            'APPROVAL_INVALID',
            'The rollback approval evaluation identity already exists with different custody.',
            false,
          );
        }
        const evaluatedAt = timestamp();
        const rollbackEvaluation = evaluateOperatingActionPolicyV2({
          action: selected as never,
          configuredPolicies: snapshot.actionPolicies as never,
          evaluatedAt,
          evaluationId: rollbackEvaluationId,
        }) as unknown as JsonRecord;
        const rollbackRequirement = createOperatingApprovalRequirementV2({
          policyRequirementId: GOVERNED_APPROVAL_TEMPLATE_ID,
          evaluation: rollbackEvaluation as never,
          action: selected as never,
          parties: structuredClone(rollbackSourceTemplate.requirement.parties) as never,
          threshold: Number(rollbackSourceTemplate.requirement.threshold),
          expiresAt: later(evaluatedAt, 10 * 60_000),
          consumable: true,
        }) as unknown as JsonRecord;
        const stagedBase = {
          ...runtime.baseState,
          approvalRequirements: mergeRecordsBy(
            runtime.baseState.approvalRequirements as JsonRecord[] | undefined,
            [rollbackRequirement],
            (record) => String(record.requirementId),
          ),
        };
        workingState = {
          ...snapshot,
          approvalRequirements: mergeRecordsBy(
            snapshot.approvalRequirements,
            [rollbackRequirement],
            (record) => String(record.requirementId),
          ),
        } as RuntimeState;
        workingRuntime = { ...runtime, baseState: stagedBase, state: workingState };
        const evaluated = await this.event(workingRuntime, {
          type: 'policy.evaluated',
          entityId: String(rollbackEvaluation.evaluationId),
          cycleId: String(selected.sourceCycleId),
          correlationId: stableId('corr', `rollback-approval:${sha256Jcs(rollbackContext)}`),
          timestamp: evaluatedAt,
          requestHash: String(rollbackEvaluation.inputHash),
          actor: { kind: 'runtime', id: 'openplanr' },
          payload: rollbackEvaluation,
        });
        workingState = (await this.composition()).reduce(
          workingState,
          [evaluated],
          runtime.artifacts,
        ) as unknown as RuntimeState;
        prefixEvents.push(evaluated);
        workingRuntime = {
          ...workingRuntime,
          state: workingState,
          events: [...runtime.events, evaluated],
        };
      }
    }
    const rollbackTemplate = rollbackContext
      ? exactRollbackApprovalTemplate(workingState, selected, request.actor)
      : null;
    if (
      rollbackSourceTemplate &&
      rollbackTemplate &&
      (!sameCanonicalValue(
        rollbackTemplate.requirement.parties,
        rollbackSourceTemplate.requirement.parties,
      ) ||
        rollbackTemplate.requirement.threshold !== rollbackSourceTemplate.requirement.threshold)
    ) {
      throw new OperateClientError(
        'APPROVAL_INVALID',
        'Rollback approval parties or threshold diverged from the exact source template.',
        false,
      );
    }
    const evaluations = workingState.policyEvaluations
      .filter(
        (candidate) =>
          (candidate.action as JsonRecord)?.actionId === selected.actionId &&
          (candidate.action as JsonRecord)?.revision === selected.revision &&
          (candidate.action as JsonRecord)?.actionHash === selected.actionHash,
      )
      .sort(
        (left, right) =>
          String(left.evaluatedAt).localeCompare(String(right.evaluatedAt)) ||
          String(left.evaluationId).localeCompare(String(right.evaluationId)),
      );
    const evaluation = rollbackTemplate?.evaluation ?? evaluations.at(-1);
    if (!evaluation) {
      throw new OperateClientError(
        'POLICY_EVALUATION_REJECTED',
        'The exact current Action has no durable policy evaluation.',
        false,
      );
    }
    const requirementIds = Array.isArray(evaluation.approvalRequirementIds)
      ? evaluation.approvalRequirementIds
      : [];
    const requirements = workingState.approvalRequirements.filter((candidate) =>
      requirementIds.includes(candidate.requirementId),
    );
    const requirement =
      rollbackTemplate?.requirement ??
      requirements.find(
        (candidate) =>
          Array.isArray(candidate.parties) &&
          candidate.parties.some(
            (party) =>
              party !== null &&
              typeof party === 'object' &&
              (party as JsonRecord).actorKind === 'human' &&
              (party as JsonRecord).actorId === request.actor.actorId,
          ),
      );
    const party =
      rollbackTemplate?.party ??
      (Array.isArray(requirement?.parties)
        ? requirement.parties.find(
            (candidate) =>
              candidate !== null &&
              typeof candidate === 'object' &&
              (candidate as JsonRecord).actorKind === 'human' &&
              (candidate as JsonRecord).actorId === request.actor.actorId,
          )
        : null);
    if (!requirement || !party || typeof party !== 'object' || Array.isArray(party)) {
      throw new OperateClientError(
        'APPROVAL_INVALID',
        'The authenticated actor is not a named party for the current approval requirement.',
        false,
      );
    }
    const issuedAt = timestamp();
    const rollbackBindingHash = rollbackContext
      ? sha256Jcs({
          contract: 'openplanr-rollback-approval-v1',
          action: actionIdentity(selected),
          ...rollbackContext,
        })
      : null;
    if (
      rollbackTemplate &&
      rollbackBindingHash &&
      exactRollbackApprovalRecord(
        workingState,
        selected,
        request.actor,
        rollbackTemplate,
        rollbackBindingHash,
        issuedAt,
      )
    ) {
      throw new OperateClientError(
        'APPROVAL_INVALID',
        'This exact rollback approval party has already recorded its decision.',
        false,
      );
    }
    const approval = createOperatingApprovalRecordV2({
      approvalId: stableId(
        'aprv',
        `${selected.actionHash}:${requirement.requirementId}:${party.partyId}:${request.decision}:${rollbackBindingHash ?? 'execute'}`,
      ),
      requirement: requirement as never,
      evaluation: evaluation as never,
      action: selected as never,
      partyId: String(party.partyId),
      actor: {
        kind: 'human',
        actorId: request.actor.actorId,
        capability: structuredClone(party.requiredCapability),
      } as never,
      decision: request.decision,
      issuedAt,
      expiresAt: (requirement.expiresAt as string | null) ?? null,
    });
    const approvalEvent = await this.event(workingRuntime, {
      type: 'approval.recorded',
      entityId: approval.approvalId,
      cycleId: String(selected.sourceCycleId),
      correlationId: stableId('corr', `approval:${approval.approvalId}`),
      timestamp: approval.issuedAt,
      actor: { kind: 'human', id: request.actor.actorId },
      ...(rollbackBindingHash ? { requestHash: rollbackBindingHash } : {}),
      payload: approval,
    });
    let nextState = (await this.composition()).reduce(
      workingState,
      [approvalEvent],
      runtime.artifacts,
    );
    const approvals = [
      ...workingState.approvalRecords.filter(
        (candidate) => candidate.evaluationId === evaluation.evaluationId,
      ),
      approval,
    ];
    const disposition = evaluateOperatingApprovalSetV2({
      evaluation: evaluation as never,
      action: selected as never,
      requirements: requirements as never,
      approvals: approvals as never,
      now: issuedAt,
    });
    const events: JsonRecord[] = [...prefixEvents, approvalEvent];
    if (disposition.disposition !== null && !rollbackContext) {
      const transitionEvent = await this.event(
        { ...runtime, state: nextState, events: [...runtime.events, approvalEvent] },
        {
          type: `action.${disposition.disposition}`,
          entityId: String(selected.actionId),
          cycleId: String(selected.sourceCycleId),
          correlationId: stableId('corr', `approval:${approval.approvalId}`),
          timestamp: issuedAt,
          actor: { kind: 'engine', id: 'openplanr' },
          payload: {
            action: structuredClone(request.action),
            from: selected.state,
            to: disposition.disposition,
            operationId: null,
            resultId: null,
            reasonCode: null,
          },
        },
      );
      nextState = (await this.composition()).reduce(
        nextState,
        [transitionEvent],
        runtime.artifacts,
      );
      events.push(transitionEvent);
    }
    const committed = await this.commit(
      workingRuntime,
      nextState,
      events.slice(prefixEvents.length),
    );
    return this.success('operate.action.approve', {
      generation: committed.generation,
      actionId: selected.actionId,
      disposition: request.decision,
      complete: disposition.complete,
    });
  }

  private async prepareTerminalVerificationSubmission(
    runtime: OperateStoredRuntime,
    nextState: JsonRecord,
    events: JsonRecord[],
    assignmentId: string,
    actorId: string,
  ): Promise<{
    runtime: OperateStoredRuntime;
    state: JsonRecord;
    events: JsonRecord[];
  }> {
    const composition = await this.composition();
    const withReservation = withVerificationArtifactReservations(runtime, nextState);
    const assignment = findBy(
      (nextState as RuntimeState).assignments,
      'assignmentId',
      assignmentId,
    );
    if (assignment?.assignmentKind !== 'verification' || assignment.state !== 'available') {
      throw new OperateClientError(
        'RESULT_CONTRACT_INVALID',
        'The terminal operation did not produce one available canonical verification Assignment.',
        false,
        { assignmentId },
      );
    }
    const correlationId = stableId('corr', `verification-claim:${assignmentId}`);
    const submissionId = stableId('sub', `verification:${assignmentId}`);
    let working: OperateStoredRuntime = {
      ...withReservation,
      state: nextState,
      events: [...runtime.events, ...events],
    };
    const claimed = await this.event(working, {
      type: 'assignment.claimed',
      entityId: assignmentId,
      cycleId: String(assignment.cycleId),
      correlationId,
      actor: { kind: 'runtime', id: 'openplanr' },
      payload: {
        assignmentId,
        actorId,
        actorKind: 'agent',
        runtime: 'openplanr',
        claimId: stableId('clm', `verification:${assignmentId}`),
        submissionId,
      },
    });
    const claimedState = composition.reduce(nextState, [claimed], runtime.artifacts);
    working = {
      ...working,
      state: claimedState,
      events: [...working.events, claimed],
    };
    const started = await this.event(working, {
      type: 'assignment.started',
      entityId: assignmentId,
      cycleId: String(assignment.cycleId),
      correlationId,
      actor: { kind: 'runtime', id: 'openplanr' },
      payload: { assignmentId, attempt: 1 },
    });
    const runningState = composition.reduce(claimedState, [started], runtime.artifacts);
    return {
      runtime: withReservation,
      state: runningState,
      events: [...events, claimed, started],
    };
  }

  private async executeAction(
    request: OperateToolRequestMapV2['operate.action.execute'],
  ): Promise<OperateApiEnvelopeV2> {
    const runtime = await this.requiredRuntime();
    const snapshot = state(runtime);
    const selected = exactAction(snapshot, request.action);
    if (request.actor.actorId !== selected.ownerActorId) {
      throw new OperateClientError(
        'CAPABILITY_DENIED',
        'Only the exact current Action owner may execute this contained Action.',
        false,
      );
    }
    const payload = artifactValue(runtime, String(selected.sourceArtifactId));
    const executionBinding = record(selected.executionBinding);
    const rollbackRequired = executionBinding.rollbackRequired === true;
    const baselineId = rollbackRequired
      ? (selected.preconditionArtifactIds as unknown[]).find(
          (artifactId) => artifactId !== selected.sourceArtifactId,
        )
      : null;
    if (rollbackRequired && typeof baselineId !== 'string') {
      throw new OperateClientError(
        'RESULT_CONTRACT_INVALID',
        'A reversible Action has no exact rollback-baseline Artifact.',
        false,
      );
    }
    const baseline = typeof baselineId === 'string' ? artifactValue(runtime, baselineId) : null;
    const executeRequest = {
      actionId: selected.actionId,
      payload: {
        artifactId: payload.artifact.artifactId,
        contentHash: sha256Jcs(payload.value as never),
        value: payload.value,
      },
      rollbackBaseline: baseline
        ? {
            artifactId: baseline.artifact.artifactId,
            contentHash: sha256Jcs(baseline.value as never),
            value: baseline.value,
          }
        : null,
    };
    const draft = governedDraft(selected, 'execute');
    let checkpoint = structuredClone(snapshot);
    const checkpointStore = {
      readSnapshot: () => structuredClone(checkpoint),
      compareAndSwap: ({ expectedEventHead, nextState }: JsonRecord) => {
        const expected = record(expectedEventHead);
        const current = record(checkpoint.eventHead);
        const committed = expected.sequence === current.sequence && expected.hash === current.hash;
        if (committed) checkpoint = structuredClone(nextState) as RuntimeState;
        return { committed, state: structuredClone(checkpoint) };
      },
    };
    const actionId = String(selected.actionId);
    const targetAdapter =
      this.containedTargets.get(actionId) ??
      createDisposableLocalProjectTargetV2({
        target: selected.targetBinding as never,
        initialValue: baseline?.value ?? null,
      });
    this.containedTargets.set(actionId, targetAdapter);
    const governed = createOperatingGovernedExecutionRuntimeV2({
      initialState: snapshot as never,
      checkpointStore: checkpointStore as never,
      artifactStore: governedArtifactStore(runtime) as never,
      runtimeActorId: 'openplanr',
    });
    const completed = await governed.execute(executeRequest as never, draft as never, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter,
    });
    let nextState = completed.state as unknown as JsonRecord;
    const events = [...completed.events] as unknown as JsonRecord[];
    if (rollbackRequired && baseline) {
      const plan = buildOperatingRollbackPlanV2({
        operation: completed.operation,
        result: completed.result,
        baseline: executeRequest.rollbackBaseline as never,
        expiresAt: later(String(draft.completedAt), 7 * 24 * 60 * 60_000),
      });
      const planned = recordOperatingRollbackPlanV2({
        state: completed.state,
        plan,
        eventId: stableId('evt', `rollback-plan:${completed.operation.operationId}`),
        runtimeActorId: 'openplanr',
      });
      nextState = planned.state as unknown as JsonRecord;
      events.push(planned.event as unknown as JsonRecord);
    }
    const composition = await this.composition();
    const verificationCreatedIndex = events.findIndex(
      (event) =>
        event.type === 'assignment.created' &&
        record(event.payload).assignmentKind === 'verification',
    );
    if (verificationCreatedIndex < 0) {
      throw new OperateClientError(
        'RESULT_CONTRACT_INVALID',
        'Terminal contained execution produced no verification Assignment.',
        false,
      );
    }
    // The governed runtime returns the complete terminal state, including the
    // newly-created verification Assignment. Scheduling that creation Event
    // against the terminal state replays an earlier Event at a later head.
    // Rebuild the exact pre-creation state, then let the scheduler consume the
    // untouched terminal suffix and append its owner-issued release Event.
    const preCreationEvents = events.slice(0, verificationCreatedIndex);
    const schedulingBase = composition.reduce(
      snapshot as unknown as JsonRecord,
      preCreationEvents,
      runtime.artifacts,
    );
    const schedulingEvents = events.slice(verificationCreatedIndex);
    const scheduled = composition.schedule(schedulingBase, schedulingEvents);
    nextState = scheduled.state;
    events.splice(
      verificationCreatedIndex,
      events.length - verificationCreatedIndex,
      ...(scheduled.events as unknown as JsonRecord[]),
    );
    const prepared = await this.prepareTerminalVerificationSubmission(
      runtime,
      nextState,
      events,
      String(record(events[verificationCreatedIndex].payload).assignmentId),
      request.actor.actorId,
    );
    const committed = await this.commit(prepared.runtime, prepared.state, prepared.events);
    return this.success('operate.action.execute', {
      generation: committed.generation,
      operationId: completed.operation.operationId,
      resultId: completed.result.resultId,
      replayed: completed.replayed,
      effectCount: completed.effectCount,
    });
  }

  private async rollbackAction(
    request: OperateToolRequestMapV2['operate.action.rollback'],
  ): Promise<OperateApiEnvelopeV2> {
    const runtime = await this.requiredRuntime();
    const snapshot = state(runtime);
    const selected = exactAction(snapshot, request.action);
    if (request.actor.actorId !== selected.ownerActorId) {
      throw new OperateClientError(
        'CAPABILITY_DENIED',
        'Only the exact current Action owner may roll back this contained Action.',
        false,
      );
    }
    const {
      operation: original,
      plan,
      binding,
    } = exactRollbackPlanContext(snapshot, selected, {
      originalOperationId: request.originalOperationId,
      rollbackPlanId: request.rollbackPlanId,
    });
    const payload = artifactValue(runtime, String(selected.sourceArtifactId));
    const baseline = artifactValue(runtime, String(plan.baselineArtifactId));
    const rollbackRequest = {
      actionId: selected.actionId,
      originalOperationId: original.operationId,
      rollbackPlanId: plan.rollbackPlanId,
      payload: {
        artifactId: payload.artifact.artifactId,
        contentHash: sha256Jcs(payload.value as never),
        value: payload.value,
      },
      rollbackBaseline: {
        artifactId: baseline.artifact.artifactId,
        contentHash: sha256Jcs(baseline.value as never),
        value: baseline.value,
      },
    };
    const preparedAt = timestamp();
    const draft = governedDraft(selected, 'rollback', preparedAt);
    const replaying = snapshot.governedOperations.some(
      (candidate) =>
        candidate.operationId === draft.operationId &&
        candidate.operationKind === 'rollback' &&
        candidate.parentOperationId === original.operationId &&
        candidate.rollbackPlanId === plan.rollbackPlanId,
    );
    const bindingHash = sha256Jcs({
      contract: 'openplanr-rollback-approval-v1',
      action: actionIdentity(selected),
      ...binding,
    });
    const template = exactRollbackApprovalTemplate(snapshot, selected, request.actor);
    const approval = exactRollbackApprovalRecord(
      snapshot,
      selected,
      request.actor,
      template,
      bindingHash,
      preparedAt,
    );
    if (
      !replaying &&
      (!approval || Date.parse(String(approval.expiresAt)) <= Date.parse(preparedAt))
    ) {
      throw new OperateClientError(
        'APPROVAL_INVALID',
        'Rollback requires one distinct fresh human approval bound to the exact current plan, parent result, and target precondition.',
        false,
      );
    }
    let checkpoint: JsonRecord = structuredClone(snapshot) as unknown as JsonRecord;
    const checkpointStore = {
      readSnapshot: () => structuredClone(checkpoint),
      compareAndSwap: ({ expectedEventHead, nextState }: JsonRecord) => {
        const expected = record(expectedEventHead);
        const current = record(checkpoint.eventHead);
        const committed = expected.sequence === current.sequence && expected.hash === current.hash;
        if (committed) checkpoint = structuredClone(record(nextState));
        return { committed, state: structuredClone(checkpoint) };
      },
    };
    const targetAdapter = replaying
      ? undefined
      : this.containedTargets.get(String(selected.actionId));
    if (!replaying && !targetAdapter) {
      throw new OperateClientError(
        'OPERATION_UNCERTAIN',
        'The exact process-local contained target receipt is unavailable after restart; blind rollback is forbidden and recovery inspection is required.',
        false,
        { actionId: String(selected.actionId), originalOperationId: String(original.operationId) },
      );
    }
    const governed = createOperatingGovernedRecoveryRuntimeV2({
      initialState: snapshot as never,
      checkpointStore: checkpointStore as never,
      artifactStore: governedArtifactStore(runtime) as never,
      runtimeActorId: 'openplanr',
    });
    const completed = await governed.rollback(rollbackRequest as never, draft as never, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter: targetAdapter as never,
    });
    if (completed.replayed) {
      return this.success('operate.action.rollback', {
        generation: runtime.generation,
        operationId: completed.operation.operationId,
        resultId: completed.result.rollbackResultId,
        replayed: true,
        effectCount: 0,
      });
    }
    const rollbackEvents = [...completed.events] as unknown as JsonRecord[];
    const composition = await this.composition();
    const verificationCreatedIndex = rollbackEvents.findIndex(
      (event) =>
        event.type === 'assignment.created' &&
        record(event.payload).assignmentKind === 'verification',
    );
    if (verificationCreatedIndex < 0) {
      throw new OperateClientError(
        'RESULT_CONTRACT_INVALID',
        'Terminal contained rollback produced no verification Assignment.',
        false,
      );
    }
    const scheduled = composition.schedule(completed.state as unknown as JsonRecord, [
      rollbackEvents[verificationCreatedIndex],
    ]);
    rollbackEvents.push(...(scheduled.releaseEvents as unknown as JsonRecord[]));
    const rollbackState = scheduled.state as unknown as JsonRecord;
    const prepared = await this.prepareTerminalVerificationSubmission(
      runtime,
      rollbackState,
      rollbackEvents,
      String(record(rollbackEvents[verificationCreatedIndex].payload).assignmentId),
      request.actor.actorId,
    );
    const committed = await this.commit(prepared.runtime, prepared.state, prepared.events);
    return this.success('operate.action.rollback', {
      generation: committed.generation,
      operationId: completed.operation.operationId,
      rollbackResultId: completed.result.rollbackResultId,
      replayed: completed.replayed,
      effectCount: completed.effectCount,
    });
  }

  private async inspectRecovery(): Promise<OperateApiEnvelopeV2> {
    const composition = await this.composition();
    return (await inspectOperateRecovery({
      store: this.store,
      composition,
    })) as OperateApiEnvelopeV2;
  }

  private async restore(generation: string): Promise<OperateApiEnvelopeV2> {
    const composition = await this.composition();
    return (await restoreOperateGeneration({
      store: this.store,
      composition,
      generation,
    })) as OperateApiEnvelopeV2;
  }

  private async clearStaleLock(): Promise<OperateApiEnvelopeV2> {
    return (await clearOperateStaleLock(this.store)) as OperateApiEnvelopeV2;
  }

  private async requiredRuntime(): Promise<OperateStoredRuntime> {
    const runtime = await this.load();
    if (!runtime) {
      throw new OperateClientError(
        'CYCLE_NOT_FOUND',
        'No durable Operate lifecycle exists.',
        false,
      );
    }
    return runtime;
  }

  private async runtimeAtEventHead(
    runtime: OperateStoredRuntime,
    expectedEventHead: OperateEventHeadV2,
  ): Promise<OperateStoredRuntime> {
    const expected = expectedEventHead;
    if (
      !Number.isSafeInteger(expected.sequence) ||
      expected.sequence < 0 ||
      (expected.sequence === 0
        ? expected.hash !== null
        : !/^sha256:[a-f0-9]{64}$/u.test(String(expected.hash)))
    ) {
      throw new OperateClientError(
        'RESULT_CONTRACT_INVALID',
        'The historical operating Event head is malformed.',
        false,
      );
    }
    const currentHead = state(runtime).eventHead;
    if (expected.sequence > currentHead.sequence) {
      throw new OperateClientError(
        'CONCURRENT_MODIFICATION',
        'The requested historical operating Event head is not committed.',
        false,
      );
    }
    if (expected.sequence === currentHead.sequence) {
      if (expected.hash !== currentHead.hash) {
        throw new OperateClientError(
          'CONCURRENT_MODIFICATION',
          'The requested historical operating Event head has divergent custody.',
          false,
        );
      }
      return runtime;
    }

    const baseHead = record(runtime.baseState.eventHead);
    const baseSequence = Number(baseHead.sequence);
    if (
      !Number.isSafeInteger(baseSequence) ||
      baseSequence < 0 ||
      (baseSequence === 0
        ? baseHead.hash !== null
        : !/^sha256:[a-f0-9]{64}$/u.test(String(baseHead.hash))) ||
      expected.sequence < baseSequence ||
      (expected.sequence === baseSequence && expected.hash !== baseHead.hash)
    ) {
      throw new OperateClientError(
        'CONTRACT_VERSION_UNSUPPORTED',
        'The requested historical operating Event head predates retained replay custody.',
        false,
      );
    }
    const retainedEvents = runtime.events.filter(
      (event) => Number(event.sequence) <= expected.sequence,
    );
    if (expected.sequence === baseSequence) {
      return {
        ...runtime,
        state: structuredClone(runtime.baseState),
        events: [],
      };
    }
    const replayEvents = runtime.events.filter((event) => {
      const sequence = Number(event.sequence);
      return sequence > baseSequence && sequence <= expected.sequence;
    });
    const terminal = replayEvents.at(-1);
    if (
      replayEvents.length !== expected.sequence - baseSequence ||
      Number(terminal?.sequence) !== expected.sequence ||
      terminal?.eventHash !== expected.hash
    ) {
      throw new OperateClientError(
        'OPERATE_STORE_CORRUPT',
        'The retained Event ledger cannot reconstruct the requested historical head.',
        false,
      );
    }
    const historicalState = (await this.composition()).replay(
      runtime.baseState,
      replayEvents,
      runtime.artifacts,
    );
    if (
      historicalState.eventHead.sequence !== expected.sequence ||
      historicalState.eventHead.hash !== expected.hash
    ) {
      throw new OperateClientError(
        'OPERATE_STORE_CORRUPT',
        'Historical replay did not reproduce the exact requested Event head.',
        false,
      );
    }
    return {
      ...runtime,
      state: historicalState,
      events: structuredClone(retainedEvents),
    };
  }

  private async commit(
    runtime: OperateStoredRuntime,
    nextState: JsonRecord,
    events: JsonRecord[],
  ): Promise<OperateStoredRuntime> {
    return await this.store.commit(
      {
        baseState: runtime.baseState,
        state: nextState,
        events: [...runtime.events, ...events],
        artifacts: runtime.artifacts,
        preferences: runtime.preferences,
      },
      runtime.generation,
    );
  }

  private success<Operation extends OperateToolNameV2>(
    operation: Operation,
    data: OperateToolResponseMapV2[Operation],
    allowedActions: unknown[] = [],
  ): OperateApiSuccessV2<Operation> {
    return { ok: true, operation, data, allowedActions };
  }

  private failure<Operation extends OperateToolNameV2>(
    operation: Operation,
    cause: unknown,
  ): OperateApiFailureV2<Operation> {
    const known = cause instanceof OperateClientError ? cause : null;
    const code = known?.code ?? errorCode(cause);
    return {
      ok: false,
      operation,
      error: {
        code,
        message:
          known?.message ??
          (cause instanceof Error
            ? cause.message
            : 'The requested operation could not be completed.'),
        retryable:
          known?.retryable ??
          Boolean((cause as { details?: { retryable?: unknown } })?.details?.retryable),
        context: known?.context ?? errorContext(cause),
      },
      allowedActions: code.startsWith('OPERATE_STORE_') ? [recoveryAction()] : [],
    };
  }
}

export function createOperateClient(projectDir: string): OperateClient {
  return new OperateClient(projectDir);
}
