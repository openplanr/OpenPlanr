import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerDoctorCommand } from '../../src/cli/commands/doctor.js';
import { isNonInteractive } from '../../src/services/interactive-state.js';
import { promptConfirm } from '../../src/services/prompt-service.js';
import {
  applySetup,
  cleanupHomeProjectInstall,
  installedRuntimeScopes,
  previewHomeProjectCleanup,
  runtimeDoctor,
  type SetupPreview,
} from '../../src/services/runtime-manager-service.js';
import { listManagedServers } from '../../src/services/server-lifecycle-service.js';
import { display, logger } from '../../src/utils/logger.js';

vi.mock('../../src/services/server-lifecycle-service.js', () => ({ listManagedServers: vi.fn() }));
vi.mock('../../src/services/interactive-state.js', () => ({ isNonInteractive: vi.fn() }));
vi.mock('../../src/services/prompt-service.js', () => ({ promptConfirm: vi.fn() }));
vi.mock('../../src/services/runtime-manager-service.js', () => ({
  applySetup: vi.fn(),
  cleanupHomeProjectInstall: vi.fn(),
  installedRuntimeScopes: vi.fn(),
  previewHomeProjectCleanup: vi.fn(),
  runtimeDoctor: vi.fn(),
  isOpenPlanrHome: (directory: string) => directory === '/home/user',
  runtimeRoot: () => '/home/user/.planr/runtime',
}));
vi.mock('../../src/utils/logger.js', () => ({
  isVerbose: () => false,
  display: { line: vi.fn(), bullet: vi.fn() },
  logger: { heading: vi.fn(), warn: vi.fn(), success: vi.fn() },
}));

let preview: SetupPreview;
const diagnosis = { ok: true, repairs: [], diagnostics: [] };
async function doctor(...args: string[]) {
  const program = new Command().exitOverride().option('--project-dir <path>', '', '/project');
  registerDoctorCommand(program, '2.2640.6');
  await program.parseAsync(['node', 'planr', 'doctor', ...args]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listManagedServers).mockResolvedValue([]);
  process.exitCode = 0;
  vi.mocked(isNonInteractive).mockReturnValue(false);
  vi.mocked(promptConfirm).mockResolvedValue(true);
  vi.mocked(previewHomeProjectCleanup).mockResolvedValue([]);
  vi.mocked(installedRuntimeScopes).mockResolvedValue([
    { runtime: 'codex', scope: 'user', skillMode: 'unified-plugin' },
  ]);
  vi.mocked(runtimeDoctor).mockResolvedValue(diagnosis);
  preview = {
    ok: true,
    dryRun: true,
    minimal: false,
    runtimes: ['codex'],
    runtimeScopes: { codex: 'user' },
    scope: 'user',
    pipelineVersion: '0.55.7',
    commandPrefix: 'namespaced',
    skillModes: { codex: 'unified-plugin' },
    detectedRuntimes: ['codex'],
    unavailableRuntimes: [],
    scopeIncompatibleRuntimes: [],
    projectContext: { valid: true, path: '/project', reason: 'planr' },
    actions: [],
    runtimeDiagnostics: [],
    runtimeOperations: [],
  };
  vi.mocked(applySetup).mockImplementation(async (options) => ({
    ...preview,
    dryRun: Boolean(options.dryRun),
    restartRequired: !options.dryRun && preview.runtimeOperations.length > 0,
  }));
});

