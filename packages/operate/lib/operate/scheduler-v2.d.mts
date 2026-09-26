import type {
  OperatingArtifactV2,
  OperatingAssignmentInputAbsenceV2,
  OperatingAssignmentV2,
  OperatingCycleV2,
  OperatingIntelligencePlanV2,
  OperatingSnapshotV2,
  OperatingSubmissionReplayEntryV2,
  OperatingSubmissionV2,
} from '@openplanr/protocol';

export interface OperatingDependencyValidatedProofV2 {
  assignmentId: string;
  outcome: 'validated';
  eventId: string;
  artifactId: string;
}

export interface OperatingDependencyAbsenceProofV2 {
  assignmentId: string;
  outcome: 'abandoned' | 'failed';
  eventId: string;
  absence: { code: string; reason: string; recoveryDisposition: string };
}

export type OperatingDependencyProofV2 =
  | OperatingDependencyValidatedProofV2
  | OperatingDependencyAbsenceProofV2;

export interface OperatingAssignmentReleaseIntentV2 {
  assignmentId: string;
  cycleId: string;
  releaseId: string;
  dependencyProofs: readonly OperatingDependencyProofV2[];
  dependencyEventIds: readonly string[];
}

export interface OperatingAssignmentTerminalIntentV2 {
  assignmentId: string;
  cycleId: string;
  terminalId: string;
  dependencyProofs: readonly OperatingDependencyProofV2[];
  dependencyEventIds: readonly string[];
  payload: {
    assignmentId: string;
    errorCode: 'role-unavailable';
    reason: string;
    recoveryStatus: 'continue-partial';
  };
}

export class OperatingSchedulerErrorV2 extends Error {
  readonly code: 'STATE_TRANSITION_INVALID';
  readonly details: Readonly<Record<string, unknown>>;
}

export function deriveOperatingIntelligenceAssignmentIdV2(
  planId: string,
  roleId: string,
  roleVersion?: string,
): string;

export function assertOperatingValidatedDependencyProofV2(input: {
  assignment: OperatingAssignmentV2;
  submission: OperatingSubmissionV2;
  artifact: OperatingArtifactV2;
  replay: OperatingSubmissionReplayEntryV2;
}): OperatingDependencyValidatedProofV2;

export function resolveOperatingAssignmentInputArtifactIdsV2(
  assignment: OperatingAssignmentV2,
  dependencyProofs?: readonly OperatingDependencyProofV2[],
): readonly string[];

export function resolveOperatingAssignmentInputAbsencesV2(
  assignment: OperatingAssignmentV2,
  input?: {
    dependencyProofs?: readonly OperatingDependencyProofV2[];
    assignments?: OperatingAssignmentV2[];
    intelligencePlans?: OperatingIntelligencePlanV2[];
  },
): readonly OperatingAssignmentInputAbsenceV2[];

export function validateOperatingAssignmentGraphV2(
  assignments: OperatingAssignmentV2[],
): ReadonlyMap<string, OperatingAssignmentV2>;

export function validateOperatingIntelligenceAssignmentGraphV2(
  plan: OperatingIntelligencePlanV2,
  assignments: OperatingAssignmentV2[],
  options?: {
    allowLifecycleProgress?: boolean;
    canonicalContext?: { cycle: OperatingCycleV2; snapshot: OperatingSnapshotV2 } | null;
  },
): ReadonlyMap<string, OperatingAssignmentV2>;

export function deriveOperatingAssignmentTerminalIntentsV2(input: {
  assignments: OperatingAssignmentV2[];
  submissions?: OperatingSubmissionV2[];
  artifacts?: OperatingArtifactV2[];
  submissionReplayIndex?: OperatingSubmissionReplayEntryV2[];
  intelligencePlans?: OperatingIntelligencePlanV2[];
}): readonly OperatingAssignmentTerminalIntentV2[];

export function assertOperatingAssignmentTerminalPayloadV2(
  assignment: OperatingAssignmentV2,
  payload: OperatingAssignmentTerminalIntentV2['payload'],
  state: {
    assignments: OperatingAssignmentV2[];
    submissions?: OperatingSubmissionV2[];
    artifacts?: OperatingArtifactV2[];
    submissionReplayIndex?: OperatingSubmissionReplayEntryV2[];
    intelligencePlans?: OperatingIntelligencePlanV2[];
  },
): OperatingAssignmentTerminalIntentV2;

export function deriveOperatingAssignmentReleaseIntentsV2(input: {
  assignments: OperatingAssignmentV2[];
  submissions?: OperatingSubmissionV2[];
  artifacts?: OperatingArtifactV2[];
  submissionReplayIndex?: OperatingSubmissionReplayEntryV2[];
  intelligencePlans?: OperatingIntelligencePlanV2[];
}): readonly OperatingAssignmentReleaseIntentV2[];

export function assertOperatingAssignmentAvailabilityPayloadV2(
  assignment: OperatingAssignmentV2,
  payload: {
    assignmentId: string;
    releaseId: string;
    dependencyProofs: readonly OperatingDependencyProofV2[];
    dependencyEventIds: readonly string[];
  },
  state: {
    assignments: OperatingAssignmentV2[];
    submissions?: OperatingSubmissionV2[];
    artifacts?: OperatingArtifactV2[];
    submissionReplayIndex?: OperatingSubmissionReplayEntryV2[];
    intelligencePlans?: OperatingIntelligencePlanV2[];
  },
): OperatingAssignmentReleaseIntentV2;
