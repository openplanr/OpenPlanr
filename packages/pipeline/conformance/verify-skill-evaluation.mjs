#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PipelineError } from '../lib/pipeline/errors.mjs';
import { assertEvaluationWaiver } from '../lib/pipeline/evaluation-contract.mjs';
import {
  deriveEvaluationIdentity,
  evaluationEvidenceReuse,
  EVALUATION_EVIDENCE_INPUTS,
} from '../lib/pipeline/evaluation-identity.mjs';
import { assertEvaluationPublishSafe } from '../lib/pipeline/evaluation-redaction.mjs';
import { admitWaiver, evaluateGates } from '../lib/evaluation/gates.mjs';
import {
  EVALUATION_JOURNEY_KINDS,
  EVALUATION_JOURNEY_PROMPT_CLASS,
  assertCliEnvelope,
  assertLoopbackSurface,
  runBrowserJourney,
  runPackedInstallJourney,
} from '../lib/evaluation/journeys.mjs';
import { assertEvaluationBaseline } from '../lib/evaluation/metrics.mjs';
import { loadEvaluationInputs } from '../lib/evaluation/runner.mjs';

const VERSION = '1.4.0';
const NOW = '2026-08-25T09:16:00.000Z';
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const fixtureRoot = join(root, 'conformance', 'fixtures', 'skill-evaluation');
let checks = 0;

function pass(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

function fixture(name) {
  return JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8'));
}

function resolvePath(container, segments) {
  let target = container;
  for (const segment of segments)
    target = target?.[Array.isArray(target) ? Number(segment) : segment];
  return target;
}

/** Applies one named mutation and reseals it, so the refusal under test is semantic, not a digest mismatch. */
function mutateAndReseal(base, operations, kind) {
  const clone = structuredClone(base);
  for (const { path, value } of operations) {
    const segments = path.split('/').filter(Boolean);
    const key = segments.pop();
    resolvePath(clone, segments)[key] = structuredClone(value);
  }
  const derived = deriveEvaluationIdentity(clone, kind);
  return { ...clone, [derived.idField]: derived.id, [derived.digestField]: derived.digest };
}

/** The refusal code a validator raised, or null when it accepted. */
function refusalCode(run) {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof PipelineError ? error.code : `UNTYPED:${error.constructor.name}`;
  }
}

const contracts = fixture('contracts-valid.json');
const valid = fixture('journeys-valid.json');
const invalid = fixture('journeys-invalid.json');
const hostile = fixture('journeys-hostile.json');
const policy = contracts['evaluation-gate-policy'];
const referenceWaiver = contracts['evaluation-waiver'];
const owners = valid.ownerRoster;
const scenarioDigests = [referenceWaiver.scope.scenarioDigest];

// ── the corpora and host profiles this laboratory actually grades ────────────

const inputs = loadEvaluationInputs({ repoRoot: root });
pass(inputs.corpora.length > 0, 'the laboratory carries at least one contract-valid corpus');
pass(inputs.uncoveredSkills.length === 0, 'every skill in the frozen catalog carries a corpus');

const catalogHosts = new Map(
  inputs.catalog.skills.map((row) => [row.skillId, row.hosts.map((host) => host.host).sort()]),
);
for (const { corpus, scenarios } of inputs.corpora) {
  const expectedHosts = catalogHosts.get(corpus.skill.id);
  const covered = new Map();
  for (const member of scenarios) {
    const key = member.hostProfile.host;
    if (!covered.has(key)) covered.set(key, new Set());
    covered.get(key).add(member.journeyKind);
    pass(
      member.scenario.promptClass === EVALUATION_JOURNEY_PROMPT_CLASS[member.journeyKind],
      `${corpus.skill.id} ${key} ${member.journeyKind} is authored under its declared prompt class`,
    );
  }
  pass(
    JSON.stringify([...covered.keys()].sort()) === JSON.stringify(expectedHosts),
    `${corpus.skill.id} carries a corpus for every host the catalog declares`,
  );
  for (const [host, journeys] of covered) {
    pass(
      JSON.stringify([...journeys].sort()) === JSON.stringify([...EVALUATION_JOURNEY_KINDS].sort()),
      `${corpus.skill.id} on ${host} carries every declared journey`,
    );
  }
}

