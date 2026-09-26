import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { validateProtocolArtifact } from '../../lib/protocol/loader.mjs';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
const schema = (kind) =>
  JSON.parse(
    readFileSync(new URL(`../../schemas/v2.0.0/${kind}.schema.json`, import.meta.url), 'utf8'),
  );

const valid = fixture('live-evidence-contracts-valid.json');
const invalid = fixture('live-evidence-contracts-invalid.json');
const LIVE_EVIDENCE_CONTRACT_KINDS = Object.freeze([
  'operate-live-evidence-provider-registration',
  'operate-live-evidence-provider-registry',
  'operating-live-evidence-consent-record',
  'operating-connector-checkpoint',
  'operating-live-evidence-ingestion',
  'operating-measurement-plan',
  'operating-measurement-schedule',
  'operating-measurement-schedule-receipt',
  'operating-evidence-observation',
  'operating-outcome-evaluation',
  'operating-learning-receipt',
]);

function decodePointerToken(token) {
  return token.replaceAll('~1', '/').replaceAll('~0', '~');
}

function applyDescriptor(base, descriptor) {
  const candidate = structuredClone(base);
  const tokens = descriptor.path.split('/').slice(1).map(decodePointerToken);
  assert.ok(tokens.length > 0, `${descriptor.name}: JSON pointer targets a field`);
  const key = tokens.pop();
  let parent = candidate;
  for (const token of tokens) {
    assert.ok(
      parent !== null && typeof parent === 'object' && token in parent,
      `${descriptor.name}: ${descriptor.path}`,
    );
    parent = parent[token];
  }
  if (descriptor.operation === 'remove') {
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else delete parent[key];
  } else if (descriptor.operation === 'add' || descriptor.operation === 'replace') {
    parent[key] = structuredClone(descriptor.value);
  } else {
    assert.fail(`${descriptor.name}: unsupported fixture operation ${descriptor.operation}`);
  }
  return candidate;
}

test('live-evidence fixtures cover the exact closed companion contract family', () => {
  assert.deepEqual(Object.keys(valid).sort(), [...LIVE_EVIDENCE_CONTRACT_KINDS].sort());
  assert.deepEqual(Object.keys(invalid).sort(), [...LIVE_EVIDENCE_CONTRACT_KINDS].sort());
  for (const kind of LIVE_EVIDENCE_CONTRACT_KINDS) {
    assert.deepEqual(
      validateProtocolArtifact(kind, valid[kind], { protocolVersion: '2.0.0' }),
      [],
      kind,
    );
    assert.equal(valid[kind].kind, kind);
    assert.equal(valid[kind].schemaVersion, '1.0.0');
    assert.equal(valid[kind].protocolVersion, '2.0.0');
    assert.equal(schema(kind).additionalProperties, false, `${kind}: closed root`);
  }
});

test('schema hostiles reject unknown fields, authority widening, missing custody, and parallel truth bridges', () => {
  for (const kind of LIVE_EVIDENCE_CONTRACT_KINDS) {
    const schemaCases = invalid[kind].filter(({ expectedLayer }) => expectedLayer === 'schema');
    assert.ok(
      schemaCases.some(({ name }) => name === 'unknown field'),
      `${kind}: unknown-field hostile`,
    );
    for (const descriptor of schemaCases) {
      const candidate = applyDescriptor(valid[kind], descriptor);
      const errors = validateProtocolArtifact(kind, candidate, { protocolVersion: '2.0.0' });
      assert.ok(errors.length > 0, `${kind}: ${descriptor.name}`);
    }
  }

  assert.ok(
    invalid['operate-live-evidence-provider-registration'].some(
      ({ name }) => name === 'provider-call authority widening',
    ),
  );
  assert.ok(
    invalid['operating-connector-checkpoint'].some(
      ({ name }) => name === 'requesting checkpoint missing current consent',
    ),
  );
  assert.ok(
    invalid['operating-connector-checkpoint'].some(
      ({ name }) => name === 'requesting checkpoint missing runtime capability',
    ),
  );
  assert.ok(
    invalid['operating-live-evidence-ingestion'].some(
      ({ name }) => name === 'direct Artifact bridge',
    ),
  );
  assert.ok(
    invalid['operating-live-evidence-ingestion'].some(({ name }) => name === 'direct Event bridge'),
  );
  assert.ok(
    invalid['operating-outcome-evaluation'].some(
      ({ name }) => name === 'false PASS over typed absence',
    ),
  );
  assert.ok(
    invalid['operating-measurement-schedule'].some(
      ({ name }) => name === 'schedule custody substitution',
    ),
  );
});

