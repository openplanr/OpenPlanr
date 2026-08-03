import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyOperatingInitialization,
  prepareOperatingInitialization,
} from '../../src/services/operate/config.js';
import {
  diagnoseOperatingBoard,
  type OperatingDoctorDiagnostic,
} from '../../src/services/operate/doctor.js';
import { purgeAbandonedOperatingScratch } from '../../src/services/operate/maintenance.js';
import { writeOperatingScratch } from '../../src/services/operate/scratch.js';
import { resolveOperatingPaths } from '../../src/services/operate/workspace.js';
import { applySetup, runtimeDoctor } from '../../src/services/runtime-manager-service.js';

const execFileAsync = promisify(execFile);

function byCode(diagnostics: OperatingDoctorDiagnostic[], code: string): OperatingDoctorDiagnostic {
  const matches = diagnostics.filter((entry) => entry.code === code);
  expect(matches).toHaveLength(1);
  return matches[0];
}

describe('Operating Board doctor staleness diagnostics (FR11)', () => {
  const temporaryDirectories: string[] = [];

  beforeEach(() => {
    process.env.OPENPLANR_PIPELINE_ROOT =
      process.env.OPENPLANR_PIPELINE_ROOT ?? resolve('../planr-pipeline');
  });

  afterEach(async () => {
    delete process.env.OPENPLANR_PIPELINE_ROOT;
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) =>
          rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
        ),
    );
  });

  async function temporaryDirectory(prefix: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    temporaryDirectories.push(directory);
    return directory;
  }

  async function createGitProject(): Promise<string> {
    const projectRoot = await temporaryDirectory('openplanr-operate-doctor-stale-project-');
    await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
    await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
      cwd: projectRoot,
    });
    await execFileAsync(
      'git',
      ['remote', 'add', 'origin', 'https://github.com/openplanr/doctor-stale-fixture.git'],
      { cwd: projectRoot },
    );
    await writeFile(join(projectRoot, 'README.md'), '# Fixture\n');
    await execFileAsync('git', ['add', 'README.md'], { cwd: projectRoot });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectRoot });
    return projectRoot;
  }

  async function initBoard(projectRoot: string, localRoot: string): Promise<void> {
    const preview = await prepareOperatingInitialization({
      projectRoot,
      localRoot,
      profile: 'engineering',
      decisionOwner: 'Product owner',
      planningEngine: 'openplanr',
      runtime: 'codex',
      timezone: 'UTC',
      sensitivityCeiling: 'internal',
      enabledProviders: ['repository', 'git'],
      charter: {
        purpose: 'Prove board-scoped staleness diagnostics.',
        goals: ['Diagnose stale machine-local state.'],
      },
      now: '2026-07-28T10:00:00.000Z',
    });
    await applyOperatingInitialization({
      projectRoot,
      localRoot,
      preview,
      confirmationDigest: preview.previewDigest,
    });
  }

  it('reports a stale adapter session bound to a superseded board generation with a scoped fix', async () => {
    const projectRoot = await createGitProject();
    const localRoot = await temporaryDirectory('openplanr-operate-doctor-stale-local-');
    await initBoard(projectRoot, localRoot);
    const paths = resolveOperatingPaths(projectRoot, { localRoot });
    await mkdir(paths.advisors, { recursive: true });
    // A session whose boardIdentity does not match the committed event-chain
    // genesis — left behind by a prior board generation at this path.
    await writeFile(
      join(paths.advisors, 'CYCLE-001.json'),
      `${JSON.stringify({
        implementation: 'openplanr-operate-adapter',
        boardIdentity: `sha256:${'0'.repeat(64)}`,
        cycleId: 'CYCLE-001',
      })}\n`,
      { mode: 0o600 },
    );

    const diagnostics = await diagnoseOperatingBoard({ projectRoot, localRoot });
    const diagnostic = byCode(diagnostics, 'operate-adapter-sessions');
    expect(diagnostic.status).toBe('warn');
    expect(diagnostic.message).toMatch(/superseded board generation|absent from committed state/);
    expect(diagnostic.fix).toBe(
      'Run `planr operate cache purge --yes` to clear the stale adapter sessions before the next dispatch.',
    );
  });

  it('reports a stale incremental baseline whose workspaceDigest drifted with a scoped fix', async () => {
    const projectRoot = await createGitProject();
    const localRoot = await temporaryDirectory('openplanr-operate-doctor-stale-local-');
    await initBoard(projectRoot, localRoot);
    const paths = resolveOperatingPaths(projectRoot, { localRoot });
    const incrementalDir = join(paths.evidence, 'incremental');
    await mkdir(incrementalDir, { recursive: true });
    // A baseline captured against a workspace that no longer matches the
    // committed workspace manifest digest.
    await writeFile(
      join(incrementalDir, 'stale-baseline.json'),
      `${JSON.stringify({
        implementation: 'openplanr-operate-incremental-evidence',
        key: `sha256:${'a'.repeat(64)}`,
        workspaceDigest: `sha256:${'0'.repeat(64)}`,
      })}\n`,
      { mode: 0o600 },
    );

    const diagnostics = await diagnoseOperatingBoard({ projectRoot, localRoot });
    const diagnostic = byCode(diagnostics, 'operate-incremental-baseline');
    expect(diagnostic.status).toBe('warn');
    expect(diagnostic.message).toMatch(/no longer match the committed workspace digest/);
    expect(diagnostic.fix).toBe(
      'Run `planr operate cache purge --yes` to drop the stale incremental baselines.',
    );
  });

  it('passes cleanly when no machine-local adapter session or incremental baseline exists', async () => {
    const projectRoot = await createGitProject();
    const localRoot = await temporaryDirectory('openplanr-operate-doctor-clean-local-');
    await initBoard(projectRoot, localRoot);

    const diagnostics = await diagnoseOperatingBoard({ projectRoot, localRoot });
    expect(byCode(diagnostics, 'operate-adapter-sessions').status).toBe('pass');
    expect(byCode(diagnostics, 'operate-incremental-baseline').status).toBe('pass');
  });

  // FR8: a fresh init creates no empty `projections/` directory — the retired
  // SPEC-003 tree is never recreated by `ensureOperatingDirectories`.
  it('creates no empty projections/ directory on a fresh init', async () => {
    const projectRoot = await createGitProject();
    const localRoot = await temporaryDirectory('openplanr-operate-doctor-projections-local-');
    await initBoard(projectRoot, localRoot);
    const paths = resolveOperatingPaths(projectRoot, { localRoot });
    expect(existsSync(paths.root)).toBe(true);
    expect(existsSync(join(paths.root, 'projections'))).toBe(false);
  });

  // FR7 (T-006): abandoned OpenPlanr-owned scratch is a named warning, and the
  // scoped purge removes ONLY confirmed owned stale scratch — never another
  // machine-local cache, and never an unrelated file under the scratch root.
  it('warns on abandoned owned scratch and removes only it, leaving other machine-local caches', async () => {
    const projectRoot = await createGitProject();
    const localRoot = await temporaryDirectory('openplanr-operate-doctor-scratch-local-');
    await initBoard(projectRoot, localRoot);
    const paths = resolveOperatingPaths(projectRoot, { localRoot });

    // Owned scratch whose lease window already lapsed — a session that never
    // finalized (its handoff was never cleaned by a successful record/finalize).
    await writeOperatingScratch({
      paths,
      cycleId: 'CYCLE-001',
      key: 'strategy-finance',
      payload: { outcome: 'quiet', analysisMarkdown: '# left behind' },
      now: () => new Date('2000-01-01T00:00:00.000Z'),
    });

    // Other machine-local caches scratch cleanup must never touch.
    await mkdir(paths.advisors, { recursive: true });
    const sessionFile = join(paths.advisors, 'CYCLE-001.json');
    await writeFile(
      sessionFile,
      `${JSON.stringify({ implementation: 'openplanr-operate-adapter', cycleId: 'CYCLE-001' })}\n`,
      { mode: 0o600 },
    );
    const incrementalDir = join(paths.evidence, 'incremental');
    await mkdir(incrementalDir, { recursive: true });
    const baselineFile = join(incrementalDir, 'baseline.json');
    await writeFile(
      baselineFile,
      `${JSON.stringify({ implementation: 'openplanr-operate-incremental-evidence' })}\n`,
      { mode: 0o600 },
    );
    // An unrelated file that merely landed under the scratch root: no owned
    // manifest, so it is never reported and never removed.
    await mkdir(join(paths.scratch, 'FOREIGN'), { recursive: true });
    const foreignFile = join(paths.scratch, 'FOREIGN', 'not-ours.json');
    await writeFile(foreignFile, '{"user":"data"}\n');

    const diagnostics = await diagnoseOperatingBoard({ projectRoot, localRoot });
    const diagnostic = byCode(diagnostics, 'operate-scratch');
    expect(diagnostic.status).toBe('warn');
    expect(diagnostic.message).toContain('CYCLE-001');
    expect(diagnostic.message).toMatch(/never finalized/);
    // FR7 (SPEC-005 T-013): the abandoned-scratch diagnostic now points at the
    // FR7-named `planr doctor --fix` surface, which delegates to the same
    // owned-only cleanup this test then exercises directly.
    expect(diagnostic.fix).toBe(
      'Run `planr doctor --fix` to remove only the confirmed OpenPlanr-owned stale scratch.',
    );

    const purged = await purgeAbandonedOperatingScratch({ projectRoot, localRoot });
    expect(purged).toMatchObject({ removed: 1, cycles: ['CYCLE-001'] });

    // Only the owned stale scratch is gone; every other cache and the unrelated
    // file under the scratch root are untouched.
    expect(existsSync(join(paths.scratch, 'CYCLE-001', 'strategy-finance.json'))).toBe(false);
    expect(existsSync(sessionFile)).toBe(true);
    expect(existsSync(baselineFile)).toBe(true);
    expect(existsSync(foreignFile)).toBe(true);

    // After the purge the doctor no longer warns about abandoned scratch.
    const after = await diagnoseOperatingBoard({ projectRoot, localRoot });
    expect(byCode(after, 'operate-scratch').status).toBe('pass');
  });

  it('does not warn while scratch is still inside its live lease window', async () => {
    const projectRoot = await createGitProject();
    const localRoot = await temporaryDirectory('openplanr-operate-doctor-scratch-live-local-');
    await initBoard(projectRoot, localRoot);
    const paths = resolveOperatingPaths(projectRoot, { localRoot });
    // Fresh scratch (default 15-minute window from wall-clock) is an active dispatch.
    await writeOperatingScratch({
      paths,
      cycleId: 'CYCLE-002',
      key: 'technology-risk',
      payload: { outcome: 'quiet' },
    });
    const diagnostics = await diagnoseOperatingBoard({ projectRoot, localRoot });
    expect(byCode(diagnostics, 'operate-scratch').status).toBe('pass');
  });
});

