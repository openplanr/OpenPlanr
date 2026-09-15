import { PipelineError } from '@openplanr/protocol/errors';
import { assertOperateExperienceArtifactV2, assertProtocolArtifact } from '@openplanr/protocol/contracts';
import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { projectOperatingAcceptedIntelligenceOutputV2 } from './intelligence-ledger-v2.mjs';
import { derivePersistentOperatingActionRevisionHashV2 } from './persistent-work-v2.mjs';
import { reconstructOperatingVerificationPlanActionV2 } from './runtime-foundation.mjs';
import {
  PROTOCOL_VERSION,
  assertDeliveryClassification,
  assertNoSensitiveContext,
  assertOperatingDeliveryEvidenceV1,
  assertOperatingOriginV1,
  assertOperatingPlanningProposalV1,
  fail,
  sameHead,
  sameScope,
  without,
} from '@openplanr/protocol/operating-planning-contracts';

const ROUTES = Object.freeze(['contained-execution', 'planning-work', 'human-external', 'observe-only']);
const ACCESS_ORDER = Object.freeze(['public', 'internal', 'confidential', 'restricted']);


function clone(value) { return structuredClone(value); }
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}
function stableId(prefix, value) { return `${prefix}_${sha256Jcs(value).slice('sha256:'.length, 'sha256:'.length + 32)}`; }

function uniqueIdentityIndex(records, identityField, entityName) {
  const index = new Map();
  for (const record of records) {
    const identity = record?.[identityField];
    if (typeof identity !== 'string' || identity.length === 0 || index.has(identity)) {
      fail('RESULT_CONTRACT_INVALID', `Planning bridge requires unique scope-local ${entityName} identities.`, { identity: identity ?? null });
    }
    index.set(identity, record);
  }
  return index;
}

function exactArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && sha256Jcs(left) === sha256Jcs(right);
}

function scopedRecord(records, scope, identityField, identity, entityName) {
  return uniqueIdentityIndex((records ?? []).filter((record) => sameScope(record, scope)), identityField, entityName).get(identity);
}

function assertInstant(value, field) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail('RESULT_CONTRACT_INVALID', `${field} must be an RFC 3339 instant.`);
}


function assertCurrentAction(action, state, scope) {
  const current = scopedRecord(state.actions, scope, 'actionId', action.actionId, 'Action');
  if (!current || !sameScope(current, scope)
    || current.revision !== action.revision
    || current.actionHash !== action.actionHash
    || current.actionHash !== derivePersistentOperatingActionRevisionHashV2(current)
    || !Number.isInteger(current.revision)
    || typeof current.actionHash !== 'string') {
    fail('ACTION_REVISION_MISMATCH', 'Planning bridge requires the exact current governed Action revision.', { actionId: action?.actionId ?? null });
  }
  return current;
}

function assertCurrentDecision(decision, state, scope) {
  const current = scopedRecord(state.decisions, scope, 'decisionId', decision.decisionId, 'Decision');
  if (!current || !sameScope(current, scope) || current.revision !== decision.revision || sha256Jcs(current) !== decision.decisionHash || current.state !== 'approved') {
    fail('E_OPERATE_BINDING_MISMATCH', 'Planning bridge requires the exact current approved Decision revision.', { decisionId: decision?.decisionId ?? null });
  }
  return current;
}

function canonicalPlanningMetric(state, currentAction, plan, sourceVerificationPlanEvent, scope) {
  const currentMetrics = (state.metrics ?? []).filter((metric) => (
    sameScope(metric, scope) && metric.metricId === currentAction.metricId
  ));
  if (currentMetrics.length > 1) {
    fail('RESULT_CONTRACT_INVALID', 'Planning proposal metric identity is ambiguous in the current operating scope.');
  }
  if (currentMetrics.length === 1) return { metric: currentMetrics[0], snapshot: null };
  if (!sourceVerificationPlanEvent) {
    fail('RESULT_CONTRACT_INVALID', 'Planning proposal requires the exact verification-plan Event for canonical metric recovery.');
  }
  let reconstructed;
  try {
    reconstructed = reconstructOperatingVerificationPlanActionV2({ state, event: sourceVerificationPlanEvent });
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', 'Planning proposal could not recover the canonical plan-bound metric.', {
      cause: cause?.code ?? null,
    });
  }
  const expectedAction = reconstructed.action;
  const immutableFields = Object.keys(expectedAction).filter((field) => !['state', 'updatedAt'].includes(field));
  if (reconstructed.verificationPlan.verificationPlanId !== plan.verificationPlanId
    || sha256Jcs(reconstructed.verificationPlan) !== sha256Jcs(plan)
    || immutableFields.some((field) => sha256Jcs(expectedAction[field]) !== sha256Jcs(currentAction[field]))
    || !sameScope(reconstructed.metric, scope)
    || reconstructed.metric.metricId !== currentAction.metricId) {
    fail('E_OPERATE_BINDING_MISMATCH', 'Recovered Planning metric does not retain the exact Action, plan, scope, and model-state binding.');
  }
  const snapshots = (state.operatingSnapshots ?? []).filter((candidate) => (
    sameScope(candidate, scope) && candidate.snapshotId === reconstructed.snapshotId
  ));
  if (snapshots.length !== 1) {
    fail('E_OPERATE_BINDING_MISMATCH', 'Recovered Planning metric lost its unique immutable snapshot binding.');
  }
  return { metric: reconstructed.metric, snapshot: snapshots[0] };
}

