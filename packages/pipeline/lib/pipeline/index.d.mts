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
  repositories: Array<{ repositoryKey: string; root: string | null; head: string; baselineDigest: `sha256:${string}` }>;
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
  code: string;
  fix: string;
  details?: unknown;
  toJSON(): { ok: false; code: string; problem: string; fix?: string; details?: unknown };
}

export function assertShipClosure(value: unknown): ShipClosureRecord;
export function reduceShipClosure(value: ShipClosureRecord, event: unknown, runtime?: unknown): ShipClosureRecord;
export function buildShipClosureManifestRow(receipt: ShipClosureRecord, projectRoot: string, featureRoot: string): unknown;
export function buildShipClosureMarker(receipt: ShipClosureRecord, options: {
  manifestBytes: string | Uint8Array;
  rowIndex: number;
  aggregate?: {
    status: 'passed' | 'blocked';
    allDone: boolean;
    receiptCount: number;
    tasksExecuted: number;
    tasksFailed: number;
  };
}): unknown;
export function buildShipClosureRunEvidence(receipt: ShipClosureRecord, marker: unknown, markerBytes: string | Uint8Array): unknown;
export function buildShipClosureProvenanceEvent(receipt: ShipClosureRecord, options: Record<string, unknown>): unknown;
export function renderShipClosureMarker(marker: unknown): string;
export function renderShipClosureQaReport(receipt: ShipClosureRecord, options?: Record<string, unknown>): string;
export function verifyShipCompatibilityProjection(receipt: ShipClosureRecord, options: Record<string, unknown>): boolean;
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
export function inspectShipClosureForLanding(options?: Record<string, unknown>): import('./landing.mjs').ShipClosureLandingInspection;
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
export * from './ship-risk.d.mts';
export * from './browser-qa.d.mts';
export * from './professional-skills.d.mts';
export * from './investigation-contracts.d.mts';
export * from './investigation-identity.d.mts';
export * from './investigation-reducer.d.mts';
export * from './investigation-runtime.d.mts';
export * from '../protocol/live-evidence-v2.d.mts';
export * from './landing-contract.d.mts';
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
  type LandingConfirmation,
  type LandingEvent,
  type LandingHash,
  type LandingOperationId,
  type LandingOwnerRuntimeCallbacks,
  type LandingOwnerRuntimeHost,
  type LandingPlan,
  type LandingRunId,
  type LandingState,
  type ShipClosureLandingInspection,
} from './landing.d.mts';
export function completePlan(options?: Record<string, unknown>): unknown;
export function nextShipBatch(tasks: unknown[]): unknown;
export function runSyncAudit(options?: Record<string, unknown>): unknown;
export function startDashboard(options?: Record<string, unknown>): any;
export function runDesignCommand(args?: string[]): Promise<any>;
export function resolveRuntimeAdapter(options?: Record<string, unknown>): any;
export function runtimeHandoff(...args: any[]): any;
export function detectInstalledRuntimes(...args: any[]): any;
export function listRuntimeAdapters(...args: any[]): any;
export function normalizeRuntime(...args: any[]): any;
export function validateRuntimeLock(...args: any[]): any;
export function appendProvenanceEvent(...args: any[]): any;
export function createProvenanceEvent(...args: any[]): any;
export function canonicalizeJson(...args: any[]): any;
export function sha256Jcs(...args: any[]): `sha256:${string}`;
export const PROTOCOL_SCHEMA_REGISTRY: Readonly<Record<string, Readonly<Record<string, string>>>>;
export function assertProtocolArtifact(...args: any[]): any;
export function listProtocolSchemas(...args: any[]): any;
export function resolveProtocolSchema(...args: any[]): any;
export function validateProtocolArtifact(...args: any[]): any;
export const GUIDED_INTERACTION_CONTRACTS: Readonly<Record<string, unknown>>;
export function normalizeGuidedInteractionArtifact(...args: any[]): any;
export function validateEvidenceDiagnostic(...args: any[]): any;
export function validateGuidedAnswerEnvelope(...args: any[]): any;
export function validateGuidedConfirmation(...args: any[]): any;
export function validateGuidedInteractionArtifact(...args: any[]): any;
export function validateGuidedQuestion(...args: any[]): any;
export function validateGuidedQuestionnaire(...args: any[]): any;
export function validateGuidedSession(...args: any[]): any;
export function validateStructuredAction(...args: any[]): any;
export const GUIDED_INTERACTION_MODES: readonly string[];
export function assertGuidedCliResult(...args: any[]): any;
export function createGuidedAnswerSubmission(...args: any[]): any;
export function createGuidedAnswerEnvelope(...args: any[]): any;
export function createGuidedAnswerEnvelopeFromQuestionnaire(...args: any[]): any;
export function encodeGuidedAnswerStdin(...args: any[]): any;
export function guidedAnswerPreviewDigest(...args: any[]): any;
export function reduceGuidedAnswerEnvelope(...args: any[]): any;
export function resolveGuidedInteraction(...args: any[]): any;
export function selectGuidedAction(...args: any[]): any;
export function loadSpecOperatingOrigin(...args: any[]): any;
export function projectPipelineOperatingOriginCorrelation(...args: any[]): any;
export function projectSpecOperatingOrigin(...args: any[]): any;
export function computeEcosystemReleaseOperationDigest(...args: any[]): any;
export function createEcosystemReleaseOperation(...args: any[]): any;
export function createEcosystemSaga(...args: any[]): any;
export function nextEcosystemSagaSteps(...args: any[]): any;
export function reconcileEcosystemReleaseOperation(...args: any[]): any;
export function reconcileEcosystemSaga(...args: any[]): any;
export function recordEcosystemSagaStep(...args: any[]): any;
export const ARTIFACT_ERROR_CODES: Readonly<Record<string, string>>;
export function bundleArtifact(...args: any[]): any;
export function createArtifactEnvelope(...args: any[]): any;
export function createReviewLink(...args: any[]): any;
export function createReviewLinkPreview(...args: any[]): any;
export function decodeArtifactFragment(...args: any[]): any;
export function decodeReviewLink(...args: any[]): any;
export function decryptArtifactPayload(...args: any[]): any;
export function encodeArtifactFragment(...args: any[]): any;
export function encryptArtifactPayload(...args: any[]): any;
export function importArtifactReview(...args: any[]): any;
export function mergeArtifactFeedback(...args: any[]): any;
export function createLiveReviewRoom(...args: any[]): any;
export function prepareLiveReviewRoom(...args: any[]): any;
export function commitLiveReviewRoom(...args: any[]): any;
export function exportLiveRoomRecoveryBundle(...args: any[]): any;
export function importLiveRoomRecoveryBundle(...args: any[]): any;
export function recoverLiveReviewRoom(...args: any[]): any;
export function appendLiveRoomEvent(...args: any[]): any;
export function createLiveRoomClient(...args: any[]): any;
export function createLiveRoomEvent(...args: any[]): any;
export function createLiveRoomEventFromReviewChange(...args: any[]): any;
export function decryptLiveRoomEvent(...args: any[]): any;
export function encryptLiveRoomEvent(...args: any[]): any;
export function hydrateLiveReviewRoom(...args: any[]): any;
export function reduceLiveRoomEvents(...args: any[]): any;
export function reduceResilientSignedLiveRoomEvents(...args: any[]): any;
export function reduceSignedLiveRoomEvents(...args: any[]): any;
export function createLiveRoomDescriptor(...args: any[]): any;
export function createLiveRoomSigner(...args: any[]): any;
export function createSignedLiveRoomEvent(...args: any[]): any;
export function exportLiveRoomSignerSecret(...args: any[]): any;
export function importLiveRoomSignerSecret(...args: any[]): any;
export function verifyLiveRoomEventChain(...args: any[]): any;
export function verifySignedLiveRoomEvent(...args: any[]): any;
export function exportArtifactReviewSession(...args: any[]): any;
export function startArtifactReview(...args: any[]): any;
