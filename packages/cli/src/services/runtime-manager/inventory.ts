import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type RuntimeId = 'claude-code' | 'codex' | 'cursor';

export interface AdapterRegistryEntry {
  id: RuntimeId;
  version: string;
  capabilityLevel: 'artifact' | 'workflow' | 'product';
  installScopes: Array<'user' | 'project'>;
  capabilities?: {
    interactiveQuestions?: 'native' | 'chat' | 'terminal' | 'none';
  };
}

export interface AdapterRegistry {
  protocolVersion: string;
  adapters: AdapterRegistryEntry[];
}

export type RuntimeProjectContext = Readonly<{
  valid: boolean;
  path: string;
  reason: 'planr' | 'git' | 'none';
}>;

const executable: Record<RuntimeId, string> = {
  'claude-code': 'claude',
  codex: 'codex',
  cursor: 'cursor',
};

function availableFile(file: string, mode: number): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, mode);
    return true;
  } catch {
    return false;
  }
}

function windowsDirectories(searchPath: string): string[] {
  const directories: string[] = [];
  let start = 0;
  while (start <= searchPath.length) {
    const quote = searchPath[start];
    const quoted = quote === '"' || quote === "'";
    const closing = quoted ? searchPath.indexOf(quote, start + 1) : start;
    const separator = searchPath.indexOf(';', closing < 0 ? searchPath.length : closing);
    const end = separator < 0 ? searchPath.length : separator;
    let directory = searchPath.slice(start, end);
    if (quoted) directory = directory.slice(1);
    if (directory.endsWith('"') || directory.endsWith("'")) directory = directory.slice(0, -1);
    directories.push(directory);
    if (separator < 0) break;
    start = separator + 1;
  }
  return directories;
}

function detectCommand(command: string): boolean {
  // Discovery establishes presence; the native invocation owns health and permissions.
  const claudeOverride = command === 'claude' ? process.env.OPENPLANR_CLAUDE_BIN?.trim() : '';
  if (claudeOverride) return availableFile(path.resolve(claudeOverride), constants.R_OK);

  const windows = process.platform === 'win32';
  const searchPath = process.env.PATH ?? (windows ? process.env.Path : undefined);
  if (searchPath === undefined) return false;
  const extensions = windows
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .map((extension) => extension.trim())
        .filter((extension) => /^\.[a-z\d]+$/iu.test(extension))
    : [''];
  const directories = windows ? windowsDirectories(searchPath) : searchPath.split(path.delimiter);
  return directories.some((directory) =>
    extensions.some((extension) =>
      availableFile(
        path.resolve(directory || '.', `${command}${extension}`),
        windows ? constants.F_OK : constants.X_OK,
      ),
    ),
  );
}

/** Owns project and installed-runtime discovery without mutating setup state. */
export function inspectRuntimeProjectContext(projectDir: string): RuntimeProjectContext {
  const resolved = path.resolve(projectDir);
  if (existsSync(path.join(resolved, '.planr', 'config.json'))) {
    return { valid: true, path: resolved, reason: 'planr' };
  }
  const git = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: resolved,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (!git.error && git.status === 0 && git.stdout.trim() === 'true') {
    return { valid: true, path: resolved, reason: 'git' };
  }
  return { valid: false, path: resolved, reason: 'none' };
}

export function detectInstalledRuntimes(): Array<{
  runtime: RuntimeId;
  installed: boolean;
  command: string;
}> {
  return (Object.keys(executable) as RuntimeId[]).map((runtime) => ({
    runtime,
    installed: detectCommand(executable[runtime]),
    command: executable[runtime],
  }));
}

/** Reads the self-contained host-package inventory shipped with the utility CLI. */
export function listInstalledRuntimeAdapters(): AdapterRegistryEntry[] {
  const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const registryPath = path.join(cliRoot, 'lib', 'host-packages', 'adapter-registry.json');
  if (!existsSync(registryPath)) return [];
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as AdapterRegistry;
  return registry.adapters.map((adapter) => structuredClone(adapter));
}
