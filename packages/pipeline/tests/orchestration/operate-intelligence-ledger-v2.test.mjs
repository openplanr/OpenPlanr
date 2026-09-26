import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildOperateExperienceViewV2 } from '../../lib/operate/experience-projection-v2.mjs';
import { projectOperatingAcceptedIntelligenceOutputV2 } from '../../lib/operate/intelligence-ledger-v2.mjs';
import { preflightOperatingIntelligenceResultV2 } from '../../lib/operate/intelligence-result-validator-v2.mjs';
import { createOperatingResultTemplateV2 } from '../../lib/operate/result-packet-v2.mjs';
import {
  acceptOperatingAssignmentSubmissionV2,
  claimOperatingAssignmentV2,
  createNoModelReplayHookV2,
  createOperatingRuntimeEventV2,
  deriveOperatingChairLedgerIdV2,
  deriveOperatingRuntimeDeltaV2,
  materializeOperatingDecisionLedgerV2,
  planOperatingRuntimeIntelligenceBoardV2,
  preflightOperatingAssignmentResultV2,
  readOperatingArtifactRawBytesV2,
  readOperatingReviewV2,
  reduceOperatingRuntimeEventsV2,
  scheduleOperatingRuntimeEventsV2,
  submitOperatingReviewV2,
} from '../../lib/operate/runtime-foundation.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import { checkpoint } from './operate-operating-intelligence-state-v2.test-support.mjs';

const DELTA_TIME = '2026-08-09T12:01:00.000Z';
const PLAN_TIME = '2026-08-09T12:02:00.000Z';
const ADVISOR_TIME = '2026-08-09T12:03:00.000Z';
const CHALLENGER_TIME = '2026-08-09T12:04:00.000Z';
const CHAIR_TIME = '2026-08-09T12:05:00.000Z';
const MATERIALIZE_TIME = '2026-08-09T12:06:00.000Z';
const REVIEW_TIME = '2026-08-09T12:07:00.000Z';
const REVIEW_SUBMIT_CAPABILITY = Object.freeze({ id: 'operate-review-submit', version: '2.0.0' });

function multilineText(length, character = 'M') {
  assert.ok(length >= 2);
  return `${character}\n${character.repeat(length - 2)}`;
}

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );

function claimAssignment(state, assignmentId, suffix, timestamp, artifactStore) {
  const assignment = state.assignments.find((candidate) => candidate.assignmentId === assignmentId);
  const actor = { actorId: `${assignment.roleId}-${suffix}`, kind: 'agent', runtime: 'codex' };
  const claimed = claimOperatingAssignmentV2(
    { assignmentId, actor },
    {
      claimId: `claim_${suffix}`,
      submissionId: `sub_${suffix}`,
      eventIds: { claimed: `evt_${suffix}_claimed`, started: `evt_${suffix}_started` },
      timestamp,
      correlationId: `corr_${suffix}`,
    },
    { initialState: state, capabilities: ['operate.assignment.claim'] },
  );
  const inputArtifacts = claimed.response.assignment.inputArtifactIds.flatMap((artifactId) => {
    const artifact = claimed.state.artifacts.find(
      (candidate) => candidate.artifactId === artifactId,
    );
    assert.ok(artifact, `missing issued input Artifact ${artifactId}`);
    const rawBytes = readOperatingArtifactRawBytesV2(artifactStore, {
      artifactId,
      rawHash: artifact.rawHash,
    });
    const rawText = Buffer.from(rawBytes).toString('utf8');
    if (
      ![
        'operating-intelligence-input-bundle',
        'operating-advisor-result',
        'operating-challenger-review',
        'operating-decision-ledger',
      ].includes(artifact.schemaId)
    )
      return [];
    return [
      {
        artifactId,
        schemaId: artifact.schemaId,
        value: JSON.parse(rawText),
      },
    ];
  });
  return { ...claimed, inputArtifacts };
}

function acceptResult(claimed, value, artifactId, artifactType, suffix, timestamp, artifactStore) {
  const assignment = claimed.response.assignment;
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  return acceptOperatingAssignmentSubmissionV2(
    {
      assignmentId: assignment.assignmentId,
      submissionId: claimed.response.submissionId,
      mediaType: 'application/json',
      encoding: 'utf-8',
      contentBase64: bytes.toString('base64'),
      actor: {
        actorId: assignment.claim.actorId,
        kind: assignment.claim.actorKind,
        runtime: assignment.claim.runtime,
      },
    },
    {
      artifactId,
      artifactType,
      inputArtifactIds: [...assignment.inputArtifactIds],
      timestamp,
      validatorVersion: '2.0.0',
      correlationId: `corr_${suffix}`,
      eventIds: {
        submitted: `evt_${suffix}_submitted`,
        artifactCreated: `evt_${suffix}_artifact`,
        validated: `evt_${suffix}_validated`,
      },
    },
    { initialState: claimed.state, artifactStore },
  );
}

function evidenceLink(assignment) {
  const evidenceRefId =
    assignment.intelligenceContext.inputBundle.issuedEvidence[0]?.evidenceRefId ?? null;
  const absenceId = assignment.inputAbsences[0]?.absenceId ?? null;
  assert.ok(
    evidenceRefId || absenceId,
    `Assignment ${assignment.assignmentId} has neither evidence nor a typed absence`,
  );
  return {
    evidenceRefIds: evidenceRefId ? [evidenceRefId] : [],
    absenceIds: absenceId ? [absenceId] : [],
  };
}

function answerChallengerCoverage(value) {
  const findingId = value.findings[0]?.localFindingId;
  const alternativeId = value.missingAlternatives[0]?.localAlternativeId;
  const dissentId = value.dissent[0]?.localDissentId;
  value.questionCoverage = value.questionCoverage.map((coverage) => {
    if (
      coverage.questionId === 'challenge-correlated-reasoning' ||
      coverage.questionId === 'challenge-overconfidence'
    ) {
      return {
        ...coverage,
        answer: 'The exact accepted Advisor set does not exhibit this challenge condition.',
        justification: 'No matching structured board defect was found in the issued Artifacts.',
      };
    }
    if (coverage.questionId === 'challenge-missing-alternative') {
      return {
        ...coverage,
        disposition: 'answered',
        answer: 'One material omitted alternative is recorded explicitly.',
        alternativeIds: [alternativeId],
        justification: null,
      };
    }
    return {
      ...coverage,
      disposition: 'answered',
      answer: 'The structured challenge record answers this required question.',
      findingIds: [findingId],
      dissentIds: coverage.questionId === 'challenge-unpriced-downside' ? [dissentId] : [],
      justification: null,
    };
  });
}

function answerQuietChallengerCoverage(value) {
  const gapIds = value.gaps.map(({ localGapId }) => localGapId);
  value.questionCoverage = value.questionCoverage.map((coverage) =>
    gapIds.length > 0
      ? {
          ...coverage,
          disposition: 'gap',
          answer: 'The runtime-issued typed gap prevents a complete challenge answer.',
          gapIds,
          justification: null,
        }
      : {
          ...coverage,
          answer: 'No material board item exhibits this challenge condition.',
          justification:
            'The accepted board contains no material recommendation or claim requiring this critique.',
        },
  );
}

function answerChairCoverage(value, assignment, decisionId, challengerOutput) {
  value.questionCoverage = value.questionCoverage.map((coverage) => {
    if (coverage.questionId === 'synthesis-limiting-gaps') {
      const absenceIds = assignment.inputAbsences.map(({ absenceId }) => absenceId);
      return absenceIds.length > 0
        ? {
            ...coverage,
            disposition: 'gap',
            answer: 'The runtime-issued typed absences limit the synthesis.',
            absenceIds,
            justification: null,
          }
        : {
            ...coverage,
            answer: 'No runtime-issued typed absence limits this synthesis.',
            justification: 'The exact role and evidence absence ledgers are empty.',
          };
    }
    return {
      ...coverage,
      disposition: 'answered',
      answer:
        'The bounded Decision records this synthesis question against exact accepted sources.',
      decisionIds: [decisionId],
      findingIds:
        coverage.questionId === 'synthesis-unresolved-conflict'
          ? [challengerOutput.findings[0].localFindingId]
          : [],
      dissentIds:
        coverage.questionId === 'synthesis-unresolved-conflict'
          ? [challengerOutput.dissent[0].localDissentId]
          : [],
      justification: null,
    };
  });
}

