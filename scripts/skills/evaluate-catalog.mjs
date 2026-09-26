#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  evaluateSkill,
  inspectStandardSkill,
  isStandardSkillPackage,
} from '../../packages/skill-runtime/src/authoring/index.mjs';
import {
  buildRegistryRoutingCases,
  evaluateResilienceJourneys,
  evaluateRoutingCorpus,
} from '../../packages/skill-runtime/src/matching/index.mjs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const root = process.cwd();
const registry = readJson(join(root, 'skills/registry.json'));
const corpus = readJson(join(root, 'evaluation/skills/routing-corpus.json'));
const resilience = readJson(join(root, 'evaluation/skills/resilience-journeys.json'));
const profiles = readJson(join(root, 'packages/protocol/registries/skill-host-profiles.json'));
const questions = readJson(
  join(root, 'packages/skill-runtime/fixtures/resolver/question-fallbacks.json'),
);
const skills = registry.skills.map(({ skillId, source }) => {
  const skillDir = dirname(join(root, source));
  const result = isStandardSkillPackage(skillDir)
    ? inspectStandardSkill({ skillDir, command: 'evaluate' })
    : evaluateSkill({ skillDir });
  return {
    skillId,
    passed: result.ok,
    hosts: result.ok ? result.hosts.length : 0,
    diagnostics: result.diagnostics,
  };
});
const registryCases = buildRegistryRoutingCases(registry);
const routing = evaluateRoutingCorpus({
  registry,
  cases: [...corpus.cases, ...registryCases],
  threshold: corpus.threshold,
});
const journeys = evaluateResilienceJourneys({
  journeys: resilience.journeys,
  hostProfiles: profiles.profiles,
  questions,
});
const report = {
  kind: 'openplanr-skill-catalog-evaluation',
  schemaVersion: '1.0.0',
  passed: skills.every(({ passed }) => passed) && routing.passed && journeys.passed,
  skills,
  routing,
  resilience: journeys,
};
if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
else {
  process.stdout.write(
    `Catalog evaluation ${report.passed ? 'passed' : 'failed'}: ${skills.filter(({ passed }) => passed).length}/${skills.length} skills, ${routing.totals.passed}/${routing.totals.cases} routing cases, ${journeys.totals.passed}/${journeys.totals.journeys} resilience journeys.\n`,
  );
}
process.exit(report.passed ? 0 : 1);
