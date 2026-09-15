import type {
  OperatePolicyTierV2,
  OperateGovernedPolicyOutcomeV2,
  OperatingActionPolicyV2,
  OperatingActionV2,
  OperatingPolicyEvaluationV2,
  OperatingRollbackPlanV2,
} from '@openplanr/protocol';

export const OPERATE_POLICY_TIER_PRECEDENCE_V2: Readonly<Record<OperatePolicyTierV2, 100 | 200 | 300>>;
export const OPERATE_POLICY_OUTCOME_STRENGTH_V2: Readonly<Record<OperateGovernedPolicyOutcomeV2, number>>;
export const OPERATE_CORE_PROHIBITION_IDENTIFIERS_V2: readonly string[];
export function isOperatingRollbackEligibilityV2(value: unknown): value is 'eligible' | 'required';

export type OperatingActionPolicyInputV2 = Omit<OperatingActionPolicyV2,
  'kind' | 'schemaVersion' | 'protocolVersion' | 'precedence' | 'narrowingOnly' | 'policyHash'>;

export function createOperatingActionPolicyV2(input: OperatingActionPolicyInputV2): Readonly<OperatingActionPolicyV2>;
export function assertOperatingActionPolicyV2(policy: OperatingActionPolicyV2): Readonly<OperatingActionPolicyV2>;
export function deriveApplicableOperatingActionPoliciesV2(input: {
  action: OperatingActionV2;
  configuredPolicies: readonly OperatingActionPolicyV2[];
}): readonly Readonly<OperatingActionPolicyV2>[];
export function deriveOperatingApprovalRequirementInstanceIdV2(input: {
  policyRequirementId: string;
  evaluationId: string;
}): string;

export interface OperatingPolicyEvaluationInputV2 {
  action: OperatingActionV2;
  configuredPolicies: readonly OperatingActionPolicyV2[];
  evaluatedAt: string;
  evaluationId?: string;
  evaluatedBy?: { providerId: string; providerVersion: string };
}

export function evaluateOperatingActionPolicyV2(input: OperatingPolicyEvaluationInputV2): Readonly<OperatingPolicyEvaluationV2>;
export function assertOperatingPolicyEvaluationV2(
  evaluation: OperatingPolicyEvaluationV2,
  input: Omit<OperatingPolicyEvaluationInputV2, 'evaluatedAt' | 'evaluationId' | 'evaluatedBy'>,
): Readonly<OperatingPolicyEvaluationV2>;
export function assertOperatingRollbackPolicyV2(input: {
  action: OperatingActionV2; evaluation: OperatingPolicyEvaluationV2;
  rollbackPlan: OperatingRollbackPlanV2; at: string;
}): Readonly<{ action: { actionId: string; revision: number; actionHash: string }; evaluationId: string; rollbackPlanId: string }>;
