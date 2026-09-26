import type {
  OperatingActionV2,
  OperatingActionVerificationPlanV2,
  OperatingDecisionLedgerV2,
  OperatingDecisionV2,
  OperatingFindingV2,
  OperatingLearningV2,
  OperatingMetricObservationV2,
  OperatingModelStateV2,
  OperatingOutcomeV2,
  OperatingSnapshotV2,
} from '@openplanr/protocol';

export interface OperatingActionVerificationMaterializationV2 {
  readonly ledgerId: string;
  readonly sourceArtifactId: string;
  readonly actions: readonly OperatingActionV2[];
  readonly verificationPlans: readonly OperatingActionVerificationPlanV2[];
}

export function buildOperatingActionVerificationMaterializationV2(input: {
  snapshot: OperatingSnapshotV2;
  operatingState: OperatingModelStateV2;
  ledger: OperatingDecisionLedgerV2;
  decisions: readonly OperatingDecisionV2[];
  findings: readonly OperatingFindingV2[];
  timestamp: string;
}): OperatingActionVerificationMaterializationV2;

export function buildOperatingActionVerificationOutcomeV2(input: {
  action: OperatingActionV2;
  verificationPlan: OperatingActionVerificationPlanV2;
  observation: OperatingMetricObservationV2;
  learning: {
    statement: string;
    assumptionIds?: readonly string[];
    decisionIds?: readonly string[];
  };
  timestamp: string;
  sourceDecision: OperatingDecisionV2;
}): { readonly outcome: OperatingOutcomeV2; readonly learning: OperatingLearningV2 };

export function buildOperatingActionExecutionFeedbackV2(input: {
  action: OperatingActionV2;
  verificationPlan: OperatingActionVerificationPlanV2;
  executionStatus: import('./execution-verification-v2.d.mts').OperatingExecutionVerificationStatusV2;
  outcome?: OperatingOutcomeV2 | null;
  learning?: OperatingLearningV2 | null;
  delta?: import('@openplanr/protocol').OperatingDeltaV2 | null;
  snapshot?: OperatingSnapshotV2 | null;
  cycle?: import('@openplanr/protocol').OperatingCycleV2 | null;
}): Readonly<import('./execution-verification-v2.d.mts').OperatingVerificationFeedbackV2>;
