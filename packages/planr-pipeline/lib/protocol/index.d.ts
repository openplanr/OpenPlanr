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

export interface OperatingScoreComponents {
  impact: 1 | 2 | 3 | 4 | 5;
  confidence: 1 | 2 | 3 | 4 | 5;
  ease: 1 | 2 | 3 | 4 | 5;
}

export interface OperatingScoreAmendment {
  prior: OperatingScoreComponents;
  next: OperatingScoreComponents;
  reason: string;
  actor: { kind: 'human'; id: string };
  timestamp: string;
}

export interface OperatingSecurityDiscontinuityPayload {
  oldHead: OperatingEventHead;
  oldCheckpoint: {
    stateHash: string;
    integrityStatus: 'hash' | 'signed';
    keyId: string | null;
  } | null;
  authority: {
    kind: 'human';
    id: string;
    confirmedAt: string;
  };
  remediation: {
    reasonDigest: string;
    guidanceDigest: string;
    affectedPathsDigest: string;
    quarantineManifestDigest: string;
  };
  recoveryRecordDigest: string;
  requiresSignedCheckpoint: true;
}

export interface OperatingEvent {
  kind: 'operating-event';
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
  eventId: string;
  sequence: number;
  timestamp: string;
  cycleId: string;
  type: string;
  entityId: string;
  previousEventHash: string | null;
  eventHash: string;
  actor: { kind: 'human' | 'engine' | 'runtime' | 'migration'; id: string };
  causationId: string | null;
  correlationId: string;
  evidenceRefs: string[];
  payload: Record<string, JsonValue>;
}

export interface OperatingEventHead {
  sequence: number;
  hash: string | null;
}

export interface OperatingRepositoryProvenance {
  componentId: string;
  canonicalRemote: string;
  revision: string;
  configuredBranch: string;
  dirtyFingerprint: string | null;
}

export interface OperatingEvidenceItem {
  id: string;
  source: string;
  location: string;
  digest: string;
  collectedAt: string;
  observedFrom: string | null;
  observedTo: string | null;
  freshness: 'fresh' | 'stale' | 'unknown';
  sensitivity: 'public' | 'internal' | 'confidential' | 'restricted';
  claimTypes: string[];
  repository?: OperatingRepositoryProvenance;
  metric?: {
    identity: string;
    query: string;
    observedFrom: string;
    observedTo: string;
  };
  summary?: string;
}

export interface OperatingEvidence {
  kind: 'operating-evidence';
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
  cycleId: string;
  fingerprint: string;
  collectedAt: string;
  truncated: boolean;
  items: OperatingEvidenceItem[];
  sources: Array<Record<string, JsonValue>>;
  warnings: string[];
}

export interface OperatingProviderManifest {
  kind: 'operating-provider-manifest';
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
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
  policyDigest: string;
  configurationDigest: string;
  capturedAt: string;
}

export interface OperatingProviderPolicyPayload {
  providerId: string;
  providerVersion: string;
  mode: OperatingProviderManifest['mode'];
  readOnly: true;
  endpoint: OperatingProviderManifest['endpoint'];
  permittedDataClasses: OperatingProviderManifest['permittedDataClasses'];
  retention: OperatingProviderManifest['retention'];
  capabilities: OperatingProviderManifest['capabilities'];
  limits: OperatingProviderManifest['limits'];
  consentPolicy: {
    policyVersion: string;
    renewalTriggers: OperatingProviderManifest['consent']['renewalTriggers'];
  };
}

export interface OperatingAdvisorBrief {
  kind: 'operating-advisor-brief';
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
  role: {
    id: string;
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
    sensitivityCeiling: 'public' | 'internal' | 'confidential' | 'restricted';
    minimum: Record<string, JsonValue>;
  };
  output: {
    schema: 'operating-advisor-response@1.2.0';
    jsonSchema: Record<string, JsonValue>;
    allowedProposalTypes: string[];
    maximumProposals: number;
    maximumOutputBytes: number;
    requiredBehavior: string[];
    scoring: Record<string, JsonValue> | null;
  };
  budgets: Record<string, JsonValue>;
  failureBehavior: string;
  briefDigest: string;
}

