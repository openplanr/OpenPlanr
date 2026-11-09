import type { Command } from 'commander';
import type { GitHubOperationResult } from '../../../lib/integrations.mjs';
import {
  runSyncTracker,
  SYNC_TRACKER_ACTIONS,
  SYNC_TRACKER_PROVIDERS,
  type SyncTrackerIncomplete,
  type SyncTrackerSuccess,
} from '../../services/sync-tracker-service.js';
import { CLI_COMMAND } from '../../utils/constants.js';
import { display } from '../../utils/logger.js';
import { toCliFailureEnvelope } from '../error-boundary.js';

type TrackerOptions = { input?: string; apply?: boolean; json?: boolean };

const HELP = `
Operations (--input, a JSON array):
  {"action":"create","title":"...","body":"...","labels":["..."]}
  {"action":"update","id":"12","title":"...","body":"...","labels":["..."]}
  {"action":"close","id":"12","comment":"..."}
  {"action":"reopen","id":"12","comment":"..."}
  "id" is an issue number or issue URL. Without --apply, sync only previews.

gh runs with an allowlisted environment: its own GH_*/GITHUB_* host and token
variables, PATH, home, locale, proxy and CA settings. Other variables never reach it.

Examples:
  ${CLI_COMMAND} sync tracker github inspect --json
  ${CLI_COMMAND} sync tracker github sync --input ops.json --json
  ${CLI_COMMAND} sync tracker github sync --input - --apply --json < ops.json
  ${CLI_COMMAND} sync tracker local inspect`;

function plural(count: number): string {
  return `${count} issue change${count === 1 ? '' : 's'}`;
}

function operationLine(result: GitHubOperationResult): string[] {
  const target = [
    result.id ? `#${result.id}` : '',
    result.title !== undefined ? JSON.stringify(result.title) : '',
  ]
    .filter(Boolean)
    .join(' ');
  const line = `  ${result.status}  ${result.action}  ${target}${result.url && !result.title ? ` ${result.url}` : ''}`;
  return result.error ? [line, `    ${result.error.code}: ${result.error.problem}`] : [line];
}

function render(result: SyncTrackerSuccess | SyncTrackerIncomplete): void {
  if ('roots' in result)
    display.line(
      result.configured
        ? `Local planning roots: ${result.roots.join(', ')}`
        : 'No local planning root is configured.',
    );
  else if ('repository' in result) {
    const { nameWithOwner, url } = result.repository as { nameWithOwner?: string; url?: string };
    display.line(`GitHub repository: ${nameWithOwner ?? 'unknown'}${url ? ` (${url})` : ''}`);
  } else {
    const applied = result.results.filter(({ status }) => status === 'applied').length;
    display.line(
      result.applied
        ? `GitHub sync: ${applied} of ${plural(result.results.length)} applied`
        : `GitHub sync preview: ${plural(result.results.length)}, nothing applied`,
    );
    for (const operation of result.results)
      for (const line of operationLine(operation)) display.line(line);
  }
  display.line(
    result.ok
      ? `Next: ${result.next}`
      : `${result.code}: ${result.problem}\nNext: ${result.recovery}`,
  );
}

/** Registers `sync tracker` under the `sync` command. */
export function registerSyncTrackerCommand(sync: Command, program: Command): void {
  sync
    .command('tracker')
    .description('Inspect a tracker, or preview and apply GitHub issue changes through gh')
    .argument(
      '<provider>',
      `${SYNC_TRACKER_PROVIDERS.join(' or ')} (Linear uses the coding agent's connection)`,
    )
    .argument('<action>', SYNC_TRACKER_ACTIONS.join(' or '))
    .option('--input <path>', 'JSON array of GitHub issue operations; - reads stdin')
    .option('--apply', 'run the operations; without it, sync only previews', false)
    .option('--json', 'machine-readable output', false)
    .addHelpText('after', HELP)
    .action(async (provider: string, action: string, options: TrackerOptions) => {
      const json = Boolean(options.json);
      try {
        const result = await runSyncTracker({
          provider,
          action,
          input: options.input,
          apply: Boolean(options.apply),
          projectDir: program.opts().projectDir as string,
          stdin: process.stdin,
          env: process.env,
        });
        if (json) display.line(JSON.stringify(result, null, 2));
        else render(result);
        if (!result.ok) process.exitCode = 1;
      } catch (error) {
        const failure = toCliFailureEnvelope(error, { code: 'E_SYNC_TRACKER_FAILED' });
        if (json) display.line(JSON.stringify(failure, null, 2));
        else
          display.line(
            `${failure.code}: ${failure.problem}${failure.recovery ? `\nNext: ${failure.recovery}` : ''}`,
          );
        process.exitCode = 1;
      }
    });
}