test('every required field fails closed for every live-evidence companion contract', () => {
  for (const kind of LIVE_EVIDENCE_CONTRACT_KINDS) {
    for (const field of schema(kind).required) {
      const candidate = structuredClone(valid[kind]);
      delete candidate[field];
      assert.ok(
        validateProtocolArtifact(kind, candidate, { protocolVersion: '2.0.0' }).length > 0,
        `${kind}:${field}`,
      );
    }
  }
});

test('provider registration and consent describe bounded calls but never portable access authority', () => {
  const registration = valid['operate-live-evidence-provider-registration'];
  assert.deepEqual(registration.effects, ['provider-call']);
  assert.equal(registration.consent.previewEffect, 'none');
  assert.equal(registration.consent.runtimeCapability, 'opaque-local-preissued');
  assert.deepEqual(registration.consent.credentialRefKinds, ['environment-name', 'os-custody-key']);
  assert.equal(registration.sensitivity.rawRestrictedPortable, false);
  assert.equal(registration.fallback.kind, 'unavailable');
  assert.doesNotMatch(
    JSON.stringify(registration),
    /credential(?:Value|Secret)|bearer|privateKey/iu,
  );

  const consent = valid['operating-live-evidence-consent-record'];
  assert.equal(consent.authority, 'none');
  assert.equal(consent.docket.authorityBoundary, 'consent-is-not-access-authority');
  assert.deepEqual(consent.docket.choices, ['approve', 'cancel']);
  assert.equal(consent.docket.defaultChoice, null);
  assert.equal(consent.docket.cancelEffect, 'none');
});

test('the registry composes the live host profile with the frozen evidence provider and resolver identities', () => {
  const registration = valid['operate-live-evidence-provider-registration'];
  const populated = {
    ...valid['operate-live-evidence-provider-registry'],
    providers: [registration],
  };
  assert.deepEqual(
    validateProtocolArtifact(populated.kind, populated, { protocolVersion: '2.0.0' }),
    [],
  );
  assert.equal(
    registration.baseEvidenceProvider.contractId,
    'operate-evidence-provider-registration',
  );
  assert.equal(registration.baseResolver.contractId, 'operate-evidence-resolver-registration');
  assert.equal(registration.baseEvidenceProvider.protocolVersion, '2.0.0');
  assert.equal(registration.baseResolver.protocolVersion, '2.0.0');

  const unsafe = structuredClone(populated);
  unsafe.providers[0].baseResolver.credential = 'must-not-cross-the-portable-boundary';
  assert.ok(validateProtocolArtifact(unsafe.kind, unsafe, { protocolVersion: '2.0.0' }).length > 0);
});

test('ingestion uses the issued Assignment submission and existing Artifact/EvidenceRef bridge', () => {
  const ingestion = valid['operating-live-evidence-ingestion'];
  assert.equal(ingestion.assignment.assignmentKind, 'verification');
  assert.deepEqual(ingestion.assignment.outputContract, {
    schemaId: 'operating-live-evidence-ingestion',
    schemaVersion: '2.0.0',
  });
  assert.equal(ingestion.submission.operation, 'operate.assignment.submit');
  assert.equal(ingestion.submission.artifactId, ingestion.materialization.artifactId);
  assert.equal(
    ingestion.submission.artifactCreatedEventId,
    ingestion.materialization.artifactCreatedEventId,
  );
  assert.equal(ingestion.submission.evidenceRefId, ingestion.materialization.evidenceRefId);
  assert.ok(ingestion.submission.evidenceRefId.startsWith('evr_'));
  assert.ok(
    ingestion.records.every(
      (record) =>
        Object.keys(record).sort().join(',') === 'classification,contentDigest,recordIdentityHash',
    ),
  );
  assert.equal(ingestion.health.status, 'available');
  assert.equal(ingestion.sourceContract.version, '1.0.0');
  assert.equal(ingestion.evidenceCandidates[0].sourceArtifactId, ingestion.submission.artifactId);
  assert.equal(ingestion.evidenceCandidates[0].locator.artifactId, ingestion.submission.artifactId);
  assert.equal(
    ingestion.evidenceClaimLinks[0].candidateId,
    ingestion.evidenceCandidates[0].candidateId,
  );
  assert.equal(ingestion.evidenceClaimLinks[0].sourceArtifactId, ingestion.submission.artifactId);
});

