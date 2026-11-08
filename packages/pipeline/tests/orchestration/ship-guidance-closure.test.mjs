import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  renderCursorSkillBody,
  renderNamespacedSkill,
} from '../../../../scripts/skills/host-invocations.mjs';

const PIPELINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKSPACE_ROOT = resolve(PIPELINE_ROOT, '../..');
const readWorkspace = (path) => readFileSync(join(WORKSPACE_ROOT, path), 'utf8');
const FORBIDDEN_DELEGATION =
  /\b(?:(?:open)?planr-pipeline|planr plan|planr spec decompose|ANTHROPIC_API_KEY|OPENAI_API_KEY|OLLAMA_HOST)\b/iu;
const RETIRED_GOVERNANCE =
  /receipt|sha-?256|digest-bound|correction (?:counter|loop|attempt)|one task per invocation|one-subtask approval|snapshot-pending/iu;

test('Ship is an in-session implementation workflow with a clear Land boundary', () => {
  const skill = readWorkspace('skills/planr-ship/SKILL.md');
  assert.match(skill, /implementation-complete local repository/u);
  assert.match(skill, /Landing and release preparation belong to `planr-land`/u);
  assert.match(skill, /Do not\s+delegate implementation to a command-line or model subprocess/u);
  assert.match(skill, /host's read, edit, shell, browser, and test capabilities/u);
  assert.match(skill, /inside this session/u);
  const guidance = skill.replace(/\s+/gu, ' ');
  assert.match(
    guidance,
    /Suggest `planr-land` only when a landing step remains in the requested workflow/u,
  );
  assert.match(guidance, /Do not add a next action when the requested scope is fulfilled/u);
  assert.doesNotMatch(skill, /^\s*(?:-\s*)?Next:\s*planr-land\s*$/mu);
  assert.doesNotMatch(skill, FORBIDDEN_DELEGATION);
  assert.doesNotMatch(skill, RETIRED_GOVERNANCE);
});

test('Ship resolves full task context without turning overlap into semantic dependency', () => {
  const skill = readWorkspace('skills/planr-ship/SKILL.md');
  assert.match(skill, /read it completely/u);
  assert.match(skill, /follow its\s+`storyId` and `specId`/u);
  assert.match(skill, /repository instructions, ADRs,\s+planning rules/u);
  assert.match(skill, /Only `dependsOn` defines semantic ordering/u);
  assert.match(skill, /Never infer a\s+dependency from order or overlapping paths/u);
  assert.match(skill, /serialize only overlapping writes/u);
  assert.match(skill, /missing planning files do not create a gate/u);
});

test('Ship discovers verification in the specified order and treats risk metadata as guidance', () => {
  const skill = readWorkspace('skills/planr-ship/SKILL.md');
  const task = skill.indexOf('1. task Test Requirements;');
  const repository = skill.indexOf('2. repository instructions;');
  const packageRunner = skill.indexOf('3. package and task-runner scripts;');
  const ci = skill.indexOf('4. applicable CI and pre-commit configuration.');
  assert.ok(task > 0 && task < repository && repository < packageRunner && packageRunner < ci);
  assert.match(skill, /`reviewRisks` and\s+`browserSurfaces` select useful checks/u);
  assert.match(skill, /neither field\s+is a workflow gate/u);
  assert.match(skill, /Missing commands are diagnostics/u);
  assert.match(skill, /Inspect these sources directly, in this order/u);
  assert.match(skill, /never execute a check while discovering/u);
  for (const rule of [
    /touches a build input/u,
    /prefer tests related to the changed\s+files/u,
    /every CI job whose triggers and path filters fire/u,
    /dry-run pack that confirms they are packed/u,
  ])
    assert.match(skill, rule);
  assert.match(
    skill,
    /If `openplanr` is already on `PATH`, `openplanr ship checks --json\s+--task <task-path>`/u,
  );
  assert.doesNotMatch(skill, /discover-verification|\bnode </u);
  assert.match(skill, /`set -o pipefail`/u);
});

test('Ship keeps the five-field result contract concise and non-governing', () => {
  const skill = readWorkspace('skills/planr-ship/SKILL.md');
  const contract = readWorkspace('skills/planr-ship/references/result-contract.md');
  for (const field of ['Outcome', 'Task', 'Changed', 'Checks', 'Issues']) {
    assert.match(skill, new RegExp(`\\*\\*${field}:\\*\\*`, 'u'), field);
  }
  for (const field of ['outcome', 'task', 'changed', 'checks', 'issues']) {
    assert.match(contract, new RegExp(`\\b${field}\\b`, 'u'), field);
  }
  assert.match(
    contract,
    /Do not add receipts, digests, proof ledgers, fixed review loops, or approval\s+narration/u,
  );
});

test('Ship and Investigate split issues into blockers and findings they offer to file', () => {
  const contract = readWorkspace('skills/planr-ship/references/result-contract.md');
  assert.match(contract, /`blockers`/u);
  assert.match(contract, /`findings`/u);
  for (const skillId of ['planr-ship', 'planr-investigate']) {
    const skill = readWorkspace(`skills/${skillId}/SKILL.md`);
    assert.match(skill, /\]\(references\/findings\.md\)/u, skillId);
    assert.match(skill, /\]\(references\/backlog-filing\.md\)/u, skillId);
    assert.match(skill, /never\s+fix them in this change unless they block/u, skillId);
    for (const reference of ['findings.md', 'backlog-filing.md'])
      assert.equal(
        readWorkspace(`skills/${skillId}/references/${reference}`),
        readWorkspace(`skills/shared/${reference}`),
      );
  }
  const findings = readWorkspace('skills/shared/findings.md');
  for (const rule of [
    /"File all N \(Recommended\)"/u,
    /"Don't file"/u,
    /With\s+`report`, or no setting, do not file at all/u,
    /The request says to file findings, or not to: do that/u,
    /never file or drop a finding\s+silently/u,
    /list open backlog items as\s+\[backlog filing\]\(backlog-filing\.md\)/u,
    /Already tracked as BL-/u,
    /Paths are always repo-relative/u,
  ]) {
    assert.match(findings, rule);
  }
  const filing = readWorkspace('skills/shared/backlog-filing.md');
  for (const rule of [
    /If `openplanr` is already on\s+`PATH`/u,
    /immediately before writing each item/u,
    /no-clobber create/u,
    /take the next\s+number/u,
    /Never overwrite or edit an existing backlog file or marker/u,
    /`priority`: `critical`, `high`, `medium` or `low`/u,
    /`status`: `"open"`/u,
    /`created` and `updated`: today's date as `YYYY-MM-DD`/u,
  ]) {
    assert.match(filing, rule);
  }
  for (const text of [findings, filing]) {
    assert.doesNotMatch(text, /\bnpx\b|\bnode </u);
    assert.doesNotMatch(text, /cliHint|npm install/u);
  }
});

