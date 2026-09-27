import type { DashboardServer, DashboardServerOptions } from '../dashboard/index.mjs';
import type { OperatingOriginV1, ProtocolValidationError } from '../protocol/index.js';
import type { ShipClosureLandingInspection } from './landing.mjs';

export type ShipClosureState =
  | 'implementing'
  | 'reviewing_initial'
  | 'correction_required'
  | 'reviewing_targeted'
  | 'ready_for_final'
  | 'passed'
  | 'blocked';

export interface ShipClosureRecord {
  kind: 'ship-closure';
  schemaVersion: '1.0.0' | '1.1.0' | '1.2.0';
  protocolVersion: '1.1.0';
  recordType: 'active' | 'receipt';
  runId: `ship_${string}`;
  generation: number;
  state: ShipClosureState;
  receiptHash: `sha256:${string}` | null;
  approvedScope: { featureRoot: string; taskIds: string[]; digest: `sha256:${string}` };
  repositories: Array<{
    repositoryKey: string;
    root: string | null;
    head: string;
    baselineDigest: `sha256:${string}`;
  }>;
  reviewerRoster: string[];
  rosterDigest: `sha256:${string}`;
  gates: unknown[];
  gateSetDigest: `sha256:${string}`;
  candidateRevisions: Array<{ revision: 1 | 2; digest: `sha256:${string}` }>;
  reviews: unknown[];
  gateEvidence: unknown[];
  terminal: null | {
    status: 'passed' | 'blocked';
    at: string;
    reason: string | null;
    candidateDigest: `sha256:${string}`;
    gateEvidenceDigest: `sha256:${string}`;
  };
  [key: string]: unknown;
}

export class PipelineError extends Error {
  constructor(code: string, message: string, fix?: string, details?: unknown);
  code: string;
  fix: string;
  details?: unknown;
  toJSON(): { ok: false; code: string; problem: string; fix?: string; details?: unknown };
}

export function assertShipClosure(value: unknown): ShipClosureRecord;
export function reduceShipClosure(
  value: ShipClosureRecord,
  event: unknown,
  runtime?: unknown,
): ShipClosureRecord;
export function buildShipClosureManifestRow(
  receipt: ShipClosureRecord,
  projectRoot: string,
  featureRoot: string,
): unknown;
export function buildShipClosureMarker(
  receipt: ShipClosureRecord,
  options: {
    manifestBytes: string | Uint8Array;
    rowIndex: number;
    aggregate?: {
      status: 'passed' | 'blocked';
      allDone: boolean;
      receiptCount: number;
      tasksExecuted: number;
      tasksFailed: number;
    };
  },
): unknown;
export function buildShipClosureRunEvidence(
  receipt: ShipClosureRecord,
  marker: unknown,
  markerBytes: string | Uint8Array,
): unknown;
export function buildShipClosureProvenanceEvent(
  receipt: ShipClosureRecord,
  options: Record<string, unknown>,
): unknown;
export function renderShipClosureMarker(marker: unknown): string;
export function renderShipClosureQaReport(
  receipt: ShipClosureRecord,
  options?: Record<string, unknown>,
): string;
export function verifyShipCompatibilityProjection(
  receipt: ShipClosureRecord,
  options: Record<string, unknown>,
): boolean;
export function prepareShip(options?: Record<string, unknown>): unknown;
export function startShip(options?: Record<string, unknown>): unknown;
export function advanceShip(options?: Record<string, unknown>): unknown;
export function runShipGates(options?: Record<string, unknown>): unknown;
/** @deprecated Use finalizeShipClosure with an exact closure runId. */
export function finalizeShip(options?: Record<string, unknown>): unknown;
export function finalizeShipClosure(options?: Record<string, unknown>): unknown;
/** @deprecated Use advanceShip with a generation-bound task result event. */
export function recordTaskResult(options?: Record<string, unknown>): never;
export function reopenShip(options?: Record<string, unknown>): unknown;
export function getShipClosure(options?: Record<string, unknown>): ShipClosureRecord;
export function inspectShipClosureForLanding(
  options?: Record<string, unknown>,
): import('./landing.mjs').ShipClosureLandingInspection;
export function preparePlan(options?: Record<string, unknown>): unknown;
export function preparePlanReview(options?: Record<string, unknown>): unknown;
export function prepareBrowserQa(options?: Record<string, unknown>): unknown;
export function recordBrowserQa(options?: Record<string, unknown>): unknown;
export function startInvestigation(options?: Record<string, unknown>): unknown;
export function advanceInvestigation(options?: Record<string, unknown>): unknown;
export function verifyInvestigation(options?: Record<string, unknown>): unknown;
export function finalizeInvestigation(options?: Record<string, unknown>): unknown;
export function startPlanReview(options?: Record<string, unknown>): unknown;
export function advancePlanReview(options?: Record<string, unknown>): unknown;
export function assertProfessionalSpecification(value: unknown): unknown;
export function capturePlanningIdentity(options?: Record<string, unknown>): unknown;
export function assertPlanningReview(value: unknown): unknown;
export function planningReviewerRoster(specialists?: string[]): string[];
export function reducePlanningReview(value: unknown, event: unknown, runtime?: unknown): unknown;
export function validatePlanningReviewEvent(event: unknown): unknown;
export function detectPipelineMode(projectRoot: string): 'spec-driven' | 'default';
/** Re-runs the receipt, successor, and projection proof for an inspection this process issued. */
export function assertCurrentShipClosureForLanding(
  inspection: ShipClosureLandingInspection,
): ShipClosureLandingInspection;
export * from '../protocol/live-evidence-v2.mjs';
export * from './browser-qa.mjs';
export * from './context-envelope.mjs';
export * from './investigation-contracts.mjs';
export * from './investigation-identity.mjs';
export * from './investigation-reducer.mjs';
export {
  type InvestigationFixStartCapabilityV1,
  type InvestigationReadOnlyCommandHostV1,
  type InvestigationRuntimeOptions,
  type InvestigationSummaryV1,
  readInvestigationReceipt,
} from './investigation-runtime.mjs';
export {
  advanceLanding,
  assertLandingWorkflowCatalog,
  assertLandingWorkflowManifest,
  bindLandingPlan,
  createLandingOwnerRuntimeHost,
  LANDING_OPERATION_REGISTRY_PATH,
  LANDING_WORKFLOW_ASSET_PATHS,
  LANDING_WORKFLOW_CATALOG_PATH,
  LANDING_WORKFLOW_ID,
  LANDING_WORKFLOW_MANIFEST_PATH,
  type LandingConfirmation,
  type LandingEvent,
  type LandingHash,
  type LandingOperationId,
  type LandingOwnerRuntimeCallbacks,
  type LandingOwnerRuntimeHost,
  type LandingPlan,
  type LandingRunId,
  type LandingState,
  landingStatus,
  prepareLanding,
  previewLandingDocket,
  readLandingOperationRegistry,
  readLandingWorkflowCatalog,
  readLandingWorkflowManifest,
  type ShipClosureLandingInspection,
  showLanding,
} from './landing.mjs';
export * from './landing-contract.mjs';
export * from './professional-skills.mjs';
export * from './ship-context.mjs';
export * from './ship-risk.mjs';
export function completePlan(options?: Record<string, unknown>): unknown;
export function nextShipBatch(tasks: unknown[]): unknown;
export function runSyncAudit(options?: Record<string, unknown>): unknown;
/** @deprecated Import `startDashboard` from `planr-pipeline/dashboard`; the root export loads the dashboard server eagerly. */
export function startDashboard(options?: DashboardServerOptions): DashboardServer;
/** Resolves after the design engine CLI exits; the child process runs synchronously. */
export function runDesignCommand(
  args?: readonly string[],
): Promise<import('node:child_process').SpawnSyncReturns<string>>;

export type RuntimeAdapterId = 'claude-code' | 'codex' | 'cursor';
export type RuntimeAdapterEntrypoint =
  | 'plan'
  | 'design'
  | 'ship'
  | 'land'
  | 'dashboard'
  | 'artifact'
  | 'sync'
  | 'doctor';

