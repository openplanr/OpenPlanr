/**
 * Lightweight codebase file reading utilities.
 *
 * NOT a full indexer — just smart file reading for enriching AI prompts
 * with relevant code context. Files larger than MAX_FILE_SIZE are skipped.
 */

import path from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';

const MAX_FILE_SIZE = 50_000; // 50KB per file
const MAX_SNIPPET_CHARS = 3_000; // Truncate snippets to this length

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.swift',
  '.vue', '.svelte', '.astro',
  '.sql', '.graphql', '.gql',
  '.css', '.scss', '.less',
  '.json', '.yaml', '.yml', '.toml',
  '.md', '.mdx',
]);

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next',
  '__pycache__', 'vendor', 'target', '.venv', 'coverage',
]);

/**
 * Read a single project file with size guard.
 * Returns null if file is too large or doesn't exist.
 */
export async function readProjectFile(
  projectDir: string,
  relativePath: string
): Promise<string | null> {
  const fullPath = path.join(projectDir, relativePath);

  try {
    const fileStat = await stat(fullPath);
    if (fileStat.size > MAX_FILE_SIZE) return null;
    return await readFile(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Find files whose names or paths match any of the given keywords.
 * Returns relative paths, limited to maxResults.
 */
export async function findRelatedFiles(
  projectDir: string,
  keywords: string[],
  maxResults: number = 10
): Promise<string[]> {
  if (keywords.length === 0) return [];

  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  const matches: string[] = [];

  await searchDir(projectDir, projectDir, lowerKeywords, matches, maxResults, 0);
  return matches;
}

async function searchDir(
  rootDir: string,
  currentDir: string,
  keywords: string[],
  matches: string[],
  maxResults: number,
  depth: number
): Promise<void> {
  if (depth > 5 || matches.length >= maxResults) return;

  let entries: string[];
  try {
    entries = await readdir(currentDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (matches.length >= maxResults) return;
    if (IGNORED_DIRS.has(entry) || entry.startsWith('.')) continue;

    const fullPath = path.join(currentDir, entry);

    try {
      const entryStat = await stat(fullPath);

      if (entryStat.isDirectory()) {
        await searchDir(rootDir, fullPath, keywords, matches, maxResults, depth + 1);
      } else if (isSourceFile(entry)) {
        const lowerEntry = entry.toLowerCase();
        const relativePath = path.relative(rootDir, fullPath);
        const lowerPath = relativePath.toLowerCase();

        const isMatch = keywords.some(
          (kw) => lowerEntry.includes(kw) || lowerPath.includes(kw)
        );
        if (isMatch) {
          matches.push(relativePath);
        }
      }
    } catch {
      // Skip inaccessible entries
    }
  }
}

function isSourceFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return SOURCE_EXTENSIONS.has(ext);
}

/**
 * Read multiple files and return a map of relative paths to truncated content.
 * Respects a total character budget across all files.
 */
export async function readFileSnippets(
  projectDir: string,
  relativePaths: string[],
  totalBudget: number = 12_000
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  let remaining = totalBudget;

  for (const relPath of relativePaths) {
    if (remaining <= 0) break;

    const content = await readProjectFile(projectDir, relPath);
    if (!content) continue;

    const truncated = content.slice(0, Math.min(MAX_SNIPPET_CHARS, remaining));
    result.set(relPath, truncated);
    remaining -= truncated.length;
  }

  return result;
}
