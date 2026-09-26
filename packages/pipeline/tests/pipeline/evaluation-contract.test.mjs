import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  assertEvaluationAggregateReport,
  assertEvaluationBudget,
  assertEvaluationCorpus,
  assertEvaluationFixture,
  assertEvaluationGatePolicy,
  assertEvaluationGraderRegistration,
  assertEvaluationGraderRegistry,
  assertEvaluationHostProfile,
  assertEvaluationHostProfileRegistry,
  assertEvaluationObservation,
  assertEvaluationRunResult,
  assertEvaluationScenario,
  assertEvaluationWaiver,
  assertSkillCertificationReceipt,
  EVALUATION_GATE_THRESHOLDS,
  EVALUATION_METRICS,
  EVALUATION_PROTOCOL_VERSION,
  EVALUATION_SCHEMA_VERSION,
  EVALUATION_WAIVABLE_METRICS,
} from '../../lib/pipeline/evaluation-contract.mjs';
import {
  deriveEvaluationIdentity,
  EVALUATION_IDENTITY_BINDINGS,
  evaluationContentDigest,
} from '../../lib/pipeline/evaluation-identity.mjs';
import { validateProtocolArtifact } from '../../lib/protocol/contracts.mjs';

const digest = (seed) => evaluationContentDigest(`openplanr-evaluation-reference:${seed}`);

/** Stamp a record with the identity its own canonical bytes derive. */
function seal(kind, body) {
  const derived = deriveEvaluationIdentity(body, kind);
  return { ...body, [derived.idField]: derived.id, [derived.digestField]: derived.digest };
}

const envelope = (kind) => ({
  kind,
  schemaVersion: EVALUATION_SCHEMA_VERSION,
  protocolVersion: EVALUATION_PROTOCOL_VERSION,
});

const hostProfile = seal('evaluation-host-profile', {
  ...envelope('evaluation-host-profile'),
  host: 'reference-host',
  profileVersion: '1.0.0',
  runtime: 'cli',
  platform: 'linux',
  capabilityTier: 'workflow',
  permissionModel: {
    mode: 'prompted',
    promptSurface: 'terminal',
    toolIsolation: 'enforced',
    escalation: 'refused',
  },
  outputModes: ['json', 'text'],
  skillHostSupport: true,
  certifiedFullPipelineRuntime: false,
  adapterBinding: null,
  provenance: {
    packageName: 'planr-pipeline',
    packageVersion: '0.42.0',
    sourceDigest: digest('host-source'),
  },
});

const hostProfileRegistry = seal('evaluation-host-profile-registry', {
  ...envelope('evaluation-host-profile-registry'),
  registryVersion: '1.0.0',
  digestAlgorithm: 'sha256',
  canonicalization: 'jcs',
  memberOrder: 'host-ascending',
  profiles: [hostProfile],
});

const graderRegistration = seal('evaluation-grader-registration', {
  ...envelope('evaluation-grader-registration'),
  graderName: 'trigger-decision',
  graderVersion: '1.0.0',
  graderType: 'deterministic-behaviour',
  declaredInputs: [
    { inputKind: 'scenario', required: true, binding: 'digest' },
    { inputKind: 'declared-output', required: true, binding: 'digest' },
  ],
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
  provenance: {
    packageName: 'planr-pipeline',
    packageVersion: '0.42.0',
    sourceDigest: digest('grader-source'),
  },
});

const graderRegistry = seal('evaluation-grader-registry', {
  ...envelope('evaluation-grader-registry'),
  registryVersion: '1.0.0',
  digestAlgorithm: 'sha256',
  canonicalization: 'jcs',
  memberOrder: 'graderName-ascending',
  graders: [graderRegistration],
});

const budget = seal('evaluation-budget', {
  ...envelope('evaluation-budget'),
  carriesMeasurement: false,
  scope: { kind: 'corpus', id: 'reference-corpus' },
  ceilings: {
    latencyMsP50Ceiling: 4_000,
    latencyMsP95Ceiling: 12_000,
    inputTokensCeiling: 20_000,
    outputTokensCeiling: 4_000,
    totalTokensCeiling: 24_000,
    costEstimateCurrency: 'USD',
    costEstimateMicrosCeiling: 250_000,
    permissionPromptCeiling: 2,
    retryCeiling: 1,
  },
  baseline: {
    frozen: true,
    baselineDigest: digest('baseline'),
    capturedAt: '2026-08-01T00:00:00.000Z',
  },
});

