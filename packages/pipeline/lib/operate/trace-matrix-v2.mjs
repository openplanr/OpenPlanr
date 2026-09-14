import { PipelineError } from '../protocol/errors.mjs';
import { assertProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/canonical-json.mjs';
import { deriveOperatingMaterializedClaimIdV2 } from './intelligence-output-identities-v2.mjs';
import { deriveOperatingIntelligenceAssignmentIdV2 } from './scheduler-v2.mjs';

const PROTOCOL_VERSION = '2.0.0';
const MAX_NODES = 8192;
const MAX_EDGES = 32768;
const TERMINAL_ASSIGNMENTS = new Set(['validated', 'rejected', 'abandoned', 'failed']);
const ACCESS_ORDER = Object.freeze(['public', 'internal', 'confidential', 'restricted']);
const KIND_RANK = Object.freeze({
  absence: 0,
  requirement: 1,
  seat: 2,
  assignment: 3,
  artifact: 4,
  claim: 5,
  'evidence-ref': 6,
  finding: 7,
  decision: 8,
  action: 9,
  disposition: 10,
  verification: 11,
  outcome: 12,
});
const CONTRACT_BY_KIND = Object.freeze({
  requirement: 'operating-assignment',
  absence: 'operating-assignment',
  seat: 'operating-intelligence-plan',
  assignment: 'operating-assignment',
  artifact: 'operating-artifact',
  claim: 'operating-claim',
  'evidence-ref': 'operating-evidence-ref',
  finding: 'operating-finding',
  decision: 'operating-decision',
  action: 'operating-action',
  disposition: 'operating-decision-ledger',
  verification: 'operating-action-verification-plan',
  outcome: 'operating-outcome',
});
const ALLOWED_CONTRACTS_BY_KIND = Object.freeze(Object.fromEntries(
  Object.entries(CONTRACT_BY_KIND).map(([kind, contractId]) => [kind, new Set(
    kind === 'absence' ? [contractId, 'operating-intelligence-plan'] : [contractId],
  )]),
));
const ALLOWED_EDGE_PAIRS = Object.freeze({
  declares: new Set(['absence>requirement']),
  'assigned-to': new Set(['requirement>seat']),
  'issued-as': new Set(['seat>assignment']),
  records: new Set(['absence>seat', 'absence>assignment']),
  produces: new Set(['assignment>artifact']),
  contains: new Set(['artifact>claim']),
  'supported-by': new Set(['claim>evidence-ref']),
  'contradicted-by': new Set(['claim>evidence-ref']),
  informs: new Set(['claim>finding', 'claim>decision', 'evidence-ref>finding', 'evidence-ref>decision']),
  challenges: new Set(['finding>decision']),
  decides: new Set(['artifact>decision']),
  proposes: new Set(['decision>action']),
  disposes: new Set(['artifact>disposition', 'finding>disposition', 'decision>disposition']),
  'governed-by': new Set(['action>verification']),
  'verified-by': new Set(['action>outcome']),
  'observed-as': new Set(['verification>outcome']),
});

function fail(code, message, context = {}) {
  throw new PipelineError(code, message, '', { retryable: false, context });
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

function without(value, field) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}

function shortIdentity(prefix, value) {
  return `${prefix}_${sha256Jcs(value).slice(7, 39)}`;
}

function locatorKey(locator) {
  return `${locator.kind}:${locator.id}`;
}

function endpointKey(endpoint) {
  return `${endpoint.kind}:${endpoint.id}`;
}

function sameScope(record, cycle) {
  return record?.scopeId === cycle.scopeId
    && record?.domainId === cycle.domainId
    && record?.domainVersion === cycle.domainVersion;
}

function validateEventHead(eventHead) {
  if (!eventHead || !Number.isSafeInteger(eventHead.sequence) || eventHead.sequence < 0
    || (eventHead.sequence === 0 ? eventHead.hash !== null : !/^sha256:[a-f0-9]{64}$/u.test(eventHead.hash ?? ''))) {
    fail('E_OPERATE_TRACE_BINDING_INVALID', 'Trace matrix requires one exact canonical Event head.');
  }
}

function assignmentProofState(state) {
  if (!TERMINAL_ASSIGNMENTS.has(state)) return 'pending';
  if (state === 'validated') return 'terminal';
  return state;
}

function acceptedArtifactForAssignment({ assignment, artifacts, submissions }) {
  const accepted = submissions.filter((submission) => (
    submission.assignmentId === assignment.assignmentId
    && submission.cycleId === assignment.cycleId
    && submission.state === 'accepted'
    && typeof submission.artifactId === 'string'
  ));
  if (accepted.length > 1) {
    fail('E_OPERATE_TRACE_GRAPH_INVALID', 'An Assignment has more than one accepted Artifact identity.', {
      assignmentId: assignment.assignmentId,
    });
  }
  if (accepted.length === 0) return null;
  const [submission] = accepted;
  const artifact = artifacts.get(submission.artifactId);
  if (!artifact
    || artifact.assignmentId !== assignment.assignmentId
    || artifact.cycleId !== assignment.cycleId
    || artifact.rawHash !== submission.rawHash
    || artifact.canonicalHash !== submission.canonicalHash
    || artifact.sizeBytes !== submission.sizeBytes
    || artifact.schemaId !== assignment.outputContract.schemaId
    || artifact.artifactSchemaVersion !== assignment.outputContract.schemaVersion
    || artifact.mediaType !== assignment.outputContract.mediaType
    || artifact.encoding !== assignment.outputContract.encoding
    || artifact.sizeBytes > assignment.outputContract.maxBytes
    || sha256Jcs(artifact.inputArtifactIds) !== sha256Jcs(assignment.inputArtifactIds)) {
    fail('E_OPERATE_TRACE_DANGLING', 'Accepted Submission does not retain its exact Artifact identity.', {
      assignmentId: assignment.assignmentId,
      artifactId: submission.artifactId,
    });
  }
  if (assignment.state !== 'validated') {
    fail('E_OPERATE_TRACE_GRAPH_INVALID', 'Only a validated Assignment may contribute an accepted Artifact node.', {
      assignmentId: assignment.assignmentId,
      state: assignment.state,
    });
  }
  return artifact;
}

function resolvePlan(state, cycle, assignments, planId) {
  const candidates = (state.intelligencePlans ?? []).filter((plan) => (
    sameScope(plan, cycle)
    && (planId === undefined || plan.planId === planId)
    && plan.selectedRoles.some(({ roleId, roleVersion }) => assignments.has(
      deriveOperatingIntelligenceAssignmentIdV2(plan.planId, roleId, roleVersion),
    ))
  ));
  if (planId !== undefined && candidates.length !== 1) {
    fail('E_OPERATE_TRACE_BINDING_INVALID', 'Trace matrix cannot resolve the requested intelligence plan exactly.', {
      cycleId: cycle.cycleId,
      planId,
      matchCount: candidates.length,
    });
  }
  if (planId === undefined && candidates.length > 1) {
    fail('E_OPERATE_TRACE_BINDING_INVALID', 'Trace matrix requires an explicit plan when multiple Cycle plans exist.', {
      cycleId: cycle.cycleId,
      matchCount: candidates.length,
    });
  }
  return candidates[0] ?? null;
}

function snapshotDescendsFrom(snapshot, ancestorId, snapshots) {
  const visited = new Set();
  let cursor = snapshot;
  while (cursor) {
    if (cursor.snapshotId === ancestorId) return true;
    if (visited.has(cursor.snapshotId)) {
      fail('E_OPERATE_TRACE_CYCLE', 'Operating Snapshot lineage contains a cycle.', {
        snapshotId: snapshot.snapshotId,
      });
    }
    visited.add(cursor.snapshotId);
    cursor = cursor.previousSnapshotId === null ? null : snapshots.get(cursor.previousSnapshotId);
  }
  return false;
}

function currentPlanMetricBinding(state, cycle, plan, artifacts, acceptedArtifactByAssignment, metricId) {
  if (!plan) {
    fail('E_OPERATE_TRACE_DANGLING', 'Action verification proof requires one exact intelligence plan.');
  }
  const snapshots = new Map((state.operatingSnapshots ?? []).map((record) => [record.snapshotId, record]));
  const modelStates = new Map((state.operatingModelStates ?? []).map((record) => [record.stateId, record]));
  const candidates = [...snapshots.values()].filter((snapshot) => (
    sameScope(snapshot, cycle)
    && snapshotDescendsFrom(snapshot, plan.snapshotId, snapshots)
  ));
  const candidateIds = new Set(candidates.map(({ snapshotId }) => snapshotId));
  const leaves = candidates.filter(({ snapshotId }) => !candidates.some((entry) => (
    entry.previousSnapshotId === snapshotId && candidateIds.has(entry.snapshotId)
  )));
  if (leaves.length !== 1) {
    fail('E_OPERATE_TRACE_DANGLING', 'Action verification proof requires one exact current Snapshot on the plan lineage.', {
      planId: plan.planId,
      metricId,
      leafCount: leaves.length,
    });
  }
  const [snapshot] = leaves;
  const operatingState = modelStates.get(snapshot.stateId);
  const metricMatches = operatingState?.metrics?.filter((metric) => metric.metricId === metricId) ?? [];
  const metric = metricMatches[0];
  const sourceArtifact = metric ? artifacts.get(metric.sourceArtifactId) : null;
  if (!operatingState
    || operatingState.snapshotId !== snapshot.snapshotId
    || !sameScope(operatingState, cycle)
    || metricMatches.length !== 1
    || !sameScope(metric, cycle)
    || !sourceArtifact
    || sourceArtifact.cycleId !== cycle.cycleId
    || acceptedArtifactByAssignment.get(sourceArtifact.assignmentId)?.artifactId !== sourceArtifact.artifactId
    || !snapshot.sourceArtifactIds.includes(metric.sourceArtifactId)
    || metric.evidenceRefIds.some((id) => !snapshot.evidenceRefIds.includes(id))) {
    fail('E_OPERATE_TRACE_DANGLING', 'Current plan Metric lost its exact Snapshot, state, source Artifact, or Evidence binding.', {
      planId: plan.planId,
      metricId,
      snapshotId: snapshot.snapshotId,
    });
  }
  return { snapshot, operatingState, metric, snapshots, modelStates };
}

function stableMetricValue(metric) {
  return Object.fromEntries(Object.entries(metric).filter(([field]) => ![
    'observationIds', 'freshness', 'updatedAt',
  ].includes(field)));
}

function proofCounts(nodes) {
  const count = (kind, states) => nodes.filter(({ locator, proofState }) => (
    locator.kind === kind && states.includes(proofState)
  )).length;
  return {
    terminalAssignments: count('assignment', ['terminal', 'rejected', 'abandoned', 'failed']),
    acceptedArtifacts: count('artifact', ['accepted']),
    verifiedEvidence: count('evidence-ref', ['verified']),
    staleEvidence: count('evidence-ref', ['stale']),
    supportedClaims: count('claim', ['supported']),
    contradictedClaims: count('claim', ['contradicted', 'contested']),
    unverifiedClaims: count('claim', ['unverified']),
    restrictedNodes: nodes.filter(({ accessState }) => accessState === 'restricted').length,
    typedAbsences: count('absence', ['absent']),
    verifiedActions: count('action', ['completed']),
  };
}

function requireExactRecordScope(record, cycle, subject, id) {
  if (!sameScope(record, cycle)) {
    fail('E_OPERATE_TRACE_FOREIGN_SCOPE', `${subject} crosses the trace Cycle scope boundary.`, {
      cycleId: cycle.cycleId,
      subjectId: id,
    });
  }
}

/**
 * Build one bounded, access-safe trace matrix from already validated runtime
 * state. This function reads no Artifact bytes and performs no Store mutation.
 */
export function buildOperatingTraceMatrixV2(state, {
  cycleId,
  planId = undefined,
  accessLevel = 'restricted',
  eventHead = state?.eventHead,
} = {}) {
  assertProtocolArtifact('operating-runtime-state', state, { protocolVersion: PROTOCOL_VERSION });
  validateEventHead(eventHead);
  if (eventHead.sequence !== state.eventHead.sequence || eventHead.hash !== state.eventHead.hash) {
    fail('E_OPERATE_TRACE_BINDING_INVALID', 'Trace matrix Event head must equal the exact input runtime-state head.');
  }
  if (!ACCESS_ORDER.includes(accessLevel)) {
    fail('E_OPERATE_TRACE_ACCESS_INVALID', 'Trace matrix access level is not recognized.');
  }
  const cycleMatches = state.cycles.filter((entry) => entry.cycleId === cycleId);
  if (cycleMatches.length !== 1) {
    fail('E_OPERATE_TRACE_BINDING_INVALID', 'Trace matrix requires one exact Cycle.', { cycleId, matchCount: cycleMatches.length });
  }
  const [cycle] = cycleMatches;
  const scope = {
    scopeId: cycle.scopeId,
    domainId: cycle.domainId,
    domainVersion: cycle.domainVersion,
    cycleId: cycle.cycleId,
  };
  const cycleAssignments = state.assignments.filter((entry) => entry.cycleId === cycle.cycleId);
  const assignments = new Map(cycleAssignments.map((entry) => [entry.assignmentId, entry]));
  const artifacts = new Map(state.artifacts.map((entry) => [entry.artifactId, entry]));
  const submissions = state.submissions.filter((entry) => entry.cycleId === cycle.cycleId);
  const plan = resolvePlan(state, cycle, assignments, planId);
  const nodes = new Map();
  const rawEdges = new Map();
  const typedAbsences = new Map();
  const requirementNodeIds = new Map();

  const addNode = (
    kind,
    id,
    proofState = 'not-applicable',
    accessState = 'available',
    contractId = CONTRACT_BY_KIND[kind],
  ) => {
    const locator = {
      kind,
      id,
      contract: { id: contractId, version: PROTOCOL_VERSION },
      ...scope,
    };
    const key = locatorKey(locator);
    const existing = nodes.get(key);
    if (existing) {
      if (existing.proofState !== proofState
        || existing.accessState !== accessState
        || existing.locator.contract.id !== contractId) {
        fail('E_OPERATE_TRACE_DUPLICATE', 'A trace node identity has divergent proof or access truth.', { kind, id });
      }
      return existing;
    }
    if (nodes.size >= MAX_NODES) {
      fail('E_OPERATE_TRACE_LIMIT_EXCEEDED', 'Trace matrix node limit exceeded.', { maxNodes: MAX_NODES });
    }
    const node = { locator, accessState, proofState, inboundEdgeIds: [], outboundEdgeIds: [] };
    nodes.set(key, node);
    return node;
  };

  const addEdge = (relation, fromKind, fromId, toKind, toId) => {
    const from = { kind: fromKind, id: fromId };
    const to = { kind: toKind, id: toId };
    const pair = `${fromKind}>${toKind}`;
    if (!ALLOWED_EDGE_PAIRS[relation]?.has(pair)) {
      fail('E_OPERATE_TRACE_EDGE_INVALID', 'Trace edge relation does not permit its endpoint kinds.', { relation, pair });
    }
    if (KIND_RANK[fromKind] >= KIND_RANK[toKind]) {
      fail('E_OPERATE_TRACE_CYCLE', 'Trace edge would violate the forward lifecycle order.', { relation, pair });
    }
    if (!nodes.has(endpointKey(from)) || !nodes.has(endpointKey(to))) {
      fail('E_OPERATE_TRACE_DANGLING', 'Trace edge references an unavailable endpoint.', { relation, from, to });
    }
    const identity = { relation, from, to };
    const edgeId = shortIdentity('tre', identity);
    const existing = rawEdges.get(edgeId);
    if (existing && sha256Jcs(existing) !== sha256Jcs({ edgeId, ...identity })) {
      fail('E_OPERATE_TRACE_DUPLICATE', 'Trace edge identity collision has divergent content.', { edgeId });
    }
    rawEdges.set(edgeId, { edgeId, ...identity });
  };

  const acceptedArtifactByAssignment = new Map();
  for (const assignment of cycleAssignments) {
    addNode('assignment', assignment.assignmentId, assignmentProofState(assignment.state));
    const artifact = acceptedArtifactForAssignment({ assignment, artifacts, submissions });
    if (artifact) {
      requireExactRecordScope(artifact, cycle, 'Artifact', artifact.artifactId);
      const accessState = ACCESS_ORDER.indexOf(artifact.sensitivity) <= ACCESS_ORDER.indexOf(accessLevel)
        ? 'available'
        : 'restricted';
      addNode('artifact', artifact.artifactId, accessState === 'available' ? 'accepted' : 'restricted', accessState);
      acceptedArtifactByAssignment.set(assignment.assignmentId, artifact);
    }
    for (const [requirementKind, requirements] of [
      ['evidence', assignment.evidenceRequirements ?? []],
      ['result', assignment.resultRequirements ?? []],
    ]) {
      for (const requirement of requirements) {
        const nodeId = `${requirementKind}:${assignment.assignmentId}:${requirement.requirementId}`;
        addNode('requirement', nodeId, 'pending');
        const candidates = requirementNodeIds.get(requirement.requirementId) ?? [];
        candidates.push(nodeId);
        requirementNodeIds.set(requirement.requirementId, candidates);
      }
    }
    for (const absence of assignment.inputAbsences ?? []) {
      const absenceId = absence.absenceId ?? `absence:${assignment.assignmentId}:${absence.roleId ?? absence.requirementId}`;
      addNode('absence', absenceId, 'absent', 'absent');
      typedAbsences.set(absenceId, 'OPERATE_TRACE_TYPED_ABSENCE');
    }
  }

  const seatByRole = new Map();
  if (plan) {
    for (const [role, omitted] of [
      ...plan.selectedRoles.map((entry) => [entry, false]),
      ...plan.omittedRoles.map((entry) => [entry, true]),
    ]) {
      const seatId = `seat:${plan.planId}:${role.roleId}@${role.roleVersion}`;
      addNode('seat', seatId, omitted ? 'absent' : 'not-applicable', omitted ? 'absent' : 'available');
      seatByRole.set(role.roleId, seatId);
      if (omitted) {
        const absenceId = deriveOperatingOmittedRoleAbsenceIdV2(plan.planId, role.roleId, role.roleVersion);
        addNode('absence', absenceId, 'absent', 'absent', 'operating-intelligence-plan');
        typedAbsences.set(absenceId, 'OPERATE_TRACE_ROLE_NOT_SELECTED');
        addEdge('records', 'absence', absenceId, 'seat', seatId);
      }
      if (!omitted) {
        const assignmentId = deriveOperatingIntelligenceAssignmentIdV2(plan.planId, role.roleId, role.roleVersion);
        if (!assignments.has(assignmentId)) {
          fail('E_OPERATE_TRACE_DANGLING', 'Selected board seat has no exact issued Assignment.', { planId: plan.planId, roleId: role.roleId });
        }
      }
    }
  }

  for (const assignment of cycleAssignments) {
    const seatId = seatByRole.get(assignment.roleId);
    if (seatId) addEdge('issued-as', 'seat', seatId, 'assignment', assignment.assignmentId);
    for (const requirement of assignment.evidenceRequirements ?? []) {
      const requirementNodeId = `evidence:${assignment.assignmentId}:${requirement.requirementId}`;
      if (seatId) addEdge('assigned-to', 'requirement', requirementNodeId, 'seat', seatId);
    }
    for (const requirement of assignment.resultRequirements ?? []) {
      const requirementNodeId = `result:${assignment.assignmentId}:${requirement.requirementId}`;
      if (seatId) addEdge('assigned-to', 'requirement', requirementNodeId, 'seat', seatId);
    }
    for (const absence of assignment.inputAbsences ?? []) {
      const absenceId = absence.absenceId ?? `absence:${assignment.assignmentId}:${absence.roleId ?? absence.requirementId}`;
      addEdge('records', 'absence', absenceId, 'assignment', assignment.assignmentId);
      if (absence.kind === 'role' && seatByRole.has(absence.roleId)) {
        addEdge('records', 'absence', absenceId, 'seat', seatByRole.get(absence.roleId));
      }
      if (absence.kind === 'evidence') {
        const localRequirementNodeId = `evidence:${assignment.assignmentId}:${absence.requirementId}`;
        const candidates = nodes.has(`requirement:${localRequirementNodeId}`)
          ? [localRequirementNodeId]
          : requirementNodeIds.get(absence.requirementId) ?? [];
        if (candidates.length !== 1) {
          fail('E_OPERATE_TRACE_DANGLING', 'Evidence absence does not resolve one exact declared Cycle requirement.', {
            assignmentId: assignment.assignmentId,
            requirementId: absence.requirementId,
            matchCount: candidates.length,
          });
        }
        addEdge('declares', 'absence', absenceId, 'requirement', candidates[0]);
      }
    }
    const artifact = acceptedArtifactByAssignment.get(assignment.assignmentId);
    if (artifact) addEdge('produces', 'assignment', assignment.assignmentId, 'artifact', artifact.artifactId);
  }

  const evidence = new Map();
  for (const record of state.evidenceRefs ?? []) {
    const sourceArtifact = artifacts.get(record.sourceArtifactId);
    const evidenceArtifact = artifacts.get(record.evidenceArtifactId);
    if (!sourceArtifact || sourceArtifact.cycleId !== cycle.cycleId) continue;
    requireExactRecordScope(record, cycle, 'EvidenceRef', record.evidenceRefId);
    const sourceAssignment = sourceArtifact === undefined
      ? undefined
      : assignments.get(sourceArtifact.assignmentId);
    const sourceSubmission = sourceArtifact === undefined
      ? undefined
      : submissions.find((entry) => (
        entry.assignmentId === sourceArtifact.assignmentId
        && entry.artifactId === sourceArtifact.artifactId
        && entry.state === 'accepted'
        && entry.rawHash === sourceArtifact.rawHash
        && entry.canonicalHash === sourceArtifact.canonicalHash
      ));
    if (!sourceAssignment || sourceAssignment.state !== 'validated' || !sourceSubmission) {
      fail('E_OPERATE_TRACE_DANGLING', 'EvidenceRef source is not one exact accepted Artifact.', {
        evidenceRefId: record.evidenceRefId,
        sourceArtifactId: record.sourceArtifactId,
      });
    }
    if (!evidenceArtifact
      || evidenceArtifact.artifactType !== 'evidence-snapshot'
      || evidenceArtifact.schemaId !== 'operating-evidence-snapshot'
      || !evidenceArtifact.inputArtifactIds.includes(record.sourceArtifactId)
      || evidenceArtifact.assignmentId !== sourceArtifact.assignmentId
      || evidenceArtifact.cycleId !== sourceArtifact.cycleId
      || evidenceArtifact.cycleId !== cycle.cycleId
      || record.evidenceArtifactRawHash !== evidenceArtifact.rawHash
      || record.evidenceArtifactCanonicalHash !== evidenceArtifact.canonicalHash
      || record.classification !== evidenceArtifact.sensitivity
      || !sameScope(evidenceArtifact, cycle)) {
      fail('E_OPERATE_TRACE_DANGLING', 'EvidenceRef lost its exact evidence Artifact identity.', { evidenceRefId: record.evidenceRefId });
    }
    const resolutions = (state.evidenceResolutions ?? []).filter((entry) => (
      entry.candidateId === record.candidateId
      && entry.outcome === 'resolved'
      && entry.evidenceRefId === record.evidenceRefId
      && entry.evidenceArtifactId === record.evidenceArtifactId
    ));
    const candidateResolutions = (state.evidenceResolutions ?? []).filter((entry) => (
      entry.candidateId === record.candidateId
    ));
    if (candidateResolutions.length !== 1 || resolutions.length !== 1) {
      fail('E_OPERATE_TRACE_DANGLING', 'EvidenceRef requires one exact resolved evidence outcome.', {
        evidenceRefId: record.evidenceRefId,
        candidateResolutionCount: candidateResolutions.length,
        resolutionCount: resolutions.length,
      });
    }
    const [resolution] = resolutions;
    if (!sameScope(resolution, cycle)
      || resolution.sourceArtifactId !== record.sourceArtifactId
      || resolution.evidenceKind !== record.evidenceKind
      || sha256Jcs(resolution.sourceContract) !== sha256Jcs(record.sourceContract)
      || sha256Jcs(resolution.provider) !== sha256Jcs(record.provider)
      || sha256Jcs(resolution.resolver) !== sha256Jcs(record.resolver)) {
      fail('E_OPERATE_TRACE_FOREIGN_SCOPE', 'Evidence resolution lost its exact EvidenceRef source and resolver binding.', {
        evidenceRefId: record.evidenceRefId,
        resolutionId: resolution.resolutionId,
      });
    }
    const available = ACCESS_ORDER.indexOf(record.classification) <= ACCESS_ORDER.indexOf(accessLevel);
    const proofState = !available ? 'restricted'
      : record.freshness === 'stale' ? 'stale'
        : ['current', 'historical'].includes(record.freshness) ? 'verified'
          : 'unverified';
    addNode('evidence-ref', record.evidenceRefId, proofState, available ? 'available' : 'restricted');
    evidence.set(record.evidenceRefId, record);
  }

  for (const assignment of cycleAssignments) {
    for (const issued of assignment.intelligenceContext?.inputBundle?.issuedEvidence ?? []) {
      const requirementNodeId = `evidence:${assignment.assignmentId}:${issued.requirementId}`;
      if (!nodes.has(`requirement:${requirementNodeId}`) || !evidence.has(issued.evidenceRefId)) {
        fail('E_OPERATE_TRACE_DANGLING', 'Issued evidence does not resolve its exact requirement and EvidenceRef.', {
          assignmentId: assignment.assignmentId,
          requirementId: issued.requirementId,
          evidenceRefId: issued.evidenceRefId,
        });
      }
      // The requirement-to-evidence path is represented through its Assignment
      // and accepted result; direct requirement-to-evidence is intentionally
      // excluded from the closed lifecycle relation vocabulary.
    }
  }

  const cycleClaims = (state.claims ?? []).filter((record) => {
    const sourceArtifact = artifacts.get(record.sourceArtifactId);
    return sourceArtifact?.cycleId === cycle.cycleId;
  });
  const claimById = new Map();
  for (const claim of cycleClaims) {
    requireExactRecordScope(claim, cycle, 'Claim', claim.claimId);
    const sourceArtifact = artifacts.get(claim.sourceArtifactId);
    if (!sourceArtifact) fail('E_OPERATE_TRACE_DANGLING', 'Claim references an unavailable source Artifact.', { claimId: claim.claimId });
    const sourceAvailable = ACCESS_ORDER.indexOf(sourceArtifact.sensitivity) <= ACCESS_ORDER.indexOf(accessLevel);
    const support = claim.supportingEvidenceRefIds.map((id) => {
      const node = nodes.get(`evidence-ref:${id}`);
      if (!node) fail('E_OPERATE_TRACE_DANGLING', 'Claim references an unavailable supporting EvidenceRef.', { claimId: claim.claimId, evidenceRefId: id });
      return node;
    });
    const contradiction = claim.contradictingEvidenceRefIds.map((id) => {
      const node = nodes.get(`evidence-ref:${id}`);
      if (!node) fail('E_OPERATE_TRACE_DANGLING', 'Claim references an unavailable contradicting EvidenceRef.', { claimId: claim.claimId, evidenceRefId: id });
      return node;
    });
    const verifiedSupport = support.filter(({ proofState }) => proofState === 'verified').length;
    const verifiedContradiction = contradiction.filter(({ proofState }) => proofState === 'verified').length;
    const proofState = !sourceAvailable ? 'restricted'
      : verifiedSupport > 0 && verifiedContradiction > 0 ? 'contested'
        : verifiedContradiction > 0 ? 'contradicted'
          : verifiedSupport > 0 ? 'supported'
            : 'unverified';
    addNode('claim', claim.claimId, proofState, sourceAvailable ? 'available' : 'restricted');
    claimById.set(claim.claimId, claim);
    if (!acceptedArtifactByAssignment.has(sourceArtifact.assignmentId)) {
      fail('E_OPERATE_TRACE_DANGLING', 'Claim source is not one exact accepted Artifact.', { claimId: claim.claimId, artifactId: sourceArtifact.artifactId });
    }
    addEdge('contains', 'artifact', sourceArtifact.artifactId, 'claim', claim.claimId);
    for (const id of claim.supportingEvidenceRefIds) addEdge('supported-by', 'claim', claim.claimId, 'evidence-ref', id);
    for (const id of claim.contradictingEvidenceRefIds) addEdge('contradicted-by', 'claim', claim.claimId, 'evidence-ref', id);
  }

  const cycleFindings = (state.findings ?? []).filter((record) => record.sourceCycleId === cycle.cycleId);
  const findings = new Map();
  for (const finding of cycleFindings) {
    requireExactRecordScope(finding, cycle, 'Finding', finding.findingId);
    const sourceArtifact = artifacts.get(finding.sourceArtifactId);
    if (!sourceArtifact) fail('E_OPERATE_TRACE_DANGLING', 'Finding references an unavailable source Artifact.', { findingId: finding.findingId });
    const available = ACCESS_ORDER.indexOf(sourceArtifact.sensitivity) <= ACCESS_ORDER.indexOf(accessLevel);
    addNode('finding', finding.findingId, available ? 'proposed' : 'restricted', available ? 'available' : 'restricted');
    findings.set(finding.findingId, finding);
    for (const id of finding.supportingEvidenceRefIds ?? []) {
      if (!evidence.has(id)) fail('E_OPERATE_TRACE_DANGLING', 'Finding references unavailable supporting evidence.', { findingId: finding.findingId, evidenceRefId: id });
      addEdge('informs', 'evidence-ref', id, 'finding', finding.findingId);
    }
    for (const id of finding.contradictingEvidenceRefIds ?? []) {
      if (!evidence.has(id)) fail('E_OPERATE_TRACE_DANGLING', 'Finding references unavailable contradicting evidence.', { findingId: finding.findingId, evidenceRefId: id });
      addEdge('informs', 'evidence-ref', id, 'finding', finding.findingId);
    }
    for (const target of finding.targets ?? []) {
      for (const localClaimId of target.claimIds ?? []) {
        const claimId = deriveOperatingMaterializedClaimIdV2(target.advisorArtifactId, localClaimId);
        if (!claimById.has(claimId)) fail('E_OPERATE_TRACE_DANGLING', 'Finding target does not resolve one durable Claim.', { findingId: finding.findingId, claimId });
        addEdge('informs', 'claim', claimId, 'finding', finding.findingId);
      }
    }
  }

  const cycleDecisions = (state.decisions ?? []).filter((record) => record.sourceCycleId === cycle.cycleId);
  const decisions = new Map();
  for (const decision of cycleDecisions) {
    requireExactRecordScope(decision, cycle, 'Decision', decision.decisionId);
    const sourceArtifact = artifacts.get(decision.sourceArtifactId);
    if (!sourceArtifact) fail('E_OPERATE_TRACE_DANGLING', 'Decision references an unavailable source Artifact.', { decisionId: decision.decisionId });
    const available = ACCESS_ORDER.indexOf(sourceArtifact.sensitivity) <= ACCESS_ORDER.indexOf(accessLevel);
    addNode('decision', decision.decisionId, available ? (decision.state === 'approved' ? 'governed' : 'proposed') : 'restricted', available ? 'available' : 'restricted');
    decisions.set(decision.decisionId, decision);
    if (!nodes.has(`artifact:${sourceArtifact.artifactId}`)) {
      fail('E_OPERATE_TRACE_DANGLING', 'Decision source is not one exact accepted Artifact.', { decisionId: decision.decisionId, artifactId: sourceArtifact.artifactId });
    }
    addEdge('decides', 'artifact', sourceArtifact.artifactId, 'decision', decision.decisionId);
    for (const claimId of decision.claimIds ?? []) {
      if (!claimById.has(claimId)) fail('E_OPERATE_TRACE_DANGLING', 'Decision references an unavailable Claim.', { decisionId: decision.decisionId, claimId });
      addEdge('informs', 'claim', claimId, 'decision', decision.decisionId);
    }
    for (const findingId of decision.findingIds ?? []) {
      if (!findings.has(findingId)) fail('E_OPERATE_TRACE_DANGLING', 'Decision references an unavailable Finding.', { decisionId: decision.decisionId, findingId });
      addEdge('challenges', 'finding', findingId, 'decision', decision.decisionId);
    }
    for (const evidenceRefId of decision.evidenceRefIds ?? []) {
      if (!evidence.has(evidenceRefId)) fail('E_OPERATE_TRACE_DANGLING', 'Decision references unavailable EvidenceRef.', { decisionId: decision.decisionId, evidenceRefId });
      addEdge('informs', 'evidence-ref', evidenceRefId, 'decision', decision.decisionId);
    }
  }

  const actions = new Map();
  for (const action of (state.actions ?? []).filter((record) => record.sourceCycleId === cycle.cycleId)) {
    requireExactRecordScope(action, cycle, 'Action', action.actionId);
    if (!decisions.has(action.sourceDecisionId)) {
      fail('E_OPERATE_TRACE_DANGLING', 'Action references an unavailable source Decision.', { actionId: action.actionId, decisionId: action.sourceDecisionId });
    }
    // Lifecycle completion is not proof completion. A completed Action only
    // becomes verified below when one Outcome carries observations and current,
    // accessible Evidence. Until then the trace must retain the proof gap.
    addNode('action', action.actionId, action.state === 'proposed' ? 'proposed'
      : action.state === 'completed' ? 'insufficient'
        : 'governed');
    actions.set(action.actionId, action);
    addEdge('proposes', 'decision', action.sourceDecisionId, 'action', action.actionId);
  }

  const verificationPlans = new Map();
  for (const verification of state.verificationPlans ?? []) {
    const action = actions.get(verification.actionId);
    if (!action) continue;
    requireExactRecordScope(verification, cycle, 'Verification plan', verification.verificationPlanId);
    if (action.verificationPlanId !== verification.verificationPlanId) {
      fail('E_OPERATE_TRACE_DANGLING', 'Action lost its exact verification plan binding.', { actionId: action.actionId });
    }
    addNode('verification', verification.verificationPlanId, 'governed');
    verificationPlans.set(verification.verificationPlanId, verification);
    addEdge('governed-by', 'action', action.actionId, 'verification', verification.verificationPlanId);
  }

  const observations = new Map((state.metricObservations ?? []).map((record) => [record.observationId, record]));
  const latestOutcomeProof = new Map();
  for (const outcome of state.outcomes ?? []) {
    const action = actions.get(outcome.actionId);
    if (!action) continue;
    requireExactRecordScope(outcome, cycle, 'Outcome', outcome.outcomeId);
    const verification = verificationPlans.get(outcome.verificationPlanId);
    if (!verification) fail('E_OPERATE_TRACE_DANGLING', 'Outcome references an unavailable verification plan.', { outcomeId: outcome.outcomeId });
    const current = currentPlanMetricBinding(
      state,
      cycle,
      plan,
      artifacts,
      acceptedArtifactByAssignment,
      verification.metricId,
    );
    const { metric } = current;
    if (action.verificationPlanId !== verification.verificationPlanId
      || action.metricId !== verification.metricId
      || action.baseline !== verification.baseline
      || action.target !== verification.target
      || action.verificationWindow !== verification.window
      || verification.actionId !== action.actionId
      || verification.sourceArtifactId !== action.sourceArtifactId
      || metric.target !== verification.target
      || !sameScope(verification, cycle)
      || !sameScope(metric, cycle)) {
      fail('E_OPERATE_TRACE_DANGLING', 'Outcome verification lost its exact Action, plan, Metric, baseline, target, or window.', {
        outcomeId: outcome.outcomeId,
        verificationPlanId: outcome.verificationPlanId,
      });
    }
    const sourceArtifact = artifacts.get(outcome.sourceArtifactId);
    const sourceAssignment = sourceArtifact === undefined
      ? undefined
      : assignments.get(sourceArtifact.assignmentId);
    const acceptedSource = sourceArtifact === undefined || sourceAssignment === undefined
      ? null
      : acceptedArtifactForAssignment({
        assignment: sourceAssignment,
        artifacts,
        submissions,
      });
    if (!sourceArtifact || acceptedSource?.artifactId !== sourceArtifact.artifactId) {
      fail('E_OPERATE_TRACE_DANGLING', 'Outcome source is not one exact accepted Artifact.', {
        outcomeId: outcome.outcomeId,
        sourceArtifactId: outcome.sourceArtifactId,
      });
    }
    const matchedObservations = outcome.observationIds.map((observationId) => {
      const observation = observations.get(observationId);
      const snapshot = observation === undefined ? undefined : current.snapshots.get(observation.snapshotId);
      const operatingState = snapshot === undefined ? undefined : current.modelStates.get(snapshot.stateId);
      const snapshotMetrics = operatingState?.metrics?.filter((entry) => entry.metricId === metric.metricId) ?? [];
      const snapshotMetric = snapshotMetrics[0];
      if (!observation
        || observation.metricId !== metric.metricId
        || !metric.observationIds.includes(observationId)
        || observation.sourceArtifactId !== outcome.sourceArtifactId
        || observation.unit !== metric.unit
        || !sameScope(observation, cycle)
        || !snapshot
        || !sameScope(snapshot, cycle)
        || !operatingState
        || operatingState.snapshotId !== snapshot.snapshotId
        || !sameScope(operatingState, cycle)
        || snapshotMetrics.length !== 1
        || sha256Jcs(stableMetricValue(snapshotMetric)) !== sha256Jcs(stableMetricValue(metric))
        || !snapshot.sourceArtifactIds.includes(observation.sourceArtifactId)
        || observation.evidenceRefIds.some((id) => !snapshot.evidenceRefIds.includes(id))
        || !current.snapshot.sourceArtifactIds.includes(observation.sourceArtifactId)
        || observation.evidenceRefIds.some((id) => !current.snapshot.evidenceRefIds.includes(id))
        || Date.parse(metric.updatedAt) < Date.parse(observation.observedAt)
        || Date.parse(current.snapshot.createdAt) < Date.parse(observation.observedAt)
        || Date.parse(observation.observedAt) > Date.parse(outcome.observedAt)) {
        fail('E_OPERATE_TRACE_DANGLING', 'Outcome observation lost its exact Metric, accepted source, snapshot, or temporal binding.', {
          outcomeId: outcome.outcomeId,
          observationId,
        });
      }
      return observation;
    });
    const observationEvidenceIds = [...new Set(matchedObservations.flatMap(({ evidenceRefIds }) => evidenceRefIds))].sort();
    const outcomeEvidenceIds = [...new Set(outcome.evidenceRefIds)].sort();
    const evidenceVerified = outcomeEvidenceIds.length > 0
      && sha256Jcs(observationEvidenceIds) === sha256Jcs(outcomeEvidenceIds)
      && outcomeEvidenceIds.every((id) => metric.evidenceRefIds.includes(id))
      && outcomeEvidenceIds.every((id) => current.snapshot.evidenceRefIds.includes(id))
      && outcomeEvidenceIds.every((id) => nodes.get(`evidence-ref:${id}`)?.proofState === 'verified');
    const verified = ['succeeded', 'failed'].includes(outcome.status)
      && matchedObservations.length > 0
      && evidenceVerified
      && metric.freshness === 'current';
    addNode('outcome', outcome.outcomeId, verified ? 'verified' : 'insufficient');
    addEdge('verified-by', 'action', action.actionId, 'outcome', outcome.outcomeId);
    addEdge('observed-as', 'verification', verification.verificationPlanId, 'outcome', outcome.outcomeId);
    const prior = latestOutcomeProof.get(action.actionId);
    if (!prior
      || outcome.observedAt > prior.observedAt
      || (outcome.observedAt === prior.observedAt && outcome.outcomeId > prior.outcomeId)) {
      latestOutcomeProof.set(action.actionId, { outcomeId: outcome.outcomeId, observedAt: outcome.observedAt, verified });
    }
  }
  for (const action of actions.values()) {
    if (action.state !== 'completed') continue;
    nodes.get(`action:${action.actionId}`).proofState = latestOutcomeProof.get(action.actionId)?.verified === true
      ? 'completed'
      : 'insufficient';
  }

  const ledgers = (state.decisionLedgers ?? []).filter((entry) => (
    sameScope(entry, cycle) && (!plan || entry.intelligencePlanId === plan.planId)
  ));
  if (ledgers.length > 1) fail('E_OPERATE_TRACE_BINDING_INVALID', 'Cycle trace resolves more than one current Chair ledger.', { cycleId });
  const ledger = ledgers[0] ?? null;
  if (ledger) {
    const decisionByLocalId = new Map(cycleDecisions.map((entry) => [entry.sourceLocalDecisionId, entry]));
    const findingByLocalId = new Map(cycleFindings.map((entry) => [`${entry.sourceArtifactId}:${entry.sourceLocalFindingId}`, entry]));
    for (const [position, disposition] of ledger.sourceDispositions.entries()) {
      const dispositionId = `disposition:${ledger.ledgerId}:${position + 1}`;
      addNode('disposition', dispositionId, 'governed');
      const sourceArtifact = artifacts.get(disposition.sourceArtifactId);
      if (!sourceArtifact || sourceArtifact.cycleId !== cycle.cycleId) {
        fail('E_OPERATE_TRACE_DANGLING', 'Source disposition references an unavailable Artifact.', { dispositionId });
      }
      if (nodes.has(`artifact:${sourceArtifact.artifactId}`)) {
        addEdge('disposes', 'artifact', sourceArtifact.artifactId, 'disposition', dispositionId);
      }
      if (disposition.sourceKind === 'challenger-finding') {
        const finding = findingByLocalId.get(`${disposition.sourceArtifactId}:${disposition.localSourceId}`);
        if (!finding) fail('E_OPERATE_TRACE_DANGLING', 'Source disposition references an unavailable Finding.', { dispositionId });
        addEdge('disposes', 'finding', finding.findingId, 'disposition', dispositionId);
      }
      if (disposition.localDecisionId !== null) {
        const decision = decisionByLocalId.get(disposition.localDecisionId);
        if (!decision) fail('E_OPERATE_TRACE_DANGLING', 'Source disposition references an unavailable Decision.', { dispositionId });
        addEdge('disposes', 'decision', decision.decisionId, 'disposition', dispositionId);
      }
    }
  }

  const restrictedKeys = new Set([...nodes.entries()]
    .filter(([, node]) => node.accessState === 'restricted')
    .map(([key]) => key));
  const incidentRestricted = new Map([...restrictedKeys].map((key) => [key, 0]));
  const edges = [...rawEdges.values()].filter((edge) => {
    const fromRestricted = restrictedKeys.has(endpointKey(edge.from));
    const toRestricted = restrictedKeys.has(endpointKey(edge.to));
    if (fromRestricted) incidentRestricted.set(endpointKey(edge.from), incidentRestricted.get(endpointKey(edge.from)) + 1);
    if (toRestricted) incidentRestricted.set(endpointKey(edge.to), incidentRestricted.get(endpointKey(edge.to)) + 1);
    return !fromRestricted && !toRestricted;
  }).sort((left, right) => left.edgeId.localeCompare(right.edgeId));
  if (edges.length > MAX_EDGES) fail('E_OPERATE_TRACE_LIMIT_EXCEEDED', 'Trace matrix edge limit exceeded.', { maxEdges: MAX_EDGES });

  for (const edge of edges) {
    nodes.get(endpointKey(edge.from)).outboundEdgeIds.push(edge.edgeId);
    nodes.get(endpointKey(edge.to)).inboundEdgeIds.push(edge.edgeId);
  }
  for (const node of nodes.values()) {
    node.inboundEdgeIds.sort();
    node.outboundEdgeIds.sort();
  }
  const omissions = [
    ...[...incidentRestricted.entries()].map(([key, incidentEdgeCount]) => {
      const node = nodes.get(key);
      return {
        omissionId: shortIdentity('tro', { key, reasonCode: 'OPERATE_TRACE_ACCESS_RESTRICTED' }),
        kind: 'restricted', subject: node.locator.kind, subjectId: node.locator.id,
        reasonCode: 'OPERATE_TRACE_ACCESS_RESTRICTED', incidentEdgeCount,
      };
    }),
    ...[...typedAbsences].map(([absenceId, reasonCode]) => {
      const node = nodes.get(`absence:${absenceId}`);
      return {
        omissionId: shortIdentity('tro', { key: `absence:${absenceId}`, reasonCode }),
        kind: 'absent', subject: 'absence', subjectId: absenceId,
        reasonCode,
        incidentEdgeCount: node.inboundEdgeIds.length + node.outboundEdgeIds.length,
      };
    }),
  ].sort((left, right) => left.omissionId.localeCompare(right.omissionId));

  const nodeList = [...nodes.values()].sort((left, right) => (
    locatorKey(left.locator).localeCompare(locatorKey(right.locator))
  ));
  const identity = { scope, eventHead, planId: plan?.planId ?? null };
  const base = {
    kind: 'operating-trace-matrix',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    matrixId: shortIdentity('trx', identity),
    ...scope,
    eventHead: clone(eventHead),
    limits: { maxNodes: MAX_NODES, maxEdges: MAX_EDGES, truncated: false },
    nodes: nodeList,
    edges,
    omissions,
    proof: proofCounts(nodeList),
  };
  const matrix = { ...base, matrixHash: sha256Jcs(base) };
  assertOperatingTraceMatrixV2(matrix);
  return freeze(matrix);
}

/** Stable typed absence identity for an intentionally unselected plan role. */
export function deriveOperatingOmittedRoleAbsenceIdV2(planId, roleId, roleVersion) {
  return shortIdentity('abs', {
    kind: 'operating-intelligence-role-not-selected',
    planId,
    roleId,
    roleVersion,
  });
}

/** Strict structural and reciprocal validation for persisted or transported matrices. */
export function assertOperatingTraceMatrixV2(value) {
  // The generated protocol catalog owns the complete closed JSON-schema
  // boundary. Semantic checks below add reciprocal identity and hash proofs;
  // they never substitute for schema validation.
  assertProtocolArtifact('operating-trace-matrix', value, { protocolVersion: PROTOCOL_VERSION });
  if (!value || value.kind !== 'operating-trace-matrix'
    || value.schemaVersion !== '1.0.0'
    || value.protocolVersion !== PROTOCOL_VERSION
    || !Array.isArray(value.nodes)
    || !Array.isArray(value.edges)
    || !Array.isArray(value.omissions)
    || value.nodes.length > MAX_NODES
    || value.edges.length > MAX_EDGES) {
    fail('E_OPERATE_TRACE_GRAPH_INVALID', 'Trace matrix shape or bound is invalid.');
  }
  validateEventHead(value.eventHead);
  if (value.nodes.map(({ locator }) => locatorKey(locator)).join('\0')
      !== [...value.nodes].map(({ locator }) => locatorKey(locator)).sort().join('\0')
    || value.edges.map(({ edgeId }) => edgeId).join('\0')
      !== [...value.edges].map(({ edgeId }) => edgeId).sort().join('\0')
    || value.omissions.map(({ omissionId }) => omissionId).join('\0')
      !== [...value.omissions].map(({ omissionId }) => omissionId).sort().join('\0')) {
    fail('E_OPERATE_TRACE_GRAPH_INVALID', 'Trace nodes, edges, and omissions must be canonically ordered.');
  }
  if (value.matrixHash !== sha256Jcs(without(value, 'matrixHash'))) {
    fail('E_OPERATE_TRACE_HASH_MISMATCH', 'Trace matrix hash does not equal its canonical content.');
  }
  const nodes = new Map();
  for (const node of value.nodes) {
    const locator = node?.locator;
    const key = locator && locatorKey(locator);
    if (!key || nodes.has(key)) fail('E_OPERATE_TRACE_DUPLICATE', 'Trace node identities must be unique.', { key: key ?? null });
    if (locator.scopeId !== value.scopeId
      || locator.domainId !== value.domainId
      || locator.domainVersion !== value.domainVersion
      || locator.cycleId !== value.cycleId
      || !ALLOWED_CONTRACTS_BY_KIND[locator.kind]?.has(locator.contract?.id)
      || locator.contract?.version !== PROTOCOL_VERSION) {
      fail('E_OPERATE_TRACE_FOREIGN_SCOPE', 'Trace node locator lost its contract, scope, Cycle, or version binding.', { key });
    }
    if (!Array.isArray(node.inboundEdgeIds) || !Array.isArray(node.outboundEdgeIds)
      || new Set(node.inboundEdgeIds).size !== node.inboundEdgeIds.length
      || new Set(node.outboundEdgeIds).size !== node.outboundEdgeIds.length
      || [...node.inboundEdgeIds].sort().join('\0') !== node.inboundEdgeIds.join('\0')
      || [...node.outboundEdgeIds].sort().join('\0') !== node.outboundEdgeIds.join('\0')) {
      fail('E_OPERATE_TRACE_RECIPROCAL_INVALID', 'Trace node adjacency must be unique and canonically ordered.', { key });
    }
    nodes.set(key, node);
  }
  const edges = new Map();
  const edgeIdentities = new Set();
  for (const edge of value.edges) {
    const fromKey = endpointKey(edge.from ?? {});
    const toKey = endpointKey(edge.to ?? {});
    const pair = `${edge.from?.kind}>${edge.to?.kind}`;
    const identity = sha256Jcs({ relation: edge.relation, from: edge.from, to: edge.to });
    if (!nodes.has(fromKey) || !nodes.has(toKey)) fail('E_OPERATE_TRACE_DANGLING', 'Trace edge endpoint is unavailable.', { edgeId: edge?.edgeId ?? null });
    if (!ALLOWED_EDGE_PAIRS[edge.relation]?.has(pair) || KIND_RANK[edge.from.kind] >= KIND_RANK[edge.to.kind]) {
      fail('E_OPERATE_TRACE_CYCLE', 'Trace edge violates the closed acyclic lifecycle.', { edgeId: edge.edgeId, pair });
    }
    if (edges.has(edge.edgeId) || edgeIdentities.has(identity)) fail('E_OPERATE_TRACE_DUPLICATE', 'Trace edge identity is duplicated.', { edgeId: edge.edgeId });
    if (edge.edgeId !== shortIdentity('tre', { relation: edge.relation, from: edge.from, to: edge.to })) {
      fail('E_OPERATE_TRACE_HASH_MISMATCH', 'Trace edge ID does not bind its canonical endpoints.', { edgeId: edge.edgeId });
    }
    edges.set(edge.edgeId, edge);
    edgeIdentities.add(identity);
  }
  for (const [key, node] of nodes) {
    for (const edgeId of node.outboundEdgeIds) {
      const edge = edges.get(edgeId);
      if (!edge || endpointKey(edge.from) !== key || !nodes.get(endpointKey(edge.to))?.inboundEdgeIds.includes(edgeId)) {
        fail('E_OPERATE_TRACE_RECIPROCAL_INVALID', 'Trace forward edge is missing its exact inverse locator.', { key, edgeId });
      }
    }
    for (const edgeId of node.inboundEdgeIds) {
      const edge = edges.get(edgeId);
      if (!edge || endpointKey(edge.to) !== key || !nodes.get(endpointKey(edge.from))?.outboundEdgeIds.includes(edgeId)) {
        fail('E_OPERATE_TRACE_RECIPROCAL_INVALID', 'Trace inverse edge is missing its exact forward locator.', { key, edgeId });
      }
    }
  }
  for (const edge of edges.values()) {
    if (!nodes.get(endpointKey(edge.from)).outboundEdgeIds.includes(edge.edgeId)
      || !nodes.get(endpointKey(edge.to)).inboundEdgeIds.includes(edge.edgeId)) {
      fail('E_OPERATE_TRACE_RECIPROCAL_INVALID', 'Trace edge is not reciprocally indexed by both endpoints.', { edgeId: edge.edgeId });
    }
  }
  const omissions = new Map();
  for (const omission of value.omissions) {
    const key = `${omission.subject}:${omission.subjectId}`;
    const node = nodes.get(key);
    const expectedKind = node?.accessState === 'restricted' ? 'restricted'
      : node?.accessState === 'absent' && node?.locator.kind === 'absence' ? 'absent'
        : null;
    const expectedReason = expectedKind === 'restricted' ? 'OPERATE_TRACE_ACCESS_RESTRICTED'
      : node?.locator.kind === 'absence' && node.locator.contract.id === 'operating-intelligence-plan'
        ? 'OPERATE_TRACE_ROLE_NOT_SELECTED'
        : expectedKind === 'absent' ? 'OPERATE_TRACE_TYPED_ABSENCE'
          : null;
    const expectedId = shortIdentity('tro', { key, reasonCode: expectedReason });
    // Restricted incident edges are intentionally absent from the transported
    // graph, so only the builder-authored count can describe them. Typed
    // absences retain every visible reciprocal edge and must equal that count.
    const visibleIncidentCount = node === undefined ? -1
      : node.inboundEdgeIds.length + node.outboundEdgeIds.length;
    if (!node || expectedKind !== omission.kind || expectedReason !== omission.reasonCode
      || expectedId !== omission.omissionId || omissions.has(key)
      || (omission.kind === 'absent' && omission.incidentEdgeCount !== visibleIncidentCount)) {
      fail('E_OPERATE_TRACE_OMISSION_INVALID', 'Trace omission does not bind one exact restricted or absent node.', {
        omissionId: omission?.omissionId ?? null,
      });
    }
    omissions.set(key, omission);
  }
  for (const [key, node] of nodes) {
    if ((node.accessState === 'restricted'
      || (node.accessState === 'absent' && node.locator.kind === 'absence'))
      && !omissions.has(key)) {
      fail('E_OPERATE_TRACE_OMISSION_INVALID', 'Restricted and absent trace nodes require an explicit typed omission.', { key });
    }
  }
  if (sha256Jcs(value.proof) !== sha256Jcs(proofCounts([...nodes.values()]))) {
    fail('E_OPERATE_TRACE_PROOF_INVALID', 'Trace proof summary contradicts its node classifications.');
  }
  return value;
}

/** Return all immediate forward and inverse locators for one exact node. */
export function locateOperatingTraceNodeV2(matrix, locator, { maxResults = 256 } = {}) {
  assertOperatingTraceMatrixV2(matrix);
  if (!Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > 4096) {
    fail('E_OPERATE_TRACE_LIMIT_EXCEEDED', 'Trace locator result bound must be between 1 and 4096.');
  }
  const node = matrix.nodes.find((entry) => locatorKey(entry.locator) === locatorKey(locator));
  if (!node) return null;
  const edgeById = new Map(matrix.edges.map((edge) => [edge.edgeId, edge]));
  const inbound = node.inboundEdgeIds.map((edgeId) => edgeById.get(edgeId)).filter(Boolean);
  const outbound = node.outboundEdgeIds.map((edgeId) => edgeById.get(edgeId)).filter(Boolean);
  if (inbound.length + outbound.length > maxResults) {
    fail('E_OPERATE_TRACE_LIMIT_EXCEEDED', 'Trace locator result limit exceeded.', { maxResults });
  }
  return freeze({ node: clone(node), inbound: inbound.map(clone), outbound: outbound.map(clone) });
}
