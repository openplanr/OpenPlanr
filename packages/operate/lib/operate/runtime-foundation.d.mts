import type {
  OperateErrorContextV2,
  OperateAllowedActionV2,
  OperateApiSuccessV2,
  OperateApiFailureV2,
  OperateErrorCodeV2,
  OperateToolNameV2,
  OperateToolRequestMapV2,
  OperatingArtifactV2,
  OperatingArtifactRepresentationV2,
  OperatingApprovalRecordV2,
  OperatingApprovalRequirementV2,
  OperatingActionV2,
  OperatingActionVerificationPlanV2,
  OperatingAssignmentStateV2,
  OperatingAssignmentV2,
  OperatingCycleV2,
  OperatingDecisionV2,
  OperatingDecisionLedgerV2,
  OperatingDeltaV2,
  OperatingEvidenceCandidateV2,
  OperatingEvidenceEdgeV2,
  OperatingEvidenceGraphV2,
  OperatingEvidenceRefV2,
  OperatingEvidenceResolutionV2,
  OperatingEventV2,
  OperatingExecutionResultV2,
  OperatingExecutionReceiptProofV2,
  OperatingGovernedOperationV2,
  OperatingCapabilityGrantV2,
  OperatingCapabilityAvailabilityV2,
  OperatingOperationReplayEntryV2,
  OperatingFindingV2,
  OperatingClaimV2,
  OperatingMetricObservationV2,
  OperatingMetricV2,
  OperatingModelStateV2,
  OperatingOutcomeV2,
  OperatingPolicyEvaluationV2,
  OperatingLearningV2,
  OperatingRiskV2,
  OperatingAssumptionV2,
  OperatingScenarioV2,
  OperatingEventTriggerV2,
  OperatingIntelligencePlanV2,
  OperatingIntelligenceInputBundleV2,
  OperatingAdvisorResultV2,
  OperatingChallengerReviewV2,
  OperateDomainRegistrationV2,
  OperatingReviewStateV2,
  OperatingReviewReadV2,
  OperatingReviewReceiptV2,
  OperatingReviewV2,
  OperatingRuntimeStateV2,
  OperatingSnapshotV2,
  OperatingSubmissionReplayEntryV2,
  OperatingSubmissionV2,
  OperatingWorkChangeSetV2,
  OperatingWorkDispositionV2,
  OperatingWorkLedgerV2,
  OperatingOriginV1,
  OperatingDeliveryEvidenceV1,
} from '@openplanr/protocol';
import type { OperatingCycleWorkViewV2 } from './persistent-work-projections-v2.d.mts';
import type { OperateEvidenceRegistryV2 } from './evidence-registry-v2.mjs';
import type { OperateStaticEvidenceResolverContextV2 } from './evidence-v2.mjs';
import type { OperatingArtifactByteStoreV2 } from './evidence-materialization-v2.mjs';
import type { OperateGovernedExtensionRegistryV2 } from './governed-extensions-v2.d.mts';
import type {
  OperatingModelStateCollectionsV2,
  OperatingModelStateScopeV2,
} from './operating-state-v2.d.mts';
import type {
  OperateAuthorityActorV2,
  OperateAuthorityContextV2,
  OperateAuthorityDecisionV2,
  OperateAuthorityOperationV2,
} from './authorization-v2.mjs';
import type { OperateReviewBoundSubmissionV1 } from './review-bound-submission-v2.mjs';

export {
  assertOperatingReviewBoundSubmissionV1,
  buildOperatingReviewBoundSubmissionV1,
  computeOperatingReviewBoundSubmissionHashV1,
  OPERATE_REVIEW_BOUND_SUBMISSION_DOMAIN,
} from './review-bound-submission-v2.mjs';
export type { OperateReviewBoundSubmissionV1 } from './review-bound-submission-v2.mjs';

export function deriveOperatingRoleLocalClaimIdV2(assignmentId: string, position?: number): string;
export function deriveOperatingChairLedgerIdV2(assignmentId: string): string;
export function assertOperatingRoleLocalClaimIdsV2(assignmentId: string, claimIds: string[]): readonly string[];

export {
  OPERATE_CORE_PROHIBITION_IDENTIFIERS_V2,
  OPERATE_POLICY_OUTCOME_STRENGTH_V2,
  OPERATE_POLICY_TIER_PRECEDENCE_V2,
  assertOperatingActionPolicyV2,
  assertOperatingPolicyEvaluationV2,
  assertOperatingRollbackPolicyV2,
  createOperatingActionPolicyV2,
  deriveApplicableOperatingActionPoliciesV2,
  deriveOperatingApprovalRequirementInstanceIdV2,
  evaluateOperatingActionPolicyV2,
} from './policy-v2.mjs';
export {
  appendOperatingApprovalRecordV2,
  assertOperatingApprovalRecordV2,
  assertOperatingApprovalRequirementIntegrityV2,
  assertOperatingApprovalRequirementSetIntegrityV2,
  assertOperatingApprovalRequirementV2,
  consumeOperatingApprovalRecordsV2,
  createOperatingActionReviewV2,
  createOperatingApprovalRecordV2,
  createOperatingApprovalRequirementV2,
  evaluateOperatingApprovalSetV2,
  evaluateOperatingRollbackApprovalSetV2,
  partitionSupersededOperatingAuthorityV2,
} from './approvals-v2.mjs';

export {
  derivePersistentOperatingExecutionVerificationProjectionV2,
  derivePersistentOperatingRecoveryProjectionV2,
} from './persistent-work-v2.mjs';

