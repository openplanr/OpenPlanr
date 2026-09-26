import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  type ArtifactRequest,
  type ClaimRequest,
  cycleReadActions,
  type ExperienceRequest,
  findBy,
  type LiveEvidenceSubmissionPreparationV2,
  type LiveEvidenceSubmissionRequestV2,
  type LiveEvidenceSubmissionResultV2,
  type OperateActorV2,
  type OperateAllowedActionV2,
  type OperateApiEnvelopeV2,
  type OperateApiFailureV2,
  type OperateAssignmentResultPreflight,
  type OperateAuditDisplayRequestV1,
  type OperateDispatchRequestForV2,
  type OperateDispatchRequestV2,
  type OperateEventHeadV2,
  type OperateExperiencePreviewRequestV1,
  type OperateMeasurementCommandV1,
  type OperateMeasurementResultV1,
  type OperateStartRequestV2,
  type OperateToolNameV2,
  type OperateToolRequestMapV2,
  operateSuccess,
  PROTOCOL_VERSION,
  type ReplaySafeIssue,
  type ReviewRequest,
  type ReviewSubmitRequest,
  record,
  type SubmitRequest,
  stableId,
  state,
  timestamp,
} from './client/contracts.js';
import {
  approveOperateAction,
  type ContainedActionTargets,
  executeOperateAction,
  type GovernedActionDependencies,
  governedArtifactStore,
  rollbackOperateAction,
} from './client/governance.js';
import {
  acceptOperateLiveEvidenceSubmission,
  claimOperateAssignment,
  clearOperateStaleLock,
  createOperateComposition,
  createOperateExperiencePreview,
  createOperateStore,
  createProjectMeasurementScheduleService,
  createSpecForOperatingPlanning,
  ensureOperateStorageLayout,
  ingestPlanningDeliveryEvidence,
  inspectOperateRecovery,
  type JsonRecord,
  liveEvidenceSubmissionPreparation,
  MeasurementScheduleError,
  type MeasurementScheduleService,
  OPERATE_INTEGRITY_BOUNDARY,
  type OperateComposition,
  type OperateStore,
  type OperateStoredRuntime,
  previewOperatingPlanningSpec,
  readCommittedOperateReviewReceipt,
  readOperateActionWorkspace,
  readOperateAuditDisplay,
  readOperateCycleWorkspace,
  readOperateExecutiveBoardDisplay,
  readOperateExperience,
  readOperateRecoveryDisplay,
  readOperateReview,
  restoreOperateGeneration,
  startOperateCycle,
  submitBoundOperateReview,
  submitOperateAssignment,
  submitOperateReview,
} from './client/lifecycle.js';
import {
  assertProtocolArtifact,
  buildOperatingCycleWorkViewV2,
  buildOperatingWorkLedgerV2,
  type OperateReviewBoundSubmissionV1,
  preflightOperatingAssignmentResultV2,
  readOperatingArtifactV2,
} from './client/runtime.js';
import { OperateClientError, type OperateErrorCodeV2 } from './client-error.js';

export type {
  LiveEvidenceSubmissionCustodyV2,
  LiveEvidenceSubmissionPreparationV2,
  LiveEvidenceSubmissionRequestV2,
  LiveEvidenceSubmissionResultV2,
  OperateActorV2,
  OperateAllowedActionV2,
  OperateApiEnvelopeV2,
  OperateApiFailureV2,
  OperateApiSuccessV2,
  OperateAssignmentResultPreflight,
  OperateAuditDisplayRequestV1,
  OperateDispatchRequestForV2,
  OperateDispatchRequestV2,
  OperateEventHeadV2,
  OperateExperiencePreviewRequestV1,
  OperateMeasurementCommandV1,
  OperateMeasurementResultV1,
  OperateStartRequestV2,
  OperateToolNameV2,
  OperateToolRequestMapV2,
  OperateToolResponseMapV2,
} from './client/contracts.js';
export {
  type AccessSafeOperateSearchHitV1,
  projectAccessSafeOperateSearchHits,
} from './search-hit-contract.js';

