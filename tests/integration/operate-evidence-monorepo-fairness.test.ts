import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildOperatingEvidenceIndex,
  collectOperatingEvidence,
  starvedRoleEvidenceGaps,
} from '../../src/services/operate/evidence.js';
import { evaluateEvidenceReadiness } from '../../src/services/operate/evidence-readiness.js';
import { narrowEvidenceToMissionCeiling } from '../../src/services/operate/maintenance.js';
import { buildWorkspaceManifest } from '../../src/services/operate/workspace.js';

const execFileAsync = promisify(execFile);
const directories: string[] = [];

async function gitProject(prefix: string): Promise<{ projectRoot: string; localRoot: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), prefix));
  const localRoot = await mkdtemp(join(tmpdir(), `${prefix}local-`));
  directories.push(projectRoot, localRoot);
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await execFileAsync(
    'git',
    ['remote', 'add', 'origin', 'https://github.com/openplanr/monorepo-fairness-fixture.git'],
    { cwd: projectRoot },
  );
  return { projectRoot, localRoot };
}

function budgets(overrides: Partial<Record<string, number>> = {}) {
  return {
    maxFiles: 100,
    maxItems: 100,
    maxBytes: 2 * 1024 * 1024,
    maxItemBytes: 256 * 1024,
    maxDurationMs: 10_000,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((entry) => rm(entry, { recursive: true, force: true })),
  );
});

