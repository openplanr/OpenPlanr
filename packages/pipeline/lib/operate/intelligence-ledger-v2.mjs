import { PipelineError } from '../protocol/errors.mjs';
import { assertOperateIntelligencePlanContractV2, assertProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/canonical-json.mjs';
import { assertOperatingModelStateV2 } from './operating-state-v2.mjs';
import { assertOperatingSnapshotV2 } from './operating-snapshots-v2.mjs';
import {
  assertOperatingValidatedDependencyProofV2,
  deriveOperatingIntelligenceAssignmentIdV2,
  validateOperatingIntelligenceAssignmentGraphV2,
} from './scheduler-v2.mjs';
import { validateOperatingIntelligenceResultV2 } from './intelligence-result-validator-v2.mjs';
import {
  deriveOperatingMaterializedClaimIdV2,
  deriveOperatingMaterializedDecisionIdV2,
  deriveOperatingMaterializedFindingIdV2,
  deriveOperatingMaterializedRiskIdV2,
} from './intelligence-output-identities-v2.mjs';

const PROTOCOL_VERSION = '2.0.0';
const TERMINAL_ADVISOR_OUTCOMES = new Set(['abandoned', 'failed']);

function fail(code, message, context = {}) {
  throw new PipelineError(code, message, '', { retryable: false, context: structuredClone(context) });
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
  return left.scopeId === right.scopeId
    && left.domainId === right.domainId
    && left.domainVersion === right.domainVersion;
}

function canonicalJsonArtifactBody(artifact, rawBytes, subject) {
  try {
    assertProtocolArtifact('operating-artifact', artifact, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', `${subject} must have valid accepted Artifact metadata.`, {
      artifactId: artifact?.artifactId ?? null,
      cause: cause?.code ?? null,
    });
  }
  if (!(rawBytes instanceof Uint8Array)
    || artifact.mediaType !== 'application/json'
    || artifact.encoding !== 'utf-8'
    || artifact.canonicalHash === null) {
    fail('RESULT_CONTRACT_INVALID', `${subject} must be a canonical UTF-8 JSON Artifact.`, {
      artifactId: artifact.artifactId,
    });
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBytes));
  } catch {
    fail('RESULT_CONTRACT_INVALID', `${subject} bytes are not valid UTF-8 JSON.`, { artifactId: artifact.artifactId });
  }
  if (sha256Jcs(value) !== artifact.canonicalHash) {
    fail('ARTIFACT_HASH_MISMATCH', `${subject} JSON does not match the accepted Artifact canonical hash.`, {
      artifactId: artifact.artifactId,
    });
  }
  return freeze(clone(value));
}

/**
 * Decode a role result after the byte store has already proven its exact raw
 * hash. The returned data is deliberately short-lived: raw bytes never enter
 * a runtime Event, state projection, or error context.
 */
/** @internal Runtime-only after exact byte-store hash verification. */
export function decodeOperatingIntelligenceArtifactBodyV2({ artifact, rawBytes, subject = 'Intelligence result' } = {}) {
  return canonicalJsonArtifactBody(artifact, rawBytes, subject);
}

/**
 * Lossless, access-safe projection of one already byte-proven role output.
 * The shared validator remains the only semantic implementation; this seam
 * deliberately retains structured analysis instead of collapsing it into
 * legacy string bags.
 */