export {
  OPERATE_AUTHORITY_DECISION_VERSION_V2,
  OPERATE_AUTHORITY_TOOL_CAPABILITIES_V2,
  assertOperateAuthorityV2,
  assertOperatingActionAuthorityTupleV2,
  deriveOperateAuthorityAllowedActionsV2,
  evaluateOperateAuthorityV2,
  getOperateAuthorityArgumentCandidatesV2,
} from './authorization-v2.mjs';

export {
  OPERATING_MODEL_STATE_COLLECTIONS_V2,
  assertOperatingModelStateV2,
  buildOperatingModelStateV2,
  deriveOperatingModelStateRuntimeHashV2,
} from './operating-state-v2.mjs';
export {
  assertOperatingSnapshotV2,
  buildOperatingSnapshotStateTransactionV2,
  deriveOperatingSnapshotRuntimeHashV2,
} from './operating-snapshots-v2.mjs';
export {
  assertOperatingDeltaV2,
  classifyOperatingDeltaMaterialityV2,
  deriveOperatingDeltaV2,
} from './operating-delta-v2.mjs';
export {
  assertOperatingIntelligencePlanV2,
  planOperatingIntelligenceBoardV2,
} from './intelligence-router-v2.mjs';
export { buildOperatingIntelligenceStateTransitionV2 } from './operating-intelligence-state-v2.mjs';
export { buildOperatingTriggerScenarioTransitionV2 } from './operating-triggers-v2.mjs';
export {
  buildOperatingActionExecutionFeedbackV2,
  buildOperatingActionVerificationMaterializationV2,
  buildOperatingActionVerificationOutcomeV2,
} from './action-verification-v2.mjs';
export {
  OPERATING_EXECUTION_VERIFICATION_STATUSES_V2,
  OPERATING_HYPOTHESIS_VERIFICATION_STATUSES_V2,
  buildOperatingExecutionLifecycleV2,
  buildOperatingRollbackVerificationV2,
  buildOperatingTerminalVerificationAssignmentV2,
  deriveOperatingExecutionLifecycleIdentitiesV2,
  deriveOperatingExecutionVerificationStatusV2,
  deriveOperatingVerificationFeedbackV2,
  selectOperatingTerminalVerificationAssignmentV2,
} from './execution-verification-v2.mjs';
export {
  closeVerifiedOperatingCycleV2,
  deriveOperatingReviewWorkDispositionSetsV2,
} from './cycle-closure-v2.mjs';

export {
  createOperatingArtifactByteStoreV2,
  readOperatingArtifactRawBytesV2,
} from './evidence-materialization-v2.mjs';

export interface OperateGuardErrorV2 {
  code: OperateErrorCodeV2 | 'CONTRACT_VERSION_UNSUPPORTED';
  message: string;
  retryable: boolean;
  context: OperateErrorContextV2;
}

export type OperateGuardResultV2 =
  | Readonly<{ allowed: true; error: null }>
  | Readonly<{ allowed: false; error: Readonly<OperateGuardErrorV2> }>
  | OperateAuthorityDecisionV2;

export interface OperateRuntimeActorV2 {
  actorId: string;
  kind: 'agent' | 'human';
  runtime: string;
}

export interface OperateRuntimeGuardContextV2 extends Omit<OperateAuthorityContextV2, 'capabilities' | 'actor'> {
  capabilities?: Array<string | import('@openplanr/protocol').OperateVersionedIdentityV2>;
  cycle?: OperatingCycleV2;
  assignment?: OperatingAssignmentV2;
  review?: OperatingReviewV2;
  submission?: OperatingSubmissionV2;
  submissionReplay?: OperatingSubmissionReplayEntryV2;
  artifact?: OperatingArtifactV2;
  actor?: OperateRuntimeActorV2 | OperateAuthorityActorV2;
  representation?: 'raw' | 'canonical' | 'metadata' | 'decoded-json';
  startRequest?: OperateToolRequestMapV2['operate.cycle.start'];
  submitRequest?: OperateToolRequestMapV2['operate.assignment.submit'];
  reviewRequest?: OperateToolRequestMapV2['operate.review.submit'];
  reviewReadRequest?: OperateToolRequestMapV2['operate.review.get'];
}

export interface OperateGuardRowV2 {
  readonly operation: OperateToolNameV2;
  readonly label: string;
  readonly effect: 'read-only' | 'machine-local-write' | 'project-write';
  readonly guardId: string;
  readonly actorKinds: readonly ('agent' | 'human' | 'engine')[];
  readonly argumentCandidates: (context: OperateRuntimeGuardContextV2) => OperateToolRequestMapV2[OperateToolNameV2][];
  readonly guard: (context: OperateRuntimeGuardContextV2) => OperateGuardResultV2;
}

export const OPERATING_ASSIGNMENT_TRANSITIONS_V2: Readonly<
  Record<OperatingAssignmentStateV2, readonly OperatingAssignmentStateV2[]>
>;

export const OPERATING_REVIEW_TRANSITIONS_V2: Readonly<
  Record<OperatingReviewStateV2, readonly OperatingReviewStateV2[]>
>;

export const OPERATING_EXECUTION_EFFECT_SUMMARIES_V2: Readonly<{
  changed: string;
  unchanged: string;
  partial: string;
  failed: string;
  blocked: string;
  uncertain: string;
}>;

export function createOperatingExecutionReceiptProofV2(input: {
  operation: OperatingGovernedOperationV2;
  receipt: {
    operationId: string; requestFingerprint: string; target: { kind: string; id: string };
    before: { value: unknown; revision: string; stateHash: string };
    after: { value: unknown; revision: string; stateHash: string };
    changed: boolean; synthetic: boolean; effectCount: number;
  };
}): Readonly<OperatingExecutionReceiptProofV2>;

