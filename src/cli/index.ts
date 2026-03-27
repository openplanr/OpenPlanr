import { Command } from 'commander';
import { setVerbose } from '../utils/logger.js';
import { registerInitCommand } from './commands/init.js';
import { registerEpicCommand } from './commands/epic.js';
import { registerFeatureCommand } from './commands/feature.js';
import { registerStoryCommand } from './commands/story.js';
import { registerTaskCommand } from './commands/task.js';
import { registerChecklistCommand } from './commands/checklist.js';
import { registerRulesCommand } from './commands/rules.js';
import { registerStatusCommand } from './commands/status.js';
import { registerConfigCommand } from './commands/config.js';
import { registerRefineCommand } from './commands/refine.js';
import { registerPlanCommand } from './commands/plan.js';
import { registerSyncCommand } from './commands/sync.js';

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
registerEpicCommand(program);
registerFeatureCommand(program);
registerStoryCommand(program);
registerTaskCommand(program);
registerChecklistCommand(program);
registerRulesCommand(program);
registerStatusCommand(program);
registerConfigCommand(program);
registerRefineCommand(program);
registerPlanCommand(program);
registerSyncCommand(program);

program.parse(process.argv);
