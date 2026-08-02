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
import { formatSubtaskList } from './task-parser.js';
/**
 * Compose a complete implementation prompt from gathered context.
 * Returns a markdown string ready to be sent to a coding agent.
 */
export function composeImplementationPrompt(ctx) {
    const sections = [];
    // Header
    sections.push(`# Implementation Task: ${ctx.taskId}`);
    // Target subtask(s)
    if (ctx.targetSubtasks.length > 0) {
        sections.push('## Target Subtask(s)\n');
        sections.push('Implement ONLY the following subtask(s):');
        sections.push('');
        for (const st of ctx.targetSubtasks) {
            sections.push(`- **${st.id}**: ${st.title}`);
        }
        // Parent group context
        const parentId = ctx.targetSubtasks[0]?.parentId;
        if (parentId) {
            const parentGroup = ctx.allSubtasks.find((t) => t.id === parentId);
            if (parentGroup) {
                sections.push(`\nParent task group: **${parentGroup.id}** ${parentGroup.title}`);
            }
        }
    }
    // Full task list (shows what's done and what's pending)
    sections.push('\n## Full Task List\n');
    sections.push('```');
    const _targetIds = new Set(ctx.targetSubtasks.map((t) => t.id));
    const firstTargetId = ctx.targetSubtasks[0]?.id;
    sections.push(formatSubtaskList(ctx.allSubtasks, firstTargetId));
    sections.push('```');
    // Parent story context
    if (ctx.storyContent) {
        sections.push('\n## User Story Context\n');
        sections.push(truncate(ctx.storyContent, 3000));
    }
    // Parent feature context
    if (ctx.featureContent) {
        sections.push('\n## Feature Context\n');
        sections.push(truncate(ctx.featureContent, 2000));
    }
    // Parent epic context (brief)
    if (ctx.epicContent) {
        sections.push('\n## Epic Context (summary)\n');
        sections.push(truncate(ctx.epicContent, 1000));
    }
    // Codebase context
    if (ctx.codebaseContext) {
        sections.push('\n## Codebase Context\n');
        sections.push(ctx.codebaseContext);
    }
    // Instructions
    sections.push('\n## Instructions\n');
    sections.push('1. Implement ONLY the target subtask(s) listed above.');
    sections.push('2. Follow existing code patterns and conventions in the codebase.');
    sections.push('3. Write clean, well-documented code.');
    sections.push('4. Include appropriate error handling.');
    sections.push('5. Add or update tests for the changes.');
    sections.push('6. Do NOT modify code unrelated to the target subtask(s).');
    return sections.join('\n');
}
function truncate(text, maxChars) {
    if (text.length <= maxChars)
        return text;
    return `${text.slice(0, maxChars)}\n\n... (truncated)`;
}
//# sourceMappingURL=prompt-composer.js.map