import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { BUSINESS_EXECUTIVE_SKILL_BINDINGS } from '../../lib/operate/contracts/role-skills.mjs';
import { projectedSkillName, renderNamespacedSkill } from '../../../../scripts/skills/host-invocations.mjs';

const PIPELINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKSPACE_ROOT = resolve(PIPELINE_ROOT, '../..');
const OPERATE_SKILL_IDS = [
  'planr-operate',
  ...BUSINESS_EXECUTIVE_SKILL_BINDINGS.map(({ skillName }) => skillName),
];
const LEGACY_OPERATE_SKILL_IDS = [
  'planr-operate-ceo',
  'planr-operate-cto',
  'planr-operate-cpo',
  'planr-operate-cmo',
  'planr-operate-coo',
  'planr-operate-challenger',
  'planr-operate-chair',
];
const FORBIDDEN_EXECUTION = /\b(?:planr-pipeline|planr plan|planr spec decompose|ANTHROPIC_API_KEY|OPENAI_API_KEY|OLLAMA_HOST)\b/iu;

function readWorkspace(path) {
  return readFileSync(join(WORKSPACE_ROOT, path), 'utf8');
}

function readJson(path) {
  return JSON.parse(readWorkspace(path));
}

function skillBody(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n\n?/u, '');
}

test('the canonical catalog contains one Operate orchestrator and seven role skills', () => {
  const catalog = readJson('adapters/manifests/canonical-skills.json');
  assert.equal(catalog.protocolVersion, '1.8.0');
  assert.equal(catalog.sourceFormat, 'package-v1');
  assert.deepEqual(catalog.aliases, []);
  assert.deepEqual(
    catalog.skillIds.filter((skillId) => OPERATE_SKILL_IDS.includes(skillId)),
    [...OPERATE_SKILL_IDS].sort(),
  );
  for (const skillId of LEGACY_OPERATE_SKILL_IDS) {
    assert.ok(!catalog.skillIds.includes(skillId), `${skillId}: retired alias`);
  }
});

test('OpenAI and Claude package exact canonical Operate skill trees', () => {
  for (const skillId of OPERATE_SKILL_IDS) {
    const hostSkillName = projectedSkillName(skillId);
    const manifest = readJson(`skills/${skillId}/openplanr.skill.json`);
    const canonicalSkill = readWorkspace(`skills/${skillId}/SKILL.md`);

    assert.equal(manifest.execution, 'host-agent');
    assert.equal(manifest.protocolVersion, '1.8.0');
    assert.equal(
      readWorkspace(`dist/plugins/openai/openplanr/skills/${hostSkillName}/SKILL.md`),
      renderNamespacedSkill(canonicalSkill, skillId),
      `${skillId}: OpenAI SKILL.md`,
    );
    assert.equal(
      readWorkspace(`dist/plugins/claude/openplanr/skills/${hostSkillName}/SKILL.md`),
      renderNamespacedSkill(canonicalSkill, skillId),
      `${skillId}: Claude SKILL.md`,
    );
    assert.deepEqual(
      readJson(`dist/plugins/openai/openplanr/skills/${hostSkillName}/openplanr.skill.json`),
      manifest,
      `${skillId}: OpenAI manifest`,
    );
    assert.deepEqual(
      readJson(`dist/plugins/claude/openplanr/skills/${hostSkillName}/openplanr.skill.json`),
      manifest,
      `${skillId}: Claude manifest`,
    );

    for (const resource of manifest.resources.filter(({ kind }) => kind !== 'agent-metadata')) {
      const canonical = readWorkspace(`skills/${skillId}/${resource.path}`);
      assert.equal(
        readWorkspace(`dist/plugins/openai/openplanr/skills/${hostSkillName}/${resource.path}`),
        canonical,
        `${skillId}: OpenAI ${resource.path}`,
      );
      assert.equal(
        readWorkspace(`dist/plugins/claude/openplanr/skills/${hostSkillName}/${resource.path}`),
        canonical,
        `${skillId}: Claude ${resource.path}`,
      );
    }
  }
});

test('Cursor rules preserve canonical Operate bodies and deterministic resources', () => {
  const cursorManifest = readJson('dist/plugins/cursor/openplanr/manifest.json');
  const canonicalCatalog = readJson('adapters/manifests/canonical-skills.json');
  assert.equal(cursorManifest.ruleCount, canonicalCatalog.skillIds.length);

  for (const skillId of OPERATE_SKILL_IDS) {
    const manifest = readJson(`skills/${skillId}/openplanr.skill.json`);
    const cursorRule = readWorkspace(`dist/plugins/cursor/openplanr/rules/${skillId}.mdc`);
    assert.equal(skillBody(cursorRule), skillBody(readWorkspace(`skills/${skillId}/SKILL.md`)));
    assert.ok(cursorManifest.rules.includes(`rules/${skillId}.mdc`));

    for (const resource of manifest.resources.filter(({ kind, hosts }) => (
      kind !== 'agent-metadata' && hosts.includes('cursor')
    ))) {
      assert.equal(
        readWorkspace(`dist/plugins/cursor/openplanr/rules/${skillId}/${resource.path}`),
        readWorkspace(`skills/${skillId}/${resource.path}`),
        `${skillId}: Cursor ${resource.path}`,
      );
    }
  }
});

test('Operate dispatch is host-native and contains no model-backed subprocess', () => {
  const parent = readWorkspace('skills/planr-operate/SKILL.md');
  assert.match(parent, /Build shared context once/u);
  assert.match(parent, /in parallel when subagents are\s+available/u);
  assert.match(parent, /native structured-question UI/u);
  assert.match(parent, /If the directory is ignored by Git, continue locally/u);
  assert.match(parent, /## Action plan/u);
  assert.doesNotMatch(parent, FORBIDDEN_EXECUTION);
  assert.doesNotMatch(parent, /data\.continuation|allowedActions|packetId|assignmentId|evidence-digest/iu);

  for (const { skillName } of BUSINESS_EXECUTIVE_SKILL_BINDINGS) {
    assert.match(parent, new RegExp(`\\b${skillName}\\b`, 'u'), skillName);
  }
});

test('pipeline compatibility package ships runtime contracts but no prompt distribution', () => {
  const packageJson = readJson('packages/pipeline/package.json');
  for (const path of ['adapters/', 'agents/', 'commands/', 'skills/', 'plugins/']) {
    assert.ok(!packageJson.files.includes(path), `${path}: excluded from package`);
  }
});
