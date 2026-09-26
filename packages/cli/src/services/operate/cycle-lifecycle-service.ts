import { assertProtocolArtifact } from 'planr-pipeline/protocol';
import { OperateClientError } from './client-error.js';
import type { OperateStartRequestV2 } from './client-types.js';
import type { JsonRecord, OperateComposition } from './composition.js';
import { prepareScreenedOperateEvidence } from './screened-evidence-service.js';
import {
  createEmptyOperatePreferences,
  type OperatePreferences,
  type OperateStore,
  type OperateStoredRuntime,
} from './store.js';

const PROTOCOL_VERSION = '2.0.0';

type CreateEvent = (
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
) => Promise<JsonRecord>;

type CycleEnvelope = (
  runtime: OperateStoredRuntime,
  cycleId: string,
  operation: 'operate.cycle.start' | 'operate.cycle.get' | 'operate.cycle.resume',
) => unknown;

function record(value: unknown): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OperateClientError(
      'RESULT_CONTRACT_INVALID',
      'The accepted lifecycle result is not a JSON object.',
      false,
    );
  }
  return value as JsonRecord;
}

/**
 * Own the complete Cycle bootstrap transaction: closed request validation, context capture,
 * screened evidence custody, intelligence planning, Assignment issuance, and one atomic commit.
 */
