import path from 'node:path';
import { type Command, Option } from 'commander';
import { openExternalUrl } from '../../services/artifact-pipeline-service.js';
import {
  readDesignCapabilities,
  runDesignUtility,
} from '../../services/design-artifact-service.js';
import { display, logger } from '../../utils/logger.js';
import { OPENPLANR_VERSION } from '../../utils/package-version.js';

const PATH_OPTIONS = new Set(['--output', '--report', '--dest']);

const view = () =>
  new Option('--view <view>', 'canvas, prototype, or walkthrough').choices([
    'canvas',
    'prototype',
    'walkthrough',
  ]);

const DOCUMENT_COMMANDS: ReadonlyArray<
  [name: string, description: string, options: () => Option[]]
> = [
  ['inspect', 'Report the design document and its current render', () => []],
  ['validate', 'Validate the design document without rendering', () => []],
  ['render', 'Render the design document into a new review revision', () => []],
  [
    'open',
    'Open the local design studio; it runs until stopped',
    () => [
      view(),
      new Option('--port <port>', 'loopback studio port'),
      new Option('--no-open', 'do not open a browser'),
    ],
  ],
  [
    'view-context',
    'Report what the local studio is showing',
    () => [new Option('--request-time <timestamp>', 'ISO time of the request being answered')],
  ],
  [
    'export',
    'Export the design as standalone HTML',
    () => [
      view(),
      new Option('--format <format>', 'html'),
      new Option('--output <path>', 'write to this new path'),
    ],
  ],
  [
    'verify',
    'Record a browser verification report for the current render',
    () => [new Option('--report <path>', 'the browser report JSON')],
  ],
  [
    'handoff',
    'Inspect the design review handoff without changing any file',
    () => [new Option('--action <action>', 'inspect').choices(['inspect']).default('inspect')],
  ],
];

/** The utility arguments for the options a user set, with paths resolved against the project. */
function forwarded(command: Command, resolve: (value: string) => string): string[] {
  const values = command.opts();
  return command.options.flatMap((option) => {
    const { long } = option;
    const value = values[option.attributeName()];
    if (!long || long === '--json') return [];
    if (option.negate) return value === false ? [long] : [];
    return (Array.isArray(value) ? value : [value])
      .filter((item): item is string => typeof item === 'string')
      .flatMap((item) => [long, PATH_OPTIONS.has(long) ? resolve(item) : item]);
  });
}

async function run(command: Command, argv: string[]): Promise<void> {
  const result = await runDesignUtility(argv, openExternalUrl);
  const failed = result.ok === false || result.status === 'failed';
  if (command.opts().json) display.line(JSON.stringify(result));
  else {
    if (failed) logger.warn(`Design ${argv[0]} did not pass`);
    else logger.success(`Design ${argv[0]} complete`);
    for (const key of ['status', 'url', 'output', 'revision'])
      if (typeof result[key] === 'string')
        display.keyValue(`${key[0].toUpperCase()}${key.slice(1)}`, result[key] as string);
    if (argv[0] === 'open') logger.dim('Press Ctrl+C to stop the local design studio.');
  }
  if (failed) process.exitCode = 1;
}

export function registerDesignCommand(program: Command): void {
  const resolve = (value: string) => path.resolve(program.opts().projectDir as string, value);
  const design = program
    .command('design')
    .description('Validate, render, review, export, and inspect local designs');

  design
    .command('capabilities')
    .description('Report the design command contract this CLI and its workflow package serve')
    .option('--json', 'emit machine-readable output', false)
    .action(async (_options, command: Command) => {
      const result = await readDesignCapabilities(OPENPLANR_VERSION);
      if (command.opts().json) display.line(JSON.stringify(result));
      else if (!result.ok) {
        logger.warn(result.problem);
        logger.dim(result.recovery);
      } else {
        display.keyValue('CLI', result.cli);
        display.keyValue('Workflow package', result.pipeline);
        display.keyValue(
          'Design contract',
          `${result.contract} (serves ${result.supported.min} to ${result.supported.max})`,
        );
      }
    });

  for (const [name, description, options] of DOCUMENT_COMMANDS) {
    const command = design.command(`${name} <file>`).description(description);
    for (const option of options()) command.addOption(option);
    command
      .option('--json', 'emit machine-readable output', false)
      .action((file: string, _options, self: Command) =>
        run(self, [name, resolve(file), ...forwarded(self, resolve)]),
      );
  }

  const studio = design.command('studio').description('Report or stop the local design studio');
  for (const action of ['status', 'stop'] as const) {
    studio
      .command(`${action} <file>`)
      .description(
        action === 'status'
          ? 'Report whether the design’s local studio is running'
          : 'Stop the design’s local studio; feedback and arrangement are kept',
      )
      .option('--instance-id <id>', 'an exact studio service, from studio status')
      .option('--json', 'emit machine-readable output', false)
      .action((file: string, _options, self: Command) =>
        run(self, ['studio', resolve(file), '--action', action, ...forwarded(self, resolve)]),
      );
  }

  design
    .command('fonts')
    .description('Download open-license fonts into a design')
    .command('fetch')
    .description('Download up to two open-license font families into the design sources')
    .option(
      '--family <name:weights>',
      'a family and its weights, such as "Inter:400,700"; repeat for a second family',
      (value: string, previous: string[]) => [...previous, value],
      [],
    )
    .option('--dest <dir>', 'the design’s font directory, such as source/assets/fonts')
    .option('--json', 'emit machine-readable output', false)
    .action((_options, self: Command) =>
      run(self, ['fonts', 'fetch', ...forwarded(self, resolve)]),
    );
}
