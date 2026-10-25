import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckCandidate, ShipRequirement } from './contract.js';

const RUNNERS = new Set([
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'bunx',
  'node',
  'deno',
  'tsx',
  'tsc',
  'vitest',
  'jest',
  'playwright',
  'biome',
  'eslint',
  'prettier',
  'cargo',
  'go',
  'make',
  'just',
  'pytest',
  'python',
  'python3',
  'dotnet',
  'mvn',
  'gradle',
  './gradlew',
  'pre-commit',
]);
// Runner names that are also common English words never count on a bare prose line.
const AMBIGUOUS = new Set(['make', 'go', 'just', 'node', 'python', 'python3']);
const PREFIXES: readonly (readonly string[])[] = [
  ['pnpm', 'exec'],
  ['pnpm', 'dlx'],
  ['bun', 'x'],
  ['npx'],
  ['bunx'],
];
const ACCEPTANCE = /\b(?:[A-Z][A-Z0-9]*-\d+\.)?AC-\d+\b/gu;
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=\S*$/u;

export type TaskRequirements = {
  checks: CheckCandidate[];
  requirements: ShipRequirement[];
  acceptance: string[];
};

function section(markdown: string, heading: string): { body: string; line: number } | null {
  const lines = markdown.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && /^##?\s/u.test(line));
  return { body: lines.slice(start + 1, end < 0 ? undefined : end).join('\n'), line: start + 2 };
}

function binaries(root: string): Set<string> {
  const dir = join(root, 'node_modules/.bin');
  return existsSync(dir) ? new Set(readdirSync(dir)) : new Set();
}

/** Whether text is a command: its first word, after env and runner prefixes, is a known runner. */
export function isCommand(text: string, bins: ReadonlySet<string>, prose: boolean): boolean {
  const tokens = text.trim().split(/\s+/u).filter(Boolean);
  while (tokens[0] !== undefined && ENV_ASSIGNMENT.test(tokens[0])) tokens.shift();
  for (const prefix of PREFIXES) {
    if (prefix.every((word, index) => tokens[index] === word) && tokens.length > prefix.length) {
      tokens.splice(0, prefix.length);
      while (tokens[0]?.startsWith('-')) tokens.shift();
      break;
    }
  }
  const head = tokens[0];
  if (head === undefined) return false;
  if (prose && AMBIGUOUS.has(head)) return false;
  return RUNNERS.has(head) || bins.has(head);
}

const LIST_MARKER = /^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/u;

/**
 * Every Test Requirements line yields at least one entry: each command it holds becomes a
 * check, and any remaining prose becomes a requirement.
 */
export function readTaskRequirements(
  root: string,
  taskFile: string,
  relativePath: string,
): TaskRequirements {
  const markdown = readFileSync(taskFile, 'utf8');
  const found = section(markdown, 'Test Requirements');
  const result: TaskRequirements = { checks: [], requirements: [], acceptance: [] };
  if (found === null) return result;
  const bins = binaries(root);
  const acceptance = new Set<string>();
  let fenced = false;
  found.body.split('\n').forEach((raw, index) => {
    const line = found.line + index;
    const trimmed = raw.trim();
    if (/^(?:```|~~~)/u.test(trimmed)) {
      fenced = !fenced;
      return;
    }
    if (trimmed === '') return;
    const ids = [...new Set(trimmed.match(ACCEPTANCE) ?? [])];
    for (const id of ids) acceptance.add(id);
    const commands: string[] = [];
    let prose = trimmed.replace(LIST_MARKER, '');
    if (fenced) {
      if (!trimmed.startsWith('#')) commands.push(trimmed);
      prose = '';
    } else {
      prose = prose.replace(/`([^`\n]+)`/gu, (whole, span: string) => {
        if (!isCommand(span, bins, false)) return whole;
        commands.push(span.trim());
        return '';
      });
      if (commands.length === 0 && isCommand(prose, bins, true) && !/[.:]$/u.test(prose)) {
        commands.push(prose);
        prose = '';
      }
    }
    commands.forEach((command, position) => {
      result.checks.push({
        id: `task:${line}${commands.length > 1 ? `:${position + 1}` : ''}`,
        command,
        cwd: '.',
        sources: [{ kind: 'task', file: relativePath, line }],
        tags: ['task'],
        acceptanceIds: ids,
      });
    });
    const remaining = prose
      .replace(ACCEPTANCE, '')
      .replace(/[\s:;,.()\-–—]+/gu, ' ')
      .trim();
    if (remaining !== '')
      result.requirements.push({
        kind: 'prose',
        text: trimmed.replace(LIST_MARKER, ''),
        acceptanceIds: ids,
      });
  });
  result.acceptance = [...acceptance];
  return result;
}
