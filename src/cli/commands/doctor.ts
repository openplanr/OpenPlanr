import type { Command } from 'commander';
import { isNonInteractive } from '../../services/interactive-state.js';
import { promptConfirm } from '../../services/prompt-service.js';
import {
  applySetup,
  cleanupHomeProjectInstall,
  isOpenPlanrHome,
  managedRuntimesForProject,
  previewAbandonedOperateScratch,
  previewHomeProjectCleanup,
  purgeAbandonedOperateScratch,
  runtimeDoctor,
} from '../../services/runtime-manager-service.js';
import { display, logger } from '../../utils/logger.js';

export function registerDoctorCommand(program: Command, cliVersion: string) {
  program
    .command('doctor')
    .description('Diagnose OpenPlanr, pipeline, runtime adapter, and project health')
    .option('--strict', 'treat warnings as failures', false)
    .option('--fix', 'preview and repair owned generated files and stale daemon state', false)
    .option('--json', 'machine-readable output', false)
    .option(
      '--yes',
      'apply previewed owned-file and stale-daemon repairs without confirmation',
      false,
    )
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      let result = await runtimeDoctor(
        projectDir,
        opts.fix ? { pipelineRepair: 'preview' } : undefined,
      );
      if (opts.fix) {
        const homeCleanup = await previewHomeProjectCleanup();
        // FR7: the owned-only abandoned-scratch cleanup is now reachable through
        // the FR7-named `doctor --fix` surface, delegating to the single cleanup
        // path in maintenance.ts. It only ever lists scratch a valid ownership
        // manifest confirms this project wrote.
        const abandonedScratch = await previewAbandonedOperateScratch(projectDir);
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
              manageExternalRuntimes: false,
              dryRun: true,
            })
          : null;
        if (!opts.json) {
          logger.heading('Repair preview');
          for (const target of homeCleanup) display.bullet(`remove ${target}`);
          for (const entry of abandonedScratch)
            display.bullet(
              `remove abandoned OpenPlanr-owned operate scratch for cycle ${entry.cycleId}`,
            );
          for (const repair of result.repairs)
            display.bullet(`${repair.operation} ${repair.target}`);
          for (const action of (preview?.actions ?? []).filter(
            (item) => item.operation !== 'unchanged',
          )) {
            display.bullet(`${action.operation} ${action.target}`);
          }
        }
        const hasRepairs =
          homeCleanup.length > 0 ||
          abandonedScratch.length > 0 ||
          result.repairs.length > 0 ||
          (preview?.actions ?? []).some((item) => item.operation !== 'unchanged');
        if (!hasRepairs) {
          if (!opts.json) logger.success('No owned-file repairs are needed.');
        }
        const confirmed =
          hasRepairs &&
          (opts.yes ||
            program.opts().yes ||
            (!isNonInteractive() &&
              (await promptConfirm('Apply owned-file and stale-daemon repairs?', true))));
        if (hasRepairs && !confirmed && isNonInteractive() && !opts.json) {
          logger.warn('Repairs were not applied; rerun with --yes after reviewing the preview.');
        }
        if (confirmed) {
          if (result.repairs.length) {
            await runtimeDoctor(projectDir, { pipelineRepair: 'apply' });
          }
          if (abandonedScratch.length) await purgeAbandonedOperateScratch(projectDir);
          if (homeCleanup.length) await cleanupHomeProjectInstall();
          if (managedRuntimes.length) {
            await applySetup({
              projectDir,
              cliVersion,
              runtimes: managedRuntimes,
              scope: 'user',
              preserveExistingScopes: true,
              manageExternalRuntimes: false,
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