const gatePolicy = seal('evaluation-gate-policy', {
  ...envelope('evaluation-gate-policy'),
  budgetDigest: budget.budgetDigest,
  baselineDigest: budget.baseline.baselineDigest,
  gates: Object.fromEntries(
    Object.entries(EVALUATION_GATE_THRESHOLDS).map(([metric, threshold]) => [
      metric,
      { ...threshold },
    ]),
  ),
});

const fixture = seal('evaluation-fixture', {
  ...envelope('evaluation-fixture'),
  mediaKind: 'text',
  byteLength: 64,
  contentDigest: digest('prompt-bytes'),
  sourcePath: 'fixtures/evaluation/prompt.txt',
  retention: 'local-only',
  containsCredentialMaterial: false,
});

const scenario = seal('evaluation-scenario', {
  ...envelope('evaluation-scenario'),
  title: 'Positive trigger on an explicit planning request',
  intent: 'The skill invokes when the operator asks for a plan in plain language.',
  skill: { id: 'reference-skill', version: '1.0.0' },
  hostProfileRef: { hostProfileId: 'reference-host', hostProfileDigest: hostProfile.profileDigest },
  promptClass: 'positive',
  expectedTrigger: {
    outcome: 'invoke',
    rationale: 'The prompt names the task the skill exists to do.',
  },
  declaredPermissions: [{ capability: 'file-read', decision: 'granted' }],
  riskClass: 'read-only',
  fixtureRefs: [
    { fixtureId: fixture.fixtureId, contentDigest: fixture.contentDigest, role: 'prompt' },
  ],
  budgetRef: { budgetId: 'reference-budget', budgetDigest: budget.budgetDigest },
});

const corpus = seal('evaluation-corpus', {
  ...envelope('evaluation-corpus'),
  title: 'Reference corpus for the evaluation contracts',
  skill: { id: 'reference-skill', version: '1.0.0' },
  members: [
    {
      scenarioId: scenario.scenarioId,
      scenarioDigest: scenario.scenarioDigest,
      sourcePath: 'fixtures/evaluation/scenario.json',
    },
  ],
});

const RUN_ID = 'eru_2f1b6d4c8a0e47159c3d5b7e91a0c246';

const observation = seal('evaluation-observation', {
  ...envelope('evaluation-observation'),
  runId: RUN_ID,
  scenario: {
    scenarioId: scenario.scenarioId,
    scenarioDigest: scenario.scenarioDigest,
    corpusDigest: corpus.corpusDigest,
    promptClass: 'positive',
  },
  grader: {
    graderId: graderRegistration.graderId,
    graderVersion: '1.0.0',
    graderType: 'deterministic-behaviour',
    registrationDigest: graderRegistration.registrationDigest,
    registryDigest: graderRegistry.registryDigest,
  },
  hostProfile: {
    hostProfileId: hostProfile.hostProfileId,
    profileDigest: hostProfile.profileDigest,
    registryDigest: hostProfileRegistry.registryDigest,
  },
  fixtures: [{ fixtureId: fixture.fixtureId, contentDigest: fixture.contentDigest }],
  packageDigest: digest('package'),
  budgetDigest: budget.budgetDigest,
  outcome: 'pass',
  terminalReason: 'TRIGGER_MATCHED',
  graderOutputDigest: digest('grader-output'),
  absence: null,
  observedAt: '2026-08-10T12:00:00.000Z',
});

