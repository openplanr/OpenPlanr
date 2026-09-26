import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { withDocumentDigest } from '@openplanr/protocol/canonical-json';

import {
  checkpointSession,
  createConsentRecord,
  createSkillSession,
  LIFECYCLE_CONFIGURATION_PATH,
  LIFECYCLE_IGNORE_RULE,
  LOCAL_LEARNING_PATH,
  loadLatestSessionProgress,
  persistLearningRecord,
  persistSessionProgress,
  prepareLearningRecord,
  saveLifecycleConfiguration,
  updateSkillSession,
} from '../../packages/skill-runtime/src/lifecycle/index.mjs';

const projectIdentity = `sha256:${'1'.repeat(64)}`;
const confirmation = {
  kind: 'guided-confirmation',
  schemaVersion: '1.0.0',
  protocolVersion: '1.2.0',
  confirmationId: 'GIC-lifecycleintegrity01',
  state: 'confirmed',
  actionId: 'consent.learning',
  sessionId: 'GIS-lifecycleintegrity01',
  command: 'planr plan',
  effect: 'read-only',
  providerUse: false,
  confirmationScope: 'Enable project-local learning notes.',
  confirmationDigest: `sha256:${'2'.repeat(64)}`,
  projectIdentity,
  projectHead: `sha256:${'3'.repeat(64)}`,
  configHead: `sha256:${'4'.repeat(64)}`,
  arguments: ['--skill', 'planr-plan', '--subject', 'learning', '--decision', 'granted'],
  destinations: [],
  writes: [],
  createdAt: '2026-08-30T11:55:00.000Z',
  expiresAt: '2026-08-30T12:05:00.000Z',
  confirmedAt: '2026-08-30T11:56:00.000Z',
  confirmedBy: 'human-owner',
};

function temporaryGitProject() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'openplanr-lifecycle-integrity-'));
  const initialized = spawnSync('git', ['init', '--quiet'], { cwd: projectRoot, encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr);
  return projectRoot;
}

function learningRecord() {
  const consent = createConsentRecord({
    consentId: 'consent-learning-lifecycleintegrity01',
    skillId: 'planr-plan',
    subject: 'learning',
    decision: 'granted',
    recordedAt: '2026-08-30T12:00:00.000Z',
    projectIdentity,
    confirmation,
  });
  return prepareLearningRecord({
    learningId: 'learning-lifecycleintegrity01',
    skillId: 'planr-plan',
    observedAt: '2026-08-30T12:00:00.000Z',
    category: 'diagnostic',
    note: 'Prefer one concise question for a material decision.',
    projectIdentity,
    consent,
  });
}

