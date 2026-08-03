/**
 * Parses task list markdown files to extract subtask structure.
 *
 * Supports addressing subtasks by:
 * - ID (e.g., "2.1")
 * - Group ID (e.g., "2.0" returns the group + all subtasks)
 * - Keyword search (e.g., "auth" fuzzy-matches against titles)
 * - Next pending (returns the first unchecked subtask)
 */
export interface ParsedSubtask {
    id: string;
    title: string;
    done: boolean;
    parentId: string | null;
    depth: number;
}
/**
 * Parse a task list markdown file into structured subtasks.
 * Expected format:
 *   `- [x] **1.0** Task title`  (bold group IDs)
 *   `- [x] 1.0 Task title`     (plain group IDs)
 *   `  - [ ] 1.1 Subtask title` (indented subtasks)
 */
export declare function parseTaskMarkdown(content: string): ParsedSubtask[];
/**
 * Find subtasks matching a query.
 *
 * - Exact ID match: "2.1" → single subtask
 * - Group match: "2.0" → group + all its subtasks
 * - Keyword search: "auth" → fuzzy match on titles
 */
export declare function findSubtasks(tasks: ParsedSubtask[], query: string): ParsedSubtask[];
/**
 * Get the next pending (unchecked) subtask.
 */
export declare function getNextPending(tasks: ParsedSubtask[]): ParsedSubtask | null;
/**
 * Format subtasks for display in the terminal.
 */
export declare function formatSubtaskList(tasks: ParsedSubtask[], highlightId?: string): string;
//# sourceMappingURL=task-parser.d.ts.map