const SAFE_CODES = new Set<OperateErrorCodeV2>([
  'CYCLE_NOT_FOUND',
  'CYCLE_TERMINAL',
  'ASSIGNMENT_NOT_AVAILABLE',
  'ASSIGNMENT_ALREADY_CLAIMED',
  'ASSIGNMENT_ALREADY_SUBMITTED',
  'ACTION_REVISION_MISMATCH',
  'RESULT_CONTRACT_INVALID',
  'SUBMISSION_ID_CONFLICT',
  'CAPABILITY_DENIED',
  'REVIEW_NOT_FOUND',
  'REVIEW_NOT_PENDING',
  'REVIEW_NOT_AUTHORIZED',
  'STATE_TRANSITION_INVALID',
  'ARTIFACT_NOT_FOUND',
  'CONTRACT_VERSION_UNSUPPORTED',
  'CONCURRENT_MODIFICATION',
  'OPERATING_SCOPE_INVALID',
  'DOMAIN_CONTRACT_UNSUPPORTED',
  'OPERATE_STORE_CORRUPT',
  'OPERATE_STORE_INCOMPATIBLE',
  'OPERATE_STORE_CONFLICT',
  'OPERATE_SUBJECT_NOT_FOUND',
  'OPERATION_CONFLICT',
  'OPERATION_UNCERTAIN',
  'ROLLBACK_NOT_ELIGIBLE',
  'APPROVAL_INVALID',
  'APPROVAL_REQUIRED',
  'POLICY_EVALUATION_REJECTED',
  'E_OPERATE_PLANNING_ACCESS',
  'E_OPERATE_PLANNING_BINDING',
  'E_OPERATE_PLANNING_CONCURRENT',
  'E_OPERATE_PLANNING_CONFIRMATION',
  'E_OPERATE_PLANNING_CONFLICT',
  'E_OPERATE_PLANNING_CUSTODY',
  'E_OPERATE_PLANNING_INVALID',
  'E_OPERATE_PLANNING_PATH',
  'E_OPERATE_PLANNING_ROUTE',
  'E_OPERATE_PLANNING_STALE',
  'E_OPERATE_PLANNING_STATE',
  'E_OPERATE_ORIGIN_INVALID',
  'E_PROVENANCE_CONFLICT',
]);

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function replaySafeIssueFactory(): () => ReplaySafeIssue {
  const issued = new Map<string, string[]>();
  const allocate = (kind: string, index: number, create: () => string): string => {
    const values = issued.get(kind) ?? [];
    if (!issued.has(kind)) issued.set(kind, values);
    values[index] ??= create();
    return values[index];
  };
  return () => {
    const cursors = new Map<string, number>();
    const next = (kind: string, create: () => string): string => {
      const index = cursors.get(kind) ?? 0;
      cursors.set(kind, index + 1);
      return allocate(kind, index, create);
    };
    return Object.freeze({
      id: (prefix: string) => next(`id:${prefix}`, () => id(prefix)),
      stableId,
      timestamp: () => next('timestamp', timestamp),
    });
  };
}

function recoveryAction(): OperateAllowedActionV2 {
  return {
    tool: 'operate.recovery.inspect',
    arguments: {},
    label: 'Inspect safe recovery options',
    effect: 'read-only',
  };
}

function errorCode(value: unknown): OperateErrorCodeV2 {
  const candidate = (value as { code?: unknown })?.code;
  return typeof candidate === 'string' && SAFE_CODES.has(candidate as OperateErrorCodeV2)
    ? (candidate as OperateErrorCodeV2)
    : 'STATE_TRANSITION_INVALID';
}

function errorContext(value: unknown): Record<string, string | number | boolean | null> {
  const details = (value as { details?: unknown; context?: unknown })?.details;
  const candidate =
    details && typeof details === 'object' && !Array.isArray(details)
      ? ((details as { context?: unknown }).context ?? details)
      : (value as { context?: unknown })?.context;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};
  return Object.fromEntries(
    Object.entries(candidate).filter(
      ([, entry]) =>
        typeof entry === 'string' ||
        typeof entry === 'number' ||
        typeof entry === 'boolean' ||
        entry === null,
    ),
  );
}

function previousEvent(runtime: OperateStoredRuntime): JsonRecord | null {
  const last = runtime.events.at(-1);
  if (last) return last;
  const head = state(runtime).eventHead;
  return head.sequence === 0 ? null : { sequence: head.sequence, eventHash: head.hash };
}

function cycleView(runtime: OperateStoredRuntime, cycleId: string): JsonRecord {
  const snapshot = state(runtime);
  const cycle = findBy(snapshot.cycles, 'cycleId', cycleId);
  if (!cycle) {
    throw new OperateClientError('CYCLE_NOT_FOUND', 'The requested cycle does not exist.', false, {
      cycleId,
    });
  }
  const assignmentIds = new Set(
    Object.values(runtime.preferences.cycleRoleAssignments[cycleId] ?? {}),
  );
  const assignments = snapshot.assignments.filter(
    (entry) => entry.cycleId === cycleId && assignmentIds.has(String(entry.assignmentId)),
  );
  const decisions = snapshot.decisions.filter((entry) => entry.sourceCycleId === cycleId);
  const actions = snapshot.actions.filter((entry) => entry.sourceCycleId === cycleId);
  const actionIds = new Set(actions.map((entry) => entry.actionId));
  const outcomes = snapshot.outcomes.filter((entry) => actionIds.has(entry.actionId));
  const outcomeIds = new Set(outcomes.map((entry) => entry.outcomeId));
  const learnings = snapshot.learnings.filter((entry) => outcomeIds.has(entry.outcomeId));
  const verificationPlans = snapshot.verificationPlans.filter((entry) =>
    actionIds.has(entry.actionId),
  );
  const planId = runtime.preferences.cycleIntelligencePlanIds[cycleId];
  const plan = snapshot.intelligencePlans.find((entry) => entry.planId === planId) ?? null;
  const count = (...states: string[]) =>
    assignments.filter((assignment) => states.includes(String(assignment.state))).length;
  return {
    generation: runtime.generation,
    cycle,
    progress: {
      total: assignments.length,
      pending: count('pending'),
      available: count('available'),
      active: count('claimed', 'running'),
      submitted: count('submitted'),
      validated: count('validated'),
      rejected: count('rejected'),
      terminal: count('validated', 'abandoned', 'failed'),
    },
    availableAssignments: assignments.filter((entry) => entry.state === 'available'),
    assignments,
    roleAssignments: runtime.preferences.cycleRoleAssignments[cycleId] ?? {},
    intelligencePlan: plan,
    activeReview:
      snapshot.reviews.find((entry) => entry.cycleId === cycleId && entry.state === 'pending') ??
      null,
    findings: snapshot.findings.filter((entry) => entry.sourceCycleId === cycleId),
    decisions,
    actions,
    verificationPlans,
    outcomes,
    learnings,
    lifecycle: {
      decisionAcceptance: decisions.map((decision) => ({
        decisionId: decision.decisionId,
        state: decision.state,
        acceptance:
          decision.state === 'approved'
            ? 'accepted'
            : decision.state === 'deferred'
              ? 'deferred-pending-accepted-outcome'
              : decision.state === 'proposed'
                ? 'awaiting-human-review'
                : 'not-accepted',
      })),
      actionApproval: actions.map((action) => ({
        actionId: action.actionId,
        state: action.state,
        approval: action.state === 'approved' ? 'approved' : 'not-approved',
      })),
      verification: {
        state: actions.some((action) => action.state === 'approved')
          ? 'planned-not-yet-executed'
          : 'not-yet-planned',
        planIds: verificationPlans.map((entry) => entry.verificationPlanId),
        assignmentState: 'not-yet-produced-before-terminal-execution',
        resultState: 'not-yet-produced-before-verification',
      },
      outcomeState: outcomes.length > 0 ? 'observed' : 'not-yet-produced',
      learningState: learnings.length > 0 ? 'recorded' : 'not-yet-produced',
    },
    acceptedArtifacts: snapshot.artifacts.filter((entry) => entry.cycleId === cycleId),
    acceptedArtifactIds: snapshot.artifacts
      .filter((entry) => entry.cycleId === cycleId)
      .map((entry) => entry.artifactId),
    integrityBoundary: OPERATE_INTEGRITY_BOUNDARY,
  };
}