function answerQuietChairCoverage(value, assignment) {
  const absenceIds = assignment.inputAbsences.map(({ absenceId }) => absenceId);
  value.questionCoverage = value.questionCoverage.map((coverage) =>
    absenceIds.length > 0
      ? {
          ...coverage,
          disposition: 'gap',
          answer: 'The runtime-issued typed absences prevent a source-supported synthesis answer.',
          absenceIds,
          justification: null,
        }
      : {
          ...coverage,
          answer: 'No source-supported Decision is applicable to this required synthesis question.',
          justification:
            'The accepted board contains only evidence-limited outcomes and no material recommendation.',
        },
  );
}

function authoredAdvisorResult(
  assignment,
  { recommendation = false, withAlternative = true, withMeasurement = false } = {},
) {
  const value = structuredClone(createOperatingResultTemplateV2({ assignment }));
  const link = evidenceLink(assignment);
  value.summary = recommendation
    ? 'A bounded retention measurement should precede an allocation change.'
    : 'No additional primary recommendation is justified from this role evidence.';
  value.analysisMarkdown =
    'The result preserves exact evidence custody and states its uncertainty explicitly.';
  value.inputAbsenceIds = assignment.inputAbsences.map(({ absenceId }) => absenceId);
  value.gaps = value.gaps.map((gap) => ({
    ...gap,
    impact: 'The missing evidence limits confidence in this professional lens.',
    recoveryPath: 'Issue a current authorized Evidence Artifact for this requirement.',
  }));
  for (const answer of value.analysis.executiveQuestionAnswers) {
    answer.answer = recommendation
      ? 'The evidence supports a reversible measurement-first direction.'
      : 'The evidence does not support a distinct material direction change.';
    answer.evidenceRefIds = [...link.evidenceRefIds];
    answer.absenceIds = [...link.absenceIds];
  }
  if (!recommendation) {
    value.outcome = assignment.inputAbsences.length > 0 ? 'partial' : 'quiet';
    value.recommendation = null;
    return value;
  }

  const claimId = `claim:${assignment.assignmentId}:1`;
  const riskId = `risk:${assignment.assignmentId}:1`;
  const alternativeId = `alternative:${assignment.assignmentId}:1`;
  const recommendationId = `recommendation:${assignment.assignmentId}:1`;
  value.outcome = 'recommendation';
  value.claims = [
    {
      localClaimId: claimId,
      statement:
        'A fresh retention measurement reduces the downside of changing allocation prematurely.',
      epistemicStatus: link.evidenceRefIds.length > 0 ? 'probable' : 'speculative',
      confidence: 0.68,
      supportingEvidenceRefIds: [...link.evidenceRefIds],
      contradictingEvidenceRefIds: [],
      assumptionIds: [],
      changeCondition: 'A current cohort measurement contradicts the observed retention direction.',
    },
  ];
  value.risks = [
    {
      localRiskId: riskId,
      title: 'Premature allocation change',
      statement: 'Changing allocation before measuring retention can amplify an unpriced downside.',
      likelihood: 0.5,
      impact: 'high',
      exposure:
        'The operating scope may spend the next observation window on the wrong constraint.',
      exposedSurfaces: ['Allocation planning'],
      claimIds: [claimId],
      evidenceRefIds: [...link.evidenceRefIds],
      mitigation: 'Run one bounded retention measurement first.',
      reversibility: 'The measurement is reversible before any allocation change.',
    },
  ];
  value.alternatives = withAlternative
    ? [
        {
          localAlternativeId: alternativeId,
          title: 'Hold current allocation',
          description: 'Keep allocation unchanged through the next measurement window.',
          supportingClaimIds: [claimId],
          evidenceRefIds: [...link.evidenceRefIds],
          tradeoffs: ['Preserves reversibility but defers acquisition learning.'],
          costOfDelay: 'One observation window of delayed allocation learning.',
          reversibility: 'Fully reversible after the observation window.',
        },
      ]
    : [];
  value.recommendation = {
    localRecommendationId: recommendationId,
    title: 'Measure retention before reallocating',
    proposal: 'Run one bounded cohort-retention measurement before changing allocation.',
    rationaleClaimIds: [claimId],
    alternativeIds: withAlternative ? [alternativeId] : [],
    riskIds: [riskId],
    confidence: 0.68,
    expectedUpside: 'Narrows the most consequential uncertainty before committing resources.',
    expectedDownside: 'Defers acquisition learning by one observation window.',
    uncertainty: 'The current cohort evidence remains limited.',
    reversibility: 'The measurement step can be stopped without an allocation commitment.',
    successMeasurementIds: [],
    revisitConditions: ['A current cohort measurement materially changes the retention direction.'],
  };
  if (withMeasurement) {
    assert.ok(
      link.evidenceRefIds.length > 0,
      'typed measurement requires one exact issued EvidenceRef',
    );
    value.measurements = [
      {
        localMeasurementId: `measurement:${assignment.assignmentId}:1`,
        kind: 'runway',
        name: 'Operating runway',
        period: 'Current accepted observation window',
        evidenceRefIds: [...link.evidenceRefIds],
        interpretation: 'The bounded runway supports a reversible measurement before reallocation.',
        confidence: 0.68,
        currency: 'USD',
        cashBalance: 120,
        netBurnPerPeriod: 10,
        runwayPeriods: 12,
      },
    ];
    value.recommendation.successMeasurementIds = [value.measurements[0].localMeasurementId];
  }
  for (const answer of value.analysis.executiveQuestionAnswers) answer.claimIds = [claimId];
  return value;
}

function authoredQuietAdvisorResult(assignment) {
  const value = structuredClone(createOperatingResultTemplateV2({ assignment }));
  const absence = assignment.inputAbsences.find(({ kind }) => kind === 'evidence');
  assert.ok(
    absence,
    `Quiet Advisor ${assignment.assignmentId} requires one exact evidence absence`,
  );
  value.outcome = 'partial';
  value.summary = 'The issued evidence gaps do not support a distinct material recommendation.';
  value.analysisMarkdown =
    'The Advisor preserves the exact gap custody and avoids inferring from unavailable evidence.';
  for (const answer of value.analysis.executiveQuestionAnswers) {
    answer.answer =
      'The required evidence is absent, so this question remains explicitly unresolved.';
    answer.absenceIds = [absence.absenceId];
  }
  value.gaps = value.gaps.map((gap) => ({
    ...gap,
    impact: 'The missing evidence prevents a grounded professional conclusion.',
    recoveryPath: 'Issue a current authorized Evidence Artifact for the exact requirement.',
  }));
  return value;
}

function authoredChallengerResult(assignment, inputArtifacts, advisorArtifactId, advisorOutput) {
  const value = structuredClone(createOperatingResultTemplateV2({ assignment, inputArtifacts }));
  const link = {
    evidenceRefIds: [...advisorOutput.claims[0].supportingEvidenceRefIds],
    absenceIds: assignment.inputAbsences.map(({ absenceId }) => absenceId),
  };
  const findingId = `finding:${assignment.assignmentId}:1`;
  const dissentId = `dissent:${assignment.assignmentId}:1`;
  const target = {
    advisorArtifactId,
    analysisIds: [],
    claimIds: [advisorOutput.claims[0].localClaimId],
    measurementIds: [],
    riskIds: [advisorOutput.risks[0].localRiskId],
    recommendationIds: [advisorOutput.recommendation.localRecommendationId],
  };
  value.summary = 'The recommendation is reversible, but its downside must remain explicit.';
  value.analysisMarkdown =
    'The challenge targets the exact Advisor claim, risk, and recommendation.';
  value.inputAbsenceIds = assignment.inputAbsences.map(({ absenceId }) => absenceId);
  value.findings = [
    {
      localFindingId: findingId,
      title: 'Unpriced delay downside',
      statement:
        'The recommendation does not fully price the opportunity cost of delaying acquisition learning.',
      type: 'unpriced-downside',
      severity: 'medium',
      confidence: 0.62,
      targets: [target],
      supportingEvidenceRefIds: [...link.evidenceRefIds],
      contradictingEvidenceRefIds: [],
      rationale:
        'The source claim supports measurement but does not quantify the delayed learning cost.',
      correctionCondition: 'Price the delayed acquisition-learning cost in the Chair decision.',
    },
  ];
  value.missingAlternatives = [
    {
      localAlternativeId: `alternative:${assignment.assignmentId}:1`,
      title: 'Parallel bounded measurement',
      description: 'Measure retention while preserving a small acquisition-learning lane.',
      targets: [target],
      evidenceRefIds: [...link.evidenceRefIds],
      tradeoffs: ['Costs more capacity but preserves both learning loops.'],
    },
  ];
  value.dissent = [
    {
      localDissentId: dissentId,
      findingIds: [findingId],
      statement:
        'Do not approve a measurement-only path unless the acquisition-learning delay is explicitly bounded.',
      evidenceRefIds: [...link.evidenceRefIds],
      resolutionCondition:
        'Bound and price the acquisition-learning delay in the accepted decision.',
    },
  ];
  value.gaps = value.gaps.map((gap) => ({
    ...gap,
    impact: 'The missing input limits challenge coverage.',
    recoveryPath: 'Recover the exact missing role or Evidence Artifact and rerun challenge.',
  }));
  answerChallengerCoverage(value);
  return value;
}

