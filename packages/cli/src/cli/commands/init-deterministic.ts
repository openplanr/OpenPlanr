import path from 'node:path';
import { type Command, Option } from 'commander';
import { createChecklist } from '../../services/checklist-service.js';
import {
  applyConfigRepair,
  assertPlanningFolderWritable,
  createDefaultConfig,
  planConfigRepair,
  saveConfig,
} from '../../services/config-service.js';
import { promptConfirm } from '../../services/prompt-service.js';
import { getSpecsRootDir } from '../../services/spec-service.js';
import { renderTemplate } from '../../services/template-service.js';
import { ARTIFACT_DIRS, CLI_COMMAND, CONFIG_FILENAME } from '../../utils/constants.js';
import { ensureDir, fileExists, writeFile } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { CliBoundaryError } from '../error-boundary.js';

async function repairConfig(projectDir: string): Promise<void> {
  const plan = await planConfigRepair(projectDir);
  if (plan.status === 'valid') {
    logger.info(`Nothing to repair: ${CONFIG_FILENAME} is valid.`);
    return;
  }
  logger.info(`${CONFIG_FILENAME} is missing required fields. The repair will add:`);
  for (const line of plan.preview) logger.info(`  ${line}`);
  if (!(await promptConfirm(`Add these fields to ${CONFIG_FILENAME}?`))) {
    logger.info(`Repair cancelled; ${CONFIG_FILENAME} is unchanged.`);
    return;
  }
  await applyConfigRepair(projectDir, plan);
  logger.success(`Repaired ${CONFIG_FILENAME}.`);
}

export function registerInitCommand(program: Command) {
  program
    .command('init')
    .description('Initialize deterministic OpenPlanr project storage')
    .option('--name <name>', 'project name')
    .option('--force', 'replace the existing project configuration')
    .addOption(
      new Option(
        '--repair',
        'add missing required fields to the existing configuration, keeping every other setting',
      ).conflicts('force'),
    )
    .addOption(
      new Option('--no-ai', 'deprecated no-op; initialization is always deterministic').hideHelp(),
    )
    .addOption(
      new Option('-y, --yes', 'deprecated no-op retained for script compatibility').hideHelp(),
    )
    .action(async (options: { name?: string; force?: boolean; repair?: boolean }) => {
      const projectDir = program.opts().projectDir as string;
      if (options.repair) {
        await repairConfig(projectDir);
        return;
      }
      const configPath = path.join(projectDir, CONFIG_FILENAME);
      if ((await fileExists(configPath)) && !options.force) {
        throw new CliBoundaryError(
          'E_ALREADY_INITIALIZED',
          `OpenPlanr is already initialized: ${CONFIG_FILENAME} exists.`,
          {
            recovery: `Run \`${CLI_COMMAND} init --repair\` to add missing fields and keep your settings, or \`${CLI_COMMAND} init --force\` to replace the configuration.`,
          },
        );
      }
      assertPlanningFolderWritable(projectDir);
      const projectName = options.name?.trim() || path.basename(projectDir);
      const config = createDefaultConfig(projectName);
      const agileDir = path.join(projectDir, config.outputPaths.agile);
      for (const directory of Object.values(ARTIFACT_DIRS))
        await ensureDir(path.join(agileDir, directory));
      await ensureDir(path.join(agileDir, 'diagrams'));
      if (config.idPrefix.spec) await ensureDir(getSpecsRootDir(projectDir, config));
      await saveConfig(projectDir, config);
      await createChecklist(projectDir, config);
      const estimationPath = path.join(agileDir, 'ESTIMATION.md');
      if (!(await fileExists(estimationPath))) {
        await writeFile(estimationPath, await renderTemplate('guides/estimation.md.hbs', {}));
      }
      logger.success(`Initialized ${projectName} at ${config.outputPaths.agile}/.`);
      logger.info('Install a host plugin for agent-led Plan, Spec, and Ship workflows.');
    });
}
