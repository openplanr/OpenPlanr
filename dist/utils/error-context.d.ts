/**
 * Error context extraction and multi-line input utilities.
 *
 * Used by `planr task fix` to intelligently truncate verbose build/test
 * output down to the error-relevant portion before sending to an AI agent.
 */
/**
 * Extract only the error-relevant portion from verbose build output.
 *
 * - Input ≤ 150 lines → returned as-is
 * - Error marker found → keeps 20 lines of context before it + up to 130 after
 * - No marker found → keeps the last 150 lines (tail)
 */
export declare function extractErrorContext(raw: string): string;
/**
 * Read multi-line input from the terminal.
 *
 * The user types or pastes text and submits by pressing Enter on an
 * empty line (double Enter). Large pastes are automatically truncated
 * to the error-relevant portion.
 */
export declare function readMultilineInput(): Promise<string>;
//# sourceMappingURL=error-context.d.ts.map