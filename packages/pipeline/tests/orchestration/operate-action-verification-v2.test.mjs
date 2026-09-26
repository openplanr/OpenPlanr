import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createOperatingResultTemplateV2 } from '../../lib/operate/result-packet-v2.mjs';
import {
  acceptOperatingAssignmentSubmissionV2,
  createNoModelReplayHookV2,
  createOperatingRuntimeEventV2,
  deriveOperatingChairLedgerIdV2,
  deriveOperatingRuntimeDeltaV2,
  deriveOperatingVerificationFeedbackV2,
  materializeOperatingActionVerificationV2,
  materializeOperatingDecisionLedgerV2,
  materializeOperatingStateSnapshotV2,
  planOperatingRuntimeIntelligenceBoardV2,
  preflightOperatingAssignmentResultV2,
  readOperatingArtifactRawBytesV2,
  reconstructOperatingVerificationPlanActionV2,
  recordOperatingActionVerificationOutcomeV2,
  recordOperatingIntelligenceStateV2,
  reduceOperatingRuntimeEventsV2,
} from '../../lib/operate/runtime-foundation.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import { checkpoint } from './operate-operating-intelligence-state-v2.test-support.mjs';

const SNAPSHOT_TIME = '2026-08-09T13:00:00.000Z';
const PLAN_TIME = '2026-08-09T13:01:00.000Z';
const ADVISOR_TIME = '2026-08-09T13:02:00.000Z';
const CHALLENGER_TIME = '2026-08-09T13:03:00.000Z';
const CHAIR_TIME = '2026-08-09T13:04:00.000Z';
const LEDGER_TIME = '2026-08-09T13:05:00.000Z';
const ACTION_TIME = '2026-08-09T13:06:00.000Z';
const OBSERVATION_TIME = '2026-08-09T13:07:00.000Z';
const OUTCOME_TIME = '2026-08-09T13:08:00.000Z';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
const valid = fixture('all-contracts-valid.json');
const clone = (value) => structuredClone(value);
const multilineText = (length, character = 'M') => `${character}\n${character.repeat(length - 2)}`;

function latestEventId(state) {
  return (
    state.eventReplayIndex.find(({ sequence }) => sequence === state.eventHead.sequence)?.eventId ??
    null
  );
}

function eventAfter(state, eventId, type, entityId, payload, timestamp, correlationId) {
  return createOperatingRuntimeEventV2(
    {
      eventId,
      timestamp,
      cycleId: state.cycles[0].cycleId,
      type,
      entityId,
      actor: { kind: 'engine', id: 'openplanr' },
      causationId: latestEventId(state),
      correlationId,
      payload,
    },
    { previousEvent: { sequence: state.eventHead.sequence, eventHash: state.eventHead.hash } },
  );
}

function claimAndStart(state, assignmentId, submissionId, suffix, timestamp) {
  const assignment = state.assignments.find((candidate) => candidate.assignmentId === assignmentId);
  const correlationId = `corr_verify_${suffix}`;
  const claimed = eventAfter(
    state,
    `evt_verify_${suffix}_claimed`,
    'assignment.claimed',
    assignmentId,
    {
      assignmentId,
      actorId: `${assignment.roleId}-verify-001`,
      actorKind: 'agent',
      runtime: 'codex',
      claimId: `claim_verify_${suffix}`,
      submissionId,
    },
    timestamp,
    correlationId,
  );
  const afterClaim = reduceOperatingRuntimeEventsV2([claimed], { initialState: state });
  const started = eventAfter(
    afterClaim,
    `evt_verify_${suffix}_started`,
    'assignment.started',
    assignmentId,
    {
      assignmentId,
      attempt: 1,
    },
    timestamp,
    correlationId,
  );
  return reduceOperatingRuntimeEventsV2([started], { initialState: afterClaim });
}

function acceptRole(
  state,
  assignmentId,
  submissionId,
  artifactId,
  artifactType,
  output,
  suffix,
  timestamp,
  artifactStore,
) {
  const assignment = state.assignments.find((candidate) => candidate.assignmentId === assignmentId);
  const bytes = Buffer.from(JSON.stringify(output), 'utf8');
  return acceptOperatingAssignmentSubmissionV2(
    {
      assignmentId,
      submissionId,
      actor: { actorId: `${assignment.roleId}-verify-001`, kind: 'agent', runtime: 'codex' },
      mediaType: 'application/json',
      encoding: 'utf-8',
      contentBase64: bytes.toString('base64'),
    },
    {
      artifactId,
      artifactType,
      inputArtifactIds: [...assignment.inputArtifactIds],
      timestamp,
      validatorVersion: '2.0.0',
      correlationId: `corr_verify_${suffix}`,
      eventIds: {
        submitted: `evt_verify_${suffix}_submitted`,
        artifactCreated: `evt_verify_${suffix}_artifact`,
        validated: `evt_verify_${suffix}_validated`,
      },
    },
    { initialState: state, artifactStore },
  ).state;
}

