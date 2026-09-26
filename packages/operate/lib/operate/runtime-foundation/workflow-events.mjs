/**
 * Workflow Event handlers for the Operate runtime reducer: Cycle input binding and lifecycle,
 * Executive Board, Review, work change set and Action lifecycle Events.
 * runtime-foundation.mjs builds the handler with createWorkflowRuntimeEventHandlerV2 and injects
 * the shared runtime helpers; Assignment Events stay in runtime-event-reducer-v2.mjs.
 */
import {
  assertPersistentWorkMaterializationPayloadV2,
  createOperatingActionReviewV2,
  evaluateOperatingApprovalSetV2,
  promotePersistentOperatingActionAuthorityV2,
} from './authority.mjs';
import {
  assertOperatingReviewBoundSubmissionV1,
  closeCycleWithCarriedWorkV2,
} from './execution.mjs';
import {
  assertOperatingExecutiveBoardV2,
  buildOperatingExecutiveBoardRecordV2,
} from './intelligence.mjs';
import { assertProtocolArtifact, sha256Jcs } from './protocol.mjs';

export function createWorkflowRuntimeEventHandlerV2({
  PROTOCOL_VERSION,
  assertOperatingActionCyclePlanOwnershipV2,
  buildOperatingReviewReadDataV2,
  clone,
  compiledTransition,
  indexBy,
  materializeRuntimeState,
  operatingActionAuthorityPromotionRequestHash,
  requireValidatedWorkChangeSetArtifact,
  runtimeError,
  sameOperatingEventHead,
  transitionOperatingActionLifecycleV2,
  transitionOperatingCycleLifecycleV2,
  transitionOperatingReviewV2,
  uniqueReplayEvent,
}) {
  function requireReview(index, event) {
    const reviewId = event.payload?.reviewId ?? event.entityId;
    const review = index.reviews.get(reviewId);
    if (!review)
      throw runtimeError(
        'REVIEW_NOT_FOUND',
        `${event.type} references unknown Review ${reviewId}.`,
        {
          reviewId,
        },
      );
    if (event.entityId !== reviewId || review.cycleId !== event.cycleId) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        `${event.type} does not match the Review identity or cycle.`,
        {
          reviewId,
          cycleId: event.cycleId,
        },
      );
    }
    return review;
  }

  function setReview(index, event, nextState, patch = {}) {
    const review = requireReview(index, event);
    const transition = compiledTransition('operating-review', review.state, nextState);
    if (!transition || transition.event !== event.type) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        `${event.type} is not the compiled transition for Review ${review.reviewId}.`,
        {
          reviewId: review.reviewId,
          from: review.state,
          to: nextState,
          event: event.type,
        },
      );
    }
    if (
      !transition.actorKinds.includes(event.actor.kind) ||
      event.actor.kind !== 'human' ||
      event.actor.id !== review.ownerActorId
    ) {
      throw runtimeError(
        'REVIEW_NOT_AUTHORIZED',
        'Only the human Review owner may submit a disposition.',
        {
          reviewId: review.reviewId,
          state: 'event.actor',
        },
      );
    }
    const next = transitionOperatingReviewV2(review, nextState, patch);
    index.reviews.set(next.reviewId, next);
    return next;
  }

  function applyWorkChangeSetMaterialized(index, event) {
    if (!['engine', 'runtime'].includes(event.actor.kind)) {
      throw runtimeError('CAPABILITY_DENIED', 'Only the runtime may materialize persistent work.', {
        actorKind: event.actor.kind,
      });
    }
    const artifact = requireValidatedWorkChangeSetArtifact(index, event);
    if (index.workReplay.has(artifact.artifactId)) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'A validated work-change-set Artifact may be materialized only once.',
        {
          artifactId: artifact.artifactId,
        },
      );
    }
    let payload;
    try {
      payload = assertPersistentWorkMaterializationPayloadV2(event.payload, {
        artifact,
        changeSet: event.payload.changeSet,
        timestamp: event.timestamp,
      });
    } catch (error) {
      throw runtimeError(
        error.code ?? 'STATE_TRANSITION_INVALID',
        error.message,
        error.details?.context ?? {
          artifactId: artifact.artifactId,
        },
      );
    }
    const newRecords = [
      ...payload.findings.map((record) => ['findingId', record, index.findings]),
      ...payload.decisions.map((record) => ['decisionId', record, index.decisions]),
      ...payload.actions.map((record) => ['actionId', record, index.actions]),
    ];
    for (const [key, record, records] of newRecords) {
      if (records.has(record[key])) {
        throw runtimeError(
          'CONCURRENT_MODIFICATION',
          `Persistent work identity ${record[key]} already exists.`,
          {
            entityId: record[key],
            artifactId: artifact.artifactId,
          },
        );
      }
    }
    for (const [key, record, records] of newRecords) records.set(record[key], clone(record));
    index.workReplay.set(artifact.artifactId, {
      artifactId: artifact.artifactId,
      canonicalHash: artifact.canonicalHash,
      eventId: event.eventId,
      findingIds: payload.findings.map(({ findingId }) => findingId),
      decisionIds: payload.decisions.map(({ decisionId }) => decisionId),
      actionIds: payload.actions.map(({ actionId }) => actionId),
    });
  }

  function requireGovernanceEngineActor(event) {
    if (event.actor.kind !== 'engine' || event.actor.id !== 'openplanr') {
      throw runtimeError(
        'CAPABILITY_DENIED',
        'Only the deterministic governance engine may materialize an Action policy disposition.',
        {
          actorKind: event.actor.kind,
          actorId: event.actor.id,
        },
      );
    }
  }

  return function applyWorkflowRuntimeEvent(index, event) {
    switch (event.type) {
      case 'cycle.input-bound': {
        if (event.entityId !== event.payload.inputBindingId) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'cycle.input-bound entityId does not match inputBindingId.',
          );
        }
        const cycle = index.cycles.get(event.cycleId);
        const input = index.inputBindings.get(event.payload.inputBindingId);
        if (!cycle || !input) {
          throw runtimeError(
            'CYCLE_NOT_FOUND',
            'cycle.input-bound requires the durable cycle and input-binding records.',
            {
              cycleId: event.cycleId,
              inputBindingId: event.payload.inputBindingId,
            },
          );
        }
        const expected = event.payload;
        if (
          cycle.inputBindingId !== input.inputBindingId ||
          input.cycleId !== cycle.cycleId ||
          cycle.scopeId !== expected.scopeId ||
          cycle.domainId !== expected.domainId ||
          cycle.domainVersion !== expected.domainVersion ||
          sha256Jcs(cycle.contractVersions) !== sha256Jcs(expected.contractVersions)
        )
          throw runtimeError(
            'OPERATING_SCOPE_INVALID',
            'cycle.input-bound does not match the durable cycle binding.',
          );
        return;
      }
      case 'executive-board.materialized': {
        const board = assertOperatingExecutiveBoardV2(event.payload, { materializedOnly: true });
        const cycle = index.cycles.get(event.cycleId);
        const ledgerEvent = uniqueReplayEvent(
          index,
          'decision-ledger.materialized',
          board.ledgerId,
        );
        if (
          event.entityId !== board.boardId ||
          event.cycleId !== board.cycleId ||
          board.materializedEventId !== event.eventId ||
          board.sourceEventHead.sequence + 1 !== event.sequence ||
          board.sourceEventHead.hash !== event.previousEventHash ||
          board.createdAt !== event.timestamp ||
          event.actor.kind !== 'runtime' ||
          event.actor.id !== 'openplanr' ||
          !ledgerEvent ||
          event.causationId !== ledgerEvent.eventId
        ) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'Executive Board Event does not bind its exact runtime, ledger, identity, timestamp, and source head.',
            {
              boardId: board.boardId,
              cycleId: board.cycleId,
              reviewId: board.reviewId,
            },
          );
        }
        if (
          !cycle ||
          cycle.domainId !== 'business' ||
          cycle.state !== 'advising' ||
          cycle.activeReviewId !== null ||
          index.executiveBoards.has(board.boardId) ||
          [...index.executiveBoards.values()].some(
            (entry) => entry.cycleId === board.cycleId || entry.reviewId === board.reviewId,
          )
        ) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'Executive Board materialization requires one advising business Cycle without an existing Board or Review.',
            {
              boardId: board.boardId,
              cycleId: board.cycleId,
              reviewId: board.reviewId,
            },
          );
        }
        const priorState = materializeRuntimeState(
          index,
          event.timestamp,
          clone(board.sourceEventHead),
        );
        const expected = buildOperatingExecutiveBoardRecordV2(priorState, {
          cycleId: board.cycleId,
          planId: board.planId,
          ledgerId: board.ledgerId,
          reviewId: board.reviewId,
          reviewHash: board.reviewHash,
          projectionMode: 'materialized',
          materializedEventId: event.eventId,
          createdAt: event.timestamp,
          eventHead: board.sourceEventHead,
        });
        if (sha256Jcs(expected) !== sha256Jcs(board)) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'Executive Board payload differs from the pipeline-owned projection of its exact Chair state.',
            {
              boardId: board.boardId,
              cycleId: board.cycleId,
            },
          );
        }
        index.executiveBoardsEnabled = true;
        index.executiveBoards.set(board.boardId, clone(board));
        index.cycles.set(cycle.cycleId, {
          ...cycle,
          state: 'awaiting_review',
          activeReviewId: null,
          updatedAt: event.timestamp,
        });
        return;
      }
      case 'review.created': {
        const review = event.payload;
        if (event.entityId !== review.reviewId || event.cycleId !== review.cycleId) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'review.created identifiers do not match its record.',
          );
        }
        const cycle = index.cycles.get(event.cycleId);
        const actionSubject = review.subject?.type === 'action';
        if (
          !cycle ||
          (!actionSubject && (cycle.state !== 'awaiting_review' || cycle.activeReviewId !== null))
        ) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'review.created requires an awaiting-review cycle without an active Review.',
            {
              cycleId: event.cycleId,
            },
          );
        }
        if (event.actor.kind !== 'engine' && event.actor.kind !== 'runtime') {
          throw runtimeError(
            'REVIEW_NOT_AUTHORIZED',
            'Only the runtime may create a cycle-scoped Review.',
            {
              reviewId: review.reviewId,
            },
          );
        }
        if (
          index.reviews.has(review.reviewId) ||
          [...index.reviews.values()].some(
            (entry) =>
              !actionSubject &&
              entry.subject?.type !== 'action' &&
              entry.cycleId === review.cycleId &&
              entry.state === 'pending',
          )
        ) {
          throw runtimeError(
            'CONCURRENT_MODIFICATION',
            `Review ${review.reviewId} already exists or the cycle already has a pending Review.`,
            {
              reviewId: review.reviewId,
              cycleId: review.cycleId,
            },
          );
        }
        if (
          review.state !== 'pending' ||
          review.disposition !== null ||
          review.workDispositions.length !== 0 ||
          review.createdAt !== event.timestamp ||
          review.updatedAt !== event.timestamp
        ) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'Review creation must establish a new pending Review at the Event timestamp.',
            {
              reviewId: review.reviewId,
            },
          );
        }
        if (!actionSubject) {
          const board = [...index.executiveBoards.values()].find(
            (entry) => entry.cycleId === review.cycleId && entry.reviewId === review.reviewId,
          );
          if (index.executiveBoardsEnabled && !board) {
            throw runtimeError(
              'STATE_TRANSITION_INVALID',
              'New Cycle Review creation requires one matching materialized Executive Board.',
              {
                reviewId: review.reviewId,
                cycleId: review.cycleId,
              },
            );
          }
          if (board) {
            const prior = [...index.eventReplay.values()].find(
              (entry) => entry.sequence === event.sequence - 1,
            );
            if (
              !prior ||
              prior.type !== 'executive-board.materialized' ||
              prior.eventId !== board.materializedEventId ||
              prior.entityId !== board.boardId ||
              prior.eventHash !== event.previousEventHash ||
              event.causationId !== prior.eventId ||
              event.correlationId !== prior.correlationId ||
              event.timestamp !== board.createdAt ||
              sha256Jcs(review) !== board.reviewHash
            ) {
              throw runtimeError(
                'STATE_TRANSITION_INVALID',
                'Cycle Review must immediately follow and exactly match its materialized Executive Board.',
                {
                  boardId: board.boardId,
                  reviewId: review.reviewId,
                },
              );
            }
          }
        }
        if (actionSubject) {
          const action = index.actions.get(review.subject.actionId);
          if (
            !action ||
            action.state !== 'proposed' ||
            action.sourceCycleId !== review.cycleId ||
            action.revision !== review.subject.revision ||
            action.actionHash !== review.subject.actionHash ||
            action.scopeId !== cycle.scopeId ||
            action.domainId !== cycle.domainId ||
            action.domainVersion !== cycle.domainVersion
          ) {
            throw runtimeError(
              'ACTION_REVISION_MISMATCH',
              'Action Review must bind the exact current proposed Action and source Cycle.',
              {
                reviewId: review.reviewId,
              },
            );
          }
          const expected = createOperatingActionReviewV2({
            reviewId: review.reviewId,
            action,
            ownerActorId: review.ownerActorId,
            timestamp: event.timestamp,
          });
          if (sha256Jcs(review) !== sha256Jcs(expected)) {
            throw runtimeError(
              'STATE_TRANSITION_INVALID',
              'Action Review payload is not the deterministic exact-subject record.',
              {
                reviewId: review.reviewId,
              },
            );
          }
        }
        index.reviews.set(review.reviewId, clone(review));
        if (!actionSubject) {
          index.cycles.set(cycle.cycleId, {
            ...cycle,
            activeReviewId: review.reviewId,
            updatedAt: event.timestamp,
          });
        }
        return;
      }
      case 'review.submitted': {
        const review = requireReview(index, event);
        const cycle = index.cycles.get(review.cycleId);
        const actionSubject = review.subject?.type === 'action';
        if (
          !cycle ||
          (!actionSubject &&
            (cycle.state !== 'awaiting_review' || cycle.activeReviewId !== review.reviewId))
        ) {
          throw runtimeError(
            'REVIEW_NOT_PENDING',
            'Review submission requires the active awaiting-review cycle.',
            {
              reviewId: review.reviewId,
              state: review.state,
            },
          );
        }
        const projection = event.payload.receiptProjection;
        const projectionActor = projection?.read?.reader;
        const expectedRead =
          projectionActor &&
          event.actor.kind === 'human' &&
          event.actor.id === review.ownerActorId &&
          projectionActor.actorId === event.actor.id
            ? buildOperatingReviewReadDataV2({
                index,
                eventHead:
                  event.sequence === 1
                    ? { sequence: 0, hash: null }
                    : { sequence: event.sequence - 1, hash: event.previousEventHash },
                review,
                cycle,
                actor: projectionActor,
                readAt: event.timestamp,
              })
            : null;
        const appliedChoice =
          expectedRead?.dispositionChoices.filter(
            (choice) =>
              choice.choiceId === projection.appliedChoiceId &&
              choice.choiceHash === projection.appliedChoiceHash &&
              choice.submitArguments.disposition === event.payload.disposition &&
              sha256Jcs(choice.submitArguments.workDispositions) ===
                sha256Jcs(event.payload.workDispositions),
          ) ?? [];
        const boundSubmission = projection?.boundSubmission ?? null;
        let validBoundSubmission = true;
        if (boundSubmission !== null) {
          try {
            assertOperatingReviewBoundSubmissionV1(boundSubmission);
          } catch {
            validBoundSubmission = false;
          }
          const expectedHead =
            event.sequence === 1
              ? { sequence: 0, hash: null }
              : { sequence: event.sequence - 1, hash: event.previousEventHash };
          validBoundSubmission =
            validBoundSubmission &&
            sameOperatingEventHead(boundSubmission.expectedReadEventHead, expectedHead) &&
            appliedChoice.length === 1 &&
            boundSubmission.choiceId === appliedChoice[0].choiceId &&
            boundSubmission.choiceHash === appliedChoice[0].choiceHash &&
            sha256Jcs(boundSubmission.submitArguments) ===
              sha256Jcs(appliedChoice[0].submitArguments);
        }
        if (
          !expectedRead ||
          sha256Jcs(expectedRead) !== sha256Jcs(projection.read) ||
          appliedChoice.length !== 1 ||
          !validBoundSubmission
        ) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'Review submission receipt projection must equal the exact owner-bound pre-commit read and applied choice.',
            {
              reviewId: review.reviewId,
              cycleId: cycle.cycleId,
            },
          );
        }
        const next = setReview(index, event, event.payload.disposition, {
          updatedAt: event.timestamp,
          workDispositions: event.payload.workDispositions,
        });
        if (actionSubject) {
          const action = index.actions.get(review.subject.actionId);
          if (
            !action ||
            action.state !== 'proposed' ||
            action.revision !== review.subject.revision ||
            action.actionHash !== review.subject.actionHash ||
            next.workDispositions.length !== 0
          ) {
            throw runtimeError(
              'ACTION_REVISION_MISMATCH',
              'Action Review submission cannot drift subject or carry Cycle work dispositions.',
              {
                reviewId: next.reviewId,
              },
            );
          }
          if (
            next.state === 'approved' &&
            cycle.state === 'awaiting_review' &&
            cycle.activeReviewId === null
          ) {
            index.cycles.set(
              cycle.cycleId,
              transitionOperatingCycleLifecycleV2(cycle, 'approved', {
                updatedAt: event.timestamp,
              }),
            );
          }
          return;
        }
        if (next.state !== 'approved') {
          if (next.workDispositions.length !== 0) {
            throw runtimeError(
              'STATE_TRANSITION_INVALID',
              'Only an approved Review may record durable-work dispositions.',
              {
                reviewId: next.reviewId,
                disposition: next.disposition,
              },
            );
          }
          index.cycles.set(cycle.cycleId, {
            ...cycle,
            activeReviewId: null,
            updatedAt: next.updatedAt,
          });
          return;
        }
        let closure;
        try {
          closure = closeCycleWithCarriedWorkV2({
            cycle,
            findings: [...index.findings.values()],
            decisions: [...index.decisions.values()],
            actions: [...index.actions.values()],
            workDispositions: next.workDispositions,
            timestamp: event.timestamp,
            reviewOwnerActorId: event.actor.id,
          });
        } catch (error) {
          throw runtimeError(
            error.code ?? 'STATE_TRANSITION_INVALID',
            error.message,
            error.details?.context ?? {
              cycleId: cycle.cycleId,
            },
          );
        }
        index.cycles.set(cycle.cycleId, closure.cycle);
        index.findings = indexBy(closure.findings, 'findingId', 'finding');
        index.decisions = indexBy(closure.decisions, 'decisionId', 'decision');
        index.actions = indexBy(closure.actions, 'actionId', 'action');
        return;
      }
      case 'work-change-set.materialized':
        applyWorkChangeSetMaterialized(index, event);
        return;
      case 'action.authority-promoted': {
        requireGovernanceEngineActor(event);
        const { before, authority, action: promoted } = event.payload;
        const current = index.actions.get(before?.actionId);
        if (
          !current ||
          event.entityId !== current.actionId ||
          event.cycleId !== current.sourceCycleId ||
          event.timestamp !== authority?.updatedAt ||
          event.requestHash !== operatingActionAuthorityPromotionRequestHash(before, authority) ||
          sha256Jcs(current) !== sha256Jcs(before) ||
          current.state !== 'proposed' ||
          Object.hasOwn(current, 'revisionId')
        ) {
          throw runtimeError(
            'ACTION_REVISION_MISMATCH',
            'Action authority promotion must bind one exact ungoverned proposed Action.',
            {
              actionId: before?.actionId ?? null,
            },
          );
        }
        let derived;
        try {
          derived = promotePersistentOperatingActionAuthorityV2(current, authority);
        } catch (error) {
          throw runtimeError(
            error.code ?? 'ACTION_REVISION_MISMATCH',
            error.message,
            error.details?.context ?? {
              actionId: current.actionId,
            },
          );
        }
        if (sha256Jcs(derived) !== sha256Jcs(promoted) || promoted.state !== 'proposed') {
          throw runtimeError(
            'ACTION_REVISION_MISMATCH',
            'Action authority Event does not equal the runtime-derived immutable revision.',
            {
              actionId: current.actionId,
            },
          );
        }
        index.actions.set(current.actionId, clone(derived));
        return;
      }
      case 'action.approved':
      case 'action.rejected':
      case 'action.deferred': {
        requireGovernanceEngineActor(event);
        const action = index.actions.get(event.payload.action.actionId);
        if (
          !action ||
          event.entityId !== action.actionId ||
          action.sourceCycleId !== event.cycleId ||
          action.revision !== event.payload.action.revision ||
          action.actionHash !== event.payload.action.actionHash ||
          action.state !== event.payload.from
        ) {
          throw runtimeError(
            'ACTION_REVISION_MISMATCH',
            'Action governance transition must bind the exact current Action revision.',
            {
              actionId: event.payload.action.actionId,
            },
          );
        }
        const evaluation = [...index.policyEvaluations.values()]
          .filter(
            (entry) =>
              entry.action.actionId === action.actionId &&
              entry.action.revision === action.revision &&
              entry.action.actionHash === action.actionHash,
          )
          .sort(
            (left, right) =>
              left.evaluatedAt.localeCompare(right.evaluatedAt) ||
              left.evaluationId.localeCompare(right.evaluationId),
          )
          .at(-1);
        if (!evaluation)
          throw runtimeError(
            'POLICY_EVALUATION_REJECTED',
            'Action transition requires a current policy evaluation.',
          );
        const requirements = evaluation.approvalRequirementIds.map((id) =>
          index.approvalRequirements.get(id),
        );
        const approvals = [...index.approvalRecords.values()].filter(
          ({ evaluationId }) => evaluationId === evaluation.evaluationId,
        );
        let disposition;
        try {
          disposition = evaluateOperatingApprovalSetV2({
            evaluation,
            action,
            requirements,
            approvals,
            now: event.timestamp,
          });
        } catch (error) {
          throw runtimeError(
            error.code ?? 'APPROVAL_INVALID',
            error.message,
            error.details?.context ?? {},
          );
        }
        const expectedState = disposition.disposition;
        const expectedReasonCode = expectedState === 'approved' ? null : disposition.reasonCode;
        if (
          !disposition.complete ||
          event.payload.to !== expectedState ||
          event.type !== `action.${expectedState}` ||
          event.payload.reasonCode !== expectedReasonCode ||
          event.payload.operationId !== null ||
          event.payload.resultId !== null ||
          !compiledTransition('operating-action', action.state, expectedState)
        ) {
          throw runtimeError(
            'APPROVAL_REQUIRED',
            'Action transition must equal the complete current policy/approval disposition.',
            {
              actionId: action.actionId,
              state: disposition.reasonCode,
            },
          );
        }
        const next = { ...clone(action), state: expectedState, updatedAt: event.timestamp };
        assertProtocolArtifact('operating-action', next, { protocolVersion: PROTOCOL_VERSION });
        index.actions.set(action.actionId, next);
        return;
      }
      case 'action.reopened': {
        requireGovernanceEngineActor(event);
        const action = index.actions.get(event.payload.action.actionId);
        if (
          !action ||
          event.entityId !== action.actionId ||
          event.cycleId !== action.sourceCycleId ||
          action.revision !== event.payload.action.revision ||
          action.actionHash !== event.payload.action.actionHash ||
          action.state !== event.payload.from ||
          event.payload.to !== 'proposed' ||
          event.payload.operationId !== null ||
          event.payload.resultId !== null ||
          event.payload.reasonCode !== null
        ) {
          throw runtimeError(
            'ACTION_REVISION_MISMATCH',
            'Action reopening must bind the exact deferred Action authority tuple.',
            {
              actionId: event.payload.action.actionId,
            },
          );
        }
        index.actions.set(
          action.actionId,
          transitionOperatingActionLifecycleV2(action, 'proposed', {
            updatedAt: event.timestamp,
          }),
        );
        return;
      }
      case 'action.queued':
      case 'action.started':
      case 'action.completed':
      case 'action.blocked':
      case 'action.cancelled': {
        const payload = event.payload;
        const action = index.actions.get(payload.action.actionId);
        const operation =
          payload.operationId === null ? null : index.governedOperations.get(payload.operationId);
        const grant = operation ? index.capabilityGrants.get(operation.grantId) : null;
        const result =
          payload.resultId === null ? null : index.executionResults.get(payload.resultId);
        const governanceCancellation =
          event.type === 'action.cancelled' && payload.operationId === null;
        if (!governanceCancellation && operation) {
          assertOperatingActionCyclePlanOwnershipV2({
            action,
            cycle: action ? index.cycles.get(action.sourceCycleId) : null,
            verificationPlan: index.verificationPlans.get(operation.verificationPlanId),
            operation,
          });
        }
        if (
          !action ||
          event.entityId !== action.actionId ||
          event.cycleId !== action.sourceCycleId ||
          payload.action.revision !== action.revision ||
          payload.action.actionHash !== action.actionHash ||
          payload.from !== action.state ||
          !compiledTransition('operating-action', payload.from, payload.to) ||
          event.type !== `action.${payload.to === 'in_progress' ? 'started' : payload.to}` ||
          (governanceCancellation
            ? event.actor.kind !== 'engine' || event.actor.id !== 'openplanr'
            : !operation ||
              !grant ||
              event.actor.kind !== 'engine' ||
              event.actor.id !== grant.issuer.id ||
              operation.action.actionId !== action.actionId ||
              operation.action.revision !== action.revision ||
              operation.action.actionHash !== action.actionHash)
        ) {
          throw runtimeError(
            'ACTION_REVISION_MISMATCH',
            'Action execution transition must bind the exact current Action, operation, and engine authority.',
            {
              actionId: payload.action.actionId,
              operationId: payload.operationId,
            },
          );
        }
        if (['action.completed', 'action.blocked'].includes(event.type)) {
          const expectedState = result?.status === 'succeeded' ? 'completed' : 'blocked';
          if (
            !result ||
            operation.resultId !== result.resultId ||
            result.operationId !== operation.operationId ||
            result.action.actionId !== action.actionId ||
            result.action.revision !== action.revision ||
            result.action.actionHash !== action.actionHash ||
            payload.to !== expectedState ||
            (expectedState === 'completed'
              ? payload.reasonCode !== null
              : typeof payload.reasonCode !== 'string')
          ) {
            throw runtimeError(
              'RESULT_CONTRACT_INVALID',
              'Action terminal state must be derived from its exact durable execution result.',
              {
                actionId: action.actionId,
                resultId: payload.resultId,
              },
            );
          }
        }
        if (event.type === 'action.queued' && payload.from === 'blocked') {
          const prior = index.executionResults.get(payload.resultId);
          if (
            !prior ||
            prior.action.actionId !== action.actionId ||
            typeof payload.reasonCode !== 'string'
          ) {
            throw runtimeError(
              'STATE_TRANSITION_INVALID',
              'Blocked Action recovery must retain its prior terminal result and explicit reason.',
              {
                actionId: action.actionId,
                resultId: payload.resultId,
              },
            );
          }
        }
        index.actions.set(
          action.actionId,
          transitionOperatingActionLifecycleV2(action, payload.to, {
            updatedAt: event.timestamp,
          }),
        );
        return;
      }
      case 'cycle.approved':
      case 'cycle.executing':
      case 'cycle.verifying':
      case 'cycle.closed': {
        const payload = event.payload;
        const cycle = index.cycles.get(payload.cycleId);
        const action = payload.actionId === null ? null : index.actions.get(payload.actionId);
        const operation =
          payload.operationId === null ? null : index.governedOperations.get(payload.operationId);
        const grant = operation ? index.capabilityGrants.get(operation.grantId) : null;
        const result =
          payload.resultId === null
            ? null
            : (index.executionResults.get(payload.resultId) ??
              index.rollbackResults.get(payload.resultId));
        const engineOwned = operation !== null;
        if (engineOwned) {
          assertOperatingActionCyclePlanOwnershipV2({
            action,
            cycle,
            verificationPlan: index.verificationPlans.get(operation.verificationPlanId),
            operation,
          });
        }
        if (
          !cycle ||
          event.entityId !== cycle.cycleId ||
          event.cycleId !== cycle.cycleId ||
          payload.from !== cycle.state ||
          !compiledTransition('operating-cycle', payload.from, payload.to) ||
          event.type !== `cycle.${payload.to}` ||
          (engineOwned
            ? !grant || event.actor.kind !== 'engine' || event.actor.id !== grant.issuer.id
            : event.actor.kind !== 'engine' || event.actor.id !== 'openplanr') ||
          (action && action.sourceCycleId !== cycle.cycleId) ||
          (operation &&
            (!action ||
              operation.action.actionId !== action.actionId ||
              operation.action.revision !== action.revision ||
              operation.action.actionHash !== action.actionHash))
        ) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'Cycle lifecycle transition must bind the current Cycle and exact Action operation authority.',
            {
              cycleId: payload.cycleId,
              operationId: payload.operationId,
            },
          );
        }
        if (event.type === 'cycle.executing' && (!operation || payload.resultId !== null)) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'Cycle execution begins with one governed operation and no terminal result.',
          );
        }
        if (event.type === 'cycle.verifying' && payload.from === 'executing') {
          const resultOperationId = result?.operationId ?? result?.rollbackOperationId ?? null;
          if (
            !operation ||
            !result ||
            operation.resultId !== payload.resultId ||
            resultOperationId !== operation.operationId ||
            payload.reasonCode !== null
          ) {
            throw runtimeError(
              'RESULT_CONTRACT_INVALID',
              'Cycle verification must follow the exact terminal operation result.',
            );
          }
        }
        if (event.type === 'cycle.closed' && payload.operationId !== null) {
          const resultOperationId = result?.operationId ?? result?.rollbackOperationId ?? null;
          if (
            !operation ||
            !result ||
            operation.resultId !== payload.resultId ||
            resultOperationId !== operation.operationId
          ) {
            throw runtimeError(
              'RESULT_CONTRACT_INVALID',
              'Cycle closure must retain the exact verified terminal operation result.',
            );
          }
        }
        index.cycles.set(
          cycle.cycleId,
          transitionOperatingCycleLifecycleV2(cycle, payload.to, {
            updatedAt: event.timestamp,
          }),
        );
        return;
      }
      default:
        throw runtimeError(
          'CONTRACT_VERSION_UNSUPPORTED',
          `Unsupported Phase 1 event ${event.type}.`,
        );
    }
  };
}