describe('runtime lock-drift is not a false FAIL after an upgrade (FR11)', () => {
  let root: string;
  let projectDir: string;
  let userHome: string;
  const cliVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version as string;
  const pipelineRoot = process.env.OPENPLANR_PIPELINE_ROOT ?? resolve('../planr-pipeline');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'openplanr-doctor-lock-drift-'));
    projectDir = join(root, 'project');
    userHome = join(root, 'home');
    process.env.OPENPLANR_HOME = userHome;
    process.env.OPENPLANR_PIPELINE_ROOT = pipelineRoot;
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(projectDir, '.planr'), { recursive: true });
    writeFileSync(join(projectDir, '.planr', 'config.json'), '{}\n');
  });

  afterEach(() => {
    delete process.env.OPENPLANR_HOME;
    delete process.env.OPENPLANR_PIPELINE_ROOT;
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('presents a CLI-component drift as expected-after-upgrade but keeps a stale skill bundle a fail', async () => {
    await applySetup({ projectDir, cliVersion, runtime: 'codex', scope: 'project' });
    const lockPath = join(projectDir, '.planr', 'runtime-lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
      components: { cli: string; pipeline?: string; skills: string };
    };

    // Upgrade-only: the CLI version the lock recorded trails the installed build.
    writeFileSync(
      lockPath,
      `${JSON.stringify({ ...lock, components: { ...lock.components, cli: '0.0.0-old' } }, null, 2)}\n`,
    );
    const upgraded = await runtimeDoctor(projectDir);
    const upgradeDrift = upgraded.diagnostics.find((entry) => entry.code === 'lock-drift');
    expect(upgradeDrift).toBeDefined();
    expect(upgradeDrift?.status).toBe('warn');
    expect(upgradeDrift?.message).toMatch(/expected after upgrading/);
    expect(upgradeDrift?.fix).toContain('planr runtime update all --scope project');

    // A component drift that is NOT the CLI (a pinned obsolete skill bundle)
    // remains a genuine fail — the softening is scoped to expected upgrades only.
    writeFileSync(
      lockPath,
      `${JSON.stringify({ ...lock, components: { ...lock.components, skills: '0.0.0-old' } }, null, 2)}\n`,
    );
    const stale = await runtimeDoctor(projectDir);
    expect(stale.diagnostics.find((entry) => entry.code === 'lock-drift')).toMatchObject({
      status: 'fail',
    });
  });
});
