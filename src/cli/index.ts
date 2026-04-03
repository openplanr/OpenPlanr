import { Command } from 'commander';
import { setVerbose } from '../utils/logger.js';
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

const program = new Command();

program
  .name('planr')
  .description('AI-powered agile planning CLI for Cursor, Claude Code, and Codex')
  .version('0.2.0')
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

program.parse(process.argv);
