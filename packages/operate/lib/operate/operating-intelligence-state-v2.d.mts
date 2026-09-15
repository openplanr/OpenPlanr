import type {
  OperatingActionV2,
  OperatingAssumptionV2,
  OperatingClaimV2,
  OperatingDecisionV2,
  OperatingArtifactV2,
  OperatingEvidenceRefV2,
  OperatingMetricObservationV2,
  OperatingModelStateV2,
  OperatingRiskV2,
  OperatingSnapshotV2,
} from '@openplanr/protocol';

export interface OperatingIntelligenceStateTransitionV2 {
  readonly snapshotId: string;
  readonly scopeId: string;
  readonly domainId: string;
  readonly domainVersion: string;
  readonly claims: readonly OperatingClaimV2[];
  readonly metricObservations: readonly OperatingMetricObservationV2[];
  readonly risks: readonly OperatingRiskV2[];
  readonly assumptions: readonly OperatingAssumptionV2[];
  readonly decisionRevisions: readonly OperatingDecisionV2[];
}

export function buildOperatingIntelligenceStateTransitionV2(input: {
  snapshot: OperatingSnapshotV2;
  operatingState: OperatingModelStateV2;
  evidenceRefs?: readonly OperatingEvidenceRefV2[];
  evidenceArtifacts?: readonly OperatingArtifactV2[];
  /** Accepted intelligence-result Artifacts that produced durable Claims or Risks. */
  sourceArtifacts?: readonly OperatingArtifactV2[];
  existingDecisions?: readonly OperatingDecisionV2[];
  existingActions?: readonly OperatingActionV2[];
  existingRisks?: readonly OperatingRiskV2[];
  existingAssumptions?: readonly OperatingAssumptionV2[];
  claims?: readonly OperatingClaimV2[];
  metricObservations?: readonly OperatingMetricObservationV2[];
  risks?: readonly OperatingRiskV2[];
  assumptions?: readonly OperatingAssumptionV2[];
  decisionRevisions?: readonly OperatingDecisionV2[];
}): OperatingIntelligenceStateTransitionV2;
