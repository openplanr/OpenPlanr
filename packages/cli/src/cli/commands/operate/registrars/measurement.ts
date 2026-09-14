import type { Command } from 'commander';
import type { OperateMeasurementResultV1 } from '../../../../services/operate/client.js';
import type { MeasurementSchedule } from '../../../../services/operate/measurement-schedule-service.js';
import { display } from '../../../../utils/logger.js';
import { type OperateCommandOptions, readOperateContentInput } from '../input.js';
import type { OperateCommandRegistrationDependencies } from './contracts.js';

const MAX_MEASUREMENT_REQUEST_BYTES = 256 * 1024;

async function measurementRequest(
  source: string,
  expectedKeys?: readonly string[],
): Promise<Record<string, unknown>> {
  const bytes = await readOperateContentInput(source);
  if (bytes.byteLength > MAX_MEASUREMENT_REQUEST_BYTES) {
    throw Object.assign(new Error('Measurement request exceeds its bounded input size.'), {
      code: 'E_MEASUREMENT_SCHEDULE_INVALID',
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (cause) {
    throw Object.assign(new Error('Measurement request must be valid UTF-8 JSON.'), {
      code: 'E_MEASUREMENT_SCHEDULE_INVALID',
      cause,
    });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Measurement request must be one closed object.'), {
      code: 'E_MEASUREMENT_SCHEDULE_INVALID',
    });
  }
  const request = value as Record<string, unknown>;
  if (
    expectedKeys &&
    JSON.stringify(Object.keys(request).sort()) !== JSON.stringify([...expectedKeys].sort())
  ) {
    throw Object.assign(new Error('Measurement request contains unsupported fields.'), {
      code: 'E_MEASUREMENT_SCHEDULE_INVALID',
    });
  }
  return request;
}

function renderMeasurementResult(result: OperateMeasurementResultV1, json = false): void {
  if (json) display.line(JSON.stringify(result));
  else {
    if (!result.ok) {
      display.line(
        `${result.error?.code ?? 'E_MEASUREMENT_SCHEDULE_FAILED'}: ${result.error?.problem ?? 'Measurement command failed.'}`,
      );
    }
    display.line(result.nextAction);
    if (result.data?.confirmationDigest) {
      display.line(`Confirm digest: ${String(result.data.confirmationDigest)}`);
    }
  }
  if (!result.ok) process.exitCode = 1;
}

export function registerMeasurementCommands(
  program: Command,
  operate: Command,
  dependencies: OperateCommandRegistrationDependencies,
): void {
  const measurement = operate
    .command('measurement')
    .description('Preview and manage disabled-by-default measurement schedules');
  const actor = (actorId: string) => ({
    actorId,
    kind: 'human' as const,
    runtime: 'openplanr',
  });
  const client = async () => dependencies.createClient(program.opts().projectDir as string);

  measurement
    .command('preview')
    .requiredOption('--request-file <path|->', 'exact disabled schedule JSON')
    .requiredOption('--actor <actorId>', 'exact schedule owner')
    .option('--json')
    .action(async (options: OperateCommandOptions & { requestFile?: string }) => {
      const schedule = await measurementRequest(options.requestFile ?? '');
      renderMeasurementResult(
        await (await client()).measurement({
          operation: 'measurement.preview',
          schedule: schedule as MeasurementSchedule,
          actor: actor(options.actor ?? ''),
        }),
        options.json,
      );
    });

  measurement
    .command('enable')
    .requiredOption('--request-file <path|->', 'closed JSON with schedule and transition')
    .requiredOption('--actor <actorId>', 'exact schedule owner')
    .requiredOption('--confirm <digest>', 'exact digest returned by preview')
    .option('--json')
    .action(async (options: OperateCommandOptions & { requestFile?: string }) => {
      const request = await measurementRequest(options.requestFile ?? '', [
        'schedule',
        'transition',
      ]);
      renderMeasurementResult(
        await (await client()).measurement({
          operation: 'measurement.enable',
          schedule: request.schedule as MeasurementSchedule,
          transition: request.transition as Record<string, unknown>,
          confirmDigest: options.confirm ?? '',
          actor: actor(options.actor ?? ''),
        }),
        options.json,
      );
    });

  measurement
    .command('disable')
    .argument('<scheduleId>')
    .requiredOption('--request-file <path|->', 'exact disable transition JSON')
    .requiredOption('--actor <actorId>', 'exact schedule owner')
    .requiredOption('--confirm <digest>', 'current exact schedule digest')
    .option('--json')
    .action(
      async (scheduleId: string, options: OperateCommandOptions & { requestFile?: string }) => {
        const transition = await measurementRequest(options.requestFile ?? '');
        renderMeasurementResult(
          await (await client()).measurement({
            operation: 'measurement.disable',
            scheduleId,
            transition,
            confirmDigest: options.confirm ?? '',
            actor: actor(options.actor ?? ''),
          }),
          options.json,
        );
      },
    );

  measurement
    .command('status')
    .argument('<scheduleId>')
    .requiredOption('--actor <actorId>', 'exact schedule owner')
    .option('--json')
    .action(async (scheduleId: string, options: OperateCommandOptions) => {
      renderMeasurementResult(
        await (await client()).measurement({
          operation: 'measurement.status',
          scheduleId,
          actor: actor(options.actor ?? ''),
        }),
        options.json,
      );
    });
}
