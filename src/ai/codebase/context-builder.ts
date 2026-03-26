/**
 * Orchestrates codebase awareness into a single context string.
 *
 * Combines tech stack detection, folder tree, and related file snippets
 * into a formatted block for inclusion in AI prompts. Respects a token
 * budget (~8K tokens ≈ 32K chars) to avoid prompt overflow.
 */

import { detectTechStack, formatTechStack, type TechStack } from './stack-detector.js';
import { generateFolderTree } from './tree-generator.js';
import { findRelatedFiles, readFileSnippets } from './file-reader.js';

const MAX_CONTEXT_CHARS = 32_000; // ~8K tokens

export interface CodebaseContext {
  techStack: TechStack | null;
  folderTree: string;
  relatedFiles: Map<string, string>;
}

/**
 * Build a complete codebase context for AI prompt enrichment.
 *
 * @param projectDir - Project root directory
 * @param keywords - Keywords to find related files (extracted from task/story)
 */
export async function buildCodebaseContext(
  projectDir: string,
  keywords: string[] = []
): Promise<CodebaseContext> {
  const [techStack, folderTree, relatedPaths] = await Promise.all([
    detectTechStack(projectDir),
    generateFolderTree(projectDir, 3),
    findRelatedFiles(projectDir, keywords, 8),
  ]);

  const relatedFiles = await readFileSnippets(projectDir, relatedPaths, 12_000);

  return { techStack, folderTree, relatedFiles };
}

/**
 * Format the codebase context into a prompt-friendly string.
 * Applies token budget by progressively dropping lower-priority sections.
 */
export function formatCodebaseContext(ctx: CodebaseContext): string {
  const sections: string[] = [];

  // Priority 1: Tech stack (always included, small)
  if (ctx.techStack) {
    sections.push(`## Tech Stack\n${formatTechStack(ctx.techStack)}`);
  }

  // Priority 2: Folder tree (truncated if needed)
  if (ctx.folderTree) {
    const treeLines = ctx.folderTree.split('\n');
    const maxLines = 60;
    const truncatedTree =
      treeLines.length > maxLines
        ? treeLines.slice(0, maxLines).join('\n') + '\n... (truncated)'
        : ctx.folderTree;
    sections.push(`## Project Structure\n\`\`\`\n${truncatedTree}\n\`\`\``);
  }

  // Priority 3: Related file snippets (dropped if over budget)
  if (ctx.relatedFiles.size > 0) {
    const fileBlocks: string[] = [];
    for (const [filePath, content] of ctx.relatedFiles) {
      fileBlocks.push(`### ${filePath}\n\`\`\`\n${content}\n\`\`\``);
    }
    sections.push(`## Related Files\n${fileBlocks.join('\n\n')}`);
  }

  // Apply budget
  let result = sections.join('\n\n');
  if (result.length > MAX_CONTEXT_CHARS) {
    // Drop file snippets first, keep stack + tree
    result = sections.slice(0, 2).join('\n\n');
  }
  if (result.length > MAX_CONTEXT_CHARS) {
    // Even tree is too large, truncate aggressively
    result = result.slice(0, MAX_CONTEXT_CHARS) + '\n... (context truncated)';
  }

  return result;
}

/**
 * Extract keywords from artifact content for file searching.
 * Looks for capitalized terms, technical words, and file paths.
 */
export function extractKeywords(content: string): string[] {
  const keywords = new Set<string>();

  // Extract file paths
  const pathMatches = content.match(/[\w/-]+\.\w+/g) || [];
  for (const p of pathMatches) {
    const parts = p.split('/');
    keywords.add(parts[parts.length - 1].replace(/\.\w+$/, ''));
  }

  // Extract technical terms (CamelCase or hyphenated)
  const termMatches = content.match(/[A-Z][a-z]+(?:[A-Z][a-z]+)+|[a-z]+-[a-z]+/g) || [];
  for (const term of termMatches) {
    keywords.add(term.toLowerCase());
  }

  // Extract quoted terms
  const quotedMatches = content.match(/"([^"]+)"|'([^']+)'/g) || [];
  for (const q of quotedMatches) {
    const clean = q.replace(/['"]/g, '').trim();
    if (clean.length > 2 && clean.length < 30) {
      keywords.add(clean.toLowerCase());
    }
  }

  return [...keywords].slice(0, 10);
}
