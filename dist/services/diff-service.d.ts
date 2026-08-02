/**
 * Colored diff preview for revise.
 *
 * Wraps the pure `unifiedDiff` utility with chalk formatting. The returned
 * string is what the CLI prints before asking the user to apply / skip /
 * edit / re-view / quit.
 */
import { type UnifiedDiffOptions } from '../utils/diff.js';
export interface RenderDiffOptions extends UnifiedDiffOptions {
    /** Set to false to skip ANSI color codes (useful for tests / non-TTY output). */
    color?: boolean;
}
/**
 * Produce a unified diff between `oldText` and `newText`, color-coded for
 * terminal display. Returns the empty string when the two are identical.
 */
export declare function renderDiff(oldText: string, newText: string, options?: RenderDiffOptions): string;
//# sourceMappingURL=diff-service.d.ts.map