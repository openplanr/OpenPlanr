/**
 * Orchestrates codebase awareness into a single context string.
 *
 * Combines tech stack detection, folder tree, architecture files,
 * and keyword-matched file snippets into a formatted block for
 * inclusion in AI prompts. Respects a token budget to avoid overflow.
 *
 * Architecture files are always included — they define the patterns
 * the AI must follow when generating implementation tasks.
 */
import { type PatternRule } from './pattern-rules.js';
import { type TechStack } from './stack-detector.js';
export interface CodebaseContext {
    techStack: TechStack | null;
    folderTree: string;
    /** Compact listing of all source files in key directories. */
    sourceInventory: string;
    /** Core pattern files that define how the project is structured. */
    architectureFiles: Map<string, string>;
    /** Keyword-matched files relevant to the specific task. */
    relatedFiles: Map<string, string>;
    /** User-defined rules from `.planr/rules.md`. */
    projectRules: string | null;
    /** Auto-detected architectural patterns. */
    patternRules: PatternRule[];
}
/**
 * Discover architecture files that exist in the project.
 * Tries each candidate path per pattern — first match wins.
 * Returns a map of relative paths → labeled, truncated content.
 */
export declare function findArchitectureFiles(projectDir: string): Promise<Map<string, string>>;
/**
 * Build a complete codebase context for AI prompt enrichment.
 *
 * @param projectDir - Project root directory
 * @param keywords - Keywords to find related files (extracted from task/story)
 */
export declare function buildCodebaseContext(projectDir: string, keywords?: string[]): Promise<CodebaseContext>;
/**
 * Format the codebase context into a prompt-friendly string.
 * Applies token budget by progressively dropping lower-priority sections.
 */
export declare function formatCodebaseContext(ctx: CodebaseContext): string;
/**
 * Extract keywords from artifact content for file searching.
 * Looks for capitalized terms, technical words, and file paths.
 */
export declare function extractKeywords(content: string): string[];
//# sourceMappingURL=context-builder.d.ts.map