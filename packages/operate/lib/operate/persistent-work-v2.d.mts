import type {
  OperatingActionV2,
  OperatingArtifactV2,
  OperatingDecisionV2,
  OperatingFindingV2,
  OperatingWorkChangeSetV2,
} from '@openplanr/protocol';

export interface PersistentWorkMaterializationPayloadV2 {
  readonly artifactId: string;
  readonly canonicalHash: string;
  readonly changeSet: OperatingWorkChangeSetV2;
  readonly findings: readonly OperatingFindingV2[];
  readonly decisions: readonly OperatingDecisionV2[];
  readonly actions: readonly OperatingActionV2[];
}

export function buildPersistentWorkMaterializationPayloadV2(options: {
  artifact: OperatingArtifactV2;
  changeSet: OperatingWorkChangeSetV2;
  timestamp: string;
}): PersistentWorkMaterializationPayloadV2;

export function assertPersistentWorkMaterializationPayloadV2(
  payload: PersistentWorkMaterializationPayloadV2,
  options: {
    artifact: OperatingArtifactV2;
    changeSet: OperatingWorkChangeSetV2;
    timestamp: string;
  },
): PersistentWorkMaterializationPayloadV2;

export function assertPersistentOperatingActionAuthorityV2(
  action: import('@openplanr/protocol').OperatingActionV2,
): Readonly<import('@openplanr/protocol').OperatingActionV2>;

export function derivePersistentOperatingActionRevisionProjectionV2(
  action: OperatingActionV2,
): Omit<OperatingActionV2, 'actionHash' | 'revisionId' | 'state' | 'updatedAt'>;

export function derivePersistentOperatingActionRevisionHashV2(action: OperatingActionV2): string;

export function derivePersistentOperatingRecoveryProjectionV2(input: {
  operation: import('@openplanr/protocol').OperatingGovernedOperationV2;
  result?:
    | import('@openplanr/protocol').OperatingExecutionResultV2
    | import('@openplanr/protocol').OperatingRollbackResultV2
    | null;
  rollbackPlan?: import('@openplanr/protocol').OperatingRollbackPlanV2 | null;
}): Readonly<{
  operationId: string;
  operationKind: 'execute' | 'rollback';
  action: { actionId: string; revision: number; actionHash: string };
  state: string;
  resultId: string | null;
  rollbackPlanId: string | null;
  parentOperationId: string | null;
  verificationPlanId: string;
  targetBeforeHash: string | null;
  targetAfterHash: string | null;
  baselineArtifactId: string | null;
  baselineHash: string | null;
  projectionHash: string;
}>;

export function promotePersistentOperatingActionAuthorityV2(
  action: OperatingActionV2,
  input: {
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
  },
): Readonly<OperatingActionV2>;

export interface PersistentOperatingExecutionVerificationProjectionV2 {
  readonly actionId: string;
  readonly actionRevision: number;
  readonly actionHash: string;
  readonly sourceCycleId: string;
  readonly currentCycleId: string | null;
  readonly actionState: OperatingActionV2['state'];
  readonly operationId: string | null;
  readonly resultId: string | null;
  readonly verificationPlanId: string;
  readonly verificationAssignmentId: string | null;
  readonly executionStatus:
    | import('./execution-verification-v2.d.mts').OperatingExecutionVerificationStatusV2
    | null;
  readonly hypothesisStatus: import('./execution-verification-v2.d.mts').OperatingHypothesisVerificationStatusV2;
  readonly outcomeId: string | null;
  readonly learningId: string | null;
  readonly deltaId: string | null;
  readonly snapshotId: string | null;
  readonly carriedForward: boolean;
  readonly projectionHash: string;
}

export function derivePersistentOperatingExecutionVerificationProjectionV2(input: {
  action: OperatingActionV2;
  verificationPlan: import('@openplanr/protocol').OperatingActionVerificationPlanV2;
  operations?: readonly import('@openplanr/protocol').OperatingGovernedOperationV2[];
  executionResults?: readonly import('@openplanr/protocol').OperatingExecutionResultV2[];
  rollbackResults?: readonly import('@openplanr/protocol').OperatingRollbackResultV2[];
  verificationAssignments?: readonly import('@openplanr/protocol').OperatingAssignmentV2[];
  outcomes?: readonly import('@openplanr/protocol').OperatingOutcomeV2[];
  learnings?: readonly import('@openplanr/protocol').OperatingLearningV2[];
  deltas?: readonly import('@openplanr/protocol').OperatingDeltaV2[];
  snapshots?: readonly import('@openplanr/protocol').OperatingSnapshotV2[];
  sourceCycle?: import('@openplanr/protocol').OperatingCycleV2 | null;
  cycle?: import('@openplanr/protocol').OperatingCycleV2 | null;
}): Readonly<PersistentOperatingExecutionVerificationProjectionV2>;