function issuedResultInputs(state, assignmentId, artifactStore) {
  const assignment = state.assignments.find((candidate) => candidate.assignmentId === assignmentId);
  return assignment.inputArtifactIds.flatMap((artifactId) => {
    const artifact = state.artifacts.find((candidate) => candidate.artifactId === artifactId);
    if (
      !artifact ||
      ![
        'operating-intelligence-input-bundle',
        'operating-advisor-result',
        'operating-challenger-review',
        'operating-decision-ledger',
      ].includes(artifact.schemaId)
    )
      return [];
    const rawBytes = readOperatingArtifactRawBytesV2(artifactStore, {
      artifactId,
      rawHash: artifact.rawHash,
    });
    return [
      {
        artifactId,
        schemaId: artifact.schemaId,
        value: JSON.parse(Buffer.from(rawBytes).toString('utf8')),
      },
    ];
  });
}

function advisorEvidenceLink(assignment) {
  const evidenceRefId =
    assignment.intelligenceContext.inputBundle.issuedEvidence[0]?.evidenceRefId ?? null;
  const absenceId = assignment.inputAbsences[0]?.absenceId ?? null;
  return {
    evidenceRefIds: evidenceRefId ? [evidenceRefId] : [],
    absenceIds: absenceId ? [absenceId] : [],
  };
}

function advisorResult(assignment, assumptionId, recommended) {
  const value = clone(createOperatingResultTemplateV2({ assignment }));
  const link = advisorEvidenceLink(assignment);
  value.summary = recommended
    ? 'Measure retention before changing allocation.'
    : 'This role has no additional recommendation beyond the bounded board evidence.';
  value.analysisMarkdown = 'The result uses only issued evidence and exposes material uncertainty.';
  value.inputAbsenceIds = assignment.inputAbsences.map(({ absenceId }) => absenceId);
  value.gaps = value.gaps.map((gap) => ({
    ...gap,
    impact: 'The missing evidence limits confidence in this professional lens.',
    recoveryPath: 'Issue one current authorized Evidence Artifact and rerun this analysis.',
  }));
  for (const answer of value.analysis.executiveQuestionAnswers) {
    answer.answer = recommended
      ? 'A reversible retention measurement is the best bounded next step.'
      : 'No distinct material direction is justified from this role evidence.';
    answer.evidenceRefIds = [...link.evidenceRefIds];
    answer.absenceIds = [...link.absenceIds];
  }
  if (!recommended) {
    value.outcome = assignment.inputAbsences.length > 0 ? 'partial' : 'quiet';
    value.recommendation = null;
    return value;
  }
  const claimId = `claim:${assignment.assignmentId}:1`;
  const riskId = `risk:${assignment.assignmentId}:1`;
  const alternativeId = `alternative:${assignment.assignmentId}:1`;
  value.outcome = 'recommendation';
  value.claims = [
    {
      localClaimId: claimId,
      statement:
        'A bounded retention measurement reduces the risk of changing allocation on a weak signal.',
      epistemicStatus: link.evidenceRefIds.length > 0 ? 'probable' : 'speculative',
      confidence: 0.6,
      supportingEvidenceRefIds: [...link.evidenceRefIds],
      contradictingEvidenceRefIds: [],
      assumptionIds: link.evidenceRefIds.length > 0 ? [] : [assumptionId],
      changeCondition: 'A current cohort observation contradicts the measured retention direction.',
    },
  ];
  value.risks = [
    {
      localRiskId: riskId,
      title: 'Weak-signal allocation',
      statement: 'Changing allocation before a bounded observation can optimize a weak signal.',
      likelihood: 0.5,
      impact: 'high',
      exposure: 'The next operating window could be allocated to the wrong constraint.',
      exposedSurfaces: ['Operating allocation'],
      claimIds: [claimId],
      evidenceRefIds: [...link.evidenceRefIds],
      mitigation: 'Observe retention by cohort before reallocating.',
      reversibility: 'The observation step is reversible before any allocation commitment.',
    },
  ];
  value.alternatives = [
    {
      localAlternativeId: alternativeId,
      title: 'Hold allocation',
      description: 'Keep allocation unchanged through the next observation window.',
      supportingClaimIds: [claimId],
      evidenceRefIds: [...link.evidenceRefIds],
      tradeoffs: ['Defers other learning while retaining full reversibility.'],
      costOfDelay: 'One bounded observation window.',
      reversibility: 'Fully reversible after the next accepted observation.',
    },
  ];
  value.recommendation = {
    localRecommendationId: `recommendation:${assignment.assignmentId}:1`,
    title: 'Measure retention before changing allocation',
    proposal: 'Measure retention by cohort before changing allocation.',
    rationaleClaimIds: [claimId],
    alternativeIds: [alternativeId],
    riskIds: [riskId],
    confidence: 0.6,
    expectedUpside: 'Reduces uncertainty before a resource commitment.',
    expectedDownside: 'Defers other learning by one bounded observation window.',
    uncertainty: 'Current evidence coverage remains limited.',
    reversibility: 'Revisit after the next accepted observation.',
    successMeasurementIds: [],
    revisitConditions: ['A new retention observation changes the metric materially.'],
  };
  for (const answer of value.analysis.executiveQuestionAnswers) answer.claimIds = [claimId];
  return value;
}

