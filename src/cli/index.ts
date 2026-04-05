import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { ConfigNotFoundError } from '../services/config-service.js';
import { display, logger, setVerbose } from '../utils/logger.js';
import { registerBacklogCommand } from './commands/backlog.js';
import { registerChecklistCommand } from './commands/checklist.js';
import { registerConfigCommand } from './commands/config.js';
import { registerEpicCommand } from './commands/epic.js';
import { registerEstimateCommand } from './commands/estimate.js';
import { registerExportCommand } from './commands/export.js';
import { registerFeatureCommand } from './commands/feature.js';
import { registerGitHubCommand } from './commands/github.js';
import { registerInitCommand } from './commands/init.js';
import { registerPlanCommand } from './commands/plan.js';
import { registerQuickCommand } from './commands/quick.js';
import { registerRefineCommand } from './commands/refine.js';
import { registerRulesCommand } from './commands/rules.js';
import { registerSearchCommand } from './commands/search.js';
import { registerSprintCommand } from './commands/sprint.js';
import { registerStatusCommand } from './commands/status.js';
import { registerStoryCommand } from './commands/story.js';
import { registerSyncCommand } from './commands/sync.js';
import { registerTaskCommand } from './commands/task.js';
import { registerTemplateCommand } from './commands/template.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  // Try multiple relative paths to support both source (src/cli/) and compiled (dist/cli/) layouts
  for (const rel of ['../../package.json', '../../../package.json']) {
    const candidate = resolve(__dirname, rel);
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, 'utf-8'));
      if (typeof pkg.version === 'string') return pkg.version;
    }
  }
  return '0.0.0';
}
const version = readVersion();

const program = new Command();

program
  .name('planr')
  .description('AI-powered planning CLI — backlog, sprints, tasks, estimation, and AI agent rules')
  .version(version)
  .option('--project-dir <path>', 'project root directory', process.cwd())
  .option('--verbose', 'verbose output', false)
  .option('--no-interactive', 'skip interactive prompts');

program.hook('preAction', () => {
  if (program.opts().verbose) {
    setVerbose(true);
  }
});

registerInitCommand(program);
registerBacklogCommand(program);
registerEpicCommand(program);
registerFeatureCommand(program);
registerStoryCommand(program);
registerTaskCommand(program);
registerQuickCommand(program);
registerChecklistCommand(program);
registerRulesCommand(program);
registerStatusCommand(program);
registerConfigCommand(program);
registerRefineCommand(program);
registerEstimateCommand(program);
registerExportCommand(program);
registerGitHubCommand(program);
registerSearchCommand(program);
registerPlanCommand(program);
registerSprintCommand(program);
registerSyncCommand(program);
registerTemplateCommand(program);

program.parseAsync(process.argv).catch((err) => {
  if (err instanceof ConfigNotFoundError) {
    display.line('');
    logger.warn('No OpenPlanr project found in this directory.');
    display.line('');
    display.line('  Run `planr init` to get started.');
    display.line('');
    process.exit(1);
  }
  throw err;
});
