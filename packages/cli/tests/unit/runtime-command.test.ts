import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerRuntimeCommand } from '../../src/cli/commands/runtime.js';
import {
  applySetup,
  previewSetup,
  type SetupPreview,
} from '../../src/services/runtime-manager-service.js';

vi.mock('../../src/services/runtime-manager-service.js', async (original) => ({
  ...(await original<typeof import('../../src/services/runtime-manager-service.js')>()),
  previewSetup: vi.fn(),
  applySetup: vi.fn(),
}));
vi.mock('../../src/cli/commands/runtime-output.js', () => ({
  printRuntimeChanges: () => [],
  printChangedFiles: vi.fn(),
  printRuntimeFailures: vi.fn(),
}));
vi.mock('../../src/utils/logger.js', () => ({
  isVerbose: () => false,
  display: { line: vi.fn() },
  logger: { heading: vi.fn(), warn: vi.fn() },
}));
const preview = {
  ok: true,
  runtimes: ['codex'],
  actions: [],
  runtimeOperations: [],
  runtimeDiagnostics: [],
} as unknown as SetupPreview;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(previewSetup).mockResolvedValue(preview);
  vi.mocked(applySetup).mockResolvedValue(preview);
});
describe('named runtime update routing', () => {
  it.each(['install', 'update'])(
    '%s carries the intended existing-installation policy',
    async (operation) => {
      const program = new Command().exitOverride().option('--project-dir <path>', '', '/project');
      registerRuntimeCommand(program, '2.2640.6');
      await program.parseAsync([
        'node',
        'planr',
        'runtime',
        operation,
        'codex',
        '--scope',
        'user',
        '--yes',
        '--json',
      ]);
      const request = {
        projectDir: '/project',
        cliVersion: '2.2640.6',
        runtime: 'codex',
        scope: 'user',
        version: undefined,
        dryRun: false,
        ...(operation === 'update'
          ? { preserveExistingScopes: true, overrideExistingScope: true }
          : { merge: true }),
      };
      expect(previewSetup).toHaveBeenCalledExactlyOnceWith(request);
      expect(applySetup).toHaveBeenCalledExactlyOnceWith(request);
    },
  );
  it('does not apply a dry-run preview', async () => {
    const program = new Command().exitOverride().option('--project-dir <path>', '', '/project');
    registerRuntimeCommand(program, '2.2640.6');
    await program.parseAsync([
      'node',
      'planr',
      'runtime',
      'update',
      'claude',
      '--dry-run',
      '--json',
    ]);
    expect(previewSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: 'claude',
        dryRun: true,
        preserveExistingScopes: true,
        overrideExistingScope: false,
      }),
    );
    expect(applySetup).not.toHaveBeenCalled();
  });
});
