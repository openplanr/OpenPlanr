import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EVALUATION_GATE_THRESHOLDS,
  EVALUATION_METRICS,
  EVALUATION_PROTOCOL_VERSION,
  EVALUATION_SCHEMA_VERSION,
  EVALUATION_UNWAIVABLE_METRICS,
  EVALUATION_WAIVABLE_METRICS,
  assertEvaluationAggregateReport,
  assertEvaluationCorpus,
  assertEvaluationGatePolicy,
  assertEvaluationGraderIndependence,
  assertEvaluationGraderRegistration,
  assertEvaluationObservation,
  assertEvaluationScenario,
  assertEvaluationWaiver,
  assertEvaluationWaiverApplicable,
  assertSkillCertificationReceipt,
} from '../../lib/pipeline/evaluation-contract.mjs';
import {
  EVALUATION_EVIDENCE_INPUTS,
  assertUniqueJsonKeys,
  deriveEvaluationIdentity,
  evaluationContentDigest,
  evaluationEvidenceReuse,
  evaluationScenarioIdentityFromSource,
} from '../../lib/pipeline/evaluation-identity.mjs';
import { assertEvaluationAggregatePublishable } from '../../lib/pipeline/evaluation-redaction.mjs';

const digest = (seed) => evaluationContentDigest(`openplanr-evaluation-adversarial:${seed}`);

function seal(kind, body) {
  const derived = deriveEvaluationIdentity(body, kind);
  return { ...body, [derived.idField]: derived.id, [derived.digestField]: derived.digest };
}

const envelope = (kind) => ({
  kind,
  schemaVersion: EVALUATION_SCHEMA_VERSION,
  protocolVersion: EVALUATION_PROTOCOL_VERSION,
});

const scenario = seal('evaluation-scenario', {
  ...envelope('evaluation-scenario'),
  title: 'Negative trigger on an unrelated request',
  intent: 'The skill declines when the operator asks for something it does not own.',
  skill: { id: 'reference-skill', version: '1.0.0' },
  hostProfileRef: { hostProfileId: 'reference-host', hostProfileDigest: digest('host-profile') },
  promptClass: 'negative',
  expectedTrigger: { outcome: 'decline', rationale: 'The prompt names a task another surface owns.' },
  declaredPermissions: [{ capability: 'file-read', decision: 'granted' }],
  riskClass: 'read-only',
  fixtureRefs: [{ fixtureId: `efx_${'2'.repeat(64)}`, contentDigest: digest('prompt-bytes'), role: 'prompt' }],
  budgetRef: { budgetId: 'reference-budget', budgetDigest: digest('budget') },
});

const corpus = seal('evaluation-corpus', {
  ...envelope('evaluation-corpus'),
  title: 'Adversarial corpus for the evaluation contracts',
  skill: { id: 'reference-skill', version: '1.0.0' },
  members: [{
    scenarioId: scenario.scenarioId,
    scenarioDigest: scenario.scenarioDigest,
    sourcePath: 'fixtures/evaluation/negative.json',
  }],
});

const graderRegistration = seal('evaluation-grader-registration', {
  ...envelope('evaluation-grader-registration'),
  graderName: 'trigger-decision',
  graderVersion: '1.0.0',
  graderType: 'deterministic-behaviour',
  declaredInputs: [{ inputKind: 'scenario', required: true, binding: 'digest' }],
  determinism: {
    deterministic: true,
    modelCall: false,
    network: false,
    credentialUse: false,
    filesystemWrite: false,
    replay: 'identical-output',
  },
  telemetry: false,
  consent: null,
  credentialReference: null,
  outputContract: {
    contractId: 'evaluation-observation',
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    protocolVersion: EVALUATION_PROTOCOL_VERSION,
  },
  unavailableBehavior: 'typed-absence',
  blocksContractValidation: false,
  provenance: { packageName: 'planr-pipeline', packageVersion: '0.42.0', sourceDigest: digest('grader-source') },
});

