import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  LIFECYCLE_CONFIGURATION_PATH,
  LIFECYCLE_IGNORE_RULE,
  assessLifecycleCompatibility,
  closeSessionProgress,
  createConsentRecord,
  detectLifecycleEnvironment,
  executeAtEffectBoundary,
  loadLifecycleConfiguration,
  persistSessionProgress,
  prepareLifecycleEnvironment,
  saveLifecycleConfiguration,
  startSkillInteraction,
  startSkillLifecycle,
} from '../../packages/skill-runtime/src/lifecycle/index.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const fixture = JSON.parse(readFileSync(join(
  root,
  'packages',
  'skill-runtime',
  'fixtures',
  'lifecycle',
  'runtime-journeys.json',
), 'utf8'));
const consentConfirmation = {
  ...JSON.parse(readFileSync(join(
    root,
    'tests',
    'protocol',
    'fixtures',
    'skill-source',
    'skill-consent-record.json',
  ), 'utf8')).confirmation,
  arguments: ['--skill', fixture.skillId, '--subject', 'learning', '--decision', 'granted'],
  projectIdentity: fixture.projectIdentity,
  createdAt: '2026-08-31T07:55:00.000Z',
  confirmedAt: '2026-08-31T07:56:00.000Z',
  expiresAt: '2026-08-31T08:05:00.000Z',
};
const hostProfiles = JSON.parse(readFileSync(join(
  root,
  'packages',
  'protocol',
  'registries',
  'skill-host-profiles.json',
), 'utf8'));
const capabilityMatrix = JSON.parse(readFileSync(join(
  root,
  'packages',
  'skill-runtime',
  'fixtures',
  'resolver',
  'capability-matrix.json',
), 'utf8'));
const interactionQuestions = JSON.parse(readFileSync(join(
  root,
  'packages',
  'skill-runtime',
  'fixtures',
  'resolver',
  'question-fallbacks.json',
), 'utf8'));
const codexProfile = hostProfiles.profiles.find(({ hostProfileId }) => hostProfileId === 'codex-default');

function temporaryProject() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'openplanr-skill-lifecycle-'));
  const initialized = spawnSync('git', ['init', '--quiet'], { cwd: projectRoot, encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr);
  return projectRoot;
}

function removeProject(projectRoot) {
  rmSync(projectRoot, { recursive: true, force: true });
}

test('lifecycle start prepares ignored project-local state with quiet defaults', () => {
  const projectRoot = temporaryProject();
  const originalFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = () => {
    fetched = true;
    throw new Error('lifecycle start must not access the network');
  };
  try {
    const started = startSkillLifecycle({
      projectRoot,
      skillId: fixture.skillId,
      projectIdentity: fixture.projectIdentity,
      context: fixture.context,
      now: fixture.firstRunAt,
      createSessionId: () => fixture.sessionId,
    });
    assert.equal(started.status, 'completed');
    assert.equal(started.environment.status, 'completed');
    assert.equal(started.environment.stateAvailable, true);
    assert.equal(started.environment.runtimeIgnored, true);
    assert.equal(started.firstRun.firstRun, true);
    assert.deepEqual(started.settings.settings, fixture.defaults);
    assert.equal(started.recovery.mode, 'fresh');
    assert.equal(fetched, false);

    const exclude = readFileSync(join(projectRoot, '.git', 'info', 'exclude'), 'utf8');
    assert.ok(exclude.split(/\r?\n/u).includes(LIFECYCLE_IGNORE_RULE));
    const detected = detectLifecycleEnvironment({ projectRoot });
    assert.equal(detected.runtimeIgnored, true);
    assert.equal(detected.stateExists, true);

    const restarted = startSkillLifecycle({
      projectRoot,
      skillId: fixture.skillId,
      projectIdentity: fixture.projectIdentity,
      context: fixture.context,
      now: fixture.resumeAt,
      createSessionId: () => 'GIS-runtimejourney02',
    });
    assert.equal(restarted.firstRun.firstRun, false);
  } finally {
    globalThis.fetch = originalFetch;
    removeProject(projectRoot);
  }
});

