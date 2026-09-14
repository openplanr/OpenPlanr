import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOST_PLUGIN_NAME,
  namespacedInvocation,
  projectedSkillName,
  renderNamespacedSkill,
} from '../../scripts/skills/host-invocations.mjs';

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
