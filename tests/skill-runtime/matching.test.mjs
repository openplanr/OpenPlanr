import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ROUTING_CASE_KINDS,
  buildRegistryRoutingCases,
  evaluateResilienceJourneys,
  evaluateRoutingCorpus,
  matchSkillRequest,
} from '../../packages/skill-runtime/src/matching/index.mjs';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const registry = readJson('../../skills/registry.json');
const corpus = readJson('../../evaluation/skills/routing-corpus.json');
const journeys = readJson('../../evaluation/skills/resilience-journeys.json');
const hostProfiles = readJson('../../packages/protocol/registries/skill-host-profiles.json');
const questions = readJson(
  '../../packages/skill-runtime/fixtures/resolver/question-fallbacks.json',
);

test('routing corpus represents every canonical skill and meets family precision/recall', () => {
  assert.deepEqual(
    [...new Set(corpus.cases.map(({ expectedSkillId }) => expectedSkillId).filter(Boolean))].sort(),
    registry.skills.map(({ skillId }) => skillId).sort(),
  );
  const report = evaluateRoutingCorpus({
    registry,
    cases: [...corpus.cases, ...buildRegistryRoutingCases(registry)],
    threshold: corpus.threshold,
  });
  assert.equal(
    report.passed,
    true,
    JSON.stringify(
      {
        families: report.families,
        falsePositives: report.falsePositives,
        falseNegatives: report.falseNegatives,
        failed: report.results.filter(({ pass }) => !pass),
      },
      null,
      2,
    ),
  );
  assert.equal(
    report.totals.cases,
    corpus.cases.length + registry.skills.length * ROUTING_CASE_KINDS.length,
  );
  assert.equal(report.totals.falsePositives, 0);
  assert.equal(report.totals.falseNegatives, 0);
  assert.ok(
    report.families.every(
      ({ precision, recall }) => precision >= corpus.threshold && recall >= corpus.threshold,
    ),
  );
  assert.ok(report.coverage.every(({ pass, missingKinds }) => pass && missingKinds.length === 0));
});

test('removed compatibility aliases do not shadow canonical skill routing', () => {
  const result = matchSkillRequest({
    registry,
    input: 'Please invoke /openplanr for this planning request.',
  });
  assert.equal(result.status, 'deferred');
  assert.equal(result.skillId, null);
  assert.equal(result.reason, 'no-confident-match');
});

test('routing scores remain finite when exclusion language adds unseen vocabulary', () => {
  const result = matchSkillRequest({
    registry,
    input: 'Prepare the already implemented work for release without changing code',
  });
  assert.equal(result.skillId, 'planr-land');
  assert.ok(
    result.candidates.every(
      ({ score, exclusion, include }) =>
        Number.isFinite(score) && Number.isFinite(exclusion) && Number.isFinite(include),
    ),
  );
});

test('denied capability, question fallback, headless, interruption, and recovery journeys pass', () => {
  const report = evaluateResilienceJourneys({
    journeys: journeys.journeys,
    hostProfiles: hostProfiles.profiles,
    questions,
  });
  assert.equal(
    report.passed,
    true,
    JSON.stringify(
      report.results.filter(({ pass }) => !pass),
      null,
      2,
    ),
  );
  assert.deepEqual(report.totals, {
    journeys: journeys.journeys.length,
    passed: journeys.journeys.length,
  });
});
