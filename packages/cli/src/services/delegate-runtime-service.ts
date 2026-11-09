import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolvePipelinePackage } from './pipeline-package-service.js';

/** The `openplanr delegate` contract; the plugin's minimum CLI version follows it. */
export const DELEGATE_CONTRACT_VERSION = '3.7.0';

export const DELEGATE_RUN_ACTIONS = [
  'probe',
  'profile-preview',
  'profile-enroll',
  'profile-remove',
  'prepare',
  'prepare-worktree',
  'dispatch',
  'wait',
  'status',
  'resume',
  'recover',
  'close',
  'cleanup',
  'abandon',
  'prune',
] as const;
export const DELEGATE_INTEGRATION_ACTIONS = ['review', 'apply', 'recover'] as const;

export type DelegateRunAction = (typeof DELEGATE_RUN_ACTIONS)[number];
export type DelegateIntegrationAction = (typeof DELEGATE_INTEGRATION_ACTIONS)[number];
export type DelegateAction = DelegateRunAction | `integrate ${DelegateIntegrationAction}`;
export type DelegateInput = Record<string, unknown>;

export interface DelegateSuccess {
  ok: true;
  action: DelegateAction;
  contractVersion: string;
  result: Record<string, unknown>;
  next: string;
}

export interface DelegateFailure {
  ok: false;
  action: DelegateAction;
  contractVersion: string;
  code: string;
  problem: string;
  recovery: string;
  runId?: string;
  details?: unknown;
}

/** A delegate failure the CLI reports with a code, the run it concerns and a recovery step. */
export class DelegateCommandError extends Error {
  readonly code: string;
  readonly recovery?: string;
  readonly runId?: string;
  readonly details?: unknown;

  constructor(
    code: string,
    problem: string,
    options: { recovery?: string; runId?: string; details?: unknown } = {},
  ) {
    super(problem);
    this.name = code;
    this.code = code;
    this.recovery = options.recovery;
    this.runId = options.runId;
    this.details = options.details;
  }
}

type RuntimeEntry = (action: string, input: DelegateInput) => Promise<unknown>;

