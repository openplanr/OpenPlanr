import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  advanceShip,
  finalizeShipClosure,
  getShipClosure,
  preparePlan,
  runShipGates,
  startShip,
  verifyShipCompatibilityProjection,
} from '../../lib/pipeline/index.mjs';
import {
  assertLandingConfirmation,
  assertLandingPhaseReceipt,
  assertLandingPlan,
  assertLandingReceipt,
  reduceLandingEvents,
} from '../../lib/pipeline/landing-contract.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

const operating = JSON.parse(
  readFileSync(
    new URL(
      '../../conformance/fixtures/operating-runtime-v2/all-contracts-valid.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const operationRegistrySource = JSON.parse(
  readFileSync(new URL('../../registry/landing-operations.json', import.meta.url), 'utf8'),
);
const digest = (value) => sha256Jcs(value);
const copy = (value) => structuredClone(value);
const hashRecord = (body, field) => ({ ...body, [field]: digest(body) });
const errorCode = (code) => (error) => error?.code === code;
const hexId = (prefix, number) => `${prefix}_${number.toString(16).padStart(32, '0')}`;

let projectedShipFixture;

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function shipReviewClosed(state) {
  const candidate = state.candidateRevisions.at(-1);
  return {
    type: 'review.closed',
    expectedGeneration: state.generation,
    phase: 'initial',
    candidateRevision: candidate.revision,
    candidateDigest: candidate.digest,
    reviewerIds: [...state.reviewerRoster],
    contributions: state.reviewerRoster.map((reviewerId) => ({
      reviewerId,
      summary: `${reviewerId} completed the disposable landing-source review.`,
      evidenceDigest: digest({ reviewerId, candidateDigest: candidate.digest }),
    })),
    findings: [],
    reviewedFindingIds: [],
    summary: 'Disposable landing-source review passed.',
    rosterDigest: state.rosterDigest,
    gateSetDigest: state.gateSetDigest,
  };
}

function projectedShipReceipt() {
  if (projectedShipFixture !== undefined) return projectedShipFixture;
  const root = mkdtempSync(join(tmpdir(), 'openplanr-landing-source-'));
  mkdirSync(join(root, '.planr'), { recursive: true });
  mkdirSync(join(root, 'input', 'tech'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(
    join(root, '.planr', 'config.json'),
    JSON.stringify({ idPrefix: { spec: 'SPEC' } }),
  );
  writeFileSync(
    join(root, 'input', 'tech', 'stack.md'),
    [
      '# Stack',
      'BuildCommand: "node --check src/app.js"',
      'TestCommand: "node --test tests/smoke.test.mjs"',
      'LintCommand: ""',
    ].join('\n'),
  );
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 0;\n');
  writeFileSync(
    join(root, 'tests', 'smoke.test.mjs'),
    "import test from 'node:test'; test('ok', () => {});\n",
  );
  const prepared = preparePlan({ projectRoot: root, feature: 'landing-source', scaffold: true });
  mkdirSync(join(prepared.specDir, 'stories'), { recursive: true });
  mkdirSync(join(prepared.specDir, 'tasks'), { recursive: true });
  writeFileSync(
    join(prepared.specDir, 'stories', 'US-001-landing-source.md'),
    ['---', 'id: "US-001"', 'status: "pending"', 'updated: "2026-08-24"', '---', ''].join('\n'),
  );
  writeFileSync(
    join(prepared.specDir, 'tasks', 'T-001-landing-source.md'),
    [
      '---',
      'id: "T-001"',
      'storyId: "US-001"',
      'status: "pending"',
      'updated: "2026-08-24"',
      'dependsOn: []',
      'preserve: []',
      '---',
      '',
      '## Preserve',
      '- Exact disposable receipt custody remains readable.',
      '',
      '## Definition of done',
      '- [ ] complete',
      '',
    ].join('\n'),
  );
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'baseline');

  const started = startShip({
    projectRoot: root,
    feature: 'landing-source',
    humanReviewConfirmed: true,
    runtime: 'codex',
  });
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 1;\n');
  let summary = advanceShip({
    projectRoot: root,
    feature: 'landing-source',
    runId: started.runId,
    event: {
      type: 'task.completed',
      expectedGeneration: 0,
      taskId: 'T-001',
      agent: 'backend-agent',
      filesWritten: [],
      filesModified: [{ repositoryKey: 'project', path: 'src/app.js' }],
    },
  });
  summary = advanceShip({
    projectRoot: root,
    feature: 'landing-source',
    runId: started.runId,
    event: { type: 'review.opened', expectedGeneration: summary.generation },
  });
  runShipGates({
    projectRoot: root,
    feature: 'landing-source',
    runId: started.runId,
    phase: 'initial',
  });
  const state = getShipClosure({
    projectRoot: root,
    feature: 'landing-source',
    runId: started.runId,
  });
  advanceShip({
    projectRoot: root,
    feature: 'landing-source',
    runId: started.runId,
    event: shipReviewClosed(state),
  });
  runShipGates({
    projectRoot: root,
    feature: 'landing-source',
    runId: started.runId,
    phase: 'final',
  });
  const finalized = finalizeShipClosure({
    projectRoot: root,
    feature: 'landing-source',
    runId: started.runId,
  });
  const receipt = JSON.parse(readFileSync(finalized.receiptPath, 'utf8'));
  const shipProjection = {
    projectRoot: root,
    prepared: {
      root: prepared.specDir,
      closureRepositories: [{ repositoryKey: 'project', root }],
    },
  };
  assert.equal(verifyShipCompatibilityProjection(receipt, shipProjection), true);
  projectedShipFixture = { receipt, shipProjection };
  return projectedShipFixture;
}

function recordRef(contractId, record, recordId) {
  return {
    contractId,
    schemaVersion: record.schemaVersion,
    protocolVersion: record.protocolVersion,
    recordId,
    recordDigest: digest(record),
  };
}

function landingCustody() {
  const { receipt, shipProjection } = projectedShipReceipt();
  const shipReceipt = copy(receipt);
  const candidate = shipReceipt.candidateRevisions.at(-1);
  const operationRegistry = copy(operationRegistrySource);
  const executor = copy(operating['operate-executor-registration']);
  const governed = copy(operating['operating-governed-operation']);
  const verificationPlan = copy(operating['operating-action-verification-plan']);
  const checkpoint = copy(operating['operating-checkpoint']);
  const rollbackPlan = copy(operating['operating-rollback-plan']);
  const baseRecords = [executor, governed, verificationPlan, checkpoint, rollbackPlan];
  const executorRegistration = recordRef(
    'operate-executor-registration',
    executor,
    executor.executorId,
  );
  const governedBinding = recordRef('operating-governed-operation', governed, governed.operationId);
  const verificationBinding = recordRef(
    'operating-action-verification-plan',
    verificationPlan,
    verificationPlan.verificationPlanId,
  );
  const checkpointBinding = recordRef(
    'operating-checkpoint',
    checkpoint,
    checkpoint.runtimeStateHash,
  );
  const sourceRepository = candidate.repositories.find(
    ({ repositoryKey }) => repositoryKey === 'project',
  );
  const repositories = candidate.repositories.map((repository) => ({
    ...copy(repository),
    projectionDigest: digest({
      contractId: 'ship-compatibility-projection',
      schemaVersion: shipReceipt.schemaVersion,
      receiptHash: shipReceipt.receiptHash,
      recordDigest: digest(shipReceipt),
      repository,
    }),
  }));
  const registration = (id) =>
    operationRegistry.operations.find(({ operationId }) => operationId === id);
  const shipClosure = {
    contractId: 'ship-closure',
    schemaVersion: shipReceipt.schemaVersion,
    protocolVersion: '1.1.0',
    recordType: 'receipt',
    runId: shipReceipt.runId,
    terminalStatus: 'passed',
    receiptHash: shipReceipt.receiptHash,
    recordDigest: digest(shipReceipt),
  };
  return {
    shipReceipt,
    candidate,
    operationRegistry,
    executor,
    governed,
    verificationPlan,
    checkpoint,
    rollbackPlan,
    baseRecords,
    executorRegistration,
    governedBinding,
    verificationBinding,
    checkpointBinding,
    sourceRepository,
    repositories,
    registration,
    shipClosure,
    shipProjection,
  };
}

function commitOperation(
  custody,
  operationId = hexId('lop', 1),
  targetBeforeHash = digest('landing-target-0'),
) {
  const registration = custody.registration('commit');
  return {
    operationId,
    registryOperationId: registration.operationId,
    registrationHash: registration.registrationHash,
    kind: 'commit',
    repositoryKey: 'project',
    dependsOn: [],
    effectClass: registration.effectClass,
    recoveryClass: registration.recoveryClass,
    targetBeforeHash,
    inputDigest: digest({
      action: custody.governed.action,
      target: custody.governed.target,
      capability: custody.governed.capability,
    }),
    outputContract: { schemaId: 'landing-phase-receipt', schemaVersion: '1.0.0' },
    preconditionHashes: [],
    timeoutMs: 300000,
    retryPolicy: 'reconcile-before-retry',
    executorRegistration: copy(custody.executorRegistration),
    operateBindings: [copy(custody.governedBinding)],
    containment: null,
  };
}

function canaryOperation(custody, dependency, targetBeforeHash) {
  const registration = custody.registration('canary');
  return {
    operationId: hexId('lop', 2),
    registryOperationId: registration.operationId,
    registrationHash: registration.registrationHash,
    kind: 'canary',
    repositoryKey: 'project',
    dependsOn: [dependency],
    effectClass: registration.effectClass,
    recoveryClass: registration.recoveryClass,
    targetBeforeHash,
    inputDigest: digest({
      executor: custody.executor,
      verificationPlan: custody.verificationPlan,
      checkpoint: custody.checkpoint,
    }),
    outputContract: { schemaId: 'landing-phase-receipt', schemaVersion: '1.0.0' },
    preconditionHashes: [digest('canary-ready')],
    timeoutMs: 120000,
    retryPolicy: 'none',
    executorRegistration: copy(custody.executorRegistration),
    operateBindings: [copy(custody.verificationBinding), copy(custody.checkpointBinding)],
    containment: null,
  };
}

function deployOperation(custody, targetBeforeHash = digest('landing-target-0')) {
  const registration = custody.registration('deploy');
  const containment = {
    policyHash: digest('deploy-containment'),
    state: 'preconfirmed',
    stopPromotion: true,
    stopNewTraffic: true,
    isolateFailedTarget: true,
    retainLastKnownGood: true,
    trafficStateHash: digest('contained-traffic'),
    residualStateHash: digest('contained-residual'),
    expiresAt: '2026-08-24T12:00:00Z',
    consequences: ['The failed deployment remains isolated.'],
    recoveryChoices: ['rollback', 'forward-fix'],
    authority: 'containment-only',
  };
  return {
    operationId: hexId('lop', 1),
    registryOperationId: registration.operationId,
    registrationHash: registration.registrationHash,
    kind: 'deploy',
    repositoryKey: 'project',
    dependsOn: [],
    effectClass: registration.effectClass,
    recoveryClass: registration.recoveryClass,
    targetBeforeHash,
    inputDigest: digest({
      action: custody.governed.action,
      target: custody.governed.target,
      capability: custody.governed.capability,
    }),
    outputContract: { schemaId: 'landing-phase-receipt', schemaVersion: '1.0.0' },
    preconditionHashes: [],
    timeoutMs: 300000,
    retryPolicy: 'reconcile-before-retry',
    executorRegistration: copy(custody.executorRegistration),
    operateBindings: [
      copy(custody.governedBinding),
      recordRef(
        'operating-rollback-plan',
        custody.rollbackPlan,
        custody.rollbackPlan.rollbackPlanId,
      ),
    ],
    containment,
  };
}

function landingPlan(custody, operations, preconditions = []) {
  const body = {
    kind: 'landing-plan',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    planId: hexId('land', operations.length),
    authority: 'none',
    shipClosure: copy(custody.shipClosure),
    feature: custody.shipReceipt.feature,
    candidateDigest: custody.candidate.digest,
    candidateInventoryDigest: digest(custody.candidate.inventory),
    repositories: copy(custody.repositories),
    currentTargetHash: operations[0].targetBeforeHash,
    operations: copy(operations),
    preconditions: copy(preconditions),
    createdAt: '2026-08-24T09:00:00Z',
    expiresAt: '2026-08-24T13:00:00Z',
  };
  return hashRecord(body, 'planHash');
}

const effectFor = (kind) =>
  kind === 'commit' ? 'commit' : kind === 'deploy' ? 'production-deploy' : 'staging-deploy';

function confirmation(plan, operation, number) {
  const operationPreconditions = plan.preconditions.filter(({ proofHash }) =>
    operation.preconditionHashes.includes(proofHash),
  );
  const providerPreconditionHashes = operationPreconditions
    .filter(({ kind }) => kind === 'provider-available')
    .map(({ proofHash }) => proofHash)
    .sort();
  const canary = operationPreconditions
    .filter(({ kind }) => kind === 'canary-ready')
    .map(({ proofHash }) => proofHash);
  const expiresAt = '2026-08-24T12:00:00Z';
  const docket = {
    sourceReceiptHash: plan.shipClosure.receiptHash,
    candidateDigest: plan.candidateDigest,
    targetHash: operation.targetBeforeHash,
    currentTargetHash: operation.targetBeforeHash,
    operationIds: [operation.operationId],
    effectSet: [effectFor(operation.kind)],
    inputDigest: operation.inputDigest,
    providerPreconditionHashes,
    sensitivity: operation.effectClass === 'project-write' ? 'internal' : 'confidential',
    consequences: [
      `Execute ${operation.kind} with ${operation.effectClass} effects and ${operation.recoveryClass} recovery.`,
    ],
    recoveryClass: operation.recoveryClass,
    canaryPolicyHash: canary.length === 1 ? canary[0] : null,
    containmentPolicyHash: operation.containment?.policyHash ?? null,
    expiresAt,
    changedStateDiffHash: digest({
      targetBeforeHash: operation.targetBeforeHash,
      inputDigest: operation.inputDigest,
      preconditionHashes: [...operation.preconditionHashes].sort(),
    }),
    authorityBoundary: 'portable-confirmation-is-not-effect-authority',
    choices: ['confirm', 'cancel'],
    defaultChoice: null,
    cancelEffect: 'none',
  };
  const body = {
    kind: 'landing-confirmation',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    confirmationId: hexId('lcnf', number),
    authority: 'none',
    ownerActorId: 'owner.reference',
    planId: plan.planId,
    planHash: plan.planHash,
    shipReceiptHash: plan.shipClosure.receiptHash,
    phaseId: operation.kind,
    operationIds: [operation.operationId],
    effectSet: [effectFor(operation.kind)],
    currentTargetHash: operation.targetBeforeHash,
    docket,
    docketHash: digest(docket),
    choice: 'confirm',
    issuedAt: '2026-08-24T09:30:00Z',
    expiresAt,
    opaqueCapabilityHash: digest(`landing-capability-${number}`),
  };
  return hashRecord(body, 'confirmationHash');
}

function phaseReceipt({
  plan,
  operation,
  proof,
  number,
  targetAfterHash,
  previousReceiptHash = null,
  recovery = false,
  recoveryPolicy = null,
}) {
  const canary =
    operation.kind === 'canary'
      ? {
          status: recovery ? 'failed' : 'passed',
          windowHash: digest(operating['operating-action-verification-plan'].window),
          thresholdHash: digest({
            target: operating['operating-action-verification-plan'].target,
            evaluationRules: operating['operating-action-verification-plan'].evaluationRules,
          }),
          minimumEvidence: 1,
          artifactHashes: [],
          absenceHashes: [],
        }
      : null;
  const policy =
    recoveryPolicy ??
    plan.operations.find(
      (candidate) =>
        operation.dependsOn.includes(candidate.operationId) && candidate.kind === 'deploy',
    )?.containment ??
    operation.containment;
  const trafficStateHash = policy?.trafficStateHash ?? digest('contained-traffic');
  const residualStateHash = policy?.residualStateHash ?? digest('contained-residual');
  const body = {
    kind: 'landing-phase-receipt',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    receiptId: hexId('lprc', number),
    runId: hexId('lrun', plan.operations.length),
    planId: plan.planId,
    planHash: plan.planHash,
    phaseId: operation.kind,
    operationId: operation.operationId,
    operationRegistrationHash: operation.registrationHash,
    status: recovery ? 'recovery_required' : 'succeeded',
    effectClass: operation.effectClass,
    authority: 'consumed-runtime-capability',
    requestHash: digest({
      planHash: plan.planHash,
      operation,
      confirmationHash: proof.confirmationHash,
    }),
    attemptIdentity: hexId('latm', number),
    confirmation: {
      confirmationId: proof.confirmationId,
      confirmationHash: proof.confirmationHash,
      opaqueCapabilityHash: proof.opaqueCapabilityHash,
      consumedAt: '2026-08-24T10:03:00Z',
    },
    targetBeforeHash: operation.targetBeforeHash,
    targetAfterHash: recovery ? null : targetAfterHash,
    evidenceHashes: [],
    canary,
    containment: recovery
      ? {
          policyHash: policy.policyHash,
          applied: true,
          stopPromotion: policy.stopPromotion,
          stopNewTraffic: policy.stopNewTraffic,
          failedTargetIsolated: policy.isolateFailedTarget,
          lastKnownGoodRetained: policy.retainLastKnownGood,
          trafficStateHash,
          residualStateHash,
          appliedAt: '2026-08-24T10:04:00Z',
        }
      : null,
    recovery: recovery
      ? {
          state: 'recovery_required',
          trafficStateHash,
          residualStateHash,
          expiresAt: policy.expiresAt,
          consequences: copy(policy.consequences),
          choices: copy(policy.recoveryChoices),
          defaultChoice: null,
          authority: 'none',
        }
      : null,
    operateBinding: copy(
      operation.operateBindings.find(({ contractId }) =>
        operation.kind === 'canary'
          ? contractId === 'operating-action-verification-plan'
          : contractId === 'operating-governed-operation',
      ),
    ),
    previousReceiptHash,
    startedAt: '2026-08-24T10:02:00Z',
    completedAt: recovery ? '2026-08-24T10:05:00Z' : '2026-08-24T10:04:00Z',
  };
  return hashRecord(body, 'receiptHash');
}

function landingEvent({
  number,
  runId,
  type,
  fromState,
  toState,
  planHash,
  requestHash = digest('no-phase-request'),
  operationId = null,
  confirmationHash = null,
  targetStateHash,
  previousEventHash = null,
  actor = 'engine',
  trafficStateHash = null,
  residualStateHash = null,
}) {
  const body = {
    kind: 'landing-event',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    eventId: hexId('levt', number),
    sequence: number,
    runId,
    type,
    fromState,
    toState,
    actor: { kind: actor, id: actor === 'human' ? 'owner.reference' : 'openplanr' },
    planHash,
    requestHash,
    operationId,
    confirmationHash,
    targetStateHash,
    trafficStateHash,
    residualStateHash,
    previousEventHash,
    timestamp: `2026-08-24T10:${String(number).padStart(2, '0')}:00Z`,
  };
  return hashRecord(body, 'eventHash');
}

function appendEvent(events, fields) {
  const event = landingEvent({
    ...fields,
    number: events.length + 1,
    previousEventHash: events.at(-1)?.eventHash ?? null,
  });
  events.push(event);
  return event;
}

function successfulJournal(plan, phase) {
  const events = [];
  appendEvent(events, {
    runId: phase.runId,
    type: 'plan.created',
    fromState: 'planned',
    toState: 'awaiting-confirmation',
    planHash: plan.planHash,
    targetStateHash: plan.currentTargetHash,
  });
  appendEvent(events, {
    runId: phase.runId,
    type: 'phase.intent-recorded',
    fromState: 'awaiting-confirmation',
    toState: 'intent-recorded',
    planHash: plan.planHash,
    requestHash: phase.requestHash,
    operationId: phase.operationId,
    confirmationHash: phase.confirmation.confirmationHash,
    targetStateHash: phase.targetBeforeHash,
  });
  appendEvent(events, {
    runId: phase.runId,
    type: 'phase.dispatching',
    fromState: 'intent-recorded',
    toState: 'dispatching',
    actor: 'runtime',
    planHash: plan.planHash,
    requestHash: phase.requestHash,
    operationId: phase.operationId,
    confirmationHash: phase.confirmation.confirmationHash,
    targetStateHash: phase.targetBeforeHash,
  });
  appendEvent(events, {
    runId: phase.runId,
    type: 'phase.succeeded',
    fromState: 'dispatching',
    toState: 'awaiting-confirmation',
    actor: 'runtime',
    planHash: plan.planHash,
    requestHash: phase.requestHash,
    operationId: phase.operationId,
    confirmationHash: phase.confirmation.confirmationHash,
    targetStateHash: phase.targetAfterHash,
  });
  appendEvent(events, {
    runId: phase.runId,
    type: 'landing.completed',
    fromState: 'awaiting-confirmation',
    toState: 'completed',
    planHash: plan.planHash,
    targetStateHash: phase.targetAfterHash,
  });
  return events;
}

function recoveryRequiredJournal(plan, phase) {
  const events = [];
  appendEvent(events, {
    runId: phase.runId,
    type: 'plan.created',
    fromState: 'planned',
    toState: 'awaiting-confirmation',
    planHash: plan.planHash,
    targetStateHash: plan.currentTargetHash,
  });
  appendEvent(events, {
    runId: phase.runId,
    type: 'phase.intent-recorded',
    fromState: 'awaiting-confirmation',
    toState: 'intent-recorded',
    planHash: plan.planHash,
    requestHash: phase.requestHash,
    operationId: phase.operationId,
    confirmationHash: phase.confirmation.confirmationHash,
    targetStateHash: phase.targetBeforeHash,
  });
  appendEvent(events, {
    runId: phase.runId,
    type: 'phase.dispatching',
    fromState: 'intent-recorded',
    toState: 'dispatching',
    actor: 'runtime',
    planHash: plan.planHash,
    requestHash: phase.requestHash,
    operationId: phase.operationId,
    confirmationHash: phase.confirmation.confirmationHash,
    targetStateHash: phase.targetBeforeHash,
  });
  appendEvent(events, {
    runId: phase.runId,
    type: 'containment.applied',
    fromState: 'dispatching',
    toState: 'recovery_required',
    actor: 'runtime',
    planHash: plan.planHash,
    requestHash: phase.requestHash,
    operationId: phase.operationId,
    confirmationHash: phase.confirmation.confirmationHash,
    targetStateHash: phase.targetBeforeHash,
    trafficStateHash: phase.containment.trafficStateHash,
    residualStateHash: phase.containment.residualStateHash,
  });
  appendEvent(events, {
    runId: phase.runId,
    type: 'recovery.required',
    fromState: 'recovery_required',
    toState: 'recovery_required',
    actor: 'runtime',
    planHash: plan.planHash,
    requestHash: phase.requestHash,
    operationId: phase.operationId,
    targetStateHash: phase.targetBeforeHash,
    trafficStateHash: phase.recovery.trafficStateHash,
    residualStateHash: phase.recovery.residualStateHash,
  });
  return events;
}

function landedReceipt(plan, phase, events) {
  const body = {
    kind: 'landing-receipt',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    receiptId: hexId('lrcp', 1),
    runId: phase.runId,
    authority: 'none',
    shipClosure: copy(plan.shipClosure),
    planId: plan.planId,
    planHash: plan.planHash,
    candidateDigest: plan.candidateDigest,
    candidateInventoryDigest: plan.candidateInventoryDigest,
    status: 'landed',
    phaseReceipts: [
      {
        receiptId: phase.receiptId,
        receiptHash: phase.receiptHash,
        operationId: phase.operationId,
        status: phase.status,
      },
    ],
    journalHeadHash: events.at(-1).eventHash,
    targetHash: phase.targetAfterHash,
    trafficStateHash: null,
    residualStateHash: null,
    recovery: {
      required: false,
      authority: 'none',
      planHash: null,
      resultHash: null,
      choices: [],
      defaultChoice: null,
    },
    startedAt: '2026-08-24T10:00:00Z',
    completedAt: '2026-08-24T10:06:00Z',
  };
  return hashRecord(body, 'receiptHash');
}

test('exact SHIP, registry, Operate base refs, phase receipt, and Event journal certify one landed DAG', () => {
  const custody = landingCustody();
  const operation = commitOperation(custody);
  const plan = landingPlan(custody, [operation]);
  const proof = confirmation(plan, operation, 1);
  const phase = phaseReceipt({
    plan,
    operation,
    proof,
    number: 1,
    targetAfterHash: digest('landing-target-1'),
  });
  const events = successfulJournal(plan, phase);
  const receipt = landedReceipt(plan, phase, events);
  const source = {
    shipReceipt: custody.shipReceipt,
    shipProjection: custody.shipProjection,
    operationRegistry: custody.operationRegistry,
    baseRecords: custody.baseRecords,
  };
  assert.equal(assertLandingPlan(plan, source).planHash, plan.planHash);
  assert.equal(
    assertLandingConfirmation(proof, { plan, ...source }).confirmationHash,
    proof.confirmationHash,
  );
  assert.equal(
    assertLandingPhaseReceipt(phase, {
      confirmation: proof,
      plan,
      ...source,
      events,
    }).receiptHash,
    phase.receiptHash,
  );
  assert.equal(
    assertLandingReceipt(receipt, {
      plan,
      ...source,
      phaseReceipts: [phase],
      confirmations: [proof],
      events,
    }).status,
    'landed',
  );

  const changedGoverned = { ...copy(custody.governed), updatedAt: '2026-08-10T08:02:01Z' };
  assert.throws(
    () =>
      assertLandingPlan(plan, {
        ...source,
        baseRecords: custody.baseRecords.map((entry) =>
          entry === custody.governed ? changedGoverned : entry,
        ),
      }),
    errorCode('LANDING_BASE_RECORD_MISMATCH'),
  );
});

test('DAG substitution is rejected and a deploy-bound failed canary closes recovery-required without rollback authority', () => {
  const custody = landingCustody();
  const originalGoverned = custody.governed;
  const originalRollbackPlan = custody.rollbackPlan;
  custody.governed = { ...copy(originalGoverned), effectClass: 'external-effect' };
  custody.rollbackPlan = {
    ...copy(originalRollbackPlan),
    effectClass: 'external-effect',
    executor: copy(custody.governed.executor),
    capability: copy(custody.governed.capability),
  };
  custody.governedBinding = recordRef(
    'operating-governed-operation',
    custody.governed,
    custody.governed.operationId,
  );
  custody.baseRecords = custody.baseRecords.map((record) =>
    record === originalGoverned
      ? custody.governed
      : record === originalRollbackPlan
        ? custody.rollbackPlan
        : record,
  );
  const deploy = deployOperation(custody);
  const deployTarget = digest('landing-target-after-deploy');
  const canary = canaryOperation(custody, deploy.operationId, deployTarget);
  const canaryReady = {
    id: 'canary-ready',
    kind: 'canary-ready',
    proofHash: digest('canary-ready'),
    mandatory: true,
  };
  const plan = landingPlan(custody, [deploy, canary], [canaryReady]);
  const source = {
    shipReceipt: custody.shipReceipt,
    shipProjection: custody.shipProjection,
    operationRegistry: custody.operationRegistry,
    baseRecords: custody.baseRecords,
  };
  assert.equal(assertLandingPlan(plan, source).operations.length, 2);

  const forgedBody = { ...copy(plan), operations: copy(plan.operations) };
  delete forgedBody.planHash;
  forgedBody.operations[1].dependsOn = [hexId('lop', 99)];
  const forgedPlan = { ...forgedBody, planHash: digest(forgedBody) };
  assert.throws(() => assertLandingPlan(forgedPlan, source), errorCode('LANDING_DAG_INVALID'));

  const deployProof = confirmation(plan, deploy, 1);
  const deployPhase = phaseReceipt({
    plan,
    operation: deploy,
    proof: deployProof,
    number: 1,
    targetAfterHash: deployTarget,
  });
  const canaryProof = confirmation(plan, canary, 2);
  const canaryPhase = phaseReceipt({
    plan,
    operation: canary,
    proof: canaryProof,
    number: 2,
    targetAfterHash: null,
    previousReceiptHash: deployPhase.receiptHash,
    recovery: true,
  });
  const recoveryEvents = recoveryRequiredJournal(plan, canaryPhase);
  assert.equal(
    assertLandingPhaseReceipt(canaryPhase, {
      confirmation: canaryProof,
      plan,
      ...source,
      events: recoveryEvents,
    }).status,
    'recovery_required',
  );
  assert.equal(canaryPhase.recovery.authority, 'none');
  assert.equal(canaryPhase.recovery.defaultChoice, null);

  const foreignPolicyBody = copy(canaryPhase);
  delete foreignPolicyBody.receiptHash;
  foreignPolicyBody.containment.policyHash = digest('foreign-rehashed-policy');
  const foreignPolicy = { ...foreignPolicyBody, receiptHash: digest(foreignPolicyBody) };
  assert.throws(
    () =>
      assertLandingPhaseReceipt(foreignPolicy, {
        confirmation: canaryProof,
        plan,
        ...source,
        events: recoveryEvents,
      }),
    errorCode('LANDING_CONTAINMENT_REQUIRED'),
  );

  const publishRegistration = custody.registration('publish');
  const publish = {
    ...copy(deploy),
    registryOperationId: publishRegistration.operationId,
    registrationHash: publishRegistration.registrationHash,
    kind: 'publish',
    recoveryClass: publishRegistration.recoveryClass,
    operateBindings: [copy(custody.governedBinding)],
    containment: null,
  };
  const orphanCanary = canaryOperation(custody, publish.operationId, deployTarget);
  const orphanPlan = landingPlan(custody, [publish, orphanCanary], [canaryReady]);
  const orphanProof = confirmation(orphanPlan, orphanCanary, 3);
  const orphanPhase = phaseReceipt({
    plan: orphanPlan,
    operation: orphanCanary,
    proof: orphanProof,
    number: 3,
    targetAfterHash: null,
    recovery: true,
    recoveryPolicy: deploy.containment,
  });
  const orphanEvents = recoveryRequiredJournal(orphanPlan, orphanPhase);
  assert.throws(
    () =>
      assertLandingPhaseReceipt(orphanPhase, {
        confirmation: orphanProof,
        plan: orphanPlan,
        ...source,
        events: orphanEvents,
      }),
    errorCode('LANDING_CONTAINMENT_REQUIRED'),
  );

  const falsePassBody = {
    ...copy(canaryPhase),
    status: 'succeeded',
    targetAfterHash: digest('unsafe-canary-target'),
    canary: { ...canaryPhase.canary, status: 'passed' },
    containment: null,
    recovery: null,
  };
  delete falsePassBody.receiptHash;
  const falsePass = { ...falsePassBody, receiptHash: digest(falsePassBody) };
  assert.throws(
    () =>
      assertLandingPhaseReceipt(falsePass, {
        confirmation: canaryProof,
        plan,
        ...source,
        events: recoveryEvents,
      }),
    errorCode('LANDING_FALSE_PASS'),
  );

  const unrelatedArtifactBody = {
    ...copy(canaryPhase),
    evidenceHashes: [digest(operating['operating-artifact'])],
  };
  delete unrelatedArtifactBody.receiptHash;
  const unrelatedArtifact = {
    ...unrelatedArtifactBody,
    receiptHash: digest(unrelatedArtifactBody),
  };
  assert.throws(
    () =>
      assertLandingPhaseReceipt(unrelatedArtifact, {
        confirmation: canaryProof,
        plan,
        ...source,
        events: recoveryEvents,
        evidenceRecords: [operating['operating-artifact']],
      }),
    errorCode('LANDING_FALSE_PASS'),
  );
});

test('landing Event adjacency, exact replay, and divergent identity are monotonic', () => {
  const custody = landingCustody();
  const operation = commitOperation(custody);
  const plan = landingPlan(custody, [operation]);
  const proof = confirmation(plan, operation, 1);
  const phase = phaseReceipt({
    plan,
    operation,
    proof,
    number: 1,
    targetAfterHash: digest('landing-target-1'),
  });
  const events = successfulJournal(plan, phase);
  const reduced = reduceLandingEvents(events);
  assert.equal(reduced.state, 'completed');
  assert.deepEqual(reduceLandingEvents([...events, events.at(-1)]), reduced);

  const divergentBody = { ...copy(events.at(-1)), timestamp: '2026-08-24T10:59:00Z' };
  delete divergentBody.eventHash;
  const divergent = { ...divergentBody, eventHash: digest(divergentBody) };
  assert.throws(
    () => reduceLandingEvents([...events, divergent]),
    errorCode('LANDING_REPLAY_CONFLICT'),
  );
  assert.throws(
    () => reduceLandingEvents([events[0], events[2]]),
    errorCode('LANDING_CONCURRENT_MODIFICATION'),
  );
});