function canonicalCycleEnvelope(
  runtime: OperateStoredRuntime,
  cycleId: string,
  operation: 'operate.cycle.start' | 'operate.cycle.get' | 'operate.cycle.resume',
): OperateApiEnvelopeV2 {
  const snapshot = state(runtime);
  const legacy = cycleView(runtime, cycleId);
  const cycle = record(legacy.cycle);
  const ledger = buildOperatingWorkLedgerV2(snapshot as never, cycle as never, {
    generatedAt: String(snapshot.generatedAt),
  }) as unknown as JsonRecord;
  const cycleWork = buildOperatingCycleWorkViewV2(snapshot as never, cycleId, {
    generatedAt: String(snapshot.generatedAt),
  }) as unknown as JsonRecord;
  const ownerActions = cycleReadActions(cycleId);
  const projected = {
    cycle,
    progress: legacy.progress,
    availableAssignments: legacy.availableAssignments,
    acceptedArtifactIds: legacy.acceptedArtifactIds,
    persistentWork: {
      ledger,
      cycleLinks: cycleWork.cycleLinks,
    },
    actions: ownerActions,
  };
  return assertProtocolArtifact(
    'operate-api-envelope',
    {
      ok: true,
      operation,
      data: projected,
      allowedActions: ownerActions,
    },
    { protocolVersion: PROTOCOL_VERSION },
  ) as OperateApiEnvelopeV2;
}

/**
 * OpenPlanr composition over the installed public Operate package. Every
 * request first reconstructs state from canonical Event replay records; this class
 * never imports package-private reducers, fixtures, schemas, or sibling source.
 */
export class OperateClient {
  readonly root: string;
  private readonly projectDir: string;
  private readonly store: OperateStore;
  private readonly containedTargets: ContainedActionTargets = new Map();
  private compositionPromise: Promise<OperateComposition> | null = null;
  private measurementPromise: Promise<MeasurementScheduleService> | null = null;

  constructor(projectDir: string) {
    this.store = createOperateStore(projectDir);
    this.root = this.store.root;
    this.projectDir = path.resolve(projectDir);
  }

