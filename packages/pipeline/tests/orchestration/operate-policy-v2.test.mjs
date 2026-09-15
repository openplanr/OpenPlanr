import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertOperatingPolicyEvaluationV2,
  createOperatingActionPolicyV2,
  evaluateOperatingActionPolicyV2,
} from '../../lib/operate/policy-v2.mjs';
import { assertProtocolArtifact } from '../../lib/protocol/contracts.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

const fixture = JSON.parse(readFileSync(new URL(
  '../../conformance/fixtures/operating-runtime-v2/authorization-valid.json', import.meta.url,
), 'utf8'));
const clone = (value) => structuredClone(value);
const HASH = `sha256:${'a'.repeat(64)}`;

function action(effectClass = 'project-write') {
  const value = clone(fixture.action);
  value.state = 'proposed';
  value.effectClass = effectClass;
  value.executionBinding = {
    policyId: 'domain-action-policy', policyVersion: '1.0.0',
    rollbackRequired: effectClass !== 'read-only', verificationRequired: true,
  };
  return value;
}

function policy(value, {
  tier,
  decisionMode,
  effectClasses = ['project-write'],
  targetKinds = ['project-record'],
  approvalRequirementIds = [],
  rollbackRequired = true,
} = {}) {
  return createOperatingActionPolicyV2({
    policyId: `${tier}-action-policy`, policyVersion: '1.0.0', domainId: value.domainId,
    actionKind: value.actionKind, capability: value.requestedCapability,
    effectClasses, targetKinds, decisionMode, approvalRequirementIds,
    rollbackRequired, verificationRequired: true, tier,
    provenance: { providerId: `${tier}-policy-provider`, providerVersion: '1.0.0', sourceHash: HASH },
  });
}

test('versioned policy evaluation is deterministic and applies core, project, then narrowing domain policy', () => {
  const value = action();
  const policies = [
    policy(value, { tier: 'core', decisionMode: 'automatic', effectClasses: ['project-write', 'read-only'], targetKinds: ['project-record', 'project-view'] }),
    policy(value, { tier: 'project', decisionMode: 'named-single-party', approvalRequirementIds: ['aprq_project01'] }),
    policy(value, { tier: 'domain', decisionMode: 'threshold', approvalRequirementIds: ['aprq_domain001'] }),
  ];
  const input = {
    action: value, configuredPolicies: policies, evaluatedAt: '2026-08-10T08:00:00Z',
  };
  const first = evaluateOperatingActionPolicyV2(input);
  const second = evaluateOperatingActionPolicyV2({ ...clone(input), configuredPolicies: [...clone(policies)].reverse() });
  assert.deepEqual(second, first);
  assert.equal(first.outcome, 'threshold');
  assert.deepEqual(first.appliedPolicyRefs.map(({ policyId }) => policyId), [
    'core-action-policy', 'project-action-policy', 'domain-action-policy',
  ]);
  assert.equal(first.policy.policyId, value.executionBinding.policyId);
  assert.equal(first.inputHash, sha256Jcs({
    action: { actionId: value.actionId, revision: value.revision, actionHash: value.actionHash },
    scopeId: value.scopeId, domainId: value.domainId, domainVersion: value.domainVersion,
    capability: value.requestedCapability, target: value.targetBinding, effectClass: value.effectClass,
    appliedPolicyRefs: first.appliedPolicyRefs,
  }));
  assert.deepEqual(assertOperatingPolicyEvaluationV2(first, input), first);
  assert.doesNotThrow(() => assertProtocolArtifact('operating-policy-evaluation', first, { protocolVersion: '2.0.0' }));
});