export function findOperatingExactActionOperationOwnerV2(
  operations: readonly OperatingGovernedOperationV2[],
  action: OperatingGovernedOperationV2['action'],
  options?: { excludeOperationId?: string | null },
): OperatingGovernedOperationV2 | null;

export function assertOperatingExecuteOperationV2(input: {
  operation: OperatingGovernedOperationV2;
  action: OperatingActionV2;
  assignment: OperatingAssignmentV2;
  evaluation: OperatingPolicyEvaluationV2;
  evaluations: readonly OperatingPolicyEvaluationV2[];
  configuredPolicies: readonly import('@openplanr/protocol').OperatingActionPolicyV2[];
  grant: OperatingCapabilityGrantV2;
  requirements?: readonly OperatingApprovalRequirementV2[];
  approvals?: readonly OperatingApprovalRecordV2[];
  capabilityAvailability: OperatingCapabilityAvailabilityV2;
  request: {
    payload: { artifactId: string; contentHash: string; value?: unknown };
    rollbackBaseline: { artifactId: string; contentHash: string; value?: unknown } | null;
  };
  timestamp: string;
  registry?: OperateGovernedExtensionRegistryV2;
}): OperatingGovernedOperationV2;

export function resolveOperatingLatestActionEvaluationV2(input: {
  evaluations: readonly OperatingPolicyEvaluationV2[];
  action: OperatingActionV2;
  configuredPolicies: readonly import('@openplanr/protocol').OperatingActionPolicyV2[];
  at: string;
}): OperatingPolicyEvaluationV2 | null;

export function assertOperatingExecutionResultSemanticsV2(input: {
  result: OperatingExecutionResultV2;
  operation: OperatingGovernedOperationV2;
  replayEntry: OperatingOperationReplayEntryV2;
  grant: OperatingCapabilityGrantV2;
  receiptProof?: OperatingExecutionReceiptProofV2 | null;
}): OperatingExecutionResultV2;

export const OPERATE_GUARD_TABLE_V2: Readonly<
  Record<OperateToolNameV2, Readonly<OperateGuardRowV2>>
>;

export function evaluateOperateGuardV2(
  operation: string,
  context?: OperateRuntimeGuardContextV2,
): OperateGuardResultV2;

export function assertOperateAuthorizedV2(
  operation: OperateAuthorityOperationV2,
  context?: OperateRuntimeGuardContextV2,
): OperateAuthorityDecisionV2 & { readonly allowed: true };

export function assertOperateAuthorizedV2(
  operation: Exclude<OperateToolNameV2, OperateAuthorityOperationV2>,
  context?: OperateRuntimeGuardContextV2,
): true;

export function deriveOperateAllowedActionsV2(
  context?: OperateRuntimeGuardContextV2,
): OperateAllowedActionV2[];

export function createOperateFailureEnvelopeV2(
  operation: OperateToolNameV2,
  context?: OperateRuntimeGuardContextV2,
): OperateApiFailureV2;

export interface OperatingArtifactScopeMembershipV2 {
  active: true;
  actorId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
}

export function readOperatingArtifactV2(
  request: OperateToolRequestMapV2['operate.artifact.get'],
  options?: {
    initialState?: OperatingRuntimeStateV2;
    artifactStore?: OperatingArtifactByteStoreV2;
    capabilities?: string[];
    scopeMembership?: OperatingArtifactScopeMembershipV2 | null;
  },
): OperateApiSuccessV2<'operate.artifact.get'> & { readonly data: OperatingArtifactRepresentationV2 };

export function readOperatingReviewV2(
  request: OperateToolRequestMapV2['operate.review.get'],
  options?: {
    initialState?: OperatingRuntimeStateV2;
    capabilities?: string[];
    readAt?: string;
  },
): OperateApiSuccessV2<'operate.review.get'> & { readonly data: OperatingReviewReadV2 };

export interface OperatingReviewSubmissionDraftV2 {
  eventId: string;
  timestamp: string;
  correlationId: string;
}

export interface OperatingReviewSubmissionResultV2 {
  readonly state: OperatingRuntimeStateV2;
  readonly response: OperateApiSuccessV2<'operate.review.submit'> & { readonly data: OperatingReviewReceiptV2 };
  readonly events: readonly Extract<OperatingEventV2, { type: 'review.submitted' }>[];
  readonly replayed: boolean;
}

export function submitOperatingReviewV2(
  request: OperateToolRequestMapV2['operate.review.submit'],
  draft: OperatingReviewSubmissionDraftV2,
  options?: {
    initialState?: OperatingRuntimeStateV2;
    capabilities?: string[];
    replayHook?: NoModelReplayHookV2;
  },
): OperatingReviewSubmissionResultV2;

export function submitBoundOperatingReviewV2(
  boundSubmission: OperateReviewBoundSubmissionV1,
  draft: OperatingReviewSubmissionDraftV2,
  options?: {
    initialState?: OperatingRuntimeStateV2;
    capabilities?: readonly Readonly<{ id: 'operate-review-submit'; version: '2.0.0' }>[];
    replayHook?: NoModelReplayHookV2;
  },
): OperatingReviewSubmissionResultV2;

export function readCommittedOperatingReviewReceiptV2(
  request: OperateToolRequestMapV2['operate.review.get'],
  options?: {
    initialState?: OperatingRuntimeStateV2;
    capabilities?: string[];
  },
): OperateApiSuccessV2<'operate.review.submit'> & { readonly data: OperatingReviewReceiptV2 };

export interface OperatingAssignmentClaimDraftV2 {
  claimId: string;
  submissionId: string;
  eventIds: { claimed: string; started: string };
  timestamp: string;
  correlationId: string;
}

