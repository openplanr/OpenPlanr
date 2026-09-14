import { PipelineError } from '../protocol/errors.mjs';
import { assertProtocolArtifact, validateProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/canonical-json.mjs';
import {
  deriveOperatingRoleLocalPositionIdV2,
  deriveOperatingRoleLocalRecommendationIdV2,
} from './intelligence-output-identities-v2.mjs';

const PROTOCOL_VERSION = '2.0.0';
const MAX_OPERATING_ACTION_HYPOTHESES_PER_LEDGER_V2 = 512;

function fail(code, message, context = {}) {
  throw new PipelineError(code, message, '', {
    retryable: false,
    context: structuredClone(context),
  });
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

function sameScope(left, right) {
  return left?.scopeId === right?.scopeId
    && left?.domainId === right?.domainId
    && left?.domainVersion === right?.domainVersion;
}

function exactArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && sha256Jcs(left) === sha256Jcs(right);
}

function localIds(assignmentId, values, field, prefix, subject, { nullable = false } = {}) {
  if (nullable && values === null) return;
  if (!Array.isArray(values)) fail('RESULT_CONTRACT_INVALID', `${subject} must be an array.`);
  for (const [position, value] of values.entries()) {
    const expected = deriveOperatingRoleLocalPositionIdV2(prefix, assignmentId, position + 1);
    if (value?.[field] !== expected) {
      fail('STATE_TRANSITION_INVALID', `${subject} identities must be the exact ordered Assignment-derived sequence.`, {
        assignmentId,
        expected,
        actual: value?.[field] ?? null,
      });
    }
  }
}

function evidenceSet(assignment, advisorOutputs = [], challengerOutput = null) {
  const issued = assignment.intelligenceContext?.inputBundle?.issuedEvidence ?? [];
  const inherited = [
    ...advisorOutputs.flatMap(({ output }) => allCitedEvidenceIds(output)),
    ...(challengerOutput?.output ? allCitedEvidenceIds(challengerOutput.output) : []),
  ];
  return new Set([
    ...issued.map(({ evidenceRefId }) => evidenceRefId),
    ...inherited,
  ]);
}

function absenceSet(assignment) {
  return new Set((assignment.inputAbsences ?? []).map(({ absenceId }) => absenceId));
}

function assertEvidenceIds(ids, allowed, subject) {
  for (const evidenceRefId of ids) {
    if (!allowed.has(evidenceRefId)) {
      fail('STATE_TRANSITION_INVALID', `${subject} cites Evidence that was not issued to this Assignment.`, {
        evidenceRefId,
      });
    }
  }
}

function allCitedEvidenceIds(value) {
  const ids = [];
  const visit = (candidate, key = '') => {
    if (Array.isArray(candidate)) {
      // Evidence-absence provenance is exact runtime-issued gap metadata, not
      // citation authority. The role-specific gap validators below compare it
      // byte-for-byte with Assignment custody. Including it here would either
      // reject an honest Chair gap or let unavailable Evidence back claims.
      if (key === 'sourceEvidenceRefIds') return;
      if (key === 'evidenceRefIds' || key.endsWith('EvidenceRefIds')) ids.push(...candidate);
      else for (const entry of candidate) visit(entry, key);
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    for (const [field, nested] of Object.entries(candidate)) visit(nested, field);
  };
  visit(value);
  return ids;
}

function assertIdentityBinding(value, assignment, plan, snapshot) {
  if (value.assignmentId !== assignment.assignmentId
    || value.roleId !== assignment.roleId
    || value.roleVersion !== assignment.roleVersion
    || sha256Jcs(value.analysisProfile) !== sha256Jcs(assignment.analysisProfile)
    || value.intelligencePlanId !== plan.planId
    || value.snapshotId !== snapshot.snapshotId
    || !sameScope(value, snapshot)) {
    fail('OPERATING_SCOPE_INVALID', 'Intelligence result must retain its exact Assignment, role, profile, plan, snapshot, and scope.', {
      assignmentId: assignment.assignmentId,
    });
  }
  const expectedAbsences = (assignment.inputAbsences ?? []).map(({ absenceId }) => absenceId);
  // Advisor and Challenger carry a flat exact absence ledger. Chair carries
  // the same custody as the two typed `advisorAbsenceGaps`/`evidenceGaps`
  // collections, which `assertChair` compares losslessly below.
  if (assignment.assignmentKind !== 'chair'
    && !exactArray(value.inputAbsenceIds, expectedAbsences)) {
    fail('STATE_TRANSITION_INVALID', 'Intelligence result must account for the exact issued typed input absences.', {
      assignmentId: assignment.assignmentId,
    });
  }
}

function assertEvidenceRequirements(assignment) {
  const issued = assignment.intelligenceContext?.inputBundle?.issuedEvidence ?? [];
  const absences = assignment.inputAbsences.filter(({ kind }) => kind === 'evidence');
  for (const requirement of assignment.evidenceRequirements ?? []) {
    const matches = issued.filter((entry) => (
      entry.requirementId === requirement.requirementId
      && requirement.acceptedFreshness.includes(entry.freshness)
    ));
    const typedGap = absences.some(({ requirementId }) => requirementId === requirement.requirementId);
    if (matches.length < requirement.minimumEvidenceRefs && !typedGap) {
      fail('RESULT_CONTRACT_INVALID', 'An evidence requirement is neither satisfied nor represented by a typed absence.', {
        assignmentId: assignment.assignmentId,
        requirementId: requirement.requirementId,
      });
    }
  }
}

const TARGET_FIELDS = Object.freeze({
  analysis: Object.freeze({ advisor: ['analysis'] }),
  claims: Object.freeze({ advisor: ['claims'] }),
  measurements: Object.freeze({ advisor: ['measurements'] }),
  risks: Object.freeze({ advisor: ['risks'] }),
  alternatives: Object.freeze({ advisor: ['alternatives'], challenger: ['missingAlternatives'] }),
  gaps: Object.freeze({
    advisor: ['gaps'],
    challenger: ['gaps'],
    chair: ['advisorAbsenceGaps', 'evidenceGaps'],
  }),
  recommendation: Object.freeze({ advisor: ['recommendation'] }),
  findings: Object.freeze({ challenger: ['findings'] }),
  dissent: Object.freeze({ challenger: ['dissent'], chair: ['dissent'] }),
  decisions: Object.freeze({ chair: ['decisions'] }),
  'source-dispositions': Object.freeze({ chair: ['sourceDispositions'] }),
  'question-coverage': Object.freeze({ challenger: ['questionCoverage'], chair: ['questionCoverage'] }),
});

function resultRequirementCount(value, assignment, requirement) {
  const fields = TARGET_FIELDS[requirement.target]?.[assignment.assignmentKind];
  if (!fields) {
    fail('RESULT_CONTRACT_INVALID', 'Assignment result requirement does not map to its role output contract.', {
      assignmentId: assignment.assignmentId,
      requirementId: requirement.requirementId,
      roleKind: assignment.assignmentKind,
      target: requirement.target,
    });
  }
  return fields.reduce((count, field) => {
    const candidate = value[field];
    return count + (Array.isArray(candidate) ? candidate.length : candidate === null || candidate === undefined ? 0 : 1);
  }, 0);
}

function assertResultRequirements(value, assignment) {
  const outcome = value.outcome ?? 'recommendation';
  for (const requirement of assignment.resultRequirements ?? []) {
    if (!requirement.appliesToOutcomes.includes('always')
      && requirement.appliesToOutcomes.length > 0
      && !requirement.appliesToOutcomes.includes(outcome)) continue;
    const count = resultRequirementCount(value, assignment, requirement);
    if (count < requirement.minimumItems
      || (requirement.maximumItems !== null && count > requirement.maximumItems)) {
      fail('RESULT_CONTRACT_INVALID', 'Intelligence result does not satisfy its registry-owned result requirement.', {
        assignmentId: assignment.assignmentId,
        requirementId: requirement.requirementId,
        target: requirement.target,
        count,
      });
    }
  }
}

const PROFILE_INSIGHT_FIELDS = Object.freeze({
  'strategy-finance': ['directionChanges', 'capitalAllocations', 'financialScenarios', 'costOfDelay'],
  'technology-risk': ['objectiveConstraints', 'riskPortfolio', 'implicitArchitectureDecisions', 'riskiestChange'],
  'product-activation': ['activationGaps', 'unvalidatedBets', 'orderedCuts', 'acceptanceCriteriaFindings'],
  'growth-market': ['demandChanges', 'channelEconomics', 'positioningClaims', 'growthLoops'],
  'operations-customer': ['deliveryCapacity', 'customerHealth', 'singlePointsOfFailure', 'renegotiations'],
  'software-delivery': ['changeSurface', 'implementationRisks', 'implementationAlternatives', 'verificationGaps'],
});

function profileInsights(analysis, profileId) {
  return (PROFILE_INSIGHT_FIELDS[profileId] ?? []).flatMap((field) => {
    const value = analysis[field];
    if (value === null) return [];
    return Array.isArray(value) ? value : [value];
  });
}

function assertLocalReferenceArray(values, allowed, subject, field) {
  for (const id of values ?? []) {
    if (!allowed.has(id)) {
      fail('STATE_TRANSITION_INVALID', `${subject} references a foreign ${field}.`, { id });
    }
  }
}

const NUMERIC_RELATIVE_TOLERANCE = 0.01;

function approximately(actual, expected) {
  return Math.abs(actual - expected) <= Math.max(1e-6, Math.abs(expected) * NUMERIC_RELATIVE_TOLERANCE);
}

function measurementFailure(measurement, message, context = {}) {
  fail('RESULT_CONTRACT_INVALID', message, {
    localMeasurementId: measurement.localMeasurementId,
    kind: measurement.kind,
    ...context,
  });
}

function assertMeasurementCoherence(measurement) {
  if (measurement.kind === 'runway') {
    const expected = Math.max(0, measurement.cashBalance / measurement.netBurnPerPeriod);
    if (!approximately(measurement.runwayPeriods, expected)) {
      measurementFailure(measurement, 'Runway periods must equal cash balance divided by net burn.', { expected });
    }
    return;
  }
  if (measurement.kind === 'margin') {
    const expectedAmount = measurement.revenue - measurement.cost;
    const expectedRate = measurement.revenue === 0 ? 0 : expectedAmount / measurement.revenue;
    if (!approximately(measurement.marginAmount, expectedAmount)
      || !approximately(measurement.marginRate, expectedRate)) {
      measurementFailure(measurement, 'Margin amount and rate must agree with revenue and cost; zero revenue uses rate 0.', {
        expectedAmount,
        expectedRate,
      });
    }
    return;
  }
  if (measurement.kind === 'funnel') {
    for (const stage of measurement.stages) {
      const expected = stage.entered === 0 ? 0 : stage.advanced / stage.entered;
      if (stage.advanced > stage.entered || !approximately(stage.conversionRate, expected)) {
        measurementFailure(measurement, 'Funnel advanced volume cannot exceed entered volume and conversion must equal advanced divided by entered; zero entered uses rate 0.', {
          stage: stage.stage,
          expected,
        });
      }
    }
    return;
  }
  if (measurement.kind === 'channel-economics') {
    if (measurement.acquiredCustomers === 0) {
      if (measurement.customerAcquisitionCost !== null) {
        measurementFailure(measurement, 'Channel CAC must be null when no customers were acquired.');
      }
    } else {
      const expected = measurement.spend / measurement.acquiredCustomers;
      if (measurement.customerAcquisitionCost === null
        || !approximately(measurement.customerAcquisitionCost, expected)) {
        measurementFailure(measurement, 'Channel CAC must equal spend divided by acquired customers.', { expected });
      }
    }
    return;
  }
  if (measurement.kind === 'capacity') {
    const expected = measurement.available === 0 ? 0 : measurement.committed / measurement.available;
    if ((measurement.available === 0 && measurement.committed !== 0)
      || !approximately(measurement.utilizationRate, expected)) {
      measurementFailure(measurement, 'Capacity utilization must equal committed divided by available; zero available requires zero committed and utilization.', { expected });
    }
    return;
  }
  if (measurement.kind === 'throughput') {
    if ((measurement.leadTimeP50 === null) !== (measurement.leadTimeP95 === null)
      || (measurement.leadTimeP50 !== null && measurement.leadTimeP95 < measurement.leadTimeP50)) {
      measurementFailure(measurement, 'Throughput lead-time percentiles must be jointly absent or satisfy p95 >= p50.');
    }
    return;
  }
  if (measurement.kind === 'exposure') {
    const expected = measurement.likelihood * measurement.impactScore;
    if (!approximately(measurement.exposureScore, expected)) {
      measurementFailure(measurement, 'Exposure score must equal likelihood multiplied by impact score.', { expected });
    }
  }
}

function assertAdvisorAnalysis(value, assignment, {
  allowedEvidence,
  allowedAbsences,
  claimIds,
  measurementIds,
  riskIds,
  alternativeIds,
}) {
  if (value.analysis.profileId !== assignment.analysisProfile.id) {
    fail('STATE_TRANSITION_INVALID', 'Advisor analysis must use the exact registry-owned analysis profile.', {
      assignmentId: assignment.assignmentId,
      expectedProfileId: assignment.analysisProfile.id,
      actualProfileId: value.analysis.profileId,
    });
  }
  const insights = profileInsights(value.analysis, value.analysis.profileId);
  localIds(assignment.assignmentId, insights, 'localAnalysisId', 'analysis', 'Advisor analysis insights');
  const questionIds = new Set();
  for (const answer of value.analysis.executiveQuestionAnswers) {
    if (questionIds.has(answer.questionId)) {
      fail('STATE_TRANSITION_INVALID', 'Advisor executive question IDs must be unique.', {
        questionId: answer.questionId,
      });
    }
    questionIds.add(answer.questionId);
    if (answer.claimIds.length === 0
      && answer.measurementIds.length === 0
      && answer.riskIds.length === 0
      && answer.evidenceRefIds.length === 0
      && answer.absenceIds.length === 0) {
      fail('RESULT_CONTRACT_INVALID', 'Each required executive question answer must map to a claim, measurement, risk, issued EvidenceRef, or typed absence.', {
        questionId: answer.questionId,
      });
    }
  }
  if (Array.isArray(assignment.analysisProfile.questionIds)
    && !exactArray(
      value.analysis.executiveQuestionAnswers.map(({ questionId }) => questionId),
      assignment.analysisProfile.questionIds,
    )) {
    fail('STATE_TRANSITION_INVALID', 'Advisor executive question answers must cover the exact ordered registry-owned question identities.', {
      assignmentId: assignment.assignmentId,
    });
  }
  const linked = [
    ...value.analysis.executiveQuestionAnswers.map((entry) => ({ entry, subject: 'Advisor executive question answer' })),
    ...insights.map((entry) => ({ entry, subject: 'Advisor analysis insight' })),
  ];
  for (const { entry, subject } of linked) {
    assertLocalReferenceArray(entry.claimIds, claimIds, subject, 'claim');
    assertLocalReferenceArray(entry.measurementIds, measurementIds, subject, 'measurement');
    assertLocalReferenceArray(entry.riskIds, riskIds, subject, 'risk');
    assertLocalReferenceArray(entry.alternativeIds, alternativeIds, subject, 'alternative');
    assertLocalReferenceArray(entry.evidenceRefIds, allowedEvidence, subject, 'EvidenceRef');
    assertLocalReferenceArray(entry.absenceIds, allowedAbsences, subject, 'typed absence');
  }
  return new Set(insights.map(({ localAnalysisId }) => localAnalysisId));
}

function assertAdvisor(value, assignment, { allowedEvidence, knownAssumptions }) {
  localIds(assignment.assignmentId, value.claims, 'localClaimId', 'claim', 'Advisor claims');
  localIds(assignment.assignmentId, value.measurements, 'localMeasurementId', 'measurement', 'Advisor measurements');
  localIds(assignment.assignmentId, value.risks, 'localRiskId', 'risk', 'Advisor risks');
  localIds(assignment.assignmentId, value.alternatives, 'localAlternativeId', 'alternative', 'Advisor alternatives');
  localIds(assignment.assignmentId, value.gaps, 'localGapId', 'gap', 'Advisor gaps');
  if (value.recommendation !== null
    && value.recommendation.localRecommendationId !== deriveOperatingRoleLocalRecommendationIdV2(assignment.assignmentId)) {
    fail('STATE_TRANSITION_INVALID', 'Advisor recommendation identity must be derived from its Assignment.', {
      assignmentId: assignment.assignmentId,
    });
  }
  assertEvidenceIds(allCitedEvidenceIds(value), allowedEvidence, 'Advisor result');
  const claimIds = new Set(value.claims.map(({ localClaimId }) => localClaimId));
  const measurementIds = new Set(value.measurements.map(({ localMeasurementId }) => localMeasurementId));
  const riskIds = new Set(value.risks.map(({ localRiskId }) => localRiskId));
  const alternativeIds = new Set(value.alternatives.map(({ localAlternativeId }) => localAlternativeId));
  for (const measurement of value.measurements) assertMeasurementCoherence(measurement);
  assertAdvisorAnalysis(value, assignment, {
    allowedEvidence,
    allowedAbsences: absenceSet(assignment),
    claimIds,
    measurementIds,
    riskIds,
    alternativeIds,
  });
  for (const claim of value.claims) {
    if (claim.supportingEvidenceRefIds.some((id) => claim.contradictingEvidenceRefIds.includes(id))) {
      fail('STATE_TRANSITION_INVALID', 'Advisor claim support and contradiction Evidence must be disjoint.', {
        localClaimId: claim.localClaimId,
      });
    }
    for (const assumptionId of claim.assumptionIds) {
      if (!knownAssumptions.has(assumptionId)) {
        fail('STATE_TRANSITION_INVALID', 'Advisor claim references an Assumption outside the immutable operating state.', {
          localClaimId: claim.localClaimId,
          assumptionId,
        });
      }
    }
  }
  for (const risk of value.risks) {
    if (risk.claimIds.some((id) => !claimIds.has(id))) {
      fail('STATE_TRANSITION_INVALID', 'Advisor risk references a foreign claim.', { localRiskId: risk.localRiskId });
    }
  }
  for (const alternative of value.alternatives) {
    if (alternative.supportingClaimIds.some((id) => !claimIds.has(id))) {
      fail('STATE_TRANSITION_INVALID', 'Advisor alternative references a foreign claim.', {
        localAlternativeId: alternative.localAlternativeId,
      });
    }
  }
  for (const gap of value.gaps) {
    if (!absenceSet(assignment).has(gap.inputAbsenceId)
      || !(assignment.evidenceRequirements ?? []).some(({ requirementId }) => requirementId === gap.requirementId)) {
      fail('STATE_TRANSITION_INVALID', 'Advisor gap must name an issued absence and registry-owned evidence requirement.', {
        localGapId: gap.localGapId,
      });
    }
  }
  if (value.recommendation) {
    const recommendation = value.recommendation;
    if (recommendation.rationaleClaimIds.some((id) => !claimIds.has(id))
      || recommendation.alternativeIds.some((id) => !alternativeIds.has(id))
      || recommendation.riskIds.some((id) => !riskIds.has(id))
      || recommendation.successMeasurementIds.some((id) => !measurementIds.has(id))) {
      fail('STATE_TRANSITION_INVALID', 'Advisor recommendation contains a foreign claim, alternative, risk, or measurement reference.', {
        localRecommendationId: recommendation.localRecommendationId,
      });
    }
  }
  return freeze(clone(value));
}

function advisorSourceIndex(advisorOutputs) {
  const byArtifact = new Map();
  for (const entry of advisorOutputs) {
    if (!entry || typeof entry.artifactId !== 'string' || byArtifact.has(entry.artifactId)) {
      fail('STATE_TRANSITION_INVALID', 'Advisor result custody must contain unique exact Artifact identities.');
    }
    byArtifact.set(entry.artifactId, entry.output);
  }
  return byArtifact;
}

function assertAdvisorTarget(target, advisors, subject) {
  const output = advisors.get(target.advisorArtifactId);
  if (!output) fail('STATE_TRANSITION_INVALID', `${subject} names a foreign Advisor Artifact.`, target);
  const analysis = new Set(profileInsights(output.analysis, output.analysis.profileId).map(({ localAnalysisId }) => localAnalysisId));
  const claims = new Set(output.claims.map(({ localClaimId }) => localClaimId));
  const measurements = new Set(output.measurements.map(({ localMeasurementId }) => localMeasurementId));
  const risks = new Set(output.risks.map(({ localRiskId }) => localRiskId));
  const recommendations = new Set(output.recommendation ? [output.recommendation.localRecommendationId] : []);
  if ((target.analysisIds ?? []).some((id) => !analysis.has(id))
    || (target.claimIds ?? [target.localClaimId]).some((id) => !claims.has(id))
    || (target.measurementIds ?? []).some((id) => !measurements.has(id))
    || (target.riskIds ?? []).some((id) => !risks.has(id))
    || (target.recommendationIds ?? []).some((id) => !recommendations.has(id))) {
    fail('STATE_TRANSITION_INVALID', `${subject} names a foreign Advisor analysis, claim, measurement, risk, or recommendation.`, target);
  }
}

function assertExactQuestionCoverage(value, assignment, subject) {
  if (!exactArray(
    value.questionCoverage.map(({ questionId }) => questionId),
    assignment.analysisProfile.questionIds,
  )) {
    fail('STATE_TRANSITION_INVALID', `${subject} question coverage must preserve the exact ordered registry-owned question identities.`, {
      assignmentId: assignment.assignmentId,
    });
  }
}

function assertChallengerQuestionCoverage(value, assignment, {
  findingIds,
  alternativeIds,
  dissentIds,
  gapIds,
}) {
  assertExactQuestionCoverage(value, assignment, 'Challenger');
  for (const entry of value.questionCoverage) {
    assertLocalReferenceArray(entry.findingIds, findingIds, 'Challenger question coverage', 'Finding');
    assertLocalReferenceArray(entry.alternativeIds, alternativeIds, 'Challenger question coverage', 'alternative');
    assertLocalReferenceArray(entry.dissentIds, dissentIds, 'Challenger question coverage', 'dissent');
    assertLocalReferenceArray(entry.gapIds, gapIds, 'Challenger question coverage', 'gap');
  }
}

function assertChairQuestionCoverage(value, assignment, {
  decisionIds,
  findingIds,
  dissentIds,
  absenceIds,
}) {
  assertExactQuestionCoverage(value, assignment, 'Chair');
  for (const entry of value.questionCoverage) {
    assertLocalReferenceArray(entry.decisionIds, decisionIds, 'Chair question coverage', 'Decision');
    assertLocalReferenceArray(entry.findingIds, findingIds, 'Chair question coverage', 'Finding');
    assertLocalReferenceArray(entry.dissentIds, dissentIds, 'Chair question coverage', 'dissent');
    assertLocalReferenceArray(entry.absenceIds, absenceIds, 'Chair question coverage', 'typed absence');
  }
}

function assertChallenger(value, assignment, advisorOutputs, { allowedEvidence }) {
  const advisors = advisorSourceIndex(advisorOutputs);
  if (!exactArray(value.advisorArtifactIds, [...advisors.keys()])) {
    fail('STATE_TRANSITION_INVALID', 'Challenger must name the exact ordered validated Advisor Artifact custody.', {
      assignmentId: assignment.assignmentId,
    });
  }
  const expectedClaims = [...advisors.entries()].flatMap(([advisorArtifactId, output]) => (
    output.claims.map(({ localClaimId }) => ({ advisorArtifactId, localClaimId }))
  ));
  if (!exactArray(value.reviewedClaims, expectedClaims)) {
    fail('STATE_TRANSITION_INVALID', 'Challenger must account exactly once for every Advisor claim.', {
      assignmentId: assignment.assignmentId,
    });
  }
  localIds(assignment.assignmentId, value.findings, 'localFindingId', 'finding', 'Challenger findings');
  localIds(assignment.assignmentId, value.missingAlternatives, 'localAlternativeId', 'alternative', 'Challenger alternatives');
  localIds(assignment.assignmentId, value.dissent, 'localDissentId', 'dissent', 'Challenger dissent');
  localIds(assignment.assignmentId, value.gaps, 'localGapId', 'gap', 'Challenger gaps');
  assertEvidenceIds(allCitedEvidenceIds(value), allowedEvidence, 'Challenger review');
  const findingIds = new Set(value.findings.map(({ localFindingId }) => localFindingId));
  const alternativeIds = new Set(value.missingAlternatives.map(({ localAlternativeId }) => localAlternativeId));
  const dissentIds = new Set(value.dissent.map(({ localDissentId }) => localDissentId));
  const gapIds = new Set(value.gaps.map(({ localGapId }) => localGapId));
  assertChallengerQuestionCoverage(value, assignment, {
    findingIds,
    alternativeIds,
    dissentIds,
    gapIds,
  });
  for (const finding of value.findings) {
    for (const target of finding.targets) assertAdvisorTarget(target, advisors, 'Challenger Finding');
    if (finding.type === 'correlated-reasoning'
      && new Set(finding.targets.map(({ advisorArtifactId }) => advisorArtifactId)).size < 2) {
      fail('STATE_TRANSITION_INVALID', 'A correlated-reasoning Finding must span two distinct Advisor Artifacts.', {
        localFindingId: finding.localFindingId,
      });
    }
    if (finding.supportingEvidenceRefIds.some((id) => finding.contradictingEvidenceRefIds.includes(id))) {
      fail('STATE_TRANSITION_INVALID', 'Challenger Finding support and contradiction Evidence must be disjoint.', {
        localFindingId: finding.localFindingId,
      });
    }
  }
  for (const alternative of value.missingAlternatives) {
    for (const target of alternative.targets) assertAdvisorTarget(target, advisors, 'Challenger alternative');
  }
  for (const dissent of value.dissent) {
    if (dissent.findingIds.some((id) => !findingIds.has(id))) {
      fail('STATE_TRANSITION_INVALID', 'Challenger dissent references a foreign Finding.', {
        localDissentId: dissent.localDissentId,
      });
    }
  }
  for (const gap of value.gaps) {
    const absence = assignment.inputAbsences.find(({ absenceId }) => absenceId === gap.inputAbsenceId);
    const exactBinding = absence?.kind === gap.kind
      && (gap.kind === 'evidence'
        ? gap.requirementId === absence.requirementId
        : gap.roleId === absence.roleId
          && gap.roleKind === absence.roleKind
          && gap.roleVersion === absence.roleVersion
          && gap.sourceAssignmentId === absence.sourceAssignmentId);
    if (!exactBinding) {
      fail('STATE_TRANSITION_INVALID', 'Challenger gap references an absence that was not issued.', {
        localGapId: gap.localGapId,
      });
    }
  }
  return freeze(clone(value));
}

function assertChair(value, assignment, advisorOutputs, challengerOutput, {
  allowedEvidence,
  knownAssumptions,
  knownObjectiveIds,
  knownMetricIds,
  decisionOwnerActorId,
}) {
  const advisors = advisorSourceIndex(advisorOutputs);
  if (!exactArray(value.advisorArtifactIds, [...advisors.keys()])) {
    fail('STATE_TRANSITION_INVALID', 'Chair must name the exact ordered validated Advisor Artifact custody.');
  }
  if (value.challengerArtifactId !== (challengerOutput?.artifactId ?? null)) {
    fail('STATE_TRANSITION_INVALID', 'Chair must name the exact Challenger Artifact or explicit null absence.');
  }
  localIds(assignment.assignmentId, value.decisions, 'localDecisionId', 'decision', 'Chair decisions');
  const actionHypotheses = value.decisions.flatMap(({ actionHypotheses: entries }) => entries);
  if (actionHypotheses.length > MAX_OPERATING_ACTION_HYPOTHESES_PER_LEDGER_V2) {
    fail('RESULT_CONTRACT_INVALID', 'Chair Action hypotheses exceed the bounded owner Review capacity.', {
      assignmentId: assignment.assignmentId,
      actionCount: actionHypotheses.length,
      maximumActionCount: MAX_OPERATING_ACTION_HYPOTHESES_PER_LEDGER_V2,
    });
  }
  localIds(assignment.assignmentId, actionHypotheses, 'localActionHypothesisId', 'action-hypothesis', 'Chair action hypotheses');
  assertEvidenceIds(allCitedEvidenceIds(value), allowedEvidence, 'Chair ledger');

  const claims = new Map();
  const recommendations = new Map();
  const alternatives = new Map();
  for (const [artifactId, output] of advisors) {
    for (const claim of output.claims) claims.set(`${artifactId}:${claim.localClaimId}`, claim);
    if (output.recommendation) recommendations.set(`${artifactId}:${output.recommendation.localRecommendationId}`, output.recommendation);
    for (const alternative of output.alternatives) alternatives.set(`${artifactId}:${alternative.localAlternativeId}`, alternative);
  }
  const challengerArtifactId = challengerOutput?.artifactId ?? null;
  const findings = new Map((challengerOutput?.output.findings ?? []).map((finding) => [finding.localFindingId, finding]));
  const dissent = new Map((challengerOutput?.output.dissent ?? []).map((entry) => [entry.localDissentId, entry]));
  for (const alternative of challengerOutput?.output.missingAlternatives ?? []) {
    alternatives.set(`${challengerArtifactId}:${alternative.localAlternativeId}`, alternative);
  }
  const decisionIds = new Set(value.decisions.map(({ localDecisionId }) => localDecisionId));
  const actionIds = new Set(actionHypotheses.map(({ localActionHypothesisId }) => localActionHypothesisId));
  assertChairQuestionCoverage(value, assignment, {
    decisionIds,
    findingIds: new Set(findings.keys()),
    dissentIds: new Set(dissent.keys()),
    absenceIds: absenceSet(assignment),
  });
  for (const decision of value.decisions) {
    if (decision.ownerActorId !== decisionOwnerActorId) {
      fail('STATE_TRANSITION_INVALID', 'Chair Decision owner must equal the immutable plan owner.', {
        localDecisionId: decision.localDecisionId,
      });
    }
    const relevantEvidence = new Set();
    const decisionClaimRefs = new Set(decision.sourceClaimRefs.map((ref) => `${ref.advisorArtifactId}:${ref.localClaimId}`));
    const decisionFindingIds = new Set(decision.challengerFindingIds);
    if (decisionClaimRefs.size !== decision.sourceClaimRefs.length) {
      fail('STATE_TRANSITION_INVALID', 'Chair Decision source claim references must be unique.', {
        localDecisionId: decision.localDecisionId,
      });
    }
    for (const ref of decision.sourceClaimRefs) {
      const claim = claims.get(`${ref.advisorArtifactId}:${ref.localClaimId}`);
      if (!claim) fail('STATE_TRANSITION_INVALID', 'Chair Decision references a foreign Advisor claim.', ref);
      for (const id of [...claim.supportingEvidenceRefIds, ...claim.contradictingEvidenceRefIds]) relevantEvidence.add(id);
    }
    for (const ref of decision.sourceRecommendationRefs) {
      const recommendation = recommendations.get(`${ref.advisorArtifactId}:${ref.localRecommendationId}`);
      if (!recommendation) fail('STATE_TRANSITION_INVALID', 'Chair Decision references a foreign Advisor recommendation.', ref);
      for (const claimId of recommendation.rationaleClaimIds) {
        const claim = claims.get(`${ref.advisorArtifactId}:${claimId}`);
        for (const id of [...(claim?.supportingEvidenceRefIds ?? []), ...(claim?.contradictingEvidenceRefIds ?? [])]) relevantEvidence.add(id);
      }
    }
    for (const findingId of decision.challengerFindingIds) {
      const finding = findings.get(findingId);
      if (!finding) fail('STATE_TRANSITION_INVALID', 'Chair Decision references a foreign Challenger Finding.', { findingId });
      for (const id of [...finding.supportingEvidenceRefIds, ...finding.contradictingEvidenceRefIds]) relevantEvidence.add(id);
    }
    for (const dissentId of decision.dissentIds) {
      const item = dissent.get(dissentId);
      if (!item) fail('STATE_TRANSITION_INVALID', 'Chair Decision references foreign dissent.', { dissentId });
      for (const id of item.evidenceRefIds) relevantEvidence.add(id);
    }
    for (const alternative of decision.alternativeDispositions) {
      const source = alternatives.get(`${alternative.sourceArtifactId}:${alternative.localAlternativeId}`);
      if (!source || source.title !== alternative.title) {
        fail('STATE_TRANSITION_INVALID', 'Chair Decision references a foreign or substituted alternative.', alternative);
      }
      for (const id of source.evidenceRefIds) relevantEvidence.add(id);
    }
    if (new Set(decision.alternativeDispositions.map(({ sourceArtifactId, localAlternativeId }) => (
      `${sourceArtifactId}:${localAlternativeId}`
    ))).size !== decision.alternativeDispositions.length) {
      fail('STATE_TRANSITION_INVALID', 'Chair Decision alternative dispositions must identify unique relevant source alternatives.', {
        localDecisionId: decision.localDecisionId,
      });
    }
    if (decision.evidenceRefIds.some((id) => !relevantEvidence.has(id))) {
      fail('STATE_TRANSITION_INVALID', 'Chair Decision may cite only Evidence relevant to its exact source references.', {
        localDecisionId: decision.localDecisionId,
      });
    }
    if (decision.assumptionIds.some((id) => !knownAssumptions.has(id))) {
      fail('STATE_TRANSITION_INVALID', 'Chair Decision references an Assumption omitted from the issued bounded operating-state projection.', {
        localDecisionId: decision.localDecisionId,
      });
    }
    for (const action of decision.actionHypotheses) {
      const actionClaimRefs = action.sourceClaimRefs.map((ref) => `${ref.advisorArtifactId}:${ref.localClaimId}`);
      const hasOwner = typeof action.ownerActorId === 'string' && action.ownerActorId.length > 0;
      if (new Set(actionClaimRefs).size !== actionClaimRefs.length
        || actionClaimRefs.some((ref) => !decisionClaimRefs.has(ref))
        || action.sourceFindingIds.some((id) => !decisionFindingIds.has(id))
        || action.dependsOnActionHypothesisIds.some((id) => !actionIds.has(id) || id === action.localActionHypothesisId)) {
        fail('STATE_TRANSITION_INVALID', 'Chair Action hypothesis references a claim, Finding, or dependency outside its accepted Decision ledger custody.', {
          localActionHypothesisId: action.localActionHypothesisId,
        });
      }
      if (!knownObjectiveIds.has(action.objectiveId) || !knownMetricIds.has(action.metricId)) {
        fail('STATE_TRANSITION_INVALID', 'Chair Action hypothesis must reference an Objective and Metric issued in the bounded operating-state projection.', {
          localActionHypothesisId: action.localActionHypothesisId,
          objectiveId: action.objectiveId,
          metricId: action.metricId,
        });
      }
      if ((hasOwner && action.accountabilityDisposition !== null)
        || (!hasOwner && !['unowned', 'blocked'].includes(action.accountabilityDisposition))) {
        fail('STATE_TRANSITION_INVALID', 'Chair Action hypothesis requires one owner or an explicit unowned/blocking disposition.', {
          localActionHypothesisId: action.localActionHypothesisId,
        });
      }
    }
  }

  const expectedSources = [
    ...[...advisors.entries()].map(([artifactId, output]) => output.recommendation
      ? `${artifactId}:advisor-recommendation:${output.recommendation.localRecommendationId}`
      : `${artifactId}:advisor-outcome:outcome:${output.assignmentId}:1`),
    ...[...findings.keys()].map((id) => `${challengerArtifactId}:challenger-finding:${id}`),
    ...[...dissent.keys()].map((id) => `${challengerArtifactId}:challenger-dissent:${id}`),
  ];
  const actualSources = value.sourceDispositions.map(({ sourceArtifactId, sourceKind, localSourceId }) => (
    `${sourceArtifactId}:${sourceKind}:${localSourceId}`
  ));
  if (!exactArray(actualSources, expectedSources)) {
    fail('STATE_TRANSITION_INVALID', 'Chair sourceDispositions must account in canonical source order exactly once for every Advisor outcome/recommendation, Finding, and dissent item.');
  }
  for (const disposition of value.sourceDispositions) {
    if (disposition.sourceKind === 'advisor-outcome') {
      const source = advisors.get(disposition.sourceArtifactId);
      if (!source || source.recommendation !== null
        || disposition.localSourceId !== `outcome:${source.assignmentId}:1`
        || disposition.sourceOutcome !== source.outcome) {
        fail('STATE_TRANSITION_INVALID', 'Advisor outcome disposition must preserve the exact quiet or partial source outcome.', disposition);
      }
    }
    if (disposition.localDecisionId !== null && !decisionIds.has(disposition.localDecisionId)) {
      fail('STATE_TRANSITION_INVALID', 'Chair source disposition references a foreign Decision.', disposition);
    }
    if (disposition.localDecisionId !== null) {
      const decision = value.decisions.find(({ localDecisionId }) => localDecisionId === disposition.localDecisionId);
      const relevant = disposition.sourceKind === 'advisor-recommendation'
        ? decision.sourceRecommendationRefs.some((ref) => (
          ref.advisorArtifactId === disposition.sourceArtifactId
          && ref.localRecommendationId === disposition.localSourceId
        ))
        : disposition.sourceKind === 'challenger-finding'
          ? disposition.sourceArtifactId === challengerArtifactId
            && decision.challengerFindingIds.includes(disposition.localSourceId)
          : disposition.sourceKind === 'challenger-dissent'
            ? disposition.sourceArtifactId === challengerArtifactId
              && decision.dissentIds.includes(disposition.localSourceId)
            : false;
      if (!relevant) {
        fail('STATE_TRANSITION_INVALID', 'Chair source disposition may bind only to a Decision that cites the exact source item.', disposition);
      }
    }
  }
  const expectedDissent = [...dissent.values()].map((entry) => ({
    sourceArtifactId: challengerArtifactId,
    ...clone(entry),
  }));
  if (sha256Jcs(value.dissent) !== sha256Jcs(expectedDissent)) {
    fail('STATE_TRANSITION_INVALID', 'Chair ledger must preserve exact structured Challenger dissent.');
  }
  const roleAbsences = assignment.inputAbsences.filter(({ kind }) => kind === 'role');
  const evidenceAbsences = assignment.inputAbsences.filter(({ kind }) => kind === 'evidence');
  if (sha256Jcs(value.advisorAbsenceGaps) !== sha256Jcs(roleAbsences)
    || sha256Jcs(value.evidenceGaps) !== sha256Jcs(evidenceAbsences)) {
    fail('STATE_TRANSITION_INVALID', 'Chair ledger must preserve exact runtime-issued role and Evidence gaps.');
  }
  return freeze(clone(value));
}

/**
 * One shared semantic validator for Advisor, Challenger, and Chair results.
 * Schema validation proves the closed wire shape; this layer proves exact
 * runtime custody, issued Evidence, role-local identities, and cross-result
 * references without allowing a result to widen its own authority.
 */
export function validateOperatingIntelligenceResultV2({
  value,
  assignment,
  plan,
  snapshot,
  operatingState,
  inputBundle,
  advisorOutputs = [],
  challengerOutput = null,
} = {}) {
  const schemaId = assignment?.outputContract?.schemaId;
  if (!['operating-advisor-result', 'operating-challenger-review', 'operating-decision-ledger'].includes(schemaId)) {
    return freeze(clone(value));
  }
  try {
    assertProtocolArtifact(schemaId, value, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', 'Intelligence result does not satisfy its advertised closed result contract.', {
      assignmentId: assignment?.assignmentId ?? null,
      schemaId,
      cause: cause?.code ?? null,
      schemaMessage: cause?.message ?? null,
    });
  }
  if (!plan || !snapshot || !operatingState || !inputBundle
    || assignment.intelligenceContext?.intelligencePlanId !== plan.planId) {
    fail('STATE_TRANSITION_INVALID', 'Intelligence result validation requires its exact durable plan, snapshot, operating state, and issued input bundle.', {
      assignmentId: assignment?.assignmentId ?? null,
    });
  }
  try {
    assertProtocolArtifact('operating-intelligence-input-bundle', inputBundle, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', 'Intelligence result validation requires a contract-valid issued input bundle.', {
      assignmentId: assignment.assignmentId,
      cause: cause?.code ?? null,
    });
  }
  const roleBinding = inputBundle.assignmentBinding;
  const bundleAbsenceIds = new Set(roleBinding.evidenceAbsences.map(({ absenceId }) => absenceId));
  const assignmentBundleAbsences = assignment.inputAbsences.filter(({ absenceId }) => bundleAbsenceIds.has(absenceId));
  const issuedBaseArtifactIds = [
    assignment.intelligenceContext.inputBundle.bundleArtifactId,
    ...roleBinding.issuedEvidence.map(({ evidenceArtifactId }) => evidenceArtifactId),
  ].sort();
  if (inputBundle.bundleId !== assignment.intelligenceContext.inputBundle.bundleId
    || inputBundle.cycleId !== assignment.cycleId
    || inputBundle.snapshotId !== snapshot.snapshotId
    || !sameScope(inputBundle, snapshot)
    || sha256Jcs(inputBundle.snapshot) !== sha256Jcs(snapshot)
    || inputBundle.deltaId !== plan.deltaId
    || inputBundle.delta.currentSnapshotId !== snapshot.snapshotId
    || inputBundle.operatingState.sourceStateId !== operatingState.stateId
    || inputBundle.operatingState.sourceRuntimeHash !== operatingState.runtimeHash
    || inputBundle.createdAt !== assignment.createdAt
    || roleBinding.assignmentId !== assignment.assignmentId
    || roleBinding.roleId !== assignment.roleId
    || roleBinding.roleVersion !== assignment.roleVersion
    || roleBinding.roleKind !== assignment.assignmentKind
    || sha256Jcs(roleBinding.analysisProfile) !== sha256Jcs(assignment.analysisProfile)
    || sha256Jcs(roleBinding.evidenceRequirements) !== sha256Jcs(assignment.evidenceRequirements)
    || sha256Jcs(roleBinding.resultRequirements) !== sha256Jcs(assignment.resultRequirements)
    || issuedBaseArtifactIds.some((artifactId) => !assignment.inputArtifactIds.includes(artifactId))
    || assignment.intelligenceContext.inputBundle.sourceArtifactIds.some((artifactId, position) => (
      inputBundle.sourceArtifactIds[position] !== artifactId
    ))
    || sha256Jcs(roleBinding.issuedEvidence) !== sha256Jcs(assignment.intelligenceContext.inputBundle.issuedEvidence)
    || sha256Jcs(roleBinding.evidenceAbsences) !== sha256Jcs(assignmentBundleAbsences)) {
    fail('OPERATING_SCOPE_INVALID', 'Intelligence result input bundle must retain the exact Assignment role, requirements, Evidence, Snapshot, and scope binding.', {
      assignmentId: assignment.assignmentId,
      bundleId: inputBundle.bundleId,
    });
  }
  assertIdentityBinding(value, assignment, plan, snapshot);
  assertEvidenceRequirements(assignment);
  assertResultRequirements(value, assignment);
  const context = {
    // Challenger and Chair may preserve exact EvidenceRef provenance already
    // accepted in their validated predecessor results without receiving the
    // underlying Evidence Artifact bytes. This is inherited citation custody,
    // not widened raw-Evidence read authority.
    allowedEvidence: evidenceSet(assignment, advisorOutputs, challengerOutput),
    knownAssumptions: new Set(inputBundle.operatingState.assumptions.map(({ recordId }) => recordId)),
    knownObjectiveIds: new Set(inputBundle.operatingState.objectives.map(({ recordId }) => recordId)),
    knownMetricIds: new Set(inputBundle.operatingState.metrics.map(({ recordId }) => recordId)),
    decisionOwnerActorId: assignment.intelligenceContext.decisionOwnerActorId,
  };
  if (schemaId === 'operating-advisor-result') return assertAdvisor(value, assignment, context);
  if (schemaId === 'operating-challenger-review') return assertChallenger(value, assignment, advisorOutputs, context);
  return assertChair(value, assignment, advisorOutputs, challengerOutput, context);
}

