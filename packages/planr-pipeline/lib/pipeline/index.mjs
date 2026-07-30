export { ARTIFACT_ERROR_CODES, PipelineError } from './errors.mjs';
export {
  completePlan,
  detectPipelineMode,
  finalizeShip,
  GUIDED_INTERACTION_CONTRACTS,
  nextShipBatch,
  normalizeGuidedInteractionArtifact,
  preparePlan,
  prepareShip,
  recordTaskResult,
  runSyncAudit,
  validateEvidenceDiagnostic,
  validateGuidedAnswerEnvelope,
  validateGuidedConfirmation,
  validateGuidedInteractionArtifact,
  validateGuidedQuestion,
  validateGuidedQuestionnaire,
  validateGuidedSession,
  validateStructuredAction,
} from './engine.mjs';
export { appendProvenanceEvent, createProvenanceEvent } from './provenance.mjs';
export {
  PROTOCOL_SCHEMA_REGISTRY,
  assertProtocolArtifact,
  listOperatingProviders,
  listOperatingRoles,
  listProtocolSchemas,
  resolveProtocolSchema,
  validateProtocolArtifact,
} from '../protocol/contracts.mjs';
export { canonicalizeJson, sha256Jcs } from '../protocol/jcs.mjs';
export {
  computeOperatingEventHash,
  createOperatingCheckpoint,
  createOperatingCheckpointSigningPayload,
  createOperatingEvent,
  reduceOperatingEvents,
  resumeOperatingProjection,
  validateOperatingCheckpoint,
  verifyOperatingEventChain,
} from '../operate/reducer.mjs';
export {
  computeEcosystemReleaseOperationDigest,
  createEcosystemReleaseOperation,
  createEcosystemSaga,
  nextEcosystemSagaSteps,
  reconcileEcosystemReleaseOperation,
  reconcileEcosystemSaga,
  recordEcosystemSagaStep,
} from '../operate/saga.mjs';
export {
  computeOperatingProviderPolicyDigest,
  operatingProviderPolicyPayload,
  validateOperatingProviderPolicyDigest,
} from '../operate/provider-policy.mjs';
export {
  computeOperatingRoleResultDigest,
  operatingRoleResultIdentityPayload,
  validateOperatingRoleResultDigest,
} from '../operate/role-result.mjs';
export {
  createOperatingAdvisorBrief,
  listOperatingAdvisorBriefs,
} from '../operate/advisor-brief.mjs';
export {
  createOperatingAdapterHandoff,
  validateOperatingAdapterHandoffBindings,
} from '../operate/adapter-handoff.mjs';
export {
  cancelOperatingArtifactGeneration,
  commitOperatingArtifactGeneration,
  failOperatingArtifactGeneration,
  prepareOperatingArtifactGeneration,
  renderOperatingArtifactTemplate,
  resumeOperatingArtifactGeneration,
  runOperatingArtifactGeneration,
  startOperatingArtifactGeneration,
  validateOperatingArtifactOutput,
} from '../operate/generator.mjs';
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
  createLiveReviewRoom,
  appendLiveRoomEvent,
  createLiveRoomClient,
  createLiveRoomEvent,
  decryptLiveRoomEvent,
  encryptLiveRoomEvent,
  hydrateLiveReviewRoom,
  reduceLiveRoomEvents,
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
