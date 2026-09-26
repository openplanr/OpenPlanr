#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPEN_REFERENCE_EVIDENCE_REGISTRY_V2 } from 'planr-pipeline/operate/evidence-v2';
import { OPEN_REFERENCE_OPERATE_EXTENSIONS_V2 } from 'planr-pipeline/operate/extensions-v2';
import {
  projectPublicOperatingDomainV2,
  resolvePublicOperatingDomainV2,
} from 'planr-pipeline/operate/operating-domains-v2';
import {
  createOperatingMetricObservationCandidateV2,
  createOperatingSnapshotCandidateV2,
  createOperatingVerificationCandidateV2,
  selectOperatingMetricProviderV2,
  selectOperatingSnapshotProviderV2,
  selectOperatingVerificationProviderV2,
} from 'planr-pipeline/operate/operating-signal-providers-v2';
import { createOperatingResultTemplateV2 } from 'planr-pipeline/operate/result-packet-v2';
import {
  acceptOperatingAssignmentSubmissionV2,
  createEmptyOperatingRuntimeStateV2,
  createNoModelReplayHookV2,
  createOperatingArtifactByteStoreV2,
  createOperatingRuntimeEventV2,
  deriveOperatingRuntimeDeltaV2,
  deriveOperatingVerificationFeedbackV2,
  materializeOperatingActionVerificationV2,
  materializeOperatingDecisionLedgerV2,
  materializeOperatingEvidenceV2,
  materializeOperatingStateSnapshotV2,
  planOperatingRuntimeIntelligenceBoardV2,
  readOperatingArtifactRawBytesV2,
  recordOperatingActionVerificationOutcomeV2,
  recordOperatingIntelligenceStateV2,
  recordOperatingTriggerScenarioV2,
  reduceOperatingRuntimeEventsV2,
} from 'planr-pipeline/operate/runtime-v2';
import {
  assertOperatingValidatedDependencyProofV2,
  deriveOperatingAssignmentReleaseIntentsV2,
  validateOperatingIntelligenceAssignmentGraphV2,
} from 'planr-pipeline/operate/scheduler-v2';
import { OPERATE_RUNTIME_CONTRACT_KINDS, validateProtocolArtifact } from 'planr-pipeline/protocol';

const VERSION = '2.0.0';
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const fixtureRoot = join(root, 'conformance', 'fixtures', 'operating-runtime-v2');
const STAGE_NAMES = Object.freeze([
  'accepted-snapshot-state',
  'snapshot-provider-candidate-produced',
  'public-domain-projection',
  'delta-trigger-scenario',
  'minimum-plan-scheduler-topology',
  'advisor-submission-proof',
  'challenger-submission-proof',
  'chair-submission-proof',
  'decision-ledger-action-hypothesis',
  'durable-action-verification-plan',
  'metric-provider-candidate-produced',
  'metric-observation-accepted',
  'outcome-learning-atomic',
  'verification-provider-candidate-produced',
  'later-snapshot-delta-revisit',
]);
let checks = 0;

