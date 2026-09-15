import type { Command } from 'commander';
import type { CodingAgentName } from '../../models/types.js';
import { loadConfig, saveConfig } from '../../services/config-service.js';
import { promptSelect } from '../../services/prompt-service.js';
import {
  readSnoozeState,
  UPGRADE_REENABLE_COMMAND,
  writeSnoozeState,
} from '../../services/upgrade-offer-service.js';
import { display, logger } from '../../utils/logger.js';

export function registerConfigCommand(program: Command) {
  const command = program
    .command('config')
    .description('Manage deterministic OpenPlanr configuration');

  command
    .command('show')
    .description('Display current configuration')
    .action(async () => {
      const config = await loadConfig(program.opts().projectDir as string);
      logger.heading('OpenPlanr Configuration');
      display.line(`  Project:    ${config.projectName}`);
      display.line(`  Targets:    ${config.targets.join(', ')}`);
      display.line(`  Artifacts:  ${config.outputPaths.agile}/`);
      display.line(`  Agent:      ${config.defaultAgent ?? 'not selected'}`);
      display.blank();
      display.line('Semantic planning and implementation run in the active host agent.');
    });

  command
    .command('set-agent')
    .description('Set the preferred host for generated project guidance')
    .argument('[agent]', 'claude, cursor, or codex')
    .action(async (agent?: string) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      const selected =
        (agent as CodingAgentName | undefined) ??
        (await promptSelect<CodingAgentName>(
          'Host agent:',
          [
            { name: 'Claude Code', value: 'claude' },
            { name: 'Cursor', value: 'cursor' },
            { name: 'Codex', value: 'codex' },
          ],
          'codex',
        ));
      if (!['claude', 'cursor', 'codex'].includes(selected))
        throw new Error(`Unsupported host agent: ${selected}`);
      config.defaultAgent = selected;
      await saveConfig(projectDir, config);
      logger.success(`Host agent set to ${selected}.`);
    });

  command
    .command('set-upgrade-policy')
    .description('Configure upgrade checks')
    .option('--auto-upgrade <true|false>')
    .option('--update-check <true|false>')
    .option('--never-ask')
    .option('--ask-again')
    .action(
      async (options: {
        autoUpgrade?: string;
        updateCheck?: string;
        neverAsk?: boolean;
        askAgain?: boolean;
      }) => {
        const projectDir = program.opts().projectDir as string;
        let changed = false;
        if (options.askAgain) {
          await writeSnoozeState({ neverAsk: false, snoozeUntil: null, snoozeStage: 0 });
          logger.success('Upgrade prompts re-enabled on this machine.');
          changed = true;
        }
        if (options.neverAsk) {
          await writeSnoozeState({ ...readSnoozeState(), neverAsk: true, snoozeUntil: null });
          logger.success('Upgrade prompts disabled on this machine.');
          logger.info(`To re-enable them, run: ${UPGRADE_REENABLE_COMMAND}`);
          changed = true;
        }
        if (options.autoUpgrade !== undefined || options.updateCheck !== undefined) {
          const config = await loadConfig(projectDir);
          config.upgrade = {
            ...config.upgrade,
            ...(options.autoUpgrade !== undefined
              ? { autoUpgrade: parseBoolean(options.autoUpgrade, '--auto-upgrade') }
              : {}),
            ...(options.updateCheck !== undefined
              ? { updateCheck: parseBoolean(options.updateCheck, '--update-check') }
              : {}),
          };
          await saveConfig(projectDir, config);
          logger.success('Upgrade policy updated.');
          changed = true;
        }
        if (!changed) throw new Error('Provide an upgrade policy option.');
      },
    );
}

function parseBoolean(value: string, option: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${option} expects true or false.`);
}