export interface OperatingAdvisorProposal {
  proposalKey: string;
  type: 'finding' | 'decision' | 'data-gap' | 'merge' | 'sequence';
  title: string;
  problem: string;
  proposal: string;
  impact: 1 | 2 | 3 | 4 | 5;
  confidence: 1 | 2 | 3 | 4 | 5;
  ease: 1 | 2 | 3 | 4 | 5;
  severity: 'low' | 'medium' | 'high' | 'critical';
  evidenceRefs: string[];
  dependsOnProposalKeys?: string[];
  conflictsWithProposalKeys?: string[];
  sequenceProposalKeys?: string[];
}

/**
 * Bounded payload returned by a native advisor. OpenPlanr adds cycle, role,
 * producer, and digest metadata when it creates the canonical role result.
 */
export interface OperatingAdvisorResponse {
  outcome: 'proposals' | 'quiet';
  proposals: OperatingAdvisorProposal[];
  gaps: string[];
  conflicts: string[];
}

export type OperatingAdapterHandoffState =
  | 'prepare-required'
  | 'record-required'
  | 'finalize-required'
  | 'continue-required'
  | 'cancelled';

export interface OperatingAdapterMachineAction {
  id: string;
  action:
    | 'adapter.prepare'
    | 'adapter.record'
    | 'adapter.finalize'
    | 'adapter.resume'
    | 'adapter.cancel'
    | 'harness.prepare'
    | 'harness.record'
    | 'harness.finalize'
    | 'harness.resume'
    | 'harness.cancel'
    | 'harness.heartbeat'
    | 'run.continue';
  effect: 'read-only' | 'machine-local-write' | 'project-write';
  role?: string;
  argv: string[];
  dispatch?:
    | {
        source: 'adapter.prepare-result';
        rolePackPointer: string;
        isolation: 'enforced-empty-tools';
      }
    | {
        source: 'adapter.prepare-result';
        agent?: string;
        mandatePointer: string;
        declaredRoots: string[];
        toolGrant: { allowed: string[]; roots: string[] };
        isolation: 'enforced-read-only-bounded' | 'unsupported';
      }
    | {
        source: 'harness.prepare-result';
        agent: string;
        mandatePointer: string;
        procedurePointer: string;
        runtime: 'claude-code' | 'codex' | 'cursor';
        executionMode: 'native-agent' | 'sequential-native';
        assurance: 'runtime-governed';
        toolIsolation: 'enforced' | 'advisory' | 'none';
        permissionAuthority: 'runtime-session';
      };
  stdin?: {
    kind: 'stdin-json';
    mediaType: 'application/json';
    encoding: 'utf-8';
    maxBytes: 32768 | 262144;
    schema:
      | 'https://openplanr.dev/schemas/v1.2.0/operating-advisor-response.schema.json'
      | 'https://openplanr.dev/schemas/v1.3.0/operating-advisor-response.schema.json'
      | 'https://openplanr.dev/schemas/v1.4.0/operating-advisor-response.schema.json';
    schemaSource: 'adapter.prepare-result';
    schemaPointer: string;
  };
}