function pass(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

function fixture(name) {
  return JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8'));
}

const valid = fixture('all-contracts-valid.json');
const executionVerificationValid = fixture('execution-verification-valid.json');
const clone = (value) => structuredClone(value);
const bytesFor = (value) => Buffer.from(JSON.stringify(value), 'utf8');
const rawHash = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function timeFor(domainId, offset) {
  const hour = domainId === 'business' ? 10 : 11;
  return `2026-08-10T${String(hour).padStart(2, '0')}:${String(offset).padStart(2, '0')}:00.000Z`;
}

function suffixFor(domainId) {
  return domainId === 'business' ? 'business' : 'software';
}

const BUSINESS_EXECUTIVE_ADVISOR_IDS = Object.freeze([
  'strategy-finance',
  'technology-risk',
  'product-activation',
  'growth-market',
  'operations-customer',
]);

function advisorRoleIdsForDomain(domainId) {
  if (domainId === 'business') {
    return [...BUSINESS_EXECUTIVE_ADVISOR_IDS].sort((left, right) => left.localeCompare(right));
  }
  return ['advisor'];
}

function challengerRoleIdForDomain(domainId) {
  return domainId === 'business' ? 'independent-challenge' : 'challenger';
}

function boardRoleIdsForDomain(domainId) {
  return [...advisorRoleIdsForDomain(domainId), challengerRoleIdForDomain(domainId), 'chair'];
}

function advisorTagForDomain(domainId, roleId) {
  return domainId === 'business' ? roleId.replaceAll('-', '_') : 'advisor';
}

function latestEventId(state) {
  return (
    state.eventReplayIndex.find(({ sequence }) => sequence === state.eventHead.sequence)?.eventId ??
    null
  );
}

function eventAfter(
  state,
  { eventId, timestamp, cycleId, type, entityId, payload, correlationId },
) {
  const previousEvent =
    state.eventHead.sequence === 0
      ? null
      : { sequence: state.eventHead.sequence, eventHash: state.eventHead.hash };
  return createOperatingRuntimeEventV2(
    {
      eventId,
      timestamp,
      cycleId,
      type,
      entityId,
      actor: { kind: 'runtime', id: 'openplanr' },
      causationId: latestEventId(state),
      correlationId,
      payload,
    },
    { previousEvent },
  );
}

function reduceOne(state, event, replayHook) {
  return reduceOperatingRuntimeEventsV2([event], { initialState: state, replayHook });
}

function bootstrap(domainId, replayHook) {
  const suffix = suffixFor(domainId);
  const timestamp = timeFor(domainId, 0);
  const scopeId = `scope-phase5-${suffix}`;
  const cycleId = `cyc_phase5_${suffix}_001`;
  const inputBindingId = `inb_phase5_${suffix}_001`;
  const cycle = {
    ...clone(valid['operating-cycle']),
    cycleId,
    scopeId,
    domainId,
    domainVersion: '1.0.0',
    state: 'advising',
    inputBindingId,
    contractVersions: { 'operating-artifact': '2.0.0' },
    trigger: { kind: 'manual' },
    focus: ['all'],
    health: 'normal',
    activeReviewId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const inputBinding = {
    ...clone(valid['operating-cycle-input-binding']),
    inputBindingId,
    cycleId,
    scopeId,
    domainId,
    domainVersion: '1.0.0',
    sourceArtifactIds: [],
    runtimeBinding: { runtime: 'codex', adapterVersion: '1.0.0' },
    capturedAt: timestamp,
  };
  const state = {
    ...createEmptyOperatingRuntimeStateV2(timestamp),
    cycles: [cycle],
    inputBindings: [inputBinding],
  };
  reduceOperatingRuntimeEventsV2([], { initialState: state, replayHook });
  return { state, cycle, inputBinding, scopeId, cycleId };
}

function pendingContextCaptureAssignment({
  domainId,
  cycleId,
  assignmentId,
  roleId,
  inputArtifactIds,
  timestamp,
}) {
  return {
    kind: 'operating-assignment',
    schemaVersion: '1.0.0',
    protocolVersion: VERSION,
    assignmentId,
    cycleId,
    assignmentKind: 'context-capture',
    roleId,
    objective: `Capture one exact ${roleId} input for this Cycle.`,
    state: 'pending',
    dependsOn: [],
    dependencyPolicy: { kind: 'none' },
    inputArtifactIds: [...inputArtifactIds],
    inputAbsences: [],
    intelligenceContext: null,
    outputContract: {
      schemaId: 'operating-context-capture',
      schemaVersion: '2.0.0',
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 262144,
    },
    capabilityGrantId: `grant-${domainId}-${roleId}`,
    attemptPolicy: { maxAttempts: 3, attempt: 0, timeoutMs: 300000 },
    claim: null,
    terminalOutcome: null,
    createdAt: timestamp,
    availableAt: null,
    completedAt: null,
    mandate: null,
    analysisRubric: null,
  };
}

function createAndAcceptContextArtifact({
  state,
  artifactStore,
  replayHook,
  domainId,
  cycleId,
  tag,
  roleId,
  output,
  artifactType,
  inputArtifactIds = [],
  timestamp,
}) {
  const assignmentId = `asg_phase5_${domainId}_${tag}_001`;
  const submissionId = `sub_phase5_${domainId}_${tag}_001`;
  const artifactId = `art_phase5_${domainId}_${tag}_001`;
  const correlationId = `corr_phase5_${domainId}_${tag}_001`;
  const assignment = pendingContextCaptureAssignment({
    domainId,
    cycleId,
    assignmentId,
    roleId,
    inputArtifactIds,
    timestamp,
  });
  const created = eventAfter(state, {
    eventId: `evt_phase5_${domainId}_${tag}_created_001`,
    timestamp,
    cycleId,
    type: 'assignment.created',
    entityId: assignmentId,
    payload: assignment,
    correlationId,
  });
  let next = reduceOne(state, created, replayHook);
  const intent = deriveOperatingAssignmentReleaseIntentsV2(next).find(
    (candidate) => candidate.assignmentId === assignmentId,
  );
  pass(intent !== undefined, `${domainId}/${tag}: the scheduler derives a release intent`);
  const available = eventAfter(next, {
    eventId: `evt_phase5_${domainId}_${tag}_available_001`,
    timestamp,
    cycleId,
    type: 'assignment.available',
    entityId: assignmentId,
    payload: {
      assignmentId: intent.assignmentId,
      releaseId: intent.releaseId,
      dependencyProofs: [...intent.dependencyProofs],
      dependencyEventIds: [...intent.dependencyEventIds],
    },
    correlationId,
  });
  next = reduceOne(next, available, replayHook);
  const claimed = eventAfter(next, {
    eventId: `evt_phase5_${domainId}_${tag}_claimed_001`,
    timestamp,
    cycleId,
    type: 'assignment.claimed',
    entityId: assignmentId,
    payload: {
      assignmentId,
      actorId: `${roleId}-${domainId}-001`,
      actorKind: 'agent',
      runtime: 'codex',
      claimId: `claim_phase5_${domainId}_${tag}_001`,
      submissionId,
    },
    correlationId,
  });
  next = reduceOne(next, claimed, replayHook);
  const started = eventAfter(next, {
    eventId: `evt_phase5_${domainId}_${tag}_started_001`,
    timestamp,
    cycleId,
    type: 'assignment.started',
    entityId: assignmentId,
    payload: { assignmentId, attempt: 1 },
    correlationId,
  });
  next = reduceOne(next, started, replayHook);
  const accepted = acceptOperatingAssignmentSubmissionV2(
    {
      assignmentId,
      submissionId,
      actor: { actorId: `${roleId}-${domainId}-001`, kind: 'agent', runtime: 'codex' },
      mediaType: 'application/json',
      encoding: 'utf-8',
      contentBase64: bytesFor(output).toString('base64'),
    },
    {
      artifactId,
      artifactType,
      inputArtifactIds: [...inputArtifactIds],
      timestamp,
      validatorVersion: VERSION,
      correlationId,
      eventIds: {
        submitted: `evt_phase5_${domainId}_${tag}_submitted_001`,
        artifactCreated: `evt_phase5_${domainId}_${tag}_artifact_001`,
        validated: `evt_phase5_${domainId}_${tag}_validated_001`,
      },
    },
    { initialState: next, artifactStore, replayHook },
  );
  pass(
    accepted.response.accepted === true &&
      accepted.state.assignments.find((candidate) => candidate.assignmentId === assignmentId)
        ?.state === 'validated',
    `${domainId}/${tag}: context-capture accepts the exact owner input Artifact`,
  );
  return { ...accepted, assignmentId, submissionId, artifactId, output };
}

function acceptPlannedRole({
  state,
  artifactStore,
  replayHook,
  assignment,
  output,
  artifactId,
  submissionId,
  domainId,
  tag,
  timestamp,
}) {
  const correlationId = `corr_phase5_${domainId}_${tag}_001`;
  pass(
    assignment?.state === 'available',
    `${domainId}/${tag}: scheduler releases the role before claim`,
  );
  const claimed = eventAfter(state, {
    eventId: `evt_phase5_${domainId}_${tag}_claimed_001`,
    timestamp,
    cycleId: assignment.cycleId,
    type: 'assignment.claimed',
    entityId: assignment.assignmentId,
    payload: {
      assignmentId: assignment.assignmentId,
      actorId: `${assignment.roleId}-${domainId}-001`,
      actorKind: 'agent',
      runtime: 'codex',
      claimId: `claim_phase5_${domainId}_${tag}_001`,
      submissionId,
    },
    correlationId,
  });
  let next = reduceOne(state, claimed, replayHook);
  const started = eventAfter(next, {
    eventId: `evt_phase5_${domainId}_${tag}_started_001`,
    timestamp,
    cycleId: assignment.cycleId,
    type: 'assignment.started',
    entityId: assignment.assignmentId,
    payload: { assignmentId: assignment.assignmentId, attempt: 1 },
    correlationId,
  });
  next = reduceOne(next, started, replayHook);
  return acceptOperatingAssignmentSubmissionV2(
    {
      assignmentId: assignment.assignmentId,
      submissionId,
      actor: { actorId: `${assignment.roleId}-${domainId}-001`, kind: 'agent', runtime: 'codex' },
      mediaType: 'application/json',
      encoding: 'utf-8',
      contentBase64: bytesFor(output).toString('base64'),
    },
    {
      artifactId,
      artifactType: `${assignment.roleId}-result`,
      inputArtifactIds: [...assignment.inputArtifactIds],
      timestamp,
      validatorVersion: VERSION,
      correlationId,
      eventIds: {
        submitted: `evt_phase5_${domainId}_${tag}_submitted_001`,
        artifactCreated: `evt_phase5_${domainId}_${tag}_artifact_001`,
        validated: `evt_phase5_${domainId}_${tag}_validated_001`,
      },
    },
    { initialState: next, artifactStore, replayHook },
  );
}

function acceptedProof(state, assignmentId) {
  const assignment = state.assignments.find((candidate) => candidate.assignmentId === assignmentId);
  const submission = state.submissions.find(
    (candidate) => candidate.assignmentId === assignmentId && candidate.state === 'accepted',
  );
  const artifact = state.artifacts.find(
    (candidate) => candidate.artifactId === submission?.artifactId,
  );
  const replay = state.submissionReplayIndex.find(
    (candidate) => candidate.submissionId === submission?.submissionId,
  );
  return {
    assignment,
    submission,
    artifact,
    replay,
    proof: assertOperatingValidatedDependencyProofV2({ assignment, submission, artifact, replay }),
  };
}

function issuedInputArtifacts(state, artifactStore, assignment) {
  return assignment.inputArtifactIds.flatMap((artifactId) => {
    const artifact = state.artifacts.find((candidate) => candidate.artifactId === artifactId);
    assert.ok(artifact, `missing issued input Artifact ${artifactId}`);
    if (
      ![
        'operating-intelligence-input-bundle',
        'operating-advisor-result',
        'operating-challenger-review',
      ].includes(artifact.schemaId)
    )
      return [];
    const bytes = readOperatingArtifactRawBytesV2(artifactStore, {
      artifactId,
      rawHash: artifact.rawHash,
    });
    return [{ artifactId, schemaId: artifact.schemaId, value: JSON.parse(bytes.toString('utf8')) }];
  });
}

function authoredAdvisorResult(assignment) {
  const value = clone(createOperatingResultTemplateV2({ assignment }));
  const evidenceRefIds = assignment.intelligenceContext.inputBundle.issuedEvidence.map(
    ({ evidenceRefId }) => evidenceRefId,
  );
  const absenceIds = assignment.inputAbsences.map(({ absenceId }) => absenceId);
  const recommendation = evidenceRefIds.length > 0;
  value.outcome = recommendation ? 'recommendation' : absenceIds.length > 0 ? 'partial' : 'quiet';
  value.summary = recommendation
    ? 'A bounded verified observation should precede an operating-course change.'
    : 'The issued evidence does not support a distinct recommendation from this professional lens.';
  value.analysisMarkdown =
    'This analysis preserves exact issued evidence, typed gaps, uncertainty, and reversible next steps.';
  value.inputAbsenceIds = absenceIds;
  value.gaps = value.gaps.map((gap) => ({
    ...gap,
    impact: 'The unavailable source contract limits confidence in this professional lens.',
    recoveryPath:
      'Issue one current authorized Evidence Artifact satisfying this exact requirement.',
  }));
  for (const answer of value.analysis.executiveQuestionAnswers) {
    answer.answer = recommendation
      ? 'The accepted planning evidence supports one reversible measurement-first operating step.'
      : 'No distinct material conclusion is justified without the requested source contract.';
    answer.evidenceRefIds = [...evidenceRefIds];
    answer.absenceIds = [...absenceIds];
  }
  if (!recommendation) return value;

  const claimId = `claim:${assignment.assignmentId}:1`;
  const riskId = `risk:${assignment.assignmentId}:1`;
  const alternativeId = `alternative:${assignment.assignmentId}:1`;
  const recommendationId = `recommendation:${assignment.assignmentId}:1`;
  value.claims = [
    {
      localClaimId: claimId,
      statement:
        'The accepted planning evidence supports a bounded observation before changing operating course.',
      epistemicStatus: 'probable',
      confidence: 0.68,
      supportingEvidenceRefIds: [...evidenceRefIds],
      contradictingEvidenceRefIds: [],
      assumptionIds: [],
      changeCondition:
        'A current accepted observation contradicts the planning acceptance outcome.',
    },
  ];
  value.risks = [
    {
      localRiskId: riskId,
      title: 'Premature operating-course change',
      statement: 'Changing course before one bounded observation can amplify an unpriced downside.',
      likelihood: 0.5,
      impact: 'high',
      exposure: 'The operating scope may spend the next window on the wrong constraint.',
      exposedSurfaces: ['Operating prioritization'],
      claimIds: [claimId],
      evidenceRefIds: [...evidenceRefIds],
      mitigation: 'Run one bounded verified observation first.',
      reversibility: 'The observation can stop before any operating-course commitment.',
    },
  ];
  value.alternatives = [
    {
      localAlternativeId: alternativeId,
      title: 'Hold the current operating course',
      description: 'Keep the current course unchanged through the next observation window.',
      supportingClaimIds: [claimId],
      evidenceRefIds: [...evidenceRefIds],
      tradeoffs: ['Preserves reversibility but defers another learning path.'],
      costOfDelay: 'One observation window of delayed operating learning.',
      reversibility: 'Fully reversible after the observation window.',
    },
  ];
  value.recommendation = {
    localRecommendationId: recommendationId,
    title: 'Measure before changing operating course',
    proposal: 'Run one bounded verified observation before changing operating course.',
    rationaleClaimIds: [claimId],
    alternativeIds: [alternativeId],
    riskIds: [riskId],
    confidence: 0.68,
    expectedUpside: 'Narrows the material uncertainty before committing resources.',
    expectedDownside: 'Defers another learning path by one observation window.',
    uncertainty: 'The current evidence remains limited to one accepted planning source.',
    reversibility: 'The observation can stop without an operating-course commitment.',
    successMeasurementIds: [],
    revisitConditions: ['A current accepted observation materially changes the signal.'],
  };
  for (const answer of value.analysis.executiveQuestionAnswers) answer.claimIds = [claimId];
  return value;
}

function authoredChallengerResult(assignment, inputArtifacts, advisorArtifactId, advisorOutput) {
  const value = clone(createOperatingResultTemplateV2({ assignment, inputArtifacts }));
  const evidenceRefIds = [...advisorOutput.claims[0].supportingEvidenceRefIds];
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
  value.summary =
    'The reversible recommendation is supportable only if its delayed-learning downside remains explicit.';
  value.analysisMarkdown =
    'The challenge targets the exact accepted Advisor claim, risk, recommendation, and evidence custody.';
  value.inputAbsenceIds = assignment.inputAbsences.map(({ absenceId }) => absenceId);
  value.findings = [
    {
      localFindingId: findingId,
      title: 'Delayed-learning downside is not fully priced',
      statement:
        'The recommendation does not fully price the opportunity cost of delaying another learning path.',
      type: 'unpriced-downside',
      severity: 'medium',
      confidence: 0.62,
      targets: [target],
      supportingEvidenceRefIds: [...evidenceRefIds],
      contradictingEvidenceRefIds: [],
      rationale:
        'The source claim supports observation but does not quantify the delayed-learning cost.',
      correctionCondition: 'Price and bound the delayed-learning cost in the Chair decision.',
    },
  ];
  value.missingAlternatives = [
    {
      localAlternativeId: `alternative:${assignment.assignmentId}:1`,
      title: 'Parallel bounded observation',
      description: 'Run the observation while retaining a small second learning lane.',
      targets: [target],
      evidenceRefIds: [...evidenceRefIds],
      tradeoffs: ['Uses more capacity but preserves both learning loops.'],
    },
  ];
  value.dissent = [
    {
      localDissentId: dissentId,
      findingIds: [findingId],
      statement:
        'Do not approve an observation-only path unless the delayed-learning cost is explicitly bounded.',
      evidenceRefIds: [...evidenceRefIds],
      resolutionCondition: 'Bound and price the delayed-learning cost in the accepted Decision.',
    },
  ];
  value.gaps = value.gaps.map((gap) => ({
    ...gap,
    impact: 'The missing input limits challenge coverage.',
    recoveryPath: 'Recover the exact missing input and rerun the challenge.',
  }));
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
        answer: 'One omitted parallel-observation alternative remains material.',
        alternativeIds: [value.missingAlternatives[0].localAlternativeId],
        justification: null,
      };
    }
    return {
      ...coverage,
      disposition: 'answered',
      answer:
        'The exact Finding and dissent preserve the unpriced downside in the accepted recommendation.',
      findingIds: [findingId],
      dissentIds: coverage.questionId === 'challenge-unpriced-downside' ? [dissentId] : [],
      justification: null,
    };
  });
  return value;
}