export interface OperatingAssignmentClaimResultV2 {
  state: OperatingRuntimeStateV2;
  response: import('@openplanr/protocol').OperatingAssignmentClaimV2;
  events: readonly OperatingEventV2[];
  replayed: boolean;
}

export function claimOperatingAssignmentV2(
  request: OperateToolRequestMapV2['operate.assignment.claim'],
  draft: OperatingAssignmentClaimDraftV2,
  options?: {
    initialState?: OperatingRuntimeStateV2;
    capabilities?: string[];
    replayHook?: NoModelReplayHookV2;
  },
): OperatingAssignmentClaimResultV2;

export function transitionOperatingAssignmentV2(
  assignment: OperatingAssignmentV2,
  nextState: OperatingAssignmentStateV2,
  patch?: Partial<Pick<
    OperatingAssignmentV2,
    'availableAt' | 'inputArtifactIds' | 'inputAbsences' | 'claim' | 'attemptPolicy' | 'completedAt'
  >>,
): OperatingAssignmentV2;

export function transitionOperatingReviewV2(
  review: OperatingReviewV2,
  nextState: Exclude<OperatingReviewStateV2, 'pending'>,
  patch: Pick<OperatingReviewV2, 'updatedAt'> & { workDispositions?: OperatingWorkDispositionV2[] },
): OperatingReviewV2;

export function transitionOperatingActionLifecycleV2(
  action: OperatingActionV2,
  nextState: OperatingActionV2['state'],
  patch: { updatedAt: string },
): OperatingActionV2;

export function transitionOperatingCycleLifecycleV2(
  cycle: OperatingCycleV2,
  nextState: OperatingCycleV2['state'],
  patch: { updatedAt: string },
): OperatingCycleV2;

export function computeOperatingRuntimeEventHashV2(event: OperatingEventV2): string;

export function createOperatingRuntimeEventV2<TEvent extends OperatingEventV2['type']>(
  input: Omit<Extract<OperatingEventV2, { type: TEvent }>,
    'kind' | 'schemaVersion' | 'protocolVersion' | 'sequence' | 'previousEventHash' | 'eventHash'>,
  options?: {
    previousEvent?: Pick<OperatingEventV2, 'sequence' | 'eventHash'> | null;
    sequence?: number;
  },
): Extract<OperatingEventV2, { type: TEvent }>;

export function verifyOperatingRuntimeEventChainV2(
  events: OperatingEventV2[],
  options?: { startingSequence?: number; startingHash?: string | null; seenEventIds?: string[] },
): { sequence: number; hash: string | null };

export function createEmptyOperatingRuntimeStateV2(
  generatedAt?: string,
  authority?: {
    actionPolicies?: readonly import('@openplanr/protocol').OperatingActionPolicyV2[];
    approvalRequirements?: readonly import('@openplanr/protocol').OperatingApprovalRequirementV2[];
  },
): OperatingRuntimeStateV2;

/** Runtime-owned inputs for the three-event direct-submission transaction. */
export interface OperatingSubmissionAcceptanceDraftV2 {
  artifactId: string;
  artifactType: string;
  storageClass?: 'machine-local';
  sensitivity?: 'public' | 'internal' | 'confidential' | 'restricted';
  retentionClass?: string;
  inputArtifactIds: string[];
  timestamp: string;
  validatorVersion: string;
  eventIds: {
    submitted: string;
    artifactCreated: string;
    validated: string;
  };
  correlationId: string;
}

export interface OperatingSubmissionAcceptanceResultV2 {
  readonly state: OperatingRuntimeStateV2;
  readonly response: unknown;
  readonly artifact: OperatingArtifactV2;
  readonly events: readonly OperatingEventV2[];
  readonly stagedRawBytes: Uint8Array;
  readonly replayed: boolean;
}

/** Runtime-owned Event metadata for persistent-work materialization. */
export interface OperatingWorkMaterializationDraftV2 {
  eventId: string;
  timestamp: string;
  correlationId: string;
}

export interface OperatingWorkMaterializationResultV2 {
  readonly state: OperatingRuntimeStateV2;
  readonly events: readonly Extract<OperatingEventV2, { type: 'work-change-set.materialized' }>[];
  readonly findings: readonly OperatingFindingV2[];
  readonly decisions: readonly OperatingDecisionV2[];
  readonly actions: readonly OperatingActionV2[];
  readonly replayed: boolean;
}

export interface OperatingActionAuthorityPromotionInputV2 {
  actionKind: import('@openplanr/protocol').OperateVersionedIdentityV2;
  requestedCapability: import('@openplanr/protocol').OperateVersionedIdentityV2;
  targetBinding: import('@openplanr/protocol').OperateTargetBindingV2;
  effectClass: import('@openplanr/protocol').OperateGovernedEffectClassV2;
  preconditionArtifactIds: readonly string[];
  executionBinding: {
    policyId: string;
    policyVersion: string;
    rollbackRequired: boolean;
    verificationRequired: true;
  };
  updatedAt: string;
}

export interface OperatingActionAuthorityPromotionResultV2 {
  readonly state: OperatingRuntimeStateV2;
  readonly action: OperatingActionV2;
  readonly events: readonly Extract<OperatingEventV2, { type: 'action.authority-promoted' }>[];
  readonly replayed: boolean;
}

/** Runtime-owned identity and Event data for an atomic state/snapshot commit. */
export interface OperatingStateSnapshotMaterializationDraftV2 {
  snapshotId: string;
  stateId: string;
  timestamp: string;
  correlationId: string;
  eventIds: { snapshot: string; state: string };
}

