/**
 * Splice `newBlockContent` into `existing` between managed-block markers
 * identified by `markerName`.
 *
 * - Markers exist → replace only the content between them (markers kept).
 * - No markers (or orphan begin without end) → append at end with markers.
 * - Content outside markers is never modified.
 * - Idempotent: splicing the same content twice yields identical output.
 */
export declare function spliceManagedBlock(existing: string, markerName: string, newBlockContent: string): string;
//# sourceMappingURL=splice-managed-block.d.ts.map