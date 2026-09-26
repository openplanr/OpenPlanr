import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAuthorityRuntimeEventHandlerV2 } from '../lib/operate/runtime-foundation/authority-events.mjs';
import {
  assertHandlesExactly,
  clone,
  handlerDependencies,
  RUNTIME_EVENT_TYPES,
  runtimeError,
  TIME,
} from './runtime-foundation-events.test-support.mjs';

function availability() {
  return {
    availabilityId: 'cav_00000001',
    capabilityId: 'operate-action-execute',
    checkedAt: TIME,
    availabilityHash: `sha256:${'c'.repeat(64)}`,
  };
}

function availabilityEvent(event = {}) {
  return {
    type: 'capability.availability-recorded',
    cycleId: 'cyc_00000001',
    entityId: 'cav_00000001',
    timestamp: TIME,
    actor: { kind: 'runtime', id: 'openplanr' },
    payload: availability(),
    ...event,
  };
}

function authorityIndex(index = {}) {
  return { authorityHistoryEnabled: true, capabilityAvailability: new Map(), ...index };
}

test('authority handler applies exactly the policy, approval, capability, operation and rollback Events', () => {
  assertHandlesExactly(
    createAuthorityRuntimeEventHandlerV2(handlerDependencies({ runtimeError })),
    RUNTIME_EVENT_TYPES.authority,
  );
});

test('capability.availability-recorded stores one fresh hash-checked runtime observation', () => {
  const hashChecks = [];
  const apply = createAuthorityRuntimeEventHandlerV2(
    handlerDependencies({
      runtimeError,
      clone,
      assertCanonicalRecordHash: (...check) => hashChecks.push(check),
    }),
  );
  const index = authorityIndex();
  const event = availabilityEvent();
  apply(index, event);
  assert.deepEqual(hashChecks, [
    [
      availability(),
      'availabilityHash',
      'CAPABILITY_UNAVAILABLE',
      'Capability availability cav_00000001',
    ],
  ]);
  assert.deepEqual(index.capabilityAvailability.get('cav_00000001'), availability());
  assert.notEqual(index.capabilityAvailability.get('cav_00000001'), event.payload);

  assert.throws(() => apply(index, availabilityEvent()), { code: 'CAPABILITY_UNAVAILABLE' });
  assert.throws(
    () => apply(authorityIndex(), availabilityEvent({ actor: { kind: 'user', id: 'founder' } })),
    { code: 'CAPABILITY_UNAVAILABLE' },
  );
  assert.throws(
    () => apply(authorityIndex({ authorityHistoryEnabled: false }), availabilityEvent()),
    { code: 'CAPABILITY_UNAVAILABLE' },
  );
  assert.equal(hashChecks.length, 1);
});

test('approval.recorded requires the current evaluation, Action and requirement', () => {
  const apply = createAuthorityRuntimeEventHandlerV2(handlerDependencies({ runtimeError }));
  const index = {
    policyEvaluations: new Map(),
    actions: new Map(),
    approvalRequirements: new Map(),
  };
  assert.throws(
    () =>
      apply(index, {
        type: 'approval.recorded',
        entityId: 'apr_00000001',
        payload: {
          approvalId: 'apr_00000001',
          evaluationId: 'pev_00000001',
          requirementId: 'arq_00000001',
          action: { actionId: 'act_00000001' },
        },
      }),
    (error) =>
      error.code === 'APPROVAL_INVALID' && error.details.context.approvalId === 'apr_00000001',
  );
});