const absentObservation = seal('evaluation-observation', {
  ...envelope('evaluation-observation'),
  runId: 'eru_8c1d0a6f4b2e93571d0a8c6e2f4b9013',
  scenario: {
    scenarioId: scenario.scenarioId,
    scenarioDigest: scenario.scenarioDigest,
    corpusDigest: corpus.corpusDigest,
    promptClass: 'negative',
  },
  grader: {
    graderId: graderRegistration.graderId,
    graderVersion: '1.0.0',
    graderType: 'deterministic-behaviour',
    registrationDigest: graderRegistration.registrationDigest,
    registryDigest: digest('grader-registry'),
  },
  hostProfile: {
    hostProfileId: `ehp_${'3'.repeat(32)}`,
    profileDigest: digest('host-profile'),
    registryDigest: digest('host-registry'),
  },
  fixtures: [{ fixtureId: `efx_${'2'.repeat(64)}`, contentDigest: digest('prompt-bytes') }],
  packageDigest: digest('package'),
  budgetDigest: digest('budget'),
  outcome: 'absent',
  terminalReason: 'GRADER_MISSING',
  graderOutputDigest: null,
  absence: {
    code: 'grader-missing',
    reason: 'The registered grader was not present on this host.',
    treatedAsPass: false,
    recoveryDisposition: 'register-grader',
  },
  observedAt: '2026-08-10T12:00:00.000Z',
});

const gatePolicy = seal('evaluation-gate-policy', {
  ...envelope('evaluation-gate-policy'),
  budgetDigest: digest('budget'),
  baselineDigest: digest('baseline'),
  gates: Object.fromEntries(
    Object.entries(EVALUATION_GATE_THRESHOLDS).map(([metric, threshold]) => [metric, { ...threshold }]),
  ),
});

const waiver = seal('evaluation-waiver', {
  ...envelope('evaluation-waiver'),
  gatePolicyDigest: gatePolicy.gatePolicyDigest,
  metric: 'journey-completion',
  scope: { kind: 'scenario', scenarioDigest: scenario.scenarioDigest },
  reason: { code: 'accepted-risk', statement: 'The owner accepts one incomplete journey for this release.' },
  ownerSignature: {
    identity: 'owner.reference',
    keyIdentity: 'key.reference',
    payloadDigest: digest('waiver-payload'),
  },
  issuedAt: '2026-08-10T00:00:00.000Z',
  expiresAt: '2026-09-01T00:00:00.000Z',
  receiptVisibility: 'visible',
});

/** One scenario, absent because its grader was missing. Nothing here is a pass. */
const aggregateReport = seal('evaluation-aggregate-report', {
  ...envelope('evaluation-aggregate-report'),
  generatedAt: '2026-08-10T12:05:00.000Z',
  redaction: {
    policyVersion: '1.0.0',
    rawPromptsExcluded: true,
    tracesExcluded: true,
    screenshotsExcluded: true,
    modelOutputExcluded: true,
    absolutePathsExcluded: true,
    credentialMaterialExcluded: true,
  },
  inputs: {
    corpusDigest: corpus.corpusDigest,
    graderRegistryDigest: digest('grader-registry'),
    hostProfileRegistryDigest: digest('host-registry'),
    gatePolicyDigest: gatePolicy.gatePolicyDigest,
    budgetBaselineDigest: digest('baseline'),
    hostProfileDigests: [digest('host-profile')],
    runResultDigests: [digest('run-result')],
  },
  counters: {
    scenariosTotal: 1,
    scenariosPassed: 0,
    scenariosFailed: 0,
    scenariosBlocked: 0,
    scenariosAbsent: 1,
    scenariosWaived: 0,
    triggerTruePositives: 0,
    triggerFalsePositives: 0,
    triggerFalseNegatives: 0,
    journeysAttempted: 1,
    journeysCompleted: 0,
    outputsValidated: 0,
    outputsSchemaValid: 0,
    assetsDeclared: 1,
    assetsPresent: 1,
    exportsDeclared: 1,
    exportsPresent: 1,
    packageMembersDeclared: 1,
    packageMembersPresent: 1,
    permissionPrompts: 0,
    retries: 0,
    findingsP0: 0,
    findingsP1: 0,
    findingsP2: 0,
    findingsP3: 0,
  },
  rates: {
    triggerPrecision: 0,
    triggerRecall: 0,
    journeyCompletion: 0,
    schemaValidity: 0,
    assetParity: 10_000,
    exportParity: 10_000,
    packageParity: 10_000,
  },
  budget: {
    baselineDigest: digest('baseline'),
    latencyMsBaseline: 1_200,
    latencyMsObserved: 1_200,
    latencyRegression: 0,
    costEstimateMicrosBaseline: 4_200,
    costEstimateMicrosObserved: 4_200,
    costRegression: 0,
    permissionPromptCeiling: 2,
    retryCeiling: 1,
  },
  absences: {
    graderMissing: 1,
    graderErrored: 0,
    graderUnavailable: 0,
    hostUnavailable: 0,
    fixtureUnavailable: 0,
    budgetExceeded: 0,
    notRun: 0,
  },
  skills: [{
    skillId: 'reference-skill',
    skillVersion: '1.0.0',
    scenariosTotal: 1,
    scenariosPassed: 0,
    scenariosFailed: 0,
    scenariosBlocked: 0,
    scenariosAbsent: 1,
    scenariosWaived: 0,
  }],
  scenarios: [{
    scenarioDigest: scenario.scenarioDigest,
    skillId: 'reference-skill',
    hostProfileDigest: digest('host-profile'),
    graderRegistrationDigest: graderRegistration.registrationDigest,
    fixtureSetDigest: digest('fixture-set'),
    promptClass: 'negative',
    status: 'absent',
    absenceReason: 'grader-missing',
    waiverDigest: null,
    observations: 1,
    latencyMs: 0,
  }],
});

