import path from 'node:path';
import type { OpenPlanrConfig } from '../models/types.js';
import { fileExists, readFile, writeFile } from '../utils/fs.js';
import { renderTemplate } from './template-service.js';

const CHECKLIST_FILENAME = 'AGILE-DEVELOPMENT-GUIDE.md';

export interface ChecklistItem {
  index: number;
  activity: string;
  done: boolean;
  lineIndex: number;
}

export function getChecklistPath(projectDir: string, config: OpenPlanrConfig): string {
  return path.join(projectDir, config.outputPaths.agile, 'checklists', CHECKLIST_FILENAME);
}

export async function createChecklist(
  projectDir: string,
  config: OpenPlanrConfig,
): Promise<string> {
  const filePath = getChecklistPath(projectDir, config);
  const content = await renderTemplate(
    'checklists/agile-checklist.md.hbs',
    {
      projectName: config.projectName,
      agilePath: config.outputPaths.agile,
      date: new Date().toISOString().split('T')[0],
    },
    config.templateOverrides,
  );
  await writeFile(filePath, content);
  return filePath;
}

export async function readChecklist(
  projectDir: string,
  config: OpenPlanrConfig,
): Promise<string | null> {
  const filePath = getChecklistPath(projectDir, config);
  if (!(await fileExists(filePath))) return null;
  return readFile(filePath);
}

export async function resetChecklist(projectDir: string, config: OpenPlanrConfig): Promise<string> {
  return createChecklist(projectDir, config);
}

/**
 * Parse checklist markdown into structured items.
 * Matches table rows with `[ ]` or `[x]` in the Status column.
 */
export function parseChecklistItems(content: string): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match: | <number> | <activity> | <command/artifact> | [x] or [ ] |
    const match = line.match(/^\|\s*(\d+)\s*\|([^|]+)\|[^|]+\|\s*\[(x| )\]\s*\|/);
    if (match) {
      items.push({
        index: parseInt(match[1], 10),
        activity: match[2].trim(),
        done: match[3] === 'x',
        lineIndex: i,
      });
    }
  }

  return items;
}

/**
 * Toggle checklist items by their indices and return updated content.
 */
export function toggleChecklistItems(
  content: string,
  toggleIndices: Set<number>,
  items: ChecklistItem[],
): string {
  const lines = content.split('\n');

  for (const item of items) {
    if (toggleIndices.has(item.index)) {
      const newStatus = item.done ? '[ ]' : '[x]';
      lines[item.lineIndex] = lines[item.lineIndex].replace(/\[(x| )\]\s*\|$/, `${newStatus} |`);
    }
  }

  return lines.join('\n');
}

/**
 * Mark a checklist item as done by its index number.
 * No-op if the checklist doesn't exist or the item is already checked.
 */
export async function checkItem(
  projectDir: string,
  config: OpenPlanrConfig,
  itemIndex: number,
): Promise<void> {
  const content = await readChecklist(projectDir, config);
  if (!content) return;

  const items = parseChecklistItems(content);
  const item = items.find((i) => i.index === itemIndex);
  if (!item || item.done) return;

  const updated = toggleChecklistItems(content, new Set([itemIndex]), items);
  await writeFile(getChecklistPath(projectDir, config), updated);
}

/**
 * Get checklist completion progress.
 */
export function getChecklistProgress(items: ChecklistItem[]): {
  done: number;
  total: number;
  percent: number;
} {
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return { done, total, percent };
}
