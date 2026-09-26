import type {
  OperateAllowedActionV2,
  OperateExperienceAccessLevelV1,
  OperateExperienceActionV1,
  OperateExperienceCycleV1,
  OperateExperienceEventHeadV1,
  OperateExperienceHistoryV1,
  OperateExperienceInboxItemV1,
  OperateExperienceLearningV1,
  OperateExperienceOutcomeV1,
  OperateExperiencePreviewV1,
  OperateExperienceReplayV1,
  OperatingFindingSeverityV2,
  OperatingFindingStateV2,
  OperatingFindingTypeV2,
  OperatingWorkCycleLinkV2,
  ProtocolValidationError,
} from '../protocol/index.js';
import type {
  OperateExperienceSurfaceStatusV1,
  OperateExperienceSurfaceV1,
} from './operate-experience-surface-contract.mjs';
import type { OperateSharedTruthSummaryV1 } from './operate-review-workspace-projection-v2.mjs';

export type OperateDisplayIntegrityV1 = Readonly<{
  algorithm: 'sha-256-jcs';
  domain:
    | 'openplanr:operate-experience-display-surface:1.0.0'
    | 'openplanr:operate-cycle-display-workspace:1.0.0'
    | 'openplanr:operate-executive-board-display-surface:1.0.0'
    | 'openplanr:operate-action-display-workspace:1.0.0'
    | 'openplanr:operate-recovery-display-surface:1.0.0';
  sourceViewHash: string;
  contentHash: string;
}>;

export type OperateDisplayBindingV1 = Readonly<{
  actorId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  generatedAt: string;
  eventHead: OperateExperienceEventHeadV1;
  viewHash: string;
  projectId?: string;
  generation?: number;
  surface?: 'today' | 'inbox' | 'cycles' | 'cycle' | 'actions' | 'action';
  subjectId?: string | null;
  cycleId?: string | null;
}>;

export type OperatePreviewBindingV1 = Readonly<{
  actorId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  eventHead: Readonly<{ sequence: number; hash: string | null }>;
  sourceViewHash: string;
  subjectId: string;
  actionDigest: string;
}>;

export type OperateExperienceDisplaySurfacePayloadV1 = Extract<
  OperateExperienceSurfaceV1,
  { surface: 'today' | 'inbox' | 'cycles' | 'cycle' | 'actions' }
>;

export type OperateExperienceDisplaySurfaceV1 = Readonly<{
  kind: 'operate-experience-display-surface';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  payload: OperateExperienceDisplaySurfacePayloadV1;
  integrity: OperateDisplayIntegrityV1 &
    Readonly<{
      domain: 'openplanr:operate-experience-display-surface:1.0.0';
    }>;
}>;

export type OperateCycleDisplayAssignmentV1 = Readonly<
  Omit<OperateExperienceCycleV1['assignments'][number], 'deepLink'> & {
    deepLink: string | null;
  }
>;
export type OperateCycleDisplayOutcomeV1 = Readonly<
  Omit<OperateExperienceOutcomeV1, 'deepLink'> & { deepLink: string | null }
>;
export type OperateCycleDisplayCycleV1 = Readonly<
  Omit<OperateExperienceCycleV1, 'assignments'> & {
    assignments: readonly OperateCycleDisplayAssignmentV1[];
  }
>;
export type OperateCycleDisplayPersistentItemV1 = Readonly<{
  kind: 'finding' | 'decision' | 'action';
  subjectId: string;
  state: string;
  relations: readonly OperatingWorkCycleLinkV2['relation'][];
}>;

