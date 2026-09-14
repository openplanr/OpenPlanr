export type LandingHash = `sha256:${string}`;
export type LandingRunId = `lrun_${string}`;
export type LandingOperationId = `lop_${string}`;
export type LandingState =
  | 'planned'
  | 'awaiting-confirmation'
  | 'intent-recorded'
  | 'dispatching'
  | 'verifying'
  | 'recovery_required'
  | 'completed'
  | 'blocked'
  | 'uncertain';

export interface ShipClosureLandingInspection {
  readonly ok: true;
  readonly kind: 'ship-closure-landing-inspection';
  readonly schemaVersion: '1.0.0';
  readonly feature: string;
  readonly mode: string;
  readonly runId: `ship_${string}`;
  readonly receiptHash: LandingHash;
  readonly recordDigest: LandingHash;
  readonly projectionVerified: true;
  readonly activeSuccessor: false;
  readonly activeRunIds: readonly [];
  readonly terminalSuccessorRunIds: readonly [];
  readonly candidateDigest: LandingHash;
  readonly candidateInventoryDigest: LandingHash;
  readonly repositoryKeys: readonly string[];
  readonly taskIds: readonly string[];
  readonly receipt: Readonly<Record<string, unknown>> & {
    readonly kind: 'ship-closure';
    readonly runId: `ship_${string}`;
    readonly receiptHash: LandingHash;
  };
}

export interface LandingPlan {
  readonly kind: 'landing-plan';
  readonly schemaVersion: '1.0.0';
  readonly protocolVersion: '1.2.0';
  readonly planId: `land_${string}`;
  readonly authority: 'none';
  readonly shipClosure: Readonly<Record<string, unknown>>;
  readonly feature: string;
  readonly candidateDigest: LandingHash;
  readonly candidateInventoryDigest: LandingHash;
  readonly repositories: readonly Readonly<Record<string, unknown>>[];
  readonly currentTargetHash: LandingHash;
  readonly operations: readonly Readonly<Record<string, unknown>>[];
  readonly preconditions: readonly Readonly<Record<string, unknown>>[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly planHash: LandingHash;
}

export interface LandingConfirmation {
  readonly kind: 'landing-confirmation';
  readonly schemaVersion: '1.0.0';
  readonly protocolVersion: '1.2.0';
  readonly confirmationId: `lcnf_${string}`;
  readonly authority: 'none';
  readonly ownerActorId: string;
  readonly planId: `land_${string}`;
  readonly planHash: LandingHash;
  readonly shipReceiptHash: LandingHash;
  readonly phaseId: string;
  readonly operationIds: readonly [LandingOperationId];
  readonly effectSet: readonly string[];
  readonly currentTargetHash: LandingHash;
  readonly docket: Readonly<Record<string, unknown>>;
  readonly docketHash: LandingHash;
  readonly choice: 'confirm';
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly opaqueCapabilityHash: LandingHash;
  readonly confirmationHash: LandingHash;
}

export interface LandingEvent {
  readonly kind: 'landing-event';
  readonly schemaVersion: '1.0.0';
  readonly protocolVersion: '1.2.0';
  readonly eventId: `levt_${string}`;
  readonly sequence: number;
  readonly runId: LandingRunId;
  readonly type: string;
  readonly fromState: LandingState;
  readonly toState: LandingState;
  readonly actor: Readonly<{ kind: 'human' | 'engine' | 'runtime'; id: string }>;
  readonly planHash: LandingHash;
  readonly requestHash: LandingHash;
  readonly operationId: LandingOperationId | null;
  readonly confirmationHash: LandingHash | null;
  readonly targetStateHash: LandingHash;
  readonly trafficStateHash: LandingHash | null;
  readonly residualStateHash: LandingHash | null;
  readonly previousEventHash: LandingHash | null;
  readonly timestamp: string;
  readonly eventHash: LandingHash;
}

export interface LandingOwnerRuntimeCallbacks {
  readonly snapshot: () => unknown | Promise<unknown>;
  readonly commitIntent: (request: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>;
  readonly dispatch: (request: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>;
  readonly reconcile: (request: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>;
  readonly commitOutcome: (request: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>;
}

export interface LandingOwnerRuntimeHost {
  readonly kind: 'landing-trusted-runtime-host';
  readonly schemaVersion: '1.0.0';
  readonly hostId: `lrth_${string}`;
}

export const LANDING_WORKFLOW_CATALOG_PATH: 'registry/landing-workflows.json';
export const LANDING_OPERATION_REGISTRY_PATH: 'registry/landing-operations.json';
export const LANDING_WORKFLOW_MANIFEST_PATH: 'conformance/fixtures/landing-workflow/generated-assets.json';
export const LANDING_WORKFLOW_ID: 'planr-land';
export const LANDING_WORKFLOW_ASSET_PATHS: readonly string[];

export function assertLandingWorkflowCatalog(value: unknown): Readonly<Record<string, unknown>>;
export function readLandingWorkflowCatalog(): Readonly<Record<string, unknown>>;
export function readLandingOperationRegistry(): Readonly<Record<string, unknown>>;
export function assertLandingWorkflowManifest(value: unknown, options?: { verifyFiles?: boolean }): Readonly<Record<string, unknown>>;
export function readLandingWorkflowManifest(options?: { verifyFiles?: boolean }): Readonly<Record<string, unknown>>;
export function bindLandingPlan(options?: Record<string, unknown>): Readonly<LandingPlan>;
export function createLandingOwnerRuntimeHost(
  callbacks: LandingOwnerRuntimeCallbacks,
): Readonly<LandingOwnerRuntimeHost>;
export function prepareLanding(options?: Record<string, unknown>): Readonly<LandingPlan>;
export function landingStatus(options?: { plan?: LandingPlan; events?: LandingEvent[] }): Readonly<Record<string, unknown>>;
export function showLanding(options?: { plan?: LandingPlan; events?: LandingEvent[] }): Readonly<Record<string, unknown>>;
export function previewLandingDocket(options?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export function advanceLanding(options?: Record<string, unknown>): Promise<Readonly<{
  ok: true;
  operation?: 'landing.advance';
  status?: 'cancelled';
  authority: 'none';
  state?: LandingState;
  phaseReceipt?: Readonly<Record<string, unknown>>;
  landingReceipt?: Readonly<Record<string, unknown>> | null;
}>>;