function authoredQuietChallengerResult(assignment, inputArtifacts) {
  const value = structuredClone(createOperatingResultTemplateV2({ assignment, inputArtifacts }));
  value.summary = 'The evidence-limited board introduces no material recommendation to challenge.';
  value.analysisMarkdown =
    'The review preserves the exact predecessor and gap custody without inventing a second analysis.';
  value.gaps = value.gaps.map((gap) => ({
    ...gap,
    impact: 'The missing input bounds the independent challenge that can be performed.',
    recoveryPath: 'Recover the exact missing role or Evidence Artifact and rerun challenge.',
  }));
  answerQuietChallengerCoverage(value);
  return value;
}

function authoredChairLedger(
  assignment,
  inputArtifacts,
  advisorArtifactId,
  advisorOutput,
  challengerArtifactId,
  challengerOutput,
) {
  const value = structuredClone(createOperatingResultTemplateV2({ assignment, inputArtifacts }));
  const decisionId = `decision:${assignment.assignmentId}:1`;
  const claimRef = { advisorArtifactId, localClaimId: advisorOutput.claims[0].localClaimId };
  const recommendationRef = {
    advisorArtifactId,
    localRecommendationId: advisorOutput.recommendation.localRecommendationId,
  };
  const evidenceRefId =
    advisorOutput.claims[0].supportingEvidenceRefIds[0] ??
    challengerOutput.findings[0].supportingEvidenceRefIds[0];
  assert.ok(evidenceRefId, 'Chair decision requires one exact relevant EvidenceRef');
  value.summary =
    'Approve a bounded retention measurement while explicitly limiting acquisition-learning delay.';
  value.decisions = [
    {
      localDecisionId: decisionId,
      title: 'Run a bounded retention measurement',
      question:
        'How should the operating scope reduce retention uncertainty without hiding acquisition-learning delay?',
      outcome:
        'Run one bounded retention measurement and cap the acquisition-learning delay to one window.',
      rationale:
        'The Advisor claim supports a reversible measurement and the Challenger finding prices its downside.',
      sourceClaimRefs: [claimRef],
      sourceRecommendationRefs: [recommendationRef],
      challengerFindingIds: [challengerOutput.findings[0].localFindingId],
      evidenceRefIds: [evidenceRefId],
      alternativeDispositions:
        advisorOutput.alternatives.length === 0
          ? []
          : [
              {
                sourceArtifactId: advisorArtifactId,
                localAlternativeId: advisorOutput.alternatives[0].localAlternativeId,
                title: advisorOutput.alternatives[0].title,
                disposition: 'deferred',
                rationale:
                  'Holding all allocation is less informative than the bounded measurement.',
              },
            ],
      confidence: 0.66,
      assumptionIds: [],
      upside: 'Narrows retention uncertainty before a resource commitment.',
      downside: 'Defers acquisition learning for one bounded window.',
      uncertainty: 'Cohort response remains uncertain until the next accepted measurement.',
      reversibility: 'The measurement can stop without committing the allocation change.',
      ownerActorId: assignment.intelligenceContext.decisionOwnerActorId,
      revisitConditions: ['The next cohort measurement changes retention materially.'],
      dissentIds: [challengerOutput.dissent[0].localDissentId],
      actionHypotheses: [],
    },
  ];
  value.sourceDispositions = value.sourceDispositions.map((disposition) => {
    const relevant =
      disposition.sourceKind === 'advisor-recommendation' ||
      disposition.sourceKind === 'challenger-finding' ||
      disposition.sourceKind === 'challenger-dissent';
    return {
      ...disposition,
      disposition: relevant ? 'accepted' : 'noted',
      localDecisionId: relevant ? decisionId : null,
      rationale: relevant
        ? 'The Decision cites this exact source item.'
        : 'The quiet Advisor outcome is retained without inventing a recommendation.',
    };
  });
  answerChairCoverage(value, assignment, decisionId, challengerOutput);
  assert.equal(value.challengerArtifactId, challengerArtifactId);
  return value;
}

function authoredQuietChairLedger(assignment, inputArtifacts) {
  const value = structuredClone(createOperatingResultTemplateV2({ assignment, inputArtifacts }));
  value.summary = 'No Decision is justified until the board evidence gaps are recovered.';
  value.sourceDispositions = value.sourceDispositions.map((disposition) => ({
    ...disposition,
    rationale:
      'The evidence-limited Advisor outcome is retained without inventing a recommendation.',
  }));
  answerQuietChairCoverage(value, assignment);
  return value;
}

function protocolOrderedAdvisorInputs(plan, advisorRecords, inputArtifacts) {
  const artifactOrder = new Map(
    plan.selectedRoles
      .filter(({ roleKind }) => roleKind === 'advisor')
      .flatMap(({ roleId, roleVersion }, position) => {
        const record = advisorRecords.find(
          ({ assignment }) =>
            assignment.roleId === roleId && assignment.roleVersion === roleVersion,
        );
        return record ? [[record.artifactId, position]] : [];
      }),
  );
  return [...inputArtifacts].sort(
    (left, right) =>
      (artifactOrder.get(left.artifactId) ?? Number.MAX_SAFE_INTEGER) -
      (artifactOrder.get(right.artifactId) ?? Number.MAX_SAFE_INTEGER),
  );
}

