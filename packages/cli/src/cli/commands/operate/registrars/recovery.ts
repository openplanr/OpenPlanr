import type { Command } from 'commander';
import {
  migrateProjectOperateStorage,
  readOperateStorageStatus,
} from '../../../../services/operate/storage-migration-service.js';
import { display } from '../../../../utils/logger.js';
import type { OperateCommandOptions } from '../input.js';
import type { OperateCommandRegistrationDependencies } from './contracts.js';
import { dispatch } from './dispatch.js';

export function registerRecoveryCommands(
  program: Command,
  operate: Command,
  dependencies: OperateCommandRegistrationDependencies,
): void {
  const recovery = operate.command('recovery').description('Inspect or restore durable state');
  recovery
    .command('storage-status')
    .description('Inspect neutral or legacy Operate storage without activating it')
    .option('--json')
    .action(async (options: OperateCommandOptions) => {
      const status = await readOperateStorageStatus(program.opts().projectDir as string);
      if (options.json) display.line(JSON.stringify(status));
      else {
        display.line(`Operate storage: ${status.status}`);
        if (status.legacySources.length > 0) {
          display.line(`Legacy sources: ${status.legacySources.join(', ')}`);
        }
        if (status.pinnedVerifierRequired) {
          display.line('The pinned pre-change replay verifier will run before migration.');
        }
        display.line(`Next action: ${status.nextAction}`);
      }
    });
  recovery
    .command('migrate-storage')
    .description(
      'Run the pinned pre-change verifier, archive legacy storage, and start clean state',
    )
    .option('--json')
    .action(async (options: OperateCommandOptions) => {
      const projectDir = program.opts().projectDir as string;
      const receipt = await migrateProjectOperateStorage(projectDir);
      if (options.json) display.line(JSON.stringify(receipt));
      else {
        display.line(
          receipt.migrated
            ? `Archived ${receipt.archives.length} legacy Operate store(s).`
            : 'Operate storage already uses the neutral layout.',
        );
      }
    });
  recovery
    .command('inspect')
    .option('--json')
    .action(async (options: OperateCommandOptions) =>
      dispatch(
        program,
        { operation: 'operate.recovery.inspect', request: {} },
        options,
        dependencies,
      ),
    );
  recovery
    .command('restore')
    .argument('<generation>')
    .option('--json')
    .action(async (generation: string, options: OperateCommandOptions) =>
      dispatch(
        program,
        { operation: 'operate.recovery.restore', request: { generation } },
        options,
        dependencies,
      ),
    );
  recovery
    .command('clear-stale-lock')
    .option('--json')
    .action(async (options: OperateCommandOptions) =>
      dispatch(
        program,
        { operation: 'operate.recovery.clear-stale-lock', request: {} },
        options,
        dependencies,
      ),
    );
}
