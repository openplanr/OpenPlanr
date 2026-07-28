export const OPERATE_PROTOCOL_VERSION = '1.2.0' as const;
export const OPERATE_SCHEMA_VERSION = '1.0.0' as const;

export interface ProtocolArtifact<K extends string> {
  kind: K;
  schemaVersion: typeof OPERATE_SCHEMA_VERSION;
  protocolVersion: typeof OPERATE_PROTOCOL_VERSION;
}

export type OperatingSensitivity = 'public' | 'internal' | 'confidential' | 'restricted';
export type OperatingPlanningEngine = 'openplanr' | 'pipeline-po';
export type OperatingRoleId =
  | 'strategy-finance'
  | 'technology-risk'
  | 'product-activation'
  | 'growth-market'
  | 'operations-customer'
  | 'chair';
export type OperatingLane = 'DEV' | 'OWNER' | 'AGENT';
export type OperatingCycleStatus =
  | 'preparing'
  | 'collecting'
  | 'advising'
  | 'consolidating'
  | 'reviewable'
  | 'closed'
  | 'blocked'
  | 'failed'
  | 'cancelled';
export type OperatingCriticalRiskCategory =
  | 'security'
  | 'privacy'
  | 'payment-integrity'
  | 'legal'
  | 'tenant-isolation'
  | 'destructive-data';

export interface OperatingAdvisorBrief {
  kind: 'operating-advisor-brief';
  schemaVersion: '1.0.0';
  protocolVersion: typeof OPERATE_PROTOCOL_VERSION;
  role: {
    id: OperatingRoleId;
    displayLabel: string;
    mandate: string;
    capabilityTier: 'analysis-standard' | 'analysis-high';
  };
  authority: {
    readOnly: true;
    writeBoundary: 'none';
    sharedBoundaries: string[];
    forbiddenRecommendationCategories: string[];
  };
  evidence: {
    permittedKinds: string[];
    requiredFields: string[];
    sensitivityCeiling: OperatingSensitivity;
    minimum: Record<string, unknown>;
  };
  output: {
    schema: string;
    allowedProposalTypes: Array<'finding' | 'decision' | 'data-gap' | 'merge' | 'sequence'>;
    maximumProposals: number;
    maximumOutputBytes: number;
    requiredBehavior: string[];
    scoring: Record<string, unknown> | null;
  };
  budgets: Record<string, unknown>;
  failureBehavior: string;
  briefDigest: `sha256:${string}`;
}

export type OperateErrorCode =
  | 'E_OPERATE_INTERNAL'
  | 'E_OPERATE_PROJECT_REQUIRED'
  | 'E_OPERATE_NOT_INITIALIZED'
  | 'E_OPERATE_CONFIG_INVALID'
  | 'E_OPERATE_CHARTER_INCOMPLETE'
  | 'E_OPERATE_PATH_ESCAPE'
  | 'E_OPERATE_STATE_INVALID'
  | 'E_OPERATE_HEAD_DIVERGED'
  | 'E_OPERATE_CHECKPOINT_INVALID'
  | 'E_OPERATE_CYCLE_ACTIVE'
  | 'E_OPERATE_CYCLE_INPUT_CONFLICT'
  | 'E_OPERATE_CYCLE_NOT_DISPOSED'
  | 'E_OPERATE_STALE_LOCK_UNSAFE'
  | 'E_OPERATE_TRANSACTION_INVALID'
  | 'E_OPERATE_EVIDENCE_REJECTED'
  | 'E_OPERATE_EVIDENCE_BUDGET'
  | 'E_OPERATE_SECRET_DETECTED'
  | 'E_OPERATE_PROVIDER_READ_ONLY'
  | 'E_OPERATE_ADVISOR_ISOLATION'
  | 'E_OPERATE_ADVISOR_FAILED'
  | 'E_OPERATE_EVIDENCE_NOT_READY'
  | 'E_OPERATE_CAP_EXCEEDED'
  | 'E_OPERATE_CRITICAL_CAP'
  | 'E_OPERATE_AUTHORITY_REQUIRED'
  | 'E_OPERATE_ROUTE_CONFIRMATION_REQUIRED'
  | 'E_OPERATE_ROUTE_DRIFT'
  | 'E_OPERATE_PLANNER_CONFLICT'
  | 'E_OPERATE_OUTCOME_NOT_READY'
  | 'E_OPERATE_PROJECTION_DRIFT'
  | 'E_OPERATE_ARTIFACT_REJECTED'
  | 'E_OPERATE_MIGRATION_CONFLICT'
  | 'E_OPERATE_SECURITY_REPAIR_REQUIRED'
  | 'E_OPERATE_INPUT_TOO_LARGE'
  | 'E_OPERATE_ACTION_UNKNOWN'
  | 'E_PIPELINE_NOT_INSTALLED';