export async function startOperateCycle(input: {
  request: OperateStartRequestV2;
  projectDir: string;
  composition: () => Promise<OperateComposition>;
  load: () => Promise<OperateStoredRuntime | null>;
  createEvent: CreateEvent;
  commit: OperateStore['commit'];
  id: (prefix: string) => string;
  timestamp: () => string;
  cycleEnvelope: CycleEnvelope;
}): Promise<unknown> {
  const { request } = input;
  try {
    assertProtocolArtifact(
      'operate-tool-call',
      {
        kind: 'operate-tool-call',
        schemaVersion: '1.0.0',
        protocolVersion: PROTOCOL_VERSION,
        direction: 'request',
        operation: 'operate.cycle.start',
        request,
      },
      { protocolVersion: PROTOCOL_VERSION },
    );
  } catch {
    throw new OperateClientError(
      'RESULT_CONTRACT_INVALID',
      'Cycle start requires one exact closed scope, trigger, mode, Decision owner, and delivery route.',
      false,
    );
  }
  const composition = await input.composition();
  const domainDescriptor = composition.resolveDomain(
    request.scope.domainId,
    request.scope.domainVersion,
  );
  const existing = await input.load();
  const createdAt = input.timestamp();
  const baseState = existing?.baseState ?? composition.createEmptyState(createdAt);
  const priorState = existing?.state ?? baseState;
  const runtime: OperateStoredRuntime = existing ?? {
    generation: null,
    baseState,
    state: priorState,
    events: [],
    artifacts: new Map(),
    preferences: createEmptyOperatePreferences(),
  };
  const cycleId = input.id('cyc');
  const inputBindingId = input.id('inb');
  const sourceAssignmentId = input.id('asg');
  const targetAssignmentId = input.id('asg');
  const sourceArtifactId = input.id('art');
  const targetArtifactId = input.id('art');
  const contractVersions = { 'operating-artifact': PROTOCOL_VERSION };
  const cycle: JsonRecord = {
    kind: 'operating-cycle',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    cycleId,
    ...request.scope,
    state: 'advising',
    inputBindingId,
    contractVersions,
    trigger: request.trigger,
    focus: request.focus,
    health: 'normal',
    activeReviewId: null,
    createdAt,
    updatedAt: createdAt,
  };
  const inputBinding: JsonRecord = {
    kind: 'operating-cycle-input-binding',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    inputBindingId,
    cycleId,
    ...request.scope,
    sourceArtifactIds: [sourceArtifactId, targetArtifactId].sort(),
    runtimeBinding: { runtime: 'codex', adapterVersion: '2.0.0' },
    capturedAt: createdAt,
  };
  const bootstrapAssignments: JsonRecord[] = [
    { assignmentId: targetAssignmentId, roleId: 'context-evidence' },
    { assignmentId: sourceAssignmentId, roleId: 'context-manifest' },
  ].map(({ assignmentId, roleId }) => ({
    kind: 'operating-assignment',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    assignmentId,
    cycleId,
    assignmentKind: 'context-capture',
    roleId,
    mandate: null,
    analysisRubric: null,
    intelligenceContext: null,
    objective: 'Bind the exact project-local operating context before intelligence routing.',
    state: 'pending',
    dependsOn: [],
    dependencyPolicy: { kind: 'none' },
    inputArtifactIds: [],
    inputAbsences: [],
    outputContract: {
      schemaId: 'operating-context-capture',
      schemaVersion: PROTOCOL_VERSION,
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 262_144,
    },
    capabilityGrantId: null,
    governedOperationId: null,
    attemptPolicy: { maxAttempts: 3, attempt: 0, timeoutMs: 300_000 },
    claim: null,
    terminalOutcome: null,
    createdAt,
    availableAt: null,
    completedAt: null,
  }));
  const nextBaseState = {
    ...runtime.baseState,
    cycles: [...(runtime.baseState.cycles as JsonRecord[]), cycle],
    inputBindings: [...(runtime.baseState.inputBindings as JsonRecord[]), inputBinding],
  };
  const staged: OperateStoredRuntime = {
    ...runtime,
    baseState: nextBaseState,
    state: composition.replay(nextBaseState, runtime.events, runtime.artifacts),
  };
  const correlationId = input.id('corr');
  const binding = await input.createEvent(staged, {
    type: 'cycle.input-bound',
    entityId: inputBindingId,
    cycleId,
    correlationId,
    timestamp: createdAt,
    payload: { inputBindingId, ...request.scope, contractVersions },
  });
  const afterBinding = {
    ...staged,
    state: composition.reduce(staged.state, [binding], staged.artifacts),
    events: [...staged.events, binding],
  };
  const createdEvents: JsonRecord[] = [];
  let creationRuntime = afterBinding;
  for (const assignment of bootstrapAssignments) {
    const created = await input.createEvent(creationRuntime, {
      type: 'assignment.created',
      entityId: String(assignment.assignmentId),
      cycleId,
      correlationId,
      timestamp: createdAt,
      payload: assignment,
    });
    createdEvents.push(created);
    creationRuntime = {
      ...creationRuntime,
      state: composition.reduce(creationRuntime.state, [created], creationRuntime.artifacts),
      events: [...creationRuntime.events, created],
    };
  }
  const scheduled = composition.schedule(afterBinding.state, createdEvents);
  let working: OperateStoredRuntime = {
    ...afterBinding,
    state: scheduled.state,
    events: [...afterBinding.events, ...scheduled.events],
    artifacts: new Map(runtime.artifacts),
  };
  const acceptBootstrap = async (
    assignmentId: string,
    artifactId: string,
    artifactType: string,
    body: unknown,
  ) => {
    const actor = { actorId: 'openplanr', kind: 'agent' as const, runtime: 'openplanr' };
    const submissionId = input.id('sub');
    const correlationId = input.id('corr');
    const claimed = composition.claimAssignment(
      { assignmentId, actor },
      {
        claimId: input.id('clm'),
        submissionId,
        eventIds: { claimed: input.id('evt'), started: input.id('evt') },
        timestamp: createdAt,
        correlationId,
      },
      working.state,
    );
    working = {
      ...working,
      state: claimed.state,
      events: [...working.events, ...(claimed.events as JsonRecord[])],
    };
    const accepted = composition.acceptSubmission(
      {
        assignmentId,
        submissionId,
        actor,
        mediaType: 'application/json',
        encoding: 'utf-8',
        contentBase64: Buffer.from(JSON.stringify(body)).toString('base64'),
      },
      {
        artifactId,
        artifactType,
        inputArtifactIds: [],
        timestamp: createdAt,
        validatorVersion: 'openplanr-operate',
        correlationId,
        eventIds: {
          submitted: input.id('evt'),
          artifactCreated: input.id('evt'),
          validated: input.id('evt'),
        },
      },
      working.state,
      working.artifacts,
    );
    working = {
      ...working,
      state: accepted.state,
      events: [...working.events, ...(accepted.events as JsonRecord[])],
    };
    return accepted.artifact;
  };
  const targetArtifact = await acceptBootstrap(
    targetAssignmentId,
    targetArtifactId,
    'cycle-context-evidence',
    {
      kind: 'operating-context-capture',
      schemaVersion: '1.0.0',
      protocolVersion: PROTOCOL_VERSION,
      contextKind: 'cycle-evidence',
      scope: request.scope,
      focus: request.focus,
      trigger: request.trigger,
    },
  );
  const evidenceCandidate = {
    kind: 'operating-evidence-candidate',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    candidateId: input.id('evc'),
    ...request.scope,
    sourceArtifactId,
    evidenceKind: 'operate-artifact',
    locator: {
      artifactId: targetArtifactId,
      expectedArtifactType: targetArtifact.artifactType,
      expectedSchemaId: targetArtifact.schemaId,
      expectedSchemaVersion: targetArtifact.artifactSchemaVersion,
      expectedRawHash: targetArtifact.rawHash,
      expectedCanonicalHash: targetArtifact.canonicalHash,
    },
    provider: { id: 'local-operate-artifact-evidence-provider', version: PROTOCOL_VERSION },
    resolver: { id: 'local-operate-artifact-evidence-resolver', version: PROTOCOL_VERSION },
  };
  const screenedEvidence = await prepareScreenedOperateEvidence({
    projectDir: input.projectDir,
    scope: request.scope,
    sourceArtifactId,
    issueCandidateId: () => input.id('evc'),
  });
  const evidenceCandidates = [
    evidenceCandidate,
    ...screenedEvidence.map((prepared) => prepared.candidate),
  ];
  await acceptBootstrap(sourceAssignmentId, sourceArtifactId, 'cycle-context-manifest', {
    kind: 'operating-context-capture',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    contextKind: 'cycle-manifest',
    scope: request.scope,
    evidenceCandidates,
    evidenceClaimLinks: [],
  });
  const evidenceRefs: JsonRecord[] = [];
  for (const [index, candidate] of evidenceCandidates.entries()) {
    const draft = {
      resolutionId: input.id('evs'),
      eventId: input.id('evt'),
      timestamp: createdAt,
      correlationId: input.id('corr'),
      evidenceRefId: input.id('evr'),
      evidenceArtifactId: input.id('art'),
    };
    const prepared = index === 0 ? undefined : screenedEvidence[index - 1];
    const evidence = prepared
      ? composition.materializeScreenedEvidence(
          { candidate, claimLinks: [] },
          draft,
          working.state,
          working.artifacts,
          prepared.source,
        )
      : composition.materializeEvidence(
          { candidate, claimLinks: [] },
          draft,
          working.state,
          working.artifacts,
        );
    working = {
      ...working,
      state: evidence.state,
      events: [...working.events, ...(evidence.events as JsonRecord[])],
    };
    const evidenceRef = record(evidence.evidenceRef);
    if (typeof evidenceRef.evidenceRefId === 'string') evidenceRefs.push(evidenceRef);
  }
  const contextEvidenceRef = evidenceRefs.find(
    (candidate) => record(candidate.sourceContract).id === 'context-manifest',
  );
  if (!contextEvidenceRef) {
    throw new OperateClientError(
      'RESULT_CONTRACT_INVALID',
      'The runtime-owned Cycle context evidence could not be materialized.',
      false,
    );
  }
  const evidenceRefIds = evidenceRefs.map((candidate) => String(candidate.evidenceRefId));
  const objectiveId = input.id('obj');
  const metricId = input.id('met');
  const ownerActorId = request.ownerActorId;
  const collections = {
    objectives: [
      {
        kind: 'operating-objective',
        schemaVersion: '1.0.0',
        protocolVersion: PROTOCOL_VERSION,
        objectiveId,
        ...request.scope,
        title: `Improve ${request.focus[0] ?? 'the selected operating focus'}`,
        status: 'open',
        ownerActorId,
        horizon: 'next operating cycle',
        successCriteria: ['The declared target is observed through accepted evidence.'],
        metricIds: [metricId],
        evidenceRefIds: [contextEvidenceRef.evidenceRefId],
        sourceArtifactId,
        createdAt,
        updatedAt: createdAt,
      },
    ],
    metrics: [
      {
        kind: 'operating-metric',
        schemaVersion: '1.0.0',
        protocolVersion: PROTOCOL_VERSION,
        metricId,
        ...request.scope,
        title: `${request.focus[0] ?? 'Operating'} outcome`,
        unit: 'ratio',
        aggregation: 'latest',
        window: 'next operating cycle',
        target: 1,
        threshold: 0.5,
        observationIds: [],
        freshness: 'unknown',
        evidenceRefIds: [contextEvidenceRef.evidenceRefId],
        sourceArtifactId,
        createdAt,
        updatedAt: createdAt,
      },
    ],
    findings: [],
    decisions: [],
    actions: [],
    risks: [],
    assumptions: [],
  };
  const snapshot = composition.materializeSnapshot(
    {
      cycleId,
      scope: request.scope,
      domainContract: record(domainDescriptor.domainContract),
      sourceArtifactIds: [sourceArtifactId],
      evidenceRefIds,
      sourceRevisions: [{ sourceArtifactId, revision: 'start-v1', evidenceRefIds }],
      collections,
    },
    {
      snapshotId: input.id('snp'),
      stateId: input.id('oms'),
      timestamp: createdAt,
      correlationId: input.id('corr'),
      eventIds: { snapshot: input.id('evt'), state: input.id('evt') },
    },
    working.state,
    working.artifacts,
  );
  working = {
    ...working,
    state: snapshot.state,
    events: [...working.events, ...(snapshot.events as JsonRecord[])],
  };
  const snapshotRecord = record(snapshot.snapshot);
  const operatingState = record(snapshot.operatingState);
  const delta = composition.deriveDelta(
    { cycleId, snapshotId: snapshotRecord.snapshotId, stateId: operatingState.stateId },
    {
      deltaId: input.id('dlt'),
      eventId: input.id('evt'),
      timestamp: createdAt,
      correlationId: input.id('corr'),
    },
    working.state,
  );
  working = {
    ...working,
    state: delta.state,
    events: [...working.events, ...(delta.events as JsonRecord[])],
  };
  const requestedFocus = request.focus.length > 0 ? request.focus : ['all'];
  const routedFocus = [...new Set(requestedFocus)];
  const board = composition.planBoard(
    {
      cycleId,
      snapshotId: snapshotRecord.snapshotId,
      stateId: operatingState.stateId,
      deltaId: record(delta.delta).deltaId,
      focus: routedFocus.length > 0 ? routedFocus.sort() : ['standard'],
      domainDescriptor,
      decisionOwnerActorId: ownerActorId,
    },
    { eventId: input.id('evt'), timestamp: createdAt, correlationId: input.id('corr') },
    working.state,
    working.artifacts,
  );
  working = {
    ...working,
    state: board.state,
    events: [...working.events, ...(board.events as JsonRecord[])],
  };
  const roleAssignments = Object.fromEntries(
    board.assignments.map((assignment) => [
      String(assignment.roleId),
      String(assignment.assignmentId),
    ]),
  );
  const assignmentArtifacts = Object.fromEntries(
    board.assignments.map((assignment) => [String(assignment.assignmentId), input.id('art')]),
  );
  const preferences: OperatePreferences = {
    ...runtime.preferences,
    selectedScopeId: request.scope.scopeId,
    selectedDomainId: request.scope.domainId,
    selectedDomainVersion: request.scope.domainVersion,
    lastCycleId: cycleId,
    reviewOwners: {
      ...runtime.preferences.reviewOwners,
      [cycleId]: ownerActorId,
    },
    cycleModes: { ...runtime.preferences.cycleModes, [cycleId]: 'lifecycle' },
    cycleDeliveryRoutes: {
      ...runtime.preferences.cycleDeliveryRoutes,
      [cycleId]: request.deliveryRoute ?? 'observe-only',
    },
    assignmentArtifactIds: {
      ...runtime.preferences.assignmentArtifactIds,
      ...assignmentArtifacts,
    },
    cycleRoleAssignments: {
      ...runtime.preferences.cycleRoleAssignments,
      [cycleId]: roleAssignments,
    },
    cycleIntelligencePlanIds: {
      ...runtime.preferences.cycleIntelligencePlanIds,
      [cycleId]: String((board.plan as JsonRecord).planId),
    },
    actorMemberships: {
      ...runtime.preferences.actorMemberships,
      [ownerActorId]: { actorId: ownerActorId, ...request.scope, role: 'owner' },
    },
  };
  const committed = await input.commit(
    {
      baseState: nextBaseState,
      state: working.state,
      events: working.events,
      artifacts: working.artifacts,
      preferences,
    },
    runtime.generation,
  );
  return input.cycleEnvelope(committed, cycleId, 'operate.cycle.start');
}
