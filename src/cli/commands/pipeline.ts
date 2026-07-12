import { spawnSync } from 'node:child_process';
import type { Command } from 'commander';
import { resolvePipelinePackage } from '../../services/pipeline-package-service.js';

const ACTIONS = [
  'plan',
  'design',
  'design-loop',
  'design-review',
  'ship',
  'status',
  'dashboard',
  'sync',
  'doctor',
];

export function registerPipelineCommand(program: Command) {
  program
    .command('pipeline <action> [feature]')
    .description('Route the complete PO, Design, DEV, and QA pipeline')
    .option('--runtime <runtime>', 'auto, claude, codex, or cursor')
    .option('--json', 'machine-readable output', false)
    .option('--no-launch', 'return a runtime handoff instead of launching')
    .option('--port <port>', 'dashboard port')
    .option('--no-watch', 'disable dashboard file watching')
    .action((action: string, feature: string | undefined, opts) => {
      if (!ACTIONS.includes(action)) throw new Error(`Unknown pipeline action: ${action}`);
      const pipeline = resolvePipelinePackage();
      if (!pipeline) throw new Error('E_PIPELINE_NOT_INSTALLED');
      const args = [pipeline.binPath, action];
      if (feature) args.push(feature);
      if (opts.runtime && opts.runtime !== 'auto') args.push('--runtime', opts.runtime);
      if (opts.json) args.push('--json');
      if (opts.launch === false) args.push('--no-launch');
      if (opts.port) args.push('--port', String(opts.port));
      if (opts.watch === false) args.push('--no-watch');
      const result = spawnSync(process.execPath, args, {
        cwd: program.opts().projectDir as string,
        stdio: 'inherit',
      });
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 1;
    });
}
