import { PipelineError } from '@openplanr/protocol/errors';
import {
  assertOperateIntelligencePlanContractV2,
  assertOperateRoleOutputContractV2,
  assertProtocolArtifact,
} from '@openplanr/protocol/contracts';
import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { PUBLIC_OPERATING_DOMAIN_CONTRACTS_V2 } from './operating-domains-v2.mjs';
import {
  findOperateDomainRegistrationV2,
  OPEN_REFERENCE_OPERATE_EXTENSIONS_V2,
} from './extensions-v2.mjs';
import { assertOperatingDeltaV2, classifyOperatingDeltaMaterialityV2 } from './operating-delta-v2.mjs';
import { assertOperatingSnapshotV2 } from './operating-snapshots-v2.mjs';
import {
  deriveOperatingIntelligenceAssignmentIdV2,
  validateOperatingIntelligenceAssignmentGraphV2,
} from './scheduler-v2.mjs';
import {
  buildOperatingIntelligenceInputBundleV2,
  deriveOperatingIntelligenceBundleCustodyIdsV2,
  prepareOperatingIntelligenceEvidenceSelectionV2,
} from './intelligence-input-bundle-v2.mjs';

const PROTOCOL_VERSION = '2.0.0';
const KERNEL_ROLE_KINDS = Object.freeze(['advisor', 'challenger', 'chair']);
const CONSEQUENTIAL_FOCUS = new Set([
  'all',
  'challenge',
  'deep',
  'decision-revisit',
  'risk-review',
  'scenario',
]);
const SCENARIO_FOCUS = new Set(['scenario']);
export const OPERATING_INTELLIGENCE_NOT_SELECTED_ABSENCE = 'not-selected';
export const OPERATING_INTELLIGENCE_TYPED_TERMINAL_ABSENCE_CODES = Object.freeze([
  'role-unavailable',
  'not-selected',
  'submission-rejected',
  'timeout',
  'policy-denied',
]);

export function assertOperatingIntelligenceTypedTerminalAbsenceCode(code, subject = 'terminal absence') {
  if (typeof code !== 'string' || !OPERATING_INTELLIGENCE_TYPED_TERMINAL_ABSENCE_CODES.includes(code)) {
    fail('RESULT_CONTRACT_INVALID', `${subject} must use a typed absence code.`, { code: code ?? null });
  }
}

function typedNotSelectedReason() {
  return `${OPERATING_INTELLIGENCE_NOT_SELECTED_ABSENCE}: scoped routing policy excluded this executive lens.`;
}

function resolveAdvisorSelection(advisorRoles, focus) {
  if (focus.includes('all')) {
    return { selectedAdvisorRoles: advisorRoles, omittedAdvisorRoles: [] };
  }
  const advisorIds = new Set(advisorRoles.map(({ roleId }) => roleId));
  const scopedAdvisorIds = focus.filter((entry) => advisorIds.has(entry));
  if (scopedAdvisorIds.length === 0) {
    return { selectedAdvisorRoles: advisorRoles, omittedAdvisorRoles: [] };
  }
  const scoped = new Set(scopedAdvisorIds);
  return {
    selectedAdvisorRoles: advisorRoles.filter(({ roleId }) => scoped.has(roleId)),
    omittedAdvisorRoles: advisorRoles.filter(({ roleId }) => !scoped.has(roleId)),
  };
}

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

function token(prefix, value, length = 32) {
  return `${prefix}_${sha256Jcs(value).slice('sha256:'.length, 'sha256:'.length + length)}`;
}

