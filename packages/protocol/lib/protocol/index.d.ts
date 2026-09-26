export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ProtocolValidationError {
  path: string;
  rule: string;
  detail: string;
}

export interface ProtocolSchemaContract {
  kind: string;
  protocolVersion: string;
  path: string;
  schema: Record<string, JsonValue>;
}

export interface DashboardQueryRootV1 {
  actorId: string;
  projectId: `sha256:${string}`;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  generation: number;
}

export interface DashboardBootstrapV1 {
  kind: 'dashboard-bootstrap';
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
  ui: { buildId: string | null; expectedBuildId: string | null; assetManifestHash: string | null };
  server: { packageVersion: string };
  capabilities: {
    planningGraph: { schemaVersion: '1.0.0' };
    operateExperience: { protocolVersion: '2.0.0'; schemaVersion: '1.0.0' };
    operateCommands: { protocolVersion: '2.0.0'; transportVersion: '1.0.0'; available: boolean };
    diagnostics: { schemaVersion: '1.0.0'; available: boolean };
  };
  project: {
    projectId: `sha256:${string}`;
    name: string;
    branch: string;
    /** Exact unordered set containing Planning and Operate once each. */
    products: readonly ['planning', 'operate'] | readonly ['operate', 'planning'];
  };
  queryRoots: {
    planning: DashboardQueryRootV1 | null;
    operate: DashboardQueryRootV1 | null;
  };
  origin: `http://${'127.0.0.1' | 'localhost'}:${number}`;
  compatibility: {
    status: 'compatible' | 'incompatible';
    reasonCodes: Array<
      | 'DASHBOARD_MANIFEST_MISSING'
      | 'DASHBOARD_MANIFEST_INVALID'
      | 'DASHBOARD_ASSET_MISSING'
      | 'DASHBOARD_BUILD_MISMATCH'
    >;
  };
}

export interface OperatingEventHeadV2 {
  sequence: number;
  hash: string | null;
  protocolVersions: ['2.0.0'];
}

export type OperateProtocolVersionV2 = '2.0.0';
export type OperatePhase1CycleStateV2 =
  | 'created'
  | 'observing'
  | 'advising'
  | 'challenging'
  | 'synthesizing'
  | 'awaiting_review'
  | 'approved'
  | 'executing'
  | 'verifying'
  | 'closed'
  | 'blocked'
  | 'failed'
  | 'cancelled';
export type OperatingAssignmentStateV2 =
  | 'pending'
  | 'available'
  | 'claimed'
  | 'running'
  | 'submitted'
  | 'validated'
  | 'rejected'
  | 'abandoned'
  | 'failed';
export type OperatingReviewStateV2 =
  | 'pending'
  | 'approved'
  | 'changes_requested'
  | 'rejected'
  | 'cancelled';
export type OperatePhase1AssignmentKindV2 = 'advisor' | 'challenger' | 'chair';
export type OperatingAssignmentKindV2 =
  | OperatePhase1AssignmentKindV2
  | 'context-capture'
  | 'execution'
  | 'verification';
export type OperatePhase1TriggerV2 = { kind: 'manual' };
export type OperateToolNameV2 =
  | 'operate.cycle.start'
  | 'operate.cycle.get'
  | 'operate.cycle.resume'
  | 'operate.assignment.claim'
  | 'operate.assignment.submit'
  | 'operate.artifact.get'
  | 'operate.review.get'
  | 'operate.review.submit'
  | 'operate.action.approve'
  | 'operate.action.execute'
  | 'operate.action.rollback';

export interface ContractRefV2 {
  schemaId: string;
  schemaVersion: string;
  mediaType: string;
  encoding: 'utf-8' | 'binary';
  maxBytes: number;
}

export interface OperatingCycleV2 {
  kind: 'operating-cycle';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  cycleId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  state: OperatePhase1CycleStateV2;
  inputBindingId: string;
  contractVersions: Record<string, string>;
  trigger: OperatePhase1TriggerV2;
  focus: string[];
  health: 'normal' | 'quiet' | 'partial' | 'blocked';
  activeReviewId: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
}

export interface OperatingCycleInputBindingV2 {
  kind: 'operating-cycle-input-binding';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  inputBindingId: string;
  cycleId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  sourceArtifactIds: string[];
  runtimeBinding: {
    runtime: 'codex' | 'claude-code' | 'cursor';
    adapterVersion: string;
  };
  capturedAt: string;
}

export interface OperatingAssignmentMandateV2 {
  scope: string;
  allowedEvidence: string[];
  allowedCapabilities: Array<
    'repository.read' | 'planr.read' | 'git.read' | 'artifact.read' | 'artifact.submit'
  >;
  forbiddenEffects: Array<
    | 'repository.write'
    | 'production.deploy'
    | 'payment.change'
    | 'customer-contact'
    | 'publish'
    | 'spend'
    | 'ship'
    | 'governed-execution'
  >;
  capabilityCeiling: 'read-only';
  skillId: string;
}

export interface OperatingRoleInputAbsenceV2 {
  absenceId: string;
  kind: 'role';
  roleId: string;
  roleKind: 'advisor' | 'challenger' | 'chair';
  roleVersion: string;
  absenceCode: string;
  reason: string;
  recoveryDisposition: string;
  sourceAssignmentId: string | null;
  sourceEventId: string | null;
}

export interface OperatingEvidenceInputAbsenceV2 {
  absenceId: string;
  kind: 'evidence';
  requirementId: string;
  evidenceKinds: OperateEvidenceKindV2[];
  sourceContracts: OperateVersionedIdentityV2[];
  absenceCode: 'not-available' | 'not-authorized' | 'resolution-failed' | 'stale';
  reason: string;
  recoveryDisposition: string;
  sourceEvidenceRefIds: string[];
  sourceEventIds: string[];
}

export type OperatingAssignmentInputAbsenceV2 =
  | OperatingRoleInputAbsenceV2
  | OperatingEvidenceInputAbsenceV2;

export interface OperatingAnalysisProfileV2 {
  id: string;
  version: string;
  questionIds: string[];
}

export interface OperatingEvidenceRequirementV2 {
  requirementId: string;
  description: string;
  necessity: 'required' | 'preferred';
  acceptedEvidenceKinds: OperateEvidenceKindV2[];
  minimumEvidenceRefs: number;
  maximumEvidenceRefs: number;
  acceptedFreshness: OperateEvidenceFreshnessV2[];
}

export interface OperatingResultRequirementV2 {
  requirementId: string;
  description: string;
  target:
    | 'analysis'
    | 'claims'
    | 'measurements'
    | 'risks'
    | 'alternatives'
    | 'gaps'
    | 'recommendation'
    | 'findings'
    | 'dissent'
    | 'decisions'
    | 'source-dispositions'
    | 'question-coverage';
  appliesToOutcomes: Array<'always' | 'recommendation' | 'partial' | 'quiet'>;
  minimumItems: number;
  maximumItems: number;
}

export interface OperatingIssuedEvidenceV2 {
  requirementId: string;
  evidenceRefId: string;
  evidenceArtifactId: string;
  rawHash: string;
  canonicalHash: string | null;
  classification: OperateEvidenceClassificationV2;
  freshness: OperateEvidenceFreshnessV2;
}

export interface OperatingInputBundleBindingV2 {
  bundleId: string;
  bundleArtifactId: string;
  bundleRawHash: string;
  bundleCanonicalHash: string | null;
  sourceArtifactIds: string[];
  issuedEvidence: OperatingIssuedEvidenceV2[];
}

export interface OperatingAssignmentIntelligenceContextV2 {
  intelligencePlanId: string;
  snapshotId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  sourceArtifactId: string;
  sourceArtifactIds: string[];
  evidenceRefIds: string[];
  inputBundle: OperatingInputBundleBindingV2;
  decisionOwnerActorId: string;
}

interface OperatingAssignmentBaseV2 {
  kind: 'operating-assignment';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  assignmentId: string;
  cycleId: string;
  roleId: string;
  objective: string;
  state: OperatingAssignmentStateV2;
  dependsOn: string[];
  dependencyPolicy:
    | { kind: 'none' }
    | { kind: 'all-required' }
    | {
        kind: 'threshold';
        minimumSatisfied: number;
        allowedTerminalOutcomes: Array<'abandoned' | 'failed'>;
      };
  inputArtifactIds: string[];
  inputAbsences: OperatingAssignmentInputAbsenceV2[];
  outputContract: ContractRefV2;
  capabilityGrantId: string | null;
  governedOperationId?: string | null;
  attemptPolicy: { maxAttempts: number; attempt: number; timeoutMs: number };
  claim: { actorId: string; actorKind: 'agent' | 'human'; runtime: string; claimId: string } | null;
  terminalOutcome: {
    outcome: 'abandoned' | 'failed';
    eventId: string;
    code: string;
    reason: string;
    recoveryDisposition: string;
  } | null;
  createdAt: string;
  availableAt: string | null;
  completedAt: string | null;
}

interface OperatingIntelligenceAssignmentBaseV2 extends OperatingAssignmentBaseV2 {
  roleVersion: string;
  analysisRubric: OperateAnalysisRubricV2;
  analysisProfile: OperatingAnalysisProfileV2;
  evidenceRequirements: OperatingEvidenceRequirementV2[];
  resultRequirements: OperatingResultRequirementV2[];
  mandate: OperatingAssignmentMandateV2;
  intelligenceContext: OperatingAssignmentIntelligenceContextV2;
  governedOperationId?: null;
}

/** An Advisor always receives the exact Advisor result contract. */
export interface OperatingAdvisorAssignmentV2 extends OperatingIntelligenceAssignmentBaseV2 {
  assignmentKind: 'advisor';
  outputContract: ContractRefV2 & {
    schemaId: 'operating-advisor-result';
    schemaVersion: '2.0.0';
    mediaType: 'application/json';
    encoding: 'utf-8';
  };
}

/** A Challenger always receives the exact Challenger review contract. */
export interface OperatingChallengerAssignmentV2 extends OperatingIntelligenceAssignmentBaseV2 {
  assignmentKind: 'challenger';
  outputContract: ContractRefV2 & {
    schemaId: 'operating-challenger-review';
    schemaVersion: '2.0.0';
    mediaType: 'application/json';
    encoding: 'utf-8';
  };
}

/** A Chair always receives the Decision Ledger contract. */
export interface OperatingChairAssignmentV2 extends OperatingIntelligenceAssignmentBaseV2 {
  assignmentKind: 'chair';
  outputContract: ContractRefV2 & {
    schemaId: 'operating-decision-ledger';
    schemaVersion: '2.0.0';
    mediaType: 'application/json';
    encoding: 'utf-8';
  };
}

export type OperatingIntelligenceAssignmentV2 =
  | OperatingAdvisorAssignmentV2
  | OperatingChallengerAssignmentV2
  | OperatingChairAssignmentV2;

/** Execution and verification retain their existing governed-work compatibility. */
export interface OperatingGovernedAssignmentV2 extends OperatingAssignmentBaseV2 {
  assignmentKind: 'execution' | 'verification';
  roleVersion?: string;
  analysisRubric?: OperateAnalysisRubricV2;
  analysisProfile?: never;
  evidenceRequirements?: never;
  resultRequirements?: never;
  mandate?: OperatingAssignmentMandateV2;
  intelligenceContext?: null;
  governedOperationId?: string | null;
}

/** A pre-intelligence, runtime-owned capture of exact Cycle context bytes. */
export interface OperatingContextCaptureAssignmentV2 extends OperatingAssignmentBaseV2 {
  assignmentKind: 'context-capture';
  roleVersion?: never;
  analysisRubric?: null;
  analysisProfile?: never;
  evidenceRequirements?: never;
  resultRequirements?: never;
  mandate?: null;
  intelligenceContext?: null;
  outputContract: ContractRefV2 &
    (
      | {
          schemaId: 'operating-context-capture';
          schemaVersion: '2.0.0';
          mediaType: 'application/json';
          encoding: 'utf-8';
        }
      | {
          schemaId: 'operating-intelligence-input-bundle';
          schemaVersion: '2.0.0';
          mediaType: 'application/json';
          encoding: 'utf-8';
        }
    );
  governedOperationId?: null;
}

export type OperatingAssignmentV2 =
  | OperatingIntelligenceAssignmentV2
  | OperatingGovernedAssignmentV2
  | OperatingContextCaptureAssignmentV2;

/** A bounded, cycle-scoped human review; it is not persistent operating work. */
export interface OperatingReviewV2 {
  kind: 'operating-review';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  reviewId: string;
  cycleId: string;
  ownerActorId: string;
  subject?: { type: 'cycle'; cycleId: string } | ({ type: 'action' } & OperateActionIdentityV2);
  state: OperatingReviewStateV2;
  disposition: Exclude<OperatingReviewStateV2, 'pending'> | null;
  workDispositions: OperatingWorkDispositionV2[];
  createdAt: string;
  updatedAt: string;
}

/** A human Review's durable, explicit disposition of persistent work. */
export interface OperatingWorkDispositionV2 {
  entityType: 'operating-finding' | 'operating-decision' | 'operating-action';
  entityId: string;
  disposition:
    | 'accepted'
    | 'approved'
    | 'rejected'
    | 'resolved'
    | 'deferred'
    | 'superseded'
    | 'cancelled';
}

export interface OperatingSubmissionV2 {
  kind: 'operating-submission';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  submissionId: string;
  assignmentId: string;
  cycleId: string;
  state: 'issued' | 'accepted' | 'rejected';
  rawHash: string | null;
  canonicalHash: string | null;
  sizeBytes: number | null;
  artifactId: string | null;
  acceptanceEventIds: string[];
  responseData: JsonValue | null;
  issuedAt: string;
  resolvedAt: string | null;
}

export interface OperatingArtifactV2 {
  kind: 'operating-artifact';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  artifactId: string;
  artifactType: string;
  assignmentId: string;
  cycleId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  schemaId: string;
  artifactSchemaVersion: string;
  mediaType: string;
  encoding: 'utf-8' | 'binary';
  rawHash: string;
  canonicalHash: string | null;
  sizeBytes: number;
  storageClass: 'machine-local';
  sensitivity: 'public' | 'internal' | 'confidential' | 'restricted';
  retentionClass: string;
  producer: { actorId: string; roleId: string; runtime: string };
  inputArtifactIds: string[];
  governedOperationId?: string | null;
  authorityRecordIds?: string[];
  createdAt: string;
}

export type OperateEvidenceKindV2 = 'git' | 'filesystem' | 'planr' | 'operate-artifact';
export type OperateEvidenceClassificationV2 = 'public' | 'internal' | 'confidential' | 'restricted';
export type OperateEvidenceFreshnessV2 = 'current' | 'historical' | 'stale';
export type OperateEvidenceEdgeRelationV2 = 'supportedBy' | 'contradictedBy';
export type OperateEvidenceReadCapabilityV2 =
  | 'evidence.git.read'
  | 'evidence.filesystem.read'
  | 'evidence.planr.read'
  | 'evidence.operate-artifact.read';
export type OperateEvidenceResolverErrorCodeV2 =
  | 'SOURCE_NOT_FOUND'
  | 'REVISION_NOT_FOUND'
  | 'OBJECT_TYPE_MISMATCH'
  | 'PATH_NOT_FOUND'
  | 'LINE_RANGE_INVALID'
  | 'ANCESTRY_MISMATCH'
  | 'ARTIFACT_NOT_FOUND'
  | 'ARTIFACT_HASH_MISMATCH'
  | 'SOURCE_UNTRACKED'
  | 'SOURCE_STALE'
  | 'CAPABILITY_DENIED'
  | 'CONSENT_REQUIRED'
  | 'SENSITIVITY_BLOCKED'
  | 'SECRET_DETECTED'
  | 'UNSUPPORTED_EVIDENCE_KIND'
  | 'EVIDENCE_PROVIDER_UNAVAILABLE'
  | 'EVIDENCE_RESOLVER_UNREGISTERED'
  | 'EVIDENCE_RESOLVER_UNAVAILABLE'
  | 'EVIDENCE_RESOLVER_VERSION_UNSUPPORTED'
  | 'EVIDENCE_SOURCE_SCOPE_MISMATCH'
  | 'EVIDENCE_LOCATOR_INVALID';
export interface OperateEvidenceImplementationRefV2 {
  id: string;
  version: string;
}
export type OperateEvidenceLocatorV2 =
  | {
      repositoryId: string;
      revision: string;
      objectType?: 'commit' | 'tree' | 'blob' | 'tag';
      path?: string;
      lines?: { start: number; end: number };
      ancestry?: { ancestorRevision: string };
    }
  | { sourceRootId: string; path: string }
  | {
      projectId: string;
      artifactId: string;
      artifactType: string;
      path?: string;
      contentHash?: string;
    }
  | {
      artifactId: string;
      expectedArtifactType: string;
      expectedSchemaId: string;
      expectedSchemaVersion: string;
      expectedRawHash?: string;
      expectedCanonicalHash?: string;
    };
export interface OperatingEvidenceCandidateV2 {
  kind: 'operating-evidence-candidate';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  candidateId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  sourceArtifactId: string;
  evidenceKind: OperateEvidenceKindV2;
  locator: OperateEvidenceLocatorV2;
  provider: OperateEvidenceImplementationRefV2;
  resolver: OperateEvidenceImplementationRefV2;
}
export type OperatingEvidenceRefV2 = Omit<OperatingEvidenceCandidateV2, 'kind'> & {
  kind: 'operating-evidence-ref';
  evidenceRefId: string;
  classification: OperateEvidenceClassificationV2;
  freshness: OperateEvidenceFreshnessV2;
  evidenceArtifactId: string;
  evidenceArtifactRawHash: string;
  evidenceArtifactCanonicalHash: string | null;
  resolvedAt: string;
};
export interface OperatingEvidenceResolutionV2 {
  kind: 'operating-evidence-resolution';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  resolutionId: string;
  candidateId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  sourceArtifactId: string;
  evidenceKind: OperateEvidenceKindV2;
  provider: OperateEvidenceImplementationRefV2;
  resolver: OperateEvidenceImplementationRefV2;
  outcome: 'resolved' | 'rejected';
  evidenceRefId: string | null;
  evidenceArtifactId: string | null;
  error: {
    code: OperateEvidenceResolverErrorCodeV2;
    retryable: boolean;
    context: Record<string, string>;
  } | null;
  resolvedAt: string;
}
export interface OperatingEvidenceEdgeV2 {
  kind: 'operating-evidence-edge';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  edgeId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  sourceArtifactId: string;
  localClaimId: string;
  relation: OperateEvidenceEdgeRelationV2;
  evidenceRefId: string;
  createdBy: { kind: 'runtime'; id: string };
  createdAt: string;
  confidence: number;
  classification: OperateEvidenceClassificationV2;
}
export interface OperatingEvidenceGraphV2 {
  kind: 'operating-evidence-graph';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  scopeId: string;
  domainId: string;
  domainVersion: string;
  generatedAt: string;
  evidenceRefs: OperatingEvidenceRefV2[];
  edges: OperatingEvidenceEdgeV2[];
}
export interface OperateEvidenceProviderRegistrationV2 {
  kind: 'operate-evidence-provider-registration';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  providerId: string;
  providerVersion: string;
  supportedEvidenceKinds: OperateEvidenceKindV2[];
  inputContract: { schemaId: 'operating-evidence-candidate'; schemaVersion: '2.0.0' };
  outputContract: { schemaId: 'operating-evidence-resolution'; schemaVersion: '2.0.0' };
  effectClass: 'local-read-only';
  requiredCapabilities: OperateEvidenceReadCapabilityV2[];
  classificationCeiling: OperateEvidenceClassificationV2;
  retentionClass: 'ephemeral' | 'project' | 'restricted-machine-local';
  provenance: { packageName: string; packageVersion: string; integrity: string };
  conformanceDigest: string;
  implementation: { kind: 'built-in'; id: string };
  fallback: { kind: 'unavailable'; errorCode: 'EVIDENCE_PROVIDER_UNAVAILABLE' };
}
export interface OperateEvidenceResolverRegistrationV2 {
  kind: 'operate-evidence-resolver-registration';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  resolverId: string;
  resolverVersion: string;
  supportedEvidenceKinds: OperateEvidenceKindV2[];
  inputContract: { schemaId: 'operating-evidence-candidate'; schemaVersion: '2.0.0' };
  outputContract: { schemaId: 'operating-evidence-resolution'; schemaVersion: '2.0.0' };
  evidenceRefContract: { schemaId: 'operating-evidence-ref'; schemaVersion: '2.0.0' };
  effectClass: 'local-read-only';
  requiredCapabilities: OperateEvidenceReadCapabilityV2[];
  classificationCeiling: OperateEvidenceClassificationV2;
  retentionClass: 'ephemeral' | 'project' | 'restricted-machine-local';
  errorCodes: OperateEvidenceResolverErrorCodeV2[];
  provenance: { packageName: string; packageVersion: string; integrity: string };
  conformanceDigest: string;
  implementation: { kind: 'built-in'; id: string };
  fallback: { kind: 'unavailable'; errorCode: 'EVIDENCE_RESOLVER_UNAVAILABLE' };
}

