import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { PipelineError } from '../pipeline/errors.mjs';
import {
  assertEvaluationBudget,
  assertEvaluationCorpus,
  assertEvaluationFixture,
  assertEvaluationGatePolicy,
  assertEvaluationGraderRegistry,
  assertEvaluationHostProfileRegistry,
  assertEvaluationObservation,
  assertEvaluationRunResult,
  assertEvaluationScenario,
  assertSkillCertificationReceipt,
} from '../pipeline/evaluation-contract.mjs';
import {
  assertUniqueJsonKeys,
  deriveEvaluationIdentity,
  evaluationContentDigest,
  evaluationEvidenceReuse,
  evaluationScenarioIdentityFromSource,
} from '../pipeline/evaluation-identity.mjs';
import { readProfessionalSkillsCatalog, buildProfessionalSkillsManifest } from '../pipeline/professional-skills.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';
import { evaluateGates, countFindings, EVALUATION_RESULT_READY } from './gates.mjs';
import {
  EVALUATION_JOURNEY_KINDS,
  createCliDriver,
  createDisposableCliRoot,
  createLoopbackBrowserAdapter,
  runBrowserJourney,
  runCliJourney,
  runHostJourney,
  runPackedInstallJourney,
  runRecoveryJourney,
} from './journeys.mjs';
import {
  aggregateMeasurements,
  assertBaselineDigest,
  assertEvaluationBaseline,
  basisPoints,
  deriveTriggerCounts,
  estimateTokens,
  regressionBasisPoints,
  triggerRates,
} from './metrics.mjs';
import { buildAggregateReport } from './report.mjs';
import { buildDeclaredArchive, compareGeneratedAssets, comparePackageExports, comparePackedMembership } from './parity.mjs';

export const EVALUATION_CORPUS_ROOT = 'evaluation/scenarios';
export const EVALUATION_HOST_PROFILE_ROOT = 'evaluation/host-profiles';
export const EVALUATION_BUDGET_PATH = 'evaluation/budgets/professional-skills.json';
export const EVALUATION_BASELINE_PATH = 'evaluation/baselines/professional-skills.json';
export const EVALUATION_GATE_POLICY_PATH = 'evaluation/gate-policy.json';
export const EVALUATION_LOOPBACK_SURFACE_PATH = 'conformance/fixtures/skill-evaluation/loopback-surface.json';

/** Options a declared CLI requirement needs to reach its typed answer. */
const CLI_OPTION_VALUES = Object.freeze({
  '--run-id': 'evaluation',
  '--request-file': '-',
  '--event-file': '-',
  '--result-file': '-',
  '--session-file': '-',
  '--generation': '1',
  '--runtime': 'claude-code',
  '--task': 'T-001',
});

const CLI_FEATURE = 'evaluation-subject';

function fail(code, message, fix = '', details = undefined) {
  throw new PipelineError(code, message, fix, details);
}

function readJson(path, label) {
  const text = readFileSync(path, 'utf8');
  assertUniqueJsonKeys(text, label);
  return JSON.parse(text);
}

function seal(record, kind) {
  const derived = deriveEvaluationIdentity(record, kind);
  return { ...record, [derived.idField]: derived.id, [derived.digestField]: derived.digest };
}

/** The prompt fixture is derived from the bytes on disk, so a changed prompt can never keep its identity. */
function resolveFixture(repoRoot, sourcePath) {
  const bytes = readFileSync(resolve(repoRoot, sourcePath), 'utf8');
  const record = assertEvaluationFixture(seal({
    kind: 'evaluation-fixture',
    schemaVersion: '1.0.0',
    protocolVersion: '1.4.0',
    fixtureId: 'efx_0000000000000000000000000000000000000000000000000000000000000000',
    fixtureDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    mediaKind: 'text',
    byteLength: Buffer.byteLength(bytes, 'utf8'),
    contentDigest: evaluationContentDigest(bytes),
    sourcePath,
    retention: 'local-only',
    containsCredentialMaterial: false,
  }, 'evaluation-fixture'));
  return Object.freeze({ record, bytes });
}

/**
 * Reads the contract-valid inputs a run is allowed to grade.
 * A partial catalog is reported, never inferred: a skill with no corpus on disk
 * is enumerated as uncovered rather than silently dropped from the totals.
 */
