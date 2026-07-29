import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { executeOperateAction } from '../../src/services/operate/index.js';

const execFileAsync = promisify(execFile);

async function gitProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-guided-init-'));
  await execFileAsync('git', ['init', '--quiet'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], { cwd: root });
  await writeFile(join(root, 'README.md'), '# Fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root });
  return root;
}

describe('guided Operating Board initialization', () => {
  it('returns Protocol input_required instead of invalid config when JSON input is missing', async () => {
    const projectRoot = await gitProject();
    const result = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { json: true },
    });

    expect(result).toMatchObject({
      ok: false,
      action: 'input_required',
      code: 'E_OPERATE_INPUT_REQUIRED',
      protocolVersion: '1.2.0',
      exitCode: 4,
      questionnaire: {
        kind: 'guided-questionnaire',
        command: 'operate.init',
        stage: 'foundation',
        step: 1,
        totalSteps: 3,
      },
    });
    expect(result.questionnaire?.questions.map((question) => question.questionId)).toContain(
      'decision-owner',
    );
    await expect(
      readFile(join(projectRoot, '.planr', 'operate', 'config.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns only unanswered canonical questions for partial machine input', async () => {
    const projectRoot = await gitProject();
    const result = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { json: true, decisionOwner: 'Asem' },
    });

    expect(result.code).toBe('E_OPERATE_INPUT_REQUIRED');
    expect(result.questionnaire?.questions.map((question) => question.questionId)).not.toContain(
      'decision-owner',
    );
    expect(result.questionnaire?.questions.map((question) => question.questionId)).toEqual(
      expect.arrayContaining(['profile', 'planning-engine']),
    );
  });

  it('preserves fully specified flag automation and produces a write-free preview', async () => {
    const projectRoot = await gitProject();
    const result = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: {
        json: true,
        preview: true,
        profile: 'engineering',
        decisionOwner: 'Asem',
        planningEngine: 'openplanr',
        runtime: 'codex',
        cadence: 'manual',
        timezone: 'UTC',
        sensitivityCeiling: 'internal',
        sources: ['repository', 'git'],
        purpose: 'Help product teams make cited operating decisions.',
        productStage: 'Growth',
        businessModel: 'Subscription SaaS',
        idealCustomer: 'Technical founders',
        goal: ['Reach a trustworthy operating brief quickly'],
        successMetric: ['Time to first brief under five minutes'],
        guardrail: ['No external effects without explicit approval'],
        knownUnknown: ['Provider availability'],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      action: 'init',
      preview: {
        config: {
          profile: 'engineering',
          decisionOwner: 'Asem',
          planningEngine: 'openplanr',
        },
      },
    });
    await expect(
      readFile(join(projectRoot, '.planr', 'operate', 'config.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
