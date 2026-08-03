import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { executeOperateAction } from '../../src/services/operate/index.js';
import {
  decodeOperatingInitializationReplay,
  encodeOperatingInitializationReplay,
} from '../../src/services/operate/interaction/initialization-replay.js';

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
        // Honest source availability: this bare fixture has no .planr planning
        // records, so only the locally probeable sources are selected.
        sources: ['repository', 'git'],
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
          command: expect.stringMatching(
            /^planr operate init --answers-token [A-Za-z0-9_-]+ --preview-created-at /,
          ),
        },
      ],
    });
    const action = result.actions?.find((candidate) => candidate.id === 'operate.init.apply');
    const token = action?.command.match(/--answers-token ([A-Za-z0-9_-]+)/)?.[1];
    const previewCreatedAt = (result.preview as { previewCreatedAt?: string } | undefined)
      ?.previewCreatedAt;
    expect(token).toBeTruthy();
    expect(previewCreatedAt).toBeTruthy();

    const tamperedAnswers = decodeOperatingInitializationReplay(token as string);
    tamperedAnswers.decisionOwner = 'Different owner';
    const rejected = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: {
        json: true,
        answersToken: encodeOperatingInitializationReplay(tamperedAnswers),
        previewCreatedAt,
        confirm: action?.confirmationDigest,
        yes: true,
      },
    });
    expect(rejected).toMatchObject({
      ok: false,
      code: 'E_OPERATE_ROUTE_CONFIRMATION_REQUIRED',
    });

    const applied = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: {
        json: true,
        answersToken: token,
        previewCreatedAt,
        confirm: action?.confirmationDigest,
        yes: true,
      },
    });
    expect(applied).toMatchObject({
      ok: true,
      action: 'init',
      message: 'Operating Board initialized.',
    });
  });
});
