import type {
  OperatingArtifactV2,
  OperatingEventV2,
  OperatingExecutionReceiptProofV2,
  OperatingGovernedOperationV2,
  OperatingRollbackPlanV2,
  OperatingRollbackResultV2,
  OperatingRuntimeStateV2,
} from '@openplanr/protocol';
import type { OperatingArtifactByteStoreV2 } from './evidence-materialization-v2.d.mts';
import type {
  OperatingGovernedExecutionCheckpointStoreV2,
  OperatingGovernedExecutionPayloadV2,
} from './governed-execution-v2.d.mts';
import type { OperateGovernedExtensionRegistryV2 } from './governed-extensions-v2.d.mts';
import type {
  ContainedEffectReceiptV2,
  ContainedTargetAdapterV2,
  ReferenceExecutorHostV2,
} from './reference-governed-executors-v2.d.mts';

export type OperatingGovernedRecoveryClassificationV2 =
  | 'applied'
  | 'not-applied'
  | 'partial'
  | 'unknown';

export interface OperatingReconciliationProofV2 {
  kind: 'operating-reconciliation-proof';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  operationId: string;
  requestFingerprint: string;
  executor: { executorId: string; executorVersion: string };
  classification: OperatingGovernedRecoveryClassificationV2;
  observedAt: string;
  source: 'deterministic-executor' | 'durable-history';
  receipt: OperatingExecutionReceiptProofV2 | null;
  reconciliationHash: string;
}

export interface OperatingGovernedRollbackRequestV2 {
  actionId: string;
  originalOperationId: string;
  rollbackPlanId: string;
  payload: OperatingGovernedExecutionPayloadV2;
  rollbackBaseline: OperatingGovernedExecutionPayloadV2;
}

export interface OperatingGovernedRollbackTerminalIdentityV2 {
  rollbackResultId: string;
  resultArtifactId: string;
  submissionId: string;
  eventIds: {
    submitted: string;
    artifactCreated: string;
    validated: string;
    resultRecorded: string;
  };
}

export interface OperatingGovernedRollbackDraftV2 {
  assignmentId: string;
  submissionId: string;
  operationId: string;
  grantId: string;
  rollbackResultId: string;
  resultArtifactId: string;
  claimId: string;
  preparedAt: string;
  completedAt: string;
  grantExpiresAt: string;
  availabilityExpiresAt: string;
  correlationId: string;
  eventIds: {
    assignmentCreated: string;
    assignmentClaimed: string;
    assignmentStarted: string;
    availabilityRecorded: string;
    capabilityGranted: string;
    intentRecorded: string;
    submitted: string;
    artifactCreated: string;
    validated: string;
    resultRecorded: string;
  };
  uncertainty: OperatingGovernedRollbackTerminalIdentityV2;
}

export interface OperatingGovernedRollbackResultEnvelopeV2 {
  readonly state: OperatingRuntimeStateV2;
  readonly operation: OperatingGovernedOperationV2;
  readonly result: OperatingRollbackResultV2;
  readonly artifact: OperatingArtifactV2;
  readonly events: readonly OperatingEventV2[];
  readonly receipt: ContainedEffectReceiptV2 | null;
  readonly replayed: boolean;
  readonly dispatchCount: 0 | 1;
  readonly effectCount: number;
}

export interface OperatingGovernedRecoveryRuntimeOptionsV2 {
  initialState: OperatingRuntimeStateV2;
  artifactStore?: OperatingArtifactByteStoreV2;
  checkpointStore: OperatingGovernedExecutionCheckpointStoreV2;
  runtimeVersion?: string;
  runtimeActorId?: string;
  registry?: OperateGovernedExtensionRegistryV2;
}

export function buildOperatingRollbackPlanV2(input: {
  operation: OperatingGovernedOperationV2;
  result: import('@openplanr/protocol').OperatingExecutionResultV2;
  baseline: OperatingGovernedExecutionPayloadV2;
  rollbackPlanId?: string;
  eligibility?: 'eligible' | 'required';
  expiresAt: string;
}): Readonly<OperatingRollbackPlanV2>;

export function recordOperatingRollbackPlanV2(input: {
  state: OperatingRuntimeStateV2;
  plan: OperatingRollbackPlanV2;
  eventId: string;
  runtimeActorId?: string;
}): Readonly<{
  state: OperatingRuntimeStateV2;
  plan: OperatingRollbackPlanV2;
  event: OperatingEventV2;
  replayed: false;
}>;

export function classifyOperatingGovernedRecoveryV2(input: {
  state: OperatingRuntimeStateV2;
  operationId: string;
  observedAt?: string;
}): Readonly<OperatingReconciliationProofV2>;

export function classifyOperatingRollbackReconciliationReceiptV2(input: {
  state: OperatingRuntimeStateV2;
  operationId: string;
  response: {
    status: string;
    receipt: ContainedEffectReceiptV2 | null;
  };
}): Readonly<{
  classification: OperatingGovernedRecoveryClassificationV2;
  receipt: OperatingExecutionReceiptProofV2 | null;
}>;

export function reconcileOperatingGovernedDispatchV2(input: {
  state: OperatingRuntimeStateV2;
  operationId: string;
  request: {
    payload: OperatingGovernedExecutionPayloadV2;
    rollbackBaseline: OperatingGovernedExecutionPayloadV2 | null;
  };
  trustedHost?: ReferenceExecutorHostV2;
  targetAdapter?: ContainedTargetAdapterV2;
  registry?: OperateGovernedExtensionRegistryV2;
  observedAt?: string;
}): Promise<Readonly<OperatingReconciliationProofV2>>;

export interface OperatingGovernedRecoveryRuntimeV2 {
  rollback(
    request: OperatingGovernedRollbackRequestV2,
    draft: OperatingGovernedRollbackDraftV2,
    environment: { trustedHost: ReferenceExecutorHostV2; targetAdapter: ContainedTargetAdapterV2 },
  ): Promise<Readonly<OperatingGovernedRollbackResultEnvelopeV2>>;
  reconcile(input: {
    operationId: string;
    request: {
      payload: OperatingGovernedExecutionPayloadV2;
      rollbackBaseline: OperatingGovernedExecutionPayloadV2 | null;
    };
    trustedHost?: ReferenceExecutorHostV2;
    targetAdapter?: ContainedTargetAdapterV2;
    observedAt?: string;
  }): Promise<Readonly<OperatingReconciliationProofV2>>;
  checkpoint(): OperatingRuntimeStateV2;
  getState(): OperatingRuntimeStateV2;
  readonly dispatchCount: number;
}

export function createOperatingGovernedRecoveryRuntimeV2(
  options: OperatingGovernedRecoveryRuntimeOptionsV2,
): Readonly<OperatingGovernedRecoveryRuntimeV2>;

export function rollbackOperatingGovernedActionV2(
  request: OperatingGovernedRollbackRequestV2,
  draft: OperatingGovernedRollbackDraftV2,
  options: OperatingGovernedRecoveryRuntimeOptionsV2 & {
    trustedHost: ReferenceExecutorHostV2;
    targetAdapter: ContainedTargetAdapterV2;
  },
): Promise<Readonly<OperatingGovernedRollbackResultEnvelopeV2>>;

export const OPERATING_GOVERNED_RECOVERY_CLASSIFICATIONS_V2: readonly [
  'applied',
  'not-applied',
  'partial',
  'unknown',
];