test('no host bundle ships the backlog helper; each carries the filing procedure', () => {
  for (const [bundle, skillRoot] of [
    ['dist/plugins/claude/openplanr', (id) => `skills/${id.replace(/^planr-/u, '')}`],
    ['dist/plugins/openai/openplanr', (id) => `skills/${id.replace(/^planr-/u, '')}`],
    ['dist/plugins/cursor/openplanr', (id) => `rules/${id}`],
  ]) {
    for (const skillId of ['planr-ship', 'planr-investigate']) {
      const dir = join(WORKSPACE_ROOT, bundle, skillRoot(skillId));
      assert.equal(
        existsSync(join(dir, 'scripts/backlog-item.mjs')),
        false,
        `${bundle} ${skillId}`,
      );
      assert.equal(
        readFileSync(join(dir, 'references/backlog-filing.md'), 'utf8'),
        readWorkspace('skills/shared/backlog-filing.md'),
        `${bundle} ${skillId}`,
      );
    }
  }
});

test('no host bundle ships the verification discovery helper', () => {
  for (const dir of [
    'dist/plugins/claude/openplanr/skills/ship',
    'dist/plugins/openai/openplanr/skills/ship',
    'dist/plugins/cursor/openplanr/rules/planr-ship',
  ]) {
    assert.equal(
      existsSync(join(WORKSPACE_ROOT, dir, 'scripts/discover-verification.mjs')),
      false,
      dir,
    );
  }
});

