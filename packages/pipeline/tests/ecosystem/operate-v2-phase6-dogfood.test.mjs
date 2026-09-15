import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { packOperateV2DevelopmentSnapshot } from '../../scripts/check-operate-runtime-purity.mjs';
import { OPERATE_RUNTIME_CONTRACT_KINDS } from '../../lib/protocol/loader.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-operate-v2-phase6-dogfood-'));
const PHASE_5_ACTION_STAGES = [
  'accepted-snapshot-state',
  'snapshot-provider-candidate-produced',
  'public-domain-projection',
  'delta-trigger-scenario',
  'minimum-plan-scheduler-topology',
  'advisor-submission-proof',
  'challenger-submission-proof',
  'chair-submission-proof',
  'decision-ledger-action-hypothesis',
  'durable-action-verification-plan',
];
const PHASE_6_STAGES = [
  'policy-evaluated',
  'approval-recorded',
  'capability-authorized',
  'durable-operation-intent',
  'contained-execution-result',
  'retry-restart-replay',
  null,
  'execution-verification-assignment',
  'metric-observation-accepted',
  'outcome-learning-atomic',
  'later-snapshot-delta-revisit',
  'negative-authority-effect-lifecycle',
];

after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

test('packed dogfood executes exact business and software governed-loop vectors', { timeout: 120_000 }, () => {
  const packed = packOperateV2DevelopmentSnapshot(join(temporaryRoot, 'package'), { sourceRoot: root });
  const consumer = join(temporaryRoot, 'consumer');
  const installedPackage = join(consumer, 'node_modules', 'planr-pipeline');
  mkdirSync(installedPackage, { recursive: true });
  const extracted = spawnSync('tar', [
    '-xzf', packed.tarballPath, '-C', installedPackage, '--strip-components=1',
  ], { encoding: 'utf8' });
  assert.equal(extracted.status, 0, extracted.stderr);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ type: 'module' }));
  const runnerPath = join(consumer, 'verify-phase6.mjs');
  writeFileSync(runnerPath, [
    "import { verifyOperateV2GovernedExecution } from './node_modules/planr-pipeline/conformance/verify-operate-v2-governed-execution.mjs';",
    "process.stdout.write(JSON.stringify(await verifyOperateV2GovernedExecution()));",
  ].join('\n'));
  const result = spawnSync(process.execPath, [
    runnerPath,
  ], {
    cwd: consumer,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.deepEqual({
    ok: report.ok,
    contracts: report.contracts,
    checks: report.checks,
    networkAttempts: report.networkAttempts,
    credentialReads: report.credentialReads,
    externalEffects: report.externalEffects,
    realEffects: report.realEffects,
  }, {
    ok: true,
    contracts: OPERATE_RUNTIME_CONTRACT_KINDS.length,
    checks: 61,
    networkAttempts: 0,
    credentialReads: 0,
    externalEffects: 0,
    realEffects: 0,
  });
  assert.deepEqual(report.journeys.map(({ domainId }) => domainId), ['business', 'software']);
  for (const journey of report.journeys) {
    assert.deepEqual(journey.stageOrder, [
      ...PHASE_5_ACTION_STAGES,
      ...PHASE_6_STAGES.map((stage) => stage ?? (
        journey.domainId === 'business' ? 'governed-rollback' : 'rollback-not-required'
      )),
    ], `${journey.domainId}: exact governed-loop order`);
    assert.equal(
      journey.counts.phase5Events,
      journey.domainId === 'business' ? 118 : 62,
    );
    assert.equal(journey.counts.executeOperations, 1);
    assert.equal(journey.counts.executionResults, 1);
    assert.equal(journey.counts.modelDispatches, 0);
    assert.equal(journey.execution.dispatchCount, 1);
    assert.equal(journey.execution.replayDispatchCount, 0);
    assert.equal(journey.execution.restartDispatchCount, 0);
    assert.equal(journey.execution.acknowledgementLossRecovered, true);
    assert.deepEqual(journey.execution.divergentRetry, {
      code: 'OPERATION_CONFLICT',
      events: 0,
      dispatches: 0,
      effects: 0,
      hostAccesses: 0,
      targetAccesses: 0,
    });
    assert.equal(journey.execution.recoveryClassification, 'applied');
    assert.equal(journey.negativeVectors.noApprovalCode, 'APPROVAL_REQUIRED');
    assert.equal(journey.negativeVectors.widenedCode, 'APPROVAL_INVALID');
    assert.equal(journey.negativeVectors.registrationOnlyCode, 'CAPABILITY_DENIED');
    assert.equal(journey.negativeVectors.lifecycleCode, 'STATE_TRANSITION_INVALID');
    assert.equal(journey.verification.revisit, true);
  }
  const [business, software] = report.journeys;
  assert.deepEqual(business.counts, {
    phase5Events: 118,
    phase6Events: 32,
    finalEvents: 150,
    operations: 2,
    executeOperations: 1,
    rollbackOperations: 1,
    executionResults: 1,
    rollbackResults: 1,
    dispatches: 2,
    effects: 2,
    modelDispatches: 0,
  });
  assert.equal(business.rollback.status, 'succeeded');
  assert.equal(business.verification.executionStatus, 'rolled-back');
  assert.deepEqual(software.counts, {
    phase5Events: 62,
    phase6Events: 23,
    finalEvents: 85,
    operations: 1,
    executeOperations: 1,
    rollbackOperations: 0,
    executionResults: 1,
    rollbackResults: 0,
    dispatches: 1,
    effects: 1,
    modelDispatches: 0,
  });
  assert.equal(software.rollback, null);
  assert.equal(software.verification.executionStatus, 'success');
});
