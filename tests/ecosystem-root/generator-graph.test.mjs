import assert from 'node:assert/strict';
import test from 'node:test';

import { GENERATOR_STEPS, resolveGeneratorPlan } from '../../scripts/generate-all.mjs';

const expectedOrder = [
  'skill-role-host-adapters',
  'protocol-catalogs',
  'protocol-public-projection',
  'dashboard-contracts',
  'artifact-shell',
  'diagram-assets',
  'operate-artifact-design-public-projections',
  'operate-contracts-and-custody',
  'landing-workflow-custody',
  'dashboard-package-assets',
  'ecosystem-marketplace',
];

test('the consolidated generator graph has one deterministic bounded order', () => {
  assert.deepEqual(
    GENERATOR_STEPS.map(({ id }) => id),
    expectedOrder,
  );
  for (const step of GENERATOR_STEPS) {
    assert.ok(step.candidates.length > 0, step.id);
    for (const candidate of step.candidates) {
      for (const mode of ['write', 'check']) {
        assert.match(candidate[mode].script, /\.mjs$/u);
        assert.ok(Array.isArray(candidate[mode].arguments));
        assert.ok(candidate[mode].arguments.every((argument) => typeof argument === 'string'));
      }
    }
  }
});

test('check plan selects the isolated dashboard verifier, never the write-mode build script', () => {
  const plan = resolveGeneratorPlan('check');
  assert.deepEqual(
    plan.map(({ id }) => id),
    expectedOrder,
  );
  for (const step of plan.filter(({ status }) => status === 'run')) {
    assert.ok(
      step.arguments.includes('--check'),
      `${step.id} must receive an explicit check contract`,
    );
    assert.doesNotMatch(step.script, /build-dashboard-assets/u);
  }
  const dashboard = plan.find(({ id }) => id === 'dashboard-package-assets');
  assert.equal(dashboard.script, 'scripts/dashboard/check-dashboard-assets.mjs');
});

test('write plan selects the canonical dashboard build-and-copy boundary', () => {
  const dashboard = resolveGeneratorPlan('write').find(
    ({ id }) => id === 'dashboard-package-assets',
  );
  assert.equal(dashboard.status, 'run');
  assert.equal(dashboard.script, 'scripts/dashboard/build-dashboard-assets.mjs');
});
