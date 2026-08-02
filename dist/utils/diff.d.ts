/**
 * Minimal line-based unified diff for revise preview.
 *
 * Implements a Wagner–Fischer LCS over lines, then prints hunks with
 * `+` / `-` prefixes. Not a general-purpose diff tool — scoped to small
 * planning artifacts (typically <1K lines), where O(m×n) time/memory is
 * comfortable. Line equality is exact after trimming trailing newlines.
 *
 * We don't pull in an npm diff library because (a) the algorithm is small,
 * (b) the format we emit is fixed and narrow, and (c) keeping the
 * dependency footprint tight is a stated project preference.
 */
export interface UnifiedDiffOptions {
    /** Number of unchanged context lines around each change. Default: 3. */
    context?: number;
    /** Labels printed on the file-header `---` / `+++` rows. */
    oldLabel?: string;
    newLabel?: string;
}
/**
 * Compute a unified diff between two strings. Empty string on either side
 * is valid. Trailing newlines are normalized so a file that ends in `\n`
 * does not spuriously diff against one that does not.
 */
export declare function unifiedDiff(oldText: string, newText: string, options?: UnifiedDiffOptions): string;
export interface ApplyDiffResult {
    ok: boolean;
    /** New content when ok=true. */
    result?: string;
    /** Human-readable reason when ok=false (mismatched context, malformed hunk, etc.). */
    error?: string;
    /** Zero-based index of the first hunk that failed, when ok=false. */
    failedHunkIndex?: number;
}
/**
 * Apply a unified diff to source text. Strict: every hunk's context and
 * removed lines must match the source exactly (after trailing-newline
 * normalization) or the entire apply fails. No fuzzing. This matches what
 * the revise replay path wants — "the diff we planned for is still valid"
 * is a binary question.
 *
 * Accepts the same format our own `unifiedDiff` emits (standard unified
 * with `---`/`+++` headers and `@@ -A,B +C,D @@` hunk markers) so a diff
 * round-trips through this pair without surprises.
 */
export declare function applyUnifiedDiff(source: string, diffText: string): ApplyDiffResult;
//# sourceMappingURL=diff.d.ts.map