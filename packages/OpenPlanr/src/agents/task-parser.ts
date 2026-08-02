import { parseTaskCheckboxLines } from '../utils/markdown.js';

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
export function parseTaskMarkdown(content: string): ParsedSubtask[] {
  return parseTaskCheckboxLines(content).map(
    ({ id, title, done, parentId, depth }): ParsedSubtask => ({
      id,
      title,
      done,
      parentId,
      depth,
    }),
  );
}

/**
 * Find subtasks matching a query.
 *
 * - Exact ID match: "2.1" → single subtask
 * - Group match: "2.0" → group + all its subtasks
 * - Keyword search: "auth" → fuzzy match on titles
 */
export function findSubtasks(tasks: ParsedSubtask[], query: string): ParsedSubtask[] {
  // Try exact ID match
  const exactMatch = tasks.filter((t) => t.id === query);
  if (exactMatch.length > 0) {
    // If it's a group (x.0), include its children
    const isGroup = query.endsWith('.0');
    if (isGroup) {
      const groupNum = query.split('.')[0];
      return tasks.filter((t) => t.id.startsWith(`${groupNum}.`));
    }
    return exactMatch;
  }

  // Fuzzy keyword search
  const lowerQuery = query.toLowerCase();
  return tasks.filter((t) => t.title.toLowerCase().includes(lowerQuery));
}

/**
 * Get the next pending (unchecked) subtask.
 */
export function getNextPending(tasks: ParsedSubtask[]): ParsedSubtask | null {
  return tasks.find((t) => !t.done && t.depth > 0) || tasks.find((t) => !t.done) || null;
}

/**
 * Format subtasks for display in the terminal.
 */
export function formatSubtaskList(tasks: ParsedSubtask[], highlightId?: string): string {
  return tasks
    .map((t) => {
      const checkbox = t.done ? '[x]' : '[ ]';
      const indent = t.depth > 0 ? '  ' : '';
      const marker = t.id === highlightId ? ' ← TARGET' : '';
      return `${indent}- ${checkbox} ${t.id} ${t.title}${marker}`;
    })
    .join('\n');
}