export class OperateError extends Error {
  readonly code: OperateErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: OperateErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = code;
    this.code = code;
    this.details = details;
  }
}

/** Exact persisted Protocol v1.2 operating configuration. */
export interface OperatingConfig extends ProtocolArtifact<'operating-config'> {
  profile: 'saas' | 'product' | 'engineering' | 'custom';
  decisionOwner: string;
  cadence: 'manual' | 'weekly' | 'monthly';
  planningEngine: OperatingPlanningEngine;
  enabledRoles: OperatingRoleId[];
  enabledProviders: string[];
  caps: {
    surfacedFindings: number;
    newSpecs: number;
    openDecisions: number;
    agentArtifacts: number;
  };
  budgets: {
    maxFiles: number;
    maxItems: number;
    maxBytes: number;
    maxDurationMs: number;
  };
}

export interface OperatingProfile {
  id: OperatingConfig['profile'];
  title: string;
  description: string;
  enabledRoles: OperatingRoleId[];
  enabledProviders: string[];
  caps: OperatingConfig['caps'];
  budgets: OperatingConfig['budgets'];
}

export interface OperatingCharter {
  purpose: string;
  stage: string;
  businessModel: string;
  idealCustomer: string;
  goals: string[];
  constraints: string[];
  successMetrics: string[];
  guardrails: string[];
  knownUnknowns: string[];
}

export interface OperatingLocalPreferences {
  runtime: 'auto' | 'claude' | 'codex' | 'cursor';
  timezone: string;
  sensitivityCeiling: OperatingSensitivity;
  evidenceTtlMs: number;
  enabledSources: string[];
  /** Machine-local, workspace-contained JSON/CSV evidence paths. */
  importPaths?: string[];
}

export interface OperatingWorkspaceComponent {
  componentId: string;
  canonicalRemote: string;
  configuredBranch: string;
  pinnedRevision: string;
  dirtyFingerprint: `sha256:${string}` | null;
  readOnly: boolean;
}

export interface OperatingWorkspaceManifest
  extends ProtocolArtifact<'operating-workspace-manifest'> {
  capturedAt: string;
  workspaceDigest: `sha256:${string}`;
  controlRepository: OperatingWorkspaceComponent & { readOnly: false };
  components: Array<OperatingWorkspaceComponent & { readOnly: true }>;
}

/** Machine-local mapping. Absolute paths never enter commit-safe artifacts. */
export interface OperatingWorkspaceRoots {
  controlComponentId: string;
  roots: Record<string, string>;
}

export interface OperatingContentReference {
  algorithm: 'sha256';
  digest: `sha256:${string}`;
  mediaType: 'application/json';
  size: number;
  sensitivity: OperatingSensitivity;
}

