/**
 * Heuristic-based pattern detection from architecture files.
 *
 * Produces human-readable rules that are injected into AI prompts
 * to prevent common mistakes like creating parallel CRUD services,
 * forgetting to register commands, or scattering type definitions.
 *
 * Every detector is a pure function — fast, deterministic, no AI.
 */
export interface PatternRule {
    /** Short identifier (e.g., "generic-crud"). */
    name: string;
    /** Rule text injected into the prompt. */
    rule: string;
    /** Which file(s) this was detected from. */
    evidence: string[];
    /** What NOT to do — helps the AI avoid common mistakes. */
    antiPattern: string;
}
/**
 * Detect architectural patterns from architecture file contents.
 * Returns rules the AI should follow when generating tasks.
 *
 * @param architectureFiles - Map of relative path → labeled content (from findArchitectureFiles)
 * @param sourceInventory - Compact source listing (from buildSourceInventory)
 */
export declare function detectPatternRules(architectureFiles: Map<string, string>, sourceInventory: string): PatternRule[];
//# sourceMappingURL=pattern-rules.d.ts.map