export {
  SourceMapBuilder,
  HOST_OVERLAY_POLICY,
  assertAuthorityNarrows,
  assertHostOverlayIsPresentational,
  assertPortableAsset,
  assertSafeSourcePath,
  byteLength,
  canonicalText,
  compileComposedV1,
  compileMarkdownV1,
  composeIncludes,
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
  sha256,
  sha256Bytes,
  skillPrimaryPath,
  skillSupportPath,
  validateSourceMap,
} from './compiler/index.mjs';

export type { HostOverlayPolicy, HostOverlayResolution } from './compiler/index.mjs';

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
  buildSkillMatchIndex,
  buildRegistryRoutingCases,
  evaluateResilienceJourneys,
  evaluateRoutingCorpus,
  matchSkillRequest,
  runResilienceJourney,
  tokenizeRoutingText,
  ROUTING_CASE_KINDS,
} from './matching/index.mjs';

export type { SkillMatchCandidate, SkillMatchResult } from './matching/index.mjs';

export {
  buildAssetCustody,
  buildCustodyManifest,
  buildGeneratedAssetManifest,
  deriveAssetSetId,
} from './manifests/index.mjs';

export {
  CAPABILITY_STATES,
  INTERACTION_SURFACES,
  RESOLUTION_STATUSES,
  bindInteractionAnswers,
  resolveCapabilities,
  resolveInteraction,
} from './resolver/index.mjs';

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
  ResolvedInteractionSession,
  ResolutionStatus,
  RuntimeCapabilityReport,
} from './resolver/index.mjs';

export {
  CHANGE_KINDS,
  VERSION_DIMENSIONS,
  analyzeSkillGraphImpact,
  assessLearningPromotion,
  assessVersionChange,
  assessVersionSet,
  classifyVersionBump,
  createLearningProposal,
  planSkillGraphRollback,
  requiredVersionBump,
} from './versioning/index.mjs';

export type { SkillChangeKind, VersionBump, VersionDimension } from './versioning/index.mjs';

export {
  COMPLETION_STATUSES,
  DEFAULT_PROGRESS_TTL_MS,
  DATA_FEATURES,
  DEFAULT_LIFECYCLE_SETTINGS,
  LIFECYCLE_CONFIGURATION_PATH,
  LIFECYCLE_IGNORE_RULE,
  LIFECYCLE_PROTOCOL_VERSION,
  LIFECYCLE_RUNTIME_DIRECTORY,
  LIFECYCLE_RUNTIME_VERSION,
  LIFECYCLE_SESSION_DIRECTORY,
  LIFECYCLE_STATE_VERSION,
  LOCAL_LEARNING_PATH,
  OPERATION_CLASSES,
  assessLifecycleCompatibility,
  checkpointSession,
  classifyOperation,
  cleanupLifecycleProgress,
  closeSessionProgress,
  completionFromRuntimeResult,
  createCompletion,
  createConsentRecord,
  createSkillSession,
  detectLifecycleEnvironment,
  executeAtEffectBoundary,
  firstRunGuidance,
  loadLatestSessionProgress,
  loadLifecycleConfiguration,
  normalizeLifecycleConfiguration,
  persistLearningRecord,
  persistSessionProgress,
  prepareLifecycleEnvironment,
  prepareLearningRecord,
  recoverSession,
  resolveDataFeatureConsent,
  resolveLifecycleSettings,
  saveLifecycleConfiguration,
  startSkillInteraction,
  startSkillLifecycle,
  updateSkillSession,
} from './lifecycle/index.mjs';

export {
  linkSkillProjection,
  linkSkillProjections,
  parseSkillContentLinks,
} from './linker/index.mjs';

export {
  buildSkillReleaseTree,
  createDeterministicZip,
  readDeterministicZip,
  renderOpenAiSkillMetadata,
} from './packaging/index.mjs';

export type {
  SkillContentAsset,
  SkillContentLink,
  SkillContentLinkResult,
} from './linker/index.mjs';

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
  OperationClass,
  NonCompletedCompletionDetails,
  NonCompletedCompletionInput,
  NonCompletedCompletionResult,
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
  AUTHORING_COMMANDS,
  AUTHORING_EXIT,
  AUTHORING_RESULT_KIND,
  AUTHORING_RESULT_VERSION,
  SkillAuthoringError,
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
  toDiagnostic,
} from './authoring/index.mjs';

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