  async measurement(input: OperateMeasurementCommandV1): Promise<OperateMeasurementResultV1> {
    const effects = (scheduleWrite = false) =>
      Object.freeze([
        Object.freeze({ id: 'schedule-custody-write' as const, executed: scheduleWrite }),
        Object.freeze({ id: 'due-work-issue' as const, executed: false }),
        Object.freeze({ id: 'provider-call' as const, executed: false }),
      ]);
    const success = (
      data: JsonRecord,
      options: {
        scheduleWrite?: boolean;
        authorityRequired?: boolean;
        ownerActionRequired?: boolean;
        nextAction: string;
      },
    ): OperateMeasurementResultV1 =>
      Object.freeze({
        ok: true,
        operation: input.operation,
        effects: effects(options.scheduleWrite),
        authorityRequired: options.authorityRequired ?? false,
        ownerActionRequired: options.ownerActionRequired ?? false,
        nextAction: options.nextAction,
        recovery: null,
        data: Object.freeze(structuredClone(data)),
      });
    try {
      const service = await this.measurementService();
      if (input.operation === 'measurement.preview') {
        const candidate = service.preview(input.schedule);
        this.assertMeasurementActor(input.actor, candidate.ownerActorId);
        return success(
          { schedule: candidate, confirmationDigest: candidate.scheduleHash },
          {
            authorityRequired: true,
            ownerActionRequired: true,
            nextAction:
              'The named owner must confirm this exact schedule digest before enabling it.',
          },
        );
      }
      if (input.operation === 'measurement.enable') {
        const candidate = service.preview(input.schedule);
        await this.assertCurrentMeasurementOwner(input.actor, candidate.ownerActorId);
        if (input.confirmDigest !== candidate.scheduleHash) {
          throw new MeasurementScheduleError(
            'E_MEASUREMENT_CONFIRMATION_REQUIRED',
            'Measurement confirmation does not match the exact previewed schedule.',
          );
        }
        const applied = await service.enable(candidate, input.transition);
        return success(
          { schedule: applied.schedule, receipt: applied.receipt, replayed: applied.replay },
          {
            scheduleWrite: !applied.replay,
            nextAction: applied.replay
              ? 'The exact enable transition was already recorded.'
              : 'Inspect schedule status; no monitor or provider was started.',
          },
        );
      }
      if (input.operation === 'measurement.disable') {
        const current = await service.read(input.scheduleId);
        await this.assertCurrentMeasurementOwner(input.actor, current.schedule.ownerActorId);
        if (input.confirmDigest !== current.schedule.scheduleHash) {
          throw new MeasurementScheduleError(
            'E_MEASUREMENT_CONFIRMATION_REQUIRED',
            'Measurement confirmation does not match current schedule custody.',
          );
        }
        const applied = await service.disable(input.scheduleId, input.transition);
        return success(
          { schedule: applied.schedule, receipt: applied.receipt, replayed: applied.replay },
          {
            scheduleWrite: !applied.replay,
            nextAction: applied.replay
              ? 'The exact disable transition was already recorded.'
              : 'The schedule is inactive and no due work can be issued.',
          },
        );
      }
      const current = await service.read(input.scheduleId);
      await this.assertCurrentMeasurementOwner(input.actor, current.schedule.ownerActorId);
      return success(current as unknown as JsonRecord, {
        nextAction:
          current.schedule.state === 'enabled'
            ? 'Use a governed measurement issuer when due work must be scheduled.'
            : 'Preview and explicitly enable an exact schedule before expecting due work.',
      });
    } catch (cause) {
      const knownMeasurement = cause instanceof MeasurementScheduleError ? cause : null;
      const knownOperate = cause instanceof OperateClientError ? cause : null;
      const authorityRequired =
        knownMeasurement?.code === 'E_MEASUREMENT_SCHEDULE_CONFLICT' ||
        knownMeasurement?.code === 'E_MEASUREMENT_SCHEDULE_LOCKED' ||
        knownMeasurement?.code === 'E_MEASUREMENT_OWNER_REQUIRED' ||
        knownMeasurement?.code === 'E_MEASUREMENT_CONFIRMATION_REQUIRED';
      const code = knownMeasurement?.code ?? knownOperate?.code ?? errorCode(cause);
      const problem =
        knownMeasurement?.message ??
        knownOperate?.message ??
        (cause instanceof Error
          ? cause.message
          : 'The requested measurement operation could not be completed.');
      return Object.freeze({
        ok: false,
        operation: input.operation,
        effects: effects(),
        authorityRequired,
        ownerActionRequired: authorityRequired,
        nextAction: authorityRequired
          ? 'The owner must inspect current schedule custody and submit one exact fresh command.'
          : 'Correct the bounded measurement request before retrying.',
        recovery: problem,
        error: Object.freeze({
          code,
          problem,
        }),
      });
    }
  }

  /** Internal packet-recovery read; never projects Assignment bytes outside this process. */
  async readAssignmentState(assignmentId: string, cycleId: string): Promise<string | null> {
    const runtime = await this.requiredRuntime();
    const assignment = state(runtime).assignments.find(
      (candidate) => candidate.assignmentId === assignmentId && candidate.cycleId === cycleId,
    );
    return assignment ? String(assignment.state) : null;
  }

  /** Run the protocol-owned schema/semantic preflight against exact persisted custody. */
  async preflightAssignmentResult(
    assignmentId: string,
    contentBytes: Uint8Array,
  ): Promise<OperateAssignmentResultPreflight> {
    const runtime = await this.requiredRuntime();
    return preflightOperatingAssignmentResultV2(
      { assignmentId, contentBytes },
      {
        initialState: state(runtime) as never,
        artifactStore: governedArtifactStore(runtime) as never,
      },
    ) as OperateAssignmentResultPreflight;
  }

  /**
   * Read the deterministic runtime-owned identities needed to construct one
   * live-evidence ingestion. This is pre-effect: it does not resolve a
   * credential, call a provider, stage bytes, or mutate the Operate Store.
   */
  async prepareLiveEvidenceSubmission(
    input: Readonly<{
      assignmentId: string;
      submissionId: string;
      actor: OperateActorV2;
    }>,
  ): Promise<LiveEvidenceSubmissionPreparationV2> {
    const runtime = await this.requiredRuntime();
    return liveEvidenceSubmissionPreparation(runtime, input);
  }

  /**
   * Accept an already redacted ingestion through the normal Assignment
   * transaction and resolve its operate-artifact candidate in the same durable
   * Store generation. Connector code never receives Store or Event authority.
   */
  async acceptLiveEvidenceSubmission(
    request: LiveEvidenceSubmissionRequestV2,
  ): Promise<LiveEvidenceSubmissionResultV2> {
    return await acceptOperateLiveEvidenceSubmission({
      root: this.root,
      request,
      requiredRuntime: async () => await this.requiredRuntime(),
      composition: async () => await this.composition(),
      commit: async (next, expectedGeneration) => await this.store.commit(next, expectedGeneration),
    });
  }