function exactKeys(value, fields, subject) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('RESULT_CONTRACT_INVALID', `${subject} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (sha256Jcs(actual) !== sha256Jcs(expected)) {
    fail('RESULT_CONTRACT_INVALID', `${subject} contains missing or unsupported fields.`, { fields: actual });
  }
}

function normalizedFocus(focus) {
  if (!Array.isArray(focus) || focus.length === 0 || focus.some((entry) => (
    typeof entry !== 'string'
    || entry.length === 0
    || entry.length > 128
    || entry.trim() !== entry
  ))) {
    fail('RESULT_CONTRACT_INVALID', 'Intelligence routing requires one or more canonical focus identifiers.');
  }
  const result = [...new Set(focus)].sort();
  if (result.length !== focus.length) {
    fail('RESULT_CONTRACT_INVALID', 'Intelligence routing focus identifiers must be unique.');
  }
  return result;
}

function assertExactBinding(actual, expected, subject) {
  if (sha256Jcs(actual) !== sha256Jcs({
    apiDomainId: expected.apiDomainId,
    id: expected.id,
    version: expected.version,
  })) {
    fail('OPERATING_SCOPE_INVALID', `${subject} does not match the explicit public API-domain contract.`, {
      domainId: expected.apiDomainId,
    });
  }
}

function sameScopeBinding(left, right) {
  return left.scopeId === right.scopeId
    && left.domainId === right.domainId
    && left.domainVersion === right.domainVersion;
}

function roleIndex(domainDescriptor) {
  try {
    assertProtocolArtifact('operate-domain-registration', domainDescriptor, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', 'Intelligence routing requires a contract-valid public domain descriptor.', {
      cause: cause?.code ?? null,
    });
  }
  const expected = PUBLIC_OPERATING_DOMAIN_CONTRACTS_V2[domainDescriptor.domainId];
  if (!expected || domainDescriptor.domainVersion !== expected.version) {
    fail('OPERATING_DOMAIN_UNAVAILABLE', 'Intelligence routing supports only an explicitly versioned public operating domain.', {
      domainId: domainDescriptor.domainId,
      domainVersion: domainDescriptor.domainVersion,
    });
  }
  assertExactBinding(domainDescriptor.domainContract, expected, 'Domain descriptor');
  if (!Array.isArray(domainDescriptor.requestedCapabilities) || domainDescriptor.requestedCapabilities.length !== 0) {
    fail('CAPABILITY_DENIED', 'A domain descriptor cannot grant or request authority during intelligence routing.', {
      domainId: domainDescriptor.domainId,
    });
  }
  const canonicalDomain = findOperateDomainRegistrationV2(
    OPEN_REFERENCE_OPERATE_EXTENSIONS_V2,
    domainDescriptor.domainId,
    { domainVersion: domainDescriptor.domainVersion },
  );
  if (!canonicalDomain) {
    fail('OPERATING_DOMAIN_UNAVAILABLE', 'Intelligence routing supports only compiler-owned public operating domains.', {
      domainId: domainDescriptor.domainId,
      domainVersion: domainDescriptor.domainVersion,
    });
  }
  if (sha256Jcs(domainDescriptor.roles) !== sha256Jcs(canonicalDomain.roles)) {
    fail('RESULT_CONTRACT_INVALID', 'Intelligence routing rejects caller-supplied domain role mutations.', {
      domainId: domainDescriptor.domainId,
      domainVersion: domainDescriptor.domainVersion,
    });
  }
  const indexed = new Map();
  const byKind = new Map(KERNEL_ROLE_KINDS.map((kind) => [kind, []]));
  for (const role of canonicalDomain.roles) {
    if (indexed.has(role.roleId)) {
      fail('RESULT_CONTRACT_INVALID', 'A domain descriptor cannot repeat a role identity.', { roleId: role.roleId });
    }
    if (!KERNEL_ROLE_KINDS.includes(role.roleKind) || role.roleVersion !== PROTOCOL_VERSION) {
      fail('CONTRACT_VERSION_UNSUPPORTED', 'The public intelligence role identity is unsupported.', {
        roleId: role.roleId,
        roleKind: role.roleKind,
        roleVersion: role.roleVersion,
      });
    }
    if (!role.analysisRubric || typeof role.analysisRubric !== 'object') {
      fail('RESULT_CONTRACT_INVALID', 'A public intelligence role requires its versioned analysis rubric.', {
        roleId: role.roleId,
        roleVersion: role.roleVersion,
      });
    }
    if (!role.mandate || typeof role.mandate !== 'object') {
      fail('RESULT_CONTRACT_INVALID', 'A public intelligence role requires its versioned mandate appendix.', {
        roleId: role.roleId,
        roleVersion: role.roleVersion,
      });
    }
    try {
      assertOperateRoleOutputContractV2(role.roleKind, role.output, { roleVersion: role.roleVersion });
    } catch (cause) {
      fail('RESULT_CONTRACT_INVALID', 'A domain role output contract differs from its compiler-owned mandate.', {
        roleId: role.roleId,
        roleKind: role.roleKind,
        cause: cause?.code ?? null,
      });
    }
    indexed.set(role.roleId, clone(role));
    byKind.get(role.roleKind).push(role);
  }
  const advisors = byKind.get('advisor');
  const challengers = byKind.get('challenger');
  const chairs = byKind.get('chair');
  if (advisors.length < 1 || challengers.length !== 1 || chairs.length !== 1) {
    fail('OPERATING_DOMAIN_UNAVAILABLE', 'A public intelligence domain requires at least one advisor, exactly one challenger, and exactly one chair.');
  }
  for (const advisor of advisors) {
    if (advisor.dependencyPolicy.id !== 'none') {
      fail('RESULT_CONTRACT_INVALID', 'Advisor seats must declare the none dependency policy.', { roleId: advisor.roleId });
    }
  }
  if (challengers[0].dependencyPolicy.id === 'none' || chairs[0].dependencyPolicy.id === 'none') {
    fail('RESULT_CONTRACT_INVALID', 'Public role dependency declarations do not describe advisor, challenge, and synthesis choreography.');
  }
  return indexed;
}

function assertBoundInputs(snapshot, delta, domainDescriptor) {
  let checkedSnapshot;
  let checkedDelta;
  try {
    checkedSnapshot = assertOperatingSnapshotV2(snapshot);
    checkedDelta = assertOperatingDeltaV2(delta, { currentSnapshot: checkedSnapshot });
  } catch (cause) {
    fail(cause?.code ?? 'RESULT_CONTRACT_INVALID', 'Intelligence routing requires a validated Delta and immutable snapshot.', {
      cause: cause?.code ?? null,
    });
  }
  if (checkedDelta.currentSnapshotId !== checkedSnapshot.snapshotId
    || checkedDelta.scopeId !== checkedSnapshot.scopeId
    || checkedDelta.domainId !== checkedSnapshot.domainId
    || checkedDelta.domainVersion !== checkedSnapshot.domainVersion
    || domainDescriptor.domainId !== checkedSnapshot.domainId
    || domainDescriptor.domainVersion !== checkedSnapshot.domainVersion
    || !checkedSnapshot.sourceArtifactIds.includes(checkedDelta.sourceArtifactId)) {
    fail('OPERATING_SCOPE_INVALID', 'Delta, snapshot, source Artifact, and public domain descriptor must share one exact binding.', {
      snapshotId: checkedSnapshot.snapshotId,
      deltaId: checkedDelta.deltaId,
    });
  }
  if (checkedSnapshot.evidenceRefIds.length === 0) {
    fail('RESULT_CONTRACT_INVALID', 'Intelligence routing refuses to create unsatisfiable work from an evidence-empty snapshot.', {
      snapshotId: checkedSnapshot.snapshotId,
    });
  }
  return { snapshot: checkedSnapshot, delta: checkedDelta };
}

function selectedRole(role, { inputArtifactIds, dependsOnRoleIds, reason }) {
  return {
    roleId: role.roleId,
    roleKind: role.roleKind,
    roleVersion: role.roleVersion,
    inputArtifactIds: [...inputArtifactIds],
    outputContract: {
      schemaId: role.output.schemaId,
      schemaVersion: role.output.schemaVersion,
    },
    dependsOnRoleIds: [...dependsOnRoleIds],
    reason,
  };
}

function dependencyPolicy(role, dependencyCount) {
  if (dependencyCount === 0) {
    if (role.dependencyPolicy.id !== 'none') {
      fail('RESULT_CONTRACT_INVALID', 'A zero-dependency intelligence role must declare the none policy.', { roleId: role.roleId });
    }
    return { kind: 'none' };
  }
  if (role.dependencyPolicy.id === 'all-required') return { kind: 'all-required' };
  if (role.dependencyPolicy.id === 'threshold') {
    return {
      kind: 'threshold',
      minimumSatisfied: dependencyCount,
      allowedTerminalOutcomes: ['abandoned', 'failed'],
    };
  }
  fail('RESULT_CONTRACT_INVALID', 'A dependent intelligence role has an unsupported dependency policy.', {
    roleId: role.roleId,
    policy: role.dependencyPolicy.id,
  });
}

function assignmentObjective(roleKind) {
  if (roleKind === 'advisor') return 'Analyze the validated Delta and immutable snapshot within the declared read and output ceilings.';
  if (roleKind === 'challenger') return 'Challenge validated analysis for unsupported assumptions, conflict, missing alternatives, downside, reversibility, and overconfidence.';
  return 'Synthesize only validated selected-role results and explicit permitted absences into the declared output contract.';
}

function buildAssignments(plan, cycleId, roles, snapshot, bundleCaptures) {
  const assignmentIds = Object.fromEntries(plan.selectedRoles.map((role) => [
    role.roleId,
    deriveOperatingIntelligenceAssignmentIdV2(plan.planId, role.roleId, role.roleVersion),
  ]));
  const capturesByRole = new Map(bundleCaptures.map((capture) => [
    capture.bundle.assignmentBinding.roleId,
    capture,
  ]));
  return plan.selectedRoles.map((selected) => {
    const role = roles.get(selected.roleId);
    const capture = capturesByRole.get(role.roleId);
    const roleBinding = capture?.bundle.assignmentBinding;
    if (!capture
      || roleBinding.assignmentId !== assignmentIds[selected.roleId]
      || roleBinding.roleId !== role.roleId
      || roleBinding.roleKind !== role.roleKind
      || roleBinding.roleVersion !== role.roleVersion) {
      fail('STATE_TRANSITION_INVALID', 'Assignment bundle custody must bind the exact pre-derived role Assignment identity.', {
        roleId: role.roleId,
      });
    }
    const dependsOn = selected.dependsOnRoleIds.map((roleId) => assignmentIds[roleId]).sort();
    const assignment = {
      kind: 'operating-assignment',
      schemaVersion: '1.0.0',
      protocolVersion: PROTOCOL_VERSION,
      assignmentId: assignmentIds[selected.roleId],
      cycleId,
      assignmentKind: role.roleKind,
      roleId: selected.roleId,
      roleVersion: selected.roleVersion,
      objective: assignmentObjective(role.roleKind),
      analysisRubric: clone(role.analysisRubric),
      mandate: clone(role.mandate),
      analysisProfile: clone(role.analysisProfile),
      evidenceRequirements: clone(role.evidenceRequirements),
      resultRequirements: clone(role.resultRequirements),
      state: 'pending',
      dependsOn,
      dependencyPolicy: dependencyPolicy(role, dependsOn.length),
      inputArtifactIds: [...selected.inputArtifactIds],
      inputAbsences: clone(roleBinding.evidenceAbsences),
      intelligenceContext: {
        intelligencePlanId: plan.planId,
        snapshotId: snapshot.snapshotId,
        scopeId: snapshot.scopeId,
        domainId: snapshot.domainId,
        domainVersion: snapshot.domainVersion,
        sourceArtifactId: plan.sourceArtifactId,
        sourceArtifactIds: [...snapshot.sourceArtifactIds].sort(),
        evidenceRefIds: [...snapshot.evidenceRefIds].sort(),
        inputBundle: {
          bundleId: capture.bundle.bundleId,
          bundleArtifactId: capture.custodyIds.artifactId,
          bundleRawHash: capture.rawHash,
          bundleCanonicalHash: capture.canonicalHash,
          sourceArtifactIds: [...capture.bundle.sourceArtifactIds],
          issuedEvidence: clone(roleBinding.issuedEvidence),
        },
        decisionOwnerActorId: plan.decisionOwnerActorId,
      },
      outputContract: {
        schemaId: role.output.schemaId,
        schemaVersion: role.output.schemaVersion,
        mediaType: role.output.mediaType,
        encoding: 'utf-8',
        maxBytes: role.output.maxBytes,
      },
      capabilityGrantId: token('ceiling', {
        planId: plan.planId,
        roleId: selected.roleId,
        inputArtifactIds: selected.inputArtifactIds,
        outputContract: role.output,
      }, 24),
      attemptPolicy: { maxAttempts: 3, attempt: 0, timeoutMs: 300000 },
      claim: null,
      terminalOutcome: null,
      createdAt: plan.createdAt,
      availableAt: null,
      completedAt: null,
    };
    try {
      assertProtocolArtifact('operating-assignment', assignment, { protocolVersion: PROTOCOL_VERSION });
    } catch (cause) {
      fail('RESULT_CONTRACT_INVALID', 'The intelligence router produced an invalid Assignment intent.', {
        roleId: selected.roleId,
        cause: cause?.code ?? null,
      });
    }
    return assignment;
  });
}

/**
 * Build one immutable, explainable board plan and ordinary Assignment intents.
 * This function is pure: it cannot resolve a source, dispatch a role, call a
 * model or provider, grant authority, or persist state.
 */
export function planOperatingIntelligenceBoardV2(input = {}, { authorizeEvidence = () => true } = {}) {
  exactKeys(input, [
    'cycleId', 'delta', 'snapshot', 'operatingState', 'evidenceRefs', 'evidenceArtifacts',
    'focus', 'domainDescriptor', 'decisionOwnerActorId', 'createdAt',
  ], 'Intelligence routing input');
  if (typeof input.cycleId !== 'string' || input.cycleId.length === 0
    || typeof input.decisionOwnerActorId !== 'string' || input.decisionOwnerActorId.length === 0
    || typeof input.createdAt !== 'string' || Number.isNaN(Date.parse(input.createdAt))
    || !Array.isArray(input.evidenceRefs) || !Array.isArray(input.evidenceArtifacts)) {
    fail('RESULT_CONTRACT_INVALID', 'Intelligence routing requires a Cycle identity, explicit Decision owner, and timestamp.');
  }
  const focus = normalizedFocus(input.focus);
  const roles = roleIndex(input.domainDescriptor);
  const { snapshot, delta } = assertBoundInputs(input.snapshot, input.delta, input.domainDescriptor);
  const materiality = classifyOperatingDeltaMaterialityV2(delta);
  const challengerRequired = materiality.material || focus.some((entry) => CONSEQUENTIAL_FOCUS.has(entry));
  const scenarioRequested = focus.some((entry) => SCENARIO_FOCUS.has(entry))
    || delta.exposedRiskIds.length > 0
    || delta.invalidatedAssumptionIds.length > 0
    || delta.conflictingEvidenceRefIds.length > 0
    || delta.decisionRevisitIds.length > 0;
  const advisorRoles = [...roles.values()]
    .filter(({ roleKind }) => roleKind === 'advisor')
    .sort((left, right) => left.roleId.localeCompare(right.roleId));
  const { selectedAdvisorRoles, omittedAdvisorRoles } = resolveAdvisorSelection(advisorRoles, focus);
  const challengerRole = [...roles.values()].find(({ roleKind }) => roleKind === 'challenger');
  const chairRole = [...roles.values()].find(({ roleKind }) => roleKind === 'chair');
  const selectedAdvisorIds = selectedAdvisorRoles.map(({ roleId }) => roleId);
  const selectedRoleTopology = [
    ...selectedAdvisorRoles.map((role) => ({ role, dependsOnRoleIds: [] })),
    ...(challengerRequired ? [{ role: challengerRole, dependsOnRoleIds: [...selectedAdvisorIds] }] : []),
    {
      role: chairRole,
      dependsOnRoleIds: challengerRequired ? [...selectedAdvisorIds, challengerRole.roleId] : [...selectedAdvisorIds],
    },
  ];
  const evidenceSelections = new Map(selectedRoleTopology.map(({ role }) => [
    role.roleId,
    prepareOperatingIntelligenceEvidenceSelectionV2({
      snapshot,
      role,
      evidenceRefs: input.evidenceRefs,
      evidenceArtifacts: input.evidenceArtifacts,
      authorizeEvidence,
    }),
  ]));
  const routingIdentity = {
    cycleId: input.cycleId,
    snapshotId: snapshot.snapshotId,
    snapshotRuntimeHash: snapshot.runtimeHash,
    operatingStateRuntimeHash: input.operatingState?.runtimeHash ?? null,
    delta,
    focus,
    selectedRoles: selectedRoleTopology.map(({ role, dependsOnRoleIds }) => ({
      roleId: role.roleId,
      roleKind: role.roleKind,
      roleVersion: role.roleVersion,
      dependsOnRoleIds,
      analysisProfile: role.analysisProfile,
      evidenceRequirements: role.evidenceRequirements,
      resultRequirements: role.resultRequirements,
      evidenceSelection: evidenceSelections.get(role.roleId),
    })),
    domain: {
      domainId: input.domainDescriptor.domainId,
      domainVersion: input.domainDescriptor.domainVersion,
      domainContract: input.domainDescriptor.domainContract,
      roles: [...roles.values()].sort((left, right) => left.roleId.localeCompare(right.roleId)),
    },
    decisionOwnerActorId: input.decisionOwnerActorId,
    createdAt: input.createdAt,
  };
  const planId = token('ipl', routingIdentity);
  const assignmentIds = new Map(selectedRoleTopology.map(({ role }) => [
    role.roleId,
    deriveOperatingIntelligenceAssignmentIdV2(planId, role.roleId, role.roleVersion),
  ]));
  const cycleBinding = {
    cycleId: input.cycleId,
    scopeId: snapshot.scopeId,
    domainId: snapshot.domainId,
    domainVersion: snapshot.domainVersion,
  };
  const bundleCaptures = selectedRoleTopology.map(({ role }) => {
    const selection = evidenceSelections.get(role.roleId);
    const selectedEvidence = new Set(selection.issuedEvidence.map(({ requirementId, evidenceRefId }) => (
      `${requirementId}:${evidenceRefId}`
    )));
    const built = buildOperatingIntelligenceInputBundleV2({
      assignmentId: assignmentIds.get(role.roleId),
      cycle: cycleBinding,
      snapshot,
      delta,
      operatingState: input.operatingState,
      role,
      evidenceRefs: input.evidenceRefs,
      evidenceArtifacts: input.evidenceArtifacts,
      createdAt: input.createdAt,
      authorizeEvidence: ({ requirement, evidenceRef }) => (
        selectedEvidence.has(`${requirement.requirementId}:${evidenceRef.evidenceRefId}`)
      ),
      evidenceSelection: selection,
    });
    return Object.freeze({
      ...built,
      custodyIds: deriveOperatingIntelligenceBundleCustodyIdsV2(built.bundle),
    });
  });
  const bundleByRole = new Map(bundleCaptures.map((capture) => [
    capture.bundle.assignmentBinding.roleId,
    capture,
  ]));
  const advisorReason = materiality.material
    ? 'A validated material Delta requires bounded independent analysis.'
    : 'A validated no-material-change Delta still requires one bounded assessment before synthesis.';
  const selectedRoles = [
    ...selectedAdvisorRoles.map((role) => selectedRole(role, {
      inputArtifactIds: [
        bundleByRole.get(role.roleId).custodyIds.artifactId,
        ...bundleByRole.get(role.roleId).evidenceArtifactIds,
      ].sort(),
      dependsOnRoleIds: [],
      reason: advisorReason,
    })),
    ...(challengerRequired ? [selectedRole(challengerRole, {
      inputArtifactIds: [
        bundleByRole.get(challengerRole.roleId).custodyIds.artifactId,
        ...bundleByRole.get(challengerRole.roleId).evidenceArtifactIds,
      ].sort(),
      dependsOnRoleIds: [...selectedAdvisorIds],
      reason: 'Material change or consequential focus requires an independent challenge before synthesis.',
    })] : []),
    selectedRole(chairRole, {
      inputArtifactIds: [
        bundleByRole.get(chairRole.roleId).custodyIds.artifactId,
        ...bundleByRole.get(chairRole.roleId).evidenceArtifactIds,
      ].sort(),
      dependsOnRoleIds: challengerRequired ? [...selectedAdvisorIds, challengerRole.roleId] : [...selectedAdvisorIds],
      reason: 'A Chair is required to synthesize only validated inputs and recorded permitted absences.',
    }),
  ];
  const omittedRoles = [
    ...omittedAdvisorRoles.map((role) => ({
      roleId: role.roleId,
      roleKind: role.roleKind,
      roleVersion: role.roleVersion,
      reason: typedNotSelectedReason(),
    })),
    ...(challengerRequired ? [] : [{
      roleId: challengerRole.roleId,
      roleKind: challengerRole.roleKind,
      roleVersion: challengerRole.roleVersion,
      reason: `${OPERATING_INTELLIGENCE_NOT_SELECTED_ABSENCE}: No material change or consequential focus requires an independent challenge for this bounded cycle.`,
    }]),
  ];
  const plan = {
    kind: 'operating-intelligence-plan',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    planId,
    scopeId: snapshot.scopeId,
    domainId: snapshot.domainId,
    domainVersion: snapshot.domainVersion,
    snapshotId: snapshot.snapshotId,
    deltaId: delta.deltaId,
    selectedRoles,
    omittedRoles,
    challengerRequired,
    scenarioRequest: {
      requested: scenarioRequested,
      reason: scenarioRequested
        ? 'The bounded base, upside, and downside analysis is requested by focus or material risk, assumption, conflict, or revisit evidence.'
        : 'No focus or material Delta field requires bounded scenario analysis.',
    },
    sourceArtifactId: delta.sourceArtifactId,
    decisionOwnerActorId: input.decisionOwnerActorId,
    createdAt: input.createdAt,
  };
  try {
    assertOperateIntelligencePlanContractV2(plan);
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', 'The intelligence router produced an invalid intelligence plan.', {
      cause: cause?.code ?? null,
    });
  }
  const assignments = buildAssignments(plan, input.cycleId, roles, snapshot, bundleCaptures);
  validateOperatingIntelligenceAssignmentGraphV2(plan, assignments);
  return freeze({
    plan,
    assignments,
    bundleCaptures,
    routingHash: sha256Jcs({
      plan,
      assignments,
      bundles: bundleCaptures.map(({ bundle, rawHash, canonicalHash, custodyIds }) => ({
        bundleId: bundle.bundleId,
        assignmentId: bundle.assignmentBinding.assignmentId,
        rawHash,
        canonicalHash,
        artifactId: custodyIds.artifactId,
      })),
    }),
  });
}

export function assertOperatingIntelligencePlanV2(plan) {
  try {
    assertOperateIntelligencePlanContractV2(plan);
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', 'Operating intelligence plan is not contract-valid.', { cause: cause?.code ?? null });
  }
  const selected = new Set();
  for (const role of plan.selectedRoles) {
    if (selected.has(role.roleId)) fail('RESULT_CONTRACT_INVALID', 'An intelligence plan cannot select a role twice.', { roleId: role.roleId });
    selected.add(role.roleId);
    for (const dependency of role.dependsOnRoleIds) {
      if (dependency === role.roleId) fail('STATE_TRANSITION_INVALID', 'An intelligence role cannot depend on itself.', { roleId: role.roleId });
    }
  }
  const omitted = new Set();
  for (const role of plan.omittedRoles) {
    if (selected.has(role.roleId) || omitted.has(role.roleId)) {
      fail('RESULT_CONTRACT_INVALID', 'Selected and omitted intelligence roles must be disjoint and unique.', { roleId: role.roleId });
    }
    if (typeof role.reason !== 'string' || !role.reason.startsWith(`${OPERATING_INTELLIGENCE_NOT_SELECTED_ABSENCE}:`)) {
      fail('RESULT_CONTRACT_INVALID', 'Omitted intelligence roles must declare a typed absence reason.', {
        roleId: role.roleId,
        reason: role.reason ?? null,
      });
    }
    omitted.add(role.roleId);
  }
  const selectedByKind = (kind) => plan.selectedRoles.filter(({ roleKind }) => roleKind === kind);
  const omittedByKind = (kind) => plan.omittedRoles.filter(({ roleKind }) => roleKind === kind);
  if (selectedByKind('advisor').length < 1 || selectedByKind('chair').length !== 1
    || (plan.challengerRequired && selectedByKind('challenger').length !== 1)
    || (!plan.challengerRequired && (selectedByKind('challenger').length !== 0 || omittedByKind('challenger').length !== 1))) {
    fail('STATE_TRANSITION_INVALID', 'An intelligence plan must explain its minimum advisor/challenger/chair board.');
  }
  for (const role of plan.selectedRoles) {
    if (role.dependsOnRoleIds.some((roleId) => !selected.has(roleId))) {
      fail('STATE_TRANSITION_INVALID', 'An intelligence plan role depends on an unselected role.', { roleId: role.roleId });
    }
  }
  return freeze(clone(plan));
}
