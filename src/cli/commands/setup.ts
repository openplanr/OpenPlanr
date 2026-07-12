import type { Command } from 'commander';
import { promptConfirm } from '../../services/prompt-service.js';
import {
  applySetup,
  type InstallScope,
  previewSetup,
  type RuntimeChoice,
} from '../../services/runtime-manager-service.js';
import { display, logger } from '../../utils/logger.js';

export function registerSetupCommand(program: Command, cliVersion: string) {
  program
    .command('setup')
    .description('Detect runtimes and install or migrate OpenPlanr runtime adapters')
    .option('--runtime <runtime>', 'auto, claude, codex, cursor, or all', 'auto')
    .option('--scope <scope>', 'user, project, or both', 'both')
    .option('--minimal', 'planning-only setup; do not install the pipeline', false)
    .option('--version <version>', 'pin the pipeline and adapter version')
    .option('--dry-run', 'preview exact changes without writing', false)
    .option('--yes', 'apply without an interactive confirmation', false)
    .option('--json', 'emit machine-readable output', false)
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const options = {
        projectDir,
        cliVersion,
        runtime: opts.runtime as RuntimeChoice,
        scope: opts.scope as InstallScope,
        minimal: Boolean(opts.minimal),
        version: opts.version as string | undefined,
        dryRun: Boolean(opts.dryRun),
      };
      const preview = await previewSetup(options);
      if (opts.json) {
        if (opts.dryRun) {
          display.line(JSON.stringify(preview));
          return;
        }
      } else {
        logger.heading('OpenPlanr setup preview');
        display.keyValue('Runtimes', preview.runtimes.join(', ') || 'planning only');
        display.keyValue('Scope', preview.scope);
        display.keyValue('Pipeline', preview.pipelineVersion ?? 'omitted');
        for (const action of preview.actions) {
          display.bullet(`${action.operation.padEnd(9)} ${action.target}`);
        }
      }
      if (opts.dryRun) return;
      const confirmed =
        opts.yes || program.opts().yes || (await promptConfirm('Apply these changes?', true));
      if (!confirmed) {
        if (opts.json) display.line(JSON.stringify({ ok: false, action: 'cancelled' }));
        else logger.warn('Setup cancelled; no files were changed.');
        return;
      }
      const result = await applySetup(options);
      if (opts.json) display.line(JSON.stringify(result));
      else
        logger.success(`Setup complete${result.backupDir ? `; backup: ${result.backupDir}` : ''}.`);
    });
}
