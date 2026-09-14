import type {
  GuidedQuestion,
  HeadlessQuestionPolicy,
  HostProfile,
  InteractionResolution,
  ProtocolSkillSessionInput,
  QuestionnaireBindingInput,
  RepositoryContext,
  RuntimeCapabilityReport,
} from '../resolver/index.mjs';

export type CompletionStatus = 'completed' | 'partial' | 'blocked' | 'unavailable' | 'cancelled';
export type CheckStatus = 'passed' | 'failed' | 'not-run';
export type DataFeature = 'learning' | 'telemetry' | 'external-data';
export type ConsentDecision = 'granted' | 'declined' | 'withdrawn';
export type ConsentResolutionDecision = ConsentDecision | 'unset';
export type LearningCategory = 'context' | 'review' | 'implementation' | 'diagnostic';
export type OperationClass = 'planning' | 'read-only' | 'implementation' | 'external-effect' | 'destructive';

declare const preparedLearningBrand: unique symbol;

export interface CompletionCheck {
  name: string;
  status: CheckStatus;
  detail?: string;
}

export interface PassedCompletionCheck extends CompletionCheck {
  status: 'passed';
}

export interface CompletionIssue {
  problem: string;
  impact: string;
  nextAction: string;
}

interface CompletionResultBase {
  summary: string;
  output?: unknown;
}

export interface CompletedCompletionResult extends CompletionResultBase {
  status: 'completed';
  checks: readonly PassedCompletionCheck[];
  issues: readonly [];
}

export interface NonCompletedCompletionResult extends CompletionResultBase {
  status: Exclude<CompletionStatus, 'completed'>;
  checks: readonly CompletionCheck[];
  issues: readonly CompletionIssue[];
}

export type CompletionResult = CompletedCompletionResult | NonCompletedCompletionResult;

export interface CompletedCompletionInput {
  status: 'completed';
  summary: string;
  checks?: readonly PassedCompletionCheck[];
  issues?: readonly [];
  output?: unknown;
}

export interface NonCompletedCompletionInput {
  status: Exclude<CompletionStatus, 'completed'>;
  summary: string;
  checks?: readonly CompletionCheck[];
  issues?: readonly CompletionIssue[];
  output?: unknown;
}

export type CompletionInput = CompletedCompletionInput | NonCompletedCompletionInput;

export interface CompletedCompletionDetails {
  summary: string;
  checks?: readonly PassedCompletionCheck[];
  issues?: readonly [];
}

export interface NonCompletedCompletionDetails {
  summary: string;
  checks?: readonly CompletionCheck[];
  issues?: readonly CompletionIssue[];
}

export interface LifecycleSettings {
  learning: boolean;
  history: boolean;
  telemetry: boolean;
  sync: boolean;
  updates: boolean;
  externalData: boolean;
}

export interface GuidedConfirmation {
  readonly kind: 'guided-confirmation';
  readonly schemaVersion: '1.0.0';
  readonly protocolVersion: '1.2.0';
  readonly confirmationId: string;
  readonly state: 'confirmed';
  readonly actionId: string;
  readonly sessionId: string;
  readonly command: `planr ${string}`;
  readonly effect: 'read-only' | 'machine-local-write' | 'project-write' | 'provider-call' | 'external-effect';
  readonly providerUse: boolean;
  readonly confirmationScope: string;
  readonly confirmationDigest: `sha256:${string}`;
  readonly projectIdentity: `sha256:${string}`;
  readonly projectHead: `sha256:${string}`;
  readonly configHead: `sha256:${string}`;
  readonly eventHead?: Readonly<{ sequence: number; hash: `sha256:${string}` }> | null;
  readonly arguments: readonly string[];
  readonly destinations: readonly string[];
  readonly writes: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly confirmedAt: string;
  readonly confirmedBy: string;
  readonly terminalReason?: string;
}

export interface SkillConsentRecord {
  readonly kind: 'skill-consent-record';
  readonly schemaVersion: '1.0.0';
  readonly protocolVersion: '1.6.0';
  readonly documentVersion: string;
  readonly digestAlgorithm: 'sha256';
  readonly canonicalization: 'rfc8785';
  readonly documentDigest: `sha256:${string}`;
  readonly consentId: string;
  readonly skillId: string;
  readonly subject: DataFeature;
  readonly decision: ConsentDecision;
  readonly recordedAt: string;
  readonly confirmation: GuidedConfirmation;
}

