import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { withDocumentDigest } from '../../packages/protocol/src/canonical-json.mjs';
import { validateProtocolArtifact } from '../../packages/protocol/src/contracts.mjs';
import {
  checkpointSession,
  classifyOperation,
  completionFromRuntimeResult,
  createCompletion,
  createConsentRecord,
  createSkillSession,
  LOCAL_LEARNING_PATH,
  persistLearningRecord,
  prepareLearningRecord,
  recoverSession,
  resolveLifecycleSettings,
  updateSkillSession,
} from '../../packages/skill-runtime/src/lifecycle/index.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const fixture = JSON.parse(
  readFileSync(
    join(root, 'packages', 'skill-runtime', 'fixtures', 'lifecycle', 'journeys.json'),
    'utf8',
  ),
);
const guidedFixture = JSON.parse(
  readFileSync(
    join(root, 'tests', 'protocol', 'fixtures', 'skill-source', 'skill-consent-record.json'),
    'utf8',
  ),
).confirmation;
const questions = JSON.parse(
  readFileSync(
    join(root, 'packages', 'skill-runtime', 'fixtures', 'resolver', 'question-fallbacks.json'),
    'utf8',
  ),
);
const guided = {
  ...guidedFixture,
  arguments: ['--skill', fixture.skillId, '--subject', 'learning', '--decision', 'granted'],
  createdAt: '2026-08-30T11:55:00.000Z',
  confirmedAt: '2026-08-30T11:56:00.000Z',
  expiresAt: '2026-08-30T12:05:00.000Z',
};
const projectIdentity = guided.projectIdentity;
const consent = createConsentRecord({
  consentId: 'consent-learning-lifecycle01',
  skillId: fixture.skillId,
  subject: 'learning',
  decision: 'granted',
  recordedAt: fixture.now,
  projectIdentity,
  confirmation: guided,
});

