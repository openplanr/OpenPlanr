import { createHash } from 'node:crypto';
import type {
  OperatingAssignmentClaimV2,
  OperatingSubmissionAcceptanceV2,
} from 'planr-pipeline/protocol';

const RUNTIME_MODULE = 'planr-pipeline/operate/runtime-v2';
const EXTENSIONS_MODULE = 'planr-pipeline/operate/extensions-v2';
const DOMAINS_MODULE = 'planr-pipeline/operate/operating-domains-v2';
const EXPERIENCE_MODULE = 'planr-pipeline/operate/experience-projection-v2';
const PLANNING_BRIDGE_MODULE = 'planr-pipeline/operate/planning-bridge-v2';
const EVIDENCE_MODULE = 'planr-pipeline/operate/evidence-v2';
const EXECUTIVE_BOARD_MODULE = 'planr-pipeline/operate/executive-board-materialization-v2';
const MEASUREMENT_MODULE = 'planr-pipeline';

export type JsonRecord = Record<string, unknown>;

export type ScreenedEvidenceResolverSource =
  | Readonly<{
      kind: 'filesystem';
      sourceRootId: string;
      rootPath: string;
      maxBytes: number;
      classification: 'public' | 'internal';
      sourceContract: Readonly<{
        id: 'repository-architecture' | 'ci-test-evidence';
        version: '1.0.0';
      }>;
    }>
  | Readonly<{
      kind: 'planr';
      projectId: string;
      rootPath: string;
      maxBytes: number;
      classification: 'public' | 'internal';
      scope: Readonly<{ scopeId: string; domainId: string; domainVersion: string }>;
      sourceContract: Readonly<{ id: 'planning-acceptance'; version: '1.0.0' }>;
      artifacts: readonly Readonly<{
        artifactId: string;
        artifactType: string;
        path: string;
        contentHash: string;
      }>[];
    }>;

type RuntimeArtifact = JsonRecord & {
  artifactId: string;
  rawHash: string;
  cycleId: string;
};

type RuntimeEvent = JsonRecord & {
  eventId: string;
  eventHash: string;
  sequence: number;
  cycleId: string;
  type: string;
};

type RuntimeState = JsonRecord & {
  generatedAt: string;
  eventHead: { sequence: number; hash: string | null };
  cycles: JsonRecord[];
  assignments: JsonRecord[];
  artifacts: RuntimeArtifact[];
  reviews: JsonRecord[];
  decisions: JsonRecord[];
  actions: JsonRecord[];
  outcomes: JsonRecord[];
  learnings: JsonRecord[];
};

type ArtifactByteStore = {
  stageRaw(input: { artifact: RuntimeArtifact; rawBytes: Uint8Array }): true;
  readRaw(input: { artifactId: string; rawHash: string }): Uint8Array;
};

