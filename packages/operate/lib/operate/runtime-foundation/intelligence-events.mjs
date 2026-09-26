/**
 * Intelligence record Event handlers for the Operate runtime reducer: claims, findings, risks,
 * assumptions, Decisions, deltas, plans, ledgers, verification, outcomes, learning, scenarios
 * and triggers. runtime-foundation.mjs builds the handler with
 * createIntelligenceRuntimeEventHandlerV2 and injects the shared runtime helpers.
 */
import {
  assertOperatingDeltaV2,
  assertOperatingSnapshotV2,
  deriveOperatingDeltaV2,
} from './evidence-state.mjs';
import {
  buildOperatingActionVerificationMaterializationV2,
  buildOperatingActionVerificationOutcomeV2,
} from './execution.mjs';
import {
  assertOperatingIntelligencePlanV2,
  buildOperatingIntelligenceStateTransitionV2,
  buildOperatingTriggerScenarioTransitionV2,
} from './intelligence.mjs';
import { assertProtocolArtifact, sha256Jcs } from './protocol.mjs';

export function createIntelligenceRuntimeEventHandlerV2({
  PROTOCOL_VERSION,
  acceptedCausationForSnapshotSource,
  acceptedChairArtifactForLedger,
  acceptedSubmissionForArtifact,
  assertFreshIntelligenceIdentity,
  assertIntelligenceEvidenceRefs,
  assertIntelligenceSourceArtifact,
  assertIntelligenceTimestamp,
  buildRuntimeDecisionLedgerMaterialization,
  clone,
  intelligenceEventRecord,
  intelligenceProducerArtifacts,
  recordedDecisionLedgerMaterializationTimestamp,
  requireRuntimeIntelligenceActor,
  runtimeError,
  sameEvidenceBinding,
  terminalVerificationInsufficientEvidenceSource,
}) {
  function applyClaimRecorded(index, event, { artifactStore } = {}) {
    requireRuntimeIntelligenceActor(event);
    const { snapshot, operatingState, record } = intelligenceEventRecord(index, event);
    assertFreshIntelligenceIdentity(index, index.claims, record.claimId, event, record.claimId);
    assertIntelligenceTimestamp(event, record, 'createdAt');
    if (
      applyMaterializedLedgerRecord(index, event, snapshot, record, {
        collection: 'claims',
        idField: 'claimId',
        map: index.claims,
        artifactStore,
      })
    )
      return;
    assertIntelligenceEvidenceRefs(
      index,
      snapshot,
      [...record.supportingEvidenceRefIds, ...record.contradictingEvidenceRefIds],
      record.sourceArtifactId,
      { allowProducedSource: true },
    );
    buildOperatingIntelligenceStateTransitionV2({
      snapshot,
      operatingState,
      evidenceRefs: [...index.evidenceRefs.values()],
      evidenceArtifacts: [...index.artifacts.values()],
      sourceArtifacts: intelligenceProducerArtifacts(index, snapshot),
      existingDecisions: [...index.decisions.values()],
      existingActions: [...index.actions.values()],
      claims: [record],
    });
    assertIntelligenceSourceArtifact(index, event, record, snapshot, { allowProducedSource: true });
    index.claims.set(record.claimId, clone(record));
  }

  function applyRiskRecorded(index, event, { artifactStore } = {}) {
    requireRuntimeIntelligenceActor(event);
    const { snapshot, operatingState, record } = intelligenceEventRecord(index, event);
    assertFreshIntelligenceIdentity(index, index.risks, record.riskId, event, record.riskId);
    if (record.revision === 1) assertIntelligenceTimestamp(event, record, 'createdAt');
    assertIntelligenceTimestamp(event, record, 'updatedAt');
    if (
      applyMaterializedLedgerRecord(index, event, snapshot, record, {
        collection: 'risks',
        idField: 'riskId',
        map: index.risks,
        artifactStore,
      })
    )
      return;
    assertIntelligenceEvidenceRefs(
      index,
      snapshot,
      record.evidenceRefIds,
      record.sourceArtifactId,
      {
        allowProducedSource: true,
      },
    );
    buildOperatingIntelligenceStateTransitionV2({
      snapshot,
      operatingState,
      evidenceRefs: [...index.evidenceRefs.values()],
      evidenceArtifacts: [...index.artifacts.values()],
      sourceArtifacts: intelligenceProducerArtifacts(index, snapshot),
      existingDecisions: [...index.decisions.values()],
      existingActions: [...index.actions.values()],
      existingRisks: [...index.risks.values()],
      risks: [record],
    });
    assertIntelligenceSourceArtifact(index, event, record, snapshot, { allowProducedSource: true });
    index.risks.set(record.riskId, clone(record));
  }

  function applyFindingRecorded(index, event, { artifactStore } = {}) {
    requireRuntimeIntelligenceActor(event);
    const { snapshot, record } = intelligenceEventRecord(index, event);
    assertFreshIntelligenceIdentity(
      index,
      index.findings,
      record.findingId,
      event,
      record.findingId,
    );
    assertIntelligenceTimestamp(event, record, 'createdAt');
    assertIntelligenceTimestamp(event, record, 'updatedAt');
    if (
      !applyMaterializedLedgerRecord(index, event, snapshot, record, {
        collection: 'findings',
        idField: 'findingId',
        map: index.findings,
        artifactStore,
      })
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'A recorded intelligence Finding must be derived from one exact challenged Chair ledger.',
        {
          findingId: record.findingId,
          sourceArtifactId: record.sourceArtifactId,
        },
      );
    }
  }

  function applyAssumptionRecorded(index, event) {
    requireRuntimeIntelligenceActor(event);
    const { snapshot, operatingState, record } = intelligenceEventRecord(index, event);
    assertFreshIntelligenceIdentity(
      index,
      index.assumptions,
      record.assumptionId,
      event,
      record.assumptionId,
    );
    if (record.revision === 1) assertIntelligenceTimestamp(event, record, 'createdAt');
    assertIntelligenceTimestamp(event, record, 'updatedAt');
    assertIntelligenceEvidenceRefs(index, snapshot, record.evidenceRefIds, record.sourceArtifactId);
    buildOperatingIntelligenceStateTransitionV2({
      snapshot,
      operatingState,
      evidenceRefs: [...index.evidenceRefs.values()],
      evidenceArtifacts: [...index.artifacts.values()],
      existingDecisions: [...index.decisions.values()],
      existingActions: [...index.actions.values()],
      existingAssumptions: [...index.assumptions.values()],
      assumptions: [record],
    });
    assertIntelligenceSourceArtifact(index, event, record, snapshot);
    index.assumptions.set(record.assumptionId, clone(record));
  }

  function applyMaterializedLedgerRecord(
    index,
    event,
    snapshot,
    record,
    { collection, idField, map, artifactStore },
  ) {
    const ledgers = [...index.decisionLedgers.values()].filter(
      (ledger) =>
        ledger.snapshotId === snapshot.snapshotId &&
        (ledger.advisorArtifactIds.includes(record.sourceArtifactId) ||
          ledger.challengerArtifactId === record.sourceArtifactId),
    );
    if (ledgers.length === 0) return false;
    if (ledgers.length !== 1) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'A materialized intelligence source Artifact resolves to ambiguous Chair ledgers.',
        {
          sourceArtifactId: record.sourceArtifactId,
          snapshotId: snapshot.snapshotId,
        },
      );
    }
    const [ledger] = ledgers;
    const materialization = buildRuntimeDecisionLedgerMaterialization(
      index,
      ledger,
      event.timestamp,
      artifactStore,
    );
    const expected = materialization[collection].find(
      (candidate) => candidate[idField] === record[idField],
    );
    const chairArtifact = acceptedChairArtifactForLedger(index, ledger);
    const chairSubmission = acceptedSubmissionForArtifact(index, chairArtifact);
    if (
      !expected ||
      sha256Jcs(expected) !== sha256Jcs(record) ||
      event.cycleId !== chairArtifact.cycleId ||
      event.causationId !== (chairSubmission.acceptanceEventIds.at(-1) ?? null)
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Materialized intelligence record must equal the runtime derivation from exact accepted role bytes.',
        {
          [idField]: record[idField],
          ledgerId: ledger.ledgerId,
          sourceArtifactId: record.sourceArtifactId,
        },
      );
    }
    map.set(record[idField], clone(record));
    return true;
  }

  function applyDecisionLedgerMaterialized(index, event, { artifactStore } = {}) {
    requireRuntimeIntelligenceActor(event);
    const ledger = event.payload;
    if (event.entityId !== ledger?.ledgerId || index.decisionLedgers.has(ledger?.ledgerId)) {
      throw runtimeError(
        'CONCURRENT_MODIFICATION',
        'Decision ledger identity already exists or does not match its Event.',
        {
          ledgerId: ledger?.ledgerId ?? null,
        },
      );
    }
    let materialization;
    try {
      assertProtocolArtifact('operating-decision-ledger', ledger, {
        protocolVersion: PROTOCOL_VERSION,
      });
      materialization = buildRuntimeDecisionLedgerMaterialization(
        index,
        ledger,
        event.timestamp,
        artifactStore,
      );
    } catch (error) {
      throw runtimeError(
        error.code ?? 'STATE_TRANSITION_INVALID',
        error.message,
        error.details?.context ?? {
          ledgerId: ledger?.ledgerId ?? null,
        },
      );
    }
    const chairArtifact = index.artifacts.get(materialization.chairArtifactId);
    const chairSubmission = acceptedSubmissionForArtifact(index, chairArtifact);
    if (
      event.cycleId !== chairArtifact.cycleId ||
      event.causationId !== (chairSubmission.acceptanceEventIds.at(-1) ?? null)
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Decision-ledger Event must retain exact accepted Chair Artifact causation.',
        {
          ledgerId: ledger.ledgerId,
          artifactId: chairArtifact.artifactId,
        },
      );
    }
    index.decisionLedgers.set(ledger.ledgerId, clone(materialization.ledger));
  }

  function verifiedActionPlanMaterialization(index, verificationPlan, timestamp, artifactStore) {
    try {
      assertProtocolArtifact('operating-action-verification-plan', verificationPlan, {
        protocolVersion: PROTOCOL_VERSION,
      });
    } catch (error) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Action verification requires one typed verification-plan record.',
        {
          cause: error.code ?? null,
        },
      );
    }
    const ledgers = [...index.decisionLedgers.values()].filter(
      (ledger) =>
        acceptedChairArtifactForLedger(index, ledger).artifactId ===
          verificationPlan.sourceArtifactId && sameEvidenceBinding(ledger, verificationPlan),
    );
    if (ledgers.length !== 1) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'A verification plan must resolve to one exact challenged Chair ledger.',
        {
          verificationPlanId: verificationPlan.verificationPlanId,
          sourceArtifactId: verificationPlan.sourceArtifactId,
        },
      );
    }
    const ledger = ledgers[0];
    const snapshot = index.operatingSnapshots.get(ledger.snapshotId);
    const operatingState = snapshot ? index.operatingModelStates.get(snapshot.stateId) : null;
    if (!snapshot || !operatingState) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Action verification requires the immutable snapshot/state retained by its Chair ledger.',
        {
          ledgerId: ledger.ledgerId,
        },
      );
    }
    const ledgerMaterialization = buildRuntimeDecisionLedgerMaterialization(
      index,
      ledger,
      recordedDecisionLedgerMaterializationTimestamp(index, ledger),
      artifactStore,
    );
    let materialization;
    try {
      materialization = buildOperatingActionVerificationMaterializationV2({
        snapshot,
        operatingState,
        ledger,
        decisions: ledgerMaterialization.decisions,
        findings: ledgerMaterialization.findings,
        timestamp,
      });
    } catch (error) {
      throw runtimeError(
        error.code ?? 'RESULT_CONTRACT_INVALID',
        error.message,
        error.details?.context ?? {
          ledgerId: ledger.ledgerId,
        },
      );
    }
    const expectedPlan = materialization.verificationPlans.find(
      (record) => record.verificationPlanId === verificationPlan.verificationPlanId,
    );
    const expectedAction = materialization.actions.find(
      (record) => record.actionId === verificationPlan.actionId,
    );
    const sourceDecision = expectedAction
      ? index.decisions.get(expectedAction.sourceDecisionId)
      : null;
    const chairArtifact = acceptedChairArtifactForLedger(index, ledger);
    if (
      !expectedPlan ||
      !expectedAction ||
      !sourceDecision ||
      !chairArtifact ||
      sha256Jcs(expectedPlan) !== sha256Jcs(verificationPlan) ||
      sourceDecision.sourceArtifactId !== chairArtifact.artifactId ||
      !sameEvidenceBinding(sourceDecision, snapshot)
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Verification-plan Event must equal the runtime-issued Action plan derived from exact Chair bytes.',
        {
          verificationPlanId: verificationPlan.verificationPlanId,
          actionId: verificationPlan.actionId,
          ledgerId: ledger.ledgerId,
        },
      );
    }
    return {
      ledger,
      snapshot,
      operatingState,
      expectedAction,
      expectedPlan,
      sourceDecision,
      chairArtifact,
    };
  }

  function applyVerificationPlanRecorded(index, event, { artifactStore } = {}) {
    requireRuntimeIntelligenceActor(event);
    const verificationPlan = event.payload;
    const materialization = verifiedActionPlanMaterialization(
      index,
      verificationPlan,
      event.timestamp,
      artifactStore,
    );
    const { expectedAction, chairArtifact } = materialization;
    const chairSubmission = acceptedSubmissionForArtifact(index, chairArtifact);
    if (
      event.entityId !== verificationPlan.verificationPlanId ||
      event.cycleId !== chairArtifact.cycleId ||
      event.causationId !== (chairSubmission.acceptanceEventIds.at(-1) ?? null) ||
      index.verificationPlans.has(verificationPlan.verificationPlanId) ||
      index.actions.has(expectedAction.actionId)
    ) {
      throw runtimeError(
        'CONCURRENT_MODIFICATION',
        'Action verification plan or its derived Action already exists, or Event causation is invalid.',
        {
          verificationPlanId: verificationPlan?.verificationPlanId ?? null,
          actionId: expectedAction?.actionId ?? null,
        },
      );
    }
    index.actions.set(expectedAction.actionId, clone(expectedAction));
    index.verificationPlans.set(verificationPlan.verificationPlanId, clone(verificationPlan));
  }

  function observationForOutcome(index, outcome) {
    if (!Array.isArray(outcome.observationIds) || outcome.observationIds.length !== 1) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'This bounded verification implementation requires exactly one accepted metric observation.',
        {
          outcomeId: outcome?.outcomeId ?? null,
        },
      );
    }
    const observation = index.metricObservations.get(outcome.observationIds[0]);
    const snapshot = observation ? index.operatingSnapshots.get(observation.snapshotId) : null;
    const operatingState = snapshot ? index.operatingModelStates.get(snapshot.stateId) : null;
    if (!observation || !snapshot || !operatingState) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'An observed Action outcome requires one durable metric observation and its snapshot/state.',
        {
          observationId: outcome?.observationIds?.[0] ?? null,
        },
      );
    }
    return { observation, snapshot, operatingState };
  }

  function applyOutcomeRecorded(index, event, { artifactStore } = {}) {
    requireRuntimeIntelligenceActor(event);
    const outcome = event.payload;
    try {
      assertProtocolArtifact('operating-outcome', outcome, { protocolVersion: PROTOCOL_VERSION });
    } catch (error) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Outcome recording requires one typed outcome record.',
        { cause: error.code ?? null },
      );
    }
    if (outcome.status === 'insufficient-evidence') {
      const source = terminalVerificationInsufficientEvidenceSource(
        index,
        outcome,
        event.timestamp,
        artifactStore,
      );
      if (
        event.entityId !== outcome.outcomeId ||
        index.outcomes.has(outcome.outcomeId) ||
        sha256Jcs(source.records.outcome) !== sha256Jcs(outcome) ||
        event.cycleId !== source.cycle.cycleId ||
        event.causationId !== (source.submission.acceptanceEventIds.at(-1) ?? null)
      ) {
        throw runtimeError(
          'STATE_TRANSITION_INVALID',
          'Insufficient-evidence Outcome must equal the accepted runtime-issued terminal verification result.',
          {
            outcomeId: outcome.outcomeId,
          },
        );
      }
      index.outcomes.set(outcome.outcomeId, clone(outcome));
      return;
    }
    const action = index.actions.get(outcome.actionId);
    const verificationPlan = index.verificationPlans.get(outcome.verificationPlanId);
    const sourceDecision = action ? index.decisions.get(action.sourceDecisionId) : null;
    const { observation, snapshot } = observationForOutcome(index, outcome);
    let expected;
    try {
      expected = buildOperatingActionVerificationOutcomeV2({
        action,
        verificationPlan,
        observation,
        learning: {
          statement: 'Bounded verification outcome only.',
          decisionIds: [sourceDecision?.decisionId],
          assumptionIds: [],
        },
        timestamp: event.timestamp,
        sourceDecision,
      }).outcome;
    } catch (error) {
      throw runtimeError(
        error.code ?? 'RESULT_CONTRACT_INVALID',
        error.message,
        error.details?.context ?? {
          outcomeId: outcome.outcomeId,
        },
      );
    }
    if (
      event.entityId !== outcome.outcomeId ||
      index.outcomes.has(outcome.outcomeId) ||
      sha256Jcs(expected) !== sha256Jcs(outcome) ||
      event.cycleId !== index.artifacts.get(observation.sourceArtifactId)?.cycleId
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Outcome must equal the deterministic evaluation of one accepted observation and must retain its source Cycle.',
        {
          outcomeId: outcome.outcomeId,
        },
      );
    }
    assertIntelligenceEvidenceRefs(
      index,
      snapshot,
      outcome.evidenceRefIds,
      outcome.sourceArtifactId,
    );
    assertIntelligenceSourceArtifact(index, event, outcome, snapshot);
    index.outcomes.set(outcome.outcomeId, clone(outcome));
  }

  function applyLearningRecorded(index, event, { artifactStore } = {}) {
    requireRuntimeIntelligenceActor(event);
    const learning = event.payload;
    try {
      assertProtocolArtifact('operating-learning', learning, { protocolVersion: PROTOCOL_VERSION });
    } catch (error) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Learning recording requires one typed learning record.',
        { cause: error.code ?? null },
      );
    }
    const outcome = index.outcomes.get(learning.outcomeId);
    if (outcome?.status === 'insufficient-evidence') {
      const source = terminalVerificationInsufficientEvidenceSource(
        index,
        outcome,
        event.timestamp,
        artifactStore,
      );
      if (
        event.entityId !== learning.learningId ||
        index.learnings.has(learning.learningId) ||
        sha256Jcs(source.records.learning) !== sha256Jcs(learning) ||
        event.cycleId !== source.cycle.cycleId ||
        event.causationId !== (source.submission.acceptanceEventIds.at(-1) ?? null)
      ) {
        throw runtimeError(
          'STATE_TRANSITION_INVALID',
          'Insufficient-evidence Learning must equal its accepted runtime-issued terminal verification Outcome.',
          {
            learningId: learning.learningId,
          },
        );
      }
      index.learnings.set(learning.learningId, clone(learning));
      return;
    }
    const action = outcome ? index.actions.get(outcome.actionId) : null;
    const verificationPlan = outcome
      ? index.verificationPlans.get(outcome.verificationPlanId)
      : null;
    const sourceDecision = action ? index.decisions.get(action.sourceDecisionId) : null;
    const { observation, snapshot } = observationForOutcome(index, outcome ?? {});
    let expected;
    try {
      expected = buildOperatingActionVerificationOutcomeV2({
        action,
        verificationPlan,
        observation,
        learning: {
          statement: learning.statement,
          assumptionIds: learning.assumptionIds,
          decisionIds: learning.decisionIds,
        },
        timestamp: event.timestamp,
        sourceDecision,
      }).learning;
    } catch (error) {
      throw runtimeError(
        error.code ?? 'RESULT_CONTRACT_INVALID',
        error.message,
        error.details?.context ?? {
          learningId: learning.learningId,
        },
      );
    }
    if (
      event.entityId !== learning.learningId ||
      index.learnings.has(learning.learningId) ||
      sha256Jcs(expected) !== sha256Jcs(learning) ||
      learning.sourceArtifactId !== outcome.sourceArtifactId ||
      event.cycleId !== index.artifacts.get(observation.sourceArtifactId)?.cycleId
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Learning must equal the bounded observation-derived record for its durable Outcome.',
        {
          learningId: learning.learningId,
        },
      );
    }
    assertIntelligenceEvidenceRefs(
      index,
      snapshot,
      learning.evidenceRefIds,
      learning.sourceArtifactId,
    );
    assertIntelligenceSourceArtifact(index, event, learning, snapshot);
    index.learnings.set(learning.learningId, clone(learning));
  }

  function applyDecisionRevised(index, event, { artifactStore } = {}) {
    requireRuntimeIntelligenceActor(event);
    const { snapshot, operatingState, record } = intelligenceEventRecord(index, event);
    const sourceLedger = [...index.decisionLedgers.values()].find(
      (ledger) =>
        acceptedChairArtifactForLedger(index, ledger).artifactId === record.sourceArtifactId &&
        ledger.snapshotId === snapshot.snapshotId,
    );
    if (sourceLedger) {
      assertFreshIntelligenceIdentity(
        index,
        index.decisions,
        record.decisionId,
        event,
        record.decisionId,
      );
      assertIntelligenceTimestamp(event, record, 'createdAt');
      assertIntelligenceTimestamp(event, record, 'updatedAt');
      const materialization = buildRuntimeDecisionLedgerMaterialization(
        index,
        sourceLedger,
        event.timestamp,
        artifactStore,
      );
      const expected = materialization.decisions.find(
        ({ decisionId }) => decisionId === record.decisionId,
      );
      const chairArtifact = acceptedChairArtifactForLedger(index, sourceLedger);
      const chairSubmission = acceptedSubmissionForArtifact(index, chairArtifact);
      if (
        !expected ||
        sha256Jcs(expected) !== sha256Jcs(record) ||
        event.cycleId !== chairArtifact.cycleId ||
        event.causationId !== (chairSubmission.acceptanceEventIds.at(-1) ?? null)
      ) {
        throw runtimeError(
          'STATE_TRANSITION_INVALID',
          'Decision revision must equal the runtime-issued revision derived from its immutable Chair ledger.',
          {
            decisionId: record.decisionId,
            ledgerId: sourceLedger.ledgerId,
          },
        );
      }
      index.decisions.set(record.decisionId, clone(record));
      return;
    }
    assertFreshIntelligenceIdentity(
      index,
      index.decisions,
      record.decisionId,
      event,
      record.decisionId,
    );
    assertIntelligenceTimestamp(event, record, 'createdAt');
    assertIntelligenceTimestamp(event, record, 'updatedAt');
    assertIntelligenceEvidenceRefs(index, snapshot, record.evidenceRefIds, record.sourceArtifactId);
    const source = assertIntelligenceSourceArtifact(index, event, record, snapshot);
    if (record.sourceCycleId !== source.artifact.cycleId) {
      throw runtimeError(
        'OPERATING_SCOPE_INVALID',
        'Decision revision source cycle must equal the accepted source Artifact cycle.',
        {
          decisionId: record.decisionId,
          sourceCycleId: record.sourceCycleId,
          artifactCycleId: source.artifact.cycleId,
        },
      );
    }
    buildOperatingIntelligenceStateTransitionV2({
      snapshot,
      operatingState,
      evidenceRefs: [...index.evidenceRefs.values()],
      evidenceArtifacts: [...index.artifacts.values()],
      existingDecisions: [...index.decisions.values()],
      existingActions: [...index.actions.values()],
      decisionRevisions: [record],
    });
    index.decisions.set(record.decisionId, clone(record));
  }

  function applyDeltaDerived(index, event) {
    requireRuntimeIntelligenceActor(event);
    const { snapshot, operatingState, record } = intelligenceEventRecord(index, event);
    if (record.currentSnapshotId !== snapshot.snapshotId) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Delta record must match its explicit Event snapshot binding.',
        { deltaId: record.deltaId },
      );
    }
    assertFreshIntelligenceIdentity(index, index.deltas, record.deltaId, event, record.deltaId);
    assertIntelligenceTimestamp(event, record, 'derivedAt');
    const priorSnapshot =
      record.priorSnapshotId === null ? null : index.operatingSnapshots.get(record.priorSnapshotId);
    const priorState = priorSnapshot ? index.operatingModelStates.get(priorSnapshot.stateId) : null;
    if (record.priorSnapshotId !== null && (!priorSnapshot || !priorState)) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Delta predecessor snapshot/state must be durable before the Delta event.',
        {
          deltaId: record.deltaId,
          priorSnapshotId: record.priorSnapshotId,
        },
      );
    }
    assertIntelligenceEvidenceRefs(index, snapshot, snapshot.evidenceRefIds);
    const expected = deriveOperatingDeltaV2({
      deltaId: record.deltaId,
      currentSnapshot: snapshot,
      currentState: operatingState,
      priorSnapshot,
      priorState,
      evidenceRefs: [...index.evidenceRefs.values()],
      evidenceArtifacts: [...index.artifacts.values()],
      claims: [...index.claims.values()],
      metricObservations: [...index.metricObservations.values()],
      priorMetricObservations: [...index.metricObservations.values()],
      risks: [...index.risks.values()],
      assumptions: [...index.assumptions.values()],
      decisions: [...index.decisions.values()],
      outcomes: [...index.outcomes.values()],
      learnings: [...index.learnings.values()],
      sourceArtifactId: record.sourceArtifactId,
      derivedAt: event.timestamp,
    });
    if (sha256Jcs(record) !== sha256Jcs(expected)) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Delta Event payload must equal the deterministic current/prior snapshot comparison.',
        {
          deltaId: record.deltaId,
        },
      );
    }
    assertOperatingDeltaV2(record, { currentSnapshot: snapshot, priorSnapshot });
    assertIntelligenceSourceArtifact(index, event, record, snapshot);
    index.deltas.set(record.deltaId, clone(record));
  }

  function applyScenarioRecorded(index, event) {
    requireRuntimeIntelligenceActor(event);
    const { snapshot, operatingState, record } = intelligenceEventRecord(index, event);
    if (record.snapshotId !== snapshot.snapshotId) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Scenario record must match its explicit Event snapshot binding.',
        { scenarioId: record.scenarioId },
      );
    }
    assertFreshIntelligenceIdentity(
      index,
      index.scenarios,
      record.scenarioId,
      event,
      record.scenarioId,
    );
    assertIntelligenceTimestamp(event, record, 'createdAt');
    assertIntelligenceEvidenceRefs(index, snapshot, record.evidenceRefIds, record.sourceArtifactId);
    assertIntelligenceEvidenceRefs(
      index,
      snapshot,
      record.base.evidenceRefIds,
      record.base.sourceArtifactId,
    );
    assertIntelligenceEvidenceRefs(
      index,
      snapshot,
      record.upside.evidenceRefIds,
      record.upside.sourceArtifactId,
    );
    assertIntelligenceEvidenceRefs(
      index,
      snapshot,
      record.downside.evidenceRefIds,
      record.downside.sourceArtifactId,
    );
    buildOperatingTriggerScenarioTransitionV2({
      snapshot,
      operatingState,
      evidenceRefs: [...index.evidenceRefs.values()],
      evidenceArtifacts: [...index.artifacts.values()],
      scenarios: [record],
    });
    assertIntelligenceSourceArtifact(index, event, record, snapshot);
    index.scenarios.set(record.scenarioId, clone(record));
  }

  function applyTriggerRecorded(index, event) {
    requireRuntimeIntelligenceActor(event);
    const { snapshot, operatingState, record } = intelligenceEventRecord(index, event);
    if (record.snapshotId !== snapshot.snapshotId) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Trigger record must match its explicit Event snapshot binding.',
        { triggerId: record.triggerId },
      );
    }
    assertFreshIntelligenceIdentity(
      index,
      index.eventTriggers,
      record.triggerId,
      event,
      record.triggerId,
    );
    assertIntelligenceTimestamp(event, record, 'createdAt');
    assertIntelligenceEvidenceRefs(index, snapshot, record.evidenceRefIds, record.sourceArtifactId);
    buildOperatingTriggerScenarioTransitionV2({
      snapshot,
      operatingState,
      evidenceRefs: [...index.evidenceRefs.values()],
      evidenceArtifacts: [...index.artifacts.values()],
      triggers: [record],
    });
    assertIntelligenceSourceArtifact(index, event, record, snapshot);
    index.eventTriggers.set(record.triggerId, clone(record));
  }

  return function applyIntelligenceRecordRuntimeEvent(index, event, options = {}) {
    switch (event.type) {
      case 'claim.recorded':
        applyClaimRecorded(index, event, options);
        return;
      case 'finding.recorded':
        applyFindingRecorded(index, event, options);
        return;
      case 'risk.recorded':
        applyRiskRecorded(index, event, options);
        return;
      case 'assumption.recorded':
        applyAssumptionRecorded(index, event);
        return;
      case 'decision.revised':
        applyDecisionRevised(index, event, options);
        return;
      case 'delta.derived':
        applyDeltaDerived(index, event);
        return;
      case 'intelligence.plan-recorded': {
        const plan = event.payload;
        const cycle = index.cycles.get(event.cycleId);
        const snapshot = index.operatingSnapshots.get(plan.snapshotId);
        const delta = index.deltas.get(plan.deltaId);
        if (
          event.actor.kind !== 'runtime' ||
          event.actor.id !== 'openplanr' ||
          event.entityId !== plan.planId ||
          !cycle ||
          !snapshot ||
          !delta ||
          plan.createdAt !== event.timestamp ||
          plan.scopeId !== cycle.scopeId ||
          plan.domainId !== cycle.domainId ||
          plan.domainVersion !== cycle.domainVersion ||
          plan.snapshotId !== snapshot.snapshotId ||
          delta.currentSnapshotId !== snapshot.snapshotId ||
          plan.sourceArtifactId !== delta.sourceArtifactId ||
          index.intelligencePlans.has(plan.planId)
        ) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'Intelligence plan recording requires one new runtime-owned plan bound to its Cycle, snapshot, Delta, and source Artifact.',
            {
              planId: plan?.planId ?? null,
              cycleId: event.cycleId,
            },
          );
        }
        try {
          assertOperatingIntelligencePlanV2(plan);
          assertOperatingSnapshotV2(snapshot);
          assertOperatingDeltaV2(delta, { currentSnapshot: snapshot });
          acceptedCausationForSnapshotSource(index, snapshot, plan.sourceArtifactId);
        } catch (error) {
          throw runtimeError(
            error.code ?? 'STATE_TRANSITION_INVALID',
            error.message,
            error.details?.context ?? {
              planId: plan.planId,
            },
          );
        }
        index.intelligencePlans.set(plan.planId, clone(plan));
        return;
      }
      case 'decision-ledger.materialized':
        applyDecisionLedgerMaterialized(index, event, options);
        return;
      case 'verification.plan-recorded':
        applyVerificationPlanRecorded(index, event, options);
        return;
      case 'outcome.recorded':
        applyOutcomeRecorded(index, event, options);
        return;
      case 'learning.recorded':
        applyLearningRecorded(index, event, options);
        return;
      case 'scenario.recorded':
        applyScenarioRecorded(index, event);
        return;
      case 'trigger.recorded':
        applyTriggerRecorded(index, event);
        return;
      default:
        throw runtimeError(
          'CONTRACT_VERSION_UNSUPPORTED',
          `Unsupported Phase 1 event ${event.type}.`,
        );
    }
  };
}