export interface LifecycleDiagnostic {
  readonly feature: 'learning' | 'telemetry' | 'externalData';
  readonly status: 'disabled' | 'unavailable';
  readonly reason: string;
}

export interface DataFeatureConsentResolution {
  readonly decision: ConsentResolutionDecision;
  readonly consentId: string | null;
}

export interface SkillLearningRecord {
  readonly kind: 'skill-learning-record';
  readonly schemaVersion: '1.0.0';
  readonly protocolVersion: '1.6.0';
  readonly documentVersion: string;
  readonly digestAlgorithm: 'sha256';
  readonly canonicalization: 'rfc8785';
  readonly documentDigest: `sha256:${string}`;
  readonly learningId: string;
  readonly skillId: string;
  readonly observedAt: string;
  readonly category: LearningCategory;
  readonly note: string;
  readonly consentGranted: true;
  readonly consentRef: string;
}

export interface PreparedLearningCompletedResult {
  readonly [preparedLearningBrand]: true;
  readonly status: 'completed';
  readonly record: SkillLearningRecord;
  readonly reason: 'learning-ready' | 'learning-redacted';
  readonly redactions: number;
  readonly disallowed: readonly [];
}

export interface PreparedLearningUnavailableResult {
  readonly [preparedLearningBrand]: true;
  readonly status: 'blocked' | 'unavailable';
  readonly record: null;
  readonly reason: 'disallowed-learning-data' | 'learning-disabled' | 'learning-empty-after-redaction';
  readonly disallowed: readonly string[];
}

export type PreparedLearningResult = PreparedLearningCompletedResult | PreparedLearningUnavailableResult;

export interface LearningPersistenceResult {
  readonly status: 'completed' | 'blocked' | 'unavailable';
  readonly path: typeof LOCAL_LEARNING_PATH | null;
  readonly reason: string;
}

export interface LifecycleEnvironment {
  readonly status: 'completed' | 'partial';
  readonly projectRoot: string;
  readonly repository: boolean;
  readonly runtimePath: '.planr/runtime';
  readonly runtimeIgnored: boolean;
  readonly stateExists: boolean;
  readonly stateAvailable: boolean;
  readonly firstRun: boolean;
  readonly nodeMajor: number;
  readonly notice: string;
  readonly issue?: string;
}

export interface LifecycleConfigurationResult {
  readonly status: 'completed' | 'partial';
  readonly source: string;
  readonly settings: Readonly<LifecycleSettings>;
  readonly notice: string;
  readonly issue?: string;
}

export interface LifecycleCompatibilityResult {
  readonly status: 'compatible' | 'fresh';
  readonly mode: 'fresh' | 'resume';
  readonly compatible: boolean;
  readonly reasons: readonly string[];
  readonly notice: string;
}

export interface SkillProgressRecord {
  readonly kind: 'skill-progress-record';
  readonly documentDigest: `sha256:${string}`;
  readonly stateVersion: '1.0.0';
  readonly runtimeVersion: string;
  readonly protocolVersion: '1.6.0';
  readonly sessionId: string;
  readonly skillId: string;
  readonly checkpointedAt: string;
  readonly expiresAt: string;
  readonly checkpoint: SkillSessionCheckpoint;
}

export interface LifecycleSettingsResolution {
  readonly settings: Readonly<LifecycleSettings>;
  readonly decisions: Readonly<Record<DataFeature, ConsentResolutionDecision>>;
  readonly diagnostics: readonly LifecycleDiagnostic[];
}

export type SkillSessionDocument = ProtocolSkillSessionInput;

export interface SkillSessionCheckpoint {
  readonly kind: 'skill-session-checkpoint';
  readonly documentDigest: `sha256:${string}`;
  readonly version: '1.0.0';
  readonly skillId: string;
  readonly session: SkillSessionDocument;
  readonly contextBinding: `sha256:${string}`;
  readonly questionBinding: `sha256:${string}`;
  readonly safeState: unknown;
  readonly checkpointedAt: string;
}

export interface SkillSessionCheckpointResult {
  readonly status: 'completed' | 'partial';
  readonly checkpoint: SkillSessionCheckpoint | null;
  readonly notice: string;
}

export interface SkillSessionRecoveryResult {
  readonly status: 'completed';
  readonly mode: 'recovered' | 'fresh';
  readonly session: SkillSessionDocument;
  readonly safeState: unknown;
  readonly notice: string;
}