/** Safe manifest accepted only by the internal state/snapshot materializer. */
export interface OperatingStateSnapshotMaterializationRequestV2 {
  cycleId: string;
  scope: OperatingModelStateScopeV2;
  domainContract: { apiDomainId: string; id: string; version: string };
  sourceArtifactIds: readonly string[];
  evidenceRefIds?: readonly string[];
  sourceRevisions?: readonly Array<{
    sourceArtifactId: string;
    revision: string;
    evidenceRefIds?: readonly string[];
  }>;
  collections: OperatingModelStateCollectionsV2;
}

export interface OperatingStateSnapshotMaterializationResultV2 {
  readonly state: OperatingRuntimeStateV2;
  readonly snapshot: OperatingSnapshotV2;
  readonly operatingState: OperatingModelStateV2;
  readonly events: readonly Extract<OperatingEventV2,
    { type: 'snapshot.materialized' | 'operating-state.materialized' }> [];
  readonly replayed: boolean;
}

/**
 * Runtime-only transaction. It validates byte custody and accepted
 * provenance before committing the immutable snapshot/state Event pair.
 */
export function materializeOperatingStateSnapshotV2(
  request: OperatingStateSnapshotMaterializationRequestV2,
  draft: OperatingStateSnapshotMaterializationDraftV2,
  options: {
    initialState?: OperatingRuntimeStateV2;
    artifactStore: OperatingArtifactByteStoreV2;
    replayHook?: NoModelReplayHookV2;
  },
): OperatingStateSnapshotMaterializationResultV2;

export const materializeOperatingSnapshotV2: typeof materializeOperatingStateSnapshotV2;

export interface OperatingRuntimeDeltaDraftV2 {
  deltaId: string;
  eventId: string;
  timestamp: string;
  correlationId: string;
}

export interface OperatingRuntimeDeltaResultV2 {
  readonly state: OperatingRuntimeStateV2;
  readonly delta: OperatingDeltaV2;
  readonly events: readonly Extract<OperatingEventV2, { type: 'delta.derived' }>[];
  readonly replayed: boolean;
  readonly materiality: Readonly<{ material: boolean; reason: 'material-change' | 'no-material-change' }>;
}

/** Derive a pure, evidence-backed Delta and append its one runtime Event. */
export function deriveOperatingRuntimeDeltaV2(
  request: { cycleId: string; snapshotId: string; stateId: string },
  draft: OperatingRuntimeDeltaDraftV2,
  options?: { initialState?: OperatingRuntimeStateV2; replayHook?: NoModelReplayHookV2 },
): OperatingRuntimeDeltaResultV2;

export interface OperatingRuntimeIntelligenceBoardDraftV2 {
  eventId: string;
  timestamp: string;
  correlationId: string;
}

export interface OperatingRuntimeIntelligenceBoardResultV2 {
  readonly state: OperatingRuntimeStateV2;
  readonly plan: OperatingIntelligencePlanV2;
  readonly assignments: readonly OperatingAssignmentV2[];
  readonly events: readonly OperatingEventV2[];
  readonly releaseEvents: readonly Extract<OperatingEventV2, { type: 'assignment.available' }>[];
  readonly replayed: boolean;
}

/** Persist one pure plan and let the scheduler release only dependency-ready analysis work. */
export function planOperatingRuntimeIntelligenceBoardV2(
  request: {
    cycleId: string;
    snapshotId: string;
    stateId: string;
    deltaId: string;
    focus: readonly string[];
    domainDescriptor: OperateDomainRegistrationV2;
    decisionOwnerActorId: string;
  },
  draft: OperatingRuntimeIntelligenceBoardDraftV2,
  options?: { initialState?: OperatingRuntimeStateV2; replayHook?: NoModelReplayHookV2 },
): OperatingRuntimeIntelligenceBoardResultV2;

export interface OperatingDecisionLedgerMaterializationDraftV2 {
  eventId: string;
  decisionEventIds: string[];
  timestamp: string;
  correlationId: string;
}

export interface OperatingDecisionLedgerMaterializationResultV2 {
  readonly state: OperatingRuntimeStateV2;
  readonly ledger: OperatingDecisionLedgerV2;
  readonly decisions: readonly OperatingDecisionV2[];
  readonly actionHypotheses: readonly Readonly<Record<string, unknown>>[];
  readonly events: readonly Extract<OperatingEventV2,
    { type: 'decision-ledger.materialized' | 'decision.revised' }> [];
  readonly replayed: boolean;
}

/**
 * Runtime-only validation and materialization of a challenged Chair ledger.
 * It produces Decision revisions and ledger-local Action hypotheses only.
 */
export function materializeOperatingDecisionLedgerV2(
  request: {
    cycleId: string;
    snapshotId: string;
    stateId: string;
    intelligencePlanId: string;
    advisorArtifactIds: string[];
    challengerArtifactId: string | null;
    chairArtifactId: string;
  },
  draft: OperatingDecisionLedgerMaterializationDraftV2,
  options: {
    initialState?: OperatingRuntimeStateV2;
    artifactStore: OperatingArtifactByteStoreV2;
    replayHook?: NoModelReplayHookV2;
  },
): OperatingDecisionLedgerMaterializationResultV2;

export interface OperatingActionVerificationMaterializationDraftV2 {
  eventIds: string[];
  timestamp: string;
  correlationId: string;
}

export interface OperatingActionVerificationMaterializationResultV2 {
  readonly state: OperatingRuntimeStateV2;
  readonly actions: readonly OperatingActionV2[];
  readonly verificationPlans: readonly OperatingActionVerificationPlanV2[];
  readonly events: readonly Extract<OperatingEventV2, { type: 'verification.plan-recorded' }>[];
  readonly replayed: boolean;
}

