export { ARTIFACT_ERROR_CODES, PipelineError } from './errors.mjs';
export {
  completePlan,
  detectPipelineMode,
  finalizeShip,
  nextShipBatch,
  preparePlan,
  prepareShip,
  recordTaskResult,
  runSyncAudit,
  validateProtocolArtifact,
} from './engine.mjs';
export { appendProvenanceEvent, createProvenanceEvent } from './provenance.mjs';
export {
  detectInstalledRuntimes,
  listRuntimeAdapters,
  normalizeRuntime,
  resolveRuntimeAdapter,
  runtimeHandoff,
  validateRuntimeLock,
} from './runtime.mjs';
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
