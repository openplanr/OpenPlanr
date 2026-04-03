/**
 * Reads project-specific rules from `.planr/rules.md`.
 *
 * These rules are injected directly into AI prompts so project
 * owners can control how the AI generates tasks, names files,
 * and follows architectural conventions — without modifying code.
 */

import { readProjectFile } from './file-reader.js';

/** Maximum characters to read from the rules file. */
const MAX_RULES_CHARS = 8_000;

/**
 * Read `.planr/rules.md` from the project directory.
 *
 * @returns The trimmed rules content, or `null` if the file doesn't exist or is empty.
 */
export async function readProjectRules(projectDir: string): Promise<string | null> {
  const content = await readProjectFile(projectDir, '.planr/rules.md');
  if (content === null) return null;
  const trimmed = content.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_RULES_CHARS);
}