/** One entry of the certified adapter registry (`registry/adapters.json`). */
export interface RuntimeAdapter {
  id: RuntimeAdapterId;
  version: string;
  capabilityLevel: 'artifact' | 'workflow' | 'product';
  installScopes: Array<'user' | 'project'>;
  entrypoints: Record<'plan' | 'ship' | 'artifact', string> &
    Partial<Record<RuntimeAdapterEntrypoint, string>>;
  capabilities: {
    subagents: 'native' | 'advisory' | 'sequential' | 'dynamic';
    hooks: boolean;
    toolIsolation: 'enforced' | 'advisory' | 'none' | 'enforced-read-only';
    parallelDispatch: boolean;
    parallelDispatchMode: 'native' | 'host' | 'sequential' | 'dynamic';
    headlessBridge: boolean;
    artifactReview: boolean;
    interactiveQuestions: GuidedInteractionMode;
  };
  assets: string[];
  healthChecks: string[];
  drivers: { install: string; migrate: string; rollback: string; uninstall: string };
}

export interface RuntimeAdapterRegistry {
  kind: 'adapter-registry';
  schemaVersion: string;
  protocolVersion: string;
  pipelineVersion: string;
  adapters: RuntimeAdapter[];
}

/** A parsed `.planr/runtime-lock.json`; only the protocol, pipeline and adapter versions are checked. */
export interface RuntimeLock {
  protocolVersion: string;
  components: { pipeline: string; [component: string]: unknown };
  adapters: Array<{ runtime: string; version: string; [field: string]: unknown }>;
  [field: string]: unknown;
}

export interface ResolvedRuntimeAdapter {
  adapter: RuntimeAdapter;
  source: 'explicit' | 'active' | 'project' | 'installed';
  installed: boolean;
  /** Lock problems reported instead of thrown when `strictRuntimeLock` is false. */
  diagnostics: Array<{ code: string; problem: string; fix?: string }>;
}

export interface RuntimeHandoff {
  ok: false;
  action: 'runtime_required';
  runtime: RuntimeAdapterId;
  executionMode: 'handoff';
  command: string;
  /** Present when a non-empty working context was supplied. */
  context?: string;
  code: 'E_RUNTIME_HANDOFF_REQUIRED';
}

export function resolveRuntimeAdapter(options?: {
  projectRoot?: string;
  explicit?: string | null;
  active?: string | null;
  projectDefault?: string | null;
  installed?: readonly RuntimeAdapterId[];
  strictRuntimeLock?: boolean;
}): ResolvedRuntimeAdapter;
export function runtimeHandoff(
  adapter: Pick<RuntimeAdapter, 'id' | 'entrypoints'>,
  phase: RuntimeAdapterEntrypoint,
  feature: string,
  context?: string,
): RuntimeHandoff;
/** `run` is called like `spawnSync(command, ['--version'], options)`. */
export function detectInstalledRuntimes(
  run?: (
    command: string,
    args: string[],
    options: { encoding: 'utf8'; windowsHide: true },
  ) => { error?: Error; status: number | null },
): RuntimeAdapterId[];
export function listRuntimeAdapters(): RuntimeAdapter[];
/** Maps `claude` to `claude-code` and lower-cases anything else; empty input is null. */
export function normalizeRuntime(value?: string | null): string | null;
/** Null when the project has no runtime lock; throws when it is unreadable or incompatible. */
export function validateRuntimeLock(projectRoot: string, runtimeId: string): RuntimeLock | null;

export type ProvenanceOperation =
  | 'created'
  | 'shaped'
  | 'decomposed'
  | 'updated'
  | 'promoted'
  | 'designed'
  | 'implemented'
  | 'verified'
  | 'shipped'
  | 'rolled-back'
  | 'recovered';

export interface ProvenanceCorrelationV1 {
  correlation_id: string;
  proposal_id: string;
  proposal_hash: string;
  transaction_id: string;
  receipt_hash: string;
}

export interface ProvenanceRunEvidenceV1 {
  manifest_hash: string;
  manifest_start_line: number;
  manifest_end_line: number;
  marker_hash: string;
  closure_receipt_hash?: string;
  candidate_hash?: string;
  gate_evidence_hash?: string;
}

export interface ProvenanceRollbackEvidenceV1 {
  original_ship_run_id: string;
  rollback_plan_artifact_id: string;
  rollback_plan_hash: string;
  rollback_result_artifact_id: string;
  rollback_result_hash: string;
  rollback_receipt_artifact_id: string;
  target_before_hash: string;
  target_after_hash: string;
  completed_at: string;
}

/** One `.planr/provenance.jsonl` record (`schemas/v1.1.0/provenance-event.schema.json`). */
export interface ProvenanceEventV1 {
  schema_version: '1.0.0';
  event_id: string;
  timestamp: string;
  artifact_id: string;
  artifact_path: string;
  operation: ProvenanceOperation;
  producer: {
    product: 'openplanr' | 'planr-pipeline';
    version: string;
    runtime: string;
    phase: 'planning' | 'po' | 'design' | 'dev' | 'qa' | 'delivery';
  };
  run_id: string;
  correlation?: ProvenanceCorrelationV1;
  run_evidence?: ProvenanceRunEvidenceV1;
  rollback_evidence?: ProvenanceRollbackEvidenceV1;
}

/** Builds an event without validating it; `appendProvenanceEvent` validates. */
export function createProvenanceEvent(input: {
  projectRoot: string;
  artifactId: string;
  artifactPath: string;
  operation: ProvenanceOperation;
  product: ProvenanceEventV1['producer']['product'];
  version: string;
  runtime: string;
  phase: ProvenanceEventV1['producer']['phase'];
  runId?: string;
  eventId?: string;
  timestamp?: string;
  correlation?: ProvenanceCorrelationV1 | null;
  runEvidence?: ProvenanceRunEvidenceV1 | null;
  rollbackEvidence?: ProvenanceRollbackEvidenceV1 | null;
}): ProvenanceEventV1;
/** Appends under the project provenance lock and returns the ledger path; an exact replay is a no-op. */
export function appendProvenanceEvent(
  projectRoot: string,
  event: ProvenanceEventV1,
  options?: { hooks?: { afterStage?: () => void; afterCommit?: () => void } },
): string;

export {
  assertProtocolArtifact,
  listProtocolSchemas,
  PROTOCOL_SCHEMA_REGISTRY,
  resolveProtocolSchema,
  validateProtocolArtifact,
} from '../protocol/index.js';
/** RFC 8785 canonical JSON; throws a TypeError for a value JSON cannot represent. */
export function canonicalizeJson(value: unknown): string;
export function sha256Jcs(value: unknown): `sha256:${string}`;

export type GuidedInteractionKind =
  | 'guided-question'
  | 'guided-questionnaire'
  | 'guided-answer-envelope'
  | 'guided-session'
  | 'guided-confirmation'
  | 'structured-action'
  | 'evidence-diagnostic';
export type GuidedInteractionMode = 'native' | 'chat' | 'terminal' | 'none';
export type GuidedAnswerValue = string | boolean | string[];
export type GuidedQuestionType =
  | 'text'
  | 'secret'
  | 'single-select'
  | 'multi-select'
  | 'confirmation'
  | 'path'
  | 'repeated-text'
  | 'informational';
export type GuidedSensitivity = 'public' | 'internal' | 'sensitive';

/** `schemas/v1.2.0/guided-question.schema.json`. */
export interface GuidedQuestionV1 {
  kind: 'guided-question';
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
  questionId: string;
  questionVersion: string;
  type: GuidedQuestionType;
  label: string;
  explanation: string;
  required: boolean;
  sensitivity: GuidedSensitivity;
  persistence: 'none' | 'session';
  valueSemantics: 'none' | 'suggestion' | 'default';
  suggestedValue?: GuidedAnswerValue;
  suggestionReason?: string;
  defaultValue?: GuidedAnswerValue;
  defaultReason?: string;
  choices?: Array<{ id: string; label: string; description?: string; preselected?: boolean }>;
  validation?: { minLength?: number; maxLength?: number; minItems?: number; maxItems?: number };
  visibleWhen?: Array<{
    questionId: string;
    operator: 'equals' | 'not-equals' | 'contains' | 'not-contains' | 'answered' | 'not-answered';
    value?: GuidedAnswerValue;
  }>;
}

