export type { HostOverlayPolicy, HostOverlayResolution } from './compiler/index.mjs';
export {
  assertAuthorityNarrows,
  assertHostOverlayIsPresentational,
  assertPortableAsset,
  assertSafeSourcePath,
  byteLength,
  canonicalText,
  compileComposedV1,
  compileMarkdownV1,
  composeIncludes,
  HOST_OVERLAY_POLICY,
  isSkillAssetPath,
  owner,
  parseMarkdownAsset,
  renderCodexSkill,
  renderCursorSkill,
  renderHostTokens,
  renderRoleAsset,
  renderSkillForHost,
  renderTemplate,
  resolveModuleGraph,
  SourceMapBuilder,
  sha256,
  sha256Bytes,
  skillPrimaryPath,
  skillSupportPath,
  validateSourceMap,
} from './compiler/index.mjs';

export declare function discoverVerificationChecks(options?: {
  projectRoot?: string;
  taskPath?: string;
}): Readonly<{
  kind: 'verification-discovery';
  schemaVersion: '1.0.0';
  projectRoot: string;
  taskPath: string | null;
  checks: Array<{ command: string; source: string }>;
  diagnostics: string[];
}>;

export {
  AUTHORING_COMMANDS,
  AUTHORING_EXIT,
  AUTHORING_RESULT_KIND,
  AUTHORING_RESULT_VERSION,
  authoringUsage,
  checkSkill,
  describeAuthoringGraph,
  evaluateSkill,
  formatDiagnostic,
  formatDiagnostics,
  generateSkill,
  getAuthoringCommand,
  lintSkill,
  loadComposedSkill,
  parseAuthoringArgs,
  previewSkill,
  SkillAuthoringError,
  toDiagnostic,
} from './authoring/index.mjs';
export type {
  CheckStatus,
  CompletedCompletionDetails,
  CompletedCompletionInput,
  CompletedCompletionResult,
  CompletionCheck,
  CompletionInput,
  CompletionIssue,
  CompletionResult,
  CompletionStatus,
  ConsentDecision,
  ConsentResolutionDecision,
  DataFeature,
  DataFeatureConsentResolution,
  GuidedConfirmation,
  LearningCategory,
  LearningPersistenceResult,
  LifecycleCompatibilityResult,
  LifecycleConfigurationResult,
  LifecycleDiagnostic,
  LifecycleEnvironment,
  LifecycleSettings,
  LifecycleSettingsResolution,
  NonCompletedCompletionDetails,
  NonCompletedCompletionInput,
  NonCompletedCompletionResult,
  OperationClass,
  PassedCompletionCheck,
  PreparedLearningCompletedResult,
  PreparedLearningResult,
  PreparedLearningUnavailableResult,
  SkillConsentRecord,
  SkillLearningRecord,
  SkillProgressRecord,
  SkillSessionCheckpoint,
  SkillSessionCheckpointResult,
  SkillSessionDocument,
  SkillSessionRecoveryResult,
} from './lifecycle/index.mjs';
export {
  assessLifecycleCompatibility,
  COMPLETION_STATUSES,
  checkpointSession,
  classifyOperation,
  cleanupLifecycleProgress,
  closeSessionProgress,
  completionFromRuntimeResult,
  createCompletion,
  createConsentRecord,
  createSkillSession,
  DATA_FEATURES,
  DEFAULT_LIFECYCLE_SETTINGS,
  DEFAULT_PROGRESS_TTL_MS,
  detectLifecycleEnvironment,
  executeAtEffectBoundary,
  firstRunGuidance,
  LIFECYCLE_CONFIGURATION_PATH,
  LIFECYCLE_IGNORE_RULE,
  LIFECYCLE_PROTOCOL_VERSION,
  LIFECYCLE_RUNTIME_DIRECTORY,
  LIFECYCLE_RUNTIME_VERSION,
  LIFECYCLE_SESSION_DIRECTORY,
  LIFECYCLE_STATE_VERSION,
  LOCAL_LEARNING_PATH,
  loadLatestSessionProgress,
  loadLifecycleConfiguration,
  normalizeLifecycleConfiguration,
  OPERATION_CLASSES,
  persistLearningRecord,
  persistSessionProgress,
  prepareLearningRecord,
  prepareLifecycleEnvironment,
  recoverSession,
  resolveDataFeatureConsent,
  resolveLifecycleSettings,
  saveLifecycleConfiguration,
  startSkillInteraction,
  startSkillLifecycle,
  updateSkillSession,
} from './lifecycle/index.mjs';
export type {
  SkillContentAsset,
  SkillContentLink,
  SkillContentLinkResult,
} from './linker/index.mjs';
export {
  linkSkillProjection,
  linkSkillProjections,
  parseSkillContentLinks,
} from './linker/index.mjs';
export {
  buildAssetCustody,
  buildCustodyManifest,
  buildGeneratedAssetManifest,
  deriveAssetSetId,
} from './manifests/index.mjs';
export type { SkillMatchCandidate, SkillMatchResult } from './matching/index.mjs';
export {
  buildRegistryRoutingCases,
  buildSkillMatchIndex,
  evaluateResilienceJourneys,
  evaluateRoutingCorpus,
  matchSkillRequest,
  ROUTING_CASE_KINDS,
  runResilienceJourney,
  tokenizeRoutingText,
} from './matching/index.mjs';
export {
  buildSkillReleaseTree,
  createDeterministicZip,
  readDeterministicZip,
  renderOpenAiSkillMetadata,
} from './packaging/index.mjs';
export type {
  AnswerBindingResult,
  CapabilityResolution,
  CapabilityState,
  GuidedQuestion,
  HeadlessQuestionPolicy,
  HostInteractionBinding,
  HostProfile,
  InteractionResolution,
  InteractionSessionInput,
  InteractionSurface,
  LegacyInteractionSessionMetadata,
  ProtocolSkillSessionInput,
  QuestionnaireBindingInput,
  RepositoryContext,
  ResolutionStatus,
  ResolvedInteractionSession,
  RuntimeCapabilityReport,
} from './resolver/index.mjs';
export {
  bindInteractionAnswers,
  CAPABILITY_STATES,
  INTERACTION_SURFACES,
  RESOLUTION_STATUSES,
  resolveCapabilities,
  resolveInteraction,
} from './resolver/index.mjs';
export type { SkillChangeKind, VersionBump, VersionDimension } from './versioning/index.mjs';
export {
  analyzeSkillGraphImpact,
  assessLearningPromotion,
  assessVersionChange,
  assessVersionSet,
  CHANGE_KINDS,
  classifyVersionBump,
  createLearningProposal,
  planSkillGraphRollback,
  requiredVersionBump,
  VERSION_DIMENSIONS,
} from './versioning/index.mjs';