function assertIgnored(projectRoot, path) {
  const ignored = spawnSync('git', ['check-ignore', '--quiet', '--no-index', path], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.equal(ignored.status, 0, ignored.stderr);
  const exclude = readFileSync(join(projectRoot, '.git', 'info', 'exclude'), 'utf8');
  assert.ok(exclude.split(/\r?\n/u).includes(LIFECYCLE_IGNORE_RULE));
}

test('session creation, transitions, and recovery enforce the complete Protocol contract', () => {
  const valid = createSkillSession({
    skillId: 'planr-plan',
    questions: [],
    now: '2026-08-30T12:00:00.000Z',
    createSessionId: () => 'GIS-sessioncontract01',
  });

  assert.throws(
    () =>
      createSkillSession({
        skillId: 'not a skill id',
        now: '2026-08-30T12:00:00.000Z',
        createSessionId: () => 'GIS-sessioncontract02',
      }),
    /complete Protocol 1\.6 skill-session contract/u,
  );
  assert.throws(
    () =>
      createSkillSession({
        skillId: 'planr-plan',
        questions: [{}],
        now: '2026-08-30T12:00:00.000Z',
        createSessionId: () => 'GIS-sessioncontract03',
      }),
    /complete Protocol 1\.6 skill-session contract/u,
  );
  assert.throws(
    () =>
      createSkillSession({
        skillId: 'planr-plan',
        startedAt: '2026-08-30',
        createSessionId: () => 'GIS-sessioncontract04',
      }),
    /complete Protocol 1\.6 skill-session contract/u,
  );
  assert.throws(
    () => updateSkillSession(valid, { state: 'answered', questions: [{}] }),
    /complete Protocol 1\.6 skill-session contract/u,
  );

  const forged = withDocumentDigest({
    ...valid,
    documentDigest: undefined,
    skillId: 'not a skill id',
  });
  const checkpoint = checkpointSession({
    session: forged,
    context: {},
    now: '2026-08-30T12:00:00.000Z',
  });
  assert.equal(checkpoint.status, 'partial');
  assert.equal(checkpoint.checkpoint, null);
});

test('progress expiry cannot be extended without invalidating the persisted record', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'openplanr-progress-integrity-'));
  try {
    const session = createSkillSession({
      skillId: 'planr-plan',
      now: '2026-08-30T12:00:00.000Z',
      createSessionId: () => 'GIS-progressintegrity01',
    });
    const persisted = persistSessionProgress({
      projectRoot,
      session,
      context: { task: 'SPEC-002/T-005' },
      safeState: { activeTask: 'T-005' },
      now: '2026-08-30T12:00:00.000Z',
      ttlMs: 60 * 60 * 1000,
    });
    assert.equal(persisted.status, 'completed');

    const path = join(projectRoot, persisted.path);
    const record = JSON.parse(readFileSync(path, 'utf8'));
    assert.match(record.documentDigest, /^sha256:[a-f0-9]{64}$/u);
    writeFileSync(
      path,
      `${JSON.stringify({ ...record, expiresAt: '2099-01-01T00:00:00.000Z' })}\n`,
    );

    const loaded = loadLatestSessionProgress({
      projectRoot,
      skillId: 'planr-plan',
      now: '2026-08-30T13:30:00.000Z',
    });
    assert.equal(loaded.status, 'unavailable');
    assert.equal(loaded.record, null);
    assert.equal(loaded.unreadable, 1);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('each public state writer prepares an ignored project-local destination', () => {
  const progressProject = temporaryGitProject();
  const configurationProject = temporaryGitProject();
  const learningProject = temporaryGitProject();
  try {
    const session = createSkillSession({
      skillId: 'planr-plan',
      now: '2026-08-30T12:00:00.000Z',
      createSessionId: () => 'GIS-directprogress01',
    });
    const progress = persistSessionProgress({
      projectRoot: progressProject,
      session,
      context: { task: 'SPEC-002/T-005' },
      now: '2026-08-30T12:00:00.000Z',
    });
    assert.equal(progress.status, 'completed');
    assertIgnored(progressProject, progress.path);

    const configuration = saveLifecycleConfiguration({
      projectRoot: configurationProject,
      settings: { history: true },
    });
    assert.equal(configuration.status, 'completed');
    assertIgnored(configurationProject, LIFECYCLE_CONFIGURATION_PATH);

    const learning = persistLearningRecord({
      projectRoot: learningProject,
      prepared: learningRecord(),
    });
    assert.equal(learning.status, 'completed');
    assertIgnored(learningProject, LOCAL_LEARNING_PATH);
  } finally {
    rmSync(progressProject, { recursive: true, force: true });
    rmSync(configurationProject, { recursive: true, force: true });
    rmSync(learningProject, { recursive: true, force: true });
  }
});

test('public state writers decline when the local ignore destination is hostile', () => {
  const projectRoot = temporaryGitProject();
  const outside = mkdtempSync(join(tmpdir(), 'openplanr-lifecycle-ignore-outside-'));
  const outsideExclude = join(outside, 'exclude');
  const exclude = join(projectRoot, '.git', 'info', 'exclude');
  try {
    writeFileSync(outsideExclude, 'keep-outside-unchanged\n', 'utf8');
    unlinkSync(exclude);
    symlinkSync(outsideExclude, exclude, 'file');

    const session = createSkillSession({
      skillId: 'planr-plan',
      now: '2026-08-30T12:00:00.000Z',
      createSessionId: () => 'GIS-hostileignore01',
    });
    const progress = persistSessionProgress({
      projectRoot,
      session,
      context: { task: 'SPEC-002/T-005' },
      now: '2026-08-30T12:00:00.000Z',
    });
    assert.equal(progress.status, 'partial');
    assert.equal(progress.path, null);

    const configuration = saveLifecycleConfiguration({
      projectRoot,
      settings: { history: true },
    });
    assert.equal(configuration.status, 'partial');
    assert.equal(configuration.path, null);

    const learning = persistLearningRecord({ projectRoot, prepared: learningRecord() });
    assert.deepEqual(learning, {
      status: 'blocked',
      path: null,
      reason: 'learning-destination-denied',
    });

    assert.equal(existsSync(join(projectRoot, '.planr', 'runtime')), false);
    assert.equal(readFileSync(outsideExclude, 'utf8'), 'keep-outside-unchanged\n');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
