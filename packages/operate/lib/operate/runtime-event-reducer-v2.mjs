import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { assertProtocolArtifact } from '@openplanr/protocol/contracts';
import { OPERATE_CONTRACT_CATALOG_V2 } from '@openplanr/protocol/operate-contract-catalog-v2';
import { buildOperatingTerminalVerificationAssignmentV2 } from './execution-verification-v2.mjs';
import {
  assertOperatingAssignmentAvailabilityPayloadV2,
  assertOperatingAssignmentTerminalPayloadV2,
  assertOperatingValidatedDependencyProofV2,
  resolveOperatingAssignmentInputAbsencesV2,
  resolveOperatingAssignmentInputArtifactIdsV2,
} from './scheduler-v2.mjs';

const PROTOCOL_VERSION = '2.0.0';
const clone = (value) => structuredClone(value);
const compiledAssignmentTransition = (from, to) =>
  OPERATE_CONTRACT_CATALOG_V2.transitions.find(
    (transition) =>
      transition.entityId === 'operating-assignment' &&
      transition.from === from &&
      transition.to === to,
  ) ?? null;
const EVENT_HANDLER_TYPES = Object.freeze({
  assignment: Object.freeze([
    'assignment.created',
    'assignment.available',
    'assignment.claimed',
    'assignment.started',
    'assignment.submitted',
    'artifact.created',
    'assignment.validated',
    'assignment.rejected',
    'assignment.abandoned',
    'assignment.failed',
  ]),
  workflow: Object.freeze([
    'cycle.input-bound',
    'executive-board.materialized',
    'review.created',
    'review.submitted',
    'work-change-set.materialized',
    'action.authority-promoted',
    'action.approved',
    'action.rejected',
    'action.deferred',
    'action.reopened',
    'action.queued',
    'action.started',
    'action.completed',
    'action.blocked',
    'action.cancelled',
    'cycle.approved',
    'cycle.executing',
    'cycle.verifying',
    'cycle.closed',
  ]),
  intelligence: Object.freeze([
    'evidence.resolved',
    'planning-delivery.ingested',
    'evidence.rejected',
    'snapshot.materialized',
    'operating-state.materialized',
    'metric.observed',
    'claim.recorded',
    'finding.recorded',
    'risk.recorded',
    'assumption.recorded',
    'decision.revised',
    'delta.derived',
    'intelligence.plan-recorded',
    'decision-ledger.materialized',
    'verification.plan-recorded',
    'outcome.recorded',
    'learning.recorded',
    'scenario.recorded',
    'trigger.recorded',
  ]),
  authority: Object.freeze([
    'policy.evaluated',
    'approval.recorded',
    'capability.availability-recorded',
    'capability.granted',
    'rollback.plan-recorded',
    'operation.intent-recorded',
    'execution.result-recorded',
    'rollback.result-recorded',
  ]),
});
const EVENT_HANDLER_NAME_BY_TYPE = Object.freeze(
  Object.fromEntries(
    Object.entries(EVENT_HANDLER_TYPES).flatMap(([handlerName, eventTypes]) =>
      eventTypes.map((eventType) => [eventType, handlerName]),
    ),
  ),
);

/**
 * Private deterministic Event reducer. Assignment lifecycle rules live here;
 * the still-bounded workflow/intelligence/authority handlers are injected so
 * the public runtime facade can retain one stable API during consolidation.
 */