test('new projects start with every data and background feature disabled', () => {
  let fetched = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    fetched = true;
    throw new Error('network access is forbidden in the default lifecycle');
  };
  try {
    const result = resolveLifecycleSettings({ skillId: fixture.skillId });
    assert.deepEqual(result.settings, fixture.defaults);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('configuration and explicit data-feature consent remain separate', () => {
  const configuredOnly = resolveLifecycleSettings({
    skillId: fixture.skillId,
    configured: { learning: true, telemetry: true, externalData: true },
    headless: true,
  });
  assert.equal(configuredOnly.settings.learning, false);
  assert.equal(configuredOnly.settings.telemetry, false);
  assert.equal(configuredOnly.settings.externalData, false);
  assert.deepEqual(
    configuredOnly.diagnostics.map(({ status }) => status),
    ['unavailable', 'unavailable', 'unavailable'],
  );

  const optedIn = resolveLifecycleSettings({
    skillId: fixture.skillId,
    configured: { learning: true },
    projectIdentity,
    consents: [consent],
    headless: true,
  });
  assert.equal(optedIn.settings.learning, true);
  assert.equal(optedIn.diagnostics.length, 0);
});

test('explicit data-feature decisions reuse the existing guided interaction contract', () => {
  const record = createConsentRecord({
    consentId: 'consent-learning-lifecycle02',
    skillId: fixture.skillId,
    subject: 'learning',
    decision: 'granted',
    recordedAt: fixture.now,
    projectIdentity,
    confirmation: guided,
  });
  assert.deepEqual(
    validateProtocolArtifact('skill-consent-record', record, { protocolVersion: '1.6.0' }),
    [],
  );
});

test('data-feature consent rejects forged, mismatched, stale, and cross-project confirmations', () => {
  const base = {
    consentId: 'consent-learning-hostile01',
    skillId: fixture.skillId,
    subject: 'learning',
    decision: 'granted',
    recordedAt: fixture.now,
    projectIdentity,
  };
  assert.throws(
    () =>
      createConsentRecord({
        ...base,
        confirmation: { kind: 'guided-confirmation', state: 'confirmed' },
      }),
    /Protocol guided-confirmation contract/u,
  );
  assert.throws(
    () =>
      createConsentRecord({
        ...base,
        confirmation: { ...guided, actionId: 'consent.telemetry' },
      }),
    /confirmation\.actionId must be consent\.learning/u,
  );
  assert.throws(
    () =>
      createConsentRecord({
        ...base,
        confirmation: { ...guided, expiresAt: '2026-08-30T11:59:00.000Z' },
      }),
    /before its Protocol expiry/u,
  );
  assert.throws(
    () =>
      createConsentRecord({
        ...base,
        projectIdentity: `sha256:${'4'.repeat(64)}`,
        confirmation: guided,
      }),
    /active project identity/u,
  );
  assert.throws(
    () =>
      createConsentRecord({
        ...base,
        skillId: 'planr-ship',
        confirmation: guided,
      }),
    /exact skill, subject, and decision/u,
  );
  assert.throws(
    () =>
      createConsentRecord({
        ...base,
        decision: 'declined',
        confirmation: guided,
      }),
    /exact skill, subject, and decision/u,
  );

  const rebound = withDocumentDigest({
    ...consent,
    confirmation: { ...consent.confirmation, actionId: 'consent.telemetry' },
  });
  const ignored = resolveLifecycleSettings({
    skillId: fixture.skillId,
    configured: { learning: true },
    projectIdentity,
    consents: [rebound],
  });
  assert.equal(ignored.settings.learning, false);
  assert.equal(ignored.decisions.learning, 'unset');

  const otherProject = resolveLifecycleSettings({
    skillId: fixture.skillId,
    configured: { learning: true },
    projectIdentity: `sha256:${'4'.repeat(64)}`,
    consents: [consent],
  });
  assert.equal(otherProject.settings.learning, false);
  assert.equal(otherProject.decisions.learning, 'unset');

  const replayedAcrossSkill = withDocumentDigest({
    ...consent,
    skillId: 'planr-ship',
  });
  const ignoredSkillReplay = resolveLifecycleSettings({
    skillId: 'planr-ship',
    configured: { learning: true },
    projectIdentity,
    consents: [replayedAcrossSkill],
  });
  assert.equal(ignoredSkillReplay.settings.learning, false);
  assert.equal(ignoredSkillReplay.decisions.learning, 'unset');

  const replayedAcrossDecision = withDocumentDigest({
    ...consent,
    decision: 'declined',
  });
  const ignoredDecisionReplay = resolveLifecycleSettings({
    skillId: fixture.skillId,
    configured: { learning: true },
    projectIdentity,
    consents: [replayedAcrossDecision],
  });
  assert.equal(ignoredDecisionReplay.settings.learning, false);
  assert.equal(ignoredDecisionReplay.decisions.learning, 'unset');
});

test('compatible checkpoints restore safe state without exposing binding digests', () => {
  const session = createSkillSession({
    skillId: fixture.skillId,
    now: fixture.now,
    createSessionId: () => fixture.sessionId,
  });
  assert.deepEqual(
    validateProtocolArtifact('skill-session', session, { protocolVersion: '1.6.0' }),
    [],
  );

  const saved = checkpointSession({
    session,
    context: fixture.context,
    safeState: fixture.safeState,
    now: fixture.now,
  });
  assert.equal(saved.status, 'completed');
  const resumed = recoverSession({
    checkpoint: saved.checkpoint,
    skillId: fixture.skillId,
    context: fixture.context,
  });
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.mode, 'recovered');
  assert.deepEqual(resumed.safeState, fixture.safeState);
  assert.doesNotMatch(resumed.notice, /sha256|GIS-/u);
});

test('incompatible or unsafe checkpoints never block current work', () => {
  const session = createSkillSession({
    skillId: fixture.skillId,
    now: fixture.now,
    createSessionId: () => fixture.sessionId,
  });
  const unsafe = checkpointSession({
    session,
    context: fixture.context,
    safeState: { apiToken: 'private' },
    now: fixture.now,
  });
  assert.equal(unsafe.status, 'partial');
  assert.equal(unsafe.checkpoint, null);

  const saved = checkpointSession({
    session,
    context: fixture.context,
    safeState: fixture.safeState,
    now: fixture.now,
  });
  const fresh = recoverSession({
    checkpoint: saved.checkpoint,
    skillId: fixture.skillId,
    context: { ...fixture.context, task: 'SPEC-002/T-006' },
    now: fixture.now,
    createSessionId: () => 'GIS-lifecyclefixture02',
  });
  assert.equal(fresh.status, 'completed');
  assert.equal(fresh.mode, 'fresh');
  assert.deepEqual(fresh.safeState, {});
  assert.match(fresh.notice, /Started fresh/u);
  assert.doesNotMatch(fresh.notice, /sha256|GIS-/u);

  const tampered = {
    ...saved.checkpoint,
    safeState: { activeTask: 'T-999' },
  };
  const ignored = recoverSession({
    checkpoint: tampered,
    skillId: fixture.skillId,
    context: fixture.context,
    now: fixture.now,
    createSessionId: () => 'GIS-lifecyclefixture03',
  });
  assert.equal(ignored.mode, 'fresh');
});

test('recovery starts fresh for closed, expired, or stale-question sessions', () => {
  const currentQuestions = [questions.materialChoice];
  const session = createSkillSession({
    skillId: fixture.skillId,
    questions: currentQuestions,
    now: fixture.now,
    createSessionId: () => fixture.sessionId,
  });
  const saved = checkpointSession({
    session,
    context: fixture.context,
    safeState: fixture.safeState,
    now: fixture.now,
  });
  const compatible = recoverSession({
    checkpoint: saved.checkpoint,
    skillId: fixture.skillId,
    context: fixture.context,
    questions: currentQuestions,
  });
  assert.equal(compatible.mode, 'recovered');

  for (const state of ['closed', 'expired']) {
    const terminal = checkpointSession({
      session: updateSkillSession(session, { state }),
      context: fixture.context,
      safeState: fixture.safeState,
      now: fixture.now,
    });
    const recovered = recoverSession({
      checkpoint: terminal.checkpoint,
      skillId: fixture.skillId,
      context: fixture.context,
      questions: currentQuestions,
      now: fixture.now,
      createSessionId: () => `GIS-${state}session0001`,
    });
    assert.equal(recovered.mode, 'fresh');
    assert.equal(recovered.session.state, 'open');
  }

  for (const [suffix, staleQuestions] of [
    ['version', [{ ...questions.materialChoice, questionVersion: '2.0.0' }]],
    ['shape', [{ ...questions.materialChoice, required: !questions.materialChoice.required }]],
  ]) {
    const stale = recoverSession({
      checkpoint: saved.checkpoint,
      skillId: fixture.skillId,
      context: fixture.context,
      questions: staleQuestions,
      now: fixture.now,
      createSessionId: () => `GIS-stale${suffix}0001`,
    });
    assert.equal(stale.mode, 'fresh');
    assert.deepEqual(stale.session.questions, staleQuestions);
    assert.doesNotMatch(stale.notice, /digest|hash|GIS-/u);
  }
});

test('effect classification delegates execution boundaries to the host', () => {
  assert.deepEqual(classifyOperation('planning'), {
    operationClass: 'planning',
    effect: 'none',
    execution: 'local',
  });
  assert.deepEqual(classifyOperation('external-effect'), {
    operationClass: 'external-effect',
    effect: 'external',
    execution: 'host',
  });
  assert.deepEqual(classifyOperation('destructive'), {
    operationClass: 'destructive',
    effect: 'destructive',
    execution: 'host',
  });
});

test('learning is local, redacted, explicitly enabled, and cannot target source files', () => {
  const disabled = prepareLearningRecord({
    ...fixture.safeLearning,
    skillId: fixture.skillId,
    observedAt: fixture.now,
  });
  assert.equal(disabled.status, 'unavailable');
  assert.equal(disabled.record, null);

  const privateInput = prepareLearningRecord({
    ...fixture.privateLearning,
    skillId: fixture.skillId,
    observedAt: fixture.now,
    projectIdentity,
    consent,
  });
  assert.equal(privateInput.status, 'blocked');
  assert.equal(privateInput.record, null);

  const redacted = prepareLearningRecord({
    ...fixture.safeLearning,
    note: [
      'api_key=private-value;',
      'ghp_1234567890abcdefghijklmnopqrstuv',
      'AKIA1234567890ABCDEF',
      'sk-proj-abcdefghijklmnopqrstuvwxyz123456',
      'prefer one short question.',
    ].join(' '),
    skillId: fixture.skillId,
    observedAt: fixture.now,
    projectIdentity,
    consent,
  });
  assert.equal(redacted.status, 'completed');
  assert.equal(redacted.redactions, 4);
  assert.doesNotMatch(redacted.record.note, /private-value|ghp_|AKIA|sk-proj-/u);
  assert.deepEqual(
    validateProtocolArtifact('skill-learning-record', redacted.record, {
      protocolVersion: '1.6.0',
    }),
    [],
  );

  const project = mkdtempSync(join(tmpdir(), 'openplanr-lifecycle-'));
  try {
    const arbitrary = persistLearningRecord({
      projectRoot: project,
      prepared: {
        status: 'completed',
        record: redacted.record,
        reason: redacted.reason,
        redactions: redacted.redactions,
        disallowed: [],
      },
    });
    assert.deepEqual(arbitrary, {
      status: 'blocked',
      path: null,
      reason: 'learning-record-invalid',
    });
    assert.equal(existsSync(join(project, LOCAL_LEARNING_PATH)), false);

    const denied = persistLearningRecord({
      projectRoot: project,
      prepared: redacted,
      relativePath: 'skills/planr-plan/SKILL.md',
    });
    assert.equal(denied.status, 'blocked');

    const persisted = persistLearningRecord({ projectRoot: project, prepared: redacted });
    assert.deepEqual(persisted, {
      status: 'completed',
      path: LOCAL_LEARNING_PATH,
      reason: 'learning-stored-locally',
    });
    const stored = JSON.parse(readFileSync(join(project, LOCAL_LEARNING_PATH), 'utf8'));
    assert.equal(stored.documentDigest, redacted.record.documentDigest);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }

  const linkedFileProject = mkdtempSync(join(tmpdir(), 'openplanr-lifecycle-file-link-'));
  const linkedFileOutside = mkdtempSync(join(tmpdir(), 'openplanr-lifecycle-file-outside-'));
  const outsideFile = join(linkedFileOutside, 'captured.jsonl');
  try {
    mkdirSync(join(linkedFileProject, '.planr', 'runtime'), { recursive: true });
    writeFileSync(outsideFile, 'unchanged\n', 'utf8');
    symlinkSync(outsideFile, join(linkedFileProject, LOCAL_LEARNING_PATH), 'file');
    const escaped = persistLearningRecord({ projectRoot: linkedFileProject, prepared: redacted });
    assert.deepEqual(escaped, {
      status: 'blocked',
      path: null,
      reason: 'learning-destination-denied',
    });
    assert.equal(readFileSync(outsideFile, 'utf8'), 'unchanged\n');
  } finally {
    rmSync(linkedFileProject, { recursive: true, force: true });
    rmSync(linkedFileOutside, { recursive: true, force: true });
  }

  const linkedProject = mkdtempSync(join(tmpdir(), 'openplanr-lifecycle-link-'));
  const outside = mkdtempSync(join(tmpdir(), 'openplanr-lifecycle-outside-'));
  try {
    symlinkSync(outside, join(linkedProject, '.planr'), 'dir');
    const escaped = persistLearningRecord({ projectRoot: linkedProject, prepared: redacted });
    assert.equal(escaped.status, 'blocked');
    assert.equal(existsSync(join(outside, 'runtime')), false);
  } finally {
    rmSync(linkedProject, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('completion results are concise, typed, immutable, and resolver-compatible', () => {
  const completed = createCompletion({
    status: 'completed',
    summary: 'Lifecycle checks passed.',
    checks: [{ name: 'privacy', status: 'passed' }],
  });
  assert.deepEqual(completed, {
    status: 'completed',
    summary: 'Lifecycle checks passed.',
    checks: [{ name: 'privacy', status: 'passed' }],
    issues: [],
  });
  assert.equal(Object.isFrozen(completed), true);
  assert.equal(Object.isFrozen(completed.checks), true);

  const denied = completionFromRuntimeResult(
    { status: 'denied', capability: 'external-data' },
    {
      summary: 'External data is unavailable.',
      issues: [
        {
          problem: 'The host denied external data.',
          impact: 'The external lookup was skipped.',
          nextAction: 'Continue with local context or enable the host capability.',
        },
      ],
    },
  );
  assert.equal(denied.status, 'unavailable');
  assert.equal(denied.output.status, 'denied');
});

test('completed results reject unresolved checks and issues without constraining non-completed outcomes', () => {
  for (const status of ['failed', 'not-run']) {
    assert.throws(
      () =>
        createCompletion({
          status: 'completed',
          summary: 'The result contradicts its checks.',
          checks: [{ name: 'runtime', status }],
        }),
      /completed results require every reported check to pass/u,
    );
  }
  assert.throws(
    () =>
      createCompletion({
        status: 'completed',
        summary: 'The result contradicts its issues.',
        issues: [
          {
            problem: 'One issue remains.',
            impact: 'The outcome is not complete.',
            nextAction: 'Resolve the issue.',
          },
        ],
      }),
    /completed results cannot contain unresolved issues/u,
  );
  assert.throws(
    () =>
      completionFromRuntimeResult(
        { status: 'completed' },
        {
          summary: 'The runtime result contradicts its checks.',
          checks: [{ name: 'runtime', status: 'failed' }],
        },
      ),
    /completed results require every reported check to pass/u,
  );

  for (const status of ['partial', 'blocked', 'unavailable', 'cancelled']) {
    const result = createCompletion({
      status,
      summary: `The outcome is ${status}.`,
      checks: [{ name: 'runtime', status: 'not-run' }],
      issues: [
        {
          problem: 'Work remains.',
          impact: 'The requested outcome is not complete.',
          nextAction: 'Use the typed result to continue.',
        },
      ],
    });
    assert.equal(result.status, status);
    assert.equal(result.checks[0].status, 'not-run');
    assert.equal(result.issues.length, 1);
  }
});
