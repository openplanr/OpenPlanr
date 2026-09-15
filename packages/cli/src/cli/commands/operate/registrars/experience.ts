import type { Command } from 'commander';
import type { OperateCommandOptions } from '../input.js';
import type { OperateCommandRegistrationDependencies } from './contracts.js';
import { dispatch } from './dispatch.js';

export function registerExperienceCommands(
  program: Command,
  operate: Command,
  dependencies: OperateCommandRegistrationDependencies,
): void {
  operate
    .command('experience')
    .argument('<cycleId>')
    .requiredOption('--actor <actorId>')
    .option('--json')
    .action(async (cycleId: string, options: OperateCommandOptions) =>
      dispatch(
        program,
        {
          operation: 'operate.experience.get',
          request: {
            cycleId,
            actor: { actorId: options.actor ?? '', kind: 'human', runtime: 'openplanr' },
          },
        },
        options,
        dependencies,
      ),
    );
  const surfaceCommand = (name: 'today' | 'cycles' | 'evidence' | 'outcomes' | 'history') => {
    operate
      .command(name)
      .argument('<cycleId>')
      .requiredOption('--actor <actorId>')
      .option('--json')
      .action(async (cycleId: string, options: OperateCommandOptions) =>
        dispatch(
          program,
          {
            operation: 'operate.experience.get',
            request: {
              cycleId,
              actor: { actorId: options.actor ?? '', kind: 'human', runtime: 'openplanr' },
              surface: name,
            },
          },
          options,
          dependencies,
        ),
      );
  };
  for (const name of ['today', 'cycles', 'evidence', 'outcomes', 'history'] as const) {
    surfaceCommand(name);
  }
  operate
    .command('cycle')
    .argument('<cycleId>')
    .requiredOption('--actor <actorId>')
    .option('--json')
    .action(async (cycleId: string, options: OperateCommandOptions) =>
      dispatch(
        program,
        {
          operation: 'operate.experience.get',
          request: {
            cycleId,
            actor: { actorId: options.actor ?? '', kind: 'human', runtime: 'openplanr' },
            surface: 'cycle',
            subjectId: cycleId,
          },
        },
        options,
        dependencies,
      ),
    );
  operate
    .command('outcome')
    .argument('<cycleId>')
    .argument('<outcomeId>')
    .requiredOption('--actor <actorId>')
    .option('--json')
    .action(async (cycleId: string, outcomeId: string, options: OperateCommandOptions) =>
      dispatch(
        program,
        {
          operation: 'operate.experience.get',
          request: {
            cycleId,
            actor: { actorId: options.actor ?? '', kind: 'human', runtime: 'openplanr' },
            surface: 'outcome',
            subjectId: outcomeId,
          },
        },
        options,
        dependencies,
      ),
    );
  operate
    .command('search')
    .argument('<cycleId>')
    .argument('<query>')
    .requiredOption('--actor <actorId>')
    .option('--json')
    .action(async (cycleId: string, query: string, options: OperateCommandOptions) =>
      dispatch(
        program,
        {
          operation: 'operate.experience.get',
          request: {
            cycleId,
            actor: { actorId: options.actor ?? '', kind: 'human', runtime: 'openplanr' },
            surface: 'search',
            query,
          },
        },
        options,
        dependencies,
      ),
    );
  operate
    .command('export')
    .argument('<cycleId>')
    .requiredOption('--actor <actorId>')
    .option('--format <format>', 'json or html', 'json')
    .option('--json')
    .action(async (cycleId: string, options: OperateCommandOptions) =>
      dispatch(
        program,
        {
          operation: 'operate.experience.get',
          request: {
            cycleId,
            actor: { actorId: options.actor ?? '', kind: 'human', runtime: 'openplanr' },
            surface: 'export',
            format: options.format ?? 'json',
          },
        },
        options,
        dependencies,
      ),
    );
}