  /** Build the closed access-safe Cycle DTO before data crosses into browser state. */
  async readCycleWorkspace(cycleId: string, actor: OperateActorV2): Promise<unknown> {
    try {
      return await readOperateCycleWorkspace({
        cycleId,
        actor,
        readExperience: async (request) => await this.experience(request),
        readCycle: async (requestedCycleId) =>
          await this.get(requestedCycleId, 'operate.cycle.get'),
        refuse: (code, message) => {
          throw new OperateClientError(code, message, false);
        },
      });
    } catch (cause) {
      return this.failure('operate.cycle.get', cause);
    }
  }

  /** Build the closed access-safe Action DTO before data crosses into browser state. */
  async readActionWorkspace(
    actionId: string,
    cycleId: string,
    actor: OperateActorV2,
  ): Promise<unknown> {
    try {
      return await readOperateActionWorkspace({
        actionId,
        cycleId,
        actor,
        readExperience: async (request) => await this.experience(request),
        refuse: (code, message) => {
          throw new OperateClientError(code, message, false);
        },
      });
    } catch (cause) {
      return this.failure('operate.experience.get', cause);
    }
  }

  /** Build the closed access-safe recovery DTO before data crosses into browser state. */
  async readRecoveryDisplay(cycleId: string, actor: OperateActorV2): Promise<unknown> {
    try {
      return await readOperateRecoveryDisplay({
        cycleId,
        actor,
        readExperience: async (request) => await this.experience(request),
        inspectRecovery: async () =>
          await this.dispatch({ operation: 'operate.recovery.inspect', request: {} }),
        refuse: (code, message) => {
          throw new OperateClientError(code, message, false);
        },
      });
    } catch (cause) {
      return this.failure('operate.recovery.inspect', cause);
    }
  }

  /** Build the closed access-safe executive board DTO before data crosses into browser state. */
  async readExecutiveBoardDisplay(cycleId: string, actor: OperateActorV2): Promise<unknown> {
    try {
      return await readOperateExecutiveBoardDisplay({
        cycleId,
        actor,
        readExperience: async (request) => await this.experience(request),
        refuse: (code, message) => {
          throw new OperateClientError(code, message, false);
        },
      });
    } catch (cause) {
      return this.failure('operate.cycle.get', cause);
    }
  }

  /** Build one owner-selected, browser-verifiable read-only audit display. */
  async readAuditDisplay(request: OperateAuditDisplayRequestV1): Promise<unknown> {
    try {
      return await readOperateAuditDisplay({
        request,
        readExperience: async (experienceRequest) => await this.experience(experienceRequest),
      });
    } catch (cause) {
      return this.failure('operate.experience.get', cause);
    }
  }

  /** Compose one exact command preview through the installed projection owner. */
  async createExperiencePreview(input: OperateExperiencePreviewRequestV1): Promise<JsonRecord> {
    return await createOperateExperiencePreview({
      request: input,
      requiredRuntime: async () => await this.requiredRuntime(),
      composition: async () => await this.composition(),
    });
  }

  /** Read an immutable terminal Review receipt without replaying its mutation. */
  async readCommittedReviewReceipt(
    request: ReviewRequest,
  ): Promise<OperateApiEnvelopeV2<'operate.review.submit'>> {
    try {
      const runtime = await this.requiredRuntime();
      return readCommittedOperateReviewReceipt(
        runtime,
        request,
      ) as OperateApiEnvelopeV2<'operate.review.submit'>;
    } catch (cause) {
      return this.failure('operate.review.submit', cause);
    }
  }

  /**
   * Reconstruct one access-screened experience at an immutable historical
   * Event head. This is read-only and never exposes Store or replay internals.
   */
  async readExperienceAtEventHead(
    request: ExperienceRequest,
    expectedEventHead: OperateEventHeadV2,
  ): Promise<OperateApiEnvelopeV2<'operate.experience.get'>> {
    try {
      const current = await this.requiredRuntime();
      const historical = await this.runtimeAtEventHead(current, expectedEventHead);
      return (await this.experience(
        request,
        historical,
      )) as OperateApiEnvelopeV2<'operate.experience.get'>;
    } catch (cause) {
      return this.failure('operate.experience.get', cause);
    }
  }

  /** Commit one exact owner-bound Review choice through the additive facade. */
  async submitBoundReview(
    submission: OperateReviewBoundSubmissionV1,
  ): Promise<OperateApiEnvelopeV2<'operate.review.submit'>> {
    try {
      return (await submitBoundOperateReview({
        root: this.root,
        submission,
        issueFactory: replaySafeIssueFactory,
        requiredRuntime: async () => await this.requiredRuntime(),
        commit: async (runtime, nextState, events) => await this.commit(runtime, nextState, events),
      })) as OperateApiEnvelopeV2<'operate.review.submit'>;
    } catch (cause) {
      return this.failure('operate.review.submit', cause);
    }
  }

