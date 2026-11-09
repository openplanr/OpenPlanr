import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  executeGitHubOperations,
  type GitHubOperationResult,
  type GitHubSyncResult,
  IntegrationError,
  inspectGitHub,
  inspectLocal,
} from '../../lib/integrations.mjs';
import { CLI_COMMAND } from '../utils/constants.js';

/** Version of the `sync tracker` JSON contract; runtime skills pin it. */
export const SYNC_TRACKER_CONTRACT = 1;
export const SYNC_TRACKER_PROVIDERS = ['local', 'github'] as const;
export const SYNC_TRACKER_ACTIONS = ['inspect', 'sync'] as const;

type Provider = (typeof SYNC_TRACKER_PROVIDERS)[number];
type Action = (typeof SYNC_TRACKER_ACTIONS)[number];

export interface SyncTrackerRequest {
  provider: string;
  action: string;
  input?: string;
  apply: boolean;
  projectDir: string;
  stdin: AsyncIterable<string | Buffer>;
  env: NodeJS.ProcessEnv;
}

interface Envelope {
  contract: typeof SYNC_TRACKER_CONTRACT;
  provider: Provider;
  action: Action;
}

export type SyncTrackerSuccess = Envelope & { ok: true; next: string } & (
    | { roots: string[]; configured: boolean }
    | { repository: unknown }
    | Omit<GitHubSyncResult, 'provider'>
  );

/** An `--apply` run that stopped at a failed issue change. */
export type SyncTrackerIncomplete = Envelope &
  Omit<GitHubSyncResult, 'provider'> & {
    ok: false;
    code: 'E_SYNC_TRACKER_APPLY_INCOMPLETE';
    problem: string;
    recovery: string;
  };

const PREVIEW_COMMAND = `${CLI_COMMAND} sync tracker github sync --input <operations.json> --json`;

function usage(problem: string, recovery: string): IntegrationError {
  return new IntegrationError('E_SYNC_TRACKER_USAGE', problem, { recovery });
}

function parseTarget(request: SyncTrackerRequest): { provider: Provider; action: Action } {
  const { provider, action } = request;
  if (provider === 'linear')
    throw new IntegrationError(
      'E_SYNC_TRACKER_LINEAR',
      "Linear synchronization runs through the coding agent's Linear connection, not the CLI.",
      { recovery: "Use your coding agent's Linear connection for Linear issue changes." },
    );
  if (!(SYNC_TRACKER_PROVIDERS as readonly string[]).includes(provider))
    throw usage(
      `Unknown tracker "${provider}"; expected ${SYNC_TRACKER_PROVIDERS.join(', ')}.`,
      `Other trackers sync through the coding agent's connection; run \`${CLI_COMMAND} sync tracker --help\`.`,
    );
  if (!(SYNC_TRACKER_ACTIONS as readonly string[]).includes(action))
    throw usage(
      `Unknown action "${action}"; expected ${SYNC_TRACKER_ACTIONS.join(' or ')}.`,
      `Run \`${CLI_COMMAND} sync tracker --help\`.`,
    );
  if (provider === 'local' && action === 'sync')
    throw usage(
      'The local provider has no tracker to write to.',
      `Run \`${CLI_COMMAND} sync --dry-run\` to audit local cross-references, then \`${CLI_COMMAND} sync\` to repair them.`,
    );
  if (action === 'inspect' && (request.input !== undefined || request.apply))
    throw usage(
      '--input and --apply apply only to sync.',
      `Run \`${CLI_COMMAND} sync tracker ${provider} inspect\` without them.`,
    );
  if (action === 'sync' && request.input === undefined)
    throw usage(
      'github sync needs --input <path>, or --input - to read stdin.',
      `Write the operations as a JSON array, then run \`${PREVIEW_COMMAND}\`.`,
    );
  return { provider: provider as Provider, action: action as Action };
}

async function readOperations(request: SyncTrackerRequest): Promise<unknown> {
  const source = request.input === '-' ? 'stdin' : (request.input ?? '');
  let text = '';
  try {
    if (request.input === '-') for await (const chunk of request.stdin) text += chunk;
    else text = await readFile(path.resolve(request.projectDir, source), 'utf8');
  } catch (error) {
    const reason =
      (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'file not found' : 'unreadable';
    throw new IntegrationError(
      'E_SYNC_TRACKER_INPUT',
      `Cannot read operations from ${source}: ${reason}.`,
      { recovery: 'Pass an existing JSON file relative to the project directory, or - for stdin.' },
    );
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new IntegrationError(
      'E_SYNC_TRACKER_INPUT',
      `Operations from ${source} are not valid JSON: ${(error as Error).message}`,
      { recovery: 'Pass a JSON array of operations; see the examples in --help.' },
    );
  }
}

function describeOperation(result: GitHubOperationResult): string {
  return `${result.action}${result.id ? ` #${result.id}` : ''}`;
}

function incomplete(envelope: Envelope, sync: GitHubSyncResult): SyncTrackerIncomplete {
  const { provider: _provider, ...outcome } = sync;
  const failed = sync.results.find(({ status }) => status === 'failed');
  if (!failed?.error)
    throw new Error('An incomplete GitHub sync result has no failed operation with an error.');
  const appliedCount = sync.results.filter(({ status }) => status === 'applied').length;
  const rerun = sync.results
    .filter(({ status }) => status !== 'applied')
    .map(({ index }) => index)
    .join(', ');
  return {
    ok: false,
    code: 'E_SYNC_TRACKER_APPLY_INCOMPLETE',
    problem: `${appliedCount} of ${sync.results.length} issue changes applied; operation ${failed.index} (${describeOperation(failed)}) failed: ${failed.error.problem}`,
    recovery: `${failed.error.recovery ?? 'Fix the failure.'} Then rerun operations ${rerun} with --apply; the applied ones are done.`,
    ...envelope,
    ...outcome,
  };
}

function syncNext(sync: GitHubSyncResult): string {
  if (sync.results.length === 0) return 'Nothing to change.';
  if (!sync.applied)
    return 'Show these changes to the user; once they approve, rerun the same command with --apply.';
  return "Record each new issue's id as githubIssue in its planning file, then report the changes.";
}

/** Runs one `sync tracker` request; an incomplete apply returns, every other failure throws. */
export async function runSyncTracker(
  request: SyncTrackerRequest,
): Promise<SyncTrackerSuccess | SyncTrackerIncomplete> {
  const { provider, action } = parseTarget(request);
  const envelope: Envelope = { contract: SYNC_TRACKER_CONTRACT, provider, action };
  const cwd = request.projectDir;
  if (provider === 'local') {
    const { provider: _local, ...local } = await inspectLocal({ cwd });
    return {
      ok: true,
      ...envelope,
      ...local,
      next: local.configured
        ? `Run \`${CLI_COMMAND} sync --dry-run\` to audit local cross-references.`
        : `Run \`${CLI_COMMAND} init\` to create a planning root.`,
    };
  }
  if (action === 'inspect') {
    const { repository } = await inspectGitHub({ cwd, env: request.env });
    return {
      ok: true,
      ...envelope,
      repository,
      next: `Preview issue changes with \`${PREVIEW_COMMAND}\`.`,
    };
  }
  const sync = await executeGitHubOperations(await readOperations(request), {
    cwd,
    env: request.env,
    apply: request.apply,
  });
  if (!sync.complete) return incomplete(envelope, sync);
  const { provider: _github, ...outcome } = sync;
  return { ok: true, ...envelope, ...outcome, next: syncNext(sync) };
}
