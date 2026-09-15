#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  OPERATE_EXTENSION_CONTRACT_KINDS_V2,
  OPERATE_AUTHORITY_GUARD_IDS_V2,
  OPERATE_GOVERNED_TOOL_OPERATIONS_V2,
  OPERATE_GOVERNED_EFFECT_CLASSES_V2,
  OPERATE_GOVERNED_OPERATION_TERMINAL_STATES_V2,
  OPERATE_GOVERNED_POLICY_OUTCOMES_V2,
  OPERATE_GOVERNED_POLICY_TIERS_V2,
  OPERATE_GOVERNED_CORE_PROHIBITIONS_V2,
  OPERATE_GOVERNED_RECOVERY_CLASSIFICATIONS_V2,
  OPERATE_EXECUTION_VERIFICATION_STATUSES_V2,
  OPERATE_HYPOTHESIS_VERIFICATION_STATUSES_V2,
  OPERATE_ROLE_MANDATES_V2,
  OPERATE_RUNTIME_CONTRACT_KINDS,
  assertOperateIntelligencePlanContractV2,
  assertOperateRoleOutputContract,
  assertOperateRuntimeBindingsV2,
  listProtocolSchemas,
  loadOperateRoleMandate,
  loadOperateExtensionContract,
  loadOperateRuntimeContract,
  readOperatingRuntimeStateV2,
  readOperatingGovernedOperationV2,
  readOperatingRollbackPlanV2,
  readOperatingRollbackResultV2,
  sha256Jcs,
  validateProtocolArtifact,
} from 'planr-pipeline/protocol';
import {
  OPERATING_ASSIGNMENT_TRANSITIONS_V2,
  OPERATING_REVIEW_TRANSITIONS_V2,
  OPERATE_GUARD_TABLE_V2,
  assertOperateAuthorizedV2,
  acceptOperatingAssignmentSubmissionV2,
  buildOperatingWorkLedgerV2,
  createEmptyOperatingRuntimeStateV2,
  createNoModelReplayHookV2,
  createOperatingRuntimeEventV2,
  classifyOperatingDeltaMaterialityV2,
  deriveOperateAllowedActionsV2,
  evaluateOperateAuthorityV2,
  evaluateOperateGuardV2,
  reduceOperatingRuntimeEventsV2,
  scheduleOperatingRuntimeEventsV2,
  transitionOperatingAssignmentV2,
  transitionOperatingReviewV2,
  verifyOperatingRuntimeEventChainV2,
} from 'planr-pipeline/operate/runtime-v2';
import {
  OPERATING_GOVERNED_EXECUTION_TERMINAL_STATES_V2,
  createOperatingGovernedExecutionRuntimeV2,
  executeOperatingGovernedActionV2,
} from 'planr-pipeline/operate/governed-execution-v2';
import {
  OPERATING_GOVERNED_RECOVERY_CLASSIFICATIONS_V2,
  buildOperatingRollbackPlanV2,
  classifyOperatingGovernedRecoveryV2,
  createOperatingGovernedRecoveryRuntimeV2,
  reconcileOperatingGovernedDispatchV2,
  recordOperatingRollbackPlanV2,
  rollbackOperatingGovernedActionV2,
} from 'planr-pipeline/operate/governed-recovery-v2';
import { assertOperatingIntelligencePlanV2 } from 'planr-pipeline/operate/intelligence-router-v2';
import { deriveOperatingAssignmentReleaseIntentsV2 } from 'planr-pipeline/operate/scheduler-v2';
import { OPEN_REFERENCE_OPERATE_EXTENSIONS_V2 } from 'planr-pipeline/operate/extensions-v2';
import {
  OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
  OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSION_CATALOG_DIGEST_V2,
  createContainedExecutorInputEnvelopeV2,
  createOperateGovernedExtensionRegistryV2,
  createTrustedExecutorBindingV2,
  deriveContainedExecutorRequestFingerprintV2,
  selectOperateCapabilityProviderV2,
  selectOperateExecutorV2,
  selectOperatePolicyProviderV2,
} from 'planr-pipeline/operate/governed-extensions-v2';
import {
  OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
  createOpenReferenceCapabilityAvailabilityV2,
  createDisposableLocalProjectTargetV2,
} from 'planr-pipeline/operate/reference-governed-executors-v2';
import {
  createOperatingVerificationCandidateV2,
  selectOperatingMetricProviderV2,
  selectOperatingSnapshotProviderV2,
  selectOperatingVerificationProviderV2,
} from 'planr-pipeline/operate/operating-signal-providers-v2';
import {
  createOperateEvidenceRegistryV2,
  dispatchOperateEvidenceResolverV2,
  prepareOperateEvidenceDispatchV2,
} from 'planr-pipeline/operate/evidence-v2';
import {
  assertOperatingPolicyEvaluationV2,
  createOperatingActionPolicyV2,
  evaluateOperatingActionPolicyV2,
} from 'planr-pipeline/operate/policy-v2';
import {
  appendOperatingApprovalRecordV2,
  consumeOperatingApprovalRecordsV2,
  createOperatingApprovalRecordV2,
  createOperatingApprovalRequirementV2,
  evaluateOperatingApprovalSetV2,
} from 'planr-pipeline/operate/approvals-v2';

const VERSION = '2.0.0';
const TIME = '2026-08-08T08:00:00.000Z';
const NEXT_TIME = '2026-08-08T08:01:00.000Z';

function intelligenceSubmissionBase64(assignmentKind) {
  const kindByAssignment = {
    advisor: 'operating-advisor-result',
    challenger: 'operating-challenger-review',
    chair: 'operating-decision-ledger',
  };
  return Buffer.from(JSON.stringify({
    kind: kindByAssignment[assignmentKind],
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
  }), 'utf8').toString('base64');
}
const RAW_HASH = `sha256:${'a'.repeat(64)}`;
const fixtureUrl = (name) => new URL(`./fixtures/operating-runtime-v2/${name}`, import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(fixtureUrl(name), 'utf8'));
const clone = (value) => structuredClone(value);
const liveEvidenceValid = fixture('live-evidence-contracts-valid.json');
const valid = {
  ...fixture('all-contracts-valid.json'),
  ...liveEvidenceValid,
};
const policyApprovalValid = fixture('policy-approval-valid.json');
const policyApprovalInvalid = fixture('policy-approval-invalid.json');
const executionVerificationValid = fixture('execution-verification-valid.json');
let checks = 0;

