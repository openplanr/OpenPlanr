import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { assertProtocolArtifact } from '@openplanr/protocol/contracts';
import { PipelineError } from '@openplanr/protocol/errors';
import { deriveOperatingIntelligenceAssignmentIdV2 } from './scheduler-v2.mjs';
import {
  assertOperatingTraceMatrixV2,
  buildOperatingTraceMatrixV2,
  deriveOperatingOmittedRoleAbsenceIdV2,
} from './trace-matrix-v2.mjs';

const PROTOCOL_VERSION = '2.0.0';

function fail(code, message, context = {}) {
  throw new PipelineError(code, message, '', { retryable: false, context });
}

function clone(value) {
  return structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

function without(value, ...fields) {
  const omitted = new Set(fields);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key)));
}

function exactKeys(value, keys, subject) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')
  ) {
    fail('E_OPERATE_BOARD_REQUEST_INVALID', `${subject} must contain only its closed fields.`);
  }
}

function shortIdentity(prefix, value) {
  return `${prefix}_${sha256Jcs(value).slice(7, 39)}`;
}

function isLexicallySorted(values) {
  return values.every((value, index) => index === 0 || values[index - 1].localeCompare(value) < 0);
}

function boardSemanticValue(board) {
  return {
    scopeId: board.scopeId,
    domainId: board.domainId,
    domainVersion: board.domainVersion,
    cycleId: board.cycleId,
    planId: board.planId,
    ledgerId: board.ledgerId,
    reviewId: board.reviewId,
    reviewHash: board.reviewHash,
    seatBindings: board.seatBindings,
    findingIds: board.findingIds,
    decisionIds: board.decisionIds,
    actionIds: board.actionIds,
    trace: without(board.traceMatrix, 'matrixId', 'eventHead', 'matrixHash'),
  };
}

function acceptedArtifactId(state, assignment) {
  const accepted = state.submissions.filter(
    (submission) =>
      submission.assignmentId === assignment.assignmentId &&
      submission.cycleId === assignment.cycleId &&
      submission.state === 'accepted' &&
      typeof submission.artifactId === 'string',
  );
  if (accepted.length > 1) {
    fail(
      'E_OPERATE_BOARD_BINDING_INVALID',
      'Executive Board seat has more than one accepted Artifact.',
      {
        assignmentId: assignment.assignmentId,
      },
    );
  }
  if (accepted.length === 0) return null;
  const artifact = state.artifacts.find(({ artifactId }) => artifactId === accepted[0].artifactId);
  if (
    !artifact ||
    artifact.assignmentId !== assignment.assignmentId ||
    artifact.rawHash !== accepted[0].rawHash ||
    artifact.canonicalHash !== accepted[0].canonicalHash ||
    assignment.state !== 'validated'
  ) {
    fail(
      'E_OPERATE_BOARD_BINDING_INVALID',
      'Executive Board seat lost its exact accepted Artifact custody.',
      {
        assignmentId: assignment.assignmentId,
      },
    );
  }
  return artifact.artifactId;
}

function resolveBoardSources(state, { cycleId, planId, ledgerId }) {
  const cycles = state.cycles.filter((entry) => entry.cycleId === cycleId);
  const plans = (state.intelligencePlans ?? []).filter((entry) => entry.planId === planId);
  const ledgers = (state.decisionLedgers ?? []).filter((entry) => entry.ledgerId === ledgerId);
  if (cycles.length !== 1 || plans.length !== 1 || ledgers.length !== 1) {
    fail(
      'E_OPERATE_BOARD_BINDING_INVALID',
      'Executive Board requires one exact Cycle, intelligence plan, and Chair ledger.',
      {
        cycleId,
        planId,
        ledgerId,
      },
    );
  }
  const [cycle] = cycles;
  const [plan] = plans;
  const [ledger] = ledgers;
  if (
    cycle.domainId !== 'business' ||
    plan.scopeId !== cycle.scopeId ||
    plan.domainId !== cycle.domainId ||
    plan.domainVersion !== cycle.domainVersion ||
    ledger.scopeId !== cycle.scopeId ||
    ledger.domainId !== cycle.domainId ||
    ledger.domainVersion !== cycle.domainVersion ||
    ledger.intelligencePlanId !== plan.planId
  ) {
    fail(
      'E_OPERATE_BOARD_FOREIGN_SCOPE',
      'Executive Board sources cross a Cycle, scope, domain, or plan boundary.',
      {
        cycleId,
        planId,
        ledgerId,
      },
    );
  }
  return { cycle, plan, ledger };
}