function acceptedBoard(
  seed = 'structured',
  {
    withAlternative = true,
    withMeasurement = false,
    missingAdvisorPosition = null,
    quietBoard = false,
    reverseAdvisorArtifactIds = false,
    mutateAdvisorResult = null,
    mutateChallengerResult = null,
    mutateChairLedger = null,
  } = {},
) {
  const base = checkpoint();
  const replayBaseState = base.result.state;
  const cycleId = base.result.state.cycles[0].cycleId;
  const snapshotId = base.result.snapshot.snapshotId;
  const stateId = base.result.operatingState.stateId;
  const delta = deriveOperatingRuntimeDeltaV2(
    { cycleId, snapshotId, stateId },
    {
      deltaId: `dlt_${seed}`,
      eventId: `evt_${seed}_delta`,
      timestamp: DELTA_TIME,
      correlationId: `corr_${seed}_delta`,
    },
    { initialState: base.result.state },
  );
  const planned = planOperatingRuntimeIntelligenceBoardV2(
    {
      cycleId,
      snapshotId,
      stateId,
      deltaId: delta.delta.deltaId,
      focus: ['all'],
      domainDescriptor: fixture('business-domain-valid.json'),
      decisionOwnerActorId: 'owner-ledger-001',
    },
    {
      eventId: `evt_${seed}_plan`,
      timestamp: PLAN_TIME,
      correlationId: `corr_${seed}_plan`,
    },
    { initialState: delta.state, artifactStore: base.store },
  );

  let state = planned.state;
  const events = [...delta.events, ...planned.events];
  const advisorRecords = [];
  const advisors = planned.assignments
    .filter(({ assignmentKind }) => assignmentKind === 'advisor')
    .sort((left, right) => left.roleId.localeCompare(right.roleId));
  for (const [position, plannedAssignment] of advisors.entries()) {
    const suffix = `${seed}_advisor_${position + 1}`;
    const claimed = claimAssignment(
      state,
      plannedAssignment.assignmentId,
      suffix,
      ADVISOR_TIME,
      base.store,
    );
    events.push(...claimed.events);
    if (position === missingAdvisorPosition) {
      const failed = createOperatingRuntimeEventV2(
        {
          eventId: `evt_${suffix}_failed`,
          timestamp: ADVISOR_TIME,
          cycleId,
          type: 'assignment.failed',
          entityId: plannedAssignment.assignmentId,
          actor: { kind: 'runtime', id: 'openplanr' },
          causationId: events.at(-1).eventId,
          correlationId: `corr_${suffix}`,
          payload: {
            assignmentId: plannedAssignment.assignmentId,
            errorCode: 'role-unavailable',
            reason: 'The bounded Advisor execution was unavailable for this Cycle.',
            recoveryStatus: 'continue-partial',
          },
        },
        { previousEvent: events.at(-1) },
      );
      const terminal = scheduleOperatingRuntimeEventsV2([failed], { initialState: claimed.state });
      events.push(...terminal.events);
      state = terminal.state;
      continue;
    }
    const output = quietBoard
      ? authoredQuietAdvisorResult(claimed.response.assignment)
      : authoredAdvisorResult(claimed.response.assignment, {
          recommendation: position === 0,
          withAlternative,
          withMeasurement: position === 0 && withMeasurement,
        });
    mutateAdvisorResult?.(output, { assignment: claimed.response.assignment, position });
    const artifactId = reverseAdvisorArtifactIds
      ? `art_${seed}_advisor_${String(advisors.length - position).padStart(2, '0')}`
      : `art_${suffix}`;
    const accepted = acceptResult(
      claimed,
      output,
      artifactId,
      'advisor-result',
      suffix,
      ADVISOR_TIME,
      base.store,
    );
    events.push(...accepted.events);
    state = accepted.state;
    advisorRecords.push({ assignment: claimed.response.assignment, artifactId, output });
  }

  const recommended = advisorRecords[0];
  const challengerAssignment = state.assignments.find(
    ({ assignmentKind }) => assignmentKind === 'challenger',
  );
  const challengerClaimed = claimAssignment(
    state,
    challengerAssignment.assignmentId,
    `${seed}_challenger`,
    CHALLENGER_TIME,
    base.store,
  );
  events.push(...challengerClaimed.events);
  const challengerInputs = protocolOrderedAdvisorInputs(
    planned.plan,
    advisorRecords,
    challengerClaimed.inputArtifacts,
  );
  const challengerOutput = quietBoard
    ? authoredQuietChallengerResult(challengerClaimed.response.assignment, challengerInputs)
    : authoredChallengerResult(
        challengerClaimed.response.assignment,
        challengerInputs,
        recommended.artifactId,
        recommended.output,
      );
  mutateChallengerResult?.(challengerOutput, { assignment: challengerClaimed.response.assignment });
  const challengerArtifactId = `art_${seed}_challenger`;
  const challengerAccepted = acceptResult(
    challengerClaimed,
    challengerOutput,
    challengerArtifactId,
    'challenger-review',
    `${seed}_challenger`,
    CHALLENGER_TIME,
    base.store,
  );
  events.push(...challengerAccepted.events);
  state = challengerAccepted.state;

  const chairAssignment = state.assignments.find(
    ({ assignmentKind }) => assignmentKind === 'chair',
  );
  const chairClaimed = claimAssignment(
    state,
    chairAssignment.assignmentId,
    `${seed}_chair`,
    CHAIR_TIME,
    base.store,
  );
  events.push(...chairClaimed.events);
  const chairInputs = protocolOrderedAdvisorInputs(
    planned.plan,
    advisorRecords,
    chairClaimed.inputArtifacts,
  );
  const ledger = quietBoard
    ? authoredQuietChairLedger(chairClaimed.response.assignment, chairInputs)
    : authoredChairLedger(
        chairClaimed.response.assignment,
        chairInputs,
        recommended.artifactId,
        recommended.output,
        challengerArtifactId,
        challengerOutput,
      );
  mutateChairLedger?.(ledger, { assignment: chairClaimed.response.assignment });
  assert.equal(ledger.ledgerId, deriveOperatingChairLedgerIdV2(chairAssignment.assignmentId));
  const chairArtifactId = `art_${seed}_chair`;
  const chairAccepted = acceptResult(
    chairClaimed,
    ledger,
    chairArtifactId,
    'chair-result',
    `${seed}_chair`,
    CHAIR_TIME,
    base.store,
  );
  events.push(...chairAccepted.events);
  state = chairAccepted.state;
  return {
    base,
    cycleId,
    snapshotId,
    stateId,
    plan: planned.plan,
    state,
    events,
    replayBaseState,
    advisorRecords,
    challengerArtifactId,
    challengerOutput,
    chairArtifactId,
    ledger,
  };
}

test('accepted Advisor projection preserves typed measurements and exact result identity', () => {
  const board = acceptedBoard('projection_measurement', { withMeasurement: true });
  const source = board.advisorRecords[0];
  const assignment = source.assignment;
  const artifact = board.state.artifacts.find(({ artifactId }) => artifactId === source.artifactId);
  const bundleArtifactId = assignment.intelligenceContext.inputBundle.bundleArtifactId;
  const bundleArtifact = board.state.artifacts.find(
    ({ artifactId }) => artifactId === bundleArtifactId,
  );
  const inputBundle = JSON.parse(
    Buffer.from(
      readOperatingArtifactRawBytesV2(board.base.store, {
        artifactId: bundleArtifactId,
        rawHash: bundleArtifact.rawHash,
      }),
    ).toString('utf8'),
  );
  const projected = projectOperatingAcceptedIntelligenceOutputV2({
    roleKind: 'advisor',
    value: source.output,
    artifact,
    assignment,
    plan: board.plan,
    snapshot: board.base.result.snapshot,
    operatingState: board.base.result.operatingState,
    inputBundle,
  });
  assert.deepEqual(projected.measurements, source.output.measurements);
  assert.deepEqual(projected.inputAbsenceIds, source.output.inputAbsenceIds);
  assert.deepEqual(projected.analysisProfile, source.output.analysisProfile);
  assert.equal(projected.measurements[0].runwayPeriods, 12);
});

test('Advisor evidence absences reach Challenger and Chair byte-identically through release and restart', () => {
  const board = acceptedBoard('absence_propagation');
  const advisor = board.advisorRecords.find(({ assignment }) =>
    assignment.inputAbsences.some(({ kind }) => kind === 'evidence'),
  );
  assert.ok(advisor, 'fixture must exercise an evidence-limited Advisor');
  const sourceAbsence = advisor.assignment.inputAbsences.find(({ kind }) => kind === 'evidence');
  assert.ok(sourceAbsence.sourceContracts.length > 0);
  const challenger = board.state.assignments.find(
    ({ assignmentKind }) => assignmentKind === 'challenger',
  );
  const chair = board.state.assignments.find(({ assignmentKind }) => assignmentKind === 'chair');
  const exactAt = (assignment) =>
    assignment.inputAbsences.find(({ absenceId }) => absenceId === sourceAbsence.absenceId);
  assert.deepEqual(exactAt(challenger), sourceAbsence);
  assert.deepEqual(exactAt(chair), sourceAbsence);

  const restarted = reduceOperatingRuntimeEventsV2(board.events, {
    initialState: board.replayBaseState,
    artifactStore: board.base.store,
  });
  assert.equal(sha256Jcs(restarted), sha256Jcs(board.state));
  assert.deepEqual(
    exactAt(restarted.assignments.find(({ assignmentKind }) => assignmentKind === 'challenger')),
    sourceAbsence,
  );
  assert.deepEqual(
    exactAt(restarted.assignments.find(({ assignmentKind }) => assignmentKind === 'chair')),
    sourceAbsence,
  );
});