export interface OperatingRecordEnvelope extends ProtocolArtifact<'operating-record'> {
  digest: `sha256:${string}`;
  recordType:
    | 'evidence-metadata'
    | 'advisor-result'
    | 'finding'
    | 'decision'
    | 'data-gap'
    | 'route'
    | 'spec-link'
    | 'outcome'
    | 'artifact-manifest'
    | 'migration'
    | 'recovery';
  createdAt: string;
  correlationId: string;
  contentDigest: `sha256:${string}`;
  content: Record<string, unknown>;
}

export type OperatingEventType =
  | `cycle.${OperatingCycleStatus}`
  | 'evidence.collected'
  | 'advisory.recorded'
  | 'finding.proposed'
  | 'finding.accepted'
  | 'finding.queued'
  | 'finding.in-progress'
  | 'finding.done'
  | 'finding.rejected'
  | 'finding.superseded'
  | 'decision.open'
  | 'decision.answered'
  | 'decision.closed'
  | 'decision.default-due'
  | 'decision.superseded'
  | 'gap.open'
  | 'gap.answered'
  | 'gap.verified'
  | 'gap.closed'
  | 'gap.superseded'
  | 'route.proposed'
  | 'route.accepted'
  | 'route.prepared'
  | 'route.applied'
  | 'route.failed'
  | 'route.rolled_back'
  | 'spec.linked'
  | 'artifact.created'
  | 'ship.observed'
  | 'outcome.registered'
  | 'outcome.observed'
  | 'outcome.evaluated'
  | 'learning.recorded'
  | 'projection.rebuilt'
  | 'migration.legacy-imported'
  | 'recovery.performed'
  | 'security.discontinuity';

export interface OperatingEvent extends ProtocolArtifact<'operating-event'> {
  eventId: string;
  sequence: number;
  timestamp: string;
  cycleId: string;
  type: OperatingEventType;
  entityId: string;
  previousEventHash: `sha256:${string}` | null;
  eventHash: `sha256:${string}`;
  actor: { kind: 'human' | 'engine' | 'runtime' | 'migration'; id: string };
  causationId: string | null;
  correlationId: string;
  evidenceRefs: string[];
  payload: Record<string, unknown>;
}

export interface OperatingEventHead {
  sequence: number;
  hash: `sha256:${string}` | null;
}

export interface OperatingCheckpoint extends ProtocolArtifact<'operating-checkpoint'> {
  createdAt: string;
  eventHead: OperatingEventHead;
  stateHash: `sha256:${string}`;
  recordDigests: `sha256:${string}`[];
  integrity:
    | { status: 'hash' }
    | {
        status: 'signed';
        signature: {
          algorithm: 'ed25519' | 'hmac-sha256';
          keyId: string;
          value: string;
        };
      };
  state: OperatingState;
}

export interface OperatingCycleManifest extends ProtocolArtifact<'operating-cycle-manifest'> {
  id: string;
  state: OperatingCycleStatus;
  health?: 'normal' | 'quiet' | 'partial' | 'blocked';
  depth: 'standard' | 'deep' | 'review-only';
  focus: Array<'strategy' | 'product' | 'growth' | 'operations' | 'technology' | 'all'>;
  inputDigest: `sha256:${string}`;
  enabledRoles: string[];
  enabledProviders: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  producer: { product: string; version: string; runtime: string };
  warnings?: string[];
}

export interface OperatingEvidenceItem {
  id: string;
  source: string;
  location: string;
  digest: `sha256:${string}`;
  collectedAt: string;
  observedFrom: string | null;
  observedTo: string | null;
  freshness: 'fresh' | 'stale' | 'unknown';
  sensitivity: OperatingSensitivity;
  claimTypes: string[];
  repository?: {
    componentId: string;
    canonicalRemote: string;
    revision: string;
    configuredBranch: string;
    dirtyFingerprint: `sha256:${string}` | null;
  };
  metric?: {
    identity: string;
    query: string;
    observedFrom: string;
    observedTo: string;
  };
  summary?: string;
}

