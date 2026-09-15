import type { Command } from 'commander';
import { display } from '../../../../utils/logger.js';
import type { OperateCommandOptions } from '../input.js';
import type { OperateCommandRegistrationDependencies } from './contracts.js';

export function registerDashboardCommand(
  program: Command,
  operate: Command,
  dependencies: OperateCommandRegistrationDependencies,
): void {
  operate
    .command('dashboard')
    .argument('<cycleId>')
    .requiredOption('--actor <actorId>', 'authorized human actor')
    .option('--port <port>', 'loopback port', '7473')
    .option('--no-watch', 'disable project-local live updates')
    .action(async (cycleId: string, options: OperateCommandOptions) => {
      const port = Number(options.port);
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw Object.assign(new Error('The Operate dashboard port is invalid.'), {
          code: 'E_OPERATE_DASHBOARD_PORT_INVALID',
        });
      }
      const started = await dependencies.startDashboard({
        projectDir: program.opts().projectDir as string,
        cycleId,
        actorId: options.actor ?? '',
        port,
        watch: options.watch,
      });
      display.line(`DASHBOARD_URL: ${started.url}`);
    });
}
