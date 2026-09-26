import type {
  OperatingActionV2,
  OperatingApprovalRecordV2,
  OperatingApprovalRequirementV2,
  OperatingPolicyEvaluationV2,
  OperatingReviewV2,
} from '@openplanr/protocol';

export function createOperatingApprovalRequirementV2(input: {
  policyRequirementId: string;
  evaluation: OperatingPolicyEvaluationV2;
  action: OperatingActionV2;
  parties: OperatingApprovalRequirementV2['parties'];
  threshold?: number;
  expiresAt?: string | null;
  consumable?: boolean;
}): Readonly<OperatingApprovalRequirementV2>;

export function assertOperatingApprovalRequirementV2(
  requirement: OperatingApprovalRequirementV2,
  input: { evaluation: OperatingPolicyEvaluationV2; action: OperatingActionV2 },
): Readonly<OperatingApprovalRequirementV2>;

export function assertOperatingApprovalRequirementIntegrityV2(
  requirement: OperatingApprovalRequirementV2,
): Readonly<OperatingApprovalRequirementV2>;

export function assertOperatingApprovalRequirementSetIntegrityV2(input: {
  requirements: readonly OperatingApprovalRequirementV2[];
  evaluationId?: string | null;
}): readonly Readonly<OperatingApprovalRequirementV2>[];

export function createOperatingApprovalRecordV2(input: {
  approvalId: string;
  requirement: OperatingApprovalRequirementV2;
  evaluation: OperatingPolicyEvaluationV2;
  action: OperatingActionV2;
  partyId: string;
  actor: OperatingApprovalRecordV2['actor'];
  decision: OperatingApprovalRecordV2['decision'];
  issuedAt: string;
  expiresAt?: string | null;
}): Readonly<OperatingApprovalRecordV2>;

export function assertOperatingApprovalRecordV2(
  record: OperatingApprovalRecordV2,
  input: { requirement: OperatingApprovalRequirementV2 },
): Readonly<OperatingApprovalRecordV2>;

export function appendOperatingApprovalRecordV2(input: {
  records?: readonly OperatingApprovalRecordV2[];
  record: OperatingApprovalRecordV2;
  requirement: OperatingApprovalRequirementV2;
  requirements?: readonly OperatingApprovalRequirementV2[];
}): Readonly<{
  records: readonly OperatingApprovalRecordV2[];
  record: OperatingApprovalRecordV2;
  replayed: boolean;
}>;

export interface OperatingApprovalSetResultV2 {
  readonly complete: boolean;
  readonly disposition: 'approved' | 'rejected' | 'deferred' | null;
  readonly approvalIds: readonly string[];
  readonly requirementIds: readonly string[];
  readonly reasonCode: string;
}

export function evaluateOperatingApprovalSetV2(input: {
  evaluation: OperatingPolicyEvaluationV2;
  action: OperatingActionV2;
  requirements?: readonly OperatingApprovalRequirementV2[];
  approvals?: readonly OperatingApprovalRecordV2[];
  now: string;
}): OperatingApprovalSetResultV2;
export function evaluateOperatingRollbackApprovalSetV2(
  input: Parameters<typeof evaluateOperatingApprovalSetV2>[0],
): OperatingApprovalSetResultV2;

export function consumeOperatingApprovalRecordsV2(input: {
  approvals: readonly OperatingApprovalRecordV2[];
  requirements: readonly OperatingApprovalRequirementV2[];
  approvalIds: readonly string[];
  operationId: string;
}): Readonly<{
  records: readonly OperatingApprovalRecordV2[];
  consumedApprovalIds: readonly string[];
  history: readonly OperatingApprovalRecordV2[];
}>;

export function partitionSupersededOperatingAuthorityV2(input: {
  evaluation: OperatingPolicyEvaluationV2;
  requirements?: readonly OperatingApprovalRequirementV2[];
  approvals?: readonly OperatingApprovalRecordV2[];
  currentEvaluationId: string;
}): Readonly<{
  activeEvaluation: OperatingPolicyEvaluationV2 | null;
  activeRequirements: readonly OperatingApprovalRequirementV2[];
  activeApprovals: readonly OperatingApprovalRecordV2[];
  supersededEvaluations: readonly OperatingPolicyEvaluationV2[];
  supersededRequirements: readonly OperatingApprovalRequirementV2[];
  supersededApprovals: readonly OperatingApprovalRecordV2[];
}>;

export function createOperatingActionReviewV2(input: {
  reviewId: string;
  action: OperatingActionV2;
  ownerActorId: string;
  timestamp: string;
}): Readonly<OperatingReviewV2>;
