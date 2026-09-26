import type {
  OperateAllowedActionV2,
  OperateExperienceAccessLevelV1,
  OperateExperienceClaimV1,
  OperateExperienceEvidenceV1,
  OperateExperienceEventHeadV1,
  OperateExperienceViewV1,
  OperatingReviewReadV2,
  OperatingReviewReceiptV2,
  OperatingReviewV2,
  OperatingWorkDispositionV2,
  OperatingTraceMatrixV2,
} from '../protocol/index.js';

export type OperateReviewWorkspaceSourceV1 = OperatingReviewReadV2 | OperatingReviewReceiptV2;

export type OperateSharedTruthEventHeadV1 =
  | Readonly<{ sequence: 0; hash: null }>
  | Readonly<{ sequence: number; hash: string }>;

export type OperateSharedTruthSummaryV1 = Readonly<{
  kind: 'operate-shared-truth-summary';
  schemaVersion: '1.0.0';
  sourceEventHead: OperateSharedTruthEventHeadV1;
  sourceViewHash: string;
  stages: Readonly<{
    cycles: number;
    total: number;
    complete: number;
    current: number;
    available: number;
    waiting: number;
    blocked: number;
    failed: number;
    skipped: number;
    uncertain: number;
    revisited: number;
    byStage: ReadonlyArray<
      Readonly<{
        id: 'observe' | 'understand' | 'decide' | 'govern' | 'act' | 'verify' | 'learn';
        complete: number;
        current: number;
        available: number;
        waiting: number;
        blocked: number;
        failed: number;
        skipped: number;
        uncertain: number;
        revisited: number;
      }>
    >;
  }>;
  proof: Readonly<{
    status: 'verified' | 'unverified' | 'partial' | 'not-required';
    linkedEvidence: number;
    restrictedEvidence: number;
    resolvedClaims: number;
    unresolvedClaims: number;
    verifiedOutcomes: number;
    unverifiedOutcomes: number;
    reasonCodes: readonly string[];
  }>;
  seats: Readonly<{
    total: number;
    terminal: number;
    validated: number;
    rejected: number;
    failed: number;
    abandoned: number;
    active: number;
    pending: number;
    typedAbsences: number;
  }>;
  evidence: Readonly<{
    total: number;
    available: number;
    restricted: number;
    current: number;
    historical: number;
    stale: number;
    linked: number;
    omitted: number;
  }>;
  claims: Readonly<{
    total: number;
    supported: number;
    contradicted: number;
    uncertain: number;
    unknown: number;
    restricted: number;
  }>;
  verification: Readonly<{
    total: number;
    verified: number;
    unverified: number;
    notRequired: number;
    insufficientEvidence: number;
  }>;
  attention: Readonly<{
    total: number;
    blocking: number;
    actionable: number;
    unavailable: number;
  }>;
  omissions: Readonly<{
    total: number;
    restricted: number;
    absent: number;
    reasonCodes: readonly string[];
  }>;
}>;

export type OperateReviewDisplayChoiceV1 = Readonly<
  OperatingReviewReadV2['dispositionChoices'][number] & {
    consequence: string;
    reversibility: 'immutable-review-event';
    requiredDispositions: readonly OperatingWorkDispositionV2[];
  }
>;

export type OperateReviewWorkspacePayloadV1 = Readonly<{
  ok: true;
  kind: 'operate-review-workspace';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  readOnly: true;
  mutationEnabled: boolean;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  cycleId: string;
  reviewId: string;
  actorId: string;
  accessLevel: OperateExperienceAccessLevelV1;
  generatedAt: string;
  sourceArtifactKind: OperateReviewWorkspaceSourceV1['kind'];
  sourceArtifactHash: string;
  sourceEventHead: OperateExperienceEventHeadV1;
  sourceReadEventHead: OperateExperienceEventHeadV1;
  sourceViewHash: string;
  status: 'ready' | 'read-only' | 'stale' | 'partial' | 'blocked' | 'offline' | 'terminal';
  reasonCodes: readonly string[];
  data: Readonly<{
    review: OperatingReviewV2;
    policyBinding: Readonly<{
      sourceContract: Readonly<{ id: 'operating-review'; version: '2.0.0' }>;
      ownerActorId: string;
      actorMatchesOwner: boolean;
      authorityBoundary: 'review-only';
      externalEffectsAuthorized: false;
    }>;
    executiveSummary: Readonly<{
      text: string;
      decisionCount: number;
      actionCount: number;
      findingCount: number;
      dissentCount: number;
      gapCount: number;
      uncertaintyCount: number;
    }>;
    recommendation:
      | Readonly<{
          status: 'available';
          items: ReadonlyArray<OperatingReviewReadV2['decisions'][number]>;
          absence: null;
        }>
      | Readonly<{
          status: 'absent';
          items: readonly [];
          absence: Readonly<{ code: string; message: string }>;
        }>;
    choices: readonly OperateReviewDisplayChoiceV1[];
    findings: ReadonlyArray<OperatingReviewReadV2['findings'][number]>;
    dissent: ReadonlyArray<OperatingReviewReadV2['dissent'][number]>;
    uncertainty: ReadonlyArray<
      Readonly<{
        uncertaintyId: string;
        sourceKind: 'decision' | 'claim' | 'evidence' | 'gap';
        sourceId: string;
        statement: string;
      }>
    >;
    gaps: ReadonlyArray<OperatingReviewReadV2['gaps'][number]>;
    claims: readonly OperateExperienceClaimV1[];
    evidence: readonly OperateExperienceEvidenceV1[];
    omissions: ReadonlyArray<
      Readonly<{
        kind: 'restricted' | 'absent';
        subject: 'evidence' | 'claim' | 'seat' | 'source';
        count: number;
        subjectIds: readonly string[];
        reasonCode: string;
      }>
    >;
    traceMatrix: OperatingTraceMatrixV2 | null;
    truthSummary: OperateSharedTruthSummaryV1;
    terminalDisposition: null | Readonly<{
      receiptId: string;
      decision: OperatingReviewReceiptV2['decision'];
      appliedChoiceId: string;
      appliedChoiceHash: string;
      appliedWorkDispositions: readonly OperatingWorkDispositionV2[];
      readEventHead: OperateExperienceEventHeadV1;
      eventHead: OperateExperienceEventHeadV1;
      committedAt: string;
    }>;
    capability:
      | Readonly<{
          available: true;
          actions: ReadonlyArray<
            Readonly<{ subjectId: string; action: OperateAllowedActionV2<'operate.review.submit'> }>
          >;
          reason: null;
        }>
      | Readonly<{
          available: false;
          actions: readonly [];
          reason: Readonly<{ code: string; message: string }>;
        }>;
  }>;
}>;

export function deriveOperateSharedTruthSummaryV1(
  view: OperateExperienceViewV1,
): OperateSharedTruthSummaryV1;

export function assertOperateReviewWorkspacePayloadSafeV1<T>(payload: T): T;

export function buildOperateReviewWorkspacePayloadV1(
  source: OperateReviewWorkspaceSourceV1,
  view: OperateExperienceViewV1,
): OperateReviewWorkspacePayloadV1;
