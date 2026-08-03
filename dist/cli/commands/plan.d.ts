/**
 * `planr plan` command.
 *
 * Full agile planning flow in a single command:
 *   Epic → Features → User Stories → Tasks
 *
 * Can start from any level:
 *   --epic EPIC-001    → generates features → stories → tasks
 *   --feature FEAT-001 → generates stories → tasks
 *   --story US-001     → generates tasks
 *   (no flag)          → creates epic first, then cascades
 */
import type { Command } from 'commander';
export declare function registerPlanCommand(program: Command): void;
//# sourceMappingURL=plan.d.ts.map