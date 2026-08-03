/**
 * Semantic validation for AI-generated task lists.
 *
 * Runs after Zod schema validation to catch codebase-awareness issues
 * that structural validation cannot detect: wrong modify/create actions,
 * missing dependency chain files, and hallucinated paths.
 */
export interface ValidationResult {
    warnings: string[];
}
export interface RelevantFile {
    path: string;
    reason: string;
    action: 'modify' | 'create';
}
/**
 * Validate AI-generated relevant files against the actual codebase.
 *
 * Checks for wrong modify/create actions and hallucinated paths.
 *
 * @param relevantFiles - Files from the AI response
 * @param sourceInventory - Raw source inventory string from CodebaseContext
 */
export declare function validateRelevantFiles(relevantFiles: RelevantFile[], sourceInventory: string): ValidationResult;
/**
 * Parse the compact source inventory format into a Set of full file paths.
 *
 * Input format:
 * ```
 * src/services/: artifact-service.ts, config-service.ts, id-service.ts
 * src/cli/commands/: quick.ts, task.ts, epic.ts
 * ```
 *
 * Output: Set { "src/services/artifact-service.ts", "src/services/config-service.ts", ... }
 */
export declare function parseSourceInventory(inventory: string): Set<string>;
//# sourceMappingURL=task-validator.d.ts.map