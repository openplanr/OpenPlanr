import type {
  OperatingAssumptionV2,
  OperatingArtifactV2,
  OperatingClaimV2,
  OperatingDecisionV2,
  OperatingDeltaV2,
  OperatingEvidenceRefV2,
  OperatingMetricObservationV2,
  OperatingModelStateV2,
  OperatingOutcomeV2,
  OperatingLearningV2,
  OperatingRiskV2,
  OperatingSnapshotV2,
} from '@openplanr/protocol';

export function classifyOperatingDeltaMaterialityV2(delta: OperatingDeltaV2): Readonly<{
  material: boolean;
  reason: 'material-change' | 'no-material-change';
}>;

export function assertOperatingDeltaV2(
  delta: OperatingDeltaV2,
  options?: { currentSnapshot?: OperatingSnapshotV2; priorSnapshot?: OperatingSnapshotV2 | null },
): OperatingDeltaV2;

export function deriveOperatingDeltaV2(input: {
  deltaId: string;
  currentSnapshot: OperatingSnapshotV2;
  currentState: OperatingModelStateV2;
  priorSnapshot?: OperatingSnapshotV2 | null;
  priorState?: OperatingModelStateV2 | null;
  evidenceRefs?: readonly OperatingEvidenceRefV2[];
  evidenceArtifacts?: readonly OperatingArtifactV2[];
  claims?: readonly OperatingClaimV2[];
  metricObservations?: readonly OperatingMetricObservationV2[];
  priorMetricObservations?: readonly OperatingMetricObservationV2[];
  risks?: readonly OperatingRiskV2[];
  assumptions?: readonly OperatingAssumptionV2[];
  decisions?: readonly OperatingDecisionV2[];
  outcomes?: readonly OperatingOutcomeV2[];
  learnings?: readonly OperatingLearningV2[];
  sourceArtifactId: string;
  derivedAt: string;
}): OperatingDeltaV2;