test('Ship passes delegate context, re-checks evidence and maps checks to acceptance', () => {
  const skill = readWorkspace('skills/planr-ship/SKILL.md');
  for (const pin of [
    /`\.planr\/conventions\/<area>\.md`/u,
    /absolute task path with `MODE`/u,
    /`SPEC_DIR`/u,
    /Re-run the cheap checks a worker reports as passed/u,
    /`git diff --name-only` plus untracked files/u,
    /Act on warning diagnostics too/u,
    /A diagnostic that a check could not run, such as\s+`TYPESCRIPT_UNAVAILABLE`, is not a pass/u,
    /confirm some tsconfig includes\s+it/u,
    /`expectFiles` entry/u,
    /`awaiting-acceptance`/u,
    /outside Create and Modify/u,
    /acceptance IDs it covers; list acceptance criteria no check covers/u,
    /\]\(references\/fail-first\.md\)/u,
  ]) {
    assert.match(skill, pin);
  }
  assert.match(
    readWorkspace('skills/planr-investigate/SKILL.md'),
    /\]\(references\/fail-first\.md\)/u,
  );
  const contract = readWorkspace('skills/planr-ship/references/result-contract.md');
  assert.match(contract, /`awaiting-acceptance`/u);
  assert.match(contract, /acceptance IDs it covers/u);
  assert.match(contract, /Do not add receipts, digests, proof ledgers/u);
});

test('Ship and Investigate carry the shared fail-first reference', () => {
  const failFirst = readWorkspace('skills/shared/fail-first.md');
  for (const skillId of ['planr-ship', 'planr-investigate']) {
    assert.equal(readWorkspace(`skills/${skillId}/references/fail-first.md`), failFirst, skillId);
  }
  for (const rule of [
    /assertion/u,
    /load error/u,
    /`git status --porcelain`/u,
    /nothing staged/u,
    /Off by default/iu,
    /Restore from the copy/u,
    /Copy the target file outside the repository/u,
    /and rebuild if step 4 did/u,
    /`cmp`/u,
  ]) {
    assert.match(failFirst, rule);
  }
  assert.match(failFirst, /passes before the change;\s+proves nothing/u);
  assert.match(failFirst, /narrow or strengthen the check yourself and record that in\s+`checks`/u);
  const alreadyPasses = failFirst.slice(
    failFirst.indexOf('A check that already passes'),
    failFirst.indexOf('## Seeded fault'),
  );
  assert.match(alreadyPasses, /passes before the change/u);
  assert.doesNotMatch(alreadyPasses, /\bask|question|default/iu);
  assert.doesNotMatch(failFirst, /must stop/iu);
  assert.doesNotMatch(failFirst, RETIRED_GOVERNANCE);
  for (const [skillId, hostSkill] of [
    ['planr-ship', 'ship'],
    ['planr-investigate', 'investigate'],
  ]) {
    for (const path of [
      `dist/plugins/claude/openplanr/skills/${hostSkill}/references/fail-first.md`,
      `dist/plugins/openai/openplanr/skills/${hostSkill}/references/fail-first.md`,
      `dist/plugins/cursor/openplanr/rules/${skillId}/references/fail-first.md`,
    ]) {
      assert.equal(readWorkspace(path), failFirst, path);
    }
  }
});

test('every host receives the canonical Ship package without compatibility commands', () => {
  const canonical = readWorkspace('skills/planr-ship/SKILL.md');
  const manifest = JSON.parse(readWorkspace('skills/planr-ship/openplanr.skill.json'));
  assert.equal(manifest.execution, 'host-agent');
  assert.equal(manifest.protocolVersion, '1.8.0');
  assert.deepEqual(manifest.utilityRequirements ?? [], []);
  assert.equal(
    readWorkspace('dist/plugins/openai/openplanr/skills/ship/SKILL.md'),
    renderNamespacedSkill(canonical, 'planr-ship'),
  );
  assert.equal(
    readWorkspace('dist/plugins/claude/openplanr/skills/ship/SKILL.md'),
    renderNamespacedSkill(canonical, 'planr-ship'),
  );
  const cursor = readWorkspace('dist/plugins/cursor/openplanr/rules/planr-ship.mdc');
  assert.equal(
    cursor.replace(/^---\n[\s\S]*?\n---\n\n?/u, ''),
    renderCursorSkillBody(
      canonical,
      'planr-ship',
      JSON.parse(readWorkspace('adapters/manifests/canonical-skills.json'))
        .skills.find((skill) => skill.id === 'planr-ship')
        .resources.filter(({ hosts }) => hosts.includes('cursor')),
    ),
  );

  const pipelinePackage = JSON.parse(readFileSync(join(PIPELINE_ROOT, 'package.json'), 'utf8'));
  for (const retired of ['adapters/', 'agents/', 'commands/', 'skills/', 'plugins/']) {
    assert.ok(!pipelinePackage.files.includes(retired), retired);
  }
});
