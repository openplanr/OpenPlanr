import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { executeOperateAction } from '../../src/services/operate/index.js';

const execFileAsync = promisify(execFile);

async function project() {
  const projectRoot = await mkdtemp(join(tmpdir(), 'operate-authority-project-'));
  const localRoot = await mkdtemp(join(tmpdir(), 'operate-authority-local-'));
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await writeFile(join(projectRoot, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectRoot });
  return { projectRoot, localRoot };
}

function completeOptions(localRoot: string) {
  return {
    json: true,
    localRoot,
    profile: 'saas',
    decisionOwner: 'Asem',
    planningEngine: 'openplanr',
    runtime: 'codex',
    cadence: 'manual',
    timezone: 'UTC',
    sensitivityCeiling: 'internal',
    sources: ['repository', 'git'],
    purpose: 'Turn verified evidence into operating decisions.',
    productStage: 'Growth',
    businessModel: 'Subscription SaaS',
    idealCustomer: 'Technical founders',
    goal: ['Reach a cited brief quickly'],
    successMetric: ['First useful brief within five minutes'],
    guardrail: ['No external effects without explicit authority'],
    knownUnknown: ['Provider readiness'],
  };
}

describe('Operating Board authority boundaries', () => {
  it('requires the exact initialization action digest and applies only that preview', async () => {
    const input = await project();
    const preview = await executeOperateAction({
      action: 'init',
      projectRoot: input.projectRoot,
      interactive: false,
      options: { ...completeOptions(input.localRoot), preview: true },
    });
    expect(preview).toMatchObject({
      ok: true,
      state: 'preview-ready',
      actions: [
        {
          id: 'operate.init.apply',
          effect: 'project-write',
          requiresConfirmation: true,
        },
      ],
    });
    const action = preview.actions?.[0];
    const previewCreatedAt = (preview.preview as { previewCreatedAt?: string } | undefined)
      ?.previewCreatedAt;
    expect(action?.confirmationDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    await expect(
      readFile(join(input.projectRoot, '.planr', 'operate', 'config.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    const implicit = await executeOperateAction({
      action: 'init',
      projectRoot: input.projectRoot,
      interactive: false,
      options: { ...completeOptions(input.localRoot), yes: true },
    });
    expect(implicit).toMatchObject({
      ok: false,
      code: 'E_OPERATE_ROUTE_CONFIRMATION_REQUIRED',
      exitCode: 4,
      nextActions: [
        expect.stringMatching(
          /^planr operate init --answers-token [A-Za-z0-9_-]+ --preview-created-at .* --confirm sha256:[a-f0-9]{64} --yes$/,
        ),
      ],
    });

    const applied = await executeOperateAction({
      action: 'init',
      projectRoot: input.projectRoot,
      interactive: false,
      options: {
        ...completeOptions(input.localRoot),
        yes: true,
        confirm: action?.confirmationDigest,
        previewCreatedAt,
      },
    });
    expect(applied).toMatchObject({ ok: true, message: 'Operating Board initialized.' });
    expect(
      JSON.parse(await readFile(join(input.projectRoot, '.planr/operate/config.json'), 'utf8')),
    ).toMatchObject({ decisionOwner: 'Asem' });
  });

  it('does not let one confirmation survive project/config drift', async () => {
    const input = await project();
    const preview = await executeOperateAction({
      action: 'init',
      projectRoot: input.projectRoot,
      interactive: false,
      options: { ...completeOptions(input.localRoot), preview: true },
    });
    await writeFile(join(input.projectRoot, 'README.md'), '# changed after preview\n');
    const result = await executeOperateAction({
      action: 'init',
      projectRoot: input.projectRoot,
      interactive: false,
      options: {
        ...completeOptions(input.localRoot),
        yes: true,
        confirm: preview.actions?.[0]?.confirmationDigest,
        previewCreatedAt: (preview.preview as { previewCreatedAt?: string } | undefined)
          ?.previewCreatedAt,
      },
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'E_OPERATE_ROUTE_CONFIRMATION_REQUIRED',
    });
  });
});