/** Bind one immutable delivery classification to an exact Action revision and Event head. */
export function createOperatingDeliveryRouteV1({ state, action, route, rationale, createdAt = state?.generatedAt } = {}) {
  assertProtocolArtifact('operating-runtime-state', state, { protocolVersion: PROTOCOL_VERSION });
  if (!ROUTES.includes(route)) fail('RESULT_CONTRACT_INVALID', 'Delivery route must be one of the four canonical values.');
  assertInstant(createdAt, 'createdAt');
  const current = assertCurrentAction(action, state, {
    scopeId: action?.scopeId,
    domainId: action?.domainId,
    domainVersion: action?.domainVersion,
  });
  const base = {
    kind: 'operating-delivery-route', schemaVersion: '1.0.0', protocolVersion: PROTOCOL_VERSION,
    routeId: stableId('droute', { actionId: current.actionId, revision: current.revision, actionHash: current.actionHash, route }),
    scopeId: current.scopeId, domainId: current.domainId, domainVersion: current.domainVersion,
    action: { actionId: current.actionId, revision: current.revision, actionHash: current.actionHash },
    eventHead: clone(state.eventHead), route, rationale, createdAt,
  };
  assertNoSensitiveContext({ rationale });
  const result = { ...base, routeHash: sha256Jcs(base) };
  assertOperateExperienceArtifactV2('operating-delivery-route', result);
  return freeze(result);
}

/** A changed route on the same Action revision is prohibited; revise the Action first. */
export function assertOperatingDeliveryRouteRevisionV1(previous, next) {
  assertOperateExperienceArtifactV2('operating-delivery-route', previous);
  assertOperateExperienceArtifactV2('operating-delivery-route', next);
  if (previous.routeHash !== sha256Jcs(without(previous, 'routeHash')) || next.routeHash !== sha256Jcs(without(next, 'routeHash'))) fail('E_OPERATE_BINDING_MISMATCH', 'Delivery route canonical hash is invalid.');
  if (previous.action.actionId === next.action.actionId && previous.action.revision === next.action.revision && previous.route !== next.route) fail('ACTION_REVISION_MISMATCH', 'Changing delivery route requires a new bound Action revision.');
  return next;
}

function assertRoleCustody({ assignment, submission, artifact, output, cycleId, scope, accessLevel }) {
  const maximum = ACCESS_ORDER.indexOf(accessLevel);
  if (assignment.state !== 'validated' || !submission || !artifact || !sameScope(artifact, scope)
    || assignment.cycleId !== cycleId || artifact.cycleId !== cycleId
    || artifact.assignmentId !== assignment.assignmentId || submission.assignmentId !== assignment.assignmentId
    || artifact.artifactId !== output.artifactId || submission.artifactId !== artifact.artifactId
    || artifact.rawHash !== submission.rawHash || artifact.canonicalHash !== submission.canonicalHash
    || artifact.sizeBytes !== submission.sizeBytes || artifact.producer.roleId !== assignment.roleId
    || artifact.producer.actorId !== assignment.claim?.actorId || artifact.producer.runtime !== assignment.claim?.runtime
    || assignment.outputContract.schemaId !== artifact.schemaId
    || assignment.outputContract.schemaVersion !== artifact.artifactSchemaVersion
    || assignment.outputContract.mediaType !== artifact.mediaType
    || assignment.outputContract.encoding !== artifact.encoding
    || artifact.sizeBytes > assignment.outputContract.maxBytes
    || !exactArray(artifact.inputArtifactIds, assignment.inputArtifactIds)
    || ACCESS_ORDER.indexOf(artifact.sensitivity) > maximum
    || output.assignmentId !== assignment.assignmentId || output.roleId !== assignment.roleId
    || output.roleKind !== assignment.assignmentKind
    || sha256Jcs(output.sourceArtifactValue) !== artifact.canonicalHash) {
    fail('ARTIFACT_HASH_MISMATCH', 'Planning perspectives require exact cycle-scoped validated Assignment/Submission/Artifact proof.', { assignmentId: assignment.assignmentId });
  }
}

