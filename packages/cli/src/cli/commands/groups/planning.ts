import type { Command } from 'commander';
import { registerBacklogCommand } from '../backlog.js';
import { registerChecklistCommand } from '../checklist.js';
import { registerConfigCommand } from '../config-deterministic.js';
import { registerEpicCommand } from '../epic.js';
import { registerFeatureCommand } from '../feature.js';
import { registerQuickCommand } from '../quick.js';
import { registerRulesCommand } from '../rules.js';
import { registerSpecCommand } from '../spec.js';
import { registerStatusCommand } from '../status.js';
import { registerStoryCommand } from '../story.js';
import { registerTaskCommand } from '../task.js';

export function registerPlanningCommands(program: Command): void {
  registerBacklogCommand(program);
  registerEpicCommand(program);
  registerFeatureCommand(program);
  registerStoryCommand(program);
  registerTaskCommand(program);
  registerQuickCommand(program);
  registerSpecCommand(program);
  registerChecklistCommand(program);
  registerRulesCommand(program);
  registerStatusCommand(program);
  registerConfigCommand(program);
}