  async dispatch<Operation extends OperateToolNameV2>(
    input: OperateDispatchRequestForV2<Operation>,
  ): Promise<OperateApiEnvelopeV2<Operation>>;
  async dispatch(input: OperateDispatchRequestV2): Promise<OperateApiEnvelopeV2> {
    try {
      switch (input.operation) {
        case 'operate.cycle.start':
          return await this.start(input.request);
        case 'operate.cycle.get':
          return await this.get(input.request.cycleId, input.operation);
        case 'operate.cycle.resume':
          return await this.get(input.request.cycleId, input.operation);
        case 'operate.assignment.claim':
          return await this.claim(input.request);
        case 'operate.assignment.submit':
          return await this.submit(input.request);
        case 'operate.review.get':
          return await this.review(input.request);
        case 'operate.review.submit':
          return await this.submitReview(input.request);
        case 'operate.action.approve':
          return await this.approveAction(input.request);
        case 'operate.action.execute':
          return await this.executeAction(input.request);
        case 'operate.action.rollback':
          return await this.rollbackAction(input.request);
        case 'operate.artifact.get':
          return await this.artifact(input.request);
        case 'operate.experience.get':
          return await this.experience(input.request);
        case 'operate.planning.preview':
          return await this.planningPreview(
            input.request.actionId,
            input.request.actor,
            input.request.framing,
          );
        case 'operate.planning.create-spec':
          return await this.planningCreateSpec(
            input.request.proposalId,
            input.request.confirmDigest,
            input.request.actor,
          );
        case 'operate.planning.ingest-delivery':
          return await this.planningIngestDelivery(input.request);
        case 'operate.recovery.inspect':
          return await this.inspectRecovery();
        case 'operate.recovery.restore':
          return await this.restore(input.request.generation);
        case 'operate.recovery.clear-stale-lock':
          return await this.clearStaleLock();
      }
    } catch (cause) {
      return this.failure(input.operation, cause);
    }
  }

  private assertMeasurementActor(actor: OperateActorV2, expectedOwnerActorId?: string): void {
    if (
      actor.kind !== 'human' ||
      actor.runtime !== 'openplanr' ||
      !actor.actorId ||
      (expectedOwnerActorId !== undefined && actor.actorId !== expectedOwnerActorId)
    ) {
      throw new MeasurementScheduleError(
        'E_MEASUREMENT_OWNER_REQUIRED',
        'Measurement custody requires the exact named human owner.',
      );
    }
  }

  private async assertCurrentMeasurementOwner(
    actor: OperateActorV2,
    expectedOwnerActorId?: string,
  ): Promise<void> {
    this.assertMeasurementActor(actor, expectedOwnerActorId);
    const runtime = await this.requiredRuntime();
    if (runtime.preferences.actorMemberships[actor.actorId]?.role !== 'owner') {
      throw new MeasurementScheduleError(
        'E_MEASUREMENT_OWNER_REQUIRED',
        'Measurement custody requires a current durable Operate owner.',
      );
    }
  }

  private async measurementService(): Promise<MeasurementScheduleService> {
    this.measurementPromise ??= this.composition().then((composition) =>
      createProjectMeasurementScheduleService(this.projectDir, composition),
    );
    return await this.measurementPromise;
  }

  private async composition(): Promise<OperateComposition> {
    this.compositionPromise ??= createOperateComposition();
    return await this.compositionPromise;
  }

  private async planningPreview(
    actionId: string,
    actor: OperateActorV2,
    framing?: JsonRecord,
  ): Promise<OperateApiEnvelopeV2> {
    const runtime = await this.requiredRuntime();
    const proposal = await previewOperatingPlanningSpec({
      projectDir: this.projectDir,
      runtimeRoot: this.root,
      runtime,
      actionId,
      actor: actor as { actorId: string; kind: 'human' },
      framing,
    });
    return operateSuccess('operate.planning.preview', proposal);
  }

  private async planningCreateSpec(
    proposalId: string,
    confirmDigest: string,
    actor: OperateActorV2,
  ): Promise<OperateApiEnvelopeV2> {
    const runtime = await this.requiredRuntime();
    const receipt = await createSpecForOperatingPlanning({
      projectDir: this.projectDir,
      runtimeRoot: this.root,
      runtime,
      proposalId,
      confirmDigest,
      actor: actor as { actorId: string; kind: 'human' },
    });
    return operateSuccess('operate.planning.create-spec', receipt);
  }

  private async planningIngestDelivery(
    evidence: OperateToolRequestMapV2['operate.planning.ingest-delivery'],
  ): Promise<OperateApiEnvelopeV2> {
    const runtime = await this.requiredRuntime();
    const composition = await this.composition();
    const result = await ingestPlanningDeliveryEvidence({
      projectDir: this.projectDir,
      runtime,
      composition,
      evidence,
    });
    const committed = result.replayed
      ? runtime
      : await this.store.commit(
          {
            baseState: runtime.baseState,
            state: result.runtime.state,
            events: result.runtime.events,
            artifacts: result.runtime.artifacts,
            preferences: runtime.preferences,
          },
          runtime.generation,
        );
    return operateSuccess('operate.planning.ingest-delivery', {
      deliveryEvidence: result.deliveryEvidence,
      evidenceRef: result.evidenceRef,
      assignment: result.assignment,
      eventHead: committed.state.eventHead,
      replayed: result.replayed,
    });
  }

  private async load(): Promise<OperateStoredRuntime | null> {
    await ensureOperateStorageLayout(this.projectDir);
    const composition = await this.composition();
    return await this.store.load(async ({ baseState, events, artifacts }) =>
      composition.replay(baseState, events, artifacts),
    );
  }

  private async event(
    runtime: OperateStoredRuntime,
    input: {
      type: string;
      entityId: string;
      cycleId: string;
      payload: unknown;
      correlationId: string;
      timestamp?: string;
      actor?: { kind: 'engine' | 'runtime' | 'human'; id: string };
      causationId?: string | null;
      requestHash?: string;
    },
  ): Promise<JsonRecord> {
    return (await this.composition()).createEvent(
      {
        eventId: id('evt'),
        timestamp: input.timestamp ?? timestamp(),
        cycleId: input.cycleId,
        type: input.type,
        entityId: input.entityId,
        actor: input.actor ?? { kind: 'engine', id: 'openplanr' },
        causationId:
          input.causationId ?? (runtime.events.at(-1)?.eventId as string | undefined) ?? null,
        correlationId: input.correlationId,
        ...(input.requestHash === undefined ? {} : { requestHash: input.requestHash }),
        payload: input.payload,
      },
      previousEvent(runtime),
    );
  }

