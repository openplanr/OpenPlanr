import { open } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import type { Command } from 'commander';
import {
  DELEGATE_CONTRACT,
  DELEGATE_INTEGRATION_ACTIONS,
  DELEGATE_RUN_ACTIONS,
  type DelegateAction,
  type DelegateFailure,
  type DelegateInput,
  type DelegateSuccess,
  runDelegateAction,
} from '../../services/delegate-runtime-service.js';
import { display } from '../../utils/logger.js';

type DelegateOptions = { input?: string; run?: string; json?: boolean };

const RUN_INPUT_LIMIT = 2 * 1024 * 1024;
const INTEGRATION_INPUT_LIMIT = 64 * 1024;

const DESCRIPTIONS: Readonly<Record<DelegateAction, string>> = {
  probe: 'Discover Git, installed Claude Code, Codex and Cursor CLIs, and saved profiles',
  'profile-preview': 'Show the destination and readiness of a profile before saving it',
  'profile-enroll': 'Save a previewed profile after its destination is confirmed',
  'profile-remove': 'Remove a saved profile by name',
  prepare: 'Build the context capsule and owned worktree, and return the preview to confirm',
  'prepare-worktree': 'Run parent-selected setup commands in the owned worktree before dispatch',
  dispatch: 'Start the native agent for a prepared run',
  wait: 'Wait a bounded time for a running delegate, then report its state',
  status: 'Report a run, its session, progress and saved report',
  resume: 'Continue the recorded session with an answer or correction',
  recover: 'Reconcile a run whose process ended without recording an outcome',
  close: 'Close a run record with a disposition',
  cleanup: 'Remove an owned worktree that holds no unreviewed work',
  abandon: 'Discard a run that never executed, keeping any modified work',
  prune: 'Delete closed run records past their retention',
  'integrate review': 'Review the observed patch against the integration scope; nothing is applied',
  'integrate apply': 'Run the selected checks and apply the reviewed patch as an uncommitted diff',
  'integrate recover': 'Finish or roll back an interrupted apply',
};

const EXAMPLES: Readonly<Partial<Record<DelegateAction, string>>> = {
  probe: 'openplanr delegate probe --json',
  prepare: 'openplanr delegate prepare --input prepare.json --json',
  dispatch: 'openplanr delegate dispatch --run <runId> --json',
  wait: 'openplanr delegate wait --run <runId> --json',
  status: 'openplanr delegate status --run <runId> --json',
  resume:
    'echo \'{"runId":"<runId>","correction":"Fix the failing test."}\' | openplanr delegate resume --input - --json',
  abandon: 'openplanr delegate abandon --run <runId> --json',
  'integrate review':
    'echo \'{"runId":"<runId>","scopePaths":["src"]}\' | openplanr delegate integrate review --input - --json',
  'integrate apply': 'openplanr delegate integrate apply --input apply.json --json',
};

class InputError extends Error {}

async function readBounded(stream: Readable, limit: number, source: string): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += bytes.length;
    if (size > limit) throw new InputError(`Input from ${source} exceeds ${limit} bytes.`);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readFileBounded(file: string, limit: number): Promise<string> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(file, 'r');
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
    throw new InputError(`Cannot read --input file ${file} (${code}).`);
  }
  try {
    return await readBounded(handle.createReadStream(), limit, file);
  } finally {
    await handle.close();
  }
}

function parseObject(text: string, source: string): DelegateInput {
  let parsed: unknown = {};
  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new InputError(`Input from ${source} is not valid JSON.`);
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new InputError(`Input from ${source} must be one JSON object.`);
  return parsed as DelegateInput;
}

async function readInput(options: DelegateOptions, limit: number): Promise<DelegateInput> {
  const source = options.input === '-' ? 'stdin' : (options.input ?? 'no input');
  const text =
    options.input === undefined
      ? ''
      : options.input === '-'
        ? await readBounded(process.stdin, limit, 'stdin')
        : await readFileBounded(options.input, limit);
  const input = parseObject(text, source);
  if (options.run === undefined) return input;
  if (input.runId !== undefined && input.runId !== options.run)
    throw new InputError(
      `--run ${options.run} differs from the input runId ${String(input.runId)}.`,
    );
  return { ...input, runId: options.run };
}

function field(result: Record<string, unknown>, key: string): string | undefined {
  const value = result[key];
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : undefined;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object',
      )
    : [];
}