/** Materialize verified Actions only from an already byte-proven Chair ledger. */
export function materializeOperatingActionVerificationV2(
  request: { cycleId: string; snapshotId: string; stateId: string; ledgerId: string },
  draft: OperatingActionVerificationMaterializationDraftV2,
  options: {
    initialState?: OperatingRuntimeStateV2;
    artifactStore: OperatingArtifactByteStoreV2;
    replayHook?: NoModelReplayHookV2;
  },
): OperatingActionVerificationMaterializationResultV2;

/** Read-only reconstruction of the exact ungoverned Action owned by one verification-plan Event. */
export function reconstructOperatingVerificationPlanActionV2(input: {
  state: OperatingRuntimeStateV2;
  event: Extract<OperatingEventV2, { type: 'verification.plan-recorded' }>;
}): {
  readonly action: OperatingActionV2;
  readonly verificationPlan: OperatingActionVerificationPlanV2;
  readonly metric: OperatingMetricV2;
  readonly ledgerId: string;
  readonly snapshotId: string;
  readonly stateId: string;
  readonly decisionIds: readonly string[];
};

export function ingestOperatingPlanningDeliveryEvidenceV2(
  request: {
    origin: OperatingOriginV1;
    deliveryEvidence: OperatingDeliveryEvidenceV1;
    verificationPlanEvent: Extract<OperatingEventV2, { type: 'verification.plan-recorded' }>;
    expectedEventHead: OperatingRuntimeStateV2['eventHead'];
  },
  draft: { eventId: string; timestamp: string; correlationId: string },
  options: {
    initialState?: OperatingRuntimeStateV2;
    artifactStore: OperatingArtifactByteStoreV2;
    replayHook?: NoModelReplayHookV2;
  },
): Readonly<{
  state: OperatingRuntimeStateV2;
  events: readonly OperatingEventV2[];
  deliveryEvidence: OperatingDeliveryEvidenceV1;
  artifact: OperatingArtifactV2;
  evidenceRef: OperatingEvidenceRefV2;
  assignment: OperatingAssignmentV2;
  replayed: boolean;
}>;

export interface OperatingActionVerificationOutcomeDraftV2 {
  eventIds: { outcome: string; learning: string };
  timestamp: string;
  correlationId: string;
}

export interface OperatingActionVerificationOutcomeResultV2 {
  readonly state: OperatingRuntimeStateV2;
  readonly outcome: OperatingOutcomeV2;
  readonly learning: OperatingLearningV2;
  readonly events: readonly Extract<OperatingEventV2, { type: 'outcome.recorded' | 'learning.recorded' }> [];
  readonly replayed: boolean;
}

export interface OperatingTerminalVerificationInsufficientEvidenceRecordsV2 {
  readonly outcome: OperatingOutcomeV2;
  readonly learning: OperatingLearningV2;
}

/** Build a deterministic insufficient-evidence result without inferring effect success. */
export function buildOperatingTerminalVerificationInsufficientEvidenceV2(input: {
  action: OperatingActionV2;
  verificationPlan: OperatingActionVerificationPlanV2;
  assignment: OperatingAssignmentV2;
  sourceArtifactId: string;
  timestamp: string;
}): OperatingTerminalVerificationInsufficientEvidenceRecordsV2;

export interface OperatingTerminalVerificationInsufficientEvidenceResultV2
  extends OperatingTerminalVerificationInsufficientEvidenceRecordsV2 {
  readonly state: OperatingRuntimeStateV2;
  readonly events: readonly Extract<OperatingEventV2, { type: 'outcome.recorded' | 'learning.recorded' }>[];
  readonly replayed: boolean;
}

/** Record one accepted terminal verification Assignment as insufficient evidence only. */
export function recordOperatingTerminalVerificationInsufficientEvidenceV2(
  request: {
    cycleId: string;
    actionId: string;
    verificationPlanId: string;
    assignmentId: string;
    submissionId: string;
  },
  draft: OperatingActionVerificationOutcomeDraftV2,
  options: {
    initialState: OperatingRuntimeStateV2;
    artifactStore: OperatingArtifactByteStoreV2;
    replayHook?: NoModelReplayHookV2;
  },
): OperatingTerminalVerificationInsufficientEvidenceResultV2;

/** Record one accepted metric observation's outcome and bounded learning only. */
export function recordOperatingActionVerificationOutcomeV2(
  request: {
    cycleId: string;
    snapshotId: string;
    stateId: string;
    actionId: string;
    verificationPlanId: string;
    observationId: string;
    learning: { statement: string; assumptionIds?: string[]; decisionIds?: string[] };
  },
  draft: OperatingActionVerificationOutcomeDraftV2,
  options?: { initialState?: OperatingRuntimeStateV2; replayHook?: NoModelReplayHookV2 },
): OperatingActionVerificationOutcomeResultV2;

export interface OperatingVerifiedRuntimeCycleCloseResultV2 {
  readonly state: OperatingRuntimeStateV2;
  readonly feedback: import('./execution-verification-v2.d.mts').OperatingVerificationFeedbackV2 | null;
  readonly events: readonly Extract<OperatingEventV2, { type: 'cycle.closed' }>[];
  readonly replayed: boolean;
}

export function closeOperatingVerifiedRuntimeCycleV2(
  request: {
    cycleId: string;
    actionId: string;
    operationId: string;
    resultId: string;
    outcomeId: string;
    learningId: string;
    deltaId: string | null;
    snapshotId: string | null;
    carriedActionIds: string[];
  },
  draft: { eventId: string; timestamp: string; correlationId: string },
  options?: { initialState?: OperatingRuntimeStateV2; replayHook?: NoModelReplayHookV2 },
): OperatingVerifiedRuntimeCycleCloseResultV2;

