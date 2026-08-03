import { PipelineError } from '../pipeline/errors.mjs';
import { assertProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';

function sagaError(message) {
  return new PipelineError('E_ECOSYSTEM_SAGA_INVALID', message);
}

const SUCCESSFUL_SAGA_STEP_STATUSES = new Set(['completed', 'skipped']);
const RELEASE_PARTICIPANT_PROGRESS = new Map([
  ['pending', 0],
  ['preparing', 1],
  ['prepared', 2],
  ['promoting', 3],
  ['verified', 4],
  ['completed', 5],
]);

function assertUniqueIds(records, label) {
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.id)) throw sagaError(`${label} IDs must be unique; duplicate "${record.id}".`);
    ids.add(record.id);
  }
}

function normalizeSteps(steps) {
  return steps.map((step) => ({
    ...structuredClone(step),
    dependsOn: [...(step.dependsOn ?? [])].sort(),
    idempotencyKey: step.idempotencyKey,
    status: step.status ?? 'pending',
    attempts: step.attempts ?? 0,
    evidence: [...new Set(step.evidence ?? [])],
  }));
}

function assertSagaTopology(participants, steps) {
  assertUniqueIds(participants, 'Saga participant');
  assertUniqueIds(steps, 'Saga step');
  const participantIds = new Set(participants.map((participant) => participant.id));
  const stepIds = new Set(steps.map((step) => step.id));
  const idempotencyKeys = new Set(steps.map((step) => step.idempotencyKey));
  if (idempotencyKeys.size !== steps.length) throw sagaError('Saga step idempotency keys must be unique.');
  for (const step of steps) {
    if (!participantIds.has(step.participantId)) throw sagaError(`Unknown saga participant ${step.participantId}.`);
    for (const dependency of step.dependsOn ?? []) {
      if (!stepIds.has(dependency)) throw sagaError(`Unknown saga dependency ${dependency}.`);
      if (dependency === step.id) throw sagaError(`Saga step ${step.id} cannot depend on itself.`);
    }
  }
  const byId = new Map(steps.map((step) => [step.id, step]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (stepId) => {
    if (visiting.has(stepId)) throw sagaError(`Saga dependency cycle includes ${stepId}.`);
    if (visited.has(stepId)) return;
    visiting.add(stepId);
    for (const dependency of byId.get(stepId)?.dependsOn ?? []) visit(dependency);
    visiting.delete(stepId);
    visited.add(stepId);
  };
  for (const step of steps) visit(step.id);
}

function dependenciesSucceeded(step, stepsById) {
  return step.dependsOn.every((dependency) => (
    SUCCESSFUL_SAGA_STEP_STATUSES.has(stepsById.get(dependency)?.status)
  ));
}

export function createEcosystemSaga({
  id,
  subject,
  participants,
  steps,
  createdAt,
}) {
  assertSagaTopology(participants, steps);
  const saga = {
    kind: 'ecosystem-saga',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    id,
    subject,
    state: 'planned',
    createdAt,
    updatedAt: createdAt,
    participants: structuredClone(participants),
    steps: normalizeSteps(steps),
  };
  assertProtocolArtifact('ecosystem-saga', saga);
  return reconcileEcosystemSaga(saga, { updatedAt: createdAt });
}

export function nextEcosystemSagaSteps(saga) {
  assertProtocolArtifact('ecosystem-saga', saga);
  assertSagaTopology(saga.participants, saga.steps);
  const stepsById = new Map(saga.steps.map((step) => [step.id, step]));
  return saga.steps
    .filter((step) => ['pending', 'ready'].includes(step.status))
    .filter((step) => dependenciesSucceeded(step, stepsById))
    .map((step) => structuredClone(step))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function reconcileEcosystemSaga(saga, { updatedAt = saga.updatedAt } = {}) {
  assertProtocolArtifact('ecosystem-saga', saga);
  assertSagaTopology(saga.participants, saga.steps);
  const ready = new Set(nextEcosystemSagaSteps(saga).map((step) => step.id));
  const steps = saga.steps.map((step) => {
    if (step.status === 'pending' && ready.has(step.id)) return { ...step, status: 'ready' };
    if (step.status === 'ready' && !ready.has(step.id)) return { ...step, status: 'pending' };
    return { ...step };
  });
  const statuses = new Set(steps.map((step) => step.status));
  const state = statuses.has('failed')
    ? 'failed'
    : statuses.has('in-progress')
      ? 'in-progress'
      : steps.every((step) => ['completed', 'skipped', 'compensated'].includes(step.status))
        ? statuses.has('compensated') ? 'compensated' : 'completed'
        : steps.some((step) => step.status === 'ready')
          ? 'in-progress'
          : 'blocked';
  const next = { ...structuredClone(saga), state, updatedAt, steps };
  assertProtocolArtifact('ecosystem-saga', next);
  return next;
}

export function recordEcosystemSagaStep(saga, {
  stepId,
  status,
  evidence = [],
  error,
  completedAt,
}) {
  assertProtocolArtifact('ecosystem-saga', saga);
  assertSagaTopology(saga.participants, saga.steps);
  const allowed = {
    ready: ['in-progress', 'completed', 'failed', 'skipped'],
    'in-progress': ['completed', 'failed'],
    failed: ['ready', 'compensated'],
    completed: [],
    compensated: [],
    skipped: [],
    pending: [],
  };
  const step = saga.steps.find((entry) => entry.id === stepId);
  if (!step) throw sagaError(`Unknown saga step ${stepId}.`);
  if (step.status === status) {
    if (error && step.error && error !== step.error) {
      throw sagaError(`Conflicting replay for saga step ${stepId}.`);
    }
    if (completedAt && step.completedAt && completedAt !== step.completedAt) {
      throw sagaError(`Conflicting replay for saga step ${stepId}.`);
    }
    const steps = saga.steps.map((entry) => entry.id === stepId ? {
      ...entry,
      evidence: [...new Set([...entry.evidence, ...evidence])],
      ...(error && !entry.error ? { error } : {}),
      ...(completedAt && !entry.completedAt && ['completed', 'compensated'].includes(status)
        ? { completedAt }
        : {}),
    } : entry);
    return reconcileEcosystemSaga({ ...saga, steps }, { updatedAt: completedAt ?? saga.updatedAt });
  }
  if (!(allowed[step.status] ?? []).includes(status)) {
    throw sagaError(`Invalid saga step transition ${step.status} → ${status}.`);
  }
  const steps = saga.steps.map((entry) => {
    if (entry.id !== stepId) return entry;
    const next = {
      ...entry,
      status,
      attempts: status === 'in-progress' ? entry.attempts + 1 : entry.attempts,
      evidence: [...new Set([...entry.evidence, ...evidence])],
      ...(error ? { error } : {}),
      ...(completedAt && ['completed', 'compensated'].includes(status) ? { completedAt } : {}),
    };
    if (status === 'ready') {
      delete next.error;
      delete next.completedAt;
    }
    return next;
  });
  return reconcileEcosystemSaga({ ...saga, steps }, { updatedAt: completedAt ?? saga.updatedAt });
}

export function computeEcosystemReleaseOperationDigest(input) {
  return sha256Jcs({
    kind: 'ecosystem-release-plan',
    protocolVersion: '1.2.0',
    specId: input.specId,
    specDigest: input.specDigest,
    participants: [...input.participants]
      .map((participant) => ({
        id: participant.id,
        repository: participant.repository,
        repoLocalSpecId: participant.repoLocalSpecId,
        sourceVersion: participant.sourceVersion,
        targetVersion: participant.targetVersion,
        targetBranch: participant.targetBranch,
        tag: participant.tag,
        package: {
          name: participant.package.name,
          version: participant.package.version,
        },
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

export function createEcosystemReleaseOperation(input) {
  assertUniqueIds(input.participants, 'Release participant');
  const operationDigest = computeEcosystemReleaseOperationDigest(input);
  if (input.operationDigest && input.operationDigest !== operationDigest) {
    throw sagaError('Release operation digest does not match its immutable release plan.');
  }
  const operation = {
    ...structuredClone(input),
    kind: 'ecosystem-release-operation',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    operationDigest,
  };
  assertProtocolArtifact('ecosystem-release-operation', operation);
  assertReleaseOperationCoherence(operation, { allowDrafted: true });
  return operation;
}

function assertReleaseParticipantTransition(previous, next) {
  if (previous === next || previous === 'blocked') return;
  if (previous === 'compensated') {
    throw sagaError('A compensated release participant is terminal and cannot transition.');
  }
  if (previous === 'forward-fix') {
    if (!['verified', 'completed', 'blocked'].includes(next)) {
      throw sagaError(`Invalid release participant transition ${previous} → ${next}.`);
    }
    return;
  }
  if (['blocked', 'compensated', 'forward-fix'].includes(next)) return;
  const previousProgress = RELEASE_PARTICIPANT_PROGRESS.get(previous);
  const nextProgress = RELEASE_PARTICIPANT_PROGRESS.get(next);
  if (previousProgress === undefined || nextProgress === undefined || nextProgress < previousProgress) {
    throw sagaError(`Invalid release participant transition ${previous} → ${next}.`);
  }
}

function mergeObservedReleaseParticipant(participant, observation) {
  const nextState = observation.state ?? participant.state;
  assertReleaseParticipantTransition(participant.state, nextState);
  const observedPackage = observation.package ?? {};
  if (
    participant.package.tarballDigest
    && observedPackage.tarballDigest
    && participant.package.tarballDigest !== observedPackage.tarballDigest
  ) {
    throw sagaError(`Published tarball digest changed for release participant ${participant.id}.`);
  }
  const packageState = {
    ...participant.package,
    ...structuredClone(observedPackage),
    published: participant.package.published || observedPackage.published === true,
    tarballDigest: observedPackage.tarballDigest ?? participant.package.tarballDigest,
  };
  return {
    ...participant,
    ...structuredClone(observation),
    id: participant.id,
    state: nextState,
    pullRequest: observation.pullRequest
      ? { ...participant.pullRequest, ...structuredClone(observation.pullRequest) }
      : participant.pullRequest,
    package: packageState,
  };
}

function effectiveRecoveryMode(operation, participants) {
  return operation.recoveryMode === 'forward-fix-only'
    || participants.some((participant) => (
      participant.package.published || participant.state === 'forward-fix'
    ))
    ? 'forward-fix-only'
    : 'compensation-available';
}

function deriveReleaseOperationState(participants) {
  const states = new Set(participants.map((participant) => participant.state));
  if (states.has('forward-fix')) return 'forward-fix';
  if (states.has('blocked')) return 'blocked';
  if (states.has('compensated')) return 'compensating';
  if (participants.every((participant) => participant.state === 'completed')) return 'completed';
  if (participants.every((participant) => ['verified', 'completed'].includes(participant.state))) {
    return 'verified';
  }
  if (participants.every((participant) => ['promoting', 'verified', 'completed'].includes(participant.state))) {
    return 'promoting';
  }
  if (participants.every((participant) => (
    ['prepared', 'promoting', 'verified', 'completed'].includes(participant.state)
  ))) {
    return 'prepared';
  }
  return 'preparing';
}

function deriveReleaseNextSafeAction(participants, state) {
  if (state === 'completed') {
    return 'No further action; the ecosystem release operation is complete.';
  }
  const candidateStates = {
    preparing: ['pending', 'preparing'],
    prepared: ['prepared'],
    promoting: ['promoting'],
    verified: ['verified'],
    blocked: ['blocked'],
    compensating: ['compensated'],
    'forward-fix': ['forward-fix'],
  }[state] ?? [];
  const candidate = [...participants]
    .sort((a, b) => a.id.localeCompare(b.id))
    .find((participant) => candidateStates.includes(participant.state));
  if (!candidate) throw sagaError(`Cannot derive the next safe action for operation state ${state}.`);
  return candidate.nextSafeAction;
}

function assertReleaseParticipantCoherence(participant, recoveryMode) {
  if (participant.package.published) {
    if (!participant.package.name || !participant.package.version || !participant.package.tarballDigest) {
      throw sagaError(`Published release participant ${participant.id} requires package identity and tarball digest.`);
    }
    if (participant.state === 'compensated') {
      throw sagaError(`Published release participant ${participant.id} cannot be compensated.`);
    }
  }
  if (participant.state === 'forward-fix' && recoveryMode !== 'forward-fix-only') {
    throw sagaError(`Forward-fix participant ${participant.id} requires forward-fix-only recovery.`);
  }
}

function assertReleaseOperationCoherence(operation, {
  allowDrafted = false,
  requireDerivedAction = false,
} = {}) {
  assertUniqueIds(operation.participants, 'Release participant');
  const recoveryMode = effectiveRecoveryMode(operation, operation.participants);
  if (operation.recoveryMode !== recoveryMode) {
    throw sagaError('Release recovery mode conflicts with observed publication or forward-fix state.');
  }
  for (const participant of operation.participants) {
    assertReleaseParticipantCoherence(participant, recoveryMode);
  }
  if (allowDrafted && operation.state === 'drafted') {
    if (!operation.participants.every((participant) => participant.state === 'pending')) {
      throw sagaError('A drafted release operation requires every participant to be pending.');
    }
    if (operation.recoveryMode !== 'compensation-available') {
      throw sagaError('A drafted release operation cannot start in forward-fix-only recovery.');
    }
    return;
  }
  const expectedState = deriveReleaseOperationState(operation.participants);
  if (operation.state !== expectedState) {
    throw sagaError(`Release operation state ${operation.state} conflicts with participant state ${expectedState}.`);
  }
  if (
    requireDerivedAction
    && operation.nextSafeAction !== deriveReleaseNextSafeAction(operation.participants, operation.state)
  ) {
    throw sagaError('Release operation next safe action is not derived from its current participant state.');
  }
}

export function reconcileEcosystemReleaseOperation(operation, observedParticipants, {
  updatedAt = operation.updatedAt,
} = {}) {
  assertProtocolArtifact('ecosystem-release-operation', operation);
  assertUniqueIds(operation.participants, 'Release participant');
  const observedIds = new Set();
  for (const participant of observedParticipants) {
    if (observedIds.has(participant.id)) throw sagaError(`Duplicate observed release participant ${participant.id}.`);
    observedIds.add(participant.id);
    if (!operation.participants.some((entry) => entry.id === participant.id)) {
      throw sagaError(`Unknown observed release participant ${participant.id}.`);
    }
  }
  const observed = new Map(observedParticipants.map((participant) => [participant.id, participant]));
  const participants = operation.participants.map((participant) => (
    observed.has(participant.id)
      ? mergeObservedReleaseParticipant(participant, observed.get(participant.id))
      : structuredClone(participant)
  ));
  if (computeEcosystemReleaseOperationDigest({ ...operation, participants }) !== operation.operationDigest) {
    throw sagaError('Observed release state changed the digest-bound release plan.');
  }
  const recoveryMode = effectiveRecoveryMode(operation, participants);
  for (const participant of participants) {
    assertReleaseParticipantCoherence(participant, recoveryMode);
  }
  const state = deriveReleaseOperationState(participants);
  const nextSafeAction = deriveReleaseNextSafeAction(participants, state);
  const {
    blockedReason,
    ...operationWithoutBlockedReason
  } = structuredClone(operation);
  const next = {
    ...operationWithoutBlockedReason,
    participants,
    state,
    recoveryMode,
    updatedAt,
    nextSafeAction,
    ...(state === 'blocked' && blockedReason ? { blockedReason } : {}),
  };
  assertProtocolArtifact('ecosystem-release-operation', next);
  assertReleaseOperationCoherence(next, { requireDerivedAction: true });
  return next;
}
