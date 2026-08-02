export const OPERATE_PROTOCOL_VERSION = '1.2.0' as const;
export const OPERATE_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Protocol v1.3 is delivered ADDITIVELY. The v1.2 on-disk artifact envelope —
 * stamped through `OPERATE_PROTOCOL_VERSION` and every `ProtocolArtifact` — is
 * frozen at `1.2.0` so pack-mode artifacts (operating-evidence,
 * operating-workspace-manifest, operating-outcome, …) keep validating against
 * the schemas the pipeline publishes only at 1.2.0. Mutating that shared symbol
 * would restamp those frozen artifacts to `1.3.0`, where no schema exists, and
 * fail closed inside `assertOperatingArtifact` for every pack-mode caller. The
 * v1.3 surface is instead the new mission-packet family, whose dedicated
 * schemas the pipeline publishes exclusively at 1.3.0; it carries its own
 * protocol version through this constant.
 */
export const OPERATE_MISSION_PROTOCOL_VERSION = '1.3.0' as const;
export const OPERATE_AGENT_PROTOCOL_VERSION = '1.4.0' as const;

export interface ProtocolArtifact<K extends string> {
  kind: K;
  schemaVersion: typeof OPERATE_SCHEMA_VERSION;
  protocolVersion: typeof OPERATE_PROTOCOL_VERSION;
}

export type OperatingSensitivity = 'public' | 'internal' | 'confidential' | 'restricted';
export type OperatingPlanningEngine = 'openplanr' | 'pipeline-po';
export type GuidedQuestionValue = string | boolean | string[];
export type GuidedQuestionType =
  | 'text'
  | 'secret'
  | 'single-select'
  | 'multi-select'
  | 'confirmation'
  | 'path'
  | 'repeated-text'
  | 'informational';

export interface GuidedQuestion {
  kind: 'guided-question';
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
  questionId: string;
  questionVersion: '1.0.0';
  type: GuidedQuestionType;
  label: string;
  explanation: string;
  required: boolean;
  sensitivity: 'public' | 'internal' | 'sensitive';
  persistence: 'none' | 'session';
  valueSemantics: 'none' | 'suggestion' | 'default';
  suggestedValue?: GuidedQuestionValue;
  suggestionReason?: string;
  defaultValue?: GuidedQuestionValue;
  defaultReason?: string;
  /**
   * Renderability contract for `single-select`/`multi-select`: `choices` is the
   * complete per-option layout a runtime presents (label, optional description,
   * optional `preselected`), so a select never has to be improvised.
   */
  choices?: Array<{ id: string; label: string; description?: string; preselected?: boolean }>;
  /**
   * Renderability contract for `repeated-text`: the singular noun a runtime shows
   * beside each entry row (e.g. "Goal") and the example placeholder for an empty
   * row. Additive OpenPlanr presentation metadata attached to the emitted
   * questionnaire after Protocol v1.2 validation — the frozen guided-question
   * schema does not carry these, so they never reach schema validation.
   */
  itemLabel?: string;
  itemPlaceholder?: string;
  validation?: {
    minLength?: number;
    maxLength?: number;
    minItems?: number;
    maxItems?: number;
  };
  visibleWhen?: Array<{
    questionId: string;
    operator: 'equals' | 'not-equals' | 'contains' | 'not-contains' | 'answered' | 'not-answered';
    value?: GuidedQuestionValue;
  }>;
}

