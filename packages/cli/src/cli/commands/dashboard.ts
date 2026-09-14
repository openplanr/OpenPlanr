import { spawnSync } from 'node:child_process';
import type { Command } from 'commander';
import { resolvePipelinePackage } from '../../services/pipeline-package-service.js';
import { CliBoundaryError } from '../error-boundary.js';

export function registerDashboardCommand(program: Command): void {
  program
    .command('dashboard')
    .description('Serve the local Planning and Operate dashboard')
    .option('--port <port>', 'loopback port', '7474')
    .option('--no-watch', 'disable project file watching')
    .option('--json', 'machine-readable output')
    .action((options: { port: string; watch?: boolean; json?: boolean }) => {
      const pipeline = resolvePipelinePackage();
      if (!pipeline) {
        throw new CliBoundaryError(
          'E_DASHBOARD_RUNTIME_MISSING',
          'The optional dashboard runtime is not installed.',
          {
            recovery:
              'Install OpenPlanr with optional dependencies or use the packaged dashboard helper.',
          },
        );
      }
      const port = Number(options.port);
      if (!Number.isInteger(port) || port < 0 || port > 65_535)
        throw new Error('Dashboard port must be between 0 and 65535.');
      const args = [pipeline.binPath, 'dashboard', '--port', String(port)];
      if (options.watch === false) args.push('--no-watch');
      if (options.json) args.push('--json');
      const result = spawnSync(process.execPath, args, {
        cwd: program.opts().projectDir as string,
        encoding: 'utf8',
        stdio: 'inherit',
      });
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 1;
    });
}