test('configuration is local, strict, and separate from data-feature consent', () => {
  const projectRoot = temporaryProject();
  try {
    prepareLifecycleEnvironment({ projectRoot });
    const saved = saveLifecycleConfiguration({
      projectRoot,
      settings: { history: true, learning: true },
    });
    assert.equal(saved.path, LIFECYCLE_CONFIGURATION_PATH);
    const loaded = loadLifecycleConfiguration({ projectRoot });
    assert.equal(loaded.settings.history, true);
    assert.equal(loaded.settings.learning, true);

    const started = startSkillLifecycle({
      projectRoot,
      skillId: fixture.skillId,
      projectIdentity: fixture.projectIdentity,
      context: fixture.context,
      now: fixture.firstRunAt,
      createSessionId: () => fixture.sessionId,
    });
    assert.equal(started.settings.settings.history, true);
    assert.equal(started.settings.settings.learning, false);
    assert.equal(started.settings.diagnostics[0].reason, 'explicit-opt-in-required');

    const consent = createConsentRecord({
      consentId: 'consent-learning-runtimejourney01',
      skillId: fixture.skillId,
      subject: 'learning',
      decision: 'granted',
      recordedAt: fixture.firstRunAt,
      projectIdentity: fixture.projectIdentity,
      confirmation: consentConfirmation,
    });
    const optedIn = startSkillLifecycle({
      projectRoot,
      skillId: fixture.skillId,
      projectIdentity: fixture.projectIdentity,
      context: fixture.context,
      consents: [consent],
      now: fixture.firstRunAt,
      createSessionId: () => 'GIS-runtimejourney05',
    });
    assert.equal(optedIn.settings.settings.learning, true);

    writeFileSync(join(projectRoot, LIFECYCLE_CONFIGURATION_PATH), '{"kind":"unknown"}\n');
    const invalid = loadLifecycleConfiguration({ projectRoot });
    assert.equal(invalid.status, 'partial');
    assert.deepEqual(invalid.settings, fixture.defaults);
  } finally {
    removeProject(projectRoot);
  }
});

test('compatible progress resumes and expired progress is cleaned without blocking', () => {
  const projectRoot = temporaryProject();
  try {
    const first = startSkillLifecycle({
      projectRoot,
      skillId: fixture.skillId,
      projectIdentity: fixture.projectIdentity,
      context: fixture.context,
      now: fixture.firstRunAt,
      createSessionId: () => fixture.sessionId,
    });
    const persisted = persistSessionProgress({
      projectRoot,
      session: first.recovery.session,
      context: fixture.context,
      safeState: fixture.safeState,
      now: fixture.firstRunAt,
      ttlMs: 60 * 60 * 1000,
    });
    assert.equal(persisted.status, 'completed');
    assert.equal(existsSync(join(projectRoot, persisted.path)), true);

    const resumed = startSkillLifecycle({
      projectRoot,
      skillId: fixture.skillId,
      projectIdentity: fixture.projectIdentity,
      context: fixture.context,
      now: fixture.resumeAt,
      createSessionId: () => 'GIS-runtimejourney03',
    });
    assert.equal(resumed.compatibility.compatible, true);
    assert.equal(resumed.recovery.mode, 'recovered');
    assert.deepEqual(resumed.recovery.safeState, fixture.safeState);

    const expired = startSkillLifecycle({
      projectRoot,
      skillId: fixture.skillId,
      projectIdentity: fixture.projectIdentity,
      context: fixture.context,
      now: fixture.expiredAt,
      createSessionId: () => 'GIS-runtimejourney04',
    });
    assert.equal(expired.cleanup.removed.length, 1);
    assert.equal(expired.recovery.mode, 'fresh');
    assert.equal(existsSync(join(projectRoot, persisted.path)), false);
  } finally {
    removeProject(projectRoot);
  }
});

test('compatibility and explicit close use concise fresh-state behavior', () => {
  const incompatible = assessLifecycleCompatibility({
    state: {
      stateVersion: '9.0.0',
      runtimeVersion: '9.0.0',
      protocolVersion: '9.0.0',
    },
  });
  assert.equal(incompatible.compatible, false);
  assert.equal(incompatible.mode, 'fresh');
  assert.doesNotMatch(incompatible.notice, /digest|hash|receipt/iu);

  const projectRoot = temporaryProject();
  try {
    const started = startSkillLifecycle({
      projectRoot,
      skillId: fixture.skillId,
      projectIdentity: fixture.projectIdentity,
      context: fixture.context,
      now: fixture.firstRunAt,
      createSessionId: () => fixture.sessionId,
    });
    persistSessionProgress({
      projectRoot,
      session: started.recovery.session,
      context: fixture.context,
      safeState: fixture.safeState,
      now: fixture.firstRunAt,
    });
    const closed = closeSessionProgress({ projectRoot, sessionId: fixture.sessionId });
    assert.equal(closed.removed, true);
    assert.equal(closeSessionProgress({ projectRoot, sessionId: fixture.sessionId }).removed, false);
  } finally {
    removeProject(projectRoot);
  }
});