export interface GuidedQuestionnaire {
  kind: 'guided-questionnaire';
  schemaVersion: '1.1.0';
  protocolVersion: '1.2.0';
  sessionId: string;
  digest: `sha256:${string}`;
  questionnaireVersion: '1.0.0';
  command: 'operate.init';
  projectIdentity: `sha256:${string}`;
  projectHead: `sha256:${string}`;
  configHead: `sha256:${string}`;
  adapter: {
    runtime: string;
    version: string;
    interaction: 'native' | 'chat' | 'terminal' | 'none';
  };
  stage: 'foundation' | 'product-charter' | 'review';
  step: number;
  totalSteps: 3;
  title: string;
  description?: string;
  questions: GuidedQuestion[];
  submission: {
    kind: 'guided-answer-submission';
    version: '1.0.0';
    schema: 'https://openplanr.dev/schemas/v1.2.0/guided-answer-envelope.schema.json';
    transport: {
      kind: 'stdin-json';
      mediaType: 'application/json';
      encoding: 'utf-8';
      maxBytes: 65536;
      argv: ['planr', 'operate', 'init', '--resume', string, '--stdin', '--json'];
      /**
       * Stdin-parity alternates the CLI already accepts for the same bounded
       * answer envelope. `--answers-file <path>` reads the identical 64 KiB UTF-8
       * document `--stdin` would, so the downstream strict parser and digest
       * binding are unchanged. Additive OpenPlanr transport metadata attached
       * after Protocol v1.2 validation (the frozen transport schema advertises
       * only the stdin entry), so a contract-conformant runtime can discover the
       * file transport instead of assuming stdin is the only channel.
       */
      alternates?: Array<{
        kind: 'answers-file';
        mediaType: 'application/json';
        encoding: 'utf-8';
        maxBytes: 65536;
        argv: ['planr', 'operate', 'init', '--resume', string, '--answers-file', string, '--json'];
      }>;
    };
    envelope: {
      fixedFields: Omit<GuidedAnswerEnvelope, 'questionnaireDigest' | 'answers' | 'submittedAt'>;
      dynamicFields: {
        questionnaireDigest: {
          source: 'questionnaire';
          pointer: '/digest';
        };
        submittedAt: {
          source: 'runtime-clock';
          format: 'date-time';
        };
        answers: {
          source: 'chosen-values-by-question-id';
          copyFields: ['questionId', 'questionVersion', 'sensitivity'];
          omitUnansweredOptional: true;
          items: Array<{
            questionId: string;
            questionVersion: '1.0.0';
            sensitivity: 'public' | 'internal' | 'sensitive';
            required: boolean;
            valueType: 'string' | 'boolean' | 'string-array';
          }>;
        };
      };
    };
  };
  createdAt: string;
  expiresAt: string;
}

export interface GuidedAnswer {
  questionId: string;
  questionVersion: '1.0.0';
  sensitivity: 'public' | 'internal' | 'sensitive';
  value: GuidedQuestionValue;
}

export interface GuidedAnswerEnvelope {
  kind: 'guided-answer-envelope';
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
  sessionId: string;
  questionnaireDigest: `sha256:${string}`;
  questionnaireVersion: '1.0.0';
  command: 'operate.init';
  projectIdentity: `sha256:${string}`;
  projectHead: `sha256:${string}`;
  configHead: `sha256:${string}`;
  answers: GuidedAnswer[];
  adapter: GuidedQuestionnaire['adapter'];
  submittedAt: string;
}

export type GuidedSessionState =
  | 'created'
  | 'awaiting-input'
  // A previously persisted answer is being re-answered before confirm/apply. This
  // is a transient, in-memory flow marker surfaced on the returned session so a
  // runtime knows a rollback happened; the on-disk artifact records the
  // schema-valid `awaiting-input` resting state (Protocol v1.2's guided-session
  // schema does not carry `revising`), so a re-answer never has to restart init.
  | 'revising'
  | 'preview-ready'
  | 'confirmed'
  | 'applied'
  | 'cancelled'
  | 'expired'
  | 'stale'
  | 'invalid';

export interface GuidedSession {
  kind: 'guided-session';
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
  sessionId: string;
  state: GuidedSessionState;
  command: 'operate.init';
  projectIdentity: `sha256:${string}`;
  projectHead: `sha256:${string}`;
  configHead: `sha256:${string}`;
  questionnaireDigest: `sha256:${string}`;
  questionnaireVersion: '1.0.0';
  adapter: GuidedQuestionnaire['adapter'];
  persistedAnswers: Array<
    Omit<GuidedAnswer, 'sensitivity'> & { sensitivity: 'public' | 'internal' }
  >;
  previewDigest?: `sha256:${string}`;
  confirmationDigest?: `sha256:${string}`;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  confirmedAt?: string;
  appliedAt?: string;
  terminalReason?: string;
}

export type OperatingActionEffect =
  | 'read-only'
  | 'machine-local-write'
  | 'project-write'
  | 'provider-call'
  | 'external-effect';

