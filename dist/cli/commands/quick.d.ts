/**
 * `planr quick` command group.
 *
 * Standalone task lists without the full agile hierarchy.
 * Ideal for prototyping, bug fixes, hackathons, or any work
 * that doesn't need epics/features/stories.
 *
 * Quick tasks can later be promoted into the agile hierarchy
 * via `planr quick promote`.
 */
import type { Command } from 'commander';
import type { OpenPlanrConfig } from '../../models/types.js';
export declare function registerQuickCommand(program: Command): void;
export interface CreateQuickWithAIOptions {
    /** When true, use the larger token budget (for spec/PRD input). */
    fromFile?: boolean;
    /** Link the new QT to this epic (frontmatter `epicId`). */
    epicId?: string;
    /** Provenance: which BL-XXX this QT was promoted from (frontmatter `sourceBacklog`). */
    sourceBacklog?: string;
    /** Optional override of the heading shown in the CLI preview. */
    headingLabel?: string;
    /** Optional override for the confirm prompt text. */
    confirmLabel?: string;
}
export declare function createQuickWithAI(projectDir: string, config: OpenPlanrConfig, description: string, options?: CreateQuickWithAIOptions): Promise<{
    id: string;
    filePath: string;
} | undefined>;
//# sourceMappingURL=quick.d.ts.map