export interface GuidedAdapterBindingV1 {
  runtime: string;
  version: string;
  interaction: GuidedInteractionMode;
}

/** The self-describing stdin contract a questionnaire publishes for its answers. */
export interface GuidedAnswerSubmissionV1 {
  readonly kind: 'guided-answer-submission';
  readonly version: '1.0.0';
  readonly schema: 'https://openplanr.dev/schemas/v1.2.0/guided-answer-envelope.schema.json';
  readonly transport: {
    readonly kind: 'stdin-json';
    readonly mediaType: 'application/json';
    readonly encoding: 'utf-8';
    readonly maxBytes: 65536;
    readonly argv: readonly ['planr', 'operate', 'init', '--resume', string, '--stdin', '--json'];
  };
  readonly envelope: {
    readonly fixedFields: {
      readonly kind: 'guided-answer-envelope';
      readonly schemaVersion: '1.0.0';
      readonly protocolVersion: '1.2.0';
      readonly sessionId: string;
      readonly questionnaireVersion: string;
      readonly command: string;
      readonly projectIdentity: string;
      readonly projectHead: string;
      readonly configHead: string;
      readonly adapter: Readonly<GuidedAdapterBindingV1>;
    };
    readonly dynamicFields: {
      readonly questionnaireDigest: {
        readonly source: 'questionnaire';
        readonly pointer: '/digest';
      };
      readonly submittedAt: { readonly source: 'runtime-clock'; readonly format: 'date-time' };
      readonly answers: {
        readonly source: 'chosen-values-by-question-id';
        readonly copyFields: readonly ['questionId', 'questionVersion', 'sensitivity'];
        readonly omitUnansweredOptional: true;
        readonly items: ReadonlyArray<{
          readonly questionId: string;
          readonly questionVersion: string;
          readonly sensitivity: GuidedSensitivity;
          readonly required: boolean;
          readonly valueType: 'string' | 'boolean' | 'string-array';
        }>;
      };
    };
  };
}

/** `schemas/v1.2.0/guided-questionnaire.schema.json`. */
export interface GuidedQuestionnaireV1 {
  kind: 'guided-questionnaire';
  schemaVersion: '1.0.0' | '1.1.0';
  protocolVersion: '1.2.0';
  sessionId: string;
  digest: string;
  questionnaireVersion: string;
  command: string;
  projectIdentity: string;
  projectHead: string;
  configHead: string;
  adapter: GuidedAdapterBindingV1;
  stage: string;
  step: number;
  totalSteps: number;
  title: string;
  description?: string;
  questions: GuidedQuestionV1[];
  submission?: GuidedAnswerSubmissionV1;
  createdAt: string;
  expiresAt: string;
}

export interface GuidedAnswerV1 {
  questionId: string;
  questionVersion: string;
  sensitivity: GuidedSensitivity;
  value: GuidedAnswerValue;
}

/** `schemas/v1.2.0/guided-answer-envelope.schema.json`. */
export interface GuidedAnswerEnvelopeV1 {
  kind: 'guided-answer-envelope';
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
  sessionId: string;
  questionnaireDigest: string;
  questionnaireVersion: string;
  command: string;
  projectIdentity: string;
  projectHead: string;
  configHead: string;
  answers: GuidedAnswerV1[];
  adapter: GuidedAdapterBindingV1;
  submittedAt: string;
}

/** `schemas/v1.2.0/structured-action.schema.json`. */
export interface StructuredActionV1 {
  kind: 'structured-action';
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
  id: string;
  label: string;
  description?: string;
  command: string;
  effect:
    | 'read-only'
    | 'machine-local-write'
    | 'project-write'
    | 'provider-call'
    | 'external-effect';
  providerUse: boolean;
  requiresConfirmation: boolean;
  confirmationScope: string | null;
  confirmationDigest: string | null;
  recommended: boolean;
}

/** Answers keyed by question ID. */
export type GuidedAnswerInput =
  | Readonly<Record<string, GuidedAnswerValue>>
  | ReadonlyMap<string, GuidedAnswerValue>;

export const GUIDED_INTERACTION_CONTRACTS: Readonly<Record<string, unknown>>;
export function validateGuidedInteractionArtifact(
  kind: GuidedInteractionKind,
  value: unknown,
  options?: { protocolVersion?: string },
): ProtocolValidationError[];
/** Fills the kind and default versions, then throws unless the result validates. */
export function normalizeGuidedInteractionArtifact<Kind extends GuidedInteractionKind>(
  kind: Kind,
  value: unknown,
): { kind: Kind; schemaVersion: string; protocolVersion: '1.2.0'; [field: string]: unknown };
export function validateEvidenceDiagnostic(
  value: unknown,
  options?: { protocolVersion?: string },
): ProtocolValidationError[];
export function validateGuidedAnswerEnvelope(
  value: unknown,
  options?: { protocolVersion?: string },
): ProtocolValidationError[];
export function validateGuidedConfirmation(
  value: unknown,
  options?: { protocolVersion?: string },
): ProtocolValidationError[];
export function validateGuidedQuestion(
  value: unknown,
  options?: { protocolVersion?: string },
): ProtocolValidationError[];
export function validateGuidedQuestionnaire(
  value: unknown,
  options?: { protocolVersion?: string },
): ProtocolValidationError[];
export function validateGuidedSession(
  value: unknown,
  options?: { protocolVersion?: string },
): ProtocolValidationError[];
export function validateStructuredAction(
  value: unknown,
  options?: { protocolVersion?: string },
): ProtocolValidationError[];
export const GUIDED_INTERACTION_MODES: readonly string[];
/** Validates the questionnaire and actions when present and returns a copy. */
export function assertGuidedCliResult(result: unknown): {
  questionnaire?: GuidedQuestionnaireV1 | null;
  actions?: StructuredActionV1[];
  [field: string]: unknown;
};
export function createGuidedAnswerSubmission(
  questionnaire: Pick<
    GuidedQuestionnaireV1,
    | 'sessionId'
    | 'questionnaireVersion'
    | 'command'
    | 'projectIdentity'
    | 'projectHead'
    | 'configHead'
    | 'adapter'
    | 'questions'
  >,
): GuidedAnswerSubmissionV1;
export function createGuidedAnswerEnvelope(input: {
  questionnaire: GuidedQuestionnaireV1;
  answers: GuidedAnswerInput;
  runtime: string;
  runtimeVersion: string;
  interaction: Exclude<GuidedInteractionMode, 'none'>;
  submittedAt: string;
}): GuidedAnswerEnvelopeV1;
/** Requires a questionnaire that carries its own `submission` contract. */
export function createGuidedAnswerEnvelopeFromQuestionnaire(input: {
  questionnaire: GuidedQuestionnaireV1;
  answers: GuidedAnswerInput;
  submittedAt: string;
}): GuidedAnswerEnvelopeV1;
/** Newline-terminated JSON; throws when it exceeds `maxBytes` (64 KiB by default). */
export function encodeGuidedAnswerStdin(
  envelope: GuidedAnswerEnvelopeV1,
  options?: { maxBytes?: number },
): string;
/** Digest over `reduceGuidedAnswerEnvelope`, which leaves out transport and submission time. */
export function guidedAnswerPreviewDigest(envelope: GuidedAnswerEnvelopeV1): `sha256:${string}`;
export function reduceGuidedAnswerEnvelope(
  envelope: GuidedAnswerEnvelopeV1,
): Omit<GuidedAnswerEnvelopeV1, 'kind' | 'adapter' | 'submittedAt'>;
/** Presentation only: the result never confers mutation or provider authority. */
export function resolveGuidedInteraction(input: {
  registry: RuntimeAdapterRegistry;
  runtime: string;
  runtimeReport?: {
    nativeQuestions?: boolean;
    structuredChat?: boolean;
    attachedTerminal?: boolean;
  };
}): Readonly<{
  runtime: string;
  adapterVersion: string;
  declared: GuidedInteractionMode;
  mode: GuidedInteractionMode;
  fallback: boolean;
  attempted: GuidedInteractionMode[];
  diagnostic: Readonly<{
    code:
      | 'E_GUIDED_INTERACTION_UNAVAILABLE'
      | 'W_GUIDED_INTERACTION_DOWNGRADED'
      | 'I_GUIDED_INTERACTION_VERIFIED';
    reason: string;
    recovery: string | null;
  }>;
}>;
/** Echoes the CLI-owned action; a confirmed action needs its exact confirmation digest. */
export function selectGuidedAction(input: {
  actions: readonly StructuredActionV1[];
  actionId: string;
  confirmationDigest?: string | null;
}): Readonly<{
  actionId: string;
  command: string;
  confirmationDigest: string | null;
  effect: StructuredActionV1['effect'];
  providerUse: boolean;
}>;

