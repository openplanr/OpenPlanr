import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Plan defines Protocol 1.7 decomposition and an exact non-chaining Ship handoff', () => {
  const plan = read('skills/planr-plan/SKILL.md');
  const contract = read('skills/planr-plan/references/artifact-contract.md');
  assert.match(plan, /project-global monotonic `US-NNN` and `T-NNN`/u);
  assert.match(plan, /Write stories and tasks directly/iu);
  assert.match(plan, /planning ID helper.*inspect or reserve IDs/isu);
  assert.match(plan, /reviewRisks.*browserSurfaces/isu);
  assert.match(plan, /map every acceptance ID.*acceptanceRefs/isu);
  assert.match(plan, /\$planr-ship T-NNN[\s\S]*\/planr-ship T-NNN/u);
  assert.match(plan, /never starts implementation|never starts Ship|Do not start Ship/iu);
  assert.match(contract, /Protocol `1\.7\.0` frontmatter/u);
});

test('Ship guides local completion without process machinery', () => {
  const ship = read('skills/planr-ship/SKILL.md');
  assert.match(ship, /^# Planr Ship\s+\n\s*Produce an implementation-complete local repository/mu);
  assert.match(ship, /task Test Requirements.*repository instructions.*package and task-runner.*CI and pre-commit/isu);
  assert.match(ship, /discover-verification\.mjs/u);
  assert.match(ship, /never executes checks or writes files/u);
  assert.match(ship, /reviewRisks.*check/isu);
  assert.match(ship, /browserSurfaces.*useful checks/isu);
  assert.match(ship, /neither field\s+is a workflow gate/u);
  assert.match(ship, /retain unrelated working-tree changes/u);
  assert.match(ship, /dependency has not produced\s+the interface this task consumes/u);
  assert.match(ship, /Isolate independent executions.*otherwise serialize only overlapping writes/isu);
  assert.doesNotMatch(ship, /conflictsWith.*frontmatter|receipt|evidence ledger|correction loop|approval narration/iu);
  assert.match(ship, /Return the existing five fields:[\s\S]*Outcome[\s\S]*Task[\s\S]*Changed[\s\S]*Checks[\s\S]*Issues/u);
  assert.match(ship, /Next: planr-land/u);
});

test('Ship package is host-native, locally scoped, and excludes remote effects', () => {
  const source = JSON.parse(read('skills/planr-ship/openplanr.skill.json'));
  const registry = JSON.parse(read('skills/registry.json'));
  const registration = registry.skills.find(({ skillId }) => skillId === 'planr-ship');
  const ship = read('skills/planr-ship/SKILL.md');
  assert.equal(source.protocolVersion, '1.8.0');
  assert.equal(source.execution, 'host-agent');
  assert.equal(registration.authorityClass, 'implementation');
  assert.match(ship, /read, edit, shell, browser, and test capabilities/iu);
  assert.match(ship, /Keep the work local; do not publish or deploy/iu);
});
