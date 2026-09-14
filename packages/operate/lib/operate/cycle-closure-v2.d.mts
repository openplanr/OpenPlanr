import type {
  OperatingActionV2,
  OperatingCycleV2,
  OperatingDecisionV2,
  OperatingFindingV2,
  OperatingWorkDispositionV2,
} from '@openplanr/protocol';
import type { OperatingVerificationFeedbackV2 } from './execution-verification-v2.d.mts';

export interface OperatingCycleClosureResultV2 {
  readonly cycle: OperatingCycleV2;
  readonly findings: readonly OperatingFindingV2[];
  readonly decisions: readonly OperatingDecisionV2[];
  readonly actions: readonly OperatingActionV2[];
}

export interface OperatingReviewWorkDispositionSetV2 {
  readonly strategy: 'approve' | 'defer' | 'reject';
  readonly label: string;
  readonly workDispositions: readonly OperatingWorkDispositionV2[];
}

/** Derive only complete, transition-valid, target-bound approved Review choices. */
export function deriveOperatingReviewWorkDispositionSetsV2(options: {
  cycle: OperatingCycleV2;
  findings: readonly OperatingFindingV2[];
  decisions: readonly OperatingDecisionV2[];
  actions: readonly OperatingActionV2[];
  timestamp: string;
  reviewOwnerActorId?: string;
}): readonly OperatingReviewWorkDispositionSetV2[];

export function applyOperatingReviewWorkDispositionsV2(options: {
  cycle: OperatingCycleV2;
  findings: readonly OperatingFindingV2[];
  decisions: readonly OperatingDecisionV2[];
  actions: readonly OperatingActionV2[];
  workDispositions: readonly OperatingWorkDispositionV2[];
  timestamp: string;
  reviewOwnerActorId?: string;
}): Omit<OperatingCycleClosureResultV2, 'cycle'>;

/** The only normal successful Cycle-close transition is an approved human Review. */
export function closeCycleWithCarriedWorkV2(options: {
  cycle: OperatingCycleV2;
  findings: readonly OperatingFindingV2[];
  decisions: readonly OperatingDecisionV2[];
  actions: readonly OperatingActionV2[];
  workDispositions: readonly OperatingWorkDispositionV2[];
  timestamp: string;
  reviewOwnerActorId?: string;
}): OperatingCycleClosureResultV2;

export interface OperatingVerifiedCycleClosureResultV2 {
  readonly cycle: OperatingCycleV2;
  readonly actions: readonly OperatingActionV2[];
  readonly carriedActionIds: readonly string[];
  readonly verificationFeedback: readonly OperatingVerificationFeedbackV2[];
}

export function closeVerifiedOperatingCycleV2(options: {
  cycle: OperatingCycleV2;
  actions: readonly OperatingActionV2[];
  verificationPlans: readonly import('@openplanr/protocol').OperatingActionVerificationPlanV2[];
  governedOperations: readonly import('@openplanr/protocol').OperatingGovernedOperationV2[];
  executionResults: readonly import('@openplanr/protocol').OperatingExecutionResultV2[];
  rollbackResults: readonly import('@openplanr/protocol').OperatingRollbackResultV2[];
  verificationAssignments: readonly import('@openplanr/protocol').OperatingAssignmentV2[];
  verificationFeedback: readonly OperatingVerificationFeedbackV2[];
  carriedActionIds?: readonly string[];
  timestamp: string;
}): OperatingVerifiedCycleClosureResultV2;