export function projectOperatingAcceptedIntelligenceOutputV2({
  roleKind,
  value,
  artifact,
  assignment,
  plan,
  snapshot,
  operatingState,
  inputBundle,
  priorAdvisorOutputs = [],
} = {}) {
  try {
    assertProtocolArtifact('operating-artifact', artifact, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', 'Accepted intelligence projection requires contract-valid public custody.', {
      cause: cause?.code ?? null,
    });
  }
  if (!assignment || assignment.assignmentKind !== roleKind
    || artifact.assignmentId !== assignment.assignmentId
    || artifact.producer?.roleId !== assignment.roleId
    || !sameScope(artifact, snapshot)) {
    fail('OPERATING_SCOPE_INVALID', 'Accepted intelligence projection requires one exact role, plan, snapshot, and scope binding.');
  }
  const advisorOutputs = priorAdvisorOutputs.map((entry) => ({
    artifactId: entry.artifact?.artifactId ?? entry.artifactId,
    output: entry.value ?? entry.output,
  }));
  const checked = validateOperatingIntelligenceResultV2({
    value,
    assignment,
    plan,
    snapshot,
    operatingState,
    inputBundle,
    advisorOutputs,
  });
  return freeze({
    roleKind,
    artifactId: artifact.artifactId,
    assignmentId: assignment.assignmentId,
    roleId: checked.roleId,
    roleVersion: checked.roleVersion,
    analysisProfile: clone(checked.analysisProfile),
    intelligencePlanId: checked.intelligencePlanId,
    snapshotId: checked.snapshotId,
    scopeId: checked.scopeId,
    domainId: checked.domainId,
    domainVersion: checked.domainVersion,
    outcome: checked.outcome ?? null,
    summary: checked.summary,
    analysisMarkdown: checked.analysisMarkdown,
    inputAbsenceIds: clone(checked.inputAbsenceIds),
    analysis: roleKind === 'advisor' ? clone(checked.analysis) : null,
    claims: roleKind === 'advisor' ? clone(checked.claims) : clone(checked.reviewedClaims),
    measurements: roleKind === 'advisor' ? clone(checked.measurements) : [],
    risks: roleKind === 'advisor' ? clone(checked.risks) : [],
    alternatives: roleKind === 'advisor' ? clone(checked.alternatives) : clone(checked.missingAlternatives),
    advisorArtifactIds: roleKind === 'challenger' ? clone(checked.advisorArtifactIds) : [],
    findings: roleKind === 'challenger' ? clone(checked.findings) : [],
    dissent: roleKind === 'challenger' ? clone(checked.dissent) : [],
    gaps: clone(checked.gaps),
    recommendation: roleKind === 'advisor' ? clone(checked.recommendation) : null,
  });
}

function indexArtifacts(records) {
  if (!Array.isArray(records)) fail('RESULT_CONTRACT_INVALID', 'Decision-ledger materialization requires an Artifact collection.');
  const result = new Map();
  for (const artifact of records) {
    try {
      assertProtocolArtifact('operating-artifact', artifact, { protocolVersion: PROTOCOL_VERSION });
    } catch (cause) {
      fail('RESULT_CONTRACT_INVALID', 'Decision-ledger materialization requires valid Artifact metadata.', { cause: cause?.code ?? null });
    }
    if (result.has(artifact.artifactId)) fail('STATE_TRANSITION_INVALID', 'Artifact identities must be unique.');
    result.set(artifact.artifactId, clone(artifact));
  }
  return result;
}

function indexEvidence(records, snapshot) {
  if (!Array.isArray(records)) fail('RESULT_CONTRACT_INVALID', 'Decision-ledger materialization requires EvidenceRefs.');
  const selected = new Set(snapshot.evidenceRefIds);
  const result = new Map();
  for (const evidenceRef of records) {
    if (!selected.has(evidenceRef?.evidenceRefId)) continue;
    try {
      assertProtocolArtifact('operating-evidence-ref', evidenceRef, { protocolVersion: PROTOCOL_VERSION });
    } catch (cause) {
      fail('RESULT_CONTRACT_INVALID', 'Decision-ledger materialization requires typed EvidenceRefs.', { cause: cause?.code ?? null });
    }
    if (!sameScope(evidenceRef, snapshot) || result.has(evidenceRef.evidenceRefId)) {
      fail('STATE_TRANSITION_INVALID', 'Decision-ledger Evidence must be unique and in-scope.', {
        evidenceRefId: evidenceRef.evidenceRefId,
      });
    }
    result.set(evidenceRef.evidenceRefId, clone(evidenceRef));
  }
  return result;
}

function exactArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && sha256Jcs(left) === sha256Jcs(right);
}

