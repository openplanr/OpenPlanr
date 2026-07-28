import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computeEcosystemReleaseOperationDigest,
  createEcosystemReleaseOperation,
  createEcosystemSaga,
  nextEcosystemSagaSteps,
  reconcileEcosystemReleaseOperation,
  reconcileEcosystemSaga,
  recordEcosystemSagaStep,
} from '../../lib/pipeline/index.mjs';

const at = '2026-07-28T09:00:00Z';
const digest = (character) => `sha256:${character.repeat(64)}`;

const participants = [
  { id: 'pipeline', repository: 'openplanr/planr-pipeline', role: 'contract-owner' },
  { id: 'cli', repository: 'openplanr/OpenPlanr', role: 'behavior-owner' },
  { id: 'skills', repository: 'openplanr/skills', role: 'adapter' },
];
const steps = [
  {
    id: 'pipeline-contract',
    participantId: 'pipeline',
    action: 'land Protocol v1.2 contract',
    dependsOn: [],
    idempotencyKey: 'release:spec-002:pipeline',
  },
  {
    id: 'cli-behavior',
    participantId: 'cli',
    action: 'land planr operate behavior',
    dependsOn: ['pipeline-contract'],
    idempotencyKey: 'release:spec-002:cli',
  },
  {
    id: 'skills-adapter',
    participantId: 'skills',
    action: 'publish generated operate skill',
    dependsOn: ['cli-behavior'],
    idempotencyKey: 'release:spec-002:skills',
  },
];

test('ecosystem saga reveals only dependency-safe deterministic work', () => {
  let saga = createEcosystemSaga({
    id: 'SAGA-SPEC-002',
    subject: 'Operating Board release',
    participants,
    steps,
    createdAt: at,
  });
  assert.equal(saga.state, 'in-progress');
  assert.deepEqual(nextEcosystemSagaSteps(saga).map(({ id }) => id), ['pipeline-contract']);

  saga = recordEcosystemSagaStep(saga, {
    stepId: 'pipeline-contract',
    status: 'completed',
    evidence: ['commit:abcdef1'],
    completedAt: '2026-07-28T10:00:00Z',
  });
  assert.deepEqual(nextEcosystemSagaSteps(saga).map(({ id }) => id), ['cli-behavior']);
  saga = recordEcosystemSagaStep(saga, {
    stepId: 'cli-behavior',
    status: 'in-progress',
  });
  assert.equal(saga.steps.find(({ id }) => id === 'cli-behavior').attempts, 1);
});

test('ecosystem saga rejects ambiguous IDs, idempotency reuse, and dependency cycles', () => {
  assert.throws(() => createEcosystemSaga({
    id: 'SAGA-duplicate-key',
    subject: 'Invalid',
    participants,
    steps: [
      { ...steps[0] },
      { ...steps[1], idempotencyKey: steps[0].idempotencyKey },
    ],
    createdAt: at,
  }), /idempotency keys must be unique/);

  assert.throws(() => createEcosystemSaga({
    id: 'SAGA-cycle',
    subject: 'Invalid',
    participants,
    steps: [
      { ...steps[0], dependsOn: ['cli-behavior'] },
      { ...steps[1], dependsOn: ['pipeline-contract'] },
    ],
    createdAt: at,
  }), /dependency cycle/);
});

test('failed or compensated prerequisites never unblock dependent saga steps', () => {
  let saga = createEcosystemSaga({
    id: 'SAGA-compensated-prerequisite',
    subject: 'Do not promote after compensation',
    participants,
    steps,
    createdAt: at,
  });
  saga = recordEcosystemSagaStep(saga, {
    stepId: 'pipeline-contract',
    status: 'failed',
    error: 'Contract publication failed.',
  });
  assert.equal(saga.state, 'failed');
  assert.deepEqual(nextEcosystemSagaSteps(saga), []);

  saga = recordEcosystemSagaStep(saga, {
    stepId: 'pipeline-contract',
    status: 'compensated',
    evidence: ['revert:abcdef1'],
    completedAt: '2026-07-28T10:00:00Z',
  });
  assert.equal(saga.state, 'blocked');
  assert.equal(saga.steps.find(({ id }) => id === 'cli-behavior').status, 'pending');
  assert.deepEqual(nextEcosystemSagaSteps(saga), []);

  const invalidReady = {
    ...saga,
    steps: saga.steps.map((step) => (
      step.id === 'cli-behavior' ? { ...step, status: 'ready' } : step
    )),
  };
  const repaired = reconcileEcosystemSaga(invalidReady);
  assert.equal(repaired.steps.find(({ id }) => id === 'cli-behavior').status, 'pending');
});

