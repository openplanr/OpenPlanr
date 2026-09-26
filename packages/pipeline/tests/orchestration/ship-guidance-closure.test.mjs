import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderNamespacedSkill } from '../../../../scripts/skills/host-invocations.mjs';

const PIPELINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKSPACE_ROOT = resolve(PIPELINE_ROOT, '../..');
const readWorkspace = (path) => readFileSync(join(WORKSPACE_ROOT, path), 'utf8');
const FORBIDDEN_DELEGATION =
  /\b(?:planr-pipeline|planr plan|planr spec decompose|ANTHROPIC_API_KEY|OPENAI_API_KEY|OLLAMA_HOST)\b/iu;
const RETIRED_GOVERNANCE =
  /receipt|sha-?256|digest-bound|correction (?:counter|loop|attempt)|one task per invocation|one-subtask approval|snapshot-pending/iu;

test('Ship is an in-session implementation workflow with a clear Land boundary', () => {
  const skill = readWorkspace('skills/planr-ship/SKILL.md');
  assert.match(skill, /implementation-complete local repository/u);
  assert.match(skill, /Landing and release preparation belong to `planr-land`/u);
  assert.match(skill, /Do not\s+delegate implementation to a command-line or model subprocess/u);
  assert.match(skill, /host's read, edit, shell, browser, and test capabilities/u);
  assert.match(skill, /inside this session/u);
  assert.match(skill, /Next: planr-land/u);
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
});

test('the packaged discovery helper is read-only and returns ordered command candidates', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'openplanr-ship-discovery-'));
  try {
    mkdirSync(join(fixture, '.github/workflows'), { recursive: true });
    mkdirSync(join(fixture, '.planr/specs/SPEC-001/us-001/tasks'), { recursive: true });
    writeFileSync(
      join(fixture, 'package.json'),
      JSON.stringify({
        scripts: { test: 'node --test', lint: 'biome check .', dev: 'vite' },
      }),
    );
    writeFileSync(join(fixture, 'AGENTS.md'), 'Run `npm run lint` before completion.\n');
    writeFileSync(
      join(fixture, '.planr/specs/SPEC-001/us-001/tasks/T-001-example.md'),
      '## Test Requirements\n\n```sh\nnpm run test -- --example\n```\n',
    );
    writeFileSync(join(fixture, '.github/workflows/ci.yml'), 'steps:\n  - run: npm run test\n');

    const helper = join(WORKSPACE_ROOT, 'skills/planr-ship/scripts/discover-verification.mjs');
    const result = spawnSync(
      process.execPath,
      [
        helper,
        '--project',
        fixture,
        '--task',
        '.planr/specs/SPEC-001/us-001/tasks/T-001-example.md',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.checks.slice(0, 3), [
      { command: 'npm run test -- --example', source: 'task-requirements' },
      { command: 'npm run lint', source: 'repository-instructions' },
      { command: 'npm run test', source: 'package-task-runner' },
    ]);
    assert.deepEqual(output.diagnostics, []);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
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
    canonical.replace(/^---\n[\s\S]*?\n---\n\n?/u, ''),
  );

  const pipelinePackage = JSON.parse(readFileSync(join(PIPELINE_ROOT, 'package.json'), 'utf8'));
  for (const retired of ['adapters/', 'agents/', 'commands/', 'skills/', 'plugins/']) {
    assert.ok(!pipelinePackage.files.includes(retired), retired);
  }
});