/** The planning-facing projection of a parent SPEC's operating origin. */
export interface SpecOperatingOriginV1 {
  readonly correlationId: string;
  readonly proposalId: string;
  readonly proposalHash: string;
  readonly originHash: string;
  readonly specId: string;
  readonly decision: OperatingOriginV1['decision'];
  readonly action: OperatingOriginV1['action'];
  readonly metric: OperatingOriginV1['metric'];
  readonly verification: OperatingOriginV1['verification'];
  readonly transactionId: string;
  readonly receiptHash: string;
}

/** Null when the SPEC directory has no `operating-origin.json`; throws when it fails custody. */
export function loadSpecOperatingOrigin(
  specDir?: string | null,
): Readonly<OperatingOriginV1> | null;
/** Validates `origin` unless it is null. */
export function projectSpecOperatingOrigin(origin: unknown): SpecOperatingOriginV1 | null;
export function projectPipelineOperatingOriginCorrelation(
  origin: Pick<
    SpecOperatingOriginV1,
    'correlationId' | 'proposalId' | 'proposalHash' | 'transactionId' | 'receiptHash'
  > | null,
): Readonly<ProvenanceCorrelationV1> | null;
export type EcosystemSagaStepStatus =
  | 'pending'
  | 'ready'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'compensated'
  | 'skipped';

export interface EcosystemSagaParticipantV1 {
  id: string;
  repository: string;
  role: 'contract-owner' | 'behavior-owner' | 'adapter' | 'publisher';
}

export interface EcosystemSagaStepV1 {
  id: string;
  participantId: string;
  action: string;
  dependsOn: string[];
  idempotencyKey: string;
  status: EcosystemSagaStepStatus;
  attempts: number;
  evidence: string[];
  error?: string;
  completedAt?: string;
}

/** `schemas/v1.2.0/ecosystem-saga.schema.json`. */
export interface EcosystemSagaV1 {
  kind: 'ecosystem-saga';
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
  id: string;
  subject: string;
  state: 'planned' | 'in-progress' | 'blocked' | 'failed' | 'completed' | 'compensated';
  createdAt: string;
  updatedAt: string;
  participants: EcosystemSagaParticipantV1[];
  steps: EcosystemSagaStepV1[];
}

export type EcosystemReleaseParticipantState =
  | 'pending'
  | 'preparing'
  | 'prepared'
  | 'promoting'
  | 'verified'
  | 'completed'
  | 'blocked'
  | 'compensated'
  | 'forward-fix';

export interface EcosystemReleaseParticipantV1 {
  id: string;
  repository: string;
  repoLocalSpecId: string;
  state: EcosystemReleaseParticipantState;
  sourceVersion: string | null;
  targetVersion: string | null;
  targetBranch: string | null;
  commit: string | null;
  pullRequest: {
    number: number | null;
    url: string | null;
    state: 'none' | 'draft' | 'open' | 'merged' | 'closed';
  };
  tag: string | null;
  checks: Array<{ name: string; state: 'unknown' | 'pending' | 'passed' | 'failed' }>;
  approvals: Array<{ gate: string; state: 'not-required' | 'pending' | 'approved' | 'rejected' }>;
  package: {
    name: string | null;
    version: string | null;
    published: boolean;
    tarballDigest: string | null;
  };
  nextSafeAction: string;
}

/** `schemas/v1.2.0/ecosystem-release-operation.schema.json`. */
export interface EcosystemReleaseOperationV1 {
  kind: 'ecosystem-release-operation';
  schemaVersion: '1.0.0';
  protocolVersion: '1.2.0';
  operationId: string;
  operationDigest: string;
  specId: string;
  specDigest: string;
  state:
    | 'drafted'
    | 'preparing'
    | 'prepared'
    | 'promoting'
    | 'verified'
    | 'completed'
    | 'blocked'
    | 'compensating'
    | 'forward-fix';
  recoveryMode: 'compensation-available' | 'forward-fix-only';
  createdAt: string;
  updatedAt: string;
  participants: EcosystemReleaseParticipantV1[];
  nextSafeAction: string;
  blockedReason?: string;
}

/** An observed participant update; the digest-bound release plan fields must not change. */
export type EcosystemReleaseParticipantObservation = { id: string } & Partial<
  Omit<EcosystemReleaseParticipantV1, 'id' | 'pullRequest' | 'package'>
> & {
    pullRequest?: Partial<EcosystemReleaseParticipantV1['pullRequest']>;
    package?: Partial<EcosystemReleaseParticipantV1['package']>;
  };

/** Digest of the immutable release plan: spec identity plus each participant's target. */
export function computeEcosystemReleaseOperationDigest(input: {
  specId: string;
  specDigest: string;
  participants: ReadonlyArray<
    Pick<
      EcosystemReleaseParticipantV1,
      | 'id'
      | 'repository'
      | 'repoLocalSpecId'
      | 'sourceVersion'
      | 'targetVersion'
      | 'targetBranch'
      | 'tag'
    > & { package: Pick<EcosystemReleaseParticipantV1['package'], 'name' | 'version'> }
  >;
}): `sha256:${string}`;
/** Throws when a supplied `operationDigest` differs from the computed one. */
export function createEcosystemReleaseOperation(
  input: Omit<
    EcosystemReleaseOperationV1,
    'kind' | 'schemaVersion' | 'protocolVersion' | 'operationDigest'
  > & { operationDigest?: string },
): EcosystemReleaseOperationV1;
export function createEcosystemSaga(input: {
  id: string;
  subject: string;
  participants: EcosystemSagaParticipantV1[];
  steps: Array<
    Omit<EcosystemSagaStepV1, 'dependsOn' | 'status' | 'attempts' | 'evidence'> &
      Partial<Pick<EcosystemSagaStepV1, 'dependsOn' | 'status' | 'attempts' | 'evidence'>>
  >;
  createdAt: string;
}): EcosystemSagaV1;
/** Pending or ready steps whose dependencies completed or were skipped, sorted by ID. */
export function nextEcosystemSagaSteps(saga: EcosystemSagaV1): EcosystemSagaStepV1[];
export function reconcileEcosystemReleaseOperation(
  operation: EcosystemReleaseOperationV1,
  observedParticipants: readonly EcosystemReleaseParticipantObservation[],
  options?: { updatedAt?: string },
): EcosystemReleaseOperationV1;
export function reconcileEcosystemSaga(
  saga: EcosystemSagaV1,
  options?: { updatedAt?: string },
): EcosystemSagaV1;
/** Applies one step transition; repeating the current status is an idempotent replay. */
export function recordEcosystemSagaStep(
  saga: EcosystemSagaV1,
  update: {
    stepId: string;
    status: EcosystemSagaStepStatus;
    evidence?: readonly string[];
    error?: string;
    completedAt?: string;
  },
): EcosystemSagaV1;
export const ARTIFACT_ERROR_CODES: Readonly<Record<string, string>>;

export type ArtifactShareTtl = '1d' | '7d' | '30d';
export type ArtifactKeyMaterial = string | ArrayBuffer | ArrayBufferView;
export type ArtifactEnvironment = Readonly<Record<string, string | undefined>>;
/** Web Crypto provider; only `subtle` and `getRandomValues` are called. */
export type ArtifactWebCrypto =
  | Pick<Crypto, 'subtle' | 'getRandomValues'>
  | Pick<import('node:crypto').webcrypto.Crypto, 'subtle' | 'getRandomValues'>;

