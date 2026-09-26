import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  buildOperatingActionVerificationMaterializationV2,
  buildOperatingActionVerificationOutcomeV2,
  buildOperatingActionExecutionFeedbackV2,
} from '../../lib/operate/action-verification-v2.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import { deriveOperatingModelStateRuntimeHashV2 } from '../../lib/operate/operating-state-v2.mjs';
import { deriveOperatingSnapshotRuntimeHashV2 } from '../../lib/operate/operating-snapshots-v2.mjs';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
const valid = fixture('all-contracts-valid.json');
const clone = (value) => structuredClone(value);

function input() {
  const sourceArtifactId = 'art_verify_property_001';
  const evidenceRefId = 'evr_verify_property_001';
  const objective = {
    ...clone(valid['operating-objective']),
    objectiveId: 'obj_verify_property_001',
    metricIds: ['met_verify_property_001'],
    sourceArtifactId,
    evidenceRefIds: [evidenceRefId],
  };
  const metric = {
    ...clone(valid['operating-metric']),
    metricId: 'met_verify_property_001',
    sourceArtifactId,
    evidenceRefIds: [evidenceRefId],
  };
  const finding = {
    ...clone(valid['operating-finding']),
    findingId: 'fnd_verify_property_001',
    sourceArtifactId: 'art_verify_challenger_property_001',
    sourceCycleId: 'cyc_00000001',
  };
  const assumption = {
    ...clone(valid['operating-assumption']),
    assumptionId: 'asm_verify_property_001',
    sourceArtifactId,
    evidenceRefIds: [evidenceRefId],
  };
  const decision = {
    ...clone(valid['operating-decision']),
    decisionId: 'dec_verify_property_001',
    sourceArtifactId,
    sourceCycleId: 'cyc_00000001',
    assumptionIds: [assumption.assumptionId],
    challengerFindingIds: [finding.sourceLocalFindingId],
    findingIds: [finding.findingId],
  };
  const existingAction = {
    ...clone(valid['operating-action']),
    actionId: 'act_verify_dependency_001',
    sourceArtifactId,
    sourceCycleId: 'cyc_00000001',
    sourceDecisionId: decision.decisionId,
    sourceFindingIds: [finding.findingId],
    dependsOnActionIds: [],
    objectiveId: objective.objectiveId,
    metricId: metric.metricId,
  };
  const state = {
    kind: 'operating-model-state',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    stateId: 'oms_verify_property_001',
    snapshotId: 'snp_verify_property_001',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    objectives: [objective],
    metrics: [metric],
    findings: [finding],
    decisions: [decision],
    actions: [existingAction],
    risks: [],
    assumptions: [assumption],
    generatedAt: '2026-08-09T13:00:00.000Z',
  };
  state.runtimeHash = deriveOperatingModelStateRuntimeHashV2(state);
  const snapshot = {
    ...clone(valid['operating-snapshot']),
    snapshotId: state.snapshotId,
    stateId: state.stateId,
    scopeId: state.scopeId,
    domainId: state.domainId,
    domainVersion: state.domainVersion,
    sourceArtifactIds: [sourceArtifactId],
    evidenceRefIds: [evidenceRefId],
    sourceRevisions: [{ sourceArtifactId, revision: 'r1', evidenceRefIds: [evidenceRefId] }],
    previousSnapshotId: null,
    createdAt: state.generatedAt,
  };
  snapshot.runtimeHash = deriveOperatingSnapshotRuntimeHashV2(snapshot);
  const ledger = {
    ...clone(valid['operating-decision-ledger']),
    ledgerId: 'ldg_verify_property_001',
    sourceArtifactId,
    snapshotId: snapshot.snapshotId,
    scopeId: state.scopeId,
    domainId: state.domainId,
    domainVersion: state.domainVersion,
    decisions: [
      {
        localDecisionId: 'decision:asg_chair_fixture_001:1',
        title: decision.title,
        question: decision.question,
        outcome: 'Measure the property before committing the operating change.',
        rationale: 'The accepted claim and challenge support a bounded observation.',
        sourceClaimRefs: clone(decision.sourceClaimRefs),
        sourceRecommendationRefs: [],
        challengerFindingIds: [finding.sourceLocalFindingId],
        evidenceRefIds: [evidenceRefId],
        alternativeDispositions: [],
        confidence: 0.7,
        assumptionIds: [assumption.assumptionId],
        upside: 'Reduces uncertainty before commitment.',
        downside: 'Defers the operating change for one observation window.',
        uncertainty: 'The observation may contradict the current direction.',
        reversibility: 'The observation can stop without an external effect.',
        ownerActorId: 'owner-001',
        revisitConditions: ['A current observation changes the metric materially.'],
        dissentIds: [],
        actionHypotheses: [
          {
            localActionHypothesisId: 'action-hypothesis:asg_chair_fixture_001:1',
            title: 'Measure property',
            objectiveId: objective.objectiveId,
            ownerActorId: 'owner-001',
            accountabilityDisposition: null,
            expectedResult: 'The metric reaches target.',
            metricId: metric.metricId,
            baseline: 0.5,
            target: 0.8,
            verificationWindow: '30d',
            verificationMethod: 'Compare the accepted metric observation with the target.',
            sourceClaimRefs: clone(decision.sourceClaimRefs),
            sourceFindingIds: [finding.sourceLocalFindingId],
            dependsOnActionHypothesisIds: [],
          },
        ],
      },
    ],
  };
  return { snapshot, state, ledger, decision, finding, assumption, metric, existingAction };
}