export interface OperatingIntelligenceStateDraftV2 {
  timestamp: string;
  correlationId: string;
  eventIds: {
    claims: string[];
    metricObservations: string[];
    risks: string[];
    assumptions: string[];
    decisionRevisions: string[];
  };
}

export interface OperatingIntelligenceStateResultV2 {
  readonly state: OperatingRuntimeStateV2;
  readonly transition: import('./operating-intelligence-state-v2.d.mts').OperatingIntelligenceStateTransitionV2;
  readonly events: readonly Extract<OperatingEventV2,
    { type: 'claim.recorded' | 'metric.observed' | 'risk.recorded' | 'assumption.recorded' | 'decision.revised' }>[];
  readonly replayed: boolean;
}

/** Append only typed, evidence-backed operating facts; it never overwrites prior history. */
export function recordOperatingIntelligenceStateV2(
  request: {
    cycleId: string;
    snapshotId: string;
    stateId: string;
    claims: OperatingClaimV2[];
    metricObservations: OperatingMetricObservationV2[];
    risks: OperatingRiskV2[];
    assumptions: OperatingAssumptionV2[];
    decisionRevisions: OperatingDecisionV2[];
  },
  draft: OperatingIntelligenceStateDraftV2,
  options?: { initialState?: OperatingRuntimeStateV2; replayHook?: NoModelReplayHookV2 },
): OperatingIntelligenceStateResultV2;

export interface OperatingTriggerScenarioDraftV2 {
  timestamp: string;
  correlationId: string;
  eventIds: { scenarios: string[]; triggers: string[] };
}

export interface OperatingTriggerScenarioResultV2 {
  readonly state: OperatingRuntimeStateV2;
  readonly transition: import('./operating-triggers-v2.d.mts').OperatingTriggerScenarioTransitionV2;
  readonly events: readonly Extract<OperatingEventV2, { type: 'scenario.recorded' | 'trigger.recorded' }>[];
  readonly replayed: boolean;
}

/** Persist analytical scenarios and normal-work trigger requests without scheduling or effect authority. */
export function recordOperatingTriggerScenarioV2(
  request: { cycleId: string; snapshotId: string; stateId: string; scenarios: OperatingScenarioV2[]; triggers: OperatingEventTriggerV2[] },
  draft: OperatingTriggerScenarioDraftV2,
  options?: { initialState?: OperatingRuntimeStateV2; replayHook?: NoModelReplayHookV2 },
): OperatingTriggerScenarioResultV2;

/** Runtime-owned identity and event data for one evidence resolution. */
export interface OperatingEvidenceMaterializationDraftV2 {
  resolutionId: string;
  eventId: string;
  timestamp: string;
  correlationId: string;
  evidenceRefId?: string;
  evidenceArtifactId?: string;
}

/** A Phase 4 proof link is local to its source Artifact; it is not a Claim. */
export interface OperatingEvidenceClaimLinkProposalV2 {
  sourceArtifactId: string;
  localClaimId: string;
  relation: 'supportedBy' | 'contradictedBy';
  confidence: number;
}

export interface OperatingEvidenceMaterializationResultV2 {
  readonly state: OperatingRuntimeStateV2;
  readonly events: readonly Extract<OperatingEventV2, { type: 'evidence.resolved' | 'evidence.rejected' }>[];
  readonly resolution: OperatingEvidenceResolutionV2;
  readonly evidenceRef: OperatingEvidenceRefV2 | null;
  readonly evidenceArtifact: OperatingArtifactV2 | null;
  readonly edges: readonly OperatingEvidenceEdgeV2[];
  readonly replayed: boolean;
}

/**
 * Runtime-only materialization from an already validated Chair Artifact. It is
 * intentionally not part of the normal agent tool surface.
 */
export function materializeValidatedOperatingWorkV2(
  request: { artifactId: string; changeSet: OperatingWorkChangeSetV2 },
  draft: OperatingWorkMaterializationDraftV2,
  options?: {
    initialState?: OperatingRuntimeStateV2;
    replayHook?: NoModelReplayHookV2;
  },
): OperatingWorkMaterializationResultV2;

/** Append one exact engine-owned immutable Action authority promotion. */
export function promoteOperatingActionAuthorityV2(
  request: {
    action: OperatingActionV2;
    authority: OperatingActionAuthorityPromotionInputV2;
  },
  draft: OperatingWorkMaterializationDraftV2,
  options?: {
    initialState?: OperatingRuntimeStateV2;
    replayHook?: NoModelReplayHookV2;
  },
): OperatingActionAuthorityPromotionResultV2;

/**
 * Runtime-only resolution from an accepted v2 Artifact and its Cycle input
 * binding. It emits one resolution Event and never creates a durable Claim.
 */
export function materializeOperatingEvidenceV2(
  request: {
    candidate: OperatingEvidenceCandidateV2;
    claimLinks?: readonly OperatingEvidenceClaimLinkProposalV2[];
  },
  draft: OperatingEvidenceMaterializationDraftV2,
  options: {
    registry: OperateEvidenceRegistryV2;
    initialState?: OperatingRuntimeStateV2;
    artifactStore: OperatingArtifactByteStoreV2;
    liveEvidenceCustodyByArtifactId?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    resolverContext?: OperateStaticEvidenceResolverContextV2;
    replayHook?: NoModelReplayHookV2;
  },
): OperatingEvidenceMaterializationResultV2;

export function buildOperatingWorkLedgerV2(
  state: OperatingRuntimeStateV2,
  scope: Pick<OperatingCycleV2, 'scopeId' | 'domainId' | 'domainVersion'>,
  options?: { generatedAt?: string },
): OperatingWorkLedgerV2;

