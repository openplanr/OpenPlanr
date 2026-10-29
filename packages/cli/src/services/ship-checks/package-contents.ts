import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { ChangedFile, CheckCandidate, ShipDiagnostic } from './contract.js';
import { diagnostic } from './contract.js';
import { ManifestError, readManifest } from './packages.js';

const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/u;
const SKIPPED_SEGMENT = /^(?:tests?|__tests__|fixtures?|node_modules)$/u;
const SKIPPED_ROOT = /^\.(?:planr|changeset|github|husky)\//u;
const NEW_STATUSES: ReadonlySet<ChangedFile['status']> = new Set(['added', 'renamed', 'untracked']);
const PACK_COMMAND = 'npm pack --dry-run --json --ignore-scripts';

/** A new file that a build step must copy or a package must list, as opposed to compiled source. */
function isShippableData(path: string): boolean {
  const segments = path.split('/');
  const name = segments.at(-1) ?? '';
  return (
    !CODE_FILE.test(path) &&
    name !== 'package.json' &&
    !name.startsWith('.') &&
    !SKIPPED_ROOT.test(path) &&
    !segments.slice(0, -1).some((segment) => SKIPPED_SEGMENT.test(segment))
  );
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
    if (!NEW_STATUSES.has(status) || !isShippableData(path)) continue;
    const dir = owningPackage(root, path);
    if (dir === null) continue;
    const files = expected.get(dir) ?? [];
    files.push(dir === '.' ? path : posix.relative(dir, path));
    expected.set(dir, files);
  }
  const checks: CheckCandidate[] = [];
  for (const [dir, expectFiles] of [...expected].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const manifestPath = dir === '.' ? 'package.json' : `${dir}/package.json`;
    let isPrivate: boolean;
    try {
      isPrivate = readManifest(join(root, dir))?.private ?? true;
    } catch (error) {
      if (!(error instanceof ManifestError)) throw error;
      diagnostics.push(
        diagnostic('MANIFEST_INVALID', 'error', `${manifestPath} is not valid JSON.`, manifestPath),
      );
      continue;
    }
    if (isPrivate) continue;
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
