/**
 * Reads project-specific rules from `.planr/rules.md`.
 *
 * These rules are injected directly into AI prompts so project
 * owners can control how the AI generates tasks, names files,
 * and follows architectural conventions — without modifying code.
 */
/**
 * Read `.planr/rules.md` from the project directory.
 *
 * @returns The trimmed rules content, or `null` if the file doesn't exist or is empty.
 */
export declare function readProjectRules(projectDir: string): Promise<string | null>;
//# sourceMappingURL=rules-reader.d.ts.map