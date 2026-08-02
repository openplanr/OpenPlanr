/**
 * Merge generated planr content into an existing file using markers.
 * - If the file has existing markers, replace content between them.
 * - If the file exists but has no markers, append a marked section.
 * - If the file doesn't exist (null), return the full marked content.
 */
export declare function mergeWithMarkers(existingContent: string | null, newContent: string): string;
//# sourceMappingURL=rule-merge.d.ts.map