test('public Chair template preserves absence-source Evidence metadata without treating it as a citation', () => {
  const board = acceptedBoard('chair_absence_metadata', { quietBoard: true });
  const evidenceRefId = board.base.evidenceRef.evidenceRefId;
  assert.ok(
    board.ledger.evidenceGaps.some(({ sourceEvidenceRefIds }) =>
      sourceEvidenceRefIds.includes(evidenceRefId),
    ),
    'the exact Snapshot EvidenceRef must survive in runtime-issued Chair gap metadata',
  );
  assert.equal(
    board.advisorRecords.some(({ output }) => JSON.stringify(output).includes(evidenceRefId)),
    false,
    'the absence-only EvidenceRef is not a predecessor citation',
  );
  assert.equal(
    JSON.stringify(board.challengerOutput).includes(evidenceRefId),
    false,
    'the Challenger does not widen absence metadata into citation custody',
  );
  assert.deepEqual(board.ledger.decisions, []);

  const chairAssignment = board.state.assignments.find(
    ({ assignmentKind }) => assignmentKind === 'chair',
  );
  const preflight = preflightOperatingAssignmentResultV2(
    {
      assignmentId: chairAssignment.assignmentId,
      contentBytes: Buffer.from(JSON.stringify(board.ledger), 'utf8'),
    },
    { initialState: board.state, artifactStore: board.base.store },
  );
  assert.deepEqual(preflight, {
    valid: true,
    assignmentId: chairAssignment.assignmentId,
    schemaId: 'operating-decision-ledger',
    issues: [],
  });
  assert.ok(
    board.state.artifacts.some(({ artifactId }) => artifactId === board.chairArtifactId),
    'the same public-template bytes pass the actual Chair submission boundary',
  );

  const absenceOnlyAdvisor = board.advisorRecords.find(
    ({ assignment }) =>
      assignment.inputAbsences.some(({ sourceEvidenceRefIds }) =>
        sourceEvidenceRefIds.includes(evidenceRefId),
      ) &&
      !assignment.intelligenceContext.inputBundle.issuedEvidence.some(
        (entry) => entry.evidenceRefId === evidenceRefId,
      ),
  );
  assert.ok(
    absenceOnlyAdvisor,
    'fixture must expose an Advisor with absence metadata but no citation custody',
  );
  const hostile = structuredClone(absenceOnlyAdvisor.output);
  hostile.analysis.executiveQuestionAnswers[0].evidenceRefIds = [evidenceRefId];
  const refused = preflightOperatingAssignmentResultV2(
    {
      assignmentId: absenceOnlyAdvisor.assignment.assignmentId,
      contentBytes: Buffer.from(JSON.stringify(hostile), 'utf8'),
    },
    { initialState: board.state, artifactStore: board.base.store },
  );
  assert.equal(refused.valid, false);
  assert.match(refused.issues[0].message, /not issued/u);
});

test('Decision-ledger materialization preserves protocol plan order instead of Artifact lexical order', () => {
  const board = acceptedBoard('plan_order', { reverseAdvisorArtifactIds: true });
  const expectedPlanOrder = board.plan.selectedRoles
    .filter(({ roleKind }) => roleKind === 'advisor')
    .map(
      ({ roleId, roleVersion }) =>
        board.advisorRecords.find(
          ({ assignment }) =>
            assignment.roleId === roleId && assignment.roleVersion === roleVersion,
        )?.artifactId,
    );
  assert.ok(expectedPlanOrder.every(Boolean));
  assert.deepEqual(board.ledger.advisorArtifactIds, expectedPlanOrder);
  assert.notDeepEqual(
    board.ledger.advisorArtifactIds,
    [...board.ledger.advisorArtifactIds].sort(),
    'fixture must make plan order observably different from Artifact lexical order',
  );

  const result = materialize(board, 'plan_order');
  assert.deepEqual(result.ledger.advisorArtifactIds, expectedPlanOrder);
  assert.equal(result.replayed, false);
  assert.ok(result.events.some(({ type }) => type === 'finding.recorded'));

  const events = [...board.base.result.events, ...board.events, ...result.events];
  assert.equal(events.length, result.state.eventReplayIndex.length);
  const experience = buildOperateExperienceViewV2(result.state, {
    scope: {
      scopeId: board.plan.scopeId,
      domainId: board.plan.domainId,
      domainVersion: board.plan.domainVersion,
    },
    actor: { actorId: 'owner-ledger-001', accessLevel: 'internal' },
    deliveryRoutes: [],
    allowedActions: [],
    events,
    checkpoint: null,
  });
  assert.equal(experience.replay.parityProof.finalEventHashMatches, true);
  const projectedFinding = experience.cycles
    .find(({ cycleId }) => cycleId === board.cycleId)
    ?.executiveBoard?.challengerFindings?.findings.find(
      ({ findingId }) => findingId === result.findings[0].findingId,
    );
  assert.equal(projectedFinding?.sourceArtifactId, board.challengerArtifactId);
  assert.equal(projectedFinding?.sourceLocalFindingId, result.findings[0].sourceLocalFindingId);
});

test('every advertised Review choice remains valid for an unowned materialized Finding', () => {
  const board = acceptedBoard('review_choices');
  const materialized = materialize(board, 'review_choices');
  const sourceFinding = materialized.findings[0];
  assert.equal(
    sourceFinding.ownerActorId,
    null,
    'Challenger materialization must not invent a human owner',
  );
  assert.equal(sourceFinding.revisitAt, null);

  const reviewId = 'rev_materialized_choices_0001';
  const ownerActorId = 'owner-ledger-001';
  const initialState = structuredClone(materialized.state);
  const cycleIndex = initialState.cycles.findIndex(({ cycleId }) => cycleId === board.cycleId);
  initialState.cycles[cycleIndex] = {
    ...initialState.cycles[cycleIndex],
    state: 'awaiting_review',
    activeReviewId: reviewId,
    updatedAt: REVIEW_TIME,
  };
  initialState.reviews.push({
    kind: 'operating-review',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    reviewId,
    cycleId: board.cycleId,
    subject: { type: 'cycle', cycleId: board.cycleId },
    ownerActorId,
    state: 'pending',
    disposition: null,
    workDispositions: [],
    createdAt: REVIEW_TIME,
    updatedAt: REVIEW_TIME,
  });
  const ownerRequest = {
    reviewId,
    cycleId: board.cycleId,
    actor: { actorId: ownerActorId, kind: 'human', runtime: 'portable' },
    scope: {
      scopeId: board.plan.scopeId,
      domainId: board.plan.domainId,
      domainVersion: board.plan.domainVersion,
    },
  };
  const read = readOperatingReviewV2(ownerRequest, {
    initialState,
    capabilities: ['operate.review.get'],
    readAt: REVIEW_TIME,
  }).data;
  const approvedChoices = read.dispositionChoices.filter(
    ({ submitArguments }) => submitArguments.disposition === 'approved',
  );
  assert.deepEqual(
    approvedChoices.map(
      ({ submitArguments }) =>
        submitArguments.workDispositions.find(
          ({ entityId }) => entityId === sourceFinding.findingId,
        )?.disposition,
    ),
    ['accepted', 'deferred', 'rejected'],
  );
  assert.deepEqual(
    read.dispositionChoices.map(({ submitArguments }) => submitArguments.disposition),
    ['approved', 'approved', 'approved', 'changes_requested', 'rejected', 'cancelled'],
  );

  for (const [position, choice] of read.dispositionChoices.entries()) {
    const expectedFindingDisposition =
      choice.submitArguments.workDispositions.find(
        ({ entityId }) => entityId === sourceFinding.findingId,
      )?.disposition ?? sourceFinding.state;
    const committed = submitOperatingReviewV2(
      choice.submitArguments,
      {
        eventId: `evt_review_choices_${position + 1}`,
        timestamp: REVIEW_TIME,
        correlationId: `corr_review_choices_${position + 1}`,
      },
      {
        initialState: structuredClone(initialState),
        capabilities: [REVIEW_SUBMIT_CAPABILITY],
      },
    );
    const committedFinding = committed.state.findings.find(
      ({ findingId }) => findingId === sourceFinding.findingId,
    );
    assert.equal(committedFinding.state, expectedFindingDisposition);
    if (
      choice.submitArguments.disposition === 'approved' &&
      expectedFindingDisposition === 'deferred'
    ) {
      assert.equal(committedFinding.ownerActorId, ownerActorId);
      assert.equal(committedFinding.revisitAt, null);
    } else if (choice.submitArguments.disposition !== 'approved') {
      assert.equal(committedFinding.ownerActorId, null);
      assert.equal(
        committed.state.cycles.find(({ cycleId }) => cycleId === board.cycleId).state,
        'awaiting_review',
      );
    }
    const replayed = reduceOperatingRuntimeEventsV2(committed.events, {
      initialState,
      artifactStore: board.base.store,
    });
    assert.equal(sha256Jcs(replayed), sha256Jcs(committed.state));
  }
});

