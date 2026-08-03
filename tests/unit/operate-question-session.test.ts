import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  parseGuidedAnswerEnvelope,
  persistableOperatingInitAnswers,
  probeGitUserName,
  probePipelineInstalled,
  resumeGuidedSession,
  submitGuidedAnswers,
} from '../../src/services/operate/interaction/answer-service.js';
import {
  createOperatingInitQuestionnaire,
  evaluateOperatingInitQuestions,
} from '../../src/services/operate/interaction/question-engine.js';
import { operatingInitQuestionRegistry } from '../../src/services/operate/interaction/question-registry.js';
import {
  cancelGuidedSession,
  createGuidedSession,
  createGuidedSessionId,
  currentGuidedSessionBindings,
  guidedSessionStatus,
  purgeGuidedSessions,
  readGuidedSession,
} from '../../src/services/operate/interaction/session-service.js';
import { resolveOperatingPaths } from '../../src/services/operate/workspace.js';

const createdAt = '2026-07-29T10:00:00.000Z';

/** Build a bound answer envelope for a questionnaire with an explicit submittedAt. */
function buildEnvelope(
  questionnaire: Awaited<ReturnType<typeof createOperatingInitQuestionnaire>>,
  values: Record<string, string | string[]>,
  submittedAt: string,
) {
  const descriptors = new Map(
    questionnaire.submission.envelope.dynamicFields.answers.items.map((item) => [
      item.questionId,
      item,
    ]),
  );
  const answers = Object.entries(values).map(([questionId, value]) => {
    const descriptor = descriptors.get(questionId);
    if (!descriptor) throw new Error(`Missing answer descriptor for ${questionId}.`);
    return Object.assign(
      Object.fromEntries(
        questionnaire.submission.envelope.dynamicFields.answers.copyFields.map((field) => [
          field,
          descriptor[field],
        ]),
      ),
      { value },
    );
  });
  return {
    ...questionnaire.submission.envelope.fixedFields,
    questionnaireDigest: questionnaire.digest,
    answers,
    submittedAt,
  };
}

const execFileAsync = promisify(execFile);

/**
 * A committed git project whose create-time context is built from the SAME
 * probes `interactionContext` uses on resume, so the questionnaire digest is
 * stable across create and resume (a plain fixed-context fixture diverges the
 * moment the engine re-probes git user / pipeline on
 * resume). Used by the livelock and un-latch regressions, which require a clean
 * resume of the session they create.
 */
