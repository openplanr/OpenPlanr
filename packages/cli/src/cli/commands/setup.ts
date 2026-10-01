import path from 'node:path';
import type { Command } from 'commander';
import { isNonInteractive } from '../../services/interactive-state.js';
import { promptCheckbox, promptConfirm, promptSelect } from '../../services/prompt-service.js';
import { RUNTIME_LABELS as runtimeLabels } from '../../services/runtime-change-summary.js';
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
  runtimeRoot,
  type SkillInstallMode,
} from '../../services/runtime-manager-service.js';
import { display, isVerbose, logger } from '../../utils/logger.js';
import { printRuntimeChanges } from './runtime-output.js';

const skillModeLabels: Record<SkillInstallMode, string> = {
  'unified-plugin': 'OpenPlanr plugin',
  direct: 'Individual skills',
  'project-rule': 'Project skills',
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
  logger.dim('Setup adds OpenPlanr skills to your coding agents. Your agents run the workflows.');
}

function inside(target: string, directory: string): boolean {
  const relative = path.relative(directory, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function printDestinations(preview: Awaited<ReturnType<typeof previewSetup>>): void {
  display.line('  Destinations:');
  for (const runtime of [...preview.runtimes, 'core'] as const) {
    for (const scope of ['user', 'project'] as const) {
      const targets = preview.actions
        .filter(
          (action) =>
            action.runtime === runtime &&
            action.scope === scope &&
            !inside(action.target, runtimeRoot()),
        )
        .map((action) => action.target);
      if (targets.length === 0) continue;
      let directory = path.dirname(targets[0]);
      while (targets.some((target) => !inside(target, directory)))
        directory = path.dirname(directory);
      display.bullet(
        `${runtime === 'core' ? 'Project compatibility record' : runtimeLabels[runtime]} (${scope === 'user' ? 'across projects' : 'this project'}): ${directory}`,
      );
    }
  }
}

function printPreview(preview: Awaited<ReturnType<typeof previewSetup>>, cliVersion: string): void {
  logger.heading('OpenPlanr setup preview');
  display.keyValue('OpenPlanr', cliVersion);
  if (preview.minimal) {
    display.line('  Agent integration skipped; no setup files will be changed.');
    display.line(
      '  The installed CLI already provides planning utilities. Use `planr init` in your project.',
    );
    return;
  }
  display.keyValue(
    'Coding agents',
    preview.runtimes.map((runtime) => runtimeLabels[runtime]).join(', '),
  );
  display.keyValue(
    'Install in',
    preview.scope === 'both'
      ? 'Across projects and this project'
      : preview.scope === 'user'
        ? 'Across projects'
        : 'This project',
  );
  if (preview.skillModes.codex)
    display.keyValue('Codex integration', skillModeLabels[preview.skillModes.codex]);
  printRuntimeChanges(preview, false);
  display.blank();
  display.line('  File changes (skills, agents and supporting assets):');
  for (const scope of ['user', 'project'] as const) {
    const actions = preview.actions.filter(
      (action) => action.scope === scope && action.operation !== 'unchanged',
    );
    const creates = actions.filter((action) => action.operation === 'create').length;
    const updates = actions.filter((action) => action.operation === 'update').length;
    const retirements = actions.filter((action) => action.operation === 'retire').length;
    display.keyValue(
      `${scope === 'user' ? 'User' : 'Project'} scope`,
      `${creates} to add, ${updates} to update, ${retirements} to remove`,
    );
  }
  display.blank();
  printDestinations(preview);
  if (
    preview.runtimeScopes['claude-code'] === 'user' ||
    preview.runtimeScopes['claude-code'] === 'both'
  )
    display.bullet('Claude Code: register the bundled OpenPlanr plugin');
  if (preview.skillModes.codex === 'unified-plugin')
    display.bullet('Codex: register the bundled OpenPlanr plugin');
  display.bullet(`OpenPlanr installation records: ${runtimeRoot()}`);
  display.blank();
  display.line('  Existing files are backed up before replacement. Unmanaged files are preserved.');
  display.line(
    '  Setup installs agent integrations; it does not run a workflow or change application code.',
  );
  if (isVerbose()) {
    if (preview.pipelineVersion)
      display.keyValue('Bundled workflow assets', preview.pipelineVersion);
    for (const action of preview.actions)
      display.bullet(`${action.operation.padEnd(9)} ${action.target}`);
    for (const operation of preview.runtimeOperations) display.bullet(operation.description);
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
    .description('Set up OpenPlanr skills for your coding agents')
    .option('--runtime <runtime>', 'auto, claude, codex, cursor, or all')
    .option('--scope <scope>', 'user, project, or both')
    .option('--skill-mode <mode>', 'Codex skill delivery: direct, unified-plugin, or project-rule')
    .option(
      '--replace-managed',
      'replace only manifest-owned OpenPlanr discovery content when switching modes',
      false,
    )
    .option('--minimal', 'skip agent integrations; keep using the installed CLI', false)
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
        !opts.minimal &&
        !opts.yes &&
        !program.opts().yes &&
        !opts.json;
      const minimal = Boolean(opts.minimal);
      let scope = (opts.scope as InstallScope | undefined) ?? 'user';
      let runtimes: RuntimeId[] | undefined;
      let skillMode = opts.skillMode as SkillInstallMode | undefined;

      if (guided) {
        logger.heading('Welcome to OpenPlanr');
        printRuntimeDetection();
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

        const context = inspectProjectContext(projectDir);
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
          scopeChoices.push({ name: 'Across projects — on this computer', value: 'user' });
        }
        if (context.valid) {
          scopeChoices.push(
            { name: `Current project — ${context.path}`, value: 'project' },
            { name: `Across projects and this project — ${context.path}`, value: 'both' },
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
                name: 'OpenPlanr plugin — all skills in one plugin (recommended)',
                value: 'unified-plugin',
              },
              { name: 'Individual skills — available across projects', value: 'direct' },
            );
          }
          if (scope === 'project')
            choices.push({
              name: 'Project skills — available in this project only',
              value: 'project-rule',
            });
          skillMode =
            choices.length === 1
              ? choices[0].value
              : await promptSelect(
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
        if (opts.dryRun || minimal) {
          display.line(JSON.stringify(preview));
          return;
        }
      } else printPreview(preview, cliVersion);
      if (opts.dryRun || minimal) return;
      let replacementConfirmed = false;
      const replacesManagedContent =
        preview.actions.some(
          (action) =>
            action.runtime === 'codex' && action.scope === 'user' && action.operation === 'retire',
        ) || preview.runtimeOperations.some((operation) => operation.kind === 'remove');
      if (guided && replacesManagedContent && !options.replaceManaged) {
        replacementConfirmed = await promptConfirm(
          'Back up and replace the listed OpenPlanr-managed files and plugins, then apply setup?',
          true,
        );
        if (!replacementConfirmed) {
          logger.warn('Setup cancelled; existing integrations were preserved.');
          return;
        }
        options.replaceManaged = true;
      }
      if (!opts.yes && !program.opts().yes && isNonInteractive()) {
        throw new RuntimeManagerError(
          'E_CONFIRMATION_REQUIRED',
          'Setup cannot apply changes without confirmation in a non-interactive terminal.',
          'Review `planr setup --dry-run`, then rerun with explicit choices and `--yes`.',
        );
      }
      const confirmed =
        opts.yes ||
        program.opts().yes ||
        replacementConfirmed ||
        (await promptConfirm('Apply setup?', true));
      if (!confirmed) {
        if (opts.json) display.line(JSON.stringify({ ok: false, action: 'cancelled' }));
        else logger.warn('Setup cancelled; no files were changed.');
        return;
      }
      const result = await applySetup(options);
      if (opts.json) display.line(JSON.stringify(result));
      else {
        logger.success('Setup complete');
        printRuntimeChanges(result, true);
        if (result.backupDir) display.keyValue('Backup', result.backupDir);
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
        if (preview.projectContext.reason !== 'planr')
          display.line('  In your project, run: planr init');
        display.line('  Open your coding agent and ask OpenPlanr to plan your feature.');
      }
    });
}