export declare class SkillRuntimeError extends Error {
  code: string;
  details: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>);
}

export declare const EXPECTED_SKILL_IDS: readonly string[];
export declare const EXPECTED_ROLE_IDS: readonly string[];

export declare function assertSafeRelativePath(path: string, label?: string): string;
export declare function resolveRegularFile(repoRoot: string, path: string, label?: string): string;
export declare function listRegularFiles(root: string, options?: { relativeTo?: string }): string[];
export declare function readContributionGraph(options: {
  repoRoot: string;
}): Record<string, unknown>;
export declare function readSkillSourceRegistry(options: {
  repoRoot: string;
}): Record<string, unknown>;
export declare function validateContributionGraph(
  manifests: unknown,
  options?: Record<string, unknown>,
): unknown;
export declare function validateRoleContributions(
  manifest: unknown,
  options?: Record<string, unknown>,
): unknown;

export declare const OPERATE_ADVISOR_REVIEW_RUBRICS: Readonly<Record<string, unknown>>;
export declare const OPERATE_REVIEW_CONTRACT: Readonly<Record<string, unknown>>;
export declare const OPERATE_REVIEW_CONTRACT_V1: Readonly<Record<string, unknown>>;
export declare const OPERATE_REVIEW_CONTRACT_V2: Readonly<Record<string, unknown>>;
export declare const OPERATE_REVIEW_CONTRACT_VERSION: string;
export declare const OPERATE_REVIEW_CONTRACT_VERSIONS: readonly string[];
export declare const OPERATE_REVIEW_CONTRACTS: Readonly<Record<string, unknown>>;
export declare const OPERATE_REVIEW_NOTE_PROFILES: Readonly<Record<string, unknown>>;
export declare const OPERATE_REVIEW_NOTE_PROFILES_V1: Readonly<Record<string, unknown>>;
export declare const OPERATE_REVIEW_NOTE_PROFILES_V2: Readonly<Record<string, unknown>>;

export declare function detectOperateReviewNoteContract(
  markdown: string,
  options?: Record<string, unknown>,
): unknown;
export declare function inspectOperateReviewNote(
  markdown: string,
  options?: Record<string, unknown>,
): unknown;
export declare function validateOperateReviewNote(
  markdown: string,
  options?: Record<string, unknown>,
): unknown;
