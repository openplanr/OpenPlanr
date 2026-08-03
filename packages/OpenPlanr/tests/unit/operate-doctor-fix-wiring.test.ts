import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// FR7 (SPEC-005 T-013): prove `planr doctor --fix` — the FR7-named surface — is
// wired to the single owned-only scratch cleanup. Only the heavy doctor helpers
// are mocked; `previewAbandonedOperateScratch` and `purgeAbandonedOperateScratch`
// stay REAL so this exercises the actual owned-only removal through the real
// command action. If the wiring is removed, the abandoned owned scratch survives
// and these assertions go red.
const mocks = vi.hoisted(() => ({
  runtimeDoctor: vi.fn(),
  previewHomeProjectCleanup: vi.fn(),
  managedRuntimesForProject: vi.fn(),
  isOpenPlanrHome: vi.fn(),
  applySetup: vi.fn(),
  cleanupHomeProjectInstall: vi.fn(),
}));

vi.mock('../../src/services/runtime-manager-service.js', async (importActual) => {
  const actual =
    await importActual<typeof import('../../src/services/runtime-manager-service.js')>();
  return {
    ...actual,
    runtimeDoctor: mocks.runtimeDoctor,
    previewHomeProjectCleanup: mocks.previewHomeProjectCleanup,
    managedRuntimesForProject: mocks.managedRuntimesForProject,
    isOpenPlanrHome: mocks.isOpenPlanrHome,
    applySetup: mocks.applySetup,
    cleanupHomeProjectInstall: mocks.cleanupHomeProjectInstall,
  };
});

vi.mock('../../src/services/interactive-state.js', () => ({
  isNonInteractive: () => true,
}));

vi.mock('../../src/services/prompt-service.js', () => ({
  promptConfirm: vi.fn(async () => false),
}));

vi.mock('../../src/utils/logger.js', () => ({
  display: { bullet: vi.fn(), line: vi.fn(), heading: vi.fn() },
  logger: { heading: vi.fn(), success: vi.fn(), warn: vi.fn() },
}));

import { registerDoctorCommand } from '../../src/cli/commands/doctor.js';
import { writeOperatingScratch } from '../../src/services/operate/scratch.js';
import { resolveOperatingPaths } from '../../src/services/operate/workspace.js';

const directories: string[] = [];
const originalHome = process.env.OPENPLANR_HOME;
const originalExitCode = process.exitCode;

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function createProgram(projectDir: string): Command {
  const program = new Command()
    .name('planr')
    .exitOverride()
    .option('--project-dir <path>', 'project directory', projectDir)
    .option('--yes', 'confirm actions', false)
    .option('--json', 'emit JSON', false);
  program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
  registerDoctorCommand(program, '1.22.0');
  return program;
}

beforeEach(() => {
  mocks.runtimeDoctor.mockReset();
  mocks.runtimeDoctor.mockResolvedValue({ ok: true, repairs: [], diagnostics: [] });
  mocks.previewHomeProjectCleanup.mockReset();
  mocks.previewHomeProjectCleanup.mockResolvedValue([]);
  mocks.managedRuntimesForProject.mockReset();
  mocks.managedRuntimesForProject.mockResolvedValue([]);
  mocks.isOpenPlanrHome.mockReset();
  mocks.isOpenPlanrHome.mockReturnValue(false);
  mocks.applySetup.mockReset();
  mocks.cleanupHomeProjectInstall.mockReset();
  process.exitCode = undefined;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.OPENPLANR_HOME;
  else process.env.OPENPLANR_HOME = originalHome;
  process.exitCode = originalExitCode;
  await Promise.all(
    directories.splice(0).map((entry) => rm(entry, { recursive: true, force: true })),
  );
});

describe('doctor --fix wires the owned-only abandoned-scratch cleanup (FR7)', () => {
  it('removes abandoned OpenPlanr-owned scratch and leaves an unrelated file untouched', async () => {
    const home = await temporaryDirectory('openplanr-doctor-fix-home-');
    const projectRoot = await temporaryDirectory('openplanr-doctor-fix-project-');
    process.env.OPENPLANR_HOME = home;
    const paths = resolveOperatingPaths(projectRoot, { localRoot: join(home, '.planr') });

    // Owned scratch whose lease window already lapsed — a session that never
    // finalized. The default 15-minute window measured from this old clock is
    // long past, so it is abandoned.
    await writeOperatingScratch({
      paths,
      cycleId: 'CYCLE-001',
      key: 'strategy-finance',
      payload: { outcome: 'quiet', analysisMarkdown: '# left behind' },
      now: () => new Date('2000-01-01T00:00:00.000Z'),
    });
    const ownedFile = join(paths.scratch, 'CYCLE-001', 'strategy-finance.json');
    expect(existsSync(ownedFile)).toBe(true);

    // An unrelated file that merely landed under the scratch root carries no
    // owned manifest, so the owned-only cleanup must never touch it.
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(paths.scratch, 'FOREIGN'), { recursive: true });
    const foreignFile = join(paths.scratch, 'FOREIGN', 'not-ours.json');
    await writeFile(foreignFile, '{"user":"data"}\n');

    await createProgram(projectRoot).parseAsync([
      'node',
      'planr',
      '--yes',
      'doctor',
      '--fix',
      '--json',
    ]);

    expect(existsSync(ownedFile)).toBe(false);
    expect(existsSync(foreignFile)).toBe(true);
  });

  it('does not purge anything when no abandoned owned scratch is present', async () => {
    const home = await temporaryDirectory('openplanr-doctor-fix-clean-home-');
    const projectRoot = await temporaryDirectory('openplanr-doctor-fix-clean-project-');
    process.env.OPENPLANR_HOME = home;
    const paths = resolveOperatingPaths(projectRoot, { localRoot: join(home, '.planr') });

    // Live scratch (fresh lease from wall-clock) is an active dispatch, not
    // abandoned — `doctor --fix` must leave it in place.
    await writeOperatingScratch({
      paths,
      cycleId: 'CYCLE-002',
      key: 'technology-risk',
      payload: { outcome: 'quiet' },
    });
    const liveFile = join(paths.scratch, 'CYCLE-002', 'technology-risk.json');

    await createProgram(projectRoot).parseAsync([
      'node',
      'planr',
      '--yes',
      'doctor',
      '--fix',
      '--json',
    ]);

    expect(existsSync(liveFile)).toBe(true);
  });
});