type RuntimeApi = {
  createEmptyOperatingRuntimeStateV2(generatedAt: string): RuntimeState;
  createNoModelReplayHookV2(): { dispatchCount: number; assertUnused(): true };
  createOperatingRuntimeEventV2(input: JsonRecord, options?: JsonRecord): RuntimeEvent;
  reduceOperatingRuntimeEventsV2(
    events: RuntimeEvent[],
    options: {
      initialState: RuntimeState;
      artifactStore: ArtifactByteStore;
      replayHook: { dispatchCount: number; assertUnused(): true };
    },
  ): RuntimeState;
  scheduleOperatingRuntimeEventsV2(
    events: RuntimeEvent[],
    options: {
      initialState: RuntimeState;
      replayHook: { dispatchCount: number; assertUnused(): true };
    },
  ): { state: RuntimeState; events: RuntimeEvent[]; releaseEvents: RuntimeEvent[] };
  claimOperatingAssignmentV2(
    request: JsonRecord,
    draft: JsonRecord,
    options: {
      initialState: RuntimeState;
      capabilities: string[];
      replayHook: { dispatchCount: number; assertUnused(): true };
    },
  ): {
    replayed: boolean;
    state: RuntimeState;
    events: RuntimeEvent[];
    response: OperatingAssignmentClaimV2;
  };
  acceptOperatingAssignmentSubmissionV2(
    request: JsonRecord,
    draft: JsonRecord,
    options: {
      initialState: RuntimeState;
      artifactStore: ArtifactByteStore;
      replayHook: { dispatchCount: number; assertUnused(): true };
    },
  ): {
    replayed: boolean;
    artifact: RuntimeArtifact;
    stagedRawBytes: Uint8Array;
    state: RuntimeState;
    events: RuntimeEvent[];
    response: OperatingSubmissionAcceptanceV2;
  };
  materializeOperatingEvidenceV2(
    request: JsonRecord,
    draft: JsonRecord,
    options: JsonRecord,
  ): JsonRecord & { state: RuntimeState; events: RuntimeEvent[] };
  materializeOperatingStateSnapshotV2(
    request: JsonRecord,
    draft: JsonRecord,
    options: JsonRecord,
  ): JsonRecord & { state: RuntimeState; events: RuntimeEvent[] };
  deriveOperatingRuntimeDeltaV2(
    request: JsonRecord,
    draft: JsonRecord,
    options: JsonRecord,
  ): JsonRecord & { state: RuntimeState; events: RuntimeEvent[] };
  planOperatingRuntimeIntelligenceBoardV2(
    request: JsonRecord,
    draft: JsonRecord,
    options: JsonRecord,
  ): JsonRecord & {
    state: RuntimeState;
    events: RuntimeEvent[];
    assignments: JsonRecord[];
    plan: JsonRecord;
  };
  materializeOperatingDecisionLedgerV2(
    request: JsonRecord,
    draft: JsonRecord,
    options: JsonRecord,
  ): JsonRecord & { state: RuntimeState; events: RuntimeEvent[]; ledger: JsonRecord };
  materializeOperatingActionVerificationV2(
    request: JsonRecord,
    draft: JsonRecord,
    options: JsonRecord,
  ): JsonRecord & {
    state: RuntimeState;
    events: RuntimeEvent[];
    actions: JsonRecord[];
    verificationPlans: JsonRecord[];
  };
  ingestOperatingPlanningDeliveryEvidenceV2(
    request: JsonRecord,
    draft: JsonRecord,
    options: {
      initialState: RuntimeState;
      artifactStore: ArtifactByteStore;
      replayHook: { dispatchCount: number; assertUnused(): true };
    },
  ): JsonRecord & { state: RuntimeState; events: RuntimeEvent[]; replayed: boolean };
  deriveOperateAllowedActionsV2(context: JsonRecord): JsonRecord[];
  assertOperateAuthorizedV2(operation: string, context: JsonRecord): { allowed: true };
  readOperatingArtifactRawBytesV2(
    store: ArtifactByteStore,
    identity: { artifactId: string; rawHash: string },
  ): Uint8Array;
  buildOperatingCycleWorkViewV2(
    state: RuntimeState,
    cycleId: string,
    options: { generatedAt: string },
  ): JsonRecord;
};

type ExtensionsApi = {
  OPEN_REFERENCE_OPERATE_EXTENSIONS_V2: JsonRecord;
};

type DomainsApi = {
  resolvePublicOperatingDomainV2(
    registry: JsonRecord,
    domainId: string,
    options: { domainVersion: string },
  ): JsonRecord | null;
};

type ExperienceApi = {
  createOperateExperienceReplayCheckpointV2(
    state: RuntimeState,
    options?: { createdAt?: string; recoveryVersion?: string },
  ): JsonRecord;
  buildOperateExperienceViewV2(
    state: RuntimeState,
    options: {
      scope: { scopeId: string; domainId: string; domainVersion: string };
      actor: {
        actorId: string;
        accessLevel: 'public' | 'internal' | 'confidential' | 'restricted';
      };
      deliveryRoutes: JsonRecord[];
      allowedActions: Array<{ subjectId: string; action: JsonRecord }>;
      events: JsonRecord[];
      checkpoint: JsonRecord | null;
      checkpointState: RuntimeState | null;
      generatedAt: string;
      status: 'ready' | 'read-only';
    },
  ): JsonRecord;
  createOperateExperiencePreviewV1(
    state: RuntimeState,
    options: {
      scope: { scopeId: string; domainId: string; domainVersion: string };
      view: JsonRecord;
      actionDigest: string;
      authority: 'allowed' | 'refused' | 'read-only';
      reasonCodes?: string[];
      issuedAt?: string;
      expiresAt: string;
    },
  ): JsonRecord;
};

