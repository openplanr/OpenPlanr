import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateOperatingActionPolicyV2 } from '../../lib/operate/policy-v2.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import { action, policy } from './operate-policy-v2.test.mjs';

const MODES = ['automatic', 'named-single-party', 'threshold', 'named-multi-party', 'deferred', 'rejected', 'prohibited'];
const RANK = new Map(MODES.map((mode, index) => [mode, index]));

function requirement(mode, seed) {
  return ['named-single-party', 'threshold', 'named-multi-party'].includes(mode) ? [`aprq_prop${String(seed).padStart(4, '0')}`] : [];
}

test('policy precedence property: 512 deterministic narrowing vectors never widen a higher tier', () => {
  for (let seed = 0; seed < 512; seed += 1) {
    const value = action();
    const coreMode = MODES[seed % MODES.length];
    const domainMode = MODES[(seed * 5 + 1) % MODES.length];
    const core = policy(value, { tier: 'core', decisionMode: coreMode, approvalRequirementIds: requirement(coreMode, seed) });
    const domain = policy(value, { tier: 'domain', decisionMode: domainMode, approvalRequirementIds: requirement(domainMode, seed + 600) });
    const before = sha256Jcs({ value, core, domain });
    if (RANK.get(domainMode) < RANK.get(coreMode)) {
      assert.throws(() => evaluateOperatingActionPolicyV2({
        action: value, configuredPolicies: [domain, core], evaluatedAt: '2026-08-10T08:00:00Z',
      }), ({ code }) => code === 'POLICY_EVALUATION_REJECTED', `seed ${seed}`);
    } else {
      const result = evaluateOperatingActionPolicyV2({
        action: value, configuredPolicies: [domain, core], evaluatedAt: '2026-08-10T08:00:00Z',
      });
      assert.equal(result.outcome, domainMode, `seed ${seed}`);
    }
    assert.equal(sha256Jcs({ value, core, domain }), before, `seed ${seed}: pure`);
  }
});

test('all six effect classes have an explicit deterministic outcome', () => {
  for (const effectClass of ['read-only', 'machine-local-write', 'project-write', 'provider-call', 'external-effect', 'destructive']) {
    const value = action(effectClass);
    value.executionBinding.policyId = 'core-action-policy';
    value.executionBinding.rollbackRequired = effectClass !== 'read-only';
    const mode = effectClass === 'destructive' ? 'prohibited' : 'automatic';
    const core = policy(value, {
      tier: 'core', decisionMode: mode, effectClasses: [effectClass],
      rollbackRequired: effectClass !== 'read-only',
    });
    assert.equal(evaluateOperatingActionPolicyV2({
      action: value, configuredPolicies: [core], evaluatedAt: '2026-08-10T08:00:00Z',
    }).outcome, mode);
  }
});
