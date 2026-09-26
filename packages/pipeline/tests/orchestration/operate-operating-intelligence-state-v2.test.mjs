import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildOperatingIntelligenceStateTransitionV2 } from '../../lib/operate/operating-intelligence-state-v2.mjs';
import { deriveOperatingSnapshotRuntimeHashV2 } from '../../lib/operate/operating-snapshots-v2.mjs';
import { buildOperatingTriggerScenarioTransitionV2 } from '../../lib/operate/operating-triggers-v2.mjs';
import {
  createEmptyOperatingRuntimeStateV2,
  createOperatingArtifactByteStoreV2,
  materializeOperatingStateSnapshotV2,
  recordOperatingIntelligenceStateV2,
  reduceOperatingRuntimeEventsV2,
} from '../../lib/operate/runtime-foundation.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

const TIME = '2026-08-09T12:00:00.000Z';
const FACT_TIME = '2026-08-09T12:02:00.000Z';
const valid = JSON.parse(
  readFileSync(
    new URL(
      '../../conformance/fixtures/operating-runtime-v2/all-contracts-valid.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const clone = (value) => structuredClone(value);
const rawHash = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function bindAcceptedSubmissionProof(submission, artifact) {
  const accepted = {
    ...submission,
    artifactId: artifact.artifactId,
    rawHash: artifact.rawHash,
    canonicalHash: artifact.canonicalHash,
    sizeBytes: artifact.sizeBytes,
    responseData: {
      accepted: true,
      artifactId: artifact.artifactId,
      rawHash: artifact.rawHash,
      sizeBytes: artifact.sizeBytes,
      assignmentState: 'validated',
    },
  };
  return {
    submission: accepted,
    replay: {
      submissionId: accepted.submissionId,
      assignmentId: accepted.assignmentId,
      rawHash: accepted.rawHash,
      canonicalHash: accepted.canonicalHash,
      sizeBytes: accepted.sizeBytes,
      artifactId: accepted.artifactId,
      acceptanceEventIds: [...accepted.acceptanceEventIds],
      responseData: clone(accepted.responseData),
    },
  };
}

function checkpoint() {
  const sourceBytes = Buffer.from('opaque fact source; never enters events', 'utf8');
  const evidenceBytes = Buffer.from('opaque typed evidence; never enters events', 'utf8');
  const sourceArtifactId = 'art_intelligence_source_001';
  const evidenceArtifactId = 'art_intelligence_evidence_001';
  const assignmentId = 'asg_intelligence_source_001';
  const sourceArtifact = {
    ...clone(valid['operating-artifact']),
    artifactId: sourceArtifactId,
    assignmentId,
    rawHash: rawHash(sourceBytes),
    canonicalHash: null,
    sizeBytes: sourceBytes.byteLength,
    inputArtifactIds: [],
    createdAt: TIME,
  };
  const assignment = {
    ...clone(valid['operating-assignment']),
    assignmentId,
    state: 'validated',
    availableAt: TIME,
    completedAt: TIME,
    inputArtifactIds: [],
    claim: {
      actorId: 'agent-001',
      actorKind: 'agent',
      runtime: 'codex',
      claimId: 'claim_intelligence_source_001',
    },
    attemptPolicy: { ...valid['operating-assignment'].attemptPolicy, attempt: 1 },
  };
  const proof = bindAcceptedSubmissionProof(
    {
      ...clone(valid['operating-submission']),
      submissionId: 'sub_intelligence_source_001',
      assignmentId,
      artifactId: sourceArtifactId,
      rawHash: sourceArtifact.rawHash,
      canonicalHash: null,
      sizeBytes: sourceBytes.byteLength,
      acceptanceEventIds: ['evt_intelligence_source_accepted_001'],
    },
    sourceArtifact,
  );
  const evidenceArtifact = {
    ...clone(sourceArtifact),
    artifactId: evidenceArtifactId,
    artifactType: 'evidence-snapshot',
    schemaId: 'operating-evidence-snapshot',
    artifactSchemaVersion: '1.0.0',
    mediaType: 'application/octet-stream',
    encoding: 'binary',
    rawHash: rawHash(evidenceBytes),
    sizeBytes: evidenceBytes.byteLength,
    inputArtifactIds: [sourceArtifactId],
    createdAt: TIME,
  };
  const evidenceRef = {
    ...clone(valid['operating-evidence-ref']),
    evidenceRefId: 'evr_intelligence_001',
    candidateId: 'evc_intelligence_001',
    sourceArtifactId,
    evidenceArtifactId,
    evidenceArtifactRawHash: evidenceArtifact.rawHash,
    evidenceArtifactCanonicalHash: null,
    resolvedAt: TIME,
  };
  const metric = {
    ...clone(valid['operating-metric']),
    metricId: 'met_intelligence_001',
    sourceArtifactId,
    observationIds: [],
    evidenceRefIds: [evidenceRef.evidenceRefId],
    createdAt: TIME,
    updatedAt: TIME,
  };
  const assumption = {
    ...clone(valid['operating-assumption']),
    assumptionId: 'asm_intelligence_001',
    sourceArtifactId,
    affectedDecisionIds: ['dec_intelligence_001'],
    affectedActionIds: [],
    evidenceRefIds: [evidenceRef.evidenceRefId],
    createdAt: TIME,
    updatedAt: TIME,
    closedAt: null,
    revisionId: 'asm_intelligence_001',
    revision: 1,
    predecessorRevisionId: null,
  };
  const decision = {
    ...clone(valid['operating-decision']),
    decisionId: 'dec_intelligence_001',
    sourceArtifactId,
    sourceCycleId: valid['operating-cycle'].cycleId,
    evidenceRefIds: [evidenceRef.evidenceRefId],
    assumptionIds: [assumption.assumptionId],
    createdAt: TIME,
    updatedAt: TIME,
  };
  const store = createOperatingArtifactByteStoreV2();
  store.stageRaw({ artifact: sourceArtifact, rawBytes: sourceBytes });
  store.stageRaw({ artifact: evidenceArtifact, rawBytes: evidenceBytes });
  const initialState = {
    ...createEmptyOperatingRuntimeStateV2(TIME),
    cycles: [{ ...clone(valid['operating-cycle']), state: 'advising', updatedAt: TIME }],
    inputBindings: [
      { ...clone(valid['operating-cycle-input-binding']), sourceArtifactIds: [], capturedAt: TIME },
    ],
    assignments: [assignment],
    submissions: [proof.submission],
    artifacts: [sourceArtifact, evidenceArtifact],
    evidenceRefs: [evidenceRef],
    submissionReplayIndex: [proof.replay],
  };
  const result = materializeOperatingStateSnapshotV2(
    {
      cycleId: initialState.cycles[0].cycleId,
      scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
      domainContract: { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' },
      sourceArtifactIds: [sourceArtifactId],
      evidenceRefIds: [evidenceRef.evidenceRefId],
      sourceRevisions: [
        { sourceArtifactId, revision: 'r1', evidenceRefIds: [evidenceRef.evidenceRefId] },
      ],
      collections: {
        objectives: [],
        metrics: [metric],
        findings: [],
        decisions: [decision],
        actions: [],
        risks: [],
        assumptions: [assumption],
      },
    },
    {
      snapshotId: 'snp_intelligence_001',
      stateId: 'oms_intelligence_001',
      timestamp: TIME,
      correlationId: 'corr_intelligence_snapshot_001',
      eventIds: { snapshot: 'evt_intelligence_snapshot_001', state: 'evt_intelligence_state_001' },
    },
    { initialState, artifactStore: store },
  );
  return {
    initialState,
    result,
    store,
    sourceArtifactId,
    evidenceRef,
    metric,
    assumption,
    decision,
  };
}

function facts(seed) {
  const { result, sourceArtifactId, evidenceRef, metric, assumption, decision } = seed;
  const common = {
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    sourceArtifactId,
  };
  return {
    claims: [
      {
        ...clone(valid['operating-claim']),
        ...common,
        claimId: 'clm_intelligence_001',
        supportingEvidenceRefIds: [evidenceRef.evidenceRefId],
        contradictingEvidenceRefIds: [],
        assumptionIds: [assumption.assumptionId],
        createdAt: FACT_TIME,
      },
    ],
    metricObservations: [
      {
        ...clone(valid['operating-metric-observation']),
        ...common,
        observationId: 'mob_intelligence_001',
        metricId: metric.metricId,
        unit: metric.unit,
        observedAt: FACT_TIME,
        snapshotId: result.snapshot.snapshotId,
        evidenceRefIds: [evidenceRef.evidenceRefId],
      },
    ],
    risks: [
      {
        ...clone(valid['operating-risk']),
        ...common,
        riskId: 'rsk_intelligence_001',
        evidenceRefIds: [evidenceRef.evidenceRefId],
        createdAt: FACT_TIME,
        updatedAt: FACT_TIME,
        closedAt: null,
        revisionId: 'rsk_intelligence_001',
        revision: 1,
        predecessorRevisionId: null,
      },
    ],
    assumptions: [
      {
        ...clone(assumption),
        ...common,
        assumptionId: 'asm_intelligence_invalidated_001',
        status: 'invalidated',
        closedAt: FACT_TIME,
        evidenceRefIds: [evidenceRef.evidenceRefId],
        affectedDecisionIds: [decision.decisionId],
        affectedActionIds: [],
        createdAt: TIME,
        updatedAt: FACT_TIME,
        revisionId: 'asm_intelligence_invalidated_001',
        revision: 2,
        predecessorRevisionId: assumption.revisionId,
      },
    ],
    decisionRevisions: [
      {
        ...clone(decision),
        decisionId: 'dec_intelligence_revision_001',
        revision: 2,
        predecessorDecisionId: decision.decisionId,
        historyDecisionIds: [decision.decisionId],
        createdAt: FACT_TIME,
        updatedAt: FACT_TIME,
      },
    ],
  };
}

function draft() {
  return {
    timestamp: FACT_TIME,
    correlationId: 'corr_intelligence_facts_001',
    eventIds: {
      claims: ['evt_claim_intelligence_001'],
      metricObservations: ['evt_metric_intelligence_001'],
      risks: ['evt_risk_intelligence_001'],
      assumptions: ['evt_assumption_intelligence_001'],
      decisionRevisions: ['evt_decision_intelligence_001'],
    },
  };
}

function intelligenceRequest(seed, fields = {}) {
  return {
    cycleId: seed.result.state.cycles[0].cycleId,
    snapshotId: seed.result.snapshot.snapshotId,
    stateId: seed.result.operatingState.stateId,
    claims: [],
    metricObservations: [],
    risks: [],
    assumptions: [],
    decisionRevisions: [],
    ...fields,
  };
}

function intelligenceDraft({
  timestamp = FACT_TIME,
  correlationId,
  claims = [],
  metricObservations = [],
  risks = [],
  assumptions = [],
  decisionRevisions = [],
} = {}) {
  return {
    timestamp,
    correlationId,
    eventIds: { claims, metricObservations, risks, assumptions, decisionRevisions },
  };
}

test('typed intelligence facts append atomically, retain old Decision history, and replay exactly without model dispatch', () => {
  const seed = checkpoint();
  const request = {
    cycleId: seed.result.state.cycles[0].cycleId,
    snapshotId: seed.result.snapshot.snapshotId,
    stateId: seed.result.operatingState.stateId,
    ...facts(seed),
  };
  const before = sha256Jcs(seed.result.state);
  const first = recordOperatingIntelligenceStateV2(request, draft(), {
    initialState: seed.result.state,
  });
  assert.equal(sha256Jcs(seed.result.state), before);
  assert.deepEqual(
    first.events.map(({ type }) => type),
    [
      'claim.recorded',
      'metric.observed',
      'risk.recorded',
      'assumption.recorded',
      'decision.revised',
    ],
  );
  assert.equal(first.state.claims.length, 1);
  assert.equal(first.state.metricObservations.length, 1);
  assert.equal(first.state.risks.length, 1);
  assert.equal(first.state.assumptions.length, 1);
  assert.equal(first.state.decisions.length, 1);
  assert.equal(
    first.state.operatingModelStates[0].decisions[0].decisionId,
    seed.decision.decisionId,
    'prior decision remains immutable snapshot history',
  );
  assert.doesNotMatch(
    JSON.stringify(first),
    /opaque (?:fact source|typed evidence)/,
    'raw bytes never enter output/events',
  );
  assert.deepEqual(
    reduceOperatingRuntimeEventsV2(first.events, { initialState: seed.result.state }),
    first.state,
  );
  const replay = recordOperatingIntelligenceStateV2(clone(request), clone(draft()), {
    initialState: first.state,
  });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.events, []);
  assert.deepEqual(replay.state, first.state);
});

test('stale/missing evidence, divergent replay, and unsupported effect fields fail before any state mutation', () => {
  const seed = checkpoint();
  const request = {
    cycleId: seed.result.state.cycles[0].cycleId,
    snapshotId: seed.result.snapshot.snapshotId,
    stateId: seed.result.operatingState.stateId,
    ...facts(seed),
  };
  const before = sha256Jcs(seed.result.state);
  const stale = clone(request);
  stale.claims[0].supportingEvidenceRefIds = ['evr_missing_intelligence_001'];
  assert.throws(
    () => recordOperatingIntelligenceStateV2(stale, draft(), { initialState: seed.result.state }),
    { code: 'OPERATING_SCOPE_INVALID' },
  );
  assert.equal(sha256Jcs(seed.result.state), before);
  const first = recordOperatingIntelligenceStateV2(request, draft(), {
    initialState: seed.result.state,
  });
  const divergent = clone(request);
  divergent.claims[0].statement = 'A divergent assertion reuses the same runtime identity.';
  assert.throws(
    () => recordOperatingIntelligenceStateV2(divergent, draft(), { initialState: first.state }),
    { code: 'STATE_TRANSITION_INVALID' },
  );
  assert.throws(
    () =>
      recordOperatingIntelligenceStateV2(
        request,
        {
          ...draft(),
          correlationId: 'corr_intelligence_facts_divergent_001',
        },
        { initialState: first.state },
      ),
    { code: 'STATE_TRANSITION_INVALID' },
  );
  assert.throws(
    () =>
      recordOperatingIntelligenceStateV2({ ...request, execution: { approved: true } }, draft(), {
        initialState: seed.result.state,
      }),
    { code: 'RESULT_CONTRACT_INVALID' },
  );
});

test('intelligence facts reject ambient and hash-mismatched evidence plus mismatched snapshot/state bindings before mutation', () => {
  const seed = checkpoint();
  const request = intelligenceRequest(seed, { claims: [facts(seed).claims[0]] });
  const onlyClaimDraft = intelligenceDraft({
    correlationId: 'corr_intelligence_evidence_adversarial_001',
    claims: ['evt_claim_intelligence_evidence_adversarial_001'],
  });
  const before = sha256Jcs(seed.result.state);

  const ambientState = clone(seed.result.state);
  ambientState.evidenceRefs.push({
    ...clone(seed.evidenceRef),
    evidenceRefId: 'evr_intelligence_ambient_001',
    candidateId: 'evc_intelligence_ambient_001',
  });
  const ambient = clone(request);
  ambient.claims[0].supportingEvidenceRefIds = ['evr_intelligence_ambient_001'];
  const ambientBefore = sha256Jcs(ambientState);
  assert.throws(
    () =>
      recordOperatingIntelligenceStateV2(ambient, onlyClaimDraft, { initialState: ambientState }),
    {
      code: 'OPERATING_SCOPE_INVALID',
    },
  );
  assert.equal(
    sha256Jcs(ambientState),
    ambientBefore,
    'ambient rejection must not mutate its input checkpoint',
  );

  const unusedForeignState = clone(seed.result.state);
  unusedForeignState.evidenceRefs.push({
    ...clone(seed.evidenceRef),
    evidenceRefId: 'evr_intelligence_unused_foreign_001',
    candidateId: 'evc_intelligence_unused_foreign_001',
    scopeId: 'scope-foreign',
    domainId: 'foreign',
    domainVersion: '9.0.0',
    sourceArtifactId: 'art_intelligence_unused_foreign_001',
  });
  const unusedForeignBefore = sha256Jcs(unusedForeignState);
  const unusedForeignAccepted = recordOperatingIntelligenceStateV2(request, onlyClaimDraft, {
    initialState: unusedForeignState,
  });
  assert.equal(
    unusedForeignAccepted.events.length,
    1,
    'foreign registry noise is not selected by this snapshot',
  );
  assert.equal(sha256Jcs(unusedForeignState), unusedForeignBefore);

  const crossSource = clone(request);
  crossSource.claims[0].sourceArtifactId = 'art_intelligence_foreign_source_001';
  assert.throws(
    () =>
      recordOperatingIntelligenceStateV2(crossSource, onlyClaimDraft, {
        initialState: seed.result.state,
      }),
    {
      code: 'STATE_TRANSITION_INVALID',
    },
    'the runtime must reject a record whose EvidenceRefs belong to another source Artifact',
  );

  const hashMismatchState = clone(seed.result.state);
  hashMismatchState.evidenceRefs[0].evidenceArtifactRawHash = `sha256:${'f'.repeat(64)}`;
  const hashMismatchBefore = sha256Jcs(hashMismatchState);
  assert.throws(
    () =>
      recordOperatingIntelligenceStateV2(request, onlyClaimDraft, {
        initialState: hashMismatchState,
      }),
    {
      code: 'STATE_TRANSITION_INVALID',
    },
  );
  assert.equal(sha256Jcs(seed.result.state), before);
  assert.equal(
    sha256Jcs(hashMismatchState),
    hashMismatchBefore,
    'hash rejection must not mutate its input checkpoint',
  );

  const nonEvidenceArtifactState = clone(seed.result.state);
  const nonEvidenceArtifact = nonEvidenceArtifactState.artifacts.find(
    ({ artifactId }) => artifactId === seed.evidenceRef.evidenceArtifactId,
  );
  nonEvidenceArtifact.artifactType = 'advisor-result';
  nonEvidenceArtifact.schemaId = 'advisor-result';
  const nonEvidenceArtifactBefore = sha256Jcs(nonEvidenceArtifactState);
  assert.throws(
    () =>
      recordOperatingIntelligenceStateV2(request, onlyClaimDraft, {
        initialState: nonEvidenceArtifactState,
      }),
    {
      code: 'STATE_TRANSITION_INVALID',
    },
  );
  assert.equal(
    sha256Jcs(nonEvidenceArtifactState),
    nonEvidenceArtifactBefore,
    'non-evidence artifact rejection must not mutate its input checkpoint',
  );

  const wrongState = { ...request, stateId: 'oms_intelligence_wrong_001' };
  assert.throws(
    () =>
      recordOperatingIntelligenceStateV2(wrongState, onlyClaimDraft, {
        initialState: seed.result.state,
      }),
    {
      code: 'OPERATING_SCOPE_INVALID',
    },
  );
  assert.equal(sha256Jcs(seed.result.state), before);
});

test('public intelligence and scenario builders enforce source-matched EvidenceRefs independently of the runtime reducer', () => {
  const seed = checkpoint();
  const foreignSourceArtifactId = 'art_intelligence_foreign_source_002';
  const foreignEvidenceRef = {
    ...clone(seed.evidenceRef),
    evidenceRefId: 'evr_intelligence_foreign_002',
    candidateId: 'evc_intelligence_foreign_002',
    sourceArtifactId: foreignSourceArtifactId,
    evidenceArtifactId: 'art_intelligence_foreign_evidence_002',
  };
  const foreignEvidenceArtifact = {
    ...clone(
      seed.result.state.artifacts.find(
        ({ artifactId }) => artifactId === seed.evidenceRef.evidenceArtifactId,
      ),
    ),
    artifactId: foreignEvidenceRef.evidenceArtifactId,
    inputArtifactIds: [foreignSourceArtifactId],
  };
  const snapshot = clone(seed.result.snapshot);
  snapshot.sourceArtifactIds = [foreignSourceArtifactId, seed.sourceArtifactId].sort();
  snapshot.evidenceRefIds = [
    seed.evidenceRef.evidenceRefId,
    foreignEvidenceRef.evidenceRefId,
  ].sort();
  snapshot.sourceRevisions = [
    {
      sourceArtifactId: foreignSourceArtifactId,
      revision: 'r1',
      evidenceRefIds: [foreignEvidenceRef.evidenceRefId],
    },
    ...snapshot.sourceRevisions,
  ].sort((left, right) => left.sourceArtifactId.localeCompare(right.sourceArtifactId));
  snapshot.runtimeHash = deriveOperatingSnapshotRuntimeHashV2(snapshot);
  const evidenceArtifacts = [...seed.result.state.artifacts, foreignEvidenceArtifact];
  const crossSourceClaim = {
    ...facts(seed).claims[0],
    supportingEvidenceRefIds: [foreignEvidenceRef.evidenceRefId],
  };
  assert.throws(
    () =>
      buildOperatingIntelligenceStateTransitionV2({
        snapshot,
        operatingState: seed.result.operatingState,
        evidenceRefs: [seed.evidenceRef, foreignEvidenceRef],
        evidenceArtifacts,
        existingDecisions: [],
        existingActions: [],
        claims: [crossSourceClaim],
      }),
    { code: 'STATE_TRANSITION_INVALID' },
  );

  const scenario = {
    ...clone(valid['operating-scenario']),
    scenarioId: 'scn_intelligence_cross_source_002',
    snapshotId: snapshot.snapshotId,
    sourceArtifactId: seed.sourceArtifactId,
    createdAt: FACT_TIME,
    assumptionIds: [seed.assumption.assumptionId],
    evidenceRefIds: [seed.evidenceRef.evidenceRefId],
    base: {
      ...clone(valid['operating-scenario'].base),
      sourceArtifactId: seed.sourceArtifactId,
      assumptionIds: [seed.assumption.assumptionId],
      evidenceRefIds: [foreignEvidenceRef.evidenceRefId],
    },
    upside: {
      ...clone(valid['operating-scenario'].upside),
      sourceArtifactId: seed.sourceArtifactId,
      assumptionIds: [seed.assumption.assumptionId],
      evidenceRefIds: [seed.evidenceRef.evidenceRefId],
    },
    downside: {
      ...clone(valid['operating-scenario'].downside),
      sourceArtifactId: seed.sourceArtifactId,
      assumptionIds: [seed.assumption.assumptionId],
      evidenceRefIds: [seed.evidenceRef.evidenceRefId],
    },
  };
  assert.throws(
    () =>
      buildOperatingTriggerScenarioTransitionV2({
        snapshot,
        operatingState: seed.result.operatingState,
        evidenceRefs: [seed.evidenceRef, foreignEvidenceRef],
        evidenceArtifacts,
        scenarios: [scenario],
        triggers: [],
      }),
    { code: 'STATE_TRANSITION_INVALID' },
  );
});

test('explicit snapshot bindings permit one accepted source Artifact to be reused by multiple immutable snapshots', () => {
  const seed = checkpoint();
  const repeated = materializeOperatingStateSnapshotV2(
    {
      cycleId: seed.result.state.cycles[0].cycleId,
      scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
      domainContract: { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' },
      sourceArtifactIds: [seed.sourceArtifactId],
      evidenceRefIds: [seed.evidenceRef.evidenceRefId],
      sourceRevisions: [
        {
          sourceArtifactId: seed.sourceArtifactId,
          revision: 'r2',
          evidenceRefIds: [seed.evidenceRef.evidenceRefId],
        },
      ],
      collections: {
        objectives: [],
        metrics: [seed.metric],
        findings: [],
        decisions: [seed.decision],
        actions: [],
        risks: [],
        assumptions: [seed.assumption],
      },
    },
    {
      snapshotId: 'snp_intelligence_reused_source_002',
      stateId: 'oms_intelligence_reused_source_002',
      timestamp: '2026-08-09T12:01:00.000Z',
      correlationId: 'corr_intelligence_reused_source_002',
      eventIds: {
        snapshot: 'evt_intelligence_reused_source_snapshot_002',
        state: 'evt_intelligence_reused_source_state_002',
      },
    },
    { initialState: seed.result.state, artifactStore: seed.store },
  );
  const record = {
    ...facts(seed).claims[0],
    claimId: 'clm_intelligence_reused_source_002',
  };
  const request = {
    ...intelligenceRequest(seed, { claims: [record] }),
    snapshotId: repeated.snapshot.snapshotId,
    stateId: repeated.operatingState.stateId,
  };
  const first = recordOperatingIntelligenceStateV2(
    request,
    intelligenceDraft({
      correlationId: 'corr_intelligence_reused_source_fact_002',
      claims: ['evt_claim_intelligence_reused_source_002'],
    }),
    { initialState: repeated.state },
  );
  assert.equal(first.state.claims[0].claimId, record.claimId);
  assert.equal(first.events[0].payload.snapshotId, repeated.snapshot.snapshotId);
  assert.equal(first.events[0].payload.stateId, repeated.operatingState.stateId);
  assert.equal(
    first.events[0].requestHash,
    sha256Jcs({
      protocolVersion: '2.0.0',
      operation: 'record-operating-intelligence-state-v2',
      request,
      draft: intelligenceDraft({
        correlationId: 'corr_intelligence_reused_source_fact_002',
        claims: ['evt_claim_intelligence_reused_source_002'],
      }),
    }),
  );
});

test('Risk and Assumption revisions are append-only, lifecycle-valid, and preserve immutable predecessor identity', () => {
  const seed = checkpoint();
  const initialRisk = facts(seed).risks[0];
  const initialRiskRequest = intelligenceRequest(seed, { risks: [initialRisk] });
  const initialRiskDraft = intelligenceDraft({
    correlationId: 'corr_risk_revision_initial_001',
    risks: ['evt_risk_revision_initial_001'],
  });
  const firstRisk = recordOperatingIntelligenceStateV2(initialRiskRequest, initialRiskDraft, {
    initialState: seed.result.state,
  });
  const revisedRisk = {
    ...clone(initialRisk),
    riskId: 'rsk_intelligence_002',
    revisionId: 'rsk_intelligence_002',
    revision: 2,
    predecessorRevisionId: initialRisk.revisionId,
    state: 'monitoring',
    updatedAt: '2026-08-09T12:03:00.000Z',
  };
  const revisedRiskRequest = intelligenceRequest(seed, { risks: [revisedRisk] });
  const revisedRiskDraft = intelligenceDraft({
    timestamp: revisedRisk.updatedAt,
    correlationId: 'corr_risk_revision_successor_002',
    risks: ['evt_risk_revision_successor_002'],
  });
  const secondRisk = recordOperatingIntelligenceStateV2(revisedRiskRequest, revisedRiskDraft, {
    initialState: firstRisk.state,
  });
  assert.deepEqual(
    secondRisk.state.risks.map(({ riskId }) => riskId),
    [initialRisk.riskId, revisedRisk.riskId],
  );
  assert.equal(secondRisk.state.risks[0].state, 'open', 'the predecessor remains durable history');

  const riskForkBefore = sha256Jcs(secondRisk.state);
  const forkedRisk = {
    ...revisedRisk,
    riskId: 'rsk_intelligence_fork_002',
    revisionId: 'rsk_intelligence_fork_002',
    updatedAt: '2026-08-09T12:04:00.000Z',
    predecessorRevisionId: initialRisk.revisionId,
  };
  assert.throws(
    () =>
      recordOperatingIntelligenceStateV2(
        intelligenceRequest(seed, { risks: [forkedRisk] }),
        intelligenceDraft({
          timestamp: forkedRisk.updatedAt,
          correlationId: 'corr_risk_revision_fork_002',
          risks: ['evt_risk_revision_fork_002'],
        }),
        { initialState: secondRisk.state },
      ),
    { code: 'STATE_TRANSITION_INVALID' },
    'a predecessor can have only one successor',
  );
  assert.equal(sha256Jcs(secondRisk.state), riskForkBefore);

  assert.throws(
    () =>
      recordOperatingIntelligenceStateV2(
        intelligenceRequest(seed, { risks: [initialRisk] }),
        intelligenceDraft({
          correlationId: 'corr_risk_identity_collision_001',
          risks: ['evt_risk_identity_collision_001'],
        }),
        { initialState: firstRisk.state },
      ),
    { code: 'CONCURRENT_MODIFICATION' },
    'a new Event cannot reset an existing Risk identity',
  );

  const riskBefore = sha256Jcs(firstRisk.state);
  for (const invalid of [
    {
      ...revisedRisk,
      riskId: 'rsk_intelligence_wrong_predecessor_003',
      revisionId: 'rsk_intelligence_wrong_predecessor_003',
      predecessorRevisionId: 'rsk_missing_003',
    },
    {
      ...revisedRisk,
      riskId: 'rsk_intelligence_changed_statement_003',
      revisionId: 'rsk_intelligence_changed_statement_003',
      statement: 'A changed Risk statement is a new identity, not a revision.',
    },
    {
      ...revisedRisk,
      riskId: 'rsk_intelligence_changed_created_003',
      revisionId: 'rsk_intelligence_changed_created_003',
      createdAt: revisedRisk.updatedAt,
    },
  ]) {
    assert.throws(
      () =>
        recordOperatingIntelligenceStateV2(
          intelligenceRequest(seed, { risks: [invalid] }),
          intelligenceDraft({
            timestamp: invalid.updatedAt,
            correlationId: `corr_${invalid.riskId}`,
            risks: [`evt_${invalid.riskId}`],
          }),
          { initialState: firstRisk.state },
        ),
      { code: 'STATE_TRANSITION_INVALID' },
    );
  }
  assert.equal(sha256Jcs(firstRisk.state), riskBefore);

  const validatedAssumption = {
    ...clone(seed.assumption),
    assumptionId: 'asm_intelligence_validated_002',
    status: 'validated',
    closedAt: null,
    revisionId: 'asm_intelligence_validated_002',
    revision: 2,
    predecessorRevisionId: seed.assumption.revisionId,
    updatedAt: FACT_TIME,
  };
  const firstAssumption = recordOperatingIntelligenceStateV2(
    intelligenceRequest(seed, { assumptions: [validatedAssumption] }),
    intelligenceDraft({
      correlationId: 'corr_assumption_revision_validated_002',
      assumptions: ['evt_assumption_revision_validated_002'],
    }),
    { initialState: seed.result.state },
  );
  const closedAssumption = {
    ...clone(validatedAssumption),
    assumptionId: 'asm_intelligence_closed_003',
    status: 'closed',
    revisionId: 'asm_intelligence_closed_003',
    revision: 3,
    predecessorRevisionId: validatedAssumption.revisionId,
    updatedAt: '2026-08-09T12:03:00.000Z',
    closedAt: '2026-08-09T12:03:00.000Z',
  };
  const secondAssumption = recordOperatingIntelligenceStateV2(
    intelligenceRequest(seed, { assumptions: [closedAssumption] }),
    intelligenceDraft({
      timestamp: closedAssumption.updatedAt,
      correlationId: 'corr_assumption_revision_closed_003',
      assumptions: ['evt_assumption_revision_closed_003'],
    }),
    { initialState: firstAssumption.state },
  );
  assert.deepEqual(
    secondAssumption.state.assumptions.map(({ assumptionId }) => assumptionId),
    [closedAssumption.assumptionId, validatedAssumption.assumptionId],
  );
  const assumptionBefore = sha256Jcs(firstAssumption.state);
  const invalidAssumption = {
    ...closedAssumption,
    assumptionId: 'asm_intelligence_wrong_predecessor_004',
    revisionId: 'asm_intelligence_wrong_predecessor_004',
    predecessorRevisionId: seed.assumption.revisionId,
    revision: 3,
  };
  assert.throws(
    () =>
      recordOperatingIntelligenceStateV2(
        intelligenceRequest(seed, { assumptions: [invalidAssumption] }),
        intelligenceDraft({
          timestamp: invalidAssumption.updatedAt,
          correlationId: 'corr_assumption_wrong_predecessor_004',
          assumptions: ['evt_assumption_wrong_predecessor_004'],
        }),
        { initialState: firstAssumption.state },
      ),
    { code: 'STATE_TRANSITION_INVALID' },
  );
  assert.equal(sha256Jcs(firstAssumption.state), assumptionBefore);

  const assumptionForkBefore = sha256Jcs(secondAssumption.state);
  const forkedAssumption = {
    ...closedAssumption,
    assumptionId: 'asm_intelligence_fork_004',
    revisionId: 'asm_intelligence_fork_004',
    predecessorRevisionId: validatedAssumption.revisionId,
    updatedAt: '2026-08-09T12:04:00.000Z',
    closedAt: '2026-08-09T12:04:00.000Z',
  };
  assert.throws(
    () =>
      recordOperatingIntelligenceStateV2(
        intelligenceRequest(seed, { assumptions: [forkedAssumption] }),
        intelligenceDraft({
          timestamp: forkedAssumption.updatedAt,
          correlationId: 'corr_assumption_revision_fork_004',
          assumptions: ['evt_assumption_revision_fork_004'],
        }),
        { initialState: secondAssumption.state },
      ),
    { code: 'STATE_TRANSITION_INVALID' },
    'an Assumption predecessor can have only one successor',
  );
  assert.equal(sha256Jcs(secondAssumption.state), assumptionForkBefore);
  assert.throws(
    () =>
      recordOperatingIntelligenceStateV2(
        intelligenceRequest(seed, { assumptions: [validatedAssumption] }),
        intelligenceDraft({
          correlationId: 'corr_assumption_identity_collision_002',
          assumptions: ['evt_assumption_identity_collision_002'],
        }),
        { initialState: firstAssumption.state },
      ),
    { code: 'CONCURRENT_MODIFICATION' },
    'a new Event cannot reset an existing Assumption identity',
  );
});

test('revision replay is Event-bound, while a later snapshot may dedupe identical history but rejects divergent history', () => {
  const seed = checkpoint();
  const initialRisk = facts(seed).risks[0];
  const firstRisk = recordOperatingIntelligenceStateV2(
    intelligenceRequest(seed, { risks: [initialRisk] }),
    intelligenceDraft({
      correlationId: 'corr_union_risk_r1',
      risks: ['evt_union_risk_r1'],
    }),
    { initialState: seed.result.state },
  );
  const riskR2 = {
    ...clone(initialRisk),
    riskId: 'rsk_union_r2_001',
    revisionId: 'rsk_union_r2_001',
    revision: 2,
    predecessorRevisionId: initialRisk.revisionId,
    state: 'monitoring',
    updatedAt: '2026-08-09T12:03:00.000Z',
  };
  const secondRisk = recordOperatingIntelligenceStateV2(
    intelligenceRequest(seed, { risks: [riskR2] }),
    intelligenceDraft({
      timestamp: riskR2.updatedAt,
      correlationId: 'corr_union_risk_r2',
      risks: ['evt_union_risk_r2'],
    }),
    { initialState: firstRisk.state },
  );
  const assumptionR2 = {
    ...clone(seed.assumption),
    assumptionId: 'asm_union_r2_001',
    revisionId: 'asm_union_r2_001',
    revision: 2,
    predecessorRevisionId: seed.assumption.revisionId,
    status: 'validated',
    updatedAt: '2026-08-09T12:04:00.000Z',
    closedAt: null,
  };
  const secondAssumption = recordOperatingIntelligenceStateV2(
    intelligenceRequest(seed, { assumptions: [assumptionR2] }),
    intelligenceDraft({
      timestamp: assumptionR2.updatedAt,
      correlationId: 'corr_union_assumption_r2',
      assumptions: ['evt_union_assumption_r2'],
    }),
    { initialState: secondRisk.state },
  );

  const later = materializeOperatingStateSnapshotV2(
    {
      cycleId: seed.result.state.cycles[0].cycleId,
      scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
      domainContract: { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' },
      sourceArtifactIds: [seed.sourceArtifactId],
      evidenceRefIds: [seed.evidenceRef.evidenceRefId],
      sourceRevisions: [
        {
          sourceArtifactId: seed.sourceArtifactId,
          revision: 'r2',
          evidenceRefIds: [seed.evidenceRef.evidenceRefId],
        },
      ],
      collections: {
        objectives: [],
        metrics: [seed.metric],
        findings: [],
        decisions: [seed.decision],
        actions: [],
        risks: [initialRisk, riskR2],
        assumptions: [seed.assumption, assumptionR2],
      },
    },
    {
      snapshotId: 'snp_union_later_003',
      stateId: 'oms_union_later_003',
      timestamp: '2026-08-09T12:05:00.000Z',
      correlationId: 'corr_union_snapshot_003',
      eventIds: { snapshot: 'evt_union_snapshot_003', state: 'evt_union_state_003' },
    },
    { initialState: secondAssumption.state, artifactStore: seed.store },
  );
  const requestForLater = (fields = {}) => ({
    cycleId: later.state.cycles[0].cycleId,
    snapshotId: later.snapshot.snapshotId,
    stateId: later.operatingState.stateId,
    claims: [],
    metricObservations: [],
    risks: [],
    assumptions: [],
    decisionRevisions: [],
    ...fields,
  });

  assert.throws(
    () =>
      recordOperatingIntelligenceStateV2(
        requestForLater({ risks: [riskR2], assumptions: [assumptionR2] }),
        intelligenceDraft({
          timestamp: '2026-08-09T12:06:00.000Z',
          correlationId: 'corr_union_fresh_exact_duplicate_003',
          risks: ['evt_union_fresh_exact_risk_003'],
          assumptions: ['evt_union_fresh_exact_assumption_003'],
        }),
        { initialState: later.state },
      ),
    { code: 'CONCURRENT_MODIFICATION' },
    'a fresh Event cannot reuse byte-identical lifecycle revisions',
  );

  const riskR3 = {
    ...clone(riskR2),
    riskId: 'rsk_union_r3_001',
    revisionId: 'rsk_union_r3_001',
    revision: 3,
    predecessorRevisionId: riskR2.revisionId,
    state: 'mitigated',
    exposure: 0.1,
    updatedAt: '2026-08-09T12:06:00.000Z',
  };
  const assumptionR3 = {
    ...clone(assumptionR2),
    assumptionId: 'asm_union_r3_001',
    revisionId: 'asm_union_r3_001',
    revision: 3,
    predecessorRevisionId: assumptionR2.revisionId,
    status: 'closed',
    updatedAt: '2026-08-09T12:06:00.000Z',
    closedAt: '2026-08-09T12:06:00.000Z',
  };
  const request = requestForLater({ risks: [riskR3], assumptions: [assumptionR3] });
  const draft = intelligenceDraft({
    timestamp: riskR3.updatedAt,
    correlationId: 'corr_union_r3',
    risks: ['evt_union_risk_r3'],
    assumptions: ['evt_union_assumption_r3'],
  });
  const success = recordOperatingIntelligenceStateV2(request, draft, { initialState: later.state });
  assert.deepEqual(
    success.events.map(({ type }) => type),
    ['risk.recorded', 'assumption.recorded'],
    'later snapshot and durable ledger dedupe identical r1/r2 history',
  );
  const replay = recordOperatingIntelligenceStateV2(clone(request), clone(draft), {
    initialState: success.state,
  });
  assert.equal(replay.replayed, true, 'only the existing Event IDs plus exact request hash replay');
  assert.deepEqual(replay.state, success.state);

  const divergentRisk = clone(later.state);
  divergentRisk.risks.find(({ revisionId }) => revisionId === riskR2.revisionId).exposure = 0.11;
  assert.throws(
    () => recordOperatingIntelligenceStateV2(request, draft, { initialState: divergentRisk }),
    {
      code: 'STATE_TRANSITION_INVALID',
    },
    'risk records duplicated across snapshot and ledger must be byte-identical',
  );
  const divergentAssumption = clone(later.state);
  divergentAssumption.assumptions.find(
    ({ revisionId }) => revisionId === assumptionR2.revisionId,
  ).confidence = 0.61;
  assert.throws(
    () => recordOperatingIntelligenceStateV2(request, draft, { initialState: divergentAssumption }),
    {
      code: 'STATE_TRANSITION_INVALID',
    },
    'assumption records duplicated across snapshot and ledger must be byte-identical',
  );
});