export interface OperatingAdapterHandoff {
  kind: 'operating-adapter-handoff';
  schemaVersion: '1.0.0' | '1.1.0' | '1.2.0';
  protocolVersion: '1.2.0' | '1.3.0' | '1.4.0';
  phase: 'bootstrap' | 'advisors' | 'chair';
  state: OperatingAdapterHandoffState;
  binding: {
    cycleId: string;
    evidenceDigest: string;
    runtime: string;
    runtimeBinding?: 'required';
    crossRuntimeFallback?: false;
    executionMode?: 'native-agent' | 'sequential-native';
    assurance?: 'runtime-governed';
    toolIsolation?: 'enforced' | 'advisory' | 'none';
    idempotencyKey: string;
    lease: string | null;
    expiresAt: string | null;
  };
  roles: Array<{
    roleId: string;
    status: 'awaiting-prepare' | 'pending' | 'recorded' | 'not-evaluated' | 'failed';
    /**
     * Required when `status` is `not-evaluated` or `failed`, forbidden otherwise:
     * the reason a non-recorded terminal lens is missing, carried through so the
     * Chair mandate and integrity surface can state it. Protocol v1.4 only.
     */
    statusReason?: string;
    inputDigest: string | null;
  }>;
  next: OperatingAdapterMachineAction[];
  recovery: OperatingAdapterMachineAction[];
}

export type OperatingEpistemicStatus =
  | 'observed'
  | 'inferred'
  | 'hypothesis'
  | 'owner-confirmed'
  | 'unknown';

export type OperatingCitation =
  | { kind: 'repository'; componentId?: string; path: string; startLine: number; endLine: number; revision: string }
  | { kind: 'git'; componentId?: string; revision: string; path?: string }
  | { kind: 'planr'; artifactId: string; path: string; digest: string }
  | { kind: 'external'; url: string; title: string; publisher?: string; retrievedAt: string; contentDigest: string };

export interface OperatingRuntimeBinding {
  runtime: 'claude-code' | 'codex' | 'cursor';
  runtimeBinding: 'required';
  crossRuntimeFallback: false;
  executionMode: 'native-agent' | 'sequential-native';
  assurance: 'runtime-governed';
  toolIsolation: 'enforced' | 'advisory' | 'none';
}

export interface OperatingContextClaim {
  id: string;
  field: string;
  value: string;
  epistemicStatus: OperatingEpistemicStatus;
  confidence: 1 | 2 | 3 | 4 | 5;
  citations: OperatingCitation[];
  ownerNote?: string;
}

export interface AgentNativeOperatingAdvisorResponse {
  outcome: 'actions' | 'quiet' | 'partial';
  analysisMarkdown: string;
  claims: Array<{
    id: string;
    statement: string;
    epistemicStatus: OperatingEpistemicStatus;
    confidence: 1 | 2 | 3 | 4 | 5;
    citations: OperatingCitation[];
  }>;
  actions: Array<{
    actionKey: string;
    title: string;
    summary: string;
    lane: 'DEV' | 'OWNER' | 'AGENT';
    routeKind: 'quick-task' | 'spec' | 'epic' | 'decision' | 'agent-artifact' | 'experiment' | 'metric';
    horizon: 'immediate' | 'next' | 'later';
    confidence: 1 | 2 | 3 | 4 | 5;
    impact?: 1 | 2 | 3 | 4 | 5;
    ease?: 1 | 2 | 3 | 4 | 5;
    critical?: boolean;
    citations: OperatingCitation[];
  }>;
  gaps: Array<{ id: string; question: string; impact: string; ownerRequired?: boolean }>;
  conflicts: Array<{ id: string; summary: string; actionKeys: string[] }>;
}

export interface OperatingMaterializedDraft {
  kind: 'operating-materialized-draft';
  schemaVersion: '1.0.0';
  protocolVersion: '1.4.0';
  draftId: string;
  cycleId: string;
  actionKey: string;
  artifactKind: 'quick-task' | 'spec' | 'epic' | 'decision' | 'agent-artifact';
  path: string;
  status: 'proposed' | 'approved' | 'discarded';
  artifactDigest: string;
  causality: { findingIds: string[]; citationDigests: string[] };
  reversible: true;
  userEdited?: boolean;
}

export type OperatingArtifactType = 'markdown' | 'html' | 'json' | 'csv';

export interface OperatingArtifactTemplate {
  id: string;
  version: string;
  artifactType: OperatingArtifactType;
  body: string;
  requiredVariables?: string[];
}