function exactRoleInputBundle({ assignment, value, artifacts, state, plan, snapshot }) {
  try {
    assertProtocolArtifact('operating-intelligence-input-bundle', value, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', 'Planning perspectives require a contract-valid role-scoped intelligence bundle.', {
      assignmentId: assignment.assignmentId,
      cause: cause?.code ?? null,
    });
  }
  const context = assignment.intelligenceContext?.inputBundle;
  const artifact = context ? artifacts.get(context.bundleArtifactId) : null;
  const canonicalHash = sha256Jcs(value);
  if (!context || !artifact
    || !assignment.inputArtifactIds.includes(artifact.artifactId)
    || artifact.schemaId !== 'operating-intelligence-input-bundle'
    || artifact.mediaType !== 'application/json'
    || artifact.encoding !== 'utf-8'
    || artifact.rawHash !== canonicalHash
    || artifact.canonicalHash !== canonicalHash
    || context.bundleId !== value.bundleId
    || context.bundleRawHash !== artifact.rawHash
    || context.bundleCanonicalHash !== artifact.canonicalHash
    || value.assignmentBinding.assignmentId !== assignment.assignmentId
    || value.assignmentBinding.roleId !== assignment.roleId
    || value.assignmentBinding.roleKind !== assignment.assignmentKind
    || value.assignmentBinding.roleVersion !== assignment.roleVersion
    || value.cycleId !== assignment.cycleId
    || value.snapshotId !== snapshot.snapshotId
    || value.scopeId !== snapshot.scopeId
    || value.domainId !== snapshot.domainId
    || value.domainVersion !== snapshot.domainVersion
    || plan.planId !== assignment.intelligenceContext?.intelligencePlanId) {
    fail('ARTIFACT_HASH_MISMATCH', 'Planning perspective input bundle lost exact Assignment, Artifact, or scope custody.', {
      assignmentId: assignment.assignmentId,
      bundleArtifactId: context?.bundleArtifactId ?? null,
    });
  }
  const operatingStates = (state.operatingModelStates ?? []).filter((candidate) => (
    sameScope(candidate, snapshot)
    && candidate.stateId === value.operatingState.sourceStateId
    && candidate.snapshotId === snapshot.snapshotId
  ));
  if (operatingStates.length !== 1
    || operatingStates[0].runtimeHash !== value.operatingState.sourceRuntimeHash) {
    fail('E_OPERATE_BINDING_MISMATCH', 'Planning perspective bundle lost its exact bounded operating-state source.', {
      assignmentId: assignment.assignmentId,
      stateId: value.operatingState.sourceStateId,
    });
  }
  return { inputBundle: value, operatingState: operatingStates[0] };
}

function perspectiveProjection(roleKind, projected) {
  if (roleKind === 'advisor') {
    const constraints = [
      ...projected.risks.flatMap((risk) => [risk.statement, risk.exposure, risk.mitigation, risk.reversibility]),
      ...projected.gaps.flatMap((gap) => [gap.impact, gap.recoveryPath]),
    ];
    const uncertainties = [
      ...(projected.recommendation ? [projected.recommendation.uncertainty] : []),
      ...projected.claims.flatMap((claim) => [...claim.assumptionIds, claim.changeCondition]),
    ];
    return {
      stance: projected.outcome === 'recommendation'
        ? 'support'
        : projected.outcome === 'partial' ? 'constraint' : 'unknown',
      summary: projected.summary,
      constraints: constraints.filter(Boolean),
      uncertainties: uncertainties.filter(Boolean),
    };
  }
  const constraints = [
    ...projected.findings.flatMap((finding) => [finding.statement, finding.correctionCondition]),
    ...projected.alternatives.flatMap((alternative) => [alternative.description, ...alternative.tradeoffs]),
    ...projected.dissent.flatMap((entry) => [entry.statement, entry.resolutionCondition]),
  ];
  return {
    stance: constraints.length > 0 ? 'object' : 'unknown',
    summary: projected.summary,
    constraints: constraints.filter(Boolean),
    uncertainties: projected.gaps.flatMap((gap) => [gap.impact, gap.recoveryPath]).filter(Boolean),
  };
}