function buildReceipt(overrides = {}) {
  const body = {
    ...envelope('skill-certification-receipt'),
    recordType: 'readiness',
    issuedAt: '2026-08-10T12:10:00.000Z',
    subject: { skillId: 'reference-skill', skillVersion: '1.0.0', skillSourceDigest: digest('skill-source') },
    inputs: {
      corpusDigest: corpus.corpusDigest,
      graderRegistryDigest: digest('grader-registry'),
      hostProfiles: [{ hostProfileId: 'reference-host', hostProfileDigest: digest('host-profile') }],
      budgetBaselineDigest: digest('baseline'),
      gatePolicyDigest: gatePolicy.gatePolicyDigest,
      aggregateReportDigest: aggregateReport.reportDigest,
    },
    gateEvaluation: EVALUATION_METRICS.map((metric) => ({
      metric,
      waivable: EVALUATION_WAIVABLE_METRICS.includes(metric),
      status: 'met',
      waiverDigest: null,
    })),
    appliedWaivers: [],
    result: 'release-ready',
    blockingMetrics: [],
    ...overrides,
  };
  return seal('skill-certification-receipt', body);
}

test('a scenario whose bytes changed but whose identity did not is refused', () => {
  // The dangerous shape: an author edits the record and leaves the identity pair
  // alone, so every observation recorded against the old bytes still points here.
  const rewritten = { ...scenario, intent: 'The skill invokes on anything that mentions planning.' };
  assert.throws(
    () => assertEvaluationScenario(rewritten),
    (error) => error.code === 'E_EVALUATION_DIGEST_MISMATCH',
  );

  // Refreshing only the digest is the same lie one field over.
  const refreshed = deriveEvaluationIdentity(rewritten, 'evaluation-scenario');
  assert.throws(
    () => assertEvaluationScenario({ ...rewritten, scenarioDigest: refreshed.digest }),
    (error) => error.code === 'E_EVALUATION_IDENTITY_FOREIGN',
  );

  // The corpus catches the same drift from the other side, by recomputing bytes.
  const [member] = corpus.members;
  assert.throws(
    () => assertEvaluationCorpus(corpus, { sourceDigests: { [member.sourcePath]: refreshed.digest } }),
    (error) => error.code === 'E_EVALUATION_DIGEST_MISMATCH',
  );
});