export interface OperatingArtifactGenerationBudget {
  maxBytes: number;
  maxDurationMs: number;
  maxTokens: number | null;
  maxCostUsd: number | null;
}

export interface OperatingArtifactGenerationSandbox {
  network: 'none';
  filesystem: 'none' | 'project-read-only';
  tools: [];
  allowedUrlSchemes: Array<'https' | 'mailto'>;
}

export interface OperatingArtifactSession {
  kind: 'operating-artifact-session';
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
  id: string;
  cycleId: string;
  state: 'prepared' | 'generating' | 'validated' | 'committed' | 'failed' | 'cancelled';
  artifactType: OperatingArtifactType;
  inputDigest: string;
  outputDigest?: string;
  destination: string;
  evidenceRefs: string[];
  producer: {
    product: string;
    version: string;
    runtime: string;
    capability: 'analysis-standard' | 'analysis-high';
  };
  generation?: {
    template: { id: string; version: string; digest: string };
    attempt: number;
    maxAttempts: number;
    budget: OperatingArtifactGenerationBudget;
    sandbox: OperatingArtifactGenerationSandbox;
  };
  provenance?: {
    templateDigest: string;
    inputDigest: string;
    outputDigest: string;
    generatedAt: string;
  };
  createdAt: string;
  updatedAt: string;
  failureCode?: string;
}

export interface OperatingCycleManifest {
  kind: 'operating-cycle-manifest';
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
  id: string;
  state:
    | 'preparing'
    | 'collecting'
    | 'advising'
    | 'consolidating'
    | 'reviewable'
    | 'closed'
    | 'blocked'
    | 'failed'
    | 'cancelled';
  health?: 'normal' | 'quiet' | 'partial' | 'blocked';
  depth: 'standard' | 'deep' | 'review-only';
  focus: Array<'strategy' | 'product' | 'growth' | 'operations' | 'technology' | 'all'>;
  inputDigest: string;
  enabledRoles: string[];
  enabledProviders: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  producer: {
    product: string;
    version: string;
    runtime: string;
  };
  warnings?: string[];
}

export interface OperatingState {
  kind: 'operating-state';
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
  generatedAt: string;
  eventHead: OperatingEventHead;
  cycles: OperatingCycleManifest[];
  findings: Array<Record<string, JsonValue>>;
  decisions: Array<Record<string, JsonValue>>;
  dataGaps: Array<Record<string, JsonValue>>;
  routes: Array<Record<string, JsonValue>>;
  specLinks: Array<Record<string, JsonValue>>;
  outcomes: Array<Record<string, JsonValue>>;
  learnings: Array<Record<string, JsonValue>>;
  evidenceSources: Array<Record<string, JsonValue>>;
  summary: Record<string, JsonValue>;
}