type PlanningBridgeApi = {
  createOperatingDeliveryRouteV1(input: {
    state: RuntimeState;
    action: JsonRecord;
    route: 'contained-execution' | 'planning-work' | 'human-external' | 'observe-only';
    rationale: string;
    createdAt: string;
  }): JsonRecord;
};

type EvidenceApi = {
  OPEN_REFERENCE_EVIDENCE_REGISTRY_V2: JsonRecord;
};

type ExecutiveBoardApi = {
  createOperatingExecutiveBoardMaterializationV2(
    request: {
      cycleId: string;
      planId: string;
      ledgerId: string;
      review: JsonRecord;
    },
    draft: { eventId: string; timestamp: string; correlationId: string },
    options: { initialState: RuntimeState },
  ): { board: JsonRecord; event: RuntimeEvent };
};

type MeasurementApi = {
  assertOperatingMeasurementScheduleV2(value: unknown): JsonRecord;
  assertOperatingMeasurementScheduleReceiptV2(
    value: unknown,
    options: { previousSchedule: JsonRecord; resultingSchedule: JsonRecord },
  ): JsonRecord;
  reduceOperatingMeasurementScheduleV2(
    schedule: unknown,
    transition: unknown,
    options?: { priorReceipt?: unknown },
  ): { replay: boolean; schedule: JsonRecord; receipt: JsonRecord };
};

export type OperateCompositionModules = {
  runtime: RuntimeApi;
  extensions: ExtensionsApi;
  domains: DomainsApi;
  experience: ExperienceApi;
  planningBridge: PlanningBridgeApi;
  evidence: EvidenceApi;
  executiveBoard: ExecutiveBoardApi;
  measurement: MeasurementApi;
};

let cachedModules: Promise<OperateCompositionModules> | null = null;

