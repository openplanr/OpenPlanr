export {
  appendLiveRoomEvent,
  bundleArtifact,
  commitLiveReviewRoom,
  createArtifactEnvelope,
  createLiveReviewRoom,
  createLiveRoomClient,
  createLiveRoomDescriptor,
  createLiveRoomEvent,
  createLiveRoomEventFromReviewChange,
  createLiveRoomSigner,
  createReviewLink,
  createReviewLinkPreview,
  createSignedLiveRoomEvent,
  decodeArtifactFragment,
  decodeReviewLink,
  decryptArtifactPayload,
  decryptLiveRoomEvent,
  encodeArtifactFragment,
  encryptArtifactPayload,
  encryptLiveRoomEvent,
  exportLiveRoomRecoveryBundle,
  exportLiveRoomSignerSecret,
  hydrateLiveReviewRoom,
  importArtifactReview,
  importLiveRoomRecoveryBundle,
  importLiveRoomSignerSecret,
  mergeArtifactFeedback,
  prepareLiveReviewRoom,
  recoverLiveReviewRoom,
  reduceLiveRoomEvents,
  reduceResilientSignedLiveRoomEvents,
  reduceSignedLiveRoomEvents,
  verifyLiveRoomEventChain,
  verifySignedLiveRoomEvent,
} from '../artifact/index.mjs';
export { exportArtifactReviewSession, startArtifactReview } from '../artifact/review-server.mjs';
/** @deprecated Import `startDashboard` from `planr-pipeline/dashboard`; this root alias loads the dashboard server eagerly. */
export { startDashboard } from '../dashboard/index.mjs';
export {
  assertProtocolArtifact,
  listProtocolSchemas,
  PROTOCOL_SCHEMA_REGISTRY,
  resolveProtocolSchema,
  validateProtocolArtifact,
} from '../protocol/contracts.mjs';
export { canonicalizeJson, sha256Jcs } from '../protocol/jcs.mjs';
export * from '../protocol/live-evidence-v2.mjs';
export {
  assertBrowserQaGateRecord,
  assertBrowserQaResult,
  assertBrowserQaSession,
  issueBrowserQaGateRecord,
} from './browser-qa.mjs';
export * from './context-envelope.mjs';
export {
  computeEcosystemReleaseOperationDigest,
  createEcosystemReleaseOperation,
  createEcosystemSaga,
  nextEcosystemSagaSteps,
  reconcileEcosystemReleaseOperation,
  reconcileEcosystemSaga,
  recordEcosystemSagaStep,
} from './ecosystem-saga.mjs';
export {
  advanceInvestigation,
  advancePlanReview,
  advanceShip,
  completePlan,
  detectPipelineMode,
  finalizeInvestigation,
  finalizeShip,
  finalizeShipClosure,
  GUIDED_INTERACTION_CONTRACTS,
  getShipClosure,
  inspectShipClosureForLanding,
  nextShipBatch,
  normalizeGuidedInteractionArtifact,
  prepareBrowserQa,
  preparePlan,
  preparePlanReview,
  prepareShip,
  recordBrowserQa,
  recordTaskResult,
  reopenShip,
  runShipGates,
  runSyncAudit,
  startInvestigation,
  startPlanReview,
  startShip,
  validateEvidenceDiagnostic,
  validateGuidedAnswerEnvelope,
  validateGuidedConfirmation,
  validateGuidedInteractionArtifact,
  validateGuidedQuestion,
  validateGuidedQuestionnaire,
  validateGuidedSession,
  validateStructuredAction,
  verifyInvestigation,
} from './engine.mjs';
export { ARTIFACT_ERROR_CODES, PipelineError } from './errors.mjs';
export {
  assertGuidedCliResult,
  createGuidedAnswerEnvelope,
  createGuidedAnswerEnvelopeFromQuestionnaire,
  createGuidedAnswerSubmission,
  encodeGuidedAnswerStdin,
  GUIDED_INTERACTION_MODES,
  guidedAnswerPreviewDigest,
  reduceGuidedAnswerEnvelope,
  resolveGuidedInteraction,
  selectGuidedAction,
} from './guided-interaction.mjs';
export {
  assertInvestigationApproval,
  assertInvestigationAuthority,
  assertInvestigationCommand,
  assertInvestigationExecutionEvidence,
  assertInvestigationPortable,
  assertInvestigationReceipt,
  assertInvestigationRequest,
  assertInvestigationScope,
  INVESTIGATION_EFFECTS,
  INVESTIGATION_MODES,
  INVESTIGATION_PROTOCOL_VERSION,
  INVESTIGATION_SCHEMA_VERSION,
  investigationArtifactId,
  investigationEventIdentity,
} from './investigation-contracts.mjs';
export {
  captureInvestigationBaseline,
  diffInvestigationBaselines,
  scopeContains,
} from './investigation-identity.mjs';
export {
  assertInvestigationRecord,
  createInvestigationRecord,
  finalizeInvestigationRecord,
  reduceInvestigationRecord,
} from './investigation-reducer.mjs';
export { readInvestigationReceipt } from './investigation-runtime.mjs';
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
  landingStatus,
  prepareLanding,
  previewLandingDocket,
  readLandingOperationRegistry,
  readLandingWorkflowCatalog,
  readLandingWorkflowManifest,
  showLanding,
} from './landing.mjs';
export * from './landing-contract.mjs';
export {
  loadSpecOperatingOrigin,
  projectPipelineOperatingOriginCorrelation,
  projectSpecOperatingOrigin,
} from './operate-origin.mjs';
export {
  assertProfessionalSpecification,
  capturePlanningIdentity,
} from './planning-review-identity.mjs';
export {
  assertPlanningReview,
  planningReviewerRoster,
  reducePlanningReview,
  validatePlanningReviewEvent,
} from './planning-review-reducer.mjs';
export {
  assertProfessionalSkillsCatalog,
  buildProfessionalSkillsManifest,
  PROFESSIONAL_SKILL_IDS,
  PROFESSIONAL_SKILLS_CATALOG_PATH,
  PROFESSIONAL_SKILLS_MANIFEST_PATH,
  professionalSkillCliRequirements,
  professionalSkillDigest,
  readProfessionalSkillsCatalog,
  renderProfessionalSkillAssets,
  renderProfessionalSkillsBundle,
} from './professional-skills.mjs';
export { appendProvenanceEvent, createProvenanceEvent } from './provenance.mjs';
export {
  detectInstalledRuntimes,
  listRuntimeAdapters,
  normalizeRuntime,
  resolveRuntimeAdapter,
  runtimeHandoff,
  validateRuntimeLock,
} from './runtime.mjs';
export {
  assertCurrentShipClosureForLanding,
  assertShipClosure,
  reduceShipClosure,
} from './ship-closure.mjs';
export {
  buildShipClosureManifestRow,
  buildShipClosureMarker,
  buildShipClosureProvenanceEvent,
  buildShipClosureRunEvidence,
  renderShipClosureMarker,
  renderShipClosureQaReport,
  verifyShipCompatibilityProjection,
} from './ship-closure-projections.mjs';
export * from './ship-context.mjs';
export {
  assertShipRiskClassification,
  assertSpecialistReviewResult,
  BROWSER_SURFACES,
  classifyShipRisk,
  SHIP_SPECIALIST_IDS,
  shipReviewSpecialistRegistry,
} from './ship-risk.mjs';

export async function runDesignCommand(args = []) {
  const { spawnSync } = await import('node:child_process');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  return spawnSync(process.execPath, [join(root, 'lib/design-engine/cli.mjs'), ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
}
