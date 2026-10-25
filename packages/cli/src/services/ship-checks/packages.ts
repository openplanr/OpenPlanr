import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';
import type { PackageScript } from './contract.js';

export type PackageManifest = {
  name?: string;
  main?: unknown;
  exports?: unknown;
  bin?: unknown;
  scripts: Record<string, string>;
  workspaces: string[];
};

export class ManifestError extends Error {}

/** Reads `<dir>/package.json`; null when absent, ManifestError when unreadable. */
export function readManifest(dir: string): PackageManifest | null {
  const path = join(dir, 'package.json');
  if (!existsSync(path)) return null;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new ManifestError(`${path} is not valid JSON`, { cause });
  }
  return manifestFrom(value);
}

export function manifestFrom(value: unknown): PackageManifest {
  const record =
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const scripts: Record<string, string> = {};
  if (record.scripts !== null && typeof record.scripts === 'object') {
    for (const [name, body] of Object.entries(record.scripts as Record<string, unknown>)) {
      if (typeof body === 'string') scripts[name] = body;
    }
  }
  const declared = Array.isArray(record.workspaces)
    ? record.workspaces
    : (record.workspaces as { packages?: unknown } | undefined)?.packages;
  return {
    name: typeof record.name === 'string' ? record.name : undefined,
    main: record.main,
    exports: record.exports,
    bin: record.bin,
    scripts,
    workspaces: Array.isArray(declared)
      ? declared.filter((entry): entry is string => typeof entry === 'string')
      : [],
  };
}

/** Repo-relative directory of a workspace given by path or package name, or null. */
export function resolveWorkspace(root: string, workspace: string): string | null {
  const direct = resolve(root, workspace);
  if (existsSync(join(direct, 'package.json'))) return toPosix(relative(root, direct)) || '.';
  const rootManifest = readManifest(root);
  for (const pattern of rootManifest?.workspaces ?? []) {
    for (const dir of expandWorkspacePattern(root, pattern)) {
      if (readManifest(resolve(root, dir))?.name === workspace) return dir;
    }
  }
  return null;
}

function expandWorkspacePattern(root: string, pattern: string): string[] {
  const clean = pattern.replace(/\/+$/u, '');
  if (!clean.endsWith('/*')) return [clean];
  const parent = clean.slice(0, -2);
  const absolute = resolve(root, parent);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) return [];
  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => posix.join(parent, entry.name))
    .sort();
}

export function toPosix(path: string): string {
  return path.split('\\').join('/');
}

export const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const WORKSPACE_FLAGS = new Set(['--workspace', '-w', '--filter', '-F']);
const SHELL_SYNTAX = /[\n;&|<>$`"'()\\]/u;
const PNPM_BUILTINS = new Set([
  'add',
  'install',
  'i',
  'exec',
  'dlx',
  'update',
  'remove',
  'publish',
  'pack',
  'why',
  'list',
  'ls',
  'store',
  'fetch',
  'rebuild',
]);

export type ScriptCall = PackageScript & { packageDir: string };

/**
 * Parses a command that only calls one package script, or returns null.
 * Bare `pnpm <name>` and `yarn <name>` count only when the target package defines `<name>`.
 */
export function parseScriptCall(command: string, cwd: string, root: string): ScriptCall | null {
  const text = command.trim();
  if (text === '' || SHELL_SYNTAX.test(text)) return null;
  const [manager, ...rest] = text.split(/\s+/u);
  if (manager === undefined || !PACKAGE_MANAGERS.has(manager)) return null;
  let workspace: string | null = null;
  const words: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] ?? '';
    const [flag, inline] = token.split(/=(.*)/su);
    if (flag !== undefined && WORKSPACE_FLAGS.has(flag)) {
      if (workspace !== null) return null;
      workspace = inline ?? rest[++index] ?? null;
      if (workspace === null) return null;
    } else if (token.startsWith('-')) {
      return null;
    } else {
      words.push(token);
    }
  }
  if (manager === 'yarn' && words[0] === 'workspace') {
    if (workspace !== null || words.length < 3) return null;
    workspace = words[1] ?? null;
    words.splice(0, 2);
  }
  let name: string | undefined;
  let bare = false;
  if (words.length === 2 && (words[0] === 'run' || words[0] === 'run-script')) name = words[1];
  else if (words.length === 1 && manager === 'npm' && (words[0] === 'test' || words[0] === 't'))
    name = 'test';
  else if (words.length === 1 && (manager === 'pnpm' || manager === 'yarn')) {
    name = words[0];
    bare = true;
  }
  if (name === undefined || (manager === 'pnpm' && PNPM_BUILTINS.has(name))) return null;
  let packageDir = cwd;
  if (workspace !== null) {
    const resolved = resolveWorkspace(resolve(root, cwd), workspace);
    packageDir = posix.normalize(posix.join(cwd, resolved ?? workspace));
  }
  if (bare && readManifestQuietly(resolve(root, packageDir))?.scripts[name] === undefined)
    return null;
  return { name, workspace, packageDir };
}

function readManifestQuietly(dir: string): PackageManifest | null {
  try {
    return readManifest(dir);
  } catch (error) {
    if (error instanceof ManifestError) return null;
    throw error;
  }
}

/** The script name a package-manager command segment runs, if any. */
function scriptNameOf(tokens: string[]): string | null {
  const [manager, ...rest] = tokens;
  if (manager === undefined || !PACKAGE_MANAGERS.has(manager)) return null;
  const words: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] ?? '';
    if (token === '--') break;
    if (WORKSPACE_FLAGS.has(token)) index += 1;
    else if (!token.startsWith('-')) words.push(token);
  }
  if (manager === 'yarn' && words[0] === 'workspace') words.splice(0, 2);
  if (words[0] === 'run' || words[0] === 'run-script') return words[1] ?? null;
  return words[0] ?? null;
}

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;

/** Whether any command segment calls a `build` or `build:*` script or `tsc --build`. */
export function isBuildCommand(command: string): boolean {
  return command
    .split(/\n|&&|\|\||;|\|/u)
    .map((segment) => segment.trim().split(/\s+/u).filter(Boolean))
    .some((tokens) => {
      while (tokens[0] !== undefined && ENV_ASSIGNMENT.test(tokens[0])) tokens.shift();
      if (tokens[0] === 'npx' || tokens[0] === 'bunx') tokens.shift();
      if (tokens[0] === 'tsc') return tokens.includes('-b') || tokens.includes('--build');
      const name = scriptNameOf(tokens);
      return name !== null && /^build(?::|$)/u.test(name);
    });
}
