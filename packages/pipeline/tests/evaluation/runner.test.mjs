// @planr-test-group serial
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertEvaluationAggregateReport,
  assertEvaluationRunResult,
  assertSkillCertificationReceipt,
} from '../../lib/pipeline/evaluation-contract.mjs';
import { assertEvaluationAggregatePublishable } from '../../lib/pipeline/evaluation-redaction.mjs';
import { createLoopbackBrowserAdapter } from '../../lib/evaluation/journeys.mjs';
import {
  EVALUATION_CI_ARTIFACTS,
  renderJUnit,
  writeCiReports,
  writeLocalRun,
} from '../../lib/evaluation/report.mjs';
import { loadEvaluationInputs, runEvaluation } from '../../lib/evaluation/runner.mjs';

const root = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const sourceRoot = resolve(root, '../..');
const NOW = '2026-08-25T09:16:00.000Z';

/** Paths this task may never write. A full run leaves each of them byte-identical. */
const PRESERVED = Object.freeze([
  '../../skills',
  'registry/professional-skills.json',
  'registry/frozen-commands.json',
  'registry/ship-review-specialists.json',
  'registry/evaluation-graders.json',
  'registry/evaluation-host-profiles.json',
  'evaluation',
  'conformance/fixtures/skill-evaluation',
]);

function treeDigest(target) {
  const absolute = join(root, target);
  const hash = createHash('sha256');
  const walk = (path) => {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) {
        if (entry === '.runs') continue;
        walk(join(path, entry));
      }
      return;
    }
    hash.update(relative(root, path)).update(readFileSync(path));
  };
  walk(absolute);
  return hash.digest('hex');
}

async function fullRun(options = {}) {
  return runEvaluation({ repoRoot: root, sourceRoot, now: NOW, clock: () => NOW, ...options });
}

test('a current-source run requires an explicit source root rather than discovering a checkout', async () => {
  await assert.rejects(() => runEvaluation({ repoRoot: root, now: NOW }), {
    code: 'E_PROFESSIONAL_SKILL_SOURCE_REQUIRED',
  });
});

test('a current-source run refuses legacy inputs and mismatched source evidence', async () => {
  const legacy = loadEvaluationInputs({ repoRoot: root });
  const active = loadEvaluationInputs({ repoRoot: root, sourceRoot });
  for (const inputs of [
    legacy,
    { ...active, sourceDigest: legacy.sourceDigest },
    { ...active, manifest: legacy.manifest },
    { ...active, corpora: legacy.corpora },
  ]) {
    await assert.rejects(() => fullRun({ inputs }), { code: 'E_EVALUATION_DIGEST_MISMATCH' });
  }
});

test('a changed source rejects preloaded inputs before grading', async () => {
  const selectedSource = mkdtempSync(join(tmpdir(), 'planr-evaluation-source-'));
  const active = loadEvaluationInputs({ repoRoot: root, sourceRoot });
  try {
    for (const { skillId } of active.catalog.skills) {
      const directory = join(selectedSource, 'skills', skillId);
      mkdirSync(directory, { recursive: true });
      cpSync(join(sourceRoot, 'skills', skillId, 'SKILL.md'), join(directory, 'SKILL.md'));
    }
    const inputs = loadEvaluationInputs({ repoRoot: root, sourceRoot: selectedSource });
    const changedPath = join(
      selectedSource,
      'skills',
      active.catalog.skills[0].skillId,
      'SKILL.md',
    );
    writeFileSync(
      changedPath,
      `${readFileSync(changedPath, 'utf8')}\nA changed source must be graded afresh.\n`,
    );
    await assert.rejects(() => fullRun({ sourceRoot: selectedSource, inputs }), {
      code: 'E_EVALUATION_DIGEST_MISMATCH',
    });
  } finally {
    rmSync(selectedSource, { recursive: true, force: true });
  }
});

test('one full run certifies the frozen catalog against every registered host', async () => {
  const outcome = await fullRun();
  assert.equal(outcome.verdict, 'PASS');
  assert.deepEqual([...outcome.gates.blockingMetrics], []);
  assert.deepEqual([...outcome.uncoveredSkills], []);
  assert.equal(outcome.receipts.length, outcome.catalogSkills.length);
  for (const receipt of outcome.receipts) {
    assert.equal(assertSkillCertificationReceipt(receipt).result, 'release-ready');
    assert.equal(receipt.recordType, 'readiness');
    assert.equal(receipt.inputs.hostProfiles.length, 3);
  }
  assert.equal(assertEvaluationRunResult(outcome.runResult).visibility, 'local');
  assert.equal(outcome.runResult.publishable, false);
  assert.equal(
    assertEvaluationAggregateReport(outcome.aggregateReport).counters.scenariosFailed,
    0,
  );
});

