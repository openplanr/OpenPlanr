import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { CheckCandidate, CheckScope, ShipCheck } from './contract.js';
import type { PackageManifest } from './packages.js';

const MARKERS: readonly [RegExp, string][] = [
  [/\blint-staged\b/u, 'runs lint-staged, which sees only staged files'],
  [/\bls-files\b/u, 'reads git ls-files, which lists only tracked files'],
  [/--cached\b|--staged\b/u, 'reads the git index (--cached or --staged)'],
];
const SCRIPT_FILE = /^(?:node|tsx|bash|sh|zsh)$/u;
const MAX_SCRIPT_BYTES = 1024 * 1024;

function marker(text: string): string | null {
  return MARKERS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/** Local script files a command runs directly, as repo-relative paths. */
function scriptFiles(command: string, cwd: string): string[] {
  const files: string[] = [];
  for (const segment of command.split(/\n|&&|\|\||;|\|/u)) {
    const tokens = segment.trim().split(/\s+/u);
    const index = tokens.findIndex((token) => SCRIPT_FILE.test(token));
    const candidate =
      index >= 0 ? tokens.slice(index + 1).find((token) => !token.startsWith('-')) : tokens[0];
    if (candidate && /^\.{0,2}\/?[\w./-]+\.(?:[cm]?[jt]s|sh)$/u.test(candidate))
      files.push(posix.normalize(posix.join(cwd, candidate)));
  }
  return files;
}

/**
 * Classifies a check as tracked-only when the command, its package script body, or a local
 * script file either of them runs (one level) reads git's tracked or staged files.
 */
export function classifyScope(
  root: string,
  check: CheckCandidate,
  packageDir: string,
  manifest: PackageManifest | null,
): ShipCheck {
  const texts: [string, string][] = [[check.command, 'the command']];
  const body = check.script ? manifest?.scripts[check.script.name] : undefined;
  if (body !== undefined && check.script) texts.push([body, `script "${check.script.name}"`]);
  for (const [text, origin] of [...texts]) {
    const base = origin === 'the command' ? check.cwd : packageDir;
    for (const file of scriptFiles(text, base)) {
      const path = join(root, file);
      const stats = existsSync(path) ? statSync(path) : null;
      if (stats?.isFile() && stats.size <= MAX_SCRIPT_BYTES)
        texts.push([readFileSync(path, 'utf8'), `${file} (run by ${origin})`]);
    }
  }
  for (const [text, origin] of texts) {
    const reason = marker(text);
    if (reason !== null) return withScope(check, 'tracked-only', `${origin} ${reason}`);
  }
  return withScope(check, 'worktree');
}

function withScope(check: CheckCandidate, scope: CheckScope, scopeReason?: string): ShipCheck {
  const { id, command, cwd, sources, tags, script, condition, shell, acceptanceIds } = check;
  return {
    id,
    command,
    cwd,
    sources,
    tags,
    scope,
    ...(scopeReason === undefined ? {} : { scopeReason }),
    ...(script === undefined ? {} : { script }),
    ...(condition === undefined ? {} : { condition }),
    ...(shell === undefined ? {} : { shell }),
    acceptanceIds,
  };
}
