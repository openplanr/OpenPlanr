import path from 'node:path';
import { readFile, writeFile } from '../utils/fs.js';
import { renderTemplate } from './template-service.js';
const CHECKLIST_FILENAME = 'AGILE-DEVELOPMENT-GUIDE.md';
/** Checklist item indices matching the agile-checklist template. */
export const CHECKLIST = {
    CREATE_EPIC: 1,
    CREATE_FEATURES: 2,
    CREATE_STORIES: 3,
    CREATE_TASKS: 10,
};
export function getChecklistPath(projectDir, config) {
    return path.join(projectDir, config.outputPaths.agile, 'checklists', CHECKLIST_FILENAME);
}
export async function createChecklist(projectDir, config) {
    const filePath = getChecklistPath(projectDir, config);
    const content = await renderTemplate('checklists/agile-checklist.md.hbs', {
        projectName: config.projectName,
        agilePath: config.outputPaths.agile,
        date: new Date().toISOString().split('T')[0],
    }, config.templateOverrides);
    await writeFile(filePath, content);
    return filePath;
}
export async function readChecklist(projectDir, config) {
    try {
        return await readFile(getChecklistPath(projectDir, config));
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
export async function resetChecklist(projectDir, config) {
    return createChecklist(projectDir, config);
}
/**
 * Parse checklist markdown into structured items.
 * Matches table rows with `[ ]` or `[x]` in the Status column.
 */
export function parseChecklistItems(content) {
    const items = [];
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
export function toggleChecklistItems(content, toggleIndices, items) {
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
export async function checkItem(projectDir, config, itemIndex) {
    const content = await readChecklist(projectDir, config);
    if (!content)
        return;
    const items = parseChecklistItems(content);
    const item = items.find((i) => i.index === itemIndex);
    if (!item || item.done)
        return;
    const updated = toggleChecklistItems(content, new Set([itemIndex]), items);
    await writeFile(getChecklistPath(projectDir, config), updated);
}
/**
 * Get checklist completion progress.
 */
export function getChecklistProgress(items) {
    const total = items.length;
    const done = items.filter((i) => i.done).length;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return { done, total, percent };
}
//# sourceMappingURL=checklist-service.js.map