function seatBindings(state, cycle, plan) {
  const assignments = new Map(
    state.assignments
      .filter((entry) => entry.cycleId === cycle.cycleId)
      .map((entry) => [entry.assignmentId, entry]),
  );
  return [
    ...plan.selectedRoles.map((role) => [role, false]),
    ...plan.omittedRoles.map((role) => [role, true]),
  ]
    .map(([role, omitted]) => {
      const assignmentId = !omitted
        ? deriveOperatingIntelligenceAssignmentIdV2(plan.planId, role.roleId, role.roleVersion)
        : null;
      const assignment = assignmentId === null ? null : assignments.get(assignmentId);
      if (
        assignmentId !== null &&
        (!assignment ||
          assignment.roleId !== role.roleId ||
          assignment.roleVersion !== role.roleVersion)
      ) {
        fail(
          'E_OPERATE_BOARD_BINDING_INVALID',
          'Executive Board selected seat lost its exact Assignment.',
          {
            planId: plan.planId,
            roleId: role.roleId,
          },
        );
      }
      const roleAbsences =
        assignment?.inputAbsences?.filter(
          (absence) => absence.kind === 'role' && absence.roleId === role.roleId,
        ) ?? [];
      if (roleAbsences.length > 1) {
        fail(
          'E_OPERATE_BOARD_BINDING_INVALID',
          'Executive Board seat has ambiguous role absence custody.',
          {
            assignmentId,
            roleId: role.roleId,
          },
        );
      }
      return {
        roleId: role.roleId,
        roleKind: role.roleKind,
        roleVersion: role.roleVersion,
        assignmentId,
        artifactId: assignment ? acceptedArtifactId(state, assignment) : null,
        absenceId: omitted
          ? deriveOperatingOmittedRoleAbsenceIdV2(plan.planId, role.roleId, role.roleVersion)
          : (roleAbsences[0]?.absenceId ?? null),
      };
    })
    .sort((left, right) => left.roleId.localeCompare(right.roleId));
}

/**
 * Build either the stored materialized record or the same closed compatibility
 * record. Compatibility is always non-authoritative and has no Event identity.
 */
export function buildOperatingExecutiveBoardRecordV2(
  state,
  {
    cycleId,
    planId,
    ledgerId,
    reviewId,
    reviewHash,
    projectionMode,
    materializedEventId,
    createdAt,
    eventHead = state?.eventHead,
    accessLevel = 'restricted',
  } = {},
) {
  assertProtocolArtifact('operating-runtime-state', state, { protocolVersion: PROTOCOL_VERSION });
  const { cycle, plan } = resolveBoardSources(state, { cycleId, planId, ledgerId });
  if (
    !['materialized', 'compatibility'].includes(projectionMode) ||
    (projectionMode === 'materialized' &&
      (typeof materializedEventId !== 'string' || materializedEventId.length === 0)) ||
    (projectionMode === 'compatibility' && materializedEventId !== null) ||
    typeof reviewId !== 'string' ||
    reviewId.length === 0 ||
    !/^sha256:[a-f0-9]{64}$/u.test(reviewHash ?? '') ||
    typeof createdAt !== 'string' ||
    Number.isNaN(Date.parse(createdAt))
  ) {
    fail(
      'E_OPERATE_BOARD_REQUEST_INVALID',
      'Executive Board projection mode, Review, Event, or timestamp is invalid.',
    );
  }
  const traceMatrix = buildOperatingTraceMatrixV2(state, {
    cycleId,
    planId,
    accessLevel,
    eventHead,
  });
  const base = {
    kind: 'operating-executive-board',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    boardId: shortIdentity('xbr', { cycleId, planId, ledgerId, reviewId }),
    scopeId: cycle.scopeId,
    domainId: cycle.domainId,
    domainVersion: cycle.domainVersion,
    cycleId,
    planId,
    ledgerId,
    reviewId,
    reviewHash,
    projectionMode,
    authoritativeForMutation: projectionMode === 'materialized',
    sourceEventHead: clone(eventHead),
    materializedEventId,
    seatBindings: seatBindings(state, cycle, plan),
    findingIds: (state.findings ?? [])
      .filter((entry) => entry.sourceCycleId === cycleId)
      .map(({ findingId }) => findingId)
      .sort(),
    decisionIds: (state.decisions ?? [])
      .filter((entry) => entry.sourceCycleId === cycleId)
      .map(({ decisionId }) => decisionId)
      .sort(),
    actionIds: (state.actions ?? [])
      .filter((entry) => entry.sourceCycleId === cycleId)
      .map(({ actionId }) => actionId)
      .sort(),
    traceMatrix,
    createdAt,
  };
  const semanticHash = sha256Jcs(boardSemanticValue(base));
  const board = { ...base, semanticHash };
  board.boardHash = sha256Jcs(board);
  assertOperatingExecutiveBoardV2(board);
  return freeze(board);
}