export interface StructuredOperatingAction {
  kind: 'structured-action';
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
  id: string;
  label: string;
  description?: string;
  command: string;
  effect: OperatingActionEffect;
  providerUse: boolean;
  requiresConfirmation: boolean;
  confirmationScope: string | null;
  confirmationDigest: `sha256:${string}` | null;
  /**
   * The exact, directly executable argv for a digest-confirmable action
   * (FR8/E-008): the public command tokens followed by its real confirmation
   * flag and `--yes`. Present only when the command's CLI accepts a
   * digest-bound confirm flag (`--confirm`), so a runner never has to
   * re-synthesize the confirmation token itself. Commands whose only authority
   * is `--yes` never carry a confirmationDigest and never receive a
   * confirmArgv here.
   */
  confirmArgv?: readonly string[];
  recommended: boolean;
}

export interface GuidedConfirmation {
  kind: 'guided-confirmation';
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
  confirmationId: string;
  state: 'preview' | 'confirmed' | 'rejected' | 'expired' | 'stale';
  actionId: string;
  sessionId: string;
  command: string;
  effect: OperatingActionEffect;
  providerUse: boolean;
  confirmationScope: string;
  confirmationDigest: `sha256:${string}`;
  projectIdentity: `sha256:${string}`;
  projectHead: `sha256:${string}`;
  configHead: `sha256:${string}`;
  eventHead: OperatingEventHead | null;
  arguments: string[];
  destinations: string[];
  writes: string[];
  createdAt: string;
  expiresAt: string;
  confirmedAt?: string;
  confirmedBy?: string;
  terminalReason?: string;
}

export interface OperatingInitAnswers {
  profile?: 'saas' | 'product' | 'engineering' | 'custom';
  profileFile?: string;
  decisionOwner?: string;
  planningEngine?: OperatingPlanningEngine;
  runtime?: 'auto' | 'claude' | 'codex' | 'cursor';
  cadence?: 'manual' | 'weekly' | 'monthly';
  timezone?: string;
  sensitivityCeiling?: OperatingSensitivity;
  componentRoots?: string[];
  charter?: Partial<OperatingCharter>;
}
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
    schema: 'operating-advisor-response@1.2.0';
    jsonSchema: Record<string, unknown>;
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
    | 'run.continue';
  effect: OperatingActionEffect;
  role?: string;
  argv: string[];
  dispatch?: {
    source: 'adapter.prepare-result' | 'harness.prepare-result';
    agent?: string;
    mandatePointer: string;
    procedurePointer?: string;
    runtime?: string;
    executionMode?: 'native-agent' | 'sequential-native';
    assurance?: 'runtime-governed';
    toolIsolation?: 'enforced' | 'advisory' | 'none' | 'enforced-read-only';
    permissionAuthority?: 'runtime-session';
    declaredRoots?: string[];
    toolGrant?: { allowed: string[]; roots: string[] };
    isolation?: 'enforced-read-only-bounded' | 'runtime-governed' | 'unsupported';
  };
  stdin?: {
    kind: 'stdin-json';
    mediaType: 'application/json';
    encoding: 'utf-8';
    maxBytes: number;
    schema: string;
    schemaSource: 'adapter.prepare-result' | 'harness.prepare-result';
    schemaPointer: string;
  };
}

export interface OperatingAdapterHandoff extends ProtocolArtifact<'operating-adapter-handoff'> {
  phase: 'bootstrap' | 'advisors' | 'chair';
  state:
    | 'prepare-required'
    | 'record-required'
    | 'finalize-required'
    | 'continue-required'
    | 'cancelled';
  binding: {
    cycleId: string;
    evidenceDigest: `sha256:${string}`;
    runtime: string;
    runtimeBinding?: 'required';
    crossRuntimeFallback?: false;
    executionMode?: 'native-agent' | 'sequential-native';
    assurance?: 'runtime-governed';
    toolIsolation?: 'enforced' | 'advisory' | 'none' | 'enforced-read-only';
    idempotencyKey: string;
    lease: string | null;
    expiresAt: string | null;
  };
  roles: Array<{
    roleId: string;
    status: 'awaiting-prepare' | 'pending' | 'recorded';
    inputDigest: `sha256:${string}` | null;
  }>;
  next: OperatingAdapterMachineAction[];
  recovery: OperatingAdapterMachineAction[];
}

