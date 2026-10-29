import { existsSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import type { ChangedFile, ShipCheck, ShipCoverage, ShipDiagnostic } from './contract.js';
import { diagnostic } from './contract.js';
import { toPosix } from './packages.js';

const TYPESCRIPT_FILE = /\.(?:[cm]?ts|tsx)$/u;
const TSCONFIG = /(?:^|\/)tsconfig[^/]*\.json$/u;
const NEW_STATUSES: ReadonlySet<ChangedFile['status']> = new Set(['added', 'renamed', 'untracked']);
/** TypeScript codes for an `extends` target it cannot read or find. */
const EXTENDS_FAILURES: ReadonlySet<number> = new Set([5083, 6053]);
const LISTED_PATHS = 5;

type ConfigError = { code: number; messageText: unknown };

type ParsedConfig = {
  fileNames: string[];
  errors: readonly ConfigError[];
  projectReferences?: readonly { path: string }[];
};

/** The subset of the TypeScript compiler API this module calls. */
type TypeScriptApi = {
  sys: { readFile(path: string): string | undefined };
  readConfigFile(
    path: string,
    read: (path: string) => string | undefined,
  ): { config?: unknown; error?: unknown };
  parseJsonConfigFileContent(
    json: unknown,
    host: unknown,
    basePath: string,
    existingOptions?: undefined,
    configFileName?: string,
  ): ParsedConfig;
  flattenDiagnosticMessageText(messageText: unknown, newLine: string): string;
};

function isTypeScriptApi(value: unknown): value is TypeScriptApi {
  if (typeof value !== 'object' || value === null) return false;
  const api = value as Record<string, unknown>;
  return (
    typeof api.readConfigFile === 'function' &&
    typeof api.parseJsonConfigFileContent === 'function' &&
    typeof api.flattenDiagnosticMessageText === 'function' &&
    typeof api.sys === 'object' &&
    api.sys !== null
  );
}

/** Loads the project's own `typescript`, or null when the project cannot resolve it. */
function loadProjectTypeScript(root: string): TypeScriptApi | null {
  const require = createRequire(join(root, 'package.json'));
  let loaded: unknown;
  try {
    loaded = require('typescript');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'MODULE_NOT_FOUND') return null;
    throw error;
  }
  return isTypeScriptApi(loaded) ? loaded : null;
}

function listPaths(paths: readonly string[]): string {
  const shown = paths.slice(0, LISTED_PATHS).join(', ');
  return paths.length > LISTED_PATHS ? `${shown} and ${paths.length - LISTED_PATHS} more` : shown;
}

/** The real path of an existing file, so symlinked directories compare equal. */
function realPath(path: string): string {
  return existsSync(path) ? realpathSync(path) : path;
}

function referencedConfig(path: string): string {
  return existsSync(path) && statSync(path).isDirectory() ? join(path, 'tsconfig.json') : path;
}

/** Root files of every tsconfig, plus configs they reference one level deep. */
function tsconfigRootFiles(
  ts: TypeScriptApi,
  root: string,
  tsconfigs: readonly string[],
  diagnostics: ShipDiagnostic[],
): Set<string> {
  const files = new Set<string>();
  const parsed = new Set<string>();
  const parse = (absolute: string, followReferences: boolean): void => {
    if (parsed.has(absolute) || !existsSync(absolute)) return;
    parsed.add(absolute);
    const { config, error } = ts.readConfigFile(absolute, ts.sys.readFile);
    const path = toPosix(relative(root, absolute));
    if (error !== undefined || config === undefined) {
      diagnostics.push(
        diagnostic('TSCONFIG_UNREADABLE', 'warning', `${path} could not be parsed.`, path),
      );
      return;
    }
    const result = ts.parseJsonConfigFileContent(
      config,
      ts.sys,
      dirname(absolute),
      undefined,
      absolute,
    );
    const [first] = result.errors;
    if (first !== undefined) {
      diagnostics.push(
        diagnostic(
          'TSCONFIG_ERROR',
          'warning',
          `${path}: ${ts.flattenDiagnosticMessageText(first.messageText, ' ')}`,
          path,
        ),
      );
    }
    // A failed `extends` makes TypeScript fall back to its default include, which would hide files.
    if (!result.errors.some(({ code }) => EXTENDS_FAILURES.has(code)))
      for (const file of result.fileNames) files.add(realPath(resolve(file)));
    if (followReferences)
      for (const reference of result.projectReferences ?? [])
        parse(referencedConfig(resolve(reference.path)), false);
  };
  for (const tsconfig of tsconfigs) parse(join(root, tsconfig), true);
  return files;
}

/** Files and checks whose coverage a passing check run does not prove. */
export async function readCoverage(
  root: string,
  changed: readonly ChangedFile[],
  checks: readonly ShipCheck[],
  repositoryFiles: () => Promise<string[]>,
  diagnostics: ShipDiagnostic[],
): Promise<ShipCoverage> {
  const trackedOnly = checks.filter((check) => check.scope === 'tracked-only').map(({ id }) => id);
  const untracked = changed.filter((file) => file.status === 'untracked').map(({ path }) => path);
  const unseen = trackedOnly.length === 0 ? [] : untracked;
  if (unseen.length > 0) {
    diagnostics.push(
      diagnostic(
        'UNTRACKED_NOT_SEEN',
        'warning',
        `Untracked file(s) ${listPaths(unseen)} are invisible to ${trackedOnly.join(', ')}. Run \`git add -N\` on them, or run those checks on the files directly, before trusting a pass.`,
      ),
    );
  }
  return {
    trackedOnly: { checks: trackedOnly, unseen },
    typescript: await readTypeScriptCoverage(root, changed, repositoryFiles, diagnostics),
  };
}

async function readTypeScriptCoverage(
  root: string,
  changed: readonly ChangedFile[],
  repositoryFiles: () => Promise<string[]>,
  diagnostics: ShipDiagnostic[],
): Promise<ShipCoverage['typescript']> {
  const created = changed
    .filter(({ path, status }) => NEW_STATUSES.has(status) && TYPESCRIPT_FILE.test(path))
    .map(({ path }) => path)
    .filter((path) => !path.startsWith('.planr/') && !path.split('/').includes('node_modules'));
  if (created.length === 0) return { tsconfigs: [], uncovered: [] };
  const tsconfigs = (await repositoryFiles()).filter((path) => TSCONFIG.test(path));
  if (tsconfigs.length === 0) return { tsconfigs: [], uncovered: [] };
  const ts = loadProjectTypeScript(root);
  if (ts === null) {
    diagnostics.push(
      diagnostic(
        'TYPESCRIPT_UNAVAILABLE',
        'info',
        'The project does not resolve the typescript package, so tsconfig coverage of new files was not checked.',
      ),
    );
    return null;
  }
  const covered = tsconfigRootFiles(ts, root, tsconfigs, diagnostics);
  const uncovered = created.filter((path) => !covered.has(realPath(resolve(root, path))));
  if (uncovered.length > 0) {
    diagnostics.push(
      diagnostic(
        'TS_NOT_COVERED',
        'warning',
        `New TypeScript file(s) ${listPaths(uncovered)} match no tsconfig files, include or reference; they are typechecked only if a covered file imports them.`,
      ),
    );
  }
  return { tsconfigs, uncovered };
}
