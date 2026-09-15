import type { Command } from 'commander';
import { registerArtifactCommand } from '../artifact.js';
import { registerCompanyCommand } from '../company.js';
import { registerDashboardCommand } from '../dashboard.js';
import { registerDiagramCommand } from '../diagram/index.js';
import { registerLandCommand } from '../land.js';
import { registerLinearCommand } from '../linear.js';
import { registerOperateCommand } from '../operate.js';

export function registerOperationsCommands(program: Command): void {
  registerArtifactCommand(program);
  registerCompanyCommand(program);
  registerDashboardCommand(program);
  registerDiagramCommand(program);
  registerLinearCommand(program);
  registerOperateCommand(program);
  registerLandCommand(program);
}