export type OperateErrorCode =
  | 'E_OPERATE_INTERNAL'
  | 'E_OPERATE_PROJECT_REQUIRED'
  | 'E_OPERATE_NOT_INITIALIZED'
  | 'E_OPERATE_CONFIG_INVALID'
  | 'E_OPERATE_CHARTER_INCOMPLETE'
  | 'E_OPERATE_PATH_ESCAPE'
  | 'E_OPERATE_STATE_INVALID'
  | 'E_OPERATE_STATE_UNAVAILABLE'
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
  | 'E_OPERATE_RUNTIME_MISMATCH'
  | 'E_OPERATE_DRAFT_UNAPPROVED'
  | 'E_RUNTIME_UNSUPPORTED'
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
  | 'E_OPERATE_INPUT_REQUIRED'
  | 'E_OPERATE_QUESTIONNAIRE_INVALID'
  | 'E_OPERATE_SESSION_INVALID'
  | 'E_OPERATE_SESSION_EXPIRED'
  | 'E_OPERATE_SESSION_STALE'
  | 'E_OPERATE_SESSION_CANCELLED'
  | 'E_OPERATE_SESSION_REPLAY_CONFLICT'
  | 'E_PIPELINE_VERSION_INCOMPATIBLE'
  | 'E_OPERATE_ACTION_UNKNOWN'
  | 'E_OPERATE_MISSION_PACKET_BUDGET'
  | 'E_OPERATE_MISSION_UNAVAILABLE'
  | 'E_OPERATE_PROVIDER_DEPRECATED'
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
  caps: OperatingConfig['caps'];
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

export interface OperatingRecordEnvelope
  extends Omit<ProtocolArtifact<'operating-record'>, 'protocolVersion'> {
  /**
   * Frozen v1.2 for every record EXCEPT a route record whose content is a v1.3
   * (`create-quick-task`) route plan, which is stamped v1.3
   * (`OPERATE_MISSION_PROTOCOL_VERSION`) so it validates against the additive
   * v1.3 operating-record schema — the only record schema whose route content
   * accepts a v1.3 route plan. Every other record envelope, including a v1.2
   * route record, stays frozen at v1.2. The stamp is a pure function of the
   * record content, so the write path and the `records.jsonl` read-back agree.
   */
  protocolVersion:
    | typeof OPERATE_PROTOCOL_VERSION
    | typeof OPERATE_MISSION_PROTOCOL_VERSION
    | typeof OPERATE_AGENT_PROTOCOL_VERSION;
  digest: `sha256:${string}`;
  recordType:
    | 'evidence-metadata'
    | 'advisor-result'
    | 'advisor-report'
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
  kind:
    | 'create-spec'
    | 'create-instrumentation-spec'
    | 'create-decision'
    | 'create-cycle-artifact'
    | 'create-quick-task'
    | 'create-epic';
  dependsOn: string[];
  evidenceRefs: string[];
  reversible: true;
  requiresConfirmation: true;
  targetPath?: string;
}

export interface OperatingRoutePlan
  extends Omit<ProtocolArtifact<'operating-route-plan'>, 'protocolVersion'> {
  /**
   * Frozen v1.2 for the spec/decision/agent/instrumentation kinds. A
   * `create-quick-task` or `create-epic` route is stamped v1.3
   * (`OPERATE_MISSION_PROTOCOL_VERSION`) so it validates against the additive
   * v1.3 route-plan schema — the only route-plan schema whose action-kind enum
   * includes `create-quick-task`/`create-epic`. Every other operating artifact
   * envelope stays frozen at v1.2.
   */
  protocolVersion: typeof OPERATE_PROTOCOL_VERSION | typeof OPERATE_MISSION_PROTOCOL_VERSION;
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
  actions?: StructuredOperatingAction[];
  handoff?: OperatingAdapterHandoff;
  questionnaire?: GuidedQuestionnaire;
  /**
   * Machine-readable continuation discriminator (FR7/E-007). A guided-stage
   * advance (`E_OPERATE_INPUT_REQUIRED`) or first-use provider consent
   * (`E_OPERATE_AUTHORITY_REQUIRED`) is a healthy pause that hands control back
   * to the operator/runtime, not a failure: those results carry `ok: true` and
   * `flow: 'handoff'`, mirroring `run`'s adapter handoff, so a continuation
   * never paints the happy path red.
   */
  flow?: 'handoff';
  data?: unknown;
  preview?: unknown;
  next?: string[];
  /** Compatibility fields consumed by the current human renderer. */
  lines?: string[];
  exitCode?: number;
}