export interface CollectedEvidenceItem {
  id: string;
  source: string;
  location: string;
  content: string;
  collectedAt: string;
  observedFrom?: string | null;
  observedTo?: string | null;
  freshness: OperatingEvidenceItem['freshness'];
  sensitivity: OperatingSensitivity;
  claimTypes: string[];
  quality: 'verified' | 'observed' | 'self-reported' | 'unknown';
  coverage: 'complete' | 'partial' | 'unknown';
  verifiedRiskCategories?: OperatingCriticalRiskCategory[];
  metric?: {
    identity: string;
    query: string;
    observedFrom: string;
    observedTo: string;
  };
  repository?: RepositoryEvidenceProvenance;
}

export interface OperatingEvidence extends ProtocolArtifact<'operating-evidence'> {
  cycleId: string;
  fingerprint: `sha256:${string}`;
  collectedAt: string;
  truncated: boolean;
  items: OperatingEvidenceItem[];
  delta?: {
    mode: 'baseline' | 'standard' | 'deep';
    baselineFingerprint: `sha256:${string}` | null;
    changedEvidenceRefs: string[];
    requiredEvidenceRefs: string[];
    selectedEvidenceRefs: string[];
    removedEvidenceRefs: string[];
  };
  sources: Array<{
    id: string;
    fingerprint: `sha256:${string}`;
    status: 'collected' | 'unchanged' | 'partial' | 'unavailable' | 'failed';
    itemCount: number;
    byteCount: number;
  }>;
  warnings: string[];
}

export interface RepositoryEvidenceProvenance {
  componentId: string;
  canonicalRemote: string;
  revision: string;
  configuredBranch: string;
  dirtyFingerprint: `sha256:${string}` | null;
  relativePath: string;
  digest: `sha256:${string}`;
  freshness: OperatingEvidenceItem['freshness'];
  sensitivity: OperatingSensitivity;
  collectedAt: string;
}

export interface EvidenceBudget {
  maxFiles: number;
  maxItems: number;
  maxBytes: number;
  maxItemBytes: number;
  maxDurationMs: number;
}

export interface EvidenceRequirement {
  source: string;
  claimTypes: string[];
  minimumItems: number;
  maxAgeHours: number;
  observationWindow: 'current-state' | 'current-cycle' | '7d' | '30d' | '90d' | '365d';
  sensitivityCeiling: OperatingSensitivity;
}

export interface OperatingEvidenceReadiness
  extends ProtocolArtifact<'operating-evidence-readiness'> {
  cycleId: string;
  inputDigest: `sha256:${string}`;
  evaluatedAt: string;
  roles: Array<{
    roleId: OperatingRoleId;
    readiness: 'ready' | 'not_evaluated';
    requirements: Array<
      EvidenceRequirement & {
        observedItems: number;
        oldestAgeHours: number | null;
        satisfied: boolean;
      }
    >;
    missingEvidence: string[];
    evidenceRefs: string[];
    modelCallAllowed: boolean;
    gapId: string | null;
  }>;
}

export interface OperatingRoleResult extends ProtocolArtifact<'operating-role-result'> {
  cycleId: string;
  roleId: OperatingRoleId;
  inputDigest: `sha256:${string}`;
  resultDigest: `sha256:${string}`;
  outcome: 'proposals' | 'quiet' | 'failed';
  proposals: Array<{
    proposalKey: string;
    type: 'finding' | 'decision' | 'data-gap' | 'merge' | 'sequence';
    title: string;
    problem: string;
    proposal: string;
    impact: number;
    confidence: number;
    ease: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
    evidenceRefs: string[];
    dependsOnProposalKeys?: string[];
    conflictsWithProposalKeys?: string[];
    /** Ordered Chair sequence used to resolve declared conflicts. */
    sequenceProposalKeys?: string[];
  }>;
  gaps: string[];
  conflicts: string[];
  producer: {
    product: string;
    version: string;
    runtime: string;
    capability: 'analysis-standard' | 'analysis-high';
  };
}

