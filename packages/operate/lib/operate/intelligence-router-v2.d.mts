import type {
  OperateDomainRegistrationV2,
  OperatingAssignmentV2,
  OperatingDeltaV2,
  OperatingIntelligencePlanV2,
  OperatingSnapshotV2,
} from '@openplanr/protocol';

export interface OperatingIntelligenceBoardPlanV2 {
  readonly plan: OperatingIntelligencePlanV2;
  readonly assignments: readonly OperatingAssignmentV2[];
  readonly routingHash: string;
}

export function planOperatingIntelligenceBoardV2(input: {
  cycleId: string;
  delta: OperatingDeltaV2;
  snapshot: OperatingSnapshotV2;
  focus: readonly string[];
  domainDescriptor: OperateDomainRegistrationV2;
  decisionOwnerActorId: string;
  createdAt: string;
}): OperatingIntelligenceBoardPlanV2;

export function assertOperatingIntelligencePlanV2(
  plan: OperatingIntelligencePlanV2,
): OperatingIntelligencePlanV2;
