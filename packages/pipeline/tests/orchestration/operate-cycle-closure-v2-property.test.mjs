import assert from 'node:assert/strict';
import test from 'node:test';

import {
  closeCycleWithCarriedWorkV2,
  closeVerifiedOperatingCycleV2,
} from '../../lib/operate/cycle-closure-v2.mjs';

const TIME = '2026-08-08T11:00:00.000Z';
const cycle = Object.freeze({
  cycleId: 'cyc_00000001',
  scopeId: 'scope-acme',
  domainId: 'business',
  domainVersion: '1.0.0',
  state: 'awaiting_review',
  health: 'normal',
  activeReviewId: 'rev_00000001',
});
const finding = Object.freeze({
  findingId: 'fnd_00000001',
  sourceCycleId: cycle.cycleId,
  scopeId: cycle.scopeId,
  domainId: cycle.domainId,
  domainVersion: cycle.domainVersion,
  state: 'open',
  updatedAt: TIME,
});

test('closure property: every unresolved source item is explicitly accounted for and retained', () => {
  for (const workDispositions of [
    [],
    [{ entityType: 'operating-finding', entityId: finding.findingId, disposition: 'deferred' }],
  ]) {
    if (workDispositions.length === 0) {
      assert.throws(
        () =>
          closeCycleWithCarriedWorkV2({
            cycle,
            findings: [finding],
            decisions: [],
            actions: [],
            workDispositions,
            timestamp: TIME,
          }),
        {
          code: 'STATE_TRANSITION_INVALID',
        },
      );
      continue;
    }
    const result = closeCycleWithCarriedWorkV2({
      cycle,
      findings: [finding],
      decisions: [],
      actions: [],
      workDispositions,
      timestamp: TIME,
    });
    assert.equal(result.cycle.state, 'closed');
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].state, 'deferred');
  }
});

test('verification closure property: active execution never disappears and only blocked/deferred work carries', () => {
  const verifying = { ...cycle, state: 'verifying', activeReviewId: null };
  for (const state of ['queued', 'in_progress', 'completed', 'blocked', 'deferred', 'cancelled']) {
    const action = {
      actionId: `act_property_${state}`,
      sourceCycleId: cycle.cycleId,
      scopeId: cycle.scopeId,
      domainId: cycle.domainId,
      domainVersion: cycle.domainVersion,
      state,
      verificationPlanId: `vfy_property_${state}`,
    };
    const carriedActionIds = ['blocked', 'deferred'].includes(state) ? [action.actionId] : [];
    const close = () =>
      closeVerifiedOperatingCycleV2({
        cycle: verifying,
        actions: [action],
        verificationPlans: [],
        governedOperations: [],
        executionResults: [],
        rollbackResults: [],
        verificationAssignments: [],
        verificationFeedback: [],
        carriedActionIds,
        timestamp: TIME,
      });
    if (!['blocked', 'deferred'].includes(state))
      assert.throws(close, { code: 'STATE_TRANSITION_INVALID' });
    else {
      const result = close();
      assert.equal(result.actions[0].state, state);
      assert.deepEqual(result.carriedActionIds, carriedActionIds);
    }
  }
});