function chairPerspective({ value, artifact, decision, plan, snapshot, scope }) {
  try {
    assertProtocolArtifact('operating-decision-ledger', value, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', 'The accepted Chair output is not a canonical Decision ledger.', { cause: cause?.code ?? null });
  }
  if (!sameScope(value, scope) || value.snapshotId !== snapshot.snapshotId
    || value.intelligencePlanId !== plan.planId || value.sourceArtifactId !== plan.sourceArtifactId
    || artifact.artifactId !== decision.sourceArtifactId) {
    fail('E_OPERATE_BINDING_MISMATCH', 'The accepted Chair ledger does not bind the exact Decision source chain.');
  }
  const candidates = value.decisions.filter((entry) => (
    entry.localDecisionId === decision.sourceLocalDecisionId
    && entry.title === decision.title
    && entry.question === decision.question
    && entry.outcome === decision.outcome
    && entry.rationale === decision.rationale
    && exactArray(entry.evidenceRefIds, decision.evidenceRefIds)
    && exactArray(entry.alternativeDispositions, decision.alternativeDispositions)
    && entry.confidence === decision.confidence
    && exactArray(entry.assumptionIds, decision.assumptionIds)
    && entry.upside === decision.expectedUpside
    && entry.downside === decision.expectedDownside
    && exactArray(entry.dissentIds, decision.dissentIds)
    && exactArray(entry.revisitConditions, decision.reopenConditions)
    && exactArray(entry.revisitConditions, decision.revisitConditions)
    && entry.ownerActorId === decision.ownerActorId
  ));
  if (candidates.length !== 1) fail('E_OPERATE_BINDING_MISMATCH', 'The normative Chair synthesis is not the unique canonical source of the current Decision.');
  const source = candidates[0];
  return {
    roleKind: 'chair', stance: 'synthesis', summary: decision.rationale,
    constraints: [source.downside, source.reversibility, ...source.revisitConditions].sort(),
    uncertainties: [source.uncertainty],
  };
}

function derivePerspectiveSummaries(state, scope, cycleId, decision, accessLevel, acceptedOutputs) {
  const artifacts = uniqueIdentityIndex(state.artifacts.filter((artifact) => sameScope(artifact, scope)), 'artifactId', 'Artifact');
  const outputAssignmentIds = new Set((acceptedOutputs ?? []).map((output) => output?.assignmentId));
  const assignments = state.assignments.filter((assignment) => (
    assignment.cycleId === cycleId
    && outputAssignmentIds.has(assignment.assignmentId)
    && ['advisor', 'challenger', 'chair'].includes(assignment.assignmentKind)
  )).sort((left, right) => (
    ['advisor', 'challenger', 'chair'].indexOf(left.assignmentKind)
    - ['advisor', 'challenger', 'chair'].indexOf(right.assignmentKind)
    || left.roleId.localeCompare(right.roleId)
  ));
  const submissions = uniqueIdentityIndex(state.submissions.filter((submission) => submission.cycleId === cycleId && submission.state === 'accepted'), 'assignmentId', 'accepted Submission');
  if (!Array.isArray(acceptedOutputs)) fail('RESULT_CONTRACT_INVALID', 'Planning perspectives require exact accepted role outputs.');
  const outputs = new Map();
  for (const output of acceptedOutputs) {
    const keys = ['assignmentId', 'artifactId', 'roleId', 'roleKind', 'sourceArtifactValue', 'inputBundleValue'];
    if (!output || typeof output !== 'object' || Array.isArray(output)
      || Object.keys(output).some((key) => !keys.includes(key)) || keys.some((key) => !(key in output))
      || !['advisor', 'challenger', 'chair'].includes(output.roleKind)
      || [output.assignmentId, output.artifactId, output.roleId].some((value) => typeof value !== 'string' || value.length === 0)
      || !output.sourceArtifactValue || typeof output.sourceArtifactValue !== 'object' || Array.isArray(output.sourceArtifactValue)
      || !output.inputBundleValue || typeof output.inputBundleValue !== 'object' || Array.isArray(output.inputBundleValue)
      || outputs.has(output.assignmentId)) fail('RESULT_CONTRACT_INVALID', 'Accepted perspective output is not closed or unique.');
    outputs.set(output.assignmentId, output);
  }
  if (ACCESS_ORDER.indexOf(accessLevel) < 0) fail('RESULT_CONTRACT_INVALID', 'Proposal actor access level is invalid.');
  const intelligencePlans = uniqueIdentityIndex((state.intelligencePlans ?? []).filter((record) => sameScope(record, scope)), 'planId', 'intelligence plan');
  const snapshots = uniqueIdentityIndex((state.operatingSnapshots ?? []).filter((record) => sameScope(record, scope)), 'snapshotId', 'operating snapshot');
  const counts = { advisor: 0, challenger: 0, chair: 0 };
  const advisorProofs = [];
  const summaries = assignments.map((assignment) => {
    const submission = submissions.get(assignment.assignmentId);
    const artifact = submission && artifacts.get(submission.artifactId);
    const output = outputs.get(assignment.assignmentId);
    if (!output) fail('ARTIFACT_HASH_MISMATCH', 'Planning perspectives require the exact accepted role body proof.', { assignmentId: assignment.assignmentId });
    assertRoleCustody({ assignment, submission, artifact, output, cycleId, scope, accessLevel });
    const planId = output.sourceArtifactValue.intelligencePlanId
      ?? state.intelligencePlans.find((candidate) => candidate.snapshotId === output.sourceArtifactValue.snapshotId)?.planId;
    const snapshotId = output.sourceArtifactValue.snapshotId
      ?? state.intelligencePlans.find((candidate) => candidate.planId === output.sourceArtifactValue.intelligencePlanId)?.snapshotId;
    const plan = intelligencePlans.get(planId);
    const snapshot = snapshots.get(snapshotId);
    if (!plan || !snapshot || plan.snapshotId !== snapshot.snapshotId) fail('E_OPERATE_BINDING_MISMATCH', 'Accepted role output lost its exact intelligence-plan snapshot binding.', { roleKind: assignment.assignmentKind, planId: planId ?? null, snapshotId: snapshotId ?? null });
    const exactInput = exactRoleInputBundle({
      assignment,
      value: output.inputBundleValue,
      artifacts,
      state,
      plan,
      snapshot,
    });
    counts[assignment.assignmentKind] += 1;
    const chair = assignment.assignmentKind === 'chair';
    const projected = chair
      ? chairPerspective({ value: output.sourceArtifactValue, artifact, decision, plan, snapshot, scope })
      : projectOperatingAcceptedIntelligenceOutputV2({
          roleKind: assignment.assignmentKind,
          value: output.sourceArtifactValue,
          artifact,
          assignment,
          plan,
          snapshot,
          operatingState: exactInput.operatingState,
          inputBundle: exactInput.inputBundle,
          priorAdvisorOutputs: advisorProofs,
        });
    if (assignment.assignmentKind === 'advisor') advisorProofs.push({ artifact, value: output.sourceArtifactValue });
    const perspective = chair ? projected : perspectiveProjection(assignment.assignmentKind, projected);
    assertNoSensitiveContext(perspective);
    return {
      roleId: assignment.roleId, roleVersion: PROTOCOL_VERSION, roleKind: assignment.assignmentKind,
      artifactId: artifact.artifactId, artifactHash: artifact.rawHash,
      accessClassification: artifact.sensitivity, disposition: 'accepted', normative: chair,
      stance: perspective.stance, summary: perspective.summary,
      constraints: perspective.constraints, uncertainties: perspective.uncertainties,
    };
  }).sort((left, right) => left.roleKind.localeCompare(right.roleKind) || left.roleId.localeCompare(right.roleId));
  if (outputs.size !== assignments.length || counts.advisor < 1 || counts.challenger !== 1 || counts.chair !== 1) fail('RESULT_CONTRACT_INVALID', 'Planning proposal requires only the exact accepted advisor outputs, exactly one Challenger, and exactly one normative Chair synthesis.');
  return summaries;
}

function safeEvidence(state, scope, cycleId, decision, accessLevel, sourceSnapshot = null) {
  const maximum = ACCESS_ORDER.indexOf(accessLevel);
  if (maximum < 0) fail('RESULT_CONTRACT_INVALID', 'Proposal actor access level is invalid.');
  const refs = uniqueIdentityIndex((state.evidenceRefs ?? []).filter((record) => sameScope(record, scope)), 'evidenceRefId', 'EvidenceRef');
  const artifacts = uniqueIdentityIndex(state.artifacts.filter((artifact) => sameScope(artifact, scope)), 'artifactId', 'Artifact');
  return [...decision.evidenceRefIds].sort().map((evidenceRefId) => {
    const ref = refs.get(evidenceRefId);
    const artifact = ref && artifacts.get(ref.evidenceArtifactId);
    if (!ref || !artifact || !sameScope(ref, scope) || !sameScope(artifact, scope) || artifact.cycleId !== cycleId
      || (sourceSnapshot !== null && !sourceSnapshot.evidenceRefIds.includes(ref.evidenceRefId))
      || artifact.rawHash !== ref.evidenceArtifactRawHash
      || artifact.canonicalHash !== ref.evidenceArtifactCanonicalHash
      || artifact.sensitivity !== ref.classification) fail('EVIDENCE_SOURCE_SCOPE_MISMATCH', 'Planning evidence must derive from one exact Decision-linked, cycle-scoped EvidenceRef and Artifact.', { evidenceRefId });
    const allowed = ACCESS_ORDER.indexOf(ref.classification) <= maximum;
    return {
      evidenceRefId: ref.evidenceRefId, artifactId: artifact.artifactId, artifactHash: artifact.rawHash,
      classification: ref.classification, accessState: allowed ? 'available' : 'restricted', relation: 'support',
      freshness: ref.freshness, confidence: decision.confidence,
      summary: allowed ? `${ref.evidenceKind} evidence accepted at ${ref.resolvedAt}.` : null,
      limitations: allowed ? [] : ['Evidence body omitted by access policy.'],
    };
  });
}

/** Build a canonical, access-safe Decision-to-SPEC proposal without performing Planning writes. */
export function buildOperatingPlanningProposalV1(state, options = {}) {
  const allowedFields = new Set(['scope', 'decision', 'action', 'deliveryRoute', 'acceptedOutputs', 'sourceVerificationPlanEvent', 'omissions', 'framing', 'actor', 'createdAt', 'previewExpiresAt']);
  const foreignField = Object.keys(options).find((field) => !allowedFields.has(field));
  if (foreignField) fail('RESULT_CONTRACT_INVALID', `Planning proposal input contains unsupported caller context: ${foreignField}.`);
  const { scope, decision, action, deliveryRoute, acceptedOutputs, sourceVerificationPlanEvent, omissions = [], framing, actor, createdAt = state?.generatedAt, previewExpiresAt } = options;
  assertProtocolArtifact('operating-runtime-state', state, { protocolVersion: PROTOCOL_VERSION });
  assertInstant(createdAt, 'createdAt'); assertInstant(previewExpiresAt, 'previewExpiresAt');
  if (!scope || typeof scope !== 'object'
    || ['scopeId', 'domainId', 'domainVersion'].some((field) => typeof scope[field] !== 'string' || scope[field].length === 0)
    || !actor || typeof actor.actorId !== 'string' || actor.actorId.length === 0) {
    fail('OPERATING_SCOPE_INVALID', 'Planning proposal requires explicit scope and actor bindings.');
  }
  if (actor.kind !== 'human') fail('E_OPERATE_BINDING_MISMATCH', 'Planning proposal review must be bound to a human actor.');
  const currentDecision = assertCurrentDecision(decision, state, scope);
  const currentAction = assertCurrentAction(action, state, scope);
  if (currentAction.sourceDecisionId !== currentDecision.decisionId) fail('E_OPERATE_BINDING_MISMATCH', 'Planning Action does not originate from the selected Decision.');
  assertOperateExperienceArtifactV2('operating-delivery-route', deliveryRoute);
  if (deliveryRoute.route !== 'planning-work' || !sameScope(deliveryRoute, scope)
    || deliveryRoute.action.actionId !== currentAction.actionId
    || deliveryRoute.action.revision !== currentAction.revision
    || deliveryRoute.action.actionHash !== currentAction.actionHash
    || !sameHead(deliveryRoute.eventHead, state.eventHead)
    || deliveryRoute.routeHash !== sha256Jcs(without(deliveryRoute, 'routeHash'))) fail('E_OPERATE_BINDING_MISMATCH', 'Only an exact current planning-work route can produce a planning proposal.');
  assertNoSensitiveContext({ framing, omissions });
  const plan = scopedRecord(state.verificationPlans, scope, 'verificationPlanId', currentAction.verificationPlanId, 'verification plan');
  if (!plan || !sameScope(plan, scope) || plan.actionId !== currentAction.actionId || plan.metricId !== currentAction.metricId
    || plan.baseline !== currentAction.baseline || plan.target !== currentAction.target || plan.window !== currentAction.verificationWindow) fail('RESULT_CONTRACT_INVALID', 'Planning proposal requires the exact original Action verification plan.');
  const canonicalMetric = canonicalPlanningMetric(state, currentAction, plan, sourceVerificationPlanEvent, scope);
  const metric = canonicalMetric.metric;
  const metricHash = sha256Jcs(metric); const verificationPlanHash = sha256Jcs(plan);
  const acceptedPerspectiveSummaries = derivePerspectiveSummaries(state, scope, currentAction.sourceCycleId, currentDecision, actor.accessLevel, acceptedOutputs);
  const safeEvidenceRefs = safeEvidence(state, scope, currentAction.sourceCycleId, currentDecision, actor.accessLevel, canonicalMetric.snapshot);
  const correlationId = stableId('corr', { scope, decision: decision.decisionHash, action: action.actionHash });
  const proposalId = stableId('oprop', { correlationId, eventHead: state.eventHead, framing, evidence: safeEvidenceRefs.map(({ evidenceRefId, artifactHash }) => ({ evidenceRefId, artifactHash })) });
  const preview = { digest: sha256Jcs({ proposalId, correlationId, eventHead: state.eventHead, framing, actorId: actor.actorId }), issuedAt: createdAt, expiresAt: previewExpiresAt };
  const base = {
    kind: 'operating-planning-proposal', schemaVersion: '1.0.0', protocolVersion: PROTOCOL_VERSION,
    proposalId, correlationId, revision: 1, predecessorProposalHash: null, state: 'review-required', confirmation: null, ...scope, cycleId: currentAction.sourceCycleId, eventHead: clone(state.eventHead),
    decision: { decisionId: currentDecision.decisionId, revision: currentDecision.revision, decisionHash: decision.decisionHash, sourceArtifactId: currentDecision.sourceArtifactId, title: currentDecision.title, outcome: currentDecision.outcome, rationale: currentDecision.rationale, confidence: currentDecision.confidence, evidenceRefIds: [...currentDecision.evidenceRefIds].sort() },
    action: { actionId: currentAction.actionId, revision: currentAction.revision, actionHash: currentAction.actionHash, sourceArtifactId: currentAction.sourceArtifactId, title: currentAction.title, expectedResult: currentAction.expectedResult, metricId: currentAction.metricId, verificationPlanId: currentAction.verificationPlanId },
    deliveryRoute: clone(deliveryRoute), acceptedPerspectiveSummaries, evidence: safeEvidenceRefs,
    omissions: omissions.map(clone).sort((a, b) => a.reason.localeCompare(b.reason) || a.classification.localeCompare(b.classification)),
    framing: clone(framing),
    metric: { metricId: metric.metricId, metricHash },
    verification: { verificationPlanId: plan.verificationPlanId, verificationPlanHash, metricId: plan.metricId, metricHash, baseline: plan.baseline, target: plan.target, window: plan.window, method: plan.method, revisitConditions: [...plan.evaluationRules].sort() },
    actor: { actorId: actor.actorId, kind: actor.kind }, preview, planningCommand: 'planr operate planning create-spec', createdAt,
  };
  const proposal = { ...base, proposalHash: sha256Jcs(base) };
  assertOperatingPlanningProposalV1(proposal);
  return freeze(proposal);
}


/** Apply the only review-required -> approved transition using exact human confirmation proof. */
export function confirmOperatingPlanningProposalV1(proposal, { actorId, proposalRevision, proposalHash, eventHead, previewDigest, confirmedAt } = {}) {
  assertOperatingPlanningProposalV1(proposal); assertInstant(confirmedAt, 'confirmedAt');
  if (proposal.state !== 'review-required' || proposal.revision !== 1 || proposal.confirmation !== null) fail('STATE_TRANSITION_INVALID', 'Only the current review-required proposal may be confirmed once.');
  if (actorId !== proposal.actor.actorId || proposal.actor.kind !== 'human' || proposalRevision !== proposal.revision
    || proposalHash !== proposal.proposalHash || !sameHead(eventHead, proposal.eventHead) || previewDigest !== proposal.preview.digest) {
    fail('E_OPERATE_BINDING_MISMATCH', 'Confirmation actor, proposal revision/hash, Event head, or preview digest differs from the reviewed proposal.');
  }
  if (Date.parse(confirmedAt) < Date.parse(proposal.preview.issuedAt) || Date.parse(confirmedAt) > Date.parse(proposal.preview.expiresAt)) fail('STATE_TRANSITION_INVALID', 'Confirmation must occur within the exact preview validity window.');
  const confirmationBase = { confirmationId: stableId('pcfm', { proposalHash: proposal.proposalHash, actorId, confirmedAt }), reviewProposalHash: proposal.proposalHash, reviewProposalRevision: proposal.revision, eventHead: clone(proposal.eventHead), previewDigest, actorId, decision: 'approved', confirmedAt, previewExpiresAt: proposal.preview.expiresAt };
  const confirmation = { ...confirmationBase, confirmationHash: sha256Jcs(confirmationBase) };
  const base = { ...without(proposal, 'proposalHash'), revision: 2, predecessorProposalHash: proposal.proposalHash, state: 'approved', confirmation };
  const approved = { ...base, proposalHash: sha256Jcs(base) };
  assertOperatingPlanningProposalV1(approved);
  return freeze(approved);
}

/** Create the closed sidecar value after the Planning transaction has a durable receipt. */
export function createOperatingOriginV1({ proposal, spec, actor, transaction, createdAt } = {}) {
  assertOperatingPlanningProposalV1(proposal); assertInstant(createdAt, 'createdAt');
  if (proposal.state !== 'approved' || proposal.revision !== 2) fail('STATE_TRANSITION_INVALID', 'Only the exact human-confirmed current proposal may produce an operating origin.');
  if (actor.actorId !== proposal.confirmation.actorId || actor.kind !== 'human') fail('E_OPERATE_BINDING_MISMATCH', 'Operating origin actor differs from the human confirmation proof.');
  assertNoSensitiveContext({ spec, transaction });
  const base = {
    kind: 'operating-origin', schemaVersion: '1.0.0', protocolVersion: PROTOCOL_VERSION,
    correlationId: proposal.correlationId, proposalId: proposal.proposalId, proposalRevision: proposal.revision, proposalHash: proposal.proposalHash,
    scopeId: proposal.scopeId, domainId: proposal.domainId, domainVersion: proposal.domainVersion, cycleId: proposal.cycleId, eventHead: clone(proposal.eventHead),
    decision: { id: proposal.decision.decisionId, revision: proposal.decision.revision, hash: proposal.decision.decisionHash },
    action: { id: proposal.action.actionId, revision: proposal.action.revision, hash: proposal.action.actionHash },
    metric: clone(proposal.metric), verification: { verificationPlanId: proposal.verification.verificationPlanId, verificationPlanHash: proposal.verification.verificationPlanHash, metricId: proposal.metric.metricId, metricHash: proposal.metric.metricHash, window: proposal.verification.window },
    evidence: proposal.evidence.map(({ evidenceRefId, artifactId, artifactHash, classification, accessState }) => ({ evidenceRefId, artifactId, artifactHash, classification, accessState })),
    spec: clone(spec), actor: { actorId: actor.actorId, kind: actor.kind }, transaction: clone(transaction), createdAt,
  };
  const origin = { ...base, originHash: sha256Jcs(base) };
  assertOperatingOriginV1(origin);
  return freeze(origin);
}


/** Project accepted Planning/SHIP facts without claiming business Outcome success. */
export function buildOperatingDeliveryEvidenceV1({ origin, planRun, shipRun, tasks, changedSurfaces, qa, limitations = [], artifacts = [], classification = 'internal', summary, deliveryStatus, rollback = null, createdAt } = {}) {
  assertOperatingOriginV1(origin); assertInstant(createdAt, 'createdAt');
  assertNoSensitiveContext({ planRun, shipRun, tasks, changedSurfaces, qa, limitations, artifacts, summary, rollback });
  if ('verificationPlanId' in shipRun || 'verificationPlanHash' in shipRun || 'metricId' in shipRun || 'metricHash' in shipRun) fail('E_OPERATE_BINDING_MISMATCH', 'SHIP run cannot substitute proposal metric or verification bindings.');
  if ((deliveryStatus === 'rolled-back') !== (rollback !== null)
    || (rollback !== null && (rollback.originalShipRunId !== shipRun.runId || rollback.status !== 'succeeded'))) {
    fail('E_OPERATE_BINDING_MISMATCH', 'Rolled-back delivery requires one exact successful rollback custody bound to the SHIP run.');
  }
  assertDeliveryClassification(classification, artifacts);
  const base = {
    kind: 'operating-delivery-evidence', schemaVersion: '1.0.0', protocolVersion: PROTOCOL_VERSION,
    deliveryEvidenceId: stableId('dlev', { correlationId: origin.correlationId, shipRun, tasks, qa, deliveryStatus, rollback }),
    correlationId: origin.correlationId, proposalId: origin.proposalId, proposalRevision: origin.proposalRevision, scopeId: origin.scopeId, domainId: origin.domainId, domainVersion: origin.domainVersion,
    decision: clone(origin.decision), action: clone(origin.action), metric: clone(origin.metric), verification: clone(origin.verification),
    spec: { specId: origin.spec.specId, contentHash: origin.spec.contentHash, originHash: origin.originHash },
    planRun: clone(planRun), shipRun: clone(shipRun),
    tasks: tasks.map(clone).sort((a, b) => a.taskId.localeCompare(b.taskId)), changedSurfaces: [...changedSurfaces].sort(), qa: clone(qa),
    limitations: [...limitations].sort(), artifacts: artifacts.map(clone).sort((a, b) => a.artifactId.localeCompare(b.artifactId)), classification, summary,
    deliveryStatus, rollback: clone(rollback), outcomeStatus: 'verification-required', createdAt,
  };
  const evidence = { ...base, deliveryEvidenceHash: sha256Jcs(base) };
  assertOperatingDeliveryEvidenceV1(evidence);
  return freeze(evidence);
}


export { ROUTES as OPERATING_DELIVERY_ROUTES_V1 };

export { assertOperatingDeliveryEvidenceV1, assertOperatingOriginV1, assertOperatingPlanningProposalV1 };