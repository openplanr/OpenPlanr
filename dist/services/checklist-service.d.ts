import type { OpenPlanrConfig } from '../models/types.js';
/** Checklist item indices matching the agile-checklist template. */
export declare const CHECKLIST: {
    readonly CREATE_EPIC: 1;
    readonly CREATE_FEATURES: 2;
    readonly CREATE_STORIES: 3;
    readonly CREATE_TASKS: 10;
};
export interface ChecklistItem {
    index: number;
    activity: string;
    done: boolean;
    lineIndex: number;
}
export declare function getChecklistPath(projectDir: string, config: OpenPlanrConfig): string;
export declare function createChecklist(projectDir: string, config: OpenPlanrConfig): Promise<string>;
export declare function readChecklist(projectDir: string, config: OpenPlanrConfig): Promise<string | null>;
export declare function resetChecklist(projectDir: string, config: OpenPlanrConfig): Promise<string>;
/**
 * Parse checklist markdown into structured items.
 * Matches table rows with `[ ]` or `[x]` in the Status column.
 */
export declare function parseChecklistItems(content: string): ChecklistItem[];
/**
 * Toggle checklist items by their indices and return updated content.
 */
export declare function toggleChecklistItems(content: string, toggleIndices: Set<number>, items: ChecklistItem[]): string;
/**
 * Mark a checklist item as done by its index number.
 * No-op if the checklist doesn't exist or the item is already checked.
 */
export declare function checkItem(projectDir: string, config: OpenPlanrConfig, itemIndex: number): Promise<void>;
/**
 * Get checklist completion progress.
 */
export declare function getChecklistProgress(items: ChecklistItem[]): {
    done: number;
    total: number;
    percent: number;
};
//# sourceMappingURL=checklist-service.d.ts.map