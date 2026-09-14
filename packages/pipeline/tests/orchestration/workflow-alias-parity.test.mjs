import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { projectedSkillName, renderNamespacedSkill } from '../../../../scripts/skills/host-invocations.mjs';

const pipelineRoot = fileURLToPath(new URL('../../', import.meta.url));
const workspaceRoot = resolve(pipelineRoot, '..', '..');
const read = (path) => readFileSync(join(workspaceRoot, path), 'utf8');

function cursorBody(markdown) {
  const match = markdown.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/u);
  assert.ok(match, 'Cursor rule must have one frontmatter envelope');
  return match[1];
}

test('canonical workflows project to all hosts without aliases or generated commands', () => {
  const manifest = JSON.parse(read('adapters/manifests/canonical-skills.json'));
  assert.equal(manifest.protocolVersion, '1.8.0');
  assert.deepEqual(manifest.aliases, []);

  for (const skillId of ['planr-plan', 'planr-design', 'planr-ship', 'planr-sync', 'planr-dashboard']) {
    const canonical = read(`skills/${skillId}/SKILL.md`);
    const projected = renderNamespacedSkill(canonical, skillId);
    const hostSkillName = projectedSkillName(skillId);
    assert.equal(read(`dist/plugins/openai/openplanr/skills/${hostSkillName}/SKILL.md`), projected);
    assert.equal(read(`dist/plugins/claude/openplanr/skills/${hostSkillName}/SKILL.md`), projected);

    const canonicalBody = canonical.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/u)?.[1];
    assert.ok(canonicalBody, `${skillId}: canonical frontmatter`);
    assert.equal(
      cursorBody(read(`dist/plugins/cursor/openplanr/rules/${skillId}.mdc`)),
      canonicalBody,
      `${skillId}: Cursor body parity`,
    );
  }
});

test('host plugin manifests expose the canonical package shape only', () => {
  const openai = JSON.parse(read('dist/plugins/openai/openplanr/.codex-plugin/plugin.json'));
  const claude = JSON.parse(read('dist/plugins/claude/openplanr/.claude-plugin/plugin.json'));
  assert.equal(openai.name, 'planr');
  assert.equal(claude.name, 'planr');
  assert.equal(openai.version, claude.version);

  const canonical = JSON.parse(read('adapters/manifests/canonical-skills.json'));
  const generated = JSON.parse(read('adapters/manifests/generated-assets.json'));
  assert.deepEqual(canonical.aliases, []);
  assert.equal(generated.assets.some(({ path }) => path.includes('/commands/')), false);
  assert.equal(generated.assets.some(({ path }) => path.includes('/codex-skills/')), false);
});

test('retired pipeline command aliases are not included in the published package', () => {
  const manifest = JSON.parse(read('packages/pipeline/package.json'));
  for (const retired of ['adapters/', 'commands/', 'skills/', 'plugins/']) {
    assert.equal(manifest.files.includes(retired), false, retired);
  }
});
