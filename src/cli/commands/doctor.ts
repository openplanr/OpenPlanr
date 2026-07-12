import type { Command } from 'commander';
import { promptConfirm } from '../../services/prompt-service.js';
import { applySetup, runtimeDoctor } from '../../services/runtime-manager-service.js';
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
        const preview = await applySetup({
          projectDir,
          cliVersion,
          runtime: 'auto',
          scope: 'both',
          dryRun: true,
        });
        if (!opts.json) {
          logger.heading('Repair preview');
          for (const action of preview.actions.filter((item) => item.operation !== 'unchanged')) {
            display.bullet(`${action.operation} ${action.target}`);
          }
        }
        const confirmed =
          opts.yes ||
          program.opts().yes ||
          (await promptConfirm('Apply owned-file repairs?', true));
        if (confirmed) {
          await applySetup({ projectDir, cliVersion, runtime: 'auto', scope: 'both' });
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
