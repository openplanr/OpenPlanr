/**
 * Composes rich implementation prompts for coding agents.
 *
 * Assembles a structured prompt from:
 * 1. Target subtask details
 * 2. Full task list context (what's done, what's next)
 * 3. Parent story and feature context
 * 4. Codebase context (tech stack, folder tree, related files)
 *
 * The output is a detailed markdown prompt that any coding agent
 * (Claude, Cursor, Codex) can understand and act on.
 */
import type { ParsedSubtask } from './task-parser.js';
export interface ImplementationContext {
    taskId: string;
    taskTitle: string;
    taskContent: string;
    targetSubtasks: ParsedSubtask[];
    allSubtasks: ParsedSubtask[];
    storyContent?: string;
    featureContent?: string;
    epicContent?: string;
    codebaseContext?: string;
}
/**
 * Compose a complete implementation prompt from gathered context.
 * Returns a markdown string ready to be sent to a coding agent.
 */
export declare function composeImplementationPrompt(ctx: ImplementationContext): string;
//# sourceMappingURL=prompt-composer.d.ts.map