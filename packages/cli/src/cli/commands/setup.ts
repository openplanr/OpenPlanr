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
  type SkillInstallMode,
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
  if (preview.skillModes.codex) display.keyValue('Codex skills', preview.skillModes.codex);
  display.keyValue('Skill names', 'canonical planr-*');
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
  if (preview.runtimeOperations.length > 0) {
    display.blank();
    for (const runtime of ['claude-code', 'codex'] as const) {
      const operations = preview.runtimeOperations.filter(
        (operation) => operation.runtime === runtime,
      );
      if (operations.length === 0) continue;
      display.line(`  ${runtimeLabels[runtime]} runtime:`);
      for (const operation of operations) display.bullet(operation.description);
    }
  }
  for (const diagnostic of preview.runtimeDiagnostics.filter((item) => item.status !== 'pass')) {
    display.line(`  ${diagnostic.status.toUpperCase()} ${diagnostic.message}`);
    if (diagnostic.fix) display.line(`       Fix: ${diagnostic.fix}`);
  }
  // Setup must report what it detected, what it wired, AND what it skipped and
  // why — in the non-guided (flag-driven) path too, not only in the guided wizard's
  // `printRuntimeDetection`. A runtime dropped because the run defaulted to user
  // scope (`scopeIncompatibleRuntimes`) or because it is not installed
  // (`unavailableRuntimes`) is surfaced here with its reason, so a skip is never
  // silent.
  const skipped: Array<{ runtime: RuntimeId; reason: string }> = [
    ...preview.scopeIncompatibleRuntimes.map((runtime) => ({
      runtime,
      reason: 'requires project scope',
    })),
    ...preview.unavailableRuntimes.map((runtime) => ({
      runtime,
      reason: 'not detected on PATH',
    })),
  ];
  if (skipped.length > 0) {
    display.blank();
    display.line('  Skipped:');
    for (const item of skipped) {
      display.bullet(`${runtimeLabels[item.runtime]} — ${item.reason}`);
    }
  }
}

export function registerSetupCommand(program: Command, cliVersion: string) {
  program
    .command('setup')
    .description('Detect runtimes and install or migrate OpenPlanr runtime adapters')
    .option('--runtime <runtime>', 'auto, claude, codex, cursor, or all')
    .option('--scope <scope>', 'user, project, or both')
    .option('--skill-mode <mode>', 'Codex skill delivery: direct, unified-plugin, or project-rule')
    .option(
      '--replace-managed',
      'replace only manifest-owned OpenPlanr discovery content when switching modes',
      false,
    )
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
        opts.skillMode === undefined &&
        !opts.minimal;
      let minimal = Boolean(opts.minimal);
      let scope = (opts.scope as InstallScope | undefined) ?? 'user';
      let runtimes: RuntimeId[] | undefined;
      let skillMode = opts.skillMode as SkillInstallMode | undefined;

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
        if (!minimal && (runtimes ?? []).includes('codex')) {
          const choices: Array<{ name: string; value: SkillInstallMode }> = [];
          if (scope === 'user' || scope === 'both') {
            choices.push(
              {
                name: 'Unified plugin — one OpenPlanr suite entry (recommended)',
                value: 'unified-plugin',
              },
              { name: 'Direct skills — individually managed skill directories', value: 'direct' },
            );
          }
          if (scope === 'project' || scope === 'both')
            choices.push({ name: 'Project rule — current project only', value: 'project-rule' });
          skillMode = await promptSelect(
            'How should Codex discover OpenPlanr skills?',
            choices,
            choices[0].value,
          );
        }
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
        skillMode,
        replaceManaged: Boolean(opts.replaceManaged),
      };
      const preview = await previewSetup(options);
      if (opts.json) {
        if (opts.dryRun) {
          display.line(JSON.stringify(preview));
          return;
        }
      } else printPreview(preview);
      if (opts.dryRun) return;
      if (
        guided &&
        preview.runtimeDiagnostics.some(
          (diagnostic) =>
            diagnostic.message.includes('manifest-owned direct Codex asset') ||
            diagnostic.message.includes('Legacy Claude plugin installation'),
        )
      ) {
        options.replaceManaged = await promptConfirm(
          'Replace only the existing OpenPlanr-managed discovery files?',
          true,
        );
        if (!options.replaceManaged) {
          logger.warn('Setup cancelled; existing Codex discovery content was preserved.');
          return;
        }
      }
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
        if (result.appliedRuntimeOperations?.length) {
          display.keyValue(
            'Coding agents',
            `${result.appliedRuntimeOperations.length} marketplace/plugin operation(s) applied`,
          );
        }
        if (result.restartRequired) {
          logger.warn(
            'Restart the updated coding agent to load the new OpenPlanr discovery content.',
          );
        }
        display.blank();
        display.line('Verify:');
        display.line('  planr doctor');
        display.blank();
        display.line('Start:');
        display.line('  planr init');
        display.line('  Invoke $planr:plan in your active coding agent.');
      }
    });
}
