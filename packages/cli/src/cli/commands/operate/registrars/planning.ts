import { type Command, Option } from 'commander';
import { type OperateCommandOptions, readOperateFramingInput } from '../input.js';
import type { OperateCommandRegistrationDependencies } from './contracts.js';
import { dispatch } from './dispatch.js';

export function registerPlanningCommands(
  program: Command,
  operate: Command,
  dependencies: OperateCommandRegistrationDependencies,
): void {
  const planning = operate
    .command('planning')
    .description('Preview and explicitly promote planning-work Actions into SPECs');
  planning
    .command('preview')
    .argument('<actionId>')
    .requiredOption('--actor <actorId>', 'exact authorized human Action owner')
    .addOption(
      new Option('--framing-json <json>', 'exact closed Planning framing JSON').conflicts(
        'framingFile',
      ),
    )
    .addOption(
      new Option(
        '--framing-file <path>',
        'read exact Planning framing JSON from path or stdin (-)',
      ).conflicts('framingJson'),
    )
    .option('--json')
    .action(async (actionId: string, options: OperateCommandOptions) => {
      const framing = await readOperateFramingInput(options);
      return dispatch(
        program,
        {
          operation: 'operate.planning.preview',
          request: {
            actionId,
            actor: { actorId: options.actor ?? '', kind: 'human', runtime: 'openplanr' },
            ...(framing ? { framing } : {}),
          },
        },
        options,
        dependencies,
      );
    });
  planning
    .command('create-spec')
    .argument('<proposalId>')
    .requiredOption('--actor <actorId>', 'exact human actor bound by planning preview')
    .requiredOption('--confirm <digest>', 'exact digest printed by planning preview')
    .option('--json')
    .action(async (proposalId: string, options: OperateCommandOptions) =>
      dispatch(
        program,
        {
          operation: 'operate.planning.create-spec',
          request: {
            proposalId,
            confirmDigest: options.confirm ?? '',
            actor: { actorId: options.actor ?? '', kind: 'human', runtime: 'openplanr' },
          },
        },
        options,
        dependencies,
      ),
    );
}
