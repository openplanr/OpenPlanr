import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckCandidate } from './contract.js';

export type HookName = 'pre-commit' | 'pre-push';

const HUSKY_BOILERPLATE =
  /^\.\s+["']?\$\(\s*dirname\s+(?:--\s+)?["']?\$0["']?\s*\)\/_\/husky\.sh["']?$/u;
const CONTROL_FLOW =
  /^(?:if|then|elif|else|fi|for|while|until|do|done|case|esac|function)\b|\(\)\s*\{$/u;

function logicalLines(source: string): { text: string; line: number }[] {
  const lines: { text: string; line: number }[] = [];
  let pending: { text: string; line: number } | null = null;
  source.split(/\r?\n/u).forEach((raw, index) => {
    const continued = raw.endsWith('\\');
    const piece = continued ? raw.slice(0, -1) : raw;
    pending =
      pending === null
        ? { text: piece, line: index + 1 }
        : { ...pending, text: `${pending.text.trimEnd()} ${piece.trim()}` };
    if (!continued) {
      lines.push(pending);
      pending = null;
    }
  });
  if (pending !== null) lines.push(pending);
  return lines;
}

/** Husky hook commands read as shell; a hook with control flow stays one entry. */
export function readHuskyHook(root: string, hook: HookName): CheckCandidate[] {
  const file = `.husky/${hook}`;
  const path = join(root, file);
  if (!existsSync(path)) return [];
  const commands = logicalLines(readFileSync(path, 'utf8'))
    .map((entry) => ({ ...entry, text: entry.text.trim() }))
    .filter(({ text }) => text !== '' && !text.startsWith('#') && !HUSKY_BOILERPLATE.test(text));
  const entry = (command: string, line: number, tags: string[]): CheckCandidate => ({
    id: `hook:${hook}:${line}`,
    command,
    cwd: '.',
    sources: [{ kind: 'hook', file, line, hook }],
    tags: ['hook', ...tags],
    acceptanceIds: [],
  });
  if (commands.some(({ text }) => CONTROL_FLOW.test(text))) {
    const first = commands[0];
    return first
      ? [entry(commands.map(({ text }) => text).join('\n'), first.line, ['multi-line'])]
      : [];
  }
  return commands.map(({ text, line }) => entry(text, line, []));
}

/** The pre-commit framework's hooks, run as the framework runs them. */
export function readPreCommitFramework(root: string): CheckCandidate[] {
  const file = '.pre-commit-config.yaml';
  if (!existsSync(join(root, file))) return [];
  return [
    {
      id: 'hook:pre-commit-framework',
      command: 'pre-commit run --all-files',
      cwd: '.',
      sources: [{ kind: 'hook', file, line: null, hook: 'pre-commit' }],
      tags: ['hook'],
      acceptanceIds: [],
    },
  ];
}
