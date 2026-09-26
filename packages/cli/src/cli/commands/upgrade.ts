import type { Command } from 'commander';
import { isNonInteractive } from '../../services/interactive-state.js';
import { runPendingMigrations } from '../../services/migration-registry.js';
import { promptConfirm } from '../../services/prompt-service.js';
import {
  executeCliHalfUpgrade,
  PLUGIN_HALF_INSTRUCTION,
  planCliUpgrade,
  pluginHalfPrescription,
  reconcileInstalledTuple,
} from '../../services/upgrade-service.js';
import { display, logger } from '../../utils/logger.js';

/**
 * `planr upgrade` — reconcile the installed tuple against the published
 * compatible set (`status`) and, for the half the CLI owns, perform the npm
 * upgrade while prescribing the plugin half (`apply`).
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
        display.keyValue('Bundled pipeline', result.bundledPipeline ?? 'not resolved');
        display.keyValue(
          'Installed host plugin (planr@openplanr-local)',
          result.installed.skills ?? 'not installed',
        );
        if (result.legacyPlugins && result.legacyPlugins.length > 0) {
          display.keyValue('Legacy plugins', result.legacyPlugins.join(', '));
        }
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

  // ---- apply --------------------------------------------------------------
  upgrade
    .command('apply')
    .description('Upgrade the npm CLI half and prescribe the exact plugin-half commands to run')
    .option('--yes', 'proceed with the upgrade without an interactive confirmation', false)
    .option('--json', 'machine-readable output', false)
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const reconciliation = await reconcileInstalledTuple(projectDir);
      const plan = planCliUpgrade(reconciliation);

      // Nothing for the CLI half to execute: aligned, unknown, or an incompatibility the
      // CLI cannot resolve. The last case is not "nothing to do" — it is the plugin half
      // trailing, and the reason string promises the commands, so they must actually be
      // printed here. The contract is unmet if this branch reports a promise and no prescription.
      if (!plan.proceed || !plan.targetCliVersion) {
        const pluginHalfCommands =
          reconciliation.status === 'incompatible' ? pluginHalfPrescription() : [];
        if (opts.json) {
          display.line(
            JSON.stringify({
              applied: false,
              reason: plan.reason,
              pluginHalfCommands,
              reconciliation,
            }),
          );
        } else {
          logger.heading('OpenPlanr upgrade');
          logger.info(plan.reason);
          if (pluginHalfCommands.length > 0) {
            display.blank();
            display.heading('Plugin half — the upgrade never changes Claude plugins itself');
            logger.info(PLUGIN_HALF_INSTRUCTION);
            pluginHalfCommands.forEach((command, index) => {
              display.numbered(index + 1, command);
            });
          }
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
        // After the CLI half verifies, run the migrations this upgrade
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
          display.heading('Plugin half — the upgrade never changes Claude plugins itself');
          if (result.pluginHalfCommands.length > 0) {
            logger.info(PLUGIN_HALF_INSTRUCTION);
            result.pluginHalfCommands.forEach((command, index) => {
              display.numbered(index + 1, command);
            });
          } else {
            logger.dim(
              'No Claude plugin commands were prescribed; run `planr doctor` to confirm the host plugin state.',
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
