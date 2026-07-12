import type { Command } from 'commander';
import { isNonInteractive } from '../../services/interactive-state.js';
import { promptConfirm } from '../../services/prompt-service.js';
import {
  applySetup,
  cleanupHomeProjectInstall,
  isOpenPlanrHome,
  managedRuntimesForProject,
  previewHomeProjectCleanup,
  runtimeDoctor,
} from '../../services/runtime-manager-service.js';
import { display, logger } from '../../utils/logger.js';

export function registerDoctorCommand(program: Command, cliVersion: string) {
  program
    .command('doctor')
    .description('Diagnose OpenPlanr, pipeline, runtime adapter, and project health')
    .option('--strict', 'treat warnings as failures', false)
    .option('--fix', 'preview and repair owned generated files', false)
    .option('--json', 'machine-readable output', false)
    .option('--yes', 'apply owned-file repairs without confirmation', false)
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      let result = await runtimeDoctor(projectDir);
      if (opts.fix) {
        const homeCleanup = await previewHomeProjectCleanup();
        const managedRuntimes = isOpenPlanrHome(projectDir)
          ? []
          : await managedRuntimesForProject(projectDir);
        const preview = managedRuntimes.length
          ? await applySetup({
              projectDir,
              cliVersion,
              runtimes: managedRuntimes,
              scope: 'user',
              preserveExistingScopes: true,
              dryRun: true,
            })
          : null;
        if (!opts.json) {
          logger.heading('Repair preview');
          for (const target of homeCleanup) display.bullet(`remove ${target}`);
          for (const action of (preview?.actions ?? []).filter(
            (item) => item.operation !== 'unchanged',
          )) {
            display.bullet(`${action.operation} ${action.target}`);
          }
        }
        const hasRepairs =
          homeCleanup.length > 0 ||
          (preview?.actions ?? []).some((item) => item.operation !== 'unchanged');
        if (!hasRepairs) {
          if (!opts.json) logger.success('No owned-file repairs are needed.');
        }
        const confirmed =
          hasRepairs &&
          (opts.yes ||
            program.opts().yes ||
            (!isNonInteractive() && (await promptConfirm('Apply owned-file repairs?', true))));
        if (hasRepairs && !confirmed && isNonInteractive() && !opts.json) {
          logger.warn('Repairs were not applied; rerun with --yes after reviewing the preview.');
        }
        if (confirmed) {
          if (homeCleanup.length) await cleanupHomeProjectInstall();
          if (managedRuntimes.length) {
            await applySetup({
              projectDir,
              cliVersion,
              runtimes: managedRuntimes,
              scope: 'user',
              preserveExistingScopes: true,
            });
          }
          result = await runtimeDoctor(projectDir);
        }
      }
      if (opts.json) display.line(JSON.stringify(result));
      else {
        logger.heading('OpenPlanr doctor');
        for (const diagnostic of result.diagnostics) {
          const label =
            diagnostic.status === 'pass' ? 'PASS' : diagnostic.status === 'warn' ? 'WARN' : 'FAIL';
          display.line(`  ${label.padEnd(4)} ${diagnostic.code}: ${diagnostic.message}`);
          if (diagnostic.fix) display.line(`       Fix: ${diagnostic.fix}`);
        }
      }
      if (!result.ok || (opts.strict && result.diagnostics.some((item) => item.status === 'warn')))
        process.exitCode = 1;
    });
}