export function loadEvaluationInputs({ repoRoot }) {
  const catalog = readProfessionalSkillsCatalog({ projectRoot: repoRoot });
  const manifest = buildProfessionalSkillsManifest(catalog);
  const hostProfileRegistry = assertEvaluationHostProfileRegistry(readJson(join(repoRoot, 'registry/evaluation-host-profiles.json'), 'host profile registry'));
  const graderRegistry = assertEvaluationGraderRegistry(readJson(join(repoRoot, 'registry/evaluation-graders.json'), 'grader registry'));
  const baseline = assertEvaluationBaseline(readJson(join(repoRoot, EVALUATION_BASELINE_PATH), 'baseline'));
  const budget = assertEvaluationBudget(readJson(join(repoRoot, EVALUATION_BUDGET_PATH), 'budget'));
  const gatePolicy = assertEvaluationGatePolicy(readJson(join(repoRoot, EVALUATION_GATE_POLICY_PATH), 'gate policy'));
  assertBaselineDigest(baseline, budget.baseline.baselineDigest, 'budget baseline');
  assertBaselineDigest(baseline, gatePolicy.baselineDigest, 'gate policy baseline');
  if (gatePolicy.budgetDigest !== budget.budgetDigest) {
    fail('E_EVALUATION_DIGEST_MISMATCH', 'The gate policy binds a different budget than the one on disk.', 'Reseal the gate policy against the current budget.', { expected: gatePolicy.budgetDigest, actual: budget.budgetDigest });
  }

  const hostProfilesById = new Map(hostProfileRegistry.profiles.map((profile) => [profile.hostProfileId, profile]));
  for (const profile of hostProfileRegistry.profiles) {
    const sourcePath = join(repoRoot, EVALUATION_HOST_PROFILE_ROOT, `${profile.host}.json`);
    if (!existsSync(sourcePath)) {
      fail('E_EVALUATION_HOST_PROFILE_ABSENT', `Host profile ${profile.host} has no source document.`, 'Author the host profile source document the registry row was sealed from.', { host: profile.host });
    }
    const source = readJson(sourcePath, `host profile ${profile.host}`);
    if (sha256Jcs(source) !== sha256Jcs(profile)) {
      fail('E_EVALUATION_DIGEST_MISMATCH', `Host profile ${profile.host} no longer matches its registry row.`, 'Reseal the registry from the source document; a drifted host profile invalidates its evidence.', { host: profile.host });
    }
  }

  const corpusRoot = join(repoRoot, EVALUATION_CORPUS_ROOT);
  const corpusDirectories = existsSync(corpusRoot)
    ? readdirSync(corpusRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    : [];
  const corpora = [];
  for (const skillId of corpusDirectories) {
    const corpusPath = join(corpusRoot, skillId, 'corpus.json');
    if (!existsSync(corpusPath)) continue;
    const raw = readJson(corpusPath, `corpus ${skillId}`);
    const sourceDigests = {};
    const scenarios = [];
    for (const member of raw.members) {
      const identity = evaluationScenarioIdentityFromSource(readFileSync(resolve(repoRoot, member.sourcePath), 'utf8'), member.sourcePath);
      sourceDigests[member.sourcePath] = identity.scenarioDigest;
      const scenario = assertEvaluationScenario(identity.record, member.sourcePath);
      const journeyKind = basename(member.sourcePath, '.json');
      if (!EVALUATION_JOURNEY_KINDS.includes(journeyKind)) {
        fail('E_EVALUATION_JOURNEY_INVALID', `Scenario ${member.sourcePath} does not name a declared journey.`, `Name the source document after one of: ${EVALUATION_JOURNEY_KINDS.join(', ')}.`, { journeyKind });
      }
      const hostName = basename(dirname(member.sourcePath));
      const hostProfile = hostProfilesById.get(scenario.hostProfileRef.hostProfileId);
      if (hostProfile === undefined || hostProfile.host !== hostName) {
        fail('E_EVALUATION_HOST_PROFILE_ABSENT', `Scenario ${member.sourcePath} binds a host profile the registry does not carry under ${hostName}.`, 'Bind the registered host profile whose bytes the run actually uses.');
      }
      if (scenario.budgetRef.budgetDigest !== budget.budgetDigest) {
        fail('E_EVALUATION_DIGEST_MISMATCH', `Scenario ${member.sourcePath} binds a stale budget.`, 'Reseal the corpus against the current budget; evidence never carries across a changed input digest.');
      }
      scenarios.push(Object.freeze({ scenario, journeyKind, hostProfile, sourcePath: member.sourcePath }));
    }
    const corpus = assertEvaluationCorpus(raw, { sourceDigests, label: `corpus ${skillId}` });
    const catalogRow = catalog.skills.find((row) => row.skillId === corpus.skill.id);
    if (catalogRow === undefined) {
      fail('E_EVALUATION_CORPUS_FOREIGN', `Corpus ${skillId} grades a skill the frozen catalog does not carry.`, 'The laboratory grades the frozen catalog; it never introduces a skill of its own.', { skillId: corpus.skill.id });
    }
    corpora.push(Object.freeze({ corpus, scenarios: Object.freeze(scenarios), catalogRow }));
  }

  const covered = new Set(corpora.map((entry) => entry.corpus.skill.id));
  const uncoveredSkills = catalog.skills.map((row) => row.skillId).filter((skillId) => !covered.has(skillId)).sort();

  return Object.freeze({
    catalog,
    manifest,
    hostProfileRegistry,
    graderRegistry,
    baseline,
    budget,
    gatePolicy,
    corpora: Object.freeze(corpora),
    uncoveredSkills: Object.freeze(uncoveredSkills),
    packageJson: readJson(join(repoRoot, 'package.json'), 'package manifest'),
    packageDigest: evaluationContentDigest(readFileSync(join(repoRoot, 'package.json'))),
    sourceDigest: sha256Jcs(manifest),
  });
}

function graderByName(registry, name) {
  const grader = registry.graders.find((entry) => entry.graderName === name);
  if (grader === undefined) fail('E_EVALUATION_GRADER_MISSING', `Grader ${name} is not registered.`, 'Register the grader before a run binds it; a missing grader is a typed absence, never a pass.', { graderName: name });
  return grader;
}

function cliArgvFor(catalogRow) {
  const requirement = catalogRow.cliRequirements[0];
  if (requirement === undefined) return null;
  // The catalog states the public grammar; the pipeline executable owns the same verbs without the leading namespace.
  const argv = requirement.argv
    .filter((token, index) => !(index === 0 && token === 'pipeline'))
    .map((token) => (token.startsWith('<') ? CLI_FEATURE : token));
  for (const option of requirement.requiredOptions) {
    if (option === '--json') continue;
    argv.push(option, CLI_OPTION_VALUES[option] ?? 'evaluation');
  }
  return Object.freeze(argv);
}

function scenarioEvidenceInputs(entry, { budget, packageDigest, sourceDigest, graderRegistrationDigest, fixtureSetDigest }) {
  return Object.freeze({
    scenarioId: entry.scenario.scenarioId,
    inputs: Object.freeze({
      budgetDigest: budget.budgetDigest,
      fixtureSetDigest,
      graderRegistrationDigest,
      hostProfileDigest: entry.hostProfile.profileDigest,
      packageDigest,
      scenarioDigest: entry.scenario.scenarioDigest,
      sourceDigest,
    }),
  });
}

/**
 * One deterministic pass over the contract-valid corpora.
 * Nothing here edits a graded skill, assigns a version, or performs a release
 * effect; the only outputs are measurement, findings, and a verdict.
 */
export async function runEvaluation({
  repoRoot,
  now,
  clock = () => now,
  waivers = [],
  owners = [],
  browserAdapter = createLoopbackBrowserAdapter(),
  priorEvidence = null,
  inputs = loadEvaluationInputs({ repoRoot }),
} = {}) {
  const startedAt = now;
  const { catalog, manifest, hostProfileRegistry, graderRegistry, baseline, budget, gatePolicy, corpora, packageJson, packageDigest, sourceDigest } = inputs;

  const graders = Object.freeze({
    trigger: graderByName(graderRegistry, 'trigger-decision'),
    journey: graderByName(graderRegistry, 'journey-completion'),
    permission: graderByName(graderRegistry, 'permission-refusal'),
    schema: graderByName(graderRegistry, 'declared-output-schema'),
    budget: graderByName(graderRegistry, 'budget-conformance'),
    parity: graderByName(graderRegistry, 'package-parity'),
  });
  for (const grader of Object.values(graders)) {
    if (grader.graderType === 'live-model-judgement') {
      fail('E_EVALUATION_GRADER_INVALID', `Grader ${grader.graderName} is a live-model judgement and cannot be part of the default run.`, 'A live-model grader is separately consented and never required to validate a pure contract.');
    }
  }

  const assets = compareGeneratedAssets({ repoRoot });
  const exports = comparePackageExports({ repoRoot, packageJson });
  const packed = comparePackedMembership({ repoRoot, packageJson });
  const archive = buildDeclaredArchive({ repoRoot });
  const surface = readJson(join(repoRoot, EVALUATION_LOOPBACK_SURFACE_PATH), 'loopback surface');

  const cliRoot = createDisposableCliRoot();
  const cliDriver = createCliDriver({ executable: join(repoRoot, 'bin/planr-pipeline.mjs'), cwd: cliRoot.root });

  const runSeed = sha256Jcs({ corpora: corpora.map((entry) => entry.corpus.corpusDigest), packageDigest, sourceDigest, gatePolicyDigest: gatePolicy.gatePolicyDigest, startedAt });
  const runId = `eru_${runSeed.slice(7, 39)}`;

  const observations = [];
  const scenarioRows = [];
  const measurementSamples = [];
  const triggerDecisions = [];
  const findings = [];
  const evidenceInputs = [];
  let journeysAttempted = 0;
  let journeysCompleted = 0;
  let outputsValidated = 0;
  let outputsSchemaValid = 0;

  // A receipt asserts readiness for its own skill, so each skill carries its own tallies.
  const skillStats = new Map();
  const statsFor = (skillId) => {
    if (!skillStats.has(skillId)) {
      skillStats.set(skillId, { journeysAttempted: 0, journeysCompleted: 0, outputsValidated: 0, outputsSchemaValid: 0, triggerDecisions: [], findings: [] });
    }
    return skillStats.get(skillId);
  };

  const recordObservation = (entry, grader, outcome, terminalReason, graderOutput, absence = null) => {
    const observation = assertEvaluationObservation(seal({
      kind: 'evaluation-observation',
      schemaVersion: '1.0.0',
      protocolVersion: '1.4.0',
      observationId: 'eob_00000000000000000000000000000000',
      observationDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      runId,
      scenario: {
        scenarioId: entry.scenario.scenarioId,
        scenarioDigest: entry.scenario.scenarioDigest,
        corpusDigest: entry.corpusDigest,
        promptClass: entry.scenario.promptClass,
      },
      grader: {
        graderId: grader.graderId,
        graderVersion: grader.graderVersion,
        graderType: grader.graderType,
        registrationDigest: grader.registrationDigest,
        registryDigest: graderRegistry.registryDigest,
      },
      hostProfile: {
        hostProfileId: entry.hostProfile.hostProfileId,
        profileDigest: entry.hostProfile.profileDigest,
        registryDigest: hostProfileRegistry.registryDigest,
      },
      fixtures: [{ fixtureId: entry.fixture.record.fixtureId, contentDigest: entry.fixture.record.contentDigest }],
      packageDigest,
      budgetDigest: budget.budgetDigest,
      outcome,
      terminalReason,
      graderOutputDigest: outcome === 'absent' ? null : sha256Jcs(graderOutput),
      absence,
      observedAt: clock(),
    }, 'evaluation-observation'), {
      subject: { registration: grader, skill: { skillId: entry.skillId, skillSourceDigest: entry.skillSourceDigest } },
    });
    observations.push(observation);
    return observation;
  };

  try {
    for (const { corpus, scenarios, catalogRow } of corpora) {
      const cliArgv = cliArgvFor(catalogRow);
      const drivesBrowser = catalogRow.contracts.outputs.some((output) => output.id.startsWith('browser-qa'));
      for (const member of scenarios) {
        const fixtureRef = member.scenario.fixtureRefs.find((ref) => ref.role === 'prompt');
        const promptPath = join(dirname(member.sourcePath), 'prompts', `${member.journeyKind}.txt`);
        const fixture = resolveFixture(repoRoot, promptPath);
        if (fixture.record.fixtureId !== fixtureRef.fixtureId || fixture.record.contentDigest !== fixtureRef.contentDigest) {
          fail('E_EVALUATION_DIGEST_MISMATCH', `Prompt bytes for ${member.sourcePath} no longer match the fixture the scenario binds.`, 'Reseal the scenario against the current prompt bytes.', { sourcePath: promptPath });
        }
        const entry = {
          ...member,
          fixture,
          corpusDigest: corpus.corpusDigest,
          skillId: corpus.skill.id,
          skillSourceDigest: catalogRow.sourceDigest,
        };

        const journeys = [];
        journeys.push(runHostJourney({
          scenario: member.scenario,
          promptText: fixture.bytes,
          triggerPolicy: catalogRow.triggerPolicy,
          hostProfile: member.hostProfile,
        }));
        if (cliArgv !== null) journeys.push(runCliJourney({ driver: cliDriver, argv: cliArgv }));
        if (member.journeyKind === 'recovery') journeys.push(runRecoveryJourney({ scenario: member.scenario, clock }));
        if (member.journeyKind === 'packed-install') {
          journeys.push(runPackedInstallJourney({
            archive,
            declaredMembers: Object.keys(archive),
            exercisePath: catalogRow.hosts.find((host) => host.host === member.hostProfile.host).path,
          }));
        }
        if (drivesBrowser && (member.journeyKind === 'positive' || member.journeyKind === 'recovery')) {
          journeys.push(await runBrowserJourney({ surface, adapter: browserAdapter, declaredViewports: surface.viewports }));
        }

        const host = journeys[0];
        const absent = journeys.find((journey) => journey.absence !== null) ?? null;
        const stats = statsFor(corpus.skill.id);
        const record = (finding) => {
          findings.push(finding);
          stats.findings.push(finding);
        };
        journeysAttempted += journeys.length;
        journeysCompleted += journeys.filter((journey) => journey.completed).length;
        stats.journeysAttempted += journeys.length;
        stats.journeysCompleted += journeys.filter((journey) => journey.completed).length;

        const latencyMs = journeys.reduce((total, journey) => total + (journey.latencyMs ?? 0), 0);
        const permissionPrompts = journeys.reduce((total, journey) => total + (journey.permissionPrompts ?? 0), 0);
        const retries = journeys.reduce((total, journey) => total + journey.retries, 0);
        const inputTokens = estimateTokens(fixture.bytes);
        const outputTokens = journeys.reduce((total, journey) => total + (journey.outputTokens ?? 0), 0);
        measurementSamples.push({ latencyMs, inputTokens, outputTokens, permissionPrompts, retries });

        const triggerMatched = host.observedTrigger === member.scenario.expectedTrigger.outcome;
        if (host.observedTrigger !== null) {
          const decision = { expected: member.scenario.expectedTrigger.outcome, observed: host.observedTrigger };
          triggerDecisions.push(decision);
          stats.triggerDecisions.push(decision);
        }

        let schemaValidHere = true;
        for (const journey of journeys) {
          for (const output of journey.outputs) {
            outputsValidated += 1;
            stats.outputsValidated += 1;
            const valid = output.record !== null && typeof output.record === 'object' && !Array.isArray(output.record);
            if (valid) {
              outputsSchemaValid += 1;
              stats.outputsSchemaValid += 1;
            } else {
              schemaValidHere = false;
            }
          }
        }

        const fixtureSetDigest = sha256Jcs([fixture.record.contentDigest]);
        let status;
        let absenceReason = null;
        if (!member.hostProfile.skillHostSupport) {
          status = 'blocked';
        } else if (absent !== null) {
          status = 'absent';
          absenceReason = absent.absence.code;
          record({
            kind: absent.absence.recoveryDisposition === 'escalate' ? 'blocking-absence' : 'typed-absence',
            scenarioDigest: member.scenario.scenarioDigest,
          });
        } else if (!triggerMatched) {
          status = 'failed';
          record({
            kind: member.scenario.promptClass === 'permission-denied' ? 'authorization-escape' : 'trigger-mismatch',
            scenarioDigest: member.scenario.scenarioDigest,
          });
        } else if (journeys.some((journey) => !journey.completed)) {
          status = 'failed';
          record({ kind: 'journey-incomplete', scenarioDigest: member.scenario.scenarioDigest });
        } else if (!schemaValidHere) {
          status = 'failed';
          record({ kind: 'schema-invalid-output', scenarioDigest: member.scenario.scenarioDigest });
        } else {
          status = 'passed';
        }

        recordObservation(entry, graders.trigger, absent === null && triggerMatched ? 'pass' : (absent === null ? 'fail' : 'absent'),
          absent === null ? (triggerMatched ? 'TRIGGER_MATCHED_EXPECTED' : 'TRIGGER_DIVERGED_FROM_EXPECTED') : 'TRIGGER_NOT_OBSERVED',
          { observed: host.observedTrigger, expected: member.scenario.expectedTrigger.outcome },
          absent === null ? null : absent.absence);
        recordObservation(entry, graders.journey, absent === null ? (journeys.every((journey) => journey.completed) ? 'pass' : 'fail') : 'absent',
          absent === null ? (journeys.every((journey) => journey.completed) ? 'JOURNEY_COMPLETED' : 'JOURNEY_INCOMPLETE') : 'JOURNEY_NOT_OBSERVED',
          { attempted: journeys.length, completed: journeys.filter((journey) => journey.completed).length },
          absent === null ? null : absent.absence);
        if (member.scenario.promptClass === 'permission-denied') {
          recordObservation(entry, graders.permission, host.observedTrigger === 'refuse' ? 'pass' : 'fail',
            host.observedTrigger === 'refuse' ? 'PERMISSION_REFUSED' : 'PERMISSION_ESCAPED', { observed: host.observedTrigger });
        }
        recordObservation(entry, graders.schema, schemaValidHere ? 'pass' : 'fail',
          schemaValidHere ? 'DECLARED_OUTPUTS_VALID' : 'DECLARED_OUTPUT_INVALID', { validated: outputsValidated });

        if (status === 'failed') {
          const waived = waivers.find((waiver) => waiver.scope.kind === 'scenario' && waiver.scope.scenarioDigest === member.scenario.scenarioDigest);
          if (waived !== undefined) status = 'waived';
        }

        scenarioRows.push({
          scenarioDigest: member.scenario.scenarioDigest,
          skillId: corpus.skill.id,
          hostProfileDigest: member.hostProfile.profileDigest,
          graderRegistrationDigest: graders.trigger.registrationDigest,
          fixtureSetDigest,
          promptClass: member.scenario.promptClass,
          status,
          absenceReason,
          waiverDigest: status === 'waived'
            ? waivers.find((waiver) => waiver.scope.kind === 'scenario' && waiver.scope.scenarioDigest === member.scenario.scenarioDigest).waiverDigest
            : null,
          observations: member.scenario.promptClass === 'permission-denied' ? 4 : 3,
          latencyMs,
        });
        evidenceInputs.push(scenarioEvidenceInputs(entry, {
          budget,
          packageDigest,
          sourceDigest,
          graderRegistrationDigest: graders.trigger.registrationDigest,
          fixtureSetDigest,
        }));
      }
    }
  } finally {
    cliRoot.dispose();
  }

  // Parity and budget are properties of the package, so every skill in it carries the finding.
  const recordPackageWide = (finding) => {
    findings.push(finding);
    for (const stats of skillStats.values()) stats.findings.push(finding);
  };

  const measurements = aggregateMeasurements(measurementSamples);
  if (measurements.permissionPrompts > budget.ceilings.permissionPromptCeiling || measurements.retries > budget.ceilings.retryCeiling
    || measurements.totalTokens > budget.ceilings.totalTokensCeiling || measurements.costEstimateMicros > budget.ceilings.costEstimateMicrosCeiling
    || measurements.latencyMsP95 > budget.ceilings.latencyMsP95Ceiling) {
    recordPackageWide({ kind: 'budget-exceeded', scenarioDigest: null });
  }
  if (assets.mismatches.length > 0 || exports.mismatches.length > 0 || packed.mismatches.length > 0) {
    recordPackageWide({ kind: 'parity-mismatch', scenarioDigest: null });
  }
  const findingCounts = countFindings(findings);

  const counts = deriveTriggerCounts(triggerDecisions);
  const statusOf = (status) => scenarioRows.filter((row) => row.status === status).length;
  const counters = {
    scenariosTotal: scenarioRows.length,
    scenariosPassed: statusOf('passed'),
    scenariosFailed: statusOf('failed'),
    scenariosBlocked: statusOf('blocked'),
    scenariosAbsent: statusOf('absent'),
    scenariosWaived: statusOf('waived'),
    triggerTruePositives: counts.truePositives,
    triggerFalsePositives: counts.falsePositives,
    triggerFalseNegatives: counts.falseNegatives,
    journeysAttempted,
    journeysCompleted,
    outputsValidated,
    outputsSchemaValid,
    assetsDeclared: assets.declared,
    assetsPresent: assets.present,
    exportsDeclared: exports.declared,
    exportsPresent: exports.present,
    packageMembersDeclared: packed.declared,
    packageMembersPresent: packed.present,
    permissionPrompts: measurements.permissionPrompts,
    retries: measurements.retries,
    findingsP0: findingCounts.p0,
    findingsP1: findingCounts.p1,
    findingsP2: findingCounts.p2,
    findingsP3: findingCounts.p3,
  };
  const rates = {
    ...triggerRates(counts),
    journeyCompletion: basisPoints(journeysCompleted, journeysAttempted),
    schemaValidity: basisPoints(outputsSchemaValid, outputsValidated),
    assetParity: basisPoints(assets.present, assets.declared),
    exportParity: basisPoints(exports.present, exports.declared),
    packageParity: basisPoints(packed.present, packed.declared),
  };
  const budgetBlock = {
    baselineDigest: gatePolicy.baselineDigest,
    latencyMsBaseline: baseline.latencyMsP95,
    latencyMsObserved: measurements.latencyMsP95,
    latencyRegression: regressionBasisPoints(measurements.latencyMsP95, baseline.latencyMsP95),
    costEstimateMicrosBaseline: baseline.costEstimateMicros,
    costEstimateMicrosObserved: measurements.costEstimateMicros,
    costRegression: regressionBasisPoints(measurements.costEstimateMicros, baseline.costEstimateMicros),
    permissionPromptCeiling: budget.ceilings.permissionPromptCeiling,
    retryCeiling: budget.ceilings.retryCeiling,
  };
  const absenceCodes = { graderMissing: 0, graderErrored: 0, graderUnavailable: 0, hostUnavailable: 0, fixtureUnavailable: 0, budgetExceeded: 0, notRun: 0 };
  const absenceField = { 'grader-missing': 'graderMissing', 'grader-errored': 'graderErrored', 'grader-unavailable': 'graderUnavailable', 'host-unavailable': 'hostUnavailable', 'fixture-unavailable': 'fixtureUnavailable', 'budget-exceeded': 'budgetExceeded', 'not-run': 'notRun' };
  for (const row of scenarioRows.filter((entry) => entry.status === 'absent')) absenceCodes[absenceField[row.absenceReason]] += 1;

  const skills = corpora.map(({ corpus, catalogRow }) => {
    const rows = scenarioRows.filter((row) => row.skillId === corpus.skill.id);
    return {
      skillId: corpus.skill.id,
      skillVersion: catalogRow.sourceVersion,
      scenariosTotal: rows.length,
      scenariosPassed: rows.filter((row) => row.status === 'passed').length,
      scenariosFailed: rows.filter((row) => row.status === 'failed').length,
      scenariosBlocked: rows.filter((row) => row.status === 'blocked').length,
      scenariosAbsent: rows.filter((row) => row.status === 'absent').length,
      scenariosWaived: rows.filter((row) => row.status === 'waived').length,
    };
  }).sort((left, right) => left.skillId.localeCompare(right.skillId));

  const completedAt = clock();
  const runResult = assertEvaluationRunResult(seal({
    kind: 'evaluation-run-result',
    schemaVersion: '1.0.0',
    protocolVersion: '1.4.0',
    runResultId: 'ers_00000000000000000000000000000000',
    runResultDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    runId,
    visibility: 'local',
    publishable: false,
    evidenceTransport: 'digest-only',
    corpusDigest: sha256Jcs(corpora.map(({ corpus }) => corpus.corpusDigest)),
    graderRegistryDigest: graderRegistry.registryDigest,
    hostProfileRegistryDigest: hostProfileRegistry.registryDigest,
    hostProfiles: hostProfileRegistry.profiles.map((profile) => ({ hostProfileId: profile.hostProfileId, profileDigest: profile.profileDigest })),
    budgetDigest: budget.budgetDigest,
    gatePolicyDigest: gatePolicy.gatePolicyDigest,
    packageDigest,
    sourceDigest,
    observations: observations.map((observation) => ({
      observationId: observation.observationId,
      observationDigest: observation.observationDigest,
      scenarioDigest: observation.scenario.scenarioDigest,
      outcome: observation.outcome,
    })),
    measurements,
    findingCounts,
    rawEvidence: [],
    terminalReason: 'EVALUATION_RUN_COMPLETE',
    startedAt,
    completedAt,
  }, 'evaluation-run-result'));

  const aggregateReport = buildAggregateReport({
    generatedAt: completedAt,
    inputs: {
      corpusDigest: runResult.corpusDigest,
      graderRegistryDigest: graderRegistry.registryDigest,
      hostProfileRegistryDigest: hostProfileRegistry.registryDigest,
      gatePolicyDigest: gatePolicy.gatePolicyDigest,
      budgetBaselineDigest: gatePolicy.baselineDigest,
      hostProfileDigests: hostProfileRegistry.profiles.map((profile) => profile.profileDigest),
      runResultDigests: [runResult.runResultDigest],
    },
    counters,
    rates,
    budget: budgetBlock,
    absences: absenceCodes,
    skills,
    scenarios: scenarioRows,
  });

  const scenarioDigests = scenarioRows.map((row) => row.scenarioDigest);
  const measured = { rates, findingCounts, budget: budgetBlock };
  const gates = evaluateGates({ policy: gatePolicy, measured, waivers, owners, now: completedAt, scenarioDigests });

  // A certified result asserts compatibility for its own skill, so each receipt is
  // gated on that skill's own trigger, journey, and schema evidence.
  const skillGates = (skillId) => {
    const stats = statsFor(skillId);
    const skillCounts = deriveTriggerCounts(stats.triggerDecisions);
    return evaluateGates({
      policy: gatePolicy,
      measured: {
        rates: {
          ...triggerRates(skillCounts),
          journeyCompletion: basisPoints(stats.journeysCompleted, stats.journeysAttempted),
          schemaValidity: basisPoints(stats.outputsSchemaValid, stats.outputsValidated),
          assetParity: rates.assetParity,
          exportParity: rates.exportParity,
          packageParity: rates.packageParity,
        },
        findingCounts: countFindings(stats.findings),
        budget: budgetBlock,
      },
      waivers,
      owners,
      now: completedAt,
      scenarioDigests: scenarioRows.filter((row) => row.skillId === skillId).map((row) => row.scenarioDigest),
    });
  };

  const receipts = corpora.map(({ corpus, scenarios, catalogRow }) => {
    const evaluation = skillGates(corpus.skill.id);
    const covered = [...new Set(scenarios.map((member) => member.hostProfile.hostProfileId))]
      .map((hostProfileId) => hostProfileRegistry.profiles.find((profile) => profile.hostProfileId === hostProfileId))
      .sort((left, right) => left.host.localeCompare(right.host));
    return assertSkillCertificationReceipt(seal({
      kind: 'skill-certification-receipt',
      schemaVersion: '1.0.0',
      protocolVersion: '1.4.0',
      receiptId: 'scr_00000000000000000000000000000000',
      receiptDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      recordType: 'readiness',
      issuedAt: completedAt,
      subject: { skillId: corpus.skill.id, skillVersion: catalogRow.sourceVersion, skillSourceDigest: catalogRow.sourceDigest },
      inputs: {
        corpusDigest: corpus.corpusDigest,
        graderRegistryDigest: graderRegistry.registryDigest,
        hostProfiles: covered.map((profile) => ({ hostProfileId: profile.host, hostProfileDigest: profile.profileDigest })),
        budgetBaselineDigest: gatePolicy.baselineDigest,
        gatePolicyDigest: gatePolicy.gatePolicyDigest,
        aggregateReportDigest: aggregateReport.reportDigest,
      },
      gateEvaluation: evaluation.gateEvaluation.map((entry) => ({ ...entry })),
      appliedWaivers: evaluation.appliedWaivers.map((entry) => ({ ...entry })),
      result: evaluation.result,
      blockingMetrics: [...evaluation.blockingMetrics],
    }, 'skill-certification-receipt'), { aggregateReport, now: completedAt });
  });

  const reuse = priorEvidence === null ? null : evaluationEvidenceReuse(priorEvidence, evidenceInputs);

  return Object.freeze({
    runId,
    runResult,
    aggregateReport,
    receipts: Object.freeze(receipts),
    gates,
    findings: Object.freeze(findings),
    evidenceInputs: Object.freeze(evidenceInputs),
    reuse,
    uncoveredSkills: inputs.uncoveredSkills,
    catalogSkills: Object.freeze(catalog.skills.map((row) => row.skillId)),
    manifestDigest: manifest.bundleDigest,
    verdict: gates.result === EVALUATION_RESULT_READY ? 'PASS' : 'BLOCKED',
  });
}
