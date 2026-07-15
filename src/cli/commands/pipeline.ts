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
  'prepare-plan',
  'complete-plan',
  'prepare-ship',
  'finalize-ship',
  'design-engine',
];

export function registerPipelineCommand(program: Command) {
  program
    .command('pipeline <action> [args...]')
    .description('Route the complete PO, Design, DEV, and QA pipeline')
    .option('--runtime <runtime>', 'auto, claude, codex, or cursor')
    .option('--json', 'machine-readable output', false)
    .option('--no-launch', 'return a runtime handoff instead of launching')
    .option('--port <port>', 'dashboard port')
    .option('--no-watch', 'disable dashboard file watching')
    .allowUnknownOption(true)
    .action((action: string, passthrough: string[], opts) => {
      if (!ACTIONS.includes(action)) throw new Error(`Unknown pipeline action: ${action}`);
      const pipeline = resolvePipelinePackage();
      if (!pipeline) throw new Error('E_PIPELINE_NOT_INSTALLED');
      const args = [pipeline.binPath, action, ...passthrough];
      if (opts.runtime && opts.runtime !== 'auto' && !passthrough.includes('--runtime'))
        args.push('--runtime', opts.runtime);
      if (opts.json && !passthrough.includes('--json')) args.push('--json');
      if (opts.launch === false && !passthrough.includes('--no-launch')) args.push('--no-launch');
      if (opts.port && !passthrough.includes('--port')) args.push('--port', String(opts.port));
      if (opts.watch === false && !passthrough.includes('--no-watch')) args.push('--no-watch');
      const result = spawnSync(process.execPath, args, {
        cwd: program.opts().projectDir as string,
        stdio: 'inherit',
      });
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 1;
    });
}
