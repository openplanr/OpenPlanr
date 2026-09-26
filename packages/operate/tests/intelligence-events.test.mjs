import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createIntelligenceRuntimeEventHandlerV2 } from '../lib/operate/runtime-foundation/intelligence-events.mjs';
import {
  assertHandlesExactly,
  handlerDependencies,
  RUNTIME_EVENT_TYPES,
  runtimeError,
  TIME,
} from './runtime-foundation-events.test-support.mjs';

function planIndex() {
  return {
    cycles: new Map([
      [
        'cyc_00000001',
        {
          cycleId: 'cyc_00000001',
          scopeId: 'scope-acme',
          domainId: 'business',
          domainVersion: '1.0.0',
        },
      ],
    ]),
    operatingSnapshots: new Map([['snp_00000001', { snapshotId: 'snp_00000001' }]]),
    deltas: new Map([
      [
        'dlt_00000001',
        {
          deltaId: 'dlt_00000001',
          currentSnapshotId: 'snp_00000001',
          sourceArtifactId: 'art_00000002',
        },
      ],
    ]),
    intelligencePlans: new Map(),
  };
}

function planEvent(event = {}) {
  return {
    type: 'intelligence.plan-recorded',
    cycleId: 'cyc_00000001',
    entityId: 'ipl_00000001',
    timestamp: TIME,
    actor: { kind: 'runtime', id: 'openplanr' },
    payload: {
      planId: 'ipl_00000001',
      scopeId: 'scope-acme',
      domainId: 'business',
      domainVersion: '1.0.0',
      snapshotId: 'snp_00000001',
      deltaId: 'dlt_00000001',
      sourceArtifactId: 'art_00000002',
      createdAt: TIME,
    },
    ...event,
  };
}

test('intelligence handler applies exactly the intelligence record Events', () => {
  assertHandlesExactly(
    createIntelligenceRuntimeEventHandlerV2(handlerDependencies({ runtimeError })),
    RUNTIME_EVENT_TYPES.intelligence,
  );
});

test('intelligence.plan-recorded binds one new runtime plan to its Cycle, snapshot and Delta', () => {
  const apply = createIntelligenceRuntimeEventHandlerV2(handlerDependencies({ runtimeError }));
  const rejected = (index, event) => {
    assert.throws(
      () => apply(index, event),
      (error) => {
        assert.equal(error.code, 'STATE_TRANSITION_INVALID');
        assert.deepEqual(error.details.context, {
          planId: 'ipl_00000001',
          cycleId: 'cyc_00000001',
        });
        return true;
      },
    );
  };
  rejected(planIndex(), planEvent({ actor: { kind: 'engine', id: 'openplanr' } }));
  rejected(planIndex(), planEvent({ timestamp: '2026-08-08T08:01:00.000Z' }));
  const unboundDelta = planIndex();
  unboundDelta.deltas.get('dlt_00000001').currentSnapshotId = 'snp_00000002';
  rejected(unboundDelta, planEvent());
  const recorded = planIndex();
  recorded.intelligencePlans.set('ipl_00000001', planEvent().payload);
  rejected(recorded, planEvent());
});

test('trigger.recorded checks the runtime actor first and requires its Event snapshot', () => {
  const calls = [];
  const apply = createIntelligenceRuntimeEventHandlerV2(
    handlerDependencies({
      runtimeError,
      requireRuntimeIntelligenceActor: (event) => {
        calls.push(event.actor.kind);
        if (event.actor.kind !== 'runtime') throw runtimeError('CAPABILITY_DENIED', 'runtime only');
      },
      intelligenceEventRecord: () => ({
        snapshot: { snapshotId: 'snp_00000001' },
        operatingState: {},
        record: { triggerId: 'trg_00000001', snapshotId: 'snp_00000002' },
      }),
    }),
  );
  const event = { type: 'trigger.recorded', actor: { kind: 'runtime', id: 'openplanr' } };
  assert.throws(() => apply({}, { ...event, actor: { kind: 'user', id: 'founder' } }), {
    code: 'CAPABILITY_DENIED',
  });
  assert.throws(
    () => apply({}, event),
    (error) =>
      error.code === 'STATE_TRANSITION_INVALID' &&
      error.details.context.triggerId === 'trg_00000001',
  );
  assert.deepEqual(calls, ['user', 'runtime']);
});
