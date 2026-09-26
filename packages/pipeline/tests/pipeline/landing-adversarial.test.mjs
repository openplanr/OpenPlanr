import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test as nodeTest } from 'node:test';

import {
  advanceLanding,
  createLandingOwnerRuntimeHost,
  prepareLanding,
} from '../../lib/pipeline/index.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import {
  hasRealOwnerTerminal,
  isDirectTestModule,
  runTestFileInOwnerPty,
} from './helpers/landing-owner-pty.mjs';
import { landingFixture, memoryHost } from './landing.test.mjs';

const operating = JSON.parse(
  readFileSync(
    new URL(
      '../../conformance/fixtures/operating-runtime-v2/all-contracts-valid.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const digest = (value) => sha256Jcs(value);
const errorCode = (code) => (error) => error?.code === code;
const recordRef = (contractId, record, recordId) => ({
  contractId,
  schemaVersion: record.schemaVersion,
  protocolVersion: record.protocolVersion,
  recordId,
  recordDigest: digest(record),
});
const fixture = landingFixture();
const directTestModule = isDirectTestModule(import.meta.url);
const ownerPtyChild = process.env.PLANR_LANDING_OWNER_PTY_CHILD === '1' && hasRealOwnerTerminal();

function exactTestPattern(name) {
  return `^${name.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`;
}

function ownerTest(name, choices, callback) {
  if (!directTestModule) return;
  if (ownerPtyChild) {
    nodeTest(name, callback);
    return;
  }
  nodeTest(name, async () => {
    const result = await runTestFileInOwnerPty(new URL(import.meta.url), {
      choices,
      env: { PLANR_LANDING_OWNER_PTY_CHILD: '1' },
      testNamePattern: exactTestPattern(name),
    });
    assert.equal(result.answeredOwnerPrompts, choices.length);
    assert.equal(result.answeredChoicePrompts, choices.length);
  });
}

function directTest(name, callback) {
  if (directTestModule && !ownerPtyChild) nodeTest(name, callback);
}

function snapshot(plan, state = {}) {
  const events = structuredClone(state.events ?? []);
  return {
    candidateDigest: plan.candidateDigest,
    repositoryHeads: plan.repositories.map(({ repositoryKey, head }) => ({ repositoryKey, head })),
    targetStateHash: state.targetStateHash ?? plan.currentTargetHash,
    events,
    journalHead: { sequence: events.at(-1)?.sequence ?? 0, hash: events.at(-1)?.eventHash ?? null },
    landingReceipt: null,
    pendingIntent: state.pendingIntent ?? null,
    phaseReceiptHeadHash: null,
    phaseReceipts: [],
    confirmations: [],
    evidenceRecordsByOperation: {},
    evidenceContextsByOperation: {},
    startedAt: null,
  };
}

ownerTest(
  'cloned host and non-durable intent acknowledgement fail before dispatch',
  ['confirm'],
  async () => {
    const trusted = memoryHost(fixture.plan);
    await assert.rejects(
      advanceLanding({
        host: structuredClone(trusted.host),
        plan: fixture.plan,
        operationId: fixture.operation.operationId,
        now: '2026-08-25T10:00:00.000Z',
      }),
      errorCode('E_LANDING_OWNER_HOST_REQUIRED'),
    );
    assert.equal(trusted.state.dispatches, 0);

    let dispatches = 0;
    const host = createLandingOwnerRuntimeHost({
      snapshot: async () => snapshot(fixture.plan),
      commitIntent: async (request) => ({
        commitId: 'forged-commit',
        dispatcherId: 'forged-dispatcher',
        committedAt: '2026-08-25T10:00:00.001Z',
        journalHead: {
          sequence: request.events.at(-1).sequence,
          hash: request.events.at(-1).eventHash,
        },
      }),
      dispatch: async () => {
        dispatches += 1;
      },
      reconcile: async () => {
        throw new Error('unreachable');
      },
      commitOutcome: async () => {
        throw new Error('unreachable');
      },
    });
    await assert.rejects(
      advanceLanding({
        host,
        plan: fixture.plan,
        operationId: fixture.operation.operationId,
        now: '2026-08-25T10:00:00.000Z',
      }),
      errorCode('E_LANDING_CONCURRENT_MODIFICATION'),
    );
    assert.equal(dispatches, 0, 'a JSON acknowledgement cannot replace durable recapture');
  },
);

ownerTest(
  'ack loss, reconciliation failure, and outcome CAS restart never redispatch',
  ['confirm', 'confirm', 'confirm', 'confirm', 'confirm'],
  async () => {
    const reconciledResult = {
      status: 'succeeded',
      targetAfterHash: digest('target-after-reconciled'),
      completedAt: '2026-08-25T10:00:00.002Z',
      evidenceRecords: [],
      evidenceContexts: {},
      canary: null,
      containment: null,
      recovery: null,
    };
    const reconciled = memoryHost(fixture.plan, {
      dispatchThrows: true,
      reconcileResult: reconciledResult,
    });
    const result = await advanceLanding({
      host: reconciled.host,
      plan: fixture.plan,
      operationId: fixture.operation.operationId,
      now: '2026-08-25T10:00:00.000Z',
    });
    assert.equal(result.landingReceipt.status, 'landed');
    assert.equal(reconciled.state.dispatches, 1);
    assert.equal(reconciled.state.reconciliations, 1);

    const unresolved = memoryHost(fixture.plan, { dispatchThrows: true });
    await assert.rejects(
      advanceLanding({
        host: unresolved.host,
        plan: fixture.plan,
        operationId: fixture.operation.operationId,
        now: '2026-08-25T10:00:00.000Z',
      }),
      errorCode('E_LANDING_RECONCILIATION_PENDING'),
    );
    assert.equal(unresolved.state.dispatches, 1);
    assert.equal(unresolved.state.reconciliations, 1);
    assert.notEqual(unresolved.state.pendingIntent, null);

    const unknownRestart = memoryHost(fixture.plan, {
      state: unresolved.state,
      reconcileResult: {
        disposition: 'unknown',
        targetAfterHash: null,
        completedAt: '2026-08-25T10:00:00.002Z',
      },
    });
    const uncertain = await advanceLanding({
      host: unknownRestart.host,
      plan: fixture.plan,
      operationId: fixture.operation.operationId,
      now: '2026-08-25T10:20:00.000Z',
    });
    assert.equal(uncertain.state, 'uncertain');
    assert.equal(uncertain.phaseReceipt.status, 'uncertain');
    assert.equal(uncertain.landingReceipt.status, 'uncertain');
    assert.equal(unknownRestart.state.dispatches, 1);
    assert.equal(unknownRestart.state.reconciliations, 2);
    assert.equal(unknownRestart.state.pendingIntent, null);

    const unacknowledged = memoryHost(fixture.plan, {
      outcomeCommitThrows: true,
      exposeEffectTarget: true,
    });
    await assert.rejects(
      advanceLanding({
        host: unacknowledged.host,
        plan: fixture.plan,
        operationId: fixture.operation.operationId,
        now: '2026-08-25T10:00:00.000Z',
      }),
      errorCode('E_LANDING_OUTCOME_NOT_PERSISTED'),
    );
    assert.equal(unacknowledged.state.dispatches, 1);
    assert.equal(unacknowledged.state.reconciliations, 0);
    assert.notEqual(unacknowledged.state.pendingIntent, null);
    const durableAttemptIdentity = unacknowledged.state.pendingIntent.attemptIdentity;
    const durableConfirmationHash =
      unacknowledged.state.pendingIntent.confirmation.confirmationHash;

    const restarted = memoryHost(fixture.plan, {
      state: unacknowledged.state,
      reconcileResult: reconciledResult,
    });
    const resumed = await advanceLanding({
      host: restarted.host,
      plan: fixture.plan,
      operationId: fixture.operation.operationId,
      now: '2026-08-25T10:20:00.000Z',
    });
    assert.equal(resumed.state, 'completed');
    assert.equal(resumed.landingReceipt.status, 'landed');
    assert.equal(restarted.state.dispatches, 1, 'restart must not issue a second effect');
    assert.equal(restarted.state.reconciliations, 1);
    assert.equal(restarted.state.intentCommits, 1, 'restart must not persist a second intent');
    assert.equal(restarted.state.pendingIntent, null);
    assert.equal(resumed.phaseReceipt.attemptIdentity, durableAttemptIdentity);
    assert.equal(resumed.phaseReceipt.confirmation.confirmationHash, durableConfirmationHash);

    const lostOutcomeAck = memoryHost(fixture.plan, { outcomeCommitAckThrows: true });
    const replayed = await advanceLanding({
      host: lostOutcomeAck.host,
      plan: fixture.plan,
      operationId: fixture.operation.operationId,
      now: '2026-08-25T10:00:00.000Z',
    });
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.landingReceipt.status, 'landed');
    const replayedAgain = await advanceLanding({
      host: lostOutcomeAck.host,
      plan: fixture.plan,
      operationId: fixture.operation.operationId,
      now: '2026-08-25T10:30:00.000Z',
    });
    assert.equal(replayedAgain.landingReceipt.receiptHash, replayed.landingReceipt.receiptHash);
    assert.equal(lostOutcomeAck.state.dispatches, 1);
    assert.equal(lostOutcomeAck.state.reconciliations, 0);

    const pendingRace = memoryHost(fixture.plan, {
      outcomeCommitThrows: true,
      exposeEffectTarget: true,
    });
    await assert.rejects(
      advanceLanding({
        host: pendingRace.host,
        plan: fixture.plan,
        operationId: fixture.operation.operationId,
        now: '2026-08-25T10:00:00.000Z',
      }),
      errorCode('E_LANDING_OUTCOME_NOT_PERSISTED'),
    );
    const raceLeft = memoryHost(fixture.plan, {
      state: pendingRace.state,
      reconcileResult: reconciledResult,
    });
    const raceRight = memoryHost(fixture.plan, {
      state: pendingRace.state,
      reconcileResult: reconciledResult,
    });
    const raceResults = await Promise.all([
      advanceLanding({
        host: raceLeft.host,
        plan: fixture.plan,
        operationId: fixture.operation.operationId,
        now: '2026-08-25T10:20:00.000Z',
      }),
      advanceLanding({
        host: raceRight.host,
        plan: fixture.plan,
        operationId: fixture.operation.operationId,
        now: '2026-08-25T10:20:00.000Z',
      }),
    ]);
    assert.equal(
      raceResults[0].landingReceipt.receiptHash,
      raceResults[1].landingReceipt.receiptHash,
    );
    assert.equal(pendingRace.state.dispatches, 1, 'concurrent restarters must never redispatch');
    assert.equal(pendingRace.state.intentCommits, 1);
  },
);

ownerTest(
  'cancel and concurrent advance remain zero-or-one effect',
  ['cancel', 'confirm'],
  async () => {
    const cancelled = memoryHost(fixture.plan, { cancel: true });
    const result = await advanceLanding({
      host: cancelled.host,
      plan: fixture.plan,
      operationId: fixture.operation.operationId,
      now: '2026-08-25T10:00:00.000Z',
    });
    assert.equal(result.status, 'cancelled');
    assert.equal(cancelled.state.dispatches, 0);
    assert.deepEqual(cancelled.state.events, []);

    const concurrent = memoryHost(fixture.plan);
    const calls = await Promise.allSettled(
      [1, 2].map(() =>
        advanceLanding({
          host: concurrent.host,
          plan: fixture.plan,
          operationId: fixture.operation.operationId,
          now: '2026-08-25T10:00:00.000Z',
        }),
      ),
    );
    assert.equal(calls.filter(({ status }) => status === 'fulfilled').length, 1);
    assert.equal(concurrent.state.dispatches, 1);
  },
);

ownerTest(
  'pending intent self-binding and operation identity reject before reconciliation',
  ['confirm'],
  async () => {
    const pending = memoryHost(fixture.plan, { outcomeCommitThrows: true });
    await assert.rejects(
      advanceLanding({
        host: pending.host,
        plan: fixture.plan,
        operationId: fixture.operation.operationId,
        now: '2026-08-25T10:00:00.000Z',
      }),
      errorCode('E_LANDING_OUTCOME_NOT_PERSISTED'),
    );

    const corruptedState = structuredClone(pending.state);
    corruptedState.pendingIntent.requestHash = digest('tampered-pending-request');
    const corrupted = memoryHost(fixture.plan, {
      state: corruptedState,
      reconcileResult: {
        disposition: 'unknown',
        targetAfterHash: null,
        completedAt: '2026-08-25T10:00:00.002Z',
      },
    });
    await assert.rejects(
      advanceLanding({
        host: corrupted.host,
        plan: fixture.plan,
        operationId: fixture.operation.operationId,
        now: '2026-08-25T10:20:00.000Z',
      }),
      errorCode('E_LANDING_CUSTODY_INVALID'),
    );
    assert.equal(corrupted.state.reconciliations, 0);

    const wrongOperation = memoryHost(fixture.plan, {
      state: structuredClone(pending.state),
      reconcileResult: {
        disposition: 'unknown',
        targetAfterHash: null,
        completedAt: '2026-08-25T10:00:00.002Z',
      },
    });
    await assert.rejects(
      advanceLanding({
        host: wrongOperation.host,
        plan: fixture.plan,
        operationId: `lop_${'9'.repeat(32)}`,
        now: '2026-08-25T10:20:00.000Z',
      }),
      errorCode('E_LANDING_TRANSITION_INVALID'),
    );
    assert.equal(wrongOperation.state.reconciliations, 0);

    const missing = structuredClone(pending.state);
    missing.pendingIntent = null;
    const missingIntent = memoryHost(fixture.plan, { state: missing });
    await assert.rejects(
      advanceLanding({
        host: missingIntent.host,
        plan: fixture.plan,
        operationId: fixture.operation.operationId,
        now: '2026-08-25T10:20:00.000Z',
      }),
      errorCode('E_LANDING_CUSTODY_INVALID'),
    );
    assert.equal(missingIntent.state.reconciliations, 0);
  },
);

directTest(
  'plans require canonical topological order and forbid irreversible rollback binding',
  () => {
    const second = {
      ...structuredClone(fixture.operation),
      operationId: `lop_${'2'.padStart(32, '0')}`,
    };
    const first = {
      ...structuredClone(fixture.operation),
      operationId: `lop_${'1'.padStart(32, '0')}`,
    };
    assert.throws(
      () =>
        prepareLanding({
          closureInspection: fixture.closureInspection,
          currentTargetHash: second.targetBeforeHash,
          operations: [second, first],
          baseRecords: fixture.baseRecords,
          operationRegistry: fixture.operationRegistry,
          createdAt: '2026-08-25T10:00:00.000Z',
          expiresAt: '2026-08-25T11:00:00.000Z',
        }),
      errorCode('LANDING_DAG_INVALID'),
    );

    const executor = structuredClone(fixture.executor);
    const governed = {
      ...structuredClone(fixture.governed),
      effectClass: 'external-effect',
    };
    const rollbackPlan = {
      ...structuredClone(operating['operating-rollback-plan']),
      operationId: governed.operationId,
      effectClass: governed.effectClass,
      executor: structuredClone(governed.executor),
      capability: structuredClone(governed.capability),
      eligibility: 'eligible',
    };
    const rollbackResult = {
      ...structuredClone(operating['operating-rollback-result']),
      originalOperationId: governed.operationId,
      rollbackPlanId: rollbackPlan.rollbackPlanId,
      effectClass: governed.effectClass,
      executor: structuredClone(governed.executor),
      capability: structuredClone(governed.capability),
    };
    const registration = (id) =>
      fixture.operationRegistry.operations.find(({ operationId }) => operationId === id);
    const mergeRegistration = registration('merge');
    const merge = {
      ...structuredClone(fixture.operation),
      operationId: `lop_${'1'.padStart(32, '0')}`,
      registryOperationId: 'merge',
      registrationHash: mergeRegistration.registrationHash,
      kind: 'merge',
      effectClass: mergeRegistration.effectClass,
      recoveryClass: mergeRegistration.recoveryClass,
      inputDigest: digest({
        action: governed.action,
        target: governed.target,
        capability: governed.capability,
      }),
      operateBindings: [recordRef('operating-governed-operation', governed, governed.operationId)],
    };
    const rollbackRegistration = registration('rollback');
    const rollback = {
      ...structuredClone(fixture.operation),
      operationId: `lop_${'2'.padStart(32, '0')}`,
      registryOperationId: 'rollback',
      registrationHash: rollbackRegistration.registrationHash,
      kind: 'rollback',
      dependsOn: [merge.operationId],
      effectClass: rollbackRegistration.effectClass,
      recoveryClass: rollbackRegistration.recoveryClass,
      inputDigest: digest({ executor, rollbackPlan, rollbackResult }),
      operateBindings: [
        recordRef('operating-rollback-plan', rollbackPlan, rollbackPlan.rollbackPlanId),
        recordRef('operating-rollback-result', rollbackResult, rollbackResult.rollbackResultId),
      ],
    };
    assert.throws(
      () =>
        prepareLanding({
          closureInspection: fixture.closureInspection,
          currentTargetHash: merge.targetBeforeHash,
          operations: [merge, rollback],
          baseRecords: [executor, governed, rollbackPlan, rollbackResult],
          operationRegistry: fixture.operationRegistry,
          createdAt: '2026-08-25T10:00:00.000Z',
          expiresAt: '2026-08-25T11:00:00.000Z',
        }),
      errorCode('LANDING_RECOVERY_INVALID'),
    );
  },
);

ownerTest(
  'a non-passing deploy cannot bypass its frozen containment',
  ['confirm', 'confirm'],
  async () => {
    const executor = structuredClone(fixture.executor);
    const governed = { ...structuredClone(fixture.governed), effectClass: 'external-effect' };
    const rollbackPlan = {
      ...structuredClone(operating['operating-rollback-plan']),
      operationId: governed.operationId,
      effectClass: governed.effectClass,
      executor: structuredClone(governed.executor),
      capability: structuredClone(governed.capability),
      eligibility: 'eligible',
    };
    const registration = fixture.operationRegistry.operations.find(
      ({ operationId }) => operationId === 'deploy',
    );
    const containment = {
      policyHash: digest('deploy-containment'),
      state: 'preconfirmed',
      stopPromotion: true,
      stopNewTraffic: true,
      isolateFailedTarget: true,
      retainLastKnownGood: true,
      trafficStateHash: digest('traffic-contained'),
      residualStateHash: digest('residual-contained'),
      expiresAt: '2026-08-25T10:30:00.000Z',
      consequences: ['The failed target remains isolated.'],
      recoveryChoices: ['rollback', 'forward-fix'],
      authority: 'containment-only',
    };
    const deploy = {
      ...structuredClone(fixture.operation),
      registryOperationId: 'deploy',
      registrationHash: registration.registrationHash,
      kind: 'deploy',
      effectClass: registration.effectClass,
      recoveryClass: registration.recoveryClass,
      inputDigest: digest({
        action: governed.action,
        target: governed.target,
        capability: governed.capability,
      }),
      operateBindings: [
        recordRef('operating-governed-operation', governed, governed.operationId),
        recordRef('operating-rollback-plan', rollbackPlan, rollbackPlan.rollbackPlanId),
      ],
      containment,
    };
    const plan = prepareLanding({
      closureInspection: fixture.closureInspection,
      currentTargetHash: deploy.targetBeforeHash,
      operations: [deploy],
      baseRecords: [executor, governed, rollbackPlan],
      operationRegistry: fixture.operationRegistry,
      createdAt: '2026-08-25T10:00:00.000Z',
      expiresAt: '2026-08-25T11:00:00.000Z',
    });
    const runtime = memoryHost(plan, {
      dispatchResult: {
        status: 'failed',
        targetAfterHash: null,
        completedAt: '2026-08-25T10:00:00.002Z',
        evidenceRecords: [],
        evidenceContexts: {},
        canary: null,
        containment: null,
        recovery: null,
      },
    });
    await assert.rejects(
      advanceLanding({
        host: runtime.host,
        plan,
        operationId: deploy.operationId,
        now: '2026-08-25T10:00:00.000Z',
      }),
      errorCode('E_LANDING_CONTAINMENT_REQUIRED'),
    );
    assert.equal(runtime.state.dispatches, 1);

    const notStarted = memoryHost(plan, {
      dispatchThrows: true,
      reconcileResult: {
        disposition: 'not-started',
        targetAfterHash: null,
        completedAt: '2026-08-25T10:00:00.002Z',
      },
    });
    const blocked = await advanceLanding({
      host: notStarted.host,
      plan,
      operationId: deploy.operationId,
      now: '2026-08-25T10:00:00.000Z',
    });
    assert.equal(blocked.phaseReceipt.status, 'blocked');
    assert.equal(blocked.phaseReceipt.containment, null);
    assert.equal(blocked.landingReceipt.status, 'blocked');
    assert.equal(notStarted.state.dispatches, 1);
    assert.equal(notStarted.state.reconciliations, 1);
  },
);
