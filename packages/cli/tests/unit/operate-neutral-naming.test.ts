import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const roots = ['src', 'scripts', 'tests', 'docs'];
const legacyAllowlist = new Set([
  'scripts/create-pinned-legacy-operate-replay-proof.mjs',
  'src/services/operate/repository-read-service.ts',
  'src/services/operate/storage-layout.ts',
  'src/services/operate/storage-migration-service.ts',
  'tests/integration/operate-storage-layout.test.ts',
  'tests/unit/operate-cli-contract.test.ts',
  'tests/unit/no-discarded-error-cause.test.ts',
  'src/services/pipeline-package-service.ts',
]);
const legacyToken = ['operate', 'v2'].join('-');
const productLabel = ['operate', 'v2'].join(' ');

function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|md)$/u.test(entry.name)) files.push(target);
    }
  };
  for (const root of roots) walk(root);
  return files;
}

describe('neutral Operate product naming', () => {
  it('allows the version-suffixed token only for explicit legacy migration and wire identifiers', () => {
    const violations: string[] = [];
    for (const file of sourceFiles()) {
      const normalized = file.split(path.sep).join('/');
      const content = readFileSync(file, 'utf8');
      if (new RegExp(productLabel, 'iu').test(content)) {
        violations.push(`${normalized}: product-facing version-suffixed Operate prose`);
      }
      if (new RegExp(legacyToken, 'iu').test(content) && !legacyAllowlist.has(normalized)) {
        violations.push(`${normalized}: non-legacy version-suffixed Operate identifier`);
      }
      if (normalized.split('/').includes(legacyToken)) {
        violations.push(`${normalized}: product source path`);
      }
    }
    expect(violations).toEqual([]);
  });
});