test('scenario identity follows meaning, not formatting, and a repeated key is never merged', () => {
  const pretty = JSON.stringify(scenario, null, 2);
  const compact = JSON.stringify(scenario);
  assert.equal(evaluationScenarioIdentityFromSource(pretty).scenarioId, scenario.scenarioId);
  assert.equal(evaluationScenarioIdentityFromSource(compact).scenarioId, scenario.scenarioId);
  assert.throws(
    () => assertUniqueJsonKeys('{"kind":"evaluation-scenario","kind":"evaluation-corpus"}', 'scenario source'),
    (error) => error.code === 'E_EVALUATION_CONTRACT_INVALID',
    'a duplicate key would let a foreign field overwrite a governed one',
  );
});

test('a changed grader digest invalidates exactly the evidence bound to it', () => {
  const scenarios = ['a', 'b', 'c'].map((label) => `esc_${label.repeat(64)}`);
  const boundTo = (scenarioId) => Object.fromEntries(
    EVALUATION_EVIDENCE_INPUTS.map((field) => [field, digest(`${field}:${scenarioId}`)]),
  );
  const prior = scenarios.map((scenarioId) => ({ scenarioId, inputs: boundTo(scenarioId) }));
  const [untouched, ...regraded] = prior;
  const current = [
    untouched,
    ...regraded.map((entry) => ({
      ...entry,
      inputs: { ...entry.inputs, graderRegistrationDigest: digest('grader-registration-v2') },
    })),
  ];

  const reuse = evaluationEvidenceReuse(prior, current);
  assert.deepEqual(reuse.reusable, [untouched.scenarioId]);
  assert.deepEqual(
    reuse.invalidated.map(({ scenarioId, reason, changedInputs }) => ({ scenarioId, reason, changedInputs: [...changedInputs] })),
    regraded.map(({ scenarioId }) => ({
      scenarioId,
      reason: 'input-digest-changed',
      changedInputs: ['graderRegistrationDigest'],
    })),
    'the validator must name the invalidated scenarios rather than invalidate the whole run',
  );
  assert.deepEqual(reuse.unevaluated, []);

  // A scenario the current run no longer covers is enumerated too, never assumed to hold.
  const dropped = evaluationEvidenceReuse(prior, [untouched]);
  assert.deepEqual(dropped.invalidated.map(({ reason }) => reason), ['scenario-absent', 'scenario-absent']);
});

test('a typed grader absence can never be read as a pass', () => {
  assert.equal(assertEvaluationObservation(absentObservation), absentObservation);
  assert.equal(absentObservation.absence.treatedAsPass, false);

  assert.throws(
    () => assertEvaluationObservation({
      ...absentObservation,
      absence: { ...absentObservation.absence, treatedAsPass: true },
    }),
    (error) => error.code === 'E_EVALUATION_ABSENCE_INVALID',
  );
  assert.throws(
    () => assertEvaluationObservation({
      ...absentObservation,
      outcome: 'pass',
      graderOutputDigest: digest('fabricated-grader-output'),
    }),
    (error) => error.code === 'E_EVALUATION_ABSENCE_INVALID',
    'a pass may not carry an absence',
  );
  assert.throws(
    () => assertEvaluationObservation({ ...absentObservation, graderOutputDigest: digest('fabricated-grader-output') }),
    (error) => error.code === 'E_EVALUATION_ABSENCE_INVALID',
    'an absence has no grader output to bind',
  );

  // The same absence cannot be relabelled a pass once it reaches the report.
  assert.equal(assertEvaluationAggregateReport(aggregateReport), aggregateReport);
  assert.throws(
    () => assertEvaluationAggregateReport({
      ...aggregateReport,
      counters: { ...aggregateReport.counters, scenariosPassed: 1, scenariosAbsent: 0 },
    }),
    (error) => error.code === 'E_EVALUATION_CONTRACT_INVALID',
  );
  assert.throws(
    () => assertEvaluationAggregateReport({
      ...aggregateReport,
      scenarios: [{ ...aggregateReport.scenarios[0], status: 'passed' }],
    }),
    (error) => error.code === 'E_EVALUATION_ABSENCE_INVALID',
  );
});

