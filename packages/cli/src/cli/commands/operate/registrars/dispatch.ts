import type { Command } from 'commander';
import type { OperateDispatchRequestV2 } from '../../../../services/operate/client.js';
import type { OperateCommandOptions } from '../input.js';
import { renderOperateEnvelope } from '../render.js';
import type { OperateCommandRegistrationDependencies } from './contracts.js';

export async function dispatch(
  program: Command,
  input: OperateDispatchRequestV2,
  options: OperateCommandOptions,
  dependencies: OperateCommandRegistrationDependencies,
): Promise<void> {
  const client = await dependencies.createClient(program.opts().projectDir as string);
  const envelope = await client.dispatch(input);
  renderOperateEnvelope(envelope, options.json);
  if (!envelope.ok) process.exitCode = 1;
}

export async function dispatchExactReviewChoice(
  program: Command,
  reviewId: string,
  options: OperateCommandOptions,
  dependencies: OperateCommandRegistrationDependencies,
): Promise<void> {
  const client = await dependencies.createClient(program.opts().projectDir as string);
  const read = await client.dispatch({
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
  });
  if (!read.ok) {
    renderOperateEnvelope(read, options.json);
    process.exitCode = 1;
    return;
  }
  const choices = (read.data as { dispositionChoices?: unknown }).dispositionChoices;
  const exact = Array.isArray(choices)
    ? choices.filter((candidate) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
        const choice = candidate as Record<string, unknown>;
        return choice.choiceId === options.choice && choice.choiceHash === options.choiceHash;
      })
    : [];
  if (exact.length !== 1) {
    throw Object.assign(
      new Error('The selected Review choice is not present in the latest exact owner read.'),
      { code: 'E_OPERATE_REVIEW_CHOICE_STALE' },
    );
  }
  const submitArguments = (exact[0] as Record<string, unknown>).submitArguments;
  if (!submitArguments || typeof submitArguments !== 'object' || Array.isArray(submitArguments)) {
    throw Object.assign(new Error('The advertised Review choice has no exact submission bytes.'), {
      code: 'E_OPERATE_REVIEW_CHOICE_INVALID',
    });
  }
  const submitted = await client.dispatch({
    operation: 'operate.review.submit',
    request: structuredClone(submitArguments) as never,
  });
  renderOperateEnvelope(submitted, options.json);
  if (!submitted.ok) process.exitCode = 1;
}