pass(
  inputs.gatePolicy.budgetDigest === inputs.budget.budgetDigest,
  'the gate policy binds the budget on disk',
);
pass(
  inputs.gatePolicy.baselineDigest === inputs.budget.baseline.baselineDigest,
  'the budget and the gate policy bind one frozen baseline',
);

// ── thresholds are read from the policy, never restated ─────────────────────

for (const boundary of valid.gateBoundaries) {
  const outcome = evaluateGates({
    policy,
    measured: boundary.measured,
    waivers: [],
    owners,
    now: NOW,
    scenarioDigests,
  });
  pass(outcome.result === boundary.expectedResult, `gate boundary: ${boundary.name}`);
  pass(
    JSON.stringify(outcome.blockingMetrics) === JSON.stringify(boundary.expectedBlocking),
    `gate boundary names exactly the unmet gates: ${boundary.name}`,
  );
}

const waived = evaluateGates({
  policy,
  measured: valid.waivedBoundary.measured,
  waivers: [assertEvaluationWaiver(referenceWaiver)],
  owners,
  now: NOW,
  scenarioDigests,
});
pass(waived.result === valid.waivedBoundary.expectedResult, valid.waivedBoundary.name);
pass(
  waived.appliedWaivers.length === 1,
  'an applied waiver is recorded so a reader can see what was accepted',
);
pass(
  waived.appliedWaivers[0].metric === valid.waivedBoundary.expectedWaivedMetric,
  'the applied waiver names the metric it covers',
);
pass(
  waived.appliedWaivers[0].ownerSignatureIdentity === owners[0],
  'the applied waiver names its accountable owner',
);
pass(
  typeof waived.appliedWaivers[0].expiresAt === 'string',
  'the applied waiver carries its expiry',
);

// ── hostile waivers ─────────────────────────────────────────────────────────

for (const mutation of hostile.waiverMutations) {
  const candidate = mutateAndReseal(referenceWaiver, mutation.operations, 'evaluation-waiver');
  const code =
    mutation.layer === 'contract'
      ? refusalCode(() => assertEvaluationWaiver(candidate))
      : refusalCode(() => {
          assertEvaluationWaiver(candidate);
          admitWaiver(candidate, {
            policy,
            metric: candidate.metric,
            now: NOW,
            owners,
            scenarioDigests,
          });
        });
  pass(code === mutation.expectedCode, `waiver refused: ${mutation.name}`);

  const stillBlocked = evaluateGates({
    policy,
    measured: valid.waivedBoundary.measured,
    waivers: [candidate],
    owners,
    now: NOW,
    scenarioDigests,
  });
  pass(
    stillBlocked.result === 'blocked',
    `an inadmissible waiver leaves the blocking result standing: ${mutation.name}`,
  );
}

// ── typed CLI answers ───────────────────────────────────────────────────────

for (const entry of valid.cliEnvelopes) {
  pass(
    refusalCode(() => assertCliEnvelope(entry.record)) === null,
    `cli envelope accepted: ${entry.name}`,
  );
}
for (const entry of invalid.cliEnvelopes) {
  pass(
    refusalCode(() => assertCliEnvelope(entry.record)) === entry.expectedCode,
    `cli envelope refused: ${entry.name}`,
  );
}

// ── loopback surfaces and baselines ─────────────────────────────────────────

const surface = assertLoopbackSurface(fixture('loopback-surface.json'));
pass(surface.routes.length > 1, 'the loopback surface declares more than one route');
for (const entry of invalid.loopbackSurfaces) {
  pass(
    refusalCode(() => assertLoopbackSurface(entry.record)) === entry.expectedCode,
    `loopback surface refused: ${entry.name}`,
  );
}
for (const entry of invalid.baselines) {
  pass(
    refusalCode(() => assertEvaluationBaseline(entry.record)) === entry.expectedCode,
    `baseline refused: ${entry.name}`,
  );
}

// ── fabricated browser results ──────────────────────────────────────────────

for (const entry of hostile.fabricatedAdapters) {
  const journey = await runBrowserJourney({
    surface,
    adapter: {
      adapterId: 'fabricated',
      trusted: entry.adapter.trusted,
      attests: entry.adapter.attests,
      probe: () => {
        throw new Error('a fabricated adapter is never probed');
      },
    },
    declaredViewports: surface.viewports,
  });
  pass(journey.completed === false, `a fabricated browser result never completes: ${entry.name}`);
  pass(
    journey.terminalReason === entry.expectedTerminalReason,
    `a fabricated browser result is typed: ${entry.name}`,
  );
  pass(
    journey.absence?.code === entry.expectedAbsenceCode,
    `a fabricated browser result records a typed absence: ${entry.name}`,
  );
  pass(
    journey.absence?.treatedAsPass === false,
    `a typed absence is never read as a pass: ${entry.name}`,
  );
}

