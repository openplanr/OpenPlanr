import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { RelatedTest, ShipDiagnostic } from './contract.js';
import { diagnostic } from './contract.js';

const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/u;
const TEST_FILE = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[^/]+$/u;
const EXPORT =
  /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/u;
const COMMAND = /\.command\(\s*['"`]([a-z][\w:-]*)/gu;
const ROUTE = /\b[A-Za-z_$][\w$]*\.(?:get|post|put|patch|delete|all)\(\s*['"`](\/[^'"`\s]*)['"`]/gu;
const MAX_NAMES = 50;
const MAX_FILES = 20;
const MAX_TEST_BYTES = 1024 * 1024;
const MIN_NAME_LENGTH = 4;

export const isCodeFile = (path: string): boolean => CODE_FILE.test(path) && !isTestFile(path);
const TEST_SOURCE = /\.(?:[cm]?[jt]sx?|py|go|rs|rb|java|kt|cs|php|swift)$/u;
export const isTestFile = (path: string): boolean =>
  TEST_FILE.test(path) && TEST_SOURCE.test(path) && !path.split('/').includes('node_modules');

type Name = { name: string; kind: RelatedTest['kind'] };

/** Exported names, CLI command names and route paths on added lines. */
export function namesFromAddedLines(added: ReadonlyMap<string, readonly string[]>): Name[] {
  const names = new Map<string, Name>();
  const add = (name: string, kind: Name['kind']) => {
    if (name.length >= MIN_NAME_LENGTH && !names.has(`${kind}:${name}`))
      names.set(`${kind}:${name}`, { name, kind });
  };
  for (const lines of added.values()) {
    for (const line of lines) {
      const exported = EXPORT.exec(line)?.[1];
      if (exported) add(exported, 'export');
      for (const match of line.matchAll(COMMAND)) add(match[1] ?? '', 'command');
      for (const match of line.matchAll(ROUTE)) add(match[1] ?? '', 'route');
    }
  }
  return [...names.values()].sort(
    (left, right) => left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
}

/** Test files mentioning each name; whole words for identifiers, literal text for routes. */
export function findRelatedTests(
  root: string,
  names: readonly Name[],
  files: readonly string[],
  diagnostics: ShipDiagnostic[],
): RelatedTest[] {
  if (names.length === 0) return [];
  const tests = files.filter(isTestFile).sort();
  const contents = new Map<string, string>();
  for (const path of tests) {
    const absolute = join(root, path);
    const stats = statSync(absolute, { throwIfNoEntry: false });
    if (stats?.isFile() && stats.size <= MAX_TEST_BYTES)
      contents.set(path, readFileSync(absolute, 'utf8'));
  }
  const related: RelatedTest[] = [];
  let truncated = false;
  for (const { name, kind } of names) {
    const pattern =
      kind === 'route'
        ? new RegExp(escapeRegExp(name), 'u')
        : new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`, 'u');
    const matches = [...contents].filter(([, text]) => pattern.test(text)).map(([path]) => path);
    if (matches.length === 0) continue;
    if (related.length === MAX_NAMES) {
      truncated = true;
      break;
    }
    if (matches.length > MAX_FILES) truncated = true;
    related.push({ name, kind, files: matches.slice(0, MAX_FILES) });
  }
  if (truncated) {
    diagnostics.push(
      diagnostic(
        'RELATED_TESTS_TRUNCATED',
        'info',
        `Related tests are capped at ${MAX_NAMES} names and ${MAX_FILES} files per name.`,
      ),
    );
  }
  return related;
}
