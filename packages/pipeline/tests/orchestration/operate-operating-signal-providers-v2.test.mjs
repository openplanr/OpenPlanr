import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { buildOperatingSnapshotStateTransactionV2 } from '../../lib/operate/operating-snapshots-v2.mjs';
import { OPEN_REFERENCE_OPERATE_EXTENSIONS_V2 } from '../../lib/operate/extensions-v2.mjs';
import {
  createOperatingMetricObservationCandidateV2,
  createOperatingSnapshotCandidateV2,
  createOperatingVerificationCandidateV2,
  selectOperatingMetricProviderV2,
  selectOperatingSnapshotProviderV2,
  selectOperatingVerificationProviderV2,
} from '../../lib/operate/operating-signal-providers-v2.mjs';

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

function inputs(seed = '001') {
  const artifact = {
    ...clone(valid['operating-artifact']),
    artifactId: `art_signal_${seed}`,
    assignmentId: `asg_signal_${seed}`,
    scopeId: `scope-signal-${seed}`,
    domainId: 'business',
    domainVersion: '1.0.0',
    inputArtifactIds: [],
  };
  const transaction = buildOperatingSnapshotStateTransactionV2(
    {
      scope: { scopeId: artifact.scopeId, domainId: 'business', domainVersion: '1.0.0' },
      domainContract: { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' },
      sourceArtifactIds: [artifact.artifactId],
      evidenceRefIds: [],
      sourceRevisions: [{ sourceArtifactId: artifact.artifactId, revision: `r-${seed}` }],
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
      snapshotId: `snp_signal_${seed}`,
      stateId: `oms_signal_${seed}`,
      timestamp: '2026-08-09T12:00:00.000Z',
    },
  );
  const metric = {
    ...clone(valid['operating-metric']),
    metricId: `met_signal_${seed}`,
    scopeId: artifact.scopeId,
    domainId: 'business',
    domainVersion: '1.0.0',
    sourceArtifactId: artifact.artifactId,
  };
  const observation = {
    ...clone(valid['operating-metric-observation']),
    observationId: `mob_signal_${seed}`,
    metricId: metric.metricId,
    scopeId: artifact.scopeId,
    domainId: 'business',
    domainVersion: '1.0.0',
    snapshotId: transaction.snapshot.snapshotId,
    sourceArtifactId: artifact.artifactId,
  };
  const verificationArtifact = {
    ...clone(artifact),
    artifactId: `art_verification_observation_${seed}`,
  };
  const verificationPlan = {
    ...clone(valid['operating-action-verification-plan']),
    verificationPlanId: `vfy_signal_${seed}`,
    actionId: `act_signal_${seed}`,
    metricId: metric.metricId,
    scopeId: artifact.scopeId,
    domainId: 'business',
    domainVersion: '1.0.0',
    sourceArtifactId: artifact.artifactId,
  };
  const outcome = {
    ...clone(valid['operating-outcome']),
    outcomeId: `out_signal_${seed}`,
    actionId: verificationPlan.actionId,
    verificationPlanId: verificationPlan.verificationPlanId,
    scopeId: artifact.scopeId,
    domainId: 'business',
    domainVersion: '1.0.0',
    sourceArtifactId: verificationArtifact.artifactId,
  };
  return {
    artifact,
    verificationArtifact,
    ...transaction,
    metric,
    observation,
    verificationPlan,
    outcome,
  };
}

test('closed built-ins select exact public domain bindings without dispatching code or an effect', () => {
  const domainContract = { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' };
  assert.equal(
    selectOperatingSnapshotProviderV2(undefined, {
      providerId: 'open-reference-snapshot-provider',
      providerVersion: '1.0.0',
      domainContract,
    }).status,
    'selected',
  );
  assert.equal(
    selectOperatingMetricProviderV2(undefined, {
      providerId: 'open-reference-metric-provider',
      providerVersion: '1.0.0',
      domainContract,
    }).status,
    'selected',
  );
  assert.equal(
    selectOperatingVerificationProviderV2(undefined, {
      providerId: 'open-reference-verification-provider',
      providerVersion: '1.0.0',
      domainContract,
    }).status,
    'selected',
  );
  assert.deepEqual(
    selectOperatingSnapshotProviderV2(undefined, {
      providerId: 'unknown-provider',
      providerVersion: '1.0.0',
      domainContract,
    }).error.code,
    'OPERATING_PROVIDER_UNAVAILABLE',
  );
  assert.equal(
    selectOperatingSnapshotProviderV2(undefined, {
      providerId: 'open-reference-snapshot-provider',
      providerVersion: '1.0.0',
      domainContract: { apiDomainId: 'business', id: 'software-domain', version: '1.0.0' },
    }).status,
    'unavailable',
  );
});

test('reference providers validate and return normal candidates without mutating accepted inputs', () => {
  const input = inputs();
  const before = clone(input);
  const snapshot = createOperatingSnapshotCandidateV2({
    providerId: 'open-reference-snapshot-provider',
    providerVersion: '1.0.0',
    snapshot: input.snapshot,
    state: input.state,
    acceptedArtifacts: [input.artifact],
  });
  const metric = createOperatingMetricObservationCandidateV2({
    providerId: 'open-reference-metric-provider',
    providerVersion: '1.0.0',
    metric: input.metric,
    observation: input.observation,
    snapshot: input.snapshot,
    acceptedArtifacts: [input.artifact],
  });
  const verification = createOperatingVerificationCandidateV2({
    providerId: 'open-reference-verification-provider',
    providerVersion: '1.0.0',
    verificationPlan: input.verificationPlan,
    outcome: input.outcome,
    acceptedArtifacts: [input.artifact, input.verificationArtifact],
  });
  assert.equal(snapshot.status, 'candidate');
  assert.equal(metric.status, 'candidate');
  assert.equal(verification.status, 'candidate');
  assert.deepEqual(snapshot.candidate, input.snapshot);
  assert.deepEqual(metric.candidate, input.observation);
  assert.deepEqual(verification.candidate, input.outcome);
  assert.deepEqual(input, before, 'candidate helpers are pure');
  assert.doesNotMatch(
    JSON.stringify([snapshot, metric, verification]),
    /raw|bytes|credential|secret|connector|executor/iu,
  );
});

test('candidate validation fails closed on an unaccepted source, altered plan binding, or missing explicit version', () => {
  const input = inputs('002');
  assert.throws(
    () =>
      createOperatingMetricObservationCandidateV2({
        providerId: 'open-reference-metric-provider',
        providerVersion: '1.0.0',
        metric: input.metric,
        observation: { ...input.observation, sourceArtifactId: 'art_missing_002' },
        snapshot: input.snapshot,
        acceptedArtifacts: [input.artifact],
      }),
    { code: 'OPERATING_PROVIDER_INPUT_INVALID' },
  );
  assert.throws(
    () =>
      createOperatingVerificationCandidateV2({
        providerId: 'open-reference-verification-provider',
        providerVersion: '1.0.0',
        verificationPlan: input.verificationPlan,
        outcome: { ...input.outcome, verificationPlanId: 'vfy_different_002' },
        acceptedArtifacts: [input.artifact, input.verificationArtifact],
      }),
    { code: 'OPERATING_PROVIDER_INPUT_INVALID' },
  );
  assert.throws(
    () =>
      selectOperatingSnapshotProviderV2(undefined, {
        providerId: 'open-reference-snapshot-provider',
        domainContract: input.snapshot.domainContract,
      }),
    { code: 'OPERATING_PROVIDER_VERSION_REQUIRED' },
  );
});

test('all signal selectors reject incomplete or authority-bearing registry-shaped inputs before provider selection', () => {
  const domainContract = { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' };
  const spoofs = [
    { snapshotProviders: OPEN_REFERENCE_OPERATE_EXTENSIONS_V2.snapshotProviders },
    {
      ...OPEN_REFERENCE_OPERATE_EXTENSIONS_V2,
      capabilityGrants: [{ capabilityId: 'filesystem-write' }],
    },
  ];
  const selections = [
    [selectOperatingSnapshotProviderV2, 'open-reference-snapshot-provider'],
    [selectOperatingMetricProviderV2, 'open-reference-metric-provider'],
    [selectOperatingVerificationProviderV2, 'open-reference-verification-provider'],
  ];
  for (const spoof of spoofs) {
    for (const [selector, providerId] of selections) {
      assert.throws(
        () =>
          selector(spoof, {
            providerId,
            providerVersion: '1.0.0',
            domainContract,
          }),
        { code: 'OPERATING_PROVIDER_INPUT_INVALID' },
      );
    }
  }
});

test('verification cannot select a provider or return a candidate for an unregistered domain version', () => {
  const input = inputs('003');
  const verificationPlan = { ...input.verificationPlan, domainVersion: '2.0.0' };
  const outcome = { ...input.outcome, domainVersion: '2.0.0' };
  const artifact = { ...input.artifact, domainVersion: '2.0.0' };
  const result = createOperatingVerificationCandidateV2({
    providerId: 'open-reference-verification-provider',
    providerVersion: '1.0.0',
    verificationPlan,
    outcome,
    acceptedArtifacts: [artifact],
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(Object.hasOwn(result, 'candidate'), false);
  assert.equal(result.error.code, 'OPERATING_PROVIDER_UNAVAILABLE');
});
