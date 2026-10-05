import { Command, CommanderError } from 'commander';
import type { OpenPlanrConfig } from '../models/types.js';
import {
  ConfigNotFoundError,
  findProjectRoot,
  foreignPlanningFolder,
  loadConfig,
} from '../services/config-service.js';
import { setNonInteractive } from '../services/interactive-state.js';
import { RuntimeManagerError } from '../services/runtime-manager-service.js';
import { maybeOfferUpgrade, upgradeOfferReachable } from '../services/upgrade-offer-service.js';
import { CLI_COMMAND } from '../utils/constants.js';
import { display, logger, setVerbose } from '../utils/logger.js';
import { OPENPLANR_VERSION } from '../utils/package-version.js';
import { registerCliCommands } from './commands/index.js';
import { toCliFailureEnvelope } from './error-boundary.js';

const version = OPENPLANR_VERSION;

const program = new Command();
program
  .name(CLI_COMMAND)
  .description('OpenPlanr deterministic utilities and integration CLI')
  .version(version)
  .option('--project-dir <path>', 'project root directory', findProjectRoot())
  .option('--verbose', 'verbose output', false)
  .option('--no-interactive', 'skip interactive prompts')
  .option('-y, --yes', 'auto-accept all prompts (alias for --no-interactive)');

/** The command whose action is running; unset until parsing succeeds. */
let actionCommand: Command | undefined;

/** Whether this invocation asked for machine-readable output. */
function jsonRequested(): boolean {
  // A parse failure leaves no option values, so only the raw `--json` token can decide.
  if (!actionCommand) return process.argv.includes('--json');
  for (let command: Command | null = actionCommand; command; command = command.parent) {
    if (command.opts().json === true) return true;
  }
  return false;
}

/** The top-level command, such as `upgrade` or `story`, that `command` belongs to. */
function topLevelCommandOf(command: Command): Command {
  let current = command;
  while (current.parent && current.parent !== program) current = current.parent;
  return current;
}

program.exitOverride();
program.configureOutput({
  writeOut(value) {
    process.stdout.write(value);
  },
  writeErr(value) {
    if (!jsonRequested()) process.stderr.write(value);
  },
});

/** Best-effort config load: outside a project (or with an invalid config) the
 * offer still runs on defaults, so a missing config never breaks a command. */
async function loadUpgradeConfig(projectDir: string): Promise<OpenPlanrConfig | null> {
  try {
    return await loadConfig(projectDir);
  } catch {
    return null;
  }
}

program.hook('preAction', async (_program, command) => {
  actionCommand = command;
  const json = jsonRequested();
  if (program.opts().verbose && !json) {
    setVerbose(true);
  }
  if (!program.opts().interactive || program.opts().yes || json) {
    setNonInteractive(true);
  }
  // Offer an available upgrade where the user already is. This is the
  // one seam every invocation already passes through. It is deliberately skipped
  // for the `upgrade` command (which owns its own flow), and for any
  // non-interactive invocation (`upgradeOfferReachable()` reduces to
  // `!isNonInteractive()` in production) so machine-readable output is never
  // corrupted. A durable snooze/never-ask inside `maybeOfferUpgrade`
  // short-circuits before any reconcile, so a command that already declined pays
  // no network cost; `maybeOfferUpgrade` fails open and never throws.
  if (topLevelCommandOf(command).name() !== 'upgrade' && upgradeOfferReachable()) {
    const projectDir = program.opts().projectDir as string;
    const config = await loadUpgradeConfig(projectDir);
    await maybeOfferUpgrade(projectDir, config);
  }
});

registerCliCommands(program, version);

program.parseAsync(process.argv).catch((err) => {
  const json = jsonRequested();
  if (err instanceof CommanderError) {
    if (json) {
      display.line(
        JSON.stringify(
          toCliFailureEnvelope({
            code: err.code,
            message: err.message.replace(/^error:\s*/u, ''),
          }),
        ),
      );
    }
    process.exitCode = err.exitCode;
    return;
  }
  logger.debug('The command failed:', err);
  if (err instanceof ConfigNotFoundError)
    err = foreignPlanningFolder(program.opts().projectDir as string) ?? err;
  if (err instanceof ConfigNotFoundError) {
    if (json) {
      display.line(
        JSON.stringify(
          toCliFailureEnvelope(err, {
            code: 'E_PROJECT_NOT_FOUND',
            problem: 'No OpenPlanr project was found.',
          }),
        ),
      );
      process.exitCode = 1;
      return;
    }
    display.line('');
    logger.warn('No OpenPlanr project found in this directory.');
    display.line('');
    display.line(`  Run \`${CLI_COMMAND} init\` to get started.`);
    display.line('');
    process.exitCode = 1;
    return;
  }
  if (
    err instanceof RuntimeManagerError ||
    String(err?.name).startsWith('E_') ||
    String(err?.code).startsWith('E_')
  ) {
    const value = toCliFailureEnvelope(err);
    if (json) display.line(JSON.stringify(value));
    else {
      logger.error(`${value.code}: ${value.problem}`);
      for (const diagnostic of value.diagnostics ?? []) {
        display.line(`  ${diagnostic.path}: ${diagnostic.detail}`);
      }
      if (value.recovery) display.line(`  ${value.recovery}`);
    }
    process.exitCode = 1;
    return;
  }
  const value = toCliFailureEnvelope(err);
  if (json) display.line(JSON.stringify(value));
  else logger.error(`${value.code}: ${value.problem}`);
  process.exitCode = 1;
});
