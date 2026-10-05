import type { Command } from 'commander';
import { isNonInteractive } from '../../services/interactive-state.js';
import { runPendingMigrations } from '../../services/migration-registry.js';
import { promptConfirm } from '../../services/prompt-service.js';
import {
  printNextSteps,
  printReconciliationStatus,
  printUpgradeReport,
  type ReleaseNotesMode,
} from '../../services/upgrade-report.js';
import {
  executeCliHalfUpgrade,
  planCliUpgrade,
  reconcileInstalledTuple,
  upgradeNextSteps,
} from '../../services/upgrade-service.js';
import { CLI_COMMAND } from '../../utils/constants.js';
import { display, logger } from '../../utils/logger.js';

/**
 * `planr upgrade` — reconcile the installed tuple against the published
 * compatible set (`status`) and, for the half the CLI owns, perform the npm
 * upgrade, then list the command that updates each installed coding agent (`apply`).
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
      const nextSteps = await upgradeNextSteps(projectDir);

      if (opts.json) {
        display.line(JSON.stringify({ ...result, nextSteps }));
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
          display.keyValue('Published host package', result.published.skills.version);
          display.keyValue('Published pipeline', result.published.pipeline.version);
        }
        printReconciliationStatus(result);
        if (nextSteps.length > 0) printNextSteps(nextSteps);
      }

      if (result.status === 'incompatible') process.exitCode = 1;
    });

  // ---- apply --------------------------------------------------------------
  upgrade
    .command('apply')
    .description('Upgrade the OpenPlanr CLI and list the command that updates each coding agent')
    .option('--yes', 'proceed with the upgrade without an interactive confirmation', false)
    .option('--notes <mode>', "what's new: highlights or full", 'highlights')
    .option('--json', 'machine-readable output', false)
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      if (!['highlights', 'full'].includes(opts.notes)) {
        throw new Error(`--notes must be highlights or full, not "${opts.notes}".`);
      }
      const notes = opts.notes as ReleaseNotesMode;
      const reconciliation = await reconcileInstalledTuple(projectDir);
      const plan = planCliUpgrade(reconciliation);

      // Nothing for the CLI to install. The coding agents can still trail it, which is
      // what an incompatible tuple with a current CLI means, so their commands are listed.
      if (!plan.proceed || !plan.targetCliVersion) {
        const nextSteps = await upgradeNextSteps(projectDir);
        if (opts.json) {
          display.line(
            JSON.stringify({
              applied: false,
              reason: plan.reason,
              nextSteps,
              pluginHalfCommands: nextSteps.map((step) => step.command),
              reconciliation,
            }),
          );
        } else {
          logger.info(plan.reason);
          if (nextSteps.length > 0) printNextSteps(nextSteps);
        }
        if (reconciliation.status === 'incompatible') process.exitCode = 1;
        return;
      }

      // The npm install is the one state-mutating action here. Refuse to mutate
      // unattended without an explicit `--yes`.
      const approved = opts.yes || (program.opts().yes as boolean | undefined) === true;
      if (!approved && isNonInteractive()) {
        const message = `An upgrade to ${plan.targetCliVersion} is available. Re-run \`${CLI_COMMAND} upgrade apply --yes\` to proceed.`;
        if (opts.json) {
          display.line(JSON.stringify({ applied: false, reason: message, reconciliation }));
        } else {
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

      if (opts.json) display.line(JSON.stringify(result));
      else printUpgradeReport(result, notes);

      if (!result.ok) process.exitCode = 1;
    });
}