export type ArtifactReviewDecision = 'pending' | 'approved' | 'changes_requested';
export type ArtifactReviewAuthor = { id?: string; name: string };
export type ArtifactReviewReply = {
  id: string;
  author: ArtifactReviewAuthor;
  comment: string;
  createdAt: string;
};
export type ArtifactReviewPin = {
  id: string;
  author: ArtifactReviewAuthor;
  artifactId: string;
  variant?: string;
  region: { x: number; y: number; w: number; h: number };
  viewport: { width: number; height: number };
  anchor?: { planrId: string; screen?: string };
  intent: 'fix' | 'improve' | 'question';
  status: 'open' | 'addressed' | 'resolved';
  comment: string;
  replies: ArtifactReviewReply[];
  createdAt: string;
  updatedAt: string;
};
export type ArtifactReview = {
  schemaVersion: '1.0.0';
  reviewId: string;
  reviewOf: string;
  decision: ArtifactReviewDecision;
  overall: string;
  createdAt?: string;
  updatedAt?: string;
  pins: ArtifactReviewPin[];
};
export type ArtifactReviewLedgerEntry = { review: ArtifactReview; stale: boolean };
export type ArtifactReviewLedger = {
  schemaVersion: '1.0.0';
  kind: 'artifact-review-state';
  artifactId: string;
  currentReviewOf: string;
  reviews: ArtifactReviewLedgerEntry[];
};

export type ArtifactEnvelopeArtifact = {
  id: string;
  kind: 'html';
  title: string;
  sha256: string;
  html: string;
  viewport: { width: number; height: number };
  colorScheme: 'light' | 'dark';
};
export type ArtifactEnvelopeViewer = {
  mode: 'single' | 'variants';
  activeArtifactId: string;
  presentation?: 'document' | 'canvas';
};
export type ArtifactEnvelope = {
  schemaVersion: '1.0.0';
  artifacts: ArtifactEnvelopeArtifact[];
  viewer: ArtifactEnvelopeViewer;
  review?: ArtifactReview;
};
export type ArtifactEnvelopeArtifactInput = {
  readonly id: string;
  readonly title: string;
  readonly html: string;
  readonly sha256?: string;
  readonly viewport?: { readonly width?: number; readonly height?: number };
  readonly colorScheme?: 'light' | 'dark';
};
export type ArtifactEnvelopeInput = {
  readonly artifacts: readonly ArtifactEnvelopeArtifactInput[];
  readonly viewer?: {
    readonly mode?: 'single' | 'variants';
    readonly activeArtifactId?: string;
    readonly presentation?: 'document' | 'canvas';
  } | null;
  readonly review?: ArtifactReview | null;
};

export type ArtifactRemoteAssetResponse = {
  readonly status: number;
  readonly ok: boolean;
  readonly headers?: { get?(name: string): string | null | undefined } | null;
  readonly body?:
    | AsyncIterable<Uint8Array>
    | Iterable<Uint8Array>
    | ReadableStream<Uint8Array>
    | null;
};
export type ArtifactRemoteAssetFetch = (
  url: URL,
  init: {
    readonly redirect: 'manual';
    readonly signal: AbortSignal | undefined;
    readonly headers: { readonly accept: string };
  },
) => Promise<ArtifactRemoteAssetResponse>;
export type ArtifactHostLookup = (
  hostname: string,
  options: { readonly all: true; readonly verbatim: true },
) => Promise<readonly { readonly address: string }[] | { readonly address: string }>;
export type ArtifactBundleOptions = {
  root?: string;
  maxFiles?: number;
  maxBytes?: number;
  sensitiveValues?: readonly string[];
  remoteAssets?: 'bundle' | 'reject';
  fetchImpl?: ArtifactRemoteAssetFetch;
  lookupImpl?: ArtifactHostLookup;
};
export type ArtifactBundleAsset = { sha256: string; bytes: number; mediaType: string };
export type ArtifactBundle = {
  schemaVersion: '1.0.0';
  html: string;
  sha256: string;
  bytes: number;
  inputBytes: number;
  fileCount: number;
  remoteAssetCount: number;
  files: string[];
  assets: ArtifactBundleAsset[];
};

export type ArtifactFragmentEncodeOptions = {
  maxExpandedBytes?: number;
  maxCompressedBytes?: number;
};
export type ArtifactFragmentDecodeOptions = ArtifactFragmentEncodeOptions & {
  maxFragmentChars?: number;
  allowedOrigins?: readonly string[];
};
export type ArtifactFragmentEncoding = {
  readonly fragment: string;
  readonly fragmentLength: number;
  readonly compressed: Uint8Array;
};
export type ArtifactFragmentEncoder = (
  value: object,
  options: ArtifactFragmentEncodeOptions,
) => ArtifactFragmentEncoding;

export type ArtifactEncryptedPayload = {
  readonly version: 'v1';
  readonly iv: string;
  readonly ciphertext: string;
  readonly keyFragment: string;
  readonly compressedBytes: number;
  readonly encryptedBytes: number;
};
export type ArtifactEncryptedPayloadInput = {
  readonly version: 'v1';
  readonly iv: ArtifactKeyMaterial;
  readonly ciphertext: string;
  readonly keyFragment?: ArtifactKeyMaterial;
};
export type ArtifactEncryptOptions = {
  crypto?: ArtifactWebCrypto;
  cryptoImpl?: ArtifactWebCrypto;
  keyBytes?: ArtifactKeyMaterial;
  ivBytes?: ArtifactKeyMaterial;
  key?: ArtifactKeyMaterial;
  iv?: ArtifactKeyMaterial;
  maxEncryptedBytes?: number;
  maxCiphertextBytes?: number;
};
export type ArtifactDecryptOptions = {
  crypto?: ArtifactWebCrypto;
  cryptoImpl?: ArtifactWebCrypto;
  key?: ArtifactKeyMaterial;
  keyFragment?: ArtifactKeyMaterial;
  maxEncryptedBytes?: number;
  maxCiphertextBytes?: number;
};