export interface OperatingCheckpoint {
  kind: 'operating-checkpoint';
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
  createdAt: string;
  eventHead: OperatingEventHead;
  recordDigests: string[];
  stateHash: string;
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

export interface OperatingCheckpointSignature {
  algorithm: 'ed25519' | 'hmac-sha256';
  keyId: string;
  value: string;
}

export const OPERATING_PROTOCOL_VERSION: '1.2.0';
export const PROTOCOL_SCHEMA_REGISTRY: Readonly<Record<string, Readonly<Record<string, string>>>>;

export function loadProtocolContract(
  kind: string,
  options?: { protocolVersion?: string },
): ProtocolSchemaContract;
export function loadOperatingContractBundle(): {
  kind: 'operating-contract-bundle';
  protocolVersion: '1.2.0';
  schemas: Record<string, Record<string, JsonValue>>;
  roles: Array<Record<string, JsonValue>>;
  providers: Array<Record<string, JsonValue>>;
};
export function listProtocolSchemas(): Array<{ kind: string; protocolVersion: string; path: string }>;
export function resolveProtocolSchema(
  kind: string,
  options: { protocolVersion: string },
): ProtocolSchemaContract;
export function validateProtocolArtifact(
  kind: string,
  value: unknown,
  options?: { protocolVersion?: string },
): ProtocolValidationError[];
export function assertProtocolArtifact<T>(
  kind: string,
  value: T,
  options?: { protocolVersion?: string },
): T;
export function listOperatingRoles(): Array<Record<string, JsonValue>>;
export function listOperatingProviders(): Array<Record<string, JsonValue>>;
export function createOperatingAdvisorBrief(roleId: string): OperatingAdvisorBrief;
export function listOperatingAdvisorBriefs(): OperatingAdvisorBrief[];
export function createOperatingAdapterHandoff(input: {
  phase: 'bootstrap' | 'advisors' | 'chair';
  state: OperatingAdapterHandoffState;
  cycleId: string;
  evidenceDigest: string;
  protocolVersion?: '1.2.0' | '1.3.0' | '1.4.0';
  runtime: string;
  idempotencyKey: string;
  lease?: string | null;
  expiresAt?: string | null;
  roles: Array<{
    roleId: string;
    status: 'awaiting-prepare' | 'pending' | 'recorded';
    inputDigest?: string | null;
  }>;
}): OperatingAdapterHandoff;
export function createOperatingRuntimeBinding(
  runtime: string,
  options?: { executionMode?: 'native-agent' | 'sequential-native' },
): OperatingRuntimeBinding;
export function assertOperatingRuntimeMatch(
  binding: OperatingRuntimeBinding,
  runtime: string,
): OperatingRuntimeBinding;
export function createOperatingResearchMandate(input: {
  cycleId: string;
  runtime: string;
  executionMode?: 'native-agent' | 'sequential-native';
  researchMode?: 'local' | 'connected';
  connectedResearchConsentDigest?: string | null;
  focus?: string[];
  roots?: string[];
}): Record<string, JsonValue>;
export function validateOperatingContextClaims(
  claims: unknown,
): OperatingContextClaim[];
export function validateAgentNativeAdvisorResponse(
  response: unknown,
): AgentNativeOperatingAdvisorResponse;
export function qualifyOperatingDraftCandidates(
  actions: AgentNativeOperatingAdvisorResponse['actions'],
  options?: { existingDigests?: string[]; conflictedActionKeys?: string[]; capacity?: number },
): { eligible: Array<{ action: AgentNativeOperatingAdvisorResponse['actions'][number]; digest: string }>; rejected: Array<{ action: AgentNativeOperatingAdvisorResponse['actions'][number]; digest: string; reason: string }> };
export function createOperatingMaterializedDraft(
  input: Omit<OperatingMaterializedDraft, 'kind' | 'schemaVersion' | 'protocolVersion' | 'causality' | 'reversible'> & {
    findingIds: string[];
    citationDigests: string[];
  },
): OperatingMaterializedDraft;
export function assertOperatingDraftApproved(
  draft: OperatingMaterializedDraft,
): OperatingMaterializedDraft;
export function validateOperatingAdapterHandoffBindings(
  value: OperatingAdapterHandoff,
): OperatingAdapterHandoff;
export function operatingProviderPolicyPayload(
  manifest: OperatingProviderManifest,
): OperatingProviderPolicyPayload;
export function computeOperatingProviderPolicyDigest(manifest: OperatingProviderManifest): string;
export function validateOperatingProviderPolicyDigest(
  manifest: OperatingProviderManifest,
): OperatingProviderManifest;
export function renderOperatingArtifactTemplate(
  template: OperatingArtifactTemplate,
  variables: Record<string, JsonPrimitive>,
): {
  content: string;
  template: Required<OperatingArtifactTemplate> & { digest: string };
};
export function prepareOperatingArtifactGeneration(input: {
  id: string;
  cycleId: string;
  artifactType: OperatingArtifactType;
  inputDigest: string;
  destination: string;
  evidenceRefs: string[];
  producer: OperatingArtifactSession['producer'];
  template: OperatingArtifactTemplate;
  budget?: Partial<OperatingArtifactGenerationBudget>;
  sandbox?: Partial<OperatingArtifactGenerationSandbox>;
  maxAttempts?: number;
  now?: string;
}): OperatingArtifactSession;
export function startOperatingArtifactGeneration(
  session: OperatingArtifactSession,
  options?: { now?: string },
): OperatingArtifactSession;
export function validateOperatingArtifactOutput(
  session: OperatingArtifactSession,
  content: string,
  options?: { now?: string },
): { session: OperatingArtifactSession; content: string };
export function commitOperatingArtifactGeneration(
  session: OperatingArtifactSession,
  options?: { now?: string },
): OperatingArtifactSession;
export function failOperatingArtifactGeneration(
  session: OperatingArtifactSession,
  failureCode: string,
  options?: { now?: string },
): OperatingArtifactSession;
export function resumeOperatingArtifactGeneration(
  session: OperatingArtifactSession,
  options?: { now?: string },
): OperatingArtifactSession;
export function cancelOperatingArtifactGeneration(
  session: OperatingArtifactSession,
  options?: { now?: string },
): OperatingArtifactSession;
export function runOperatingArtifactGeneration(input: {
  session: OperatingArtifactSession;
  now?: () => string;
  generate: (context: {
    attempt: number;
    inputDigest: string;
    evidenceRefs: string[];
    artifactType: OperatingArtifactType;
    budget: OperatingArtifactGenerationBudget;
    sandbox: OperatingArtifactGenerationSandbox;
    signal: AbortSignal;
  }) => Promise<{
    content: string;
    usage?: { tokens?: number; costUsd?: number };
  }>;
}): Promise<{
  session: OperatingArtifactSession;
  content: string;
  attempts: Array<{ attempt: number; status: 'failed' | 'committed'; failureCode?: string }>;
}>;

export function canonicalizeJson(value: JsonValue): string;
export function sha256Jcs(value: JsonValue): string;
export function operatingRoleResultIdentityPayload(
  result: Record<string, unknown>,
): Record<string, unknown>;
export function computeOperatingRoleResultDigest(result: Record<string, unknown>): string;
export function validateOperatingRoleResultDigest<T extends Record<string, unknown>>(result: T): T;
export function computeOperatingEventHash(event: OperatingEvent): string;
export function createOperatingEvent(
  input: Omit<OperatingEvent, 'kind' | 'schemaVersion' | 'protocolVersion' | 'sequence' | 'previousEventHash' | 'eventHash'>,
  options?: { previousEvent?: OperatingEvent | null; sequence?: number },
): OperatingEvent;
export function verifyOperatingEventChain(
  events: OperatingEvent[],
  options?: { startingSequence?: number; startingHash?: string | null },
): OperatingEventHead;
export function reduceOperatingEvents(
  events: OperatingEvent[],
  options?: {
    checkpoint?: OperatingCheckpoint | null;
    verifyCheckpointSignature?: (payload: string, signature: OperatingCheckpointSignature) => boolean;
  },
): OperatingState;
export function createOperatingCheckpoint(
  state: OperatingState,
  options?: {
    createdAt?: string;
    recordDigests?: string[];
    signer?: (payload: string) => OperatingCheckpointSignature;
  },
): OperatingCheckpoint;
export function createOperatingCheckpointSigningPayload(checkpoint: OperatingCheckpoint): string;
export function validateOperatingCheckpoint(
  checkpoint: OperatingCheckpoint,
  options?: {
    verifySignature?: (payload: string, signature: OperatingCheckpointSignature) => boolean;
    requireSignatureVerification?: boolean;
  },
): OperatingCheckpoint;
export function resumeOperatingProjection(
  checkpoint: OperatingCheckpoint,
  tailEvents: OperatingEvent[],
  options?: {
    verifyCheckpointSignature?: (payload: string, signature: OperatingCheckpointSignature) => boolean;
  },
): OperatingState;
