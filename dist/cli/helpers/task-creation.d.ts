/**
 * Shared helpers for task creation commands (quick + task).
 *
 * Both `planr quick` and `planr task` follow the same AI-powered workflow:
 *   1. Display a preview of AI-generated task groups / subtasks
 *   2. Show post-generation validation warnings
 *   3. Map AI output to artifact-ready task items
 *   4. Display "next steps" after successful creation
 *   5. Handle AI errors uniformly
 *
 * This module extracts those shared patterns so the command files
 * stay focused on their unique orchestration logic.
 */
import type { CodebaseContext } from '../../ai/codebase/index.js';
export interface TaskGroup {
    id: string;
    title: string;
    subtasks?: Array<{
        id: string;
        title: string;
    }>;
}
export interface AcceptanceCriteriaMapping {
    criterion: string;
    sourceStoryId: string;
    taskIds: string[];
}
export interface RelevantFile {
    path: string;
    reason: string;
    action: 'modify' | 'create';
}
export interface TaskPreviewData {
    tasks: TaskGroup[];
    acceptanceCriteriaMapping?: AcceptanceCriteriaMapping[];
    relevantFiles?: RelevantFile[];
}
/**
 * Render a preview of AI-generated task groups and subtasks.
 *
 * Optionally shows acceptance-criteria mapping (task-from-story mode)
 * and relevant files (both modes).
 */
export declare function displayTaskPreview(result: TaskPreviewData): void;
/**
 * Run post-generation validation on relevant files and display any warnings.
 * Best-effort — silently swallows errors so the main flow is never interrupted.
 */
export declare function displayValidationWarnings(relevantFiles: RelevantFile[] | undefined, rawContext: CodebaseContext | undefined): Promise<void>;
/**
 * Convert the AI response task groups into the shape expected by the
 * artifact template (with `status` and nested `subtasks`).
 */
export declare function buildTaskItems(result: {
    tasks: TaskGroup[];
}): {
    id: string;
    title: string;
    status: "pending";
    subtasks: {
        id: string;
        title: string;
        status: "pending";
        subtasks: never[];
    }[];
}[];
/**
 * Count total items (top-level tasks + subtasks) for confirmation prompts.
 */
export declare function countTaskItems(tasks: TaskGroup[]): number;
export interface NextStepsOptions {
    /** The CLI command group, e.g. 'quick' or 'task'. */
    command: 'quick' | 'task';
    /** The artifact ID, e.g. 'QT-001' or 'TASK-001'. */
    id: string;
    /** Extra lines to append (e.g. promote hint for quick tasks). */
    extras?: string[];
}
/**
 * Display the "Next steps" block after successful creation.
 */
export declare function displayNextSteps(opts: NextStepsOptions): void;
/**
 * Handle errors from AI generation calls.
 * Recognises `AIError` (shows `.userMessage`) and generic `Error`.
 * Re-throws anything else.
 */
export declare function handleAIError(err: unknown): Promise<void>;
//# sourceMappingURL=task-creation.d.ts.map