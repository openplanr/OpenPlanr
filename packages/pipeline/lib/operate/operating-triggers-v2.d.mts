import type {
  OperatingArtifactV2,
  OperatingEvidenceRefV2,
  OperatingModelStateV2,
  OperatingScenarioV2,
  OperatingEventTriggerV2,
  OperatingSnapshotV2,
} from 'planr-pipeline/protocol';

export interface OperatingTriggerScenarioTransitionV2 {
  readonly snapshotId: string;
  readonly scopeId: string;
  readonly domainId: string;
  readonly domainVersion: string;
  readonly scenarios: readonly OperatingScenarioV2[];
  readonly triggers: readonly OperatingEventTriggerV2[];
  readonly transitionHash: string;
}

export function buildOperatingTriggerScenarioTransitionV2(input: {
  snapshot: OperatingSnapshotV2;
  operatingState: OperatingModelStateV2;
  evidenceRefs?: readonly OperatingEvidenceRefV2[];
  evidenceArtifacts?: readonly OperatingArtifactV2[];
  scenarios?: readonly OperatingScenarioV2[];
  triggers?: readonly OperatingEventTriggerV2[];
}): OperatingTriggerScenarioTransitionV2;