function verificationCheckpoint() {
  const base = checkpoint();
  const sourceArtifactId = base.sourceArtifactId;
  const evidenceRefId = base.evidenceRef.evidenceRefId;
  const cycleId = base.result.state.cycles[0].cycleId;
  const metric = { ...clone(base.metric), metricId: 'met_verify_001', observationIds: [] };
  const objective = {
    ...clone(valid['operating-objective']),
    objectiveId: 'obj_verify_001',
    metricIds: [metric.metricId],
    sourceArtifactId,
    evidenceRefIds: [evidenceRefId],
    createdAt: SNAPSHOT_TIME,
    updatedAt: SNAPSHOT_TIME,
  };
  const finding = {
    ...clone(valid['operating-finding']),
    findingId: 'fnd_verify_001',
    sourceCycleId: cycleId,
    sourceArtifactId,
    origin: 'persistent-work',
    createdAt: SNAPSHOT_TIME,
    updatedAt: SNAPSHOT_TIME,
  };
  for (const field of [
    'sourceAssignmentId',
    'sourceLocalFindingId',
    'findingType',
    'severity',
    'confidence',
    'targets',
    'supportingEvidenceRefIds',
    'contradictingEvidenceRefIds',
    'rationale',
    'correctionCondition',
  ])
    delete finding[field];
  const assumption = { ...clone(base.assumption), affectedDecisionIds: [], affectedActionIds: [] };
  const seedDecision = { ...clone(base.decision), assumptionIds: [assumption.assumptionId] };
  const snap = materializeOperatingStateSnapshotV2(
    {
      cycleId,
      scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
      domainContract: { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' },
      sourceArtifactIds: [sourceArtifactId],
      evidenceRefIds: [evidenceRefId],
      sourceRevisions: [{ sourceArtifactId, revision: 'r2', evidenceRefIds: [evidenceRefId] }],
      collections: {
        objectives: [objective],
        metrics: [metric],
        findings: [finding],
        decisions: [seedDecision],
        actions: [],
        risks: [],
        assumptions: [assumption],
      },
    },
    {
      snapshotId: 'snp_verify_001',
      stateId: 'oms_verify_001',
      timestamp: SNAPSHOT_TIME,
      correlationId: 'corr_verify_snapshot_001',
      eventIds: { snapshot: 'evt_verify_snapshot_001', state: 'evt_verify_state_001' },
    },
    { initialState: base.result.state, artifactStore: base.store },
  );
  return {
    base,
    snap,
    cycleId,
    sourceArtifactId,
    evidenceRefId,
    metric,
    objective,
    finding,
    assumption,
  };
}

function acceptedLedgerInput({ mutateLedger } = {}) {
  const seeded = verificationCheckpoint();
  const delta = deriveOperatingRuntimeDeltaV2(
    {
      cycleId: seeded.cycleId,
      snapshotId: seeded.snap.snapshot.snapshotId,
      stateId: seeded.snap.operatingState.stateId,
    },
    {
      deltaId: 'dlt_verify_001',
      eventId: 'evt_verify_delta_001',
      timestamp: PLAN_TIME,
      correlationId: 'corr_verify_delta_001',
    },
    { initialState: seeded.snap.state },
  );
  const planned = planOperatingRuntimeIntelligenceBoardV2(
    {
      cycleId: seeded.cycleId,
      snapshotId: seeded.snap.snapshot.snapshotId,
      stateId: seeded.snap.operatingState.stateId,
      deltaId: delta.delta.deltaId,
      focus: ['all'],
      domainDescriptor: fixture('business-domain-valid.json'),
      decisionOwnerActorId: 'owner-verify-001',
    },
    {
      eventId: 'evt_verify_plan_001',
      timestamp: PLAN_TIME,
      correlationId: 'corr_verify_plan_001',
    },
    { initialState: delta.state, artifactStore: seeded.base.store },
  );
  const advisorAssignments = planned.assignments
    .filter(({ assignmentKind }) => assignmentKind === 'advisor')
    .sort((left, right) => left.roleId.localeCompare(right.roleId));
  const challenger = planned.assignments.find(({ roleId }) => roleId === 'independent-challenge');
  const chair = planned.assignments.find(({ roleId }) => roleId === 'chair');
  const advisorArtifactIds = [];
  const advisorRecords = [];
  let state = planned.state;
  for (const [index, advisor] of advisorAssignments.entries()) {
    const suffix = `advisor_${index + 1}`;
    const advisorArtifactId = `art_verify_${suffix}`;
    state = claimAndStart(
      state,
      advisor.assignmentId,
      `sub_verify_${suffix}`,
      suffix,
      ADVISOR_TIME,
    );
    const running = state.assignments.find(
      ({ assignmentId }) => assignmentId === advisor.assignmentId,
    );
    const output = advisorResult(running, seeded.assumption.assumptionId, index === 0);
    state = acceptRole(
      state,
      advisor.assignmentId,
      `sub_verify_${suffix}`,
      advisorArtifactId,
      'advisor-result',
      output,
      suffix,
      ADVISOR_TIME,
      seeded.base.store,
    );
    advisorArtifactIds.push(advisorArtifactId);
    advisorRecords.push({ assignment: running, artifactId: advisorArtifactId, output });
  }
  const recommended = advisorRecords[0];
  const challengerArtifactId = 'art_verify_challenger_001';
  const chairArtifactId = 'art_verify_chair_001';
  state = claimAndStart(
    state,
    challenger.assignmentId,
    'sub_verify_challenger_001',
    'challenger',
    CHALLENGER_TIME,
  );
  const runningChallenger = state.assignments.find(
    ({ assignmentId }) => assignmentId === challenger.assignmentId,
  );
  const challengerOutput = clone(
    createOperatingResultTemplateV2({
      assignment: runningChallenger,
      inputArtifacts: issuedResultInputs(state, challenger.assignmentId, seeded.base.store),
    }),
  );
  const findingId = `finding:${challenger.assignmentId}:1`;
  const dissentId = `dissent:${challenger.assignmentId}:1`;
  const target = {
    advisorArtifactId: recommended.artifactId,
    analysisIds: [],
    claimIds: [recommended.output.claims[0].localClaimId],
    measurementIds: [],
    riskIds: [recommended.output.risks[0].localRiskId],
    recommendationIds: [recommended.output.recommendation.localRecommendationId],
  };
  challengerOutput.summary =
    'The bounded recommendation is reversible, but its downside must remain explicit.';
  challengerOutput.analysisMarkdown = 'The challenge targets the exact accepted Advisor sources.';
  challengerOutput.inputAbsenceIds = runningChallenger.inputAbsences.map(
    ({ absenceId }) => absenceId,
  );
  challengerOutput.findings = [
    {
      localFindingId: findingId,
      title: 'Weak-signal downside',
      statement:
        'The recommendation must not turn one bounded observation into an execution claim.',
      type: 'unpriced-downside',
      severity: 'medium',
      confidence: 0.62,
      targets: [target],
      supportingEvidenceRefIds: [...recommended.output.claims[0].supportingEvidenceRefIds],
      contradictingEvidenceRefIds: [],
      rationale:
        'The source claim supports observation but not an irreversible allocation commitment.',
      correctionCondition: 'Keep the Chair action hypothesis observation-only and reversible.',
    },
  ];
  challengerOutput.missingAlternatives = [
    {
      localAlternativeId: `alternative:${challenger.assignmentId}:1`,
      title: 'Rebalance allocation',
      description: 'Run the bounded observation while preserving a small parallel learning lane.',
      targets: [target],
      evidenceRefIds: [...recommended.output.claims[0].supportingEvidenceRefIds],
      tradeoffs: ['Uses more capacity while preserving both learning loops.'],
    },
  ];
  challengerOutput.dissent = [
    {
      localDissentId: dissentId,
      findingIds: [findingId],
      statement: 'Do not turn one observation into an execution claim.',
      evidenceRefIds: [...recommended.output.claims[0].supportingEvidenceRefIds],
      resolutionCondition: 'Keep the resulting action observation-only and explicitly reversible.',
    },
  ];
  challengerOutput.gaps = challengerOutput.gaps.map((gap) => ({
    ...gap,
    impact: 'The missing input limits challenge coverage.',
    recoveryPath: 'Recover the exact missing input and rerun challenge.',
  }));
  challengerOutput.questionCoverage = challengerOutput.questionCoverage.map((coverage) => ({
    ...coverage,
    disposition: 'answered',
    answer: 'The exact structured challenge records answer this required board question.',
    findingIds: coverage.questionId === 'challenge-missing-alternative' ? [] : [findingId],
    alternativeIds:
      coverage.questionId === 'challenge-missing-alternative'
        ? [challengerOutput.missingAlternatives[0].localAlternativeId]
        : [],
    dissentIds: coverage.questionId === 'challenge-unpriced-downside' ? [dissentId] : [],
    justification: null,
  }));
  state = acceptRole(
    state,
    challenger.assignmentId,
    'sub_verify_challenger_001',
    challengerArtifactId,
    'challenger-review',
    challengerOutput,
    'challenger',
    CHALLENGER_TIME,
    seeded.base.store,
  );
  state = claimAndStart(state, chair.assignmentId, 'sub_verify_chair_001', 'chair', CHAIR_TIME);
  const runningChair = state.assignments.find(
    ({ assignmentId }) => assignmentId === chair.assignmentId,
  );
  const ledger = clone(
    createOperatingResultTemplateV2({
      assignment: runningChair,
      inputArtifacts: issuedResultInputs(state, chair.assignmentId, seeded.base.store),
    }),
  );
  const localDecisionId = `decision:${chair.assignmentId}:1`;
  const claimRef = {
    advisorArtifactId: recommended.artifactId,
    localClaimId: recommended.output.claims[0].localClaimId,
  };
  ledger.summary =
    'Measure retention before changing allocation while preserving an observation-only boundary.';
  ledger.decisions = [
    {
      localDecisionId,
      title: 'Measure retention before changing allocation',
      question: 'What should the next operating loop prioritise?',
      outcome: 'Measure retention before changing allocation.',
      rationale: 'The exact challenged evidence supports a bounded measurement loop.',
      sourceClaimRefs: [claimRef],
      sourceRecommendationRefs: [
        {
          advisorArtifactId: recommended.artifactId,
          localRecommendationId: recommended.output.recommendation.localRecommendationId,
        },
      ],
      challengerFindingIds: [findingId],
      evidenceRefIds: [...recommended.output.claims[0].supportingEvidenceRefIds],
      alternativeDispositions: [
        {
          sourceArtifactId: recommended.artifactId,
          localAlternativeId: recommended.output.alternatives[0].localAlternativeId,
          title: recommended.output.alternatives[0].title,
          disposition: 'deferred',
          rationale: 'Holding allocation is less informative than one bounded observation.',
        },
      ],
      confidence: 0.6,
      assumptionIds: [],
      upside: 'Reduces uncertainty.',
      downside: 'Defers other learning.',
      uncertainty: 'Coverage is limited.',
      reversibility: 'Revisit after the next metric observation.',
      ownerActorId: 'owner-verify-001',
      revisitConditions: ['A new retention observation changes the metric materially.'],
      dissentIds: [dissentId],
      actionHypotheses: [
        {
          localActionHypothesisId: `action-hypothesis:${chair.assignmentId}:1`,
          title: 'Measure retention by cohort',
          objectiveId: seeded.objective.objectiveId,
          ownerActorId: 'owner-verify-001',
          accountabilityDisposition: null,
          expectedResult: 'A cohort observation reaches the declared retention target.',
          metricId: seeded.metric.metricId,
          baseline: 0.6,
          target: 0.8,
          verificationWindow: 'next 30-day observation window',
          verificationMethod:
            'Compare the accepted cohort retention observation with the declared target.',
          sourceClaimRefs: [claimRef],
          sourceFindingIds: [findingId],
          dependsOnActionHypothesisIds: [],
        },
      ],
    },
  ];
  ledger.sourceDispositions = ledger.sourceDispositions.map((disposition) => {
    const relevant =
      disposition.sourceKind === 'advisor-recommendation' ||
      disposition.sourceKind === 'challenger-finding' ||
      disposition.sourceKind === 'challenger-dissent';
    return {
      ...disposition,
      disposition: relevant ? 'accepted' : 'noted',
      localDecisionId: relevant ? localDecisionId : null,
      rationale: relevant
        ? 'The decision cites this exact source item.'
        : 'The quiet or partial Advisor outcome is retained without inventing a recommendation.',
    };
  });
  ledger.questionCoverage = ledger.questionCoverage.map((coverage) => {
    if (
      coverage.questionId === 'synthesis-limiting-gaps' &&
      runningChair.inputAbsences.length > 0
    ) {
      return {
        ...coverage,
        disposition: 'gap',
        answer: 'The exact runtime-issued absences limit this synthesis.',
        absenceIds: runningChair.inputAbsences.map(({ absenceId }) => absenceId),
        justification: null,
      };
    }
    return {
      ...coverage,
      disposition: 'answered',
      answer: 'The source-supported Decision answers this required synthesis question.',
      decisionIds: [localDecisionId],
      findingIds: coverage.questionId === 'synthesis-unresolved-conflict' ? [findingId] : [],
      dissentIds: coverage.questionId === 'synthesis-unresolved-conflict' ? [dissentId] : [],
      justification: null,
    };
  });
  assert.equal(ledger.ledgerId, deriveOperatingChairLedgerIdV2(chair.assignmentId));
  mutateLedger?.(ledger);
  state = acceptRole(
    state,
    chair.assignmentId,
    'sub_verify_chair_001',
    chairArtifactId,
    'chair-result',
    ledger,
    'chair',
    CHAIR_TIME,
    seeded.base.store,
  );
  const ledgerResult = materializeOperatingDecisionLedgerV2(
    {
      cycleId: seeded.cycleId,
      snapshotId: seeded.snap.snapshot.snapshotId,
      stateId: seeded.snap.operatingState.stateId,
      intelligencePlanId: planned.plan.planId,
      advisorArtifactIds: [...advisorArtifactIds],
      challengerArtifactId,
      chairArtifactId,
    },
    {
      eventId: 'evt_verify_ledger_001',
      claimEventIds: ['evt_verify_claim_001'],
      riskEventIds: ['evt_verify_risk_001'],
      findingEventIds: ['evt_verify_finding_001'],
      decisionEventIds: ['evt_verify_decision_001'],
      timestamp: LEDGER_TIME,
      correlationId: 'corr_verify_ledger_001',
    },
    { initialState: state, artifactStore: seeded.base.store },
  );
  return { ...seeded, state: ledgerResult.state, ledger, ledgerResult, chairArtifactId };
}

function materialize(input) {
  return materializeOperatingActionVerificationV2(
    {
      cycleId: input.cycleId,
      snapshotId: input.snap.snapshot.snapshotId,
      stateId: input.snap.operatingState.stateId,
      ledgerId: input.ledger.ledgerId,
    },
    {
      eventIds: ['evt_verify_action_plan_001'],
      timestamp: ACTION_TIME,
      correlationId: 'corr_verify_action_plan_001',
    },
    {
      initialState: input.state,
      artifactStore: input.base.store,
      replayHook: createNoModelReplayHookV2(),
    },
  );
}

test('a complete byte-proven Chair hypothesis atomically creates a distinct Action and observation-only verification plan', () => {
  const input = acceptedLedgerInput();
  const before = sha256Jcs(input.state);
  const result = materialize(input);
  assert.equal(sha256Jcs(input.state), before);
  assert.equal(result.actions.length, 1);
  assert.equal(result.verificationPlans.length, 1);
  assert.deepEqual(
    result.events.map(({ type }) => type),
    ['verification.plan-recorded'],
  );
  const [action] = result.actions;
  const [plan] = result.verificationPlans;
  assert.equal(
    result.state.assignments.length,
    input.state.assignments.length,
    'Actions never become Assignments',
  );
  assert.equal(
    action.sourceDecisionId,
    result.state.decisions.find(
      ({ sourceArtifactId }) => sourceArtifactId === input.chairArtifactId,
    ).decisionId,
  );
  assert.equal(action.verificationPlanId, plan.verificationPlanId);
  assert.equal(plan.observationRequest.kind, 'future-observation');
  assert.deepEqual(action.dependsOnActionIds, []);
  assert.equal(plan.method, input.ledger.decisions[0].actionHypotheses[0].verificationMethod);
  for (const forbiddenField of [
    'assignmentId',
    'operationId',
    'capability',
    'approval',
    'policy',
  ]) {
    assert.equal(Object.hasOwn(action, forbiddenField), false, `Action has no ${forbiddenField}`);
    assert.equal(
      Object.hasOwn(plan, forbiddenField),
      false,
      `verification plan has no ${forbiddenField}`,
    );
  }
  const replay = materializeOperatingActionVerificationV2(
    {
      cycleId: input.cycleId,
      snapshotId: input.snap.snapshot.snapshotId,
      stateId: input.snap.operatingState.stateId,
      ledgerId: input.ledger.ledgerId,
    },
    {
      eventIds: ['evt_verify_action_plan_001'],
      timestamp: ACTION_TIME,
      correlationId: 'corr_verify_action_plan_001',
    },
    {
      initialState: result.state,
      artifactStore: input.base.store,
      replayHook: createNoModelReplayHookV2(),
    },
  );
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.events, []);
  assert.deepEqual(replay.state, result.state);
});

