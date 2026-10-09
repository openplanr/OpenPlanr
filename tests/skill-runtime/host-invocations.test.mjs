import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOST_PLUGIN_NAME,
  namespacedInvocation,
  projectedSkillName,
  renderCursorRule,
  renderNamespacedSkill,
  renderUserOnlySkill,
} from '../../scripts/skills/host-invocations.mjs';

test('a user-only skill gains disable-model-invocation in its frontmatter only', () => {
  const skill = '---\nname: share\ndescription: Share an update.\n---\n\n# Share\n';
  const rendered = renderUserOnlySkill(skill);
  assert.equal(
    rendered,
    '---\nname: share\ndescription: Share an update.\ndisable-model-invocation: true\n---\n\n# Share\n',
  );
  assert.equal(renderUserOnlySkill(rendered), rendered);
  assert.throws(() => renderUserOnlySkill('# No frontmatter\n'), /closed frontmatter/u);
});

test('a user-only Cursor rule omits its description so only a mention applies it', () => {
  const body = '# OpenPlanr Share\n\nBuild the update.\n';
  assert.equal(
    renderCursorRule({ description: 'Share an update.', body }),
    '---\ndescription: "Share an update."\nalwaysApply: false\n---\n\n# OpenPlanr Share\n\nBuild the update.\n',
  );
  assert.equal(
    renderCursorRule({ description: 'Share an update.', body, userOnly: true }),
    '---\nalwaysApply: false\n---\n\n# OpenPlanr Share\n\nShare an update.\n\nBuild the update.\n',
  );
});

test('plugin projections remove the duplicated planr prefix without changing canonical identity', () => {
  assert.equal(HOST_PLUGIN_NAME, 'planr');
  assert.equal(projectedSkillName('planr-design-review'), 'design-review');
  assert.equal(namespacedInvocation('planr-plan', 'codex'), '$planr:plan');
  assert.equal(namespacedInvocation('planr-plan', 'claude-code'), '/planr:plan');

  const projected = renderNamespacedSkill(
    '---\nname: planr-plan\ndescription: Plan work.\n---\n\nContinue with $planr-ship or /openplanr:planr-ship.\n',
    'planr-plan',
  );
  assert.match(projected, /^name: plan$/mu);
  assert.match(projected, /\$planr:ship or \/planr:ship/u);
  assert.doesNotMatch(projected, /openplanr:planr-|(?:\/|\$)planr-/u);
});

test('plugin projections reject identities outside the canonical planr namespace', () => {
  assert.throws(() => projectedSkillName('status'), /non-OpenPlanr skill identity/u);
  assert.throws(() => namespacedInvocation('planr-status', 'cursor'), /Unsupported/u);
});
