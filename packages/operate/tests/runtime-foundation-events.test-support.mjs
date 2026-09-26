import assert from 'node:assert/strict';

import { PipelineError } from '@openplanr/protocol/errors';

/** Runtime Event types each domain handler owns, as the Event reducer routes them. */
export const RUNTIME_EVENT_TYPES = Object.freeze({
  workflow: Object.freeze([
    'cycle.input-bound',
    'executive-board.materialized',
    'review.created',
    'review.submitted',
    'work-change-set.materialized',
    'action.authority-promoted',
    'action.approved',
    'action.rejected',
    'action.deferred',
    'action.reopened',
    'action.queued',
    'action.started',
    'action.completed',
    'action.blocked',
    'action.cancelled',
    'cycle.approved',
    'cycle.executing',
    'cycle.verifying',
    'cycle.closed',
  ]),
  evidenceState: Object.freeze([
    'evidence.resolved',
    'planning-delivery.ingested',
    'evidence.rejected',
    'snapshot.materialized',
    'operating-state.materialized',
    'metric.observed',
  ]),
  intelligence: Object.freeze([
    'claim.recorded',
    'finding.recorded',
    'risk.recorded',
    'assumption.recorded',
    'decision.revised',
    'delta.derived',
    'intelligence.plan-recorded',
    'decision-ledger.materialized',
    'verification.plan-recorded',
    'outcome.recorded',
    'learning.recorded',
    'scenario.recorded',
    'trigger.recorded',
  ]),
  authority: Object.freeze([
    'policy.evaluated',
    'approval.recorded',
    'capability.availability-recorded',
    'capability.granted',
    'rollback.plan-recorded',
    'operation.intent-recorded',
    'execution.result-recorded',
    'rollback.result-recorded',
  ]),
});

const ALL_RUNTIME_EVENT_TYPES = Object.values(RUNTIME_EVENT_TYPES).flat();

export const TIME = '2026-08-08T08:00:00.000Z';

/** Same shape as the runtime's own error factory. */
export function runtimeError(code, message, context = {}, retryable = false) {
  return new PipelineError(code, message, '', { retryable, context: structuredClone(context) });
}

export function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

/** Handler dependencies: the given overrides, and a throwing stub for every other name. */
export function handlerDependencies(overrides = {}) {
  return new Proxy(overrides, {
    get: (target, name) =>
      name in target
        ? target[name]
        : () => {
            throw new Error(`Unexpected runtime dependency ${String(name)}.`);
          },
  });
}

/** Asserts that a handler applies exactly the owned Event types and rejects every other type. */
export function assertHandlesExactly(apply, ownedTypes) {
  for (const type of ALL_RUNTIME_EVENT_TYPES) {
    const index = new Proxy({}, { get: (maps, name) => (maps[name] ??= new Map()) });
    const event = {
      type,
      eventId: 'evt_00000001',
      entityId: 'ent_00000001',
      cycleId: 'cyc_00000001',
      timestamp: TIME,
      actor: { kind: 'engine', id: 'openplanr' },
      payload: {},
    };
    let error = null;
    try {
      apply(index, event);
    } catch (caught) {
      error = caught;
    }
    const unsupported =
      error?.code === 'CONTRACT_VERSION_UNSUPPORTED' &&
      error.message === `Unsupported Phase 1 event ${type}.`;
    assert.equal(unsupported, !ownedTypes.includes(type), type);
  }
}