function materialize(board, seed = 'structured') {
  return materializeOperatingDecisionLedgerV2(
    {
      cycleId: board.cycleId,
      snapshotId: board.snapshotId,
      stateId: board.stateId,
      intelligencePlanId: board.plan.planId,
      advisorArtifactIds: board.advisorRecords.map(({ artifactId }) => artifactId),
      challengerArtifactId: board.challengerArtifactId,
      chairArtifactId: board.chairArtifactId,
    },
    {
      eventId: `evt_${seed}_ledger`,
      claimEventIds: [`evt_${seed}_claim`],
      riskEventIds: [`evt_${seed}_risk`],
      findingEventIds: [`evt_${seed}_finding`],
      decisionEventIds: [`evt_${seed}_decision`],
      timestamp: MATERIALIZE_TIME,
      correlationId: `corr_${seed}_ledger`,
    },
    {
      initialState: board.state,
      artifactStore: board.base.store,
      replayHook: createNoModelReplayHookV2(),
    },
  );
}

test('structured Advisor, Challenger, and Chair bytes atomically materialize clm/rsk/fnd/dec records live and on restart', () => {
  const board = acceptedBoard('structured');
  const before = sha256Jcs(board.state);
  const result = materialize(board, 'structured');
  assert.equal(sha256Jcs(board.state), before, 'accepted source state remains immutable');
  assert.deepEqual(
    result.events.map(({ type }) => type),
    [
      'decision-ledger.materialized',
      'claim.recorded',
      'risk.recorded',
      'finding.recorded',
      'decision.revised',
    ],
  );
  assert.equal(result.claims.length, 1);
  assert.equal(result.risks.length, 1);
  assert.equal(result.findings.length, 1);
  assert.equal(result.decisions.length, 1);
  assert.match(result.claims[0].claimId, /^clm_/u);
  assert.match(result.risks[0].riskId, /^rsk_/u);
  assert.match(result.findings[0].findingId, /^fnd_/u);
  assert.match(result.decisions[0].decisionId, /^dec_/u);
  assert.deepEqual(result.decisions[0].claimIds, [result.claims[0].claimId]);
  assert.deepEqual(result.decisions[0].findingIds, [result.findings[0].findingId]);
  assert.equal(result.claims[0].sourceArtifactId, board.advisorRecords[0].artifactId);
  assert.notEqual(
    result.claims[0].sourceArtifactId,
    board.base.evidenceRef.sourceArtifactId,
    'producer Artifact custody remains distinct from cited EvidenceRef source custody',
  );

  const restarted = reduceOperatingRuntimeEventsV2(result.events, {
    initialState: board.state,
    artifactStore: board.base.store,
  });
  assert.equal(sha256Jcs(restarted), sha256Jcs(result.state));
  const replayed = materializeOperatingDecisionLedgerV2(
    {
      cycleId: board.cycleId,
      snapshotId: board.snapshotId,
      stateId: board.stateId,
      intelligencePlanId: board.plan.planId,
      advisorArtifactIds: board.advisorRecords.map(({ artifactId }) => artifactId),
      challengerArtifactId: board.challengerArtifactId,
      chairArtifactId: board.chairArtifactId,
    },
    {
      eventId: 'evt_structured_ledger',
      claimEventIds: ['evt_structured_claim'],
      riskEventIds: ['evt_structured_risk'],
      findingEventIds: ['evt_structured_finding'],
      decisionEventIds: ['evt_structured_decision'],
      timestamp: MATERIALIZE_TIME,
      correlationId: 'corr_structured_ledger',
    },
    { initialState: result.state, artifactStore: board.base.store },
  );
  assert.equal(replayed.replayed, true);
  assert.deepEqual(replayed.events, []);
});

test('multiline source text remains byte-exact through atomic Claim, Risk, Finding, and Decision materialization', () => {
  const source = {
    claimStatement: multilineText(513, 'C'),
    claimChangeCondition: multilineText(513, 'H'),
    riskStatement: multilineText(513, 'R'),
    riskExposure: multilineText(513, 'E'),
    riskMitigation: multilineText(513, 'M'),
    riskReversibility: multilineText(513, 'V'),
    findingStatement: multilineText(513, 'F'),
    findingRationale: multilineText(513, 'A'),
    findingCorrectionCondition: multilineText(513, 'K'),
    dissentStatement: multilineText(513, 'D'),
    dissentResolutionCondition: multilineText(513, 'L'),
    decisionQuestion: multilineText(513, 'Q'),
    decisionOutcome: multilineText(513, 'O'),
    decisionRationale: multilineText(513, 'N'),
    alternativeRationale: multilineText(513, 'T'),
    decisionUpside: multilineText(513, 'U'),
    decisionDownside: multilineText(513, 'W'),
    decisionUncertainty: multilineText(513, 'Y'),
    decisionReversibility: multilineText(513, 'Z'),
    revisitCondition: multilineText(513, 'J'),
  };
  const board = acceptedBoard('multiline_materialization', {
    mutateAdvisorResult(value, { position }) {
      if (position !== 0) return;
      value.claims[0].statement = source.claimStatement;
      value.claims[0].changeCondition = source.claimChangeCondition;
      value.risks[0].statement = source.riskStatement;
      value.risks[0].exposure = source.riskExposure;
      value.risks[0].mitigation = source.riskMitigation;
      value.risks[0].reversibility = source.riskReversibility;
    },
    mutateChallengerResult(value) {
      value.findings[0].statement = source.findingStatement;
      value.findings[0].rationale = source.findingRationale;
      value.findings[0].correctionCondition = source.findingCorrectionCondition;
      value.dissent[0].statement = source.dissentStatement;
      value.dissent[0].resolutionCondition = source.dissentResolutionCondition;
    },
    mutateChairLedger(value) {
      const [decision] = value.decisions;
      decision.question = source.decisionQuestion;
      decision.outcome = source.decisionOutcome;
      decision.rationale = source.decisionRationale;
      decision.alternativeDispositions[0].rationale = source.alternativeRationale;
      decision.upside = source.decisionUpside;
      decision.downside = source.decisionDownside;
      decision.uncertainty = source.decisionUncertainty;
      decision.reversibility = source.decisionReversibility;
      decision.revisitConditions = [source.revisitCondition];
    },
  });
  const result = materialize(board, 'multiline_materialization');
  assert.equal(result.claims[0].statement, source.claimStatement);
  assert.equal(result.claims[0].changeCondition, source.claimChangeCondition);
  assert.equal(result.risks[0].statement, source.riskStatement);
  assert.equal(result.risks[0].exposureStatement, source.riskExposure);
  assert.deepEqual(result.risks[0].mitigations, [source.riskMitigation]);
  assert.equal(result.risks[0].reversibility, source.riskReversibility);
  assert.equal(result.findings[0].statement, source.findingStatement);
  assert.equal(result.findings[0].rationale, source.findingRationale);
  assert.equal(result.findings[0].correctionCondition, source.findingCorrectionCondition);
  assert.equal(result.decisions[0].question, source.decisionQuestion);
  assert.equal(result.decisions[0].outcome, source.decisionOutcome);
  assert.equal(result.decisions[0].rationale, source.decisionRationale);
  assert.equal(
    result.decisions[0].alternativeDispositions[0].rationale,
    source.alternativeRationale,
  );
  assert.equal(result.decisions[0].expectedUpside, source.decisionUpside);
  assert.equal(result.decisions[0].expectedDownside, source.decisionDownside);
  assert.equal(result.decisions[0].uncertainty, source.decisionUncertainty);
  assert.equal(result.decisions[0].reversibility, source.decisionReversibility);
  assert.deepEqual(result.decisions[0].dissent, [source.dissentStatement]);
  assert.deepEqual(result.decisions[0].reopenConditions, [source.revisitCondition]);
  assert.deepEqual(result.decisions[0].revisitConditions, [source.revisitCondition]);
});

