import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { executeOperateAction } from '../../src/services/operate/index.js';
import {
  decodeOperatingInitializationReplay,
  encodeOperatingInitializationReplay,
} from '../../src/services/operate/interaction/initialization-replay.js';
import { resolveOperatingPaths } from '../../src/services/operate/workspace.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function createGitProject(): Promise<string> {
  const projectRoot = await temporaryDirectory('openplanr-operate-init-purge-project-');
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await execFileAsync(
    'git',
    ['remote', 'add', 'origin', 'https://github.com/openplanr/init-purge-fixture.git'],
    { cwd: projectRoot },
  );
  await writeFile(join(projectRoot, 'README.md'), '# Fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectRoot });
  return projectRoot;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

const answers = {
  profile: 'saas' as const,
  decisionOwner: "Founder O'Neil",
  planningEngine: 'openplanr' as const,
  runtime: 'codex' as const,
  cadence: 'weekly' as const,
  timezone: 'Europe/Istanbul',
  sensitivityCeiling: 'internal' as const,
  sources: ['repository', 'planr', 'git'],
  componentRoots: ['packages/product app'],
  charter: {
    purpose: 'Make cited operating decisions.',
    stage: 'growth',
    businessModel: 'subscription SaaS',
    idealCustomer: 'technical founders',
    goals: ['Produce one reviewable brief.'],
    constraints: [],
    successMetrics: ['Time to first brief'],
    guardrails: ['Humans approve all mutations.'],
    knownUnknowns: ['Current activation baseline'],
  },
};

describe('Operating Board initialization replay', () => {
  it('round-trips normalized answers through a deterministic shell-safe token', () => {
    const token = encodeOperatingInitializationReplay(answers);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeOperatingInitializationReplay(answers)).toBe(token);
    expect(decodeOperatingInitializationReplay(token)).toEqual(answers);
  });

  it('fails closed for malformed, corrupted, and oversized replay tokens', () => {
    expect(() => decodeOperatingInitializationReplay('not+base64')).toThrow('malformed or exceeds');
    const token = encodeOperatingInitializationReplay(answers);
    expect(() => decodeOperatingInitializationReplay(`${token}a`)).toThrow('invalid or corrupted');
    expect(() => decodeOperatingInitializationReplay('a'.repeat(24 * 1024 + 1))).toThrow(
      'malformed or exceeds',
    );
  });

  it('purges machine-local advisor sessions and incremental baselines on a committed init apply', async () => {
    const projectRoot = await createGitProject();
    const localRoot = await temporaryDirectory('openplanr-operate-init-purge-local-');
    const paths = resolveOperatingPaths(projectRoot, { localRoot });

    // Seed stale machine-local caches as if left by a prior board generation.
    await mkdir(paths.advisors, { recursive: true });
    await writeFile(
      join(paths.advisors, 'CYCLE-001.json'),
      '{"implementation":"openplanr-operate-adapter","boardIdentity":"sha256:stale"}\n',
    );
    const incrementalDir = join(paths.evidence, 'incremental');
    await mkdir(incrementalDir, { recursive: true });
    await writeFile(
      join(incrementalDir, 'stale-baseline.json'),
      '{"implementation":"openplanr-operate-incremental-evidence"}\n',
    );

    const initOptions = {
      json: true,
      localRoot,
      profile: 'engineering',
      decisionOwner: 'Product owner',
      planningEngine: 'openplanr',
      runtime: 'codex',
      cadence: 'manual',
      timezone: 'UTC',
      sensitivityCeiling: 'internal',
      sources: ['repository', 'git'],
      charter: {
        purpose: 'Prove the committed init purge.',
        stage: 'growth',
        businessModel: 'subscription SaaS',
        idealCustomer: 'technical product teams',
        goals: ['Keep machine-local caches board-scoped.'],
        successMetrics: ['Time to a cited operating brief'],
        guardrails: ['Humans approve every mutation.'],
        knownUnknowns: ['Current activation baseline'],
      },
    };

    const preview = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { ...initOptions, preview: true },
    });
    const action = preview.actions?.find((candidate) => candidate.id === 'operate.init.apply');
    const token = action?.command.match(/--answers-token ([A-Za-z0-9_-]+)/)?.[1];
    const previewCreatedAt = (preview.preview as { previewCreatedAt?: string } | undefined)
      ?.previewCreatedAt;
    expect(token).toBeTruthy();
    expect(action?.confirmationDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    const applied = await executeOperateAction({
      action: 'init',
      projectRoot,
      interactive: false,
      options: {
        json: true,
        localRoot,
        answersToken: token,
        previewCreatedAt,
        confirm: action?.confirmationDigest,
        yes: true,
      },
    });
    expect(applied).toMatchObject({ ok: true, action: 'init' });

    // The committed apply purged both machine-local cache surfaces so the fresh
    // board never inherits a prior generation's sessions or baselines.
    expect(await readdir(paths.advisors).catch(() => [])).toEqual([]);
    expect(await readdir(incrementalDir).catch(() => [])).toEqual([]);
  });
});
