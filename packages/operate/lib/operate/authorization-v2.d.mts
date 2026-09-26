import type {
  OperateAllowedActionV2,
  OperateDomainRegistrationV2,
  OperateErrorV2,
  OperateGovernedEffectClassV2,
  OperateToolRequestMapV2,
  OperatingActionV2,
  OperatingActionPolicyV2,
  OperatingApprovalRecordV2,
  OperatingApprovalRequirementV2,
  OperatingCapabilityAvailabilityV2,
  OperatingCapabilityGrantV2,
  OperatingCycleV2,
  OperatingExecutionReceiptProofV2,
  OperatingGovernedOperationV2,
  OperatingPolicyEvaluationV2,
  OperatingReviewV2,
  OperatingRollbackPlanV2,
  OperateExecutorRegistrationV2,
  OperateVersionedIdentityV2,
  OperateTrustedExecutorBindingV2,
} from '@openplanr/protocol';
import type {
  OperateContainedExecutorInputV2,
  OperateGovernedExtensionRegistryV2,
} from './governed-extensions-v2.d.mts';

export type OperateAuthorityOperationV2 =
  | 'operate.review.submit'
  | 'operate.action.approve'
  | 'operate.action.execute'
  | 'operate.action.rollback';

export interface OperateAuthorityActorV2 {
  actorId: string;
  kind: 'agent' | 'human' | 'engine';
  runtime?: string;
  capabilities?: OperateVersionedIdentityV2[];
}

export interface OperateAuthorityScopeV2 {
  scopeId: string;
  domainId: string;
  domainVersion: string;
}

export interface OperateAuthorityContextV2 {
  actor?: OperateAuthorityActorV2;
  capabilities?: OperateVersionedIdentityV2[];
  actorCapabilities?: OperateVersionedIdentityV2[];
  now?: string;
  cycle?: OperatingCycleV2;
  review?: OperatingReviewV2;
  reviewRequest?: OperateToolRequestMapV2['operate.review.submit'];
  action?: OperatingActionV2;
  actionRequest?:
    | OperateToolRequestMapV2['operate.action.approve']
    | OperateToolRequestMapV2['operate.action.execute']
    | OperateToolRequestMapV2['operate.action.rollback'];
  request?: OperateToolRequestMapV2[OperateAuthorityOperationV2];
  scope?: OperateAuthorityScopeV2;
  target?: { kind: string; id: string; revision: string };
  domainRegistration?: OperateDomainRegistrationV2;
  dependencyActions?: OperatingActionV2[];
  actionPolicy?: OperatingActionPolicyV2;
  actionPolicies?: OperatingActionPolicyV2[];
  policyEvaluation?: OperatingPolicyEvaluationV2;
  approvalRequirements?: OperatingApprovalRequirementV2[];
  approvals?: OperatingApprovalRecordV2[];
  capabilityAvailability?: OperatingCapabilityAvailabilityV2;
  grant?: OperatingCapabilityGrantV2;
  operation?: OperatingGovernedOperationV2;
  operationHistory?: OperatingGovernedOperationV2[];
  currentPreconditionArtifactIds?: string[];
  executor?: OperateExecutorRegistrationV2;
  governedExtensions?: OperateGovernedExtensionRegistryV2;
  trustedExecutorBinding?: OperateTrustedExecutorBindingV2 | null;
  executorInput?: OperateContainedExecutorInputV2 | null;
  rollbackPlan?: OperatingRollbackPlanV2;
  reconciliationProof?: {
    kind: 'operating-reconciliation-proof';
    schemaVersion: '1.0.0';
    protocolVersion: '2.0.0';
    operationId: string;
    requestFingerprint: string;
    executor: { executorId: string; executorVersion: string };
    classification: 'applied' | 'not-applied' | 'partial' | 'unknown';
    observedAt: string;
    source: 'deterministic-executor' | 'durable-history';
    receipt: OperatingExecutionReceiptProofV2 | null;
    reconciliationHash: string;
  };
}

export interface OperateAuthorityDecisionBaseV2 {
  readonly kind: 'operate-authorization-decision';
  readonly decisionVersion: '2.0.0';
  readonly operation: OperateAuthorityOperationV2;
  readonly allowed: boolean;
  readonly replayed: boolean;
  readonly replayResultId: string | null;
  readonly actor: { kind: string | null; actorId: string | null } | null;
  readonly action: { actionId: string; revision: number; actionHash: string } | null;
  readonly scope: OperateAuthorityScopeV2 | null;
  readonly target: { kind: string; id: string; revision: string } | null;
  readonly effectClass: OperateGovernedEffectClassV2 | null;
  readonly evaluationId: string | null;
  readonly approvalIds: readonly string[];
  readonly grantId: string | null;
  readonly operationId: string | null;
  readonly checks: readonly string[];
  readonly decisionHash: string;
}

export type OperateAuthorityDecisionV2 =
  | (OperateAuthorityDecisionBaseV2 & {
      readonly allowed: true;
      readonly replayed: false;
      readonly replayResultId: null;
      readonly error: null;
    })
  | (OperateAuthorityDecisionBaseV2 & {
      readonly allowed: true;
      readonly replayed: true;
      readonly replayResultId: string;
      readonly error: null;
    })
  | (OperateAuthorityDecisionBaseV2 & {
      readonly allowed: false;
      readonly replayed: false;
      readonly replayResultId: null;
      readonly error: OperateErrorV2;
    });

export const OPERATE_AUTHORITY_TOOL_CAPABILITIES_V2: Readonly<
  Record<OperateAuthorityOperationV2, Readonly<OperateVersionedIdentityV2>>
>;

export const OPERATE_AUTHORITY_DECISION_VERSION_V2: '2.0.0';

export function evaluateOperateAuthorityV2(
  operation: OperateAuthorityOperationV2,
  context?: OperateAuthorityContextV2,
): OperateAuthorityDecisionV2;

export function assertOperateAuthorityV2(
  operation: OperateAuthorityOperationV2,
  context?: OperateAuthorityContextV2,
): OperateAuthorityDecisionV2 & { readonly allowed: true };

export function assertOperatingActionAuthorityTupleV2(
  action: OperatingActionV2,
): Readonly<OperatingActionV2>;

export function getOperateAuthorityArgumentCandidatesV2<T extends OperateAuthorityOperationV2>(
  operation: T,
  context?: OperateAuthorityContextV2,
): Array<OperateToolRequestMapV2[T]>;

export function deriveOperateAuthorityAllowedActionsV2(
  context?: OperateAuthorityContextV2,
): Array<OperateAllowedActionV2<OperateAuthorityOperationV2>>;