test('recording an already-observed saga step is idempotent', () => {
  let saga = createEcosystemSaga({
    id: 'SAGA-idempotent-record',
    subject: 'Idempotent release recording',
    participants,
    steps,
    createdAt: at,
  });
  const update = {
    stepId: 'pipeline-contract',
    status: 'completed',
    evidence: ['commit:abcdef1'],
    completedAt: '2026-07-28T10:00:00Z',
  };
  saga = recordEcosystemSagaStep(saga, update);
  const replayed = recordEcosystemSagaStep(saga, update);
  assert.deepEqual(replayed, saga);
  assert.deepEqual(
    replayed.steps.find(({ id }) => id === 'pipeline-contract').evidence,
    ['commit:abcdef1'],
  );
  assert.throws(
    () => recordEcosystemSagaStep(saga, {
      ...update,
      completedAt: '2026-07-28T10:00:01Z',
    }),
    /Conflicting replay/,
  );
});

function releaseParticipant(id, repository, repoLocalSpecId, targetVersion, packageName) {
  return {
    id,
    repository,
    repoLocalSpecId,
    state: 'pending',
    sourceVersion: null,
    targetVersion,
    targetBranch: 'release/operating-board',
    commit: null,
    pullRequest: { number: null, url: null, state: 'none' },
    tag: null,
    checks: [{ name: 'ci', state: 'pending' }],
    approvals: [{ gate: 'merge', state: 'pending' }],
    package: {
      name: packageName,
      version: targetVersion,
      published: false,
      tarballDigest: null,
    },
    nextSafeAction: 'Prepare the repository release.',
  };
}

function releaseOperationInput(participantList = [
  releaseParticipant('pipeline', 'openplanr/planr-pipeline', 'SPEC-002', '0.30.0', 'planr-pipeline'),
  releaseParticipant('cli', 'openplanr/OpenPlanr', 'SPEC-002', '1.14.0', 'openplanr'),
]) {
  return {
    operationId: 'OPERATE-SPEC-002',
    specId: 'SPEC-002',
    specDigest: digest('a'),
    state: 'drafted',
    recoveryMode: 'compensation-available',
    createdAt: at,
    updatedAt: at,
    participants: participantList,
    nextSafeAction: 'Prepare pipeline first.',
  };
}

test('release operation digest binds the immutable cross-repository release plan', () => {
  const input = releaseOperationInput();
  const operation = createEcosystemReleaseOperation(input);
  assert.equal(operation.operationDigest, computeEcosystemReleaseOperationDigest(input));

  const reordered = { ...input, participants: [...input.participants].reverse() };
  assert.equal(
    computeEcosystemReleaseOperationDigest(reordered),
    operation.operationDigest,
    'participant discovery order must not alter the operation identity',
  );

  assert.throws(() => createEcosystemReleaseOperation({
    ...input,
    operationDigest: digest('f'),
  }), /digest does not match/);
});

test('release reconciliation switches to forward-fix once any package is published', () => {
  const operation = createEcosystemReleaseOperation(releaseOperationInput());
  const prepared = reconcileEcosystemReleaseOperation(operation, [
    { id: 'pipeline', state: 'prepared', nextSafeAction: 'Promote the pipeline package.' },
    { id: 'cli', state: 'prepared', nextSafeAction: 'Wait for the pipeline package.' },
  ], { updatedAt: '2026-07-28T10:00:00Z' });
  assert.equal(prepared.state, 'prepared');
  assert.equal(prepared.recoveryMode, 'compensation-available');
  assert.equal(prepared.nextSafeAction, 'Wait for the pipeline package.');

  const published = reconcileEcosystemReleaseOperation(prepared, [{
    id: 'pipeline',
    state: 'forward-fix',
    package: { ...prepared.participants[0].package, published: true, tarballDigest: digest('b') },
    nextSafeAction: 'Publish a correcting pipeline patch.',
  }], { updatedAt: '2026-07-28T11:00:00Z' });
  assert.equal(published.state, 'forward-fix');
  assert.equal(published.recoveryMode, 'forward-fix-only');
  assert.equal(published.nextSafeAction, 'Publish a correcting pipeline patch.');

  const staleObservation = reconcileEcosystemReleaseOperation(published, [{
    id: 'pipeline',
    package: { published: false, tarballDigest: null },
  }]);
  assert.equal(staleObservation.recoveryMode, 'forward-fix-only');
  assert.equal(staleObservation.participants[0].package.published, true);
  assert.equal(staleObservation.participants[0].package.tarballDigest, digest('b'));
  assert.deepEqual(
    reconcileEcosystemReleaseOperation(staleObservation, [{
      id: 'pipeline',
      package: { published: false, tarballDigest: null },
    }]),
    staleObservation,
    'replaying a stale observation must be idempotent',
  );
  assert.throws(
    () => reconcileEcosystemReleaseOperation(published, [{ id: 'unknown', state: 'prepared' }]),
    /Unknown observed release participant/,
  );
});

