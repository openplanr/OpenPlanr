/** Request, response and envelope contracts of the Operate client tool surface. */
import type {
  OperatingAssignmentClaimV2,
  OperatingSubmissionAcceptanceV2,
} from 'planr-pipeline/protocol';
import type { OperateErrorCodeV2 } from './client-error.js';
import type { JsonRecord } from './composition.js';
import type { MeasurementSchedule } from './measurement-schedule-service.js';

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

export type ClaimRequest = { assignmentId: string; actor: OperateActorV2 };
export type SubmitRequest = {
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
export type ReviewRequest = {
  reviewId: string;
  cycleId: string;
  actor: OperateActorV2 & { kind: 'human' };
  scope: { scopeId: string; domainId: string; domainVersion: string };
};
export type ReviewSubmitRequest = ReviewRequest & {
  disposition: 'approved' | 'changes_requested' | 'rejected' | 'cancelled';
  workDispositions: JsonRecord[];
};
export type ArtifactRequest = {
  artifactId: string;
  representation: 'raw' | 'canonical' | 'metadata' | 'decoded-json';
  actor: OperateActorV2;
  scope: { scopeId: string; domainId: string; domainVersion: string };
  assignmentId: string | null;
};
export type ExperienceRequest = {
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

export type OperateEventHeadV2 = Readonly<{ sequence: number; hash: string | null }>;
