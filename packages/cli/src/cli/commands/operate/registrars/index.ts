import type { Command } from 'commander';
import {
  registerAssignmentDiagnosticCommands,
  registerAssignmentPacketCommands,
} from './assignments.js';
import { registerDomainCatalogCommand } from './catalog.js';
import type { OperateCommandRegistrationDependencies } from './contracts.js';
import { registerDashboardCommand } from './dashboard.js';
import { registerExperienceCommands } from './experience.js';
import { registerLifecycleCommands } from './lifecycle.js';
import { registerMeasurementCommands } from './measurement.js';
import { registerOperateNoteValidationCommand } from './note-validation.js';
import { registerPlanningCommands } from './planning.js';
import { registerRecoveryCommands } from './recovery.js';
import { registerArtifactAndReviewCommands } from './reviews.js';

/** The single ordered composition boundary for the public `planr operate` grammar. */
export function registerOperateCommandDefinition(
  program: Command,
  dependencies: OperateCommandRegistrationDependencies,
): void {
  const operate = program
    .command('operate')
    .description('Run and resume the durable OpenPlanr Operate lifecycle');
  registerDomainCatalogCommand(operate, dependencies);
  registerOperateNoteValidationCommand(operate, dependencies);
  registerDashboardCommand(program, operate, dependencies);
  registerLifecycleCommands(program, operate, dependencies);
  registerPlanningCommands(program, operate, dependencies);
  registerAssignmentPacketCommands(program, operate, dependencies);
  registerAssignmentDiagnosticCommands(program, operate, dependencies);
  registerArtifactAndReviewCommands(program, operate, dependencies);
  registerMeasurementCommands(program, operate, dependencies);
  registerExperienceCommands(program, operate, dependencies);
  registerRecoveryCommands(program, operate, dependencies);
}
