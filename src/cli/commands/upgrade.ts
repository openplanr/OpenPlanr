import type { Command } from 'commander';
import { isNonInteractive } from '../../services/interactive-state.js';
import { runPendingMigrations } from '../../services/migration-registry.js';
import { promptConfirm } from '../../services/prompt-service.js';
import {
  executeCliHalfUpgrade,
  planCliUpgrade,
  reconcileInstalledTuple,
} from '../../services/upgrade-service.js';
import { display, logger } from '../../utils/logger.js';

/**
 * `planr upgrade` — reconcile the installed tuple against the published
 * compatible set (`status`) and, for the half the CLI owns, perform the npm
 * upgrade while prescribing the plugin half (`apply`). The `status` region is
 * T-002's; the `apply` region is T-003's.
 */
export function registerUpgradeCommand(program: Command, _cliVersion: string) {
  const upgrade = program
    .command('upgrade')
    .description('Reconcile the installed OpenPlanr tuple against the published compatible set');

  upgrade
    .command('status')
    .description('Report whether the installed tuple is aligned, upgradable, or incompatible')
    .option('--json', 'machine-readable output', false)
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const result = await reconcileInstalledTuple(projectDir);

      if (opts.json) {
        display.line(JSON.stringify(result));
      } else {
        logger.heading('OpenPlanr upgrade status');
        display.keyValue('Reconciliation', result.status);
        display.keyValue('Manifest source', result.ecosystemSource);
        display.keyValue('Installed CLI', result.installed.cli);
        display.keyValue('Installed skills plugin', result.installed.skills ?? 'not installed');
        display.keyValue('Installed pipeline plugin', result.installed.pipeline ?? 'not installed');
        if (result.published) {
          display.keyValue('Published CLI', result.published.cli.version);
          display.keyValue('Published skills', result.published.skills.version);
          display.keyValue('Published pipeline', result.published.pipeline.version);
        }
        if (result.status === 'unknown') {
          logger.warn(
            'The published compatibility manifest is unavailable (offline); the tuple could not be judged.',
          );
        } else if (result.status === 'upgrade-available') {
          logger.info('An upgrade is available; the installed tuple is still mutually compatible.');
        } else if (result.status === 'incompatible') {
          logger.warn('The installed components are on mutually incompatible versions.');
        } else {
          logger.success('The installed tuple matches the published compatible set.');
        }
      }

      if (result.status === 'incompatible') process.exitCode = 1;
    });

  // ---- T-003: apply -------------------------------------------------------
  upgrade
    .command('apply')
    .description('Upgrade the npm CLI half and prescribe the exact plugin-half commands to run')
    .option('--yes', 'proceed with the upgrade without an interactive confirmation', false)
    .option('--json', 'machine-readable output', false)
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const reconciliation = await reconcileInstalledTuple(projectDir);
      const plan = planCliUpgrade(reconciliation);

      // Nothing to execute: aligned, unknown, or an incompatibility the CLI half
      // cannot resolve. Report the reason; there is no upgrade to prescribe.
      if (!plan.proceed || !plan.targetCliVersion) {
        if (opts.json) {
          display.line(JSON.stringify({ applied: false, reason: plan.reason, reconciliation }));
        } else {
          logger.heading('OpenPlanr upgrade');
          logger.info(plan.reason);
        }
        if (reconciliation.status === 'incompatible') process.exitCode = 1;
        return;
      }

      // The npm install is the one state-mutating action here. Refuse to mutate
      // unattended without an explicit `--yes`.
      const approved = opts.yes || (program.opts().yes as boolean | undefined) === true;
      if (!approved && isNonInteractive()) {
        const message = `An upgrade to ${plan.targetCliVersion} is available. Re-run \`planr upgrade apply --yes\` to proceed.`;
        if (opts.json) {
          display.line(JSON.stringify({ applied: false, reason: message, reconciliation }));
        } else {
          logger.heading('OpenPlanr upgrade');
          logger.warn(message);
        }
        return;
      }
      const confirmed =
        approved ||
        (await promptConfirm(`Upgrade the OpenPlanr CLI to ${plan.targetCliVersion}?`, true));
      if (!confirmed) {
        if (opts.json) {
          display.line(JSON.stringify({ applied: false, reason: 'declined', reconciliation }));
        } else {
          logger.info('Upgrade declined; nothing changed.');
        }
        return;
      }

      const result = await executeCliHalfUpgrade({
        projectDir,
        targetCliVersion: plan.targetCliVersion,
        // FR7: after the CLI half verifies, run the migrations this upgrade
        // crosses. This is the seam that makes the registry reachable end to end.
        migrationRunner: runPendingMigrations,
      });

      if (opts.json) {
        display.line(JSON.stringify(result));
      } else {
        logger.heading('OpenPlanr upgrade');
        if (result.ok) {
          logger.success(`CLI upgraded to ${result.installedVersion}.`);
          if (result.changelogBullets.length > 0) {
            display.blank();
            display.heading("What's new");
            for (const bullet of result.changelogBullets) display.bullet(bullet);
          } else {
            logger.dim('No changelog entries were found for this range.');
          }
          display.blank();
          display.heading('Plugin half — the CLI cannot install host plugins');
          if (result.pluginHalfCommands.length > 0) {
            logger.info(
              'Run these yourself, in order (the first refreshes the marketplace so the installer does not reinstall the stale version), or ask the agent to run planr-doctor’s upgrade skill:',
            );
            result.pluginHalfCommands.forEach((command, index) => {
              display.numbered(index + 1, command);
            });
          } else {
            logger.dim(
              'The Claude host was not detected, so there is no plugin half to prescribe here.',
            );
          }
        } else {
          logger.error(result.failure?.message ?? 'The upgrade did not complete.');
          if (result.restoredTo) {
            logger.info(`Restored the previous version ${result.restoredTo}.`);
          }
        }
      }

      if (!result.ok) process.exitCode = 1;
    });
}