interface DelegateRuntime {
  run: RuntimeEntry;
  integrate: RuntimeEntry;
  failure: (error: unknown) => { code: string; message: string; runId?: string; details?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exportedFunction(module: unknown, name: string, file: string) {
  const value = isRecord(module) ? module[name] : undefined;
  if (typeof value !== 'function')
    throw new DelegateCommandError(
      'E_DELEGATE_RUNTIME_INCOMPATIBLE',
      `The installed workflow package's ${file} does not export ${name}.`,
      { recovery: 'Reinstall openplanr so its workflow package matches this CLI.' },
    );
  return value;
}

/** Loads the delegate runtime from the installed workflow package. */
export async function loadDelegateRuntime(): Promise<DelegateRuntime> {
  const pipeline = resolvePipelinePackage(false);
  if (!pipeline)
    throw new DelegateCommandError(
      'E_DELEGATE_RUNTIME_MISSING',
      'Delegation needs the OpenPlanr workflow package, which is not installed.',
      { recovery: 'Reinstall openplanr without --omit=optional.' },
    );
  const root = path.join(pipeline.root, 'lib', 'delegate');
  const [runner, integration] = await Promise.all([
    import(pathToFileURL(path.join(root, 'runner.mjs')).href),
    import(pathToFileURL(path.join(root, 'integrate.mjs')).href),
  ]);
  const run = exportedFunction(runner, 'delegateRunnerCommand', 'runner.mjs');
  const integrate = exportedFunction(integration, 'delegateIntegrationCommand', 'integrate.mjs');
  const failure = exportedFunction(runner, 'delegateFailure', 'runner.mjs');
  return {
    run: (action, input) => Promise.resolve(run(action, input)),
    integrate: (action, input) => Promise.resolve(integrate(action, input)),
    failure: (error) => {
      const value: unknown = failure(error);
      if (!isRecord(value) || typeof value.code !== 'string' || typeof value.message !== 'string')
        return { code: 'E_DELEGATE_UNKNOWN', message: 'Delegate command failed.' };
      return {
        code: value.code,
        message: value.message,
        ...(typeof value.runId === 'string' ? { runId: value.runId } : {}),
        ...(value.details !== undefined ? { details: value.details } : {}),
      };
    },
  };
}

const RECOVERY: Readonly<Record<string, string>> = {
  E_DELEGATE_INPUT:
    'Pass one JSON object with --input <file> or --input -; run the action with --help for its fields.',
  E_DELEGATE_COMMAND: 'Run `openplanr delegate --help` to list the actions.',
  E_DELEGATE_HOST_UNSUPPORTED:
    'Run delegation from a host with a local shell, or implement with planr-ship.',
  E_DELEGATE_PRIVATE:
    'Omit runDirectory and worktreeParent, or keep them under ~/.openplanr/delegate/.',
  E_DELEGATE_SCOPE: 'List literal path prefixes in scopePaths, such as "src/app".',
  E_CAPSULE_SECRET:
    "Show the masked findings. Resolve one only after the user confirms it is not a credential, by preparing again with credentialResolutions naming the finding's id and contentDigest.",
  E_DESTINATION_CHANGED: 'Inspect the new destination, then preview and enroll the profile again.',
  E_DESTINATION_UNKNOWN: 'Inspect the named configuration source, then prepare a fresh preview.',
  E_DELEGATE_HELPER_DRIFT:
    "The run's pinned copy changed after preparation; inspect it with status and prepare a new run.",
  E_RUN_NOT_FOUND: 'Use the runId that prepare returned, or prepare a new run.',
  E_RUN_STORE_MISSING:
    'No delegated run has been recorded on this machine; prepare a run first, or omit runDirectory to use the default store.',
  E_RUN_LOCKED: 'Another delegate action holds this run; wait for it, then retry.',
};

function recoveryFor(code: string, details: unknown): string {
  if (isRecord(details) && typeof details.nextAction === 'string') return details.nextAction;
  return (
    RECOVERY[code] ??
    'Run `openplanr delegate status --run <runId> --json` to inspect the run, then retry the action.'
  );
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value ? value : undefined;
}

function defaultNext(action: DelegateAction, result: Record<string, unknown>): string {
  const run = stringField(result, 'runId') ?? '<runId>';
  const status = stringField(result, 'status');
  switch (action) {
    case 'probe':
      return 'Confirm the engine and profile with the user, then run `openplanr delegate prepare --input <file> --json`.';
    case 'profile-preview':
      return 'Confirm the destination with the user, then run `openplanr delegate profile-enroll --input <file> --json`.';
    case 'prepare':
      return `Show the preview to the user, then run \`openplanr delegate dispatch --run ${run} --json\`.`;
    case 'dispatch':
    case 'resume':
    case 'wait':
      return status === 'completed'
        ? `Review the observed changes: \`openplanr delegate integrate review --input <file> --json\` with runId ${run} and scopePaths.`
        : status === 'running' || status === 'resuming'
          ? `Run \`openplanr delegate wait --run ${run} --json\` until the run stops.`
          : `Run \`openplanr delegate status --run ${run} --json\` and resolve its attention state.`;
    case 'integrate review':
      return `If the patch is accepted, run \`openplanr delegate integrate apply --input <file> --json\` with runId ${run}, the same scopePaths and the selected checks.`;
    case 'integrate apply':
      return 'Report the saved implementation report. Commit, landing and release stay separate decisions.';
    default:
      return `Run \`openplanr delegate status --run ${run} --json\` to see the run's state.`;
  }
}

/** The step the user or agent takes next; the runtime's own advice wins over the default. */
export function delegateNext(action: DelegateAction, result: Record<string, unknown>): string {
  const presentation = isRecord(result.presentation) ? result.presentation : {};
  const readiness = isRecord(result.readiness) ? result.readiness : {};
  if (action === 'prepare') return defaultNext(action, result);
  return (
    stringField(result, 'nextAction') ??
    stringField(presentation, 'nextAction') ??
    stringField(readiness, 'nextAction') ??
    defaultNext(action, result)
  );
}

function failureEnvelope(
  action: DelegateAction,
  failure: { code: string; message: string; runId?: string; details?: unknown; recovery?: string },
): DelegateFailure {
  return {
    ok: false,
    action,
    contractVersion: DELEGATE_CONTRACT_VERSION,
    code: failure.code,
    problem: failure.message,
    recovery: failure.recovery ?? recoveryFor(failure.code, failure.details),
    ...(failure.runId ? { runId: failure.runId } : {}),
    ...(failure.details !== undefined ? { details: failure.details } : {}),
  };
}

/** Runs one delegate action and returns its stable success or failure envelope. */
export async function runDelegateAction(
  action: DelegateAction,
  input: DelegateInput,
  options: { signal?: AbortSignal; runtime?: DelegateRuntime } = {},
): Promise<DelegateSuccess | DelegateFailure> {
  let runtime: DelegateRuntime;
  try {
    runtime = options.runtime ?? (await loadDelegateRuntime());
  } catch (error) {
    if (error instanceof DelegateCommandError)
      return failureEnvelope(action, {
        code: error.code,
        message: error.message,
        recovery: error.recovery,
      });
    throw error;
  }
  try {
    const value = action.startsWith('integrate ')
      ? await runtime.integrate(action.slice('integrate '.length), input)
      : await runtime.run(action, {
          ...input,
          ...(options.signal ? { signal: options.signal } : {}),
        });
    const result = isRecord(value) ? value : { value };
    return {
      ok: true,
      action,
      contractVersion: DELEGATE_CONTRACT_VERSION,
      result,
      next: delegateNext(action, result),
    };
  } catch (error) {
    return failureEnvelope(action, runtime.failure(error));
  }
}
