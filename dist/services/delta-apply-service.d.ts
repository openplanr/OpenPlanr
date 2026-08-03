/**
 * Apply structured deltas from AI refine to an artifact — replaces the
 * whole-file `improvedMarkdown` blob contract.
 *
 * Frontmatter changes are surgical (regex per field, same as updateArtifactFields).
 * Body changes target specific ## headings or exact text matches.
 */
export interface BodyChange {
    type: 'replaceSection' | 'replaceText';
    heading?: string;
    findExact?: string;
    replaceWith?: string;
    newContent?: string;
}
export declare function applyRefineDeltas(raw: string, frontmatterChanges?: Record<string, unknown>, bodyChanges?: BodyChange[]): string;
//# sourceMappingURL=delta-apply-service.d.ts.map