export interface OperateDomainContractBindingV2 {
  apiDomainId: string;
  id: string;
  version: string;
}
/** Explicit public API-domain identity; domain names are never derived by convention. */
export interface PublicOperateDomainContractBindingV2 extends OperateDomainContractBindingV2 {
  apiDomainId: 'business' | 'software';
  id: 'business-domain' | 'software-domain';
  version: '1.0.0';
}
export interface OperatingObjectiveV2 {
  kind: 'operating-objective';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  objectiveId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  title: string;
  status: 'open' | 'at-risk' | 'achieved' | 'deferred' | 'superseded';
  ownerActorId: string | null;
  horizon: string;
  successCriteria: string[];
  metricIds: string[];
  evidenceRefIds: string[];
  sourceArtifactId: string;
  createdAt: string;
  updatedAt: string;
}
export interface OperatingMetricV2 {
  kind: 'operating-metric';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  metricId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  title: string;
  unit: string;
  aggregation: 'latest' | 'sum' | 'average' | 'minimum' | 'maximum' | 'ratio';
  window: string;
  target: number | null;
  threshold: number | null;
  observationIds: string[];
  freshness: 'current' | 'historical' | 'stale' | 'unknown';
  evidenceRefIds: string[];
  sourceArtifactId: string;
  createdAt: string;
  updatedAt: string;
}
export interface OperatingMetricObservationV2 {
  kind: 'operating-metric-observation';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  observationId: string;
  metricId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  value: number;
  unit: string;
  observedAt: string;
  snapshotId: string;
  evidenceRefIds: string[];
  sourceArtifactId: string;
}
export interface OperatingRiskBaseV2 {
  kind: 'operating-risk';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  riskId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  title: string;
  statement: string;
  state: 'open' | 'monitoring' | 'mitigated' | 'closed' | 'superseded';
  likelihood: number;
  impact: number;
  exposure: number;
  ownerActorId: string | null;
  mitigations: string[];
  triggerIds: string[];
  evidenceRefIds: string[];
  sourceArtifactId: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  revisionId: string;
  revision: number;
  predecessorRevisionId: string | null;
}
export interface OperatingGenericRiskV2 extends OperatingRiskBaseV2 {
  origin: 'generic';
}
export interface OperatingIntelligenceRiskV2 extends OperatingRiskBaseV2 {
  origin: 'operating-intelligence';
  sourceCycleId: string;
  sourceAssignmentId: string;
  sourceLocalRiskId: string;
  sourceClaimIds: string[];
  sourceImpact: OperatingFindingSeverityV2;
  exposureStatement: string;
  exposedSurfaces: string[];
  mitigation: string;
  reversibility: string;
}
export type OperatingRiskV2 = OperatingGenericRiskV2 | OperatingIntelligenceRiskV2;
export interface OperatingAssumptionV2 {
  kind: 'operating-assumption';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  assumptionId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  statement: string;
  confidence: number;
  status: 'active' | 'validated' | 'invalidated' | 'closed' | 'superseded';
  invalidationConditions: string[];
  affectedDecisionIds: string[];
  affectedActionIds: string[];
  evidenceRefIds: string[];
  sourceArtifactId: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  revisionId: string;
  revision: number;
  predecessorRevisionId: string | null;
}
export interface OperatingClaimV2 {
  kind: 'operating-claim';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  claimId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  statement: string;
  epistemicStatus: 'known' | 'strongly-supported' | 'probable' | 'speculative' | 'unknown';
  confidence: number;
  supportingEvidenceRefIds: string[];
  contradictingEvidenceRefIds: string[];
  assumptionIds: string[];
  changeCondition: string;
  sourceArtifactId: string;
  createdAt: string;
}
export interface OperatingModelStateV2 {
  kind: 'operating-model-state';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  stateId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  snapshotId: string;
  runtimeHash: string;
  objectives: OperatingObjectiveV2[];
  metrics: OperatingMetricV2[];
  findings: OperatingFindingV2[];
  decisions: OperatingDecisionV2[];
  actions: OperatingActionV2[];
  risks: OperatingRiskV2[];
  assumptions: OperatingAssumptionV2[];
  generatedAt: string;
}
export interface OperatingSnapshotV2 {
  kind: 'operating-snapshot';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  snapshotId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  domainContract: OperateDomainContractBindingV2;
  stateId: string;
  runtimeHash: string;
  previousSnapshotId: string | null;
  sourceArtifactIds: string[];
  evidenceRefIds: string[];
  sourceRevisions: Array<{ sourceArtifactId: string; revision: string; evidenceRefIds?: string[] }>;
  createdAt: string;
}
export interface OperatingDomainProjectionV2 {
  kind: 'operating-domain-projection';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  projectionId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  domainContract: OperateDomainContractBindingV2;
  snapshotId: string;
  stateId: string;
  sourceArtifactIds: string[];
  projectionContract: { schemaId: string; schemaVersion: string };
  derivedAt: string;
}
export interface BusinessOperatingSnapshotProjectionV2
  extends Omit<OperatingDomainProjectionV2, 'kind' | 'domainId' | 'domainContract'> {
  kind: 'business-operating-snapshot-projection';
  domainId: 'business';
  domainContract: { apiDomainId: 'business'; id: 'business-domain'; version: '1.0.0' };
}
export interface SoftwareOperatingSnapshotProjectionV2
  extends Omit<OperatingDomainProjectionV2, 'kind' | 'domainId' | 'domainContract'> {
  kind: 'software-operating-snapshot-projection';
  domainId: 'software';
  domainContract: { apiDomainId: 'software'; id: 'software-domain'; version: '1.0.0' };
}
export interface OperatingDeltaV2 {
  kind: 'operating-delta';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  deltaId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  priorSnapshotId: string | null;
  currentSnapshotId: string;
  sourceRevisionChanges: Array<{
    subjectId: string;
    kind: 'added' | 'removed' | 'changed' | 'stale' | 'conflict';
    evidenceRefIds?: string[];
  }>;
  metricChanges: Array<{
    subjectId: string;
    kind: 'added' | 'removed' | 'changed' | 'stale' | 'conflict';
    evidenceRefIds?: string[];
  }>;
  staleEvidenceRefIds: string[];
  conflictingEvidenceRefIds: string[];
  invalidatedAssumptionIds: string[];
  exposedRiskIds: string[];
  decisionRevisitIds: string[];
  sourceArtifactId: string;
  derivedAt: string;
}
export interface OperatingIntelligencePlanV2 {
  kind: 'operating-intelligence-plan';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  planId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  snapshotId: string;
  deltaId: string;
  selectedRoles: Array<{
    roleId: string;
    roleKind: 'advisor' | 'challenger' | 'chair';
    roleVersion: string;
    inputArtifactIds: string[];
    outputContract: { schemaId: string; schemaVersion: string };
    dependsOnRoleIds: string[];
    reason: string;
  }>;
  omittedRoles: Array<{
    roleId: string;
    roleKind: 'advisor' | 'challenger' | 'chair';
    roleVersion: string;
    reason: string;
  }>;
  challengerRequired: boolean;
  scenarioRequest: { requested: boolean; reason: string };
  sourceArtifactId: string;
  decisionOwnerActorId: string;
  createdAt: string;
}

export interface OperatingStateProjectionRecordV2 {
  recordId: string;
  recordKind: 'objective' | 'metric' | 'finding' | 'decision' | 'action' | 'risk' | 'assumption';
  title: string;
  state: string;
  evidenceRefIds: string[];
}

export interface OperatingIntelligenceInputBundleV2 {
  kind: 'operating-intelligence-input-bundle';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  bundleId: string;
  cycleId: string;
  snapshotId: string;
  deltaId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  snapshot: OperatingSnapshotV2;
  delta: OperatingDeltaV2;
  operatingState: {
    kind: 'operating-state-projection';
    schemaVersion: '1.0.0';
    protocolVersion: '2.0.0';
    sourceStateId: string;
    sourceRuntimeHash: string;
    scopeId: string;
    domainId: string;
    domainVersion: string;
    snapshotId: string;
    selectionPolicy: 'deterministic-priority-v1';
    objectives: OperatingStateProjectionRecordV2[];
    metrics: OperatingStateProjectionRecordV2[];
    findings: OperatingStateProjectionRecordV2[];
    decisions: OperatingStateProjectionRecordV2[];
    actions: OperatingStateProjectionRecordV2[];
    risks: OperatingStateProjectionRecordV2[];
    assumptions: OperatingStateProjectionRecordV2[];
    coverage: Record<
      'objectives' | 'metrics' | 'findings' | 'decisions' | 'actions' | 'risks' | 'assumptions',
      { included: number; total: number; omitted: number }
    >;
    projectedAt: string;
  };
  sourceArtifactIds: string[];
  assignmentBinding: {
    assignmentId: string;
    roleId: string;
    roleKind: 'advisor' | 'challenger' | 'chair';
    roleVersion: string;
    analysisProfile: OperatingAnalysisProfileV2;
    evidenceRequirements: OperatingEvidenceRequirementV2[];
    resultRequirements: OperatingResultRequirementV2[];
    issuedEvidence: OperatingIssuedEvidenceV2[];
    evidenceAbsences: OperatingEvidenceInputAbsenceV2[];
  };
  createdAt: string;
}

export interface OperatingAdvisorQuestionAnswerV2 {
  questionId: string;
  answer: string;
  claimIds: string[];
  measurementIds: string[];
  riskIds: string[];
  evidenceRefIds: string[];
  absenceIds: string[];
}
export interface OperatingAdvisorProfileInsightV2 {
  localAnalysisId: string;
  title: string;
  statement: string;
  claimIds: string[];
  measurementIds: string[];
  riskIds: string[];
  alternativeIds: string[];
  evidenceRefIds: string[];
  absenceIds: string[];
}
type OperatingAdvisorProfileAnalysisV2 = {
  profileId:
    | 'strategy-finance'
    | 'technology-risk'
    | 'product-activation'
    | 'growth-market'
    | 'operations-customer'
    | 'software-delivery';
  executiveQuestionAnswers: OperatingAdvisorQuestionAnswerV2[];
} & Record<
  string,
  | OperatingAdvisorProfileInsightV2[]
  | OperatingAdvisorProfileInsightV2
  | null
  | string
  | OperatingAdvisorQuestionAnswerV2[]
>;
export interface OperatingAdvisorClaimV2 {
  localClaimId: string;
  statement: string;
  epistemicStatus: 'known' | 'strongly-supported' | 'probable' | 'speculative' | 'unknown';
  confidence: number;
  supportingEvidenceRefIds: string[];
  contradictingEvidenceRefIds: string[];
  assumptionIds: string[];
  changeCondition: string;
}
export type OperatingAdvisorMeasureKindV2 =
  | 'runway'
  | 'margin'
  | 'funnel'
  | 'channel-economics'
  | 'capacity'
  | 'throughput'
  | 'exposure'
  | 'scenario'
  | 'metric-trend';
export type OperatingAdvisorMeasurementV2 = {
  localMeasurementId: string;
  kind: OperatingAdvisorMeasureKindV2;
  name: string;
  period: string;
  evidenceRefIds: string[];
  interpretation: string;
  confidence: number;
} & Record<string, JsonValue>;
export interface OperatingAdvisorRiskV2 {
  localRiskId: string;
  title: string;
  statement: string;
  likelihood: number;
  impact: 'low' | 'medium' | 'high' | 'critical';
  exposure: string;
  exposedSurfaces: string[];
  claimIds: string[];
  evidenceRefIds: string[];
  mitigation: string;
  reversibility: string;
}
export interface OperatingAdvisorAlternativeV2 {
  localAlternativeId: string;
  title: string;
  description: string;
  supportingClaimIds: string[];
  evidenceRefIds: string[];
  tradeoffs: string[];
  costOfDelay: string;
  reversibility: string;
}
export interface OperatingIntelligenceGapV2 {
  localGapId: string;
  inputAbsenceId: string;
  requirementId: string;
  impact: string;
  recoveryPath: string;
}
export type OperatingChallengerGapV2 =
  | {
      localGapId: string;
      inputAbsenceId: string;
      kind: 'evidence';
      requirementId: string;
      impact: string;
      recoveryPath: string;
    }
  | {
      localGapId: string;
      inputAbsenceId: string;
      kind: 'role';
      roleId: string;
      roleKind: 'advisor' | 'challenger' | 'chair';
      roleVersion: string;
      sourceAssignmentId: string | null;
      impact: string;
      recoveryPath: string;
    };
export interface OperatingAdvisorRecommendationV2 {
  localRecommendationId: string;
  title: string;
  proposal: string;
  rationaleClaimIds: string[];
  alternativeIds: string[];
  riskIds: string[];
  confidence: number;
  expectedUpside: string;
  expectedDownside: string;
  uncertainty: string;
  reversibility: string;
  successMeasurementIds: string[];
  revisitConditions: string[];
}

export interface OperatingAdvisorResultV2 {
  kind: 'operating-advisor-result';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  assignmentId: string;
  roleId: string;
  roleVersion: string;
  analysisProfile: OperatingAnalysisProfileV2;
  intelligencePlanId: string;
  snapshotId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  outcome: 'recommendation' | 'partial' | 'quiet';
  summary: string;
  analysisMarkdown: string;
  inputAbsenceIds: string[];
  analysis: OperatingAdvisorProfileAnalysisV2;
  claims: OperatingAdvisorClaimV2[];
  measurements: OperatingAdvisorMeasurementV2[];
  risks: OperatingAdvisorRiskV2[];
  alternatives: OperatingAdvisorAlternativeV2[];
  gaps: OperatingIntelligenceGapV2[];
  recommendation: OperatingAdvisorRecommendationV2 | null;
}

export type OperatingContextCaptureV2 = {
  kind: 'operating-context-capture';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  scope: { scopeId: string; domainId: string; domainVersion: string };
} & (
  | { contextKind: 'cycle-evidence'; focus: string[]; trigger: { kind: 'manual' } }
  | {
      contextKind: 'cycle-manifest';
      evidenceCandidates: OperatingEvidenceCandidateV2[];
      evidenceClaimLinks: Array<{
        sourceArtifactId: string;
        localClaimId: string;
        relation: 'supportedBy' | 'contradictedBy';
        confidence: number;
      }>;
    }
);

export interface OperatingChallengerReviewV2 {
  kind: 'operating-challenger-review';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  assignmentId: string;
  roleId: string;
  roleVersion: string;
  analysisProfile: OperatingAnalysisProfileV2;
  intelligencePlanId: string;
  snapshotId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  summary: string;
  analysisMarkdown: string;
  inputAbsenceIds: string[];
  advisorArtifactIds: string[];
  reviewedClaims: Array<{ advisorArtifactId: string; localClaimId: string }>;
  questionCoverage: Array<{
    questionId: string;
    disposition: 'answered' | 'gap' | 'not-applicable';
    answer: string;
    findingIds: string[];
    alternativeIds: string[];
    dissentIds: string[];
    gapIds: string[];
    justification: string | null;
  }>;
  findings: Array<{
    localFindingId: string;
    title: string;
    statement: string;
    type:
      | 'unsupported'
      | 'contradicted'
      | 'correlated-reasoning'
      | 'missing-alternative'
      | 'unpriced-downside'
      | 'irreversibility-mismatch'
      | 'overconfidence'
      | 'scope-violation';
    severity: 'low' | 'medium' | 'high' | 'critical';
    confidence: number;
    targets: Array<{
      advisorArtifactId: string;
      analysisIds: string[];
      claimIds: string[];
      measurementIds: string[];
      riskIds: string[];
      recommendationIds: string[];
    }>;
    supportingEvidenceRefIds: string[];
    contradictingEvidenceRefIds: string[];
    rationale: string;
    correctionCondition: string;
  }>;
  missingAlternatives: Array<{
    localAlternativeId: string;
    title: string;
    description: string;
    targets: Array<{
      advisorArtifactId: string;
      analysisIds: string[];
      claimIds: string[];
      measurementIds: string[];
      riskIds: string[];
      recommendationIds: string[];
    }>;
    evidenceRefIds: string[];
    tradeoffs: string[];
  }>;
  dissent: Array<{
    localDissentId: string;
    findingIds: string[];
    statement: string;
    evidenceRefIds: string[];
    resolutionCondition: string;
  }>;
  gaps: OperatingChallengerGapV2[];
}