export declare const COMPLETION_STATUSES: readonly CompletionStatus[];
export declare const DATA_FEATURES: readonly DataFeature[];
export declare const OPERATION_CLASSES: readonly OperationClass[];
export declare const DEFAULT_LIFECYCLE_SETTINGS: Readonly<LifecycleSettings>;
export declare const LOCAL_LEARNING_PATH: '.planr/runtime/skill-learning.jsonl';
export declare const LIFECYCLE_CONFIGURATION_PATH: '.planr/runtime/skill-runtime.json';
export declare const LIFECYCLE_IGNORE_RULE: '.planr/runtime/';
export declare const LIFECYCLE_RUNTIME_DIRECTORY: '.planr/runtime';
export declare const LIFECYCLE_SESSION_DIRECTORY: '.planr/runtime/skill-sessions';
export declare const LIFECYCLE_RUNTIME_VERSION: '0.1.0';
export declare const LIFECYCLE_PROTOCOL_VERSION: '1.6.0';
export declare const LIFECYCLE_STATE_VERSION: '1.0.0';
export declare const DEFAULT_PROGRESS_TTL_MS: number;

export declare function createCompletion(input: CompletionInput): CompletionResult;

export declare function completionFromRuntimeResult(
  result: Readonly<Record<string, unknown>> & { status: 'completed' },
  input: CompletedCompletionDetails,
): CompletedCompletionResult;

export declare function completionFromRuntimeResult(
  result: Readonly<Record<string, unknown>> & { status: Exclude<CompletionStatus, 'completed'> | 'denied' },
  input: NonCompletedCompletionDetails,
): NonCompletedCompletionResult;

export declare function createConsentRecord(input: {
  consentId: string;
  skillId: string;
  subject: DataFeature;
  decision: ConsentDecision;
  recordedAt: string;
  projectIdentity: `sha256:${string}`;
  confirmation: GuidedConfirmation;
}): SkillConsentRecord;

export declare function resolveLifecycleSettings(input: {
  skillId: string;
  projectIdentity?: `sha256:${string}`;
  configured?: Partial<LifecycleSettings>;
  consents?: readonly SkillConsentRecord[];
  headless?: boolean;
}): Readonly<LifecycleSettingsResolution>;

export declare function resolveDataFeatureConsent(input: {
  skillId: string;
  subject: DataFeature;
  projectIdentity?: `sha256:${string}`;
  consents?: readonly SkillConsentRecord[];
}): Readonly<DataFeatureConsentResolution>;

export declare function classifyOperation(operationClass: OperationClass): Readonly<{
  operationClass: OperationClass;
  effect: 'none' | 'read-only' | 'project-write' | 'external' | 'destructive';
  execution: 'local' | 'host';
}>;

export declare function createSkillSession(input: {
  skillId: string;
  questions?: readonly GuidedQuestion[];
  startedAt?: string;
  now?: string | (() => string);
  createSessionId?: () => string;
}): SkillSessionDocument;

export declare function updateSkillSession(
  session: SkillSessionDocument,
  input: { state: 'open' | 'answered' | 'closed' | 'expired'; questions?: readonly GuidedQuestion[] },
): SkillSessionDocument;

export declare function checkpointSession(input: {
  session: SkillSessionDocument;
  context: unknown;
  safeState?: unknown;
  checkpointedAt?: string;
  now?: string | (() => string);
}): SkillSessionCheckpointResult;

export declare function recoverSession(input: {
  checkpoint?: SkillSessionCheckpoint | Readonly<Record<string, unknown>> | null;
  skillId: string;
  context?: unknown;
  questions?: readonly GuidedQuestion[];
  now?: string | (() => string);
  createSessionId?: () => string;
}): SkillSessionRecoveryResult;

export declare function prepareLearningRecord(input: {
  learningId: string;
  skillId: string;
  observedAt: string;
  category: LearningCategory;
  note: string;
  projectIdentity?: `sha256:${string}`;
  consent?: SkillConsentRecord | null;
  rawPrompt?: unknown;
  artifactBody?: unknown;
}): PreparedLearningResult;

export declare function persistLearningRecord(input: {
  projectRoot: string;
  prepared: PreparedLearningResult;
  relativePath?: typeof LOCAL_LEARNING_PATH;
}): LearningPersistenceResult;

export declare function detectLifecycleEnvironment(input: { projectRoot: string }): Readonly<Omit<LifecycleEnvironment, 'status' | 'stateAvailable' | 'firstRun' | 'notice' | 'issue'>>;

