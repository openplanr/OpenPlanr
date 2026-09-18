import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const PIPELINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKSPACE_ROOT = resolve(PIPELINE_ROOT, '../..');
const readWorkspace = (path) => readFileSync(join(WORKSPACE_ROOT, path), 'utf8');

test('generated adapter documentation describes the Protocol 1.8 host packages', () => {
  const catalog = JSON.parse(readWorkspace('adapters/manifests/canonical-skills.json'));
  const roles = JSON.parse(readWorkspace('adapters/manifests/role-assets.json'));
  const document = readWorkspace('docs/generated/adapters.md');

  const source = JSON.parse(readWorkspace('skills/registry.json'));
  assert.deepEqual(catalog.skillIds, source.skills.map(({ skillId }) => skillId));
  assert.equal(roles.roles.length, 9);
  assert.match(document, /Protocol 1\.8\.0 standard skill packages/u);
  assert.match(document, /\| `claude-code` \|/u);
  assert.match(document, /\| `codex` \|/u);
  assert.match(document, /\| `cursor` \|/u);
  assert.ok(document.includes(`${catalog.skillIds.length} canonical skills`));
  assert.match(document, /9 host-native role agents/u);
  assert.match(document, /No generated commands, compatibility aliases/u);
  assert.match(document, /Semantic workflows execute in the active host agent/u);
});

test('generated skill documentation covers every canonical skill and its references', () => {
  const catalog = JSON.parse(readWorkspace('adapters/manifests/canonical-skills.json'));
  const document = readWorkspace('docs/generated/skills.md');
  for (const skill of catalog.skills) {
    assert.match(document, new RegExp(`^## ${'`'}${skill.id}${'`'}$`, 'mu'), skill.id);
    const section = document.split(`## ${'`'}${skill.id}${'`'}\n`)[1].split('\n## ')[0];
    assert.ok(section.includes(skill.description), `${skill.id}: description`);
    // The catalog lists the references a reader opens; the complete packaged inventory
    // stays in adapters/manifests/generated-assets.json.
    const resources = skill.resources.filter(({ kind }) => kind !== 'agent-metadata');
    const references = resources.filter(({ path }) => path.startsWith('references/'));
    for (const resource of references) {
      assert.ok(section.includes(`\`${resource.path}\``), `${skill.id}: ${resource.path}`);
    }
    const remaining = resources.length - references.length;
    if (remaining > 0) {
      assert.match(
        section,
        new RegExp(`${remaining} packaged (?:schema, script, and runtime )?resources`, 'u'),
        `${skill.id}: ${remaining} unlisted resources`,
      );
    }
    if (resources.length === 0) {
      assert.match(section, /Packaged support: none; the skill is intentionally single-file/u, skill.id);
    }
  }
  assert.match(document, /Aliases: none/u);
  assert.doesNotMatch(document, /planr-pipeline:/u);
});