test('prepared Assignment preflight returns multiple bounded JSON-pointer schema issues without emitting state', () => {
  const board = acceptedBoard('preflight');
  const advisor = board.advisorRecords[0];
  const malformed = structuredClone(advisor.output);
  delete malformed.summary;
  malformed.analysisMarkdown = '';
  malformed.claims = 'not-an-array';
  malformed.invented = true;
  const before = sha256Jcs(board.state);
  const result = preflightOperatingAssignmentResultV2(
    {
      assignmentId: advisor.assignment.assignmentId,
      contentBytes: Buffer.from(JSON.stringify(malformed), 'utf8'),
    },
    { initialState: board.state, artifactStore: board.base.store },
  );
  assert.equal(result.valid, false);
  assert.ok(result.issues.length >= 4);
  assert.ok(result.issues.length <= 64);
  assert.ok(result.issues.every(({ path }) => path.startsWith('/')));
  assert.ok(
    result.issues.some(({ path, message }) => path === '/' && message.includes("'summary'")),
  );
  assert.ok(result.issues.some(({ path }) => path === '/analysisMarkdown'));
  assert.ok(result.issues.some(({ path }) => path === '/claims'));
  assert.equal(sha256Jcs(board.state), before, 'preflight is mutation- and Event-free');
});

test('Challenger and Chair question coverage rejects reordered and foreign role-local references', () => {
  const board = acceptedBoard('question_coverage');
  const challenger = board.state.assignments.find(
    ({ assignmentKind }) => assignmentKind === 'challenger',
  );
  const chair = board.state.assignments.find(({ assignmentKind }) => assignmentKind === 'chair');
  const cases = [
    {
      label: 'reordered Challenger questions',
      assignmentId: challenger.assignmentId,
      source: board.challengerOutput,
      mutate(value) {
        value.questionCoverage.reverse();
      },
      message: /exact ordered registry-owned question identities/u,
    },
    {
      label: 'foreign Challenger Finding',
      assignmentId: challenger.assignmentId,
      source: board.challengerOutput,
      mutate(value) {
        value.questionCoverage[0].findingIds = ['finding:asg_foreign_question_0001:1'];
      },
      message: /foreign Finding/u,
    },
    {
      label: 'reordered Chair questions',
      assignmentId: chair.assignmentId,
      source: board.ledger,
      mutate(value) {
        value.questionCoverage.reverse();
      },
      message: /exact ordered registry-owned question identities/u,
    },
    {
      label: 'foreign Chair Decision',
      assignmentId: chair.assignmentId,
      source: board.ledger,
      mutate(value) {
        value.questionCoverage[0].decisionIds = ['decision:asg_foreign_question_0001:1'];
      },
      message: /foreign Decision/u,
    },
  ];
  for (const { label, assignmentId, source, mutate, message } of cases) {
    const hostile = structuredClone(source);
    mutate(hostile);
    const result = preflightOperatingAssignmentResultV2(
      {
        assignmentId,
        contentBytes: Buffer.from(JSON.stringify(hostile), 'utf8'),
      },
      { initialState: board.state, artifactStore: board.base.store },
    );
    assert.equal(result.valid, false, label);
    assert.ok(
      result.issues.some((issue) => message.test(issue.message)),
      label,
    );
  }
});

test('one unavailable Advisor becomes one exact Challenger role gap and forged gap kinds or references fail', () => {
  const board = acceptedBoard('missing_advisor', { missingAdvisorPosition: 4 });
  const missing = board.state.assignments.find(
    (assignment) => assignment.assignmentKind === 'advisor' && assignment.state === 'failed',
  );
  assert.ok(missing);
  const challenger = board.state.assignments.find(
    ({ assignmentKind }) => assignmentKind === 'challenger',
  );
  const roleAbsence = challenger.inputAbsences.find(
    (absence) => absence.kind === 'role' && absence.sourceAssignmentId === missing.assignmentId,
  );
  assert.ok(roleAbsence);
  const exactGap = board.challengerOutput.gaps.find(
    ({ inputAbsenceId }) => inputAbsenceId === roleAbsence.absenceId,
  );
  assert.deepEqual(exactGap, {
    localGapId: exactGap.localGapId,
    inputAbsenceId: roleAbsence.absenceId,
    kind: 'role',
    roleId: roleAbsence.roleId,
    roleKind: roleAbsence.roleKind,
    roleVersion: roleAbsence.roleVersion,
    sourceAssignmentId: roleAbsence.sourceAssignmentId,
    impact: 'The missing input limits challenge coverage.',
    recoveryPath: 'Recover the exact missing role or Evidence Artifact and rerun challenge.',
  });

  for (const mutate of [
    (gap) => ({
      localGapId: gap.localGapId,
      inputAbsenceId: gap.inputAbsenceId,
      kind: 'evidence',
      requirementId: 'forged-role-as-evidence',
      impact: gap.impact,
      recoveryPath: gap.recoveryPath,
    }),
    (gap) => ({ ...gap, inputAbsenceId: 'abs_role_forged_reference_0001' }),
  ]) {
    const forged = structuredClone(board.challengerOutput);
    const index = forged.gaps.findIndex(
      ({ inputAbsenceId }) => inputAbsenceId === roleAbsence.absenceId,
    );
    forged.gaps[index] = mutate(forged.gaps[index]);
    const result = preflightOperatingAssignmentResultV2(
      {
        assignmentId: challenger.assignmentId,
        contentBytes: Buffer.from(JSON.stringify(forged), 'utf8'),
      },
      { initialState: board.state, artifactStore: board.base.store },
    );
    assert.equal(result.valid, false);
    assert.ok(result.issues.some(({ path }) => path.includes('/gaps') || path === '/'));
  }
});

test('4097-character multiline Challenger dissent is rejected before Artifact or Event emission', () => {
  const board = acceptedBoard('long_dissent_rejection');
  const challengerAssignmentId = board.state.assignments.find(
    ({ assignmentKind }) => assignmentKind === 'challenger',
  ).assignmentId;
  const submittedIndex = board.events.findIndex(
    (event) => event.type === 'assignment.submitted' && event.entityId === challengerAssignmentId,
  );
  assert.ok(submittedIndex > 0, 'fixture must expose the exact pre-submission Challenger state');
  const beforeSubmission = reduceOperatingRuntimeEventsV2(board.events.slice(0, submittedIndex), {
    initialState: board.replayBaseState,
    artifactStore: board.base.store,
  });
  const assignment = beforeSubmission.assignments.find(
    ({ assignmentId }) => assignmentId === challengerAssignmentId,
  );
  const submission = beforeSubmission.submissions.find(
    ({ assignmentId, state }) => assignmentId === challengerAssignmentId && state === 'issued',
  );
  assert.equal(assignment.state, 'running');
  assert.ok(submission);
  const hostile = structuredClone(board.challengerOutput);
  hostile.dissent[0].statement = `x\n${'x'.repeat(4095)}`;
  assert.equal(hostile.dissent[0].statement.length, 4097);
  const beforeHash = sha256Jcs(beforeSubmission);
  const beforeEventCount = beforeSubmission.eventReplayIndex.length;
  assert.throws(
    () =>
      acceptResult(
        {
          state: beforeSubmission,
          response: { assignment, submissionId: submission.submissionId },
        },
        hostile,
        'art_long_dissent_rejected',
        'challenger-review',
        'long_dissent_rejected',
        CHALLENGER_TIME,
        board.base.store,
      ),
    { code: 'RESULT_CONTRACT_INVALID' },
  );
  assert.equal(sha256Jcs(beforeSubmission), beforeHash);
  assert.equal(beforeSubmission.eventReplayIndex.length, beforeEventCount);
  assert.throws(
    () =>
      board.base.store.readRaw({
        artifactId: 'art_long_dissent_rejected',
        rawHash: `sha256:${'0'.repeat(64)}`,
      }),
    { code: 'ARTIFACT_NOT_FOUND' },
  );
});

