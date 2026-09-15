import type { Command } from 'commander';
import { display } from '../../../../utils/logger.js';
import {
  normalizeOperateCommandError,
  type OperateCommandOptions,
  readOperateContentInput,
} from '../input.js';
import type { OperateCommandRegistrationDependencies } from './contracts.js';
import { dispatch } from './dispatch.js';

export function registerAssignmentPacketCommands(
  program: Command,
  operate: Command,
  dependencies: OperateCommandRegistrationDependencies,
): void {
  const assignment = operate
    .command('assignment')
    .description('Prepare, validate, and submit one exact issued Assignment packet');
  assignment
    .command('prepare')
    .argument('<assignmentId>')
    .requiredOption('--actor <actorId>', 'exact Assignment claimant')
    .requiredOption('--runtime <runtime>', 'exact claimant runtime')
    .option('--json')
    .action(async (assignmentId: string, options: OperateCommandOptions) => {
      try {
        const service = await dependencies.createAssignmentPacketService(
          program.opts().projectDir as string,
        );
        const prepared = await service.prepare({
          assignmentId,
          actorId: options.actor ?? '',
          runtime: options.runtime ?? '',
        });
        const output = {
          packetId: prepared.packet.packetId,
          resultPath: prepared.resultPath,
          templatePath: prepared.templatePath,
          assignmentPath: prepared.assignmentPath,
          rubricPath: prepared.rubricPath,
          schemaCatalogPath: prepared.schemaCatalogPath,
          evidenceMatrixPath: prepared.evidenceMatrixPath,
          replayed: prepared.replayed,
        };
        if (options.json) display.line(JSON.stringify(output));
        else {
          display.line(`Prepared ${output.packetId}`);
          display.line(`Result path: ${output.resultPath}`);
          display.line(`Template path: ${output.templatePath}`);
          display.line(`Assignment path: ${output.assignmentPath}`);
          display.line(`Rubric path: ${output.rubricPath}`);
          display.line(`Schema catalog path: ${output.schemaCatalogPath}`);
          display.line(`Evidence matrix path: ${output.evidenceMatrixPath}`);
        }
      } catch (error) {
        throw normalizeOperateCommandError(error, {
          code: 'E_OPERATE_ASSIGNMENT_PREPARE_FAILED',
          message: 'The Assignment packet could not be prepared.',
        });
      }
    });
  assignment
    .command('validate')
    .argument('<packetId>')
    .requiredOption('--content-file <path>', 'UTF-8 JSON result file, or - for stdin')
    .option('--json')
    .action(async (packetId: string, options: OperateCommandOptions) => {
      try {
        const bytes = await readOperateContentInput(options.contentFile ?? '');
        const service = await dependencies.createAssignmentPacketService(
          program.opts().projectDir as string,
        );
        const validation = await service.validate(packetId, bytes);
        if (options.json) display.line(JSON.stringify(validation));
        else if (validation.ok) display.line(`${packetId} is ready to submit.`);
        else {
          display.line(`${packetId} has ${validation.errors.length} validation failure(s):`);
          for (const error of validation.errors) {
            display.line(`${error.pointer} · ${error.rule} · ${error.message}`);
          }
        }
        if (!validation.ok) process.exitCode = 1;
      } catch (error) {
        throw normalizeOperateCommandError(error, {
          code: 'E_OPERATE_ASSIGNMENT_VALIDATE_FAILED',
          message: 'The Assignment packet could not be validated.',
        });
      }
    });
  assignment
    .command('submit')
    .argument('<packetId>')
    .requiredOption('--content-file <path>', 'validated UTF-8 JSON result file, or - for stdin')
    .option('--json')
    .action(async (packetId: string, options: OperateCommandOptions) => {
      try {
        const bytes = await readOperateContentInput(options.contentFile ?? '');
        const service = await dependencies.createAssignmentPacketService(
          program.opts().projectDir as string,
        );
        const receipt = await service.submit(packetId, bytes);
        if (options.json) display.line(JSON.stringify(receipt));
        else display.line(`Accepted ${String(receipt.assignmentId)} from ${packetId}.`);
      } catch (error) {
        throw normalizeOperateCommandError(error, {
          code: 'E_OPERATE_ASSIGNMENT_SUBMIT_FAILED',
          message: 'The Assignment packet could not be submitted.',
        });
      }
    });
  assignment
    .command('recover')
    .option('--older-than-hours <hours>', 'clear unsubmitted packets older than this age', '24')
    .option('--json')
    .action(async (options: OperateCommandOptions & { olderThanHours?: string }) => {
      const hours = Number(options.olderThanHours ?? '24');
      if (!Number.isFinite(hours) || hours < 1) {
        throw Object.assign(new Error('Packet recovery age must be at least one hour.'), {
          code: 'E_OPERATE_PACKET_RECOVERY_AGE',
        });
      }
      const service = await dependencies.createAssignmentPacketService(
        program.opts().projectDir as string,
      );
      const removed = await service.recoverAbandoned({ olderThanMs: hours * 60 * 60 * 1000 });
      const result = { ok: true, removed };
      if (options.json) display.line(JSON.stringify(result));
      else display.line(`Cleared ${removed.length} abandoned packet(s).`);
    });
}

export function registerAssignmentDiagnosticCommands(
  program: Command,
  operate: Command,
  dependencies: OperateCommandRegistrationDependencies,
): void {
  operate
    .command('claim')
    .argument('<assignmentId>')
    .requiredOption('--actor <actorId>')
    .requiredOption('--runtime <runtime>', 'runtime name')
    .option('--json')
    .action(async (assignmentId: string, options: OperateCommandOptions) =>
      dispatch(
        program,
        {
          operation: 'operate.assignment.claim',
          request: {
            assignmentId,
            actor: {
              actorId: options.actor ?? '',
              kind: 'agent',
              runtime: options.runtime ?? '',
            },
          },
        },
        options,
        dependencies,
      ),
    );
  operate
    .command('submit')
    .argument('<assignmentId>')
    .requiredOption('--submission <submissionId>')
    .requiredOption('--actor <actorId>', 'exact Assignment claimant')
    .requiredOption('--runtime <runtime>', 'exact claimant runtime')
    .requiredOption('--content-base64 <content>')
    .option('--media-type <type>', 'media type', 'application/json')
    .option('--encoding <encoding>', 'utf-8 or binary', 'utf-8')
    .option('--json')
    .action(async (assignmentId: string, options: OperateCommandOptions) =>
      dispatch(
        program,
        {
          operation: 'operate.assignment.submit',
          request: {
            assignmentId,
            submissionId: options.submission ?? '',
            actor: {
              actorId: options.actor ?? '',
              kind: 'agent',
              runtime: options.runtime ?? '',
            },
            contentBase64: options.contentBase64 ?? '',
            mediaType: options.mediaType ?? 'application/json',
            encoding: options.encoding ?? 'utf-8',
          },
        },
        options,
        dependencies,
      ),
    );
}
