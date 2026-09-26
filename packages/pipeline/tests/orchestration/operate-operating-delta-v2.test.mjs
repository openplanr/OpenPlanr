import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { validateProtocolArtifact } from '../../lib/protocol/contracts.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import {
  assertOperatingDeltaV2,
  classifyOperatingDeltaMaterialityV2,
  deriveOperatingDeltaV2,
} from '../../lib/operate/operating-delta-v2.mjs';
import { buildOperatingSnapshotStateTransactionV2 } from '../../lib/operate/operating-snapshots-v2.mjs';
import { deriveOperatingRuntimeDeltaV2 } from '../../lib/operate/runtime-foundation.mjs';
import { checkpoint } from './operate-operating-intelligence-state-v2.test-support.mjs';

const TIME = '2026-08-09T12:00:00.000Z';
const NEXT_TIME = '2026-08-09T12:01:00.000Z';
const valid = JSON.parse(
  readFileSync(
    new URL(
      '../../conformance/fixtures/operating-runtime-v2/all-contracts-valid.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
const clone = (value) => structuredClone(value);

function scoped(kind, field, id, sourceArtifactId, timestamp) {
  return {
    ...clone(valid[kind]),
    [field]: id,
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    sourceArtifactId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function snapshots() {
  const priorArtifactId = 'art_delta_prior_001';
  const currentArtifactId = 'art_delta_current_001';
  const priorRisk = {
    ...scoped('operating-risk', 'riskId', 'rsk_delta_prior_001', priorArtifactId, TIME),
    exposure: 0.2,
    evidenceRefIds: [],
    revisionId: 'rsk_delta_prior_001',
    revision: 1,
    predecessorRevisionId: null,
  };
  const priorAssumption = {
    ...scoped('operating-assumption', 'assumptionId', 'asm_delta_prior_001', priorArtifactId, TIME),
    status: 'active',
    closedAt: null,
    evidenceRefIds: [],
    revisionId: 'asm_delta_prior_001',
    revision: 1,
    predecessorRevisionId: null,
  };
  const previous = buildOperatingSnapshotStateTransactionV2(
    {
      scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
      domainContract: { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' },
      sourceArtifactIds: [priorArtifactId],
      evidenceRefIds: ['evr_delta_prior_evidence_001'],
      sourceRevisions: [
        {
          sourceArtifactId: priorArtifactId,
          revision: 'r1',
          evidenceRefIds: ['evr_delta_prior_evidence_001'],
        },
      ],
      collections: {
        objectives: [],
        metrics: [
          scoped('operating-metric', 'metricId', 'met_delta_metric_001', priorArtifactId, TIME),
        ],
        findings: [],
        decisions: [],
        actions: [],
        risks: [priorRisk],
        assumptions: [priorAssumption],
      },
    },
    { snapshotId: 'snp_delta_prior_001', stateId: 'oms_delta_prior_001', timestamp: TIME },
  );
  const current = buildOperatingSnapshotStateTransactionV2(
    {
      scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
      domainContract: { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' },
      sourceArtifactIds: [currentArtifactId],
      evidenceRefIds: ['evr_delta_evidence_001', 'evr_delta_conflict_002'],
      sourceRevisions: [
        {
          sourceArtifactId: currentArtifactId,
          revision: 'r2',
          evidenceRefIds: ['evr_delta_evidence_001', 'evr_delta_conflict_002'],
        },
      ],
      collections: {
        objectives: [],
        metrics: [
          scoped(
            'operating-metric',
            'metricId',
            'met_delta_metric_001',
            currentArtifactId,
            NEXT_TIME,
          ),
        ],
        findings: [],
        decisions: [],
        actions: [],
        risks: [
          {
            ...clone(priorRisk),
            riskId: 'rsk_delta_current_001',
            sourceArtifactId: currentArtifactId,
            state: 'monitoring',
            exposure: 0.9,
            evidenceRefIds: ['evr_delta_evidence_001'],
            revisionId: 'rsk_delta_current_001',
            revision: 2,
            predecessorRevisionId: priorRisk.revisionId,
            updatedAt: NEXT_TIME,
          },
        ],
        assumptions: [
          {
            ...clone(priorAssumption),
            assumptionId: 'asm_delta_current_001',
            sourceArtifactId: currentArtifactId,
            status: 'invalidated',
            evidenceRefIds: ['evr_delta_evidence_001'],
            revisionId: 'asm_delta_current_001',
            revision: 2,
            predecessorRevisionId: priorAssumption.revisionId,
            updatedAt: NEXT_TIME,
            closedAt: NEXT_TIME,
          },
        ],
      },
    },
    { snapshotId: 'snp_delta_current_001', stateId: 'oms_delta_current_001', timestamp: NEXT_TIME },
    { previousSnapshots: [previous.snapshot] },
  );
  const evidence = {
    ...clone(valid['operating-evidence-ref']),
    evidenceRefId: 'evr_delta_evidence_001',
    candidateId: 'evc_delta_evidence_001',
    sourceArtifactId: currentArtifactId,
    evidenceArtifactId: 'art_delta_evidence_001',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
  };
  const conflictingEvidence = {
    ...clone(evidence),
    evidenceRefId: 'evr_delta_conflict_002',
    candidateId: 'evc_delta_conflict_002',
    evidenceArtifactId: 'art_delta_conflict_002',
  };
  const priorEvidence = {
    ...clone(evidence),
    evidenceRefId: 'evr_delta_prior_evidence_001',
    candidateId: 'evc_delta_prior_evidence_001',
    sourceArtifactId: priorArtifactId,
    evidenceArtifactId: 'art_delta_prior_evidence_001',
  };
  const evidenceArtifact = (ref) => ({
    ...clone(valid['operating-artifact']),
    artifactId: ref.evidenceArtifactId,
    artifactType: 'evidence-snapshot',
    schemaId: 'operating-evidence-snapshot',
    artifactSchemaVersion: '1.0.0',
    mediaType: 'application/octet-stream',
    encoding: 'binary',
    rawHash: ref.evidenceArtifactRawHash,
    canonicalHash: ref.evidenceArtifactCanonicalHash,
    inputArtifactIds: [ref.sourceArtifactId],
  });
  const currentObservation = {
    ...clone(valid['operating-metric-observation']),
    observationId: 'mob_delta_current_001',
    metricId: 'met_delta_metric_001',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    value: 0.7,
    unit: 'percent',
    observedAt: NEXT_TIME,
    snapshotId: current.snapshot.snapshotId,
    evidenceRefIds: [evidence.evidenceRefId],
    sourceArtifactId: currentArtifactId,
  };
  const priorObservation = {
    ...currentObservation,
    observationId: 'mob_delta_prior_001',
    value: 0.8,
    observedAt: TIME,
    snapshotId: previous.snapshot.snapshotId,
    sourceArtifactId: priorArtifactId,
    evidenceRefIds: [priorEvidence.evidenceRefId],
  };
  return {
    previous,
    current,
    evidence,
    conflictingEvidence,
    priorEvidence,
    evidenceArtifacts: [
      evidenceArtifact(evidence),
      evidenceArtifact(conflictingEvidence),
      evidenceArtifact(priorEvidence),
    ],
    currentObservation,
    priorObservation,
  };
}

test('delta contract fixtures validate and malformed values fail schema validation', () => {
  assert.deepEqual(
    validateProtocolArtifact('operating-delta', fixture('operating-delta-valid.json'), {
      protocolVersion: '2.0.0',
    }),
    [],
  );
  assert.ok(
    validateProtocolArtifact('operating-delta', fixture('operating-delta-invalid.json'), {
      protocolVersion: '2.0.0',
    }).length > 0,
  );
});

test('delta comparison is stable, evidence-backed, and explicitly classifies material change', () => {
  const {
    previous,
    current,
    evidence,
    priorEvidence,
    evidenceArtifacts,
    currentObservation,
    priorObservation,
  } = snapshots();
  const input = {
    deltaId: 'dlt_delta_derived_001',
    currentSnapshot: current.snapshot,
    currentState: current.state,
    priorSnapshot: previous.snapshot,
    priorState: previous.state,
    evidenceRefs: [evidence, priorEvidence],
    evidenceArtifacts,
    metricObservations: [currentObservation],
    priorMetricObservations: [priorObservation],
    sourceArtifactId: 'art_delta_current_001',
    derivedAt: NEXT_TIME,
  };
  const first = deriveOperatingDeltaV2(input);
  const second = deriveOperatingDeltaV2({
    ...input,
    evidenceRefs: [clone(evidence), clone(priorEvidence)],
    evidenceArtifacts: clone(evidenceArtifacts),
    metricObservations: [clone(currentObservation)],
  });
  assert.deepEqual(first, second);
  assert.equal(first.priorSnapshotId, previous.snapshot.snapshotId);
  assert.deepEqual(
    first.sourceRevisionChanges.map(({ subjectId, kind }) => [subjectId, kind]),
    [
      ['art_delta_current_001', 'added'],
      ['art_delta_prior_001', 'removed'],
    ],
  );
  assert.deepEqual(
    first.metricChanges.map(({ subjectId, kind }) => [subjectId, kind]),
    [['met_delta_metric_001', 'changed']],
  );
  assert.deepEqual(classifyOperatingDeltaMaterialityV2(first), {
    material: true,
    reason: 'material-change',
  });
  assertOperatingDeltaV2(first, {
    currentSnapshot: current.snapshot,
    priorSnapshot: previous.snapshot,
  });
});

test('delta fails closed on an incorrect predecessor or unsupported evidence and has an explicit no-material-change state', () => {
  const { previous, current, evidence, priorEvidence, evidenceArtifacts } = snapshots();
  assert.throws(
    () =>
      deriveOperatingDeltaV2({
        deltaId: 'dlt_delta_bad_prior_001',
        currentSnapshot: current.snapshot,
        currentState: current.state,
        sourceArtifactId: 'art_delta_current_001',
        derivedAt: NEXT_TIME,
      }),
    { code: 'STATE_TRANSITION_INVALID' },
  );
  assert.throws(
    () =>
      deriveOperatingDeltaV2({
        deltaId: 'dlt_delta_bad_evidence_001',
        currentSnapshot: current.snapshot,
        currentState: current.state,
        priorSnapshot: previous.snapshot,
        priorState: previous.state,
        evidenceRefs: [evidence, priorEvidence],
        evidenceArtifacts,
        claims: [
          {
            ...clone(valid['operating-claim']),
            claimId: 'clm_delta_claim_001',
            sourceArtifactId: 'art_delta_current_001',
            scopeId: 'scope-acme',
            domainId: 'business',
            domainVersion: '1.0.0',
            supportingEvidenceRefIds: ['evr_missing_delta_001'],
            createdAt: NEXT_TIME,
          },
        ],
        sourceArtifactId: 'art_delta_current_001',
        derivedAt: NEXT_TIME,
      }),
    { code: 'STATE_TRANSITION_INVALID' },
  );
  const noChange = {
    ...fixture('operating-delta-valid.json'),
    sourceRevisionChanges: [],
    metricChanges: [],
    staleEvidenceRefIds: [],
    conflictingEvidenceRefIds: [],
    invalidatedAssumptionIds: [],
    exposedRiskIds: [],
    decisionRevisitIds: [],
  };
  assert.deepEqual(classifyOperatingDeltaMaterialityV2(noChange), {
    material: false,
    reason: 'no-material-change',
  });
});

test('delta derives lifecycle revisits from bound operating states and surfaces distinct evidence conflicts', () => {
  const {
    previous,
    current,
    evidence,
    conflictingEvidence,
    priorEvidence,
    evidenceArtifacts,
    currentObservation,
    priorObservation,
  } = snapshots();
  const conflictClaim = {
    ...clone(valid['operating-claim']),
    claimId: 'clm_delta_conflict_002',
    sourceArtifactId: 'art_delta_current_001',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    createdAt: NEXT_TIME,
    supportingEvidenceRefIds: [evidence.evidenceRefId],
    contradictingEvidenceRefIds: [conflictingEvidence.evidenceRefId],
  };
  const delta = deriveOperatingDeltaV2({
    deltaId: 'dlt_delta_state_collections_002',
    currentSnapshot: current.snapshot,
    currentState: current.state,
    priorSnapshot: previous.snapshot,
    priorState: previous.state,
    evidenceRefs: [evidence, conflictingEvidence, priorEvidence],
    evidenceArtifacts,
    claims: [conflictClaim],
    metricObservations: [currentObservation],
    priorMetricObservations: [priorObservation],
    // These empty ledgers prove that runtime delta inputs do not shadow the two immutable state collections.
    risks: [],
    assumptions: [],
    decisions: [],
    sourceArtifactId: 'art_delta_current_001',
    derivedAt: NEXT_TIME,
  });
  assert.deepEqual(delta.invalidatedAssumptionIds, ['asm_delta_current_001']);
  assert.deepEqual(delta.exposedRiskIds, ['rsk_delta_current_001']);
  assert.deepEqual(delta.conflictingEvidenceRefIds, [
    conflictingEvidence.evidenceRefId,
    evidence.evidenceRefId,
  ]);
});

test('delta ignores unused foreign registry evidence, but rejects exact-artifact gaps and cited evidence outside its bound snapshot', () => {
  const {
    previous,
    current,
    evidence,
    priorEvidence,
    evidenceArtifacts,
    currentObservation,
    priorObservation,
  } = snapshots();
  const input = {
    deltaId: 'dlt_delta_registry_selection_003',
    currentSnapshot: current.snapshot,
    currentState: current.state,
    priorSnapshot: previous.snapshot,
    priorState: previous.state,
    evidenceRefs: [evidence, priorEvidence],
    evidenceArtifacts,
    metricObservations: [currentObservation],
    priorMetricObservations: [priorObservation],
    sourceArtifactId: 'art_delta_current_001',
    derivedAt: NEXT_TIME,
  };
  const baseline = deriveOperatingDeltaV2(input);
  const ambientRef = {
    ...clone(evidence),
    evidenceRefId: 'evr_delta_ambient_003',
    candidateId: 'evc_delta_ambient_003',
    scopeId: 'scope-foreign',
    domainId: 'foreign',
    domainVersion: '9.0.0',
    sourceArtifactId: 'art_foreign_003',
    evidenceArtifactId: 'art_delta_ambient_evidence_003',
  };
  const ambientArtifact = {
    artifactId: ambientRef.evidenceArtifactId,
    malformedAmbientEntry: true,
  };
  assert.deepEqual(
    deriveOperatingDeltaV2({
      ...input,
      evidenceRefs: [...input.evidenceRefs, ambientRef],
      evidenceArtifacts: [...input.evidenceArtifacts, ambientArtifact],
    }),
    baseline,
    'unselected global registry entries must be ignored',
  );

  assert.throws(
    () =>
      deriveOperatingDeltaV2({
        ...input,
        evidenceArtifacts: input.evidenceArtifacts.filter(
          ({ artifactId }) => artifactId !== evidence.evidenceArtifactId,
        ),
      }),
    { code: 'STATE_TRANSITION_INVALID' },
    'a selected ref cannot float without its exact Evidence Artifact',
  );
  assert.throws(
    () =>
      deriveOperatingDeltaV2({
        ...input,
        claims: [
          {
            ...clone(valid['operating-claim']),
            claimId: 'clm_delta_outside_selection_003',
            scopeId: 'scope-acme',
            domainId: 'business',
            domainVersion: '1.0.0',
            sourceArtifactId: 'art_delta_current_001',
            createdAt: NEXT_TIME,
            supportingEvidenceRefIds: [priorEvidence.evidenceRefId],
            contradictingEvidenceRefIds: [],
          },
        ],
      }),
    { code: 'STATE_TRANSITION_INVALID' },
    'a current record cannot cite a predecessor snapshot EvidenceRef',
  );
  assert.throws(
    () =>
      deriveOperatingDeltaV2({
        ...input,
        claims: [
          {
            ...clone(valid['operating-claim']),
            claimId: 'clm_delta_direct_overlap_003',
            scopeId: 'scope-acme',
            domainId: 'business',
            domainVersion: '1.0.0',
            sourceArtifactId: 'art_delta_current_001',
            createdAt: NEXT_TIME,
            supportingEvidenceRefIds: [evidence.evidenceRefId],
            contradictingEvidenceRefIds: [evidence.evidenceRefId],
          },
        ],
      }),
    { code: 'STATE_TRANSITION_INVALID' },
    'direct Delta must reject support/contradiction overlap',
  );
});

test('direct Delta rejects a Claim that cites a selected EvidenceRef from another declared source Artifact', () => {
  const sourceA = 'art_delta_cross_source_a_004';
  const sourceB = 'art_delta_cross_source_b_004';
  const firstRef = {
    ...clone(valid['operating-evidence-ref']),
    evidenceRefId: 'evr_delta_cross_source_a_004',
    candidateId: 'evc_delta_cross_source_a_004',
    sourceArtifactId: sourceA,
    evidenceArtifactId: 'art_delta_cross_evidence_a_004',
  };
  const secondRef = {
    ...clone(firstRef),
    evidenceRefId: 'evr_delta_cross_source_b_004',
    candidateId: 'evc_delta_cross_source_b_004',
    sourceArtifactId: sourceB,
    evidenceArtifactId: 'art_delta_cross_evidence_b_004',
  };
  const evidenceArtifact = (ref) => ({
    ...clone(valid['operating-artifact']),
    artifactId: ref.evidenceArtifactId,
    artifactType: 'evidence-snapshot',
    schemaId: 'operating-evidence-snapshot',
    artifactSchemaVersion: '1.0.0',
    mediaType: 'application/octet-stream',
    encoding: 'binary',
    rawHash: ref.evidenceArtifactRawHash,
    canonicalHash: ref.evidenceArtifactCanonicalHash,
    inputArtifactIds: [ref.sourceArtifactId],
  });
  const current = buildOperatingSnapshotStateTransactionV2(
    {
      scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
      domainContract: { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' },
      sourceArtifactIds: [sourceA, sourceB],
      evidenceRefIds: [firstRef.evidenceRefId, secondRef.evidenceRefId],
      sourceRevisions: [
        { sourceArtifactId: sourceA, revision: 'r1', evidenceRefIds: [firstRef.evidenceRefId] },
        { sourceArtifactId: sourceB, revision: 'r1', evidenceRefIds: [secondRef.evidenceRefId] },
      ],
      collections: {
        objectives: [],
        metrics: [],
        findings: [],
        decisions: [],
        actions: [],
        risks: [],
        assumptions: [],
      },
    },
    {
      snapshotId: 'snp_delta_cross_source_004',
      stateId: 'oms_delta_cross_source_004',
      timestamp: NEXT_TIME,
    },
  );
  const before = sha256Jcs(current);
  assert.throws(
    () =>
      deriveOperatingDeltaV2({
        deltaId: 'dlt_delta_cross_source_004',
        currentSnapshot: current.snapshot,
        currentState: current.state,
        evidenceRefs: [firstRef, secondRef],
        evidenceArtifacts: [evidenceArtifact(firstRef), evidenceArtifact(secondRef)],
        claims: [
          {
            ...clone(valid['operating-claim']),
            claimId: 'clm_delta_cross_source_004',
            scopeId: 'scope-acme',
            domainId: 'business',
            domainVersion: '1.0.0',
            sourceArtifactId: sourceA,
            supportingEvidenceRefIds: [secondRef.evidenceRefId],
            contradictingEvidenceRefIds: [],
            createdAt: NEXT_TIME,
          },
        ],
        sourceArtifactId: sourceA,
        derivedAt: NEXT_TIME,
      }),
    { code: 'STATE_TRANSITION_INVALID' },
  );
  assert.equal(sha256Jcs(current), before, 'invalid direct derivation is read-only');
});

test('runtime Delta transaction appends one Event, replays exactly, and does not dispatch a model', () => {
  const seed = checkpoint();
  const request = {
    cycleId: seed.result.state.cycles[0].cycleId,
    snapshotId: seed.result.snapshot.snapshotId,
    stateId: seed.result.operatingState.stateId,
  };
  const draft = {
    deltaId: 'dlt_runtime_delta_001',
    eventId: 'evt_runtime_delta_001',
    timestamp: '2026-08-09T12:03:00.000Z',
    correlationId: 'corr_runtime_delta_001',
  };
  const first = deriveOperatingRuntimeDeltaV2(request, draft, { initialState: seed.result.state });
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].type, 'delta.derived');
  assert.equal(first.state.deltas[0].deltaId, draft.deltaId);
  const replay = deriveOperatingRuntimeDeltaV2(clone(request), clone(draft), {
    initialState: first.state,
  });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.events, []);
  assert.deepEqual(replay.state, first.state);
  assert.throws(
    () =>
      deriveOperatingRuntimeDeltaV2(
        request,
        {
          ...draft,
          correlationId: 'corr_runtime_delta_divergent_001',
        },
        { initialState: first.state },
      ),
    {
      code: 'STATE_TRANSITION_INVALID',
    },
    'the same runtime Event identity cannot replay a different exact draft',
  );
});