export function assertOperateIntelligencePlanContractV2(
  value: OperatingIntelligencePlanV2,
): OperatingIntelligencePlanV2;
export interface OperatingDecisionLedgerV2 {
  kind: 'operating-decision-ledger';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  assignmentId: string;
  roleId: string;
  roleVersion: string;
  analysisProfile: OperatingAnalysisProfileV2;
  ledgerId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  snapshotId: string;
  intelligencePlanId: string;
  summary: string;
  advisorArtifactIds: string[];
  challengerArtifactId: string | null;
  advisorAbsenceGaps: OperatingRoleInputAbsenceV2[];
  evidenceGaps: OperatingEvidenceInputAbsenceV2[];
  questionCoverage: Array<{
    questionId: string;
    disposition: 'answered' | 'gap' | 'not-applicable';
    answer: string;
    decisionIds: string[];
    findingIds: string[];
    dissentIds: string[];
    absenceIds: string[];
    justification: string | null;
  }>;
  decisions: Array<{
    localDecisionId: string;
    title: string;
    question: string;
    outcome: string;
    rationale: string;
    sourceClaimRefs: Array<{ advisorArtifactId: string; localClaimId: string }>;
    sourceRecommendationRefs: Array<{ advisorArtifactId: string; localRecommendationId: string }>;
    challengerFindingIds: string[];
    evidenceRefIds: string[];
    alternativeDispositions: Array<{
      sourceArtifactId: string;
      localAlternativeId: string;
      title: string;
      disposition: 'accepted' | 'rejected' | 'deferred';
      rationale: string;
    }>;
    confidence: number;
    assumptionIds: string[];
    upside: string;
    downside: string;
    uncertainty: string;
    reversibility: string;
    ownerActorId: string;
    revisitConditions: string[];
    dissentIds: string[];
    actionHypotheses: OperatingActionHypothesisV2[];
  }>;
  sourceDispositions: Array<{
    sourceArtifactId: string;
    sourceKind:
      | 'advisor-outcome'
      | 'advisor-recommendation'
      | 'challenger-finding'
      | 'challenger-dissent';
    localSourceId: string;
    sourceOutcome: 'partial' | 'quiet' | null;
    disposition: 'accepted' | 'rejected' | 'deferred' | 'noted';
    localDecisionId: string | null;
    rationale: string;
  }>;
  dissent: Array<{
    sourceArtifactId: string;
    localDissentId: string;
    findingIds: string[];
    statement: string;
    evidenceRefIds: string[];
    resolutionCondition: string;
  }>;
  sourceArtifactId: string;
}
export interface OperatingActionHypothesisV2 {
  localActionHypothesisId: string;
  title: string;
  objectiveId: string;
  ownerActorId: string | null;
  accountabilityDisposition: 'unowned' | 'blocked' | null;
  expectedResult: string;
  metricId: string;
  baseline: number;
  target: number;
  verificationWindow: string;
  verificationMethod: string;
  sourceClaimRefs: Array<{ advisorArtifactId: string; localClaimId: string }>;
  sourceFindingIds: string[];
  dependsOnActionHypothesisIds: string[];
}
export interface OperatingActionVerificationPlanV2 {
  kind: 'operating-action-verification-plan';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  verificationPlanId: string;
  actionId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  metricId: string;
  baseline: number;
  target: number;
  window: string;
  method: string;
  observationRequest: { kind: 'future-observation' | 'future-analysis'; reason: string };
  evaluationRules: string[];
  revisitDecisionIds: string[];
  sourceArtifactId: string;
  createdAt: string;
}
export interface OperatingOutcomeV2 {
  kind: 'operating-outcome';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  outcomeId: string;
  actionId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  verificationPlanId: string;
  status: 'succeeded' | 'failed' | 'blocked' | 'cancelled' | 'insufficient-evidence';
  observationIds: string[];
  evidenceRefIds: string[];
  sourceArtifactId: string;
  observedAt: string;
}
export interface OperatingLearningV2 {
  kind: 'operating-learning';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  learningId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  statement: string;
  outcomeId: string;
  assumptionIds: string[];
  decisionIds: string[];
  evidenceRefIds: string[];
  sourceArtifactId: string;
  createdAt: string;
}
export type OperatingExecutionVerificationStatusV2 =
  | 'success'
  | 'failure'
  | 'blocked'
  | 'uncertain'
  | 'partial'
  | 'cancelled'
  | 'rolled-back';
export type OperatingHypothesisVerificationStatusV2 =
  | 'pending'
  | 'confirmed'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'revisit';
export interface OperatingVerificationFeedbackV2 {
  actionId: string;
  verificationPlanId: string;
  executionStatus: OperatingExecutionVerificationStatusV2;
  hypothesisStatus: OperatingHypothesisVerificationStatusV2;
  executionCompleted: boolean;
  hypothesisConfirmed: boolean;
  revisit: boolean;
  cycleClosed: boolean;
  provenance: {
    outcomeId: string | null;
    learningId: string | null;
    deltaId: string | null;
    snapshotId: string | null;
    sourceArtifactId: string;
    observationIds: string[];
    evidenceRefIds: string[];
  };
}
export interface OperatingScenarioV2 {
  kind: 'operating-scenario';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  scenarioId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  snapshotId: string;
  base: OperatingScenarioCaseV2;
  upside: OperatingScenarioCaseV2;
  downside: OperatingScenarioCaseV2;
  breakEven: string;
  assumptionIds: string[];
  evidenceRefIds: string[];
  uncertainty: string;
  sourceArtifactId: string;
  createdAt: string;
}
export interface OperatingScenarioCaseV2 {
  statement: string;
  assumptionIds: string[];
  evidenceRefIds: string[];
  sourceArtifactId: string;
}
export interface OperatingEventTriggerV2 {
  kind: 'operating-event-trigger';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  triggerId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  snapshotId: string;
  condition: string;
  evidenceRefIds: string[];
  requestedWork: 'observation' | 'cycle';
  sourceArtifactId: string;
  createdAt: string;
}
export interface OperateSignalProviderRegistrationV2 {
  providerId: string;
  providerVersion: string;
  supportedDomains: Array<{
    apiDomainId: string;
    domainContractId: string;
    domainContractVersion: string;
  }>;
  inputContract: { schemaId: string; schemaVersion: '2.0.0' };
  outputContract: { schemaId: string; schemaVersion: '2.0.0' };
  accessMode: 'accepted-input-only' | 'declared-read-only';
  returnSemantics: 'candidate';
  errorCodes: Array<'OPERATING_PROVIDER_INPUT_INVALID' | 'OPERATING_PROVIDER_UNAVAILABLE'>;
  provenance: { packageName: string; packageVersion: string; integrity: string };
  conformanceDigest: string;
  implementation: { kind: 'built-in'; id: string };
  fallback: { kind: 'unavailable'; errorCode: 'OPERATING_PROVIDER_UNAVAILABLE' };
}
export interface OperateSnapshotProviderRegistrationV2 extends OperateSignalProviderRegistrationV2 {
  kind: 'operate-snapshot-provider-registration';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
}
export interface OperateMetricProviderRegistrationV2 extends OperateSignalProviderRegistrationV2 {
  kind: 'operate-metric-provider-registration';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
}
export interface OperateVerificationProviderRegistrationV2
  extends OperateSignalProviderRegistrationV2 {
  kind: 'operate-verification-provider-registration';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
}

export type OperateErrorCodeV2 =
  | 'ARTIFACT_NOT_FOUND'
  | 'ARTIFACT_HASH_MISMATCH'
  | 'ANCESTRY_MISMATCH'
  | 'ASSIGNMENT_ALREADY_CLAIMED'
  | 'ASSIGNMENT_ALREADY_SUBMITTED'
  | 'ASSIGNMENT_NOT_AVAILABLE'
  | 'CAPABILITY_DENIED'
  | 'CONCURRENT_MODIFICATION'
  | 'CONTRACT_VERSION_UNSUPPORTED'
  | 'CONSENT_REQUIRED'
  | 'CYCLE_NOT_FOUND'
  | 'CYCLE_TERMINAL'
  | 'DOMAIN_CONTRACT_UNSUPPORTED'
  | 'EVIDENCE_LOCATOR_INVALID'
  | 'EVIDENCE_PROVIDER_UNAVAILABLE'
  | 'EVIDENCE_RESOLUTION_FAILED'
  | 'EVIDENCE_RESOLVER_UNAVAILABLE'
  | 'EVIDENCE_RESOLVER_UNREGISTERED'
  | 'EVIDENCE_RESOLVER_VERSION_UNSUPPORTED'
  | 'EVIDENCE_SOURCE_SCOPE_MISMATCH'
  | 'LINE_RANGE_INVALID'
  | 'OBJECT_TYPE_MISMATCH'
  | 'OPERATING_PROVIDER_INPUT_INVALID'
  | 'OPERATING_PROVIDER_UNAVAILABLE'
  | 'OPERATING_SCOPE_INVALID'
  | 'PATH_NOT_FOUND'
  | 'REVIEW_NOT_AUTHORIZED'
  | 'REVIEW_NOT_FOUND'
  | 'REVIEW_NOT_PENDING'
  | 'RESULT_CONTRACT_INVALID'
  | 'REVISION_NOT_FOUND'
  | 'SECRET_DETECTED'
  | 'SENSITIVITY_BLOCKED'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_STALE'
  | 'SOURCE_UNTRACKED'
  | 'STATE_TRANSITION_INVALID'
  | 'SUBMISSION_ID_CONFLICT'
  | 'UNSUPPORTED_EVIDENCE_KIND'
  | 'ACTION_NOT_FOUND'
  | 'ACTION_REVISION_MISMATCH'
  | 'POLICY_EVALUATION_REJECTED'
  | 'POLICY_EVALUATION_DEFERRED'
  | 'POLICY_PROHIBITED'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_INVALID'
  | 'APPROVAL_EXPIRED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'CAPABILITY_GRANT_INVALID'
  | 'CAPABILITY_GRANT_CONSUMED'
  | 'CAPABILITY_PROVIDER_UNAVAILABLE'
  | 'POLICY_PROVIDER_UNAVAILABLE'
  | 'EXECUTOR_UNAVAILABLE'
  | 'OPERATION_CONFLICT'
  | 'OPERATION_UNCERTAIN'
  | 'ROLLBACK_NOT_ELIGIBLE';

export interface OperateToolRequestMapV2 {
  'operate.cycle.start': {
    scope: { scopeId: string; domainId: string; domainVersion: string };
    focus: string[];
    trigger: OperatePhase1TriggerV2;
    mode: 'standard' | 'preview';
    ownerActorId: string;
    deliveryRoute?: 'contained-execution' | 'planning-work' | 'human-external' | 'observe-only';
  };
  'operate.cycle.get': { cycleId: string };
  'operate.cycle.resume': { cycleId: string };
  'operate.assignment.claim': {
    assignmentId: string;
    actor: OperatePublicActorV2;
  };
  'operate.assignment.submit': {
    assignmentId: string;
    submissionId: string;
    actor: OperatePublicActorV2;
    mediaType: string;
    encoding: 'utf-8' | 'binary';
    contentBase64: string;
  };
  'operate.artifact.get': {
    artifactId: string;
    representation: 'raw' | 'canonical' | 'metadata' | 'decoded-json';
    actor: OperatePublicActorV2;
    scope: { scopeId: string; domainId: string; domainVersion: string };
    assignmentId: string | null;
  };
  'operate.review.get': {
    reviewId: string;
    cycleId: string;
    actor: OperatePublicActorV2 & { kind: 'human' };
    scope: { scopeId: string; domainId: string; domainVersion: string };
  };
  'operate.review.submit': {
    reviewId: string;
    cycleId: string;
    actor: OperatePublicActorV2 & { kind: 'human' };
    scope: { scopeId: string; domainId: string; domainVersion: string };
    disposition: Exclude<OperatingReviewStateV2, 'pending'>;
    workDispositions: OperatingWorkDispositionV2[];
  };
  'operate.action.approve': {
    action: OperateActionIdentityV2;
    decision: 'approved' | 'rejected' | 'deferred';
  };
  'operate.action.execute': { action: OperateActionIdentityV2 };
  'operate.action.rollback': {
    action: OperateActionIdentityV2;
    originalOperationId: string;
    rollbackPlanId: string;
  };
}

export type OperateAllowedActionV2<TTool extends OperateToolNameV2 = OperateToolNameV2> = {
  [TCurrentTool in TTool]: {
    tool: TCurrentTool;
    arguments: OperateToolRequestMapV2[TCurrentTool];
    label: string;
    effect: 'read-only' | 'machine-local-write' | 'project-write';
  };
}[TTool];

export interface OperatePublicActorV2 {
  actorId: string;
  kind: 'agent' | 'human';
  runtime: string;
}

export interface OperateErrorContextV2 {
  operation?: string;
  cycleId?: string;
  assignmentId?: string;
  submissionId?: string;
  submissionState?: string;
  reviewId?: string;
  ownerActorId?: string;
  state?: string;
  maxBytes?: number;
}

export interface OperateErrorV2 {
  code: OperateErrorCodeV2;
  message: string;
  retryable: boolean;
  context: OperateErrorContextV2;
}

export interface OperatingCycleViewV2 {
  cycle: OperatingCycleV2;
  progress: {
    total: number;
    pending: number;
    available: number;
    active: number;
    submitted: number;
    validated: number;
    rejected: number;
    terminal: number;
  };
  availableAssignments: OperatingAssignmentV2[];
  acceptedArtifactIds: string[];
  persistentWork: {
    ledger: OperatingWorkLedgerV2;
    cycleLinks: OperatingWorkCycleLinkV2[];
  };
  actions: OperateAllowedActionV2[];
}

export interface OperatingAssignmentClaimV2 {
  assignment: OperatingAssignmentV2 & { state: 'running' };
  capabilities: string[];
  submissionId: string;
}

export interface OperatingSubmissionAcceptanceV2 {
  accepted: true;
  artifactId: string;
  rawHash: string;
  sizeBytes: number;
  assignmentState: 'validated';
}

export interface OperatingReviewDecisionSummaryBaseV2 {
  decisionId: string;
  title: string;
  question: string;
  outcome: string | null;
  rationale: string;
  confidence: number;
  ownerActorId: string;
  expectedUpside: string;
  expectedDownside: string;
  revisitConditions: string[];
  dissent: string[];
  evidenceRefIds: string[];
}
export interface OperatingReviewPersistentWorkDecisionSummaryV2
  extends OperatingReviewDecisionSummaryBaseV2 {
  origin: 'persistent-work';
}
export interface OperatingReviewIntelligenceDecisionSummaryV2
  extends OperatingReviewDecisionSummaryBaseV2 {
  origin: 'operating-intelligence';
  uncertainty: string;
  reversibility: string;
  dissentIds: string[];
}
export type OperatingReviewDecisionSummaryV2 =
  | OperatingReviewPersistentWorkDecisionSummaryV2
  | OperatingReviewIntelligenceDecisionSummaryV2;

export interface OperatingReviewFindingSummaryBaseV2 {
  findingId: string;
  title: string;
  statement: string;
  state: OperatingFindingStateV2;
  ownerActorId: string | null;
  revisitAt: string | null;
}
export interface OperatingReviewPersistentWorkFindingSummaryV2
  extends OperatingReviewFindingSummaryBaseV2 {
  origin: 'persistent-work';
}
export interface OperatingReviewIntelligenceFindingSummaryV2
  extends OperatingReviewFindingSummaryBaseV2 {
  origin: 'operating-intelligence';
  findingType: OperatingFindingTypeV2;
  severity: OperatingFindingSeverityV2;
  confidence: number;
  supportingEvidenceRefIds: string[];
  contradictingEvidenceRefIds: string[];
}
export type OperatingReviewFindingSummaryV2 =
  | OperatingReviewPersistentWorkFindingSummaryV2
  | OperatingReviewIntelligenceFindingSummaryV2;

export interface OperatingReviewRoleGapSummaryV2 {
  absenceId: string;
  kind: 'role';
  roleId: string;
  roleKind: 'advisor' | 'challenger' | 'chair';
  roleVersion: string;
  sourceAssignmentId: string | null;
  reason: string;
  recoveryDisposition: string;
}

export interface OperatingReviewEvidenceGapSummaryV2 {
  absenceId: string;
  kind: 'evidence';
  requirementId: string;
  sourceContracts: OperateVersionedIdentityV2[];
  reason: string;
  recoveryDisposition: string;
}

export type OperatingReviewGapSummaryV2 =
  | OperatingReviewRoleGapSummaryV2
  | OperatingReviewEvidenceGapSummaryV2;

export interface OperatingReviewReadV2 {
  kind: 'operating-review-read';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  cycleId: string;
  eventHead: { sequence: number; hash: string | null };
  scope: { scopeId: string; domainId: string; domainVersion: string };
  reader: OperatePublicActorV2 & { kind: 'human' };
  review: OperatingReviewV2;
  seatStatus: Array<{
    roleId: string;
    roleKind: 'advisor' | 'challenger' | 'chair';
    roleVersion: string;
    state: 'pending' | 'available' | 'running' | 'validated' | 'rejected' | 'abandoned' | 'failed';
    artifactId: string | null;
    absenceIds: string[];
  }>;
  decisions: OperatingReviewDecisionSummaryV2[];
  actions: Array<{
    actionId: string;
    title: string;
    state: OperatingActionStateV2;
    ownerActorId: string | null;
    sourceDecisionId: string | null;
    expectedResult: string;
    metricId: string | null;
    baseline: number | null;
    target: number | null;
    verificationWindow: string;
    verificationMethod: string;
  }>;
  findings: OperatingReviewFindingSummaryV2[];
  dissent: Array<{
    sourceArtifactId: string;
    localDissentId: string;
    statement: string;
    resolutionCondition: string;
  }>;
  gaps: OperatingReviewGapSummaryV2[];
  dispositionChoices: Array<{
    choiceId: string;
    choiceHash: string;
    label: string;
    submitArguments: OperateToolRequestMapV2['operate.review.submit'];
  }>;
  readAt: string;
}

export interface OperateReviewBoundSubmissionV1 {
  kind: 'operate-review-bound-submission';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  expectedReadEventHead: { sequence: number; hash: string | null };
  choiceId: string;
  choiceHash: string;
  submitArguments: OperateToolRequestMapV2['operate.review.submit'];
  note: string | null;
  boundSubmissionHash: string;
}

export interface OperatingReviewReceiptV2 {
  kind: 'operating-review-receipt';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  receiptId: string;
  cycleId: string;
  readEventHead: { sequence: number; hash: string | null };
  eventHead: { sequence: number; hash: string | null };
  scope: { scopeId: string; domainId: string; domainVersion: string };
  actor: OperatePublicActorV2 & { kind: 'human' };
  review: OperatingReviewV2;
  decision: Exclude<OperatingReviewStateV2, 'pending'>;
  seatStatus: OperatingReviewReadV2['seatStatus'];
  decisions: OperatingReviewReadV2['decisions'];
  actions: OperatingReviewReadV2['actions'];
  findings: OperatingReviewReadV2['findings'];
  dissent: OperatingReviewReadV2['dissent'];
  gaps: OperatingReviewReadV2['gaps'];
  dispositionChoices: OperatingReviewReadV2['dispositionChoices'];
  appliedChoiceId: string;
  appliedChoiceHash: string;
  appliedWorkDispositions: OperatingWorkDispositionV2[];
  boundSubmission?: OperateReviewBoundSubmissionV1;
  summary: {
    decisionCount: number;
    actionCount: number;
    findingCount: number;
    dissentCount: number;
    gapCount: number;
    message: string;
  };
  committedAt: string;
}

export interface OperatingActionApprovalV2 {
  action: OperatingActionV2;
  evaluation: OperatingPolicyEvaluationV2;
  requirements: OperatingApprovalRequirementV2[];
  approvals: OperatingApprovalRecordV2[];
}

export type OperatingArtifactRepresentationV2 =
  | { metadata: OperatingArtifactV2; representation: 'metadata' }
  | { metadata: OperatingArtifactV2; representation: 'raw' | 'canonical'; contentBase64: string }
  | { metadata: OperatingArtifactV2; representation: 'decoded-json'; contentJson: JsonValue };

export interface OperateToolResponseMapV2 {
  'operate.cycle.start': OperatingCycleViewV2;
  'operate.cycle.get': OperatingCycleViewV2;
  'operate.cycle.resume': OperatingCycleViewV2;
  'operate.assignment.claim': OperatingAssignmentClaimV2;
  'operate.assignment.submit': OperatingSubmissionAcceptanceV2;
  'operate.artifact.get': OperatingArtifactRepresentationV2;
  'operate.review.get': OperatingReviewReadV2;
  'operate.review.submit': OperatingReviewReceiptV2;
  'operate.action.approve': OperatingActionApprovalV2;
  'operate.action.execute': OperatingGovernedOperationV2;
  'operate.action.rollback': OperatingGovernedOperationV2;
}

