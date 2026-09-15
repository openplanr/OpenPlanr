import { type Command, Option } from 'commander';
import type { OperateCommandOptions } from '../input.js';
import type { OperateCommandRegistrationDependencies } from './contracts.js';
import { dispatch, dispatchExactReviewChoice } from './dispatch.js';

export function registerArtifactAndReviewCommands(
  program: Command,
  operate: Command,
  dependencies: OperateCommandRegistrationDependencies,
): void {
  operate
    .command('artifact')
    .argument('<artifactId>')
    .requiredOption('--actor <actorId>')
    .requiredOption('--actor-kind <kind>', 'agent or human')
    .requiredOption('--runtime <runtime>', 'exact actor runtime')
    .requiredOption('--scope <scopeId>')
    .requiredOption('--domain <domainId>')
    .requiredOption('--domain-version <version>')
    .option('--assignment <assignmentId>', 'issued Assignment (required for agents)')
    .addOption(
      new Option('--representation <representation>', 'raw, canonical, metadata, or decoded-json')
        .choices(['raw', 'canonical', 'metadata', 'decoded-json'])
        .default('metadata'),
    )
    .option('--json')
    .action(async (artifactId: string, options: OperateCommandOptions) => {
      if (!['agent', 'human'].includes(options.actorKind ?? '')) {
        throw Object.assign(new Error('Artifact actor kind must be agent or human.'), {
          code: 'E_OPERATE_ACTOR_KIND_INVALID',
        });
      }
      if (options.actorKind === 'agent' && !options.assignment) {
        throw Object.assign(new Error('Agent Artifact reads require --assignment.'), {
          code: 'E_OPERATE_ASSIGNMENT_REQUIRED',
        });
      }
      return dispatch(
        program,
        {
          operation: 'operate.artifact.get',
          request: {
            artifactId,
            representation: options.representation ?? 'metadata',
            actor: {
              actorId: options.actor ?? '',
              kind: options.actorKind as 'agent' | 'human',
              runtime: options.runtime ?? '',
            },
            scope: {
              scopeId: options.scope ?? '',
              domainId: options.domain ?? '',
              domainVersion: options.domainVersion ?? '',
            },
            assignmentId: options.assignment ?? null,
          },
        },
        options,
        dependencies,
      );
    });
  operate
    .command('review')
    .argument('<reviewId>')
    .requiredOption('--actor <actorId>')
    .requiredOption('--cycle <cycleId>')
    .requiredOption('--scope <scopeId>')
    .requiredOption('--domain <domainId>')
    .requiredOption('--domain-version <version>')
    .option('--json')
    .action(async (reviewId: string, options: OperateCommandOptions) =>
      dispatch(
        program,
        {
          operation: 'operate.review.get',
          request: {
            reviewId,
            cycleId: options.cycle ?? '',
            actor: { actorId: options.actor ?? '', kind: 'human', runtime: 'openplanr' },
            scope: {
              scopeId: options.scope ?? '',
              domainId: options.domain ?? '',
              domainVersion: options.domainVersion ?? '',
            },
          },
        },
        options,
        dependencies,
      ),
    );
  operate
    .command('decide')
    .argument('<reviewId>')
    .requiredOption('--actor <actorId>')
    .requiredOption('--cycle <cycleId>')
    .requiredOption('--scope <scopeId>')
    .requiredOption('--domain <domainId>')
    .requiredOption('--domain-version <version>')
    .requiredOption('--choice <choiceId>', 'exact choice identity from the latest Review read')
    .requiredOption('--choice-hash <digest>', 'exact choice digest from the latest Review read')
    .option('--json')
    .action(async (reviewId: string, options: OperateCommandOptions) =>
      dispatchExactReviewChoice(program, reviewId, options, dependencies),
    );
}