export interface OperatingProviderManifest extends ProtocolArtifact<'operating-provider-manifest'> {
  id: string;
  providerId: string;
  providerVersion: string;
  mode: 'structured' | 'native-isolated';
  readOnly: true;
  endpoint: {
    kind: 'local' | 'remote' | 'import';
    display: string;
    authentication: 'none' | 'machine-local';
    redacted: true;
  };
  permittedDataClasses: Array<
    | 'source-code'
    | 'planning-artifacts'
    | 'git-metadata'
    | 'issue-metadata'
    | 'project-metadata'
    | 'outcome-observations'
    | 'imported-documents'
  >;
  retention: {
    providerStoresRequestContent: boolean;
    maxProviderRetentionDays: number;
    localEvidenceRetention: 'cycle' | 'project' | 'user-managed';
  };
  capabilities: {
    incremental: boolean;
    deep: boolean;
    toolIsolation: 'enforced' | 'not-applicable';
  };
  limits: {
    maxItems: number;
    maxBytes: number;
    maxDurationMs: number;
    maxRequests: number | null;
    maxTokens: number | null;
    maxCostUsd: number | null;
  };
  consent: {
    policyVersion: string;
    status: 'first-use' | 'renewed';
    acceptedAt: string;
    renewedAt: string | null;
    nextReviewAt: string | null;
    renewalTriggers: Array<
      'policy-change' | 'scope-expansion' | 'credential-renewal' | 'scheduled-review'
    >;
  };
  policyDigest: `sha256:${string}`;
  configurationDigest: `sha256:${string}`;
  capturedAt: string;
}

