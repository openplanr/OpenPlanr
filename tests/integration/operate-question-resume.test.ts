import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { canonicalDigest } from '../../src/services/operate/canonical.js';
import { executeOperateAction } from '../../src/services/operate/index.js';
import {
  readGuidedSession,
  updateGuidedSession,
} from '../../src/services/operate/interaction/session-service.js';
import type {
  GuidedAnswerEnvelope,
  GuidedQuestionnaire,
  GuidedQuestionValue,
} from '../../src/services/operate/types.js';

const execFileAsync = promisify(execFile);

async function project() {
  const projectRoot = await mkdtemp(join(tmpdir(), 'operate-resume-project-'));
  const localRoot = await mkdtemp(join(tmpdir(), 'operate-resume-local-'));
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await writeFile(join(projectRoot, 'README.md'), '# original\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectRoot });
  return { projectRoot, localRoot };
}

function envelope(
  questionnaire: GuidedQuestionnaire,
  values: Record<string, GuidedQuestionValue>,
): GuidedAnswerEnvelope {
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
    ) as GuidedAnswerEnvelope['answers'][number];
  });
  return {
    ...questionnaire.submission.envelope.fixedFields,
    questionnaireDigest: questionnaire.digest,
    answers,
    submittedAt: new Date(Date.parse(questionnaire.createdAt) + 1).toISOString(),
  };
}

async function start(input: Awaited<ReturnType<typeof project>>) {
  const result = await executeOperateAction({
    action: 'init',
    projectRoot: input.projectRoot,
    interactive: false,
    options: { json: true, localRoot: input.localRoot },
  });
  if (!result.questionnaire) throw new Error('Questionnaire missing.');
  return result.questionnaire;
}

async function answer(
  input: Awaited<ReturnType<typeof project>>,
  questionnaire: GuidedQuestionnaire,
  values: Record<string, GuidedQuestionValue>,
) {
  const payload = envelope(questionnaire, values);
  return {
    payload,
    result: await executeOperateAction({
      action: 'init',
      projectRoot: input.projectRoot,
      interactive: false,
      options: {
        json: true,
        localRoot: input.localRoot,
        resume: questionnaire.sessionId,
      },
      stdin: JSON.stringify(payload),
    }),
  };
}