test('a grader may not certify itself and a deterministic grader may not reach a model or a credential', () => {
  assert.throws(
    () => assertEvaluationGraderIndependence(graderRegistration, {
      skillId: graderRegistration.graderName,
      skillSourceDigest: digest('unrelated-skill-source'),
    }),
    (error) => error.code === 'E_EVALUATION_GRADER_NOT_INDEPENDENT',
  );
  assert.throws(
    () => assertEvaluationGraderIndependence(graderRegistration, {
      skillId: 'reference-skill',
      skillSourceDigest: graderRegistration.provenance.sourceDigest,
    }),
    (error) => error.code === 'E_EVALUATION_GRADER_NOT_INDEPENDENT',
    'sharing source bytes with the subject is self-certification under another name',
  );

  for (const claim of ['modelCall', 'network', 'credentialUse']) {
    assert.throws(
      () => assertEvaluationGraderRegistration({
        ...graderRegistration,
        determinism: { ...graderRegistration.determinism, [claim]: true },
      }),
      (error) => error.code === 'E_EVALUATION_GRADER_INVALID',
      `a deterministic grader declaring ${claim} was accepted`,
    );
  }
  assert.throws(
    () => assertEvaluationGraderRegistration({
      ...graderRegistration,
      credentialReference: { refKind: 'environment-name', refName: 'OPENPLANR_JUDGE_KEY', custody: 'host-owned' },
    }),
    (error) => error.code === 'E_EVALUATION_GRADER_INVALID',
  );
});

test('a waiver cannot reach a P0 or P1 finding, schema validity, or package parity', () => {
  assert.deepEqual(
    [...EVALUATION_UNWAIVABLE_METRICS].sort(),
    ['finding-severity-p0', 'finding-severity-p1', 'package-parity', 'schema-validity'],
  );
  for (const metric of EVALUATION_UNWAIVABLE_METRICS) {
    assert.throws(
      () => assertEvaluationWaiver({ ...waiver, metric }),
      (error) => error.code === 'E_EVALUATION_WAIVER_REFUSED',
      `${metric} was waivable`,
    );
    assert.throws(
      () => assertEvaluationGatePolicy({
        ...gatePolicy,
        gates: { ...gatePolicy.gates, [metric]: { ...gatePolicy.gates[metric], waivable: true } },
      }),
      (error) => error.code === 'E_EVALUATION_GATE_POLICY_INVALID',
      `${metric} could be marked waivable in the policy`,
    );
  }

  // A receipt is the last place the same waiver could sneak in.
  assert.throws(
    () => assertSkillCertificationReceipt(buildReceipt({
      gateEvaluation: EVALUATION_METRICS.map((metric) => (metric === 'schema-validity'
        ? { metric, waivable: true, status: 'waived', waiverDigest: digest('forged-waiver') }
        : { metric, waivable: EVALUATION_WAIVABLE_METRICS.includes(metric), status: 'met', waiverDigest: null })),
    })),
    (error) => error.code === 'E_EVALUATION_WAIVER_REFUSED',
  );
});

test('an unbounded, scope-free, or expired waiver is refused', () => {
  assert.throws(
    () => assertEvaluationWaiver({ ...waiver, expiresAt: '2027-08-10T00:00:00.000Z' }),
    (error) => error.code === 'E_EVALUATION_WAIVER_REFUSED',
    'a horizon longer than the cap is a permanent exemption',
  );
  assert.throws(
    () => assertEvaluationWaiver({ ...waiver, expiresAt: waiver.issuedAt }),
    (error) => error.code === 'E_EVALUATION_WAIVER_REFUSED',
  );
  assert.throws(
    () => assertEvaluationWaiver({ ...waiver, scope: { kind: 'release' } }),
    (error) => error.code === 'E_EVALUATION_WAIVER_REFUSED',
  );

  assert.equal(
    assertEvaluationWaiverApplicable(waiver, {
      now: '2026-08-20T00:00:00.000Z',
      gatePolicyDigest: gatePolicy.gatePolicyDigest,
      scenarioDigest: scenario.scenarioDigest,
    }),
    waiver,
  );
  assert.throws(
    () => assertEvaluationWaiverApplicable(waiver, { now: '2026-09-02T00:00:00.000Z' }),
    (error) => error.code === 'E_EVALUATION_WAIVER_REFUSED',
  );
  assert.throws(
    () => assertEvaluationWaiverApplicable(waiver, {
      now: '2026-08-20T00:00:00.000Z',
      scenarioDigest: digest('some-other-scenario'),
    }),
    (error) => error.code === 'E_EVALUATION_WAIVER_REFUSED',
    'a scenario waiver never carries to bytes it was not granted against',
  );
});