export declare function prepareLifecycleEnvironment(input: { projectRoot: string }): Readonly<LifecycleEnvironment>;

export declare function firstRunGuidance(input: {
  environment: LifecycleEnvironment;
  settings: LifecycleSettings;
}): Readonly<{ status: 'completed'; firstRun: boolean; messages: readonly string[] }>;

export declare function normalizeLifecycleConfiguration(configured?: Partial<LifecycleSettings>): Readonly<LifecycleSettings>;

export declare function loadLifecycleConfiguration(input: { projectRoot: string }): Readonly<LifecycleConfigurationResult>;

export declare function saveLifecycleConfiguration(input: {
  projectRoot: string;
  settings: Partial<LifecycleSettings>;
}): Readonly<{
  status: 'completed' | 'partial';
  path: typeof LIFECYCLE_CONFIGURATION_PATH | null;
  settings: Readonly<LifecycleSettings>;
  notice: string;
}>;

export declare function assessLifecycleCompatibility(input?: {
  runtimeVersion?: string;
  protocolVersion?: string;
  state?: Readonly<Record<string, unknown>> | null;
}): Readonly<LifecycleCompatibilityResult>;

export declare function persistSessionProgress(input: {
  projectRoot: string;
  session: SkillSessionDocument;
  context: unknown;
  safeState?: unknown;
  now?: string | (() => string);
  ttlMs?: number;
}): Readonly<{
  status: 'completed' | 'partial';
  path: string | null;
  expiresAt: string | null;
  notice: string;
}>;

export declare function loadLatestSessionProgress(input: {
  projectRoot: string;
  skillId: string;
  now?: string | (() => string);
}): Readonly<{
  status: 'completed' | 'unavailable';
  record: SkillProgressRecord | null;
  unreadable: number;
  notice: string;
}>;

export declare function cleanupLifecycleProgress(input: {
  projectRoot: string;
  now?: string | (() => string);
}): Readonly<{
  status: 'completed' | 'partial';
  removed: readonly string[];
  retained: number;
  unreadable: number;
  notice: string;
}>;

export declare function closeSessionProgress(input: {
  projectRoot: string;
  sessionId: string;
}): Readonly<{ status: 'completed'; removed: boolean; notice: string }>;

export declare function startSkillLifecycle(input: {
  projectRoot: string;
  skillId: string;
  projectIdentity?: `sha256:${string}`;
  context?: unknown;
  questions?: readonly GuidedQuestion[];
  configured?: Partial<LifecycleSettings>;
  consents?: readonly Readonly<Record<string, unknown>>[];
  headless?: boolean;
  now?: string | (() => string);
  createSessionId?: () => string;
}): Readonly<{
  status: 'completed';
  environment: LifecycleEnvironment;
  firstRun: Readonly<{ status: 'completed'; firstRun: boolean; messages: readonly string[] }>;
  compatibility: LifecycleCompatibilityResult;
  configuration: LifecycleConfigurationResult;
  settings: LifecycleSettingsResolution;
  progress: Readonly<{ status: string; recovered: boolean; notice: string }>;
  recovery: SkillSessionRecoveryResult;
  cleanup: Readonly<Record<string, unknown>>;
}>;

export declare function startSkillInteraction(input: {
  projectRoot: string;
  skillId: string;
  context?: unknown;
  questions?: readonly GuidedQuestion[];
  configured?: Partial<LifecycleSettings>;
  consents?: readonly SkillConsentRecord[];
  headless?: boolean;
  now?: string | (() => string);
  createSessionId?: () => string;
  hostProfile: HostProfile;
  runtimeCapabilities?: RuntimeCapabilityReport;
  repositoryContext?: RepositoryContext;
  questionnaire?: QuestionnaireBindingInput;
  headlessQuestionPolicy?: Readonly<Record<string, HeadlessQuestionPolicy>>;
}): Readonly<{
  status: InteractionResolution['status'];
  lifecycle: ReturnType<typeof startSkillLifecycle>;
  interaction: InteractionResolution;
}>;

export declare function executeAtEffectBoundary(input: {
  operationClass: OperationClass;
  localExecutor?: (request: Readonly<{ operationClass: OperationClass; effect: string }>) => unknown | Promise<unknown>;
  hostExecutor?: (request: Readonly<{ operationClass: OperationClass; effect: string }>) => unknown | Promise<unknown>;
}): Promise<CompletionResult>;
