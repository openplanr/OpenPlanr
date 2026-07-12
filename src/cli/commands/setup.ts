import type { Command } from 'commander';
import { isNonInteractive } from '../../services/interactive-state.js';
import { promptCheckbox, promptConfirm, promptSelect } from '../../services/prompt-service.js';
import {
  applySetup,
  detectRuntimes,
  type InstallScope,
  inspectProjectContext,
  listRuntimeAdapters,
  previewSetup,
  type RuntimeChoice,
  type RuntimeId,
  RuntimeManagerError,
} from '../../services/runtime-manager-service.js';
import { display, isVerbose, logger } from '../../utils/logger.js';

const runtimeLabels: Record<RuntimeId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
};

function printRuntimeDetection(): void {
  display.heading('Detected coding agents');
  for (const item of detectRuntimes()) {
    if (item.installed) display.line(`  ✓ ${runtimeLabels[item.runtime]} (${item.command})`);
    else
      display.line(
        `  – ${runtimeLabels[item.runtime]} not detected (${item.command}; install or enable its shell command to use it)`,
      );
  }
  display.blank();
  logger.dim('OpenPlanr configures coding agents; it does not install them.');
}

function printPreview(preview: Awaited<ReturnType<typeof previewSetup>>): void {
  logger.heading('OpenPlanr setup preview');
  display.keyValue('Runtimes', preview.runtimes.join(', ') || 'planning only');
  display.keyValue('Scope', preview.scope);
  display.keyValue('Pipeline', preview.pipelineVersion ?? 'omitted');
  for (const scope of ['user', 'project'] as const) {
    const actions = preview.actions.filter(
      (action) => action.scope === scope && action.operation !== 'unchanged',
    );
    const creates = actions.filter((action) => action.operation === 'create').length;
    const updates = actions.filter((action) => action.operation === 'update').length;
    display.keyValue(
      `${scope === 'user' ? 'User' : 'Project'} scope`,
      `${creates} create, ${updates} update`,
    );
  }
  if (isVerbose()) {
    display.blank();
    for (const action of preview.actions) {
      display.bullet(`${action.operation.padEnd(9)} ${action.target}`);
    }
  }
}

export function registerSetupCommand(program: Command, cliVersion: string) {
  program
    .command('setup')
    .description('Detect runtimes and install or migrate OpenPlanr runtime adapters')
    .option('--runtime <runtime>', 'auto, claude, codex, cursor, or all')
    .option('--scope <scope>', 'user, project, or both')
    .option('--minimal', 'planning-only setup; do not install the pipeline', false)
    .option('--version <version>', 'pin the pipeline and adapter version')
    .option('--dry-run', 'preview exact changes without writing', false)
    .option('--yes', 'apply without an interactive confirmation', false)
    .option('--json', 'emit machine-readable output', false)
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const guided =
        !isNonInteractive() &&
        opts.runtime === undefined &&
        opts.scope === undefined &&
        !opts.minimal;
      let minimal = Boolean(opts.minimal);
      let scope = (opts.scope as InstallScope | undefined) ?? 'user';
      let runtimes: RuntimeId[] | undefined;

      if (guided) {
        logger.heading('Welcome to OpenPlanr');
        printRuntimeDetection();
        const mode = await promptSelect(
          'What would you like to install?',
          [
            {
              name: 'Full workflow — planning + PO → Design → Review → DEV → QA',
              value: 'full',
            },
            { name: 'Planning only', value: 'minimal' },
          ],
          'full',
        );
        minimal = mode === 'minimal';
        if (!minimal) {
          const detected = detectRuntimes().filter((item) => item.installed);
          const adapters = listRuntimeAdapters();
          if (detected.length === 0) {
            throw new RuntimeManagerError(
              'E_RUNTIME_NOT_FOUND',
              'No supported coding agent was detected.',
              'Install or enable Claude Code, Codex, or Cursor, then rerun setup.',
            );
          }
          runtimes = await promptCheckbox(
            'Which detected coding agents should OpenPlanr configure?',
            detected.map((item) => ({
              name: `${runtimeLabels[item.runtime]} (${item.command})${
                adapters
                  .find((adapter) => adapter.id === item.runtime)
                  ?.installScopes.includes('user')
                  ? ''
                  : ' — project scope required'
              }`,
              value: item.runtime,
              checked:
                adapters
                  .find((adapter) => adapter.id === item.runtime)
                  ?.installScopes.includes('user') ?? false,
            })),
          );
          if (runtimes.length === 0) {
            logger.warn('No coding agents selected; setup cancelled.');
            return;
          }
        }

        const context = inspectProjectContext(projectDir);
        const adapters = listRuntimeAdapters();
        const requiresProject =
          !minimal &&
          (runtimes ?? []).some(
            (runtime) =>
              !adapters.find((adapter) => adapter.id === runtime)?.installScopes.includes('user'),
          );
        display.blank();
        display.keyValue('Current directory', context.path);
        if (!context.valid) {
          logger.warn('This directory is not a Git worktree or initialized OpenPlanr project.');
        }
        if (requiresProject && !context.valid) {
          throw new RuntimeManagerError(
            'E_PROJECT_CONTEXT_REQUIRED',
            'One or more selected coding agents require project-scoped installation.',
            'Change into a Git or initialized OpenPlanr project, or select only user-scope agents.',
          );
        }
        const scopeChoices: Array<{ name: string; value: InstallScope }> = [];
        if (!requiresProject) {
          scopeChoices.push({ name: 'User scope — available across projects', value: 'user' });
        }
        if (context.valid) {
          scopeChoices.push(
            { name: `Current project — ${context.path}`, value: 'project' },
            { name: `Both user and current project — ${context.path}`, value: 'both' },
          );
        }
        scope = await promptSelect(
          'Where should integrations be installed?',
          scopeChoices,
          requiresProject ? 'project' : 'user',
        );
      }

      const options = {
        projectDir,
        cliVersion,
        runtime: (opts.runtime as RuntimeChoice | undefined) ?? 'auto',
        runtimes,
        scope,
        minimal,
        version: opts.version as string | undefined,
        dryRun: Boolean(opts.dryRun),
      };
      const preview = await previewSetup(options);
      if (opts.json) {
        if (opts.dryRun) {
          display.line(JSON.stringify(preview));
          return;
        }
      } else printPreview(preview);
      if (opts.dryRun) return;
      if (!opts.yes && !program.opts().yes && isNonInteractive()) {
        throw new RuntimeManagerError(
          'E_CONFIRMATION_REQUIRED',
          'Setup cannot apply changes without confirmation in a non-interactive terminal.',
          'Review `planr setup --dry-run`, then rerun with explicit choices and `--yes`.',
        );
      }
      const confirmed =
        opts.yes || program.opts().yes || (await promptConfirm('Apply these changes?', true));
      if (!confirmed) {
        if (opts.json) display.line(JSON.stringify({ ok: false, action: 'cancelled' }));
        else logger.warn('Setup cancelled; no files were changed.');
        return;
      }
      const result = await applySetup(options);
      if (opts.json) display.line(JSON.stringify(result));
      else {
        logger.success('Setup complete');
        if (result.backupDir) display.keyValue('Backup', result.backupDir);
        display.blank();
        display.line('Verify:');
        display.line('  planr doctor');
        display.blank();
        display.line('Start:');
        display.line('  planr init');
        display.line('  planr pipeline plan <feature>');
      }
    });
}
