const MARKER_START = '<!-- PLANR:START - Do not edit this section manually. Run `planr rules generate` to update. -->';
const MARKER_END = '<!-- PLANR:END -->';
/**
 * Merge generated planr content into an existing file using markers.
 * - If the file has existing markers, replace content between them.
 * - If the file exists but has no markers, append a marked section.
 * - If the file doesn't exist (null), return the full marked content.
 */
export function mergeWithMarkers(existingContent, newContent) {
    const markedBlock = `${MARKER_START}\n${newContent}\n${MARKER_END}`;
    if (!existingContent) {
        return markedBlock;
    }
    const startIdx = existingContent.indexOf(MARKER_START);
    const endIdx = existingContent.indexOf(MARKER_END);
    if (startIdx !== -1 && endIdx !== -1) {
        // Replace existing marked section
        const before = existingContent.slice(0, startIdx);
        const after = existingContent.slice(endIdx + MARKER_END.length);
        return `${before}${markedBlock}${after}`;
    }
    // Append marked section to existing content
    return `${existingContent.trimEnd()}\n\n${markedBlock}\n`;
}
//# sourceMappingURL=rule-merge.js.map