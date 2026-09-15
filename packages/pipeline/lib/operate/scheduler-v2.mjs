import { sha256Jcs } from '../protocol/canonical-json.mjs';
import {
  assertOperateIntelligencePlanContractV2,
  assertProtocolArtifact,
} from '../protocol/contracts.mjs';
import { OPERATE_CONTRACT_CATALOG_V2 } from '../protocol/generated/contract-catalog-v2.mjs';
import {
  deriveOperatingEvidenceAbsenceIdV2,
  deriveOperatingRoleAbsenceIdV2,
} from './intelligence-input-bundle-v2.mjs';

const TERMINAL_OUTCOMES = new Set(['abandoned', 'failed']);
const COMPILED_DEPENDENCY_POLICIES = new Map(
  OPERATE_CONTRACT_CATALOG_V2.dependencyPolicies.map((policy) => [policy.kind, policy]),
);

export class OperatingSchedulerErrorV2 extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'OperatingSchedulerErrorV2';
    this.code = 'STATE_TRANSITION_INVALID';
    this.details = Object.freeze(structuredClone(details));
  }
}

function fail(message, details) {
  throw new OperatingSchedulerErrorV2(message, details);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function uniqueStrings(value) {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === 'string' && entry.length > 0)
    && new Set(value).size === value.length;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function contractRecord(kind, value, subject, details = {}) {
  try {
    return assertProtocolArtifact(kind, value, { protocolVersion: '2.0.0' });
  } catch (cause) {
    fail(`${subject} is not a valid Protocol 2.0 record.`, { ...details, cause: cause?.code ?? null });
  }
}

/** Stable identity shared by routing and later persisted-plan graph validation. */
export function deriveOperatingIntelligenceAssignmentIdV2(planId, roleId, roleVersion = '2.0.0') {
  if (![planId, roleId, roleVersion].every(nonEmptyString)) {
    fail('An intelligence Assignment identity requires explicit plan, role, and role-version identities.');
  }
  return `asg_${sha256Jcs({ planId, roleId, roleVersion }).slice('sha256:'.length, 'sha256:'.length + 32)}`;
}

function terminalProof(assignment) {
  const terminal = assignment.terminalOutcome;
  if (
    !plainObject(terminal)
    || !TERMINAL_OUTCOMES.has(terminal.outcome)
    || terminal.outcome !== assignment.state
    || !nonEmptyString(terminal.eventId)
    || !nonEmptyString(terminal.code)
    || !nonEmptyString(terminal.reason)
    || !nonEmptyString(terminal.recoveryDisposition)
  ) {
    fail('A terminal dependency requires its exact typed absence/recovery proof.', {
      assignmentId: assignment.assignmentId,
      outcome: assignment.state,
    });
  }
  if (!['role-unavailable', 'not-selected', 'submission-rejected', 'timeout', 'policy-denied'].includes(terminal.code)) {
    fail('A terminal dependency absence code must be typed and contract-known.', {
      assignmentId: assignment.assignmentId,
      code: terminal.code,
    });
  }
  return Object.freeze({
    assignmentId: assignment.assignmentId,
    outcome: terminal.outcome,
    eventId: terminal.eventId,
    absence: Object.freeze({
      code: terminal.code,
      reason: terminal.reason,
      recoveryDisposition: terminal.recoveryDisposition,
    }),
  });
}

/**
 * Validate the complete durable proof for one validated dependency. This is
 * shared by pure scheduling and runtime replay; an Artifact ID alone is never
 * sufficient to unlock downstream work.
 */
export function assertOperatingValidatedDependencyProofV2({ assignment, submission, artifact, replay }) {
  contractRecord('operating-assignment', assignment, 'Validated dependency Assignment', {
    assignmentId: assignment?.assignmentId ?? null,
  });
  contractRecord('operating-submission', submission, 'Validated dependency Submission', {
    assignmentId: assignment.assignmentId,
  });
  contractRecord('operating-artifact', artifact, 'Validated dependency Artifact', {
    assignmentId: assignment.assignmentId,
  });
  const expectedReplay = {
    submissionId: submission.submissionId,
    assignmentId: submission.assignmentId,
    rawHash: submission.rawHash,
    canonicalHash: submission.canonicalHash,
    sizeBytes: submission.sizeBytes,
    artifactId: submission.artifactId,
    acceptanceEventIds: submission.acceptanceEventIds,
    responseData: submission.responseData,
  };
  const expectedResponse = {
    accepted: true,
    artifactId: artifact.artifactId,
    rawHash: artifact.rawHash,
    sizeBytes: artifact.sizeBytes,
    assignmentState: 'validated',
  };
  const context = assignment.intelligenceContext;
  if (
    assignment.state !== 'validated'
    || !plainObject(assignment.claim)
    || submission.state !== 'accepted'
    || submission.assignmentId !== assignment.assignmentId
    || submission.cycleId !== assignment.cycleId
    || submission.artifactId !== artifact.artifactId
    || submission.rawHash !== artifact.rawHash
    || submission.canonicalHash !== artifact.canonicalHash
    || submission.sizeBytes !== artifact.sizeBytes
    || artifact.assignmentId !== assignment.assignmentId
    || artifact.cycleId !== assignment.cycleId
    || artifact.schemaId !== assignment.outputContract.schemaId
    || artifact.artifactSchemaVersion !== assignment.outputContract.schemaVersion
    || artifact.mediaType !== assignment.outputContract.mediaType
    || artifact.encoding !== assignment.outputContract.encoding
    || artifact.sizeBytes > assignment.outputContract.maxBytes
    || sha256Jcs(artifact.inputArtifactIds) !== sha256Jcs(assignment.inputArtifactIds)
    || (context != null && (
      artifact.scopeId !== context.scopeId
      || artifact.domainId !== context.domainId
      || artifact.domainVersion !== context.domainVersion
    ))
    || artifact.producer.actorId !== assignment.claim?.actorId
    || artifact.producer.runtime !== assignment.claim?.runtime
    || artifact.producer.roleId !== assignment.roleId
    || !Array.isArray(submission.acceptanceEventIds)
    || !nonEmptyString(submission.acceptanceEventIds.at(-1))
    || sha256Jcs(submission.responseData) !== sha256Jcs(expectedResponse)
    || !plainObject(replay)
    || sha256Jcs(replay) !== sha256Jcs(expectedReplay)
  ) {
    fail('A validated dependency lacks an exact accepted Submission, Artifact, Assignment, claim, contract, or replay binding.', {
      assignmentId: assignment.assignmentId,
      submissionId: submission.submissionId,
      artifactId: artifact.artifactId,
    });
  }
  return Object.freeze({
    assignmentId: assignment.assignmentId,
    outcome: 'validated',
    eventId: submission.acceptanceEventIds.at(-1),
    artifactId: artifact.artifactId,
  });
}

/** Bind predecessor Artifact IDs onto a dependent Assignment at scheduler release. */
export function resolveOperatingAssignmentInputArtifactIdsV2(assignment, dependencyProofs = []) {
  contractRecord('operating-assignment', assignment, 'Assignment input resolution', {
    assignmentId: assignment?.assignmentId ?? null,
  });
  const resolved = new Set(assignment.inputArtifactIds);
  for (const proof of dependencyProofs) {
    if (proof?.outcome === 'validated' && nonEmptyString(proof.artifactId)) {
      resolved.add(proof.artifactId);
    }
  }
  return Object.freeze([...resolved].sort());
}

function baseEvidenceAbsences(assignment) {
  const context = assignment.intelligenceContext;
  return (assignment.inputAbsences ?? []).filter((absence) => {
    if (absence.kind !== 'evidence') return false;
    const expectedId = context?.inputBundle?.bundleId && assignment.roleVersion
      ? deriveOperatingEvidenceAbsenceIdV2({
          bundleId: context.inputBundle.bundleId,
          roleId: assignment.roleId,
          roleVersion: assignment.roleVersion,
          requirementId: absence.requirementId,
          absenceCode: absence.absenceCode,
          sourceEvidenceRefIds: absence.sourceEvidenceRefIds,
          sourceEventIds: absence.sourceEventIds,
        })
      : null;
    return absence.absenceId === expectedId;
  }).map((absence) => structuredClone(absence));
}

function addAbsence(absences, absence, assignmentId) {
  const existing = absences.find(({ absenceId }) => absenceId === absence.absenceId);
  if (existing && sha256Jcs(existing) !== sha256Jcs(absence)) {
    fail('One typed absence identity cannot carry conflicting immutable content.', {
      assignmentId,
      absenceId: absence.absenceId,
    });
  }
  if (!existing) absences.push(structuredClone(absence));
}

/**
 * Derive the typed absence inputs a released Assignment is permitted to see.
 * Omitted plan roles and terminal dependency gaps are both durable owner-issued
 * facts; a role executor never infers absence from missing bytes or silence.
 */
export function resolveOperatingAssignmentInputAbsencesV2(assignment, {
  dependencyProofs = [],
  assignments = [],
  intelligencePlans = [],
} = {}) {
  contractRecord('operating-assignment', assignment, 'Assignment absence resolution', {
    assignmentId: assignment?.assignmentId ?? null,
  });
  const byId = new Map(assignments.map((candidate) => [candidate.assignmentId, candidate]));
  const absences = baseEvidenceAbsences(assignment);
  const plan = intelligencePlans.find((candidate) => candidate.selectedRoles.some(({ roleId, roleVersion }) => (
    deriveOperatingIntelligenceAssignmentIdV2(candidate.planId, roleId, roleVersion) === assignment.assignmentId
  )));
  for (const proof of dependencyProofs) {
    const dependency = byId.get(proof.assignmentId);
    for (const absence of dependency?.inputAbsences ?? []) {
      if (absence.kind === 'evidence') addAbsence(absences, absence, assignment.assignmentId);
    }
    if (!TERMINAL_OUTCOMES.has(proof?.outcome) || !plainObject(proof.absence)) continue;
    if (!dependency || !['advisor', 'challenger', 'chair'].includes(dependency.assignmentKind)) {
      fail('A typed terminal absence must resolve to its exact intelligence dependency.', {
        assignmentId: assignment.assignmentId,
        dependencyId: proof.assignmentId,
      });
    }
    if (!plan) {
      fail('A typed terminal intelligence absence requires its exact persisted plan.', {
        assignmentId: assignment.assignmentId,
        dependencyId: proof.assignmentId,
      });
    }
    addAbsence(absences, {
      absenceId: deriveOperatingRoleAbsenceIdV2({
        planId: plan?.planId,
        consumerAssignmentId: assignment.assignmentId,
        roleId: dependency.roleId,
        roleVersion: dependency.roleVersion,
        terminalEventId: proof.eventId,
      }),
      kind: 'role',
      roleId: dependency.roleId,
      roleKind: dependency.assignmentKind,
      roleVersion: dependency.roleVersion,
      absenceCode: proof.absence.code,
      reason: proof.absence.reason,
      recoveryDisposition: proof.absence.recoveryDisposition,
      sourceAssignmentId: dependency.assignmentId,
      sourceEventId: proof.eventId,
    }, assignment.assignmentId);
  }
  if (assignment.assignmentKind === 'chair'
    && assignment.outputContract.schemaId === 'operating-decision-ledger') {
    if (!plan) {
      fail('Chair absence resolution requires its exact persisted intelligence plan.', {
        assignmentId: assignment.assignmentId,
      });
    }
    for (const omitted of plan.omittedRoles) {
      addAbsence(absences, {
        absenceId: deriveOperatingRoleAbsenceIdV2({
          planId: plan.planId,
          consumerAssignmentId: assignment.assignmentId,
          roleId: omitted.roleId,
          roleVersion: omitted.roleVersion,
          terminalEventId: null,
        }),
        kind: 'role',
        roleId: omitted.roleId,
        roleKind: omitted.roleKind,
        roleVersion: omitted.roleVersion,
        absenceCode: 'not-selected',
        reason: omitted.reason,
        recoveryDisposition: 'not-applicable',
        sourceAssignmentId: null,
        sourceEventId: null,
      }, assignment.assignmentId);
    }
  }
  const ordered = absences.sort((left, right) => (
    left.kind.localeCompare(right.kind)
      || String(left.roleKind ?? '').localeCompare(String(right.roleKind ?? ''))
      || String(left.roleId ?? left.requirementId ?? '').localeCompare(String(right.roleId ?? right.requirementId ?? ''))
      || String(left.sourceAssignmentId).localeCompare(String(right.sourceAssignmentId))
  ));
  return Object.freeze(ordered.map((absence) => Object.freeze(absence)));
}

function validatedProof(assignment, acceptedByAssignment, artifactsById, replayBySubmission) {
  const submission = acceptedByAssignment.get(assignment.assignmentId);
  const artifact = artifactsById.get(submission?.artifactId);
  const replay = replayBySubmission.get(submission?.submissionId);
  if (!submission || !artifact || !replay) {
    fail('A validated dependency requires one accepted Artifact and validation Event proof.', {
      assignmentId: assignment.assignmentId,
    });
  }
  return assertOperatingValidatedDependencyProofV2({ assignment, submission, artifact, replay });
}

function assertPolicy(policy, assignment) {
  if (!plainObject(policy)) fail('Assignment dependencyPolicy must be an object.', { assignmentId: assignment.assignmentId });
  const dependencies = assignment.dependsOn;
  const compiled = COMPILED_DEPENDENCY_POLICIES.get(policy.kind);
  if (!compiled) fail('Assignment dependencyPolicy kind is not compiled.', { assignmentId: assignment.assignmentId, kind: policy.kind });
  if (policy.kind === 'none') {
    if (compiled.minimumValidated !== 0 || Object.keys(policy).length !== 1 || dependencies.length !== 0) {
      fail('The none dependency policy is valid only for zero-dependency Assignments.', { assignmentId: assignment.assignmentId });
    }
    return;
  }
  if (policy.kind === 'all-required') {
    if (compiled.minimumValidated !== 'all' || Object.keys(policy).length !== 1 || dependencies.length === 0) {
      fail('The all-required dependency policy requires one or more declared dependencies.', { assignmentId: assignment.assignmentId });
    }
    return;
  }
  if (policy.kind === 'threshold') {
    if (
      Object.keys(policy).length !== 3
      || !Number.isSafeInteger(policy.minimumSatisfied)
      || policy.minimumSatisfied < 1
      || policy.minimumSatisfied > dependencies.length
      || !uniqueStrings(policy.allowedTerminalOutcomes)
      || compiled.minimumValidated !== 'declared'
      || policy.allowedTerminalOutcomes.some((outcome) => !compiled.allowedTerminalOutcomes.includes(outcome))
    ) {
      fail('The threshold dependency policy has invalid cardinality or terminal outcomes.', {
        assignmentId: assignment.assignmentId,
      });
    }
    return;
  }
  fail('Assignment dependencyPolicy kind is not implemented.', { assignmentId: assignment.assignmentId, kind: policy.kind });
}

/**
 * Validate the whole in-cycle Assignment DAG before policy evaluation. The
 * scheduler intentionally accepts no executable expressions or cross-cycle
 * references: its entire policy algebra is structural and serializable.
 */
export function validateOperatingAssignmentGraphV2(assignments) {
  if (!Array.isArray(assignments)) fail('Assignments must be an array.');
  const byId = new Map();
  for (const assignment of assignments) {
    if (!plainObject(assignment) || typeof assignment.assignmentId !== 'string' || assignment.assignmentId.length === 0) {
      fail('Every Assignment requires an identity.');
    }
    if (byId.has(assignment.assignmentId)) fail('Duplicate Assignment identity in dependency graph.', {
      assignmentId: assignment.assignmentId,
    });
    if (typeof assignment.cycleId !== 'string' || assignment.cycleId.length === 0 || !uniqueStrings(assignment.dependsOn)) {
      fail('An Assignment has malformed cycle or dependency references.', { assignmentId: assignment.assignmentId });
    }
    assertPolicy(assignment.dependencyPolicy, assignment);
    if (assignment.assignmentKind === 'verification') {
      contractRecord('operating-assignment', assignment, 'Verification Assignment', {
        assignmentId: assignment.assignmentId,
      });
      const outputIsTerminalOutcome = assignment.outputContract.schemaId === 'operating-outcome';
      const outputIsLiveEvidenceIngestion = (
        assignment.outputContract.schemaId === 'operating-live-evidence-ingestion'
        && assignment.outputContract.schemaVersion === '2.0.0'
      );
      if (assignment.dependsOn.length !== 0
        || assignment.dependencyPolicy.kind !== 'none'
        || (!outputIsTerminalOutcome && !outputIsLiveEvidenceIngestion)
        || typeof assignment.governedOperationId !== 'string') {
        fail('Verification Assignment must be directly owned by one governed operation and produce one Outcome or live-evidence ingestion.', {
          assignmentId: assignment.assignmentId,
          governedOperationId: assignment.governedOperationId ?? null,
        });
      }
    }
    byId.set(assignment.assignmentId, assignment);
  }
  for (const assignment of byId.values()) {
    for (const dependencyId of assignment.dependsOn) {
      const dependency = byId.get(dependencyId);
      if (!dependency) fail('Assignment dependency references an unknown Assignment.', {
        assignmentId: assignment.assignmentId,
        dependencyId,
      });
      if (dependencyId === assignment.assignmentId) fail('Assignment cannot depend on itself.', {
        assignmentId: assignment.assignmentId,
      });
      if (dependency.cycleId !== assignment.cycleId) fail('Assignment dependencies cannot cross cycle boundaries.', {
        assignmentId: assignment.assignmentId,
        dependencyId,
        cycleId: assignment.cycleId,
        dependencyCycleId: dependency.cycleId,
      });
    }
  }
  const visiting = new Set();
  const complete = new Set();
  const visit = (assignmentId) => {
    if (complete.has(assignmentId)) return;
    if (visiting.has(assignmentId)) fail('Assignment dependency graph contains a cycle.', { assignmentId });
    visiting.add(assignmentId);
    for (const dependencyId of byId.get(assignmentId).dependsOn) visit(dependencyId);
    visiting.delete(assignmentId);
    complete.add(assignmentId);
  };
  for (const assignmentId of [...byId.keys()].sort()) visit(assignmentId);
  return Object.freeze(byId);
}

/**
 * Verify that an explainable plan maps one-to-one to ordinary pending
 * Assignments. Omitted roles cannot acquire work, and role dependencies are
 * resolved only to the corresponding Assignment identities.
 */
export function validateOperatingIntelligenceAssignmentGraphV2(plan, assignments, {
  allowLifecycleProgress = false,
  canonicalContext = null,
} = {}) {
  try {
    assertOperateIntelligencePlanContractV2(plan);
  } catch (cause) {
    fail('Intelligence Assignment graph requires a contract-valid plan.', { cause: cause?.code ?? null });
  }
  const byId = validateOperatingAssignmentGraphV2(assignments);
  if (byId.size !== plan.selectedRoles.length) {
    fail('Intelligence Assignment graph must contain exactly one Assignment for every selected role.', {
      planId: plan.planId,
    });
  }
  const byRole = new Map();
  for (const assignment of byId.values()) {
    contractRecord('operating-assignment', assignment, 'Intelligence Assignment intent', {
      assignmentId: assignment?.assignmentId ?? null,
    });
    if (byRole.has(assignment.roleId)) fail('Intelligence Assignment graph repeats a selected role.', { roleId: assignment.roleId });
    if (!allowLifecycleProgress && (assignment.state !== 'pending' || assignment.availableAt !== null || assignment.completedAt !== null
      || assignment.claim !== null || assignment.terminalOutcome !== null)) {
      fail('Intelligence Assignment intents must begin pending without lifecycle proof.', { assignmentId: assignment.assignmentId });
    }
    byRole.set(assignment.roleId, assignment);
  }
  const selectedIds = new Set(plan.selectedRoles.map(({ roleId }) => roleId));
  if (plan.omittedRoles.some(({ roleId }) => byRole.has(roleId))) {
    fail('An explicitly omitted role cannot receive an Assignment intent.', { planId: plan.planId });
  }
  const contextEvidenceRefIds = canonicalContext
    ? [...canonicalContext.snapshot.evidenceRefIds].sort()
    : null;
  const canonicalDomain = canonicalContext
    ? OPERATE_CONTRACT_CATALOG_V2.extensions.domains.find((domain) => (
      domain.domainId === plan.domainId && domain.domainVersion === plan.domainVersion
    ))
    : null;
  if (canonicalContext && (!canonicalDomain
    || canonicalContext.snapshot.snapshotId !== plan.snapshotId
    || canonicalContext.snapshot.scopeId !== plan.scopeId
    || canonicalContext.snapshot.domainId !== plan.domainId
    || canonicalContext.snapshot.domainVersion !== plan.domainVersion
    || canonicalContext.cycle.scopeId !== plan.scopeId
    || canonicalContext.cycle.domainId !== plan.domainId
    || canonicalContext.cycle.domainVersion !== plan.domainVersion)) {
    fail('Intelligence Assignment checkpoint context differs from its canonical plan, snapshot, or Cycle.', {
      planId: plan.planId,
    });
  }
  for (const role of plan.selectedRoles) {
    const assignment = byRole.get(role.roleId);
    const canonicalRole = canonicalDomain?.roles.find((candidate) => candidate.roleId === role.roleId) ?? null;
    const context = assignment?.intelligenceContext;
    const baseInputArtifactIds = context ? [...new Set([
      context.inputBundle.bundleArtifactId,
      ...context.inputBundle.issuedEvidence.map(({ evidenceArtifactId }) => evidenceArtifactId),
    ])].sort() : [];
    const contextMatchesPlan = context
      && context.intelligencePlanId === plan.planId
      && context.snapshotId === plan.snapshotId
      && context.scopeId === plan.scopeId
      && context.domainId === plan.domainId
      && context.domainVersion === plan.domainVersion
      && context.sourceArtifactId === plan.sourceArtifactId
      && context.decisionOwnerActorId === plan.decisionOwnerActorId
      && context.sourceArtifactIds.includes(plan.sourceArtifactId)
      && sha256Jcs(context.inputBundle.sourceArtifactIds) === sha256Jcs(context.sourceArtifactIds)
      && sha256Jcs(baseInputArtifactIds) === sha256Jcs(role.inputArtifactIds)
      && (!canonicalContext
        || (sha256Jcs(context.sourceArtifactIds) === sha256Jcs([...canonicalContext.snapshot.sourceArtifactIds].sort())
          && sha256Jcs(context.evidenceRefIds) === sha256Jcs(contextEvidenceRefIds)));
    const inputMatchesPlan = assignment
      && role.inputArtifactIds.every((artifactId) => assignment.inputArtifactIds.includes(artifactId))
      && (allowLifecycleProgress && role.dependsOnRoleIds.length > 0
        ? true
        : sha256Jcs(assignment.inputArtifactIds) === sha256Jcs(role.inputArtifactIds));
    if (!assignment
      || assignment.assignmentId !== deriveOperatingIntelligenceAssignmentIdV2(plan.planId, role.roleId, role.roleVersion)
      || assignment.assignmentKind !== role.roleKind
      || assignment.roleVersion !== role.roleVersion
      || assignment.outputContract.schemaId !== role.outputContract.schemaId
      || assignment.outputContract.schemaVersion !== role.outputContract.schemaVersion
      || !contextMatchesPlan
      || !inputMatchesPlan) {
      fail('Selected role and Assignment intent contracts differ.', { roleId: role.roleId });
    }
    const expectedDependencies = role.dependsOnRoleIds.map((roleId) => {
      if (!selectedIds.has(roleId) || !byRole.has(roleId)) {
        fail('Selected role dependency does not resolve to another selected Assignment.', { roleId: role.roleId, dependencyRoleId: roleId });
      }
      return byRole.get(roleId).assignmentId;
    }).sort();
    if (sha256Jcs(assignment.dependsOn) !== sha256Jcs(expectedDependencies)) {
      fail('Assignment dependencies differ from the explainable role plan.', { roleId: role.roleId });
    }
    if (canonicalContext) {
      const expectedDependencyPolicy = expectedDependencies.length === 0
        ? { kind: 'none' }
        : canonicalRole?.dependencyPolicy.id === 'all-required'
          ? { kind: 'all-required' }
          : {
              kind: 'threshold',
              minimumSatisfied: expectedDependencies.length,
              allowedTerminalOutcomes: ['abandoned', 'failed'],
            };
      const expectedOutputContract = canonicalRole ? {
        schemaId: canonicalRole.output.schemaId,
        schemaVersion: canonicalRole.output.schemaVersion,
        mediaType: canonicalRole.output.mediaType,
        encoding: 'utf-8',
        maxBytes: canonicalRole.output.maxBytes,
      } : null;
      const expectedCapabilityGrantId = canonicalRole
        ? `ceiling_${sha256Jcs({
            planId: plan.planId,
            roleId: role.roleId,
            inputArtifactIds: role.inputArtifactIds,
            outputContract: canonicalRole.output,
          }).slice('sha256:'.length, 'sha256:'.length + 24)}`
        : null;
      const expectedObjective = role.roleKind === 'advisor'
        ? 'Analyze the validated Delta and immutable snapshot within the declared read and output ceilings.'
        : role.roleKind === 'challenger'
          ? 'Challenge validated analysis for unsupported assumptions, conflict, missing alternatives, downside, reversibility, and overconfidence.'
          : 'Synthesize only validated selected-role results and explicit permitted absences into the declared output contract.';
      if (!canonicalRole
        || canonicalRole.roleKind !== role.roleKind
        || canonicalRole.roleVersion !== role.roleVersion
        || sha256Jcs(assignment.analysisRubric) !== sha256Jcs(canonicalRole.analysisRubric)
        || sha256Jcs(assignment.mandate) !== sha256Jcs(canonicalRole.mandate)
        || assignment.objective !== expectedObjective
        || sha256Jcs(assignment.outputContract) !== sha256Jcs(expectedOutputContract)
        || sha256Jcs(assignment.dependencyPolicy) !== sha256Jcs(expectedDependencyPolicy)
        || assignment.capabilityGrantId !== expectedCapabilityGrantId
        || assignment.attemptPolicy.maxAttempts !== 3
        || assignment.attemptPolicy.timeoutMs !== 300000
        || assignment.createdAt !== plan.createdAt
        || assignment.cycleId !== canonicalContext.cycle.cycleId) {
        fail('Intelligence Assignment immutable intent differs from the compiler-owned role registry or plan.', {
          planId: plan.planId,
          roleId: role.roleId,
          assignmentId: assignment.assignmentId,
        });
      }
    }
  }
  const chairRole = plan.selectedRoles.find(({ roleKind }) => roleKind === 'chair');
  const chair = chairRole ? byRole.get(chairRole.roleId) : null;
  if (!chair || chair.dependsOn.length === 0) {
    fail('Chair work requires at least one declared selected-role dependency.', { planId: plan.planId });
  }
  return byId;
}

function dependencyProofs(assignment, byId, acceptedByAssignment, artifactsById, replayBySubmission) {
  const proofs = [];
  for (const dependencyId of [...assignment.dependsOn].sort()) {
    const dependency = byId.get(dependencyId);
    if (dependency.state === 'validated') {
      proofs.push(validatedProof(dependency, acceptedByAssignment, artifactsById, replayBySubmission));
      continue;
    }
    if (TERMINAL_OUTCOMES.has(dependency.state)) {
      proofs.push(terminalProof(dependency));
      continue;
    }
    return null;
  }
  return proofs;
}

function policySatisfied(assignment, proofs) {
  if (assignment.dependencyPolicy.kind === 'none') return [];
  if (proofs === null) return null;
  if (assignment.dependencyPolicy.kind === 'all-required') {
    return proofs.every(({ outcome }) => outcome === 'validated') ? proofs : null;
  }
  if (assignment.assignmentKind === 'challenger'
    && proofs.length > 0
    && proofs.every(({ outcome }) => outcome !== 'validated')) {
    return null;
  }
  const permitted = new Set(assignment.dependencyPolicy.allowedTerminalOutcomes);
  const qualified = proofs.filter(({ outcome }) => outcome === 'validated' || permitted.has(outcome));
  return qualified.length >= assignment.dependencyPolicy.minimumSatisfied ? qualified : null;
}

/**
 * Derive one fail-closed terminal intent when a Challenger has no validated
 * Advisor material left to review. The scheduler records this as typed absence
 * proof; it never exposes the impossible Challenger as executable work.
 */
export function deriveOperatingAssignmentTerminalIntentsV2({
  assignments,
  submissions = [],
  artifacts = [],
  submissionReplayIndex = [],
  intelligencePlans = [],
}) {
  const byId = validateOperatingAssignmentGraphV2(assignments);
  const artifactsById = uniqueIndex(artifacts, 'artifactId', 'Artifact');
  const replayBySubmission = uniqueIndex(submissionReplayIndex, 'submissionId', 'Submission replay');
  const acceptedByAssignment = acceptedSubmissionIndex(submissions);
  const intelligenceRolesByAssignmentId = new Map();
  for (const plan of intelligencePlans ?? []) {
    assertOperateIntelligencePlanContractV2(plan);
    for (const role of plan.selectedRoles) {
      intelligenceRolesByAssignmentId.set(
        deriveOperatingIntelligenceAssignmentIdV2(plan.planId, role.roleId, role.roleVersion),
        { plan, role },
      );
    }
  }
  const intents = [];
  for (const assignment of [...byId.values()].filter((candidate) => (
    candidate.state === 'pending'
    && candidate.assignmentKind === 'challenger'
    && candidate.outputContract.schemaId === 'operating-challenger-review'
    && intelligenceRolesByAssignmentId.get(candidate.assignmentId)?.role.roleKind === 'challenger'
  )).sort((left, right) => left.assignmentId.localeCompare(right.assignmentId))) {
    if (assignment.dependsOn.some((dependencyId) => byId.get(dependencyId)?.assignmentKind !== 'advisor')) {
      fail('A scheduler-terminal Challenger may depend only on its selected Advisor Assignments.', {
        assignmentId: assignment.assignmentId,
      });
    }
    const proofs = dependencyProofs(assignment, byId, acceptedByAssignment, artifactsById, replayBySubmission);
    if (proofs === null || proofs.length === 0 || proofs.some(({ outcome }) => outcome === 'validated')) continue;
    const orderedProofs = [...proofs].sort((left, right) => left.assignmentId.localeCompare(right.assignmentId));
    const terminalId = `fail_${sha256Jcs({
      assignmentId: assignment.assignmentId,
      cycleId: assignment.cycleId,
      reason: 'zero-valid-advisor-results',
      dependencyProofs: orderedProofs,
    }).slice('sha256:'.length, 'sha256:'.length + 24)}`;
    intents.push(Object.freeze({
      assignmentId: assignment.assignmentId,
      cycleId: assignment.cycleId,
      terminalId,
      dependencyProofs: Object.freeze(orderedProofs),
      dependencyEventIds: Object.freeze(orderedProofs.map(({ eventId }) => eventId)),
      payload: Object.freeze({
        assignmentId: assignment.assignmentId,
        errorCode: 'role-unavailable',
        reason: 'No validated Advisor Artifact remains available for the Challenger to review.',
        recoveryStatus: 'continue-partial',
      }),
    }));
  }
  return Object.freeze(intents);
}

export function assertOperatingAssignmentTerminalPayloadV2(assignment, payload, state) {
  const intent = deriveOperatingAssignmentTerminalIntentsV2(state)
    .find(({ assignmentId }) => assignment.assignmentId === assignmentId);
  if (!intent || sha256Jcs(intent.payload) !== sha256Jcs(payload)) {
    fail('Pending Assignment failure has no scheduler-owned terminal proof.', {
      assignmentId: assignment.assignmentId,
    });
  }
  return intent;
}

function acceptedSubmissionIndex(submissions) {
  const accepted = new Map();
  for (const submission of submissions ?? []) {
    if (submission?.state !== 'accepted') continue;
    if (accepted.has(submission.assignmentId)) fail('An Assignment has multiple accepted submission proofs.', {
      assignmentId: submission.assignmentId,
    });
    accepted.set(submission.assignmentId, submission);
  }
  return accepted;
}

function uniqueIndex(records, key, label) {
  const index = new Map();
  for (const record of records ?? []) {
    const id = record?.[key];
    if (!nonEmptyString(id) || index.has(id)) fail(`${label} identities must be present and unique.`, { [key]: id ?? null });
    index.set(id, record);
  }
  return index;
}

/**
 * Return fully deterministic scheduler-owned release intents. The caller may
 * persist only the Event derived from an intent; target selection, proof
 * content, and release identity all remain a pure consequence of state.
 */
export function deriveOperatingAssignmentReleaseIntentsV2({
  assignments,
  submissions = [],
  artifacts = [],
  submissionReplayIndex = [],
  intelligencePlans = [],
}) {
  const byId = validateOperatingAssignmentGraphV2(assignments);
  const artifactsById = uniqueIndex(artifacts, 'artifactId', 'Artifact');
  const replayBySubmission = uniqueIndex(submissionReplayIndex, 'submissionId', 'Submission replay');
  const acceptedByAssignment = acceptedSubmissionIndex(submissions);
  for (const plan of intelligencePlans ?? []) {
    assertOperateIntelligencePlanContractV2(plan);
    const planAssignments = plan.selectedRoles.map((role) => {
      const assignmentId = deriveOperatingIntelligenceAssignmentIdV2(plan.planId, role.roleId, role.roleVersion);
      const assignment = byId.get(assignmentId);
      if (!assignment) fail('A persisted intelligence plan is missing its canonical Assignment.', {
        planId: plan.planId,
        assignmentId,
      });
      return assignment;
    });
    validateOperatingIntelligenceAssignmentGraphV2(plan, planAssignments, { allowLifecycleProgress: true });
    for (const role of plan.selectedRoles) {
      const assignment = planAssignments.find(({ roleId }) => roleId === role.roleId);
      const baseIntent = {
        ...assignment,
        inputArtifactIds: [...role.inputArtifactIds],
        inputAbsences: baseEvidenceAbsences(assignment),
      };
      if (assignment.availableAt === null) {
        if (sha256Jcs(assignment.inputArtifactIds) !== sha256Jcs(baseIntent.inputArtifactIds)
          || sha256Jcs(assignment.inputAbsences) !== sha256Jcs(baseIntent.inputAbsences)) {
          fail('Pending intelligence Assignment custody differs from its immutable plan.', {
            planId: plan.planId,
            assignmentId: assignment.assignmentId,
          });
        }
        continue;
      }
      const proofs = dependencyProofs(assignment, byId, acceptedByAssignment, artifactsById, replayBySubmission);
      if (proofs === null) {
        fail('Released intelligence Assignment has a non-terminal dependency.', {
          planId: plan.planId,
          assignmentId: assignment.assignmentId,
        });
      }
      const expectedInputs = resolveOperatingAssignmentInputArtifactIdsV2(baseIntent, proofs);
      const expectedAbsences = resolveOperatingAssignmentInputAbsencesV2(baseIntent, {
        dependencyProofs: proofs,
        assignments: [...byId.values()],
        intelligencePlans: [plan],
      });
      if (sha256Jcs(assignment.inputArtifactIds) !== sha256Jcs(expectedInputs)
        || sha256Jcs(assignment.inputAbsences) !== sha256Jcs(expectedAbsences)) {
        fail('Released intelligence Assignment custody differs from durable dependency and absence proof.', {
          planId: plan.planId,
          assignmentId: assignment.assignmentId,
        });
      }
    }
  }
  const intents = [];
  for (const assignment of [...byId.values()].filter(({ state }) => state === 'pending').sort((left, right) => (
    left.assignmentId.localeCompare(right.assignmentId)
  ))) {
    const proofs = dependencyProofs(assignment, byId, acceptedByAssignment, artifactsById, replayBySubmission);
    const satisfied = policySatisfied(assignment, proofs);
    if (satisfied === null) continue;
    const orderedProofs = [...satisfied].sort((left, right) => left.assignmentId.localeCompare(right.assignmentId));
    const releaseId = `rel_${sha256Jcs({
      assignmentId: assignment.assignmentId,
      cycleId: assignment.cycleId,
      dependencyProofs: orderedProofs,
    }).slice(7, 31)}`;
    intents.push(Object.freeze({
      assignmentId: assignment.assignmentId,
      cycleId: assignment.cycleId,
      releaseId,
      dependencyProofs: Object.freeze(orderedProofs),
      dependencyEventIds: Object.freeze(orderedProofs.map(({ eventId }) => eventId)),
    }));
  }
  return Object.freeze(intents);
}

export function assertOperatingAssignmentAvailabilityPayloadV2(assignment, payload, state) {
  const intent = deriveOperatingAssignmentReleaseIntentsV2(state).find(({ assignmentId }) => assignmentId === assignment.assignmentId);
  if (!intent || !plainObject(payload)) {
    fail('Assignment availability has no scheduler-owned release intent.', { assignmentId: assignment.assignmentId });
  }
  const expected = {
    assignmentId: intent.assignmentId,
    releaseId: intent.releaseId,
    dependencyProofs: intent.dependencyProofs,
    dependencyEventIds: intent.dependencyEventIds,
  };
  if (sha256Jcs(expected) !== sha256Jcs(payload)) {
    fail('Assignment availability does not match its scheduler-owned release proof.', {
      assignmentId: assignment.assignmentId,
    });
  }
  return intent;
}