test('multiline Chair hypothesis text remains exact in the derived Action and verification plan', () => {
  const expectedResult = multilineText(513, 'E');
  const verificationWindow = multilineText(513, 'W');
  const verificationMethod = multilineText(513, 'M');
  const input = acceptedLedgerInput({
    mutateLedger(ledger) {
      const [hypothesis] = ledger.decisions[0].actionHypotheses;
      hypothesis.expectedResult = expectedResult;
      hypothesis.verificationWindow = verificationWindow;
      hypothesis.verificationMethod = verificationMethod;
    },
  });
  const result = materialize(input);
  assert.equal(result.actions[0].expectedResult, expectedResult);
  assert.equal(result.actions[0].verificationWindow, verificationWindow);
  assert.equal(result.verificationPlans[0].window, verificationWindow);
  assert.equal(result.verificationPlans[0].method, verificationMethod);
  assert.equal(result.verificationPlans[0].observationRequest.reason, expectedResult);
});

test('incomplete, foreign, duplicated, or placeholder Action hypotheses fail Chair preflight', () => {
  const input = acceptedLedgerInput();
  const chair = input.state.assignments.find(({ assignmentKind }) => assignmentKind === 'chair');
  const check = (mutate) => {
    const ledger = clone(input.ledger);
    mutate(ledger.decisions[0].actionHypotheses[0], ledger.decisions[0]);
    return preflightOperatingAssignmentResultV2(
      {
        assignmentId: chair.assignmentId,
        contentBytes: Buffer.from(JSON.stringify(ledger), 'utf8'),
      },
      { initialState: input.state, artifactStore: input.base.store },
    );
  };
  const cases = [
    (action) => {
      action.objectiveId = null;
    },
    (action) => {
      action.objectiveId = 'obj_foreign_objective_0001';
    },
    (action) => {
      action.metricId = null;
    },
    (action) => {
      action.metricId = 'met_foreign_metric_0001';
    },
    (action) => {
      action.baseline = null;
    },
    (action) => {
      action.target = null;
    },
    (action) => {
      action.sourceFindingIds = [];
    },
    (action) => {
      action.expectedResult = ' leading whitespace';
    },
    (action) => {
      action.verificationWindow = 'trailing whitespace ';
    },
    (action) => {
      action.verificationMethod = '\nleading newline';
    },
    (action) => {
      action.title = '<action-title>';
    },
    (action) => {
      action.accountabilityDisposition = 'blocked';
    },
    (action) => {
      action.sourceClaimRefs.push(clone(action.sourceClaimRefs[0]));
    },
    (_action, decision) => {
      decision.sourceClaimRefs.push(clone(decision.sourceClaimRefs[0]));
    },
  ];
  for (const mutate of cases) {
    const result = check(mutate);
    assert.equal(result.valid, false);
    assert.ok(result.issues.length > 0);
  }
});