export function createOperatingRuntimeEventReducerV2({
  runtimeError,
  computeEventHash,
  verifyEventChain,
  indexRuntimeState,
  transitionAssignment,
  eventHandlers,
  materializeRuntimeState,
  createEmptyState,
  createNoModelReplayHook,
}) {
  const dependencies = [
    runtimeError,
    computeEventHash,
    verifyEventChain,
    indexRuntimeState,
    transitionAssignment,
    materializeRuntimeState,
    createEmptyState,
    createNoModelReplayHook,
  ];
  if (dependencies.some((dependency) => typeof dependency !== 'function')) {
    throw new TypeError('Event reducer dependencies must be functions.');
  }
  if (
    !eventHandlers ||
    Object.keys(EVENT_HANDLER_TYPES)
      .filter((handlerName) => handlerName !== 'assignment')
      .some((handlerName) => typeof eventHandlers[handlerName] !== 'function')
  ) {
    throw new TypeError('Event reducer requires every remaining named domain Event handler.');
  }

  function requireAssignment(index, event) {
    const assignmentId = event.payload?.assignmentId ?? event.entityId;
    const assignment = index.assignments.get(assignmentId);
    if (!assignment) {
      throw runtimeError(
        'ASSIGNMENT_NOT_AVAILABLE',
        `${event.type} references unknown assignment ${assignmentId}.`,
        { assignmentId },
      );
    }
    if (event.entityId !== assignmentId) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        `${event.type} entityId does not match assignmentId.`,
        {
          assignmentId,
          entityId: event.entityId,
        },
      );
    }
    if (assignment.cycleId !== event.cycleId) {
      throw runtimeError('STATE_TRANSITION_INVALID', `${event.type} crosses cycle boundaries.`, {
        assignmentId,
        cycleId: event.cycleId,
      });
    }
    return assignment;
  }

  function setAssignment(index, event, nextState, patch = {}) {
    const assignment = requireAssignment(index, event);
    const transition = compiledAssignmentTransition(assignment.state, nextState);
    if (!transition || transition.event !== event.type) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        `${event.type} is not the compiled transition for Assignment ${assignment.assignmentId}.`,
        {
          assignmentId: assignment.assignmentId,
          from: assignment.state,
          to: nextState,
          event: event.type,
        },
      );
    }
    const next = transitionAssignment(assignment, nextState, patch);
    index.assignments.set(next.assignmentId, next);
    return next;
  }

  function requireSubmission(index, event, assignmentId) {
    const submission = index.submissions.get(event.payload.submissionId);
    if (
      !submission ||
      submission.assignmentId !== assignmentId ||
      submission.cycleId !== event.cycleId
    ) {
      throw runtimeError(
        'SUBMISSION_ID_CONFLICT',
        `${event.type} submission identity does not match the assignment.`,
        {
          assignmentId,
          submissionId: event.payload.submissionId,
        },
      );
    }
    return submission;
  }

  function dependencyValidationProof(index, assignment, dependencyId) {
    const dependency = index.assignments.get(dependencyId);
    if (!dependency) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        `Assignment ${assignment.assignmentId} references unknown dependency ${dependencyId}.`,
        {
          assignmentId: assignment.assignmentId,
          dependencyId,
        },
      );
    }
    if (dependency.cycleId !== assignment.cycleId || dependency.state !== 'validated') {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        `Dependency ${dependencyId} is not validated in cycle ${assignment.cycleId}.`,
        {
          assignmentId: assignment.assignmentId,
          dependencyId,
          dependencyCycleId: dependency.cycleId,
          dependencyState: dependency.state,
        },
      );
    }
    const acceptedSubmissions = [...index.submissions.values()].filter(
      (submission) => submission.assignmentId === dependencyId && submission.state === 'accepted',
    );
    if (acceptedSubmissions.length !== 1) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        `Validated dependency ${dependencyId} must have exactly one accepted submission proof.`,
        {
          dependencyId,
          acceptedSubmissionCount: acceptedSubmissions.length,
        },
      );
    }
    const submission = acceptedSubmissions[0];
    const artifact = index.artifacts.get(submission.artifactId);
    const replay = index.replay.get(submission.submissionId);
    if (!artifact || !replay) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        `Validated dependency ${dependencyId} has no exact accepted replay proof.`,
        {
          dependencyId,
          submissionId: submission.submissionId,
        },
      );
    }
    try {
      return assertOperatingValidatedDependencyProofV2({
        assignment: dependency,
        submission,
        artifact,
        replay,
      });
    } catch (error) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        error.message,
        error.details ?? {
          dependencyId,
          submissionId: submission.submissionId,
        },
      );
    }
  }

  function applyAssignmentRuntimeEvent(index, event) {
    switch (event.type) {
      case 'assignment.created': {
        if (
          event.entityId !== event.payload.assignmentId ||
          event.cycleId !== event.payload.cycleId
        ) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'assignment.created identifiers do not match its record.',
          );
        }
        if (!index.cycles.has(event.cycleId)) {
          throw runtimeError('CYCLE_NOT_FOUND', `Unknown cycle ${event.cycleId}.`);
        }
        if (index.assignments.has(event.entityId)) {
          throw runtimeError(
            'CONCURRENT_MODIFICATION',
            `Assignment ${event.entityId} already exists.`,
          );
        }
        if (
          event.payload.state !== 'pending' ||
          event.payload.availableAt !== null ||
          event.payload.completedAt !== null ||
          event.payload.claim !== null ||
          event.payload.terminalOutcome !== null ||
          event.payload.attemptPolicy.attempt !== 0 ||
          (event.payload.dependencyPolicy.kind === 'none' &&
            event.payload.dependsOn.length !== 0) ||
          (event.payload.dependencyPolicy.kind === 'all-required' &&
            event.payload.dependsOn.length === 0)
        ) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'Assignment creation must establish a new pending Assignment without lifecycle-transition data.',
            {
              assignmentId: event.payload.assignmentId,
            },
          );
        }
        if (event.payload.assignmentKind === 'verification') {
          if (
            ['operate-planning-delivery-verifier', 'operate-planning-decision-revisit'].includes(
              event.payload.roleId,
            ) &&
            event.payload.governedOperationId === null &&
            event.payload.capabilityGrantId === null
          ) {
            throw runtimeError(
              'RESULT_CONTRACT_INVALID',
              'Planning delivery verification Assignment must be created atomically by its dedicated ingestion Event.',
            );
          }
          const operation = index.governedOperations.get(event.payload.governedOperationId);
          const result =
            operation?.operationKind === 'rollback'
              ? index.rollbackResults.get(operation.resultId)
              : index.executionResults.get(operation?.resultId);
          const action = operation ? index.actions.get(operation.action.actionId) : null;
          const cycle = index.cycles.get(event.payload.cycleId);
          const verificationPlan = action
            ? index.verificationPlans.get(action.verificationPlanId)
            : null;
          let expected = null;
          try {
            expected = buildOperatingTerminalVerificationAssignmentV2({
              action,
              cycle,
              operation,
              result,
              verificationPlan,
              timestamp: event.timestamp,
            });
          } catch {
            expected = null;
          }
          if (!expected || sha256Jcs(expected) !== sha256Jcs(event.payload)) {
            throw runtimeError(
              'RESULT_CONTRACT_INVALID',
              'Verification Assignment must be deterministically owned by one existing plan and terminal operation result.',
              {
                assignmentId: event.payload.assignmentId,
                operationId: event.payload.governedOperationId,
              },
            );
          }
        }
        index.assignments.set(event.entityId, clone(event.payload));
        return;
      }
      case 'assignment.available': {
        const current = requireAssignment(index, event);
        try {
          for (const proof of event.payload.dependencyProofs) {
            if (proof.outcome !== 'validated') continue;
            const expected = dependencyValidationProof(index, current, proof.assignmentId);
            if (sha256Jcs(expected) !== sha256Jcs(proof)) {
              throw runtimeError(
                'STATE_TRANSITION_INVALID',
                'Assignment availability contains a forged dependency proof.',
                {
                  assignmentId: current.assignmentId,
                  dependencyId: proof.assignmentId,
                },
              );
            }
          }
          assertOperatingAssignmentAvailabilityPayloadV2(current, event.payload, {
            assignments: [...index.assignments.values()],
            submissions: [...index.submissions.values()],
            artifacts: [...index.artifacts.values()],
            submissionReplayIndex: [...index.replay.values()],
            intelligencePlans: [...index.intelligencePlans.values()],
          });
        } catch (error) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            error.message,
            error.details ?? {
              assignmentId: current.assignmentId,
            },
          );
        }
        setAssignment(index, event, 'available', {
          availableAt: event.timestamp,
          inputArtifactIds: resolveOperatingAssignmentInputArtifactIdsV2(
            current,
            event.payload.dependencyProofs,
          ),
          inputAbsences: resolveOperatingAssignmentInputAbsencesV2(current, {
            dependencyProofs: event.payload.dependencyProofs,
            assignments: [...index.assignments.values()],
            intelligencePlans: [...index.intelligencePlans.values()],
          }),
        });
        return;
      }
      case 'assignment.claimed': {
        const assignment = setAssignment(index, event, 'claimed', {
          claim: {
            actorId: event.payload.actorId,
            actorKind: event.payload.actorKind,
            runtime: event.payload.runtime,
            claimId: event.payload.claimId,
          },
        });
        if (index.submissions.has(event.payload.submissionId)) {
          throw runtimeError(
            'SUBMISSION_ID_CONFLICT',
            `Submission ${event.payload.submissionId} already exists.`,
          );
        }
        index.submissions.set(event.payload.submissionId, {
          kind: 'operating-submission',
          schemaVersion: '1.0.0',
          protocolVersion: PROTOCOL_VERSION,
          submissionId: event.payload.submissionId,
          assignmentId: assignment.assignmentId,
          cycleId: assignment.cycleId,
          state: 'issued',
          rawHash: null,
          canonicalHash: null,
          sizeBytes: null,
          artifactId: null,
          acceptanceEventIds: [],
          responseData: null,
          issuedAt: event.timestamp,
          resolvedAt: null,
        });
        return;
      }
      case 'assignment.started': {
        const assignment = requireAssignment(index, event);
        if (
          event.payload.attempt !== assignment.attemptPolicy.attempt + 1 ||
          event.payload.attempt > assignment.attemptPolicy.maxAttempts
        ) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            `Invalid attempt ${event.payload.attempt} for ${assignment.assignmentId}.`,
          );
        }
        if (assignment.state === 'rejected') {
          const rejected = [...index.submissions.values()].filter(
            (item) => item.assignmentId === assignment.assignmentId && item.state === 'rejected',
          );
          const materializedArtifacts = [...index.artifacts.values()].filter(
            (artifact) => artifact.assignmentId === assignment.assignmentId,
          );
          if (
            rejected.length !== 1 ||
            index.replay.has(rejected[0]?.submissionId) ||
            materializedArtifacts.length !== 0
          ) {
            throw runtimeError(
              'SUBMISSION_ID_CONFLICT',
              'Rejected-attempt recovery requires one unresolved runtime-issued submission identity.',
              {
                assignmentId: assignment.assignmentId,
                rejectedSubmissionCount: rejected.length,
              },
            );
          }
          const attemptsRemaining = rejected[0].responseData?.attemptsRemaining;
          if (
            attemptsRemaining !==
              assignment.attemptPolicy.maxAttempts - assignment.attemptPolicy.attempt ||
            attemptsRemaining < 1
          ) {
            throw runtimeError(
              'STATE_TRANSITION_INVALID',
              'Rejected-attempt recovery does not match the bounded attempt policy.',
              {
                assignmentId: assignment.assignmentId,
                attemptsRemaining,
              },
            );
          }
          index.submissions.set(rejected[0].submissionId, {
            ...rejected[0],
            state: 'issued',
            rawHash: null,
            canonicalHash: null,
            sizeBytes: null,
            artifactId: null,
            acceptanceEventIds: [],
            responseData: null,
            resolvedAt: null,
          });
        }
        const issued = [...index.submissions.values()].filter(
          (item) => item.assignmentId === assignment.assignmentId && item.state === 'issued',
        );
        if (issued.length !== 1) {
          throw runtimeError(
            'SUBMISSION_ID_CONFLICT',
            'Start requires exactly one durable runtime-issued submission identity.',
            {
              assignmentId: assignment.assignmentId,
              issuedSubmissionCount: issued.length,
            },
          );
        }
        setAssignment(index, event, 'running', {
          attemptPolicy: { ...assignment.attemptPolicy, attempt: event.payload.attempt },
        });
        return;
      }
      case 'assignment.submitted': {
        const assignment = requireAssignment(index, event);
        const submission = requireSubmission(index, event, assignment.assignmentId);
        if (submission.state !== 'issued') {
          throw runtimeError(
            'ASSIGNMENT_ALREADY_SUBMITTED',
            `Submission ${submission.submissionId} is already resolved.`,
          );
        }
        if (
          event.payload.mediaType !== assignment.outputContract.mediaType ||
          event.payload.encoding !== assignment.outputContract.encoding
        ) {
          throw runtimeError(
            'RESULT_CONTRACT_INVALID',
            'Submission media type or encoding does not match the assignment contract.',
          );
        }
        if (event.payload.sizeBytes > assignment.outputContract.maxBytes) {
          throw runtimeError(
            'RESULT_CONTRACT_INVALID',
            'Submission exceeds the assignment byte limit.',
          );
        }
        setAssignment(index, event, 'submitted');
        index.submissions.set(submission.submissionId, {
          ...submission,
          rawHash: event.payload.rawHash,
          canonicalHash: event.payload.canonicalHash,
          sizeBytes: event.payload.sizeBytes,
          acceptanceEventIds: [event.eventId],
        });
        return;
      }
      case 'artifact.created': {
        const assignment = index.assignments.get(event.payload.assignmentId);
        if (
          !assignment ||
          assignment.state !== 'submitted' ||
          assignment.cycleId !== event.cycleId
        ) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'artifact.created requires the matching submitted assignment.',
          );
        }
        const matchingSubmissions = [...index.submissions.values()].filter(
          (item) =>
            item.assignmentId === assignment.assignmentId &&
            item.state === 'issued' &&
            item.rawHash === event.payload.rawHash &&
            item.canonicalHash === event.payload.canonicalHash &&
            item.sizeBytes === event.payload.sizeBytes &&
            item.acceptanceEventIds.length === 1 &&
            item.acceptanceEventIds[0] === event.causationId,
        );
        const submission = matchingSubmissions.length === 1 ? matchingSubmissions[0] : null;
        if (
          !submission ||
          submission.rawHash !== event.payload.rawHash ||
          submission.canonicalHash !== event.payload.canonicalHash ||
          submission.sizeBytes !== event.payload.sizeBytes
        ) {
          throw runtimeError(
            'RESULT_CONTRACT_INVALID',
            'Artifact bytes do not match the submitted bytes.',
          );
        }
        const cycle = index.cycles.get(event.cycleId);
        if (
          !cycle ||
          event.payload.cycleId !== event.cycleId ||
          event.payload.scopeId !== cycle.scopeId ||
          event.payload.domainId !== cycle.domainId ||
          event.payload.domainVersion !== cycle.domainVersion ||
          event.payload.schemaId !== assignment.outputContract.schemaId ||
          event.payload.artifactSchemaVersion !== assignment.outputContract.schemaVersion ||
          event.payload.mediaType !== assignment.outputContract.mediaType ||
          event.payload.encoding !== assignment.outputContract.encoding
        ) {
          throw runtimeError(
            'RESULT_CONTRACT_INVALID',
            'Artifact metadata does not match the bound cycle and assignment contract.',
          );
        }
        if (
          event.payload.sizeBytes > assignment.outputContract.maxBytes ||
          sha256Jcs(event.payload.inputArtifactIds) !== sha256Jcs(assignment.inputArtifactIds)
        ) {
          throw runtimeError(
            'RESULT_CONTRACT_INVALID',
            'Artifact bytes or immutable inputs exceed the bound Assignment contract.',
            {
              assignmentId: assignment.assignmentId,
              artifactId: event.payload.artifactId,
            },
          );
        }
        if (
          !assignment.claim ||
          event.payload.producer.actorId !== assignment.claim.actorId ||
          event.payload.producer.runtime !== assignment.claim.runtime ||
          event.payload.producer.roleId !== assignment.roleId
        ) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'Artifact producer must exactly match the bound Assignment claim and role.',
            {
              assignmentId: assignment.assignmentId,
              artifactId: event.payload.artifactId,
            },
          );
        }
        if (event.entityId !== event.payload.artifactId || index.artifacts.has(event.entityId)) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            `Artifact identity ${event.entityId} is invalid or duplicated.`,
          );
        }
        index.artifacts.set(event.entityId, clone(event.payload));
        index.submissions.set(submission.submissionId, {
          ...submission,
          acceptanceEventIds: [...submission.acceptanceEventIds, event.eventId],
        });
        return;
      }
      case 'assignment.validated': {
        const assignment = requireAssignment(index, event);
        const submission = requireSubmission(index, event, assignment.assignmentId);
        const artifact = index.artifacts.get(event.payload.artifactId);
        if (
          !artifact ||
          artifact.assignmentId !== assignment.assignmentId ||
          artifact.rawHash !== submission.rawHash ||
          artifact.canonicalHash !== submission.canonicalHash
        ) {
          throw runtimeError(
            'ARTIFACT_NOT_FOUND',
            'Validated artifact does not match the submission.',
          );
        }
        setAssignment(index, event, 'validated', { completedAt: event.timestamp });
        const responseData = {
          accepted: true,
          artifactId: artifact.artifactId,
          rawHash: artifact.rawHash,
          sizeBytes: artifact.sizeBytes,
          assignmentState: 'validated',
        };
        index.submissions.set(submission.submissionId, {
          ...submission,
          state: 'accepted',
          artifactId: artifact.artifactId,
          acceptanceEventIds: [...submission.acceptanceEventIds, event.eventId],
          responseData,
          resolvedAt: event.timestamp,
        });
        index.replay.set(submission.submissionId, {
          submissionId: submission.submissionId,
          assignmentId: assignment.assignmentId,
          rawHash: artifact.rawHash,
          canonicalHash: artifact.canonicalHash,
          sizeBytes: artifact.sizeBytes,
          artifactId: artifact.artifactId,
          acceptanceEventIds: [...submission.acceptanceEventIds, event.eventId],
          responseData,
        });
        assertOperatingValidatedDependencyProofV2({
          assignment: index.assignments.get(assignment.assignmentId),
          submission: index.submissions.get(submission.submissionId),
          artifact,
          replay: index.replay.get(submission.submissionId),
        });
        return;
      }
      case 'assignment.rejected': {
        const assignment = requireAssignment(index, event);
        const submission = requireSubmission(index, event, assignment.assignmentId);
        if (event.payload.attempt !== assignment.attemptPolicy.attempt) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'Rejected attempt does not match the running attempt.',
          );
        }
        const expectedAttemptsRemaining =
          assignment.attemptPolicy.maxAttempts - event.payload.attempt;
        if (event.payload.attemptsRemaining !== expectedAttemptsRemaining) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'Rejected attempt does not match the bounded remaining-attempt policy.',
            {
              assignmentId: assignment.assignmentId,
              attempt: event.payload.attempt,
              expectedAttemptsRemaining,
              receivedAttemptsRemaining: event.payload.attemptsRemaining,
            },
          );
        }
        if (
          submission.state !== 'issued' ||
          submission.rawHash === null ||
          submission.sizeBytes === null ||
          submission.artifactId !== null ||
          index.replay.has(submission.submissionId) ||
          [...index.artifacts.values()].some(
            (artifact) => artifact.assignmentId === assignment.assignmentId,
          )
        ) {
          throw runtimeError(
            'SUBMISSION_ID_CONFLICT',
            'Only the current unaccepted submission attempt may be rejected.',
            {
              assignmentId: assignment.assignmentId,
              submissionId: submission.submissionId,
            },
          );
        }
        setAssignment(index, event, 'rejected');
        index.submissions.set(submission.submissionId, {
          ...submission,
          state: 'rejected',
          acceptanceEventIds: [event.eventId],
          responseData: {
            accepted: false,
            violations: clone(event.payload.violations),
            attemptsRemaining: event.payload.attemptsRemaining,
          },
          resolvedAt: event.timestamp,
        });
        return;
      }
      case 'assignment.abandoned':
        setAssignment(index, event, 'abandoned', {
          completedAt: event.timestamp,
          terminalOutcome: {
            outcome: 'abandoned',
            eventId: event.eventId,
            code: event.payload.reasonCode,
            reason: event.payload.reason,
            recoveryDisposition: event.payload.recoveryDisposition,
          },
        });
        return;
      case 'assignment.failed':
        if (requireAssignment(index, event).state === 'pending') {
          try {
            const intent = assertOperatingAssignmentTerminalPayloadV2(
              requireAssignment(index, event),
              event.payload,
              {
                assignments: [...index.assignments.values()],
                submissions: [...index.submissions.values()],
                artifacts: [...index.artifacts.values()],
                submissionReplayIndex: [...index.replay.values()],
                intelligencePlans: [...index.intelligencePlans.values()],
              },
            );
            if (
              event.eventId !== `evt_${intent.terminalId}` ||
              event.actor.kind !== 'engine' ||
              event.actor.id !== 'openplanr-scheduler' ||
              event.causationId !== intent.dependencyEventIds.at(-1)
            ) {
              throw runtimeError(
                'STATE_TRANSITION_INVALID',
                'Pending Assignment failure differs from its scheduler-owned terminal identity.',
                {
                  assignmentId: event.entityId,
                },
              );
            }
          } catch (error) {
            throw runtimeError(
              'STATE_TRANSITION_INVALID',
              error.message,
              error.details ?? {
                assignmentId: event.entityId,
              },
            );
          }
        }
        setAssignment(index, event, 'failed', {
          completedAt: event.timestamp,
          terminalOutcome: {
            outcome: 'failed',
            eventId: event.eventId,
            code: event.payload.errorCode,
            reason: event.payload.reason,
            recoveryDisposition: event.payload.recoveryStatus,
          },
        });
        return;
      default:
        throw runtimeError(
          'CONTRACT_VERSION_UNSUPPORTED',
          `Unsupported Assignment Event ${event.type}.`,
        );
    }
  }

  function dispatchRuntimeEvent(index, event, options) {
    const handlerName = EVENT_HANDLER_NAME_BY_TYPE[event.type];
    if (!handlerName) {
      throw runtimeError(
        'CONTRACT_VERSION_UNSUPPORTED',
        `Unsupported Protocol 2.0 Event ${event.type}.`,
      );
    }
    if (handlerName === 'assignment') {
      applyAssignmentRuntimeEvent(index, event);
      return;
    }
    eventHandlers[handlerName](index, event, options);
  }

  function eventReplayEntry(event) {
    return {
      eventId: event.eventId,
      eventHash: event.eventHash,
      payloadHash: sha256Jcs(event.payload),
      sequence: event.sequence,
      cycleId: event.cycleId,
      type: event.type,
      entityId: event.entityId,
      timestamp: event.timestamp,
      actor: clone(event.actor),
      causationId: event.causationId,
      correlationId: event.correlationId,
      previousEventHash: event.previousEventHash,
      ...(event.requestHash === undefined ? {} : { requestHash: event.requestHash }),
      ...(event.type === 'review.submitted'
        ? { receiptProjection: clone(event.payload.receiptProjection) }
        : {}),
    };
  }

  function validateEventForIdentityReplay(event) {
    if (event?.protocolVersion !== PROTOCOL_VERSION) {
      throw runtimeError(
        'CONTRACT_VERSION_UNSUPPORTED',
        `Event ${event?.eventId ?? '<unknown>'} is not Protocol 2.0.0.`,
        { eventId: event?.eventId ?? null, protocolVersion: event?.protocolVersion ?? null },
      );
    }
    try {
      assertProtocolArtifact('operating-event', event, { protocolVersion: PROTOCOL_VERSION });
    } catch (error) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        `Event at sequence ${event?.sequence ?? '?'} is invalid: ${error.message}.`,
        { sequence: event?.sequence ?? null },
      );
    }
    if (computeEventHash(event) !== event.eventHash) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        `Event ${event.eventId} failed its JCS hash check.`,
        {
          eventId: event.eventId,
        },
      );
    }
  }

  function selectEventsToAppend(index, events) {
    const identities = new Map(index.eventReplay);
    const appendEvents = [];
    for (const event of events) {
      validateEventForIdentityReplay(event);
      const existing = identities.get(event.eventId);
      if (existing) {
        if (existing.eventHash !== event.eventHash) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            `Event ${event.eventId} reuses a durable Event identity with different canonical content.`,
            { eventId: event.eventId },
          );
        }
        continue;
      }
      identities.set(event.eventId, eventReplayEntry(event));
      appendEvents.push(event);
    }
    return appendEvents;
  }

  function assertBoundedVerificationObservationTransaction(events) {
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event?.type !== 'outcome.recorded' && event?.type !== 'learning.recorded') continue;
      const outcome = event.type === 'outcome.recorded' ? event : events[index - 1];
      const learning = event.type === 'learning.recorded' ? event : events[index + 1];
      if (
        !outcome ||
        !learning ||
        outcome.type !== 'outcome.recorded' ||
        learning.type !== 'learning.recorded' ||
        outcome.cycleId !== learning.cycleId ||
        outcome.correlationId !== learning.correlationId ||
        outcome.requestHash !== learning.requestHash ||
        learning.payload?.outcomeId !== outcome.entityId
      ) {
        throw runtimeError(
          'STATE_TRANSITION_INVALID',
          'A bounded Action verification Outcome and Learning must be one adjacent atomic Event transaction.',
          { eventId: event?.eventId ?? null, type: event?.type ?? null },
        );
      }
    }
  }

  function assertExecutiveBoardReviewTransaction(events) {
    for (let index = 0; index < events.length; index += 1) {
      const boardEvent = events[index];
      if (boardEvent?.type !== 'executive-board.materialized') continue;
      const reviewEvent = events[index + 1];
      const board = boardEvent.payload;
      const review = reviewEvent?.payload;
      if (
        !reviewEvent ||
        reviewEvent.type !== 'review.created' ||
        review?.subject?.type === 'action' ||
        reviewEvent.entityId !== board?.reviewId ||
        reviewEvent.cycleId !== boardEvent.cycleId ||
        review?.cycleId !== boardEvent.cycleId ||
        board?.reviewHash !== sha256Jcs(review) ||
        reviewEvent.sequence !== boardEvent.sequence + 1 ||
        reviewEvent.previousEventHash !== boardEvent.eventHash ||
        reviewEvent.causationId !== boardEvent.eventId ||
        reviewEvent.correlationId !== boardEvent.correlationId ||
        reviewEvent.timestamp !== boardEvent.timestamp
      ) {
        throw runtimeError(
          'STATE_TRANSITION_INVALID',
          'Executive Board materialization and its exact Cycle Review must be one adjacent atomic Event transaction.',
          {
            boardEventId: boardEvent?.eventId ?? null,
            reviewEventId: reviewEvent?.eventId ?? null,
          },
        );
      }
    }
  }

  function reduceOperatingRuntimeEventsV2(events, options = {}) {
    const initialState = options.initialState ?? createEmptyState();
    const replayHook = options.replayHook ?? createNoModelReplayHook();
    const { artifactStore } = options;
    assertProtocolArtifact('operating-runtime-state', initialState, {
      protocolVersion: PROTOCOL_VERSION,
    });
    replayHook.assertUnused();
    const index = indexRuntimeState(initialState);
    const appendEvents = selectEventsToAppend(index, events);
    assertBoundedVerificationObservationTransaction(appendEvents);
    assertExecutiveBoardReviewTransaction(appendEvents);
    const eventHead = verifyEventChain(appendEvents, {
      startingSequence: initialState.eventHead.sequence,
      startingHash: initialState.eventHead.hash,
    });
    for (const event of appendEvents) {
      dispatchRuntimeEvent(index, event, { artifactStore });
      index.eventReplay.set(event.eventId, eventReplayEntry(event));
    }
    replayHook.assertUnused();
    return materializeRuntimeState(
      index,
      appendEvents.at(-1)?.timestamp ?? initialState.generatedAt,
      eventHead,
    );
  }

  return Object.freeze({ dispatchRuntimeEvent, eventReplayEntry, reduceOperatingRuntimeEventsV2 });
}
