import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalize } from '../../src/services/operate/canonical.js';
import {
  applyOperatingInitialization,
  prepareOperatingInitialization,
} from '../../src/services/operate/config.js';
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

// A routine re-init carries the supported machine-local cadence preferences
// forward instead of rebuilding them from scratch.
describe('Operating Board re-initialization preserves machine-local preferences', () => {
  type PrepareInput = Parameters<typeof prepareOperatingInitialization>[0];

  const CHARTER = {
    purpose: 'Prove machine-local preferences survive a routine re-init.',
    stage: 'growth',
    businessModel: 'subscription SaaS',
    idealCustomer: 'technical product teams',
    goals: ['Never silently wipe a prior cycle policy.'],
    constraints: [],
    successMetrics: ['Time to a cited operating brief'],
    guardrails: ['Humans approve every mutation.'],
    knownUnknowns: ['Current activation baseline'],
  };

  function baseInput(projectRoot: string, localRoot: string, extra: Partial<PrepareInput> = {}) {
    return {
      projectRoot,
      localRoot,
      profile: 'engineering',
      decisionOwner: 'Product owner',
      planningEngine: 'openplanr',
      runtime: 'codex',
      cadence: 'manual',
      timezone: 'UTC',
      sensitivityCeiling: 'internal',
      enabledProviders: ['repository', 'git'],
      charter: CHARTER,
      ...extra,
    } satisfies PrepareInput;
  }

  async function directInit(
    projectRoot: string,
    localRoot: string,
    extra: Partial<PrepareInput> = {},
  ): Promise<Awaited<ReturnType<typeof prepareOperatingInitialization>>> {
    const preview = await prepareOperatingInitialization(baseInput(projectRoot, localRoot, extra));
    await applyOperatingInitialization({
      projectRoot,
      localRoot,
      preview,
      confirmationDigest: preview.previewDigest,
    });
    return preview;
  }

  it('carries adapterLeaseDurationMs and lastRunAt forward on a re-init with no flags', async () => {
    const projectRoot = await createGitProject();
    const localRoot = await temporaryDirectory('openplanr-operate-reinit-preserve-local-');
    const preferencePath = join(
      resolveOperatingPaths(projectRoot, { localRoot }).localRoot,
      'preferences.json',
    );

    // A prior cycle persisted a custom adapter lease and cadence marker.
    await directInit(projectRoot, localRoot, {
      adapterLeaseDurationMs: 5 * 60 * 1000,
      lastRunAt: '2026-07-30T12:00:00.000Z',
    });
    const before = await readFile(preferencePath, 'utf8');
    expect(JSON.parse(before)).toMatchObject({
      adapterLeaseDurationMs: 5 * 60 * 1000,
      lastRunAt: '2026-07-30T12:00:00.000Z',
    });

    // Re-init with NONE of those flags — the exact incident that wiped them.
    const rePreview = await directInit(projectRoot, localRoot, {});
    const after = await readFile(preferencePath, 'utf8');

    expect(after).toBe(before); // byte-for-byte preservation
    expect(rePreview.preferencesChanged).toBe(false);
    expect(rePreview.changedPreferenceKeys).toEqual([]);
  });

  it('leaves a first-time init byte-identical to prior behavior — no carried-forward keys, deterministic payload', async () => {
    const BASE_KEYS = [
      'enabledSources',
      'evidenceTtlMs',
      'runtime',
      'sensitivityCeiling',
      'timezone',
    ];

    const projectA = await createGitProject();
    const localA = await temporaryDirectory('openplanr-operate-firsttime-a-');
    const previewA = await prepareOperatingInitialization(baseInput(projectA, localA));

    // No existing preferences.json → nothing to merge; the three machine-local
    // policy keys stay omitted (the SPEC-001 omit-empty-fields guarantee).
    expect(Object.keys(previewA.preferences).sort()).toEqual(BASE_KEYS);
    expect(previewA.preferences).not.toHaveProperty('adapterLeaseDurationMs');
    expect(previewA.preferences).not.toHaveProperty('lastRunAt');
    // A first write "changes" every base key it is about to create.
    expect(previewA.changedPreferenceKeys).toEqual(BASE_KEYS);

    // Deterministic: an independent fresh project with identical inputs yields a
    // byte-identical preferences payload — no cross-project state leakage.
    const projectB = await createGitProject();
    const localB = await temporaryDirectory('openplanr-operate-firsttime-b-');
    const previewB = await prepareOperatingInitialization(baseInput(projectB, localB));
    expect(canonicalize(previewB.preferences)).toBe(canonicalize(previewA.preferences));
  });
});
