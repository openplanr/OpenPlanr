/**
 * Generates an ASCII folder tree of a project.
 *
 * Used to give the AI a quick overview of the project structure
 * without reading every file. Ignores common non-source directories.
 */

import path from 'node:path';
import fse from 'fs-extra';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '__pycache__',
  '.pytest_cache',
  'vendor',
  'target',
  '.venv',
  'venv',
  '.tox',
  'coverage',
  '.nyc_output',
  '.cache',
  '.turbo',
  '.vercel',
  '.output',
]);

const IGNORED_FILES = new Set([
  '.DS_Store',
  'Thumbs.db',
  '.gitkeep',
]);

export async function generateFolderTree(
  projectDir: string,
  maxDepth: number = 3
): Promise<string> {
  const lines: string[] = [];
  const rootName = path.basename(projectDir);
  lines.push(rootName + '/');

  await walkDir(projectDir, '', maxDepth, 0, lines);
  return lines.join('\n');
}

async function walkDir(
  dirPath: string,
  prefix: string,
  maxDepth: number,
  currentDepth: number,
  lines: string[]
): Promise<void> {
  if (currentDepth >= maxDepth) return;

  let entries: string[];
  try {
    entries = await fse.readdir(dirPath);
  } catch {
    return;
  }

  // Filter and sort: directories first, then files
  const filtered = entries.filter(
    (e) => !IGNORED_DIRS.has(e) && !IGNORED_FILES.has(e) && !e.startsWith('.')
  );

  const dirs: string[] = [];
  const files: string[] = [];

  for (const entry of filtered) {
    const fullPath = path.join(dirPath, entry);
    try {
      const stat = await fse.stat(fullPath);
      if (stat.isDirectory()) dirs.push(entry);
      else files.push(entry);
    } catch {
      // Skip inaccessible entries
    }
  }

  const sorted = [...dirs.sort(), ...files.sort()];
  const total = sorted.length;

  for (let i = 0; i < total; i++) {
    const entry = sorted[i];
    const isLast = i === total - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';
    const isDir = dirs.includes(entry);

    lines.push(`${prefix}${connector}${entry}${isDir ? '/' : ''}`);

    if (isDir) {
      await walkDir(
        path.join(dirPath, entry),
        prefix + childPrefix,
        maxDepth,
        currentDepth + 1,
        lines
      );
    }
  }
}
