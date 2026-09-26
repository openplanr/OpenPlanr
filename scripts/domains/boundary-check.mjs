import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const STATIC_FROM_RE =
  /^\s*(?:(?:import|export)\b[^'"\n]*?\bfrom|\}\s*from)\s+(['"])([^'"\n]+)\1\s*;?\s*$/gmu;
const BARE_IMPORT_RE = /^\s*import\s+(['"])([^'"\n]+)\1\s*;?\s*$/gmu;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/gu;

function walk(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.(?:mjs|mts)$/u.test(entry.name)) files.push(path);
    }
  };
  visit(root);
  return files;
}

function displayPath(root, path) {
  return relative(root, path).split(sep).join('/');
}

/**
 * Return stable, human-readable import-boundary violations for one package.
 * Relative imports must stay inside the package and resolve to a real file.
 * Bare imports must match one of the package's explicit allow patterns.
 */
export function checkPackageBoundaries(
  packageRoot,
  { allowedBare = [], sourceDirectories = ['.'] } = {},
) {
  const absoluteRoot = resolve(packageRoot);
  const violations = [];
  const files = sourceDirectories.flatMap((directory) => {
    const sourceRoot = resolve(absoluteRoot, directory);
    const containment = relative(absoluteRoot, sourceRoot);
    if (containment.startsWith('..') || isAbsolute(containment)) {
      throw new Error(`Boundary source directory escapes package root: ${directory}`);
    }
    return walk(sourceRoot);
  });
  for (const file of [...new Set(files)].sort()) {
    const source = readFileSync(file, 'utf8');
    const imports = [STATIC_FROM_RE, BARE_IMPORT_RE, DYNAMIC_IMPORT_RE].flatMap((pattern) =>
      [...source.matchAll(pattern)].map((match) => match[2]),
    );
    for (const specifier of [...new Set(imports)].sort()) {
      const label = `${displayPath(absoluteRoot, file)} -> ${specifier}`;
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier);
        const containment = relative(absoluteRoot, target);
        if (containment.startsWith('..') || isAbsolute(containment)) {
          violations.push(`${label} escapes package root`);
        } else if (!existsSync(target)) {
          violations.push(`${label} does not resolve`);
        }
        continue;
      }
      if (specifier === 'planr-pipeline' || specifier.startsWith('planr-pipeline/')) {
        violations.push(`${label} imports the public compatibility package`);
        continue;
      }
      if (specifier.includes('/conformance') || specifier.includes('/packages/cli')) {
        violations.push(`${label} imports a forbidden layer`);
        continue;
      }
      if (!allowedBare.some((pattern) => pattern.test(specifier))) {
        violations.push(`${label} is not an allowed dependency`);
      }
    }
  }
  return violations.sort();
}