export interface OperatingFinding extends ProtocolArtifact<'operating-finding'> {
  id: string;
  cycleId: string;
  title: string;
  category: string;
  problem: string;
  cost: string;
  proposal: string;
  /** Stable semantic identity used for cross-cycle suppression and lineage. */
  fingerprint?: `sha256:${string}`;
  impact: number;
  confidence: number;
  /** Evidence-derived maximum; human amendments may lower but never exceed it. */
  confidenceCeiling?: number;
  ease: number;
  score: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Highest sensitivity among all cited evidence. */
  sensitivity: OperatingSensitivity;
  criticalOverride: boolean;
  lane: OperatingLane;
  owner: string;
  evidenceRefs: string[];
  status: 'proposed' | 'accepted' | 'queued' | 'in-progress' | 'done' | 'rejected' | 'superseded';
  dependsOn: string[];
  parked?: boolean;
  stalledCycles?: number;
  supersededBy?: string;
  rejectionReason?: string;
  scoreAmendment?: {
    prior: { impact: number; confidence: number; ease: number };
    next: { impact: number; confidence: number; ease: number };
    reason: string;
    actor: { kind: 'human'; id: string };
    timestamp: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface OperatingDecision extends ProtocolArtifact<'operating-decision'> {
  id: string;
  cycleId: string;
  question: string;
  options: Array<{ id: string; label: string }>;
  recommendation: string;
  consequences: string;
  reversibility: 'reversible' | 'costly' | 'one-way';
  deadline: string;
  proposedDefault: string | null;
  unblocks: string[];
  status: 'open' | 'answered' | 'closed' | 'default-due' | 'superseded';
  owner: string;
  selectedOption?: string;
  note?: string;
  evidenceRefs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OperatingDataGap extends ProtocolArtifact<'operating-data-gap'> {
  id: string;
  cycleId: string;
  question: string;
  reason: string;
  unblocks: string[];
  affectedRoles?: string[];
  status: 'open' | 'answered' | 'verified' | 'closed' | 'superseded';
  owner: string;
  answer?: string;
  evidenceRefs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OperatingRouteAction {
  id: string;
  findingId: string;
  lane: OperatingLane;
  owner: string;
  kind: 'create-spec' | 'create-instrumentation-spec' | 'create-decision' | 'create-cycle-artifact';
  dependsOn: string[];
  evidenceRefs: string[];
  reversible: true;
  requiresConfirmation: true;
  targetPath?: string;
}

export interface OperatingRoutePlan extends ProtocolArtifact<'operating-route-plan'> {
  id: string;
  cycleId: string;
  inputDigest: `sha256:${string}`;
  routeDigest: `sha256:${string}`;
  previewDigest: `sha256:${string}`;
  workspaceDigest: `sha256:${string}`;
  evidenceDigest: `sha256:${string}`;
  providerDigest: `sha256:${string}`;
  destinationDigest: `sha256:${string}`;
  eventHead: OperatingEventHead;
  state: 'proposed' | 'accepted' | 'prepared' | 'applied' | 'failed' | 'rolled_back';
  actions: OperatingRouteAction[];
  createdAt: string;
  appliedAt?: string | null;
  rolledBackAt?: string | null;
  failure?: string;
}

export interface OperatingOutcome extends ProtocolArtifact<'operating-outcome'> {
  id: string;
  sourceCycle: string;
  sourceFinding: string;
  specId: string;
  outcomeKind: 'metric' | 'guardrail' | 'operational';
  metric: string;
  unit: string;
  queryIdentity: string;
  direction: 'increase' | 'decrease' | 'maintain' | 'range';
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'between';
  aggregation:
    | 'sum'
    | 'average'
    | 'median'
    | 'minimum'
    | 'maximum'
    | 'count'
    | 'rate'
    | 'percentile'
    | 'latest';
  baselineWindow: { from: string; to: string };
  targetWindow: { from: string; to: string };
  threshold: { value: number; upperValue?: number };
  minimumCoverage: number;
  minimumSample: number;
  stalePolicy: 'inconclusive' | 'create-gap';
  missingPolicy: 'inconclusive' | 'create-gap';
  guardrailPrecedence: 'block-on-breach' | 'outcome-first';
  guardrails: Array<{
    metric: string;
    unit: string;
    operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'between';
    threshold: number;
    upperThreshold?: number;
  }>;
  source: string;
  observationWindow: string;
  verifyAfter: string;
  rollout: string;
  rollback: string;
  status: 'pending' | 'observing' | 'positive' | 'neutral' | 'negative' | 'inconclusive';
  evidenceRefs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OperatingOutcomeObservation
  extends ProtocolArtifact<'operating-outcome-observation'> {
  id: string;
  outcomeId: string;
  observedAt: string;
  window: { from: string; to: string };
  value: number | null;
  unit: string;
  queryIdentity: string;
  aggregation: OperatingOutcome['aggregation'];
  sampleSize: number;
  coverage: number;
  freshness: 'fresh' | 'stale' | 'unknown';
  guardrails: Array<{
    metric: string;
    breached: boolean;
    observedValue?: number | null;
  }>;
  evaluation: 'positive' | 'neutral' | 'negative' | 'inconclusive';
  evidenceRefs: string[];
}

export interface OperatingState extends ProtocolArtifact<'operating-state'> {
  generatedAt: string;
  eventHead: OperatingEventHead;
  cycles: Array<Record<string, unknown> & { id: string; state: OperatingCycleStatus }>;
  findings: Array<Record<string, unknown> & { id: string; status: OperatingFinding['status'] }>;
  decisions: Array<
    Record<string, unknown> & {
      id: string;
      status: OperatingDecision['status'];
    }
  >;
  dataGaps: Array<Record<string, unknown> & { id: string; status: OperatingDataGap['status'] }>;
  routes: Array<Record<string, unknown> & { id: string; state: OperatingRoutePlan['state'] }>;
  specLinks: Array<Record<string, unknown> & { specId: string }>;
  outcomes: Array<Record<string, unknown> & { id: string; status: OperatingOutcome['status'] }>;
  learnings: Array<Record<string, unknown> & { id: string }>;
  evidenceSources: Array<Record<string, unknown> & { id: string }>;
  summary: {
    currentCycleId: string | null;
    currentConstraint: string | null;
    quiet: boolean;
    evidenceFreshness: 'fresh' | 'stale' | 'mixed' | 'unknown';
    surfacedFindings: number;
    parkedFindings: number;
    openDecisions: number;
    openGaps: number;
    stalledItems: number;
  };
}

export interface OperatingTransactionJournal
  extends ProtocolArtifact<'operating-transaction-journal'> {
  transactionId: string;
  state: 'prepared' | 'staged-fsynced' | 'promoted' | 'committed' | 'rolled-back' | 'failed';
  eventHead: OperatingEventHead;
  previewDigest: `sha256:${string}`;
  createdAt: string;
  updatedAt: string;
  writes: Array<{
    path: string;
    operation: 'create' | 'replace' | 'append';
    beforeDigest: `sha256:${string}` | null;
    afterDigest: `sha256:${string}`;
    mode: `0${string}`;
  }>;
  failureCode?: string;
}

/** Machine-local lease; deliberately not a Protocol artifact. */
export interface OperatingLockRecord {
  projectKey: string;
  nonce: string;
  pid: number;
  host: string;
  processStartedAt: string;
  createdAt: string;
  heartbeatAt: string;
  leaseDurationMs: number;
  leaseExpiresAt: string;
  expectedEventHead: OperatingEventHead;
}

export interface OperatingArtifactSession extends ProtocolArtifact<'operating-artifact-session'> {
  id: string;
  cycleId: string;
  state: 'prepared' | 'generating' | 'validated' | 'committed' | 'failed' | 'cancelled';
  artifactType: 'markdown' | 'html' | 'json' | 'csv';
  inputDigest: `sha256:${string}`;
  outputDigest?: `sha256:${string}`;
  destination: string;
  evidenceRefs: string[];
  producer: {
    product: string;
    version: string;
    runtime: string;
    capability: 'analysis-standard' | 'analysis-high';
  };
  createdAt: string;
  updatedAt: string;
  failureCode?: string;
}

export interface OperatingMigrationRecord extends ProtocolArtifact<'operating-migration-record'> {
  id: string;
  sourceKind: 'prototype-board' | 'protocol-upgrade';
  sourceDigest: `sha256:${string}`;
  state: 'previewed' | 'applied' | 'rolled-back' | 'conflict' | 'failed';
  previewDigest: `sha256:${string}`;
  backupManifestDigest: `sha256:${string}`;
  mappings: Array<{
    sourceId: string;
    targetId: string;
    eventId: string;
  }>;
  conflicts: string[];
  createdAt: string;
  updatedAt: string;
  failureCode?: string;
}

export interface OperatingRecoveryRecord extends ProtocolArtifact<'operating-recovery-record'> {
  id: string;
  transactionId: string | null;
  action: 'rebuild-projection' | 'recover-journal' | 'rollback' | 'forward-fix' | 'restore-backup';
  reason: string;
  previewDigest: `sha256:${string}`;
  fromHead: OperatingEventHead;
  toHead: OperatingEventHead;
  outcome: 'recovered' | 'blocked' | 'failed';
  confirmedBy: string;
  createdAt: string;
}

export interface OperateActionRequest {
  action: string;
  projectRoot: string;
  arguments?: Record<string, unknown>;
  options: Record<string, unknown>;
  interactive: boolean;
  stdin?: string;
}

export interface OperateActionResult {
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
  ok: boolean;
  action: string;
  code?: string;
  message?: string;
  cycleId?: string | null;
  state?: string | null;
  paths: Record<string, string>;
  counts: Record<string, number>;
  warnings: string[];
  nextActions: string[];
  data?: unknown;
  preview?: unknown;
  next?: string[];
  /** Compatibility fields consumed by the current human renderer. */
  lines?: string[];
  exitCode?: number;
}