function probeLines(result: Record<string, unknown>): string[] {
  const host =
    result.host !== null && typeof result.host === 'object'
      ? (result.host as Record<string, unknown>)
      : null;
  if (!host) return [];
  const engines = records(host.engines).map((engine) => field(engine, 'kind') ?? 'unknown');
  const profiles = records(result.profiles).map((profile) => {
    const destination = records([profile.destination])[0];
    const where = destination ? field(destination, 'class') : undefined;
    return `${field(profile, 'name') ?? 'unnamed'} (${field(profile, 'kind') ?? '?'}${where ? `, ${where}` : ''})`;
  });
  return [
    `Engines: ${engines.length ? engines.join(', ') : 'none found on PATH'}`,
    `Profiles: ${profiles.length ? profiles.join(', ') : 'none saved'}`,
  ];
}

function render(envelope: DelegateSuccess | DelegateFailure): void {
  if (!envelope.ok) {
    display.line(`Delegate ${envelope.action} failed: ${envelope.code}`);
    display.line(`  ${envelope.problem}`);
    if (envelope.runId) display.line(`  Run: ${envelope.runId}`);
    display.line(`Next: ${envelope.recovery}`);
    return;
  }
  const result = envelope.result;
  const presentation =
    result.presentation !== null && typeof result.presentation === 'object'
      ? (result.presentation as Record<string, unknown>)
      : {};
  const host = records([result.host])[0];
  const headline =
    field(presentation, 'headline') ??
    field(result, 'status') ??
    (host ? (host.ready === true ? 'host ready' : 'host not ready') : 'done');
  display.line(`Delegate ${envelope.action}: ${headline}`);
  for (const [label, key] of [
    ['Run', 'runId'],
    ['Status', 'status'],
    ['Phase', 'phase'],
    ['Profile', 'profile'],
  ] as const) {
    const value = field(result, key);
    if (value !== undefined) display.line(`  ${label}: ${value}`);
  }
  if (Array.isArray(result.changedPaths))
    display.line(`  Changed: ${result.changedPaths.length} file(s)`);
  for (const line of probeLines(result)) display.line(`  ${line}`);
  display.line(`Next: ${envelope.next}`);
}

function emit(envelope: DelegateSuccess | DelegateFailure, json: boolean): void {
  if (json) display.line(JSON.stringify(envelope, null, 2));
  else render(envelope);
  if (!envelope.ok) process.exitCode = 1;
}

async function execute(action: DelegateAction, options: DelegateOptions, limit: number) {
  const json = Boolean(options.json);
  let input: DelegateInput;
  try {
    input = await readInput(options, limit);
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    emit(
      {
        ok: false,
        action,
        contract: DELEGATE_CONTRACT,
        code: 'E_DELEGATE_INPUT',
        problem: error.message,
        recovery: `Pass one JSON object with --input <file> or --input -. See \`openplanr delegate ${action} --help\`.`,
      },
      json,
    );
    return;
  }
  const interruption = new AbortController();
  const interrupted = () => interruption.abort();
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  try {
    emit(await runDelegateAction(action, input, { signal: interruption.signal }), json);
  } finally {
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
  }
}

function addAction(parent: Command, name: string, action: DelegateAction, limit: number): void {
  const example = EXAMPLES[action];
  parent
    .command(name)
    .description(DESCRIPTIONS[action])
    .option('--input <file>', 'JSON object with the action fields; "-" reads stdin')
    .option('--run <runId>', 'run identifier; merged into the input as runId')
    .option('--json', 'machine-readable output', false)
    .addHelpText('after', example ? `\nExample:\n  ${example}\n` : '')
    .action((options: DelegateOptions) => execute(action, options, limit));
}

export function registerDelegateCommand(program: Command): void {
  const delegate = program
    .command('delegate')
    .description(
      'Hand one scoped implementation to Claude Code, Codex or Cursor, then review and integrate its changes',
    )
    .addHelpText(
      'after',
      '\nEvery action prints { ok, action, contract, result, next } with --json, or\n{ ok: false, code, problem, recovery } with exit code 1. See docs/CLI.md.\n',
    );
  for (const action of DELEGATE_RUN_ACTIONS) addAction(delegate, action, action, RUN_INPUT_LIMIT);
  const integrate = delegate
    .command('integrate')
    .description('Review, apply or recover the observed patch of a finished run');
  for (const action of DELEGATE_INTEGRATION_ACTIONS)
    addAction(integrate, action, `integrate ${action}`, INTEGRATION_INPUT_LIMIT);
}
