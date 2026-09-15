import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

function detectCommand(command: string): boolean {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true });
  return !result.error && result.status === 0;
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
