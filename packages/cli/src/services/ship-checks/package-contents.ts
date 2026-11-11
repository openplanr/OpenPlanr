import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { ChangedFile, CheckCandidate, ShipDiagnostic } from './contract.js';
import { diagnostic } from './contract.js';
import type { PackageManifest } from './packages.js';
import { ManifestError, readManifest } from './packages.js';

const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/u;
const SKIPPED_SEGMENT = /^(?:tests?|__tests__|fixtures?|node_modules)$/u;
const GLOB = /[*?[{!]/u;
const NEW_STATUSES: ReadonlySet<ChangedFile['status']> = new Set(['added', 'renamed', 'untracked']);
const PACK_COMMAND = 'npm pack --dry-run --json --ignore-scripts';

/** A new file that a build step must copy or a package must list, as opposed to compiled source. */
function isDataFile(path: string): boolean {
  return (
    !CODE_FILE.test(path) &&
    !path.endsWith('/package.json') &&
    path !== 'package.json' &&
    !path.split('/').some((segment) => segment.startsWith('.'))
  );
}

/** Whether a `files` entry names the path or a directory above it; a glob counts from its fixed prefix. */
function filesNames(files: readonly string[], path: string): boolean {
  return files.some((entry) => {
    const segments = entry
      .replace(/^\.?\/+/u, '')
      .replace(/\/+$/u, '')
      .split('/');
    const glob = segments.findIndex((segment) => GLOB.test(segment));
    const prefix = (glob === -1 ? segments : segments.slice(0, glob)).join('/');
    if (prefix === '') return segments[0] === '**';
    return path === prefix || path.startsWith(`${prefix}/`);
  });
}

/** False for a file under a test or fixture directory unless the package's `files` names it. */
function isPublishable(path: string, files: readonly string[]): boolean {
  const inSkipped = path
    .split('/')
    .slice(0, -1)
    .some((segment) => SKIPPED_SEGMENT.test(segment));
  return !inSkipped || filesNames(files, path);
}

function owningPackage(root: string, path: string): string | null {
  for (let dir = posix.dirname(path); ; dir = posix.dirname(dir)) {
    if (existsSync(join(root, dir, 'package.json'))) return dir;
    if (dir === '.') return null;
  }
}

/** One dry-run pack per published package that gains non-code files, listing the files to confirm. */
export function packageContentsChecks(
  root: string,
  changed: readonly ChangedFile[],
  diagnostics: ShipDiagnostic[],
): CheckCandidate[] {
  const expected = new Map<string, string[]>();
  for (const { path, status } of changed) {
    if (!NEW_STATUSES.has(status) || !isDataFile(path)) continue;
    const dir = owningPackage(root, path);
    if (dir === null) continue;
    const files = expected.get(dir) ?? [];
    files.push(dir === '.' ? path : posix.relative(dir, path));
    expected.set(dir, files);
  }
  const checks: CheckCandidate[] = [];
  for (const [dir, candidates] of [...expected].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const manifestPath = dir === '.' ? 'package.json' : `${dir}/package.json`;
    let manifest: PackageManifest | null;
    try {
      manifest = readManifest(join(root, dir));
    } catch (error) {
      if (!(error instanceof ManifestError)) throw error;
      diagnostics.push(
        diagnostic('MANIFEST_INVALID', 'error', `${manifestPath} is not valid JSON.`, manifestPath),
      );
      continue;
    }
    if (manifest === null || manifest.private) continue;
    const files = manifest.files;
    const expectFiles = candidates.filter((path) => isPublishable(path, files));
    if (expectFiles.length === 0) continue;
    checks.push({
      id: `package-contents:${dir}`,
      command: PACK_COMMAND,
      cwd: dir,
      sources: [{ kind: 'package', file: manifestPath, line: null }],
      tags: ['package-contents'],
      acceptanceIds: [],
      expectFiles,
    });
  }
  return checks;
}