test('source bounds and placeholder titles fail preflight before durable materialization', () => {
  const board = acceptedBoard('source_bounds');
  const advisor = board.advisorRecords[0];
  const challenger = board.state.assignments.find(
    ({ assignmentKind }) => assignmentKind === 'challenger',
  );
  const chair = board.state.assignments.find(({ assignmentKind }) => assignmentKind === 'chair');
  const preflight = (assignmentId, value) =>
    preflightOperatingAssignmentResultV2(
      {
        assignmentId,
        contentBytes: Buffer.from(JSON.stringify(value), 'utf8'),
      },
      { initialState: board.state, artifactStore: board.base.store },
    );

  const advisorPlaceholder = structuredClone(advisor.output);
  advisorPlaceholder.alternatives[0].title = '<replace-with-alternative-title>';
  assert.equal(preflight(advisor.assignment.assignmentId, advisorPlaceholder).valid, false);

  const challengerPlaceholder = structuredClone(board.challengerOutput);
  challengerPlaceholder.findings[0].title = '{{finding-title}}';
  assert.equal(preflight(challenger.assignmentId, challengerPlaceholder).valid, false);

  const chairPlaceholder = structuredClone(board.ledger);
  chairPlaceholder.decisions[0].title = '<decision-title>';
  assert.equal(preflight(chair.assignmentId, chairPlaceholder).valid, false);

  const tooManyFindings = structuredClone(board.ledger);
  tooManyFindings.decisions[0].challengerFindingIds = Array.from(
    { length: 129 },
    (_unused, position) => `finding:${challenger.assignmentId}:${position + 1}`,
  );
  assert.equal(preflight(chair.assignmentId, tooManyFindings).valid, false);

  const tooManyRevisitConditions = structuredClone(board.ledger);
  tooManyRevisitConditions.decisions[0].revisitConditions = Array.from(
    { length: 33 },
    (_unused, position) => `Revisit condition ${position + 1}.`,
  );
  assert.equal(preflight(chair.assignmentId, tooManyRevisitConditions).valid, false);

  const duplicateClaimReference = structuredClone(board.ledger);
  duplicateClaimReference.decisions[0].sourceClaimRefs.push(
    structuredClone(duplicateClaimReference.decisions[0].sourceClaimRefs[0]),
  );
  assert.equal(preflight(chair.assignmentId, duplicateClaimReference).valid, false);
});

test('Chair preflight bounds aggregate Action hypotheses to the exact owner Review capacity', () => {
  const board = acceptedBoard('aggregate_action_bound');
  const chair = board.state.assignments.find(({ assignmentKind }) => assignmentKind === 'chair');
  const bundleArtifact = board.state.artifacts.find(
    ({ artifactId }) => artifactId === chair.intelligenceContext.inputBundle.bundleArtifactId,
  );
  const bundle = JSON.parse(
    Buffer.from(
      readOperatingArtifactRawBytesV2(board.base.store, {
        artifactId: bundleArtifact.artifactId,
        rawHash: bundleArtifact.rawHash,
      }),
    ).toString('utf8'),
  );
  const objectiveId = 'obj_aggregate_action_capacity_001';
  bundle.operatingState.objectives = [
    {
      recordId: objectiveId,
      recordKind: 'objective',
      title: 'Keep proposed Action review bounded',
      state: 'active',
      evidenceRefIds: [],
    },
  ];
  bundle.operatingState.coverage.objectives = { included: 1, total: 1, omitted: 0 };
  const metricId = bundle.operatingState.metrics[0]?.recordId;
  assert.ok(metricId);

  const withActionCount = (count) => {
    const ledger = structuredClone(board.ledger);
    const source = ledger.decisions[0];
    let position = 0;
    ledger.decisions = Array.from({ length: Math.ceil(count / 256) }, (_unused, decisionIndex) => {
      const decision = structuredClone(source);
      decision.localDecisionId = `decision:${chair.assignmentId}:${decisionIndex + 1}`;
      decision.title = `Bounded Decision ${decisionIndex + 1}`;
      const chunkSize = Math.min(256, count - position);
      decision.actionHypotheses = Array.from({ length: chunkSize }, () => {
        position += 1;
        return {
          localActionHypothesisId: `action-hypothesis:${chair.assignmentId}:${position}`,
          title: `Action ${position}`,
          objectiveId,
          ownerActorId: decision.ownerActorId,
          accountabilityDisposition: null,
          expectedResult: 'Measure.',
          metricId,
          baseline: 0,
          target: 1,
          verificationWindow: 'Next window.',
          verificationMethod: 'Compare the exact metric.',
          sourceClaimRefs: [],
          sourceFindingIds: structuredClone(decision.challengerFindingIds),
          dependsOnActionHypothesisIds: [],
        };
      });
      return decision;
    });
    return ledger;
  };
  const preflight = (value) =>
    preflightOperatingIntelligenceResultV2({
      value,
      assignment: chair,
      plan: board.plan,
      snapshot: board.base.result.snapshot,
      operatingState: board.base.result.operatingState,
      inputBundle: bundle,
      advisorOutputs: board.advisorRecords.map(({ artifactId, output }) => ({
        artifactId,
        output,
      })),
      challengerOutput: { artifactId: board.challengerArtifactId, output: board.challengerOutput },
    });

  const atCapacityValue = withActionCount(512);
  const atCapacity = preflight(atCapacityValue);
  assert.equal(atCapacity.valid, true, JSON.stringify(atCapacity.issues));
  const overCapacity = preflight(withActionCount(513));
  assert.equal(overCapacity.valid, false);
  assert.ok(
    overCapacity.issues.some(
      ({ message, context }) =>
        /bounded owner Review capacity/u.test(message) &&
        context.actionCount === 513 &&
        context.maximumActionCount === 512,
    ),
  );
});

test('Chair accepts a grounded no-alternative recommendation and rejects a foreign alternative reference', () => {
  const board = acceptedBoard('no_alternative', { withAlternative: false });
  assert.deepEqual(board.advisorRecords[0].output.alternatives, []);
  assert.deepEqual(board.ledger.decisions[0].alternativeDispositions, []);
  const materialized = materialize(board, 'no_alternative');
  assert.deepEqual(materialized.state.decisions[0].alternativeDispositions, []);
  const experience = buildOperateExperienceViewV2(materialized.state, {
    scope: {
      scopeId: board.plan.scopeId,
      domainId: board.plan.domainId,
      domainVersion: board.plan.domainVersion,
    },
    actor: { actorId: 'owner-ledger-001', accessLevel: 'internal' },
    deliveryRoutes: [],
    allowedActions: [],
    events: [...board.base.result.events, ...board.events, ...materialized.events],
    checkpoint: null,
  });
  assert.deepEqual(
    experience.cycles.find(({ cycleId }) => cycleId === board.cycleId).executiveBoard.chairSynthesis
      .decisions[0].alternativeDispositions,
    [],
  );

  const forged = structuredClone(board.ledger);
  forged.decisions[0].alternativeDispositions = [
    {
      sourceArtifactId: board.advisorRecords[0].artifactId,
      localAlternativeId: `alternative:${board.advisorRecords[0].assignment.assignmentId}:99`,
      title: 'Invented alternative',
      disposition: 'deferred',
      rationale: 'This source-local alternative does not exist in the accepted Advisor bytes.',
    },
  ];
  const chairAssignment = board.state.assignments.find(
    ({ assignmentKind }) => assignmentKind === 'chair',
  );
  const rejected = preflightOperatingAssignmentResultV2(
    {
      assignmentId: chairAssignment.assignmentId,
      contentBytes: Buffer.from(JSON.stringify(forged), 'utf8'),
    },
    { initialState: board.state, artifactStore: board.base.store },
  );
  assert.equal(rejected.valid, false);
  assert.equal(rejected.issues.length, 1);
  assert.match(rejected.issues[0].message, /foreign or substituted alternative/u);
});

test('parsed or incomplete Chair source coverage has no public materialization route', () => {
  const board = acceptedBoard('coverage');
  const hostile = structuredClone(board.ledger);
  hostile.sourceDispositions = hostile.sourceDispositions.filter(
    ({ sourceKind }) => sourceKind !== 'challenger-finding',
  );
  assert.throws(
    () =>
      materializeOperatingDecisionLedgerV2(
        {
          cycleId: board.cycleId,
          snapshotId: board.snapshotId,
          stateId: board.stateId,
          intelligencePlanId: board.plan.planId,
          advisorArtifactIds: board.advisorRecords.map(({ artifactId }) => artifactId),
          challengerArtifactId: board.challengerArtifactId,
          chairArtifactId: board.chairArtifactId,
          ledger: hostile,
        },
        {
          eventId: 'evt_coverage_hostile_ledger',
          claimEventIds: ['evt_coverage_hostile_claim'],
          riskEventIds: ['evt_coverage_hostile_risk'],
          findingEventIds: ['evt_coverage_hostile_finding'],
          decisionEventIds: ['evt_coverage_hostile_decision'],
          timestamp: MATERIALIZE_TIME,
          correlationId: 'corr_coverage_hostile_ledger',
        },
        { initialState: board.state, artifactStore: board.base.store },
      ),
    { code: 'RESULT_CONTRACT_INVALID' },
  );
});
