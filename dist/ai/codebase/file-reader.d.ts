/**
 * Lightweight codebase file reading utilities.
 *
 * NOT a full indexer — just smart file reading for enriching AI prompts
 * with relevant code context. Files larger than MAX_FILE_SIZE are skipped.
 */
/**
 * Read a single project file with size guard.
 * Returns null if file is too large or doesn't exist.
 */
export declare function readProjectFile(projectDir: string, relativePath: string): Promise<string | null>;
/**
 * Find files whose names or paths match any of the given keywords.
 * Returns relative paths, limited to maxResults.
 */
export declare function findRelatedFiles(projectDir: string, keywords: string[], maxResults?: number): Promise<string[]>;
/**
 * Read multiple files and return a map of relative paths to truncated content.
 * Respects a total character budget across all files.
 */
export declare function readFileSnippets(projectDir: string, relativePaths: string[], totalBudget?: number): Promise<Map<string, string>>;
//# sourceMappingURL=file-reader.d.ts.map