export type OperateCycleDisplayWorkspacePayloadV1 = Readonly<{
  ok: true;
  kind: 'operate-cycle-workspace';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  readOnly: boolean;
  mutationEnabled: boolean;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  actorId: string;
  accessLevel: OperateExperienceAccessLevelV1;
  generatedAt: string;
  eventHead: OperateExperienceEventHeadV1;
  viewHash: string;
  truthSummary: OperateSharedTruthSummaryV1;
  status: Exclude<OperateExperienceSurfaceStatusV1, 'incompatible' | 'corrupt'>;
  reasonCodes: readonly string[];
  data: Readonly<{
    ownerCycle: Readonly<{
      cycleId: string;
      scopeId: string;
      domainId: string;
      domainVersion: string;
      state: string;
      health: string;
      focus: readonly string[];
      createdAt: string;
      updatedAt: string;
    }>;
    cycle: OperateCycleDisplayCycleV1;
    progress: Readonly<{
      total: number;
      pending: number;
      available: number;
      active: number;
      submitted: number;
      validated: number;
      rejected: number;
      terminal: number;
    }>;
    replay: OperateExperienceReplayV1;
    verification: Readonly<{
      status: 'not-required' | 'verified' | 'unverified';
      reasonCodes: readonly string[];
    }>;
    persistentWork: Readonly<{
      findings: readonly OperateCycleDisplayPersistentItemV1[];
      decisions: readonly OperateCycleDisplayPersistentItemV1[];
      actions: readonly OperateCycleDisplayPersistentItemV1[];
      outcomes: readonly OperateCycleDisplayOutcomeV1[];
      learnings: readonly OperateExperienceLearningV1[];
      cycleLinks: readonly OperatingWorkCycleLinkV2[];
    }>;
    allowedActions: readonly OperateAllowedActionV2<'operate.cycle.get'>[];
  }>;
}>;

export type OperateCycleDisplayWorkspaceV1 = Readonly<{
  kind: 'operate-cycle-display-workspace';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  payload: OperateCycleDisplayWorkspacePayloadV1;
  integrity: OperateDisplayIntegrityV1 &
    Readonly<{
      domain: 'openplanr:operate-cycle-display-workspace:1.0.0';
    }>;
}>;

export type OperateExecutiveBoardSeatAbsenceV1 =
  | Readonly<{
      kind: 'terminal';
      outcome: 'abandoned' | 'failed';
      code: string;
      reason: string;
      recoveryDisposition: string;
    }>
  | Readonly<{
      kind: 'lens';
      roleId: string;
      roleKind: string;
      absenceCode: string;
      reason: string;
    }>
  | Readonly<{ kind: 'omitted'; reason: string }>;

export type OperateExecutiveBoardArtifactV1 = Readonly<{
  artifactId: string;
  rawHash: string;
  canonicalHash: string;
}>;

export type OperateExecutiveBoardDissentV1 = Readonly<{
  sourceArtifactId: string;
  localDissentId: string;
  statement: string;
  resolutionCondition: string;
}>;

export type OperateExecutiveBoardFindingTargetV1 = Readonly<{
  advisorArtifactId: string;
  analysisIds: readonly string[];
  claimIds: readonly string[];
  measurementIds: readonly string[];
  riskIds: readonly string[];
  recommendationIds: readonly string[];
}>;

export type OperateExecutiveBoardChallengerFindingV1 = Readonly<{
  findingId: string;
  sourceArtifactId: string;
  sourceAssignmentId: string;
  sourceLocalFindingId: string;
  findingType: OperatingFindingTypeV2;
  severity: OperatingFindingSeverityV2;
  confidence: number;
  targets: readonly OperateExecutiveBoardFindingTargetV1[];
  supportingEvidenceRefIds: readonly string[];
  contradictingEvidenceRefIds: readonly string[];
  title: string;
  statement: string;
  rationale: string;
  correctionCondition: string;
  state: OperatingFindingStateV2;
  ownerActorId: string | null;
  revisitAt: string | null;
}>;

export type OperateExecutiveBoardChallengerFindingsV1 = Readonly<{
  artifact: OperateExecutiveBoardArtifactV1 | null;
  findings: readonly OperateExecutiveBoardChallengerFindingV1[];
  dissent: readonly OperateExecutiveBoardDissentV1[];
}>;

export type OperateExecutiveBoardClaimRefV1 = Readonly<{
  advisorArtifactId: string;
  localClaimId: string;
}>;

export type OperateExecutiveBoardRecommendationRefV1 = Readonly<{
  advisorArtifactId: string;
  localRecommendationId: string;
}>;

