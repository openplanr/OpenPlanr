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
  const tasks: ParsedSubtask[] = [];
  const lines = content.split('\n');

  let currentGroupId: string | null = null;

  for (const line of lines) {
    // Match: - [x] **1.0** Task title  OR  - [x] 1.0 Task title  OR  - [ ] 1.1 Subtask title
    const match = line.match(/^(\s*)- \[(x| )\]\s+\*{0,2}(\d+\.\d+)\*{0,2}\s+(.+)$/);
    if (!match) continue;

    const indent = match[1].length;
    const done = match[2] === 'x';
    const id = match[3];
    const title = match[4].trim();
    const depth = indent > 0 ? 1 : 0;

    if (depth === 0) {
      currentGroupId = id;
    }

    tasks.push({
      id,
      title,
      done,
      parentId: depth === 0 ? null : currentGroupId,
      depth,
    });
  }

  return tasks;
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