test('external and destructive operations dispatch once to the host boundary', async () => {
  const requests = [];
  const hostExecutor = async (request) => {
    requests.push(request);
    return { applied: true };
  };
  const localExecutor = () => assert.fail('host-owned effects must not use the local executor');

  const external = await executeAtEffectBoundary({
    operationClass: 'external-effect',
    localExecutor,
    hostExecutor,
  });
  const destructive = await executeAtEffectBoundary({
    operationClass: 'destructive',
    localExecutor,
    hostExecutor,
  });
  assert.equal(external.status, 'completed');
  assert.equal(destructive.status, 'completed');
  assert.deepEqual(requests, [
    { operationClass: 'external-effect', effect: 'external' },
    { operationClass: 'destructive', effect: 'destructive' },
  ]);

  const local = await executeAtEffectBoundary({
    operationClass: 'planning',
    localExecutor: (request) => ({ request }),
  });
  assert.equal(local.status, 'completed');
  const unavailable = await executeAtEffectBoundary({ operationClass: 'external-effect' });
  assert.equal(unavailable.status, 'unavailable');

  for (const status of ['partial', 'blocked', 'unavailable', 'cancelled']) {
    const typed = await executeAtEffectBoundary({
      operationClass: 'external-effect',
      hostExecutor: () => ({ status, reason: `host-${status}` }),
    });
    assert.equal(typed.status, status);
    assert.equal(typed.output.status, status);
    assert.equal(typed.output.reason, `host-${status}`);
  }
  const denied = await executeAtEffectBoundary({
    operationClass: 'external-effect',
    hostExecutor: () => ({ status: 'denied', reason: 'host-policy' }),
  });
  assert.equal(denied.status, 'unavailable');
  assert.equal(denied.output.status, 'denied');

  const hostFailure = new Error('host stopped the effect');
  await assert.rejects(
    executeAtEffectBoundary({ operationClass: 'destructive', hostExecutor: () => { throw hostFailure; } }),
    (error) => error === hostFailure,
  );
});

test('skill interaction starts from recovered lifecycle questions without adding a policy layer', () => {
  const projectRoot = temporaryProject();
  try {
    const first = startSkillLifecycle({
      projectRoot,
      skillId: fixture.skillId,
      projectIdentity: fixture.projectIdentity,
      context: fixture.context,
      questions: [interactionQuestions.materialChoice],
      now: fixture.firstRunAt,
      createSessionId: () => fixture.sessionId,
    });
    persistSessionProgress({
      projectRoot,
      session: first.recovery.session,
      context: fixture.context,
      now: fixture.firstRunAt,
    });

    const started = startSkillInteraction({
      projectRoot,
      skillId: fixture.skillId,
      context: fixture.context,
      questions: [interactionQuestions.materialChoice],
      hostProfile: codexProfile,
      runtimeCapabilities: capabilityMatrix['codex-native'],
      repositoryContext: {},
      questionnaire: {
        digest: `sha256:${'5'.repeat(64)}`,
        questionnaireVersion: '1.0.0',
        command: 'planr-plan',
        projectIdentity: fixture.projectIdentity,
        projectHead: `sha256:${'6'.repeat(64)}`,
        configHead: `sha256:${'7'.repeat(64)}`,
      },
      now: fixture.resumeAt,
    });

    assert.equal(started.status, started.interaction.status);
    assert.equal(started.lifecycle.recovery.mode, 'recovered');
    assert.equal(started.interaction.surface, 'native');
    assert.equal(started.interaction.sessionId, fixture.sessionId);
    assert.deepEqual(started.interaction.questions, [interactionQuestions.materialChoice]);
    assert.equal(started.interaction.session.projectIdentity, fixture.projectIdentity);
  } finally {
    removeProject(projectRoot);
  }
});

test('unsafe state paths degrade to an in-memory lifecycle without escaping the project', () => {
  const projectRoot = temporaryProject();
  const outside = mkdtempSync(join(tmpdir(), 'openplanr-skill-lifecycle-outside-'));
  try {
    symlinkSync(outside, join(projectRoot, '.planr'), 'dir');
    const environment = prepareLifecycleEnvironment({ projectRoot });
    assert.equal(environment.status, 'partial');
    assert.equal(environment.stateAvailable, false);
    assert.equal(existsSync(join(outside, 'runtime')), false);

    const started = startSkillLifecycle({
      projectRoot,
      skillId: fixture.skillId,
      projectIdentity: fixture.projectIdentity,
      context: fixture.context,
      now: fixture.firstRunAt,
      createSessionId: () => fixture.sessionId,
    });
    assert.equal(started.status, 'completed');
    assert.equal(started.recovery.mode, 'fresh');
    assert.equal(started.environment.stateAvailable, false);
  } finally {
    removeProject(projectRoot);
    rmSync(outside, { recursive: true, force: true });
  }
});