  private async start(request: OperateStartRequestV2): Promise<OperateApiEnvelopeV2> {
    return (await startOperateCycle({
      request,
      projectDir: this.projectDir,
      composition: async () => await this.composition(),
      load: async () => await this.load(),
      createEvent: async (runtime, eventInput) => await this.event(runtime, eventInput),
      commit: async (next, expectedGeneration) => await this.store.commit(next, expectedGeneration),
      id,
      timestamp,
      cycleEnvelope: canonicalCycleEnvelope,
    })) as OperateApiEnvelopeV2;
  }

  private async get(
    cycleId: string,
    operation: 'operate.cycle.get' | 'operate.cycle.resume',
  ): Promise<OperateApiEnvelopeV2> {
    const runtime = await this.requiredRuntime();
    return canonicalCycleEnvelope(runtime, cycleId, operation);
  }

  private async claim(
    request: ClaimRequest,
  ): Promise<OperateApiEnvelopeV2<'operate.assignment.claim'>> {
    return (await claimOperateAssignment({
      root: this.root,
      request,
      issueFactory: replaySafeIssueFactory,
      requiredRuntime: async () => await this.requiredRuntime(),
      composition: async () => await this.composition(),
      commit: async (runtime, nextState, events) => await this.commit(runtime, nextState, events),
      refuse: (code, message, context = {}) => {
        throw new OperateClientError(code, message, false, context);
      },
    })) as OperateApiEnvelopeV2<'operate.assignment.claim'>;
  }

  private async submit(request: SubmitRequest): Promise<OperateApiEnvelopeV2> {
    return await submitOperateAssignment({
      root: this.root,
      request,
      issueFactory: replaySafeIssueFactory,
      requiredRuntime: async () => await this.requiredRuntime(),
      composition: async () => await this.composition(),
      createEvent: async (runtime, eventInput) => await this.event(runtime, eventInput),
      commit: async (next, expectedGeneration) => await this.store.commit(next, expectedGeneration),
    });
  }

  private async review(request: ReviewRequest): Promise<OperateApiEnvelopeV2> {
    const runtime = await this.requiredRuntime();
    return readOperateReview(runtime, request) as OperateApiEnvelopeV2;
  }

  private async submitReview(request: ReviewSubmitRequest): Promise<OperateApiEnvelopeV2> {
    return (await submitOperateReview({
      root: this.root,
      request,
      issueFactory: replaySafeIssueFactory,
      requiredRuntime: async () => await this.requiredRuntime(),
      commit: async (runtime, nextState, events) => await this.commit(runtime, nextState, events),
    })) as OperateApiEnvelopeV2;
  }

  private async artifact(request: ArtifactRequest): Promise<OperateApiEnvelopeV2> {
    const runtime = await this.requiredRuntime();
    const snapshot = state(runtime);
    const membership = runtime.preferences.actorMemberships[request.actor.actorId];
    return readOperatingArtifactV2(request as never, {
      initialState: snapshot as never,
      artifactStore: governedArtifactStore(runtime) as never,
      capabilities: ['operate.artifact.get'],
      scopeMembership:
        request.actor.kind === 'human' &&
        membership?.role === 'owner' &&
        membership.scopeId === request.scope.scopeId &&
        membership.domainId === request.scope.domainId &&
        membership.domainVersion === request.scope.domainVersion
          ? {
              active: true,
              actorId: request.actor.actorId,
              scopeId: membership.scopeId,
              domainId: membership.domainId,
              domainVersion: membership.domainVersion,
            }
          : null,
    }) as unknown as OperateApiEnvelopeV2;
  }

  private async experience(
    request: ExperienceRequest,
    selectedRuntime?: OperateStoredRuntime,
  ): Promise<OperateApiEnvelopeV2> {
    return await readOperateExperience({
      request,
      selectedRuntime,
      requiredRuntime: async () => await this.requiredRuntime(),
      composition: async () => await this.composition(),
    });
  }

  private governedActionDependencies(): GovernedActionDependencies {
    return {
      requiredRuntime: async () => await this.requiredRuntime(),
      composition: async () => await this.composition(),
      createEvent: async (runtime, eventInput) => await this.event(runtime, eventInput),
      commit: async (runtime, nextState, events) => await this.commit(runtime, nextState, events),
    };
  }

  private async approveAction(
    request: OperateToolRequestMapV2['operate.action.approve'],
  ): Promise<OperateApiEnvelopeV2> {
    return await approveOperateAction({ request, ...this.governedActionDependencies() });
  }

  private async executeAction(
    request: OperateToolRequestMapV2['operate.action.execute'],
  ): Promise<OperateApiEnvelopeV2> {
    return await executeOperateAction({
      request,
      containedTargets: this.containedTargets,
      ...this.governedActionDependencies(),
    });
  }

  private async rollbackAction(
    request: OperateToolRequestMapV2['operate.action.rollback'],
  ): Promise<OperateApiEnvelopeV2> {
    return await rollbackOperateAction({
      request,
      containedTargets: this.containedTargets,
      ...this.governedActionDependencies(),
    });
  }