export function buildOperatingCycleWorkViewV2(
  state: OperatingRuntimeStateV2,
  cycleId: string,
  options?: { generatedAt?: string },
): OperatingCycleWorkViewV2;

export function buildOperatingEvidenceGraphV2(
  state: OperatingRuntimeStateV2,
  scope: Pick<OperatingCycleV2, 'scopeId' | 'domainId' | 'domainVersion'>,
  options?: { generatedAt?: string },
): OperatingEvidenceGraphV2;

/**
 * Builds and reduces the complete direct-submit transaction without mutating
 * the supplied state. The draft is runtime-owned; normal callers provide only
 * the public submit request and never paths, temporary keys, or idempotency IDs.
 */
export function acceptOperatingAssignmentSubmissionV2(
  request: OperateToolRequestMapV2['operate.assignment.submit'],
  draft: OperatingSubmissionAcceptanceDraftV2,
  options?: {
    initialState?: OperatingRuntimeStateV2;
    artifactStore?: OperatingArtifactByteStoreV2;
    replayHook?: NoModelReplayHookV2;
  },
): OperatingSubmissionAcceptanceResultV2;

export interface OperatingIntelligencePreflightIssueV2 {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly context: Readonly<Record<string, unknown>>;
}

export type OperatingIntelligenceResultV2 =
  | OperatingAdvisorResultV2
  | OperatingChallengerReviewV2
  | OperatingDecisionLedgerV2;

export type OperatingIntelligenceResultPreflightV2 = Readonly<
  | { valid: true; value: OperatingIntelligenceResultV2; issues: readonly [] }
  | { valid: false; value: null; issues: readonly OperatingIntelligencePreflightIssueV2[] }
>;

export function preflightOperatingIntelligenceResultV2(input: {
  value: unknown;
  assignment: OperatingAssignmentV2;
  plan: OperatingIntelligencePlanV2;
  snapshot: OperatingSnapshotV2;
  operatingState: OperatingModelStateV2;
  inputBundle: OperatingIntelligenceInputBundleV2;
  advisorOutputs?: readonly OperatingAdvisorResultV2[];
  challengerOutput?: OperatingChallengerReviewV2 | null;
}): OperatingIntelligenceResultPreflightV2;

export interface OperatingAssignmentResultPreflightV2 {
  readonly valid: boolean;
  readonly assignmentId: string;
  readonly schemaId: string;
  readonly issues: readonly OperatingIntelligencePreflightIssueV2[];
}

export function preflightOperatingAssignmentResultV2(
  request: { assignmentId: string; contentBytes: Uint8Array },
  options: {
    initialState?: OperatingRuntimeStateV2;
    artifactStore: OperatingArtifactByteStoreV2;
  },
): Readonly<OperatingAssignmentResultPreflightV2>;

export interface NoModelReplayHookV2 {
  readonly dispatchCount: number;
  dispatch(): never;
  assertUnused(): true;
}

export function createNoModelReplayHookV2(): Readonly<NoModelReplayHookV2>;

export function assertOperatingRollbackAuthorityChainV2(input: {
  state: OperatingRuntimeStateV2;
  operationId: string;
}): Readonly<{
  operation: OperatingGovernedOperationV2;
  action: OperatingActionV2;
  assignment: OperatingAssignmentV2;
  evaluation: OperatingPolicyEvaluationV2;
  grant: OperatingCapabilityGrantV2;
  availability: OperatingCapabilityAvailabilityV2;
  plan: import('@openplanr/protocol').OperatingRollbackPlanV2;
  parent: OperatingGovernedOperationV2;
  parentResult: OperatingExecutionResultV2;
  parentReplayEntry: OperatingOperationReplayEntryV2;
  result: import('@openplanr/protocol').OperatingRollbackResultV2 | null;
  artifact: OperatingArtifactV2 | null;
  replayEntry: OperatingOperationReplayEntryV2;
  intentOperation: OperatingGovernedOperationV2;
  intentAssignment: OperatingAssignmentV2;
  intentGrant: OperatingCapabilityGrantV2;
  intentReplayEntry: OperatingOperationReplayEntryV2;
}>;

export function assertOperatingExecuteDispatchAuthorityChainV2(input: {
  state: OperatingRuntimeStateV2;
  operationId: string;
}): Readonly<{
  operation: OperatingGovernedOperationV2;
  assignment: OperatingAssignmentV2;
  action: OperatingActionV2;
  grant: OperatingCapabilityGrantV2;
  availability: OperatingCapabilityAvailabilityV2;
  replayEntry: OperatingOperationReplayEntryV2;
  intentOperation: OperatingGovernedOperationV2;
  intentAssignment: OperatingAssignmentV2;
  intentGrant: OperatingCapabilityGrantV2;
  intentReplayEntry: OperatingOperationReplayEntryV2;
}>;

export interface OperatingSchedulerTransactionResultV2 {
  readonly state: OperatingRuntimeStateV2;
  readonly events: readonly OperatingEventV2[];
  readonly releaseEvents: readonly Extract<OperatingEventV2, { type: 'assignment.available' }>[];
}

export function scheduleOperatingRuntimeEventsV2(
  sourceEvents: OperatingEventV2[],
  options?: {
    initialState?: OperatingRuntimeStateV2;
    replayHook?: NoModelReplayHookV2;
  },
): OperatingSchedulerTransactionResultV2;

export function reduceOperatingRuntimeEventsV2(
  events: OperatingEventV2[],
  options?: {
    initialState?: OperatingRuntimeStateV2;
    artifactStore?: OperatingArtifactByteStoreV2;
    replayHook?: NoModelReplayHookV2;
  },
): OperatingRuntimeStateV2;