test('release reconciliation maps compensation and completion to coherent operation states', () => {
  const operation = createEcosystemReleaseOperation(releaseOperationInput());
  const compensating = reconcileEcosystemReleaseOperation(operation, [{
    id: 'pipeline',
    state: 'compensated',
    nextSafeAction: 'Verify the pipeline revert before closing prepared work.',
  }]);
  assert.equal(compensating.state, 'compensating');
  assert.equal(
    compensating.nextSafeAction,
    'Verify the pipeline revert before closing prepared work.',
  );
  assert.throws(
    () => reconcileEcosystemReleaseOperation(compensating, [{
      id: 'pipeline',
      state: 'prepared',
    }]),
    /compensated release participant is terminal/,
  );

  const completed = reconcileEcosystemReleaseOperation(operation, [
    { id: 'pipeline', state: 'completed', nextSafeAction: 'No pipeline action.' },
    { id: 'cli', state: 'completed', nextSafeAction: 'No CLI action.' },
  ]);
  assert.equal(completed.state, 'completed');
  assert.equal(
    completed.nextSafeAction,
    'No further action; the ecosystem release operation is complete.',
  );
});

test('release operations reject duplicate participants and incoherent aggregate state', () => {
  const pipeline = releaseParticipant(
    'pipeline',
    'openplanr/planr-pipeline',
    'SPEC-002',
    '0.30.0',
    'planr-pipeline',
  );
  assert.throws(() => createEcosystemReleaseOperation(releaseOperationInput([
    pipeline,
    { ...pipeline, repository: 'openplanr/different-repository' },
  ])), /Release participant IDs must be unique/);

  assert.throws(() => createEcosystemReleaseOperation({
    ...releaseOperationInput(),
    state: 'completed',
  }), /state completed conflicts with participant state preparing/);

  const operation = createEcosystemReleaseOperation(releaseOperationInput());
  const duplicateLoadedParticipant = {
    ...operation,
    participants: [
      operation.participants[0],
      { ...operation.participants[1], id: operation.participants[0].id },
    ],
  };
  assert.throws(
    () => reconcileEcosystemReleaseOperation(duplicateLoadedParticipant, []),
    /Release participant IDs must be unique/,
  );
  assert.throws(
    () => reconcileEcosystemReleaseOperation(operation, [{
      id: 'pipeline',
      targetVersion: '0.31.0',
    }]),
    /changed the digest-bound release plan/,
  );
  assert.throws(
    () => reconcileEcosystemReleaseOperation(operation, [{
      id: 'pipeline',
      state: 'compensated',
      package: { published: true, tarballDigest: digest('c') },
    }]),
    /cannot be compensated/,
  );
});

test('top-level next safe action is deterministic across participant discovery order', () => {
  const input = releaseOperationInput();
  const operation = createEcosystemReleaseOperation(input);
  const reordered = createEcosystemReleaseOperation({
    ...input,
    participants: [...input.participants].reverse(),
  });
  const observations = [
    { id: 'pipeline', state: 'prepared', nextSafeAction: 'Promote pipeline.' },
    { id: 'cli', state: 'prepared', nextSafeAction: 'Wait for pipeline.' },
  ];
  const reconciled = reconcileEcosystemReleaseOperation(operation, observations);
  const reorderedReconciled = reconcileEcosystemReleaseOperation(
    reordered,
    [...observations].reverse(),
  );
  assert.equal(reconciled.nextSafeAction, 'Wait for pipeline.');
  assert.equal(reorderedReconciled.nextSafeAction, reconciled.nextSafeAction);
  assert.equal(reorderedReconciled.operationDigest, reconciled.operationDigest);
});
