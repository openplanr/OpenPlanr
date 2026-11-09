import type { Command } from 'commander';
import { registerDelegateCommand } from '../delegate.js';
import { registerReleaseCommand } from '../release.js';
import { registerShipCommand } from '../ship.js';
import { registerSprintCommand } from '../sprint.js';
import { registerSyncCommand } from '../sync.js';
import { registerTemplateCommand } from '../template.js';
import { registerUpdateCommand } from '../update.js';
import { registerUpgradeCommand } from '../upgrade.js';

export function registerDeliveryCommands(program: Command, version: string): void {
  registerDelegateCommand(program);
  registerReleaseCommand(program);
  registerShipCommand(program);
  registerSprintCommand(program);
  registerSyncCommand(program);
  registerTemplateCommand(program);
  registerUpdateCommand(program);
  registerUpgradeCommand(program, version);
}
