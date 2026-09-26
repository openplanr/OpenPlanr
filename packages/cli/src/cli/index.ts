import { Command, CommanderError } from 'commander';
import type { OpenPlanrConfig } from '../models/types.js';
import { ConfigNotFoundError, findProjectRoot, loadConfig } from '../services/config-service.js';
import { setNonInteractive } from '../services/interactive-state.js';
import { RuntimeManagerError } from '../services/runtime-manager-service.js';
import { maybeOfferUpgrade, upgradeOfferReachable } from '../services/upgrade-offer-service.js';
import { display, logger, setVerbose } from '../utils/logger.js';
import { OPENPLANR_VERSION } from '../utils/package-version.js';
import { registerCliCommands } from './commands/index.js';
import { toCliFailureEnvelope } from './error-boundary.js';

const version = OPENPLANR_VERSION;

const program = new Command();
program
  .name('planr')
  .description('OpenPlanr deterministic utilities and integration CLI')
  .version(version)
  .option('--project-dir <path>', 'project root directory', findProjectRoot())
  .option('--verbose', 'verbose output', false)
  .option('--no-interactive', 'skip interactive prompts')
  .option('-y, --yes', 'auto-accept all prompts (alias for --no-interactive)');

program.exitOverride();
program.configureOutput({
  writeOut(value) {
    process.stdout.write(value);
  },
  writeErr(value) {
    if (!process.argv.includes('--json')) process.stderr.write(value);
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

program.hook('preAction', async () => {
  if (program.opts().verbose && !process.argv.includes('--json')) {
    setVerbose(true);
  }
  if (!program.opts().interactive || program.opts().yes || process.argv.includes('--json')) {
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
  if (!process.argv.includes('upgrade') && upgradeOfferReachable()) {
    const projectDir = program.opts().projectDir as string;
    const config = await loadUpgradeConfig(projectDir);
    await maybeOfferUpgrade(projectDir, config);
  }
});

registerCliCommands(program, version);

program.parseAsync(process.argv).catch((err) => {
  if (err instanceof CommanderError) {
    if (process.argv.includes('--json')) {
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
  if (err instanceof ConfigNotFoundError) {
    if (process.argv.includes('--json')) {
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
    display.line('  Run `planr init` to get started.');
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
    if (process.argv.includes('--json')) display.line(JSON.stringify(value));
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
  if (process.argv.includes('--json')) display.line(JSON.stringify(value));
  else logger.error(`${value.code}: ${value.problem}`);
  process.exitCode = 1;
});