test('verification-plan Action reconstruction proves the exact canonical ledger chain and rejects every substitution', () => {
  const input = acceptedLedgerInput();
  const result = materialize(input);
  const [event] = result.events;
  const [action] = result.actions;
  const [verificationPlan] = result.verificationPlans;
  const reconstructed = reconstructOperatingVerificationPlanActionV2({
    state: result.state,
    event,
  });
  assert.deepEqual(reconstructed.action, action);
  assert.deepEqual(reconstructed.verificationPlan, verificationPlan);
  assert.equal(reconstructed.metric.metricId, action.metricId);
  assert.equal(reconstructed.ledgerId, input.ledger.ledgerId);
  assert.equal(reconstructed.snapshotId, input.snap.snapshot.snapshotId);
  assert.equal(reconstructed.stateId, input.snap.operatingState.stateId);

  const rejects = (mutateState, mutateEvent = () => {}) => {
    const candidateState = clone(result.state);
    const candidateEvent = clone(event);
    mutateState(candidateState);
    mutateEvent(candidateEvent);
    assert.throws(
      () =>
        reconstructOperatingVerificationPlanActionV2({
          state: candidateState,
          event: candidateEvent,
        }),
      (error) => ['STATE_TRANSITION_INVALID', 'RESULT_CONTRACT_INVALID'].includes(error.code),
    );
  };
  rejects(
    () => {},
    (_state) => {
      _state.payload.actionId = 'act_wrong_action_0001';
    },
  );
  rejects(
    () => {},
    (_state) => {
      _state.payload.target = 0.99;
    },
  );
  rejects((state) => {
    state.decisionLedgers.push(clone(state.decisionLedgers[0]));
  });
  rejects((state) => {
    state.operatingSnapshots.push(clone(state.operatingSnapshots[0]));
  });
  rejects((state) => {
    state.decisions.push(clone(state.decisions[0]));
  });
  rejects((state) => {
    const ledgerReplay = state.eventReplayIndex.find(
      (entry) => entry.type === 'decision-ledger.materialized',
    );
    ledgerReplay.sequence = event.sequence + 1;
  });
  rejects((state) => {
    state.eventReplayIndex.push(
      clone(state.eventReplayIndex.find((entry) => entry.eventId === event.eventId)),
    );
  });
  rejects(
    () => {},
    (_state) => {
      _state.cycleId = 'cyc_cross_scope_0001';
    },
  );
  rejects((state) => {
    const embedded = state.operatingModelStates.find(
      (candidate) => candidate.stateId === input.snap.operatingState.stateId,
    );
    embedded.metrics.push(
      clone(embedded.metrics.find(({ metricId }) => metricId === action.metricId)),
    );
  });
  rejects((state) => {
    const embedded = state.operatingModelStates.find(
      (candidate) => candidate.stateId === input.snap.operatingState.stateId,
    );
    embedded.metrics.find(({ metricId }) => metricId === action.metricId).target = 0.99;
  });
});