test('property: every omitted material Action field rejects without emitting a derived Action or plan', () => {
  const base = input();
  const before = sha256Jcs(base);
  const mutations = [
    (value) => {
      value.ledger.decisions[0].actionHypotheses[0].objectiveId = null;
    },
    (value) => {
      value.ledger.decisions[0].actionHypotheses[0].metricId = null;
    },
    (value) => {
      value.ledger.decisions[0].actionHypotheses[0].baseline = null;
    },
    (value) => {
      value.ledger.decisions[0].actionHypotheses[0].target = null;
    },
    (value) => {
      value.ledger.decisions[0].actionHypotheses[0].ownerActorId = null;
      value.ledger.decisions[0].actionHypotheses[0].accountabilityDisposition = null;
    },
    (value) => {
      value.ledger.decisions[0].actionHypotheses[0].sourceFindingIds = [];
    },
    (value) => {
      delete value.ledger.decisions[0].actionHypotheses[0].dependsOnActionHypothesisIds;
    },
    (value) => {
      value.ledger.decisions[0].actionHypotheses[0].verificationMethod = ' ';
    },
  ];
  for (const mutate of mutations) {
    const value = clone(base);
    mutate(value);
    assert.throws(() =>
      buildOperatingActionVerificationMaterializationV2({
        snapshot: value.snapshot,
        operatingState: value.state,
        ledger: value.ledger,
        decisions: [value.decision],
        findings: [value.finding],
        timestamp: '2026-08-09T13:00:00.000Z',
      }),
    );
  }
  assert.equal(sha256Jcs(base), before);
});

test('property: outcome status is deterministic and learns only from its source Decision/Assumptions', () => {
  const base = input();
  const materialized = buildOperatingActionVerificationMaterializationV2({
    snapshot: base.snapshot,
    operatingState: base.state,
    ledger: base.ledger,
    decisions: [base.decision],
    findings: [base.finding],
    timestamp: '2026-08-09T13:00:00.000Z',
  });
  const observation = {
    ...clone(valid['operating-metric-observation']),
    observationId: 'mob_verify_property_001',
    metricId: base.metric.metricId,
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    value: 0.81,
    unit: base.metric.unit,
    observedAt: '2026-08-09T13:01:00.000Z',
    snapshotId: base.snapshot.snapshotId,
    evidenceRefIds: ['evr_verify_property_001'],
    sourceArtifactId: 'art_verify_property_001',
  };
  const result = buildOperatingActionVerificationOutcomeV2({
    action: materialized.actions[0],
    verificationPlan: materialized.verificationPlans[0],
    observation,
    learning: {
      statement: 'Target reached.',
      assumptionIds: [],
      decisionIds: [base.decision.decisionId],
    },
    timestamp: '2026-08-09T13:02:00.000Z',
    sourceDecision: base.decision,
  });
  assert.deepEqual(materialized.actions[0].dependsOnActionIds, []);
  assert.equal(
    materialized.verificationPlans[0].method,
    base.ledger.decisions[0].actionHypotheses[0].verificationMethod,
  );
  assert.equal(result.outcome.status, 'succeeded');
  for (const [executionStatus, hypothesisStatus] of [
    ['success', 'pending'],
    ['failure', 'blocked'],
    ['blocked', 'blocked'],
    ['uncertain', 'blocked'],
    ['partial', 'blocked'],
    ['cancelled', 'cancelled'],
    ['rolled-back', 'revisit'],
  ]) {
    assert.equal(
      buildOperatingActionExecutionFeedbackV2({
        action: materialized.actions[0],
        verificationPlan: materialized.verificationPlans[0],
        executionStatus,
      }).hypothesisStatus,
      hypothesisStatus,
    );
  }
  assert.throws(
    () =>
      buildOperatingActionVerificationOutcomeV2({
        action: materialized.actions[0],
        verificationPlan: materialized.verificationPlans[0],
        observation,
        learning: {
          statement: 'Foreign revisit.',
          assumptionIds: [],
          decisionIds: ['dec_foreign_001'],
        },
        timestamp: '2026-08-09T13:02:00.000Z',
        sourceDecision: base.decision,
      }),
    { code: 'STATE_TRANSITION_INVALID' },
  );
});