export type OperateApiSuccessV2<TTool extends OperateToolNameV2 = OperateToolNameV2> = {
  [TCurrentTool in TTool]: {
    ok: true;
    operation: TCurrentTool;
    data: OperateToolResponseMapV2[TCurrentTool];
    allowedActions: OperateAllowedActionV2[];
  };
}[TTool];

export type OperateApiFailureV2<TTool extends OperateToolNameV2 = OperateToolNameV2> = {
  [TCurrentTool in TTool]: {
    ok: false;
    operation: TCurrentTool;
    error: OperateErrorV2;
    allowedActions: OperateAllowedActionV2[];
  };
}[TTool];

export type OperateApiEnvelopeV2<TTool extends OperateToolNameV2 = OperateToolNameV2> =
  | OperateApiSuccessV2<TTool>
  | OperateApiFailureV2<TTool>;

export type OperateToolCallV2 = {
  [TTool in OperateToolNameV2]:
    | {
        kind: 'operate-tool-call';
        schemaVersion: '1.0.0';
        protocolVersion: '2.0.0';
        direction: 'request';
        operation: TTool;
        request: OperateToolRequestMapV2[TTool];
      }
    | {
        kind: 'operate-tool-call';
        schemaVersion: '1.0.0';
        protocolVersion: '2.0.0';
        direction: 'response';
        operation: TTool;
        response: OperateApiEnvelopeV2<TTool>;
      };
}[OperateToolNameV2];

export type OperatingEventTypeV2 =
  | 'cycle.input-bound'
  | 'assignment.created'
  | 'assignment.available'
  | 'assignment.claimed'
  | 'assignment.started'
  | 'assignment.submitted'
  | 'artifact.created'
  | 'assignment.validated'
  | 'assignment.rejected'
  | 'assignment.abandoned'
  | 'assignment.failed'
  | 'executive-board.materialized'
  | 'review.created'
  | 'review.submitted'
  | 'work-change-set.materialized'
  | 'action.authority-promoted'
  | 'evidence.resolved'
  | 'evidence.rejected'
  | 'operating-state.materialized'
  | 'snapshot.materialized'
  | 'metric.observed'
  | 'claim.recorded'
  | 'finding.recorded'
  | 'risk.recorded'
  | 'assumption.recorded'
  | 'decision.revised'
  | 'delta.derived'
  | 'intelligence.plan-recorded'
  | 'decision-ledger.materialized'
  | 'verification.plan-recorded'
  | 'outcome.recorded'
  | 'learning.recorded'
  | 'scenario.recorded'
  | 'trigger.recorded'
  | 'domain-projection.rebuilt'
  | 'policy.evaluated'
  | 'approval.recorded'
  | 'capability.availability-recorded'
  | 'capability.granted'
  | 'operation.intent-recorded'
  | 'execution.result-recorded'
  | 'rollback.plan-recorded'
  | 'rollback.result-recorded'
  | 'action.approved'
  | 'action.cancelled'
  | 'action.rejected'
  | 'action.deferred'
  | 'action.reopened'
  | 'action.queued'
  | 'action.started'
  | 'action.completed'
  | 'action.blocked'
  | 'cycle.approved'
  | 'cycle.executing'
  | 'cycle.verifying'
  | 'cycle.closed';

export interface OperatingIntelligenceEventPayloadV2<TRecord> {
  snapshotId: string;
  stateId: string;
  record: TRecord;
}

export interface OperatingEventPayloadMapV2 {
  'cycle.input-bound': {
    inputBindingId: string;
    scopeId: string;
    domainId: string;
    domainVersion: string;
    contractVersions: Record<string, string>;
  };
  'assignment.created': OperatingAssignmentV2 & {
    state: 'pending';
    availableAt: null;
    completedAt: null;
    claim: null;
  };
  'assignment.available': {
    assignmentId: string;
    releaseId: string;
    dependencyProofs: Array<
      | { assignmentId: string; outcome: 'validated'; eventId: string; artifactId: string }
      | {
          assignmentId: string;
          outcome: 'abandoned' | 'failed';
          eventId: string;
          absence: { code: string; reason: string; recoveryDisposition: string };
        }
    >;
    dependencyEventIds: string[];
  };
  'assignment.claimed': {
    assignmentId: string;
    actorId: string;
    actorKind: 'agent' | 'human';
    runtime: string;
    claimId: string;
    submissionId: string;
  };
  'assignment.started': { assignmentId: string; attempt: number };
  'assignment.submitted': {
    assignmentId: string;
    submissionId: string;
    rawHash: string;
    canonicalHash: string | null;
    sizeBytes: number;
    mediaType: string;
    encoding: 'utf-8' | 'binary';
  };
  'artifact.created': OperatingArtifactV2;
  'assignment.validated': {
    assignmentId: string;
    submissionId: string;
    artifactId: string;
    validatorVersion: string;
  };
  'assignment.rejected': {
    assignmentId: string;
    submissionId: string;
    violations: Array<{ path: string; code: string; message: string }>;
    attempt: number;
    attemptsRemaining: number;
  };
  'assignment.abandoned': {
    assignmentId: string;
    reasonCode: string;
    reason: string;
    recoveryDisposition: string;
  };
  'assignment.failed': {
    assignmentId: string;
    errorCode: string;
    reason: string;
    recoveryStatus: string;
  };
  'executive-board.materialized': OperatingExecutiveBoardMaterializedV2;
  'review.created': OperatingReviewV2 & {
    state: 'pending';
    disposition: null;
    workDispositions: [];
  };
  'review.submitted': {
    reviewId: string;
    disposition: Exclude<OperatingReviewStateV2, 'pending'>;
    workDispositions: OperatingWorkDispositionV2[];
    receiptProjection: {
      read: OperatingReviewReadV2;
      appliedChoiceId: string;
      appliedChoiceHash: string;
      boundSubmission?: OperateReviewBoundSubmissionV1;
    };
  };
  'work-change-set.materialized': OperatingWorkChangeSetMaterializationV2;
  'action.authority-promoted': {
    before: OperatingActionV2;
    authority: {
      actionKind: OperateVersionedIdentityV2;
      requestedCapability: OperateVersionedIdentityV2;
      targetBinding: OperateTargetBindingV2;
      effectClass: OperateGovernedEffectClassV2;
      preconditionArtifactIds: string[];
      executionBinding: {
        policyId: string;
        policyVersion: string;
        rollbackRequired: boolean;
        verificationRequired: true;
      };
      updatedAt: string;
    };
    action: OperatingActionV2;
  };
  'evidence.resolved': {
    resolution: OperatingEvidenceResolutionV2 & {
      outcome: 'resolved';
      evidenceRefId: string;
      evidenceArtifactId: string;
      error: null;
    };
    evidenceRef: OperatingEvidenceRefV2;
    evidenceArtifact: OperatingArtifactV2;
    edges: OperatingEvidenceEdgeV2[];
    requestHash: string;
    outcomeHash: string;
  };
  'evidence.rejected': {
    resolution: OperatingEvidenceResolutionV2 & {
      outcome: 'rejected';
      evidenceRefId: null;
      evidenceArtifactId: null;
      error: NonNullable<OperatingEvidenceResolutionV2['error']>;
    };
    requestHash: string;
    outcomeHash: string;
  };
  'operating-state.materialized': OperatingModelStateV2;
  'snapshot.materialized': OperatingSnapshotV2;
  'metric.observed': OperatingIntelligenceEventPayloadV2<OperatingMetricObservationV2>;
  'claim.recorded': OperatingIntelligenceEventPayloadV2<OperatingClaimV2>;
  'finding.recorded': OperatingIntelligenceEventPayloadV2<OperatingFindingV2>;
  'risk.recorded': OperatingIntelligenceEventPayloadV2<OperatingRiskV2>;
  'assumption.recorded': OperatingIntelligenceEventPayloadV2<OperatingAssumptionV2>;
  'decision.revised': OperatingIntelligenceEventPayloadV2<OperatingDecisionV2>;
  'delta.derived': OperatingIntelligenceEventPayloadV2<OperatingDeltaV2>;
  'intelligence.plan-recorded': OperatingIntelligencePlanV2;
  'decision-ledger.materialized': OperatingDecisionLedgerV2;
  'verification.plan-recorded': OperatingActionVerificationPlanV2;
  'outcome.recorded': OperatingOutcomeV2;
  'learning.recorded': OperatingLearningV2;
  'scenario.recorded': OperatingIntelligenceEventPayloadV2<OperatingScenarioV2>;
  'trigger.recorded': OperatingIntelligenceEventPayloadV2<OperatingEventTriggerV2>;
  'domain-projection.rebuilt': OperatingDomainProjectionV2;
  'policy.evaluated': OperatingPolicyEvaluationV2;
  'approval.recorded': OperatingApprovalRecordV2;
  'capability.availability-recorded': OperatingCapabilityAvailabilityV2;
  'capability.granted': OperatingCapabilityGrantV2;
  'operation.intent-recorded': {
    operation: OperatingGovernedOperationV2;
    request: {
      payload: { artifactId: string; contentHash: string };
      rollbackBaseline: { artifactId: string; contentHash: string } | null;
      targetBeforeHash: string;
    };
    terminal: {
      resultId: string;
      resultArtifactId: string;
      submissionId: string;
      eventIds: {
        submitted: string;
        artifactCreated: string;
        validated: string;
        resultRecorded: string;
      };
      completedAt: string;
      correlationId: string;
      uncertainty: {
        resultId: string;
        resultArtifactId: string;
        submissionId: string;
        eventIds: {
          submitted: string;
          artifactCreated: string;
          validated: string;
          resultRecorded: string;
        };
      };
    };
  };
  'execution.result-recorded': {
    result: OperatingExecutionResultV2;
    receipt: OperatingExecutionReceiptProofV2 | null;
  };
  'rollback.plan-recorded': OperatingRollbackPlanV2;
  'rollback.result-recorded': OperatingRollbackResultV2;
  'action.approved': OperatingActionApprovedPayloadV2;
  'action.cancelled': OperatingActionCancelledPayloadV2;
  'action.rejected': OperatingActionRejectedPayloadV2;
  'action.deferred': OperatingActionDeferredPayloadV2;
  'action.reopened': OperatingActionReopenedPayloadV2;
  'action.queued': OperatingActionQueuedPayloadV2;
  'action.started': OperatingActionStartedPayloadV2;
  'action.completed': OperatingActionCompletedPayloadV2;
  'action.blocked': OperatingActionBlockedPayloadV2;
  'cycle.approved': OperatingCycleApprovedPayloadV2;
  'cycle.executing': OperatingCycleExecutingPayloadV2;
  'cycle.verifying': OperatingCycleVerifyingPayloadV2;
  'cycle.closed': OperatingCycleClosedPayloadV2;
}

export interface OperatingActionTransitionPayloadV2<
  TFrom extends OperatingActionStateV2,
  TTo extends OperatingActionStateV2,
> {
  action: OperateActionIdentityV2;
  from: TFrom;
  to: TTo;
  operationId: string | null;
  resultId: string | null;
  reasonCode: string | null;
}
export interface OperatingCycleTransitionPayloadV2<
  TFrom extends OperatingCycleV2['state'],
  TTo extends OperatingCycleV2['state'],
> {
  cycleId: string;
  from: TFrom;
  to: TTo;
  actionId: string | null;
  operationId: string | null;
  resultId: string | null;
  reasonCode: string | null;
}
export type OperatingActionApprovedPayloadV2 = OperatingActionTransitionPayloadV2<
  'proposed',
  'approved'
> & { operationId: null; resultId: null; reasonCode: null };
export type OperatingActionCancelledPayloadV2 =
  | (OperatingActionTransitionPayloadV2<'approved', 'cancelled'> & {
      operationId: null;
      resultId: null;
      reasonCode: string;
    })
  | (OperatingActionTransitionPayloadV2<'queued' | 'in_progress', 'cancelled'> & {
      operationId: string;
      resultId: null;
      reasonCode: string;
    });
export type OperatingActionRejectedPayloadV2 = OperatingActionTransitionPayloadV2<
  'proposed',
  'rejected'
> & { operationId: null; resultId: null; reasonCode: string };
export type OperatingActionDeferredPayloadV2 = OperatingActionTransitionPayloadV2<
  'proposed',
  'deferred'
> & { operationId: null; resultId: null; reasonCode: string };
export type OperatingActionReopenedPayloadV2 = OperatingActionTransitionPayloadV2<
  'deferred',
  'proposed'
> & { operationId: null; resultId: null; reasonCode: null };
export type OperatingActionQueuedPayloadV2 =
  | (OperatingActionTransitionPayloadV2<'approved', 'queued'> & {
      operationId: string;
      resultId: null;
      reasonCode: null;
    })
  | (OperatingActionTransitionPayloadV2<'blocked', 'queued'> & {
      operationId: string;
      resultId: string;
      reasonCode: string;
    });
export type OperatingActionStartedPayloadV2 =
  | (OperatingActionTransitionPayloadV2<'queued', 'in_progress'> & {
      operationId: string;
      resultId: null;
      reasonCode: null;
    })
  | (OperatingActionTransitionPayloadV2<'blocked', 'in_progress'> & {
      operationId: string;
      resultId: string;
      reasonCode: string;
    });
export type OperatingActionCompletedPayloadV2 = OperatingActionTransitionPayloadV2<
  'in_progress',
  'completed'
> & { operationId: string; resultId: string; reasonCode: null };
export type OperatingActionBlockedPayloadV2 = OperatingActionTransitionPayloadV2<
  'queued' | 'in_progress',
  'blocked'
> & { operationId: string; resultId: string; reasonCode: string };
export type OperatingCycleApprovedPayloadV2 = OperatingCycleTransitionPayloadV2<
  'awaiting_review',
  'approved'
> & { actionId: null; operationId: null; resultId: null; reasonCode: null };
export type OperatingCycleExecutingPayloadV2 = OperatingCycleTransitionPayloadV2<
  'approved',
  'executing'
> & { actionId: string; operationId: string; resultId: null; reasonCode: null };
export type OperatingCycleVerifyingPayloadV2 =
  | (OperatingCycleTransitionPayloadV2<'executing', 'verifying'> & {
      actionId: string;
      operationId: string;
      resultId: string;
      reasonCode: null;
    })
  | (OperatingCycleTransitionPayloadV2<'approved', 'verifying'> & {
      actionId: string;
      operationId: null;
      resultId: null;
      reasonCode: string;
    });
export type OperatingCycleClosedPayloadV2 =
  | (OperatingCycleTransitionPayloadV2<'verifying', 'closed'> & {
      actionId: string;
      operationId: string;
      resultId: string;
      reasonCode: string | null;
    })
  | (OperatingCycleTransitionPayloadV2<'verifying', 'closed'> & {
      actionId: string;
      operationId: null;
      resultId: null;
      reasonCode: string;
    })
  | (OperatingCycleTransitionPayloadV2<'approved', 'closed'> & {
      actionId: null;
      operationId: null;
      resultId: null;
      reasonCode: string;
    });

export interface OperatingEventBaseV2 {
  kind: 'operating-event';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  eventId: string;
  sequence: number;
  timestamp: string;
  cycleId: string;
  entityId: string;
  actor: { kind: 'human' | 'engine' | 'runtime'; id: string };
  causationId: string | null;
  correlationId: string;
  previousEventHash: string | null;
  requestHash?: string;
  eventHash: string;
}

export type OperatingEventV2<TEvent extends OperatingEventTypeV2 = OperatingEventTypeV2> = {
  [TCurrentEvent in TEvent]: OperatingEventBaseV2 & {
    type: TCurrentEvent;
    payload: OperatingEventPayloadMapV2[TCurrentEvent];
  };
}[TEvent];

export interface OperatingSubmissionReplayEntryV2 {
  submissionId: string;
  assignmentId: string;
  rawHash: string;
  canonicalHash: string | null;
  sizeBytes: number;
  artifactId: string;
  acceptanceEventIds: string[];
  responseData: JsonValue;
}

export interface OperatingReviewReceiptReplayProjectionV2 {
  read: OperatingReviewReadV2;
  appliedChoiceId: string;
  appliedChoiceHash: string;
  boundSubmission?: OperateReviewBoundSubmissionV1;
}

interface OperatingEventReplayEntryBaseV2 {
  eventId: string;
  eventHash: string;
  payloadHash: string;
  sequence: number;
  cycleId: string;
  entityId: string;
  timestamp: string;
  actor: { kind: 'human' | 'engine' | 'runtime'; id: string };
  causationId: string | null;
  correlationId: string;
  previousEventHash: string | null;
  requestHash?: string;
}

export type OperatingEventReplayEntryV2 = OperatingEventReplayEntryBaseV2 &
  (
    | { type: 'review.submitted'; receiptProjection: OperatingReviewReceiptReplayProjectionV2 }
    | { type: Exclude<OperatingEventTypeV2, 'review.submitted'>; receiptProjection?: never }
  );

export interface OperatingExecutionReceiptProofV2 {
  operationId: string;
  requestFingerprint: string;
  target: { kind: string; id: string };
  before: { revision: string; stateHash: string };
  after: { revision: string; stateHash: string };
  changed: boolean;
  synthetic: boolean;
  effectCount: 1;
}

export interface OperatingWorkChangeSetReplayEntryV2 {
  artifactId: string;
  canonicalHash: string;
  eventId: string;
  findingIds: string[];
  decisionIds: string[];
  actionIds: string[];
}

export interface OperatingEvidenceResolutionReplayEntryV2 {
  resolutionId: string;
  candidateId: string;
  sourceArtifactId: string;
  outcome: 'resolved' | 'rejected';
  evidenceRefId: string | null;
  evidenceArtifactId: string | null;
  eventId: string;
  requestHash: string;
  outcomeHash: string;
}

export interface OperatingOperationReplayEntryV2 {
  operationId: string;
  operationKind: 'execute' | 'rollback';
  requestFingerprint: string;
  actionId: string;
  actionRevision: number;
  actionHash: string;
  intentEventId: string;
  operationHash: string;
  payloadArtifactId: string;
  payloadHash: string;
  baselineArtifactId: string | null;
  baselineHash: string | null;
  targetBeforeHash: string;
  reservedResultId: string;
  reservedResultArtifactId: string;
  reservedSubmissionId: string;
  reservedTerminalEventIds: {
    submitted: string;
    artifactCreated: string;
    validated: string;
    resultRecorded: string;
  };
  reservedUncertaintyResultId: string;
  reservedUncertaintyResultArtifactId: string;
  reservedUncertaintySubmissionId: string;
  reservedUncertaintyTerminalEventIds: {
    submitted: string;
    artifactCreated: string;
    validated: string;
    resultRecorded: string;
  };
  reservedCompletedAt: string;
  reservedCorrelationId: string;
  terminalResultId: string | null;
  terminalReceipt: OperatingExecutionReceiptProofV2 | null;
}

