import type {
  OperatingActionV2,
  OperatingActionVerificationPlanV2,
  OperatingAssignmentV2,
  OperatingCycleV2,
  OperatingDeltaV2,
  OperatingExecutionResultV2,
  OperatingGovernedOperationV2,
  OperatingLearningV2,
  OperatingOutcomeV2,
  OperatingRollbackResultV2,
  OperatingSnapshotV2,
} from '@openplanr/protocol';

export type OperatingExecutionVerificationStatusV2 =
  | 'success' | 'failure' | 'blocked' | 'uncertain' | 'partial' | 'cancelled' | 'rolled-back';
export type OperatingHypothesisVerificationStatusV2 =
  | 'pending' | 'confirmed' | 'failed' | 'blocked' | 'cancelled' | 'revisit';

export const OPERATING_EXECUTION_VERIFICATION_STATUSES_V2: readonly OperatingExecutionVerificationStatusV2[];
export const OPERATING_HYPOTHESIS_VERIFICATION_STATUSES_V2: readonly OperatingHypothesisVerificationStatusV2[];

export interface OperatingExecutionLifecycleIdentitiesV2 {
  readonly assignmentId: string;
  readonly eventIds: Readonly<{
    actionQueued: string;
    actionStarted: string;
    cycleExecuting: string;
    actionTerminal: string;
    verificationAssignmentCreated: string;
    cycleVerifying: string;
  }>;
}

export function deriveOperatingExecutionVerificationStatusV2(input?: {
  result?: OperatingExecutionResultV2 | null;
  rollbackResult?: OperatingRollbackResultV2 | null;
  cancelled?: boolean;
}): OperatingExecutionVerificationStatusV2;

export function deriveOperatingExecutionLifecycleIdentitiesV2(input: {
  operationId: string;
  resultId: string;
}): Readonly<OperatingExecutionLifecycleIdentitiesV2>;

export function buildOperatingTerminalVerificationAssignmentV2(input: {
  action: OperatingActionV2;
  cycle: OperatingCycleV2;
  operation: OperatingGovernedOperationV2;
  result: OperatingExecutionResultV2 | OperatingRollbackResultV2;
  verificationPlan: OperatingActionVerificationPlanV2;
  timestamp: string;
}): Readonly<OperatingAssignmentV2>;

export function selectOperatingTerminalVerificationAssignmentV2(input: {
  assignments: readonly OperatingAssignmentV2[];
  action: OperatingActionV2;
  cycle: OperatingCycleV2;
  operation: OperatingGovernedOperationV2;
  result: OperatingExecutionResultV2 | OperatingRollbackResultV2;
  verificationPlan: OperatingActionVerificationPlanV2;
  timestamp?: string;
}): Readonly<OperatingAssignmentV2>;

export interface OperatingActionLifecycleTransitionV2 {
  readonly action: Readonly<{ actionId: string; revision: number; actionHash: string }>;
  readonly from: OperatingActionV2['state'];
  readonly to: OperatingActionV2['state'];
  readonly operationId: string | null;
  readonly resultId: string | null;
  readonly reasonCode: string | null;
}

export interface OperatingCycleLifecycleTransitionV2 {
  readonly cycleId: string;
  readonly from: OperatingCycleV2['state'];
  readonly to: OperatingCycleV2['state'];
  readonly actionId: string | null;
  readonly operationId: string | null;
  readonly resultId: string | null;
  readonly reasonCode: string | null;
}

export function buildOperatingExecutionLifecycleV2(input: {
  action: OperatingActionV2;
  cycle: OperatingCycleV2;
  operation: OperatingGovernedOperationV2;
  result: OperatingExecutionResultV2;
  verificationPlan: OperatingActionVerificationPlanV2;
  timestamp?: string;
  recovery?: { priorResultId: string; reasonCode: string } | null;
}): Readonly<{
  executionStatus: OperatingExecutionVerificationStatusV2;
  hypothesisStatus: 'pending';
  identities: OperatingExecutionLifecycleIdentitiesV2;
  verificationAssignment: OperatingAssignmentV2;
  transitions: Readonly<{
    actionQueued: OperatingActionLifecycleTransitionV2;
    actionStarted: OperatingActionLifecycleTransitionV2;
    cycleExecuting: OperatingCycleLifecycleTransitionV2;
    actionTerminal: OperatingActionLifecycleTransitionV2;
    cycleVerifying: OperatingCycleLifecycleTransitionV2;
  }>;
}>;

export function buildOperatingRollbackVerificationV2(input: {
  action: OperatingActionV2;
  cycle: OperatingCycleV2;
  operation: OperatingGovernedOperationV2;
  result: OperatingRollbackResultV2;
  verificationPlan: OperatingActionVerificationPlanV2;
  timestamp?: string;
}): Readonly<{
  executionStatus: OperatingExecutionVerificationStatusV2;
  hypothesisStatus: 'revisit';
  identities: OperatingExecutionLifecycleIdentitiesV2;
  verificationAssignment: OperatingAssignmentV2;
}>;

export interface OperatingVerificationFeedbackV2 {
  readonly actionId: string;
  readonly verificationPlanId: string;
  readonly operationId: string | null;
  readonly resultId: string | null;
  readonly verificationAssignmentId: string | null;
  readonly executionStatus: OperatingExecutionVerificationStatusV2;
  readonly hypothesisStatus: OperatingHypothesisVerificationStatusV2;
  readonly executionCompleted: boolean;
  readonly hypothesisConfirmed: boolean;
  readonly revisit: boolean;
  readonly cycleClosed: boolean;
  readonly provenance: Readonly<{
    outcomeId: string | null;
    learningId: string | null;
    deltaId: string | null;
    snapshotId: string | null;
    sourceArtifactId: string;
    observationIds: readonly string[];
    evidenceRefIds: readonly string[];
  }>;
}

export function deriveOperatingVerificationFeedbackV2(input: {
  action: OperatingActionV2;
  verificationPlan: OperatingActionVerificationPlanV2;
  executionStatus: OperatingExecutionVerificationStatusV2;
  sourceCycle?: OperatingCycleV2 | null;
  operation?: OperatingGovernedOperationV2 | null;
  result?: OperatingExecutionResultV2 | OperatingRollbackResultV2 | null;
  verificationAssignments?: readonly OperatingAssignmentV2[] | null;
  outcome?: OperatingOutcomeV2 | null;
  learning?: OperatingLearningV2 | null;
  delta?: OperatingDeltaV2 | null;
  snapshot?: OperatingSnapshotV2 | null;
  cycle?: OperatingCycleV2 | null;
}): Readonly<OperatingVerificationFeedbackV2>;