describe('guided initialization resume lifecycle', () => {
  it('upgrades a valid schema 1.0 session to the self-describing questionnaire', async () => {
    const input = await project();
    const questionnaire = await start(input);
    const { digest: _digest, submission: _submission, ...legacyQuestionnaire } = questionnaire;
    const legacyDigest = canonicalDigest({
      ...legacyQuestionnaire,
      schemaVersion: '1.0.0',
    });
    const bindings = {
      projectIdentity: questionnaire.projectIdentity,
      projectHead: questionnaire.projectHead,
      configHead: questionnaire.configHead,
    };
    const session = await readGuidedSession({
      ...input,
      sessionId: questionnaire.sessionId,
      bindings,
    });
    await updateGuidedSession({
      ...input,
      session: { ...session, questionnaireDigest: legacyDigest },
    });

    const result = await executeOperateAction({
      action: 'init',
      projectRoot: input.projectRoot,
      interactive: false,
      options: {
        json: true,
        localRoot: input.localRoot,
        resume: questionnaire.sessionId,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      action: 'input_required',
      questionnaire: {
        schemaVersion: '1.1.0',
        submission: { kind: 'guided-answer-submission' },
      },
    });
    const upgraded = await readGuidedSession({
      ...input,
      sessionId: questionnaire.sessionId,
      bindings,
    });
    expect(upgraded.questionnaireDigest).toBe(result.questionnaire?.digest);
    expect(upgraded.questionnaireDigest).not.toBe(legacyDigest);
  });

  it('resumes across stages, replays idempotently, and reaches a write-free preview', async () => {
    const input = await project();
    const before = await readFile(join(input.projectRoot, 'README.md'), 'utf8');
    const foundation = await start(input);
    const first = await answer(input, foundation, {
      profile: 'saas',
      'decision-owner': 'Asem',
      'planning-engine': 'openplanr',
      runtime: 'codex',
      cadence: 'manual',
      timezone: 'UTC',
      'sensitivity-ceiling': 'internal',
      sources: ['repository', 'git'],
    });
    expect(first.result).toMatchObject({
      ok: false,
      action: 'input_required',
      code: 'E_OPERATE_INPUT_REQUIRED',
      questionnaire: { stage: 'product-charter' },
    });

    const replay = await executeOperateAction({
      action: 'init',
      projectRoot: input.projectRoot,
      interactive: false,
      options: {
        json: true,
        localRoot: input.localRoot,
        resume: foundation.sessionId,
      },
      stdin: JSON.stringify(first.payload),
    });
    expect(replay.questionnaire?.digest).toBe(first.result.questionnaire?.digest);

    const charter = first.result.questionnaire as GuidedQuestionnaire;
    const second = await answer(input, charter, {
      purpose: 'Turn evidence into trustworthy operating decisions.',
      'product-stage': 'Growth',
      'business-model': 'Subscription SaaS',
      'ideal-customer': 'Technical founders',
      goals: ['Reach a cited brief quickly'],
      'success-metrics': ['First useful brief within five minutes'],
      guardrails: ['No external effects without explicit confirmation'],
      'known-unknowns': ['Provider readiness'],
    });
    expect(second.result).toMatchObject({
      ok: true,
      action: 'init',
      state: 'preview-ready',
      preview: {
        sessionId: foundation.sessionId,
        config: { decisionOwner: 'Asem', planningEngine: 'openplanr' },
      },
    });
    expect(second.result.nextActions[0]).toContain(`--resume ${foundation.sessionId}`);
    expect(await readFile(join(input.projectRoot, 'README.md'), 'utf8')).toBe(before);
    await expect(
      readFile(join(input.projectRoot, '.planr', 'operate', 'config.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects conflicting replay and supports facade cancellation', async () => {
    const input = await project();
    const foundation = await start(input);
    const accepted = await answer(input, foundation, {
      profile: 'saas',
      'decision-owner': 'Asem',
      'planning-engine': 'openplanr',
      runtime: 'codex',
      cadence: 'manual',
      timezone: 'UTC',
      'sensitivity-ceiling': 'internal',
      sources: ['repository'],
    });
    const conflicting = structuredClone(accepted.payload);
    const owner = conflicting.answers.find((answer) => answer.questionId === 'decision-owner');
    if (owner) owner.value = 'Different owner';
    const conflict = await executeOperateAction({
      action: 'init',
      projectRoot: input.projectRoot,
      interactive: false,
      options: {
        json: true,
        localRoot: input.localRoot,
        resume: foundation.sessionId,
      },
      stdin: JSON.stringify(conflicting),
    });
    expect(conflict).toMatchObject({
      ok: false,
      code: 'E_OPERATE_SESSION_REPLAY_CONFLICT',
      exitCode: 5,
    });

    const cancelled = await executeOperateAction({
      action: 'init',
      projectRoot: input.projectRoot,
      interactive: false,
      options: {
        json: true,
        localRoot: input.localRoot,
        resume: foundation.sessionId,
        cancelSession: true,
      },
    });
    expect(cancelled).toMatchObject({ ok: true, state: 'cancelled' });
  });

  it('surfaces and purges sessions through cache maintenance with explicit authority', async () => {
    const input = await project();
    await start(input);
    const status = await executeOperateAction({
      action: 'cache.status',
      projectRoot: input.projectRoot,
      interactive: false,
      options: { json: true, localRoot: input.localRoot },
    });
    expect(status).toMatchObject({
      ok: true,
      data: { sessions: { active: 1, files: 1 } },
    });

    const denied = await executeOperateAction({
      action: 'cache.purge',
      projectRoot: input.projectRoot,
      interactive: false,
      options: { json: true, localRoot: input.localRoot },
    });
    expect(denied).toMatchObject({ ok: false, code: 'E_OPERATE_AUTHORITY_REQUIRED' });

    const purged = await executeOperateAction({
      action: 'cache.purge',
      projectRoot: input.projectRoot,
      interactive: false,
      options: { json: true, localRoot: input.localRoot, yes: true },
    });
    expect(purged).toMatchObject({ ok: true, data: { sessions: { removed: 1 } } });
  });

  it('rejects resume after the Git revision or dirty fingerprint changes', async () => {
    const input = await project();
    const questionnaire = await start(input);
    await writeFile(join(input.projectRoot, 'README.md'), '# changed after questionnaire\n');
    const stale = await executeOperateAction({
      action: 'init',
      projectRoot: input.projectRoot,
      interactive: false,
      options: {
        json: true,
        localRoot: input.localRoot,
        resume: questionnaire.sessionId,
      },
    });
    expect(stale).toMatchObject({
      ok: false,
      code: 'E_OPERATE_SESSION_STALE',
      nextActions: ['planr operate init --json'],
    });
  });
});
