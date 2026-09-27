import type {
  OperateDomainRegistrationV2,
  OperatingAssignmentV2,
  OperatingDeltaV2,
  OperatingIntelligencePlanV2,
  OperatingSnapshotV2,
} from '@openplanr/protocol';

export const OPERATING_INTELLIGENCE_NOT_SELECTED_ABSENCE: 'not-selected';
export const OPERATING_INTELLIGENCE_TYPED_TERMINAL_ABSENCE_CODES: readonly [
  'role-unavailable',
  'not-selected',
  'submission-rejected',
  'timeout',
  'policy-denied',
];
export type OperatingIntelligenceTypedTerminalAbsenceCodeV2 =
  (typeof OPERATING_INTELLIGENCE_TYPED_TERMINAL_ABSENCE_CODES)[number];

/** Throws a `RESULT_CONTRACT_INVALID` PipelineError unless `code` is a typed absence code. */
export function assertOperatingIntelligenceTypedTerminalAbsenceCode(
  code: unknown,
  subject?: string,
): asserts code is OperatingIntelligenceTypedTerminalAbsenceCodeV2;

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