export interface OperatingRuntimeStateV2Base {
  kind: 'operating-runtime-state';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  generatedAt: string;
  eventHead: OperatingEventHeadV2;
  cycles: OperatingCycleV2[];
  inputBindings: OperatingCycleInputBindingV2[];
  assignments: OperatingAssignmentV2[];
  reviews: OperatingReviewV2[];
  executiveBoards?: OperatingExecutiveBoardMaterializedV2[];
  submissions: OperatingSubmissionV2[];
  artifacts: OperatingArtifactV2[];
  findings: OperatingFindingV2[];
  decisions: OperatingDecisionV2[];
  actions: OperatingActionV2[];
  submissionReplayIndex: OperatingSubmissionReplayEntryV2[];
  workChangeSetReplayIndex: OperatingWorkChangeSetReplayEntryV2[];
  evidenceRefs?: OperatingEvidenceRefV2[];
  evidenceResolutions?: OperatingEvidenceResolutionV2[];
  evidenceEdges?: OperatingEvidenceEdgeV2[];
  evidenceResolutionReplayIndex?: OperatingEvidenceResolutionReplayEntryV2[];
  operatingModelStates?: OperatingModelStateV2[];
  operatingSnapshots?: OperatingSnapshotV2[];
  objectives?: OperatingObjectiveV2[];
  metrics?: OperatingMetricV2[];
  metricObservations?: OperatingMetricObservationV2[];
  risks?: OperatingRiskV2[];
  assumptions?: OperatingAssumptionV2[];
  claims?: OperatingClaimV2[];
  domainProjections?: OperatingDomainProjectionV2[];
  deltas?: OperatingDeltaV2[];
  intelligencePlans?: OperatingIntelligencePlanV2[];
  decisionLedgers?: OperatingDecisionLedgerV2[];
  verificationPlans?: OperatingActionVerificationPlanV2[];
  outcomes?: OperatingOutcomeV2[];
  learnings?: OperatingLearningV2[];
  scenarios?: OperatingScenarioV2[];
  eventTriggers?: OperatingEventTriggerV2[];
  eventReplayIndex: OperatingEventReplayEntryV2[];
}

export type OperatingAuthorityHistoryV2 =
  | {
      actionPolicies?: never;
      policyEvaluations?: never;
      approvalRequirements?: never;
      approvalRecords?: never;
      capabilityAvailability?: never;
      capabilityGrants?: never;
      governedOperations?: never;
      executionResults?: never;
      rollbackPlans?: never;
      rollbackResults?: never;
      operationReplayIndex?: never;
    }
  | {
      actionPolicies: OperatingActionPolicyV2[];
      policyEvaluations: OperatingPolicyEvaluationV2[];
      approvalRequirements: OperatingApprovalRequirementV2[];
      approvalRecords: OperatingApprovalRecordV2[];
      capabilityAvailability: OperatingCapabilityAvailabilityV2[];
      capabilityGrants: OperatingCapabilityGrantV2[];
      governedOperations: OperatingGovernedOperationV2[];
      executionResults: OperatingExecutionResultV2[];
      rollbackPlans: OperatingRollbackPlanV2[];
      rollbackResults: OperatingRollbackResultV2[];
      operationReplayIndex: OperatingOperationReplayEntryV2[];
    };
export type OperatingRuntimeStateV2 = OperatingRuntimeStateV2Base & OperatingAuthorityHistoryV2;

export interface OperatingCheckpointV2Base {
  kind: 'operating-checkpoint';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  createdAt: string;
  eventHead: OperatingEventHeadV2;
  runtimeStateHash: string;
  eventReplayIndexHash: string;
  recordDigests: string[];
  blobHashes: string[];
  recoveryVersion: string;
}
export type OperatingCheckpointAuthorityHashesV2 =
  | { operationReplayIndexHash?: never; authorityHistoryHash?: never }
  | { operationReplayIndexHash: string; authorityHistoryHash: string };
export type OperatingCheckpointV2 = OperatingCheckpointV2Base &
  OperatingCheckpointAuthorityHashesV2;

export interface OperateRoleOutputContractV2 {
  schemaId: (typeof OPERATE_RUNTIME_CONTRACT_KINDS)[number];
  schemaVersion: '2.0.0';
  mediaType: string;
  maxBytes: number;
}

export interface OperateRoleMandateV2 {
  id: OperatePhase1AssignmentKindV2;
  version: '2.0.0';
  output: OperateRoleOutputContractV2;
  limits: {
    maxProposals: number;
    maxActions: number;
  };
}

export interface OperateAnalysisRubricV2 {
  requiredQuestions: string[];
  requiredEvidence: string[];
  failureModes: string[];
  artifactQualityBar: string[];
  outOfScope: string[];
}

export interface OperateDomainRegistrationV2 {
  kind: 'operate-domain-registration';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  domainId: string;
  domainVersion: string;
  domainContract?: OperateDomainContractBindingV2;
  provenance: { packageName: string; packageVersion: string; integrity: string };
  roles: Array<{
    roleId: string;
    roleKind: OperatePhase1AssignmentKindV2;
    label: string;
    roleVersion: '2.0.0';
    output: OperateRoleOutputContractV2;
    analysisRubric: OperateAnalysisRubricV2;
    dependencyPolicy: { id: 'none' | 'all-required' | 'threshold'; version: '1.0.0' };
    requirements: string[];
  }>;
  vocabulary: Array<{ term: string; definition: string }>;
  projectionContracts: Array<{ schemaId: string; schemaVersion: string }>;
  actionKinds: Array<{ id: string; version: string }>;
  requestedCapabilities: Array<{ id: string; version: string; reason: string }>;
  policyRequirements?: Array<{
    actionKind: OperateVersionedIdentityV2;
    capability: OperateVersionedIdentityV2;
    policy: OperateVersionedIdentityV2;
  }>;
  requirements: string[];
}

export interface AgentRuntimeManifestV2 {
  kind: 'agent-runtime-manifest';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  runtimeId: string;
  runtimeVersion: string;
}

export type OperatingFindingStateV2 =
  | 'open'
  | 'accepted'
  | 'resolved'
  | 'rejected'
  | 'deferred'
  | 'superseded';
export type OperatingDecisionStateV2 =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'deferred'
  | 'superseded';
export type OperatingActionStateV2 =
  | 'proposed'
  | 'approved'
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'blocked'
  | 'rejected'
  | 'deferred'
  | 'cancelled';
export type OperatingFindingTypeV2 =
  | 'unsupported'
  | 'contradicted'
  | 'correlated-reasoning'
  | 'missing-alternative'
  | 'unpriced-downside'
  | 'irreversibility-mismatch'
  | 'overconfidence'
  | 'scope-violation';
export type OperatingFindingSeverityV2 = 'low' | 'medium' | 'high' | 'critical';

