import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createWorkflowRuntimeEventHandlerV2 } from '../lib/operate/runtime-foundation/workflow-events.mjs';
import {
  assertHandlesExactly,
  handlerDependencies,
  RUNTIME_EVENT_TYPES,
  runtimeError,
  TIME,
} from './runtime-foundation-events.test-support.mjs';

function boundCycleIndex() {
  return {
    cycles: new Map([
      [
        'cyc_00000001',
        {
          cycleId: 'cyc_00000001',
          scopeId: 'scope-acme',
          domainId: 'business',
          domainVersion: '1.0.0',
          inputBindingId: 'inb_00000001',
          contractVersions: { 'advisor-result': '1.0.0' },
        },
      ],
    ]),
    inputBindings: new Map([
      ['inb_00000001', { inputBindingId: 'inb_00000001', cycleId: 'cyc_00000001' }],
    ]),
  };
}

function inputBoundEvent(payload = {}) {
  return {
    type: 'cycle.input-bound',
    cycleId: 'cyc_00000001',
    entityId: 'inb_00000001',
    payload: {
      inputBindingId: 'inb_00000001',
      scopeId: 'scope-acme',
      domainId: 'business',
      domainVersion: '1.0.0',
      contractVersions: { 'advisor-result': '1.0.0' },
      ...payload,
    },
  };
}

function deferredActionIndex(action = {}) {
  return {
    actions: new Map([
      [
        'act_00000001',
        {
          actionId: 'act_00000001',
          sourceCycleId: 'cyc_00000001',
          revision: 2,
          actionHash: `sha256:${'d'.repeat(64)}`,
          state: 'deferred',
          ...action,
        },
      ],
    ]),
  };
}

function reopenedEvent(event = {}) {
  return {
    type: 'action.reopened',
    cycleId: 'cyc_00000001',
    entityId: 'act_00000001',
    timestamp: TIME,
    actor: { kind: 'engine', id: 'openplanr' },
    payload: {
      action: { actionId: 'act_00000001', revision: 2, actionHash: `sha256:${'d'.repeat(64)}` },
      from: 'deferred',
      to: 'proposed',
      operationId: null,
      resultId: null,
      reasonCode: null,
    },
    ...event,
  };
}

test('workflow handler applies exactly the Cycle, Review, board, work and Action Events', () => {
  assertHandlesExactly(
    createWorkflowRuntimeEventHandlerV2(handlerDependencies({ runtimeError })),
    RUNTIME_EVENT_TYPES.workflow,
  );
});

test('cycle.input-bound accepts only the durable Cycle binding and changes no state', () => {
  const apply = createWorkflowRuntimeEventHandlerV2(handlerDependencies({ runtimeError }));
  const index = boundCycleIndex();
  apply(index, inputBoundEvent());
  assert.deepEqual(index, boundCycleIndex());

  assert.throws(() => apply(index, inputBoundEvent({ scopeId: 'scope-other' })), {
    code: 'OPERATING_SCOPE_INVALID',
  });
  assert.throws(
    () => apply(index, inputBoundEvent({ contractVersions: { 'advisor-result': '2.0.0' } })),
    { code: 'OPERATING_SCOPE_INVALID' },
  );
  assert.throws(() => apply({ ...index, inputBindings: new Map() }, inputBoundEvent()), {
    code: 'CYCLE_NOT_FOUND',
  });
  assert.throws(() => apply(index, { ...inputBoundEvent(), entityId: 'inb_00000002' }), {
    code: 'STATE_TRANSITION_INVALID',
  });
});

test('action.reopened returns the exact deferred Action to proposed through its lifecycle', () => {
  const transitions = [];
  const apply = createWorkflowRuntimeEventHandlerV2(
    handlerDependencies({
      runtimeError,
      transitionOperatingActionLifecycleV2: (action, state, patch) => {
        transitions.push([action.actionId, action.state, state, patch]);
        return { ...action, state, ...patch };
      },
    }),
  );
  const index = deferredActionIndex();
  apply(index, reopenedEvent());
  assert.deepEqual(transitions, [['act_00000001', 'deferred', 'proposed', { updatedAt: TIME }]]);
  assert.equal(index.actions.get('act_00000001').state, 'proposed');

  assert.throws(
    () => apply(deferredActionIndex(), reopenedEvent({ actor: { kind: 'user', id: 'founder' } })),
    { code: 'CAPABILITY_DENIED' },
  );
  assert.throws(() => apply(deferredActionIndex({ revision: 3 }), reopenedEvent()), {
    code: 'ACTION_REVISION_MISMATCH',
  });
  assert.equal(transitions.length, 1);
});
