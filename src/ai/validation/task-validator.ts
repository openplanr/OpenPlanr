/**
 * Semantic validation for AI-generated task lists.
 *
 * Runs after Zod schema validation to catch codebase-awareness issues
 * that structural validation cannot detect: wrong modify/create actions,
 * missing dependency chain files, and hallucinated paths.
 */

import type { DependencyHint } from './dependency-chains.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  warnings: string[];
}

export interface RelevantFile {
  path: string;
  reason: string;
  action: 'modify' | 'create';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate AI-generated relevant files against the actual codebase.
 *
 * @param relevantFiles - Files from the AI response
 * @param sourceInventory - Raw source inventory string from CodebaseContext
 * @param dependencyHints - Auto-detected dependency chains
 */
export function validateRelevantFiles(
  relevantFiles: RelevantFile[],
  sourceInventory: string,
  dependencyHints: DependencyHint[],
): ValidationResult {
  const warnings: string[] = [];
  const existingFiles = parseSourceInventory(sourceInventory);
  const referencedPaths = new Set(relevantFiles.map((f) => f.path));

  for (const file of relevantFiles) {
    const exists = existingFiles.has(file.path);

    // Check 1: "modify" action but file not in inventory
    if (file.action === 'modify' && !exists) {
      warnings.push(
        `${file.path} marked as "modify" but not found in source inventory — may not exist`,
      );
    }

    // Check 2: "create" action but file already exists
    if (file.action === 'create' && exists) {
      warnings.push(`${file.path} marked as "create" but already exists — should be "modify"`);
    }

    // Check 3: Path uses a directory not seen in inventory
    const dir = file.path.split('/').slice(0, -1).join('/');
    if (dir && !directoryExistsInInventory(dir, sourceInventory) && file.action === 'modify') {
      warnings.push(`${file.path} references directory "${dir}" not found in source inventory`);
    }
  }

  // Check 4: Dependency chain gaps
  for (const hint of dependencyHints) {
    const mentioned = hint.files.filter((f) => referencedPaths.has(f));
    const missing = hint.files.filter((f) => !referencedPaths.has(f));

    if (mentioned.length > 0 && missing.length > 0) {
      warnings.push(
        `${mentioned.join(', ')} referenced but ${missing.join(', ')} not included — ${hint.reason}`,
      );
    }
  }

  return { warnings };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
export function parseSourceInventory(inventory: string): Set<string> {
  const files = new Set<string>();

  for (const line of inventory.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const dir = line.slice(0, colonIdx).replace(/\/$/, '');
    const fileList = line.slice(colonIdx + 1).trim();
    if (!fileList) continue;

    for (const file of fileList.split(',')) {
      const trimmed = file.trim();
      if (trimmed) {
        files.add(`${dir}/${trimmed}`);
      }
    }
  }

  return files;
}

/** Check if a directory prefix appears in the source inventory. */
function directoryExistsInInventory(dir: string, inventory: string): boolean {
  // Inventory lines start with "dir/:" — check if any line's dir matches or is a parent
  return inventory.split('\n').some((line) => {
    const lineDir = line.split(':')[0]?.replace(/\/$/, '').trim();
    return lineDir === dir || lineDir?.startsWith(`${dir}/`) || dir.startsWith(`${lineDir}/`);
  });
}