const runResult = seal('evaluation-run-result', {
  ...envelope('evaluation-run-result'),
  runId: RUN_ID,
  visibility: 'local',
  publishable: false,
  evidenceTransport: 'digest-only',
  corpusDigest: corpus.corpusDigest,
  graderRegistryDigest: graderRegistry.registryDigest,
  hostProfileRegistryDigest: hostProfileRegistry.registryDigest,
  hostProfiles: [
    { hostProfileId: hostProfile.hostProfileId, profileDigest: hostProfile.profileDigest },
  ],
  budgetDigest: budget.budgetDigest,
  gatePolicyDigest: gatePolicy.gatePolicyDigest,
  packageDigest: digest('package'),
  sourceDigest: digest('source'),
  observations: [
    {
      observationId: observation.observationId,
      observationDigest: observation.observationDigest,
      scenarioDigest: scenario.scenarioDigest,
      outcome: 'pass',
    },
  ],
  measurements: {
    latencyMsP50: 1_200,
    latencyMsP95: 2_400,
    inputTokens: 900,
    outputTokens: 300,
    totalTokens: 1_200,
    costEstimateCurrency: 'USD',
    costEstimateMicros: 4_200,
    permissionPrompts: 1,
    retries: 0,
  },
  findingCounts: { p0: 0, p1: 0, p2: 0, p3: 0 },
  rawEvidence: [
    {
      evidenceId: 'eev_5c8a1f0b3d6e29471a8b0c2d4e6f8091',
      class: 'prompt',
      contentDigest: digest('prompt-bytes'),
      byteLength: 64,
    },
  ],
  terminalReason: 'RUN_COMPLETED',
  startedAt: '2026-08-10T11:59:00.000Z',
  completedAt: '2026-08-10T12:00:00.000Z',
});

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
    graderRegistryDigest: graderRegistry.registryDigest,
    hostProfileRegistryDigest: hostProfileRegistry.registryDigest,
    gatePolicyDigest: gatePolicy.gatePolicyDigest,
    budgetBaselineDigest: budget.baseline.baselineDigest,
    hostProfileDigests: [hostProfile.profileDigest],
    runResultDigests: [runResult.runResultDigest],
  },
  counters: {
    scenariosTotal: 1,
    scenariosPassed: 1,
    scenariosFailed: 0,
    scenariosBlocked: 0,
    scenariosAbsent: 0,
    scenariosWaived: 0,
    triggerTruePositives: 1,
    triggerFalsePositives: 0,
    triggerFalseNegatives: 0,
    journeysAttempted: 1,
    journeysCompleted: 1,
    outputsValidated: 1,
    outputsSchemaValid: 1,
    assetsDeclared: 1,
    assetsPresent: 1,
    exportsDeclared: 1,
    exportsPresent: 1,
    packageMembersDeclared: 1,
    packageMembersPresent: 1,
    permissionPrompts: 1,
    retries: 0,
    findingsP0: 0,
    findingsP1: 0,
    findingsP2: 0,
    findingsP3: 0,
  },
  rates: {
    triggerPrecision: 10_000,
    triggerRecall: 10_000,
    journeyCompletion: 10_000,
    schemaValidity: 10_000,
    assetParity: 10_000,
    exportParity: 10_000,
    packageParity: 10_000,
  },
  budget: {
    baselineDigest: budget.baseline.baselineDigest,
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
    graderMissing: 0,
    graderErrored: 0,
    graderUnavailable: 0,
    hostUnavailable: 0,
    fixtureUnavailable: 0,
    budgetExceeded: 0,
    notRun: 0,
  },
  skills: [
    {
      skillId: 'reference-skill',
      skillVersion: '1.0.0',
      scenariosTotal: 1,
      scenariosPassed: 1,
      scenariosFailed: 0,
      scenariosBlocked: 0,
      scenariosAbsent: 0,
      scenariosWaived: 0,
    },
  ],
  scenarios: [
    {
      scenarioDigest: scenario.scenarioDigest,
      skillId: 'reference-skill',
      hostProfileDigest: hostProfile.profileDigest,
      graderRegistrationDigest: graderRegistration.registrationDigest,
      fixtureSetDigest: digest('fixture-set'),
      promptClass: 'positive',
      status: 'passed',
      absenceReason: null,
      waiverDigest: null,
      observations: 1,
      latencyMs: 1_200,
    },
  ],
});

const waiver = seal('evaluation-waiver', {
  ...envelope('evaluation-waiver'),
  gatePolicyDigest: gatePolicy.gatePolicyDigest,
  metric: 'journey-completion',
  scope: { kind: 'scenario', scenarioDigest: scenario.scenarioDigest },
  reason: {
    code: 'environment-limitation',
    statement: 'The reference host cannot open a browser in this environment.',
  },
  ownerSignature: {
    identity: 'owner.reference',
    keyIdentity: 'key.reference',
    payloadDigest: digest('waiver-payload'),
  },
  issuedAt: '2026-08-10T00:00:00.000Z',
  expiresAt: '2026-09-01T00:00:00.000Z',
  receiptVisibility: 'visible',
});