export type OperateExecutiveBoardAlternativeDispositionV1 = Readonly<{
  sourceArtifactId: string;
  localAlternativeId: string;
  title: string | null;
  disposition: 'accepted' | 'rejected' | 'deferred';
  rationale: string | null;
}>;

export type OperateExecutiveBoardActionHypothesisV1 = Readonly<{
  localActionHypothesisId: string;
  title: string | null;
  objectiveId: string | null;
  ownerActorId: string | null;
  accountabilityDisposition: 'unowned' | 'blocked' | null;
  expectedResult: string | null;
  metricId: string | null;
  baseline: number | null;
  target: number | null;
  verificationWindow: string | null;
  verificationMethod: string | null;
  sourceClaimRefs: readonly OperateExecutiveBoardClaimRefV1[];
  sourceFindingIds: readonly string[];
  dependsOnActionHypothesisIds: readonly string[];
}>;

export type OperateExecutiveBoardChairDecisionV1 = Readonly<{
  localDecisionId: string;
  title: string | null;
  question: string | null;
  outcome: string | null;
  rationale: string | null;
  sourceClaimRefs: readonly OperateExecutiveBoardClaimRefV1[];
  sourceRecommendationRefs: readonly OperateExecutiveBoardRecommendationRefV1[];
  challengerFindingIds: readonly string[];
  evidenceRefIds: readonly string[];
  confidence: number | null;
  assumptionIds: readonly string[];
  expectedUpside: string | null;
  expectedDownside: string | null;
  uncertainty: string | null;
  reversibility: string | null;
  ownerActorId: string | null;
  revisitConditions: readonly string[];
  dissentIds: readonly string[];
  alternativeDispositions: readonly OperateExecutiveBoardAlternativeDispositionV1[];
  actionHypotheses: readonly OperateExecutiveBoardActionHypothesisV1[];
}>;

export type OperateExecutiveBoardRoleGapV1 = Readonly<{
  absenceId: string | null;
  kind: 'role';
  roleId: string;
  roleKind: 'advisor' | 'challenger' | 'chair';
  roleVersion: string | null;
  absenceCode: string;
  reason: string;
  recoveryDisposition: string | null;
  sourceAssignmentId: string | null;
  sourceEventId: string | null;
}>;

export type OperateExecutiveBoardEvidenceGapV1 = Readonly<{
  absenceId: string;
  kind: 'evidence';
  requirementId: string;
  evidenceKinds: readonly ('git' | 'filesystem' | 'planr' | 'operate-artifact')[];
  sourceContracts: readonly Readonly<{ id: string; version: string }>[];
  absenceCode: 'not-available' | 'not-authorized' | 'resolution-failed' | 'stale';
  reason: string;
  recoveryDisposition: string;
  sourceEvidenceRefIds: readonly string[];
  sourceEventIds: readonly string[];
}>;

export type OperateExecutiveBoardGapV1 =
  | OperateExecutiveBoardRoleGapV1
  | OperateExecutiveBoardEvidenceGapV1;

export type OperateExecutiveBoardChairSynthesisV1 = Readonly<{
  artifact: Readonly<{
    artifactId: string;
    intelligencePlanId: string;
    advisorArtifactIds: readonly string[];
    challengerArtifactId: string | null;
  }>;
  decisions: readonly OperateExecutiveBoardChairDecisionV1[];
  dissent: readonly OperateExecutiveBoardDissentV1[];
  unresolvedGaps: readonly OperateExecutiveBoardGapV1[];
}>;

export type OperateExecutiveBoardSeatV1 = Readonly<{
  roleId: string;
  label: string;
  roleKind: string;
  roleVersion: string;
  assignmentId: string | null;
  assignmentState: string | null;
  artifact: OperateExecutiveBoardArtifactV1 | null;
  absence: OperateExecutiveBoardSeatAbsenceV1 | null;
}>;

