export type DesignHandoffDigest = `sha256:${string}`;
export type DesignHandoffStatus = 'ready' | 'attention' | 'blocked' | 'stale';
export type DesignHandoffCheckStatus = 'pass' | 'attention' | 'blocked' | 'stale';
export type DesignHandoffSchema = Readonly<Record<string, unknown>>;

export interface DesignHandoffAction {
  id: string;
  label: string;
}
export interface DesignHandoffEvidenceReference {
  id: string;
  kind:
    | 'design-revision'
    | 'selected-direction'
    | 'design-specification'
    | 'rendered-verification'
    | 'review-context'
    | 'review-feedback'
    | 'review-metadata'
    | 'review-handoff'
    | 'screen'
    | 'frame'
    | 'component'
    | 'state'
    | 'flow'
    | 'token'
    | 'review-decision'
    | 'element-anchor';
  path: string;
  revision?: DesignHandoffDigest;
  digest?: DesignHandoffDigest;
  anchor?:
    | { section: string }
    | { screenId: string; elementId?: string }
    | { reviewId: string; pinId: string };
}
export interface DesignHandoffReadinessCheck {
  id: string;
  status: DesignHandoffCheckStatus;
  message: string;
  evidenceRefs: string[];
  recoveryAction?: DesignHandoffAction;
}
export interface DesignHandoffReadiness {
  kind: 'openplanr-design-handoff-readiness';
  schemaVersion: '1.0.0';
  scope: 'design-originated';
  authority: 'none';
  designId: string;
  sourceRevision: DesignHandoffDigest | null;
  selectedVariant: string | null;
  status: DesignHandoffStatus;
  continuation: { action: 'prepare-plan'; available: boolean };
  checks: DesignHandoffReadinessCheck[];
  evidence: DesignHandoffEvidenceReference[];
  blockers: string[];
  nextActions: DesignHandoffAction[];
}
export interface DesignHandoffReadinessAbsence {
  kind: 'openplanr-design-handoff-readiness-absence';
  schemaVersion: '1.0.0';
  status: 'absent';
  reason: 'not-computed' | 'not-applicable' | 'unavailable';
  message: string;
  nextAction: DesignHandoffAction;
}
export interface DesignImplementationHandoff {
  kind: 'openplanr-design-implementation-handoff';
  schemaVersion: '1.0.0';
  id: string;
  version: number;
  status: 'draft' | 'approved' | 'superseded' | 'revoked';
  authority: 'prepare-plan';
  title: string;
  basis: {
    designId: string;
    sourceRevision: DesignHandoffDigest;
    selectedVariant: string;
    readiness: { status: DesignHandoffStatus; digest: DesignHandoffDigest };
    reviewHandoff: { version: number; contentDigest: DesignHandoffDigest };
  };
  sources: DesignHandoffEvidenceReference[];
  requirements: Array<{
    id: string;
    kind:
      | 'behavior'
      | 'visual-state'
      | 'responsive'
      | 'accessibility'
      | 'content-data-assumption'
      | 'constraint'
      | 'verification-intent';
    statement: string;
    sourceRefs: string[];
    verification: string[];
  }>;
  contentDigest: DesignHandoffDigest;
  markdown: string;
  approval?: {
    actorId: string;
    approvedAt: string;
    contentDigest: DesignHandoffDigest;
    authority: 'prepare-plan';
  };
  supersededBy?: { id: string; version: number; contentDigest: DesignHandoffDigest };
  revocation?: { actorId: string; revokedAt: string; reason: string };
}
export interface DesignPlanningLineage {
  kind: 'openplanr-design-planning-lineage';
  schemaVersion: '1.0.0';
  handoff: { id: string; version: number; contentDigest: DesignHandoffDigest };
  specId: string;
  mappings: Array<{
    requirementId: string;
    acceptanceRefs: Array<{ storyId: string; acceptanceId: string }>;
    taskIds: string[];
  }>;
}

export declare const DESIGN_HANDOFF_PROTOCOL_VERSION: '1.11.0';
export declare const DESIGN_HANDOFF_CONTRACT_VERSION: '1.0.0';
export declare const DESIGN_HANDOFF_AUTHORITY: 'prepare-plan';
export declare const DESIGN_HANDOFF_CHECK_IDS: readonly string[];
export declare const DESIGN_HANDOFF_SOURCE_KINDS: readonly string[];
export declare const DESIGN_HANDOFF_REQUIREMENT_KINDS: readonly string[];
export declare const DESIGN_HANDOFF_CONTRACT_FILES: Readonly<Record<string, string>>;
export declare const DESIGN_HANDOFF_READINESS_SCHEMA: DesignHandoffSchema;
export declare const DESIGN_IMPLEMENTATION_HANDOFF_SCHEMA: DesignHandoffSchema;
export declare const DESIGN_PLANNING_LINEAGE_SCHEMA: DesignHandoffSchema;
export declare const DESIGN_HANDOFF_SCHEMAS: Readonly<Record<string, DesignHandoffSchema>>;
export declare function isDesignHandoffRelativePath(value: unknown): value is string;
export declare function assertDesignHandoffContract<T>(
  value: T,
  schemaOrName: DesignHandoffSchema | keyof typeof DESIGN_HANDOFF_SCHEMAS,
): T;
export declare function assertDesignHandoffReadiness<
  T extends DesignHandoffReadiness | DesignHandoffReadinessAbsence,
>(value: T): T;
export declare function designImplementationHandoffDigest(
  value: DesignImplementationHandoff,
): DesignHandoffDigest;
export declare function assertDesignImplementationHandoff<T extends DesignImplementationHandoff>(
  value: T,
): T;
export declare function assertDesignPlanningLineage<T extends DesignPlanningLineage>(
  value: T,
  handoff?: DesignImplementationHandoff,
): T;