// ── packed membership ───────────────────────────────────────────────────────

for (const entry of hostile.packedMembers) {
  const code = refusalCode(() =>
    runPackedInstallJourney({
      archive: { [entry.path]: 'refused\n' },
      declaredMembers: [entry.path],
      exercisePath: entry.path,
    }),
  );
  pass(code === entry.expectedCode, `packed member refused: ${entry.name}`);
}

const honestArchive = { 'skills/planr-spec/SKILL.md': 'installed bytes\n' };
const installed = runPackedInstallJourney({
  archive: honestArchive,
  declaredMembers: Object.keys(honestArchive),
  exercisePath: 'skills/planr-spec/SKILL.md',
});
pass(installed.completed === true, 'a packed journey exercises the installed bytes');
pass(
  installed.terminalReason === 'PACKED_BYTES_EXERCISED',
  'a packed journey names the bytes it exercised',
);

const wrongMembership = runPackedInstallJourney({
  archive: honestArchive,
  declaredMembers: [...Object.keys(honestArchive), 'skills/planr-spec/EXTRA.md'],
  exercisePath: 'skills/planr-spec/SKILL.md',
});
pass(
  wrongMembership.completed === false,
  'declared membership that the archive does not carry is a mismatch',
);

// ── redaction ───────────────────────────────────────────────────────────────

for (const entry of hostile.publishProjections) {
  pass(
    refusalCode(() => assertEvaluationPublishSafe(entry.value)) === entry.expectedCode,
    `publication refused: ${entry.name}`,
  );
}
pass(
  refusalCode(() => assertEvaluationPublishSafe(contracts['evaluation-aggregate-report'])) === null,
  'the reference aggregate report is publishable',
);

// ── stale evidence ──────────────────────────────────────────────────────────

const baseInputs = Object.fromEntries(
  EVALUATION_EVIDENCE_INPUTS.map((field, index) => [
    field,
    `sha256:${String(index).repeat(64).slice(0, 64)}`,
  ]),
);
const scenarioId = `esc_${'a'.repeat(64)}`;
for (const entry of hostile.staleEvidence) {
  const prior = [{ scenarioId, inputs: { ...baseInputs } }];
  const current = [
    { scenarioId, inputs: { ...baseInputs, [entry.changedInput]: `sha256:${'f'.repeat(64)}` } },
  ];
  const reuse = evaluationEvidenceReuse(prior, current);
  pass(reuse.reusable.length === 0, `stale evidence is refused: ${entry.name}`);
  pass(
    reuse.invalidated[0].reason === entry.expectedReason,
    `stale evidence names why it was refused: ${entry.name}`,
  );
  pass(
    JSON.stringify(reuse.invalidated[0].changedInputs) === JSON.stringify([entry.changedInput]),
    `stale evidence names exactly the input that changed: ${entry.name}`,
  );
}
const unchanged = evaluationEvidenceReuse(
  [{ scenarioId, inputs: { ...baseInputs } }],
  [{ scenarioId, inputs: { ...baseInputs } }],
);
pass(
  unchanged.reusable.length === 1,
  'evidence whose every bound input is byte-identical carries forward',
);

// ── no fixture carries credential material ──────────────────────────────────

const serialized = JSON.stringify({ valid, invalid, hostile, surface });
for (const forbidden of ['BEGIN RSA', 'BEGIN PRIVATE KEY', 'AKIA', 'ghp_', 'xoxb-']) {
  pass(
    !serialized.includes(forbidden),
    `evaluation fixtures carry no ${forbidden} credential material`,
  );
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    protocolVersion: VERSION,
    suite: 'skill-evaluation',
    corpora: inputs.corpora.length,
    scenarios: inputs.corpora.reduce((total, entry) => total + entry.scenarios.length, 0),
    hostProfiles: inputs.hostProfileRegistry.profiles.length,
    uncoveredSkills: inputs.uncoveredSkills.length,
    checks,
  })}\n`,
);