describe('Operating Board monorepo evidence fairness (FR3/FR2)', () => {
  it('samples every product top-level directory under a cap the tree exceeds combined', async () => {
    const { projectRoot, localRoot } = await gitProject('operate-fairness-collect-');
    // A monorepo whose product directories plus a large planning tree far exceed
    // the file cap combined; a pure-alphabetical walk would die inside `.planr/`
    // before ever reaching apps/, packages/, or infra/.
    for (const dir of ['apps', 'infra', 'packages']) {
      await mkdir(join(projectRoot, dir), { recursive: true });
      for (let file = 0; file < 4; file += 1) {
        await writeFile(
          join(projectRoot, dir, `service-${file}.ts`),
          `export const ${dir}${file} = ${file};\n`,
        );
      }
    }
    await mkdir(join(projectRoot, '.planr', 'stories'), { recursive: true });
    for (let file = 0; file < 20; file += 1) {
      await writeFile(
        join(projectRoot, '.planr', 'stories', `US-${file}.md`),
        `# Planning artifact ${file}\n`,
      );
    }
    await execFileAsync('git', ['add', '-A'], { cwd: projectRoot });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'monorepo'], { cwd: projectRoot });

    const workspace = await buildWorkspaceManifest(projectRoot, [], {
      localRoot,
      persistRoots: true,
      capturedAt: '2026-07-28T10:00:00.000Z',
    });

    const evidence = await collectOperatingEvidence({
      projectRoot,
      localRoot,
      cycleId: 'CYCLE-001',
      workspace,
      providers: ['repository', 'planr'],
      sensitivityCeiling: 'internal',
      // maxFiles=6 is smaller than the 12 product + 20 planning files combined.
      budgets: budgets({ maxFiles: 6 }),
      now: new Date('2026-07-28T10:01:00.000Z'),
    });

    const productTopLevels = new Set(
      evidence.items
        .filter((item) => item.source === 'repository' && !item.location.includes('/.planr/'))
        .map((item) => item.location.split('/').slice(1)[0]),
    );
    // All three product directories are represented — not just the
    // alphabetically-first `apps/` tree.
    expect(productTopLevels).toEqual(new Set(['apps', 'infra', 'packages']));
    expect(evidence.truncated).toBe(true);
  });

  it('is deterministic: the same repository under the same cap selects the same items twice', async () => {
    const { projectRoot, localRoot } = await gitProject('operate-fairness-determinism-');
    // More files than the cap across several product directories, so the capped
    // selection is a genuine subset that a non-deterministic order could vary.
    for (const dir of ['apps', 'infra', 'packages']) {
      await mkdir(join(projectRoot, dir), { recursive: true });
      for (let file = 0; file < 3; file += 1) {
        await writeFile(
          join(projectRoot, dir, `m-${file}.ts`),
          `export const x${file} = ${file};\n`,
        );
      }
    }
    await execFileAsync('git', ['add', '-A'], { cwd: projectRoot });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectRoot });
    const workspace = await buildWorkspaceManifest(projectRoot, [], {
      localRoot,
      persistRoots: true,
      capturedAt: '2026-07-28T10:00:00.000Z',
    });
    const collect = () =>
      collectOperatingEvidence({
        projectRoot,
        localRoot,
        cycleId: 'CYCLE-001',
        workspace,
        providers: ['repository'],
        sensitivityCeiling: 'internal',
        budgets: budgets({ maxFiles: 5 }),
        now: new Date('2026-07-28T10:01:00.000Z'),
      });

    // Same repository + same cap ⇒ the recency+path selection order picks the
    // identical item set and the evidence digest is reproducible.
    const first = await collect();
    const second = await collect();
    expect(second.items.map((item) => item.location)).toEqual(
      first.items.map((item) => item.location),
    );
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it('gates a repository-dependent role not-ready with a governed gap when the mission index retains zero repository items, while other ready roles still dispatch', async () => {
    const { projectRoot, localRoot } = await gitProject('operate-fairness-starve-');
    // The only tracked files live under dot-prefixed trees: their repository
    // items are collected but the mission index forbids dot-prefixed paths, so
    // the POST-index evidence retains ZERO repository items.
    await mkdir(join(projectRoot, '.planr', 'stories'), { recursive: true });
    await writeFile(
      join(projectRoot, '.planr', 'stories', 'US-001.md'),
      '# Roadmap\nThe current roadmap prioritizes activation and retention.\n',
    );
    await writeFile(
      join(projectRoot, '.planr', 'roadmap.md'),
      '# Roadmap\nBounded native operating packs and architecture notes.\n',
    );
    await execFileAsync('git', ['add', '-A'], { cwd: projectRoot });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'dot-only fixture'], {
      cwd: projectRoot,
    });

    const workspace = await buildWorkspaceManifest(projectRoot, [], {
      localRoot,
      persistRoots: true,
      capturedAt: '2026-07-28T10:00:00.000Z',
    });

    const evidence = await collectOperatingEvidence({
      projectRoot,
      localRoot,
      cycleId: 'CYCLE-001',
      workspace,
      providers: ['repository', 'planr', 'git'],
      sensitivityCeiling: 'internal',
      budgets: budgets(),
      now: new Date('2026-07-28T10:01:00.000Z'),
    });

    // Pre-index, repository-source items DO exist (dot-prefixed code files).
    expect(evidence.items.some((item) => item.source === 'repository')).toBe(true);
    // The collector reports the mission-index path-pattern loss up front (FR2).
    expect(
      evidence.warnings.some((warning) =>
        warning.includes('cannot be represented in the mission evidence index'),
      ),
    ).toBe(true);

    // POST-index: the mission evidence index retains ZERO repository items.
    const narrowed = narrowEvidenceToMissionCeiling(evidence, 'internal');
    const missionEvidenceIndex = buildOperatingEvidenceIndex(narrowed, {
      sensitivityCeiling: 'internal',
    });
    expect(missionEvidenceIndex.some((item) => item.source === 'repository')).toBe(false);

    const readiness = await evaluateEvidenceReadiness({
      cycleId: 'CYCLE-001',
      evidence: narrowed,
      // technology-risk requires repository (match=all); strategy-finance is
      // repository-independent (planr OR git, match=any).
      enabledRoles: ['technology-risk', 'strategy-finance'],
      now: new Date('2026-07-28T10:01:00.000Z'),
      missionEvidenceIndex,
    });

    const technologyRisk = readiness.roles.find((role) => role.roleId === 'technology-risk');
    const strategyFinance = readiness.roles.find((role) => role.roleId === 'strategy-finance');
    // Starved: gated not-ready with a gap id rather than "ready" on nothing.
    expect(technologyRisk?.modelCallAllowed).toBe(false);
    expect(technologyRisk?.readiness).toBe('not_evaluated');
    expect(technologyRisk?.gapId).toMatch(/^GAP-\d{3,}$/);
    // The repository-independent role still dispatches.
    expect(strategyFinance?.modelCallAllowed).toBe(true);
    expect(strategyFinance?.readiness).toBe('ready');

    const starvedRoleIds = readiness.roles
      .filter((role) => !role.modelCallAllowed)
      .map((role) => role.roleId);
    const gaps = await starvedRoleEvidenceGaps({
      cycleId: 'CYCLE-001',
      roleIds: starvedRoleIds,
      owner: 'Product owner',
      now: '2026-07-28T10:01:00.000Z',
    });
    expect(gaps).toEqual([
      expect.objectContaining({
        kind: 'operating-data-gap',
        affectedRoles: ['technology-risk'],
        status: 'open',
        owner: 'Product owner',
        evidenceRefs: [],
      }),
    ]);
    expect(gaps[0]?.reason).toContain('zero repository items');
  });
});