async function resumableFixture() {
  const projectRoot = await mkdtemp(join(tmpdir(), 'operate-session-git-'));
  const localRoot = await mkdtemp(join(tmpdir(), 'operate-session-local-'));
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await writeFile(join(projectRoot, 'README.md'), '# original\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectRoot });
  const bindings = await currentGuidedSessionBindings(projectRoot);
  const gitUserName = await probeGitUserName(projectRoot);
  const context = {
    projectRoot,
    ...bindings,
    ...(gitUserName ? { gitUserName } : {}),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    pipelineInstalled: probePipelineInstalled(),
    runtime: 'codex',
    interaction: 'native' as const,
    now: createdAt,
  };
  const state = await evaluateOperatingInitQuestions({
    answers: { decisionOwner: 'Asem' },
    context,
  });
  if (state.status !== 'input-required') throw new Error('Expected questions.');
  const questionnaire = await createOperatingInitQuestionnaire({
    context,
    questions: state.questions,
    stage: state.stage,
    sessionId: createGuidedSessionId(),
  });
  const session = await createGuidedSession({
    projectRoot,
    localRoot,
    questionnaire,
    persistedAnswers: persistableOperatingInitAnswers(state.answers, context),
    now: new Date(createdAt),
  });
  return { projectRoot, localRoot, bindings, context, questionnaire, session };
}

async function fixture() {
  const projectRoot = await mkdtemp(join(tmpdir(), 'operate-session-project-'));
  const localRoot = await mkdtemp(join(tmpdir(), 'operate-session-local-'));
  await writeFile(join(projectRoot, 'README.md'), '# unchanged\n');
  const bindings = await currentGuidedSessionBindings(projectRoot);
  const context = {
    projectRoot,
    ...bindings,
    timezone: 'UTC',
    runtime: 'codex',
    interaction: 'native' as const,
    now: createdAt,
  };
  const state = await evaluateOperatingInitQuestions({
    answers: { decisionOwner: 'Asem' },
    context,
  });
  if (state.status !== 'input-required') throw new Error('Expected questions.');
  const questionnaire = await createOperatingInitQuestionnaire({
    context,
    questions: state.questions,
    stage: state.stage,
    sessionId: createGuidedSessionId(),
  });
  const session = await createGuidedSession({
    projectRoot,
    localRoot,
    questionnaire,
    persistedAnswers: [
      ...persistableOperatingInitAnswers(state.answers, context),
      {
        questionId: 'future-secret',
        questionVersion: '1.0.0',
        sensitivity: 'sensitive',
        value: 'never-write-this',
      },
    ],
    now: new Date(createdAt),
  });
  return { projectRoot, localRoot, bindings, context, questionnaire, session };
}

describe('guided question sessions', () => {
  it('writes only non-sensitive answers to a mode-0600 machine-local record', async () => {
    const value = await fixture();
    const target = join(
      resolveOperatingPaths(value.projectRoot, { localRoot: value.localRoot }).sessions,
      `${value.session.sessionId}.json`,
    );
    if (process.platform !== 'win32') {
      expect((await stat(target)).mode & 0o777).toBe(0o600);
    }
    const raw = await readFile(target, 'utf8');
    expect(raw).toContain('decision-owner');
    expect(raw).not.toContain('never-write-this');
    expect(raw).not.toContain('future-secret');
    await expect(
      readFile(join(value.projectRoot, '.planr', 'operate', 'config.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('expires, rejects stale heads, and fails closed on questionnaire tampering', async () => {
    const expired = await fixture();
    await expect(
      readGuidedSession({
        projectRoot: expired.projectRoot,
        localRoot: expired.localRoot,
        sessionId: expired.session.sessionId,
        bindings: expired.bindings,
        now: new Date('2026-07-31T10:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_SESSION_EXPIRED' });

    const stale = await fixture();
    await mkdir(join(stale.projectRoot, '.planr', 'operate'), { recursive: true });
    await writeFile(join(stale.projectRoot, '.planr', 'operate', 'config.json'), '{}\n');
    await expect(
      readGuidedSession({
        projectRoot: stale.projectRoot,
        localRoot: stale.localRoot,
        sessionId: stale.session.sessionId,
        now: new Date(createdAt),
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_SESSION_STALE' });

    const tampered = await fixture();
    const target = join(
      resolveOperatingPaths(tampered.projectRoot, { localRoot: tampered.localRoot }).sessions,
      `${tampered.session.sessionId}.json`,
    );
    const parsed = JSON.parse(await readFile(target, 'utf8'));
    parsed.persistedAnswers[0].value = 'tampered owner';
    await writeFile(target, `${JSON.stringify(parsed)}\n`, { mode: 0o600 });
    await expect(
      resumeGuidedSession({
        projectRoot: tampered.projectRoot,
        localRoot: tampered.localRoot,
        sessionId: tampered.session.sessionId,
        bindings: tampered.bindings,
        now: new Date(createdAt),
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_SESSION_INVALID' });
  });

  it('accepts an answer envelope whose submittedAt predates the session (livelock regression)', async () => {
    const value = await resumableFixture();
    // A payload prepared before the (restart-minted) session legitimately predates
    // its createdAt. The removed wall-clock gate used to reject this as "outside
    // the active session lifetime" — the exact guided-init livelock.
    const beforeCreated = new Date(Date.parse(createdAt) - 1).toISOString();
    const envelope = buildEnvelope(
      value.questionnaire,
      {
        profile: 'saas',
        'planning-engine': 'openplanr',
        'sensitivity-ceiling': 'internal',
        runtime: 'codex',
      },
      beforeCreated,
    );
    const progress = await submitGuidedAnswers({
      projectRoot: value.projectRoot,
      localRoot: value.localRoot,
      sessionId: value.session.sessionId,
      raw: JSON.stringify(envelope),
      bindings: value.bindings,
      now: new Date(createdAt),
    });
    // Accepted purely on binding validity: the session advances to the next stage.
    expect(progress.questionnaire.stage).toBe('product-charter');
  });

  it('un-latches a transiently stale session when the tree is restored', async () => {
    const value = await resumableFixture();
    const sessionFile = join(
      resolveOperatingPaths(value.projectRoot, { localRoot: value.localRoot }).sessions,
      `${value.session.sessionId}.json`,
    );

    // An unrelated untracked file flips the working-tree dirty fingerprint folded
    // into projectHead, so resume is rejected as stale — but the rejection names
    // THIS session's resume command, not the dead-end init.
    const scratch = join(value.projectRoot, 'scratch.txt');
    await writeFile(scratch, 'transient\n');
    const dirtyBindings = await currentGuidedSessionBindings(value.projectRoot);
    await expect(
      resumeGuidedSession({
        projectRoot: value.projectRoot,
        localRoot: value.localRoot,
        sessionId: value.session.sessionId,
        bindings: dirtyBindings,
        now: new Date(createdAt),
      }),
    ).rejects.toMatchObject({
      code: 'E_OPERATE_SESSION_STALE',
      details: {
        sessionId: value.session.sessionId,
        recoveryCommand: `planr operate init --resume ${value.session.sessionId} --json`,
      },
    });
    // Staleness is never latched to disk: the record keeps its editable state.
    expect(JSON.parse(await readFile(sessionFile, 'utf8')).state).toBe('awaiting-input');

    // Restoring the tree to its prior state makes the same session usable again.
    await rm(scratch);
    const restoredBindings = await currentGuidedSessionBindings(value.projectRoot);
    const resumed = await resumeGuidedSession({
      projectRoot: value.projectRoot,
      localRoot: value.localRoot,
      sessionId: value.session.sessionId,
      bindings: restoredBindings,
      now: new Date(createdAt),
    });
    expect(resumed.session.sessionId).toBe(value.session.sessionId);
    expect(resumed.session.state).not.toBe('stale');
  });

  it('cancels and purges sessions without changing project bytes', async () => {
    const first = await fixture();
    const before = await readFile(join(first.projectRoot, 'README.md'), 'utf8');
    await cancelGuidedSession({
      projectRoot: first.projectRoot,
      localRoot: first.localRoot,
      sessionId: first.session.sessionId,
    });
    expect(await readFile(join(first.projectRoot, 'README.md'), 'utf8')).toBe(before);
    await expect(
      readGuidedSession({
        projectRoot: first.projectRoot,
        localRoot: first.localRoot,
        sessionId: first.session.sessionId,
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_SESSION_INVALID' });

    const second = await fixture();
    expect(
      await guidedSessionStatus({
        projectRoot: second.projectRoot,
        localRoot: second.localRoot,
        now: new Date(createdAt),
      }),
    ).toMatchObject({ active: 1, files: 1 });
    await expect(
      purgeGuidedSessions({ projectRoot: second.projectRoot, localRoot: second.localRoot }),
    ).resolves.toEqual({ removed: 1 });
  });

  it('has no timezone question and no longer batches cadence or component-roots', async () => {
    const baseContext = {
      projectRoot: process.cwd(),
      timezone: 'UTC',
      runtime: 'codex',
      interaction: 'native' as const,
    };
    const state = await evaluateOperatingInitQuestions({ context: baseContext });
    if (state.status !== 'input-required') throw new Error('Expected foundation questions.');
    const ids = state.questions.map((question) => question.questionId);
    expect(ids).not.toContain('timezone');
    expect(ids).not.toContain('cadence');
    expect(ids).not.toContain('component-roots');
    // The cadence question still exists in the registry with its default; it is
    // simply no longer required (so it never blocks or gets batched).
    const cadence = operatingInitQuestionRegistry(baseContext).find(
      (definition) => definition.question.questionId === 'cadence',
    );
    expect(cadence?.question.required).toBe(false);
    expect(cadence?.question.defaultValue).toBe('manual');
    expect(
      operatingInitQuestionRegistry(baseContext).some(
        (definition) => definition.question.questionId === 'timezone',
      ),
    ).toBe(false);
  });

  it('suggests pipeline-po for planning-engine when planr-pipeline is installed', async () => {
    const baseContext = {
      projectRoot: process.cwd(),
      timezone: 'UTC',
      runtime: 'codex',
      interaction: 'native' as const,
    };
    const withoutPipeline = await evaluateOperatingInitQuestions({ context: baseContext });
    const withPipeline = await evaluateOperatingInitQuestions({
      context: { ...baseContext, pipelineInstalled: true },
    });
    if (withoutPipeline.status !== 'input-required' || withPipeline.status !== 'input-required') {
      throw new Error('Expected foundation questions.');
    }
    const plain = withoutPipeline.questions.find(
      (question) => question.questionId === 'planning-engine',
    );
    expect(plain?.valueSemantics).toBe('none');
    expect(plain).not.toHaveProperty('suggestedValue');
    const detected = withPipeline.questions.find(
      (question) => question.questionId === 'planning-engine',
    );
    expect(detected).toMatchObject({
      valueSemantics: 'suggestion',
      suggestedValue: 'pipeline-po',
    });
  });

  it('rejects oversized, deeply nested, and prototype-bearing stdin', async () => {
    await expect(parseGuidedAnswerEnvelope('x'.repeat(65 * 1024))).rejects.toMatchObject({
      code: 'E_OPERATE_INPUT_TOO_LARGE',
    });
    await expect(
      parseGuidedAnswerEnvelope(`${'{"a":'.repeat(20)}null${'}'.repeat(20)}`),
    ).rejects.toMatchObject({ code: 'E_OPERATE_SESSION_INVALID' });
    await expect(
      parseGuidedAnswerEnvelope('{"__proto__":{"polluted":true}}'),
    ).rejects.toMatchObject({ code: 'E_OPERATE_SESSION_INVALID' });
  });
});
