import type { ArtifactFrontmatter } from '../models/types.js';
/** A single line from an OpenPlanr/Linear task list (`- [x] **1.0** ...`). */
export interface TaskCheckboxLine {
    id: string;
    title: string;
    done: boolean;
    parentId: string | null;
    depth: number;
    lineIndex: number;
    /** The full text of the line (including leading whitespace). */
    lineText: string;
}
export interface ParsedMarkdown {
    data: ArtifactFrontmatter;
    content: string;
}
export declare function parseMarkdown(raw: string): ParsedMarkdown;
export declare function toMarkdownWithFrontmatter(data: ArtifactFrontmatter, content: string): string;
/**
 * Parse OpenPlanr task list checkbox lines (same format as `parseTaskMarkdown` in `task-parser.ts`).
 * Exposes 0-based `lineIndex` (the array index into `content.split('\n')`).
 */
export declare function parseTaskCheckboxLines(content: string): TaskCheckboxLine[];
/** Serialize a reconciled id→done map: `1.0:1,1.1:0,2.0:1` (ids sorted with numeric sort). */
export declare function serializeTaskCheckboxReconciled(m: ReadonlyMap<string, boolean> | Readonly<Record<string, boolean>>): string;
export declare function parseTaskCheckboxReconciled(s: string | undefined): Map<string, boolean>;
/**
 * Apply new done states to matching `N.M` task lines; preserves non-matching lines and all other text.
 */
export declare function applyTaskCheckboxStateMap(content: string, idToDone: ReadonlyMap<string, boolean>): string;
/**
 * Flip every `N.M` task checkbox in `content` to a single state. Preserves
 * line structure, indentation, ids, titles, and every non-checkbox line.
 *
 * Used by `--all-done` / `--all-pending` flags on artifact updates so users
 * can ship an artifact without hand-flipping each subtask.
 */
export declare function applyAllCheckboxes(content: string, done: boolean): string;
//# sourceMappingURL=markdown.d.ts.map