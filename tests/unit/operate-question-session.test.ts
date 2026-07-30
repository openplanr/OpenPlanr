import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseGuidedAnswerEnvelope,
  persistableOperatingInitAnswers,
  resumeGuidedSession,
} from '../../src/services/operate/interaction/answer-service.js';
import {
  createOperatingInitQuestionnaire,
  evaluateOperatingInitQuestions,
} from '../../src/services/operate/interaction/question-engine.js';
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

async function fixture() {
  const projectRoot = await mkdtemp(join(tmpdir(), 'operate-session-project-'));
  const localRoot = await mkdtemp(join(tmpdir(), 'operate-session-local-'));
  await writeFile(join(projectRoot, 'README.md'), '# unchanged\n');
  const bindings = await currentGuidedSessionBindings(projectRoot);
  const context = {
    projectRoot,
    ...bindings,
    timezone: 'UTC',
    availableSources: ['repository', 'planr', 'git', 'file-import'],
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
