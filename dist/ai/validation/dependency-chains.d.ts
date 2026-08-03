/**
 * Detects file dependency chains from architecture files.
 *
 * When one file in a chain is modified, others likely need updating too.
 * Chains are detected via import analysis: if file A imports from file B,
 * they form a dependency hint.
 */
export interface DependencyHint {
    /** Files in this chain (relative paths). */
    files: string[];
    /** Human-readable explanation of why these files are linked. */
    reason: string;
}
/**
 * Detect dependency hints by analysing import statements across
 * architecture files. If file A imports from file B, they form a chain.
 *
 * @param architectureFiles - Map of relative path → content from findArchitectureFiles
 */
export declare function detectDependencyHints(architectureFiles: Map<string, string>): DependencyHint[];
//# sourceMappingURL=dependency-chains.d.ts.map