import { type Command, Option } from 'commander';
import type { OperateCommandOptions } from '../input.js';
import type { OperateCommandRegistrationDependencies } from './contracts.js';
import { dispatch } from './dispatch.js';

export function registerLifecycleCommands(
  program: Command,
  operate: Command,
  dependencies: OperateCommandRegistrationDependencies,
): void {
  operate
    .command('start')
    .requiredOption('--scope <scopeId>')
    .requiredOption('--domain <domainId>')
    .requiredOption('--domain-version <version>')
    .option('--focus <focus>', 'comma-separated focus values', '')
    .requiredOption('--owner <actorId>', 'exact human review and Decision owner')
    .addOption(
      new Option(
        '--route <route>',
        'contained-execution, planning-work, human-external, or observe-only',
      )
        .choices(['contained-execution', 'planning-work', 'human-external', 'observe-only'])
        .default('observe-only'),
    )
    .option('--json')
    .action(async (options: OperateCommandOptions) =>
      dispatch(
        program,
        {
          operation: 'operate.cycle.start',
          request: {
            scope: {
              scopeId: options.scope ?? '',
              domainId: options.domain ?? '',
              domainVersion: options.domainVersion ?? '',
            },
            focus: options.focus
              ? options.focus
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean)
              : [],
            trigger: { kind: 'manual' },
            mode: 'standard',
            ownerActorId: options.owner ?? '',
            deliveryRoute: options.route,
          },
        },
        options,
        dependencies,
      ),
    );
  for (const [name, operation] of [
    ['get', 'operate.cycle.get'],
    ['resume', 'operate.cycle.resume'],
  ] as const) {
    operate
      .command(name)
      .argument('<cycleId>')
      .option('--json')
      .action(async (cycleId: string, options: OperateCommandOptions) =>
        dispatch(program, { operation, request: { cycleId } }, options, dependencies),
      );
  }
}
