/**
 * Authority Event handlers for the Operate runtime reducer: policy evaluation, approvals,
 * capability availability and grants, rollback plans, governed operation intents and results.
 * runtime-foundation.mjs builds the handler with createAuthorityRuntimeEventHandlerV2 and
 * injects the shared runtime helpers.
 */
import {
  appendOperatingApprovalRecordV2,
  assertOperatingApprovalRequirementV2,
  assertOperatingPolicyEvaluationV2,
  consumeOperatingApprovalRecordsV2,
  createOperatingApprovalRequirementV2,
  deriveOperatingApprovalRequirementInstanceIdV2,
  evaluateOperatingApprovalSetV2,
  isOperatingRollbackEligibilityV2,
} from './authority.mjs';
import { deriveContainedExecutorRequestFingerprintFromBindingV2 } from './execution.mjs';
import { sha256Jcs } from './protocol.mjs';

export function createAuthorityRuntimeEventHandlerV2({
  PROTOCOL_VERSION,
  assertCanonicalRecordHash,
  assertOperatingDispatchExecutionProjectionsV2,
  assertOperatingExecuteOperationV2,
  assertOperatingRollbackAuthorityChainIndexV2,
  assertOperatingTerminalExecutionChainV2,
  capabilityAvailabilityForGovernedOperation,
  clone,
  eventReplayEntry,
  findOperatingExactActionOperationOwnerV2,
  indexBy,
  recordWithoutHash,
  requireRuntimeIntelligenceActor,
  reservedExecutionTerminalForStatus,
  runtimeError,
  sameCanonicalStringSet,
}) {
  function applyOperatingRollbackIntentV2(index, event) {
    const { operation, request, terminal } = event.payload;
    const uncertainty = terminal.uncertainty;
    const assignment = index.assignments.get(operation.assignmentId);
    const action = index.actions.get(operation.action.actionId);
    const evaluation = index.policyEvaluations.get(operation.evaluationId);
    const grant = index.capabilityGrants.get(operation.grantId);
    const plan = index.rollbackPlans.get(operation.rollbackPlanId);
    const parent = index.governedOperations.get(operation.parentOperationId);
    const parentResult = parent ? index.executionResults.get(parent.resultId) : null;
    const successSubmission = index.submissions.get(terminal.submissionId);
    const uncertaintySubmission = index.submissions.get(uncertainty.submissionId);
    const requirements =
      evaluation?.approvalRequirementIds.map((requirementId) =>
        index.approvalRequirements.get(requirementId),
      ) ?? [];
    const approvals = evaluation
      ? [...index.approvalRecords.values()].filter(
          ({ evaluationId }) => evaluationId === evaluation.evaluationId,
        )
      : [];
    const availability = capabilityAvailabilityForGovernedOperation(index, {
      checkedAt: event.timestamp,
      capability: operation.capability,
      target: operation.target,
      grant,
    });
    let disposition = null;
    let expectedFingerprint = null;
    try {
      disposition = evaluateOperatingApprovalSetV2({
        evaluation,
        action,
        requirements,
        approvals,
        now: event.timestamp,
      });
      expectedFingerprint = deriveContainedExecutorRequestFingerprintFromBindingV2({
        operation,
        payload: request.payload,
        rollbackBaseline: request.rollbackBaseline,
      });
    } catch {
      disposition = null;
      expectedFingerprint = null;
    }
    const expectedInputs = action
      ? [...new Set([action.sourceArtifactId, ...action.preconditionArtifactIds])].sort()
      : [];
    const duplicateRollback = [...index.governedOperations.values()].some(
      (candidate) =>
        candidate.operationKind === 'rollback' &&
        candidate.parentOperationId === operation.parentOperationId &&
        candidate.rollbackPlanId === operation.rollbackPlanId,
    );
    const terminalIds = [
      terminal.resultId,
      terminal.resultArtifactId,
      terminal.submissionId,
      uncertainty.resultId,
      uncertainty.resultArtifactId,
      uncertainty.submissionId,
      ...Object.values(terminal.eventIds),
      ...Object.values(uncertainty.eventIds),
    ];
    if (
      !index.authorityHistoryEnabled ||
      event.actor.kind !== 'engine' ||
      event.actor.id !== grant?.issuer.id ||
      operation.operationKind !== 'rollback' ||
      operation.state !== 'dispatching' ||
      operation.resultId !== null ||
      event.entityId !== operation.operationId ||
      event.cycleId !== action?.sourceCycleId ||
      event.timestamp !== operation.createdAt ||
      event.requestHash !== operation.requestFingerprint ||
      expectedFingerprint !== operation.requestFingerprint ||
      operation.intentEventId !== event.eventId ||
      operation.action.revision !== action?.revision ||
      operation.action.actionHash !== action?.actionHash ||
      operation.parentOperationId !== plan?.operationId ||
      operation.rollbackPlanId !== plan?.rollbackPlanId ||
      parent?.operationKind !== 'execute' ||
      !['succeeded', 'partial'].includes(parent?.state) ||
      parent?.resultId !== plan?.executionResultId ||
      parentResult?.resultId !== plan?.executionResultId ||
      !isOperatingRollbackEligibilityV2(plan?.eligibility) ||
      Date.parse(plan?.expiresAt) <= Date.parse(event.timestamp) ||
      request.rollbackBaseline?.artifactId !== plan?.baselineArtifactId ||
      request.rollbackBaseline?.contentHash !== plan?.baselineHash ||
      request.targetBeforeHash !== parentResult?.targetAfterHash ||
      plan?.steps?.some(
        ({ expectedTargetHash }) => expectedTargetHash !== request.targetBeforeHash,
      ) ||
      sha256Jcs(operation.action) !== sha256Jcs(plan?.action) ||
      sha256Jcs(operation.capability) !== sha256Jcs(plan?.capability) ||
      operation.effectClass !== plan?.effectClass ||
      sha256Jcs(operation.executor) !== sha256Jcs(plan?.executor) ||
      operation.verificationPlanId !== plan?.verificationPlanId ||
      operation.rollbackClass === 'not-applicable' ||
      !sameCanonicalStringSet(operation.preconditionArtifactIds, action?.preconditionArtifactIds) ||
      !sameCanonicalStringSet(operation.inputArtifactIds, expectedInputs) ||
      !operation.inputArtifactIds.includes(request.payload.artifactId) ||
      !operation.inputArtifactIds.includes(request.rollbackBaseline.artifactId) ||
      !assignment ||
      assignment.state !== 'running' ||
      assignment.assignmentKind !== 'execution' ||
      assignment.outputContract.schemaId !== 'operating-rollback-result' ||
      assignment.governedOperationId !== operation.operationId ||
      assignment.capabilityGrantId !== operation.grantId ||
      !grant ||
      grant.operationId !== operation.operationId ||
      grant.assignmentId !== operation.assignmentId ||
      grant.evaluationId !== operation.evaluationId ||
      grant.consumedAt !== null ||
      grant.revokedAt !== null ||
      Date.parse(grant.expiresAt) <= Date.parse(event.timestamp) ||
      availability?.status !== 'available' ||
      Date.parse(availability?.expiresAt) <= Date.parse(event.timestamp) ||
      disposition?.complete !== true ||
      disposition.disposition !== 'approved' ||
      !sameCanonicalStringSet(disposition.approvalIds, operation.approvalIds) ||
      !successSubmission ||
      successSubmission.state !== 'issued' ||
      successSubmission.assignmentId !== assignment.assignmentId ||
      uncertaintySubmission ||
      terminal.resultId.startsWith('rbres_') !== true ||
      uncertainty.resultId.startsWith('rbres_') !== true ||
      new Set(terminalIds).size !== terminalIds.length ||
      duplicateRollback ||
      index.governedOperations.has(operation.operationId) ||
      index.operationReplayIndex.has(operation.operationId)
    ) {
      throw runtimeError(
        'ROLLBACK_NOT_ELIGIBLE',
        'Rollback intent must preserve one exact, current, independently authorized compensation chain.',
        {
          operationId: operation?.operationId ?? null,
          rollbackPlanId: operation?.rollbackPlanId ?? null,
        },
      );
    }
    assertCanonicalRecordHash(
      operation,
      'operationHash',
      'OPERATION_CONFLICT',
      `Rollback operation ${operation.operationId}`,
    );
    if (operation.approvalIds.length > 0) {
      const consumed = consumeOperatingApprovalRecordsV2({
        approvals: [...index.approvalRecords.values()],
        requirements,
        approvalIds: operation.approvalIds,
        operationId: operation.operationId,
      });
      index.approvalRecords = indexBy(consumed.records, 'approvalId', 'approval record');
    }
    const consumedGrant = { ...clone(grant), consumedAt: event.timestamp };
    consumedGrant.grantHash = sha256Jcs(recordWithoutHash(consumedGrant, 'grantHash'));
    index.capabilityGrants.set(consumedGrant.grantId, consumedGrant);
    index.submissions.set(uncertainty.submissionId, {
      kind: 'operating-submission',
      schemaVersion: '1.0.0',
      protocolVersion: PROTOCOL_VERSION,
      submissionId: uncertainty.submissionId,
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
    index.governedOperations.set(operation.operationId, clone(operation));
    index.operationReplayIndex.set(operation.operationId, {
      operationId: operation.operationId,
      operationKind: 'rollback',
      requestFingerprint: operation.requestFingerprint,
      actionId: operation.action.actionId,
      actionRevision: operation.action.revision,
      actionHash: operation.action.actionHash,
      intentEventId: operation.intentEventId,
      operationHash: operation.operationHash,
      payloadArtifactId: request.payload.artifactId,
      payloadHash: request.payload.contentHash,
      baselineArtifactId: request.rollbackBaseline.artifactId,
      baselineHash: request.rollbackBaseline.contentHash,
      targetBeforeHash: request.targetBeforeHash,
      reservedResultId: terminal.resultId,
      reservedResultArtifactId: terminal.resultArtifactId,
      reservedSubmissionId: terminal.submissionId,
      reservedTerminalEventIds: clone(terminal.eventIds),
      reservedUncertaintyResultId: uncertainty.resultId,
      reservedUncertaintyResultArtifactId: uncertainty.resultArtifactId,
      reservedUncertaintySubmissionId: uncertainty.submissionId,
      reservedUncertaintyTerminalEventIds: clone(uncertainty.eventIds),
      reservedCompletedAt: terminal.completedAt,
      reservedCorrelationId: terminal.correlationId,
      terminalResultId: null,
      terminalReceipt: null,
    });
    const validationIndex = {
      ...index,
      eventReplay: new Map(index.eventReplay).set(event.eventId, eventReplayEntry(event)),
    };
    assertOperatingRollbackAuthorityChainIndexV2(
      validationIndex,
      operation,
      validationIndex.operationReplayIndex.get(operation.operationId),
    );
  }

  return function applyAuthorityRuntimeEvent(index, event) {
    switch (event.type) {
      case 'policy.evaluated': {
        requireRuntimeIntelligenceActor(event);
        const evaluation = event.payload;
        const action = index.actions.get(evaluation.action.actionId);
        const configuredPolicies = [...index.actionPolicies.values()];
        if (
          !index.authorityHistoryEnabled ||
          event.entityId !== evaluation.evaluationId ||
          event.requestHash !== evaluation.inputHash ||
          event.timestamp !== evaluation.evaluatedAt ||
          !action ||
          action.sourceCycleId !== event.cycleId ||
          action.revision !== evaluation.action.revision ||
          action.actionHash !== evaluation.action.actionHash ||
          index.policyEvaluations.has(evaluation.evaluationId)
        ) {
          throw runtimeError(
            'POLICY_EVALUATION_REJECTED',
            'Policy Event must bind one new exact current Action evaluation and configured policy set.',
            {
              evaluationId: evaluation.evaluationId,
            },
          );
        }
        try {
          assertOperatingPolicyEvaluationV2(evaluation, { action, configuredPolicies });
          const effectivePolicy = index.actionPolicies.get(
            `${evaluation.policy.policyId}@${evaluation.policy.policyVersion}`,
          );
          if (!effectivePolicy || effectivePolicy.policyHash !== evaluation.policy.policyHash) {
            throw runtimeError(
              'POLICY_EVALUATION_REJECTED',
              'Effective policy is unavailable from configured runtime state.',
            );
          }
          const priorEvaluations = [...index.policyEvaluations.values()]
            .filter(
              (prior) =>
                prior.action.actionId === action.actionId &&
                prior.action.revision === action.revision &&
                prior.action.actionHash === action.actionHash,
            )
            .sort(
              (left, right) =>
                right.evaluatedAt.localeCompare(left.evaluatedAt) ||
                right.evaluationId.localeCompare(left.evaluationId),
            );
          for (const policyRequirementId of effectivePolicy.approvalRequirementIds) {
            const requirementId = deriveOperatingApprovalRequirementInstanceIdV2({
              policyRequirementId,
              evaluationId: evaluation.evaluationId,
            });
            let requirement = index.approvalRequirements.get(requirementId);
            if (!requirement) {
              const template = priorEvaluations
                .map((prior) =>
                  index.approvalRequirements.get(
                    deriveOperatingApprovalRequirementInstanceIdV2({
                      policyRequirementId,
                      evaluationId: prior.evaluationId,
                    }),
                  ),
                )
                .find(Boolean);
              if (!template) {
                throw runtimeError(
                  'APPROVAL_REQUIRED',
                  'Initial approval requirement configuration is unavailable for this policy template.',
                  {
                    requirementId,
                  },
                );
              }
              requirement = createOperatingApprovalRequirementV2({
                policyRequirementId,
                evaluation,
                action,
                parties: template.parties,
                threshold: template.threshold,
                expiresAt: template.expiresAt,
                consumable: template.consumable,
              });
              index.approvalRequirements.set(requirement.requirementId, clone(requirement));
            }
            assertOperatingApprovalRequirementV2(requirement, { evaluation, action });
          }
        } catch (error) {
          throw runtimeError(
            error.code ?? 'POLICY_EVALUATION_REJECTED',
            error.message,
            error.details?.context ?? {},
          );
        }
        index.policyEvaluations.set(evaluation.evaluationId, clone(evaluation));
        return;
      }
      case 'approval.recorded': {
        const record = event.payload;
        const evaluation = index.policyEvaluations.get(record.evaluationId);
        const action = index.actions.get(record.action.actionId);
        const requirement = index.approvalRequirements.get(record.requirementId);
        const currentEvaluation = [...index.policyEvaluations.values()]
          .filter((entry) => entry.action.actionId === record.action.actionId)
          .sort(
            (left, right) =>
              left.evaluatedAt.localeCompare(right.evaluatedAt) ||
              left.evaluationId.localeCompare(right.evaluationId),
          )
          .at(-1);
        if (
          !evaluation ||
          !action ||
          !requirement ||
          currentEvaluation?.evaluationId !== evaluation.evaluationId ||
          event.entityId !== record.approvalId ||
          event.cycleId !== action.sourceCycleId ||
          event.timestamp !== record.issuedAt ||
          event.actor.kind !== record.actor.kind ||
          event.actor.id !== record.actor.actorId
        ) {
          throw runtimeError(
            'APPROVAL_INVALID',
            'Approval Event must bind the current evaluation, Action, requirement, actor, and timestamp.',
            {
              approvalId: record.approvalId,
            },
          );
        }
        try {
          const currentRequirements = evaluation.approvalRequirementIds.map((requirementId) =>
            index.approvalRequirements.get(requirementId),
          );
          if (currentRequirements.some((candidate) => !candidate)) {
            throw runtimeError(
              'APPROVAL_REQUIRED',
              'Current evaluation approval requirements are incomplete.',
            );
          }
          const appended = appendOperatingApprovalRecordV2({
            records: [...index.approvalRecords.values()],
            record,
            requirement,
            requirements: currentRequirements,
          });
          index.approvalRecords = indexBy(appended.records, 'approvalId', 'approval record');
        } catch (error) {
          throw runtimeError(
            error.code ?? 'APPROVAL_INVALID',
            error.message,
            error.details?.context ?? {},
          );
        }
        return;
      }
      case 'capability.availability-recorded': {
        const availability = event.payload;
        if (
          !index.authorityHistoryEnabled ||
          !['runtime', 'engine'].includes(event.actor.kind) ||
          event.entityId !== availability.availabilityId ||
          event.timestamp !== availability.checkedAt ||
          index.capabilityAvailability.has(availability.availabilityId)
        ) {
          throw runtimeError(
            'CAPABILITY_UNAVAILABLE',
            'Capability availability Event must record one fresh runtime-owned check.',
            {
              availabilityId: availability?.availabilityId ?? null,
            },
          );
        }
        assertCanonicalRecordHash(
          availability,
          'availabilityHash',
          'CAPABILITY_UNAVAILABLE',
          `Capability availability ${availability.availabilityId}`,
        );
        index.capabilityAvailability.set(availability.availabilityId, clone(availability));
        return;
      }
      case 'capability.granted': {
        const grant = event.payload;
        const assignment = index.assignments.get(grant.assignmentId);
        const action = index.actions.get(grant.action.actionId);
        const evaluation = index.policyEvaluations.get(grant.evaluationId);
        const approvals = evaluation
          ? [...index.approvalRecords.values()].filter(
              ({ evaluationId }) => evaluationId === evaluation.evaluationId,
            )
          : [];
        const rollbackGrant =
          assignment?.assignmentKind === 'execution' &&
          assignment?.outputContract?.schemaId === 'operating-rollback-result';
        if (
          !index.authorityHistoryEnabled ||
          event.actor.kind !== 'engine' ||
          event.actor.id !== grant.issuer.id ||
          event.entityId !== grant.grantId ||
          event.cycleId !== action?.sourceCycleId ||
          event.timestamp !== grant.issuedAt ||
          !assignment ||
          assignment.state !== 'running' ||
          assignment.capabilityGrantId !== grant.grantId ||
          assignment.governedOperationId !== grant.operationId ||
          !action ||
          (rollbackGrant
            ? !['approved', 'verifying', 'completed'].includes(action.state)
            : action.state !== 'approved') ||
          !evaluation ||
          approvals.some((approval) => !approval) ||
          index.capabilityGrants.has(grant.grantId)
        ) {
          throw runtimeError(
            'CAPABILITY_GRANT_INVALID',
            'Capability grant Event must bind one current Action, running execution Assignment, and exact authority set.',
            {
              grantId: grant?.grantId ?? null,
              actionState: action?.state ?? null,
              assignmentKind: assignment?.assignmentKind ?? null,
              outputSchemaId: assignment?.outputContract?.schemaId ?? null,
            },
          );
        }
        const requirements = evaluation.approvalRequirementIds.map((requirementId) =>
          index.approvalRequirements.get(requirementId),
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
            error.code ?? 'CAPABILITY_GRANT_INVALID',
            error.message,
            error.details?.context ?? {},
          );
        }
        if (
          !disposition.complete ||
          disposition.disposition !== 'approved' ||
          !sameCanonicalStringSet(disposition.approvalIds, grant.approvalIds) ||
          grant.consumedAt !== null ||
          grant.revokedAt !== null ||
          Date.parse(grant.expiresAt) <= Date.parse(event.timestamp)
        ) {
          throw runtimeError(
            'CAPABILITY_GRANT_INVALID',
            'Capability grant must be a fresh one-use grant for the exact approved authority set.',
            {
              grantId: grant.grantId,
            },
          );
        }
        assertCanonicalRecordHash(
          grant,
          'grantHash',
          'CAPABILITY_GRANT_INVALID',
          `Capability grant ${grant.grantId}`,
        );
        index.capabilityGrants.set(grant.grantId, clone(grant));
        return;
      }
      case 'rollback.plan-recorded': {
        const plan = event.payload;
        const operation = index.governedOperations.get(plan.operationId);
        const result = index.executionResults.get(plan.executionResultId);
        const action = index.actions.get(plan.action.actionId);
        if (
          !index.authorityHistoryEnabled ||
          event.actor.kind !== 'engine' ||
          event.entityId !== plan.rollbackPlanId ||
          event.cycleId !== action?.sourceCycleId ||
          event.timestamp !== result?.completedAt ||
          index.rollbackPlans.has(plan.rollbackPlanId) ||
          operation?.operationKind !== 'execute' ||
          !['succeeded', 'partial'].includes(operation?.state) ||
          operation?.resultId !== result?.resultId ||
          result?.operationId !== operation?.operationId ||
          result?.baselineArtifactId !== plan.baselineArtifactId ||
          result?.baselineHash !== plan.baselineHash ||
          result?.targetAfterHash === null ||
          plan.steps.some(
            ({ expectedTargetHash }) => expectedTargetHash !== result.targetAfterHash,
          ) ||
          sha256Jcs(plan.action) !== sha256Jcs(operation?.action) ||
          sha256Jcs(plan.capability) !== sha256Jcs(operation?.capability) ||
          plan.effectClass !== operation?.effectClass ||
          sha256Jcs(plan.executor) !== sha256Jcs(operation?.executor) ||
          plan.verificationPlanId !== operation?.verificationPlanId ||
          !isOperatingRollbackEligibilityV2(plan.eligibility) ||
          Date.parse(plan.expiresAt) <= Date.parse(event.timestamp)
        ) {
          throw runtimeError(
            'ROLLBACK_NOT_ELIGIBLE',
            'Rollback plan must bind one exact reversible terminal execution and immutable baseline.',
            {
              rollbackPlanId: plan?.rollbackPlanId ?? null,
            },
          );
        }
        assertCanonicalRecordHash(
          plan,
          'planHash',
          'ROLLBACK_NOT_ELIGIBLE',
          `Rollback plan ${plan.rollbackPlanId}`,
        );
        index.rollbackPlans.set(plan.rollbackPlanId, clone(plan));
        return;
      }
      case 'operation.intent-recorded': {
        const { operation, request, terminal } = event.payload;
        if (operation.operationKind === 'rollback') {
          applyOperatingRollbackIntentV2(index, event);
          return;
        }
        const uncertaintyTerminal = terminal.uncertainty;
        const assignment = index.assignments.get(operation.assignmentId);
        const action = index.actions.get(operation.action.actionId);
        const evaluation = index.policyEvaluations.get(operation.evaluationId);
        const grant = index.capabilityGrants.get(operation.grantId);
        const terminalSubmission = index.submissions.get(terminal.submissionId);
        const uncertaintySubmission = index.submissions.get(uncertaintyTerminal.submissionId);
        const approvals = evaluation
          ? [...index.approvalRecords.values()].filter(
              ({ evaluationId }) => evaluationId === evaluation.evaluationId,
            )
          : [];
        const requirements =
          evaluation?.approvalRequirementIds.map((requirementId) =>
            index.approvalRequirements.get(requirementId),
          ) ?? [];
        const capabilityAvailability = capabilityAvailabilityForGovernedOperation(index, {
          checkedAt: event.timestamp,
          capability: operation.capability,
          target: operation.target,
          grant,
        });
        const available =
          capabilityAvailability?.status === 'available' &&
          Date.parse(capabilityAvailability.expiresAt) > Date.parse(event.timestamp);
        const priorActionOwner = findOperatingExactActionOperationOwnerV2(
          [...index.governedOperations.values()],
          operation.action,
        );
        const terminalEventIds = [
          ...Object.values(terminal.eventIds),
          ...Object.values(uncertaintyTerminal.eventIds),
        ];
        const expectedInputArtifactIds = action
          ? [...new Set([action.sourceArtifactId, ...action.preconditionArtifactIds])].sort()
          : [];
        let expectedFingerprint = null;
        try {
          expectedFingerprint = deriveContainedExecutorRequestFingerprintFromBindingV2({
            operation,
            payload: request.payload,
            rollbackBaseline: request.rollbackBaseline,
          });
        } catch {
          expectedFingerprint = null;
        }
        if (
          !index.authorityHistoryEnabled ||
          event.actor.kind !== 'engine' ||
          event.actor.id !== grant?.issuer.id ||
          event.entityId !== operation.operationId ||
          event.cycleId !== action?.sourceCycleId ||
          event.timestamp !== operation.createdAt ||
          event.requestHash !== operation.requestFingerprint ||
          expectedFingerprint !== operation.requestFingerprint ||
          request.targetBeforeHash !==
            (request.rollbackBaseline?.contentHash ?? request.targetBeforeHash) ||
          request.payload.artifactId === request.rollbackBaseline?.artifactId ||
          Date.parse(terminal.completedAt) < Date.parse(operation.createdAt) ||
          terminal.correlationId !== event.correlationId ||
          new Set(terminalEventIds).size !== terminalEventIds.length ||
          terminalEventIds.includes(event.eventId) ||
          terminalEventIds.some((eventId) => index.eventReplay.has(eventId)) ||
          index.executionResults.has(terminal.resultId) ||
          index.executionResults.has(uncertaintyTerminal.resultId) ||
          index.artifacts.has(terminal.resultArtifactId) ||
          index.artifacts.has(uncertaintyTerminal.resultArtifactId) ||
          terminal.resultId === uncertaintyTerminal.resultId ||
          terminal.resultArtifactId === uncertaintyTerminal.resultArtifactId ||
          terminal.submissionId === uncertaintyTerminal.submissionId ||
          uncertaintySubmission ||
          !terminalSubmission ||
          terminalSubmission.state !== 'issued' ||
          terminalSubmission.assignmentId !== operation.assignmentId ||
          terminalSubmission.artifactId !== null ||
          terminalSubmission.issuedAt !== operation.createdAt ||
          operation.intentEventId !== event.eventId ||
          operation.operationKind !== 'execute' ||
          operation.state !== 'dispatching' ||
          operation.resultId !== null ||
          !assignment ||
          assignment.state !== 'running' ||
          assignment.governedOperationId !== operation.operationId ||
          assignment.capabilityGrantId !== operation.grantId ||
          !action ||
          action.state !== 'approved' ||
          operation.action.actionId !== action.actionId ||
          operation.action.revision !== action.revision ||
          operation.action.actionHash !== action.actionHash ||
          !sameCanonicalStringSet(
            operation.preconditionArtifactIds,
            action.preconditionArtifactIds,
          ) ||
          !sameCanonicalStringSet(operation.inputArtifactIds, expectedInputArtifactIds) ||
          !operation.inputArtifactIds.includes(request.payload.artifactId) ||
          (request.rollbackBaseline !== null &&
            !operation.inputArtifactIds.includes(request.rollbackBaseline.artifactId)) ||
          operation.verificationPlanId !== action.verificationPlanId ||
          operation.capability.id !== action.requestedCapability.id ||
          operation.capability.version !== action.requestedCapability.version ||
          sha256Jcs(operation.target) !== sha256Jcs(action.targetBinding) ||
          operation.effectClass !== action.effectClass ||
          !evaluation ||
          grant?.operationId !== operation.operationId ||
          grant?.assignmentId !== operation.assignmentId ||
          grant?.evaluationId !== operation.evaluationId ||
          sha256Jcs(grant?.action) !== sha256Jcs(operation.action) ||
          sha256Jcs(grant?.capability) !== sha256Jcs(operation.capability) ||
          sha256Jcs(grant?.target) !== sha256Jcs(operation.target) ||
          grant?.effectClass !== operation.effectClass ||
          approvals.some((approval) => !approval) ||
          requirements.some((requirement) => !requirement) ||
          !available ||
          priorActionOwner ||
          index.governedOperations.has(operation.operationId) ||
          index.operationReplayIndex.has(operation.operationId)
        ) {
          throw runtimeError(
            'OPERATION_CONFLICT',
            'Operation intent must establish one fresh durable dispatch owner for the exact current authority chain.',
            {
              operationId: operation?.operationId ?? null,
            },
          );
        }
        assertCanonicalRecordHash(
          operation,
          'operationHash',
          'OPERATION_CONFLICT',
          `Governed operation ${operation.operationId}`,
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
        if (
          !disposition.complete ||
          disposition.disposition !== 'approved' ||
          !sameCanonicalStringSet(disposition.approvalIds, operation.approvalIds)
        ) {
          throw runtimeError(
            'APPROVAL_REQUIRED',
            'Operation intent cannot consume an incomplete or divergent approval set.',
            {
              operationId: operation.operationId,
            },
          );
        }
        assertOperatingExecuteOperationV2({
          operation,
          action,
          assignment,
          evaluation,
          evaluations: [...index.policyEvaluations.values()],
          configuredPolicies: [...index.actionPolicies.values()],
          grant,
          requirements,
          approvals,
          capabilityAvailability,
          request,
          timestamp: event.timestamp,
        });
        if (operation.approvalIds.length > 0) {
          const consumed = consumeOperatingApprovalRecordsV2({
            approvals: [...index.approvalRecords.values()],
            requirements,
            approvalIds: operation.approvalIds,
            operationId: operation.operationId,
          });
          index.approvalRecords = indexBy(consumed.records, 'approvalId', 'approval record');
        }
        const consumedGrant = { ...clone(grant), consumedAt: event.timestamp };
        consumedGrant.grantHash = sha256Jcs(recordWithoutHash(consumedGrant, 'grantHash'));
        index.capabilityGrants.set(consumedGrant.grantId, consumedGrant);
        const uncertaintySubmissionRecord = {
          kind: 'operating-submission',
          schemaVersion: '1.0.0',
          protocolVersion: PROTOCOL_VERSION,
          submissionId: uncertaintyTerminal.submissionId,
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
        };
        index.submissions.set(uncertaintyTerminal.submissionId, uncertaintySubmissionRecord);
        const replayRecord = {
          operationId: operation.operationId,
          operationKind: operation.operationKind,
          requestFingerprint: operation.requestFingerprint,
          actionId: operation.action.actionId,
          actionRevision: operation.action.revision,
          actionHash: operation.action.actionHash,
          intentEventId: operation.intentEventId,
          operationHash: operation.operationHash,
          payloadArtifactId: request.payload.artifactId,
          payloadHash: request.payload.contentHash,
          baselineArtifactId: request.rollbackBaseline?.artifactId ?? null,
          baselineHash: request.rollbackBaseline?.contentHash ?? null,
          targetBeforeHash: request.targetBeforeHash,
          reservedResultId: terminal.resultId,
          reservedResultArtifactId: terminal.resultArtifactId,
          reservedSubmissionId: terminal.submissionId,
          reservedTerminalEventIds: clone(terminal.eventIds),
          reservedUncertaintyResultId: uncertaintyTerminal.resultId,
          reservedUncertaintyResultArtifactId: uncertaintyTerminal.resultArtifactId,
          reservedUncertaintySubmissionId: uncertaintyTerminal.submissionId,
          reservedUncertaintyTerminalEventIds: clone(uncertaintyTerminal.eventIds),
          reservedCompletedAt: terminal.completedAt,
          reservedCorrelationId: terminal.correlationId,
          terminalResultId: null,
          terminalReceipt: null,
        };
        assertOperatingDispatchExecutionProjectionsV2({
          operation,
          assignment,
          action,
          grant: consumedGrant,
          successSubmission: terminalSubmission,
          uncertaintySubmission: uncertaintySubmissionRecord,
          replayEntry: replayRecord,
        });
        index.governedOperations.set(operation.operationId, clone(operation));
        index.operationReplayIndex.set(operation.operationId, replayRecord);
        return;
      }
      case 'execution.result-recorded': {
        const { result, receipt } = event.payload;
        const operation = index.governedOperations.get(result.operationId);
        const assignment = index.assignments.get(result.assignmentId);
        const grant = index.capabilityGrants.get(result.grantId);
        const artifact = index.artifacts.get(result.resultArtifactId);
        const submission = artifact
          ? [...index.submissions.values()].find(
              (candidate) =>
                candidate.assignmentId === result.assignmentId &&
                candidate.artifactId === result.resultArtifactId &&
                candidate.state === 'accepted',
            )
          : null;
        const replayEntry = index.operationReplayIndex.get(result.operationId);
        const reservation = reservedExecutionTerminalForStatus(replayEntry, result.status);
        const requiredEventIds =
          operation && submission
            ? [operation.intentEventId, ...submission.acceptanceEventIds, event.eventId]
            : [];
        const exactOperationFields = [
          'operationId',
          'operationKind',
          'requestFingerprint',
          'action',
          'assignmentId',
          'evaluationId',
          'approvalIds',
          'grantId',
          'capability',
          'target',
          'effectClass',
          'executor',
          'connector',
          'inputArtifactIds',
          'verificationPlanId',
          'rollbackPlanId',
        ];
        if (
          !operation ||
          !assignment ||
          !grant ||
          !artifact ||
          !submission ||
          !replayEntry ||
          event.actor.kind !== 'engine' ||
          event.actor.id !== grant.issuer.id ||
          event.entityId !== result.resultId ||
          event.cycleId !== assignment.cycleId ||
          event.timestamp !== result.completedAt ||
          event.correlationId !== replayEntry?.reservedCorrelationId ||
          result.resultId !== reservation.resultId ||
          result.resultArtifactId !== reservation.resultArtifactId ||
          submission?.submissionId !== reservation.submissionId ||
          result.completedAt !== replayEntry?.reservedCompletedAt ||
          reservation.eventIds.resultRecorded !== event.eventId ||
          sha256Jcs(submission?.acceptanceEventIds) !==
            sha256Jcs([
              reservation.eventIds.submitted,
              reservation.eventIds.artifactCreated,
              reservation.eventIds.validated,
            ]) ||
          operation.state !== 'dispatching' ||
          operation.resultId !== null ||
          assignment.state !== 'validated' ||
          grant.consumedAt !== operation.createdAt ||
          grant.revokedAt !== null ||
          index.executionResults.has(result.resultId) ||
          exactOperationFields.some(
            (field) => sha256Jcs(result[field]) !== sha256Jcs(operation[field]),
          ) ||
          !sameCanonicalStringSet(result.outputArtifactIds, [result.resultArtifactId]) ||
          artifact.assignmentId !== assignment.assignmentId ||
          artifact.schemaId !== 'operating-execution-result' ||
          artifact.artifactSchemaVersion !== PROTOCOL_VERSION ||
          artifact.mediaType !== 'application/json' ||
          artifact.encoding !== 'utf-8' ||
          artifact.canonicalHash !== sha256Jcs(result) ||
          !sameCanonicalStringSet(result.eventIds, requiredEventIds) ||
          result.eventIds.some(
            (eventId) =>
              eventId !== event.eventId &&
              index.eventReplay.get(eventId)?.cycleId !== event.cycleId,
          )
        ) {
          throw runtimeError(
            'RESULT_CONTRACT_INVALID',
            'Execution result must equal the exact accepted bytes and complete durable operation chain.',
            {
              resultId: result?.resultId ?? null,
              operationId: result?.operationId ?? null,
            },
          );
        }
        assertCanonicalRecordHash(
          result,
          'resultHash',
          'RESULT_CONTRACT_INVALID',
          `Execution result ${result.resultId}`,
        );
        const nextOperation = {
          ...clone(operation),
          state: result.status,
          resultId: result.resultId,
          updatedAt: result.completedAt,
        };
        nextOperation.operationHash = sha256Jcs(recordWithoutHash(nextOperation, 'operationHash'));
        const nextReplayEntry = {
          ...clone(replayEntry),
          terminalResultId: result.resultId,
          terminalReceipt: clone(receipt),
        };
        const validationIndex = {
          ...index,
          governedOperations: new Map(index.governedOperations).set(
            nextOperation.operationId,
            nextOperation,
          ),
          operationReplayIndex: new Map(index.operationReplayIndex).set(
            operation.operationId,
            nextReplayEntry,
          ),
          eventReplay: new Map(index.eventReplay).set(event.eventId, eventReplayEntry(event)),
        };
        assertOperatingTerminalExecutionChainV2({
          index: validationIndex,
          result,
          operation: nextOperation,
          resultEvent: eventReplayEntry(event),
        });
        index.governedOperations.set(nextOperation.operationId, nextOperation);
        index.executionResults.set(result.resultId, clone(result));
        index.operationReplayIndex.set(operation.operationId, nextReplayEntry);
        return;
      }
      case 'rollback.result-recorded': {
        const result = event.payload;
        const operation = index.governedOperations.get(result.rollbackOperationId);
        const assignment = index.assignments.get(result.assignmentId);
        const grant = index.capabilityGrants.get(result.grantId);
        const plan = index.rollbackPlans.get(result.rollbackPlanId);
        const replayEntry = index.operationReplayIndex.get(result.rollbackOperationId);
        const success = ['succeeded', 'partial'].includes(result.status);
        const reservation = success
          ? {
              resultId: replayEntry?.reservedResultId,
              artifactId: replayEntry?.reservedResultArtifactId,
              submissionId: replayEntry?.reservedSubmissionId,
              eventIds: replayEntry?.reservedTerminalEventIds,
            }
          : {
              resultId: replayEntry?.reservedUncertaintyResultId,
              artifactId: replayEntry?.reservedUncertaintyResultArtifactId,
              submissionId: replayEntry?.reservedUncertaintySubmissionId,
              eventIds: replayEntry?.reservedUncertaintyTerminalEventIds,
            };
        const artifact = index.artifacts.get(result.resultArtifactId);
        const submission = index.submissions.get(reservation.submissionId);
        const expectedEventIds =
          operation && submission
            ? [operation.intentEventId, ...submission.acceptanceEventIds, event.eventId]
            : [];
        const operationMappings = {
          operationKind: 'operationKind',
          requestFingerprint: 'requestFingerprint',
          action: 'action',
          assignmentId: 'assignmentId',
          evaluationId: 'evaluationId',
          approvalIds: 'approvalIds',
          grantId: 'grantId',
          capability: 'capability',
          target: 'target',
          effectClass: 'effectClass',
          executor: 'executor',
          connector: 'connector',
          inputArtifactIds: 'inputArtifactIds',
          verificationPlanId: 'verificationPlanId',
          rollbackPlanId: 'rollbackPlanId',
        };
        if (
          !operation ||
          !assignment ||
          !grant ||
          !plan ||
          !replayEntry ||
          !artifact ||
          !submission ||
          event.actor.kind !== 'engine' ||
          event.actor.id !== grant.issuer.id ||
          event.entityId !== result.rollbackResultId ||
          event.cycleId !== assignment.cycleId ||
          event.timestamp !== result.completedAt ||
          event.correlationId !== replayEntry.reservedCorrelationId ||
          operation.operationKind !== 'rollback' ||
          operation.state !== 'dispatching' ||
          operation.resultId !== null ||
          result.rollbackResultId !== reservation.resultId ||
          result.resultArtifactId !== reservation.artifactId ||
          submission.submissionId !== reservation.submissionId ||
          reservation.eventIds.resultRecorded !== event.eventId ||
          result.rollbackOperationId !== operation.operationId ||
          result.originalOperationId !== operation.parentOperationId ||
          result.executionResultId !== plan.executionResultId ||
          Object.entries(operationMappings).some(
            ([resultField, operationField]) =>
              sha256Jcs(result[resultField]) !== sha256Jcs(operation[operationField]),
          ) ||
          result.baselineArtifactId !== plan.baselineArtifactId ||
          result.baselineHash !== plan.baselineHash ||
          result.targetBeforeHash !== replayEntry.targetBeforeHash ||
          (result.status === 'succeeded' && result.targetAfterHash !== plan.baselineHash) ||
          (!success && result.targetAfterHash !== null) ||
          result.completedAt !== replayEntry.reservedCompletedAt ||
          !sameCanonicalStringSet(result.outputArtifactIds, [result.resultArtifactId]) ||
          !sameCanonicalStringSet(result.eventIds, expectedEventIds) ||
          assignment.state !== 'validated' ||
          grant.consumedAt !== operation.createdAt ||
          grant.revokedAt !== null ||
          submission.state !== 'accepted' ||
          artifact.schemaId !== 'operating-rollback-result' ||
          artifact.artifactSchemaVersion !== PROTOCOL_VERSION ||
          artifact.canonicalHash !== sha256Jcs(result) ||
          index.rollbackResults.has(result.rollbackResultId)
        ) {
          throw runtimeError(
            'RESULT_CONTRACT_INVALID',
            'Rollback result must equal the exact accepted compensation bytes and durable authority chain.',
            {
              rollbackResultId: result?.rollbackResultId ?? null,
              rollbackOperationId: result?.rollbackOperationId ?? null,
            },
          );
        }
        assertCanonicalRecordHash(
          result,
          'resultHash',
          'RESULT_CONTRACT_INVALID',
          `Rollback result ${result.rollbackResultId}`,
        );
        const nextOperation = {
          ...clone(operation),
          state: result.status,
          resultId: result.rollbackResultId,
          updatedAt: result.completedAt,
        };
        nextOperation.operationHash = sha256Jcs(recordWithoutHash(nextOperation, 'operationHash'));
        const nextReplayEntry = {
          ...clone(replayEntry),
          terminalResultId: result.rollbackResultId,
          terminalReceipt: null,
        };
        const validationIndex = {
          ...index,
          governedOperations: new Map(index.governedOperations).set(
            nextOperation.operationId,
            nextOperation,
          ),
          rollbackResults: new Map(index.rollbackResults).set(
            result.rollbackResultId,
            clone(result),
          ),
          operationReplayIndex: new Map(index.operationReplayIndex).set(
            nextOperation.operationId,
            nextReplayEntry,
          ),
          eventReplay: new Map(index.eventReplay).set(event.eventId, eventReplayEntry(event)),
        };
        assertOperatingRollbackAuthorityChainIndexV2(
          validationIndex,
          nextOperation,
          nextReplayEntry,
        );
        index.governedOperations.set(nextOperation.operationId, nextOperation);
        index.rollbackResults.set(result.rollbackResultId, clone(result));
        index.operationReplayIndex.set(nextOperation.operationId, nextReplayEntry);
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
