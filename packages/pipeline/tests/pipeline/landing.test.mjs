import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as nodeTest } from 'node:test';

import * as publicPipeline from '../../lib/pipeline/index.mjs';
import {
  advanceLanding,
  advanceShip,
  createLandingOwnerRuntimeHost,
  finalizeShipClosure,
  getShipClosure,
  inspectShipClosureForLanding,
  prepareLanding,
  preparePlan,
  readLandingOperationRegistry,
  runShipGates,
  startShip,
} from '../../lib/pipeline/index.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import {
  hasRealOwnerTerminal,
  isDirectTestModule,
  runTestFileInOwnerPty,
} from './helpers/landing-owner-pty.mjs';

const operating = JSON.parse(readFileSync(new URL(
  '../../conformance/fixtures/operating-runtime-v2/all-contracts-valid.json',
  import.meta.url,
), 'utf8'));
const digest = (value) => sha256Jcs(value);
const recordRef = (contractId, record, recordId) => ({
  contractId,
  schemaVersion: record.schemaVersion,
  protocolVersion: record.protocolVersion,
  recordId,
  recordDigest: digest(record),
});
const defaultPipeline = {
  advanceLanding,
  advanceShip,
  createLandingOwnerRuntimeHost,
  finalizeShipClosure,
  getShipClosure,
  inspectShipClosureForLanding,
  prepareLanding,
  preparePlan,
  readLandingOperationRegistry,
  runShipGates,
  startShip,
};
const directTestModule = isDirectTestModule(import.meta.url);
const ownerPtyChild = process.env.PLANR_LANDING_OWNER_PTY_CHILD === '1'
  && hasRealOwnerTerminal();

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
      testNamePattern: `^${name.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`,
    });
    assert.equal(result.answeredOwnerPrompts, choices.length);
    assert.equal(result.answeredChoicePrompts, choices.length);
  });
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function reviewed(state) {
  const candidate = state.candidateRevisions.at(-1);
  return {
    type: 'review.closed', expectedGeneration: state.generation, phase: 'initial',
    candidateRevision: candidate.revision, candidateDigest: candidate.digest,
    reviewerIds: [...state.reviewerRoster],
    contributions: state.reviewerRoster.map((reviewerId) => ({
      reviewerId, summary: `${reviewerId} completed the disposable review.`,
      evidenceDigest: digest({ reviewerId, candidateDigest: candidate.digest }),
    })),
    findings: [], reviewedFindingIds: [], summary: 'Disposable landing source passed.',
    rosterDigest: state.rosterDigest, gateSetDigest: state.gateSetDigest,
  };
}