function hash(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function artifactStore(artifacts: Map<string, Uint8Array>): ArtifactByteStore {
  return Object.freeze({
    stageRaw({ artifact, rawBytes }: { artifact: RuntimeArtifact; rawBytes: Uint8Array }) {
      const bytes = Buffer.from(rawBytes);
      if (hash(bytes) !== artifact.rawHash) {
        throw Object.assign(new Error('Artifact bytes do not match their immutable hash.'), {
          code: 'ARTIFACT_HASH_MISMATCH',
        });
      }
      const existing = artifacts.get(artifact.artifactId);
      if (existing && !Buffer.from(existing).equals(bytes)) {
        throw Object.assign(new Error('Artifact identity is already bound to different bytes.'), {
          code: 'SUBMISSION_ID_CONFLICT',
        });
      }
      artifacts.set(artifact.artifactId, bytes);
      return true as const;
    },
    readRaw({ artifactId, rawHash }: { artifactId: string; rawHash: string }) {
      const bytes = artifacts.get(artifactId);
      if (!bytes) {
        throw Object.assign(new Error('Artifact raw bytes are unavailable.'), {
          code: 'ARTIFACT_NOT_FOUND',
        });
      }
      if (hash(bytes) !== rawHash) {
        throw Object.assign(new Error('Artifact raw bytes failed immutable hash verification.'), {
          code: 'ARTIFACT_HASH_MISMATCH',
        });
      }
      return Buffer.from(bytes);
    },
  });
}

/** Loads only installed public package subpaths; no workspace or private module is addressable here. */
export async function loadOperateCompositionModules(): Promise<OperateCompositionModules> {
  cachedModules ??= Promise.all([
    import(RUNTIME_MODULE),
    import(EXTENSIONS_MODULE),
    import(DOMAINS_MODULE),
    import(EXPERIENCE_MODULE),
    import(PLANNING_BRIDGE_MODULE),
    import(EVIDENCE_MODULE),
    import(EXECUTIVE_BOARD_MODULE),
    import(MEASUREMENT_MODULE),
  ]).then(
    ([
      runtime,
      extensions,
      domains,
      experience,
      planningBridge,
      evidence,
      executiveBoard,
      measurement,
    ]) => ({
      runtime: runtime as RuntimeApi,
      extensions: extensions as ExtensionsApi,
      domains: domains as DomainsApi,
      experience: experience as ExperienceApi,
      planningBridge: planningBridge as PlanningBridgeApi,
      evidence: evidence as EvidenceApi,
      executiveBoard: executiveBoard as ExecutiveBoardApi,
      measurement: measurement as MeasurementApi,
    }),
  );
  return await cachedModules;
}

export class OperateComposition {
  constructor(private readonly modules: OperateCompositionModules) {}

  validateMeasurementSchedule(value: unknown): JsonRecord {
    return this.modules.measurement.assertOperatingMeasurementScheduleV2(value);
  }

  validateMeasurementScheduleReceipt(
    value: unknown,
    previousSchedule: JsonRecord,
    resultingSchedule: JsonRecord,
  ): JsonRecord {
    return this.modules.measurement.assertOperatingMeasurementScheduleReceiptV2(value, {
      previousSchedule,
      resultingSchedule,
    });
  }

  reduceMeasurementSchedule(
    schedule: unknown,
    transition: unknown,
    priorReceipt?: unknown,
  ): { replay: boolean; schedule: JsonRecord; receipt: JsonRecord } {
    return this.modules.measurement.reduceOperatingMeasurementScheduleV2(
      schedule,
      transition,
      priorReceipt === undefined ? {} : { priorReceipt },
    );
  }

  createEmptyState(generatedAt: string): RuntimeState {
    return this.modules.runtime.createEmptyOperatingRuntimeStateV2(generatedAt);
  }

  resolveDomain(domainId: string, domainVersion: string): JsonRecord {
    const domain = this.modules.domains.resolvePublicOperatingDomainV2(
      this.modules.extensions.OPEN_REFERENCE_OPERATE_EXTENSIONS_V2,
      domainId,
      { domainVersion },
    );
    if (!domain) {
      throw Object.assign(new Error('The requested public operating domain is unavailable.'), {
        code: 'DOMAIN_CONTRACT_UNSUPPORTED',
      });
    }
    return structuredClone(domain);
  }

  createEvent(input: JsonRecord, previousEvent: JsonRecord | null): RuntimeEvent {
    return this.modules.runtime.createOperatingRuntimeEventV2(
      input,
      previousEvent === null ? {} : { previousEvent },
    );
  }

  replay(
    baseState: JsonRecord,
    events: JsonRecord[],
    artifacts: Map<string, Uint8Array>,
  ): RuntimeState {
    const hook = this.modules.runtime.createNoModelReplayHookV2();
    const state = this.modules.runtime.reduceOperatingRuntimeEventsV2(events as RuntimeEvent[], {
      initialState: baseState as RuntimeState,
      artifactStore: artifactStore(artifacts),
      replayHook: hook,
    });
    hook.assertUnused();
    return state;
  }

  reduce(
    state: JsonRecord,
    events: JsonRecord[],
    artifacts: Map<string, Uint8Array>,
  ): RuntimeState {
    const hook = this.modules.runtime.createNoModelReplayHookV2();
    const next = this.modules.runtime.reduceOperatingRuntimeEventsV2(events as RuntimeEvent[], {
      initialState: state as RuntimeState,
      artifactStore: artifactStore(artifacts),
      replayHook: hook,
    });
    hook.assertUnused();
    return next;
  }

  schedule(
    state: JsonRecord,
    events: JsonRecord[],
  ): { state: RuntimeState; events: RuntimeEvent[]; releaseEvents: RuntimeEvent[] } {
    const hook = this.modules.runtime.createNoModelReplayHookV2();
    const result = this.modules.runtime.scheduleOperatingRuntimeEventsV2(events as RuntimeEvent[], {
      initialState: state as RuntimeState,
      replayHook: hook,
    });
    hook.assertUnused();
    return result;
  }

  claimAssignment(request: JsonRecord, draft: JsonRecord, state: JsonRecord) {
    const hook = this.modules.runtime.createNoModelReplayHookV2();
    const result = this.modules.runtime.claimOperatingAssignmentV2(request, draft, {
      initialState: state as RuntimeState,
      capabilities: ['operate.assignment.claim'],
      replayHook: hook,
    });
    hook.assertUnused();
    return result;
  }

  acceptSubmission(
    request: JsonRecord,
    draft: JsonRecord,
    state: JsonRecord,
    artifacts: Map<string, Uint8Array>,
  ) {
    const hook = this.modules.runtime.createNoModelReplayHookV2();
    const result = this.modules.runtime.acceptOperatingAssignmentSubmissionV2(request, draft, {
      initialState: state as RuntimeState,
      artifactStore: artifactStore(artifacts),
      replayHook: hook,
    });
    hook.assertUnused();
    return result;
  }

  materializeEvidence(
    request: JsonRecord,
    draft: JsonRecord,
    state: JsonRecord,
    artifacts: Map<string, Uint8Array>,
  ) {
    const hook = this.modules.runtime.createNoModelReplayHookV2();
    const result = this.modules.runtime.materializeOperatingEvidenceV2(request, draft, {
      registry: this.modules.evidence.OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
      initialState: state,
      artifactStore: artifactStore(artifacts),
      resolverContext: { capabilities: ['evidence.operate-artifact.read'] },
      replayHook: hook,
    });
    hook.assertUnused();
    return result;
  }

  /**
   * Materialize one already accepted live-evidence ingestion through the same
   * operate-artifact resolver. The caller supplies only the exact semantic
   * custody required by the portable kernel; provider execution and durable
   * Store writes remain outside this composition wrapper.
   */
  materializeLiveEvidence(
    request: JsonRecord,
    draft: JsonRecord,
    state: JsonRecord,
    artifacts: Map<string, Uint8Array>,
    sourceArtifactId: string,
    custody: JsonRecord,
  ) {
    const hook = this.modules.runtime.createNoModelReplayHookV2();
    const result = this.modules.runtime.materializeOperatingEvidenceV2(request, draft, {
      registry: this.modules.evidence.OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
      initialState: state,
      artifactStore: artifactStore(artifacts),
      liveEvidenceCustodyByArtifactId: { [sourceArtifactId]: custody },
      resolverContext: { capabilities: ['evidence.operate-artifact.read'] },
      replayHook: hook,
    });
    hook.assertUnused();
    return result;
  }

  /** Resolves only adapter-screened local sources with capability selection owned here. */
  materializeScreenedEvidence(
    request: JsonRecord,
    draft: JsonRecord,
    state: JsonRecord,
    artifacts: Map<string, Uint8Array>,
    source: ScreenedEvidenceResolverSource,
  ) {
    const hook = this.modules.runtime.createNoModelReplayHookV2();
    const resolverContext =
      source.kind === 'filesystem'
        ? {
            capabilities: ['evidence.filesystem.read'],
            filesystemRoots: [
              {
                sourceRootId: source.sourceRootId,
                rootPath: source.rootPath,
                maxBytes: source.maxBytes,
                classification: source.classification,
                sourceContract: source.sourceContract,
              },
            ],
          }
        : {
            capabilities: ['evidence.planr.read'],
            planrProjects: [
              {
                projectId: source.projectId,
                rootPath: source.rootPath,
                maxBytes: source.maxBytes,
                classification: source.classification,
                scope: source.scope,
                sourceContract: source.sourceContract,
                artifacts: source.artifacts,
              },
            ],
          };
    const result = this.modules.runtime.materializeOperatingEvidenceV2(request, draft, {
      registry: this.modules.evidence.OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
      initialState: state,
      artifactStore: artifactStore(artifacts),
      resolverContext,
      replayHook: hook,
    });
    hook.assertUnused();
    return result;
  }

  materializeSnapshot(
    request: JsonRecord,
    draft: JsonRecord,
    state: JsonRecord,
    artifacts: Map<string, Uint8Array>,
  ) {
    const hook = this.modules.runtime.createNoModelReplayHookV2();
    const result = this.modules.runtime.materializeOperatingStateSnapshotV2(request, draft, {
      initialState: state,
      artifactStore: artifactStore(artifacts),
      replayHook: hook,
    });
    hook.assertUnused();
    return result;
  }

  deriveDelta(request: JsonRecord, draft: JsonRecord, state: JsonRecord) {
    const hook = this.modules.runtime.createNoModelReplayHookV2();
    const result = this.modules.runtime.deriveOperatingRuntimeDeltaV2(request, draft, {
      initialState: state,
      replayHook: hook,
    });
    hook.assertUnused();
    return result;
  }

  planBoard(
    request: JsonRecord,
    draft: JsonRecord,
    state: JsonRecord,
    artifacts: Map<string, Uint8Array>,
  ) {
    const hook = this.modules.runtime.createNoModelReplayHookV2();
    const result = this.modules.runtime.planOperatingRuntimeIntelligenceBoardV2(request, draft, {
      initialState: state,
      artifactStore: artifactStore(artifacts),
      replayHook: hook,
    });
    hook.assertUnused();
    return result;
  }

  materializeDecisionLedger(
    request: JsonRecord,
    draft: JsonRecord,
    state: JsonRecord,
    artifacts: Map<string, Uint8Array>,
  ) {
    const hook = this.modules.runtime.createNoModelReplayHookV2();
    const result = this.modules.runtime.materializeOperatingDecisionLedgerV2(request, draft, {
      initialState: state,
      artifactStore: artifactStore(artifacts),
      replayHook: hook,
    });
    hook.assertUnused();
    return result;
  }

  materializeActionVerification(
    request: JsonRecord,
    draft: JsonRecord,
    state: JsonRecord,
    artifacts: Map<string, Uint8Array>,
  ) {
    const hook = this.modules.runtime.createNoModelReplayHookV2();
    const result = this.modules.runtime.materializeOperatingActionVerificationV2(request, draft, {
      initialState: state,
      artifactStore: artifactStore(artifacts),
      replayHook: hook,
    });
    hook.assertUnused();
    return result;
  }

  materializeExecutiveBoardReview(
    request: {
      cycleId: string;
      planId: string;
      ledgerId: string;
      review: JsonRecord;
    },
    draft: {
      boardEventId: string;
      reviewEventId: string;
      timestamp: string;
      correlationId: string;
    },
    state: JsonRecord,
    artifacts: Map<string, Uint8Array>,
  ): { state: RuntimeState; board: JsonRecord; events: RuntimeEvent[] } {
    const prepared = this.modules.executiveBoard.createOperatingExecutiveBoardMaterializationV2(
      request,
      {
        eventId: draft.boardEventId,
        timestamp: draft.timestamp,
        correlationId: draft.correlationId,
      },
      { initialState: state as RuntimeState },
    );
    const reviewEvent = this.modules.runtime.createOperatingRuntimeEventV2(
      {
        eventId: draft.reviewEventId,
        timestamp: draft.timestamp,
        cycleId: request.cycleId,
        type: 'review.created',
        entityId: String(request.review.reviewId),
        actor: { kind: 'runtime', id: 'openplanr' },
        causationId: prepared.event.eventId,
        correlationId: draft.correlationId,
        payload: request.review,
      },
      { previousEvent: prepared.event },
    );
    const hook = this.modules.runtime.createNoModelReplayHookV2();
    const events = [prepared.event, reviewEvent];
    const next = this.modules.runtime.reduceOperatingRuntimeEventsV2(events, {
      initialState: state as RuntimeState,
      artifactStore: artifactStore(artifacts),
      replayHook: hook,
    });
    hook.assertUnused();
    return {
      state: next,
      board: structuredClone(prepared.board),
      events,
    };
  }

  ingestPlanningDelivery(
    request: JsonRecord,
    draft: JsonRecord,
    state: JsonRecord,
    artifacts: Map<string, Uint8Array>,
  ) {
    const hook = this.modules.runtime.createNoModelReplayHookV2();
    const result = this.modules.runtime.ingestOperatingPlanningDeliveryEvidenceV2(request, draft, {
      initialState: state as RuntimeState,
      artifactStore: artifactStore(artifacts),
      replayHook: hook,
    });
    hook.assertUnused();
    return result;
  }

  allowedActions(context: JsonRecord): JsonRecord[] {
    return this.modules.runtime
      .deriveOperateAllowedActionsV2(context)
      .map((entry) => structuredClone(entry));
  }

  assertAuthorized(operation: string, context: JsonRecord): void {
    this.modules.runtime.assertOperateAuthorizedV2(operation, context);
  }

  readArtifact(artifacts: Map<string, Uint8Array>, artifact: RuntimeArtifact): Uint8Array {
    return this.modules.runtime.readOperatingArtifactRawBytesV2(artifactStore(artifacts), {
      artifactId: artifact.artifactId,
      rawHash: artifact.rawHash,
    });
  }

  experience(input: {
    state: JsonRecord;
    baseState: JsonRecord;
    cycleId: string;
    scope: { scopeId: string; domainId: string; domainVersion: string };
    actor: {
      actorId: string;
      accessLevel: 'public' | 'internal' | 'confidential' | 'restricted';
    };
    allowedActions: Array<{ subjectId: string; action: JsonRecord }>;
    events: JsonRecord[];
    routes: Record<
      string,
      'contained-execution' | 'planning-work' | 'human-external' | 'observe-only'
    >;
    generatedAt: string;
  }): JsonRecord {
    const state = input.state as RuntimeState;
    const baseState = input.baseState as RuntimeState;
    const actions = state.actions.filter(
      (action) =>
        action.scopeId === input.scope.scopeId &&
        action.domainId === input.scope.domainId &&
        action.domainVersion === input.scope.domainVersion,
    );
    if (
      actions.some(
        (action) => !Number.isInteger(action.revision) || typeof action.actionHash !== 'string',
      )
    ) {
      return {
        status: 'read-only',
        projection: 'operating-cycle-work-view',
        view: this.modules.runtime.buildOperatingCycleWorkViewV2(state, input.cycleId, {
          generatedAt: input.generatedAt,
        }),
      };
    }
    const deliveryRoutes = actions.map((action) => {
      const cycleId = String(action.sourceCycleId ?? '');
      const route = input.routes[cycleId];
      if (!route) {
        throw Object.assign(new Error('A current Action has no explicit delivery route.'), {
          code: 'STATE_TRANSITION_INVALID',
        });
      }
      return this.modules.planningBridge.createOperatingDeliveryRouteV1({
        state,
        action,
        route,
        rationale: 'Selected explicitly when this operating lifecycle was started.',
        createdAt: input.generatedAt,
      });
    });
    const replayIndex = state.eventReplayIndex as JsonRecord[];
    const fullGenesisReplay =
      state.eventHead.sequence === 0
        ? input.events.length === 0 && replayIndex.length === 0
        : input.events.length === replayIndex.length && Number(input.events[0]?.sequence) === 1;
    const checkpoint = fullGenesisReplay
      ? null
      : this.modules.experience.createOperateExperienceReplayCheckpointV2(baseState, {
          createdAt: baseState.generatedAt,
        });
    return this.modules.experience.buildOperateExperienceViewV2(state, {
      scope: input.scope,
      actor: input.actor,
      deliveryRoutes,
      allowedActions: input.allowedActions,
      events: input.events,
      checkpoint,
      checkpointState: checkpoint === null ? null : baseState,
      generatedAt: input.generatedAt,
      status: 'ready',
    });
  }

  preview(input: {
    state: JsonRecord;
    scope: { scopeId: string; domainId: string; domainVersion: string };
    view: JsonRecord;
    actionDigest: string;
    authority: 'allowed' | 'refused' | 'read-only';
    reasonCodes?: string[];
    issuedAt?: string;
    expiresAt: string;
  }): JsonRecord {
    return this.modules.experience.createOperateExperiencePreviewV1(input.state as RuntimeState, {
      scope: input.scope,
      view: input.view,
      actionDigest: input.actionDigest,
      authority: input.authority,
      reasonCodes: input.reasonCodes,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
    });
  }
}

export async function createOperateComposition(): Promise<OperateComposition> {
  return new OperateComposition(await loadOperateCompositionModules());
}