describe('doctor repair command', () => {
  it('reports owned servers without stopping them or revealing control credentials', async () => {
    vi.mocked(listManagedServers).mockResolvedValue([
      { instanceId: 'a'.repeat(22), pid: 123, port: 7474, kind: 'dashboard', status: 'running' },
    ]);
    await doctor('--json');
    const value = JSON.parse(String(vi.mocked(display.line).mock.calls[0][0]));
    expect(value.servers).toHaveLength(1);
    expect(value.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'owned-local-servers',
        status: 'pass',
        message: '1 owned local service running.',
      }),
    );
  });

  it('reports native inspection failures without applying a partial repair', async () => {
    preview.runtimeDiagnostics = [
      {
        runtime: 'codex',
        status: 'fail',
        message: 'Could not inspect native plugins',
        fix: 'Repair Codex configuration and retry.',
      },
    ];
    vi.mocked(runtimeDoctor).mockResolvedValue({
      ...diagnosis,
      repairs: [{ operation: 'remove', target: '/daemon' }],
    });
    await doctor('--fix', '--yes', '--json');
    expect(applySetup).toHaveBeenCalledTimes(1);
    expect(runtimeDoctor).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(display.line).mock.calls.at(-1)?.[0] ?? '{}')).toMatchObject({
      ok: false,
      repairsApplied: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'runtime-codex-repair', status: 'fail' }),
      ]),
    });
    expect(logger.success).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
  it('preserves saved plugin mode and previews native-only repairs before confirmation', async () => {
    preview.runtimeOperations = [
      {
        runtime: 'codex',
        kind: 'remove',
        id: 'openplanr@openplanr-local',
        scope: 'user',
        description: 'Retire the managed legacy plugin',
      },
    ];
    await doctor('--fix');
    expect(applySetup).toHaveBeenCalledTimes(2);
    expect(applySetup).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        dryRun: true,
        skillMode: 'unified-plugin',
        preserveExistingScopes: true,
      }),
    );
    expect(applySetup).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        replaceManaged: true,
        skillMode: 'unified-plugin',
        preserveExistingScopes: true,
      }),
    );
    expect(promptConfirm).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Restart the affected coding agent'),
    );
  });

  it('cancels without native mutations or file writes', async () => {
    preview.runtimeOperations = [
      {
        runtime: 'codex',
        kind: 'install',
        id: 'planr@openplanr-local',
        scope: 'user',
        description: 'Install plugin',
      },
    ];
    vi.mocked(promptConfirm).mockResolvedValue(false);
    await doctor('--fix');
    expect(applySetup).toHaveBeenCalledOnce();
    expect(vi.mocked(applySetup).mock.calls[0][0].dryRun).toBe(true);
    expect(cleanupHomeProjectInstall).not.toHaveBeenCalled();
  });

  it('does not regenerate healthy integrations while repairing only a stale daemon', async () => {
    vi.mocked(runtimeDoctor).mockResolvedValue({
      ...diagnosis,
      repairs: [
        {
          id: 'dashboard',
          operation: 'remove',
          target: '/home/user/.planr/dashboard-daemon',
          applied: false,
        },
      ],
    });
    await doctor('--fix', '--yes');
    expect(applySetup).toHaveBeenCalledOnce();
    expect(runtimeDoctor).toHaveBeenCalledWith('/project', { pipelineRepair: 'apply' });
  });

  it('performs no mutations or confirmation on a second healthy repair', async () => {
    await doctor('--fix');
    expect(applySetup).toHaveBeenCalledOnce();
    expect(promptConfirm).not.toHaveBeenCalled();
    expect(runtimeDoctor).toHaveBeenCalledOnce();
  });

  it('groups hundreds of changed assets and exposes exact operations in JSON', async () => {
    preview.actions = Array.from({ length: 338 }, (_, index) => ({
      runtime: 'codex',
      scope: 'user',
      operation: 'update',
      target: `/home/user/.codex/skills/asset-${index}`,
      description: 'Repair asset',
    }));
    vi.mocked(promptConfirm).mockResolvedValue(false);
    await doctor('--fix');
    expect(display.bullet).toHaveBeenCalledTimes(1);
    expect(display.bullet).toHaveBeenCalledWith('Codex (user): 338 files to update');
    vi.mocked(display.line).mockClear();
    vi.mocked(isNonInteractive).mockReturnValue(true);
    await doctor('--fix', '--json');
    const output = JSON.parse(String(vi.mocked(display.line).mock.calls[0][0]));
    expect(output.repairsApplied).toBe(false);
    expect(output.repairPreview.integrations.actions).toHaveLength(338);
    expect(output.repairPreview.integrations.skillModes.codex).toBe('unified-plugin');
  });

  it('repairs user integrations discovered independently of the current project record', async () => {
    vi.mocked(installedRuntimeScopes).mockResolvedValue([
      { runtime: 'claude-code', scope: 'user' },
      { runtime: 'codex', scope: 'user', skillMode: 'direct' },
      { runtime: 'cursor', scope: 'project' },
    ]);
    await doctor('--fix');
    expect(applySetup).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimes: ['claude-code', 'codex', 'cursor'],
        skillMode: 'direct',
        preserveExistingScopes: true,
      }),
    );
  });
});