export type OperateExecutiveBoardV1 = Readonly<{
  cycleId: string;
  planId: string;
  seats: readonly OperateExecutiveBoardSeatV1[];
  challengerFindings: OperateExecutiveBoardChallengerFindingsV1 | null;
  chairSynthesis: OperateExecutiveBoardChairSynthesisV1 | null;
}>;

export type OperateExecutiveBoardDisplayPayloadV1 = Readonly<{
  ok: true;
  kind: 'operate-executive-board';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  readOnly: true;
  mutationEnabled: false;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  actorId: string;
  accessLevel: OperateExperienceAccessLevelV1;
  generatedAt: string;
  eventHead: OperateExperienceEventHeadV1;
  viewHash: string;
  status: Exclude<OperateExperienceSurfaceStatusV1, 'incompatible' | 'corrupt'>;
  reasonCodes: readonly string[];
  data: Readonly<{
    cycleId: string;
    executiveBoard: OperateExecutiveBoardV1;
  }>;
}>;

export type OperateExecutiveBoardDisplaySurfaceV1 = Readonly<{
  kind: 'operate-executive-board-display-surface';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  payload: OperateExecutiveBoardDisplayPayloadV1;
  integrity: OperateDisplayIntegrityV1 &
    Readonly<{
      domain: 'openplanr:operate-executive-board-display-surface:1.0.0';
    }>;
}>;

export type OperateActionDisplayWorkspacePayloadV1 = Readonly<{
  ok: true;
  kind: 'operate-action-workspace';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  readOnly: true;
  mutationEnabled: false;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  actorId: string;
  accessLevel: OperateExperienceAccessLevelV1;
  generatedAt: string;
  eventHead: OperateExperienceEventHeadV1;
  viewHash: string;
  status: Exclude<OperateExperienceSurfaceStatusV1, 'incompatible' | 'corrupt'>;
  reasonCodes: readonly string[];
  data: Readonly<{
    action: OperateExperienceActionV1;
    outcome: OperateExperienceOutcomeV1 | null;
    learnings: readonly OperateExperienceLearningV1[];
    inbox: readonly OperateExperienceInboxItemV1[];
    history: readonly OperateExperienceHistoryV1[];
    replay: OperateExperienceReplayV1;
    verification: Readonly<{
      status: 'not-required' | 'verified' | 'unverified';
      reasonCodes: readonly string[];
    }>;
    boundaries: Readonly<{
      approvalExecution: string;
      verification: string;
      retry: string;
    }>;
    allowedActions: readonly Readonly<{
      subjectId: string;
      action: OperateAllowedActionV2;
    }>[];
  }>;
}>;

export type OperateActionDisplayWorkspaceV1 = Readonly<{
  kind: 'operate-action-display-workspace';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  payload: OperateActionDisplayWorkspacePayloadV1;
  integrity: OperateDisplayIntegrityV1 &
    Readonly<{
      domain: 'openplanr:operate-action-display-workspace:1.0.0';
    }>;
}>;

export type OperateRecoveryDisplayPayloadV1 = Readonly<{
  ok: true;
  kind: 'operate-recovery';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  readOnly: true;
  mutationEnabled: false;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  actorId: string;
  accessLevel: OperateExperienceAccessLevelV1;
  generatedAt: string;
  eventHead: OperateExperienceEventHeadV1;
  viewHash: string;
  status: Exclude<OperateExperienceSurfaceStatusV1, 'incompatible' | 'corrupt'>;
  reasonCodes: readonly string[];
  data: Readonly<{
    inspection: Readonly<Record<string, unknown>>;
    history: readonly OperateExperienceHistoryV1[];
    allowedActions: readonly OperateAllowedActionV2[];
    recoveryState:
      | 'blocked'
      | 'uncertain'
      | 'custody'
      | 'divergent'
      | 'corrupt'
      | 'incompatible'
      | 'restored';
  }>;
}>;

export type OperateRecoveryDisplaySurfaceV1 = Readonly<{
  kind: 'operate-recovery-display-surface';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  payload: OperateRecoveryDisplayPayloadV1;
  integrity: OperateDisplayIntegrityV1 &
    Readonly<{
      domain: 'openplanr:operate-recovery-display-surface:1.0.0';
    }>;
}>;

