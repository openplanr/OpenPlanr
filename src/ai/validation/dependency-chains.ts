/**
 * Detects file dependency chains from architecture files.
 *
 * When one file in a chain is modified, others likely need updating too.
 * Chains are detected via import analysis: if file A imports from file B,
 * they form a dependency hint.
 */

export interface DependencyHint {
  /** Files in this chain (relative paths). */
  files: string[];
  /** Human-readable explanation of why these files are linked. */
  reason: string;
}

/**
 * Detect dependency hints by analysing import statements across
 * architecture files. If file A imports from file B, they form a chain.
 *
 * @param architectureFiles - Map of relative path → content from findArchitectureFiles
 */
export function detectDependencyHints(architectureFiles: Map<string, string>): DependencyHint[] {
  const archPaths = [...architectureFiles.keys()];
  if (archPaths.length < 2) return [];

  // Build a map of which architecture files import which others
  const importGraph = new Map<string, Set<string>>();

  for (const [filePath, content] of architectureFiles) {
    const importedPaths = extractImportPaths(content);
    for (const imp of importedPaths) {
      const resolved = resolveImportToArchFile(imp, filePath, archPaths);
      if (resolved) {
        if (!importGraph.has(filePath)) importGraph.set(filePath, new Set());
        importGraph.get(filePath)?.add(resolved);
      }
    }
  }

  // Find hub files (imported by 3+ others)
  const importCounts = new Map<string, string[]>();
  for (const [importer, imports] of importGraph) {
    for (const imported of imports) {
      if (!importCounts.has(imported)) importCounts.set(imported, []);
      importCounts.get(imported)?.push(importer);
    }
  }

  const hints: DependencyHint[] = [];
  const seen = new Set<string>();

  // Hub chains: file imported by 3+ architecture files
  for (const [hubFile, importers] of importCounts) {
    if (importers.length >= 3) {
      const chain = [hubFile, ...importers].sort();
      const key = chain.join(',');
      if (!seen.has(key)) {
        seen.add(key);
        hints.push({
          files: chain,
          reason: `${hubFile} is a central module imported by ${importers.join(', ')} — changes may require updates in all`,
        });
      }
    }
  }

  // Pair chains: direct import relationships not already covered by hubs
  for (const [importer, imports] of importGraph) {
    for (const imported of imports) {
      const pair = [importer, imported].sort();
      const key = pair.join(',');
      if (!seen.has(key)) {
        seen.add(key);
        hints.push({
          files: pair,
          reason: `${importer} imports from ${imported} — changes to one may require updates in the other`,
        });
      }
    }
  }

  return hints;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract import paths from TypeScript/JavaScript source. */
function extractImportPaths(content: string): string[] {
  return [...content.matchAll(/(?:import|from)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/**
 * Resolve an import path to one of the known architecture file paths.
 * Handles relative imports and extension stripping.
 */
function resolveImportToArchFile(
  importPath: string,
  fromFile: string,
  archPaths: string[],
): string | null {
  // Only consider relative imports
  if (!importPath.startsWith('.')) return null;

  // Strip .js/.ts extension
  const stripped = importPath.replace(/\.\w+$/, '');

  // Resolve relative to the importing file's directory
  const fromDir = fromFile.split('/').slice(0, -1).join('/');
  const parts = stripped.split('/');
  const resolvedParts = fromDir ? fromDir.split('/') : [];

  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      resolvedParts.pop();
    } else {
      resolvedParts.push(part);
    }
  }

  const resolved = resolvedParts.join('/');

  // Match against architecture paths (with or without extension)
  return (
    archPaths.find((p) => {
      const pBase = p.replace(/\.\w+$/, '');
      return pBase === resolved;
    }) ?? null
  );
}
