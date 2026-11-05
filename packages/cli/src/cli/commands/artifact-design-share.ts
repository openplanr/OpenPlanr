import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { ArtifactCommandError } from '../../services/artifact-pipeline-service.js';
import {
  DESIGN_HANDOFF_ACTIONS,
  DESIGN_MANAGE_ACTIONS,
  type DesignHandoffAction,
  type DesignShareAction,
  isDesignDocumentFile,
  prepareDesignHandoff,
  readDesignShareRuntime,
  runDesignFeedback,
  runDesignHandoffAction,
  runDesignShareAction,
} from '../../services/design-artifact-service.js';
import { isNonInteractive } from '../../services/interactive-state.js';
import { promptConfirm } from '../../services/prompt-service.js';
import { display, logger } from '../../utils/logger.js';
import { OPENPLANR_VERSION } from '../../utils/package-version.js';

interface DesignShareContext {
  resolveInput(file: string): string;
  confirmed(local?: boolean): boolean;
}

type Flags = Record<string, string | boolean | undefined>;

const CONFIRMED_MANAGE_ACTIONS = new Set(['rotate', 'revoke', 'delete', 'restore']);
const FEEDBACK_ACTIONS = ['inspect', 'export', 'import', 'select', 'resolve'];
const FEEDBACK_FLAGS = [
  'format',
  'scope',
  'output',
  'input',
  'revision',
  'allow-stale',
  'variant',
  'pins',
  'summary',
];

function designDocument(context: DesignShareContext, file: string): string {
  const input = context.resolveInput(file);
  if (!isDesignDocumentFile(input))
    throw new ArtifactCommandError(
      'E_ARTIFACT_INPUT_INVALID',
      'This operation requires a design-document.json file.',
    );
  return input;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value))
    return value as T;
  throw new ArtifactCommandError(
    'E_ARTIFACT_INPUT_INVALID',
    `${label} must be one of: ${allowed.join(', ')}.`,
  );
}

function readJsonInput(source: string, resolvePath: (file: string) => string) {
  const text = source === '-' ? readFileSync(0, 'utf8') : readFileSync(resolvePath(source), 'utf8');
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    return value as Record<string, unknown>;
  } catch {
    throw new ArtifactCommandError(
      'E_ARTIFACT_INPUT_INVALID',
      `The handoff input from ${source === '-' ? 'stdin' : source} must be a JSON object.`,
    );
  }
}

async function confirmAction(context: DesignShareContext, yes: boolean, question: string) {
  if (context.confirmed(yes)) return true;
  if (isNonInteractive())
    throw new ArtifactCommandError(
      'E_ARTIFACT_CONFIRMATION_REQUIRED',
      `${question} requires confirmation.`,
      'Rerun with --yes.',
    );
  return promptConfirm(question, false);
}

function emit(json: boolean, result: object, summarize: () => void) {
  if (json) display.line(JSON.stringify(result));
  else summarize();
}

