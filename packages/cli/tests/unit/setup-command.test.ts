import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSetupCommand } from '../../src/cli/commands/setup.js';
import { isNonInteractive } from '../../src/services/interactive-state.js';
import { promptCheckbox, promptConfirm, promptSelect } from '../../src/services/prompt-service.js';
import {
  applySetup,
  previewSetup,
  type SetupPreview,
} from '../../src/services/runtime-manager-service.js';
import { display, logger } from '../../src/utils/logger.js';

vi.mock('../../src/services/interactive-state.js', () => ({ isNonInteractive: vi.fn() }));
vi.mock('../../src/services/prompt-service.js', () => ({
  promptCheckbox: vi.fn(),
  promptConfirm: vi.fn(),
  promptSelect: vi.fn(),
}));
vi.mock('../../src/services/runtime-manager-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/runtime-manager-service.js')>()),
  previewSetup: vi.fn(),
  applySetup: vi.fn(),
  detectRuntimes: () => [{ runtime: 'codex', command: 'codex', installed: true }],
  listRuntimeAdapters: () => [{ id: 'codex', installScopes: ['user', 'project'] }],
  inspectProjectContext: () => ({ valid: true, path: '/project', reason: 'planr' }),
  runtimeRoot: () => '/home/user/.planr/runtime',
}));
vi.mock('../../src/utils/logger.js', () => ({
  isVerbose: () => false,
  display: { heading: vi.fn(), line: vi.fn(), blank: vi.fn(), keyValue: vi.fn(), bullet: vi.fn() },
  logger: { heading: vi.fn(), dim: vi.fn(), warn: vi.fn(), success: vi.fn() },
}));

let plan: SetupPreview;
async function setup(...args: string[]) {
  const program = new Command().exitOverride().option('--project-dir <path>', '', '/project');
  registerSetupCommand(program, '2.2640.6');
  await program.parseAsync(['node', 'planr', 'setup', ...args]);
}
function output() {
  return [display.line, display.bullet, display.keyValue, logger.warn]
    .flatMap((fn) => vi.mocked(fn).mock.calls.flat())
    .join('\n');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isNonInteractive).mockReturnValue(false);
  vi.mocked(promptCheckbox).mockResolvedValue(['codex']);
  vi.mocked(promptSelect).mockImplementation(
    async (_message, choices, defaultValue) => defaultValue ?? choices[0].value,
  );
  vi.mocked(promptConfirm).mockResolvedValue(true);
  plan = {
    ok: true,
    dryRun: false,
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
    runtimeOperations: [],
    runtimeDiagnostics: [],
    actions: [
      {
        runtime: 'codex',
        scope: 'user',
        operation: 'update',
        target: '/home/user/.planr/runtime/install-modes/codex.json',
        description: 'Record mode',
      },
    ],
  };
  vi.mocked(previewSetup).mockImplementation(async () => plan);
  vi.mocked(applySetup).mockImplementation(async () => plan);
});

