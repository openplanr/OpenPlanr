import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { executeOperateAction } from '../../src/services/operate/index.js';

const execFileAsync = promisify(execFile);
const directories: string[] = [];

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'operate-guided-automation-'));
  directories.push(root);
  await execFileAsync('git', ['init', '--quiet'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], { cwd: root });
  await writeFile(join(root, 'README.md'), '# Guided automation\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root });
  return root;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((entry) => rm(entry, { recursive: true, force: true })),
  );
});

describe('Operating Board strict guided automation', () => {
  it('returns the named uninitialized error and a typed init action before engine work', async () => {
    const projectRoot = await project();
    const result = await executeOperateAction({
      action: 'run',
      projectRoot,
      interactive: false,
      options: { json: true, preview: true, runtime: 'codex' },
    });
    expect(result).toMatchObject({
      ok: false,
      action: 'run',
      code: 'E_OPERATE_NOT_INITIALIZED',
      exitCode: 3,
      nextActions: ['planr operate init'],
      actions: [
        {
          command: 'planr operate init',
          effect: 'project-write',
          requiresConfirmation: true,
        },
      ],
    });
    expect(result).not.toHaveProperty('cycleId');
  });

  it('keeps explicit JSON initialization flags session-free until the exact apply action', async () => {
    const projectRoot = await project();
    const result = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: {
        json: true,
        preview: true,
        profile: 'saas',
        decisionOwner: 'Asem',
        planningEngine: 'openplanr',
        runtime: 'codex',
        cadence: 'weekly',
        timezone: 'UTC',
        sensitivityCeiling: 'internal',
        sources: ['repository', 'planr', 'git'],
        charter: {
          purpose: 'Guide an evidence-backed product.',
          stage: 'growth',
          businessModel: 'subscription',
          idealCustomer: 'technical product teams',
          goals: ['Produce reviewable decisions.'],
          successMetrics: ['Time to a cited brief'],
          guardrails: ['Humans approve mutations'],
          knownUnknowns: ['Current activation baseline'],
        },
      },
    });
    expect(result).toMatchObject({
      ok: true,
      action: 'init',
      state: 'preview-ready',
      actions: [
        {
          id: 'operate.init.apply',
          effect: 'project-write',
          requiresConfirmation: true,
        },
      ],
    });
  });
});
