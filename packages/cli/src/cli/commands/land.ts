import { lstat, readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import type {
  LandingAdvanceInputV1,
  LandingPrepareInputV1,
  LandingServiceV1,
} from '../../services/landing/landing-service.js';
import { display, logger } from '../../utils/logger.js';
import { CliBoundaryError, toCliFailureEnvelope } from '../error-boundary.js';

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const PLAN_ID = /^land_[a-f0-9]{32}$/u;
const OPERATION_ID = /^lop_[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u;

export type LandCommandServiceFactory = (
  input: Readonly<{ projectDir: string }>,
) => Promise<LandingServiceV1> | LandingServiceV1;

export type LandCommandDependencies = Readonly<{
  createService?: LandCommandServiceFactory;
  authorityContext?: () => Readonly<{ agent: boolean; hook: boolean }>;
}>;

function stdinBytes(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    process.stdin.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
      size += bytes.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        reject(
          new CliBoundaryError(
            'E_LANDING_REQUEST_TOO_LARGE',
            'The landing request exceeds the bounded input size.',
          ),
        );
        process.stdin.pause();
        return;
      }
      chunks.push(bytes);
    });
    process.stdin.once('error', reject);
    process.stdin.once('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function requestBytes(pathname: string): Promise<Buffer> {
  if (pathname === '-') return stdinBytes();
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(pathname);
  } catch (cause) {
    throw new CliBoundaryError(
      'E_LANDING_REQUEST_UNAVAILABLE',
      'The landing request file is unavailable.',
      { cause, recovery: 'Provide one bounded regular JSON request file or use stdin (-).' },
    );
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_REQUEST_BYTES) {
    throw new CliBoundaryError(
      'E_LANDING_REQUEST_INVALID',
      'The landing request must be one bounded regular file.',
    );
  }
  return readFile(pathname);
}

export async function readLandingPrepareRequestV1(
  pathname: string,
): Promise<LandingPrepareInputV1> {
  const bytes = await requestBytes(pathname);
  let value: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch (cause) {
    throw new CliBoundaryError('E_LANDING_REQUEST_INVALID', 'Landing request JSON is invalid.', {
      cause,
    });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CliBoundaryError(
      'E_LANDING_REQUEST_INVALID',
      'Landing request must be one closed JSON object.',
    );
  }
  const input = value as Record<string, unknown>;
  const allowed = [
    'baseRecords',
    'createdAt',
    'expiresAt',
    'feature',
    'operations',
    'preconditions',
    'receiptHash',
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key))) {
    throw new CliBoundaryError(
      'E_LANDING_REQUEST_INVALID',
      'Landing request contains an unknown field.',
    );
  }
  return input as LandingPrepareInputV1;
}

function output(result: Readonly<Record<string, unknown>>, json: boolean): void {
  if (json) {
    display.line(JSON.stringify(result));
    return;
  }
  display.line(JSON.stringify(result, null, 2));
}

function failure(error: unknown): Readonly<Record<string, unknown>> {
  return Object.freeze(
    toCliFailureEnvelope(error, {
      code: 'E_LANDING_FAILED',
      problem: 'Landing stopped safely before any unacknowledged effect.',
    }),
  );
}

async function serviceFor(
  program: Command,
  dependencies: LandCommandDependencies,
): Promise<LandingServiceV1> {
  if (!dependencies.createService) {
    throw new CliBoundaryError(
      'E_LANDING_HOST_NOT_CONFIGURED',
      'No trusted installed landing host is configured.',
      { recovery: 'Install and verify the certified landing Package-B host.' },
    );
  }
  return dependencies.createService({ projectDir: program.opts().projectDir as string });
}

function exactPlanId(value: string): void {
  if (!PLAN_ID.test(value)) {
    throw new CliBoundaryError('E_LANDING_INPUT_INVALID', 'Landing plan identity is invalid.');
  }
}

export function registerLandCommand(
  program: Command,
  dependencies: LandCommandDependencies = {},
): void {
  const command = program
    .command('land')
    .description('Inspect and owner-advance a certified landing plan');

  command
    .command('prepare')
    .description('Prepare a read-only landing plan from a terminal PASS receipt')
    .requiredOption('--request-file <path|->', 'read one closed landing request')
    .option('--json', 'machine-readable output', false)
    .action(async (options: { requestFile: string; json?: boolean }) => {
      try {
        const service = await serviceFor(program, dependencies);
        const result = await service.prepare(
          await readLandingPrepareRequestV1(options.requestFile),
        );
        output(result, Boolean(options.json));
      } catch (error) {
        output(failure(error), Boolean(options.json));
        process.exitCode = 1;
      }
    });

  for (const name of ['show', 'status'] as const) {
    command
      .command(name)
      .description(`${name === 'show' ? 'Show' : 'Read'} exact landing custody without effects`)
      .argument('<planId>', 'exact land_ plan identity')
      .option('--json', 'machine-readable output', false)
      .action(async (planId: string, options: { json?: boolean }) => {
        try {
          exactPlanId(planId);
          const service = await serviceFor(program, dependencies);
          output(await service[name](planId), Boolean(options.json));
        } catch (error) {
          output(failure(error), Boolean(options.json));
          process.exitCode = 1;
        }
      });
  }

  command
    .command('advance')
    .description('Review one neutral docket in a fresh owner terminal, then advance one phase')
    .argument('<planId>', 'exact land_ plan identity')
    .requiredOption('--operation <operationId>', 'exact lop_ operation identity')
    .action(async (planId: string, options: { operation: string }) => {
      try {
        exactPlanId(planId);
        if (!OPERATION_ID.test(options.operation)) {
          throw new CliBoundaryError(
            'E_LANDING_INPUT_INVALID',
            'Landing operation identity is invalid.',
          );
        }
        const authority = dependencies.authorityContext?.() ?? {
          agent:
            process.env.OPENPLANR_AGENT_CALL === '1' ||
            process.env.CODEX_THREAD_ID !== undefined ||
            process.env.CLAUDECODE === '1',
          hook:
            process.env.OPENPLANR_HOOK === '1' ||
            process.env.HUSKY === '1' ||
            process.env.GITHUB_ACTIONS === 'true',
        };
        const rootOptions = program.opts() as { interactive?: boolean; yes?: boolean };
        const advanceInput: LandingAdvanceInputV1 = {
          planId,
          operationId: options.operation,
          ownerInteractive:
            rootOptions.interactive !== false &&
            rootOptions.yes !== true &&
            Boolean(process.stdin.isTTY && process.stderr.isTTY),
          yes: rootOptions.yes === true,
          json: process.argv.includes('--json'),
          agent: authority.agent,
          hook: authority.hook,
        };
        const service = await serviceFor(program, dependencies);
        const result = await service.advance(advanceInput);
        output(result, false);
      } catch (error) {
        const result = failure(error);
        logger.error(`${String(result.code)}: ${String(result.problem)}`);
        if (typeof result.recovery === 'string') display.line(`  ${result.recovery}`);
        process.exitCode = 1;
      }
    });
}