const receipt = seal('skill-certification-receipt', {
  ...envelope('skill-certification-receipt'),
  recordType: 'readiness',
  issuedAt: '2026-08-10T12:10:00.000Z',
  subject: {
    skillId: 'reference-skill',
    skillVersion: '1.0.0',
    skillSourceDigest: digest('skill-source'),
  },
  inputs: {
    corpusDigest: corpus.corpusDigest,
    graderRegistryDigest: graderRegistry.registryDigest,
    hostProfiles: [
      { hostProfileId: 'reference-host', hostProfileDigest: hostProfile.profileDigest },
    ],
    budgetBaselineDigest: budget.baseline.baselineDigest,
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
});

const UNKNOWN = { evaluationNote: 'extra' };

/** Inject an unknown field one level below the root, wherever this kind nests one. */
const inNested = (field) => (record) => ({ ...record, [field]: { ...record[field], ...UNKNOWN } });
const inMember = (field) => (record) => ({
  ...record,
  [field]: [{ ...record[field][0], ...UNKNOWN }, ...record[field].slice(1)],
});

/** One reference record and one nested injection per kind, so both closure depths are covered. */
const CONTRACTS = Object.freeze([
  {
    kind: 'evaluation-scenario',
    validate: assertEvaluationScenario,
    record: scenario,
    nest: inNested('expectedTrigger'),
  },
  {
    kind: 'evaluation-corpus',
    validate: assertEvaluationCorpus,
    record: corpus,
    nest: inMember('members'),
  },
  { kind: 'evaluation-fixture', validate: assertEvaluationFixture, record: fixture, nest: null },
  {
    kind: 'evaluation-host-profile',
    validate: assertEvaluationHostProfile,
    record: hostProfile,
    nest: inNested('permissionModel'),
  },
  {
    kind: 'evaluation-host-profile-registry',
    validate: assertEvaluationHostProfileRegistry,
    record: hostProfileRegistry,
    nest: inMember('profiles'),
  },
  {
    kind: 'evaluation-grader-registration',
    validate: assertEvaluationGraderRegistration,
    record: graderRegistration,
    nest: inNested('determinism'),
  },
  {
    kind: 'evaluation-grader-registry',
    validate: assertEvaluationGraderRegistry,
    record: graderRegistry,
    nest: inMember('graders'),
  },
  {
    kind: 'evaluation-budget',
    validate: assertEvaluationBudget,
    record: budget,
    nest: inNested('ceilings'),
  },
  {
    kind: 'evaluation-gate-policy',
    validate: assertEvaluationGatePolicy,
    record: gatePolicy,
    nest: (record) => ({
      ...record,
      gates: {
        ...record.gates,
        'schema-validity': { ...record.gates['schema-validity'], ...UNKNOWN },
      },
    }),
  },
  {
    kind: 'evaluation-observation',
    validate: assertEvaluationObservation,
    record: observation,
    nest: inNested('grader'),
  },
  {
    kind: 'evaluation-run-result',
    validate: assertEvaluationRunResult,
    record: runResult,
    nest: inNested('measurements'),
  },
  {
    kind: 'evaluation-aggregate-report',
    validate: assertEvaluationAggregateReport,
    record: aggregateReport,
    nest: inNested('counters'),
  },
  {
    kind: 'evaluation-waiver',
    validate: assertEvaluationWaiver,
    record: waiver,
    nest: inNested('ownerSignature'),
  },
  {
    kind: 'skill-certification-receipt',
    validate: assertSkillCertificationReceipt,
    record: receipt,
    nest: inNested('subject'),
  },
]);

const CLOSED_FIELD_REFUSAL = (error) => error.code === 'E_EVALUATION_CONTRACT_INVALID';
const VERSION_REFUSAL = (error) => error.code === 'E_EVALUATION_VERSION_UNSUPPORTED';

test('the family under test is the whole family', () => {
  assert.deepEqual(
    CONTRACTS.map(({ kind }) => kind).sort(),
    Object.keys(EVALUATION_IDENTITY_BINDINGS).sort(),
  );
});

test('every validator and its packaged schema accept the same reference record', () => {
  for (const { kind, validate, record } of CONTRACTS) {
    assert.equal(validate(record), record, `${kind}: validator returned a different record`);
    assert.deepEqual(
      validateProtocolArtifact(kind, record, { protocolVersion: EVALUATION_PROTOCOL_VERSION }),
      [],
      `${kind}: the schema rejects a record the validator accepts`,
    );
  }
});

test('every reference identity is derived from the record it names', () => {
  for (const { kind, record } of CONTRACTS) {
    const derived = deriveEvaluationIdentity(record, kind);
    assert.equal(record[derived.idField], derived.id, `${kind}: identity is not content-bound`);
    assert.equal(
      record[derived.digestField],
      derived.digest,
      `${kind}: digest is not content-bound`,
    );
  }
});

test('an unknown field is refused as a closed-contract violation, at the root and one level down', () => {
  // The refusal code matters: identity sealing would also reject these bytes, and a
  // test that accepted either code would still pass with the closure check deleted.
  for (const { kind, validate, record, nest } of CONTRACTS) {
    assert.throws(
      () => validate({ ...record, ...UNKNOWN }),
      CLOSED_FIELD_REFUSAL,
      `${kind}: an unknown root field was accepted`,
    );
    if (nest === null) continue;
    assert.throws(
      () => validate(nest(record)),
      CLOSED_FIELD_REFUSAL,
      `${kind}: an unknown nested field was accepted`,
    );
  }
});

test('removing any declared field is refused, so no field is quietly optional', () => {
  for (const { kind, validate, record } of CONTRACTS) {
    for (const field of Object.keys(record)) {
      const truncated = { ...record };
      delete truncated[field];
      const expected =
        field === 'schemaVersion' || field === 'protocolVersion'
          ? VERSION_REFUSAL
          : CLOSED_FIELD_REFUSAL;
      assert.throws(
        () => validate(truncated),
        expected,
        `${kind}: a record without ${field} was accepted`,
      );
    }
  }
});

test('an implicit or unsupported contract version is refused for every kind', () => {
  for (const { kind, validate, record } of CONTRACTS) {
    assert.throws(() => validate({ ...record, protocolVersion: '1.3.0' }), VERSION_REFUSAL, kind);
    assert.throws(() => validate({ ...record, schemaVersion: '1.1.0' }), VERSION_REFUSAL, kind);
  }
});

test('a record of the wrong kind is refused rather than coerced', () => {
  for (const { kind, validate, record } of CONTRACTS) {
    assert.throws(
      () =>
        validate({
          ...record,
          kind: kind === 'evaluation-fixture' ? 'evaluation-scenario' : 'evaluation-fixture',
        }),
      CLOSED_FIELD_REFUSAL,
      kind,
    );
  }
});

test('corpus membership is verified against recomputed source bytes, not against its own claim', () => {
  const [member] = corpus.members;
  assert.equal(
    assertEvaluationCorpus(corpus, {
      sourceDigests: { [member.sourcePath]: member.scenarioDigest },
    }),
    corpus,
  );
  assert.throws(
    () =>
      assertEvaluationCorpus(corpus, {
        sourceDigests: { [member.sourcePath]: digest('rewritten-scenario') },
      }),
    (error) => error.code === 'E_EVALUATION_DIGEST_MISMATCH',
  );
  assert.throws(
    () => assertEvaluationCorpus(corpus, { sourceDigests: {} }),
    (error) => error.code === 'E_EVALUATION_DIGEST_MISMATCH',
    'a member whose source was never read is not a valid member',
  );
});

test('the gate policy states the mandatory thresholds and cannot be relaxed', () => {
  assert.deepEqual(Object.keys(gatePolicy.gates).sort(), [...EVALUATION_METRICS].sort());
  assert.throws(
    () =>
      assertEvaluationGatePolicy({
        ...gatePolicy,
        gates: {
          ...gatePolicy.gates,
          'trigger-recall': { ...gatePolicy.gates['trigger-recall'], threshold: 9_000 },
        },
      }),
    (error) => error.code === 'E_EVALUATION_GATE_POLICY_INVALID',
  );
  assert.throws(
    () =>
      assertEvaluationGatePolicy({
        ...gatePolicy,
        gates: {
          ...gatePolicy.gates,
          'package-parity': { ...gatePolicy.gates['package-parity'], waivable: true },
        },
      }),
    (error) => error.code === 'E_EVALUATION_GATE_POLICY_INVALID',
  );
});

test('the shipped grader and host-profile registries are self-sealed', () => {
  const read = (name) =>
    JSON.parse(readFileSync(new URL(`../../registry/${name}.json`, import.meta.url), 'utf8'));
  const graders = read('evaluation-graders');
  const hosts = read('evaluation-host-profiles');
  assert.equal(assertEvaluationGraderRegistry(graders), graders);
  assert.equal(assertEvaluationHostProfileRegistry(hosts), hosts);
  for (const grader of graders.graders) {
    assert.equal(
      grader.graderType === 'live-model-judgement',
      false,
      'the built-in rows stay on the deterministic path',
    );
    assert.equal(grader.determinism.modelCall, false);
    assert.equal(grader.determinism.network, false);
    assert.equal(grader.determinism.credentialUse, false);
    assert.equal(grader.telemetry, false);
  }
});