function schemaMessagePointer(message) {
  if (typeof message !== 'string') return '/';
  const match = message.match(/(?:^|:\s)(\$(?:\.[A-Za-z0-9_-]+|\[[0-9]+\])*)/u);
  if (!match) return '/';
  return match[1]
    .slice(1)
    .replace(/\.([A-Za-z0-9_-]+)/gu, '/$1')
    .replace(/\[([0-9]+)\]/gu, '/$1') || '/';
}

function schemaPathPointer(path) {
  if (typeof path !== 'string' || !path.startsWith('$')) return '/';
  return path
    .slice(1)
    .replace(/\.([A-Za-z0-9_-]+)/gu, '/$1')
    .replace(/\[([0-9]+)\]/gu, '/$1') || '/';
}

/**
 * Pure, mutation-free executor preflight. It uses the exact same closed-schema
 * and semantic validator as submit, but returns bounded JSON-pointer issues so
 * prepared-packet tooling never needs to duplicate protocol logic.
 */
export function preflightOperatingIntelligenceResultV2(input = {}) {
  const schemaId = input.assignment?.outputContract?.schemaId;
  if (['operating-advisor-result', 'operating-challenger-review', 'operating-decision-ledger'].includes(schemaId)) {
    let schemaErrors;
    try {
      schemaErrors = validateProtocolArtifact(schemaId, input.value, { protocolVersion: PROTOCOL_VERSION });
    } catch (error) {
      schemaErrors = [{ path: '$', rule: 'schema-resolution', detail: error?.message ?? 'Schema validation failed.' }];
    }
    if (schemaErrors.length > 0) {
      return freeze({
        valid: false,
        value: null,
        issues: schemaErrors.slice(0, 64).map(({ path, rule, detail }) => ({
          code: 'RESULT_CONTRACT_INVALID',
          path: schemaPathPointer(path),
          message: detail,
          context: { rule },
        })),
      });
    }
  }
  try {
    const value = validateOperatingIntelligenceResultV2(input);
    return freeze({ valid: true, value, issues: [] });
  } catch (error) {
    const context = clone(error?.details?.context ?? {});
    return freeze({
      valid: false,
      value: null,
      issues: [{
        code: error?.code ?? 'RESULT_CONTRACT_INVALID',
        path: typeof context.path === 'string'
          ? context.path
          : schemaMessagePointer(context.schemaMessage),
        message: error?.message ?? 'Intelligence result validation failed.',
        context,
      }],
    });
  }
}