  private async inspectRecovery(): Promise<OperateApiEnvelopeV2> {
    const composition = await this.composition();
    return (await inspectOperateRecovery({
      store: this.store,
      composition,
    })) as OperateApiEnvelopeV2;
  }

  private async restore(generation: string): Promise<OperateApiEnvelopeV2> {
    const composition = await this.composition();
    return (await restoreOperateGeneration({
      store: this.store,
      composition,
      generation,
    })) as OperateApiEnvelopeV2;
  }

  private async clearStaleLock(): Promise<OperateApiEnvelopeV2> {
    return (await clearOperateStaleLock(this.store)) as OperateApiEnvelopeV2;
  }

  private async requiredRuntime(): Promise<OperateStoredRuntime> {
    const runtime = await this.load();
    if (!runtime) {
      throw new OperateClientError(
        'CYCLE_NOT_FOUND',
        'No durable Operate lifecycle exists.',
        false,
      );
    }
    return runtime;
  }

  private async runtimeAtEventHead(
    runtime: OperateStoredRuntime,
    expectedEventHead: OperateEventHeadV2,
  ): Promise<OperateStoredRuntime> {
    const expected = expectedEventHead;
    if (
      !Number.isSafeInteger(expected.sequence) ||
      expected.sequence < 0 ||
      (expected.sequence === 0
        ? expected.hash !== null
        : !/^sha256:[a-f0-9]{64}$/u.test(String(expected.hash)))
    ) {
      throw new OperateClientError(
        'RESULT_CONTRACT_INVALID',
        'The historical operating Event head is malformed.',
        false,
      );
    }
    const currentHead = state(runtime).eventHead;
    if (expected.sequence > currentHead.sequence) {
      throw new OperateClientError(
        'CONCURRENT_MODIFICATION',
        'The requested historical operating Event head is not committed.',
        false,
      );
    }
    if (expected.sequence === currentHead.sequence) {
      if (expected.hash !== currentHead.hash) {
        throw new OperateClientError(
          'CONCURRENT_MODIFICATION',
          'The requested historical operating Event head has divergent custody.',
          false,
        );
      }
      return runtime;
    }

    const baseHead = record(runtime.baseState.eventHead);
    const baseSequence = Number(baseHead.sequence);
    if (
      !Number.isSafeInteger(baseSequence) ||
      baseSequence < 0 ||
      (baseSequence === 0
        ? baseHead.hash !== null
        : !/^sha256:[a-f0-9]{64}$/u.test(String(baseHead.hash))) ||
      expected.sequence < baseSequence ||
      (expected.sequence === baseSequence && expected.hash !== baseHead.hash)
    ) {
      throw new OperateClientError(
        'CONTRACT_VERSION_UNSUPPORTED',
        'The requested historical operating Event head predates retained replay custody.',
        false,
      );
    }
    const retainedEvents = runtime.events.filter(
      (event) => Number(event.sequence) <= expected.sequence,
    );
    if (expected.sequence === baseSequence) {
      return {
        ...runtime,
        state: structuredClone(runtime.baseState),
        events: [],
      };
    }
    const replayEvents = runtime.events.filter((event) => {
      const sequence = Number(event.sequence);
      return sequence > baseSequence && sequence <= expected.sequence;
    });
    const terminal = replayEvents.at(-1);
    if (
      replayEvents.length !== expected.sequence - baseSequence ||
      Number(terminal?.sequence) !== expected.sequence ||
      terminal?.eventHash !== expected.hash
    ) {
      throw new OperateClientError(
        'OPERATE_STORE_CORRUPT',
        'The retained Event ledger cannot reconstruct the requested historical head.',
        false,
      );
    }
    const historicalState = (await this.composition()).replay(
      runtime.baseState,
      replayEvents,
      runtime.artifacts,
    );
    if (
      historicalState.eventHead.sequence !== expected.sequence ||
      historicalState.eventHead.hash !== expected.hash
    ) {
      throw new OperateClientError(
        'OPERATE_STORE_CORRUPT',
        'Historical replay did not reproduce the exact requested Event head.',
        false,
      );
    }
    return {
      ...runtime,
      state: historicalState,
      events: structuredClone(retainedEvents),
    };
  }

  private async commit(
    runtime: OperateStoredRuntime,
    nextState: JsonRecord,
    events: JsonRecord[],
  ): Promise<OperateStoredRuntime> {
    return await this.store.commit(
      {
        baseState: runtime.baseState,
        state: nextState,
        events: [...runtime.events, ...events],
        artifacts: runtime.artifacts,
        preferences: runtime.preferences,
      },
      runtime.generation,
    );
  }

  private failure<Operation extends OperateToolNameV2>(
    operation: Operation,
    cause: unknown,
  ): OperateApiFailureV2<Operation> {
    const known = cause instanceof OperateClientError ? cause : null;
    const code = known?.code ?? errorCode(cause);
    return {
      ok: false,
      operation,
      error: {
        code,
        message:
          known?.message ??
          (cause instanceof Error
            ? cause.message
            : 'The requested operation could not be completed.'),
        retryable:
          known?.retryable ??
          Boolean((cause as { details?: { retryable?: unknown } })?.details?.retryable),
        context: known?.context ?? errorContext(cause),
      },
      allowedActions: code.startsWith('OPERATE_STORE_') ? [recoveryAction()] : [],
    };
  }
}

export function createOperateClient(projectDir: string): OperateClient {
  return new OperateClient(projectDir);
}
