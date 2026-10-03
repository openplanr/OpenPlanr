import type { Command } from 'commander';
import { registerDoctorCommand } from '../doctor.js';
import { registerInitCommand } from '../init-deterministic.js';
import { registerRuntimeCommand } from '../runtime.js';
import { registerServerCommand } from '../server.js';
import { registerSetupCommand } from '../setup.js';

export function registerFoundationCommands(program: Command, version: string): void {
  registerInitCommand(program);
  registerServerCommand(program);
  registerSetupCommand(program, version);
  registerDoctorCommand(program, version);
  registerRuntimeCommand(program, version);
}