test('an accepted observation records a derived outcome and learning, and a later Delta reopens the source Decision without claiming execution', () => {
  const input = acceptedLedgerInput();
  const actions = materialize(input);
  const [action] = actions.actions;
  const [plan] = actions.verificationPlans;
  const observation = {
    ...clone(valid['operating-metric-observation']),
    observationId: 'mob_verify_001',
    metricId: action.metricId,
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    value: 0.85,
    unit: input.metric.unit,
    observedAt: OBSERVATION_TIME,
    snapshotId: input.snap.snapshot.snapshotId,
    evidenceRefIds: [input.evidenceRefId],
    sourceArtifactId: input.sourceArtifactId,
  };
  const observed = recordOperatingIntelligenceStateV2(
    {
      cycleId: input.cycleId,
      snapshotId: input.snap.snapshot.snapshotId,
      stateId: input.snap.operatingState.stateId,
      claims: [],
      metricObservations: [observation],
      risks: [],
      assumptions: [],
      decisionRevisions: [],
    },
    {
      timestamp: OBSERVATION_TIME,
      correlationId: 'corr_verify_observation_001',
      eventIds: {
        claims: [],
        metricObservations: ['evt_verify_observation_001'],
        risks: [],
        assumptions: [],
        decisionRevisions: [],
      },
    },
    { initialState: actions.state },
  );
  const verificationRequest = {
    cycleId: input.cycleId,
    snapshotId: input.snap.snapshot.snapshotId,
    stateId: input.snap.operatingState.stateId,
    actionId: action.actionId,
    verificationPlanId: plan.verificationPlanId,
    observationId: observation.observationId,
    learning: {
      statement: 'The measured cohort reached the stated target.',
      assumptionIds: [],
      decisionIds: [action.sourceDecisionId],
    },
  };
  const verificationDraft = {
    timestamp: OUTCOME_TIME,
    correlationId: 'corr_verify_outcome_001',
    eventIds: { outcome: 'evt_verify_outcome_001', learning: 'evt_verify_learning_001' },
  };
  const result = recordOperatingActionVerificationOutcomeV2(
    verificationRequest,
    verificationDraft,
    {
      initialState: observed.state,
      replayHook: createNoModelReplayHookV2(),
    },
  );
  assert.equal(result.outcome.status, 'succeeded');
  assert.equal(result.state.outcomes.length, 1);
  assert.equal(result.state.learnings.length, 1);
  assert.equal(JSON.stringify(result.outcome).includes('executed'), false);
  const feedback = deriveOperatingVerificationFeedbackV2({
    action,
    verificationPlan: plan,
    executionStatus: 'success',
    outcome: result.outcome,
    learning: result.learning,
    delta: null,
    snapshot: input.snap.snapshot,
    cycle: result.state.cycles.find(({ cycleId }) => cycleId === input.cycleId),
  });
  assert.equal(feedback.hypothesisStatus, 'confirmed');
  assert.equal(feedback.executionStatus, 'success');
  assert.equal(feedback.provenance.outcomeId, result.outcome.outcomeId);
  assert.equal(feedback.provenance.learningId, result.learning.learningId);
  assert.throws(
    () =>
      reduceOperatingRuntimeEventsV2([result.events[0]], {
        initialState: observed.state,
      }),
    { code: 'STATE_TRANSITION_INVALID' },
    'Outcome cannot be reduced without its paired Learning',
  );
  const ackLostRetry = recordOperatingActionVerificationOutcomeV2(
    verificationRequest,
    verificationDraft,
    {
      initialState: result.state,
      replayHook: createNoModelReplayHookV2(),
    },
  );
  assert.equal(
    ackLostRetry.replayed,
    true,
    'a lost acknowledgement returns the durable Outcome/Learning pair',
  );
  assert.deepEqual(ackLostRetry.events, []);
  assert.deepEqual(ackLostRetry.state, result.state);
  assert.throws(
    () =>
      recordOperatingActionVerificationOutcomeV2(
        {
          ...verificationRequest,
          learning: {
            ...verificationRequest.learning,
            statement: 'A divergent retry cannot replace the recorded learning.',
          },
        },
        {
          ...verificationDraft,
          eventIds: {
            outcome: 'evt_verify_outcome_divergent_001',
            learning: 'evt_verify_learning_divergent_001',
          },
        },
        { initialState: result.state, replayHook: createNoModelReplayHookV2() },
      ),
    { code: 'CONCURRENT_MODIFICATION' },
  );
  const delta = deriveOperatingRuntimeDeltaV2(
    {
      cycleId: input.cycleId,
      snapshotId: input.snap.snapshot.snapshotId,
      stateId: input.snap.operatingState.stateId,
    },
    {
      deltaId: 'dlt_verify_after_outcome_001',
      eventId: 'evt_verify_delta_after_outcome_001',
      timestamp: '2026-08-09T13:09:00.000Z',
      correlationId: 'corr_verify_delta_after_outcome_001',
    },
    { initialState: result.state },
  );
  assert.ok(delta.delta.decisionRevisitIds.includes(action.sourceDecisionId));
});