export function validateOperateExperienceDisplaySurfaceV1(
  value: unknown,
  expected?: OperateDisplayBindingV1,
): ProtocolValidationError[];
export function assertOperateExperienceDisplaySurfaceV1(
  value: unknown,
  expected?: OperateDisplayBindingV1,
): OperateExperienceDisplaySurfaceV1;
export function validateOperateCycleDisplayWorkspaceV1(
  value: unknown,
  expected?: OperateDisplayBindingV1,
): ProtocolValidationError[];
export function assertOperateCycleDisplayWorkspaceV1(
  value: unknown,
  expected?: OperateDisplayBindingV1,
): OperateCycleDisplayWorkspaceV1;
export function issueOperateExperienceDisplaySurfaceV1(
  payload: OperateExperienceDisplaySurfacePayloadV1,
): OperateExperienceDisplaySurfaceV1;
export function issueOperateCycleDisplayWorkspaceV1(
  payload: OperateCycleDisplayWorkspacePayloadV1,
): OperateCycleDisplayWorkspaceV1;
export function validateOperateExecutiveBoardDisplaySurfaceV1(
  value: unknown,
  expected?: OperateDisplayBindingV1,
): ProtocolValidationError[];
export function assertOperateExecutiveBoardDisplaySurfaceV1(
  value: unknown,
  expected?: OperateDisplayBindingV1,
): OperateExecutiveBoardDisplaySurfaceV1;
export function issueOperateExecutiveBoardDisplaySurfaceV1(
  payload: OperateExecutiveBoardDisplayPayloadV1,
): OperateExecutiveBoardDisplaySurfaceV1;
export function validateOperateActionDisplayWorkspaceV1(
  value: unknown,
  expected?: OperateDisplayBindingV1,
): ProtocolValidationError[];
export function assertOperateActionDisplayWorkspaceV1(
  value: unknown,
  expected?: OperateDisplayBindingV1,
): OperateActionDisplayWorkspaceV1;
export function issueOperateActionDisplayWorkspaceV1(
  payload: OperateActionDisplayWorkspacePayloadV1,
): OperateActionDisplayWorkspaceV1;
export function validateOperateRecoveryDisplaySurfaceV1(
  value: unknown,
  expected?: OperateDisplayBindingV1,
): ProtocolValidationError[];
export function assertOperateRecoveryDisplaySurfaceV1(
  value: unknown,
  expected?: OperateDisplayBindingV1,
): OperateRecoveryDisplaySurfaceV1;
export function issueOperateRecoveryDisplaySurfaceV1(
  payload: OperateRecoveryDisplayPayloadV1,
): OperateRecoveryDisplaySurfaceV1;
export function validateOperateExperiencePreviewV1(
  value: unknown,
  expected?: OperatePreviewBindingV1,
): ProtocolValidationError[];
export function assertOperateExperiencePreviewV1(
  value: unknown,
  expected?: OperatePreviewBindingV1,
): OperateExperiencePreviewV1;

export const OPERATE_EXPERIENCE_DISPLAY_SURFACE_SCHEMA_V1: Readonly<Record<string, unknown>>;
export const OPERATE_CYCLE_DISPLAY_WORKSPACE_SCHEMA_V1: Readonly<Record<string, unknown>>;
export const OPERATE_EXECUTIVE_BOARD_DISPLAY_SURFACE_SCHEMA_V1: Readonly<Record<string, unknown>>;
export const OPERATE_ACTION_DISPLAY_WORKSPACE_SCHEMA_V1: Readonly<Record<string, unknown>>;
export const OPERATE_RECOVERY_DISPLAY_SURFACE_SCHEMA_V1: Readonly<Record<string, unknown>>;
export const ACTION_WORKSPACE_DOMAIN: 'openplanr:operate-action-display-workspace:1.0.0';
export const RECOVERY_DISPLAY_DOMAIN: 'openplanr:operate-recovery-display-surface:1.0.0';
