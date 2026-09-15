import type { Command } from 'commander';
import { registerSprintCommand } from '../sprint.js';
import { registerSyncCommand } from '../sync.js';
import { registerTemplateCommand } from '../template.js';
import { registerUpdateCommand } from '../update.js';
import { registerUpgradeCommand } from '../upgrade.js';

export function registerDeliveryCommands(program: Command, version: string): void {
  registerSprintCommand(program);
  registerSyncCommand(program);
  registerTemplateCommand(program);
  registerUpdateCommand(program);
  registerUpgradeCommand(program, version);
}