test('a run is deterministic in everything but its wall clock', async () => {
  const first = await fullRun();
  const second = await fullRun();
  assert.equal(first.runId, second.runId);
  assert.deepEqual(first.aggregateReport.counters, second.aggregateReport.counters);
  assert.deepEqual(first.aggregateReport.rates, second.aggregateReport.rates);
  assert.equal(
    first.aggregateReport.budget.costEstimateMicrosObserved,
    second.aggregateReport.budget.costEstimateMicrosObserved,
  );
  assert.deepEqual(
    first.aggregateReport.scenarios.map((entry) => entry.scenarioDigest),
    second.aggregateReport.scenarios.map((entry) => entry.scenarioDigest),
  );
});

test('a run performs no effect and leaves every preserved path byte-identical', async () => {
  const before = PRESERVED.map((target) => treeDigest(target));
  const realFetch = globalThis.fetch;
  const reached = [];
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    reached.push(url.hostname);
    return realFetch(input, init);
  };
  try {
    const outcome = await fullRun();
    assert.equal(outcome.verdict, 'PASS');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(reached.length > 0, 'the browser journey reached its loopback surface');
  assert.deepEqual([...new Set(reached)], ['127.0.0.1']);
  assert.deepEqual(
    PRESERVED.map((target) => treeDigest(target)),
    before,
  );
});

test('a run holds no release, publish, or activation authority', async () => {
  const outcome = await fullRun();
  const serialized = JSON.stringify({
    receipts: outcome.receipts,
    report: outcome.aggregateReport,
    runResult: outcome.runResult,
  });
  for (const claim of [
    '"authority"',
    '"granted"',
    '"publish"',
    '"deploy"',
    '"promotion"',
    '"roomActivation"',
  ]) {
    assert.ok(!serialized.includes(claim), `a measurement record never carries ${claim}`);
  }
});

test('without a trusted browser adapter the journey stays blocking for exactly the skill that needs it', async () => {
  const outcome = await fullRun({ browserAdapter: null });
  assert.equal(outcome.verdict, 'BLOCKED');
  assert.equal(outcome.aggregateReport.absences.hostUnavailable, 6);
  assert.equal(outcome.aggregateReport.counters.scenariosAbsent, 6);
  const blocked = outcome.receipts
    .filter((receipt) => receipt.result === 'blocked')
    .map((receipt) => receipt.subject.skillId);
  assert.deepEqual(blocked, ['planr-browser-qa']);
  const ready = outcome.receipts.filter((receipt) => receipt.result === 'release-ready');
  assert.equal(ready.length, outcome.receipts.length - 1);
});

test('a certified result covers only the host profiles the run actually graded', async () => {
  const outcome = await fullRun();
  for (const receipt of outcome.receipts) {
    const hosts = receipt.inputs.hostProfiles.map((entry) => entry.hostProfileId).sort();
    assert.deepEqual(hosts, ['claude-code', 'codex', 'cursor']);
    assert.ok(
      receipt.inputs.hostProfiles.every((entry) =>
        /^sha256:[a-f0-9]{64}$/u.test(entry.hostProfileDigest),
      ),
    );
  }
});

test('a partial catalog is reported rather than quietly shrinking the totals', async () => {
  const inputs = loadEvaluationInputs({ repoRoot: root, sourceRoot });
  const dropped = inputs.corpora[0].corpus.skill.id;
  const partial = {
    ...inputs,
    corpora: inputs.corpora.filter((entry) => entry.corpus.skill.id !== dropped),
    uncoveredSkills: [dropped],
  };
  const outcome = await fullRun({ inputs: partial });
  assert.deepEqual([...outcome.uncoveredSkills], [dropped]);
  assert.equal(outcome.receipts.length, inputs.corpora.length - 1);
  assert.ok(outcome.aggregateReport.skills.every((entry) => entry.skillId !== dropped));
  assert.equal(
    outcome.aggregateReport.counters.scenariosTotal,
    outcome.aggregateReport.skills.reduce((total, entry) => total + entry.scenariosTotal, 0),
  );
});

test('evidence carries forward only where every bound input digest is identical', async () => {
  const outcome = await fullRun();
  const reused = await fullRun({ priorEvidence: outcome.evidenceInputs });
  assert.equal(reused.reuse.reusable.length, outcome.evidenceInputs.length);
  assert.equal(reused.reuse.invalidated.length, 0);

  const stale = outcome.evidenceInputs.map((entry, index) =>
    index === 0
      ? { ...entry, inputs: { ...entry.inputs, sourceDigest: `sha256:${'f'.repeat(64)}` } }
      : entry,
  );
  const partial = await fullRun({ priorEvidence: stale });
  assert.equal(partial.reuse.invalidated.length, 1);
  assert.equal(partial.reuse.invalidated[0].reason, 'input-digest-changed');
  assert.deepEqual([...partial.reuse.invalidated[0].changedInputs], ['sourceDigest']);
});

