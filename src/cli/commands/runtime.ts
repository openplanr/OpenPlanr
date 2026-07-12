import type { Command } from 'commander';
import { promptConfirm } from '../../services/prompt-service.js';
import {
  applySetup,
  detectRuntimes,
  type InstallScope,
  listRuntimeAdapters,
  type RuntimeId,
  removeRuntime,
  rollbackRuntime,
  runtimeDoctor,
} from '../../services/runtime-manager-service.js';
import { display } from '../../utils/logger.js';

function print(value: unknown, json: boolean) {
  if (json) display.line(JSON.stringify(value));
  else display.line(JSON.stringify(value, null, 2));
}

export function registerRuntimeCommand(program: Command, cliVersion: string) {
  const runtime = program.command('runtime').description('Manage runtime adapters');

  runtime
    .command('detect')
    .option('--json', 'machine-readable output', false)
    .action((opts) => print({ ok: true, runtimes: detectRuntimes() }, opts.json));

  runtime
    .command('list')
    .option('--json', 'machine-readable output', false)
    .action((opts) =>
      print({ ok: true, adapters: listRuntimeAdapters(), detected: detectRuntimes() }, opts.json),
    );

  for (const operation of ['install', 'update'] as const) {
    runtime
      .command(`${operation} <runtime>`)
      .option('--scope <scope>', 'user, project, or both', 'both')
      .option('--version <version>', 'adapter version')
      .option('--dry-run', 'preview without writing', false)
      .option('--yes', 'apply without confirmation', false)
      .option('--json', 'machine-readable output', false)
      .action(async (runtimeId, opts) => {
        const projectDir = program.opts().projectDir as string;
        const options = {
          projectDir,
          cliVersion,
          runtime: runtimeId as RuntimeId,
          scope: opts.scope as InstallScope,
          version: opts.version as string | undefined,
          dryRun: Boolean(opts.dryRun),
          merge: true,
        };
        if (!opts.dryRun && !opts.yes && !program.opts().yes) {
          const ok = await promptConfirm(`${operation} the ${runtimeId} adapter?`, true);
          if (!ok) return;
        }
        print(await applySetup(options), opts.json);
      });
  }

  runtime
    .command('remove <runtime>')
    .option('--yes', 'remove without confirmation', false)
    .option('--json', 'machine-readable output', false)
    .action(async (runtimeId, opts) => {
      if (!opts.yes && !program.opts().yes) {
        const ok = await promptConfirm(`Remove OpenPlanr-owned ${runtimeId} adapter files?`, false);
        if (!ok) return;
      }
      print(
        await removeRuntime(runtimeId as RuntimeId, program.opts().projectDir as string),
        opts.json,
      );
    });

  runtime
    .command('rollback')
    .option('--backup <path>', 'specific backup directory')
    .option('--yes', 'restore without confirmation', false)
    .option('--json', 'machine-readable output', false)
    .action(async (opts) => {
      if (!opts.yes && !program.opts().yes) {
        const ok = await promptConfirm('Restore the exact pre-setup bytes from backup?', false);
        if (!ok) return;
      }
      print(await rollbackRuntime(program.opts().projectDir as string, opts.backup), opts.json);
    });

  runtime
    .command('doctor')
    .option('--json', 'machine-readable output', false)
    .action(async (opts) => {
      const result = await runtimeDoctor(program.opts().projectDir as string);
      print(result, opts.json);
      if (!result.ok) process.exitCode = 1;
    });
}