function authoredChairLedger({
  assignment,
  inputArtifacts,
  advisorArtifactId,
  advisorOutput,
  challengerArtifactId,
  challengerOutput,
  objectiveId,
  metricId,
}) {
  const value = clone(createOperatingResultTemplateV2({ assignment, inputArtifacts }));
  const decisionId = `decision:${assignment.assignmentId}:1`;
  const actionId = `action-hypothesis:${assignment.assignmentId}:1`;
  const claimRef = { advisorArtifactId, localClaimId: advisorOutput.claims[0].localClaimId };
  const evidenceRefId = advisorOutput.claims[0].supportingEvidenceRefIds[0];
  value.summary =
    'Approve one bounded observation while explicitly limiting the delayed-learning cost.';
  value.decisions = [
    {
      localDecisionId: decisionId,
      title: 'Run one bounded verified observation',
      question: 'How should the scope reduce uncertainty without hiding delayed learning?',
      outcome: 'Run one bounded verified observation and cap delay to one window.',
      rationale:
        'The Advisor claim supports a reversible observation and the Challenger Finding prices its downside.',
      sourceClaimRefs: [claimRef],
      sourceRecommendationRefs: [
        {
          advisorArtifactId,
          localRecommendationId: advisorOutput.recommendation.localRecommendationId,
        },
      ],
      challengerFindingIds: [challengerOutput.findings[0].localFindingId],
      evidenceRefIds: [evidenceRefId],
      alternativeDispositions: [
        {
          sourceArtifactId: advisorArtifactId,
          localAlternativeId: advisorOutput.alternatives[0].localAlternativeId,
          title: advisorOutput.alternatives[0].title,
          disposition: 'deferred',
          rationale: 'Holding the course is less informative than a bounded verified observation.',
        },
      ],
      confidence: 0.66,
      assumptionIds: [],
      upside: 'Narrows material uncertainty before a resource commitment.',
      downside: 'Defers another learning path for one bounded window.',
      uncertainty: 'The signal remains uncertain until the next accepted observation.',
      reversibility: 'The observation can stop without committing an operating-course change.',
      ownerActorId: assignment.intelligenceContext.decisionOwnerActorId,
      revisitConditions: ['The next accepted observation materially changes the signal.'],
      dissentIds: [challengerOutput.dissent[0].localDissentId],
      actionHypotheses: [
        {
          localActionHypothesisId: actionId,
          title: 'Run the bounded verified observation',
          objectiveId,
          ownerActorId: assignment.intelligenceContext.decisionOwnerActorId,
          accountabilityDisposition: null,
          expectedResult: 'An accepted observation reaches the declared target.',
          metricId,
          baseline: 0.6,
          target: 0.8,
          verificationWindow: 'The next accepted observation window.',
          verificationMethod: 'Compare the accepted observation with the declared target.',
          sourceClaimRefs: [claimRef],
          sourceFindingIds: [challengerOutput.findings[0].localFindingId],
          dependsOnActionHypothesisIds: [],
        },
      ],
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
        : 'The partial Advisor outcome is retained without inventing a recommendation.',
    };
  });
  value.questionCoverage = value.questionCoverage.map((coverage) => {
    if (coverage.questionId === 'synthesis-limiting-gaps') {
      return {
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
  assert.equal(value.challengerArtifactId, challengerArtifactId);
  return value;
}

function stage(stages, name, condition, details) {
  pass(STAGE_NAMES.includes(name), `declared stage ${name}`);
  pass(!Object.hasOwn(stages, name), `stage ${name} is recorded exactly once`);
  pass(condition, name);
  stages[name] = Object.freeze({ passed: true, ...clone(details) });
}

export function runOperatingIntelligenceJourneyV2(
  domainId,
  { includeContext = false, stopAfterAction = false } = {},
) {
  const domain = fixture(`${domainId}-domain-valid.json`);
  const replayHook = createNoModelReplayHookV2();
  const artifactStore = createOperatingArtifactByteStoreV2();
  const stages = {};
  const { state: bootstrapState, scopeId, cycleId } = bootstrap(domainId, replayHook);
  const sourceArtifactId = `art_phase5_${domainId}_source_001`;
  const evidenceRefId = `evr_phase5_${domainId}_001`;
  const evidenceCandidateId = `evc_phase5_${domainId}_001`;
  const planrProjectId = `project-phase5-${domainId}`;
  const planrArtifactId = `acceptance-phase5-${domainId}`;
  const planrArtifactPath = '.planr/evidence/acceptance.json';
  const planrProjectRoot = mkdtempSync(join(tmpdir(), `planr-operate-${domainId}-`));
  const planrEvidenceBytes = bytesFor({
    kind: 'planning-acceptance-evidence',
    scopeId,
    domainId,
    acceptanceOutcomes: [
      'The bounded operating observation is verified against its declared target.',
    ],
  });
  mkdirSync(join(planrProjectRoot, '.planr/evidence'), { recursive: true });
  writeFileSync(join(planrProjectRoot, planrArtifactPath), planrEvidenceBytes);
  const evidenceCandidate = {
    kind: 'operating-evidence-candidate',
    schemaVersion: '1.0.0',
    protocolVersion: VERSION,
    candidateId: evidenceCandidateId,
    scopeId,
    domainId,
    domainVersion: '1.0.0',
    sourceArtifactId,
    evidenceKind: 'planr',
    locator: {
      projectId: planrProjectId,
      artifactId: planrArtifactId,
      artifactType: 'planning-acceptance',
      path: planrArtifactPath,
      contentHash: rawHash(planrEvidenceBytes),
    },
    provider: { id: 'local-planr-evidence-provider', version: '2.0.0' },
    resolver: { id: 'local-planr-evidence-resolver', version: '2.0.0' },
  };
  const sourceOutput = {
    kind: 'operating-context-capture',
    schemaVersion: '1.0.0',
    protocolVersion: VERSION,
    contextKind: 'cycle-manifest',
    scope: { scopeId, domainId, domainVersion: '1.0.0' },
    evidenceCandidates: [evidenceCandidate],
    evidenceClaimLinks: [],
  };
  const source = createAndAcceptContextArtifact({
    state: bootstrapState,
    artifactStore,
    replayHook,
    domainId,
    cycleId,
    tag: 'source',
    roleId: 'context-manifest',
    output: sourceOutput,
    artifactType: 'cycle-manifest',
    timestamp: timeFor(domainId, 2),
  });
  assert.equal(source.artifactId, sourceArtifactId);
  let evidence;
  try {
    evidence = materializeOperatingEvidenceV2(
      {
        candidate: evidenceCandidate,
        claimLinks: [],
      },
      {
        resolutionId: `evs_phase5_${domainId}_001`,
        eventId: `evt_phase5_${domainId}_evidence_001`,
        timestamp: timeFor(domainId, 3),
        correlationId: `corr_phase5_${domainId}_evidence_001`,
        evidenceRefId,
        evidenceArtifactId: `art_phase5_${domainId}_evidence_001`,
      },
      {
        initialState: source.state,
        registry: OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
        artifactStore,
        resolverContext: {
          capabilities: ['evidence.planr.read'],
          planrProjects: [
            {
              projectId: planrProjectId,
              rootPath: planrProjectRoot,
              scope: { scopeId, domainId, domainVersion: '1.0.0' },
              classification: 'internal',
              artifacts: [
                {
                  artifactId: planrArtifactId,
                  artifactType: 'planning-acceptance',
                  path: planrArtifactPath,
                  contentHash: rawHash(planrEvidenceBytes),
                  sourceContract: { id: 'planning-acceptance', version: '1.0.0' },
                },
              ],
            },
          ],
        },
        replayHook,
      },
    );
  } finally {
    rmSync(planrProjectRoot, { recursive: true, force: true });
  }
  assert.ok(evidence.evidenceRef, JSON.stringify(evidence.resolution));
  pass(
    evidence.evidenceRef.evidenceRefId === evidenceRefId &&
      evidence.events.map(({ type }) => type).join(',') === 'evidence.resolved',
    `${domainId}: local accepted evidence is materialized through the public runtime transaction`,
  );

  const metric = {
    ...clone(valid['operating-metric']),
    metricId: `met_phase5_${domainId}_001`,
    scopeId,
    domainId,
    domainVersion: '1.0.0',
    title: `${domainId} operating signal`,
    target: 0.8,
    threshold: 0.7,
    observationIds: [],
    evidenceRefIds: [evidenceRefId],
    sourceArtifactId,
    createdAt: timeFor(domainId, 4),
    updatedAt: timeFor(domainId, 4),
  };
  const objective = {
    ...clone(valid['operating-objective']),
    objectiveId: `obj_phase5_${domainId}_001`,
    scopeId,
    domainId,
    domainVersion: '1.0.0',
    title: `Improve the ${domainId} operating signal`,
    metricIds: [metric.metricId],
    evidenceRefIds: [evidenceRefId],
    sourceArtifactId,
    createdAt: timeFor(domainId, 4),
    updatedAt: timeFor(domainId, 4),
  };
  const finding = {
    ...clone(valid['operating-finding']),
    findingId: `fnd_phase5_${domainId}_001`,
    scopeId,
    domainId,
    domainVersion: '1.0.0',
    sourceCycleId: cycleId,
    sourceArtifactId,
    title: `${domainId} signal requires a measured response`,
    statement: `The accepted ${domainId} signal is below its declared target.`,
    createdAt: timeFor(domainId, 4),
    updatedAt: timeFor(domainId, 4),
  };
  const risk = {
    ...clone(valid['operating-risk']),
    riskId: `rsk_phase5_${domainId}_001`,
    revisionId: `rsk_phase5_${domainId}_001`,
    scopeId,
    domainId,
    domainVersion: '1.0.0',
    title: `${domainId} target risk`,
    statement: `The ${domainId} signal may remain below target.`,
    exposure: 0.32,
    evidenceRefIds: [evidenceRefId],
    sourceArtifactId,
    createdAt: timeFor(domainId, 4),
    updatedAt: timeFor(domainId, 4),
  };
  const assumption = {
    ...clone(valid['operating-assumption']),
    assumptionId: `asm_phase5_${domainId}_001`,
    revisionId: `asm_phase5_${domainId}_001`,
    scopeId,
    domainId,
    domainVersion: '1.0.0',
    statement: `The accepted ${domainId} observation is representative.`,
    affectedDecisionIds: [],
    affectedActionIds: [],
    evidenceRefIds: [evidenceRefId],
    sourceArtifactId,
    createdAt: timeFor(domainId, 4),
    updatedAt: timeFor(domainId, 4),
  };
  const initialSnapshot = materializeOperatingStateSnapshotV2(
    {
      cycleId,
      scope: { scopeId, domainId, domainVersion: '1.0.0' },
      domainContract: domain.domainContract,
      sourceArtifactIds: [sourceArtifactId],
      evidenceRefIds: [evidenceRefId],
      sourceRevisions: [{ sourceArtifactId, revision: 'r1', evidenceRefIds: [evidenceRefId] }],
      collections: {
        objectives: [objective],
        metrics: [metric],
        findings: [finding],
        decisions: [],
        actions: [],
        risks: [risk],
        assumptions: [assumption],
      },
    },
    {
      snapshotId: `snp_phase5_${domainId}_001`,
      stateId: `oms_phase5_${domainId}_001`,
      timestamp: timeFor(domainId, 4),
      correlationId: `corr_phase5_${domainId}_snapshot_001`,
      eventIds: {
        snapshot: `evt_phase5_${domainId}_snapshot_001`,
        state: `evt_phase5_${domainId}_state_001`,
      },
    },
    { initialState: evidence.state, artifactStore, replayHook },
  );
  stage(
    stages,
    'accepted-snapshot-state',
    initialSnapshot.events.map(({ type }) => type).join(',') ===
      'snapshot.materialized,operating-state.materialized' &&
      initialSnapshot.state.operatingSnapshots.some(
        ({ snapshotId }) => snapshotId === initialSnapshot.snapshot.snapshotId,
      ) &&
      initialSnapshot.state.operatingModelStates.some(
        ({ stateId }) => stateId === initialSnapshot.operatingState.stateId,
      ),
    {
      snapshotId: initialSnapshot.snapshot.snapshotId,
      stateId: initialSnapshot.operatingState.stateId,
      sourceArtifactId,
    },
  );

  const snapshotSelection = selectOperatingSnapshotProviderV2(
    OPEN_REFERENCE_OPERATE_EXTENSIONS_V2,
    {
      providerId: 'open-reference-snapshot-provider',
      providerVersion: '1.0.0',
      domainContract: domain.domainContract,
    },
  );
  const snapshotCandidate = createOperatingSnapshotCandidateV2({
    providerId: snapshotSelection.provider.providerId,
    providerVersion: snapshotSelection.provider.providerVersion,
    snapshot: initialSnapshot.snapshot,
    state: initialSnapshot.operatingState,
    acceptedArtifacts: [source.artifact],
  });
  stage(
    stages,
    'snapshot-provider-candidate-produced',
    snapshotCandidate.status === 'candidate' &&
      snapshotCandidate.candidate.snapshotId === initialSnapshot.snapshot.snapshotId &&
      snapshotCandidate.candidate.sourceArtifactIds.includes(sourceArtifactId),
    {
      providerId: snapshotSelection.provider.providerId,
      snapshotId: snapshotCandidate.candidate.snapshotId,
      sourceArtifactIds: [...snapshotCandidate.candidate.sourceArtifactIds],
    },
  );

  const projection = projectPublicOperatingDomainV2({
    registry: OPEN_REFERENCE_OPERATE_EXTENSIONS_V2,
    state: initialSnapshot.operatingState,
    snapshot: initialSnapshot.snapshot,
    referencedArtifacts: [source.artifact],
  });
  stage(
    stages,
    'public-domain-projection',
    resolvePublicOperatingDomainV2(OPEN_REFERENCE_OPERATE_EXTENSIONS_V2, domainId, {
      domainVersion: '1.0.0',
    })?.domainContract.id === `${domainId}-domain` &&
      projection.domainId === domainId &&
      projection.stateId === initialSnapshot.operatingState.stateId,
    {
      projectionKind: projection.kind,
      projectionId: projection.projectionId,
    },
  );

  const initialDelta = deriveOperatingRuntimeDeltaV2(
    {
      cycleId,
      snapshotId: initialSnapshot.snapshot.snapshotId,
      stateId: initialSnapshot.operatingState.stateId,
    },
    {
      deltaId: `dlt_phase5_${domainId}_001`,
      eventId: `evt_phase5_${domainId}_delta_001`,
      timestamp: timeFor(domainId, 6),
      correlationId: `corr_phase5_${domainId}_delta_001`,
    },
    { initialState: initialSnapshot.state, replayHook },
  );
  const scenario = {
    ...clone(fixture('operating-trigger-scenario-valid.json').scenario),
    scenarioId: `scn_phase5_${domainId}_001`,
    scopeId,
    domainId,
    domainVersion: '1.0.0',
    snapshotId: initialSnapshot.snapshot.snapshotId,
    base: {
      statement: `The ${domainId} signal remains in its current range.`,
      assumptionIds: [assumption.assumptionId],
      evidenceRefIds: [evidenceRefId],
      sourceArtifactId,
    },
    upside: {
      statement: `The ${domainId} signal reaches the target after observation.`,
      assumptionIds: [assumption.assumptionId],
      evidenceRefIds: [evidenceRefId],
      sourceArtifactId,
    },
    downside: {
      statement: `The ${domainId} signal declines in the next observation window.`,
      assumptionIds: [assumption.assumptionId],
      evidenceRefIds: [evidenceRefId],
      sourceArtifactId,
    },
    assumptionIds: [assumption.assumptionId],
    evidenceRefIds: [evidenceRefId],
    sourceArtifactId,
    createdAt: timeFor(domainId, 7),
  };
  const trigger = {
    ...clone(fixture('operating-trigger-scenario-valid.json').trigger),
    triggerId: `trg_phase5_${domainId}_001`,
    scopeId,
    domainId,
    domainVersion: '1.0.0',
    snapshotId: initialSnapshot.snapshot.snapshotId,
    condition: `A fresh ${domainId} observation crosses the declared threshold.`,
    evidenceRefIds: [evidenceRefId],
    sourceArtifactId,
    createdAt: timeFor(domainId, 7),
  };
  const triggerScenario = recordOperatingTriggerScenarioV2(
    {
      cycleId,
      snapshotId: initialSnapshot.snapshot.snapshotId,
      stateId: initialSnapshot.operatingState.stateId,
      scenarios: [scenario],
      triggers: [trigger],
    },
    {
      timestamp: timeFor(domainId, 7),
      correlationId: `corr_phase5_${domainId}_trigger_scenario_001`,
      eventIds: {
        scenarios: [`evt_phase5_${domainId}_scenario_001`],
        triggers: [`evt_phase5_${domainId}_trigger_001`],
      },
    },
    { initialState: initialDelta.state, replayHook },
  );
  stage(
    stages,
    'delta-trigger-scenario',
    initialDelta.events.length === 1 &&
      initialDelta.delta.exposedRiskIds.includes(risk.riskId) &&
      triggerScenario.events.map(({ type }) => type).join(',') ===
        'scenario.recorded,trigger.recorded',
    {
      deltaId: initialDelta.delta.deltaId,
      scenarioId: scenario.scenarioId,
      triggerId: trigger.triggerId,
    },
  );

  const planned = planOperatingRuntimeIntelligenceBoardV2(
    {
      cycleId,
      snapshotId: initialSnapshot.snapshot.snapshotId,
      stateId: initialSnapshot.operatingState.stateId,
      deltaId: initialDelta.delta.deltaId,
      focus: ['all'],
      domainDescriptor: domain,
      decisionOwnerActorId: `owner-phase5-${domainId}`,
    },
    {
      eventId: `evt_phase5_${domainId}_plan_001`,
      timestamp: timeFor(domainId, 8),
      correlationId: `corr_phase5_${domainId}_plan_001`,
    },
    { initialState: triggerScenario.state, artifactStore, replayHook },
  );
  validateOperatingIntelligenceAssignmentGraphV2(planned.plan, planned.assignments, {
    allowLifecycleProgress: true,
  });
  const roles = Object.fromEntries(
    planned.assignments.map((assignment) => [assignment.roleId, assignment]),
  );
  const advisorRoleIds = advisorRoleIdsForDomain(domainId);
  const challengerRoleId = challengerRoleIdForDomain(domainId);
  const advisorAssignments = advisorRoleIds.map((roleId) => roles[roleId]);
  const challengerAssignment = roles[challengerRoleId];
  const chairAssignment = roles.chair;
  stage(
    stages,
    'minimum-plan-scheduler-topology',
    planned.plan.challengerRequired === true &&
      planned.plan.selectedRoles.map(({ roleId }) => roleId).join(',') ===
        boardRoleIdsForDomain(domainId).join(',') &&
      advisorAssignments.every(({ state }) => state === 'available') &&
      challengerAssignment.state === 'pending' &&
      chairAssignment.state === 'pending' &&
      challengerAssignment.dependsOn.slice().sort().join(',') ===
        advisorAssignments
          .map(({ assignmentId }) => assignmentId)
          .sort()
          .join(',') &&
      new Set(chairAssignment.dependsOn).size === advisorAssignments.length + 1,
    {
      planId: planned.plan.planId,
      topology: planned.assignments.map(({ roleId, assignmentId, dependsOn, state }) => ({
        roleId,
        assignmentId,
        dependsOn,
        state,
      })),
    },
  );

  let advisorAcceptedState = planned.state;
  const advisorArtifactIds = [];
  const advisorResults = [];
  let lastAdvisorProof = null;
  for (const roleId of advisorRoleIds) {
    const tag = advisorTagForDomain(domainId, roleId);
    const advisorArtifactId = `art_phase5_${domainId}_${tag}_001`;
    const advisorOutput = authoredAdvisorResult(roles[roleId]);
    const advisorAccepted = acceptPlannedRole({
      state: advisorAcceptedState,
      artifactStore,
      replayHook,
      assignment: roles[roleId],
      output: advisorOutput,
      artifactId: advisorArtifactId,
      submissionId: `sub_phase5_${domainId}_${tag}_001`,
      domainId,
      tag,
      timestamp: timeFor(domainId, 9),
    });
    advisorAcceptedState = advisorAccepted.state;
    advisorArtifactIds.push(advisorArtifactId);
    advisorResults.push({ roleId, artifactId: advisorArtifactId, output: advisorOutput });
    lastAdvisorProof = acceptedProof(advisorAccepted.state, roles[roleId].assignmentId);
  }
  const recommendedAdvisor = advisorResults.find(({ output }) => output.recommendation !== null);
  assert.ok(recommendedAdvisor, `${domainId}: one Advisor must receive matching screened evidence`);
  const releasedChallenger = advisorAcceptedState.assignments.find(
    ({ assignmentId }) => assignmentId === challengerAssignment.assignmentId,
  );
  stage(
    stages,
    'advisor-submission-proof',
    lastAdvisorProof.proof.artifactId === advisorArtifactIds.at(-1) &&
      lastAdvisorProof.proof.eventId === lastAdvisorProof.submission.acceptanceEventIds.at(-1) &&
      releasedChallenger.state === 'available',
    {
      assignmentId: advisorAssignments.at(-1).assignmentId,
      artifactId: advisorArtifactIds.at(-1),
      validationEventId: lastAdvisorProof.proof.eventId,
      releasedAssignmentId: releasedChallenger.assignmentId,
    },
  );

  const challengerArtifactId = `art_phase5_${domainId}_challenger_001`;
  const chairArtifactId = `art_phase5_${domainId}_chair_001`;
  const challengerInputArtifacts = issuedInputArtifacts(
    advisorAcceptedState,
    artifactStore,
    releasedChallenger,
  );
  const challengerOutput = authoredChallengerResult(
    releasedChallenger,
    challengerInputArtifacts,
    recommendedAdvisor.artifactId,
    recommendedAdvisor.output,
  );
  const challengerAccepted = acceptPlannedRole({
    state: advisorAcceptedState,
    artifactStore,
    replayHook,
    assignment: releasedChallenger,
    output: challengerOutput,
    artifactId: challengerArtifactId,
    submissionId: `sub_phase5_${domainId}_challenger_001`,
    domainId,
    tag: 'challenger',
    timestamp: timeFor(domainId, 10),
  });
  const challengerProof = acceptedProof(
    challengerAccepted.state,
    challengerAssignment.assignmentId,
  );
  const releasedChair = challengerAccepted.state.assignments.find(
    ({ assignmentId }) => assignmentId === chairAssignment.assignmentId,
  );
  stage(
    stages,
    'challenger-submission-proof',
    challengerProof.proof.artifactId === challengerArtifactId &&
      challengerProof.proof.eventId === challengerProof.submission.acceptanceEventIds.at(-1) &&
      releasedChair.state === 'available',
    {
      assignmentId: challengerAssignment.assignmentId,
      artifactId: challengerArtifactId,
      validationEventId: challengerProof.proof.eventId,
      releasedAssignmentId: releasedChair.assignmentId,
    },
  );

  const chairInputArtifacts = issuedInputArtifacts(
    challengerAccepted.state,
    artifactStore,
    releasedChair,
  );
  const ledger = authoredChairLedger({
    assignment: releasedChair,
    inputArtifacts: chairInputArtifacts,
    advisorArtifactId: recommendedAdvisor.artifactId,
    advisorOutput: recommendedAdvisor.output,
    challengerArtifactId,
    challengerOutput,
    objectiveId: objective.objectiveId,
    metricId: metric.metricId,
  });
  const chairAccepted = acceptPlannedRole({
    state: challengerAccepted.state,
    artifactStore,
    replayHook,
    assignment: releasedChair,
    output: ledger,
    artifactId: chairArtifactId,
    submissionId: `sub_phase5_${domainId}_chair_001`,
    domainId,
    tag: 'chair',
    timestamp: timeFor(domainId, 11),
  });
  const chairProof = acceptedProof(chairAccepted.state, chairAssignment.assignmentId);
  stage(
    stages,
    'chair-submission-proof',
    chairProof.proof.artifactId === chairArtifactId &&
      chairProof.proof.eventId === chairProof.submission.acceptanceEventIds.at(-1),
    {
      assignmentId: chairAssignment.assignmentId,
      artifactId: chairArtifactId,
      validationEventId: chairProof.proof.eventId,
    },
  );

  const chairBytes = readOperatingArtifactRawBytesV2(artifactStore, {
    artifactId: chairArtifactId,
    rawHash: chairProof.artifact.rawHash,
  });
  const ledgerResult = materializeOperatingDecisionLedgerV2(
    {
      cycleId,
      snapshotId: initialSnapshot.snapshot.snapshotId,
      stateId: initialSnapshot.operatingState.stateId,
      intelligencePlanId: planned.plan.planId,
      advisorArtifactIds: [...advisorArtifactIds],
      challengerArtifactId,
      chairArtifactId,
    },
    {
      eventId: `evt_phase5_${domainId}_ledger_001`,
      claimEventIds: [`evt_phase5_${domainId}_advisor_claim_001`],
      riskEventIds: [`evt_phase5_${domainId}_advisor_risk_001`],
      findingEventIds: [`evt_phase5_${domainId}_challenger_finding_001`],
      decisionEventIds: [`evt_phase5_${domainId}_decision_001`],
      timestamp: timeFor(domainId, 12),
      correlationId: `corr_phase5_${domainId}_ledger_001`,
    },
    { initialState: chairAccepted.state, artifactStore, replayHook },
  );
  stage(
    stages,
    'decision-ledger-action-hypothesis',
    JSON.stringify(JSON.parse(chairBytes.toString('utf8'))) === JSON.stringify(ledger) &&
      ledgerResult.events.map(({ type }) => type).join(',') ===
        'decision-ledger.materialized,claim.recorded,risk.recorded,finding.recorded,decision.revised' &&
      ledgerResult.decisions.length === 1 &&
      ledgerResult.actionHypotheses.length === 1,
    {
      ledgerId: ledger.ledgerId,
      decisionId: ledgerResult.decisions[0].decisionId,
      chairArtifactRawHash: chairProof.artifact.rawHash,
      actionHypothesisCount: ledgerResult.actionHypotheses.length,
    },
  );

  const actions = materializeOperatingActionVerificationV2(
    {
      cycleId,
      snapshotId: initialSnapshot.snapshot.snapshotId,
      stateId: initialSnapshot.operatingState.stateId,
      ledgerId: ledger.ledgerId,
    },
    {
      eventIds: [`evt_phase5_${domainId}_verification_plan_001`],
      timestamp: timeFor(domainId, 13),
      correlationId: `corr_phase5_${domainId}_verification_plan_001`,
    },
    { initialState: ledgerResult.state, artifactStore, replayHook },
  );
  const [action] = actions.actions;
  const [verificationPlan] = actions.verificationPlans;
  stage(
    stages,
    'durable-action-verification-plan',
    actions.events.map(({ type }) => type).join(',') === 'verification.plan-recorded' &&
      actions.state.actions.some(({ actionId }) => actionId === action.actionId) &&
      actions.state.verificationPlans.some(
        ({ verificationPlanId }) => verificationPlanId === verificationPlan.verificationPlanId,
      ) &&
      !Object.hasOwn(action, 'assignmentId') &&
      verificationPlan.observationRequest.kind === 'future-observation',
    {
      actionId: action.actionId,
      verificationPlanId: verificationPlan.verificationPlanId,
    },
  );

  if (stopAfterAction) {
    return {
      domainId,
      cycleId,
      scopeId,
      stageOrder: STAGE_NAMES.slice(0, 10),
      stages,
      finalEventSequence: actions.state.eventHead.sequence,
      finalEventHash: actions.state.eventHead.hash,
      modelDispatchCount: replayHook.dispatchCount,
      ...(includeContext
        ? {
            context: {
              state: actions.state,
              artifactStore,
              replayHook,
              domain,
              action,
              verificationPlan,
              verificationPlanEvent: actions.events[0],
              decision: ledgerResult.decisions[0],
              snapshot: initialSnapshot.snapshot,
              operatingState: initialSnapshot.operatingState,
              sourceArtifact: source.artifact,
              sourceArtifactId,
              chairArtifact: chairProof.artifact,
              chairArtifactId,
              challengerArtifact: challengerProof.artifact,
              challengerArtifactId,
              objective,
              metric,
              finding,
              materializedFindings: ledgerResult.findings,
              risk,
              assumption,
              evidenceRefId,
            },
          }
        : {}),
    };
  }

  const metricSelection = selectOperatingMetricProviderV2(OPEN_REFERENCE_OPERATE_EXTENSIONS_V2, {
    providerId: 'open-reference-metric-provider',
    providerVersion: '1.0.0',
    domainContract: domain.domainContract,
  });
  const observation = {
    ...clone(valid['operating-metric-observation']),
    observationId: `mob_phase5_${domainId}_001`,
    metricId: metric.metricId,
    scopeId,
    domainId,
    domainVersion: '1.0.0',
    value: 0.85,
    unit: metric.unit,
    observedAt: timeFor(domainId, 14),
    snapshotId: initialSnapshot.snapshot.snapshotId,
    evidenceRefIds: [evidenceRefId],
    sourceArtifactId,
  };
  const metricCandidate = createOperatingMetricObservationCandidateV2({
    providerId: metricSelection.provider.providerId,
    providerVersion: metricSelection.provider.providerVersion,
    metric,
    observation,
    snapshot: initialSnapshot.snapshot,
    acceptedArtifacts: [source.artifact],
  });
  stage(
    stages,
    'metric-provider-candidate-produced',
    metricCandidate.status === 'candidate' &&
      metricCandidate.candidate.observationId === observation.observationId &&
      metricCandidate.candidate.sourceArtifactId === sourceArtifactId,
    {
      providerId: metricSelection.provider.providerId,
      observationId: metricCandidate.candidate.observationId,
      sourceArtifactId: metricCandidate.candidate.sourceArtifactId,
    },
  );
  const observed = recordOperatingIntelligenceStateV2(
    {
      cycleId,
      snapshotId: initialSnapshot.snapshot.snapshotId,
      stateId: initialSnapshot.operatingState.stateId,
      claims: [],
      metricObservations: [metricCandidate.candidate],
      risks: [],
      assumptions: [],
      decisionRevisions: [],
    },
    {
      timestamp: timeFor(domainId, 14),
      correlationId: `corr_phase5_${domainId}_observation_001`,
      eventIds: {
        claims: [],
        metricObservations: [`evt_phase5_${domainId}_observation_001`],
        risks: [],
        assumptions: [],
        decisionRevisions: [],
      },
    },
    { initialState: actions.state, replayHook },
  );
  stage(
    stages,
    'metric-observation-accepted',
    observed.events.map(({ type }) => type).join(',') === 'metric.observed' &&
      observed.state.metricObservations.some(
        ({ observationId }) => observationId === observation.observationId,
      ),
    {
      observationId: observation.observationId,
      eventId: observed.events[0].eventId,
      providerId: metricSelection.provider.providerId,
    },
  );

  const actionSourceDecision = observed.state.decisions.find(
    ({ decisionId }) => decisionId === action.sourceDecisionId,
  );
  assert.ok(actionSourceDecision, 'Action source Decision remains durable for outcome learning');
  const outcomeResult = recordOperatingActionVerificationOutcomeV2(
    {
      cycleId,
      snapshotId: initialSnapshot.snapshot.snapshotId,
      stateId: initialSnapshot.operatingState.stateId,
      actionId: action.actionId,
      verificationPlanId: verificationPlan.verificationPlanId,
      observationId: observation.observationId,
      learning: {
        statement: `The accepted ${domainId} observation reached the declared target.`,
        assumptionIds: [...actionSourceDecision.assumptionIds],
        decisionIds: [action.sourceDecisionId],
      },
    },
    {
      timestamp: timeFor(domainId, 15),
      correlationId: `corr_phase5_${domainId}_outcome_001`,
      eventIds: {
        outcome: `evt_phase5_${domainId}_outcome_001`,
        learning: `evt_phase5_${domainId}_learning_001`,
      },
    },
    { initialState: observed.state, replayHook },
  );
  stage(
    stages,
    'outcome-learning-atomic',
    outcomeResult.events.map(({ type }) => type).join(',') ===
      'outcome.recorded,learning.recorded' &&
      outcomeResult.outcome.status === 'succeeded' &&
      outcomeResult.state.outcomes.some(
        ({ outcomeId }) => outcomeId === outcomeResult.outcome.outcomeId,
      ) &&
      outcomeResult.state.learnings.some(
        ({ learningId }) => learningId === outcomeResult.learning.learningId,
      ),
    {
      outcomeId: outcomeResult.outcome.outcomeId,
      learningId: outcomeResult.learning.learningId,
      eventIds: outcomeResult.events.map(({ eventId }) => eventId),
    },
  );

  const verificationSelection = selectOperatingVerificationProviderV2(
    OPEN_REFERENCE_OPERATE_EXTENSIONS_V2,
    {
      providerId: 'open-reference-verification-provider',
      providerVersion: '1.0.0',
      domainContract: domain.domainContract,
    },
  );
  const verificationCandidate = createOperatingVerificationCandidateV2({
    providerId: verificationSelection.provider.providerId,
    providerVersion: verificationSelection.provider.providerVersion,
    verificationPlan,
    outcome: outcomeResult.outcome,
    acceptedArtifacts: [source.artifact, chairProof.artifact],
  });
  stage(
    stages,
    'verification-provider-candidate-produced',
    verificationCandidate.status === 'candidate' &&
      verificationCandidate.candidate.outcomeId === outcomeResult.outcome.outcomeId &&
      verificationCandidate.candidate.sourceArtifactId === outcomeResult.outcome.sourceArtifactId,
    {
      providerId: verificationSelection.provider.providerId,
      outcomeId: outcomeResult.outcome.outcomeId,
      sourceArtifactId: verificationCandidate.candidate.sourceArtifactId,
    },
  );

  const laterMetric = {
    ...metric,
    observationIds: [observation.observationId],
    updatedAt: timeFor(domainId, 17),
  };
  const laterSnapshot = materializeOperatingStateSnapshotV2(
    {
      cycleId,
      scope: { scopeId, domainId, domainVersion: '1.0.0' },
      domainContract: domain.domainContract,
      sourceArtifactIds: [sourceArtifactId, challengerArtifactId, chairArtifactId],
      evidenceRefIds: [evidenceRefId],
      sourceRevisions: [
        { sourceArtifactId, revision: 'r2', evidenceRefIds: [evidenceRefId] },
        {
          sourceArtifactId: challengerArtifactId,
          revision: challengerProof.artifact.rawHash,
          evidenceRefIds: [],
        },
        {
          sourceArtifactId: chairArtifactId,
          revision: chairProof.artifact.rawHash,
          evidenceRefIds: [],
        },
      ],
      collections: {
        objectives: [objective],
        metrics: [laterMetric],
        findings: [finding, ...ledgerResult.findings],
        decisions: [actionSourceDecision],
        actions: [action],
        risks: [risk],
        assumptions: [assumption],
      },
    },
    {
      snapshotId: `snp_phase5_${domainId}_002`,
      stateId: `oms_phase5_${domainId}_002`,
      timestamp: timeFor(domainId, 17),
      correlationId: `corr_phase5_${domainId}_snapshot_002`,
      eventIds: {
        snapshot: `evt_phase5_${domainId}_snapshot_002`,
        state: `evt_phase5_${domainId}_state_002`,
      },
    },
    { initialState: outcomeResult.state, artifactStore, replayHook },
  );
  const laterDelta = deriveOperatingRuntimeDeltaV2(
    {
      cycleId,
      snapshotId: laterSnapshot.snapshot.snapshotId,
      stateId: laterSnapshot.operatingState.stateId,
    },
    {
      deltaId: `dlt_phase5_${domainId}_002`,
      eventId: `evt_phase5_${domainId}_delta_002`,
      timestamp: timeFor(domainId, 18),
      correlationId: `corr_phase5_${domainId}_delta_002`,
    },
    { initialState: laterSnapshot.state, replayHook },
  );
  stage(
    stages,
    'later-snapshot-delta-revisit',
    laterSnapshot.snapshot.previousSnapshotId === initialSnapshot.snapshot.snapshotId &&
      laterDelta.delta.priorSnapshotId === initialSnapshot.snapshot.snapshotId &&
      laterDelta.delta.currentSnapshotId === laterSnapshot.snapshot.snapshotId &&
      laterDelta.delta.metricChanges.some(({ subjectId }) => subjectId === metric.metricId) &&
      laterDelta.delta.decisionRevisitIds.includes(ledgerResult.decisions[0].decisionId),
    {
      snapshotId: laterSnapshot.snapshot.snapshotId,
      priorSnapshotId: laterSnapshot.snapshot.previousSnapshotId,
      deltaId: laterDelta.delta.deltaId,
      decisionRevisitIds: laterDelta.delta.decisionRevisitIds,
    },
  );

  pass(
    Object.keys(stages).join(',') === STAGE_NAMES.join(','),
    `${domainId}: every named stage completed in order`,
  );
  pass(replayHook.dispatchCount === 0, `${domainId}: the complete journey dispatches no model`);
  const serialized = JSON.stringify({ stages, state: laterDelta.state });
  pass(
    !/contentBase64|rawBytes|resolverPayload|credential|operationId|executionAssignmentIds|externalEffect/iu.test(
      serialized,
    ),
    `${domainId}: reportable state contains no raw evidence or execution surface`,
  );
  return Object.freeze({
    domainId,
    cycleId,
    scopeId,
    stageOrder: [...STAGE_NAMES],
    stages,
    finalEventSequence: laterDelta.state.eventHead.sequence,
    finalEventHash: laterDelta.state.eventHead.hash,
    modelDispatchCount: replayHook.dispatchCount,
    ...(includeContext
      ? {
          context: {
            state: laterDelta.state,
            artifactStore,
            replayHook,
            domain,
            action,
            verificationPlan,
            decision: ledgerResult.decisions[0],
            outcome: outcomeResult.outcome,
            learning: outcomeResult.learning,
            snapshot: laterSnapshot.snapshot,
            delta: laterDelta.delta,
            sourceArtifact: source.artifact,
            sourceArtifactId,
            chairArtifact: chairProof.artifact,
            chairArtifactId,
            objective,
            metric: laterMetric,
            finding,
            risk,
            assumption,
            evidenceRefId,
          },
        }
      : {}),
  });
}

export function verifyOperatingIntelligenceV2() {
  checks = 0;
  pass(
    new Set(OPERATE_RUNTIME_CONTRACT_KINDS).size === OPERATE_RUNTIME_CONTRACT_KINDS.length,
    'the public v2 catalog has unique registry-derived contracts',
  );
  for (const [kind, value] of Object.entries(
    fixture('operating-intelligence-contracts-valid.json'),
  ).filter(
    ([key]) =>
      ![
        'contractIds',
        'projectionIdentities',
        'apiDomainContracts',
        'providerRegistrationContractIds',
      ].includes(key),
  )) {
    if (value?.kind)
      pass(
        validateProtocolArtifact(kind, value, { protocolVersion: VERSION }).length === 0,
        `${kind}: valid fixture`,
      );
  }
  for (const value of Object.values(fixture('action-verification-valid.json'))) {
    pass(
      validateProtocolArtifact(value.kind, value, { protocolVersion: VERSION }).length === 0,
      `${value.kind}: verification fixture`,
    );
  }
  for (const value of Object.values(fixture('operating-trigger-scenario-valid.json'))) {
    pass(
      validateProtocolArtifact(value.kind, value, { protocolVersion: VERSION }).length === 0,
      `${value.kind}: trigger/scenario fixture`,
    );
  }
  pass(
    createEmptyOperatingRuntimeStateV2('2026-08-10T10:00:00.000Z').artifacts.length === 0,
    'a new runtime contains no ambient evidence or actor state',
  );
  pass(
    executionVerificationValid.hypothesisStatuses.includes('revisit') &&
      typeof deriveOperatingVerificationFeedbackV2 === 'function' &&
      executionVerificationValid.verificationOwnership.effectCompletionImpliesHypothesisSuccess ===
        false,
    'Outcome/Learning feedback remains observation-owned and can revisit later snapshots without execution inference',
  );

  const journeys = [
    runOperatingIntelligenceJourneyV2('business'),
    runOperatingIntelligenceJourneyV2('software'),
  ];
  return {
    ok: true,
    protocolVersion: VERSION,
    contracts: OPERATE_RUNTIME_CONTRACT_KINDS.length,
    domains: journeys.map(({ domainId }) => domainId),
    stageNames: [...STAGE_NAMES],
    journeys,
    checks,
    stop: 'No policy, capability grant, approval, executor, connector, operating provider/model dispatch, external effect, release, or remote action is part of this verification.',
  };
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.stdout.write(`${JSON.stringify(verifyOperatingIntelligenceV2())}\n`);
}