export interface OperatingFindingBaseV2 {
  kind: 'operating-finding';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  findingId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  sourceCycleId: string;
  sourceArtifactId: string;
  title: string;
  statement: string;
  state: OperatingFindingStateV2;
  ownerActorId: string | null;
  revisitAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface OperatingPersistentWorkFindingV2 extends OperatingFindingBaseV2 {
  origin: 'persistent-work';
}
export interface OperatingIntelligenceFindingV2 extends OperatingFindingBaseV2 {
  origin: 'operating-intelligence';
  sourceAssignmentId: string;
  sourceLocalFindingId: string;
  findingType: OperatingFindingTypeV2;
  severity: OperatingFindingSeverityV2;
  confidence: number;
  targets: Array<{
    advisorArtifactId: string;
    analysisIds: string[];
    claimIds: string[];
    measurementIds: string[];
    riskIds: string[];
    recommendationIds: string[];
  }>;
  supportingEvidenceRefIds: string[];
  contradictingEvidenceRefIds: string[];
  rationale: string;
  correctionCondition: string;
}
export type OperatingFindingV2 = OperatingPersistentWorkFindingV2 | OperatingIntelligenceFindingV2;

export interface OperatingDecisionBaseV2 {
  kind: 'operating-decision';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  decisionId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  sourceCycleId: string;
  sourceArtifactId: string;
  title: string;
  question: string;
  outcome: string | null;
  rationale: string;
  state: OperatingDecisionStateV2;
  ownerActorId: string;
  revisitAt: string | null;
  revision: number;
  predecessorDecisionId: string | null;
  historyDecisionIds: string[];
  createdAt: string;
  updatedAt: string;
  evidenceRefIds: string[];
  alternatives: string[];
  confidence: number;
  assumptionIds: string[];
  expectedUpside: string;
  expectedDownside: string;
  dissent: string[];
  reopenConditions: string[];
  revisitConditions: string[];
}
export interface OperatingPersistentWorkDecisionV2 extends OperatingDecisionBaseV2 {
  origin: 'persistent-work';
}
export interface OperatingIntelligenceDecisionV2 extends OperatingDecisionBaseV2 {
  origin: 'operating-intelligence';
  sourceAssignmentId: string;
  sourceLocalDecisionId: string;
  sourceClaimRefs: Array<{ advisorArtifactId: string; localClaimId: string }>;
  claimIds: string[];
  sourceRecommendationRefs: Array<{ advisorArtifactId: string; localRecommendationId: string }>;
  challengerFindingIds: string[];
  findingIds: string[];
  alternativeDispositions: Array<{
    sourceArtifactId: string;
    localAlternativeId: string;
    title: string;
    disposition: 'accepted' | 'rejected' | 'deferred';
    rationale: string;
  }>;
  uncertainty: string;
  reversibility: string;
  dissentIds: string[];
}
export type OperatingDecisionV2 =
  | OperatingPersistentWorkDecisionV2
  | OperatingIntelligenceDecisionV2;
export interface OperatingActionV2Base {
  kind: 'operating-action';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  actionId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  sourceCycleId: string;
  sourceArtifactId: string;
  title: string;
  state: OperatingActionStateV2;
  ownerActorId: string | null;
  accountabilityDisposition: 'unowned' | 'blocked' | null;
  sourceDecisionId: string | null;
  sourceFindingIds: string[];
  dependsOnActionIds: string[];
  objectiveId: string;
  expectedResult: string;
  metricId: string;
  baseline: number;
  target: number;
  verificationWindow: string;
  verificationPlanId: string;
  createdAt: string;
  updatedAt: string;
}
export type OperatingActionAuthorityTupleV2 =
  | {
      revisionId?: never;
      revision?: never;
      predecessorRevisionId?: never;
      actionHash?: never;
      actionKind?: never;
      requestedCapability?: never;
      targetBinding?: never;
      effectClass?: never;
      preconditionArtifactIds?: never;
      executionBinding?: never;
    }
  | {
      revisionId: string;
      revision: number;
      predecessorRevisionId: string | null;
      actionHash: string;
      actionKind: OperateVersionedIdentityV2;
      requestedCapability: OperateVersionedIdentityV2;
      targetBinding: OperateTargetBindingV2;
      effectClass: OperateGovernedEffectClassV2;
      preconditionArtifactIds: string[];
      executionBinding: {
        policyId: string;
        policyVersion: string;
        rollbackRequired: boolean;
        verificationRequired: true;
      };
    };
export type OperatingActionV2 = OperatingActionV2Base & OperatingActionAuthorityTupleV2;
export interface OperatingFindingDraftV2 {
  draftRef: string;
  title: string;
  statement: string;
  state: Extract<OperatingFindingStateV2, 'open' | 'deferred'>;
  ownerActorId: string | null;
  revisitAt: string | null;
}
export interface OperatingDecisionDraftV2 {
  draftRef: string;
  title: string;
  question: string;
  rationale: string;
  ownerActorId: string;
  revisitAt: string | null;
  evidenceRefIds: string[];
  alternatives: string[];
  confidence: number;
  assumptionIds: string[];
  expectedUpside: string;
  expectedDownside: string;
  dissent: string[];
  reopenConditions: string[];
  revisitConditions: string[];
}
export interface OperatingActionDraftV2 {
  draftRef: string;
  title: string;
  ownerActorId: string | null;
  accountabilityDisposition: 'unowned' | 'blocked' | null;
  sourceDecisionDraftRef: string | null;
  sourceFindingDraftRefs: string[];
  dependsOnActionDraftRefs: string[];
  objectiveId: string;
  expectedResult: string;
  metricId: string;
  baseline: number;
  target: number;
  verificationWindow: string;
  verificationPlanId: string;
}
export interface OperatingWorkChangeSetV2 {
  kind: 'operating-work-change-set';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  cycleId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  findings: OperatingFindingDraftV2[];
  decisions: OperatingDecisionDraftV2[];
  actions: OperatingActionDraftV2[];
}
export interface OperatingWorkChangeSetMaterializationV2 {
  artifactId: string;
  canonicalHash: string;
  changeSet: OperatingWorkChangeSetV2;
  findings: OperatingFindingV2[];
  decisions: OperatingDecisionV2[];
  actions: OperatingActionV2[];
}
export interface OperatingWorkCycleLinkV2 {
  entityKind: 'finding' | 'decision' | 'action';
  entityId: string;
  cycleId: string;
  relation: 'source' | 'touched' | 'carried-forward';
}
export interface OperatingWorkLedgerV2 {
  kind: 'operating-work-ledger';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  scopeId: string;
  domainId: string;
  domainVersion: string;
  generatedAt: string;
  findings: OperatingFindingV2[];
  decisions: OperatingDecisionV2[];
  actions: OperatingActionV2[];
  cycleLinks: OperatingWorkCycleLinkV2[];
}

export type OperateGovernedEffectClassV2 =
  | 'read-only'
  | 'machine-local-write'
  | 'project-write'
  | 'provider-call'
  | 'external-effect'
  | 'destructive';
export type OperateGovernedPolicyOutcomeV2 =
  | 'automatic'
  | 'named-single-party'
  | 'named-multi-party'
  | 'threshold'
  | 'deferred'
  | 'rejected'
  | 'prohibited';
export type OperateGovernedOperationStateV2 =
  | 'authorized'
  | 'intent-recorded'
  | 'dispatching'
  | 'succeeded'
  | 'failed'
  | 'partial'
  | 'uncertain'
  | 'blocked'
  | 'cancelled'
  | 'rolled-back';
export interface OperateVersionedIdentityV2 {
  id: string;
  version: string;
}
export interface OperateActionIdentityV2 {
  actionId: string;
  revision: number;
  actionHash: string;
}
export interface OperateTargetBindingV2 {
  kind: string;
  id: string;
  revision: string;
}
export interface OperateGovernedContractRefV2 {
  schemaId: string;
  schemaVersion: '2.0.0';
}
export interface OperateGovernedProviderProvenanceV2 {
  packageName: string;
  packageVersion: string;
  integrity: string;
}
export interface OperateGovernedImplementationV2 {
  source: 'built-in' | 'public-optional' | 'external';
  id: string;
}
export type OperatePolicyTierV2 = 'core' | 'project' | 'domain';
export interface OperateGovernedRegistrationProfileV2 {
  supportedActionKinds: OperateVersionedIdentityV2[];
  errorContract: OperateGovernedContractRefV2;
  errorCodes: OperateErrorCodeV2[];
  timeoutPolicy: { timeoutMs: number; onTimeout: 'fail-closed' };
  retryPolicy: {
    maxAttempts: number;
    backoff: 'none' | 'fixed';
    retryableErrorCodes: OperateErrorCodeV2[];
  };
  idempotency: {
    keySource: 'runtime-derived-request-fingerprint';
    replay: 'return-recorded-result';
    intrinsicallyIdempotent: boolean;
  };
  reconciliation: OperateGovernedReconciliationV2;
  health: {
    status: 'available' | 'degraded' | 'unavailable';
    checkedAt: string;
    expiresAt: string;
    healthHash: string;
  };
  versionCompatibility: {
    protocolVersion: '2.0.0';
    minimumRuntimeVersion: string;
    maximumRuntimeVersion: string | null;
  };
}
export type OperateGovernedReconciliationV2 =
  | { supported: false; mode: 'none' }
  | { supported: true; mode: 'deterministic' };
export interface OperatingActionPolicyV2 {
  kind: 'operating-action-policy';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  policyId: string;
  policyVersion: string;
  domainId: string;
  actionKind: OperateVersionedIdentityV2;
  capability: OperateVersionedIdentityV2;
  effectClasses: OperateGovernedEffectClassV2[];
  targetKinds: string[];
  decisionMode: OperateGovernedPolicyOutcomeV2;
  approvalRequirementIds: string[];
  rollbackRequired: boolean;
  verificationRequired: boolean;
  tier: OperatePolicyTierV2;
  precedence: 100 | 200 | 300;
  narrowingOnly: boolean;
  provenance: { providerId: string; providerVersion: string; sourceHash: string };
  policyHash: string;
}
export interface OperatingPolicyEvaluationV2 {
  kind: 'operating-policy-evaluation';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  evaluationId: string;
  policy: { policyId: string; policyVersion: string; policyHash: string };
  policyTier: OperatePolicyTierV2;
  precedence: 100 | 200 | 300;
  appliedPolicyRefs: Array<{ policyId: string; policyVersion: string; policyHash: string }>;
  action: OperateActionIdentityV2;
  capability: OperateVersionedIdentityV2;
  target: OperateTargetBindingV2;
  effectClass: OperateGovernedEffectClassV2;
  outcome: OperateGovernedPolicyOutcomeV2;
  approvalRequirementIds: string[];
  reasonCodes: string[];
  evaluatedBy: { providerId: string; providerVersion: string };
  evaluatedAt: string;
  inputHash: string;
  evaluationHash: string;
}
export interface OperatingApprovalRequirementV2 {
  kind: 'operating-approval-requirement';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  requirementId: string;
  evaluationId: string;
  policy: { policyId: string; policyVersion: string; policyHash: string };
  action: OperateActionIdentityV2;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  capability: OperateVersionedIdentityV2;
  target: OperateTargetBindingV2;
  effectClass: Exclude<OperateGovernedEffectClassV2, 'destructive'>;
  parties: Array<{
    partyId: string;
    actorKind: 'human' | 'engine';
    actorId: string | null;
    requiredCapability: OperateVersionedIdentityV2;
  }>;
  mode: Extract<
    OperateGovernedPolicyOutcomeV2,
    'automatic' | 'named-single-party' | 'named-multi-party' | 'threshold'
  >;
  namedActorIds: string[];
  requiredActorKinds: Array<'human' | 'engine'>;
  threshold: number;
  expiresAt: string | null;
  consumable: boolean;
  scopeHash: string;
}
export interface OperatingApprovalRecordV2 {
  kind: 'operating-approval-record';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  approvalId: string;
  requirementId: string;
  evaluationId: string;
  policy: { policyId: string; policyVersion: string; policyHash: string };
  action: OperateActionIdentityV2;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  capability: OperateVersionedIdentityV2;
  target: OperateTargetBindingV2;
  effectClass: Exclude<OperateGovernedEffectClassV2, 'destructive'>;
  partyId: string;
  actor: { kind: 'human' | 'engine'; actorId: string; capability: OperateVersionedIdentityV2 };
  decision: 'approved' | 'rejected' | 'deferred';
  scopeHash: string;
  issuedAt: string;
  expiresAt: string | null;
  consumedByOperationId: string | null;
  recordHash: string;
}
export interface OperatingCapabilityAvailabilityV2 {
  kind: 'operating-capability-availability';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  availabilityId: string;
  provider: { providerId: string; providerVersion: string };
  capability: OperateVersionedIdentityV2;
  target: OperateTargetBindingV2;
  effectCeiling: Exclude<OperateGovernedEffectClassV2, 'destructive'>;
  status: 'available' | 'unavailable' | 'degraded';
  reasonCode: string;
  checkedAt: string;
  expiresAt: string;
  availabilityHash: string;
}
export interface OperatingCapabilityGrantV2 {
  kind: 'operating-capability-grant';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  grantId: string;
  issuer: { kind: 'runtime'; id: string };
  assignmentId: string;
  action: OperateActionIdentityV2;
  evaluationId: string;
  approvalIds: string[];
  operationId: string;
  capability: OperateVersionedIdentityV2;
  target: OperateTargetBindingV2;
  effectClass: Exclude<OperateGovernedEffectClassV2, 'destructive'>;
  useLimit: 1;
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
  scopeHash: string;
  grantHash: string;
}
export interface OperatingGovernedOperationV2 {
  kind: 'operating-governed-operation';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  operationId: string;
  operationKind: 'execute' | 'rollback';
  action: OperateActionIdentityV2;
  assignmentId: string;
  requestFingerprint: string;
  evaluationId: string;
  approvalIds: string[];
  grantId: string;
  capability: OperateVersionedIdentityV2;
  target: OperateTargetBindingV2;
  effectClass: Exclude<OperateGovernedEffectClassV2, 'destructive'>;
  executor: { executorId: string; executorVersion: string };
  connector: OperateVersionedIdentityV2 | null;
  preconditionArtifactIds: string[];
  inputArtifactIds: string[];
  verificationPlanId: string;
  rollbackClass: 'not-applicable' | 'reversible' | 'compensating' | 'manual';
  state: OperateGovernedOperationStateV2;
  intentEventId: string;
  resultId: string | null;
  rollbackPlanId: string | null;
  parentOperationId: string | null;
  createdAt: string;
  updatedAt: string;
  operationHash: string;
}
export interface OperatingExecutionResultV2 {
  kind: 'operating-execution-result';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  resultId: string;
  operationId: string;
  operationKind: 'execute';
  requestFingerprint: string;
  action: OperateActionIdentityV2;
  assignmentId: string;
  evaluationId: string;
  approvalIds: string[];
  grantId: string;
  capability: OperateVersionedIdentityV2;
  target: OperateTargetBindingV2;
  effectClass: Exclude<OperateGovernedEffectClassV2, 'destructive'>;
  executor: { executorId: string; executorVersion: string };
  connector: OperateVersionedIdentityV2 | null;
  status: 'succeeded' | 'failed' | 'partial' | 'uncertain' | 'blocked';
  targetBeforeHash: string;
  targetAfterHash: string | null;
  baselineArtifactId: string | null;
  baselineHash: string | null;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  effectSummary: { changed: boolean; summary: string; affectedTargetIds: string[] };
  resultArtifactId: string;
  verificationPlanId: string;
  rollbackPlanId: string | null;
  eventIds: string[];
  completedAt: string;
  resultHash: string;
}
export interface OperatingRollbackPlanV2 {
  kind: 'operating-rollback-plan';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  rollbackPlanId: string;
  operationId: string;
  executionResultId: string;
  action: OperateActionIdentityV2;
  eligibility:
    | 'eligible'
    | 'required'
    | 'unsupported'
    | 'prohibited'
    | 'expired'
    | 'stale'
    | 'uncertain';
  capability: OperateVersionedIdentityV2;
  effectClass: Exclude<OperateGovernedEffectClassV2, 'destructive'>;
  executor: { executorId: string; executorVersion: string };
  baselineArtifactId: string;
  baselineHash: string;
  steps: Array<{ stepId: string; description: string; expectedTargetHash: string }>;
  verificationPlanId: string;
  expiresAt: string;
  planHash: string;
}
export interface OperatingRollbackResultV2 {
  kind: 'operating-rollback-result';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  rollbackResultId: string;
  rollbackOperationId: string;
  operationKind: 'rollback';
  requestFingerprint: string;
  originalOperationId: string;
  executionResultId: string;
  rollbackPlanId: string;
  action: OperateActionIdentityV2;
  assignmentId: string;
  evaluationId: string;
  approvalIds: string[];
  grantId: string;
  capability: OperateVersionedIdentityV2;
  target: OperateTargetBindingV2;
  effectClass: Exclude<OperateGovernedEffectClassV2, 'destructive'>;
  executor: { executorId: string; executorVersion: string };
  connector: OperateVersionedIdentityV2 | null;
  status: 'succeeded' | 'failed' | 'partial' | 'uncertain' | 'blocked';
  targetBeforeHash: string;
  targetAfterHash: string | null;
  baselineArtifactId: string | null;
  baselineHash: string | null;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  effectSummary: { changed: boolean; summary: string; affectedTargetIds: string[] };
  resultArtifactId: string;
  verificationPlanId: string;
  eventIds: string[];
  completedAt: string;
  resultHash: string;
}
export interface OperateCapabilityProviderRegistrationV2
  extends OperateGovernedRegistrationProfileV2 {
  kind: 'operate-capability-provider-registration';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  providerId: string;
  providerVersion: string;
  capabilities: OperateVersionedIdentityV2[];
  supportedDomains: string[];
  supportedTargetKinds: string[];
  effectCeiling: Exclude<OperateGovernedEffectClassV2, 'destructive'>;
  inputContract: OperateGovernedContractRefV2;
  outputContract: OperateGovernedContractRefV2;
  provenance: OperateGovernedProviderProvenanceV2;
  conformanceDigest: string;
  implementation: OperateGovernedImplementationV2;
  fallback: { kind: 'unavailable'; errorCode: 'CAPABILITY_PROVIDER_UNAVAILABLE' };
}
export interface OperatePolicyProviderRegistrationV2 extends OperateGovernedRegistrationProfileV2 {
  kind: 'operate-policy-provider-registration';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  providerId: string;
  providerVersion: string;
  policyRefs: OperateVersionedIdentityV2[];
  supportedDomains: string[];
  effectCeiling: Exclude<OperateGovernedEffectClassV2, 'destructive'>;
  tier: OperatePolicyTierV2;
  precedence: 100 | 200 | 300;
  narrowingOnly: boolean;
  inputContract: OperateGovernedContractRefV2;
  outputContract: OperateGovernedContractRefV2;
  provenance: OperateGovernedProviderProvenanceV2;
  conformanceDigest: string;
  implementation: OperateGovernedImplementationV2;
  fallback: { kind: 'unavailable'; errorCode: 'POLICY_PROVIDER_UNAVAILABLE' };
}
export interface OperateExecutorRegistrationV2 extends OperateGovernedRegistrationProfileV2 {
  kind: 'operate-executor-registration';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  executorId: string;
  executorVersion: string;
  operationKinds: Array<'execute' | 'rollback'>;
  capabilities: OperateVersionedIdentityV2[];
  supportedDomains: string[];
  supportedTargetKinds: string[];
  effectCeiling: Exclude<OperateGovernedEffectClassV2, 'destructive'>;
  inputContract: OperateGovernedContractRefV2;
  outputContract: OperateGovernedContractRefV2;
  rollbackContract: OperateGovernedContractRefV2;
  provenance: OperateGovernedProviderProvenanceV2;
  conformanceDigest: string;
  implementation: OperateGovernedImplementationV2;
  fallback: { kind: 'unavailable'; errorCode: 'EXECUTOR_UNAVAILABLE' };
}
export interface OperateGovernedExtensionRegistryV2 {
  capabilityProviders: readonly OperateCapabilityProviderRegistrationV2[];
  policyProviders: readonly OperatePolicyProviderRegistrationV2[];
  executors: readonly OperateExecutorRegistrationV2[];
}
export interface OperateTrustedExecutorBindingV2 {
  kind: 'operate-trusted-executor-binding';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  executor: { executorId: string; executorVersion: string };
  implementation: OperateGovernedImplementationV2;
  connector: OperateVersionedIdentityV2;
  registrationHash: string;
  bindingHash: string;
}

export type OperatingDeliveryRouteKindV1 =
  | 'contained-execution'
  | 'planning-work'
  | 'human-external'
  | 'observe-only';
export type OperateExperienceAccessLevelV1 = 'public' | 'internal' | 'confidential' | 'restricted';
declare const positiveOperateExperienceEventSequenceV1Brand: unique symbol;
export type PositiveOperateExperienceEventSequenceV1 = number & {
  readonly [positiveOperateExperienceEventSequenceV1Brand]: 'positive-operate-experience-event-sequence';
};
export type OperateExperienceEventHeadV1 =
  | { sequence: 0; hash: null }
  | { sequence: PositiveOperateExperienceEventSequenceV1; hash: string };
export interface OperatingDeliveryRouteV1 {
  kind: 'operating-delivery-route';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  routeId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  action: { actionId: string; revision: number; actionHash: string };
  eventHead: OperateExperienceEventHeadV1;
  route: OperatingDeliveryRouteKindV1;
  rationale: string;
  createdAt: string;
  routeHash: string;
}
export interface OperateExperienceAttentionV1 {
  attentionId: string;
  kind: 'decision' | 'approval' | 'action' | 'verification' | 'outcome' | 'uncertainty';
  subjectId: string;
  priority: number;
  title: string;
  whyNow: string;
  consequence: string;
  state: string;
  dueAt: string | null;
  evidenceRefIds: string[];
}
export interface OperateExperienceDomainMetricV1 {
  metricId: string;
  title: string | null;
  value: number | null;
  unit: string | null;
  change: null | {
    kind: 'added' | 'removed' | 'changed' | 'stale' | 'conflict';
    priorValue: number | null;
    currentValue: number | null;
    deltaValue: number | null;
    deltaId: string | null;
  };
  window: string | null;
  freshness: 'current' | 'historical' | 'stale' | 'unknown';
  state: 'current' | 'historical' | 'stale' | 'unknown' | 'unavailable' | 'restricted';
  target: number | null;
  threshold: number | null;
  evidenceRefIds: string[];
  snapshot: null | { snapshotId: string; createdAt: string };
  delta: null | {
    deltaId: string;
    priorSnapshotId: string | null;
    currentSnapshotId: string;
    derivedAt: string;
  };
  dueVerification: Array<{
    verificationPlanId: string;
    actionId: string;
    state: string | null;
    dueAt: string | null;
    window: string | null;
    deepLink: string | null;
  }>;
  accessReason: 'access-denied' | null;
}
export interface OperateExperienceCycleStageV1 {
  id: 'observe' | 'understand' | 'decide' | 'govern' | 'act' | 'verify' | 'learn';
  state:
    | 'complete'
    | 'current'
    | 'available'
    | 'blocked'
    | 'skipped'
    | 'failed'
    | 'uncertain'
    | 'revisited'
    | 'waiting';
  reason: string | null;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  gates: Array<{
    kind: 'review' | 'approval' | 'execution' | 'verification' | 'learning';
    subjectId: string;
    state: string;
  }>;
  evidenceGapIds: string[];
  uncertaintyIds: string[];
  persistentActionIds: string[];
}
export interface OperateExperienceAssignmentV1 {
  assignmentId: string;
  title: string | null;
  role: string | null;
  ownerLabel: string | null;
  state: string;
  dueAt: string | null;
  next: null | { label: string; tool: string };
  deepLink: string;
  dependencies: Array<{ assignmentId: string; state: string | null; resolved: boolean }>;
  blockers: string[];
  inputArtifactIds: string[];
  outputArtifactIds: string[];
}
export interface OperateExperienceCycleV1 {
  cycleId: string;
  state: string;
  health: string;
  focus: string[];
  createdAt: string;
  updatedAt: string;
  stages: OperateExperienceCycleStageV1[];
  assignments: OperateExperienceAssignmentV1[];
  dependencies: Array<{
    subjectKind: 'assignment' | 'action';
    subjectId: string;
    dependsOn: Array<{
      assignmentId?: string;
      actionId?: string;
      state: string | null;
      resolved: boolean;
    }>;
  }>;
  blockers: Array<{
    subjectKind: 'assignment' | 'action';
    subjectId: string;
    blockingSubjectIds: string[];
  }>;
  persistentActionIds: string[];
  replayCheckpoint: OperateExperienceReplayV1['checkpoint'];
  deepLink: string;
}
export interface OperateExperienceInboxItemV1 {
  itemId: string;
  kind: 'decision' | 'approval' | 'verification';
  subjectId: string;
  ownerActorId: string;
  state: string;
  title: string;
  consequence: string;
  expiresAt: string | null;
  blocking: boolean;
  evidence: Array<{
    evidenceRefId: string;
    classification: OperateExperienceAccessLevelV1;
    accessState: 'available' | 'restricted';
    relation: 'support' | 'contradiction' | 'informs' | 'evaluates';
  }>;
  requiredParties: Array<{
    partyId: string;
    actorKind: 'human' | 'engine';
    actorId: string | null;
    requiredCapability: OperateVersionedIdentityV2;
    state: 'required' | 'recorded' | 'redacted';
    redacted: boolean;
  }>;
  redactions: OperateExperienceOmissionV1[];
  actionLocator: null | { subjectId: string; actionDigest: string };
  navigationLocator: null | {
    kind: 'review';
    cycleId: string;
    reviewId: string;
    deepLink: string;
    readActionDigest: string;
  };
  unavailableReason: null | { code: string; message: string };
}
export interface OperateExperienceResultV1 {
  resultId: string;
  operationId: string;
  status: string;
  completedAt: string;
  effectSummary: null | { changed: boolean; summary: string; affectedTargetIds: string[] };
  targetBeforeHash: string | null;
  targetAfterHash: string | null;
  accessReason: 'access-denied' | null;
  deepLink: string;
}
export interface OperateExperienceActionV1 {
  actionId: string;
  revision: number;
  actionHash: string;
  title: string;
  state: string;
  ownerActorId: string | null;
  expectedResult: string;
  verificationPlanId: string;
  deliveryRoute: OperatingDeliveryRouteV1;
  dependencyActionIds: string[];
  executions: OperateExperienceResultV1[];
  rollbacks: OperateExperienceResultV1[];
  deepLink: string;
}
export interface OperateExperienceCausalLinkV1 {
  kind: 'claim' | 'local-claim' | 'decision' | 'action' | 'outcome';
  subjectId: string;
  relation: 'support' | 'contradiction' | 'informs' | 'evaluates';
  deepLink: string;
}
export interface OperateExperienceResolutionErrorV1 {
  resolutionId: string;
  error: null | { code: string; retryable: boolean; context: Record<string, string> };
  resolvedAt: string;
}
export interface OperateExperienceEvidenceV1 {
  evidenceRefId: string;
  classification: OperateExperienceAccessLevelV1;
  accessState: 'available' | 'restricted';
  freshness: 'current' | 'historical' | 'stale';
  evidenceKind: 'git' | 'filesystem' | 'planr' | 'operate-artifact' | null;
  resolvedAt: string | null;
  claimStatus: 'supported' | 'contradicted' | 'uncertain' | 'unknown' | 'restricted';
  supportClaimIds: string[];
  contradictClaimIds: string[];
  source: null | {
    evidenceKind: 'git' | 'filesystem' | 'planr' | 'operate-artifact';
    provider: { id: string; version: string };
    resolver: { id: string; version: string };
  };
  producer: null | { actorId: string; roleId: string; runtime: string };
  observedAt: string | null;
  scope: { scopeId: string; domainId: string; domainVersion: string };
  sensitivity: OperateExperienceAccessLevelV1;
  provenance: null | {
    sourceArtifactId: string;
    evidenceArtifactId: string;
    rawHash: string;
    canonicalHash: string | null;
    sizeBytes: number;
    mediaType: string;
    accessLevel: OperateExperienceAccessLevelV1;
  };
  confidence: number | null;
  gaps: string[];
  errors: OperateExperienceResolutionErrorV1[];
  accessReason: 'access-denied' | null;
  causalLinks: OperateExperienceCausalLinkV1[];
  deepLink: string;
}
export interface OperateExperienceClaimV1 {
  claimId: string;
  status: 'supported' | 'contradicted' | 'uncertain' | 'unknown' | 'restricted';
  epistemicStatus: 'known' | 'strongly-supported' | 'probable' | 'speculative' | 'unknown';
  statement: string | null;
  supportEvidenceRefIds: string[];
  contradictEvidenceRefIds: string[];
  source: null | {
    artifactId: string;
    artifactType: string;
    producer: { actorId: string; roleId: string; runtime: string };
    observedAt: string;
    rawHash: string;
    canonicalHash: string | null;
  };
  producer: null | { actorId: string; roleId: string; runtime: string };
  observedAt: string;
  scope: { scopeId: string; domainId: string; domainVersion: string };
  sensitivity: OperateExperienceAccessLevelV1;
  provenance: null | { artifactId: string; rawHash: string; canonicalHash: string | null };
  confidence: number | null;
  gaps: string[];
  errors: OperateExperienceResolutionErrorV1[];
  accessReason: 'access-denied' | null;
  causalLinks: OperateExperienceCausalLinkV1[];
  deepLink: string;
}
export interface OperateExperienceRationaleV1 {
  nodeId: string;
  kind:
    | 'claim'
    | 'recommendation'
    | 'challenge'
    | 'synthesis'
    | 'decision'
    | 'action'
    | 'result'
    | 'outcome'
    | 'learning'
    | 'revisit';
  subjectId: string;
  summary: string;
  artifactId: string | null;
  evidenceRefIds: string[];
}
export interface OperateExperienceOutcomeV1 {
  outcomeId: string;
  actionId: string;
  verificationPlanId: string;
  status: string;
  metric: null | {
    metricId: string;
    metricHash: string;
    baseline: number | null;
    target: number | null;
    observed: number | null;
    unit: string | null;
    window: string | null;
    dueAt: string | null;
    freshness: 'current' | 'historical' | 'stale' | 'unknown';
    confidence: number | null;
  };
  observationIds: string[];
  evidenceRefIds: string[];
  observedAt: string;
  decision: null | { decisionId: string; revision: number; state: string; deepLink: string };
  execution: OperateExperienceResultV1[];
  rollback: OperateExperienceResultV1[];
  verification: null | {
    verificationPlanId: string;
    verificationPlanHash: string;
    metricId: string;
    metricHash: string;
    method: string | null;
    evaluationRules: string[];
    observationRequest: null | { kind: 'future-observation' | 'future-analysis'; reason: string };
    accessReason: 'access-denied' | null;
  };
  nextObservation: null | {
    kind: 'future-observation' | 'future-analysis';
    reason: string;
    dueAt: string | null;
  };
  revisit: null | { decisionIds: string[]; conditions: string[] };
  snapshot: null | { snapshotId: string; createdAt: string };
  delta: null | {
    deltaId: string;
    priorSnapshotId: string | null;
    currentSnapshotId: string;
    derivedAt: string;
  };
  accessReason: 'access-denied' | null;
  deepLink: string;
}
export interface OperateExperienceLearningV1 {
  learningId: string;
  outcomeId: string;
  statement: string;
  decisionIds: string[];
  evidenceRefIds: string[];
  createdAt: string;
}
export interface OperateExperienceHistoryV1 {
  eventId: string;
  sequence: number;
  type: string;
  entityId: string;
  actorKind: string;
  actorId: string | null;
  timestamp: string;
  correlationId: string;
  eventHash: string;
  change: { subjectKind: string | null; summary: string | null };
  why: string | null;
  authority: null | {
    evaluationId: string;
    approvalIds: string[];
    grantId: string;
    capability: { id: string; version: string };
  };
  evidenceRefIds: string[];
  prior: { previousEventHash: string | null; causationId: string | null };
  result: null | { status: string; completedAt: string | null };
  next: null | { label: string; tool: string };
  deepLinks: string[];
  beforeAfter: null | {
    deltaId: string;
    kind: 'added' | 'removed' | 'changed' | 'stale' | 'conflict';
    priorSnapshotId: string | null;
    currentSnapshotId: string;
  };
}
export interface OperateExperienceReplayV1 {
  checkpoint: null | {
    createdAt: string;
    eventHead: OperateExperienceEventHeadV1;
    runtimeStateHash: string;
    eventReplayIndexHash: string;
    recoveryVersion: string;
  };
  tail: {
    startSequence: number | null;
    endSequence: number | null;
    eventCount: number;
    eventReplayIndexHash: string;
  };
  finalHead: OperateExperienceEventHeadV1;
  liveAccessUsed: false;
  parityProof: {
    sourceStateHash: string;
    eventReplayIndexHash: string;
    checkpointVerified: boolean;
    finalEventHashMatches: boolean;
    stateParityVerified: boolean;
  };
  filterDimensions: Array<
    'cycle' | 'action' | 'decision' | 'actor' | 'operation' | 'result' | 'event-type' | 'date'
  >;
  redactions: OperateExperienceOmissionV1[];
}
export interface OperateExperienceOmissionV1 {
  classification: OperateExperienceAccessLevelV1;
  count: number;
  reason: 'access-denied' | 'body-never-projected' | 'identity-redacted';
}
export interface OperateExperienceViewV1 {
  kind: 'operate-experience-view';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  viewId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  actorId: string;
  accessLevel: OperateExperienceAccessLevelV1;
  generatedAt: string;
  eventHead: OperateExperienceEventHeadV1;
  sourceStateHash: string;
  status:
    | 'ready'
    | 'read-only'
    | 'stale'
    | 'partial'
    | 'blocked'
    | 'offline'
    | 'incompatible'
    | 'corrupt';
  attention: OperateExperienceAttentionV1[];
  domainMetrics: OperateExperienceDomainMetricV1[];
  cycles: OperateExperienceCycleV1[];
  inbox: OperateExperienceInboxItemV1[];
  actions: OperateExperienceActionV1[];
  evidence: OperateExperienceEvidenceV1[];
  claims: OperateExperienceClaimV1[];
  rationale: OperateExperienceRationaleV1[];
  outcomes: OperateExperienceOutcomeV1[];
  learnings: OperateExperienceLearningV1[];
  history: OperateExperienceHistoryV1[];
  replay: OperateExperienceReplayV1;
  allowedActions: Array<{ subjectId: string; action: OperateAllowedActionV2 }>;
  omissions: OperateExperienceOmissionV1[];
  export: { formats: Array<'html' | 'json'>; accessSafe: true; redactionCount: number };
  viewHash: string;
}
export type OperateExperiencePatchOperationV1 =
  | { op: 'replace'; path: '/status'; valueHash: string; value: OperateExperienceViewV1['status'] }
  | { op: 'replace'; path: '/attention'; valueHash: string; value: OperateExperienceAttentionV1[] }
  | {
      op: 'replace';
      path: '/domainMetrics';
      valueHash: string;
      value: OperateExperienceDomainMetricV1[];
    }
  | { op: 'replace'; path: '/cycles'; valueHash: string; value: OperateExperienceCycleV1[] }
  | { op: 'replace'; path: '/inbox'; valueHash: string; value: OperateExperienceInboxItemV1[] }
  | { op: 'replace'; path: '/actions'; valueHash: string; value: OperateExperienceActionV1[] }
  | { op: 'replace'; path: '/evidence'; valueHash: string; value: OperateExperienceEvidenceV1[] }
  | { op: 'replace'; path: '/claims'; valueHash: string; value: OperateExperienceClaimV1[] }
  | { op: 'replace'; path: '/rationale'; valueHash: string; value: OperateExperienceRationaleV1[] }
  | { op: 'replace'; path: '/outcomes'; valueHash: string; value: OperateExperienceOutcomeV1[] }
  | { op: 'replace'; path: '/learnings'; valueHash: string; value: OperateExperienceLearningV1[] }
  | { op: 'replace'; path: '/history'; valueHash: string; value: OperateExperienceHistoryV1[] }
  | { op: 'replace'; path: '/replay'; valueHash: string; value: OperateExperienceReplayV1 }
  | {
      op: 'replace';
      path: '/allowedActions';
      valueHash: string;
      value: OperateExperienceViewV1['allowedActions'];
    }
  | { op: 'replace'; path: '/omissions'; valueHash: string; value: OperateExperienceOmissionV1[] }
  | { op: 'replace'; path: '/export'; valueHash: string; value: OperateExperienceViewV1['export'] };
export interface OperateExperienceLivePatchV1 {
  kind: 'operate-experience-live-patch';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  patchId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  actorId: string;
  fromEventHead: OperateExperienceEventHeadV1;
  toEventHead: OperateExperienceEventHeadV1;
  fromViewHash: string;
  toViewHash: string;
  operations: OperateExperiencePatchOperationV1[];
  createdAt: string;
  patchHash: string;
}
export interface OperateExperiencePreviewV1 {
  kind: 'operate-experience-preview';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  previewId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  actorId: string;
  subject: OperateExperiencePreviewSubjectV1;
  eventHead: OperateExperienceEventHeadV1;
  sourceViewHash: string;
  actionDigest: string;
  allowedAction: OperateAllowedActionV2;
  authority: 'allowed' | 'refused' | 'read-only';
  consequence: string;
  reasonCodes: string[];
  transition: {
    kind: 'review' | 'approval' | 'verification' | 'execution' | 'rollback';
    targets: Array<{
      kind: string;
      id: string;
      revision: number | string | null;
      hash: string | null;
      disposition: string | null;
    }>;
    reversible: boolean;
    nextState: string;
    threshold: null | {
      required: number;
      recorded: number;
      remaining: number;
      parties: OperateExperienceInboxItemV1['requiredParties'];
    };
  };
  issuedAt: string;
  expiresAt: string;
  previewHash: string;
}
export type OperateExperiencePreviewSubjectV1 =
  | {
      kind: 'cycle' | 'assignment' | 'artifact' | 'review';
      id: string;
      revision: null;
      hash: string;
    }
  | { kind: 'decision' | 'action'; id: string; revision: number; hash: string };
export interface OperatingPlanningProposalV1 {
  kind: 'operating-planning-proposal';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  proposalId: string;
  correlationId: string;
  revision: number;
  predecessorProposalHash: string | null;
  state: 'review-required' | 'approved' | 'expired' | 'withdrawn' | 'superseded';
  confirmation: null | {
    confirmationId: string;
    reviewProposalHash: string;
    reviewProposalRevision: 1;
    eventHead: OperateExperienceEventHeadV1;
    previewDigest: string;
    actorId: string;
    decision: 'approved';
    confirmedAt: string;
    previewExpiresAt: string;
    confirmationHash: string;
  };
  scopeId: string;
  domainId: string;
  domainVersion: string;
  cycleId: string;
  eventHead: OperateExperienceEventHeadV1;
  decision: {
    decisionId: string;
    revision: number;
    decisionHash: string;
    sourceArtifactId: string;
    title: string;
    outcome: string;
    rationale: string;
    confidence: number;
    evidenceRefIds: string[];
  };
  action: {
    actionId: string;
    revision: number;
    actionHash: string;
    sourceArtifactId: string;
    title: string;
    expectedResult: string;
    metricId: string;
    verificationPlanId: string;
  };
  deliveryRoute: OperatingDeliveryRouteV1;
  acceptedPerspectiveSummaries: Array<{
    roleId: string;
    roleVersion: string;
    roleKind: 'advisor' | 'challenger' | 'chair';
    artifactId: string;
    artifactHash: string;
    accessClassification: OperateExperienceAccessLevelV1;
    disposition: 'accepted';
    normative: boolean;
    stance: 'support' | 'object' | 'constraint' | 'unknown' | 'synthesis';
    summary: string;
    constraints: string[];
    uncertainties: string[];
  }>;
  evidence: Array<{
    evidenceRefId: string;
    artifactId: string;
    artifactHash: string;
    classification: OperateExperienceAccessLevelV1;
    accessState: 'available' | 'restricted';
    relation: 'support' | 'contradiction' | 'gap';
    freshness: 'current' | 'historical' | 'stale' | 'unknown';
    confidence: number;
    summary: string | null;
    limitations: string[];
  }>;
  omissions: Array<{
    classification: OperateExperienceAccessLevelV1;
    count: number;
    reason:
      | 'access-denied'
      | 'hidden-reasoning-excluded'
      | 'raw-prompt-excluded'
      | 'rejected-advice-excluded'
      | 'restricted-body-excluded';
  }>;
  framing: {
    title: string;
    slug: string;
    problem: string;
    objective: string;
    users: string[];
    scope: string[];
    nonScope: string[];
    risks: string[];
    constraints: string[];
    requirements: string[];
    acceptanceOutcomes: string[];
  };
  metric: { metricId: string; metricHash: string };
  verification: {
    verificationPlanId: string;
    verificationPlanHash: string;
    metricId: string;
    metricHash: string;
    baseline: number;
    target: number;
    window: string;
    method: string;
    revisitConditions: string[];
  };
  actor: { actorId: string; kind: 'human' };
  preview: { digest: string; issuedAt: string; expiresAt: string };
  planningCommand: 'planr operate planning create-spec';
  createdAt: string;
  proposalHash: string;
}
export interface OperatingOriginV1 {
  kind: 'operating-origin';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  correlationId: string;
  proposalId: string;
  proposalRevision: 2;
  proposalHash: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  cycleId: string;
  eventHead: OperateExperienceEventHeadV1;
  decision: { id: string; revision: number; hash: string };
  action: { id: string; revision: number; hash: string };
  metric: { metricId: string; metricHash: string };
  verification: {
    verificationPlanId: string;
    verificationPlanHash: string;
    metricId: string;
    metricHash: string;
    window: string;
  };
  evidence: Array<{
    evidenceRefId: string;
    artifactId: string;
    artifactHash: string;
    classification: OperateExperienceAccessLevelV1;
    accessState: 'available' | 'restricted';
  }>;
  spec: { specId: string; slug: string; contentHash: string; status: 'shaping' };
  actor: { actorId: string; kind: 'human' };
  transaction: { transactionId: string; receiptHash: string; planningProvenanceEventId: string };
  createdAt: string;
  originHash: string;
}
export interface OperatingDeliveryEvidenceV1 {
  kind: 'operating-delivery-evidence';
  schemaVersion: '1.0.0';
  protocolVersion: '2.0.0';
  deliveryEvidenceId: string;
  correlationId: string;
  proposalId: string;
  proposalRevision: 2;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  decision: { id: string; revision: number; hash: string };
  action: { id: string; revision: number; hash: string };
  metric: { metricId: string; metricHash: string };
  verification: {
    verificationPlanId: string;
    verificationPlanHash: string;
    metricId: string;
    metricHash: string;
    window: string;
  };
  spec: { specId: string; contentHash: string; originHash: string };
  planRun: {
    runId: string;
    runtime: string;
    packageVersion: string;
    provenanceEventId: string;
    provenanceEventHash: string;
    status: 'succeeded' | 'blocked' | 'failed' | 'skipped';
  };
  shipRun: {
    runId: string;
    runtime: string;
    packageVersion: string;
    manifestHash: string;
    provenanceEventId: string;
    provenanceEventHash: string;
    status: 'succeeded' | 'blocked' | 'failed' | 'skipped';
  };
  tasks: Array<{
    taskId: string;
    status: 'done' | 'blocked' | 'failed' | 'skipped';
    artifactHash: string;
  }>;
  changedSurfaces: string[];
  qa: { status: 'passed' | 'failed' | 'skipped'; reportHash: string | null; summary: string };
  limitations: string[];
  artifacts: Array<{
    artifactId: string;
    hash: string;
    classification: OperateExperienceAccessLevelV1;
  }>;
  classification: OperateExperienceAccessLevelV1;
  summary: string;
  deliveryStatus: 'succeeded' | 'blocked' | 'failed' | 'rolled-back';
  rollback: null | {
    rollbackPlanId: string;
    rollbackPlanArtifactId: string;
    rollbackPlanHash: string;
    rollbackResultId: string;
    rollbackResultArtifactId: string;
    rollbackResultHash: string;
    rollbackReceiptId: string;
    rollbackReceiptArtifactId: string;
    rollbackReceiptHash: string;
    rollbackProvenanceEventId: string;
    originalShipRunId: string;
    rollbackRunId: string;
    targetBeforeHash: string;
    targetAfterHash: string;
    status: 'succeeded';
    completedAt: string;
  };
  outcomeStatus: 'verification-required';
  createdAt: string;
  deliveryEvidenceHash: string;
}

export const OPERATE_RUNTIME_PROTOCOL_VERSION: '2.0.0';
export const OPERATE_RUNTIME_CONTRACT_KINDS: readonly [
  'operating-cycle',
  'operating-cycle-input-binding',
  'operating-assignment',
  'operating-review',
  'operating-submission',
  'operating-artifact',
  'operating-event',
  'operating-runtime-state',
  'operating-checkpoint',
  'operate-allowed-action',
  'operate-api-envelope',
  'operate-tool-call',
  'operate-domain-registration',
  'agent-runtime-manifest',
  'operating-finding',
  'operating-decision',
  'operating-action',
  'operating-work-change-set',
  'operating-work-ledger',
  'operating-evidence-candidate',
  'operating-evidence-ref',
  'operating-evidence-resolution',
  'operate-evidence-provider-registration',
  'operate-evidence-resolver-registration',
  'operating-evidence-edge',
  'operating-evidence-graph',
  'operating-model-state',
  'operating-snapshot',
  'operating-objective',
  'operating-metric',
  'operating-metric-observation',
  'operating-risk',
  'operating-assumption',
  'operating-claim',
  'operating-domain-projection',
  'business-operating-snapshot-projection',
  'software-operating-snapshot-projection',
  'operating-delta',
  'operating-intelligence-plan',
  'operating-decision-ledger',
  'operating-action-verification-plan',
  'operating-outcome',
  'operating-learning',
  'operating-scenario',
  'operating-event-trigger',
  'operate-snapshot-provider-registration',
  'operate-metric-provider-registration',
  'operate-verification-provider-registration',
  'operating-action-policy',
  'operating-policy-evaluation',
  'operating-approval-requirement',
  'operating-approval-record',
  'operating-capability-availability',
  'operating-capability-grant',
  'operating-governed-operation',
  'operating-execution-result',
  'operating-rollback-plan',
  'operating-rollback-result',
  'operate-capability-provider-registration',
  'operate-policy-provider-registration',
  'operate-executor-registration',
  'operating-advisor-result',
  'operating-challenger-review',
  'operating-context-capture',
  'operating-intelligence-input-bundle',
  'operating-review-read',
  'operating-review-receipt',
  'operating-trace-matrix',
  'operating-executive-board',
  'operate-live-evidence-provider-registration',
  'operate-live-evidence-provider-registry',
  'operating-live-evidence-consent-record',
  'operating-connector-checkpoint',
  'operating-live-evidence-ingestion',
  'operating-measurement-plan',
  'operating-measurement-schedule',
  'operating-measurement-schedule-receipt',
  'operating-evidence-observation',
  'operating-outcome-evaluation',
  'operating-learning-receipt',
];
export const OPERATE_LIVE_EVIDENCE_CONTRACT_KINDS_V2: readonly [
  'operate-live-evidence-provider-registration',
  'operate-live-evidence-provider-registry',
  'operating-live-evidence-consent-record',
  'operating-connector-checkpoint',
  'operating-live-evidence-ingestion',
  'operating-measurement-plan',
  'operating-measurement-schedule',
  'operating-measurement-schedule-receipt',
  'operating-evidence-observation',
  'operating-outcome-evaluation',
  'operating-learning-receipt',
];
export const LANDING_CONTRACT_KINDS_V1: readonly [
  'landing-plan',
  'landing-confirmation',
  'landing-event',
  'landing-phase-receipt',
  'landing-receipt',
  'landing-operation-registry',
];
export const RELEASE_LEDGER_CONTRACT_KINDS_V1: readonly [
  'release-ledger',
  'release-compatibility-claim',
  'release-ledger-receipt',
  'ecosystem-manifest',
];
export const OPERATE_ROLE_MANDATES_V2: readonly OperateRoleMandateV2[];
export const OPERATE_EXTENSION_CONTRACT_KINDS_V2: readonly [
  'agent-runtime-manifest',
  'operate-capability-provider-registration',
  'operate-domain-registration',
  'operate-evidence-provider-registration',
  'operate-evidence-resolver-registration',
  'operate-executor-registration',
  'operate-metric-provider-registration',
  'operate-policy-provider-registration',
  'operate-snapshot-provider-registration',
  'operate-verification-provider-registration',
];
export const OPERATE_EVIDENCE_CONTRACT_KINDS_V2: readonly [
  'operate-evidence-provider-registration',
  'operate-evidence-resolver-registration',
  'operating-evidence-candidate',
  'operating-evidence-edge',
  'operating-evidence-graph',
  'operating-evidence-ref',
  'operating-evidence-resolution',
];
export const OPERATE_EVIDENCE_KINDS_V2: readonly ['filesystem', 'git', 'operate-artifact', 'planr'];
export const OPERATE_EVIDENCE_EDGE_RELATIONS_V2: readonly ['contradictedBy', 'supportedBy'];
export const OPERATE_EVIDENCE_RESOLVER_ERROR_CODES_V2: readonly OperateEvidenceResolverErrorCodeV2[];
export const OPERATE_OPERATING_INTELLIGENCE_CONTRACT_KINDS_V2: readonly [
  'business-operating-snapshot-projection',
  'operating-action-verification-plan',
  'operating-advisor-result',
  'operating-assumption',
  'operating-challenger-review',
  'operating-claim',
  'operating-decision-ledger',
  'operating-delta',
  'operating-domain-projection',
  'operating-event-trigger',
  'operating-intelligence-input-bundle',
  'operating-intelligence-plan',
  'operating-learning',
  'operating-metric',
  'operating-metric-observation',
  'operating-model-state',
  'operating-objective',
  'operating-outcome',
  'operating-risk',
  'operating-scenario',
  'operating-snapshot',
  'operate-metric-provider-registration',
  'operate-snapshot-provider-registration',
  'operate-verification-provider-registration',
  'software-operating-snapshot-projection',
];
export const OPERATE_OPERATING_PROJECTION_IDENTITIES_V2: readonly [
  'business-operating-snapshot-projection@1.0.0',
  'software-operating-snapshot-projection@1.0.0',
];
export const OPERATE_OPERATING_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2: readonly [
  'operate-metric-provider-registration',
  'operate-snapshot-provider-registration',
  'operate-verification-provider-registration',
];
export const OPERATE_GOVERNED_EXECUTION_CONTRACT_KINDS_V2: readonly [
  'operate-capability-provider-registration',
  'operate-executor-registration',
  'operate-policy-provider-registration',
  'operating-action-policy',
  'operating-approval-record',
  'operating-approval-requirement',
  'operating-capability-availability',
  'operating-capability-grant',
  'operating-execution-result',
  'operating-governed-operation',
  'operating-policy-evaluation',
  'operating-rollback-plan',
  'operating-rollback-result',
];
export const OPERATE_GOVERNED_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2: readonly [
  'operate-capability-provider-registration',
  'operate-executor-registration',
  'operate-policy-provider-registration',
];
export const OPERATE_GOVERNED_EFFECT_CLASSES_V2: readonly OperateGovernedEffectClassV2[];
export const OPERATE_GOVERNED_POLICY_OUTCOMES_V2: readonly OperateGovernedPolicyOutcomeV2[];
export const OPERATE_GOVERNED_POLICY_TIERS_V2: readonly [
  Readonly<{ id: 'core'; precedence: 300; narrowingOnly: false }>,
  Readonly<{ id: 'project'; precedence: 200; narrowingOnly: true }>,
  Readonly<{ id: 'domain'; precedence: 100; narrowingOnly: true }>,
];
export const OPERATE_GOVERNED_CORE_PROHIBITIONS_V2: readonly [
  'credential-change',
  'customer-contact',
  'destructive',
  'funds-transfer',
  'payment-transfer',
  'production-deploy',
  'production-merge',
  'publication',
  'secret-mutation',
];
export const OPERATE_GOVERNED_RECOVERY_CLASSIFICATIONS_V2: readonly [
  'applied',
  'not-applied',
  'partial',
  'unknown',
];
export const OPERATE_EXPERIENCE_CONTRACT_KINDS_V2: readonly [
  'operate-experience-live-patch',
  'operate-experience-preview',
  'operate-experience-view',
  'operate-review-display-workspace',
  'operating-delivery-evidence',
  'operating-delivery-route',
  'operating-origin',
  'operating-planning-proposal',
];
export const OPERATING_DELIVERY_ROUTES_V1: readonly [
  'contained-execution',
  'human-external',
  'observe-only',
  'planning-work',
];
export function findOperateCoreProhibitionV2(
  values: string | readonly string[],
): (typeof OPERATE_GOVERNED_CORE_PROHIBITIONS_V2)[number] | null;
export const OPERATE_GOVERNED_OPERATION_STATES_V2: readonly OperateGovernedOperationStateV2[];
export const OPERATE_GOVERNED_OPERATION_TERMINAL_STATES_V2: readonly [
  'blocked',
  'failed',
  'partial',
  'succeeded',
  'uncertain',
];
export const OPERATE_EXECUTION_VERIFICATION_STATUSES_V2: readonly OperatingExecutionVerificationStatusV2[];
export const OPERATE_HYPOTHESIS_VERIFICATION_STATUSES_V2: readonly OperatingHypothesisVerificationStatusV2[];
export const OPERATE_GOVERNED_TOOL_OPERATIONS_V2: readonly [
  Readonly<{
    id: 'operate.action.approve';
    effect: 'project-write';
    argumentProfile: 'action-approve';
    docsSection: 'action-approve';
  }>,
  Readonly<{
    id: 'operate.action.execute';
    effect: 'project-write';
    argumentProfile: 'action-execute';
    docsSection: 'action-execute';
  }>,
  Readonly<{
    id: 'operate.action.rollback';
    effect: 'project-write';
    argumentProfile: 'action-rollback';
    docsSection: 'action-rollback';
  }>,
];
export const OPERATE_AUTHORITY_GUARD_IDS_V2: readonly [
  'action-approval-authorized',
  'action-execution-authorized',
  'action-rollback-authorized',
  'review-submit-authorized',
];
export const OPERATE_PUBLIC_DOMAIN_CONTRACT_BINDINGS_V2: Readonly<
  Record<'business' | 'software', PublicOperateDomainContractBindingV2>
>;
export const PROTOCOL_SCHEMA_REGISTRY: Readonly<Record<string, Readonly<Record<string, string>>>>;

export function loadProtocolContract(
  kind: string,
  options: { protocolVersion: string },
): ProtocolSchemaContract;
export function loadOperateRuntimeContract(
  kind: (typeof OPERATE_RUNTIME_CONTRACT_KINDS)[number],
  options: { protocolVersion: '2.0.0' },
): ProtocolSchemaContract;
export function loadOperateLiveEvidenceContract(
  kind: (typeof OPERATE_LIVE_EVIDENCE_CONTRACT_KINDS_V2)[number],
  options: { protocolVersion: '2.0.0' },
): ProtocolSchemaContract;
export function loadLandingContract(
  kind: (typeof LANDING_CONTRACT_KINDS_V1)[number],
  options: { protocolVersion: '1.2.0' },
): ProtocolSchemaContract;
export function loadReleaseLedgerContract(
  kind: (typeof RELEASE_LEDGER_CONTRACT_KINDS_V1)[number],
  options: { protocolVersion: '1.3.0' },
): ProtocolSchemaContract;
export function loadOperateExtensionContract(
  kind: (typeof OPERATE_EXTENSION_CONTRACT_KINDS_V2)[number],
  options: { protocolVersion: '2.0.0' },
): ProtocolSchemaContract;
export function loadOperateEvidenceContract(
  kind: (typeof OPERATE_EVIDENCE_CONTRACT_KINDS_V2)[number],
  options: { protocolVersion: '2.0.0' },
): ProtocolSchemaContract;
export function loadOperateOperatingIntelligenceContract(
  kind: (typeof OPERATE_OPERATING_INTELLIGENCE_CONTRACT_KINDS_V2)[number],
  options: { protocolVersion: '2.0.0' },
): ProtocolSchemaContract;
export function loadOperateGovernedExecutionContract(
  kind: (typeof OPERATE_GOVERNED_EXECUTION_CONTRACT_KINDS_V2)[number],
  options: { protocolVersion: '2.0.0' },
): ProtocolSchemaContract;
export function readOperatingGovernedOperationV2(
  value: unknown,
  options: { protocolVersion: '2.0.0' },
): OperatingGovernedOperationV2;
export function readOperatingExecutionResultV2(
  value: unknown,
  options: { protocolVersion: '2.0.0' },
): OperatingExecutionResultV2;
export function readOperatingRollbackPlanV2(
  value: unknown,
  options: { protocolVersion: '2.0.0' },
): OperatingRollbackPlanV2;
export function readOperatingRollbackResultV2(
  value: unknown,
  options: { protocolVersion: '2.0.0' },
): OperatingRollbackResultV2;
export function loadOperateGovernedExtensionContract(
  kind: (typeof OPERATE_GOVERNED_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2)[number],
  options: { protocolVersion: '2.0.0' },
): ProtocolSchemaContract;
export function loadOperateExperienceContract(
  kind: (typeof OPERATE_EXPERIENCE_CONTRACT_KINDS_V2)[number],
  options: { protocolVersion: '2.0.0' },
): ProtocolSchemaContract;
export function readOperateExperienceViewV1(
  value: unknown,
  options: { protocolVersion: '2.0.0' },
): OperateExperienceViewV1;
export function readOperatingPlanningProposalV1(
  value: unknown,
  options: { protocolVersion: '2.0.0' },
): OperatingPlanningProposalV1;
export function readOperatingOriginV1(
  value: unknown,
  options: { protocolVersion: '2.0.0' },
): OperatingOriginV1;
export function readOperatingDeliveryEvidenceV1(
  value: unknown,
  options: { protocolVersion: '2.0.0' },
): OperatingDeliveryEvidenceV1;
export function loadOperateRoleMandate(
  roleId: OperatePhase1AssignmentKindV2,
  options: { roleVersion: '2.0.0' },
): OperateRoleMandateV2;
export function assertOperateRoleOutputContract(
  roleId: OperatePhase1AssignmentKindV2,
  outputContract: OperateRoleOutputContractV2,
  options: { roleVersion: '2.0.0' },
): OperateRoleOutputContractV2 & { path: string };

export function readOperatingRuntimeStateV2(
  value: OperatingRuntimeStateV2,
  options: { protocolVersion: '2.0.0' },
): OperatingRuntimeStateV2;
export function assertOperateRuntimeBindingsV2(input: {
  cycle: OperatingCycleV2;
  inputBinding: OperatingCycleInputBindingV2;
  assignment: OperatingAssignmentV2;
  submission: OperatingSubmissionV2;
  runtimeBinding: OperatingCycleInputBindingV2['runtimeBinding'];
  runtimeState: OperatingRuntimeStateV2;
  checkpoint: OperatingCheckpointV2;
}): {
  cycle: OperatingCycleV2;
  inputBinding: OperatingCycleInputBindingV2;
  assignment: OperatingAssignmentV2;
  submission: OperatingSubmissionV2;
  runtimeBinding: OperatingCycleInputBindingV2['runtimeBinding'];
  runtimeState: OperatingRuntimeStateV2;
  checkpoint: OperatingCheckpointV2;
};

export function listProtocolSchemas(): Array<{
  kind: string;
  protocolVersion: string;
  path: string;
}>;
export function resolveProtocolSchema(
  kind: string,
  options: { protocolVersion: string },
): ProtocolSchemaContract;
export function resolveOperateExperienceSchemaV2(
  kind: (typeof OPERATE_EXPERIENCE_CONTRACT_KINDS_V2)[number],
  options: { protocolVersion: '2.0.0' },
): ProtocolSchemaContract;
export function assertOperateExperienceArtifactV2<T>(
  kind: (typeof OPERATE_EXPERIENCE_CONTRACT_KINDS_V2)[number],
  value: T,
): T;
export function validateOperateExperienceArtifactV2(
  kind: (typeof OPERATE_EXPERIENCE_CONTRACT_KINDS_V2)[number],
  value: unknown,
): ProtocolValidationError[];
export function validateProtocolArtifact(
  kind: string,
  value: unknown,
  options?: { protocolVersion?: string },
): ProtocolValidationError[];
export function validateDashboardBootstrapV1(value: unknown): ProtocolValidationError[];
export function assertDashboardBootstrapV1(value: DashboardBootstrapV1): DashboardBootstrapV1;
export function assertProtocolArtifact<T>(
  kind: string,
  value: T,
  options?: { protocolVersion?: string },
): T;
export function assertOperateGovernedExtensionRegistrationV2<T>(
  kind: (typeof OPERATE_GOVERNED_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2)[number],
  value: T,
): T;
export function canonicalizeJson(value: JsonValue): string;
export function sha256Jcs(value: JsonValue): string;

/**
 * Operating trace-matrix types.
 *
 * They live here rather than beside the builder because the dashboard's review workspace
 * declaration needs them, and reaching into the Operate runtime for a type put the
 * dashboard on that runtime. The builder imports them back.
 */

export type OperatingTraceNodeKindV2 =
  | 'requirement'
  | 'absence'
  | 'seat'
  | 'assignment'
  | 'artifact'
  | 'claim'
  | 'evidence-ref'
  | 'finding'
  | 'decision'
  | 'action'
  | 'disposition'
  | 'verification'
  | 'outcome';

export type OperatingTraceProofStateV2 =
  | 'not-applicable'
  | 'pending'
  | 'terminal'
  | 'accepted'
  | 'rejected'
  | 'failed'
  | 'abandoned'
  | 'verified'
  | 'stale'
  | 'supported'
  | 'contradicted'
  | 'contested'
  | 'unverified'
  | 'absent'
  | 'restricted'
  | 'proposed'
  | 'governed'
  | 'completed'
  | 'insufficient';

export type OperatingTraceRelationV2 =
  | 'declares'
  | 'assigned-to'
  | 'issued-as'
  | 'records'
  | 'produces'
  | 'contains'
  | 'supported-by'
  | 'contradicted-by'
  | 'informs'
  | 'challenges'
  | 'decides'
  | 'proposes'
  | 'disposes'
  | 'governed-by'
  | 'verified-by'
  | 'observed-as';

export interface OperatingTraceLocatorV2<
  TKind extends OperatingTraceNodeKindV2 = OperatingTraceNodeKindV2,
> {
  readonly kind: TKind;
  readonly id: string;
  readonly contract: Readonly<{ id: string; version: '2.0.0' }>;
  readonly scopeId: string;
  readonly domainId: string;
  readonly domainVersion: string;
  readonly cycleId: string;
}

interface OperatingTraceNodeBaseV2<
  TKind extends OperatingTraceNodeKindV2,
  TProof extends OperatingTraceProofStateV2,
> {
  readonly locator: OperatingTraceLocatorV2<TKind>;
  readonly accessState: 'available' | 'restricted' | 'absent';
  readonly proofState: TProof;
  readonly inboundEdgeIds: readonly string[];
  readonly outboundEdgeIds: readonly string[];
}

export type OperatingTraceNodeV2 =
  | OperatingTraceNodeBaseV2<'requirement', 'pending'>
  | OperatingTraceNodeBaseV2<'absence', 'absent'>
  | OperatingTraceNodeBaseV2<'seat', 'not-applicable' | 'absent'>
  | OperatingTraceNodeBaseV2<
      'assignment',
      'pending' | 'terminal' | 'rejected' | 'failed' | 'abandoned'
    >
  | OperatingTraceNodeBaseV2<'artifact', 'accepted' | 'restricted'>
  | OperatingTraceNodeBaseV2<
      'claim',
      'supported' | 'contradicted' | 'contested' | 'unverified' | 'restricted'
    >
  | OperatingTraceNodeBaseV2<'evidence-ref', 'verified' | 'stale' | 'unverified' | 'restricted'>
  | OperatingTraceNodeBaseV2<'finding', 'proposed' | 'restricted'>
  | OperatingTraceNodeBaseV2<'decision', 'proposed' | 'governed' | 'restricted'>
  | OperatingTraceNodeBaseV2<'action', 'proposed' | 'governed' | 'completed' | 'insufficient'>
  | OperatingTraceNodeBaseV2<'disposition', 'governed'>
  | OperatingTraceNodeBaseV2<'verification', 'governed'>
  | OperatingTraceNodeBaseV2<'outcome', 'verified' | 'insufficient'>;

export interface OperatingTraceEndpointV2<
  TKind extends OperatingTraceNodeKindV2 = OperatingTraceNodeKindV2,
> {
  readonly kind: TKind;
  readonly id: string;
}

interface OperatingTraceEdgeBaseV2<
  TRelation extends OperatingTraceRelationV2,
  TFrom extends OperatingTraceNodeKindV2,
  TTo extends OperatingTraceNodeKindV2,
> {
  readonly edgeId: string;
  readonly relation: TRelation;
  readonly from: OperatingTraceEndpointV2<TFrom>;
  readonly to: OperatingTraceEndpointV2<TTo>;
}

export type OperatingTraceEdgeV2 =
  | OperatingTraceEdgeBaseV2<'declares', 'absence', 'requirement'>
  | OperatingTraceEdgeBaseV2<'assigned-to', 'requirement', 'seat'>
  | OperatingTraceEdgeBaseV2<'issued-as', 'seat', 'assignment'>
  | OperatingTraceEdgeBaseV2<'records', 'absence', 'seat' | 'assignment'>
  | OperatingTraceEdgeBaseV2<'produces', 'assignment', 'artifact'>
  | OperatingTraceEdgeBaseV2<'contains', 'artifact', 'claim'>
  | OperatingTraceEdgeBaseV2<'supported-by', 'claim', 'evidence-ref'>
  | OperatingTraceEdgeBaseV2<'contradicted-by', 'claim', 'evidence-ref'>
  | OperatingTraceEdgeBaseV2<'informs', 'claim' | 'evidence-ref', 'finding' | 'decision'>
  | OperatingTraceEdgeBaseV2<'challenges', 'finding', 'decision'>
  | OperatingTraceEdgeBaseV2<'decides', 'artifact', 'decision'>
  | OperatingTraceEdgeBaseV2<'proposes', 'decision', 'action'>
  | OperatingTraceEdgeBaseV2<'disposes', 'artifact' | 'finding' | 'decision', 'disposition'>
  | OperatingTraceEdgeBaseV2<'governed-by', 'action', 'verification'>
  | OperatingTraceEdgeBaseV2<'verified-by', 'action', 'outcome'>
  | OperatingTraceEdgeBaseV2<'observed-as', 'verification', 'outcome'>;

export type OperatingTraceOmissionV2 =
  | Readonly<{
      omissionId: string;
      kind: 'restricted';
      subject: OperatingTraceNodeKindV2;
      subjectId: string;
      reasonCode: 'OPERATE_TRACE_ACCESS_RESTRICTED';
      incidentEdgeCount: number;
    }>
  | Readonly<{
      omissionId: string;
      kind: 'absent';
      subject: 'absence';
      subjectId: string;
      reasonCode: 'OPERATE_TRACE_TYPED_ABSENCE' | 'OPERATE_TRACE_ROLE_NOT_SELECTED';
      incidentEdgeCount: number;
    }>;

export interface OperatingTraceProofV2 {
  readonly terminalAssignments: number;
  readonly acceptedArtifacts: number;
  readonly verifiedEvidence: number;
  readonly staleEvidence: number;
  readonly supportedClaims: number;
  readonly contradictedClaims: number;
  readonly unverifiedClaims: number;
  readonly restrictedNodes: number;
  readonly typedAbsences: number;
  readonly verifiedActions: number;
}

export interface OperatingTraceMatrixV2 {
  readonly kind: 'operating-trace-matrix';
  readonly schemaVersion: '1.0.0';
  readonly protocolVersion: '2.0.0';
  readonly matrixId: string;
  readonly scopeId: string;
  readonly domainId: string;
  readonly domainVersion: string;
  readonly cycleId: string;
  readonly eventHead: OperatingEventHeadV2;
  readonly limits: Readonly<{ maxNodes: 8192; maxEdges: 32768; truncated: false }>;
  readonly nodes: readonly OperatingTraceNodeV2[];
  readonly edges: readonly OperatingTraceEdgeV2[];
  readonly omissions: readonly OperatingTraceOmissionV2[];
  readonly proof: Readonly<OperatingTraceProofV2>;
  readonly matrixHash: string;
}

/**
 * Operating executive-board types.
 *
 * The protocol's own event map and runtime state name the materialized board, so the types
 * live here rather than beside the builder. The builder imports them back.
 */

export interface OperatingExecutiveBoardSeatBindingV2 {
  readonly roleId: string;
  readonly roleKind: 'advisor' | 'challenger' | 'chair';
  readonly roleVersion: string;
  readonly assignmentId: string | null;
  readonly artifactId: string | null;
  readonly absenceId: string | null;
}

interface OperatingExecutiveBoardBaseV2 {
  readonly kind: 'operating-executive-board';
  readonly schemaVersion: '1.0.0';
  readonly protocolVersion: '2.0.0';
  readonly boardId: string;
  readonly scopeId: string;
  readonly domainId: 'business';
  readonly domainVersion: string;
  readonly cycleId: string;
  readonly planId: string;
  readonly ledgerId: string;
  readonly reviewId: string;
  readonly reviewHash: string;
  readonly sourceEventHead: OperatingEventHeadV2;
  readonly seatBindings: readonly Readonly<OperatingExecutiveBoardSeatBindingV2>[];
  readonly findingIds: readonly string[];
  readonly decisionIds: readonly string[];
  readonly actionIds: readonly string[];
  readonly traceMatrix: OperatingTraceMatrixV2;
  readonly createdAt: string;
  readonly semanticHash: string;
  readonly boardHash: string;
}

export interface OperatingExecutiveBoardMaterializedV2 extends OperatingExecutiveBoardBaseV2 {
  readonly projectionMode: 'materialized';
  readonly authoritativeForMutation: true;
  readonly materializedEventId: string;
}

export interface OperatingExecutiveBoardCompatibilityV2 extends OperatingExecutiveBoardBaseV2 {
  readonly projectionMode: 'compatibility';
  readonly authoritativeForMutation: false;
  readonly materializedEventId: null;
}

export type OperatingExecutiveBoardV2 =
  | OperatingExecutiveBoardMaterializedV2
  | OperatingExecutiveBoardCompatibilityV2;
