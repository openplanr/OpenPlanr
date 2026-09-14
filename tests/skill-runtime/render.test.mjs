import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SkillRuntimeError,
  parseMarkdownAsset,
  renderCodexSkill,
  renderHostTokens,
  renderTemplate,
} from '../../packages/skill-runtime/src/index.mjs';

const skill = `---\nname: planr-fixture\ndescription: Fixture behavior.\nallowed-tools: "Read"\n---\n\n# Fixture\n\nRead only.\n`;

test('skill parsing binds identity and Codex rendering removes Claude-only tool policy', () => {
  const parsed = parseMarkdownAsset(skill, { expectedName: 'planr-fixture' });
  assert.equal(parsed.fields.description, 'Fixture behavior.');
  const rendered = renderCodexSkill(skill, 'planr-fixture');
  assert.doesNotMatch(rendered, /allowed-tools/u);
  assert.match(rendered, /name: planr-fixture/u);
});

test('templates fail on missing, unused, or unresolved values', () => {
  assert.equal(renderTemplate('{{VALUE}}\n', { VALUE: 'ok' }), 'ok\n');
  assert.throws(
    () => renderTemplate('{{VALUE}}\n', {}),
    (error) => error instanceof SkillRuntimeError && error.code === 'E_TEMPLATE_VALUE_MISSING',
  );
  assert.throws(
    () => renderTemplate('fixed\n', { VALUE: 'unused' }),
    (error) => error instanceof SkillRuntimeError && error.code === 'E_TEMPLATE_VALUE_UNUSED',
  );
});

test('host token rendering substitutes only values used by the selected asset', () => {
  assert.equal(renderHostTokens('{{WORKFLOW_PREFIX}}ship\n', 'codex'), '$planr-ship\n');
  assert.equal(renderHostTokens('no tokens\n', 'cursor'), 'no tokens\n');
});