export type ArtifactPasteFetch = (
  url: string,
  init: {
    readonly cache: 'no-store';
    readonly credentials: 'omit';
    readonly redirect: 'error';
    readonly referrerPolicy: 'no-referrer';
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
  },
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;
export type ArtifactPasteCreateRequest = {
  readonly schemaVersion: '1.0.0';
  readonly operation: 'create';
  readonly iv: string;
  readonly ciphertext: string;
  readonly ttl: ArtifactShareTtl;
};
export type ArtifactPasteClient = {
  create(request: ArtifactPasteCreateRequest): Promise<{
    readonly id: string;
    readonly expiresAt: string;
    readonly deletionToken: string;
  }>;
  get(id: string): Promise<{ readonly iv: string; readonly ciphertext: string }>;
};
export type ArtifactPayloadEncryptor = (
  compressed: Uint8Array,
  options: { readonly crypto: ArtifactWebCrypto | undefined; readonly maxEncryptedBytes: number },
) => Promise<
  Pick<
    ArtifactEncryptedPayload,
    'iv' | 'ciphertext' | 'keyFragment' | 'compressedBytes' | 'encryptedBytes'
  >
>;
export type ArtifactShortLinkConsent = {
  readonly fragmentLength: number;
  readonly compressedBytes: number;
  readonly ciphertextBytes: number;
  readonly ttl: ArtifactShareTtl;
  readonly forced: boolean;
};
export type ArtifactReviewLinkOptions = ArtifactFragmentEncodeOptions & {
  baseUrl?: string;
  short?: boolean;
  transport?: 'auto' | 'short';
  shortConsent?: boolean;
  /** Called for short links without a consent flag; the awaited result is coerced to boolean. */
  confirmShort?: (preview: ArtifactShortLinkConsent) => unknown;
  ttl?: ArtifactShareTtl;
  confirmed?: boolean;
  yes?: boolean;
  pasteClient?: Pick<ArtifactPasteClient, 'create'>;
  fetchImpl?: ArtifactPasteFetch;
  encodeImpl?: ArtifactFragmentEncoder;
  encryptImpl?: ArtifactPayloadEncryptor;
  crypto?: ArtifactWebCrypto;
};
export type ArtifactReviewLinkPreview = {
  readonly fragmentLength: number;
  readonly compressedBytes: number;
  readonly ciphertextBytes: number;
  readonly fragmentEligible: boolean;
};
export type ArtifactReviewLink =
  | {
      readonly ok: true;
      readonly action: 'artifact_review_link_created';
      readonly transport: 'fragment';
      readonly uploaded: false;
      readonly url: string;
      readonly fragmentLength: number;
      readonly compressedBytes: number;
      readonly ciphertextBytes: number;
      readonly size: number;
      readonly expiresAt: null;
      readonly deletionToken: null;
    }
  | {
      readonly ok: true;
      readonly action: 'artifact_review_link_created';
      readonly transport: 'short';
      readonly uploaded: true;
      readonly id: string;
      readonly iv: string;
      readonly url: string;
      readonly fragmentLength: number;
      readonly compressedBytes: number;
      readonly ciphertextBytes: number;
      readonly size: number;
      readonly expiresAt: string;
      readonly deletionToken: string;
    };
export type ArtifactReviewLinkDecodeOptions = ArtifactFragmentDecodeOptions & {
  pasteClient?: Pick<ArtifactPasteClient, 'get'>;
  fetchImpl?: ArtifactPasteFetch;
  crypto?: ArtifactWebCrypto;
};

/** Filesystem operations the review writers call; missing entries fall back to `node:fs`. */
export type ArtifactReviewFileSystem = {
  existsSync(path: string): boolean;
  lstatSync(path: string): { isSymbolicLink(): boolean; isFile(): boolean };
  mkdirSync(path: string, options: { recursive: true; mode: number }): void;
  writeFileSync(path: string, data: string, options: { mode: number; flag: 'wx' }): void;
  renameSync(oldPath: string, newPath: string): void;
  rmSync(path: string, options: { force: true }): void;
};
/** A review link string, or a decoded review, reviewed envelope, review ledger, or `{ review }`. */
export type ArtifactReviewSource = string | object;
export type ArtifactReviewImportOptions = {
  sources: ArtifactReviewSource | readonly ArtifactReviewSource[];
  currentEnvelope: ArtifactEnvelope;
  /** Required when a source is a string; its result is validated like an object source. */
  decodeSource?: (source: string, context: { index: number }) => unknown;
  allowStale?: boolean;
  cwd?: string;
  env?: ArtifactEnvironment;
  designDir?: string;
  persist?: boolean;
  fileSystem?: Partial<ArtifactReviewFileSystem>;
};
export type ArtifactReviewImportSummary = {
  readonly reviewId: string;
  readonly reviewDigest: string;
  readonly stale: boolean;
  readonly decision: ArtifactReviewDecision;
  readonly pinCount: number;
  readonly replyCount: number;
};
export type ArtifactReviewImportResult = {
  readonly ok: true;
  readonly action: 'artifact_review_imported';
  readonly artifactId: string;
  readonly currentReviewOf: string;
  readonly imported: readonly ArtifactReviewImportSummary[];
  readonly effectiveDecision: ArtifactReviewDecision;
  readonly destination: {
    readonly kind: 'design' | 'project' | 'user';
    readonly artifactId: string;
  };
  readonly reviewState: ArtifactReviewLedger;
};

export type LiveRoomSignerRole = 'owner' | 'reviewer';
export type LiveRoomCapability = 'reviewer-write' | 'owner-verdict' | 'room-management';
export type LiveRoomCapabilities = {
  readonly reviewer: 'reviewer-write';
  readonly owner: 'owner-verdict';
  readonly management: 'room-management';
};
export type LiveRoomPublicKey = {
  readonly algorithm: 'ECDSA-P256-SHA256';
  readonly encoding: 'spki-base64url';
  readonly keyId: string;
  readonly value: string;
};
export type LiveRoomDescriptor = {
  readonly schemaVersion: '2.0.0';
  readonly protocolVersion: '2.0.0';
  readonly roomId: string;
  readonly reviewOf: string;
  readonly ownerKey: LiveRoomPublicKey;
  readonly capabilities: LiveRoomCapabilities;
  readonly createdAt: string;
};
export type LiveRoomSignerSecret<R extends LiveRoomSignerRole = LiveRoomSignerRole> = {
  readonly schemaVersion: '1.0.0';
  readonly kind: 'openplanr-live-room-signer';
  readonly role: R;
  readonly algorithm: 'ECDSA-P256-SHA256';
  readonly keyId: string;
  readonly publicKey: string;
  readonly privateKey: string;
};
/** Signer created or imported by this package; `sign` and `exportSecret` are non-enumerable. */
export type LiveRoomSigner<R extends LiveRoomSignerRole = LiveRoomSignerRole> = {
  readonly role: R;
  readonly algorithm: 'ECDSA-P256-SHA256';
  readonly encoding: 'spki-base64url';
  readonly keyId: string;
  readonly value: string;
  sign(bytes: ArrayBuffer | ArrayBufferView): Promise<string>;
  exportSecret(): Promise<LiveRoomSignerSecret<R>>;
};
/**
 * Signer fields the room functions read; `publicKey` is accepted in place of `value`.
 * `exportSecret` is required only by `exportLiveRoomRecoveryBundle`.
 */
export type LiveRoomSigningKey<R extends LiveRoomSignerRole = LiveRoomSignerRole> = {
  readonly role: R;
  readonly algorithm: 'ECDSA-P256-SHA256';
  readonly encoding: 'spki-base64url';
  readonly keyId: string;
  sign(bytes: Uint8Array): string | PromiseLike<string>;
  exportSecret?(): LiveRoomSignerSecret | PromiseLike<LiveRoomSignerSecret>;
} & ({ readonly value: string } | { readonly publicKey: string });

export type LiveRoomEventKind =
  | 'pin'
  | 'reply'
  | 'pin_status'
  | 'recommendation'
  | 'owner_decision'
  | 'review_snapshot';
export type LiveRoomReplyPayload = { pinId: string; reply: ArtifactReviewReply };
export type LiveRoomPinStatusPayload = { pinId: string; status: ArtifactReviewPin['status'] };
export type LiveRoomRecommendationPayload = {
  author: ArtifactReviewAuthor;
  decision: ArtifactReviewDecision;
  overall: string;
};
export type LiveRoomOwnerDecisionPayload = {
  decision: 'approved' | 'changes_requested';
  overall?: string;
};
export type LiveRoomReviewSnapshotPayload = { review: ArtifactReview };
export type LiveRoomEventBody =
  | { kind: 'pin'; payload: ArtifactReviewPin }
  | { kind: 'reply'; payload: LiveRoomReplyPayload }
  | { kind: 'pin_status'; payload: LiveRoomPinStatusPayload }
  | { kind: 'recommendation'; payload: LiveRoomRecommendationPayload }
  | { kind: 'owner_decision'; payload: LiveRoomOwnerDecisionPayload }
  | { kind: 'review_snapshot'; payload: LiveRoomReviewSnapshotPayload };
export type LiveRoomEvent = {
  schemaVersion: '1.0.0';
  eventId: string;
  roomId: string;
  reviewOf: string;
  createdAt: string;
} & LiveRoomEventBody;
/** `eventId` defaults to `crypto.randomUUID()` and `createdAt` to the current time. */
export type LiveRoomEventInput = {
  readonly roomId: string;
  readonly reviewOf: string;
  readonly eventId?: string;
  readonly createdAt?: string;
} & LiveRoomEventBody;
export type LiveRoomSignedEvent = {
  readonly schemaVersion: '2.0.0';
  readonly protocolVersion: '2.0.0';
  readonly roomId: string;
  readonly eventId: string;
  readonly sequence: number;
  readonly predecessor: string;
  readonly reviewOf: string;
  readonly authorKey: LiveRoomPublicKey;
  readonly createdAt: string;
  readonly iv: string;
  readonly ciphertext: string;
  readonly plaintextDigest: string;
  readonly ciphertextDigest: string;
  readonly signature: string;
} & (
  | {
      readonly authorRole: 'owner';
      readonly capability: 'owner-verdict';
      readonly kind: 'owner_decision' | 'review_snapshot';
    }
  | {
      readonly authorRole: 'reviewer';
      readonly capability: 'reviewer-write';
      readonly kind: 'pin' | 'reply' | 'pin_status' | 'recommendation';
    }
);
export type LiveRoomEventCiphertext = {
  readonly version: 'v1';
  readonly iv: string;
  readonly ciphertext: string;
};
export type LiveRoomChainEntry = {
  readonly record: LiveRoomSignedEvent;
  readonly event?: LiveRoomEvent;
};
export type LiveRoomVerifiedEvent = {
  readonly record: LiveRoomSignedEvent;
  readonly event: LiveRoomEvent | null;
  readonly recordHash: string;
};
export type LiveRoomVerifiedChain = {
  readonly descriptor: LiveRoomDescriptor;
  readonly records: readonly LiveRoomSignedEvent[];
  readonly events: readonly LiveRoomEvent[];
  readonly head: string;
  readonly generation: number;
  readonly replayedEventIds: readonly string[];
};
export type LiveRoomProjection = {
  readonly review: Readonly<ArtifactReview>;
  readonly recommendations: LiveRoomRecommendationPayload[];
};
export type LiveRoomIntegrity = {
  readonly protocolVersion: '2.0.0';
  readonly generation: number;
  readonly head: string;
  readonly replayedEventIds: readonly string[];
};
export type LiveRoomResilientIntegrity = LiveRoomIntegrity & {
  readonly quarantinedEventIds: readonly string[];
};
export type LiveRoomLink = {
  readonly origin: string;
  readonly roomId: string;
  readonly key: string;
} & (
  | { readonly role: 'reviewer'; readonly write: string }
  | { readonly role: 'owner'; readonly owner: string }
  | { readonly role: 'management'; readonly manage: string }
  | { readonly role: 'reader' }
);

export type LiveRoomFetch = (
  url: string,
  init: {
    readonly cache: 'no-store';
    readonly credentials: 'omit';
    readonly redirect: 'error';
    readonly referrerPolicy: 'no-referrer';
    readonly method?: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
  },
) => Promise<{ readonly ok: boolean; readonly status: number; text(): Promise<string> }>;
export type LiveRoomPrepareOptions = {
  baseUrl?: string;
  ttl?: ArtifactShareTtl;
  ownerSigner?: LiveRoomSigningKey<'owner'>;
  crypto?: ArtifactWebCrypto;
};
/** `url`, `ownerUrl`, `manageUrl`, and `ownerSigner` are non-enumerable, so JSON omits them. */
export type PreparedLiveReviewRoom = {
  readonly schemaVersion: '1.0.0';
  readonly kind: 'openplanr-live-room-preparation';
  readonly protocolVersion: '2.0.0';
  readonly id: string;
  readonly roomId: string;
  readonly reviewOf: string;
  readonly ttl: ArtifactShareTtl;
  readonly ownerKey: LiveRoomPublicKey;
  readonly url: string;
  readonly ownerUrl: string;
  readonly manageUrl: string;
  readonly ownerSigner: LiveRoomSigningKey<'owner'>;
};
export type LiveRoomRecoveryBundle = {
  readonly schemaVersion: '1.0.0';
  readonly kind: 'openplanr-live-room-recovery';
  readonly protocolVersion: '2.0.0';
  readonly id: string;
  readonly roomId: string;
  readonly reviewOf: string;
  readonly ttl: ArtifactShareTtl;
  readonly ownerKey: LiveRoomPublicKey;
  readonly url: string;
  readonly ownerUrl: string;
  readonly manageUrl: string;
  readonly ownerSigner: LiveRoomSignerSecret;
};
/** `url`, `ownerUrl`, `manageUrl`, and `ownerSigner` are non-enumerable, so JSON omits them. */
export type ImportedLiveRoomRecovery = {
  readonly schemaVersion: '1.0.0';
  readonly kind: 'openplanr-live-room-recovery';
  readonly protocolVersion: '2.0.0';
  readonly id: string;
  readonly roomId: string;
  readonly reviewOf: string;
  readonly ttl: ArtifactShareTtl;
  readonly ownerKey: LiveRoomPublicKey;
  readonly url: string;
  readonly ownerUrl: string;
  readonly manageUrl: string;
  readonly ownerSigner: LiveRoomSigner<'owner'>;
};
/** `ownerSigner` and `prepared` are non-enumerable, so JSON omits them. */
export type LiveReviewRoomCreated = {
  readonly ok: true;
  readonly action: 'artifact_live_room_created';
  readonly id: string;
  readonly reviewOf: string;
  readonly expiresAt: string;
  readonly descriptor: LiveRoomDescriptor;
  readonly generation: 0;
  readonly head: string;
  readonly url: string;
  readonly ownerUrl: string;
  readonly manageUrl: string;
  readonly ownerSigner: LiveRoomSigningKey<'owner'>;
  readonly prepared: PreparedLiveReviewRoom;
};
export type LiveRoomClient = {
  create(
    options:
      | { readonly prepared: object }
      | {
          readonly envelope: ArtifactEnvelope;
          readonly ttl?: ArtifactShareTtl;
          readonly ownerSigner?: LiveRoomSigningKey<'owner'>;
          readonly crypto?: ArtifactWebCrypto;
        },
  ): Promise<LiveReviewRoomCreated>;
  read(roomId: string): Promise<unknown>;
  append(
    roomId: string,
    capability: string,
    request: { readonly expectedGeneration: number; readonly record: LiveRoomSignedEvent },
  ): Promise<unknown>;
  manage(roomId: string, capability: string, operation: unknown): Promise<unknown>;
};
export type LegacyLiveReviewRoomHydration = LiveRoomProjection & {
  readonly room: LiveRoomLink;
  readonly envelope: ArtifactEnvelope;
  readonly reviewOf: string;
  readonly commentsEnabled: boolean;
  readonly expiresAt: unknown;
  readonly protocolVersion: '1.0.0';
  readonly mutation: { readonly enabled: false; readonly reason: 'legacy-unsigned-room' };
};
export type SignedLiveReviewRoomHydration = LiveRoomProjection & {
  readonly room: LiveRoomLink;
  readonly envelope: ArtifactEnvelope;
  readonly reviewOf: string;
  readonly commentsEnabled: boolean;
  readonly expiresAt: string;
  readonly protocolVersion: '2.0.0';
  readonly descriptor: LiveRoomDescriptor;
  readonly mutation:
    | { readonly enabled: true; readonly reason: null }
    | {
        readonly enabled: false;
        readonly reason: 'management-only' | 'read-only-link' | 'comments-paused';
      };
  readonly integrity: LiveRoomResilientIntegrity;
};
export type LiveReviewRoomHydration = LegacyLiveReviewRoomHydration | SignedLiveReviewRoomHydration;
/** `ownerSigner` is non-enumerable, so JSON omits it. */
export type RecoveredLiveReviewRoom = SignedLiveReviewRoomHydration & {
  readonly ownerSigner: LiveRoomSigner<'owner'>;
};

export type ArtifactLoopbackFetch = (
  url: string,
  init: {
    readonly cache?: 'no-store';
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly signal: AbortSignal;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;
export type ArtifactReviewExport = {
  readonly ok: true;
  readonly action: 'artifact_review_exported';
  readonly sessionId: string;
  readonly format: 'json' | 'markdown';
  readonly content: string;
};
export type ArtifactReviewStartOptions = {
  envelope: ArtifactEnvelope;
  title?: string;
  theme?: 'auto' | 'light' | 'dark';
  port?: number;
  noOpen?: boolean;
  env?: ArtifactEnvironment;
  cwd?: string;
  fetchImpl?: ArtifactLoopbackFetch;
  /** Not called under `noOpen` or SSH; a rejection is reported in `launch.error`. */
  openUrl?: (url: string) => unknown;
};
export type ArtifactReviewLaunch =
  | { readonly attempted: boolean; readonly ok: true }
  | {
      readonly attempted: true;
      readonly ok: false;
      readonly error: { readonly code: 'E_ARTIFACT_BROWSER_OPEN_FAILED'; readonly message: string };
    };
export type ArtifactReviewSessionSummary = {
  ok: true;
  action: 'artifact_review_started';
  executionMode: 'loopback';
  sessionId: string;
  host: '127.0.0.1';
  port: number;
  url: string;
  noOpen: boolean;
  shouldOpen: boolean;
  opened: boolean;
  launch: ArtifactReviewLaunch;
  remote: {
    readonly detected: boolean;
    readonly browserUrl: string;
    readonly forwardingCommand: string;
    readonly instruction: string;
  };
};
export type ArtifactReviewSession = Readonly<ArtifactReviewSessionSummary> & {
  getReview(): Promise<{
    ok: true;
    reviewState: ArtifactReviewLedger;
    effectiveDecision: ArtifactReviewDecision;
  }>;
  exportReview(format?: 'json' | 'markdown'): Promise<string>;
  close(): Promise<{ ok: true; remaining: number } | { ok: true; alreadyClosed: true }>;
  toJSON(): ArtifactReviewSessionSummary;
};

export function bundleArtifact(
  entry: string,
  options?: ArtifactBundleOptions,
): Promise<ArtifactBundle>;
export function bundleArtifact(
  options: ArtifactBundleOptions & ({ entry: string } | { file: string }),
): Promise<ArtifactBundle>;

export function createArtifactEnvelope(input: ArtifactEnvelopeInput): ArtifactEnvelope;

export function createReviewLink(
  value: object,
  options?: ArtifactReviewLinkOptions,
): Promise<ArtifactReviewLink>;

export function createReviewLinkPreview(
  value: object,
  options?: ArtifactFragmentEncodeOptions & { encodeImpl?: ArtifactFragmentEncoder },
): ArtifactReviewLinkPreview;

export function decodeArtifactFragment(
  source: string,
  options?: ArtifactFragmentDecodeOptions,
): Record<string, unknown>;

export function decodeReviewLink(
  source: string,
  options?: ArtifactReviewLinkDecodeOptions,
): Promise<Record<string, unknown>>;

export function decryptArtifactPayload(
  payload: ArtifactEncryptedPayloadInput,
  options?: ArtifactDecryptOptions,
): Promise<Uint8Array>;

export function encodeArtifactFragment(
  value: object,
  options?: ArtifactFragmentEncodeOptions,
): string;

export function encryptArtifactPayload(
  value: ArrayBuffer | ArrayBufferView,
  options?: ArtifactEncryptOptions,
): Promise<ArtifactEncryptedPayload>;

export function importArtifactReview(
  options: ArtifactReviewImportOptions,
): Promise<ArtifactReviewImportResult>;

export function mergeArtifactFeedback(
  ledger: ArtifactReviewLedger,
  incoming: ArtifactReview | readonly ArtifactReview[],
  options?: { stale?: boolean },
): ArtifactReviewLedger;

export function createLiveReviewRoom(
  envelope: ArtifactEnvelope,
  options?: LiveRoomPrepareOptions & { fetchImpl?: LiveRoomFetch },
): Promise<LiveReviewRoomCreated>;

export function prepareLiveReviewRoom(
  envelope: ArtifactEnvelope,
  options?: LiveRoomPrepareOptions,
): Promise<PreparedLiveReviewRoom>;

export function commitLiveReviewRoom(
  prepared: object,
  options?: { baseUrl?: string; fetchImpl?: LiveRoomFetch },
): Promise<LiveReviewRoomCreated>;

export function exportLiveRoomRecoveryBundle(prepared: object): Promise<LiveRoomRecoveryBundle>;

export function importLiveRoomRecoveryBundle(
  value: unknown,
  options?: { crypto?: ArtifactWebCrypto },
): Promise<ImportedLiveRoomRecovery>;

export function recoverLiveReviewRoom(
  value: unknown,
  options?: { client?: Pick<LiveRoomClient, 'read'>; crypto?: ArtifactWebCrypto },
): Promise<RecoveredLiveReviewRoom>;

export function appendLiveRoomEvent(
  link: string,
  event: LiveRoomEventInput,
  options?: {
    client?: Pick<LiveRoomClient, 'read' | 'append'>;
    signer?: LiveRoomSigningKey;
    crypto?: ArtifactWebCrypto;
  },
): Promise<unknown>;

export function createLiveRoomClient(options?: {
  baseUrl?: string;
  fetchImpl?: LiveRoomFetch;
}): LiveRoomClient;

export function createLiveRoomEvent(input: LiveRoomEventInput): Readonly<LiveRoomEvent>;

export function createLiveRoomEventFromReviewChange(options: {
  roomId: string;
  reviewOf: string;
  role: LiveRoomSignerRole;
  previousReview: ArtifactReview;
  nextReview: ArtifactReview;
  author?: ArtifactReviewAuthor;
  eventId?: string;
  createdAt?: string;
}): Readonly<LiveRoomEvent>;

export function decryptLiveRoomEvent(
  record: Omit<ArtifactEncryptedPayloadInput, 'version'> & { readonly version?: 'v1' },
  options: {
    key?: ArtifactKeyMaterial;
    roomId: string;
    reviewOf: string;
    crypto?: ArtifactWebCrypto;
  },
): Promise<Readonly<LiveRoomEvent>>;

export function encryptLiveRoomEvent(
  event: LiveRoomEventInput,
  options?: { key?: ArtifactKeyMaterial; crypto?: ArtifactWebCrypto },
): Promise<ArtifactEncryptedPayload>;

export function hydrateLiveReviewRoom(
  link: string,
  options?: { client?: Pick<LiveRoomClient, 'read'>; crypto?: ArtifactWebCrypto },
): Promise<LiveReviewRoomHydration>;

export function reduceLiveRoomEvents(options: {
  roomId: string;
  reviewOf: string;
  events?: readonly LiveRoomEventInput[];
  reviewId?: string;
}): LiveRoomProjection;

export function reduceResilientSignedLiveRoomEvents(options: {
  descriptor: LiveRoomDescriptor;
  records?: readonly LiveRoomSignedEvent[];
  reviewId?: string;
  key: string;
  crypto?: ArtifactWebCrypto;
}): Promise<LiveRoomProjection & { readonly integrity: LiveRoomResilientIntegrity }>;

export function reduceSignedLiveRoomEvents(options: {
  descriptor: LiveRoomDescriptor;
  entries?: readonly LiveRoomChainEntry[];
  reviewId?: string;
  key?: string;
  crypto?: ArtifactWebCrypto;
}): Promise<LiveRoomProjection & { readonly integrity: LiveRoomIntegrity }>;

export function createLiveRoomDescriptor(options: {
  roomId: string;
  reviewOf: string;
  ownerSigner: LiveRoomSigningKey<'owner'>;
  createdAt?: string;
}): LiveRoomDescriptor;

export function createLiveRoomSigner<R extends LiveRoomSignerRole>(options: {
  role: R;
  crypto?: ArtifactWebCrypto;
}): Promise<LiveRoomSigner<R>>;

export function createSignedLiveRoomEvent(options: {
  descriptor: LiveRoomDescriptor;
  event: LiveRoomEvent;
  ciphertext: LiveRoomEventCiphertext;
  sequence: number;
  predecessor?: string;
  signer: LiveRoomSigningKey;
  key: string;
  crypto?: ArtifactWebCrypto;
}): Promise<LiveRoomSignedEvent>;

export function exportLiveRoomSignerSecret<R extends LiveRoomSignerRole>(
  signer: Pick<LiveRoomSigner<R>, 'exportSecret'>,
): Promise<LiveRoomSignerSecret<R>>;

export function importLiveRoomSignerSecret(
  secret: unknown,
  options?: { crypto?: ArtifactWebCrypto },
): Promise<LiveRoomSigner<'owner'> | LiveRoomSigner<'reviewer'>>;

export function verifyLiveRoomEventChain(options: {
  descriptor: LiveRoomDescriptor;
  entries?: readonly LiveRoomChainEntry[];
  key?: string;
  crypto?: ArtifactWebCrypto;
}): Promise<LiveRoomVerifiedChain>;

export function verifySignedLiveRoomEvent(options: {
  descriptor: LiveRoomDescriptor;
  record: LiveRoomSignedEvent;
  event?: LiveRoomEvent;
  expectedSequence?: number;
  expectedPredecessor?: string;
  authorizedCapability?: LiveRoomCapability;
  key?: string;
  crypto?: ArtifactWebCrypto;
}): Promise<LiveRoomVerifiedEvent>;

export function exportArtifactReviewSession(
  sessionId: string,
  options?: {
    format?: 'json' | 'markdown';
    env?: ArtifactEnvironment;
    fetchImpl?: ArtifactLoopbackFetch;
  },
): Promise<ArtifactReviewExport>;

export function startArtifactReview(
  options: ArtifactReviewStartOptions,
): Promise<ArtifactReviewSession>;
