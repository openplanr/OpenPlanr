import type {
  OperateAuthorityContextV2,
  OperateAuthorityDecisionV2,
} from './authorization-v2.d.mts';
import type {
  OperateCapabilityProviderRegistrationV2,
  OperateExecutorRegistrationV2,
  OperatePolicyProviderRegistrationV2,
  OperateTrustedExecutorBindingV2,
  OperatingActionV2,
  OperatingActionPolicyV2,
  OperatingCapabilityAvailabilityV2,
  OperatingPolicyEvaluationV2,
  OperatingRollbackPlanV2,
  OperateTargetBindingV2,
} from '@openplanr/protocol';
import type {
  OperateContainedExecutorInputV2,
  OperateGovernedExtensionRegistryV2,
  OperateTrustedExecutorHostV2,
} from './governed-extensions-v2.d.mts';

export interface ContainedTargetSnapshotV2 {
  value: unknown;
  revision: string;
  stateHash: string;
}
export interface ContainedEffectReceiptV2 {
  operationId: string;
  requestFingerprint: string;
  target: { kind: string; id: string };
  before: ContainedTargetSnapshotV2;
  after: ContainedTargetSnapshotV2;
  changed: boolean;
  synthetic: boolean;
  effectCount: number;
}
export interface ContainedTargetAdapterV2 {
  describe(): Readonly<{
    target: OperateTargetBindingV2;
    stateHash: string;
    effectCount: number;
    restoreCallCount: number;
  }>;
  read(): Readonly<ContainedTargetSnapshotV2>;
  reconcile(input: { operationId: string; requestFingerprint: string }): Readonly<{
    status: 'succeeded' | 'not-found';
    receipt: ContainedEffectReceiptV2 | null;
  }>;
}
export interface ReferenceExecutorInvocationV2 {
  authorityContext: OperateAuthorityContextV2;
  authorityDecision: Extract<OperateAuthorityDecisionV2, { allowed: true; replayed: false }>;
  binding: OperateTrustedExecutorBindingV2;
  executor: OperateExecutorRegistrationV2;
  targetAdapter: ContainedTargetAdapterV2;
  executorInput: OperateContainedExecutorInputV2;
}
export interface ReferenceExecutorReconcileInvocationV2 {
  binding: OperateTrustedExecutorBindingV2;
  executor: OperateExecutorRegistrationV2;
  executorInput: OperateContainedExecutorInputV2;
  rollbackPlan: OperatingRollbackPlanV2 | null;
  targetAdapter: ContainedTargetAdapterV2;
}
export interface ReferenceExecutorHostV2
  extends Omit<OperateTrustedExecutorHostV2, 'inspect' | 'execute' | 'rollback' | 'reconcile'> {
  inspect(input: {
    targetAdapter: ContainedTargetAdapterV2;
    target: OperateTargetBindingV2;
  }): Readonly<ContainedTargetSnapshotV2>;
  execute(input: ReferenceExecutorInvocationV2): Readonly<ContainedEffectReceiptV2>;
  rollback(input: ReferenceExecutorInvocationV2): Readonly<ContainedEffectReceiptV2>;
  reconcile(input: ReferenceExecutorReconcileInvocationV2): Readonly<{
    status: 'succeeded' | 'not-found' | 'unknown';
    receipt: ContainedEffectReceiptV2 | null;
  }>;
}

export function createOpenReferenceCapabilityAvailabilityV2(input: {
  action: OperatingActionV2;
  providerId?: string;
  providerVersion?: string;
  runtimeVersion: string;
  checkedAt: string;
  expiresAt: string;
  registry?: OperateGovernedExtensionRegistryV2;
}): Readonly<OperatingCapabilityAvailabilityV2>;
export function evaluateOpenReferencePolicyProviderV2(input: {
  action: OperatingActionV2;
  configuredPolicies: readonly OperatingActionPolicyV2[];
  evaluatedAt: string;
  evaluationId?: string;
  providerId?: string;
  providerVersion?: string;
  runtimeVersion: string;
  registry?: OperateGovernedExtensionRegistryV2;
}): Readonly<OperatingPolicyEvaluationV2>;
export function createDisposableLocalProjectTargetV2(input: {
  target: OperateTargetBindingV2;
  initialValue?: unknown;
}): ContainedTargetAdapterV2;
export function createSyntheticNoNetworkTargetV2(input: {
  target: OperateTargetBindingV2;
  initialValue?: unknown;
}): ContainedTargetAdapterV2;
export const OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2: ReferenceExecutorHostV2;
export const OPEN_REFERENCE_CONTAINMENT_EXECUTOR_HOST_V2: ReferenceExecutorHostV2;
export function resolveOpenReferenceExecutorHostV2(host: unknown): Readonly<{
  executorId: string;
  executorVersion: string;
  implementationId: string;
  connector: { id: string; version: string };
  synthetic: boolean;
}> | null;
export function findOpenReferenceExecutorHostDeclarationV2(input: {
  executorId: string;
  executorVersion: string;
  implementationId: string;
}): Readonly<{
  executorId: string;
  executorVersion: string;
  implementationId: string;
  connector: { id: string; version: string };
  synthetic: boolean;
}> | null;