test('a certification receipt reports readiness and can carry no release authority', () => {
  const ready = buildReceipt();
  assert.equal(assertSkillCertificationReceipt(ready), ready);
  assert.equal(ready.recordType, 'readiness');

  for (const field of ['publishAuthority', 'releaseAuthority', 'deployAuthority', 'grants', 'capabilities', 'marketplacePromotion', 'roomActivation', 'approval']) {
    assert.throws(
      () => assertSkillCertificationReceipt({ ...ready, [field]: true }),
      (error) => error.code === 'E_EVALUATION_RECEIPT_AUTHORITY_CLAIM',
      `${field} was accepted as a receipt field`,
    );
  }
  assert.throws(
    () => assertSkillCertificationReceipt({ ...ready, subject: { ...ready.subject, grant: 'publish' } }),
    (error) => error.code === 'E_EVALUATION_RECEIPT_AUTHORITY_CLAIM',
    'an authority claim one level down still reads as authority',
  );

  // Readiness is a conclusion about gates, never a decision an author can assert.
  const withUnmetGate = EVALUATION_METRICS.map((metric) => ({
    metric,
    waivable: EVALUATION_WAIVABLE_METRICS.includes(metric),
    status: metric === 'trigger-recall' ? 'not-met' : 'met',
    waiverDigest: null,
  }));
  assert.throws(
    () => assertSkillCertificationReceipt(buildReceipt({ gateEvaluation: withUnmetGate, blockingMetrics: ['trigger-recall'] })),
    (error) => error.code === 'E_EVALUATION_CONTRACT_INVALID',
  );
  const blocked = buildReceipt({ gateEvaluation: withUnmetGate, blockingMetrics: ['trigger-recall'], result: 'blocked' });
  assert.equal(assertSkillCertificationReceipt(blocked), blocked);
  assert.deepEqual(blocked.blockingMetrics, ['trigger-recall']);
});

test('only the redacted aggregate report is publishable', () => {
  assert.equal(assertEvaluationAggregatePublishable(aggregateReport), aggregateReport);

  for (const declaration of Object.keys(aggregateReport.redaction).filter((key) => key !== 'policyVersion')) {
    assert.throws(
      () => assertEvaluationAggregatePublishable({
        ...aggregateReport,
        redaction: { ...aggregateReport.redaction, [declaration]: false },
      }),
      (error) => error.code === 'E_EVALUATION_PUBLISH_UNSAFE',
      `${declaration} could be declared off`,
    );
  }

  // Anything that is not the aggregate report is refused outright, so a projection
  // built from a local run result never becomes a published one.
  assert.throws(
    () => assertEvaluationAggregatePublishable({ ...aggregateReport, kind: 'evaluation-run-result' }),
    (error) => error.code === 'E_EVALUATION_PUBLISH_UNSAFE',
  );
  for (const smuggled of [
    { prompt: 'Plan the release for me.' },
    { trace: 'step 1 -> step 2' },
    { screenshot: 'iVBORw0KGgo=' },
    { modelOutput: 'I will invoke the skill.' },
    { sourcePath: '/Users/owner/corpus/negative.json' },
    { token: 'ghp_0123456789abcdef0123456789abcdef0123' },
  ]) {
    assert.throws(
      () => assertEvaluationAggregatePublishable({ ...aggregateReport, ...smuggled }),
      (error) => error.code === 'E_EVALUATION_PUBLISH_UNSAFE' || error.code === 'E_EVALUATION_CONTRACT_INVALID',
      `${Object.keys(smuggled)[0]} reached a published report`,
    );
  }
});
