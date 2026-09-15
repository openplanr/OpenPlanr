import type { Command } from 'commander';
import { registerDeliveryCommands } from './groups/delivery.js';
import { registerFoundationCommands } from './groups/foundation.js';
import { registerIntelligenceCommands } from './groups/intelligence.js';
import { registerOperationsCommands } from './groups/operations.js';
import { registerPlanningCommands } from './groups/planning.js';

/** The single composition boundary for the stable root command catalog. */
export function registerCliCommands(program: Command, version: string): void {
  registerFoundationCommands(program, version);
  registerOperationsCommands(program);
  registerPlanningCommands(program);
  registerIntelligenceCommands(program);
  registerDeliveryCommands(program, version);
}