function shipFixture(pipeline = defaultPipeline) {
  const {
    advanceShip: advance,
    finalizeShipClosure: finalize,
    getShipClosure: getClosure,
    preparePlan: prepare,
    runShipGates: runGates,
    startShip: start,
  } = pipeline;
  const root = mkdtempSync(join(tmpdir(), 'planr-landing-engine-'));
  mkdirSync(join(root, '.planr'), { recursive: true });
  mkdirSync(join(root, 'input', 'tech'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(join(root, '.planr', 'config.json'), JSON.stringify({ idPrefix: { spec: 'SPEC' } }));
  writeFileSync(join(root, 'input', 'tech', 'stack.md'), [
    '# Stack', 'BuildCommand: "node --check src/app.js"',
    'TestCommand: "node --test tests/smoke.test.mjs"', 'LintCommand: ""',
  ].join('\n'));
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 0;\n');
  writeFileSync(join(root, 'tests', 'smoke.test.mjs'), "import test from 'node:test'; test('ok', () => {});\n");
  const prepared = prepare({ projectRoot: root, feature: 'landing-engine', scaffold: true });
  mkdirSync(join(prepared.specDir, 'stories'), { recursive: true });
  mkdirSync(join(prepared.specDir, 'tasks'), { recursive: true });
  writeFileSync(join(prepared.specDir, 'stories', 'US-001-source.md'), [
    '---', 'id: "US-001"', 'status: "pending"', 'updated: "2026-08-25"', '---', '',
  ].join('\n'));
  writeFileSync(join(prepared.specDir, 'tasks', 'T-001-source.md'), [
    '---', 'id: "T-001"', 'storyId: "US-001"', 'status: "pending"',
    'updated: "2026-08-25"', 'dependsOn: []', 'preserve: []', '---', '',
    '## Preserve', '- Preserve the disposable source.', '',
    '## Definition of done', '- [ ] complete', '',
  ].join('\n'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'baseline');
  const started = start({
    projectRoot: root, feature: 'landing-engine', humanReviewConfirmed: true, runtime: 'codex',
  });
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 1;\n');
  let summary = advance({
    projectRoot: root, feature: 'landing-engine', runId: started.runId,
    event: {
      type: 'task.completed', expectedGeneration: 0, taskId: 'T-001', agent: 'backend-agent',
      filesWritten: [], filesModified: [{ repositoryKey: 'project', path: 'src/app.js' }],
    },
  });
  summary = advance({
    projectRoot: root, feature: 'landing-engine', runId: started.runId,
    event: { type: 'review.opened', expectedGeneration: summary.generation },
  });
  runGates({ projectRoot: root, feature: 'landing-engine', runId: started.runId, phase: 'initial' });
  advance({
    projectRoot: root, feature: 'landing-engine', runId: started.runId,
    event: reviewed(getClosure({ projectRoot: root, feature: 'landing-engine', runId: started.runId })),
  });
  runGates({ projectRoot: root, feature: 'landing-engine', runId: started.runId, phase: 'final' });
  const finalized = finalize({
    projectRoot: root, feature: 'landing-engine', runId: started.runId,
  });
  return {
    root,
    receiptHash: JSON.parse(readFileSync(finalized.receiptPath, 'utf8')).receiptHash,
  };
}

export function landingFixture(pipeline = defaultPipeline) {
  const source = shipFixture(pipeline);
  const closureInspection = pipeline.inspectShipClosureForLanding({
    projectRoot: source.root, feature: 'landing-engine', receiptHash: source.receiptHash,
  });
  const executor = structuredClone(operating['operate-executor-registration']);
  const governed = structuredClone(operating['operating-governed-operation']);
  const registry = pipeline.readLandingOperationRegistry();
  const registration = registry.operations.find(({ operationId }) => operationId === 'commit');
  const operation = {
    operationId: `lop_${'1'.padStart(32, '0')}`,
    registryOperationId: registration.operationId,
    registrationHash: registration.registrationHash,
    kind: 'commit', repositoryKey: 'project', dependsOn: [],
    effectClass: registration.effectClass, recoveryClass: registration.recoveryClass,
    targetBeforeHash: digest('target-before'),
    inputDigest: digest({ action: governed.action, target: governed.target, capability: governed.capability }),
    outputContract: { schemaId: 'landing-phase-receipt', schemaVersion: '1.0.0' },
    preconditionHashes: [], timeoutMs: 30_000, retryPolicy: 'reconcile-before-retry',
    executorRegistration: recordRef('operate-executor-registration', executor, executor.executorId),
    operateBindings: [recordRef('operating-governed-operation', governed, governed.operationId)],
    containment: null,
  };
  const baseRecords = [executor, governed];
  const plan = pipeline.prepareLanding({
    closureInspection, currentTargetHash: operation.targetBeforeHash, operations: [operation],
    baseRecords, operationRegistry: registry,
    createdAt: '2026-08-25T10:00:00.000Z', expiresAt: '2026-08-25T11:00:00.000Z',
  });
  return {
    plan, operation, closureInspection, executor, governed, baseRecords, operationRegistry: registry,
  };
}

export function memoryHost(plan, options = {}) {
  const state = options.state ?? {
    events: [], phaseReceipts: [], confirmations: [], evidenceRecordsByOperation: {},
    evidenceContextsByOperation: {}, targetStateHash: plan.currentTargetHash,
    observedTargetStateHash: plan.currentTargetHash,
    landingReceipt: null, phaseReceiptHeadHash: null, pendingIntent: null, startedAt: null,
    dispatches: 0, reconciliations: 0, confirmationsRequested: 0, intentCommits: 0,
  };
  const snapshot = () => ({
    candidateDigest: plan.candidateDigest,
    repositoryHeads: plan.repositories.map(({ repositoryKey, head }) => ({ repositoryKey, head })),
    targetStateHash: state.observedTargetStateHash,
    events: structuredClone(state.events),
    journalHead: {
      sequence: state.events.at(-1)?.sequence ?? 0,
      hash: state.events.at(-1)?.eventHash ?? null,
    },
    landingReceipt: structuredClone(state.landingReceipt),
    pendingIntent: structuredClone(state.pendingIntent),
    phaseReceiptHeadHash: state.phaseReceiptHeadHash,
    phaseReceipts: structuredClone(state.phaseReceipts),
    confirmations: structuredClone(state.confirmations),
    evidenceRecordsByOperation: structuredClone(state.evidenceRecordsByOperation),
    evidenceContextsByOperation: structuredClone(state.evidenceContextsByOperation),
    startedAt: state.startedAt,
  });
  const hostFactory = options.pipeline?.createLandingOwnerRuntimeHost
    ?? createLandingOwnerRuntimeHost;
  const host = hostFactory({
    snapshot: async () => snapshot(),
    commitIntent: async (request) => {
      assert.deepEqual(request.expectedJournalHead, snapshot().journalHead);
      state.intentCommits += 1;
      state.events.push(...structuredClone(request.events));
      state.startedAt ??= request.events[0].timestamp;
      const acknowledgement = {
        commitId: 'commit-1', dispatcherId: 'dispatcher-1',
        committedAt: '2026-08-25T10:00:00.001Z', journalHead: snapshot().journalHead,
      };
      const pendingBody = {
        kind: 'landing-pending-intent', schemaVersion: '1.0.0',
        attemptIdentity: request.attemptIdentity,
        ...structuredClone(acknowledgement),
        confirmation: structuredClone(request.confirmation),
        intentEventHash: request.intentEventHash, planHash: request.planHash,
        runId: request.runId, operationId: request.operationId,
        requestHash: request.requestHash, targetBeforeHash: request.targetBeforeHash,
      };
      state.pendingIntent = { ...pendingBody, pendingIntentHash: digest(pendingBody) };
      return acknowledgement;
    },
    dispatch: async () => {
      state.dispatches += 1;
      if (options.dispatchThrows) throw new Error('simulated acknowledgement loss');
      const targetAfterHash = options.dispatchResult?.targetAfterHash ?? digest('target-after');
      if (options.exposeEffectTarget && targetAfterHash !== null) {
        state.observedTargetStateHash = targetAfterHash;
      }
      return options.dispatchResult ?? {
        status: 'succeeded', targetAfterHash,
        completedAt: '2026-08-25T10:00:00.002Z', evidenceRecords: [], evidenceContexts: {},
        canary: null, containment: null, recovery: null,
      };
    },
    reconcile: async () => {
      state.reconciliations += 1;
      if (options.reconcileResult) return structuredClone(options.reconcileResult);
      throw new Error('reconciliation must not run on an acknowledged dispatch');
    },
    commitOutcome: async (request) => {
      if (options.outcomeCommitThrows) throw new Error('simulated outcome CAS failure');
      assert.deepEqual(request.expectedJournalHead, snapshot().journalHead);
      state.events.push(...structuredClone(request.events));
      state.phaseReceipts.push(structuredClone(request.phaseReceipt));
      state.confirmations.push(structuredClone(request.confirmation));
      state.targetStateHash = request.phaseReceipt.targetAfterHash ?? request.phaseReceipt.targetBeforeHash;
      state.observedTargetStateHash = state.targetStateHash;
      state.evidenceRecordsByOperation[request.phaseReceipt.operationId] = structuredClone(request.evidenceRecords);
      state.evidenceContextsByOperation[request.phaseReceipt.operationId] = structuredClone(request.evidenceContexts);
      state.phaseReceiptHeadHash = request.phaseReceipt.receiptHash;
      state.landingReceipt = structuredClone(request.landingReceipt);
      state.pendingIntent = null;
      const acknowledgement = {
        commitId: request.commitId, committedAt: '2026-08-25T10:00:00.003Z',
        journalHead: snapshot().journalHead,
        phaseReceiptHash: request.phaseReceipt.receiptHash,
        landingReceiptHash: request.landingReceipt?.receiptHash ?? null,
      };
      if (options.outcomeCommitAckThrows) throw new Error('simulated persisted outcome acknowledgement loss');
      return acknowledgement;
    },
  });
  return { host, state };
}

ownerTest('owner-anchored landing advance consumes one durable CAS intent and derives immutable receipts', ['confirm'], async () => {
  for (const name of [
    'createLandingTrustedRuntimeHost', 'issueLandingOwnerConfirmation',
    'createLandingEvent', 'createLandingPhaseReceipt', 'createLandingReceipt',
  ]) assert.equal(Object.hasOwn(publicPipeline, name), false, `${name} must remain outside the package root`);
  assert.equal(typeof publicPipeline.createLandingOwnerRuntimeHost, 'function');

  const { plan, operation } = landingFixture();
  const { host, state } = memoryHost(plan);
  const result = await advanceLanding({
    host, plan, operationId: operation.operationId, now: '2026-08-25T10:00:00.000Z',
  });
  assert.equal(result.state, 'completed');
  assert.equal(result.phaseReceipt.status, 'succeeded');
  assert.equal(result.landingReceipt.status, 'landed');
  assert.equal(result.phaseReceipt.authority, 'consumed-runtime-capability');
  assert.equal(result.landingReceipt.authority, 'none');
  assert.equal(state.dispatches, 1);
  assert.equal(state.reconciliations, 0);
  assert.deepEqual(state.events.map(({ type }) => type), [
    'plan.created', 'phase.intent-recorded', 'phase.dispatching',
    'phase.succeeded', 'landing.completed',
  ]);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.phaseReceipt));
});