function assertRoleArtifact({ artifact, assignment, plan, snapshot, roleId }) {
  const selected = plan.selectedRoles.find((role) => role.roleId === roleId);
  if (!artifact || !assignment
    || artifact.assignmentId !== assignment.assignmentId
    || artifact.cycleId !== assignment.cycleId
    || !sameScope(artifact, snapshot)
    || assignment.cycleId === undefined
    || assignment.roleId !== roleId
    || !selected
    || assignment.assignmentKind !== selected.roleKind
    || assignment.state !== 'validated'
    || assignment.outputContract.schemaId !== artifact.schemaId
    || assignment.outputContract.schemaVersion !== artifact.artifactSchemaVersion
    || assignment.outputContract.mediaType !== artifact.mediaType
    || assignment.outputContract.encoding !== artifact.encoding
    || artifact.sizeBytes > assignment.outputContract.maxBytes
    || !exactArray(artifact.inputArtifactIds, assignment.inputArtifactIds)
    || artifact.producer.roleId !== assignment.roleId
    || artifact.producer.actorId !== assignment.claim?.actorId
    || artifact.producer.runtime !== assignment.claim?.runtime) {
    fail('STATE_TRANSITION_INVALID', 'A role result must remain bound to its validated Assignment, role, output contract, input ceiling, and producer provenance.', {
      roleId,
      artifactId: artifact?.artifactId ?? null,
      assignmentId: assignment?.assignmentId ?? null,
    });
  }
  if (assignment.assignmentId !== deriveOperatingIntelligenceAssignmentIdV2(plan.planId, roleId, selected.roleVersion)
    || assignment.roleVersion !== selected.roleVersion
    || !selected.inputArtifactIds.every((artifactId) => assignment.inputArtifactIds.includes(artifactId))
    || (selected.dependsOnRoleIds.length === 0
      && !exactArray(assignment.inputArtifactIds, selected.inputArtifactIds))
    || assignment.outputContract.schemaId !== selected.outputContract.schemaId
    || assignment.outputContract.schemaVersion !== selected.outputContract.schemaVersion) {
    fail('STATE_TRANSITION_INVALID', 'A role result is not bound to the exact immutable intelligence-plan role.', {
      roleId,
      planId: plan.planId,
    });
  }
}

function assertAcceptedRoleArtifact({ artifact, assignment, submissions, replayBySubmission, plan, snapshot, roleId }) {
  assertRoleArtifact({ artifact, assignment, plan, snapshot, roleId });
  const submission = submissions.find((candidate) => (
    candidate?.assignmentId === assignment.assignmentId
    && candidate.artifactId === artifact.artifactId
    && candidate.state === 'accepted'
  ));
  const replay = replayBySubmission.get(submission?.submissionId);
  try {
    assertOperatingValidatedDependencyProofV2({ assignment, submission, artifact, replay });
  } catch (cause) {
    fail('STATE_TRANSITION_INVALID', 'A role result requires one exact accepted Submission and durable replay proof.', {
      roleId,
      artifactId: artifact.artifactId,
      cause: cause?.code ?? null,
    });
  }
}

function currentDecisionForQuestion(existingDecisions, decision, snapshot) {
  const records = existingDecisions.filter((record) => (
    record?.kind === 'operating-decision'
    && sameScope(record, snapshot)
    && record.question === decision.question
  ));
  const predecessorIds = new Set(records.map(({ predecessorDecisionId }) => predecessorDecisionId).filter(Boolean));
  const current = records.filter(({ decisionId }) => !predecessorIds.has(decisionId));
  if (current.length > 1) {
    fail('STATE_TRANSITION_INVALID', 'Decision ledger cannot revise an ambiguous current Decision lineage.', {
      question: decision.question,
    });
  }
  return current[0] ?? null;
}

const IMPACT_SCORE = Object.freeze({ low: 0.25, medium: 0.5, high: 0.75, critical: 1 });

function assertDerivedRecords(schemaId, records, subject) {
  for (const record of records) {
    try {
      assertProtocolArtifact(schemaId, record, { protocolVersion: PROTOCOL_VERSION });
    } catch (cause) {
      fail('RESULT_CONTRACT_INVALID', `Runtime-derived ${subject} is not contract-valid.`, {
        sourceArtifactId: record.sourceArtifactId,
        cause: cause?.code ?? null,
        causeMessage: cause?.message ?? null,
      });
    }
  }
}

/**
 * Validate a complete challenged Chair result and derive append-only Decision
 * revisions. This is data-only: no model, provider, tool, approval, Action,
 * assignment, or external effect is invoked or created here.
 */