describe('setup onboarding', () => {
  it('configures skills without a misleading full-versus-planning choice', async () => {
    await setup('--dry-run');
    expect(promptCheckbox).toHaveBeenCalledTimes(1);
    expect(vi.mocked(promptSelect).mock.calls.map(([message]) => message)).toEqual([
      'Where should integrations be installed?',
      'How should Codex discover OpenPlanr skills?',
    ]);
    const choices = vi.mocked(promptSelect).mock.calls[1][1];
    expect(choices).toEqual([
      {
        name: 'OpenPlanr plugin — all skills in one plugin (recommended)',
        value: 'unified-plugin',
      },
      { name: 'Individual skills — available across projects', value: 'direct' },
    ]);
    expect(output()).toContain('OpenPlanr plugin');
    expect(output()).not.toContain('unified-plugin');
    expect(applySetup).not.toHaveBeenCalled();
  });

  it('uses the only project Codex integration without a redundant question', async () => {
    vi.mocked(promptSelect).mockResolvedValue('project');
    plan.scope = 'project';
    plan.runtimeScopes.codex = 'project';
    plan.skillModes.codex = 'project-rule';
    await setup('--dry-run');
    expect(promptSelect).toHaveBeenCalledTimes(1);
    expect(previewSetup).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'project', skillMode: 'project-rule' }),
    );
    expect(output()).toContain('Project skills');
  });

  it('offers integrations for both destinations when both scopes are selected', async () => {
    vi.mocked(promptSelect).mockImplementation(async (message, _choices, defaultValue) =>
      message === 'Where should integrations be installed?' ? 'both' : defaultValue,
    );
    await setup('--dry-run');
    const choices = vi.mocked(promptSelect).mock.calls[1][1];
    expect(choices.map((choice) => choice.value)).toEqual(['unified-plugin', 'direct']);
    expect(previewSetup).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'both', skillMode: 'unified-plugin' }),
    );
  });

  it('counts retirements and previews actual user and project destinations', async () => {
    plan.scope = 'both';
    plan.runtimeScopes.codex = 'both';
    plan.actions.push(
      {
        runtime: 'codex',
        scope: 'user',
        target: '/home/user/.codex/skills/planr-plan/SKILL.md',
        operation: 'retire',
        description: 'Retire old skill',
      },
      {
        runtime: 'codex',
        scope: 'project',
        target: '/project/.agents/skills/planr-plan/SKILL.md',
        operation: 'create',
        description: 'Install skill',
      },
      {
        runtime: 'codex',
        scope: 'project',
        target: '/project/.agents/skills/planr-spec/SKILL.md',
        operation: 'create',
        description: 'Install skill',
      },
    );
    await setup('--runtime', 'codex', '--scope', 'both', '--dry-run');
    expect(output()).toContain('0 to add, 1 to update, 1 to remove');
    expect(output()).toContain('/home/user/.codex/skills/planr-plan');
    expect(output()).toContain('/project/.agents/skills');
    expect(output()).toContain('Existing files are backed up before replacement');
    expect(promptConfirm).not.toHaveBeenCalled();
  });

  it('confirms managed replacement and application once using planned actions', async () => {
    plan.actions.push({
      runtime: 'codex',
      scope: 'user',
      target: '/home/user/.codex/skills/planr-plan/SKILL.md',
      operation: 'retire',
      description: 'Retire old skill',
    });
    await setup();
    expect(promptConfirm).toHaveBeenCalledExactlyOnceWith(
      'Back up and replace the listed OpenPlanr-managed files and plugins, then apply setup?',
      true,
    );
    expect(applySetup).toHaveBeenCalledWith(expect.objectContaining({ replaceManaged: true }));
  });

  it('preserves integrations when replacement is declined', async () => {
    plan.runtimeOperations = [
      {
        runtime: 'claude-code',
        kind: 'remove',
        id: 'planr@openplanr',
        scope: 'user',
        description: 'Remove legacy plugin',
      },
    ];
    vi.mocked(promptConfirm).mockResolvedValue(false);
    await setup();
    expect(applySetup).not.toHaveBeenCalled();
    expect(promptConfirm).toHaveBeenCalledTimes(1);
    expect(output()).toContain('existing integrations were preserved');
  });

  it('does not enter guided questions for an explicit --yes or JSON dry run', async () => {
    await setup('--yes');
    expect(promptCheckbox).not.toHaveBeenCalled();
    expect(promptConfirm).not.toHaveBeenCalled();
    expect(applySetup).toHaveBeenCalledOnce();
    vi.clearAllMocks();
    await setup('--json', '--dry-run');
    expect(promptCheckbox).not.toHaveBeenCalled();
    expect(display.line).toHaveBeenCalledExactlyOnceWith(JSON.stringify(plan));
    expect(applySetup).not.toHaveBeenCalled();
  });

  it('keeps --minimal compatible without claiming to install a planning product', async () => {
    plan.minimal = true;
    plan.runtimes = [];
    plan.skillModes = {};
    plan.actions = [];
    plan.pipelineVersion = null;
    await setup('--minimal');
    expect(output()).toContain('no setup files will be changed');
    expect(promptSelect).not.toHaveBeenCalled();
    expect(applySetup).not.toHaveBeenCalled();
    vi.clearAllMocks();
    await setup('--minimal', '--json');
    expect(display.line).toHaveBeenCalledExactlyOnceWith(JSON.stringify(plan));
  });
});
