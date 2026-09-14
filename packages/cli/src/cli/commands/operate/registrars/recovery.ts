import type { Command } from 'commander';
import {
  migrateProjectOperateStorage,
  readOperateStorageStatus,
  rollbackProjectOperateStorage,
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
          display.line('The bundled offline compatibility verifier will run before migration.');
        }
        display.line(`Next action: ${status.nextAction}`);
      }
    });
  recovery
    .command('migrate-storage')
    .description(
      'Replay-verify legacy v2 storage and activate its exact state with rollback custody',
    )
    .option('--json')
    .action(async (options: OperateCommandOptions) => {
      const projectDir = program.opts().projectDir as string;
      const receipt = await migrateProjectOperateStorage(projectDir);
      if (options.json) display.line(JSON.stringify(receipt));
      else {
        display.line(
          receipt.migrated
            ? `Activated verified legacy state; retained ${receipt.archives.length} rollback archive(s).`
            : 'Operate storage already uses the neutral layout.',
        );
      }
    });
  recovery
    .command('rollback-storage')
    .description('Restore the verified pre-migration v2 Store and preserve forward state')
    .option('--json')
    .action(async (options: OperateCommandOptions) => {
      const receipt = await rollbackProjectOperateStorage(program.opts().projectDir as string);
      if (options.json) display.line(JSON.stringify(receipt));
      else
        display.line(`Restored ${receipt.restoredSource}; preserved ${receipt.forwardSnapshotId}.`);
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