/** @internal The public runtime never accepts caller-parsed role or ledger output. */
export function buildOperatingDecisionLedgerMaterializationV2({
  snapshot,
  operatingState,
  inputBundles,
  plan,
  assignments,
  artifacts,
  submissions = [],
  submissionReplayIndex = [],
  evidenceRefs,
  advisorResults,
  challengerReview,
  chairArtifact,
  ledger,
  existingClaims = [],
  existingRisks = [],
  existingFindings = [],
  existingDecisions = [],
  timestamp,
} = {}) {
  let checkedSnapshot;
  let checkedState;
  let checkedPlan;
  try {
    checkedState = assertOperatingModelStateV2(operatingState);
    checkedSnapshot = assertOperatingSnapshotV2(snapshot, { state: checkedState });
    checkedPlan = assertOperateIntelligencePlanContractV2(plan);
    assertProtocolArtifact('operating-decision-ledger', ledger, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', 'Decision-ledger materialization requires contract-valid snapshot, state, plan, assignments, and ledger.', {
      cause: cause?.code ?? null,
      causeMessage: cause?.message ?? null,
    });
  }
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))
    || checkedPlan.snapshotId !== checkedSnapshot.snapshotId
    || !sameScope(checkedPlan, checkedSnapshot)
    || ledger.snapshotId !== checkedSnapshot.snapshotId
    || ledger.intelligencePlanId !== checkedPlan.planId
    || !sameScope(ledger, checkedSnapshot)) {
    fail('OPERATING_SCOPE_INVALID', 'Decision ledger, intelligence plan, immutable snapshot, and Event timestamp must share one exact binding.', {
      planId: checkedPlan.planId,
      snapshotId: checkedSnapshot.snapshotId,
    });
  }
  if (![existingClaims, existingRisks, existingFindings, existingDecisions].every(Array.isArray)) {
    fail('RESULT_CONTRACT_INVALID', 'Durable intelligence histories must be arrays.');
  }
  if (!Array.isArray(assignments)) fail('RESULT_CONTRACT_INVALID', 'Decision-ledger materialization requires an Assignment collection.');
  if (!Array.isArray(inputBundles)) fail('RESULT_CONTRACT_INVALID', 'Decision-ledger materialization requires role-scoped input bundles.');
  const selectedAssignmentIds = new Set(checkedPlan.selectedRoles.map(({ roleId, roleVersion }) => (
    deriveOperatingIntelligenceAssignmentIdV2(checkedPlan.planId, roleId, roleVersion)
  )));
  const selectedAssignmentsById = new Map();
  for (const assignment of assignments) {
    if (!selectedAssignmentIds.has(assignment?.assignmentId)) continue;
    if (selectedAssignmentsById.has(assignment.assignmentId)) {
      fail('STATE_TRANSITION_INVALID', 'Intelligence-plan Assignment identities must be unique.', {
        assignmentId: assignment.assignmentId,
      });
    }
    selectedAssignmentsById.set(assignment.assignmentId, assignment);
  }
  const planAssignments = checkedPlan.selectedRoles.map(({ roleId, roleVersion }) => (
    selectedAssignmentsById.get(deriveOperatingIntelligenceAssignmentIdV2(checkedPlan.planId, roleId, roleVersion))
  ));
  if (planAssignments.some((assignment) => !assignment)) {
    fail('STATE_TRANSITION_INVALID', 'Decision-ledger materialization requires every selected Assignment in exact plan order.', {
      planId: checkedPlan.planId,
    });
  }
  try {
    validateOperatingIntelligenceAssignmentGraphV2(checkedPlan, planAssignments, { allowLifecycleProgress: true });
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', 'Decision-ledger materialization requires the exact recorded intelligence-plan Assignments.', {
      cause: cause?.code ?? null,
      causeMessage: cause?.message ?? null,
    });
  }
  const artifactIndex = indexArtifacts(artifacts);
  if (!Array.isArray(submissions) || !Array.isArray(submissionReplayIndex)) {
    fail('RESULT_CONTRACT_INVALID', 'Decision-ledger materialization requires Submission and replay-proof collections.');
  }
  const replayBySubmission = new Map();
  for (const replay of submissionReplayIndex) {
    if (!replay || typeof replay.submissionId !== 'string' || replayBySubmission.has(replay.submissionId)) {
      fail('STATE_TRANSITION_INVALID', 'Decision-ledger Submission replay identities must be unique.');
    }
    replayBySubmission.set(replay.submissionId, clone(replay));
  }
  const evidence = indexEvidence(evidenceRefs, checkedSnapshot);
  const assignmentsByRole = new Map(planAssignments.map((assignment) => [assignment.roleId, assignment]));
  const bundlesByAssignment = new Map();
  for (const entry of inputBundles) {
    if (!entry || typeof entry.assignmentId !== 'string' || bundlesByAssignment.has(entry.assignmentId)) {
      fail('STATE_TRANSITION_INVALID', 'Decision-ledger input-bundle custody must contain unique Assignment identities.');
    }
    bundlesByAssignment.set(entry.assignmentId, entry.bundle);
  }
  if (planAssignments.some(({ assignmentId }) => !bundlesByAssignment.has(assignmentId))) {
    fail('STATE_TRANSITION_INVALID', 'Every intelligence-plan Assignment requires its exact role-scoped input bundle.');
  }
  const advisorAssignments = planAssignments.filter(({ assignmentKind }) => assignmentKind === 'advisor');
  const challengerAssignment = planAssignments.find(({ assignmentKind }) => assignmentKind === 'challenger');
  const chairAssignment = planAssignments.find(({ assignmentKind }) => assignmentKind === 'chair');
  const advisorResultEntries = Array.isArray(advisorResults) ? advisorResults : [];
  const normalizedAdvisorResults = [];
  const issuedAbsenceGaps = (chairAssignment?.inputAbsences ?? []).map(clone);
  for (const advisorAssignment of advisorAssignments) {
    if (advisorAssignment.state === 'validated') {
      const entry = advisorResultEntries.find(({ artifactId }) => (
        artifactIndex.get(artifactId)?.assignmentId === advisorAssignment.assignmentId
      ));
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        fail('STATE_TRANSITION_INVALID', 'Every validated advisor seat requires one validated Advisor result.', {
          planId: checkedPlan.planId,
          roleId: advisorAssignment.roleId,
        });
      }
      const artifact = artifactIndex.get(entry.artifactId);
      assertAcceptedRoleArtifact({
        artifact, assignment: advisorAssignment, submissions, replayBySubmission,
        plan: checkedPlan, snapshot: checkedSnapshot, roleId: advisorAssignment.roleId,
      });
      normalizedAdvisorResults.push({
        artifactId: artifact.artifactId,
        output: validateOperatingIntelligenceResultV2({
          value: entry.output,
          assignment: advisorAssignment,
          plan: checkedPlan,
          snapshot: checkedSnapshot,
          operatingState: checkedState,
          inputBundle: bundlesByAssignment.get(advisorAssignment.assignmentId),
        }),
      });
      continue;
    }
    if (TERMINAL_ADVISOR_OUTCOMES.has(advisorAssignment.state)) {
      if (!advisorAssignment.terminalOutcome
        || advisorAssignment.terminalOutcome.outcome !== advisorAssignment.state) {
        fail('STATE_TRANSITION_INVALID', 'An abandoned advisor seat requires an exact typed terminal absence proof.', {
          planId: checkedPlan.planId,
          roleId: advisorAssignment.roleId,
          assignmentId: advisorAssignment.assignmentId,
        });
      }
      const issuedGap = chairAssignment?.inputAbsences.find((gap) => (
        gap.roleId === advisorAssignment.roleId
        && gap.roleKind === advisorAssignment.assignmentKind
        && gap.sourceAssignmentId === advisorAssignment.assignmentId
        && gap.sourceEventId === advisorAssignment.terminalOutcome.eventId
        && gap.absenceCode === advisorAssignment.terminalOutcome.code
        && gap.reason === advisorAssignment.terminalOutcome.reason
        && gap.recoveryDisposition === advisorAssignment.terminalOutcome.recoveryDisposition
      ));
      if (!issuedGap) {
        fail('STATE_TRANSITION_INVALID', 'Chair Assignment is missing the exact typed advisor absence input.', {
          planId: checkedPlan.planId,
          roleId: advisorAssignment.roleId,
        });
      }
      continue;
    }
    fail('STATE_TRANSITION_INVALID', 'Every selected advisor seat must be terminal before Chair ledger materialization.', {
      planId: checkedPlan.planId,
      roleId: advisorAssignment.roleId,
      state: advisorAssignment.state,
    });
  }
  const normalizedAdvisorArtifactIds = normalizedAdvisorResults.map(({ artifactId }) => artifactId);
  if (!exactArray(ledger.advisorArtifactIds, normalizedAdvisorArtifactIds)) {
    fail('STATE_TRANSITION_INVALID', 'Chair ledger must name exactly its validated Advisor result Artifact.', {
      ledgerId: ledger.ledgerId,
    });
  }
  let normalizedChallengerReview = null;
  if (checkedPlan.challengerRequired) {
    if (!challengerReview || typeof challengerReview !== 'object' || Array.isArray(challengerReview)) {
      fail('STATE_TRANSITION_INVALID', 'A required Challenger review is missing before Chair ledger materialization.', {
        planId: checkedPlan.planId,
      });
    }
    const artifact = artifactIndex.get(challengerReview.artifactId);
    assertAcceptedRoleArtifact({
      artifact, assignment: challengerAssignment, submissions, replayBySubmission,
      plan: checkedPlan, snapshot: checkedSnapshot, roleId: challengerAssignment.roleId,
    });
    normalizedChallengerReview = {
      artifactId: artifact.artifactId,
      output: validateOperatingIntelligenceResultV2({
        value: challengerReview.output,
        assignment: challengerAssignment,
        plan: checkedPlan,
        snapshot: checkedSnapshot,
        operatingState: checkedState,
        inputBundle: bundlesByAssignment.get(challengerAssignment.assignmentId),
        advisorOutputs: normalizedAdvisorResults,
      }),
    };
    if (ledger.challengerArtifactId !== artifact.artifactId) {
      fail('STATE_TRANSITION_INVALID', 'Chair ledger must name the exact required Challenger review Artifact.', {
        ledgerId: ledger.ledgerId,
      });
    }
  } else if (challengerReview !== null && challengerReview !== undefined) {
    fail('STATE_TRANSITION_INVALID', 'A plan that omitted Challenger cannot inject an unplanned Challenger review.');
  } else if (ledger.challengerArtifactId !== null) {
    fail('STATE_TRANSITION_INVALID', 'Chair ledger must represent an explicitly omitted Challenger as null.');
  }
  const checkedChairArtifact = artifactIndex.get(chairArtifact?.artifactId);
  assertAcceptedRoleArtifact({
    artifact: checkedChairArtifact, assignment: chairAssignment, submissions, replayBySubmission,
    plan: checkedPlan, snapshot: checkedSnapshot, roleId: chairAssignment.roleId,
  });
  const validatedLedger = validateOperatingIntelligenceResultV2({
    value: ledger,
    assignment: chairAssignment,
    plan: checkedPlan,
    snapshot: checkedSnapshot,
    operatingState: checkedState,
    inputBundle: bundlesByAssignment.get(chairAssignment.assignmentId),
    advisorOutputs: normalizedAdvisorResults,
    challengerOutput: normalizedChallengerReview,
  });
  const chairInputBundle = bundlesByAssignment.get(chairAssignment.assignmentId);
  if (ledger.sourceArtifactId !== checkedPlan.sourceArtifactId
    || !chairInputBundle.sourceArtifactIds.includes(ledger.sourceArtifactId)) {
    fail('STATE_TRANSITION_INVALID', 'Chair ledger must retain the intelligence plan\'s exact bundle-proven source Artifact provenance.', {
      ledgerId: ledger.ledgerId,
      sourceArtifactId: ledger.sourceArtifactId,
    });
  }
  const priorDecisions = existingDecisions.filter((record) => record?.sourceArtifactId !== checkedChairArtifact.artifactId);
  if (new Set(validatedLedger.decisions.map(({ question }) => question)).size !== validatedLedger.decisions.length) {
    fail('STATE_TRANSITION_INVALID', 'One Chair ledger may not contain two revisions for the same Decision question.', {
      ledgerId: validatedLedger.ledgerId,
    });
  }

  const claims = normalizedAdvisorResults.flatMap(({ artifactId, output }) => output.claims.map((claim) => ({
    kind: 'operating-claim',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    claimId: deriveOperatingMaterializedClaimIdV2(artifactId, claim.localClaimId),
    scopeId: checkedSnapshot.scopeId,
    domainId: checkedSnapshot.domainId,
    domainVersion: checkedSnapshot.domainVersion,
    statement: claim.statement,
    epistemicStatus: claim.epistemicStatus,
    confidence: claim.confidence,
    supportingEvidenceRefIds: clone(claim.supportingEvidenceRefIds),
    contradictingEvidenceRefIds: clone(claim.contradictingEvidenceRefIds),
    assumptionIds: clone(claim.assumptionIds),
    changeCondition: claim.changeCondition,
    sourceArtifactId: artifactId,
    createdAt: timestamp,
  })));
  const risks = normalizedAdvisorResults.flatMap(({ artifactId, output }) => {
    const assignment = assignmentsByRole.get(artifactIndex.get(artifactId).producer.roleId);
    return output.risks.map((risk) => ({
      kind: 'operating-risk',
      schemaVersion: '1.0.0',
      protocolVersion: PROTOCOL_VERSION,
      origin: 'operating-intelligence',
      riskId: deriveOperatingMaterializedRiskIdV2(artifactId, risk.localRiskId),
      scopeId: checkedSnapshot.scopeId,
      domainId: checkedSnapshot.domainId,
      domainVersion: checkedSnapshot.domainVersion,
      sourceCycleId: artifactIndex.get(artifactId).cycleId,
      sourceAssignmentId: assignment.assignmentId,
      sourceLocalRiskId: risk.localRiskId,
      sourceClaimIds: clone(risk.claimIds),
      title: risk.title,
      statement: risk.statement,
      state: 'open',
      likelihood: risk.likelihood,
      impact: IMPACT_SCORE[risk.impact],
      sourceImpact: risk.impact,
      exposure: Number((risk.likelihood * IMPACT_SCORE[risk.impact]).toFixed(6)),
      exposureStatement: risk.exposure,
      exposedSurfaces: clone(risk.exposedSurfaces),
      ownerActorId: null,
      mitigation: risk.mitigation,
      mitigations: [risk.mitigation],
      reversibility: risk.reversibility,
      triggerIds: [],
      evidenceRefIds: clone(risk.evidenceRefIds),
      sourceArtifactId: artifactId,
      closedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      revisionId: deriveOperatingMaterializedRiskIdV2(artifactId, risk.localRiskId),
      revision: 1,
      predecessorRevisionId: null,
    }));
  });
  const findings = normalizedChallengerReview === null
    ? []
    : normalizedChallengerReview.output.findings.map((finding) => ({
        kind: 'operating-finding',
        schemaVersion: '1.0.0',
        protocolVersion: PROTOCOL_VERSION,
        origin: 'operating-intelligence',
        findingId: deriveOperatingMaterializedFindingIdV2(
          normalizedChallengerReview.artifactId,
          finding.localFindingId,
        ),
        scopeId: checkedSnapshot.scopeId,
        domainId: checkedSnapshot.domainId,
        domainVersion: checkedSnapshot.domainVersion,
        sourceCycleId: artifactIndex.get(normalizedChallengerReview.artifactId).cycleId,
        sourceArtifactId: normalizedChallengerReview.artifactId,
        sourceAssignmentId: challengerAssignment.assignmentId,
        sourceLocalFindingId: finding.localFindingId,
        findingType: finding.type,
        severity: finding.severity,
        confidence: finding.confidence,
        targets: clone(finding.targets),
        supportingEvidenceRefIds: clone(finding.supportingEvidenceRefIds),
        contradictingEvidenceRefIds: clone(finding.contradictingEvidenceRefIds),
        title: finding.title,
        statement: finding.statement,
        rationale: finding.rationale,
        correctionCondition: finding.correctionCondition,
        state: 'open',
        ownerActorId: null,
        revisitAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }));
  assertDerivedRecords('operating-claim', claims, 'Claim');
  assertDerivedRecords('operating-risk', risks, 'Risk');
  assertDerivedRecords('operating-finding', findings, 'Finding');

  const durableClaimIds = new Map(normalizedAdvisorResults.flatMap(({ artifactId, output }) => (
    output.claims.map(({ localClaimId }) => [
      `${artifactId}:${localClaimId}`,
      deriveOperatingMaterializedClaimIdV2(artifactId, localClaimId),
    ])
  )));
  const durableFindingIds = new Map((normalizedChallengerReview?.output.findings ?? []).map(({ localFindingId }) => [
    localFindingId,
    deriveOperatingMaterializedFindingIdV2(normalizedChallengerReview.artifactId, localFindingId),
  ]));
  const dissentById = new Map(validatedLedger.dissent.map((entry) => [entry.localDissentId, entry]));
  const decisions = validatedLedger.decisions.map((decision) => {
    if (decision.ownerActorId !== checkedPlan.decisionOwnerActorId) {
      fail('STATE_TRANSITION_INVALID', 'Chair Decision owner must equal the immutable intelligence-plan owner.', {
        ledgerId: validatedLedger.ledgerId,
        ownerActorId: decision.ownerActorId,
      });
    }
    const predecessor = currentDecisionForQuestion(priorDecisions, decision, checkedSnapshot);
    const revision = predecessor === null ? 1 : predecessor.revision + 1;
    const decisionId = deriveOperatingMaterializedDecisionIdV2(
      checkedChairArtifact.artifactId,
      decision.localDecisionId,
    );
    const record = {
      kind: 'operating-decision', schemaVersion: '1.0.0', protocolVersion: PROTOCOL_VERSION,
      origin: 'operating-intelligence',
      decisionId,
      scopeId: checkedSnapshot.scopeId, domainId: checkedSnapshot.domainId, domainVersion: checkedSnapshot.domainVersion,
      sourceCycleId: checkedChairArtifact.cycleId, sourceArtifactId: checkedChairArtifact.artifactId,
      sourceAssignmentId: chairAssignment.assignmentId, sourceLocalDecisionId: decision.localDecisionId,
      title: decision.title, question: decision.question, outcome: decision.outcome, rationale: decision.rationale,
      sourceClaimRefs: clone(decision.sourceClaimRefs),
      claimIds: decision.sourceClaimRefs.map((reference) => durableClaimIds.get(
        `${reference.advisorArtifactId}:${reference.localClaimId}`,
      )),
      sourceRecommendationRefs: clone(decision.sourceRecommendationRefs),
      challengerFindingIds: clone(decision.challengerFindingIds),
      findingIds: decision.challengerFindingIds.map((localFindingId) => durableFindingIds.get(localFindingId)),
      evidenceRefIds: clone(decision.evidenceRefIds),
      alternativeDispositions: clone(decision.alternativeDispositions),
      alternatives: decision.alternativeDispositions.map(({ title }) => title),
      confidence: decision.confidence, assumptionIds: clone(decision.assumptionIds),
      expectedUpside: decision.upside, expectedDownside: decision.downside,
      uncertainty: decision.uncertainty, reversibility: decision.reversibility,
      dissentIds: clone(decision.dissentIds),
      dissent: decision.dissentIds.map((localDissentId) => dissentById.get(localDissentId).statement),
      reopenConditions: clone(decision.revisitConditions),
      revisitConditions: clone(decision.revisitConditions), state: 'proposed', ownerActorId: decision.ownerActorId,
      revisitAt: null, revision, predecessorDecisionId: predecessor?.decisionId ?? null,
      historyDecisionIds: predecessor === null
        ? []
        : [...new Set([...predecessor.historyDecisionIds, predecessor.decisionId])],
      createdAt: timestamp, updatedAt: timestamp,
    };
    return record;
  });
  assertDerivedRecords('operating-decision', decisions, 'Decision');

  const histories = [
    [existingClaims, claims, 'claimId', 'Claim'],
    [existingRisks, risks, 'riskId', 'Risk'],
    [existingFindings, findings, 'findingId', 'Finding'],
    [existingDecisions, decisions, 'decisionId', 'Decision'],
  ];
  for (const [history, derived, idField, subject] of histories) {
    const byId = new Map();
    for (const record of history) {
      if (!record || typeof record[idField] !== 'string' || byId.has(record[idField])) {
        fail('STATE_TRANSITION_INVALID', `${subject} history identities must be explicit and unique.`);
      }
      byId.set(record[idField], record);
    }
    for (const record of derived) {
      const existing = byId.get(record[idField]);
      if (existing && sha256Jcs(existing) !== sha256Jcs(record)) {
        fail('CONCURRENT_MODIFICATION', `Runtime-derived ${subject} identity already carries different bytes.`, {
          [idField]: record[idField],
        });
      }
    }
  }

  const issuedRoleGaps = issuedAbsenceGaps.filter(({ kind }) => kind === 'role');
  const issuedEvidenceGaps = issuedAbsenceGaps.filter(({ kind }) => kind === 'evidence');
  if (sha256Jcs(validatedLedger.advisorAbsenceGaps) !== sha256Jcs(issuedRoleGaps)
    || sha256Jcs(validatedLedger.evidenceGaps) !== sha256Jcs(issuedEvidenceGaps)) {
    fail('STATE_TRANSITION_INVALID', 'Chair ledger advisor absence gaps must exactly equal its issued typed absence inputs.', {
      ledgerId: validatedLedger.ledgerId,
    });
  }
  const persistedLedger = freeze(clone(validatedLedger));
  return freeze({
    ledger: persistedLedger,
    chairArtifactId: checkedChairArtifact.artifactId,
    advisorArtifactIds: normalizedAdvisorArtifactIds,
    advisorAbsenceGaps: issuedRoleGaps,
    evidenceGaps: issuedEvidenceGaps,
    challengerArtifactId: normalizedChallengerReview?.artifactId ?? null,
    claims: claims.map(clone),
    risks: risks.map(clone),
    findings: findings.map(clone),
    decisions: decisions.map(clone),
    actionHypotheses: validatedLedger.decisions.flatMap(({ actionHypotheses }, decisionIndex) => (
      actionHypotheses.map((hypothesis, hypothesisIndex) => freeze({ decisionIndex, hypothesisIndex, ...clone(hypothesis) }))
    )),
  });
}