test('forged plans, assignment coercion, malformed source Findings, and outcome replay divergence fail closed without partial records', () => {
  const input = acceptedLedgerInput();
  const before = sha256Jcs(input.state);
  assert.throws(
    () =>
      materializeOperatingActionVerificationV2(
        {
          cycleId: input.cycleId,
          snapshotId: input.snap.snapshot.snapshotId,
          stateId: input.snap.operatingState.stateId,
          ledgerId: input.ledger.ledgerId,
          assignmentId: 'asg_coercion_001',
        },
        {
          eventIds: ['evt_verify_assignment_coercion_001'],
          timestamp: ACTION_TIME,
          correlationId: 'corr_verify_assignment_coercion_001',
        },
        { initialState: input.state, artifactStore: input.base.store },
      ),
    { code: 'RESULT_CONTRACT_INVALID' },
  );
  assert.equal(sha256Jcs(input.state), before);

  const candidate = materialize(input);
  const forged = clone(candidate.events[0]);
  forged.payload = { ...forged.payload, target: 0.99 };
  const forgedEvent = createOperatingRuntimeEventV2(
    {
      eventId: 'evt_verify_forged_plan_001',
      timestamp: ACTION_TIME,
      cycleId: input.cycleId,
      type: 'verification.plan-recorded',
      entityId: forged.payload.verificationPlanId,
      actor: { kind: 'runtime', id: 'openplanr' },
      causationId: forged.causationId,
      correlationId: 'corr_verify_forged_plan_001',
      payload: forged.payload,
    },
    {
      previousEvent: {
        sequence: input.state.eventHead.sequence,
        eventHash: input.state.eventHead.hash,
      },
    },
  );
  assert.throws(
    () =>
      reduceOperatingRuntimeEventsV2([forgedEvent], {
        initialState: input.state,
        artifactStore: input.base.store,
      }),
    { code: 'STATE_TRANSITION_INVALID' },
  );
  assert.equal(sha256Jcs(input.state), before);

  assert.throws(
    () =>
      acceptedLedgerInput({
        mutateLedger: (ledger) => {
          ledger.decisions[0].actionHypotheses[0].sourceFindingIds = [];
        },
      }),
    { code: 'RESULT_CONTRACT_INVALID' },
    'malformed Action source custody fails before Chair Artifact acceptance',
  );
});