test('a changed prompt byte invalidates the scenario that bound it', async () => {
  const promptPath = join(root, 'evaluation/scenarios/planr-spec/codex/prompts/positive.txt');
  const original = readFileSync(promptPath, 'utf8');
  try {
    writeFileSync(promptPath, `${original}An extra line the scenario never sealed.\n`);
    await assert.rejects(fullRun(), { code: 'E_EVALUATION_DIGEST_MISMATCH' });
  } finally {
    writeFileSync(promptPath, original);
  }
  const restored = await fullRun();
  assert.equal(restored.verdict, 'PASS');
});

test('a changed host profile source invalidates the registry binding', async () => {
  const profilePath = join(root, 'evaluation/host-profiles/cursor.json');
  const original = readFileSync(profilePath, 'utf8');
  try {
    const drifted = JSON.parse(original);
    drifted.profileVersion = '1.0.1';
    writeFileSync(profilePath, `${JSON.stringify(drifted, null, 2)}\n`);
    assert.throws(() => loadEvaluationInputs({ repoRoot: root, sourceRoot }), {
      code: 'E_EVALUATION_DIGEST_MISMATCH',
    });
  } finally {
    writeFileSync(profilePath, original);
  }
  assert.ok(
    loadEvaluationInputs({ repoRoot: root, sourceRoot }).hostProfileRegistry.profiles.length === 3,
  );
});

test('the aggregate report is the only publishable projection and carries no raw evidence', async () => {
  const outcome = await fullRun();
  assert.equal(
    assertEvaluationAggregatePublishable(outcome.aggregateReport),
    outcome.aggregateReport,
  );
  const serialized = JSON.stringify(outcome.aggregateReport);
  assert.ok(!serialized.includes('test this UI'), 'no prompt text reaches the aggregate');
  assert.ok(!serialized.includes(root), 'no absolute path reaches the aggregate');
  assert.equal(outcome.aggregateReport.redaction.rawPromptsExcluded, true);
  assert.equal(outcome.aggregateReport.redaction.screenshotsExcluded, true);
});

test('CI publishes only the redacted aggregate and JUnit while raw evidence stays local', async () => {
  const outcome = await fullRun();
  const localDirectory = mkdtempSync(join(tmpdir(), 'planr-evaluation-report-'));
  try {
    writeLocalRun(localDirectory, {
      runResult: outcome.runResult,
      aggregateReport: outcome.aggregateReport,
      receipts: outcome.receipts,
      rawEvidence: outcome.evidenceInputs,
    });
    const ciDirectory = join(localDirectory, 'ci');
    const written = writeCiReports(ciDirectory, outcome.aggregateReport);
    assert.deepEqual([...written], [...EVALUATION_CI_ARTIFACTS]);
    assert.deepEqual(readdirSync(ciDirectory).sort(), [...EVALUATION_CI_ARTIFACTS].sort());
    const junit = readFileSync(join(ciDirectory, EVALUATION_CI_ARTIFACTS[1]), 'utf8');
    assert.match(junit, /^<\?xml version="1\.0" encoding="UTF-8"\?>/u);
    assert.ok(!junit.includes('test this UI'));
    assert.ok(!junit.includes(root));
    assert.ok(readdirSync(localDirectory).includes('raw-evidence.json'));
  } finally {
    rmSync(localDirectory, { recursive: true, force: true });
  }
});

test('JUnit emission reports absences as skipped rather than passed', async () => {
  const outcome = await fullRun({ browserAdapter: null });
  const junit = renderJUnit(outcome.aggregateReport);
  assert.equal(
    (junit.match(/<skipped/gu) ?? []).length,
    outcome.aggregateReport.counters.scenariosAbsent,
  );
  assert.match(junit, /skipped="6"/u);
});

test('the default run registers no live-model grader', async () => {
  const inputs = loadEvaluationInputs({ repoRoot: root, sourceRoot });
  assert.ok(
    inputs.graderRegistry.graders.every((grader) => grader.graderType !== 'live-model-judgement'),
  );
  assert.ok(inputs.graderRegistry.graders.every((grader) => grader.determinism.network === false));
  assert.ok(
    inputs.graderRegistry.graders.every((grader) => grader.blocksContractValidation === false),
  );
  const adapter = createLoopbackBrowserAdapter();
  assert.equal(adapter.trusted, true);
});