test('lower policy cannot weaken, relabel, omit, or broaden higher policy authority', () => {
  const value = action();
  const core = policy(value, { tier: 'core', decisionMode: 'named-single-party', approvalRequirementIds: ['aprq_core0001'] });
  const widened = policy(value, { tier: 'domain', decisionMode: 'automatic' });
  assert.throws(() => evaluateOperatingActionPolicyV2({
    action: value, configuredPolicies: [core, widened], evaluatedAt: '2026-08-10T08:00:00Z',
  }), ({ code }) => code === 'POLICY_EVALUATION_REJECTED');
  const project = policy(value, { tier: 'project', decisionMode: 'named-single-party', approvalRequirementIds: ['aprq_project01'] });
  const effective = policy(value, { tier: 'domain', decisionMode: 'named-single-party', approvalRequirementIds: ['aprq_domain001'] });
  const omitted = evaluateOperatingActionPolicyV2({
    action: value, configuredPolicies: [core, effective], evaluatedAt: '2026-08-10T08:00:00Z',
  });
  assert.throws(() => assertOperatingPolicyEvaluationV2(omitted, {
    action: value, configuredPolicies: [core, project, effective],
  }), ({ code }) => code === 'POLICY_EVALUATION_REJECTED');
});

test('configured applicability requires core and rejects ambiguous or omitted applicable tiers', () => {
  const value = action();
  const core = policy(value, { tier: 'core', decisionMode: 'automatic' });
  const project = policy(value, {
    tier: 'project', decisionMode: 'named-single-party', approvalRequirementIds: ['aprq_project01'],
  });
  const domain = policy(value, {
    tier: 'domain', decisionMode: 'named-single-party', approvalRequirementIds: ['aprq_domain001'],
  });
  assert.throws(() => evaluateOperatingActionPolicyV2({
    action: value, configuredPolicies: [domain], evaluatedAt: '2026-08-10T08:00:00Z',
  }), ({ code }) => code === 'POLICY_EVALUATION_REJECTED');
  const omitted = evaluateOperatingActionPolicyV2({
    action: value, configuredPolicies: [core, domain], evaluatedAt: '2026-08-10T08:00:00Z',
  });
  assert.throws(() => assertOperatingPolicyEvaluationV2(omitted, {
    action: value, configuredPolicies: [core, project, domain],
  }), ({ code }) => code === 'POLICY_EVALUATION_REJECTED');
  const competingDomain = createOperatingActionPolicyV2({
    ...clone(domain), policyId: 'second-domain-policy',
  });
  assert.throws(() => evaluateOperatingActionPolicyV2({
    action: value, configuredPolicies: [core, domain, competingDomain], evaluatedAt: '2026-08-10T08:00:00Z',
  }), ({ code }) => code === 'POLICY_EVALUATION_REJECTED');
});

test('reference hard prohibitions are non-overridable and durable-safe', () => {
  for (const [field, identifier, effectClass] of [
    ['actionKind', 'funds-transfer', 'external-effect'],
    ['requestedCapability', 'secret-mutation', 'external-effect'],
    ['targetBinding', 'production-deploy', 'external-effect'],
    ['effectClass', 'destructive', 'destructive'],
  ]) {
    const value = action(effectClass);
    if (field === 'actionKind') value.actionKind.id = identifier;
    if (field === 'requestedCapability') value.requestedCapability.id = identifier;
    if (field === 'targetBinding') value.targetBinding.kind = identifier;
    value.executionBinding = {
      policyId: 'core-action-policy', policyVersion: '1.0.0',
      rollbackRequired: true, verificationRequired: true,
    };
    const core = policy(value, {
      tier: 'core', decisionMode: 'prohibited', effectClasses: [effectClass], targetKinds: [value.targetBinding.kind],
    });
    const evaluation = evaluateOperatingActionPolicyV2({ action: value, configuredPolicies: [core], evaluatedAt: '2026-08-10T08:00:00Z' });
    assert.equal(evaluation.outcome, 'prohibited', identifier);
  assert.equal(
    evaluation.reasonCodes.some((reasonCode) => reasonCode.startsWith('core-prohibition-')),
    true,
  );
    const weak = policy(value, {
      tier: 'domain', decisionMode: 'automatic', effectClasses: [effectClass], targetKinds: [value.targetBinding.kind],
    });
    assert.throws(() => evaluateOperatingActionPolicyV2({
      action: value, configuredPolicies: [core, weak], evaluatedAt: '2026-08-10T08:00:00Z',
    }), ({ code }) => code === 'POLICY_EVALUATION_REJECTED');
  }
});

export { action, policy };
