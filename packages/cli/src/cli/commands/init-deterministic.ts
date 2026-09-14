import path from 'node:path';
import { type Command, Option } from 'commander';
import { createChecklist } from '../../services/checklist-service.js';
import { createDefaultConfig, saveConfig } from '../../services/config-service.js';
import { renderTemplate } from '../../services/template-service.js';
import { ARTIFACT_DIRS, CONFIG_FILENAME } from '../../utils/constants.js';
import { ensureDir, fileExists, writeFile } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';

export function registerInitCommand(program: Command) {
  program
    .command('init')
    .description('Initialize deterministic OpenPlanr project storage')
    .option('--name <name>', 'project name')
    .option('--force', 'replace the existing project configuration')
    .addOption(
      new Option('--no-ai', 'deprecated no-op; initialization is always deterministic').hideHelp(),
    )
    .addOption(
      new Option('-y, --yes', 'deprecated no-op retained for script compatibility').hideHelp(),
    )
    .action(async (options: { name?: string; force?: boolean }) => {
      const projectDir = program.opts().projectDir as string;
      const configPath = path.join(projectDir, CONFIG_FILENAME);
      if (await fileExists(configPath)) {
        if (!options.force)
          throw new Error(
            'OpenPlanr is already initialized; pass --force to replace its configuration.',
          );
      }
      const projectName = options.name?.trim() || path.basename(projectDir);
      const config = createDefaultConfig(projectName);
      const agileDir = path.join(projectDir, config.outputPaths.agile);
      for (const directory of Object.values(ARTIFACT_DIRS))
        await ensureDir(path.join(agileDir, directory));
      await ensureDir(path.join(agileDir, 'diagrams'));
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
