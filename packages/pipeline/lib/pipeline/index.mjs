export { ARTIFACT_ERROR_CODES, PipelineError } from './errors.mjs';
export {
  advanceShip,
  advanceInvestigation,
  advancePlanReview,
  completePlan,
  detectPipelineMode,
  finalizeShip,
  finalizeShipClosure,
  finalizeInvestigation,
  getShipClosure,
  inspectShipClosureForLanding,
  GUIDED_INTERACTION_CONTRACTS,
  nextShipBatch,
  normalizeGuidedInteractionArtifact,
  preparePlan,
  preparePlanReview,
  prepareBrowserQa,
  prepareShip,
  reopenShip,
  recordTaskResult,
  recordBrowserQa,
  runShipGates,
  runSyncAudit,
  startShip,
  startInvestigation,
  startPlanReview,
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
export { assertProfessionalSpecification, capturePlanningIdentity } from './planning-review-identity.mjs';
export { assertPlanningReview, planningReviewerRoster, reducePlanningReview, validatePlanningReviewEvent } from './planning-review-reducer.mjs';
export {
  BROWSER_SURFACES,
  SHIP_SPECIALIST_IDS,
  assertShipRiskClassification,
  assertSpecialistReviewResult,
  classifyShipRisk,
  shipReviewSpecialistRegistry,
} from './ship-risk.mjs';
export {
  assertBrowserQaGateRecord,
  assertBrowserQaResult,
  assertBrowserQaSession,
  issueBrowserQaGateRecord,
} from './browser-qa.mjs';
export {
  PROFESSIONAL_SKILLS_CATALOG_PATH,
  PROFESSIONAL_SKILLS_MANIFEST_PATH,
  PROFESSIONAL_SKILL_IDS,
  assertProfessionalSkillsCatalog,
  buildProfessionalSkillsManifest,
  professionalSkillCliRequirements,
  professionalSkillDigest,
  readProfessionalSkillsCatalog,
  renderProfessionalSkillAssets,
  renderProfessionalSkillsBundle,
} from './professional-skills.mjs';
export {
  assertCurrentShipClosureForLanding,
  assertShipClosure,
  reduceShipClosure,
} from './ship-closure.mjs';
export {
  INVESTIGATION_EFFECTS,
  INVESTIGATION_MODES,
  INVESTIGATION_PROTOCOL_VERSION,
  INVESTIGATION_SCHEMA_VERSION,
  assertInvestigationApproval,
  assertInvestigationAuthority,
  assertInvestigationCommand,
  assertInvestigationExecutionEvidence,
  assertInvestigationPortable,
  assertInvestigationReceipt,
  assertInvestigationRequest,
  assertInvestigationScope,
  investigationArtifactId,
  investigationEventIdentity,
} from './investigation-contracts.mjs';
export { captureInvestigationBaseline, diffInvestigationBaselines, scopeContains } from './investigation-identity.mjs';
export { assertInvestigationRecord, createInvestigationRecord, finalizeInvestigationRecord, reduceInvestigationRecord } from './investigation-reducer.mjs';
export { readInvestigationReceipt } from './investigation-runtime.mjs';
export {
  buildShipClosureManifestRow,
  buildShipClosureMarker,
  buildShipClosureProvenanceEvent,
  buildShipClosureRunEvidence,
  renderShipClosureMarker,
  renderShipClosureQaReport,
  verifyShipCompatibilityProjection,
} from './ship-closure-projections.mjs';
export { appendProvenanceEvent, createProvenanceEvent } from './provenance.mjs';
export { loadSpecOperatingOrigin, projectPipelineOperatingOriginCorrelation, projectSpecOperatingOrigin } from './operate-origin.mjs';
export {
  PROTOCOL_SCHEMA_REGISTRY,
  assertProtocolArtifact,
  listProtocolSchemas,
  resolveProtocolSchema,
  validateProtocolArtifact,
} from '../protocol/contracts.mjs';
export { canonicalizeJson, sha256Jcs } from '../protocol/jcs.mjs';
export * from '../protocol/live-evidence-v2.mjs';
export * from './context-envelope.mjs';
export * from './ship-context.mjs';
export * from './landing-contract.mjs';
export {
  LANDING_OPERATION_REGISTRY_PATH,
  LANDING_WORKFLOW_ASSET_PATHS,
  LANDING_WORKFLOW_CATALOG_PATH,
  LANDING_WORKFLOW_ID,
  LANDING_WORKFLOW_MANIFEST_PATH,
  advanceLanding,
  assertLandingWorkflowCatalog,
  assertLandingWorkflowManifest,
  bindLandingPlan,
  createLandingOwnerRuntimeHost,
  landingStatus,
  prepareLanding,
  previewLandingDocket,
  readLandingOperationRegistry,
  readLandingWorkflowCatalog,
  readLandingWorkflowManifest,
  showLanding,
} from './landing.mjs';
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
  detectInstalledRuntimes,
  listRuntimeAdapters,
  normalizeRuntime,
  resolveRuntimeAdapter,
  runtimeHandoff,
  validateRuntimeLock,
} from './runtime.mjs';
export {
  GUIDED_INTERACTION_MODES,
  assertGuidedCliResult,
  createGuidedAnswerSubmission,
  createGuidedAnswerEnvelope,
  createGuidedAnswerEnvelopeFromQuestionnaire,
  encodeGuidedAnswerStdin,
  guidedAnswerPreviewDigest,
  reduceGuidedAnswerEnvelope,
  resolveGuidedInteraction,
  selectGuidedAction,
} from './guided-interaction.mjs';
export { createDashboardServer as startDashboard } from '../dashboard/server.mjs';
export {
  bundleArtifact,
  createArtifactEnvelope,
  createReviewLink,
  createReviewLinkPreview,
  decodeArtifactFragment,
  decodeReviewLink,
  decryptArtifactPayload,
  encodeArtifactFragment,
  encryptArtifactPayload,
  importArtifactReview,
  mergeArtifactFeedback,
} from '../artifact/index.mjs';
export {
  commitLiveReviewRoom,
  createLiveReviewRoom,
  appendLiveRoomEvent,
  createLiveRoomClient,
  createLiveRoomEvent,
  createLiveRoomEventFromReviewChange,
  decryptLiveRoomEvent,
  encryptLiveRoomEvent,
  hydrateLiveReviewRoom,
  importLiveRoomRecoveryBundle,
  reduceLiveRoomEvents,
  reduceResilientSignedLiveRoomEvents,
  reduceSignedLiveRoomEvents,
  createLiveRoomDescriptor,
  createLiveRoomSigner,
  createSignedLiveRoomEvent,
  exportLiveRoomSignerSecret,
  exportLiveRoomRecoveryBundle,
  importLiveRoomSignerSecret,
  prepareLiveReviewRoom,
  recoverLiveReviewRoom,
  verifyLiveRoomEventChain,
  verifySignedLiveRoomEvent,
} from '../artifact/index.mjs';
export { exportArtifactReviewSession, startArtifactReview } from '../artifact/review-server.mjs';

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