function pass(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

function setPath(value, path, next) {
  const parts = path.split('.');
  const leaf = parts.pop();
  const parent = parts.reduce((current, part) => current[part], value);
  parent[leaf] = next;
}

function invalidFromDescriptor(base, descriptor) {
  const value = clone(base);
  if (descriptor.patch) Object.assign(value, descriptor.patch);
  if (descriptor.patchError) Object.assign(value.error, descriptor.patchError);
  return value;
}

function baseAssignment(state = 'pending') {
  const value = clone(valid['operating-assignment']);
  value.state = state;
  value.dependsOn = [];
  value.dependencyPolicy = { kind: 'none' };
  value.inputArtifactIds = [];
  value.availableAt = state === 'pending' ? null : TIME;
  value.claim = ['claimed', 'running', 'submitted', 'rejected', 'validated', 'failed'].includes(state)
    ? { actorId: 'agent-001', actorKind: 'agent', runtime: 'codex', claimId: 'claim-001' }
    : null;
  value.attemptPolicy = {
    maxAttempts: 3,
    attempt: ['running', 'submitted', 'rejected', 'validated', 'failed'].includes(state) ? 1 : 0,
    timeoutMs: 300000,
  };
  value.completedAt = ['validated', 'abandoned', 'failed'].includes(state) ? NEXT_TIME : null;
  return value;
}

function patchFor(nextState, source) {
  if (nextState === 'available') return { availableAt: TIME };
  if (nextState === 'claimed') {
    return { claim: { actorId: 'agent-001', actorKind: 'agent', runtime: 'codex', claimId: 'claim-001' } };
  }
  if (nextState === 'running') {
    return { attemptPolicy: { ...source.attemptPolicy, attempt: source.attemptPolicy.attempt + 1 } };
  }
  if (['validated', 'abandoned', 'failed'].includes(nextState)) return { completedAt: NEXT_TIME };
  return {};
}

function append(events, type, entityId, payload, timestamp = TIME) {
  const previousEvent = events.at(-1) ?? null;
  events.push(createOperatingRuntimeEventV2({
    eventId: `evt-${String(events.length + 1).padStart(3, '0')}`,
    timestamp,
    cycleId: 'cyc_00000001',
    type,
    entityId,
    actor: { kind: 'engine', id: 'openplanr' },
    causationId: previousEvent?.eventId ?? null,
    correlationId: 'corr-001',
    payload,
  }, { previousEvent }));
}

function releasePayload(assignments, assignmentId) {
  const intent = deriveOperatingAssignmentReleaseIntentsV2({ assignments })
    .find((candidate) => candidate.assignmentId === assignmentId);
  assert.ok(intent, `missing scheduler release intent for ${assignmentId}`);
  return {
    assignmentId: intent.assignmentId,
    releaseId: intent.releaseId,
    dependencyProofs: structuredClone(intent.dependencyProofs),
    dependencyEventIds: structuredClone(intent.dependencyEventIds),
  };
}

function replayBase() {
  return {
    ...createEmptyOperatingRuntimeStateV2(TIME),
    cycles: [{
      ...clone(valid['operating-cycle']),
      state: 'advising',
      createdAt: TIME,
      updatedAt: TIME,
    }],
    inputBindings: [{
      ...clone(valid['operating-cycle-input-binding']),
      sourceArtifactIds: [],
      capturedAt: TIME,
    }],
  };
}

function happyPathEvents() {
  const events = [];
  append(events, 'cycle.input-bound', 'inb_00000001', {
    inputBindingId: 'inb_00000001',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    contractVersions: { 'advisor-result': '1.0.0' },
  });
  append(events, 'assignment.created', 'asg_00000001', baseAssignment());
  append(events, 'assignment.available', 'asg_00000001', releasePayload([baseAssignment()], 'asg_00000001'));
  append(events, 'assignment.claimed', 'asg_00000001', {
    assignmentId: 'asg_00000001',
    actorId: 'agent-001',
    actorKind: 'agent',
    runtime: 'codex',
    claimId: 'claim-001',
    submissionId: 'sub_00000001',
  });
  append(events, 'assignment.started', 'asg_00000001', {
    assignmentId: 'asg_00000001', attempt: 1,
  });
  append(events, 'assignment.submitted', 'asg_00000001', {
    assignmentId: 'asg_00000001', submissionId: 'sub_00000001', rawHash: RAW_HASH, canonicalHash: null,
    sizeBytes: 21, mediaType: 'application/json', encoding: 'utf-8',
  }, NEXT_TIME);
  append(events, 'artifact.created', 'art_00000001', {
    ...clone(valid['operating-artifact']),
    artifactId: 'art_00000001',
    assignmentId: 'asg_00000001',
    rawHash: RAW_HASH,
    sizeBytes: 21,
    inputArtifactIds: [],
    createdAt: NEXT_TIME,
  }, NEXT_TIME);
  append(events, 'assignment.validated', 'asg_00000001', {
    assignmentId: 'asg_00000001', submissionId: 'sub_00000001',
    artifactId: 'art_00000001', validatorVersion: '1.0.0',
  }, NEXT_TIME);
  return events;
}

function bindingBaseline() {
  return {
    cycle: clone(valid['operating-cycle']),
    inputBinding: clone(valid['operating-cycle-input-binding']),
    assignment: clone(valid['operating-assignment']),
    submission: clone(valid['operating-submission']),
    runtimeBinding: clone(valid['operating-cycle-input-binding'].runtimeBinding),
    runtimeState: {
      ...clone(valid['operating-runtime-state']),
      cycles: [clone(valid['operating-cycle'])],
      inputBindings: [clone(valid['operating-cycle-input-binding'])],
      assignments: [clone(valid['operating-assignment'])],
      submissions: [clone(valid['operating-submission'])],
      artifacts: [clone(valid['operating-artifact'])],
      submissionReplayIndex: [{
        submissionId: valid['operating-submission'].submissionId,
        assignmentId: valid['operating-submission'].assignmentId,
        rawHash: valid['operating-submission'].rawHash,
        canonicalHash: valid['operating-submission'].canonicalHash,
        sizeBytes: valid['operating-submission'].sizeBytes,
        artifactId: valid['operating-submission'].artifactId,
        acceptanceEventIds: valid['operating-submission'].acceptanceEventIds,
        responseData: valid['operating-submission'].responseData,
      }],
    },
    checkpoint: clone(valid['operating-checkpoint']),
  };
}

// Contract catalog, strict readers, valid/invalid vectors, and deferred vocabulary.
const registeredV2 = listProtocolSchemas().filter(({ protocolVersion }) => protocolVersion === VERSION);
pass(new Set(OPERATE_RUNTIME_CONTRACT_KINDS).size === OPERATE_RUNTIME_CONTRACT_KINDS.length,
  'Protocol 2.0 must expose unique registry-derived contract identities.');
pass(registeredV2.length === OPERATE_RUNTIME_CONTRACT_KINDS.length,
  'Protocol 2.0 schema registration must be one-to-one with the registry-derived catalog.');
const invalid = {
  ...fixture('all-contracts-invalid.json'),
  ...Object.fromEntries(Object.entries(fixture('live-evidence-contracts-invalid.json')).map(([kind, vectors]) => {
    const vector = vectors.find(({ expectedLayer, operation, path }) => (
      expectedLayer === 'schema' && operation === 'add' && /^\/[^/]+$/u.test(path)
    ));
    assert.ok(vector, `${kind}: one top-level hostile schema vector is required`);
    return [kind, { patch: { [vector.path.slice(1)]: vector.value } }];
  })),
};
for (const kind of OPERATE_RUNTIME_CONTRACT_KINDS) {
  const contract = loadOperateRuntimeContract(kind, { protocolVersion: VERSION });
  pass(contract.protocolVersion === VERSION, `${kind}: explicit reader version`);
  pass(validateProtocolArtifact(kind, valid[kind], { protocolVersion: VERSION }).length === 0,
    `${kind}: valid fixture`);
  pass(validateProtocolArtifact(kind, invalidFromDescriptor(valid[kind], invalid[kind]), {
    protocolVersion: VERSION,
  }).length > 0, `${kind}: invalid fixture`);
}
for (const kind of OPERATE_EXTENSION_CONTRACT_KINDS_V2) {
  pass(loadOperateExtensionContract(kind, { protocolVersion: VERSION }).kind === kind,
    `${kind}: explicit extension reader version`);
}
const deltaFixture = fixture('operating-delta-valid.json');
const invalidDeltaFixture = fixture('operating-delta-invalid.json');
const intelligencePlanFixture = fixture('intelligence-plan-valid.json');
const invalidIntelligencePlanFixture = fixture('intelligence-plan-invalid.json');
const decisionLedgerFixture = fixture('decision-ledger-valid.json');
const invalidDecisionLedgerFixture = fixture('decision-ledger-invalid.json');
const intelligenceStateFixture = fixture('operating-intelligence-state-valid.json');
const invalidIntelligenceStateFixture = fixture('operating-intelligence-state-invalid.json');
const triggerScenarioFixture = fixture('operating-trigger-scenario-valid.json');
const invalidTriggerScenarioFixture = fixture('operating-trigger-scenario-invalid.json');
const actionVerificationFixture = fixture('action-verification-valid.json');
const invalidActionVerificationFixture = fixture('action-verification-invalid.json');
pass(validateProtocolArtifact('operating-delta', deltaFixture, { protocolVersion: VERSION }).length === 0,
  'evidence-backed Delta fixture is a strict public contract');
pass(validateProtocolArtifact('operating-delta', invalidDeltaFixture, { protocolVersion: VERSION }).length > 0,
  'malformed Delta fixture fails closed');
pass(classifyOperatingDeltaMaterialityV2(deltaFixture).material,
  'public runtime surface explicitly reports a material Delta');
pass(assertOperateIntelligencePlanContractV2(intelligencePlanFixture) === intelligencePlanFixture,
  'public protocol helper accepts the exact explainable intelligence plan');
pass(sha256Jcs(assertOperatingIntelligencePlanV2(intelligencePlanFixture)) === sha256Jcs(intelligencePlanFixture),
  'router semantics accept the minimum useful Advisor/Challenger/Chair board');
pass(validateProtocolArtifact('operating-intelligence-plan', invalidIntelligencePlanFixture, {
  protocolVersion: VERSION,
}).length > 0, 'malformed intelligence plan fails closed');
pass(validateProtocolArtifact('operating-decision-ledger', decisionLedgerFixture, {
  protocolVersion: VERSION,
}).length === 0, 'challenged decision ledger carries mandatory uncertainty, reversibility, and complete Action hypotheses');
pass(validateProtocolArtifact('operating-decision-ledger', invalidDecisionLedgerFixture, {
  protocolVersion: VERSION,
}).length > 0, 'decision ledger without mandatory reversibility fails closed');
const topologyBypassPlan = clone(intelligencePlanFixture);
topologyBypassPlan.selectedRoles.find(({ roleId }) => roleId === 'chair').dependsOnRoleIds = ['advisor'];
assert.throws(() => assertOperateIntelligencePlanContractV2(topologyBypassPlan), {
  code: 'E_PROTOCOL_ARTIFACT_INVALID',
});
checks += 1;
for (const [kind, records] of [
  ['operating-claim', intelligenceStateFixture.claims],
  ['operating-metric-observation', intelligenceStateFixture.metricObservations],
  ['operating-risk', intelligenceStateFixture.risks],
  ['operating-assumption', intelligenceStateFixture.assumptions],
]) {
  pass(records.every((record) => validateProtocolArtifact(kind, record, { protocolVersion: VERSION }).length === 0),
    `${kind}: intelligence fixture keeps typed evidence-linked facts`);
}
pass(invalidIntelligenceStateFixture.claims[0].supportingEvidenceRefIds.length === 0
  && invalidIntelligenceStateFixture.claims[0].contradictingEvidenceRefIds.length === 0,
  'ungrounded Claim fixture is preserved for the runtime evidence-link validation boundary');
pass(validateProtocolArtifact('operating-scenario', triggerScenarioFixture.scenario, {
  protocolVersion: VERSION,
}).length === 0 && validateProtocolArtifact('operating-event-trigger', triggerScenarioFixture.trigger, {
  protocolVersion: VERSION,
}).length === 0, 'analytical Scenario and Trigger fixtures are strict contracts');
pass(validateProtocolArtifact('operating-event-trigger', invalidTriggerScenarioFixture.trigger, {
  protocolVersion: VERSION,
}).length > 0, 'invalid Trigger fixture fails closed');
for (const [kind, record] of [
  ['operating-action', actionVerificationFixture.action],
  ['operating-action-verification-plan', actionVerificationFixture.verificationPlan],
  ['operating-outcome', actionVerificationFixture.outcome],
  ['operating-learning', actionVerificationFixture.learning],
]) {
  pass(validateProtocolArtifact(kind, record, { protocolVersion: VERSION }).length === 0,
    `${kind}: bounded Action verification fixture is a strict public contract`);
}
pass(validateProtocolArtifact('operating-action', invalidActionVerificationFixture.action, {
  protocolVersion: VERSION,
}).length > 0, 'an Action-to-Assignment coercion fails contract conformance');
const businessDomain = fixture('business-domain-valid.json');
const softwareDomain = fixture('software-domain-valid.json');
const invalidDomain = fixture('operating-domain-invalid.json');
pass(validateProtocolArtifact('operate-domain-registration', businessDomain, { protocolVersion: VERSION }).length === 0,
  'business public domain registration is valid');
pass(validateProtocolArtifact('operate-domain-registration', softwareDomain, { protocolVersion: VERSION }).length === 0,
  'software public domain registration is valid');
pass(validateProtocolArtifact('operate-domain-registration', invalidDomain, { protocolVersion: VERSION }).length > 0,
  'invalid public domain registration fails closed');
pass(OPEN_REFERENCE_OPERATE_EXTENSIONS_V2.domains.length === 2
  && OPEN_REFERENCE_OPERATE_EXTENSIONS_V2.snapshotProviders.length === 1
  && OPEN_REFERENCE_OPERATE_EXTENSIONS_V2.metricProviders.length === 1
  && OPEN_REFERENCE_OPERATE_EXTENSIONS_V2.verificationProviders.length === 1,
  'public registry has only two public domains and the three closed signal providers');
const publicBusinessBinding = { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' };
pass(selectOperatingSnapshotProviderV2(undefined, {
  providerId: 'open-reference-snapshot-provider', providerVersion: '1.0.0', domainContract: publicBusinessBinding,
}).status === 'selected', 'snapshot provider selection is explicit and local');
pass(selectOperatingMetricProviderV2(undefined, {
  providerId: 'open-reference-metric-provider', providerVersion: '1.0.0', domainContract: publicBusinessBinding,
}).status === 'selected', 'metric provider selection is explicit and local');
pass(selectOperatingVerificationProviderV2(undefined, {
  providerId: 'open-reference-verification-provider', providerVersion: '1.0.0', domainContract: publicBusinessBinding,
}).status === 'selected', 'verification provider selection is explicit and local');
const verificationPlanArtifact = {
  ...clone(valid['operating-artifact']),
  artifactId: actionVerificationFixture.verificationPlan.sourceArtifactId,
  assignmentId: 'asg_verification_plan_00000001',
  inputArtifactIds: [],
};
const verificationObservationArtifact = {
  ...clone(valid['operating-artifact']),
  artifactId: actionVerificationFixture.outcome.sourceArtifactId,
  assignmentId: 'asg_verification_observation_00000001',
  inputArtifactIds: [],
};
const verificationCandidate = createOperatingVerificationCandidateV2({
  providerId: 'open-reference-verification-provider', providerVersion: '1.0.0',
  verificationPlan: actionVerificationFixture.verificationPlan,
  outcome: actionVerificationFixture.outcome,
  acceptedArtifacts: [verificationPlanArtifact, verificationObservationArtifact],
});
pass(verificationCandidate.status === 'candidate'
  && verificationCandidate.candidate.outcomeId === actionVerificationFixture.outcome.outcomeId,
  'verification provider returns an Outcome candidate from exactly declared accepted Artifacts only');
const evidenceRegistryFixture = fixture('evidence-registry-valid.json');
const evidenceRegistry = createOperateEvidenceRegistryV2({
  providers: evidenceRegistryFixture.providers,
  resolvers: evidenceRegistryFixture.resolvers,
});
const evidenceDispatch = prepareOperateEvidenceDispatchV2(evidenceRegistry, evidenceRegistryFixture.candidate, {
  scope: evidenceRegistryFixture.scope,
  capabilities: evidenceRegistryFixture.capabilities,
});
pass(evidenceDispatch.status === 'authorized', 'evidence registry selects only the exact capability-checked local pair');
const unavailableEvidenceDispatch = dispatchOperateEvidenceResolverV2(evidenceRegistry, evidenceRegistryFixture.candidate, {
  scope: evidenceRegistryFixture.scope,
  capabilities: evidenceRegistryFixture.capabilities,
});
pass(unavailableEvidenceDispatch.status === 'unavailable'
  && unavailableEvidenceDispatch.error.code === 'EVIDENCE_RESOLVER_UNAVAILABLE',
  'evidence registry dispatch is unavailable only when its static source configuration is absent');
const planrFixture = fixture('evidence-planr-valid.json');
const planrSourceMissing = dispatchOperateEvidenceResolverV2(evidenceRegistry, planrFixture.candidate, {
  scope: planrFixture.scope,
  capabilities: ['evidence.planr.read'],
  planrProjects: [],
});
pass(planrSourceMissing.status === 'rejected' && planrSourceMissing.error.code === 'SOURCE_NOT_FOUND',
  'Planr dispatch uses its static semantic resolver rather than an unavailable or Git fallback');
const artifactFixture = fixture('evidence-artifact-valid.json');
const classifiedAcceptedArtifact = {
  ...artifactFixture.acceptedArtifact,
  sourceContract: { id: 'prior-decisions', version: '1.0.0' },
};
const artifactReference = dispatchOperateEvidenceResolverV2(evidenceRegistry, artifactFixture.candidate, {
  scope: artifactFixture.scope,
  capabilities: ['evidence.operate-artifact.read'],
  operateArtifacts: [classifiedAcceptedArtifact],
});
pass(artifactReference.status === 'resolved'
  && artifactReference.capture.artifactId === artifactFixture.acceptedArtifact.artifact.artifactId
  && artifactReference.capture.sourceContract.id === 'prior-decisions'
  && !Object.hasOwn(artifactReference.capture, 'contentBase64'),
  'Operate Artifact dispatch returns one immutable accepted Artifact reference without a byte copy');
const evidenceResolutionFixture = fixture('evidence-resolution-valid.json');
const evidenceResolutionInvalid = fixture('evidence-resolution-invalid.json');
const evidenceGraphValid = fixture('evidence-graph-valid.json');
const evidenceGraphInvalid = fixture('evidence-graph-invalid.json');
pass(validateProtocolArtifact('operating-evidence-candidate', evidenceResolutionFixture.candidate, {
  protocolVersion: VERSION,
}).length === 0, 'evidence materialization candidate fixture remains a typed v2 input');
pass(evidenceResolutionFixture.claimLinks.every((link) => (
  link.sourceArtifactId === evidenceResolutionFixture.candidate.sourceArtifactId
  && ['supportedBy', 'contradictedBy'].includes(link.relation)
)), 'evidence materialization fixture carries source-Artifact-local proof links only');
pass(evidenceResolutionInvalid.foreignClaimLink.sourceArtifactId !== evidenceResolutionFixture.candidate.sourceArtifactId
  && !['supportedBy', 'contradictedBy'].includes(evidenceResolutionInvalid.illegalRelation.relation),
'evidence materialization invalid fixture preserves foreign and illegal-edge failures');
pass(validateProtocolArtifact('operating-evidence-graph', evidenceGraphValid, {
  protocolVersion: VERSION,
}).length === 0, 'empty evidence graph is a valid read-only scope projection');
pass(validateProtocolArtifact('operating-evidence-graph', evidenceGraphInvalid, {
  protocolVersion: VERSION,
}).length > 0, 'unsupported evidence graph edge relation fails schema conformance');
const generatedCatalog = fixture('generated-contract-catalog-valid.json');
pass(generatedCatalog.protocol.id === 'operate' && generatedCatalog.protocol.version === VERSION,
  'generated contract fixture declares explicit v2 identity');
pass(sha256Jcs(generatedCatalog.roles) === sha256Jcs(OPERATE_ROLE_MANDATES_V2),
  'generated contract fixture equals compiler-owned mandates');
for (const mandate of OPERATE_ROLE_MANDATES_V2) {
  const advertised = loadOperateRoleMandate(mandate.id, { roleVersion: mandate.version });
  pass(sha256Jcs(advertised) === sha256Jcs(mandate), `${mandate.id}: mandate is compiler-owned`);
  const resolved = assertOperateRoleOutputContract(mandate.id, advertised.output, {
    roleVersion: mandate.version,
  });
  pass(resolved.schemaId === mandate.output.schemaId && resolved.schemaVersion === mandate.output.schemaVersion,
    `${mandate.id}: advertised schema identity is exact`);
  pass(resolved.maxBytes === mandate.output.maxBytes, `${mandate.id}: advertised byte maximum is exact`);
}
for (const descriptor of Object.values(fixture('generated-contract-catalog-invalid.json'))) {
  if (!descriptor.output) continue;
  assert.throws(() => assertOperateRoleOutputContract(descriptor.roleId, descriptor.output, {
    roleVersion: descriptor.roleVersion,
  }), { code: 'E_PROTOCOL_ARTIFACT_INVALID' });
  checks += 1;
}
assert.throws(() => loadOperateRuntimeContract('operating-cycle'), { code: 'E_SCHEMA_VERSION_REQUIRED' });
assert.throws(() => readOperatingRuntimeStateV2(valid['operating-runtime-state']), {
  code: 'E_SCHEMA_VERSION_REQUIRED',
});
pass(readOperatingRuntimeStateV2(valid['operating-runtime-state'], { protocolVersion: VERSION })
  === valid['operating-runtime-state'], 'explicit v2 state reader');

for (const state of fixture('deferred-cycle-states-invalid.json').states) {
  const errors = validateProtocolArtifact('operating-cycle', {
    ...valid['operating-cycle'], state,
  }, { protocolVersion: VERSION });
  if (['challenging', 'approved', 'executing', 'verifying'].includes(state)) {
    pass(errors.length === 0, `Phase 6 cycle state ${state}`);
  } else {
    pass(errors.length > 0, `deferred cycle state ${state}`);
  }
}
for (const assignmentKind of fixture('deferred-assignment-kinds-invalid.json').assignmentKinds) {
  pass(validateProtocolArtifact('operating-assignment', {
    ...valid['operating-assignment'], assignmentKind,
  }, { protocolVersion: VERSION }).length > 0, `deferred Assignment kind ${assignmentKind}`);
}
for (const kind of fixture('deferred-triggers-invalid.json').triggers) {
  const rejected = clone(valid['operate-tool-call']);
  rejected.request.trigger.kind = kind;
  pass(validateProtocolArtifact('operate-tool-call', rejected, {
    protocolVersion: VERSION,
  }).length > 0, `deferred trigger ${kind}`);
}
const placeholderFixture = fixture('placeholders-invalid.json');
const placeholderValues = Object.values(placeholderFixture)
  .flat()
  .map((entry) => (typeof entry === 'string' ? entry : entry.value));
for (const placeholder of placeholderValues) {
  const rejected = clone(valid['operate-tool-call']);
  rejected.request.scope.scopeId = placeholder;
  pass(validateProtocolArtifact('operate-tool-call', rejected, {
    protocolVersion: VERSION,
  }).length > 0, `placeholder ${placeholder}`);
}

// Exact bytes and every durable binding field.
const exactBytes = fixture('exact-bytes-valid.json');
const decoded = Buffer.from(exactBytes.contentBase64, 'base64');
pass(decoded.toString('utf8') === exactBytes.text, 'exact UTF-8/whitespace bytes');
pass(decoded.byteLength === exactBytes.sizeBytes, 'exact byte length');
pass(`sha256:${createHash('sha256').update(decoded).digest('hex')}` === exactBytes.rawHash,
  'exact raw hash');
const directBytes = exactBytes;
const directDecoded = Buffer.from(directBytes.contentBase64, 'base64');
pass(directDecoded.toString('utf8') === directBytes.text, 'direct submission fixture retains exact Unicode/whitespace bytes');
pass(`sha256:${createHash('sha256').update(directDecoded).digest('hex')}` === directBytes.rawHash,
  'direct submission fixture raw hash');
pass(assertOperateRuntimeBindingsV2(bindingBaseline()).cycle.cycleId === 'cyc_00000001',
  'durable binding baseline');
for (const [field, descriptor] of Object.entries(fixture('binding-field-tamper-invalid.json'))) {
  const tampered = bindingBaseline();
  setPath(tampered, descriptor.target, descriptor.value);
  assert.throws(() => assertOperateRuntimeBindingsV2(tampered), (error) => (
    error?.code === 'E_OPERATE_BINDING_MISMATCH' && error?.details?.field === field
  ), field);
  checks += 1;
}

// Complete transition graph: all legal edges work; every other edge fails without mutation.
const assignmentStates = Object.keys(OPERATING_ASSIGNMENT_TRANSITIONS_V2);
for (const [from, nextStates] of Object.entries(OPERATING_ASSIGNMENT_TRANSITIONS_V2)) {
  const source = baseAssignment(from);
  for (const to of nextStates) {
    const next = transitionOperatingAssignmentV2(source, to, patchFor(to, source));
    pass(next.state === to, `legal Assignment edge ${from} -> ${to}`);
  }
  for (const to of assignmentStates) {
    if (nextStates.includes(to)) continue;
    const before = sha256Jcs(source);
    assert.throws(() => transitionOperatingAssignmentV2(source, to, patchFor(to, source)), (error) => (
      error?.code === 'STATE_TRANSITION_INVALID'
    ), `${from} -> ${to}`);
    pass(sha256Jcs(source) === before, `illegal Assignment edge ${from} -> ${to} is immutable`);
  }
}

const reviewStates = Object.keys(OPERATING_REVIEW_TRANSITIONS_V2);
const pendingReview = clone(valid['operating-review']);
for (const [from, nextStates] of Object.entries(OPERATING_REVIEW_TRANSITIONS_V2)) {
  const source = { ...pendingReview, state: from, disposition: from === 'pending' ? null : from };
  for (const to of nextStates) {
    const next = transitionOperatingReviewV2(source, to, { updatedAt: NEXT_TIME });
    pass(next.state === to && next.disposition === to, `legal Review edge ${from} -> ${to}`);
  }
  for (const to of reviewStates) {
    if (nextStates.includes(to)) continue;
    const before = sha256Jcs(source);
    assert.throws(() => transitionOperatingReviewV2(source, to, { updatedAt: NEXT_TIME }), (error) => (
      error?.code === 'STATE_TRANSITION_INVALID'
    ), `${from} -> ${to}`);
    pass(sha256Jcs(source) === before, `illegal Review edge ${from} -> ${to} is immutable`);
  }
}

// The single guard table is also the sole complete action source.
pass(Object.keys(OPERATE_GUARD_TABLE_V2).length === 11, 'eleven bounded runtime tools including the three governed Action operations');
pass(OPERATE_GOVERNED_TOOL_OPERATIONS_V2.length === 3
  && OPERATE_AUTHORITY_GUARD_IDS_V2.length === 4,
'the compiler exposes exactly three governed tools and four shared Review/Action guards');
const running = baseAssignment('running');
const issuedSubmission = {
  ...clone(valid['operating-submission']), state: 'issued', rawHash: null, canonicalHash: null, sizeBytes: null,
  artifactId: null, acceptanceEventIds: [], responseData: null, resolvedAt: null,
};
const actionContexts = {
  'operate.cycle.start': {
    capabilities: ['operate.cycle.start'],
    startRequest: {
      scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
      focus: ['strategy'], trigger: { kind: 'manual' }, mode: 'standard',
      ownerActorId: 'owner-cycle-start-001', deliveryRoute: 'observe-only',
    },
  },
  'operate.cycle.get': { capabilities: ['operate.cycle.get'], cycle: clone(valid['operating-cycle']) },
  'operate.cycle.resume': { capabilities: ['operate.cycle.resume'], cycle: clone(valid['operating-cycle']) },
  'operate.assignment.claim': {
    capabilities: ['operate.assignment.claim'],
    assignment: baseAssignment('available'),
    actor: { actorId: 'agent-001', kind: 'agent', runtime: 'codex' },
  },
  'operate.assignment.submit': {
    capabilities: ['operate.assignment.submit'], assignment: running, submission: issuedSubmission,
    actor: { actorId: 'agent-001', kind: 'agent', runtime: 'codex' },
    submitRequest: {
      assignmentId: running.assignmentId, submissionId: issuedSubmission.submissionId,
      actor: { actorId: 'agent-001', kind: 'agent', runtime: 'codex' },
      mediaType: 'application/json', encoding: 'utf-8', contentBase64: intelligenceSubmissionBase64('advisor'),
    },
  },
  'operate.artifact.get': {
    capabilities: ['operate.artifact.get'], artifact: clone(valid['operating-artifact']),
    actor: { actorId: 'owner-artifact-read-001', kind: 'human', runtime: 'portable' },
    artifactRequest: {
      artifactId: valid['operating-artifact'].artifactId,
      representation: 'metadata',
      actor: { actorId: 'owner-artifact-read-001', kind: 'human', runtime: 'portable' },
      scope: {
        scopeId: valid['operating-artifact'].scopeId,
        domainId: valid['operating-artifact'].domainId,
        domainVersion: valid['operating-artifact'].domainVersion,
      },
      assignmentId: null,
    },
    scopeMembership: {
      active: true, actorId: 'owner-artifact-read-001',
      scopeId: valid['operating-artifact'].scopeId,
      domainId: valid['operating-artifact'].domainId,
      domainVersion: valid['operating-artifact'].domainVersion,
    },
  },
  'operate.review.get': {
    capabilities: ['operate.review.get'],
    actor: { actorId: valid['operating-review'].ownerActorId, kind: 'human', runtime: 'portable' },
    cycle: { ...clone(valid['operating-cycle']), state: 'awaiting_review', activeReviewId: valid['operating-review'].reviewId },
    review: clone(valid['operating-review']),
    reviewReadRequest: {
      reviewId: valid['operating-review'].reviewId,
      cycleId: valid['operating-cycle'].cycleId,
      actor: { actorId: valid['operating-review'].ownerActorId, kind: 'human', runtime: 'portable' },
      scope: {
        scopeId: valid['operating-cycle'].scopeId,
        domainId: valid['operating-cycle'].domainId,
        domainVersion: valid['operating-cycle'].domainVersion,
      },
    },
  },
  'operate.review.submit': {
    capabilities: [{ id: 'operate-review-submit', version: '2.0.0' }],
    actor: { actorId: valid['operating-review'].ownerActorId, kind: 'human', runtime: 'portable' },
    scope: {
      scopeId: valid['operating-cycle'].scopeId,
      domainId: valid['operating-cycle'].domainId,
      domainVersion: valid['operating-cycle'].domainVersion,
    },
    cycle: { ...clone(valid['operating-cycle']), state: 'awaiting_review', activeReviewId: valid['operating-review'].reviewId },
    review: clone(valid['operating-review']),
    reviewRequest: {
      reviewId: valid['operating-review'].reviewId,
      cycleId: valid['operating-cycle'].cycleId,
      actor: { actorId: valid['operating-review'].ownerActorId, kind: 'human', runtime: 'portable' },
      scope: {
        scopeId: valid['operating-cycle'].scopeId,
        domainId: valid['operating-cycle'].domainId,
        domainVersion: valid['operating-cycle'].domainVersion,
      },
      disposition: 'approved',
      workDispositions: [],
    },
  },
};
const authorizationFixture = fixture('authorization-valid.json');
const invalidAuthorizationFixture = fixture('authorization-invalid.json');
const governedFixture = fixture('governed-execution-contracts-valid.json');
const governedOperationValid = fixture('governed-operation-valid.json');
const governedOperationInvalid = fixture('governed-operation-invalid.json');
const governedExtensionFixture = fixture('governed-extensions-valid.json');
const governedExtensionInvalid = fixture('governed-extensions-invalid.json');
const governedRollbackValid = fixture('governed-rollback-valid.json');
const governedRollbackInvalid = fixture('governed-rollback-invalid.json');
pass(validateProtocolArtifact('operating-governed-operation', governedOperationValid, {
  protocolVersion: VERSION,
}).length === 0, 'at-most-once runtime fixture is one strict runtime-issued governed operation');
pass(validateProtocolArtifact('operating-governed-operation', governedOperationInvalid, {
  protocolVersion: VERSION,
}).length > 0, 'caller identity/fingerprint and prohibited-effect governed operation fixture fails closed');
pass(readOperatingGovernedOperationV2(governedOperationValid, { protocolVersion: VERSION }).operationId
  === governedOperationValid.operationId, 'public protocol reader accepts only the explicit governed operation contract');
pass(JSON.stringify(OPERATING_GOVERNED_EXECUTION_TERMINAL_STATES_V2)
  === JSON.stringify(OPERATE_GOVERNED_OPERATION_TERMINAL_STATES_V2),
'runtime and protocol expose one exact terminal replay-state vocabulary');
pass(typeof createOperatingGovernedExecutionRuntimeV2 === 'function'
  && typeof executeOperatingGovernedActionV2 === 'function',
'the package exposes one stateful at-most-once runtime and one bounded direct entry point');
pass(validateProtocolArtifact('operating-rollback-plan', governedRollbackValid.rollbackPlan, {
  protocolVersion: VERSION,
}).length === 0 && validateProtocolArtifact('operating-rollback-result', governedRollbackValid.rollbackResult, {
  protocolVersion: VERSION,
}).length === 0, 'governed rollback fixtures use the strict plan and immutable result contracts');
pass(sha256Jcs(governedRollbackValid.reconciliation.classifications)
  === sha256Jcs(OPERATING_GOVERNED_RECOVERY_CLASSIFICATIONS_V2)
  && sha256Jcs(OPERATING_GOVERNED_RECOVERY_CLASSIFICATIONS_V2)
    === sha256Jcs(OPERATE_GOVERNED_RECOVERY_CLASSIFICATIONS_V2),
'runtime and conformance expose one exact reconciliation classification vocabulary');
pass(readOperatingRollbackPlanV2(governedRollbackValid.rollbackPlan, { protocolVersion: VERSION }).rollbackPlanId
  === governedRollbackValid.rollbackPlan.rollbackPlanId
  && readOperatingRollbackResultV2(governedRollbackValid.rollbackResult, { protocolVersion: VERSION }).rollbackResultId
    === governedRollbackValid.rollbackResult.rollbackResultId,
'public protocol readers accept only explicit immutable rollback plan and result contracts');
pass(governedRollbackValid.rollbackResult.originalOperationId === governedRollbackValid.rollbackPlan.operationId
  && governedRollbackValid.rollbackResult.executionResultId === governedRollbackValid.rollbackPlan.executionResultId
  && governedRollbackValid.rollbackResult.rollbackPlanId === governedRollbackValid.rollbackPlan.rollbackPlanId
  && governedRollbackValid.rollbackResult.baselineArtifactId === governedRollbackValid.rollbackPlan.baselineArtifactId
  && governedRollbackValid.rollbackResult.baselineHash === governedRollbackValid.rollbackPlan.baselineHash
  && governedRollbackValid.rollbackResult.targetAfterHash === governedRollbackValid.rollbackPlan.baselineHash,
'valid rollback fixture restores only the exact plan-bound baseline under a new operation identity');
pass(governedRollbackInvalid.vectors.length === 12
  && new Set(governedRollbackInvalid.vectors.map(({ id }) => id)).size === 12
  && governedRollbackInvalid.vectors.every(({ path, expectedCode }) => (
    typeof path === 'string' && typeof expectedCode === 'string'
  )), 'invalid rollback fixture covers stale, unsupported, prohibited, expired, divergent, repeated, concurrent, and uncertain recovery vectors');
pass([
  buildOperatingRollbackPlanV2,
  classifyOperatingGovernedRecoveryV2,
  createOperatingGovernedRecoveryRuntimeV2,
  reconcileOperatingGovernedDispatchV2,
  recordOperatingRollbackPlanV2,
  rollbackOperatingGovernedActionV2,
].every((entry) => typeof entry === 'function'), 'the package exposes typed bounded recovery, reconciliation, plan, and rollback entry points');
pass(sha256Jcs(policyApprovalValid.policyPrecedence) === sha256Jcs(OPERATE_GOVERNED_POLICY_TIERS_V2),
  'policy fixture uses compiler-owned core, project, and domain precedence');
pass(sha256Jcs(policyApprovalValid.effectClasses) === sha256Jcs(OPERATE_GOVERNED_EFFECT_CLASSES_V2),
  'policy fixture covers every compiler-owned effect class');
pass(sha256Jcs([...policyApprovalValid.outcomes].sort())
  === sha256Jcs([...OPERATE_GOVERNED_POLICY_OUTCOMES_V2].sort()),
  'policy fixture covers every compiler-owned outcome');
pass(sha256Jcs(policyApprovalValid.hardProhibitions) === sha256Jcs(OPERATE_GOVERNED_CORE_PROHIBITIONS_V2),
  'policy fixture covers every non-overridable reference prohibition');
pass(policyApprovalValid.approvalCases.length === 7
  && policyApprovalValid.approvalCases.every(({ outcome, expectedDisposition }) => (
    OPERATE_GOVERNED_POLICY_OUTCOMES_V2.includes(outcome)
      && ['approved', 'rejected', 'deferred'].includes(expectedDisposition)
  )), 'policy fixture declares all automatic, approval, deferred, rejected, and prohibited dispositions');
pass(policyApprovalInvalid.vectors.length === 16
  && new Set(policyApprovalInvalid.vectors.map(({ id }) => id)).size === 16
  && policyApprovalInvalid.vectors.every(({ mutation, expectedCode }) => (
    typeof mutation?.type === 'string' && typeof expectedCode === 'string'
  )),
'invalid policy fixture declares executable precedence, scope, quorum, replay, expiry, consumption, and separation mutations');

const policyAction = { ...clone(authorizationFixture.action), state: 'proposed' };
const policy = createOperatingActionPolicyV2({
  policyId: policyAction.executionBinding.policyId,
  policyVersion: policyAction.executionBinding.policyVersion,
  domainId: policyAction.domainId,
  actionKind: policyAction.actionKind,
  capability: policyAction.requestedCapability,
  effectClasses: [policyAction.effectClass],
  targetKinds: [policyAction.targetBinding.kind],
  decisionMode: 'named-single-party',
  approvalRequirementIds: ['aprq_conform01'],
  rollbackRequired: true,
  verificationRequired: true,
  tier: 'domain',
  provenance: {
    providerId: 'bounded-policy-provider', providerVersion: '1.0.0',
    sourceHash: `sha256:${'d'.repeat(64)}`,
  },
});
const corePolicy = createOperatingActionPolicyV2({
  policyId: 'core-conformance-policy',
  policyVersion: '1.0.0',
  domainId: policyAction.domainId,
  actionKind: policyAction.actionKind,
  capability: policyAction.requestedCapability,
  effectClasses: [policyAction.effectClass],
  targetKinds: [policyAction.targetBinding.kind],
  decisionMode: 'automatic',
  approvalRequirementIds: [],
  rollbackRequired: true,
  verificationRequired: true,
  tier: 'core',
  provenance: {
    providerId: 'core-policy-provider', providerVersion: '1.0.0',
    sourceHash: `sha256:${'c'.repeat(64)}`,
  },
});
const policyEvaluation = evaluateOperatingActionPolicyV2({
  action: policyAction, configuredPolicies: [corePolicy, policy], evaluatedAt: '2026-08-10T08:00:00Z',
});
const approvalParty = {
  partyId: 'owner-party', actorKind: 'human', actorId: 'owner-0001',
  requiredCapability: { id: 'action-approve', version: '1.0.0' },
};
const approvalRequirement = createOperatingApprovalRequirementV2({
  policyRequirementId: 'aprq_conform01', evaluation: policyEvaluation, action: policyAction,
  parties: [approvalParty], expiresAt: '2026-08-11T08:00:00Z', consumable: true,
});
const approvalRecord = createOperatingApprovalRecordV2({
  approvalId: 'aprv_conform001', requirement: approvalRequirement,
  evaluation: policyEvaluation, action: policyAction, partyId: approvalParty.partyId,
  actor: { kind: approvalParty.actorKind, actorId: approvalParty.actorId, capability: approvalParty.requiredCapability },
  decision: 'approved', issuedAt: '2026-08-10T08:01:00Z', expiresAt: '2026-08-11T08:00:00Z',
});
const approvalAppend = appendOperatingApprovalRecordV2({
  records: [], record: approvalRecord, requirement: approvalRequirement,
});
pass(evaluateOperatingApprovalSetV2({
  evaluation: policyEvaluation, action: policyAction, requirements: [approvalRequirement],
  approvals: approvalAppend.records, now: '2026-08-10T08:02:00Z',
}).disposition === 'approved', 'public policy and approval modules produce one exact complete authority disposition');
pass(appendOperatingApprovalRecordV2({
  records: approvalAppend.records, record: approvalRecord, requirement: approvalRequirement,
}).replayed, 'identical approval replay is harmless');
const exactApproval = clone(approvalRecord);
const authorityGrant = {
  ...clone(governedFixture['operating-capability-grant']),
  evaluationId: policyEvaluation.evaluationId,
  approvalIds: [exactApproval.approvalId],
  scopeHash: approvalRequirement.scopeHash,
};
const authorityOperation = {
  ...clone(governedFixture['operating-governed-operation']),
  evaluationId: policyEvaluation.evaluationId,
  approvalIds: [exactApproval.approvalId],
};
const executeAuthorityContext = {
  capabilities: [clone(authorizationFixture.toolCapabilities.actionExecute)],
  actor: {
    actorId: 'operate-runtime-v2', kind: 'engine',
    capabilities: [clone(authorizationFixture.action.requestedCapability)],
  },
  now: authorizationFixture.now, action: clone(authorizationFixture.action),
  actionRequest: clone(authorizationFixture.executeRequest), scope: clone(authorizationFixture.scope),
  target: clone(authorizationFixture.target),
  actionPolicy: clone(policy),
  actionPolicies: clone([corePolicy, policy]),
  policyEvaluation: clone(policyEvaluation),
  approvalRequirements: [clone(approvalRequirement)],
  approvals: [exactApproval], capabilityAvailability: clone(governedFixture['operating-capability-availability']),
  grant: authorityGrant,
  operation: authorityOperation, operationHistory: [],
  currentPreconditionArtifactIds: [...authorizationFixture.action.preconditionArtifactIds],
  executor: clone(governedFixture['operate-executor-registration']),
};
const approveAuthorityContext = {
  ...clone(executeAuthorityContext),
  capabilities: [clone(authorizationFixture.toolCapabilities.actionApprove)],
  actor: {
    actorId: 'owner-0001', kind: 'human',
    capabilities: [{ id: 'action-approve', version: '1.0.0' }],
  },
  action: { ...clone(authorizationFixture.action), state: 'proposed' },
  actionRequest: clone(authorizationFixture.approveRequest), approvals: [],
};
delete approveAuthorityContext.capabilityAvailability;
delete approveAuthorityContext.grant;
delete approveAuthorityContext.operation;
delete approveAuthorityContext.operationHistory;
delete approveAuthorityContext.currentPreconditionArtifactIds;
delete approveAuthorityContext.executor;
const rollbackAuthorityContext = clone(executeAuthorityContext);
rollbackAuthorityContext.capabilities = [clone(authorizationFixture.toolCapabilities.actionRollback)];
rollbackAuthorityContext.action.state = 'completed';
rollbackAuthorityContext.actionRequest = clone(authorizationFixture.rollbackRequest);
rollbackAuthorityContext.rollbackPlan = clone(governedFixture['operating-rollback-plan']);
rollbackAuthorityContext.operationHistory = [{
  ...clone(governedFixture['operating-governed-operation']), state: 'succeeded',
  resultId: governedFixture['operating-execution-result'].resultId,
}];
rollbackAuthorityContext.operation = {
  ...clone(governedFixture['operating-governed-operation']), operationId: 'op_00000002', operationKind: 'rollback',
  assignmentId: 'asg_00000002', requestFingerprint: governedFixture['operating-rollback-result'].requestFingerprint,
  grantId: 'cgr_00000002', verificationPlanId: rollbackAuthorityContext.rollbackPlan.verificationPlanId,
  rollbackPlanId: rollbackAuthorityContext.rollbackPlan.rollbackPlanId,
  parentOperationId: rollbackAuthorityContext.rollbackPlan.operationId,
  evaluationId: policyEvaluation.evaluationId,
  approvalIds: [exactApproval.approvalId],
  state: 'authorized', intentEventId: 'evt_00000002', operationHash: `sha256:${'1'.repeat(64)}`,
};
rollbackAuthorityContext.grant = {
  ...clone(governedFixture['operating-capability-grant']), grantId: 'cgr_00000002',
  operationId: 'op_00000002', assignmentId: 'asg_00000002',
  evaluationId: policyEvaluation.evaluationId, approvalIds: [exactApproval.approvalId],
  scopeHash: approvalRequirement.scopeHash, grantHash: `sha256:${'2'.repeat(64)}`,
};

function policyForConformance(action, {
  policyId,
  tier,
  decisionMode,
  approvalRequirementIds = [],
  } = {}) {
  const sourceHashCharacter = tier === 'core' ? '8' : tier === 'project' ? '9' : 'a';
  return createOperatingActionPolicyV2({
    policyId,
    policyVersion: '1.0.0',
    domainId: action.domainId,
    actionKind: action.actionKind,
    capability: action.requestedCapability,
    effectClasses: [action.effectClass],
    targetKinds: [action.targetBinding.kind],
    decisionMode,
    approvalRequirementIds,
    rollbackRequired: true,
    verificationRequired: true,
    tier,
    provenance: {
      providerId: `${tier}-negative-policy-provider`, providerVersion: '1.0.0',
      sourceHash: `sha256:${sourceHashCharacter.repeat(64)}`,
    },
  });
}

function executePolicyApprovalNegativeMutation(mutation) {
  if (mutation.type === 'approval-field') {
    const copied = clone(approvalRecord);
    setPath(copied, mutation.path, mutation.value);
    evaluateOperatingApprovalSetV2({
      evaluation: policyEvaluation, action: policyAction, requirements: [approvalRequirement],
      approvals: [copied], now: authorizationFixture.now,
    });
    return null;
  }
  if (mutation.type === 'lower-tier-widens-outcome') {
    const strongCore = policyForConformance(policyAction, {
      policyId: 'core-strong-policy', tier: 'core', decisionMode: 'named-single-party',
      approvalRequirementIds: ['aprq_corestrong'],
    });
    const weakDomain = policyForConformance(policyAction, {
      policyId: policyAction.executionBinding.policyId, tier: 'domain', decisionMode: 'automatic',
    });
    evaluateOperatingActionPolicyV2({
      action: policyAction, configuredPolicies: [strongCore, weakDomain], evaluatedAt: policyEvaluation.evaluatedAt,
    });
    return null;
  }
  if (mutation.type === 'required-policy-omitted') {
    const projectPolicy = policyForConformance(policyAction, {
      policyId: 'project-required-policy', tier: 'project', decisionMode: 'named-single-party',
      approvalRequirementIds: ['aprq_projectrequired'],
    });
    assertOperatingPolicyEvaluationV2(policyEvaluation, {
      action: policyAction, configuredPolicies: [corePolicy, projectPolicy, policy],
    });
    return null;
  }
  if (mutation.type === 'core-prohibition-weakened') {
    const prohibitedAction = clone(policyAction);
    prohibitedAction.actionKind.id = 'funds-transfer';
    const prohibitedCore = policyForConformance(prohibitedAction, {
      policyId: 'core-prohibition-policy', tier: 'core', decisionMode: 'prohibited',
    });
    const weakDomain = policyForConformance(prohibitedAction, {
      policyId: prohibitedAction.executionBinding.policyId, tier: 'domain', decisionMode: 'automatic',
    });
    evaluateOperatingActionPolicyV2({
      action: prohibitedAction, configuredPolicies: [prohibitedCore, weakDomain], evaluatedAt: policyEvaluation.evaluatedAt,
    });
    return null;
  }
  if (mutation.type === 'forged-requirement-cardinality') {
    const forged = clone(approvalRequirement);
    forged.parties.push({
      ...clone(approvalParty),
      partyId: 'outsider-party',
      actorId: null,
    });
    delete forged.scopeHash;
    forged.scopeHash = sha256Jcs(forged);
    evaluateOperatingApprovalSetV2({
      evaluation: policyEvaluation,
      action: policyAction,
      requirements: [forged],
      approvals: [],
      now: authorizationFixture.now,
    });
    return null;
  }
  if (mutation.type === 'actor-reused-across-requirements') {
    const templates = ['aprq_globalone', 'aprq_globaltwo'];
    const multiPolicy = policyForConformance(policyAction, {
      policyId: policyAction.executionBinding.policyId, tier: 'domain', decisionMode: 'named-single-party',
      approvalRequirementIds: templates,
    });
    const evaluation = evaluateOperatingActionPolicyV2({
      action: policyAction, configuredPolicies: [corePolicy, multiPolicy], evaluatedAt: policyEvaluation.evaluatedAt,
    });
    const requirements = templates.map((policyRequirementId, index) => createOperatingApprovalRequirementV2({
      policyRequirementId, evaluation, action: policyAction,
      parties: [{ ...clone(approvalParty), partyId: `global-${index + 1}-party` }],
      expiresAt: approvalRequirement.expiresAt, consumable: true,
    }));
    evaluateOperatingApprovalSetV2({
      evaluation, action: policyAction, requirements, approvals: [], now: authorizationFixture.now,
    });
    return null;
  }
  if (mutation.type === 'partial-quorum') {
    const templateId = 'aprq_partialquorum';
    const thresholdPolicy = policyForConformance(policyAction, {
      policyId: policyAction.executionBinding.policyId, tier: 'domain', decisionMode: 'threshold',
      approvalRequirementIds: [templateId],
    });
    const evaluation = evaluateOperatingActionPolicyV2({
      action: policyAction, configuredPolicies: [corePolicy, thresholdPolicy], evaluatedAt: policyEvaluation.evaluatedAt,
    });
    const parties = [1, 2].map((index) => ({
      ...clone(approvalParty), partyId: `threshold-${index}-party`, actorId: `owner-000${index}`,
    }));
    const requirement = createOperatingApprovalRequirementV2({
      policyRequirementId: templateId, evaluation, action: policyAction, parties, threshold: 2,
      expiresAt: approvalRequirement.expiresAt, consumable: true,
    });
    const partial = createOperatingApprovalRecordV2({
      approvalId: 'aprv_partial001', requirement, evaluation, action: policyAction,
      partyId: parties[0].partyId,
      actor: { kind: parties[0].actorKind, actorId: parties[0].actorId, capability: parties[0].requiredCapability },
      decision: 'approved', issuedAt: approvalRecord.issuedAt, expiresAt: approvalRecord.expiresAt,
    });
    const disposition = evaluateOperatingApprovalSetV2({
      evaluation, action: policyAction, requirements: [requirement], approvals: [partial], now: authorizationFixture.now,
    });
    if (!disposition.complete) throw Object.assign(new Error('partial approval quorum'), { code: 'APPROVAL_REQUIRED' });
    return null;
  }
  if (mutation.type === 'expired-approval') {
    const expired = createOperatingApprovalRecordV2({
      approvalId: 'aprv_expired001', requirement: approvalRequirement, evaluation: policyEvaluation,
      action: policyAction, partyId: approvalParty.partyId,
      actor: { kind: approvalParty.actorKind, actorId: approvalParty.actorId, capability: approvalParty.requiredCapability },
      decision: 'approved', issuedAt: approvalRecord.issuedAt, expiresAt: '2026-08-10T08:02:00Z',
    });
    evaluateOperatingApprovalSetV2({
      evaluation: policyEvaluation, action: policyAction, requirements: [approvalRequirement],
      approvals: [expired], now: authorizationFixture.now,
    });
    return null;
  }
  if (mutation.type === 'consumed-approval') {
    const consumed = consumeOperatingApprovalRecordsV2({
      approvals: [approvalRecord], requirements: [approvalRequirement],
      approvalIds: [approvalRecord.approvalId], operationId: 'op_conformconsume',
    });
    evaluateOperatingApprovalSetV2({
      evaluation: policyEvaluation, action: policyAction, requirements: [approvalRequirement],
      approvals: consumed.records, now: authorizationFixture.now,
    });
    return null;
  }
  if (mutation.type === 'divergent-approval-id-reuse') {
    const divergent = createOperatingApprovalRecordV2({
      approvalId: approvalRecord.approvalId, requirement: approvalRequirement, evaluation: policyEvaluation,
      action: policyAction, partyId: approvalParty.partyId,
      actor: { kind: approvalParty.actorKind, actorId: approvalParty.actorId, capability: approvalParty.requiredCapability },
      decision: 'rejected', issuedAt: approvalRecord.issuedAt, expiresAt: approvalRecord.expiresAt,
    });
    appendOperatingApprovalRecordV2({
      records: [approvalRecord], record: divergent, requirement: approvalRequirement,
    });
    return null;
  }
  if (mutation.type === 'cycle-review-substitution') {
    const copied = clone(executeAuthorityContext);
    copied.approvals = [];
    const decision = evaluateOperateAuthorityV2('operate.action.execute', copied);
    if (!decision.allowed) throw Object.assign(new Error(decision.error.message), { code: decision.error.code });
    return null;
  }
  if (mutation.type === 'prior-evaluation-reuse') {
    const nextEvaluation = evaluateOperatingActionPolicyV2({
      action: policyAction, configuredPolicies: [corePolicy, policy], evaluatedAt: '2026-08-10T08:02:00Z',
    });
    evaluateOperatingApprovalSetV2({
      evaluation: nextEvaluation, action: policyAction, requirements: [approvalRequirement],
      approvals: [approvalRecord], now: authorizationFixture.now,
    });
    return null;
  }
  throw new Error(`Unknown policy/approval negative mutation ${mutation.type}.`);
}

for (const vector of policyApprovalInvalid.vectors) {
  let actualCode = null;
  try {
    executePolicyApprovalNegativeMutation(vector.mutation);
  } catch (error) {
    actualCode = error?.code ?? null;
  }
  pass(actualCode === vector.expectedCode,
    `${vector.id}: executable negative vector returns ${vector.expectedCode}`);
}
Object.assign(actionContexts, {
  'operate.action.approve': approveAuthorityContext,
  'operate.action.execute': executeAuthorityContext,
  'operate.action.rollback': rollbackAuthorityContext,
});
pass(invalidAuthorizationFixture.vectors.length >= 12,
  'authorization invalid fixture covers actor, version, scope, target, policy, approval, grant, precondition, executor, and history denial');
pass(evaluateOperateAuthorityV2('operate.action.execute', executeAuthorityContext).allowed,
  'public authorization export accepts the exact unchanged execute chain');
const governedSelectionBase = {
  protocolVersion: governedExtensionFixture.protocolVersion,
  runtimeVersion: governedExtensionFixture.runtimeVersion,
  now: governedExtensionFixture.observedAt,
};
const governedSelections = [
  selectOperateCapabilityProviderV2(OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2, {
    ...governedSelectionBase, ...governedExtensionFixture.capabilitySelection,
  }),
  selectOperatePolicyProviderV2(OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2, {
    ...governedSelectionBase, ...governedExtensionFixture.policySelection,
  }),
  selectOperateExecutorV2(OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2, {
    ...governedSelectionBase, ...governedExtensionFixture.projectExecutorSelection,
  }),
  selectOperateExecutorV2(OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2, {
    ...governedSelectionBase, ...governedExtensionFixture.containmentExecutorSelection,
  }),
];
pass(governedSelections.every(({ status, fallback }) => status === 'available' && fallback === null),
  'public governed extension discovery selects only exact healthy compatible registrations');
pass(sha256Jcs(createOperateGovernedExtensionRegistryV2({
  capabilityProviders: [...OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.capabilityProviders].reverse(),
  policyProviders: [...OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.policyProviders].reverse(),
  executors: [...OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.executors].reverse(),
})) === sha256Jcs(OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2),
'governed extension discovery is deterministic under registration input order');
pass(governedExtensionInvalid.vectors.length >= 19
  && governedExtensionInvalid.vectors.every(({ name, kind }) => typeof name === 'string' && typeof kind === 'string'),
'governed extension conformance fixture covers reserved identity, host proof, target, envelope, health-window, plain-data, and normalized prohibition failures');
pass(governedExtensionFixture.catalogDigest === OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSION_CATALOG_DIGEST_V2,
  'open-reference governed extension catalog has one deterministic restart-stable digest');

const reservedSubstitution = clone({
  capabilityProviders: OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.capabilityProviders,
  policyProviders: OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.policyProviders,
  executors: OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.executors,
});
reservedSubstitution.executors[1].provenance.packageName = 'substitute-package';
assert.throws(() => createOperateGovernedExtensionRegistryV2(reservedSubstitution), {
  code: 'E_EXTENSION_REGISTRATION_CONFLICT',
});
pass(true, 'reserved shipped executor identity rejects a non-catalog declaration');

const reservedVersionSubstitution = clone({
  capabilityProviders: OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.capabilityProviders,
  policyProviders: OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.policyProviders,
  executors: OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.executors,
});
reservedVersionSubstitution.executors[1].executorVersion = '2.0.0';
reservedVersionSubstitution.executors[1].implementation.id = 'conformance-substitute-executor-v2';
assert.throws(() => createOperateGovernedExtensionRegistryV2(reservedVersionSubstitution), {
  code: 'E_EXTENSION_REGISTRATION_CONFLICT',
});
pass(true, 'reserved shipped executor ID remains immutable across every version and implementation identity');

const selectorCases = [
  [selectOperateCapabilityProviderV2, governedExtensionFixture.capabilitySelection],
  [selectOperatePolicyProviderV2, governedExtensionFixture.policySelection],
  [selectOperateExecutorV2, governedExtensionFixture.projectExecutorSelection],
];
pass(governedExtensionInvalid.vectors.find(({ kind }) => kind === 'effect-rank').values.every((effectClass) => (
  selectorCases.every(([select, selection]) => select(
    OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
    { ...governedSelectionBase, ...selection, effectClass },
  ).reasonCode === 'declared-ceiling-insufficient')
)), 'all governed selectors reject inherited and unknown effect-rank keys');

pass(governedExtensionInvalid.vectors.find(({ kind }) => kind === 'registration-semantics').values.every((identifier) => {
  const input = clone({
    capabilityProviders: OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.capabilityProviders,
    policyProviders: OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.policyProviders,
    executors: OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.executors,
  });
  const community = clone(input.executors[0]);
  community.executorId = 'community-conformance-executor';
  community.implementation.id = 'community-conformance-executor-v2';
  community.provenance.packageName = 'community-operate-package';
  community.supportedActionKinds = [{ id: identifier, version: '1.0.0' }];
  input.executors.push(community);
  try {
    createOperateGovernedExtensionRegistryV2(input);
    return false;
  } catch (error) {
    return error?.code === 'E_EXTENSION_REGISTRATION_INVALID';
  }
}), 'normalized order-independent registration semantics reject all prohibited identifier repros');

const payOnlyRegistration = clone({
  capabilityProviders: OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.capabilityProviders,
  policyProviders: OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.policyProviders,
  executors: OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.executors,
});
const payOnlyExecutor = clone(payOnlyRegistration.executors[0]);
payOnlyExecutor.executorId = 'community-pay-only-executor';
payOnlyExecutor.implementation.id = 'community-pay-only-executor-v2';
payOnlyExecutor.provenance.packageName = 'community-operate-package';
payOnlyExecutor.supportedActionKinds = [{ id: 'pay', version: '1.0.0' }];
payOnlyRegistration.executors.push(payOnlyExecutor);
pass(createOperateGovernedExtensionRegistryV2(payOnlyRegistration).executors.some(({ executorId }) => (
  executorId === payOnlyExecutor.executorId
)), 'pay alone remains a non-transfer semantic without send or transfer composition');
pass(['ship', 'message', 'email'].every((identifier) => {
  const input = clone(payOnlyRegistration);
  input.executors.at(-1).supportedActionKinds[0].id = identifier;
  try {
    return createOperateGovernedExtensionRegistryV2(input).executors.some(({ executorId }) => (
      executorId === payOnlyExecutor.executorId
    ));
  } catch {
    return false;
  }
}), 'ship, message, and email remain allowed without their bounded compound counterpart');

assert.throws(() => createOpenReferenceCapabilityAvailabilityV2({
  action: executeAuthorityContext.action,
  runtimeVersion: governedExtensionFixture.runtimeVersion,
  checkedAt: governedExtensionFixture.observedAt,
  expiresAt: '2026-08-11T08:00:00.001Z',
}), { code: 'OPERATING_PROVIDER_INPUT_INVALID' });
pass(true, 'capability availability cannot outlive selected provider health');

const projectExecutorSelection = governedSelections[2];
const projectBinding = createTrustedExecutorBindingV2({
  selection: projectExecutorSelection, trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
});
const containedAuthorityContext = clone(executeAuthorityContext);
containedAuthorityContext.executor = clone(projectExecutorSelection.registration);
containedAuthorityContext.operation.connector = clone(projectBinding.connector);
containedAuthorityContext.trustedExecutorBinding = projectBinding;
containedAuthorityContext.governedExtensions = clone(OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2);
const containedInitialValue = { status: 'before' };
const containedPayloadValue = { status: 'after' };
const containedPayload = {
  artifactId: containedAuthorityContext.operation.inputArtifactIds[0],
  contentHash: sha256Jcs(containedPayloadValue),
  value: containedPayloadValue,
};
const containedBaseline = {
  artifactId: containedAuthorityContext.operation.inputArtifactIds[0],
  contentHash: sha256Jcs(containedInitialValue),
  value: containedInitialValue,
};
containedAuthorityContext.operation.requestFingerprint = deriveContainedExecutorRequestFingerprintV2({
  operation: containedAuthorityContext.operation,
  payload: containedPayload,
  rollbackBaseline: containedBaseline,
});
const containedExecutorInput = createContainedExecutorInputEnvelopeV2({
  operation: containedAuthorityContext.operation,
  payload: containedPayload,
  rollbackBaseline: containedBaseline,
});
containedAuthorityContext.executorInput = containedExecutorInput;
const containedDecision = evaluateOperateAuthorityV2('operate.action.execute', containedAuthorityContext);
const containedTarget = createDisposableLocalProjectTargetV2({
  target: containedAuthorityContext.operation.target, initialValue: containedInitialValue,
});
const containedReceipt = OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.execute({
  authorityContext: containedAuthorityContext, authorityDecision: containedDecision,
  executorInput: containedExecutorInput, binding: projectBinding,
  executor: projectExecutorSelection.registration, targetAdapter: containedTarget,
});
pass(containedDecision.allowed && containedReceipt.effectCount === 1
  && containedTarget.read().value.status === 'after',
'trusted connector binding executes one explicit in-memory project target beneath canonical authority');
pass(sha256Jcs(OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.execute({
  authorityContext: containedAuthorityContext, authorityDecision: containedDecision,
  executorInput: containedExecutorInput, binding: projectBinding,
  executor: projectExecutorSelection.registration, targetAdapter: containedTarget,
})) === sha256Jcs(containedReceipt),
'contained executor replay is deterministic and intrinsically idempotent');

const reconcilePayloadValue = { status: 'different' };
const reconcileOperation = clone(containedAuthorityContext.operation);
const reconcilePayload = {
  artifactId: reconcileOperation.inputArtifactIds[0],
  contentHash: sha256Jcs(reconcilePayloadValue),
  value: reconcilePayloadValue,
};
reconcileOperation.requestFingerprint = deriveContainedExecutorRequestFingerprintV2({
  operation: reconcileOperation,
  payload: reconcilePayload,
  rollbackBaseline: containedBaseline,
});
const reconcileExecutorInput = createContainedExecutorInputEnvelopeV2({
  operation: reconcileOperation,
  payload: reconcilePayload,
  rollbackBaseline: containedBaseline,
});
assert.throws(() => OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.reconcile({
  targetAdapter: containedTarget,
  executorInput: reconcileExecutorInput,
  binding: projectBinding,
  executor: projectExecutorSelection.registration,
}), { code: 'OPERATION_CONFLICT' });
pass(containedTarget.describe().effectCount === 1,
  'reconciliation rejects a mismatched request fingerprint without a second contained effect');

const containedRollbackContext = clone(rollbackAuthorityContext);
containedRollbackContext.executor = clone(projectExecutorSelection.registration);
containedRollbackContext.governedExtensions = clone(OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2);
containedRollbackContext.operation.connector = clone(projectBinding.connector);
containedRollbackContext.trustedExecutorBinding = projectBinding;
containedRollbackContext.rollbackPlan.baselineHash = sha256Jcs(containedInitialValue);
containedRollbackContext.operationHistory = [{
  ...clone(containedAuthorityContext.operation),
  state: 'succeeded',
  resultId: containedRollbackContext.rollbackPlan.executionResultId,
  requestFingerprint: `sha256:${'8'.repeat(64)}`,
}];
const containedRollbackPayloadValue = { command: 'restore-reviewed-baseline' };
const containedRollbackPayload = {
  artifactId: containedRollbackContext.operation.inputArtifactIds[0],
  contentHash: sha256Jcs(containedRollbackPayloadValue),
  value: containedRollbackPayloadValue,
};
const containedRollbackBaseline = {
  artifactId: containedRollbackContext.rollbackPlan.baselineArtifactId,
  contentHash: sha256Jcs(containedInitialValue),
  value: containedInitialValue,
};
containedRollbackContext.operation.requestFingerprint = deriveContainedExecutorRequestFingerprintV2({
  operation: containedRollbackContext.operation,
  payload: containedRollbackPayload,
  rollbackBaseline: containedRollbackBaseline,
});
const containedRollbackInput = createContainedExecutorInputEnvelopeV2({
  operation: containedRollbackContext.operation,
  payload: containedRollbackPayload,
  rollbackBaseline: containedRollbackBaseline,
});
containedRollbackContext.executorInput = containedRollbackInput;
const containedRollbackDecision = evaluateOperateAuthorityV2('operate.action.rollback', containedRollbackContext);
pass(containedRollbackDecision.allowed,
  'canonical rollback authority validates the declared parent operation history before connector dispatch');
assert.throws(() => OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.rollback({
  authorityContext: containedRollbackContext,
  authorityDecision: containedRollbackDecision,
  executorInput: containedRollbackInput,
  binding: projectBinding,
  executor: projectExecutorSelection.registration,
  targetAdapter: containedTarget,
}), { code: 'OPERATION_CONFLICT' });
pass(containedTarget.read().value.status === 'after' && containedTarget.describe().effectCount === 1,
  'rollback rejects a parent-history fingerprint that differs from the stored receipt before mutation');

assert.throws(() => createTrustedExecutorBindingV2({
  selection: projectExecutorSelection,
  trustedHost: { ...OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2 },
}), { code: 'EXECUTOR_UNAVAILABLE' });
pass(true, 'caller-constructed connector host cannot obtain a trusted binding');
pass(evaluateOperateAuthorityV2('operate.action.execute', {
  ...containedAuthorityContext,
  trustedExecutorBinding: clone(projectBinding),
}).allowed === false, 'caller-constructed binding clone is denied by authorization');

const substitutedContainedTarget = createDisposableLocalProjectTargetV2({
  target: { ...containedAuthorityContext.operation.target, id: 'record-substituted' },
  initialValue: containedInitialValue,
});
assert.throws(() => OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2.execute({
  authorityContext: containedAuthorityContext, authorityDecision: containedDecision,
  executorInput: containedExecutorInput, binding: projectBinding,
  executor: projectExecutorSelection.registration, targetAdapter: substitutedContainedTarget,
}), { code: 'OPERATION_CONFLICT' });
pass(substitutedContainedTarget.read().value.status === 'before',
  'same-kind target substitution fails before contained mutation');

const divergentContainedInput = clone(containedExecutorInput);
divergentContainedInput.payload.value.status = 'different';
pass(evaluateOperateAuthorityV2('operate.action.execute', {
  ...containedAuthorityContext, executorInput: divergentContainedInput,
}).allowed === false, 'divergent initial payload is denied before target access');

pass(OPERATE_GOVERNED_CORE_PROHIBITIONS_V2.every((identifier) => {
  try {
    createDisposableLocalProjectTargetV2({
      target: { kind: 'project-record', id: `record-${identifier}`, revision: 'rev-0001' },
      initialValue: { normalized_value: identifier.replaceAll('-', ' ') },
    });
    return false;
  } catch (error) {
    return error?.code === 'CAPABILITY_DENIED';
  }
}), 'normalized contained values reject every core prohibition');
pass([
  { releasePublic: true }, { intent: 'release' }, { removeRecord: true },
  { intent: 'erase-record' }, { wipeRecord: true }, { intent: 'remit-funds' },
  { pay: true, send: true }, { pay: 'transfer' },
  { moneyTransfer: true }, { money: 'transfer' },
  { shipProduction: true }, { intent: 'ship-production' },
  { deliverProduction: true }, { intent: 'delivery-production' },
  { messageCustomer: true }, { intent: 'message-customer' },
  { emailCustomer: true }, { intent: 'email-customer' },
  { reachoutCustomer: true }, { intent: 'reachout-customer' },
].every((initialValue, index) => {
  try {
    createDisposableLocalProjectTargetV2({
      target: { kind: 'project-record', id: `semantic-base-${index}`, revision: 'rev-0001' },
      initialValue,
    });
    return false;
  } catch (error) {
    return error?.code === 'CAPABILITY_DENIED';
  }
}), 'contained base-lemma key/value and composed-pay repros fail closed');
for (const [operation, context] of Object.entries(actionContexts)) {
  pass(evaluateOperateGuardV2(operation, context).allowed, `${operation}: guard allows`);
  const action = deriveOperateAllowedActionsV2(context).find(({ tool }) => tool === operation);
  pass(Boolean(action), `${operation}: complete action emitted`);
  if (operation === 'operate.assignment.claim') {
    pass(!Object.hasOwn(action.arguments.actor, 'sessionId'), 'claim action excludes internal session binding');
  }
  pass(assertOperateAuthorizedV2(operation, context), `${operation}: emitted action executes`);
}
for (const [label, overrides, code] of [
  ['cross-assignment request', {
    submitRequest: { ...actionContexts['operate.assignment.submit'].submitRequest, assignmentId: 'asg_other0001' },
  }, 'SUBMISSION_ID_CONFLICT'],
  ['cross-cycle submission', {
    submission: { ...issuedSubmission, cycleId: 'cyc_other0001' },
  }, 'SUBMISSION_ID_CONFLICT'],
  ['different media contract', {
    submitRequest: { ...actionContexts['operate.assignment.submit'].submitRequest, mediaType: 'text/plain' },
  }, 'RESULT_CONTRACT_INVALID'],
]) {
  const context = { ...actionContexts['operate.assignment.submit'], ...overrides };
  pass(evaluateOperateGuardV2('operate.assignment.submit', context).error.code === code, label);
  pass(!deriveOperateAllowedActionsV2(context).some(({ tool }) => tool === 'operate.assignment.submit'),
    `${label}: forbidden action omitted`);
}

// Hash-chain validation and deterministic no-model replay produce one accepted truth.
const events = happyPathEvents();
const head = verifyOperatingRuntimeEventChainV2(events);
pass(head.sequence === events.length && head.hash === events.at(-1).eventHash, 'event chain head');
const replayHook = createNoModelReplayHookV2();
const firstReplay = reduceOperatingRuntimeEventsV2(events, { initialState: replayBase(), replayHook });
const secondReplay = reduceOperatingRuntimeEventsV2(clone(events), { initialState: replayBase() });
pass(replayHook.dispatchCount === 0, 'replay dispatches no model/runtime');
pass(sha256Jcs(firstReplay) === sha256Jcs(secondReplay), 'replay is byte-deterministic');
pass(firstReplay.submissions[0].state === 'accepted', 'one accepted submission');
pass(firstReplay.submissionReplayIndex.length === 1, 'one durable replay identity');
pass(firstReplay.eventReplayIndex.length === events.length, 'complete durable Event identity view');
const replayedEvent = reduceOperatingRuntimeEventsV2([clone(events[0])], {
  initialState: clone(firstReplay),
});
pass(sha256Jcs(replayedEvent) === sha256Jcs(firstReplay), 'same Event identity/content replays without append');
const conflictingEvent = createOperatingRuntimeEventV2({
  eventId: events[0].eventId, timestamp: NEXT_TIME, cycleId: 'cyc_00000001',
  type: 'cycle.input-bound', entityId: 'inb_00000001', actor: { kind: 'engine', id: 'openplanr' },
  causationId: firstReplay.eventReplayIndex.at(-1).eventId, correlationId: 'corr-conflict',
  payload: {
    inputBindingId: 'inb_00000001', scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0',
    contractVersions: { 'advisor-result': '1.0.0' },
  },
}, { previousEvent: firstReplay.eventHead });
assert.throws(
  () => reduceOperatingRuntimeEventsV2([conflictingEvent], { initialState: clone(firstReplay) }),
  (error) => error?.code === 'STATE_TRANSITION_INVALID' && error?.details?.retryable === false,
  'same Event identity with different canonical content conflicts',
);
checks += 1;

// OP-12/13: creation is pending-only; the scheduler atomically appends the
// exact zero-dependency availability Event and replay cannot append another.
const zeroDependencyCreation = baseAssignment();
const creationOnly = events.slice(0, 2);
const pendingOnly = reduceOperatingRuntimeEventsV2(creationOnly, { initialState: replayBase() });
const scheduledCreation = scheduleOperatingRuntimeEventsV2(creationOnly, { initialState: replayBase() });
const [zeroDependencyRelease] = scheduledCreation.releaseEvents;
const zeroDependencyAvailable = scheduledCreation.state;
pass(zeroDependencyAvailable.assignments[0].state === 'available', 'zero-dependency Assignment becomes available through scheduler Event');
pass(zeroDependencyAvailable.eventReplayIndex.filter(({ eventId }) => eventId === zeroDependencyRelease.eventId).length === 1,
  'zero-dependency release has exactly one durable Event provenance');
pass(sha256Jcs(scheduleOperatingRuntimeEventsV2(creationOnly, {
  initialState: clone(zeroDependencyAvailable),
}).state) === sha256Jcs(zeroDependencyAvailable), 'replayed creation contributes no second availability Event');
const beforeAvailabilityBypass = sha256Jcs(pendingOnly);
assert.throws(
  () => createOperatingRuntimeEventV2({
    eventId: 'evt-zero-created-bypass', timestamp: NEXT_TIME, cycleId: 'cyc_00000001', type: 'assignment.created',
    entityId: 'asg_00000002', actor: { kind: 'runtime', id: 'openplanr' }, causationId: 'evt-002',
    correlationId: 'corr-zero-created-bypass',
    payload: {
      ...baseAssignment('available'), assignmentId: 'asg_00000002', availableAt: NEXT_TIME,
    },
  }, { previousEvent: { sequence: pendingOnly.eventHead.sequence, eventHash: pendingOnly.eventHead.hash } }),
  (error) => error?.code === 'E_PROTOCOL_ARTIFACT_INVALID',
  'direct available creation bypass fails closed',
);
pass(sha256Jcs(pendingOnly) === beforeAvailabilityBypass, 'direct available creation bypass does not mutate projection');

const schedulerFixture = fixture('scheduler-valid.json');
pass(schedulerFixture.zeroDependency.expectedReleaseOrder[0] === zeroDependencyCreation.assignmentId,
  'scheduler fixture declares deterministic zero-dependency release order');

// Direct submissions are a single pure transaction: stage exact bytes, validate,
// construct immutable metadata/events, commit the projection, and replay the
// original acknowledgement without a model/runtime dispatch.
const beforeDirectAcceptance = reduceOperatingRuntimeEventsV2(events.slice(0, 5), { initialState: replayBase() });
const directHook = createNoModelReplayHookV2();
const directRequest = {
  assignmentId: 'asg_00000001', submissionId: 'sub_00000001',
  actor: { actorId: 'agent-001', kind: 'agent', runtime: 'codex' },
  mediaType: 'application/json', encoding: 'utf-8', contentBase64: directBytes.contentBase64,
};
const directDraft = {
  artifactId: 'art_00000003', artifactType: 'advisor-result', inputArtifactIds: [],
  timestamp: NEXT_TIME, validatorVersion: '1.0.0', correlationId: 'corr-direct-001',
  eventIds: { submitted: 'evt-006', artifactCreated: 'evt-007', validated: 'evt-008' },
};
const directAccepted = acceptOperatingAssignmentSubmissionV2(directRequest, directDraft, {
  initialState: beforeDirectAcceptance,
  replayHook: directHook,
});
pass(directHook.dispatchCount === 0, 'direct submission does not invoke a model/runtime');
pass(Buffer.compare(directAccepted.stagedRawBytes, directDecoded) === 0, 'direct submission stages exact bytes');
pass(directAccepted.artifact.rawHash === directBytes.rawHash, 'Artifact records exact-byte raw hash');
pass(directAccepted.artifact.canonicalHash === directBytes.canonicalHash, 'Artifact records separate canonical hash');
pass(directAccepted.events.length === 3 && directAccepted.state.assignments[0].state === 'validated',
  'direct submission commits Artifact/Event/projection together');
const directReplay = acceptOperatingAssignmentSubmissionV2(directRequest, {
  ...directDraft,
  artifactId: 'art_unused_0001',
  eventIds: { submitted: 'evt-unused-001', artifactCreated: 'evt-unused-002', validated: 'evt-unused-003' },
}, { initialState: directAccepted.state });
pass(directReplay.replayed && directReplay.events.length === 0 && sha256Jcs(directReplay.response) === sha256Jcs(directAccepted.response),
  'same submission ID and exact bytes replay without a duplicate effect');
const directConflict = Buffer.from('{"kind":"operating-advisor-result","schemaVersion":"1.0.0","protocolVersion":"2.0.0","café":"Δ","items":[]}', 'utf8').toString('base64');
assert.throws(
  () => acceptOperatingAssignmentSubmissionV2({ ...directRequest, contentBase64: directConflict }, directDraft, {
    initialState: directAccepted.state,
  }),
  (error) => error?.code === 'SUBMISSION_ID_CONFLICT' && error?.details?.retryable === false,
  'same submission ID with different raw bytes conflicts even when canonical JSON is equivalent',
);
checks += 1;

// Derived scope work remains readable after a source Cycle closes; the ledger
// is a deterministic projection rather than a second mutable store.
const emptyLedgerState = createEmptyOperatingRuntimeStateV2(TIME);
const emptyLedger = buildOperatingWorkLedgerV2(emptyLedgerState, {
  scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0',
});
pass(
  emptyLedger.kind === 'operating-work-ledger'
    && emptyLedger.findings.length === 0
    && emptyLedger.cycleLinks.length === 0
    && sha256Jcs(emptyLedgerState) === sha256Jcs(createEmptyOperatingRuntimeStateV2(TIME)),
  'persistent-work ledger is deterministic, read-only, and scope-bound',
);
pass(
  sha256Jcs(OPERATE_EXECUTION_VERIFICATION_STATUSES_V2)
    === sha256Jcs(executionVerificationValid.executionStatuses)
    && sha256Jcs(OPERATE_HYPOTHESIS_VERIFICATION_STATUSES_V2)
      === sha256Jcs(executionVerificationValid.hypothesisStatuses),
  'execution result and hypothesis verification vocabularies remain distinct and fixture-bound',
);
pass(
  executionVerificationValid.replay.dispatchCount === 0
    && executionVerificationValid.replay.effectCount === 0
    && executionVerificationValid.verificationOwnership.effectCompletionImpliesHypothesisSuccess === false,
  'execution verification replay is effect-free and never infers hypothesis success',
);

process.stdout.write(`${JSON.stringify({
  ok: true,
  protocolVersion: VERSION,
  contracts: OPERATE_RUNTIME_CONTRACT_KINDS.length,
  checks,
})}\n`);