test('observations, evaluations, and learning bind existing durable identities without parallel truth', () => {
  const observation = valid['operating-evidence-observation'];
  const evaluation = valid['operating-outcome-evaluation'];
  const learning = valid['operating-learning-receipt'];
  assert.equal(observation.metricObservation.contractId, 'operating-metric-observation');
  assert.equal(observation.metricId, evaluation.metricId);
  assert.equal(evaluation.verificationPlan.contractId, 'operating-action-verification-plan');
  assert.equal(evaluation.outcome.contractId, 'operating-outcome');
  assert.equal(learning.learning.contractId, 'operating-learning');
  assert.equal(learning.outcome.contractId, 'operating-outcome');
  assert.equal(learning.evaluation.evaluationHash, evaluation.evaluationHash);
  assert.equal(evaluation.observations[0].observationHash, observation.observationHash);
  assert.deepEqual(evaluation.absences, []);
  assert.deepEqual(evaluation.contradictions, []);
});

test('measurement plan and schedules bind canonical verification, consent, clock, and transition custody', () => {
  const plan = valid['operating-measurement-plan'];
  const schedule = valid['operating-measurement-schedule'];
  const receipt = valid['operating-measurement-schedule-receipt'];
  assert.equal(plan.verificationPlan.contractId, 'operating-action-verification-plan');
  assert.equal(plan.verificationPlan.protocolVersion, '2.0.0');
  assert.equal(plan.verificationPlan.canonicalTarget, plan.target.value);
  assert.equal(schedule.generation, 0);
  assert.equal(schedule.state, 'disabled');
  assert.equal(schedule.lastReceiptId, null);
  assert.equal(schedule.lastTransitionHash, null);
  assert.equal(receipt.authority, 'none');
  assert.equal(receipt.scheduleHash, receipt.resultingScheduleHash);
  assert.notEqual(receipt.previousScheduleHash, receipt.resultingScheduleHash);
  assert.equal(receipt.planHash, schedule.planHash);
  assert.deepEqual(receipt.consentRecordHashes, schedule.consentRecordHashes);
  assert.equal(receipt.ceilingsHash, schedule.ceilingsHash);
  assert.match(receipt.clockHash, /^sha256:[a-f0-9]{64}$/u);
});

test('schema-valid changed bridge and metric identities remain semantic binding conflicts', () => {
  for (const [kind, layer] of [
    ['operating-live-evidence-ingestion', 'bridge-conflict'],
    ['operating-evidence-observation', 'binding-conflict'],
  ]) {
    const descriptor = invalid[kind].find(({ expectedLayer }) => expectedLayer === layer);
    assert.ok(descriptor, `${kind}:${layer}`);
    const divergent = applyDescriptor(valid[kind], descriptor);
    assert.deepEqual(validateProtocolArtifact(kind, divergent, { protocolVersion: '2.0.0' }), []);
    assert.notDeepEqual(divergent, valid[kind]);
  }
});

test('schema validity does not turn an exact-identity divergent replay into authority', () => {
  const descriptor = invalid['operate-live-evidence-provider-registration'].find(
    ({ expectedLayer }) => expectedLayer === 'replay-conflict',
  );
  assert.ok(descriptor, 'divergent replay fixture');
  const base = valid['operate-live-evidence-provider-registration'];
  const divergent = applyDescriptor(base, descriptor);
  assert.deepEqual(
    validateProtocolArtifact(base.kind, divergent, { protocolVersion: '2.0.0' }),
    [],
  );
  assert.equal(divergent.providerId, base.providerId);
  assert.equal(divergent.providerVersion, base.providerVersion);
  assert.equal(divergent.registrationHash, base.registrationHash);
  assert.notDeepEqual(divergent, base);
});
