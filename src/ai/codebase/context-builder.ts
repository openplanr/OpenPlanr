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

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { findRelatedFiles, readFileSnippets, readProjectFile } from './file-reader.js';
import { detectTechStack, formatTechStack, type TechStack } from './stack-detector.js';
import { generateFolderTree } from './tree-generator.js';

const MAX_CONTEXT_CHARS = 48_000; // ~12K tokens (increased for architecture context)

export interface CodebaseContext {
  techStack: TechStack | null;
  folderTree: string;
  /** Compact listing of all source files in key directories. */
  sourceInventory: string;
  /** Core pattern files that define how the project is structured. */
  architectureFiles: Map<string, string>;
  /** Keyword-matched files relevant to the specific task. */
  relatedFiles: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Architecture file discovery
// ---------------------------------------------------------------------------

/**
 * Well-known file patterns that define a project's architecture.
 * Ordered by priority — higher entries are included first when budget is tight.
 */
const ARCHITECTURE_PATTERNS: Array<{
  /** Glob-like candidates to try (first match wins). */
  candidates: string[];
  /** Label shown to AI so it understands why this file matters. */
  label: string;
  /** Max chars to read from this file. */
  budget: number;
}> = [
  {
    candidates: ['src/models/types.ts', 'src/types/index.ts', 'src/types.ts'],
    label:
      'Core type definitions — ALL interfaces, enums, and type aliases used across the project',
    budget: 4_000,
  },
  {
    candidates: [
      'src/services/artifact-service.ts',
      'src/services/crud-service.ts',
      'src/services/data-service.ts',
    ],
    label: 'Main CRUD service — how entities are created, read, listed, and updated',
    budget: 3_000,
  },
  {
    candidates: ['src/services/id-service.ts', 'src/utils/id.ts'],
    label: 'ID generation — how unique IDs are assigned to new entities',
    budget: 2_000,
  },
  {
    candidates: ['src/cli/index.ts', 'src/index.ts', 'src/main.ts', 'src/app.ts'],
    label: 'Entry point — how commands/routes are registered and wired together',
    budget: 2_000,
  },
  {
    candidates: [
      'src/cli/commands/quick.ts',
      'src/cli/commands/task.ts',
      'src/cli/commands/epic.ts',
    ],
    label: 'Example command — the pattern every new command should follow',
    budget: 3_000,
  },
  {
    candidates: ['src/services/config-service.ts', 'src/config.ts'],
    label: 'Configuration — how project config is loaded and validated',
    budget: 2_000,
  },
];

/**
 * Discover architecture files that exist in the project.
 * Tries each candidate path per pattern — first match wins.
 * Returns a map of relative paths → labeled, truncated content.
 */
export async function findArchitectureFiles(projectDir: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  for (const pattern of ARCHITECTURE_PATTERNS) {
    for (const candidate of pattern.candidates) {
      const content = await readProjectFile(projectDir, candidate);
      if (content) {
        const truncated = content.slice(0, pattern.budget);
        result.set(candidate, `// ${pattern.label}\n${truncated}`);
        break; // First match wins for this pattern
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Source file inventory
// ---------------------------------------------------------------------------

/**
 * List all source files in key directories (services, commands, models, etc).
 * Returns a compact string the AI can use to verify file paths exist.
 * Unlike the folder tree, this is NEVER truncated — it's the source of truth.
 */
async function buildSourceInventory(projectDir: string): Promise<string> {
  const keyDirs = [
    'src/services',
    'src/cli/commands',
    'src/models',
    'src/ai/prompts',
    'src/ai/schemas',
    'src/utils',
    'src/templates',
  ];

  const lines: string[] = [];

  for (const dir of keyDirs) {
    const fullDir = path.join(projectDir, dir);
    try {
      const entries = await readdir(fullDir);
      const files = entries.filter((e) => !e.startsWith('.')).sort();
      if (files.length > 0) {
        lines.push(`${dir}/: ${files.join(', ')}`);
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a complete codebase context for AI prompt enrichment.
 *
 * @param projectDir - Project root directory
 * @param keywords - Keywords to find related files (extracted from task/story)
 */
export async function buildCodebaseContext(
  projectDir: string,
  keywords: string[] = [],
): Promise<CodebaseContext> {
  const [techStack, folderTree, sourceInventory, relatedPaths, architectureFiles] =
    await Promise.all([
      detectTechStack(projectDir),
      generateFolderTree(projectDir, 3),
      buildSourceInventory(projectDir),
      findRelatedFiles(projectDir, keywords, 8),
      findArchitectureFiles(projectDir),
    ]);

  // Remove architecture files from keyword results to avoid duplicates
  const archPaths = new Set(architectureFiles.keys());
  const filteredRelated = relatedPaths.filter((p) => !archPaths.has(p));

  const relatedFiles = await readFileSnippets(projectDir, filteredRelated, 12_000);

  return { techStack, folderTree, sourceInventory, architectureFiles, relatedFiles };
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

  // Priority 2: Architecture files (always included — defines project patterns)
  if (ctx.architectureFiles.size > 0) {
    const archBlocks: string[] = [];
    for (const [filePath, content] of ctx.architectureFiles) {
      archBlocks.push(`### ${filePath}\n\`\`\`\n${content}\n\`\`\``);
    }
    sections.push(`## Architecture (IMPORTANT: follow these patterns)\n${archBlocks.join('\n\n')}`);
  }

  // Priority 3: Source file inventory (compact, never truncated)
  if (ctx.sourceInventory) {
    sections.push(
      `## Existing Source Files (ONLY reference files listed here or follow their naming pattern)\n${ctx.sourceInventory}`,
    );
  }

  // Priority 4: Folder tree (truncated if needed)
  if (ctx.folderTree) {
    const treeLines = ctx.folderTree.split('\n');
    const maxLines = 60;
    const truncatedTree =
      treeLines.length > maxLines
        ? `${treeLines.slice(0, maxLines).join('\n')}\n... (truncated)`
        : ctx.folderTree;
    sections.push(`## Project Structure\n\`\`\`\n${truncatedTree}\n\`\`\``);
  }

  // Priority 5: Keyword-matched file snippets (dropped first if over budget)
  if (ctx.relatedFiles.size > 0) {
    const fileBlocks: string[] = [];
    for (const [filePath, content] of ctx.relatedFiles) {
      fileBlocks.push(`### ${filePath}\n\`\`\`\n${content}\n\`\`\``);
    }
    sections.push(`## Related Files\n${fileBlocks.join('\n\n')}`);
  }

  // Apply budget — drop from the end (lowest priority first)
  // Sections: [0] tech stack, [1] architecture, [2] inventory, [3] tree, [4] related files
  let result = sections.join('\n\n');
  if (result.length > MAX_CONTEXT_CHARS) {
    // Drop keyword-matched files first, keep stack + arch + inventory + tree
    result = sections.slice(0, 4).join('\n\n');
  }
  if (result.length > MAX_CONTEXT_CHARS) {
    // Drop tree, keep stack + arch + inventory
    result = sections.slice(0, 3).join('\n\n');
  }
  if (result.length > MAX_CONTEXT_CHARS) {
    result = `${result.slice(0, MAX_CONTEXT_CHARS)}\n... (context truncated)`;
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