/** Design-only share, status, management, feedback and handoff commands under `artifact`. */
export function registerDesignShareCommands(artifact: Command, context: DesignShareContext): void {
  artifact
    .command('share-runtime')
    .description('Report the CLI, workflow package and design sharing format versions')
    .option('--json', 'emit machine-readable output', false)
    .action(async (_options, command: Command) => {
      const result = await readDesignShareRuntime(OPENPLANR_VERSION);
      emit(Boolean(command.optsWithGlobals().json), result, () => {
        display.keyValue('CLI', result.cli);
        display.keyValue('Workflow package', result.pipeline);
        display.keyValue('Design sharing format', String(result.designShareCompat ?? 'unknown'));
      });
    });

  artifact
    .command('status <file>')
    .description('Show whether a design is shared, its review link and pending work')
    .option('--json', 'emit machine-readable output', false)
    .action(async (file: string, _options, command: Command) => {
      const result = await runDesignShareAction(designDocument(context, file), 'status');
      emit(Boolean(command.optsWithGlobals().json), result, () => {
        display.keyValue('Shared', result.shared ? 'yes' : 'no');
        if (result.url) display.keyValue('Review link', result.url);
      });
    });

  artifact
    .command('manage <file>')
    .description(
      'Rotate, pause, resume, revoke, delete, reveal access to, or recover a design review',
    )
    .requiredOption('--action <action>', DESIGN_MANAGE_ACTIONS.join('|'))
    .option('--output <path>', 'recovery: write the private recovery file to this new path')
    .option('--input <path>', 'restore: read the private recovery file from this path')
    .option('--yes', 'confirm a rotate, revoke, delete or restore non-interactively', false)
    .option('--json', 'emit machine-readable output', false)
    .action(async (file: string, _options, command: Command) => {
      const options = command.optsWithGlobals<Flags>();
      const action = oneOf(options.action, DESIGN_MANAGE_ACTIONS, 'Manage action');
      const input = designDocument(context, file);
      if (action === 'recovery' && typeof options.output !== 'string')
        throw new ArtifactCommandError(
          'E_ARTIFACT_INPUT_INVALID',
          'Recovery export requires --output <new-path>.',
        );
      if (action === 'restore' && typeof options.input !== 'string')
        throw new ArtifactCommandError(
          'E_ARTIFACT_INPUT_INVALID',
          'Recovery restore requires --input <recovery-file>.',
        );
      if (
        CONFIRMED_MANAGE_ACTIONS.has(action) &&
        !(await confirmAction(
          context,
          Boolean(options.yes),
          `${action[0].toUpperCase()}${action.slice(1)} the shared design review`,
        ))
      )
        return;
      const result = await runDesignShareAction(input, action as DesignShareAction, {
        ...(action === 'recovery' ? { output: context.resolveInput(String(options.output)) } : {}),
        ...(action === 'restore' ? { input: context.resolveInput(String(options.input)) } : {}),
      });
      const json = Boolean(options.json);
      // The reviewer token leaves the CLI only in machine-readable output.
      const printed = json || action !== 'access' ? result : { ...result, token: undefined };
      emit(json, printed, () => {
        logger.success(`Design review ${action} complete`);
        if (result.url) display.keyValue('Review link', result.url);
        if (result.output) display.keyValue('Recovery file', result.output);
        if (action === 'access')
          logger.dim('Rerun with --json to print the reviewer access token.');
      });
    });

  artifact
    .command('feedback <file>')
    .description(
      'Inspect, export, import, select or resolve design feedback; syncs a shared design first',
    )
    .option('--action <action>', FEEDBACK_ACTIONS.join('|'), 'inspect')
    .option('--format <format>', 'export: json or markdown')
    .option('--scope <scope>', 'export: current or all')
    .option('--output <path>', 'export: write to this new path')
    .option('--input <path>', 'import: read feedback from this file')
    .option('--revision <revision>', 'import: the current render revision')
    .option('--allow-stale', 'import: accept feedback for an older revision', false)
    .option('--variant <id>', 'select: the ready variant to select')
    .option('--pins <ids>', 'resolve: comma-separated pin ids')
    .option('--summary <text>', 'resolve: resolution summary')
    .option('--json', 'emit machine-readable output', false)
    .action(async (file: string, _options, command: Command) => {
      const options = command.optsWithGlobals<Flags>();
      const action = oneOf(options.action, FEEDBACK_ACTIONS, 'Feedback action');
      const flags: Flags = {};
      for (const name of FEEDBACK_FLAGS) {
        const key = name.replace(/-([a-z])/gu, (_match, letter: string) => letter.toUpperCase());
        const value = options[key];
        if (value === undefined || value === false) continue;
        flags[name] =
          ['output', 'input'].includes(name) && typeof value === 'string'
            ? context.resolveInput(value)
            : value;
      }
      const result = await runDesignFeedback(designDocument(context, file), action, flags);
      emit(Boolean(options.json), result, () => {
        logger.success(`Design feedback ${action} complete`);
        if (typeof result.output === 'string') display.keyValue('Output', result.output);
      });
    });

  artifact
    .command('handoff <file>')
    .description(
      'Prepare, inspect or update a design review handoff for refinement and owner approval',
    )
    .option('--action <action>', DESIGN_HANDOFF_ACTIONS.join('|'), 'draft')
    .option('--input <path|->', 'update input as a JSON object, from a file or stdin')
    .option('--json', 'emit machine-readable output', false)
    .action(async (file: string, _options, command: Command) => {
      const options = command.optsWithGlobals<Flags>();
      const action = oneOf<DesignHandoffAction>(
        options.action,
        DESIGN_HANDOFF_ACTIONS,
        'Handoff action',
      );
      const input = designDocument(context, file);
      const result =
        action === 'draft'
          ? await prepareDesignHandoff(input)
          : await runDesignHandoffAction(
              input,
              action,
              typeof options.input === 'string'
                ? readJsonInput(options.input, context.resolveInput)
                : {},
            );
      emit(Boolean(options.json), result, () => {
        logger.success(
          action === 'draft' ? 'Design review handoff prepared' : `Handoff ${action} complete`,
        );
        if (result.path) display.keyValue('Handoff', String(result.path));
        if (action === 'draft')
          logger.dim(
            'Refine the draft in your coding session, then review and approve it in the local studio. Plan remains a separate invocation.',
          );
      });
    });
}