export function assertOperatingExecutiveBoardV2(value, { materializedOnly = false } = {}) {
  assertProtocolArtifact('operating-executive-board', value, { protocolVersion: PROTOCOL_VERSION });
  if (
    !value ||
    value.kind !== 'operating-executive-board' ||
    value.schemaVersion !== '1.0.0' ||
    value.protocolVersion !== PROTOCOL_VERSION ||
    !['materialized', 'compatibility'].includes(value.projectionMode) ||
    value.authoritativeForMutation !== (value.projectionMode === 'materialized') ||
    (value.projectionMode === 'materialized') !== (typeof value.materializedEventId === 'string') ||
    (materializedOnly && value.projectionMode !== 'materialized')
  ) {
    fail(
      'E_OPERATE_BOARD_CONTRACT_INVALID',
      'Executive Board record has an invalid closed projection variant.',
    );
  }
  assertOperatingTraceMatrixV2(value.traceMatrix);
  if (
    value.traceMatrix.scopeId !== value.scopeId ||
    value.traceMatrix.domainId !== value.domainId ||
    value.traceMatrix.domainVersion !== value.domainVersion ||
    value.traceMatrix.cycleId !== value.cycleId ||
    value.traceMatrix.eventHead.sequence !== value.sourceEventHead?.sequence ||
    value.traceMatrix.eventHead.hash !== value.sourceEventHead?.hash
  ) {
    fail(
      'E_OPERATE_BOARD_BINDING_INVALID',
      'Executive Board and trace matrix lost their exact scope, Cycle, or Event-head binding.',
    );
  }
  if (value.semanticHash !== sha256Jcs(boardSemanticValue(value))) {
    fail(
      'E_OPERATE_BOARD_HASH_MISMATCH',
      'Executive Board semantic hash does not equal its canonical source identities.',
    );
  }
  if (value.boardHash !== sha256Jcs(without(value, 'boardHash'))) {
    fail(
      'E_OPERATE_BOARD_HASH_MISMATCH',
      'Executive Board hash does not equal its canonical content.',
    );
  }
  const roles = value.seatBindings?.map(({ roleId }) => roleId) ?? [];
  if (
    new Set(roles).size !== roles.length ||
    value.seatBindings.some(({ roleId }) => typeof roleId !== 'string' || roleId.length === 0) ||
    !isLexicallySorted(roles) ||
    !isLexicallySorted(value.findingIds) ||
    !isLexicallySorted(value.decisionIds) ||
    !isLexicallySorted(value.actionIds)
  ) {
    fail(
      'E_OPERATE_BOARD_BINDING_INVALID',
      'Executive Board identities must be unique and builder-canonically ordered.',
    );
  }
  return value;
}

/**
 * Prepare the pipeline-owned Event that OpenPlanr composes immediately before
 * review.created. The returned value is pure and does not reduce or persist.
 */
export function createOperatingExecutiveBoardMaterializationV2(
  request,
  draft,
  { initialState } = {},
) {
  exactKeys(request, ['cycleId', 'planId', 'ledgerId', 'review'], 'Executive Board request');
  exactKeys(draft, ['eventId', 'timestamp', 'correlationId'], 'Executive Board draft');
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  assertProtocolArtifact('operating-review', request.review, { protocolVersion: PROTOCOL_VERSION });
  const review = request.review;
  if (
    review.cycleId !== request.cycleId ||
    review.subject?.type === 'action' ||
    review.state !== 'pending' ||
    review.disposition !== null ||
    review.workDispositions.length !== 0 ||
    review.createdAt !== draft.timestamp ||
    review.updatedAt !== draft.timestamp
  ) {
    fail(
      'E_OPERATE_BOARD_BINDING_INVALID',
      'Executive Board requires the exact following pending Cycle Review bytes.',
      {
        cycleId: request.cycleId,
        reviewId: review?.reviewId ?? null,
      },
    );
  }
  const ledgerEvents = initialState.eventReplayIndex.filter(
    (entry) => entry.type === 'decision-ledger.materialized' && entry.entityId === request.ledgerId,
  );
  if (ledgerEvents.length !== 1) {
    fail(
      'E_OPERATE_BOARD_BINDING_INVALID',
      'Executive Board requires one exact decision-ledger materialization Event.',
      {
        ledgerId: request.ledgerId,
        eventCount: ledgerEvents.length,
      },
    );
  }
  const board = buildOperatingExecutiveBoardRecordV2(initialState, {
    cycleId: request.cycleId,
    planId: request.planId,
    ledgerId: request.ledgerId,
    reviewId: review.reviewId,
    reviewHash: sha256Jcs(review),
    projectionMode: 'materialized',
    materializedEventId: draft.eventId,
    createdAt: draft.timestamp,
    eventHead: initialState.eventHead,
  });
  const event = {
    kind: 'operating-event',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    eventId: draft.eventId,
    sequence: initialState.eventHead.sequence + 1,
    timestamp: draft.timestamp,
    cycleId: request.cycleId,
    type: 'executive-board.materialized',
    entityId: board.boardId,
    actor: { kind: 'runtime', id: 'openplanr' },
    causationId: ledgerEvents[0].eventId,
    correlationId: draft.correlationId,
    previousEventHash: initialState.eventHead.hash,
    payload: clone(board),
  };
  event.eventHash = sha256Jcs(event);
  assertProtocolArtifact('operating-event', event, { protocolVersion: PROTOCOL_VERSION });
  return freeze({ board: clone(board), event });
}
